/**
 * A copy of the signed-in state, kept outside the browser profile.
 *
 * Signing in is the most expensive thing anyone does with this tool. It is
 * manual by design — a person types a password, clears a one-time code, and
 * satisfies a checkpoint on four platforms — and it is the one step that cannot
 * be automated or retried unattended. So the cost of losing it is measured in a
 * person's afternoon, not in CPU.
 *
 * And it HAS been lost. A profile holding three live sessions was opened once
 * with a different browser binary and came back with an empty cookie jar. There
 * was no copy anywhere, so the only way back was signing in again from scratch.
 * This module exists so that never costs more than one command.
 *
 * WHY COOKIES AND NOT THE WHOLE PROFILE. A Chromium profile directory is
 * hundreds of megabytes of caches, service workers, GPU shaders and lock files,
 * almost none of which carries the session. The cookie jar does, it is a few
 * kilobytes, and it can be replayed into a fresh profile with `addCookies`. The
 * rest is disposable and rebuilds itself.
 *
 * THIS FILE HOLDS LIVE SESSIONS. Anyone who reads it can act as these accounts
 * without a password. It is gitignored alongside the profile itself, and it
 * should be treated exactly as the accounts are.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BrowserContext, Cookie } from 'playwright'
import { PLATFORMS, type Platform } from './types'

/** Where the copy lives. Override with SCRAPER_SESSION_FILE. */
export const SESSION_FILE = resolve(
  process.env['SCRAPER_SESSION_FILE'] ?? resolve(process.cwd(), '.scraper-session.json'),
)

interface SessionFile {
  savedAt: string
  cookies: Cookie[]
}

/**
 * Which domains belong to which platform.
 *
 * Only used for reporting — the backup itself is domain-agnostic and stores
 * whatever the jar holds. Suffix matching, because the session cookies sit on
 * apex domains while plenty of others sit on subdomains.
 */
const DOMAINS: Record<Platform, string[]> = {
  Facebook: ['facebook.com'],
  Instagram: ['instagram.com'],
  LinkedIn: ['linkedin.com'],
  'Twitter/X': ['x.com', 'twitter.com'],
  YouTube: ['youtube.com'],
}

/**
 * The cookies that actually prove a session, per platform.
 *
 * A platform sets dozens of cookies on a logged-out visitor too — consent
 * flags, A/B buckets, device ids — so counting cookies says nothing about
 * whether anyone is signed in. These are the specific ones that only exist for
 * an authenticated viewer, so their presence is the signal worth reporting and
 * their expiry is the date worth warning about.
 */
const AUTH_COOKIES: Record<Platform, string[]> = {
  Facebook: ['c_user', 'xs'],
  Instagram: ['sessionid', 'ds_user_id'],
  LinkedIn: ['li_at'],
  'Twitter/X': ['auth_token', 'ct0'],
  // None. YouTube is read signed-out, so there is no cookie whose absence would
  // mean anything — and reporting it as "not signed in" would send somebody to
  // fix a session that was never needed.
  YouTube: [],
}

function platformOf(domain: string): Platform | null {
  const d = domain.replace(/^\./, '')
  for (const p of PLATFORMS) {
    if (DOMAINS[p].some((suffix) => d === suffix || d.endsWith(`.${suffix}`))) return p
  }
  return null
}

/**
 * Save the current jar over the previous copy.
 *
 * Refuses to write an empty jar. Backing up nothing over a good copy would turn
 * this module from insurance into the thing that loses the sessions — and an
 * empty jar is exactly what a crashed or half-started browser reports, so it is
 * a likely input rather than a hypothetical one.
 */
export async function backupSession(ctx: BrowserContext): Promise<number> {
  const cookies = await ctx.cookies().catch(() => [] as Cookie[])
  if (cookies.length === 0) return 0

  const payload: SessionFile = { savedAt: new Date().toISOString(), cookies }
  try {
    writeFileSync(SESSION_FILE, JSON.stringify(payload, null, 2))
  } catch {
    // A failed backup must never take down a working scrape. The session is
    // still live in the profile; only the copy is missing.
    return 0
  }
  return cookies.length
}

/**
 * Replay the saved cookies into a profile that has none.
 *
 * Deliberately conditional. If the profile already carries cookies, they are
 * newer than the file by definition — the browser refreshes them on every use —
 * and overwriting live state with a snapshot would silently roll the session
 * back to whenever the copy was taken.
 *
 * Expired entries are dropped rather than replayed. `addCookies` rejects the
 * whole batch if any single member is malformed, so one stale cookie would cost
 * the entire restore.
 */
export async function restoreSessionIfEmpty(
  ctx: BrowserContext,
): Promise<'restored' | 'profile-already-has-cookies' | 'no-backup'> {
  const existing = await ctx.cookies().catch(() => [] as Cookie[])
  if (existing.length > 0) return 'profile-already-has-cookies'
  if (!existsSync(SESSION_FILE)) return 'no-backup'

  let saved: SessionFile
  try {
    saved = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as SessionFile
  } catch {
    return 'no-backup'
  }

  const now = Date.now() / 1000
  const usable = (saved.cookies ?? []).filter((c) => c.expires === -1 || c.expires > now)
  if (usable.length === 0) return 'no-backup'

  try {
    await ctx.addCookies(usable)
  } catch {
    return 'no-backup'
  }
  return 'restored'
}

export interface PlatformSession {
  platform: Platform
  signedIn: boolean
  /** Days until the earliest auth cookie lapses; null when none expire. */
  daysLeft: number | null
  cookieCount: number
}

/** What the saved copy holds, per platform, without launching a browser. */
export function readSessionReport(): { savedAt: string | null; platforms: PlatformSession[] } {
  if (!existsSync(SESSION_FILE)) {
    return {
      savedAt: null,
      platforms: PLATFORMS.map((p) => ({
        platform: p,
        signedIn: false,
        daysLeft: null,
        cookieCount: 0,
      })),
    }
  }

  let saved: SessionFile
  try {
    saved = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as SessionFile
  } catch {
    return { savedAt: null, platforms: [] }
  }

  const now = Date.now() / 1000
  const platforms = PLATFORMS.map((p) => {
    const mine = (saved.cookies ?? []).filter((c) => platformOf(c.domain) === p)
    const auth = mine.filter((c) => AUTH_COOKIES[p].includes(c.name))
    const live = auth.filter((c) => c.expires === -1 || c.expires > now)

    // The soonest lapse, because the session dies with its first expiry rather
    // than its last. Session cookies (-1) do not expire on a clock at all and
    // are excluded from the calculation instead of counting as "expires now".
    const dated = live.map((c) => c.expires).filter((e) => e > 0)
    const soonest = dated.length ? Math.min(...dated) : null

    return {
      platform: p,
      signedIn: live.length > 0,
      daysLeft: soonest === null ? null : Math.floor((soonest - now) / 86_400),
      cookieCount: mine.length,
    }
  })

  return { savedAt: saved.savedAt ?? null, platforms }
}
