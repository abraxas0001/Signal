import * as m from 'motion/react-m'
import NumberFlow from '@number-flow/react'
import type { EmotionScore, Metric, SentimentReading } from '@shared/types'
import { EMOTION_GLYPH, SENTIMENT_SCORE } from '@shared/taxonomy'
import { cn, compact, full, scoreToPosition } from '@/lib/utils'
import { spring, listItem, listStagger } from '@/lib/motion'
import { Provenance, provenanceTitle } from './ui'

/* ═══════════════════════════════════════════════════════════════════════════
   Sentiment meter

   Form: a single value with polarity, so a diverging meter rather than a
   chart. POSITION on the track is the encoding; the colour and the always-on
   text label reinforce it. That layering is deliberate — the teal/red pair
   separates by dE 10.7 under deuteranopia, which is safe, but no reading here
   ever depends on colour alone.
   ═══════════════════════════════════════════════════════════════════════════ */

export function SentimentMeter({ sentiment }: { sentiment: SentimentReading }) {
  const score = Number.isFinite(sentiment.score)
    ? sentiment.score
    : Math.round((SENTIMENT_SCORE[sentiment.label] ?? 0) * 100)

  const pos = scoreToPosition(score)
  const tone = score > 12 ? 'pos' : score < -12 ? 'neg' : 'mid'
  const colour = `var(--chart-${tone})`

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          {/* The label is the primary read, not the colour. */}
          <p
            className="truncate text-2xl font-semibold tracking-[-0.022em]"
            style={{ color: colour }}
          >
            {sentiment.label}
          </p>
          <p className="mt-0.5 text-sm text-ink-2">
            {sentiment.tone} in tone
          </p>
        </div>
        <p className="tnum shrink-0 text-2xl font-semibold" style={{ color: colour }}>
          <NumberFlow value={score} format={{ signDisplay: 'always' }} />
        </p>
      </div>

      {/* Track, then labels beneath it in normal flow.
          The labels used to be absolutely positioned inside the same 36px box
          as a 20px needle, so the needle's shadow and the text tops collided —
          and at the extremes the end labels ran into the track itself. Giving
          the track its own height and letting the labels sit below removes the
          overlap at every value rather than only in the middle. */}
      <div className="relative mt-4 h-6">
        <div
          className="absolute inset-x-0 top-2 h-2 rounded-full"
          style={{
            background:
              'linear-gradient(90deg, var(--chart-neg) 0%, var(--chart-mid) 50%, var(--chart-pos) 100%)',
            opacity: 0.28,
          }}
        />
        {/* Centre line — the neutral midpoint of a diverging scale. */}
        <div className="absolute left-1/2 top-1 h-4 w-px -translate-x-1/2 bg-[var(--border-strong)]" />

        {/* Needle.

            Travels on translateX, not `left`. `left` is a layout property, so
            the old version relaid out the row on every frame of the spring —
            and this is the one animation that runs on every single report.
            The percentage is applied via a wrapper that spans the track, so
            the transform still resolves against the track's width rather than
            the needle's own box. */}
        <m.div
          className="absolute inset-x-0 top-0.5"
          initial={{ x: '50%' }}
          animate={{ x: `${pos * 100}%` }}
          transition={spring.settle}
        >
          <div
            className="-ml-2.5 size-5 rounded-full border-2"
            style={{
              background: colour,
              borderColor: 'var(--surface)',
              boxShadow: '0 2px 8px rgb(0 0 0 / 0.25)',
            }}
          />
        </m.div>
      </div>

      <div className="mt-2 flex justify-between text-2xs text-ink-3">
        <span>Negative</span>
        <span>Neutral</span>
        <span>Positive</span>
      </div>

      {/* Decorative quote rule, not a control, so the lighter border token is
          correct here — WCAG 1.4.11's 3:1 floor applies to controls. */}
      {sentiment.rationale && (
        <p className="mt-4 border-l-2 border-[var(--border-strong)] pl-3 text-sm text-ink-2">
          {sentiment.rationale}
        </p>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Emotion distribution

   Form: magnitude across categories, so horizontal bars sorted descending.
   One hue only — bar LENGTH carries the magnitude, and every bar is directly
   labelled, so there is no categorical palette to validate and nothing depends
   on telling nine colours apart.
   ═══════════════════════════════════════════════════════════════════════════ */

export function EmotionBars({ emotions }: { emotions: EmotionScore[] }) {
  if (!emotions.length) {
    return <p className="text-sm text-ink-3">No clear emotional signal.</p>
  }

  const sorted = [...emotions].sort((a, b) => b.weight - a.weight).slice(0, 5)
  const max = Math.max(...sorted.map((e) => e.weight), 1)

  return (
    <m.ul className="space-y-2.5" variants={listStagger} initial="hidden" animate="show">
      {sorted.map((e, i) => (
        <m.li key={e.emotion} variants={listItem} className="flex items-center gap-3">
          <span className="w-6 shrink-0 text-center text-lg" aria-hidden>
            {EMOTION_GLYPH[e.emotion] ?? '💭'}
          </span>

          <span className="w-20 shrink-0 text-sm font-medium text-ink-2">
            {e.emotion}
          </span>

          {/* Thin mark, rounded data-end, anchored to the baseline.

              Grown with scaleX rather than width: width is a layout property,
              and five of these animating inside a stagger meant five
              simultaneous layout passes on exactly the mid-range hardware this
              product targets. origin-left makes the transform read identically. */}
          <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
            <m.div
              className="absolute inset-y-0 left-0 w-full origin-left rounded-full"
              style={{
                background: 'var(--accent)',
                // The strongest emotion reads at full strength; the rest step
                // back so the ranking is visible at a glance.
                opacity: 1 - i * 0.14,
              }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: e.weight / max }}
              transition={{ ...spring.settle, delay: 0.05 + i * 0.05 }}
            />
          </div>

          <span className="tnum w-9 shrink-0 text-right text-xs text-ink-3">
            {e.weight}%
          </span>
        </m.li>
      ))}
    </m.ul>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Engagement KPI tiles

   Form: a handful of headline numbers, so a KPI row of stat tiles rather than
   a grouped bar chart. Provenance is shown by exception: a measured figure is
   stated plainly, and only one we did not measure carries a note.
   ═══════════════════════════════════════════════════════════════════════════ */

export function StatTile({
  label,
  metric,
  icon,
  onEdit,
}: {
  label: string
  metric: Metric
  icon?: React.ReactNode
  /** Offered when the platform withheld the number and the user can fill it in. */
  onEdit?: () => void
}) {
  const missing = metric.value == null
  const Tag = missing && onEdit ? 'button' : 'div'

  return (
    <Tag
      {...(missing && onEdit ? { onClick: onEdit, type: 'button' as const } : {})}
      className={cn(
        'card relative flex min-h-[86px] flex-col justify-between p-3 text-left',
        missing && onEdit && 'border border-dashed border-[var(--border-interactive)] shadow-none',
      )}
      // The badge is gone from the face of the tile, so the origin lives here:
      // available on hover and to a screen reader, absent from the visual noise.
      title={
        metric.value != null
          ? `${full(metric.value)}: ${provenanceTitle(metric.source)}`
          : undefined
      }
    >
      <div className="flex items-center gap-1.5 text-ink-3">
        {icon}
        <span className="text-2xs font-medium uppercase tracking-[0.04em]">
          {label}
        </span>
      </div>

      {missing ? (
        <div>
          <p className="text-xl font-semibold leading-none text-ink-3">—</p>
          <p className="mt-1 flex h-4 items-center overflow-hidden text-2xs text-ink-3">
            {onEdit ? 'Tap to add' : 'Not available'}
          </p>
        </div>
      ) : (
        <div>
          <p className="tnum text-xl font-semibold leading-none">
            {metric.value != null && metric.value < 100_000 ? (
              <NumberFlow value={metric.value} />
            ) : (
              compact(metric.value)
            )}
          </p>
          {/* Always present, usually empty. A KPI row is read by sweeping
              across it, so the numbers have to share a baseline — letting this
              line collapse pushed the one tile that had a note out of
              alignment with its neighbours. */}
          <div className="mt-1 flex h-4 items-center gap-x-1.5 overflow-hidden">
            <Provenance source={metric.source} />
            {metric.display && (
              <span className="text-2xs text-ink-3">
                {metric.display} on screen
              </span>
            )}
          </div>
        </div>
      )}
    </Tag>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Level indicator — severity, risk, priority. An ordered scale, so it reads as
   filled pips rather than a colour the reader has to decode.
   ═══════════════════════════════════════════════════════════════════════════ */

export function LevelPips({
  level,
  scale,
  tone = 'warning',
  label,
}: {
  level: string
  scale: readonly string[]
  tone?: 'warning' | 'negative' | 'accent'
  label?: string
}) {
  const idx = scale.indexOf(level)
  const filled = idx + 1
  const colour = {
    warning: 'var(--warn)',
    negative: 'var(--neg)',
    accent: 'var(--accent)',
  }[tone]

  return (
    <div>
      {label && (
        <p className="mb-1 text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
          {label}
        </p>
      )}
      <div className="flex items-center gap-2">
        {/* 2px gaps between pips so adjacent fills never merge. */}
        <div className="flex gap-[3px]" role="img" aria-label={`${label ?? 'Level'}: ${level}`}>
          {scale.map((step, i) => (
            <m.span
              key={step}
              className="h-2.5 w-4 rounded-[2px]"
              style={{ background: i < filled ? colour : 'var(--surface-3)' }}
              initial={{ scaleY: 0.4, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ ...spring.pop, delay: i * 0.05 }}
            />
          ))}
        </div>
        <span className="text-sm font-semibold" style={{ color: colour }}>
          {level}
        </span>
      </div>
    </div>
  )
}
