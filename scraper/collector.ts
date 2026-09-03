/**
 * The desk collector: the office's own machine doing the office's own walks.
 *
 *   npm run collector -- signin <deskId>     ask for the passphrase, keep a token
 *   npm run collector -- status              what would run, without running it
 *   npm run collector -- run [--once]        poll for jobs and do them
 *
 * WHAT THIS IS. The production answer to "the scraper worked on my machine":
 * it stays on a machine, one per desk, driving that office's own signed-in
 * browser profile (the same profile scraper:login creates). The server never
 * holds a platform credential; it only says what is stale (collector-jobs)
 * and keeps the results until the app next opens (collector-inbox).
 *
 * WHAT THIS OBEYS, in order, before any walk:
 *   1. the server's kill switch (paused) and enablement,
 *   2. the daily cap, counted server-side so restarts cannot reset it,
 *   3. the active hours, in IST, because that is where the desks are,
 *   4. the minimum gap between walks, plus this file's own jitter,
 *   5. the per-platform pacing inside each walk (browser.ts owns that).
 * A collector that cannot reach the server does nothing: silence from the
 * server is treated as "stop", never as "carry on as before".
 *
 * ONE HONESTY RULE CARRIED OVER: a failed walk is reported as a failure
 * entry, never as an empty reading. An office must be able to tell "the
 * account posted nothing" from "the session expired" on the screens, so the
 * two must stay different objects on the wire.
 */
import { createInterface } from 'node:readline/promises'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { closeContext } from './browser'
import { runComments, runSnapshot } from './orchestrate'
import { isPlatform } from './types'
import { readSessionReport } from './session-store'

const API = (process.env['COLLECTOR_API'] ?? 'https://signallalert.netlify.app').replace(/\/$/, '')
const SESSION_FILE = join(process.cwd(), '.collector-session.json')
const VERSION = 'collector/0.1.0'

const log = (msg: string) => console.log(`[collector] ${msg}`)

/* ── the desk session ────────────────────────────────────────────────────── */

interface DeskSession {
  deskId: string
  name: string
  token: string
  expiresAt: string
}

function readSession(): DeskSession | null {
  if (!existsSync(SESSION_FILE)) return null
  try {
    const s = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as DeskSession
    if (!s.token || !s.deskId) return null
    if (Date.parse(s.expiresAt) < Date.now()) {
      log('the desk session has expired; run `npm run collector -- signin <deskId>`')
      return null
    }
    return s
  } catch {
    return null
  }
}

async function signin(deskId: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  // Plain input, said plainly. Hiding keystrokes needs a raw-mode dance that
  // breaks on half the Windows terminals offices actually use; a visible
  // passphrase typed once on the office's own machine is the lesser evil.
  const passphrase = (await rl.question(`Passphrase for desk "${deskId}": `)).trim()
  rl.close()
  const res = await fetch(`${API}/api/desk-auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'signin', deskId, passphrase }),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    log(`sign-in refused: ${String(body['error'] ?? res.status)}`)
    process.exitCode = 1
    return
  }
  const session: DeskSession = {
    deskId,
    name: String(body['name'] ?? deskId),
    token: String(body['token']),
    expiresAt: String(body['expiresAt']),
  }
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2))
  log(`signed in to "${session.name}" until ${session.expiresAt.slice(0, 10)}`)
}

/* ── talking to the server ───────────────────────────────────────────────── */

interface Policy {
  enabled: boolean
  paused: boolean
  dailyCap: number
  activeHoursIst: [number, number]
  minGapMs: number
}

interface Job {
  id: string
  kind: 'posts' | 'comments'
  platform: string
  handle: string | null
  url: string | null
  handleId: string
  limit: number
  why: string
}

interface JobSlice {
  policy: Policy
  walkedToday: number
  jobs: Job[]
  note: string | null
}

async function fetchJobs(s: DeskSession): Promise<JobSlice | null> {
  try {
    const res = await fetch(`${API}/api/collector-jobs`, {
      headers: { authorization: `Bearer ${s.token}` },
    })
    if (res.status === 401) {
      log('the desk session was refused; sign in again')
      return null
    }
    if (!res.ok) {
      log(`the job board answered ${res.status}; doing nothing this round`)
      return null
    }
    return (await res.json()) as JobSlice
  } catch (err) {
    log(`the job board is unreachable (${(err as Error).message}); doing nothing this round`)
    return null
  }
}

interface Entry {
  id: string
  kind: 'snapshot' | 'comments' | 'walk-failed'
  handleId: string
  platform: string
  url: string | null
  payload: unknown
  readAt: string
  collector: string
}

async function report(s: DeskSession, entries: Entry[]): Promise<void> {
  if (entries.length === 0) return
  try {
    const res = await fetch(`${API}/api/collector-inbox`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` },
      body: JSON.stringify({ entries }),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    log(
      res.ok
        ? `reported ${String(body['stored'])} readings${Number(body['dropped']) > 0 ? `, ${String(body['dropped'])} dropped` : ''}`
        : `the inbox refused the report: ${res.status}`,
    )
  } catch (err) {
    log(`the inbox is unreachable (${(err as Error).message}); readings from this slice are lost and will be re-walked`)
  }
}

/* ── doing the work ──────────────────────────────────────────────────────── */

const istHour = (): number => (new Date(Date.now() + 5.5 * 3_600_000).getUTCHours() + 24) % 24

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const jitter = (ms: number): number => Math.round(ms * (1 + Math.random() * 0.5))

async function executeJob(job: Job): Promise<Entry> {
  const base = {
    id: job.id,
    handleId: job.handleId,
    platform: job.platform,
    url: job.url,
    readAt: new Date().toISOString(),
    collector: VERSION,
  }
  if (!isPlatform(job.platform)) {
    return { ...base, kind: 'walk-failed', payload: { reason: `unknown platform ${job.platform}` } }
  }
  if (job.kind === 'posts' && job.handle) {
    const walk = await runSnapshot(job.platform, job.handle, job.limit, log)
    if (!walk.ok) {
      return { ...base, kind: 'walk-failed', payload: { reason: walk.reason, needsLogin: walk.needsLogin === true } }
    }
    return {
      ...base,
      kind: 'snapshot',
      payload: {
        followers: walk.profile?.followers ?? null,
        displayName: walk.profile?.displayName ?? null,
        avatarUrl: walk.profile?.avatarUrl ?? null,
        posts: walk.items,
        ...(walk.note ? { note: walk.note } : {}),
      },
    }
  }
  if (job.kind === 'comments' && job.url) {
    const walk = await runComments(job.platform, job.url, job.limit, log)
    if (!walk.ok) {
      return { ...base, kind: 'walk-failed', payload: { reason: walk.reason, needsLogin: walk.needsLogin === true } }
    }
    return {
      ...base,
      kind: 'comments',
      payload: { comments: walk.items, ...(walk.note ? { note: walk.note } : {}) },
    }
  }
  return { ...base, kind: 'walk-failed', payload: { reason: 'malformed job' } }
}

async function runOnce(s: DeskSession): Promise<'worked' | 'idle' | 'stop'> {
  const slice = await fetchJobs(s)
  if (!slice) return 'idle'
  const { policy } = slice
  if (!policy.enabled) {
    log('the collector is not enabled for this desk; ask the operator to turn it on')
    return 'stop'
  }
  if (policy.paused) {
    log('paused from the server; standing by')
    return 'idle'
  }
  const hour = istHour()
  const [from, to] = policy.activeHoursIst
  if (hour < from || hour >= to) {
    log(`outside active hours (${from}:00 to ${to}:00 IST); standing by`)
    return 'idle'
  }
  if (slice.jobs.length === 0) {
    log(slice.note ?? 'nothing to do')
    return 'idle'
  }

  log(`${slice.jobs.length} jobs this slice (${slice.walkedToday} walks already today)`)
  const entries: Entry[] = []
  let sawLoginWall = false
  for (const job of slice.jobs) {
    log(`walk: ${job.kind} ${job.platform} ${job.handle ?? job.url ?? ''} (${job.why})`)
    const entry = await executeJob(job)
    entries.push(entry)
    if (entry.kind === 'walk-failed' && (entry.payload as { needsLogin?: boolean }).needsLogin) {
      sawLoginWall = true
      log('LOGIN WALL: the session needs a human. Run `npm run scraper:login`. Stopping this slice.')
      break
    }
    await sleep(jitter(policy.minGapMs))
  }
  await report(s, entries)
  return sawLoginWall ? 'stop' : 'worked'
}

/* ── commands ────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const once = process.argv.includes('--once')

  if (cmd === 'signin' && arg) return await signin(arg)

  if (cmd === 'status') {
    const s = readSession()
    if (!s) return log('no desk session; run `npm run collector -- signin <deskId>`')
    log(`desk: ${s.name} (${s.deskId}), token until ${s.expiresAt.slice(0, 10)}`)
    log(`browser session: ${JSON.stringify(readSessionReport())}`)
    const slice = await fetchJobs(s)
    if (slice) {
      log(`policy: ${JSON.stringify(slice.policy)}`)
      log(`walked today: ${slice.walkedToday}`)
      log(`would run now: ${slice.jobs.length ? slice.jobs.map((j) => j.id).join(', ') : slice.note}`)
    }
    return
  }

  if (cmd === 'run') {
    const s = readSession()
    if (!s) return log('no desk session; run `npm run collector -- signin <deskId>`')
    log(`working for "${s.name}" against ${API}`)
    try {
      for (;;) {
        const outcome = await runOnce(s)
        if (once || outcome === 'stop') break
        // Idle polls stay slow on purpose: a collector that hammers the job
        // board when there is nothing to do is spending requests to learn
        // nothing. Ten minutes idle, one minute between working slices.
        await sleep(jitter(outcome === 'worked' ? 60_000 : 600_000))
      }
    } finally {
      await closeContext().catch(() => {})
    }
    return
  }

  log('usage: collector -- signin <deskId> | status | run [--once]')
}

void main()
