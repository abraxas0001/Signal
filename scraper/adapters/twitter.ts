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

/** Raw shape lifted out of the page, before we coerce it. */
interface RawTweet {
  href: string
  text: string | null
  time: string | null
  likes: string | null
  replies: string | null
  reposts: string | null
  views: string | null
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

    const label = (testid: string): string | null => {
      const el = art.querySelector(`[data-testid="${testid}"]`)
      return el?.getAttribute('aria-label') ?? null
    }

    // Views are not a testid control; they ride on the analytics link.
    const viewsEl = Array.from(art.querySelectorAll('a[href*="/analytics"]')).at(0)
    const viewsLabel =
      viewsEl?.getAttribute('aria-label') ?? viewsEl?.textContent ?? null

    out.push({
      href: link.getAttribute('href') ?? '',
      text: art.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? null,
      time: art.querySelector('time')?.getAttribute('datetime') ?? null,
      likes: label('like') ?? label('unlike'),
      replies: label('reply'),
      reposts: label('retweet') ?? label('unretweet'),
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
   * Both halves matter. X will happily render a profile shell to a signed-out
   * visitor and then refuse the timeline, so a URL check alone reports an
   * active account as empty.
   */
  isLoginWall: async ({ page }) => {
    const url = page.url()
    if (/\/i\/flow\/login|\/login|\/i\/flow\/signup/.test(url)) return true
    return page
      .evaluate(() => {
        const hasSignIn = Boolean(
          document.querySelector('input[autocomplete="username"]') ||
            document.querySelector('a[href="/login"]'),
        )
        const hasTimeline = Boolean(
          document.querySelector('article[data-testid="tweet"]') ||
            document.querySelector('[data-testid="primaryColumn"]'),
        )
        return hasSignIn && !hasTimeline
      })
      .catch(() => false)
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

    for (let round = 0; round < 10 && found.size < limit; round++) {
      const raw = await page.evaluate(harvest).catch(() => [] as RawTweet[])

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
        })
        if (found.size >= limit) break
      }

      if (found.size >= limit) break
      const grew = await autoScroll(page, { rounds: 1, pauseMs: 1_500 })
      if (grew === 0 && round > 1) break
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
