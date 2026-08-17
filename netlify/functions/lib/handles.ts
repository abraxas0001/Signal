import type { Platform } from '../../../shared/taxonomy'
import { fetchText, fetchJson } from './fetcher'
import { decodeEntities } from './extract/json-scan'
import { parseHandleUrl } from '../../../shared/handle-url'
import { metaCredentials, whoAmI, facebookPagePosts, instagramMedia } from './meta-graph'

/**
 * Reading an ACCOUNT rather than a post.
 *
 * The rest of this codebase answers "what does this post say". A dashboard asks
 * a different question — "what has this account been doing" — and that turns out
 * to be the harder one, because listing an account's posts is exactly what the
 * platforms gate.
 *
 * Measured, from a residential connection, on real accounts:
 *
 *   YouTube    15 recent videos   channel RSS, keyless
 *   Bluesky    20 recent posts    documented public API
 *   Mastodon   20 recent posts    public outbox
 *   Facebook   0 post permalinks  under all four crawler identities, on a 4.9MB page
 *   Instagram  HTTP 429           on two accounts, after a 90s wait
 *   LinkedIn   partial            behind an auth wall
 *
 * So this module covers the four that can be enumerated and is explicit about
 * the rest. A handle on a gated platform is not a failure and is not hidden —
 * it reports what it can (Facebook publishes a follower count through its own
 * embed widget) and says plainly that the post list needs links pasted in.
 *
 * Nothing here calls a model. A dashboard needs counts, and counts come from
 * extraction alone at about two seconds a platform; running an LLM over every
 * post of every handle would take a quarter of an hour per refresh.
 */

export interface HandlePost {
  url: string
  title: string | null
  publishedAt: string | null
  views: number | null
  likes: number | null
  comments: number | null
  /**
   * Shares. Only the Graph API supplies this — the public Facebook page
   * carries no share count on a reel at all, and no post list to hang one on.
   */
  shares?: number | null
}

export interface HandleSummary {
  platform: Platform
  handle: string
  displayName: string | null
  profileUrl: string
  avatarUrl: string | null
  followers: number | null
  /** Recent posts, newest first. Empty when the platform does not publish a list. */
  posts: HandlePost[]
  /**
   * How the post list was obtained, or why there isn't one. Shown to the user
   * verbatim — a dashboard that silently shows nothing for Instagram would read
   * as "this account is quiet", which is a different and false claim.
   */
  listing: { available: boolean; note: string }
}


// ─────────────────────────────────────────────────────────────────────────────
// Handle parsing
// ─────────────────────────────────────────────────────────────────────────────

import type { HandleRef } from '../../../shared/handle-url'
export type { HandleRef }

/**
 * Which account a user means, from a profile URL or a bare handle.
 *
 * The parsing lives in `shared/handle-url.ts` so the browser reaches the same
 * verdict. It used to exist only here, and the client guessed from a dropdown
 * instead — which meant a Facebook link added while the picker said YouTube was
 * filed as YouTube and collided with the YouTube entry for the same person.
 */
export const parseHandle = parseHandleUrl

// ─────────────────────────────────────────────────────────────────────────────
// YouTube
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A channel's recent uploads, from the RSS feed YouTube still publishes.
 *
 * Two requests: the channel page to turn a @handle into the UC… id, then the
 * feed itself. The feed carries title, publish date and — through the MediaRSS
 * extension — view, like and comment counts, so a channel's recent performance
 * arrives without touching a single video page.
 */
async function readYouTube(handle: string): Promise<HandleSummary> {
  const isChannelId = /^UC[\w-]{20,}$/.test(handle)
  const profileUrl = isChannelId
    ? `https://www.youtube.com/channel/${handle}`
    : `https://www.youtube.com/${handle.startsWith('@') ? handle : `@${handle}`}`

  let channelId = isChannelId ? handle : null
  let displayName: string | null = null
  let avatarUrl: string | null = null
  let followers: number | null = null

  if (!channelId) {
    const page = await fetchText(profileUrl, { agent: 'browser', timeout: 9000 })
    channelId =
      /channel_id=(UC[\w-]{20,})/.exec(page.body)?.[1] ??
      /"externalId":"(UC[\w-]{20,})"/.exec(page.body)?.[1] ??
      /"browseId":"(UC[\w-]{20,})"/.exec(page.body)?.[1] ??
      null
    displayName = decodeEntities(
      /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/.exec(page.body)?.[1] ?? null,
    )
    avatarUrl = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/.exec(page.body)?.[1] ?? null
    // Anchored to the channel's OWN header, never to the first "N subscribers"
    // on the page.
    //
    // A channel page carries the subscriber counts of every recommended
    // channel in its sidebar. Narendra Modi's page contains six of them — 2.2M,
    // 6.4M, 79.8K, 40.5K, 3.31K and 31.3M — and an unanchored first match
    // returned 2.2M, which belongs to someone else. Two different channels then
    // reported the identical follower count, and every engagement rate computed
    // from it was wrong: the whole comparison is a ratio against this number.
    //
    // pageHeaderRenderer and contentMetadataViewModel are the channel's own
    // header. There is deliberately no unanchored fallback — a missing follower
    // count shows as "—" and suppresses the rate, which is recoverable. A
    // confident wrong one is not.
    const subs =
      /"pageHeaderRenderer":[\s\S]{0,4000}?([\d.,]+\s*[KMB]?)\s+subscribers/i.exec(page.body)?.[1] ??
      /"contentMetadataViewModel"[\s\S]{0,1500}?([\d.,]+\s*[KMB]?)\s+subscribers/i.exec(page.body)?.[1] ??
      /"subscriberCountText":\{"simpleText":"([^"]+)"/.exec(page.body)?.[1] ??
      null
    followers = parseAbbrev(subs)
  }

  if (!channelId) {
    return {
      platform: 'YouTube',
      handle,
      displayName,
      profileUrl,
      avatarUrl,
      followers,
      posts: [],
      listing: { available: false, note: 'Could not resolve this channel. Check the handle.' },
    }
  }

  const rss = await fetchText(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
    { agent: 'browser', timeout: 8000 },
  )

  const posts: HandlePost[] = []
  for (const entry of rss.body.split('<entry>').slice(1)) {
    const id = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(entry)?.[1]
    if (!id) continue
    posts.push({
      url: `https://www.youtube.com/watch?v=${id}`,
      title: decodeEntities(/<title>([^<]*)<\/title>/.exec(entry)?.[1] ?? null),
      publishedAt: /<published>([^<]+)<\/published>/.exec(entry)?.[1] ?? null,
      views: num(/<media:statistics views="(\d+)"/.exec(entry)?.[1]),
      likes: num(/<media:starRating[^>]+count="(\d+)"/.exec(entry)?.[1]),
      comments: null,
    })
  }

  displayName ??= decodeEntities(/<title>([^<]*)<\/title>/.exec(rss.body)?.[1] ?? null)

  return {
    platform: 'YouTube',
    handle,
    displayName,
    profileUrl,
    avatarUrl,
    followers,
    posts,
    listing: {
      available: posts.length > 0,
      note: posts.length
        ? `${posts.length} recent uploads from the channel feed.`
        : 'The channel feed returned no recent uploads.',
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bluesky
// ─────────────────────────────────────────────────────────────────────────────

const BSKY = 'https://public.api.bsky.app/xrpc'

async function readBluesky(handle: string): Promise<HandleSummary> {
  const actor = handle.replace(/^@/, '')

  const [profile, feed] = await Promise.all([
    fetchJson<Record<string, unknown>>(
      `${BSKY}/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`,
      { timeout: 8000 },
    ),
    fetchJson<{ feed?: Array<{ post?: Record<string, unknown> }> }>(
      `${BSKY}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=20`,
      { timeout: 9000 },
    ),
  ])

  const p = profile.data ?? {}
  const posts: HandlePost[] = []
  for (const item of feed.data?.feed ?? []) {
    const post = item.post
    if (!post) continue
    const uri = String(post['uri'] ?? '')
    const rkey = uri.split('/').pop()
    const record = post['record'] as Record<string, unknown> | undefined
    if (!rkey) continue
    posts.push({
      url: `https://bsky.app/profile/${actor}/post/${rkey}`,
      title: typeof record?.['text'] === 'string' ? (record['text'] as string).slice(0, 140) : null,
      publishedAt: typeof record?.['createdAt'] === 'string' ? (record['createdAt'] as string) : null,
      views: null,
      likes: typeof post['likeCount'] === 'number' ? (post['likeCount'] as number) : null,
      comments: typeof post['replyCount'] === 'number' ? (post['replyCount'] as number) : null,
    })
  }

  return {
    platform: 'Bluesky',
    handle: actor,
    displayName: typeof p['displayName'] === 'string' ? (p['displayName'] as string) : null,
    profileUrl: `https://bsky.app/profile/${actor}`,
    avatarUrl: typeof p['avatar'] === 'string' ? (p['avatar'] as string) : null,
    followers: typeof p['followersCount'] === 'number' ? (p['followersCount'] as number) : null,
    posts,
    listing: {
      available: posts.length > 0,
      note: `${posts.length} recent posts from the public author feed.`,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mastodon
// ─────────────────────────────────────────────────────────────────────────────

async function readMastodon(handle: string): Promise<HandleSummary> {
  // Stored as @user@instance by parseHandle.
  const m = /^@?([^@]+)@(.+)$/.exec(handle)
  const user = m?.[1]
  const host = m?.[2]
  const profileUrl = host ? `https://${host}/@${user}` : ''

  if (!user || !host) {
    return blank('Mastodon', handle, profileUrl, 'Handle must look like @user@instance.')
  }

  const lookup = await fetchJson<Record<string, unknown>>(
    `https://${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`,
    { timeout: 8000 },
  )
  const acct = lookup.data
  const id = acct?.['id']
  if (!acct || typeof id !== 'string') {
    return blank('Mastodon', handle, profileUrl, 'That account was not found on this instance.')
  }

  const statuses = await fetchJson<Array<Record<string, unknown>>>(
    `https://${host}/api/v1/accounts/${id}/statuses?limit=20&exclude_replies=true`,
    { timeout: 9000 },
  )

  const posts: HandlePost[] = (statuses.data ?? []).map((s) => ({
    url: typeof s['url'] === 'string' ? (s['url'] as string) : profileUrl,
    title: String(s['content'] ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140),
    publishedAt: typeof s['created_at'] === 'string' ? (s['created_at'] as string) : null,
    views: null,
    likes: typeof s['favourites_count'] === 'number' ? (s['favourites_count'] as number) : null,
    comments: typeof s['replies_count'] === 'number' ? (s['replies_count'] as number) : null,
  }))

  return {
    platform: 'Mastodon',
    handle,
    displayName: typeof acct['display_name'] === 'string' ? (acct['display_name'] as string) : null,
    profileUrl,
    avatarUrl: typeof acct['avatar'] === 'string' ? (acct['avatar'] as string) : null,
    followers: typeof acct['followers_count'] === 'number' ? (acct['followers_count'] as number) : null,
    posts,
    listing: { available: posts.length > 0, note: `${posts.length} recent posts from the public timeline.` },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Facebook — followers only, and honest about it
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Facebook publishes a page's follower count through its own embed widget, and
 * nothing else we can reach. The page itself carries no post permalinks at all:
 * measured at zero across googlebot, facebookexternalhit, Twitterbot and a
 * browser identity, on a 4.9MB response.
 */
async function readFacebook(handle: string): Promise<HandleSummary> {
  const profileUrl = `https://www.facebook.com/${handle}`
  let followers: number | null = null
  let displayName: string | null = null

  // A page token authorises exactly one page, so this only fires for the page
  // it belongs to — a rival's handle falls straight through to the public read.
  // That is the boundary, and it is Meta's, not a policy choice here.
  const creds = metaCredentials()
  if (creds) {
    try {
      const me = await whoAmI(creds)
      const mine =
        me.id === handle ||
        me.name.toLowerCase() === handle.toLowerCase() ||
        handle.toLowerCase() === me.name.replace(/\s+/g, '').toLowerCase()
      if (mine) {
        const posts = await facebookPagePosts(creds)
        return {
          platform: 'Facebook',
          handle,
          displayName: me.name || null,
          profileUrl,
          avatarUrl: null,
          followers: me.followers,
          posts,
          listing: {
            available: posts.length > 0,
            note: `${posts.length} posts through the Graph API, with shares and reel plays the public page does not publish.`,
          },
        }
      }
    } catch {
      // A refused or expired token must not take the account down with it —
      // the public read still works and is what everyone else gets.
    }
  }

  try {
    const res = await fetchText(
      `https://www.facebook.com/plugins/page.php?show_facepile=false&href=${encodeURIComponent(profileUrl)}`,
      { agent: 'browser', timeout: 7000, headers: { 'Accept-Language': 'en-US,en;q=0.9' } },
    )
    const raw = /([\d][\d,]*)\s+followers\b/i.exec(res.body)?.[1]
    if (raw) {
      const n = Number(raw.replace(/,/g, ''))
      if (Number.isSafeInteger(n)) followers = n
    }
    displayName = decodeEntities(
      /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/.exec(res.body)?.[1] ?? null,
    )
  } catch {
    /* the follower count is a bonus, not the point */
  }

  return {
    platform: 'Facebook',
    handle,
    displayName,
    profileUrl,
    avatarUrl: null,
    followers,
    posts: [],
    listing: {
      available: false,
      note: 'Facebook does not publish a page’s post list to anyone without a login, so posts cannot be pulled automatically. Analyse individual posts and they will appear here.',
    },
  }
}

/**
 * Instagram: the follower count, which is the one thing it will part with.
 *
 * The profile page answers a browser with a 593KB shell containing nothing, and
 * the private API answers a server with 429 — measured on two accounts after a
 * 90-second wait. Googlebot gets a 703KB page that states the follower count in
 * plain text. No post list at any of them: zero shortcodes under every identity
 * tried, so the timeline genuinely is not available.
 *
 * The count appears twice on the page and both copies must agree before it is
 * used. That guard is not theoretical — the equivalent YouTube read took the
 * first of six "N subscribers" on a channel page and returned a sidebar
 * channel's figure, which then became the denominator of every engagement rate.
 */
async function readInstagram(handle: string): Promise<HandleSummary> {
  const user = handle.replace(/^@/, '')
  const profileUrl = `https://www.instagram.com/${user}/`
  let followers: number | null = null

  // The largest difference a token makes anywhere in this product: the public
  // path yields a follower count and literally nothing else for Instagram.
  const creds = metaCredentials()
  if (creds?.igUserId) {
    try {
      const posts = await instagramMedia(creds)
      if (posts.length) {
        return {
          platform: 'Instagram',
          handle: user,
          displayName: null,
          profileUrl,
          avatarUrl: null,
          followers: null,
          posts,
          listing: {
            available: true,
            note: `${posts.length} posts through the Graph API, including reel plays. The public path gives none of this.`,
          },
        }
      }
    } catch {
      /* fall through to the public follower count */
    }
  }

  try {
    const res = await fetchText(profileUrl, {
      agent: 'google',
      timeout: 9000,
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    })
    const found = [...res.body.matchAll(/([\d.,]+\s*[KMB]?)\s+followers/gi)].map((m) =>
      parseAbbrev(m[1] ?? null),
    )
    const distinct = [...new Set(found.filter((n): n is number => n != null))]
    // One agreed value, or nothing. Two different numbers on the page means we
    // cannot tell which is the profile's, and a guess here is a wrong ratio.
    if (distinct.length === 1) followers = distinct[0] ?? null
  } catch {
    /* the count is a bonus; its absence is reported below, not thrown */
  }

  return {
    platform: 'Instagram',
    handle: user,
    displayName: null,
    profileUrl,
    avatarUrl: null,
    followers,
    posts: [],
    listing: {
      available: false,
      note: followers
        ? 'Instagram publishes this account’s follower count but not its posts — the timeline needs a login. Analyse individual reels and posts and they will appear here.'
        : 'Instagram refused this profile. Analyse individual reels and posts and they will appear here.',
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Instagram / LinkedIn — gated
// ─────────────────────────────────────────────────────────────────────────────

function blank(platform: Platform, handle: string, profileUrl: string, note: string): HandleSummary {
  return {
    platform,
    handle,
    displayName: null,
    profileUrl,
    avatarUrl: null,
    followers: null,
    posts: [],
    listing: { available: false, note },
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function num(v: string | undefined): number | null {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** "1.9M subscribers" / "1.9Cr" → a number, or null when it is not parseable. */
function parseAbbrev(raw: string | null): number | null {
  if (!raw) return null
  const m = /([\d.,]+)\s*(K|M|B|thousand|lakh|crore)?/i.exec(raw.replace(/,/g, ''))
  if (!m?.[1]) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const mult: Record<string, number> = {
    k: 1e3,
    m: 1e6,
    b: 1e9,
    thousand: 1e3,
    lakh: 1e5,
    crore: 1e7,
  }
  return Math.round(n * (mult[(m[2] ?? '').toLowerCase()] ?? 1))
}

export async function readHandle(ref: HandleRef): Promise<HandleSummary> {
  switch (ref.platform) {
    case 'YouTube':
      return readYouTube(ref.handle)
    case 'Bluesky':
      return readBluesky(ref.handle)
    case 'Mastodon':
      return readMastodon(ref.handle)
    case 'Facebook':
      return readFacebook(ref.handle)
    case 'Instagram':
      return readInstagram(ref.handle)
    case 'LinkedIn':
      return blank(
        'LinkedIn',
        ref.handle,
        `https://www.linkedin.com/in/${ref.handle}/`,
        'LinkedIn puts a profile’s activity behind a login. Analyse individual posts and they will appear here.',
      )
    default:
      return blank(
        ref.platform,
        ref.handle,
        '',
        'Automatic tracking is not available for this platform. Analyse individual posts and they will appear here.',
      )
  }
}

