import type { Config, Context } from '@netlify/functions'
import { settingsKeyFrom, settingsKeyOk } from './lib/admin-gate'
import {
  deleteDesk,
  isDeskRelevant,
  listDesks,
  listFindings,
  readDesk,
  registryConfigured,
  upsertDesk,
  type DeskUpsert,
} from './lib/desk-registry'

/**
 * Opting a desk in to the server-side daily scan, and back out of it.
 *
 *   GET    /api/desk-registry                      — every registered desk
 *   GET    /api/desk-registry?deskId=x             — one desk
 *   GET    /api/desk-registry?deskId=x&findings=1  — what the daily scan filed
 *   POST   /api/desk-registry { deskId, name, ... } — register, or update
 *   DELETE /api/desk-registry?deskId=x             — opt out and erase
 *
 * THIS IS THE ONLY DOOR. `netlify/functions/lib/desk-registry.ts` explains at
 * length why a register exists at all when the rest of this product keeps a
 * desk's identity on the office's own device. The short version is that a scan
 * which runs while the office is closed has to run somewhere the office's
 * browser is not, and a server cannot read the papers for a member it has never
 * been told about.
 *
 * So the trade is made once, in the open, by an office that asks for it. There
 * is no path from opening the app to a row in the register. Nothing here runs
 * on a timer, nothing here is called on mount, and the example desk has no
 * business reaching it at all.
 *
 * EVERY METHOD IS GATED, not only the writes. The brief for this endpoint asked
 * for the writes to be gated and that is the floor rather than the ceiling: a
 * GET here returns a sitting member's name, seat, party and the exact list of
 * publications their office watches, which is precisely the material the rest of
 * the product refuses to put on a server without being asked. An ungated read
 * would hand it to anybody who guessed the path. The key is the same
 * SETTINGS_ACCESS_KEY the Settings screen already holds; see
 * `netlify/functions/lib/admin-gate.ts` for what leaking it can and cannot do.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export default async function handler(req: Request, _ctx: Context): Promise<Response> {
  if (!settingsKeyOk(settingsKeyFrom(req))) {
    return json(
      {
        error:
          'That key is missing or not correct. The desk register is gated because a row in it names a sitting member and the papers their office reads.',
      },
      403,
    )
  }

  /**
   * Say it once, plainly, before any method tries and fails in its own way.
   *
   * Without this an office turning the daily scan on would be told "Firestore
   * refused to register that desk" and would go looking for a permissions
   * problem in a project that was never configured in the first place.
   */
  if (!registryConfigured()) {
    return json(
      {
        error:
          'This deploy has no Firebase credentials, so there is no desk register and the daily scan cannot run. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, then redeploy.',
        configured: false,
      },
      503,
    )
  }

  const url = new URL(req.url)
  const deskId = url.searchParams.get('deskId')

  if (req.method === 'GET') return read(deskId, url)
  if (req.method === 'POST') return register(req)
  if (req.method === 'DELETE') return remove(deskId)

  return json({ error: 'Use GET to look, POST to register, or DELETE to opt out.' }, 405)
}

async function read(deskId: string | null, url: URL): Promise<Response> {
  if (!deskId) {
    const result = await listDesks()
    if (!result.ok) return json({ error: result.note }, 502)
    return json({
      desks: result.value,
      count: result.value.length,
      enabled: result.value.filter((d) => d.enabled).length,
    })
  }

  if (url.searchParams.get('findings') === '1') {
    const result = await listFindings(deskId, {
      since: url.searchParams.get('since'),
      relevantOnly: url.searchParams.get('relevantOnly') === '1',
    })
    if (!result.ok) return json({ error: result.note }, 502)
    /*
      `unjudged` is reported alongside the count rather than folded into it.

      A story nothing judged is not a story judged irrelevant. If the relevance
      layer was unreachable on the night a run happened, every story it filed
      carries no verdict, and an office told "6 stories" with no further word
      would reasonably read those six as six the server had vouched for.
    */
    return json({
      deskId,
      findings: result.value,
      count: result.value.length,
      relevant: result.value.filter((f) => isDeskRelevant(f.verdict)).length,
      unjudged: result.value.filter((f) => f.verdict === null).length,
    })
  }

  const result = await readDesk(deskId)
  if (!result.ok) return json({ error: result.note }, 502)
  if (!result.value) {
    return json(
      {
        deskId,
        registered: false,
        note: 'No desk is registered under that id, so the daily scan is not running for it.',
      },
      404,
    )
  }
  return json({ deskId, registered: true, desk: result.value })
}

async function register(req: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'That request was not valid JSON.' }, 400)
  }

  const input: DeskUpsert = {
    deskId: text(body['deskId']) ?? '',
    name: text(body['name']) ?? '',
    role: text(body['role']),
    constituency: text(body['constituency']),
    state: text(body['state']),
    party: text(body['party']),
    aliases: strings(body['aliases']),
    watchTerms: strings(body['watchTerms']),
    portals: strings(body['portals']),
    customPortalUrls: strings(body['customPortalUrls']),
    ...(typeof body['enabled'] === 'boolean' ? { enabled: body['enabled'] } : {}),
  }

  const result = await upsertDesk(input)
  // A rejected shape is the caller's mistake and a refused write is the
  // database's, and the two want different things done about them.
  if (!result.ok) {
    return json({ error: result.note }, result.note.startsWith('Firestore') ? 502 : 400)
  }

  return json({
    ok: true,
    desk: result.value,
    note: result.value.enabled
      ? 'This desk is registered and the daily scan will read for it. Its identity and watch list are now stored on the server; everything else stays on this device.'
      : 'This desk is registered but paused, so the daily scan will skip it until it is enabled.',
  })
}

async function remove(deskId: string | null): Promise<Response> {
  if (!deskId) return json({ error: 'Pass ?deskId= the desk to opt out.' }, 400)

  const result = await deleteDesk(deskId)
  if (!result.ok) return json({ error: result.note }, 502)

  return json({
    ok: true,
    deskId,
    existed: result.value.existed,
    note: result.value.existed
      ? 'The desk and everything the daily scan filed for it have been removed from the server. Nothing about it is stored here any more.'
      : 'No desk was registered under that id, so there was nothing on the server to remove.',
  })
}

export const config: Config = {
  path: '/api/desk-registry',
  method: ['GET', 'POST', 'DELETE'],
  /**
   * A handful of Firestore reads and writes, run when somebody opens Settings
   * and turns the daily scan on or off. Generous for an office, and low enough
   * that the gate is not the only thing standing between a leaked key and the
   * whole register being enumerated in a loop.
   */
  rateLimit: { windowLimit: 30, windowSize: 120, aggregateBy: ['ip'] },
}
