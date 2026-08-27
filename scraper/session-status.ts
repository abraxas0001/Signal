/**
 * What sessions are stored, and how long they have left.
 *
 *   npm run scraper:session
 *
 * Reads the saved copy on disk and launches nothing. That matters twice over:
 * the profile takes only one browser at a time, so a status check that opened
 * one could not run while the service or a sign-in was up — which is exactly
 * when somebody wants to ask. And a check that opens the profile is a check
 * that can damage it.
 *
 * The expiry column is the point. A session does not fail loudly when it
 * lapses; the scrape simply starts returning login walls, and unless somebody
 * is watching, the dashboard quietly stops updating. Knowing that Instagram has
 * eleven days left turns that into a calendar entry rather than an outage.
 */

import { existsSync } from 'node:fs'
import { readSessionReport, SESSION_FILE } from './session-store'
import { PROFILE_DIR } from './browser'

function main(): void {
  const { savedAt, platforms } = readSessionReport()

  console.log('')
  console.log(`profile : ${PROFILE_DIR}`)
  console.log(`backup  : ${SESSION_FILE}${existsSync(SESSION_FILE) ? '' : '  (none yet)'}`)
  console.log(`saved   : ${savedAt ? new Date(savedAt).toLocaleString() : 'never'}`)
  console.log('')

  if (platforms.length === 0) {
    console.log('The backup file could not be read. Sign in again to rebuild it.')
    return
  }

  for (const p of platforms) {
    /**
     * YouTube has no session, so "NOT signed in" would be a false alarm.
     *
     * It reads as a platform that has fallen out and needs attention, and it
     * would send somebody to `scraper:login` to fix something that was never
     * broken — the login helper does not even offer YouTube.
     */
    const noSession = p.platform === 'YouTube'
    const state = noSession ? 'public       ' : p.signedIn ? 'signed in ' : 'NOT signed in'
    // "—" rather than "0" when nothing has a clock on it: a session cookie with
    // no expiry is not a session expiring today, and printing zero would read
    // as exactly that.
    const left = noSession
      ? 'no sign-in needed'
      : p.daysLeft === null
        ? p.signedIn
          ? 'no fixed expiry'
          : '—'
        : `${p.daysLeft} days left`
    const warn = !noSession && p.daysLeft !== null && p.daysLeft <= 7 ? '  <-- renew soon' : ''
    console.log(`  ${p.platform.padEnd(11)} ${state.padEnd(14)} ${left.padEnd(16)}${warn}`)
  }

  console.log('')
  const out = platforms.filter((p) => !p.signedIn && p.platform !== 'YouTube').map((p) => p.platform)
  if (out.length === 0) {
    console.log('All four are stored. A wiped profile will be restored from the backup')
    console.log('automatically on the next run — no sign-in needed.')
  } else {
    console.log(`Sign in again for: ${out.join(', ')}`)
    console.log(`  npm run scraper:login -- ${out.map(alias).join(' ')}`)
  }
  console.log('')
}

/** The short name each platform answers to on the command line. */
function alias(platform: string): string {
  if (platform === 'Twitter/X') return 'x'
  return platform.toLowerCase()
}

main()
