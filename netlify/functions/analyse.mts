import type { Config, Context } from '@netlify/functions'
import type { AnalyseRequest, Report, StreamEvent } from '../../shared/types'
import { extractPost } from './lib/extract/index'
import { analysePost } from './lib/analyse'
import { resolveProviders } from './lib/provider'

/**
 * POST /api/analyse — the whole pipeline, streamed as Server-Sent Events.
 *
 * Streaming rather than a single JSON response for two reasons: a 20–40 second
 * silent request looks broken, and Netlify's synchronous function budget is
 * finite. Emitting events as work completes keeps the connection alive and
 * gives the client something true to render.
 */

const enc = new TextEncoder()

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Use POST' }, { status: 405 })
  }

  let body: AnalyseRequest
  try {
    body = (await req.json()) as AnalyseRequest
  } catch {
    return Response.json({ error: 'Malformed request body' }, { status: 400 })
  }

  if (!body.url || typeof body.url !== 'string') {
    return Response.json({ error: 'A post URL is required' }, { status: 400 })
  }

  // A screenshot arrives as a data URI and is easily the biggest field.
  if (body.screenshot && body.screenshot.length > 7_000_000) {
    return Response.json({ error: 'That screenshot is too large — keep it under 5 MB' }, { status: 413 })
  }

  // Pasted text goes verbatim into the prompt, so it is billed per character.
  // The same 20,000-character ceiling the article extractor already applies
  // keeps a paste from becoming an open-ended bill.
  if (body.manualText && body.manualText.length > 20_000) {
    return Response.json(
      { error: 'That text is too long — paste up to about 20,000 characters.' },
      { status: 413 },
    )
  }

  const started = Date.now()

  let cancelled = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let beat: ReturnType<typeof setInterval> | undefined

      /**
       * Writing to a controller the client has already disconnected from throws.
       * From the heartbeat timer that throw has nowhere to go — it surfaces as
       * an unhandled rejection and can take the whole function down, so every
       * write is guarded and the first failure shuts the writer down for good.
       */
      const write = (chunk: string) => {
        if (closed || cancelled) return
        try {
          controller.enqueue(enc.encode(chunk))
        } catch {
          closed = true
          if (beat) clearInterval(beat)
        }
      }

      const send = (event: StreamEvent) => write(`data: ${JSON.stringify(event)}\n\n`)

      // Intermediaries drop idle SSE connections; a comment frame keeps it warm
      // without the client having to parse anything.
      beat = setInterval(() => write(': ping\n\n'), 15_000)

      try {
        const keys = {
          youtube: process.env['YOUTUBE_API_KEY'],
          meta: process.env['META_APP_TOKEN'],
        }

        // Null when no model is configured at all, which is a supported state:
        // the run finishes in data-only mode with everything that was measured.
        const providers = resolveProviders()
        const provider = providers[0] ?? null

        // Say which one is live. With several keys set the choice is decided by
        // resolution order, and an operator who adds a second key deserves to
        // see that the first one is now the one being billed and trusted.
        console.log(
          provider
            ? `[signal] model: ${provider.label} / ${provider.model}` +
                (providers.length > 1
                  ? ` (fallback: ${providers.slice(1).map((p) => p.label).join(', ')})`
                  : '') +
                (provider.privateByDefault ? '' : ' — this provider may train on inputs')
            : '[signal] model: none — data-only mode',
        )

        // ── Resolve ────────────────────────────────────────────────────────
        send({ type: 'stage', stage: 'resolve', status: 'start' })
        const { snapshot, extra } = await extractPost(body.url, {
          keys,
          manualText: body.manualText,
          screenshot: body.screenshot,
        })
        send({
          type: 'stage',
          stage: 'resolve',
          status: 'done',
          detail: snapshot.platform,
        })

        // ── Fetch ──────────────────────────────────────────────────────────
        // "Done" means we came away with something to analyse, not that every
        // attempt succeeded. Several adapters flag an attempt as failed when it
        // produced no engagement counts even though it returned the post text.
        const gotSomething = Boolean(
          snapshot.content.text?.trim() || snapshot.content.title?.trim() || snapshot.media.length,
        )
        send({
          type: 'stage',
          stage: 'fetch',
          status: gotSomething ? 'done' : 'skip',
          detail: snapshot.extraction.strategy,
        })

        // Apply any counts the user typed in after a blocked fetch.
        if (body.manualEngagement) {
          const me = body.manualEngagement
          const set = (k: 'likes' | 'comments' | 'shares' | 'views', v?: number) => {
            if (typeof v === 'number' && Number.isFinite(v)) {
              snapshot.engagement[k] = { value: v, source: 'user-supplied' }
            }
          }
          set('likes', me.likes)
          set('comments', me.comments)
          set('shares', me.shares)
          set('views', me.views)
          if (typeof me.followers === 'number') {
            snapshot.author.followers = { value: me.followers, source: 'user-supplied' }
          }
          snapshot.extraction.userAssisted = true
        }

        // Send the snapshot early so the client can render the post card while
        // the analysis is still running.
        send({ type: 'snapshot', snapshot })

        const hasSomething =
          Boolean(snapshot.content.text?.trim() || snapshot.content.title?.trim()) ||
          Boolean(body.screenshot)

        if (!hasSomething) {
          send({
            type: 'error',
            message: snapshot.extraction.blocked?.reason ?? 'We could not read that post.',
            recoverable: snapshot.extraction.blocked ?? {
              reason: 'No readable text was found at that link.',
              suggestion: 'Paste the post text, or upload a screenshot, and we will analyse that.',
            },
          })
          return
        }

        send({ type: 'stage', stage: 'read', status: 'done', detail: `${snapshot.content.text?.length ?? 0} characters` })

        // ── Data-only mode ─────────────────────────────────────────────────
        // With no model configured there is nothing to interpret, but there is
        // plenty that was measured. Finish the run and hand back what the
        // platform actually published, rather than reporting a failure over a
        // fetch that succeeded.
        if (!provider) {
          for (const stage of ['translate', 'analyse', 'assess', 'compose'] as const) {
            send({ type: 'stage', stage, status: 'skip' })
          }
          send({
            type: 'report',
            report: {
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
              snapshot,
              analysis: null,
              meta: {
                model: null,
                durationMs: Date.now() - started,
                heuristicOnly: false,
              },
            },
          })
          return
        }

        // ── Analyse ────────────────────────────────────────────────────────
        send({ type: 'stage', stage: 'analyse', status: 'start' })

        let assessStarted = false
        const outcome = await analysePost(snapshot, extra, {
          providers,
          screenshot: body.screenshot,
          onProviderSwitch: (from, to, reason) => {
            // Visible in the function log, so an operator can see the primary
            // running out of quota rather than guessing why answers changed.
            console.log(`[signal] ${from.label} failed (${reason}) — falling back to ${to.label}`)
          },
          onSection: (section) => {
            if (section === 'language') {
              send({ type: 'stage', stage: 'translate', status: 'done' })
              return
            }
            // The back half of the schema is the judgement work; label it so.
            if (!assessStarted && (section === 'credibility' || section === 'civic')) {
              assessStarted = true
              send({ type: 'stage', stage: 'analyse', status: 'done' })
              send({ type: 'stage', stage: 'assess', status: 'start' })
            }
            send({ type: 'partial', text: section })
          },
        })

        if (!assessStarted) send({ type: 'stage', stage: 'analyse', status: 'done' })
        send({ type: 'stage', stage: 'assess', status: 'done' })

        // ── Compose ────────────────────────────────────────────────────────
        send({ type: 'stage', stage: 'compose', status: 'start' })

        const report: Report = {
          id: cryptoId(),
          createdAt: new Date().toISOString(),
          snapshot,
          analysis: outcome.analysis,
          meta: {
            model: outcome.model,
            durationMs: Date.now() - started,
            inputTokens: outcome.inputTokens,
            outputTokens: outcome.outputTokens,
            heuristicOnly: false,
          },
        }

        send({ type: 'stage', stage: 'compose', status: 'done' })
        send({ type: 'report', report })
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Something went wrong while analysing that post.'
        send({ type: 'error', message })
      } finally {
        if (beat) clearInterval(beat)
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed by an aborted client */
        }
      }
    },
    // Fires when the client goes away mid-analysis. Stops every further write.
    cancel() {
      cancelled = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function cryptoId(): string {
  return `rep_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export const config: Config = {
  path: '/api/analyse',
  /**
   * Every request here costs an Anthropic call, so the endpoint needs a ceiling.
   * Netlify evaluates this before the function runs, so a blocked request costs
   * nothing in compute or tokens.
   *
   * 20 per 2 minutes per IP is generous for a person — one analysis takes
   * 20-40 seconds, so a human cannot approach it — and stops a script cold.
   * windowSize cannot exceed 180 seconds; a longer daily quota would need a
   * counter in Netlify Blobs, which is noted in the README as not yet built.
   */
  rateLimit: {
    windowLimit: 20,
    windowSize: 120,
    aggregateBy: ['ip', 'domain'],
  },
}
