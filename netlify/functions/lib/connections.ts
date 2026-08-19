import { getStore } from '@netlify/blobs'
import { decryptJson, encryptJson } from './crypto'

/**
 * Office-owned platform credentials, persisted across invocations.
 *
 * `meta-graph.ts` reads its page token from an env var the operator pastes in
 * once and never renews. Google, LinkedIn and X all expect the opposite:
 * a token that is refreshed on a rolling basis using a refresh token obtained
 * once through OAuth. Somewhere has to hold that refresh token between one
 * dashboard load and the next — this is that somewhere, since nothing else in
 * this codebase persists anything server-side.
 *
 * One Netlify Blob per platform, encrypted (see crypto.ts) before it is
 * written. `freshAccessToken` is the only thing callers need: it returns a
 * usable access token, refreshing first if the stored one has expired, and
 * returns null — never throws — on any absence or failure, so a caller in
 * handles.ts falls through to the existing public read exactly the way a
 * missing metaCredentials() does today.
 */

export type ConnectedPlatform = 'YouTube' | 'LinkedIn' | 'Twitter/X'

const SLUG: Record<ConnectedPlatform, string> = {
  YouTube: 'youtube',
  LinkedIn: 'linkedin',
  'Twitter/X': 'x',
}

export interface Connection {
  platform: ConnectedPlatform
  /** Never logged, never returned to a client. */
  accessToken: string
  /**
   * Null is a normal state, not a broken one: LinkedIn's default app tier
   * never issues one, and a connection with no refresh token simply expires
   * at expiresAt and asks to be reconnected rather than auto-renewing.
   */
  refreshToken: string | null
  expiresAt: string | null
  scope: string | null
  /** The platform's own id for the authorised account — what a handle is matched against. */
  ownerId: string
  ownerName: string | null
  connectedAt: string
  updatedAt: string
  /** Set when a refresh attempt fails, so the Settings screen can say why rather than silently going quiet. */
  lastError: string | null
  lastErrorAt: string | null
}

const store = () => getStore({ name: 'connections', consistency: 'strong' })

export async function getConnection(platform: ConnectedPlatform): Promise<Connection | null> {
  const raw = await store().get(SLUG[platform], { type: 'text' })
  if (!raw) return null
  try {
    return decryptJson<Connection>(raw)
  } catch {
    // Undecryptable — a rotated CONNECTIONS_ENCRYPTION_KEY, or a damaged blob.
    // Treat exactly like "not connected" rather than throwing the caller off
    // the public-read fallback path.
    return null
  }
}

export async function saveConnection(c: Connection): Promise<void> {
  await store().set(SLUG[c.platform], encryptJson(c))
}

export async function deleteConnection(platform: ConnectedPlatform): Promise<void> {
  await store().delete(SLUG[platform])
}

export type ConnectionStatus = Pick<
  Connection,
  'platform' | 'ownerName' | 'ownerId' | 'connectedAt' | 'expiresAt' | 'lastError' | 'lastErrorAt'
>

/** Status only — never a token. What the Settings screen and diag.mts read. */
export async function listConnections(): Promise<ConnectionStatus[]> {
  const platforms: ConnectedPlatform[] = ['YouTube', 'LinkedIn', 'Twitter/X']
  const found = await Promise.all(platforms.map((p) => getConnection(p)))
  return found
    .filter((c): c is Connection => c !== null)
    .map(({ platform, ownerName, ownerId, connectedAt, expiresAt, lastError, lastErrorAt }) => ({
      platform,
      ownerName,
      ownerId,
      connectedAt,
      expiresAt,
      lastError,
      lastErrorAt,
    }))
}

export interface RefreshResult {
  accessToken: string
  /** Present only when the provider issued a new one. Absent ≠ "clear the old one" — see the fallback below. */
  refreshToken?: string
  expiresIn: number | null
}

/**
 * The one thing platform readers call. Absent connection, or a refresh that
 * fails, both return null — never throw — so the caller always has a clean
 * fallback to the existing public path.
 */
export async function freshAccessToken(
  platform: ConnectedPlatform,
  refresh: (c: Connection) => Promise<RefreshResult>,
): Promise<string | null> {
  const c = await getConnection(platform)
  if (!c) return null

  // A little skew so a token that expires mid-request still gets refreshed
  // ahead of time rather than failing the call it was fetched for.
  const skewMs = 120_000
  const stillFresh = !c.expiresAt || new Date(c.expiresAt).getTime() - Date.now() > skewMs
  if (stillFresh) return c.accessToken
  if (!c.refreshToken) return null // expired, nothing to refresh with

  try {
    const r = await refresh(c)
    const next: Connection = {
      ...c,
      accessToken: r.accessToken,
      // Overwrite ONLY when a new one comes back: Google/LinkedIn usually
      // don't return one on refresh and the old refresh token stays valid;
      // X rotates on every use and its new value MUST replace the old one.
      refreshToken: r.refreshToken ?? c.refreshToken,
      expiresAt: r.expiresIn ? new Date(Date.now() + r.expiresIn * 1000).toISOString() : null,
      updatedAt: new Date().toISOString(),
      lastError: null,
      lastErrorAt: null,
    }
    await saveConnection(next)
    return next.accessToken
  } catch (err) {
    await saveConnection({
      ...c,
      lastError: err instanceof Error ? err.message : String(err),
      lastErrorAt: new Date().toISOString(),
    })
    return null
  }
}
