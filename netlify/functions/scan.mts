import type { Config, Context } from '@netlify/functions'
import { scanPortals, type Candidate, type HarvestMode } from './lib/scan'
import {
  judgeRelevance,
  type RelevanceCandidate,
  type RelevanceConfidence,
  type RelevanceSubject,
  type RelevanceVerdict,
} from './lib/relevance'

/**
 * Find today's stories on the mastheads a desk follows, and say which of them
 * are actually this office's business.
 *
 * Split from /api/grievance on purpose. Classifying a story in full is two
 * model calls per story and a batch of ten already fills the window; finding is
 * a handful of page reads. Keeping them apart means the operator sees what was
 * found in a couple of seconds and decides what to spend the model on, instead
 * of waiting on a request that does both and times out.
 *
 * TWO SHAPES, AND THE OLD ONE IS UNTOUCHED.
 *
 * Without `subject` this behaves exactly as it did: the desk's words gate the
 * harvest, matching stories come back, nothing is judged and no model is
 * called. Every existing caller is on this path and none of them changes.
 *
 * With `subject` the pipeline inverts. The harvest stops filtering and returns
 * far more than the words would have found, then relevance.ts reads the
 * candidates and rules on each one. Both halves are needed: widening alone
 * floods the desk, and judging alone cannot rule on a story the words never let
 * through. The office reported the two failures separately and they are one
 * bug.
 *
 * NOTHING IS DELETED HERE. Unrelated stories come back flagged, not dropped.
 * The screen decides what to render, and it has to be able to show the office
 * what was rejected and why. A desk that silently discards a story is
 * indistinguishable from a scan that never found it, and the office has no way
 * to tell a working filter from a broken scan.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

interface Body {
  portals?: unknown
  customUrls?: unknown
  city?: unknown
  state?: unknown
  tags?: unknown
  broadTags?: unknown
  subject?: unknown
  harvest?: unknown
  judgeLimit?: unknown
}

const strings = (v: unknown, cap: number): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, cap)
    : []

const text = (v: unknown, cap = 160): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, cap) : null
}

/**
 * How many stories one request will pay to have read.
 *
 * Judging is three batches of fifteen at the default, and the ceiling is what
 * the harvest can return. The number is low because the constraint is not our
 * patience, it is the provider: a free Groq key meters tokens per minute and
 * counts the whole request against the allowance before generating, so
 * consecutive batches are rate-limited rather than merely slow. When that
 * happens the unread stories come back unjudged with the provider's own
 * explanation attached, which is the honest outcome.
 */
const DEFAULT_JUDGE_LIMIT = 45
const MAX_JUDGE_LIMIT = 90

/**
 * When to stop starting new work, measured from the top of the request.
 *
 * THIS IS SIZED FOR THE PLATFORM, NOT FOR THE JUDGE. `netlify.toml` asks for a
 * sixty-second function, but Netlify hard-caps a synchronous function well
 * below that on a standard plan, and when the wall-clock crosses that cap the
 * platform KILLS the function and answers the browser with an HTML error page.
 * The office then saw "Unexpected token '<'... is not valid JSON", very often,
 * because a judged scan of real mastheads routinely ran past the cap: ten-odd
 * seconds of concurrent fetches plus a forty-five-second judge is nearly a
 * minute, and the function never lived to return it.
 *
 * So the whole request is budgeted to finish inside a cap it can actually
 * count on. The judge stops launching batches at the budget, measured from the
 * top of the request so the fetches it followed are already counted, and the
 * response is assembled from what was judged in time; the rest come back
 * unjudged, which is a real and honest state the desk already renders. A
 * partial answer that arrives beats a complete one the platform throws away.
 *
 * Env-tunable, like daily-scan's RUN_BUDGET_MS, so an operator who knows their
 * plan allows longer can raise it without a deploy. The default leaves a
 * two-second margin under the 26-second cap the current runtime enforces.
 */
const JUDGE_DEADLINE_MS = Math.max(
  8_000,
  Number(process.env['SCAN_BUDGET_MS']) || 24_000,
)

/** The reading attached to one story, or nulls when nobody read it. */
interface JudgedCandidate extends Candidate {
  verdict: RelevanceVerdict | null
  confidence: RelevanceConfidence | null
  why: string | null
}

/**
 * The office, off the wire.
 *
 * Returns null when there is no usable name. A subject with no name cannot be
 * judged against, and quietly judging against an empty string would produce
 * confident verdicts about nobody.
 */
function readSubject(raw: unknown): RelevanceSubject | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const name = text(o['name'], 120)
  if (!name) return null
  return {
    name,
    role: text(o['role'], 120),
    constituency: text(o['constituency'], 120),
    state: text(o['state'], 120),
    party: text(o['party'], 120),
    aliases: strings(o['aliases'], 12).map((a) => a.trim().slice(0, 60)),
    // The desk's own gazetteer: towns, mandals and spellings of the district
    // it is configured for. Forty because a seat has seven segments and each
    // carries several spellings, and a judge told where the seat IS stops
    // placing headlines from its own general knowledge.
    places: strings(o['places'], 40).map((a) => a.trim().slice(0, 60)),
  }
}

export default async function handler(req: Request, _context: Context): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Send a POST with the mastheads to read.' }, 405)
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json({ error: 'That request was not valid JSON.' }, 400)
  }

  const portals = strings(body.portals, 12)
  const customUrls = strings(body.customUrls, 12)
  const tags = strings(body.tags, 30)
  // Words too wide to stand alone. See ScanInput.broadTags.
  const broadTags = strings(body.broadTags, 8)
  const city = text(body.city, 120)
  /**
   * The state, which scanPortals has always accepted and this endpoint never
   * passed on. Without it a district the region list does not carry resolves to
   * no state at all and a national masthead is sent to its default section,
   * which is how a desk in one state came back reading another's news.
   */
  const state = text(body.state, 120)

  if (portals.length === 0 && customUrls.length === 0) {
    return json(
      { error: 'Choose at least one masthead, or add the address of one, before scanning.' },
      400,
    )
  }

  // A subject that arrived without a name is a mistake worth naming, not one to
  // work around: the caller asked for judgement and would otherwise be handed a
  // plain scan that looks like a judged one.
  const subject = readSubject(body.subject)
  if (body.subject !== undefined && !subject) {
    return json(
      {
        error:
          'The subject needs a name before a story can be judged against it. Send the name, or leave the subject out to scan on your words alone.',
      },
      400,
    )
  }

  /**
   * The harvest widens only when somebody is going to read the result.
   *
   * With a subject the default flips to wide, because that is the whole point
   * of sending one. A caller can still ask for "matched" alongside a subject,
   * which judges only the stories the words already found. That alone fixes the
   * sport showing up on the grievance screen, and it is the cheaper half.
   */
  const requested = body.harvest === 'wide' || body.harvest === 'matched' ? body.harvest : null
  const harvest: HarvestMode = requested ?? (subject ? 'wide' : 'matched')

  const judgeLimit = Math.max(
    1,
    Math.min(
      MAX_JUDGE_LIMIT,
      typeof body.judgeLimit === 'number' && Number.isFinite(body.judgeLimit)
        ? Math.round(body.judgeLimit)
        : DEFAULT_JUDGE_LIMIT,
    ),
  )

  const started = Date.now()
  let result
  try {
    result = await scanPortals({ portals, customUrls, city, state, tags, broadTags, harvest })
  } catch (err) {
    return json(
      {
        error: `The scan did not finish: ${err instanceof Error ? err.message : String(err)}`,
        ms: Date.now() - started,
      },
      502,
    )
  }

  /*
    No subject: the original behaviour. The same candidates, chosen the same
    way, with no model call and no verdicts.

    The body carries two fields it did not before, `harvest` and `matchedCount`,
    and nothing else has moved. Adding a field is safe for the existing readers
    here, which name the fields they want; removing or renaming one would not
    be, which is why none of them changed.
  */
  if (!subject) return json({ ...result, ms: Date.now() - started })

  const toJudge: RelevanceCandidate[] = result.candidates
    .slice(0, judgeLimit)
    .map((c) => ({ url: c.url, title: c.title, portal: c.portal }))

  const relevance = await judgeRelevance(toJudge, subject, {
    deadline: started + JUDGE_DEADLINE_MS,
  })

  const byUrl = new Map(relevance.judgements.map((j) => [j.url, j]))
  const candidates: JudgedCandidate[] = result.candidates.map((c) => {
    const j = byUrl.get(c.url)
    // Null, not "unrelated". Nobody read this one, and saying it was ruled out
    // would be a claim no model made.
    return {
      ...c,
      verdict: j?.verdict ?? null,
      confidence: j?.confidence ?? null,
      why: j?.why ?? null,
    }
  })

  const count = (v: RelevanceVerdict): number =>
    candidates.filter((c) => c.verdict === v).length

  const judged = candidates.filter((c) => c.verdict !== null).length
  const unrelated = count('unrelated')

  /*
    The judge's notes go in both places, and that is deliberate.

    `relevance.notes` keeps the block self-contained for a screen built around
    it. Copying them into `notes` means a caller that only renders `notes` still
    sees "no language model is configured" rather than quietly showing a list of
    stories nobody read. A renderer that shows both will repeat itself, so it
    should pick one.
  */
  const notes = [...result.notes, ...relevance.notes]
  if (result.candidates.length > judgeLimit) {
    /*
      Say what being unjudged now costs a story.
      
      It used to be harmless: the desk showed unjudged stories, so "listed
      unjudged" meant "shown, with a label". It is not harmless any more. A
      story swept up by the wide harvest and never read has no evidence of any
      kind behind it, so the desk sets it aside rather than opening on it, and
      a note that does not say so describes the old behaviour.
    */
    notes.push(
      `Read ${result.candidates.length} stories and sent the best-ranked ${judgeLimit} to be judged. The rest are returned unjudged, and a desk that asked for a wide harvest sets those aside rather than showing them.`,
    )
  }

  return json({
    candidates,
    sources: result.sources,
    notes,
    harvest: result.harvest,
    matchedCount: result.matchedCount,
    relevance: {
      judged: relevance.judged,
      provider: relevance.provider,
      notes: relevance.notes,
      counts: {
        /** Everything the harvest returned, after de-duplication and capping. */
        harvested: candidates.length,
        /** How many of those a model actually ruled on. */
        judged,
        /** Harvested but never read, whether by rate limit, timeout or no key. */
        unjudged: candidates.length - judged,
        aboutPerson: count('about-person'),
        aboutSeat: count('about-seat'),
        aboutParty: count('about-party'),
        unrelated,
        /**
         * What a desk would show if it filtered on this pass.
         *
         * Everything except the stories a model read and ruled out. Unjudged
         * stories are counted as kept on purpose: nobody has decided anything
         * about them, and hiding them behind a decision that was never taken is
         * the failure this whole endpoint exists to stop.
         */
        kept: candidates.length - unrelated,
      },
    },
    ms: Date.now() - started,
  })
}

export const config: Config = {
  path: '/api/scan',
  /**
   * Reading eight index pages is cheap but not instant, and each one is a live
   * request to somebody else's server. This is generous for an office scanning
   * its mastheads a few times a morning and stops a script hammering them.
   *
   * The judged path costs a model call per fifteen stories on top of that, so
   * the same ceiling now also protects a metered provider key from a loop.
   */
  rateLimit: { windowLimit: 20, windowSize: 120, aggregateBy: ['ip'] },
}
