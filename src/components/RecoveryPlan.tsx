import { useCallback, useState } from 'react'
import { ArrowRight, Ban, Check, ListChecks, ListPlus, Loader2, LifeBuoy, Search, TriangleAlert } from 'lucide-react'
import { Button, Card, Chip, type ChipTone } from './ui'
import { CardHead } from '@/components/kit'
import { fileFreeAction } from '@/lib/actions'
import { actionIdForSource, requestActionFocus } from '@/lib/focus'
import { readStore } from '@/lib/store'
import type { OpinionSurvey } from '@/lib/opinion'
import { cn } from '@/lib/utils'
import { fetchWithTimeout } from '@/lib/net'

/**
 * What to do about a negative score.
 *
 * The opinion panel ends at the diagnosis: here is what is said against you,
 * here is how loud it is. An office reading that already knew most of it. The
 * question they actually have is which of these is worth answering this week
 * and how, and that question was left on the floor.
 *
 * So this appears only when the reading is negative, reads the criticisms back
 * the other way round, and produces steps that file straight into the task
 * list. Nothing here is a second opinion pass: it reasons over the criticism
 * already gathered, so it is one model call, about five seconds, and no extra
 * search.
 *
 * THE TALKING POINTS ARE DRAFTS, and the screen says so rather than implying
 * otherwise. Measured against real criticisms, the generator mostly obeys the
 * instruction not to invent specifics and writes fill-in blanks like "[name the
 * scheme]" where a fact is needed. Mostly is not always: it produced "benefiting
 * 5,000 families" unprompted, and a figure like that going out under a member's
 * name because a screen presented it as approved copy is the one failure this
 * feature could cause that actually matters. A person checks before anything is
 * said aloud, and the wording here is built to make that obvious.
 */

interface RecoveryStep {
  action: string
  rationale: string
  channel: string | null
  talkingPoints: string[]
  priority: 'Critical' | 'High' | 'Medium' | 'Low'
  /** 1-based index into the criticism list, or 0 for none. */
  answers: number
}

interface RecoveryCause {
  issue: string
  kind: 'substance' | 'perception' | 'both' | 'unclear'
  why: string
  founded: 'looks founded' | 'looks contested' | 'looks unfounded' | 'cannot tell'
}

interface Plan {
  reading: string
  causes: RecoveryCause[]
  steps: RecoveryStep[]
  avoid: string[]
}

/** Substance means do something; perception means say something. */
const KIND_LABEL: Record<RecoveryCause['kind'], string> = {
  substance: 'Needs something done',
  perception: 'Needs explaining',
  both: 'Needs both',
  unclear: 'Not clear yet',
}

const KIND_TONE: Record<RecoveryCause['kind'], ChipTone> = {
  substance: 'negative',
  perception: 'warning',
  both: 'negative',
  unclear: 'neutral',
}

const FOUNDED_TONE: Record<RecoveryCause['founded'], ChipTone> = {
  'looks founded': 'negative',
  'looks contested': 'warning',
  'looks unfounded': 'positive',
  'cannot tell': 'neutral',
}

const PRIORITY_TONE: Record<RecoveryStep['priority'], ChipTone> = {
  Critical: 'negative',
  High: 'warning',
  Medium: 'neutral',
  Low: 'neutral',
}

/** Soft badge tints for the stepper — one voice per priority. */
const PRIORITY_BADGE: Record<RecoveryStep['priority'], { bg: string; fg: string }> = {
  Critical: { bg: 'var(--neg-soft)', fg: 'var(--neg)' },
  High: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  Medium: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  Low: { bg: 'var(--surface-3)', fg: 'var(--text-2)' },
}

export function RecoveryPlan({
  survey,
  person,
  onOpenActions,
}: {
  survey: OpinionSurvey
  person: { name: string; role?: string | null; constituency?: string | null; party?: string | null }
  /** Route to the task list, so a filed step can be looked at. */
  onOpenActions?: () => void
}) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filed, setFiled] = useState<Set<number>>(new Set())

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetchWithTimeout('/api/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: person.name,
          role: person.role ?? null,
          constituency: person.constituency ?? null,
          party: person.party ?? null,
          score: survey.score,
          verdict: survey.verdict,
          criticism: survey.criticism,
          praise: survey.praise,
          controversies: survey.controversies,
        }),
      })
      const body = await res.text()
      let parsed: (Plan & { error?: string }) | null = null
      try {
        parsed = JSON.parse(body) as Plan & { error?: string }
      } catch {
        setError('The plan took too long to write. Try again.')
        return
      }
      if (!res.ok || parsed.error || !parsed.steps) {
        setError(parsed.error ?? 'The plan could not be written.')
        return
      }
      setPlan(parsed)
      setFiled(new Set())
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }, [person, survey])

  /** Stable per step, so a filed step can be found again in the store. */
  const stepSourceId = (i: number): string =>
    `recovery-${person.name.toLowerCase().replace(/\s+/g, '-')}-${i}`

  /** File one step as a task. Idempotent per step, so a double tap is safe. */
  const addStep = useCallback(
    (step: RecoveryStep, i: number) => {
      const answered = step.answers > 0 ? survey.criticism[step.answers - 1]?.label ?? null : null
      const ok = fileFreeAction({
        action: step.action,
        rationale: step.rationale,
        talkingPoints: step.talkingPoints,
        priority: step.priority,
        // The generator is held to the app's own channel vocabulary, but a step
        // that is work rather than words has no channel and still needs one
        // here; the office can change it.
        channel: (step.channel ?? 'Field visit') as Parameters<typeof fileFreeAction>[0]['channel'],
        source: {
          // Stable per step, so filing the same plan twice does not duplicate.
          id: stepSourceId(i),
          headline: answered ? `Answer: ${answered}` : 'Repair standing',
          subject: person.name,
          raisedFrom: 'recovery plan',
        },
      })
      setFiled((prev) => new Set(prev).add(i))
      return ok
    },
    [person, survey],
  )

  if (!plan) {
    return (
      <Card level="quiet">
        <CardHead
          icon={<LifeBuoy size={16} aria-hidden />}
          tint="blue"
          /* Named source, not "the reading". This card is driven by the press
             coverage survey alone, and on a desk whose COMMENTS are warm the
             bare phrase sat two cards under "People are warm about you"
             flatly contradicting it. Coverage and comments genuinely can
             disagree; the card has to say which one it is reading. */
          title="The press coverage reads negative"
          sub="Work out what is driving the stories"
        />
        <Button className="mt-4" onClick={() => void run()} disabled={busy}>
          {busy ? (
            <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <LifeBuoy size={15} />
          )}
          {busy ? 'Working it out…' : 'Make a plan'}
        </Button>
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-[var(--neg)]">
            {error}
          </p>
        )}
      </Card>
    )
  }

  return (
    <div className="stack-tight">
      <Card level="lift">
        <CardHead
          icon={<TriangleAlert size={16} aria-hidden />}
          tint="orange"
          title="What is actually wrong"
        />
        <p className="measure text-base leading-relaxed">{plan.reading}</p>
      </Card>

      {plan.causes.length > 0 && (
        <Card>
          <CardHead
            icon={<Search size={16} aria-hidden />}
            tint="violet"
            title="Root cause of each complaint"
          />
          <ul className="space-y-2.5">
            {plan.causes.map((c) => (
              <li
                key={c.issue}
                className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3.5"
              >
                <p className="text-sm font-semibold text-ink">{c.issue}</p>
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  <Chip tone={KIND_TONE[c.kind]}>{KIND_LABEL[c.kind]}</Chip>
                  <Chip tone={FOUNDED_TONE[c.founded]}>{c.founded}</Chip>
                </p>
                <p className="measure mt-1.5 text-sm leading-relaxed text-ink-2">{c.why}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHead
          icon={<ListChecks size={16} aria-hidden />}
          tint="blue"
          title="What to do"
          sub="Most important first"
        />

        {/* The plan as a stepper: numbered badges joined by a line, so the
            order — most important first — is carried by the drawing, not
            just the sentence above it. */}
        <ol className="mt-1">
          {plan.steps.map((step, i) => {
            const answered = step.answers > 0 ? survey.criticism[step.answers - 1]?.label : null
            const done = filed.has(i)
            const badge = PRIORITY_BADGE[step.priority]
            const last = i === plan.steps.length - 1
            return (
              <li key={`${step.action}-${i}`} className={cn('relative pl-[52px]', !last && 'pb-6')}>
                {/* The connecting line, drawn behind the badges. */}
                {!last && (
                  <span
                    aria-hidden
                    className="absolute bottom-0 left-[19px] top-11 w-0.5 rounded-full bg-[var(--border)]"
                  />
                )}
                <span
                  aria-hidden
                  className="icon-badge absolute left-0 top-0 rounded-full text-sm font-bold"
                  style={
                    done
                      ? { background: 'var(--pos)', color: 'var(--surface)' }
                      : { background: badge.bg, color: badge.fg }
                  }
                >
                  {done ? <Check size={17} strokeWidth={3} /> : i + 1}
                </span>

                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{step.action}</p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Chip tone={PRIORITY_TONE[step.priority]}>{step.priority}</Chip>
                      {step.channel && <Chip tone="neutral">{step.channel}</Chip>}
                      {answered && (
                        <span className="truncate text-xs text-ink-3">answers: {answered}</span>
                      )}
                    </p>
                    <p className="measure mt-2 text-sm leading-relaxed text-ink-2">
                      {step.rationale}
                    </p>
                  </div>

                  {/* Once filed, the useful control is the way back to it,
                      not a disabled label saying it happened. */}
                  {done ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!onOpenActions}
                      onClick={() => {
                        const id = actionIdForSource(readStore().actions, stepSourceId(i))
                        if (id) requestActionFocus(id)
                        onOpenActions?.()
                      }}
                    >
                      <ArrowRight size={14} />
                      Check the task
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => addStep(step, i)}>
                      <ListPlus size={14} />
                      Add to tasks
                    </Button>
                  )}
                </div>

                {step.talkingPoints.length > 0 && (
                  <div className="mt-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3">
                    {/* Drafts, and it says so. See the note at the top of this
                        file: the generator has been caught inventing a figure,
                        and these go out under a member's name. */}
                    <p className="eyebrow">
                      Draft lines: check every fact before saying any of it
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {step.talkingPoints.map((t, j) => (
                        <li key={j} className="measure text-sm leading-relaxed text-ink-2">
                          &ldquo;{t}&rdquo;
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </Card>

      {plan.avoid.length > 0 && (
        <Card>
          <CardHead
            icon={<Ban size={16} aria-hidden />}
            tint="orange"
            title="What not to do"
            sub="Moves that would make it worse"
          />
          <ul className="space-y-2.5">
            {plan.avoid.map((a) => (
              <li key={a} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-2">
                <span
                  aria-hidden
                  className="icon-badge icon-badge-sm shrink-0"
                  style={{ background: 'var(--neg-soft)', color: 'var(--neg)' }}
                >
                  <TriangleAlert size={14} />
                </span>
                <span className="measure pt-1">{a}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void run()} disabled={busy}>
          {busy ? (
            <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <LifeBuoy size={14} />
          )}
          Work it out again
        </Button>
        {filed.size > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--pos-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--pos)]">
            <Check size={13} aria-hidden />
            {filed.size} {filed.size === 1 ? 'step' : 'steps'} on the task list
          </span>
        )}
      </div>
    </div>
  )
}
