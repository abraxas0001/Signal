/**
 * The scraper's contract with the app, and with its own platform adapters.
 *
 * WHY THIS EXISTS AT ALL. `netlify/functions/lib/social-source.ts` already
 * defines a vendor-neutral provider slot: POST a JSON body to
 * SOCIAL_PROVIDER_URL, get posts or comments back. It was written for a paid
 * reseller. Nothing in it requires the provider to be paid, or remote — so
 * this service implements the same contract and the whole pipeline (sync,
 * Firestore, the dashboard, the per-post analysis) works with no app change.
 *
 * WHY A BROWSER. Measured, not assumed: Facebook returns zero post permalinks
 * on a 4.9 MB profile page under four crawler user-agents; Instagram answers a
 * datacentre IP with HTTP 429; X returns 503 even to Googlebot; LinkedIn
 * serves its authwall as HTTP 200. None of the four publishes a post list to
 * an unauthenticated server, so no amount of HTTP cleverness produces one. A
 * real browser carrying a real session does.
 *
 * WHAT THAT COSTS, said once and honestly: automating a logged-in session is
 * against all four platforms' terms, the account doing it can be limited or
 * banned, and the selectors rot — Instagram rotates internal identifiers every
 * two to four weeks. This service is built so that when it breaks it SAYS SO
 * rather than quietly returning half a profile, because a silent half-read is
 * indistinguishable from a quiet week and that is the one failure this product
 * treats as unforgivable.
 */

/**
 * The platforms this service reads.
 *
 * Four of them publish nothing to an unauthenticated server and need a real
 * signed-in browser. YouTube is the exception and is included precisely because
 * it is one: a channel's videos are public, so it costs no login, carries no
 * risk to an account, and is the only source here that keeps working when every
 * session has expired.
 */
export type Platform = 'Facebook' | 'Instagram' | 'LinkedIn' | 'Twitter/X' | 'YouTube'

export const PLATFORMS: readonly Platform[] = [
  'Facebook',
  'Instagram',
  'LinkedIn',
  'Twitter/X',
  // The only one that needs no session: a channel's videos are public, so it
  // has no login to lose and no wall to mistake for an empty account.
  'YouTube',
]

export function isPlatform(v: unknown): v is Platform {
  return typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v)
}

/**
 * One post, in the shape `social-source.ts` coerces from a provider.
 *
 * Every metric is nullable and null means NOT MEASURED — never zero. A post
 * whose like count the page did not render is `likes: null`, and the app
 * renders that as a dash. Writing 0 there would be inventing a measurement.
 */
export interface ScrapedPost {
  /** Canonical permalink. The one field that must always be present. */
  url: string
  /** The platform's own id, when the page exposed one. */
  id: string | null
  title: string | null
  publishedAt: string | null
  likes: number | null
  comments: number | null
  shares: number | null
  views: number | null
  /**
   * The picture the platform shows for this post, as it appeared in the feed.
   *
   * A CDN address, and therefore short-lived twice over: these hosts refuse
   * cross-origin embedding, and their URLs carry signed expiry parameters that
   * lapse within days. Anything that wants to DISPLAY one has to download it
   * first — see `scraper:media`. Null where the post is text only, which is a
   * real answer and renders as the platform's own tile.
   */
  thumbnailUrl: string | null
}

/** One comment, in the shape `social-source.ts` coerces from a provider. */
export interface ScrapedComment {
  text: string
  author: string | null
  likes: number | null
  publishedAt: string | null
  isReply: boolean
}

/**
 * What an adapter returns.
 *
 * `ok: false` is not the same as an empty list, and the distinction is load
 * bearing all the way up: `social-source.ts` renders "the provider holds
 * nothing for this handle" for an empty answer and "the provider could not be
 * reached" for a failure. Collapsing them turns an expired session into a
 * statement about a rival's posting habits.
 */
export type AdapterResult<T> =
  | { ok: true; items: T[]; note?: string }
  | { ok: false; reason: string; needsLogin?: boolean }

/** Everything an adapter is handed. Adapters never construct their own page. */
export interface AdapterContext {
  /** A Playwright page on a persistent, logged-in profile. */
  page: import('playwright').Page
  /** Structured logging that respects the service's quiet mode. */
  log: (msg: string) => void
  /**
   * Wait out the pacing budget for this platform before a navigation.
   * Adapters MUST call this before each page load; it is what keeps the
   * session from tripping a rate limiter.
   */
  pace: () => Promise<void>
  /** Hard ceiling on posts to collect. Adapters stop when they reach it. */
  limit: number
}

/** One platform's implementation. Four of these, one file each. */
export interface PlatformAdapter {
  platform: Platform

  /**
   * Turn a handle into a profile URL. Handles arrive in whatever form the
   * office typed them — "@DKAruna.TG", "DKAruna.TG", or a full URL.
   */
  profileUrl: (handle: string) => string

  /**
   * True when the page currently shown is a login wall rather than content.
   * Checked after every navigation so an expired session is reported as
   * "sign in again", never as "this account has no posts".
   */
  isLoginWall: (ctx: AdapterContext) => Promise<boolean>

  /** The post list for one profile. */
  posts: (ctx: AdapterContext, handle: string) => Promise<AdapterResult<ScrapedPost>>

  /** The comments under one post. Optional: not every platform is worth it. */
  comments?: (ctx: AdapterContext, url: string) => Promise<AdapterResult<ScrapedComment>>

  /**
   * Who this profile is, and how many people follow it.
   *
   * Read from the profile page the post list was just taken from, so it costs
   * no extra navigation and no extra pacing budget. Separate from `posts`
   * because the two answer different questions and fail independently: a
   * timeline can render while the header has not, and a follower count that
   * could not be read must not invalidate twenty-five posts that could.
   *
   * Every field is nullable and null means "not read", never zero. A follower
   * count is the headline number on this dashboard, and the difference between
   * an unknown and a zero is the difference between a blank and a claim that a
   * sitting MP has no followers.
   */
  profile?: (ctx: AdapterContext, handle: string) => Promise<ProfileInfo>
}

/** The header facts about a profile: who it is and how big its audience is. */
export interface ProfileInfo {
  displayName: string | null
  followers: number | null
  avatarUrl: string | null
}

/* ── the wire contract, mirrored from social-source.ts ───────────────────── */

export interface ProviderRequest {
  kind: 'posts' | 'comments'
  platform: string
  url?: string
  handle?: string
  limit?: number
}

export interface PostsResponse {
  posts: ScrapedPost[]
  /** Ours, not part of the app's contract — the app ignores unknown fields. */
  note?: string
}

export interface CommentsResponse {
  comments: ScrapedComment[]
  note?: string
}

/* ── small shared parsers ────────────────────────────────────────────────── */

/**
 * "1.2K", "3,405", "1.5 lakh", "2.3M" → a number, or null.
 *
 * Null rather than zero for anything unparseable, for the reason at the top of
 * this file: an unread count and a genuine zero must never look alike.
 */
export function parseCount(raw: string | null | undefined): number | null {
  if (!raw) return null
  const s = raw.replace(/,/g, '').trim().toLowerCase()
  const m = s.match(
    /([\d.]+)\s*(k|m|b|lakh|lakhs|crore|crores|thousand|million|लाख|करोड़|करोड|हज़ार|हजार|లక్ష|లక్షల|కోటి|కోట్ల|వేల|వేయి)?/,
  )
  if (!m || !m[1]) return null
  const n = Number.parseFloat(m[1])
  if (!Number.isFinite(n)) return null

  const MULTIPLIER: Record<string, number> = {
    k: 1_000,
    thousand: 1_000,
    'हज़ार': 1_000,
    'हजार': 1_000,
    'వేల': 1_000,
    'వేయి': 1_000,
    m: 1_000_000,
    million: 1_000_000,
    b: 1_000_000_000,
    lakh: 100_000,
    lakhs: 100_000,
    'लाख': 100_000,
    'లక్ష': 100_000,
    'లక్షల': 100_000,
    crore: 10_000_000,
    crores: 10_000_000,
    'करोड़': 10_000_000,
    'करोड': 10_000_000,
    'కోటి': 10_000_000,
    'కోట్ల': 10_000_000,
  }

  if (m[2]) return Math.round(n * (MULTIPLIER[m[2]] ?? 1))

  /**
   * A number with an unrecognised unit beside it is not a number we know.
   *
   * The unit group is optional, which used to mean anything unmatched silently
   * fell through to the bare figure. Measured on this desk's own Facebook page,
   * which renders in Hindi, that turned "2.8 लाख फ़ॉलोअर" — 280,000 followers —
   * into 3. Not a near miss: five orders of magnitude, presented to a
   * politician's office as a follower count, with nothing downstream able to
   * catch it.
   *
   * So when a non-ASCII word sits where a multiplier would be, this refuses to
   * answer rather than assume the units are plain. Plain ASCII trailing words
   * are fine and common — "12134770 followers", "1271 Likes. Like" — because a
   * multiplier written in Latin script would have matched above.
   */
  const after = s.slice((m.index ?? 0) + m[1].length)
  if (/[^ -]/.test(after)) return null

  return Math.round(n)
}

/** Strip tracking noise so the same post does not store under two URLs. */
export function canonicalUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base)
    // Query strings on these platforms are almost entirely referral tracking.
    for (const k of [...u.searchParams.keys()]) {
      if (!/^(v|story_fbid|id)$/i.test(k)) u.searchParams.delete(k)
    }
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}
