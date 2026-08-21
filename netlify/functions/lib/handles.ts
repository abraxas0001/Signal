import type { Platform } from '../../../shared/taxonomy'
import { fetchText, fetchJson } from './fetcher'
import { decodeEntities, decodeJsonString, collectKey } from './extract/json-scan'
import { parseHandleUrl } from '../../../shared/handle-url'
import { metaCredentials, whoAmI, facebookPagePosts, instagramMedia } from './meta-graph'
// Value import, not type-only: social-source.ts imports HandlePost from here as
// a TYPE, which erases at build, so this creates no runtime cycle.
import {
  postsForHandle,
  licensedProviderAvailable,
  GATED_PLATFORMS,
  type SourceRoute,
} from './social-source'
import { youtubeFreshToken, youtubeIdentityMatches, youtubeOwnUploads } from './youtube-oauth'
import { linkedinFreshIdentity } from './linkedin-oauth'
import { xFreshIdentity } from './x-oauth'

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
  /**
   * The platform's own id for this post, when the route that produced it had
   * one.
   *
   * Only the credentialed routes do, and it is the difference between being
   * able to ask for a post's comments and not: Graph endpoints are addressed as
   * `<post-id>/comments` and will not accept a permalink. Both Meta readers
   * were already requesting this field and discarding it, so the comment calls
   * beside them could never be used and sat as dead code.
   */
  id?: string | null
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
   *
   * `route` says WHICH of the four ways produced it. A post list read from the
   * platform's own API for a page the office administers and one bought from a
   * reseller are not the same evidence, and a screen that renders them
   * identically is lying by omission. `'none'` is the honest fourth value: no
   * route worked, and the note says which were tried.
   */
  listing: { available: boolean; note: string; route?: SourceRoute }
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
 * A channel's uploads via InnerTube, when the RSS feed comes back empty.
 *
 * The feed is the cheap path and it works from a residential connection. From
 * the deployed server it returns no entries at all, while the channel page
 * beside it answers fine — measured on two channels, both 15 posts locally and
 * 0 in production, with correct follower counts in the same response. So the
 * dashboard showed accounts with a follower count and no posts, and the
 * opinion reader had nothing to read.
 *
 * InnerTube is already proven from that network: it is what fetches comment
 * counts and bodies today. This asks it for the channel's Videos tab instead.
 *
 * It yields the video id, a view count and a relative age, but no like count —
 * the feed's one advantage. Engagement therefore falls back to views where
 * likes are absent, which the caller reports honestly rather than hiding.
 */
async function youtubeUploadsViaInnerTube(channelId: string): Promise<HandlePost[]> {
  const res = await fetchJson<Record<string, unknown>>(
    'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false',
    {
      timeout: 9000,
      json: {
        context: {
          client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en', gl: 'US' },
        },
        browseId: channelId,
        // The Videos tab. Without it the response is the channel's home layout.
        params: 'EgZ2aWRlb3PyBgQKAjoA',
      },
    },
  )
  if (!res.data) return []

  const posts: HandlePost[] = []
  for (const node of collectKey(res.data, 'lockupViewModel', 40) as Record<string, unknown>[]) {
    const id = node['contentId']
    if (typeof id !== 'string' || !/^[\w-]{11}$/.test(id)) continue

    const blob = JSON.stringify(node)
    const title = /"title":\{"content":"([^"]{2,120})"/.exec(blob)?.[1] ?? null
    // The metadata row reads "18K views" then "1 day ago", in that order.
    const parts = [...blob.matchAll(/"content":"([^"]{1,30})"/g)].map((m) => m[1] ?? '')
    const views = parseAbbrev(parts.find((t) => /views?$/i.test(t)) ?? null)
    const age = parts.find((t) => /\bago$/i.test(t)) ?? null

    posts.push({
      url: `https://www.youtube.com/watch?v=${id}`,
      title: decodeJsonString(title),
      publishedAt: relativeToIso(age),
      views,
      // InnerTube's channel listing carries no like count; the feed did.
      likes: null,
      comments: null,
    })
  }
  return posts
}

/**
 * "3 days ago" to a date.
 *
 * Approximate by construction, and used only for posting cadence, where the
 * span between the oldest and newest post is what matters rather than any
 * single date. Returning null instead would suppress cadence entirely.
 */
function relativeToIso(rel: string | null): string | null {
  if (!rel) return null
  const m = /(\d+)\s*(minute|hour|day|week|month|year)/i.exec(rel)
  if (!m?.[1] || !m[2]) return null
  const n = Number(m[1])
  const ms: Record<string, number> = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
    year: 31_536_000_000,
  }
  const unit = ms[m[2].toLowerCase()]
  if (!unit || !Number.isFinite(n)) return null
  return new Date(Date.now() - n * unit).toISOString()
}

/**
 * A channel's recent uploads, from the RSS feed YouTube still publishes.
 *
 * Two requests: the channel page to turn a @handle into the UC… id, then the
 * feed itself. The feed carries title, publish date and — through the MediaRSS
 * extension — view, like and comment counts, so a channel's recent performance
 * arrives without touching a single video page.
 */
/**
 * The office's own channel, via OAuth — exact counts and real comment bodies
 * where the public InnerTube path below carries views but no likes at all.
 *
 * Same shape as `readFacebook`'s credential branch: a connected token only
 * ever authorises the account that signed in, so this fires exclusively for
 * that channel — a rival's handle falls straight through to the public read.
 */
async function readYouTubeOwn(handle: string): Promise<HandleSummary | null> {
  try {
    const fresh = await youtubeFreshToken()
    if (!fresh || !youtubeIdentityMatches(fresh.identity, handle)) return null
    const { accessToken, identity } = fresh
    const posts = identity.uploadsPlaylistId
      ? await youtubeOwnUploads(accessToken, identity.uploadsPlaylistId)
      : []
    return {
      platform: 'YouTube',
      handle,
      displayName: identity.title || null,
      profileUrl: identity.customUrl
        ? `https://www.youtube.com/${identity.customUrl}`
        : `https://www.youtube.com/channel/${identity.channelId}`,
      avatarUrl: null,
      followers: identity.subscribers,
      posts,
      listing: {
        available: posts.length > 0,
        // Read with the office's own OAuth token, so it is first-party — not
        // the 'public' the default at the bottom of readHandle would stamp it.
        route: 'owned',
        note: `${posts.length} uploads through the YouTube Data API, with exact like and comment counts. The InnerTube fallback below carries views but no likes at all.`,
      },
    }
  } catch {
    // A refused or expired token must not take the account down with it — the
    // public read below still works and is what everyone else gets.
    return null
  }
}

async function readYouTube(handle: string): Promise<HandleSummary> {
  const own = await readYouTubeOwn(handle)
  if (own) return own

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

  // The feed is empty from a datacentre while the channel page beside it works,
  // so fall back rather than reporting a busy channel as silent.
  let viaFallback = false
  if (!posts.length) {
    try {
      const alt = await youtubeUploadsViaInnerTube(channelId)
      if (alt.length) {
        posts.push(...alt)
        viaFallback = true
      }
    } catch {
      /* the follower count still stands on its own */
    }
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
      // Say which path produced this, because the two carry different figures
      // and the engagement column goes blank on one of them. An unexplained
      // dash reads as a bug; a stated reason reads as a limit.
      note: !posts.length
        ? 'The channel feed returned no recent uploads.'
        : viaFallback
          ? `${posts.length} recent uploads. YouTube's feed was empty from here, so these came from its browse API, which publishes view counts but no likes, so engagement cannot be worked out for this channel.`
          : `${posts.length} recent uploads from the channel feed, with views and likes.`,
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
            // The office's own Page token. First-party, and authoritative even
            // when it returns nothing: a quiet week on a page we administer is
            // a real answer, and must not be replaced by a reseller's copy.
            route: 'owned',
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
            route: 'owned',
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
        ? 'Instagram publishes this account’s follower count but not its posts, because the timeline needs a login. Analyse individual reels and posts and they will appear here.'
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
// LinkedIn — identity confirmed, posts still gated
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LinkedIn's self-serve OAuth proves who signed in and grants nothing else —
 * reading a Company Page's posts needs LinkedIn's separate, manually reviewed
 * Community Management API. There is no org-page lookup here yet (that call
 * is part of that same gated tier), so an identity-confirmed connection
 * cannot be matched to any ONE company handle with confidence — claiming a
 * match on an unverified handle would risk attaching the office's identity to
 * the wrong page. So this stays honest: every handle gets the same "behind a
 * login" message, with a note naming who is connected when someone is, as
 * context rather than a claim of ownership over this specific page.
 */
async function readLinkedIn(handle: string): Promise<HandleSummary> {
  const profileUrl = `https://www.linkedin.com/company/${handle}/`
  const identity = await linkedinFreshIdentity().catch(() => null)
  const note = identity
    ? `LinkedIn puts a page’s activity behind a login. Your office’s LinkedIn identity is connected as ${identity.name ?? identity.memberId}. Company-page reads will activate automatically once LinkedIn approves this app for post access. Analyse individual posts and they will appear here.`
    : 'LinkedIn puts a page’s activity behind a login. Analyse individual posts and they will appear here.'
  return blank('LinkedIn', handle, profileUrl, note)
}

// ─────────────────────────────────────────────────────────────────────────────
// X / Twitter — identity confirmed, reads gated behind a paid API tier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * X's free API tier has no read access at all, even for your own account —
 * that needs a paid tier, which is a cost decision for the office, not
 * something to assume. So this confirms which X account is connected (the
 * handle itself IS the username, so unlike LinkedIn this can be matched
 * exactly) and stops there. Every other X handle gets the same message this
 * platform got before any of this existed — there is no public account
 * timeline reader for X in this codebase to fall back to.
 */
async function readX(handle: string): Promise<HandleSummary> {
  const clean = handle.replace(/^@/, '')
  const profileUrl = `https://x.com/${clean}`
  const identity = await xFreshIdentity().catch(() => null)
  const mine = identity?.username.toLowerCase() === clean.toLowerCase()
  const note = mine
    ? `Connected as @${identity!.username}. Reading engagement needs a paid X API tier, which is not enabled on this deployment yet. Analyse individual posts and they will appear here.`
    : 'Automatic tracking is not available for this platform. Analyse individual posts and they will appear here.'
  return blank('Twitter/X', clean, profileUrl, note)
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

/** The per-platform readers: owned credentials first, then whatever is public. */
async function readByPlatform(ref: HandleRef): Promise<HandleSummary> {
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
      return readLinkedIn(ref.handle)
    case 'Twitter/X':
      return readX(ref.handle)
    default:
      return blank(
        ref.platform,
        ref.handle,
        '',
        'Automatic tracking is not available for this platform. Analyse individual posts and they will appear here.',
      )
  }
}

/**
 * Read an account by whichever route can actually reach it.
 *
 * `readByPlatform` above already covers two of the three routes in
 * social-source.ts: the OWNED one, where a token proves it belongs to the
 * handle being asked about, and the PUBLIC one. This adds the third.
 *
 * The gap it fills is the one the whole gated half of this product runs into.
 * Facebook returns zero post permalinks to a server under every crawler
 * identity tried; Instagram answers 429; X answers 503; LinkedIn shows an
 * authwall. Those accounts are not private — a person with a browser sees them
 * — but no amount of scraping gets them from a server, so for a rival's page,
 * which no token here will ever authorise, a licensed provider is the only
 * remaining lawful route.
 *
 * Order matters and is deliberate: a real read always wins. The provider is
 * asked ONLY when the platform gated us out entirely, so configuring one never
 * changes an answer that was already obtainable, never spends a paid request on
 * a YouTube channel, and cannot quietly replace first-party data with a
 * reseller's copy of it.
 *
 * `postsForHandle` costs nothing when unconfigured — it returns before any
 * network call — so this is free for every office that never buys a provider,
 * and those offices get its `note` instead: a sentence naming why the account
 * is empty, rather than a zero that reads as "they have not posted".
 */
export async function readHandle(
  ref: HandleRef,
  opts: { licensed?: boolean } = {},
): Promise<HandleSummary> {
  const summary = await readByPlatform(ref)

  // Something was already read. Whether that came from the office's own token
  // or from the open platform, it is first-party and beats a reseller.
  if (summary.posts.length > 0) {
    return { ...summary, listing: { ...summary.listing, route: summary.listing.route ?? 'public' } }
  }

  /**
   * A credentialed reader that answered with nothing is a REAL answer.
   *
   * The office's own Page token reporting an empty week is the definitive
   * word on a page it administers. Falling through to the provider there would
   * pay a reseller to contradict the platform's own API about the office's own
   * account, and could show posts it has since deleted.
   */
  if (summary.listing.route === 'owned') return summary

  // Callers that only want to know an account resolves — the add-account
  // confirmation step — opt out, so adding a handle never waits on a provider.
  if (opts.licensed === false || !GATED_PLATFORMS.has(ref.platform)) {
    return { ...summary, listing: { ...summary.listing, route: summary.listing.route ?? 'none' } }
  }

  const licensed = await postsForHandle({ handle: summary.handle, platform: ref.platform })
  if (licensed.data.length === 0) {
    /**
     * Compose the two notes; do not let the provider's overwrite the reader's.
     *
     * Each gated reader writes a note that its own attempt earned — Instagram
     * saying it was refused this profile, LinkedIn naming the account the
     * office has connected, X saying reads need a paid tier. Replacing all of
     * them with one sentence about data providers reported a transient refusal
     * as a permanent property of the platform, and threw away the result of a
     * network call that had just been paid for in latency.
     *
     * With no provider configured the reader's note stands alone, because the
     * provider's line would then be an advertisement rather than a finding.
     */
    return {
      ...summary,
      listing: {
        ...summary.listing,
        route: 'none',
        note: licensedProviderAvailable()
          ? [summary.listing.note, licensed.note].filter(Boolean).join(' ').trim()
          : summary.listing.note,
      },
    }
  }

  return {
    ...summary,
    posts: licensed.data,
    listing: {
      available: true,
      route: 'licensed',
      note:
        licensed.note ??
        `${licensed.data.length} posts through a licensed data provider. ${ref.platform} publishes none of this to a server directly.`,
    },
  }
}

