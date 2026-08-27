/**
 * LinkedIn.
 *
 * THE AUTHWALL RETURNS HTTP 200. That measured fact shapes this whole file:
 * LinkedIn serves `/uas/login` and `/authwall` with a success status and an
 * `og:title` of "LinkedIn Login, Sign in", so a naive reader records the sign-
 * in page as the person's profile and reports it as having no posts. Every
 * check below is written against that failure specifically.
 *
 * URNs, NOT HREFS. LinkedIn's feed items carry `data-urn` /
 * `data-id` attributes holding `urn:li:activity:<id>`, and the canonical
 * permalink is derivable from it:
 *   https://www.linkedin.com/feed/update/urn:li:activity:<id>/
 * That is far more stable than scraping anchors, because the visible links on
 * a feed item point at the author, the reactions dialog and the comment box
 * long before they point at the post itself.
 *
 * THE ACTIVITY FEED, NOT THE PROFILE. A person's profile page shows at most a
 * couple of posts behind a "show all" link. `/recent-activity/all/` is the
 * actual list, so that is where a bare handle is pointed.
 */

import {
  parseCount,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
  type ScrapedComment,
  type ScrapedPost,
} from '../types'
import { autoScroll } from '../browser'

interface RawItem {
  urn: string | null
  text: string | null
  /** The social counts row, e.g. "12 reactions · 3 comments". */
  counts: string | null
}

function harvest(): RawItem[] {
  const out: RawItem[] = []
  // Feed items expose their URN on one of these attributes depending on
  // surface (profile activity vs main feed vs company page).
  const nodes = document.querySelectorAll(
    '[data-urn], [data-id], div.feed-shared-update-v2, article',
  )

  for (const el of Array.from(nodes)) {
    const attr =
      el.getAttribute('data-urn') ??
      el.getAttribute('data-id') ??
      el.querySelector('[data-urn]')?.getAttribute('data-urn') ??
      null

    // Some surfaces bury the URN in a nested tracking attribute instead.
    const fallback = el.innerHTML.match(/urn:li:activity:(\d+)/)?.[0] ?? null
    const urn = attr && attr.includes('urn:li:activity:') ? attr : fallback
    if (!urn) continue

    out.push({
      urn,
      text: el.querySelector('.update-components-text, .feed-shared-text')?.textContent?.trim()
        ?? el.textContent?.trim().slice(0, 200)
        ?? null,
      counts:
        el.querySelector('.social-details-social-counts, [class*="social-counts"]')?.textContent?.trim()
        ?? null,
    })
  }
  return out
}

function normaliseHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').replace(/\/+$/, '')
}

export const linkedin: PlatformAdapter = {
  platform: 'LinkedIn',

  /**
   * A handle here can be a person or a company, and the two live on different
   * paths. An explicit "in/" or "company/" prefix is honoured; a bare handle
   * is treated as a person, which is the common case for this desk.
   */
  profileUrl: (handle) => {
    const h = normaliseHandle(handle)
    if (/^https?:\/\//i.test(h)) return h
    if (/^company\//i.test(h)) return `https://www.linkedin.com/${h}/posts/`
    if (/^in\//i.test(h)) return `https://www.linkedin.com/${h}/recent-activity/all/`
    return `https://www.linkedin.com/in/${h}/recent-activity/all/`
  },

  /**
   * The most important isLoginWall of the four, because LinkedIn's wall is a
   * 200 and would otherwise be indistinguishable from an empty profile.
   */
  isLoginWall: async ({ page }) => {
    const url = page.url()
    if (/\/uas\/login|\/authwall|\/login|\/checkpoint/i.test(url)) return true
    return page
      .evaluate(() => {
        const title = document
          .querySelector('meta[property="og:title"]')
          ?.getAttribute('content') ?? ''
        if (/sign ?in|log ?in/i.test(title)) return true

        const hasSignInForm = Boolean(
          document.querySelector('input[name="session_key"]') ||
            document.querySelector('#username') ||
            document.querySelector('.authwall'),
        )
        const hasFeed = Boolean(
          document.querySelector('[data-urn], .feed-shared-update-v2, .scaffold-finite-scroll'),
        )
        return hasSignInForm && !hasFeed
      })
      .catch(() => false)
  },

  posts: async (ctx: AdapterContext, handle): Promise<AdapterResult<ScrapedPost>> => {
    const { page, log, limit } = ctx

    const missing = await page
      .locator('text=/This page doesn|Page not found|profile is not available/i')
      .count()
      .catch(() => 0)
    if (missing > 0) {
      return { ok: true, items: [], note: 'LinkedIn reports this profile as unavailable.' }
    }

    const found = new Map<string, ScrapedPost>()

    for (let round = 0; round < 8 && found.size < limit; round++) {
      const raw = await page.evaluate(harvest).catch(() => [] as RawItem[])

      for (const r of raw) {
        const id = r.urn?.match(/urn:li:activity:(\d+)/)?.[1]
        if (!id) continue
        const url = `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`
        if (found.has(url)) continue

        // "12 reactions · 3 comments" — parsed separately so a row carrying
        // only one of them does not contaminate the other.
        const counts = r.counts ?? ''
        const likes = counts.match(/([\d.,]+\s*[KMB]?)\s*(?:reaction|like)/i)?.[1] ?? null
        const comments = counts.match(/([\d.,]+\s*[KMB]?)\s*comment/i)?.[1] ?? null
        const shares = counts.match(/([\d.,]+\s*[KMB]?)\s*(?:repost|share)/i)?.[1] ?? null

        found.set(url, {
          url,
          id,
          title: r.text?.slice(0, 140) ?? null,
          // The feed renders relative ages ("2d"), not timestamps. Rather than
          // convert an approximation into a false ISO date, this is left null
          // and the app's own reader supplies the real one.
          publishedAt: null,
          likes: parseCount(likes),
          comments: parseCount(comments),
          shares: parseCount(shares),
          views: null,
        })
        if (found.size >= limit) break
      }

      if (found.size >= limit) break
      const grew = await autoScroll(page, { rounds: 1, pauseMs: 2_500 })
      if (grew === 0 && round > 1) break
    }

    if (found.size === 0) {
      return {
        ok: false,
        reason:
          'LinkedIn rendered no activity items. Its authwall returns HTTP 200, so this is most likely a signed-out session rather than an empty profile.',
      }
    }

    log(`LinkedIn: ${found.size} posts for ${normaliseHandle(handle)}`)
    return { ok: true, items: [...found.values()].slice(0, limit) }
  },

  /**
   * Left to the app's own reader.
   *
   * LinkedIn loads comments behind a "Load more comments" button inside a
   * virtualised list, and the app already extracts them from a post permalink
   * (measured: 5,078 likes, 464 comments, 10 comment bodies). Returning an
   * honest empty lets the app fall through to that rather than treating this
   * as an outage.
   */
  comments: async (): Promise<AdapterResult<ScrapedComment>> => ({
    ok: true,
    items: [],
    note: 'LinkedIn comments are left to the app’s own post reader.',
  }),
}
