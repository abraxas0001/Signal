import type { Config, Context } from '@netlify/functions'
import { parseHandle } from './lib/handles'
import { readStanding, standingFromPosts } from './lib/standing'

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
  // POST carries post URLs the caller already has.
  //
  // Facebook, Instagram, LinkedIn and X publish no post list to a stranger, so
  // their accounts can never be crawled — but every post the user has analysed
  // is one we did read, comments and all. Sending those back lets a gated
  // account be scored on real comments instead of being permanently blank,
  // which is the difference between a comparison and a YouTube league table.
  if (req.method === 'POST') {
    let body: { urls?: unknown; platform?: unknown; handle?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return Response.json({ error: 'Malformed request body' }, { status: 400 })
    }
    const urls = Array.isArray(body.urls)
      ? body.urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
      : []
    if (!urls.length) {
      return Response.json(
        { error: 'No analysed posts for this account yet. Read a few of its posts first.' },
        { status: 400 },
      )
    }
    const started = Date.now()
    try {
      const standing = await standingFromPosts(urls, {
        platform: typeof body.platform === 'string' ? body.platform : 'unknown',
        handle: typeof body.handle === 'string' ? body.handle : 'account',
      })
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
