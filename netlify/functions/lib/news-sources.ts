import { fetchText } from './fetcher'

/**
 * Finding the pages that carry news about ONE person.
 *
 * The masthead list is organised by place, and for a great many members that is
 * the wrong axis. Scanning the eight papers covering Mahabubnagar for its
 * sitting MP returned nothing at all: her name was on none of their front pages
 * that morning, and the two district editions that would have carried local
 * news serve their district feed on the reader's location rather than on the
 * URL — from a server they return the state wire, so the desk read eighty
 * stories about Bengaluru, Meerut and a film star's farm.
 *
 * Meanwhile Telangana Today maintained a page listing twenty-eight stories
 * about her, and nothing in this app knew it existed.
 *
 * That is the gap this closes. A publisher tag page is the best news source a
 * person-centred desk can have: it is maintained by the publisher, it is
 * exactly one person's coverage, it needs no search terms to filter, and it
 * keeps working every morning once found.
 *
 * Grounded search is what finds them. It is a real query against a real index —
 * the same mechanism that located the member's Facebook page — and every
 * address it returns is fetched and checked for actual article links before it
 * is trusted. A tag page that yields no stories is not a source, whatever a
 * model said about it.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
const MODEL = process.env['GEMINI_GROUNDED_MODEL'] ?? 'gemini-2.5-flash'
/**
 * The grounded call's own budget.
 *
 * Generous because it is one call that decides whether this desk has any news
 * source at all, and the page checks after it run in parallel — the whole
 * request used to spend its entire allowance walking twenty redirects in
 * single file.
 */
const TIMEOUT_MS = 45_000
const CHECK_TIMEOUT_MS = 8_000

/** How many addresses are fetched back to be proved. Each is a live request. */
const MAX_CHECK = 8

/** A page has to carry this many story links to count as a source. */
const MIN_ARTICLES = 3

export interface NewsSource {
  url: string
  publisher: string
  /** How many article-shaped links it was carrying when checked. */
  articles: number
  /** A standing page for this person, as against a single story. */
  standing: boolean
}

export interface SourceDiscovery {
  sources: NewsSource[]
  /** Individual stories found on the way, worth reading now. */
  stories: { url: string; title: string; publisher: string }[]
  notes: string[]
  searched: boolean
}

export const groundedNewsAvailable = (): boolean =>
  Boolean(process.env['GEMINI_API_KEY']?.trim())

/* ── recognising a page worth keeping ────────────────────────────────────── */

const publisherOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'unknown'
  }
}

/**
 * A standing page about one subject, rather than one story.
 *
 * These are the ones worth keeping: a publisher maintains them, so tomorrow's
 * coverage appears on the same address without anybody doing anything.
 */
function looksStanding(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase()
    return /\/(tag|tags|topic|topics|author|authors|people|person|subject)\//.test(path)
  } catch {
    return false
  }
}

/**
 * Does this page actually carry stories?
 *
 * The check that stops a model's suggestion becoming a permanent source on the
 * strength of having been mentioned. Counting links that look like articles is
 * crude and is exactly the right amount of rigour here: a real tag page has
 * dozens, a 404 has none, and a section front that happens to match the pattern
 * is still a page carrying stories.
 */
async function countArticles(url: string): Promise<number> {
  const res = await fetchText(url, { timeout: CHECK_TIMEOUT_MS }).catch(() => null)
  if (!res?.ok || !res.body) return 0

  let host: string
  try {
    host = new URL(res.url).hostname
  } catch {
    return 0
  }

  const found = new Set<string>()
  for (const match of res.body.matchAll(/href="([^"]+)"/gi)) {
    const href = match[1]
    if (!href) continue
    let abs: URL
    try {
      abs = new URL(href, res.url)
    } catch {
      continue
    }
    if (abs.hostname !== host) continue

    const segments = abs.pathname.split('/').filter(Boolean)
    if (segments.length === 0) continue
    const last = segments[segments.length - 1] ?? ''
    // The same shape the scanner uses: a headline slug, or a numeric id.
    const hyphens = (last.match(/-/g) ?? []).length
    if (hyphens >= 4 || /\d{5,}$/.test(last)) found.add(abs.toString())
  }
  return found.size
}

/* ── the grounded call ───────────────────────────────────────────────────── */

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: unknown }[] }
    groundingMetadata?: { groundingChunks?: { web?: { uri?: unknown; title?: unknown } }[] }
  }[]
  error?: { message?: unknown }
}

/**
 * Grounding hands back redirect addresses, not the pages themselves.
 *
 * `vertexaisearch.cloud.google.com/grounding-api-redirect/…` is what appears in
 * the response, and it is useless as a source — it is single-use and says
 * nothing about the publisher. Following it once yields the real address, which
 * for the member above turned out to be a tag page rather than the single story
 * the model had been describing.
 */
async function resolveRedirect(url: string): Promise<string | null> {
  if (!/vertexaisearch\.cloud\.google\.com/.test(url)) return url

  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8_000) })
    const location = res.headers.get('location')
    return location && /^https?:\/\//i.test(location) ? location : null
  } catch {
    return null
  }
}

export interface DiscoverSourcesInput {
  name: string
  role?: string | null
  constituency?: string | null
  state?: string | null
  party?: string | null
  signal?: AbortSignal
}

export async function discoverNewsSources(
  input: DiscoverSourcesInput,
): Promise<SourceDiscovery> {
  const key = process.env['GEMINI_API_KEY']?.trim()
  if (!key) {
    return {
      sources: [],
      stories: [],
      searched: false,
      notes: [
        'No Gemini key is set, so the web was not searched for pages covering this person.',
      ],
    }
  }

  const who = [
    input.name,
    input.role ? `the ${input.role}` : null,
    input.constituency ? `for ${input.constituency}` : null,
    input.state ? `in ${input.state}` : null,
    input.party ?? null,
  ]
    .filter(Boolean)
    .join(' ')

  const prompt = `Find news coverage of ${who} from the last two months.

I need two things:

1. Any news website that maintains a DEDICATED PAGE collecting this person's coverage — a tag page, topic page or author page whose address contains /tag/, /topic/ or similar. These are the most valuable answers because they keep updating.

2. Individual recent news stories about them, with the publisher and the full address.

Search Indian news sites, including regional-language ones. Give full URLs. If you find nothing recent, say so plainly rather than offering old coverage as new.`

  let body: GeminiResponse
  try {
    const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
      signal: input.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    })
    body = (await res.json()) as GeminiResponse

    if (!res.ok || body.error) {
      return {
        sources: [],
        stories: [],
        searched: true,
        notes: [
          `The search for news pages did not run: ${
            typeof body.error?.message === 'string' ? body.error.message : `HTTP ${res.status}`
          }`,
        ],
      }
    }
  } catch (err) {
    return {
      sources: [],
      stories: [],
      searched: true,
      notes: [
        `The search for news pages could not be reached: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ],
    }
  }

  const candidate = body.candidates?.[0]
  const answer = (candidate?.content?.parts ?? [])
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('\n')

  /* every address mentioned, plus every page the search actually read */

  const raw = new Set<string>()
  for (const m of answer.matchAll(/https?:\/\/[^\s)<>"'\]`*,;]+/g)) {
    raw.add(m[0].replace(/[.,;:`*)\]]+$/, ''))
  }
  for (const chunk of candidate?.groundingMetadata?.groundingChunks ?? []) {
    const uri = chunk.web?.uri
    if (typeof uri === 'string') raw.add(uri)
  }

  /* resolve, dedupe, and prove — all in parallel */

  // Sequentially this was twenty round trips one after another and the whole
  // request timed out at twenty-five seconds having produced nothing. Each of
  // these is independent; there is no reason for any of them to wait.
  const candidates = [...raw].slice(0, MAX_CHECK * 2)
  const resolvedList = await Promise.all(candidates.map((u) => resolveRedirect(u)))

  const resolved = new Set<string>()
  for (const real of resolvedList) {
    if (!real) continue
    // Google's own properties are never a news source.
    if (/google\.com|gstatic\.com|youtube\.com|blogspot\./.test(real)) continue
    resolved.add(real)
  }

  const sources: NewsSource[] = []
  const stories: { url: string; title: string; publisher: string }[] = []

  const checks = [...resolved].slice(0, MAX_CHECK)
  const counted = await Promise.all(
    checks.map(async (url) => ({ url, articles: await countArticles(url) })),
  )

  for (const { url, articles } of counted) {
    const standing = looksStanding(url)
    if (articles >= MIN_ARTICLES) {
      sources.push({ url, publisher: publisherOf(url), articles, standing })
    } else {
      // Not a listing page, so it is probably one story. Kept as something to
      // read now rather than as a source to scan every morning.
      stories.push({ url, title: '', publisher: publisherOf(url) })
    }
  }

  // Standing pages first, then by how much they were carrying.
  sources.sort((a, b) => Number(b.standing) - Number(a.standing) || b.articles - a.articles)

  const notes: string[] = []
  const standingCount = sources.filter((s) => s.standing).length

  if (sources.length === 0) {
    notes.push(
      'No publisher appears to maintain a page collecting this person’s coverage. The desk will rely on the mastheads for the district instead.',
    )
  } else {
    notes.push(
      standingCount > 0
        ? `${standingCount} publisher ${standingCount === 1 ? 'page collects' : 'pages collect'} this person’s coverage and will be read every morning — these keep updating, so they need finding only once.`
        : `${sources.length} ${sources.length === 1 ? 'page carries' : 'pages carry'} coverage and will be scanned.`,
    )
  }

  return { sources, stories, notes, searched: true }
}
