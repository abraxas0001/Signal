import { useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import type { Report } from '@shared/types'
import type { Sentiment } from '@shared/taxonomy'
import { Card } from '../ui'
import { DonutBreakdown, LineChart, PlatformBadge } from '@/components/kit'
import { NON_TOPIC, recurringTerms, termCount } from '@/lib/terms'
import { InfoMark } from './controls'
import { readStandingCache, type Standing, type TrackedHandle } from '@/lib/handles'
import { ownNames } from '@/lib/audience'
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
  }
}

/**
 * One side of the reading, answered with the comments themselves.
 *
 * THIS WAS KEYWORD CHIPS AND THEY COULD NOT WORK. The chips were the words
 * that recur across the comments on a side, and after three rounds of
 * cleaning — slogans out, kinship terms out, the desk's own names out, words
 * used by both camps out — what survived was still "women / minister /
 * national / president" for praise and "telangana / leaders" for criticism.
 * The office's verdict was exact: nobody can conclude anything from that.
 *
 * They are right, and the reason is structural rather than a tuning problem.
 * A word count over a hundred and fifty comments finds the SUBJECTS people
 * mention, never the REASONS they approve or object — "minister" is who she
 * is, not what anyone thinks of her. The reference sheet's "Good work (1.2K)"
 * comes from a corpus of thousands where a judgement phrase genuinely recurs;
 * at this desk's volume no judgement repeats often enough to count.
 *
 * What the desk does hold, per side, is the comments a reading actually put
 * there. Those are real, they are quoted verbatim, and a person can read three
 * of them and know why the side reads the way it does — which is the whole
 * job. So the comments are the answer, and the word count is gone.
 */
function WhyBlock({
  title,
  tone,
  quotes,
  linkLabel,
  onOpenAll,
  empty,
}: {
  title: string
  tone: 'positive' | 'negative'
  quotes: { text: string; platform: string }[]
  linkLabel: string
  onOpenAll: () => void
  empty: string
}) {
  const skin =
    tone === 'positive'
      ? { fill: 'var(--pos-soft)', text: 'var(--pos)' }
      : { fill: 'var(--neg-soft)', text: 'var(--neg)' }

  return (
    <div className="min-w-0">
      <p className="text-[15px] font-bold tracking-[-0.01em] text-ink">{title}</p>

      {quotes.length > 0 ? (
        <>
          <ul className="mt-2 space-y-1.5">
            {quotes.slice(0, 3).map((q) => (
              <li
                key={q.text}
                className="flex items-start gap-2 rounded-[8px] px-2 py-1.5"
                style={{ background: skin.fill }}
              >
                <PlatformBadge platform={q.platform} size={14} className="mt-0.5 shrink-0" />
                <span className="min-w-0 text-[11.5px] leading-relaxed" style={{ color: skin.text }}>
                  &ldquo;{q.text.length > 130 ? `${q.text.slice(0, 130)}…` : q.text}&rdquo;
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onOpenAll}
            className="mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--accent)]"
          >
            {linkLabel}
            <ArrowRight size={13} aria-hidden />
          </button>
        </>
      ) : (
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">{empty}</p>
      )}
    </div>
  )
}

export function SentimentOverview({
  handles,
  reports,
  onOpenAccounts,
  onOpenAudience,
}: {
  /** The desk's OWN accounts. Watched accounts are somebody else's audience. */
  handles: TrackedHandle[]
  /** Full reports by post url; null while they are still loading. */
  reports: Map<string, Report> | null
  onOpenAccounts: () => void
  /** The screen that breaks the reading down platform by platform. */
  onOpenAudience: () => void
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

  /** How many of the most recent analysed posts the trend covers. */
  const [span, setSpan] = useState(10)
  /** Which side the donut's centre reads out. */
  const [side, setSide] = useState<'Positive' | 'Neutral' | 'Negative'>('Positive')

  /**
   * The three lines, from the posts' own recorded readings.
   *
   * WHERE THE THREE SIDES COME FROM. Every analysed post carries one sentiment
   * LABEL - Strong Positive through Strong Negative - which is a real reading
   * stored against that post. A single post is therefore all of one side, so
   * plotting each post on its own would draw three lines flicking between 0
   * and 100 and would tell an office nothing. Each point is instead the share
   * of the last few posts that read each way, which is what makes the shape
   * legible while every number behind it stays counted rather than modelled.
   *
   * WHAT THIS IS NOT. It is not the three-way split of the COMMENTS: that is
   * measured per account, by the reader that goes through an account's
   * comments in bulk, and it is the donut above. No per-post comment split is
   * recorded anywhere in the data, so drawing one here would mean inventing
   * it. These lines are about the posts, which is what this trend always
   * plotted - it simply plotted the score before, and the sides now.
   */
  const trend = useMemo(() => {
    const posts = handles
      .filter((h) => tab === 'overall' || h.platform === tab)
      .flatMap((h) => h.snapshots.at(-1)?.posts ?? [])

    const rows = posts
      .map((p) => {
        const report = reports?.get(p.url)
        // A report whose analysis never came back scores nothing; it is not a
        // zero on the trend, it is simply not a point on it. The DATE falls
        // back to the report's own snapshot - half the Instagram posts carry
        // no date in the scrape, and dropping them flattened a ten-point
        // trend to two.
        const at = p.publishedAt ?? report?.snapshot.publishedAt ?? null
        const label = report?.analysis?.sentiment.label ?? null
        return label && at ? { at, label } : null
      })
      .filter((r): r is { at: string; label: Sentiment } => r !== null)
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(-span)

    if (rows.length < 2) return null

    /** Mixed sits with neutral: it took both sides, so it took neither. */
    const sideOf = (label: Sentiment): 'positive' | 'neutral' | 'negative' =>
      label === 'Strong Positive' || label === 'Positive'
        ? 'positive'
        : label === 'Strong Negative' || label === 'Negative'
          ? 'negative'
          : 'neutral'

    // Wide enough to smooth a single post's swing, short enough that ten
    // points still show movement.
    const win = Math.min(5, Math.max(2, Math.ceil(rows.length / 3)))
    const shareAt = (i: number, side: 'positive' | 'neutral' | 'negative'): number => {
      const from = Math.max(0, i - win + 1)
      const slice = rows.slice(from, i + 1)
      return Math.round((slice.filter((r) => sideOf(r.label) === side).length / slice.length) * 100)
    }

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
          name: 'Positive',
          color: 'var(--chart-pos)',
          values: rows.map((_, i) => shareAt(i, 'positive')),
        },
        {
          name: 'Neutral',
          color: 'var(--chart-mid)',
          values: rows.map((_, i) => shareAt(i, 'neutral')),
        },
        {
          name: 'Negative',
          color: 'var(--chart-neg)',
          values: rows.map((_, i) => shareAt(i, 'negative')),
        },
      ],
      count: rows.length,
      win,
    }
  }, [handles, reports, tab, span])

  /** The ring's centre states the side the reader has selected, not always Positive. */
  const sidePct =
    side === 'Positive' ? slice.positive : side === 'Neutral' ? slice.neutral : slice.negative

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
          <h2 className="text-[19px] font-bold tracking-[-0.018em]">Sentiment overview</h2>
          <p className="mt-0.5 flex items-center gap-1 text-[13px] text-ink-3">
            <span>
              From {slice.commentsRead.toLocaleString('en-IN')} comments on {slice.postsRead} of
              your posts
            </span>
            <InfoMark
              note={`The split counts every comment read. Comments that take no side, ${slice.neutral}% of them here, are greetings, tags and plain reactions: they are counted as neutral but the readings do not quote them, which is why only the positive and negative sides carry keywords.`}
            />
          </p>
        </div>
      </div>

      {/* The reference's segmented control: one grey track holding an
          "Overall" pill and then the platform marks as buttons, no text
          labels beside them. */}
      <div className="mt-3 flex w-full items-center gap-1 rounded-[10px] bg-[var(--surface-3)] p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            title={t.label}
            aria-label={t.label}
            className={cn(
              'inline-flex h-9 items-center justify-center gap-1.5 rounded-[7px] border text-xs font-semibold transition-colors',
              // "Overall" sizes to its word; the marks share what is left, so
              // the track fills the row as the reference's does instead of
              // huddling at the left edge.
              t.id === 'overall' ? 'shrink-0 px-3.5' : 'min-w-0 flex-1',
              tab === t.id
                ? 'border-[color-mix(in_oklab,var(--accent)_55%,transparent)] bg-[var(--surface)] text-[var(--accent)] shadow-[var(--e1)]'
                : 'border-transparent text-ink-2 hover:bg-[color-mix(in_oklab,var(--surface)_60%,transparent)]',
            )}
          >
            {t.id === 'overall' ? t.label : <PlatformBadge platform={t.id} size={22} />}
          </button>
        ))}
      </div>

      {/* ── upper half: the donut, and why the positive comments were positive
          The reference lays the card out as four quadrants divided by
          hairlines rather than as stacked bands, so the donut reads against
          the praise beside it and the complaints read against the trend. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,197fr)_minmax(0,134fr)] sm:gap-0">
        <div className="flex flex-nowrap items-center gap-3 sm:pr-4">
          <DonutBreakdown
            size={150}
            thickness={22}
            segments={[
              { label: 'Positive', value: slice.positive, color: 'var(--chart-pos)' },
              { label: 'Neutral', value: slice.neutral, color: 'var(--chart-mid)' },
              { label: 'Negative', value: slice.negative, color: 'var(--chart-neg)' },
            ]}
            centerLabel={`${sidePct}%`}
            centerSub={side}
            centerLabelClass="text-[27px] font-semibold tracking-[-0.02em]"
            className="shrink-0"
          />
          {/* The reference's legend: a dot, the figure, the word. Pressing one
              swings the donut's centre to that side, which is the only thing
              the selection still drives now that both "why" blocks are up at
              once instead of taking turns in one panel. */}
          <div className="grid min-w-0 shrink gap-0.5">
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
                  'flex min-h-8 items-center gap-2 rounded-[8px] px-1.5 text-left transition-colors',
                  'hover:bg-[var(--surface-2)]',
                )}
              >
                <span
                  aria-hidden
                  className="size-[11px] shrink-0 rounded-full"
                  style={{ background: seg.colour }}
                />
                <span className="tnum text-[13.5px] font-bold">{seg.n}%</span>
                <span
                  className={cn(
                    'truncate text-[13.5px]',
                    side === seg.label ? 'font-semibold text-ink' : 'text-ink-2',
                  )}
                >
                  {seg.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="sm:border-l sm:border-[var(--rule)] sm:pl-4">
          <WhyBlock
            title="Why the positive comments were positive"
            tone="positive"
            quotes={slice.praise}
            linkLabel="See all positive comments"
            onOpenAll={onOpenAudience}
            empty="No comment has been read on this side yet."
          />
        </div>
      </div>

      {/* ── lower half: why the negative ones were negative, and the trend ── */}
      <div className="mt-4 grid gap-4 border-t border-[var(--rule)] pt-4 sm:grid-cols-[minmax(0,135fr)_minmax(0,194fr)] sm:gap-0">
        <div className="sm:pr-4">
          <WhyBlock
            title="Why the negative comments were negative"
            tone="negative"
            quotes={slice.criticism}
            linkLabel="See all negative comments"
            onOpenAll={onOpenAudience}
            empty="No comment has been read on this side yet."
          />
        </div>

        <div className="min-w-0 sm:border-l sm:border-[var(--rule)] sm:pl-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1 text-[15px] font-bold tracking-[-0.01em] text-ink">
              Sentiment trend
              <InfoMark
                note={
                  trend
                    ? `The share of posts reading each way, taken over a rolling ${trend.win} posts so a single post does not swing the line to 0 or 100. Every post carries one recorded sentiment label; Mixed is counted with Neutral. This is about the posts. The three-way split of the COMMENTS is measured per account and is the donut above.`
                    : 'The share of posts reading each way, once at least two of your posts have been analysed.'
                }
              />
            </p>
            <label className="relative shrink-0">
              <span className="sr-only">How many posts the trend covers</span>
              <select
                value={span}
                onChange={(e) => setSpan(Number(e.target.value))}
                className="h-[30px] appearance-none rounded-[7px] border border-[var(--rule)] bg-[var(--surface)] pl-2.5 pr-6 font-medium leading-none text-ink-3 outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)]"
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    Last {n} posts
                  </option>
                ))}
              </select>
            </label>
          </div>
          {trend ? (
            <div className="mt-1">
              {/* WHY ONE LINE AND NOT THE REFERENCE'S THREE. The reference
                  plots Positive, Neutral and Negative per post. A post's
                  analysis records ONE sentiment score, not a three-way split
                  of its comments; the split exists per ACCOUNT, in the donut
                  above. Drawing three lines here would mean inventing two of
                  them, so the trend plots the score that was actually read.
                  That caveat rides on the heading's i mark rather than as a
                  paragraph under the chart. */}
              <LineChart
                labels={trend.labels}
                series={trend.series}
                height={150}
                area={false}
                markers="hollow"
                tickCount={2}
                domain={[0, 100]}
                formatValue={(n) => (n == null ? 'NA' : `${Math.round(n)}%`)}
              />
            </div>
          ) : (
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
              A trend needs at least two of your posts read in full. Open a post and press Analyse
              to add one.
            </p>
          )}
        </div>
      </div>

      {/* The rule above the footer spans the card's full content width, as the
          reference draws it; hanging it off the button itself made it stop
          where the words did. */}
      <div className="mt-3 border-t border-[var(--rule)] pt-1">
        <button
          type="button"
          onClick={onOpenAudience}
          className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-[var(--accent)]"
        >
          View platform-wise sentiment
          <ArrowRight size={14} aria-hidden />
        </button>
      </div>
    </Card>
  )
}
