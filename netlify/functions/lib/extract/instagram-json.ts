import type { Author, PostSnapshot } from '../../../../shared/types'
import type { UrlIdentity } from '../platform'
import { fetchJson } from '../fetcher'
import { getInstagramWithCache } from '../instagram-cache'
import { extractMeta } from './meta'
import type { ExtractContext, ExtractResult } from './types'

/**
 * Instagram.
 *
 * There were four of these files. Three had no importers at all and each was a
 * slightly worse copy of the same idea: fetch the page with a browser
 * User-Agent, regex the HTML, and treat `?__a=1` as a working endpoint. It has
 * not been one since 2021 — it answers a login redirect, and the drafts that
 * called it were reading fields off an HTML error page. This is the one that
 * remains.
 *
 * The reading itself is delegated to `extractMeta`, which is the implementation
 * that was measured working: the `/embed/captioned/` page under a non-browser
 * identity for exact likes and comments, the OpenGraph page for the publish
 * date and image, and `web_profile_info` for followers. Reimplementing those
 * legs here would have meant maintaining two copies of the only Instagram code
 * anyone has verified.
 *
 * What this file adds is what that path has no answer for: Instagram refuses a
 * datacentre address with HTTP 429 after a handful of requests, and once it
 * starts it keeps refusing. So a read goes through the fallback cache — which
 * stops asking during a refusal and hands back the last snapshot instead of an
 * empty report — and, when a Meta app token is configured, through the one
 * Instagram endpoint that is licensed rather than scraped.
 */

/**
 * A username, and nothing that merely appears where one should.
 *
 * oEmbed hands back `author_name` as free text, and a value that fails this is
 * a display name or an error string rather than a handle — either of which
 * would build a profile URL that 404s.
 */
const IG_HANDLE = /^[A-Za-z0-9._]{1,30}$/

const HOUR_MS = 60 * 60 * 1000

export async function extractInstagramJSON(
  id: UrlIdentity,
  ctx: ExtractContext,
): Promise<ExtractResult> {
  // No shortcode means a profile link or something that is not a post at all.
  // `extractMeta` already answers that case with the specific message — which
  // of the two it is, and what a post URL looks like — and answers it without
  // touching the network, so there is nothing to cache or rate-limit.
  if (!id.id) return extractMeta(id, ctx)

  const attempts: ExtractResult['attempts'] = []
  let live: ExtractResult | undefined

  const read = await getInstagramWithCache(id.canonical, id.id, async () => {
    const result = await extractMeta(id, ctx)
    live = result
    attempts.push(...result.attempts)
    // Null is the cache's signal to start backing off. A partial read still
    // counts as a read: `extractMeta` returns ok once it has the caption or the
    // image, and storing that is better than storing nothing.
    return result.ok && result.snapshot ? result.snapshot : null
  })

  // The cache can decide not to ask at all. Say so, rather than letting the run
  // log show no Instagram attempt and read as though nothing was tried.
  if (!live) {
    attempts.push({
      strategy: 'instagram:backoff',
      ok: false,
      note: read.nextFetchAt
        ? `did not ask — Instagram is refusing this server until ${read.nextFetchAt.toISOString()}`
        : 'did not ask — Instagram is refusing this server',
    })
  }

  const token = ctx.keys.meta?.trim()

  // ── Instagram answered ────────────────────────────────────────────────────
  if (read.source === 'fresh' && read.data) {
    const snapshot = token ? await fillGaps(read.data, id, token, attempts) : read.data
    return {
      ok: true,
      attempts,
      confidence: live?.confidence ?? 'medium',
      snapshot,
      ...(live?.extra ? { extra: live.extra } : {}),
    }
  }

  // ── Instagram refused, but we read this post before ───────────────────────
  if (read.source === 'cached' && read.data) {
    const ageHours = read.cachedAt ? Math.round((Date.now() - read.cachedAt.getTime()) / HOUR_MS) : null
    attempts.push({
      strategy: 'instagram:cache',
      ok: true,
      note: ageHours == null ? 'served the stored snapshot' : `served a snapshot read ${ageHours}h ago`,
    })

    return {
      ok: true,
      attempts,
      // Never 'medium': every count in here was measured at a time that is not
      // now, and the reader has to be able to tell that from the report.
      confidence: 'low',
      snapshot: read.data,
      blocked: {
        reason:
          ageHours == null
            ? 'Instagram is not answering this server, so the figures below come from an earlier read rather than from the post as it stands now.'
            : `Instagram is not answering this server, so the figures below were read ${ageHours} hours ago rather than now.`,
        suggestion: retrySuggestion(read.nextFetchAt),
      },
    }
  }

  // ── Nothing live and nothing stored ───────────────────────────────────────
  if (token) {
    const rescued = await fillGaps({ platform: 'Instagram', postType: id.postType }, id, token, attempts)
    const gotAuthor = Boolean(rescued.author?.handle)
    const gotThumbnail = Boolean(rescued.media?.length)

    if (gotAuthor || gotThumbnail) {
      // Name the two fields separately. oEmbed can return either without the
      // other, and a report that says it got both when it got one is the same
      // class of claim as the drafts that reported an oEmbed read after the
      // endpoint had handed them a redirect.
      const got = gotAuthor && gotThumbnail ? 'the author and the thumbnail' : gotAuthor ? 'the author' : 'the thumbnail'

      return {
        ok: true,
        attempts,
        confidence: 'low',
        snapshot: rescued,
        blocked: {
          reason: `Instagram would not return this post to us. The licensed oEmbed API gave us ${got}, but it carries no caption and no counts, so this report has no post text and no engagement figures.`,
          suggestion: gotAuthor
            ? 'Paste the caption below and we will analyse that against the author we did get.'
            : 'Paste the caption below and we will analyse that.',
        },
      }
    }
  }

  return {
    ok: false,
    attempts,
    blocked: blockedReason(attempts, Boolean(live), read.nextFetchAt) ?? live?.blocked ?? {
      reason: 'Instagram did not return this post.',
      suggestion:
        'It may be from a private account or deleted. Paste the caption below to analyse it anyway.',
    },
  }
}

/**
 * Whether to blame Instagram for the empty read, rather than the post.
 *
 * Only two things earn that. The first is an HTTP 429 in the delegated
 * adapter's attempt notes, which write the status as "HTTP 429"; that is a
 * coupling to a string and a deliberate one, because a 429 is the difference
 * between "this post does not exist" and "Instagram has stopped talking to this
 * server", and only the second is worth telling someone to wait out. The second
 * is not having asked at all, because the backoff was still open.
 *
 * What does NOT earn it is the mere absence of data. This function used to take
 * the cache's `isBlocked` flag, which was set whenever the live read came back
 * with nothing — and the cache cannot see whether that was a refusal or a post
 * that has been deleted. So a deleted post buried `extractMeta`'s accurate
 * "private account or deleted" under a throttling notice telling the reader to
 * wait for something that was never coming back. The flag is gone from
 * `InstagramCacheRead` for that reason; do not reintroduce the equivalent.
 *
 * Returning null hands the explanation back to the adapter, which knows what it
 * actually saw.
 */
function blockedReason(
  attempts: ExtractResult['attempts'],
  askedThisRun: boolean,
  nextFetchAt: Date | undefined,
): ExtractResult['blocked'] | null {
  if (attempts.some((a) => a.note?.includes('HTTP 429'))) {
    return {
      reason:
        'Instagram returned HTTP 429. It rate-limits datacentre addresses after a handful of requests and then refuses everything for a while, whoever is asking.',
      suggestion: retrySuggestion(nextFetchAt),
    }
  }

  if (!askedThisRun) {
    return {
      reason:
        'Instagram refused this server on an earlier read, so we have not asked again yet. Nothing was fetched for this report.',
      suggestion: retrySuggestion(nextFetchAt),
    }
  }

  return null
}

function retrySuggestion(nextFetchAt: Date | undefined): string {
  const base = 'Paste the caption below and we will analyse that instead.'
  if (!nextFetchAt) return base
  const minutes = Math.max(1, Math.round((nextFetchAt.getTime() - Date.now()) / 60_000))
  const wait = minutes >= 120 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`
  return `We will try Instagram again in about ${wait}. ${base}`
}

interface InstagramOEmbed {
  author_name?: unknown
  author_url?: unknown
  thumbnail_url?: unknown
}

/**
 * The one Instagram endpoint that is licensed rather than scraped.
 *
 * `www.instagram.com/oembed/` — the endpoint every earlier draft in this
 * directory called, unauthenticated — was retired in October 2020 and now
 * answers a redirect to a login page. Those drafts checked only that the
 * response was an object before declaring the strategy a success, so they
 * reported an oEmbed read that had returned nothing.
 *
 * The live endpoint is on the Graph API and needs a Meta app token, which is
 * why this only runs when one is configured. It carries no caption and no
 * counts, so it can never replace the scraped read. It earns its place because
 * it is a different host under a different authorisation: when
 * www.instagram.com is refusing this IP, this still answers, and an author and
 * a thumbnail beat an empty report.
 *
 * The token goes in the Authorization header rather than the query string, for
 * the same reason `meta-graph.ts` does it: a URL can end up in a log.
 */
async function fillGaps(
  base: Partial<PostSnapshot>,
  id: UrlIdentity,
  token: string,
  attempts: ExtractResult['attempts'],
): Promise<Partial<PostSnapshot>> {
  const needsAuthor = !base.author?.handle
  const needsMedia = !base.media?.length
  if (!needsAuthor && !needsMedia) return base

  const res = await fetchJson<InstagramOEmbed>(
    `https://graph.facebook.com/v21.0/instagram_oembed?omitscript=true&url=${encodeURIComponent(id.canonical)}`,
    { timeout: 6000, headers: { Authorization: `Bearer ${token}` } },
  )

  const data = res.ok ? res.data : null
  const handle = readHandle(data)
  const thumbnail = readString(data?.thumbnail_url)

  attempts.push({
    strategy: 'instagram:graph-oembed',
    ok: Boolean(handle || thumbnail),
    note: handle || thumbnail ? `author=${handle ?? '—'}` : `HTTP ${res.status}, no fields`,
  })

  if (!handle && !thumbnail) return base

  const author: Author = { ...(base.author ?? blankAuthor()) }
  if (handle) {
    author.handle ??= handle
    author.name ??= handle
    author.profileUrl ??= readString(data?.author_url) ?? `https://www.instagram.com/${handle}/`
  }

  return {
    ...base,
    author,
    media:
      base.media?.length || !thumbnail
        ? (base.media ?? [])
        : [{ kind: 'image', url: thumbnail, thumbnailUrl: thumbnail }],
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readHandle(data: InstagramOEmbed | null): string | null {
  const raw = readString(data?.author_name)
  return raw && IG_HANDLE.test(raw) ? raw : null
}

function blankAuthor(): Author {
  return {
    name: null,
    handle: null,
    profileUrl: null,
    avatarUrl: null,
    verified: null,
    followers: { value: null, source: 'unavailable' },
    accountType: 'Unknown',
    declaredLocation: null,
  }
}
