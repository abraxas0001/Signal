import type { Comment, MediaItem, Metric, PostSnapshot } from '../../../../shared/types'
import type { Platform } from '../../../../shared/taxonomy'
import type { UrlIdentity } from '../platform'
import { decodeEntities } from './json-scan'
import { fetchText, fetchJson } from '../fetcher'
import { parseMetadata, parseCount, detectJunk } from '../metadata'
import type { ExtractContext, ExtractResult } from './types'

/**
 * Everything that is not YouTube, X or Meta: LinkedIn, Telegram, TikTok,
 * Reddit, news sites, e-papers and blogs — plus the universal OpenGraph floor
 * that any URL on the internet lands on.
 */

const metric = (v: number | null, source: Metric['source']): Metric =>
  v == null ? { value: null, source: 'unavailable' } : { value: v, source }

const empty = {
  likes: { value: null, source: 'unavailable' as const },
  comments: { value: null, source: 'unavailable' as const },
  shares: { value: null, source: 'unavailable' as const },
  views: { value: null, source: 'unavailable' as const },
  engagementRate: null,
}

/**
 * LinkedIn comment bodies, from the JSON-LD already on the page.
 *
 * Free: `extractLinkedIn` fetches this page for the counts, and the same
 * `SocialMediaPosting` node carries a `comment` array. Ten of them, and only
 * ten — no pagination exists. `?sortBy=RECENT`, `?commentsPage=2`,
 * `?start=10&count=100`, the `/feed/update/urn:li:activity:{id}/` form and four
 * different crawler User-Agents all return the identical ten. So on a post with
 * 1,577 comments this is a top-comment sample, good for tone and not a census —
 * which is why the count is reported alongside it.
 *
 * The author key is not stable: it is `author` on a text post and `creator` on
 * a video post. Reading only one silently drops every name on the other kind.
 */
function readLinkedInComments(html: string, limit = 100): Comment[] {
  const out: Comment[] = []

  for (const block of html.matchAll(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let node: unknown
    try {
      node = JSON.parse((block[1] ?? '').trim())
    } catch {
      continue
    }

    const comments = (node as { comment?: unknown })?.comment
    if (!Array.isArray(comments)) continue

    for (const raw of comments) {
      const c = raw as Record<string, unknown>
      const text = typeof c['text'] === 'string' ? c['text'].trim() : ''
      if (!text) continue

      const who = (c['author'] ?? c['creator']) as Record<string, unknown> | undefined
      const stat = c['interactionStatistic'] as Record<string, unknown> | undefined

      out.push({
        text,
        author: typeof who?.['name'] === 'string' ? (who['name'] as string) : null,
        likes:
          typeof stat?.['userInteractionCount'] === 'number'
            ? (stat['userInteractionCount'] as number)
            : null,
        publishedAt: typeof c['datePublished'] === 'string' ? (c['datePublished'] as string) : null,
        isReply: false,
      })
      if (out.length >= limit) return out
    }
  }
  return out
}

/**
 * Full article text via Readability. Loaded lazily so news-site parsing does
 * not add ~250ms of cold-start import to a YouTube or X request that will
 * never need it.
 */
async function readArticle(html: string, url: string): Promise<string | null> {
  try {
    const [{ parseHTML }, { Readability }] = await Promise.all([
      import('linkedom'),
      import('@mozilla/readability'),
    ])
    const { document } = parseHTML(html)
    // Readability wants a document URL to resolve relative links.
    try {
      Object.defineProperty(document, 'documentURI', { value: url, configurable: true })
    } catch {
      /* linkedom sometimes exposes this read-only; not fatal */
    }
    const parsed = new Readability(document as never, { charThreshold: 200 }).parse()
    const text = parsed?.textContent?.replace(/\n{3,}/g, '\n\n').trim()
    return text && text.length > 150 ? text.slice(0, 20_000) : null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LinkedIn — richest of the "other" platforms, and fully public
// ─────────────────────────────────────────────────────────────────────────────

async function extractLinkedIn(id: UrlIdentity): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = []
  const res = await fetchText(id.canonical, { agent: 'browser', timeout: 9000 })

  if (!res.ok || !res.body) {
    attempts.push({ strategy: 'linkedin:page', ok: false, note: `HTTP ${res.status}` })
    return { ok: false, attempts }
  }

  const meta = parseMetadata(res.body, res.url)
  const commentBodies = readLinkedInComments(res.body)
  // LinkedIn publishes a schema.org SocialMediaPosting with real counts in it.
  const likes = meta.interactions.like ?? null
  const comments = meta.interactions.comment ?? null

  // The author, from the URL — deliberately not from the page.
  //
  // LinkedIn post pages carry no og:author and no JSON-LD `author` node, so the
  // author column came back empty. The page *does* carry a JSON-LD `creator`,
  // and reading it looks like the obvious fix — but on a Narendra Modi post it
  // returns "Dhinesh kumar", who is a commenter. That is the same
  // grabbed-a-neighbour failure that has produced wrong bylines twice in this
  // codebase, and it is worse here than an empty cell: it attributes a
  // minister's post to a private citizen.
  //
  // The permalink slug cannot pick up a commenter, because LinkedIn builds it
  // from the poster's own vanity name: /posts/{author}_{slug}-{id}-{code}.
  const slug = /linkedin\.com\/posts\/([A-Za-z0-9-]{3,100})_/.exec(id.canonical)?.[1] ?? null
  // Display name where LinkedIn gave us one, otherwise the vanity handle as-is.
  const authorName =
    meta.author ??
    (slug
      ? /-[0-9a-f]{6,}$/.test(slug)
        ? slug // an opaque member id, not a name — show it unchanged
        : slug.replace(/-/g, ' ').replace(/\p{Ll}/gu, (c) => c.toUpperCase())
      : null)

  // The follower count sits in the author's Person/Organization node.
  const followers = parseCount(
    /"interactionStatistic"[\s\S]{0,400}?"userInteractionCount":\s*(\d+)[\s\S]{0,200}?FollowAction/.exec(res.body)?.[1] ??
      /"followerCount":\s*(\d+)/.exec(res.body)?.[1] ??
      null,
  )

  attempts.push({
    strategy: 'linkedin:json-ld',
    ok: likes != null || Boolean(meta.description),
    note:
      likes != null
        ? `likes=${likes} comments=${comments ?? '—'}${
            commentBodies.length ? ` · ${commentBodies.length} comment bodies` : ''
          }`
        : 'metadata only',
  })

  const text = meta.articleText ?? meta.description

  return {
    // Report success only when something usable came back. Returning `ok: true`
    // unconditionally made the documented fallback to extractGeneric
    // unreachable, so a LinkedIn page that yielded nothing still reported as a
    // successful extraction.
    ok: Boolean(text || meta.title || likes != null),
    attempts,
    confidence: likes != null ? 'high' : text ? 'medium' : 'low',
    snapshot: {
      platform: 'LinkedIn',
      ...(commentBodies.length ? { comments: commentBodies } : {}),
      postType: 'Original Post',
      publishedAt: meta.publishedAt,
      author: {
        name: authorName,
        handle: slug,
        profileUrl: slug ? `https://www.linkedin.com/in/${slug}` : null,
        avatarUrl: null,
        verified: null,
        followers: metric(followers, 'page-scrape'),
        accountType: 'Unknown',
        declaredLocation: null,
      },
      content: {
        text: text ?? null,
        title: meta.title,
        languageCode: meta.lang,
        languageName: null,
        translation: null,
        transcript: null,
        hashtags: [...(text ?? '').matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1] as string),
        mentions: [],
        outboundLinks: [],
      },
      engagement: {
        likes: metric(likes, 'page-scrape'),
        comments: metric(comments, 'page-scrape'),
        shares: { value: null, source: 'unavailable' },
        views: { value: null, source: 'unavailable' },
        engagementRate: null,
      },
      media: meta.image ? [{ kind: 'image', url: meta.image, thumbnailUrl: meta.image }] : [],
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Telegram — public channels expose text, author and view count via ?embed=1
// ─────────────────────────────────────────────────────────────────────────────

async function extractTelegram(id: UrlIdentity): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = []

  // Build with the URL API: string concatenation produces "...?a=b?embed=1"
  // when the canonical already carries a query, and Telegram then ignores it.
  const embedUrl = new URL(id.canonical)
  embedUrl.searchParams.set('embed', '1')
  const res = await fetchText(embedUrl.toString(), { agent: 'browser', timeout: 8000 })

  if (!res.ok || !res.body) {
    attempts.push({ strategy: 'telegram:embed', ok: false, note: `HTTP ${res.status}` })
    return { ok: false, attempts }
  }

  const html = res.body
  const strip = (s: string | undefined) =>
    s
      ? s
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&')
          .trim()
      : null

  const text = strip(
    /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1],
  )
  const author = strip(/<span class="tgme_widget_message_author_name"[^>]*>([\s\S]*?)<\/span>/.exec(html)?.[1])
  const views = parseCount(/<span class="tgme_widget_message_views">([^<]+)<\/span>/.exec(html)?.[1] ?? null)
  const datetime = /<time[^>]+datetime="([^"]+)"/.exec(html)?.[1] ?? null
  const image = /background-image:url\('([^']+)'\)/.exec(html)?.[1] ?? null

  attempts.push({
    strategy: 'telegram:embed',
    ok: Boolean(text || author),
    note: views != null ? `views=${views}` : 'text only',
  })

  if (!text && !author) return { ok: false, attempts }

  return {
    ok: true,
    attempts,
    confidence: 'medium',
    snapshot: {
      platform: 'Telegram',
      postType: 'Original Post',
      publishedAt: datetime,
      author: {
        name: author,
        handle: id.handle,
        profileUrl: id.handle ? `https://t.me/${id.handle}` : null,
        avatarUrl: null,
        verified: null,
        followers: { value: null, source: 'unavailable' },
        accountType: 'Unknown',
        declaredLocation: null,
      },
      content: {
        text,
        title: null,
        languageCode: null,
        languageName: null,
        translation: null,
        transcript: null,
        hashtags: [...(text ?? '').matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1] as string),
        mentions: [],
        outboundLinks: [],
      },
      engagement: { ...empty, views: metric(views, 'page-scrape') },
      media: image ? [{ kind: 'image', url: image, thumbnailUrl: image }] : [],
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TikTok
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TikTok's embed page carries the full engagement set.
 *
 * `/embed/v2/{id}` server-renders a `__FRONTITY_CONNECT_STATE__` blob with
 * views, likes, comments, shares, the caption, the publish time, and — the
 * only keyless source for it — the author's follower count. It needs no key,
 * no cookie and no particular User-Agent.
 *
 * It is also the *only* leg worth building on. The full video page carries two
 * extra fields, but TikTok's WAF blocks a datacentre IP after roughly ten
 * requests and then serves a 1.4KB challenge page with HTTP 200 indefinitely.
 * The embed endpoint kept answering on an IP already blocked for the main page,
 * so this adapter never touches the video page at all.
 *
 * Every failure mode returns HTTP 200: a deleted id yields a valid blob whose
 * entry is `{isError: true}` with no `videoData`. So the gate is the presence
 * of `videoData`, never the status code.
 *
 * Large counts are rounded by TikTok itself (968,500,000 for a true
 * 968,505,196), so they are marked approximate rather than presented as exact.
 */

interface TikTokVideoData {
  itemInfos?: {
    id?: string
    text?: string
    createTime?: string | number
    diggCount?: number
    commentCount?: number
    shareCount?: number
    playCount?: number
    covers?: string[]
    coversOrigin?: string[]
    video?: { urls?: string[]; videoMeta?: { width?: number; height?: number; duration?: number } }
  }
  authorInfos?: {
    uniqueId?: string
    nickName?: string
    signature?: string
    verified?: boolean
    covers?: string[]
  }
  authorStats?: { followerCount?: number; heartCount?: number | string; videoCount?: number }
  textExtra?: Array<{ hashtagName?: string; userUniqueId?: string }>
  imagePostInfo?: { images?: Array<{ imageURL?: { urlList?: string[] } }> }
}

/**
 * A count TikTok has rounded for display.
 *
 * Keeping the rounded figure but labelling it approximate is more honest than
 * either dropping it or implying precision it does not have. TikTok rounds
 * above roughly 10,000.
 */
function tikTokMetric(v: number | undefined): Metric {
  if (typeof v !== 'number' || !Number.isFinite(v)) return { value: null, source: 'unavailable' }
  const rounded = v >= 10_000 && v % 100 === 0
  return {
    value: v,
    source: 'public-endpoint',
    ...(rounded ? { display: `~${v.toLocaleString('en-IN')}` } : {}),
  }
}

async function extractTikTok(id: UrlIdentity): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = []
  let videoId = id.id

  // vm./vt. shortlinks carry a share code, not the numeric video id.
  if (!/^\d{8,}$/.test(videoId ?? '')) {
    const landed = await fetchText(id.canonical, { agent: 'browser', timeout: 8000 })
    const resolved =
      /\/video\/(\d{8,})/.exec(landed.url)?.[1] ?? /\/video\/(\d{8,})/.exec(landed.body)?.[1] ?? null
    if (resolved) videoId = resolved
    attempts.push({
      strategy: 'tiktok:resolve-shortlink',
      ok: Boolean(resolved),
      note: resolved ? `video ${resolved}` : `HTTP ${landed.status}`,
    })
  }

  if (videoId && /^\d{8,}$/.test(videoId)) {
    const embed = await fetchText(`https://www.tiktok.com/embed/v2/${videoId}`, {
      agent: 'browser',
      timeout: 9000,
    })

    let data: TikTokVideoData | null = null
    const blob = /<script id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/.exec(embed.body)?.[1]
    if (blob) {
      try {
        const parsed = JSON.parse(blob) as { source?: { data?: Record<string, unknown> } }
        const entry = Object.values(parsed.source?.data ?? {})[0] as
          | { videoData?: TikTokVideoData }
          | undefined
        data = entry?.videoData ?? null
      } catch {
        data = null
      }
    }

    attempts.push({
      strategy: 'tiktok:embed-v2',
      ok: Boolean(data?.itemInfos),
      note: data?.itemInfos
        ? 'views, likes, comments, shares, followers'
        : blob
          ? 'embed returned an error entry — video deleted or private'
          : `HTTP ${embed.status} — no embed state`,
    })

    if (data?.itemInfos) {
      const info = data.itemInfos
      const author = data.authorInfos ?? {}
      const text = info.text ?? ''
      const createdSeconds = Number(info.createTime)

      const images = data.imagePostInfo?.images
        ?.map((i) => i.imageURL?.urlList?.[0])
        .filter((u): u is string => Boolean(u))

      const media: MediaItem[] = images?.length
        ? images.map((url) => ({ kind: 'image' as const, url, thumbnailUrl: url }))
        : [
            {
              kind: 'video' as const,
              url: info.video?.urls?.[0] ?? id.canonical,
              thumbnailUrl: info.coversOrigin?.[0] ?? info.covers?.[0] ?? null,
              width: info.video?.videoMeta?.width ?? null,
              height: info.video?.videoMeta?.height ?? null,
              durationSeconds: info.video?.videoMeta?.duration ?? null,
              alt: text || null,
            },
          ]

      const views = tikTokMetric(info.playCount)
      const likes = tikTokMetric(info.diggCount)
      const comments = tikTokMetric(info.commentCount)
      const shares = tikTokMetric(info.shareCount)
      const interactions = (likes.value ?? 0) + (comments.value ?? 0) + (shares.value ?? 0)

      return {
        ok: true,
        attempts,
        confidence: 'high',
        snapshot: {
          platform: 'TikTok',
          postType: images?.length ? 'Image' : 'Short / Reel',
          publishedAt:
            Number.isFinite(createdSeconds) && createdSeconds > 0
              ? new Date(createdSeconds * 1000).toISOString()
              : null,
          author: {
            name: author.nickName ?? author.uniqueId ?? null,
            handle: author.uniqueId ?? null,
            profileUrl: author.uniqueId ? `https://www.tiktok.com/@${author.uniqueId}` : null,
            avatarUrl: author.covers?.[0] ?? null,
            verified: author.verified ?? null,
            followers: tikTokMetric(data.authorStats?.followerCount),
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
            hashtags:
              data.textExtra
                ?.map((t) => t.hashtagName)
                .filter((h): h is string => Boolean(h)) ??
              [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1] as string),
            mentions:
              data.textExtra?.map((t) => t.userUniqueId).filter((u): u is string => Boolean(u)) ??
              [],
            outboundLinks: [],
          },
          engagement: {
            likes,
            comments,
            shares,
            views,
            engagementRate: views.value ? interactions / views.value : null,
          },
          media,
        },
        extra: {
          authorBio: author.signature ?? null,
          authorTotalLikes: data.authorStats?.heartCount ?? null,
          authorVideoCount: data.authorStats?.videoCount ?? null,
          countsRounded: Boolean(views.display || likes.display),
        },
      }
    }
  }

  // ── Fallback: oEmbed. Caption and author only — it has never carried a
  // single engagement number and is not going to start.
  const res = await fetchJson<{
    title?: string
    author_name?: string
    author_url?: string
    thumbnail_url?: string
  }>(`https://www.tiktok.com/oembed?url=${encodeURIComponent(id.canonical)}`, { timeout: 7000 })

  const d = res.data
  attempts.push({
    strategy: 'tiktok:oembed',
    ok: Boolean(d?.title),
    note: d?.title ? 'caption + author, no engagement' : `HTTP ${res.status}`,
  })
  if (!d?.title) return { ok: false, attempts }

  return {
    ok: true,
    attempts,
    confidence: 'low',
    blocked: {
      reason: 'TikTok returned the caption but not the engagement counts.',
      suggestion:
        'Its embed endpoint refused this video. Type the view and like counts in below and the report will use them.',
    },
    snapshot: {
      platform: 'TikTok',
      postType: 'Short / Reel',
      publishedAt: null,
      author: {
        name: d.author_name ?? null,
        handle: d.author_name ?? null,
        profileUrl: d.author_url ?? null,
        avatarUrl: null,
        verified: null,
        followers: { value: null, source: 'unavailable' },
        accountType: 'Unknown',
        declaredLocation: null,
      },
      content: {
        text: d.title,
        title: null,
        languageCode: null,
        languageName: null,
        translation: null,
        transcript: null,
        hashtags: [...d.title.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1] as string),
        mentions: [],
        outboundLinks: [],
      },
      engagement: empty,
      media: d.thumbnail_url ? [{ kind: 'video', url: id.canonical, thumbnailUrl: d.thumbnail_url }] : [],
    },
  }
}

/**
 * Reddit comment bodies, via the Atom feed — OFF by default, and deliberately.
 *
 * The route works: /r/{sub}/comments/{id}/.rss answers 200 with the full
 * comment tree (187 comments on one test thread, 47 on another) while every
 * form of .json answers 403. The bodies are exactly the signal the public
 * narrative reading needs.
 *
 * It is off because of what happens when it fails. Reddit's limit here is about
 * ONE request per minute per IP: a short burst returned 429, then escalated to
 * a domain-wide 403 that served a block page and ALSO killed embed.reddit.com —
 * the endpoint the existing, working count path depends on — for eighteen
 * minutes. Every user of a deployed site shares one egress IP, so turning this
 * on by default would let one Reddit link take Reddit extraction down for
 * everybody, trading a feature for the thing that already works.
 *
 * Set ALLOW_REDDIT_COMMENTS=true to enable it on a deployment where that
 * trade-off is acceptable. Strictly one request, never retried.
 *
 * The feed carries no score, so these cannot be weighted — but its order is
 * Reddit's own "best" sort rather than chronological, so the first entries are
 * the top comments.
 */
const ALLOW_REDDIT_COMMENTS = process.env['ALLOW_REDDIT_COMMENTS'] === 'true'

async function fetchRedditComments(permalink: string, limit = 100): Promise<Comment[]> {
  if (!ALLOW_REDDIT_COMMENTS) return []

  const url = `${permalink.replace(/\/+$/, '')}/.rss?limit=${limit}`
  let body: string
  try {
    const res = await fetchText(url, { agent: 'browser', timeout: 6000 })
    if (!res.ok || !res.body) return []
    body = res.body
  } catch {
    return []
  }

  const out: Comment[] = []
  for (const entry of body.split('<entry>').slice(1)) {
    // t3_ is the post itself; only t1_ entries are comments.
    if (!/<id>t1_/.test(entry)) continue

    const raw = /<content type="html">([\s\S]*?)<\/content>/.exec(entry)?.[1]
    if (!raw) continue

    // Atom escapes the HTML, so it needs decoding twice: once to markup, then
    // the entities inside that markup.
    const text = (decodeEntities(decodeEntities(raw)) ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue

    out.push({
      text,
      author: /<name>([^<]{1,60})<\/name>/.exec(entry)?.[1] ?? null,
      // The feed publishes no score at all, so this is genuinely unknown
      // rather than zero.
      likes: null,
      publishedAt: /<updated>([^<]+)<\/updated>/.exec(entry)?.[1] ?? null,
      isReply: false,
    })
    if (out.length >= limit) break
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Reddit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reddit's `.json` endpoint is gone. Every form of it — www, old, api, with and
 * without the subreddit, under three different User-Agents — answers 403 with
 * the "whoa there, pardner" page, and it does so from residential IPs too, so
 * this is an endpoint-level block rather than a datacentre filter. There is no
 * User-Agent that gets past it and no mirror still standing.
 *
 * What does still work, keyless, is Reddit's own embed host:
 *
 *   1. oEmbed  — title, author, and the canonical permalink. The subreddit in
 *                the request URL is required syntactically but not validated,
 *                so a placeholder recovers the real subreddit from a bare id.
 *   2. embed.reddit.com — server-rendered, carries the score, the comment
 *                count and the exact timestamp.
 *
 * Both legs fail as HTTP 200, which is the whole difficulty: a short
 * User-Agent gets a 200 block page from oEmbed, and dropping `/r/{sub}/` from
 * the embed URL gets a 200 empty shell. Everything here is therefore validated
 * by content.
 */

const REDDIT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/** Reddit's block pages all return 200, so detect them by their words. */
const isRedditBlock = (html: string) =>
  /whoa there, pardner|blocked due to a network policy|Just a moment\.\.\.|Verifying your browser/i.test(
    html,
  )

interface RedditOEmbed {
  title?: string
  author_name?: string
  author_url?: string
  html?: string
  thumbnail_url?: string
}

async function extractReddit(id: UrlIdentity): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = []
  const postId = id.id
  if (!postId) {
    return { ok: false, attempts: [{ strategy: 'reddit:parse-id', ok: false, note: 'No post id' }] }
  }

  // The subreddit may already be in the URL; if not, oEmbed hands it back.
  let sub = /\/r\/([^/]+)\//.exec(new URL(id.canonical).pathname)?.[1] ?? null

  const oembed = await fetchJson<RedditOEmbed>(
    `https://www.reddit.com/oembed?url=${encodeURIComponent(
      `https://www.reddit.com/r/${sub ?? 'x'}/comments/${postId}/`,
    )}`,
    { timeout: 7000, headers: { 'User-Agent': REDDIT_UA } },
  )

  const meta = oembed.data
  const permalink = /href="(https:\/\/www\.reddit\.com\/r\/[^"]+)"/.exec(meta?.html ?? '')?.[1] ?? null
  // The embed blockquote holds the real title even when `title` is absent.
  const embeddedTitle = /<a href="https:\/\/www\.reddit\.com\/r\/[^"]+"[^>]*>([^<]+)<\/a>/.exec(
    meta?.html ?? '',
  )?.[1]
  const title = (meta?.title ?? embeddedTitle ?? '').trim() || null
  sub = /reddit\.com\/r\/([^/]+)\//.exec(permalink ?? '')?.[1] ?? sub

  // Off unless explicitly enabled — see fetchRedditComments for why.
  const redditComments = await fetchRedditComments(
    permalink ?? `https://www.reddit.com/r/${sub ?? ''}/comments/${postId}/`,
  )

  attempts.push({
    strategy: 'reddit:oembed',
    ok: Boolean(meta?.author_name || title),
    note: meta?.author_name || title ? `r/${sub ?? '?'} · title + author` : `HTTP ${oembed.status}`,
  })

  // ── Engagement: the embed host is the only keyless source left ────────────
  let score: number | null = null
  let comments: number | null = null
  let publishedAt: string | null = null
  let author = meta?.author_name ?? null

  if (sub) {
    const embed = await fetchText(`https://embed.reddit.com/r/${sub}/comments/${postId}/`, {
      agent: 'browser',
      timeout: 9000,
      headers: { 'User-Agent': REDDIT_UA },
    })
    const html = embed.body
    const blocked = isRedditBlock(html)

    if (!blocked) {
      score = parseCount(/faceplate-number number="(\d+)"/.exec(html)?.[1] ?? '')
      comments = parseCount(/(\d[\d,]*)\s+comments/.exec(html)?.[1] ?? '')
      // Reddit emits "2026-08-13T22:53:21.457000+0000" — microsecond precision
      // and a colonless offset, neither of which is valid ISO 8601. V8 accepts
      // it; Safari does not, and this value is parsed again in the browser.
      const ts = /faceplate-timeago ts="([^"]+)"/.exec(html)?.[1]
      if (ts) {
        const d = new Date(ts.replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
        publishedAt = Number.isNaN(d.getTime()) ? null : d.toISOString()
      }
      author = /href="https:\/\/www\.reddit\.com\/user\/([^/"?]+)/.exec(html)?.[1] ?? author
    }

    attempts.push({
      strategy: 'reddit:embed-host',
      // A 200 with no score is the empty shell, which is a failure.
      ok: score != null,
      note: blocked
        ? 'Reddit served its block page'
        : score != null
          ? 'score + comment count'
          : 'page returned but carried no score',
    })
  }

  if (!title && score == null) {
    return {
      ok: false,
      attempts,
      blocked: {
        reason: 'Reddit did not return this post to an unauthenticated request.',
        suggestion:
          'Reddit blocks server-side reads of post bodies. Paste the post text below and we will analyse it with whatever numbers we did get.',
      },
    }
  }

  return {
    ok: true,
    attempts,
    confidence: score != null ? 'medium' : 'low',
    // Reddit gives us the title but never the body from a datacentre. Saying so
    // is the difference between a short post and a truncated one.
    blocked: {
      reason:
        'Reddit publishes the title, author, score and comment count to embeds, but not the post body — that needs a logged-in read.',
      suggestion:
        'If the post has a text body, paste it below and the analysis will cover it too.',
    },
    snapshot: {
      platform: 'Reddit',
      ...(redditComments.length ? { comments: redditComments } : {}),
      postType: 'Original Post',
      publishedAt,
      author: {
        name: author,
        handle: author,
        profileUrl: author ? `https://www.reddit.com/user/${author}` : null,
        avatarUrl: null,
        verified: null,
        followers: { value: null, source: 'unavailable' },
        accountType: 'Individual',
        declaredLocation: sub ? `r/${sub}` : null,
      },
      content: {
        text: title,
        title,
        languageCode: null,
        languageName: null,
        translation: null,
        transcript: null,
        hashtags: [],
        mentions: [],
        outboundLinks: permalink ? [permalink] : [],
      },
      engagement: {
        // Reddit's score is upvotes minus downvotes, not a like count. It can
        // legitimately be negative, so `|| null` would erase a real -12.
        likes: metric(score, 'public-endpoint'),
        comments: metric(comments, 'public-endpoint'),
        shares: { value: null, source: 'unavailable' },
        views: { value: null, source: 'unavailable' },
        engagementRate: null,
      },
      media: meta?.thumbnail_url
        ? [{ kind: 'image', url: meta.thumbnail_url, thumbnailUrl: meta.thumbnail_url }]
        : [],
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Universal fallback — OpenGraph + JSON-LD + Readability
// ─────────────────────────────────────────────────────────────────────────────

async function extractGeneric(id: UrlIdentity, platform: Platform): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = []

  // Some sites serve OG tags only to crawlers, so escalate identity on failure.
  let page = await fetchText(id.canonical, { agent: 'browser', timeout: 9000 })
  if (!page.ok || !/og:title|<title/i.test(page.body)) {
    attempts.push({ strategy: 'web:browser-ua', ok: false, note: `HTTP ${page.status}` })
    page = await fetchText(id.canonical, { agent: 'facebook', timeout: 8000 })
  }

  if (!page.ok || !page.body) {
    attempts.push({ strategy: 'web:crawler-ua', ok: false, note: `HTTP ${page.status}` })
    return {
      ok: false,
      attempts,
      blocked: {
        reason: 'That page did not respond to our server.',
        suggestion: 'It may be behind a login or blocking automated reads. Paste the text below instead.',
      },
    }
  }

  const meta = parseMetadata(page.body, page.url)
  const rawArticle = meta.articleText ?? (await readArticle(page.body, page.url))

  // The link may have redirected somewhere that is not an article at all —
  // WhatsApp-forwarded shortlinks routinely land on an app-store listing whose
  // description reads like real prose.
  const landedOffTarget =
    /play\.google\.com|apps\.apple\.com|\/store\/apps\//i.test(page.url) ||
    Boolean(detectJunk(meta.title))

  // Reject text that is obviously the page's furniture rather than its content.
  // Without this the analyser happily reports on a cookie banner.
  //
  // The description is only judged when there is no article body to fall back
  // on. Plenty of real news pages carry a consent notice in og:description
  // while the article itself extracted fine, and discarding a good body
  // because of the page's furniture would be the opposite of the intent.
  const junkReason = landedOffTarget
    ? 'the link leads to an app listing rather than a post'
    : rawArticle
      ? detectJunk(rawArticle)
      : detectJunk(meta.description)
  const article = junkReason ? null : rawArticle

  attempts.push({
    strategy: 'web:opengraph',
    ok: Boolean(article) && !junkReason,
    note: junkReason
      ? `discarded — ${junkReason}`
      : article
        ? `${article.length} chars of body text`
        : 'metadata only',
  })

  // E-papers are images, not text. Stripping the `_ss` suffix from the OG image
  // yields the print-resolution scan, which a vision model can actually read.
  const isEpaper = /epaper/i.test(id.canonical)
  const fullPageScan = isEpaper && meta.image ? meta.image.replace(/_ss(\.\w+)$/, '$1') : null

  if (isEpaper) {
    attempts.push({
      strategy: 'web:epaper-scan',
      ok: Boolean(fullPageScan),
      note: fullPageScan
        ? 'e-papers carry no server-side text; found the print-resolution scan'
        : 'no page scan found',
    })
  }

  // If all we have is junk or an off-target redirect, say so rather than
  // dressing it up as a successful read.
  if (!article && (junkReason || landedOffTarget)) {
    return {
      ok: false,
      attempts,
      confidence: 'low',
      blocked: {
        reason: landedOffTarget
          ? 'That link opens an app rather than a web page, so there is nothing for us to read.'
          : `We reached the page, but ${junkReason}.`,
        suggestion: isEpaper
          ? 'E-paper pages are scanned images. Upload a screenshot of the article and we will read it.'
          : 'Open the link yourself, then paste the text or a screenshot here.',
      },
      extra: {
        siteName: meta.siteName,
        ...(fullPageScan ? { scanUrl: fullPageScan, needsOcr: true } : {}),
        landedOn: page.url,
      },
    }
  }

  const media: MediaItem[] = []
  if (fullPageScan) media.push({ kind: 'image', url: fullPageScan, thumbnailUrl: meta.image, alt: 'E-paper page scan' })
  else if (meta.image) media.push({ kind: 'image', url: meta.image, thumbnailUrl: meta.image })
  if (meta.video) media.push({ kind: 'video', url: meta.video, thumbnailUrl: meta.image ?? null })

  const text = article ?? meta.description

  return {
    ok: Boolean(meta.title || text),
    attempts,
    confidence: article ? 'high' : meta.title ? 'medium' : 'low',
    snapshot: {
      platform,
      postType: 'Article',
      publishedAt: meta.publishedAt,
      author: {
        name: meta.author ?? meta.siteName,
        handle: null,
        profileUrl: null,
        avatarUrl: null,
        verified: null,
        followers: { value: null, source: 'unavailable' },
        accountType: meta.siteName ? 'News Outlet' : 'Unknown',
        declaredLocation: null,
      },
      content: {
        text: text ?? null,
        title: meta.title,
        languageCode: meta.lang,
        languageName: null,
        translation: null,
        transcript: null,
        hashtags: meta.keywords.filter((k) => k.startsWith('#')).map((k) => k.slice(1)),
        mentions: [],
        outboundLinks: [],
      },
      engagement: {
        likes: metric(meta.interactions.like ?? null, 'page-scrape'),
        comments: metric(meta.interactions.comment ?? null, 'page-scrape'),
        shares: metric(meta.interactions.share ?? null, 'page-scrape'),
        views: metric(meta.interactions.view ?? null, 'page-scrape'),
        engagementRate: null,
      },
      media,
    },
    extra: {
      siteName: meta.siteName,
      keywords: meta.keywords,
      isWall: meta.isWall,
      ...(fullPageScan ? { scanUrl: fullPageScan, needsOcr: true } : {}),
    },
  }
}

/**
 * Run the platform adapter, and fall back to the OpenGraph floor if it fails.
 *
 * The fallback keeps the adapter's attempts. Dropping them left the report
 * saying only "web:browser-ua — HTTP 408" for a TikTok link, which describes
 * the last thing we tried rather than the thing that actually failed. The
 * attempt list is how a user finds out *which* platform withheld *what*, so it
 * has to survive the fallback.
 */
async function withGenericFallback(
  id: UrlIdentity,
  platform: Platform,
  run: () => Promise<ExtractResult>,
): Promise<ExtractResult> {
  const specific = await run()
  if (specific.ok) return specific

  const generic = await extractGeneric(id, platform)
  return {
    ...generic,
    attempts: [...specific.attempts, ...generic.attempts],
    // The adapter knows why its platform said no; the generic reader only
    // knows that a URL did not parse. Prefer the specific explanation.
    blocked: specific.blocked ?? generic.blocked,
  }
}

export async function extractWeb(id: UrlIdentity, _ctx: ExtractContext): Promise<ExtractResult> {
  switch (id.platform) {
    case 'LinkedIn':
      return withGenericFallback(id, 'LinkedIn', () => extractLinkedIn(id))
    case 'Telegram':
      return withGenericFallback(id, 'Telegram', () => extractTelegram(id))
    case 'TikTok':
      return withGenericFallback(id, 'TikTok', () => extractTikTok(id))
    case 'Reddit':
      return withGenericFallback(id, 'Reddit', () => extractReddit(id))
    default:
      return extractGeneric(id, id.platform)
  }
}
