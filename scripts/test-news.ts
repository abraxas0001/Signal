/**
 * News article body extraction.
 *
 * This exists because of a bug that looked exactly like success. On a Telugu
 * news page we returned the right headline, the right date, the right language
 * and six thousand characters of Telugu — and the six thousand characters were
 * the sidebar's list of unrelated headlines, not the story. Nothing threw, no
 * confidence dropped, and the analysis downstream was confidently about the
 * wrong article.
 *
 * A length check alone would not have caught it, so each case asserts three
 * things: that we got a substantial body, that it does not open with the
 * furniture a rail is made of, and that it contains a phrase only the real
 * article contains.
 *
 *   npx tsx scripts/test-news.ts
 *   npx tsx scripts/test-news.ts <url>     # ad-hoc, prints what we extracted
 *
 * Article URLs age out — a publisher moves a story behind a wall or renumbers
 * it. A fetch failure here is reported as SKIP rather than FAIL, because the
 * test is about our parsing, not their uptime. Replace stale URLs when a whole
 * publisher starts skipping.
 */

import { fetchText } from '../netlify/functions/lib/fetcher'
import { parseMetadata } from '../netlify/functions/lib/metadata'

interface Case {
  label: string
  url: string
  /** A phrase that appears in the real article and nowhere in the furniture. */
  contains: string
  minChars: number
}

/**
 * The assertion that actually holds the line.
 *
 * Naming today's sidebar headlines as forbidden strings rots within a day, and
 * a "contains" check passes by accident because a rail of district news
 * mentions the district. But a sidebar is the *same* on every page of a site,
 * and two different stories are not — so if two articles come back with the
 * same opening, we captured the furniture, whatever it happens to say today.
 *
 * This is the check that caught the equivalent bug on YouTube, where two
 * channels reported an identical subscriber count.
 */
function assertDistinct(results: { label: string; text: string }[]): string[] {
  const problems: string[] = []
  const byOpening = new Map<string, string[]>()
  for (const r of results) {
    if (r.text.length < 60) continue
    const key = r.text.slice(0, 100)
    byOpening.set(key, [...(byOpening.get(key) ?? []), r.label])
  }
  for (const [, labels] of byOpening) {
    if (labels.length > 1) {
      problems.push(`identical body returned for: ${labels.join(' + ')}`)
    }
  }
  return problems
}

const CASES: Case[] = [
  {
    label: 'Eenadu — districts, short brief',
    url: 'https://www.eenadu.net/telugu-news/districts/prakasam-mla-submits-representation-to-speaker-seeking-to-change-the-name-of-markapuram-district/8/126147275',
    contains: 'మార్కాపురం',
    minChars: 200,
  },
  {
    label: 'Eenadu — state desk, full story',
    url: 'https://www.eenadu.net/telugu-news/andhra-pradesh/cm-chandra-babu-reviews-the-disappearance-of-fisher-men/1701/126147859',
    contains: 'అమరావతి',
    minChars: 900,
  },
  {
    label: 'Eenadu — district crime',
    url: 'https://www.eenadu.net/telugu-news/districts/anantapur-goan-liquor-in-tadipatri/1/126147864',
    contains: 'తాడిపత్రి',
    minChars: 700,
  },
  {
    label: 'Sakshi — business',
    url: 'https://www.sakshi.com/telugu-news/business/rs-55-rs-18000-how-minimum-basic-pay-evolved-8th-pay-commission-2874917',
    contains: 'వేతన',
    minChars: 900,
  },
  {
    label: 'Sakshi — features',
    url: 'https://www.sakshi.com/telugu-news/family/how-fitness-influencer-lost-38-kg-one-meal-day-diet-2876014',
    contains: 'ఆహారం',
    minChars: 900,
  },
]

/**
 * Openings that prove we captured navigation instead of prose. These are the
 * literal strings the rails on these sites lead with.
 */
const FURNITURE = [
  'latest news',
  'trending',
  'breaking news',
  'most read',
  'top stories',
  'ee font size',
  'జియో ప్రైమ్',
]

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`

async function bodyOf(url: string): Promise<{ text: string; title: string | null }> {
  const page = await fetchText(url, { agent: 'browser', timeout: 12_000 })
  if (!page.ok || !page.body) throw new Error(`HTTP ${page.status}`)
  const meta = parseMetadata(page.body, page.url)
  return { text: (meta.articleText ?? '').replace(/\s+/g, ' ').trim(), title: meta.title }
}

async function main(): Promise<void> {
  const adhoc = process.argv[2]
  if (adhoc) {
    const { text, title } = await bodyOf(adhoc)
    console.log(`title : ${title ?? '—'}`)
    console.log(`body  : ${text.length} chars\n`)
    console.log(text.slice(0, 1200))
    return
  }

  let pass = 0
  let fail = 0
  let skip = 0
  const fetched: { label: string; text: string }[] = []

  for (const c of CASES) {
    let text: string
    try {
      text = (await bodyOf(c.url)).text
    } catch (err) {
      skip++
      console.log(`${yellow('SKIP')}  ${c.label}`)
      console.log(dim(`      unreachable — ${err instanceof Error ? err.message : String(err)}`))
      continue
    }
    fetched.push({ label: c.label, text })

    const opening = text.slice(0, 140).toLowerCase()
    const leak = FURNITURE.find((f) => opening.includes(f))
    const problems: string[] = []
    if (text.length < c.minChars) problems.push(`only ${text.length} chars, wanted ${c.minChars}+`)
    if (leak) problems.push(`opens with furniture: "${leak}"`)
    if (!text.includes(c.contains)) problems.push(`missing article phrase "${c.contains}"`)

    if (problems.length) {
      fail++
      console.log(`${red('FAIL')}  ${c.label}`)
      for (const p of problems) console.log(dim(`      ${p}`))
      console.log(dim(`      starts: ${text.slice(0, 90) || '(empty)'}`))
    } else {
      pass++
      console.log(`${green('PASS')}  ${String(text.length).padStart(5)}ch  ${c.label}`)
      console.log(dim(`      ${text.slice(0, 88)}`))
    }
  }

  // Cross-case: distinct stories must produce distinct bodies.
  const collisions = assertDistinct(fetched)
  for (const c of collisions) {
    fail++
    console.log(`${red('FAIL')}  ${c}`)
  }

  console.log(
    `\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped (unreachable)` : ''}`,
  )
  if (fail) process.exitCode = 1
}

await main()
