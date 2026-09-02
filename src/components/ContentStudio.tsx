import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import {
  ArrowRight,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Image as ImageIcon,
  ImagePlus,
  LoaderCircle,
  Quote,
  Save,
  Sparkles,
  Trash2,
  Type,
  Wand2,
} from 'lucide-react'
import { Button, Card, Chip, Empty, Shell } from './ui'
import { Avatar } from './ui'
import { useStore } from '@/lib/store'
import {
  POSTER_SIZE,
  TEMPLATES,
  downloadPoster,
  posterBlob,
  posterThumbnail,
  renderPoster,
  type PosterKind,
  type PosterRender,
  type PosterTemplate,
} from '@/lib/poster'
import {
  NEUTRAL,
  PARTIES,
  brandFor,
  readDeskBrand,
  saveDeskBrand,
  secondLeaderRule,
  type DeskBrand,
} from '@/lib/party-brand'
import {
  CHECKED_ON,
  cautions,
  creditLine,
  leadersFor,
  marksFor,
  pictureByUrl,
  type Picture,
} from '@/lib/picture-library'
import { deletePoster, readPosters, savePoster, type SavedPoster } from '@/lib/studio-store'
import {
  ENTERED_DATE_NOTE,
  MOVABLE_DATE_NOTE,
  clearOccasionDate,
  daysAwayLabel,
  daysUntil,
  occasionDateHint,
  occasionDateSource,
  occasionStrip,
  setOccasionDate,
  type Occasion,
} from '@/lib/studio-occasions'
import { COPY_CHECK_NOTICE, fetchPostCopy, type CopyLanguage } from '@/lib/post-copy'
import { cn } from '@/lib/utils'
import { fadeUp, listStagger } from '@/lib/motion'

/**
 * The content studio: the one screen in this product that MAKES something.
 *
 * Everywhere else the desk reads what has already happened and every figure is
 * a measurement with its source attached. Here the office writes a poster and
 * publishes it under their own name, so the doctrine changes shape rather than
 * going away. Three things it still forbids, and each is enforced somewhere
 * you can point at:
 *
 *   NO INVENTED DATES. Half the festivals an Indian office posts on move every
 *   year on a lunar or lunisolar reckoning. src/lib/studio-occasions.ts ships
 *   the fixed observances with real dates and ships the movable ones with no
 *   date at all, and this screen shows those greyed with a way for the office
 *   to enter the date from their own calendar. A wrong Diwali greeting under a
 *   member's name is a public humiliation that cannot be recalled, and the
 *   product would have caused it.
 *
 *   NO WORDS IN A THIRD PARTY'S MOUTH. The poster carries exactly one
 *   signature, the desk owner's. There is no slot for a second speaker and the
 *   drafting endpoint refuses to quote or thank a named person.
 *
 *   THE COPY IS THE MODEL'S UNTIL SOMEBODY READS IT. Every drafted line lands
 *   in a field the office can edit, and the check-before-you-post line sits
 *   under it, which is the convention the grievance desk already set.
 *
 * The steps are numbered on the page on purpose. An office that opens this for
 * the first time should be able to work down the left column without being
 * told what to do, and should be able to stop after step three and still have
 * something worth posting.
 */

/* ── the five steps ──────────────────────────────────────────────────────── */

function Step({
  n,
  title,
  hint,
  children,
}: {
  n: number
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="border-t border-[var(--rule)] pt-4 first:border-0 first:pt-0">
      <p className="flex items-center gap-2 text-[13px] font-bold">
        <span className="tnum grid size-5 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--accent)]">
          {n}
        </span>
        {title}
      </p>
      {hint && <p className="mt-0.5 pl-7 text-[11px] leading-relaxed text-ink-3">{hint}</p>}
      <div className="mt-2.5 pl-7">{children}</div>
    </section>
  )
}


const LANGUAGES: CopyLanguage[] = ['English', 'Telugu', 'Hindi']

/**
 * The line under the name, without saying the seat twice.
 *
 * The role as an office records it usually already names the constituency, and
 * joining the two fields printed "MP, Mahabubnagar, Mahabubnagar" across the
 * foot of every poster the studio made.
 */
function designationOf(role: string | null, seat: string | null): string {
  const r = (role ?? '').trim()
  const s = (seat ?? '').trim()
  if (!s) return r
  if (!r) return s
  return r.toLowerCase().includes(s.toLowerCase()) ? r : `${r}, ${s}`
}

/* ── the party furniture ─────────────────────────────────────────────────── */

/**
 * A picked file as a data URL.
 *
 * A data URL and not an object URL, which is what step three uses for the
 * member's own photograph. The difference is that these three slots are meant
 * to be set up ONCE and used by every poster the office ever makes, so they
 * have to survive a reload, and an object URL dies with the page that made it.
 * Both are same-origin, so either keeps the canvas clean enough to export.
 */
function asDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('That file could not be read.'))
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.readAsDataURL(file)
  })
}

/**
 * What the pictures currently on the poster ask of the office.
 *
 * This is the one piece of explanatory text on this screen that stays, and it
 * stays because it is not an explanation, it is a condition of use. Somebody
 * chose a photograph the Government of India published under a licence that
 * asks for a credit and forbids implying that the government endorses them, or
 * a party mark that is a trademark, and the office has to know that before the
 * poster goes out rather than after. It is empty and invisible whenever the
 * pictures on the card carry no conditions at all.
 */
function LibraryTerms({ pictures }: { pictures: Picture[] }) {
  const credit = creditLine(pictures)
  const care = cautions(pictures)
  if (!credit && care.length === 0) return null
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
      <p className="text-[11px] font-bold">What these pictures ask for</p>
      {care.map((c) => (
        <p key={c} className="mt-1 text-[10.5px] leading-relaxed text-ink-3">
          {c}
        </p>
      ))}
      {credit && (
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-2">
          Credit: {credit}
        </p>
      )}
      <p className="mt-1.5 text-[10px] text-ink-3">Office holders checked {CHECKED_ON}.</p>
    </div>
  )
}

/**
 * The pictures the library holds for this slot, offered as a row to pick from.
 *
 * A row of thumbnails and not a dialog. There are never more than a handful per
 * slot, the office is choosing between faces they already recognise, and a
 * modal would put a click and a dismissal between them and a decision they can
 * make by looking. The one that is currently set is marked, so the row also
 * answers "which of these am I using" without anybody opening anything.
 */
function LibraryRow({
  pictures,
  current,
  onPick,
}: {
  pictures: Picture[]
  current: string | null
  onPick: (picture: Picture) => void
}) {
  // A row only ever offers rows that carry a picture. The library also holds
  // facts without faces, states whose government is known and whose chief
  // minister has no photograph that survives being cut out, and those belong to
  // the rule rather than to a picker.
  const shown = pictures.filter((p) => p.url !== null)
  if (shown.length === 0) return null
  return (
    <div className="mt-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3">
        Or pick one
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {shown.map((pic) => {
          const on = current === pic.url
          return (
            <li key={pic.id}>
              <button
                type="button"
                onClick={() => onPick(pic)}
                aria-pressed={on}
                title={`${pic.label}. ${pic.licence}.`}
                className={cn(
                  'grid size-11 place-items-center overflow-hidden rounded-full border-2 transition-colors',
                  on
                    ? 'border-[var(--accent)]'
                    : 'border-[var(--border)] hover:border-[var(--border-interactive)]',
                )}
              >
                <img
                  src={pic.url ?? ''}
                  alt={pic.label}
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * One image the office supplies: the party's mark, or a leader's photograph.
 *
 * Empty until they fill it, and empty is a real state rather than a
 * placeholder: nothing in this product ships a party's symbol or anybody's
 * face as a product asset, and a template handed an empty slot closes the space
 * up rather than drawing a grey circle where a face was meant to be.
 */
function Slot({
  label,
  hint,
  url,
  round,
  disabled,
  onPick,
  onClear,
}: {
  label: string
  hint?: string
  url: string | null
  round?: boolean
  disabled?: boolean
  onPick: (dataUrl: string) => void
  onClear: () => void
}) {
  return (
    <div className={cn('flex items-start gap-2.5', disabled && 'opacity-55')}>
      <span
        aria-hidden
        className={cn(
          'grid size-12 shrink-0 place-items-center overflow-hidden border border-[var(--border)] bg-[var(--surface-2)]',
          round ? 'rounded-full' : 'rounded-[var(--radius-md)]',
        )}
      >
        {url ? (
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <ImagePlus size={15} className="text-ink-3" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold">{label}</p>
        {hint && <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">{hint}</p>}
        {!disabled && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <label className="inline-flex min-h-8 cursor-pointer items-center rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[11.5px] font-semibold">
              {url ? 'Replace' : 'Upload'}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void asDataUrl(f).then(onPick, () => undefined)
                }}
              />
            </label>
            {url && (
              <button
                type="button"
                onClick={onClear}
                className="min-h-8 text-[11.5px] font-semibold text-ink-3"
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── the occasion strip ──────────────────────────────────────────────────── */

function OccasionCard({
  occasion,
  active,
  onPick,
}: {
  occasion: Occasion
  active: boolean
  onPick: () => void
}) {
  const days = occasion.date ? daysUntil(occasion.date) : Number.NaN
  const source = occasionDateSource(occasion.id)
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={cn(
        'w-[186px] shrink-0 rounded-[var(--radius-lg)] border p-3 text-left transition-colors',
        active
          ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
          : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-interactive)]',
      )}
    >
      <p className="line-clamp-2 min-h-[2.4em] text-[12.5px] font-bold leading-snug">
        {occasion.name}
      </p>
      <p className="mt-1 text-[10.5px] text-ink-3">
        {occasion.date
          ? new Date(occasion.date).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
          : 'Date not set'}
      </p>
      <span className="mt-1.5 inline-flex">
        <Chip tone={days <= 1 ? 'warning' : 'accent'}>{daysAwayLabel(days)}</Chip>
      </span>
      {/* A date the office typed must never sit on screen looking identical to
          Republic Day beside it. */}
      {source === 'entered' && (
        <p className="mt-1 text-[9.5px] leading-relaxed text-ink-3">{ENTERED_DATE_NOTE}</p>
      )}
    </button>
  )
}

/** A movable festival the studio refuses to guess a date for. */
function UndatedCard({ occasion, onSaved }: { occasion: Occasion; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [day, setDay] = useState('')
  const [error, setError] = useState<string | null>(null)
  const hint = occasionDateHint(occasion.id)

  const save = (): void => {
    const res = setOccasionDate(occasion.id, day)
    if (res.ok) {
      setOpen(false)
      setDay('')
      setError(null)
      onSaved()
    } else {
      setError(res.reason)
    }
  }

  return (
    <div className="w-[186px] shrink-0 rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-3">
      <p className="line-clamp-2 min-h-[2.4em] text-[12.5px] font-bold leading-snug text-ink-2">
        {occasion.name}
      </p>
      {open ? (
        <>
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            aria-label={`The date ${occasion.name} falls on this year`}
            className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-ink"
          />
          {hint && <p className="mt-1 text-[9.5px] leading-relaxed text-ink-3">{hint}</p>}
          {error && <p className="mt-1 text-[9.5px] leading-relaxed text-[var(--neg)]">{error}</p>}
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" onClick={save} disabled={!day}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-[11px] font-semibold text-[var(--accent)]"
        >
          <CalendarPlus size={12} aria-hidden />
          Add the date
        </button>
      )}
    </div>
  )
}

/* ── the screen ──────────────────────────────────────────────────────────── */

export function ContentStudio({
  onClose,
  seed = null,
}: {
  onClose: () => void
  /**
   * A brief handed across by the recommendations screen, so "make this in the
   * studio" opens the studio already saying what the post is for. It seeds the
   * initial state and nothing more: the office edits it like anything they
   * typed, and it stays a draft here exactly as it was a draft there.
   */
  seed?: string | null
}) {
  const reduce = useReducedMotion() === true
  const store = useStore()
  const identity = store.identity

  const [templateId, setTemplateId] = useState<string>('festival')
  const [language, setLanguage] = useState<CopyLanguage>('English')
  const [occasionId, setOccasionId] = useState<string | null>(null)
  const [brief, setBrief] = useState(seed ?? '')
  const [headline, setHeadline] = useState('')
  const [body, setBody] = useState('')
  const [caption, setCaption] = useState('')
  const [hashtags, setHashtags] = useState<string[]>([])
  const [photoUrl, setPhotoUrl] = useState<string | null>(identity?.photoUrl ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showPosts, setShowPosts] = useState(false)
  const [posts, setPosts] = useState<SavedPoster[]>([])
  const [render, setRender] = useState<PosterRender | null>(null)
  /** Bumped when an occasion date is entered, so the strip re-reads storage. */
  const [datesRev, setDatesRev] = useState(0)
  /**
   * Whether the office has typed in the copy fields themselves.
   *
   * Picking a second occasion used to change nothing below: the headline was
   * already set from the first one, and the fallback only applies to an empty
   * field, so the poster kept wishing everybody a happy Diwali under a
   * Teachers' Day card. Now a change of occasion refreshes the copy, unless
   * somebody has actually written something, in which case their words are
   * theirs and the studio does not throw them away.
   */
  const [touched, setTouched] = useState(false)
  /**
   * The party's mark, the leaders' photographs and the standing line.
   *
   * Held per desk and set up once, not per poster, which is why they live in
   * storage rather than in this component's state alone.
   */
  const [brand, setBrand] = useState<DeskBrand>(() => readDeskBrand())
  /** The little word over the greeting: "Happy" over "Diwali". */
  const [eyebrow, setEyebrow] = useState('')
  /**
   * Set when the office overrules the chief minister rule for their own state.
   *
   * The rule below is right about Telangana today and will be wrong about some
   * state the day after an election, so there is a way past it. It is local to
   * this session on purpose: an override that persisted would outlive the
   * reason somebody set it, and the next person to open the studio would find a
   * second leader slot open with no idea who opened it.
   */
  const [alsoState, setAlsoState] = useState(false)

  /**
   * THE PARTY THIS CARD IS FOR, which is not always the party of the desk.
   *
   * It starts as the desk's own and the office will almost never change it. The
   * selector exists because this studio is one office's copy of a thing meant
   * to serve any office: a Congress worker opening it should get Congress green
   * and the Congress mark without anybody rebuilding the product for them, and
   * the only way to prove that works is to be able to switch to it and look.
   *
   * The signature does NOT follow it. Whatever party is selected, the plate at
   * the foot of the poster carries this desk's own name, so choosing another
   * party's colours produces a card that says what it is: this member, in
   * somebody else's livery. That is visible rather than hidden, and the screen
   * says so in a line when the two do not match.
   */
  const own = useMemo(() => brandFor(identity?.party ?? null), [identity])
  const [partyId, setPartyId] = useState<string>(() => own.short)
  const party = useMemo(
    () => PARTIES.find((x) => x.short === partyId) ?? NEUTRAL,
    [partyId],
  )
  // A desk that resolves its own party later, once the identity arrives, should
  // land on it rather than sit on whatever was first.
  useEffect(() => {
    setPartyId((current) => (current === NEUTRAL.short ? own.short : current))
  }, [own])
  /**
   * Whether the chief minister belongs on this desk's posters.
   *
   * The office's own words: the prime minister always, and the chief minister
   * as well only when they are the same party. On this desk that resolves to
   * the prime minister alone.
   */
  const leaderRule = useMemo(
    () => secondLeaderRule(party === NEUTRAL ? null : party.name, identity?.state ?? null),
    [party, identity],
  )
  const secondSlot = leaderRule.slot === 'offer' || leaderRule.slot === 'ask' || alsoState

  /** What this desk's party has in the library, and what is already chosen. */
  const marks = useMemo(() => marksFor(party === NEUTRAL ? null : party.short), [party])
  const leaders = useMemo(() => leadersFor(party === NEUTRAL ? null : party.short), [party])
  const borrowed = party !== NEUTRAL && own !== NEUTRAL && party.short !== own.short
  const chosen = useMemo(
    (): Picture[] =>
      [brand.markUrl, brand.leaderUrl, secondSlot ? brand.leader2Url : null]
        .map(pictureByUrl)
        .filter((x): x is Picture => x !== null),
    [brand, secondSlot],
  )

  /**
   * The first time a desk opens the studio, the mark and the national figure
   * are set from the library.
   *
   * The office asked to be able to pick these straight from the product rather
   * than hunt for a file, and a slot that starts empty when the right answer is
   * known is a chore rather than a choice. Both remain changeable and both can
   * be emptied. This runs once per empty slot: it never overwrites a picture
   * somebody chose, and it never fills a slot for a party the library has
   * nothing for.
   */
  useEffect(() => {
    const patch: Partial<DeskBrand> = {}
    // A slot holding a library picture that belongs to a DIFFERENT party is
    // swapped for this party's; a slot holding the office's own upload is left
    // alone, because `pictureByUrl` returns null for anything not in the
    // library and an upload is somebody's deliberate choice. An empty slot
    // takes this party's default. Each is only written when it would actually
    // change, or the write feeds the next render and the effect never settles.
    const held = pictureByUrl(brand.markUrl)
    const wantMark =
      brand.markUrl && !(held && held.party !== party.short)
        ? brand.markUrl
        : (marks[0]?.url ?? null)
    if (wantMark !== brand.markUrl) patch.markUrl = wantMark

    const heldLeader = pictureByUrl(brand.leaderUrl)
    const wantLeader =
      brand.leaderUrl && !(heldLeader && heldLeader.party !== party.short)
        ? brand.leaderUrl
        : (leaders[0]?.url ?? null)
    if (wantLeader !== brand.leaderUrl) patch.leaderUrl = wantLeader

    if (Object.keys(patch).length > 0) setBrand(saveDeskBrand(patch))
  }, [marks, leaders, brand.markUrl, brand.leaderUrl, party])

  // The chief minister's own portrait, offered only where the rule allows it.
  useEffect(() => {
    if (!secondSlot || brand.leader2Url || !leaderRule.picture) return
    setBrand(saveDeskBrand({ leader2Url: leaderRule.picture.url }))
  }, [secondSlot, brand.leader2Url, leaderRule])

  const setSlot = useCallback((patch: Partial<DeskBrand>): void => {
    setBrand(saveDeskBrand(patch))
  }, [])

  const strip = useMemo(() => occasionStrip(30), [datesRev])
  const occasion = useMemo(
    () => strip.upcoming.find((o) => o.id === occasionId) ?? null,
    [strip, occasionId],
  )

  // The copy follows the occasion until the office takes it over.
  useEffect(() => {
    if (touched) return
    setHeadline(occasion ? occasion.name : '')
    setEyebrow('')
    setBody('')
    setCaption('')
    setHashtags([])
  }, [occasionId, occasion, touched])

  /** Every card. They are all image posts now, so there is nothing to filter. */
  const templates = TEMPLATES
  useEffect(() => {
    if (!templates.some((t) => t.id === templateId) && templates[0]) setTemplateId(templates[0].id)
  }, [templates, templateId])
  const template: PosterTemplate = templates.find((t) => t.id === templateId) ?? TEMPLATES[0]!

  const input = useMemo(
    () => ({
      template,
      headline: headline || (occasion ? occasion.name : 'Your headline'),
      body,
      name: identity?.name ?? 'Your name',
      designation: designationOf(identity?.role ?? null, identity?.constituency ?? null),
      photoUrl,
      // The desk's own colours, and ONLY on the templates drawn in them. The
      // festival card is warm paper and the quote card is dark, both chosen for
      // the layout rather than for a party, and repainting them would leave the
      // office no way to publish something that does not look like a party
      // poster. A condolence notice is the case that decided this.
      palette: template.party ? party.palette : null,
      partyMarkUrl: brand.markUrl,
      leaderUrl: brand.leaderUrl,
      // The rule enforced at the one point that matters. A second face the desk
      // is not entitled to put up never reaches the renderer, whatever is
      // sitting in storage from before an election or another desk's setup.
      leader2Url: secondSlot ? brand.leader2Url : null,
      partyShort: party === NEUTRAL ? null : party.short,
      // The party's own name in the script the card is written in. English
      // takes none: the reference sheets set the party's name in Devanagari on
      // a Hindi card and leave it off an English one, which is right, because
      // "Bharatiya Janata Party" spelled out in Latin under the mark is a
      // caption rather than a masthead.
      partyName:
        language === 'Hindi'
          ? party.names.hi
          : language === 'Telugu'
            ? party.names.te
            : null,
      eyebrow,
      slogan: brand.slogan,
    }),
    [template, headline, body, identity, photoUrl, occasion, party, brand, secondSlot, language, eyebrow],
  )

  /* ── the preview, redrawn whenever anything it depends on moves ──────── */
  const canvas = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    let alive = true
    const el = canvas.current
    if (!el) return
    void renderPoster(el, input).then(
      (r) => alive && setRender(r),
      () => alive && setRender(null),
    )
    return () => {
      alive = false
    }
  }, [input])

  // The canvas owns its own backing store, so a change of CSS width has to be
  // redrawn rather than resampled or the preview goes soft on a rotate.
  useEffect(() => {
    const el = canvas.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - last) < 8) return
      last = el.clientWidth
      void renderPoster(el, input)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [input])

  useEffect(() => {
    if (showPosts) setPosts(readPosters())
  }, [showPosts])

  const draft = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetchPostCopy({
        person: {
          name: identity?.name ?? 'This office',
          role: identity?.role ?? null,
          party: identity?.party ?? null,
          constituency: identity?.constituency ?? null,
        },
        occasion: occasion?.date ? { name: occasion.name, date: occasion.date } : null,
        kind: 'image' as const,
        language,
        brief,
      })
      setHeadline(res.headline)
      setBody(res.body)
      setCaption(res.caption)
      setHashtags(res.hashtags)
      // A draft belongs to the occasion it was drafted for. Leaving it
      // untouched means changing occasion clears it, which is what somebody
      // switching from Diwali to Teachers' Day is asking for.
      setTouched(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The copy could not be drafted.')
    } finally {
      setBusy(false)
    }
  }, [identity, occasion, language, brief])

  /**
   * PNG or JPG, because the office's reference sheet offers both and they are
   * not the same choice.
   *
   * PNG is exact and is what a printer wants; a 1080 by 1350 poster of this
   * kind comes out around a megabyte. JPG is a third of that at a quality
   * nobody can see the difference in on a phone, and WhatsApp, which is how
   * most of these actually travel, is going to re-encode it anyway. The office
   * should not have to know that, so the two buttons sit side by side and the
   * file name says which is which.
   */
  const download = useCallback(
    async (kind: 'png' | 'jpg') => {
      const blob = await posterBlob(input, kind)
      const stamp = new Date().toISOString().slice(0, 10)
      downloadPoster(blob, `${template.id}-${stamp}.${kind}`)
    },
    [input, template],
  )

  const keep = useCallback(async () => {
    const thumbnail = await posterThumbnail(input, 360)
    savePoster({ templateId: template.id, headline: input.headline, body, thumbnail })
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }, [input, template, body])

  const copy = useCallback(() => {
    const text = [caption, hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n')
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }, [caption, hashtags])

  const stripRef = useRef<HTMLDivElement | null>(null)
  const nudge = (dir: -1 | 1): void => {
    stripRef.current?.scrollBy({ left: dir * 200, behavior: 'smooth' })
  }

  if (showPosts) {
    return (
      <Shell className="stack">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[clamp(1.35rem,1.1rem+0.9vw,1.6rem)] font-bold tracking-[-0.022em]">
              My posts
            </h1>
            <p className="mt-1 text-[12.5px] text-ink-3">
              {posts.length} kept on this device
            </p>
          </div>
          <Button variant="outline" onClick={() => setShowPosts(false)}>
            Back to the studio
          </Button>
        </div>
        {posts.length === 0 ? (
          <Empty
            icon={<Wand2 size={18} aria-hidden />}
            title="Nothing kept yet"
            body="Posters you save in the studio are held on this device so you can find them again."
            action={<Button size="sm" onClick={() => setShowPosts(false)}>Make one</Button>}
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {posts.map((p) => (
              <li key={p.id}>
                <Card className="p-2.5">
                  <img
                    src={p.thumbnail}
                    alt=""
                    className="w-full rounded-[var(--radius-md)] border border-[var(--rule)]"
                  />
                  <p className="mt-2 line-clamp-2 text-[12px] font-semibold">{p.headline}</p>
                  <p className="mt-0.5 text-[10.5px] text-ink-3">
                    {new Date(p.createdAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      deletePoster(p.id)
                      setPosts(readPosters())
                    }}
                    className="mt-2 inline-flex min-h-9 items-center gap-1 text-[11px] font-semibold text-[var(--neg)]"
                  >
                    <Trash2 size={12} aria-hidden />
                    Delete
                  </button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Shell>
    )
  }

  return (
    <Shell className="stack">
      <m.div variants={listStagger} initial={reduce ? false : 'hidden'} animate="show">
        <m.div variants={fadeUp} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[clamp(1.35rem,1.1rem+0.9vw,1.6rem)] font-bold tracking-[-0.022em]">
              Content studio
            </h1>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
              Make a poster and the words to go with it, in minutes.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setShowPosts(true)}>
              <ImageIcon size={15} aria-hidden />
              My posts
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Back
            </Button>
          </div>
        </m.div>

        {/* ── the occasions ───────────────────────────────────────────── */}
        <m.div variants={fadeUp} className="relative mt-3">
          <Card className="p-4">
            <p className="text-[14px] font-bold">Coming up</p>
            <p className="mt-0.5 text-[11px] text-ink-3">
              Pick an occasion and the studio writes for it.
            </p>
            <div ref={stripRef} className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {strip.upcoming.map((o) => (
                <OccasionCard
                  key={o.id}
                  occasion={o}
                  active={occasionId === o.id}
                  onPick={() => setOccasionId(occasionId === o.id ? null : o.id)}
                />
              ))}
              {strip.undated.slice(0, 8).map((o) => (
                <UndatedCard key={o.id} occasion={o} onSaved={() => setDatesRev((v) => v + 1)} />
              ))}
            </div>
            {strip.undated.length > 0 && (
              <p className="mt-2 text-[10px] leading-relaxed text-ink-3">{MOVABLE_DATE_NOTE}</p>
            )}
            <div className="mt-1 hidden gap-1.5 lg:flex">
              <button
                type="button"
                onClick={() => nudge(-1)}
                aria-label="Scroll back"
                className="grid size-8 place-items-center rounded-full border border-[var(--border)] text-ink-3"
              >
                <ChevronLeft size={15} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => nudge(1)}
                aria-label="Scroll forward"
                className="grid size-8 place-items-center rounded-full border border-[var(--border)] text-ink-3"
              >
                <ChevronRight size={15} aria-hidden />
              </button>
            </div>
          </Card>
        </m.div>

        <div className="@container mt-3">
          <div className="grid gap-3 @3xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] @3xl:items-start">
            {/* ── the steps ─────────────────────────────────────────── */}
            {/* Second in the source and second on a wide screen, but the
                preview below is pulled ahead of it on a narrow one. A phone
                shows one column, and the first thing in that column should be
                the poster: it is what the office came to make, it is how they
                know a change landed, and reading five numbered steps before
                seeing anything is how somebody decides a tool is work. */}
            <m.div variants={fadeUp} className="@3xl:order-1">
              <Card className="space-y-4 p-4">
                <Step
                  n={1}
                  title="Pick a party and a card"
                  hint="The party sets the colours, the mark and the figure. The card sets the layout."
                >
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                      Party
                    </span>
                    <select
                      value={partyId}
                      onChange={(e) => setPartyId(e.target.value)}
                      className="select w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-ink"
                    >
                      {PARTIES.map((x) => (
                        <option key={x.short} value={x.short}>
                          {x.name} ({x.short})
                        </option>
                      ))}
                    </select>
                  </label>
                  {borrowed && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
                      Your desk is {own.short}. This card will carry {party.short} colours over
                      your own name.
                    </p>
                  )}

                  <ul className="mt-3 grid gap-2 @sm:grid-cols-2">
                    {templates.map((t) => {
                      const pal = t.party ? party.palette : t.palette
                      const on = templateId === t.id
                      return (
                        <li key={t.id}>
                          <button
                            type="button"
                            onClick={() => setTemplateId(t.id)}
                            aria-pressed={on}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-[var(--radius-lg)] border p-2.5 text-left transition-colors',
                              on
                                ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                                : 'border-[var(--border)] hover:border-[var(--border-interactive)]',
                            )}
                          >
                            {/* A small card rather than a colour chip: the
                                ground the poster will really be drawn on, a
                                disc where its mark goes and a bar where the
                                name goes. It is the difference between "this
                                one is orange" and "this one looks like that". */}
                            <span
                              aria-hidden
                              className="relative h-[46px] w-[37px] shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--rule)]"
                              style={{ background: `color-mix(in srgb, ${pal.bg} 26%, white)` }}
                            >
                              <span
                                className="absolute left-1/2 top-1 size-2.5 -translate-x-1/2 rounded-full border"
                                style={{ background: '#fff', borderColor: pal.accent }}
                              />
                              <span
                                className="absolute bottom-1.5 right-1 h-1.5 w-4 rounded-[1px]"
                                style={{ background: pal.accent }}
                              />
                              <span
                                className="absolute bottom-0 left-0 h-2 w-full"
                                style={{ background: pal.accent2 ?? pal.accent, opacity: 0.55 }}
                              />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[12.5px] font-semibold">
                                {t.name}
                              </span>
                              <span className="mt-0.5 block text-[10.5px] leading-relaxed text-ink-3">
                                {t.about}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </Step>

                <Step n={2} title="Your photograph" hint="Used on the templates that carry a face.">
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar src={photoUrl} name={identity?.name ?? 'You'} size={44} />
                    <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-3 text-[12.5px] font-semibold shadow-[var(--e1)]">
                      Change photograph
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          // An object URL is same-origin, which is what keeps
                          // the canvas untainted and the download working.
                          if (f) setPhotoUrl(URL.createObjectURL(f))
                        }}
                      />
                    </label>
                    {photoUrl && photoUrl !== identity?.photoUrl && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPhotoUrl(identity?.photoUrl ?? null)}
                      >
                        Use my desk photo
                      </Button>
                    )}
                  </div>
                </Step>

                <Step
                  n={3}
                  title="Your party and your leaders"
                  hint="Set these once. Every party template uses them."
                >
                  <div className="space-y-3">
                    <div>
                      <Slot
                        label="Party mark"
                        hint={
                          party === NEUTRAL
                            ? 'Until you set one, the card leaves the space out.'
                            : `Until you set one, the card sets ${party.short} in its place.`
                        }
                        url={brand.markUrl}
                        round
                        onPick={(markUrl) => setSlot({ markUrl })}
                        onClear={() => setSlot({ markUrl: null })}
                      />
                      <LibraryRow
                        pictures={marks}
                        current={brand.markUrl}
                        onPick={(pic) => setSlot({ markUrl: pic.url })}
                      />
                    </div>
                    <div>
                      <Slot
                        label="Your party's figure"
                        hint="Stands at the left of the card."
                        url={brand.leaderUrl}
                        round
                        onPick={(leaderUrl) => setSlot({ leaderUrl })}
                        onClear={() => setSlot({ leaderUrl: null })}
                      />
                      <LibraryRow
                        pictures={leaders}
                        current={brand.leaderUrl}
                        onPick={(pic) => setSlot({ leaderUrl: pic.url })}
                      />
                    </div>
                    <div>
                      <Slot
                        label="Chief minister"
                        hint={leaderRule.note}
                        url={secondSlot ? brand.leader2Url : null}
                        round
                        disabled={!secondSlot}
                        onPick={(leader2Url) => setSlot({ leader2Url })}
                        onClear={() => setSlot({ leader2Url: null })}
                      />
                      {secondSlot && leaderRule.picture && (
                        <LibraryRow
                          pictures={[leaderRule.picture]}
                          current={brand.leader2Url}
                          onPick={(pic) => setSlot({ leader2Url: pic.url })}
                        />
                      )}
                    </div>
                    {leaderRule.slot === 'hide' && !alsoState && (
                      <button
                        type="button"
                        onClick={() => setAlsoState(true)}
                        className="min-h-8 pl-[58px] text-[11.5px] font-semibold text-[var(--accent)]"
                      >
                        Add one anyway
                      </button>
                    )}
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                        Your standing line
                      </span>
                      <input
                        value={brand.slogan ?? ''}
                        onChange={(e) => setSlot({ slogan: e.target.value })}
                        placeholder="The line your office puts on every poster"
                        className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-ink"
                      />
                    </label>
                    <LibraryTerms pictures={chosen} />
                  </div>
                </Step>

                <Step
                  n={4}
                  title="Say what you want to say"
                  hint="A line in your own words. The studio can draft the rest."
                >
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                    <label className="block">
                      <span className="sr-only">What this post should say</span>
                      <textarea
                        value={brief}
                        onChange={(e) => setBrief(e.target.value)}
                        rows={2}
                        placeholder="Greetings for the day, or the thing you want to announce"
                        className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-2.5 leading-relaxed text-ink"
                      />
                    </label>
                    <label className="block sm:w-[120px]">
                      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                        Language
                      </span>
                      <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value as CopyLanguage)}
                        className="select w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-ink"
                      >
                        {LANGUAGES.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <Button size="sm" variant="outline" className="mt-2" onClick={draft} disabled={busy}>
                    {busy ? (
                      <>
                        <LoaderCircle size={14} className="animate-spin" aria-hidden />
                        Drafting
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} aria-hidden />
                        Draft it for me
                      </>
                    )}
                  </Button>
                  {error && (
                    <p className="mt-2 text-[11px] leading-relaxed text-[var(--neg)]">{error}</p>
                  )}
                </Step>

                <Step n={5} title="Check the words" hint="Edit anything. These go on the poster.">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                      The small word above
                    </span>
                    <input
                      value={eyebrow}
                      onChange={(e) => {
                        setTouched(true)
                        setEyebrow(e.target.value)
                      }}
                      placeholder="Happy"
                      className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-ink"
                    />
                  </label>
                  <label className="mt-2 block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                      Headline
                    </span>
                    <input
                      value={headline}
                      onChange={(e) => {
                        setTouched(true)
                        setHeadline(e.target.value)
                      }}
                      placeholder={occasion ? occasion.name : 'The big line'}
                      className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-ink"
                    />
                  </label>
                  <label className="mt-2 block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                      Under it
                    </span>
                    <textarea
                      value={body}
                      onChange={(e) => {
                        setTouched(true)
                        setBody(e.target.value)
                      }}
                      rows={2}
                      placeholder="One or two sentences"
                      className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-2.5 leading-relaxed text-ink"
                    />
                  </label>
                  <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
                    Anything drafted here is the model&rsquo;s wording, not a measurement.{' '}
                    {COPY_CHECK_NOTICE}.
                  </p>
                </Step>
              </Card>
            </m.div>

            {/* ── the preview ───────────────────────────────────────── */}
            <m.div
              variants={fadeUp}
              className="-order-1 @3xl:order-2 @3xl:sticky @3xl:top-4"
            >
              <Card className="p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[14px] font-bold">Your poster</p>
                  <p className="tnum text-[10.5px] text-ink-3">
                    {POSTER_SIZE.w} &times; {POSTER_SIZE.h}
                  </p>
                </div>
                <div className="mt-2.5 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--rule)] shadow-[var(--e2)]">
                  {/* No width or height attributes: renderPoster owns the
                      backing store, and setting them here would fight it. */}
                  <canvas ref={canvas} className="block w-full" />
                </div>

                {render?.photo === 'unavailable' && (
                  <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">
                    That photograph could not be loaded, so the poster was made without it.
                  </p>
                )}
                {render && !render.glyphsCovered && (
                  <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">
                    This device has no font for that script, so the poster may show empty boxes.
                  </p>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2 @xs:grid-cols-3">
                  <Button className="w-full" onClick={() => void download('png')}>
                    <Download size={15} aria-hidden />
                    PNG
                  </Button>
                  <Button variant="outline" className="w-full" onClick={() => void download('jpg')}>
                    <Download size={15} aria-hidden />
                    JPG
                  </Button>
                  <Button
                    variant="outline"
                    className="col-span-2 w-full @xs:col-span-1"
                    onClick={keep}
                  >
                    {saved ? <Check size={15} aria-hidden /> : <Save size={15} aria-hidden />}
                    {saved ? 'Kept' : 'Keep it'}
                  </Button>
                </div>

                {(caption || hashtags.length > 0) && (
                  <div className="mt-3 border-t border-[var(--rule)] pt-3">
                    <p className="text-[12px] font-bold">The caption</p>
                    <textarea
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      rows={3}
                      aria-label="The caption to post beside the image"
                      className="mt-1.5 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-2.5 leading-relaxed text-ink"
                    />
                    {hashtags.length > 0 && (
                      <ul className="mt-1.5 flex flex-wrap gap-1">
                        {hashtags.map((h) => (
                          <li key={h}>
                            <Chip>#{h}</Chip>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      onClick={copy}
                      className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-[12px] font-semibold text-[var(--accent)]"
                    >
                      {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
                      {copied ? 'Copied' : 'Copy the caption'}
                      {!copied && <ArrowRight size={12} aria-hidden />}
                    </button>
                  </div>
                )}
              </Card>
            </m.div>
          </div>
        </div>
      </m.div>
    </Shell>
  )
}
