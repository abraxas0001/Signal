import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * CSRF protection for the OAuth round trip, and X's PKCE verifier.
 *
 * Self-verifying rather than stored: the state string carries its own HMAC,
 * signed with a secret only this server knows, so nothing needs a session
 * store to check it against later — `verifyState` just recomputes the
 * signature. `oauth-start.mts` also puts the same value in an httpOnly
 * cookie; the callback must see the identical string in both places before
 * it will proceed. That combination is what stops a login-CSRF attack: a
 * forged callback carrying an attacker's own valid `code` still needs the
 * victim's browser to be holding a cookie that names an attacker-chosen
 * state, which it never will unless the victim's own `/start` call set it.
 */

function secret(): string {
  const s = process.env['OAUTH_STATE_SECRET']
  if (!s) throw new Error('OAUTH_STATE_SECRET is not set.')
  return s
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

/** nonce.timestamp.platform.signature */
export function makeState(platform: string): string {
  const nonce = randomBytes(16).toString('base64url')
  const payload = `${nonce}.${Date.now()}.${platform}`
  return `${payload}.${sign(payload)}`
}

export function verifyState(platform: string, state: string, maxAgeMs = 600_000): boolean {
  const parts = state.split('.')
  if (parts.length !== 4) return false
  const [nonce, ts, plat, sig] = parts
  if (!nonce || !ts || !plat || !sig) return false
  const payload = `${nonce}.${ts}.${plat}`
  const expected = sign(payload)
  const a = Buffer.from(sig, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false
  if (plat !== platform) return false
  return Date.now() - Number(ts) < maxAgeMs
}

/**
 * X's PKCE code_verifier, derived deterministically from state.
 *
 * PKCE normally needs its own value carried across the redirect alongside
 * state; deriving it from state instead means there is nothing extra to put
 * in a cookie or to lose — `/start` and `/callback` each recompute the same
 * verifier from the same state string.
 */
export function codeVerifierFor(state: string): string {
  return createHmac('sha256', secret()).update(state).digest('base64url').slice(0, 128)
}
