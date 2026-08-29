import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as m from 'motion/react-m'
import { ArrowRight, Info, Lightbulb, ListPlus, Radar, RefreshCw, Table2, User } from 'lucide-react'
import type { Identity } from '@shared/identity'
import { Button, Card, Chip, SectionTitle } from './ui'
import { Legend, RadarChart } from '@/components/kit'
import { cn } from '@/lib/utils'
import { fadeUp } from '@/lib/motion'
import { fileFreeAction, hasOpenAction } from '@/lib/actions'
import { actionIdForSource, requestActionFocus } from '@/lib/focus'
import { readStore } from '@/lib/store'
import { fetchWithTimeout } from '@/lib/net'

/**
 * Two people, side by side, on what an office actually argues about.
 *
 * The comparison this replaces was follower counts and engagement rate. That is
 * a comparison of two social media managers — nobody loses a seat because their
 * opponent posts better — and it could only ever cover accounts that had been
 * added by hand and successfully read.
 *
 * This compares the two PEOPLE, from the published record, on five things: what
 * they have built, how they stand with voters, how they are written about, how
 * much they are written about at all, and what they are accused of. The scores
 * come back from /api/compare with an evidence line each, and the evidence line
 * is the part worth reading — the bars exist to show the reader where to look.
 *
 * ── The chart ─────────────────────────────────────────────────────────────
 *
 * Form: a grouped horizontal bar with exactly two series, drawn mirrored around
 * a centre line. That is the "split screen" this was asked for, and it is also
 * the right form for the job — telling two distinct series apart across five
 * categories. Both sides run 0–100 off the same centre, so the two halves are
 * ONE scale, not two; a mirrored chart with different scales per side is the
 * dual-axis mistake wearing a disguise.
 *
 * Colour: categorical, by PERSON, fixed. The subject is always blue and the
 * rival always amber, whoever happens to be ahead on a given row. Colouring by
 * who leads would repaint the chart every time a bar moved, and the reader
 * would learn nothing from the colour at all. The pair lives in the
 * `--vs-subject` / `--vs-rival` tokens in index.css — validated there per
 * surface, with the dark pair a separate selection, not a lightened copy of
 * the light one. Status colours were deliberately not used: green/red here
 * would say the subject is good and the rival bad, which is not what the data
 * measures.
 *
 * The figure is printed beside each bar, and a radar across the same dimensions
 * sits above them, so the reader takes in the SHAPE and the numbers at once.
 * The numbers are a model's placement of two people on one 0–100 scale, not a
 * measurement of anything — so they are labelled as placements wherever they
 * appear, and the evidence line, not the figure, still carries the substance.
 * The full placement table stays one press away for anyone who wants every
 * number lined up in a single column.
 */

/* ── the shape the endpoint returns ──────────────────────────────────────── */

export interface CompareDimension {
  key: string
  label: string
  subjectScore: number
  rivalScore: number
  subjectNote: string
  rivalNote: string
  edge: 'subject' | 'rival' | 'level'
  /**
   * False when the search never placed either person on this row. Older cached
   * results predate the field, so it defaults to true at the point of use
   * rather than here — an absent flag means "this came from before the
   * distinction existed", not "nothing was assessed".
   */
  assessed?: boolean
}

export interface CompareResult {
  subject: { name: string; strengths: string[] }
  rival: { name: string; strengths: string[] }
  dimensions: CompareDimension[]
  verdict: string
  gaps: string[]
  move: { action: string; rationale: string; talkingPoints: string[] } | null
  sources: { title: string; url: string | null }[]
  confidence: 'thin' | 'moderate' | 'well-covered'
  caveats: string[]
}

/**
 * Who we are comparing against, as much as is known about them.
 *
 * The optional half below is not decoration. `describePerson` in compare.ts
 * builds the search prompt from these fields, so a rival passed as a bare name
 * against a subject carrying role, seat, party and state produces a measurably
 * weaker search on the rival's side — and that weakness lands in the
 * `visibility` dimension looking exactly like a fact about him. Everything here
 * is already fetched by rival discovery; it was simply being dropped.
 */
/**
 * Notes already gathered on a person, kept for six hours.
 *
 * A comparison reads two people, one request each, and either half can time
 * out on its own: measured, a grounded search runs 18-30s against a local
 * runtime that kills the function at 30s exactly. Without this, a failure in
 * the second half threw away a perfectly good first half, and "Try again"
 * paid for both people from scratch, with the same odds of losing one again.
 * That is why the office saw the failure so often: each attempt was rolling
 * two dice and needed both.
 *
 * With the halves kept, a retry only re-reads the one that failed, so the
 * second attempt is both faster and twice as likely to complete. It also
 * makes comparing the same rival again free for the rest of the working day.
 *
 * Six hours because this is the published record, which does not move hour to
 * hour, and the desk is used in one sitting. Nothing here is private: it is a
 * summary of what newspapers have printed. It still lives in sessionStorage
 * rather than localStorage, so it leaves with the tab.
 */
const NOTES_TTL_MS = 6 * 60 * 60 * 1000
const notesKey = (name: string): string => `signal:compare-notes:${name.trim().toLowerCase()}`

function cachedNotes(name: string): { notes: string; sources: unknown[] } | null {
  try {
    const raw = sessionStorage.getItem(notesKey(name))
    if (!raw) return null
    const v = JSON.parse(raw) as { at?: number; notes?: string; sources?: unknown[] }
    if (!v.notes || typeof v.at !== 'number') return null
    if (Date.now() - v.at > NOTES_TTL_MS) return null
    return { notes: v.notes, sources: v.sources ?? [] }
  } catch {
    // A full or disabled sessionStorage must never break a comparison.
    return null
  }
}

function rememberNotes(name: string, notes: string, sources: unknown[]): void {
  try {
    sessionStorage.setItem(notesKey(name), JSON.stringify({ at: Date.now(), notes, sources }))
  } catch {
    /* out of quota: the comparison still works, it just will not be free next time */
  }
}

export interface RivalRef {
  name: string
  role?: string | null
  party?: string | null
  constituency?: string | null
  state?: string | null
  photoUrl?: string | null
  /** Why discovery put this person on the list. */
  why?: string | null
  /** Which cohort they were grouped under — same office, same seat, same trade. */
  cohort?: string | null
  followers?: number | null
  platforms?: string[]
  profileUrl?: string | null
}

/* ── the two series ──────────────────────────────────────────────────────── */

const SERIES = {
  subject: 'var(--vs-subject)',
  rival: 'var(--vs-rival)',
} as const

/* ── one person's masthead ───────────────────────────────────────────────── */

function Portrait({
  name,
  photoUrl,
  lines,
  colour,
  align,
}: {
  name: string
  photoUrl: string | null | undefined
  lines: string[]
  colour: string
  align: 'left' | 'right'
}) {
  const [broken, setBroken] = useState(false)
  const showPhoto = Boolean(photoUrl) && !broken

  return (
    <div
      className={cn(
        // Stacked on a phone, side by side from lg. At 360px each half of the
        // split is about 145px: a 56px portrait beside a name leaves roughly
        // 75px of text column, which truncates every name worth reading.
        'flex min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:items-center lg:gap-3',
        align === 'right' ? 'items-end text-right lg:flex-row-reverse' : 'items-start',
      )}
    >
      {/* The ring is the identity channel that survives a missing photograph,
          and it is the same colour as this person's bars — so the reader learns
          which side of the chart is which before reading a single label. A
          surface gap between photo and ring is the avatar-ring treatment every
          reference profile card wears. */}
      <span
        className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full lg:size-16"
        style={{
          boxShadow: `0 0 0 2px var(--surface), 0 0 0 4px ${colour}`,
          background: 'var(--surface-2)',
        }}
      >
        {showPhoto ? (
          <img
            src={photoUrl ?? ''}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <User size={22} className="text-ink-3" />
        )}
      </span>

      <span className="min-w-0 max-w-full">
        <span className="block truncate text-sm font-bold text-ink lg:text-base">{name}</span>
        {lines.map((line) => (
          <span key={line} className="block truncate text-xs text-ink-3">
            {line}
          </span>
        ))}
      </span>
    </div>
  )
}

/* ── one row of the chart ────────────────────────────────────────────────── */

/**
 * The grid every row on this screen shares.
 *
 * A named constant rather than repeated classes, because the split only reads
 * as a split if the centre line lands in the same place on every row. The
 * `minmax(0,…)` is load-bearing: a bare `1fr` refuses to shrink below its
 * content, so a long unbroken evidence sentence would push the gutter off
 * centre and `truncate` would never fire.
 */
/**
 * The gutter is 3.5rem on a phone because the VS control is a 48px tap target
 * and has to sit inside it — a narrower gutter puts the button's edges over
 * the two columns it is supposed to divide. From lg it widens to hold the
 * dimension label as well.
 */
const SPLIT = 'grid grid-cols-[minmax(0,1fr)_3.5rem_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)]'

function DimensionRow({
  dimension,
  subjectName,
  rivalName,
}: {
  dimension: CompareDimension
  subjectName: string
  rivalName: string
}) {
  const { label, subjectScore, rivalScore, subjectNote, rivalNote, edge } = dimension
  // Absent on results cached before the field existed. Those rows did have a
  // placement; only genuinely unassessed rows arrive with it false.
  const assessed = dimension.assessed !== false

  /** "Ramesh ahead" as a soft pill in the person's own colour — the same
      treatment the reference boards give their benchmark labels. The words
      carry the fact; the tint only repeats it. */
  const aheadPill = (who: 'subject' | 'rival') => (
    <span
      className="inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold"
      style={{
        background: `color-mix(in oklab, ${SERIES[who]} 12%, transparent)`,
        color: SERIES[who],
      }}
    >
      <span className="truncate">{who === 'subject' ? subjectName : rivalName} ahead</span>
    </span>
  )
  const levelPill = (
    <span className="inline-flex items-center rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[10.5px] font-bold text-ink-3">
      Level
    </span>
  )

  return (
    <div className="py-4">
      {/* ── The label, in the gutter on desktop and above the row on a phone.
          Putting it in the centre column is what makes the two sides read as
          one measurement taken twice rather than as two separate readouts. */}
      <div className={cn(SPLIT, 'items-center gap-x-2')}>
        <p className="hidden justify-end lg:flex">
          {assessed && edge === 'subject' ? aheadPill('subject') : null}
        </p>
        <p className="col-span-3 text-center text-sm font-semibold text-ink lg:col-span-1">
          {label}
        </p>
        <p className="hidden justify-start lg:flex">
          {assessed && edge === 'rival' ? aheadPill('rival') : null}
        </p>
      </div>

      {/* On a phone the edge is one centred line under the label, because two
          side labels at 360px leave nothing for the bars. */}
      <p className="mt-1 flex justify-center lg:hidden">
        {!assessed
          ? <span className="text-xs text-ink-3">Not assessed</span>
          : edge === 'level'
            ? levelPill
            : aheadPill(edge)}
      </p>
      <p className="mt-1 hidden justify-center lg:flex">
        {!assessed ? <span className="text-xs text-ink-3">Not assessed</span> : edge === 'level' ? levelPill : null}
      </p>

      {/* ── The bars. Mirrored about the centre column, one 0–100 scale.
          Drawn with scaleX from the centre outwards rather than by animating
          width: five simultaneous width transitions inside a stagger is five
          layout passes, on the mid-range Android this product is used on.
          A row nobody assessed draws NOTHING — an even 50/50 under the word
          "Level" is a finding of parity on a question never asked. */}
      {assessed ? (
        <div className={cn(SPLIT, 'mt-2.5 items-center')}>
          {/* Subject: the figure at the outer end, the bar reaching from the
              centre line toward it, so number and shape read as one thing. The
              bar itself is a full-width track — the 0–100 scale drawn as a soft
              rail the way every reference board does — with a fill whose
              gradient runs soft-at-centre to full-at-tip. The figure is exposed
              to screen readers (the bars stay aria-hidden); it is the model's
              placement, named as such in the label. */}
          <span className="flex items-center gap-2">
            <span
              className="num w-8 shrink-0 text-right text-sm font-bold text-ink"
              aria-label={`${subjectName}: placed at ${subjectScore} out of 100`}
            >
              {subjectScore}
            </span>
            <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]" aria-hidden="true">
              <span
                className="absolute inset-y-0 right-0 w-full origin-right rounded-full transition-transform duration-500"
                style={{
                  transform: `scaleX(${subjectScore / 100})`,
                  background: `linear-gradient(to left, color-mix(in oklab, ${SERIES.subject} 55%, transparent), ${SERIES.subject})`,
                }}
              />
            </span>
          </span>
          <span className="flex justify-center" aria-hidden="true">
            <span className="h-5 w-0.5 rounded-full bg-[var(--rule)]" />
          </span>
          <span className="flex items-center gap-2">
            <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]" aria-hidden="true">
              <span
                className="absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-500"
                style={{
                  transform: `scaleX(${rivalScore / 100})`,
                  background: `linear-gradient(to right, color-mix(in oklab, ${SERIES.rival} 55%, transparent), ${SERIES.rival})`,
                }}
              />
            </span>
            <span
              className="num w-8 shrink-0 text-left text-sm font-bold text-ink"
              aria-label={`${rivalName}: placed at ${rivalScore} out of 100`}
            >
              {rivalScore}
            </span>
          </span>
        </div>
      ) : null}

      {/* ── The evidence. The reason the row exists; the bars only say which of
          the two paragraphs to read first. Two columns from lg up, straddling
          the same gutter. Below that they unfold into stacked blocks, each
          carrying its person's colour as a rail AND that person's name — the
          colour alone must never be the only thing saying whose words these
          are. */}
      {(subjectNote || rivalNote) && (
        <>
          <div className={cn(SPLIT, 'mt-3 hidden gap-x-2 lg:grid')}>
            <p className="text-right text-sm leading-relaxed text-ink-2">
              {subjectNote || <span className="text-ink-3">Nothing found on this.</span>}
            </p>
            <span aria-hidden />
            <p className="text-left text-sm leading-relaxed text-ink-2">
              {rivalNote || <span className="text-ink-3">Nothing found on this.</span>}
            </p>
          </div>

          <div className="mt-3 space-y-2 lg:hidden">
            {[
              { who: subjectName, note: subjectNote, colour: SERIES.subject },
              { who: rivalName, note: rivalNote, colour: SERIES.rival },
            ].map((side) => (
              <div
                key={side.who}
                className="rounded-r-xl border-l-2 bg-[var(--surface-2)] py-2.5 pl-3 pr-3"
                style={{ borderColor: side.colour }}
              >
                <p className="kicker">{side.who}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">
                  {side.note || <span className="text-ink-3">Nothing found on this.</span>}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * The control in the middle. A real button, not a label.
 *
 * It carries the one action this screen has, and which action that is depends
 * on what the screen is showing: nothing has been read yet, something is being
 * read, or a reading is on screen and could be taken again. A decorative "vs"
 * would leave the reader hunting for the verb at the bottom of the page.
 */
function VsControl({
  state,
  onRun,
}: {
  state: 'idle' | 'busy' | 'done'
  onRun: () => void
}) {
  const label = state === 'busy' ? 'Reading…' : state === 'done' ? 'Read again' : 'Compare'

  return (
    <span className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onRun}
        disabled={state === 'busy'}
        aria-label={
          state === 'busy'
            ? 'Reading the record on both people'
            : state === 'done'
              ? 'Read the record again'
              : 'Compare these two people'
        }
        aria-busy={state === 'busy'}
        className={cn(
          // 48px, because this is the primary control on a screen used on a
          // phone held in one hand.
          'grid size-12 place-items-center rounded-full text-[11px] font-bold uppercase tracking-[0.08em]',
          'transition-[filter,background-color]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
          state === 'busy'
            ? 'cursor-wait bg-[var(--surface-3)] text-ink-3'
            : 'text-white shadow-[var(--e2)] hover:brightness-110',
        )}
        style={
          state === 'busy'
            ? undefined
            : { background: 'var(--accent)' }  /* Was accent-to-accent-2, which is the
               blue-into-purple sweep that reads as generated. One accent,
               flat: the banner is already carrying meaning through its
               content and does not need decoration to be noticed. */
        }
      >
        {state === 'busy' ? (
          <RefreshCw size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          'vs'
        )}
      </button>
      <span className="text-center text-[11px] font-medium leading-tight text-ink-3">{label}</span>
    </span>
  )
}

/* ── the screen ──────────────────────────────────────────────────────────── */

export function HeadToHead({
  identity,
  rival,
  onClose,
  onOpenActions,
}: {
  identity: Identity
  rival: RivalRef
  onClose: () => void
  /** Take the reader to the task list. Absent means no route from here. */
  onOpenActions?: () => void
}) {
  const [phase, setPhase] = useState<'idle' | 'searching' | 'structuring'>('idle')
  const [result, setResult] = useState<CompareResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Whose record is being read right now, so the wait names a person. */
  const [reading, setReading] = useState<string | null>(null)
  const [showTable, setShowTable] = useState(false)
  const [rivalPhoto, setRivalPhoto] = useState<string | null>(rival.photoUrl ?? null)
  const [filed, setFiled] = useState(false)
  /** The comparison currently in flight, so a second one can cancel it. */
  const inflight = useRef<AbortController | null>(null)

  const subjectLines = useMemo(
    () => [identity.role, identity.constituency, identity.party].filter((x): x is string => Boolean(x)),
    [identity],
  )
  const rivalLines = useMemo(
    () => [rival.role, rival.constituency, rival.party].filter((x): x is string => Boolean(x)),
    [rival],
  )

  /**
   * The dimensions the radar can plot — only the ones the search actually placed
   * both people on. An unassessed row has no score, and a needle pinned to zero
   * would read as "measured at zero" rather than "never asked". A radar also
   * needs a closed shape, so the chart is drawn only when at least three
   * dimensions survived; below that the mirrored bars carry it alone.
   */
  const radarDims = useMemo(
    () => (result?.dimensions ?? []).filter((d) => d.assessed !== false),
    [result],
  )

  /**
   * Find a photograph of the rival.
   *
   * The same index the setup search uses, so a face on this screen comes from
   * the same place as the face on the identity card rather than from a model
   * being asked for an image URL — which produces confident, plausible, dead
   * links. Failing quietly is correct: the comparison is not about the photo,
   * and the portrait falls back to a ringed placeholder.
   */
  useEffect(() => {
    if (rivalPhoto || !rival.name) return
    let live = true
    void (async () => {
      try {
        const res = await fetch(`/api/identity/search?q=${encodeURIComponent(rival.name)}`)
        if (!res.ok) return
        const body = (await res.json()) as { candidates?: { thumbnail?: string | null; person?: boolean }[] }
        const hit = (body.candidates ?? []).find((c) => c.person && c.thumbnail)
        if (live && hit?.thumbnail) setRivalPhoto(hit.thumbnail)
      } catch {
        // No photo. The portrait already handles that.
      }
    })()
    return () => {
      live = false
    }
  }, [rival.name, rivalPhoto])

  /**
   * Run the comparison.
   *
   * Two calls, because grounded search and a JSON schema cannot be asked for in
   * the same request and doing both server-side ran past the runtime's hard
   * thirty seconds — which spent the search and returned nothing. Splitting it
   * also lets the screen say which half is running, and "Reading the record"
   * followed by "Weighing it up" is a better forty seconds than one spinner.
   */
  const run = useCallback(async () => {
    const subject = {
      name: identity.name,
      role: identity.role,
      constituency: identity.constituency,
      state: identity.state,
      party: identity.party,
    }
    const other = {
      name: rival.name,
      role: rival.role ?? null,
      constituency: rival.constituency ?? null,
      state: rival.state ?? identity.state,
      party: rival.party ?? null,
    }

    /**
     * One run at a time, and only the newest one may land.
     *
     * Without this the effect below fired twice on mount — React re-invokes
     * effects in development — and the screen made TWO identical grounded
     * searches for the same pair. That is two Gemini calls billed for one
     * question, and worse: they run concurrently, compete, and each finishes
     * slower than one would alone. Measured locally, one search returned in
     * 22s while a competing pair pushed past the runtime's limit and both
     * failed. The user saw "Could not reach the server" for a search that
     * worked when it was not racing itself.
     *
     * Aborting also stops a slow answer for the PREVIOUS opponent arriving
     * after somebody has switched to a new one and overwriting the screen
     * with the wrong person's comparison.
     */
    inflight.current?.abort()
    const ctl = new AbortController()
    inflight.current = ctl
    const mine = () => inflight.current === ctl

    setError(null)
    setResult(null)
    setFiled(false)
    setPhase('searching')

    /**
     * One person per request, one after the other.
     *
     * This used to be a single call that researched both people. Measured
     * against the local runtime, which kills a function at 30s whatever
     * netlify.toml says, that call failed two times in four: a well-covered
     * politician alone takes 18-30s to research, and two of them in one
     * request do not fit. The screen reported it as a dead network.
     *
     * Running the two halves CONCURRENTLY was tried and is worse, not better.
     * Two long invocations at once overwhelmed the dev server: six rounds
     * produced six failures, and twice a reply arrived on the wrong socket,
     * answering about the subject on the request that had asked about the
     * rival. Sequentially, six rounds produced six successes. Each request
     * gets a whole timeout budget to itself, which is the point.
     *
     * The cost is that the office waits for the sum rather than the slower of
     * the two. That is the right trade against a comparison that half the time
     * did not arrive at all, and the screen names whoever is being read so the
     * wait is legible rather than blank.
     */
    const readOne = async (
      who: 'subject' | 'rival',
      person: { name: string },
    ): Promise<{ notes: string; sources: unknown } | null> => {
      const already = cachedNotes(person.name)
      if (already) return already
      setReading(person.name)
      const res = await fetchWithTimeout('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'search', who, [who]: person }),
        signal: ctl.signal,
      })

      /**
       * Read as text first.
       *
       * When the runtime kills a function mid-flight it answers with a stack
       * trace, not JSON, and `res.json()` throws. That throw landed in the
       * catch below and was reported as "Could not reach the server", which
       * is how a working search that simply ran long came to look like a
       * network fault. It is a timeout, and it now says so.
       */
      const body = await res.text()
      if (!mine()) return null
      type SearchReply = {
        who?: string
        name?: string
        notes?: string | null
        sources?: unknown
        error?: string
      }
      let parsed: SearchReply | null = null
      try {
        parsed = JSON.parse(body) as SearchReply
      } catch {
        setError(
          `Reading the record on ${person.name} took too long and the server gave up. ` +
            'Heavily covered people take longer. Try again.',
        )
        return null
      }

      if (!res.ok || parsed?.error || !parsed?.notes) {
        setError(parsed?.error ?? `The web search did not answer for ${person.name}.`)
        return null
      }

      // Whose notes are these? See the note on the echo in compare.mts.
      if (parsed.who && parsed.who !== who) {
        setError(
          'The server answered about the wrong person. Try again, and if it keeps happening, ' +
            'reload the page.',
        )
        return null
      }

      const sources = (parsed.sources ?? []) as unknown[]
      rememberNotes(person.name, parsed.notes, sources)
      return { notes: parsed.notes, sources }
    }

    try {
      const a = await readOne('subject', subject)
      if (!mine() || !a) return
      const b = await readOne('rival', other)
      if (!mine() || !b) return

      const found = {
        notes: `${a.notes}\n\n${b.notes}`,
        sources: [...(a.sources as unknown[]), ...(b.sources as unknown[])],
      }

      setReading(null)
      setPhase('structuring')
      const structured = await fetchWithTimeout('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'structure',
          subject,
          rival: other,
          notes: found.notes,
          sources: found.sources ?? [],
        }),
        signal: ctl.signal,
      })
      const parsed = (await structured.json()) as CompareResult & { error?: string }
      if (!mine()) return
      if (!structured.ok || parsed.error) {
        setError(parsed.error ?? 'The comparison could not be assembled.')
        return
      }
      setResult(parsed)
    } catch (err) {
      // An abort is this component cancelling itself — a newer run started, or
      // the screen closed. It is not a failure and must not be reported as one.
      if (err instanceof DOMException && err.name === 'AbortError') return
      // A genuine transport failure. Anything the server answered, however
      // badly, has already been handled above with a message that says what
      // actually went wrong.
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      if (mine()) setPhase('idle')
    }
  }, [identity, rival])

  // Run on open. Somebody who picked a name to compare against has already
  // asked the question; making them press a second button to ask it again is
  // the kind of step that gets read as the app not working.
  //
  // The cleanup aborts whatever is in flight, so React's development
  // double-invoke cancels its first run instead of leaving two searches
  // racing each other.
  useEffect(() => {
    void run()
    return () => inflight.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rival.name])

  const busy = phase !== 'idle'
  const sourceId = `compare:${identity.name}:${rival.name}`

  /** File the recommended move as a task, with its channel and its lines. */
  const file = useCallback(() => {
    if (!result?.move) return
    const ok = fileFreeAction({
      action: result.move.action,
      rationale: result.move.rationale,
      talkingPoints: result.move.talkingPoints,
      priority: 'High',
      // A comparison gap is answered in public, and 'Local press' is the one
      // channel in the vocabulary that every office in this product has.
      channel: 'Local press',
      source: {
        id: sourceId,
        headline: `Against ${rival.name}`,
        subject: identity.name,
        raisedFrom: 'comparison',
      },
    })
    setFiled(ok || hasOpenAction(sourceId))
  }, [result, identity.name, rival.name, sourceId])

  return (
    <m.section variants={fadeUp} className="space-y-4">
      <SectionTitle
        eyebrow="Head to head"
        hint="From published coverage."
      >
        {identity.name} against {rival.name}
      </SectionTitle>

      <Card>
        {/* ── The split ──────────────────────────────────────────────────
            Two sides and a control between them, on the same grid every row
            below uses. The kickers are what stop the reader having to
            remember which colour is whose: "yours" and "against" say it in
            words, the rail says it again in colour, and the ring on each
            portrait ties both back to the bars. */}
        <div className={cn(SPLIT, 'items-center gap-x-2')}>
          <div className="min-w-0">
            <p className="kicker mb-2">Yours</p>
            <span
              className="mb-2.5 block h-[3px] w-full rounded-full"
              style={{
                background: `linear-gradient(to right, ${SERIES.subject}, color-mix(in oklab, ${SERIES.subject} 35%, transparent))`,
              }}
              aria-hidden
            />
            <Portrait
              name={identity.name}
              photoUrl={identity.photoUrl}
              lines={subjectLines}
              colour="var(--vs-subject)"
              align="left"
            />
          </div>

          <div className="flex justify-center">
            <VsControl
              state={busy ? 'busy' : result ? 'done' : 'idle'}
              onRun={() => void run()}
            />
          </div>

          <div className="min-w-0">
            <p className="kicker mb-2 text-right">Against</p>
            <span
              className="mb-2.5 block h-[3px] w-full rounded-full"
              style={{
                background: `linear-gradient(to left, ${SERIES.rival}, color-mix(in oklab, ${SERIES.rival} 35%, transparent))`,
              }}
              aria-hidden
            />
            <Portrait
              name={rival.name}
              photoUrl={rivalPhoto}
              lines={rivalLines}
              colour="var(--vs-rival)"
              align="right"
            />
          </div>
        </div>

        {busy && (
          <div className="mt-5 space-y-2 rounded-2xl bg-[var(--surface-2)] p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-ink-2">
              <RefreshCw size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
              {phase === 'searching'
                ? reading
                  ? `Reading what has been published about ${reading}…`
                  : `Reading the published record…`
                : 'Weighing it up…'}
            </p>
            <p className="text-xs leading-relaxed text-ink-3">
              {/* Named rather than vague. The two people are read one after the
                  other, so a blank minute is really two halves, and saying
                  whose half is running is the difference between waiting and
                  wondering whether it has hung. */}
              Each person is read separately, so this takes up to a minute.
            </p>
          </div>
        )}

        {error && !busy && (
          <div className="mt-5 rounded-2xl bg-[var(--neg-soft)] p-4">
            <p role="alert" className="text-sm leading-relaxed text-[var(--neg)]">
              {error}
            </p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => void run()}>
              <RefreshCw size={14} />
              Try again
            </Button>
          </div>
        )}

        {result && !busy && (
          <>
            {result.verdict && (
              <div className="mt-5 rounded-2xl border-l-[3px] border-[var(--accent)] bg-[var(--accent-soft)] p-4">
                <p className="text-[15px] leading-relaxed text-ink">{result.verdict}</p>
              </div>
            )}

            {/* ── The shape, above the bars ──────────────────────────────
                A radar across every assessed dimension at once. The bars below
                say each figure precisely; this says the overall shape — where
                one person bulges and the other caves — in a single read. Two
                series only, in the same two colours as everything else on the
                screen, so no new key has to be learned. Its own premium panel
                because the shape is a finding in its own right, not a footnote
                to the bars. */}
            {radarDims.length >= 3 && (
              <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--e1)] sm:p-5">
                <div className="flex items-start gap-3">
                  <span
                    className="icon-badge"
                    style={{ background: 'var(--accent-2-soft)', color: 'var(--accent-2)' }}
                  >
                    <Radar size={18} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold text-ink">The shape of it</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
                      Both people across every dimension at once.
                    </p>
                  </div>
                </div>
                <div className="mx-auto mt-2 max-w-[340px]">
                  <RadarChart
                    axes={radarDims.map((d) => d.label)}
                    max={100}
                    series={[
                      {
                        name: identity.name,
                        color: SERIES.subject,
                        values: radarDims.map((d) => d.subjectScore),
                      },
                      {
                        name: rival.name,
                        color: SERIES.rival,
                        values: radarDims.map((d) => d.rivalScore),
                      },
                    ]}
                  />
                </div>
              </div>
            )}

            {/* Legend. Always present for two series — identity must never
                depend on matching a colour to a photograph ring alone. */}
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <Legend
                items={[
                  { label: identity.name, color: SERIES.subject },
                  { label: rival.name, color: SERIES.rival },
                ]}
              />
              <button
                type="button"
                onClick={() => setShowTable((v) => !v)}
                className="ml-auto flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-ink-3 transition-colors hover:bg-[var(--surface-2)] hover:text-ink"
              >
                <Table2 size={13} aria-hidden />
                {showTable ? 'Hide the table' : 'Show the table'}
              </button>
            </div>

            <div className="mt-1 divide-y divide-[var(--rule)]">
              {result.dimensions.map((d) => (
                <DimensionRow
                  key={d.key}
                  dimension={d}
                  subjectName={identity.name}
                  rivalName={rival.name}
                />
              ))}
            </div>

            {/* The table. Required so nothing is gated behind colour or bar
                length, and it is where the numbers live — printed once, in a
                place that shows them for the estimates they are. */}
            {showTable && (
              <div className="mt-3 overflow-x-auto rounded-2xl bg-[var(--surface-2)] p-4">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--rule)] text-ink-3">
                      <th scope="col" className="py-1.5 pr-3 font-medium">
                        Measure
                      </th>
                      <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                        {identity.name}
                      </th>
                      <th scope="col" className="py-1.5 text-right font-medium">
                        {rival.name}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.dimensions.map((d) => (
                      <tr key={d.key} className="border-b border-[var(--rule)] last:border-0">
                        <th scope="row" className="py-1.5 pr-3 font-normal text-ink-2">
                          {d.label}
                        </th>
                        <td className="num py-1.5 pr-3 text-right text-ink">{d.subjectScore}</td>
                        <td className="num py-1.5 text-right text-ink">{d.rivalScore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── What each of them has that the other does not ─────────── */}
            {(result.subject.strengths.length > 0 || result.rival.strengths.length > 0) && (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 sm:gap-4">
                {[
                  { who: identity.name, list: result.subject.strengths, colour: SERIES.subject },
                  { who: rival.name, list: result.rival.strengths, colour: SERIES.rival },
                ].map((side) => (
                  <div key={side.who} className="rounded-2xl bg-[var(--surface-2)] p-4">
                    <p className="flex items-center gap-1.5 text-xs font-bold text-ink">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: side.colour }} />
                      {side.who} has
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {side.list.length === 0 ? (
                        <li className="text-xs text-ink-3">Nothing the record separates them on.</li>
                      ) : (
                        side.list.map((s) => (
                          <li key={s} className="text-xs leading-relaxed text-ink-2">
                            {s}
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      {/* ── What to do about it ────────────────────────────────────────── */}
      {result && !busy && (result.gaps.length > 0 || result.move) && (
        <Card tone="accent">
          <div className="flex items-center gap-3">
            <span
              className="icon-badge"
              style={{ background: 'var(--accent-2-soft)', color: 'var(--accent-2)' }}
            >
              <Lightbulb size={18} aria-hidden />
            </span>
            <p className="text-[15px] font-bold">What to do about it</p>
          </div>

          {result.gaps.length > 0 && (
            <ol className="mt-3 space-y-2">
              {result.gaps.map((gap, i) => (
                <li key={gap} className="flex gap-2.5 text-sm leading-relaxed text-ink">
                  <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] text-[var(--accent)]">
                    {i + 1}
                  </span>
                  {gap}
                </li>
              ))}
            </ol>
          )}

          {result.move && (
            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="text-sm font-semibold text-ink">{result.move.action}</p>
              {result.move.rationale && (
                <p className="mt-1 text-xs leading-relaxed text-ink-2">{result.move.rationale}</p>
              )}
              {result.move.talkingPoints.length > 0 && (
                <ul className="mt-2.5 space-y-1.5">
                  {result.move.talkingPoints.map((p) => (
                    <li
                      key={p}
                      className="rounded-xl bg-[var(--surface-2)] px-3 py-2 text-xs leading-relaxed text-ink-2"
                    >
                      “{p}”
                    </li>
                  ))}
                </ul>
              )}
              {/*
                Filed already? Then the useful control is a way back to it.

                This slot held a disabled button reading "Already in
                Actions", which is a dead end: it states a fact and offers
                nothing. Somebody who has just filed a task wants to see it,
                and somebody returning to this screen wants to know what
                became of it. Both are one press away now.
              */}
              {filed ? (
                <Button
                  size="sm"
                  className="mt-3"
                  variant="outline"
                  disabled={!onOpenActions}
                  onClick={() => {
                    const id = actionIdForSource(readStore().actions, sourceId)
                    if (id) requestActionFocus(id)
                    onOpenActions?.()
                  }}
                >
                  <ArrowRight size={14} />
                  Check the task
                </Button>
              ) : (
              <Button
                size="sm"
                className="mt-3"
                variant="primary"
                onClick={file}
              >
                <ListPlus size={14} />
                Add to Actions
              </Button>
              )}
            </div>
          )}
        </Card>
      )}

      {/* ── Where it came from, and what it is not ─────────────────────── */}
      {result && !busy && (
        <Card>
          <p className="kicker mb-3">Where this came from</p>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={result.confidence === 'well-covered' ? 'positive' : 'warning'}>
              {result.confidence === 'well-covered'
                ? 'Well covered'
                : result.confidence === 'moderate'
                  ? 'Moderately covered'
                  : 'Thinly covered'}
            </Chip>
            <span className="text-xs text-ink-3">
              {result.sources.length} {result.sources.length === 1 ? 'source' : 'sources'}
            </span>
          </div>

          {result.sources.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {result.sources.map((s) => (
                <li key={s.title + (s.url ?? '')} className="truncate text-xs">
                  {s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--accent)] hover:underline"
                    >
                      {s.title}
                    </a>
                  ) : (
                    <span className="text-ink-2">{s.title}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <ul className="mt-3 space-y-1.5">
            {result.caveats.map((c) => (
              <li
                key={c}
                className="flex items-start gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2 text-xs leading-relaxed text-ink-3"
              >
                <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                {c}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Only the way out. Compare and Read again both moved into the VS
          control between the two people — one verb, in the one place the eye
          already goes, rather than the same action offered twice on one
          screen. */}
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Back to the list
        </Button>
      </div>
    </m.section>
  )
}
