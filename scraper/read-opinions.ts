/**
 * Read what people are actually saying under each account's posts.
 *
 *   npm run scraper:opinions          every account that might be readable
 *   npm run scraper:opinions -- modi  one person
 *
 * This calls the app's OWN endpoint — `/api/standing` — rather than doing any
 * reading of its own, so what lands in the demo dataset is exactly what a real
 * office would get from the same button. No scoring is invented here; the
 * server either produces a reading or explains why it cannot.
 *
 * WHY IT REFUSES MORE OFTEN THAN IT SUCCEEDS, and why that is right. The
 * endpoint will not score a handful of comments: measured on a 3,290-subscriber
 * channel it answered "only 1 comment across 8 posts, which is too few to say
 * anything honest about public opinion". A sentiment score built on one comment
 * is a number with the shape of evidence and none of the substance, and a desk
 * that saw one would have no way to tell it apart from a reading of four
 * hundred. An empty card is the honest outcome and is recorded as such.
 *
 * YOUTUBE IS THE ONE THAT USUALLY WORKS. Its comments are public, so the server
 * can read them unaided — a big channel comes back with real praise and real
 * criticism quoted verbatim. Facebook, Instagram and LinkedIn publish nothing to
 * a server without a page token the office does not have, which is the same wall
 * that made this scraper necessary in the first place.
 *
 * The endpoint runs behind `netlify dev`, so start the app first.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve(process.cwd(), 'public/demo-politicians.json')
const API = process.env['SIGNAL_API'] ?? 'http://localhost:5173'

/** How many posts to offer the reader. More posts, more comments to work with. */
const POSTS_PER_HANDLE = 12

interface Post {
  url: string
  [k: string]: unknown
}
interface Handle {
  platform: string
  handle: string
  posts: Post[]
  failure?: string
  /** What the reader returned, or why it declined. Written by this script. */
  standing?: unknown
  standingNote?: string
  [k: string]: unknown
}
interface Person {
  key: string
  name: string
  handles: Handle[]
  [k: string]: unknown
}
interface File {
  people: Record<string, Person>
  [k: string]: unknown
}

async function main(): Promise<void> {
  if (!existsSync(OUT)) {
    console.log('No demo dataset yet. Run `npm run scraper:demo` first.')
    process.exit(1)
  }

  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const file = JSON.parse(readFileSync(OUT, 'utf8')) as File
  const people = Object.values(file.people).filter(
    (p) => wanted.length === 0 || wanted.includes(p.key),
  )

  let read = 0
  let declined = 0

  for (const person of people) {
    console.log(`${person.name}`)
    for (const h of person.handles) {
      if (h.failure || h.posts.length === 0) continue

      const urls = h.posts.slice(0, POSTS_PER_HANDLE).map((p) => p.url)
      process.stdout.write(`  ${h.platform.padEnd(11)} ${h.handle.padEnd(24)}`)

      try {
        const res = await fetch(`${API}/api/standing`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ platform: h.platform, handle: h.handle, urls }),
          signal: AbortSignal.timeout(240_000),
        })
        const payload = (await res.json()) as Record<string, unknown>

        if (!res.ok || typeof payload['score'] !== 'number') {
          // The refusal is kept, not discarded. "Too few comments to be honest
          // about" is a finding about the account, and a desk that sees the
          // card empty deserves to know it was tried.
          const why = String(payload['error'] ?? `HTTP ${res.status}`)
          h.standing = undefined
          h.standingNote = why
          declined++
          console.log(`— ${why.slice(0, 64)}`)
          continue
        }

        h.standing = payload
        h.standingNote = undefined
        read++
        console.log(
          `score ${payload['score']} ${String(payload['label'])} ` +
            `(${String(payload['commentsRead'] ?? '?')} comments)`,
        )
      } catch (err) {
        h.standing = undefined
        const why = (err as Error).message.split('\n')[0] ?? 'unreadable'
        h.standingNote = why
        declined++
        console.log(`— ${why.slice(0, 60)}`)
      }

      writeFileSync(OUT, JSON.stringify(file, null, 2))
    }
    console.log('')
  }

  console.log(`${read} accounts read, ${declined} declined or unreadable.`)
  console.log(`Wrote ${OUT}\n`)
}

void main()
