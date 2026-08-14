import type { MediaItem, Metric, PostSnapshot } from '../../../../shared/types'
import type { UrlIdentity } from '../platform'
import { fetchJson } from '../fetcher'
import type { ExtractContext, ExtractResult } from './types'

/**
 * Twitter/X adapter.
 *
 * X's paid API is out of scope, so this runs a three-leg fallback chain that
 * was validated live against the workbook's own tweet links:
 *
 *   1. fxtwitter   — the only free source with retweets, quotes AND views
 *   2. vxtwitter   — independent operator, so a genuine failover not a
 *                    correlated one; likes/replies/retweets, no views
 *   3. syndication — X's own CDN, the most durable leg, but deliberately
 *                    crippled: likes and replies only
 *
 * Every leg needs an explicit User-Agent — Node's default gets 401/400/403.
 * Missing metrics stay `null` and are never coerced to 0: "we could not read
 * retweets" and "this post has no retweets" are different facts.
 */

const UA = 'Signal/1.0 (+https://github.com/signal-analyzer)'

const metric = (v: unknown, source: Metric['source']): Metric =>
  typeof v === 'number' && Number.isFinite(v)
    ? { value: v, source }
    : { value: null, source: 'unavailable' }

interface FxTweet {
  code?: number
  tweet?: {
    id?: string
    url?: string
    text?: string
    created_at?: string
    lang?: string
    source?: string
    likes?: number
    replies?: number
    retweets?: number
    quotes?: number
    views?: number | null
    bookmarks?: number
    possibly_sensitive?: boolean
    community_note?: string | null
    author?: {
      name?: string
      screen_name?: string
      followers?: number
      description?: string
      location?: string
      avatar_url?: string
      url?: string
      verification?: { verified?: boolean; type?: string }
    }
    media?: {
      all?: Array<{
        type?: string
        url?: string
        thumbnail_url?: string
        width?: number
        height?: number
        duration?: number
        altText?: string
      }>
    }
  }
}

interface VxTweet {
  text?: string
  likes?: number
  replies?: number
  retweets?: number
  date?: string
  date_epoch?: number
  lang?: string
  hashtags?: string[]
  tweetURL?: string
  user_name?: string
  user_screen_name?: string
  user_profile_image_url?: string
  media_extended?: Array<{
    type?: string
    url?: string
    thumbnail_url?: string
    duration_millis?: number
    altText?: string
    size?: { width?: number; height?: number }
  }>
}

interface SyndTweet {
  text?: string
  favorite_count?: number
  conversation_count?: number
  created_at?: string
  lang?: string
  user?: {
    name?: string
    screen_name?: string
    is_blue_verified?: boolean
    verified?: boolean
    profile_image_url_https?: string
  }
  photos?: Array<{ url?: string; width?: number; height?: number }>
  video?: { poster?: string; durationMs?: number }
  mediaDetails?: Array<{ media_url_https?: string; type?: string }>
}

const hashtagsOf = (text: string) =>
  [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1] as string)
const mentionsOf = (text: string) =>
  [...text.matchAll(/@([A-Za-z0-9_]{1,15})/g)].map((m) => m[1] as string)
const linksOf = (text: string) => [...text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0])

export async function extractTwitter(
  id: UrlIdentity,
  _ctx: ExtractContext,
): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = []
  const tweetId = id.id

  if (!tweetId) {
    return {
      ok: false,
      attempts: [{ strategy: 'twitter:parse-id', ok: false, note: 'No status id in the URL' }],
    }
  }

  const headers = { 'User-Agent': UA }

  // ── 1. fxtwitter — full metric set ────────────────────────────────────────
  const fx = await fetchJson<FxTweet>(`https://api.fxtwitter.com/status/${tweetId}`, {
    headers,
    timeout: 7000,
  })

  const t = fx.data?.tweet
  const fxOk = fx.data?.code === 200 && Boolean(t)
  attempts.push({
    strategy: 'twitter:fxtwitter',
    ok: fxOk,
    note: fxOk ? 'likes, replies, retweets, quotes, views, followers' : `HTTP ${fx.status}`,
  })

  if (fxOk && t) {
    const text = t.text ?? ''
    const media: MediaItem[] = (t.media?.all ?? []).map((m) => ({
      kind: m.type === 'video' || m.type === 'gif' ? 'video' : 'image',
      url: m.url ?? '',
      thumbnailUrl: m.thumbnail_url ?? null,
      width: m.width ?? null,
      height: m.height ?? null,
      durationSeconds: m.duration ?? null,
      alt: m.altText ?? null,
    }))

    const likes = metric(t.likes, 'public-endpoint')
    const comments = metric(t.replies, 'public-endpoint')
    const shares = metric(t.retweets, 'public-endpoint')
    const views = metric(t.views, 'public-endpoint')

    const interactions =
      (likes.value ?? 0) + (comments.value ?? 0) + (shares.value ?? 0) + (t.quotes ?? 0)

    const snapshot: Partial<PostSnapshot> = {
      platform: 'Twitter/X',
      postType: 'Original Post',
      publishedAt: t.created_at ?? null,
      author: {
        name: t.author?.name ?? null,
        handle: t.author?.screen_name ?? null,
        profileUrl: t.author?.screen_name ? `https://x.com/${t.author.screen_name}` : null,
        avatarUrl: t.author?.avatar_url ?? null,
        verified: t.author?.verification?.verified ?? null,
        followers: metric(t.author?.followers, 'public-endpoint'),
        accountType: 'Unknown',
        declaredLocation: t.author?.location ?? null,
      },
      content: {
        text,
        title: null,
        languageCode: t.lang ?? null,
        languageName: null,
        translation: null,
        transcript: null,
        hashtags: hashtagsOf(text),
        mentions: mentionsOf(text),
        outboundLinks: linksOf(text),
      },
      engagement: {
        likes,
        comments,
        shares,
        views,
        engagementRate: views.value ? interactions / views.value : null,
      },
      media,
    }

    return {
      ok: true,
      snapshot,
      attempts,
      confidence: 'high',
      extra: {
        quotes: t.quotes ?? null,
        bookmarks: t.bookmarks ?? null,
        communityNote: t.community_note ?? null,
        possiblySensitive: t.possibly_sensitive ?? false,
        authorBio: t.author?.description ?? null,
      },
    }
  }

  // ── 2. vxtwitter — independent failover, no views/quotes ──────────────────
  const vx = await fetchJson<VxTweet>(`https://api.vxtwitter.com/i/status/${tweetId}`, {
    headers,
    timeout: 7000,
  })
  const v = vx.data
  const vxOk = Boolean(v?.text || v?.tweetURL)
  attempts.push({
    strategy: 'twitter:vxtwitter',
    ok: vxOk,
    note: vxOk ? 'likes, replies, retweets — views unavailable' : `HTTP ${vx.status}`,
  })

  if (vxOk && v) {
    const text = v.text ?? ''
    return {
      ok: true,
      attempts,
      confidence: 'medium',
      snapshot: {
        platform: 'Twitter/X',
        postType: 'Original Post',
        publishedAt: v.date ?? null,
        author: {
          name: v.user_name ?? null,
          handle: v.user_screen_name ?? null,
          profileUrl: v.user_screen_name ? `https://x.com/${v.user_screen_name}` : null,
          avatarUrl: v.user_profile_image_url ?? null,
          verified: null,
          followers: { value: null, source: 'unavailable' },
          accountType: 'Unknown',
          declaredLocation: null,
        },
        content: {
          text,
          title: null,
          languageCode: v.lang ?? null,
          languageName: null,
          translation: null,
          transcript: null,
          hashtags: v.hashtags?.length ? v.hashtags : hashtagsOf(text),
          mentions: mentionsOf(text),
          outboundLinks: linksOf(text),
        },
        engagement: {
          likes: metric(v.likes, 'public-endpoint'),
          comments: metric(v.replies, 'public-endpoint'),
          shares: metric(v.retweets, 'public-endpoint'),
          views: { value: null, source: 'unavailable' },
          engagementRate: null,
        },
        media: (v.media_extended ?? []).map((m) => ({
          kind: m.type === 'video' || m.type === 'gif' ? 'video' : 'image',
          url: m.url ?? '',
          thumbnailUrl: m.thumbnail_url ?? null,
          width: m.size?.width ?? null,
          height: m.size?.height ?? null,
          durationSeconds: m.duration_millis ? Math.round(m.duration_millis / 1000) : null,
          alt: m.altText ?? null,
        })),
      },
    }
  }

  // ── 3. X's own syndication CDN — likes + replies only, but most durable ───
  // The token is not validated; any non-empty value works. Omitting it returns
  // HTTP 200 with an empty object, so we check for real keys rather than status.
  const syn = await fetchJson<SyndTweet>(
    `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=a`,
    { headers, timeout: 7000 },
  )
  const s = syn.data
  const synOk = Boolean(s && Object.keys(s).length > 0 && (s.text || s.user))
  attempts.push({
    strategy: 'twitter:syndication',
    ok: synOk,
    note: synOk ? 'likes + replies only' : `HTTP ${syn.status}`,
  })

  if (synOk && s) {
    const text = s.text ?? ''
    const media: MediaItem[] = [
      ...(s.photos ?? []).map((p) => ({
        kind: 'image' as const,
        url: p.url ?? '',
        thumbnailUrl: p.url ?? null,
        width: p.width ?? null,
        height: p.height ?? null,
      })),
      ...(s.video?.poster
        ? [
            {
              kind: 'video' as const,
              url: s.video.poster,
              thumbnailUrl: s.video.poster,
              durationSeconds: s.video.durationMs ? Math.round(s.video.durationMs / 1000) : null,
            },
          ]
        : []),
    ]

    return {
      ok: true,
      attempts,
      confidence: 'medium',
      snapshot: {
        platform: 'Twitter/X',
        postType: 'Original Post',
        publishedAt: s.created_at ?? null,
        author: {
          name: s.user?.name ?? null,
          handle: s.user?.screen_name ?? null,
          profileUrl: s.user?.screen_name ? `https://x.com/${s.user.screen_name}` : null,
          avatarUrl: s.user?.profile_image_url_https ?? null,
          verified: s.user?.is_blue_verified ?? s.user?.verified ?? null,
          followers: { value: null, source: 'unavailable' },
          accountType: 'Unknown',
          declaredLocation: null,
        },
        content: {
          text,
          title: null,
          languageCode: s.lang ?? null,
          languageName: null,
          translation: null,
          transcript: null,
          hashtags: hashtagsOf(text),
          mentions: mentionsOf(text),
          outboundLinks: linksOf(text),
        },
        engagement: {
          likes: metric(s.favorite_count, 'public-endpoint'),
          comments: metric(s.conversation_count, 'public-endpoint'),
          shares: { value: null, source: 'unavailable' },
          views: { value: null, source: 'unavailable' },
          engagementRate: null,
        },
        media,
      },
    }
  }

  return {
    ok: false,
    attempts,
    blocked: {
      reason: 'X did not return this post from any public endpoint.',
      suggestion:
        'The post may be deleted, from a protected account, or age-restricted. Paste the text below and we will analyse that instead.',
    },
  }
}
