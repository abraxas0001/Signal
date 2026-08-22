import type { Config, Context } from '@netlify/functions'
import type { Platform } from '../../shared/taxonomy'
import { PLATFORMS } from '../../shared/taxonomy'
import { firestoreConfigured } from './lib/firebase'
import {
  batchTrackCompetitors,
  getTrackedProfiles,
  registerProfiles,
  type Category,
  type SyncResult,
} from './lib/competitor-tracker'
import { estimateBatchDuration, formatDuration } from './lib/rate-limiter-advanced'

/**
 * POST /api/batch-track-all — one sync pass, streamed as it happens.
 *
 * The same work as `POST /api/sync-profiles`, and the same resumable contract:
 * one budgeted pass, then `done` and how many accounts are left. The difference
 * is only in the delivery. A sync spends most of its time deliberately waiting
 * — a minute per Instagram account — and a request that returns nothing for
 * forty-five seconds is indistinguishable from a hung one. Streaming each
 * account as it lands means the screen can name the account currently being
 * read, which is the difference between a progress bar and a spinner.
 *
 * Both endpoints exist because both callers are real: the dashboard wants the
 * running commentary, and a scheduled job or a curl wants one JSON object.
 * Neither reimplements the sync — they both call `batchTrackCompetitors`.
 */

export const config: Config = {
  path: '/api/batch-track-all',
  method: ['POST', 'OPTIONS'],
}

const enc = new TextEncoder()

/** Leaves 15s of the function's 60s for the accounts already read to be written. */
const PASS_BUDGET_MS = 45_000

const isPlatform = (v: unknown): v is Platform =>
  typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v)

const CATEGORIES: Category[] = ['self', 'competitor', 'influencer']
const isCategory = (v: unknown): v is Category =>
  typeof v === 'string' && (CATEGORIES as string[]).includes(v)

interface BatchRequest {
  handles?: unknown
  category?: unknown
  budgetMs?: unknown
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') return Response.json({ error: 'Use POST.' }, { status: 405 })

  if (!firestoreConfigured()) {
    return Response.json(
      {
        error:
          'This deploy has no Firebase credentials, so there is nowhere to store a sync. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY. Live reads keep working without it.',
      },
      { status: 503 },
    )
  }

  let body: BatchRequest = {}
  try {
    body = (await req.json()) as BatchRequest
  } catch {
    // Empty body: sync whatever is already registered.
  }

  const budgetMs =
    typeof body.budgetMs === 'number' && body.budgetMs > 1_000 && body.budgetMs <= PASS_BUDGET_MS
      ? body.budgetMs
      : PASS_BUDGET_MS

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true
      const send = (type: string, data: Record<string, unknown> = {}) => {
        if (!open) return
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`))
        } catch {
          // The reader went away mid-sync. Stop writing rather than throwing
          // inside the loop and losing the accounts already committed.
          open = false
        }
      }

      try {
        send('started', { at: new Date().toISOString() })

        if (Array.isArray(body.handles) && body.handles.length > 0) {
          const entries = body.handles
            .filter((h): h is Record<string, unknown> => typeof h === 'object' && h !== null)
            .filter((h) => isPlatform(h['platform']) && typeof h['handle'] === 'string')
            .map((h) => ({
              platform: h['platform'] as Platform,
              handle: h['handle'] as string,
              name: typeof h['name'] === 'string' ? h['name'] : null,
              profileUrl: typeof h['profileUrl'] === 'string' ? h['profileUrl'] : null,
              category: isCategory(h['category'])
                ? h['category']
                : h['own'] === true
                  ? ('self' as const)
                  : ('competitor' as const),
            }))

          if (entries.length > 0) {
            await registerProfiles(entries)
            send('registered', { count: entries.length })
          }
        }

        const category = isCategory(body.category) ? body.category : undefined
        const profiles = await getTrackedProfiles(category)

        if (profiles.length === 0) {
          send('complete', {
            done: true,
            remaining: 0,
            summary: { accounts: 0, posts: 0, followersRead: 0, failed: 0, skipped: 0 },
            note:
              'Nothing is registered for syncing yet. Add accounts on the dashboard, then sync — the dashboard sends its list with the request.',
          })
          controller.close()
          return
        }

        const estimate = estimateBatchDuration(profiles)
        send('estimate', {
          accounts: profiles.length,
          totalMs: estimate.totalMs,
          human: formatDuration(estimate.totalMs),
          byPlatform: estimate.details,
          // Say up front that this may take more than one pass, so a client
          // that stops after the first one is doing so knowingly.
          passes: Math.max(1, Math.ceil(estimate.totalMs / budgetMs)),
        })

        let posts = 0
        let failed = 0
        let skipped = 0
        let followersRead = 0

        const progress = await batchTrackCompetitors(profiles, {
          budgetMs,
          onResult: (result: SyncResult) => {
            posts += result.posts.length
            if (result.error) failed++
            else if (result.skipped) skipped++
            if (result.followers !== null) followersRead++

            send('account', {
              platform: result.profile.platform,
              handle: result.profile.handle,
              name: result.profile.name,
              posts: result.posts.length,
              followers: result.followers,
              durationMs: result.durationMs,
              ...(result.skipped ? { skipped: result.skipped } : {}),
              ...(result.error ? { error: result.error } : {}),
            })
          },
        })

        send('complete', {
          done: progress.done,
          remaining: progress.remaining.length,
          remainingHandles: progress.remaining.map((p) => `${p.platform}:${p.handle}`),
          summary: {
            accounts: progress.results.length,
            posts,
            followersRead,
            failed,
            skipped,
          },
          at: new Date().toISOString(),
        })
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : 'Unknown error' })
      } finally {
        try {
          controller.close()
        } catch {
          /* already closed by a failed enqueue */
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
