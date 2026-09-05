import { useId, useMemo, useState } from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import { Card } from '../ui'
import {
  DeltaChip,
  LineChart,
  seriesColor,
  smoothPath,
  type LineSeries,
} from '@/components/kit'
import type { GrowthSummary } from '@/lib/growth'
import { latestFollowersOf } from '@/lib/briefing'
import type { TrackedHandle } from '@/lib/handles'
import { presentAnchor, windowDays as daysOf, windowLabel, windowStart, type WindowId } from '@/lib/window'
import { NoData, WindowPicker } from './controls'
import { cn, compact, full } from '@/lib/utils'

/**
 * "Follower Growth" — section four of the reference design: the per-platform
 * lines with a clickable legend, the figures beside them, the window filter,
 * and the one sentence that says whether this is good.
 *
 * The legend is the platform filter, as the owner asked: press a platform to
 * see only that platform — the axis rescales and the small accounts become
 * readable beside a 2.8L Facebook — and press All (or the same platform
 * again) to see everyone. The window trims the READINGS, and the figures
 * beside the chart are recomputed over exactly the readings the chart shows —
 * the chart and the numbers are never two different claims.
 *
 * THE ALL VIEW IS LANES, NOT ONE PLOT. On one shared axis Instagram's +2,100
 * sets the height and Twitter/X's +100 is a floor-hugger the office reported
 * missing — twice. The axis cannot be bent and the line cannot be nudged (a
 * moved follower count is a figure nobody read), so the composition changes
 * instead: each platform gets a panel at its own scale, where its curve fills
 * the height and its SHAPE becomes legible. The true cross-platform
 * proportion is not lost — the contribution strip above the lanes carries the
 * real split, and each lane prints its absolute figure as the headline.
 *
 * The reference's green callout reads "higher than 78% of other MPs in your
 * state". Nobody has that number — it would need follower histories for
 * every MP in the state — so the callout compares against the accounts this
 * desk actually watches, and says how many that is.
 */

/** Fixed order, so a platform keeps its line colour between visits. */
const PLATFORM_ORDER = ['Facebook', 'Instagram', 'Twitter/X', 'LinkedIn', 'YouTube'] as const

const dayOf = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })

interface History {
  labels: string[]
  series: LineSeries[]
  /** Per platform: followers at the window's first and last readings. */
  span: Map<string, { first: number; last: number }>
  firstDay: string
  lastDay: string
}

/**
 * Per-platform follower series over the days readings were actually taken,
 * within the window. A day a platform was not read is a gap in its line,
 * never an interpolated point.
 */
function historyOf(
  handles: TrackedHandle[],
  start: string | null,
  /** Exclusive upper bound, so a previous window really is previous. */
  end: string | null = null,
): History | null {
  const dayKey = (iso: string): string => iso.slice(0, 10)
  const days = new Set<string>()
  for (const h of handles) {
    for (const s of h.snapshots) {
      if (s.followers == null || !s.takenAt) continue
      if (start && s.takenAt < start) continue
      if (end && s.takenAt >= end) continue
      days.add(dayKey(s.takenAt))
    }
  }
  const sorted = [...days].sort()
  if (sorted.length === 0) return null

  const span = new Map<string, { first: number; last: number }>()
  const platforms = PLATFORM_ORDER.filter((p) => handles.some((h) => h.platform === p))
  const series: LineSeries[] = platforms.map((platform) => {
    const values = sorted.map((day) => {
      let sum = 0
      let read = false
      for (const h of handles) {
        if (h.platform !== platform) continue
        const onDay = h.snapshots
          .filter((s) => s.followers != null && dayKey(s.takenAt) === day)
          .at(-1)
        if (onDay?.followers != null) {
          sum += onDay.followers
          read = true
        }
      }
      return read ? sum : null
    })
    const present = values.filter((v): v is number => v != null)
    // Two readings or none. With one, `first` and `last` were the SAME
    // reading, so the card reported a change of zero for an account nobody
    // had measured twice — indistinguishable from an account that genuinely
    // held flat. This is the gate `drawable` below already applies.
    if (present.length >= 2) span.set(platform, { first: present[0]!, last: present.at(-1)! })
    return { name: platform, color: seriesColor(PLATFORM_ORDER.indexOf(platform)), values }
  })

  const drawable = series.filter((s) => s.values.filter((v) => v != null).length >= 2)
  return {
    labels: sorted.map((d) =>
      new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    ),
    series: drawable,
    span,
    firstDay: sorted[0]!,
    lastDay: sorted.at(-1)!,
  }
}

/**
 * How the desk's own growth compares with the accounts it watches.
 *
 * KEYED BY ACCOUNT, BECAUSE THE SENTENCE UNDERNEATH COUNTS ACCOUNTS. This map
 * was keyed by `h.displayName`, and `demo-roster.ts` writes the PERSON's name
 * onto every handle they own, so a rival's four accounts collapsed into one
 * entry and `Math.max` kept only their fastest-growing one. D. K. Aruna's desk
 * watches 8 accounts and all 8 carry two follower readings, yet the callout
 * read "ahead of all 3 accounts you watch": three was the number of people.
 * Keying by the handle id makes the printed count a count of accounts, which
 * is the word the sentence uses.
 *
 * `watched` comes back untouched alongside it so the callout can say how many
 * accounts were left out for want of a second reading, rather than quietly
 * shrinking its own denominator to the ones it could measure.
 */
function standingAmongWatched(
  ownPct: number | null,
  watched: TrackedHandle[],
): { ahead: number; of: number; watched: number } | null {
  const rivals = new Map<string, number>()
  for (const h of watched) {
    const readings = h.snapshots.filter((s) => s.followers != null)
    if (readings.length < 2) continue
    const last = readings.at(-1)!.followers!
    const prev = readings.at(-2)!.followers!
    if (prev <= 0) continue
    rivals.set(h.id, ((last - prev) / prev) * 100)
  }
  if (rivals.size === 0 || ownPct == null) return null
  const ahead = [...rivals.values()].filter((pct) => ownPct > pct).length
  return { ahead, of: rivals.size, watched: watched.length }
}


export function FollowerGrowth({
  growth,
  ownHandles,
  watchedHandles,
  onOpenAccounts,
}: {
  growth: GrowthSummary
  ownHandles: TrackedHandle[]
  watchedHandles: TrackedHandle[]
  onOpenAccounts: () => void
}) {
  const [window, setWindow] = useState<WindowId>('month')
  /** Null shows every platform; a name shows only that one. */
  const [only, setOnly] = useState<string | null>(null)
  /**
   * Followers, or growth since the window's first reading. The absolute view
   * puts a 2.8L account and a 3.3K account on one axis, which flattens every
   * line into a ruler; the percent view starts every platform at zero and
   * lets each reading's movement show at its own scale. Same readings, same
   * dots — only the yardstick changes.
   */
  const [metric, setMetric] = useState<'followers' | 'percent'>('followers')
  /** The reading index under the pointer, shared by every lane's crosshair. */
  const reduced = useReducedMotion()


  /* Counted back from now, like every other window on the dashboard. A
     window that ended at the newest reading kept the chart full but made the
     picker lie about its own label; a desk that has not been read this week
     now says so instead. */
  const anchor = presentAnchor()
  const start = windowStart(anchor, window)
  const windowDays = daysOf(window) ?? 180

  const history = useMemo(() => historyOf(ownHandles, start), [ownHandles, start])

  /**
   * Where the SELECTED window starts, as an IST day. Compared against the
   * desk's oldest reading to tell the difference between "this is the change
   * over 30 days" and "this is every reading we have, which is fewer".
   */
  const windowFrom = windowStart(anchor, window)

  /**
   * The same span of days directly before this one, so the card can say what
   * changed against it.
   *
   * The office asked for a comparison and the reference sheet puts it here:
   * this period beside the one before, and the rate between them. A change
   * needs two readings inside EACH window, so where the previous window holds
   * fewer than that there is nothing to compare and the cells say so rather
   * than showing a rise measured from a guess.
   */
  const previous = useMemo(() => {
    if (start === null || anchor === null) return null
    const span = Date.parse(anchor) - Date.parse(start)
    if (!Number.isFinite(span) || span <= 0) return null
    const prevStart = new Date(Date.parse(start) - span).toISOString()
    const prior = historyOf(ownHandles, prevStart, start)
    if (!prior) return null
    const spansPrev = [...prior.span.values()]
    if (spansPrev.length === 0) return null
    return spansPrev.reduce((a, x) => a + (x.last - x.first), 0)
  }, [ownHandles, start, anchor])

  /* The figures, over exactly the readings the chart shows. */
  const spans = history ? [...history.span.values()] : []
  const firstTotal = spans.reduce((a, s) => a + s.first, 0)
  const lastTotal = spans.reduce((a, s) => a + s.last, 0)

  /**
   * The follower TOTAL is a level, not a change, so it needs one reading and
   * not two.
   *
   * `lastTotal` above sums only the platforms with two or more readings inside
   * the window, because that is what a CHANGE needs. Using it for the level
   * printed two different lies: on a desk read only once it summed nothing and
   * rendered a measured "0" beside a live chart, and on a desk where one
   * account had been read twice and another once it silently dropped the
   * second account from a figure captioned "across your accounts".
   *
   * This counts the latest reading of every own account, and says how many
   * accounts that actually rests on.
   */
  const nowReadings = ownHandles
    .map((h) => latestFollowersOf(h))
    .filter((f): f is number => f != null)
  const followersNow = nowReadings.length > 0 ? nowReadings.reduce((a, f) => a + f, 0) : null
  const delta = lastTotal - firstTotal
  const pct = firstTotal > 0 ? Math.round(((delta / firstTotal) * 100) * 10) / 10 : null
  const measurable = history !== null && history.labels.length >= 2

  const standing = useMemo(
    () => standingAmongWatched(growth.totalPct, watchedHandles),
    [growth, watchedHandles],
  )

  if (!history) return null

  const base = only ? history.series.filter((s) => s.name === only) : history.series
  const shownSeries =
    metric === 'followers'
      ? /*
         * FOLLOWERS GAINED, NOT THE RUNNING TOTAL, AND THAT IS WHY THE
         * REFERENCE FITS FIVE PLATFORMS ON ONE AXIS.
         *
         * Plotting the totals put 3,290 and 280,000 on the same scale, where
         * the axis padding alone is ten times YouTube's whole following: the
         * largest account sets the height and every other line is pressed
         * flat against the floor. The chart was drawing the gap between the
         * accounts, which the reader already knows, instead of the movement,
         * which is the thing this card is called after.
         *
         * The reference plots the gain - its own axis runs 0 to 10K under the
         * heading "Total New Followers" - and gains are comparable across
         * accounts of any size. Every line starts at 0 on its first reading
         * in the window and rises by what it actually won, so all four share
         * one axis honestly and a platform that moved can be seen to move.
         * The absolute standing is not lost: it is the "Followers now" figure
         * beside the chart, where a running total belongs.
         */
        base.map((s) => {
          const first = s.values.find((v): v is number => v != null)
          if (first == null) return s
          return { ...s, values: s.values.map((v) => (v == null ? null : v - first)) }
        })
      : base.map((s) => {
          const first = s.values.find((v): v is number => v != null)
          if (first == null || first <= 0) return { ...s, values: s.values.map(() => null) }
          return {
            ...s,
            values: s.values.map((v) =>
              v == null ? null : Math.round(((v - first) / first) * 10000) / 100,
            ),
          }
        })

  const figures = [
    {
      label: 'New followers',
      value: measurable ? (
        `${delta > 0 ? '+' : ''}${full(delta)}`
      ) : (
        <NoData reason="Only one reading falls inside this window; a change needs two." />
      ),
      // The change against the SAME span before it — the comparison the
      // reference sheet puts here, and the one the office asked for.
      delta:
        measurable && previous != null && previous !== 0
          ? Math.round(((delta - previous) / Math.abs(previous)) * 1000) / 10
          : null,
      note:
        measurable && previous != null && previous !== 0
          ? `vs ${previous > 0 ? '+' : ''}${full(previous)} the ${windowDays} days before`
          : measurable
            ? /**
               * Say when the window is WIDER than the record.
               *
               * The desk's oldest follower reading is 27 Aug. Ask for 30 days
               * and the baseline is still 27 Aug, because there is no earlier
               * reading to stand on — so "Last 7 days" and "Last 30 days"
               * print the same figure, and the card gave no hint why. The
               * office read that as a filter that does nothing.
               *
               * The range caption above DOES move (27 Aug vs 4 Aug), so the
               * control is visibly working; what was missing was the reason
               * the number underneath it does not. Naming the limit turns a
               * dead-looking control into a statement about the record.
               *
               * "in this window", not "this desk holds": on a 7-day window the
               * earliest reading in range can be 28 Aug while the desk also
               * holds a 27 Aug one that the window excludes. Calling that the
               * oldest the desk has would be false.
               */
              windowFrom !== null && history.firstDay > windowFrom.slice(0, 10)
              ? `since ${dayOf(history.firstDay)} — the earliest reading in this window`
              : `since ${dayOf(history.firstDay)}`
            : undefined,
    },
    {
      label: 'Followers now',
      value:
        followersNow == null ? (
          <NoData reason="No account on this desk has a follower reading yet." />
        ) : (
          compact(followersNow)
        ),
      delta: null,
      note:
        followersNow == null
          ? undefined
          : `across ${nowReadings.length} of your ${ownHandles.length} account${ownHandles.length === 1 ? '' : 's'}`,
    },
    {
      label: `New followers, previous ${windowDays} days`,
      value:
        previous != null ? (
          `${previous > 0 ? '+' : ''}${full(previous)}`
        ) : (
          <NoData reason="The window before this one holds fewer than two readings, so there is no change to compare against." />
        ),
      delta: null,
      note: previous != null ? 'the same span, one window back' : undefined,
    },
    {
      label: 'Growth rate',
      value:
        measurable && pct != null ? (
          `${pct.toFixed(1)}%`
        ) : (
          <NoData reason="A rate needs two readings inside this window." />
        ),
      delta: null,
      note: measurable && pct != null ? 'over the readings shown' : undefined,
    },
  ]

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-[-0.015em]">Follower growth</h2>
          <p className="mt-0.5 text-xs text-ink-3">
            Track your growth rate · {windowLabel(anchor, window)}
          </p>
        </div>
        <WindowPicker value={window} onChange={setWindow} options={['week', 'month']} />
      </div>

      {/* The legend IS the filter, the owner's way round: press a platform
          to see ONLY that platform — the axis rescales and the small
          accounts become readable — press it again or press All to see
          everyone together. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <div
          className="mr-1 inline-flex rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface-2)] p-0.5"
          role="group"
          aria-label="Chart measure"
        >
          {(
            [
              { id: 'followers' as const, label: 'New followers' },
              { id: 'percent' as const, label: 'Growth %' },
            ]
          ).map((mo) => (
            <button
              key={mo.id}
              type="button"
              onClick={() => setMetric(mo.id)}
              aria-pressed={metric === mo.id}
              className={cn(
                'min-h-9 rounded-[var(--radius-pill)] px-2.5 text-xs font-semibold transition-colors',
                metric === mo.id
                  ? 'bg-[var(--surface)] text-ink shadow-[var(--e1)]'
                  : 'text-ink-3 hover:text-ink-2',
              )}
            >
              {mo.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOnly(null)}
          aria-pressed={only === null}
          className={cn(
            'inline-flex min-h-9 items-center rounded-[var(--radius-pill)] border px-3 text-xs font-semibold transition-colors',
            only === null
              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
              : 'border-[var(--border)] bg-[var(--surface-2)] text-ink-2 hover:border-[var(--border-interactive)]',
          )}
        >
          All
        </button>
        {history.series.map((s) => {
          const active = only === s.name
          return (
            <button
              key={s.name}
              type="button"
              onClick={() => setOnly(active ? null : s.name)}
              aria-pressed={active}
              title={active ? 'Back to every platform' : `Show only ${s.name}`}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 text-xs font-semibold transition-colors',
                active
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-[var(--border)] bg-[var(--surface-2)] text-ink-2 hover:border-[var(--border-interactive)]',
              )}
            >
              <span aria-hidden className="size-2 rounded-full" style={{ background: s.color }} />
              {s.name}
            </button>
          )
        })}
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[1.5fr_1fr] lg:items-start">
        <div className="relative min-w-0">
          {measurable && shownSeries.length > 0 ? (
            (
              <>
                <LineChart
                  labels={history.labels}
                  series={shownSeries}
                  /* Taller when every platform shares the frame: the whole
                     Twitter/X complaint was a +100 rise crushed to eight
                     pixels under Instagram's +2,100. The spread is real and
                     stays real — more vertical room is the one honest lever
                     that makes the smaller mover legible, and the endpoint
                     labels state the exact figure either way. */
                  height={only === null ? 350 : 230}
                  legend={false}
                  area={metric === 'followers'}
                  formatValue={
                    metric === 'percent'
                      ? (n) => {
                          if (n == null) return 'NA'
                          // The axis hands over raw tick floats
                          // (0.31639999999999996); unrounded they overflow the
                          // left padding and clip to gibberish.
                          const v = Math.round(n * 100) / 100
                          return `${v > 0 ? '+' : ''}${v}%`
                        }
                      : (n) => (n == null ? 'NA' : `${n > 0 ? '+' : ''}${compact(n)}`)
                  }
                />
                {metric === 'percent' && (
                  <p className="mt-1 text-[10.5px] leading-relaxed text-ink-3">
                    Each line starts at 0% at its first reading in this window, so a small
                    account&rsquo;s movement shows beside a big one&rsquo;s. Every dot is a real
                    reading.
                  </p>
                )}
              </>
            )
          ) : (
            <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4">
              <p className="text-sm leading-relaxed text-ink-2">
                The readings in this window were all taken on one day, so there is no line to
                draw. Widen the window, or come back after the next reading.
              </p>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-2.5">
            {figures.map((f) => (
              <div
                key={f.label}
                className="rounded-[var(--radius-md)] border border-[var(--rule)] bg-[var(--surface-2)] p-3"
              >
                <p className="truncate text-[11px] font-medium text-ink-3">{f.label}</p>
                <p className="mt-1 flex flex-wrap items-baseline gap-1.5">
                  <span className="tnum text-[19px] font-bold leading-none tracking-[-0.02em]">
                    {f.value}
                  </span>
                  {f.delta != null && <DeltaChip value={f.delta} />}
                </p>
                {f.note && <p className="mt-1 truncate text-[10.5px] text-ink-3">{f.note}</p>}
              </div>
            ))}
          </div>

          {standing && (
            <div className="mt-2.5 flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--pos)_28%,transparent)] bg-[var(--pos-soft)] p-3">
              <Sparkles size={15} className="mt-0.5 shrink-0 text-[var(--pos)]" aria-hidden />
              <p className="text-xs leading-relaxed text-ink-2">
                {standing.ahead === standing.of
                  ? `Your follower growth is ahead of all ${standing.of} account${standing.of === 1 ? '' : 's'} you watch.`
                  : standing.ahead === 0
                    ? `Every one of the ${standing.of} account${standing.of === 1 ? '' : 's'} you watch grew faster than you over the same readings.`
                    : `Your follower growth is ahead of ${standing.ahead} of the ${standing.of} accounts you watch.`}
                {/* The accounts the comparison could not reach. A rate needs
                    two readings, and a sentence that counts only the accounts
                    it managed to measure quietly renames the watch list. */}
                {standing.of < standing.watched &&
                  ` ${standing.watched - standing.of} further watched ${
                    standing.watched - standing.of === 1 ? 'account has' : 'accounts have'
                  } only one follower reading, so ${
                    standing.watched - standing.of === 1 ? 'it is' : 'they are'
                  } not in this comparison.`}
              </p>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenAccounts}
        className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--accent)]"
      >
        View detailed growth report
        <ArrowRight size={14} aria-hidden />
      </button>
    </Card>
  )
}
