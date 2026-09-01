import * as m from 'motion/react-m'
import { useMemo, type ReactNode } from 'react'
import NumberFlow from '@number-flow/react'
import { CommentsPanel } from './CommentsPanel'
import {
  BadgeCheck,
  Clock,
  Eye,
  Heart,
  Link2,
  MapPin,
  MessageCircle,
  Repeat2,
  TrendingUp,
  Users,
} from 'lucide-react'
import type { Metric, PostSnapshot, Report } from '@shared/types'
import { Button, Card, Chip, Provenance, provenanceTitle } from '../ui'
import { PostCard } from './PostCard'
import { ExtractionNotice } from './ExtractionNotice'
import { absoluteDate, cn, compact, full, relativeTime } from '@/lib/utils'
import { downloadCsv, downloadWorkbook } from '@/lib/export'
import { ExportButton } from '@/components/ExportButton'
import { CardHead, DonutBreakdown, IndiaMap } from '@/components/kit'
import { geocodePlace } from '@/components/gazetteer'
import { INDIA_DOTS, INDIA_BBOX } from '@/components/india-dots'
import { fadeUp, listStagger } from '@/lib/motion'

/**
 * The report when no language model ran.
 *
 * This is deliberately not the analysis page with its middle removed. Nothing
 * here is inferred — every figure was published by the platform and carries the
 * route it came from — so the page is built around that: the numbers first, at
 * full size, then the post, then a plain account of how each value was
 * obtained and what the platform refused to give.
 *
 * The tone matters. A user who pastes a link and gets this should understand
 * they received a complete measurement, not a degraded analysis. So there is no
 * empty state, no greyed-out section, and no "unavailable" banner where the
 * interpretation would have been.
 */
export function DataReport({
  report,
  onReset,
  onEditMetric,
}: {
  report: Report
  onReset: () => void
  onEditMetric?: () => void
}) {
  const { snapshot } = report
  const eng = snapshot.engagement
  const metricLabel = snapshot.platform === 'Facebook' ? 'Reactions' : 'Likes'

  const measured = [eng.likes, eng.comments, eng.shares, eng.views, snapshot.author.followers].filter(
    (x) => x.value != null,
  ).length

  const total =
    (eng.likes.value ?? 0) + (eng.comments.value ?? 0) + (eng.shares.value ?? 0)

  // Presentational only. The profile's stated location, geocoded — rendered as
  // a home glow when the gazetteer knows it, and simply absent when it does not.
  const basedAt = useMemo(
    () => geocodePlace(snapshot.author.declaredLocation),
    [snapshot.author.declaredLocation],
  )

  // The measured interactions, as a composition. Only the counts that were
  // actually published take a segment; the provenance still rides on the tiles.
  const mix = useMemo(
    () =>
      [
        { label: metricLabel, value: eng.likes.value, color: 'var(--chart-5)' },
        { label: 'Comments', value: eng.comments.value, color: 'var(--chart-1)' },
        { label: 'Shares', value: eng.shares.value, color: 'var(--chart-2)' },
      ].filter(
        (p): p is { label: string; value: number; color: string } => p.value != null && p.value > 0,
      ),
    [eng.likes.value, eng.comments.value, eng.shares.value, metricLabel],
  )

  return (
    <m.div
      className="shell shell-prose stack page-end"
      variants={listStagger}
      initial="hidden"
      animate="show"
    >
      {/* The run returned figures but no interpretation. Say why, once, at the
          top — otherwise the empty analysis reads as a broken report. */}
      {report.meta.incomplete && (
        <m.div variants={fadeUp}>
          <Card level="quiet">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="warning">Figures only</Chip>
            </div>
            <p className="mt-2 text-sm text-ink-2">{report.meta.incomplete}</p>
          </Card>
        </m.div>
      )}

      {/* ── What we measured ────────────────────────────────────────────── */}
      <m.div variants={fadeUp}>
        <Card tone="accent" className="grain" level="lift">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="accent" icon={<Link2 size={12} />}>
              {snapshot.platform === 'Twitter/X' ? 'X' : snapshot.platform}
            </Chip>
            <Chip tone="neutral">{snapshot.postType}</Chip>
            {snapshot.author.verified && (
              <Chip tone="positive" icon={<BadgeCheck size={12} />}>
                Verified
              </Chip>
            )}
          </div>

          {/* No .hed here: the line embeds the author's name, which is often
              Telugu script, and tight display tracking breaks its conjuncts.
              One size down at phone width — a 24px line embedding a long
              Telugu name wrapped to four rows at 375px — and slightly looser
              leading so stacked conjuncts never clip. */}
          <h1 className="mt-3 text-xl font-bold leading-[1.3] sm:text-2xl sm:leading-[1.22]">
            {headline(snapshot, total)}
          </h1>

          {measured === 0 && (
            <p className="mt-3 text-base leading-relaxed text-ink-2">
              {`The post came through, but ${
                snapshot.platform === 'Twitter/X' ? 'X' : snapshot.platform
              } published no engagement figures for it.`}
            </p>
          )}

          {snapshot.publishedAt && (
            <div className="mt-4 flex items-center gap-1.5 text-sm text-ink-3">
              <Clock size={13} />
              <span>
                Posted {relativeTime(snapshot.publishedAt)} · {absoluteDate(snapshot.publishedAt)}
              </span>
            </div>
          )}
        </Card>
      </m.div>

      {/* ── The numbers ─────────────────────────────────────────────────── */}
      <m.section variants={fadeUp} aria-label="How it landed">
        {/* One card, opened the reference way — icon badge, bold title, quiet
            sub — with the stat blocks inset on the card rather than four
            floating boxes. The section hint survives verbatim as the card's
            footnote, where a phone reader can still see the whole sentence
            (CardHead's sub line truncates, and honesty must not). */}
        <Card>
          <CardHead
            icon={<TrendingUp size={15} />}
            title="How it landed"
            tint="blue"
          />
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
            <MetricStat
              bare
              label={metricLabel}
              metric={eng.likes}
              icon={<Heart size={18} />}
              tint="pink"
              onEdit={onEditMetric}
            />
            <MetricStat
              bare
              label="Comments"
              metric={eng.comments}
              icon={<MessageCircle size={18} />}
              tint="blue"
              onEdit={onEditMetric}
            />
            <MetricStat
              bare
              label="Shares"
              metric={eng.shares}
              icon={<Repeat2 size={18} />}
              tint="violet"
              onEdit={onEditMetric}
            />
            <MetricStat
              bare
              label="Views"
              metric={eng.views}
              icon={<Eye size={18} />}
              tint="teal"
              onEdit={onEditMetric}
            />
          </div>

          <p className="mt-3 text-xs leading-relaxed text-ink-3">
            Tap any figure to correct it.
          </p>

          {eng.engagementRate != null && (
            <p className="mt-1.5 text-xs text-ink-3">
              <span className="tnum font-semibold text-ink-2">
                {(eng.engagementRate * 100).toFixed(2)}%
              </span>{' '}
              of people who saw it interacted with it.
            </p>
          )}

          {/* How the interactions split, once at least two kinds were published.
              Every value here is a measured count — the ring only re-shapes the
              same figures the tiles above already carry with their provenance.
              The legend column claims a real minimum width so at 375px it wraps
              under the ring instead of squeezing beside it. */}
          {mix.length >= 2 && (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4">
              <DonutBreakdown
                size={108}
                thickness={15}
                segments={mix}
                centerLabel={compact(mix.reduce((s, p) => s + p.value, 0))}
                centerSub="interactions"
                className="mx-auto shrink-0 sm:mx-0"
              />
              <div className="min-w-[200px] flex-1 space-y-2">
                {mix.map((p) => (
                  <div key={p.label} className="flex items-center gap-2">
                    <i className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-2">
                      {p.label}
                    </span>
                    <span className="tnum text-sm font-bold text-ink">{compact(p.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </m.section>

      {/* Honest note about anything the platform withheld. */}
      <m.div variants={fadeUp}>
        <ExtractionNotice snapshot={snapshot} onEditMetric={onEditMetric} />
      </m.div>

      {/* ── The post ────────────────────────────────────────────────────── */}
      <m.div variants={fadeUp}>
        <PostCard snapshot={snapshot} />
      </m.div>

      <CommentsPanel report={report} />

      {/* ── The account ─────────────────────────────────────────────────── */}
      {(snapshot.author.name || snapshot.author.followers.value != null) && (
        <m.section variants={fadeUp} aria-label="Who posted it">
          <Card>
            <CardHead icon={<Users size={15} />} title="Who posted it" tint="violet" />
            {/* Clean rows, no zebra: one hairline between facts is all the
                separation a four-row table needs. The scroll wrapper is the
                escape hatch for a value the wrap rules below cannot tame. */}
            <div className="overflow-x-auto">
              <dl className="divide-y divide-[var(--border)]">
                <Field label="Name" value={snapshot.author.name} />
                <Field label="Handle" value={snapshot.author.handle ? `@${snapshot.author.handle}` : null} />
                <Field
                  label="Followers"
                  value={
                    snapshot.author.followers.value != null
                      ? compact(snapshot.author.followers.value)
                      : null
                  }
                  icon={<Users size={11} />}
                />
                <Field label="Verified" value={snapshot.author.verified == null ? null : snapshot.author.verified ? 'Yes' : 'No'} />
              </dl>
            </div>
          </Card>
        </m.section>
      )}

      {/* Where the account says it is — only when the gazetteer can place it. */}
      {basedAt && (
        <m.section variants={fadeUp} aria-label="Stated location">
          <Card>
            <CardHead
              icon={<MapPin size={15} />}
              title="Stated location"
              sub={`${basedAt.name}, ${basedAt.state}`}
              tint="teal"
            />
            <IndiaMap
              dots={INDIA_DOTS}
              bbox={INDIA_BBOX}
              zones={[
                { lon: basedAt.lon, lat: basedAt.lat, radiusDeg: 1.2, label: `${basedAt.name}, ${basedAt.state}` },
              ]}
              className="mx-auto max-w-[420px]"
            />
            {/* The old section hint, kept whole and visible — it is the line
                that stops this map being read as a verified position. */}
            <p className="mt-3 text-xs leading-relaxed text-ink-3">
              Self-reported location.
            </p>
          </Card>
        </m.section>
      )}

      {/* ── Sticky action ───────────────────────────────────────────────── */}
      <div className="docked z-20 border-t border-[var(--border)] bg-[var(--surface-1)]/92 pb-3 pt-3 backdrop-blur-xl">
        <div className="shell shell-prose flex gap-2">
          <Button onClick={onReset} className="flex-1">
            Read another post
          </Button>
          {/* Both formats. The docked bar is narrow, but a member opening
              this on a phone with no spreadsheet app needs the flat file, and
              that was the one format this button never actually produced. */}
          <ExportButton
            className="shrink-0"
            count={1}
            noun="post"
            run={(format) => (format === 'csv' ? downloadCsv([report]) : downloadWorkbook([report]))}
          />
        </div>
      </div>
    </m.div>
  )
}

/* ── Engagement stat tile ──────────────────────────────────────────────────
 *
 * The IconStat visual — soft-tinted icon badge, quiet label, big bold
 * number — but carrying what the kit's tile cannot: the figure's provenance.
 * A measured count states its origin on hover; a user-entered or estimated
 * one says so in ink right beside the number; a withheld one becomes the
 * tap-to-add affordance. Behaviour is identical to the old StatTile — only
 * the clothes changed.
 */

const METRIC_TINTS = {
  blue: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  violet: { bg: 'var(--accent-2-soft)', fg: 'var(--accent-2)' },
  teal: { bg: 'color-mix(in oklab, var(--chart-3) 12%, transparent)', fg: 'var(--chart-3)' },
  orange: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  pink: { bg: 'color-mix(in oklab, var(--chart-5) 12%, transparent)', fg: 'var(--chart-5)' },
} as const

export function MetricStat({
  label,
  metric,
  icon,
  tint = 'blue',
  onEdit,
  bare = false,
}: {
  label: string
  metric: Metric
  icon: ReactNode
  tint?: keyof typeof METRIC_TINTS
  /** Offered when the platform withheld the number and the user can fill it in. */
  onEdit?: () => void
  /**
   * Inside a carded section: a soft inset block instead of a card of its own,
   * so the reference's "Performance Summary" grid does not become a card
   * nested in a card. Purely clothes — value, provenance and the tap-to-add
   * affordance are identical either way.
   */
  bare?: boolean
}) {
  const missing = metric.value == null
  const Tag = missing && onEdit ? 'button' : 'div'
  const t = METRIC_TINTS[tint]

  return (
    <Tag
      {...(missing && onEdit ? { onClick: onEdit, type: 'button' as const } : {})}
      className={cn(
        'flex flex-col gap-3 text-left',
        bare ? 'rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3.5 sm:p-4' : 'card p-4 sm:p-5',
        missing && onEdit &&
          'cursor-pointer border border-dashed border-[var(--border-interactive)] shadow-none',
        missing && onEdit && bare && 'bg-transparent',
      )}
      // The origin lives here for measured figures: available on hover and to
      // a screen reader, absent from the visual noise.
      title={
        metric.value != null
          ? `${full(metric.value)}: ${provenanceTitle(metric.source)}`
          : undefined
      }
    >
      <span
        className="icon-badge"
        style={missing ? { background: 'var(--surface-3)', color: 'var(--text-3)' } : { background: t.bg, color: t.fg }}
      >
        {icon}
      </span>

      <div>
        <p className="text-[13px] font-medium text-ink-3">{label}</p>
        {missing ? (
          <>
            <p className="mt-0.5 text-[26px] font-bold leading-none text-ink-3">NA</p>
            <div className="mt-1.5 flex h-4 items-center overflow-hidden text-[11px] text-ink-3">
              {onEdit ? 'Tap to add' : 'Not available'}
            </div>
          </>
        ) : (
          <>
            <p className="tnum mt-0.5 text-[26px] font-bold leading-none tracking-[-0.02em] text-ink">
              {metric.value != null && metric.value < 100_000 ? (
                <NumberFlow value={metric.value} />
              ) : (
                compact(metric.value)
              )}
            </p>
            {/* Always present, usually empty. A KPI row is read by sweeping
                across it, so the numbers have to share a baseline — letting
                this line collapse pushed the one tile that had a note out of
                alignment with its neighbours. */}
            <div className="mt-1.5 flex h-4 items-center gap-x-1.5 overflow-hidden">
              <Provenance source={metric.source} />
              {metric.display && (
                <span className="text-2xs text-ink-3">{metric.display} on screen</span>
              )}
            </div>
          </>
        )}
      </div>
    </Tag>
  )
}

function Field({
  label,
  value,
  icon,
}: {
  label: string
  value: string | null
  icon?: ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-3">
      <dt className="flex shrink-0 items-center gap-1 text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
        {icon}
        {label}
      </dt>
      {/* Wraps rather than truncates: at 375px an ellipsis here was eating
          the middle of Telugu account names — the one fact the row exists
          to state. */}
      <dd className="min-w-0 break-words text-right text-sm font-semibold">
        {value ?? <span className="font-normal text-ink-3">not published</span>}
      </dd>
    </div>
  )
}

/**
 * A factual headline, built from what was measured.
 *
 * No adjectives and no judgement: with no model in the loop, the page must not
 * imply a reading of the post it never made.
 */
function headline(snapshot: PostSnapshot, interactions: number): string {
  const who = snapshot.author.name ?? 'This account'
  const views = snapshot.engagement.views.value

  if (views != null && views > 0) {
    return `${who}: ${compact(views)} ${views === 1 ? 'view' : 'views'}, ${compact(interactions)} ${
      interactions === 1 ? 'interaction' : 'interactions'
    }`
  }
  if (interactions > 0) {
    return `${who}: ${compact(interactions)} ${interactions === 1 ? 'interaction' : 'interactions'}`
  }
  return `${who}: post read in full`
}

/** Kept exported for the type, so a Metric change here fails loudly. */
export type { Metric }
