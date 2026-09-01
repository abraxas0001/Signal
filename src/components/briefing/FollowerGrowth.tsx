import { useMemo, useState } from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Card } from '../ui'
import { DeltaChip, LineChart, seriesColor, type LineSeries } from '@/components/kit'
import type { GrowthSummary } from '@/lib/growth'
import type { TrackedHandle } from '@/lib/handles'
import { windowStart, type WindowId } from '@/lib/window'
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
function historyOf(handles: TrackedHandle[], start: string | null): History | null {
  const dayKey = (iso: string): string => iso.slice(0, 10)
  const days = new Set<string>()
  for (const h of handles) {
    for (const s of h.snapshots) {
      if (s.followers == null || !s.takenAt) continue
      if (start && s.takenAt < start) continue
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
    if (present.length > 0) span.set(platform, { first: present[0]!, last: present.at(-1)! })
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

/** How the desk's own growth compares with the accounts it watches. */
function standingAmongWatched(
  ownPct: number | null,
  watched: TrackedHandle[],
): { ahead: number; of: number } | null {
  const rivals = new Map<string, number>()
  for (const h of watched) {
    const readings = h.snapshots.filter((s) => s.followers != null)
    if (readings.length < 2) continue
    const last = readings.at(-1)!.followers!
    const prev = readings.at(-2)!.followers!
    if (prev <= 0) continue
    const name = h.displayName ?? h.handle
    rivals.set(name, Math.max(rivals.get(name) ?? -Infinity, ((last - prev) / prev) * 100))
  }
  if (rivals.size === 0 || ownPct == null) return null
  const ahead = [...rivals.values()].filter((pct) => ownPct > pct).length
  return { ahead, of: rivals.size }
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

  /* Anchored to the newest READING — this section is about readings, not
     posts, and a desk read daily should be able to ask for just the week. */
  const anchor = useMemo(() => {
    let newest: string | null = null
    for (const h of ownHandles)
      for (const s of h.snapshots)
        if (s.followers != null && s.takenAt && (!newest || s.takenAt > newest)) newest = s.takenAt
    return newest
  }, [ownHandles])
  const start = windowStart(anchor, window)

  const history = useMemo(() => historyOf(ownHandles, start), [ownHandles, start])

  /* The figures, over exactly the readings the chart shows. */
  const spans = history ? [...history.span.values()] : []
  const firstTotal = spans.reduce((a, s) => a + s.first, 0)
  const lastTotal = spans.reduce((a, s) => a + s.last, 0)
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
      ? base
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
      delta: measurable ? pct : null,
      note: measurable ? `since ${dayOf(history.firstDay)}` : undefined,
    },
    {
      label: 'Followers now',
      value: compact(lastTotal),
      delta: null,
      note: 'across your accounts',
    },
    {
      label: 'Followers before',
      value: measurable ? (
        compact(firstTotal)
      ) : (
        <NoData reason="Only one reading falls inside this window." />
      ),
      delta: null,
      note: measurable ? `on ${dayOf(history.firstDay)}` : undefined,
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
          <p className="mt-0.5 text-xs text-ink-3">Track your growth rate</p>
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
              { id: 'followers' as const, label: 'Followers' },
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
        <div className="min-w-0">
          {measurable && shownSeries.length > 0 ? (
            <>
              <LineChart
                labels={history.labels}
                series={shownSeries}
                height={230}
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
                    : undefined
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
                  ? `Your follower growth is ahead of all ${standing.of} accounts you watch.`
                  : standing.ahead === 0
                    ? `Every one of the ${standing.of} accounts you watch grew faster than you over the same readings.`
                    : `Your follower growth is ahead of ${standing.ahead} of the ${standing.of} accounts you watch.`}
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
