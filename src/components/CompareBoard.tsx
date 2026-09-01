import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Image as ImageIcon,
  Scale,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Type,
  UserPlus,
  Video,
  X,
} from 'lucide-react'
import type { Report } from '@shared/types'
import type { Identity } from '@shared/identity'
import { Avatar, Button, Card, Chip } from './ui'
import { DonutBreakdown, PlatformBadge, Sparkline } from '@/components/kit'
import { WindowPicker } from './briefing/controls'
import {
  boardAnchor,
  boardPeopleOf,
  type BoardPerson,
  type EngagementMode,
  type KindBest,
} from '@/lib/compare-board'
import type { Standing, TrackedHandle, TrackedPost } from '@/lib/handles'
import { windowLabel, type WindowId } from '@/lib/window'
import { cn, compact, full } from '@/lib/utils'

/**
 * The comparison board: one column per person, seven rows, everything drawn.
 *
 * Built to the owner's reference design, on this desk's own readings. The
 * rule the reference cannot state and this board must: a figure appears only
 * where somebody published it. Facebook publishes no view counts; X publishes
 * no comments to a stranger; a rival tracked this morning has one reading and
 * therefore no change figure. Each of those renders as a short sentence
 * naming what is missing, never as a zero and never as a dash with no
 * explanation — a comparison that quietly fills its own gaps is worse than no
 * comparison at all.
 */

/* Ring colours: the platform's own, ordered so the two brand blues never sit
   adjacent. Identity, not a data scale — the badge beside every number
   carries the same identity, so colour is never the only channel. */
const RING_ORDER = ['Facebook', 'Instagram', 'Twitter/X', 'LinkedIn', 'YouTube'] as const
const RING_COLOR: Record<string, string> = {
  Facebook: '#1877F2',
  Instagram: '#DD2A7B',
  'Twitter/X': 'var(--text)',
  LinkedIn: '#0A66C2',
  YouTube: '#E8102E',
}
const ringIndex = (p: string): number => {
  const i = (RING_ORDER as readonly string[]).indexOf(p)
  return i === -1 ? RING_ORDER.length : i
}

const KIND_ICON: Record<string, typeof Video> = {
  'Video posts': Video,
  'Picture posts': ImageIcon,
  'Text posts': Type,
}

function Gap({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-ink-3">{children}</p>
}

const dayOf = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Why a cell is empty, said precisely.
 *
 * "No post in this window" is true and useless: it does not say whether the
 * desk never read them or whether they simply stopped posting. Naming their
 * newest post turns a blank into a finding — a rival whose last post was in
 * May 2024 is a rival who has gone quiet, which is exactly what an office
 * wants to know.
 */
function OutOfWindow({ person, what }: { person: BoardPerson; what: string }) {
  if (person.postsAllTime === 0) return <Gap>No post of theirs is stored yet.</Gap>
  if (person.newestPost) {
    return (
      <Gap>
        Nothing in this window: their newest stored post is {dayOf(person.newestPost)}. Switch to
        All time to see {what}.
      </Gap>
    )
  }
  return <Gap>None of their stored posts carries a date, so no window can hold them.</Gap>
}

/** A change figure, or nothing. Never a zero standing in for "unknown". */
function Delta({ pct }: { pct: number | null }) {
  if (pct == null) return null
  const up = pct > 0
  return (
    <span
      className={cn(
        'tnum text-[11px] font-bold',
        pct === 0 ? 'text-ink-3' : up ? 'text-[var(--pos)]' : 'text-[var(--neg)]',
      )}
    >
      {up ? '↑' : pct < 0 ? '↓' : ''} {Math.abs(pct)}% vs the window before
    </span>
  )
}

/**
 * One "what is working" card: the post itself.
 *
 * The picture where the platform gave us one, the post's own words where it
 * did not, and the kind of post as the floor. Pressing it opens that post's
 * full reading, so the claim on the card can always be checked against the
 * post that produced it.
 */
function BestPostCard({
  label,
  best,
  Icon,
  tint,
  figure,
  onOpen,
}: {
  label: string
  best: KindBest
  Icon: typeof Video
  tint: string
  figure: string
  onOpen: (url: string) => void
}) {
  const [failed, setFailed] = useState(false)
  /* The KIND is the label, as the reference has it. The post's own title runs
     to a paragraph of Telugu and clamps to "Today, I..." in a column this
     narrow, which names nothing; it belongs on the hover, next to the
     invitation to open the reading. */
  const title = best.post.title?.trim()
  return (
    <button
      type="button"
      onClick={() => onOpen(best.post.url)}
      title={title ? `Open the reading: ${title}` : 'Open the reading for this post'}
      className="group rounded-[var(--radius-md)] bg-[var(--surface-2)] p-2.5 text-left transition-colors hover:bg-[var(--surface-3)]"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3">{label}</p>
      <div className="mt-1.5 flex items-start gap-2">
        {best.post.thumbnailUrl && !failed ? (
          <img
            src={best.post.thumbnailUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="size-9 shrink-0 rounded-[var(--radius-sm)] object-cover"
          />
        ) : (
          <span
            className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--surface)]"
            aria-hidden
          >
            <Icon size={15} style={{ color: tint }} />
          </span>
        )}
        <span className="min-w-0">
          <span className="line-clamp-2 text-xs font-semibold text-ink group-hover:text-[var(--accent)]">
            {best.kind}
          </span>
          <span className="tnum mt-0.5 block text-[11px] text-ink-3">{figure}</span>
        </span>
      </div>
    </button>
  )
}

interface Row {
  key: string
  label: string
  sub: string
  cell: (p: BoardPerson) => ReactNode
}

export function CompareBoard({
  handles,
  identity,
  standings,
  notes,
  reports,
  onAddCompetitor,
  onUntrack,
  onOpenPost,
}: {
  handles: TrackedHandle[]
  identity: Identity | null
  /** Cached opinion readings, keyed by handle id. */
  standings: Record<string, Standing>
  /** Why a reading is absent, keyed by handle id. */
  notes: Record<string, string>
  /** Stored full reports, for the dates a scrape did not carry. */
  reports: Map<string, Report> | null
  onAddCompetitor: () => void
  /** Remove every handle belonging to one person from the desk. */
  onUntrack: (person: BoardPerson, handles: TrackedHandle[]) => void
  /** Open one post's full reading: stored where it exists, run where not. */
  onOpenPost: (postUrl: string) => void
}) {
  const [window, setWindow] = useState<WindowId>('all')
  const [mode, setMode] = useState<EngagementMode>('avg')

  /** The date a post went up, from the post or from its stored reading. */
  const dateOf = useMemo(
    () => (post: TrackedPost): string | null =>
      post.publishedAt ?? reports?.get(post.url)?.snapshot.publishedAt ?? null,
    [reports],
  )

  const anchor = useMemo(() => boardAnchor(handles, dateOf), [handles, dateOf])
  const people = useMemo(
    () => boardPeopleOf(handles, standings, notes, window, dateOf),
    [handles, standings, notes, window, dateOf],
  )

  if (people.length < 2) return null

  const handlesOf = (p: BoardPerson): TrackedHandle[] =>
    p.own
      ? handles.filter((h) => h.own)
      : handles.filter(
          (h) => !h.own && (h.displayName?.trim() || h.label?.trim() || h.handle).toLowerCase() === p.key,
        )

  /* ── the seven rows ─────────────────────────────────────────────────── */

  const rows: Row[] = [
    {
      key: 'reach',
      label: 'Reach over platforms',
      sub: 'Followers on each platform, from the latest reading. Hover a ring for the figure.',
      cell: (p) => {
        if (p.platforms.length === 0) {
          return <Gap>No account of theirs has a follower reading yet.</Gap>
        }
        const segs = [...p.platforms].sort((a, b) => ringIndex(a.platform) - ringIndex(b.platform))
        return (
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
            <DonutBreakdown
              size={124}
              thickness={16}
              segments={segs.map((s) => ({
                label: s.platform,
                value: s.followers,
                color: RING_COLOR[s.platform] ?? 'var(--chart-1)',
              }))}
              centerLabel={p.totalReach == null ? '' : compact(p.totalReach)}
              centerSub="total reach"
              className="shrink-0"
            />
            <ul className="min-w-0 flex-1 space-y-1">
              {p.platforms.map((s) => (
                <li
                  key={s.platform}
                  className="flex items-center gap-2 text-xs"
                  title={`${s.platform}: ${full(s.followers)} followers, ${s.share}% of their reach`}
                >
                  <PlatformBadge platform={s.platform} size={17} />
                  <span className="tnum font-semibold">{compact(s.followers)}</span>
                  <span className="tnum font-normal text-ink-3">({s.share}%)</span>
                </li>
              ))}
              {p.unreadPlatforms.length > 0 && (
                <li className="pt-0.5">
                  <Gap>{p.unreadPlatforms.join(' and ')} tracked but never read.</Gap>
                </li>
              )}
            </ul>
          </div>
        )
      },
    },
    {
      key: 'engagement',
      label: mode === 'avg' ? 'Engagement (average per post)' : 'Engagement (total)',
      sub:
        mode === 'avg'
          ? 'Mean reactions on their newest posts that published any.'
          : 'Reactions summed over every post in this window that published any.',
      cell: (p) => {
        const e = p.engagement
        if (e.avg == null) {
          return <OutOfWindow person={p} what="their engagement" />
        }
        const headline = mode === 'avg' ? e.avg : (e.total ?? e.avg)
        return (
          <div>
            <div className="flex items-end gap-3">
              <div className="min-w-0">
                <p className="tnum text-[24px] font-bold leading-none tracking-[-0.025em]">
                  {compact(headline)}
                </p>
                <p className="mt-1 text-[11px] text-ink-3">
                  {mode === 'avg' ? `average on the last ${e.window}` : `on ${e.window} posts`}
                </p>
              </div>
              {e.series.length >= 2 && (
                <div className="min-w-0 flex-1">
                  <Sparkline values={e.series} height={38} color="var(--accent-2)" />
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--rule)] pt-2">
              <span className="tnum text-[11px] text-ink-2">
                {mode === 'avg'
                  ? e.total != null && `Total ${compact(e.total)}`
                  : `Average ${compact(e.avg)} per post`}
              </span>
              <Delta pct={e.deltaPct} />
            </div>
          </div>
        )
      },
    },
    {
      key: 'sentiment',
      label: 'Sentiment',
      sub: 'How the comments read on their accounts split.',
      cell: (p) => {
        if (!p.sentiment) {
          return <Gap>{p.sentimentNote ?? 'No comments have been read on their accounts yet.'}</Gap>
        }
        const s = p.sentiment
        return (
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <DonutBreakdown
              size={98}
              thickness={13}
              segments={[
                { label: 'Positive', value: s.positive, color: 'var(--chart-pos)' },
                { label: 'Neutral', value: s.neutral, color: 'var(--chart-mid)' },
                { label: 'Negative', value: s.negative, color: 'var(--chart-neg)' },
              ]}
              centerLabel={`${s.positive}%`}
              centerSub="positive"
              className="shrink-0"
            />
            <ul className="min-w-0 space-y-1">
              {[
                { label: 'Positive', n: s.positive, colour: 'var(--chart-pos)' },
                { label: 'Neutral', n: s.neutral, colour: 'var(--chart-mid)' },
                { label: 'Negative', n: s.negative, colour: 'var(--chart-neg)' },
              ].map((seg) => (
                <li key={seg.label} className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: seg.colour }}
                  />
                  <span className="tnum font-bold">{seg.n}%</span>
                  <span className="text-ink-2">{seg.label}</span>
                </li>
              ))}
              <li className="pt-0.5 text-[10.5px] text-ink-3">of {s.commentsRead} comments</li>
            </ul>
          </div>
        )
      },
    },
    {
      key: 'working',
      label: 'What is working for them',
      sub: 'The topics they post on, and the kind of post that earns most.',
      cell: (p) => {
        const w = p.working
        if (w.topics.length === 0 && !w.reach && !w.engagement) {
          return <OutOfWindow person={p} what="what works for them" />
        }
        const ReachIcon = w.reach ? (KIND_ICON[w.reach.kind] ?? Video) : Video
        const EngIcon = w.engagement ? (KIND_ICON[w.engagement.kind] ?? ImageIcon) : ImageIcon
        return (
          <div className="space-y-2.5">
            {w.topics.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                  Top topics
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {w.topics.map((t) => (
                    <li key={t}>
                      <Chip tone="accent">{t}</Chip>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {w.reach && (
                <BestPostCard
                  label="Carried furthest"
                  best={w.reach}
                  Icon={ReachIcon}
                  tint="var(--accent)"
                  figure={`${compact(w.reach.value)} views`}
                  onOpen={onOpenPost}
                />
              )}
              {w.engagement && (
                <BestPostCard
                  label="Earns the most"
                  best={w.engagement}
                  Icon={EngIcon}
                  tint="var(--accent-2)"
                  figure={`${compact(w.engagement.value)} reactions each`}
                  onOpen={onOpenPost}
                />
              )}
            </div>
          </div>
        )
      },
    },
    {
      key: 'mentions',
      label: 'Comment mentions',
      sub: 'The words people keep using under their posts.',
      cell: (p) =>
        p.mentions.length === 0 ? (
          <Gap>No comments have been quoted for them yet.</Gap>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {p.mentions.map((t) => (
              <li key={t}>
                <Chip>{t}</Chip>
              </li>
            ))}
            {p.mentionsMore > 0 && (
              <li>
                <span className="inline-flex min-h-6 items-center rounded-[var(--radius-pill)] px-2 text-[11px] font-medium text-ink-3">
                  and {p.mentionsMore} more
                </span>
              </li>
            )}
          </ul>
        ),
    },
    {
      key: 'praised',
      label: 'Praised for',
      sub: 'Share of the praising comments that use each word.',
      cell: (p) =>
        p.praised.length === 0 ? (
          <Gap>No praising comment has been quoted for them yet.</Gap>
        ) : (
          <ul className="space-y-1.5">
            {p.praised.map((t) => (
              <li key={t.term} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <ThumbsUp size={11} className="shrink-0 text-[var(--pos)]" aria-hidden />
                  <span className="truncate text-xs text-ink-2">{t.term}</span>
                </span>
                <span className="tnum shrink-0 text-xs font-bold text-[var(--pos)]">{t.pct}%</span>
              </li>
            ))}
          </ul>
        ),
    },
    {
      key: 'complained',
      label: 'Complained about',
      sub: 'Share of the critical comments that use each word.',
      cell: (p) =>
        p.complained.length === 0 ? (
          <Gap>No critical comment has been quoted for them yet.</Gap>
        ) : (
          <ul className="space-y-1.5">
            {p.complained.map((t) => (
              <li key={t.term} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <ThumbsDown size={11} className="shrink-0 text-[var(--neg)]" aria-hidden />
                  <span className="truncate text-xs text-ink-2">{t.term}</span>
                </span>
                <span className="tnum shrink-0 text-xs font-bold text-[var(--neg)]">{t.pct}%</span>
              </li>
            ))}
          </ul>
        ),
    },
  ]

  const gridCols = `170px repeat(${people.length}, minmax(250px, 1fr))`
  const minWidth = 170 + people.length * 260

  return (
    <Card padded={false}>
      {/* ── the head ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="icon-badge shrink-0"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <Scale size={18} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold tracking-[-0.015em]">Comparison board</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
              {identity?.name ? `${identity.name} against ` : 'Against '}
              {people.length - 1} {people.length === 2 ? 'other person' : 'others'} ·{' '}
              {windowLabel(anchor, window)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <WindowPicker value={window} onChange={setWindow} />
          {/* Total against average, the reference's own pair. Both are real
              and they answer different questions: who posts a lot that lands,
              against who lands hardest per post. */}
          <div
            className="inline-flex rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface-2)] p-0.5"
            role="group"
            aria-label="Engagement measure"
          >
            {(
              [
                { id: 'avg' as const, label: 'Avg. per post' },
                { id: 'total' as const, label: 'Total' },
              ]
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                aria-pressed={mode === m.id}
                className={cn(
                  'min-h-9 rounded-[var(--radius-pill)] px-2.5 text-xs font-semibold transition-colors',
                  mode === m.id
                    ? 'bg-[var(--surface)] text-ink shadow-[var(--e1)]'
                    : 'text-ink-3 hover:text-ink-2',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={onAddCompetitor}>
            <UserPlus size={15} aria-hidden />
            Add competitor
          </Button>
        </div>
      </div>

      {/* Who is on the board. The office's own column has no remove button:
          a comparison without you in it is not a comparison. */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--rule)] px-4 py-3 sm:px-5">
        <span className="text-xs font-semibold text-ink-3">Comparing {people.length}</span>
        {people.map((p) => (
          <span
            key={p.key}
            className={cn(
              'inline-flex min-h-8 items-center gap-1.5 rounded-[var(--radius-pill)] border py-0.5 pl-1 pr-1.5 text-xs font-medium',
              p.own
                ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                : 'border-[var(--border)] bg-[var(--surface-2)]',
            )}
          >
            <Avatar src={p.avatarUrl} name={p.name} size={22} />
            <span className="max-w-40 truncate">{p.name}</span>
            {p.own ? (
              <Chip tone="accent">you</Chip>
            ) : (
              <button
                type="button"
                onClick={() => onUntrack(p, handlesOf(p))}
                aria-label={`Stop tracking ${p.name}`}
                title={`Stop tracking ${p.name}`}
                className="grid size-6 place-items-center rounded-full text-ink-3 transition-colors hover:bg-[var(--surface-3)] hover:text-ink"
              >
                <X size={12} aria-hidden />
              </button>
            )}
          </span>
        ))}
      </div>

      {/* ── the board ───────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <div
          className="grid px-4 pb-4 sm:px-5"
          style={{ gridTemplateColumns: gridCols, minWidth }}
        >
          <div className="sticky left-0 z-10 bg-[var(--surface)]" />
          {people.map((p) => (
            <div
              key={p.key}
              className={cn(
                'flex items-center gap-2.5 border-b-2 p-3',
                p.own
                  ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_5%,transparent)]'
                  : 'border-[var(--rule)]',
              )}
            >
              <Avatar src={p.avatarUrl} name={p.name} size={38} />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{p.name}</p>
                <p className="truncate text-[11px] text-ink-3">
                  {p.party ?? (p.own ? 'Your desk' : 'Watched account')}
                </p>
              </div>
            </div>
          ))}

          {rows.map((row) => (
            <div key={row.key} className="contents">
              <div className="sticky left-0 z-10 border-t border-[var(--rule)] bg-[var(--surface)] py-3 pr-3">
                <p className="text-[13px] font-semibold leading-snug">{row.label}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{row.sub}</p>
              </div>
              {people.map((p) => (
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

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--rule)] px-4 py-2.5 sm:px-5">
        <p className="text-[11px] leading-relaxed text-ink-3">
          Counted from the readings this desk holds, over {windowLabel(anchor, window)}. A gap names
          what was not published rather than showing a zero.
        </p>
        <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <Sparkles size={12} className="text-[var(--accent)]" aria-hidden />
          {people.reduce((a, p) => a + (p.sentiment?.commentsRead ?? 0), 0)} comments read across
          this board
        </p>
      </div>
    </Card>
  )
}
