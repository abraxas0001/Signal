import { Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore'
import type { PostSnapshot } from '../../../shared/types'
import { db } from './firebase'

/**
 * The Instagram fallback cache.
 *
 * Instagram answers a datacentre IP with HTTP 429 after a handful of requests,
 * and once it starts refusing it keeps refusing for hours. Every further
 * request inside that window is both useless and a reason for the refusal to
 * last longer. So this module holds two things: the last snapshot we managed to
 * read, and the decision to stop asking.
 *
 * It is a FALLBACK cache, not a read-through one. While Instagram is answering,
 * a live read always happens first — serving a day-old like count as the answer
 * to "analyse this post" would present a stale measurement as a fresh one, and
 * the whole point of the engagement figures is that they were measured. The
 * stored copy is only reached for when Instagram refuses, and the caller is
 * told, so the report can say which of the two it is showing.
 *
 * The cost of that choice is that we ask Instagram every time and so meet the
 * 429 sooner than a read-through cache would. It is the right trade: a wrong
 * number presented as current is worse than a slow path that admits it is
 * showing you an old one.
 *
 * Firestore is optional across this codebase. With no credentials `db()` is
 * null, the cache is simply absent, and every read goes live.
 */

const COLLECTION = 'instagram_cache'

/** How old a stored snapshot may be and still be worth offering as a fallback. */
const CACHE_TTL_HOURS = 24

/**
 * Backoff after a refusal, doubling per consecutive refusal up to a ceiling.
 *
 * The fixed 12-hour wait this replaced was blunt in both directions: a single
 * 429 from one burst usually clears within the hour, while an IP refused four
 * times running is not going to be admitted twenty minutes later.
 * `blockAttempts` was already being written and never read — this is what it
 * was for.
 */
const FIRST_BACKOFF_HOURS = 1
const MAX_BACKOFF_HOURS = 12

const HOUR_MS = 60 * 60 * 1000

/**
 * The stored document.
 *
 * `handle` carries whatever we were refused for — an account handle for a
 * profile read, a post shortcode for a post read — because that is what the
 * status endpoint lists back to an operator asking what is currently blocked.
 *
 * `data` is a `Partial<PostSnapshot>` rather than a whole one: an adapter
 * returns a partial and the caller merges it over a blank, so storing the
 * partial stores exactly what was read and nothing invented around it.
 */
export interface InstagramCache {
  url: string
  handle: string
  data: Partial<PostSnapshot>
  cachedAt: Timestamp
  expiresAt: Timestamp
  /** Set on the last refusal, cleared by the next successful read. */
  lastBlockedAt?: Timestamp | null
  /** Consecutive refusals. This is what lengthens the backoff. */
  blockAttempts: number
}

/**
 * There is deliberately no `isBlocked` on this. An earlier shape carried one,
 * and in every branch it was exactly `source !== 'fresh'` — but it read as
 * though it meant "Instagram refused us", so the caller used it to tell a
 * reader to wait out a throttle on a post that had simply been deleted. The
 * cache genuinely cannot tell those two apart: it only sees that the live read
 * returned nothing. Whoever wants that distinction has to take it from the
 * adapter's own attempt notes, which is where the HTTP status lives.
 */
export interface InstagramCacheRead {
  data: Partial<PostSnapshot> | null
  /** Where the returned snapshot came from. 'none' means we have nothing. */
  source: 'fresh' | 'cached' | 'none'
  /** When the returned snapshot was written. Null when it came off the wire. */
  cachedAt: Date | null
  /** Earliest we will ask Instagram again. Only set while backing off. */
  nextFetchAt?: Date
}

/**
 * Firestore document ids may not contain '/', may not be '.' or '..', and may
 * not be wrapped in double underscores. The natural key for a post is its
 * shortcode and for an account its handle, and both are flattened to a safe
 * alphabet so neither can produce a nested path. The reserved-name guard is not
 * theoretical: `__name__` is a legal Instagram handle.
 *
 * Case is preserved, deliberately. A shortcode is case-sensitive — `/p/CyAbC/`
 * and `/p/cyabc/` are different posts — so folding it would let two posts share
 * one document and one post's stored like count be served as the other's,
 * presented as a measured figure. Two spellings of the same handle costing two
 * documents is by far the cheaper mistake.
 */
function docId(key: string): string {
  const slug = key
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(0, 180)
  if (!slug || /^\.\.?$/.test(slug)) return 'unknown'
  return /^__.*__$/.test(slug) ? `k_${slug}` : slug
}

interface StoredEntry {
  data: Partial<PostSnapshot> | null
  cachedAt: number | null
  expiresAt: number | null
  lastBlockedAt: number | null
  blockAttempts: number
}

/**
 * Read the document without trusting its shape.
 *
 * An earlier version of this file wrote a different shape into this same
 * collection, so a document here can still hand us a `cachedAt` with no
 * `toMillis` on it. The timestamps are therefore checked rather than cast,
 * because they are the fields that throw. `data` is only checked as far as
 * "an object, and not an array" — validating a whole snapshot field by field
 * would not pay for itself when `assemble` already merges it key by key over a
 * blank, so a missing field there goes missing rather than throwing. The point
 * is that a malformed document degrades to "we have no cache" instead of
 * failing an extraction that was otherwise going to succeed.
 */
function readEntry(snap: DocumentSnapshot): StoredEntry | null {
  const raw = snap.data()
  if (!raw) return null

  const data = raw['data']
  const cachedAt = raw['cachedAt']
  const expiresAt = raw['expiresAt']
  const lastBlockedAt = raw['lastBlockedAt']
  const blockAttempts = raw['blockAttempts']

  return {
    data:
      data !== null && typeof data === 'object' && !Array.isArray(data)
        ? (data as Partial<PostSnapshot>)
        : null,
    cachedAt: cachedAt instanceof Timestamp ? cachedAt.toMillis() : null,
    expiresAt: expiresAt instanceof Timestamp ? expiresAt.toMillis() : null,
    lastBlockedAt: lastBlockedAt instanceof Timestamp ? lastBlockedAt.toMillis() : null,
    blockAttempts: typeof blockAttempts === 'number' ? blockAttempts : 0,
  }
}

function backoffMs(attempts: number): number {
  const doublings = Math.max(0, Math.min(attempts, 8) - 1)
  return Math.min(FIRST_BACKOFF_HOURS * 2 ** doublings, MAX_BACKOFF_HOURS) * HOUR_MS
}

/** When the current backoff window ends, or null when we are not backing off. */
function backoffUntil(entry: StoredEntry | null): Date | null {
  if (!entry?.lastBlockedAt) return null
  return new Date(entry.lastBlockedAt + backoffMs(entry.blockAttempts || 1))
}

/** A stored snapshot is only worth offering while it is inside its TTL. */
function servable(
  entry: StoredEntry | null,
): { data: Partial<PostSnapshot>; cachedAt: Date } | null {
  if (!entry?.data || entry.expiresAt == null || entry.cachedAt == null) return null
  if (entry.expiresAt <= Date.now()) return null
  return { data: entry.data, cachedAt: new Date(entry.cachedAt) }
}

/**
 * Run a live Instagram read with the stored copy behind it.
 *
 * `fetchFresh` returns null to mean "Instagram would not give me this". That is
 * the signal which starts the backoff, so it must not be used for a caller-side
 * error: a thrown exception is left to propagate rather than counted as a
 * refusal that locks the key out for an hour.
 *
 * `key` is what the entry is filed and reported under — a post shortcode or an
 * account handle. `url` is stored beside it so an operator reading the
 * collection can tell what a slugged id refers to.
 */
export async function getInstagramWithCache(
  url: string,
  key: string,
  fetchFresh: () => Promise<Partial<PostSnapshot> | null>,
): Promise<InstagramCacheRead> {
  const store = db()
  if (!store) {
    const data = await fetchFresh()
    return { data, source: data ? 'fresh' : 'none', cachedAt: null }
  }

  const ref = store.collection(COLLECTION).doc(docId(key))

  let entry: StoredEntry | null = null
  try {
    entry = readEntry(await ref.get())
  } catch {
    // A cache we cannot read is not a reason to fail the extraction. It only
    // means this run has no fallback behind it.
  }

  const until = backoffUntil(entry)
  if (until && until.getTime() > Date.now()) {
    const stored = servable(entry)
    return {
      data: stored?.data ?? null,
      source: stored ? 'cached' : 'none',
      cachedAt: stored?.cachedAt ?? null,
      nextFetchAt: until,
    }
  }

  const fresh = await fetchFresh()

  if (fresh) {
    const now = new Date()
    // Typed against the declared shape rather than written as a free object
    // literal: `readEntry` exists because a previous version of this file wrote
    // a document this one could not read, and an untyped write is how that
    // happens again without the compiler noticing.
    const doc: InstagramCache = {
      url,
      handle: key,
      data: fresh,
      cachedAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(new Date(now.getTime() + CACHE_TTL_HOURS * HOUR_MS)),
      blockAttempts: 0,
      lastBlockedAt: null,
    }
    try {
      await ref.set(doc)
    } catch {
      // Failing to store costs the next run its fallback, not this run its result.
    }
    return { data: fresh, source: 'fresh', cachedAt: null }
  }

  const attempts = (entry?.blockAttempts ?? 0) + 1
  const refusal: Partial<InstagramCache> = {
    url,
    handle: key,
    blockAttempts: attempts,
    lastBlockedAt: Timestamp.now(),
  }
  try {
    await ref.set(refusal, { merge: true })
  } catch {
    // As above. Without the write we simply ask again sooner than we should.
  }

  const stored = servable(entry)
  return {
    data: stored?.data ?? null,
    source: stored ? 'cached' : 'none',
    cachedAt: stored?.cachedAt ?? null,
    nextFetchAt: new Date(Date.now() + backoffMs(attempts)),
  }
}

/** Drop one cached entry, or the whole collection. */
export async function clearInstagramCache(handle?: string): Promise<void> {
  const store = db()
  if (!store) return

  if (handle) {
    await store.collection(COLLECTION).doc(docId(handle)).delete()
    return
  }

  const all = await store.collection(COLLECTION).get()
  if (all.empty) return

  // Firestore caps a batch at 500 writes and rejects the commit past it, so a
  // single batch over the whole collection would fail on exactly the large
  // cache someone is trying to clear.
  const CHUNK = 400
  for (let i = 0; i < all.docs.length; i += CHUNK) {
    const batch = store.batch()
    for (const doc of all.docs.slice(i, i + CHUNK)) batch.delete(doc.ref)
    await batch.commit()
  }
}

export async function getInstagramCacheStats(): Promise<{
  totalCached: number
  freshCount: number
  expiredCount: number
  blockedCount: number
}> {
  const store = db()
  if (!store) return { totalCached: 0, freshCount: 0, expiredCount: 0, blockedCount: 0 }

  const caches = await store.collection(COLLECTION).get()
  const now = Date.now()

  let freshCount = 0
  let expiredCount = 0
  let blockedCount = 0

  for (const doc of caches.docs) {
    const entry = readEntry(doc)
    if (!entry) continue

    if (entry.expiresAt != null && entry.expiresAt > now) freshCount++
    else expiredCount++

    const until = backoffUntil(entry)
    if (until && until.getTime() > now) blockedCount++
  }

  return { totalCached: caches.size, freshCount, expiredCount, blockedCount }
}

/**
 * What Instagram is currently refusing, and until when.
 *
 * Only entries still inside their backoff window count. The version this
 * replaced treated any key that had ever been refused as blocked, so the
 * status endpoint reported a permanent outage from the first 429 onwards and
 * never recovered.
 */
export async function getInstagramBlockStatus(): Promise<{
  isBlocked: boolean
  blockedHandles: string[]
  unblockAt?: Date
}> {
  const store = db()
  if (!store) return { isBlocked: false, blockedHandles: [] }

  const caches = await store.collection(COLLECTION).get()
  const now = Date.now()

  const blockedHandles: string[] = []
  let latestUnblock = 0

  for (const doc of caches.docs) {
    const until = backoffUntil(readEntry(doc))
    if (!until || until.getTime() <= now) continue

    const handle = doc.get('handle')
    blockedHandles.push(typeof handle === 'string' ? handle : doc.id)
    latestUnblock = Math.max(latestUnblock, until.getTime())
  }

  if (!blockedHandles.length) return { isBlocked: false, blockedHandles: [] }
  return { isBlocked: true, blockedHandles, unblockAt: new Date(latestUnblock) }
}
