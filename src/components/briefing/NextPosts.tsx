import { useEffect, useState } from 'react'
import { Check, Lightbulb, Loader2, Plus, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { Button, Card, Chip } from '../ui'
import { PlatformBadge } from '@/components/kit'
import type { NextCard } from '@/lib/briefing'
import {
  loadPostPlan,
  planReady,
  readPlanCache,
  type PlanInput,
  type PlanResult,
  type PostPlan,
} from '@/lib/post-plan'
import { fileStepsAction } from '@/lib/actions'
import { cn } from '@/lib/utils'

/**
 * What to post next — the worked-out weekly plan, not a row of one-liners.
 *
 * Each card is one move: why it earns trust or reach (citing the desk's own
 * numbers and the public's own words), the steps in the order a staffer
 * would do them, a draft to start from with [blanks] where a real fact must
 * be filled in, and a button that files the whole thing onto the task list.
 *
 * The plan is drafted once per day per desk and cached; the arithmetic
 * one-liners survive only as the fallback for a desk that cannot reach the
 * model, because a dashboard should degrade to terse, never to blank.
 */

const PLAN_CHANNEL = {
  Instagram: 'Instagram',
  Facebook: 'Official Facebook page',
  'Twitter/X': 'Official X handle',
} as const

function channelOf(platform: string): 'Instagram' | 'Official Facebook page' | 'Official X handle' {
  return PLAN_CHANNEL[platform as keyof typeof PLAN_CHANNEL] ?? 'Official X handle'
}

/**
 * Last time's scoreboard, ahead of this week's plan: what worked and what
 * failed, from the same measured arithmetic the plans are drafted from. The
 * plan says where to go; this says where you came from, and a plan read
 * without its failures reads as flattery.
 */
function LastTime({ input }: { input: PlanInput }) {
  const { working, notLanding } = input.lands
  if (working.length === 0 && notLanding.length === 0) return null
  return (
    <Card>
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {working.length > 0 && (
          <div>
            <p className="kicker flex items-center gap-1.5 text-[var(--pos)]">
              <ThumbsUp size={12} aria-hidden />
              Worked last time
            </p>
            <ul className="mt-2 space-y-2.5">
              {working.map((f) => (
                <li key={`${f.kind}-${f.label}`}>
                  <p className="text-sm font-semibold leading-snug">{f.label}</p>
                  <p className="tnum mt-0.5 text-xs leading-relaxed text-ink-3">{f.evidence}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
        {notLanding.length > 0 && (
          <div>
            <p className="kicker flex items-center gap-1.5 text-[var(--neg)]">
              <ThumbsDown size={12} aria-hidden />
              Did not land
            </p>
            <ul className="mt-2 space-y-2.5">
              {notLanding.map((f) => (
                <li key={`${f.kind}-${f.label}`}>
                  <p className="text-sm font-semibold leading-snug">{f.label}</p>
                  <p className="tnum mt-0.5 text-xs leading-relaxed text-ink-3">{f.evidence}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}

function PlanCard({ plan }: { plan: PostPlan }) {
  const [filed, setFiled] = useState(false)

  const file = (): void => {
    fileStepsAction({
      title: plan.title,
      steps: [...plan.steps, ...(plan.draft ? [`Post it: ${plan.draft}`] : [])],
      priority: plan.priority,
      channel: channelOf(plan.platform),
      source: {
        id: `post-plan-${plan.title.slice(0, 50)}`,
        headline: 'From the weekly content plan',
        raisedFrom: 'dashboard',
      },
    })
    setFiled(true)
  }

  return (
    <Card className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2">
        {plan.priority === 'High' && <Chip tone="warning">High priority</Chip>}
        {plan.platform !== 'All' ? (
          <Chip icon={<PlatformBadge platform={plan.platform} size={14} />}>{plan.platform}</Chip>
        ) : (
          <Chip>Every platform</Chip>
        )}
      </div>

      <h3 className="mt-2.5 text-[16px] font-bold leading-snug">{plan.title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{plan.why}</p>

      <ol className="mt-3.5 space-y-2 border-t border-[var(--rule)] pt-3.5">
        {plan.steps.map((step, i) => (
          <li key={step} className="flex items-start gap-2.5">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] font-bold text-[var(--accent)]">
              {i + 1}
            </span>
            <span className="text-sm leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>

      {plan.draft && (
        <blockquote className="mt-3.5 rounded-[var(--radius-md)] border-l-2 border-[var(--accent-2)] bg-[var(--accent-2-soft)] px-3.5 py-2.5 text-sm leading-relaxed text-ink-2">
          {plan.draft}
        </blockquote>
      )}

      <div className="mt-auto pt-4">
        {filed ? (
          <span className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--pos)_35%,transparent)] bg-[var(--pos-soft)] px-3.5 text-sm font-medium text-[var(--pos)]">
            <Check size={15} aria-hidden />
            On the task list
          </span>
        ) : (
          <Button size="sm" variant="outline" onClick={file}>
            <Plus size={15} />
            Add to tasks
          </Button>
        )}
      </div>
    </Card>
  )
}

export function NextPosts({ cards, input }: { cards: NextCard[]; input: PlanInput }) {
  const [plan, setPlan] = useState<PlanResult | null>(readPlanCache)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const draft = (force = false): void => {
    if (busy || !planReady(input)) return
    setBusy(true)
    setError(null)
    loadPostPlan(input, force)
      .then(setPlan)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'The plan could not be drafted.'),
      )
      .finally(() => setBusy(false))
  }

  // Draft on arrival when today has no plan yet. Once per day per desk: the
  // cache is the gate, so revisits and re-renders cost nothing.
  useEffect(() => {
    if (!plan && planReady(input)) draft()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (plan) {
    return (
      <div className="stack-tight">
        <LastTime input={input} />
        <div className={cn('grid items-stretch gap-4 lg:grid-cols-2')}>
          {plan.plans.map((p) => (
            <PlanCard key={p.title} plan={p} />
          ))}
        </div>
        <button
          type="button"
          onClick={() => draft(true)}
          className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-ink-3 hover:text-ink-2"
          disabled={busy}
        >
          {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <RefreshCw size={12} aria-hidden />}
          {busy ? 'Redrafting…' : 'Draft it again'}
        </button>
      </div>
    )
  }

  if (busy) {
    return (
      <div className="stack-tight">
        <LastTime input={input} />
        <Card>
          <p className="flex items-center gap-2.5 text-sm text-ink-2">
            <Loader2 size={15} className="animate-spin" aria-hidden />
            Drafting this week&rsquo;s plan from your numbers…
          </p>
        </Card>
      </div>
    )
  }

  // The arithmetic one-liners: the fallback when the model is unreachable,
  // never the destination.
  return (
    <div className="stack-tight">
      <LastTime input={input} />
      {error && (
        <Card>
          <p className="text-sm leading-relaxed text-[var(--neg)]">{error}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => draft(true)}>
            <RefreshCw size={14} />
            Draft the plan
          </Button>
        </Card>
      )}
      {cards.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <li key={card.line}>
              <Card className="h-full">
                <span
                  className="icon-badge icon-badge-sm"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <Lightbulb size={16} aria-hidden />
                </span>
                <p className="mt-3 text-[15px] font-bold leading-snug">{card.line}</p>
                <p className="tnum mt-1.5 text-xs leading-relaxed text-ink-3">{card.evidence}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {cards.length === 0 && !error && (
        <Card>
          <p className="text-[15px] font-bold">Not enough measured posts yet</p>
        </Card>
      )}
    </div>
  )
}
