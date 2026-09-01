/**
 * Build the demo dataset: every roster handle, scraped once, written to disk.
 *
 *   npm run scraper:demo                 everyone
 *   npm run scraper:demo -- dkaruna ktr  just these people
 *
 * STRICTLY SERIAL, and that is not a performance oversight. The profile takes
 * exactly one browser at a time, so there is nothing to parallelise; and the
 * per-platform pacing exists to keep these accounts alive, which is the whole
 * asset. Instagram alone waits twelve seconds between navigations. A full run
 * is minutes, by design.
 *
 * PARTIAL RESULTS ARE KEPT. Each handle is written as it completes rather than
 * at the end, so a session that expires on the fourth of twenty profiles leaves
 * the first three on disk instead of losing the lot. Re-running merges over
 * what is already there.
 *
 * WHAT IT WILL NOT DO. A handle that could not be read is recorded as a failure
 * with its reason, never as a profile with zero posts. The dashboard draws a
 * politician who has stopped posting very differently from one we could not
 * reach, and the difference has to survive all the way to the file.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { newPage, closeContext, goto, makePacer } from './browser'
import { adapters } from './adapters'
import { PEOPLE, PAIRINGS, scrapableHandles, type Person, type RosterHandle } from './roster'
import { CREATORS, scrapableCreatorHandles } from './creators'
import type { Platform } from './types'

const OUT = resolve(process.cwd(), 'public/demo-politicians.json')

/** Matches the app's TrackedPost in src/lib/handles.ts. */
interface DemoPost {
  url: string
  title: string | null
  publishedAt: string | null
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  thumbnailUrl: string | null
}

interface DemoHandle {
  platform: Platform
  handle: string
  profileUrl: string
  displayName: string | null
  avatarUrl: string | null
  followers: number | null
  takenAt: string
  posts: DemoPost[]
  /** Set only when the read failed; posts is then empty and MEANS nothing. */
  failure?: string
}

interface DemoPerson {
  key: string
  name: string
  party: string
  partyTag: string
  role: string
  office: { constituency: string; state: string; district: string }
  aliases: string[]
  handles: DemoHandle[]
}

interface DemoCreatorOut {
  key: string
  name: string
  kind: string
  language: string
  scope: string
  why: string
  handles: DemoHandle[]
}

interface DemoFile {
  generatedAt: string
  pairings: typeof PAIRINGS
  people: Record<string, DemoPerson>
  creators: DemoCreatorOut[]
}

function readExisting(): DemoFile {
  if (existsSync(OUT)) {
    try {
      return JSON.parse(readFileSync(OUT, 'utf8')) as DemoFile
    } catch {
      /* a corrupt file is not worth preserving; fall through to a fresh one */
    }
  }
  return { generatedAt: new Date().toISOString(), pairings: PAIRINGS, people: {}, creators: [] }
}

function save(file: DemoFile): void {
  mkdirSync(dirname(OUT), { recursive: true })
  file.generatedAt = new Date().toISOString()
  file.pairings = PAIRINGS
  writeFileSync(OUT, JSON.stringify(file, null, 2))
}

/**
 * What the last run recorded for this handle's photo, if anything.
 *
 * Read from disk on demand rather than threaded through, because the file is
 * saved after every handle and the caller's copy would go stale mid-run.
 */
function existingAvatar(platform: string, handle: string): string | null {
  if (!existsSync(OUT)) return null
  try {
    const file = JSON.parse(readFileSync(OUT, 'utf8')) as DemoFile
    for (const person of Object.values(file.people)) {
      const match = person.handles.find((x) => x.platform === platform && x.handle === handle)
      if (match) return match.avatarUrl
    }
  } catch {
    /* unreadable file: treat as no previous photo */
  }
  return null
}

async function scrapeOne(person: { name: string }, h: RosterHandle): Promise<DemoHandle> {
  const adapter = adapters[h.platform]
  const url = adapter.profileUrl(h.handle)
  const page = await newPage(true)

  const base: DemoHandle = {
    platform: h.platform,
    handle: h.handle,
    profileUrl: url,
    displayName: person.name,
    avatarUrl: null,
    followers: null,
    takenAt: new Date().toISOString(),
    posts: [],
  }

  try {
    await goto(page, url)

    const ctx = {
      page,
      log: (m: string) => console.log(`      ${m}`),
      pace: makePacer(h.platform),
      limit: 25,
    }

    // A login wall is an outage, never an empty account. It has to be labelled
    // as one here or the file will quietly assert that a sitting MP posts
    // nothing.
    if (await adapter.isLoginWall(ctx).catch(() => true)) {
      return { ...base, failure: 'login wall — the session for this platform needs renewing' }
    }

    const info = adapter.profile ? await adapter.profile(ctx, h.handle).catch(() => null) : null
    if (info) {
      base.followers = info.followers
      base.avatarUrl = info.avatarUrl
      // The roster's name wins over the scraped one: the page header is
      // translated, inconsistent, and on Facebook returned "नोटिफ़िकेशन".
    }

    /**
     * A photo already downloaded outranks a fresh CDN link.
     *
     * `scraper:avatars` rewrites these to local `/demo-avatars/` paths, because
     * the platforms' CDNs refuse cross-origin embedding and their signed URLs
     * expire within days. Letting a re-scrape overwrite that with a new CDN URL
     * would silently un-fix it — the photos would vanish from the dashboard
     * again, and only re-running the avatar step would bring them back. The
     * local file is the better answer; keep it.
     */
    const previous = existingAvatar(h.platform, h.handle)
    if (previous?.startsWith('/demo-avatars/')) base.avatarUrl = previous

    const res = await adapter.posts(ctx, h.handle)
    if (!res.ok) return { ...base, failure: res.reason }

    return {
      ...base,
      posts: res.items.map((p) => ({
        url: p.url,
        title: p.title,
        publishedAt: p.publishedAt,
        views: p.views,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
        thumbnailUrl: p.thumbnailUrl,
      })),
    }
  } catch (err) {
    return { ...base, failure: (err as Error).message.split('\n')[0] }
  } finally {
    await page.close().catch(() => {})
  }
}


/**
 * Carry forward everything a re-scrape does not itself measure.
 *
 * A rebuild replaces the whole handle record, and the fields it does not
 * produce went with it: the archived follower readings that a growth curve
 * is made of, the comment reading behind every sentiment card, and the note
 * saying why a reading was declined. None of those can be re-measured after
 * the fact — an August follower count is gone the moment it is overwritten —
 * so a run that re-reads posts must not cost the desk its history.
 *
 * Measured fields are NOT carried: followers, posts and the timestamp are
 * what this run went to find, and a stale one masquerading as fresh is the
 * failure this whole file exists to avoid. The one exception is a follower
 * count the run failed to read at all, where the previous reading is kept
 * with its own older timestamp, because "we could not read it today" is not
 * the same claim as "the account has no followers".
 */
function carryForward(next: DemoHandle, prev: DemoHandle | undefined): DemoHandle {
  if (!prev) return next
  const before = prev as unknown as Record<string, unknown>
  const merged = { ...next } as unknown as Record<string, unknown>
  // Fields this file does not model, because it does not produce them: the
  // comment reading, its refusal note, the archived follower readings and the
  // grounded opinion survey all arrive from other scripts.
  for (const key of ['standing', 'standingNote', 'followerHistory', 'opinion']) {
    if (merged[key] === undefined && before[key] !== undefined) merged[key] = before[key]
  }
  if (next.followers === null && prev.followers !== null) {
    merged['followers'] = prev.followers
    merged['takenAt'] = prev.takenAt
  }
  return merged as unknown as DemoHandle
}

async function main(): Promise<void> {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const people = wanted.length ? PEOPLE.filter((p) => wanted.includes(p.key)) : PEOPLE

  if (people.length === 0) {
    console.log(`No such person. Known keys: ${PEOPLE.map((p) => p.key).join(', ')}`)
    process.exit(1)
  }

  const file = readExisting()

  /**
   * `--meta-only` rewrites the descriptive fields and leaves the posts alone.
   *
   * Names, roles, constituencies and pairings are editorial — they change when
   * somebody is corrected or a seat is re-checked — while the posts cost twenty
   * paced profile visits and a slice of four accounts' goodwill to collect. Tying
   * the two together would mean re-scraping every time a district was spelled
   * differently, so they are separable.
   */
  if (process.argv.includes('--meta-only')) {
    for (const person of people) {
      const existing = file.people[person.key]
      if (!existing) {
        console.log(`  ${person.name}: no scraped data yet — run without --meta-only first`)
        continue
      }
      existing.name = person.name
      existing.party = person.party
      existing.partyTag = person.partyTag
      existing.role = person.role
      existing.office = person.office
      existing.aliases = person.aliases
      console.log(`  ${person.name}: metadata refreshed`)
    }
    save(file)
    console.log(`
Wrote ${OUT} (metadata only; posts untouched)
`)
    return
  }

  const total = people.reduce((n, p) => n + scrapableHandles(p).length, 0)
  let done = 0

  console.log(`\nBuilding demo data for ${people.length} people, ${total} handles.`)
  console.log(`Serial and paced — expect roughly ${Math.ceil((total * 25) / 60)} minutes.\n`)

  for (const person of people) {
    console.log(`${person.name}  (${person.partyTag})`)
    const entry: DemoPerson = file.people[person.key] ?? {
      key: person.key,
      name: person.name,
      party: person.party,
      partyTag: person.partyTag,
      role: person.role,
      office: person.office,
      aliases: person.aliases,
      handles: [],
    }
    // Keep the roster's own description current even on a re-run.
    entry.name = person.name
    entry.role = person.role
    entry.party = person.party
    entry.partyTag = person.partyTag
    entry.office = person.office
    entry.aliases = person.aliases

    for (const h of scrapableHandles(person)) {
      done++
      process.stdout.write(`  [${done}/${total}] ${h.platform.padEnd(11)} ${h.handle.padEnd(22)}`)
      const result = await scrapeOne(person, h)

      if (result.failure) {
        console.log(`FAILED — ${result.failure.slice(0, 70)}`)
      } else {
        // ANY metric, not just likes. Counting only likes reported "engagement
        // on 0" for a page that had returned comments and shares on all
        // twenty-five posts, which read as a broken scrape rather than a
        // partial one and sent an hour after a bug that was in this line.
        const withEng = result.posts.filter(
          (p) => p.likes !== null || p.comments !== null || p.shares !== null || p.views !== null,
        ).length
        console.log(
          `${String(result.posts.length).padStart(2)} posts` +
            `  followers=${result.followers ?? '—'}` +
            `  engagement on ${withEng}`,
        )
      }

      const previous = entry.handles.find(
        (x) => x.platform === h.platform && x.handle === h.handle,
      )
      entry.handles = [
        ...entry.handles.filter((x) => !(x.platform === h.platform && x.handle === h.handle)),
        carryForward(result, previous),
      ]
      file.people[person.key] = entry
      save(file) // after every handle, so an interruption keeps what it got
    }
    console.log('')
  }

  /**
   * The accounts that talk about them, read the same way.
   *
   * Deliberately after the politicians: if a session lapses part-way through a
   * run, the desks' own accounts are already on disk. Coverage is the thing you
   * can most afford to be a day behind on.
   */
  const creatorTotal = CREATORS.reduce((n, c) => n + scrapableCreatorHandles(c).length, 0)
  let creatorDone = 0
  console.log(`Coverage: ${CREATORS.length} accounts, ${creatorTotal} handles.
`)

  for (const creator of CREATORS) {
    console.log(`${creator.name}  (${creator.kind})`)
    const entry: DemoCreatorOut = file.creators.find((c) => c.key === creator.key) ?? {
      key: creator.key,
      name: creator.name,
      kind: creator.kind,
      language: creator.language,
      scope: creator.scope,
      why: creator.why,
      handles: [],
    }
    entry.name = creator.name
    entry.kind = creator.kind
    entry.language = creator.language
    entry.scope = creator.scope
    entry.why = creator.why

    for (const h of scrapableCreatorHandles(creator)) {
      creatorDone++
      process.stdout.write(
        `  [${creatorDone}/${creatorTotal}] ${h.platform.padEnd(11)} ${h.handle.padEnd(22)}`,
      )
      const result = await scrapeOne(creator, h)
      console.log(
        result.failure
          ? `FAILED — ${result.failure.slice(0, 60)}`
          : `${String(result.posts.length).padStart(2)} posts  followers=${result.followers ?? '—'}`,
      )
      const previous = entry.handles.find(
        (x) => x.platform === h.platform && x.handle === h.handle,
      )
      entry.handles = [
        ...entry.handles.filter((x) => !(x.platform === h.platform && x.handle === h.handle)),
        carryForward(result, previous),
      ]
      file.creators = [...file.creators.filter((c) => c.key !== creator.key), entry]
      save(file)
    }
    console.log('')
  }

  await closeContext()

  const handles = Object.values(file.people).flatMap((p) => p.handles)
  const ok = handles.filter((h) => !h.failure)
  console.log(`Wrote ${OUT}`)
  console.log(
    `${ok.length}/${handles.length} handles read, ` +
      `${ok.reduce((n, h) => n + h.posts.length, 0)} posts total.`,
  )
  const failed = handles.filter((h) => h.failure)
  if (failed.length) {
    console.log(`\nCould not read (recorded as failures, NOT as empty accounts):`)
    for (const f of failed) console.log(`  ${f.platform} ${f.handle} — ${f.failure}`)
  }
  console.log('')
}

void main()
