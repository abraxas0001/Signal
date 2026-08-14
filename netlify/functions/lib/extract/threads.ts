import type { MediaItem, Metric, PostSnapshot } from '../../../../shared/types'
import type { UrlIdentity } from '../platform'
import { fetchText, ALLOW_CRAWLER_UA, type AgentName } from '../fetcher'
import { parseMetadata } from '../metadata'
import type { ExtractContext, ExtractResult } from './types'

/**
 * Threads.
 *
 * There is no public JSON API, but the post page embeds the complete post
 * object — likes, replies, reposts, quotes, reshares, timestamp, author, media
 * — in a `<script type="application/json">` block. Meta serves that block only
 * to a search-crawler User-Agent: Chrome, an empty UA and facebookexternalhit
 * all get HTTP 200 with the block simply absent.
 *
 * That is the trap this adapter is built around. Every failure mode here is a
 * 200, so nothing branches on the status code; the gate is always "did we find
 * a post object whose `code` matches the one in the URL". Matching on
 * `like_count` alone is not enough either — the page also carries neighbouring
 * posts from the same author, and picking the wrong one produces a confident,
 * completely wrong report.
 *
 * Threads publishes no view count to anyone (`enable_view_counts: false`), so
 * views are reported as unavailable rather than zero.
 */

interface ThreadsUser {
  username?: string
  full_name?: string
  is_verified?: boolean
  profile_pic_url?: string
  pk?: string
}

interface ThreadsPost {
  code?: string
  pk?: string
  taken_at?: number
  like_count?: number
  caption?: { text?: string }
  user?: ThreadsUser
  text_post_app_info?: {
    direct_reply_count?: number
    repost_count?: number
    quote_count?: number
    reshare_count?: number
    is_reply?: boolean
    link_preview_attachment?: { url?: string; title?: string; display_url?: string }
  }
  image_versions2?: { candidates?: Array<{ url?: string; width?: number; height?: number }> }
  video_versions?: Array<{ url?: string; width?: number; height?: number }>
  original_width?: number
  original_height?: number
  carousel_media?: ThreadsPost[]
}

const metric = (v: unknown, source: Metric['source']): Metric =>
  typeof v === 'number' && Number.isFinite(v)
    ? { value: v, source }
    : { value: null, source: 'unavailable' }

const hashtagsOf = (text: string) =>
  [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1] as string)
const mentionsOf = (text: string) =>
  [...text.matchAll(/@([A-Za-z0-9._]{1,30})/g)].map((m) => m[1] as string)
const linksOf = (text: string) => [...text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0])

/**
 * Find the post object for exactly this URL.
 *
 * The page embeds several posts — replies, and other posts by the same author.
 * Only the one whose `code` matches the URL is the subject, so a near-miss is
 * treated as a failure rather than as a best guess.
 */
function findPostByCode(root: unknown, code: string): ThreadsPost | null {
  let found: ThreadsPost | null = null
  const seen = new Set<unknown>()

  const walk = (node: unknown): void => {
    if (found || node === null || typeof node !== 'object') return
    // The blob contains repeated references; without this the walk is
    // quadratic on a 900KB payload.
    if (seen.has(node)) return
    seen.add(node)

    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }

    const obj = node as Record<string, unknown>
    if (obj['code'] === code && typeof obj['like_count'] === 'number') {
      found = obj as ThreadsPost
      return
    }
    for (const value of Object.values(obj)) walk(value)
  }

  walk(root)
  return found
}

function parsePostFromHtml(html: string, code: string): ThreadsPost | null {
  // Only the blocks that mention like_count can hold the post; parsing every
  // JSON island on the page is several megabytes of wasted work.
  const blocks = [...html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1] ?? '')
    .filter((s) => s.includes('like_count'))

  for (const block of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse(block)
    } catch {
      continue
    }
    const post = findPostByCode(parsed, code)
    if (post) return post
  }
  return null
}

function threadsMedia(post: ThreadsPost): MediaItem[] {
  const items = post.carousel_media?.length ? post.carousel_media : [post]
  const out: MediaItem[] = []

  for (const item of items) {
    const video = item.video_versions?.find((v) => v?.url)
    const image = item.image_versions2?.candidates?.find((c) => c?.url)
    if (video?.url) {
      out.push({
        kind: 'video',
        url: video.url,
        thumbnailUrl: image?.url ?? null,
        width: video.width ?? item.original_width ?? null,
        height: video.height ?? item.original_height ?? null,
      })
    } else if (image?.url) {
      out.push({
        kind: 'image',
        url: image.url,
        thumbnailUrl: image.url,
        width: image.width ?? item.original_width ?? null,
        height: image.height ?? item.original_height ?? null,
      })
    }
  }
  return out
}

/**
 * Exact follower count, from the author's profile page.
 *
 * It is not on the post page at all. This costs a second page load, so it is
 * fired in parallel with the post fetch whenever the handle is already in the
 * URL, and skipped entirely when it is not.
 */
async function fetchFollowers(handle: string, agent: AgentName): Promise<number | null> {
  const res = await fetchText(`https://www.threads.com/@${handle}`, { agent, timeout: 8000 })
  const raw = /"follower_count":(\d+)/.exec(res.body)?.[1]
  const n = raw ? Number(raw) : NaN
  return Number.isSafeInteger(n) ? n : null
}

export async function extractThreads(
  id: UrlIdentity,
  _ctx: ExtractContext,
): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = []
  const code = id.id
  const handle = id.handle

  if (!code) {
    return {
      ok: false,
      attempts: [{ strategy: 'threads:parse-url', ok: false, note: 'No post code in the URL' }],
    }
  }

  // threads.net redirects to threads.com; the fetcher follows and re-validates
  // each hop, so either host works from here.
  const postUrl = id.canonical

  // ── 1 & 2. Crawler identities. Two independent operators, so a refusal from
  // one is not a refusal from both.
  //
  // Gated on the same switch as the Meta adapter: Threads' engagement data is
  // reachable only by claiming to be a search crawler, which is exactly the
  // thing ALLOW_CRAWLER_UA exists to let an operator turn off. With it off we
  // skip straight to the link-preview tier and ask the user for the counts.
  let post: ThreadsPost | null = null
  let usedAgent: AgentName = 'google'

  for (const agent of ALLOW_CRAWLER_UA ? (['google', 'bing'] as const) : ([] as const)) {
    const res = await fetchText(postUrl, { agent, timeout: 9000 })
    post = res.ok ? parsePostFromHtml(res.body, code) : null
    attempts.push({
      strategy: `threads:${agent}-crawler`,
      ok: Boolean(post),
      // Saying "200 without the post JSON" is the useful diagnostic here,
      // because that is what a UA gate looks like from the outside.
      note: post
        ? 'likes, replies, reposts, quotes'
        : res.ok
          ? 'HTTP 200 but the post JSON was withheld'
          : `HTTP ${res.status}`,
    })
    if (post) {
      usedAgent = agent
      break
    }
  }

  if (post) {
    const info = post.text_post_app_info ?? {}
    const text = post.caption?.text ?? ''
    const user = post.user ?? {}
    const username = user.username ?? handle ?? null

    const followers = username ? await fetchFollowers(username, usedAgent) : null
    if (username) {
      attempts.push({
        strategy: 'threads:profile-followers',
        ok: followers != null,
        note: followers != null ? `${followers.toLocaleString('en-IN')} followers` : 'not published',
      })
    }

    const snapshot: Partial<PostSnapshot> = {
      platform: 'Threads',
      postType: info.is_reply ? 'Comment' : 'Original Post',
      publishedAt: post.taken_at ? new Date(post.taken_at * 1000).toISOString() : null,
      author: {
        name: user.full_name ?? username,
        handle: username,
        profileUrl: username ? `https://www.threads.com/@${username}` : null,
        avatarUrl: user.profile_pic_url ?? null,
        verified: user.is_verified ?? null,
        followers: metric(followers, 'page-scrape'),
        accountType: 'Unknown',
        declaredLocation: null,
      },
      content: {
        text: text || null,
        title: null,
        languageCode: null,
        languageName: null,
        translation: null,
        transcript: null,
        hashtags: hashtagsOf(text),
        mentions: mentionsOf(text),
        outboundLinks: [info.link_preview_attachment?.url, ...linksOf(text)].filter(
          (l): l is string => Boolean(l),
        ),
      },
      engagement: {
        likes: metric(post.like_count, 'page-scrape'),
        comments: metric(info.direct_reply_count, 'page-scrape'),
        // A repost is Threads' reshare; quotes are counted separately and kept
        // in `extra` rather than folded in, since they are a different act.
        shares: metric(info.repost_count, 'page-scrape'),
        // enable_view_counts is false platform-wide — Threads shows impressions
        // to nobody, so this is "does not exist", not "we could not read it".
        views: { value: null, source: 'unavailable' },
        engagementRate: null,
      },
      media: threadsMedia(post),
    }

    return {
      ok: true,
      snapshot,
      attempts,
      confidence: 'high',
      extra: {
        quotes: info.quote_count ?? null,
        reshares: info.reshare_count ?? null,
        isReply: info.is_reply ?? false,
        linkPreview: info.link_preview_attachment?.title ?? null,
      },
    }
  }

  // ── 3. Link-preview tags. No counts, but this is the surface Meta has to
  // keep working for every share of a Threads link, so it is the durable one.
  const og = await fetchText(postUrl, {
    agent: ALLOW_CRAWLER_UA ? 'facebook' : 'browser',
    timeout: 8000,
  })
  const meta = og.ok ? parseMetadata(og.body, og.url) : null
  const ogText = meta?.description ?? meta?.title ?? null

  attempts.push({
    strategy: 'threads:link-preview',
    ok: Boolean(ogText),
    note: ogText ? 'text + author only, no counts' : `HTTP ${og.status}`,
  })

  if (ogText) {
    return {
      ok: true,
      attempts,
      confidence: 'low',
      blocked: {
        reason: 'Threads returned the post text but withheld its engagement counts.',
        suggestion:
          'The like and reply counts are visible on the post itself — type them in below and the report will use them.',
      },
      snapshot: {
        platform: 'Threads',
        postType: 'Original Post',
        publishedAt: meta?.publishedAt ?? null,
        author: {
          name: meta?.author ?? (handle ? `@${handle}` : null),
          handle,
          profileUrl: handle ? `https://www.threads.com/@${handle}` : null,
          avatarUrl: null,
          verified: null,
          followers: { value: null, source: 'unavailable' },
          accountType: 'Unknown',
          declaredLocation: null,
        },
        content: {
          text: ogText,
          title: meta?.title ?? null,
          languageCode: null,
          languageName: null,
          translation: null,
          transcript: null,
          hashtags: hashtagsOf(ogText),
          mentions: mentionsOf(ogText),
          outboundLinks: linksOf(ogText),
        },
        engagement: {
          likes: { value: null, source: 'unavailable' },
          comments: { value: null, source: 'unavailable' },
          shares: { value: null, source: 'unavailable' },
          views: { value: null, source: 'unavailable' },
          engagementRate: null,
        },
        media: meta?.image ? [{ kind: 'image', url: meta.image, thumbnailUrl: meta.image }] : [],
      },
    }
  }

  return {
    ok: false,
    attempts,
    blocked: {
      reason: 'Threads did not return this post to a server-side request.',
      suggestion:
        'The post may be from a private account or deleted. Paste its text below and we will analyse that.',
    },
  }
}
