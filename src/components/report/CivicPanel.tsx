import { useState } from 'react'
import * as m from 'motion/react-m'
import {
  AlertTriangle,
  Check,
  Copy,
  Landmark,
  Megaphone,
  Quote,
  ShieldAlert,
  Target,
  Zap,
} from 'lucide-react'
import type { CivicReading } from '@shared/types'
import { ACTION_PRIORITIES, RISK_LEVELS, SEVERITIES } from '@shared/taxonomy'
import { Card, Chip, SectionTitle, type ChipTone } from '../ui'
import { CardHead } from '@/components/kit'
import { LevelPips } from '../charts'
import { listItem, listStagger, spring } from '@/lib/motion'
import { haptic } from '@/lib/motion'

/**
 * The civic layer. Rendered only when the post actually concerns government,
 * public services or officials — a product launch gets none of this.
 *
 * The ordering is deliberate: what the issue is, how bad it is, then what to
 * do about it. Someone skimming on a phone between meetings should be able to
 * stop reading after the first card and still know whether it matters.
 */
export function CivicPanel({ civic }: { civic: CivicReading }) {
  const priorityTone: ChipTone =
    civic.actionPriority === 'Critical'
      ? 'negative'
      : civic.actionPriority === 'High'
        ? 'warning'
        : 'neutral'

  return (
    <section className="space-y-4">
      <SectionTitle>
        What this means for you
      </SectionTitle>

      {/* The issue, stated once, plainly. */}
      <Card tone={civic.actionPriority === 'Critical' ? 'accent' : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          {civic.isGrievance && (
            <Chip tone="warning" icon={<AlertTriangle size={12} />}>
              {civic.grievanceType}
            </Chip>
          )}
          <Chip tone="neutral" icon={<Target size={12} />}>
            Aimed at {civic.target}
          </Chip>
          <Chip tone={priorityTone} icon={<Zap size={12} />}>
            {civic.actionPriority} priority
          </Chip>
          <Chip tone={civic.priorityTag === 'Escalate' ? 'negative' : 'neutral'}>
            {civic.priorityTag}
          </Chip>
        </div>

        <p className="mt-3 text-lg font-semibold leading-snug tracking-[-0.011em]">
          {civic.issueDescription}
        </p>

        <p className="mt-2 text-sm text-ink-3">
          Reads as a {civic.narrativeCategory.toLowerCase()}.
        </p>
      </Card>

      {/* Severity and risk, as ordered pips rather than a colour to decode.
          Stacked at phone width: four 16px pips plus the level word need
          ~135px, and half a 375px card offers ~90px — side by side they
          clipped the one word the meter exists to show. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <LevelPips
            label="Severity"
            level={civic.severity}
            scale={SEVERITIES}
            tone={civic.severity === 'Critical' || civic.severity === 'High' ? 'negative' : 'warning'}
          />
        </Card>
        <Card>
          <LevelPips
            label="Risk to government"
            level={civic.riskToGovernment}
            scale={RISK_LEVELS}
            tone={civic.riskToGovernment === 'High' ? 'negative' : 'warning'}
          />
        </Card>
      </div>

      {civic.riskRationale && (
        <Card level="quiet">
          <div className="flex gap-2.5">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[var(--warn-soft)]">
              <ShieldAlert size={15} className="text-[var(--warn)]" />
            </span>
            <p className="text-sm leading-relaxed text-ink-2">
              {civic.riskRationale}
            </p>
          </div>
        </Card>
      )}

      {/* Recommended action — the step itself as a tinted row, so the eye
          lands on what to do before it reads why. */}
      <Card>
        <CardHead icon={<Zap size={15} />} title="Recommended action" sub="The step, then the channels" tint="blue" />

        <div className="flex items-start gap-3 rounded-[var(--radius-md)] bg-[var(--accent-soft)] p-3.5">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-white">
            <Zap size={15} aria-hidden />
          </span>
          <p className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-ink">
            {civic.suggestedAction}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip tone="accent">{civic.actionCategory}</Chip>
          {civic.suggestedChannels.map((c) => (
            <Chip key={c} tone="neutral" icon={<Megaphone size={11} />}>
              {c}
            </Chip>
          ))}
        </div>
      </Card>

      {/* Talking points — the single most copy-pasted thing in the report, so
          each one gets its own copy button rather than one for the block. */}
      {civic.talkingPoints.length > 0 && <TalkingPoints points={civic.talkingPoints} />}

      {civic.counterNarrative && (
        <Card>
          <CardHead icon={<Quote size={15} />} title="Suggested counter-narrative" tint="violet" />
          <div className="rounded-[var(--radius-md)] bg-[var(--accent-2-soft)] p-3.5">
            <p className="text-sm leading-relaxed text-ink-2">
              {civic.counterNarrative}
            </p>
          </div>
        </Card>
      )}

      {civic.governmentResponse.status !== 'Not checked' && (
        <Card>
          <CardHead
            icon={<Landmark size={15} />}
            title="Official response"
            tint="green"
            className="mb-0"
            action={
              <Chip tone={civic.governmentResponse.status === 'Yes' ? 'positive' : 'warning'}>
                {civic.governmentResponse.status}
              </Chip>
            }
          />
          {civic.governmentResponse.respondent && (
            <p className="mt-1.5 text-sm text-ink-3">
              {civic.governmentResponse.respondent}
            </p>
          )}
          {civic.governmentResponse.adequacy && (
            <div className="mt-2.5 flex items-center gap-2 border-t border-[var(--border)] pt-2.5">
              <span className="text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
                Adequacy
              </span>
              <span className="text-sm font-semibold text-ink-2">
                {civic.governmentResponse.adequacy}
              </span>
            </div>
          )}
        </Card>
      )}
    </section>
  )
}

function TalkingPoints({ points }: { points: string[] }) {
  const [copied, setCopied] = useState<number | null>(null)

  const copy = async (text: string, i: number) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(i)
      haptic.success()
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1800)
    } catch {
      /* clipboard can be blocked; the text is selectable regardless */
    }
  }

  return (
    <Card>
      <CardHead
        icon={<Megaphone size={15} />}
        title="Lines you can use"
        sub="Each one copies on its own"
        tint="violet"
        action={
          <span className="tnum shrink-0 rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-xs font-semibold text-ink-2">
            {points.length}
          </span>
        }
      />

      <m.ul className="space-y-2" variants={listStagger} initial="hidden" animate="show">
        {points.map((point, i) => (
          <m.li
            key={i}
            variants={listItem}
            className="group flex items-start gap-2.5 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3"
          >
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-2xs font-bold text-[var(--accent)]">
              {i + 1}
            </span>

            <p className="flex-1 text-sm leading-relaxed">{point}</p>

            {/* size-11: the copy target was 36px, under the 44px floor a
                thumb needs; negative margin keeps the row's optical height. */}
            <m.button
              onClick={() => copy(point, i)}
              whileTap={{ scale: 0.9 }}
              transition={spring.snap}
              aria-label={copied === i ? 'Copied' : 'Copy this line'}
              className="relative -m-2.5 grid size-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-3)] hover:text-ink"
            >
              {copied === i ? (
                <m.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring.pop}>
                  <Check size={15} className="text-[var(--pos)]" />
                </m.span>
              ) : (
                <Copy size={15} />
              )}
            </m.button>
          </m.li>
        ))}
      </m.ul>
    </Card>
  )
}
