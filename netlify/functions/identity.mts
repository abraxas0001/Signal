import type { Config, Context } from '@netlify/functions'
import { resolveIdentity } from './lib/identity'

/**
 * Work out who a desk belongs to.
 *
 *   POST /api/identity  { url }                      — read a public profile
 *   POST /api/identity  { name, role?, state?, ... } — look up a named person
 *
 * This runs once, when somebody sets the app up, and again only when they ask
 * for a refresh. That is why it is allowed to be slower than the other
 * endpoints and why its rate limit is tight: a script hammering this would be
 * spending model tokens on the same person over and over.
 *
 * It answers 200 with a `notes` array in preference to a 4xx wherever the
 * office can still be given something useful. An address that turned out to be
 * a login wall is not an error the setup screen should stop on — it is a fact
 * about that address, and the office should get whatever else was found plus a
 * sentence saying what happened.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

interface Body {
  url?: unknown
  name?: unknown
  role?: unknown
  constituency?: unknown
  state?: unknown
}

const text = (v: unknown, cap = 160): string | null => {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed ? trimmed.slice(0, cap) : null
}

/**
 * The address has to be a public web page.
 *
 * The fetcher enforces the SSRF boundary itself, so this is not the security
 * check — it is the check that produces a sentence a person can act on instead
 * of a stack trace from deep inside a DNS resolution.
 */
function readUrl(raw: string | null): { url: string | null; error: string | null } {
  if (!raw) return { url: null, error: null }

  // Offices paste "x.com/name" as often as the full address.
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { url: null, error: `"${raw}" is not a web address. Paste the full link to the profile.` }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { url: null, error: 'Only http and https addresses can be read.' }
  }
  if (!parsed.hostname.includes('.')) {
    return { url: null, error: `"${raw}" is not a web address. Paste the full link to the profile.` }
  }
  return { url: parsed.toString(), error: null }
}

/**
 * When to stop.
 *
 * Up to three page reads and one model call. The platform's own ceiling is what
 * actually ends a request that overruns, and it ends it with nothing at all —
 * this sits inside it so the office gets an explanation instead of a dropped
 * connection.
 */
const DEADLINE_MS = (() => {
  const raw = Number(process.env['IDENTITY_DEADLINE_MS'])
  return Number.isFinite(raw) && raw >= 8_000 && raw <= 60_000 ? raw : 22_000
})()

export default async function handler(req: Request, _context: Context): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Send a POST with a profile link, or a name.' }, 405)
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json({ error: 'That request was not valid JSON.' }, 400)
  }

  const { url, error: urlError } = readUrl(text(body.url, 400))
  if (urlError) return json({ error: urlError }, 400)

  const name = text(body.name, 120)
  if (!url && !name) {
    return json(
      { error: 'Give a public profile link, or the name of the person this desk is for.' },
      400,
    )
  }

  const started = Date.now()
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), DEADLINE_MS)

  try {
    const { identity } = await resolveIdentity({
      url,
      name,
      role: text(body.role, 120),
      constituency: text(body.constituency, 120),
      state: text(body.state, 80),
      signal: abort.signal,
    })
    return json({ identity, ms: Date.now() - started })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // An abort is the deadline, and saying "aborted" to an office is useless.
    const readable = abort.signal.aborted
      ? 'That profile took too long to read. Try again, or type the details in yourself — it takes a moment and the result is more accurate.'
      : message
    return json({ identity: null, error: readable, ms: Date.now() - started }, 502)
  } finally {
    clearTimeout(timer)
  }
}

export const config: Config = {
  path: '/api/identity',
  /**
   * Setup is a once-per-office action, so this is deliberately tight. Netlify
   * evaluates it before the function runs, which means a blocked request costs
   * no page fetches and no model tokens at all.
   */
  rateLimit: { windowLimit: 8, windowSize: 120, aggregateBy: ['ip'] },
}
