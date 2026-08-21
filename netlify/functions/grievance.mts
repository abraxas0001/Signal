import type { Config, Context } from '@netlify/functions'
import type { GrievanceRecord, IssueCluster } from '../../shared/grievance'
import { classifyArticle, clusterIssues } from './lib/grievance'

/**
 * POST /api/grievance — file a batch of news links as grievance records.
 *
 * Body: { urls: string[], stream?: boolean }
 *
 * Two response shapes, because two kinds of caller need this:
 *
 *   - Server-Sent Events, the way /api/analyse streams, when the caller sends
 *     `Accept: text/event-stream` or `{ stream: true }`. Each record arrives as
 *     it is classified, so ten links render one by one instead of after forty
 *     seconds of nothing.
 *   - Otherwise plain JSON, with a per-URL ok/error array.
 *
 * JSON is the default deliberately. A caller that guesses wrong and calls
 * `res.json()` on an event stream gets a parse error with nothing in it, which
 * is a worse failure than a client that wanted streaming and has to ask for it.
 *
 * Either way one bad link never fails the batch: a dead URL, a paywall or a
 * model refusal is reported against that URL and the rest carry on.
 */

const MAX_BATCH = 10

/**
 * How many articles are read at once.
 *
 * Two, not ten. Each article costs one page fetch and two model calls, and the
 * free tiers this runs on meter tokens per minute across the whole key — fanning
 * ten out in parallel does not finish faster, it produces ten rate-limit errors
 * and an empty batch. Two keeps the pipe full while the third and fourth calls
 * are still inside the allowance.
 */
const CONCURRENCY = 2

/**
 * When to stop and return what we have.
 *
 * The real ceiling belongs to the function timeout configured on the site, not
 * to a number picked in this file — see the same note in analyse.mts. When the
 * platform gets there first the connection is simply dropped, so this deadline
 * exists to hand back the records that did finish rather than gambling the
 * whole batch on the last one.
 */
const DEADLINE_MS = (() => {
  const raw = Number(process.env['GRIEVANCE_DEADLINE_MS'])
  return Number.isFinite(raw) && raw >= 8_000 && raw <= 60_000 ? raw : 40_000
})()

interface Outcome {
  url: string
  record: GrievanceRecord | null
  error: string | null
}

type GrievanceEvent =
  | { type: 'start'; accepted: number; truncated: number; note: string | null }
  | { type: 'record'; url: string; record: GrievanceRecord }
  | { type: 'failed'; url: string; error: string }
  | { type: 'clusters'; clusters: IssueCluster[] }
  | { type: 'done'; ms: number; ok: number; failed: number; incomplete: string | null }
  | { type: 'error'; message: string }

const enc = new TextEncoder()

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
      },
    })
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Use POST with { urls: string[] }' }, { status: 405 })
  }

  let body: { urls?: unknown; stream?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'Malformed request body' }, { status: 400 })
  }

  if (!Array.isArray(body.urls)) {
    return Response.json({ error: 'Send { urls: [...] } with at least one link.' }, { status: 400 })
  }

  // Deduplicated before the cap is applied, so a list with the same link twice
  // does not spend two of the ten slots on it.
  const candidates = [
    ...new Set(
      body.urls
        .filter((u): u is string => typeof u === 'string')
        .map((u) => u.trim())
        .filter((u) => /^https?:\/\//i.test(u)),
    ),
  ]

  if (!candidates.length) {
    return Response.json(
      {
        error:
          'No usable links in that list. Each entry must be a full article URL starting with http:// or https://.',
      },
      { status: 400 },
    )
  }

  const urls = candidates.slice(0, MAX_BATCH)
  const truncated = candidates.length - urls.length
  const note = truncated
    ? `Only the first ${MAX_BATCH} links were read. The other ${truncated} were not. Send them as a second batch.`
    : null

  const wantsStream =
    body.stream === true || (req.headers.get('accept') ?? '').includes('text/event-stream')

  return wantsStream
    ? streamBatch(urls, truncated, note)
    : jsonBatch(urls, truncated, note)
}

/**
 * Read the batch, at most CONCURRENCY at a time, stopping at the deadline.
 *
 * Results are written back into a fixed array rather than pushed, so the order
 * of the response matches the order of the request no matter which article
 * finished first.
 */
async function processBatch(
  urls: string[],
  onOutcome: (outcome: Outcome) => void,
): Promise<{ outcomes: Outcome[]; unreached: string[] }> {
  const started = Date.now()
  const outcomes: Outcome[] = []
  const unreached: string[] = []

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), DEADLINE_MS)

  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      const url = urls[index]
      if (url === undefined) return

      // Checked before starting rather than only while running: beginning a
      // third article with two seconds left spends a fetch and a model call on
      // a result nobody will receive.
      if (Date.now() - started >= DEADLINE_MS) {
        unreached.push(url)
        continue
      }

      let outcome: Outcome
      try {
        outcome = { url, record: await classifyArticle(url, { signal: abort.signal }), error: null }
      } catch (err) {
        outcome = {
          url,
          record: null,
          error: err instanceof Error ? err.message : 'Could not read that article.',
        }
      }
      outcomes.push(outcome)
      onOutcome(outcome)
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker))
  } finally {
    clearTimeout(timer)
  }

  // Back into request order — workers finish out of order by design.
  outcomes.sort((a, b) => urls.indexOf(a.url) - urls.indexOf(b.url))
  return { outcomes, unreached }
}

/** What to tell the caller when the clock, not the content, ended the batch. */
function incompleteNote(unreached: string[]): string | null {
  if (!unreached.length) return null
  return `${unreached.length} link${unreached.length === 1 ? ' was' : 's were'} not read before the function's time ran out. The records below are complete; send the rest as a second batch.`
}

async function jsonBatch(
  urls: string[],
  truncated: number,
  note: string | null,
): Promise<Response> {
  const started = Date.now()
  const { outcomes, unreached } = await processBatch(urls, () => {})
  const records = outcomes
    .map((o) => o.record)
    .filter((r): r is GrievanceRecord => r !== null)

  return Response.json(
    {
      ms: Date.now() - started,
      accepted: urls.length,
      truncated,
      note,
      incomplete: incompleteNote(unreached),
      results: outcomes.map((o) =>
        o.record
          ? { url: o.url, ok: true as const, record: o.record }
          : { url: o.url, ok: false as const, error: o.error },
      ),
      unreachedUrls: unreached,
      clusters: clusterIssues(records),
    },
    { headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } },
  )
}

function streamBatch(urls: string[], truncated: number, note: string | null): Response {
  const started = Date.now()
  let cancelled = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let beat: ReturnType<typeof setInterval> | undefined

      // Writing to a controller the client has already disconnected from
      // throws, and from the heartbeat timer that throw has nowhere to go — it
      // surfaces as an unhandled rejection and can take the function down. So
      // every write is guarded and the first failure shuts the writer for good.
      const write = (chunk: string) => {
        if (closed || cancelled) return
        try {
          controller.enqueue(enc.encode(chunk))
        } catch {
          closed = true
          if (beat) clearInterval(beat)
        }
      }
      const send = (event: GrievanceEvent) => write(`data: ${JSON.stringify(event)}\n\n`)

      // Intermediaries drop idle SSE connections, and one article can take ten
      // seconds. A comment frame keeps the connection warm without the client
      // having to parse anything.
      beat = setInterval(() => write(': ping\n\n'), 3_000)

      try {
        send({ type: 'start', accepted: urls.length, truncated, note })

        const { outcomes, unreached } = await processBatch(urls, (outcome) => {
          if (outcome.record) send({ type: 'record', url: outcome.url, record: outcome.record })
          else send({ type: 'failed', url: outcome.url, error: outcome.error ?? 'Unknown failure' })
        })

        const records = outcomes
          .map((o) => o.record)
          .filter((r): r is GrievanceRecord => r !== null)

        // Clustering runs over the whole batch, so it can only be sent once
        // every record is in — it is the ranking of the week, not of one link.
        send({ type: 'clusters', clusters: clusterIssues(records) })
        send({
          type: 'done',
          ms: Date.now() - started,
          ok: records.length,
          failed: outcomes.length - records.length,
          incomplete: incompleteNote(unreached),
        })
      } catch (err) {
        send({
          type: 'error',
          message:
            err instanceof Error ? err.message : 'Something went wrong while filing those links.',
        })
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
    // Fires when the client goes away mid-batch. Stops every further write.
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

export const config: Config = {
  path: '/api/grievance',
  /**
   * Every accepted request costs up to twenty model calls, so the endpoint
   * needs a ceiling. Netlify evaluates this before the function runs, so a
   * blocked request costs nothing in compute or tokens.
   *
   * Six batches per two minutes is generous for an office filing the morning's
   * links — a batch takes most of a minute — and stops a script cold.
   */
  rateLimit: { windowLimit: 6, windowSize: 120, aggregateBy: ['ip'] },
}
