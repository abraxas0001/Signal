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
 * VIEWS ONLY. The listing shows a view count and a relative age, and no likes
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

  for (const el of Array.from(
    document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer'),
  )) {
    /**
     * The titled anchor, not the first one.
     *
     * Each card carries TWO links to the same video: the thumbnail, whose text
     * is the duration ("2:48"), and the heading, which holds the real title in
     * an aria-label. Taking the first anchor recorded every video on the
     * channel as being called something like "4:58".
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

    out.push({
      href,
      title:
        link?.getAttribute('aria-label') ??
        el.querySelector('#video-title, h3')?.textContent?.trim() ??
        null,
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
          title: r.title?.slice(0, 140) ?? null,
          // The listing gives "1 hour ago", not a date. Converting a relative
          // age into an ISO timestamp would invent a precision the page never
          // offered, so this stays null and the app's own reader supplies it.
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
   * Left to the app's own reader, like LinkedIn's.
   *
   * Comments load behind a separate request and a sort control, and the app
   * already extracts them from a watch URL. An honest empty lets it fall
   * through to that rather than treating this as an outage.
   */
  comments: async (): Promise<AdapterResult<ScrapedComment>> => ({
    ok: true,
    items: [],
    note: 'YouTube comments are left to the app’s own post reader.',
  }),
}
