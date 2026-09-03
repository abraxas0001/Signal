/**
 * The collector protocol's server half: policy, job derivation, and the inbox.
 *
 * THE DESIGN IN ONE SENTENCE: the office's own machine runs the walks (their
 * browser, their session, their account), this server only decides WHAT is
 * worth walking and holds the results until the app next opens. Production
 * infrastructure never touches a platform credential, which is the entire
 * point of the shape.
 *
 * WHERE THE WORK LIST COMES FROM. Nothing registers a watch list with this
 * module, because the desk already has one: the synced desk store holds the
 * tracked handles (signal.handles.v1) and the comment readings
 * (signal.standing.v1) as plaintext JSON, pushed by the same desk-sync
 * machinery the app uses. Jobs are derived by reading that bundle and asking
 * two questions per handle: is the latest snapshot older than the cadence,
 * and is the standing staler than its own? One source of truth; the server
 * merely reads the desk's homework and writes its worksheet.
 *
 * WHAT THE SERVER NEVER DOES: it never merges results into the synced keys.
 * Whole-key replacement with client-side merge is the desk-sync contract
 * (writeDeskBundle's comment says why), and a server that edited values
 * server-side would break it for every desk at once. Results wait in the
 * inbox, and the app drains and merges them with the same code it uses for
 * every other reading.
 *
 * THE KILL SWITCH IS A FIELD. `paused: true` on the policy stops every
 * collector for the desk at its next poll, at most one poll interval away.
 * When a platform shifts its defences, that one write is the difference
 * between a calm pause and a morning of flagged accounts.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { db } from './firebase'
import { readDeskBundle } from './desk-sync'

/* ── policy ─────────────────────────────────────────────────────────────── */

export interface CollectorPolicy {
  /** The whole feature, off unless a desk turned it on. */
  enabled: boolean
  /** The kill switch. Collectors stop at their next poll. */
  paused: boolean
  /** Walks allowed per calendar day (IST), across all kinds. */
  dailyCap: number
  /** IST hours a collector may work in, inclusive start, exclusive end. */
  activeHoursIst: [number, number]
  /** Floor between two walks, before the collector's own jitter. */
  minGapMs: number
  /** How old a follower/posts snapshot may grow before a refresh is due. */
  snapshotCadenceHours: number
  /** How old a comment reading may grow before a rewalk is due. */
  standingCadenceHours: number
  /** Most posts to walk for comments per handle per run. */
  commentPostsPerHandle: number
}

/**
 * Deliberately quiet defaults: one working day, sixty walks, five-minute
 * gaps. An office that wants more turns the dials with its eyes open; a
 * default should never be the thing that gets an account flagged.
 */
export const DEFAULT_POLICY: CollectorPolicy = {
  enabled: false,
  paused: false,
  dailyCap: 60,
  activeHoursIst: [8, 22],
  minGapMs: 5 * 60 * 1000,
  snapshotCadenceHours: 20,
  standingCadenceHours: 44,
  commentPostsPerHandle: 3,
}

const POLICIES = 'collectorPolicies'
const INBOX = 'collectorInbox'
const ENTRIES = 'entries'

const clampNum = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

/** The stored policy, defaults filled in, every dial clamped to sane bounds. */
export async function readPolicy(deskId: string): Promise<CollectorPolicy> {
  const store = db()
  if (!store) return { ...DEFAULT_POLICY }
  try {
    const doc = await store.collection(POLICIES).doc(deskId).get()
    const d = doc.data() ?? {}
    const hours = Array.isArray(d['activeHoursIst']) ? d['activeHoursIst'] : []
    return {
      enabled: d['enabled'] === true,
      paused: d['paused'] === true,
      dailyCap: clampNum(d['dailyCap'], 1, 500, DEFAULT_POLICY.dailyCap),
      activeHoursIst: [
        clampNum(hours[0], 0, 23, DEFAULT_POLICY.activeHoursIst[0]),
        clampNum(hours[1], 1, 24, DEFAULT_POLICY.activeHoursIst[1]),
      ],
      minGapMs: clampNum(d['minGapMs'], 30_000, 3_600_000, DEFAULT_POLICY.minGapMs),
      snapshotCadenceHours: clampNum(d['snapshotCadenceHours'], 1, 24 * 14, DEFAULT_POLICY.snapshotCadenceHours),
      standingCadenceHours: clampNum(d['standingCadenceHours'], 1, 24 * 30, DEFAULT_POLICY.standingCadenceHours),
      commentPostsPerHandle: clampNum(d['commentPostsPerHandle'], 1, 10, DEFAULT_POLICY.commentPostsPerHandle),
    }
  } catch {
    return { ...DEFAULT_POLICY }
  }
}

export async function writePolicy(
  deskId: string,
  patch: Partial<CollectorPolicy>,
): Promise<boolean> {
  const store = db()
  if (!store) return false
  const clean: Record<string, unknown> = {}
  if (typeof patch.enabled === 'boolean') clean['enabled'] = patch.enabled
  if (typeof patch.paused === 'boolean') clean['paused'] = patch.paused
  if (typeof patch.dailyCap === 'number') clean['dailyCap'] = patch.dailyCap
  if (Array.isArray(patch.activeHoursIst)) clean['activeHoursIst'] = patch.activeHoursIst
  if (typeof patch.minGapMs === 'number') clean['minGapMs'] = patch.minGapMs
  if (typeof patch.snapshotCadenceHours === 'number')
    clean['snapshotCadenceHours'] = patch.snapshotCadenceHours
  if (typeof patch.standingCadenceHours === 'number')
    clean['standingCadenceHours'] = patch.standingCadenceHours
  if (typeof patch.commentPostsPerHandle === 'number')
    clean['commentPostsPerHandle'] = patch.commentPostsPerHandle
  if (Object.keys(clean).length === 0) return true
  clean['updatedAt'] = new Date().toISOString()
  try {
    await store.collection(POLICIES).doc(deskId).set(clean, { merge: true })
    return true
  } catch {
    return false
  }
}

/* ── jobs ───────────────────────────────────────────────────────────────── */

export interface CollectorJob {
  /** Stable for a given piece of work on a given day, so retries collapse. */
  id: string
  kind: 'posts' | 'comments'
  platform: string
  /** posts jobs carry the handle; comments jobs carry the post url. */
  handle: string | null
  url: string | null
  /** The tracked handle the result files under, verbatim from the desk. */
  handleId: string
  limit: number
  /** Why this job exists, for the collector's log and nobody else. */
  why: string
}

interface TrackedishHandle {
  id: string
  platform: string
  handle: string
  own: boolean
  snapshots: { takenAt: string; posts: { url: string; publishedAt?: string | null }[] }[]
}

const hoursAgo = (iso: string | null | undefined): number => {
  if (!iso) return Number.POSITIVE_INFINITY
  const t = Date.parse(iso)
  return Number.isFinite(t) ? (Date.now() - t) / 3_600_000 : Number.POSITIVE_INFINITY
}

/** The day, in IST, that caps and job ids are counted against. */
export const istDay = (): string =>
  new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)

/**
 * The work list, derived from the desk's own synced store.
 *
 * Reads the bundle, parses the two plaintext keys, and emits at most `room`
 * jobs: snapshot refreshes for stale handles first (cheapest, most useful),
 * then comment walks for the OWN handles whose standing has aged past its
 * cadence. Rival comment walks are deliberately absent in v1: the office's
 * own audience is the product's core reading, and a smaller, boring work
 * list is the one that keeps sessions alive.
 */
export async function deriveJobs(
  deskId: string,
  policy: CollectorPolicy,
  room: number,
): Promise<{ jobs: CollectorJob[]; note: string | null }> {
  if (room <= 0) return { jobs: [], note: 'daily cap reached' }
  const bundle = await readDeskBundle(deskId)
  if (!bundle.ok) return { jobs: [], note: bundle.note }
  return jobsFromKeys(bundle.value.keys, policy, room)
}

/**
 * The pure core: two plaintext desk keys plus a policy in, a work list out.
 *
 * Split from `deriveJobs` so the derivation can be tested without Firestore,
 * which is where the interesting decisions live (staleness, the own-only
 * comment rule, the room cap) and where a bug would quietly hand a collector
 * the wrong walks.
 */
export function jobsFromKeys(
  keys: Record<string, string>,
  policy: CollectorPolicy,
  room: number,
): { jobs: CollectorJob[]; note: string | null } {
  if (room <= 0) return { jobs: [], note: 'daily cap reached' }
  let handles: TrackedishHandle[] = []
  let standingAge = new Map<string, number>()
  try {
    const rawHandles = keys['signal.handles.v1']
    if (rawHandles) {
      const parsed: unknown = JSON.parse(rawHandles)
      if (Array.isArray(parsed)) handles = parsed as TrackedishHandle[]
    }
    const rawStanding = keys['signal.standing.v1']
    if (rawStanding) {
      const parsed = JSON.parse(rawStanding) as Record<string, { readAt?: string }>
      standingAge = new Map(
        Object.entries(parsed).map(([id, s]) => [id, hoursAgo(s?.readAt ?? null)]),
      )
    }
  } catch {
    return { jobs: [], note: 'the desk store could not be parsed' }
  }
  if (handles.length === 0) {
    return { jobs: [], note: 'the desk tracks no accounts yet; open the app and add them' }
  }

  const day = istDay()
  const jobs: CollectorJob[] = []

  // Stale snapshots first, oldest first.
  const stale = handles
    .map((h) => ({ h, age: hoursAgo(h.snapshots?.[h.snapshots.length - 1]?.takenAt ?? null) }))
    .filter((x) => x.age > policy.snapshotCadenceHours)
    .sort((a, b) => b.age - a.age)
  for (const { h } of stale) {
    if (jobs.length >= room) break
    jobs.push({
      id: `${day}:posts:${h.id}`,
      kind: 'posts',
      platform: h.platform,
      handle: h.handle,
      url: null,
      handleId: h.id,
      limit: 25,
      why: 'snapshot older than cadence',
    })
  }

  // Then comment walks over the desk's own accounts' newest posts.
  for (const h of handles.filter((x) => x.own === true)) {
    if (jobs.length >= room) break
    const age = standingAge.get(h.id) ?? Number.POSITIVE_INFINITY
    if (age <= policy.standingCadenceHours) continue
    const latest = h.snapshots?.[h.snapshots.length - 1]
    const posts = (latest?.posts ?? []).slice(0, policy.commentPostsPerHandle)
    for (const p of posts) {
      if (jobs.length >= room) break
      if (!p.url) continue
      jobs.push({
        id: `${day}:comments:${h.id}:${p.url}`,
        kind: 'comments',
        platform: h.platform,
        handle: null,
        url: p.url,
        handleId: h.id,
        limit: 100,
        why: 'standing older than cadence',
      })
    }
  }

  return { jobs, note: jobs.length === 0 ? 'nothing is stale; nothing to do' : null }
}

/* ── the daily ledger ───────────────────────────────────────────────────── */

/**
 * Walks done today, held server-side so the cap survives collector restarts.
 *
 * The count lives on the policy doc under a per-day field; yesterday's field
 * is simply never read again. FieldValue.increment keeps two racing reports
 * honest without a transaction.
 */
export async function countToday(deskId: string): Promise<number> {
  const store = db()
  if (!store) return 0
  try {
    const doc = await store.collection(POLICIES).doc(deskId).get()
    const v = (doc.data() ?? {})[`walked:${istDay()}`]
    return typeof v === 'number' ? v : 0
  } catch {
    return 0
  }
}

export async function recordWalks(deskId: string, n: number): Promise<void> {
  const store = db()
  if (!store || n <= 0) return
  try {
    await store
      .collection(POLICIES)
      .doc(deskId)
      .set({ [`walked:${istDay()}`]: FieldValue.increment(n) }, { merge: true })
  } catch {
    /* a lost count loosens the cap by one poll; the collector's own local
       count still holds, and the next successful report catches up */
  }
}

/* ── inbox ──────────────────────────────────────────────────────────────── */

export interface InboxEntry {
  /** Doc id, which IS the idempotency key: redelivery overwrites itself. */
  id: string
  kind: 'snapshot' | 'comments' | 'walk-failed'
  handleId: string
  platform: string
  /** For comments entries, the post the comments belong to. */
  url: string | null
  /** The reading, in the scraper's own wire shapes, untranslated. */
  payload: unknown
  readAt: string
  collector: string
}

const MAX_ENTRY_BYTES = 400_000
const MAX_LIST = 200

/** Store entries. The doc id is the caller's idempotency key. */
export async function pushInbox(
  deskId: string,
  entries: InboxEntry[],
): Promise<{ stored: number; dropped: number }> {
  const store = db()
  if (!store) return { stored: 0, dropped: entries.length }
  const col = store.collection(INBOX).doc(deskId).collection(ENTRIES)
  let stored = 0
  let dropped = 0
  for (const e of entries.slice(0, 40)) {
    const body = JSON.stringify(e)
    if (Buffer.byteLength(body) > MAX_ENTRY_BYTES || !e.id || typeof e.id !== 'string') {
      dropped += 1
      continue
    }
    try {
      await col.doc(encodeURIComponent(e.id).slice(0, 900)).set({
        kind: e.kind,
        handleId: e.handleId,
        platform: e.platform,
        url: e.url ?? null,
        payload: e.payload ?? null,
        readAt: e.readAt,
        collector: String(e.collector ?? '').slice(0, 60),
        storedAt: new Date().toISOString(),
      })
      stored += 1
    } catch {
      dropped += 1
    }
  }
  return { stored, dropped }
}

/** The oldest waiting entries, for the app to drain. */
export async function listInbox(deskId: string): Promise<InboxEntry[]> {
  const store = db()
  if (!store) return []
  try {
    const snap = await store
      .collection(INBOX)
      .doc(deskId)
      .collection(ENTRIES)
      .orderBy('storedAt')
      .limit(MAX_LIST)
      .get()
    return snap.docs.map((d) => {
      const v = d.data()
      return {
        id: decodeURIComponent(d.id),
        kind: v['kind'] as InboxEntry['kind'],
        handleId: String(v['handleId'] ?? ''),
        platform: String(v['platform'] ?? ''),
        url: typeof v['url'] === 'string' ? v['url'] : null,
        payload: v['payload'],
        readAt: String(v['readAt'] ?? ''),
        collector: String(v['collector'] ?? ''),
      }
    })
  } catch {
    return []
  }
}

/** Remove drained entries. Only ever called for ids the app has merged. */
export async function ackInbox(deskId: string, ids: string[]): Promise<number> {
  const store = db()
  if (!store) return 0
  const col = store.collection(INBOX).doc(deskId).collection(ENTRIES)
  let gone = 0
  for (const id of ids.slice(0, MAX_LIST)) {
    try {
      await col.doc(encodeURIComponent(String(id)).slice(0, 900)).delete()
      gone += 1
    } catch {
      /* an unacked entry is redelivered and deduped by its id; losing an ack
         costs a retry, never data */
    }
  }
  return gone
}
