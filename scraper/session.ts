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
 * Selectors that appear only for a signed-in viewer.
 *
 * Two rules, both learned the hard way, both from measurement rather than
 * reasoning:
 *
 * 1. NEVER ENGLISH TEXT. The first cut listed things like
 *    `[aria-label="Your profile"]`. Measured against a real signed-in session
 *    whose Facebook renders in Hindi, the profile page carried
 *    `[aria-label="आपकी प्रोफ़ाइल"]` instead and every marker missed — a healthy
 *    session reported as a login wall. `data-pagelet`, `data-testid`, hrefs and
 *    class names are build constants and do not translate; aria-labels do.
 *
 * 2. IT MUST BE ABSENT WHEN SIGNED OUT, and that has to be checked, not
 *    assumed. Facebook's profile page renders `ProfileActions`, `ProfileTabs`,
 *    `ProfileTilesFeed_0` and `TimelineFeedUnit_0` to anonymous visitors as
 *    well — it serves a truncated but real timeline. Any of those as "proof of
 *    a session" would produce a false signed-in, and a false signed-in is the
 *    failure that matters: the scrape returns nothing and the dashboard renders
 *    that absence as a politician who has stopped posting.
 *
 * Every selector below was measured in both states, on the surface the scraper
 * actually visits — profile pages, not just the home feed, since isLoginWall
 * runs after navigating to a profile. Re-measure with:
 *
 *   npm run scraper:probe -- facebook --url=<profile> --check='sel,sel'
 *   SCRAPER_PROFILE_DIR=/tmp/throwaway  (same command again, for the control)
 */
export const SIGNED_IN: Record<Platform, string[]> = {
  'Twitter/X': [
    // data-testid values are build constants, identical in every language.
    '[data-testid="SideNav_AccountSwitcher_Button"]',
    '[data-testid="AppTabBar_Home_Link"]',
    '[data-testid="SideNav_NewTweet_Button"]',
    '[data-testid="AppTabBar_Profile_Link"]',
  ],
  Instagram: [
    // Both measured present on the home feed AND on a profile page while
    // signed in, and absent from the same profile page signed out. The old
    // `svg[aria-label="Home"]` and `[aria-label="New post"]` are gone: English
    // strings, and bare `svg[aria-label]` matches signed-out pages too.
    'a[href="/direct/inbox/"]',
    'a[href="/explore/"]',
  ],
  Facebook: [
    // ProfileTimeline is the discriminator on profile pages: present signed in,
    // absent signed out, while the neighbouring pagelets appear in both.
    '[data-pagelet="ProfileTimeline"]',
    'a[href*="/notifications"]',
    'a[href*="/friends"]',
    // Home feed only; kept so the feed surface has a marker of its own.
    '[data-pagelet="LeftRail"]',
  ],
  // YouTube needs no session, so it has no signed-in marker. The adapter's
  // isLoginWall answers false outright rather than consulting this.
  YouTube: [],
  LinkedIn: [
    // `.global-nav__me` and `.scaffold-finite-scroll` were measured ABSENT on a
    // signed-in feed — LinkedIn has renamed them since they were written. The
    // nav destinations survive renames and do not translate.
    'a[href*="/mynetwork"]',
    'a[href*="/messaging"]',
    'a[href*="/notifications"]',
  ],
}

/** Unambiguous wall tells. Cheap fast path before the DOM query. */
export const WALL_URL: Record<Platform, RegExp> = {
  // Never consulted: the YouTube adapter answers isLoginWall false outright,
  // because a public channel page has no wall to detect. `a^` matches nothing
  // by construction, which is the honest value for "this question does not
  // apply" — an empty pattern would match everything.
  YouTube: /a^/,
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
