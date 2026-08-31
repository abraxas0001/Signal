import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, ChevronUp, Image as ImageIcon, Plus, Scale, Type, UserPlus, Video, X } from 'lucide-react'
import { Avatar, Button, Card, Chip } from '../ui'
import { DonutBreakdown, PlatformBadge, Sparkline } from '@/components/kit'
import {
  boardPeopleOf,
  readShownRivals,
  saveShownRivals,
  type BoardPerson,
} from '@/lib/compare-board'
import type { TrackedHandle } from '@/lib/handles'
import { cn, compact } from '@/lib/utils'

/**
 * "Compare your performance" — the collapsible board on the dashboard.
 *
 * Folded, it is one quiet strip naming who the desk is measured against.
 * Open, it is the owner's reference table: one column per person, seven
 * visual rows — reach, engagement, sentiment, topics, what is working,
 * comment mentions, praise and complaints. The design brief's rule is that
 * nobody should have to READ the numbers to see who is ahead, so magnitude
 * rows carry a scale bar against the column leader and the numbers ride on
 * top of it; exact figures also sit in the donut's hover.
 *
 * Everything is computed from stored readings (see lib/compare-board). A
 * person the desk has not read renders honest gaps, never zeros.
 */

/* Ring order fixed per platform, chosen so the two brand blues (Facebook,
   LinkedIn) never sit adjacent in the donut. The legend uses the same order,
   with the platform badge carrying identity beside every number — colour is
   never the only channel. */
const RING_ORDER = ['Facebook', 'Instagram', 'Twitter/X', 'LinkedIn', 'YouTube'] as const
const RING_COLOR: Record<string, string> = {
  Facebook: '#1877F2',
  Instagram: '#DD2A7B',
  // var(--text), not "--ink": ink is a Tailwind alias that only exists as
  // --color-ink, and an SVG stroke pointing at a missing variable renders as
  // none — which is how X's half of a ring simply vanished.
  'Twitter/X': 'var(--text)',
  LinkedIn: '#0A66C2',
  YouTube: '#E8102E',
}

const ringIndex = (p: string): number => {
  const i = (RING_ORDER as readonly string[]).indexOf(p)
  return i === -1 ? RING_ORDER.length : i
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-ink-3">{children}</p>
}

/**
 * The at-a-glance magnitude bar: this column's value against the biggest
 * value in the row. The difference is visible before any number is read,
 * which is the entire brief for this board.
 */
function ScaleBar({ value, max, title }: { value: number | null; max: number; title: string }) {
  if (value == null || max <= 0) return null
  const frac = Math.min(1, value / max)
  return (
    <div className="mt-2.5" title={title}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(frac * 100, 2)}%`, background: 'var(--accent)' }}
        />
      </div>
    </div>
  )
}

function ChipRow({ terms, tone }: { terms: string[]; tone?: 'positive' | 'negative' }) {
  if (terms.length === 0) return <Note>No word recurs in what is stored.</Note>
  return (
    <div className="flex flex-wrap gap-1.5">
      {terms.map((t) => (
        <Chip key={t} {...(tone ? { tone } : {})}>
          {t}
        </Chip>
      ))}
    </div>
  )
}

const FORMAT_ICON: Record<string, typeof Video> = {
  'Video posts': Video,
  'Picture posts': ImageIcon,
  'Text posts': Type,
}

interface BoardRow {
  key: string
  label: string
  sub: string
  cell: (p: BoardPerson) => ReactNode
}

export function CompareBoard({
  handles,
  onOpenAccounts,
}: {
  handles: TrackedHandle[]
  /** "Track someone new" lands on the accounts screen, where adding lives. */
  onOpenAccounts: () => void
}) {
  const [open, setOpen] = useState(false)
  const [shownKeys, setShownKeys] = useState<string[] | null>(() => readShownRivals())

  const people = useMemo(() => boardPeopleOf(handles), [handles])
  const you = people.find((p) => p.own) ?? null
  const rivals = people.filter((p) => !p.own)

  /* Never curated: the three biggest rivals. Curated: exactly the saved set,
     in saved order, dropping anyone no longer tracked. */
  const shown =
    shownKeys === null
      ? rivals.slice(0, 3)
      : shownKeys
          .map((k) => rivals.find((r) => r.key === k))
          .filter((r): r is BoardPerson => r !== undefined)
  const pool = rivals.filter((r) => !shown.some((s) => s.key === r.key))

  const columns = you ? [you, ...shown] : shown
  if (columns.length < 2) return null

  const curate = (keys: string[]): void => {
    setShownKeys(keys)
    saveShownRivals(keys)
  }
  const remove = (key: string): void => curate(shown.filter((s) => s.key !== key).map((s) => s.key))
  const add = (key: string): void => curate([...shown.map((s) => s.key), key])

  const maxReach = Math.max(...columns.map((c) => c.totalReach ?? 0))
  const maxAvg = Math.max(...columns.map((c) => c.engagement.avg ?? 0))

  const rows: BoardRow[] = [
    {
      key: 'reach',
      label: 'Reach over platforms',
      sub: 'Followers per platform, latest reading. Hover a ring for the figure.',
      cell: (p) => {
        const segs = p.platforms
          .filter((x) => x.followers != null)
          .sort((a, b) => ringIndex(a.platform) - ringIndex(b.platform))
        if (segs.length === 0) return <Note>Followers were never read.</Note>
        return (
          <div>
            <div className="flex justify-center">
              <DonutBreakdown
                size={116}
                thickness={15}
                segments={segs.map((s) => ({
                  label: s.platform,
                  value: s.followers ?? 0,
                  color: RING_COLOR[s.platform] ?? 'var(--chart-1)',
                }))}
                centerLabel={p.totalReach != null ? compact(p.totalReach) : '—'}
                centerSub="followers"
              />
            </div>
            <ul className="mt-2.5 space-y-1">
              {segs.map((s) => (
                <li key={s.platform} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
                    <PlatformBadge platform={s.platform} size={15} />
                    <span className="truncate">{s.platform}</span>
                  </span>
                  <span className="tnum font-semibold">{compact(s.followers ?? 0)}</span>
                </li>
              ))}
            </ul>
            <ScaleBar
              value={p.totalReach}
              max={maxReach}
              title={
                p.totalReach != null && maxReach > 0
                  ? `${Math.round((p.totalReach / maxReach) * 100)}% of the biggest reach on this board`
                  : ''
              }
            />
          </div>
        )
      },
    },
    {
      key: 'engagement',
      label: 'Engagement',
      sub: 'Average reactions on the newest posts that published any.',
      cell: (p) => {
        const e = p.engagement
        if (e.avg == null) return <Note>No engagement published on what is stored.</Note>
        return (
          <div>
            <p className="flex items-baseline gap-1.5">
              <span className="tnum text-[22px] font-bold leading-none tracking-[-0.02em]">
                {compact(e.avg)}
              </span>
              <span className="text-[11px] text-ink-3">avg on last {e.window}</span>
            </p>
            {e.series.length >= 2 && (
              <Sparkline values={e.series} height={34} color="var(--accent-2)" className="mt-2" />
            )}
            {e.total != null && (
              <p className="tnum mt-1.5 text-[11px] text-ink-3">
                {compact(e.total)} reactions on {e.posts} stored posts
              </p>
            )}
            <ScaleBar
              value={e.avg}
              max={maxAvg}
              title={maxAvg > 0 ? `${Math.round((e.avg / maxAvg) * 100)}% of the best average on this board` : ''}
            />
          </div>
        )
      },
    },
    {
      key: 'sentiment',
      label: 'Sentiment',
      sub: 'From the comments read on their accounts.',
      cell: (p) => {
        if (!p.sentiment) return <Note>No comments read for this person yet.</Note>
        const s = p.sentiment
        return (
          <div className="flex flex-col items-center">
            <DonutBreakdown
              size={92}
              thickness={12}
              segments={[
                { label: 'Positive', value: s.positive, color: 'var(--chart-pos)' },
                { label: 'Neutral', value: s.neutral, color: 'var(--chart-mid)' },
                { label: 'Negative', value: s.negative, color: 'var(--chart-neg)' },
              ]}
              centerLabel={`${s.positive}%`}
              centerSub="positive"
            />
            <p className="tnum mt-2 text-[11px] text-ink-3">
              {s.positive}% · {s.neutral}% · {s.negative}% of {s.commentsRead} comments
            </p>
          </div>
        )
      },
    },
    {
      key: 'topics',
      label: 'What they talk about',
      sub: 'Words recurring across the last 10 stored post titles.',
      cell: (p) => <ChipRow terms={p.topics} />,
    },
    {
      key: 'working',
      label: 'What is working for them',
      sub: 'The content kind that earns the most, and the praised topics.',
      cell: (p) => {
        const w = p.working
        const Icon = w.format ? FORMAT_ICON[w.format] ?? Video : Video
        if (!w.format && !w.bestReach && w.praisedTopics.length === 0) {
          return <Note>Not enough measured posts to say.</Note>
        }
        return (
          <div className="space-y-2.5">
            {w.format && (
              <div className="flex items-center gap-2.5 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-2.5">
                <span
                  className="icon-badge icon-badge-sm shrink-0"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <Icon size={14} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{w.format}</p>
                  {w.formatAvg != null && (
                    <p className="tnum text-[11px] text-ink-3">{compact(w.formatAvg)} avg reactions</p>
                  )}
                </div>
              </div>
            )}
            {w.bestReach && (
              <p className="text-[11px] leading-relaxed text-ink-3">
                Carried furthest: {w.bestReach.kind.toLowerCase().replace(' posts', '')} ·{' '}
                <span className="tnum font-semibold text-ink-2">{compact(w.bestReach.views)} views</span>
              </p>
            )}
            {w.praisedTopics.length > 0 && <ChipRow terms={w.praisedTopics} tone="positive" />}
          </div>
        )
      },
    },
    {
      key: 'mentions',
      label: 'Comment mentions',
      sub: 'What people keep saying under their posts.',
      cell: (p) =>
        p.mentions.length > 0 ? (
          <ChipRow terms={p.mentions} />
        ) : (
          <Note>No comments quoted for this person yet.</Note>
        ),
    },
    {
      key: 'record',
      label: 'Praised and complained',
      sub: 'Recurring words from each side of the reading.',
      cell: (p) =>
        p.praise.length === 0 && p.criticism.length === 0 ? (
          <Note>No comments quoted for this person yet.</Note>
        ) : (
          <div className="space-y-2.5">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--pos)]">
                Praised for
              </p>
              <ChipRow terms={p.praise} tone="positive" />
            </div>
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--neg)]">
                Complained about
              </p>
              <ChipRow terms={p.criticism} tone="negative" />
            </div>
          </div>
        ),
    },
  ]

  const gridCols = `150px repeat(${columns.length}, minmax(205px, 1fr))`
  const gridMinWidth = 150 + columns.length * 215

  return (
    <Card padded={false}>
      {/* ── the strip: always visible, the door in and out ──────────────── */}
      <div className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
        <span
          className="icon-badge shrink-0"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          <Scale size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-52">
          <p className="text-[15px] font-bold">Compare your performance</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
            {shown.length > 0
              ? `Against ${shown.map((s) => s.name).join(', ')}`
              : 'Nobody selected to compare against yet'}
          </p>
        </div>
        <Button size="sm" variant={open ? 'outline' : 'primary'} onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronUp size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
          {open ? 'Close comparison' : 'View comparison'}
        </Button>
      </div>

      {open && (
        <div className="border-t border-[var(--rule)]">
          {/* Who is on the board: removable chips, plus whoever else the desk
              already watches, one tap away. Adding somebody NEW is tracking
              their accounts, which lives on the accounts screen. */}
          <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3.5 sm:px-5">
            {shown.map((s) => (
              <span
                key={s.key}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] py-0.5 pl-1 pr-1.5 text-xs font-medium"
              >
                <Avatar src={s.avatarUrl} name={s.name} size={22} />
                <span className="max-w-36 truncate">{s.name}</span>
                <button
                  type="button"
                  onClick={() => remove(s.key)}
                  aria-label={`Remove ${s.name} from the comparison`}
                  className="grid size-6 place-items-center rounded-full text-ink-3 transition-colors hover:bg-[var(--surface-3)] hover:text-ink"
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
            {pool.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => add(r.key)}
                className="inline-flex min-h-8 items-center gap-1 rounded-full border border-dashed border-[var(--border-strong)] px-2.5 py-0.5 text-xs font-medium text-ink-2 transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <Plus size={12} aria-hidden />
                <span className="max-w-36 truncate">{r.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={onOpenAccounts}
              className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-ink-3 transition-colors hover:text-ink-2"
            >
              <UserPlus size={12} aria-hidden />
              Track someone new
            </button>
          </div>

          <div className="overflow-x-auto pb-1">
            <div
              className="grid px-4 pb-4 pt-3 sm:px-5"
              style={{ gridTemplateColumns: gridCols, minWidth: gridMinWidth }}
            >
              {/* header row */}
              <div className="sticky left-0 z-10 bg-[var(--surface)]" />
              {columns.map((p) => (
                <div
                  key={p.key}
                  className={cn(
                    'flex items-center gap-2.5 rounded-t-[var(--radius-md)] border-b-2 p-3',
                    p.own
                      ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_5%,transparent)]'
                      : 'border-[var(--rule)]',
                  )}
                >
                  <Avatar src={p.avatarUrl} name={p.name} size={36} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-bold">{p.name}</span>
                      {p.own && <Chip tone="accent">you</Chip>}
                    </p>
                    {p.party && <p className="truncate text-[11px] text-ink-3">{p.party}</p>}
                  </div>
                </div>
              ))}

              {/* data rows */}
              {rows.map((row) => (
                <div key={row.key} className="contents">
                  <div className="sticky left-0 z-10 border-t border-[var(--rule)] bg-[var(--surface)] py-3 pr-3">
                    <p className="text-[13px] font-semibold leading-snug">{row.label}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{row.sub}</p>
                  </div>
                  {columns.map((p) => (
                    <div
                      key={p.key}
                      className={cn(
                        'border-t border-[var(--rule)] p-3',
                        p.own && 'bg-[color-mix(in_oklab,var(--accent)_5%,transparent)]',
                      )}
                    >
                      {row.cell(p)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <p className="border-t border-[var(--rule)] px-4 py-2.5 text-[11px] text-ink-3 sm:px-5">
            Counted from the readings this desk already holds. A gap means nothing was read, never
            zero.
          </p>
        </div>
      )}
    </Card>
  )
}
