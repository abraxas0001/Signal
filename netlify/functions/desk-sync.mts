import type { Config, Context } from '@netlify/functions'
import {
  deskConfigured,
  readDeskBundle,
  verifyToken,
  writeDeskBundle,
} from './lib/desk-sync'

/**
 * The desk's records, both directions.
 *
 *   GET /api/desk-sync
 *     → { rev, updatedAt, updatedBy, keys }
 *
 *   PUT /api/desk-sync { baseRev, keys, by? }
 *     → { rev }        or 409 with the current bundle when baseRev is stale
 *
 * Every call carries `authorization: Bearer <token>` from /api/desk-auth; the
 * token names the desk, so there is no desk id parameter to get wrong. The 409
 * is the contract, not an error state: whoever loses the race pulls what came
 * back, merges, and puts again from the new revision.
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
    const bundle = await readDeskBundle(deskId)
    return bundle.ok ? json(bundle.value) : json({ error: bundle.note }, bundle.status)
  }

  if (req.method === 'PUT') {
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return json({ error: 'The body is not JSON.' }, 400)
    }
    const baseRev = typeof body['baseRev'] === 'number' ? body['baseRev'] : NaN
    const rawKeys = body['keys']
    if (!Number.isFinite(baseRev) || typeof rawKeys !== 'object' || rawKeys === null) {
      return json({ error: 'A write needs baseRev and keys.' }, 400)
    }
    const keys: Record<string, string> = {}
    for (const [k, v] of Object.entries(rawKeys as Record<string, unknown>)) {
      if (typeof v === 'string' && k.length <= 200) keys[k] = v
    }
    const by = typeof body['by'] === 'string' && body['by'].trim() ? body['by'].trim() : 'member'

    const wrote = await writeDeskBundle(deskId, baseRev, keys, by)
    if (wrote.ok) return json(wrote.value)
    if (wrote.status !== 409) return json({ error: wrote.note }, wrote.status)

    // Hand the loser what it needs to merge, in the refusal itself.
    const current = await readDeskBundle(deskId)
    return current.ok
      ? json({ error: wrote.note, ...current.value }, 409)
      : json({ error: wrote.note }, 409)
  }

  return json({ error: 'GET or PUT only.' }, 405)
}

export const config: Config = { path: '/api/desk-sync' }
