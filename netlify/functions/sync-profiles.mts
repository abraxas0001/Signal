import type { Config, Context } from '@netlify/functions'
import type { Platform } from '../../shared/taxonomy'
import { PLATFORMS } from '../../shared/taxonomy'
import { db, firestoreConfigured } from './lib/firebase'
import {
  batchTrackCompetitors,
  getFollowerHistory,
  getTrackedProfiles,
  registerProfiles,
  type Category,
  type CompetitorProfile,
} from './lib/competitor-tracker'

/**
 * The sync the dashboard drives.
 *
 *   GET  /api/sync-profiles?category=self|competitor|influencer
 *        What is tracked and how fresh it is. Cheap, read-only.
 *   POST /api/sync-profiles
 *        Run ONE budgeted pass over the tracked accounts and report what is left.
 *
 * ONE PASS, NOT THE WHOLE SYNC. This is the part the original design got wrong,
 * and it could not have worked: Netlify kills a synchronous function at its
 * configured timeout, 60 seconds at the very most, while a sync across twenty
 * accounts — Instagram alone costing a minute each — needs several minutes of
 * deliberate waiting. A single request that promised to do all of it would be
 * killed mid-way every time, and the connection would drop with no error the
 * client could read.
 *
 * So a pass takes a wall-clock budget, stops cleanly, and returns `done` plus
 * the number of accounts it did not reach. The client calls again until `done`
 * is true. Each account is committed before the next is started, so an
 * interrupted pass loses nothing but the time it had left.
 */

export const config: Config = {
  path: '/api/sync-profiles',
  method: ['GET', 'POST', 'OPTIONS'],
}

/**
 * How long a pass may run.
 *
 * The function's own timeout is 60s (netlify.toml). Stopping at 45 leaves room
 * for the accounts already read to be written and the response to be built —
 * a pass that spends its last second starting an Instagram read is a pass that
 * gets killed holding data it never stored.
 */
const PASS_BUDGET_MS = 45_000

const isPlatform = (v: unknown): v is Platform =>
  typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v)

const CATEGORIES: Category[] = ['self', 'competitor', 'influencer']
const isCategory = (v: unknown): v is Category =>
  typeof v === 'string' && (CATEGORIES as string[]).includes(v)

function noFirebase(): Response {
  return Response.json(
    {
      ok: false,
      configured: false,
      profiles: [],
      error:
        'This deploy has no Firebase credentials, so there is nowhere to store a sync. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY. Live reads keep working without it.',
    },
    { status: 503 },
  )
}

/* ── GET: what is tracked, and how old it is ─────────────────────────────── */

interface ProfileState {
  id: string
  platform: Platform
  handle: string
  name: string
  category: Category
  followers: number | null
  displayName: string | null
  avatarUrl: string | null
  lastTrackedAt: string | null
  /** Why the last sync found no posts, when it found none. Shown verbatim. */
  listingNote: string | null
  postCount: number
  /** Change in followers since the oldest reading inside the window. */
  followerDelta: number | null
}

async function handleGet(req: Request): Promise<Response> {
  if (!firestoreConfigured()) return noFirebase()

  const url = new URL(req.url)
  const rawCategory = url.searchParams.get('category')
  const category = isCategory(rawCategory) ? rawCategory : undefined

  const store = db()
  if (!store) return noFirebase()

  const profiles = await getTrackedProfiles(category)

  /**
   * Counted with an aggregate rather than by reading every post.
   *
   * `.count()` is billed as one document read regardless of how many rows it
   * covers; fetching the posts to call `.length` on them is billed per row and
   * transfers a payload this endpoint then throws away. On twenty accounts with
   * fifteen posts each that is 300 reads a page load, for a number.
   */
  const states = await Promise.all(
    profiles.map(async (profile): Promise<ProfileState> => {
      const [countSnap, history] = await Promise.all([
        store.collection('competitors').doc(profile.id).collection('posts').count().get(),
        getFollowerHistory(profile.id, 30),
      ])

      const first = history[0]
      const last = history[history.length - 1]
      // Two readings on different days, or nothing. One reading is a number,
      // not a trend, and rendering it as "+0" would claim a flat fortnight
      // that was never measured.
      const followerDelta =
        history.length >= 2 && first && last && first.date !== last.date
          ? last.followers - first.followers
          : null

      return {
        id: profile.id,
        platform: profile.platform,
        handle: profile.handle,
        name: profile.name,
        category: profile.category,
        followers: profile.followers ?? null,
        displayName: profile.displayName ?? null,
        avatarUrl: profile.avatarUrl ?? null,
        lastTrackedAt: profile.lastTrackedAt ?? null,
        listingNote: profile.listingNote ?? null,
        postCount: countSnap.data().count,
        followerDelta,
      }
    }),
  )

  return Response.json({
    ok: true,
    configured: true,
    profiles: states,
    fetchedAt: new Date().toISOString(),
  })
}

/* ── POST: one budgeted pass ─────────────────────────────────────────────── */

interface SyncRequest {
  /**
   * The accounts to sync, from the caller's own list.
   *
   * Optional. Omitting it syncs whatever is already registered, which is what a
   * scheduled run does; supplying it registers the list first, which is what
   * the dashboard does so the server's idea of the tracked accounts cannot
   * drift from the device's.
   */
  handles?: Array<{
    platform?: unknown
    handle?: unknown
    name?: unknown
    profileUrl?: unknown
    own?: unknown
    category?: unknown
  }>
  category?: unknown
  budgetMs?: unknown
}

async function handlePost(req: Request): Promise<Response> {
  if (!firestoreConfigured()) return noFirebase()

  let body: SyncRequest = {}
  try {
    body = (await req.json()) as SyncRequest
  } catch {
    // An empty body is a valid request: sync everything already registered.
  }

  if (Array.isArray(body.handles) && body.handles.length > 0) {
    const entries = body.handles
      .filter((h): h is Record<string, unknown> => typeof h === 'object' && h !== null)
      .filter((h) => isPlatform(h['platform']) && typeof h['handle'] === 'string')
      .map((h) => ({
        platform: h['platform'] as Platform,
        handle: h['handle'] as string,
        name: typeof h['name'] === 'string' ? h['name'] : null,
        profileUrl: typeof h['profileUrl'] === 'string' ? h['profileUrl'] : null,
        // The dashboard models this as `own: boolean`; the tracker models it as
        // a three-way category. Translate here rather than making either side
        // learn the other's vocabulary.
        category: isCategory(h['category'])
          ? h['category']
          : h['own'] === true
            ? ('self' as const)
            : ('competitor' as const),
      }))

    if (entries.length === 0) {
      return Response.json(
        { ok: false, error: 'No usable handles in the request: each needs a known platform and a handle.' },
        { status: 400 },
      )
    }

    await registerProfiles(entries)
  }

  const category = isCategory(body.category) ? body.category : undefined
  const profiles = await getTrackedProfiles(category)

  if (profiles.length === 0) {
    return Response.json({
      ok: true,
      done: true,
      message:
        'Nothing is registered for syncing yet. Add accounts on the dashboard, then sync — the dashboard sends its list with the request.',
      results: [],
      remaining: 0,
    })
  }

  const budgetMs =
    typeof body.budgetMs === 'number' && body.budgetMs > 1_000 && body.budgetMs <= PASS_BUDGET_MS
      ? body.budgetMs
      : PASS_BUDGET_MS

  const progress = await batchTrackCompetitors(profiles, { budgetMs })

  return Response.json({
    ok: true,
    done: progress.done,
    remaining: progress.remaining.length,
    remainingHandles: progress.remaining.map((p: CompetitorProfile) => `${p.platform}:${p.handle}`),
    results: progress.results.map((r) => ({
      id: r.profile.id,
      platform: r.profile.platform,
      handle: r.profile.handle,
      posts: r.posts.length,
      followers: r.followers,
      durationMs: r.durationMs,
      // Both are optional and mean different things: `skipped` is a platform
      // behaving as expected, `error` is us failing. Collapsing them into one
      // field is how a gated account starts reading as a broken one.
      ...(r.skipped ? { skipped: r.skipped } : {}),
      ...(r.error ? { error: r.error } : {}),
    })),
    fetchedAt: new Date().toISOString(),
  })
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })

  try {
    if (req.method === 'GET') return await handleGet(req)
    if (req.method === 'POST') return await handlePost(req)
    return Response.json({ error: 'Use GET or POST.' }, { status: 405 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.log(`[signal] sync-profiles failed: ${message}`)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
