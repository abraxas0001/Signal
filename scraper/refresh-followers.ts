/**
 * Take a fresh follower reading of every account, keeping the old one.
 *
 *   npm run scraper:followers            every handle on the roster
 *   npm run scraper:followers -- dkaruna one person
 *
 * WHY. "Growth against last week" needs at least two dated readings and the
 * dataset carried exactly one per handle, so the card could only say "one
 * reading so far". This archives the current reading into `followerHistory`
 * and writes today's in its place; the app builds one snapshot per reading
 * and the growth arithmetic comes alive with real deltas.
 *
 * Only the follower count moves. Posts, avatars and standings stay exactly
 * as collected — this is a head-count, not a re-scrape.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { newPage, closeContext, goto, makePacer } from './browser'
import { adapters } from './adapters'
import type { Platform } from './types'

const OUT = resolve(process.cwd(), 'public/demo-politicians.json')

interface Reading {
  takenAt: string
  followers: number | null
}
interface Handle {
  platform: string
  handle: string
  profileUrl?: string
  followers?: number | null
  takenAt?: string
  failure?: string
  followerHistory?: Reading[]
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
  const today = new Date().toISOString()

  let read = 0
  let missed = 0

  for (const person of people) {
    console.log(`\n${person.name}`)
    for (const h of person.handles) {
      const adapter = adapters[h.platform as Platform]
      if (!adapter?.profile || h.failure || !h.profileUrl) continue

      // One fresh reading per day is a reading; two is churn.
      if (typeof h.takenAt === 'string' && h.takenAt.slice(0, 10) === today.slice(0, 10)) {
        console.log(`  ${h.platform.padEnd(11)} ${h.handle.padEnd(22)} already read today`)
        continue
      }

      process.stdout.write(`  ${h.platform.padEnd(11)} ${h.handle.padEnd(22)}`)
      const page = await newPage(true)
      try {
        await goto(page, h.profileUrl)
        // The count lives in the header, which X renders a beat after the
        // page settles; reading immediately found the frame and no numbers.
        await page.waitForTimeout(3000)
        const ctx = { page, log: () => {}, pace: makePacer(h.platform as Platform), limit: 25 }
        const info = await adapter.profile(ctx, h.handle).catch(() => null)

        if (info?.followers == null) {
          missed++
          console.log(' count not readable')
          continue
        }

        // Archive the reading being replaced, once, oldest first.
        if (typeof h.followers === 'number' && typeof h.takenAt === 'string') {
          h.followerHistory ??= []
          if (!h.followerHistory.some((r) => r.takenAt === h.takenAt)) {
            h.followerHistory.push({ takenAt: h.takenAt, followers: h.followers })
          }
        }
        const delta = typeof h.followers === 'number' ? info.followers - h.followers : null
        h.followers = info.followers
        h.takenAt = today
        read++
        console.log(
          ` ${info.followers}${delta === null ? '' : ` (${delta >= 0 ? '+' : ''}${delta})`}`,
        )
        save(file)
      } catch (err) {
        missed++
        console.log(` failed: ${((err as Error).message ?? '').slice(0, 50)}`)
      } finally {
        await closeContext()
      }
    }
  }

  console.log(`\n${read} read, ${missed} not readable`)
}

void main()
