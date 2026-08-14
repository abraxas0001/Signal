import type { MediaItem, Metric, PostSnapshot } from '../../../../shared/types'
import type { UrlIdentity } from '../platform'
import { fetchJson } from '../fetcher'
import type { ExtractContext, ExtractResult } from './types'

/**
 * Bluesky and Mastodon.
 *
 * These two are the outliers in this codebase: both are built on open
 * protocols, so their read APIs are public, unauthenticated, documented, and
 * explicitly meant to be called. There is no scraping here and no fallback
 * chain, because there is nothing to work around. Both return a *more*
 * complete metric set than X does — Bluesky gives likes, reposts, replies and
 * quotes; Mastodon gives favourites, boosts, replies and quotes — and both give
 * the author's follower count and the post's declared language.
 *
 * Verified live: a Bluesky post returned 2302/322/74/129 with 34.5M followers,
 * and a Mastodon post returned 89/59/15 with 382k followers, both keyless.
 */

const UA = 'Signal/1.0 (+https://github.com/signal-analyzer)'
const HEADERS = { 'User-Agent': UA }

const metric = (v: unknown, source: Metric['source']): Metric =>
  typeof v === 'number' && Number.isFinite(v)
    ? { value: v, source }
    : { value: null, source: 'unavailable' }

const linksOf = (text: string) => [...text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0])

// ─────────────────────────────────────────────────────────────────────────────
// Bluesky — AT Protocol
// ─────────────────────────────────────────────────────────────────────────────

const BSKY = 'https://public.api.bsky.app/xrpc'

interface BskyProfile {
  did?: string
  handle?: string
  displayName?: string
  description?: string
  avatar?: string
  followersCount?: number
  postsCount?: number
  verification?: { verifiedStatus?: string; trustedVerifierStatus?: string }
}

interface BskyFacet {
  features?: Array<{ $type?: string; tag?: string; did?: string; uri?: string }>
}

interface BskyEmbedView {
  $type?: string
  images?: Array<{ thumb?: string; fullsize?: string; alt?: string; aspectRatio?: { width?: number; height?: number } }>
  thumbnail?: string
  playlist?: string
  alt?: string
  aspectRatio?: { width?: number; height?: number }
  external?: { uri?: string; title?: string; description?: string; thumb?: string }
  media?: BskyEmbedView
}

interface BskyPost {
  uri?: string
  cid?: string
  author?: BskyProfile & { labels?: unknown[] }
  record?: {
    text?: string
    createdAt?: string
    langs?: string[]
    facets?: BskyFacet[]
    reply?: unknown
  }
  embed?: BskyEmbedView
  likeCount?: number
  repostCount?: number
  replyCount?: number
  quoteCount?: number
  labels?: Array<{ val?: string }>
}

interface BskyThread {
  thread?: { $type?: string; post?: BskyPost }
}

/** Pull tags and mentions out of the richtext facets rather than re-parsing text. */
function facetEntities(facets: BskyFacet[] | undefined, text: string) {
  const hashtags: string[] = []
  const mentions: string[] = []
  for (const f of facets ?? []) {
    for (const feat of f.features ?? []) {
      if (feat.$type?.endsWith('#tag') && feat.tag) hashtags.push(feat.tag)
      if (feat.$type?.endsWith('#mention') && feat.did) mentions.push(feat.did)
    }
  }
  // Older posts predate facets, so fall back to the plain-text read.
  if (!hashtags.length) {
    hashtags.push(...[...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1] as string))
  }
  return { hashtags, mentions }
}

function bskyMedia(embed: BskyEmbedView | undefined): MediaItem[] {
  if (!embed) return []
  // recordWithMedia wraps the real embed one level down.
  const e = embed.$type?.includes('recordWithMedia') && embed.media ? embed.media : embed

  if (e.images?.length) {
    return e.images.map((img) => ({
      kind: 'image' as const,
      url: img.fullsize ?? img.thumb ?? '',
      thumbnailUrl: img.thumb ?? null,
      width: img.aspectRatio?.width ?? null,
      height: img.aspectRatio?.height ?? null,
      alt: img.alt ?? null,
    }))
  }
  if (e.$type?.includes('video') && e.thumbnail) {
    return [
      {
        kind: 'video',
        url: e.playlist ?? e.thumbnail,
        thumbnailUrl: e.thumbnail,
        width: e.aspectRatio?.width ?? null,
        height: e.aspectRatio?.height ?? null,
        alt: e.alt ?? null,
      },
    ]
  }
  if (e.external?.thumb) {
    return [
      {
        kind: 'image',
        url: e.external.thumb,
        thumbnailUrl: e.external.thumb,
        alt: e.external.title ?? null,
      },
    ]
  }
  return []
}

export async function extractBluesky(
  id: UrlIdentity,
  _ctx: ExtractContext,
): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = []
  const rkey = id.id
  const actor = id.handle

  if (!rkey || !actor) {
    return {
      ok: false,
      attempts: [
        { strategy: 'bluesky:parse-url', ok: false, note: 'Expected /profile/<handle>/post/<id>' },
      ],
    }
  }

  // A DID can address the repo directly; a handle has to be resolved first.
  let did = actor.startsWith('did:') ? actor : null
  if (!did) {
    const r = await fetchJson<{ did?: string }>(
      `${BSKY}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(actor)}`,
      { headers: HEADERS, timeout: 7000 },
    )
    did = r.data?.did ?? null
    attempts.push({
      strategy: 'bluesky:resolveHandle',
      ok: Boolean(did),
      note: did ? actor : `HTTP ${r.status}`,
    })
    if (!did) {
      return {
        ok: false,
        attempts,
        blocked: {
          reason: `Bluesky could not resolve the handle @${actor}.`,
          suggestion: 'The account may have been renamed or deleted. Paste the post text below.',
        },
      }
    }
  }

  const atUri = `at://${did}/app.bsky.feed.post/${rkey}`

  // The thread carries the post and its counts; the profile carries followers.
  // They are independent, so fetch them together.
  const [threadRes, profileRes] = await Promise.all([
    fetchJson<BskyThread>(
      `${BSKY}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(atUri)}&depth=0&parentHeight=0`,
      { headers: HEADERS, timeout: 8000 },
    ),
    fetchJson<BskyProfile>(`${BSKY}/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`, {
      headers: HEADERS,
      timeout: 7000,
    }),
  ])

  const post = threadRes.data?.thread?.post
  const ok = Boolean(post?.record?.text != null || post?.embed)
  attempts.push({
    strategy: 'bluesky:getPostThread',
    ok,
    note: ok ? 'likes, reposts, replies, quotes' : `HTTP ${threadRes.status}`,
  })

  if (!ok || !post) {
    return {
      ok: false,
      attempts,
      blocked: {
        reason: 'Bluesky returned no post at that address.',
        suggestion: 'The post may have been deleted or the link may be mistyped.',
      },
    }
  }

  const profile = profileRes.data
  attempts.push({
    strategy: 'bluesky:getProfile',
    ok: Boolean(profile?.followersCount != null),
    note: profile?.followersCount != null ? 'followers' : `HTTP ${profileRes.status}`,
  })

  const text = post.record?.text ?? ''
  const { hashtags, mentions } = facetEntities(post.record?.facets, text)
  const author = post.author ?? {}

  const likes = metric(post.likeCount, 'public-endpoint')
  const comments = metric(post.replyCount, 'public-endpoint')
  const shares = metric(post.repostCount, 'public-endpoint')
  const followers = metric(profile?.followersCount ?? author.followersCount, 'public-endpoint')

  const snapshot: Partial<PostSnapshot> = {
    platform: 'Bluesky',
    // Bluesky threads a reply to a parent; the sheet treats those differently.
    postType: post.record?.reply ? 'Comment' : 'Original Post',
    publishedAt: post.record?.createdAt ?? null,
    author: {
      name: author.displayName ?? author.handle ?? null,
      handle: author.handle ?? null,
      profileUrl: author.handle ? `https://bsky.app/profile/${author.handle}` : null,
      avatarUrl: author.avatar ?? null,
      // Bluesky's verification is a trust graph, not a badge purchase: a
      // "valid" trusted verifier or a non-none verified status both count.
      verified:
        author.verification?.verifiedStatus === 'valid' ||
        author.verification?.trustedVerifierStatus === 'valid' ||
        null,
      followers,
      accountType: 'Unknown',
      declaredLocation: null,
    },
    content: {
      text,
      title: null,
      languageCode: post.record?.langs?.[0] ?? null,
      languageName: null,
      translation: null,
      transcript: null,
      hashtags,
      mentions,
      outboundLinks: linksOf(text),
    },
    engagement: {
      likes,
      comments,
      shares,
      // Bluesky publishes no view count to anyone, including the author.
      views: { value: null, source: 'unavailable' },
      engagementRate: null,
    },
    media: bskyMedia(post.embed),
  }

  return {
    ok: true,
    snapshot,
    attempts,
    confidence: 'high',
    extra: {
      quotes: post.quoteCount ?? null,
      authorBio: profile?.description ?? null,
      authorPosts: profile?.postsCount ?? null,
      moderationLabels: (post.labels ?? []).map((l) => l.val).filter(Boolean),
      externalCard: post.embed?.external
        ? { title: post.embed.external.title, description: post.embed.external.description }
        : null,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mastodon — ActivityPub, instance-hosted
// ─────────────────────────────────────────────────────────────────────────────

interface MastoStatus {
  id?: string
  url?: string
  uri?: string
  created_at?: string
  edited_at?: string | null
  language?: string | null
  content?: string
  spoiler_text?: string
  sensitive?: boolean
  visibility?: string
  replies_count?: number
  reblogs_count?: number
  favourites_count?: number
  quotes_count?: number
  in_reply_to_id?: string | null
  reblog?: MastoStatus | null
  error?: string
  application?: { name?: string }
  tags?: Array<{ name?: string }>
  mentions?: Array<{ acct?: string }>
  media_attachments?: Array<{
    type?: string
    url?: string
    preview_url?: string
    description?: string | null
    meta?: { original?: { width?: number; height?: number; duration?: number } }
  }>
  card?: { url?: string; title?: string; description?: string; image?: string } | null
  account?: {
    username?: string
    acct?: string
    display_name?: string
    avatar?: string
    note?: string
    followers_count?: number
    statuses_count?: number
    bot?: boolean
    url?: string
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
}

/**
 * Mastodon returns post bodies as HTML. Strip it to text while keeping the
 * paragraph breaks — they carry meaning in a grievance thread, and collapsing
 * them turns a list of demands into one run-on sentence.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (whole, name: string) => {
      if (name.startsWith('#')) {
        const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
      return ENTITIES[name.toLowerCase()] ?? whole
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function extractMastodon(
  id: UrlIdentity,
  _ctx: ExtractContext,
): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = []
  const statusId = id.id
  const host = new URL(id.canonical).hostname

  if (!statusId) {
    return { ok: false, attempts: [{ strategy: 'mastodon:parse-url', ok: false, note: 'No status id' }] }
  }

  const res = await fetchJson<MastoStatus>(`https://${host}/api/v1/statuses/${statusId}`, {
    headers: HEADERS,
    timeout: 8000,
  })

  const raw = res.data
  const ok = Boolean(raw && !raw.error && (raw.content != null || raw.media_attachments?.length))
  attempts.push({
    strategy: 'mastodon:api-v1-statuses',
    ok,
    note: ok ? 'favourites, boosts, replies, quotes' : raw?.error ?? `HTTP ${res.status}`,
  })

  // Not every /@user/12345 URL is a Mastodon instance — the router detects this
  // platform by URL *shape*, since the fediverse has no host list. A miss here
  // is expected, not exceptional, and the caller falls back to generic web
  // extraction.
  if (!ok || !raw) {
    return {
      ok: false,
      attempts,
      extra: { notMastodon: res.status === 404 || res.status === 0 },
    }
  }

  // A boost carries no text of its own; the post being boosted is the subject.
  const s = raw.reblog ?? raw
  const boosted = Boolean(raw.reblog)

  const text = htmlToText(s.content ?? '')
  const warning = s.spoiler_text?.trim()
  const acct = s.account?.acct ?? s.account?.username ?? null

  const likes = metric(s.favourites_count, 'public-endpoint')
  const comments = metric(s.replies_count, 'public-endpoint')
  const shares = metric(s.reblogs_count, 'public-endpoint')

  const media: MediaItem[] = (s.media_attachments ?? []).map((m) => ({
    kind: m.type === 'video' || m.type === 'gifv' ? ('video' as const) : ('image' as const),
    url: m.url ?? m.preview_url ?? '',
    thumbnailUrl: m.preview_url ?? null,
    width: m.meta?.original?.width ?? null,
    height: m.meta?.original?.height ?? null,
    durationSeconds: m.meta?.original?.duration ? Math.round(m.meta.original.duration) : null,
    alt: m.description ?? null,
  }))

  const snapshot: Partial<PostSnapshot> = {
    platform: 'Mastodon',
    postType: boosted ? 'Repost / Share' : s.in_reply_to_id ? 'Comment' : 'Original Post',
    publishedAt: s.created_at ?? null,
    author: {
      name: s.account?.display_name || s.account?.username || null,
      // acct is bare on the home instance and user@host when federated; the
      // full form is the honest one because it names where the post lives.
      handle: acct && !acct.includes('@') ? `${acct}@${host}` : acct,
      profileUrl: s.account?.url ?? null,
      avatarUrl: s.account?.avatar ?? null,
      // Mastodon has no verification badge by design — link rel="me" is the
      // closest thing, and it is not a claim we can check server-side.
      verified: null,
      followers: metric(s.account?.followers_count, 'public-endpoint'),
      accountType: s.account?.bot ? 'Bot Suspected' : 'Unknown',
      declaredLocation: null,
    },
    content: {
      // A content warning is part of what the post says, so keep it attached.
      text: warning ? `[CW: ${warning}]\n\n${text}` : text,
      title: null,
      languageCode: s.language ?? null,
      languageName: null,
      translation: null,
      transcript: null,
      hashtags: (s.tags ?? []).map((t) => t.name).filter((n): n is string => Boolean(n)),
      mentions: (s.mentions ?? []).map((m) => m.acct).filter((a): a is string => Boolean(a)),
      outboundLinks: linksOf(text),
    },
    engagement: {
      likes,
      comments,
      shares,
      // No Mastodon instance reports impressions; there is no such counter.
      views: { value: null, source: 'unavailable' },
      engagementRate: null,
    },
    media,
  }

  return {
    ok: true,
    snapshot,
    attempts,
    confidence: 'high',
    extra: {
      instance: host,
      quotes: s.quotes_count ?? null,
      boostedFrom: boosted ? (raw.account?.acct ?? null) : null,
      contentWarning: warning || null,
      sensitive: s.sensitive ?? false,
      visibility: s.visibility ?? null,
      edited: Boolean(s.edited_at),
      authorBio: s.account?.note ? htmlToText(s.account.note) : null,
      linkCard: s.card ? { title: s.card.title, description: s.card.description } : null,
    },
  }
}
