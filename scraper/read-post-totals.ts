/**
 * Read each account's LIFETIME post count off its profile header, through the
 * signed-in browser, and store it as `postsTotal` on the handle.
 *
 *   npm run scraper:totals            every handle on the roster
 *   npm run scraper:totals -- dkaruna one person
 *
 * WHY. The reach card says "25 posts" because 25 is how many the collector
 * stores, and an MP who has posted for a decade read that as the product
 * claiming she has 25 posts. The number she expects is the one her own profile
 * header shows — "1,284 posts" on Instagram, "12.3K posts" on X, "312 videos"
 * on YouTube — and that figure is sitting in plain text on a page this browser
 * is already signed into.
 *
 * Facebook and LinkedIn publish no lifetime count anywhere on the page, so
 * those stay null and the card keeps saying what it can honestly say. Null is
 * "the platform does not publish this", never zero.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { newPage, closeContext, goto } from './browser'
import { parseCount } from './types'

const OUT = resolve(process.cwd(), 'public/demo-politicians.json')

interface Handle {
  platform: string
  handle: string
  profileUrl?: string
  failure?: string
  postsTotal?: number | null
  [k: string]: unknown
}
interface Person {
  key: string
  name: string
  handles: Handle[]
  [k: string]: unknown
}
interface RosterFile {
  people: Record<string, Person>
  [k: string]: unknown
}

/** What the count is called on each platform's own header. */
const COUNT_WORD: Record<string, RegExp | null> = {
  Instagram: /^([\d.,]+\s*[kKmM]?)\s*posts?$/i,
  'Twitter/X': /^([\d.,]+(?:\.\d+)?\s*[kKmM]?)\s*posts$/i,
  YouTube: /^([\d.,]+(?:\.\d+)?\s*[kKmM]?)\s*videos?$/i,
  Facebook: null,
  LinkedIn: null,
}

function save(file: RosterFile): void {
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(OUT, JSON.stringify(file))
      return
    } catch (err) {
      if (attempt >= 3) throw err
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * (attempt + 1))
    }
  }
}

async function main(): Promise<void> {
  if (!existsSync(OUT)) {
    console.log('No demo dataset yet. Run the collection first.')
    process.exit(1)
  }
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const file = JSON.parse(readFileSync(OUT, 'utf8')) as RosterFile
  const people = Object.values(file.people).filter((p) => wanted.length === 0 || wanted.includes(p.key))

  let read = 0
  let none = 0

  for (const person of people) {
    console.log(`\n${person.name}`)
    for (const h of person.handles) {
      const pattern = COUNT_WORD[h.platform]
      if (!pattern || h.failure || !h.profileUrl) continue
      if (typeof h.postsTotal === 'number') {
        console.log(`  ${h.platform.padEnd(11)} ${h.handle.padEnd(22)} already read (${h.postsTotal})`)
        continue
      }

      process.stdout.write(`  ${h.platform.padEnd(11)} ${h.handle.padEnd(22)}`)
      const page = await newPage(true)
      try {
        await goto(page, h.profileUrl)
        // The count sits in the header, which can render a beat after the page.
        await page.waitForTimeout(2500)
        const found = await page.evaluate((src) => {
          const re = new RegExp(src, 'i')
          // Near-leaf elements: Instagram wraps the digits in a child span, so
          // "6,710 posts" lives on an element with ONE child, not zero. Two is
          // the cap that still excludes paragraphs the regex cannot anchor in.
          for (const el of Array.from(document.querySelectorAll('span, div, a'))) {
            if (el.children.length > 2) continue
            const t = (el.textContent ?? '').trim().replace(/\s+/g, ' ')
            if (t.length > 24) continue
            const m = re.exec(t)
            if (m?.[1]) return m[1]
          }
          return null
        }, pattern.source)

        const n = parseCount(found)
        if (n !== null && n > 0) {
          h.postsTotal = n
          read++
          console.log(` ${n} total`)
          save(file)
        } else {
          none++
          console.log(' count not on the page')
        }
      } catch (err) {
        none++
        console.log(` failed: ${((err as Error).message ?? '').slice(0, 50)}`)
      } finally {
        await closeContext()
      }
    }
  }

  console.log(`\n${read} read, ${none} without a count`)
}

void main()
