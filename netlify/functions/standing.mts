import type { Config, Context } from '@netlify/functions'
import { parseHandle } from './lib/handles'
import { readStanding } from './lib/standing'

/**
 * GET /api/standing?q=<profile url or handle>
 *
 * What the public thinks of an account, read from the comments on its recent
 * posts rather than from its follower count.
 *
 * Expensive on purpose: several live post fetches plus one model call. The
 * caller is expected to cache it — public opinion does not move between two
 * taps of a tab, and this is the number people will want to compare.
 */
export default async (req: Request, _ctx: Context): Promise<Response> => {
  const q = new URL(req.url).searchParams.get('q')
  if (!q) return Response.json({ error: 'Pass q: a profile URL or handle.' }, { status: 400 })

  const ref = parseHandle(q)
  if (!ref) {
    return Response.json({ error: 'Could not tell which account that is.' }, { status: 400 })
  }

  const started = Date.now()
  try {
    const standing = await readStanding(ref)
    return Response.json(
      { ms: Date.now() - started, ...standing },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not read public opinion.' },
      { status: 502 },
    )
  }
}

export const config: Config = {
  path: '/api/standing',
  rateLimit: { windowLimit: 6, windowSize: 120, aggregateBy: ['ip'] },
}
