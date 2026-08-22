import { useState } from 'react'
import { ChevronRight, Loader2, RefreshCw, Scale, ThumbsDown, ThumbsUp, TriangleAlert } from 'lucide-react'
import type { OpinionSurvey, OpinionTheme } from '@/lib/opinion'
import { Button, Card, Chip } from './ui'
import { CardHead, DonutBreakdown, ProgressRow } from '@/components/kit'
import { RecoveryPlan } from './RecoveryPlan'
import { cn, relativeTime } from '@/lib/utils'

/**
 * What is being said about this person, read off the published record.
 *
 * The panel that answers the question the product is named for, in the case
 * that turns out to be the normal one: no readable comment section anywhere.
 * Facebook and Instagram publish nothing to a server, most members do not
 * administer their own page, and plenty have no channel of their own — so for
 * a great many offices every direct route to "what do people think" is shut.
 *
 * This is the indirect route: go and read what has been written. It produces
 * specific, actionable material — a named irrigation project she claims credit
 * for, a protocol dispute with a named minister, a demand for the Chief
 * Minister's resignation over a named remark — which is a different and more
 * useful thing than a sentiment percentage.
 *
 * The caveat is not decoration and is not tucked away. This reads journalists,
 * opponents and commentators, not constituents. A member who takes it for their
 * electorate will misread their own seat, so it says what it is on the face of
 * the panel and again under the score.
 */

const WEIGHT_LABEL: Record<OpinionTheme['weight'], string> = {
  dominant: 'the main thing said',
  frequent: 'comes up often',
  occasional: 'mentioned',
}

export function OpinionPanel({
  survey,
  person,
  onOpenActions,
  busy,
  stage,
  error,
  onRefresh,
}: {
  survey: OpinionSurvey | null
  /**
   * Who this is about. Only used to ask for a recovery plan, which needs the
   * name, seat and party to reason usefully. Optional so every existing
   * caller keeps working; without it the plan button does not appear, which
   * is correct rather than broken.
   */
  person?: { name: string; role?: string | null; constituency?: string | null; party?: string | null } | null
  /** Route to the task list, for steps filed out of the recovery plan. */
  onOpenActions?: () => void
  busy: boolean
  /** Which half is running. Half a minute of one spinner reads as a hang. */
  stage: 'searching' | 'reading' | null
  error: string | null
  onRefresh: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)

  if (busy && !survey) {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)]">
            <Loader2 size={17} className="animate-spin text-[var(--accent)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">
              {stage === 'reading'
                ? 'Making sense of what was found…'
                : 'Searching news, editorials and opposition statements…'}
            </p>
            <p className="mt-0.5 text-sm text-ink-2">
              {stage === 'reading'
                ? 'Sorting it into what you are credited with, attacked on, and disputing.'
                : 'Reading the published record. About twenty seconds.'}
            </p>
          </div>
        </div>
      </Card>
    )
  }

  if (!survey || (!survey.verdict && survey.praise.length + survey.criticism.length === 0)) {
    return (
      <Card>
        <p className="text-[15px] font-semibold">Nothing has been read yet</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">
          {error ??
            'This reads the published record: news, editorials, what opponents have said. It reports what is actually being claimed about you.'}
        </p>
        <Button size="sm" className="mt-3" onClick={onRefresh}>
          <RefreshCw size={15} />
          Read it now
        </Button>
      </Card>
    )
  }

  const groups: { key: string; title: string; items: OpinionTheme[]; tone: 'pos' | 'neg' | 'warn' }[] =
    [
      {
        key: 'criticism',
        title: 'What they attack you on',
        items: survey.criticism,
        tone: 'neg' as const,
      },
      {
        key: 'controversies',
        title: 'Live disputes',
        items: survey.controversies,
        tone: 'warn' as const,
      },
      {
        key: 'praise',
        title: 'What you get credit for',
        items: survey.praise,
        tone: 'pos' as const,
      },
    ].filter((g) => g.items.length > 0)

  const colour = { pos: 'var(--pos)', neg: 'var(--neg)', warn: 'var(--warn)' } as const
  const Icon = { pos: ThumbsUp, neg: ThumbsDown, warn: TriangleAlert } as const

  // The count of gathered themes, re-used by the ring and the share bars below.
  const themeTotal =
    survey.criticism.length + survey.controversies.length + survey.praise.length

  return (
    <div className="stack-tight">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-lg font-semibold leading-snug tracking-[-0.015em]">
            {survey.verdict || 'Coverage read.'}
          </p>
          <Chip
            tone={
              survey.confidence === 'well-covered'
                ? 'positive'
                : survey.confidence === 'moderate'
                  ? 'neutral'
                  : 'warning'
            }
          >
            {survey.confidence === 'well-covered'
              ? 'heavily covered'
              : survey.confidence === 'moderate'
                ? 'some coverage'
                : 'thinly covered'}
          </Chip>
        </div>

        {/* Said on the face of it, not in a footnote. Mistaking this for a poll
            is the one misreading that would actually cost a member something. */}
        <p className="mt-2 text-xs leading-relaxed text-ink-3">
          Read from {survey.sources.length} published sources: journalists, opponents and
          commentators. This is not a survey of your constituents.
          {survey.readAt ? ` Read ${relativeTime(survey.readAt)}.` : ''}
        </p>

        {/* The balance of what was found — nothing new, just the three theme
            lists this panel already renders, counted into one ring. Colours
            match the group headers below, so the ring is a table of contents
            rather than a second opinion. */}
        {themeTotal > 0 && (
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <CardHead
              icon={<Scale size={14} />}
              title="The balance of coverage"
              sub="Counted from the theme lists below"
              tint="blue"
            />
            {/* The share column claims a real minimum width, so at 375px it
                wraps under the ring instead of crushing beside it. */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
              <DonutBreakdown
                size={96}
                thickness={13}
                segments={[
                  { label: 'Attacked on', value: survey.criticism.length, color: 'var(--neg)' },
                  { label: 'Disputed', value: survey.controversies.length, color: 'var(--warn)' },
                  { label: 'Credited for', value: survey.praise.length, color: 'var(--pos)' },
                ]}
                centerLabel={String(themeTotal)}
                centerSub={themeTotal === 1 ? 'theme' : 'themes'}
                className="mx-auto shrink-0 sm:mx-0"
              />
              <div className="min-w-[200px] flex-1 space-y-3">
                {(
                  [
                    { label: 'Attacked on', n: survey.criticism.length, c: 'var(--neg)' },
                    { label: 'Disputed', n: survey.controversies.length, c: 'var(--warn)' },
                    { label: 'Credited for', n: survey.praise.length, c: 'var(--pos)' },
                  ] as const
                )
                  .filter((r) => r.n > 0)
                  .map((r, i) => (
                    <ProgressRow
                      key={r.label}
                      label={r.label}
                      fraction={r.n / themeTotal}
                      detail={`${r.n} ${r.n === 1 ? 'theme' : 'themes'}`}
                      color={r.c}
                      delay={0.05 * i}
                    />
                  ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/*
        Only when the reading is actually negative, and only when there is a
        person to plan for.

        A repair plan offered against warm coverage would be the app inventing
        a problem to solve, and an office that sees "fix your reputation" on a
        good week learns to ignore the panel. The endpoint refuses on its own
        if no criticism was gathered, so this is the second of two gates.
      */}
      {person && survey.score != null && survey.score < 0 && survey.criticism.length > 0 && (
        <RecoveryPlan survey={survey} person={person} onOpenActions={onOpenActions} />
      )}

      {groups.map((group) => {
        const ThemeIcon = Icon[group.tone]
        return (
          <Card key={group.key} padded={false}>
            {/* Hand-rolled to CardHead's exact composition — badge, bold
                title, count pill in the action seat — but NOT CardHead
                itself: its tint set has no negative red, and these badges
                must stay the same colours as the ring's segments above or
                the "table of contents" linkage breaks. */}
            <div className="flex items-center justify-between gap-3 px-4 pt-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="icon-badge-sm"
                  style={{
                    background: `color-mix(in oklab, ${colour[group.tone]} 12%, transparent)`,
                    color: colour[group.tone],
                  }}
                >
                  <ThemeIcon size={14} aria-hidden />
                </span>
                <h3 className="min-w-0 text-[13px] font-semibold leading-tight">{group.title}</h3>
              </div>
              <span className="tnum shrink-0 rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-xs font-semibold text-ink-2">
                {group.items.length}
              </span>
            </div>

            <ul className="mt-2 divide-y divide-[var(--border)]">
              {group.items.map((theme) => {
                const id = `${group.key}-${theme.label}`
                const isOpen = open === id
                return (
                  <li key={id}>
                    <button
                      onClick={() => setOpen(isOpen ? null : id)}
                      aria-expanded={isOpen}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)]"
                    >
                      <span
                        aria-hidden
                        className="mt-1.5 size-1.5 shrink-0 rounded-full"
                        style={{ background: colour[group.tone] }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-snug">
                          {theme.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-3">
                          {WEIGHT_LABEL[theme.weight]}
                          {theme.who ? ` · ${theme.who}` : ''}
                        </span>
                        {isOpen && (
                          <span className="mt-2 block text-sm leading-relaxed text-ink-2">
                            {theme.detail}
                          </span>
                        )}
                      </span>
                      <ChevronRight
                        size={15}
                        aria-hidden
                        className={cn(
                          'mt-1 shrink-0 text-ink-3 transition-transform',
                          isOpen && 'rotate-90',
                        )}
                      />
                    </button>
                  </li>
                )
              })}
            </ul>
          </Card>
        )
      })}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {busy ? 'Reading…' : 'Read again'}
        </Button>
        {survey.caveats.slice(1).map((c) => (
          <p key={c} className="min-w-0 flex-1 text-xs leading-relaxed text-ink-3">
            {c}
          </p>
        ))}
      </div>
    </div>
  )
}
