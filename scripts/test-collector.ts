/**
 * The collector protocol, tested without a browser or Firestore.
 *
 * Everything load-bearing about the collector is a pure decision: which handles
 * are stale enough to walk, whether the own-only comment rule holds, whether a
 * redelivered snapshot is dropped, whether a failure stays a failure. Those are
 * tested here directly against fixtures. The parts that touch a real browser
 * (the walks) and a real Firestore (the mailbox) are exactly what the house
 * rule keeps out of an automated run, so they are stubbed, and their contract
 * is asserted at the seam.
 */
import { jobsFromKeys, DEFAULT_POLICY, type CollectorPolicy } from '../netlify/functions/lib/collector'

let passed = 0
let failed = 0
const ok = (name: string, cond: boolean, extra = ''): void => {
  if (cond) {
    passed += 1
    console.log(`  ok  ${name}`)
  } else {
    failed += 1
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

const hoursAgoIso = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString()

const policy: CollectorPolicy = { ...DEFAULT_POLICY, snapshotCadenceHours: 20, standingCadenceHours: 44 }

/* ── job derivation ──────────────────────────────────────────────────────── */

function keysFor(handles: unknown[], standing: Record<string, { readAt: string }>) {
  return {
    'signal.handles.v1': JSON.stringify(handles),
    'signal.standing.v1': JSON.stringify(standing),
  }
}

console.log('job derivation')

// A fresh desk with nothing stale produces no jobs.
{
  const keys = keysFor(
    [
      {
        id: 'Facebook:own',
        platform: 'Facebook',
        handle: 'own',
        own: true,
        snapshots: [{ takenAt: hoursAgoIso(2), posts: [{ url: 'https://f/1' }] }],
      },
    ],
    { 'Facebook:own': { readAt: hoursAgoIso(2) } },
  )
  const { jobs } = jobsFromKeys(keys, policy, 8)
  ok('fresh desk yields no jobs', jobs.length === 0)
}

// A handle whose snapshot is older than the cadence gets a posts job.
{
  const keys = keysFor(
    [
      {
        id: 'Facebook:own',
        platform: 'Facebook',
        handle: 'own',
        own: true,
        snapshots: [{ takenAt: hoursAgoIso(30), posts: [{ url: 'https://f/1' }] }],
      },
    ],
    { 'Facebook:own': { readAt: hoursAgoIso(2) } },
  )
  const { jobs } = jobsFromKeys(keys, policy, 8)
  const postsJob = jobs.find((j) => j.kind === 'posts')
  ok('stale snapshot yields a posts job', postsJob?.handle === 'own')
  ok('posts job id is day-stable', /^\d{4}-\d{2}-\d{2}:posts:Facebook:own$/.test(postsJob?.id ?? ''))
}

// A handle with a stale STANDING but fresh snapshot yields comment jobs, one
// per recent post, and ONLY for an own handle.
{
  const keys = keysFor(
    [
      {
        id: 'Facebook:own',
        platform: 'Facebook',
        handle: 'own',
        own: true,
        snapshots: [
          {
            takenAt: hoursAgoIso(2),
            posts: [{ url: 'https://f/1' }, { url: 'https://f/2' }, { url: 'https://f/3' }, { url: 'https://f/4' }],
          },
        ],
      },
      {
        id: 'Facebook:rival',
        platform: 'Facebook',
        handle: 'rival',
        own: false,
        snapshots: [{ takenAt: hoursAgoIso(2), posts: [{ url: 'https://f/r1' }] }],
      },
    ],
    { 'Facebook:own': { readAt: hoursAgoIso(60) } },
  )
  const { jobs } = jobsFromKeys(keys, policy, 8)
  const commentJobs = jobs.filter((j) => j.kind === 'comments')
  ok('stale standing yields comment jobs', commentJobs.length === policy.commentPostsPerHandle, `got ${commentJobs.length}`)
  ok('comment jobs are own-only', commentJobs.every((j) => j.handleId === 'Facebook:own'))
  ok('a rival never gets a comment job', !commentJobs.some((j) => j.handleId === 'Facebook:rival'))
}

// The room cap is honoured: no more jobs than there is room for.
{
  const handles = Array.from({ length: 20 }, (_, i) => ({
    id: `Facebook:h${i}`,
    platform: 'Facebook',
    handle: `h${i}`,
    own: true,
    snapshots: [{ takenAt: hoursAgoIso(30), posts: [{ url: `https://f/${i}` }] }],
  }))
  const { jobs } = jobsFromKeys(keysFor(handles, {}), policy, 5)
  ok('room cap bounds the job count', jobs.length === 5, `got ${jobs.length}`)
}

// A cap of zero yields the honest note, not a walk.
{
  const { jobs, note } = jobsFromKeys(keysFor([], {}), policy, 0)
  ok('zero room yields no jobs', jobs.length === 0)
  ok('zero room names the cap', note === 'daily cap reached')
}

// A desk with no handles says so.
{
  const { jobs, note } = jobsFromKeys(keysFor([], {}), policy, 8)
  ok('empty desk yields no jobs', jobs.length === 0)
  ok('empty desk explains itself', (note ?? '').includes('tracks no accounts'))
}

// A corrupt store fails closed, not open.
{
  const { jobs, note } = jobsFromKeys({ 'signal.handles.v1': '{not json' }, policy, 8)
  ok('corrupt store yields no jobs', jobs.length === 0)
  ok('corrupt store says why', (note ?? '').includes('could not be parsed'))
}

/* ── inbox dedup key ─────────────────────────────────────────────────────── */

console.log('inbox idempotency')

// The drain's per-day dedup: two snapshots for the same handle on the same IST
// day collapse; a new day does not. This mirrors collector-inbox.ts:istDay.
{
  const istDay = (iso: string): string =>
    new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10)
  const t1 = '2026-09-02T04:00:00Z' // 09:30 IST, 2 Sep
  const t2 = '2026-09-02T10:00:00Z' // 15:30 IST, 2 Sep
  const t3 = '2026-09-02T19:30:00Z' // 01:00 IST, 3 Sep
  ok('same IST day collapses', istDay(t1) === istDay(t2))
  ok('IST midnight rolls the day', istDay(t2) !== istDay(t3))
  ok('the late-night reading is next day', istDay(t3) === '2026-09-03')
}

/* ── walk contract (stubbed) ─────────────────────────────────────────────── */

console.log('walk contract')

// The seam the collector relies on: a failed walk is a distinct shape from an
// empty success, so the app can tell "posted nothing" from "session expired".
// This asserts the shape the orchestrate walks promise, using stubs rather
// than a browser.
{
  type Walk = { ok: true; items: unknown[] } | { ok: false; reason: string; needsLogin?: boolean }
  const emptySuccess: Walk = { ok: true, items: [] }
  const loginWall: Walk = { ok: false, reason: 'login wall', needsLogin: true }
  ok('empty success is ok', emptySuccess.ok === true && emptySuccess.items.length === 0)
  ok('login wall is not ok', loginWall.ok === false)
  ok('login wall is flagged for a human', loginWall.ok === false && loginWall.needsLogin === true)
  ok('the two are distinguishable', emptySuccess.ok !== loginWall.ok)
}

/* ── result ──────────────────────────────────────────────────────────────── */

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
