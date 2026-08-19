import type { Config, Context } from '@netlify/functions'
import { discoverNewsSources } from './lib/news-sources'

/**
 * POST /api/news-sources — which pages carry news about this person.
 *
 * Split from /api/identity because it runs at a different moment and costs a
 * different amount. Resolving who somebody is happens once, in front of a
 * person waiting for it. Finding the pages that cover them is a grounded search
 * plus up to ten live page fetches, and it is worth repeating occasionally as
 * publishers start or stop covering a person — an MP who joins a cabinet
 * acquires new tag pages within a week.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const text = (v: unknown, cap = 160): string | null => {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed ? trimmed.slice(0, cap) : null
}

export default async function handler(req: Request, _context: Context): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Send a POST with the person to find coverage for.' }, 405)
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'That request was not valid JSON.' }, 400)
  }

  const name = text(body['name'], 120)
  if (!name) return json({ error: 'Name the person to find coverage for.' }, 400)

  const started = Date.now()
  try {
    const result = await discoverNewsSources({
      name,
      role: text(body['role'], 120),
      constituency: text(body['constituency'], 120),
      state: text(body['state'], 80),
      party: text(body['party'], 120),
    })
    return json({ ...result, ms: Date.now() - started })
  } catch (err) {
    return json(
      {
        sources: [],
        stories: [],
        notes: [],
        searched: true,
        error: err instanceof Error ? err.message : 'The search did not finish.',
        ms: Date.now() - started,
      },
      502,
    )
  }
}

export const config: Config = {
  path: '/api/news-sources',
  /** A grounded search plus ten page reads. Deliberately occasional. */
  rateLimit: { windowLimit: 6, windowSize: 120, aggregateBy: ['ip'] },
}
