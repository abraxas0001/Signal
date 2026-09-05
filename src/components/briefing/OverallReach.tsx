import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Eye, FileText, Heart, UserPlus, Users } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { Card } from '../ui'
import { PlatformBadge } from '@/components/kit'
import type { Report } from '@shared/types'
import { growthSummary, type GrowthSummary } from '@/lib/growth'
import type { TrackedHandle } from '@/lib/handles'
import { inWindow, presentAnchor, windowStart, windowDays as daysOf, type WindowId } from '@/lib/window'
import { InfoMark, NoData, WindowPicker, noReactionsReason, noViewsReason } from './controls'
import { absoluteDate, cn, compact, full } from '@/lib/utils'

/**
 * "Overall Reach" — section one of the dashboard, to the owner's reference
 * design: one card per platform in a row, then a strip of desk totals, with
 * the reference's time filter made real.
 *
 * The window filters POSTS: views, reactions and post counts are summed over
 * the posts published inside it. Follower counts are totals a platform holds,
 * not events inside a week, so they stay the latest reading whatever the
 * window says — cutting a follower count to "last week" would be arithmetic
 * on a number that has no date.
 *
 * WHAT THE REFERENCE ASKS FOR AND WHAT THIS SHOWS. The reference's totals
 * include Impressions and Profile Visits, which no platform publishes to
 * anybody outside the account's own analytics login. The slots carry the
 * nearest figures that ARE real — views the platforms published, and
 * comments actually read — and each dash explains itself on hover.
 */

interface PlatRow {
  platform: TrackedHandle['platform']
  followers: number | null
  views: number | null
  reactions: number | null
  posts: number
  /** Of those, how many actually published a reaction count. */
  postsWithReactions: number
  /**
   * Of those, how many actually published a view count.
   *
   * Kept for the same reason `postsWithReactions` is: the tile's own note used
   * to promise that "every figure on this tile is summed over exactly these N
   * posts", quoting the post count, while the sums beside it covered fewer.
   * Instagram, Last 6 months: "Posts 19" over an engagement figure of 19,323
   * summed across 18, because one reel published no likes, comments or shares
   * at all. A denominator that is not the denominator is worse than none.
   */
  postsWithViews: number
  /**
   * Of the posts carrying NO view figure, how many are video in the first
   * place.
   *
   * The note that explains the gap has to tell a photograph apart from a reel
   * the desk simply has not read: on Instagram the first can never carry a
   * play count and the second always can. Aruna's Instagram is exactly that
   * mixed case — thirteen photographs and one unread reel — so a sentence that
   * called all fourteen photographs would be stating something false about a
   * real post.
   */
  uncountedVideo: number
  /** Posts whose like / comment / share figure existed, from either source.
      The Engagement note names exactly what went into its sum from these:
      YouTube's listing publishes likes alone, and a note that said "likes plus
      comments plus shares" over a likes-only figure was over-claiming. */
  sawLikes: number
  sawComments: number
  sawShares: number
  /** Publish time of the OLDEST post counted here, for saying plainly why a
      wider window can show the same figures as a narrow one. */
  oldestCountedAt: string | null
  /** How many of this row's posts went up in the last seven days. A row's
      oldest date cannot answer that — one old post would hide fifty new ones —
      so the posts are counted as they are walked. */
  postsInLastWeek: number
  /** Comments stored on the posts in this window. */
  comments: number
  /** Of the window's posts, how many have any comments stored. */
  postsWithComments: number
  /** Of the window's posts, how many have a stored full reading at all. */
  postsRead: number
  /** Lifetime posts off the profile header, where the platform states one. */
  postsTotal: number | null
}

/**
 * THE NOTES ARE SHORT NOW, ON THE OWNER'S ORDER.
 *
 * Each of these used to be a paragraph — accurate, and unread. "Too much
 * explanation and confusing, no one gonna read it all." Worse, "8 of 18 posts
 * that carried one" read as the desk having READ only eight. So each note is
 * now at most three short sentences, says WHY a post is outside the sum
 * (a photo has no view count) rather than bare arithmetic, and the Engagement
 * note names exactly the components that went into it — "likes plus comments
 * plus shares" over a likes-only figure was an over-claim, and the office
 * caught it on a YouTube tile reading 1.
 */
function viewsLead(row: PlatRow): string {
  const gap = row.posts - row.postsWithViews
  /**
   * Facebook and Instagram both publish a play count on VIDEO and on nothing
   * else, so on both the gap is photographs and the answer is the same. The
   * office asked exactly this — "how come it is able to show for one post but
   * unable to show for others" — and the honest answer is the post's own kind,
   * not a failure. Where a video IS missing its count that is our gap, and the
   * sentence says so separately rather than blaming the platform.
   */
  if (row.platform === 'Instagram' || row.platform === 'Facebook') {
    const stills = gap - row.uncountedVideo
    let s = `View counts ${row.platform} published on the ${row.postsWithViews} video post${row.postsWithViews === 1 ? '' : 's'} here.`
    if (stills > 0)
      s += ` The other ${stills} ${stills === 1 ? 'is a photo, which gets' : 'are photos, which get'} no view count.`
    if (row.uncountedVideo > 0)
      s += ` ${row.uncountedVideo} video post${row.uncountedVideo === 1 ? '' : 's'} here still await a full reading.`
    return `${s} Views, not true impressions.`
  }
  let s = `View counts ${row.platform} published, summed.`
  if (gap > 0) s += ` ${gap} post${gap === 1 ? '' : 's'} here carried none.`
  return `${s} Views, not true impressions.`
}

function engagementLead(row: PlatRow): string {
  const parts = [
    row.sawLikes > 0 ? 'likes' : null,
    row.sawComments > 0 ? 'comments' : null,
    row.sawShares > 0 ? 'shares' : null,
  ].filter((x): x is string => x !== null)
  const absent = [
    row.sawLikes === 0 ? 'like' : null,
    row.sawComments === 0 ? 'comment' : null,
    row.sawShares === 0 ? 'share' : null,
  ].filter((x): x is string => x !== null)
  const head = parts.join(' + ')
  let s = `${head.charAt(0).toUpperCase()}${head.slice(1)}, summed across these posts.`
  if (absent.length > 0) s += ` ${row.platform} published no ${absent.join(' or ')} figures here.`
  return s
}

/**
 * Why a 30-day figure can equal the 7-day one: every counted post is younger
 * than a week, so the two windows hold the same posts. The office read the
 * matching totals as a broken filter; this one sentence is the difference
 * between "bug" and "an account that posted everything recently".
 */
function sameWindowClause(row: PlatRow, windowId: WindowId): string {
  if (windowId === 'week' || row.posts === 0 || row.oldestCountedAt === null) return ''
  if (Date.now() - new Date(row.oldestCountedAt).getTime() >= 7 * 86_400_000) return ''
  return ' Every post here is under a week old, so Last 7 days shows the same.'
}


function rowsFor(
  handles: TrackedHandle[],
  start: string | null,
  reports: Map<string, Report> | null,
  /** Exclusive upper bound, so the window before this one can be measured. */
  end: string | null = null,
): PlatRow[] {
  const byPlatform = new Map<TrackedHandle['platform'], PlatRow>()
  for (const h of handles) {
    const row =
      byPlatform.get(h.platform) ??
      ({
        platform: h.platform,
        followers: null,
        views: null,
        reactions: null,
        posts: 0,
        postsWithReactions: 0,
        postsWithViews: 0,
        uncountedVideo: 0,
        sawLikes: 0,
        sawComments: 0,
        sawShares: 0,
        oldestCountedAt: null,
        postsInLastWeek: 0,
        comments: 0,
        postsWithComments: 0,
        postsRead: 0,
        postsTotal: null,
      } as PlatRow)
    const latest = h.snapshots.at(-1)
    if (latest?.followers != null) row.followers = (row.followers ?? 0) + latest.followers
    if (latest?.postsTotal != null) row.postsTotal = (row.postsTotal ?? 0) + latest.postsTotal
    for (const p of latest?.posts ?? []) {
      // start === null here on purpose: the CARDS always read the latest
      // reading whole. YouTube stores the channel's all-time popular videos,
      // and windowing the cards blanked an account that plainly has views;
      // the per-window figures live on the totals strip below, where the
      // date fallback keeps them consistent with Content insights.
      const report = reports?.get(p.url) ?? null
      const at = p.publishedAt ?? report?.snapshot.publishedAt ?? null
      if (!inWindow(at, start)) continue
      if (end !== null && at !== null && at >= end) continue
      row.posts += 1
      if (report) row.postsRead += 1
      const stored = report?.snapshot.comments?.length ?? 0
      row.comments += stored
      if (stored > 0) row.postsWithComments += 1
      /**
       * A VIEW COUNT FROM EITHER PLACE THE DESK HOLDS ONE.
       *
       * The listing scrape carries no view figure on Facebook at all, so the
       * Facebook tile said "Views not published by Facebook" while this very
       * map held a scraped 15,759 for facebook.com/reel/1097305012953793/,
       * read from the post's own page on 30 August. Twelve stored readings
       * carry a Facebook view count. Declaring a platform silent while
       * holding its figure is the one kind of NA that is worse than a number:
       * it teaches the reader the absence is the platform's doing.
       *
       * (The witness order is stated below — one order, everywhere.)
       */
      /* Reading first — one witness order across the whole dashboard. The two
         disagree on ten posts (a counter that moved between two reads), and
         with the listing first this card and the post's own reading printed
         different view counts for the same post. Exactly one witness is ever
         summed, so nothing double counts. */
      const views = report?.snapshot.engagement.views.value ?? p.views ?? null
      if (views != null) {
        row.views = (row.views ?? 0) + views
        row.postsWithViews += 1
      } else if (/\/(?:reel|reels|tv|videos|watch)\//.test(p.url)) {
        // A reel permalink is the platform's own statement that the post is
        // video, so this counts what the desk failed to read rather than what
        // the platform never had.
        row.uncountedVideo += 1
      }
      if (at !== null && (row.oldestCountedAt === null || at < row.oldestCountedAt)) {
        row.oldestCountedAt = at
      }
      if (at !== null && Date.now() - new Date(at).getTime() < 7 * 86_400_000) {
        row.postsInLastWeek += 1
      }
      /**
       * Reactions on the same terms as the views above: each component from
       * the listing first, the stored reading second, and a component neither
       * place states stays out of the sum instead of riding in as a zero.
       * YouTube's listing publishes likes only, while the readings beside it
       * hold real comment counts the old sum silently dropped.
       */
      const likes = report?.snapshot.engagement.likes.value ?? p.likes ?? null
      const commentCt = report?.snapshot.engagement.comments.value ?? p.comments ?? null
      const shares = report?.snapshot.engagement.shares.value ?? p.shares ?? null
      const reactions =
        likes != null || commentCt != null || shares != null
          ? (likes ?? 0) + (commentCt ?? 0) + (shares ?? 0)
          : null
      if (reactions != null) {
        row.reactions = (row.reactions ?? 0) + reactions
        row.postsWithReactions += 1
        if (likes != null) row.sawLikes += 1
        if (commentCt != null) row.sawComments += 1
        if (shares != null) row.sawShares += 1
      }
    }
    byPlatform.set(h.platform, row)
  }
  return [...byPlatform.values()].sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1))
}

/**
 * A change, drawn as the reference draws it: an arrow and a percentage in
 * plain coloured text, with no pill behind it.
 *
 * The direction is carried by the arrow as well as the hue, so the figure
 * still reads for someone who cannot separate the green from the red.
 */
function DeltaText({
  value,
  title,
  className,
}: {
  value: number | null
  /** The absolute change behind the percentage, e.g. "+1,100 followers". */
  title?: string
  className?: string
}) {
  if (value == null) return null
  const up = value > 0
  const flat = value === 0
  const Arrow = up ? ArrowUp : ArrowDown
  return (
    <span
      className={cn('tnum inline-flex items-center gap-0.5 font-semibold', className)}
      style={{ color: flat ? 'var(--text-3)' : up ? 'var(--pos)' : 'var(--neg)' }}
      title={title}
    >
      {!flat && <Arrow size={13} aria-hidden strokeWidth={2.5} />}
      {Math.abs(value)}%
    </span>
  )
}

/**
 * One platform's tile, to the reference: the mark and the name, the follower
 * count, the change and what it is measured against, then a rule and the two
 * figures the platforms actually publish.
 *
 * THE SECOND ROW IS NAMED FOR WHAT IT HOLDS. The reference labels these
 * columns "Reach" and "Engagement". Reach is the count of distinct accounts
 * that saw a post, and no platform publishes it to a reader who is not signed
 * in as the account; what we hold is the view count the post itself displays.
 * Calling that "Reach" would put a number under a word it does not measure, so
 * the column keeps the name of the thing that was actually read.
 */
function PlatformCard({
  row,
  delta,
  windowText,
  windowId,
}: {
  row: PlatRow
  delta: { pct: number | null; delta: number; since: string | null } | null
  /** The picker's current window, so a note can say when windows coincide. */
  windowId: WindowId
  /**
   * What the change is measured against, where the baseline has no date.
   *
   * NOT the window. The reference prints "vs last 7 days" under this figure,
   * but a follower count is a total a platform holds, not a thing that
   * happened inside a week: the change we can honestly state is between two
   * READINGS of the account, whenever those were taken. The window picker
   * above still governs every posted figure on the card.
   *
   * Nor is it "the previous reading", which is what this used to say.
   * `growthFor` takes the reading nearest the chosen window's length, which
   * on a desk read three times in a fortnight is routinely not the previous
   * one. Where a date exists the caption prints it instead of this, which is
   * every real case; this is the wording for a baseline with no date on it.
   */
  windowText: string
}) {
  const slots: { label: string; value: number | null; why: string }[] = [
    {
      /**
       * NAMED "Total impressions" AT THE OWNER'S REQUEST.
       *
       * The figure underneath is unchanged: it is the VIEW COUNT the platform
       * published on the posts in this window. Views and impressions are not
       * the same measurement. An impression is a time the post was shown, and
       * no platform discloses that to anyone outside its own analytics login.
       * So the label is the owner's word and the note is the truth about where
       * the number came from, which is the only combination that keeps a
       * reader able to check it.
       *
       * These four tiles are now the ONLY place the words appear on this card,
       * and they all mean the view count, so the four of them add up to a
       * figure a reader can find. The totals band below carries the owner's
       * views-plus-reactions composite under its own arithmetic instead: two
       * sums under one label made 22.5K on the tiles and 45.8K on the band,
       * with nothing on the card to say why.
       */
      label: 'Total impressions',
      value: row.views,
      why:
        /**
         * AN EMPTY WINDOW IS NOT A SILENT PLATFORM.
         *
         * Both used to print `noViewsReason(platform)`, "views not published
         * by YouTube", so a week in which the account simply did not post
         * read as the platform withholding the figure. It is a different fact
         * and it has a different answer: widen the window. D. K. Aruna's
         * newest YouTube upload is 25 August, so a seven-day window holds
         * none of her thirty videos and the tile said the platform was
         * hiding something.
         *
         * AND A PLATFORM IS ONLY SILENT IF BOTH PLACES ARE. "Views not
         * published by Facebook" is a claim about Facebook, so it is reserved
         * for the case where neither the listing nor any full reading of
         * these posts carried a figure, and it now says which of the two was
         * actually looked in.
         */
        row.posts === 0
          ? 'No posts in this window — widen it to see older ones.'
          : row.views == null
            ? `${noViewsReason(row.platform)} Not in the listing, and not in any full reading of these posts.`
            : `${viewsLead(row)}${sameWindowClause(row, windowId)}`,
    },
    {
      label: 'Engagement',
      value: row.reactions,
      why:
        row.posts === 0
          ? 'No posts in this window — widen it to see older ones.'
          : row.reactions == null
            ? noReactionsReason(row.platform)
            : `${engagementLead(row)}${sameWindowClause(row, windowId)}`,
    },
    {
      /**
       * THE DENOMINATOR, ON THE TILE RATHER THAN BEHIND A HOVER.
       *
       * "Total impressions 5" against a 3,290-subscriber channel reads as
       * broken data, and the office said so. It is arithmetically right — one
       * video falls inside a thirty-day window and it has five views — but a
       * total with no count beside it gives a reader nothing to check it
       * against. With "Posts 1" on the same tile the five explains itself,
       * and a genuinely alarming figure would still look alarming.
       */
      label: 'Posts',
      value: row.posts,
      /**
       * THE FIGURES BESIDE IT COVER FEWER, AND THE NOTE NOW SAYS SO.
       *
       * This read "every figure on this tile is summed over exactly these N",
       * which was not true of either sum: a post the platform published no
       * likes, comments or shares for is not in the engagement total, and one
       * with no view count is not in the views total. Instagram, Last 6
       * months: 19 posts, engagement summed over 18. The band's own note two
       * rows down already got this right, so the tile was contradicting its
       * own card.
       */
      why:
        row.posts === 0
          ? 'This account published nothing inside this window.'
          : row.postsWithViews < row.posts || row.postsWithReactions < row.posts
            ? 'Posts published in this window. The figures beside it sum only the posts that published those numbers.'
            : 'Posts published in this window.',
    },
  ]

  return (
    <div className="rounded-[14px] border border-[var(--rule)] bg-[var(--surface)] p-4">
      <p className="flex items-center gap-2.5 text-[13.5px] font-medium text-ink-2">
        <PlatformBadge platform={row.platform} size={26} />
        <span className="truncate">{row.platform}</span>
      </p>

      <p className="tnum mt-3 text-[31px] font-bold leading-none tracking-[-0.03em]">
        {row.followers == null ? (
          <NoData reason="Followers were never read on this platform." />
        ) : (
          compact(row.followers)
        )}
      </p>

      <div className="mt-2.5 min-h-[38px]">
        {delta?.pct != null ? (
          <>
            {/* THE DAY, NOT "THE PREVIOUS READING".
                `growthFor` picks the reading NEAREST the chosen window's
                length, which is often not the previous one: D. K. Aruna's
                Instagram was read on 27 and 28 August and 4 September, so on
                Last 30 days the baseline is 27 August and the tile said
                "+2,100 followers since the previous reading" when the change
                since the previous reading is +1,800. The caption directly
                below it already named 27 Aug, so the tile disagreed with
                itself by a figure the office could check. Both now come off
                the same date. */}
            <DeltaText
              value={delta.pct}
              title={`${delta.delta > 0 ? '+' : ''}${full(delta.delta)} followers since ${
                delta.since ? absoluteDate(delta.since) : 'an earlier reading of this account'
              }`}
              className="text-[14px]"
            />
            <p className="mt-0.5 truncate text-[12.5px] text-ink-3">
              {delta.since ? `since ${absoluteDate(delta.since)}` : windowText}
            </p>
          </>
        ) : (
          <p className="truncate text-[12.5px] text-ink-3">
            {row.followers == null ? 'Not read yet' : 'One reading so far'}
          </p>
        )}
      </div>

      {/* Three across, one line. Two columns wrapped the third onto a row of
          its own and left a half-empty shelf under every tile; the labels are
          short enough to sit side by side and the card gets its height back. */}
      <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-2 border-t border-[var(--rule)] pt-3">
        {slots.map((slot) => (
          <div key={slot.label} className="min-w-0">
            {/* THE LABEL WRAPS RATHER THAN TRUNCATING, IN A BOX SIZED FOR THE
                LONGEST OF THEM.

                "Total impressions" is the owner's word for this figure and it
                needs 95px in a 70px slot, so `truncate` was cutting it to
                "Total impressi…". Letting it wrap fixed that and broke
                something else: it took two lines while "Engagement" and
                "Posts" took one, so the three figures under them sat at three
                different heights and the row read, in the office's words, as
                looking up and down.

                The grid equalises the CELLS, not the parts inside them, so
                the label box is what has to be equalised — two lines' worth,
                always, whether the label needs them or not. Then every figure
                in the row starts on one line. */}
            <p className="flex min-h-[2.5em] items-start gap-0.5 text-[11.5px] leading-tight text-ink-3">
              <span className="min-w-0">{slot.label}</span>
              {/* Only where there IS a figure: an absent one renders as NA,
                  which carries the same explanation on its own mark, and two
                  i marks side by side on one row is just clutter. */}
              {slot.value != null && (
                <InfoMark note={slot.why} className="mt-px size-[15px] shrink-0" />
              )}
            </p>
            <p className="tnum mt-1 truncate text-[14.5px] font-bold">
              {slot.value == null ? <NoData reason={slot.why} /> : compact(slot.value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * One slot of the totals band: the badge, the label, then the figure with its
 * change beside it.
 *
 * EVERY BADGE WEARS THE SAME TINT. These were five different hues on the
 * reasoning that five identical badges read as wallpaper. But colour on a
 * dashboard is supposed to encode something, and there is nothing here for it
 * to encode: the five totals are not a series, not a scale and not a set of
 * statuses. Five arbitrary hues say "these differ" without saying how, so the
 * badges take one quiet accent tint and the words do the distinguishing, which
 * is what the reference does too.
 *
 * Anything that would have been a caption sentence rides on the label's mark
 * instead, per the office's rule about explanations belonging behind an i.
 */
function TotalTile({
  icon,
  label,
  value,
  delta,
  note,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  delta?: number | null
  note?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-2 py-2.5">
      <span
        className="grid size-10 shrink-0 place-items-center rounded-[11px]"
        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-0.5 text-[12.5px] font-medium text-ink-3">
          <span className="truncate">{label}</span>
          {note && <InfoMark note={note} className="size-[15px]" />}
        </p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="tnum text-[24px] font-bold leading-none tracking-[-0.025em]">
            {value}
          </span>
          <DeltaText value={delta ?? null} className="text-[12.5px]" />
        </p>
      </div>
    </div>
  )
}

export function OverallReach({
  handles,
  reports,
  window,
  onWindow,
}: {
  handles: TrackedHandle[]
  /** Stored full reports, for the dates the scrape did not carry. */
  reports: Map<string, Report> | null
  /**
   * The window, owned by the dashboard rather than by this card.
   *
   * It used to live here, and the date pill in the page header reported
   * something else entirely: the span of every dated post the desk holds. So
   * the header read "25 Jun 2026 to 27 Aug 2026" and sat there unmoved while
   * the reader pressed Last 7 days and Last 30 days a foot below it, which
   * reads as a filter that does not work. One control, one window, and the
   * header now names the dates that window actually covers.
   */
  window: WindowId
  onWindow: (w: WindowId) => void
}) {
  const setWindow = onWindow

  /**
   * Follower growth measured against the window the reader chose.
   *
   * The prop version is fixed at a week, which is why every figure on this
   * card used to read the same under "Last 7 days" and "Last 30 days". A
   * follower count still cannot be cut to a window — it is a total a platform
   * holds, with no date — but the CHANGE in it can be measured from further
   * back, and that is what the window now moves.
   */
  const windowDays = daysOf(window) ?? 180
  const growth = useMemo(() => growthSummary(handles, windowDays), [handles, windowDays])

  // Counted back from now. Post-anchoring kept a batch-read desk from ever
  // showing an empty week, but it also made "Last 7 days" mean a week that
  // ended whenever the collector last ran, and the office read that as a
  // broken filter. An empty week now says so, and Last 6 months is the way
  // to widen out of it.
  const anchor = presentAnchor()
  const start = windowStart(anchor, window)
  /**
   * The cards, cut to the window like everything else on this card.
   *
   * These used to be read whole, ignoring the picker, because windowing them
   * blanked YouTube: the collector stores a channel's ALL-TIME popular videos
   * rather than its recent ones, so almost none of them fall inside a week.
   * But showing lifetime view counts underneath a control that says "Last 7
   * days" is a mislabel, and the reader had no way to tell which figures the
   * picker moved and which it did not — it moved two of them.
   *
   * So they are windowed, and a platform with no posts inside the window says
   * so on the figure itself. An absence the reader can see the reason for is
   * worth more than a number that quietly answers a different question.
   */
  const rows = useMemo(() => rowsFor(handles, start, reports), [handles, start, reports])

  /** The follower counts, which have no date and so cannot be windowed. */
  const lifetime = useMemo(() => rowsFor(handles, null, reports), [handles, reports])
  /** The totals strip: the same posts cut to the chosen window. */
  const windowed = useMemo(() => rowsFor(handles, start, reports), [handles, start, reports])

  /**
   * The window immediately before this one, so the strip can say what changed.
   *
   * The reference puts a change against every figure. A change needs a
   * baseline, and the only honest one we hold is the same span of days
   * directly before: same accounts, same arithmetic, one window back. Where
   * that window has no posts there is no comparison to draw, and the tile
   * says so rather than showing a rise from nothing.
   */
  const previous = useMemo(() => {
    if (start === null || anchor === null) return null
    const span = Date.parse(anchor) - Date.parse(start)
    if (!Number.isFinite(span) || span <= 0) return null
    const prevStart = new Date(Date.parse(start) - span).toISOString()
    return rowsFor(handles, prevStart, reports, start)
  }, [handles, start, anchor, reports])

  /**
   * A percentage change, or null when the comparison would be noise.
   *
   * A rise measured off a near-empty week is arithmetic, not a finding: three
   * posts last week against thirty-six this week produced "5,400%", which
   * tells an office nothing except that the two windows are not comparable.
   * The baseline has to carry enough posts to mean something, and where it
   * does not the tile shows the figure without a change rather than a number
   * that would be quoted back as growth.
   */
  const changeOf = (
    now: number | null,
    before: number | null,
    beforePosts: number,
    nowPosts: number,
  ): number | null => {
    if (now == null || before == null || before === 0) return null
    // Comparable coverage, not just a non-zero baseline. Three posts one week
    // against thirty-six the next is arithmetically a 5,400% rise and tells an
    // office nothing except that the two windows are not alike. Half the posts
    // is the floor for calling them comparable.
    if (beforePosts < 3 || beforePosts * 2 < nowPosts) return null
    return Math.round(((now - before) / before) * 1000) / 10
  }

  // Windowed rows can legitimately be empty (a quiet week); the card still
  // has followers to show. It disappears only when the desk has no accounts.
  if (lifetime.length === 0) return null

  const deltaFor = (
    platform: string,
  ): { pct: number | null; delta: number; since: string | null } | null => {
    const row = growth.byPlatform.find((g) => g.platform === platform)
    return row
      ? {
          pct: row.pct != null ? Math.round(row.pct * 10) / 10 : null,
          delta: row.delta,
          since: row.since,
        }
      : null
  }

  const sumOf = (set: PlatRow[], pick: (r: PlatRow) => number | null): number | null => {
    const vals = set.map(pick).filter((v): v is number => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null
  }
  const followers = sumOf(lifetime, (r) => r.followers)
  const reactions = sumOf(windowed, (r) => r.reactions)
  const newFollowers = growth.totalDelta
  const posts = windowed.reduce((a, r) => a + r.posts, 0)
  const postsWithReactions = windowed.reduce((a, r) => a + r.postsWithReactions, 0)

  /** How many accounts this desk actually counts as its own. */
  const counted = handles.length

  const views = sumOf(windowed, (r) => r.views)

  /**
   * WHY A WIDER WINDOW BARELY MOVES ANY OF THIS.
   *
   * The office read 3L in Last 7 days, saw Last 30 days and Last 6 months add
   * almost nothing, and asked whether the desk was really claiming a week did
   * all of it. Checked against the stored dates, it was: 57 of the 75 dated
   * posts fall inside that week, 24 of them on 31 August alone, around the
   * central minister's visit. The figures were right and the card said nothing,
   * which is what made them look wrong.
   *
   * So the band states the density it actually found. It is a count of stored
   * posts, not a claim about the office's habits, and it appears only where the
   * week really does hold most of the window.
   */
  const burstNote = ((): string => {
    if (window === 'week' || posts === 0) return ''
    const recent = windowed.reduce((a, r) => a + r.postsInLastWeek, 0)
    /* Three in five is enough for the sentence to be worth printing: at six
       months this desk is 51 of 75, and that is exactly the window where the
       office asked why widening changed so little. */
    if (recent / posts < 0.6) return ''
    return ` ${recent} of these ${posts} posts went up in the last week, so a wider window adds little.`
  })()

  /**
   * The owner's composite: views plus reactions.
   *
   * Neither half is an impression in the platforms' sense. An impression is a
   * time a post was shown, and none of them disclose that outside their own
   * analytics login. This is the owner's definition of the figure, so the
   * arithmetic follows it, and the tile is named for the arithmetic rather
   * than for the word: see the label below for what went wrong when it was
   * not.
   *
   * Null-safe on purpose: a platform that published views but no reactions
   * must contribute its views rather than dragging the whole total to NA, and
   * a window where NEITHER was published stays NA rather than printing 0.
   * "Nothing was published" and "nobody looked" are different claims.
   */
  const viewsPlusReactions =
    views == null && reactions == null ? null : (views ?? 0) + (reactions ?? 0)

  /** The oldest baseline any platform's delta is measured from. */
  const since = growth.byPlatform.reduce<string | null>(
    (old, g) => (g.since && (old === null || g.since < old) ? g.since : old),
    null,
  )
  const prevPosts = previous ? previous.reduce((a, r) => a + r.posts, 0) : 0

  /**
   * Five totals, as the reference's band has five.
   *
   * THE REFERENCE'S FIVE ARE NOT ALL MEASURABLE. It shows Total Reach, Total
   * Impressions, Engagements, Profile Visits and New Followers. Impressions
   * and profile visits are analytics a platform shows only to whoever is
   * signed in as the account, and reach - distinct accounts that saw a post -
   * is not published either. Three of those slots could only ever be filled by
   * inventing them.
   *
   * So the band keeps the reference's five slots and fills every one with a
   * figure the desk actually holds, named for what it is: followers rather
   * than reach, views plus reactions rather than impressions, and posts
   * published rather than profile visits. The layout is the reference's; the
   * words are the data's.
   */
  const totals: { icon: ReactNode; label: string; value: ReactNode; delta?: number | null; note?: string }[] = [
    {
      icon: <Users size={18} aria-hidden />,
      label: 'Total followers',
      value:
        followers == null ? (
          <NoData reason="No account has a follower reading yet." />
        ) : (
          compact(followers)
        ),
      delta: growth.totalPct != null ? Math.round(growth.totalPct * 10) / 10 : null,
      /**
       * Say HOW MANY accounts, not just "every account". This tile once read
       * 1.6 crore on a desk whose four accounts hold 4.6 lakh between them,
       * because a fifth account belonging to a different politician was still
       * flagged as the desk's. "On 4 accounts" is a number a person can
       * disagree with, which is the difference between a figure and a claim.
       */
      note: `Followers across your ${counted} account${counted === 1 ? '' : 's'}, at the latest reading. A total the platforms hold, so the window does not cut it.`,
    },
    {
      icon: <Eye size={18} aria-hidden />,
      /**
       * "TOTAL IMPRESSIONS" USED TO NAME TWO DIFFERENT SUMS ON ONE CARD.
       *
       * This tile carries the owner's composite, views plus reactions. The
       * four platform tiles above it carry the view count alone, under the
       * same three words. D. K. Aruna's desk, Last 6 months: those tiles read
       * NA, NA, 22,281 and 202, adding to 22.5K, and this one read 45.8K.
       * Nothing on the card said they were answers to different questions,
       * and a reader who added the tiles up got a different number under an
       * identical label.
       *
       * The composite stays, because it is the figure the owner asked for.
       * The label becomes its arithmetic, so "Total impressions" now denotes
       * exactly one quantity on this card. The note names both halves and says
       * that the reaction half is the Engagements tile beside it, because
       * those 23,289 likes, comments and shares really are counted twice
       * across the two figures and a reader is entitled to see that.
       */
      /* "Impressions" at the owner's request, matching the four tiles above,
         which already carry the owner's word for the same kind of figure. The
         note keeps saying exactly what was added, so the label is the owner's
         and the arithmetic is still checkable. */
      label: 'Impressions',
      value:
        viewsPlusReactions == null ? (
          <NoData reason="No platform published a view count or a reaction count on the posts in this window." />
        ) : (
          compact(viewsPlusReactions)
        ),
      delta: changeOf(
        viewsPlusReactions,
        previous
          ? (() => {
              const pv = sumOf(previous, (r) => r.views)
              const pr = sumOf(previous, (r) => r.reactions)
              return pv == null && pr == null ? null : (pv ?? 0) + (pr ?? 0)
            })()
          : null,
        prevPosts,
        posts,
      ),
      note: `${
        views != null ? `${compact(views)} views` : 'No view count was published'
      } plus ${
        reactions != null ? `${compact(reactions)} reactions` : 'no reaction count was published'
      }. The reactions are also the Engagements tile beside this, so they sit inside both figures.${burstNote}`,
    },
    {
      icon: <Heart size={18} aria-hidden />,
      label: 'Engagements',
      value:
        reactions == null ? (
          <NoData reason="No platform published reaction counts on the posts in this window." />
        ) : (
          compact(reactions)
        ),
      delta: changeOf(
        reactions,
        previous ? sumOf(previous, (r) => r.reactions) : null,
        prevPosts,
        posts,
      ),
      note:
        reactions == null
          ? undefined
          : postsWithReactions === posts
            ? `Likes, comments and shares across all ${posts} posts in this window.`
            : `Likes, comments and shares on ${postsWithReactions} of the ${posts} posts here — the rest published no figure.`,
    },
    {
      icon: <FileText size={18} aria-hidden />,
      label: 'Posts published',
      /**
       * NOT IMPRESSIONS, AND HERE IS WHY.
       *
       * This slot briefly carried an impressions figure taken from each
       * reading's `reach.estimatedImpressions`. Checked against the stored
       * reports, that field equals the post's VIEW COUNT exactly — on all 52
       * posts that carry both. The model is not estimating impressions; it is
       * echoing back the number it was handed. Printing it beside Views gave
       * the same measurement two names and two tiles, which the office spotted
       * immediately: "impression and views both are showing same numbers".
       *
       * Nothing this desk holds measures impressions, so the slot carries a
       * figure that is genuinely its own instead.
       */
      value: posts > 0 ? compact(posts) : <NoData reason="No post falls inside this window." />,
      delta: changeOf(posts || null, prevPosts || null, prevPosts, posts),
      note: `Posts published in this window across your ${counted} account${counted === 1 ? '' : 's'}.`,
    },
    {
      icon: <UserPlus size={18} aria-hidden />,
      label: 'New followers',
      value:
        newFollowers == null ? (
          <NoData reason="A change needs two follower readings; the desk holds one." />
        ) : (
          `${newFollowers > 0 ? '+' : ''}${compact(newFollowers)}`
        ),
      /**
       * Name the day, not "the previous reading".
       *
       * The office asked what "the previous reading" meant, and fairly: it is
       * the oldest follower reading this desk holds that is near the window
       * they picked. Where the desk's history is shorter than the window, the
       * seven and thirty day figures are the same number, and saying which day
       * both are measured from is the only way that reads as a fact rather
       * than as a broken filter.
       */
      note:
        newFollowers == null
          ? undefined
          : since
            ? `Followers gained since ${absoluteDate(since)}, the oldest reading held within this window.`
            : 'Change since the previous reading of these accounts.',
    },
  ]

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[19px] font-bold tracking-[-0.018em]">Overall reach</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">Across all platforms</p>
        </div>
        <WindowPicker value={window} onChange={setWindow} options={['week', 'month', 'half']} />
      </div>

      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(var(--cols),minmax(0,1fr))]"
        style={{ '--cols': Math.min(lifetime.length, 5) } as CSSProperties}
      >
        {/* One tile per ACCOUNT, always. Iterating the windowed rows instead
            would make a platform's tile vanish in a week it did not post,
            which reads as "this account is gone" rather than "it was quiet".
            The tile is the account; only its windowed figures move. */}
        {lifetime.map((base) => {
          const w = rows.find((r) => r.platform === base.platform)
          return (
          <PlatformCard
            key={base.platform}
            row={{
              // Views, engagement and post counts come from the window...
              ...(w ?? {
                ...base,
                views: null,
                reactions: null,
                posts: 0,
                postsWithReactions: 0,
                postsWithViews: 0,
        uncountedVideo: 0,
                comments: 0,
                postsWithComments: 0,
                postsRead: 0,
              }),
              // ...and the follower count does not: it is a total the platform
              // holds with no date on it, so cutting it to a window would be
              // arithmetic on a number that has none.
              followers: base.followers,
            }}
            delta={deltaFor(base.platform)}
            windowText="vs an earlier reading of this account"
            windowId={window}
          />
          )
        })}
      </div>

      {/* The band, split by hairlines as the reference splits it: a rule above
          it, and one between each pair of slots. */}
      <div className="mt-4 grid grid-cols-1 border-t border-[var(--rule)] pt-2 sm:grid-cols-2 lg:grid-cols-5">
        {totals.map((t, i) => (
          <div
            key={t.label}
            className={cn(
              i > 0 && 'sm:border-l sm:border-[var(--rule)]',
              // The two-column fall-back would otherwise leave a rule hanging
              // on the first cell of each row.
              i % 2 === 0 && 'sm:border-l-0 lg:border-l',
              i === 0 && 'lg:border-l-0',
            )}
          >
            <TotalTile {...t} />
          </div>
        ))}
      </div>
    </Card>
  )
}
