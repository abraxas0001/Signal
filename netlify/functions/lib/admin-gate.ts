import { timingSafeEqual } from 'node:crypto'

/**
 * Guards the surfaces that can mint or reveal connected-account state.
 *
 * Every other credential in this codebase follows one rule: absent config
 * means the feature degrades to its public fallback (`metaCredentials()`
 * returns null, `resolveProviders()` returns an empty list, and so on). This
 * is a deliberate exception. What is being gated here is not a data-quality
 * knob — it is the ability to trigger an OAuth flow that mints long-lived
 * credentials for the office's real accounts, and to read who is currently
 * connected. An absent `SETTINGS_ACCESS_KEY` therefore REFUSES rather than
 * falls back to "anyone who finds the URL can use it".
 *
 * The realistic risk if this key leaks is bounded: a stranger can trigger,
 * view or disconnect a connection, but cannot complete one — the OAuth
 * consent screen itself still requires logging into the office's real
 * Google/LinkedIn/X account. Netlify's own site-wide password protection
 * (Site configuration → Visitor access) is a stronger, zero-code
 * alternative if the office wants more than this shared-secret convenience
 * gate.
 */
export function settingsKeyOk(provided: string | null): boolean {
  const expected = process.env['SETTINGS_ACCESS_KEY']
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function settingsKeyFrom(req: Request): string | null {
  const header = req.headers.get('x-settings-key')
  if (header) return header
  return new URL(req.url).searchParams.get('key')
}
