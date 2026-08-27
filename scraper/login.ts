/**
 * Sign in, by hand, once.
 *
 * Deliberately manual and deliberately visible. Automating the credential
 * entry would mean this file holds passwords, and it would still fail the
 * moment a platform asks for a one-time code or shows a checkpoint — which
 * they all do, on a new device, which is exactly what this profile is. So the
 * person signs in themselves in a real window; the profile directory keeps the
 * session afterwards and the scraper reuses it headlessly.
 *
 *   npm run scraper:login              opens all four
 *   npm run scraper:login -- instagram opens one
 */

import { getContext, closeContext, PROFILE_DIR } from './browser'
import { adapters } from './adapters'
import { PLATFORMS, type Platform } from './types'

/**
 * Where to look to find out whether a session already exists.
 *
 * The logged-in landing page for each platform, so an existing session is
 * detected without bouncing anybody through a form they do not need.
 */
const HOME: Record<SignInPlatform, string> = {
  Facebook: 'https://www.facebook.com/',
  Instagram: 'https://www.instagram.com/',
  LinkedIn: 'https://www.linkedin.com/feed/',
  'Twitter/X': 'https://x.com/home',
}

/**
 * Where to send somebody who is NOT signed in: the sign-in form itself.
 *
 * Not the landing page. Landing pages lead with "Create account", and an
 * operator who follows that lands in a signup flow — which is the most
 * heavily bot-defended surface these platforms have. X's signup silently
 * stops responding at its "Privacy preferences" step in an automated browser,
 * with a Continue button that simply does nothing, and no error to explain it.
 *
 * The account has to be created in an ordinary browser. This tool only signs
 * an existing one in, so it goes straight to the form that does that.
 */
const SIGN_IN: Record<SignInPlatform, string> = {
  Facebook: 'https://www.facebook.com/login/',
  Instagram: 'https://www.instagram.com/accounts/login/',
  LinkedIn: 'https://www.linkedin.com/login',
  'Twitter/X': 'https://x.com/i/flow/login',
}

/**
 * The platforms that HAVE a sign-in.
 *
 * YouTube is deliberately absent. Its channel pages are public, so there is
 * nothing to sign into and no session to keep — offering it here would open a
 * browser at a login form nobody needs to complete, and then report a failure
 * when they closed it.
 */
type SignInPlatform = Exclude<Platform, 'YouTube'>

const ALIAS: Record<string, SignInPlatform> = {
  facebook: 'Facebook',
  fb: 'Facebook',
  instagram: 'Instagram',
  ig: 'Instagram',
  linkedin: 'LinkedIn',
  li: 'LinkedIn',
  x: 'Twitter/X',
  twitter: 'Twitter/X',
}

/**
 * Ctrl+C during the wait is an ordinary way to use this, not a crash.
 *
 * Without this, interrupting mid-poll tears the browser down while a page call
 * is still in flight and Node prints an unhandled-rejection stack trace over
 * the instructions — which reads as the tool breaking at exactly the moment
 * somebody was already unsure whether it was working.
 */
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log('\nstopped. Nothing was saved for this platform.')
    void closeContext().finally(() => process.exit(0))
  })
}
process.on('unhandledRejection', () => {
  /* a teardown race after the context is gone; the message above already said it */
})

async function main() {
  const args = process.argv.slice(2).map((a) => a.toLowerCase())
  const wanted: SignInPlatform[] = args.length
    ? args.map((a) => ALIAS[a]).filter((p): p is SignInPlatform => Boolean(p))
    : PLATFORMS.filter((p): p is SignInPlatform => p !== 'YouTube')

  if (wanted.length === 0) {
    console.log('Unknown platform. Use: facebook | instagram | linkedin | x')
    process.exit(1)
  }

  console.log(`\nProfile directory: ${PROFILE_DIR}`)
  console.log('This holds real session cookies. It is gitignored — keep it that way.\n')

  // Headed: a person has to be able to type into this.
  const ctx = await getContext(false)

  for (const platform of wanted) {
    const page = await ctx.newPage()
    console.log(`\n── ${platform} ──`)
    await page.goto(HOME[platform], { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(3_000)

    const adapter = adapters[platform]
    const wall = await adapter
      .isLoginWall({ page, log: () => {}, pace: async () => {}, limit: 1 })
      .catch(() => true)

    if (!wall) {
      console.log(`already signed in`)
      await page.close().catch(() => {})
      continue
    }

    // Not signed in: go to the form, rather than leaving them on a landing
    // page whose most prominent button starts a signup that cannot finish here.
    await page.goto(SIGN_IN[platform], { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(2_000)

    console.log(`Sign in to ${platform} in the window that opened.`)
    console.log(`Use an account that already exists — creating one here will stall.`)
    console.log(`Waiting up to 10 minutes. This advances by itself. Ctrl+C to give up.`)
    process.stdout.write('  waiting')

    /**
     * Polling only, with no keyboard escape hatch.
     *
     * There used to be a "press Enter when you are done" arm racing the poll,
     * and under `npm run` it won every time: npm hands the script a stdin that
     * emits immediately, so the race resolved on the first tick, the window
     * closed, and the person was told they had not signed in before they had
     * been given the chance to try. A convenience that fires on its own is
     * worse than no convenience.
     *
     * Polling is also the better answer on its own merits. A one-time code or
     * a checkpoint leaves people unsure when "done" has happened; watching the
     * page for the session to appear does not need them to know.
     */
    const DEADLINE_MS = 10 * 60 * 1000
    const startedAt = Date.now()
    let signedIn = false

    while (Date.now() - startedAt < DEADLINE_MS) {
      await page.waitForTimeout(3_000)

      // A closed window is a deliberate abort, not a failure to detect.
      if (page.isClosed()) {
        console.log('\n  window closed')
        break
      }

      const wall = await adapter
        .isLoginWall({ page, log: () => {}, pace: async () => {}, limit: 1 })
        .catch(() => true)

      if (!wall) {
        signedIn = true
        break
      }
      process.stdout.write('.')
    }
    console.log('')

    if (!signedIn) {
      console.log(`still a login wall — not signed in`)
    } else {
      /**
       * Confirmed a second time, a few seconds later. The moment a login
       * completes is exactly when a platform is most likely to bounce through
       * an interstitial, and a "signed in" recorded on that flicker becomes a
       * scrape that silently returns nothing later.
       */
      await page.waitForTimeout(4_000)
      const still = await adapter
        .isLoginWall({ page, log: () => {}, pace: async () => {}, limit: 1 })
        .catch(() => true)
      console.log(still ? `signed in, then the page changed — check the window` : `signed in`)
    }

    await page.close().catch(() => {})
  }

  console.log('\nDone. The session is stored. Start the service with: npm run scraper\n')
  await closeContext()
  process.exit(0)
}

void main()
