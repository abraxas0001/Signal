import type { Config, Context } from '@netlify/functions'
import { deskConfigured, verifyToken } from './lib/desk-sync'
import {
  countToday,
  deriveJobs,
  readPolicy,
  writePolicy,
  type CollectorPolicy,
} from './lib/collector'
import { settingsKeyFrom, settingsKeyOk } from './lib/admin-gate'

/**
 * What the desk's collector should do next.
 *
 *   GET /api/collector-jobs
 *     Authorization: Bearer <desk token>
 *     → { policy, walkedToday, jobs, note, serverTime }
 *
 *   PUT /api/collector-jobs { policy: {...} }        (admin key)
 *     → { policy }
 *
 * The GET is the collector's whole world: it says whether to work at all
 * (enabled, paused), how hard (caps, gaps, hours), and what specifically is
 * stale enough to walk. The work list is derived from the desk's own synced
 * store, so an office manages its watch list in the app it already uses and
 * the collector simply follows.
 *
 * The PUT is deliberately admin-only in v1. The dials it turns decide how
 * loudly a real account behaves on real platforms; until the app grows a
 * proper owner-facing screen for it, changing them is an operator action.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export default async function handler(req: Request, _ctx: Context): Promise<Response> {
  if (!deskConfigured()) return json({ error: 'Desk sync is not configured on this deploy.' }, 503)

  const bearer = req.headers.get('authorization')
  const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : null
  const deskId = verifyToken(token)
  if (!deskId) return json({ error: 'Sign in again. The session is missing or expired.' }, 401)

  if (req.method === 'GET') {
    const policy = await readPolicy(deskId)
    const walkedToday = await countToday(deskId)
    if (!policy.enabled || policy.paused) {
      return json({
        policy,
        walkedToday,
        jobs: [],
        note: policy.paused
          ? 'Paused from the server. Nothing runs until it is lifted.'
          : 'The collector is not enabled for this desk.',
        serverTime: new Date().toISOString(),
      })
    }
    const room = Math.max(0, policy.dailyCap - walkedToday)
    // A poll hands out a modest slice, not the whole backlog: the collector
    // reports between slices, so a kill switch or a cap change lands within
    // one slice rather than after a night's queue.
    const { jobs, note } = await deriveJobs(deskId, policy, Math.min(room, 8))
    return json({ policy, walkedToday, jobs, note, serverTime: new Date().toISOString() })
  }

  if (req.method === 'PUT') {
    if (!settingsKeyOk(settingsKeyFrom(req))) {
      return json({ error: 'The policy dials are an operator action.' }, 403)
    }
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return json({ error: 'The body is not JSON.' }, 400)
    }
    const patch = (body['policy'] ?? {}) as Partial<CollectorPolicy>
    const ok = await writePolicy(deskId, patch)
    if (!ok) return json({ error: 'The policy could not be written.' }, 502)
    return json({ policy: await readPolicy(deskId) })
  }

  return json({ error: 'GET or PUT only.' }, 405)
}

export const config: Config = {
  path: '/api/collector-jobs',
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ['ip'] },
}
