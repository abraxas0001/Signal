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
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Platform } from './types'

/** Where the logged-in session lives. Override with SCRAPER_PROFILE_DIR. */
export const PROFILE_DIR = resolve(
  process.env['SCRAPER_PROFILE_DIR'] ?? resolve(process.cwd(), '.scraper-profile'),
)

/**
 * A recent, real desktop Chrome UA.
 *
 * Not a disguise — the browser genuinely IS Chromium. Playwright's default UA
 * carries "HeadlessChrome", which several of these platforms treat as a bot
 * signal on sight, so this simply removes a tell that would otherwise
 * misrepresent an ordinary browser as something exotic.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

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

  ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    args: [
      // Removes the navigator.webdriver tell. We do not synthesise plugin or
      // language lists on top of it: modern fingerprinters cross-check those,
      // and a set of faked values is a stronger bot signal than the honest one.
      '--disable-blink-features=AutomationControlled',
    ],
  })
  ctx.setDefaultTimeout(30_000)
  ctx.setDefaultNavigationTimeout(45_000)
  return ctx
}

export async function closeContext(): Promise<void> {
  if (!ctx) return
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
