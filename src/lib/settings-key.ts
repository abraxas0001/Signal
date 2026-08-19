/**
 * The admin key gating connected-account controls, held in plain localStorage.
 *
 * This is NOT vault-grade security and does not try to be — `vault.ts`
 * encrypts records naming private citizens and unproven allegations, which
 * deserves that weight. This is a bearer credential for an admin control
 * surface (who can trigger/view/disconnect an OAuth connection), and it is
 * kept as plainly as the constant it is compared against server-side
 * (`SETTINGS_ACCESS_KEY`) — see `netlify/functions/lib/admin-gate.ts` for
 * what leaking it can and cannot do.
 */

const KEY = 'signal:settingsKey'

export function getSettingsKey(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setSettingsKey(value: string): void {
  try {
    localStorage.setItem(KEY, value)
  } catch {
    /* private mode, or storage is full — the key just has to be re-typed next time */
  }
}

export function clearSettingsKey(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to remove */
  }
}
