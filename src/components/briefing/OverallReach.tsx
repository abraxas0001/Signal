import { useMemo, useState } from 'react'
import { Eye, Heart, MessageSquare, Target, UserPlus } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { Card } from '../ui'
import { DeltaChip, PlatformBadge } from '@/components/kit'
import type { Report } from '@shared/types'
import type { GrowthSummary } from '@/lib/growth'
import type { TrackedHandle } from '@/lib/handles'
import { inWindow, newestPostDate, windowLabel, windowStart, type WindowId } from '@/lib/window'
import { NoData, WindowPicker, noReactionsReason, noViewsReason } from './controls'
import { cn, compact, full } from '@/lib/utils'

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
  /** Lifetime posts off the profile header, where the platform states one. */
  postsTotal: number | null
}

function rowsFor(
  handles: TrackedHandle[],
  start: string | null,
  reports: Map<string, Report> | null,
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
      row.posts += 1
      if (p.views != null) row.views = (row.views ?? 0) + p.views
      const reactions =
        p.likes != null || p.comments != null || p.shares != null
          ? (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0)
          : null
      if (reactions != null) row.reactions = (row.reactions ?? 0) + reactions
    }
    byPlatform.set(h.platform, row)
  }
  return [...byPlatform.values()].sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1))
}

/** One platform column: followers, the change, then views and reactions. */
function PlatformCard({
  row,
  delta,
}: {
  row: PlatRow
  delta: { pct: number | null; delta: number } | null
}) {
  /* Only figures this platform actually published, in the order an office
     reads them. Never more than two: the card is a glance, not a table. */
  const slots: { label: string; value: number; why: string }[] = []
  if (row.views != null) {
    slots.push({ label: 'Views', value: row.views, why: 'Views on the posts in the latest reading' })
  }
  if (row.reactions != null) {
    slots.push({
      label: 'Reactions',
      value: row.reactions,
      why: 'Likes plus comments plus shares on the posts in the latest reading',
    })
  }
  if (slots.length < 2 && row.postsTotal != null) {
    slots.push({
      label: row.platform === 'YouTube' ? 'Videos' : 'Posts',
      value: row.postsTotal,
      why: 'Lifetime total, as the profile header states it',
    })
  }

  const missing =
    row.views == null && row.reactions == null
      ? `${noViewsReason(row.platform)} ${noReactionsReason(row.platform)}`
      : row.views == null
        ? noViewsReason(row.platform)
        : row.reactions == null
          ? noReactionsReason(row.platform)
          : null

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--rule)] bg-[var(--surface)] p-3.5 sm:p-4">
      <p className="flex items-center gap-2 text-[13px] font-semibold">
        <PlatformBadge platform={row.platform} size={22} />
        <span className="truncate">{row.platform}</span>
      </p>

      <p className="tnum mt-2.5 text-[26px] font-bold leading-none tracking-[-0.025em]">
        {row.followers == null ? (
          <NoData reason="Followers were never read on this platform." />
        ) : (
          compact(row.followers)
        )}
      </p>

      {/* Chip on one line, its caption on the next — the reference's own
          stacking, and the reason every card in the row is the same height. */}
      <div className="mt-2">
        <div className="flex min-h-[20px] items-center">
          {delta?.pct != null ? (
            <DeltaChip
              value={delta.pct}
              title={`${delta.delta > 0 ? '+' : ''}${full(delta.delta)} followers`}
            />
          ) : null}
        </div>
        <p className="mt-1 truncate text-[11px] text-ink-3">
          {delta?.pct != null
            ? 'vs the previous reading'
            : row.followers == null
              ? 'Not read yet'
              : 'One reading so far'}
        </p>
      </div>

      <div
        className={cn(
          'mt-3 grid gap-2 border-t border-[var(--rule)] pt-2.5',
          slots.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
        )}
      >
        {slots.map((slot) => (
          <div key={slot.label} className="min-w-0">
            <p
              className="cursor-help text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3"
              title={slot.why}
            >
              {slot.label}
            </p>
            <p className="tnum mt-0.5 truncate text-[15px] font-bold">{compact(slot.value)}</p>
          </div>
        ))}
      </div>

      {/* Said once, quietly, instead of a column of NA: what this platform
          does not publish to a reader who is not signed in as the account. */}
      {missing && <p className="mt-2 text-[10.5px] leading-snug text-ink-3">{missing}</p>}
    </div>
  )
}

/** Each total wears its own hue, as the reference's icon row does — five
    identical blue badges read as wallpaper, five hues read as five facts. */
const TILE_TINTS: Record<string, { bg: string; fg: string }> = {
  'Total reach': { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  'Total views': { bg: 'var(--accent-2-soft)', fg: 'var(--accent-2)' },
  Engagements: { bg: 'color-mix(in oklab, var(--chart-5) 14%, transparent)', fg: 'var(--chart-5)' },
  'Comments read': { bg: 'color-mix(in oklab, var(--chart-3) 14%, transparent)', fg: 'var(--chart-3)' },
  'New followers': { bg: 'var(--pos-soft)', fg: 'var(--pos)' },
}

/** One tile of the totals strip: icon, label, figure, change. */
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
  const tint = TILE_TINTS[label] ?? { bg: 'var(--accent-soft)', fg: 'var(--accent)' }
  return (
    <div className="flex items-center gap-3 px-1 py-2">
      <span className="icon-badge shrink-0" style={{ background: tint.bg, color: tint.fg }}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-ink-3">{label}</p>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="tnum text-[20px] font-bold leading-none tracking-[-0.02em]">{value}</span>
          {delta != null && <DeltaChip value={delta} />}
        </p>
        {note && <p className="mt-0.5 truncate text-[10.5px] text-ink-3">{note}</p>}
      </div>
    </div>
  )
}

export function OverallReach({
  handles,
  growth,
  commentsRead,
  reports,
}: {
  handles: TrackedHandle[]
  growth: GrowthSummary
  /** Comments actually read across the desk's accounts. */
  commentsRead: number
  /** Stored full reports, for the dates the scrape did not carry. */
  reports: Map<string, Report> | null
}) {
  const [window, setWindow] = useState<WindowId>('week')

  const anchor = useMemo(
    () =>
      newestPostDate(handles.flatMap((h) => (h.snapshots.at(-1)?.posts ?? []).map((p) => p.publishedAt))),
    [handles],
  )
  const start = windowStart(anchor, window)
  /** The cards: the latest reading, whole. */
  const rows = useMemo(() => rowsFor(handles, null, reports), [handles, reports])
  /** The totals strip: the same posts cut to the chosen window. */
  const windowed = useMemo(() => rowsFor(handles, start, reports), [handles, start, reports])

  if (rows.length === 0) return null

  const deltaFor = (platform: string): { pct: number | null; delta: number } | null => {
    const row = growth.byPlatform.find((g) => g.platform === platform)
    return row
      ? { pct: row.pct != null ? Math.round(row.pct * 10) / 10 : null, delta: row.delta }
      : null
  }

  const sumOf = (set: PlatRow[], pick: (r: PlatRow) => number | null): number | null => {
    const vals = set.map(pick).filter((v): v is number => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null
  }
  const sum = (pick: (r: PlatRow) => number | null): number | null => sumOf(rows, pick)
  const followers = sum((r) => r.followers)
  const views = sumOf(windowed, (r) => r.views)
  const reactions = sumOf(windowed, (r) => r.reactions)
  const newFollowers = growth.totalDelta
  const posts = windowed.reduce((a, r) => a + r.posts, 0)

  /** How many accounts this desk actually counts as its own. */
  const counted = handles.length

  const totals: { icon: ReactNode; label: string; value: ReactNode; delta?: number | null; note?: string }[] = [
    {
      icon: <Target size={17} aria-hidden />,
      label: 'Total reach',
      value: followers == null ? <NoData reason="No account has a follower reading yet." /> : compact(followers),
      delta: growth.totalPct != null ? Math.round(growth.totalPct * 10) / 10 : null,
      /**
       * Say HOW MANY accounts, not just "every account".
       *
       * This tile once read 1.6 crore on a desk whose four accounts hold 4.6
       * lakh between them, because a fifth account belonging to a different
       * politician was still flagged as the desk's. "Followers on every
       * account" gave the reader nothing to check that against; "on 4
       * accounts" on a desk that has four is a number a person can disagree
       * with, which is the whole difference between a figure and a claim.
       */
      note: `followers on ${counted} account${counted === 1 ? '' : 's'}`,
    },
    {
      icon: <Eye size={17} aria-hidden />,
      label: 'Total views',
      value:
        views == null ? (
          <NoData reason="No platform published view counts on the posts in this window." />
        ) : (
          compact(views)
        ),
      note: views == null ? undefined : `on ${posts} posts in this window`,
    },
    {
      icon: <Heart size={17} aria-hidden />,
      label: 'Engagements',
      value:
        reactions == null ? (
          <NoData reason="No platform published reaction counts on the posts in this window." />
        ) : (
          compact(reactions)
        ),
      note: reactions == null ? undefined : `on ${posts} posts in this window`,
    },
    {
      icon: <MessageSquare size={17} aria-hidden />,
      label: 'Comments read',
      value:
        commentsRead > 0 ? (
          compact(commentsRead)
        ) : (
          <NoData reason="No comments have been read on your accounts yet." />
        ),
      note: commentsRead > 0 ? 'under your own posts' : undefined,
    },
    {
      icon: <UserPlus size={17} aria-hidden />,
      label: 'New followers',
      value:
        newFollowers == null ? (
          <NoData reason="A change needs two follower readings; the desk holds one." />
        ) : (
          `${newFollowers > 0 ? '+' : ''}${compact(newFollowers)}`
        ),
      note: newFollowers == null ? undefined : 'since the previous reading',
    },
  ]

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-[-0.015em]">Overall reach</h2>
          <p className="mt-0.5 text-xs text-ink-3">Across all platforms · {windowLabel(anchor, window)}</p>
        </div>
        <WindowPicker value={window} onChange={setWindow} options={['week', 'month']} />
      </div>

      <div
        className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-[repeat(var(--cols),minmax(0,1fr))]"
        style={{ '--cols': Math.min(rows.length, 5) } as CSSProperties}
      >
        {rows.map((r) => (
          <PlatformCard key={r.platform} row={r} delta={deltaFor(r.platform)} />
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-x-3 gap-y-1 border-t border-[var(--rule)] pt-2.5 sm:grid-cols-2 lg:grid-cols-5">
        {totals.map((t) => (
          <TotalTile key={t.label} {...t} />
        ))}
      </div>
    </Card>
  )
}
