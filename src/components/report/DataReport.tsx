import * as m from 'motion/react-m'
import { CommentsPanel } from './CommentsPanel'
import {
  BadgeCheck,
  Clock,
  Eye,
  Heart,
  Link2,
  MessageCircle,
  Repeat2,
  Users,
  Download,
} from 'lucide-react'
import type { Metric, PostSnapshot, Report } from '@shared/types'
import { Button, Card, Chip, SectionTitle } from '../ui'
import { StatTile } from '../charts'
import { PostCard } from './PostCard'
import { ExtractionNotice } from './ExtractionNotice'
import { absoluteDate, compact, relativeTime } from '@/lib/utils'
import { downloadWorkbook } from '@/lib/export'
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
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="warning">Figures only</Chip>
            </div>
            <p className="mt-2 text-sm text-ink-2">{report.meta.incomplete}</p>
          </Card>
        </m.div>
      )}

      {/* ── What we measured ────────────────────────────────────────────── */}
      <m.div variants={fadeUp}>
        <Card tone="accent" className="grain">
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

          <h1 className="mt-3 text-2xl font-semibold leading-[1.12] tracking-[-0.022em]">
            {headline(snapshot, total)}
          </h1>

          <p className="mt-3 text-base leading-relaxed text-ink-2">
            {measured > 0
              ? `${measured} ${measured === 1 ? 'figure' : 'figures'} read straight from ${
                  snapshot.platform === 'Twitter/X' ? 'X' : snapshot.platform
                }, plus the post itself.`
              : `The post came through, but ${
                  snapshot.platform === 'Twitter/X' ? 'X' : snapshot.platform
                } published no engagement figures for it.`}
          </p>

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
      <m.section variants={fadeUp}>
        <SectionTitle hint="Read straight from the platform. Tap any figure to correct it.">
          How it landed
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label={metricLabel}
            metric={eng.likes}
            icon={<Heart size={12} />}
            onEdit={onEditMetric}
          />
          <StatTile
            label="Comments"
            metric={eng.comments}
            icon={<MessageCircle size={12} />}
            onEdit={onEditMetric}
          />
          <StatTile
            label="Shares"
            metric={eng.shares}
            icon={<Repeat2 size={12} />}
            onEdit={onEditMetric}
          />
          <StatTile label="Views" metric={eng.views} icon={<Eye size={12} />} onEdit={onEditMetric} />
        </div>

        {eng.engagementRate != null && (
          <p className="mt-2 text-xs text-ink-3">
            {(eng.engagementRate * 100).toFixed(2)}% of people who saw it interacted with it.
          </p>
        )}
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
        <m.section variants={fadeUp}>
          <SectionTitle>Who posted it</SectionTitle>
          <Card>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
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
          </Card>
        </m.section>
      )}

      <m.p variants={fadeUp} className="text-center text-xs text-ink-3">
        Read from {snapshot.platform === 'Twitter/X' ? 'X' : snapshot.platform} in{' '}
        {(report.meta.durationMs / 1000).toFixed(1)}s
      </m.p>

      {/* ── Sticky action ───────────────────────────────────────────────── */}
      <div className="docked z-20 border-t border-[var(--border)] bg-[var(--surface-1)]/92 pb-3 pt-3 backdrop-blur-xl">
        <div className="shell shell-prose flex gap-2">
          <Button onClick={onReset} className="flex-1">
            Read another post
          </Button>
          <Button
            onClick={() => void downloadWorkbook([report])}
            variant="outline"
            aria-label="Download this report as a spreadsheet"
            className="shrink-0 px-4"
          >
            <Download size={16} />
            CSV
          </Button>
        </div>
      </div>
    </m.div>
  )
}

function Field({
  label,
  value,
  icon,
}: {
  label: string
  value: string | null
  icon?: React.ReactNode
}) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-medium">
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
    return `${who} — ${compact(views)} ${views === 1 ? 'view' : 'views'}, ${compact(interactions)} ${
      interactions === 1 ? 'interaction' : 'interactions'
    }`
  }
  if (interactions > 0) {
    return `${who} — ${compact(interactions)} ${interactions === 1 ? 'interaction' : 'interactions'}`
  }
  return `${who} — post read in full`
}

/** Kept exported for the type, so a Metric change here fails loudly. */
export type { Metric }
