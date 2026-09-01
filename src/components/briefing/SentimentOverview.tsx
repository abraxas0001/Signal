import { useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import type { Report } from '@shared/types'
import { Card, Chip } from '../ui'
import { DonutBreakdown, LineChart, PlatformBadge } from '@/components/kit'
import { recurringTerms, termCount } from '@/lib/terms'
import { readStandingCache, type Standing, type TrackedHandle } from '@/lib/handles'
import { cn } from '@/lib/utils'

/**
 * "Sentiment Overview" — the left card of the reference design's second row.
 *
 * Everything on it is counted from comments this desk actually read under the
 * office's own posts: the donut is the split of those comments, the "why"
 * chips are the words that recur in them with the number of comments each
 * appears in, and the trend is the sentiment score of the office's own posts
 * that have been analysed in full, oldest to newest.
 *
 * The counts are deliberately the real ones. The reference shows "Good work
 * (1.2K)" because it is a picture; a desk that has read two hundred comments
 * must show the two hundred it read, or the chips become a claim about a
 * conversation nobody sampled.
 */

interface Reading {
  platform: TrackedHandle['platform']
  handle: string
  standing: Standing
  /** Posts this desk actually holds for the account, which caps `postsRead`. */
  held: number
}

/** One tab's worth of numbers: the split, the quotes, the comment count. */
interface Slice {
  positive: number
  neutral: number
  negative: number
  commentsRead: number
  postsRead: number
  praise: { text: string; platform: string }[]
  criticism: { text: string; platform: string }[]
  neutralQuotes: { text: string; platform: string }[]
}

/**
 * The split is the plain sum of the counts across the accounts shown.
 *
 * `positive`, `neutral` and `negative` on a reading are COUNTS of comments,
 * so adding them already gives a hundred-comment account its hundred votes
 * against a nine-comment one. This used to weight each count by its own
 * account's comment total a second time, which moved the printed split off
 * the comments it claims to describe.
 */
function sliceOf(readings: Reading[]): Slice {
  const pos = readings.reduce((s, r) => s + r.standing.positive, 0)
  const neu = readings.reduce((s, r) => s + r.standing.neutral, 0)
  const neg = readings.reduce((s, r) => s + r.standing.negative, 0)
  const total = pos + neu + neg
  return {
    positive: total > 0 ? Math.round((pos / total) * 100) : 0,
    neutral: total > 0 ? Math.round((neu / total) * 100) : 0,
    negative: total > 0 ? Math.round((neg / total) * 100) : 0,
    commentsRead: readings.reduce((s, r) => s + r.standing.commentsRead, 0),
    /* Capped at the posts the desk holds: a reading records how many posts it
       walked when it ran, and that can outrun the stored list, which put the
       card in the position of counting more of "your posts" than exist. */
    postsRead: readings.reduce(
      (s, r) => s + (r.held > 0 ? Math.min(r.standing.postsRead, r.held) : r.standing.postsRead),
      0,
    ),
    praise: readings.flatMap((r) => r.standing.praise.map((text) => ({ text, platform: r.platform }))),
    criticism: readings.flatMap((r) =>
      r.standing.criticism.map((text) => ({ text, platform: r.platform })),
    ),
    neutralQuotes: readings.flatMap((r) =>
      (r.standing.neutralQuotes ?? []).map((text) => ({ text, platform: r.platform })),
    ),
  }
}

/**
 * The recurring words on one side, each with the number of quoted comments it
 * appears in. The count is what makes a chip evidence rather than a label.
 */
function whyChips(quotes: string[], max: number): { term: string; count: number }[] {
  const terms = recurringTerms(quotes, max) ?? []
  return terms
    .map((term) => ({ term, count: termCount(quotes, term) }))
    .filter((c) => c.count > 0)
}

export function SentimentOverview({
  handles,
  reports,
  onOpenAccounts,
}: {
  /** The desk's OWN accounts. Watched accounts are somebody else's audience. */
  handles: TrackedHandle[]
  /** Full reports by post url; null while they are still loading. */
  reports: Map<string, Report> | null
  onOpenAccounts: () => void
}) {
  const readings = useMemo<Reading[]>(
    () =>
      handles
        .map((h) => {
          const standing = readStandingCache(h.id)
          return standing && standing.source !== 'record'
            ? {
                platform: h.platform,
                handle: h.displayName ?? h.handle,
                standing,
                held: (h.snapshots.at(-1)?.posts ?? []).length,
              }
            : null
        })
        .filter((r): r is Reading => r !== null)
        .sort((a, b) => b.standing.commentsRead - a.standing.commentsRead),
    [handles],
  )

  const [tab, setTab] = useState<string>('overall')
  const shown = tab === 'overall' ? readings : readings.filter((r) => r.platform === tab)
  const slice = useMemo(() => sliceOf(shown), [shown])

  const praise = useMemo(() => whyChips(slice.praise.map((q) => q.text), 5), [slice])
  const criticism = useMemo(() => whyChips(slice.criticism.map((q) => q.text), 5), [slice])
  const [side, setSide] = useState<'Positive' | 'Neutral' | 'Negative'>('Positive')

  /**
   * The trend: one point per own post that has been analysed in full, oldest
   * first, on the report's own −100…+100 sentiment score.
   *
   * The reference draws three lines because it is charting a per-post
   * breakdown. This desk scores a post once, so it draws that one score —
   * a second and third line would have to be invented to fill the legend.
   */
  const trend = useMemo(() => {
    if (!reports) return null
    // Dates come from the stored posts themselves: the desk's own-post list
    // carries engagement but no date, and a trend has to be ordered by when
    // each post went up rather than by the order they happen to be stored.
    const rows = handles
      .flatMap((h) => h.snapshots.at(-1)?.posts ?? [])
      .map((p) => {
        const report = reports.get(p.url)
        // A report whose analysis never came back scores nothing; it is not a
        // zero on the trend, it is simply not a point on it. The DATE falls
        // back to the report's own snapshot — half the Instagram posts carry
        // no date in the scrape, and dropping them flattened a ten-point
        // trend to two.
        const at = p.publishedAt ?? report?.snapshot.publishedAt ?? null
        return report?.analysis && at ? { at, score: report.analysis.sentiment.score } : null
      })
      .filter((r): r is { at: string; score: number } => r !== null)
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(-10)
    if (rows.length < 2) return null
    // With points from more than one year, day-and-month labels read as an
    // unsorted axis ("2 Oct" before "11 Aug"); the year comes along.
    const years = new Set(rows.map((r) => r.at.slice(0, 4)))
    return {
      labels: rows.map((r) =>
        new Date(r.at).toLocaleDateString(
          'en-IN',
          years.size > 1
            ? { day: 'numeric', month: 'short', year: '2-digit' }
            : { day: 'numeric', month: 'short' },
        ),
      ),
      series: [
        {
          name: 'Mood',
          color: 'var(--chart-1)',
          values: rows.map((r) => r.score),
        },
      ],
      count: rows.length,
    }
  }, [handles, reports])

  if (readings.length === 0) {
    return (
      <Card className="p-4 sm:p-5">
        <h2 className="text-[17px] font-bold tracking-[-0.015em]">Sentiment overview</h2>
        <p className="mt-0.5 text-xs text-ink-3">From the comments under your posts</p>
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          No comments have been read on your accounts yet.
        </p>
        <button
          type="button"
          onClick={onOpenAccounts}
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--accent)]"
        >
          Open your accounts
          <ArrowRight size={14} aria-hidden />
        </button>
      </Card>
    )
  }

  const tabs = [
    { id: 'overall', label: 'Overall' },
    ...[...new Set(readings.map((r) => r.platform))].map((p) => ({ id: p, label: p })),
  ]

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-[-0.015em]">Sentiment overview</h2>
          <p className="mt-0.5 text-xs text-ink-3">
            From {slice.commentsRead.toLocaleString('en-IN')} comments on {slice.postsRead} of your
            posts
          </p>
        </div>
      </div>

      {/* The reference's platform switcher: "Overall" then one tab per
          platform. Only platforms with a reading appear — a tab that opens
          onto nothing is a promise the data does not keep. */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cn(
              'inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 text-xs font-semibold transition-colors',
              tab === t.id
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--border)] bg-[var(--surface-2)] text-ink-2 hover:border-[var(--border-interactive)]',
            )}
          >
            {t.id !== 'overall' && <PlatformBadge platform={t.id} size={16} />}
            {t.id === 'overall' ? t.label : t.label}
          </button>
        ))}
      </div>

      {/* ── the split, pressable ───────────────────────────────────────────
          The three percentages are buttons, per the owner: press one and the
          panel beside the donut shows WHY — the words that recur on that side
          and the actual comments behind them. Neutral is counted but never
          quoted by the readings, and its panel says so instead of pretending. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[auto_1fr] lg:items-start">
        <div className="flex items-center gap-4 justify-self-center lg:justify-self-start">
          <DonutBreakdown
            size={150}
            thickness={22}
            segments={[
              { label: 'Positive', value: slice.positive, color: 'var(--chart-pos)' },
              { label: 'Neutral', value: slice.neutral, color: 'var(--chart-mid)' },
              { label: 'Negative', value: slice.negative, color: 'var(--chart-neg)' },
            ]}
            centerLabel={`${slice.positive}%`}
            centerSub="Positive"
            className="shrink-0"
          />
          <div className="grid shrink-0 gap-1.5">
            {(
              [
                { label: 'Positive' as const, n: slice.positive, colour: 'var(--chart-pos)' },
                { label: 'Neutral' as const, n: slice.neutral, colour: 'var(--chart-mid)' },
                { label: 'Negative' as const, n: slice.negative, colour: 'var(--chart-neg)' },
              ]
            ).map((seg) => (
              <button
                key={seg.label}
                type="button"
                onClick={() => setSide(seg.label)}
                aria-pressed={side === seg.label}
                className={cn(
                  'flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] border px-3 text-left transition-colors',
                  side === seg.label
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--border-interactive)]',
                )}
              >
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: seg.colour }} />
                <span className="tnum text-sm font-bold">{seg.n}%</span>
                <span className="text-sm text-ink-2">{seg.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3">
          {side === 'Neutral' ? (
            <>
              <p className="text-[12px] font-semibold text-ink">Neutral comments</p>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
                {slice.neutral}% of the {slice.commentsRead.toLocaleString('en-IN')} comments took
                no side: greetings, tags and plain reactions.
              </p>
              {slice.neutralQuotes.length > 0 && (
                <ul className="mt-2.5 space-y-1.5 border-t border-[var(--rule)] pt-2.5">
                  {slice.neutralQuotes.slice(0, 5).map((q) => (
                    <li key={q.text} className="flex items-start gap-2">
                      <PlatformBadge platform={q.platform} size={16} className="mt-0.5" />
                      <p className="line-clamp-2 min-w-0 text-xs leading-relaxed text-ink-2">
                        &ldquo;{q.text}&rdquo;
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            (() => {
              const chips = side === 'Positive' ? praise : criticism
              const quotes = side === 'Positive' ? slice.praise : slice.criticism
              return (
                <>
                  <p className="text-[12px] font-semibold text-ink">
                    {side === 'Positive' ? 'Positive sentiment, why' : 'Negative sentiment, why'}
                  </p>
                  {chips.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {chips.map((c) => (
                        <li key={c.term}>
                          <Chip tone={side === 'Positive' ? 'positive' : 'negative'} className="tnum">
                            {c.term} ({c.count})
                          </Chip>
                        </li>
                      ))}
                    </ul>
                  )}
                  {quotes.length > 0 ? (
                    <ul className="mt-2.5 space-y-1.5 border-t border-[var(--rule)] pt-2.5">
                      {quotes.slice(0, 5).map((q) => (
                        <li key={q.text} className="flex items-start gap-2">
                          <PlatformBadge platform={q.platform} size={16} className="mt-0.5" />
                          <p className="line-clamp-2 min-w-0 text-xs leading-relaxed text-ink-2">
                            &ldquo;{q.text}&rdquo;
                          </p>
                        </li>
                      ))}
                      {quotes.length > 5 && (
                        <li className="text-[11px] text-ink-3">
                          and {quotes.length - 5} more quoted comments
                        </li>
                      )}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
                      No comments were quoted on this side of the reading.
                    </p>
                  )}
                </>
              )
            })()
          )}
        </div>
      </div>

      {/* ── the trend, full width ──────────────────────────────────────── */}
      <div className="mt-3 grid">
        <div className="rounded-[var(--radius-md)] border border-[var(--rule)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] font-semibold text-ink">Mood, post by post</p>
            <span className="text-[11px] text-ink-3">
              {trend
                ? `Your last ${trend.count} analysed posts, oldest to newest. Higher is warmer.`
                : 'Needs analysed posts'}
            </span>
          </div>
          {trend ? (
            <div className="mt-1">
              <LineChart
                labels={trend.labels}
                series={trend.series}
                height={132}
                formatValue={(n) => (n == null ? 'NA' : `${n > 0 ? '+' : ''}${Math.round(n)}`)}
              />
            </div>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-ink-3">
              A trend needs at least two of your posts read in full. Open a post and press Analyse
              to add one.
            </p>
          )}
        </div>
      </div>

    </Card>
  )
}
