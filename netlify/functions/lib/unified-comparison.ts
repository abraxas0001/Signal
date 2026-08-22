import type { Platform } from '../../../shared/taxonomy'
import { firestoreConfigured } from './firebase'
import {
  getCompetitorPosts,
  getFollowerHistory,
  getProfile,
  getTrackedProfiles,
  type Category,
  type CompetitorProfile,
  type FollowerSnapshot,
  type TrackedPost,
} from './competitor-tracker'
import { readHandle } from './handles'
import type { SourceRoute } from './social-source'

/**
 * The tracked accounts, side by side.
 *
 * WHAT MAKES THIS HARD is not the arithmetic. It is that the rows do not come
 * from the same place. A YouTube channel is enumerable by anyone, so its
 * figures are read live and are seconds old. A Facebook page is not, so its
 * figures are whatever the slow batch sync stored — on Tuesday, or never. Put
 * those two rows in one table with no further marking and the table asserts
 * something false: that the office is looking at a like-for-like comparison.
 * So every row here carries the route that produced it and, when that route is
 * `stored`, how old it is. A screen may choose to grey a stale row; it may not
 * be denied the ability to.
 *
 * THE DENOMINATOR IS THE WHOLE GAME. An engagement rate is interactions over
 * reach, and getting reach wrong does not produce a slightly wrong rate — it
 * produces a confidently wrong one, on every post, in a column the office
 * reads as the answer. `readYouTube` in handles.ts once picked up a sidebar
 * channel's subscriber count and made it the denominator of an entire
 * comparison; nothing on screen looked broken. Hence the rules below: the
 * denominator is stated, it is uniform across the posts it is applied to, and
 * when it is unknown the rate is null rather than nought.
 *
 * NOTHING HERE INVENTS A NUMBER. An average is taken over the posts that
 * actually carried the field and reports how many that was; a missing like
 * count is not a zero. A cadence needs two dated posts and a real span between
 * them. A follower trend needs two dated readings — a single number is a
 * reading, not a trend, and this module will not dress one up as the other.
 */

/* ── the shapes ──────────────────────────────────────────────────────────── */

/** What an engagement rate was measured against. Never guessed, never mixed. */
export type RateBasis = 'views' | 'followers'

/** An average, and the number of posts that actually contributed to it. */
export interface Averaged {
  value: number | null
  /** Posts that carried this field. Zero means the average is null. */
  over: number
}

export interface RatedAverage extends Averaged {
  /**
   * `null` only when `value` is null, or — at platform level — when the
   * contributing accounts did not share a basis and averaging them would have
   * compared a share of viewers with a share of followers.
   */
  basis: RateBasis | null
}

export interface Cadence {
  /** Posts per week over the observed span. Null when the span cannot be measured. */
  value: number | null
  /** Days between the oldest and newest dated post read. */
  spanDays: number | null
  /** Why there is no figure, when there is none. */
  note: string | null
}

export interface FollowerTrend {
  first: FollowerSnapshot
  last: FollowerSnapshot
  /** Last minus first. Negative is a real finding, not an error. */
  delta: number
  spanDays: number
  readings: number
}

export interface TopPost {
  url: string
  title: string | null
  publishedAt: string | null
  interactions: number
}

export interface AccountComparison {
  profile: CompetitorProfile
  /**
   * How the post list was obtained, or `none` when no route produced one.
   *
   * It describes the posts. The follower count on a `stored` or `none` row is
   * whatever the last sync wrote to the profile record, so `ageHours` is set on
   * both: a row that could read nothing today still shows a number, and that
   * number has an age.
   */
  route: SourceRoute
  lastSyncedAt: string | null
  /**
   * Whole hours since the sync these figures came from. Null on a live route —
   * a read happening now has no age, and stamping it with the clock would make
   * every row look equally fresh.
   */
  ageHours: number | null
  /** Why there are no posts, when there are none. Shown to the reader verbatim. */
  note: string | null
  followers: number | null
  followerTrend: FollowerTrend | null
  postsRead: number
  /**
   * Likes, comments and shares summed over every post that carried any of
   * them. Null when no post did — which is not the same as nought, and the
   * distinction is the difference between "nobody engaged" and "we could not
   * see whether anybody engaged".
   */
  interactions: number | null
  avgLikes: Averaged
  avgComments: Averaged
  avgShares: Averaged
  avgViews: Averaged
  /** Interactions per post as a percentage of the basis. */
  engagementRate: RatedAverage
  cadence: Cadence
  topPost: TopPost | null
}

export interface PlatformComparison {
  platform: Platform
  accounts: number
  /** Accounts that returned at least one post. */
  accountsWithPosts: number
  postsRead: number
  avgLikes: Averaged
  avgComments: Averaged
  engagementRate: RatedAverage
  /** Every route that contributed, deduplicated. Mixed routes mean mixed ages. */
  routes: SourceRoute[]
  /** Set when no account on this platform yielded a post list, saying why. */
  note: string | null
}

export interface UnifiedComparison {
  accounts: AccountComparison[]
  platforms: PlatformComparison[]
  totals: {
    accounts: number
    postsRead: number
    /**
     * Known likes, comments and shares summed. Null when no post carried any
     * of the three: posts that could be listed but not measured are not the
     * same as posts nobody engaged with, and a nought here says the second.
     */
    interactions: number | null
  }
  /**
   * Tracked accounts that matched the request but were not read, because it
   * hit the cap. Named rather than dropped — a comparison that comes back
   * short without saying so reads as an office that tracks fewer accounts
   * than it does.
   */
  omitted: Array<{ id: string; platform: Platform; handle: string }>
  /**
   * Whether this deploy can read anything stored at all.
   *
   * Distinguished from "nothing is tracked yet" on purpose: both produce an
   * empty table, and only one of them is fixed by adding accounts.
   */
  storage: { configured: boolean; note: string }
  /** Plain observations the figures support. Not advice, and not padding. */
  notes: string[]
  generatedAt: string
}

export interface ComparisonOptions {
  /** Specific profile document ids. Omitted means every enabled account. */
  profileIds?: string[]
  category?: Category
  /**
   * Read each account live rather than using what the sync stored.
   *
   * Off by default because it is one or more upstream requests per account and
   * the gated platforms will not answer at all. On, it is `readHandle`, which
   * falls back to the stored copy by itself and labels the row accordingly.
   */
  live?: boolean
  /** Posts per account. More posts is a steadier average and a slower read. */
  postsPerProfile?: number
  /** Days of follower history to draw the trend from. */
  historyDays?: number
}

/**
 * How many accounts one comparison will read.
 *
 * The stored path is two Firestore queries per account; the live path is one
 * or more upstream requests per account, and `readHandle` allows itself close
 * to thirty seconds for a single gated one. The cap lives here rather than in
 * the endpoint because the endpoint could only ever bound an explicit list —
 * an office that tracks forty accounts and asks for all of them live would
 * otherwise fan out over all forty and get a killed function and a blank
 * screen instead of a slow answer.
 */
export const MAX_ACCOUNTS = 25
export const MAX_LIVE_ACCOUNTS = 8

/* ── arithmetic that refuses to guess ────────────────────────────────────── */

const round = (n: number, dp: number): number => Number(n.toFixed(dp))

const known = (values: Array<number | null | undefined>): number[] =>
  values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

/**
 * The mean of the values that exist, and how many that was.
 *
 * The count is not decoration. An average of 4,200 likes over eight posts and
 * the same figure over one are different claims, and the previous version of
 * this file divided by the post count rather than the count of posts that
 * carried a like figure — which quietly treated every unreadable post as a
 * post with no likes and dragged every average towards zero.
 */
function average(values: Array<number | null | undefined>, dp = 1): Averaged {
  const vals = known(values)
  if (vals.length === 0) return { value: null, over: 0 }
  return { value: round(vals.reduce((a, b) => a + b, 0) / vals.length, dp), over: vals.length }
}

/**
 * Per-account averages combined into one figure for the platform.
 *
 * Weighted by the posts behind each average rather than taken as a mean of
 * means: an account with one post and an account with thirty are not equal
 * evidence, and treating them as such lets a single post move the platform's
 * figure as far as a month of somebody else's output. The weights are also
 * what keep `over` honest — it stays a count of posts, which is what the field
 * claims to be.
 */
function combine(parts: Averaged[], dp = 1): Averaged {
  const contributing = parts.filter((p) => p.value !== null && p.over > 0)
  const over = contributing.reduce((sum, p) => sum + p.over, 0)
  if (over === 0) return { value: null, over: 0 }
  const total = contributing.reduce((sum, p) => sum + (p.value ?? 0) * p.over, 0)
  return { value: round(total / over, dp), over }
}

/** One post's own reading, normalised across the stored and live routes. */
interface Reading {
  url: string
  title: string | null
  publishedAt: string | null
  likes: number | null
  comments: number | null
  shares: number | null
  views: number | null
}

/**
 * Likes plus comments plus shares, over whichever of the three came back.
 *
 * Null when none of them did — a post nothing could be read from must not
 * count as a post with no engagement. A route that cannot see shares (every
 * public one) under-reports against a route that can (the Graph API), which is
 * a further reason the row states which route it used.
 */
function interactionsOf(post: Reading): number | null {
  const parts = known([post.likes, post.comments, post.shares])
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null
}

function totalInteractions(posts: Reading[]): number | null {
  const measured = posts.map(interactionsOf).filter((v): v is number => v !== null)
  return measured.length ? measured.reduce((a, b) => a + b, 0) : null
}

/**
 * Interactions per post as a percentage of reach.
 *
 * Views win when every counted post has them, because for a video the number
 * of people who saw it is the actual denominator and a follower count is a
 * proxy for it. Views are used only when they are complete: dividing half the
 * posts by views and half by followers, then averaging, produces a number that
 * is not a rate of anything. When neither denominator is available the answer
 * is null — the office can see that the rate is unknown, which is true, rather
 * than nought, which is a claim about the account.
 */
function engagementRate(posts: Reading[], followers: number | null): RatedAverage {
  const rated = posts.filter((p) => interactionsOf(p) !== null)
  if (rated.length === 0) return { value: null, over: 0, basis: null }

  const everyPostHasViews = rated.every((p) => typeof p.views === 'number' && p.views > 0)
  const basis: RateBasis | null = everyPostHasViews
    ? 'views'
    : typeof followers === 'number' && followers > 0
      ? 'followers'
      : null
  if (!basis) return { value: null, over: 0, basis: null }

  const rates = rated.map((p) => {
    const denominator = basis === 'views' ? (p.views ?? 0) : (followers ?? 0)
    if (denominator <= 0) return null
    return ((interactionsOf(p) ?? 0) / denominator) * 100
  })

  const mean = average(rates, 3)
  return { value: mean.value, over: mean.over, basis: mean.value === null ? null : basis }
}

/**
 * Posts per week, from the span the posts actually cover.
 *
 * Deliberately the same formula as `statsFor` in src/lib/handles.ts. Two
 * screens in one product disagreeing about how often an account posts is worse
 * than either formula being marginally the better estimator. Half a day is the
 * floor because a handful of posts published in one afternoon extrapolates to
 * an absurd weekly rate, and an absurd number on screen is worse than a blank.
 */
function cadenceOf(posts: Reading[]): Cadence {
  const times = posts
    .map((p) => (p.publishedAt ? Date.parse(p.publishedAt) : Number.NaN))
    .filter((t) => Number.isFinite(t))

  if (times.length < 2) {
    return {
      value: null,
      spanDays: null,
      note:
        times.length === 0
          ? 'No post carried a publication date, so cadence cannot be measured.'
          : 'Only one dated post, and a rate needs two.',
    }
  }

  const spanDays = (Math.max(...times) - Math.min(...times)) / 86_400_000
  if (spanDays <= 0.5) {
    return {
      value: null,
      spanDays: round(spanDays, 2),
      note: 'Every dated post falls within half a day, which is a burst rather than a rate.',
    }
  }

  return { value: round((posts.length / spanDays) * 7, 1), spanDays: round(spanDays, 1), note: null }
}

function topPostOf(posts: Reading[]): TopPost | null {
  let best: TopPost | null = null
  for (const post of posts) {
    const interactions = interactionsOf(post)
    if (interactions === null || !post.url) continue
    if (!best || interactions > best.interactions) {
      best = { url: post.url, title: post.title, publishedAt: post.publishedAt, interactions }
    }
  }
  return best
}

/**
 * Movement in the follower count, from the dated snapshots the sync writes.
 *
 * One reading is not a trend. The batch sync stores one snapshot per account
 * per day precisely so that this can exist, and on a gated platform it is the
 * only movement obtainable at all — Facebook publishes a follower count to its
 * embed widget and nothing else, so the fortnight-on-fortnight change in that
 * one number is the whole of what can be said about the page.
 */
function trendFrom(history: FollowerSnapshot[]): FollowerTrend | null {
  const dated = history.filter(
    (h) => typeof h.followers === 'number' && Number.isFinite(Date.parse(h.date)),
  )
  const first = dated[0]
  const last = dated[dated.length - 1]
  if (!first || !last || dated.length < 2) return null

  const spanDays = (Date.parse(last.date) - Date.parse(first.date)) / 86_400_000
  // No span, no trend. Two readings stamped with the same day are one reading
  // written twice, and an unparseable date rounded down to nought would put
  // "gained 4,000 followers over 0 days" on screen with a straight face.
  if (!(spanDays > 0)) return null

  return {
    first,
    last,
    delta: last.followers - first.followers,
    spanDays: round(spanDays, 1),
    readings: dated.length,
  }
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return null
  return Math.max(0, Math.round((Date.now() - at) / 3_600_000))
}

/* ── reading one account ─────────────────────────────────────────────────── */

const fromTracked = (post: TrackedPost): Reading => ({
  url: post.url,
  title: post.title,
  publishedAt: post.publishedAt,
  likes: post.engagement.likes,
  comments: post.engagement.comments,
  shares: post.engagement.shares,
  views: post.engagement.views,
})

async function compareAccount(
  profile: CompetitorProfile,
  options: { live: boolean; postsPerProfile: number; historyDays: number },
): Promise<AccountComparison> {
  let posts: Reading[] = []
  let followers: number | null = profile.followers ?? null
  let route: SourceRoute = 'none'
  let lastSyncedAt: string | null = profile.lastTrackedAt ?? null
  let note: string | null = profile.listingNote ?? null

  if (options.live) {
    try {
      const summary = await readHandle({ platform: profile.platform, handle: profile.handle })
      posts = summary.posts.map((p) => ({
        url: p.url,
        title: p.title,
        publishedAt: p.publishedAt,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares ?? null,
        views: p.views,
      }))
      followers = summary.followers
      // `readHandle` falls back to the stored copy on its own, and says so.
      // Trusting its verdict is the point of asking it rather than reproducing
      // the route order here and drifting out of step with it.
      route = summary.listing.route ?? (posts.length > 0 ? 'public' : 'none')
      lastSyncedAt = summary.lastSyncedAt ?? null
      note = summary.listing.note || null
    } catch (err) {
      note = err instanceof Error ? err.message : 'That account could not be read.'
    }
  } else {
    const stored = await getCompetitorPosts(profile.id, { limit: options.postsPerProfile })
    posts = stored.map(fromTracked)
    if (posts.length > 0) route = 'stored'
  }

  const history = await getFollowerHistory(profile.id, options.historyDays)

  return {
    profile,
    route,
    lastSyncedAt,
    // A live read is happening now, so it has no age. Stamping it with the
    // clock would make every row look equally fresh, which is the confusion
    // the `stored` route exists to prevent. `none` is aged too: no route
    // produced posts, so the follower count on that row is the sync's, and a
    // stale number shown with no age is the same lie in a smaller font.
    ageHours: route === 'stored' || route === 'none' ? hoursSince(lastSyncedAt) : null,
    note,
    followers,
    followerTrend: trendFrom(history),
    postsRead: posts.length,
    interactions: totalInteractions(posts),
    avgLikes: average(posts.map((p) => p.likes)),
    avgComments: average(posts.map((p) => p.comments)),
    avgShares: average(posts.map((p) => p.shares)),
    avgViews: average(posts.map((p) => p.views)),
    engagementRate: engagementRate(posts, followers),
    cadence: cadenceOf(posts),
    topPost: topPostOf(posts),
  }
}

/* ── the comparison ──────────────────────────────────────────────────────── */

const NO_FIREBASE =
  'This deploy has no Firebase credentials, so nothing tracked has been stored. Live reads still work; the comparison has no history to draw on.'

export async function createUnifiedComparison(
  options: ComparisonOptions = {},
): Promise<UnifiedComparison> {
  const configured = firestoreConfigured()
  const live = options.live ?? false
  const postsPerProfile = clamp(options.postsPerProfile ?? 20, 1, 50)
  const historyDays = clamp(options.historyDays ?? 90, 1, 365)
  const generatedAt = new Date().toISOString()

  const matched = await resolveProfiles(options)
  const cap = live ? MAX_LIVE_ACCOUNTS : MAX_ACCOUNTS
  const profiles = matched.slice(0, cap)
  const omitted = matched
    .slice(cap)
    .map((p) => ({ id: p.id, platform: p.platform, handle: p.handle }))

  if (profiles.length === 0) {
    return {
      accounts: [],
      platforms: [],
      totals: { accounts: 0, postsRead: 0, interactions: null },
      omitted,
      storage: {
        configured,
        note: configured
          ? 'No tracked accounts matched. Add accounts before comparing them.'
          : NO_FIREBASE,
      },
      notes: [],
      generatedAt,
    }
  }

  // Concurrent because each account is an independent read and the gated ones
  // are slow. Safe to fan out because the list was capped above.
  const accounts = await Promise.all(
    profiles.map((profile) => compareAccount(profile, { live, postsPerProfile, historyDays })),
  )

  const platforms = rollUpByPlatform(accounts)
  const measured = accounts.map((a) => a.interactions).filter((v): v is number => v !== null)

  const notes = observationsFrom(accounts, platforms)
  if (omitted.length > 0) {
    notes.unshift(
      `${omitted.length} further tracked account${omitted.length === 1 ? '' : 's'} matched but ` +
        `${omitted.length === 1 ? 'was' : 'were'} not read: one comparison reads at most ${cap}` +
        `${live ? ', because a live read is one or more upstream requests per account' : ''}. ` +
        'They are named in `omitted` — narrow the request by category or by profile id to reach them.',
    )
  }

  return {
    accounts,
    platforms,
    totals: {
      accounts: accounts.length,
      postsRead: accounts.reduce((sum, a) => sum + a.postsRead, 0),
      interactions: measured.length ? measured.reduce((a, b) => a + b, 0) : null,
    },
    omitted,
    storage: {
      configured,
      note: configured
        ? 'Stored figures come from the batch sync; each row states its route and age.'
        : NO_FIREBASE,
    },
    notes,
    generatedAt,
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}

async function resolveProfiles(options: ComparisonOptions): Promise<CompetitorProfile[]> {
  if (options.profileIds && options.profileIds.length > 0) {
    const found = await Promise.all(options.profileIds.map((id) => getProfile(id)))
    return found.filter((p): p is CompetitorProfile => p !== null)
  }
  return getTrackedProfiles(options.category)
}

function rollUpByPlatform(accounts: AccountComparison[]): PlatformComparison[] {
  const grouped = new Map<Platform, AccountComparison[]>()
  for (const account of accounts) {
    const existing = grouped.get(account.profile.platform)
    if (existing) existing.push(account)
    else grouped.set(account.profile.platform, [account])
  }

  return [...grouped.entries()].map(([platform, rows]) => {
    const withPosts = rows.filter((r) => r.postsRead > 0)
    const rated = rows.filter((r) => r.engagementRate.value !== null)
    const bases = new Set(rated.map((r) => r.engagementRate.basis))
    const basis = bases.size === 1 ? ([...bases][0] ?? null) : null
    const combined = combine(rated.map((r) => r.engagementRate), 3)

    /**
     * A platform rate exists only when its accounts agree on a denominator.
     *
     * Averaging a share-of-viewers with a share-of-followers produces a figure
     * that is not a rate of anything, and it would sit in the same column as
     * the honest ones with nothing to mark it. Better an empty cell and a
     * sentence saying why.
     */
    const rate: RatedAverage = basis
      ? { ...combined, basis: combined.value === null ? null : basis }
      : { value: null, over: 0, basis: null }

    return {
      platform,
      accounts: rows.length,
      accountsWithPosts: withPosts.length,
      postsRead: rows.reduce((sum, r) => sum + r.postsRead, 0),
      avgLikes: combine(rows.map((r) => r.avgLikes)),
      avgComments: combine(rows.map((r) => r.avgComments)),
      engagementRate: rate,
      routes: [...new Set(rows.map((r) => r.route))],
      note:
        withPosts.length > 0
          ? rated.length > 0 && !basis
            ? 'These accounts measure engagement against different denominators, so there is no single rate for the platform.'
            : null
          : (rows.find((r) => r.note)?.note ??
            `Nothing has been read for ${platform} yet. Run a sync, or read live.`),
    }
  })
}

/**
 * What the figures actually support, said plainly.
 *
 * The previous version of this file opened with "YouTube dominates engagement"
 * regardless of which platform had won — the string was hard-coded and the
 * computed winner was interpolated into a different part of the sentence. An
 * office reading that would have had no way to tell.
 */
function observationsFrom(
  accounts: AccountComparison[],
  platforms: PlatformComparison[],
): string[] {
  const notes: string[] = []

  const ranked = accounts
    .filter((a) => a.engagementRate.value !== null)
    .sort((a, b) => (b.engagementRate.value ?? 0) - (a.engagementRate.value ?? 0))
  const leader = ranked[0]
  if (leader && leader.engagementRate.value !== null) {
    const who = leader.profile.displayName ?? leader.profile.name ?? leader.profile.handle
    const denominator = leader.engagementRate.basis === 'views' ? 'the people who saw it' : 'their following'
    notes.push(
      `${who} on ${leader.profile.platform} gets the most out of ${denominator}: ` +
        `${leader.engagementRate.value.toFixed(2)}% per post, over ${leader.engagementRate.over} post${
          leader.engagementRate.over === 1 ? '' : 's'
        }.`,
    )
  }
  if (ranked.length === 1 && accounts.length > 1) {
    notes.push(
      'Only one account produced a comparable rate, so there is nothing to rank it against yet.',
    )
  }

  const silent = accounts.filter((a) => a.postsRead === 0)
  for (const account of silent.slice(0, 5)) {
    // The note is the reader's own sentence about why the platform gave
    // nothing. Replacing it with "no data" is what made a gated page look like
    // an inactive one.
    notes.push(
      `${account.profile.platform} — ${account.profile.handle}: ${
        account.note ?? 'no posts have been read for this account yet.'
      }`,
    )
  }
  if (silent.length > 5) {
    notes.push(`${silent.length - 5} further accounts returned no posts; see each row's own note.`)
  }

  const stale = accounts.filter((a) => a.route === 'stored' && (a.ageHours ?? 0) >= 48)
  if (stale.length > 0) {
    const oldest = stale.reduce((a, b) => ((a.ageHours ?? 0) > (b.ageHours ?? 0) ? a : b))
    notes.push(
      `${stale.length} row${stale.length === 1 ? ' is' : 's are'} from a stored sync more than two days old — ` +
        `the oldest, ${oldest.profile.handle}, was last synced ${Math.round((oldest.ageHours ?? 0) / 24)} days ago.`,
    )
  }

  const moved = accounts.filter((a) => a.followerTrend && a.followerTrend.delta !== 0)
  for (const account of moved.slice(0, 3)) {
    const trend = account.followerTrend
    if (!trend) continue
    const direction = trend.delta > 0 ? 'gained' : 'lost'
    notes.push(
      `${account.profile.handle} ${direction} ${Math.abs(trend.delta).toLocaleString('en-GB')} followers ` +
        `over ${trend.spanDays} days, across ${trend.readings} readings.`,
    )
  }

  const mixed = platforms.filter((p) => p.routes.length > 1)
  for (const platform of mixed) {
    notes.push(
      `${platform.platform} rows came by different routes (${platform.routes.join(', ')}), so they are not equally fresh.`,
    )
  }

  return notes
}

/* ── the dashboard's one-line-per-platform view ──────────────────────────── */

/**
 * Counted per account, so an account with more stored posts than this is
 * reported as having exactly this many. `postsCapped` says when that happened,
 * because a floor presented as a total is a wrong number.
 */
const QUICK_POST_CAP = 50

export interface QuickComparison {
  configured: boolean
  /** Why the tally reads as it does, including when it is empty. */
  note: string
  platforms: PlatformSnapshot[]
}

export interface PlatformSnapshot {
  platform: Platform
  accounts: number
  /** Stored posts, counted up to {@link QUICK_POST_CAP} per account. */
  postsStored: number
  /** True when an account hit the cap, so `postsStored` is a floor, not a total. */
  postsCapped: boolean
  /** The most recent sync across the accounts on this platform. */
  lastSyncedAt: string | null
  /** A sentence, not a status light: it says what is there and what is not. */
  status: string
}

/**
 * A per-platform tally cheap enough for a dashboard's first paint.
 *
 * Stored counts only — no live reads, so this never waits on a platform.
 * A platform with tracked accounts and no stored posts is reported as exactly
 * that, because the fix differs: an unsynced account needs a sync, and a gated
 * one needs a token or a provider.
 */
export async function getQuickComparison(platforms?: Platform[]): Promise<QuickComparison> {
  const configured = firestoreConfigured()
  const tracked = await getTrackedProfiles()
  const wanted = platforms ?? [...new Set(tracked.map((p) => p.platform))]

  const snapshots = await Promise.all(
    wanted.map(async (platform): Promise<PlatformSnapshot> => {
      const rows = tracked.filter((p) => p.platform === platform)
      if (rows.length === 0) {
        return {
          platform,
          accounts: 0,
          postsStored: 0,
          postsCapped: false,
          lastSyncedAt: null,
          status: configured
            ? 'No accounts tracked on this platform.'
            : 'Firebase is not configured on this deploy, so nothing is tracked.',
        }
      }

      const counts = await Promise.all(
        rows.map((row) =>
          getCompetitorPosts(row.id, { limit: QUICK_POST_CAP }).then((posts) => posts.length),
        ),
      )
      const postsStored = counts.reduce((a, b) => a + b, 0)
      const postsCapped = counts.some((n) => n >= QUICK_POST_CAP)
      const syncs = rows
        .map((r) => r.lastTrackedAt)
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .sort()
      const lastSyncedAt = syncs[syncs.length - 1] ?? null

      return {
        platform,
        accounts: rows.length,
        postsStored,
        postsCapped,
        lastSyncedAt,
        status:
          postsStored > 0
            ? `${postsCapped ? 'At least ' : ''}${postsStored} posts stored across ${rows.length} account${rows.length === 1 ? '' : 's'}${
                lastSyncedAt ? `, last synced ${lastSyncedAt.slice(0, 10)}` : ''
              }.`
            : (rows.find((r) => r.listingNote)?.listingNote ??
              `${rows.length} account${rows.length === 1 ? '' : 's'} tracked, none synced yet.`),
      }
    }),
  )

  // With no platforms asked for and nothing tracked, `platforms` is an empty
  // array — which on its own is indistinguishable from "every platform is
  // quiet". The note is the difference between the two, and between either and
  // a deploy that cannot store anything at all.
  return {
    configured,
    note: !configured
      ? NO_FIREBASE
      : tracked.length === 0
        ? 'No accounts are tracked yet, so there is nothing stored to tally.'
        : 'Stored counts only. Nothing here was read live, so a platform with a recent sync is as current as that sync.',
    platforms: snapshots,
  }
}
