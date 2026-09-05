import type { Platform } from '@shared/taxonomy'
import { analysedPostsFor, saveStandingCache, type Standing, type TrackedHandle } from '@/lib/handles'
import { fetchWithTimeout } from '@/lib/net'

/**
 * Score an account's comments, and keep the result.
 *
 * WHY THIS IS ITS OWN MODULE. The reading that assigns a side to a comment
 * lived inside the Accounts screen as a per-row "Read opinion" button, and
 * `accounts` is UNLISTED — reachable only through Settings' tools list. So on
 * a real desk almost nobody ever ran it: `saveStandingCache` never fired,
 * `readStandingCache` returned null for ever, and every comment the desk held
 * came from a post reading with no side. The screen printed "Not scored"
 * against row after row, which reads as a classifier that has given up rather
 * than a step that was never taken.
 *
 * Extracted so the screen that SHOWS the problem can also fix it, without
 * duplicating a flow that has real subtleties in it.
 *
 * TWO ROUTES, AND THEY ARE NOT THE SAME EVIDENCE. A platform that publishes a
 * post list to a stranger can be crawled; the rest are scored on posts this
 * office already analysed by hand. `source` records which one produced the
 * reading, because "72% of commenters" and "coverage is broadly favourable"
 * are different claims and an office acting on the second while believing the
 * first will get it wrong.
 */

/** Platforms that publish a post list to a logged-out reader. */
const AUTO = new Set<Platform>(['YouTube', 'Bluesky', 'Mastodon', 'Reddit'])

export interface ScoreOutcome {
  handleId: string
  /** The account's name, for a message a person can read. */
  label: string
  scored: boolean
  /** Why nothing was scored, when nothing was. */
  reason: string | null
  commentsRead: number
}

/**
 * Read one account's comments and store the standing.
 *
 * Deliberately does NOT fall through to the web-search "record" route the
 * Accounts screen offers. That route produces a standing out of what
 * newspapers wrote, which is a real thing to want and NOT an answer to "score
 * the comments I have already read" — filing it here would put a summary of
 * press coverage behind a button labelled as scoring comments.
 */
export async function scoreComments(h: TrackedHandle): Promise<ScoreOutcome> {
  const label = h.displayName || h.handle
  const crawlable = AUTO.has(h.platform)
  const analysed = crawlable ? [] : analysedPostsFor(h)

  if (!crawlable && analysed.length === 0) {
    return {
      handleId: h.id,
      label,
      scored: false,
      commentsRead: 0,
      reason: `${h.platform} publishes no post list to a logged-out reader, and this desk has not analysed any of ${label}'s posts yet. Analyse one and its comments can be scored.`,
    }
  }

  try {
    const res = crawlable
      ? await fetchWithTimeout(`/api/standing?q=${encodeURIComponent(h.profileUrl || h.handle)}`)
      : await fetchWithTimeout('/api/standing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: analysed, platform: h.platform, handle: h.handle }),
        })
    const j = (await res.json()) as Record<string, unknown>
    const commentsRead = Number(j['commentsRead'] ?? 0)

    /**
     * A read that returned no comments is not a result.
     *
     * Storing it would put "0% negative across 0 comments" on the screen as a
     * finding, which is a confident statement about nothing.
     */
    if (!res.ok || commentsRead === 0) {
      return {
        handleId: h.id,
        label,
        scored: false,
        commentsRead: 0,
        reason:
          typeof j['error'] === 'string'
            ? String(j['error'])
            : `No comments came back for ${label}. Nothing was stored rather than storing an empty reading as a finding.`,
      }
    }

    const standing: Standing = {
      score: Number(j['score'] ?? 0),
      label: String(j['label'] ?? 'Mixed'),
      positive: Number(j['positive'] ?? 0),
      negative: Number(j['negative'] ?? 0),
      neutral: Number(j['neutral'] ?? 0),
      praise: (j['praise'] as string[]) ?? [],
      criticism: (j['criticism'] as string[]) ?? [],
      summary: String(j['summary'] ?? ''),
      commentsRead,
      postsRead: Number(j['postsRead'] ?? 0),
      readAt: new Date().toISOString(),
      source: 'comments',
    }
    saveStandingCache(h.id, standing)
    return { handleId: h.id, label, scored: true, commentsRead, reason: null }
  } catch {
    return {
      handleId: h.id,
      label,
      scored: false,
      commentsRead: 0,
      reason: `Could not reach the server to score ${label}'s comments.`,
    }
  }
}

/**
 * Score every account in turn, newest evidence first.
 *
 * Sequential on purpose: each call is several live post reads plus a model
 * call, and firing six at once is how a desk gets rate-limited off a platform
 * mid-read — which then looks like the account having no comments.
 */
export async function scoreAll(
  handles: TrackedHandle[],
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<ScoreOutcome[]> {
  const out: ScoreOutcome[] = []
  for (const [i, h] of handles.entries()) {
    onProgress?.(i, handles.length, h.displayName || h.handle)
    out.push(await scoreComments(h))
  }
  onProgress?.(handles.length, handles.length, '')
  return out
}
