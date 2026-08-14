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

/**
 * Pull readable body text. Deliberately simple rather than a full Readability
 * port: strip the furniture, prefer the densest article-ish container, and take
 * its paragraphs. Works well on news/e-paper pages, which is what this is for.
 */
function extractArticleText($: cheerio.CheerioAPI): string | null {
  $('script, style, noscript, iframe, svg, nav, header, footer, aside, form').remove()
  $('[class*="cookie" i], [class*="banner" i], [class*="advert" i], [id*="comment" i]').remove()

  const candidates = [
    'article',
    '[itemprop="articleBody"]',
    '.article-body',
    '.story-body',
    '.entry-content',
    '.post-content',
    '.content-body',
    'main',
    '#content',
  ]

  let best = ''
  for (const sel of candidates) {
    const node = $(sel).first()
    if (!node.length) continue
    const text = node
      .find('p, li, h2, h3')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 25)
      .join('\n\n')
    if (text.length > best.length) best = text
  }

  if (best.length < 200) {
    // Nothing matched a known container — fall back to every substantial <p>.
    const all = $('p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 40)
      .join('\n\n')
    if (all.length > best.length) best = all
  }

  const cleaned = best.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
  return cleaned.length > 120 ? cleaned.slice(0, 20_000) : null
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

  return {
    title:
      firstMeta($, ['og:title', 'twitter:title']) ??
      pickString(node?.['headline'] ?? node?.['name']) ??
      $('title').first().text().trim() ??
      null,
    description:
      firstMeta($, ['og:description', 'twitter:description', 'description']) ??
      pickString(node?.['description']) ??
      null,
    articleText: pickString(node?.['articleBody']) ?? extractArticleText($),
    siteName: firstMeta($, ['og:site_name', 'application-name']),
    author:
      firstMeta($, ['author', 'article:author', 'twitter:creator']) ??
      pickString(node?.['author']) ??
      null,
    publishedAt:
      firstMeta($, ['article:published_time', 'og:updated_time', 'datePublished']) ??
      pickString(node?.['datePublished'] ?? node?.['uploadDate']) ??
      null,
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
