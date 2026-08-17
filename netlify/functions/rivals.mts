import type { Config, Context } from '@netlify/functions'
import { parseHandle, readHandle } from './lib/handles'
import { findRivals } from './lib/rivals'

/**
 * GET /api/rivals?q=<profile url or handle>
 *
 * Who this account should be compared against, worked out rather than typed in.
 *
 * One model call, then a live check of every handle it proposed. The check is
 * not a formality: a model asked for a politician's handle will return a
 * plausible-looking one whether or not it exists, and presenting those as
 * rivals — with follower counts beside them — would be inventing opponents for
 * a real person. Only handles the platform actually served are returned.
 *
 * The result is meant to be cached by the caller. Discovery costs a model call;
 * the follow-up comparison of any one rival costs another, and should only be
 * paid when the user asks for that specific person.
 */
export default async (req: Request, _ctx: Context): Promise<Response> => {
  const q = new URL(req.url).searchParams.get('q')
  if (!q) {
    return Response.json({ error: 'Pass q: a profile URL or handle.' }, { status: 400 })
  }

  const ref = parseHandle(q)
  if (!ref) {
    return Response.json(
      { error: 'Could not tell which account that is. Paste the profile link.' },
      { status: 400 },
    )
  }

  const started = Date.now()
  try {
    const subject = await readHandle(ref)
    const result = await findRivals(subject)
    return Response.json(
      { ms: Date.now() - started, ...result },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not work out who to compare against.' },
      { status: 502 },
    )
  }
}

export const config: Config = {
  path: '/api/rivals',
  // A model call plus up to a dozen profile fetches. Expensive by design, so
  // the limit is tight and the client is expected to cache the answer.
  rateLimit: { windowLimit: 6, windowSize: 120, aggregateBy: ['ip'] },
}
