/**
 * Is this page being shown to somebody who is signed in?
 *
 * ASK FOR PROOF OF A SESSION, do not try to recognise a wall. The first cut of
 * this did the opposite — each adapter listed the shapes a login screen takes
 * and called anything else "signed in" — and it was measured wrong on two of
 * four platforms:
 *
 *   X          `x.com/home` redirects to `x.com/` when signed out. No /login in
 *              the URL, no username input on the landing page, so every wall
 *              marker missed and it reported a never-signed-in profile as
 *              "already signed in".
 *   Instagram  the landing page holds no `input[name="username"]` either; the
 *              form is behind a button, so the same false negative.
 *   Facebook   email+pass inputs are present. The old check happened to work.
 *   LinkedIn   redirects to /login/ with title "LinkedIn Login". Also worked.
 *
 * The direction of that failure is what makes it serious. A false "wall" costs
 * one unnecessary sign-in prompt. A false "signed in" produces a scrape that
 * quietly returns nothing, and the dashboard renders that as a rival who has
 * stopped posting — an absence presented as a measurement, which is the one
 * failure this codebase refuses to ship.
 *
 * So the rule is inverted and biased: a page counts as usable only when it
 * carries something that ONLY EXISTS FOR A LOGGED-IN VIEWER. No evidence means
 * no session.
 */

import type { Page } from 'playwright'
import type { Platform } from './types'

/**
 * Selectors that appear only for a signed-in viewer, and — importantly —
 * appear on ordinary content pages too, not just the home feed. isLoginWall
 * runs after navigating to a profile, so a marker that only exists on /home
 * would report every profile as a wall.
 */
const SIGNED_IN: Record<Platform, string[]> = {
  'Twitter/X': [
    // The account switcher and composer live in the persistent left rail.
    '[data-testid="SideNav_AccountSwitcher_Button"]',
    '[data-testid="AppTabBar_Home_Link"]',
    '[data-testid="SideNav_NewTweet_Button"]',
    '[data-testid="AppTabBar_Profile_Link"]',
  ],
  Instagram: [
    // The DM inbox link is never rendered to a signed-out visitor.
    'a[href="/direct/inbox/"]',
    'a[href*="/accounts/edit"]',
    'svg[aria-label="Home"]',
    '[aria-label="New post"]',
  ],
  Facebook: [
    '[aria-label="Your profile"]',
    '[aria-label="Account"]',
    'div[role="banner"] a[href*="/me/"]',
    '[data-pagelet="LeftRail"]',
  ],
  LinkedIn: [
    '.global-nav__me',
    'button[aria-label*="Me"]',
    '.scaffold-finite-scroll',
    'a[href*="/in/"][data-control-name]',
  ],
}

/** Unambiguous wall tells. Cheap fast path before the DOM query. */
const WALL_URL: Record<Platform, RegExp> = {
  'Twitter/X': /\/i\/flow\/(login|signup)|\/login\b/i,
  Instagram: /\/accounts\/(login|signup)/i,
  Facebook: /\/login|\/checkpoint|\/recover/i,
  LinkedIn: /\/uas\/login|\/authwall|\/login\b|\/checkpoint/i,
}

/**
 * True when the page cannot be read because nobody is signed in.
 *
 * Errors resolve to `true` as well: if the check itself could not run, we do
 * not know there is a session, and the safe assumption is that there is not.
 */
export async function isLoggedOut(page: Page, platform: Platform): Promise<boolean> {
  if (WALL_URL[platform].test(page.url())) return true

  try {
    const signedIn = await page.evaluate((sels: string[]) => {
      for (const s of sels) {
        try {
          if (document.querySelector(s)) return true
        } catch {
          /* an invalid selector must not decide the verdict */
        }
      }
      return false
    }, SIGNED_IN[platform])

    return !signedIn
  } catch {
    return true
  }
}
