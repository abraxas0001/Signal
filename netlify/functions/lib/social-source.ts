import { fetchText } from './fetcher'
import type { Comment } from '../../../shared/types'
import type { HandlePost } from './handles'
import {
  metaCredentials,
  facebookPostComments,
  instagramComments,
  type MetaCredentials,
} from './meta-graph'

/**
 * One seam for "who can actually get this data".
 *
 * The problem this exists to stop being architectural. Facebook and Instagram
 * publish nothing about an account to a server without authorisation, so the
 * comments under a page's posts are reachable by exactly three routes and no
 * others:
 *
 *   owned      — the office is an admin and generated a Page token. Free, no
 *                app review, ten minutes. This is what a paying customer does,
 *                and it is why the "we do not have adminship" objection is a
 *                fact about a demo rather than about the product.
 *   licensed   — a third-party provider that already holds the data and sells
 *                access to it, for pages nobody here will ever administer:
 *                rivals, opponents, the district's loudest critic.
 *   public     — everything the platform genuinely serves to anyone. YouTube,
 *                Bluesky, Mastodon and the open web are fully readable this
 *                way; Meta is not.
 *   stored     — one of the three above, read earlier and kept. The batch sync
 *                walks the tracked accounts slowly enough not to be blocked,
 *                which is the only way a gated platform yields a post list at
 *                all; the cost is that what comes back is as old as the last
 *                sync. That is worth a route of its own rather than being
 *                folded into `public`, on the same principle as the rest of
 *                this file: a figure read a moment ago and a figure read on
 *                Tuesday are not the same evidence, and a screen that renders
 *                them identically is telling the office its numbers are live
 *                when they are not.
 *
 * There is one further route and it is deliberately absent: signing in as a
 * fabricated user and reading through that session. That is what most scrapers
 * do, it is what the "but bots manage it" observation is actually describing,
 * and it is not on the table here. It is a terms violation that gets accounts
 * and address ranges banned continuously, it has been litigated successfully by
 * Meta more than once, and it breaks whenever an internal identifier rotates —
 * which is roughly fortnightly. A product an office runs its reputation through
 * cannot rest on it.
 *
 * WHAT THIS FILE GUARANTEES: every value that comes back says which
 * route produced it. A comment obtained from a licensed reseller and a
 * comment read from the platform's own API are not the same evidence, and a
 * screen that renders them identically is lying by omission — on a product
 * whose entire pitch is telling an office which claims are supported.
 */

export type SourceRoute = 'owned' | 'licensed' | 'public' | 'stored' | 'none'

export interface Sourced<T> {
  data: T
  route: SourceRoute
  /** Shown to the reader when the route is worth knowing about. */
  note: string | null
}

/* ── the licensed provider slot ──────────────────────────────────────────── */

/**
 * A provider is any endpoint that speaks this contract.
 *
 * Deliberately not written against one vendor. Apify, Bright Data and Phyllo
 * all return different shapes, all change them, and committing to one before
 * there is a paying customer to justify the bill is how a codebase acquires a
 * dependency nobody chose. What is fixed here is the contract; adapting a
 * vendor to it is a small shim the operator controls.
 *
 *   POST <SOCIAL_PROVIDER_URL>
 *   Authorization: Bearer <SOCIAL_PROVIDER_KEY>
 *   { "kind": "comments", "platform": "Facebook", "url": "...", "limit": 100 }
 *   -> { "comments": [ { "text", "author", "likes", "publishedAt" } ] }
 *
 *   { "kind": "posts", "platform": "Facebook", "handle": "DKAruna.TG" }
 *   -> { "posts": [ { "url", "id", "title", "publishedAt", "likes", "comments" } ] }
 *
 * A provider that cannot answer returns an empty array rather than an error, so
 * a gap in its coverage degrades to the public route instead of failing a scan.
 */
const providerUrl = (): string | null => process.env['SOCIAL_PROVIDER_URL']?.trim() || null
const providerKey = (): string | null => process.env['SOCIAL_PROVIDER_KEY']?.trim() || null

export const licensedProviderAvailable = (): boolean => Boolean(providerUrl())

/** Platforms that publish nothing to an unauthenticated server. */
export const GATED_PLATFORMS = new Set(['Facebook', 'Instagram', 'Twitter/X', 'LinkedIn'])

const PROVIDER_TIMEOUT_MS = 15_000

interface ProviderRequest {
  kind: 'comments' | 'posts'
  platform: string
  url?: string
  handle?: string
  limit?: number
}

async function askProvider<T>(body: ProviderRequest, field: string): Promise<T[] | null> {
  const url = providerUrl()
  if (!url) return null

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(providerKey() ? { authorization: `Bearer ${providerKey()!}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.log(`[signal] social provider answered ${res.status} for ${body.kind}`)
      return null
    }
    const parsed = (await res.json()) as Record<string, unknown>
    const list = parsed[field]
    return Array.isArray(list) ? (list as T[]) : []
  } catch (err) {
    console.log(
      `[signal] social provider unreachable: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}

/** Coerce a provider's rows into our shape. Never trust a third party's schema. */
function toComments(rows: unknown[]): Comment[] {
  const text = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null

  return rows
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      text: text(r['text']) ?? text(r['message']) ?? text(r['comment']) ?? '',
      author: text(r['author']) ?? text(r['username']) ?? text(r['from']) ?? null,
      likes:
        typeof r['likes'] === 'number'
          ? r['likes']
          : typeof r['like_count'] === 'number'
            ? r['like_count']
            : null,
      publishedAt: text(r['publishedAt']) ?? text(r['timestamp']) ?? text(r['created_time']),
      isReply: r['isReply'] === true,
    }))
    .filter((c) => c.text.length > 0)
}

/* ── the two questions callers actually ask ──────────────────────────────── */

/**
 * The comments under one post, by whichever route can get them.
 *
 * Order is by quality of evidence, not by convenience: the platform's own API
 * for a page the office administers, then a licensed reseller, then whatever is
 * genuinely public. The first one that returns anything wins, and says so.
 */
export async function commentsForPost(input: {
  url: string
  /** The platform's own id, when a credentialed route produced the post. */
  id?: string | null
  platform: string
  /** The public reader, injected so this file does not depend on extraction. */
  publicRead: (url: string) => Promise<Comment[]>
  creds?: MetaCredentials | null
}): Promise<Sourced<Comment[]>> {
  const creds = input.creds !== undefined ? input.creds : metaCredentials()

  /* 1. the office's own page, through the platform's API */
  if (creds && input.id) {
    try {
      const own =
        input.platform === 'Facebook'
          ? await facebookPostComments(creds, input.id)
          : input.platform === 'Instagram'
            ? await instagramComments(creds, input.id)
            : []
      if (own.length > 0) {
        return { data: own, route: 'owned', note: null }
      }
    } catch {
      // An expired or under-scoped token must not cost the post its comments.
    }
  }

  /* 2. a licensed provider, for pages nobody here administers.
     Gated platforms only — the same guard `postsForHandle` has below. Without
     it every YouTube, Bluesky and Mastodon post was sent to the paid provider
     FIRST, before the free public read beneath it was even attempted: a billed
     request for comments the platform hands to anyone. */
  const licensed = GATED_PLATFORMS.has(input.platform)
    ? await askProvider<unknown>(
        { kind: 'comments', platform: input.platform, url: input.url, limit: 100 },
        'comments',
      )
    : null
  if (licensed && licensed.length > 0) {
    return {
      data: toComments(licensed),
      route: 'licensed',
      note: 'Supplied by a third-party data provider rather than read from the platform.',
    }
  }

  /* 3. whatever the platform genuinely serves to anyone */
  const open = await input.publicRead(input.url).catch(() => [])
  if (open.length > 0) return { data: open, route: 'public', note: null }

  return {
    data: [],
    route: 'none',
    note: GATED_PLATFORMS.has(input.platform)
      ? `${input.platform} publishes no comments to a server. This needs either the page's own access token, or a licensed data provider.`
      : null,
  }
}

/**
 * Recent posts for an account we do not administer.
 *
 * Only the licensed route lives here — the owned route is already inside
 * `readHandle`, which knows how to prove a token belongs to the handle it is
 * being used for. This is the gap that route leaves: a rival's page, which no
 * token here will ever authorise.
 */
export async function postsForHandle(input: {
  handle: string
  platform: string
}): Promise<Sourced<HandlePost[]>> {
  if (!GATED_PLATFORMS.has(input.platform)) {
    return { data: [], route: 'none', note: null }
  }

  const rows = await askProvider<Record<string, unknown>>(
    { kind: 'posts', platform: input.platform, handle: input.handle },
    'posts',
  )
  /**
   * Three outcomes, not two. `askProvider` returns null when it never got an
   * answer — unconfigured, unreachable, 401, rate-limited, timed out — and []
   * when the provider answered and genuinely holds nothing for this handle.
   *
   * Collapsing them told the office "the data provider returned no posts for
   * DKAruna.TG", which reads as a fact about the rival: the provider works and
   * simply has not got them. When the truth is an expired key or an outage,
   * that is an absence rendered as a measurement — the one failure this
   * codebase treats as unforgivable — and it also hides the billing problem
   * behind a sentence about somebody else's Facebook page.
   */
  if (rows === null) {
    return {
      data: [],
      route: 'none',
      note: licensedProviderAvailable()
        ? `The data provider could not be reached for ${input.handle}, so this account was not read at all. That is an outage, an expired key or a rate limit, not a reading of an empty account.`
        : `${input.platform} does not publish this account's posts to anyone without a login. Reading a page you do not administer needs a licensed data provider. See Settings.`,
    }
  }

  if (rows.length === 0) {
    return {
      data: [],
      route: 'none',
      note: `The data provider was reached and holds no posts for ${input.handle}.`,
    }
  }

  const text = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)

  const posts: HandlePost[] = rows
    .map((r) => ({
      url: text(r['url']) ?? text(r['permalink']) ?? '',
      id: text(r['id']),
      title: text(r['title']) ?? text(r['caption']) ?? text(r['message']),
      publishedAt: text(r['publishedAt']) ?? text(r['timestamp']),
      views: num(r['views']),
      likes: num(r['likes']),
      comments: num(r['comments']),
      shares: num(r['shares']),
    }))
    .filter((p) => p.url.length > 0)

  /**
   * Rows arrived but none survived the coercion, which means the vendor shim
   * is putting the permalink somewhere this does not read. Returning
   * `route: 'licensed'` with an empty array would hang a provenance claim on
   * nothing — the screen would say a reseller supplied this and then show
   * nothing, and the operator would get no signal that their adapter is
   * misconfigured rather than the rival being quiet.
   */
  if (posts.length === 0) {
    console.log(
      `[signal] provider returned ${rows.length} rows for ${input.handle} with no usable post url`,
    )
    return {
      data: [],
      route: 'none',
      note: `The data provider answered for ${input.handle} but none of its rows carried a post link. The vendor adapter needs checking. This is not a reading of an empty account.`,
    }
  }

  return {
    data: posts,
    route: 'licensed',
    note: 'Supplied by a third-party data provider rather than read from the platform.',
  }
}

/** What the Settings screen reports about this slot. */
export function providerStatus(): {
  configured: boolean
  needs: string[]
} {
  return {
    configured: licensedProviderAvailable(),
    needs: licensedProviderAvailable() ? [] : ['SOCIAL_PROVIDER_URL', 'SOCIAL_PROVIDER_KEY'],
  }
}
