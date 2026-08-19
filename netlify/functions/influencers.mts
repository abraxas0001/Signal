import type { Config, Context } from '@netlify/functions'
import { discoverInfluencers, influencerId, scanMentions } from './lib/influencers'
import type { Influencer } from '../../shared/grievance'
import { PLATFORMS } from '../../shared/taxonomy'
import type { Platform } from '../../shared/taxonomy'

/**
 * The influencer watch.
 *
 *   GET  /api/influencers?constituency=Eluru&subject=...   who to watch
 *   POST /api/influencers  { influencers, watchTerms }      what they said
 *
 * Split by method because the two cost different things and are wanted at
 * different times. Discovery is a model call plus a dozen live profile checks
 * and is run once when a constituency is set up. The check is up to eight
 * account reads plus one model call and is run whenever somebody opens the
 * screen. Neither result is stored here: there is no database behind this
 * endpoint and no scheduled job calling it, so the roster and the mentions live
 * on the device that asked for them.
 *
 * That is also why the check reports its coverage and its caps in the response
 * rather than only the mentions. The client has no other way to find out that
 * six of its fourteen accounts were never read, and an office told nothing is
 * happening when nothing was looked at is worse off than before it had the tool.
 */

/** Enough for a constituency roster; beyond this the scan cannot finish. */
const MAX_INFLUENCERS = 40
const MAX_TERMS = 40

function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && PLATFORMS.some((p) => p === value)
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * Rebuild an influencer from whatever the browser sent.
 *
 * The roster lives in the client's own storage, so this body is not a trusted
 * shape — it is whatever survived a migration, a hand edit or a bad merge. A
 * record missing the two fields that decide which account gets fetched is
 * dropped rather than fetched at a guess.
 */
function toInfluencer(raw: unknown): Influencer | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const handle = str(r['handle'])
  const platform = r['platform']
  if (!handle || !isPlatform(platform)) return null

  const id = str(r['id'])
  const followers = typeof r['followers'] === 'number' && Number.isFinite(r['followers'])
    ? r['followers']
    : null

  return {
    // The same derivation discovery uses, so a hand-repaired record still lines
    // its coverage row up with the roster entry it came from.
    id: id ?? influencerId(platform, handle),
    platform,
    handle,
    displayName: str(r['displayName']),
    url: str(r['url']) ?? '',
    constituency: str(r['constituency']),
    followers,
    addedAt: str(r['addedAt']) ?? new Date().toISOString(),
    note: str(r['note']),
  }
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  const started = Date.now()

  if (req.method === 'POST') {
    let body: { influencers?: unknown; watchTerms?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return Response.json({ error: 'Malformed request body.' }, { status: 400 })
    }

    const influencers = (Array.isArray(body.influencers) ? body.influencers : [])
      .slice(0, MAX_INFLUENCERS)
      .map(toInfluencer)
      .filter((i): i is Influencer => i !== null)

    const watchTerms = (Array.isArray(body.watchTerms) ? body.watchTerms : [])
      .filter((t): t is string => typeof t === 'string')
      .slice(0, MAX_TERMS)

    if (!influencers.length) {
      return Response.json(
        { error: 'No accounts to check. Add the pages you watch first, or use the suggestions.' },
        { status: 400 },
      )
    }

    try {
      const scan = await scanMentions(influencers, watchTerms)
      return Response.json(
        { ms: Date.now() - started, ...scan },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'Could not check those accounts.' },
        { status: 502 },
      )
    }
  }

  if (req.method !== 'GET') {
    return Response.json(
      { error: 'Use GET to suggest accounts, or POST to check them.' },
      { status: 405 },
    )
  }

  const params = new URL(req.url).searchParams
  const constituency = params.get('constituency')?.trim()
  const subject = params.get('subject')?.trim()
  if (!constituency || !subject) {
    return Response.json(
      {
        error:
          'Pass constituency and subject: the segment to search, and the name of the office being watched.',
      },
      { status: 400 },
    )
  }

  try {
    const discovery = await discoverInfluencers(constituency, subject)
    return Response.json(
      { ms: Date.now() - started, ...discovery },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not suggest accounts.' },
      { status: 502 },
    )
  }
}

export const config: Config = {
  path: '/api/influencers',
  // A model call on either verb, plus up to a dozen live profile reads. Both
  // are expensive by design and both are meant to be tapped deliberately, so
  // the limit is tight and the client keeps the answer.
  rateLimit: { windowLimit: 6, windowSize: 120, aggregateBy: ['ip'] },
}
