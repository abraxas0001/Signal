import type { Config, Context } from '@netlify/functions'
import { verifyState } from './lib/oauth-state'
import { youtubeExchangeCode, youtubeWhoAmI, youtubeSaveConnection } from './lib/youtube-oauth'
import { linkedinExchangeCode, linkedinWhoAmI, linkedinSaveConnection } from './lib/linkedin-oauth'
import { xExchangeCode, xWhoAmI, xSaveConnection } from './lib/x-oauth'

/**
 * GET /api/oauth/:platform/callback — completes the office's own connect flow.
 *
 * No SETTINGS_ACCESS_KEY check here: this endpoint is protected transitively.
 * It only proceeds when the request carries the httpOnly `state` cookie
 * `oauth-start.mts` set, and that cookie only exists because a caller already
 * passed the gate at `/start`. A forged callback with a stolen or guessed
 * `code` still cannot supply a cookie it was never issued.
 *
 * Redirects back into the SPA with a query flag (`connected=<platform>` or
 * `connect_error=<platform>`) rather than rendering anything itself — the
 * same one-shot-query-param pattern `App.tsx` already uses for `?demo=1` and
 * `?sample=1`. The Settings screen reads it once and clears it.
 */

async function completeYouTube(code: string, redirectUri: string): Promise<string> {
  const token = await youtubeExchangeCode(code, redirectUri)
  const identity = await youtubeWhoAmI(token.accessToken)
  await youtubeSaveConnection({ ...token, identity })
  return identity.title || identity.channelId
}

async function completeLinkedIn(code: string, redirectUri: string): Promise<string> {
  const token = await linkedinExchangeCode(code, redirectUri)
  const identity = await linkedinWhoAmI(token.accessToken)
  await linkedinSaveConnection({ ...token, identity })
  return identity.name ?? identity.memberId
}

async function completeX(code: string, redirectUri: string, state: string): Promise<string> {
  const token = await xExchangeCode(code, redirectUri, state)
  const identity = await xWhoAmI(token.accessToken)
  await xSaveConnection({ ...token, identity })
  return identity.name ?? identity.username
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  const url = new URL(req.url)
  const platform = ctx.params['platform'] ?? ''
  const back = (query: string): Response => Response.redirect(`${url.origin}/${query}`, 302)

  if (!['youtube', 'linkedin', 'x'].includes(platform)) {
    return Response.json({ error: `Unknown platform "${platform}".` }, { status: 404 })
  }

  const cookieName = `signal_oauth_${platform}`
  const cookieState = ctx.cookies.get(cookieName)
  ctx.cookies.delete(cookieName) // one-time use either way

  const providerError = url.searchParams.get('error')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (providerError) {
    return back(`?settings=1&connect_error=${platform}`)
  }
  if (!code || !state || !cookieState || state !== cookieState || !verifyState(platform, state)) {
    return back(`?settings=1&connect_error=${platform}`)
  }

  const redirectUri = `${url.origin}/api/oauth/${platform}/callback`

  try {
    if (platform === 'youtube') await completeYouTube(code, redirectUri)
    else if (platform === 'linkedin') await completeLinkedIn(code, redirectUri)
    else await completeX(code, redirectUri, state)
  } catch {
    return back(`?settings=1&connect_error=${platform}`)
  }

  return back(`?settings=1&connected=${platform}`)
}

export const config: Config = {
  path: '/api/oauth/:platform/callback',
}
