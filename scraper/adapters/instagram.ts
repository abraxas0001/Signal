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

import type { Response } from 'playwright'
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
  cutCaption,
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

/**
 * The shortcode in a post or reel permalink.
 *
 * A grid link arrives in either of two shapes, the bare `/p/DaApzwuOb-p/` or
 * the profile scoped `/dkarunaofficial/reel/DaApzwuOb-p/`, and the collected
 * data holds both. The shortcode is the same string in either, and it is also
 * the key every payload below states a publish time against, so this is where
 * a tile and its date meet.
 */
function shortcodeOf(url: string): string | null {
  return url.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)?.[1] ?? null
}

/* ── dates ───────────────────────────────────────────────────────────────── */

/**
 * WHY THIS SECTION EXISTS.
 *
 * The grid markup carries no date: a tile is an anchor around a picture. This
 * adapter used to answer that with `publishedAt: null` and a comment saying
 * the app's per-post reader would supply it. That reader takes ONE post URL at
 * a time and is never run over a collected list, so nothing ever filled the
 * gap. Measured in the collected data: 25 Instagram posts for one account,
 * every one of them undated, while reactions were captured on 24. Every window
 * on the dashboard filters by date, so all 25 fell outside all of them and the
 * office was shown three posts by an account that had published twenty-five.
 *
 * WHAT IS READ, AND WHY IT IS NOT A GUESS. Instagram states a post's time as
 * `taken_at` (older payloads: `taken_at_timestamp`), a unix SECONDS value, on
 * the same JSON object that carries the post's `code`. That object reaches
 * this session twice over on a profile visit: once in the JSON the profile
 * document ships inline, once in each API response the grid fetches as it
 * scrolls. Neither costs a request this adapter was not already making.
 *
 * PAIRING IS STRUCTURAL, NEVER PROXIMITY. The shortcode and the timestamp are
 * taken from the SAME parsed object. A regex across a megabyte of minified
 * JSON would pair them by distance instead, and a date attached to the wrong
 * post is precisely the invented figure this product refuses to publish: it
 * would move a post into a week it was not in, and nothing downstream could
 * catch it. Anything unparseable, unpaired or implausible stays null.
 *
 * AND YES, THESE ARE INTERNAL FIELD NAMES, which the header of this file warns
 * against depending on. The defence is that nothing here trusts them: both
 * spellings are accepted, the pairing is structural, the value is range
 * checked, a miss produces null rather than a wrong date, and the log line
 * reports how many posts were dated out of how many, so the day Instagram
 * renames the field the run says "dated 0 of 25" instead of quietly filing a
 * roster of undated posts.
 */

/**
 * A unix SECONDS publish time, or null for anything that is not one.
 *
 * Instagram did not exist before 2010 and has published nothing dated in the
 * future, so a value outside that window is a different numeric field that
 * happens to sit nearby, or milliseconds, and this states no date for it.
 */
function publishedSeconds(value: unknown): number | null {
  // Some payloads quote the field, `"taken_at":"1755080000"`, and a run of ten
  // digits is not ambiguous. Anything else that is a string is not a time.
  const n = typeof value === 'string' && /^\d{10}$/.test(value) ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  const now = Date.now() / 1_000
  if (n < 1_262_304_000 || n > now + 86_400) return null
  return Math.floor(n)
}

/**
 * Every (shortcode → publish time) pair one blob of Instagram JSON states.
 *
 * Walks the parsed tree and records a pair only where one object carries both
 * facts itself. The first pair REACHED wins, and the walk is a stack, so
 * "first" means traversal order rather than document order; that is fine,
 * because every copy of a post in these payloads is Instagram's own statement
 * and the guard exists for a different reason: once an answer is recorded, no
 * copy reached later can replace it mid-walk.
 */
function collectDates(json: string, into: Map<string, number>): void {
  let root: unknown
  try {
    root = JSON.parse(json)
  } catch {
    /**
     * Some payloads are an object wrapped in a call, or guarded by a prefix:
     * `window.__additionalDataLoaded('extra',{…});` and the `for (;;);` header
     * Instagram puts on some responses. One rescue attempt at the outermost
     * braces; if that is not JSON either, this blob is skipped. An unreadable
     * payload is a gap, not a licence to go looking for a number.
     */
    const open = json.indexOf('{')
    const close = json.lastIndexOf('}')
    if (open < 0 || close <= open) return
    try {
      root = JSON.parse(json.slice(open, close + 1))
    } catch {
      return
    }
  }

  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child)
      continue
    }
    if (node === null || typeof node !== 'object') continue
    const obj = node as Record<string, unknown>

    const code =
      typeof obj['code'] === 'string'
        ? obj['code']
        : typeof obj['shortcode'] === 'string'
          ? obj['shortcode']
          : null
    const seconds = publishedSeconds(obj['taken_at']) ?? publishedSeconds(obj['taken_at_timestamp'])
    if (code && seconds !== null && !into.has(code)) into.set(code, seconds)

    for (const child of Object.values(obj)) stack.push(child)
  }
}

/**
 * The JSON the profile document itself ships, filtered inside the page.
 *
 * Instagram server renders the first page of tiles into
 * `<script type="application/json">` blocks holding the same objects its API
 * returns later. The filter runs in the page rather than here because those
 * blocks run to hundreds of kilobytes each and only the ones that state a time
 * are worth carrying back across the wire.
 */
async function pagePayloads(page: AdapterContext['page']): Promise<string[]> {
  return page
    .evaluate(() =>
      Array.from(document.querySelectorAll('script'))
        .map((s) => s.textContent ?? '')
        .filter((t) => t.length < 5_000_000 && t.includes('taken_at')),
    )
    .catch(() => [] as string[])
}

/**
 * One post's own page, for a post the profile's payloads did not date.
 *
 * FETCHED, NOT NAVIGATED, and the distinction is the whole reason this is
 * allowed to exist. The header of this file rejects visiting every permalink,
 * and it is right to: that would be a hundred and fifty page loads across this
 * roster, each one rendering a post, its media and its comment thread. This is
 * a single same-origin request for the HTML, made from the page already open
 * so the session's cookies ride along, with nothing rendered and no subresource
 * fetched. Honestly named: this is NOT a request the app itself would make.
 * The grid client-side routes and pulls API JSON when a tile is clicked; a
 * bare document fetch is a distinctly non-client shape on the platform most
 * aggressive about flagging automation, which is exactly why the caller
 * paces it, runs it only for posts nothing else dated, and gives up early.
 *
 * The caller runs it ONLY for posts still undated, pauses between them, and
 * stops after a short run of refusals, so a session Instagram has stopped
 * answering costs three requests rather than twenty-five.
 */
async function dateFromPostPage(
  page: AdapterContext['page'],
  shortcode: string,
): Promise<string | null> {
  // A /reel/ shortcode is asked for as /p/, exactly as the comments reader
  // does: the reel route serves a stripped player shell.
  const got = await page
    .evaluate(async (code: string) => {
      const res = await fetch(`https://www.instagram.com/p/${code}/`, { credentials: 'include' })
      if (!res.ok) return null
      const html = await res.text()

      // Only the scripts that could carry THIS post's time. The rest of a post
      // page is bundler output, and shipping it back would be megabytes.
      const blobs: string[] = []
      for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
        const body = m[1] ?? ''
        if (body.length < 5_000_000 && body.includes('taken_at') && body.includes(code)) {
          blobs.push(body)
        }
      }

      const times = Array.from(
        new Set(
          Array.from(html.matchAll(/<time[^>]*\bdatetime="([^"]+)"/g), (m) => m[1] ?? '').filter(
            (t) => t.length > 0,
          ),
        ),
      )
      return { blobs, times }
    }, shortcode)
    .catch(() => null)

  if (!got) return null

  const stated = new Map<string, number>()
  for (const blob of got.blobs) collectDates(blob, stated)
  const seconds = stated.get(shortcode)
  if (seconds !== undefined) return new Date(seconds * 1_000).toISOString()

  /**
   * The `<time datetime="…">` element, used only when the page carries exactly
   * one of them.
   *
   * A post page renders a time for the post and another for every comment
   * beneath it, and a suggested post alongside can bring its own. With several
   * on the page there is no way to say which one is this post's, and "take the
   * earliest" is a guess dressed as a rule. One timestamp is unambiguous; more
   * than one is a gap, and a gap is the honest answer.
   */
  if (got.times.length === 1) {
    const at = new Date(got.times[0] ?? '')
    if (!Number.isNaN(at.getTime())) return at.toISOString()
  }
  return null
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

    /**
     * Publish times, keyed by shortcode, as Instagram states them.
     *
     * The grid fetches each further page of tiles from Instagram's own API
     * while this scrolls, and those responses carry `taken_at` alongside each
     * post's `code`. Reading them as they arrive costs nothing: the requests
     * are the ones the page was making anyway, and this asks for no body it is
     * not already being handed. A response that never mentions the field is not
     * parsed at all.
     */
    const stated = new Map<string, number>()
    const bodies: Promise<void>[] = []
    const onResponse = (res: Response): void => {
      const type = res.headers()['content-type'] ?? ''
      if (!/json|javascript/i.test(type)) return
      bodies.push(
        res
          .text()
          .then((body) => {
            if (body.includes('taken_at')) collectDates(body, stated)
          })
          // A body already discarded by the browser is a gap in the dates, not
          // a failure of the read: the tiles themselves are unaffected.
          .catch(() => {}),
      )
    }

    page.on('response', onResponse)
    try {
      for (let round = 0; round < 8 && found.size < limit; round++) {
        const raw = await page.evaluate(harvest).catch(() => [] as { href: string; alt: string | null; thumb: string | null }[])

        for (const r of raw) {
          if (!POST_HREF.test(r.href)) continue
          const url = canonicalUrl(r.href, 'https://www.instagram.com')
          if (!url || found.has(url)) continue

          found.set(url, {
            url,
            id: shortcodeOf(url),
            title: cutCaption(r.alt),
            // The tile itself states no date; filled in below from the times
            // Instagram publishes for these shortcodes. Null here means only
            // "the grid did not say", and it stays null if nothing else does.
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
    } finally {
      // The page belongs to the walk, not to this call, and it stays open after
      // this returns. Detaching here is what stops the fallback fetches below,
      // and anything else that touches this page, from queueing body reads
      // nobody is waiting on. Reads already started still finish: their
      // promises are in `bodies` and are awaited before the map is used.
      page.off('response', onResponse)
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
     * The dates, from the payloads this visit already collected.
     *
     * The API responses caught above land in `stated` as they arrive; the
     * profile document's own inline JSON is read here, once. Both are parsed
     * by `collectDates`, which pairs a shortcode with a time only when one
     * object states both. See the block above `publishedSeconds` for why that
     * matters more than any other detail in this file.
     */
    /*
     * BOUNDED, because one of these bodies can simply never arrive. Meta's
     * feeds hold long-polling channels open indefinitely (browser.ts records
     * the same fact about networkidle), those channels are json/javascript,
     * and Response.text() in Playwright waits on response completion with no
     * timeout of its own. Unbounded, a single open channel parked this
     * function forever: no items, no ok:false, nothing for the finally in
     * orchestrate.ts to close. Eight seconds keeps every body that actually
     * arrived; a body still open after that was a socket, not a payload.
     */
    await Promise.race([
      Promise.allSettled(bodies),
      new Promise<void>((resolve) => setTimeout(resolve, 8_000)),
    ])
    for (const payload of await pagePayloads(page)) collectDates(payload, stated)

    for (const post of found.values()) {
      const code = shortcodeOf(post.url)
      const seconds = code ? stated.get(code) : undefined
      if (seconds !== undefined) post.publishedAt = new Date(seconds * 1_000).toISOString()
    }

    /**
     * Whatever is still undated, from each remaining post's own page.
     *
     * This is the expensive leg and it is deliberately the last one: it only
     * runs for posts the free sources did not date, it pauses between requests,
     * and three refusals in a row end it. That last rule is what keeps a
     * throttled or signed-out session from turning into twenty-five doomed
     * requests against the platform that punishes haste: after three silent
     * answers the assumption is that Instagram has stopped talking to us, not
     * that these particular posts are undated.
     */
    let fromPostPages = 0
    let refusals = 0
    let attempts = 0
    for (const post of found.values()) {
      if (refusals >= 3) break
      /* The refusal counter resets on success, so alternating answers could
         otherwise walk all twenty-five posts one slow request at a time. A
         dozen attempts is the whole budget for this leg, however they land. */
      if (attempts >= 12) break
      if (post.publishedAt !== null) continue
      const code = shortcodeOf(post.url)
      if (!code) continue

      attempts++
      const at = await dateFromPostPage(page, code)
      if (at === null) {
        refusals++
      } else {
        post.publishedAt = at
        fromPostPages++
        refusals = 0
      }
      // Jittered, for the reason the pacer in browser.ts is jittered: a
      // machine-perfect gap is itself a signal.
      await page.waitForTimeout(1_200 + Math.floor(Math.random() * 1_800))
    }

    const dated = [...found.values()].filter((p) => p.publishedAt !== null).length

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
        `, dated ${dated} of ${found.size}` +
        (fromPostPages > 0 ? ` (${fromPostPages} from post pages)` : '') +
        (read > 0 ? `, engagement on ${read}` : '') +
        (dropped > 0 ? ` (${dropped} dropped: likes below comments)` : ''),
    )

    /**
     * A roster of undated posts is reported rather than left to be discovered.
     *
     * The posts are real and the read succeeded, so this is not a failure, but
     * every window on the dashboard filters by date, so an undated post is one
     * nobody will see. Saying so here is the difference between a known gap and
     * an account that appears to have gone quiet.
     */
    return {
      ok: true,
      items: [...found.values()].slice(0, limit),
      /* Partial coverage is the same gap at smaller scale: five dated of
         twenty-five leaves twenty posts invisible to every date-filtered
         window with nothing telling the office why. The note names the split
         whenever anything is missing, not only when everything is. */
      ...(dated < found.size
        ? {
            note:
              dated === 0
                ? 'Instagram stated no publish time for any of these posts. They are undated, not old, and date-filtered views will not show them.'
                : `Instagram stated a publish time for ${dated} of these ${found.size} posts. The rest are undated, not old, and date-filtered views will not show them.`,
          }
        : {}),
    }
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
