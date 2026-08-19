import { createHash } from 'node:crypto'
import { codeVerifierFor } from './oauth-state'
import { freshAccessToken, saveConnection, type Connection, type RefreshResult } from './connections'

/**
 * The office's own X identity, via OAuth 2.0 + PKCE — and, so far, only that.
 *
 * X's free API tier has no read access at all, even for your own account;
 * reading tweet metrics needs a paid tier, which is a cost decision for the
 * office to make, not something this code should assume. So this ships
 * identity confirmation only ("this is the office's X account") with a
 * narrow `users.read` scope. `readHandle`'s 'Twitter/X' case in handles.ts
 * uses this to confirm which account is connected; every other X handle
 * keeps today's public-stub fallback, since there is no public account
 * timeline reader for X in this codebase to fall back to.
 *
 * THE SHARPEST GOTCHA HERE: X rotates the refresh token on every single use.
 * The new one from each refresh response MUST unconditionally replace the
 * stored one — `connections.ts`'s `refreshToken ?? c.refreshToken` fallback
 * exists for platforms that don't always return one; here the response is
 * expected to always include one, and `xRefresh` throws if it doesn't rather
 * than silently keeping a value that is about to be invalidated.
 */

const AUTHORIZE_URL = 'https://twitter.com/i/oauth2/authorize'
const TOKEN_URL = 'https://api.twitter.com/2/oauth2/token'
const ME_URL = 'https://api.twitter.com/2/users/me'

/** offline.access is mandatory: without it X issues only a 2-hour token with no refresh path at all. */
const SCOPE = 'users.read offline.access'

export function xOAuthCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env['X_OAUTH_CLIENT_ID']?.trim()
  const clientSecret = process.env['X_OAUTH_CLIENT_SECRET']?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
}

export function xAuthorizeUrl(redirectUri: string, state: string): string | null {
  const creds = xOAuthCredentials()
  if (!creds) return null
  const verifier = codeVerifierFor(state)
  const challenge = createHash('sha256').update(verifier).digest('base64url')

  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', creds.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

interface XTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

export async function xExchangeCode(
  code: string,
  redirectUri: string,
  state: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number | null; scope: string | null }> {
  const creds = xOAuthCredentials()
  if (!creds) throw new Error('X OAuth is not configured.')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(creds.clientId, creds.clientSecret),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifierFor(state),
    }),
    signal: AbortSignal.timeout(9000),
  })
  const json = (await res.json()) as XTokenResponse
  if (json.error || !json.access_token || !json.refresh_token) {
    throw new Error(`X token exchange refused: ${json.error_description ?? json.error ?? 'no refresh token returned'}`)
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : null,
    scope: json.scope ?? null,
  }
}

async function xRefresh(c: Connection): Promise<RefreshResult> {
  const creds = xOAuthCredentials()
  if (!creds) throw new Error('X OAuth is not configured.')
  if (!c.refreshToken) throw new Error('No refresh token stored for this connection.')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(creds.clientId, creds.clientSecret),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: c.refreshToken,
    }),
    signal: AbortSignal.timeout(9000),
  })
  const json = (await res.json()) as XTokenResponse
  if (json.error || !json.access_token) {
    throw new Error(`X token refresh refused: ${json.error_description ?? json.error ?? 'unknown error'}`)
  }
  if (!json.refresh_token) {
    // X rotates on every use — a response with no new refresh token means the
    // old one is about to stop working. Surface this loudly rather than
    // quietly keep a value that the next refresh will fail with.
    throw new Error('X token refresh did not return a new refresh token; treat this connection as broken.')
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : null,
  }
}

interface XUserResponse {
  data?: { id?: string; username?: string; name?: string }
  errors?: Array<{ message?: string }>
}

export interface XIdentity {
  userId: string
  username: string
  name: string | null
}

export async function xWhoAmI(accessToken: string): Promise<XIdentity> {
  const res = await fetch(ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(9000),
  })
  const json = (await res.json()) as XUserResponse
  if (!json.data?.id || !json.data.username) {
    throw new Error(`X: this token is not authorised for any account. ${json.errors?.[0]?.message ?? ''}`.trim())
  }
  return { userId: json.data.id, username: json.data.username, name: json.data.name ?? null }
}

/** The wrapper `handles.ts` calls: refresh-checked identity, or null. */
export async function xFreshIdentity(): Promise<XIdentity | null> {
  const accessToken = await freshAccessToken('Twitter/X', xRefresh)
  if (!accessToken) return null
  try {
    return await xWhoAmI(accessToken)
  } catch {
    return null
  }
}

export async function xSaveConnection(input: {
  accessToken: string
  refreshToken: string
  expiresIn: number | null
  scope: string | null
  identity: XIdentity
}): Promise<void> {
  const now = new Date().toISOString()
  await saveConnection({
    platform: 'Twitter/X',
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresIn ? new Date(Date.now() + input.expiresIn * 1000).toISOString() : null,
    scope: input.scope,
    ownerId: input.identity.userId,
    ownerName: input.identity.name ?? input.identity.username,
    connectedAt: now,
    updatedAt: now,
    lastError: null,
    lastErrorAt: null,
  })
}
