import type { Config, Context } from '@netlify/functions'
import { firestoreConfigured, firestoreError } from './lib/firebase'
import { getInstagramBlockStatus, getInstagramCacheStats } from './lib/instagram-cache'
import { configFor, getRateLimitStatus } from './lib/rate-limiter-advanced'

/**
 * GET /api/instagram-cache-status — what this deploy has stored for Instagram,
 * and whether Instagram is currently letting us read anything new.
 *
 * WHY TWO BLOCK SIGNALS AND NOT ONE. Instagram is refused in two different
 * places for two different reasons, and an operator shown only one of them
 * draws the wrong conclusion about why a read came back empty.
 *
 * `lib/instagram-cache` backs off PER KEY: a specific post or account that a
 * live read could not produce, with a window that doubles on each consecutive
 * refusal. `lib/rate-limiter-advanced` backs off the PLATFORM: the shared
 * hourly ledger, which opens a window whenever Instagram answers 429 or 403 and
 * which every function invocation reads, since Netlify gives each its own
 * container and an in-memory counter would reset constantly. Either can be the
 * thing standing between the desk and a fresh read, and they do not know about
 * each other. Both are reported.
 *
 * WHAT "CACHED" MEANS HERE, because it is easy to read as the opposite. The
 * cache is a fallback, not a read-through: while Instagram is answering, every
 * request goes live and the stored copy is untouched. It is reached only when
 * Instagram refuses. So a large fresh count is not a claim that the desk is
 * serving cached numbers — it is a claim about how much fallback exists if
 * Instagram starts refusing.
 *
 * Read-only, and deliberately so. It purges nothing, changes no schedule and
 * takes no input, which is why it carries no admin gate; `clearInstagramCache`
 * is not reachable from here. Anything that could drop an entry would need
 * `settingsKeyOk` in front of it.
 */

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') {
    return Response.json({ error: 'Use GET.' }, { status: 405 })
  }

  try {
    const configured = firestoreConfigured()
    const [cache, cacheBlock, rate] = await Promise.all([
      getInstagramCacheStats(),
      getInstagramBlockStatus(),
      getRateLimitStatus('Instagram'),
    ])
    const limits = configFor('Instagram')

    const notes: string[] = []

    if (!configured) {
      /**
       * Say that nothing was measured, and do not then go on to report what
       * was not measured as clear.
       *
       * All three signals on this page live in Firestore. Without it the cache
       * counts are zero, `getInstagramBlockStatus` returns unblocked and
       * `getRateLimitStatus` opens every gate — and those are the same values
       * an answering, unthrottled Instagram produces. The notes below used to
       * be emitted regardless, so an unconfigured deploy read back "no key is
       * in backoff" and "the ledger is letting reads through immediately",
       * which are not findings about Instagram. They are the shape of an empty
       * database, and the two states mean opposite things to whoever is trying
       * to work out why a read came back empty.
       */
      notes.push(
        `Firebase is not configured on this deploy, so nothing is stored between invocations. Every Instagram read goes live, there is no stored copy to fall back on when one is refused, and no record of a refusal outlives the invocation that met it. ${
          firestoreError() ?? ''
        }`.trim(),
      )
      notes.push(
        `Every count below is zero because nothing is recorded, not because Instagram is answering. Neither block signal can be read at all here. Instagram's configured minimum gap is ${Math.round(
          limits.minDelayMs / 1000,
        )}s and its hourly ceiling ${rate.hourlyLimit} reads, but the ledger that would hold either across invocations is in Firestore, so a refusal one invocation meets is unknown to the next.`,
      )
    } else {
      if (cacheBlock.isBlocked) {
        // Name a few rather than all of them: the full list is in the payload,
        // and a note that runs to forty handles stops being read at all.
        const named = cacheBlock.blockedHandles.slice(0, 5).join(', ')
        const rest = cacheBlock.blockedHandles.length - 5
        notes.push(
          `Instagram refused ${cacheBlock.blockedHandles.length} key${
            cacheBlock.blockedHandles.length === 1 ? '' : 's'
          } and each is inside its own backoff window: ${named}${rest > 0 ? `, and ${rest} more` : ''}. The last window lifts at ${
            cacheBlock.unblockAt?.toISOString() ?? 'an unrecorded time'
          }.`,
        )
      } else {
        notes.push('No Instagram key is currently in backoff from a refused read.')
      }

      if (!rate.canRequest) {
        const minutes = Math.max(1, Math.round(rate.waitTimeMs / 60_000))
        notes.push(
          `${rate.reason ?? 'The rate-limit ledger is holding Instagram reads.'} The platform reopens in ${minutes} minute${
            minutes === 1 ? '' : 's'
          }.`,
        )
      } else if (rate.waitTimeMs > 0) {
        notes.push(
          `The rate-limit ledger is letting Instagram reads through. The next one waits ${Math.round(
            rate.waitTimeMs / 1000,
          )}s to keep the gap between requests at ${Math.round(limits.minDelayMs / 1000)}s.`,
        )
      } else {
        notes.push('The rate-limit ledger is letting Instagram reads through immediately.')
      }

      if (cache.totalCached === 0) {
        notes.push(
          'The collection is empty. A row is written when a live read succeeds and also when one is refused, so nothing at all here means no Instagram post or account has been read on this deploy, rather than that reads are being turned away.',
        )
      } else {
        notes.push(
          `${cache.freshCount} of ${cache.totalCached} rows hold a snapshot inside its time-to-live, and those are what would be served if Instagram refused a live read. The other ${cache.expiredCount} would not be, for either of two reasons: a snapshot that has aged past its time-to-live, or a key Instagram has only ever refused, which still gets a row to carry its backoff and has never held a snapshot to expire. Neither is offered, because a stale like count presented as a current one is worse than admitting there is nothing to show.`,
        )
      }
    }

    notes.push(
      'This is a fallback cache, not a read-through one. While Instagram is answering, every read goes live and nothing here is used.',
    )

    return Response.json({
      checkedAt: new Date().toISOString(),
      firestore: { configured, error: firestoreError() },
      cache: {
        // Named for what these counts can actually tell apart. `expired` was
        // the wrong word for the reason the note above now gives: the count
        // includes rows that never carried a snapshot to expire.
        rows: cache.totalCached,
        servable: cache.freshCount,
        notServable: cache.expiredCount,
        inBackoff: cache.blockedCount,
      },
      keyBackoff: {
        isBlocked: cacheBlock.isBlocked,
        blockedHandles: cacheBlock.blockedHandles,
        unblockAt: cacheBlock.unblockAt?.toISOString() ?? null,
      },
      platformRateLimit: {
        canRequest: rate.canRequest,
        waitSeconds: Math.round(rate.waitTimeMs / 1000),
        requestsThisHour: rate.requestsThisHour,
        hourlyLimit: rate.hourlyLimit,
        minDelaySeconds: Math.round(limits.minDelayMs / 1000),
        blockedUntil: rate.blockedUntil?.toISOString() ?? null,
        reason: rate.reason,
      },
      notes,
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not read Instagram status.' },
      { status: 500 },
    )
  }
}

export const config: Config = {
  path: '/api/instagram-cache-status',
  // Two full scans of `instagram_cache` — the stats and the block list each
  // walk the whole collection — plus one ledger document, and no outbound
  // platform request. Cheap on a desk holding a few dozen rows and much less so
  // on one holding thousands, and this is the obvious endpoint to point a
  // monitor at, so it is capped rather than left to bill a pair of collection
  // scans every second to learn nothing new.
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip'] },
}
