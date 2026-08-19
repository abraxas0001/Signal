import type { Config, Context } from '@netlify/functions'
import { settingsKeyOk, settingsKeyFrom } from './lib/admin-gate'
import { listConnections, deleteConnection, type ConnectedPlatform } from './lib/connections'
import { metaCredentials, whoAmI } from './lib/meta-graph'

/**
 * GET  /api/connections            — status of every connected platform. Never a token.
 * DELETE /api/connections?platform=YouTube|LinkedIn|Twitter/X — disconnect one.
 */

const KNOWN: ConnectedPlatform[] = ['YouTube', 'LinkedIn', 'Twitter/X']

/**
 * Facebook/Instagram's status, shown read-only alongside the OAuth platforms
 * so the Settings screen is one place rather than two. Same check `diag.mts`
 * already runs, minus its five live-post probes — this only needs to know
 * whether the token still works, not fetch anything through it.
 */
async function metaStatus(): Promise<{
  configured: boolean
  page: string | null
  instagramLinked: boolean
  working: boolean
  why: string | null
}> {
  const creds = metaCredentials()
  if (!creds) return { configured: false, page: null, instagramLinked: false, working: false, why: null }
  try {
    const me = await whoAmI(creds)
    return { configured: true, page: me.name || null, instagramLinked: Boolean(creds.igUserId), working: true, why: null }
  } catch (err) {
    return {
      configured: true,
      page: null,
      instagramLinked: Boolean(creds.igUserId),
      working: false,
      why: err instanceof Error ? err.message : String(err),
    }
  }
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (!settingsKeyOk(settingsKeyFrom(req))) {
    return Response.json({ error: 'That key is missing or not correct.' }, { status: 403 })
  }

  if (req.method === 'GET') {
    const [connections, meta] = await Promise.all([listConnections(), metaStatus()])
    return Response.json({ connections, meta }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (req.method === 'DELETE') {
    const platform = new URL(req.url).searchParams.get('platform')
    const match = KNOWN.find((p) => p === platform)
    if (!match) {
      return Response.json(
        { error: `Pass ?platform= one of ${KNOWN.join(', ')}.` },
        { status: 400 },
      )
    }
    await deleteConnection(match)
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Use GET or DELETE.' }, { status: 405 })
}

export const config: Config = {
  path: '/api/connections',
}
