import type { MediaItem, Metric, PostSnapshot } from '../../../../shared/types'
import type { UrlIdentity } from '../platform'
import { fetchJson, fetchText } from '../fetcher'
import type { ExtractContext, ExtractResult } from './types'

/**
 * Pinterest and Snapchat — the two image/video-first platforms.
 *
 * Both were expected to be dead ends and neither is. Pinterest publishes the
 * full pin object to the endpoint behind its own embed widget, and Snapchat
 * server-renders Spotlight pages with the complete metadata in `__NEXT_DATA__`.
 * Neither needs a key, a cookie, or a login.
 *
 * Both are also the most likely adapters in this codebase to break, because
 * both read structures the platform never promised to keep. Every read is
 * therefore checked for the field it wanted rather than for HTTP 200, and every
 * count that comes back suspicious is reported as unavailable instead of zero.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const metric = (v: unknown, source: Metric['source']): Metric => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n)
    ? { value: n, source }
    : { value: null, source: 'unavailable' }
}

const hashtagsOf = (text: string) =>
  [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1] as string)
const linksOf = (text: string) => [...text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0])

// ─────────────────────────────────────────────────────────────────────────────
// Pinterest
// ─────────────────────────────────────────────────────────────────────────────

interface PinnerLike {
  full_name?: string
  username?: string
  follower_count?: number
  pin_count?: number
  about?: string
  profile_url?: string
  image_medium_url?: string
  is_verified_merchant?: boolean
}

interface PinLike {
  id?: string
  title?: string
  grid_title?: string
  description?: string
  seo_description?: string
  alt_text?: string
  created_at?: string
  repin_count?: number
  comment_count?: number
  share_count?: number
  is_video?: boolean
  link?: string
  domain?: string
  dominant_color?: string
  reaction_counts?: Record<string, number>
  aggregated_pin_data?: { aggregated_stats?: { saves?: number; done?: number } }
  pinner?: PinnerLike
  board?: { name?: string; follower_count?: number; pin_count?: number }
  images?: Record<string, { url?: string; width?: number; height?: number }>
  videos?: { video_list?: Record<string, { url?: string; width?: number; height?: number; duration?: number }> }
}

function pinMedia(pin: PinLike): MediaItem[] {
  const video = pin.videos?.video_list
    ? Object.values(pin.videos.video_list).find((v) => v?.url)
    : undefined
  const images = pin.images ?? {}
  // "orig" when we have it, otherwise the widest variant offered.
  const best =
    images['orig'] ??
    Object.values(images)
      .filter((i) => i?.url)
      .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]

  if (video?.url) {
    return [
      {
        kind: 'video',
        url: video.url,
        thumbnailUrl: best?.url ?? null,
        width: video.width ?? null,
        height: video.height ?? null,
        durationSeconds: video.duration ? Math.round(video.duration / 1000) : null,
        alt: pin.alt_text ?? pin.title ?? null,
      },
    ]
  }
  if (best?.url) {
    return [
      {
        kind: 'image',
        url: best.url,
        thumbnailUrl: best.url,
        width: best.width ?? null,
        height: best.height ?? null,
        alt: pin.alt_text ?? pin.title ?? null,
      },
    ]
  }
  return []
}

function pinSnapshot(pin: PinLike, canonical: string): Partial<PostSnapshot> {
  const title = (pin.title || pin.grid_title || '').trim()
  const body = (pin.description || pin.seo_description || pin.alt_text || '').trim()
  const reactions = pin.reaction_counts
    ? Object.values(pin.reaction_counts).reduce((a, b) => a + (Number(b) || 0), 0)
    : null

  return {
    platform: 'Pinterest',
    postType: pin.is_video ? 'Short / Reel' : 'Image',
    // Pinterest sends RFC 1123, which Date parses correctly.
    publishedAt: pin.created_at ? new Date(pin.created_at).toISOString() : null,
    author: {
      name: pin.pinner?.full_name ?? pin.pinner?.username ?? null,
      handle: pin.pinner?.username ?? null,
      profileUrl:
        pin.pinner?.profile_url ??
        (pin.pinner?.username ? `https://www.pinterest.com/${pin.pinner.username}/` : null),
      avatarUrl: pin.pinner?.image_medium_url ?? null,
      verified: pin.pinner?.is_verified_merchant ?? null,
      followers: metric(pin.pinner?.follower_count, 'public-endpoint'),
      accountType: pin.pinner?.is_verified_merchant ? 'Brand / Business' : 'Unknown',
      declaredLocation: null,
    },
    content: {
      text: body || null,
      title: title || null,
      languageCode: null,
      languageName: null,
      translation: null,
      transcript: null,
      hashtags: hashtagsOf(`${title} ${body}`),
      mentions: [],
      outboundLinks: [pin.link, ...linksOf(body)].filter((l): l is string => Boolean(l)),
    },
    engagement: {
      // Reactions are Pinterest's newest and least-used control, so a low
      // number next to a huge save count is real, not a parse failure.
      likes: metric(reactions, 'public-endpoint'),
      comments: metric(pin.comment_count, 'public-endpoint'),
      // A repin is a reshare — that is exactly what the button does.
      shares: metric(pin.repin_count, 'public-endpoint'),
      views: { value: null, source: 'unavailable' },
      engagementRate: null,
    },
    media: pinMedia(pin).map((m) => ({ ...m, url: m.url || canonical })),
  }
}

export async function extractPinterest(
  id: UrlIdentity,
  _ctx: ExtractContext,
): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = []
  let pinId = id.id

  // pin.it shortlinks carry a share code, not the pin id. Resolve by following
  // the redirect and reading the id out of the URL we land on.
  if (new URL(id.canonical).hostname === 'pin.it' || !/^\d+$/.test(pinId ?? '')) {
    const landed = await fetchText(id.canonical, { agent: 'browser', timeout: 8000 })
    const fromUrl = /\/pin\/(\d+)/.exec(landed.url)?.[1]
    const fromBody = /"pin_id"\s*:\s*"?(\d{6,})/.exec(landed.body)?.[1]
    pinId = fromUrl ?? fromBody ?? pinId
    attempts.push({
      strategy: 'pinterest:resolve-shortlink',
      ok: Boolean(fromUrl ?? fromBody),
      note: pinId ? `pin ${pinId}` : `HTTP ${landed.status}`,
    })
  }

  if (!pinId || !/^\d+$/.test(pinId)) {
    return {
      ok: false,
      attempts: [...attempts, { strategy: 'pinterest:parse-id', ok: false, note: 'No pin id in the URL' }],
    }
  }

  // ── 1. PinResource — the richest read: comments, reactions, publish date ───
  // One header is the entire gate; without it the same URL is a 403.
  const query = encodeURIComponent(
    JSON.stringify({ options: { id: pinId, field_set_key: 'detailed' }, context: {} }),
  )
  const rich = await fetchJson<{ resource_response?: { data?: PinLike } }>(
    `https://www.pinterest.com/resource/PinResource/get/?source_url=%2Fpin%2F${pinId}%2F&data=${query}`,
    {
      timeout: 8000,
      headers: { 'X-Pinterest-PWS-Handler': 'www/pin/[id].js', 'Accept-Language': 'en-US,en;q=0.9' },
    },
  )

  const pin = rich.data?.resource_response?.data
  // field_set_key=unauth_react answers 200 with SEO fields and no counts at
  // all, so check for the id rather than for the status.
  const richOk = Boolean(pin?.id)
  attempts.push({
    strategy: 'pinterest:pin-resource',
    ok: richOk,
    note: richOk ? 'saves, repins, comments, reactions, publish date' : `HTTP ${rich.status}`,
  })

  if (richOk && pin) {
    return {
      ok: true,
      attempts,
      confidence: 'high',
      snapshot: pinSnapshot(pin, id.canonical),
      extra: {
        saves: pin.aggregated_pin_data?.aggregated_stats?.saves ?? null,
        tried: pin.aggregated_pin_data?.aggregated_stats?.done ?? null,
        board: pin.board?.name ?? null,
        boardFollowers: pin.board?.follower_count ?? null,
        destination: pin.link ?? null,
        destinationDomain: pin.domain ?? null,
        pinnerBio: pin.pinner?.about ?? null,
      },
    }
  }

  // ── 2. The widget endpoint — fewer fields, but it is public by design ─────
  // This one backs Pinterest's own embed script and needs no headers at all,
  // which makes it the leg most likely to survive both a front-end deploy and
  // a datacentre-IP bot filter.
  const widget = await fetchJson<{ data?: PinLike[] }>(
    `https://widgets.pinterest.com/v3/pidgets/pins/info/?pin_ids=${pinId}`,
    { timeout: 7000 },
  )
  const wPin = widget.data?.data?.[0]
  const widgetOk = Boolean(wPin?.id)
  attempts.push({
    strategy: 'pinterest:widget-api',
    ok: widgetOk,
    note: widgetOk ? 'saves, repins, author — no comments or date' : `HTTP ${widget.status}`,
  })

  if (widgetOk && wPin) {
    const snapshot = pinSnapshot(wPin, id.canonical)
    return {
      ok: true,
      attempts,
      confidence: 'medium',
      snapshot,
      extra: {
        saves: wPin.aggregated_pin_data?.aggregated_stats?.saves ?? null,
        board: wPin.board?.name ?? null,
        boardFollowers: wPin.board?.follower_count ?? null,
        destination: wPin.link ?? null,
        pinnerBio: wPin.pinner?.about ?? null,
      },
    }
  }

  return {
    ok: false,
    attempts,
    blocked: {
      reason: 'Pinterest did not return this pin from either public endpoint.',
      suggestion: 'The pin may be deleted or from a private board. Paste its description below.',
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapchat — Spotlight
// ─────────────────────────────────────────────────────────────────────────────

interface SnapCreator {
  username?: string
  name?: string
  url?: string
  followerCount?: string
  bitmojiUrl?: string
}

interface SnapVideoMetadata {
  name?: string
  description?: string
  thumbnailUrl?: string
  contentUrl?: string
  uploadDateMs?: string
  viewCount?: string
  shareCount?: string
  durationMs?: string
  width?: number
  height?: number
  embeddedTextCaption?: string
  transcriptMap?: Record<string, { text?: string; url?: string }>
  creator?: { personCreator?: SnapCreator; publisherCreator?: SnapCreator }
}

interface SnapComment {
  replyText?: string
  replyPosterDisplayName?: string
  reactCounts?: Record<string, number> | number
  threadedReplyCount?: number
  replyTimestampMs?: string
}

export async function extractSnapchat(
  id: UrlIdentity,
  _ctx: ExtractContext,
): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = []

  // Accept-Language is not optional: from an Indian IP the page renders in
  // Hindi, and the localised strings break every field we key on.
  const page = await fetchText(id.canonical, {
    agent: 'browser',
    timeout: 9000,
    headers: { 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': UA },
  })

  const raw = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(page.body)?.[1]
  let props: Record<string, unknown> | null = null
  if (raw) {
    try {
      props = (JSON.parse(raw) as { props?: { pageProps?: Record<string, unknown> } }).props
        ?.pageProps ?? null
    } catch {
      props = null
    }
  }

  const vm = props?.['videoMetadata'] as SnapVideoMetadata | undefined
  const ok = Boolean(vm?.viewCount != null || vm?.contentUrl)
  attempts.push({
    strategy: 'snapchat:spotlight-ssr',
    ok,
    note: ok ? 'views, comments, creator, publish date' : `HTTP ${page.status} — no __NEXT_DATA__`,
  })

  if (!ok || !vm) {
    return {
      ok: false,
      attempts,
      blocked: {
        reason: 'Snapchat returned no Spotlight data for that link.',
        suggestion:
          'Only public Spotlight posts are readable — Stories and private snaps are not. Paste the caption below instead.',
      },
    }
  }

  // encodedComments is a JSON string nested inside JSON, so it needs its own parse.
  let comments: SnapComment[] = []
  const encoded = props?.['encodedComments']
  if (typeof encoded === 'string' && encoded.trim()) {
    try {
      const parsed: unknown = JSON.parse(encoded)
      if (Array.isArray(parsed)) comments = parsed as SnapComment[]
    } catch {
      /* malformed comment blob is not a reason to fail the whole extraction */
    }
  }

  const creator = vm.creator?.personCreator ?? vm.creator?.publisherCreator ?? {}
  // followerCount comes back "0" for every personal account, so it means
  // "not published" here, not "nobody follows them". Reporting a real zero
  // would be worse than reporting nothing.
  const followerRaw = Number(creator.followerCount)
  const followers: Metric =
    Number.isFinite(followerRaw) && followerRaw > 0
      ? { value: followerRaw, source: 'public-endpoint' }
      : { value: null, source: 'unavailable' }

  // Likewise shareCount: zero on every snap measured, including one with 2.8M
  // views. That is a field Snapchat does not populate, not a real figure.
  const shareRaw = Number(vm.shareCount)
  const shares: Metric =
    Number.isFinite(shareRaw) && shareRaw > 0
      ? { value: shareRaw, source: 'public-endpoint' }
      : { value: null, source: 'unavailable' }

  // videoMetadata.description is boilerplate on every snap ("Another Spotlight
  // Snap brought to you by Snapchat"), so it is never the caption. The real
  // text is the burned-in caption, or the auto-transcript when there is one.
  const caption = (vm.embeddedTextCaption ?? '').trim()
  const transcript = vm.transcriptMap
    ? (Object.values(vm.transcriptMap).find((t) => t?.text)?.text ?? null)
    : null

  const uploadMs = Number(vm.uploadDateMs)
  const durationMs = Number(vm.durationMs)

  const snapshot: Partial<PostSnapshot> = {
    platform: 'Snapchat',
    postType: 'Short / Reel',
    publishedAt: Number.isFinite(uploadMs) && uploadMs > 0 ? new Date(uploadMs).toISOString() : null,
    author: {
      name: creator.name ?? creator.username ?? null,
      handle: creator.username ?? null,
      profileUrl: creator.username ? `https://www.snapchat.com/@${creator.username}` : null,
      avatarUrl: creator.bitmojiUrl ?? null,
      verified: null,
      followers,
      accountType: vm.creator?.publisherCreator ? 'Page' : 'Individual',
      declaredLocation: null,
    },
    content: {
      text: caption || transcript,
      title: null,
      languageCode: null,
      languageName: null,
      translation: null,
      transcript,
      hashtags: hashtagsOf(caption),
      mentions: [],
      outboundLinks: [],
    },
    engagement: {
      // Snapchat publishes no like count on Spotlight at all.
      likes: { value: null, source: 'unavailable' },
      // The comment array is the count — there is no separate total, and the
      // page ships every comment it has.
      comments: comments.length
        ? { value: comments.length, source: 'page-scrape' }
        : { value: null, source: 'unavailable' },
      shares,
      views: metric(vm.viewCount, 'public-endpoint'),
      engagementRate: null,
    },
    media: vm.contentUrl
      ? [
          {
            kind: 'video',
            url: vm.contentUrl,
            thumbnailUrl: vm.thumbnailUrl ?? null,
            width: vm.width ?? null,
            height: vm.height ?? null,
            durationSeconds: Number.isFinite(durationMs) ? Math.round(durationMs / 1000) : null,
            alt: caption || null,
          },
        ]
      : [],
  }

  return {
    ok: true,
    snapshot,
    attempts,
    confidence: caption || transcript ? 'medium' : 'low',
    // Most Spotlight snaps carry no written caption at all — the message is in
    // the video. Say that plainly instead of letting the generic "we found no
    // post text" notice imply the fetch failed, because it did not: the views,
    // the publish date and every comment came through.
    ...(caption || transcript
      ? {}
      : {
          blocked: {
            reason: comments.length
              ? `This snap has no written caption — the message is in the video itself. We did read ${comments.length} public ${comments.length === 1 ? 'comment' : 'comments'}, so the analysis below reflects how people responded rather than what the author said.`
              : 'This snap has no written caption and no comments, so there is no text to analyse.',
            suggestion:
              'Type what the snap says, or upload a screenshot of it, and we will analyse that alongside the numbers.',
          },
        }),
    extra: {
      // The comment bodies are the most useful thing on the page for this
      // product: on a snap with no caption, they are the only text, and they
      // are the public's reaction rather than the author's claim.
      topComments: comments.slice(0, 25).map((c) => ({
        text: (c.replyText ?? '').slice(0, 400),
        author: c.replyPosterDisplayName ?? null,
        reactions:
          typeof c.reactCounts === 'number'
            ? c.reactCounts
            : c.reactCounts
              ? Object.values(c.reactCounts).reduce((a, b) => a + (Number(b) || 0), 0)
              : null,
        replies: c.threadedReplyCount ?? 0,
      })),
      commentCount: comments.length,
      durationSeconds: Number.isFinite(durationMs) ? Math.round(durationMs / 1000) : null,
      captionSource: caption ? 'burned-in caption' : transcript ? 'auto-transcript' : 'none',
    },
  }
}
