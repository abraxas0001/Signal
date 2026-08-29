import { useEffect, useMemo, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import {
  Check,
  Crown,
  Lightbulb,
  Loader2,
  Plus,
  RefreshCw,
  Swords,
  Trophy,
} from 'lucide-react'
import { Avatar, Button, Card, Chip, Empty, PageHeader, Shell } from './ui'
import { CardHead, HBarBoard, PlatformBadge } from '@/components/kit'
import { Mascot } from './Mascot'
import { listHandles } from '@/lib/handles'
import {
  loadWeekAnalysis,
  readWeekAnalysisCache,
  rowFor,
  weekOf,
  type PersonWeek,
  type WeekAnalysis,
} from '@/lib/week'
import { fileFreeAction } from '@/lib/actions'
import { compact } from '@/lib/utils'
import { fadeUp, listStagger } from '@/lib/motion'

/**
 * The Explore page behind the dashboard's "Your week against theirs" card.
 *
 * Three answers, in reading order: who won the week (the board), how each
 * person actually played it (one card per person: their real top posts, and
 * the model's reading of their playbook), and what this office should copy
 * (lessons that file straight onto the task list). The model is grounded in
 * the same posts the board counts — nothing here is analysed that is not
 * also shown.
 */

export function WeekCompare({ onClose }: { onClose: () => void }) {
  const reduce = useReducedMotion() === true
  const handles = useMemo(() => listHandles(), [])
  const week = useMemo(() => weekOf(handles), [handles])

  const [analysis, setAnalysis] = useState<WeekAnalysis | null>(() =>
    week ? readWeekAnalysisCache(week.label) : null,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filed, setFiled] = useState<Set<string>>(new Set())

  const read = (force = false): void => {
    if (!week || busy) return
    setBusy(true)
    setError(null)
    loadWeekAnalysis(week, force)
      .then(setAnalysis)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'The reading failed. Try again.'),
      )
      .finally(() => setBusy(false))
  }

  // Read on arrival when no cached reading exists: this page IS the reading,
  // and arriving to a "press the button" screen is one tap of pure friction.
  useEffect(() => {
    if (week && !analysis && !busy && !error) read()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!week) {
    return (
      <Shell className="stack">
        <PageHeader
          lead={<Mascot state="empty" size={40} className="mt-1 shrink-0" />}
          title="Your week against theirs"
          actions={
            <Button variant="ghost" onClick={onClose}>
              Back
            </Button>
          }
        />
        <Empty
          icon={<Swords size={18} aria-hidden />}
          title="No week to compare yet"
          body="Not enough dated posts are stored for you and a rival."
        />
      </Shell>
    )
  }

  const leader = week.rows[0]!
  const you = week.rows.find((r) => r.own)!

  /**
   * Each analysed card, matched to the desk's own row for that person.
   *
   * The loose name match alone was not enough: the model occasionally heads a
   * card with something that is not a name at all — one run titled the
   * winner's card "Wit" — and that card then rendered under a stranger's
   * letter-avatar with no figures while the person it described had no card
   * anywhere. The request names the people in a fixed order, so any card
   * whose title matches nobody is adopted by the first requested person no
   * other card has claimed. Nobody analysed goes missing over a bad heading.
   */
  const cards = ((): { p: WeekAnalysis['people'][number]; row: PersonWeek | null }[] => {
    if (!analysis) return []
    const claimed = new Set<PersonWeek>()
    const matched = analysis.people.map((p) => {
      const row = rowFor(week, p.name)
      if (row && !claimed.has(row)) {
        claimed.add(row)
        return { p, row: row as PersonWeek | null }
      }
      return { p, row: null }
    })
    const unclaimed = week.rows.slice(0, 5).filter((r) => !claimed.has(r))
    for (const card of matched) {
      if (!card.row) card.row = unclaimed.shift() ?? null
    }
    return matched
  })()
  const verdict = leader.own
    ? `You lead this week.`
    : `${leader.name} leads this week.`

  const file = (lesson: string): void => {
    fileFreeAction({
      action: lesson,
      rationale: `From the week of ${week.label}, read against ${week.rows
        .filter((r) => !r.own)
        .map((r) => r.name)
        .join(', ')}.`,
      talkingPoints: [],
      priority: 'Medium',
      channel: 'Official X handle',
      source: {
        id: `week-${week.label}-${lesson.slice(0, 40)}`,
        headline: `Your week against theirs · ${week.label}`,
        raisedFrom: 'dashboard',
      },
    })
    setFiled((s) => new Set(s).add(lesson))
  }

  return (
    <Shell className="stack">
      <m.div
        className="stack"
        variants={listStagger}
        initial={reduce ? false : 'hidden'}
        animate="show"
      >
        <m.header variants={fadeUp}>
          <PageHeader
            lead={<Mascot state={busy ? 'thinking' : 'idle'} size={40} className="mt-1 shrink-0" />}
            title="Your week against theirs"
            subtitle={`${week.label} · ${week.rows.length} people compared`}
            actions={
              <Button variant="ghost" onClick={onClose}>
                Back
              </Button>
            }
          />
        </m.header>

        {/* ── who won ─────────────────────────────────────────────────── */}
        <m.section variants={fadeUp}>
          <Card level="lift" className="p-4 sm:p-6">
            <CardHead
              icon={<Trophy size={16} aria-hidden />}
              tint="violet"
              title={verdict}
              sub={
                leader.own
                  ? `${compact(you.reactions)} reactions on ${you.posts} posts`
                  : `${compact(leader.reactions)} reactions on ${leader.posts} posts · you drew ${compact(you.reactions)} on ${you.posts}`
              }
            />
            <HBarBoard
              rows={week.rows.slice(0, 5).map((r) => ({
                label: r.name,
                sublabel: (
                  <span className="flex items-center gap-1.5">
                    <span className="shrink-0">
                      {r.posts} {r.posts === 1 ? 'post' : 'posts'}
                    </span>
                    <span className="flex items-center gap-1">
                      {r.platforms.map((p) => (
                        <PlatformBadge key={p} platform={p} size={13} />
                      ))}
                    </span>
                  </span>
                ),
                value: r.reactions,
                lead: <Avatar src={r.avatarUrl} name={r.name} size={38} />,
                emphasis: r.own,
              }))}
              formatValue={(n) => compact(Math.round(n))}
            />
          </Card>
        </m.section>

        {/* ── how each of them played it ──────────────────────────────── */}
        {busy ? (
          <m.section variants={fadeUp}>
            <Card>
              <p className="flex items-center gap-2.5 text-sm text-ink-2">
                <Loader2 size={15} className="animate-spin" aria-hidden />
                Reading everyone&rsquo;s week…
              </p>
            </Card>
          </m.section>
        ) : error ? (
          <m.section variants={fadeUp}>
            <Card>
              <p className="text-sm leading-relaxed text-[var(--neg)]">{error}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => read(true)}>
                <RefreshCw size={14} />
                Try again
              </Button>
            </Card>
          </m.section>
        ) : analysis ? (
          <>
            <m.section variants={fadeUp} aria-labelledby="playbooks-heading">
              <div className="section-head">
                <h2 id="playbooks-heading" className="text-lg font-semibold tracking-[-0.011em]">
                  How each of them played it
                </h2>
              </div>
              <div className="grid items-start gap-4 lg:grid-cols-2">
                {cards.map(({ p, row }) => {
                  const isLeader = row === leader
                  return (
                    <Card key={p.name} className={row?.own ? 'ring-1 ring-[var(--accent)]' : undefined}>
                      <div className="flex items-start gap-3">
                        <Avatar src={row?.avatarUrl ?? null} name={row?.name ?? p.name} size={44} />
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="text-[15px] font-bold leading-tight">
                              {row?.name ?? p.name}
                            </span>
                            {row?.own && <Chip tone="accent">you</Chip>}
                            {isLeader && (
                              <Chip tone="warning" icon={<Crown size={11} aria-hidden />}>
                                led the week
                              </Chip>
                            )}
                            {row?.label && !row.own && <Chip>{row.label}</Chip>}
                          </p>
                          {row && (
                            <p className="tnum mt-0.5 text-xs text-ink-3">
                              {compact(row.reactions)} reactions · {row.posts}{' '}
                              {row.posts === 1 ? 'post' : 'posts'}
                            </p>
                          )}
                        </div>
                      </div>

                      <p className="mt-3 text-sm leading-relaxed text-ink-2">{p.playbook}</p>

                      {/* Their real top posts, biggest first — the evidence the
                          playbook sentence rests on, from the same store. */}
                      {row && row.top.length > 0 && (
                        <ul className="mt-3.5 space-y-1.5 border-t border-[var(--rule)] pt-3">
                          {row.top.slice(0, 3).map((post) => (
                            <li key={post.title} className="flex items-center gap-2.5">
                              <PlatformBadge platform={post.platform} size={18} />
                              <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
                                {post.title}
                              </span>
                              <span className="tnum shrink-0 text-sm font-semibold">
                                {compact(post.reactions)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {p.whyItWorked && (
                        <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--accent-2-soft)] px-3 py-2.5 text-sm leading-relaxed text-ink-2">
                          <span className="font-semibold text-[var(--accent-2)]">
                            Why their best post landed:{' '}
                          </span>
                          {p.whyItWorked}
                        </p>
                      )}
                    </Card>
                  )
                })}
              </div>
            </m.section>

            {/* ── what to copy ────────────────────────────────────────── */}
            {analysis.lessons.length > 0 && (
              <m.section variants={fadeUp} aria-labelledby="lessons-heading">
                <div className="section-head">
                  <h2 id="lessons-heading" className="text-lg font-semibold tracking-[-0.011em]">
                    What to copy
                  </h2>
                </div>
                <div className="stack-tight">
                  {analysis.lessons.map((lesson) => (
                    <Card key={lesson}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="flex min-w-0 flex-1 items-start gap-3 text-[15px] font-semibold leading-snug">
                          <span
                            className="icon-badge icon-badge-sm mt-0.5 shrink-0"
                            style={{ background: 'var(--accent-2-soft)', color: 'var(--accent-2)' }}
                          >
                            <Lightbulb size={15} aria-hidden />
                          </span>
                          <span>{lesson}</span>
                        </p>
                        {filed.has(lesson) ? (
                          <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--pos)_35%,transparent)] bg-[var(--pos-soft)] px-3.5 text-sm font-medium text-[var(--pos)]">
                            <Check size={15} aria-hidden />
                            On the task list
                          </span>
                        ) : (
                          <Button size="sm" variant="outline" className="shrink-0" onClick={() => file(lesson)}>
                            <Plus size={15} />
                            Add to tasks
                          </Button>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </m.section>
            )}

            <m.p variants={fadeUp}>
              <button
                type="button"
                onClick={() => read(true)}
                className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-ink-3 hover:text-ink-2"
              >
                <RefreshCw size={12} aria-hidden />
                Read the week again
              </button>
            </m.p>
          </>
        ) : null}
      </m.div>
    </Shell>
  )
}
