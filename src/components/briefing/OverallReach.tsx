import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Eye, FileText, Heart, UserPlus, Users } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { Card } from '../ui'
import { PlatformBadge } from '@/components/kit'
import type { Report } from '@shared/types'
import { growthSummary, type GrowthSummary } from '@/lib/growth'
import type { TrackedHandle } from '@/lib/handles'
import { inWindow, newestPostDate, windowStart, type WindowId } from '@/lib/window'
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
  /** Comments stored on the posts in this window. */
  comments: number
  /** Of the window's posts, how many have any comments stored. */
  postsWithComments: number
  /** Lifetime posts off the profile header, where the platform states one. */
  postsTotal: number | null
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
        comments: 0,
        postsWithComments: 0,
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
      const at = p.publishedAt ?? reports?.get(p.url)?.snapshot.publishedAt ?? null
      if (!inWindow(at, start)) continue
      if (end !== null && at !== null && at >= end) continue
      row.posts += 1
      const stored = reports?.get(p.url)?.snapshot.comments?.length ?? 0
      row.comments += stored
      if (stored > 0) row.postsWithComments += 1
      if (p.views != null) row.views = (row.views ?? 0) + p.views
      const reactions =
        p.likes != null || p.comments != null || p.shares != null
          ? (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0)
          : null
      if (reactions != null) {
        row.reactions = (row.reactions ?? 0) + reactions
        row.postsWithReactions += 1
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
}: {
  row: PlatRow
  delta: { pct: number | null; delta: number; since: string | null } | null
  /**
   * What the change is measured against.
   *
   * NOT the window. The reference prints "vs last 7 days" under this figure,
   * but a follower count is a total a platform holds, not a thing that
   * happened inside a week: the change we can honestly state is between the
   * last two READINGS of the account, whenever those were taken. The window
   * picker above still governs every posted figure on the card.
   */
  windowText: string
}) {
  const slots: { label: string; value: number | null; why: string }[] = [
    {
      label: 'Views',
      value: row.views,
      why:
        row.views == null
          ? noViewsReason(row.platform)
          : 'Views on the posts in this window. Not reach: no platform publishes the number of distinct accounts that saw a post.',
    },
    {
      label: 'Engagement',
      value: row.reactions,
      why:
        row.reactions == null
          ? noReactionsReason(row.platform)
          : 'Likes plus comments plus shares on the posts in this window',
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
            <DeltaText
              value={delta.pct}
              title={`${delta.delta > 0 ? '+' : ''}${full(delta.delta)} followers since the previous reading`}
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

      <div className="mt-3 grid grid-cols-1 gap-2 border-t border-[var(--rule)] pt-3 min-[480px]:grid-cols-2">
        {slots.map((slot) => (
          <div key={slot.label} className="min-w-0">
            <p className="flex items-center gap-0.5 text-[12.5px] text-ink-3">
              <span className="truncate">{slot.label}</span>
              {/* Only where there IS a figure: an absent one renders as NA,
                  which carries the same explanation on its own mark, and two
                  i marks side by side on one row is just clutter. */}
              {slot.value != null && <InfoMark note={slot.why} className="size-[15px]" />}
            </p>
            <p className="tnum mt-1 truncate text-[15px] font-bold">
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
}: {
  handles: TrackedHandle[]
  /** Comments actually read across the desk's accounts. */
  /** Stored full reports, for the dates the scrape did not carry. */
  reports: Map<string, Report> | null
}) {
  const [window, setWindow] = useState<WindowId>('week')

  /**
   * Follower growth measured against the window the reader chose.
   *
   * The prop version is fixed at a week, which is why every figure on this
   * card used to read the same under "Last 7 days" and "Last 30 days". A
   * follower count still cannot be cut to a window — it is a total a platform
   * holds, with no date — but the CHANGE in it can be measured from further
   * back, and that is what the window now moves.
   */
  const windowDays = window === 'month' ? 30 : 7
  const growth = useMemo(() => growthSummary(handles, windowDays), [handles, windowDays])

  const anchor = useMemo(
    () =>
      newestPostDate(handles.flatMap((h) => (h.snapshots.at(-1)?.posts ?? []).map((p) => p.publishedAt))),
    [handles],
  )
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
   * than reach, views rather than impressions, and comments read rather than
   * profile visits. The layout is the reference's; the words are the data's.
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
      note: `Followers across the ${counted} account${counted === 1 ? '' : 's'} this desk counts as its own, at the latest reading. A follower count is a total the platform holds with no date on it, so it is not cut to the window: only its CHANGE is. And not reach either, which is who saw a post rather than who subscribed.`,
    },
    {
      icon: <Eye size={18} aria-hidden />,
      label: 'Views',
      value:
        views == null ? (
          <NoData reason="No platform published a view count on the posts in this window." />
        ) : (
          compact(views)
        ),
      delta: changeOf(views, previous ? sumOf(previous, (r) => r.views) : null, prevPosts, posts),
      note: 'Views the platforms published on the posts in this window. This is the nearest real figure to impressions, which no platform publishes outside its own analytics login.',
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
          : `Likes, comments and shares on ${postsWithReactions} of the ${posts} posts in this window: the rest published no figure at all.`,
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
      note: `Posts published in this window across the ${counted} account${counted === 1 ? '' : 's'} this desk follows. Impressions are not here because no platform publishes them and nothing on this desk measures them.`,
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
            ? `Followers gained since ${absoluteDate(since)}, the oldest reading this desk holds within the chosen window. Where the desk has fewer days of readings than the window covers, both windows measure from the same day.`
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
        <WindowPicker value={window} onChange={setWindow} options={['week', 'month']} />
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
              ...(w ?? { ...base, views: null, reactions: null, posts: 0, postsWithReactions: 0, comments: 0, postsWithComments: 0 }),
              // ...and the follower count does not: it is a total the platform
              // holds with no date on it, so cutting it to a window would be
              // arithmetic on a number that has none.
              followers: base.followers,
            }}
            delta={deltaFor(base.platform)}
            windowText="vs the previous reading"
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
