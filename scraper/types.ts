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

/** The four platforms that publish nothing to an unauthenticated server. */
export type Platform = 'Facebook' | 'Instagram' | 'LinkedIn' | 'Twitter/X'

export const PLATFORMS: readonly Platform[] = ['Facebook', 'Instagram', 'LinkedIn', 'Twitter/X']

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
  const m = s.match(/([\d.]+)\s*(k|m|b|lakh|lakhs|crore|crores|thousand|million)?/)
  if (!m || !m[1]) return null
  const n = Number.parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  switch (m[2]) {
    case 'k':
    case 'thousand':
      return Math.round(n * 1_000)
    case 'm':
    case 'million':
      return Math.round(n * 1_000_000)
    case 'b':
      return Math.round(n * 1_000_000_000)
    case 'lakh':
    case 'lakhs':
      return Math.round(n * 100_000)
    case 'crore':
    case 'crores':
      return Math.round(n * 10_000_000)
    default:
      return Math.round(n)
  }
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
