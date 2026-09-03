import { addSnapshot, listHandles, saveHandle, type HandleSnapshot, type TrackedHandle } from '@/lib/handles'
import { fetchWithTimeout } from '@/lib/net'

/**
 * Draining the collector inbox into the desk.
 *
 * The collector (the office's own machine) walks accounts and leaves raw
 * readings in a server mailbox. This is the app end: it pulls what is
 * waiting, merges it through the SAME store writes the live refresh uses, and
 * acks only what merged. The server never merged anything itself, on purpose,
 * so this is the one place a collector reading becomes desk state, and it runs
 * under the desk's own storage scope with the app's own code.
 *
 * TWO THINGS THIS GUARDS AGAINST, both from the recon:
 *
 *   REDELIVERY. A collector retries a report on a flaky link, so the same
 *   reading can arrive twice. `addSnapshot` appends without looking, so a
 *   naive drain would file two snapshots for one walk. Every snapshot entry
 *   is deduped here against the day it was read: one reading per handle per
 *   IST day, whichever arrived first.
 *
 *   A FAILURE IS NOT AN EMPTY READING. A walk that hit a login wall arrives
 *   as a `walk-failed` entry, never as a snapshot with no posts. It is acked
 *   (so it stops being redelivered) and surfaced as a note, never merged as
 *   though the account went quiet. The office must be able to tell "posted
 *   nothing" from "session expired", and that line is held here too.
 *
 * WHAT V1 DOES NOT DO: it does not turn raw comment text into a scored
 * Standing. Scoring is a model call the server already owns at /api/standing,
 * and doing it in the browser would duplicate that and spend a call per
 * drain. Comment entries are counted and reported so the office knows the
 * collector is reaching them; wiring them into a Standing is the next slice,
 * behind the same endpoint the live reader uses.
 */

const API = '/api/collector-inbox'

interface RawEntry {
  id: string
  kind: 'snapshot' | 'comments' | 'walk-failed'
  handleId: string
  platform: string
  url: string | null
  payload: unknown
  readAt: string
  collector: string
}

interface ScrapedPostish {
  url: string
  title: string | null
  publishedAt: string | null
  likes: number | null
  comments: number | null
  shares: number | null
  views: number | null
  thumbnailUrl: string | null
}

export interface DrainResult {
  /** Entries that became desk state. */
  merged: number
  /** Snapshot entries dropped as a same-day redelivery. */
  deduped: number
  /** Walks that failed on the collector; surfaced, not merged. */
  failed: { handleId: string; platform: string; reason: string; needsLogin: boolean }[]
  /** Comment readings received (counted in v1, not yet scored). */
  commentsReceived: number
  /** A sentence for the screen, or null when nothing was waiting. */
  note: string | null
}

const EMPTY: DrainResult = {
  merged: 0,
  deduped: 0,
  failed: [],
  commentsReceived: 0,
  note: null,
}

/** The IST day a reading belongs to, for the per-day dedupe. */
const istDay = (iso: string): string =>
  new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10)

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function toPost(raw: unknown): ScrapedPostish | null {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Record<string, unknown>
  if (typeof p['url'] !== 'string') return null
  return {
    url: p['url'],
    title: typeof p['title'] === 'string' ? p['title'] : null,
    publishedAt: typeof p['publishedAt'] === 'string' ? p['publishedAt'] : null,
    likes: num(p['likes']),
    comments: num(p['comments']),
    shares: num(p['shares']),
    views: num(p['views']),
    thumbnailUrl: typeof p['thumbnailUrl'] === 'string' ? p['thumbnailUrl'] : null,
  }
}

/**
 * Pull, merge, ack. Returns what happened for the office to see.
 *
 * Never throws: a desk with no server, no collector or no network gets an
 * empty result and a quiet app, which is the correct nothing.
 */
export async function drainCollectorInbox(token: string): Promise<DrainResult> {
  let entries: RawEntry[]
  try {
    const res = await fetchWithTimeout(API, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!res.ok) return EMPTY
    const body = (await res.json()) as { entries?: RawEntry[] }
    entries = Array.isArray(body.entries) ? body.entries : []
  } catch {
    return EMPTY
  }
  if (entries.length === 0) return EMPTY

  const handles = listHandles()
  const byId = new Map<string, TrackedHandle>(handles.map((h) => [h.id, h]))
  // Which handle already has a reading for which IST day, so a redelivered
  // snapshot for a day already filled is dropped rather than doubled.
  const filledDays = new Set<string>()
  for (const h of handles) {
    for (const s of h.snapshots) filledDays.add(`${h.id}:${istDay(s.takenAt)}`)
  }

  const result: DrainResult = { merged: 0, deduped: 0, failed: [], commentsReceived: 0, note: null }
  const acked: string[] = []

  for (const e of entries) {
    if (e.kind === 'walk-failed') {
      const p = (e.payload ?? {}) as { reason?: string; needsLogin?: boolean }
      result.failed.push({
        handleId: e.handleId,
        platform: e.platform,
        reason: p.reason ?? 'the walk failed',
        needsLogin: p.needsLogin === true,
      })
      acked.push(e.id) // seen and surfaced; do not redeliver a failure forever
      continue
    }

    if (e.kind === 'comments') {
      const p = (e.payload ?? {}) as { comments?: unknown[] }
      result.commentsReceived += Array.isArray(p.comments) ? p.comments.length : 0
      // Left in the mailbox unacked: the standing-scoring slice will consume
      // it. Acking here would lose the text before anything read it.
      continue
    }

    // A snapshot.
    const handle = byId.get(e.handleId)
    if (!handle) {
      acked.push(e.id) // a reading for a handle the desk no longer tracks
      continue
    }
    const dayKey = `${e.handleId}:${istDay(e.readAt)}`
    if (filledDays.has(dayKey)) {
      result.deduped += 1
      acked.push(e.id)
      continue
    }

    const p = (e.payload ?? {}) as {
      followers?: unknown
      displayName?: unknown
      avatarUrl?: unknown
      posts?: unknown[]
    }
    const posts = Array.isArray(p.posts)
      ? p.posts.map(toPost).filter((x): x is ScrapedPostish => x !== null)
      : []
    const snapshot: HandleSnapshot = {
      takenAt: e.readAt,
      followers: num(p.followers),
      posts,
    }
    addSnapshot(e.handleId, snapshot)
    filledDays.add(dayKey)

    // A display name or avatar the walk saw and the desk lacks, filled in
    // without disturbing anything the office set by hand.
    const name = typeof p.displayName === 'string' ? p.displayName : null
    const avatar = typeof p.avatarUrl === 'string' ? p.avatarUrl : null
    if ((name && !handle.displayName) || (avatar && !handle.avatarUrl)) {
      saveHandle({
        ...handle,
        displayName: handle.displayName || name || handle.displayName,
        avatarUrl: handle.avatarUrl || avatar || handle.avatarUrl,
      })
    }

    result.merged += 1
    acked.push(e.id)
  }

  if (acked.length > 0) {
    try {
      await fetchWithTimeout(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ ack: acked }),
      })
    } catch {
      /* an unacked entry is redelivered and deduped next drain; losing an ack
         costs a repeat, never data */
    }
  }

  const parts: string[] = []
  if (result.merged > 0) parts.push(`${result.merged} readings merged`)
  if (result.commentsReceived > 0) parts.push(`${result.commentsReceived} comments waiting`)
  if (result.failed.length > 0) parts.push(`${result.failed.length} walks failed`)
  result.note = parts.length > 0 ? `Collector: ${parts.join(', ')}.` : null
  return result
}
