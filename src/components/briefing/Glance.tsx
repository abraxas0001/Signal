import { useMemo } from 'react'
import { Heart, TrendingUp, UserPlus, Users } from 'lucide-react'
import { Card } from '../ui'
import {
  CardHead,
  DeltaChip,
  LineChart,
  PlatformBadge,
  seriesColor,
  type LineSeries,
} from '@/components/kit'
import type { PlatformReach } from '@/lib/briefing'
import type { GrowthSummary } from '@/lib/growth'
import type { TrackedHandle } from '@/lib/handles'
import { compact, full } from '@/lib/utils'

/**
 * The two purely numeric cards of the desk at a glance: reach per platform and
 * follower growth against last week. Both are arithmetic over the stored
 * snapshots — nothing here estimates, and every dash is a platform that was
 * genuinely never read rather than one that read zero.
 */

const dayOf = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })

/**
 * One line of engagement per platform, phrased by what was actually published.
 *
 * "on the last 25", not "· 25 posts": the bare count read as a claim that the
 * account HAS 25 posts, on a desk whose owner has six thousand. The lifetime
 * figure has its own line above; this line owns the recent window.
 */
function engagementLine(r: PlatformReach): string {
  const recent = r.posts === 1 ? 'the last post' : `the last ${r.posts}`
  if (r.reactions != null) {
    const views = r.views != null ? ` · ${compact(r.views)} views` : ''
    return `${compact(r.reactions)} reactions${views} on ${recent}`
  }
  if (r.views != null) {
    return `${compact(r.views)} views on ${recent}`
  }
  if (r.posts > 0) return `No engagement published on ${recent}`
  return 'No posts stored.'
}

export function PlatformReachRow({
  reach,
  own,
  growth,
}: {
  reach: PlatformReach[]
  own: boolean
  /**
   * The same summary the growth card reads, so each platform card can wear
   * its change-since-last-reading chip. Optional, and a platform without a
   * measured baseline simply wears no chip — a delta needs two readings to
   * exist and is never invented from one.
   */
  growth?: GrowthSummary
}) {
  if (reach.length === 0) return null

  const deltaFor = (platform: string): { pct: number | null; delta: number } | null => {
    const row = growth?.byPlatform.find((g) => g.platform === platform)
    return row ? { pct: row.pct != null ? Math.round(row.pct * 10) / 10 : null, delta: row.delta } : null
  }

  /* The strip under the cards: the desk's totals, added up from the same
     readings the cards show. Only figures the platforms actually publish —
     impressions and profile visits exist on no public profile and therefore
     not here. */
  const followerCounts = reach.map((r) => r.followers).filter((v): v is number => v != null)
  const totalFollowers = followerCounts.length ? followerCounts.reduce((a, b) => a + b, 0) : null
  const reactionCounts = reach.map((r) => r.reactions).filter((v): v is number => v != null)
  const totalReactions = reactionCounts.length ? reactionCounts.reduce((a, b) => a + b, 0) : null
  const recentPosts = reach.reduce((a, r) => a + r.posts, 0)
  const newFollowers = growth?.totalDelta ?? null

  const totals: { icon: typeof Users; label: string; value: string; note?: string }[] = [
    ...(totalFollowers != null
      ? [{ icon: Users, label: 'Total reach', value: compact(totalFollowers), note: 'followers across platforms' }]
      : []),
    ...(totalReactions != null
      ? [
          {
            icon: Heart,
            label: 'Engagement',
            value: compact(totalReactions),
            note: `reactions on the last ${recentPosts} posts`,
          },
        ]
      : []),
    ...(newFollowers != null && newFollowers !== 0
      ? [
          {
            icon: UserPlus,
            label: 'New followers',
            value: `${newFollowers > 0 ? '+' : ''}${compact(newFollowers)}`,
            note: 'since the previous reading',
          },
        ]
      : []),
  ]

  return (
    <Card className="p-4 sm:p-6">
      <CardHead
        icon={<Users size={16} aria-hidden />}
        tint="violet"
        title="Reach on each platform"
        sub={own ? 'Your accounts, latest reading' : 'All tracked accounts, latest reading'}
      />
      {/* Two across on a phone, not one.
          Stacked full-height, four platforms cost about 1,200px of scrolling
          to deliver four numbers, and the reader had to remember the first one
          by the time they reached the fourth. Comparing reach is the whole
          point of this card, and a comparison you have to scroll through is
          not one. Two columns put all four in a glance; the engagement line
          moves under the pair boundary on a phone, where a full sentence per
          cell would not fit at two columns. */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {reach.map((r) => {
          const d = deltaFor(r.platform)
          return (
            <div
              key={r.platform}
              className="rounded-[var(--radius-md)] border border-[var(--rule)] bg-[var(--surface-2)] p-3 sm:p-3.5"
            >
              <p className="flex items-center gap-1.5 text-[13px] font-semibold sm:gap-2">
                <PlatformBadge platform={r.platform} size={18} className="sm:size-5" />
                <span className="truncate">{r.platform}</span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 sm:mt-2.5">
                <p className="tnum text-[20px] font-bold leading-none tracking-[-0.02em] sm:text-[22px]">
                  {r.followers == null ? '—' : compact(r.followers)}
                </p>
                {d && d.pct != null && (
                  <DeltaChip
                    value={d.pct}
                    title={`${d.delta > 0 ? '+' : ''}${full(d.delta)} followers since the previous reading`}
                  />
                )}
              </div>
              <p className="mt-1 text-[11px] text-ink-3">
                {r.followers == null ? 'Followers were never read' : 'followers'}
              </p>
              {/* The account's real size, off its own profile header. Only where
                  the platform publishes one — Facebook does not, and a stored-post
                  count dressed as a lifetime total is the misreading this line
                  exists to end. */}
              {r.postsTotal != null && (
                <p className="tnum mt-1.5 text-[12px] font-semibold text-ink-2">
                  {compact(r.postsTotal)} {r.platform === 'YouTube' ? 'videos' : 'posts'}
                </p>
              )}
              <p className="mt-2 border-t border-[var(--rule)] pt-2 text-[11px] leading-snug text-ink-3 sm:mt-2.5 sm:leading-relaxed">
                {engagementLine(r)}
              </p>
            </div>
          )
        })}
      </div>

      {totals.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2.5 border-t border-[var(--rule)] pt-3 sm:grid-cols-3 sm:gap-3">
          {totals.map(({ icon: Icon, label, value, note }) => (
            <div key={label} className="flex items-center gap-3">
              <span
                className="icon-badge icon-badge-sm shrink-0"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Icon size={15} strokeWidth={2.2} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="flex items-baseline gap-1.5">
                  <span className="tnum text-[17px] font-bold leading-none">{value}</span>
                  <span className="text-[12px] font-medium text-ink-3">{label}</span>
                </p>
                {note && <p className="mt-0.5 truncate text-[11px] text-ink-3">{note}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/* ── the follower history, drawn ─────────────────────────────────────────── */

/** Fixed platform order, so each platform keeps its chart colour for life. */
const PLATFORM_ORDER = ['Facebook', 'Instagram', 'Twitter/X', 'LinkedIn', 'YouTube'] as const

/**
 * Per-platform follower series over the distinct days readings were taken.
 *
 * Sums each platform's OWN dated readings by day; a day a platform was not
 * read is a null, which the chart leaves as a gap rather than interpolating
 * a number nobody measured. Worth drawing only when at least one platform
 * holds two dated readings — a chart of single points is a scatter of dots
 * pretending to be a trend.
 */
function historySeriesOf(handles: TrackedHandle[]): { labels: string[]; series: LineSeries[] } | null {
  const dayKey = (iso: string): string => iso.slice(0, 10)
  const days = new Set<string>()
  for (const h of handles) {
    for (const s of h.snapshots) if (s.followers != null && s.takenAt) days.add(dayKey(s.takenAt))
  }
  const sorted = [...days].sort()
  if (sorted.length < 2) return null

  const platforms = PLATFORM_ORDER.filter((p) => handles.some((h) => h.platform === p))
  const series: LineSeries[] = platforms.map((platform) => {
    const values = sorted.map((day) => {
      let sum = 0
      let read = false
      for (const h of handles) {
        if (h.platform !== platform) continue
        // The last reading that day, per handle.
        const onDay = h.snapshots.filter((s) => s.followers != null && dayKey(s.takenAt) === day).at(-1)
        if (onDay?.followers != null) {
          sum += onDay.followers
          read = true
        }
      }
      return read ? sum : null
    })
    return { name: platform, color: seriesColor(PLATFORM_ORDER.indexOf(platform)), values }
  })

  const drawable = series.filter((s) => s.values.filter((v) => v != null).length >= 2)
  if (drawable.length === 0) return null

  const labels = sorted.map((d) =>
    new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
  )
  return { labels, series: drawable }
}

/**
 * Growth against last week, and only when two readings actually exist.
 *
 * The rule this card exists to keep: never render a 0% from a single reading.
 * A desk measured once gets the sentence saying so and the date of that one
 * reading — a claim about the data, not about the desk.
 */
export function GrowthCard({
  growth,
  handles,
}: {
  growth: GrowthSummary
  /**
   * The same handles the summary was computed from, for the history chart.
   * A follower line chart left this dashboard once as decoration over too
   * little data; it returns here on the owner's revamp, gated hard — it
   * draws only from days that were genuinely read, or not at all.
   */
  handles?: TrackedHandle[]
}) {
  const history = useMemo(() => (handles ? historySeriesOf(handles) : null), [handles])

  if (growth.measured.length === 0 && growth.single.length === 0) return null

  if (growth.measured.length === 0) {
    const newest = growth.single
      .map((g) => g.latest?.takenAt)
      .filter((t): t is string => Boolean(t))
      .sort()
      .pop()
    return (
      <Card className="p-4 sm:p-6">
        <CardHead
          icon={<TrendingUp size={16} aria-hidden />}
          tint="blue"
          title="Growth against last week"
        />
        <p className="text-sm leading-relaxed text-ink-2">
          {growth.single.length === 1
            ? `One reading so far${newest ? `, taken ${dayOf(newest)}` : ''}.`
            : `One reading per account so far${newest ? `, the latest taken ${dayOf(newest)}` : ''}.`}
        </p>
      </Card>
    )
  }

  const delta = growth.totalDelta ?? 0

  /**
   * Zero everywhere is a real measurement, so it gets a sentence, not a
   * scoreboard. Two readings taken close together often hold identical
   * counts, and rendering that as "0 followers 0%" over four rows of
   * "0 · 0%" reads as a dead card rather than as the quiet truth.
   */
  if (delta === 0 && growth.measured.every((g) => (g.delta ?? 0) === 0)) {
    const since = growth.measured
      .map((g) => g.baseline?.takenAt)
      .filter((t): t is string => Boolean(t))
      .sort()
      .pop()
    return (
      <Card className="p-4 sm:p-6">
        <CardHead
          icon={<TrendingUp size={16} aria-hidden />}
          tint="blue"
          title="Follower growth"
        />
        <p className="text-sm leading-relaxed text-ink-2">
          No movement on any account{since ? ` since the ${dayOf(since)} reading` : ' between the last two readings'}.
        </p>
      </Card>
    )
  }

  /**
   * The card says what it actually compares. With week-old baselines it is
   * growth against last week; with yesterday's readings it says "since
   * yesterday" — a one-day delta wearing a weekly headline is a lie of scale
   * in the other direction.
   */
  const gapDays = (() => {
    const gaps = growth.measured
      .map((g) =>
        g.baseline && g.latest
          ? (Date.parse(g.latest.takenAt) - Date.parse(g.baseline.takenAt)) / 86_400_000
          : null,
      )
      .filter((n): n is number => n !== null)
    return gaps.length > 0 ? Math.max(...gaps) : null
  })()
  // The sub names the baseline's exact date; the title only claims "last
  // week" when the baseline actually is one.
  const title = gapDays !== null && gapDays >= 6 ? 'Growth against last week' : 'Follower growth'
  const baselineDay = growth.measured
    .map((g) => g.baseline?.takenAt)
    .filter((t): t is string => Boolean(t))
    .sort()
    .pop()

  return (
    <Card className="p-4 sm:p-6">
      <CardHead
        icon={<TrendingUp size={16} aria-hidden />}
        tint="blue"
        title={title}
        sub={baselineDay ? `Since ${dayOf(baselineDay)}` : 'Against the previous reading'}
      />

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="tnum text-[26px] font-bold leading-none tracking-[-0.02em]">
          {delta > 0 ? '+' : ''}
          {full(delta)}
        </p>
        <span className="text-sm text-ink-3">followers</span>
        {growth.totalPct != null && <DeltaChip value={Math.round(growth.totalPct * 10) / 10} />}
      </div>

      {/* The history, drawn, when there is a history to draw. Each platform
          keeps one fixed chart colour; a day a platform went unread is a gap
          in its line, never an interpolated point. The chart brings its own
          legend — a second one here doubled it. */}
      {history && (
        <div className="mt-4">
          <LineChart labels={history.labels} series={history.series} height={200} />
        </div>
      )}

      {growth.byPlatform.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-[var(--rule)] pt-3.5">
          {growth.byPlatform.map((row) => (
            <li key={row.platform} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-sm text-ink-2">
                <PlatformBadge platform={row.platform} size={18} />
                <span className="truncate">{row.platform}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tnum text-sm font-semibold">
                  {row.delta > 0 ? '+' : ''}
                  {full(row.delta)}
                </span>
                {row.pct != null && <DeltaChip value={Math.round(row.pct * 10) / 10} />}
              </span>
            </li>
          ))}
        </ul>
      )}

    </Card>
  )
}
