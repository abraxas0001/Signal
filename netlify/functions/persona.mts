import type { Config, Context } from '@netlify/functions'
import { analysePersonaMention, findPersonaMentions } from './lib/persona'
import type { PersonaCandidate, PersonaMention } from './lib/persona'

/**
 * The persona tracker.
 *
 *   POST /api/persona  { action: 'find',    persona, aliases?, portals, ... }
 *   POST /api/persona  { action: 'analyse', persona, urls, aliases?, candidates? }
 *
 * One path, two actions, because they cost completely different things and the
 * office runs them at different moments. 'find' is a handful of index reads and
 * no model call: it answers in a couple of seconds and the operator sees what
 * the mastheads are carrying about the person before anything is spent. Then
 * they pick the stories worth reading and send those to 'analyse', which is two
 * model calls per story.
 *
 * Splitting them is not a preference. netlify dev enforces a hard thirty
 * seconds per request whatever netlify.toml says, and one endpoint that both
 * scanned eight mastheads and read everything it found would time out on any
 * day the news was busy — returning nothing at all, having done all the work.
 *
 * Every limit applied is named in the response. Silent truncation is the one
 * failure this product cannot afford: an office told it has four stories, when
 * nine were found and five were dropped, believes it has seen the day.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

/**
 * How many stories one request reads.
 *
 * Four, not ten. Each is a page fetch plus two model calls, and the free tiers
 * this runs on meter tokens per minute across the whole key. The batch that
 * fits is small, so the response says how small rather than pretending the rest
 * were never there.
 */
const MAX_ANALYSE = 4

/**
 * How many run at once.
 *
 * Two stories in flight is four concurrent model calls, which is what the
 * grievance desk settled on for the same providers. Going wider does not finish
 * sooner: it produces rate-limit errors and an empty batch.
 */
const CONCURRENCY = 2

/**
 * When to stop and hand back what finished.
 *
 * The real ceiling belongs to the platform, not to a number in this file — when
 * it gets there first the connection is simply dropped and the office gets
 * nothing. This deadline exists to return the stories that did finish, and it
 * sits inside the thirty seconds netlify dev enforces.
 */
const DEADLINE_MS = (() => {
  const raw = Number(process.env['PERSONA_DEADLINE_MS'])
  return Number.isFinite(raw) && raw >= 8_000 && raw <= 60_000 ? raw : 24_000
})()

/** The scan context a caller may send back, so corroboration is a real check. */
const MAX_CONTEXT = 120

interface Body {
  action?: unknown
  persona?: unknown
  aliases?: unknown
  portals?: unknown
  customUrls?: unknown
  state?: unknown
  city?: unknown
  urls?: unknown
  candidates?: unknown
}

const strings = (v: unknown, cap: number): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
        .slice(0, cap)
    : []

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * Rebuild the scan context from whatever the browser sent.
 *
 * These candidates came from this endpoint, went into the client's own storage,
 * and came back — so they are not a trusted shape. A row missing the two fields
 * the cross-check reads is dropped rather than compared at a guess.
 */
function toCandidate(raw: unknown): PersonaCandidate | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const url = text(row['url'])
  const title = text(row['title'])
  if (!url || !title) return null
  return { url, title, portal: text(row['portal']) ?? 'unknown' }
}

export default async function handler(req: Request, _context: Context): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: "Send a POST with { action: 'find' | 'analyse' }." }, 405)
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json({ error: 'That request was not valid JSON.' }, 400)
  }

  const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : 'find'
  const persona = text(body.persona)
  if (!persona) {
    return json({ error: 'Name the person to track, for example "Narendra Modi".' }, 400)
  }
  const aliases = strings(body.aliases, 12)

  if (action === 'find') return find(body, persona, aliases)
  if (action === 'analyse') return analyse(body, persona, aliases)

  return json(
    { error: `Unknown action "${action}". Use "find" to scan the mastheads, or "analyse" to read what it found.` },
    400,
  )
}

async function find(body: Body, persona: string, aliases: string[]): Promise<Response> {
  const started = Date.now()
  const portals = strings(body.portals, 12)
  const customUrls = strings(body.customUrls, 12)

  try {
    const result = await findPersonaMentions({
      persona,
      aliases,
      portals,
      customUrls,
      state: text(body.state),
      city: text(body.city),
    })
    return json({ ms: Date.now() - started, persona, ...result })
  } catch (err) {
    return json(
      {
        error: `The scan did not finish: ${err instanceof Error ? err.message : String(err)}`,
        ms: Date.now() - started,
      },
      502,
    )
  }
}

async function analyse(body: Body, persona: string, aliases: string[]): Promise<Response> {
  const started = Date.now()
  const capped: string[] = []

  // Deduplicated before the cap is applied, so the same link sent twice does
  // not spend two of the four slots on it.
  const requested = [
    ...new Set(strings(body.urls, 50).filter((u) => /^https?:\/\//i.test(u))),
  ]
  if (!requested.length) {
    return json(
      {
        error:
          'No usable links in that list. Each entry must be a full article address starting with http:// or https://.',
      },
      400,
    )
  }

  const urls = requested.slice(0, MAX_ANALYSE)
  if (requested.length > urls.length) {
    capped.push(
      `Read the first ${MAX_ANALYSE} of ${requested.length} links. The other ${
        requested.length - urls.length
      } were not read at all. Send them as a second batch.`,
    )
  }

  const context = (Array.isArray(body.candidates) ? body.candidates : [])
    .slice(0, MAX_CONTEXT)
    .map(toCandidate)
    .filter((c): c is PersonaCandidate => c !== null)
  if (!context.length) {
    capped.push(
      'No scan was sent with these links, so each story was checked only against itself. Send the candidates from the scan to get the cross-masthead check.',
    )
  }

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), DEADLINE_MS)

  const mentions: PersonaMention[] = []
  const failures: { url: string; error: string }[] = []
  const unreached: string[] = []

  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      const url = urls[index]
      if (url === undefined) return

      // Checked before starting rather than only while running: beginning a
      // third story with two seconds left spends a fetch and two model calls on
      // a result nobody will receive.
      if (Date.now() - started >= DEADLINE_MS) {
        unreached.push(url)
        continue
      }

      try {
        mentions.push(
          await analysePersonaMention(url, persona, {
            signal: abort.signal,
            aliases,
            alsoScanned: context,
          }),
        )
      } catch (err) {
        failures.push({
          url,
          error: err instanceof Error ? err.message : 'That story could not be read.',
        })
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker))
  } finally {
    clearTimeout(timer)
  }

  // Back into request order — the workers finish out of order by design.
  mentions.sort((a, b) => urls.indexOf(a.url) - urls.indexOf(b.url))

  if (unreached.length) {
    capped.push(
      `${unreached.length} link${
        unreached.length === 1 ? ' was' : 's were'
      } not read before the function's time ran out. What came back is complete; send the rest as a second batch.`,
    )
  }

  return json({
    ms: Date.now() - started,
    persona,
    requested: requested.length,
    accepted: urls.length,
    capped,
    mentions,
    failures,
    unreachedUrls: unreached,
  })
}

export const config: Config = {
  path: '/api/persona',
  /**
   * A 'find' is eight page reads and an 'analyse' is up to eight model calls,
   * and the two share this ceiling because they share a path. Netlify evaluates
   * it before the function runs, so a blocked request costs no tokens at all.
   * Ten in two minutes covers an office working through a morning's coverage
   * and stops a script cold.
   */
  rateLimit: { windowLimit: 10, windowSize: 120, aggregateBy: ['ip'] },
}
