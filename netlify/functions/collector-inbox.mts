import type { Config, Context } from '@netlify/functions'
import { deskConfigured, verifyToken } from './lib/desk-sync'
import { ackInbox, listInbox, pushInbox, recordWalks, type InboxEntry } from './lib/collector'

/**
 * The store-and-forward mailbox between a desk's collector and its app.
 *
 *   POST /api/collector-inbox { entries: [...] }      (from the collector)
 *     → { stored, dropped }
 *   GET  /api/collector-inbox                          (from the app)
 *     → { entries }
 *   POST /api/collector-inbox { ack: [ids] }           (from the app)
 *     → { removed }
 *
 * Everything rides the desk token. The server stores readings and hands them
 * over; it NEVER merges them into the synced desk store, because whole-key
 * replacement with client-side merge is the desk-sync contract and only a
 * client running the app's own merge code can keep it. An entry's id is its
 * idempotency key: a collector retrying a report overwrites its own entry
 * rather than filing a duplicate, and the app dedupes snapshots per day on
 * top, because addSnapshot appends without looking.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const KINDS = new Set(['snapshot', 'comments', 'walk-failed'])

export default async function handler(req: Request, _ctx: Context): Promise<Response> {
  if (!deskConfigured()) return json({ error: 'Desk sync is not configured on this deploy.' }, 503)

  const bearer = req.headers.get('authorization')
  const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : null
  const deskId = verifyToken(token)
  if (!deskId) return json({ error: 'Sign in again. The session is missing or expired.' }, 401)

  if (req.method === 'GET') {
    return json({ entries: await listInbox(deskId) })
  }

  if (req.method === 'POST') {
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return json({ error: 'The body is not JSON.' }, 400)
    }

    if (Array.isArray(body['ack'])) {
      const ids = (body['ack'] as unknown[]).filter((x): x is string => typeof x === 'string')
      return json({ removed: await ackInbox(deskId, ids) })
    }

    if (Array.isArray(body['entries'])) {
      const entries: InboxEntry[] = []
      for (const raw of body['entries'] as unknown[]) {
        if (typeof raw !== 'object' || raw === null) continue
        const e = raw as Record<string, unknown>
        if (typeof e['id'] !== 'string' || !KINDS.has(String(e['kind']))) continue
        entries.push({
          id: e['id'],
          kind: e['kind'] as InboxEntry['kind'],
          handleId: String(e['handleId'] ?? ''),
          platform: String(e['platform'] ?? ''),
          url: typeof e['url'] === 'string' ? e['url'] : null,
          payload: e['payload'],
          readAt: typeof e['readAt'] === 'string' ? e['readAt'] : new Date().toISOString(),
          collector: String(e['collector'] ?? ''),
        })
      }
      const result = await pushInbox(deskId, entries)
      // The daily cap counts what was actually walked and reported, so a
      // collector that dies mid-slice never burns budget it did not spend.
      await recordWalks(deskId, result.stored)
      return json(result)
    }

    return json({ error: 'A POST carries entries or ack.' }, 400)
  }

  return json({ error: 'GET or POST only.' }, 405)
}

export const config: Config = {
  path: '/api/collector-inbox',
  rateLimit: { windowSize: 60, windowLimit: 60, aggregateBy: ['ip'] },
}
