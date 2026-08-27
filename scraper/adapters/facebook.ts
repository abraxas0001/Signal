/**
 * Facebook.
 *
 * Every class name on this site is a hashed build artefact that changes
 * between deploys, so nothing here selects on one. What is stable is the SHAPE
 * OF A PERMALINK: a post URL always contains `/posts/`, `/permalink.php`,
 * `/videos/`, `/reel/` or `/share/p/`. So the strategy is to take every anchor
 * on the rendered page and keep the ones whose href matches those patterns.
 * That survives a redesign; a class selector does not.
 *
 * COUNTS ARE MOSTLY LEFT NULL, deliberately. Facebook renders reaction and
 * comment totals inconsistently — sometimes as an aria-label, sometimes as a
 * bare abbreviated string, often not at all until the post is opened. Opening
 * each post to collect them would multiply the navigation count by twenty and
 * is precisely the behaviour that gets a session flagged. It is also
 * unnecessary: the app already has a proven per-post reader that pulls exact
 * counts and full comment bodies from a supplied URL. This adapter's job is to
 * FIND the URLs; the app's job is to read them.
 */

import { isLoggedOut } from '../session'
import {
  canonicalUrl,
  parseCount,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
  type ScrapedComment,
  type ScrapedPost,
} from '../types'
import { autoScroll } from '../browser'

/** The permalink shapes a Facebook post can take. */
const POST_HREF =
  /(\/posts\/|\/permalink\.php\?|\/videos\/|\/reel\/|\/share\/p\/|story_fbid=)/i

/** Chrome, navigation and product links that also live on a profile page. */
const NOISE = /\/(login|privacy|policies|help|settings|marketplace|gaming|watch\/?$)/i

interface RawPost {
  href: string
  /** Text of the post container this link sits in, for a title preview. */
  text: string | null
  /** Any aria-label on the container that might carry counts. */
  label: string | null
  time: string | null
}

function harvest(): RawPost[] {
  const seen = new Set<string>()
  const out: RawPost[] = []

  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const href = (a as HTMLAnchorElement).getAttribute('href') ?? ''
    if (!href || seen.has(href)) continue
    seen.add(href)

    // The post container: FB marks each story with role="article". Walking up
    // to it gives the text preview and any labelled counts in one place.
    const article = a.closest('[role="article"]')
    out.push({
      href,
      text: article?.textContent?.trim().slice(0, 200) ?? null,
      label: article?.getAttribute('aria-label') ?? null,
      time: article?.querySelector('abbr')?.getAttribute('data-utime') ?? null,
    })
  }
  return out
}

/**
 * Pull a count out of whatever string Facebook happened to render.
 *
 * Returns null far more often than it returns a number, and that is correct —
 * see the header. A wrong number here is worse than no number.
 */
function countFrom(text: string | null, word: RegExp): number | null {
  if (!text) return null
  const m = text.match(new RegExp(`([\\d.,]+\\s*[KMB]?)\\s*${word.source}`, 'i'))
  return m?.[1] ? parseCount(m[1]) : null
}

function normaliseHandle(handle: string): string {
  const h = handle.trim().replace(/^@/, '')
  const asUrl = h.match(/facebook\.com\/([^/?#]+)/i)
  return (asUrl?.[1] ?? h).replace(/\/+$/, '')
}

export const facebook: PlatformAdapter = {
  platform: 'Facebook',

  profileUrl: (handle) => {
    const h = handle.trim()
    if (/^https?:\/\//i.test(h)) return h
    return `https://www.facebook.com/${normaliseHandle(h)}`
  },

  /**
   * Facebook's own version of this check happened to be right — measured
   * signed out, the email and password inputs are both present — but it was
   * right by luck rather than by rule, and would break the moment Facebook
   * moved the form behind a button as Instagram has. `isLoggedOut` requires
   * proof of a session instead of recognising one shape of wall.
   */
  isLoginWall: ({ page }) => isLoggedOut(page, 'Facebook'),

  posts: async (ctx: AdapterContext, handle): Promise<AdapterResult<ScrapedPost>> => {
    const { page, log, limit } = ctx

    // "This content isn't available right now" is a real answer about the
    // page, not a failure to read it.
    const unavailable = await page
      .locator("text=/content isn't available|page isn't available|Page Not Found/i")
      .count()
      .catch(() => 0)
    if (unavailable > 0) {
      return { ok: true, items: [], note: 'Facebook reports this page as unavailable.' }
    }

    const found = new Map<string, ScrapedPost>()

    for (let round = 0; round < 10 && found.size < limit; round++) {
      const raw = await page.evaluate(harvest).catch(() => [] as RawPost[])

      for (const r of raw) {
        if (!POST_HREF.test(r.href) || NOISE.test(r.href)) continue
        const url = canonicalUrl(r.href, 'https://www.facebook.com')
        if (!url || found.has(url)) continue

        const id =
          url.match(/\/posts\/(?:pfbid)?([\w-]+)/)?.[1] ??
          url.match(/story_fbid=([\w-]+)/)?.[1] ??
          url.match(/\/(?:videos|reel)\/(\d+)/)?.[1] ??
          null

        const blob = [r.label, r.text].filter(Boolean).join(' ')
        found.set(url, {
          url,
          id,
          title: r.text?.slice(0, 140) ?? null,
          publishedAt: r.time ? new Date(Number(r.time) * 1000).toISOString() : null,
          likes: countFrom(blob, /reactions?|likes?/),
          comments: countFrom(blob, /comments?/),
          shares: countFrom(blob, /shares?/),
          views: null,
        })
        if (found.size >= limit) break
      }

      if (found.size >= limit) break
      const grew = await autoScroll(page, { rounds: 1, pauseMs: 2_000 })
      if (grew === 0 && round > 1) break
    }

    /**
     * Zero permalinks is reported as a failure, not an empty page, and this is
     * the measured case that matters most: a logged-OUT read of a Facebook
     * profile returns a 4.9 MB document containing no post links at all. If a
     * stale session silently degrades to that, the office must be told the
     * read failed — not that a rival stopped posting.
     */
    if (found.size === 0) {
      return {
        ok: false,
        reason:
          'Facebook rendered no post permalinks. The session is probably signed out or this profile withholds its timeline.',
      }
    }

    log(`Facebook: ${found.size} posts for ${normaliseHandle(handle)}`)
    return { ok: true, items: [...found.values()].slice(0, limit) }
  },

  /**
   * Comments on an already-navigated post page.
   *
   * Facebook hides most replies behind "View more comments", and clicking
   * through them is many interactions on a page that is already watching for
   * automation. One expansion click, then read what is there — the app's own
   * per-post reader gets the full set through a cheaper route anyway.
   */
  comments: async (ctx: AdapterContext): Promise<AdapterResult<ScrapedComment>> => {
    const { page, limit } = ctx

    await page
      .locator('text=/View more comments|Previous comments/i')
      .first()
      .click({ timeout: 4_000 })
      .catch(() => {})
    await page.waitForTimeout(2_000)

    const rows = await page
      .evaluate(() => {
        // Comments are articles nested inside the post's own article.
        const all = Array.from(document.querySelectorAll('[role="article"]'))
        return all
          .filter((el) => el.parentElement?.closest('[role="article"]'))
          .map((el) => ({
            text: el.textContent?.trim() ?? '',
            author: el.querySelector('a[role="link"] span')?.textContent?.trim() ?? null,
          }))
      })
      .catch(() => [] as { text: string; author: string | null }[])

    return {
      ok: true,
      items: rows
        .filter((r) => r.text.length > 0)
        .slice(0, limit)
        .map((r) => ({
          text: r.text.slice(0, 800),
          author: r.author,
          // Per-comment reaction counts are not rendered on the list; the app's
          // own reader supplies them. Null, never zero.
          likes: null,
          publishedAt: null,
          isReply: false,
        })),
    }
  },
}
