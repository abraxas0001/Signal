import type { Config, Context } from '@netlify/functions'
import { settingsKeyOk, settingsKeyFrom } from './lib/admin-gate'
import { makeState } from './lib/oauth-state'
import { youtubeAuthorizeUrl, youtubeOAuthCredentials } from './lib/youtube-oauth'
import { linkedinAuthorizeUrl, linkedinOAuthCredentials } from './lib/linkedin-oauth'
import { xAuthorizeUrl, xOAuthCredentials } from './lib/x-oauth'

/**
 * GET /api/oauth/:platform/start — begins the office's own connect flow.
 *
 * Gated by SETTINGS_ACCESS_KEY: this endpoint mints a redirect that, once
 * followed and approved, hands the office's real OAuth credentials to
 * `oauth-callback.mts`. That is a capability, not a data-quality knob, so an
 * absent key REFUSES rather than degrades — see admin-gate.ts.
 *
 * The callback itself needs no separate key check: it only accepts a request
 * carrying the httpOnly state cookie set here, which nobody can produce
 * without first passing this gate.
 */

const BUILDERS: Record<
  string,
  { authorizeUrl: (redirectUri: string, state: string) => string | null; configured: () => boolean }
> = {
  youtube: { authorizeUrl: youtubeAuthorizeUrl, configured: () => youtubeOAuthCredentials() !== null },
  linkedin: { authorizeUrl: linkedinAuthorizeUrl, configured: () => linkedinOAuthCredentials() !== null },
  x: { authorizeUrl: xAuthorizeUrl, configured: () => xOAuthCredentials() !== null },
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (!settingsKeyOk(settingsKeyFrom(req))) {
    const configured = Boolean(process.env['SETTINGS_ACCESS_KEY'])
    return Response.json(
      {
        error: configured
          ? 'That key is not correct.'
          : 'Connecting accounts is not enabled on this deployment. Set SETTINGS_ACCESS_KEY to turn it on.',
      },
      { status: 403 },
    )
  }

  const platform = ctx.params['platform'] ?? ''
  const builder = BUILDERS[platform]
  if (!builder) {
    return Response.json({ error: `Unknown platform "${platform}".` }, { status: 404 })
  }
  if (!builder.configured()) {
    return Response.json(
      { error: `${platform} OAuth is not configured on this deployment. Set its client id/secret first.` },
      { status: 400 },
    )
  }

  const url = new URL(req.url)
  const redirectUri = `${url.origin}/api/oauth/${platform}/callback`
  const state = makeState(platform)
  const authorizeUrl = builder.authorizeUrl(redirectUri, state)
  if (!authorizeUrl) {
    return Response.json({ error: `${platform} OAuth is not configured.` }, { status: 400 })
  }

  ctx.cookies.set({
    name: `signal_oauth_${platform}`,
    value: state,
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'Lax',
    path: `/api/oauth/${platform}`,
    maxAge: 600,
  })

  return Response.redirect(authorizeUrl, 302)
}

export const config: Config = {
  path: '/api/oauth/:platform/start',
}
