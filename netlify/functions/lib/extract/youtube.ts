import type { Comment, PostSnapshot, Metric, MediaItem } from '../../../../shared/types'
import type { UrlIdentity } from '../platform'
import { fetchText, fetchJson } from '../fetcher'
import { parseCount } from '../metadata'
import { parseEmbedded, findKey, findObjectWith, ytText, collectKey} from './json-scan'
import type { ExtractContext, ExtractResult } from './types'

/**
 * YouTube adapter.
 *
 * Verified live against the workbook's own links: the watch-page HTML carries
 * exact view counts, the full untruncated description, publish date, tags,
 * duration, subscriber count and — uniquely — the verified badge, which the
 * official Data API does not expose at all.
 *
 * Two facts drive the design here:
 *  1. Likes/comments/subscribers come back abbreviated once large ("19m"), so
 *     every count is tagged exact-vs-approximate rather than silently rounded.
 *  2. Transcripts are unobtainable from a datacentre IP — YouTube requires a
 *     proof-of-origin token and returns 200-with-empty-body without one. We
 *     read the caption *track list* (which does work) and tell the user the
 *     language exists but the text does not, instead of failing silently.
 */

interface YtPlayerResponse {
  videoDetails?: {
    videoId?: string
    title?: string
    shortDescription?: string
    viewCount?: string
    lengthSeconds?: string
    keywords?: string[]
    author?: string
    channelId?: string
    isLiveContent?: boolean
    thumbnail?: { thumbnails?: Array<{ url: string; width: number; height: number }> }
  }
  microformat?: {
    playerMicroformatRenderer?: {
      publishDate?: string
      uploadDate?: string
      category?: string
      ownerChannelName?: string
      ownerProfileUrl?: string
      description?: { simpleText?: string }
    }
  }
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{
        languageCode?: string
        kind?: string
        name?: { simpleText?: string; runs?: Array<{ text: string }> }
      }>
    }
  }
  playabilityStatus?: { status?: string; reason?: string }
}

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * The exact like count, from the like button's screen-reader label.
 *
 * YouTube shows "19M" but tells a screen reader "like this video along with
 * 19,332,347 other people" — the full number, in the HTML we already fetched.
 * That closes the single biggest precision gap in this adapter at zero extra
 * network cost, and without an API key.
 *
 * Two traps, both verified live:
 *  - The same page carries `"accessibilityText":"19 million likes"` from the
 *    description factoid. Matching a bare accessibilityText near the like
 *    button picks that up and rounds 19,332,347 to 19,000,000. Anchoring on
 *    "along with … other people" is what makes this safe.
 *  - The phrase is localised, so the request must ask for English.
 */
function exactLikesFrom(html: string): number | null {
  const m = /like this video along with ([\d,.   ]+?) other people/.exec(html)
  if (!m?.[1]) return null
  // Locale grouping may be commas, periods, or thin spaces — keep only digits.
  const digits = m[1].replace(/\D/g, '')
  if (!digits) return null
  const n = Number(digits)
  return Number.isSafeInteger(n) ? n : null
}

/**
 * The comment count, exactly, with no API key.
 *
 * Comments are lazily loaded, so the count is in neither the watch page nor a
 * plain InnerTube `/next` call — only in the comments *continuation* response.
 * The continuation token looks opaque but is a pure function of the video id,
 * so we build it rather than scrape it, which also guarantees we get the main
 * column's token: the engagement-panel token returns a header with no count
 * field at all.
 *
 * Costs one extra request, so callers only fire it when the cheap read came
 * back abbreviated.
 */
function commentsContinuation(videoId: string): string {
  const v = Buffer.from(videoId, 'utf8')
  // Video ids are 11 characters, so every length here fits a single-byte
  // protobuf varint. Guard anyway rather than emit a malformed token.
  if (v.length === 0 || v.length > 120) return ''

  const inner = Buffer.concat([
    Buffer.from([0x22, v.length]),
    v,
    Buffer.from([0x30, 0x00, 0x78, 0x02]),
  ])
  const section = Buffer.from('comments-section', 'utf8')
  const field6 = Buffer.concat([
    Buffer.from([0x22, inner.length]),
    inner,
    Buffer.from([0x42, section.length]),
    section,
  ])
  return Buffer.concat([
    Buffer.from([0x12, v.length + 2, 0x12, v.length]),
    v,
    Buffer.from([0x18, 0x06, 0x32, field6.length]),
    field6,
  ]).toString('base64')
}

interface InnerTubeNext {
  onResponseReceivedEndpoints?: Array<{
    reloadContinuationItemsCommand?: {
      continuationItems?: Array<{
        commentsHeaderRenderer?: { countText?: { runs?: Array<{ text?: string }> } }
      }>
    }
  }>
}

/**
 * The comment count AND the top comment bodies, from one request.
 *
 * This function used to return only the count, reading one string out of
 * `onResponseReceivedEndpoints[0]` and discarding the other 244KB of a response
 * it had already paid for. `onResponseReceivedEndpoints[1]` carries twenty
 * top-level comment threads, and `frameworkUpdates.entityBatchUpdate.mutations`
 * carries their text. Reading them costs no extra request and no extra bytes.
 *
 * The threads and the mutations must be joined BY KEY, never by index — their
 * orders genuinely differ, so zipping them pairs each comment with someone
 * else's text. The key is nested twice
 * (`commentViewModel.commentViewModel.commentKey`); reading it one level up
 * returns undefined and yields zero comments rather than an error.
 */
/**
 * How many comments to read, and how long to spend reading them.
 *
 * A hundred is what makes the public-narrative reading a measurement rather
 * than an impression, and it is five sequential requests at roughly 3.1s. That
 * is real money against a request the platform closes at about sixteen
 * seconds, so the budget is the binding constraint, not the target: whatever
 * arrived when it expires is what gets analysed. The first twenty are free —
 * that request was already being made for the count alone.
 */
const COMMENT_TARGET = 100
const COMMENT_BUDGET_MS = 3_000

async function fetchExactComments(
  videoId: string,
  target = COMMENT_TARGET,
  budgetMs = COMMENT_BUDGET_MS,
): Promise<{ count: number | null; comments: Comment[] }> {
  const empty = { count: null, comments: [] as Comment[] }
  let token: string | null = commentsContinuation(videoId)
  if (!token) return empty

  const started = Date.now()
  const out: ReadComment[] = []
  const seen = new Set<string>()
  let count: number | null = null

  // Twenty per request is a hard ceiling — there is no page-size parameter, and
  // the mobile client that returns more returns no bodies at all. So a hundred
  // comments is five hops, and the loop stops on whichever of target, budget or
  // end-of-thread arrives first rather than on hop count alone.
  while (token && out.length < target && Date.now() - started < budgetMs) {
    const res = await fetchJson<InnerTubeNext>(
      'https://www.youtube.com/youtubei/v1/next?prettyPrint=false',
      {
        timeout: 6000,
        // clientVersion is load-bearing: without it InnerTube answers 400
        // "failedPrecondition". No API key and no User-Agent are required.
        json: {
          context: {
            client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en', gl: 'US' },
          },
          continuation: token,
        },
      },
    )
    if (!res.data) break

    if (count == null) {
      const text =
        res.data.onResponseReceivedEndpoints?.[0]?.reloadContinuationItemsCommand
          ?.continuationItems?.[0]?.commentsHeaderRenderer?.countText?.runs?.[0]?.text
      const digits = (text ?? '').replace(/\D/g, '')
      const n = digits ? Number(digits) : NaN
      count = Number.isSafeInteger(n) ? n : null
    }

    const page = readComments(res.data)
    if (!page.length) break
    for (const c of page) {
      if (out.length >= target) break
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push(c)
    }

    token = nextCommentsToken(res.data)
  }

  return { count, comments: out }
}

/**
 * Pull the comment bodies out of an InnerTube /next response.
 *
 * Failure here is silent by design at the HTTP layer: a video with comments
 * disabled, and a video id that does not exist, both answer 200 with a ~1KB
 * body carrying only `responseContext`. There is nothing to detect but the
 * absence of content, so absence is what this returns — an empty list, never a
 * throw, because a post with no readable comments is a normal result.
 */

/**
 * The token for the next page of comments.
 *
 * Two traps here. The continuation lives in `onResponseReceivedEndpoints`, but
 * under a different command on page one (`reloadContinuationItemsCommand`) than
 * on every page after (`appendContinuationItemsAction`), so both have to be
 * read. And each comment thread carries its own `continuationItemRenderer` for
 * "show replies" — those have a `button`. Taking the first match walks into a
 * reply thread instead of the next page; the page token is the one without it.
 */
function nextCommentsToken(data: unknown): string | null {
  const endpoints = (data as { onResponseReceivedEndpoints?: unknown[] })?.onResponseReceivedEndpoints
  if (!Array.isArray(endpoints)) return null

  for (const ep of endpoints) {
    const cmd =
      (ep as Record<string, Record<string, unknown>>)?.['reloadContinuationItemsCommand'] ??
      (ep as Record<string, Record<string, unknown>>)?.['appendContinuationItemsAction']
    const items = cmd?.['continuationItems']
    if (!Array.isArray(items)) continue

    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i] as Record<string, Record<string, unknown>> | undefined
      const renderer = item?.['continuationItemRenderer']
      if (!renderer || renderer['button']) continue
      const token = (
        (renderer['continuationEndpoint'] as Record<string, Record<string, unknown>>)?.[
          'continuationCommand'
        ] as Record<string, unknown> | undefined
      )?.['token']
      if (typeof token === 'string' && token) return token
    }
  }
  return null
}

type ReadComment = Comment & { id: string }

function readComments(data: unknown): ReadComment[] {
  if (!data || typeof data !== 'object') return []

  // Text, author and like count live in a flat mutation list, keyed.
  const byKey = new Map<string, Record<string, unknown>>()
  for (const mutation of collectKey(data, 'mutations', 4).flat()) {
    const payload = (mutation as Record<string, unknown>)?.['payload'] as
      | Record<string, unknown>
      | undefined
    const entity = payload?.['commentEntityPayload'] as Record<string, unknown> | undefined
    const key = entity?.['key']
    if (typeof key === 'string' && entity) byKey.set(key, entity)
  }
  if (!byKey.size) return []

  // Walk the threads for ordering, and to know which are replies. Where the
  // thread list is unreadable, fall back to mutation order rather than
  // returning nothing — the text is the part that matters.
  const ordered: Record<string, unknown>[] = []
  const seen = new Set<string>()
  for (const vm of collectKey(data, 'commentViewModel', 400)) {
    const key = ((vm as Record<string, unknown>)?.['commentViewModel'] as
      | Record<string, unknown>
      | undefined)?.['commentKey']
    if (typeof key !== 'string' || seen.has(key)) continue
    const entity = byKey.get(key)
    if (!entity) continue
    seen.add(key)
    ordered.push(entity)
  }
  const entities = ordered.length ? ordered : [...byKey.values()]

  return entities
    .map((entity): ReadComment | null => {
      const content = entity['properties'] as Record<string, unknown> | undefined
      const body = (content?.['content'] as Record<string, unknown> | undefined)?.['content']
      if (typeof body !== 'string' || !body.trim()) return null

      const author = entity['author'] as Record<string, unknown> | undefined
      const toolbar = entity['toolbar'] as Record<string, unknown> | undefined

      // YouTube abbreviates comment likes ("300K") with no exact value anywhere
      // in the payload, so a large count is genuinely approximate. A comment
      // with no likes carries a single space rather than an empty string.
      const rawLikes = toolbar?.['likeCountNotliked']
      const likes = typeof rawLikes === 'string' ? parseCount(rawLikes.trim()) : null

      return {
        id: typeof content?.['commentId'] === 'string' ? (content['commentId'] as string) : body,
        text: body,
        author: typeof author?.['displayName'] === 'string' ? (author['displayName'] as string) : null,
        likes,
        // Comments carry only a relative string ("8 months ago"); inventing an
        // absolute date from it would be fabrication.
        publishedAt: null,
        isReply: Number(content?.['replyLevel'] ?? 0) > 0,
      }
    })
    .filter((c): c is ReadComment => c !== null)
}

/**
 * Turn a YouTube display string into a metric.
 * Prefers the accessibility label ("19 million likes") over the abbreviation
 * ("19m") because it parses unambiguously, and flags approximation so the UI
 * can render "~19M" rather than implying precision we do not have.
 */
function displayMetric(
  display: string | null,
  accessibilityLabel: string | null,
  source: Metric['source'],
): Metric {
  const raw = accessibilityLabel ?? display
  if (!raw) return { value: null, source: 'unavailable' }

  const value = parseCount(raw.replace(/[^\d.,kmbKMB\s]/g, ' ').trim()) ?? parseCount(display)
  const approximate = /[kmb]/i.test(display ?? '') || /million|thousand|billion|lakh|crore/i.test(raw)

  return {
    value,
    source,
    ...(approximate && display ? { display: display.trim() } : {}),
  }
}

/**
 * The same data, from YouTube's own app API instead of the web page.
 *
 * Google fingerprints HTTP clients, not just IPs: measured side by side in the
 * same second from the same address with identical headers, curl gets the watch
 * page and our client gets redirected to google.com/sorry/ with a 429. Once
 * that happens the watch page stays blocked, and falling straight through to
 * oEmbed drops the report to a bare title with no numbers at all.
 *
 * `/youtubei/v1/next` is not subject to the same filter — verified returning
 * 332KB of full data in the same second the watch page was refused. It needs no
 * API key and no User-Agent; `clientVersion` is the only load-bearing field,
 * and omitting it answers 400. Its payload has the same shape as the page's
 * `ytInitialData`, so the same helpers read it.
 *
 * What it does not carry: duration, keywords and the caption track list. Those
 * degrade to null rather than blocking the report.
 */
async function extractViaInnerTube(
  videoId: string,
  id: UrlIdentity,
): Promise<ExtractResult> {
  const res = await fetchJson<unknown>(
    'https://www.youtube.com/youtubei/v1/next?prettyPrint=false',
    {
      timeout: 8000,
      json: {
        context: { client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en', gl: 'US' } },
        videoId,
      },
    },
  )

  const data = res.data
  const primary = data
    ? (findObjectWith(data, 'videoPrimaryInfoRenderer')?.['videoPrimaryInfoRenderer'] as
        | Record<string, unknown>
        | undefined)
    : undefined
  const title = ytText(primary?.['title'])

  if (!data || !title) {
    return {
      ok: false,
      attempts: [
        {
          strategy: 'youtube:innertube-next',
          ok: false,
          note: res.status === 200 ? 'responded without video data' : `HTTP ${res.status}`,
        },
      ],
    }
  }

  const secondary = findObjectWith(data, 'videoSecondaryInfoRenderer')?.[
    'videoSecondaryInfoRenderer'
  ] as Record<string, unknown> | undefined
  const owner = findObjectWith(data, 'videoOwnerRenderer')?.['videoOwnerRenderer'] as
    | Record<string, unknown>
    | undefined

  // The exact like count rides in the same screen-reader label the watch page
  // uses, so the same anchor works. Scanning the serialised payload is cheaper
  // than walking to it: the label's path is deeply nested and moves between
  // layouts, the phrase does not.
  const serialised = JSON.stringify(data)
  const exactLikes = exactLikesFrom(serialised)
  const likeDisplay =
    /"likeButtonViewModel"[\s\S]{0,900}?"title":"([^"]{1,12})"/.exec(serialised)?.[1] ?? null

  const viewsText = ytText(findKey(primary?.['viewCount'], 'viewCount'))
  const views = parseCount((viewsText ?? '').replace(/views?/i, '').trim())

  const dateText = ytText(primary?.['dateText'])
  const published = dateText ? new Date(dateText) : null
  const publishedAt =
    published && !Number.isNaN(published.getTime()) ? published.toISOString() : null

  const ownerUrl = findKey(owner?.['navigationEndpoint'], 'canonicalBaseUrl') as string | undefined
  const channelId = findKey(owner?.['navigationEndpoint'], 'browseId') as string | undefined
  const subsText = ytText(owner?.['subscriberCountText'])
  const avatar = (findKey(owner?.['thumbnail'], 'thumbnails') as Array<{ url?: string }> | undefined)
    ?.slice(-1)[0]?.url
  const verified = /VERIFIED/i.test(JSON.stringify(owner?.['badges'] ?? ''))

  const attributed = secondary?.['attributedDescription'] as { content?: string } | undefined
  const description = attributed?.content ?? ytText(secondary?.['description'])

  const { count: comments, comments: commentBodies } = await fetchExactComments(videoId)

  const attempts: ExtractResult['attempts'] = [
    {
      strategy: 'youtube:innertube-next',
      ok: true,
      note: `exact likes${views != null ? ' + views' : ''} + author, keyless`,
    },
  ]
  if (comments != null) {
    attempts.push({
      strategy: 'youtube:innertube-comments',
      ok: true,
      note: `exact comments (${comments.toLocaleString('en-IN')})`,
    })
  }

  const snapshot: Partial<PostSnapshot> = {
    platform: 'YouTube',
    ...(commentBodies.length ? { comments: commentBodies } : {}),
    postType: id.postType,
    publishedAt,
    author: {
      name: ytText(owner?.['title']),
      handle: ownerUrl?.replace(/^\/@?/, '') ?? null,
      profileUrl: ownerUrl
        ? `https://www.youtube.com${ownerUrl}`
        : channelId
          ? `https://www.youtube.com/channel/${channelId}`
          : null,
      avatarUrl: avatar ?? null,
      verified,
      followers: displayMetric(subsText, null, 'public-endpoint'),
      accountType: 'Unknown',
      declaredLocation: null,
    },
    content: {
      text: description ?? null,
      title,
      languageCode: null,
      languageName: null,
      translation: null,
      transcript: null,
      hashtags: [...(description ?? '').matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1] as string),
      mentions: [],
      outboundLinks: [...(description ?? '').matchAll(/https?:\/\/\S+/g)].map((m) => m[0]),
    },
    engagement: {
      likes:
        exactLikes != null
          ? {
              value: exactLikes,
              source: 'public-endpoint',
              ...(likeDisplay && /[kmb]/i.test(likeDisplay) ? { display: likeDisplay } : {}),
            }
          : displayMetric(likeDisplay, null, 'public-endpoint'),
      comments:
        comments != null
          ? { value: comments, source: 'public-endpoint' }
          : { value: null, source: 'unavailable' },
      shares: { value: null, source: 'unavailable' },
      views: views != null ? { value: views, source: 'public-endpoint' } : { value: null, source: 'unavailable' },
      engagementRate: views && exactLikes != null ? (exactLikes + (comments ?? 0)) / views : null,
    },
    media: [
      {
        kind: 'video',
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        alt: title,
      },
    ],
  }

  return {
    ok: true,
    snapshot,
    attempts,
    confidence: 'high',
    extra: {
      // Named so the report can explain why duration and captions are absent
      // here but present on a video fetched a minute earlier.
      source: 'innertube',
      note: 'Read from YouTube’s app API because Google throttled the web page. Duration, tags and caption languages are not exposed on that route.',
    },
  }
}

export async function extractYouTube(
  id: UrlIdentity,
  ctx: ExtractContext,
): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = []
  const videoId = id.id

  if (!videoId) {
    return {
      ok: false,
      attempts: [{ strategy: 'youtube:parse-id', ok: false, note: 'No video id in the URL' }],
    }
  }

  // ── 1. Watch-page HTML: the richest single source ─────────────────────────
  // hl/gl are not cosmetic: the exact-like label is an English phrase we match
  // on, and the CONSENT cookie skips the EU interstitial, which returns 200
  // with no video data at all.
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US`
  const page = await fetchText(watchUrl, {
    agent: 'browser',
    timeout: 8500,
    headers: { 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1' },
  })

  let player: YtPlayerResponse | null = null
  let initialData: unknown = null

  if (page.ok && page.body) {
    player = parseEmbedded<YtPlayerResponse>(page.body, [
      'var ytInitialPlayerResponse =',
      'ytInitialPlayerResponse =',
      '"playerResponse":',
    ])
    initialData = parseEmbedded(page.body, ['var ytInitialData =', 'ytInitialData ='])
  }

  // Trust the parse only if it is genuinely the video we asked for — both the
  // consent interstitial and the "video unavailable" page return HTTP 200.
  const details = player?.videoDetails
  const idMatches = details?.videoId === videoId

  // Google answers automated-looking traffic with a redirect to
  // google.com/sorry/ — its "unusual traffic" interstitial — carrying HTTP 429.
  // Worth naming precisely: it is not a YouTube outage and not a bad link, and
  // the next leg is specifically the one that survives it.
  const throttled = page.status === 429 || /\/sorry\/index/.test(page.url)

  attempts.push({
    strategy: 'youtube:watch-html',
    ok: Boolean(idMatches),
    note: idMatches
      ? `parsed ${Math.round(page.body.length / 1024)}KB`
      : throttled
        ? 'Google served its unusual-traffic page to our server'
        : page.ok
          ? 'page returned but videoDetails missing or mismatched'
          : `HTTP ${page.status}`,
  })

  if (idMatches && details) {
    const micro = player?.microformat?.playerMicroformatRenderer

    // Subscriber count + verified badge live in ytInitialData, not the player.
    const owner = initialData ? findObjectWith(initialData, 'subscriberCountText') : undefined
    const subsText = owner ? ytText(owner['subscriberCountText']) : null
    const badges = owner?.['badges']
    const verified =
      JSON.stringify(badges ?? '').includes('VERIFIED') ||
      JSON.stringify(badges ?? '').toLowerCase().includes('verified')

    // Likes: the viewModel title is the abbreviation, accessibility text is prose.
    const likeVm = initialData ? findObjectWith(initialData, 'likeButtonViewModel') : undefined
    const likeButton = likeVm ? findObjectWith(likeVm, 'toggleButtonViewModel') : undefined
    const likeTitle =
      (findKey(likeButton ?? likeVm ?? {}, 'title') as string | undefined) ?? null
    const likeA11y =
      (findKey(likeButton ?? likeVm ?? {}, 'accessibilityText') as string | undefined) ?? null

    // Comment count sits in the engagement panel header.
    let commentText: string | null = null
    if (initialData) {
      const panel = findObjectWith(initialData, 'engagementPanelTitleHeaderRenderer')
      const header = panel?.['engagementPanelTitleHeaderRenderer'] as
        | Record<string, unknown>
        | undefined
      commentText = ytText(header?.['contextualInfo'])
    }

    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
    const captionLanguages = tracks
      .map((t) => ytText(t.name) ?? t.languageCode ?? '')
      .filter(Boolean)
    const autoGenerated = tracks.some((t) => t.kind === 'asr')

    const thumbs = details.thumbnail?.thumbnails ?? []
    const best = thumbs.length ? thumbs[thumbs.length - 1] : undefined

    const media: MediaItem[] = [
      {
        kind: 'video',
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnailUrl: best?.url ?? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        width: best?.width ?? null,
        height: best?.height ?? null,
        durationSeconds: num(details.lengthSeconds),
        alt: details.title ?? null,
      },
    ]

    const description = details.shortDescription ?? micro?.description?.simpleText ?? null
    const hashtags = [...(description ?? '').matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1] as string)

    // ── Precision pass ──────────────────────────────────────────────────────
    // The visible like count and comment count are abbreviated once large.
    // Both have keyless exact sources, so reach for those before the API key —
    // the product is meant to work with no keys at all.
    let exactLikes = exactLikesFrom(page.body)
    let exactComments: number | null = null
    let commentBodies: Comment[] = []
    // Which figures the paid API supplied, so provenance stays truthful: a
    // number read from the page is `public-endpoint`, not `platform-api`.
    const apiFilled = new Set<string>()

    if (exactLikes != null) {
      attempts.push({
        strategy: 'youtube:like-a11y-label',
        ok: true,
        note: `exact likes (${exactLikes.toLocaleString('en-IN')}) vs displayed "${likeTitle ?? '?'}"`,
      })
    }

    // This used to fire only when the displayed count was rounded, because a
    // sharper number was the only thing it bought. It now also carries the
    // comment bodies, which are the evidence behind the public-narrative
    // reading — worth a measured ~400ms on every video rather than only on the
    // big ones.
    const scrapedComments = displayMetric(commentText, null, 'page-scrape')
    const got = await fetchExactComments(videoId)
    exactComments = got.count
    commentBodies = got.comments
    if (exactComments != null || commentBodies.length) {
      attempts.push({
        strategy: 'youtube:innertube-comments',
        ok: true,
        note: [
          exactComments != null ? `exact comments (${exactComments.toLocaleString('en-IN')})` : null,
          commentBodies.length ? `${commentBodies.length} comment bodies` : null,
        ]
          .filter(Boolean)
          .join(', '),
      })
    }

    if (ctx.keys.youtube && (exactLikes == null || exactComments == null)) {
      const api = await fetchJson<{
        items?: Array<{ statistics?: { likeCount?: string; commentCount?: string; viewCount?: string } }>
      }>(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}&key=${ctx.keys.youtube}`,
        { timeout: 5000 },
      )
      const stats = api.data?.items?.[0]?.statistics
      // Only fill what the keyless path could not. Overwriting a value we
      // already read exactly buys nothing and spends quota.
      if (exactLikes == null) {
        exactLikes = num(stats?.likeCount)
        if (exactLikes != null) apiFilled.add('likes')
      }
      if (exactComments == null) {
        exactComments = num(stats?.commentCount)
        if (exactComments != null) apiFilled.add('comments')
      }
      attempts.push({
        strategy: 'youtube:data-api-v3',
        ok: Boolean(stats),
        note: stats
          ? apiFilled.size
            ? `filled ${[...apiFilled].join(' + ')}`
            : 'no gaps left to fill'
          : `HTTP ${api.status}`,
      })
    }

    const likes: Metric =
      exactLikes != null
        ? { value: exactLikes, source: apiFilled.has('likes') ? 'platform-api' : 'public-endpoint' }
        : displayMetric(likeTitle, likeA11y, 'page-scrape')

    const comments: Metric =
      exactComments != null
        ? {
            value: exactComments,
            source: apiFilled.has('comments') ? 'platform-api' : 'public-endpoint',
          }
        : scrapedComments

    const views = num(details.viewCount)

    const snapshot: Partial<PostSnapshot> = {
      platform: 'YouTube',
      ...(commentBodies.length ? { comments: commentBodies } : {}),
      postType: details.isLiveContent ? 'Live' : id.postType,
      publishedAt: micro?.publishDate ?? micro?.uploadDate ?? null,
      author: {
        name: details.author ?? micro?.ownerChannelName ?? null,
        // Strip the leading @: ownerProfileUrl ends in "/@kyleslyf", and
        // keeping it produced "@@kyleslyf" everywhere the UI and the
        // spreadsheet prefix a handle with one. Every other platform stores
        // the bare handle, and the export column has to match.
        handle: micro?.ownerProfileUrl?.split('/').pop()?.replace(/^@/, '') || null,
        profileUrl:
          micro?.ownerProfileUrl ??
          (details.channelId ? `https://www.youtube.com/channel/${details.channelId}` : null),
        avatarUrl: null,
        verified,
        followers: displayMetric(subsText, null, 'page-scrape'),
        accountType: 'Unknown',
        declaredLocation: null,
      },
      content: {
        text: description,
        title: details.title ?? null,
        languageCode: null,
        languageName: null,
        translation: null,
        transcript: null,
        hashtags,
        mentions: [],
        outboundLinks: [...(description ?? '').matchAll(/https?:\/\/\S+/g)].map((m) => m[0]),
      },
      engagement: {
        likes,
        comments,
        shares: { value: null, source: 'unavailable' },
        views: { value: views, source: 'page-scrape' },
        engagementRate:
          views && likes.value != null ? (likes.value + (comments.value ?? 0)) / views : null,
      },
      media,
    }

    return {
      ok: true,
      snapshot,
      attempts,
      confidence: 'high',
      extra: {
        tags: details.keywords ?? [],
        category: micro?.category ?? null,
        durationSeconds: num(details.lengthSeconds),
        captions: {
          available: tracks.length > 0,
          languages: captionLanguages,
          autoGenerated,
          // Stated plainly so the UI can explain the gap rather than hide it.
          textAvailable: false,
          note: tracks.length
            ? 'Captions exist on this video but YouTube blocks server-side transcript downloads. Analysis uses the title, description and tags.'
            : null,
        },
      },
    }
  }

  // ── 2. InnerTube: the leg that survives the throttle ──────────────────────
  const inner = await extractViaInnerTube(videoId, id)
  attempts.push(...inner.attempts)
  if (inner.ok) {
    return { ...inner, attempts, ...(inner.extra ? { extra: inner.extra } : {}) }
  }

  // ── 3. oEmbed: tiny, official, always works — title + channel + thumbnail ──
  const oembed = await fetchJson<{
    title?: string
    author_name?: string
    author_url?: string
    thumbnail_url?: string
  }>(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
    { timeout: 5000 },
  )

  attempts.push({
    strategy: 'youtube:oembed',
    ok: Boolean(oembed.data?.title),
    note: oembed.data?.title ? 'title + channel only' : `HTTP ${oembed.status}`,
  })

  if (oembed.data?.title) {
    return {
      ok: true,
      attempts,
      confidence: 'low',
      snapshot: {
        platform: 'YouTube',
        postType: id.postType,
        publishedAt: null,
        author: {
          name: oembed.data.author_name ?? null,
          handle: oembed.data.author_url?.split('/').pop()?.replace('@', '') ?? null,
          profileUrl: oembed.data.author_url ?? null,
          avatarUrl: null,
          verified: null,
          followers: { value: null, source: 'unavailable' },
          accountType: 'Unknown',
          declaredLocation: null,
        },
        content: {
          text: null,
          title: oembed.data.title,
          languageCode: null,
          languageName: null,
          translation: null,
          transcript: null,
          hashtags: [],
          mentions: [],
          outboundLinks: [],
        },
        engagement: {
          likes: { value: null, source: 'unavailable' },
          comments: { value: null, source: 'unavailable' },
          shares: { value: null, source: 'unavailable' },
          views: { value: null, source: 'unavailable' },
          engagementRate: null,
        },
        media: [
          {
            kind: 'video',
            url: `https://www.youtube.com/watch?v=${videoId}`,
            thumbnailUrl: oembed.data.thumbnail_url ?? null,
            alt: oembed.data.title,
          },
        ],
      },
    }
  }

  return {
    ok: false,
    attempts,
    blocked: {
      reason: 'YouTube did not return data for this video.',
      suggestion: 'It may be private, deleted, or age-restricted. Check the link opens in a browser.',
    },
  }
}
