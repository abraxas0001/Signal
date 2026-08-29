import { useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Eye,
  Landmark,
  Link2,
  Loader2,
  Pencil,
  Search,
  Sparkles,
  UserRound,
} from 'lucide-react'
import type { Identity } from '@shared/identity'
import { statedIdentity } from '@shared/identity'
import {
  editField,
  looksLikeUrl,
  resolveIdentity,
  saveIdentity,
  skipOnboarding,
  type PersonCandidate,
} from '@/lib/identity'
import { useStore } from '@/lib/store'
import { Avatar, Button, Card, Chip, Shell, SignalGlyph } from './ui'
import { CardHead } from '@/components/kit'
import { IdentityRows } from './IdentityEditor'
import { DeskDoor } from './DeskDoor'
import { applyDeskPlan, describePlan, planDesk } from '@/lib/autoconfig'
import { cn } from '@/lib/utils'
import { fadeUp, listStagger } from '@/lib/motion'

/**
 * The first screen anybody sees.
 *
 * What was here before was a box asking for a link to a social media post. That
 * is the right screen for somebody who already knows what this tool does and
 * has a specific post in mind. It is the wrong one for the office it was built
 * for: a member's staff opening it on a Monday morning does not have a link,
 * they have a name, and the question they came with is "what is being said
 * about us".
 *
 * So this asks who you are first, and the rest of the product configures itself
 * from the answer — the news scan gets its search terms, the dashboard gets a
 * face and a seat, and the greeting stops being generic.
 *
 * Two ways in, and both work on a deployment with nothing configured:
 *
 *   1. Paste a public profile link. What a public figure with public handles
 *      will reach for, and it needs no credentials of any kind.
 *   2. Type it in. Always available, never slower for somebody who knows their
 *      own details, and the only one that works with no network at all.
 *
 * Connecting a real social account is deliberately NOT offered here. It needs
 * an administrator to have registered an application with the platform and set
 * a shared key on the deployment, and a first-run screen that opens with a
 * control most people cannot use — and cannot tell whether they are supposed to
 * be able to use — is a screen that teaches them the product is broken. It is
 * offered from the dashboard afterwards, where the office can see what it would
 * add to what they already have.
 *
 * Nothing here is mandatory. Skip lands on the same dashboard with less on it,
 * because a setup wizard that cannot be dismissed is how a tool gets abandoned
 * before it has shown anybody anything.
 */

type Step = 'choose' | 'working' | 'review'


export function Onboarding({
  onDone,
  onDemo,
}: {
  onDone: () => void
  /** Open the example desk. Absent when the dataset is not deployed. */
  onDemo?: () => void
}) {
  /**
   * The desk already on the device, if there is one.
   *
   * Distinguishes the two ways this screen is reached: a genuine first run,
   * where there is nothing to go back to, and "edit my details" from the
   * dashboard or Settings, which clears the onboarding stamp to get here and
   * leaves the saved identity untouched. Only the second gets a way out.
   */
  const existing = useStore().identity

  const reduce = useReducedMotion() === true

  const [step, setStep] = useState<Step>('choose')
  const [mode, setMode] = useState<'link' | 'manual'>('link')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Identity | null>(null)

  const [results, setResults] = useState<PersonCandidate[] | null>(null)
  const [searching, setSearching] = useState(false)

  // What the "type it in" path collects. Deliberately four fields: a name, what
  // they do, where, and which party. Anything more is a form, and a form is
  // what people close.
  const [manual, setManual] = useState({ name: '', role: 'MLA', constituency: '', state: '' })

  const urlRef = useRef<HTMLInputElement>(null)

  /* ── searching ────────────────────────────────────────────────────────── */

  /**
   * Look the name up while it is being typed.
   *
   * Debounced at 350ms and floored at three characters, because the index is
   * somebody else's public API and one search per keystroke is both rude and
   * useless — the results for "dk a" are noise the reader has to scroll past to
   * reach the results for "dk aruna".
   *
   * An address is not searched at all. Somebody who pastes a profile link has
   * already told us exactly who they mean, and running a full-text search on a
   * URL returns nothing while looking like the box is broken.
   */
  useEffect(() => {
    const raw = query.trim()

    if (raw.length < 3 || looksLikeUrl(raw)) {
      setResults(null)
      setSearching(false)
      return
    }

    setSearching(true)
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/identity/search?q=${encodeURIComponent(raw)}`)
          if (!res.ok) throw new Error(String(res.status))
          const payload = (await res.json()) as { candidates?: PersonCandidate[] }
          if (!cancelled) setResults(payload.candidates ?? [])
        } catch {
          // A failed lookup is not an error the reader needs to see: the box
          // still accepts a link, and "use what I typed" needs no index.
          if (!cancelled) setResults([])
        } finally {
          if (!cancelled) setSearching(false)
        }
      })()
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  /* ── resolving ────────────────────────────────────────────────────────── */

  const lookUp = async (input: { url?: string; name?: string; role?: string; constituency?: string; state?: string }) => {
    setError(null)
    setStep('working')

    const { identity, error: failure } = await resolveIdentity(input)

    if (identity) {
      setDraft(identity)
      setStep('review')
      return
    }

    // A failed lookup is not a dead end. If we know enough to build a card from
    // what they typed, we go to review with that rather than sending them back
    // to the start having lost their typing.
    if (input.name) {
      setDraft(
        statedIdentity({
          name: input.name,
          role: input.role ?? null,
          constituency: input.constituency ?? null,
          state: input.state ?? null,
        }),
      )
      setError(failure)
      setStep('review')
      return
    }

    setError(failure)
    setStep('choose')
  }

  /**
   * What the box does when it is submitted rather than picked from.
   *
   * One box, two meanings, decided by what was typed — the browser address bar
   * pattern. A link resolves directly, because it is unambiguous. A name goes
   * in as a name, which is the "none of these is right, use what I typed" path
   * and the only one that works for the many sitting members who have no
   * encyclopaedia article at all.
   */
  const submitQuery = () => {
    const trimmed = query.trim()
    if (!trimmed) {
      setError('Type a name, or paste a link to a public profile.')
      urlRef.current?.focus()
      return
    }
    if (looksLikeUrl(trimmed)) {
      void lookUp({ url: trimmed })
      return
    }
    void lookUp({ name: trimmed })
  }

  /** A suggestion was chosen: resolve against that exact page. */
  const pick = (candidate: PersonCandidate) => {
    setResults(null)
    void lookUp({ url: candidate.url, name: candidate.name })
  }

  const submitManual = () => {
    const name = manual.name.trim()
    if (!name) {
      setError('A name is the one thing this cannot work without.')
      return
    }
    void lookUp({
      name,
      role: manual.role.trim() || undefined,
      constituency: manual.constituency.trim() || undefined,
      state: manual.state.trim() || undefined,
    })
  }

  const confirm = () => {
    if (!draft) return
    saveIdentity(draft)
    onDone()
  }

  const skip = () => {
    skipOnboarding()
    onDone()
  }

  /* ═════════════════════════════════════════════════════════════════════ */

  return (
    <div className="min-h-screen-safe overflow-y-auto">
      <Shell className="page-end pt-[max(1.5rem,var(--sat))]">
        {/* The masthead, so this screen belongs to the same product as the one
            behind it. It was a bare form, which reads as a survey. */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-[var(--accent)]">
              <SignalGlyph size={26} />
            </span>
            <span className="hed text-[1.4rem] leading-none tracking-[-0.005em]">Signal</span>
          </div>

          {/* The way out, for somebody who already has a desk.
              This screen is reached two ways: first run, and "edit my
              details" — which clears the onboarding stamp to get here. On the
              second path the only exit was a link reading "Skip for now — I
              just want to read a link", which is first-run wording and reads
              as though leaving would abandon the desk. It does not:
              `skipOnboarding` re-stamps the date and never touches the saved
              identity. So when there is a desk to go back to, say so. */}
          {existing && (
            <Button variant="ghost" size="sm" onClick={skip}>
              <ArrowLeft size={15} aria-hidden />
              Back
            </Button>
          )}
        </div>

        {step === 'review' && draft ? (
          <Review
            identity={draft}
            note={error}
            onChange={setDraft}
            onBack={() => {
              setError(null)
              setStep('choose')
            }}
            onConfirm={confirm}
          />
        ) : (
          <m.div
            /*
              Two columns from lg up.

              As one centred column this screen was a 736px strip of controls
              in the middle of a 1440px window, which is the exact complaint
              the layout pass was supposed to fix — it looked like the app had
              not noticed the screen. The standing text sits left, the things
              you operate sit right, and on a phone it collapses back to the
              single column it always was.
            */
            className="mt-8 grid gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:items-start"
            variants={listStagger}
            initial={reduce ? false : 'hidden'}
            animate="show"
          >
            {/*
              On a phone the single column puts the search card first: the card
              carries its own "Who is this desk for?" label, so leading with the
              standing text pushed the one control that does the work below the
              fold. From lg up the written order returns — text left, card right.
            */}
            <m.header
              variants={fadeUp}
              className="order-2 lg:order-1 lg:sticky lg:top-[calc(var(--topbar-h)+2rem)]"
            >
              <StepPills current={1} />
              <h1 className="hed mt-5 text-[clamp(2rem,1.5rem+2.2vw,2.9rem)] leading-[1.05]">
                Whose desk is this?
              </h1>
              <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-ink-2">
                Name the person this desk is for. The news scan, the watch words and the
                dashboard configure themselves from the answer.
              </p>

              <div className="mt-7 border-t border-[var(--rule)] pt-5">
                {/* The two ways past this form, on one line and correctly
                    weighted. The demo led as a full-bleed bar across the
                    column, which made the loudest thing on the screen an
                    aside; the skip link sat above it underlined like a
                    footnote. Now: one solid action, one quiet one, side by
                    side, with the form itself still the primary path. */}
                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
                  {onDemo !== undefined && !existing && (
                    <button
                      type="button"
                      onClick={onDemo}
                      className={cn(
                        'group inline-flex min-h-12 items-center gap-2.5 rounded-full pl-4 pr-5',
                        'bg-[var(--accent-2)] text-[15px] font-semibold text-[var(--accent-fg)]',
                        'shadow-[0_1px_2px_rgb(16_24_40/0.08),0_8px_20px_-8px_color-mix(in_oklab,var(--accent-2)_55%,transparent)]',
                        'transition-[transform,box-shadow,filter] duration-200 ease-out',
                        'hover:-translate-y-0.5 hover:brightness-[1.07]',
                        'hover:shadow-[0_2px_4px_rgb(16_24_40/0.1),0_14px_28px_-10px_color-mix(in_oklab,var(--accent-2)_65%,transparent)]',
                        'active:translate-y-0 active:brightness-95',
                      )}
                    >
                      <Eye size={17} aria-hidden />
                      Try the demo
                      <ChevronRight
                        size={16}
                        className="transition-transform duration-200 group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </button>
                  )}
                  {/* The handed-over desk's door, for the member whose office
                      issued them credentials: their first screen is this one,
                      so the way into their own desk sits beside the demo, at
                      the same weight. The quiet skip drops below the pair. */}
                  <div className="w-full max-w-sm sm:w-auto">
                    <DeskDoor onOpened={() => window.location.reload()} />
                  </div>
                </div>

                <button
                  onClick={skip}
                  className="mt-4 inline-flex min-h-11 items-center text-left text-sm font-medium text-ink-3 transition-colors hover:text-ink-2"
                >
                  {existing ? `Keep ${existing.name}` : 'Skip for now'}
                </button>
              </div>
            </m.header>

            <div className="stack order-1 min-w-0 lg:order-2">

            {error && step === 'choose' && (
              <m.div variants={fadeUp} role="alert">
                <Notice tone="negative">{error}</Notice>
              </m.div>
            )}

            {step === 'working' ? (
              <m.div variants={fadeUp}>
                <Working />
              </m.div>
            ) : (
              <>
                {/* ── the two typed routes ──────────────────────────────── */}
                <m.section variants={fadeUp}>
                  {/* The hero card: the one lifted panel on this screen, so
                      the eye lands on the box that does the work. */}
                  <Card level="lift">
                  <div
                    role="tablist"
                    aria-label="How to identify this desk"
                    /* Same guard StepPills wears: two labelled pills brush the
                       edge of a 375px card, and a strip that cannot scroll
                       widens the whole page instead. */
                    className="pill-tabs max-w-full overflow-x-auto"
                  >
                    {(
                      [
                        ['link', 'Search by name'],
                        ['manual', 'Type the details'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        role="tab"
                        aria-selected={mode === id}
                        onClick={() => {
                          setMode(id)
                          setError(null)
                        }}
                        className="pill-tab min-h-11"
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-5">
                    {mode === 'link' ? (
                      <div>
                        <label htmlFor="person-query" className="text-sm font-medium">
                          Who is this desk for?
                        </label>
                        <p className="mt-1 text-sm leading-relaxed text-ink-2">
                          Add the seat if the name is a common one. A link to a public
                          profile works too.
                        </p>

                        <div className="relative mt-3">
                          <div
                            className={cn(
                              'flex items-stretch overflow-hidden rounded-full border bg-[var(--surface)] shadow-[var(--e1)]',
                              'transition-[border-color] duration-200',
                              error
                                ? 'border-[var(--neg)]'
                                : 'border-[var(--border-interactive)] focus-within:border-[var(--accent)]',
                            )}
                          >
                            <span className="grid w-12 shrink-0 place-items-center text-ink-3">
                              {searching ? (
                                <Loader2 size={17} className="animate-spin" aria-hidden />
                              ) : (
                                <Search size={17} aria-hidden />
                              )}
                            </span>
                            <input
                              id="person-query"
                              ref={urlRef}
                              type="text"
                              autoComplete="off"
                              autoCapitalize="words"
                              spellCheck={false}
                              enterKeyHint="search"
                              role="combobox"
                              aria-expanded={results !== null && results.length > 0}
                              aria-controls="person-results"
                              aria-autocomplete="list"
                              value={query}
                              onChange={(e) => {
                                setQuery(e.target.value)
                                if (error) setError(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') submitQuery()
                                if (e.key === 'Escape') setResults(null)
                              }}
                              placeholder="e.g. D. K. Aruna, MP Mahabubnagar"
                              className="h-14 min-w-0 flex-1 bg-transparent pr-5 text-[16px] outline-none placeholder:text-ink-3"
                            />
                          </div>

                          {/* Suggestions.
                              Rendered in the flow rather than as a floating
                              popover: this screen has nothing below it that a
                              list would cover, and a popover would need focus
                              management, an outside-click handler and a
                              z-index for no gain. */}
                          {results !== null && (
                            <div
                              id="person-results"
                              role="listbox"
                              aria-label="Matching people"
                              className="mt-2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--e2)]"
                            >
                              {results.length === 0 ? (
                                <p className="px-3 py-3 text-sm leading-relaxed text-ink-2">
                                  Nobody by that name was found. Press Enter to use the name you
                                  typed.
                                </p>
                              ) : (
                                <ul className="space-y-0.5">
                                  {results.map((candidate) => (
                                    <li key={candidate.url}>
                                      <button
                                        role="option"
                                        aria-selected={false}
                                        onClick={() => pick(candidate)}
                                        className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
                                      >
                                        <Avatar
                                          src={candidate.thumbnail}
                                          name={candidate.name}
                                          size={40}
                                        />
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate text-sm font-semibold">
                                            {candidate.name}
                                          </span>
                                          <span className="block truncate text-xs text-ink-3">
                                            {candidate.description ??
                                              (candidate.person ? 'Person' : 'Page')}
                                          </span>
                                        </span>
                                        {/* Places and constituencies still get
                                            offered, because the index is not
                                            always right about which is which —
                                            but they are marked, so nobody sets
                                            their desk up as a district. */}
                                        {!candidate.person && (
                                          <Chip tone="neutral" className="shrink-0">
                                            not a person
                                          </Chip>
                                        )}
                                        {/* Decorative on a phone: the whole row
                                            is the button, and at 375px this
                                            pill was eating the name it labels.
                                            The arrow alone carries the
                                            affordance there. */}
                                        <span className="hidden shrink-0 items-center gap-1 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-ink-2 shadow-[var(--e1)] sm:inline-flex">
                                          Choose
                                          <ArrowRight size={12} aria-hidden />
                                        </span>
                                        <ArrowRight
                                          size={14}
                                          aria-hidden
                                          className="shrink-0 text-ink-3 sm:hidden"
                                        />
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>

                        <Button onClick={submitQuery} size="lg" className="mt-3 w-full sm:w-auto">
                          <Sparkles size={17} />
                          {results && results.length > 0 ? 'Use what I typed' : 'Find my details'}
                          <ArrowRight size={17} />
                        </Button>
                      </div>
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field
                          id="m-name"
                          label="Full name"
                          placeholder="e.g. Kotagiri Sridhar"
                          value={manual.name}
                          onChange={(v) => setManual((s) => ({ ...s, name: v }))}
                          Icon={UserRound}
                          autoFocus
                        />
                        <Field
                          id="m-role"
                          label="Office held"
                          placeholder="MLA"
                          value={manual.role}
                          onChange={(v) => setManual((s) => ({ ...s, role: v }))}
                          Icon={Landmark}
                        />
                        <Field
                          id="m-constituency"
                          label="Constituency"
                          placeholder="e.g. Eluru"
                          value={manual.constituency}
                          onChange={(v) => setManual((s) => ({ ...s, constituency: v }))}
                          Icon={Building2}
                        />
                        <Field
                          id="m-state"
                          label="State"
                          placeholder="e.g. Andhra Pradesh"
                          value={manual.state}
                          onChange={(v) => setManual((s) => ({ ...s, state: v }))}
                          Icon={Building2}
                        />

                        <div className="sm:col-span-2">
                          <Button onClick={submitManual} size="lg" className="w-full sm:w-auto">
                            <Sparkles size={17} />
                            Set up the desk
                            <ArrowRight size={17} />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  </Card>
                </m.section>

              </>
            )}
            </div>
          </m.div>
        )}
      </Shell>
    </div>
  )
}

/* ── review ──────────────────────────────────────────────────────────────── */

/**
 * What we found, before it becomes the app's answer to "who are you".
 *
 * This screen exists because of the one failure this feature can produce that
 * the office would not notice: a plausible, fluent, wrong answer. Every field
 * is editable in place and anything the reading was unsure of is marked, so the
 * correction takes one tap at the only moment somebody is actually looking.
 */
function Review({
  identity,
  note,
  onChange,
  onBack,
  onConfirm,
}: {
  identity: Identity
  /** A failure that still produced something worth reviewing. */
  note: string | null
  onChange: (next: Identity) => void
  onBack: () => void
  onConfirm: () => void
}) {
  const reduce = useReducedMotion() === true

  // Recomputed on every edit, so correcting the district in the rows below
  // visibly changes which papers get read. That feedback is the whole argument
  // for showing the plan here rather than after the fact: it is what makes the
  // constituency field feel like it matters, because it does.
  const plan = useMemo(() => planDesk(identity), [identity])

  return (
    <m.div
      className="stack mt-8"
      variants={listStagger}
      initial={reduce ? false : 'hidden'}
      animate="show"
    >
      <m.header variants={fadeUp}>
        <StepPills current={2} />
        <h1 className="hed mt-5 text-[clamp(1.9rem,1.5rem+1.8vw,2.6rem)] leading-[1.05]">
          Is this right?
        </h1>
        <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-ink-2">
          Correct anything that is wrong. Tap a value to edit it. What you type is treated
          as certain; what we read is not.
        </p>
      </m.header>

      {note && (
        <m.div variants={fadeUp} role="status">
          <Notice tone="warning">{note}</Notice>
        </m.div>
      )}

      <m.div variants={fadeUp}>
        <Card level="lift">
          <div className="flex items-start gap-4">
            <Avatar src={identity.photoUrl} name={identity.name} size={72} />
            <div className="min-w-0 flex-1">
              <p className="hed text-[1.6rem] leading-tight">{identity.name}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
                {[identity.role, identity.constituency, identity.party]
                  .filter(Boolean)
                  .join(' · ') || 'No office or seat recorded yet.'}
              </p>
              {identity.photoUrl === null && (
                <p className="mt-2 text-xs text-ink-3">
                  No photograph was found. The dashboard uses your initials instead.
                </p>
              )}
            </div>
          </div>

          {identity.bio && (
            <p className="mt-4 border-t border-[var(--rule)] pt-4 text-sm leading-relaxed text-ink-2">
              {identity.bio}
            </p>
          )}
        </Card>
      </m.div>

      <m.div variants={fadeUp}>
        <Card padded={false}>
          <IdentityRows
            identity={identity}
            onEdit={(field, next) => onChange(editField(identity, field, next))}
          />
        </Card>
      </m.div>

      {identity.sources.length > 0 && (
        <m.div variants={fadeUp}>
          <p className="kicker">Read from</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {identity.sources.map((source) => (
              <li key={source.url ?? source.label}>
                {source.url ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-xs font-medium text-ink-2 shadow-[var(--e1)] hover:border-[var(--border-interactive)] hover:text-ink"
                  >
                    {source.label}
                    <ExternalLink size={12} aria-hidden />
                  </a>
                ) : (
                  <Chip>{source.label}</Chip>
                )}
              </li>
            ))}
          </ul>
        </m.div>
      )}

      {identity.notes.length > 0 && (
        <m.ul variants={fadeUp} className="space-y-2">
          {identity.notes.map((line) => (
            <li key={line} className="flex gap-2 text-sm leading-relaxed text-ink-2">
              <CircleAlert size={15} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </m.ul>
      )}

      <m.div variants={fadeUp} className="flex flex-wrap items-center gap-2 border-t border-[var(--rule)] pt-5">
        <Button onClick={onConfirm} size="lg">
          Looks right: open my dashboard
          <ArrowRight size={17} />
        </Button>
        <Button onClick={onBack} variant="ghost" size="lg">
          <ArrowLeft size={16} />
          Start again
        </Button>
      </m.div>
    </m.div>
  )
}

/* ── small parts ─────────────────────────────────────────────────────────── */

/**
 * Where you are in the two-step setup, worn as the pill vocabulary every
 * other switcher in the product now uses. Purely presentational: the step
 * itself lives in the screen's existing state, and these pills are not
 * buttons — progression here is earned, not tapped.
 */
function StepPills({ current }: { current: 1 | 2 }) {
  const steps = ['Who this is for', 'Confirm the details'] as const
  return (
    <div
      className="pill-tabs max-w-full overflow-x-auto"
      role="group"
      aria-label={`Setup step ${current} of 2`}
    >
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2
        return (
          <span
            key={label}
            aria-current={n === current ? 'step' : undefined}
            className={cn(
              'pill-tab inline-flex items-center gap-2',
              n === current && 'is-active',
            )}
          >
            <span
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                n === current
                  ? 'bg-[color-mix(in_oklab,var(--accent-fg)_22%,transparent)] text-[var(--accent-fg)]'
                  : 'bg-[var(--surface-3)] text-ink-3',
              )}
            >
              {n}
            </span>
            {label}
          </span>
        )
      })}
    </div>
  )
}

function Field({
  id,
  label,
  placeholder,
  value,
  onChange,
  Icon,
  autoFocus,
}: {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  Icon: typeof UserRound
  autoFocus?: boolean
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="mt-1.5 flex items-stretch overflow-hidden rounded-full border border-[var(--border-interactive)] bg-[var(--surface)] shadow-[var(--e1)] transition-colors focus-within:border-[var(--accent)]">
        <span className="grid w-11 shrink-0 place-items-center text-ink-3">
          <Icon size={16} aria-hidden />
        </span>
        <input
          id={id}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-12 min-w-0 flex-1 bg-transparent pr-4 text-[16px] outline-none placeholder:text-ink-3"
        />
      </div>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'warning' | 'negative'; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        'flex items-start gap-2.5 rounded-[var(--radius-md)] border px-3.5 py-3 text-sm leading-relaxed',
        tone === 'negative'
          ? 'border-[color-mix(in_oklab,var(--neg)_30%,transparent)] bg-[var(--neg-soft)] text-[var(--neg)]'
          : 'border-[color-mix(in_oklab,var(--warn)_30%,transparent)] bg-[var(--warn-soft)] text-[var(--warn)]',
      )}
    >
      <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

/**
 * What the screen does while three pages and a model are being read.
 *
 * The steps are named rather than shown as a bar, because this genuinely takes
 * ten to twenty seconds and an unlabelled bar at that length reads as a hang.
 */
function Working() {
  const steps = [
    'Reading the page you gave',
    'Looking for a public record of the seat',
    'Putting the card together',
  ]
  const [active, setActive] = useState(0)

  useEffect(() => {
    // Advances on a timer rather than on real progress: the endpoint answers
    // once, at the end. The last step is never marked done here — that happens
    // when the response actually lands.
    const timer = setInterval(() => setActive((n) => Math.min(n + 1, steps.length - 1)), 4200)
    return () => clearInterval(timer)
  }, [steps.length])

  return (
    <Card level="lift">
      <CardHead
        icon={<Loader2 size={15} className="animate-spin" aria-hidden />}
        title="Finding your details…"
        sub="Takes 10 to 20 seconds"
        tint="blue"
      />
      <ol className="mt-4 space-y-2.5">
        {steps.map((label, i) => (
          <li
            key={label}
            className={cn(
              'flex items-center gap-2.5 text-sm transition-colors',
              i < active ? 'text-ink-3' : i === active ? 'text-ink' : 'text-ink-3 opacity-55',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                i <= active ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]',
              )}
            />
            {label}
          </li>
        ))}
      </ol>
    </Card>
  )
}
