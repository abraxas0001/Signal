import type { Comment } from '../../../shared/types'
import type { HandlePost } from './handles'

/**
 * Meta's Graph API — the legitimate route to a page you own.
 *
 * Everything else in this codebase reads what Meta serves the public, because
 * that is all a stranger is entitled to. This module is different: it uses a
 * page access token the operator has been granted for their own page, which is
 * how Meta intends this data to be read, and it returns what scraping cannot —
 * a page's post list, real comment bodies, share counts and reel plays.
 *
 * WHAT IT DOES NOT DO, and cannot be made to: a page token authorises one page.
 * It will not read a rival's page, and no amount of code changes that. The
 * competitor half of this product stays on the public path.
 *
 * Absent a token every function here returns null and the caller falls back to
 * the public read. That is the normal state, not an error — the product is
 * designed to work with no keys at all.
 */

/**
 * Graph API versions are dated and Meta retires them after roughly two years,
 * at which point calls fail with a version error rather than degrading. Pinned
 * so an upgrade is a deliberate act, and overridable so it does not need a code
 * change when the pin expires.
 */
const VERSION = process.env['META_API_VERSION'] ?? 'v21.0'
const BASE = `https://graph.facebook.com/${VERSION}`

/** How many posts to pull. Meta pages, unlike the public path, will give many. */
const POST_LIMIT = 25
const COMMENT_LIMIT = 100

export interface MetaCredentials {
  /** Long-lived page access token. Never logged, never returned to a client. */
  pageToken: string
  /** Optional: the Instagram Business account linked to that page. */
  igUserId?: string
}

export function metaCredentials(): MetaCredentials | null {
  const pageToken = process.env['META_PAGE_TOKEN']?.trim()
  if (!pageToken) return null
  const igUserId = process.env['META_IG_USER_ID']?.trim()
  return igUserId ? { pageToken, igUserId } : { pageToken }
}

interface GraphError {
  error?: { message?: string; type?: string; code?: number }
}

/**
 * One Graph call.
 *
 * Meta answers a bad token with HTTP 400 and a body explaining it, not a 401,
 * so the status alone cannot be trusted to mean success. The body is checked.
 * The token is passed as a header rather than a query parameter so it does not
 * end up in a URL that might be logged.
 */
async function graph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(9000),
  })
  const json = (await res.json()) as T & GraphError

  if (json.error) {
    // Meta's message names the missing permission, which is the one thing an
    // operator needs to fix it. It contains no secret.
    throw new Error(`Meta API: ${json.error.message ?? 'request refused'}`)
  }
  if (!res.ok) throw new Error(`Meta API returned HTTP ${res.status}.`)
  return json
}

/** Which page this token actually authorises. A token names its own page. */
export async function whoAmI(
  creds: MetaCredentials,
): Promise<{ id: string; name: string; followers: number | null }> {
  const me = await graph<{ id: string; name?: string; followers_count?: number }>(
    'me',
    creds.pageToken,
    { fields: 'id,name,followers_count' },
  )
  return {
    id: me.id,
    name: me.name ?? '',
    followers: typeof me.followers_count === 'number' ? me.followers_count : null,
  }
}

interface FbPost {
  id: string
  message?: string
  created_time?: string
  permalink_url?: string
  shares?: { count?: number }
  reactions?: { summary?: { total_count?: number } }
  comments?: { summary?: { total_count?: number } }
  insights?: { data?: { name?: string; values?: { value?: number }[] }[] }
}

/**
 * A page's own posts, with the figures the public path cannot reach.
 *
 * `shares` and reel plays are the two the scraper genuinely cannot get: the
 * public page carries no share count on a reel at all, and no post list to
 * attach one to.
 */
export async function facebookPagePosts(creds: MetaCredentials): Promise<HandlePost[]> {
  const res = await graph<{ data?: FbPost[] }>('me/posts', creds.pageToken, {
    limit: String(POST_LIMIT),
    fields: [
      'id',
      'message',
      'created_time',
      'permalink_url',
      'shares',
      'reactions.summary(true)',
      'comments.summary(true)',
      'insights.metric(post_video_views)',
    ].join(','),
  })

  return (res.data ?? []).map((p) => {
    const plays = p.insights?.data?.find((d) => d.name === 'post_video_views')?.values?.[0]?.value
    return {
      url: p.permalink_url ?? `https://www.facebook.com/${p.id}`,
      title: p.message?.slice(0, 140) ?? null,
      publishedAt: p.created_time ?? null,
      views: typeof plays === 'number' ? plays : null,
      likes: p.reactions?.summary?.total_count ?? null,
      comments: p.comments?.summary?.total_count ?? null,
      shares: p.shares?.count ?? null,
    }
  })
}

interface GraphComment {
  message?: string
  from?: { name?: string }
  like_count?: number
  created_time?: string
}

/** Every comment on one post — not the ten the public page leaks. */
export async function facebookPostComments(
  creds: MetaCredentials,
  postId: string,
): Promise<Comment[]> {
  const res = await graph<{ data?: GraphComment[] }>(`${postId}/comments`, creds.pageToken, {
    limit: String(COMMENT_LIMIT),
    order: 'reverse_chronological',
    fields: 'message,from,like_count,created_time',
  })
  return (res.data ?? [])
    .filter((c) => c.message?.trim())
    .map((c) => ({
      text: c.message!.trim(),
      author: c.from?.name ?? null,
      likes: typeof c.like_count === 'number' ? c.like_count : null,
      publishedAt: c.created_time ?? null,
      isReply: false,
    }))
}

interface IgMedia {
  id: string
  caption?: string
  timestamp?: string
  permalink?: string
  like_count?: number
  comments_count?: number
  media_product_type?: string
  /** Reels report plays; feed posts do not. */
  insights?: { data?: { name?: string; values?: { value?: number }[] }[] }
}

/**
 * The Instagram Business account's own media, including reel plays.
 *
 * This is the one that changes the product most: the public path gives an
 * Instagram follower count and nothing else — no posts, no comment bodies at
 * all. With a token linked to the account, all of it is available.
 */
export async function instagramMedia(creds: MetaCredentials): Promise<HandlePost[]> {
  if (!creds.igUserId) return []
  const res = await graph<{ data?: IgMedia[] }>(`${creds.igUserId}/media`, creds.pageToken, {
    limit: String(POST_LIMIT),
    fields: [
      'id',
      'caption',
      'timestamp',
      'permalink',
      'like_count',
      'comments_count',
      'media_product_type',
      'insights.metric(plays)',
    ].join(','),
  })

  return (res.data ?? []).map((m) => {
    const plays = m.insights?.data?.find((d) => d.name === 'plays')?.values?.[0]?.value
    return {
      url: m.permalink ?? `https://www.instagram.com/p/${m.id}/`,
      title: m.caption?.slice(0, 140) ?? null,
      publishedAt: m.timestamp ?? null,
      views: typeof plays === 'number' ? plays : null,
      likes: typeof m.like_count === 'number' ? m.like_count : null,
      comments: typeof m.comments_count === 'number' ? m.comments_count : null,
      shares: null,
    }
  })
}

export async function instagramComments(
  creds: MetaCredentials,
  mediaId: string,
): Promise<Comment[]> {
  const res = await graph<{ data?: GraphComment[] }>(`${mediaId}/comments`, creds.pageToken, {
    limit: String(COMMENT_LIMIT),
    fields: 'text,username,like_count,timestamp',
  })
  // Instagram names these fields differently from Facebook's.
  const raw = (res.data ?? []) as unknown as {
    text?: string
    username?: string
    like_count?: number
    timestamp?: string
  }[]
  return raw
    .filter((c) => c.text?.trim())
    .map((c) => ({
      text: c.text!.trim(),
      author: c.username ?? null,
      likes: typeof c.like_count === 'number' ? c.like_count : null,
      publishedAt: c.timestamp ?? null,
      isReply: false,
    }))
}
