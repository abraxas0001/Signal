import type { Config, Context } from '@netlify/functions'
import {
  groundedCompare,
  groundedPerson,
  structureComparison,
  assembleComparison,
  compareSearchAvailable,
  type ComparePerson,
} from './lib/compare'

/**
 * Two politicians, compared on the record, in two steps.
 *
 *   POST /api/compare { step: 'search', who: 'subject', subject }  -> one person
 *   POST /api/compare { step: 'search', who: 'rival',   rival }    -> one person
 *   POST /api/compare { step: 'search', subject, rival }           -> both at once
 *   POST /api/compare { step: 'structure', notes, sources }        -> the comparison
 *
 * The per-person form exists because the both-at-once form could not fit.
 * Researching two politicians with a grounded search measured 18-40s, against
 * a local ceiling of 30s, so it failed perhaps half the time and the screen
 * reported it as a dead network. Splitting the work across two REQUESTS gives
 * each person a whole 30s budget of their own rather than a share of one, and
 * the browser runs them at the same time, so the office waits for the slower
 * of the two rather than for the sum. The old form is kept for callers that
 * have not moved and for anything that would rather have one round trip.
 *
 * Split for the same reason /api/opinion is: the local dev runtime enforces a
 * hard thirty seconds per call whatever netlify.toml says, and a grounded
 * search followed by a structuring call runs well past it. Doing both in one
 * request meant paying for the search and then dying at 30.00s with nothing to
 * show for it — the worst available outcome.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const text = (v: unknown, cap = 160): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, cap) : null
}

/** A person off the request body, or null when they are not named. */
function person(raw: unknown): ComparePerson | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const name = text(r['name'], 120)
  if (!name) return null
  return {
    name,
    role: text(r['role'], 120),
    constituency: text(r['constituency'], 120),
    state: text(r['state'], 80),
    party: text(r['party'], 120),
  }
}

export default async function handler(req: Request, _c: Context): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Send a POST.' }, 405)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'That request was not valid JSON.' }, 400)
  }

  const step = text(body['step'], 20) ?? 'search'
  const started = Date.now()

  /* ── step one: read the web on both of them ──────────────────────────── */

  if (step === 'search') {
    const who = text(body['who'], 10)
    const subject = person(body['subject'])
    const rival = person(body['rival'])

    if (!compareSearchAvailable()) {
      return json({
        notes: null,
        sources: [],
        error: 'No Gemini key is set, so the published record cannot be read.',
      })
    }

    // One person, one request, one whole timeout budget.
    if (who === 'subject' || who === 'rival') {
      const one = who === 'subject' ? subject : rival
      if (!one) {
        return json(
          { error: who === 'subject' ? 'Name the person this desk belongs to.' : 'Name who to compare them against.' },
          400,
        )
      }
      const got = await groundedPerson(one, who === 'subject' ? 'first' : 'second')
      if (!got) {
        return json({
          notes: null,
          sources: [],
          error: `The web search did not answer for ${one.name}. Try again in a minute.`,
          ms: Date.now() - started,
        })
      }
      /**
       * `who` and `name` are echoed so the caller can prove whose notes these
       * are.
       *
       * Not defensive programming for its own sake: running the two searches
       * concurrently against the local dev server produced a response for the
       * subject on the socket that had asked about the rival, twice in four
       * attempts. Whatever the cause, notes silently attributed to the wrong
       * politician would flow straight into a published comparison, and
       * nothing downstream could tell. The caller checks this and discards a
       * reply that answers a question it did not ask.
       */
      return json({
        who,
        name: one.name,
        notes: got.text,
        sources: got.sources,
        ms: Date.now() - started,
      })
    }

    if (!subject) return json({ error: 'Name the person this desk belongs to.' }, 400)
    if (!rival) return json({ error: 'Name who to compare them against.' }, 400)

    const read = await groundedCompare(subject, rival)
    if (!read) {
      return json({
        notes: null,
        sources: [],
        error: 'The web search did not return anything usable. Try again in a minute.',
        ms: Date.now() - started,
      })
    }
    return json({ notes: read.text, sources: read.sources, ms: Date.now() - started })
  }

  /* ── step two: turn it into fields ───────────────────────────────────── */

  if (step === 'structure') {
    const subject = person(body['subject'])
    const rival = person(body['rival'])
    if (!subject || !rival) return json({ error: 'Send both people again with the notes.' }, 400)

    // No cap beyond the sane one: these are research notes, and truncating them
    // silently drops whichever dimension happened to be written last.
    const notes = typeof body['notes'] === 'string' ? body['notes'].slice(0, 40_000) : null
    if (!notes) return json({ error: 'Send the notes from the search step.' }, 400)

    const sources = (Array.isArray(body['sources']) ? body['sources'] : [])
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map((s) => ({
        title: typeof s['title'] === 'string' ? s['title'] : '',
        url: typeof s['url'] === 'string' ? s['url'] : null,
      }))
      .slice(0, 12)

    const parsed = await structureComparison(notes)
    if (!parsed) {
      return json({
        error:
          'The research was gathered but no language model was available to structure it. Set GROQ_API_KEY or GEMINI_API_KEY.',
        ms: Date.now() - started,
      })
    }

    return json({
      ...assembleComparison(parsed, subject, rival, sources),
      ms: Date.now() - started,
    })
  }

  return json({ error: `Unknown step "${step}". Use "search" or "structure".` }, 400)
}

export const config: Config = {
  path: '/api/compare',
  rateLimit: { windowLimit: 8, windowSize: 120, aggregateBy: ['ip'] },
}
