import type { Config, Context } from '@netlify/functions'
import type { Confidence } from '../../shared/identity'
import type { Platform } from '../../shared/taxonomy'
import { PLATFORMS } from '../../shared/taxonomy'
import type { Report } from '../../shared/types'
import type { ApiKeys } from './lib/extract/types'
import type { Provider } from './lib/provider'
import { searchAcrossAllPlatforms, type Discovery } from './lib/multi-platform-search'
import { extractPost } from './lib/extract/index'
import { analysePost } from './lib/analyse'
import { resolveProviders } from './lib/provider'

/**
 * Everything one person has posted lately, read and analysed, from their name.
 *
 *   POST /api/batch-multi-platform
 *   { "query": "D. K. Aruna", "person": "D. K. Aruna",
 *     "platforms": ["YouTube"], "maxPostsPerPlatform": 3 }
 *
 * /api/multi-platform-search finds the accounts and reads their post lists.
 * This runs the analyse pipeline over those posts, streamed as Server-Sent
 * Events for the same reason /api/analyse is: a silent request that takes most
 * of a minute looks broken, and the platform's function budget is finite, so
 * work that has completed has to leave the building as it completes.
 *
 * Two things it deliberately will not do.
 *
 * It does not analyse a profile page as though it were a post. The version this
 * replaces handed each profile URL to `extractPost` and filed the result under
 * the person's name — a channel's landing page has no publication date, no
 * engagement and no author but itself, so every row was a report about a page
 * nobody wrote. Posts come from the reader's own listing instead.
 *
 * It does not analyse accounts nothing has been checked about. A name search
 * returns fan channels and impersonators alongside the person, and putting a
 * model over a stranger's videos produces a confident brief on somebody else's
 * politics under this person's name. Those profiles come back under `skipped`
 * with the reason, and every profile that did run carries the confidence and
 * the route it was found by.
 */

const enc = new TextEncoder()

/**
 * How long the whole run may take.
 *
 * The same knob /api/analyse uses, because it names the same thing: the
 * function timeout configured on the Netlify site, which kills a synchronous
 * function by dropping the connection rather than returning an error. One post
 * takes 13-16s end to end, so this is a budget for two or three of them and
 * the run reports what it did not reach rather than being cut off mid-sentence.
 */
const RUN_BUDGET_MS = (() => {
  const raw = Number(process.env['ANALYSIS_DEADLINE_MS'])
  return Number.isFinite(raw) && raw >= 8_000 && raw <= 60_000 ? raw : 40_000
})()

/** No post gets more than this, so one slow platform cannot eat the run. */
const PER_POST_BUDGET_MS = 20_000

/**
 * Below this there is no point starting another post: extraction alone takes
 * 2-5s, and a report with measurements but no analysis is worth less than an
 * honest line saying the run ran out of time.
 */
const MIN_POST_MS = 8_000

const DEFAULT_POSTS_PER_PROFILE = 3
const MAX_POSTS_PER_PROFILE = 10

interface AnalysedPost {
  url: string
  title: string | null
  publishedAt: string | null
  report: Report | null
  /** Set only when there is no report at all. */
  note?: string
}

interface ProfileRun {
  platform: Platform
  handle: string
  name: string | null
  profileUrl: string
  /** Carried through from discovery: what this account is evidence of. */
  confidence: Confidence
  discovery: Discovery
  posts: AnalysedPost[]
}

interface SkippedProfile {
  platform: Platform
  handle: string
  confidence: Confidence
  /** In the reader's own words, or discovery's. Shown verbatim. */
  reason: string
}

const isPlatform = (value: unknown): value is Platform =>
  typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value)

function reportId(): string {
  return `rep_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/**
 * One post, read and then interpreted if there is time and a model.
 *
 * Never throws for want of an analysis. The measurements are real on their own
 * — engagement, author, media, the text itself — and a report carrying them
 * with `analysis: null` and a line saying why is a narrower result rather than
 * a failed one. That is the same contract /api/analyse returns on its deadline.
 */
async function reportFor(
  url: string,
  keys: ApiKeys,
  providers: Provider[],
  budgetMs: number,
): Promise<Report> {
  const began = Date.now()
  const { snapshot, extra } = await extractPost(url, { keys })
  const base = { id: reportId(), createdAt: new Date().toISOString(), snapshot }

  if (!providers.length) {
    return {
      ...base,
      analysis: null,
      meta: {
        model: null,
        durationMs: Date.now() - began,
        heuristicOnly: false,
        incomplete:
          'The figures below were measured. No language model is configured on this deploy, so nothing was interpreted.',
      },
    }
  }

  const abort = new AbortController()
  let failure: string | null = null

  // The timer resolves on its own schedule, so a model call that hangs past its
  // abort cannot take the measurements down with it. The abort still fires, to
  // stop paying for output nobody will read.
  const outcome = await Promise.race([
    analysePost(snapshot, extra, { providers, signal: abort.signal }).catch((err: unknown) => {
      failure = err instanceof Error ? err.message : String(err)
      return null
    }),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), Math.max(0, budgetMs - (Date.now() - began))),
    ),
  ])

  if (!outcome) {
    abort.abort()
    return {
      ...base,
      analysis: null,
      meta: {
        model: null,
        durationMs: Date.now() - began,
        heuristicOnly: false,
        incomplete: failure
          ? `The figures below were measured. The written analysis could not be produced: ${failure}`
          : 'The figures below were measured. The written analysis did not finish inside this post’s share of the run and was left out rather than guessed at.',
      },
    }
  }

  return {
    ...base,
    analysis: outcome.analysis,
    meta: {
      model: outcome.model,
      durationMs: Date.now() - began,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      heuristicOnly: false,
    },
  }
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    })
  }

  if (req.method !== 'POST') return Response.json({ error: 'Send a POST.' }, { status: 405 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'That request body is not JSON.' }, { status: 400 })
  }

  const query = typeof body['query'] === 'string' ? body['query'].trim() : ''
  if (query.length < 3) {
    return Response.json(
      { error: 'Give at least three characters of a name under "query".' },
      { status: 400 },
    )
  }

  // Which article to read the public record from, when the name matches a
  // constituency as well as its member.
  const person = typeof body['person'] === 'string' ? body['person'].trim() : ''

  /**
   * Which platforms to run, when the caller wants only some of them.
   *
   * A name that does not parse is refused rather than dropped. Filtering
   * silently on a list that matched nothing sent seven found accounts back as
   * `profiles: [], skipped: [], done: true` — on screen indistinguishable from
   * a person who posts nowhere, which is the one claim this endpoint must never
   * make by accident. "Youtube" for "YouTube" was enough to trigger it.
   */
  const askedPlatforms = Array.isArray(body['platforms']) ? body['platforms'] : null
  if (askedPlatforms && askedPlatforms.length === 0) {
    return Response.json(
      { error: 'An empty "platforms" list asks for nothing. Omit it to run every account found.' },
      { status: 400 },
    )
  }
  const unknown = askedPlatforms?.filter((name) => !isPlatform(name)) ?? []
  if (unknown.length > 0) {
    return Response.json(
      {
        error: `"platforms" names ${
          unknown.length === 1 ? 'something' : 'things'
        } this does not read: ${unknown
          .map((name) => JSON.stringify(name))
          .join(', ')}. Spelt exactly: ${PLATFORMS.join(', ')}.`,
      },
      { status: 400 },
    )
  }
  const wanted = askedPlatforms?.filter(isPlatform) ?? null

  const asked = Number(body['maxPostsPerPlatform'])
  const perProfile = Number.isFinite(asked)
    ? Math.min(Math.max(1, Math.trunc(asked)), MAX_POSTS_PER_PROFILE)
    : DEFAULT_POSTS_PER_PROFILE

  const started = Date.now()
  const remainingMs = (): number => RUN_BUDGET_MS - (Date.now() - started)

  const keys: ApiKeys = {
    ...(process.env['YOUTUBE_API_KEY'] ? { youtube: process.env['YOUTUBE_API_KEY'] } : {}),
    ...(process.env['META_APP_TOKEN'] ? { meta: process.env['META_APP_TOKEN'] } : {}),
  }

  // Synchronous, and an empty list is a supported state: the run finishes in
  // data-only mode with everything that was measured.
  const providers = resolveProviders()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (event: Record<string, unknown>): void => {
        if (closed) return
        controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        send({ type: 'searching', query })

        const found = await searchAcrossAllPlatforms(query, person ? { person } : {})
        send({
          type: 'profiles',
          person: found.person,
          people: found.people,
          coverage: found.coverage,
          profiles: found.profiles,
        })

        const profiles = found.profiles.filter(
          (profile) => !wanted || wanted.includes(profile.platform),
        )

        const runs: ProfileRun[] = []
        const skipped: SkippedProfile[] = []
        const unreached: Array<{ platform: Platform; handle: string; posts: number }> = []

        for (const profile of profiles) {
          const identity = {
            platform: profile.platform,
            handle: profile.handle,
            confidence: profile.confidence,
          }

          // Nothing has been checked about this account — not that it exists,
          // not whose it is. Reading a stranger's posts under this person's
          // name is the one outcome worth spending nothing on.
          if (profile.confidence === 'low') {
            skipped.push({ ...identity, reason: profile.note })
            continue
          }

          const queue = profile.recentPosts.slice(0, perProfile)
          if (queue.length === 0) {
            skipped.push({ ...identity, reason: profile.listing })
            continue
          }

          const run: ProfileRun = {
            platform: profile.platform,
            handle: profile.handle,
            name: profile.name,
            profileUrl: profile.profileUrl,
            confidence: profile.confidence,
            discovery: profile.discovery,
            posts: [],
          }
          runs.push(run)

          for (const post of queue) {
            if (remainingMs() < MIN_POST_MS) {
              unreached.push({
                platform: profile.platform,
                handle: profile.handle,
                posts: queue.length - run.posts.length,
              })
              break
            }

            send({ type: 'reading', platform: profile.platform, handle: profile.handle, url: post.url })

            try {
              const report = await reportFor(
                post.url,
                keys,
                providers,
                Math.min(PER_POST_BUDGET_MS, remainingMs()),
              )
              const analysed: AnalysedPost = {
                url: post.url,
                title: post.title,
                publishedAt: post.publishedAt,
                report,
              }
              run.posts.push(analysed)
              send({ type: 'post', platform: profile.platform, handle: profile.handle, post: analysed })
            } catch (err) {
              const note = err instanceof Error ? err.message : 'That post could not be read.'
              const analysed: AnalysedPost = {
                url: post.url,
                title: post.title,
                publishedAt: post.publishedAt,
                report: null,
                note,
              }
              run.posts.push(analysed)
              send({ type: 'post', platform: profile.platform, handle: profile.handle, post: analysed })
            }
          }

          if (remainingMs() < MIN_POST_MS) break
        }

        // Whatever the loop never got to, named so the caller can ask again for
        // exactly that rather than paying for the whole run twice.
        const reached = new Set(runs.map((run) => `${run.platform}:${run.handle}`))
        for (const profile of profiles) {
          const key = `${profile.platform}:${profile.handle}`
          if (reached.has(key)) continue
          if (skipped.some((s) => `${s.platform}:${s.handle}` === key)) continue
          unreached.push({
            platform: profile.platform,
            handle: profile.handle,
            posts: Math.min(profile.recentPosts.length, perProfile),
          })
        }

        send({
          type: 'complete',
          query,
          person: found.person,
          coverage: found.coverage,
          profiles: runs,
          skipped,
          unreached,
          done: unreached.length === 0,
          ms: Date.now() - started,
        })
      } catch (err) {
        send({
          type: 'error',
          message: err instanceof Error ? err.message : 'The run stopped before it finished.',
        })
      } finally {
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed by a client that went away */
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'access-control-allow-origin': '*',
    },
  })
}

export const config: Config = {
  path: '/api/batch-multi-platform',
  /**
   * The most expensive endpoint here: a name search, up to ten live profile
   * reads, and then a model call per post. Netlify evaluates this before the
   * function runs, so a blocked request costs nothing in compute or tokens.
   */
  rateLimit: { windowLimit: 4, windowSize: 120, aggregateBy: ['ip', 'domain'] },
  // No `method` key, and analyse.mts omits it for the same reason: Netlify
  // filters on it before routing, so naming POST alone stops the CORS preflight
  // ever reaching the handler — the OPTIONS branch above goes unreachable and a
  // cross-origin JSON POST fails at the preflight, before this function runs.
}
