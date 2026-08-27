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
  type ProfileInfo,
  type ScrapedPost,
} from '../types'
import { autoScroll } from '../browser'

/** The permalink shapes a Facebook post can take. */
/**
 * Each shape a Facebook permalink takes.
 *
 * The segments that carry a numeric id demand one. Written without that, the
 * pattern accepted the bare `facebook.com/reel/` sitting in the profile’s own
 * navigation and recorded it as a post — a URL with no id, pointing at a
 * product surface rather than at anything this politician published.
 */
const POST_HREF =
  /(\/posts\/|\/permalink\.php\?|\/videos\/[0-9]|\/reel\/[0-9]|\/share\/p\/|story_fbid=)/i

/** Chrome, navigation and product links that also live on a profile page. */
const NOISE = /\/(login|privacy|policies|help|settings|marketplace|gaming|watch\/?$)/i

interface RawPost {
  href: string
  /** Text of the post container this link sits in, for a title preview. */
  text: string | null
  /** Any aria-label on the container that might carry counts. */
  label: string | null
  time: string | null
  /** Counts lifted from the action row, each identified by its own button. */
  likes: string | null
  comments: string | null
  shares: string | null
  /** Per-reaction totals off the summary pills, for posts that show no Like figure. */
  reactionPills: string[]
  thumb: string | null
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

    // The post BODY, not the card's textContent. A card begins with the
    // author, their verification badge, a location, a relative age and an
    // audience note, so `textContent` yielded titles reading "D K Aruna
    // वेरिफ़ाई किया गया अकाउंट, Gadwal,Telangana में हैं.3 दिन · इनके साथ शेयर
    // किया गया" — the same chrome on every post, with the caption pushed past
    // the 140-character cut. These two attributes wrap the caption alone;
    // measured, they return the Telugu post text cleanly.
    //
    // Null when neither is present rather than falling back to the card text:
    // a post with no caption genuinely has no title, and repeating the chrome
    // would dress that absence up as content. Comment threads are `article`s
    // too and carry neither attribute, so this also keeps a reply's text from
    // being recorded as the post's.
    const body =
      article?.querySelector('[data-ad-comet-preview="message"]')?.textContent?.trim() ??
      article?.querySelector('[data-ad-preview="message"]')?.textContent?.trim() ??
      null

    /**
     * The counts, each taken from the button that names it.
     *
     * Measured on a live profile: every figure in the action row sits inside
     * its own `[role="button"]`, and that button's aria-label says which count
     * it is — "लाइक करें" / "कमेंट करें" / "इसे अपने दोस्तों को भेजें". So the
     * number is identified by WHAT IT BELONGS TO, not by where it appears.
     *
     * That distinction is the whole reason these are read at all now. The
     * earlier attempt looked at the bare number spans in order — [140, 6, 12]
     * for reactions, comments, shares — and was rejected, correctly: a post
     * with no shares renders two spans, not three, and the comment count would
     * have been filed as shares. Reading each from its own button removes the
     * ordering assumption entirely; a missing count is simply a button with no
     * number in it, and stays null.
     *
     * The labels are matched in several languages because this desk's Facebook
     * renders in Hindi and its audience posts in Telugu. An interface in some
     * other language matches nothing and yields nulls — which is the right
     * failure, and the one this file already chose over a plausible guess.
     */
    let likes: string | null = null
    let comments: string | null = null
    let shares: string | null = null

    for (const btn of Array.from(article?.querySelectorAll('[role="button"][aria-label]') ?? [])) {
      const label = btn.getAttribute('aria-label') ?? ''

      // The button's own bare-number leaf, if it has one. A button with no
      // number is a zero-count action, and contributes nothing.
      let num: string | null = null
      for (const el of Array.from(btn.querySelectorAll('span, div'))) {
        const t = (el.textContent ?? '').trim()
        if (/^[\d.,]+\s*[KMB]?$/.test(t) && el.querySelector('span, div') === null) {
          num = t
          break
        }
      }
      if (num === null) continue

      // Comments and shares are tested first: "लाइक करें" is a substring of
      // nothing else, but a share label can mention liking.
      if (comments === null && /comment|कमेंट|కామెంట్|వ్యాఖ్య/i.test(label)) comments = num
      else if (shares === null && /share|send this|भेजें|शेयर|షేర్|పంపండి/i.test(label)) shares = num
      else if (likes === null && /like|लाइक|ఇష్టం|లైక్/i.test(label)) likes = num
    }

    /**
     * The reaction pills, for posts whose Like button carries no figure.
     *
     * Measured on a page with sixty-two million followers: its posts render
     * comments and shares inside their buttons as usual, but no number in the
     * Like button at all. The reaction total lives instead in a row of pills,
     * each naming its own reaction — "लाइक करें: 6.7 हज़ार लोग" (Like: 6,700),
     * "बहुत पसंद: 848 लोग" (Love: 848). Summing those gives the total, and it
     * is structural rather than positional: each figure is labelled with the
     * reaction it belongs to.
     *
     * Two constraints keep this from over-reading. The shape demanded is a
     * SHORT prefix, then a colon, then a number — which admits "Like: 6.7
     * thousand people" and excludes the timestamp "मंगलवार, 25 अगस्त 2026 को
     * 9:21 AM पर", whose first colon is thirty characters in. And only labels
     * belonging to THIS article are read: comment threads are nested articles
     * with reaction pills of their own, and summing those in would inflate the
     * post's total with its readers' likes.
     */
    const reactionPills: string[] = []
    for (const el of Array.from(article?.querySelectorAll('[aria-label]') ?? [])) {
      if (el.closest('[role="article"]') !== article) continue
      const l = el.getAttribute('aria-label') ?? ''
      const m = l.match(/^[^:]{1,25}:\s*([\d.,]+(?:\s*[^\s\d]+)?)\s/)
      if (m?.[1]) reactionPills.push(m[1])
    }

    out.push({
      href,
      text: body ? body.slice(0, 200) : null,
      label: article?.getAttribute('aria-label') ?? null,
      time: article?.querySelector('abbr')?.getAttribute('data-utime') ?? null,
      likes,
      comments,
      shares,
      reactionPills,
      /**
       * The post's own picture, by size rather than by position.
       *
       * A card carries the author's avatar, reaction icons and often several
       * commenter faces, all from the same CDN. Demanding 200px of rendered
       * width leaves only the attached photo — avatars render at 40 or 60.
       */
      thumb:
        Array.from(article?.querySelectorAll('img') ?? [])
          .map((im) => im as HTMLImageElement)
          .filter((im) => im.naturalWidth >= 200 && /scontent|fbcdn/.test(im.currentSrc || im.src))
          .sort((a, b) => b.naturalWidth - a.naturalWidth)[0]?.currentSrc ?? null,
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

  /**
   * The header: display name, follower count, avatar.
   *
   * The follower total sits on a link to /followers/, which is why this reads
   * the anchor rather than scanning the page for the word. Measured on the
   * Hindi interface the text came back "2.8 लाख फ़ॉलोअर" — the SELECTOR is
   * language-independent even though the text is not, and parseCount knows
   * लाख. It returns null rather than a bare 2.8 if it ever meets a unit it does
   * not know, which is the behaviour that matters here.
   */
  profile: async ({ page }: AdapterContext): Promise<ProfileInfo> => {
    const raw = await page
      .evaluate(() => {
        const link = Array.from(document.querySelectorAll('a[href*="/followers"]')).find((a) =>
          /[0-9]/.test(a.textContent ?? ''),
        )
        return {
          followers: link?.textContent?.trim() ?? null,
          displayName: document.querySelector('h1')?.textContent?.trim() ?? null,
          avatarUrl:
            document.querySelector('image[*|href]')?.getAttribute('xlink:href') ??
            document.querySelector('[data-imgperflogname="profileCoverPhoto"] img')?.getAttribute('src') ??
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

        // The action-row buttons are the primary reading. `countFrom` over the
        // card text stays as a fallback for a layout where the buttons carry no
        // figures, and still returns null far more often than a number.
        const blob = [r.label, r.text].filter(Boolean).join(' ')
        found.set(url, {
          url,
          id,
          title: r.text?.slice(0, 140) ?? null,
          publishedAt: r.time ? new Date(Number(r.time) * 1000).toISOString() : null,
          // The Like button first, then the sum of the reaction pills, then the
          // card text. Each falls through only when the one before found
          // nothing at all — never when it found a zero.
          likes:
            parseCount(r.likes) ??
            r.reactionPills.reduce<number | null>((total, pill) => {
              const n = parseCount(pill)
              return n === null ? total : (total ?? 0) + n
            }, null) ??
            countFrom(blob, /reactions?|likes?/),
          comments: parseCount(r.comments) ?? countFrom(blob, /comments?/),
          shares: parseCount(r.shares) ?? countFrom(blob, /shares?/),
          views: null,
          thumbnailUrl: r.thumb,
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
