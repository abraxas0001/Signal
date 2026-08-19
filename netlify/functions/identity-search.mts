import type { Config, Context } from '@netlify/functions'
import { searchPeople } from './lib/identity'

/**
 * Who do you mean?
 *
 *   GET /api/identity/search?q=aruna+mahabubnagar
 *
 * Split from /api/identity for the same reason /api/scan is split from
 * /api/grievance: the two cost completely different things and are called at
 * completely different rates. Resolving an identity reads up to three pages and
 * calls a model, and an office does it once. This reads one search index, calls
 * no model at all, and fires on almost every keystroke somebody types.
 *
 * Sharing a path would mean either rate-limiting the typeahead down to the
 * resolver's eight-per-two-minutes — which makes the search box feel broken
 * after four letters — or opening the resolver up to the typeahead's ceiling,
 * which is an invitation to burn the deployment's model budget. So: two paths,
 * two limits.
 *
 * Answers 200 with an empty list rather than a 404 when nothing matches.
 * Wikipedia's coverage of sitting MLAs is partial and of ward-level office
 * holders close to nil, so "no results" is an ordinary Tuesday, not a failure,
 * and the screen must offer to proceed with what was typed either way.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // A person's name does not change between two keystrokes, and the same
      // query is re-sent constantly as somebody edits the tail of it.
      'cache-control': 'public, max-age=300',
    },
  })

/** Long enough that "d" does not run a search, short enough for "K L". */
const MIN_QUERY = 3
const MAX_QUERY = 120

export default async function handler(req: Request, _context: Context): Promise<Response> {
  if (req.method !== 'GET') {
    return json({ error: 'Send a GET with ?q=' }, 405)
  }

  const raw = new URL(req.url).searchParams.get('q')?.trim() ?? ''
  if (raw.length < MIN_QUERY) {
    return json({ query: raw, candidates: [] })
  }

  const query = raw.slice(0, MAX_QUERY)
  const started = Date.now()

  try {
    const candidates = await searchPeople(query)
    return json({ query, candidates, ms: Date.now() - started })
  } catch (err) {
    // A search that fails must not stop setup. The screen falls back to "use
    // what I typed", which needs no index at all.
    console.log(
      `[signal] identity-search failed for "${query}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return json({ query, candidates: [], error: 'The name lookup is not answering just now.' })
  }
}

export const config: Config = {
  path: '/api/identity/search',
  /**
   * Generous, because this is a typeahead: one person setting up their desk
   * legitimately sends a dozen of these in a minute. It reads one public index
   * and calls no model, so the cost of a blocked request is a search that did
   * not happen rather than tokens that were spent.
   */
  rateLimit: { windowLimit: 90, windowSize: 60, aggregateBy: ['ip'] },
}
