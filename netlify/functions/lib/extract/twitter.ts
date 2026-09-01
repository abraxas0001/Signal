import type { Comment, MediaItem, Metric, PostSnapshot } from '../../../../shared/types'
import type { UrlIdentity } from '../platform'
import { fetchJson, fetchText } from '../fetcher'
import { decodeJsonString } from './json-scan'
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

// ─── Reply bodies ───────────────────────────────────────────────────────────
//
// None of the three legs above carries a single word of what the audience
// said. fxtwitter and vxtwitter report a reply *count*; the syndication CDN
// reports `conversation_count` and nothing else. That is why sentiment on an X
// post used to be read off the post's own text, which measures the author's
// tone rather than the public's answer to it.
//
// x.com itself does carry the replies. Its logged-out post page is
// server-rendered and ships the conversation inline as a normalised Relay
// store, under a `LoggedOutRepliesProduct` timeline.
//
// Which identity asks decides whether this works, and the answer is the
// opposite of the Meta adapter's. Measured against the same post in the same
// minute:
//
//   this product's own UA -> 200, 164KB, the conversation   ★
//   a Chrome UA           -> 200, 164KB, the conversation
//   no User-Agent at all  -> 200, 164KB, the conversation
//   Googlebot             -> 403, empty
//   Twitterbot            -> 200,  33KB, no conversation
//
// So this asks as itself, and deliberately: presenting a crawler identity here
// would be both dishonest and useless, because it is the one identity X
// refuses.
//
// YIELD IS A SAMPLE, not a referendum. A post with one reply returns that one
// reply; popular posts return the three replies X ranks highest, whatever the
// total. Measured: 1 of 1 on Aruna_DK, 3 of 3,699 on RahulGandhi, 3 of 465 on
// KTRBRS. The count is reported alongside in `attempts` for the same reason
// the Facebook reader reports it — two comments out of 361 presented as "the
// reaction" would be a misrepresentation dressed up as data.

/** Keys of the records this reader needs; every other record is skipped. */
const RELAY_KEY = /^(?:client:)?(?:VHdlZXQ6|VXNlcjo)[A-Za-z0-9+/=]*(?::(?:details|counts|core))?$/

const decodeKey = (key: string): string => Buffer.from(key, 'base64').toString('utf8')
const encodeKey = (value: string): string => Buffer.from(value, 'utf8').toString('base64')

/**
 * The inline Relay store, as a map of record key to that record's raw text.
 *
 * Two things stop this being a JSON.parse. The store is emitted as JavaScript,
 * so its keys are bare identifiers and its values are `$R[n]={…}`
 * back-references; and its records are nested inside one another, so a scan
 * that skips past each record it finds sees four of them rather than the two
 * hundred that are there.
 *
 * So: visit every `key:$R[n]={` in the document and brace-match the body,
 * tracking string state so that a brace typed inside a reply cannot end a
 * record early. Nesting is handled by not advancing past a matched record,
 * which means outer records are re-entered and their children found too.
 * Matching is confined to the keys asked for because the outermost records
 * span the whole page and balancing those is the expensive part.
 */
function relayRecords(html: string, wanted: RegExp): Map<string, string> {
  const out = new Map<string, string>()
  // A quoted key may contain the base64 alphabet and colons, never a backslash,
  // so the quoted form needs no escape handling.
  const start = /(?:"([A-Za-z0-9+/=:_.-]+)"|([A-Za-z_$][\w$]*)):\$R\[\d+\]=\{/g

  for (let m = start.exec(html); m; m = start.exec(html)) {
    const key = m[1] ?? m[2]
    if (!key || !wanted.test(key)) continue

    let depth = 0
    let inString = false
    let escaped = false
    let i = start.lastIndex - 1

    for (; i < html.length; i++) {
      const ch = html[i] as string
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = inString
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}' && --depth === 0) break
    }

    out.set(key, html.slice(start.lastIndex - 1, i + 1))
    if (out.size > 4000) break
  }
  return out
}

/**
 * Read a string value out of one record.
 *
 * `readJsonStringField` cannot be reused because the store writes its keys
 * bare. The left-boundary check is not decoration: `screen_name` ends with
 * `name` and `raw_text` ends with `text`, so an unanchored search hands back a
 * neighbouring field's value and the reply is attributed to the wrong person.
 */
function storeString(record: string, key: string): string | null {
  const marker = `${key}:"`
  for (let at = record.indexOf(marker); at !== -1; at = record.indexOf(marker, at + 1)) {
    if (at > 0 && /[\w$]/.test(record[at - 1] as string)) continue

    let i = at + marker.length
    let escaped = false
    for (; i < record.length; i++) {
      const ch = record[i]
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') break
    }
    if (i >= record.length) return null
    return decodeJsonString(record.slice(at + marker.length, i))
  }
  return null
}

function storeNumber(record: string, key: string): number | null {
  const found = new RegExp(`(?:^|[^\\w$])${key}:(-?\\d+)`).exec(record)?.[1]
  if (found == null) return null
  const value = Number(found)
  return Number.isFinite(value) ? value : null
}

function storeRef(record: string, key: string): string | null {
  return new RegExp(`(?:^|[^\\w$])${key}:\\$R\\[\\d+\\]=\\{__ref:"([^"]+)"`).exec(record)?.[1] ?? null
}

/**
 * Milliseconds to an ISO timestamp, refusing anything outside plausible range.
 *
 * `new Date(x).toISOString()` throws on an out-of-range number, and this text
 * comes off a page we do not control, so a single malformed field would
 * otherwise take down an extraction that had already succeeded.
 */
function isoFromMs(ms: number | null): string | null {
  if (ms == null || ms <= 0 || ms > 4e12) return null
  return new Date(ms).toISOString()
}

interface ConversationRead {
  comments: Comment[]
  /** What actually happened, for `attempts` — including when nothing came back. */
  note: string
  /**
   * Replies dropped because the poster wrote them, reported separately from
   * `note` rather than baked into it. The caller appends the platform's own
   * reply total to the count, and a note that already carried this clause read
   * "2 replies, 1 of the author's own skipped of 153" — the total attached
   * itself to the wrong number and the sentence stopped being English.
   */
  skipped: number
}

async function readConversation(tweetId: string, limit = 100): Promise<ConversationRead> {
  // The /i/status/ form resolves from the id alone, so this works even when the
  // link the user pasted carried no handle. Seven seconds to match the legs
  // above: this runs alongside them, so it must not outlast them and turn a
  // fast extraction into a slow one.
  const page = await fetchText(`https://x.com/i/status/${tweetId}`, {
    headers: { 'User-Agent': UA },
    timeout: 7000,
  })
  if (!page.ok || !page.body) return { comments: [], skipped: 0, note: `HTTP ${page.status}` }

  try {
    const records = relayRecords(page.body, RELAY_KEY)
    // Padding is present when the key is quoted and absent when it was emitted
    // as a bare identifier, and the same key appears both ways on one page.
    const record = (key: string): string =>
      records.get(key) ?? records.get(key.replace(/=+$/, '')) ?? ''

    const authorOf = (tweetKey: string): { name: string | null; handle: string | null } => {
      const results = storeRef(record(`client:${tweetKey}:core`), 'user_results')
      const userId = results ? /^UserResults:(\d+)$/.exec(decodeKey(results))?.[1] : null
      if (!userId) return { name: null, handle: null }
      const core = record(`client:${encodeKey(`User:${userId}`)}:core`)
      return { name: storeString(core, 'name'), handle: storeString(core, 'screen_name') }
    }

    interface Node {
      key: string
      text: string
      parent: string | null
      likes: number | null
      at: number | null
    }

    const nodes = new Map<string, Node>()
    for (const [key, body] of records) {
      const tweetKey = /^client:(VHdlZXQ6[A-Za-z0-9+/=]*):details$/.exec(key)?.[1]
      if (!tweetKey) continue
      const id = /^Tweet:(\d+)$/.exec(decodeKey(tweetKey))?.[1]
      const text = storeString(body, 'full_text')
      if (!id || !text || !text.trim()) continue

      const parent = storeRef(record(tweetKey), 'reply_to_results')
      nodes.set(id, {
        key: tweetKey,
        text,
        parent: parent ? (/^TweetResults:(\d+)$/.exec(parent)?.[1] ?? null) : null,
        likes: storeNumber(record(`client:${tweetKey}:counts`), 'favorite_count'),
        at: storeNumber(body, 'created_at_ms'),
      })
    }

    // A tweet on this page belongs to the conversation only if it descends from
    // the post. The page also carries the tweet this post quoted and the tweet
    // it was itself replying to, and neither is anybody's reaction to it: on
    // Aruna_DK/status/2093318501717217405 the quoted tweet is a BJP Telangana
    // press line with 64 likes, and a reader that took every tweet on the page
    // filed it as a reply from the public. Walking down from the post instead
    // of trusting proximity is what keeps this from inventing an audience.
    const thread = new Set<string>([tweetId])
    for (let pass = 0; pass < 8; pass++) {
      let grew = false
      for (const [id, node] of nodes) {
        if (!thread.has(id) && node.parent != null && thread.has(node.parent)) {
          thread.add(id)
          grew = true
        }
      }
      if (!grew) break
    }

    const poster = authorOf(encodeKey(`Tweet:${tweetId}`)).handle?.toLowerCase() ?? null

    const comments: Comment[] = []
    let ownReplies = 0
    // Insertion order is document order, which is X's own ranking of the
    // conversation, so the most-liked replies survive the cap.
    for (const [id, node] of nodes) {
      if (comments.length >= limit) break
      if (id === tweetId || !thread.has(id)) continue

      const { name, handle } = authorOf(node.key)
      // An author continuing their own thread is not the audience. On X a
      // multi-tweet thread is all replies by the poster, so without this the
      // "public reaction" to such a post would be the poster's own words.
      if (poster && handle && handle.toLowerCase() === poster) {
        ownReplies++
        continue
      }

      comments.push({
        text: node.text,
        author: name,
        likes: node.likes,
        publishedAt: isoFromMs(node.at),
        isReply: node.parent !== tweetId,
      })
    }

    if (!comments.length) {
      return {
        comments,
        skipped: ownReplies,
        note: ownReplies
          ? "the only replies on the page are the author's own"
          : 'no replies on the page',
      }
    }
    return {
      comments,
      skipped: ownReplies,
      note: `${comments.length} repl${comments.length === 1 ? 'y' : 'ies'}`,
    }
  } catch {
    // The store's shape is X's to change. A reader that threw here would lose
    // an extraction whose counts and text had already been read successfully.
    return { comments: [], skipped: 0, note: 'could not read the conversation on the page' }
  }
}

/**
 * Await the conversation read, record how it went, and hand back the comments.
 *
 * Any of the three legs can produce the snapshot, so the reporting lives here
 * rather than three times over. `replyCount` is whichever total that leg
 * measured, and printing it beside the number retrieved is what makes the size
 * of the sample legible instead of implied.
 */
async function attachComments(
  pending: Promise<ConversationRead>,
  attempts: ExtractResult['attempts'],
  replyCount: number | null,
): Promise<Comment[]> {
  const read = await pending
  attempts.push({
    strategy: 'twitter:conversation',
    ok: read.comments.length > 0,
    note: read.comments.length
      ? `${read.note}${replyCount != null ? ` of ${replyCount}` : ''}` +
        (read.skipped ? `, ${read.skipped} of the author's own skipped` : '')
      : read.note,
  })
  return read.comments
}

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

  // Started here rather than after a leg has won, and awaited only once one
  // has: the request that carries the replies then overlaps the request that
  // carries the counts instead of being added onto the end of it.
  const conversation = readConversation(tweetId)

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

    const replyBodies = await attachComments(conversation, attempts, comments.value)

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
      ...(replyBodies.length ? { comments: replyBodies } : {}),
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
    const replyBodies = await attachComments(conversation, attempts, v.replies ?? null)
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
        ...(replyBodies.length ? { comments: replyBodies } : {}),
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

    const replyBodies = await attachComments(conversation, attempts, s.conversation_count ?? null)

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
        ...(replyBodies.length ? { comments: replyBodies } : {}),
        media,
      },
    }
  }

  // The conversation request was already in flight when the legs above gave up.
  // Report what it found rather than leaving it dangling: when X has withheld
  // the post entirely this line is the evidence that the replies went with it.
  await attachComments(conversation, attempts, null)

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
