import { useCallback, useEffect, useMemo, useState } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import {
  ArrowRight,
  AtSign,
  BarChart3,
  Check,
  ChevronRight,
  Download,
  Frown,
  Info,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  MessageSquare,
  Meh,
  Smile,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Users,
} from 'lucide-react'
import type { Report } from '@shared/types'
import { EMOTION_GLYPH } from '@shared/taxonomy'
import type { Emotion } from '@shared/taxonomy'
import { Button, Card, Chip, Empty, Shell } from './ui'
import { DonutBreakdown, PlatformBadge, seriesColor } from '@/components/kit'
import { Mascot } from './Mascot'
import { listHandles } from '@/lib/handles'
import { loadPostReports } from '@/lib/post-reports'
import { useStore } from '@/lib/store'
import { audienceOf, audienceVerdict, type AudienceModel, type QuotedComment } from '@/lib/audience'
import { cn, compact, relativeTime } from '@/lib/utils'
import { fadeUp, listStagger } from '@/lib/motion'

/**
 * "What people are saying about you", built to the product owner's reference.
 *
 * The shape is the reference's: a platform rail down the left, five headline
 * tiles across the top, a topics ring beside a row of emotion tiles, then the
 * comments themselves beside praise, complaints, a three-way summary and a
 * suggested action.
 *
 * TWO SOURCES FEED THIS SCREEN AND THEY KNOW DIFFERENT THINGS. Everything on
 * it is one or the other, and the screen says which:
 *
 *   The comment readings walked each account and counted what they found.
 *   They give the split, the totals per platform, the recurring words and a
 *   handful of comments quoted with the side they sat on. They do not keep who
 *   wrote a comment.
 *
 *   The post readings stored comments whole under the posts they have read in
 *   full. They give the name, the date and the like count. They score nothing.
 *
 * WHAT THE REFERENCE ASKS FOR THAT THIS DESK CANNOT PRODUCE, AND WHAT SITS IN
 * THOSE SLOTS INSTEAD:
 *
 *   "Unique People Talking" is not knowable. Nobody publishes a count of the
 *   distinct people in a comment thread. The tile carries the number of
 *   distinct NAMES on the comments this desk keeps in full, which is a sample
 *   of a sample, and says so on its face. One person under two names counts
 *   twice; that is stated rather than hidden.
 *
 *   "Engagement on Comments" is real but small: the platforms do publish likes
 *   against a comment. On this desk the total is close to nought, and the tile
 *   prints the real figure with its denominator rather than a percentage that
 *   would flatter it.
 *
 *   Every "vs prev 7 days" arrow in the reference is absent. This desk holds
 *   one comment reading per account, not a series, so there is no previous
 *   week to compare against. A trend arrow drawn from one reading would be
 *   invented, and an invented arrow is the one thing this product may not do.
 */

/* ── the loader ──────────────────────────────────────────────────────────── */

/**
 * The stored readings, loaded when this screen opens.
 *
 * Loaded here rather than handed down from the app shell: the shell mounts
 * before the desk's storage scope is settled, and a load that runs then sees
 * the empty default and caches it.
 */
function useStoredReports(): Map<string, Report> | null {
  const [reports, setReports] = useState<Map<string, Report> | null>(null)
  useEffect(() => {
    let alive = true
    loadPostReports().then(
      (map) => alive && setReports(map),
      () => alive && setReports(new Map()),
    )
    return () => {
      alive = false
    }
  }, [])
  return reports
}

/* ── small parts ─────────────────────────────────────────────────────────── */

type Side = 'all' | 'positive' | 'neutral' | 'negative'
type Tab = 'saying' | 'mentions'

const SIDES: { id: Side; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'positive', label: 'Positive' },
  { id: 'neutral', label: 'Neutral' },
  { id: 'negative', label: 'Negative' },
]

/** One casing for the verdict column, since the readings do not agree on one. */
const sentenceCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

const SIDE_TONE = {
  positive: { chip: 'positive', colour: 'var(--pos)' },
  negative: { chip: 'negative', colour: 'var(--neg)' },
  neutral: { chip: 'warning', colour: 'var(--warn)' },
} as const

/** A tint per emotion, so the row of tiles reads without being read. */
const EMOTION_TINT: Record<string, { bg: string; fg: string }> = {
  Joy: { bg: 'rgba(245,158,11,0.14)', fg: '#b45309' },
  Trust: { bg: 'rgba(16,185,129,0.14)', fg: '#047857' },
  Anticipation: { bg: 'rgba(139,92,246,0.14)', fg: '#6d28d9' },
  Surprise: { bg: 'rgba(14,165,233,0.14)', fg: '#0369a1' },
  Sadness: { bg: 'rgba(59,130,246,0.14)', fg: '#1d4ed8' },
  Fear: { bg: 'rgba(99,102,241,0.14)', fg: '#4338ca' },
  Anger: { bg: 'rgba(239,68,68,0.14)', fg: '#b91c1c' },
  Disgust: { bg: 'rgba(132,204,22,0.16)', fg: '#4d7c0f' },
  Other: { bg: 'var(--surface-3)', fg: 'var(--ink-2)' },
}

/**
 * One headline figure, with what it rests on written underneath.
 *
 * The note is not decoration. Every tile here is a count over a different
 * denominator, and a row of five percentages with no denominators is how a
 * screen ends up comparing a share of 152 comments with a share of 51.
 */
function Tile({
  label,
  value,
  note,
  icon,
  tint,
  bar,
  hint,
}: {
  label: string
  value: string
  note: string
  icon: React.ReactNode
  tint: { bg: string; fg: string }
  /** 0…1, drawn as the reference's progress rule under the figure. */
  bar?: number
  /**
   * What the figure rests on, carried on the element rather than printed.
   *
   * A caveat still has to travel with a number, or the number stops being a
   * measurement. It does not have to be a paragraph on the page.
   */
  hint?: string
}) {
  return (
    <Card className="p-3" title={hint}>
      <div className="flex items-start gap-2.5">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full"
          style={{ background: tint.bg, color: tint.fg }}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11.5px] font-medium text-ink-3">{label}</p>
          <p className="tnum mt-0.5 text-[22px] font-bold leading-none tracking-[-0.02em]">
            {value}
          </p>
        </div>
      </div>
      {bar != null && (
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(2, Math.min(100, bar * 100))}%`, background: tint.fg }}
          />
        </div>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-ink-3">{note}</p>
    </Card>
  )
}

/** A titled panel, so the eight of them share one rhythm. */
function Panel({
  title,
  sub,
  icon,
  action,
  children,
  className,
  hint,
}: {
  title: string
  sub?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  /** What the panel rests on, on hover rather than printed under the title. */
  hint?: string
}) {
  return (
    <Card className={cn('@container flex flex-col p-4', className)} title={hint}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[14px] font-bold tracking-[-0.01em]">
            {icon}
            {title}
          </p>
          {sub && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{sub}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3 min-w-0 flex-1">{children}</div>
    </Card>
  )
}

/** A label and a count, which is the shape of both theme lists. */
function ThemeRow({ term, count, tone }: { term: string; count: number; tone: 'pos' | 'neg' }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1">
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{term}</span>
      <span className="tnum shrink-0 text-[11.5px] font-bold" style={{ color: `var(--${tone})` }}>
        {count}
      </span>
    </li>
  )
}

/** The circle standing in for a face the platform did not publish. */
function Initial({ name }: { name: string | null }) {
  const letter = name?.trim()?.[0]?.toUpperCase() ?? null
  return (
    <span
      className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--surface-3)] text-[11px] font-bold text-ink-3"
      title={name ?? 'The platform published no name against this comment.'}
    >
      {letter ?? <Users size={12} aria-hidden />}
    </span>
  )
}

/* ── the screen ──────────────────────────────────────────────────────────── */

export function AudienceScreen({
  onClose,
  onOpenAccounts,
}: {
  onClose: () => void
  onOpenAccounts: () => void
}) {
  const reduce = useReducedMotion() === true
  const reports = useStoredReports()
  const store = useStore()
  const handles = useMemo(() => listHandles(), [])
  const model: AudienceModel = useMemo(() => audienceOf(handles, reports), [handles, reports])

  const [tab, setTab] = useState<Tab>('saying')
  const [side, setSide] = useState<Side>('all')
  const [platform, setPlatform] = useState<string | null>(null)

  /**
   * The comments, most informative first.
   *
   * A row that carries a name and a date is worth more to an office than one
   * that carries only words, and the two sources feeding this list are sorted
   * differently by accident of how they were read. Ordering by what a row
   * actually knows puts the fullest evidence at the top without dropping
   * anything: everything is still in the list, and the count says how many.
   */
  const quotes = useMemo(() => {
    const rank = (q: QuotedComment): number =>
      (q.side ? 2 : 0) + (q.author ? 2 : 0) + (q.publishedAt ? 1 : 0)
    return model.quotes
      .filter((q) => (side === 'all' || q.side === side) && (!platform || q.platform === platform))
      .slice()
      .sort((a, b) => rank(b) - rank(a))
  }, [model, side, platform])

  const [showAll, setShowAll] = useState(false)

  if (model.commentsRead === 0) {
    return (
      <Shell className="stack">
        <Header model={model} onClose={onClose} />
        <Empty
          icon={<MessageSquare size={18} aria-hidden />}
          title="No comments have been read yet"
          body={
            model.platforms.length > 0
              ? model.platforms
                  .map((p) => p.note)
                  .filter(Boolean)
                  .join(' ')
              : 'No account is marked as yours.'
          }
          action={
            <Button size="sm" onClick={onOpenAccounts}>
              Open your accounts
            </Button>
          }
        />
      </Shell>
    )
  }

  const readPlatforms = model.platforms.filter((p) => p.commentsRead > 0)
  const positiveQuotes = model.quotes.filter((q) => q.side === 'positive').length
  const negativeQuotes = model.quotes.filter((q) => q.side === 'negative').length
  const scored = model.quotes.filter((q) => q.side !== null).length

  return (
    <Shell className="stack">
      <m.div variants={listStagger} initial={reduce ? false : 'hidden'} animate="show">
        <m.div variants={fadeUp}>
          <Header model={model} onClose={onClose} />
        </m.div>

        {/* ── the two views, as filled pills per the reference ─────────── */}
        <m.div variants={fadeUp} className="mt-3 flex flex-wrap gap-2">
          {(
            [
              { id: 'saying' as const, label: 'What People Are Saying', icon: <MessageCircle size={14} aria-hidden /> },
              { id: 'mentions' as const, label: 'Mentions Overview', icon: <AtSign size={14} aria-hidden /> },
            ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={cn(
                'inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-md)] border px-3.5 text-[13px] font-semibold transition-colors',
                tab === t.id
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                  : 'border-[var(--border)] bg-[var(--surface)] text-ink-2 hover:border-[var(--border-interactive)]',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </m.div>

        <div className="@container mt-3">
          <div className="grid gap-3 @3xl:grid-cols-[238px_minmax(0,1fr)] @3xl:items-stretch">
          {/* ── the platform rail ─────────────────────────────────────── */}
          <m.div variants={fadeUp} className="flex min-w-0 flex-col">
            <Card className="flex h-full flex-col p-3">
              <p className="text-[13px] font-bold">All platforms</p>
              <button
                type="button"
                onClick={() => setPlatform(null)}
                aria-pressed={platform === null}
                className={cn(
                  'mt-2 flex w-full items-center gap-2.5 rounded-[var(--radius-md)] border p-2.5 text-left transition-colors',
                  platform === null
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--border-interactive)]',
                )}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--accent)]">
                  <MessageSquare size={16} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10.5px] leading-tight text-ink-3">
                    Total comments read
                  </span>
                  <span className="tnum block text-[18px] font-bold leading-tight">
                    {compact(model.commentsRead)}
                  </span>
                  <span
                    className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]"
                    title={`${model.positive}% positive, ${model.neutral}% neutral, ${model.negative}% negative across every account read.`}
                  >
                    <span style={{ width: `${model.positive}%`, background: 'var(--chart-pos)' }} />
                    <span style={{ width: `${model.neutral}%`, background: 'var(--chart-mid)' }} />
                    <span style={{ width: `${model.negative}%`, background: 'var(--chart-neg)' }} />
                  </span>
                </span>
              </button>

              <ul className="mt-2 space-y-1">
                {model.platforms.map((p) => (
                  <li key={`${p.platform}-${p.handle}`}>
                    <button
                      type="button"
                      onClick={() => p.commentsRead > 0 && setPlatform(p.platform)}
                      aria-pressed={platform === p.platform}
                      disabled={p.commentsRead === 0}
                      title={p.note ?? `${p.commentsRead} comments read on ${p.handle}`}
                      className={cn(
                        'block w-full rounded-[var(--radius-md)] px-2 py-2 text-left transition-colors',
                        platform === p.platform
                          ? 'bg-[var(--accent-soft)]'
                          : 'hover:bg-[var(--surface-2)]',
                        p.commentsRead === 0 && 'opacity-60',
                      )}
                    >
                      <span className="flex w-full items-center gap-2.5">
                        <PlatformBadge platform={p.platform} size={22} />
                        {/* The share sits on the second line beside the count.
                            On the first line it squeezed the name into
                            "Instagr..." at this rail's width. */}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold">
                            {p.platform}
                          </span>
                          <span className="flex items-baseline justify-between gap-2 text-[10px] text-ink-3">
                            {p.commentsRead > 0 ? (
                              <>
                                <span className="truncate">{p.commentsRead} comments</span>
                                <span
                                  className="tnum shrink-0 font-bold"
                                  style={{
                                    color: p.positive >= 15 ? 'var(--pos)' : 'var(--ink-2)',
                                  }}
                                  title={`${p.positive}% of them were positive.`}
                                >
                                  {p.positive}%
                                </span>
                              </>
                            ) : (
                              <span className="truncate">not read</span>
                            )}
                          </span>
                        </span>
                        <ChevronRight size={13} className="shrink-0 text-ink-3" aria-hidden />
                      </span>
                      {/* The split, measured, in the one place a reader is
                          already comparing accounts against each other. */}
                      {p.commentsRead > 0 && (
                        <span className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                          <span style={{ width: `${p.positive}%`, background: 'var(--chart-pos)' }} />
                          <span style={{ width: `${p.neutral}%`, background: 'var(--chart-mid)' }} />
                          <span style={{ width: `${p.negative}%`, background: 'var(--chart-neg)' }} />
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>

              {/* Pinned to the foot so the card fills its column rather than
                  stopping short and leaving blank page under it. */}
              <div className="mt-auto pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={onOpenAccounts}
                >
                  <BarChart3 size={14} aria-hidden />
                  Open your accounts
                </Button>
              </div>
            </Card>
          </m.div>

          {/* ── beside the rail: the tiles and the two charts ─────────── */}
          {/* Its own container, because the panels inside it answer to the
              room left after the rail, not to the room before it. */}
          <div className="@container min-w-0 space-y-3">
            {tab === 'saying' ? (
              <>
                <m.div
                  variants={fadeUp}
                  className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-5"
                >
                  <Tile
                    label="Positive"
                    value={`${model.positive}%`}
                    note="praise, thanks and support"
                    icon={<Smile size={17} aria-hidden />}
                    tint={{ bg: 'var(--pos-soft)', fg: 'var(--pos)' }}
                    bar={model.positive / 100}
                  />
                  <Tile
                    label="Neutral"
                    value={`${model.neutral}%`}
                    note="greetings, tags and plain reactions"
                    icon={<Meh size={17} aria-hidden />}
                    tint={{ bg: 'var(--warn-soft)', fg: 'var(--warn)' }}
                    bar={model.neutral / 100}
                  />
                  <Tile
                    label="Negative"
                    value={`${model.negative}%`}
                    note="criticism, demands and anger"
                    icon={<Frown size={17} aria-hidden />}
                    tint={{ bg: 'var(--neg-soft)', fg: 'var(--neg)' }}
                    bar={model.negative / 100}
                  />
                  {/* The reference's "Engagement on Comments". It is a real
                      figure and it is close to nought, which is itself worth
                      knowing: almost nobody likes a comment on a politician's
                      post. Printed with its denominator rather than as a share
                      that would flatter it. */}
                  <Tile
                    label="Likes on comments"
                    value={model.commentLikes == null ? 'NA' : compact(model.commentLikes)}
                    note={`across ${model.commentLikesOver} comments`}
                    icon={<ThumbsUp size={17} aria-hidden />}
                    tint={{ bg: 'var(--accent-soft)', fg: 'var(--accent)' }}
                  />
                  {/* The reference's "Unique People Talking". Nobody publishes
                      that. This is distinct NAMES on the comments kept in full,
                      and the note refuses to let it read as anything more. */}
                  <Tile
                    label="Names seen"
                    value={compact(model.distinctAuthors)}
                    note={`on ${model.authoredComments} of ${model.storedComments} comments`}
                    hint={`Distinct names, not a count of people: one person under two names counts twice. Counted over the ${model.storedComments} comments stored whole, which is a sample of the ${model.commentsRead} counted.`}
                    icon={<Users size={17} aria-hidden />}
                    tint={{ bg: 'var(--info-soft)', fg: 'var(--info)' }}
                  />
                </m.div>

                <m.p variants={fadeUp} className="text-[17px] font-bold tracking-[-0.015em]">
                  {audienceVerdict(model)}
                </m.p>

                <m.div variants={fadeUp} className="grid gap-3 @2xl:grid-cols-2">
                  {/* ── topics ─────────────────────────────────────────── */}
                  <Panel
                    title="What are people talking about?"
                    sub={`Across ${model.topicPosts} posts read in full.`}
                    hint="Counted over posts, not comments. A reading assigns one topic to a post; no platform publishes what a comment thread was about."

                    icon={<MessageCircle size={14} className="text-[var(--accent)]" aria-hidden />}
                  >
                    {model.topics.length === 0 ? (
                      <p className="text-[11.5px] leading-relaxed text-ink-3">
                        No post of yours has a full reading yet, so no topic is recorded.
                      </p>
                    ) : (
                      <div className="flex h-full flex-wrap items-center justify-center gap-4">
                        <DonutBreakdown
                          size={148}
                          thickness={20}
                          segments={model.topics.map((t, i) => ({
                            label: String(t.topic),
                            value: t.posts,
                            color: seriesColor(i),
                          }))}
                          centerLabel={String(model.topicPosts)}
                          centerSub="posts"
                          className="shrink-0"
                        />
                        <ul className="flex min-w-[190px] flex-1 flex-col justify-center gap-1.5">
                          {model.topics.map((t, i) => (
                            <li key={String(t.topic)} className="flex items-center gap-2">
                              <span
                                aria-hidden
                                className="size-2 shrink-0 rounded-full"
                                style={{ background: seriesColor(i) }}
                              />
                              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">
                                {t.topic}
                              </span>
                              <span className="tnum shrink-0 text-[11.5px] font-bold">
                                {t.pct}%
                              </span>
                              <span className="tnum w-8 shrink-0 text-right text-[11px] text-ink-3">
                                {t.posts}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                  </Panel>

                  {/* ── emotions ───────────────────────────────────────── */}
                  <Panel
                    title="How do people feel about you?"
                    sub={`Across ${model.postsAnalysed} posts read in full.`}
                    hint={
                      model.postsWithoutComments === 0
                        ? `From the comments on ${model.postsWithComments} posts read in full.`
                        : `From the comments on ${model.postsWithComments} of the ${model.postsAnalysed} posts read in full. On the other ${model.postsWithoutComments} no comments were retrievable, so those are the post's own register.`
                    }
                    icon={<Smile size={14} className="text-[var(--accent)]" aria-hidden />}
                  >
                    {model.emotions.length === 0 ? (
                      <p className="text-[11.5px] leading-relaxed text-ink-3">
                        No reading has recorded an emotion yet.
                      </p>
                    ) : (
                      <ul className="grid h-full auto-rows-fr grid-cols-2 gap-2 @xs:grid-cols-3">
                        {model.emotions.map((e) => {
                          const tint = EMOTION_TINT[String(e.emotion)] ?? EMOTION_TINT['Other']!
                          return (
                            <li
                              key={String(e.emotion)}
                              className="flex flex-col items-center justify-center rounded-[var(--radius-md)] p-2 text-center"
                              style={{ background: tint.bg }}
                              title={`Recorded on ${e.posts} of the ${model.postsAnalysed} posts read in full.`}
                            >
                              <span className="text-[22px] leading-none">
                                {EMOTION_GLYPH[e.emotion as Emotion] ?? '\u{1F4AD}'}
                              </span>
                              <p className="mt-1.5 text-[11px] font-medium text-ink-2">
                                {e.emotion}
                              </p>
                              <p
                                className="tnum mt-1 text-[19px] font-bold leading-none"
                                style={{ color: tint.fg }}
                              >
                                {e.pct}%
                              </p>
                              <p className="tnum mt-1 text-[10px] text-ink-3">{e.posts} posts</p>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </Panel>
                </m.div>

              </>
            ) : (
              <MentionsOverview model={model} readPlatforms={readPlatforms.length} />
            )}
          </div>

          {/* ── under both columns: the comments and what sits beside them ─
              Spanning the rail's column as well, because the rail ends after
              four platforms and everything below it was empty page. */}
          {tab === 'saying' && (
            <div className="@container min-w-0 @3xl:col-span-2">
                <m.div
                  variants={fadeUp}
                  className="grid gap-3 @3xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
                >
                  {/* ── the comments themselves ────────────────────────── */}
                  <Panel
                    title="What people are saying in comments"
                    sub={`${quotes.length} shown${platform ? ` on ${platform}` : ''}.`}
                    hint={`${scored} of the ${model.quotes.length} carry a side from the readings. ${model.authoredComments} carry the name the platform published; the comment readings count and quote but do not keep an author.`}
                    icon={<MessageSquare size={14} className="text-[var(--accent)]" aria-hidden />}
                  >
                    <div className="flex flex-wrap gap-1.5">
                      {SIDES.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSide(s.id)}
                          aria-pressed={side === s.id}
                          className={cn(
                            'inline-flex min-h-8 items-center rounded-[var(--radius-pill)] border px-3 text-[11.5px] font-semibold transition-colors',
                            side === s.id
                              ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                              : 'border-[var(--border)] bg-[var(--surface-2)] text-ink-2',
                          )}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>

                    {quotes.length === 0 ? (
                      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
                        {side === 'neutral'
                          ? 'These readings quoted no neutral comments for this account.'
                          : 'No comment on this side was quoted for this account.'}
                      </p>
                    ) : (
                      <ul className="mt-2 divide-y divide-[var(--rule)]">
                        {quotes.slice(0, showAll ? 120 : 20).map((q, i) => (
                          <CommentRow key={`${q.platform}-${i}`} q={q} />
                        ))}
                      </ul>
                    )}
                    {quotes.length > 20 && (
                      <button
                        type="button"
                        onClick={() => setShowAll((v) => !v)}
                        className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)]"
                      >
                        {showAll
                          ? 'Show fewer'
                          : `View all ${quotes.length} comments`}
                        <ArrowRight size={12} aria-hidden />
                      </button>
                    )}

                  </Panel>

                  {/* A flex column whose last card grows, so the two halves of
                      this row finish level. With plain stacking the comments
                      card stretched to the row height and the panels beside it
                      stopped a hundred and eighty pixels short, which read as
                      the page having been cut off. */}
                  <div className="flex min-w-0 flex-col gap-3">
                    <div className="grid gap-3 @md:grid-cols-2">
                      <Panel
                        title="Top praise"
                        sub={`Words across ${positiveQuotes} praising comments.`}
                        icon={<ThumbsUp size={14} className="text-[var(--pos)]" aria-hidden />}
                      >
                        {model.praise.length === 0 ? (
                          <p className="text-[11.5px] leading-relaxed text-ink-3">
                            {positiveQuotes === 0
                              ? 'The readings quoted no praising comments.'
                              : `No word appears in two of those ${positiveQuotes}.`}
                          </p>
                        ) : (
                          <ul>
                            {model.praise.map((t) => (
                              <ThemeRow key={t.term} term={t.term} count={t.count} tone="pos" />
                            ))}
                          </ul>
                        )}
                      </Panel>
                      <Panel
                        title="Top complaints"
                        sub={`Words across ${negativeQuotes} critical comments.`}
                        icon={<TriangleAlert size={14} className="text-[var(--neg)]" aria-hidden />}
                      >
                        {model.complaints.length === 0 ? (
                          <p className="text-[11.5px] leading-relaxed text-ink-3">
                            {negativeQuotes === 0
                              ? `No critical comment was quoted out of the ${model.commentsRead} counted. That is a finding, not a gap.`
                              : `No word appears in two of those ${negativeQuotes}.`}
                          </p>
                        ) : (
                          <ul>
                            {model.complaints.map((t) => (
                              <ThemeRow key={t.term} term={t.term} count={t.count} tone="neg" />
                            ))}
                          </ul>
                        )}
                      </Panel>
                    </div>

                    <QuickSummary model={model} />
                    <div className="flex min-h-0 flex-1 flex-col">
                      <SuggestedAction model={model} identity={store.identity} />
                    </div>
                  </div>
                </m.div>
            </div>
          )}
          </div>
        </div>
      </m.div>
    </Shell>
  )
}

/* ── one comment ─────────────────────────────────────────────────────────── */

function CommentRow({ q }: { q: QuotedComment }) {
  const tone = q.side ? SIDE_TONE[q.side] : null
  return (
    <li className="flex items-start gap-2.5 py-2.5">
      <PlatformBadge platform={q.platform} size={20} className="mt-0.5 shrink-0" />
      {q.author && <Initial name={q.author} />}
      <div className="min-w-0 flex-1">
        {/* The name line appears only where there is a name. Most of these
            comments come from the comment readings, which count and quote but
            do not keep an author, and thirty rows each announcing "name not
            published" said the same absence thirty times while crowding out
            the words somebody actually wrote. The absence is stated once, at
            the foot of the list. */}
        {(q.author || q.publishedAt) && (
          <p className="flex flex-wrap items-center gap-x-1.5 text-[10.5px] text-ink-3">
            {q.author && <span className="font-semibold text-ink-2">{q.author}</span>}
            {q.publishedAt && <span>{relativeTime(q.publishedAt)}</span>}
          </p>
        )}
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-2">&ldquo;{q.text}&rdquo;</p>
        {q.likes != null && q.likes > 0 && (
          <p className="tnum mt-1 flex items-center gap-1 text-[10px] text-ink-3">
            <ThumbsUp size={10} aria-hidden />
            {q.likes}
          </p>
        )}
      </div>
      {tone ? (
        <Chip tone={tone.chip}>{sentenceCase(q.side!)}</Chip>
      ) : (
        <span
          className="shrink-0 text-[10px] text-ink-3"
          title="This comment was stored whole by a post reading, which does not score a side."
        >
          Not scored
        </span>
      )}
    </li>
  )
}

/* ── the three-way summary ───────────────────────────────────────────────── */

/**
 * The reference's "Quick Summary". Every line is either a word the readings
 * counted or a sentence the readings wrote; none of it is composed here.
 */
function QuickSummary({ model }: { model: AudienceModel }) {
  return (
    <Panel
      title="Quick summary"
      icon={<Sparkles size={14} className="text-[var(--accent)]" aria-hidden />}
      hint="Straight from the readings, in their own counts and sentences. Nothing here is composed by this screen."

    >
      <div className="grid gap-2 @xl:grid-cols-3">
        <div className="rounded-[var(--radius-md)] bg-[var(--pos-soft)] p-2.5">
          <p className="text-[11px] font-bold text-[var(--pos)]">What people like</p>
          {model.praise.length === 0 ? (
            <p className="mt-1 text-[10.5px] leading-relaxed text-ink-3">
              No word recurs on this side.
            </p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {model.praise.slice(0, 4).map((t) => (
                <li key={t.term} className="flex items-start gap-1">
                  <Check size={10} className="mt-0.5 shrink-0 text-[var(--pos)]" aria-hidden />
                  <span className="text-[10.5px] leading-relaxed text-ink-2">{t.term}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-[var(--radius-md)] bg-[var(--neg-soft)] p-2.5">
          <p className="text-[11px] font-bold text-[var(--neg)]">What people do not like</p>
          {model.complaints.length === 0 ? (
            <p className="mt-1 text-[10.5px] leading-relaxed text-ink-3">
              No word recurs on this side.
            </p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {model.complaints.slice(0, 4).map((t) => (
                <li key={t.term} className="flex items-start gap-1">
                  <TriangleAlert
                    size={10}
                    className="mt-0.5 shrink-0 text-[var(--neg)]"
                    aria-hidden
                  />
                  <span className="text-[10.5px] leading-relaxed text-ink-2">{t.term}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-[var(--radius-md)] bg-[var(--accent-soft)] p-2.5">
          <p className="text-[11px] font-bold text-[var(--accent)]">What it means for you</p>
          {model.summaries.length === 0 ? (
            <p className="mt-1 text-[10.5px] leading-relaxed text-ink-3">
              No reading has written a summary yet.
            </p>
          ) : (
            <p className="mt-1 line-clamp-6 text-[10.5px] leading-relaxed text-ink-2">
              {model.summaries[0]!.text}
            </p>
          )}
        </div>
      </div>
      {model.summaries.length > 1 && (
        <ul className="mt-2 space-y-1 border-t border-[var(--rule)] pt-2">
          {model.summaries.slice(1).map((s) => (
            <li key={`${s.platform}-${s.handle}`} className="flex items-start gap-1.5">
              <PlatformBadge platform={s.platform} size={14} className="mt-0.5 shrink-0" />
              <span className="line-clamp-2 text-[10px] leading-relaxed text-ink-3">{s.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* ── the suggested action ────────────────────────────────────────────────── */

/**
 * The one card on this screen that is not a measurement.
 *
 * It costs a live call, it is a model's opinion, and it says so. It is
 * grounded in what the readings actually counted and quoted, and nothing is
 * pre-filled: a draft post sitting in a box is indistinguishable at a glance
 * from one a person wrote.
 */
function SuggestedAction({
  model,
  identity,
}: {
  model: AudienceModel
  identity: ReturnType<typeof useStore>['identity']
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ whatToPostNext: string; text: string; angle: string } | null>(
    null,
  )

  const generate = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const mod = await import('@/lib/post-idea')
      const loudest = model.platforms.find((p) => p.commentsRead > 0)
      const result = await mod.fetchPostIdea({
        person: {
          name: identity?.name ?? 'This office',
          role: identity?.role ?? null,
          party: identity?.party ?? null,
          constituency: identity?.constituency ?? null,
        },
        post: {
          platform: loudest?.platform ?? 'All platforms',
          publishedAt: null,
          title: 'What the audience has been saying across the accounts',
        },
        landed: [
          `Across ${model.commentsRead} comments read under ${model.postsRead} posts, the split is ${model.positive}% positive, ${model.neutral}% neutral and ${model.negative}% negative.`,
          ...model.platforms
            .filter((p) => p.commentsRead > 0)
            .map(
              (p) =>
                `${p.platform}: ${p.commentsRead} comments, ${p.positive}% positive, read as ${p.label}.`,
            ),
        ],
        about: model.topics
          .slice(0, 5)
          .map((t) => `${t.topic} is the topic on ${t.pct}% of the posts read in full.`),
        audience: model.quotes
          .filter((q) => q.side !== 'neutral')
          .slice(0, 8)
          .map((q) => q.text),
        notes: [
          model.praise.length > 0
            ? `Words recurring in the praise: ${model.praise.map((t) => t.term).join(', ')}.`
            : '',
          model.complaints.length > 0
            ? `Words recurring in the criticism: ${model.complaints.map((t) => t.term).join(', ')}.`
            : '',
          ...model.summaries.map((s) => `${s.platform}: ${s.text}`),
        ].filter(Boolean),
        // The comments are real and quoted; this is the audience speaking.
        hasComments: model.quotes.length > 0,
      })
      setDraft({
        whatToPostNext: result.whatToPostNext,
        text: result.idea.text,
        angle: result.idea.angle,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The suggestion could not be drafted.')
    } finally {
      setBusy(false)
    }
  }, [model, identity])

  return (
    <Panel
      title="Suggested action"
      sub="An AI suggestion, not a measurement."
      icon={<Lightbulb size={14} className="text-[var(--accent)]" aria-hidden />}
      hint="The only card on this screen that is not a measurement, and the only one that costs a live model call."

      className="h-full"
    >
      {draft ? (
        <>
          <p className="text-[11.5px] leading-relaxed text-ink-2">{draft.whatToPostNext}</p>
          <div className="mt-2 rounded-[var(--radius-md)] bg-[var(--pos-soft)] p-2.5">
            <p className="whitespace-pre-line text-[11px] leading-relaxed text-ink-2">
              {draft.text}
            </p>
          </div>
          <div className="mt-2">
            <Chip tone="accent">{draft.angle}</Chip>
          </div>
        </>
      ) : (
        <p className="text-[11.5px] leading-relaxed text-ink-3">
          Nothing drafted yet.
        </p>
      )}
      {error && <p className="mt-2 text-[11px] leading-relaxed text-[var(--neg)]">{error}</p>}
      <Button size="sm" variant="outline" className="mt-3" onClick={generate} disabled={busy}>
        {busy ? (
          <>
            <LoaderCircle size={14} className="animate-spin" aria-hidden />
            Drafting
          </>
        ) : (
          <>
            <Sparkles size={14} aria-hidden />
            {draft ? 'Generate again' : 'Generate suggested post'}
          </>
        )}
      </Button>
    </Panel>
  )
}

/* ── the second view ─────────────────────────────────────────────────────── */

/** Account by account, and then what none of it can tell the office. */
function MentionsOverview({
  model,
  readPlatforms,
}: {
  model: AudienceModel
  readPlatforms: number
}) {
  return (
    <div className="space-y-3">
      <Panel
        title="Account by account"
        sub={`${readPlatforms} of your ${model.platforms.length} accounts have had their comments read.`}
        icon={<Users size={14} className="text-[var(--accent)]" aria-hidden />}
      >
        <ul className="space-y-2">
          {model.platforms.map((p) => (
            <li
              key={`${p.platform}-${p.handle}`}
              className="rounded-[var(--radius-md)] border border-[var(--rule)] p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <PlatformBadge platform={p.platform} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{p.platform}</span>
                  <span className="block text-[11px] text-ink-3">{p.handle}</span>
                </span>
                {p.commentsRead > 0 ? (
                  <Chip tone={p.positive >= 15 ? 'positive' : undefined}>
                    {sentenceCase(p.label)}
                  </Chip>
                ) : (
                  <Chip>Not read</Chip>
                )}
              </div>
              {p.commentsRead > 0 ? (
                <>
                  <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
                    <div style={{ width: `${p.positive}%`, background: 'var(--chart-pos)' }} />
                    <div style={{ width: `${p.neutral}%`, background: 'var(--chart-mid)' }} />
                    <div style={{ width: `${p.negative}%`, background: 'var(--chart-neg)' }} />
                  </div>
                  <p className="tnum mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-ink-3">
                    <span>{p.commentsRead} comments</span>
                    <span>under {p.postsRead} posts</span>
                    <span style={{ color: 'var(--pos)' }}>{p.positive}% positive</span>
                    <span style={{ color: 'var(--warn)' }}>{p.neutral}% neutral</span>
                    <span style={{ color: 'var(--neg)' }}>{p.negative}% negative</span>
                  </p>
                </>
              ) : (
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">{p.note}</p>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="What this screen cannot tell you"
        sub="Stated rather than left for somebody to assume."
        icon={<Info size={14} className="text-[var(--accent)]" aria-hidden />}
      >
        <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-ink-2">
          <li className="flex items-start gap-1.5">
            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--accent)]" />
            How many separate people wrote these comments. No platform publishes it. The names
            tile counts distinct names on the {model.storedComments} comments kept in full, which
            is a sample of the {model.commentsRead} counted.
          </li>
          <li className="flex items-start gap-1.5">
            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--accent)]" />
            Whether any of this is going up or down. This desk holds one comment reading per
            account rather than a series, so there is no previous week to compare against and no
            arrow is drawn.
          </li>
          <li className="flex items-start gap-1.5">
            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--accent)]" />
            What a comment thread was about. The topics ring is counted over the{' '}
            {model.postsAnalysed} posts read in full, not over the comments under them.
          </li>
          <li className="flex items-start gap-1.5">
            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--accent)]" />
            Everything here rests on {model.commentsRead} comments counted under {model.postsRead}{' '}
            of your {model.postsStored} stored posts, of which {model.quotes.length} are shown
            word for word.
          </li>
        </ul>
      </Panel>
    </div>
  )
}

/* ── the header ──────────────────────────────────────────────────────────── */

function Header({ model, onClose }: { model: AudienceModel; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="flex items-center gap-1.5 text-[clamp(1.35rem,1.1rem+0.9vw,1.6rem)] font-bold tracking-[-0.022em]">
          What people are saying about you
          <span
            className="text-ink-3"
            title={`Counted from ${model.commentsRead} comments read under ${model.postsRead} of your ${model.postsStored} stored posts. Nothing here is estimated.`}
          >
            <Info size={15} aria-hidden />
          </span>
        </h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
          Conversations, comments and mentions about you across your accounts.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span
          className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-3.5 text-[12.5px] font-medium text-ink-2 shadow-[var(--e1)]"
          title="A comment reading is taken per account, not per day, so there is one reading to show rather than a window to choose."
        >
          <MessageSquare size={14} className="text-ink-3" aria-hidden />
          Latest reading
        </span>
        <Button
          variant="outline"
          onClick={() => downloadComments(model)}
          disabled={model.quotes.length === 0}
        >
          <Download size={15} aria-hidden />
          Export Report
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Back
        </Button>
      </div>
    </div>
  )
}

/**
 * The comments as a spreadsheet, with the side and the source on each row.
 *
 * Written here rather than through lib/export because that module exports
 * whole post readings, and what an office wants off this screen is the
 * comments themselves.
 */
function downloadComments(model: AudienceModel): void {
  const esc = (v: string | number | null): string => {
    const t = v == null ? '' : String(v)
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const rows = [
    ['Platform', 'Account', 'Author', 'Published', 'Likes', 'Side', 'Comment'],
    ...model.quotes.map((q) => [
      q.platform,
      q.handle,
      q.author ?? '',
      q.publishedAt ?? '',
      q.likes ?? '',
      q.side ?? 'not scored',
      q.text,
    ]),
  ]
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'comments.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/** Comment counts, for the dashboard card's own header. */
export const audienceTotals = (m: AudienceModel): string =>
  `${compact(m.commentsRead)} comments · ${m.postsRead} posts`

/** Kept so the empty state can still show a mascot where a screen wants one. */
export const AudienceMascot = Mascot
