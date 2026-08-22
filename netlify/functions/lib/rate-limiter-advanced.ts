import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { db } from './firebase'

/**
 * How fast the batch sync is allowed to touch each platform.
 *
 * The ledger is in Firestore rather than in memory because the thing being
 * paced is not one process. Netlify runs each invocation in its own container,
 * so an in-memory counter resets every time the sync is resumed — which is
 * constantly, since a sync too long for one function's budget is deliberately
 * split across several (see `budget` in `competitor-tracker.ts`). Instagram
 * does not care that the second request came from a fresh container.
 *
 * WHAT THIS IS NOT: a way to read a platform faster than it wants to be read.
 * The delays here are what keeps a public profile answering at all; shrinking
 * them buys a few minutes and then a 429 that lasts hours. When a platform
 * refuses anyway, the answer is `social-source.ts`'s owned or licensed route,
 * not a shorter sleep.
 */

export interface RateLimitConfig {
  platform: string
  /** Minimum gap between two requests to this platform, in milliseconds. */
  minDelayMs: number
  maxRequestsPerHour: number
  /** How hard to back off after each successive refusal. */
  backoffMultiplier: number
}

export const RATE_LIMIT_CONFIGS: Record<string, RateLimitConfig> = {
  Instagram: {
    platform: 'Instagram',
    // The strictest by an order of magnitude, and measured rather than guessed:
    // two accounts read back-to-back from a datacentre address returned HTTP
    // 429 and stayed refused through a 90-second wait.
    minDelayMs: 60_000,
    maxRequestsPerHour: 50,
    backoffMultiplier: 2,
  },
  Facebook: {
    platform: 'Facebook',
    minDelayMs: 2_000,
    maxRequestsPerHour: 100,
    backoffMultiplier: 2,
  },
  LinkedIn: {
    platform: 'LinkedIn',
    minDelayMs: 3_000,
    maxRequestsPerHour: 50,
    backoffMultiplier: 2,
  },
  'Twitter/X': {
    platform: 'Twitter/X',
    minDelayMs: 1_000,
    maxRequestsPerHour: 200,
    backoffMultiplier: 2,
  },
  YouTube: {
    platform: 'YouTube',
    // A documented feed served to anyone. The delay is politeness, not evasion.
    minDelayMs: 500,
    maxRequestsPerHour: 5_000,
    backoffMultiplier: 1.5,
  },
  Bluesky: { platform: 'Bluesky', minDelayMs: 300, maxRequestsPerHour: 5_000, backoffMultiplier: 1.5 },
  Mastodon: { platform: 'Mastodon', minDelayMs: 300, maxRequestsPerHour: 5_000, backoffMultiplier: 1.5 },
}

/** Platforms with no entry read at the pace of the slowest documented public API. */
const FALLBACK: RateLimitConfig = {
  platform: 'unknown',
  minDelayMs: 2_000,
  maxRequestsPerHour: 100,
  backoffMultiplier: 2,
}

export function configFor(platform: string): RateLimitConfig {
  return RATE_LIMIT_CONFIGS[platform] ?? { ...FALLBACK, platform }
}

/**
 * One document per platform per hour.
 *
 * `Twitter/X` carries a slash, and a slash in a Firestore path segment is a
 * separator rather than a character — the same trap `profileDocId` avoids in
 * `handles.ts`. Left alone it would file X's ledger under a `Twitter`
 * document nobody reads, so every hour would look like the first.
 */
function ledgerId(platform: string): string {
  const slug = platform.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const now = new Date()
  return `${slug}_${now.toISOString().slice(0, 13)}`
}

export interface RateLimitStatus {
  canRequest: boolean
  /** How long to sleep before this request may go out. */
  waitTimeMs: number
  requestsThisHour: number
  hourlyLimit: number
  /** Set while the platform is in backoff after refusing us. */
  blockedUntil: Date | null
  /** Why, when `canRequest` is false. Surfaced to the operator verbatim. */
  reason: string | null
}

/**
 * Whether this platform may be read right now, and how long until it may be.
 *
 * With no Firestore this always says yes with the configured minimum delay.
 * That is the honest degradation: without the shared ledger there is nothing
 * to coordinate through, so the caller falls back to pacing itself within its
 * own invocation, which is what a single-container run does anyway.
 */
export async function getRateLimitStatus(platform: string): Promise<RateLimitStatus> {
  const config = configFor(platform)
  const open = (waitTimeMs: number): RateLimitStatus => ({
    canRequest: true,
    waitTimeMs,
    requestsThisHour: 0,
    hourlyLimit: config.maxRequestsPerHour,
    blockedUntil: null,
    reason: null,
  })

  const store = db()
  if (!store) return open(0)

  try {
    const snapshot = await store.collection('rateLimits').doc(ledgerId(platform)).get()
    if (!snapshot.exists) return open(0)

    const data = snapshot.data() ?? {}
    const requestsThisHour = typeof data['requests'] === 'number' ? data['requests'] : 0

    /**
     * A recorded block is enforced, not merely stored.
     *
     * The first version of this file wrote `blockedUntil` on every 429 and then
     * computed `canRequest` without reading it, so a platform that had just
     * refused us was retried immediately and kept the block alive. Backoff that
     * is written but not obeyed is worse than none: it costs a write and reads
     * in the logs as though something is protecting you.
     */
    const blockedUntilRaw = data['blockedUntil']
    const blockedUntil =
      blockedUntilRaw instanceof Timestamp ? blockedUntilRaw.toDate() : null
    if (blockedUntil && blockedUntil.getTime() > Date.now()) {
      return {
        canRequest: false,
        waitTimeMs: blockedUntil.getTime() - Date.now(),
        requestsThisHour,
        hourlyLimit: config.maxRequestsPerHour,
        blockedUntil,
        reason:
          typeof data['blockedReason'] === 'string'
            ? data['blockedReason']
            : `${platform} refused us and is in backoff.`,
      }
    }

    if (requestsThisHour >= config.maxRequestsPerHour) {
      // The hour bucket is the clock: whatever is left of it is the wait.
      const nextHour = new Date()
      nextHour.setMinutes(60, 0, 0)
      return {
        canRequest: false,
        waitTimeMs: nextHour.getTime() - Date.now(),
        requestsThisHour,
        hourlyLimit: config.maxRequestsPerHour,
        blockedUntil: nextHour,
        reason: `${platform}: ${requestsThisHour} reads this hour, limit ${config.maxRequestsPerHour}.`,
      }
    }

    const lastRaw = data['lastRequestAt']
    const lastRequestAt = lastRaw instanceof Timestamp ? lastRaw.toMillis() : 0
    const sinceLast = Date.now() - lastRequestAt
    // Never negative, and never the full delay when nothing was read recently —
    // the first read of a fresh hour used to sleep Instagram's whole 60s for no
    // reason, which on a 60s function budget consumed the entire invocation.
    const waitTimeMs = Math.max(0, config.minDelayMs - sinceLast)

    return {
      canRequest: true,
      waitTimeMs,
      requestsThisHour,
      hourlyLimit: config.maxRequestsPerHour,
      blockedUntil: null,
      reason: null,
    }
  } catch (err) {
    console.log(`[signal] rate ledger unreadable for ${platform}: ${String(err)}`)
    return open(0)
  }
}

/**
 * Record that a request went out, and open a backoff window if it was refused.
 *
 * Failures count toward the hourly total as much as successes do. Counting only
 * successes — as the first cut did — inverts the whole point: a platform that
 * has started refusing us is precisely the one we should be reading less, and
 * under that rule its refusals were free and the sync accelerated into a block.
 */
export async function recordRequest(
  platform: string,
  success = true,
  statusCode?: number,
): Promise<void> {
  const store = db()
  if (!store) return

  const config = configFor(platform)
  const refused = statusCode === 429 || statusCode === 403

  try {
    const ref = store.collection('rateLimits').doc(ledgerId(platform))

    let blockedUntil: Timestamp | null = null
    let blockedReason: string | null = null
    if (refused) {
      // Escalate with each consecutive refusal in this hour rather than always
      // waiting the same fixed hour: the second 429 means the first wait was
      // not enough, and repeating it just repeats the outcome.
      const snapshot = await ref.get()
      const priorBlocks =
        snapshot.exists && typeof snapshot.get('blocks') === 'number' ? snapshot.get('blocks') : 0
      const minutes = 15 * Math.pow(config.backoffMultiplier, Math.min(priorBlocks, 4))
      blockedUntil = Timestamp.fromMillis(Date.now() + minutes * 60_000)
      blockedReason = `${platform} answered ${statusCode}. Backing off ${Math.round(minutes)} minutes.`
    }

    await ref.set(
      {
        platform,
        hour: new Date().toISOString().slice(0, 13),
        requests: FieldValue.increment(1),
        failures: FieldValue.increment(success ? 0 : 1),
        ...(refused ? { blocks: FieldValue.increment(1) } : {}),
        lastRequestAt: Timestamp.now(),
        lastStatusCode: statusCode ?? (success ? 200 : 0),
        blockedUntil,
        blockedReason,
        // Firestore has no per-document TTL without a configured policy, and
        // these buckets are worthless once their hour is gone. Stamping the
        // expiry lets a TTL policy on `expiresAt` sweep them if one is set up,
        // and costs nothing if one never is.
        expiresAt: Timestamp.fromMillis(Date.now() + 48 * 60 * 60 * 1000),
      },
      { merge: true },
    )
  } catch (err) {
    console.log(`[signal] rate ledger unwritable for ${platform}: ${String(err)}`)
  }
}

/**
 * Sleep until this platform may be read, giving up if that is further away
 * than the caller can afford to wait.
 *
 * Returns whether the wait completed. `false` means the caller should skip
 * this profile and leave it for the next invocation — the sync is resumable
 * precisely so that a 40-minute Instagram backoff does not have to be sat
 * through inside a function that will be killed at 60 seconds regardless.
 */
export async function waitForRateLimit(platform: string, budgetMs = Infinity): Promise<boolean> {
  const status = await getRateLimitStatus(platform)
  if (status.waitTimeMs <= 0) return status.canRequest
  if (status.waitTimeMs > budgetMs) return false

  console.log(`[signal] ${platform}: waiting ${Math.round(status.waitTimeMs / 1000)}s`)
  await new Promise((resolve) => setTimeout(resolve, status.waitTimeMs))
  return status.canRequest
}

/**
 * How long a sync over these profiles should take.
 *
 * One read per profile, so the estimate is the sum of the per-platform delays
 * — not the delay multiplied by the number of posts wanted, which is what this
 * returned at first and which overstated an Instagram profile by 10x. An
 * estimate that says "45 minutes" for a 5-minute job is not a conservative
 * estimate, it is one the operator learns to ignore.
 */
export function estimateBatchDuration(
  profiles: Array<{ platform: string }>,
  _postsPerProfile = 10,
): { totalMs: number; totalMin: number; details: Record<string, number> } {
  const details: Record<string, number> = {}

  for (const profile of profiles) {
    const config = configFor(profile.platform)
    details[profile.platform] = (details[profile.platform] ?? 0) + config.minDelayMs
  }

  // Platforms are read in sequence within a platform but the sync moves between
  // them, so the floor is the largest single platform's queue rather than the
  // sum. Report the sum anyway — it is the pessimistic bound, and a sync that
  // finishes early is the failure mode nobody complains about.
  const totalMs = Object.values(details).reduce((a, b) => a + b, 0)

  return { totalMs, totalMin: Math.max(1, Math.ceil(totalMs / 60_000)), details }
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}
