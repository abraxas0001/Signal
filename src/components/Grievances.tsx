import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  ExternalLink,
  Filter,
  Hash,
  Inbox,
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
import { CONSTITUENCIES, bySeverityThenRecency } from '@shared/grievance'
import { partyAbbreviation } from '@shared/identity'
import {
  formatDeskDay,
  groupByDay,
  isToday,
  recordDeskDay,
  recordsOnDay,
  shiftDay,
  todayDeskDay,
} from '@/lib/desk-day'
import { downloadGrievanceCsv, downloadGrievanceWorkbook } from '@/lib/grievance-export'
import { ExportButton } from '@/components/ExportButton'
import { Mascot } from './Mascot'
import type {
  ActionPriority,
  ConfidenceTier,
  FakeSuspicion,
  Sentiment,
  Severity,
  Topic,
} from '@shared/taxonomy'
import { SENTIMENT_SCORE, SEVERITIES, SEVERITY_RANK, TOPICS } from '@shared/taxonomy'
import { Button, Card, Chip, PageHeader, selectClass, type ChipTone } from './ui'
import { CardHead } from '@/components/kit'
/**
 * The desk's own configuration — papers, words, links — lives in the shared
 * settings module now, because Settings renders the identical panel inside
 * its "Grievance desk settings" section. One component, two doors.
 */
import { DeskSetup, useDeskProfile } from '@/components/settings/DeskConfig'
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

const constituencyOrder = (name: string): number => {
  const at = CONSTITUENCIES.findIndex((c) => c === name)
  return at === -1 ? CONSTITUENCIES.length : at
}

const topicOrder = (topic: Topic): number => TOPICS.findIndex((t) => t === topic)

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

/**
 * What the search box looks in.
 *
 * Issue-level text only — title, summary, seat, the places named. Deliberately
 * NOT the text of every backing record: searching those would match an issue on
 * a word that appears in one story out of forty, and the reader would have no
 * way to see why it matched.
 */
const issueHaystack = (issue: IssueCluster): string =>
  [issue.title, issue.summary, issue.constituency ?? '', issue.places.join(' ')]
    .join(' ')
    .toLowerCase()

/**
 * Suspicion levels that count as flagged.
 *
 * 'Unsure' is excluded on purpose: it is the reader declining to call it, not a
 * finding. Treating it as a flag would fill the filter with everything nobody
 * was certain about, which is most things.
 */
const FLAGGED_SUSPICION: readonly FakeSuspicion[] = ['Likely', 'Yes']

/**
 * Does this issue match?
 *
 * `byId` is needed because the flag lives on the RECORD, not the issue —
 * `IssueCluster` carries no fake assessment, so the only path is through its
 * backing records. That join is why this takes a lookup rather than being a
 * pure function of the issue.
 */
function issueMatches(
  issue: IssueCluster,
  filters: IssueFilters,
  byId: Map<string, GrievanceRecord>,
): boolean {
  if (filters.severities.length > 0 && !filters.severities.includes(issue.severity)) return false
  if (filters.category && issue.category !== filters.category) return false

  const query = filters.text.trim().toLowerCase()
  if (query && !issueHaystack(issue).includes(query)) return false

  if (filters.flagged) {
    const anyFlagged = issue.recordIds.some((id) => {
      const record = byId.get(id)
      return record !== undefined && FLAGGED_SUSPICION.includes(record.fake.suspicion)
    })
    if (!anyFlagged) return false
  }

  return true
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

const haystack = (r: GrievanceRecord): string =>
  [
    r.headline,
    r.summary,
    r.excerpt,
    r.topic,
    r.subtopic ?? '',
    r.publisher ?? '',
    r.constituency ?? '',
    r.places.join(' '),
    r.namedPersons.map((p) => p.name).join(' '),
    r.hashtags.join(' '),
    r.sourceUrl,
  ]
    .join(' ')
    .toLowerCase()

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

export function Grievances({
  onClose,
  mode = 'issues',
  embedded = false,
  focusIssueId = null,
}: {
  onClose: () => void
  mode?: DeskMode
  /** True when rendered inside Settings, which carries its own desk config. */
  embedded?: boolean
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

  const records = useMemo(
    () => [...store.grievances].sort((a, b) => bySeverityThenRecency(SEVERITY_RANK, a, b)),
    [store.grievances],
  )

  /** The desk day being looked at. Declared here because the issue list
      below is scoped to it, not only the record list further down. */
  const [day, setDay] = useState(() => todayDeskDay())

  const issues = useMemo(
    () =>
      [...store.issues].sort(
        (a, b) => issueRank(a) - issueRank(b) || b.recordIds.length - a.recordIds.length,
      ),
    [store.issues],
  )

  // Every record ever filed, so an issue can still resolve the records behind
  // it when the desk has stepped to another day.
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records])

  /**
   * The issue filters.
   *
   * Component state rather than the store: this is a view somebody sets while
   * looking for something, not a preference they want back tomorrow. Persisting
   * it would mean an office opens the app to a filtered list it does not
   * remember setting, and concludes the desk has gone quiet.
   */
  const [issueFilters, setIssueFilters] = useState<IssueFilters>(NO_ISSUE_FILTERS)

  /**
   * Issues on the day being looked at, then the filters.
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
        return held.some((r) => recordDeskDay(r) === day)
      }),
    [issues, byId, day],
  )

  const visibleIssues = useMemo(
    () => dayIssues.filter((issue) => issueMatches(issue, issueFilters, byId)),
    [dayIssues, issueFilters, byId],
  )

  /**
   * Only the categories actually present.
   *
   * TOPICS carries twenty-odd values and a desk sees four or five of them. A
   * dropdown listing "Electricity" when no issue is about electricity is a
   * control that promises a result and delivers an empty list.
   */
  const issueCategories = useMemo(() => {
    const present = new Set(issues.map((i) => i.category))
    return [...present].sort((a, b) => topicOrder(a) - topicOrder(b))
  }, [issues])

   /** Whether the flag filter would ever do anything on this desk. */
  const anyFlagged = useMemo(
    () =>
      issues.some((issue) =>
        issue.recordIds.some((id) => {
          const record = byId.get(id)
          return record !== undefined && FLAGGED_SUSPICION.includes(record.fake.suspicion)
        }),
      ),
    [issues, byId],
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
    * What an export would contain.
    *
    * This was `dayRecords` in both views, and in the issues view that is the
    * wrong set twice over. An issue is a cluster of records filed across
    * several days, so exporting "today" gave an office a file that did not
    * contain the issue they were looking at — and on a morning when the scan
    * had filed nothing yet, `dayRecords` was empty, the button was `disabled`,
    * and pressing it did nothing whatsoever. That is the button that was
    * reported broken.
    *
    * So: export what is on screen. In the issues view that means the records
    * behind the issues that survived the filters — set a filter, and the sheet
    * narrows with the list. In the records view it stays the day being read.
    */
   const exportRecords = useMemo(() => {
     if (mode === 'records') return dayRecords
     const wanted = new Set(visibleIssues.flatMap((i) => i.recordIds))
     // Ordered by the issue list rather than by filing date, so the sheet reads
     // in the same order as the screen it came from.
     return [...wanted].map((id) => byId.get(id)).filter((r): r is GrievanceRecord => r !== undefined)
   }, [mode, dayRecords, visibleIssues, byId])
  const otherDays = useMemo(
    () => groupByDay(records).filter((b) => b.day !== day).length,
    [records, day],
  )

  const options = useMemo(() => {
    const constituencies = new Set<string>()
    const topics = new Set<Topic>()
    const persons = new Set<string>()
    const tags = new Set<string>()

    for (const r of dayRecords) {
      if (r.constituency) constituencies.add(r.constituency)
      topics.add(r.topic)
      for (const p of r.namedPersons) persons.add(p.name)
      for (const h of r.hashtags) tags.add(normaliseTag(h))
    }

    return {
      // The office's own segments first, in the order they think of them; any
      // constituency a story dragged in follows, alphabetically.
      constituencies: [...constituencies].sort(
        (a, b) => constituencyOrder(a) - constituencyOrder(b) || a.localeCompare(b),
      ),
      topics: [...topics].sort((a, b) => topicOrder(a) - topicOrder(b)),
      persons: [...persons].sort((a, b) => a.localeCompare(b)),
      tags: [...tags].sort((a, b) => a.localeCompare(b)),
    }
  }, [dayRecords])

  const visible = useMemo(() => {
    const query = filters.text.trim().toLowerCase()
    return dayRecords.filter((r) => {
      if (filters.constituency && r.constituency !== filters.constituency) return false
      if (filters.topic && r.topic !== filters.topic) return false
      if (filters.severity && r.severity !== filters.severity) return false
      if (filters.person && !r.namedPersons.some((p) => p.name === filters.person)) return false
      if (filters.hashtag && !r.hashtags.some((h) => normaliseTag(h) === filters.hashtag))
        return false
      if (query && !haystack(r).includes(query)) return false
      return true
    })
  }, [dayRecords, filters])

  const activeFilters = useMemo(
    () => Object.values(filters).filter((v) => v !== '').length,
    [filters],
  )

  const selected = useMemo(
    () => records.find((r) => r.id === selectedId) ?? null,
    [records, selectedId],
  )

  const parsed = useMemo(() => parseDraft(draft), [draft])

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
      // The party is watched, but only alongside something narrower. On its own
      // it returns the national wire: twenty-three stories about the party and
      // none about this member.
      broadTags: short ? [short] : party ? [party] : [],
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
          lead={
            <Mascot
              state={running ? 'thinking' : dayRecords.length ? 'idle' : 'empty'}
              size={40}
              className="mt-1 shrink-0"
            />
          }
          title="Grievance desk"
          subtitle={
            /* Both numbers are scoped to the day on screen. The old pairing
               put the day's records beside the archive's issue total, so the
               header said "3 records · 8 issues" over a list of three and the
               other five were nowhere a reader could find. */
            dayRecords.length
              ? `${dayRecords.length} ${pluralise(dayRecords.length, 'record')} · ${dayIssues.length} ${pluralise(dayIssues.length, 'issue')} on this day`
              : 'Paste the morning’s news links.'
          }
          actions={
            <>
              {/* Shows and hides the desk's own configuration, right here.
                  Absent when Settings embeds this screen — a pencil there
                  would be a door into the room the reader is standing in. */}
              {!embedded && (
                <Button
                  variant="ghost"
                  onClick={() => setEditing((v) => !v)}
                  aria-label={editing ? 'Close the desk settings' : 'Edit the desk'}
                  title={editing ? 'Close the desk settings' : 'Edit the desk'}
                  aria-pressed={editing}
                  // Square. The default md padding is px-6, which framed a
                  // 16px icon in a 64px-wide box and left it adrift beside
                  // the button next to it.
                  className={cn('size-12 px-0', editing && 'bg-[var(--accent-soft)] text-[var(--accent)]')}
                >
                  <Pencil size={16} aria-hidden />
                </Button>
              )}
              <Button variant="ghost" onClick={onClose}>
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

      {/* The day being read.
          A grievance desk is a daily instrument — the office works today's news
          and yesterday's should not be in the way. Everything filed is kept and
          reachable by stepping back a day; only the day on screen changes.

          A flat .panel, not the floating shadowed pill it was: this row is a
          toolbar, and dressed as a lifted card it competed with the record
          cards below for first read. The stepper is grouped so it wraps as one
          unit at 390px, with the action cluster taking its own right-aligned
          row underneath instead of shuffling control by control. */}
      <m.div
        variants={fadeUp}
        className="panel mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            onClick={() => setDay(shiftDay(day, -1))}
            aria-label="Previous day"
            className="grid size-11 place-items-center rounded-full text-ink-2 hover:bg-[var(--surface-2)]"
          >
            <ChevronLeft size={16} />
          </button>

          <span className="text-sm font-semibold">
            {isToday(day) ? 'Today' : formatDeskDay(day)}
          </span>
          {isToday(day) && (
            <span className="kicker">
              {formatDeskDay(day)}
            </span>
          )}

          <button
            onClick={() => setDay(shiftDay(day, 1))}
            disabled={isToday(day)}
            aria-label="Next day"
            className="grid size-11 place-items-center rounded-full text-ink-2 hover:bg-[var(--surface-2)] disabled:opacity-35"
          >
            <ChevronRight size={16} />
          </button>

          {!isToday(day) && (
            <Button size="sm" variant="ghost" onClick={() => setDay(todayDeskDay())}>
              Back to today
            </Button>
          )}
        </div>

        {/* Drops to its own full-width row on phones. Right-aligned wrapping
            stranded Export alone on a second line under Sync and Clear, which
            read as a mistake; across the full width the three actions sit in
            one even row instead. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2 max-sm:ml-0 max-sm:w-full max-sm:flex-nowrap max-sm:justify-between max-sm:[&_button]:px-3">
          {/*
            Fetch today now, rather than waiting for the morning.

            The desk fills itself at 07:30 and there was no way to ask it
            again. An office that arrives to a story breaking at eleven had to
            either paste links by hand or wait until tomorrow, which is the
            opposite of what a monitoring desk is for.

            It runs the same scan the morning job runs, so nothing here is a
            second code path that can drift from it. The 07:30 run is
            unaffected and still happens.

            Only on today. Pressing it while looking at last Tuesday would
            file this morning's news under a day the office is not looking at,
            which reads as the button having done nothing.

            The button no longer carries the report of what happened. It said
            "Looking\u2026" and then "Reading\u2026" for three minutes and nothing else,
            which is the complaint that produced ScanProgress: the panel below
            says which stage is running, how many stories are read against how
            many were found, and what each failure was.
          */}
          {isToday(day) && (
            <Button
              size="sm"
              variant="outline"
              onClick={syncToday}
              disabled={scanning || running || !scanReady}
              title={
                scanReady
                  ? 'Look for today\u2019s news now, without waiting for the 07:30 scan'
                  : 'Choose which papers to read first, under Sources.'
              }
            >
              <RefreshCw
                size={14}
                className={scanning || running ? 'animate-spin motion-reduce:animate-none' : undefined}
              />
              {job.status === 'scanning'
                ? 'Reading the papers\u2026'
                : job.status === 'reading'
                  ? 'Reading the stories\u2026'
                  : scanning
                    ? 'Looking\u2026'
                    : 'Sync today'}
            </Button>
          )}
          {otherDays > 0 && (
            <span className="kicker hidden sm:inline">
              {otherDays} earlier {pluralise(otherDays, 'day')} kept
            </span>
          )}
          {/* Clearing the day, not the archive.
              An office testing the desk needs to empty it and try again, and
              deleting only what is on screen means a bad morning's scan can be
              thrown away without losing the records filed last week. */}
          <Button
            size="sm"
            variant="ghost"
            disabled={dayRecords.length === 0}
            onClick={() => {
              const ids = new Set(dayRecords.map((r) => r.id))
              if (
                !window.confirm(
                  `Delete ${dayRecords.length} ${pluralise(dayRecords.length, 'record')} filed on ${formatDeskDay(day)}? Records from other days are kept. This cannot be undone.`,
                )
              ) {
                return
              }
              update((s) => ({
                ...s,
                grievances: s.grievances.filter((r) => !ids.has(r.id)),
                // An issue whose every record just went is no longer an issue.
                issues: s.issues
                  .map((i) => ({ ...i, recordIds: i.recordIds.filter((x) => !ids.has(x)) }))
                  .filter((i) => i.recordIds.length > 0),
              }))
              setSelectedId(null)
            }}
          >
            <Trash2 size={14} />
            Clear
          </Button>
          {/* Excel first — it is the banded sheet with the fake-check tab,
              which is what this office actually files. CSV beside it, because
              that is the format the button used to claim and never produced. */}
          <ExportButton
            count={exportRecords.length}
            noun="record"
            run={(format) => {
              const label = mode === 'records' ? day : 'issues'
              return format === 'csv'
                ? downloadGrievanceCsv(exportRecords, label)
                : downloadGrievanceWorkbook(exportRecords, label)
            }}
          />
        </div>
      </m.div>

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
      {tab === 'records' ? (
        <div
          role="tabpanel"
          id="desk-panel-records"
          aria-labelledby="desk-tab-records"
          className="mt-4"
        >
          {/* One column, and a record replaces the list rather than sitting
              beside it.

              This was a two-pane split on desktop. It read as confusing and it
              scrolled badly, because the panes were independently scrollable and
              a sticky detail column next to a long list gives two scrollbars
              that disagree about where you are. A list you drill into has one
              place to look and one place to scroll, and it behaves the same on a
              phone as on a laptop, which is the whole reason the office can be
              taught it once. */}
          <div className={cn('min-w-0 space-y-4', selected && 'hidden')}>
            {/* The scan's outcome is printed beside the Scan button, in both the
                collapsed strip and the expanded steps. It was also a card of its
                own up here, which meant a successful scan reported itself twice
                on one screen.

                The desk-config values and writes the panel used to be handed
                one prop at a time all live in useDeskProfile now, which the
                panel calls itself — Settings renders the same configuration
                through the same hook, so there is exactly one set of profile
                writes to get wrong. */}
            {intakeOpen ? (
              <IntakePanel
                draft={draft}
                onDraft={setDraft}
                links={parsed.links}
                unusable={parsed.unusable}
                running={running}
                canHide={dayRecords.length > 0}
                onHide={() => setIntakeOpen(false)}
                onRead={() => readLinks(parsed.links.map((l) => l.url))}
                onRetryFailed={() => readLinks(failedLinks.map((l) => l.url))}
                failedCount={failedLinks.length}
              />
            ) : (
              <Button variant="outline" className="w-full" onClick={() => setIntakeOpen(true)}>
                <Plus size={16} />
                Add news links
              </Button>
            )}

            {dayRecords.length > 0 && (
              <FilterBar
                filters={filters}
                onChange={setFilters}
                options={options}
                active={activeFilters}
                shown={visible.length}
                total={dayRecords.length}
              />
            )}

            {dayRecords.length === 0 ? (
              <EmptyDesk />
            ) : visible.length === 0 ? (
              <Card>
                <CardHead
                  icon={<Filter size={16} />}
                  title="Nothing matches all of those filters"
                  sub="Every filter has to be true at once"
                  tint="blue"
                />
                <p className="text-sm text-ink-3">Drop one, or clear them all.</p>
                <Button variant="outline" className="mt-3" onClick={() => setFilters(NO_FILTERS)}>
                  Clear filters
                </Button>
              </Card>
            ) : (
              <m.ul
                className="space-y-2"
                variants={listStaggerFast}
                initial={reduced ? false : 'hidden'}
                animate="show"
              >
                {visible.map((record) => (
                  <m.li key={record.id} variants={listItem}>
                    <RecordRow
                      record={record}
                      active={record.id === selectedId}
                      onOpen={() => openRecord(record.id)}
                    />
                  </m.li>
                ))}
              </m.ul>
            )}
          </div>

          <div
            className={cn(
              'min-w-0',
              selected ? 'block' : 'hidden',
            )}
          >
            {/* Nothing stands in for an unopened record any more. The empty
                "Pick a record" panel existed only to stop the right-hand column
                collapsing, and with the split gone it was half a screen of
                desktop spent saying nothing. */}
            {selected && <RecordDetail record={selected} onBack={() => setSelectedId(null)} />}
          </div>
        </div>
      ) : (
        <div
          role="tabpanel"
          id="desk-panel-issues"
          aria-labelledby="desk-tab-issues"
          className="mt-4"
        >
          {issues.length > 0 && (
            <IssueFilterBar
              filters={issueFilters}
              onChange={setIssueFilters}
              categories={issueCategories}
              showFlagged={anyFlagged}
              /* Day-scoped, like the list it sits over. Against the archive
                 total the label read "8 issues" above three cards. */
              shown={visibleIssues.length}
              total={dayIssues.length}
            />
          )}

          {issues.length === 0 ? (
            <Card>
              <CardHead
                icon={<Layers size={16} />}
                title="No issues yet"
                sub="Issues appear once enough links have been read"
                tint="violet"
              />
            </Card>
          ) : dayIssues.length === 0 ? (
            /* The desk has issues, just none live on this day. Distinct from
               both cards below: "no issues yet" would deny the archive, and
               the filter card would blame controls the reader never touched. */
            <Card>
              <CardHead
                icon={<Layers size={16} />}
                title="Nothing live on this day"
                sub={`${issues.length} ${pluralise(issues.length, 'issue')} on the days either side`}
                tint="violet"
              />
            </Card>
          ) : visibleIssues.length === 0 ? (
            /* A filter combination that matches nothing is a completely
               different situation from a desk with no issues, and saying "no
               issues yet" here would tell an office its week was quiet when it
               has thirty issues and a typo in the search box. */
            <Card>
              {/* A short static title with the count on the quiet line beneath:
                  the old single-line heading carried the number inside it and
                  truncated on a 375px screen at exactly the words that mattered. */}
              <CardHead
                icon={<Filter size={16} />}
                title="Nothing matches these filters"
                sub={`All ${dayIssues.length} ${pluralise(dayIssues.length, 'issue')} on this day are hidden by them`}
                tint="blue"
              />
              <p className="text-sm text-ink-3">Loosen one, or clear them and start again.</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => setIssueFilters(NO_ISSUE_FILTERS)}
              >
                <X size={14} />
                Clear filters
              </Button>
            </Card>
          ) : (
            <m.ul
              className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0"
              variants={listStaggerFast}
              initial={reduced ? false : 'hidden'}
              animate="show"
            >
              {visibleIssues.map((issue, at) => (
                <m.li
                  key={issue.id}
                  variants={listItem}
                  ref={issue.id === focusIssueId ? focusRef : undefined}
                  className={
                    issue.id === focusIssueId
                      ? 'rounded-[var(--radius-lg)] ring-2 ring-[var(--accent)] ring-offset-4 ring-offset-[var(--bg)]'
                      : undefined
                  }
                >
                  <IssueCard
                    issue={issue}
                    position={at + 1}
                    records={issue.recordIds.flatMap((id) => {
                      const record = byId.get(id)
                      return record ? [record] : []
                    })}
                    onOpenRecord={openRecord}
                    person={person}
                  />
                </m.li>
              ))}
            </m.ul>
          )}
        </div>
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
}: {
  record: GrievanceRecord
  active: boolean
  onOpen: () => void
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
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-2 lg:hidden"
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
