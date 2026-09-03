/**
 * The two walks, extracted so two callers can share them.
 *
 * `server.ts` has always owned these: open a page on the one shared profile,
 * pace, check for a login wall, hand the page to the adapter. The collector
 * needs exactly the same walk, driven by a job list instead of an HTTP
 * request, and duplicating a login-wall check is how the two copies drift
 * until one of them walks straight past a wall and files an empty profile as
 * a finding. One implementation, two callers.
 *
 * The contract both callers rely on, restated from the adapters: a result is
 * either `ok` with items (possibly none, which is an answer) or not `ok`
 * with a reason, and `needsLogin` marks the one failure a human must fix.
 */
import { newPage, makePacer, goto } from './browser'
import { adapters } from './adapters'
import type { AdapterContext, Platform, ProfileInfo, ScrapedComment, ScrapedPost } from './types'

export type WalkLog = (msg: string) => void

export interface WalkFailure {
  ok: false
  reason: string
  needsLogin?: boolean
}

export type PostsWalk = { ok: true; items: ScrapedPost[]; note?: string } | WalkFailure
export type CommentsWalk = { ok: true; items: ScrapedComment[]; note?: string } | WalkFailure

export async function runPosts(
  platform: Platform,
  handle: string,
  limit: number,
  log: WalkLog,
): Promise<PostsWalk> {
  const adapter = adapters[platform]
  const page = await newPage(true)
  const ctx: AdapterContext = { page, log, pace: makePacer(platform), limit }

  try {
    await ctx.pace()
    await goto(page, adapter.profileUrl(handle))

    if (await adapter.isLoginWall(ctx)) {
      return {
        ok: false,
        reason: `${platform} showed a login wall. Run \`npm run scraper:login\` and sign in.`,
        needsLogin: true,
      }
    }
    return await adapter.posts(ctx, handle)
  } finally {
    await page.close().catch(() => {})
  }
}

export async function runComments(
  platform: Platform,
  url: string,
  limit: number,
  log: WalkLog,
): Promise<CommentsWalk> {
  const adapter = adapters[platform]
  if (!adapter.comments) {
    // Answered honestly: this adapter does not do comments, so the caller
    // should fall through to its own public reader rather than treat this as
    // an outage. An empty success is the contract's way of saying that.
    return { ok: true, items: [], note: 'no comment adapter' }
  }
  const page = await newPage(true)
  const ctx: AdapterContext = { page, log, pace: makePacer(platform), limit }
  try {
    await ctx.pace()
    await goto(page, url)
    if (await adapter.isLoginWall(ctx)) {
      return {
        ok: false,
        reason: `${platform} showed a login wall.`,
        needsLogin: true,
      }
    }
    return await adapter.comments(ctx, url)
  } finally {
    await page.close().catch(() => {})
  }
}

export type SnapshotWalk =
  | { ok: true; profile: ProfileInfo | null; items: ScrapedPost[]; note?: string }
  | WalkFailure

/**
 * One visit, both readings: the head count and the post list.
 *
 * `refresh-followers` and the posts walk have always landed on the same page
 * and read different corners of it in separate passes. A collector paying for
 * every navigation with pacing time and detection risk takes both readings in
 * one visit. The profile read is best-effort: a null head count is an honest
 * "not measured", never a zero, and never a reason to drop the posts.
 */
export async function runSnapshot(
  platform: Platform,
  handle: string,
  limit: number,
  log: WalkLog,
): Promise<SnapshotWalk> {
  const adapter = adapters[platform]
  const page = await newPage(true)
  const ctx: AdapterContext = { page, log, pace: makePacer(platform), limit }
  try {
    await ctx.pace()
    await goto(page, adapter.profileUrl(handle))
    if (await adapter.isLoginWall(ctx)) {
      return {
        ok: false,
        reason: `${platform} showed a login wall. Run \`npm run scraper:login\` and sign in.`,
        needsLogin: true,
      }
    }
    const profile = adapter.profile ? await adapter.profile(ctx, handle).catch(() => null) : null
    const posts = await adapter.posts(ctx, handle)
    if (!posts.ok) return posts
    return { ok: true, profile, items: posts.items, ...(posts.note ? { note: posts.note } : {}) }
  } finally {
    await page.close().catch(() => {})
  }
}
