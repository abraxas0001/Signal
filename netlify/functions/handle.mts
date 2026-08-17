import type { Config, Context } from '@netlify/functions'
import { parseHandle, readHandle, type HandleSummary } from './lib/handles'
import type { Platform } from '../../shared/taxonomy'

/**
 * GET /api/handle?q=<profile url or @handle>[&platform=YouTube]
 *
 * One account's recent activity, for the dashboard. Several handles can be
 * requested at once with repeated q parameters, which is what the comparison
 * view needs — reading four MLAs one at a time would take four round trips for
 * work the server can overlap.
 *
 * No model is called. A dashboard needs counts, and counts come from the
 * platforms directly; interpretation stays on the per-post path where the user
 * has asked for it and is waiting for it.
 */

/** Enough for a side-by-side of a few accounts, few enough to bound the work. */
const MAX_HANDLES = 6

export default async (req: Request, _ctx: Context): Promise<Response> => {
  const params = new URL(req.url).searchParams
  const queries = params.getAll('q').filter(Boolean)
  const platform = (params.get('platform') as Platform | null) ?? undefined

  if (!queries.length) {
    return Response.json(
      { error: 'Pass at least one q parameter: a profile URL or a handle.' },
      { status: 400 },
    )
  }
  if (queries.length > MAX_HANDLES) {
    return Response.json(
      { error: `Up to ${MAX_HANDLES} handles at a time.` },
      { status: 400 },
    )
  }

  const started = Date.now()

  const results = await Promise.all(
    queries.map(async (q): Promise<HandleSummary | { error: string; query: string }> => {
      const ref = parseHandle(q, platform)
      if (!ref) {
        return {
          query: q,
          error:
            'Could not tell which account that is. Paste the profile link, or pick a platform and give the handle.',
        }
      }
      try {
        return await readHandle(ref)
      } catch (err) {
        return {
          query: q,
          error: err instanceof Error ? err.message : 'That account could not be read.',
        }
      }
    }),
  )

  return Response.json(
    { ms: Date.now() - started, handles: results },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export const config: Config = {
  path: '/api/handle',
  // Each handle is one or two upstream requests; a burst from one client is
  // either a mistake or someone using this as a scraper.
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip'] },
}
