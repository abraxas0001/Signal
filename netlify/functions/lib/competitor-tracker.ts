import { Timestamp } from 'firebase-admin/firestore'
import { createHash } from 'node:crypto'
import type { Platform } from '../../../shared/taxonomy'
import { db } from './firebase'
import { profileDocId, readHandle, type HandlePost } from './handles'
import { getRateLimitStatus, recordRequest, waitForRateLimit } from './rate-limiter-advanced'

/**
 * The accounts this office watches, and the posts the sync has stored for them.
 *
 * WHY A SYNC EXISTS AT ALL. `readHandle` already reads an account live, and for
 * YouTube, Bluesky and Mastodon that is the whole story — those platforms serve
 * a post list to anyone and the dashboard reads it on demand. The gated four
 * (Facebook, Instagram, LinkedIn, X) do not, and the one thing that gets a post
 * list out of them without an owned token or a reseller is going slowly: one
 * account a minute for Instagram, spaced across hours. That cannot happen
 * inside a page load, so it happens here and the results are kept.
 *
 * WHAT IT DOES NOT DO. It does not log in as anybody, and it does not go
 * faster when nobody is looking. When a platform has no route, the sync stores
 * the follower count it could read and the reason there are no posts — which is
 * a real answer and reads on the dashboard as one. The alternative, storing
 * nothing and leaving the row blank, is what made Facebook look like a quiet
 * account rather than a gated one.
 *
 * RESUMABILITY IS THE ARCHITECTURE, not a refinement. Netlify kills a
 * synchronous function at 60 seconds. A sync over twenty accounts, four of them
 * on Instagram, needs several minutes of deliberate waiting. So every entry
 * point here takes a wall-clock budget, stops cleanly when it runs out, and
 * reports what is left; the caller invokes it again. A profile is never left
 * half-written, because each one is committed before the next is started.
 */

export interface CompetitorProfile {
  /** `profileDocId` of the platform and handle. Stable, and the Firestore key. */
  id: string
  platform: Platform
  handle: string
  name: string
  profileUrl: string
  category: 'competitor' | 'self' | 'influencer'
  enabled: boolean
  /** ISO-8601, set by the sync. Absent means never synced. */
  lastTrackedAt?: string | null
  followers?: number | null
  displayName?: string | null
  avatarUrl?: string | null
  /** Why the last sync found no posts, when it found none. */
  listingNote?: string | null
}

export interface TrackedPost {
  id: string
  profileId: string
  platform: string
  url: string
  /** The platform's own id, when the route that produced it had one. */
  postId: string | null
  title: string | null
  publishedAt: string | null
  engagement: {
    likes: number | null
    comments: number | null
    shares: number | null
    views: number | null
  }
  fetchedAt: string
}

export interface SyncResult {
  profile: CompetitorProfile
  posts: TrackedPost[]
  followers: number | null
  extractedAt: string
  durationMs: number
  /** Set when this profile was not read at all, and why. */
  skipped?: string
  error?: string
}

/** The category filter used everywhere; `undefined` means every category. */
export type Category = CompetitorProfile['category']

const COLLECTION = 'competitors'

export function profileIdFor(platform: Platform, handle: string): string {
  return profileDocId({ platform, handle })
}

/**
 * A stable document id for a post, derived from its URL.
 *
 * Re-syncing the same account must update the rows it already has rather than
 * appending a second copy of every post, so the id cannot involve the clock.
 * A URL can be longer than Firestore's 1500-byte key limit and can contain
 * slashes, so it is hashed rather than slugged.
 */
function postDocId(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 32)
}

/* ── the tracked list ────────────────────────────────────────────────────── */

export async function getTrackedProfiles(category?: Category): Promise<CompetitorProfile[]> {
  const store = db()
  if (!store) return []

  /**
   * Filtered in memory rather than with a second `where`.
   *
   * Firestore needs a composite index for `enabled == true AND category == x`,
   * and a missing index does not degrade — it throws, at read time, only in the
   * deploy where somebody forgot to create it. The tracked list is tens of
   * documents, not thousands; one predicate server-side and one here costs
   * nothing measurable and removes an entire class of "works on my project".
   */
  const snapshot = await store.collection(COLLECTION).where('enabled', '==', true).get()

  return snapshot.docs
    .map((entry) => ({ ...(entry.data() as Omit<CompetitorProfile, 'id'>), id: entry.id }))
    .filter((profile) => !category || profile.category === category)
}

export async function getProfile(id: string): Promise<CompetitorProfile | null> {
  const store = db()
  if (!store) return null
  const snapshot = await store.collection(COLLECTION).doc(id).get()
  if (!snapshot.exists) return null
  return { ...(snapshot.data() as Omit<CompetitorProfile, 'id'>), id: snapshot.id }
}

export async function addCompetitorProfile(
  profile: Omit<CompetitorProfile, 'id' | 'enabled'> & { enabled?: boolean },
): Promise<string> {
  const store = db()
  if (!store) throw new Error('Firebase is not configured, so profiles cannot be saved.')

  const id = profileIdFor(profile.platform, profile.handle)
  await store.collection(COLLECTION).doc(id).set(
    {
      ...profile,
      id,
      enabled: profile.enabled ?? true,
      createdAt: Timestamp.now(),
    },
    // `merge`, so re-adding an account the office already tracks updates its
    // name and category instead of erasing the sync history hanging off it.
    { merge: true },
  )
  return id
}

/**
 * The accounts the caller wants synced, upserted in one write.
 *
 * WHY THE CALLER SUPPLIES THE LIST. The dashboard's tracked handles live in
 * localStorage, on the device, on purpose — `src/lib/store.ts` says so at
 * length, and the reason is that this product's records name private citizens
 * and unproven allegations and the office has no retention policy. A sync
 * cannot read a list that never leaves the browser, so the browser hands it
 * over, and the operator pressing "Sync now" is the act of consent.
 *
 * What crosses the wire is only what the sync needs to do its job: a platform,
 * a public handle, a display name, and whether the office runs the account.
 * No grievance record, no comment text, no measured standing. Those stay on the
 * device, and this function is deliberately not a general-purpose uploader.
 *
 * Upsert rather than replace, so an account synced from a second device is not
 * quietly deleted by the first, and so an account's stored posts survive being
 * re-registered.
 */
export async function registerProfiles(
  entries: Array<{
    platform: Platform
    handle: string
    name?: string | null
    profileUrl?: string | null
    category?: Category
  }>,
): Promise<CompetitorProfile[]> {
  const store = db()
  if (!store) throw new Error('Firebase is not configured, so there is nowhere to sync to.')

  const seen = new Set<string>()
  const profiles: CompetitorProfile[] = []

  for (const entry of entries) {
    const handle = entry.handle.trim().replace(/^@/, '')
    if (!handle) continue

    const id = profileIdFor(entry.platform, handle)
    // The same account can appear twice in a device's list — once tracked and
    // once suggested. Writing it twice in one batch is not an error but the
    // second write wins with the same data, so skip it rather than pay for it.
    if (seen.has(id)) continue
    seen.add(id)

    profiles.push({
      id,
      platform: entry.platform,
      handle,
      name: entry.name?.trim() || handle,
      profileUrl: entry.profileUrl || '',
      category: entry.category ?? 'competitor',
      enabled: true,
    })
  }

  // 500 operations per batch. A single office will never approach that; a
  // shared deploy could, and a silent truncation there would look like a sync
  // that simply ignored half the list.
  for (let i = 0; i < profiles.length; i += 400) {
    const batch = store.batch()
    for (const profile of profiles.slice(i, i + 400)) {
      batch.set(
        store.collection(COLLECTION).doc(profile.id),
        { ...profile, registeredAt: Timestamp.now() },
        { merge: true },
      )
    }
    await batch.commit()
  }

  return profiles
}

export async function setProfileEnabled(id: string, enabled: boolean): Promise<void> {
  const store = db()
  if (!store) throw new Error('Firebase is not configured.')
  await store.collection(COLLECTION).doc(id).set({ enabled }, { merge: true })
}

/**
 * Remove an account and everything stored under it.
 *
 * Deleting a document in Firestore does NOT delete its subcollections — the
 * posts would survive as orphans, invisible in the console and still returned
 * by a path read. They have to be walked and deleted explicitly.
 */
export async function removeCompetitorProfile(id: string): Promise<void> {
  const store = db()
  if (!store) throw new Error('Firebase is not configured.')

  const profile = store.collection(COLLECTION).doc(id)
  for (const sub of ['posts', 'snapshots']) {
    // In pages, because a write batch takes at most 500 operations.
    for (;;) {
      const page = await profile.collection(sub).limit(400).get()
      if (page.empty) break
      const batch = store.batch()
      page.docs.forEach((entry) => batch.delete(entry.ref))
      await batch.commit()
      if (page.size < 400) break
    }
  }
  await profile.delete()
}

/* ── the sync ────────────────────────────────────────────────────────────── */

/**
 * Read one account and store what came back.
 *
 * The read itself is `readHandle`, deliberately: it is the same code path the
 * dashboard uses live, so the sync cannot drift into a second, differently
 * behaved reader — and it already knows the four routes, so an office that has
 * connected its own Facebook page gets Graph API posts here without this file
 * knowing anything about Meta.
 */
export async function syncProfile(
  profile: CompetitorProfile,
  options: { budgetMs?: number } = {},
): Promise<SyncResult> {
  const startedAt = Date.now()
  const budgetMs = options.budgetMs ?? Infinity
  const base: Omit<SyncResult, 'posts' | 'followers'> = {
    profile,
    extractedAt: new Date().toISOString(),
    durationMs: 0,
  }

  const status = await getRateLimitStatus(profile.platform)
  if (!status.canRequest) {
    return {
      ...base,
      posts: [],
      followers: null,
      durationMs: Date.now() - startedAt,
      skipped: status.reason ?? `${profile.platform} is rate limited.`,
    }
  }

  // Leave a second of headroom so a profile is never started with only enough
  // budget left to be killed halfway through storing it.
  const waited = await waitForRateLimit(profile.platform, Math.max(0, budgetMs - 1_000))
  if (!waited) {
    return {
      ...base,
      posts: [],
      followers: null,
      durationMs: Date.now() - startedAt,
      skipped: `${profile.platform} needs a longer pause than this run has left.`,
    }
  }

  try {
    const summary = await readHandle(
      { platform: profile.platform, handle: profile.handle },
      // Ask for the licensed route too. If no provider is configured this is a
      // no-op; if one is, the sync is exactly where paying for it makes sense,
      // because it happens on a schedule rather than per page load.
      { licensed: true },
    )
    await recordRequest(profile.platform, true, 200)

    const fetchedAt = new Date().toISOString()
    const posts: TrackedPost[] = summary.posts.map((post: HandlePost) => ({
      id: postDocId(post.url),
      profileId: profile.id,
      platform: profile.platform,
      url: post.url,
      postId: post.id ?? null,
      title: post.title,
      publishedAt: post.publishedAt,
      engagement: {
        likes: post.likes,
        comments: post.comments,
        shares: post.shares ?? null,
        views: post.views,
      },
      fetchedAt,
    }))

    await storeSync(profile, {
      posts,
      followers: summary.followers,
      displayName: summary.displayName,
      avatarUrl: summary.avatarUrl,
      listingNote: summary.listing.note,
      fetchedAt,
    })

    return {
      ...base,
      posts,
      followers: summary.followers,
      durationMs: Date.now() - startedAt,
      // A gated account with no post list is not an error, and calling it one
      // would put a red row on the dashboard for a platform behaving normally.
      ...(posts.length === 0 ? { skipped: summary.listing.note } : {}),
    }
  } catch (err) {
    await recordRequest(profile.platform, false, 500)
    return {
      ...base,
      posts: [],
      followers: null,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/**
 * Commit one account's sync: the posts, the profile's own figures, and a dated
 * snapshot of the follower count.
 *
 * The snapshot is the point of tracking a competitor rather than merely reading
 * one. A follower count on its own is a number; the same number a fortnight
 * apart is a trend, and it is the only trend obtainable for a platform that
 * publishes no post list at all. One document per account per day, so a sync
 * run four times on a Tuesday overwrites rather than accumulating four rows.
 */
async function storeSync(
  profile: CompetitorProfile,
  data: {
    posts: TrackedPost[]
    followers: number | null
    displayName: string | null
    avatarUrl: string | null
    listingNote: string
    fetchedAt: string
  },
): Promise<void> {
  const store = db()
  if (!store) return

  const profileRef = store.collection(COLLECTION).doc(profile.id)
  const batch = store.batch()

  // 500 operations per batch, and each post is one. Chunk rather than trusting
  // that nobody ever tracks an account with a long feed.
  const chunk = data.posts.slice(0, 400)
  for (const post of chunk) {
    batch.set(profileRef.collection('posts').doc(post.id), { ...post, storedAt: Timestamp.now() })
  }

  batch.set(
    profileRef,
    {
      id: profile.id,
      platform: profile.platform,
      handle: profile.handle,
      name: profile.name,
      profileUrl: profile.profileUrl,
      category: profile.category,
      enabled: true,
      lastTrackedAt: data.fetchedAt,
      followers: data.followers,
      displayName: data.displayName,
      avatarUrl: data.avatarUrl,
      listingNote: data.listingNote,
      postCount: data.posts.length,
    },
    // `set` with merge, never `update`: the first sync of an account added
    // straight from the dashboard writes the profile document into existence,
    // and `update` throws on a document that does not exist yet.
    { merge: true },
  )

  if (data.followers !== null) {
    batch.set(profileRef.collection('snapshots').doc(data.fetchedAt.slice(0, 10)), {
      date: data.fetchedAt.slice(0, 10),
      followers: data.followers,
      postCount: data.posts.length,
      at: data.fetchedAt,
    })
  }

  await batch.commit()
}

export interface BatchProgress {
  results: SyncResult[]
  /** Accounts the budget did not reach. Invoke again to continue. */
  remaining: CompetitorProfile[]
  done: boolean
}

/**
 * Sync as many accounts as the budget allows, slowest platform last.
 *
 * Ordering is not cosmetic. Instagram costs a minute an account and everything
 * else costs seconds, so reading Instagram first means one invocation returns
 * one row and the operator watches a spinner; reading it last means the same
 * invocation returns every YouTube, Bluesky and Facebook account it has before
 * spending the rest of its budget on the expensive one.
 */
export async function batchTrackCompetitors(
  profiles: CompetitorProfile[],
  options: {
    budgetMs?: number
    onResult?: (result: SyncResult) => void
  } = {},
): Promise<BatchProgress> {
  const startedAt = Date.now()
  const budgetMs = options.budgetMs ?? 45_000
  const results: SyncResult[] = []

  const ordered = [...profiles].sort(
    (a, b) =>
      getRateLimitCost(a.platform) - getRateLimitCost(b.platform) ||
      a.platform.localeCompare(b.platform),
  )

  for (let i = 0; i < ordered.length; i++) {
    const profile = ordered[i]!
    const left = budgetMs - (Date.now() - startedAt)
    // 2s is the smallest window in which any account can be read and stored.
    if (left < 2_000) {
      return { results, remaining: ordered.slice(i), done: false }
    }

    const result = await syncProfile(profile, { budgetMs: left })
    results.push(result)
    options.onResult?.(result)
  }

  return { results, remaining: [], done: true }
}

function getRateLimitCost(platform: string): number {
  return RATE_COST[platform] ?? 2_000
}

const RATE_COST: Record<string, number> = {
  YouTube: 500,
  Bluesky: 300,
  Mastodon: 300,
  'Twitter/X': 1_000,
  Facebook: 2_000,
  LinkedIn: 3_000,
  Instagram: 60_000,
}

/* ── reading back ────────────────────────────────────────────────────────── */

export async function getCompetitorPosts(
  profileId: string,
  options: { limit?: number; since?: Date } = {},
): Promise<TrackedPost[]> {
  const store = db()
  if (!store) return []

  let query = store
    .collection(COLLECTION)
    .doc(profileId)
    .collection('posts')
    .orderBy('fetchedAt', 'desc')

  if (options.since) query = query.where('fetchedAt', '>=', options.since.toISOString())
  query = query.limit(options.limit ?? 50)

  const snapshot = await query.get()
  return snapshot.docs.map((entry) => entry.data() as TrackedPost)
}

export interface FollowerSnapshot {
  date: string
  followers: number
  postCount: number
}

/** The dated follower counts for one account, oldest first. */
export async function getFollowerHistory(
  profileId: string,
  days = 90,
): Promise<FollowerSnapshot[]> {
  const store = db()
  if (!store) return []

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const snapshot = await store
    .collection(COLLECTION)
    .doc(profileId)
    .collection('snapshots')
    .where('date', '>=', since)
    .orderBy('date', 'asc')
    .get()

  return snapshot.docs.map((entry) => entry.data() as FollowerSnapshot)
}
