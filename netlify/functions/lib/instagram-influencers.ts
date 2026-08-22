import {
  addCompetitorProfile,
  batchTrackCompetitors,
  getTrackedProfiles,
  profileIdFor,
  type BatchProgress,
  type CompetitorProfile,
  type SyncResult,
} from './competitor-tracker'
import { parseHandle, readHandle } from './handles'
import { configFor, recordRequest, waitForRateLimit } from './rate-limiter-advanced'

/**
 * The Instagram accounts on the influencer watch, and the check that puts them
 * there.
 *
 * WHAT THIS FILE NO LONGER CLAIMS TO DO. Its entry point was
 * `discoverPoliticalCreators`, which read `instagram.com/explore/tags/<tag>/`
 * for a dozen hardcoded hashtags and pulled every `@word` out of the response.
 * No part of that worked. Instagram serves a logged-out tag page as a login
 * wall, so what was being mined was chrome and script, and `/@([a-zA-Z0-9_.]+)/`
 * over a script bundle yields `@media` and `@font-face` as readily as a person.
 * Whatever survived was then given a follower count from the first "N followers"
 * anywhere on the page, a `verified` flag from a test for the word "verified" —
 * which every Instagram page satisfies somewhere in its JavaScript — and an
 * "engagement rate" computed as three per cent of the follower count divided by
 * the post count, a figure with no measurement of any kind behind it. That is
 * not discovery. It is invention with a fetch in the middle of it, and an office
 * shown its output would have been reading fabricated rivals.
 *
 * `influencers.ts` reached the same conclusion for the platform generally and
 * wrote it down: YouTube is the one platform of the seven that answers a keyless
 * search from a server, and for Instagram there is no evidence-first path to a
 * roster at all. Nothing here changes that, so this file stops pretending to
 * find accounts and does the part that is real.
 *
 * WHAT IT DOES INSTEAD. Handles arrive from somewhere that can genuinely produce
 * them — an operator typing one in, `rivals.ts` proposing one, an author read
 * off a post already analysed — and each is put to Instagram through
 * `readHandle`, the same reader the dashboard uses live. An account that comes
 * back with something only a real account has is enrolled on the watch as an
 * influencer; one that does not is discarded, and the discard is reported rather
 * than swallowed. Every unchecked handle says why it went unchecked, because a
 * verification pass that silently returns four of nine reads as "the other five
 * do not exist".
 *
 * Reading the enrolled accounts afterwards is not repeated here. That is
 * `batchTrackCompetitors`, which already orders by platform cost, calls
 * `syncProfile` per account and reports what the budget did not reach; a second
 * sync loop in this file would be a second, differently behaved reader of the
 * same accounts.
 */

/**
 * An Instagram account the platform has just confirmed exists.
 *
 * Deliberately smaller than what this file used to return. `postsCount`,
 * `verified` and `engagementRate` are gone because none of the three can be read
 * from a logged-out Instagram page, and each was previously supplied by a regex
 * that matched something else.
 */
export interface InstagramCreator {
  /** `profileIdFor('Instagram', handle)`, so the roster and this agree on keys. */
  id: string
  platform: 'Instagram'
  handle: string
  displayName: string | null
  profileUrl: string
  avatarUrl: string | null
  /** Null when Instagram would not give it up on this read. Never zero. */
  followers: number | null
  /** What Instagram published about this account's posts, verbatim from the reader. */
  listingNote: string
  /** ISO-8601. When the platform last confirmed the account. */
  verifiedAt: string
}

export interface CreatorCheck {
  /** The normalised handle, or the raw input when it could not be normalised. */
  handle: string
  /** Null when Instagram returned nothing only a real account has. */
  creator: InstagramCreator | null
  /** Set when the handle was not put to Instagram at all this run, and why. */
  skipped?: string
}

/**
 * Instagram allows letters, digits, full stops and underscores, up to thirty
 * characters. Anything failing that is not a mistyped handle — it is a link to
 * another platform, a display name, or a fragment of prose — and putting it to
 * Instagram would spend a minute of the rate-limit budget to be told so.
 */
const HANDLE_SHAPE = /^[a-zA-Z0-9._]{1,30}$/

/**
 * Path segments Instagram reserves for itself. Without this a pasted post URL
 * (`instagram.com/p/C3x...`) parses to the handle `p`, and the run would verify,
 * enrol and then sync an account that is a route rather than a person.
 */
const RESERVED = new Set([
  'about',
  'accounts',
  'developer',
  'direct',
  'directory',
  'explore',
  'legal',
  'p',
  'reel',
  'reels',
  'stories',
  'tv',
])

function normaliseHandle(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  // The hint matters: a bare handle carries no platform of its own, and
  // `parseHandle` returns null rather than guessing when it has neither a URL
  // nor a hint.
  const ref = parseHandle(raw, 'Instagram')
  if (!ref || ref.platform !== 'Instagram') return null
  const handle = ref.handle.replace(/^@/, '').replace(/\/+$/, '')
  if (!HANDLE_SHAPE.test(handle) || RESERVED.has(handle.toLowerCase())) return null
  return handle
}

/**
 * Instagram's public reader makes two requests behind `readHandle`, with 10s
 * and 9s timeouts. A handle therefore needs roughly twenty seconds of budget
 * after its pause; starting one with less buys the pause and then gets killed
 * mid-read, which costs the wait and returns nothing.
 */
const READ_BUDGET_MS = 20_000

/**
 * Instagram's minimum gap, taken from the shared config rather than restated
 * here, so this and the batch sync cannot drift into pacing the same platform
 * at two different speeds.
 */
const MIN_GAP_MS = configFor('Instagram').minDelayMs

/**
 * Put one handle to Instagram and keep it only if the platform answered.
 *
 * The test for "answered" mirrors `rivals.ts`: a follower count, or a post list.
 * An HTTP 200 is not evidence — Instagram returns 200 for handles that do not
 * exist, which is the whole reason a verification step is needed before an
 * account can appear on a watch.
 *
 * `licensed: false` because at this point the handle is still somebody's claim.
 * Falling through to a paid provider would bill a lookup for every typo, and a
 * reseller answering for a handle Instagram itself will not confirm would verify
 * an account that is not there. The licensed route is worth paying for later,
 * once the account is enrolled and `syncProfile` reads it on a schedule.
 *
 * This form does not pause between calls. Use `verifyInstagramCreators` for more
 * than one handle — Instagram's minimum gap is a minute, and reading two
 * accounts back to back from a datacentre address is what earns the 429.
 */
export async function verifyInstagramCreator(handle: string): Promise<InstagramCreator | null> {
  const user = normaliseHandle(handle)
  if (!user) return null

  try {
    const summary = await readHandle({ platform: 'Instagram', handle: user }, { licensed: false })
    const answered = summary.followers != null || summary.posts.length > 0

    /**
     * Recorded without a status code, because this call site never sees one.
     * `readInstagram` catches each of its own fetches and `fetchJson` returns
     * `ok: false` rather than throwing, so Instagram refusing us with a 429 and
     * Instagram answering about a handle that does not exist arrive here as the
     * same empty summary.
     *
     * Passing 200 — which is what this did — invents the one figure that
     * carries a consequence. `recordRequest` opens the platform's backoff
     * window on 429 and 403 alone, so a hardcoded 200 guarantees that window
     * can never open from this path, and `/api/instagram-cache-status` then
     * reports the platform as clear while every read of it is being refused.
     *
     * The underlying limit stands and is not repaired here: it would take the
     * reader surfacing the status it already has. What is honestly knowable at
     * this depth is whether the read produced anything, so that is what is
     * recorded, and it errs toward reading Instagram less rather than more.
     */
    await recordRequest('Instagram', answered)

    if (!answered) return null

    return {
      id: profileIdFor('Instagram', summary.handle),
      platform: 'Instagram',
      handle: summary.handle,
      displayName: summary.displayName,
      profileUrl: summary.profileUrl,
      avatarUrl: summary.avatarUrl,
      followers: summary.followers,
      listingNote: summary.listing.note,
      verifiedAt: new Date().toISOString(),
    }
  } catch {
    /**
     * Everything Instagram can do to us is already caught inside `readHandle`
     * — `readInstagram` around its own fetches, `storedPosts` around Firestore
     * — so a throw arriving here is far likelier to be ours than the platform's,
     * and no status code is claimed for it. The request is still counted: one
     * may well have gone out before the throw, and over-counting costs a pause
     * that was going to be taken anyway, where under-counting spends the hour's
     * allowance without recording that it was spent.
     */
    await recordRequest('Instagram', false)
    return null
  }
}

/**
 * Verify a list of handles, pausing between them, and stop when the run can no
 * longer afford the next pause.
 *
 * The budget is honoured rather than slept through because Netlify kills a
 * synchronous function at 60 seconds and Instagram's gap is 60 seconds — a
 * caller that blocked on the second handle would never reach the third in any
 * invocation. Whatever is left unchecked comes back marked as unchecked, so the
 * caller can invoke again with the remainder.
 */
export async function verifyInstagramCreators(
  handles: string[],
  options: { budgetMs?: number } = {},
): Promise<CreatorCheck[]> {
  const deadline = Date.now() + (options.budgetMs ?? Infinity)
  const checks: CreatorCheck[] = []

  // Normalise and de-duplicate first. The same account reached by a URL and by
  // a bare handle is one account, and paying Instagram's minute twice for it
  // would halve what a run gets through.
  const targets: Array<{ input: string; handle: string | null }> = []
  const seen = new Set<string>()
  for (const raw of handles) {
    const handle = normaliseHandle(raw)
    if (handle) {
      if (seen.has(handle)) continue
      seen.add(handle)
    }
    targets.push({ input: raw, handle })
  }

  /**
   * Once a run cannot afford one pause it cannot afford the next either — the
   * hour's allowance is spent, or Instagram is in backoff, or the wall clock
   * has gone — so every handle still queued needs at least as long as the one
   * that would not fit. They are all reported unread at that point rather than
   * looping to rediscover the same refusal once per handle.
   */
  const shelveFrom = (index: number): void => {
    for (const rest of targets.slice(index)) {
      checks.push({
        handle: rest.handle ?? rest.input,
        creator: null,
        skipped: 'Instagram needs a longer pause than this run has left. Not checked.',
      })
    }
  }

  let lastReadAt: number | null = null

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!
    if (!target.handle) {
      checks.push({
        handle: target.input,
        creator: null,
        skipped:
          'Not an Instagram handle. Instagram allows letters, digits, full stops and underscores, up to thirty characters.',
      })
      continue
    }

    const cleared = await waitForRateLimit(
      'Instagram',
      Math.max(0, deadline - Date.now() - READ_BUDGET_MS),
    )
    if (!cleared) {
      shelveFrom(i)
      break
    }

    /**
     * A second pause, because the first one is not always there.
     *
     * `getRateLimitStatus` opens every gate immediately when a deploy has no
     * Firestore, and says so plainly: without the shared ledger the caller is
     * expected to pace itself within its own invocation. This loop did not,
     * and every target in it is the same platform, so an unconfigured deploy
     * put its whole queue to Instagram inside a few seconds — which is the
     * case `RATE_LIMIT_CONFIGS` records from measurement: two reads back to
     * back from a datacentre address returned 429 and stayed refused through a
     * ninety-second wait.
     *
     * Measured from the end of the previous read, so the two waits do not
     * stack. Where the ledger is present and has already slept its minute,
     * that minute has elapsed here too and this comes out at zero.
     */
    const gap = lastReadAt === null ? 0 : Math.max(0, MIN_GAP_MS - (Date.now() - lastReadAt))
    if (gap > 0) {
      if (Date.now() + gap + READ_BUDGET_MS > deadline) {
        shelveFrom(i)
        break
      }
      await new Promise((resolve) => setTimeout(resolve, gap))
    }

    const creator = await verifyInstagramCreator(target.handle)
    // Stamped whether or not the account resolved. A request went out either
    // way, and the request is what Instagram is counting.
    lastReadAt = Date.now()
    checks.push({ handle: target.handle, creator })
  }

  return checks
}

/**
 * Put verified accounts on the watch, as influencers.
 *
 * They go into the tracked roster beside the competitors rather than into a
 * collection of their own. `CompetitorProfile.category` already carries an
 * `influencer` value, and a second collection would be a second answer to "who
 * is being watched" that the sync, the dashboard and the follower history would
 * each have to be taught about separately.
 *
 * Throws when this deploy has no Firebase, because `addCompetitorProfile` does.
 * That is deliberate there and inherited here: a read degrades to "nothing
 * stored", but a write reporting success without storing anything is a lie the
 * operator only discovers when the watch comes back empty a fortnight later.
 */
export async function enrolCreators(creators: InstagramCreator[]): Promise<string[]> {
  const ids: string[] = []
  for (const creator of creators) {
    ids.push(
      await addCompetitorProfile({
        platform: 'Instagram',
        handle: creator.handle,
        name: creator.displayName ?? creator.handle,
        profileUrl: creator.profileUrl,
        category: 'influencer',
        followers: creator.followers,
        displayName: creator.displayName,
        avatarUrl: creator.avatarUrl,
        listingNote: creator.listingNote,
      }),
    )
  }
  return ids
}

/**
 * The Instagram accounts currently on the influencer watch.
 *
 * Sorted by follower count, with accounts whose count Instagram would not give
 * up placed last rather than treated as zero: `-1` sorts an unknown below a
 * genuine zero, so an account that has simply never been read does not appear
 * above one that has been read and found small.
 */
export async function getTrackedCreators(): Promise<CompetitorProfile[]> {
  const profiles = await getTrackedProfiles('influencer')
  return profiles
    .filter((profile) => profile.platform === 'Instagram')
    .sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1))
}

/**
 * Sync every Instagram account on the influencer watch.
 *
 * A thin pass through to `batchTrackCompetitors` on purpose. It already sits on
 * `syncProfile`, already honours the wall-clock budget, and already returns the
 * accounts it did not reach so the caller can invoke again — and at one minute
 * per Instagram account, a run of any size needs several invocations.
 */
export async function trackInstagramCreators(
  options: { budgetMs?: number; onResult?: (result: SyncResult) => void } = {},
): Promise<BatchProgress> {
  const creators = await getTrackedCreators()
  return batchTrackCompetitors(creators, options)
}
