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

/**
 * Everything wrong with a token, named.
 *
 * The most error-prone step in setting this up is not obtaining a token — it is
 * obtaining the WRONG one, and every wrong one fails identically from the
 * outside. There are four distinct mistakes and a single "Meta refused it"
 * tells an operator which of them they made: none.
 *
 *   a User token instead of a Page token — the commonest by a distance,
 *     because Graph Explorer hands you one by default and it looks the same
 *   a Page token for the wrong Page, on an account that administers several
 *   a token missing pages_read_engagement, which reads posts but no comments
 *   a short-lived token, which works for about an hour and then stops,
 *     usually after the operator has closed the tab and moved on
 *
 * So this asks Meta what the token actually is, rather than only whether it
 * works right now. `debug_token` is the endpoint that answers it, and it takes
 * the token as its own inspector — no app secret needed, which matters because
 * this deployment does not have one and should not need one to tell somebody
 * their token expires this afternoon.
 */
export interface TokenReport {
  ok: boolean
  /**
   * Granted scopes that can change or delete things.
   *
   * Not a failure — it is their page and their choice. But a monitoring tool
   * holding delete-a-comment rights is worth saying out loud, because nobody
   * ticks those deliberately; they come from copying a permissions list.
   */
  writeScopes: string[]
  /** 'PAGE' when correct. 'USER' is the commonest mistake. */
  type: string | null
  /** The page this token authorises, which may not be the one they meant. */
  page: { id: string; name: string; followers: number | null } | null
  scopes: string[]
  missingScopes: string[]
  /** Null when the token never expires, which is what we want. */
  expiresAt: string | null
  /** True when it expires soon enough to be about to break. */
  expiringSoon: boolean
  /** What to do, in plain words. Empty when nothing is wrong. */
  problems: string[]
}

/**
 * The permissions this app genuinely uses, and what each one buys.
 *
 * The distinction between the two "read" scopes is easy to get wrong and I did:
 *
 *   pages_read_engagement  — content posted BY THE PAGE, plus follower data and
 *                            metadata. This is the Page talking.
 *   pages_read_user_content — content posted BY USERS on the Page: their posts,
 *                            their COMMENTS, their ratings. This is the public
 *                            talking, which is the entire point of this product.
 *
 * A token holding only the first reads a page's own output and returns an empty
 * comment array — indistinguishable, from every screen, from a page nobody has
 * commented on. So the second is required, not optional, and its absence is
 * reported as a problem rather than passing silently.
 *
 * Nothing that writes is requested. pages_manage_posts and
 * pages_manage_engagement can create, edit and DELETE posts and comments, and a
 * media-monitoring tool has no business holding either — a bug in this codebase
 * should never be able to delete a constituent's comment.
 */
const REQUIRED_SCOPES: { name: string; why: string }[] = [
  { name: 'pages_read_user_content', why: 'reading the comments your constituents leave' },
  { name: 'pages_read_engagement', why: 'reading your own posts and follower counts' },
  { name: 'pages_show_list', why: 'confirming which page the token belongs to' },
]

/**
 * Scopes that let this app change things, which it must never need.
 *
 * Held separately from a missing-scope problem because it is the opposite kind
 * of finding: not "you have too little access" but "you have granted more than
 * this tool should hold". Reported, never enforced — it is the operator's page.
 */
const WRITE_SCOPES = [
  'pages_manage_posts',
  'pages_manage_engagement',
  'pages_manage_metadata',
  'pages_manage_ads',
]

export async function inspectToken(creds: MetaCredentials): Promise<TokenReport> {
  const problems: string[] = []

  let debug: {
    type?: string
    scopes?: string[]
    expires_at?: number
    is_valid?: boolean
    profile_id?: string
  } = {}

  try {
    const res = await graph<{ data?: typeof debug }>('debug_token', creds.pageToken, {
      input_token: creds.pageToken,
    })
    debug = res.data ?? {}
  } catch (err) {
    return {
      ok: false,
      writeScopes: [],
      type: null,
      page: null,
      scopes: [],
      missingScopes: REQUIRED_SCOPES.map((s) => s.name),
      expiresAt: null,
      expiringSoon: false,
      problems: [
        `Meta would not inspect this token: ${
          err instanceof Error ? err.message : 'unknown error'
        }. It is probably expired, or was copied incompletely.`,
      ],
    }
  }

  const scopes = Array.isArray(debug.scopes) ? debug.scopes : []
  const missingScopes = REQUIRED_SCOPES.filter((s) => !scopes.includes(s.name)).map((s) => s.name)

  // 0 means it never expires, which is what a long-lived Page token looks like.
  const expiresAt =
    typeof debug.expires_at === 'number' && debug.expires_at > 0
      ? new Date(debug.expires_at * 1000).toISOString()
      : null
  const expiringSoon =
    expiresAt !== null && Date.parse(expiresAt) - Date.now() < 7 * 24 * 60 * 60 * 1000

  /* the four mistakes, each named */

  if (debug.type && debug.type.toUpperCase() !== 'PAGE') {
    problems.push(
      `This is a ${debug.type} token, not a Page token. Graph API Explorer gives you a User token by default — use its "Get Page Access Token" option and pick the page, or the comment calls will keep being refused.`,
    )
  }

  for (const scope of REQUIRED_SCOPES) {
    if (!scopes.includes(scope.name)) {
      problems.push(
        `Missing the ${scope.name} permission, which is what authorises ${scope.why}. Re-issue the token with it ticked.`,
      )
    }
  }

  if (expiringSoon && expiresAt) {
    problems.push(
      `This token expires ${new Date(expiresAt).toUTCString()}. Short-lived tokens last about an hour — exchange it for a long-lived one at developers.facebook.com/tools/debug/accesstoken, or this stops working today.`,
    )
  }

  if (debug.is_valid === false) {
    problems.push('Meta reports this token as no longer valid. Issue a new one.')
  }

  /* and which page it actually is, which is the other half of "wrong token" */

  let page: TokenReport['page'] = null
  try {
    const me = await whoAmI(creds)
    page = me
  } catch (err) {
    problems.push(
      `The token could not name its own page: ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    )
  }

  const writable = WRITE_SCOPES.filter((w) => scopes.includes(w))

  return {
    ok: problems.length === 0 && page !== null,
    writeScopes: writable,
    type: debug.type ?? null,
    page,
    scopes,
    missingScopes,
    expiresAt,
    expiringSoon,
    problems,
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
      // Kept, so the comments on this post can actually be asked for.
      id: p.id ?? null,
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
      id: m.id ?? null,
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
