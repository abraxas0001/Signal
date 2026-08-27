/**
 * What is actually on the page, right now, in the real session.
 *
 * Written because a login-wall check was guessed rather than measured and got
 * it backwards — it reported "already signed in" on a profile that had never
 * been signed in, which is the worst direction for that error to fail in: the
 * scrape then returns nothing and the dashboard reads it as a quiet account.
 *
 *   npm run scraper:probe -- x
 *   npm run scraper:probe -- facebook --url=https://www.facebook.com/someone
 *   npm run scraper:probe -- facebook --check='[data-pagelet="LeftRail"],a[href*="/messages"]'
 */

import { newPage, closeContext, goto } from './browser'
import { SIGNED_IN, WALL_URL } from './session'
import type { Platform } from './types'

const HOME: Record<Platform, string> = {
  Facebook: 'https://www.facebook.com/',
  Instagram: 'https://www.instagram.com/',
  LinkedIn: 'https://www.linkedin.com/feed/',
  'Twitter/X': 'https://x.com/home',
  // Public; there is nothing here to be signed in to.
  YouTube: 'https://www.youtube.com/',
}

const ALIAS: Record<string, Platform> = {
  facebook: 'Facebook', fb: 'Facebook',
  instagram: 'Instagram', ig: 'Instagram',
  linkedin: 'LinkedIn', li: 'LinkedIn',
  x: 'Twitter/X', twitter: 'Twitter/X',
  youtube: 'YouTube', yt: 'YouTube',
}

/**
 * Wall tells, for reporting only.
 *
 * The verdict itself comes from SIGNED_IN — imported from session.ts rather
 * than restated here, because a probe with its own copy of the markers stops
 * measuring the thing it is supposed to be measuring the moment the two drift.
 */
const WALL: Record<Platform, string[]> = {
  'Twitter/X': ['[data-testid="loginButton"]', '[data-testid="signupButton"]', 'input[autocomplete="username"]'],
  Facebook: ['input[name="email"]', 'input[name="pass"]', 'form[action*="login"]'],
  Instagram: ['input[name="username"]', 'input[name="password"]', 'a[href*="/accounts/login"]'],
  LinkedIn: ['input[name="session_key"]', '#username', '.authwall', 'a[href*="/uas/login"]'],
  YouTube: [],
}


async function main() {
  const args = process.argv.slice(2)
  const headed = args.includes('--headed')
  const raw = args.find((a) => !a.startsWith('--'))
  const platform = raw ? ALIAS[raw.toLowerCase()] : undefined

  if (!platform) {
    console.log('usage: npm run scraper:probe -- <facebook|instagram|linkedin|x|youtube> [--headed] [--url=URL] [--check=sel,sel]')
    process.exit(1)
  }

  /**
   * `--url=` probes an arbitrary page rather than the home feed.
   *
   * Added because a session marker that only exists on /home reports every
   * profile as a login wall — measured on Facebook, which signed in happily
   * and then called its own profile pages unreadable. The markers have to be
   * checked where the scraping actually happens.
   */
  const urlArg = args.find((a) => a.startsWith('--url='))?.slice('--url='.length)

  const page = await newPage(!headed)
  try {
    await goto(page, urlArg ?? HOME[platform])
    console.log(`\n${platform}`)
    console.log(`landed on : ${page.url()}`)
    console.log(`title     : ${await page.title()}`)
    console.log(`url says wall: ${WALL_URL[platform].test(page.url()) ? 'YES' : 'no'}`)

    const found = await page.evaluate(
      // No named inner functions in here: tsx compiles them through esbuild's
      // keepNames helper, which injects a `__name(...)` call that does not
      // exist in the page and fails the whole evaluate with a ReferenceError.
      (sel: { signedIn: string[]; wall: string[] }) => ({
        signedIn: sel.signedIn.filter((s) => {
          try { return Boolean(document.querySelector(s)) } catch { return false }
        }),
        wall: sel.wall.filter((s) => {
          try { return Boolean(document.querySelector(s)) } catch { return false }
        }),
        bodyChars: (document.body.textContent ?? '').length,
      }),
      { signedIn: SIGNED_IN[platform], wall: WALL[platform] },
    )

    console.log(`\nsigned-in markers found : ${found.signedIn.length ? found.signedIn.join('  ') : 'NONE'}`)
    console.log(`wall markers found      : ${found.wall.length ? found.wall.join('  ') : 'NONE'}`)
    console.log(`body text length        : ${found.bodyChars}`)

    /**
     * `--check=sel,sel` measures an explicit candidate list on this page.
     *
     * Meant to be run TWICE — once signed in, once against a throwaway
     * SCRAPER_PROFILE_DIR — keeping only the selectors that differ between the
     * two runs. Facebook's profile page renders ProfileActions, ProfileTabs,
     * ProfileTilesFeed_0 and TimelineFeedUnit_0 in BOTH states, so adopting any
     * of them as proof of a session would manufacture a false "signed in", and
     * the scrape would then return nothing while the dashboard reported a quiet
     * account. Measuring both states is the only way to tell a session marker
     * from ordinary page furniture.
     */
    const checkArg = args.find((a) => a.startsWith('--check='))?.slice('--check='.length)
    if (checkArg) {
      const wanted = checkArg.split(',').map((c) => c.trim()).filter(Boolean)
      const hits = await page.evaluate((ss: string[]) =>
        ss.map((s) => {
          try { return [s, Boolean(document.querySelector(s))] as [string, boolean] }
          catch { return [s, false] as [string, boolean] }
        }), wanted)
      console.log(`\ncandidate check:`)
      for (const [sel, hit] of hits) console.log(`  ${hit ? 'PRESENT' : 'absent '}  ${sel}`)
    }

    /**
     * Candidates, when the configured markers all missed.
     *
     * Finding a replacement by hand means opening devtools and guessing; this
     * lists what the page actually offers, so the next marker is chosen from
     * evidence rather than from memory of how the site looked last year.
     */
    if (found.signedIn.length === 0) {
      const candidates = await page
        .evaluate(() => {
          const seen = new Set<string>()
          for (const el of Array.from(document.querySelectorAll('[aria-label],[data-testid],[data-pagelet]'))) {
            const a = el.getAttribute('aria-label')
            const t = el.getAttribute('data-testid')
            const p = el.getAttribute('data-pagelet')
            if (t) seen.add(`[data-testid="${t}"]`)
            else if (p) seen.add(`[data-pagelet="${p}"]`)
            else if (a && a.length < 40) seen.add(`[aria-label="${a}"]`)
          }
          return [...seen].slice(0, 60)
        })
        .catch(() => [] as string[])
      console.log(`\nno marker matched. candidates present on this page:`)
      for (const c of candidates) console.log(`  ${c}`)
    }

    const verdict = found.signedIn.length > 0 && found.wall.length === 0
    console.log(`\nlooks signed in: ${verdict ? 'YES' : 'NO'}\n`)
  } finally {
    await page.close().catch(() => {})
    await closeContext()
  }
}

void main()
