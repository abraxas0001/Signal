import type { Config, Context } from '@netlify/functions'
import { planRecovery, type RecoveryInput } from './lib/recovery'

/**
 * A plan for repairing standing, from criticism already gathered.
 *
 *   POST /api/recovery { name, role, constituency, party, score, criticism, ... }
 *
 * One step, not two, unlike /api/opinion and /api/compare next door. Those are
 * split because a grounded web search plus a structuring call will not fit in
 * one runtime window. This does no search at all: the evidence arrived with the
 * request, having been paid for by the opinion pass, so it is a single model
 * call and finishes well inside the budget.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const text = (v: unknown, cap = 400): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, cap) : null
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null

/** Themes off the wire, capped so a huge body cannot become a huge prompt. */
function themes(
  raw: unknown,
  cap: number,
): { label: string; detail: string; weight?: string | null; who?: string | null }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .map((t) => ({
      label: text(t['label'], 160) ?? '',
      detail: text(t['detail'], 600) ?? '',
      weight: text(t['weight'], 20),
      who: text(t['who'], 120),
    }))
    .filter((t) => t.label || t.detail)
    .slice(0, cap)
}

export default async function handler(req: Request, _c: Context): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Send a POST.' }, 405)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'That request was not valid JSON.' }, 400)
  }

  const name = text(body['name'], 120)
  if (!name) return json({ error: 'Name the person this plan is for.' }, 400)

  const criticism = themes(body['criticism'], 8)
  const controversies = themes(body['controversies'], 6)

  /**
   * Nothing to plan against is a refusal, not an empty plan.
   *
   * Asked to repair a reputation with no criticism in front of it, a model will
   * invent something plausible to repair. That would put fabricated attacks on
   * an office's screen, which is the single worst thing this feature could do.
   */
  if (criticism.length === 0 && controversies.length === 0) {
    return json({
      error:
        'There is no criticism on file to work from. Read the opinion first, and if it comes back clean there is nothing here to fix.',
    })
  }

  const input: RecoveryInput = {
    name,
    role: text(body['role'], 120),
    constituency: text(body['constituency'], 120),
    party: text(body['party'], 120),
    score: num(body['score']) ?? 0,
    favourable: num(body['favourable']),
    hostile: num(body['hostile']),
    verdict: text(body['verdict'], 600),
    criticism,
    praise: themes(body['praise'], 6),
    controversies,
  }

  const started = Date.now()
  const plan = await planRecovery(input)
  if (!plan) {
    return json({
      error: 'No language model is configured, so the plan could not be written. Set a provider key.',
      ms: Date.now() - started,
    })
  }
  return json({ ...plan, ms: Date.now() - started })
}

export const config: Config = {
  path: '/api/recovery',
  /**
   * One model call, run when somebody presses a button on a screen they had to
   * pay for a search to reach. Generous, but not an invitation to loop it.
   */
  rateLimit: { windowLimit: 10, windowSize: 120, aggregateBy: ['ip'] },
}
