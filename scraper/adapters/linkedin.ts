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

import { isLoggedOut } from '../session'
import {
  parseCount,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
  type ScrapedComment,
  type ProfileInfo,
  type ScrapedPost,
} from '../types'
import { autoScroll } from '../browser'

interface RawItem {
  urn: string | null
  text: string | null
  /** The social counts row, e.g. "12 reactions · 3 comments". */
  counts: string | null
  thumb: string | null
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
      /**
       * The counts row plus every numeric aria-label in the item.
       *
       * The row's own text reads "1,541 87 comments 148 reposts" — the
       * reaction total is a BARE number with no word beside it, so a reader
       * looking for "N reactions" found the comments and reposts and returned
       * null for likes on every post. Taking the leading number positionally
       * would break on a post with no reactions, where the row starts "87
       * comments" and 87 would be recorded as likes.
       *
       * The aria-labels say it outright — "1,541 reactions", "87 comments on
       * …'s post" — so they are appended and matched by word like the rest. A
       * label in another interface language simply will not match, and likes
       * come back null, which is the honest outcome rather than a guess.
       */
      // The attached picture, by rendered size. A feed item also carries the
      // author's avatar and reactor faces, all from the same CDN; 200px of
      // width leaves only the post's own image.
      thumb:
        Array.from(el.querySelectorAll('img'))
          .map((im) => im as HTMLImageElement)
          .filter((im) => im.naturalWidth >= 200)
          .sort((a, b) => b.naturalWidth - a.naturalWidth)[0]?.currentSrc ?? null,
      counts: [
        el.querySelector('.social-details-social-counts, [class*="social-counts"]')?.textContent?.trim() ?? '',
        ...Array.from(el.querySelectorAll('[aria-label]'))
          .map((e) => e.getAttribute('aria-label') ?? '')
          .filter((l) => /[0-9]/.test(l)),
      ]
        .filter(Boolean)
        .join(' · ') || null,
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
   * The most consequential of the four, because LinkedIn's authwall is served
   * as HTTP 200 and is otherwise indistinguishable from an empty profile.
   * Measured signed out it redirects to /login/ with the title "LinkedIn
   * Login, Sign in", which `isLoggedOut` catches on the URL before it even
   * reaches the DOM — and if LinkedIn ever stops redirecting, the demand for
   * a signed-in marker still holds the line.
   */
  isLoginWall: ({ page }) => isLoggedOut(page, 'LinkedIn'),

  /**
   * The header: display name, follower count, avatar.
   *
   * Measured as plain text — "12,134,770 followers" — with no link and no
   * stable class worth trusting, LinkedIn having already renamed
   * `.global-nav__me` and `.scaffold-finite-scroll` out from under this file
   * once today. A text scan bounded to short strings survives that; a class
   * name would need rewriting at the next redesign.
   *
   * Note this reads the ACTIVITY page the posts came from, which carries the
   * same header as the profile.
   */
  profile: async ({ page }: AdapterContext): Promise<ProfileInfo> => {
    const raw = await page
      .evaluate(() => {
        let followers: string | null = null
        for (const el of Array.from(document.querySelectorAll('span, p, div, li'))) {
          const t = (el.textContent ?? '').trim()
          if (t.length > 40) continue
          const m = t.match(/^([\d.,]+\s*[kKmMbB]?)\s*followers?$/i)
          if (m && m[1]) { followers = m[1]; break }
        }
        return {
          followers,
          displayName: document.querySelector('h1')?.textContent?.trim() ?? null,
          avatarUrl:
            document.querySelector('img.pv-top-card-profile-picture__image--show, .profile-photo-edit__preview')?.getAttribute('src') ??
            null,
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
          thumbnailUrl: r.thumb ?? null,
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
