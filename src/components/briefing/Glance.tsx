import { TrendingUp, Users } from 'lucide-react'
import { Card } from '../ui'
import { CardHead, DeltaChip, PlatformBadge } from '@/components/kit'
import type { PlatformReach } from '@/lib/briefing'
import type { GrowthSummary } from '@/lib/growth'
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

export function PlatformReachRow({ reach, own }: { reach: PlatformReach[]; own: boolean }) {
  if (reach.length === 0) return null
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
        {reach.map((r) => (
          <div
            key={r.platform}
            className="rounded-[var(--radius-md)] border border-[var(--rule)] bg-[var(--surface-2)] p-3 sm:p-3.5"
          >
            <p className="flex items-center gap-1.5 text-[13px] font-semibold sm:gap-2">
              <PlatformBadge platform={r.platform} size={18} className="sm:size-5" />
              <span className="truncate">{r.platform}</span>
            </p>
            <p className="tnum mt-2 text-[20px] font-bold leading-none tracking-[-0.02em] sm:mt-2.5 sm:text-[22px]">
              {r.followers == null ? 'NA' : compact(r.followers)}
            </p>
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
        ))}
      </div>
    </Card>
  )
}

/**
 * Growth against last week, and only when two readings actually exist.
 *
 * The rule this card exists to keep: never render a 0% from a single reading.
 * A desk measured once gets the sentence saying so and the date of that one
 * reading — a claim about the data, not about the desk.
 */
export function GrowthCard({ growth }: { growth: GrowthSummary }) {
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
