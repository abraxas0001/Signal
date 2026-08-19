import type { Config, Context } from '@netlify/functions'
import {
  groundedRead,
  structureNotes,
  assembleSurvey,
  describeSubject,
  opinionSearchAvailable,
} from './lib/opinion'

/**
 * What the published record says about one person, in two steps.
 *
 *   POST /api/opinion { step: 'search',    name, role, ... }  -> notes + sources
 *   POST /api/opinion { step: 'structure', notes, sources }   -> the survey
 *
 * Split because the local dev runtime enforces a hard thirty seconds per
 * function call whatever netlify.toml says, and a grounded web search followed
 * by a structuring call reliably runs past it. The first version did all the
 * work and then died at exactly 30.00s, returning nothing — the worst possible
 * shape, since it spent the money and produced no answer.
 *
 * Each half now fits comfortably: the search is around fifteen seconds and the
 * structuring around five. The client makes both calls and shows progress
 * between them, which is also a better experience than thirty seconds of one
 * unexplained spinner.
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

  /* ── step one: read the web ──────────────────────────────────────────── */

  if (step === 'search') {
    const name = text(body['name'], 120)
    if (!name) return json({ error: 'Name the person to research.' }, 400)

    if (!opinionSearchAvailable()) {
      return json({
        notes: null,
        sources: [],
        error: 'No Gemini key is set, so the published record cannot be read.',
      })
    }

    const who = describeSubject({
      name,
      role: text(body['role'], 120),
      constituency: text(body['constituency'], 120),
      state: text(body['state'], 80),
      party: text(body['party'], 120),
    })

    const read = await groundedRead(who)
    if (!read) {
      return json({
        notes: null,
        sources: [],
        error: 'The web search did not return anything usable.',
        ms: Date.now() - started,
      })
    }
    return json({ notes: read.text, sources: read.sources, ms: Date.now() - started })
  }

  /* ── step two: turn it into fields ───────────────────────────────────── */

  if (step === 'structure') {
    // No cap: these are research notes and truncating them silently would drop
    // whichever criticism happened to be written last.
    const notes = typeof body['notes'] === 'string' ? body['notes'].slice(0, 40_000) : null
    if (!notes) return json({ error: 'Send the notes from the search step.' }, 400)

    const sources = (Array.isArray(body['sources']) ? body['sources'] : [])
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map((s) => ({
        title: typeof s['title'] === 'string' ? s['title'] : '',
        url: typeof s['url'] === 'string' ? s['url'] : null,
      }))
      .slice(0, 10)

    const parsed = await structureNotes(notes)
    if (!parsed) {
      return json({
        error:
          'The research was gathered but no language model was available to structure it. Set GROQ_API_KEY or GEMINI_API_KEY.',
        ms: Date.now() - started,
      })
    }

    return json({ ...assembleSurvey(parsed, sources), ms: Date.now() - started })
  }

  return json({ error: `Unknown step "${step}". Use "search" or "structure".` }, 400)
}

export const config: Config = {
  path: '/api/opinion',
  rateLimit: { windowLimit: 12, windowSize: 120, aggregateBy: ['ip'] },
}
