import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  Filter,
  Hash,
  Inbox,
  Info,
  Layers,
  LoaderCircle,
  MapPin,
  Megaphone,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import type { FakeSignal, GrievanceRecord, IssueCluster } from '@shared/grievance'
import { bySeverityThenRecency } from '@shared/grievance'
import { partyAbbreviation, type Identity } from '@shared/identity'
import { placeVariants, resolvePlace } from '@shared/places'
import { planTerms } from '@/lib/autoconfig'
import {
  formatDeskDay,
  groupByDay,
  isToday,
  recordDeskDay,
  recordsOnDay,
  shiftDay,
  todayDeskDay,
} from '@/lib/desk-day'
import { downloadGrievanceCsv } from '@/lib/grievance-export'
/* THE MASCOT IS OFF THIS HEADER. The reference sets the desk's name as plain
   bold type with nothing beside it, and a robot next to "Grievance desk" was
   the loudest thing on a screen whose subject is other people's complaints.
   The scan's state — the one thing the mascot carried — is reported by
   ScanProgress, directly under the control that starts it. */
import { WINDOWS, inWindow, presentAnchor, windowStart, type WindowId } from '@/lib/window'
import type {
  ActionPriority,
  ConfidenceTier,
  FakeSuspicion,
  Sentiment,
  Severity,
  Topic,
} from '@shared/taxonomy'
import { SENTIMENT_SCORE, SEVERITIES, SEVERITY_RANK } from '@shared/taxonomy'
import { Button, Card, Chip, PageHeader, selectClass, type ChipTone } from './ui'
import { CardHead } from '@/components/kit'
/**
 * The desk's own configuration — papers, words, links — lives in the shared
 * settings module now, because Settings renders the identical panel inside
 * its "Grievance desk settings" section. One component, two doors.
 */
import { DeskSetup, useDeskProfile } from '@/components/settings/DeskConfig'
import { KeywordsPanel } from '@/components/grievance/KeywordsPanel'
import { TalkAbout } from '@/components/grievance/TalkAbout'
import { IssuesTable } from '@/components/grievance/IssuesTable'
import { LevelPips } from './charts'
import { update, useStore } from '@/lib/store'
import { absoluteDate, cn, hostOf, isIndicScript, pluralise } from '@/lib/utils'
import { fadeUp, haptic, listItem, listStaggerFast, spring } from '@/lib/motion'
/**
 * The sync is a module-level job, not component state, and that is the point.
 * See src/lib/scan-job.ts: this screen starts it, watches it and can stop it,
 * but unmounting this screen no longer touches it.
 */
import {
  cancel as cancelScanJob,
  dismiss as dismissScanJob,
  findStories,
  publisherFor,
  start as startScanJob,
  useScanJob,
  type ScanTargets,
} from '@/lib/scan-job'
import { ScanProgress } from '@/components/ScanProgress'
import {
  fetchSuggestions,
  readSuggestions,
  saveSuggestions,
  type SuggestionEntry,
  type SuggestionPerson,
} from '@/lib/suggest'
import { useBackToDismiss } from '@/lib/nav-history'
import {
  countVerdicts,
  describeVerdict,
  needsLabel,
  readVerdicts,
  verdictFor,
  worthShowing,
  type Verdict,
} from '@/lib/news-relevance'

/**
 * The grievance desk.
 *
 * The office does not receive one link at a time. It receives a WhatsApp list
 * every morning, so the intake is a box you paste the whole list into — the
 * one-URL-at-a-time form we started with was abandoned after watching someone
 * do it eleven times before giving up.
 *
 * The filters are the reason this screen exists at all. The ask was never "show
 * me the news" — it was "show me the grievances for Nuzvid, about water, that
 * name this officer", and every one of those has to combine with the others.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   The seam with the server

   It was here: the parsers, the streaming batch reader, the merge that writes
   each record as it lands, and the one that recognises a publisher by host. It
   is now in src/lib/scan-job.ts, carried over whole rather than rewritten,
   because the run that uses it no longer belongs to this screen. Leaving it
   here would have meant a sync that survives unmount only as far as the first
   function this file owns.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   Intake parsing
   ═══════════════════════════════════════════════════════════════════════════ */

interface DraftLink {
  url: string
  host: string
  /** The publisher's name when we recognise the host, null when we do not. */
  publisher: string | null
}

/**
 * Split whatever was pasted into links.
 *
 * Splitting on any whitespace or comma rather than on newlines alone: a
 * WhatsApp list copied out of the app arrives with the links run together on
 * one line as often as not.
 */
function parseDraft(draft: string): { links: DraftLink[]; unusable: string[] } {
  const links: DraftLink[] = []
  const unusable: string[] = []
  const seen = new Set<string>()

  for (const token of draft.split(/[\s,]+/)) {
    const raw = token.trim()
    if (!raw) continue

    let parsed: URL | null = null
    try {
      parsed = new URL(raw)
    } catch {
      parsed = null
    }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      unusable.push(raw)
      continue
    }

    const url = parsed.toString()
    // The same story is forwarded three times in a group chat. It is one record.
    if (seen.has(url)) continue
    seen.add(url)
    const host = parsed.hostname.replace(/^www\./, '')
    links.push({ url, host, publisher: publisherFor(host) })
  }

  return { links, unusable }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Presentation vocabulary

   Severity is carried by a stripe AND a word, everywhere. Nothing on this
   screen may be readable by colour alone — it is read outdoors, on cheap
   screens, by people who are not all trichromats.
   ═══════════════════════════════════════════════════════════════════════════ */

const SEVERITY_COLOUR: Record<Severity, string> = {
  Low: 'var(--border-strong)',
  Medium: 'var(--info)',
  High: 'var(--warn)',
  Critical: 'var(--neg)',
}

const SEVERITY_TONE: Record<Severity, ChipTone> = {
  Low: 'neutral',
  Medium: 'info',
  High: 'warning',
  Critical: 'negative',
}

const SUSPICION_TONE: Record<FakeSuspicion, ChipTone> = {
  No: 'neutral',
  Unsure: 'warning',
  Likely: 'warning',
  Yes: 'negative',
}

/**
 * The workbook's vocabulary is No / Unsure / Likely / Yes, which reads as
 * gibberish on a list row — "Fake: yes" and "Fake: unsure" are answers to a
 * question the row never asked. The stored value stays the vocabulary; only
 * the row says it in words.
 */
const SUSPICION_LABEL: Record<FakeSuspicion, string> = {
  No: 'Looks genuine',
  Unsure: 'Might be fake',
  Likely: 'Likely fake',
  Yes: 'Fake',
}

const PRIORITY_TONE: Record<ActionPriority, ChipTone> = {
  Low: 'neutral',
  Medium: 'info',
  High: 'warning',
  Critical: 'negative',
}

const SIGNAL_LABEL: Record<FakeSignal['kind'], string> = {
  provenance: 'Where it came from',
  recirculation: 'Seen before',
  source: 'The source',
  consistency: 'Internal consistency',
  corroboration: 'Corroboration',
}

const SUPPORTS_LABEL: Record<FakeSignal['supports'], string> = {
  authentic: 'Points to real',
  fabricated: 'Points to fake',
  inconclusive: 'Settles nothing',
}

const SUPPORTS_TONE: Record<FakeSignal['supports'], ChipTone> = {
  authentic: 'positive',
  fabricated: 'negative',
  inconclusive: 'neutral',
}

const CONFIDENCE_LABEL: Record<ConfidenceTier, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

const sentimentTone = (sentiment: Sentiment): ChipTone => {
  const score = SENTIMENT_SCORE[sentiment]
  return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral'
}

/** Joins the parts of a meta line, dropping the ones nobody told us. */
const metaLine = (...parts: (string | null)[]): string =>
  parts.filter((p): p is string => p !== null && p !== '').join(' · ')

const normaliseTag = (tag: string): string => tag.replace(/^#+/, '').toLowerCase()

const dateLabel = (record: GrievanceRecord): string =>
  record.publishedAt ? absoluteDate(record.publishedAt) : 'No date given'

/* ═══════════════════════════════════════════════════════════════════════════
   Filtering the issues

   The records view has had filters since the beginning; the issues view never
   did, because it was the smaller half of a tabbed screen. Now that issues ARE
   the screen, a desk with thirty of them has no way to ask the one question it
   opens the app with: what is critical, in my seat, that somebody might have
   made up.

   Deliberately four axes and no more. Every additional filter is a control that
   must be read past to reach the list, and the list is the point. Everything
   excluded is noted at the bottom of this block.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface IssueFilters {
  text: string
  /** OR within: any selected severity matches. Empty means any. */
  severities: Severity[]
  /** A single Topic, or '' for any. */
  category: string
  /** Only issues backed by a record somebody should check. */
  flagged: boolean
}

const NO_ISSUE_FILTERS: IssueFilters = {
  text: '',
  severities: [],
  category: '',
  flagged: false,
}

/*
  Deliberately excluded, each for a reason:

  · sentiment — an issue's sentiment is almost always Negative on a grievance
    desk, so the filter would divide thirty issues into thirty and zero.
  · constituency — a desk covers one seat. The field exists, but filtering a
    single-seat desk by seat is a control that never changes anything.
  · target, grievanceType, narrativeCategory, recommendation.* — all record-level
    and would each need the same join as `flagged` above. Real, but they are the
    fifth through eighth controls on a bar that should have four.
  · date — issues are not day-scoped the way records are (see the `issues` memo),
    so a day stepper here would silently contradict the one on the records view.
*/

/** Issues arrive ranked by the server; an unranked one sorts last, not first. */
const issueRank = (issue: IssueCluster): number =>
  issue.rank > 0 ? issue.rank : Number.MAX_SAFE_INTEGER

/* ═══════════════════════════════════════════════════════════════════════════
   Screen
   ═══════════════════════════════════════════════════════════════════════════ */

/* Per-link progress used to be component state here, alongside a `running`
   flag and an AbortController in a ref. All three are now the job's, because
   all three used to die with the screen. See src/lib/scan-job.ts. */

interface Filters {
  constituency: string
  topic: string
  severity: string
  person: string
  hashtag: string
  text: string
}

const NO_FILTERS: Filters = {
  constituency: '',
  topic: '',
  severity: '',
  person: '',
  hashtag: '',
  text: '',
}

const TABS = ['records', 'issues'] as const
type Tab = (typeof TABS)[number]

/**
 * Which half of the desk this screen is showing.
 *
 * The two halves were tabs on one screen and they are not the same job. Intake
 * is configuration and clerical work — choose the mastheads, set the words,
 * paste links, read them — done occasionally by whoever administers the desk.
 * Issues are the output, read every morning by somebody who never needs to see
 * the plumbing.
 *
 * Putting them behind tabs meant the person who wanted this week's issues
 * landed on a records list and a portal picker, and the person configuring the
 * desk had to know that "Grievances" was where the settings lived.
 */
export type DeskMode = 'issues' | 'records'

/**
 * The words that must not stand alone as evidence.
 *
 * `planTerms` already works this out and calls it `corroborating`, and until
 * now nothing read it: `applyDeskPlan` persists only `watchTerms`, so the
 * distinction the planner drew was thrown away before any scan saw it, and a
 * bare surname went to the scanner with the same standing as the member's full
 * name. Recomputed here from the identity the desk actually holds, so the
 * scanner is told which of its own terms are corroboration rather than proof.
 *
 * The party stays in the list whatever the planner says, because that is the
 * one this call site has always sent and losing it would widen the net rather
 * than narrow it.
 */
function corroboratingTerms(
  identity: Identity | null,
  profile: { district?: string | null; constituency?: string | null; state?: string | null } | null,
  party: string | null,
): string[] {
  const out = new Set<string>()
  if (party) out.add(party)
  if (identity) {
    try {
      const place = resolvePlace({
        state: profile?.state ?? identity.state ?? null,
        district: profile?.district ?? null,
        constituency: profile?.constituency ?? identity.constituency ?? null,
      })
      for (const term of planTerms(identity, place).corroborating) out.add(term)
    } catch {
      // A planner that cannot read this identity is not a reason to scan with
      // no broad terms at all; the party alone is the behaviour this had before.
    }
  }
  return [...out]
}

/**
 * Every spelling of this desk's own ground, for the relevance judge.
 *
 * Deliberately narrow. It answers "which words on a page mean this seat" and
 * nothing more, and every word in it comes from something the office itself
 * configured: the district, the constituency, their registry spellings, and
 * any watch term that the shared place registry recognises as a real place. A
 * term the office typed that is not a place stays out, because a person's name
 * offered to the judge as geography is the bug this was written to end.
 */
function placesFor(
  district: string | null,
  constituency: string | null,
  state: string | null,
  watchTerms: readonly string[],
): string[] {
  const out = new Set<string>()
  const add = (v: string | null | undefined): void => {
    const t = (v ?? '').trim()
    if (t.length > 2) out.add(t)
  }

  add(district)
  add(constituency)

  const resolved = resolvePlace({ state, district, constituency })
  for (const v of placeVariants(resolved.districtMatch, district)) add(v)
  add(resolved.district)

  // A watch term earns its place only by resolving to one. "Aruna" does not.
  for (const term of watchTerms) {
    const t = term.trim()
    if (t.length < 3) continue
    const hit = resolvePlace({ state, district: t })
    if (hit.districtMatch) {
      add(t)
      for (const v of placeVariants(hit.districtMatch, t)) add(v)
    }
  }

  return [...out]
}

/**
 * What the relevance rule set aside today, counted and revealable.
 *
 * The rule the office asked for is sharp: their name, or their seat on
 * something an elected member is actually needed for. A sharp rule is wrong
 * sometimes, and a desk that quietly shrinks the morning's work gives nobody
 * any way to notice. So nothing is deleted, the reasons are broken out, and
 * one press puts every set-aside story back on screen with its verdict on it.
 */
function SetAside({
  counts,
  revealed,
  onToggle,
}: {
  counts: ReturnType<typeof countVerdicts>
  revealed: boolean
  onToggle: () => void
}) {
  if (counts.hidden === 0) return null

  const reasons: string[] = []
  if (counts.seatRoutine > 0) {
    reasons.push(`${counts.seatRoutine} in your district with nothing for you to act on`)
  }
  if (counts.aboutParty > 0) {
    reasons.push(
      `${counts.aboutParty} about party business away from your seat`,
    )
  }
  if (counts.unrelated > 0) reasons.push(`${counts.unrelated} read and ruled out`)
  const swept = counts.hidden - counts.seatRoutine - counts.aboutParty - counts.unrelated
  if (swept > 0) reasons.push(`${swept} swept up by the papers scan and never checked`)

  return (
    <Card level="quiet" className="mt-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-2">
          <span className="font-semibold text-ink">
            {counts.hidden} {pluralise(counts.hidden, 'story', 'stories')} set aside
          </span>{' '}
          as not this desk&rsquo;s business: {reasons.join(', ')}. Nothing was deleted.
        </p>
        <Button size="sm" variant="outline" onClick={onToggle} className="shrink-0">
          {revealed ? 'Hide them again' : 'Show what was set aside'}
        </Button>
      </div>
    </Card>
  )
}

/** The judge's ruling on one story, where it is not simply "about you". */
function RelevanceChip({ verdict }: { verdict: Verdict }) {
  if (!needsLabel(verdict)) return null
  const { label, meaning } = describeVerdict(verdict)
  const tone: ChipTone | undefined =
    verdict.verdict === 'about-seat'
      ? 'accent'
      : verdict.verdict === 'unjudged'
        ? undefined
        : 'warning'
  return (
    <span title={verdict.why ? `${meaning} ${verdict.why}` : meaning}>
      <Chip tone={tone}>{label}</Chip>
    </span>
  )
}

/**
 * The info mark that carries a header's detail.
 *
 * The reference puts one beside the desk's subtitle, and this desk has
 * something real to put in it: the day's tally, which used to BE the subtitle
 * and pushed the sentence saying what the screen is off the header entirely.
 *
 * It opens on a press as well as answering a hover, because `title` alone is
 * nothing on a touch screen and this desk is read on a phone. The note lands
 * inline, in the sentence it belongs to, rather than in a floating layer that
 * would have to be positioned, dismissed and kept on screen.
 */
/**
 * The reference's numbered marker, on the top edge of the card it names.
 *
 * IT IS A CAPTION, SO IT IS DRAWN AS ONE. This was a strip of two spans above
 * the pair of cards: no role, no tabindex, no handler, one painted as a
 * selected tab and the other as a disabled one. Nothing was ever switchable —
 * both cards render at once — so the strip advertised a control that did not
 * exist, and its "disabled" half told the reader the second card was
 * unavailable while that card sat open beside it. Both markers are identical
 * now, neither reads as pressed, and each one sits over the card it actually
 * names rather than both sitting over the first.
 */
function StepMark({ n, label }: { n: number; label: string }) {
  return (
    <span className="inline-flex h-10 max-w-full items-center gap-2 rounded-t-[10px] border border-b-0 border-[var(--border)] bg-[var(--surface)] px-4 text-[13px] font-semibold text-ink">
      <span className="tnum grid size-[21px] shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[11px] text-[var(--accent-fg)]">
        {n}
      </span>
      <span className="truncate">{label}</span>
    </span>
  )
}

function InfoMark({ note }: { note: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={note}
        aria-label={note}
        aria-expanded={open}
        className={cn(
          'ml-1 inline-grid size-[18px] translate-y-[3px] place-items-center rounded-full transition-colors',
          open ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-ink-3 hover:text-ink',
        )}
      >
        <Info size={14} aria-hidden />
      </button>
      {open && <span className="text-ink-3"> {note}</span>}
    </>
  )
}

/**
 * "Export report" — the reference's header control, on this desk's own data.
 *
 * It writes the sheet through `downloadGrievanceCsv`, the export this desk
 * already owns, rather than a second one written for a button. CSV rather than
 * the workbook because this desk is mostly read on a phone, where a .xlsx
 * needs an app that is often not installed.
 *
 * What it exports is every record inside the header's WINDOW. That is not
 * always what the table shows: the table's own dropdowns — topic, source,
 * severity, place — live inside IssuesTable and never reach here, so a
 * filtered table can read "Nothing matches all of those filters" while this
 * button still writes the whole window. The file is the right thing to
 * produce; the button's hover says which set it is, so the two cannot be
 * read as the same. The
 * button says what it produces on hover, and says so when it fails: an export
 * that throws silently is the failure this app has already had once.
 */
function ExportReport({ records, windowName }: { records: GrievanceRecord[]; windowName: string }) {
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clear = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (clear.current) clearTimeout(clear.current)
    },
    [],
  )

  const empty = records.length === 0
  const rows = `${records.length} ${pluralise(records.length, 'record')}`

  const press = (): void => {
    setError(null)
    try {
      downloadGrievanceCsv(records, windowName)
      setSaved(true)
      clear.current = setTimeout(() => setSaved(false), 2400)
    } catch (cause) {
      setSaved(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  /*
   * THE HINT NAMES WHAT THE FILE HOLDS, WHICH IS THE WINDOW, NOT THE TABLE.
   *
   * It said "the N on screen", and it is not: the table's own dropdowns —
   * topic, source, severity, place — live inside IssuesTable and never reach
   * here, so filtering to Health + Eenadu could leave the table reading
   * "Nothing matches all of those filters" while this button still wrote
   * every record in the window. The file is right; the sentence was wrong.
   *
   * The empty hint had the same fault in reverse: on an empty desk at All
   * time it blamed the window ("no record falls inside all time") for a desk
   * that simply holds nothing.
   */
  const hint = empty
    ? windowName.toLowerCase() === 'all time'
      ? 'Nothing to export: this desk holds no records yet.'
      : `Nothing to export: no record on this desk falls inside ${windowName.toLowerCase()}.`
    : error
      ? `Could not build the file: ${error}`
      : `Download every record inside ${windowName.toLowerCase()} as a CSV file — the window, not the table's filters`

  return (
    <Button size="sm" variant="outline" onClick={press} disabled={empty} title={hint} aria-label={hint}>
      {saved ? <Check size={15} className="text-[var(--pos)]" /> : <Download size={15} />}
      {error ? 'Could not save' : saved ? 'Saved' : 'Export report'}
      {error && (
        <span role="alert" className="sr-only">
          {hint}
        </span>
      )}
    </Button>
  )
}

export function Grievances({
  onClose,
  mode = 'issues',
  embedded = false,
  focusIssueId = null,
  onOpenNextPost,
}: {
  onClose: () => void
  mode?: DeskMode
  /** True when rendered inside Settings, which carries its own desk config. */
  embedded?: boolean
  /** Opens the full "what to post next" plan, from the desk's talk-about panel. */
  onOpenNextPost?: () => void
  /**
   * An issue to open on arrival.
   *
   * Set when somebody clicked that issue on the dashboard. Without it the click
   * dropped them at the top of a list and left them to find the thing they had
   * just pointed at, which on a desk with a dozen issues is a search.
   */
  focusIssueId?: string | null
}) {
  const store = useStore()
  const reduced = useReducedMotion()

  // The profile values and writes, from the one module that owns them. Here
  // for the pencil's configuration card; Settings renders the same values
  // through the same hook, so there is one set of writes to get wrong.
  const deskConfig = useDeskProfile()

  /**
   * Whether the desk's configuration is on screen.
   *
   * Papers, watch words and the district are chosen once; rendered
   * permanently they pushed the day's records below the fold every morning.
   * They live behind the pencil, on THIS screen, in place — the pencil used
   * to route to Settings, which took the reader off the desk to configure
   * the desk. An unconfigured desk shows the setup regardless: with no
   * papers chosen there is nothing else this screen can do.
   */
  const [editing, setEditing] = useState(false)

  // Fixed by the mode rather than chosen on screen. `setTab` survives because
  // reading a batch of links still switches the intake view to its results.
  const [tab, setTab] = useState<Tab>(mode === 'records' ? 'records' : 'issues')

  /**
   * Bring the issue somebody clicked into view.
   *
   * Ringed as well as scrolled: on a long list, scrolling alone leaves a reader
   * unsure whether the app understood which one they meant.
   */
  const focusRef = useRef<HTMLLIElement | null>(null)
  useEffect(() => {
    if (!focusIssueId) return
    const timer = setTimeout(
      () => focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      120,
    )
    return () => clearTimeout(timer)
  }, [focusIssueId])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)

  const [draft, setDraft] = useState('')
  // Open on a fresh device, because on a fresh device it is the whole screen.
  const [intakeOpen, setIntakeOpen] = useState(() => store.grievances.length === 0)

  /**
   * The sync, watched rather than owned.
   *
   * There was an AbortController in a ref here and, beneath it,
   * `useEffect(() => () => abortRef.current?.abort(), [])`. That line is gone
   * and must not come back: unmounting this screen is not a decision to stop
   * reading, and treating it as one is exactly how a reader who tapped Back
   * mid-sync lost every story still in flight and every story still queued,
   * silently. The run lives in the module now; this only subscribes to it, and
   * arriving halfway through shows the stage it is on rather than a dead
   * button.
   */
  const job = useScanJob()
  const running = job.status === 'scanning' || job.status === 'reading'

  const allRecords = useMemo(
    () => [...store.grievances].sort((a, b) => bySeverityThenRecency(SEVERITY_RANK, a, b)),
    [store.grievances],
  )

  /**
   * What the judge said about each record's source story.
   *
   * The relevance verdicts have been written to a cache on every scan since
   * the feature was built, and until now this screen never read them. The
   * office's complaint was exactly that: a desk that opens on a district
   * paper's whole front page, over a filter that existed, ran and was ignored.
   *
   * Judged against the desk's own subject, so a cache written about somebody
   * else is discarded rather than applied.
   */
  const verdicts = useMemo(
    () => readVerdicts(store.identity?.name ?? null),
    [store.identity?.name, store.grievances],
  )
  const verdictOf = useCallback(
    (r: GrievanceRecord): Verdict => verdictFor(r.sourceUrl, verdicts),
    [verdicts],
  )

  /**
   * Whether the office asked to see this at all.
   *
   * Records already on the desk were filed before this filter existed and
   * carry no verdict, so they read as `unjudged`. That is shown rather than
   * hidden: nothing checked them, and hiding a record on the strength of a
   * judgement nobody made would be the same mistake in the other direction.
   */
  const [showSetAside, setShowSetAside] = useState(false)
  const onDesk = useCallback(
    (r: GrievanceRecord) => worthShowing(verdictOf(r)),
    [verdictOf],
  )

  const records = useMemo(
    () => (showSetAside ? allRecords : allRecords.filter(onDesk)),
    [allRecords, onDesk, showSetAside],
  )

  /** The desk day being looked at. Declared here because the issue list
      below is scoped to it, not only the record list further down. */
  const [day, setDay] = useState(() => todayDeskDay())

  /**
   * How far back the screen reaches — the header's window.
   *
   * The reference carries one and it has to be real: a picker that changes
   * nothing is worse than no picker, because it tells the office a cut was
   * applied when none was. So it cuts BOTH cards. The issues table is handed
   * only the records inside it, and the suggestion column is handed the set of
   * issues that still have a record inside it.
   *
   * The app's own window vocabulary, from src/lib/window.ts, rather than a
   * fifth one invented here — the same four labels the dashboard offers, so
   * "Last 7 days" means the same thing on both screens.
   *
   * Thirty days rather than the reference's seven. The reference is a mockup
   * and its default is part of its invented content; ours has to be a default
   * that shows this desk what it holds. A desk whose last scan ran eight days
   * ago would open on an empty table under a working pager, and read as broken.
   */
  const [windowId, setWindowId] = useState<WindowId>('month')
  const windowFrom = useMemo(() => windowStart(presentAnchor(), windowId), [windowId])
  const windowName = useMemo(
    () => WINDOWS.find((w) => w.id === windowId)?.label ?? 'All time',
    [windowId],
  )

  const issues = useMemo(
    () =>
      [...store.issues].sort(
        (a, b) => issueRank(a) - issueRank(b) || b.recordIds.length - a.recordIds.length,
      ),
    [store.issues],
  )

  // Every record ever filed, so an issue can still resolve the records behind
  // it when the desk has stepped to another day.
  const byId = useMemo(() => new Map(allRecords.map((r) => [r.id, r])), [allRecords])

  /**
   * Issues on the day being looked at.
   *
   * These were not day-scoped at all, and the comment above issueRank said so
   * as though it were a decision. It was not survivable: the day stepper sits
   * directly above this list, so a desk reading "Today, Friday 21 August"
   * listed an issue whose only record was printed on the tenth. The office
   * cannot tell that from a story that broke this morning.
   *
   * An issue belongs to a day when any record behind it does. One that ran
   * across three days therefore shows on all three, which is right: it was
   * live on all three, and the date line on the card says so.
   *
   * Records this device no longer holds cannot place an issue on any day. An
   * issue whose backing has all been cleared is shown rather than hidden, so
   * clearing a day cannot silently delete an issue from every view at once.
   */
  const dayIssues = useMemo(
    () =>
      issues.filter((issue) => {
        const held = issue.recordIds.map((id) => byId.get(id)).filter(Boolean) as GrievanceRecord[]
        if (held.length === 0) return true
        // An issue is the office's business when ANY story behind it is. A
        // cluster whose every record was set aside is set aside with them,
        // and reappears the moment the reveal is switched on.
        if (!showSetAside && !held.some(onDesk)) return false
        return held.some((r) => recordDeskDay(r) === day)
      }),
    [issues, byId, day, onDesk, showSetAside],
  )

  /**
   * The day the desk is reading, and the records filed on it.
   *
   * Everything below — the filters, their options, the list, the export — works
   * on the day rather than on the whole archive. A desk that shows every record
   * ever filed stops being a day's work within a week, and the filter dropdowns
   * fill with constituencies and names from months ago.
   *
   * Nothing is deleted when the day moves. A record filed on Monday is still
   * the evidence on Friday; it is simply not today's business.
   */
  const dayRecords = useMemo(() => recordsOnDay(records, day), [records, day])

  /**
   * The records the header's window leaves standing — what the table lists.
   *
   * Dated by the same rule the day buckets use: the publication date when the
   * story carries one, the filing date when it does not. A record with neither
   * falls outside every window but "All time", which is the honest answer —
   * nothing can place an undated story inside seven days.
   */
  const deskRecords = useMemo(
    () => records.filter((r) => inWindow(r.publishedAt ?? r.createdAt, windowFrom)),
    [records, windowFrom],
  )

  /**
   * The issues with at least one record inside the window.
   *
   * An issue whose backing this device no longer holds is kept rather than
   * dropped, exactly as `dayIssues` keeps it: clearing old records must not
   * silently delete an issue from every view at once.
   */
  const windowIssueIds = useMemo(() => {
    if (windowFrom === null) return null
    /*
     * NO CLUSTERS MEANS NO ID CUT, AND THAT IS NOT A SHORTCUT.
     *
     * This set is built from `store.issues`, and the panel it feeds drops
     * every grievance row whose id is not in it. But when the desk holds no
     * clusters, `issuesFor` does not rank clusters at all — it tallies the
     * RECORDS by topic and mints ids of its own ("topic-Water"), which can
     * never appear here. Handing it a set built from an empty `store.issues`
     * therefore deleted the entire grievance half of "What should I talk
     * about?" on any desk whose clustering has not run, silently, under a
     * window control that was doing its job everywhere else.
     *
     * Null is the honest answer: it says "this caller has no id-based cut to
     * apply". The window is not lost by returning it, because the tallied
     * path windows itself — it skips every record older than `since`, which
     * is the same instant this set was built from.
     */
    if (issues.length === 0) return null
    const kept = new Set<string>()
    for (const issue of issues) {
      const held = issue.recordIds
        .map((id) => byId.get(id))
        .filter((r): r is GrievanceRecord => r !== undefined)
      if (held.length === 0 || held.some((r) => inWindow(r.publishedAt ?? r.createdAt, windowFrom))) {
        kept.add(issue.id)
      }
    }
    return kept
  }, [issues, byId, windowFrom])

  /* THE EXPORT MEMO IS GONE, AND SO ARE ITS NEIGHBOURS.

     `exportRecords`, `otherDays`, `issueCategories`, `anyFlagged`, `options`,
     `visible`, `activeFilters`, `setAside` and `visibleIssues` were each read
     by exactly one thing — the day stepper, the record-view filter bar, the
     old export button — and every one of those was deleted from the render.
     The hooks were still declared and still recomputing on every store change,
     which is a cost paid for nothing and, worse, nine names that read as live
     state to anyone opening this file. The export the header ships is
     ExportReport, and it takes `deskRecords` directly. */

  const selected = useMemo(
    () => records.find((r) => r.id === selectedId) ?? null,
    [records, selectedId],
  )

  const parsed = useMemo(() => parseDraft(draft), [draft])

  /**
   * The sentence behind the header's info mark.
   *
   * TWO THINGS IT USED TO GET WRONG, both of them the same kind of wrong.
   *
   * It said "the list below covers …" unconditionally. Opening a record
   * unmounts BOTH cards — the table and the suggestions — so the note was
   * describing a list that was not on the screen, to a reader looking at one
   * record's reading. It now says what is actually below it.
   *
   * And its denominator was `records`, which is `allRecords` with the
   * relevance check already applied. "5 of the 8 records this desk holds" was
   * therefore counted against a number that is not what the desk holds: three
   * more were filed and then set aside as not about this desk's subject, and
   * the reader had no way to know they existed. The denominator is now every
   * record on the desk, and the cut that shrinks it is named rather than
   * quietly folded in.
   */
  const deskNote = useMemo(() => {
    /*
     * ONE POPULATION PER SENTENCE.
     *
     * This counted the WINDOWED, relevance-checked records against the desk's
     * UNFILTERED total, so at All time it read "5 of the 8 records this desk
     * holds are inside all time" — a sentence that contradicts itself, since
     * every record a desk holds is inside all time. Both halves now come from
     * the same population: the records on this desk, after the relevance
     * check, which is what the two cards below are built from.
     *
     * THE SET-ASIDE CLAUSE IS GONE, NOT REWORDED. It said the records the
     * relevance check dropped were "on neither card", and that is false —
     * their issues do appear on the suggestions card. A sentence that cannot
     * be made true from what the screen shows is better absent than softened.
     */
    const onDesk = records.length
    const dated = isToday(day) ? 'today' : formatDeskDay(day)
    const covers = `${deskRecords.length} of the ${onDesk} ${pluralise(onDesk, 'record')} on this desk ${deskRecords.length === 1 ? 'is' : 'are'} inside ${windowName.toLowerCase()}.`
    if (selectedId !== null) {
      return `One record’s full reading is open below; the issue table and the suggestions are closed while it is. ${covers}`
    }
    const day_ = dayRecords.length
      ? `${dayRecords.length} ${pluralise(dayRecords.length, 'record')} and ${dayIssues.length} ${pluralise(dayIssues.length, 'issue')} are dated ${dated}.`
      : `Nothing is dated ${dated}.`
    return `${day_} The two cards below cover ${windowName.toLowerCase()}: ${covers}`
  }, [
    records.length,
    deskRecords.length,
    dayRecords.length,
    dayIssues.length,
    day,
    windowName,
    selectedId,
  ])

  /**
   * Scan the chosen mastheads, then hand what it found to the link box.
   *
   * The scan itself makes no model call — it reads index pages and matches the
   * desk's words — so it comes back in a second or two. Its results land in the
   * paste box rather than being read immediately, because reading them costs
   * two model calls each and the operator should see what was found before
   * spending that.
   */
  const [scanning, setScanning] = useState(false)

  /**
   * Is there anything to scan? Same test the intake panel makes, hoisted so
   * the desk toolbar can make it too. A scan with no papers chosen returns
   * nothing and looks like a broken button.
   */
  const scanReady =
    (store.profile?.portals?.length ?? 0) > 0 ||
    (store.profile?.customPortalUrls ?? []).filter(Boolean).length > 0
  const [scanNote, setScanNote] = useState<string | null>(null)

  /**
   * What the last scan put in the box.
   *
   * A scan used to append, which meant changing the district and scanning again
   * left the previous district's stories sitting above the new ones — the
   * office read it as the scan having done nothing, or worse, as those stories
   * belonging to the new patch. Remembering what was inserted lets the next
   * scan take exactly that back out while leaving anything hand-pasted alone.
   */
  const scannedRef = useRef<string[]>([])

  /**
   * Changing where the desk works invalidates whatever is on screen from the
   * last scan. Clearing it here rather than at scan time means the operator
   * sees the stale results disappear the moment they change the district, which
   * is when they would otherwise start doubting what they are looking at.
   */
  const configKey = [
    store.profile?.state ?? '',
    store.profile?.constituency ?? '',
    (store.profile?.portals ?? []).join('|'),
    (store.profile?.customPortalUrls ?? []).join('|'),
  ].join('::')

  useEffect(() => {
    if (scannedRef.current.length === 0) return
    const stale = new Set(scannedRef.current)
    scannedRef.current = []
    setScanNote(null)
    setDraft((current) =>
      current
        .split(/\r?\n/)
        .filter((line) => !stale.has(line.trim()))
        .join('\n'),
    )
  }, [configKey])

  /**
   * Where this desk reads, in the one shape both callers take.
   *
   * The intake panel's Scan button and the header's Sync button send the same
   * request to the same endpoint. It used to be written out twice, and two
   * copies of a request body is how a fix to one half quietly leaves the other
   * half sending last month's parameters.
   */
  const scanTargets = useMemo<ScanTargets>(() => {
    const profile = store.profile
    const party = store.identity?.party ?? null
    const short = partyAbbreviation(party)
    return {
      portals: profile?.portals ?? [],
      customUrls: (profile?.customPortalUrls ?? []).filter(Boolean),
      // The DISTRICT, falling back to the seat. Publishers issue editions by
      // district and never by assembly segment, so sending the seat here finds
      // no district route and silently drops the scan to the state page — the
      // failure this reads as is a quiet news week.
      city: profile?.district ?? profile?.constituency ?? null,
      tags: profile?.watchTerms ?? [],
      /*
       * Words that are only ever evidence when another watched word lands with
       * them. The party has always been one: on its own it returns the national
       * wire, twenty-three stories about the party and none about this member.
       *
       * The planner mints two more of exactly that kind and they were never
       * passed here, so they stood alone as sufficient evidence. "Aruna" is the
       * surname carved out of "D. K. Aruna" and it matches a cricketer.
       * "Gadwal" is the distinctive token carved out of "Jogulamba Gadwal" and
       * it matches a district sports meet. Both are named in this feature's
       * own design notes as the reported failures, and both were reaching the
       * desk on their own. They are demoted rather than dropped, because a
       * Telugu masthead often prints only the surname and dropping them would
       * cost real coverage.
       */
      broadTags: corroboratingTerms(store.identity, profile, short ?? party),
      state: profile?.state ?? null,
      /**
       * Who to judge each story against. Absent identity means no judging,
       * and every story then shows labelled as unchecked rather than being
       * silently kept or silently dropped.
       */
      subject: store.identity
        ? {
            name: store.identity.name,
            role: store.identity.role ?? null,
            constituency: profile?.constituency ?? store.identity.constituency ?? null,
            state: profile?.state ?? store.identity.state ?? null,
            party,
            aliases: store.identity.aliases ?? [],
            /**
             * The ground, so the judge is not placing headlines from memory.
             *
             * Everything the judge knew about where this seat is was the one
             * word in `constituency`. A headline naming a town, a mandal or an
             * older spelling of the district reached it with no place signal at
             * all, and landed correctly only when the model happened to know
             * Telangana geography itself. That is the part that degrades when a
             * rate-limited provider fails over to a weaker one, which is
             * exactly when the desk fills with things it should not carry.
             *
             * Assembled only from places this desk can actually vouch for: the
             * district and seat it is configured with, their registry
             * spellings, and any watch term the office typed that resolves to a
             * real place. No geography is invented here.
             */
            places: placesFor(
              profile?.district ?? null,
              profile?.constituency ?? store.identity.constituency ?? null,
              profile?.state ?? store.identity.state ?? null,
              profile?.watchTerms ?? [],
            ),
          }
        : null,
    }
  }, [store.profile, store.identity])

  /**
   * Scan the mastheads and put what was found in the paste box.
   *
   * The intake panel's half of the deliberate two-step flow, and it stays a
   * two-step: somebody sees what the papers carried before spending two model
   * calls per story on it. The header's Sync button no longer comes through
   * here — it runs the job, which does its own scan as its first stage and
   * reads straight through. So this fills the box and stops, which is what the
   * panel around it has always promised.
   */
  const runScan = useCallback(async (): Promise<void> => {
    setScanning(true)
    setScanNote(null)
    const found = await findStories(scanTargets)
    setScanning(false)

    if (found.error) {
      setScanNote(found.error)
      return
    }
    if (found.urls.length === 0) {
      setScanNote(found.note)
      return
    }

    // Take the previous scan's results out before putting these in, so the box
    // holds this scan plus whatever the operator pasted by hand — never an
    // earlier district's stories stacked on top of the current ones.
    const previous = new Set(scannedRef.current)
    scannedRef.current = found.urls
    setDraft((current) => {
      const kept = current
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !previous.has(l))
      const seen = new Set(kept)
      return [...kept, ...found.urls.filter((u) => !seen.has(u))].join('\n')
    })
    setScanNote(found.note)
  }, [scanTargets])

  /**
   * On a phone the detail replaces the list, so back should return to the list
   * rather than leaving the grievance desk entirely.
   */
  useBackToDismiss(selectedId !== null, useCallback(() => setSelectedId(null), []))

  const openRecord = useCallback((id: string) => {
    setSelectedId(id)
    setTab('records')
    haptic.tap()
    // On a phone the detail replaces the list, so land at its top. On a desktop
    // both are on screen and yanking the page to the top loses the reader's
    // place in a list they are still working down.
    if (window.innerWidth < 1024) window.scrollTo({ top: 0 })
  }, [])

  /**
   * Read a list of links, through the job.
   *
   * The loop that does the reading — the batch, the fall back to one at a time
   * when a whole batch stalls, the record written the moment it lands — is
   * unchanged; it simply lives in scan-job.ts now. What changed here is who
   * owns the run. Starting it is all this screen does, and `start` is a no-op
   * while a run is going, so the old "orphaned controller" guard is the job's
   * business rather than a ref this component has to remember to clear.
   */
  const readLinks = useCallback((urls: string[]) => {
    if (urls.length === 0) return
    startScanJob({ kind: 'read', urls })
  }, [])

  /**
   * Fetch today and read it, in one press.
   *
   * The two halves were deliberately kept apart: the scan is cheap and the
   * reading costs two model calls per story, so the intake panel shows what was
   * found and lets somebody choose. That is right there and wrong here. A
   * button on the desk header labelled "Sync today" is a promise about the
   * desk, and it was filling a box on a panel that is not even on screen in the
   * issues view.
   *
   * Both halves are now stages of one job, which is what makes the wait
   * legible: scanning, sifting out what the desk already holds, reading, and
   * grouping are four things the reader can watch happen instead of a button
   * that says "Looking…" and then "Reading…" for three minutes.
   *
   * The intake panel keeps its two-step flow untouched.
   */
  const syncToday = useCallback(() => {
    startScanJob({ kind: 'sync', ...scanTargets })
  }, [scanTargets])

  const failedLinks = useMemo(
    () => job.links.filter((l) => l.status === 'failed'),
    [job.links],
  )

  /**
   * What worked leaves the paste box; what failed stays in it, so a mistyped
   * link can be fixed and read again without hunting for it in the chat.
   *
   * This used to be the last statement of the read loop, which could only work
   * while the loop and the box were in the same component. Now the run can
   * finish while this screen is somewhere else entirely, so it is done on the
   * run's completion instead, once, keyed on which run finished.
   *
   * It removes what was read and adds back what failed rather than replacing
   * the box wholesale. The old version replaced it, which was safe when the box
   * was the input to the run and is not safe now that a sync can finish while
   * somebody is part-way through pasting the next list.
   */
  const reconciledRun = useRef<string | null>(null)
  useEffect(() => {
    if (running || !job.startedAt || job.links.length === 0) return
    if (reconciledRun.current === job.startedAt) return
    reconciledRun.current = job.startedAt

    const read = new Set(job.links.filter((l) => l.status === 'done').map((l) => l.url))
    const failed = job.links.filter((l) => l.status === 'failed').map((l) => l.url)

    setDraft((current) => {
      const kept = current
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !read.has(l))
      const seen = new Set(kept)
      return [...kept, ...failed.filter((u) => !seen.has(u))].join('\n')
    })
  }, [running, job.startedAt, job.links])

  /**
   * Who the drafted posts speak as.
   *
   * Read from the identity rather than asked per press: the posts are written
   * in the officeholder's first person, and the office should not have to say
   * who they are on every issue card.
   */
  const person = useMemo<SuggestionPerson>(
    () => ({
      name: store.identity?.name ?? store.profile?.subject ?? 'This office',
      role: store.identity?.role ?? null,
      party: store.identity?.party ?? null,
      constituency: store.identity?.constituency ?? store.profile?.constituency ?? null,
    }),
    [store.identity, store.profile],
  )

  return (
    <m.div
      className="shell shell-wide page-end"
      variants={listStaggerFast}
      initial={reduced ? false : 'hidden'}
      animate="show"
    >
      <m.div variants={fadeUp}>
        <PageHeader
          /*
           * THE TITLE IS SET INLINE, AND IT HAS TO BE.
           *
           * PageHeader's h1 carries `.display`, which is unlayered author CSS
           * assigning the serif at weight 400, and index.css also styles `h1`
           * on the element at weight 600. Unlayered rules beat every Tailwind
           * utility, so `font-bold` or `font-sans` on this heading does
           * nothing at all — measured on the running screen, the title
           * reported Instrument Serif 400 with the classes applied. A style on
           * a CHILD is the one thing that wins without !important, because the
           * element rules do not reach it.
           *
           * Bold sans is the reference's, and it is right for this screen: the
           * serif is the app's hero voice, and a page about other people's
           * complaints is not the place for a voice.
           */
          title={
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.85rem' }}>
              Grievance desk
            </span>
          }
          subtitle={
            /*
             * THE SUBTITLE SAYS WHAT THE SCREEN IS. It used to spend itself on
             * a tally — "3 records · 3 issues on this day" — which is a real
             * count and the wrong thing to put in the one line that has to
             * tell a first-time reader what they are looking at. The tally
             * moved into the info mark beside it, where it also answers the
             * question the reader actually has once the table is on screen:
             * why the table's total is larger than the day's.
             */
            <>
              Track, understand and respond to issues reported in the local news.
              <InfoMark note={deskNote} />
            </>
          }
          actions={
            <>
              {/* Shows and hides the desk's own configuration, right here.
                  Absent when Settings embeds this screen — a pencil there
                  would be a door into the room the reader is standing in. */}
              {!embedded && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing((v) => !v)}
                  aria-label={editing ? 'Close the desk settings' : 'Edit the desk'}
                  title={editing ? 'Close the desk settings' : 'Edit the desk'}
                  aria-pressed={editing}
                  // Square. The default padding is px-4, which framed a 16px
                  // icon in a wide box and left it adrift beside the control
                  // next to it.
                  className={cn('size-11 px-0', editing && 'bg-[var(--accent-soft)] text-[var(--accent)]')}
                >
                  <Pencil size={16} aria-hidden />
                </Button>
              )}

              {/* THE WINDOW. Sized inline, because index.css styles `select`
                  on the element and unlayered — `font-size: max(16px, ...)`
                  as an iOS anti-zoom rule and a 2.25rem end padding for the
                  chevron it paints. Both beat every utility, so a class-set
                  size here would silently render at 17px, which is what
                  already cost this screen one round on the filter row. */}
              <label className="relative inline-flex shrink-0 items-center" title="How far back this screen reaches">
                <span className="sr-only">Window</span>
                <select
                  value={windowId}
                  onChange={(e) => setWindowId(e.target.value as WindowId)}
                  style={{ fontSize: 13, paddingInlineEnd: 30 }}
                  className="h-11 appearance-none rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface)] pl-8 font-medium text-ink outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)]"
                >
                  {WINDOWS.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                    </option>
                  ))}
                </select>
                {/* After the select in the DOM so it paints over the control's
                    own background rather than under it. */}
                <CalendarDays
                  size={14}
                  aria-hidden
                  className="pointer-events-none absolute left-3 text-ink-3"
                />
              </label>

              {/*
                THE DESK'S READ CONTROL, BACK ON THE HEADER.

                This screen has exactly one way to fetch the day's news, and a
                rebuild of the action set dropped it: without this button the
                desk can read nothing at all from here, and the only remaining
                path was to wait for the 07:30 job. It runs the same job that
                job runs — scan, sift, read, group — so there is no second code
                path to drift from it.

                The button reports only which stage is running; what was found,
                what failed and why is ScanProgress's job, directly below.
              */}
              <Button
                size="sm"
                variant="outline"
                onClick={syncToday}
                disabled={scanning || running || !scanReady}
                title={
                  scanReady
                    ? 'Look for today’s news now, without waiting for the 07:30 scan'
                    : 'Choose which papers this desk reads first, behind the pencil.'
                }
              >
                <RefreshCw
                  size={15}
                  className={
                    scanning || running ? 'animate-spin motion-reduce:animate-none' : undefined
                  }
                />
                {job.status === 'scanning'
                  ? 'Reading the papers…'
                  : job.status === 'reading'
                    ? 'Reading the stories…'
                    : scanning
                      ? 'Looking…'
                      : 'Sync today'}
              </Button>

              <ExportReport records={deskRecords} windowName={windowName} />

              {/* Back stays. It is the only way off this screen, and the
                  office has asked for it twice. */}
              <Button variant="ghost" size="sm" onClick={onClose}>
                Back
              </Button>
            </>
          }
        />
      </m.div>

      {/* The desk's configuration, behind the pencil — papers, watch words,
          the district. A desk with no papers chosen AND nothing ever filed is
          brand new, and there the setup shows by itself: an icon a new office
          has no reason to press must never be the only way to start. */}
      {!embedded &&
        (editing ||
          (deskConfig.portals.length + deskConfig.customUrls.length === 0 &&
            store.grievances.length === 0)) && (
          <m.div variants={fadeUp} className="mt-4">
            <Card level="lift">
              <CardHead
                icon={<Pencil size={16} aria-hidden />}
                tint="blue"
                title="Grievance desk settings"
                sub={`${deskConfig.portals.length + deskConfig.customUrls.length} ${pluralise(deskConfig.portals.length + deskConfig.customUrls.length, 'paper')} · ${deskConfig.tags.length} ${pluralise(deskConfig.tags.length, 'word')}`}
              />
              <DeskSetup
                {...deskConfig}
                framed={false}
                onScan={() => void runScan()}
                scanning={scanning}
                scanNote={scanNote}
              />
            </Card>
          </m.div>
        )}

      {/* What the scan searched for, on the face of the screen.
          The words were always here, behind the pencil; a reader looking at a
          list of issues asks "what did you search for to get this?" and that
          answer should not be two clicks away. Removing a chip writes straight
          through to the same watch-term list the settings drawer edits.

          Hidden while a record's reading is open: "AI analysis" opens a PAGE,
          not a panel underneath. Printed below the table it left the desk
          scrolling past the list it had just been reading to find the answer,
          and both were on screen claiming the same attention. */}
      {!embedded && !selected && (
        <m.div variants={fadeUp} className="mt-4">
          {/* Card A beside Card B, each under its own numbered marker.

              THE SPLIT IS 760:600, NOT THE REFERENCE'S 695:621. The reference
              is a drawing on its own canvas; here the left card carries a
              five-column table and the right one carries a single stack. At
              1440 the reference's ratio left that table 552px, of which the
              severity, publisher and date columns took 284 to fit their own
              content — so the headline column, the widest in the reference,
              rendered at 155px and clamped every headline on the desk. The
              suggestion column loses about twenty pixels of a one-column list
              to buy them back. Measured at 1440, 1600 and 1920. */}
          <div className="grid gap-x-3 gap-y-4 xl:grid-cols-[minmax(0,760fr)_minmax(0,600fr)] xl:items-start">
            <div className="min-w-0">
            <StepMark n={1} label="List of issues" />
            <Card className="rounded-tl-none p-4 sm:p-5">
              <KeywordsPanel
                terms={deskConfig.tags}
                sources={deskConfig.portals.length + deskConfig.customUrls.length}
                lastScanAt={store.lastScanAt}
                onRemove={deskConfig.onToggleTag}
                onAdd={deskConfig.onToggleTag}
                onManage={() => setEditing(true)}
              />
              <div className="mt-4">
                <IssuesTable
                  records={deskRecords}
                  onOpen={(r) => openRecord(r.id)}
                  /* The window is the header's, so the sentence that explains
                     an empty table has to name it. Without this the table said
                     "nothing has been filed on this desk yet" over a desk with
                     eight records in it, none of them inside the window. */
                  emptyNote={
                    records.length > 0
                      ? `No record on this desk falls inside ${windowName.toLowerCase()}. Widen the window at the top of the screen.`
                      : undefined
                  }
                />
              </div>
            </Card>
            </div>

            <div className="min-w-0">
            <StepMark n={2} label="What should I talk about?" />
            <Card className="rounded-tl-none p-4 sm:p-5">
              <TalkAbout
                /* The window, in both the shapes this panel needs it: a
                   timestamp for the news openings, which `openingsOf` does
                   window itself, and the surviving issue ids for the grievance
                   openings, which it does not. */
                since={windowFrom ? Date.parse(windowFrom) : 0}
                issueIds={windowIssueIds}
                /* Why this half is empty, in the caller's words — the same
                   contract the table beside it has. A desk whose every record
                   is older than the window loses every card in this panel, and
                   from inside the panel that is indistinguishable from a desk
                   with nothing on it. */
                emptyNote={
                  deskRecords.length === 0 && allRecords.length > 0
                    ? `No record on this desk falls inside ${windowName.toLowerCase()}, so there is nothing here to rank. The desk holds ${allRecords.length} ${pluralise(allRecords.length, 'record')} in all — widen the window at the top of the screen to reach ${allRecords.length === 1 ? 'it' : 'them'}.`
                    : undefined
                }
                onDraft={() => onOpenNextPost?.()}
              />
            </Card>
            </div>
          </div>
        </m.div>
      )}


      {/* What the sync is doing, directly under the button that starts it.

          Above the tab panels rather than inside one, because the Sync button
          is on this toolbar in BOTH views and the intake panel it used to
          report through is only rendered in the records view. An office that
          pressed Sync while reading issues got a spinning button and nothing
          else, which is half of what they reported.

          It stays on screen after the run to say what happened, and a reader
          who comes back to this screen mid-run lands straight on the live
          stage rather than on a button that looks stuck. */}
      {job.status !== 'idle' && (
        <m.div variants={fadeUp} className="mt-4">
          <ScanProgress state={job} onStop={cancelScanJob} onHide={dismissScanJob} />
        </m.div>
      )}

      {/* No summary furniture between the toolbar and the work. A stat strip,
          a severity donut and an origin map lived here; every number on them
          was a re-count of the list directly below, and the office called the
          screenful it cost a waste of space. The records and issues start
          right under the controls instead. */}
      {/* THE DAY VIEW IS GONE, AND SO IS THE ISSUE LIST BENEATH IT.
          The two cards above — the records table and "What should I talk
          about?" — already carry every record and every ranked issue this
          screen held, with the reading on them. Underneath sat a second copy:
          a day stepper, another search box, another severity filter and a
          stack of issue cards restating the same records. The office read the
          duplicate and said it plainly: "coming below this is not required we
          can get things from above part itself."

          What is kept is the READING of a single record, which the table's own
          "AI analysis" button opens. That was the one thing down here the
          cards above could not show. */}
      {selected && (
        <m.div variants={fadeUp} className="mt-4">
          <RecordDetail record={selected} onBack={() => setSelectedId(null)} />
        </m.div>
      )}
    </m.div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Intake

   The setup steps that used to be defined here — DeskSetup, RegionPicker,
   PortalInput, TagInput — moved whole to components/settings/DeskConfig.tsx,
   because Settings now renders the identical configuration in its "Grievance
   desk settings" section. On the desk the same setup lives behind the
   header's pencil; this panel is only the paste box and the read button.
   ═══════════════════════════════════════════════════════════════════════════ */

function IntakePanel({
  draft,
  onDraft,
  links,
  unusable,
  running,
  canHide,
  onHide,
  onRead,
  onRetryFailed,
  failedCount,
}: {
  draft: string
  onDraft: (value: string) => void
  links: DraftLink[]
  unusable: string[]
  /**
   * A run is going, wherever it was started from. The panel no longer carries
   * the progress list or the Stop button: both moved to ScanProgress, which
   * sits above this and reports the same run in both views of the desk. Two
   * live progress lists on one screen was the alternative, and one of them
   * would always have been the stale-looking one.
   */
  running: boolean
  canHide: boolean
  onHide: () => void
  onRead: () => void
  onRetryFailed: () => void
  failedCount: number
}) {
  const known = links.filter((l) => l.publisher !== null)
  const publishers = [...new Set(known.map((l) => l.publisher))].filter(
    (p): p is string => p !== null,
  )
  return (
    <m.div variants={fadeUp}>
      <Card>
        <CardHead
          icon={<Newspaper size={16} />}
          title="Add news links"
          sub="Paste the whole list from the group at once"
          tint="blue"
          action={
            canHide ? (
              <button
                onClick={onHide}
                aria-label="Hide the link box"
                className="-my-1 grid size-11 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-2)]"
              >
                <X size={18} />
              </button>
            ) : undefined
          }
        />
        <p className="text-xs leading-relaxed text-ink-3">
          One per line.
        </p>

        {/* The DeskSetup block that sat here moved behind the header's
            pencil, where configuration now lives. This panel is the day's
            work only: paste, read. */}
        <span className="kicker">Paste links</span>
        <textarea
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          rows={5}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="News links, one per line"
          placeholder={'https://www.eenadu.net/…\nhttps://www.sakshi.com/…'}
          className="mt-2 w-full resize-y rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-2)] p-3.5 text-sm leading-relaxed outline-none transition-colors focus:border-[var(--accent)]"
        />

        {/* The list of recognised publishers used to sit here as well, which
            meant the desk asked which papers to read twice — once as a real
            choice in step 2 and once as decoration under the box. Only the
            count of what is actually pasted belongs here. */}
        {links.length > 0 && (
          <p className="mt-3 text-xs text-ink-2">
            {links.length} {pluralise(links.length, 'link')}
            {publishers.length > 0 && ` · ${known.length} from ${publishers.join(', ')}`}
            {links.length - known.length > 0 &&
              ` · ${links.length - known.length} from ${pluralise(links.length - known.length, 'a publisher', 'publishers')} not on the list`}
          </p>
        )}

        {unusable.length > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--warn)]">
            <CircleAlert size={13} className="mt-0.5 shrink-0" />
            <span>
              Skipped {unusable.length} {pluralise(unusable.length, 'line')}. Not a web address:{' '}
              {unusable.slice(0, 3).join(', ')}
              {unusable.length > 3 && ` and ${unusable.length - 3} more`}. A link has to start with
              http:// or https://.
            </span>
          </p>
        )}

        {/* The per-link list that used to sit under these buttons is now in
            ScanProgress, above. It is the same list; it moved so that a sync
            started from the desk toolbar reports itself in the issues view too,
            where this panel is not on screen at all. */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={onRead} disabled={running || links.length === 0}>
            <RefreshCw size={15} className={running ? 'animate-spin' : ''} />
            {running
              ? 'Reading, see above'
              : links.length === 0
                ? 'Read links'
                : `Read ${links.length} ${pluralise(links.length, 'link')}`}
          </Button>
          {!running && failedCount > 0 && (
            <Button variant="outline" onClick={onRetryFailed}>
              Try the {failedCount} that failed again
            </Button>
          )}
        </div>
      </Card>
    </m.div>
  )
}

function EmptyDesk() {
  return (
    <m.div variants={fadeUp}>
      <Card>
        <CardHead
          icon={<Inbox size={16} />}
          title="Nothing read yet"
          sub="Paste the morning’s links to fill the desk"
          tint="blue"
        />
      </Card>
    </m.div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Filters
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A chip that can be pressed.
 *
 * `Chip` is a span with no click handling and no pressed state, so a toggle
 * cannot BE a Chip — it has to wrap one. That is the right way round anyway:
 * the button supplies the 44px hit target and `aria-pressed`, the Chip supplies
 * the visuals, and a lit "Critical" here is the identical object to the
 * "Critical" on the card below it. Hand-rolling the chip classes a fourth time
 * would have let the two drift.
 */
function ChipToggle({
  on,
  tone,
  label,
  onClick,
  children,
}: {
  on: boolean
  tone: ChipTone
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className="inline-flex min-h-11 shrink-0 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <Chip
        tone={on ? tone : 'neutral'}
        className={on ? undefined : 'opacity-55 transition-opacity hover:opacity-100'}
      >
        {children}
      </Chip>
    </button>
  )
}

/**
 * The issue filters, in one row.
 *
 * Four axes, and the two that can be empty hide themselves: the category
 * dropdown is not rendered when a desk has one category, and the flag toggle is
 * not rendered when nothing is flagged. A control that cannot change the result
 * is worse than no control — it invites a press and answers with the same list.
 */
function IssueFilterBar({
  filters,
  onChange,
  categories,
  showFlagged,
  shown,
  total,
}: {
  filters: IssueFilters
  onChange: (next: IssueFilters) => void
  categories: Topic[]
  showFlagged: boolean
  shown: number
  total: number
}) {
  const set = (patch: Partial<IssueFilters>): void => onChange({ ...filters, ...patch })

  const toggleSeverity = (level: Severity): void =>
    set({
      severities: filters.severities.includes(level)
        ? filters.severities.filter((x) => x !== level)
        : [...filters.severities, level],
    })

  const active =
    (filters.text.trim() ? 1 : 0) +
    (filters.severities.length > 0 ? 1 : 0) +
    (filters.category ? 1 : 0) +
    (filters.flagged ? 1 : 0)

  return (
    <div className="mb-3">
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 scroller lg:mx-0 lg:flex-wrap lg:overflow-x-visible lg:px-0">
        <div className="relative shrink-0">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            type="search"
            value={filters.text}
            onChange={(e) => set({ text: e.target.value })}
            placeholder="Search issues"
            aria-label="Search the issues and places"
            className={cn(selectClass, 'w-48 pl-9')}
          />
        </div>

        <div role="group" aria-label="Severity" className="flex shrink-0 items-center gap-1">
          {SEVERITIES.map((level) => (
            <ChipToggle
              key={level}
              on={filters.severities.includes(level)}
              tone={SEVERITY_TONE[level]}
              label={`${level} severity`}
              onClick={() => toggleSeverity(level)}
            >
              {level}
            </ChipToggle>
          ))}
        </div>

        {categories.length > 1 && (
          <select
            value={filters.category}
            onChange={(e) => set({ category: e.target.value })}
            aria-label="Category"
            className={cn(selectClass, filters.category && 'select-active')}
          >
            <option value="">Any category</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}

        {showFlagged && (
          <ChipToggle
            on={filters.flagged}
            tone="negative"
            label="Only issues with a record flagged as possibly false"
            onClick={() => set({ flagged: !filters.flagged })}
          >
            <ShieldAlert size={11} aria-hidden />
            Worth checking
          </ChipToggle>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-3">
          {active > 0
            ? `Showing ${shown} of ${total} ${pluralise(total, 'issue')}`
            : `${total} ${pluralise(total, 'issue')}`}
        </p>
        {active > 0 && (
          <button
            onClick={() => onChange(NO_ISSUE_FILTERS)}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-[var(--accent)]"
          >
            <X size={14} aria-hidden />
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

function FilterBar({
  filters,
  onChange,
  options,
  active,
  shown,
  total,
}: {
  filters: Filters
  onChange: (next: Filters) => void
  options: { constituencies: string[]; topics: Topic[]; persons: string[]; tags: string[] }
  active: number
  shown: number
  total: number
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })

  return (
    <m.div variants={fadeUp}>
      {/* One row, and on a phone it scrolls sideways inside itself. The page
          body must never scroll sideways — that is how a thumb loses the list.

          On a desktop it wraps instead, and the scroll track goes with it. The
          controls used to sit in a half-width column beside a detail pane, so
          they overflowed and showed a scrollbar even on a wide screen; with the
          pane gone they have the room to wrap and a leftover track just reads
          as something being cut off. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scroller lg:mx-0 lg:flex-wrap lg:overflow-x-visible lg:px-0">
        <div className="relative shrink-0">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            type="search"
            value={filters.text}
            onChange={(e) => set({ text: e.target.value })}
            placeholder="Search words, places, names"
            aria-label="Search the records"
            className={cn(selectClass, 'w-56 pl-9')}
          />
        </div>

        <select
          value={filters.constituency}
          onChange={(e) => set({ constituency: e.target.value })}
          aria-label="Constituency"
          className={cn(selectClass, filters.constituency && 'select-active')}
        >
          <option value="">Any constituency</option>
          {options.constituencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={filters.topic}
          onChange={(e) => set({ topic: e.target.value })}
          aria-label="Topic"
          className={cn(selectClass, filters.topic && 'select-active')}
        >
          <option value="">Any topic</option>
          {options.topics.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          value={filters.severity}
          onChange={(e) => set({ severity: e.target.value })}
          aria-label="Severity"
          className={cn(selectClass, filters.severity && 'select-active')}
        >
          <option value="">Any severity</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={filters.person}
          onChange={(e) => set({ person: e.target.value })}
          aria-label="Person named"
          className={cn(selectClass, filters.person && 'select-active')}
          disabled={options.persons.length === 0}
        >
          {/* A disabled control that still says "Anyone named" looks broken.
              It says why it is empty instead. */}
          <option value="">
            {options.persons.length === 0 ? 'No names in these records' : 'Anyone named'}
          </option>
          {options.persons.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <select
          value={filters.hashtag}
          onChange={(e) => set({ hashtag: e.target.value })}
          aria-label="Hashtag"
          className={cn(selectClass, filters.hashtag && 'select-active')}
          disabled={options.tags.length === 0}
        >
          <option value="">
            {options.tags.length === 0 ? 'No hashtags in these records' : 'Any hashtag'}
          </option>
          {options.tags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-3">
          {active > 0
            ? `${shown} of ${total} ${pluralise(total, 'record')} · ${active} ${pluralise(active, 'filter')} on`
            : `${total} ${pluralise(total, 'record')}`}
        </p>
        {active > 0 && (
          <button
            onClick={() => onChange(NO_FILTERS)}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-[var(--accent)]"
          >
            <X size={14} />
            Clear filters
          </button>
        )}
      </div>
    </m.div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   List row
   ═══════════════════════════════════════════════════════════════════════════ */

function RecordRow({
  record,
  active,
  onOpen,
  relevance,
}: {
  record: GrievanceRecord
  active: boolean
  onOpen: () => void
  /** What the judge ruled about the story behind this record. */
  relevance?: Verdict
}) {
  /**
   * Whether the record has a page anyone can actually open. The demo's
   * illustrative records carry placeholder ids in `sourceUrl`, and a link
   * that goes nowhere teaches the office not to trust the links that go
   * somewhere.
   */
  const linksOut = record.sourceUrl.startsWith('http')

  /**
   * Who printed it. The publisher's name when the record has one, the host
   * when it does not but the address is real, and nothing when neither is —
   * the meta line then says plainly that this is an example record rather
   * than dressing it up with a publisher nobody can check.
   */
  const paper = record.publisher ?? (linksOut ? hostOf(record.sourceUrl) : null)

  return (
    // A div holding a button and a link, not a button holding a link: an
    // interactive element inside another is invalid HTML, and browsers break
    // the nesting unpredictably. The row body opens the record; the icon at
    // the far edge opens the paper.
    <div
      className={cn(
        // Hand-rolled card face rather than the .card class, so the active
        // accent wash is not fought by the shared card background.
        'card-hover flex w-full items-stretch overflow-hidden rounded-[var(--radius-lg)] border shadow-[var(--e1)]',
        active
          ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
          : 'border-[var(--border)] bg-[var(--surface)]',
      )}
    >
      {/* The stripe is the fast read down the list; the chip beside the
          headline is the one that survives a colourblind reader, a grey-scale
          print-out and direct sunlight. Both, always. */}
      <span
        aria-hidden
        className="w-1.5 shrink-0"
        style={{ background: SEVERITY_COLOUR[record.severity] }}
      />

      <button
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        className="min-w-0 flex-1 py-3 pl-3 pr-3 text-left"
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <Chip tone={SEVERITY_TONE[record.severity]}>{record.severity}</Chip>
          {record.fake.suspicion !== 'No' && (
            <Chip tone={SUSPICION_TONE[record.fake.suspicion]} icon={<ShieldAlert size={11} />}>
              {SUSPICION_LABEL[record.fake.suspicion]}
            </Chip>
          )}
          {/* Only where it is not simply "about you": a label on the norm is
              decoration, and if every row carries one the row that is only
              about the party stops standing out. */}
          {relevance && <RelevanceChip verdict={relevance} />}
        </span>

        <span
          className={cn(
            'mt-1.5 line-clamp-2 block text-sm font-medium leading-snug',
            isIndicScript(record.headline) && 'te',
          )}
        >
          {record.headline}
        </span>

        {/* What the paper itself printed, not the model's summary of it. The
            row is where the office decides whether to open a record at all,
            and the paper's own words are the honest basis for that call. */}
        {record.excerpt && (
          <span
            className={cn(
              'mt-1 line-clamp-3 block text-xs leading-relaxed text-ink-2',
              isIndicScript(record.excerpt) && 'te',
            )}
          >
            {record.excerpt}
          </span>
        )}

        <span className="mt-1 block truncate text-xs text-ink-3">
          {metaLine(
            paper ?? 'Example record',
            record.constituency ?? 'Constituency not named',
            record.topic,
            dateLabel(record),
          )}
        </span>
      </button>

      {linksOut && (
        <a
          href={record.sourceUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Open the article in a new tab"
          onClick={(e) => e.stopPropagation()}
          className="grid w-11 shrink-0 place-items-center border-l border-[var(--border)] text-ink-3 hover:bg-[var(--surface-2)] hover:text-[var(--accent)]"
        >
          <ExternalLink size={15} />
        </a>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Detail
   ═══════════════════════════════════════════════════════════════════════════ */

function RecordDetail({ record, onBack }: { record: GrievanceRecord; onBack: () => void }) {
  const { fake, recommendation } = record

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        /* The record renders BELOW the table at every width, not beside it,
           so `lg:hidden` left desktop readers with no visible way to close
           what they had opened. */
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-2"
      >
        <ArrowLeft size={16} />
        All records
      </button>

      <Card>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone={SEVERITY_TONE[record.severity]}>{record.severity} severity</Chip>
          <Chip tone={sentimentTone(record.sentiment)}>{record.sentiment}</Chip>
          <Chip tone={record.isGrievance ? 'warning' : 'neutral'}>{record.grievanceType}</Chip>
          <Chip tone="neutral">Aimed at {record.target}</Chip>
        </div>

        <h2
          className={cn(
            'mt-2.5 text-lg font-semibold leading-snug',
            isIndicScript(record.headline) && 'te',
          )}
        >
          {record.headline}
        </h2>

        <p className="mt-1 text-xs text-ink-3">
          {metaLine(
            record.publisher ?? hostOf(record.sourceUrl),
            record.publishedAt ? absoluteDate(record.publishedAt) : 'No publication date given',
            record.language,
          )}
        </p>

        <p className="mt-3 rounded-2xl bg-[var(--surface-2)] px-4 py-3 text-sm leading-relaxed text-ink-2">
          {record.summary}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chip tone="accent">{record.topic}</Chip>
          {record.subtopic && <Chip tone="neutral">{record.subtopic}</Chip>}
          {record.narrativeCategory && <Chip tone="neutral">{record.narrativeCategory}</Chip>}
          <Chip tone="neutral" icon={<MapPin size={11} />}>
            {record.constituency ?? 'Constituency not named'}
          </Chip>
        </div>

        <a
          href={record.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-[var(--accent)]"
        >
          <ExternalLink size={15} />
          Open the article
        </a>

        <div className="mt-2">
          <LevelPips
            label="Severity"
            level={record.severity}
            scale={SEVERITIES}
            tone={
              record.severity === 'Critical' || record.severity === 'High' ? 'negative' : 'warning'
            }
          />
        </div>
      </Card>

      <Card>
        <CardHead
          icon={<Users size={16} />}
          title="Who and where"
          sub="From the story itself"
          tint="blue"
        />

        <p className="eyebrow">People named</p>
        {record.namedPersons.length === 0 ? (
          <p className="mt-1 text-sm text-ink-3">Nobody is named in this story.</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {record.namedPersons.map((person, i) => (
              <li key={`${person.name}-${i}`} className="flex items-center gap-2.5 text-sm">
                <span
                  className="icon-badge icon-badge-sm"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <Users size={14} />
                </span>
                <span>
                  <span className="font-medium">{person.name}</span>
                  <span className="text-ink-3">, {person.role ?? 'role not given'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="eyebrow mt-4">Places</p>
        {record.places.length === 0 ? (
          <p className="mt-1 text-sm text-ink-3">No village, mandal or ward is named.</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {record.places.map((place) => (
              <Chip key={place} tone="neutral" icon={<MapPin size={11} />}>
                {place}
              </Chip>
            ))}
          </div>
        )}

        {record.hashtags.length > 0 && (
          <>
            <p className="eyebrow mt-4">
              Hashtags
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {record.hashtags.map((tag) => (
                <Chip key={tag} tone="neutral" icon={<Hash size={11} />}>
                  {normaliseTag(tag)}
                </Chip>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card>
        <CardHead icon={<ShieldAlert size={16} />} title="Is it real?" tint="orange" />

        <div className="flex flex-wrap gap-1.5">
          <Chip tone={SUSPICION_TONE[fake.suspicion]} icon={<ShieldAlert size={11} />}>
            {SUSPICION_LABEL[fake.suspicion]}
          </Chip>
          {fake.type && <Chip tone="neutral">{fake.type}</Chip>}
          <Chip tone="neutral">{fake.debunkStatus}</Chip>
        </div>

        {fake.note && (
          <p className="mt-3 rounded-2xl bg-[var(--surface-2)] px-4 py-3 text-sm leading-relaxed text-ink-2">
            {fake.note}
          </p>
        )}

        {fake.signals.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">
            No signals were found either way.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {fake.signals.map((signal, i) => (
              <li
                key={`${signal.kind}-${i}`}
                className="rounded-2xl bg-[var(--surface-2)] p-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="eyebrow">
                    {SIGNAL_LABEL[signal.kind]}
                  </span>
                  <Chip tone={SUPPORTS_TONE[signal.supports]}>
                    {SUPPORTS_LABEL[signal.supports]}
                  </Chip>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{signal.finding}</p>
                <p className="mt-1 text-2xs text-ink-3">{CONFIDENCE_LABEL[signal.confidence]}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHead
          icon={<Megaphone size={16} />}
          title="What to do"
          sub="Suggested action, priority and channel"
          tint="violet"
        />

        <div className="flex flex-wrap gap-1.5">
          <Chip tone="accent">{recommendation.action}</Chip>
          <Chip tone={PRIORITY_TONE[recommendation.priority]}>
            {recommendation.priority} priority
          </Chip>
          <Chip tone="neutral" icon={<Megaphone size={11} />}>
            {recommendation.channel}
          </Chip>
        </div>

        {recommendation.rationale && (
          <p className="mt-3 rounded-2xl bg-[var(--surface-2)] px-4 py-3 text-sm leading-relaxed text-ink-2">
            {recommendation.rationale}
          </p>
        )}

        <p className="eyebrow mt-4">
          Lines you can use
        </p>
        {recommendation.talkingPoints.length === 0 ? (
          <p className="mt-1 text-sm text-ink-3">
            No lines were drafted for this one, because it is marked {recommendation.action.toLowerCase()}.
          </p>
        ) : (
          <TalkingPoints points={recommendation.talkingPoints} />
        )}
      </Card>
    </div>
  )
}

function TalkingPoints({ points }: { points: string[] }) {
  const [copied, setCopied] = useState<number | null>(null)

  const copy = async (line: string, i: number) => {
    try {
      await navigator.clipboard.writeText(line)
      setCopied(i)
      haptic.success()
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1800)
    } catch {
      /* the clipboard can be blocked; the text is selectable either way */
    }
  }

  return (
    <ul className="mt-2 space-y-2">
      {points.map((point, i) => (
        <li
          key={i}
          className="flex items-start gap-2.5 rounded-2xl bg-[var(--surface-2)] p-3.5"
        >
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-2xs font-semibold text-[var(--accent)]">
            {i + 1}
          </span>
          <p className="flex-1 text-sm leading-relaxed">{point}</p>
          <m.button
            onClick={() => void copy(point, i)}
            whileTap={{ scale: 0.9 }}
            transition={spring.snap}
            aria-label={copied === i ? 'Copied' : 'Copy this line'}
            className="-m-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-3)] hover:text-ink"
          >
            {copied === i ? (
              <Check size={15} className="text-[var(--pos)]" />
            ) : (
              <Copy size={15} />
            )}
          </m.button>
        </li>
      ))}
    </ul>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Issues
   ═══════════════════════════════════════════════════════════════════════════ */

function IssueCard({
  issue,
  position,
  records,
  onOpenRecord,
  person,
}: {
  issue: IssueCluster
  /** Where this card sits in the list on screen, from 1. */
  position: number
  records: GrievanceRecord[]
  onOpenRecord: (id: string) => void
  /** Who the drafted posts speak as. */
  person: SuggestionPerson
}) {
  // The count comes from the cluster, not from what this device happens to
  // hold: a record can be backing an issue and no longer be in the store.
  const backing = issue.recordIds.length
  const missing = backing - records.length

  /**
   * When the records behind this issue are from.
   *
   * One day when they all share it, a span when they do not. Only the records
   * this device actually holds can be dated, so a cluster whose backing is
   * partly missing dates what it has rather than claiming a range it cannot
   * see.
   */
  const issueDates = ((): string | null => {
    const days: string[] = [...new Set(records.map((r) => recordDeskDay(r)))].filter((d): d is string => Boolean(d)).sort()
    if (days.length === 0) return null
    const first = days[0]!
    const last = days[days.length - 1]!
    return first === last ? formatDeskDay(first) : formatDeskDay(first) + ' to ' + formatDeskDay(last)
  })()

  return (
    <Card className="h-full">
      <div className="flex items-start gap-3">
        {/*
          Position in this list, not the number the server gave it.

          `issue.rank` is assigned per batch, so every batch numbers its own
          issues from one. A desk holding three batches showed two 4s and two
          5s side by side, which reads as a bug because it is one. The rank
          still decides the ORDER, up in the issues memo; what is drawn here
          is simply where the card sits.
        */}
        <span className="num grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-sm text-[var(--accent)]">
          {position}
        </span>
        <div className="min-w-0">
          <h3 className={cn('font-semibold leading-snug', isIndicScript(issue.title) && 'te')}>
            {issue.title}
          </h3>
          <p className="mt-1 text-xs text-ink-3">
            {/* When, not just how many. An issue card carried a count and a
                place and nothing about time, so a cluster built from last
                week read exactly like one built this morning. */}
            {metaLine(
              `${backing} ${pluralise(backing, 'record')} behind it`,
              issueDates,
              issue.constituency ?? 'Constituency not named',
            )}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Chip tone="accent">{issue.category}</Chip>
        <Chip tone={SEVERITY_TONE[issue.severity]}>{issue.severity} severity</Chip>
        <Chip tone={sentimentTone(issue.sentiment)}>{issue.sentiment}</Chip>
      </div>

      {issue.summary && (
        <p className="mt-3 text-sm leading-relaxed text-ink-2">{issue.summary}</p>
      )}

      {issue.places.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {issue.places.map((place) => (
            <Chip key={place} tone="neutral" icon={<MapPin size={11} />}>
              {place}
            </Chip>
          ))}
        </div>
      )}

      <p className="eyebrow mt-4">
        Who is driving it
      </p>
      <p className="mt-1 border-l-2 border-[var(--rule)] pl-3 text-sm leading-relaxed text-ink-2">
        {issue.politicalInvolvement ?? 'Not established from these records.'}
      </p>

      <p className="eyebrow mt-3">
        What to say back
      </p>
      <p className="mt-1 border-l-2 border-[var(--rule)] pl-3 text-sm leading-relaxed text-ink-2">
        {issue.counterNarrative ?? 'No counter-narrative drafted yet.'}
      </p>

      <IssueSuggestions issue={issue} records={records} person={person} />

      {records.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {records.map((record) => (
            <li key={record.id}>
              <button
                onClick={() => onOpenRecord(record.id)}
                className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-[var(--surface-2)]"
              >
                <span
                  aria-hidden
                  className="h-4 w-1 shrink-0 rounded-full"
                  style={{ background: SEVERITY_COLOUR[record.severity] }}
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-sm',
                    isIndicScript(record.headline) && 'te',
                  )}
                >
                  {record.headline}
                </span>
                <span className="shrink-0 text-2xs text-ink-3">{record.severity}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {missing > 0 && (
        <p className="mt-2 text-xs text-ink-3">
          {missing} more {pluralise(missing, 'record')} backs this issue but is not on this device.
        </p>
      )}

      {issue.evidenceUrls.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {issue.evidenceUrls.slice(0, 4).map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1 text-xs text-[var(--accent)]"
            >
              <ExternalLink size={12} />
              {hostOf(url)}
            </a>
          ))}
        </div>
      )}
    </Card>
  )
}

/**
 * "What to say about it": three or four posts the office could publish.
 *
 * Drafted on request, never automatically. Each draft is a model call, and an
 * office scrolling past twelve issues should not spend twelve calls to do it.
 * What was drafted is cached per issue and shown from the cache on every
 * revisit; pressing the button again overwrites this issue's drafts and no
 * other's.
 *
 * On failure the server's own sentence is shown and nothing else. A card that
 * filled itself with stand-in posts would be this product publishing under
 * the member's name the one thing it promised never to do: words grounded in
 * nothing.
 */
function IssueSuggestions({
  issue,
  records,
  person,
}: {
  issue: IssueCluster
  records: GrievanceRecord[]
  person: SuggestionPerson
}) {
  // Read once on mount. The cards are keyed by issue id, so a different issue
  // is a fresh mount and the initializer runs again.
  const [entry, setEntry] = useState<SuggestionEntry | null>(() => readSuggestions(issue.id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  const draft = async () => {
    setBusy(true)
    setError(null)
    try {
      const posts = await fetchSuggestions(
        {
          title: issue.title,
          summary: issue.summary,
          category: issue.category,
          severity: issue.severity,
        },
        records
          .slice(0, 5)
          .map((r) => ({ headline: r.headline, excerpt: r.excerpt, publisher: r.publisher })),
        person,
      )
      saveSuggestions(issue.id, posts)
      // Re-read rather than constructed, so the timestamp on screen is the one
      // actually stored. In private mode the write fails silently and the
      // fallback keeps the drafts on screen for this session.
      setEntry(readSuggestions(issue.id) ?? { generatedAt: new Date().toISOString(), posts })
      haptic.success()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The posts could not be drafted. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const copy = async (line: string, i: number) => {
    try {
      await navigator.clipboard.writeText(line)
      setCopied(i)
      haptic.success()
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1800)
    } catch {
      /* the clipboard can be blocked; the text is selectable either way */
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">What to say about it</p>
        <Button size="sm" variant="outline" onClick={() => void draft()} disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle size={14} className="animate-spin" />
              Drafting…
            </>
          ) : (
            <>
              <Pencil size={14} />
              {entry ? 'Draft again' : 'Draft posts'}
            </>
          )}
        </Button>
      </div>

      {error && <p className="mt-2 text-xs leading-relaxed text-[var(--neg)]">{error}</p>}

      {entry && entry.posts.length > 0 ? (
        <>
          <ul className="mt-2 space-y-2">
            {entry.posts.map((post, i) => (
              <li key={i} className="rounded-2xl bg-[var(--surface-2)] p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="eyebrow">{post.angle}</span>
                  <m.button
                    onClick={() => void copy(post.text, i)}
                    whileTap={{ scale: 0.9 }}
                    transition={spring.snap}
                    aria-label={copied === i ? 'Copied' : 'Copy this post'}
                    className="-m-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-3)] hover:text-ink"
                  >
                    {copied === i ? (
                      <Check size={15} className="text-[var(--pos)]" />
                    ) : (
                      <Copy size={15} />
                    )}
                  </m.button>
                </div>
                <p className="text-sm leading-relaxed">{post.text}</p>
                <div className="mt-2">
                  <Chip tone="neutral">{post.platform}</Chip>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-2xs text-ink-3">
            Drafted {absoluteDate(entry.generatedAt)} · check every post before it goes out
          </p>
        </>
      ) : (
        !busy &&
        !error && (
          <p className="mt-1.5 text-sm leading-relaxed text-ink-3">
            No posts have been drafted for this issue yet.
          </p>
        )
      )}
    </div>
  )
}
