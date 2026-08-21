import * as cheerio from 'cheerio'
import { fetchText } from './fetcher'
import { feedUrlFor, indexUrlFor, PORTALS, type NewsPortal } from '../../../shared/regions'

/**
 * Find today's stories on the mastheads a desk follows.
 *
 * The desk used to open on an empty box: the operator went to each paper,
 * copied links, and pasted them back. That is the office doing the crawling,
 * which is the part a machine should be doing.
 *
 * This reads each masthead's index and returns the stories whose headline or
 * address carries one of the desk's words. It deliberately does NOT classify
 * anything — a classification is two model calls and a batch of ten already
 * fills a function's window, so this stays cheap and fast and hands its
 * candidates to the grievance endpoint in batches the caller controls. The
 * operator sees what was found before any of it is read.
 *
 * WHAT THIS CANNOT DO, and says so rather than pretending: several Telugu
 * publishers serve their district edition on the reader's location, not the
 * URL. Fetched from a server the same address returns the state or national
 * feed. The desk's words are what recover local stories from that feed, which
 * is why the tags matter more here than they would against a true district page.
 */

/** One story we think is worth reading. */
export interface Candidate {
  url: string
  title: string
  portal: string
  /** Which of the desk's words this matched. Empty when no words were given. */
  matched: string[]
}

export interface ScanResult {
  candidates: Candidate[]
  /** Per-masthead outcome, so a dead source is visible rather than silent. */
  sources: { portal: string; url: string; found: number; error: string | null }[]
  notes: string[]
}

/** How many index pages one request will read, and how long each may take. */
const MAX_SOURCES = 8
const FETCH_TIMEOUT_MS = 9_000
/** Per masthead, so one busy homepage cannot crowd out the others. */
const PER_SOURCE_CAP = 40
const TOTAL_CAP = 120

/**
 * Does this link look like a story rather than a section?
 *
 * Publishers do not agree on URL shape, so this tests the two things that hold
 * across all of them: a story lives several segments deep, and it carries
 * either a numeric id or a long word-slug. Section fronts have neither.
 */
function looksLikeArticle(url: URL, host: string): boolean {
  if (url.hostname.replace(/^www\./, '') !== host.replace(/^www\./, '')) return false
  const path = url.pathname.replace(/\/+$/, '')
  if (path.length < 12) return false

  // Section fronts, tag pages, author pages and media galleries.
  if (/\/(tag|tags|author|topic|photos?|videos?|live-news|search|page)\//i.test(path)) return false

  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0) return false

  const last = segments[segments.length - 1] ?? ''
  const hasNumericId = /\d{5,}$/.test(last) || segments.some((s) => /^\d{6,}$/.test(s))
  const hasWordSlug = (last.match(/-/g) ?? []).length >= 3

  /*
    A single-segment address can still be a story.

    This used to require two segments — "a story lives several segments deep" —
    which is true of most Indian mastheads and false of a significant minority.
    Telangana Today publishes at the root:

        telanganatoday.com/dk-aruna-to-lodge-complaint-with-lok-sabha-speaker

    Its tag page for a sitting MP carried twenty-eight stories about her, every
    one of them rejected here, and the desk reported a quiet week. A publisher's
    URL shape is not evidence about whether it is worth reading.

    A lone segment therefore has to work harder to qualify: four hyphens rather
    than three, which is a headline slug and not a section name. "/about-us" and
    "/privacy-policy" do not reach it; the story above has nine.
  */
  if (segments.length === 1) {
    return hasNumericId || (last.match(/-/g) ?? []).length >= 4
  }

  return hasNumericId || hasWordSlug
}

/** Normalise for comparison: lower-case, collapse punctuation to spaces. */
const fold = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Which of the desk's words this story carries.
 *
 * Matched against the headline and the address both, because a Telugu headline
 * and an English slug often carry the place name in only one of the two.
 */
/** Escape a folded tag so it can be used inside a boundary pattern. */
const escapeForPattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Is this story worth keeping, given which words it matched?
 *
 * A party name is a legitimate thing for a constituency desk to watch and a
 * disastrous thing to watch on its own. Scanning eight Telangana mastheads for
 * a Mahabubnagar MP returned twenty-three stories, every one of them matched
 * only on "BJP": a Kolkata meeting, a Kejriwal quote, a shootout in Karnataka,
 * poll in-charges appointed for Punjab. All real news, none of it hers.
 *
 * So a broad word only counts when a narrow one lands with it. "BJP" plus
 * "Mahabubnagar" is exactly what the desk means by watching the party; "BJP"
 * alone is the national wire.
 *
 * When the desk has supplied no narrow words at all there is nothing to pair
 * against, and the broad ones are all it has — so they are honoured rather than
 * used to filter everything out.
 */
export function worthKeeping(
  matched: string[],
  broad: Set<string>,
  hasNarrow: boolean,
): boolean {
  if (matched.length === 0) return false
  if (!hasNarrow || broad.size === 0) return true
  return matched.some((tag) => !broad.has(tag))
}

export function matchTags(title: string, url: string, tags: string[]): string[] {
  if (tags.length === 0) return []
  const haystack = `${fold(title)} ${fold(decodeURIComponent(url))}`
  const rawHaystack = `${title} ${decodeURIComponent(url)}`

  return tags.filter((tag) => {
    const t = tag.trim()
    if (!t) return false

    // Indic text does not survive folding to a Latin word boundary, so it is
    // tested against the original string.
    if (/[^\x00-\x7F]/.test(t)) return rawHaystack.includes(t)

    /*
      A whole word, not a substring.

      This was `haystack.includes(fold(t))`, and the desk of an MP named Aruna
      was handed two stories about a rain ritual: the Telugu word వరుణ
      transliterates into the URL slug as "varuna", which contains "aruna".
      Four of the twenty-seven stories that morning were matched that way, on a
      screen whose entire claim is that these items are about you.

      `fold` has already collapsed every non-alphanumeric run to a single space,
      so a word boundary here is a space or an end of string — which is exactly
      what a URL slug's hyphens have become by this point.
    */
    const folded = fold(t)
    if (!folded) return false
    return new RegExp(`(^|\\s)${escapeForPattern(folded)}($|\\s)`).test(haystack)
  })
}

/**
 * Read a feed instead of a page, when the publisher offers one.
 *
 * Scraping an index was returning nine stories from two national mastheads,
 * because the heuristics that decide "this link is an article" have to be
 * strict enough to reject a page full of navigation — and strict costs recall.
 * Nine candidates is a pool too small for any word to match, which is why
 * searching those papers for "Modi" found nothing at all while the papers were
 * plainly carrying him.
 *
 * The same publishers answer their feeds with sixty to two hundred items, each
 * one already a title and a link with no guessing required. A feed is what a
 * publisher offers a machine; the index page is what they offer a person. This
 * is the open-source route the portal list refers to.
 */
function readFeed(
  xml: string,
  label: string,
  tags: string[],
  broad: Set<string>,
  hasNarrow: boolean,
): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()

  // RSS <item> and Atom <entry> in one pass — publishers here use both.
  const blocks = xml.match(/<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/gi) ?? []
  for (const block of blocks) {
    const rawTitle =
      /<title[^>]*>([\s\S]*?)<\/title>/i.exec(block)?.[1] ?? ''
    // Atom puts the address in an attribute; RSS puts it in the element.
    const rawLink =
      /<link[^>]*href=["']([^"']+)["']/i.exec(block)?.[1] ??
      /<link[^>]*>([\s\S]*?)<\/link>/i.exec(block)?.[1] ??
      /<guid[^>]*>([\s\S]*?)<\/guid>/i.exec(block)?.[1] ??
      ''

    const title = decodeXml(rawTitle)
    const url = decodeXml(rawLink).trim()
    if (title.length < 12 || !/^https?:\/\//i.test(url)) continue
    if (seen.has(url)) continue
    seen.add(url)

    const matched = matchTags(title, url, tags)
    if (tags.length > 0 && !worthKeeping(matched, broad, hasNarrow)) continue
    out.push({ url, title, portal: label, matched })
    if (out.length >= PER_SOURCE_CAP) break
  }
  return out
}

/** CDATA and the five XML entities. Feeds use both, often in one document. */
function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Fetch one source and read it the way its own format asks to be read.
 *
 * The fetch is shared because the failure handling is the same either way; only
 * the parsing differs. A feed that comes back as HTML — some publishers answer
 * a retired feed address with their homepage under HTTP 200 — falls through to
 * the page reader rather than reporting zero stories, which would look like a
 * quiet day rather than a moved feed.
 */
async function readSource(
  label: string,
  url: string,
  tags: string[],
  isFeed: boolean,
  broad: Set<string>,
  hasNarrow: boolean,
): Promise<{ found: Candidate[]; error: string | null }> {
  if (!isFeed) return readIndex(label, url, tags, broad, hasNarrow)

  let page
  try {
    page = await fetchText(url, { agent: 'browser', timeout: FETCH_TIMEOUT_MS })
  } catch (err) {
    return { found: [], error: err instanceof Error ? err.message : String(err) }
  }
  if (!page.ok || !page.body) {
    return { found: [], error: `The feed answered HTTP ${page.status}.` }
  }

  const looksLikeFeed = /<(?:rss|feed|channel)[\s>]/i.test(page.body.slice(0, 2_000))
  if (!looksLikeFeed) return readIndex(label, page.url, tags, broad, hasNarrow)

  return { found: readFeed(page.body, label, tags, broad, hasNarrow), error: null }
}

/** Read one index page and pull the stories off it. */
async function readIndex(
  label: string,
  indexUrl: string,
  tags: string[],
  broad: Set<string>,
  hasNarrow: boolean,
): Promise<{ found: Candidate[]; error: string | null }> {
  let page
  try {
    page = await fetchText(indexUrl, { agent: 'browser', timeout: FETCH_TIMEOUT_MS })
  } catch (err) {
    return { found: [], error: err instanceof Error ? err.message : String(err) }
  }
  if (!page.ok || !page.body) {
    return { found: [], error: `The masthead answered HTTP ${page.status}.` }
  }

  const base = new URL(page.url)
  const host = base.hostname
  const $ = cheerio.load(page.body)

  const seen = new Set<string>()
  const found: Candidate[] = []

  /**
   * The headline for a link, wherever the publisher happened to put it.
   *
   * Reading the anchor's own text alone returned nothing at all from two of
   * the three mastheads tested: their index links wrap a thumbnail, so the
   * anchor has no text and the headline sits in an image's alt text, a title
   * attribute, or a heading beside it. Checking one place and concluding the
   * page had no stories is how a scan reports "0 found" on a page full of them.
   */
  // cheerio 1.x does not re-export its element type; taking the node type from
  // `$` itself avoids reaching into a transitive dependency for it.
  const headlineFor = (node: ReturnType<typeof $>): string => {
    const candidates = [
      node.text(),
      node.attr('title') ?? '',
      node.attr('aria-label') ?? '',
      node.find('img').attr('alt') ?? '',
      node.find('h1,h2,h3,h4,span,p').first().text(),
      node.closest('li,article,div').find('h1,h2,h3,h4').first().text(),
    ]
    for (const c of candidates) {
      const t = c.replace(/\s+/g, ' ').trim()
      if (t.length >= 18) return t
    }
    return ''
  }

  $('a[href]').each((_, el) => {
    if (found.length >= PER_SOURCE_CAP) return
    const href = $(el).attr('href') ?? ''
    // A headline is a sentence; navigation is a word or two.
    const title = headlineFor($(el))
    if (!title) return

    let abs: URL
    try {
      abs = new URL(href, page.url)
    } catch {
      return
    }
    if (!looksLikeArticle(abs, host)) return

    const url = abs.toString()
    if (seen.has(url)) return
    seen.add(url)

    const matched = matchTags(title, url, tags)
    // With words given, only matching stories are worth the operator's time —
    // and a story matching only a broad word like a party name is not one of
    // them. See worthKeeping.
    if (tags.length > 0 && !worthKeeping(matched, broad, hasNarrow)) return

    found.push({ url, title, portal: label, matched })
  })

  return { found, error: null }
}

export interface ScanInput {
  /** Masthead labels from PORTALS, plus any index URL the office added. */
  portals: string[]
  /** Extra index pages the office pasted in. */
  customUrls?: string[]
  /** The district or city, used to reach a publisher's district section. */
  city?: string | null
  /**
   * The state. Passed explicitly rather than derived from the city, because a
   * district name the region list does not carry would otherwise resolve to no
   * state at all and send a national masthead to its default section — which is
   * how a desk in Varanasi came back reading Andhra Pradesh.
   */
  state?: string | null
  /** The desk's words. With none, every story on the page comes back. */
  tags: string[]
  /**
   * Words too wide to stand alone — a party name, a state.
   *
   * They only count when a narrower word matches the same story. Without this a
   * desk watching "BJP" is handed the national wire every morning: twenty-three
   * stories, none of them about the member, on a screen claiming they are.
   */
  broadTags?: string[]
}

export async function scanPortals(input: ScanInput): Promise<ScanResult> {
  const notes: string[] = []
  const targets: { label: string; url: string; isFeed: boolean }[] = []

  for (const name of input.portals) {
    const portal: NewsPortal | undefined = PORTALS.find((p) => p.label === name)
    if (!portal) continue
    /**
     * The feed first, the page only when there is no feed.
     *
     * Both are declared per masthead, and the feed wins wherever one exists:
     * scraping the two national indexes yielded nine stories between them and a
     * search for a sitting Prime Minister matched none of the nine, while the
     * same publishers answer their feeds with sixty to two hundred items each.
     */
    const feed = feedUrlFor(portal, input.city ?? null, input.state ?? null)
    targets.push({
      label: portal.label,
      url: feed ?? indexUrlFor(portal, input.city ?? null, input.state ?? null),
      isFeed: feed !== null,
    })
  }

  for (const raw of input.customUrls ?? []) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    try {
      const u = new URL(trimmed)
      targets.push({ label: u.hostname.replace(/^www\./, ''), url: u.toString(), isFeed: false })
    } catch {
      notes.push(`Skipped "${trimmed.slice(0, 60)}". That is not a web address.`)
    }
  }

  if (targets.length > MAX_SOURCES) {
    notes.push(
      `Read the first ${MAX_SOURCES} of ${targets.length} sources. The rest were not read at all. Run the scan again with the others selected.`,
    )
  }
  const capped = targets.slice(0, MAX_SOURCES)

  const broad = new Set((input.broadTags ?? []).map((t) => t.trim()).filter(Boolean))
  const hasNarrow = input.tags.some((t) => !broad.has(t.trim()))

  const results = await Promise.all(
    capped.map(async (t) => {
      const { found, error } = await readSource(t.label, t.url, input.tags, t.isFeed, broad, hasNarrow)
      return { portal: t.label, url: t.url, found, error }
    }),
  )

  // Same story carried by two mastheads is one story.
  const byUrl = new Map<string, Candidate>()
  for (const r of results) {
    for (const c of r.found) {
      if (!byUrl.has(c.url)) byUrl.set(c.url, c)
    }
  }

  const candidates = [...byUrl.values()]
    // Most words matched first: a story naming the segment AND the subject is
    // more likely to be the office's business than one naming either alone.
    .sort((a, b) => b.matched.length - a.matched.length)
    .slice(0, TOTAL_CAP)

  if (byUrl.size > TOTAL_CAP) {
    notes.push(`Found ${byUrl.size} stories and kept the ${TOTAL_CAP} best matches.`)
  }
  if (input.tags.length === 0) {
    notes.push(
      'No words were given, so this is everything the mastheads are carrying, not just your patch.',
    )
  }

  return {
    candidates,
    sources: results.map((r) => ({
      portal: r.portal,
      url: r.url,
      found: r.found.length,
      error: r.error,
    })),
    notes,
  }
}
