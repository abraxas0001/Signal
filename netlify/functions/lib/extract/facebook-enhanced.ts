import type { PostSnapshot } from '../../../../shared/types'
import type { UrlIdentity } from '../platform'
import { readHandle } from '../handles'
import { extractMeta } from './meta'
import type { ExtractContext, ExtractResult } from './types'

/**
 * Facebook: send each link to the reader that suits its shape.
 *
 * This module once carried its own post reader. It was replaced by delegation
 * rather than repaired, because on every axis that matters it was the weaker of
 * two implementations of the same job. `meta.ts` resolves /share/ links through
 * the redirect and rebuilds the canonical permalink when Meta answers the share
 * form with a stripped shell; it rotates crawler identities behind
 * ALLOW_CRAWLER_UA; it recognises Facebook's "video not found" shell rather
 * than reporting an unrelated promoted video's 64 reactions as the post's; it
 * anchors the counts to the story id so a reel does not borrow a neighbour's
 * figures; it reads comment bodies and the exact follower count. The reader
 * here matched `"message":"([^"]*)"` for the text, `<div[^>]*comment[^>]*>` for
 * the comments — which matches nothing in Facebook's actual markup — and
 * attributed whatever it did find to "Anonymous" with a like count of 0 that no
 * one had read anywhere. Keeping any of it would have been a regression on
 * /api/analyse's most-used path.
 *
 * One thing it saw that `meta.ts` does not: a Facebook link is not always a
 * post. A page URL has no story id, and the post reader answers it by
 * describing the account's landing page as though it were something someone had
 * published. That case is the whole remaining reason this file exists.
 */
export async function extractFacebookEnhanced(
  id: UrlIdentity,
  ctx: ExtractContext,
): Promise<ExtractResult> {
  const handle = accountHandle(id)
  return handle ? extractFacebookAccount(id, handle, ctx) : extractMeta(id, ctx)
}

/**
 * Path segments that sit where a vanity handle would but name a Facebook
 * feature instead.
 *
 * The cost of a wrong answer is asymmetric, which is why this is a deny-list
 * read conservatively rather than a pattern. Mistaking an account for a post
 * loses one follower count; mistaking a post for an account routes the
 * product's primary feature away from the only reader that can do the job.
 */
const RESERVED_SEGMENTS = new Set([
  'ads',
  'bookmarks',
  'business',
  'events',
  'gaming',
  'groups',
  'hashtag',
  'help',
  'l.php',
  'live',
  'login',
  'marketplace',
  'media',
  'messages',
  'notes',
  'pages',
  'people',
  'permalink.php',
  'photo',
  'photo.php',
  'photos',
  'plugins',
  'policies',
  'posts',
  'privacy',
  'profile.php',
  'reel',
  'reels',
  'search',
  'settings',
  'share',
  'sharer.php',
  'story.php',
  'video.php',
  'videos',
  'watch',
])

/**
 * The account this link points at, or null if it points at a post.
 *
 * `identify` has already parsed a story id out of every permalink shape
 * Facebook publishes — /posts/, /videos/, /reel/, /share/, fb.watch and
 * story.php?story_fbid= — so an id being present settles the question on its
 * own. What remains is a bare /<vanity> path, optionally followed by /about.
 * Anything deeper is a page section this reader has nothing to say about, and
 * is left with the post reader.
 */
function accountHandle(id: UrlIdentity): string | null {
  if (id.id) return null

  let segments: string[]
  try {
    segments = new URL(id.canonical).pathname.split('/').filter(Boolean)
  } catch {
    return null
  }

  const first = segments[0]
  if (!first) return null
  if (segments.length > 2) return null
  if (segments.length === 2 && segments[1] !== 'about') return null
  if (RESERVED_SEGMENTS.has(first.toLowerCase())) return null
  // Facebook vanity handles are letters, digits and full stops. A numeric page
  // id in the same position is also valid and resolves the same way.
  if (!/^[A-Za-z0-9.]{3,}$/.test(first)) return null
  return first
}

/**
 * How long the account branch will wait on the landing-page read.
 *
 * The extractor's whole budget is 22 seconds, and blowing it costs everything:
 * index.ts races the adapter against that deadline and discards whatever it was
 * holding. On an account page the landing read is the leg that can run long —
 * facebook.com/zuck carries no engagement payload under any identity, so
 * meta.ts works through all three crawler identities at nine seconds each and
 * came back at 16.9s measured, 77% of the budget, for a description and nothing
 * else. The follower count and display name are already in hand by then and
 * must not go down with it, so this leg is bounded well short of the ceiling.
 */
const PAGE_READ_BUDGET_MS = 14_000

/** Resolve with `null` rather than hanging past the caller's budget. */
function withDeadline<T>(ms: number, work: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer))
}

/**
 * A page or profile URL: read the account, and the landing page alongside it.
 *
 * Both legs run, and they run together. `meta.ts` is the only leg that returns
 * the About blurb and the page's own OpenGraph image, and it is what this route
 * did before this branch existed — so it stays, and a page link can never
 * analyse worse than it used to. `readHandle` is the only leg that returns the
 * follower count, which a page's own HTML withholds and Facebook's embeddable
 * Page plugin gives up in well under a second.
 *
 * In parallel because they touch unrelated endpoints and the budget is tight: a
 * profile page runs to several megabytes and ten seconds and more, so queuing a
 * sub-second plugin fetch behind it would buy nothing and put both at risk.
 */
async function extractFacebookAccount(
  id: UrlIdentity,
  handle: string,
  ctx: ExtractContext,
): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = [
    {
      strategy: 'facebook:account-link',
      ok: true,
      note: `this link names the account /${handle}, not a single post`,
    },
  ]

  const [base, summary] = await Promise.all([
    withDeadline(PAGE_READ_BUDGET_MS, extractMeta(id, ctx))
      .then(
        (result): ExtractResult =>
          result ?? {
            ok: false,
            attempts: [
              {
                strategy: 'facebook:page-read',
                ok: false,
                note: `Facebook had not returned the page after ${PAGE_READ_BUDGET_MS / 1000}s`,
              },
            ],
          },
      )
      .catch(
        (err: unknown): ExtractResult => ({
          ok: false,
          attempts: [
            {
              strategy: 'facebook:page-read',
              ok: false,
              note: err instanceof Error ? err.message : 'the page read threw',
            },
          ],
        }),
      ),
    // `licensed: false` deliberately. A data provider bills per call and what it
    // sells is a post list, which this route is not asking for and cannot show;
    // the two figures below cost nothing.
    readHandle({ platform: 'Facebook', handle }, { licensed: false }).catch(() => null),
  ])

  attempts.push(...base.attempts)

  attempts.push(
    summary
      ? {
          // Named apart from meta.ts's own `facebook:page-plugin` leg, which
          // fires here too and reads the same live counter a second earlier —
          // two identically-labelled rows differing by one follower looked like
          // a contradiction rather than one number read twice.
          strategy: 'facebook:account-read',
          ok: summary.followers != null || summary.displayName != null,
          note:
            summary.followers != null
              ? `${summary.followers.toLocaleString('en-IN')} followers`
              : summary.listing.note,
        }
      : { strategy: 'facebook:account-read', ok: false, note: 'the account read failed' },
  )

  /**
   * Carry the page's own description and picture. Do not carry the counts.
   *
   * A page's landing HTML contains its feed, so `meta.ts` anchors and reads the
   * engagement bar of whichever post the feed happened to render first — on
   * /BJP4India that produced 65 reactions and 22 comments against an 18.9M
   * follower account, plus twenty comment bodies and a creation timestamp, all
   * belonging to a post the user never asked about. Attributing them to the
   * account states something false about it, which is worse than the blank
   * engagement block assemble leaves when this is omitted. The count-shaped
   * `extra` keys and the anchor's own story id go with them for the same reason.
   */
  const author = base.snapshot?.author
  const snapshot: Partial<PostSnapshot> = {
    platform: 'Facebook',
    postType: 'Original Post',
    publishedAt: null,
    ...(author ? { author } : {}),
    ...(base.snapshot?.content ? { content: base.snapshot.content } : {}),
    ...(base.snapshot?.media?.length ? { media: base.snapshot.media } : {}),
  }

  // Say what was dropped, not merely that something was. The counts are not the
  // only thing the feed spills: meta.ts reads comment bodies by scanning the
  // whole document for `"body":{"text":"`, with no anchor to a story id, so a
  // page read can come back with twenty comments and every count null — and
  // that drop used to leave no trace at all, because only engagement was
  // inspected here.
  const borrowedCounts = Object.values(base.snapshot?.engagement ?? {}).some(
    (m) => m != null && typeof m === 'object' && 'value' in m && m.value != null,
  )
  const borrowedComments = base.snapshot?.comments?.length ?? 0
  const borrowedDate = base.snapshot?.publishedAt != null

  if (borrowedCounts || borrowedComments > 0 || borrowedDate) {
    const dropped = [
      borrowedCounts ? 'an engagement bar' : null,
      borrowedComments > 0
        ? `${borrowedComments} comment ${borrowedComments === 1 ? 'body' : 'bodies'}`
        : null,
      borrowedDate ? 'a creation time' : null,
    ].filter((d): d is string => d !== null)

    attempts.push({
      strategy: 'facebook:account-feed',
      ok: false,
      note: `discarded ${dropped.join(', ')} — read off the post this page’s feed rendered first, not published by the account`,
    })
  }

  if (summary) {
    // accountType stays whatever the page read made of it. A follower count is
    // NOT evidence of a Page: /zuck is a personal profile and the plugin
    // answered it with 121,242,156, so classifying on that signal would have
    // filed Zuckerberg as a brand.
    snapshot.author = {
      name: summary.displayName ?? author?.name ?? null,
      handle,
      profileUrl: summary.profileUrl,
      avatarUrl: summary.avatarUrl ?? author?.avatarUrl ?? null,
      verified: author?.verified ?? null,
      followers:
        summary.followers != null
          ? {
              value: summary.followers,
              // 'owned' means the office's own Page token answered through the
              // Graph API; everything else came from the unauthenticated plugin.
              source: summary.listing.route === 'owned' ? 'platform-api' : 'public-endpoint',
            }
          : (author?.followers ?? { value: null, source: 'unavailable' }),
      accountType: author?.accountType ?? 'Unknown',
      declaredLocation: author?.declaredLocation ?? null,
    }
  }

  const hasText =
    Boolean(snapshot.content?.text?.trim()) || Boolean(snapshot.content?.title?.trim())

  /**
   * Say what the link is before offering the rescue, because the generic "no
   * readable post text" that assemble would otherwise add reads as a failure to
   * fetch. Nothing failed: there is no post at this address to fetch.
   *
   * Deferring to `base.blocked` first, as this did, meant the account message
   * could never appear on any path where the page read failed — every blocked
   * return in meta.ts carries no snapshot, so hasText is false on exactly those
   * paths. What the user got instead was written for a post URL: "Facebook did
   * not return this post to our server", or "this post has been deleted", with
   * a suggestion to paste the post text. That describes an account we had often
   * just read successfully — follower count and display name in hand — as an
   * unreadable post, and asked for the text of a post that does not exist.
   *
   * Routing settled that this link names an account before either leg ran, and
   * a landing page that would not load does not make that less true. So the
   * account leads, and the page failure is reported after it as the reason the
   * description is missing too, in the account's terms rather than the post's.
   */
  const blocked = hasText
    ? (base.blocked ?? null)
    : {
        reason:
          `This link is ${summary?.displayName ?? handle}’s Facebook account rather than a post, so there is no post text to read. ` +
          (base.blocked
            ? 'Facebook did not return the account page to our server either, so its description is missing as well. '
            : '') +
          (summary?.listing.note ?? 'Facebook does not publish a page’s post list to a server.'),
        suggestion:
          'Open the post you want and copy the address from the browser bar — it looks like facebook.com/<page>/posts/<number>. Or paste the post text below.',
      }

  return {
    ok: Boolean(summary?.followers != null || summary?.displayName || hasText),
    snapshot,
    attempts,
    confidence: hasText && summary?.followers != null ? 'medium' : 'low',
    ...(blocked ? { blocked } : {}),
    extra: {
      isAccountPage: true,
      ...(summary ? { postListing: summary.listing.note } : {}),
      ...(summary?.lastSyncedAt ? { lastSyncedAt: summary.lastSyncedAt } : {}),
    },
  }
}
