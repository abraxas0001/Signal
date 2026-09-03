import { useMemo, useState } from 'react'
import { Lightbulb, PenLine } from 'lucide-react'
import type { Severity } from '@shared/taxonomy'
import { PLATFORM_META } from '@/components/kit'
import { openingsOf, type Opening } from '@/lib/next-post'
import { useStore, type Store } from '@/lib/store'
import { cn } from '@/lib/utils'
import { SEVERITY, TopicTile } from './desk-kit'

/**
 * "What should I talk about?" — the reference sheet's right card, built to it.
 *
 * Ranked cards, each severity-tinted: a rank badge with the severity word
 * under it, the topic tile, a title and two lines of why, a quote box, the
 * reason it is ranked where it is, the platforms to say it on, and the button
 * that starts a draft.
 *
 * THE QUOTE BOX IS THE PART THAT HAS TO BE HONEST. The reference prints a
 * finished post inside every card — "Visited affected areas in Ranga Reddy
 * today..." — as though four posts had already been written. Writing those
 * here would put words in a member's mouth that no model produced and no
 * human approved, and a screenshot of it would outlive any caveat. So the box
 * carries the counter-narrative the analysis actually recorded for that issue
 * when there is one, and otherwise says plainly that nothing is drafted yet
 * and offers the button that drafts it.
 *
 * THE RATIONALE IS COUNTED, NOT CLAIMED. The sheet's footers read "82%
 * negative sentiment and high engagement on this issue." We do not measure
 * engagement on a newspaper story and will not imply we do, so each footer
 * states the share of that issue's own records read as negative, which is a
 * real count, and the severity and volume the ranker actually used.
 */

type Filter = 'all' | 'High' | 'Medium' | 'Low'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All issues' },
  // Critical folds into High here and in the badge, so every tier a card can
  // show is reachable from a chip and the counts reconcile with All.
  { id: 'High', label: 'High severity' },
  { id: 'Medium', label: 'Medium severity' },
  { id: 'Low', label: 'Low severity' },
]

/** The three the reference draws, in its order. */
const PLATFORMS = ['Facebook', 'Instagram', 'Twitter/X'] as const

const sevOf = (s: string | null): Severity =>
  s === 'Critical' || s === 'High' ? 'High' : s === 'Medium' || s === 'Low' ? s : 'Medium'

/**
 * The issue's real topic.
 *
 * `Opening.issue.category` is the literal string 'grievance' for every
 * grievance row — a kind, not a topic — so every card drew the same fallback
 * tile. The topic is on the cluster itself.
 */
function topicOf(store: Store, opening: Opening): string | null {
  if (opening.kind !== 'grievance') return null
  return store.issues.find((x) => x.id === opening.id)?.category ?? null
}

/** The two lines of context the reference puts under each title. */
function contextOf(store: Store, opening: Opening): string | null {
  if (opening.kind !== 'grievance') return null
  const summary = store.issues.find((x) => x.id === opening.id)?.summary?.trim()
  return summary && summary.length > 0 ? summary : null
}

/** The line the analysis already wrote back for this issue, if it wrote one. */
function draftFor(store: Store, opening: Opening): string | null {
  if (opening.kind !== 'grievance') return null
  const line = store.issues.find((x) => x.id === opening.id)?.counterNarrative?.trim()
  return line && line.length > 0 ? line : null
}

/**
 * How the records behind this issue were read.
 *
 * Returns null when the issue has no records we can count — a story-shaped
 * opening, or a tally rather than a cluster — because a share of nothing is
 * not a zero.
 */
function negativeShare(store: Store, opening: Opening): { pct: number; of: number } | null {
  if (opening.kind !== 'grievance') return null
  const issue = store.issues.find((x) => x.id === opening.id)
  if (!issue || issue.recordIds.length === 0) return null
  const ids = new Set(issue.recordIds)
  const rows = store.grievances.filter((r) => ids.has(r.id))
  if (rows.length === 0) return null
  const neg = rows.filter((r) => r.sentiment === 'Negative' || r.sentiment === 'Strong Negative').length
  return { pct: Math.round((neg / rows.length) * 100), of: rows.length }
}

function PlatformDot({ platform }: { platform: string }) {
  const meta = PLATFORM_META[platform]
  if (!meta) return null
  const { Icon, bg, color } = meta
  return (
    <span
      className="grid size-[18px] shrink-0 place-items-center rounded-full"
      style={{ background: bg, color }}
      title={platform}
      aria-hidden
    >
      <Icon size={10} />
    </span>
  )
}

export function TalkAbout({
  since,
  onDraft,
}: {
  since: number
  onDraft?: (opening: Opening) => void
}) {
  const store = useStore()
  const [filter, setFilter] = useState<Filter>('all')

  const model = useMemo(() => openingsOf(store, since), [store, since])

  const counts = useMemo(() => {
    const out: Record<Filter, number> = { all: model.rows.length, High: 0, Medium: 0, Low: 0 }
    for (const r of model.rows) {
      if (r.severity === 'High' || r.severity === 'Critical') out.High++
      else if (r.severity === 'Medium') out.Medium++
      else if (r.severity === 'Low') out.Low++
    }
    return out
  }, [model.rows])

  const rows = useMemo(() => {
    if (filter === 'all') return model.rows
    if (filter === 'High')
      return model.rows.filter((r) => r.severity === 'High' || r.severity === 'Critical')
    return model.rows.filter((r) => r.severity === filter)
  }, [model.rows, filter])

  return (
    <div>
      <h2 className="text-[15px] font-bold tracking-[-0.012em]">
        What should I talk about?{' '}
        <span className="font-normal text-ink-3">(ranked)</span>
      </h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
        The issues worth answering, hardest first, each with the reason it is ranked there.
      </p>

      <div className="mt-3.5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cn(
              'tnum inline-flex h-[29px] items-center gap-1.5 rounded-[8px] border px-3 text-[11.5px] transition-colors',
              filter === f.id
                ? 'border-[color-mix(in_oklab,var(--accent)_35%,transparent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
                : 'border-[var(--border)] bg-[var(--surface)] font-medium text-ink-2 hover:border-[var(--border-interactive)]',
            )}
          >
            {f.label} {counts[f.id]}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          {model.rows.length === 0
            ? 'Nothing is waiting on an answer. Once the desk files an issue or reads a story that clears the relevance check, it will be ranked here.'
            : `Nothing on the list is ${filter.toLowerCase()} severity.`}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2.5">
          {rows.slice(0, 6).map((row, i) => {
            const level = sevOf(row.severity)
            const t = SEVERITY[level]
            const draft = draftFor(store, row)
            const share = negativeShare(store, row)
            return (
              <li
                key={`${row.kind}-${row.id}`}
                className="rounded-[10px] border p-3"
                style={{ background: t.cardFill, borderColor: t.cardBorder }}
              >
                <div className="flex items-start gap-2.5">
                  {/* rank badge with the severity word beneath it */}
                  <span className="shrink-0 text-center">
                    <span
                      className="tnum grid size-[42px] place-items-center rounded-[9px] text-[22px] font-bold leading-none"
                      style={{ background: t.badgeFill, color: t.chipText }}
                    >
                      {i + 1}
                    </span>
                    <span
                      className="mt-1.5 block text-[11px] font-semibold"
                      style={{ color: t.chipText }}
                    >
                      {level}
                    </span>
                  </span>

                  <TopicTile topic={topicOf(store, row)} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-[14px] font-bold leading-snug">{row.title}</p>
                      {onDraft && (
                        <button
                          type="button"
                          onClick={() => onDraft(row)}
                          className="inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-[12.5px] font-semibold text-[var(--accent)] transition-colors hover:border-[var(--accent)]"
                        >
                          <PenLine size={13} aria-hidden />
                          Use this
                        </button>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-3 text-[12.5px] leading-[1.35] text-ink-2">
                      {contextOf(store, row) ?? row.why}
                    </p>

                    {/* the draft, or an honest absence of one */}
                    <div
                      className="mt-2 rounded-[10px] px-3 py-2.5"
                      style={{ background: t.quoteFill }}
                    >
                      {draft ? (
                        <p className="text-[12px] leading-[1.45] text-ink-2">&ldquo;{draft}&rdquo;</p>
                      ) : (
                        <p className="text-[12px] leading-[1.45] text-ink-3">
                          No line has been drafted for this yet. Use this to write one.
                        </p>
                      )}
                    </div>

                  </div>
                </div>

                {/* One footer strip across the whole card, as the reference
                    draws it: the reason on the left, the platforms right. */}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                  <p className="min-w-0 flex-1 text-[11px] leading-snug text-ink-3">
                    <span className="font-semibold">Why it is here:</span>{' '}
                    {share
                      ? `${share.pct}% of the ${share.of} ${share.of === 1 ? 'record' : 'records'} behind it read as negative.`
                      : row.why}
                  </p>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[11px] text-ink-3">Suggested platforms:</span>
                    {PLATFORMS.map((p) => (
                      <PlatformDot key={p} platform={p} />
                    ))}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-3.5 flex gap-2 rounded-[10px] border border-[color-mix(in_oklab,var(--accent)_14%,transparent)] bg-[var(--accent-soft)] p-2.5 text-[11px] leading-relaxed text-[var(--accent)]">
        <Lightbulb size={14} className="mt-px shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          Ranked by severity and how many records sit behind each issue. Engagement is not part of
          it: we do not measure engagement on a newspaper story.
        </span>
      </p>
    </div>
  )
}
