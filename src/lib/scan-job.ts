import { useEffect, useState } from 'react'
import type {
  FakeAssessment,
  FakeSignal,
  GrievanceRecord,
  IssueCluster,
  NamedPerson,
  Recommendation,
} from '@shared/grievance'
import { NEWS_SOURCES } from '@shared/grievance'
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
  SEVERITIES,
  TARGETS,
  TOPICS,
} from '@shared/taxonomy'
import { ApiError, fetchWithTimeout, readJson } from '@/lib/net'
import { activeStorageKey, makeId, readStore, scopedKey, update } from '@/lib/store'
import { deskKey } from '@/lib/personas'
import { pluralise } from '@/lib/utils'
import { asVerdict, readVerdicts, saveVerdicts, verdictFor, worthShowing } from '@/lib/news-relevance'

/**
 * The sync that outlives the screen.
 *
 * "Sync today" is the longest thing this app does: it reads a handful of front
 * pages, then spends two model calls on every story it found. Two or three
 * minutes is normal. It used to live entirely inside the grievance screen —
 * an AbortController in a ref, and `useEffect(() => () => abort(), [])` to tidy
 * it up on unmount.
 *
 * That cleanup was the bug the office reported. Unmounting is not the same as
 * cancelling: a reader who taps Back, or opens the dashboard to look something
 * up while the sync runs, has not asked for anything to stop. But the screen
 * came down, the controller aborted, and every story still in flight and every
 * story still queued was thrown away without a word. What had already landed
 * survived, because records are written as each one arrives, so the damage was
 * invisible: the desk simply had fewer records than the papers had stories, and
 * nothing on screen ever said why.
 *
 * So the run does not live in the screen any more. It lives here, at module
 * scope, deliberately NOT in React state:
 *
 *   · a screen that unmounts changes nothing. Only `cancel()` stops a run, and
 *     only the reader calls it.
 *   · a screen that mounts halfway through calls `getState()` and immediately
 *     sees the stage that is running and everything already done, rather than
 *     an empty panel that makes a live sync look like a dead button.
 *   · both places that show the desk (the grievance screen and the settings
 *     desk) read the same run, because there is only one.
 *
 * What it CANNOT survive is the page itself going away, and pretending
 * otherwise would be worse than the original bug. A reload kills the fetches
 * outright. So the state is mirrored to localStorage on every change, and a
 * reload that finds a run marked "still going" reports it as interrupted, with
 * the count that did get filed, rather than restoring a progress bar that will
 * never move again.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   The seam with the server

   Moved here from components/Grievances.tsx, unchanged in behaviour: the
   parsing, the batch reader and the per-record persistence all belong to
   whatever is doing the reading, and the thing doing the reading is no longer
   the screen.

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

const UNREADABLE = 'This link came back unreadable. Try it again.'

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
        'The grievance service refused the request. Its key is missing or wrong, and whoever set the app up needs to check it.'
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
    res = await fetchWithTimeout('/api/grievance', {
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
    if (at >= 0) {
      /**
       * Everything fresh EXCEPT when it was first seen.
       *
       * This replaced the record whole, `createdAt` included, and that is how
       * yesterday's stories kept turning up under today. A story with no
       * printed date is filed on the day it was read (see recordDeskDay), so
       * one read yesterday sat in yesterday correctly. Re-read this morning,
       * because it is still on the paper's front page, it came back with a
       * new `createdAt` and walked forward a day. Every sync dragged the
       * undated part of yesterday into today, and it would have done it again
       * tomorrow.
       *
       * The classification is allowed to improve on a re-read. The date the
       * office first saw it is a fact about the past and does not change.
       */
      next[at] = { ...record, createdAt: next[at]!.createdAt }
    } else next.push(record)
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
   Finding the stories

   The scan itself makes no model call — it reads index pages and matches the
   desk's words — so it comes back in a second or two. It is shared rather than
   duplicated: the intake panel calls it on its own to fill the paste box (the
   deliberate two-step flow, where somebody sees what was found before spending
   two model calls per story), and the job below calls it as its first stage.
   One body, one set of parameters, so the two cannot drift apart.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ScanTargets {
  portals: string[]
  customUrls: string[]
  /**
   * The DISTRICT, falling back to the seat. Publishers issue editions by
   * district and never by assembly segment, so sending the seat here finds no
   * district route and silently drops the scan to the state page — the failure
   * this reads as is a quiet news week.
   */
  city: string | null
  tags: string[]
  /**
   * Words watched only alongside something narrower — the party, in practice.
   * On its own it returns the national wire: twenty-three stories about the
   * party and none about this member.
   */
  broadTags: string[]
  /**
   * Who the desk is for, so the scan can be JUDGED and not merely matched.
   *
   * Without this the endpoint keeps its old behaviour: harvest only the
   * headlines carrying a watch word, and show whatever survives. That is the
   * shape that put a cricket tournament on the desk because the fixture was
   * called the BJP Cup, and dropped a Union Budget story about Telangana
   * farmers because it named neither the member nor her seat. Sending a
   * subject switches the endpoint to harvest wide and have a model rule on
   * each story.
   *
   * Null when the desk has no identity yet, and then nothing is judged, which
   * is honest: an unjudged story is shown and labelled as unchecked.
   */
  subject: {
    name: string
    role: string | null
    constituency: string | null
    state: string | null
    party: string | null
    aliases: string[]
    /** Towns, mandals and district spellings this seat is known by. */
    places?: string[]
  } | null
  /** The desk's state, which ScanInput always accepted and this never sent. */
  state: string | null
}

export interface Findings {
  urls: string[]
  /** What was found, in a sentence. Set whether or not anything matched. */
  note: string | null
  /** Why nothing could be looked for at all. Null when the scan ran. */
  error: string | null
}

/** Read the chosen mastheads and return the stories carrying the desk's words. */
export async function findStories(
  targets: ScanTargets,
  signal?: AbortSignal,
): Promise<Findings> {
  try {
    const res = await fetchWithTimeout('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portals: targets.portals,
        customUrls: targets.customUrls,
        city: targets.city,
        tags: targets.tags,
        broadTags: targets.broadTags,
        state: targets.state,
        ...(targets.subject ? { subject: targets.subject } : {}),
      }),
      ...(signal ? { signal } : {}),
    })
    if (!res.ok && (res.headers.get('content-type') ?? '').includes('application/json')) {
      // A JSON error the endpoint chose to send: surface its own sentence.
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      return { urls: [], note: null, error: body?.error ?? `The scanner answered ${res.status}.` }
    }
    const data = (await readJson(res)) as {
      candidates?: {
        url: string
        title: string
        portal: string
        matched: string[]
        // Present only when a subject was sent. Null means the judge never
        // read this one, which is a different claim from ruling it out.
        verdict?:
          | 'about-person'
          | 'about-seat'
          | 'seat-routine'
          | 'about-party'
          | 'unrelated'
          | null
        confidence?: 'high' | 'medium' | 'low' | null
        why?: string | null
      }[]
      sources?: { portal: string; found: number; error: string | null }[]
      notes?: string[]
      relevance?: { judged: boolean; notes?: string[] }
      error?: string
    }
    if (!res.ok || data.error) {
      return { urls: [], note: null, error: data.error ?? `The scan failed (HTTP ${res.status}).` }
    }

    const found = data.candidates ?? []

    /**
     * Persist what the judge decided, before anything else uses it.
     *
     * This is the join the whole relevance feature hangs on. The endpoint
     * returns a verdict per story and the screens read it back out of the
     * cache; without this line the cache is never written, every story reads
     * as unjudged, and the filter that exists to stop showing sport quietly
     * passes everything through. Written even when the judge did not run, so
     * a story is recorded as unchecked rather than as unseen.
     */
    if (found.some((c) => c.verdict !== undefined)) {
      // `asVerdict` normalises a whole row and returns null for one it cannot
      // trust, so a malformed entry is dropped rather than recorded as a
      // decision nobody made.
      const rows = found
        .map((c) =>
          asVerdict({
            url: c.url,
            verdict: c.verdict ?? 'unjudged',
            confidence: c.confidence ?? null,
            why: c.why ?? null,
            // How it got here, which is what decides whether an unjudged story
            // is worth showing. `matched` means it carried a word this office
            // watches; empty means the wide harvest swept up the whole front
            // page and this one matched nothing.
            via: (c.matched?.length ?? 0) > 0 ? 'matched' : 'harvested',
          }),
        )
        .filter((v): v is NonNullable<typeof v> => v !== null)
      if (rows.length > 0) saveVerdicts(rows, targets.subject?.name ?? null)
    }
    if (found.length === 0) {
      const dead = (data.sources ?? []).filter((s) => s.error)
      return {
        urls: [],
        note:
          dead.length > 0
            ? `Nothing matched. ${dead.map((d) => `${d.portal}: ${d.error}`).join(' ')}`
            : 'The papers had nothing carrying your words today. Try fewer words, or add a paper.',
        error: null,
      }
    }

    /*
     * The verdict decides what gets READ, not merely what gets shown.
     *
     * This used to return every candidate. The judge's ruling was written to
     * the cache one block above and then ignored here, so a story the model
     * had just ruled "not about you" was fetched, sent to /api/grievance,
     * classified by a second model call and filed as a permanent record on the
     * office's desk. The desk then opened on a district paper's whole front
     * page, which is the complaint this whole feature exists to answer, and
     * every ruled-out story cost two model calls on the way in.
     *
     * `worthShowing` is the same predicate the screens use, so a story can
     * never be filed under one rule and hidden under another. What was set
     * aside is COUNTED and named in the note: a filter that shrinks the day's
     * work silently is a filter nobody can correct.
     */
    const cache = readVerdicts(targets.subject?.name ?? null)
    const keep = found.filter((c) => worthShowing(verdictFor(c.url, cache)))
    const setAside = found.length - keep.length

    const perSource = (data.sources ?? []).map((s) => `${s.portal} ${s.found}`).join(' · ')
    return {
      urls: keep.map((c) => c.url),
      note:
        `Found ${found.length} ${pluralise(found.length, 'story', 'stories')}: ${perSource}.` +
        (setAside > 0
          ? ` ${setAside} set aside as not your desk's business; ${keep.length} kept.`
          : '') +
        (data.notes?.length ? ` ${data.notes.join(' ')}` : ''),
      error: null,
    }
  } catch (err) {
    // An ApiError means the scanner WAS reached and answered badly (a timeout
    // page, a 502): its message already says what to do, so it is shown as-is
    // rather than dressed up as "could not reach", which would be false.
    if (err instanceof ApiError) {
      return { urls: [], note: null, error: err.message }
    }
    // A real network failure or the client's own deadline firing: that is a
    // reachability problem, and the prefix is true.
    const why =
      err instanceof DOMException && err.name === 'TimeoutError'
        ? 'the request timed out before the scanner answered'
        : err instanceof Error
          ? err.message
          : String(err)
    return { urls: [], note: null, error: `Could not reach the scanner: ${why}` }
  }
}

/** The publisher's name when we recognise the host, null when we do not. */
export function publisherFor(host: string): string | null {
  const h = host.toLowerCase()
  return NEWS_SOURCES.find((s) => h === s.host || h.endsWith(`.${s.host}`))?.label ?? null
}

/* ═══════════════════════════════════════════════════════════════════════════
   The job
   ═══════════════════════════════════════════════════════════════════════════ */

export type ScanJobStatus = 'idle' | 'scanning' | 'reading' | 'done' | 'failed'
export type StageKey = 'find' | 'sift' | 'read' | 'group'
export type StageState = 'pending' | 'active' | 'done' | 'skipped' | 'failed'
export type LinkStatus = 'queued' | 'reading' | 'done' | 'failed'

export interface ScanStage {
  key: StageKey
  /** The one-word name on the badge. The narration lives with the panel. */
  label: string
  state: StageState
  /** What this stage actually found, in the server's or the desk's own words. */
  detail?: string
}

export interface ScanLink {
  url: string
  /** The headline, once a record for this link has landed. */
  title?: string
  status: LinkStatus
  /** Why it failed, in the sentence the server or this module supplied. */
  message?: string
}

export interface ScanJobState {
  status: ScanJobStatus
  stages: ScanStage[]
  links: ScanLink[]
  startedAt: string | null
  finishedAt: string | null
  /**
   * Why the run did not do what it promised. Null when it did.
   *
   * Kept apart from `note` because they are different claims. "Nothing new,
   * everything on the front pages is already on the desk" is a successful run
   * with nothing to do; "the scanner could not be reached" is a failure. A
   * single field would have to be read with a status to know which, and the
   * panel would end up colouring good news red.
   */
  error: string | null
  /** What happened, in one sentence, when the run worked. */
  note: string | null
  /** Which of the two runs this was, so a panel can say what it was doing. */
  kind: 'sync' | 'read' | null
}

const STAGE_PLAN: readonly { key: StageKey; label: string }[] = [
  { key: 'find', label: 'Papers' },
  { key: 'sift', label: 'New' },
  { key: 'read', label: 'Stories' },
  { key: 'group', label: 'Issues' },
]

export type ScanJobInput = ({ kind: 'sync' } & ScanTargets) | { kind: 'read'; urls: string[] }

/**
 * Per DESK, not per account: this is the news scan for one politician's watch
 * terms. A scan running for Rahul Gandhi must not be handed back as the state
 * of a scan on Narendra Modi's desk.
 */
const JOB_KEY = 'signal.scanjob.v1'

const idle = (): ScanJobState => ({
  status: 'idle',
  stages: STAGE_PLAN.map((s) => ({ ...s, state: 'pending' as StageState })),
  links: [],
  startedAt: null,
  finishedAt: null,
  error: null,
  note: null,
  kind: null,
})

let state: ScanJobState = idle()
let controller: AbortController | null = null
const listeners = new Set<(s: ScanJobState) => void>()

/**
 * Which account's storage the state in memory belongs to.
 *
 * Null until something asks. The vault points the store at an account long
 * after this module is first imported, so reading localStorage at import time
 * would read the wrong namespace — and, on a shared device, would show one
 * person the last sync of another. See `hydrate`.
 */
let loadedFor: string | null = null

const isRunning = (s: ScanJobStatus): boolean => s === 'scanning' || s === 'reading'

function emit(): void {
  for (const l of listeners) l(state)
}

function save(): void {
  try {
    localStorage.setItem(deskKey(JOB_KEY), JSON.stringify(state))
  } catch {
    /* private mode, or the quota is full. The run still works in memory; only
       the honest report after a reload is lost, which is the safe direction. */
  }
}

function set(patch: Partial<ScanJobState>): void {
  state = { ...state, ...patch }
  save()
  emit()
}

/* ── what a reload finds ─────────────────────────────────────────────────── */

const JOB_STATUSES: readonly ScanJobStatus[] = ['idle', 'scanning', 'reading', 'done', 'failed']
const STAGE_STATES: readonly StageState[] = ['pending', 'active', 'done', 'skipped', 'failed']
const LINK_STATUSES: readonly LinkStatus[] = ['queued', 'reading', 'done', 'failed']
const STAGE_KEYS: readonly StageKey[] = ['find', 'sift', 'read', 'group']

const INTERRUPTED_LINK =
  'The page closed before this link was read. It is still unread. Sync again to finish it.'

/**
 * Turn a run that was still going into a report of what it managed.
 *
 * A reload kills every fetch the page had open. Restoring the state as it was
 * saved would show a progress bar that will never move and a spinner on a link
 * nothing is reading, which is a worse lie than the silence this whole module
 * exists to fix. So the run is closed out where it stood: what landed is on the
 * desk and says so, what did not is named as unread, and the sentence says the
 * page closed rather than pretending the server failed.
 */
function closeInterrupted(restored: ScanJobState): ScanJobState {
  const filed = restored.links.filter((l) => l.status === 'done').length
  const total = restored.links.length

  return {
    ...restored,
    status: 'failed',
    finishedAt: restored.finishedAt ?? new Date().toISOString(),
    error:
      total === 0
        ? 'This sync did not finish. The papers were still being scanned when the page was closed or reloaded, so nothing was filed. Sync again.'
        : filed === 0
          ? `This sync did not finish, most likely because the page was closed or reloaded. None of the ${total} ${pluralise(total, 'story', 'stories')} it found had been read. Sync again to read them.`
          : `This sync did not finish, most likely because the page was closed or reloaded. ${filed} of ${total} ${pluralise(total, 'story', 'stories')} had been read and ${pluralise(filed, 'is', 'are')} on the desk. The rest were not read. Sync again to finish them.`,
    note: null,
    stages: restored.stages.map((s) =>
      s.state === 'active'
        ? { ...s, state: 'failed' as StageState }
        : s.state === 'pending'
          ? { ...s, state: 'skipped' as StageState }
          : s,
    ),
    links: restored.links.map((l) =>
      l.status === 'done' || l.status === 'failed'
        ? l
        : { ...l, status: 'failed' as LinkStatus, message: INTERRUPTED_LINK },
    ),
  }
}

function readSaved(): ScanJobState | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(deskKey(JOB_KEY))
  } catch {
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const o = asObject(parsed)
  if (!o) return null
  const status = oneOf(JOB_STATUSES, o.status)
  if (!status) return null

  const stages = Array.isArray(o.stages)
    ? o.stages.flatMap((raw2): ScanStage[] => {
        const s = asObject(raw2)
        if (!s) return []
        const key = oneOf(STAGE_KEYS, s.key)
        const stageState = oneOf(STAGE_STATES, s.state)
        const label = text(s.label)
        if (!key || !stageState || !label) return []
        const detail = text(s.detail)
        return [{ key, label, state: stageState, ...(detail ? { detail } : {}) }]
      })
    : []

  const links = Array.isArray(o.links)
    ? o.links.flatMap((raw2): ScanLink[] => {
        const l = asObject(raw2)
        if (!l) return []
        const url = text(l.url)
        const linkStatus = oneOf(LINK_STATUSES, l.status)
        if (!url || !linkStatus) return []
        const title = text(l.title)
        const message = text(l.message)
        return [
          {
            url,
            status: linkStatus,
            ...(title ? { title } : {}),
            ...(message ? { message } : {}),
          },
        ]
      })
    : []

  // A saved run with no stages is a payload from some other version of this
  // key. Nothing can be said about it honestly, so nothing is.
  if (stages.length !== STAGE_PLAN.length) return null

  const restored: ScanJobState = {
    status,
    stages,
    links,
    startedAt: text(o.startedAt),
    finishedAt: text(o.finishedAt),
    error: text(o.error),
    note: text(o.note),
    kind: o.kind === 'sync' || o.kind === 'read' ? o.kind : null,
  }

  if (isRunning(status)) return closeInterrupted(restored)

  /**
   * A run that finished cleanly has already reported itself: the records are on
   * the desk, which is where the office reads them. Restoring its panel every
   * morning would put a stale progress card above the day's work for ever. Only
   * a run with something still owed to the reader — a failure, or links that
   * were never read — comes back.
   */
  const owed = restored.error !== null || restored.links.some((l) => l.status !== 'done')
  return owed ? restored : null
}

/**
 * Point the module at the signed-in account's saved run.
 *
 * Called from `getState` and `subscribe` rather than at import time, because
 * the vault decides which namespace is live long after this module loads. A
 * live run is never disturbed: its own storage-key check (below) is what
 * handles an account switch mid-run.
 */
function hydrate(): void {
  const key = activeStorageKey()
  if (loadedFor === key || controller) return
  loadedFor = key
  state = readSaved() ?? idle()
}

/* ── the API ─────────────────────────────────────────────────────────────── */

export function getState(): ScanJobState {
  hydrate()
  return state
}

/**
 * Watch the run. Returns the unsubscribe.
 *
 * Deliberately does not fire on subscribe — `getState()` is how a screen that
 * mounts halfway through catches up, and having both would make it ambiguous
 * which one a component was rendering.
 */
export function subscribe(fn: (s: ScanJobState) => void): () => void {
  hydrate()
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Read the run in a component and re-render as it moves. */
export function useScanJob(): ScanJobState {
  const [snapshot, setSnapshot] = useState<ScanJobState>(getState)
  useEffect(() => {
    // Catch up first: the run may have moved between this render and this
    // effect, and on a remount mid-run it has moved a great deal.
    setSnapshot(getState())
    return subscribe(setSnapshot)
  }, [])
  return snapshot
}

/**
 * Stop the run, because the reader asked.
 *
 * The ONLY thing that stops a run. Unmounting does not, which is the whole
 * point of this module: the screen coming down is not a decision about the
 * work, and treating it as one is what silently threw away half a sync.
 */
export function cancel(): void {
  controller?.abort()
}

/**
 * Clear a finished run from view.
 *
 * Separate from `cancel` on purpose: cancel stops work, this only puts away a
 * report the reader has read. It refuses while a run is going, so a stray tap
 * cannot make a live sync invisible.
 */
export function dismiss(): void {
  if (isRunning(state.status)) return
  state = idle()
  try {
    localStorage.removeItem(deskKey(JOB_KEY))
  } catch {
    /* nothing to remove */
  }
  emit()
}

/**
 * Begin a run, or do nothing because one is already going.
 *
 * A no-op rather than a queue or a second controller. Two syncs at once would
 * read the same front pages twice, spend two model calls per story twice, and
 * leave two abort controllers where the reader can only reach one.
 */
export function start(input: ScanJobInput): void {
  hydrate()
  if (isRunning(state.status)) return

  const c = new AbortController()
  controller = c
  loadedFor = activeStorageKey()

  state = {
    status: input.kind === 'sync' ? 'scanning' : 'reading',
    stages: STAGE_PLAN.map((s) => ({ ...s, state: 'pending' as StageState })),
    links: input.kind === 'read' ? input.urls.map((url) => ({ url, status: 'queued' as const })) : [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    note: null,
    kind: input.kind,
  }
  save()
  emit()

  void run(input, c.signal)
    .catch((err: unknown) => {
      // `run` is written not to throw. If it ever does, the reader still gets a
      // sentence rather than a panel frozen at whichever stage was live.
      finish({
        status: 'failed',
        error: `The sync stopped unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
      })
    })
    .finally(() => {
      if (controller === c) controller = null
    })
}

/* ── the run itself ──────────────────────────────────────────────────────── */

function patchStage(key: StageKey, next: StageState, detail?: string | null): void {
  set({
    stages: state.stages.map((s) => {
      if (s.key !== key) return s
      // `undefined` leaves the existing detail alone; `null` clears it.
      const carried = detail === undefined ? s.detail : (detail ?? undefined)
      return { key: s.key, label: s.label, state: next, ...(carried ? { detail: carried } : {}) }
    }),
  })
}

function markLink(url: string, patch: Partial<ScanLink>): void {
  set({ links: state.links.map((l) => (l.url === url ? { ...l, ...patch } : l)) })
}

function finish(patch: { status: 'done' | 'failed'; note?: string; error?: string }): void {
  set({
    status: patch.status,
    note: patch.note ?? null,
    error: patch.error ?? null,
    finishedAt: new Date().toISOString(),
  })
}

async function run(input: ScanJobInput, signal: AbortSignal): Promise<void> {
  /**
   * The desk this run belongs to.
   *
   * A run now outlives the screen, which means it can also outlive the account
   * that started it: sign out mid-sync and `persist` would file this office's
   * stories into whoever signs in next, because the store writes to whichever
   * namespace is live at the moment of the call. So the run remembers where it
   * started and stops the moment that changes.
   */
  const homeKey = activeStorageKey()
  const sameDesk = (): boolean => activeStorageKey() === homeKey

  /**
   * A run the reader stopped.
   *
   * Not a failure: nothing broke, somebody pressed Stop. The status says the
   * run is over, the sentence says who ended it and where it got to, and every
   * link that never got read says so on its own row so it can be tried again.
   */
  const stopHere = (done: number): void => {
    if (!sameDesk()) return
    set({
      links: state.links.map((l) =>
        l.status === 'done' || l.status === 'failed'
          ? l
          : { ...l, status: 'failed' as LinkStatus, message: STOPPED },
      ),
      stages: state.stages.map((s) => {
        if (s.state !== 'active' && s.state !== 'pending') return s
        // A stage that had begun and got part of the way is not "not run". It
        // was cut short, and its badge has to say so or the strip misreports
        // the very thing the reader just did.
        if (s.state === 'active' && s.key === 'read' && done > 0) {
          return { ...s, state: 'done' as StageState, detail: `${done} read before you stopped.` }
        }
        return { ...s, state: 'skipped' as StageState }
      }),
    })
    finish({
      status: 'done',
      note:
        state.links.length === 0
          ? 'You stopped this sync before the papers had been read.'
          : `You stopped this sync. ${done} of ${state.links.length} ${pluralise(state.links.length, 'story', 'stories')} were read and filed. The rest were left unread.`,
    })
  }

  let targets: string[] = []

  if (input.kind === 'read') {
    patchStage('find', 'skipped', 'These links were pasted by hand, so no papers were scanned.')
    patchStage(
      'sift',
      'skipped',
      'Pasted links are read exactly as given, including any the desk already holds.',
    )
    targets = input.urls
  } else {
    patchStage('find', 'active')
    const found = await findStories(input, signal)

    if (signal.aborted) return stopHere(0)

    if (found.error) {
      patchStage('find', 'failed', found.error)
      patchStage('sift', 'skipped', 'The papers could not be read, so there was nothing to compare.')
      patchStage('read', 'skipped', 'No stories reached the reader.')
      patchStage('group', 'skipped', 'Nothing was read, so nothing was grouped.')
      finish({ status: 'failed', error: found.error })
      return
    }

    patchStage('find', 'done', found.note)

    if (found.urls.length === 0) {
      patchStage('sift', 'skipped', 'Nothing was found, so there was nothing to compare.')
      patchStage('read', 'skipped', 'There was nothing to read.')
      patchStage('group', 'skipped', 'Nothing was read, so nothing was grouped.')
      finish({
        status: 'done',
        note: found.note ?? 'The papers had nothing carrying your words today.',
      })
      return
    }

    /**
     * Skip what the desk already holds.
     *
     * A masthead's front page carries several days at once, so most of what a
     * second sync finds is what the first one already read. Reading a story
     * again costs two model calls and teaches the office nothing.
     */
    patchStage('sift', 'active')
    const held = new Set(readStore().grievances.map((r) => r.sourceUrl))
    targets = found.urls.filter((u) => !held.has(u))
    const already = found.urls.length - targets.length

    if (targets.length === 0) {
      patchStage(
        'sift',
        'done',
        `All ${found.urls.length} ${pluralise(found.urls.length, 'story', 'stories')} on the front pages are already on the desk.`,
      )
      patchStage('read', 'skipped', 'Every story found was already on the desk.')
      patchStage('group', 'skipped', 'Nothing was read, so nothing was grouped.')
      finish({
        status: 'done',
        note: `Nothing new. All ${found.urls.length} ${pluralise(found.urls.length, 'story', 'stories')} on the front pages are already on the desk.`,
      })
      return
    }

    patchStage(
      'sift',
      'done',
      already > 0
        ? `${targets.length} new. ${already} already on the desk, left alone.`
        : `All ${targets.length} ${pluralise(targets.length, 'story', 'stories')} are new to the desk.`,
    )
    set({ links: targets.map((url) => ({ url, status: 'queued' as const })) })
  }

  /* ── reading, one batch at a time ──────────────────────────────────────── */

  const total = targets.length
  set({ status: 'reading' })
  patchStage('read', 'active', `Reading ${total} ${pluralise(total, 'story', 'stories')}.`)

  const failed = new Map<string, string>()
  let filed = 0
  // Ids, not a running total: the server re-sends a cluster it has already sent
  // when a later batch adds a record to it, and counting arrivals would report
  // eleven issues on a desk that has four.
  const grouped = new Set<string>()

  const onOutcome: OnOutcome = (url, record, error) => {
    // Records that arrive after the desk changed underneath us are dropped
    // rather than filed into somebody else's store.
    if (!sameDesk()) return
    if (record) {
      // Written as each one lands rather than at the end of the batch: a
      // connection that drops at link seven should cost the office links
      // eight, nine and ten — not the six already read.
      persist([record], [])
      failed.delete(url)
      filed += 1
      markLink(url, { status: 'done', title: record.headline, message: undefined })
      patchStage('read', 'active', `Just filed: ${record.headline}`)
    } else {
      const message = error ?? UNREADABLE
      failed.set(url, message)
      markLink(url, { status: 'failed', message })
    }
  }

  let pending = [...targets]
  let oneAtATime = false

  while (pending.length && !signal.aborted) {
    if (!sameDesk()) {
      controller?.abort()
      break
    }

    const round = oneAtATime ? pending.slice(0, 1) : pending
    const single = oneAtATime ? round[0] : null
    if (single) markLink(single, { status: 'reading', message: undefined })

    const outcome = await readBatch(round, signal, onOutcome)
    if (outcome.issues.length) {
      if (sameDesk()) persist([], outcome.issues)
      for (const issue of outcome.issues) grouped.add(issue.id)
    }

    const remaining = pending.filter((url) => !outcome.settled.has(url))

    if (outcome.stop) {
      const message = outcome.message ?? 'The grievance service is not taking more links now.'
      for (const url of remaining) {
        failed.set(url, message)
        markLink(url, { status: 'failed', message })
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
      failed.set(first, message)
      markLink(first, { status: 'failed', message })
    }
    pending = rest
  }

  if (signal.aborted) return stopHere(filed)

  /* ── what it came to ───────────────────────────────────────────────────── */

  if (!sameDesk()) return

  patchStage(
    'read',
    filed > 0 ? 'done' : 'failed',
    `${filed} of ${total} ${pluralise(total, 'story', 'stories')} read.`,
  )

  // Grouping is the server's, and it does not always send one. Claiming a
  // clustering pass ran when no clusters arrived would put a tick against work
  // nobody did.
  if (grouped.size > 0) {
    patchStage('group', 'done', `Grouped into ${grouped.size} ${pluralise(grouped.size, 'issue')}.`)
  } else {
    patchStage('group', 'skipped', 'The service sent no grouping for these stories.')
  }

  if (filed === 0) {
    finish({
      status: 'failed',
      error: `None of the ${total} ${pluralise(total, 'story', 'stories')} could be read. Each one says why below.`,
    })
    return
  }

  finish({
    status: 'done',
    note:
      failed.size > 0
        ? `Read ${filed} of ${total} ${pluralise(total, 'story', 'stories')}. ${failed.size} could not be read and ${pluralise(failed.size, 'is', 'are')} listed below.`
        : `Read all ${total} ${pluralise(total, 'story', 'stories')} and filed them on the desk.`,
  })
}
