import { useEffect, useMemo, useRef } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import {
  Eye,
  Heart,
  Info,
  MapPin,
  MessageCircle,
  Quote,
  Repeat2,
  RotateCcw,
  ShieldQuestion,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import type { Report } from '@shared/types'
import { Button, Card, Chip, SectionTitle, type ChipTone } from '../ui'
import { EmotionBars, SentimentMeter } from '../charts'
import { CardHead, DonutBreakdown, IndiaMap, type MapMarker } from '@/components/kit'
import { geocodePlace } from '@/components/gazetteer'
import { INDIA_DOTS, INDIA_BBOX } from '@/components/india-dots'
import { PostCard } from './PostCard'
import { DataReport, MetricStat } from './DataReport'
import { CommentsPanel } from './CommentsPanel'
import { CivicPanel } from './CivicPanel'
import { ExtractionNotice } from './ExtractionNotice'
import { compact, cn } from '@/lib/utils'
import { downloadCsv, downloadWorkbook } from '@/lib/export'
import { ExportButton } from '@/components/ExportButton'
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
  celebrate = true,
}: {
  report: Report
  onReset: () => void
  onEditMetric?: () => void
  /**
   * Whether finishing this report is a moment worth marking.
   *
   * True on the analyse screen, where the reader waited for it. False when the
   * same component is embedded somewhere reports are merely listed — the
   * dashboard's post highlights expand one inline, and confetti over a row
   * filed under "What drew criticism" celebrates a post that landed badly.
   */
  celebrate?: boolean
}) {
  const { snapshot, analysis } = report
  const heroRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  // One celebration per session, on the landmark moment. Scarcity is the whole
  // point: if every action confettis, none of them mean anything.
  useEffect(() => {
    if (reduced || !celebrate) return
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

  // Presentational derivations only — nothing here fetches or changes state, it
  // just re-shapes fields the report already carries into map pins and a ring.
  // Placed before the data-only early return so the hook order never varies.

  // The places this post is about, geocoded onto the India map. A place that
  // will not resolve in the gazetteer is dropped, never guessed onto the map;
  // tone follows the post's own sentiment so the pins read at a glance.
  const placeMarkers = useMemo<MapMarker[]>(() => {
    if (!analysis) return []
    const s = analysis.sentiment.score
    const tone: MapMarker['tone'] = s > 12 ? 'positive' : s < -12 ? 'negative' : 'accent'
    const seen = new Set<string>()
    const out: MapMarker[] = []
    const add = (raw: string, detail?: string | null) => {
      const g = geocodePlace(raw)
      if (!g || seen.has(g.name)) return
      seen.add(g.name)
      out.push({ lon: g.lon, lat: g.lat, label: g.name, detail: detail || g.state, tone, weight: 0.6 })
    }
    analysis.reach.places.forEach((p) => add(p))
    analysis.entities.filter((e) => e.kind === 'place').forEach((e) => add(e.name, e.role))
    return out
  }, [analysis])

  // The credibility signals split into for/against, for the ring beside the list.
  const signalSplit = useMemo(() => {
    const sig = analysis?.credibility.signals ?? []
    return {
      supports: sig.filter((s) => s.direction === 'supports').length,
      undermines: sig.filter((s) => s.direction === 'undermines').length,
      total: sig.length,
    }
  }, [analysis])

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
        {/* The one lifted panel on this screen — everything else stays level. */}
        <Card tone="accent" className="grain" level="lift">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="accent" icon={<Sparkles size={12} />}>
              {analysis.topics.primary}
            </Chip>
            {analysis.civic && <Chip tone="warning">Civic</Chip>}
            <ConfidenceChip tier={analysis.confidence} />
          </div>

          {/* One size down at phone width: a 30px display line at 375px broke
              long headlines into five rows and pushed the summary below the
              fold. Scales back up from sm. */}
          <h1 className="hed mt-3 text-2xl sm:text-3xl">{analysis.headline}</h1>

          <p className="mt-3 text-base leading-relaxed text-ink-2">
            {analysis.summary}
          </p>

          {analysis.intent && (
            <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3">
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
      <m.section variants={fadeUp} aria-label="How it landed">
        {/* One card, opened the reference way — icon badge, bold title, quiet
            sub — with the stat blocks inset on the card. The old section hint
            survives whole as the card's footnote: CardHead's sub line
            truncates on a phone, and that sentence is the honesty contract. */}
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

          {eng.engagementRate != null && (
            <p className="mt-1.5 text-xs text-ink-3">
              <span className="tnum font-semibold text-ink-2">
                {(eng.engagementRate * 100).toFixed(2)}%
              </span>{' '}
              of people who saw it interacted with it.
            </p>
          )}
        </Card>
      </m.section>

      {/* ── Sentiment ───────────────────────────────────────────────────── */}
      <m.section variants={fadeUp}>
        <SectionTitle
          hint={
            (report.snapshot.comments?.length ?? 0) > 0
              ? `From ${report.snapshot.comments!.length} comments on this post`
              : 'From the post itself'
          }
        >
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
          <SectionTitle
            hint={
              (report.snapshot.comments?.length ?? 0) > 0
                ? 'What the audience feels, from the comments'
                : 'The register of the post itself'
            }
          >
            Emotion
          </SectionTitle>
          <Card>
            <EmotionBars emotions={analysis.emotions} />
          </Card>
        </m.section>
      )}

      {/* ── Themes ──────────────────────────────────────────────────────── */}
      {(analysis.topics.subtopic ||
        analysis.topics.secondary.length > 0 ||
        analysis.topics.tags.length > 0) && (
        <m.section variants={fadeUp} className="defer-paint">
          <SectionTitle>Themes</SectionTitle>
          <Card>
            <div className="flex flex-wrap gap-1.5">
              <Chip tone="accent" icon={<Sparkles size={12} />}>
                {analysis.topics.primary}
              </Chip>
              {analysis.topics.subtopic && <Chip tone="info">{analysis.topics.subtopic}</Chip>}
              {analysis.topics.secondary.map((t) => (
                <Chip key={t} tone="neutral">
                  {t}
                </Chip>
              ))}
              {analysis.topics.tags.map((tag) => (
                <Chip key={tag} tone="accent">
                  {tag.startsWith('#') ? tag : `#${tag}`}
                </Chip>
              ))}
            </div>
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
          <SectionTitle>
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
          <SectionTitle>People and places</SectionTitle>
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
                    <p className="text-sm font-medium leading-snug">
                      {e.kind === 'place' && (
                        <MapPin
                          size={12}
                          aria-hidden
                          className="-mt-0.5 mr-1 inline-block text-[var(--accent)]"
                        />
                      )}
                      {e.name}
                    </p>
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
        <SectionTitle>Reach</SectionTitle>
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
              people plausibly saw this.
            </p>
          )}

          {/* Where it landed. A pin is dropped only for a name the gazetteer
              can place; anything it cannot is left off the map but still listed
              as a chip below, so the map's honesty costs the reader nothing. */}
          {placeMarkers.length > 0 && (
            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-3 sm:p-4">
              <CardHead
                icon={<MapPin size={14} />}
                title="Where this landed"
                sub={`${placeMarkers.length} ${placeMarkers.length === 1 ? 'place' : 'places'}`}
                tint="teal"
                className="mb-2"
              />
              <IndiaMap
                dots={INDIA_DOTS}
                bbox={INDIA_BBOX}
                markers={placeMarkers}
                className="mx-auto max-w-[420px]"
              />
            </div>
          )}

          {analysis.reach.places.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {analysis.reach.places.map((p) => {
                const geo = geocodePlace(p)
                return (
                  <Chip key={p} tone="neutral" icon={geo ? <MapPin size={11} /> : undefined}>
                    {p}
                  </Chip>
                )
              })}
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
        <SectionTitle>Credibility</SectionTitle>
        <Card>
          {/* The reference card opening: badge, question, and the verdict chip
              riding the action slot — same words, same chip, same logic. */}
          <CardHead
            icon={<ShieldQuestion size={15} />}
            title="Looks false?"
            tint="orange"
            className="mb-0"
            action={
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
            }
          />

          {analysis.credibility.signals.length > 0 && (
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              {/* Wraps at phone width: ring 88px + a 200px floor for the list
                  cannot share 375px, so the list drops below the ring instead
                  of squeezing the signal text into a sliver. */}
              <div className="flex flex-wrap items-start gap-4">
                {/* The for/against balance as a ring — the same signals, counted,
                    so the reader sees the shape before reading each line. */}
                {(signalSplit.supports > 0 || signalSplit.undermines > 0) && (
                  <DonutBreakdown
                    size={88}
                    thickness={12}
                    segments={[
                      { label: 'Supports', value: signalSplit.supports, color: 'var(--pos)' },
                      { label: 'Undermines', value: signalSplit.undermines, color: 'var(--warn)' },
                    ]}
                    centerLabel={String(signalSplit.total)}
                    centerSub={signalSplit.total === 1 ? 'signal' : 'signals'}
                    className="mx-auto shrink-0 sm:mx-0"
                  />
                )}
                <ul className="min-w-[200px] flex-1 space-y-2">
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
              </div>
            </div>
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

      {/* Bottom-anchored primary action, inside the thumb zone. */}
      <div className="docked z-20 border-t border-[var(--border)] bg-[var(--bg)]/90 py-3 backdrop-blur-md no-print">
        <div className="shell shell-prose flex gap-2">
          <Button variant="primary" onClick={onReset} className="flex-1">
            <RotateCcw size={16} />
            Analyse another post
          </Button>
          {/* The product replaces a spreadsheet, so getting a row back out of
              it is not a nice-to-have — it is how this fits their process. */}
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
