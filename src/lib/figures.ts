import type { Report } from '@shared/types'
import type { TrackedPost } from '@/lib/handles'

/**
 * ONE WITNESS ORDER FOR EVERY PUBLISHED FIGURE, EVERYWHERE.
 *
 * The desk holds two witnesses to what a platform published about a post: the
 * LISTING, harvested from the account's own grid, and the READING, fetched
 * from the post's own page. They disagree constantly, and on whole platforms
 * the disagreement is total — the collector stores no comment count for ANY
 * YouTube video, and no likes at all for some Instagram reels, while the
 * readings beside them hold both.
 *
 * Nine separate surfaces each answered that with their own rule. Measured on
 * D. K. Aruna's desk, the cost of the ones that read the listing alone:
 *
 *   - the Compare board understated her OWN total engagement by 35% — 28,098
 *     printed against 43,237 the desk holds — while rivals with complete
 *     listings came out near-correct, on the one screen whose entire job is
 *     that comparison;
 *   - "Most engaging posts" omitted her genuinely best post, a reel holding
 *     15,110 interactions, because its listing row is all-null and a null
 *     sorts behind every measured post;
 *   - the head-to-head read "he doubles your rate" (1.06% against 2.08%) where
 *     the desk holds "he leads narrowly" (1.69% against 2.08%);
 *   - one post could carry two different view counts on one dashboard, 4,111
 *     on a table and 3,937 in the reading behind it.
 *
 * So the order is fixed here, once, and every surface imports it: THE READING
 * FIRST, THE LISTING SECOND. The reading wins where it has a number because it
 * is the closer look — it read the post's own page. The listing fills in where
 * the reading has none, which is every post never read in full.
 *
 * NULL IS NEVER COALESCED TO ZERO. A figure neither witness states stays null
 * all the way to the surface, which is what lets a caller tell "nobody liked
 * it" apart from "nobody published it".
 */
export type FigureKey = 'likes' | 'comments' | 'shares' | 'views'

export function figureOf(
  post: Pick<TrackedPost, FigureKey>,
  report: Report | null | undefined,
  key: FigureKey,
): number | null {
  return report?.snapshot.engagement[key]?.value ?? post[key] ?? null
}

/** The three figures that make up a reaction count, merged the same way. */
export interface Reactions {
  likes: number | null
  comments: number | null
  shares: number | null
  /** True where at least one component was published by someone. */
  measured: boolean
  /**
   * The sum over the components that EXIST.
   *
   * Null where no component was published at all, so the caller renders "not
   * published" rather than a zero. Where some but not all exist the sum is
   * partial by necessity — `missing` names which, so a surface can say so
   * instead of passing a partial total off as a complete one.
   */
  total: number | null
  missing: FigureKey[]
}

export function reactionsOf(
  post: Pick<TrackedPost, FigureKey>,
  report: Report | null | undefined,
): Reactions {
  const likes = figureOf(post, report, 'likes')
  const comments = figureOf(post, report, 'comments')
  const shares = figureOf(post, report, 'shares')
  const measured = likes != null || comments != null || shares != null
  const missing: FigureKey[] = []
  if (likes == null) missing.push('likes')
  if (comments == null) missing.push('comments')
  if (shares == null) missing.push('shares')
  return {
    likes,
    comments,
    shares,
    measured,
    total: measured ? (likes ?? 0) + (comments ?? 0) + (shares ?? 0) : null,
    missing,
  }
}

/** Interactions in the narrower sense some screens use: likes and comments. */
export function interactionsOf(
  post: Pick<TrackedPost, FigureKey>,
  report: Report | null | undefined,
): { value: number | null; measured: boolean } {
  const likes = figureOf(post, report, 'likes')
  const comments = figureOf(post, report, 'comments')
  const measured = likes != null || comments != null
  return { value: measured ? (likes ?? 0) + (comments ?? 0) : null, measured }
}
