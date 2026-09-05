/**
 * YouTube.
 *
 * THE ONLY ONE OF THE FIVE THAT NEEDS NO SESSION. A channel's video list is
 * public: no login wall, no authwall served as HTTP 200, no rate limit that
 * costs an account. That changes what this adapter has to defend against —
 * nothing here is about proving a session exists, because there is none to
 * lose. `isLoginWall` therefore answers false rather than pretending to check.
 *
 * THE VIDEO LIST, NOT THE HOME TAB. `/videos` is the chronological list;
 * `/@handle` alone is a curated page whose first rows are pinned trailers and
 * playlists, and reading that returns a shelf rather than a feed.
 *
 * The LISTING shows a view count and a relative age and no likes; the like
 * count comes from each video's watch page in `factsFor`, which this adapter
 * already opens for the exact publish date
 * or comments at all — those live on each video's own page and would cost a
 * navigation each. They stay null, which is the truth about what was read.
 *
 * THUMBNAILS ARE DERIVED, NOT DOWNLOADED. Every other platform's post images
 * had to be fetched and stored, because their CDNs refuse cross-origin
 * embedding and sign their URLs with an expiry. `i.ytimg.com` does neither: the
 * address is a pure function of the video id and it does not rot. So this is
 * the one platform whose pictures cost nothing to keep.
 */

import {
  parseCount,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
  type ProfileInfo,
  type ScrapedComment,
  type ScrapedPost,
  cutCaption,
} from '../types'
import { autoScroll } from '../browser'

interface RawVideo {
  href: string
  title: string | null
  views: string | null
  age: string | null
}

function harvest(): RawVideo[] {
  const out: RawVideo[] = []
  const seen = new Set<string>()

  /**
   * The running time YouTube appends to the title anchor's aria-label.
   *
   * The label is written for a screen reader, so it says the title AND how
   * long the video is: "… ఫోకస్ 3 minutes, 21 seconds". Stored verbatim, that
   * duration became part of the video's name on every surface that prints one,
   * and two of those print the name inside quotation marks as a thing somebody
   * said: the local news mentions and the influencer voices blockquote. Every
   * one of the 675 YouTube titles this desk holds carries it.
   *
   * This lives inside `harvest` for the same reason the rest of it does:
   * `page.evaluate` ships this function's SOURCE to the browser, where nothing
   * in this module's scope exists.
   *
   * Only ever applied to the aria-label, never to a real title. A video
   * genuinely called "Dal in 10 minutes" ends in the same shape, and the
   * heading below is the source that cannot carry a duration in the first
   * place, so there is no reason to run a pattern over it that could eat its
   * last three words.
   */
  const DURATION_TAIL =
    /\s+\d+\s+(?:hours?|minutes?|seconds?)(?:,\s*\d+\s+(?:hours?|minutes?|seconds?))*\s*$/i

  for (const el of Array.from(
    document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer'),
  )) {
    /**
     * The titled anchor, not the first one.
     *
     * Each card carries TWO links to the same video: the thumbnail, whose text
     * is the duration ("2:48"), and the heading, which carries an aria-label.
     * Taking the first anchor recorded every video on the channel as being
     * called something like "4:58".
     *
     * The label is only how the heading anchor is TOLD APART here. What gets
     * stored as the title is read further down, and not from this attribute.
     */
    const link = Array.from(el.querySelectorAll('a[href*="/watch?v="]')).find(
      (a) => (a.getAttribute('aria-label') ?? '').length > 0,
    )
    const href = link?.getAttribute('href') ?? ''
    if (!href || seen.has(href)) continue
    seen.add(href)

    // The metadata line reads "555 views • 1 hour ago". Split rather than
    // positional: a live or premiering video has a different line entirely.
    const bits = Array.from(el.querySelectorAll('#metadata-line span, span'))
      .map((s) => (s.textContent ?? '').trim())
      .filter((t) => t.length > 0 && t.length < 30)

    /**
     * The heading's OWN text is the title; the aria-label is a fallback.
     *
     * The anchor is still found by its aria-label, for the reason above, but
     * that label is the wrong thing to store: it is the accessible
     * description, and it ends in the duration. The heading element the anchor
     * wraps, or is, holds the title alone, in whatever language YouTube
     * rendered it, with no chrome to strip and nothing to guess at.
     *
     * The label is kept behind it because the heading is filled by a later
     * hydration pass than the anchor, and an empty heading on a card that is
     * still settling would otherwise store null for a video that has a name.
     * On that path the duration is removed, which is the one place a pattern
     * is needed at all.
     *
     * Whitespace is collapsed because the heading's text node is indented
     * markup: without it a stored title carries the newlines and padding of
     * YouTube's template rather than the words.
     */
    const heading =
      link?.closest('#video-title') ??
      link?.querySelector('#video-title') ??
      el.querySelector('#video-title, h3')
    const headingText = (heading?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const labelText = (link?.getAttribute('aria-label') ?? '')
      .replace(DURATION_TAIL, '')
      .replace(/\s+/g, ' ')
      .trim()

    out.push({
      href,
      title: headingText || labelText || null,
      views: bits.find((t) => /view/i.test(t)) ?? null,
      age: bits.find((t) => /ago$/i.test(t)) ?? null,
    })
  }
  return out
}

function normaliseHandle(handle: string): string {
  const h = handle.trim().replace(/^@/, '')
  const asUrl = h.match(/youtube\.com\/(?:@)?([^/?#]+)/i)
  return (asUrl?.[1] ?? h).replace(/^@/, '').replace(/\/+$/, '')
}

/**
 * Exact publish dates for a channel's videos, from YouTube's own statements.
 *
 * Two sources, cheapest first. The channel's Atom feed carries an exact
 * `<published>` for its newest videos in ONE request; each watch page carries
 * `<meta itemprop="datePublished">` for anything older. Both are dates the
 * platform states, not a relative age converted into a guess — a post dated
 * by arithmetic on "3 weeks ago" would land in the wrong week on every filter
 * that reads it.
 *
 * Fetched inside the page context so the signed-in session's cookies come
 * along; YouTube serves a consent wall to anonymous requests from some
 * regions. Anything neither source dates stays null, which the app renders as
 * "Date not published" rather than as a guess.
 */
/** What one watch page or feed entry can tell us about a video. */
interface VideoFacts {
  publishedAt?: string
  /** Null is never written here: an absent like count simply stays absent. */
  likes?: number
}

/**
 * Dates AND like counts, from the pages this pass already opens.
 *
 * It used to return dates alone, and the listing set `likes: null` with the
 * comment "VIEWS ONLY … and no likes" — true of the CHANNEL listing, and not
 * true of the watch page, which states `"likeCount":"31"` outright. Since the
 * channel feed now answers 404 for every channel, every video already falls
 * through to a watch-page fetch below, so the like count costs nothing extra:
 * the page is being downloaded either way and was being read for one fact
 * when it carries two.
 */
async function factsFor(
  page: AdapterContext['page'],
  ids: string[],
  log: AdapterContext['log'],
): Promise<Map<string, VideoFacts>> {
  const out = new Map<string, VideoFacts>()
  if (ids.length === 0) return out
  const put = (id: string, f: VideoFacts): void => {
    out.set(id, { ...out.get(id), ...f })
  }

  // 1. The channel feed: one request, the newest ~15 videos, exact.
  try {
    const channelId = await page.evaluate(() => {
      const m = document.documentElement.innerHTML.match(/"externalId":"(UC[\w-]{20,})"/)
      return m?.[1] ?? null
    })
    if (channelId) {
      const xml = await page.evaluate(async (cid: string) => {
        const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${cid}`)
        return res.ok ? await res.text() : ''
      }, channelId)
      const entries = xml.split('<entry>').slice(1)
      for (const entry of entries) {
        const id = entry.match(/<yt:videoId>([\w-]+)<\/yt:videoId>/)?.[1]
        if (!id) continue
        const at = entry.match(/<published>([^<]+)<\/published>/)?.[1]
        if (at) put(id, { publishedAt: new Date(at).toISOString() })
        // MediaRSS carries the like count when the feed answers at all.
        const likes = entry.match(/<media:starRating[^>]+count="(\d+)"/)?.[1]
        if (likes) put(id, { likes: Number(likes) })
      }
    }
  } catch (err) {
    log(`YouTube: channel feed unavailable — ${(err as Error).message.split('\n')[0]}`)
  }

  // 2. The watch page, for whatever the feed did not cover.
  // Anything the feed did not fully answer — which, while the feed 404s, is
  // every video and every like count.
  const missing = ids.filter((id) => {
    const f = out.get(id)
    return !f || f.publishedAt === undefined || f.likes === undefined
  })
  for (const id of missing) {
    try {
      const got = await page.evaluate(async (vid: string) => {
        const res = await fetch(`https://www.youtube.com/watch?v=${vid}`)
        if (!res.ok) return null
        const html = await res.text()
        return {
          at:
            html.match(/itemprop="datePublished"\s+content="([^"]+)"/)?.[1] ??
            html.match(/"datePublished":"([^"]+)"/)?.[1] ??
            null,
          likes: html.match(/"likeCount"\s*:\s*"?(\d+)/)?.[1] ?? null,
        }
      }, id)
      if (got?.at) put(id, { publishedAt: new Date(got.at).toISOString() })
      if (got?.likes) put(id, { likes: Number(got.likes) })
    } catch {
      /* one unreadable video is a gap, not a failed read */
    }
  }

  return out
}

export const youtube: PlatformAdapter = {
  platform: 'YouTube',

  /**
   * A channel id starting `UC` addresses differently from an @handle, and
   * getting it wrong lands on a search results page that renders videos by
   * other people — which would then be filed under this politician's name.
   */
  profileUrl: (handle) => {
    const h = normaliseHandle(handle)
    if (/^https?:\/\//i.test(handle.trim())) return handle.trim()
    if (/^UC[\w-]{20,}$/.test(h)) return `https://www.youtube.com/channel/${h}/videos`
    return `https://www.youtube.com/@${h}/videos`
  },

  /**
   * Nothing to check. YouTube serves a channel's videos to anybody, so there is
   * no wall to detect and no session whose expiry could be mistaken for an
   * empty channel. Answering a flat false is honest; running a marker check
   * that can only ever pass would be theatre.
   */
  isLoginWall: async () => false,

  profile: async ({ page }: AdapterContext): Promise<ProfileInfo> => {
    const raw = await page
      .evaluate(() => {
        // "3.13 crore subscribers" on an Indian locale, "31.3M subscribers"
        // elsewhere. parseCount understands both.
        const subs = Array.from(document.querySelectorAll('span, yt-formatted-string'))
          .map((s) => (s.textContent ?? '').trim())
          .find((t) => /subscriber/i.test(t) && t.length < 40)

        return {
          followers: subs ?? null,
          displayName:
            document.querySelector('#channel-name yt-formatted-string, ytd-channel-name')
              ?.textContent?.trim() ?? null,
          avatarUrl:
            (document.querySelector('yt-img-shadow#avatar img, #avatar img') as HTMLImageElement | null)
              ?.src ?? null,
        }
      })
      .catch(() => ({ followers: null, displayName: null, avatarUrl: null }))

    return {
      displayName: raw.displayName || null,
      followers: parseCount(raw.followers),
      avatarUrl: raw.avatarUrl,
    }
  },

  posts: async (ctx: AdapterContext, handle): Promise<AdapterResult<ScrapedPost>> => {
    const { page, log, limit } = ctx

    const missing = await page
      .locator("text=/This page isn't available|channel does not exist|404/i")
      .count()
      .catch(() => 0)
    if (missing > 0) {
      return { ok: true, items: [], note: 'YouTube reports this channel as unavailable.' }
    }

    // The grid renders after the shell, like every other feed here.
    await page.waitForSelector('ytd-rich-item-renderer, ytd-grid-video-renderer', { timeout: 20_000 })
      .catch(() => {})

    const found = new Map<string, ScrapedPost>()

    for (let round = 0; round < 8 && found.size < limit; round++) {
      const raw = await page.evaluate(harvest).catch((err: Error) => {
        log(`YouTube: harvest failed — ${err.message.split('\n')[0]}`)
        return [] as RawVideo[]
      })

      for (const r of raw) {
        const id = r.href.match(/[?&]v=([\w-]{6,})/)?.[1]
        if (!id) continue
        const url = `https://www.youtube.com/watch?v=${id}`
        if (found.has(url)) continue

        found.set(url, {
          url,
          id,
          title: cutCaption(r.title),
          // Filled in below from YouTube's own exact timestamps. The listing
          // itself only offers "1 hour ago", and converting a relative age
          // would invent precision — so the date comes from the channel feed
          // and the watch pages, both of which state it outright.
          publishedAt: null,
          likes: null,
          comments: null,
          shares: null,
          views: parseCount(r.views),
          // Derived from the id. i.ytimg.com allows embedding and its addresses
          // do not expire, so unlike every other platform here this needs no
          // download and cannot rot.
          thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        })
        if (found.size >= limit) break
      }

      if (found.size >= limit) break
      const grew = await autoScroll(page, { rounds: 1, pauseMs: 2_000 })
      if (grew === 0 && round > 2) break
    }

    /* The dates, from YouTube's own statements, before anything is returned. */
    const items = [...found.values()]
    const facts = await factsFor(page, items.map((i) => i.id).filter((i): i is string => Boolean(i)), log)
    let dated = 0
    let liked = 0
    for (const item of items) {
      const f = item.id ? facts.get(item.id) : undefined
      if (f?.publishedAt) {
        item.publishedAt = f.publishedAt
        dated++
      }
      // Left null when the page did not state one. A zero here would be a
      // measurement, and "the page did not say" is not zero likes.
      if (f?.likes != null) {
        item.likes = f.likes
        liked++
      }
    }
    log(`YouTube: dated ${dated} of ${items.length} videos, ${liked} with a like count`)

    if (found.size === 0) {
      return {
        ok: false,
        reason:
          'YouTube rendered no videos. The channel may be new, or the page did not finish loading.',
      }
    }

    log(`YouTube: ${found.size} videos for @${normaliseHandle(handle)}`)
    return { ok: true, items: [...found.values()].slice(0, limit) }
  },

  /**
   * Read the comments under one watch page, in the browser.
   *
   * This was a stub returning an empty list, and the stub was not neutral: the
   * comment pass counted every video it opened as "read, zero comments", so a
   * channel whose videos carry three and four real comments apiece was
   * recorded as one nobody speaks to — measured on the flagship desk, 5 real
   * comments across its top two videos reported as 0. The same stub bug the
   * Instagram adapter had, with the same fix: actually read the page.
   *
   * YouTube mounts `ytd-comments` only once it scrolls into view, and fills
   * `ytd-comment-thread-renderer` nodes lazily after that — so the reader
   * scrolls first, waits for either threads or the comment header (which
   * renders even at "0 Comments"), then keeps scrolling while the list grows.
   */
  comments: async (ctx: AdapterContext): Promise<AdapterResult<ScrapedComment>> => {
    const { page, log, limit } = ctx

    // Bring the comments section into view; it does not exist before this.
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 900)
      await page.waitForTimeout(900)
    }
    await page
      .waitForSelector('ytd-comment-thread-renderer, ytd-comments-header-renderer, ytd-message-renderer', {
        timeout: 12_000,
      })
      .catch(() => null)

    // "Comments are turned off" is an answer about the channel, not a failure.
    const turnedOff = await page
      .locator('ytd-message-renderer', { hasText: /comments are turned off/i })
      .count()
      .catch(() => 0)
    if (turnedOff > 0) {
      return { ok: true, items: [], note: 'Comments are turned off on this video.' }
    }

    // Let the lazy list fill until it stops growing or we have enough.
    let last = -1
    for (let round = 0; round < 10; round++) {
      const count = await page.locator('ytd-comment-thread-renderer').count().catch(() => 0)
      if (count >= limit || count === last) break
      last = count
      await autoScroll(page, { rounds: 1, pauseMs: 1_500 })
    }

    const items = await page.evaluate((max) => {
      const out: { text: string; author: string | null; likes: string | null }[] = []
      for (const thread of Array.from(document.querySelectorAll('ytd-comment-thread-renderer'))) {
        const text = (thread.querySelector('#content-text') as HTMLElement | null)?.innerText?.trim()
        if (!text) continue
        out.push({
          text,
          author:
            (thread.querySelector('#author-text') as HTMLElement | null)?.innerText?.trim() ?? null,
          likes:
            (thread.querySelector('#vote-count-middle') as HTMLElement | null)?.innerText?.trim() ??
            null,
        })
        if (out.length >= max) break
      }
      return out
    }, limit)

    log(`YouTube: ${items.length} comments`)
    return {
      ok: true,
      items: items.map((c) => ({
        text: c.text,
        author: c.author,
        likes: parseCount(c.likes),
        publishedAt: null,
        isReply: false,
      })),
    }
  },
}
