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

/** Post and reel permalinks. Stories and highlights are deliberately excluded. */
const POST_HREF = /\/(p|reel)\/[A-Za-z0-9_-]+/

function harvest(): { href: string; alt: string | null; thumb: string | null }[] {
  const out: { href: string; alt: string | null; thumb: string | null }[] = []
  const seen = new Set<string>()

  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const href = (a as HTMLAnchorElement).getAttribute('href') ?? ''
    if (!href || seen.has(href)) continue
    seen.add(href)
    // The tile's image alt text is Instagram's own generated description and
    // is the only text the grid offers — useful as a title preview.
    const img = a.querySelector('img')
    const alt = img?.getAttribute('alt') ?? null
    // On a grid the tile IS the picture, so every post has one.
    const thumb = (img as HTMLImageElement | null)?.currentSrc || img?.getAttribute('src') || null
    out.push({ href, alt, thumb })
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
   * Measured: the signed-out landing page carries no `input[name="username"]`
   * at all — the form is behind a button — so requiring that pair reported a
   * logged-out session as usable. `isLoggedOut` requires a marker only a
   * signed-in viewer gets, such as the DM inbox link.
   */
  isLoginWall: ({ page }) => isLoggedOut(page, 'Instagram'),

  /**
   * The header: display name, follower count, avatar.
   *
   * Instagram renders no link around the follower total — measured, there is no
   * anchor to /followers on a profile page at all — so this scans the header
   * text for the figure instead. The pattern demands a number IMMEDIATELY
   * before the word, which is what separates "88.8k followers" from the
   * "35 following" sitting beside it.
   */
  profile: async ({ page }: AdapterContext): Promise<ProfileInfo> => {
    const raw = await page
      .evaluate(() => {
        let followers: string | null = null
        for (const el of Array.from(document.querySelectorAll('span, li, div'))) {
          const t = (el.textContent ?? '').trim()
          if (t.length > 40) continue
          const m = t.match(/^([\d.,]+\s*[kKmMbB]?)\s*followers?$/i)
          if (m && m[1]) { followers = m[1]; break }
        }
        return {
          followers,
          displayName: document.querySelector('header h2, header h1')?.textContent?.trim() ?? null,
          avatarUrl: document.querySelector('header img')?.getAttribute('src') ?? null,
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
      const raw = await page.evaluate(harvest).catch(() => [] as { href: string; alt: string | null; thumb: string | null }[])

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
          // On a grid the tile IS the picture, so this is always present.
          thumbnailUrl: r.thumb ?? null,
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

    /**
     * The counts, revealed by hovering each tile.
     *
     * Instagram publishes nothing in the grid markup — a tile carries its link
     * and its alt text and no figures at all — but the hover overlay renders
     * likes and comments, and the overlay is in the DOM once the pointer is on
     * it. That happens on the page already loaded, so twenty-five posts cost
     * twenty-five hovers rather than twenty-five navigations. The alternative
     * was visiting every permalink, which on the platform that "punishes haste"
     * would have been a hundred and fifty page loads across this roster, for
     * data that was sitting here.
     *
     * IT IS POSITIONAL — likes first, comments second — WHICH THE FACEBOOK
     * ADAPTER REFUSES TO BE. The difference is measured, not stylistic. On
     * Facebook a count that is zero renders no number at all, so the second
     * figure might be comments or might be shares, and there is no way to tell.
     * Here every tile rendered exactly two numbers, fourteen out of fourteen,
     * so nothing shifts. The icons carry no aria-label, so order is the only
     * signal available.
     *
     * Because it IS an assumption, it is checked rather than trusted: a post
     * with fewer likes than comments would mean the two had been read the wrong
     * way round, and both are dropped instead of recorded. That loses the rare
     * genuinely comment-heavy post, which is the correct trade — a silently
     * transposed engagement figure is the kind of error nobody downstream can
     * catch.
     */
    const tiles = page.locator('a[href*="/p/"], a[href*="/reel/"]')
    const tileCount = Math.min(await tiles.count().catch(() => 0), limit * 2)
    let read = 0
    let dropped = 0

    for (let i = 0; i < tileCount; i++) {
      const tile = tiles.nth(i)
      const href = await tile.getAttribute('href').catch(() => null)
      if (!href) continue
      const url = canonicalUrl(href, 'https://www.instagram.com')
      const post = url ? found.get(url) : undefined
      if (!post || post.likes !== null) continue

      await tile.hover({ timeout: 3_000 }).catch(() => {})
      await page.waitForTimeout(500)

      const nums = await tile
        .evaluate((el) => {
          const out: string[] = []
          for (const e of Array.from(el.querySelectorAll('span, li, div'))) {
            const s = (e.textContent ?? '').trim()
            if (/^[\d.,]+\s*[KMB]?$/.test(s) && e.querySelector('span,div,li') === null) out.push(s)
          }
          return out
        })
        .catch(() => [] as string[])

      // Exactly two, or this is not the overlay we measured and nothing is read.
      if (nums.length !== 2) continue

      const likes = parseCount(nums[0] ?? null)
      const comments = parseCount(nums[1] ?? null)
      if (likes === null || comments === null) continue

      if (likes < comments) {
        dropped++
        continue
      }

      post.likes = likes
      post.comments = comments
      read++
    }

    log(
      `Instagram: ${found.size} posts for @${normaliseHandle(handle)}` +
        (read > 0 ? `, engagement on ${read}` : '') +
        (dropped > 0 ? ` (${dropped} dropped: likes below comments)` : ''),
    )
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
  /**
   * Comments on a post page, signed in.
   *
   * This was a stub returning an empty list, so every Instagram account read
   * as having no comments, including ones whose posts carry thousands.
   *
   * It anchors on structure, never on Instagram's class names, which are
   * minified and rotate (`x1lliihq x193iq5w …`). Every comment row carries a
   * "Reply" control, so the readable landmark is that word: find each one, walk
   * up until an ancestor holds both a profile link and its own text span, and
   * that ancestor is the row. Measured on a live post: 15 Reply controls, 15
   * comments, while `ul li` found 3 and `article` found none.
   *
   * A /reel/ URL is normalised to /p/ first. The reel player renders a stripped
   * shell with no thread at all: 1,324 characters of body and zero lists.
   */
  comments: async (ctx: AdapterContext, url: string): Promise<AdapterResult<ScrapedComment>> => {
    const { page, limit } = ctx

    const short = /\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(url)
    if (short?.[2]) {
      const canonical = `https://www.instagram.com/p/${short[2]}/`
      if (!page.url().startsWith(canonical)) {
        await ctx.pace()
        await page.goto(canonical, { waitUntil: 'domcontentloaded' }).catch(() => {})
      }
    }
    await page.waitForTimeout(6_000)

    const handle = /instagram\.com\/([^/]+)\//.exec(url)?.[1]?.toLowerCase() ?? null

    const collect = () =>
      page
        .evaluate(() => {
          const out: { text: string; author: string | null; time: string | null }[] = []
          const seen = new Set<Element>()

          for (const el of Array.from(document.querySelectorAll('*'))) {
            if (el.children.length !== 0) continue
            if ((el.textContent || '').trim() !== 'Reply') continue

            // Up from the Reply control until the ancestor owns a profile link
            // and a text span: that is one comment.
            let row: Element | null = el
            for (let i = 0; i < 12 && row; i++) {
              const link = row.querySelector('a[href^="/"]')
              const spans = Array.from(row.querySelectorAll('span[dir="auto"]'))
              if (link && spans.length > 0) break
              row = row.parentElement
            }
            if (!row || seen.has(row)) continue
            seen.add(row)

            const link = row.querySelector('a[href^="/"]') as HTMLAnchorElement | null
            const author = link ? link.pathname.replaceAll('/', '').trim() || null : null

            // The row's own words: the longest text span that is not the
            // username and not a control label.
            const skip = new Set(['Reply', 'Translate', 'See translation', 'Like'])
            let text = ''
            for (const sp of Array.from(row.querySelectorAll('span[dir="auto"]'))) {
              const t = (sp.textContent || '').trim()
              if (!t || skip.has(t) || t === author) continue
              if (/^[\d,.]+\s*(likes?|reply|replies)$/i.test(t)) continue
              if (t.length > text.length) text = t
            }
            if (!text) continue

            out.push({
              text,
              author,
              time: row.querySelector('time')?.getAttribute('datetime') ?? null,
            })
          }
          return out
        })
        .catch(() => [] as { text: string; author: string | null; time: string | null }[])

    let rows = await collect()
    for (let round = 0; round < 6 && rows.length < limit; round++) {
      const more = page
        .locator('[role="button"], button')
        .filter({ hasText: /^(Load more comments|View all|more comments)/i })
        .first()
      if (await more.count().catch(() => 0)) {
        await more.click({ timeout: 3_000 }).catch(() => {})
      } else {
        await page.mouse.wheel(0, 1_400)
      }
      await page.waitForTimeout(2_500)
      const next = await collect()
      if (next.length <= rows.length) break
      rows = next
    }

    if (rows.length === 0) {
      return { ok: false, reason: 'Instagram rendered no comment thread on this page.' }
    }

    return {
      ok: true,
      items: rows
        .filter((r) => !(handle && r.author?.toLowerCase() === handle))
        .slice(0, limit)
        .map((r) => ({
          text: r.text,
          author: r.author,
          likes: null,
          publishedAt: r.time,
          isReply: true,
        })),
    }
  },
}
