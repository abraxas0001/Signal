import type { Config, Context } from '@netlify/functions'
import { PLATFORMS, type Platform } from '../../shared/taxonomy'
import type { Category } from './lib/competitor-tracker'
import {
  createUnifiedComparison,
  getQuickComparison,
  MAX_ACCOUNTS,
  MAX_LIVE_ACCOUNTS,
} from './lib/unified-comparison'

/**
 * Every tracked account, side by side, across every platform.
 *
 *   GET /api/comparison-all-platforms
 *   GET /api/comparison-all-platforms?category=competitor
 *   GET /api/comparison-all-platforms?profiles=youtube_someone,facebook_someone
 *   GET /api/comparison-all-platforms?live=1
 *   GET /api/comparison-all-platforms?quick=1
 *
 * With no parameters it compares every enabled account the office tracks, from
 * what the batch sync stored. That is the cheap path and the default one: it
 * touches Firestore and nothing else, so it cannot be blocked by a platform
 * and cannot be slow because Instagram is having a day.
 *
 * `live=1` reads each account through `readHandle` instead. It is the same
 * code path the dashboard uses, so it costs one or more upstream requests per
 * account, and for the gated four it will mostly fall back to the stored copy
 * anyway — which the response says, per row, in `route`.
 *
 * `profiles` takes Firestore document ids, the ones `profileDocId` produces:
 * lower case, non-alphanumerics collapsed to underscores, platform first —
 * `twitter_x_someone`, not `Twitter/X_@someone`. Ids that match nothing are
 * named in `missing` rather than silently dropped, because a comparison that
 * quietly comes back one account short is worse than one that says so.
 *
 * NO FIREBASE IS NOT AN ERROR. A deploy with no credentials has stored
 * nothing, so this returns 200 with an empty comparison and `storage.configured`
 * false. Returning 500 there sent operators hunting for a broken function when
 * the answer was three environment variables.
 *
 * THE CAP IS NOT ENFORCED HERE. Rejecting an over-long `profiles` list is a
 * courtesy — the real bound is inside `createUnifiedComparison`, because the
 * default path names no profiles at all and would otherwise fan out over
 * however many accounts the office happens to track. Accounts that did not fit
 * come back in `omitted`.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Stored figures change only when a sync runs, but the ages in the
      // response are computed against the clock, so a cached copy would show a
      // staleness that stops advancing. No store.
      'cache-control': 'no-store',
    },
  })

const CATEGORIES: readonly Category[] = ['competitor', 'self', 'influencer']

const isPlatform = (value: string): value is Platform =>
  (PLATFORMS as readonly string[]).includes(value)

const isCategory = (value: string): value is Category =>
  (CATEGORIES as readonly string[]).includes(value)

const positiveInt = (raw: string | null): number | undefined => {
  if (!raw) return undefined
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return json({ error: 'Send a GET.' }, 405)

  const params = new URL(req.url).searchParams
  const started = Date.now()

  /* ── the cheap per-platform tally ────────────────────────────────────── */

  if (params.get('quick') === '1' || params.get('quick') === 'true') {
    const asked = (params.get('platforms') ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    const unknown = asked.filter((p) => !isPlatform(p))
    if (unknown.length > 0) {
      return json({ error: `Not platforms this product knows: ${unknown.join(', ')}.` }, 400)
    }

    const quick = await getQuickComparison(asked.length > 0 ? asked.filter(isPlatform) : undefined)
    return json({ ...quick, ms: Date.now() - started })
  }

  /* ── the full comparison ─────────────────────────────────────────────── */

  const live = params.get('live') === '1' || params.get('live') === 'true'

  const profileIds = (params.get('profiles') ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)

  if (profileIds.length > MAX_ACCOUNTS) {
    return json({ error: `Up to ${MAX_ACCOUNTS} profiles at a time.` }, 400)
  }
  // A live read is upstream requests, not a Firestore query, and the gated
  // platforms are slow enough that eight of them already fill the window.
  // Asking for more is refused rather than truncated, because a caller that
  // named its profiles wants those profiles, not the first eight of them.
  if (live && profileIds.length > MAX_LIVE_ACCOUNTS) {
    return json(
      { error: `Up to ${MAX_LIVE_ACCOUNTS} profiles at a time when live=1. Drop live, or ask for fewer.` },
      400,
    )
  }

  const categoryParam = params.get('category')
  if (categoryParam !== null && !isCategory(categoryParam)) {
    return json({ error: `category must be one of: ${CATEGORIES.join(', ')}.` }, 400)
  }

  const postsPerProfile = positiveInt(params.get('posts'))
  const historyDays = positiveInt(params.get('days'))

  try {
    const comparison = await createUnifiedComparison({
      ...(profileIds.length > 0 ? { profileIds } : {}),
      ...(categoryParam !== null && isCategory(categoryParam) ? { category: categoryParam } : {}),
      live,
      ...(postsPerProfile !== undefined ? { postsPerProfile } : {}),
      ...(historyDays !== undefined ? { historyDays } : {}),
    })

    // Named, not dropped. A typo in one id otherwise reads as an account that
    // has gone quiet, which is the one misreading this whole module is built
    // to avoid.
    const returned = new Set(comparison.accounts.map((a) => a.profile.id))
    const missing = profileIds.filter((id) => !returned.has(id))

    return json({ ...comparison, missing, live, ms: Date.now() - started })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The comparison could not be built.'
    return json({ error: message, ms: Date.now() - started }, 500)
  }
}

export const config: Config = {
  path: '/api/comparison-all-platforms',
  // The stored path is a handful of Firestore reads, but live=1 is up to eight
  // readHandle calls at once and readHandle alone is budgeted at 30s.
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip'] },
}
