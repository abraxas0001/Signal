import type { Comment, MediaItem, Metric, PostSnapshot } from '../../../../shared/types'
import type { UrlIdentity } from '../platform'
import { fetchText, fetchJson, ALLOW_CRAWLER_UA } from '../fetcher'
import { parseMetadata, parseCount } from '../metadata'
import { readJsonStringField, decodeEntities, extractBalanced } from './json-scan'
import type { ExtractContext, ExtractResult } from './types'

/**
 * Facebook + Instagram adapter.
 *
 * Meta serves radically different pages depending on who it thinks is asking.
 * A Chrome User-Agent gets a ~346KB login wall with the engagement payload
 * stripped; a crawler User-Agent gets the full ~858KB page with exact counts.
 * That single variable is the whole adapter.
 *
 * Facebook reports REACTIONS (all emoji types summed), not likes. We keep the
 * distinction in `extra.reactions` so aggregate charts never silently conflate
 * a reaction count with a like count from another platform.
 *
 * ⚠️  Both platforms' robots.txt prohibit automated collection, and presenting a
 * crawler User-Agent is the highest-risk part of this codebase. It is gated
 * behind ALLOW_CRAWLER_UA (default on) so it can be switched off without a
 * redeploy — when it is off, the adapter still returns caption/author/thumbnail
 * from the standard OpenGraph path and the UI asks the user for the counts.
 */

const AGGRESSIVE = ALLOW_CRAWLER_UA

/**
 * Facebook's own "this video does not exist" signal.
 *
 * A removed video permalink still answers HTTP 200 with a ~475KB app shell:
 * title "Video", five meta tags, no OpenGraph — and, worse, 64 reaction counts
 * belonging to an unrelated promoted video, which is exactly the kind of thing
 * a first-match regex would report as the post's engagement.
 *
 * The tell is that the shell preloads Facebook's VideoHomeVideoNotFound route.
 * That is a code identifier rather than UI copy, so it survives Meta's
 * IP-based localisation — the same page titles itself "वीडियो" from an Indian
 * egress. Matched on the short identifier deliberately: the longer
 * `...RootQueryRelayPreloader` form is absent under facebookexternalhit and
 * Twitterbot, so a fallback fetch would silently miss the deletion.
 */
const VIDEO_NOT_FOUND = /VideoHomeVideoNotFound/

const metric = (v: number | null, source: Metric['source']): Metric =>
  v == null ? { value: null, source: 'unavailable' } : { value: v, source }

/**
 * Build a metric from the raw string the platform displayed, preserving the
 * fact that it was abbreviated.
 *
 * Facebook shows "1.2K reactions" once a post gets popular. Parsing that to
 * 1200 and rendering a bare "1,200" claims a precision the platform never
 * gave us — the true value is anywhere in 1150-1249. Keeping the original
 * string in `display` lets the interface show it as approximate.
 */
function displayedMetric(raw: string | null, source: Metric['source']): Metric {
  const value = parseCount(raw)
  if (value == null) return { value: null, source: 'unavailable' }
  const abbreviated = raw != null && /[kmb]|lakh|crore|[.,]\d\s*[kmb]/i.test(raw)
  return { value, source, ...(abbreviated ? { display: raw.trim() } : {}) }
}

/**
 * Prefer the exact integer, but keep the platform's rounded string alongside.
 *
 * Facebook publishes both in the same object: `reaction_count.count` is 1751
 * and `i18n_reaction_count` is "1.7K". Reading the display string first — which
 * this adapter used to do on video — threw away real precision. Reading only
 * the integer would lose the fact that Facebook's own UI shows "1.7K", which
 * is what a user comparing against the app will see. So keep both.
 */
function exactMetric(
  exact: string | null,
  display: string | null,
  source: Metric['source'],
): Metric {
  const value = parseCount(exact)
  if (value == null) return displayedMetric(display, source)
  const rounded = display != null && /[kmb]/i.test(display)
  return { value, source, ...(rounded ? { display: display.trim() } : {}) }
}

/**
 * The author's page reference, taken from the post page we already fetched.
 *
 * The vanity handle comes first because it survives ALLOW_CRAWLER_UA being off,
 * where there is no Relay payload to read an id from.
 */
function ownerRef(html: string, finalUrl: string): string | null {
  const vanity = /^https:\/\/www\.facebook\.com\/([A-Za-z0-9.]{3,})\/(?:posts|videos|photos|reel)\//.exec(
    finalUrl,
  )?.[1]
  if (vanity && vanity !== 'profile.php') return vanity
  return (
    /"owning_profile":\{[^}]*"id":"(\d+)"/.exec(html)?.[1] ??
    /"actors":\[\{[^}]*"id":"(\d+)"/.exec(html)?.[1] ??
    /[?&]id=(\d+)/.exec(finalUrl)?.[1] ??
    null
  )
}

/**
 * Exact follower count, via Facebook's own embeddable Page plugin.
 *
 * Post pages carry no follower count at all — grepping four of them for every
 * plausible key returns nothing, so no amount of work on that HTML will produce
 * this number. The author's profile page does carry it, but costs 3.8–5.5MB and
 * up to 14 seconds, which would consume most of the extraction budget on its
 * own.
 *
 * The Page plugin is the third option and the right one: ~44KB in well under a
 * second, unauthenticated, no crawler identity needed, and it returns the
 * comma-grouped exact figure rather than the abbreviated "30K" the profile page
 * renders.
 *
 * Accept-Language is mandatory here, not cosmetic: without it the plugin
 * answers in the egress IP's language and the English-anchored read finds
 * nothing.
 */
async function fetchPageFollowers(ref: string): Promise<number | null> {
  const target = `https://www.facebook.com/plugins/page.php?show_facepile=false&href=${encodeURIComponent(
    `https://www.facebook.com/${ref}`,
  )}`
  const res = await fetchText(target, {
    agent: 'browser',
    timeout: 6000,
    headers: { 'Accept-Language': 'en-US,en;q=0.9' },
  })

  // Word-anchored first; the minified class name is a backup that will churn.
  const raw =
    /([\d][\d,]*)\s+followers\b/i.exec(res.body)?.[1] ??
    /class="_1drq"[^>]*>([\d][\d,]*)\s+\S+</.exec(res.body)?.[1] ??
    null
  if (!raw) return null

  // Always comma-grouped integers here, never abbreviated, so strip commas only
  // — running this through parseCount would misread a dot as a K/M separator.
  const n = Number(raw.replace(/,/g, ''))
  return Number.isSafeInteger(n) && n > 0 && n < 5e9 ? n : null
}

/**
 * Comment bodies, out of the payload the adapter has already downloaded.
 *
 * These cost nothing: the Googlebot fetch that carries the reaction counts also
 * carries `"body":{"text":...}` nodes for the comments Facebook chose to serve.
 * The adapter used to hold all of that in memory and throw it away.
 *
 * YIELD IS NOT UNIFORM, and the difference matters more than the parsing:
 *   - `/posts/` permalinks serve a real slice (4 of 4, 5 of 7, 11 of 31).
 *   - `/reel/` and `/videos/` pages serve EXACTLY TWO, whatever the total.
 *     Measured at totals of 3, 15, 30, 109 and 361 — the 361-comment reel
 *     yields two. Requesting the alternate /videos/ permalink of the same reel
 *     returns byte-identical comments, so a second request buys nothing.
 *
 * That cap is why the count is reported alongside: two comments out of 361 is a
 * sample, and presenting it as the reaction to the post would be a
 * misrepresentation dressed up as data.
 *
 * Paging further is not possible without guessing a persisted query id. The
 * cursors are in the page and `has_next_page` is true, but no `doc_id` appears
 * anywhere in the payload, and guessing one would make an invented number look
 * like a measurement.
 */
function readFacebookComments(html: string, limit = 100): Comment[] {
  const MARK = '"body":{"text":"'
  const out: Comment[] = []
  const seen = new Set<string>()

  let at = html.indexOf(MARK)
  while (at !== -1 && out.length < limit) {
    const text = readJsonStringField(html, 'text', at)
    const next = html.indexOf(MARK, at + MARK.length)

    if (text && text.trim() && !seen.has(text)) {
      seen.add(text)
      // Author, time and reactions sit after the body inside the same node.
      // Bounded so a comment with no author cannot borrow the next one's.
      const windowEnd = next === -1 ? at + 2400 : Math.min(at + 2400, next)
      const prev = out.length ? html.lastIndexOf(MARK, at - 1) : -1
      const windowStart = prev === -1 ? Math.max(0, at - 1200) : Math.max(prev + MARK.length, at - 1200)
      const win = html.slice(windowStart, windowEnd)

      const authorAt = win.indexOf('"author":{')
      const author = authorAt === -1 ? null : readJsonStringField(win, 'name', authorAt)

      const unix = /"created_time":(\d{9,11})/.exec(win)?.[1]
      // Facebook writes this three different ways in the same payload.
      const likes =
        parseCount(/"reaction_count":\{[^}]*?"count":(\d+)/.exec(win)?.[1] ?? null) ??
        parseCount(/"reaction_count":(\d+)/.exec(win)?.[1] ?? null) ??
        parseCount(/"count_reduced":"([^"]{1,12})"/.exec(win)?.[1] ?? null) ??
        parseCount(/"i18n_reaction_count":"([^"]{1,12})"/.exec(win)?.[1] ?? null)

      out.push({
        text,
        author: author && author.length <= 80 ? author : null,
        likes,
        publishedAt: unix ? new Date(Number(unix) * 1000).toISOString() : null,
        isReply: false,
      })
    }
    at = next
  }
  return out
}

/**
 * Turn a /share/p/<code>/ link into the canonical permalink, from the redirect.
 *
 * This is the one route that survives the network production runs on. Measured
 * from the deployed server against the same share link, in the same second:
 *
 *   GET /share/p/<code>/  followed, Googlebot   -> 200, 417KB, no payload
 *   GET /share/p/<code>/  manual, Chrome UA     -> 400
 *   GET /share/p/<code>/  manual, Googlebot     -> 302, 0KB, 130ms  ★
 *   GET /share/p/<code>/  manual, no UA         -> 302, 0KB,  92ms  ★
 *
 * and that 302's Location is
 *   /story.php?story_fbid=1537808798393401&id=100064928850532&...
 *
 * Both ids, for nothing: no body, under a tenth of a second. It works because a
 * redirect is issued at the edge before any decision about what body to serve,
 * so the gating that strips the page never comes into it. The canonical
 * /<page>/posts/<story> form built from those ids then returns the full 967KB
 * page from the same server.
 *
 * Note which User-Agent works. A browser identity gets 400 here while Googlebot
 * and no User-Agent at all get the redirect — the opposite of what the page
 * fetch below wants, which is why this is its own request rather than a flag on
 * that one.
 */
async function resolveShareLink(url: string): Promise<string | null> {
  if (!/facebook\.com\/share\/[a-z]\//i.test(url)) return null

  try {
    // Walk the chain a hop at a time rather than reading only the first hop.
    //
    // The URL reaching us is normalised to facebook.com without the www, so the
    // first 302 is Facebook canonicalising the host and its Location still
    // points at /share/. Reading that one and stopping — which an earlier
    // version did — finds no ids and gives up one hop short of the answer.
    let current = url
    let target = ''
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetchText(current, {
        agent: 'google',
        timeout: 6000,
        // Stop at each redirect: the Location is the whole point, and following
        // it to the end lands on the placeholder page that has none of this.
        maxRedirects: 0,
      })
      const next = res.location
      if (!next) break
      target = new URL(next, current).toString()
      if (!/\/share\/[a-z]\//i.test(target)) break
      current = target
    }

    if (!target) return null

    // Two shapes come back, and both are useful.
    //
    // Most share codes resolve to story.php with the numeric pair, which builds
    // the canonical permalink. Others resolve straight to a vanity permalink
    // whose id is a `pfbid…` string rather than digits — usable exactly as it
    // is, so it only needs its tracking parameters stripped. An earlier version
    // insisted on digits and threw that second kind away.
    const story = /[?&]story_fbid=(\d{6,})/.exec(target)?.[1]
    const page = /[?&]id=(\d{6,})/.exec(target)?.[1]
    if (story && page) return `https://www.facebook.com/${page}/posts/${story}`

    if (/facebook\.com\/[^/]+\/(?:posts|videos|reel|photos)\//.test(target)) {
      const clean = new URL(target)
      clean.search = ''
      return clean.toString()
    }

    return null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Facebook
// ─────────────────────────────────────────────────────────────────────────────

interface AnchoredCounts {
  /** Exact integer when the payload carries one. */
  reactions: string | null
  /** The platform's own abbreviation ("1.7K"), for the approximate marker. */
  reactionsDisplay: string | null
  comments: string | null
  shares: string | null
  /** Plays, which is the figure Facebook itself surfaces as "views". */
  views: string | null
  /** Distinct from plays: unique viewers rather than playbacks. */
  uniqueViews: string | null
  /** True when the anchor was located, so "no counts" means the post has none. */
  anchored: boolean
}

/**
 * Read counts out of the Relay payload, anchored to *this* post's feedback node.
 *
 * A reel page carries 22–24 distinct feedback objects — one per neighbouring
 * reel in the rail — plus one per comment thread. Reading any count by first
 * match returns a neighbour's number, confidently and wrongly. So everything
 * here is scoped to a window that starts at this post's own feedback node.
 *
 * The anchor is `base64("feedback:" + storyId)`, which is the node's `id`. The
 * trailing quote in the marker is load-bearing: this post's *comment* feedbacks
 * are `feedback:<storyId>_<commentId>`, whose base64 shares a prefix with the
 * post's own, so a prefix match lands on a comment and reads its reply count as
 * the post's comment total.
 */
function readAnchoredCounts(html: string, storyId: string | null): AnchoredCounts {
  const out: AnchoredCounts = {
    reactions: null,
    reactionsDisplay: null,
    comments: null,
    shares: null,
    views: null,
    uniqueViews: null,
    anchored: false,
  }
  if (!storyId) return out

  const feedbackId = Buffer.from(`feedback:${storyId}`, 'utf8').toString('base64')

  const anchors: number[] = []
  const markers = [
    // The feedback node itself — the only anchor that works on reels, where
    // og:url's id is the *video* id and appears nowhere in the feedback.
    `"id":"${feedbackId}"`,
    // Post pages additionally expose these, and they cost nothing to keep.
    `"subscription_target_id":"${storyId}"`,
    `"post_id":"${storyId}"`,
  ]
  for (const marker of markers) {
    let from = 0
    for (;;) {
      const at = html.indexOf(marker, from)
      if (at === -1) break
      anchors.push(at)
      from = at + marker.length
    }
  }
  if (anchors.length === 0) return out
  anchors.sort((a, b) => a - b)
  out.anchored = true

  /**
   * Search forward from each anchor. Forward-only and bounded: a few hundred
   * bytes past the post's own total, `top_reactions` breaks the same figure
   * down per emoji ("Like: 643", "Love: 8"), and a wider or backward window
   * picks up one of those instead of the real total.
   */
  const firstOf = (patterns: RegExp[]): string | null => {
    for (const start of anchors) {
      const forward = html.slice(start, start + 6000)
      for (const re of patterns) {
        const hit = re.exec(forward)?.[1]
        if (hit != null) return hit
      }
    }
    return null
  }

  // Exact first. `i18n_reaction_count` is Facebook's rounded display string and
  // sits beside the true integer in the same object — taking it first threw
  // away 1,751 in favour of "1.7K".
  out.reactions = firstOf([/"reaction_count":\{"count":(\d+)/])
  out.reactionsDisplay = firstOf([/"i18n_reaction_count":"([\d.,KMkm]+)"/])
  if (out.reactions == null) out.reactions = out.reactionsDisplay

  // A bare "total_count" also appears in the comment-list renderer (a filtered
  // view, not the total) and in reply blocks, so require the wrapper that only
  // the post-level counter carries. `comment_count_reduced` is the rail
  // neighbours' key and must never be used.
  out.comments = firstOf([
    /"comment_rendering_instance":\{"comments":\{"total_count":(\d+)/,
    /"comment_rendering_instance":\{[^}]*"comments":\{"total_count":(\d+)/,
    /"total_comment_count":(\d+)/,
    /"comment_count":\{"total_count":(\d+)/,
  ])

  out.shares = firstOf([
    /"i18n_share_count":"([\d.,KMkm]+)"/,
    /"share_count":\{"count":(\d+)/,
  ])

  // Views exist on video and reel posts only. Facebook's own "N views" label
  // is the play count, so that is what we report as views; the unique-viewer
  // figure is a different measure and is kept separately rather than conflated.
  out.views = firstOf([/"play_count":(\d+)/])
  out.uniqueViews = firstOf([/"video_view_count":(\d+)/])

  return out
}

/**
 * The last run of 8+ digits in a URL's path — Facebook's numeric post id in
 * every og:url shape it produces. The path is decoded first so a percent-escaped
 * caption cannot contribute stray digits.
 */
function lastLongNumber(url: string): string | null {
  let path = url
  try {
    path = decodeURIComponent(new URL(url).pathname)
  } catch {
    /* malformed or already decoded; fall back to the raw string */
  }
  const runs = path.match(/\d{8,}/g)
  return runs?.length ? (runs[runs.length - 1] as string) : null
}

/**
 * Counts as advertised in og:title ("20K views · 651 reactions | caption").
 *
 * Last-resort only. This is a cached crawler card: it is always abbreviated,
 * it carries no comment figure on reels, and it has been measured 19x stale
 * against the JSON in the same response.
 */
function readOgTitleCounts(ogTitle: string | null): {
  reactions: string | null
  comments: string | null
  views: string | null
} {
  if (!ogTitle) return { reactions: null, comments: null, views: null }
  return {
    reactions: /([\d.,KMkm]+)\s*reactions?/i.exec(ogTitle)?.[1] ?? null,
    comments: /([\d.,KMkm]+)\s*comments?/i.exec(ogTitle)?.[1] ?? null,
    views: /([\d.,KMkm]+)\s*views?/i.exec(ogTitle)?.[1] ?? null,
  }
}

async function extractFacebook(id: UrlIdentity, _ctx: ExtractContext): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = []

  // Accept-Language is load-bearing: without it Meta localises by IP and the
  // og:title reads "384 रिएक्शन", which an English-only regex silently misses.
  const headers = { 'Accept-Language': 'en-US,en;q=0.9' }

  // With the switch off we claim no identity we do not have — not even
  // facebookexternalhit, which is still a crawler we are not. That is the whole
  // point of the switch, and it is what the README promises it does.
  const agents = AGGRESSIVE ? (['google', 'facebook', 'twitter'] as const) : (['browser'] as const)

  // Resolve a share link to its canonical permalink first, because from a
  // datacentre the share form is answered with a placeholder and the canonical
  // form is answered in full. Costs one redirect: no body, ~100ms.
  const canonical = await resolveShareLink(id.canonical)
  if (canonical) {
    attempts.push({
      strategy: 'facebook:share-redirect',
      ok: true,
      note: `share link resolved to ${canonical.replace('https://www.facebook.com', '')}`,
    })
  }
  const target = canonical ?? id.canonical

  let best: { body: string; url: string; rich: boolean } | null = null
  let deleted = false

  for (const agent of agents) {
    const res = await fetchText(target, { agent, timeout: 9000, headers })
    const size = res.body.length

    if (VIDEO_NOT_FOUND.test(res.body)) {
      deleted = true
      attempts.push({
        strategy: `facebook:${agent}-ua`,
        ok: false,
        note: 'Facebook served its "video not found" shell',
      })
      break
    }

    // "Rich" means the engagement payload is actually present. This was
    // previously OR'd with a size threshold, which was a real bug: the
    // facebookexternalhit and Twitterbot responses decompress to ~450KB of
    // link-preview markup with no Relay payload at all, so they cleared the
    // threshold, ended the agent loop, and produced all-null counts at high
    // confidence. Size is not evidence of anything here.
    const rich = /"reaction_count"|"i18n_reaction_count"|"subscription_target_id"/.test(res.body)

    attempts.push({
      strategy: `facebook:${agent}-ua`,
      ok: res.ok && rich,
      note: res.ok
        ? `${Math.round(size / 1024)}KB${!rich ? ' (no engagement payload)' : ''}`
        : res.blockedReason ?? `HTTP ${res.status}`,
    })

    if (res.ok && res.body) {
      // Rank by usefulness first, size only as a tie-break. Choosing the
      // largest body outright lets a fat login wall overwrite a smaller
      // crawler response that actually carried the counts.
      const better =
        !best || (rich && !best.rich) || (rich === best.rich && res.body.length > best.body.length)
      if (better) best = { body: res.body, url: res.url, rich }
      if (rich) break
    }
  }

  // A share link that came back stripped: retry it as a canonical permalink.
  //
  // /share/p/<code>/ redirects to story.php?story_fbid=<post>&id=<page>, and
  // from a datacentre IP Meta answers BOTH of those forms with a ~417KB shell
  // carrying no engagement payload at all — while answering the canonical
  // /<page>/posts/<post> form with the full ~967KB page. Same post, same
  // second, same crawler identity; only the URL shape differs.
  //
  // The redirect hands us both ids, so the canonical form can be rebuilt
  // without another lookup. Verified on production: the share form returned
  // nothing and the rebuilt permalink returned 2,021 reactions, 132 comments
  // and 10 comment bodies.
  if (!best?.rich) {
    // The ids can come from the redirect URL or from the shell itself — on a
    // datacentre IP the share link is not always redirected before being
    // stripped, so the URL alone is not enough.
    const from = `${best?.url ?? ''} ${id.canonical}`
    const body = best?.body ?? ''
    const story =
      /[?&]story_fbid=(\d+)/.exec(from)?.[1] ??
      /"story_fbid":"?(\d+)/.exec(body)?.[1] ??
      /"subscription_target_id":"(\d+)"/.exec(body)?.[1] ??
      /facebook\.com\/[^/"]+\/posts\/[^/"]*?(\d{8,})/.exec(body)?.[1] ??
      null
    const page =
      /[?&]id=(\d+)/.exec(from)?.[1] ??
      /"page_id":"?(\d+)/.exec(body)?.[1] ??
      /"owning_profile":\{[^}]*"id":"(\d+)"/.exec(body)?.[1] ??
      null

    if (story && page) {
      const canonical = `https://www.facebook.com/${page}/posts/${story}`
      const res = await fetchText(canonical, { agent: 'google', timeout: 10_000 })
      const rich =
        res.ok &&
        Boolean(res.body) &&
        /"reaction_count"|"i18n_reaction_count"|"subscription_target_id"/.test(res.body)

      attempts.push({
        strategy: 'facebook:canonical-permalink',
        ok: rich,
        note: rich
          ? `share link was stripped; ${Math.round((res.body?.length ?? 0) / 1024)}KB via /${page}/posts/${story}`
          : 'canonical permalink also carried no payload',
      })

      if (rich && res.body) best = { body: res.body, url: res.url, rich: true }
    }
  }

  if (deleted) {
    return {
      ok: false,
      attempts,
      blocked: {
        reason: 'This post has been deleted or made private. Facebook no longer serves it to anyone.',
        suggestion:
          'The link itself is valid, so the post existed. If you have a screenshot or the text, upload it and we will analyse that.',
      },
      extra: { deleted: true },
    }
  }

  if (!best) {
    return {
      ok: false,
      attempts,
      blocked: {
        reason: 'Facebook did not return this post to our server.',
        suggestion:
          'Facebook blocks most automated reads. Paste the post text below. Everything else still works.',
      },
    }
  }

  // A share link that Meta stripped: say so, rather than analysing the shell.
  //
  // Some /share/p/<code>/ links resolve through story.php, and from a
  // datacentre IP Meta answers that form with a ~416KB shell whose only text is
  // the word "Facebook" — no author, no counts, no post. Passing that on gave a
  // confident, worthless report headlined "Post contains only the word
  // Facebook", which is worse than a failure because it looks like an answer.
  //
  // The same post served from its canonical permalink returns everything, so
  // the suggestion is specific and known to work rather than a shrug.
  const shellOnly =
    !best.rich &&
    /^\s*(facebook|log in or sign up to view|content not available)\s*$/i.test(
      parseMetadata(best.body, best.url).title ?? '',
    )

  if (shellOnly) {
    return {
      ok: false,
      attempts,
      blocked: {
        reason:
          'Facebook served our server a placeholder page for this share link, with no post on it.',
        suggestion:
          'Open the post on Facebook and copy the address from the browser bar. It looks like facebook.com/<page>/posts/<number>. Paste that instead: that form works. Or paste the post text below.',
      },
    }
  }

  const meta = parseMetadata(best.body, best.url)

  // Read og:url straight from the markup rather than using meta.canonical:
  // generic canonical resolution prefers <link rel="canonical">, which
  // Facebook sets to the pfbid form (/posts/pfbid0QnEN8.../) that carries no
  // numeric id at all. og:url is the only place the id reliably appears.
  const ogUrl =
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i.exec(best.body)?.[1] ??
    meta.canonical ??
    best.url

  // The *story* id, which is what the engagement payload is keyed by.
  //
  // This ordering is the whole fix for reels. A /share/v/ or /share/r/ link
  // redirects to /reel/<VIDEO_ID>/, so og:url yields the video id — a perfectly
  // valid-looking 16-digit number that appears nowhere in the feedback object.
  // Deriving the anchor from og:url therefore produced zero anchors on every
  // reel, and every count came back null while the page carried them all.
  // `subscription_target_id` is post-scoped and occurs exactly once, so it is
  // the right primary; og:url is the fallback for shapes that lack it.
  const storyId =
    /"subscription_target_id":"(\d+)"/.exec(best.body)?.[1] ??
    /"post_id":"(\d+)"/.exec(best.body)?.[1] ??
    lastLongNumber(ogUrl) ??
    null

  const isVideo = /\/reel\/|\/videos?\//.test(ogUrl) || meta.video != null
  const isReel = /\/reel\//.test(ogUrl)

  const fromTitle = readOgTitleCounts(meta.title)
  const fromJson = readAnchoredCounts(best.body, storyId)
  const commentBodies = readFacebookComments(best.body)

  // The JSON is authoritative everywhere, including video. og:title is a cached
  // crawler card and goes stale: on one reel it advertised "5.3K views · 1.7K
  // reactions" while the JSON in the very same response said 102,343 views and
  // 1,751 reactions. It is kept only as a last resort.
  const reactions = fromJson.reactions ?? fromTitle.reactions
  const reactionsDisplay = fromJson.reactionsDisplay ?? fromTitle.reactions
  const comments = fromJson.comments ?? fromTitle.comments
  const shares = fromJson.shares
  const views = fromJson.views ?? fromTitle.views

  const gotCounts = reactions != null || comments != null || shares != null || views != null
  attempts.push({
    strategy: 'facebook:counts',
    ok: gotCounts,
    note: gotCounts
      ? `reactions=${reactions ?? '—'} comments=${comments ?? '—'} shares=${shares ?? '—'} views=${views ?? '—'}${
          commentBodies.length
            ? ` · ${commentBodies.length} comment ${commentBodies.length === 1 ? 'body' : 'bodies'}${
                comments != null ? ` of ${comments}` : ''
              }`
            : ''
        }`
      : fromJson.anchored
        ? 'this post carries no engagement counters'
        : 'could not locate this post inside the page payload',
  })

  // Reels genuinely have no share counter — not withheld, not renamed, absent.
  // A full key census across reel pages found no share_count, i18n_share_count,
  // reshare_count or resharers under any User-Agent, while the same fetch of a
  // /posts/ link returns i18n_share_count. Saying so beats leaving the user to
  // wonder whether the read failed.
  if (isReel && shares == null) {
    attempts.push({
      strategy: 'facebook:shares',
      ok: false,
      note: 'Facebook publishes no share count on reels',
    })
  }

  // Facebook's og:title on a reel is "20K views · 651 reactions · 6 comments |
  // caption | author". Strip every count prefix so none of it leaks into the
  // post text — "20K views" was previously surviving into the analysed body on
  // every reel, because only the reactions and comments prefixes were removed.
  const cleanTitle = (meta.title ?? '')
    .replace(/^(?:[\d.,KMkm]+\s*(?:views?|plays?|reactions?|comments?|shares?)\s*[·|,-]?\s*)+/i, '')
    .trim()
  const titleParts = cleanTitle.split('|').map((p) => p.trim()).filter(Boolean)
  // The name is a JSON string value, so it arrives encoded: a page styled in
  // mathematical bold capitals comes through as a run of \ud835\udcXX surrogate
  // pairs, and was previously shown to the user as those literal escapes. Read
  // it the way a parser would rather than with a naive [^"]+ capture, which
  // also truncated any name containing a quote.
  const ownerAt = best.body.indexOf('"owning_profile":')
  const authorName =
    (ownerAt >= 0 ? readJsonStringField(best.body, 'name', ownerAt) : null) ??
    (titleParts.length > 1 ? titleParts[titleParts.length - 1] : null) ??
    meta.siteName

  const text = meta.description ?? (titleParts.length > 1 ? titleParts[0] : cleanTitle) ?? null
  const creationTime = /"creation_time":(\d{9,})/.exec(best.body)?.[1]

  // One extra sub-second request for the figure the post page never carries.
  const ref = ownerRef(best.body, best.url)
  const followers = ref ? await fetchPageFollowers(ref) : null
  if (ref) {
    attempts.push({
      strategy: 'facebook:page-plugin',
      ok: followers != null,
      note:
        followers != null
          ? `${followers.toLocaleString('en-IN')} followers`
          : 'no Page behind this author — personal profiles have no follower count',
    })
  }

  const media: MediaItem[] = []
  if (meta.image) media.push({ kind: 'image', url: meta.image, thumbnailUrl: meta.image })
  if (meta.video) media.push({ kind: 'video', url: meta.video, thumbnailUrl: meta.image ?? null })

  const snapshot: Partial<PostSnapshot> = {
    platform: 'Facebook',
    ...(commentBodies.length ? { comments: commentBodies } : {}),
    postType: isVideo ? 'Video' : 'Original Post',
    publishedAt: creationTime
      ? new Date(Number(creationTime) * 1000).toISOString()
      : (meta.publishedAt ?? null),
    author: {
      name: authorName ?? null,
      handle: id.handle,
      profileUrl: id.handle ? `https://www.facebook.com/${id.handle}` : null,
      avatarUrl: null,
      verified: null,
      // Not from the post page, which never carries it — from the Page plugin.
      followers:
        followers != null
          ? { value: followers, source: 'public-endpoint' }
          : { value: null, source: 'unavailable' },
      accountType: 'Unknown',
      declaredLocation: null,
    },
    content: {
      text: text ?? null,
      title: null,
      languageCode: meta.lang,
      languageName: null,
      translation: null,
      transcript: null,
      hashtags: [...(text ?? '').matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1] as string),
      mentions: [],
      outboundLinks: [],
    },
    engagement: {
      // Reactions are the closest analogue to likes; `extra.reactions` keeps the
      // exact semantics for anyone who needs them. Where Facebook publishes both
      // an exact integer and its own rounded string, we take the integer and
      // carry the rounding as a display hint rather than as the value.
      likes: exactMetric(reactions, reactionsDisplay, 'page-scrape'),
      comments: displayedMetric(comments, 'page-scrape'),
      shares: displayedMetric(shares, 'page-scrape'),
      // Plays, on video and reel posts. Text posts have no view counter.
      views: displayedMetric(views, 'page-scrape'),
      engagementRate: null,
    },
    media,
  }

  const missing: string[] = []
  if (reactions == null) missing.push('likes')
  if (comments == null) missing.push('comments')
  if (shares == null && !isReel) missing.push('shares')

  return {
    ok: true,
    snapshot,
    attempts,
    confidence: gotCounts ? 'high' : 'medium',
    extra: {
      reactions,
      metricLabel: 'reactions',
      storyId,
      // Unique viewers, which is a different measure from plays and is kept
      // separate rather than folded into views.
      ...(fromJson.uniqueViews ? { uniqueViewers: Number(fromJson.uniqueViews) } : {}),
      ...(isReel ? { sharesUnavailable: 'Facebook publishes no share count on reels' } : {}),
      ...(missing.length
        ? {
            missingCounts: missing,
            countsHint: gotCounts
              ? 'Facebook withheld some counts on this post. Tap any figure to enter it manually.'
              : 'Facebook returned the post but withheld the engagement bar. Tap any count to enter it manually.',
          }
        : {}),
    },
  }
}

/**
 * An Instagram handle is `[A-Za-z0-9._]`, at most 30 characters. Nothing else
 * is a username, so anything else is a parse failure — not a name to display.
 */
const IG_HANDLE = /^[A-Za-z0-9._]{1,30}$/

/**
 * The poster's handle, from the embed page.
 *
 * The previous pattern was `class="CaptionUsername"[^>]*>(?:[^<]*<[^>]*>)*([^<]+)<`.
 * That middle group repeats "some text, then a tag" without a bound, so from
 * the anchor it walks tag by tag across the whole document and the capture
 * lands wherever it happens to stop. On a real reel that was several hundred
 * kilobytes later, inside a <script>, and the author's name rendered as
 * Facebook's bootstrap JavaScript — `requireLazy([...])`.
 *
 * Two defences, because a regex over markup will always be approximate:
 * search only a short window after the anchor, and then require the result to
 * actually look like a handle. The second is what makes it safe — a 200KB
 * script blob can never satisfy IG_HANDLE.
 */
function readEmbedUsername(html: string): string | null {
  const at = html.indexOf('CaptionUsername')
  if (at === -1) return null

  // The handle sits within a few tags of the anchor. 600 characters is far
  // more than that and far less than a script block.
  const window = html.slice(at, at + 600)

  for (const raw of [...window.matchAll(/>([^<>]{1,40})</g)].map((m) => m[1])) {
    const candidate = (raw ?? '').trim()
    if (IG_HANDLE.test(candidate)) return candidate
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Instagram
// ─────────────────────────────────────────────────────────────────────────────

interface InstagramComments {
  edges?: Array<{
    node?: {
      text?: string
      created_at?: number
      comment_like_count?: number
      parent_comment_id?: string | null
      user?: { username?: string }
    }
  }>
  page_info?: { has_next_page?: boolean }
}

/**
 * Comment bodies, out of the post page this adapter has already downloaded.
 *
 * The reason Instagram published no audience anywhere in this product was not
 * that Instagram withholds one. The `instagram:og-page` fetch below pulls
 * ~880KB, and the previous code read a publish date and a thumbnail out of it
 * and dropped the rest on the floor — while a `comments_connection` sat in the
 * same string, in plain JSON, holding the comments and their authors. Every
 * Instagram post therefore reported that no public comments were retrievable
 * for it, from a response that contained them.
 *
 * The crawler identity is what unlocks the page, so this inherits the adapter's
 * existing posture rather than adding to it. Measured on five posts, twice
 * each, through this codebase's own fetcher:
 *
 *   facebookexternalhit -> ~880KB, 9 / 7 / 2 / 6 / 7 comments   ★ what we send
 *   Googlebot           -> ~880KB, the same counts
 *   a browser UA        -> ~607KB login wall, zero comments
 *
 * YIELD IS A SAMPLE on anything popular. Instagram serves the first page of
 * the connection and no more: 14 comments of 2,016 on one post, 15 of 201 on
 * another, and 12 of 15 and 9 of 10 on quiet ones. `has_next_page` is returned
 * so the caller can say which of those it is rather than implying the slice is
 * the whole. Paging is not possible from here: `end_cursor` is present, but
 * spending it needs a persisted query id that appears nowhere in the payload,
 * and guessing one would dress an invention up as a measurement.
 */
function readInstagramComments(
  html: string,
  limit = 100,
): { comments: Comment[]; hasMore: boolean } {
  const raw = extractBalanced(html, '"comments_connection"')
  if (!raw) return { comments: [], hasMore: false }

  let connection: InstagramComments
  try {
    connection = JSON.parse(raw) as InstagramComments
  } catch {
    // The connection is Instagram's to reshape, and a post whose counts and
    // caption were read successfully must not be lost to a comment parse.
    return { comments: [], hasMore: false }
  }

  const comments: Comment[] = []
  for (const edge of connection.edges ?? []) {
    if (comments.length >= limit) break
    const node = edge?.node
    // Instagram serves the occasional node with an empty body — a comment that
    // was deleted or hidden. It is a real node, so it is not a parse failure,
    // but it is not something anyone said either.
    if (!node || typeof node.text !== 'string' || !node.text.trim()) continue

    // A zero here is Instagram reporting no likes; a missing field is Instagram
    // not saying. The interface distinguishes them and so must this.
    const likes = typeof node.comment_like_count === 'number' ? node.comment_like_count : null
    const at = node.created_at
    const seconds = typeof at === 'number' && at > 0 && at < 4e9 ? at : null

    comments.push({
      text: node.text,
      author: node.user?.username ?? null,
      likes,
      publishedAt: seconds == null ? null : new Date(seconds * 1000).toISOString(),
      isReply: node.parent_comment_id != null,
    })
  }

  return { comments, hasMore: connection.page_info?.has_next_page === true }
}

async function extractInstagram(id: UrlIdentity, _ctx: ExtractContext): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = []
  const shortcode = id.id

  if (!shortcode) {
    // Almost always a profile link rather than a post. Saying which is wrong is
    // far more useful than reporting a failed fetch of a page that was never
    // going to be a post.
    const isProfile = !/\/(p|reel|reels|tv)\//.test(new URL(id.canonical).pathname)
    return {
      ok: false,
      attempts: [
        {
          strategy: 'instagram:parse-id',
          ok: false,
          note: isProfile ? 'that is a profile, not a post' : 'no shortcode in the URL',
        },
      ],
      blocked: {
        reason: isProfile
          ? `That is ${id.handle ? `@${id.handle}'s profile` : 'a profile page'}, not a single post.`
          : 'That Instagram link does not point at a post.',
        suggestion:
          'Open the post itself and copy its link. It will look like instagram.com/p/… or instagram.com/reel/….',
      },
    }
  }

  let likes: number | null = null
  let comments: number | null = null
  let username: string | null = null
  let caption: string | null = null

  // 1. /embed/captioned/ — exact counts, but only for a NON-browser UA.
  const embed = await fetchText(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
    agent: 'facebook',
    timeout: 8000,
    headers: { 'Accept-Language': 'en-US,en;q=0.9' },
  })

  if (embed.ok && embed.body) {
    likes = parseCount(/([\d,]+)\s+likes/i.exec(embed.body)?.[1] ?? null)
    comments = parseCount(/View all ([\d,]+) comments/i.exec(embed.body)?.[1] ?? null)
    username = readEmbedUsername(embed.body)
    const capMatch = /<div class="Caption">([\s\S]*?)<\/div>/.exec(embed.body)?.[1]
    if (capMatch) {
      caption =
        decodeEntities(
          capMatch
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
        ) ?? ''
      // The embed prints the username as the first token of the caption block.
      // Strip it so the post text is the post text.
      if (username && caption.startsWith(username)) {
        caption = caption.slice(username.length).trim()
      }
    }
  }

  // Invalid shortcodes return HTTP 200 with an empty page — detect by absence.
  const embedOk = likes != null || comments != null || Boolean(caption)
  attempts.push({
    strategy: 'instagram:embed-captioned',
    ok: embedOk,
    note: embedOk ? `likes=${likes ?? '—'} comments=${comments ?? '—'}` : `HTTP ${embed.status}, no fields`,
  })

  // 2. The post page via a crawler UA — the only source of the publish date.
  const page = await fetchText(`https://www.instagram.com/p/${shortcode}/`, {
    agent: 'facebook',
    timeout: 8000,
    headers: { 'Accept-Language': 'en-US,en;q=0.9' },
  })

  let publishedAt: string | null = null
  let image: string | null = null
  let commentBodies: Comment[] = []
  let moreComments = false

  if (page.ok && page.body) {
    const meta = parseMetadata(page.body, page.url)
    image = meta.image
    // og:description reads: "190K likes, 3,748 comments - instagram on August 13, 2026: "caption…"
    const desc = meta.description ?? ''
    const dateMatch = /on ([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(desc)?.[1]
    if (dateMatch) {
      const d = new Date(dateMatch)
      if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString()
    }
    if (likes == null) likes = parseCount(/([\d.,KM]+)\s+likes/i.exec(desc)?.[1] ?? null)
    if (comments == null) comments = parseCount(/([\d.,KM]+)\s+comments/i.exec(desc)?.[1] ?? null)
    if (!username) username = /- ([\w.]+) on/.exec(desc)?.[1] ?? null
    if (!caption) caption = /:\s*"([\s\S]+)"/.exec(desc)?.[1] ?? meta.description

    const read = readInstagramComments(page.body)
    commentBodies = read.comments
    moreComments = read.hasMore
  }

  attempts.push({
    strategy: 'instagram:og-page',
    ok: Boolean(publishedAt || image),
    note: publishedAt ? 'publish date + image' : `HTTP ${page.status}`,
  })

  // Reported separately from the page fetch that carried them, because "we read
  // the post" and "we read what the public said about it" are different claims
  // and the second is the one the sentiment now rests on.
  //
  // The empty case is split in two on purpose. "Instagram served no comment
  // bodies" is a statement about what Instagram published, and it is only true
  // when a page actually came back: saying it after a 404 or a rate-limited 429
  // would report a fetch we never got as a platform that publishes nothing.
  attempts.push({
    strategy: 'instagram:comments',
    ok: commentBodies.length > 0,
    note: commentBodies.length
      ? `${commentBodies.length} comment ${commentBodies.length === 1 ? 'body' : 'bodies'}${
          comments != null ? ` of ${comments}` : ''
        }${moreComments ? ', the rest need a login' : ''}`
      : page.ok && page.body
        ? 'Instagram served no comment bodies on this post'
        : `HTTP ${page.status}, no page to read comments from`,
  })

  // 3. Profile API — the only source of followers, verified, and video views.
  let followers: number | null = null
  let verified: boolean | null = null

  if (username) {
    const prof = await fetchJson<{
      data?: { user?: { is_verified?: boolean; edge_followed_by?: { count?: number } } }
    }>(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
      timeout: 6000,
      headers: { 'X-IG-App-ID': '936619743392459' },
    })
    followers = prof.data?.data?.user?.edge_followed_by?.count ?? null
    verified = prof.data?.data?.user?.is_verified ?? null
    attempts.push({
      strategy: 'instagram:web-profile-info',
      ok: followers != null,
      // ~80% of accounts work; some deterministically 400 on Meta's side.
      note: followers != null ? `followers=${followers}` : `HTTP ${prof.status} (some accounts always fail)`,
    })
  }

  if (!embedOk && !publishedAt && !image) {
    return {
      ok: false,
      attempts,
      blocked: {
        reason: 'Instagram did not return this post.',
        suggestion: 'It may be from a private account or deleted. Paste the caption below to analyse it anyway.',
      },
    }
  }

  return {
    ok: true,
    attempts,
    confidence: likes != null ? 'high' : 'medium',
    snapshot: {
      platform: 'Instagram',
      ...(commentBodies.length ? { comments: commentBodies } : {}),
      postType: id.postType,
      publishedAt,
      author: {
        name: username,
        handle: username,
        profileUrl: username ? `https://www.instagram.com/${username}/` : null,
        avatarUrl: null,
        verified,
        followers: metric(followers, 'public-endpoint'),
        accountType: 'Unknown',
        declaredLocation: null,
      },
      content: {
        text: caption,
        title: null,
        languageCode: null,
        languageName: null,
        translation: null,
        transcript: null,
        hashtags: [...(caption ?? '').matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1] as string),
        mentions: [...(caption ?? '').matchAll(/@([\w.]+)/g)].map((m) => m[1] as string),
        outboundLinks: [],
      },
      engagement: {
        likes: metric(likes, 'page-scrape'),
        comments: metric(comments, 'page-scrape'),
        shares: { value: null, source: 'unavailable' },
        views: { value: null, source: 'unavailable' },
        engagementRate: null,
      },
      media: image ? [{ kind: 'image', url: image, thumbnailUrl: image }] : [],
    },
  }
}

export async function extractMeta(id: UrlIdentity, ctx: ExtractContext): Promise<ExtractResult> {
  return id.platform === 'Instagram' ? extractInstagram(id, ctx) : extractFacebook(id, ctx)
}
