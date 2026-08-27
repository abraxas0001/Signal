/**
 * What is actually on the page, right now, in the real session.
 *
 * Written because a login-wall check was guessed rather than measured and got
 * it backwards — it reported "already signed in" on a profile that had never
 * been signed in, which is the worst direction for that error to fail in: the
 * scrape then returns nothing and the dashboard reads it as a quiet account.
 *
 *   npm run scraper:probe -- x
 *   npm run scraper:probe -- x --headed
 */

import { newPage, closeContext, goto } from './browser'
import type { Platform } from './types'

const HOME: Record<Platform, string> = {
  Facebook: 'https://www.facebook.com/',
  Instagram: 'https://www.instagram.com/',
  LinkedIn: 'https://www.linkedin.com/feed/',
  'Twitter/X': 'https://x.com/home',
}

const ALIAS: Record<string, Platform> = {
  facebook: 'Facebook', fb: 'Facebook',
  instagram: 'Instagram', ig: 'Instagram',
  linkedin: 'LinkedIn', li: 'LinkedIn',
  x: 'Twitter/X', twitter: 'Twitter/X',
}

/** Markers worth knowing about, per platform: signed-in tells and wall tells. */
const MARKERS: Record<Platform, { signedIn: string[]; wall: string[] }> = {
  'Twitter/X': {
    signedIn: [
      '[data-testid="SideNav_AccountSwitcher_Button"]',
      '[data-testid="AppTabBar_Home_Link"]',
      '[data-testid="SideNav_NewTweet_Button"]',
      '[data-testid="primaryColumn"]',
    ],
    wall: [
      '[data-testid="loginButton"]',
      '[data-testid="signupButton"]',
      'a[href="/login"]',
      'input[autocomplete="username"]',
    ],
  },
  Facebook: {
    signedIn: [
      '[aria-label="Your profile"]',
      '[data-pagelet="LeftRail"]',
      'div[role="navigation"] a[href*="/me/"]',
      '[aria-label="Account"]',
    ],
    wall: ['input[name="email"]', 'input[name="pass"]', 'form[action*="login"]'],
  },
  Instagram: {
    signedIn: [
      'a[href="/direct/inbox/"]',
      'svg[aria-label="Home"]',
      'a[href*="/accounts/edit"]',
      'nav a[href="/explore/"]',
    ],
    wall: ['input[name="username"]', 'input[name="password"]', 'a[href*="/accounts/login"]'],
  },
  LinkedIn: {
    signedIn: [
      '.global-nav__me',
      '[data-control-name="identity_welcome_message"]',
      'button[aria-label*="Me"]',
      '.scaffold-finite-scroll',
    ],
    wall: ['input[name="session_key"]', '#username', '.authwall', 'a[href*="/uas/login"]'],
  },
}

async function main() {
  const args = process.argv.slice(2)
  const headed = args.includes('--headed')
  const raw = args.find((a) => !a.startsWith('--'))
  const platform = raw ? ALIAS[raw.toLowerCase()] : undefined

  if (!platform) {
    console.log('usage: npm run scraper:probe -- <facebook|instagram|linkedin|x> [--headed]')
    process.exit(1)
  }

  const page = await newPage(!headed)
  try {
    await goto(page, HOME[platform])
    console.log(`\n${platform}`)
    console.log(`landed on : ${page.url()}`)
    console.log(`title     : ${await page.title()}`)

    const m = MARKERS[platform]
    const present = await page.evaluate(
      (sel: { signedIn: string[]; wall: string[] }) => ({
        signedIn: sel.signedIn.filter((s) => {
          try { return Boolean(document.querySelector(s)) } catch { return false }
        }),
        wall: sel.wall.filter((s) => {
          try { return Boolean(document.querySelector(s)) } catch { return false }
        }),
        // A crude but telling signal: the logged-out landing page is short.
        bodyChars: (document.body.textContent ?? '').length,
      }),
      m,
    )

    console.log(`\nsigned-in markers found : ${present.signedIn.length ? present.signedIn.join('  ') : 'NONE'}`)
    console.log(`wall markers found      : ${present.wall.length ? present.wall.join('  ') : 'NONE'}`)
    console.log(`body text length        : ${present.bodyChars}`)

    const verdict = present.signedIn.length > 0 && present.wall.length === 0
    console.log(`\nlooks signed in: ${verdict ? 'YES' : 'NO'}\n`)
  } finally {
    await page.close().catch(() => {})
    await closeContext()
  }
}

void main()
