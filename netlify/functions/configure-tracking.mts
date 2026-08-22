import type { Config, Context } from '@netlify/functions'
import type { Platform } from '../../shared/taxonomy'
import { PLATFORMS } from '../../shared/taxonomy'
import { settingsKeyFrom, settingsKeyOk } from './lib/admin-gate'
import { firestoreConfigured } from './lib/firebase'
import {
  addCompetitorProfile,
  getTrackedProfiles,
  profileIdFor,
  removeCompetitorProfile,
  setProfileEnabled,
  type Category,
} from './lib/competitor-tracker'

/**
 * The tracked-account list, for operators rather than for the dashboard.
 *
 *   GET    /api/configure-tracking?category=…   list what is registered
 *   POST   /api/configure-tracking              { action: 'add'|'remove'|'enable'|'disable', … }
 *
 * The dashboard does not use this — it registers its accounts as part of the
 * sync request, because its list lives on the device (see `registerProfiles`).
 * This exists for the other callers: a setup script, a scheduled job, and an
 * operator clearing out an account that no longer matters.
 *
 * GATED, NOT "BASIC AUTH CHECK". The first version accepted any request whose
 * Authorization header merely began with "Bearer ", which is not a check —
 * `Authorization: Bearer x` passed it. It gates writes to shared storage and a
 * delete that removes an account's whole sync history, so it uses the same
 * shared-secret gate as the other operator surfaces (`lib/admin-gate.ts`),
 * which refuses outright when no key is configured rather than falling open.
 */

export const config: Config = {
  path: '/api/configure-tracking',
  method: ['GET', 'POST', 'OPTIONS'],
}

const isPlatform = (v: unknown): v is Platform =>
  typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v)

const CATEGORIES: Category[] = ['self', 'competitor', 'influencer']
const isCategory = (v: unknown): v is Category =>
  typeof v === 'string' && (CATEGORIES as string[]).includes(v)

/**
 * The canonical profile URL for a handle.
 *
 * Only for the platforms whose profile URL is genuinely a template. LinkedIn is
 * the reason this returns null rather than guessing: `/in/<handle>` is a person
 * and `/company/<handle>` is an organisation, the handle alone does not say
 * which, and a wrong one is a 404 that the sync would faithfully record as "this
 * account publishes nothing". Where the shape is not knowable, the caller has
 * to supply the URL it already has.
 */
function profileUrlFor(platform: Platform, handle: string): string | null {
  switch (platform) {
    case 'YouTube':
      return `https://www.youtube.com/@${handle}`
    case 'Facebook':
      return `https://www.facebook.com/${handle}`
    case 'Twitter/X':
      return `https://x.com/${handle}`
    case 'Instagram':
      return `https://www.instagram.com/${handle}/`
    case 'Threads':
      return `https://www.threads.net/@${handle}`
    case 'Bluesky':
      return `https://bsky.app/profile/${handle}`
    case 'Mastodon':
      // A Mastodon handle is user@instance; without the instance there is no URL.
      return handle.includes('@') ? `https://${handle.split('@').pop()}/@${handle.split('@')[0]}` : null
    default:
      return null
  }
}

interface ConfigureRequest {
  action?: unknown
  platform?: unknown
  handle?: unknown
  name?: unknown
  profileUrl?: unknown
  category?: unknown
}

function badRequest(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 })
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })

  if (!settingsKeyOk(settingsKeyFrom(req))) {
    return Response.json({ error: 'That key is missing or not correct.' }, { status: 403 })
  }

  if (!firestoreConfigured()) {
    return Response.json(
      {
        ok: false,
        error:
          'This deploy has no Firebase credentials, so there is no tracked list to configure. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.',
      },
      { status: 503 },
    )
  }

  try {
    if (req.method === 'GET') {
      const raw = new URL(req.url).searchParams.get('category')
      const profiles = await getTrackedProfiles(isCategory(raw) ? raw : undefined)

      const byCategory: Record<string, typeof profiles> = {}
      for (const profile of profiles) {
        ;(byCategory[profile.category] ??= []).push(profile)
      }

      return Response.json({ ok: true, total: profiles.length, byCategory, profiles })
    }

    if (req.method !== 'POST') return Response.json({ error: 'Use GET or POST.' }, { status: 405 })

    let body: ConfigureRequest
    try {
      body = (await req.json()) as ConfigureRequest
    } catch {
      return badRequest('Malformed request body.')
    }

    const handle = typeof body.handle === 'string' ? body.handle.trim().replace(/^@/, '') : ''
    if (!isPlatform(body.platform)) {
      return badRequest(`Unknown platform. Use one of: ${PLATFORMS.join(', ')}.`)
    }
    if (!handle) return badRequest('A handle is required.')
    const platform = body.platform

    switch (body.action) {
      case 'add': {
        if (!isCategory(body.category)) {
          return badRequest("A category is required: 'self', 'competitor' or 'influencer'.")
        }
        const profileUrl =
          (typeof body.profileUrl === 'string' && body.profileUrl.trim()) ||
          profileUrlFor(platform, handle)
        if (!profileUrl) {
          return badRequest(
            `A profileUrl is required for ${platform} — its profile URL cannot be derived from a handle alone.`,
          )
        }

        const id = await addCompetitorProfile({
          platform,
          handle,
          name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : handle,
          profileUrl,
          category: body.category,
        })
        return Response.json({ ok: true, id, message: `Now tracking ${platform} ${handle}.` }, { status: 201 })
      }

      case 'remove': {
        const id = profileIdFor(platform, handle)
        await removeCompetitorProfile(id)
        return Response.json({
          ok: true,
          id,
          message: `Removed ${platform} ${handle}, and every post and snapshot stored under it.`,
        })
      }

      case 'enable':
      case 'disable': {
        const id = profileIdFor(platform, handle)
        await setProfileEnabled(id, body.action === 'enable')
        return Response.json({ ok: true, id, enabled: body.action === 'enable' })
      }

      default:
        return badRequest("Unknown action. Use 'add', 'remove', 'enable' or 'disable'.")
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.log(`[signal] configure-tracking failed: ${message}`)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
