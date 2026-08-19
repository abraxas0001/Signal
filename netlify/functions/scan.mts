import type { Config, Context } from '@netlify/functions'
import { scanPortals } from './lib/scan'

/**
 * Find today's stories on the mastheads a desk follows.
 *
 * Split from /api/grievance on purpose. Classifying is two model calls per
 * story and a batch of ten already fills the window; finding is a handful of
 * page reads and no model call at all. Keeping them apart means the operator
 * sees what was found in a couple of seconds and decides what to spend the
 * model on, instead of waiting on a request that does both and times out.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

interface Body {
  portals?: unknown
  customUrls?: unknown
  city?: unknown
  tags?: unknown
  broadTags?: unknown
}

const strings = (v: unknown, cap: number): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, cap)
    : []

export default async function handler(req: Request, _context: Context): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Send a POST with the mastheads to read.' }, 405)
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json({ error: 'That request was not valid JSON.' }, 400)
  }

  const portals = strings(body.portals, 12)
  const customUrls = strings(body.customUrls, 12)
  const tags = strings(body.tags, 30)
  // Words too wide to stand alone. See ScanInput.broadTags.
  const broadTags = strings(body.broadTags, 8)
  const city = typeof body.city === 'string' && body.city.trim() ? body.city.trim() : null

  if (portals.length === 0 && customUrls.length === 0) {
    return json(
      { error: 'Choose at least one masthead, or add the address of one, before scanning.' },
      400,
    )
  }

  const started = Date.now()
  try {
    const result = await scanPortals({ portals, customUrls, city, tags, broadTags })
    return json({ ...result, ms: Date.now() - started })
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

export const config: Config = {
  path: '/api/scan',
  /**
   * Reading eight index pages is cheap but not instant, and each one is a live
   * request to somebody else's server. This is generous for an office scanning
   * its mastheads a few times a morning and stops a script hammering them.
   */
  rateLimit: { windowLimit: 20, windowSize: 120, aggregateBy: ['ip'] },
}
