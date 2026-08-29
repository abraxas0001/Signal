import type { Config, Context } from '@netlify/functions'
import { settingsKeyFrom, settingsKeyOk } from './lib/admin-gate'
import {
  isDeskRelevant,
  listDesks,
  markServerScan,
  readDesk,
  registryConfigured,
  storeFindings,
  type DeskFinding,
  type DeskRecord,
} from './lib/desk-registry'
import { judgeRelevance, type RelevanceCandidate, type RelevanceJudgement } from './lib/relevance'
import { scanPortals } from './lib/scan'
import { partyAbbreviation } from '../../shared/identity'

/**
 * The scan that runs when the office is shut.
 *
 *   GET /api/daily-scan?key=...              — every enabled desk, for real
 *   GET /api/daily-scan?key=...&deskId=x     — one desk, named
 *   GET /api/daily-scan?key=...&dry=1        — say what it WOULD do, write nothing
 *   GET /api/daily-scan?key=...&force=1      — read a desk again inside its 20h window
 *
 * `src/lib/morning-scan.ts` reads the papers on the office's own machine, and
 * on opening it now reads back over the mornings the tab was closed for. That
 * covers an office that comes back. It does not cover the thing the owner
 * actually asked for, which is a desk that is current when they arrive rather
 * than one that starts working when they do. A browser tab is not a scheduler:
 * it stops existing when somebody closes a laptop, and no amount of care in the
 * client changes that.
 *
 * So this is the same reading, done on a schedule, for the desks that asked.
 *
 * WHAT IT DOES. For each enabled desk in the register it runs `scanPortals` —
 * the same word matcher the client's scan uses, over the same mastheads — and
 * then hands what comes back to `judgeRelevance`, which is the semantic layer
 * that decides whether a story is really about the member, their seat, their
 * party, or nothing to do with them. Word matching alone is what admits a
 * cricket report because a player shares the member's name, and what misses
 * "the Mahabubnagar MP said" because no watch word appears in it. The judged
 * results are filed under the desk and the app picks them up through
 * GET /api/desk-registry?deskId=x&findings=1.
 *
 * WHAT IT DOES NOT DO. It does not analyse anything. Reading a story for
 * grievances is two model calls per story and it is not something to spend on
 * an office's behalf, at night, without being asked. Judging relevance is one
 * short call per fifteen headlines and it is the difference between a list
 * worth opening and a list nobody opens twice.
 *
 * PRIVACY, WHICH IS THE WHOLE REASON THIS IS OPT-IN. Running here means a real
 * politician's name, seat, party and watch list are stored on a server, which
 * is exactly what the rest of this product refuses to do by default. Nothing
 * registers itself. A desk appears in the register only when somebody with the
 * office's settings key POSTs it to /api/desk-registry, and it leaves the
 * moment they DELETE it. This function reads the register and never adds to it.
 *
 * BY HAND, FROM THE OFFICE'S OWN MACHINE. That was asked for by name, so that
 * an office can check the platform is doing what it claims and fill in anything
 * missing. Every parameter above works from a terminal with the settings key,
 * and `dry=1` reports the plan without writing a thing.
 *
 * SCHEDULING. This function cannot schedule itself, and the reason is narrower
 * than the one at the foot of auto-sync-posts.mts. The `Config` type in the
 * installed @netlify/functions DOES carry a `schedule` field, but it is
 * declared `path?: never` alongside it: a function may have a URL path or a
 * cron, not both. This one has to have a path, because being runnable by hand
 * from the office's own machine was the requirement. So the cron belongs in
 * netlify.toml, which this function does not own. The exact block is in this
 * change's handover notes; until it exists, this runs only when it is called.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

/**
 * How long a run may take before it stops starting new work.
 *
 * Forty-five seconds, sized for the sixty this function can be granted rather
 * than for the fifteen minutes a scheduled function gets. It has a URL path, so
 * every invocation of it is synchronous and bounded by the platform's
 * synchronous ceiling; netlify.toml's own comments put that at sixty seconds.
 * The fifteen extra are for the desks already read to be written and the
 * response assembled, because a kill in that window loses work that was done.
 *
 * The budget is respected by refusing to START a desk there is no time to
 * finish. A desk half scanned and then killed writes nothing and tells nobody;
 * a desk skipped is counted in the reply and picked up by the next run, which
 * is why the schedule in the handover notes repeats rather than firing once.
 *
 * Raise it with DAILY_SCAN_BUDGET_MS only alongside a matching `timeout` in
 * netlify.toml. A budget larger than the platform's window does not buy time,
 * it converts a short honest answer into no answer at all.
 */
const RUN_BUDGET_MS = (() => {
  const raw = Number(process.env['DAILY_SCAN_BUDGET_MS'])
  return Number.isFinite(raw) && raw >= 20_000 && raw <= 840_000 ? raw : 45_000
})()

/** Room a single desk needs before it is worth beginning. */
const PER_DESK_MIN_MS = 25_000

/**
 * How much of a desk's remaining budget the relevance pass may have.
 *
 * The harvest has to finish first or there is nothing to judge, so the judge
 * gets what is left rather than a fixed slice. `judgeRelevance` takes a
 * deadline and stops between batches, returning what it has already ruled on.
 */
const JUDGE_RESERVE_MS = 8_000

/**
 * How many stories from one desk are judged.
 *
 * `scanPortals` caps its own output at 90 in wide mode, which for a desk on a busy day is
 * eight batches of model calls for one office. Forty is a morning's coverage by
 * any reasonable measure, and the response says when it was applied rather than
 * letting an office believe forty was all there was.
 */
const MAX_JUDGED_PER_DESK = 40

/**
 * How many desks one run touches.
 *
 * The register is expected to hold a handful of offices, not a directory. This
 * exists so that a register that has grown past what a run can finish is
 * reported as such instead of being silently truncated by the platform killing
 * the function halfway down the list.
 */
const MAX_DESKS_PER_RUN = 25

/**
 * How recently a desk has to have been scanned to be left alone.
 *
 * Twenty hours, which is under a day so the daily cron never skips its own
 * slot, and long enough that a second run in the same morning does nothing.
 *
 * This is not only tidiness. It is what makes the schedule idempotent — a cron
 * that fires twice, or a retry after a timeout, must not pay for the same
 * morning twice — and it is what bounds the cost of the unauthenticated
 * scheduled path below. Somebody who guesses the path and forges a scheduler
 * request gets one run's work at most, and every call after it finds every desk
 * already current and does nothing at all.
 */
const SERVER_SCAN_FRESH_MS = 20 * 60 * 60 * 1000

/** What happened to one desk, in a shape that reads as a sentence. */
interface DeskOutcome {
  deskId: string
  name: string
  /** Sources the scan actually read, and how each one answered. */
  sources: { portal: string; found: number; error: string | null }[]
  /** Stories the word matcher kept. */
  harvested: number
  /** Stories handed to the relevance pass. */
  sent: number
  /** Whether the relevance pass ran at all. False means nothing was judged. */
  judged: boolean
  /** Ruled to be about the member or their seat. Null when nothing was judged. */
  relevant: number | null
  /** Ruled to be about the party or unrelated. Null when nothing was judged. */
  setAside: number | null
  /** Rows written to the register. Zero on a dry run, and it says so. */
  written: number
  notes: string[]
  error: string | null
}

/**
 * The words too wide to stand alone, rebuilt from the desk record.
 *
 * `worthKeeping` in lib/scan.ts needs to know which of a desk's watch terms are
 * broad, or a desk watching "BJP" is handed the national wire: twenty-three
 * stories one morning, a Kolkata meeting and a shootout in Karnataka among
 * them, none of them about the member. The client works this out from the
 * identity before it calls; here it has to be recovered from the record, so it
 * is derived from the party and the state and then intersected with the terms
 * the desk actually watches. A broad word the desk does not watch is not a
 * broad word, it is nothing.
 */
function broadTermsFor(desk: DeskRecord): string[] {
  const wide = new Set<string>()
  const add = (value: string | null): void => {
    const t = value?.trim()
    if (t) wide.add(t.toLowerCase())
  }
  add(desk.party)
  add(partyAbbreviation(desk.party))
  add(desk.state)

  return desk.watchTerms.filter((t) => wide.has(t.trim().toLowerCase()))
}

/** Whether this desk's last server scan is recent enough to skip it. */
function isCurrent(lastServerScanAt: string | null, now: number): boolean {
  if (!lastServerScanAt) return false
  const at = Date.parse(lastServerScanAt)
  // An unparseable stamp is treated as never scanned. Skipping a desk on the
  // strength of a date nothing could read would be the one failure that looks
  // exactly like a working schedule.
  if (!Number.isFinite(at)) return false
  return now - at < SERVER_SCAN_FRESH_MS
}

/** Scan and judge one desk. Never throws: a bad desk must not end the run. */
async function scanDesk(
  desk: DeskRecord,
  opts: { dry: boolean; scanId: string; deadline: number },
): Promise<DeskOutcome> {
  const outcome: DeskOutcome = {
    deskId: desk.deskId,
    name: desk.name,
    sources: [],
    harvested: 0,
    sent: 0,
    judged: false,
    relevant: null,
    setAside: null,
    written: 0,
    notes: [],
    error: null,
  }

  let harvest
  try {
    harvest = await scanPortals({
    /**
     * Wide, not word-matched. Harvesting only the headlines that already carry
     * a watch word fixes the sport getting in and does nothing about the
     * stories being missed, which was the more damaging half: a Union Budget
     * piece about Telangana farmers names neither the member nor her seat and
     * never reached the desk. Judging costs a model call per fifteen
     * headlines, which is the deliberate price of the other half.
     */
    harvest: 'wide',
      portals: desk.portals,
      customUrls: desk.customPortalUrls,
      state: desk.state,
      // The district is not on the record, so the seat is what routes a
      // publisher's local edition. Several Telugu publishers serve that edition
      // on the reader's location rather than the address anyway, which is why
      // the watch terms matter more here than the routing does.
      city: desk.constituency,
      tags: desk.watchTerms,
      broadTags: broadTermsFor(desk),
    })
  } catch (err) {
    outcome.error = `The mastheads could not be read: ${
      err instanceof Error ? err.message : String(err)
    }`
    return outcome
  }

  outcome.sources = harvest.sources.map((s) => ({
    portal: s.portal,
    found: s.found,
    error: s.error,
  }))
  outcome.harvested = harvest.candidates.length
  outcome.notes.push(...harvest.notes)

  if (harvest.candidates.length === 0) {
    outcome.notes.push(
      `Nothing on these mastheads carried one of the desk's words this morning. That is a real quiet morning unless a source above reports an error.`,
    )
    return outcome
  }

  const shortlist = harvest.candidates.slice(0, MAX_JUDGED_PER_DESK)
  if (harvest.candidates.length > shortlist.length) {
    outcome.notes.push(
      `Judged the ${shortlist.length} best word matches of ${harvest.candidates.length}. The rest were found but not judged, so they are not filed.`,
    )
  }
  outcome.sent = shortlist.length

  const candidates: RelevanceCandidate[] = shortlist.map((c) => ({
    url: c.url,
    title: c.title,
    portal: c.portal,
  }))

  const ruling = await judgeRelevance(
    candidates,
    {
      name: desk.name,
      role: desk.role,
      constituency: desk.constituency,
      state: desk.state,
      party: desk.party,
      aliases: desk.aliases,
    },
    { deadline: opts.deadline - JUDGE_RESERVE_MS },
  )

  outcome.judged = ruling.judged
  outcome.notes.push(...ruling.notes)

  const byUrl = new Map<string, RelevanceJudgement>()
  for (const j of ruling.judgements) byUrl.set(j.url, j)

  if (ruling.judged) {
    outcome.relevant = shortlist.filter((c) => isDeskRelevant(byUrl.get(c.url)?.verdict ?? null))
      .length
    outcome.setAside = ruling.counts.answered - outcome.relevant
    if (ruling.counts.answered < shortlist.length) {
      outcome.notes.push(
        `${shortlist.length - ruling.counts.answered} of the ${
          shortlist.length
        } stories came back without a verdict and are filed unjudged rather than filed as unrelated.`,
      )
    }
  } else {
    /*
      Nothing judged them, and they are filed anyway.

      This is the honest half of the design. `judgeRelevance` returns
      `judged: false` when no provider key is configured rather than ruling
      everything unrelated, so the alternative here is to file nothing at all
      and leave an office that has no model key with an automation that appears
      to run every night and never produces anything. A word match is still a
      real finding; it is just a weaker claim, and the record says which it is.
    */
    outcome.notes.push(
      `Nothing judged these stories, so they are filed as word matches with no verdict. They are what the mastheads carried that contained one of the desk's words, which is a weaker claim than a story being about the member.`,
    )
  }

  const foundAt = new Date().toISOString()
  const findings: Omit<DeskFinding, 'id'>[] = shortlist.map((c) => {
    const judgement = byUrl.get(c.url)
    return {
      url: c.url,
      title: c.title,
      portal: c.portal,
      matched: c.matched,
      verdict: judgement?.verdict ?? null,
      confidence: judgement?.confidence ?? null,
      why: judgement?.why ?? null,
      foundAt,
      scanId: opts.scanId,
    }
  })

  if (opts.dry) {
    outcome.notes.push(
      `This was a dry run. ${findings.length} ${
        findings.length === 1 ? 'story' : 'stories'
      } would have been filed and nothing was written.`,
    )
    return outcome
  }

  const stored = await storeFindings(desk.deskId, findings)
  if (!stored.ok) {
    outcome.error = stored.note
    return outcome
  }
  outcome.written = stored.value.written

  const stamped = await markServerScan(desk.deskId, foundAt)
  if (!stamped.ok) {
    // The stories are filed; only the bookkeeping failed. Saying so is better
    // than reporting a failed scan for a desk whose stories are sitting there.
    outcome.notes.push(
      `The stories were filed but the desk's last-scanned time was not updated: ${stamped.note}`,
    )
  }

  return outcome
}

/**
 * Does this look like Netlify's own scheduler rather than a person?
 *
 * A scheduled invocation carries no headers of ours and cannot be given any:
 * the schedule is declared against the function's NAME in netlify.toml, so
 * there is nowhere to attach the office key. Netlify posts a body carrying the
 * next fire time, and that is the only thing distinguishing the call.
 *
 * It is a weak signal and it is treated as one. A request that passes this and
 * not the key gets the reduced run below: it may scan, it may not name a single
 * desk in its reply, and the freshness rule means a second forged call in the
 * same day does nothing. If Netlify ever changes the shape, the schedule starts
 * returning 403 in the function log, which is a failure that announces itself
 * rather than a schedule that quietly stops.
 */
async function looksScheduled(req: Request): Promise<boolean> {
  if (req.method !== 'POST') return false
  try {
    const body = (await req.json()) as Record<string, unknown> | null
    return Boolean(body && typeof body === 'object' && 'next_run' in body)
  } catch {
    return false
  }
}

export default async function handler(req: Request, _ctx: Context): Promise<Response> {
  /**
   * Two ways in, and they are not equal.
   *
   * The office key is the full one: it can name a desk, force a re-scan, ask
   * for a dry run, and it gets a reply that says what happened to which desk by
   * name. That is the "check from our local machine" path.
   *
   * The scheduler gets the other one. It cannot present a key, so it is
   * recognised rather than authenticated, and everything that recognition
   * unlocks is bounded: no desk is named in the reply, no parameters are
   * honoured, and a desk scanned in the last twenty hours is left alone. What a
   * stranger forging that request can achieve is one day's scan that was going
   * to happen anyway.
   */
  const authorised = settingsKeyOk(settingsKeyFrom(req))
  const scheduled = authorised ? false : await looksScheduled(req)

  if (!authorised && !scheduled) {
    return json(
      {
        error:
          'That key is missing or not correct. Pass the office key as ?key= or an x-settings-key header.',
      },
      403,
    )
  }

  const url = new URL(req.url)
  // Only the office key may steer a run. The scheduler runs the plain nightly
  // pass and nothing else, so a forged scheduler request cannot ask for a
  // named desk and read its configuration back out of the reply.
  const dry = authorised && url.searchParams.get('dry') === '1'
  const only = authorised ? url.searchParams.get('deskId') : null
  const force = authorised && url.searchParams.get('force') === '1'

  /**
   * Said once, before any read fails in its own words.
   *
   * A nightly job that answers "Firestore refused to list the desks" on a
   * deploy that never had Firebase credentials sends whoever reads the log
   * hunting for a permissions problem in a project that does not exist.
   */
  if (!registryConfigured()) {
    return json(
      {
        error:
          'This deploy has no Firebase credentials, so there is no desk register and the daily scan has nothing to read. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, then redeploy.',
        configured: false,
      },
      503,
    )
  }

  const started = Date.now()
  const deadline = started + RUN_BUDGET_MS
  const scanId = new Date(started).toISOString()

  /* ── which desks ────────────────────────────────────────────────────────── */

  let desks: DeskRecord[]
  const notes: string[] = []

  if (only) {
    const one = await readDesk(only)
    if (!one.ok) return json({ error: one.note }, 502)
    if (!one.value) {
      return json(
        {
          error: `No desk is registered under "${only}". Register it through POST /api/desk-registry before scanning for it.`,
        },
        404,
      )
    }
    desks = [one.value]
    if (!one.value.enabled) {
      /*
        A named desk is scanned even when it is paused, and the reply says so.

        Asking for one desk by id is somebody at the office checking their own
        setup by hand, which is what "check from our local machine" means. A
        silent skip in that situation looks exactly like a broken scan and sends
        them looking for the fault in the wrong place. The schedule below still
        honours `enabled` absolutely.
      */
      notes.push(
        'This desk is paused, so the scheduled run skips it. It was scanned here because it was asked for by name.',
      )
    }
  } else {
    const all = await listDesks({ enabledOnly: true })
    if (!all.ok) return json({ error: all.note }, 502)
    desks = all.value.slice(0, MAX_DESKS_PER_RUN)
    if (all.value.length > desks.length) {
      notes.push(
        `The register holds ${all.value.length} enabled desks and this run took the first ${desks.length}. The rest were not scanned at all.`,
      )
    }
    if (desks.length === 0) {
      notes.push(
        'No desk has opted in to the server-side scan, so there was nothing to do. A desk is registered through POST /api/desk-registry and never automatically.',
      )
    }
  }

  /* ── run them one at a time ─────────────────────────────────────────────── */

  const results: DeskOutcome[] = []
  const skipped: string[] = []
  let alreadyCurrent = 0

  for (const desk of desks) {
    /*
      A desk read within the last twenty hours is left alone.

      A cron that fires twice, a retry after a platform timeout, and somebody
      running this by hand an hour after the schedule did all arrive here as the
      same request, and none of them should pay for the same morning twice.
      `force=1` with the office key overrides it, which is what an operator
      checking a change wants.
    */
    if (!force && !dry && isCurrent(desk.lastServerScanAt, started)) {
      alreadyCurrent++
      continue
    }

    // Sequential on purpose. Every desk shares one provider key and one pool of
    // outbound sockets, so two desks at once is two rate-limit errors rather
    // than half the wall clock.
    if (deadline - Date.now() < PER_DESK_MIN_MS) {
      skipped.push(desk.deskId)
      continue
    }
    results.push(await scanDesk(desk, { dry, scanId, deadline }))
  }

  if (alreadyCurrent > 0) {
    notes.push(
      `${alreadyCurrent} desk${
        alreadyCurrent === 1 ? ' was' : 's were'
      } read within the last twenty hours and were left alone. Add force=1 with the office key to read them again.`,
    )
  }

  if (skipped.length > 0) {
    notes.push(
      `${skipped.length} desk${
        skipped.length === 1 ? ' was' : 's were'
      } not reached before this run's time ran out${
        authorised ? `: ${skipped.join(', ')}` : ''
      }. They are not scanned until the next run.`,
    )
  }

  const written = results.reduce((sum, r) => sum + r.written, 0)
  const failed = results.filter((r) => r.error !== null).length
  const unjudged = results.filter((r) => !r.judged && r.sent > 0).length

  if (unjudged > 0) {
    notes.push(
      `${unjudged} desk${
        unjudged === 1 ? '' : 's'
      } had stories found but nothing judged them, so those stories are filed as word matches with no verdict. Set a provider key to get verdicts.`,
    )
  }

  const summary = {
    ok: true,
    dry,
    scanId,
    ms: Date.now() - started,
    desks: results.length,
    stories: written,
    failed,
    notes,
  }

  /*
    The per-desk detail is for the office, not for whoever reached the path.

    Each `DeskOutcome` carries a sitting member's name and the mastheads their
    office watches, which is the material this whole feature is careful about.
    A run recognised as the scheduler rather than authenticated by the key gets
    the counts and the sentences and no names at all, so the reduced door cannot
    be used to read the register back out.
  */
  return json(authorised ? { ...summary, results } : summary)
}

export const config: Config = {
  path: '/api/daily-scan',
  method: ['GET', 'POST'],
  /**
   * Ten in ten minutes. A schedule needs one a day and a person checking by
   * hand needs a few in a row, so this is far above either and low enough that
   * a leaked key cannot be looped into a model bill overnight.
   */
  rateLimit: { windowLimit: 10, windowSize: 600, aggregateBy: ['ip'] },
  /*
    SCHEDULING NOTE, and it is not an oversight.

    `schedule` cannot appear beside `path` in this Config: the type declares
    them mutually exclusive, and a path is not optional here because running
    this by hand from the office's own machine is half of what it is for. The
    cron therefore goes in netlify.toml against this function's name, and that
    file belongs to somebody else. The block is in this change's handover notes.

    Until it lands, this is a manual endpoint written to be scheduled: it needs
    no request body, takes no state from its caller, does nothing twice in a day
    of its own accord, and reports everything it did.
  */
}
