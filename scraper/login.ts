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

const HOME: Record<Platform, string> = {
  Facebook: 'https://www.facebook.com/',
  Instagram: 'https://www.instagram.com/',
  LinkedIn: 'https://www.linkedin.com/feed/',
  'Twitter/X': 'https://x.com/home',
}

const ALIAS: Record<string, Platform> = {
  facebook: 'Facebook',
  fb: 'Facebook',
  instagram: 'Instagram',
  ig: 'Instagram',
  linkedin: 'LinkedIn',
  li: 'LinkedIn',
  x: 'Twitter/X',
  twitter: 'Twitter/X',
}

async function main() {
  const args = process.argv.slice(2).map((a) => a.toLowerCase())
  const wanted: Platform[] = args.length
    ? args.map((a) => ALIAS[a]).filter((p): p is Platform => Boolean(p))
    : [...PLATFORMS]

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

    console.log(`Sign in to ${platform} in the window that opened.`)
    console.log(`It advances by itself once you are through. Enter skips ahead.`)

    /**
     * Three ways out, whichever comes first.
     *
     * Polling is the one that matters: a person finishing a login should not
     * then have to come back to a terminal and press a key, and on a
     * checkpoint or a one-time code they often do not know when "done" is.
     * The Enter path stays for the case where detection is wrong and somebody
     * needs to move on regardless — and stdin has to be resumed explicitly or
     * the listener never fires and the prompt is a lie.
     */
    process.stdin.resume()

    const signedIn = await Promise.race([
      (async () => {
        for (let i = 0; i < 100; i++) {
          await page.waitForTimeout(3_000)
          const wall = await adapter
            .isLoginWall({ page, log: () => {}, pace: async () => {}, limit: 1 })
            .catch(() => true)
          if (!wall) return true
        }
        return false
      })(),
      new Promise<boolean>((resolve) => process.stdin.once('data', () => resolve(false))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5 * 60 * 1000)),
    ])

    process.stdin.pause()

    // Re-check even when the poll said yes: the page can change between the
    // last poll and here, and a wrong "signed in" here is a scrape that
    // silently returns nothing later.
    const still = await adapter
      .isLoginWall({ page, log: () => {}, pace: async () => {}, limit: 1 })
      .catch(() => true)

    if (!still) console.log(`signed in`)
    else if (signedIn) console.log(`signed in, then the page changed — check it`)
    else console.log(`still a login wall — not signed in`)

    await page.close().catch(() => {})
  }

  console.log('\nDone. The session is stored. Start the service with: npm run scraper\n')
  await closeContext()
  process.exit(0)
}

void main()
