import type { Config, Context } from '@netlify/functions'
import { searchAcrossAllPlatforms } from './lib/multi-platform-search'

/**
 * A person's accounts across the platforms, from their name.
 *
 *   GET /api/multi-platform-search?q=d+k+aruna
 *   GET /api/multi-platform-search?q=aruna&person=D.%20K.%20Aruna
 *
 * Sits above /api/accounts/search rather than replacing it. That endpoint
 * answers one question — what does YouTube's index return for this name — and
 * answers it in one call. This one adds the public record, so the four
 * platforms no search index will answer for can still surface an account when
 * somebody has written one down, and it costs a Wikipedia search, a Wikidata
 * read and a live read of every candidate.
 *
 * `person` pins which article the record is read from, for the common case
 * where a name matches a constituency as well as its member. The unpinned
 * answer carries the whole candidate list under `people`, so the screen can
 * offer the choice rather than the caller having to guess at it.
 *
 * Every profile comes back with a `confidence` and a `note` saying what it is
 * evidence of, and the caller is expected to render both. A handle that only
 * Wikidata asserts and X would not serve must not appear beside a channel that
 * was actually fetched as though the two were equally known — that difference
 * is the entire reason this endpoint is allowed to name accounts at all.
 *
 * Finding nothing is an ordinary result, not an error, so it answers 200 with
 * empty lists and a coverage note per platform saying why.
 */

/**
 * `cache` is opt-in, and only a real answer opts in.
 *
 * Caching the answer is worth it: neither a person's name nor the accounts
 * recorded against it move between keystrokes, and the same query is re-sent
 * constantly as somebody edits the tail of it. Caching the FAILURE is not — the
 * fallback below is a 200 carrying an `error`, so a shared header put an
 * InnerTube or Wikipedia outage into the CDN and replayed it to everybody who
 * asked for the next five minutes, long after the outage had cleared.
 */
const json = (body: unknown, status = 200, cache = false): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache ? 'public, max-age=300' : 'no-store',
      'access-control-allow-origin': '*',
    },
  })

/** Long enough that "d" does not run a search, short enough for "K L". */
const MIN_QUERY = 3

export default async function handler(req: Request, _context: Context): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
      },
    })
  }

  if (req.method !== 'GET') return json({ error: 'Send a GET with ?q=' }, 405)

  const params = new URL(req.url).searchParams
  const query = params.get('q')?.trim() ?? ''
  if (query.length < MIN_QUERY) {
    return json({ query, profiles: [], people: [], coverage: [], checked: 0 })
  }

  const person = params.get('person')?.trim() ?? ''
  const started = Date.now()

  try {
    const result = await searchAcrossAllPlatforms(query, person ? { person } : {})
    return json({ ...result, ms: Date.now() - started }, 200, true)
  } catch (err) {
    // A search that will not answer must not stop somebody setting up a desk:
    // pasting the profile link is still open to them, and needs no index.
    console.log(
      `[signal] multi-platform-search failed for "${query}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return json({
      query,
      profiles: [],
      people: [],
      coverage: [],
      checked: 0,
      error: 'The account search is not answering just now. Paste a profile link instead.',
    })
  }
}

export const config: Config = {
  path: '/api/multi-platform-search',
  /**
   * Tighter than the /api/identity/search typeahead and looser than /api/rivals.
   * One call here is up to ten live profile reads, which is a cost to the
   * platforms being read as much as to us — Instagram starts answering 429 well
   * before a person could exhaust this — but no model runs, so a blocked
   * request costs a search that did not happen rather than tokens.
   */
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip'] },
}
