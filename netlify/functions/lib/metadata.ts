import * as cheerio from 'cheerio'

/**
 * Everything we can learn from a page's own markup, with no platform knowledge.
 * This is the universal floor: if a bespoke adapter fails, we still land here.
 */
export interface PageMetadata {
  title: string | null
  description: string | null
  /** Full article body when the page is readable prose. */
  articleText: string | null
  siteName: string | null
  author: string | null
  publishedAt: string | null
  image: string | null
  video: string | null
  canonical: string | null
  lang: string | null
  keywords: string[]
  /** Engagement numbers occasionally exposed via schema.org InteractionCounter. */
  interactions: Partial<Record<'like' | 'comment' | 'share' | 'view', number>>
  /** True when the page is a login/consent wall rather than the real content. */
  isWall: boolean
}

const WALL_MARKERS = [
  'log in to continue',
  'log into facebook',
  'you must log in',
  'sign up to see',
  'content isn&#039;t available',
  "content isn't available",
  'this content isn&#039;t available',
  'enable javascript',
  'please enable cookies',
  'are you a robot',
  'unusual traffic',
  'access denied',
]

function firstMeta($: cheerio.CheerioAPI, names: string[]): string | null {
  for (const name of names) {
    const byProp = $(`meta[property="${name}"]`).attr('content')
    if (byProp?.trim()) return byProp.trim()
    const byName = $(`meta[name="${name}"]`).attr('content')
    if (byName?.trim()) return byName.trim()
    const byItemprop = $(`meta[itemprop="${name}"]`).attr('content')
    if (byItemprop?.trim()) return byItemprop.trim()
  }
  return null
}

/** Collect every JSON-LD block, flattening @graph containers. */
function readJsonLd($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim()
    if (!raw) return
    try {
      const parsed: unknown = JSON.parse(raw)
      const push = (v: unknown) => {
        if (!v || typeof v !== 'object') return
        const obj = v as Record<string, unknown>
        if (Array.isArray(obj['@graph'])) {
          for (const g of obj['@graph'] as unknown[]) push(g)
          return
        }
        out.push(obj)
      }
      if (Array.isArray(parsed)) parsed.forEach(push)
      else push(parsed)
    } catch {
      /* malformed JSON-LD is extremely common — skip silently */
    }
  })
  return out
}

function pickString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = pickString(item)
      if (s) return s
    }
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return pickString(o['name'] ?? o['@id'] ?? o['url'] ?? o['headline'])
  }
  return null
}

/** Collapse whitespace. The one normalisation every path below agrees on. */
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * The publisher's own summary, trimmed to a length worth testing containment
 * on. Too short and every container matches; too long and none do.
 */
function anchorOf(description: string | null): string | null {
  if (!description) return null
  const a = norm(description).slice(0, 60)
  return a.length >= 25 ? a : null
}

/**
 * JSON-LD `articleBody` is not reliably plain text.
 *
 * Some publishers put rendered markup in it, so without this the model is
 * handed `<p><strong>అమరావతి, ఆగస్టు 18:</strong> …` and asked to read it as
 * prose. Tags out, entities decoded, whitespace collapsed.
 */
function stripTags(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
  return norm(
    text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
      .replace(/&amp;/gi, '&'),
  )
}

/** Whether a string still looks like markup after we tried to clean it. */
const looksLikeHtml = (s: string): boolean => /<\/?[a-z][^>]*>/i.test(s)

/**
 * Pull readable body text.
 *
 * This replaced a rule that kept whichever container yielded the most text,
 * which had a failure that looked exactly like success: on a news page we
 * returned the right headline, the right date, the right language, and six
 * thousand characters of the sidebar's list of other headlines. Nothing threw
 * and no confidence dropped — the analysis was simply about the wrong article.
 *
 * Three things separate an article from the furniture around it, and all three
 * are needed; each alone picks something wrong on at least one real site.
 *
 *   Prose, counted from `<p>` only. Sidebars are `<li>`, and counting `li` is
 *   what let the rail win: on the page that prompted this, the outer container
 *   measures 10,504 characters through `p, li, h2, h3` and 762 through `<p>`
 *   alone. Nearly all of that difference is other people's headlines.
 *
 *   Link density. A rail is almost entirely anchor text and an article almost
 *   none, so squaring the discount lets a short article beat a long list
 *   without knowing anything about the site.
 *
 *   The page's own summary. Density alone still loses on one real page, where
 *   a 381-character advertising disclaimer carries no links at all and so
 *   outranks the 315-character story. Whichever container holds the
 *   publisher's description is the story — and since that text came from the
 *   page, this invents nothing.
 *
 * Deliberately NOT done: removing elements by class name. Two Telugu
 * publishers wrap the article itself in `theiaStickySidebar` — a sticky-scroll
 * plugin, not a sidebar — so a `[class*="sidebar"]` sweep deletes the article
 * and scores zero. Link density does that job without guessing at names.
 */
function extractArticleText(
  $: cheerio.CheerioAPI,
  description: string | null,
): { text: string | null; picked: string } {
  $('script, style, noscript, iframe, svg, nav, header, footer, aside, form').remove()
  // Only classes that are never the article. `cookie` and `advert` are safe;
  // anything naming position or relatedness is not — see the note above.
  $('[class*="cookie" i], [class*="advert" i], [id*="comment" i]').remove()

  const anchor = anchorOf(description)

  // cheerio 1.x does not re-export its element type, so take it from `$` itself
  // rather than reaching into a transitive dependency for it.
  interface Candidate {
    node: ReturnType<typeof $>
    prose: number
    score: number
    depth: number
    hasAnchor: boolean
    label: string
  }
  const candidates: Candidate[] = []

  $('article, main, section, div, [itemprop="articleBody"]').each((_, el) => {
    const node = $(el)
    const prose = node
      .find('p')
      .map((_i, p) => norm($(p).text()))
      .get()
      .filter((t) => t.length > 25)
      .join(' ').length
    if (prose < 120) return

    const whole = norm(node.text())
    const linkChars = node
      .find('a')
      .map((_i, a) => norm($(a).text()))
      .get()
      .join(' ').length
    const linkDensity = Math.min(1, linkChars / (whole.length || 1))
    const hasAnchor = anchor ? whole.includes(anchor) : false

    candidates.push({
      node,
      prose,
      score: prose * (1 - linkDensity) ** 2 * (hasAnchor ? 4 : 1),
      depth: node.parents().length,
      hasAnchor,
      label: `${node.attr('class') ?? ''}#${node.attr('id') ?? ''}`,
    })
  })

  if (!candidates.length) return { text: null, picked: 'none' }

  // When any container carries the page's own summary, only those compete.
  const pool = candidates.some((c) => c.hasAnchor)
    ? candidates.filter((c) => c.hasAnchor)
    : candidates
  const best = pool.reduce((a, b) => (b.score > a.score ? b : a))

  // Nested containers all hold the same prose, so take the innermost — we want
  // the article element, not the page wrapper that contains it.
  const tightest = pool
    .filter((c) => c.prose >= best.prose * 0.85 && c.score >= best.score * 0.6)
    .reduce((a, b) => (b.depth > a.depth ? b : a), best)

  const winner = tightest.node
  const parts: string[] = []
  const seen = new Set<string>()
  winner.find('p, li, h2, h3, blockquote').each((_, el) => {
    const t = norm($(el).text())
    if (t.length <= 25) return
    // "Also read:" promos are mostly link; body copy is not.
    const linkLen = $(el)
      .find('a')
      .map((_i, a) => norm($(a).text()))
      .get()
      .join(' ').length
    if (linkLen / (t.length || 1) > 0.7) return
    if (seen.has(t)) return // some sites print each headline twice
    seen.add(t)
    parts.push(t)
  })

  const cleaned = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  return {
    text: cleaned.length > 120 ? cleaned.slice(0, 20_000) : null,
    picked: `${tightest.label.slice(0, 50)} prose=${tightest.prose} anchor=${tightest.hasAnchor}`,
  }
}

/**
 * Publication dates that `new Date()` cannot read.
 *
 * This matters more than it looks. An office sorting a day's coverage by time
 * cannot use an article whose date is `Invalid Date`, and one of these sources
 * publishes every article that way — `Sun, 08/16/2026 - 05:58` parses to
 * nothing at all. Another publishes `2026-08-16 19:53:00` with no offset,
 * which V8 reads as server-local: the same URL yields one timestamp on a
 * developer's machine in IST and another on Netlify in UTC, and Safari refuses
 * it outright.
 *
 * These publishers are all in India, so a bare local time is read as +05:30.
 * That is an assumption, and it is stated rather than hidden — but a date that
 * is wrong by hours still beats one that silently differs per machine.
 */
export function normalisePublishedAt(raw: string | null): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null

  // Already carries a zone, so it means the same thing everywhere.
  const direct = new Date(s)
  if (!Number.isNaN(direct.getTime()) && /[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) {
    return direct.toISOString()
  }

  const IST = '+05:30'

  // "Sun, 08/16/2026 - 05:58" and "08/16/2026 - 05:58"
  const us = /(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{1,2}):(\d{2})/.exec(s)
  if (us) {
    const d = new Date(`${us[3]}-${us[1]}-${us[2]}T${us[4]!.padStart(2, '0')}:${us[5]}:00${IST}`)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }

  // "2026-08-16 19:53:00" — ISO date, space separator, no offset.
  const bare = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s)
  if (bare) {
    const d = new Date(`${bare[1]}-${bare[2]}-${bare[3]}T${bare[4]}:${bare[5]}:${bare[6] ?? '00'}${IST}`)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }

  return Number.isNaN(direct.getTime()) ? null : direct.toISOString()
}

/**
 * A byline that names a person rather than the outlet's Twitter handle.
 *
 * `twitter:creator` is the masthead account on most of these sites, so reading
 * it first reports the author of a district crime report as "@Eenadu.NET"
 * while the page's own JSON-LD names the reporter who filed it.
 */
function pickAuthor(
  $: cheerio.CheerioAPI,
  node: Record<string, unknown> | undefined,
): string | null {
  const fromLd = pickString(node?.['author'])
  if (fromLd && !fromLd.startsWith('@')) return fromLd
  const named = firstMeta($, ['author', 'article:author'])
  if (named && !named.startsWith('@')) return named
  return fromLd ?? firstMeta($, ['twitter:creator'])
}

export function parseMetadata(html: string, sourceUrl: string): PageMetadata {
  const $ = cheerio.load(html)
  const jsonLd = readJsonLd($)

  const find = (type: RegExp) =>
    jsonLd.find((n) => {
      const t = n['@type']
      const types = Array.isArray(t) ? t : [t]
      return types.some((x) => typeof x === 'string' && type.test(x))
    })

  const article = find(/Article|NewsArticle|BlogPosting|SocialMediaPosting|Report/i)
  const video = find(/VideoObject/i)
  const node = article ?? video ?? jsonLd[0]

  // schema.org InteractionCounter — the one standard place engagement hides.
  const interactions: PageMetadata['interactions'] = {}

  /**
   * `Number('')` and `Number(null)` are both 0 and both finite, so a bare
   * coercion turns "this field was absent" into "this post has zero likes" —
   * the exact null-versus-zero confusion the rest of the pipeline is careful
   * to avoid. Only real numbers and all-digit strings count.
   */
  const strictCount = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return Number(v.trim())
    return null
  }

  for (const n of jsonLd) {
    const raw = n['interactionStatistic']
    const list = Array.isArray(raw) ? raw : raw ? [raw] : []
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      const kind = String(pickString(e['interactionType']) ?? '').toLowerCase()
      const count = strictCount(e['userInteractionCount'])
      if (count == null) continue

      // First writer wins. Pages often carry several JSON-LD nodes — an
      // Article plus a WebPage plus a VideoObject — and letting a later node
      // overwrite means whichever happened to be last in the markup decides.
      if (kind.includes('like')) interactions.like ??= count
      else if (kind.includes('comment')) interactions.comment ??= count
      else if (kind.includes('share')) interactions.share ??= count
      else if (kind.includes('watch') || kind.includes('view')) interactions.view ??= count
    }
  }

  const bodyLower = $('body').text().slice(0, 4000).toLowerCase()
  const isWall = WALL_MARKERS.some((m) => bodyLower.includes(m))

  const keywordsRaw = firstMeta($, ['keywords', 'news_keywords', 'article:tag'])

  const description =
    firstMeta($, ['og:description', 'twitter:description', 'description']) ??
    pickString(node?.['description']) ??
    null

  /**
   * The body text, resolved before the object below rather than inside it.
   *
   * Extraction mutates the document — it strips furniture out of `$` as it
   * works — and property values in an object literal evaluate top to bottom.
   * Every other field happens to read from `<head>` today, so nothing breaks,
   * but a future DOM-backed field would silently read a mutilated document.
   *
   * `articleBody` is searched across every JSON-LD node rather than only the
   * first Article-ish one. Publishers routinely emit two: a stub NewsArticle in
   * the head and the real one lower down. Reading only the first meant the
   * field looked absent on exactly the pages that had it.
   */
  let ldBody: string | null = null
  for (const n of jsonLd) {
    const raw = pickString(n['articleBody'])
    if (!raw) continue
    const body = looksLikeHtml(raw) ? stripTags(raw) : raw
    if (body.length > (ldBody?.length ?? 0)) ldBody = body
  }

  const { text: domBody } = extractArticleText($, description)

  /**
   * Which of the two to trust.
   *
   * The DOM read wins by default: on these sources `articleBody` is routinely
   * a stub — a couple of hundred characters of title and description against a
   * story several times that. The publisher's field is preferred only when it
   * is genuinely longer, which is the case on sites that publish the whole
   * story there.
   */
  const articleText =
    ldBody && (!domBody || ldBody.length > domBody.length) ? ldBody : (domBody ?? ldBody)

  return {
    title:
      firstMeta($, ['og:title', 'twitter:title']) ??
      pickString(node?.['headline'] ?? node?.['name']) ??
      $('title').first().text().trim() ??
      null,
    description,
    articleText,
    siteName: firstMeta($, ['og:site_name', 'application-name']),
    author: pickAuthor($, node),
    publishedAt: normalisePublishedAt(
      firstMeta($, ['article:published_time', 'og:updated_time', 'datePublished']) ??
        pickString(node?.['datePublished'] ?? node?.['uploadDate']) ??
        null,
    ),
    image: firstMeta($, ['og:image:secure_url', 'og:image', 'twitter:image']),
    video: firstMeta($, ['og:video:secure_url', 'og:video:url', 'og:video']),
    canonical: $('link[rel="canonical"]').attr('href') ?? firstMeta($, ['og:url']) ?? sourceUrl,
    lang: $('html').attr('lang')?.split('-')[0] ?? null,
    keywords: keywordsRaw
      ? keywordsRaw
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
          .slice(0, 20)
      : [],
    interactions,
    isWall,
  }
}

/**
 * Text that is definitely not the post: consent banners, app-store landing
 * pages, JS-required notices, bot walls.
 *
 * This guard matters more than it looks. Two of the workbook's own links fail
 * this way — an e-paper whose only server-side text is its cookie notice, and
 * a WhatsApp shortlink that redirects to a Play Store listing. Both return
 * HTTP 200 with plausible-looking prose, so without this check the analyser
 * would confidently produce a full sentiment readout of Google Play's app
 * description and present it as the post. Failing honestly is far better.
 */
const JUNK_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /this website is using cookies|we use cookies|accept all cookies|cookie (policy|consent|preferences)/i,
    reason: 'the site returned its cookie notice instead of the article',
  },
  {
    re: /apps on google play|download on the app store|get it on google play|app store preview/i,
    reason: 'the link redirects to an app-store page, not a post',
  },
  {
    re: /(enable|turn on) javascript|javascript is (required|disabled)|please enable cookies/i,
    reason: 'the page needs a browser to render its content',
  },
  {
    re: /are you a robot|unusual traffic|verify you are human|checking your browser/i,
    reason: 'the site served a bot check',
  },
  {
    re: /log in to continue|sign up to see|content isn.t available/i,
    reason: 'the site served a login wall',
  },
  {
    // Raw page script. Meta's pages open with a `requireLazy([...])` bootstrap
    // and megabytes of module definitions; a regex that reaches past its
    // intended field can capture the lot, and the result is a wall of
    // JavaScript presented to the user as the post — and handed to the model as
    // the thing to analyse. Nothing that matches this is ever a real post.
    re: /requireLazy\(|__d\("|ServerJS\(\)|\bfunction\s*\([a-z],[a-z],[a-z]\)|<script\b|\{"define":\[|window\.__additionalDataLoaded/i,
    reason: 'the page returned its own JavaScript rather than the post',
  },
]

export function detectJunk(text: string | null | undefined): string | null {
  if (!text) return null
  const sample = text.slice(0, 1200)
  for (const { re, reason } of JUNK_PATTERNS) {
    if (re.test(sample)) return reason
  }
  return null
}

// Count parsing is shared with the rescue sheet so the two can never disagree
// about what "1.2K" means. See shared/parse.ts.
export { parseCount } from '../../../shared/parse'
