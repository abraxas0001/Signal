/**
 * Populate a handed-over desk from this machine — the daily feed.
 *
 *   npm run desk:push -- dkaruna              feed D. K. Aruna's desk
 *   npm run desk:push -- dkaruna --principal dkaruna
 *
 * WHAT IT DOES. Opens the built app headless, lets the app itself hydrate the
 * example desk for the given principal (the same code path the demo runs, so
 * nothing here re-implements hydration and nothing can drift from it), lifts
 * the resulting records out of localStorage, merges them ADDITIVELY into the
 * desk's server copy, and writes back naming the revision it read.
 *
 * THE MERGE IS ADDITIVE BY CONSTRUCTION. The member's own desk is the base;
 * this feed only appends and refreshes what the office measures:
 *
 *   - handles: readings (snapshots) are unioned per handle by date; handles
 *     the member added herself are untouched
 *   - standings and their notes: replaced with today's readings
 *   - grievances, issues, mentions, influencers: unioned by id, the server's
 *     copy winning on any id both sides hold — an edit she made to a record
 *     survives every morning's push
 *   - profile, settings, actions, drafts, opinion: hers, never touched
 *
 * A 409 means she wrote while this ran: pull, remerge, retry. Never forced.
 *
 * NEEDS: the app built (npm run build), .env with the Firebase service
 * account. Runs its own vite preview on a spare port; uses a plain headless
 * browser, never the scraper profile.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { chromium } from 'playwright'
import { normaliseDeskId, readDeskBundle, writeDeskBundle } from '../netlify/functions/lib/desk-sync'

const PORT = 4187
const PRINCIPAL_KEY = 'signal.demo.principal'

/* ── little helpers ──────────────────────────────────────────────────────── */

const parse = (raw: string | undefined): unknown => {
  if (raw == null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

interface WithId {
  id: string
  [k: string]: unknown
}

/** Union by id; `base` (the member's copy) wins when both hold the id. */
function unionById(base: unknown, feed: unknown): WithId[] {
  const a = Array.isArray(base) ? (base as WithId[]) : []
  const b = Array.isArray(feed) ? (feed as WithId[]) : []
  const seen = new Set(a.map((x) => x?.id).filter(Boolean))
  return [...a, ...b.filter((x) => x?.id && !seen.has(x.id))]
}

/* ── hydrate via the app itself ──────────────────────────────────────────── */

async function hydrate(principal: string): Promise<Record<string, string>> {
  let server: ChildProcess | null = null
  const up = await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false)
  if (!up) {
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
      cwd: process.cwd(),
      shell: true,
      stdio: 'ignore',
    })
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const ok = await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(2000) })
        .then((r) => r.ok)
        .catch(() => false)
      if (ok) break
      if (i === 29) throw new Error('vite preview did not come up')
    }
  }

  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(
      ([key, who]) => {
        localStorage.clear()
        localStorage.setItem(key as string, who as string)
      },
      [PRINCIPAL_KEY, principal],
    )
    await page.goto(`http://localhost:${PORT}/?example`, { waitUntil: 'domcontentloaded' })

    // Hydrated means: handles stored AND the standings cache written. The
    // demo seeds synchronously once the roster fetch lands, so poll briefly.
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1000)
      const ready = await page.evaluate(() => {
        const handles = localStorage.getItem('signal.handles.v1::demo')
        const store = localStorage.getItem('signal:store:demo')
        return Boolean(handles && store && store.includes('onboardedAt'))
      })
      if (ready) break
      if (i === 39) throw new Error('the demo desk never hydrated')
    }
    // One settling beat for the async caches (standings, reports).
    await page.waitForTimeout(3000)

    const dump = await page.evaluate(() => {
      const out: Record<string, string> = {}
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k) continue
        if (k === 'signal:store:demo' || k.endsWith('::demo')) out[k] = localStorage.getItem(k) ?? ''
      }
      return out
    })

    // Demo scope -> base names, which is what the desk bundle stores.
    const keys: Record<string, string> = {}
    for (const [k, v] of Object.entries(dump)) {
      if (k === 'signal:store:demo') keys['signal:store'] = v
      else keys[k.replace(/::demo$/, '')] = v
    }
    return keys
  } finally {
    await browser.close()
    if (server) server.kill()
  }
}

/* ── the merge ───────────────────────────────────────────────────────────── */

function mergeStore(memberRaw: string | undefined, feedRaw: string): string {
  const feed = parse(feedRaw) as Record<string, unknown> | null
  const member = parse(memberRaw) as Record<string, unknown> | null
  if (!feed) return memberRaw ?? feedRaw
  if (!member) return feedRaw

  return JSON.stringify({
    // Hers first: settings, actions, drafts, profile, opinion and anything
    // added after this script was written all ride through untouched.
    ...member,
    grievances: unionById(member['grievances'], feed['grievances']),
    issues: unionById(member['issues'], feed['issues']),
    mentions: unionById(member['mentions'], feed['mentions']),
    influencers: unionById(member['influencers'], feed['influencers']),
    // Today's candidates are today's; yesterday's were either read or stale.
    newsCandidates: feed['newsCandidates'] ?? member['newsCandidates'],
    onboardedAt: member['onboardedAt'] ?? feed['onboardedAt'],
    profile: member['profile'] ?? feed['profile'],
  })
}

interface SnapshotLike {
  takenAt: string
  followers?: number | null
  postsTotal?: number | null
  posts?: unknown[]
}
interface HandleLike {
  id: string
  platform?: string
  handle?: string
  snapshots?: SnapshotLike[]
  [k: string]: unknown
}

/** `YouTube:@myogiadityanath` and `YouTube:myogiadityanath` are one account. */
const sameAccountKey = (h: HandleLike): string =>
  `${h.platform ?? ''}:${String(h.handle ?? h.id).toLowerCase().replace(/^@/, '')}`

/**
 * Union two snapshot lists by date, and keep the invariant every consumer
 * relies on: THE LAST SNAPSHOT CARRIES THE POSTS. A competitor added inside
 * the app gets a newer-but-empty reading (the server can see followers, not
 * posts), and a plain date-sorted union let that empty reading shadow the
 * full one — the rival's whole timeline vanished from the desk while sitting
 * intact one snapshot earlier.
 */
function unionSnapshots(a: SnapshotLike[], b: SnapshotLike[]): SnapshotLike[] {
  const seen = new Set(a.map((s) => s.takenAt))
  const merged = [...a, ...b.filter((s) => !seen.has(s.takenAt))].sort((x, y) =>
    x.takenAt.localeCompare(y.takenAt),
  )
  const last = merged[merged.length - 1]
  const newestWithPosts = [...merged].reverse().find((s) => (s.posts?.length ?? 0) > 0)
  if (last && newestWithPosts && last !== newestWithPosts && (last.posts?.length ?? 0) === 0) {
    merged[merged.length - 1] = {
      ...last,
      posts: newestWithPosts.posts,
      postsTotal: last.postsTotal ?? newestWithPosts.postsTotal,
      followers: last.followers ?? newestWithPosts.followers,
    }
  }
  return merged
}

function mergeHandles(memberRaw: string | undefined, feedRaw: string): string {
  const member = parse(memberRaw) as HandleLike[] | null
  const feed = parse(feedRaw) as HandleLike[] | null
  if (!Array.isArray(feed)) return memberRaw ?? feedRaw
  if (!Array.isArray(member)) return feedRaw

  // Her own list can already hold the same account twice — one typed with an
  // @, one without, from before this merge keyed by account. Collapse those
  // first, or only one of the pair meets the feed and the other survives as
  // a ghost row.
  const memberByAccount = new Map<string, HandleLike>()
  for (const h of member) {
    const key = sameAccountKey(h)
    const existing = memberByAccount.get(key)
    memberByAccount.set(
      key,
      existing
        ? { ...existing, ...h, snapshots: unionSnapshots(existing.snapshots ?? [], h.snapshots ?? []) }
        : h,
    )
  }

  // Keyed by the ACCOUNT, not the raw id: her hand-typed handle may differ
  // from the collected one by an @ or by case, and two rows for one channel
  // is the bug this merge exists to prevent.
  const feedByAccount = new Map(feed.map((h) => [sameAccountKey(h), h]))
  const out: HandleLike[] = [...memberByAccount.values()].map((hers) => {
    const ours = feedByAccount.get(sameAccountKey(hers))
    if (!ours) return hers // a handle she added herself, unknown to the feed
    feedByAccount.delete(sameAccountKey(hers))
    return {
      // Freshest identity facts (avatar, name, label) come from today's read.
      ...hers,
      ...ours,
      snapshots: unionSnapshots(hers.snapshots ?? [], ours.snapshots ?? []),
    }
  })
  return JSON.stringify([...out, ...feedByAccount.values()])
}

/** Standing caches: today's readings win outright, hers fill the gaps. */
function mergeMap(memberRaw: string | undefined, feedRaw: string): string {
  const member = parse(memberRaw) as Record<string, unknown> | null
  const feed = parse(feedRaw) as Record<string, unknown> | null
  if (!feed) return memberRaw ?? feedRaw
  return JSON.stringify({ ...(member ?? {}), ...feed })
}

/* ── main ────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const deskId = normaliseDeskId(args.find((a) => !a.startsWith('--')))
  if (!deskId) {
    console.log('Usage: npm run desk:push -- <deskId> [--principal <rosterKey>]')
    process.exit(1)
  }
  const pAt = args.indexOf('--principal')
  const principal = pAt >= 0 ? (args[pAt + 1] ?? deskId) : deskId

  console.log(`Hydrating the ${principal} desk through the app itself…`)
  const feed = await hydrate(principal)
  console.log(`  ${Object.keys(feed).length} records lifted`)

  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readDeskBundle(deskId)
    if (!current.ok) {
      console.log(`Could not read the desk: ${current.note}`)
      process.exit(1)
    }
    const theirs = current.value.keys
    const merged: Record<string, string> = { ...theirs }
    for (const [base, value] of Object.entries(feed)) {
      if (base === 'signal:store') merged[base] = mergeStore(theirs[base], value)
      else if (base === 'signal.handles.v1') merged[base] = mergeHandles(theirs[base], value)
      else if (base === 'signal.standing.v1' || base === 'signal.standingNote.v1')
        merged[base] = mergeMap(theirs[base], value)
      else merged[base] = theirs[base] ?? value
    }

    const wrote = await writeDeskBundle(deskId, current.value.rev, merged, 'office')
    if (wrote.ok) {
      console.log(`Pushed. The desk is at revision ${wrote.value.rev}.`)
      return
    }
    if (wrote.status !== 409) {
      console.log(`Could not write the desk: ${wrote.note}`)
      process.exit(1)
    }
    console.log(`  the desk moved while merging (attempt ${attempt + 1}); remerging…`)
  }
  console.log('Gave up after three attempts. Run it again.')
  process.exit(1)
}

void main()
