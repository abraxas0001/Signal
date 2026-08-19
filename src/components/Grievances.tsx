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
  Download,
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
import type {
  FakeAssessment,
  FakeSignal,
  GrievanceRecord,
  IssueCluster,
  NamedPerson,
  Recommendation,
} from '@shared/grievance'
import {
  ASSEMBLY_TELUGU,
  CONSTITUENCIES,
  DISTRICT_PAGES_ARE_GEO_GATED,
  NEWS_SOURCES,
  bySeverityThenRecency,
  suggestedTagsFor,
} from '@shared/grievance'
import { ALL_STATES, REGIONS, citiesOf, portalsForState } from '@shared/regions'
import { partyAbbreviation } from '@shared/identity'
import {
  formatDeskDay,
  groupByDay,
  isToday,
  recordsOnDay,
  shiftDay,
  todayDeskDay,
} from '@/lib/desk-day'
import { downloadGrievanceWorkbook } from '@/lib/grievance-export'
import { Mascot } from './Mascot'
import type {
  ActionPriority,
  ConfidenceTier,
  FakeSuspicion,
  Sentiment,
  Severity,
  Topic,
} from '@shared/taxonomy'
import {
  ACTION_CATEGORIES,
  ACTION_PRIORITIES,
  COMMS_CHANNELS,
  CONFIDENCE_TIERS,
  DEBUNK_STATUSES,
  FAKE_NEWS_TYPES,
  FAKE_SUSPICION,
  GRIEVANCE_TYPES,
  NARRATIVE_CATEGORIES,
  SENTIMENTS,
  SENTIMENT_SCORE,
  SEVERITIES,
  SEVERITY_RANK,
  TARGETS,
  TOPICS,
} from '@shared/taxonomy'
import { Bar, Button, Card, Chip, PageHeader, SectionTitle, type ChipTone } from './ui'
import { LevelPips } from './charts'
import { makeId, update, useStore } from '@/lib/store'
import { absoluteDate, cn, hostOf, isIndicScript, pluralise } from '@/lib/utils'
import { fadeUp, haptic, listItem, listStaggerFast, spring } from '@/lib/motion'

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

   POST /api/grievance   { urls: string[], stream?: boolean }
     stream → text/event-stream: one `record` or `failed` event per link, a
              `clusters` event for the batch, then `done`.
     plain  → { results: [{ url, ok, record | error }], clusters, incomplete }
              or the bare contract shape, { records, issues }.
     non-200 → { error?: string }

   The whole list goes in one request rather than one request per link. Two
   reasons, and the second is the one that decided it: the events give per-link
   progress anyway, and issues are clustered across whatever the server saw in
   that call — a request carrying one link can only ever cluster it with
   itself, which would make the Issues tab a second copy of the list.

   Anything the server does not settle — links it capped, links its deadline
   cut off — simply goes round again in the next request. Nothing here needs to
   know what the server's batch limit is; it only needs to notice what came
   back unread.

   Everything crossing this seam is checked before it reaches the store. A
   half-parsed record is worse than one that never arrived: it sorts wrong,
   filters wrong, and looks authoritative while doing it. Anything that fails
   the check is reported against its URL, so the office knows which link to
   paste again rather than wondering why nine went in and eight came out.
   ═══════════════════════════════════════════════════════════════════════════ */

type Json = Record<string, unknown>

/** The one cast in the file, and it is a checked one — everything else narrows. */
function asObject(value: unknown): Json | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Json
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const textList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const t = text(item)
        return t ? [t] : []
      })
    : []

/** `includes` does not narrow the value; `find` returns the member itself. */
const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null =>
  typeof value === 'string' ? (list.find((member) => member === value) ?? null) : null

/** Declared from the contract rather than retyped, so the two cannot drift. */
const SIGNAL_KINDS: readonly FakeSignal['kind'][] = [
  'provenance',
  'recirculation',
  'source',
  'consistency',
  'corroboration',
]
const SIGNAL_SUPPORTS: readonly FakeSignal['supports'][] = [
  'authentic',
  'fabricated',
  'inconclusive',
]

function toPerson(raw: unknown): NamedPerson | null {
  const o = asObject(raw)
  if (!o) return null
  const name = text(o.name)
  return name ? { name, role: text(o.role) } : null
}

function toSignal(raw: unknown): FakeSignal | null {
  const o = asObject(raw)
  if (!o) return null
  const kind = oneOf(SIGNAL_KINDS, o.kind)
  const supports = oneOf(SIGNAL_SUPPORTS, o.supports)
  const confidence = oneOf(CONFIDENCE_TIERS, o.confidence)
  const finding = text(o.finding)
  if (!kind || !supports || !confidence || !finding) return null
  return { kind, finding, confidence, supports }
}

function toFake(raw: unknown): FakeAssessment | null {
  const o = asObject(raw)
  if (!o) return null
  const suspicion = oneOf(FAKE_SUSPICION, o.suspicion)
  const debunkStatus = oneOf(DEBUNK_STATUSES, o.debunkStatus)
  if (!suspicion || !debunkStatus) return null
  return {
    suspicion,
    type: oneOf(FAKE_NEWS_TYPES, o.type),
    debunkStatus,
    signals: Array.isArray(o.signals)
      ? o.signals.flatMap((s) => {
          const signal = toSignal(s)
          return signal ? [signal] : []
        })
      : [],
    note: text(o.note),
  }
}

function toRecommendation(raw: unknown): Recommendation | null {
  const o = asObject(raw)
  if (!o) return null
  const action = oneOf(ACTION_CATEGORIES, o.action)
  const priority = oneOf(ACTION_PRIORITIES, o.priority)
  const channel = oneOf(COMMS_CHANNELS, o.channel)
  if (!action || !priority || !channel) return null
  return {
    action,
    priority,
    talkingPoints: textList(o.talkingPoints),
    channel,
    rationale: text(o.rationale) ?? '',
  }
}

function toRecord(raw: unknown, requestedUrl: string): GrievanceRecord | null {
  const o = asObject(raw)
  if (!o) return null

  const headline = text(o.headline)
  const summary = text(o.summary)
  const topic = oneOf(TOPICS, o.topic)
  const severity = oneOf(SEVERITIES, o.severity)
  const sentiment = oneOf(SENTIMENTS, o.sentiment)
  const grievanceType = oneOf(GRIEVANCE_TYPES, o.grievanceType)
  const target = oneOf(TARGETS, o.target)
  const fake = toFake(o.fake)
  const recommendation = toRecommendation(o.recommendation)

  // Refused rather than patched up. A record whose severity did not survive the
  // trip would still take a place in the list, still colour a stripe, still
  // decide what the MLA is shown first — off a value nobody sent. Better the
  // link is listed as failed with a reason the office can act on.
  if (!headline || !summary || !topic || !severity || !sentiment) return null
  if (!grievanceType || !target || !fake || !recommendation) return null

  return {
    // Ids and timestamps are bookkeeping, not findings, so the app supplies
    // them when the server does not. createdAt then means "read on this
    // device", which is exactly what the list sorts by.
    id: text(o.id) ?? makeId('grv'),
    createdAt: text(o.createdAt) ?? new Date().toISOString(),
    sourceUrl: text(o.sourceUrl) ?? requestedUrl,
    publisher: text(o.publisher),
    headline,
    publishedAt: text(o.publishedAt),
    language: text(o.language),
    excerpt: text(o.excerpt) ?? '',
    topic,
    subtopic: text(o.subtopic),
    constituency: text(o.constituency),
    places: textList(o.places),
    isGrievance: o.isGrievance === true,
    grievanceType,
    severity,
    target,
    namedPersons: Array.isArray(o.namedPersons)
      ? o.namedPersons.flatMap((p) => {
          const person = toPerson(p)
          return person ? [person] : []
        })
      : [],
    hashtags: textList(o.hashtags),
    sentiment,
    narrativeCategory: oneOf(NARRATIVE_CATEGORIES, o.narrativeCategory),
    summary,
    fake,
    recommendation,
  }
}

function toIssue(raw: unknown): IssueCluster | null {
  const o = asObject(raw)
  if (!o) return null
  const title = text(o.title)
  const category = oneOf(TOPICS, o.category)
  const severity = oneOf(SEVERITIES, o.severity)
  const sentiment = oneOf(SENTIMENTS, o.sentiment)
  if (!title || !category || !severity || !sentiment) return null
  return {
    id: text(o.id) ?? makeId('iss'),
    rank: typeof o.rank === 'number' && Number.isFinite(o.rank) ? o.rank : 0,
    title,
    category,
    summary: text(o.summary) ?? '',
    sentiment,
    severity,
    constituency: text(o.constituency),
    places: textList(o.places),
    recordIds: textList(o.recordIds),
    evidenceUrls: textList(o.evidenceUrls),
    politicalInvolvement: text(o.politicalInvolvement),
    counterNarrative: text(o.counterNarrative),
  }
}

const toIssues = (raw: unknown): IssueCluster[] =>
  Array.isArray(raw)
    ? raw.flatMap((i) => {
        const issue = toIssue(i)
        return issue ? [issue] : []
      })
    : []

const STOPPED = 'Stopped before this link was read. Read again to finish it.'

const UNREADABLE =
  'The service answered for this link, but the record was not in a shape this app can read. Read it again; if it keeps happening the grievance service needs looking at.'

const networkMessage = (err: unknown): string =>
  err instanceof Error && err.message
    ? `Could not reach the grievance service (${err.message}). Check the connection and read these links again.`
    : 'Could not reach the grievance service. Check the connection and read these links again.'

/**
 * A status turned into something the reader can act on.
 *
 * "The server responded with 404" is true and useless on a phone at a public
 * meeting. Each of these says what to do next instead.
 */
async function explainResponse(res: Response): Promise<string> {
  let fallback: string
  switch (res.status) {
    case 404:
      fallback =
        'The grievance service is not answering. If the app was just updated, that part may not be published yet.'
      break
    case 401:
    case 403:
      fallback =
        'The grievance service refused the request — its key is missing or wrong. Whoever set the app up needs to check it.'
      break
    case 413:
      fallback = 'That page was too big to send. Try the print version of the article.'
      break
    case 429: {
      const after = Number(res.headers.get('retry-after'))
      fallback = Number.isFinite(after)
        ? `Too many batches too quickly. Wait ${Math.max(1, Math.ceil(after))} seconds, then read the rest.`
        : 'Too many batches too quickly. Wait a minute, then read the rest.'
      break
    }
    case 504:
      fallback = 'This link took too long to read. Try it on its own, without the others.'
      break
    default:
      fallback =
        res.status >= 500
          ? 'The grievance service hit an error on this link. Reading it again usually works.'
          : `The grievance service gave an unexpected answer (${res.status}). Try this link again.`
  }

  try {
    const body: unknown = await res.json()
    const o = asObject(body)
    return (o ? (text(o.error) ?? text(o.message)) : null) ?? fallback
  } catch {
    return fallback
  }
}

/** One link's fate, reported the moment it is known rather than at the end. */
type OnOutcome = (url: string, record: GrievanceRecord | null, error: string | null) => void

interface BatchRound {
  issues: IssueCluster[]
  /** Links the server actually answered for, either way. */
  settled: Set<string>
  /** What the server said about the batch as a whole, if anything. */
  message: string | null
  /**
   * Send nothing further this run. Set when the service rate-limits us — the
   * endpoint allows a handful of batches a minute, and answering a refusal by
   * immediately trying the next link is how a limit turns into a lockout.
   */
  stop: boolean
}

const emptyRound = (): BatchRound => ({
  issues: [],
  settled: new Set<string>(),
  message: null,
  stop: false,
})

const joinNotes = (a: string | null, b: string | null): string | null =>
  a && b ? (a === b ? a : `${a} ${b}`) : (a ?? b)

/**
 * Send one batch and take whatever comes back.
 *
 * Never throws. A link that fails, a batch that fails and a connection that
 * dies mid-stream all end the same way: whatever arrived is kept, whatever did
 * not is simply unsettled, and the caller decides whether to go round again.
 */
async function readBatch(
  urls: string[],
  signal: AbortSignal,
  onOutcome: OnOutcome,
): Promise<BatchRound> {
  const round = emptyRound()

  let res: Response
  try {
    res = await fetch('/api/grievance', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ urls, stream: true }),
      signal,
    })
  } catch (err) {
    round.message = signal.aborted ? STOPPED : networkMessage(err)
    return round
  }

  if (!res.ok) {
    round.message = await explainResponse(res)
    round.stop = res.status === 429
    return round
  }

  const streaming = (res.headers.get('content-type') ?? '').includes('text/event-stream')
  if (!streaming || !res.body) {
    // The service answered in one piece — an older build of it, or something
    // in front of it that will not stream. Same data, just all at the end.
    try {
      const payload: unknown = await res.json()
      return readWholeAnswer(payload, round, onOutcome)
    } catch {
      round.message = 'The grievance service sent a reply this app could not read.'
      return round
    }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE frames are separated by a blank line.
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue // a heartbeat, not an event

        let payload: unknown
        try {
          payload = JSON.parse(line.slice(5).trim())
        } catch {
          continue
        }
        applyEvent(payload, round, onOutcome)
      }
    }
  } catch (err) {
    // A stream that stops mid-way is the function hitting its time limit. The
    // records already delivered are real and stay; the links that never landed
    // are unsettled, and the caller sends them again.
    round.message = joinNotes(round.message, signal.aborted ? STOPPED : networkMessage(err))
  }

  return round
}

function applyEvent(payload: unknown, round: BatchRound, onOutcome: OnOutcome): void {
  const o = asObject(payload)
  if (!o) return

  const type = text(o.type)
  const url = text(o.url)

  if (type === 'record' && url) {
    const record = toRecord(o.record, url)
    round.settled.add(url)
    onOutcome(url, record, record ? null : UNREADABLE)
    return
  }

  if (type === 'failed' && url) {
    round.settled.add(url)
    onOutcome(url, null, text(o.error) ?? text(o.message) ?? 'This link could not be read.')
    return
  }

  if (type === 'clusters') {
    round.issues = toIssues(o.clusters ?? o.issues)
    return
  }

  if (type === 'start' || type === 'done' || type === 'error') {
    round.message = joinNotes(
      round.message,
      text(o.incomplete) ?? text(o.note) ?? text(o.message) ?? text(o.error),
    )
  }
}

/** The non-streaming answer: the per-URL results array, or the bare contract. */
function readWholeAnswer(payload: unknown, round: BatchRound, onOutcome: OnOutcome): BatchRound {
  const o = asObject(payload)
  if (!o) {
    round.message = 'The grievance service sent a reply this app could not read.'
    return round
  }

  round.issues = toIssues(o.clusters ?? o.issues)
  round.message = joinNotes(
    text(o.incomplete) ?? text(o.note),
    text(o.error) ?? text(o.message),
  )

  if (Array.isArray(o.results)) {
    for (const entry of o.results) {
      const e = asObject(entry)
      const url = e ? text(e.url) : null
      if (!e || !url) continue
      const record = e.record == null ? null : toRecord(e.record, url)
      round.settled.add(url)
      onOutcome(url, record, record ? null : (text(e.error) ?? text(e.message) ?? UNREADABLE))
    }
    return round
  }

  // The shape the contract describes: a plain list of records. Each one is
  // settled against the link it says it came from.
  const bare = Array.isArray(o.records)
    ? o.records
    : Array.isArray(o.grievances)
      ? o.grievances
      : []
  for (const entry of bare) {
    const record = toRecord(entry, '')
    if (!record || !record.sourceUrl) continue
    round.settled.add(record.sourceUrl)
    onOutcome(record.sourceUrl, record, null)
  }

  return round
}

/* ═══════════════════════════════════════════════════════════════════════════
   Storage
   ═══════════════════════════════════════════════════════════════════════════ */

function mergeRecords(existing: GrievanceRecord[], incoming: GrievanceRecord[]): GrievanceRecord[] {
  const next = [...existing]
  for (const record of incoming) {
    // Keyed on the link as well as the id: pasting a story the office already
    // has should correct that record, not file a second one beside it, and the
    // same story re-read tomorrow arrives with a different id.
    const at = next.findIndex((r) => r.id === record.id || r.sourceUrl === record.sourceUrl)
    if (at >= 0) next[at] = record
    else next.push(record)
  }
  return next
}

function mergeIssues(existing: IssueCluster[], incoming: IssueCluster[]): IssueCluster[] {
  if (!incoming.length) return existing
  const next = [...existing]
  for (const issue of incoming) {
    const at = next.findIndex((i) => i.id === issue.id)
    if (at >= 0) next[at] = issue
    else next.push(issue)
  }
  return next
}

function persist(records: GrievanceRecord[], issues: IssueCluster[]): void {
  update((s) => ({
    ...s,
    grievances: mergeRecords(s.grievances, records),
    issues: mergeIssues(s.issues, issues),
  }))
}

/* ═══════════════════════════════════════════════════════════════════════════
   Intake parsing
   ═══════════════════════════════════════════════════════════════════════════ */

interface DraftLink {
  url: string
  host: string
  /** The publisher's name when we recognise the host, null when we do not. */
  publisher: string | null
}

function publisherFor(host: string): string | null {
  const h = host.toLowerCase()
  return NEWS_SOURCES.find((s) => h === s.host || h.endsWith(`.${s.host}`))?.label ?? null
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

type LinkStatus = 'queued' | 'reading' | 'done' | 'failed'

interface LinkState extends DraftLink {
  status: LinkStatus
  message: string | null
  headline: string | null
}

const STATUS_LABEL: Record<LinkStatus, string> = {
  queued: 'Waiting',
  reading: 'Reading',
  done: 'Read',
  failed: 'Failed',
}

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
  focusIssueId = null,
}: {
  onClose: () => void
  mode?: DeskMode
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
  const [links, setLinks] = useState<LinkState[]>([])
  const [running, setRunning] = useState(false)
  // Open on a fresh device, because on a fresh device it is the whole screen.
  const [intakeOpen, setIntakeOpen] = useState(() => store.grievances.length === 0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const records = useMemo(
    () => [...store.grievances].sort((a, b) => bySeverityThenRecency(SEVERITY_RANK, a, b)),
    [store.grievances],
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

  const visibleIssues = useMemo(
    () => issues.filter((issue) => issueMatches(issue, issueFilters, byId)),
    [issues, issueFilters, byId],
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
  const [day, setDay] = useState(() => todayDeskDay())
  const dayRecords = useMemo(() => recordsOnDay(records, day), [records, day])
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

  const runScan = useCallback(async () => {
    const profile = store.profile
    const identity = store.identity
    const custom = (profile?.customPortalUrls ?? []).filter(Boolean)
    setScanning(true)
    setScanNote(null)
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portals: profile?.portals ?? [],
          customUrls: custom,
          // The DISTRICT, falling back to the seat. Publishers issue editions
          // by district and never by assembly segment, so sending the seat here
          // finds no district route and silently drops the scan to the state
          // page — the failure this reads as is a quiet news week.
          city: profile?.district ?? profile?.constituency ?? null,
          tags: profile?.watchTerms ?? [],
          // The party is watched, but only alongside something narrower. On its
          // own it returns the national wire — twenty-three stories about the
          // party and none about this member.
          broadTags: (() => {
            const party = identity?.party ?? null
            const short = partyAbbreviation(party)
            return short ? [short] : party ? [party] : []
          })(),
        }),
      })
      const data = (await res.json()) as {
        candidates?: { url: string; title: string; portal: string; matched: string[] }[]
        sources?: { portal: string; found: number; error: string | null }[]
        notes?: string[]
        error?: string
      }
      if (!res.ok || data.error) {
        setScanNote(data.error ?? `The scan failed (HTTP ${res.status}).`)
        return
      }
      const found = data.candidates ?? []
      if (found.length === 0) {
        const dead = (data.sources ?? []).filter((s) => s.error)
        setScanNote(
          dead.length > 0
            ? `Nothing matched. ${dead.map((d) => `${d.portal}: ${d.error}`).join(' ')}`
            : 'The papers had nothing carrying your words today. Try fewer words, or add a paper.',
        )
        return
      }
      // Take the previous scan's results out before putting these in, so the
      // box holds this scan plus whatever the operator pasted by hand — never
      // an earlier district's stories stacked on top of the current ones.
      const previous = new Set(scannedRef.current)
      const fresh = found.map((c) => c.url)
      scannedRef.current = fresh
      setDraft((current) => {
        const kept = current
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !previous.has(l))
        const seen = new Set(kept)
        return [...kept, ...fresh.filter((u) => !seen.has(u))].join('\n')
      })
      const perSource = (data.sources ?? [])
        .map((s) => `${s.portal} ${s.found}`)
        .join(' · ')
      setScanNote(
        `Found ${found.length} ${pluralise(found.length, 'story', 'stories')} — ${perSource}. They are in the box below; read them when you are ready.` +
          (data.notes?.length ? ` ${data.notes.join(' ')}` : ''),
      )
    } catch (err) {
      setScanNote(
        `Could not reach the scanner: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setScanning(false)
    }
  }, [store.profile])

  const openRecord = useCallback((id: string) => {
    setSelectedId(id)
    setTab('records')
    haptic.tap()
    // On a phone the detail replaces the list, so land at its top. On a desktop
    // both are on screen and yanking the page to the top loses the reader's
    // place in a list they are still working down.
    if (window.innerWidth < 1024) window.scrollTo({ top: 0 })
  }, [])

  const readLinks = useCallback(async (targets: DraftLink[]) => {
    // A second run started on top of the first would orphan the first one's
    // controller, leaving requests in flight that nothing can stop.
    if (!targets.length || abortRef.current) return

    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setIntakeOpen(true)
    setLinks(targets.map((t) => ({ ...t, status: 'queued', message: null, headline: null })))

    const mark = (url: string, patch: Partial<LinkState>) =>
      setLinks((cur) => cur.map((l) => (l.url === url ? { ...l, ...patch } : l)))

    const failed = new Map<string, string>()

    const onOutcome: OnOutcome = (url, record, error) => {
      if (record) {
        // Written as each one lands rather than at the end of the batch: a
        // connection that drops at link seven should cost the office links
        // eight, nine and ten — not the six already read.
        persist([record], [])
        failed.delete(url)
        mark(url, { status: 'done', headline: record.headline, message: null })
      } else {
        const message = error ?? UNREADABLE
        failed.set(url, message)
        mark(url, { status: 'failed', message })
      }
    }

    let pending = [...targets]
    let oneAtATime = false

    while (pending.length && !controller.signal.aborted) {
      const round = oneAtATime ? pending.slice(0, 1) : pending
      const single = oneAtATime ? round[0] : null
      if (single) mark(single.url, { status: 'reading', message: null })

      const outcome = await readBatch(
        round.map((t) => t.url),
        controller.signal,
        onOutcome,
      )
      if (outcome.issues.length) persist([], outcome.issues)

      const remaining = pending.filter((t) => !outcome.settled.has(t.url))

      if (outcome.stop) {
        const message = outcome.message ?? 'The grievance service is not taking more links now.'
        for (const target of remaining) {
          failed.set(target.url, message)
          mark(target.url, { status: 'failed', message })
        }
        pending = []
        break
      }

      if (remaining.length < pending.length) {
        pending = remaining
        continue
      }

      // Nothing in that round moved. When it was a batch, the fault may be the
      // batch itself — one article that hangs takes the whole request with it —
      // so drop to one link at a time before writing any of them off.
      if (!oneAtATime && pending.length > 1) {
        oneAtATime = true
        continue
      }

      const [first, ...rest] = pending
      if (first) {
        const message = outcome.message ?? 'The grievance service did not answer for this link.'
        failed.set(first.url, message)
        mark(first.url, { status: 'failed', message })
      }
      pending = rest
    }

    if (controller.signal.aborted) {
      for (const target of pending) failed.set(target.url, STOPPED)
      setLinks((cur) =>
        cur.map((l) =>
          l.status === 'done' || l.status === 'failed'
            ? l
            : { ...l, status: 'failed', message: STOPPED },
        ),
      )
    }

    // What worked leaves the box; what failed stays in it, so a mistyped link
    // can be fixed and read again without hunting for it in the chat.
    setDraft(
      targets
        .filter((t) => failed.has(t.url))
        .map((t) => t.url)
        .join('\n'),
    )
    setRunning(false)
    abortRef.current = null
  }, [])

  const failedLinks = useMemo(() => links.filter((l) => l.status === 'failed'), [links])

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
            dayRecords.length
              ? `${dayRecords.length} ${pluralise(dayRecords.length, 'record')} · ${issues.length} ${pluralise(issues.length, 'issue')}`
              : 'Paste the morning’s news links, get back what people are complaining about.'
          }
          actions={
            <Button variant="ghost" onClick={onClose}>
              Back
            </Button>
          }
        />
      </m.div>

      {/* The day being read.
          A grievance desk is a daily instrument — the office works today's news
          and yesterday's should not be in the way. Everything filed is kept and
          reachable by stepping back a day; only the day on screen changes. */}
      <m.div
        variants={fadeUp}
        className="mt-3 flex flex-wrap items-center gap-2 border-y border-[var(--rule)] py-2"
      >
        <button
          onClick={() => setDay(shiftDay(day, -1))}
          aria-label="Previous day"
          className="grid size-9 place-items-center rounded-[3px] text-ink-2 hover:bg-[var(--surface-2)]"
        >
          <ChevronLeft size={16} />
        </button>

        <span className="text-sm font-semibold">
          {isToday(day) ? 'Today' : formatDeskDay(day)}
        </span>
        {isToday(day) && (
          <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3">
            {formatDeskDay(day)}
          </span>
        )}

        <button
          onClick={() => setDay(shiftDay(day, 1))}
          disabled={isToday(day)}
          aria-label="Next day"
          className="grid size-9 place-items-center rounded-[3px] text-ink-2 hover:bg-[var(--surface-2)] disabled:opacity-35"
        >
          <ChevronRight size={16} />
        </button>

        {!isToday(day) && (
          <Button size="sm" variant="ghost" onClick={() => setDay(todayDeskDay())}>
            Back to today
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {otherDays > 0 && (
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3 sm:inline">
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
          <Button
            size="sm"
            variant="outline"
            disabled={dayRecords.length === 0}
            // The banded workbook, not the flat CSV — the same sheet the link
            // analysis produces, with its lettered colour bands and its widths.
            // The button keeps saying CSV because that is what the office calls
            // a spreadsheet, and it is what the other export in this app says.
            onClick={() => void downloadGrievanceWorkbook(dayRecords, day)}
          >
            <Download size={14} />
            CSV
          </Button>
        </div>
      </m.div>

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
                on one screen. */}
            {intakeOpen ? (
              <IntakePanel
                draft={draft}
                onDraft={setDraft}
                links={parsed.links}
                unusable={parsed.unusable}
                progress={links}
                running={running}
                canHide={dayRecords.length > 0}
                onHide={() => setIntakeOpen(false)}
                onRead={() => void readLinks(parsed.links)}
                onStop={() => abortRef.current?.abort()}
                onRetryFailed={() =>
                  void readLinks(
                    failedLinks.map(({ url, host, publisher }) => ({ url, host, publisher })),
                  )
                }
                failedCount={failedLinks.length}
                assembly={store.profile?.constituency ?? ''}
                tags={store.profile?.watchTerms ?? []}
                deskState={store.profile?.state ?? ''}
                portals={store.profile?.portals ?? []}
                customUrls={store.profile?.customPortalUrls ?? []}
                scanning={scanning}
                scanNote={scanNote}
                onScan={() => void runScan()}
                onDeskState={(next) =>
                  update((s) => ({
                    ...s,
                    profile: {
                      subject: s.profile?.subject ?? 'This office',
                      constituency: '',
                      // A different state means different papers and different
                      // place words; carrying either over would scan the wrong
                      // patch and look like it had worked.
                      watchTerms: [],
                      state: next,
                      portals: [],
                      customPortalUrls: s.profile?.customPortalUrls ?? [],
                    },
                  }))
                }
                onTogglePortal={(label) =>
                  update((s) => {
                    const current = s.profile?.portals ?? []
                    return {
                      ...s,
                      profile: {
                        subject: s.profile?.subject ?? 'This office',
                        constituency: s.profile?.constituency ?? '',
                        watchTerms: s.profile?.watchTerms ?? [],
                        state: s.profile?.state ?? '',
                        portals: current.includes(label)
                          ? current.filter((p) => p !== label)
                          : [...current, label],
                        customPortalUrls: s.profile?.customPortalUrls ?? [],
                      },
                    }
                  })
                }
                onAddCustom={(url) =>
                  update((s) => ({
                    ...s,
                    profile: {
                      ...(s.profile ?? { subject: 'This office' }),
                      subject: s.profile?.subject ?? 'This office',
                      constituency: s.profile?.constituency ?? '',
                      watchTerms: s.profile?.watchTerms ?? [],
                      state: s.profile?.state ?? '',
                      portals: s.profile?.portals ?? [],
                      customPortalUrls: [...(s.profile?.customPortalUrls ?? []), url],
                    },
                  }))
                }
                onRemoveCustom={(url) =>
                  update((s) => ({
                    ...s,
                    profile: {
                      ...(s.profile ?? { subject: 'This office' }),
                      subject: s.profile?.subject ?? 'This office',
                      constituency: s.profile?.constituency ?? '',
                      watchTerms: s.profile?.watchTerms ?? [],
                      state: s.profile?.state ?? '',
                      portals: s.profile?.portals ?? [],
                      customPortalUrls: (s.profile?.customPortalUrls ?? []).filter(
                        (u) => u !== url,
                      ),
                    },
                  }))
                }
                onAssembly={(next) =>
                  update((s) => ({
                    ...s,
                    profile: {
                      ...(s.profile ?? { subject: 'This office' }),
                      subject: s.profile?.subject ?? 'This office',
                      constituency: next,
                      // Place words from the old segment would quietly keep
                      // filtering for somewhere the desk no longer covers.
                      watchTerms: (s.profile?.watchTerms ?? []).filter(
                        (t) => !Object.entries(ASSEMBLY_TELUGU).some(
                          ([en, te]) =>
                            t.toLowerCase() === en.toLowerCase() || t === te,
                        ),
                      ),
                      // Spread first, then restate: choosing a state calls this
                      // immediately afterwards to clear the city, and rebuilding
                      // the profile from scratch here wiped the state that had
                      // just been set — the select snapped back to empty.
                      state: s.profile?.state ?? '',
                      portals: s.profile?.portals ?? [],
                      customPortalUrls: s.profile?.customPortalUrls ?? [],
                    },
                  }))
                }
                onToggleTag={(tag) =>
                  update((s) => {
                    const current = s.profile?.watchTerms ?? []
                    const has = current.some((t) => t.toLowerCase() === tag.toLowerCase())
                    return {
                      ...s,
                      profile: {
                        ...(s.profile ?? { subject: 'This office' }),
                        subject: s.profile?.subject ?? 'This office',
                        constituency: s.profile?.constituency ?? '',
                        watchTerms: has
                          ? current.filter((t) => t.toLowerCase() !== tag.toLowerCase())
                          : [...current, tag],
                      },
                    }
                  })
                }
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
                <p className="text-sm font-medium">Nothing matches all of those filters.</p>
                <p className="mt-1 text-sm text-ink-3">
                  Every filter has to be true at once. Drop one, or clear them all.
                </p>
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
              shown={visibleIssues.length}
              total={issues.length}
            />
          )}

          {issues.length === 0 ? (
            <Card>
              <div className="flex gap-2.5">
                <Layers size={18} className="mt-0.5 shrink-0 text-ink-3" />
                <div>
                  <p className="text-sm font-medium">No issues yet</p>
                  <p className="mt-1 text-sm text-ink-3">
                    An issue is several records about the same thing — nine complaints about one
                    water line, not nine separate stories. They appear once enough links have been
                    read for the desk to group them.
                  </p>
                </div>
              </div>
            </Card>
          ) : visibleIssues.length === 0 ? (
            /* A filter combination that matches nothing is a completely
               different situation from a desk with no issues, and saying "no
               issues yet" here would tell an office its week was quiet when it
               has thirty issues and a typo in the search box. */
            <Card>
              <div className="flex gap-2.5">
                <Filter size={18} className="mt-0.5 shrink-0 text-ink-3" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    None of your {issues.length} issues match these filters
                  </p>
                  <p className="mt-1 text-sm text-ink-3">
                    Loosen one, or clear them and start again.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => setIssueFilters(NO_ISSUE_FILTERS)}
                  >
                    <X size={14} />
                    Clear filters
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <m.ul
              className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0"
              variants={listStaggerFast}
              initial={reduced ? false : 'hidden'}
              animate="show"
            >
              {visibleIssues.map((issue) => (
                <m.li
                  key={issue.id}
                  variants={listItem}
                  ref={issue.id === focusIssueId ? focusRef : undefined}
                  className={
                    issue.id === focusIssueId
                      ? 'rounded-[--radius-sm] ring-2 ring-[var(--accent)] ring-offset-4 ring-offset-[var(--bg)]'
                      : undefined
                  }
                >
                  <IssueCard
                    issue={issue}
                    records={issue.recordIds.flatMap((id) => {
                      const record = byId.get(id)
                      return record ? [record] : []
                    })}
                    onOpenRecord={openRecord}
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
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Choose the segment, then the papers that cover it, then the words that make
 * a story ours.
 *
 * The desk previously opened on an empty box and the instruction "paste
 * links", which assumes the operator already knows which links. This asks the
 * three questions in the order an office actually answers them, and each
 * answer narrows the next: the segment decides which district pages to open,
 * and the tags decide which of the day's stories are worth filing at all.
 *
 * The segment and the tags are kept on the office profile rather than held for
 * this one paste, because they are the same every morning.
 */
function DeskSetup({
  state,
  city,
  tags,
  portals,
  customUrls,
  onState,
  onCity,
  onTogglePortal,
  onAddCustom,
  onRemoveCustom,
  onToggleTag,
  onScan,
  scanning,
  scanNote,
}: {
  state: string
  city: string
  tags: string[]
  portals: string[]
  customUrls: string[]
  onState: (next: string) => void
  onCity: (next: string) => void
  onTogglePortal: (label: string) => void
  onAddCustom: (url: string) => void
  onRemoveCustom: (url: string) => void
  onToggleTag: (tag: string) => void
  onScan: () => void
  scanning: boolean
  scanNote: string | null
}) {
  const available = state ? portalsForState(state) : []
  const suggested = city ? suggestedTagsFor(city) : null
  const extraCount = customUrls.length
  const ready = (portals.length > 0 || extraCount > 0) && !scanning

  /**
   * Configured desks collapse to one line.
   *
   * This is settings, not work. An office picks its state, its district, its
   * papers and its words once and then opens this screen every morning to read
   * the day's news — so leaving four expanded steps at the top of the desk puts
   * the thing they never touch above the thing they always do, and on a phone it
   * pushed the day's stories below the fold entirely.
   *
   * "Configured" means a district and at least one paper. Anything less and the
   * scan cannot run, so the steps stay open because there is still a decision to
   * make.
   */
  const configured = Boolean(city) && (portals.length > 0 || extraCount > 0)
  const [editing, setEditing] = useState(false)

  if (configured && !editing) {
    /**
     * What the scan is about to do, named rather than counted.
     *
     * This said "3 papers · 12 words", which tells an operator nothing they can
     * check. The one question this strip has to answer before somebody presses
     * Scan is "is it about to read the right thing" — and "Eenadu, Sakshi,
     * indianexpress.com" answers it where "3 papers" does not.
     */
    const paperNames = [...portals, ...customUrls.map(hostLabel)]
    return (
      <div className="mb-4 border-b border-[var(--rule)] pb-3">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <dl className="min-w-0 flex-1 space-y-1">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3">
                Desk
              </dt>
              <dd className="min-w-0 text-sm font-semibold">
                {city}
                <span className="ml-1.5 font-normal text-ink-3">{state}</span>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3">
                Papers
              </dt>
              <dd className="min-w-0 text-sm text-ink-2">
                {paperNames.length ? paperNames.join(', ') : 'None chosen'}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3">
                Words
              </dt>
              <dd className="min-w-0 text-sm text-ink-2">
                {tags.length ? (
                  tags.join(', ')
                ) : (
                  <span className="text-ink-3">
                    None — the scan will bring back everything the papers carry
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setEditing(true)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-[3px] border border-[var(--border)] px-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.07em] text-ink-2 hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <Pencil size={11} />
              Edit
            </button>
            <Button size="sm" onClick={onScan} disabled={!ready}>
              {scanning ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Scanning
                </>
              ) : (
                <>
                  <Search size={14} />
                  Scan today
                </>
              )}
            </Button>
          </div>
        </div>

        {scanNote && (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-2">
            <Search size={12} className="mt-0.5 shrink-0 text-ink-3" />
            <span>{scanNote}</span>
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mb-4 border-b border-[var(--rule)] pb-4">
      {configured && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="kicker">Desk settings</span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Done
          </Button>
        </div>
      )}
      {/* 1 — where the desk works */}
      <RegionPicker state={state} city={city} onState={onState} onCity={onCity} />

      {/* 2 — which mastheads to read */}
      {state && (
        <div className="mt-4">
          <span className="kicker">Step 2 · Papers to scan</span>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
            Signal reads these for you — tick as many as you want. Nothing opens in
            another tab.
            {DISTRICT_PAGES_ARE_GEO_GATED && (
              <>
                {' '}
                Some Telugu papers serve their district edition on the reader&rsquo;s
                location rather than the address, so from our servers they return the state
                feed. Your words in step 3 are what pull the local stories out of it.
              </>
            )}
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {available.map((p) => {
              const on = portals.includes(p.label)
              return (
                <button
                  key={p.label}
                  onClick={() => onTogglePortal(p.label)}
                  aria-pressed={on}
                  className={cn(
                    'inline-flex min-h-9 items-center gap-1.5 rounded-[3px] border px-2.5',
                    'font-mono text-[10px] font-medium uppercase tracking-[0.07em]',
                    on
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'border-[var(--border)] bg-[var(--surface-2)] text-ink-2 hover:border-[var(--accent)]',
                  )}
                >
                  {on ? <Check size={11} /> : <Newspaper size={11} />}
                  {p.label}
                  <span className="opacity-60">{p.language.slice(0, 2)}</span>
                </button>
              )
            })}
          </div>

          {/* Added papers join the collection rather than sitting in a box of
              their own. They were a textarea, which made them look like a note
              to self instead of a source that gets read — and an address typed
              without https:// silently counted for nothing. */}
          <PortalInput onAdd={onAddCustom} existing={customUrls} />

          {customUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {customUrls.map((u) => (
                <button
                  key={u}
                  onClick={() => onRemoveCustom(u)}
                  aria-label={`Remove ${u}`}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-[3px] border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.07em] text-[var(--accent)]"
                >
                  <Check size={11} />
                  {hostLabel(u)}
                  <X size={10} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3 — what counts as ours */}
      {suggested && (
        <div className="mt-4">
          <span className="kicker">Step 3 · Words that make a story yours</span>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
            Tapped words are kept and used to flag which filed stories are about this
            segment. Add your own mandal names — no list shipped from outside knows them.
          </p>
          <div className="mt-2 space-y-2">
            {(
              [
                ['Place', suggested.place],
                ['Subject', suggested.subject],
              ] as const
            ).map(([group, list]) => (
              <div key={group} className="flex flex-wrap items-center gap-1.5">
                <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3">
                  {group}
                </span>
                {list.map((t) => {
                  const on = tags.some((x) => x.toLowerCase() === t.toLowerCase())
                  return (
                    <button
                      key={t}
                      onClick={() => onToggleTag(t)}
                      aria-pressed={on}
                      className={cn(
                        'inline-flex min-h-9 items-center gap-1 rounded-[3px] border px-2.5',
                        'font-mono text-[10px] font-medium uppercase tracking-[0.07em]',
                        on
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                          : 'border-[var(--border)] bg-[var(--surface-2)] text-ink-2 hover:border-[var(--accent)]',
                      )}
                    >
                      {on && <Check size={10} />}
                      {t}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          {/* Typed words, not just the suggested ones.
              The suggestions are places and civic subjects a stranger can guess.
              What actually finds a story is a mandal name, a scheme, or the
              officer everyone is complaining about — none of which any list
              shipped from outside this district could contain. */}
          <TagInput
            onAdd={(t) => onToggleTag(t)}
            existing={tags}
          />

          {tags.length > 0 && (
            <div className="mt-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3">
                Watching for {tags.length} {pluralise(tags.length, 'word')}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button
                    key={t}
                    onClick={() => onToggleTag(t)}
                    aria-label={`Stop watching for ${t}`}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-[3px] border border-[var(--accent)] bg-[var(--accent-soft)] px-2 font-mono text-[10px] font-medium uppercase tracking-[0.07em] text-[var(--accent)]"
                  >
                    {t}
                    <X size={10} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4 — go */}
      {state && (
        <div className="mt-4 border-t border-[var(--rule)] pt-4">
          <Button onClick={onScan} disabled={!ready} className="w-full sm:w-auto">
            {scanning ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                Scanning…
              </>
            ) : (
              <>
                <Search size={15} />
                Scan {portals.length + extraCount || 'the'}{' '}
                {pluralise(portals.length + extraCount || 2, 'paper')}
              </>
            )}
          </Button>

          {/* The result belongs here, beside the button that caused it.
              It used to render only at the top of the column, so an operator
              scrolled down to step 2 pressed Scan, the scan ran, and nothing
              visibly happened — the outcome was above the fold. */}
          {scanNote ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-2">
              <Search size={12} className="mt-0.5 shrink-0 text-ink-3" />
              <span>{scanNote}</span>
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-ink-3">
              {tags.length === 0
                ? 'With no words chosen this returns everything the papers are carrying, not just your patch.'
                : `Returns only stories carrying one of your ${tags.length} ${pluralise(tags.length, 'word')}. Nothing is read by the model until you choose from the results.`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** The masthead's name, for a chip. Falls back to the raw string if unparseable. */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 28)
  }
}

/**
 * Add a paper by address.
 *
 * Accepts what people actually type. "www.indianexpress.com" has no scheme, and
 * the previous box required one — so the address sat there looking added while
 * counting for nothing and the scan quietly ignored it.
 */
function PortalInput({ onAdd, existing }: { onAdd: (url: string) => void; existing: string[] }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const commit = () => {
    const raw = value.trim()
    if (!raw) return
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    let url: string
    try {
      const parsed = new URL(withScheme)
      if (!parsed.hostname.includes('.')) throw new Error('no host')
      url = parsed.toString()
    } catch {
      setError(`“${raw}” is not a web address. It should look like indianexpress.com.`)
      return
    }
    if (existing.some((u) => u === url)) {
      setError('That paper is already in the collection.')
      return
    }
    onAdd(url)
    setValue('')
    setError(null)
  }

  return (
    <div className="mt-3">
      <label className="font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3">
        Add a paper — its address, or the section you read
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="indianexpress.com"
          aria-label="Add a news paper by address"
          className="min-h-11 min-w-0 flex-1 rounded-[--radius-sm] border border-[var(--border-interactive)] bg-[var(--surface-2)] px-3 text-sm outline-none focus:border-[var(--accent)]"
        />
        <Button size="sm" variant="outline" onClick={commit} disabled={!value.trim()}>
          <Plus size={14} />
          Add
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-[var(--warn)]">{error}</p>}
    </div>
  )
}

/**
 * Type a word the desk should watch for.
 *
 * Kept separate from the suggested chips because the two do different jobs: the
 * chips cover what an outsider can guess about a district, and this covers what
 * only the office knows — the mandal, the scheme, the officer's name. Enter
 * commits, so a run of words can be typed without reaching for the mouse.
 */
function TagInput({ onAdd, existing }: { onAdd: (tag: string) => void; existing: string[] }) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()
  const duplicate = existing.some((t) => t.toLowerCase() === trimmed.toLowerCase())

  const commit = () => {
    if (!trimmed || duplicate) return
    onAdd(trimmed)
    setValue('')
  }

  return (
    <div className="mt-3">
      <label className="font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3">
        Add your own — a mandal, a scheme, an officer
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
          placeholder="Denduluru, Amma Vodi, 22A land…"
          aria-label="Add a word to watch for"
          className="min-h-11 min-w-0 flex-1 rounded-[--radius-sm] border border-[var(--border-interactive)] bg-[var(--surface-2)] px-3 text-sm outline-none focus:border-[var(--accent)]"
        />
        <Button size="sm" variant="outline" onClick={commit} disabled={!trimmed || duplicate}>
          <Plus size={14} />
          Add
        </Button>
      </div>
      {duplicate && (
        <p className="mt-1 text-xs text-ink-3">“{trimmed}” is already on the list.</p>
      )}
    </div>
  )
}

/**
 * State first, then the city.
 *
 * The picker before this held one state's assembly segments, so an operator
 * searching for Hyderabad found nothing at all — it is in Telangana, and the
 * list did not know Telangana existed. Asking for the state first is also just
 * how people say where they work.
 */
function RegionPicker({
  state,
  city,
  onState,
  onCity,
}: {
  state: string
  city: string
  onState: (next: string) => void
  onCity: (next: string) => void
}) {
  const [query, setQuery] = useState('')
  const cities = state ? citiesOf(state) : []
  const region = REGIONS.find((r) => r.state === state)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? cities.filter((c) => c.toLowerCase().includes(q)) : cities
  }, [cities, query])

  const typed = query.trim()
  const exact = cities.some((c) => c.toLowerCase() === typed.toLowerCase())

  return (
    <div>
      <label className="block">
        <span className="kicker">Step 1 · State</span>
        <select
          value={state}
          onChange={(e) => {
            onState(e.target.value)
            onCity('')
            setQuery('')
          }}
          className="mt-2 min-h-11 w-full rounded-[--radius-sm] border border-[var(--border-interactive)] bg-[var(--surface-2)] px-3 text-sm outline-none focus:border-[var(--accent)]"
        >
          <option value="">Choose a state…</option>
          {ALL_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {state && (
        <div className="mt-3">
          <span className="kicker">
            {region?.complete ? 'District' : 'City'}
            {city ? '' : ' — choose one'}
          </span>

          {city ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                {city}
                {ASSEMBLY_TELUGU[city] && (
                  <span className="te ml-1.5 font-normal text-ink-2">{ASSEMBLY_TELUGU[city]}</span>
                )}
                <span className="ml-2 text-xs font-normal text-ink-3">{state}</span>
              </span>
              <Button size="sm" variant="outline" onClick={() => onCity('')}>
                Change
              </Button>
            </div>
          ) : (
            <>
              <div className="relative mt-2">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Type to find one of ${cities.length}`}
                  aria-label="Search districts and cities"
                  className="min-h-11 w-full rounded-[--radius-sm] border border-[var(--border-interactive)] bg-[var(--surface-2)] pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div className="mt-2 max-h-48 overflow-y-auto rounded-[--radius-sm] border border-[var(--rule)]">
                {shown.length === 0 ? (
                  <p className="px-3 py-3 text-xs leading-relaxed text-ink-2">
                    Nothing matches “{typed}”. This list is a starting point, not the
                    register — use what you typed.
                  </p>
                ) : (
                  shown.map((c) => (
                    <button
                      key={c}
                      onClick={() => {
                        onCity(c)
                        setQuery('')
                      }}
                      className="flex min-h-11 w-full items-baseline gap-2 px-3 text-left text-sm hover:bg-[var(--surface-2)]"
                    >
                      <span>{c}</span>
                      {ASSEMBLY_TELUGU[c] && (
                        <span className="te text-xs text-ink-3">{ASSEMBLY_TELUGU[c]}</span>
                      )}
                    </button>
                  ))
                )}
              </div>

              {!region?.complete && (
                <p className="mt-1.5 text-xs text-ink-3">
                  Major cities only for {state}. The two Telugu states carry every district;
                  everywhere else is a starting list — type your own if it is missing.
                </p>
              )}

              {typed && !exact && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => {
                    onCity(typed)
                    setQuery('')
                  }}
                >
                  <Plus size={14} />
                  Use “{typed}”
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function IntakePanel({
  draft,
  onDraft,
  links,
  unusable,
  progress,
  running,
  canHide,
  onHide,
  onRead,
  onStop,
  onRetryFailed,
  failedCount,
  assembly,
  tags,
  onAssembly,
  onToggleTag,
  deskState,
  portals,
  customUrls,
  onDeskState,
  onTogglePortal,
  onAddCustom,
  onRemoveCustom,
  onScan,
  scanning,
  scanNote,
}: {
  draft: string
  onDraft: (value: string) => void
  links: DraftLink[]
  unusable: string[]
  progress: LinkState[]
  running: boolean
  canHide: boolean
  onHide: () => void
  onRead: () => void
  onStop: () => void
  onRetryFailed: () => void
  failedCount: number
  assembly: string
  tags: string[]
  onAssembly: (next: string) => void
  onToggleTag: (tag: string) => void
  deskState: string
  portals: string[]
  customUrls: string[]
  onDeskState: (next: string) => void
  onTogglePortal: (label: string) => void
  onAddCustom: (url: string) => void
  onRemoveCustom: (url: string) => void
  onScan: () => void
  scanning: boolean
  scanNote: string | null
}) {
  const known = links.filter((l) => l.publisher !== null)
  const publishers = [...new Set(known.map((l) => l.publisher))].filter(
    (p): p is string => p !== null,
  )
  const settled = progress.filter((l) => l.status === 'done' || l.status === 'failed').length

  return (
    <m.div variants={fadeUp}>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-[-0.011em]">Add news links</h2>
            <p className="mt-0.5 text-xs text-ink-3">
              One per line. Paste the whole list from the group at once — each link is reported on
              its own, so a dead one costs you that link and nothing else.
            </p>
          </div>
          {canHide && (
            <button
              onClick={onHide}
              aria-label="Hide the link box"
              className="-mr-1 -mt-1 grid size-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-2)]"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div className="mt-4">
          <DeskSetup
            state={deskState}
            city={assembly}
            tags={tags}
            portals={portals}
            customUrls={customUrls}
            onState={onDeskState}
            onCity={onAssembly}
            onTogglePortal={onTogglePortal}
            onAddCustom={onAddCustom}
            onRemoveCustom={onRemoveCustom}
            onToggleTag={onToggleTag}
            onScan={onScan}
            scanning={scanning}
            scanNote={scanNote}
          />
        </div>

        <span className="kicker">Or paste links yourself</span>
        <textarea
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          rows={5}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="News links, one per line"
          placeholder={'https://www.eenadu.net/…\nhttps://www.sakshi.com/…'}
          className="mt-2 w-full resize-y rounded-[--radius-md] border border-[var(--border-interactive)] bg-[var(--surface-2)] p-3 text-sm leading-relaxed outline-none focus:border-[var(--accent)]"
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
              Skipped {unusable.length} {pluralise(unusable.length, 'line')} — not a web address:{' '}
              {unusable.slice(0, 3).join(', ')}
              {unusable.length > 3 && ` and ${unusable.length - 3} more`}. A link has to start with
              http:// or https://.
            </span>
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={onRead} disabled={running || links.length === 0}>
            <RefreshCw size={15} className={running ? 'animate-spin' : ''} />
            {running
              ? `Reading — ${settled} of ${progress.length} done`
              : links.length === 0
                ? 'Read links'
                : `Read ${links.length} ${pluralise(links.length, 'link')}`}
          </Button>
          {running && (
            <Button variant="outline" onClick={onStop}>
              Stop
            </Button>
          )}
          {!running && failedCount > 0 && (
            <Button variant="outline" onClick={onRetryFailed}>
              Try the {failedCount} that failed again
            </Button>
          )}
        </div>

        {progress.length > 0 && (
          <div className="mt-4">
            <Bar value={progress.length ? settled / progress.length : 0} />
            <ul className="mt-3 space-y-2">
              {progress.map((link) => (
                <li key={link.url} className="flex items-start gap-2.5">
                  {/* The icon is the whole status for a sighted reader, so it
                      has to carry the word for everyone else. */}
                  <span className="mt-0.5 shrink-0" role="img" aria-label={STATUS_LABEL[link.status]}>
                    {link.status === 'done' && <Check size={15} className="text-[var(--pos)]" />}
                    {link.status === 'failed' && (
                      <CircleAlert size={15} className="text-[var(--neg)]" />
                    )}
                    {link.status === 'reading' && (
                      <LoaderCircle size={15} className="animate-spin text-[var(--accent)]" />
                    )}
                    {link.status === 'queued' && (
                      <span className="block size-2 translate-y-1.5 rounded-full bg-[var(--surface-3)]" />
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-ink-3">
                      {metaLine(link.publisher, link.host)}
                    </span>
                    {link.headline && (
                      <span
                        className={cn(
                          'mt-0.5 block truncate text-sm',
                          isIndicScript(link.headline) && 'te',
                        )}
                      >
                        {link.headline}
                      </span>
                    )}
                    {link.message && (
                      <span className="mt-0.5 block text-xs text-[var(--neg)]">{link.message}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </m.div>
  )
}

function EmptyDesk() {
  return (
    <m.div variants={fadeUp}>
      <Card>
        <div className="flex gap-3">
          <Inbox size={20} className="mt-0.5 shrink-0 text-ink-3" />
          <div>
            <p className="font-medium">Nothing read yet</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              This page turns a day of news links into records you can search: what the complaint
              is, which constituency it came from, how serious it is, who is named, whether it looks
              fabricated, and what the office can say back.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Paste the links from the office group into the box above — the whole list at once. You
              can then pull out only the ones you need, such as everything about water in Nuzvid, or
              every story naming one officer.
            </p>
          </div>
        </div>
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
      className="inline-flex min-h-11 shrink-0 items-center rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
            placeholder="Search issues, places"
            aria-label="Search the issues"
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
            className={selectClass}
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

const selectClass =
  'min-h-11 shrink-0 rounded-[--radius-md] border border-[var(--border-interactive)] bg-[var(--surface)] px-3 text-sm text-ink outline-none focus:border-[var(--accent)]'

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
          className={selectClass}
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
          className={selectClass}
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
          className={selectClass}
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
          className={selectClass}
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
          className={selectClass}
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
  return (
    <button
      onClick={onOpen}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-stretch gap-3 overflow-hidden rounded-[--radius-md] border text-left',
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

      <span className="min-w-0 flex-1 py-3 pr-3">
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

        <span className="mt-1 block truncate text-xs text-ink-3">
          {metaLine(
            record.constituency ?? 'Constituency not named',
            record.topic,
            dateLabel(record),
          )}
        </span>
      </span>
    </button>
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

        <p className="mt-3 text-sm leading-relaxed text-ink-2">{record.summary}</p>

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
        <SectionTitle hint="Taken from the story itself, not looked up elsewhere.">
          Who and where
        </SectionTitle>

        <p className="text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">People named</p>
        {record.namedPersons.length === 0 ? (
          <p className="mt-1 text-sm text-ink-3">Nobody is named in this story.</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {record.namedPersons.map((person, i) => (
              <li key={`${person.name}-${i}`} className="flex items-start gap-2 text-sm">
                <Users size={14} className="mt-1 shrink-0 text-ink-3" />
                <span>
                  <span className="font-medium">{person.name}</span>
                  <span className="text-ink-3"> — {person.role ?? 'role not given'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">Places</p>
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
            <p className="mt-4 text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
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
        <SectionTitle hint="Signals, not a verdict. Somebody in the office decides.">
          Is it real?
        </SectionTitle>

        <div className="flex flex-wrap gap-1.5">
          <Chip tone={SUSPICION_TONE[fake.suspicion]} icon={<ShieldAlert size={11} />}>
            {SUSPICION_LABEL[fake.suspicion]}
          </Chip>
          {fake.type && <Chip tone="neutral">{fake.type}</Chip>}
          <Chip tone="neutral">{fake.debunkStatus}</Chip>
        </div>

        {fake.note && <p className="mt-2.5 text-sm leading-relaxed text-ink-2">{fake.note}</p>}

        {fake.signals.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">
            No signals were found either way, so this rests on the suspicion above alone.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {fake.signals.map((signal, i) => (
              <li
                key={`${signal.kind}-${i}`}
                className="rounded-[--radius-md] bg-[var(--surface-2)] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
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
        <SectionTitle>What to do</SectionTitle>

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
          <p className="mt-2.5 text-sm leading-relaxed text-ink-2">{recommendation.rationale}</p>
        )}

        <p className="mt-4 text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
          Lines you can use
        </p>
        {recommendation.talkingPoints.length === 0 ? (
          <p className="mt-1 text-sm text-ink-3">
            No lines were drafted for this one — it is marked {recommendation.action.toLowerCase()}.
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
          className="flex items-start gap-2.5 rounded-[--radius-md] bg-[var(--surface-2)] p-3"
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
            className="-m-2 grid size-11 shrink-0 place-items-center rounded-[--radius-sm] text-ink-3 hover:bg-[var(--surface-3)] hover:text-ink"
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
  records,
  onOpenRecord,
}: {
  issue: IssueCluster
  records: GrievanceRecord[]
  onOpenRecord: (id: string) => void
}) {
  // The count comes from the cluster, not from what this device happens to
  // hold: a record can be backing an issue and no longer be in the store.
  const backing = issue.recordIds.length
  const missing = backing - records.length

  return (
    <Card className="h-full">
      <div className="flex items-start gap-3">
        <span className="num grid size-9 shrink-0 place-items-center rounded-[--radius-md] bg-[var(--surface-2)] text-sm text-ink-2">
          {issue.rank > 0 ? issue.rank : '—'}
        </span>
        <div className="min-w-0">
          <h3 className={cn('font-semibold leading-snug', isIndicScript(issue.title) && 'te')}>
            {issue.title}
          </h3>
          <p className="mt-1 text-xs text-ink-3">
            {metaLine(
              `${backing} ${pluralise(backing, 'record')} behind it`,
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

      <p className="mt-4 text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
        Who is driving it
      </p>
      <p className="mt-1 text-sm text-ink-2">
        {issue.politicalInvolvement ?? 'Not established from these records.'}
      </p>

      <p className="mt-3 text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
        What to say back
      </p>
      <p className="mt-1 text-sm text-ink-2">
        {issue.counterNarrative ?? 'No counter-narrative drafted yet.'}
      </p>

      {records.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {records.map((record) => (
            <li key={record.id}>
              <button
                onClick={() => onOpenRecord(record.id)}
                className="flex w-full items-center gap-2 rounded-[--radius-sm] px-2 py-2.5 text-left hover:bg-[var(--surface-2)]"
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
