/**
 * Instagram.
 *
 * THE MOST FRAGILE OF THE FOUR, and it is worth saying so at the top rather
 * than discovering it in production. Instagram rotates the internal
 * identifiers its own client uses every two to four weeks, ships obfuscated
 * class names, and is the most aggressive of the four about flagging
 * automation. This adapter therefore avoids all of that surface and reads the
 * one thing that has been stable for years: the shape of a post permalink,
 * `/p/<shortcode>/` and `/reel/<shortcode>/`.
 *
 * COUNTS ARE NULL BY DESIGN. The profile grid does not render like or comment
 * totals — on some accounts they appear on hover, driven by a script that also
 * watches for synthetic events. Hovering twenty tiles to harvest numbers is
 * both unreliable and the single most bot-like thing this service could do.
 * The metrics stay null and the app's own per-post reader supplies exact
 * figures from the URL, which it already does well: measured at 33,658 likes
 * and 309 comments on a reel, unaided.
 *
 * PACING. Instagram gets the longest gap of any platform in browser.ts (12s
 * base plus jitter). That is not caution for its own sake — a flagged session
 * costs the office the login the whole service depends on, and it is not
 * recoverable by retrying.
 */

import {
  canonicalUrl,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
  type ScrapedComment,
  type ScrapedPost,
} from '../types'
import { autoScroll } from '../browser'

/** Post and reel permalinks. Stories and highlights are deliberately excluded. */
const POST_HREF = /\/(p|reel)\/[A-Za-z0-9_-]+/

function harvest(): { href: string; alt: string | null }[] {
  const out: { href: string; alt: string | null }[] = []
  const seen = new Set<string>()

  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const href = (a as HTMLAnchorElement).getAttribute('href') ?? ''
    if (!href || seen.has(href)) continue
    seen.add(href)
    // The tile's image alt text is Instagram's own generated description and
    // is the only text the grid offers — useful as a title preview.
    const alt = a.querySelector('img')?.getAttribute('alt') ?? null
    out.push({ href, alt })
  }
  return out
}

function normaliseHandle(handle: string): string {
  const h = handle.trim().replace(/^@/, '')
  const asUrl = h.match(/instagram\.com\/([^/?#]+)/i)
  return (asUrl?.[1] ?? h).replace(/\/+$/, '')
}

export const instagram: PlatformAdapter = {
  platform: 'Instagram',

  profileUrl: (handle) => `https://www.instagram.com/${normaliseHandle(handle)}/`,

  /**
   * Instagram's wall takes two forms: a redirect to /accounts/login/, and a
   * modal laid over a partially rendered profile. The second is why the DOM
   * check exists — the URL still reads as the profile while the content
   * underneath is inert.
   */
  isLoginWall: async ({ page }) => {
    const url = page.url()
    if (/\/accounts\/login|\/accounts\/signup/i.test(url)) return true
    return page
      .evaluate(() => {
        const hasLoginForm = Boolean(
          document.querySelector('input[name="username"]') &&
            document.querySelector('input[name="password"]'),
        )
        const hasGrid = Boolean(document.querySelector('a[href*="/p/"], a[href*="/reel/"]'))
        return hasLoginForm && !hasGrid
      })
      .catch(() => false)
  },

  posts: async (ctx: AdapterContext, handle): Promise<AdapterResult<ScrapedPost>> => {
    const { page, log, limit } = ctx

    // Real answers about the account, distinct from a failure to read it.
    const state = await page
      .evaluate(() => {
        const t = document.body.textContent ?? ''
        if (/Sorry, this page isn't available/i.test(t)) return 'missing'
        if (/This Account is Private/i.test(t)) return 'private'
        if (/No Posts Yet/i.test(t)) return 'empty'
        return 'ok'
      })
      .catch(() => 'ok')

    if (state === 'missing') {
      return { ok: true, items: [], note: 'Instagram reports this account as unavailable.' }
    }
    if (state === 'private') {
      return { ok: true, items: [], note: 'This account is private; its grid is not readable.' }
    }
    if (state === 'empty') {
      return { ok: true, items: [], note: 'Instagram reports this account has no posts.' }
    }

    const found = new Map<string, ScrapedPost>()

    for (let round = 0; round < 8 && found.size < limit; round++) {
      const raw = await page.evaluate(harvest).catch(() => [] as { href: string; alt: string | null }[])

      for (const r of raw) {
        if (!POST_HREF.test(r.href)) continue
        const url = canonicalUrl(r.href, 'https://www.instagram.com')
        if (!url || found.has(url)) continue

        found.set(url, {
          url,
          id: url.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)?.[1] ?? null,
          title: r.alt?.slice(0, 140) ?? null,
          // The grid carries no dates. The app's per-post reader gets them.
          publishedAt: null,
          likes: null,
          comments: null,
          shares: null,
          views: null,
        })
        if (found.size >= limit) break
      }

      if (found.size >= limit) break
      // Generous pause: this is the platform that punishes haste.
      const grew = await autoScroll(page, { rounds: 1, pauseMs: 3_000 })
      if (grew === 0 && round > 1) break
    }

    /**
     * An account that reached here is not private, not missing and not
     * declared empty by Instagram itself — so a grid with no tiles means the
     * read failed, not that the account is silent. Measured: Instagram answers
     * a datacentre IP with HTTP 429 and renders nothing, which is exactly this
     * state.
     */
    if (found.size === 0) {
      return {
        ok: false,
        reason:
          'Instagram rendered no post tiles. The session may be stale or rate limited — it throttles hard.',
      }
    }

    log(`Instagram: ${found.size} posts for @${normaliseHandle(handle)}`)
    return { ok: true, items: [...found.values()].slice(0, limit) }
  },

  /**
   * Not implemented, and returning an honest empty rather than a guess.
   *
   * Instagram's comment list is a virtualised scroller behind a "load more"
   * button whose markup is among the fastest-rotating on the site. The app
   * already reads comments from a post URL through its own embed route, which
   * is cheaper and does not spend the session's goodwill. An empty `ok: true`
   * is the contract's way of saying "I have nothing to add" — the app then
   * falls through to that reader rather than treating this as an outage.
   */
  comments: async (): Promise<AdapterResult<ScrapedComment>> => ({
    ok: true,
    items: [],
    note: 'Instagram comments are left to the app’s own post reader.',
  }),
}
