/**
 * The browser, its session, and the pacing that keeps the session alive.
 *
 * ONE PERSISTENT PROFILE, not a fresh context per run. Playwright's default is
 * a clean incognito context, which is exactly wrong here: it throws away the
 * cookies every time, so every run would face a login wall. A persistent
 * profile directory means the office signs in ONCE, by hand, in a visible
 * window, and every later run reuses that session the way a returning visitor
 * would.
 *
 * The profile lives outside the repo and is gitignored. It contains real
 * session cookies for real accounts; committing it would be handing over the
 * accounts themselves.
 */

import { chromium, type BrowserContext, type Page } from 'playwright'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Platform } from './types'
import { backupSession, restoreSessionIfEmpty } from './session-store'

/** Where the logged-in session lives. Override with SCRAPER_PROFILE_DIR. */
export const PROFILE_DIR = resolve(
  process.env['SCRAPER_PROFILE_DIR'] ?? resolve(process.cwd(), '.scraper-profile'),
)

/**
 * Drive the REAL installed Google Chrome, not Playwright's bundled Chromium.
 *
 * X's login form was the thing that forced this. Username entered, Next
 * pressed, and the button span forever — no error, no advance, for minutes.
 * Facebook, Instagram and LinkedIn had all signed in through the same browser
 * without complaint, so the account was not the problem.
 *
 * Measured, the launch options were broadcasting two contradictions at once.
 * There used to be a hardcoded `Chrome/131.0.0.0` user agent here, with a
 * comment claiming it removed the "HeadlessChrome" tell. It did not. A
 * `userAgent` override rewrites the UA STRING ONLY; it never touches
 * `Sec-CH-UA` or `navigator.userAgentData`, so the browser went on announcing
 * itself in the client hints while the UA claimed to be something else:
 *
 *   user-agent : ...Chrome/131.0.0.0 Safari/537.36
 *   sec-ch-ua  : "Not=A?Brand";v="99", "HeadlessChrome";v="151", "Chromium";v="151"
 *
 * Version 131 against version 151, and the word HeadlessChrome still sitting
 * in the headers the override was supposed to hide. That is a far stronger bot
 * signal than the honest default would have been — the disguise was the tell.
 *
 * (That capture is headless. The sign-in flow runs headed, where the brand
 * reads "Chromium" rather than "HeadlessChrome" — but the 131-against-151
 * contradiction, which is the part no real browser can produce, is identical.)
 *
 * `channel: 'chrome'` fixes the brand at the source. Measured headed, which is
 * how the sign-in flow runs:
 *
 *   bundled  sec-ch-ua: "Chromium";v="151", "Not=A?Brand";v="99"
 *   chrome   sec-ch-ua: "Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"
 *
 * The second is what an ordinary Chrome install sends. The first says bare
 * Chromium, which almost nobody browses with. No UA override is set now: with
 * the real Chrome binary the user agent is already correct and consistent with
 * the hints, and the previous attempt to improve on it is what caused this.
 *
 * The bundled browser stays as a fallback so a machine without Chrome still
 * works — the profile format is shared, so nothing is lost by falling back.
 */
const CHANNEL = process.env['SCRAPER_BROWSER_CHANNEL'] ?? 'chrome'

/**
 * How long to wait between navigations, per platform.
 *
 * These are deliberately slow. The failure mode being avoided is not a 429 on
 * one request — it is the account being flagged, which is unrecoverable and
 * costs the office the login it depends on. Instagram is the strictest by a
 * wide margin and gets the longest gap.
 */
const PACE_MS: Record<Platform, number> = {
  Facebook: 6_000,
  Instagram: 12_000,
  LinkedIn: 8_000,
  'Twitter/X': 5_000,
  // No account is at risk here — the pages are public — so this is politeness
  // to a host rather than protection of a login.
  YouTube: 3_000,
}

/** Jitter so the gaps are not a machine-perfect metronome. */
function paced(platform: Platform): number {
  const base = PACE_MS[platform]
  return base + Math.floor(Math.random() * base * 0.4)
}

export function makePacer(platform: Platform): () => Promise<void> {
  let last = 0
  return async () => {
    const wait = last === 0 ? 0 : Math.max(0, paced(platform) - (Date.now() - last))
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
  }
}

let ctx: BrowserContext | null = null

/**
 * The shared browser context.
 *
 * `headless` is a parameter rather than a constant because the two modes are
 * for different jobs: the sign-in flow must be visible (a person types a
 * password and clears a checkpoint), and scraping runs afterwards without a
 * window. The same profile directory backs both.
 */
export async function getContext(headless = true): Promise<BrowserContext> {
  if (ctx) return ctx
  mkdirSync(PROFILE_DIR, { recursive: true })

  /**
   * Refuse to start while another instance holds this profile.
   *
   * A Chromium profile directory takes exactly one browser at a time. Launch a
   * second against a locked one and it does not error — it comes up on an
   * empty profile, so every platform reports "not signed in" and the operator
   * concludes their session expired. That cost an hour: the login helper was
   * still open waiting on one platform, and every test run beside it was
   * reading a blank profile and reporting logged-out on accounts that were
   * fine.
   *
   * Chromium leaves `SingletonLock` behind on a hard kill too, so a stale lock
   * is only treated as real when a Playwright browser is genuinely running —
   * hence the message names both possibilities rather than asserting one.
   */
  if (existsSync(join(PROFILE_DIR, 'SingletonLock'))) {
    throw new Error(
      'The scraper profile is already in use — most likely `npm run scraper:login` or another ' +
        '`npm run scraper` is still open. Close it and try again. A second browser on the same ' +
        'profile silently gets an EMPTY one, which looks exactly like being signed out.',
    )
  }

  /**
   * Refuse to open this profile with a different browser than built it.
   *
   * Learned by losing three live sessions. The profile was built by
   * Playwright's bundled Chromium and held signed-in Facebook, Instagram and
   * LinkedIn. It was opened once with real Google Chrome and came back empty —
   * measured afterwards at zero cookies under BOTH browsers, with the on-disk
   * store grown from 53KB to 73KB. Nothing warned; the only symptom was every
   * platform reporting a login wall.
   *
   * THE MECHANISM IS STILL UNIDENTIFIED, and the guard is deliberately kept on
   * the measurement rather than on an explanation. What used to be written here
   * — that Chrome 127+ App-Bound Encryption "discards a store it cannot
   * validate" — was a guess dressed up as a finding, and it is measurably
   * false: this profile's `Local State` has no `os_crypt.app_bound_encrypted_key`
   * at all, and its cookie store holds 128 `v10` (plain DPAPI) entries and zero
   * `v20` (app-bound) ones. ABE never engaged. Chromium only enables it for the
   * default user data directory, and Playwright always passes an explicit
   * `--user-data-dir`, so that path is unreachable from here.
   *
   * So: one binary switch under a live profile cost three sessions, and nobody
   * knows why yet. Signing in again is cheap next to losing them a second time,
   * which is reason enough for a hard stop. Do NOT infer from the above that a
   * same-browser run is safe by construction. Before any deliberate browser
   * change, copy the directory first and record the cookie row count on both
   * sides of it — that is the one measurement that would have settled this, and
   * it was never taken.
   */
  const marker = join(PROFILE_DIR, '.scraper-browser')
  const want = CHANNEL === 'bundled' || CHANNEL === '' ? 'bundled' : CHANNEL
  const had = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : ''

  if (had && had !== want) {
    throw new Error(
      `This profile was signed in using "${had}", but the scraper is set to use "${want}". ` +
        `Opening it with a different browser has emptied the stored sessions once already. ` +
        `Either set SCRAPER_BROWSER_CHANNEL=${had} to keep them, or delete ` +
        `${PROFILE_DIR} and sign in again with "${want}".`,
    )
  }

  const options = {
    headless,
    viewport: { width: 1440, height: 900 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    args: [
      // Removes the navigator.webdriver tell. We do not synthesise plugin or
      // language lists on top of it: modern fingerprinters cross-check those,
      // and a set of faked values is a stronger bot signal than the honest one
      // — which is exactly how the old user-agent override went wrong.
      '--disable-blink-features=AutomationControlled',
    ],
  }

  if (want === 'bundled') {
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, options)
    writeFileSync(marker, 'bundled')
  } else {
    try {
      ctx = await chromium.launchPersistentContext(PROFILE_DIR, { ...options, channel: want })
      writeFileSync(marker, want)
    } catch (err) {
      /**
       * Fall back ONLY onto a profile that has nothing to lose.
       *
       * The first version of this caught every launch failure, reopened the
       * profile with the other binary and rewrote the marker — which is
       * precisely the browser switch the guard above exists to prevent,
       * performed automatically and without asking. It also erased the guard's
       * own record of what built the profile, so every later run would hard
       * stop and blame the operator for a switch this code had made itself.
       *
       * An empty profile is a different matter: there is no session in it to
       * destroy, so falling back gets a machine without Chrome working instead
       * of failing outright.
       */
      if (had) {
        throw new Error(
          `This profile was signed in using "${had}", but "${want}" failed to launch ` +
            `(${(err as Error).message.split('\n')[0]}). Refusing to open it with a different ` +
            `browser — that has emptied the sessions once already. Fix the "${want}" install, ` +
            `or delete ${PROFILE_DIR} and sign in again.`,
        )
      }
      console.warn(
        `[scraper] channel "${want}" unavailable (${(err as Error).message.split('\n')[0]}) — ` +
          `falling back to Playwright's bundled Chromium on this empty profile. Sign-in flows ` +
          `that check for branded Chrome, X's in particular, may stall.`,
      )
      ctx = await chromium.launchPersistentContext(PROFILE_DIR, options)
      writeFileSync(marker, 'bundled')
    }
  }
  ctx.setDefaultTimeout(30_000)
  ctx.setDefaultNavigationTimeout(45_000)

  /**
   * Put the saved session back if this profile has none.
   *
   * Turns a wiped or freshly created profile into a working one without anybody
   * typing a password. It only fires when the jar is genuinely empty, so a live
   * profile is never rolled back to an older snapshot — see session-store.ts.
   */
  const restored = await restoreSessionIfEmpty(ctx)
  if (restored === 'restored') {
    console.log('[scraper] empty profile — restored the saved session from disk.')
  }

  return ctx
}

export async function closeContext(): Promise<void> {
  if (!ctx) return
  // Back up before closing, not after: the context is the only way to read the
  // jar, and every clean shutdown is a chance to keep the copy current. Cookies
  // are refreshed by the platforms on use, so the newest copy is the one taken
  // at the end of a successful run.
  await backupSession(ctx).catch(() => 0)
  await ctx.close().catch(() => {})
  ctx = null
}

/** A page on the shared context. Callers close it; the context stays open. */
export async function newPage(headless = true): Promise<Page> {
  const c = await getContext(headless)
  return c.newPage()
}

/**
 * Navigate and settle.
 *
 * `domcontentloaded` rather than `networkidle`: these feeds hold long-polling
 * sockets open indefinitely, so networkidle never fires and every navigation
 * would burn its full timeout before returning content that arrived seconds
 * earlier.
 */
export async function goto(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2_500)
}

/**
 * Scroll until the page stops growing, or the budget runs out.
 *
 * All four feeds are virtualised: the post list is not in the initial HTML and
 * arrives only as the viewport moves. Returns how many scrolls actually
 * produced new height, which the adapters use to tell "this profile has three
 * posts" from "the feed stopped loading".
 */
export async function autoScroll(
  page: Page,
  opts: { rounds?: number; pauseMs?: number } = {},
): Promise<number> {
  const rounds = opts.rounds ?? 12
  const pause = opts.pauseMs ?? 1_800
  let productive = 0
  let lastHeight = 0

  for (let i = 0; i < rounds; i++) {
    const height = await page.evaluate(() => document.body.scrollHeight).catch(() => 0)
    if (height > lastHeight) productive++
    else if (i > 1) break // two rounds with no growth: the feed is done
    lastHeight = height
    await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight)).catch(() => {})
    await page.waitForTimeout(pause)
  }
  return productive
}
