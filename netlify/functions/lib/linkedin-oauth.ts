import { freshAccessToken, saveConnection, type Connection, type RefreshResult } from './connections'

/**
 * The office's own LinkedIn identity, via OAuth — and, so far, only that.
 *
 * LinkedIn's self-serve "Sign In with LinkedIn using OpenID Connect" proves
 * WHO signed in and grants nothing else. Reading a Company Page's posts and
 * engagement needs LinkedIn's separate Community Management API, which
 * requires a verified Company Page and LinkedIn's own manual, discretionary
 * review — an external approval, not a code change. So this module ships the
 * identity-confirmed connection now (the Settings screen can say "this
 * Company Page belongs to the office"), and stops there. `readLinkedIn` in
 * `handles.ts` keeps today's honest "behind a login" message for posts until
 * (if) that approval lands — at which point the rich-read functions this file
 * is missing get added here, not rebuilt elsewhere.
 *
 * WHAT IT DOES NOT DO: nothing here reads a rival's Company Page. A token
 * authorises the person who signed in, nothing broader.
 */

const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization'
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken'
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo'

/** Widen via LINKEDIN_OAUTH_SCOPE once LinkedIn approves the office's app for post access. */
const DEFAULT_SCOPE = 'openid profile email'

export function linkedinOAuthCredentials(): { clientId: string; clientSecret: string; scope: string } | null {
  const clientId = process.env['LINKEDIN_OAUTH_CLIENT_ID']?.trim()
  const clientSecret = process.env['LINKEDIN_OAUTH_CLIENT_SECRET']?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret, scope: process.env['LINKEDIN_OAUTH_SCOPE']?.trim() || DEFAULT_SCOPE }
}

export function linkedinAuthorizeUrl(redirectUri: string, state: string): string | null {
  const creds = linkedinOAuthCredentials()
  if (!creds) return null
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', creds.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('scope', creds.scope)
  return url.toString()
}

interface LinkedInTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  refresh_token_expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

export async function linkedinExchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number | null; scope: string | null }> {
  const creds = linkedinOAuthCredentials()
  if (!creds) throw new Error('LinkedIn OAuth is not configured.')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
    signal: AbortSignal.timeout(9000),
  })
  const json = (await res.json()) as LinkedInTokenResponse
  if (json.error || !json.access_token) {
    throw new Error(`LinkedIn token exchange refused: ${json.error_description ?? json.error ?? 'unknown error'}`)
  }
  return {
    accessToken: json.access_token,
    // Optional and rare: only apps LinkedIn has separately enabled rotation
    // for ever receive one. Absence is the normal case, not an error.
    refreshToken: json.refresh_token ?? null,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : null,
    scope: json.scope ?? null,
  }
}

async function linkedinRefresh(c: Connection): Promise<RefreshResult> {
  const creds = linkedinOAuthCredentials()
  if (!creds) throw new Error('LinkedIn OAuth is not configured.')
  if (!c.refreshToken) throw new Error('No refresh token stored for this connection.')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: c.refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
    signal: AbortSignal.timeout(9000),
  })
  const json = (await res.json()) as LinkedInTokenResponse
  if (json.error || !json.access_token) {
    throw new Error(`LinkedIn token refresh refused: ${json.error_description ?? json.error ?? 'unknown error'}`)
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : null,
  }
}

interface LinkedInUserInfo {
  sub?: string
  name?: string
  email?: string
}

export interface LinkedInIdentity {
  memberId: string
  name: string | null
}

export async function linkedinWhoAmI(accessToken: string): Promise<LinkedInIdentity> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(9000),
  })
  const json = (await res.json()) as LinkedInUserInfo
  if (!json.sub) throw new Error('LinkedIn: this token is not authorised for any member.')
  return { memberId: json.sub, name: json.name ?? null }
}

/** The wrapper `handles.ts` calls: refresh-checked identity, or null. */
export async function linkedinFreshIdentity(): Promise<LinkedInIdentity | null> {
  const accessToken = await freshAccessToken('LinkedIn', linkedinRefresh)
  if (!accessToken) return null
  try {
    return await linkedinWhoAmI(accessToken)
  } catch {
    return null
  }
}

export async function linkedinSaveConnection(input: {
  accessToken: string
  refreshToken: string | null
  expiresIn: number | null
  scope: string | null
  identity: LinkedInIdentity
}): Promise<void> {
  const now = new Date().toISOString()
  await saveConnection({
    platform: 'LinkedIn',
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresIn ? new Date(Date.now() + input.expiresIn * 1000).toISOString() : null,
    scope: input.scope,
    ownerId: input.identity.memberId,
    ownerName: input.identity.name,
    connectedAt: now,
    updatedAt: now,
    lastError: null,
    lastErrorAt: null,
  })
}
