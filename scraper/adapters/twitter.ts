/**
 * X / Twitter.
 *
 * The most tractable of the four, and the only one that still ships stable
 * `data-testid` attributes: tweets are `article[data-testid="tweet"]`, and the
 * engagement controls are `data-testid="like" | "reply" | "retweet"`. Those
 * names have survived several redesigns, so this adapter reads them rather
 * than the hashed class names everything else is built from.
 *
 * Counts come off the controls' ARIA labels ("1,234 Likes"), because the
 * visible text is abbreviated to "1.2K" and rounds away precision the label
 * keeps. Where a label is absent — X hides counts under some settings — the
 * metric stays null. It is never zero: a tweet nobody liked and a tweet whose
 * like count we could not read must not look the same on the dashboard.
 *
 * COLLECTED WHILE SCROLLING, not after. X virtualises hard: rows that leave
 * the viewport are removed from the DOM, so a single query at the end returns
 * only the last screenful. Each scroll round re-queries and merges into a Map
 * keyed by canonical URL, which also collapses the pinned tweet appearing
 * twice.
 */

import { isLoggedOut } from '../session'
import {
  canonicalUrl,
  parseCount,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
  type ScrapedComment,
  type ProfileInfo,
  type ScrapedPost,
} from '../types'
import { autoScroll } from '../browser'

/** Raw shape lifted out of the page, before we coerce it. */
interface RawTweet {
  href: string
  text: string | null
  time: string | null
  likes: string | null
  replies: string | null
  reposts: string | null
  views: string | null
  thumb: string | null
}

/**
 * Read every tweet currently in the DOM.
 *
 * Runs inside the page because reaching across the CDP boundary per element
 * would be dozens of round trips per scroll round on a feed this dense.
 */
function harvest(): RawTweet[] {
  const out: RawTweet[] = []
  const articles = document.querySelectorAll('article[data-testid="tweet"]')

  for (const art of Array.from(articles)) {
    // The permalink is the only anchor whose href carries /status/<digits>.
    // Quoted tweets embed a second one, so take the first — the outer article
    // always renders its own link before any quote it contains.
    const link = Array.from(art.querySelectorAll('a[href*="/status/"]')).find((a) =>
      /\/status\/\d+/.test((a as HTMLAnchorElement).getAttribute('href') ?? ''),
    ) as HTMLAnchorElement | undefined
    if (!link) continue

    /**
     * The engagement labels, read inline.
     *
     * There used to be a `const label = (testid) => ...` helper here and it
     * broke the entire adapter silently. tsx compiles this file through
     * esbuild with keepNames, which wraps every named function — including an
     * arrow assigned to a const INSIDE this one — in a `__name(...)` call.
     * `page.evaluate` ships the function source into the browser, where
     * `__name` does not exist, so harvest threw ReferenceError on its first
     * tweet, the caller's `.catch(() => [])` turned that into an empty list,
     * and X was reported as unreadable while the timeline sat there fully
     * rendered. Nothing inside a function passed to `evaluate` may be a named
     * function; the cost of repeating the selector is the price of that.
     */
    // Views are not a testid control; they ride on the analytics link.
    const viewsEl = Array.from(art.querySelectorAll('a[href*="/analytics"]')).at(0)
    const viewsLabel =
      viewsEl?.getAttribute('aria-label') ?? viewsEl?.textContent ?? null

    out.push({
      href: link.getAttribute('href') ?? '',
      text: art.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? null,
      time: art.querySelector('time')?.getAttribute('datetime') ?? null,
      likes:
        art.querySelector('[data-testid="like"]')?.getAttribute('aria-label') ??
        art.querySelector('[data-testid="unlike"]')?.getAttribute('aria-label') ??
        null,
      replies: art.querySelector('[data-testid="reply"]')?.getAttribute('aria-label') ?? null,
      reposts:
        art.querySelector('[data-testid="retweet"]')?.getAttribute('aria-label') ??
        art.querySelector('[data-testid="unretweet"]')?.getAttribute('aria-label') ??
        null,
      // The card's own picture. Photos and video posters both live under a
      // testid; a text tweet has neither and stays null.
      thumb:
        art.querySelector('[data-testid="tweetPhoto"] img')?.getAttribute('src') ??
        art.querySelector('[data-testid="videoComponent"] img')?.getAttribute('src') ??
        null,
      views: viewsLabel,
    })
  }
  return out
}

/** "1,234 Likes" / "Liked. 1,234" → 1234; anything unreadable → null. */
function fromLabel(label: string | null): number | null {
  if (!label) return null
  const m = label.match(/([\d.,]+)\s*(K|M|B)?/i)
  return m ? parseCount(m[0]) : null
}

function normaliseHandle(handle: string): string {
  const h = handle.trim().replace(/^@/, '')
  const asUrl = h.match(/(?:twitter|x)\.com\/([^/?#]+)/i)
  return (asUrl?.[1] ?? h).replace(/\/+$/, '')
}

export const twitter: PlatformAdapter = {
  platform: 'Twitter/X',

  profileUrl: (handle) => `https://x.com/${normaliseHandle(handle)}`,

  /**
   * Measured: signed out, `x.com/home` redirects to `x.com/` — no /login in
   * the URL and no username field on the landing page. Every wall marker this
   * used to look for missed, so it reported a never-signed-in profile as
   * signed in. `isLoggedOut` asks for proof of a session instead.
   */
  isLoginWall: ({ page }) => isLoggedOut(page, 'Twitter/X'),

  /**
   * The header: display name, follower count, avatar.
   *
   * X puts the follower total behind a link to /verified_followers, which is
   * both stable and locale-independent as a SELECTOR — only the word beside the
   * number translates, and parseCount handles that. Measured: "107.1M
   * Followers" on a profile with 107,100,000.
   */
  profile: async ({ page }: AdapterContext): Promise<ProfileInfo> => {
    const raw = await page
      .evaluate(() => {
        const followLink =
          document.querySelector('a[href$="/verified_followers"]') ??
          document.querySelector('a[href$="/followers"]')
        return {
          followers: followLink?.textContent?.trim() ?? null,
          displayName:
            document.querySelector('[data-testid="UserName"]')?.textContent?.trim().split('@')[0]?.trim() ??
            null,
          avatarUrl:
            document.querySelector('[data-testid^="UserAvatar-Container"] img')?.getAttribute('src') ??
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
    const found = new Map<string, ScrapedPost>()

    // A profile that exists but has been suspended or renamed shows this
    // instead of a timeline, and it is a real answer rather than a failure.
    const gone = await page
      .locator('text=/This account doesn|Account suspended|These posts are protected/i')
      .count()
      .catch(() => 0)
    if (gone > 0) {
      return { ok: true, items: [], note: 'X reports this account as unavailable or protected.' }
    }

    /**
     * Wait for the first tweet before reading anything.
     *
     * X's timeline is not in the initial HTML and takes several seconds to
     * paint. Measured on a profile with 52,000 posts: nothing at all at 2.5s,
     * three tweets at 3s, nine at 6s, eleven by 12s. The reader used to harvest
     * as soon as navigation settled, find an empty page, scroll once, see no
     * height change because the timeline had not rendered yet, and break out —
     * then report that it could not read the account. The session was fine and
     * the tweets arrived a few seconds after it gave up.
     *
     * Waiting on the selector rather than on a fixed delay means a fast load is
     * not punished with a sleep, and a genuinely empty timeline still falls
     * through to the honest "could not read" below rather than being dressed up
     * as a silent account.
     */
    await page
      .waitForSelector('article[data-testid="tweet"]', { timeout: 25_000 })
      .catch(() => {})

    for (let round = 0; round < 10 && found.size < limit; round++) {
      // A crash in here must not be indistinguishable from an empty timeline.
      // Swallowing it silently is exactly how a ReferenceError inside harvest
      // spent an afternoon looking like "X has no posts".
      const raw = await page.evaluate(harvest).catch((err: Error) => {
        log(`X: harvest failed — ${err.message.split('\n')[0]}`)
        return [] as RawTweet[]
      })

      for (const t of raw) {
        const url = canonicalUrl(t.href, 'https://x.com')
        if (!url || found.has(url)) continue
        const id = url.match(/\/status\/(\d+)/)?.[1] ?? null
        found.set(url, {
          url,
          id,
          title: t.text,
          publishedAt: t.time,
          likes: fromLabel(t.likes),
          comments: fromLabel(t.replies),
          shares: fromLabel(t.reposts),
          views: fromLabel(t.views),
          thumbnailUrl: t.thumb,
        })
        if (found.size >= limit) break
      }

      if (found.size >= limit) break
      const grew = await autoScroll(page, { rounds: 1, pauseMs: 1_500 })
      // Three quiet rounds, not one. X's timeline is virtualised and recycles
      // nodes as it goes, so a single scroll that adds no height is normal
      // mid-load rather than proof the feed has ended.
      if (grew === 0 && round > 3) break
    }

    /**
     * Nothing at all is ambiguous, so it is reported as a failure rather than
     * an empty profile. A real account with zero posts is rare; a timeline
     * that did not render because X served a placeholder is not. The caller
     * shows "could not read" instead of asserting the rival is silent.
     */
    if (found.size === 0) {
      return {
        ok: false,
        reason: 'X rendered no tweets. The timeline may not have loaded, or the session may be stale.',
      }
    }

    log(`X: ${found.size} tweets for @${normaliseHandle(handle)}`)
    return { ok: true, items: [...found.values()].slice(0, limit) }
  },

  /**
   * Replies on a status page are the same `article[data-testid="tweet"]` node
   * as the post, so the first one is dropped — it is the tweet itself, not a
   * comment on it.
   */
  comments: async (ctx: AdapterContext): Promise<AdapterResult<ScrapedComment>> => {
    const { page, limit } = ctx
    await autoScroll(page, { rounds: 4, pauseMs: 1_500 })

    const rows = await page
      .evaluate(() => {
        const arts = Array.from(document.querySelectorAll('article[data-testid="tweet"]'))
        return arts.map((a) => ({
          text: a.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? '',
          author:
            a.querySelector('[data-testid="User-Name"]')?.textContent?.trim().split('@')[0]?.trim() ??
            null,
          time: a.querySelector('time')?.getAttribute('datetime') ?? null,
          likes: a.querySelector('[data-testid="like"]')?.getAttribute('aria-label') ?? null,
        }))
      })
      .catch(() => [] as { text: string; author: string | null; time: string | null; likes: string | null }[])

    if (rows.length === 0) {
      return { ok: false, reason: 'X rendered no tweet on this page.' }
    }

    return {
      ok: true,
      items: rows
        .slice(1, limit + 1)
        .filter((r) => r.text.length > 0)
        .map((r) => ({
          text: r.text,
          author: r.author,
          likes: fromLabel(r.likes),
          publishedAt: r.time,
          isReply: true,
        })),
    }
  },
}
