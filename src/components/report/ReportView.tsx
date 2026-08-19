import { useEffect, useRef } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import {
  Eye,
  Heart,
  Info,
  MessageCircle,
  Quote,
  Repeat2,
  Download,
  RotateCcw,
  ShieldQuestion,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import type { Report } from '@shared/types'
import { Button, Card, Chip, SectionTitle, type ChipTone } from '../ui'
import { EmotionBars, SentimentMeter, StatTile } from '../charts'
import { PostCard } from './PostCard'
import { DataReport } from './DataReport'
import { CommentsPanel } from './CommentsPanel'
import { CivicPanel } from './CivicPanel'
import { ExtractionNotice } from './ExtractionNotice'
import { compact, cn } from '@/lib/utils'
import { downloadWorkbook } from '@/lib/export'
import { fadeUp, listItem, listStagger, spring, haptic } from '@/lib/motion'

/**
 * The finished report.
 *
 * Ordered by what a reader needs first: the one-line verdict, the post itself,
 * how it landed, what it says, then the deeper analysis. Someone who reads only
 * the first screen should still come away with the right impression.
 */
export function ReportView({
  report,
  onReset,
  onEditMetric,
}: {
  report: Report
  onReset: () => void
  onEditMetric?: () => void
}) {
  const { snapshot, analysis } = report
  const heroRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  // One celebration per session, on the landmark moment. Scarcity is the whole
  // point: if every action confettis, none of them mean anything.
  useEffect(() => {
    if (reduced) return
    const el = heroRef.current
    if (!el) return

    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const { default: confetti } = await import('canvas-confetti')
        if (cancelled) return
        const r = el.getBoundingClientRect()
        const lowEnd = document.documentElement.classList.contains('low-end')
        confetti({
          particleCount: lowEnd ? 0 : 70,
          spread: 70,
          startVelocity: 38,
          gravity: 1.1,
          scalar: 0.9,
          ticks: 120,
          origin: {
            x: (r.left + r.width / 2) / window.innerWidth,
            y: (r.top + r.height / 2) / window.innerHeight,
          },
          colors: ['#8B87FF', '#33C4E8', '#FF7AC6', '#34D399'],
          disableForReducedMotion: true,
        })
        haptic.celebrate()
      } catch {
        /* confetti is decoration; never let it break the report */
      }
    }, 260)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [reduced])

  const eng = snapshot.engagement
  const metricLabel = snapshot.platform === 'Facebook' ? 'Reactions' : 'Likes'

  // With no model in the loop there is nothing to interpret, and a page built
  // around interpretation would be mostly holes. DataReport is a different
  // page for a different deliverable, not this one with sections removed.
  if (!analysis) {
    return <DataReport report={report} onReset={onReset} onEditMetric={onEditMetric} />
  }

  return (
    <m.div
      className="shell shell-prose stack page-end"
      variants={listStagger}
      initial="hidden"
      animate="show"
    >
      {/* ── Verdict ─────────────────────────────────────────────────────── */}
      <m.div ref={heroRef} variants={fadeUp}>
        <Card tone="accent" className="grain">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="accent" icon={<Sparkles size={12} />}>
              {analysis.topics.primary}
            </Chip>
            {analysis.civic && <Chip tone="warning">Civic</Chip>}
            <ConfidenceChip tier={analysis.confidence} />
          </div>

          <h1 className="hed mt-3 text-3xl">{analysis.headline}</h1>

          <p className="mt-3 text-base leading-relaxed text-ink-2">
            {analysis.summary}
          </p>

          {analysis.intent && (
            <div className="mt-4 rounded-[--radius-md] bg-[var(--surface-2)] p-3">
              <p className="text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
                What it is trying to do
              </p>
              <p className="mt-1 text-sm leading-relaxed">{analysis.intent}</p>
            </div>
          )}
        </Card>
      </m.div>

      {/* Honest note about anything we could not fetch. */}
      <m.div variants={fadeUp}>
        <ExtractionNotice snapshot={snapshot} onEditMetric={onEditMetric} />
      </m.div>

      {/* ── The post ────────────────────────────────────────────────────── */}
      <m.div variants={fadeUp}>
        <PostCard snapshot={snapshot} />
      </m.div>

      {/* ── How it landed ───────────────────────────────────────────────── */}
      <m.section variants={fadeUp}>
        <SectionTitle hint="Measured figures are shown plainly. Anything we did not measure says so.">
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

      {/* ── Sentiment ───────────────────────────────────────────────────── */}
      <m.section variants={fadeUp}>
        <SectionTitle hint="How the post reads, and how the audience appears to be taking it.">
          Sentiment
        </SectionTitle>
        <Card>
          <SentimentMeter sentiment={analysis.sentiment} />

          {analysis.sentiment.publicNarrative !== 'NA' && (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
              <span className="text-sm text-ink-2">Audience reaction</span>
              <Chip tone="neutral">{analysis.sentiment.publicNarrative}</Chip>
            </div>
          )}
        </Card>
      </m.section>

      {/* ── Emotions ────────────────────────────────────────────────────── */}
      {analysis.emotions.length > 0 && (
        <m.section variants={fadeUp} className="defer-paint">
          <SectionTitle hint="The emotional register the post is written in.">Emotion</SectionTitle>
          <Card>
            <EmotionBars emotions={analysis.emotions} />
          </Card>
        </m.section>
      )}

      {/* ── What it says ────────────────────────────────────────────────── */}
      {analysis.keyPoints.length > 0 && (
        <m.section variants={fadeUp} className="defer-paint">
          <SectionTitle>What it says</SectionTitle>
          <Card>
            <m.ul className="space-y-3" variants={listStagger} initial="hidden" whileInView="show" viewport={{ once: true }}>
              {analysis.keyPoints.map((point, i) => (
                <m.li key={i} variants={listItem} className="flex gap-2.5">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  <p className="text-sm leading-relaxed">{point}</p>
                </m.li>
              ))}
            </m.ul>
          </Card>
        </m.section>
      )}

      {/* ── Quotes ──────────────────────────────────────────────────────── */}
      {analysis.notableQuotes.length > 0 && (
        <m.section variants={fadeUp} className="defer-paint">
          <SectionTitle hint="Reproduced exactly as written, so they can be quoted safely.">
            Worth quoting
          </SectionTitle>
          <div className="space-y-3">
            {analysis.notableQuotes.map((q, i) => (
              <Card key={i}>
                <Quote size={15} className="mb-2 text-[var(--accent)]" />
                <p className="text-base leading-relaxed">{q.original}</p>
                {q.translation && q.translation !== q.original && (
                  <p className="mt-2 border-l-2 border-[var(--border-strong)] pl-3 text-sm italic text-ink-3">
                    {q.translation}
                  </p>
                )}
              </Card>
            ))}
          </div>
        </m.section>
      )}

      {/* ── People and places ───────────────────────────────────────────── */}
      {analysis.entities.length > 0 && (
        <m.section variants={fadeUp} className="defer-paint">
          <SectionTitle hint="Who and what this post names.">People and places</SectionTitle>
          {/* A list, not a row of pills.
              A role is a phrase — "Beneficiaries of the annual pilgrimage" —
              and a chip is a single-line element, so squeezing one into the
              other truncated it mid-word on every entity that mattered. Here
              the name and its role each get room to wrap. */}
          <Card>
            <ul className="divide-y divide-[var(--border)]">
              {analysis.entities.map((e, i) => (
                <li
                  key={`${e.name}-${i}`}
                  className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-[7px] size-1.5 shrink-0 rounded-full',
                      e.stance === 'criticised' && 'bg-[var(--neg)]',
                      e.stance === 'praised' && 'bg-[var(--pos)]',
                      e.stance !== 'criticised' && e.stance !== 'praised' && 'bg-[var(--border-strong)]',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">{e.name}</p>
                    {e.role && (
                      <p className="mt-0.5 text-xs leading-snug text-ink-3">
                        {e.role}
                      </p>
                    )}
                  </div>
                  {(e.stance === 'criticised' || e.stance === 'praised') && (
                    <Chip tone={e.stance === 'criticised' ? 'negative' : 'positive'} className="mt-0.5">
                      {e.stance}
                    </Chip>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </m.section>
      )}

      {/* ── Reach ───────────────────────────────────────────────────────── */}
      <m.section variants={fadeUp} className="defer-paint">
        <SectionTitle hint="How far this is likely to travel, and who is pushing it.">
          Reach
        </SectionTitle>
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="info" icon={<TrendingUp size={12} />}>
              {analysis.reach.scope}
            </Chip>
            {analysis.reach.urbanRural !== 'Unknown' && (
              <Chip tone="neutral">{analysis.reach.urbanRural}</Chip>
            )}
            {analysis.reach.amplifiedByPoliticalActors && (
              <Chip tone="warning">Amplified by political accounts</Chip>
            )}
          </div>

          {analysis.reach.estimatedImpressions != null && (
            <p className="mt-3 text-sm text-ink-2">
              Estimated{' '}
              <span className="tnum font-semibold text-ink">
                {compact(analysis.reach.estimatedImpressions)}
              </span>{' '}
              people plausibly saw this.{' '}
              <span className="text-ink-3">This is a judgement, not a measurement.</span>
            </p>
          )}

          {analysis.reach.places.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {analysis.reach.places.map((p) => (
                <Chip key={p} tone="neutral">
                  {p}
                </Chip>
              ))}
            </div>
          )}

          {analysis.reach.amplifiers.length > 0 && (
            <p className="mt-3 text-sm text-ink-2">
              <span className="text-ink-3">Spreading via </span>
              {analysis.reach.amplifiers.join(', ')}
            </p>
          )}
        </Card>
      </m.section>

      {/* ── Credibility ─────────────────────────────────────────────────── */}
      <m.section variants={fadeUp} className="defer-paint">
        <SectionTitle hint="An angry post is not a false post. This only flags real signals.">
          Credibility
        </SectionTitle>
        <Card>
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-sm text-ink-2">
              <ShieldQuestion size={15} />
              Looks false?
            </span>
            <Chip
              tone={
                analysis.credibility.suspectedFalse === 'Yes'
                  ? 'negative'
                  : analysis.credibility.suspectedFalse === 'Likely'
                    ? 'warning'
                    : analysis.credibility.suspectedFalse === 'Unsure'
                      ? 'neutral'
                      : 'positive'
              }
            >
              {analysis.credibility.suspectedFalse}
            </Chip>
          </div>

          {analysis.credibility.signals.length > 0 && (
            <ul className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
              {analysis.credibility.signals.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span
                    className={cn(
                      'mt-1.5 size-1.5 shrink-0 rounded-full',
                      s.direction === 'supports' ? 'bg-[var(--pos)]' : 'bg-[var(--warn)]',
                    )}
                  />
                  <span className="text-ink-2">{s.signal}</span>
                </li>
              ))}
            </ul>
          )}

          {analysis.credibility.checkableClaims.length > 0 && (
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <p className="mb-2 text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
                Worth verifying
              </p>
              <ul className="space-y-2">
                {analysis.credibility.checkableClaims.map((c, i) => (
                  <li key={i} className="text-sm">
                    <p className="font-medium">{c.claim}</p>
                    <p className="text-ink-3">{c.why}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </m.section>

      {/* ── Civic ───────────────────────────────────────────────────────── */}
      {analysis.civic && (
        <m.div variants={fadeUp} className="defer-paint">
          <CivicPanel civic={analysis.civic} />
        </m.div>
      )}

      <CommentsPanel report={report} />

      {/* ── Observations ────────────────────────────────────────────────── */}
      {analysis.observations.length > 0 && (
        <m.section variants={fadeUp} className="defer-paint">
          <SectionTitle>Also worth knowing</SectionTitle>
          <Card>
            <ul className="space-y-2">
              {analysis.observations.map((o, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-ink-2">
                  <Info size={14} className="mt-0.5 shrink-0 text-ink-3" />
                  {o}
                </li>
              ))}
            </ul>
          </Card>
        </m.section>
      )}

      {/* ── Meta ────────────────────────────────────────────────────────── */}
      <m.div variants={fadeUp} className="pt-2 text-center">
        <p className="text-2xs text-ink-3">
          Analysed in {(report.meta.durationMs / 1000).toFixed(1)}s
          {report.meta.outputTokens ? ` · ${report.meta.outputTokens} tokens` : ''}
        </p>
      </m.div>

      {/* Bottom-anchored primary action, inside the thumb zone. */}
      <div className="docked z-20 border-t border-[var(--border)] bg-[var(--bg)]/90 py-3 backdrop-blur-md no-print">
        <div className="shell shell-prose flex gap-2">
          <Button variant="primary" onClick={onReset} className="flex-1">
            <RotateCcw size={16} />
            Analyse another post
          </Button>
          {/* The product replaces a spreadsheet, so getting a row back out of
              it is not a nice-to-have — it is how this fits their process. */}
          <Button
            variant="outline"
            onClick={() => void downloadWorkbook([report])}
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

function ConfidenceChip({ tier }: { tier: 'high' | 'medium' | 'low' }) {
  // Deliberately does not promise engagement numbers. A news article or an
  // e-paper has none to publish, so claiming we "read its engagement numbers"
  // would be false on exactly the sources where the tier is most often high.
  const map: Record<typeof tier, { tone: ChipTone; label: string; title: string }> = {
    high: {
      tone: 'positive',
      label: 'Full data',
      title: 'We read everything this source publishes.',
    },
    medium: {
      tone: 'warning',
      label: 'Partial data',
      title: 'We read the post, but some of what we wanted was unavailable.',
    },
    low: {
      tone: 'neutral',
      label: 'Limited data',
      title: 'This source gave us very little, so more of the report is judgement.',
    },
  }
  const c = map[tier]
  return (
    <Chip tone={c.tone} title={c.title}>
      {c.label}
    </Chip>
  )
}
