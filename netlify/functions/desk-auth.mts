import type { Config, Context } from '@netlify/functions'
import { settingsKeyFrom, settingsKeyOk } from './lib/admin-gate'
import {
  createDeskAccount,
  deskConfigured,
  normaliseDeskId,
  signInDesk,
} from './lib/desk-sync'

/**
 * The door to a handed-over desk.
 *
 *   POST /api/desk-auth { action: "signin", deskId, passphrase }
 *     → { token, name, expiresAt }   the credentials the member was handed
 *
 *   POST /api/desk-auth { action: "create", deskId, name, passphrase }
 *     → { deskId }                   ADMIN ONLY, gated by the settings key
 *
 * Sign-in is open — it is the member's own front door and the passphrase is
 * the gate. Creation is ours alone: a desk account is provisioned by the
 * office that will feed it, never self-served, so the settings key gates it
 * exactly as it gates the desk register.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export default async function handler(req: Request, _ctx: Context): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405)
  if (!deskConfigured()) {
    return json({ error: 'Desk sync is not configured on this deploy.' }, 503)
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'The body is not JSON.' }, 400)
  }

  const deskId = normaliseDeskId(body['deskId'])
  const passphrase = typeof body['passphrase'] === 'string' ? body['passphrase'] : ''
  if (!deskId) return json({ error: 'A desk id is required.' }, 400)

  if (body['action'] === 'create') {
    if (!settingsKeyOk(settingsKeyFrom(req))) {
      return json({ error: 'Creating a desk account needs the settings key.' }, 403)
    }
    const name = typeof body['name'] === 'string' ? body['name'] : deskId
    const made = await createDeskAccount(deskId, name, passphrase)
    return made.ok ? json({ deskId }) : json({ error: made.note }, made.status)
  }

  const opened = await signInDesk(deskId, passphrase)
  return opened.ok ? json(opened.value) : json({ error: opened.note }, opened.status)
}

export const config: Config = { path: '/api/desk-auth' }
