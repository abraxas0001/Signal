import { useCallback, useEffect, useMemo, useState } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import {
  ArrowRight,
  AtSign,
  BarChart3,
  ChevronRight,
  Download,
  ExternalLink,
  Frown,
  Info,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  MessageSquare,
  Meh,
  Smile,
  Sparkles,
  ThumbsUp,
  TriangleAlert,
  Users,
} from 'lucide-react'
import type { Report } from '@shared/types'
import { EMOTION_GLYPH } from '@shared/taxonomy'
import type { Emotion } from '@shared/taxonomy'
import { Button, Card, Chip, Empty, selectClass, Shell } from './ui'
import { DonutBreakdown, PlatformBadge } from '@/components/kit'
import { Mascot } from './Mascot'
import { listHandles, type TrackedHandle } from '@/lib/handles'
import { loadPostReports } from '@/lib/post-reports'
import { useStore } from '@/lib/store'
import { scoreAll } from '@/lib/read-standing'
import { audienceOf, type AudienceModel, type QuotedComment } from '@/lib/audience'
import { cleanQuote, cn, compact, relativeTime } from '@/lib/utils'
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

/**
 * HOW THE AUDIENCE FELT, OVER THE POSTS THE AUDIENCE ANSWERED.
 *
 * `audienceOf` sums `analysis.emotions` across every own post carrying a full
 * reading, and a reading made with no comments in front of it recorded the
 * register of the POST rather than any feeling of anybody's. On the demo desk
 * 23 of the 68 read posts have no comments and 2,113 of the 5,580 emotion
 * weight, 37.9% of it, came from them; the "Anticipation 17%" tile drew 57%
 * of its own weight from posts nobody had replied to. The panel is headed
 * "How do people feel about you?", so that mixture answered a question about
 * the audience with the office's own writing, and the sentence admitting it
 * was passed as a `hint`, which Panel renders as a hover title: invisible on
 * a phone.
 *
 * The per-post view has refused to show these emotions on a comment-less post
 * for exactly this reason. This is that rule applied to the same numbers on
 * the desk-wide screen, with the denominator printed under the title and the
 * posts that were left out named in the panel rather than on a hover.
 */
function answeredEmotions(
  handles: TrackedHandle[],
  reports: Map<string, Report> | null,
): {
  shares: { emotion: string; pct: number; posts: number }[]
  /** Read posts that drew at least one real comment, which the shares are over. */
  answered: number
  /** Read posts in total, so the panel can say how many it left out. */
  read: number
} {
  /* The same basis `audienceOf` uses, so this panel covers the accounts the
     rest of the screen is captioned with. */
  const ownMarked = handles.filter((h) => h.own)
  const own = ownMarked.length > 0 ? ownMarked : handles
  const urls = new Set(own.flatMap((h) => (h.snapshots.at(-1)?.posts ?? []).map((p) => p.url)))

  const weight = new Map<string, { weight: number; posts: number }>()
  let answered = 0
  let read = 0
  for (const [url, report] of reports?.entries() ?? []) {
    if (!urls.has(url) || !report.analysis) continue
    read += 1
    /* Cleaned before it counts, like every other comment surface: a row that
       was only the platform's Like and Reply furniture is not an answer. */
    const spoken = (report.snapshot.comments ?? []).some((c) => cleanQuote(c.text ?? '').length > 0)
    if (!spoken) continue
    answered += 1
    for (const e of report.analysis.emotions ?? []) {
      const prev = weight.get(e.emotion) ?? { weight: 0, posts: 0 }
      weight.set(e.emotion, { weight: prev.weight + e.weight, posts: prev.posts + 1 })
    }
  }

  const total = [...weight.values()].reduce((s, e) => s + e.weight, 0)
  const shares = [...weight.entries()]
    .map(([emotion, v]) => ({
      emotion,
      posts: v.posts,
      pct: total > 0 ? Math.round((v.weight / total) * 100) : 0,
    }))
    .filter((e) => e.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6)
  return { shares, answered, read }
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

/**
 * A tint per emotion, so the row of tiles reads without being read.
 *
 * The tint is the whole of the identity now. Each tile used to print its
 * percentage in its own saturated hue — Joy in brown on peach, Disgust in
 * olive on pale green — so six figures that belong to one row were six
 * different colours of text, two of them muddy. The reference prints all six
 * in the same near-black and lets the tile carry the colour, which is what
 * these do.
 */
const EMOTION_TINT: Record<string, { bg: string; fg: string }> = {
  Joy: { bg: 'rgba(245,158,11,0.14)', fg: '#b45309' },
  Trust: { bg: 'rgba(16,185,129,0.14)', fg: '#047857' },
  Anticipation: { bg: 'rgba(139,92,246,0.14)', fg: '#6d28d9' },
  Surprise: { bg: 'rgba(14,165,233,0.14)', fg: '#0369a1' },
  Sadness: { bg: 'rgba(59,130,246,0.14)', fg: '#1d4ed8' },
  Fear: { bg: 'rgba(99,102,241,0.14)', fg: '#4338ca' },
  Anger: { bg: 'rgba(239,68,68,0.14)', fg: '#b91c1c' },
  Disgust: { bg: 'rgba(132,204,22,0.16)', fg: '#4d7c0f' },
  /* The catch-all wore a near-black border against five pastel siblings, which
     read as a focus ring or an error state on the one tile that means neither.
     It is soft and quiet like the rest, and grey because it is not a feeling. */
  /* --ink-N is a Tailwind colour alias, not a CSS variable: `var(--ink-2)`
     resolved to nothing here, so this tile's border fell back to currentColor
     and drew near-black against five pastel siblings. The raw token. */
  Other: { bg: 'var(--surface-2)', fg: 'var(--text-3)' },
}

/**
 * The topic ring's colours — one per named topic, and grey for the bucket.
 *
 * The shared categorical set holds five, and this legend runs to seven rows,
 * so the ramp wrapped: Governance and Elections were both --chart-1 blue and
 * Development Works and "Other topics" were both --chart-2 orange. Two pairs
 * of arcs you could not tell apart, and the fold-up bucket painted the single
 * loudest colour on the card.
 *
 * Six named hues, then grey. The sixth is the palette's green, which is
 * theme-aware and was re-stepped to clear 3:1 against both surfaces — a raw
 * hex would have gone muddy on the dark ground. It lands last, on the smallest
 * named topic, where its ring neighbours are the pink of slot five and the
 * grey of the bucket, never the teal of slot three.
 */
const TOPIC_HUES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-pos)',
] as const

/** Recessed on purpose: the fold-up bucket must never outrank a real topic. */
const TOPIC_OTHER_HUE = 'var(--border-strong)'

/** True for the "Other topics (N)" row `audienceOf` pushes on at the end. */
const topicHue = (i: number, of: number, folded: boolean): string =>
  folded && i === of - 1 ? TOPIC_OTHER_HUE : (TOPIC_HUES[Math.min(i, TOPIC_HUES.length - 1)] as string)

/**
 * One headline figure, shaped to the reference's slim tile.
 *
 * ONE BASELINE ACROSS ALL FIVE. Three of the five labels are too long to sit
 * on one line in a fifth of this row, so they wrapped and pushed their figures
 * a line below the two that did not: the row read as broken alignment before
 * it read as anything else. The label block is now two lines tall whether it
 * needs one line or two, so a wrap can never move the number under it.
 *
 * AND NOTHING EXPLANATORY ON THE FACE. Tiles 4–5 used to print a grey sentence
 * in the slot where the reference draws a trend arrow ("on the 136 comments
 * that show a like count"). This desk holds one reading rather than a series,
 * so there is no arrow to draw — and a caveat is not a substitute for one. The
 * slot stays empty; the denominator travels on the element as a hover title.
 */
function Tile({
  label,
  value,
  icon,
  tint,
  bar,
  hint,
}: {
  label: string
  value: string
  icon: React.ReactNode
  tint: { bg: string; fg: string }
  /** 0…1, drawn as the reference's progress rule under the figure. */
  bar?: number
  /** What the figure rests on, carried on the element rather than printed. */
  hint?: string
}) {
  return (
    <Card className="p-4" title={hint}>
      <div className="flex items-start gap-2.5">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full"
          style={{ background: tint.bg, color: tint.fg }}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          {/* Exactly two lines' worth of room, always — see the note above.
              The height is set here rather than in a class because the utility
              line-height did not survive, and a label block that is 30px on one
              tile and 32.5px on the next puts the figures back on two
              baselines, which is the whole defect this is here to prevent. */}
          <p
            className="text-[12px] font-medium text-ink-3"
            style={{ lineHeight: '16px', minHeight: 32 }}
          >
            {label}
          </p>
          <p className="tnum mt-1 text-[24px] font-bold leading-none tracking-[-0.02em]">
            {value}
          </p>
        </div>
      </div>
      {bar != null && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
          {/* A real 4% has to read as a bar rather than as a stray bullet, so
              the fill carries its floor in pixels and not in percent. */}
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, bar * 100)}%`,
              minWidth: 8,
              background: tint.fg,
            }}
          />
        </div>
      )}
    </Card>
  )
}

/**
 * A titled panel, so the eight of them share one rhythm.
 *
 * NO LEADING ICON, and Title Case. Every heading on this screen used to carry
 * a blue glyph — a speech bubble on the topics card, a smiley on the emotions
 * card, a sparkle on the summary — six marks the reference does not have, all
 * in the accent colour, all competing with the one place the reference does
 * spend an icon: the thumb and the warning triangle over the two theme lists.
 */
function Panel({
  title,
  sub,
  action,
  children,
  className,
  hint,
}: {
  title: string
  sub?: string
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
          <p className="text-[14px] font-bold tracking-[-0.01em]">{title}</p>
          {sub && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{sub}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3 min-w-0 flex-1">{children}</div>
    </Card>
  )
}

/**
 * A label and a count, which is the shape of both theme lists.
 *
 * The count is near-black on both sides. Colouring the praise counts green and
 * the complaint counts red said what the heading glyph already says, twice, in
 * the loudest ink on the card — and the reference keeps its counts neutral for
 * exactly that reason.
 */
function ThemeRow({ term, count }: { term: string; count: number }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1">
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{term}</span>
      <span className="tnum shrink-0 text-[11.5px] font-bold text-ink">{count}</span>
    </li>
  )
}

/**
 * The rail's comments on one side, grouped by what each was ABOUT.
 *
 * `theme` is the classifier's two-to-four-word subject for one comment, so a
 * row here is "how many comments on this side gave this reason" — reasons,
 * not recurring vocabulary. Grouping runs over the rail's own set, which is
 * what keeps every consumer narrowing with the rail by construction.
 */
function themeRows(
  set: QuotedComment[],
  side: 'positive' | 'negative',
): { term: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const q of set) {
    if (q.side !== side || !q.theme) continue
    counts.set(q.theme, (counts.get(q.theme) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
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

/**
 * The comments on one side, for when no word recurs across them.
 *
 * A word has to appear in two or more comments before it is a theme rather
 * than a turn of phrase, and an account reading quotes only a handful a side —
 * so on most desks these panels sat empty while the desk held the very
 * comments that explain the reading. The words are the better summary when
 * they exist; the comments are the honest answer when they do not.
 */
function SideQuotes({
  quotes,
  tone,
}: {
  quotes: { text: string }[]
  tone: 'pos' | 'neg'
}) {
  const skin =
    tone === 'pos'
      ? { fill: 'var(--pos-soft)', text: 'var(--pos)' }
      : { fill: 'var(--neg-soft)', text: 'var(--neg)' }
  return (
    <ul className="space-y-1.5">
      {quotes.slice(0, 3).map((q, i) => (
        <li
          key={`${q.text}-${i}`}
          className="rounded-[8px] px-2 py-1.5 text-[11.5px] leading-relaxed"
          style={{ background: skin.fill, color: skin.text }}
        >
          &ldquo;{q.text.length > 130 ? `${q.text.slice(0, 130)}…` : q.text}&rdquo;
        </li>
      ))}
    </ul>
  )
}

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
  /**
   * Bumped after a scoring run so the model is rebuilt from the standings
   * that run just wrote. `listHandles()` is a disk read, and the memo below
   * hangs off it — without this the screen would keep rendering the pre-scoring
   * answer until something else happened to remount it.
   */
  const [scoredAt, setScoredAt] = useState(0)
  const handles = useMemo(() => listHandles(), [scoredAt])
  const model: AudienceModel = useMemo(
    () => audienceOf(handles, reports),
    [handles, reports, scoredAt],
  )

  /** Null when idle; otherwise what the scoring run is doing right now. */
  const [scoring, setScoring] = useState<string | null>(null)
  const [scoreNote, setScoreNote] = useState<string | null>(null)

  /**
   * Run the reading that assigns sides, here, where the problem is visible.
   *
   * It already existed as a per-row button on the Accounts screen, which is
   * UNLISTED — so the desk that shows "Not scored" against a hundred comments
   * had no reachable way to do anything about it.
   */
  const runScoring = useCallback(async () => {
    const targets = handles.filter((h) => h.own)
    const list = targets.length > 0 ? targets : handles
    if (list.length === 0) return
    setScoreNote(null)
    setScoring('Starting…')
    const results = await scoreAll(list, (done, total, current) =>
      setScoring(current ? `Reading ${current} (${done + 1} of ${total})…` : 'Finishing…'),
    )
    setScoring(null)
    setScoredAt((n) => n + 1)
    const ok = results.filter((r) => r.scored)
    const read = ok.reduce((s, r) => s + r.commentsRead, 0)
    setScoreNote(
      ok.length === 0
        ? (results.find((r) => r.reason)?.reason ?? 'Nothing could be scored just now.')
        : `Scored ${read} comment${read === 1 ? '' : 's'} across ${ok.length} account${ok.length === 1 ? '' : 's'}.`,
    )
  }, [handles])

  const [tab, setTab] = useState<Tab>('saying')
  const [side, setSide] = useState<Side>('all')
  const [platform, setPlatform] = useState<string | null>(null)
  /** The comments card's sort. Every option orders a real stored field. */
  const [sort, setSort] = useState<'relevant' | 'newest' | 'liked'>('relevant')
  const [showAllPraise, setShowAllPraise] = useState(false)
  const [showAllComplaints, setShowAllComplaints] = useState(false)
  /** Whether the topic legend unfolds the "Other topics (N)" bucket. */
  const [showAllTopics, setShowAllTopics] = useState(false)

  /** The emotion half, over the posts that drew comments and no others.
      Narrowed by the rail like every other panel: the mix genuinely differs by
      account (Twitter/X reads 47% Trust where YouTube reads 27% Joy), so a
      frozen grid over a selected account answered the wrong question. */
  const feelings = useMemo(
    () => answeredEmotions(platform ? handles.filter((h) => h.platform === platform) : handles, reports),
    [handles, reports, platform],
  )

  /**
   * The comments, most informative first.
   *
   * A row that carries a name and a date is worth more to an office than one
   * that carries only words, and the two sources feeding this list are sorted
   * differently by accident of how they were read. Ordering by what a row
   * actually knows puts the fullest evidence at the top without dropping
   * anything: everything is still in the list, and the count says how many.
   */
  /**
   * THE PLATFORM RAIL NOW REACHES THE PANELS BESIDE THE LIST.
   *
   * Pressing Instagram filtered the comment list and nothing else: "What they
   * praised", "What they objected to" and the whole Quick summary went on
   * reading `model.quotes`, the desk's every comment, so the reader picked a
   * platform, watched the rail light up, and saw the same three quotes and the
   * same denominators as before. That reads as broken software, and the
   * office said so.
   *
   * This is the rail's set and ONLY the rail's: the side filter belongs to the
   * list below and must not reach the panels, which split by side themselves.
   */
  const onPlatform = useMemo(
    () => (platform ? model.quotes.filter((q) => q.platform === platform) : model.quotes),
    [model, platform],
  )

  /**
   * THE FIGURES THE RAIL GOVERNS, RESOLVED ONCE.
   *
   * The rail narrowed the comment list and left every headline behind it: with
   * Facebook pressed the tiles still read "Positive 14% of 280" while the rail
   * row an inch to the left said Facebook is 3% positive of 72. The screen was
   * showing two different answers to the same question at the same time, and
   * the larger type was the wrong one.
   *
   * `voice` is that account's own survey, which the model already carries per
   * platform; null means All, where the desk-wide totals are the right answer.
   * Nothing is computed here that was not already read — the scope narrows,
   * the arithmetic does not change.
   */
  const voice = useMemo(
    () => (platform ? (model.platforms.find((v) => v.platform === platform) ?? null) : null),
    [model, platform],
  )
  const shown = useMemo(
    () => ({
      positive: voice ? voice.positive : model.positive,
      neutral: voice ? voice.neutral : model.neutral,
      negative: voice ? voice.negative : model.negative,
      commentsRead: voice ? voice.commentsRead : model.commentsRead,
    }),
    [voice, model],
  )

  /**
   * The two comment-level tiles, counted over whatever the rail has in view.
   *
   * They were read off the desk-wide model and never moved, so a "126 distinct
   * names" tile could sit directly above a fifteen-comment YouTube list. Both
   * count over the same set as the list beneath them now.
   */
  const railTiles = useMemo(() => {
    if (!platform) {
      return {
        likes: model.commentLikes,
        likesOver: model.commentLikesOver,
        names: model.distinctAuthors,
        named: model.authoredComments,
      }
    }
    const withLikes = onPlatform.filter((q) => q.likes != null)
    const named = onPlatform.filter((q) => q.author != null && q.author !== '')
    return {
      likes: withLikes.length > 0 ? withLikes.reduce((a, q) => a + (q.likes ?? 0), 0) : null,
      likesOver: withLikes.length,
      names: new Set(named.map((q) => q.author)).size,
      named: named.length,
    }
  }, [platform, onPlatform, model])

  /** The topic ring's set: the selected account's own, or the whole desk's. */
  const railTopics = useMemo(
    () =>
      platform
        ? (model.byPlatform[platform] ?? { topics: [], topicPosts: 0 })
        : { topics: model.topics, topicPosts: model.topicPosts },
    [model, platform],
  )

  const quotes = useMemo(() => {
    const rank = (q: QuotedComment): number =>
      (q.side ? 2 : 0) + (q.author ? 2 : 0) + (q.publishedAt ? 1 : 0)
    /* "Newest" and "Most liked" order real stored fields; a row that never
       published the field sorts after every row that did, fullest evidence
       first within the tie. Nothing is estimated to break a tie. */
    const when = (q: QuotedComment): number => {
      const t = q.publishedAt ? Date.parse(q.publishedAt) : Number.NaN
      return Number.isNaN(t) ? -1 : t
    }
    const order = (a: QuotedComment, b: QuotedComment): number => {
      if (sort === 'newest') return when(b) - when(a) || rank(b) - rank(a)
      if (sort === 'liked') return (b.likes ?? -1) - (a.likes ?? -1) || rank(b) - rank(a)
      return rank(b) - rank(a)
    }
    return model.quotes
      .filter((q) => (side === 'all' || q.side === side) && (!platform || q.platform === platform))
      .slice()
      .sort(order)
  }, [model, side, platform, sort])

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
  const positiveQuotes = onPlatform.filter((q) => q.side === 'positive').length
  const negativeQuotes = onPlatform.filter((q) => q.side === 'negative').length
  const scored = onPlatform.filter((q) => q.side !== null).length
  const unscored = onPlatform.length - scored
  /* Grouped by the classifier's per-comment subject, over the rail's own set —
     which is what keeps both halves of the praise card narrowing with it. */
  const praiseThemes = themeRows(onPlatform, 'positive')
  const complaintThemes = themeRows(onPlatform, 'negative')
  /* The topics folded into "Other topics (N)", for the View-all expansion. */
  const railTopicTail = platform
    ? (model.byPlatform[platform]?.topicTail ?? [])
    : model.topicTail

  return (
    <Shell className="stack">
      <m.div variants={listStagger} initial={reduce ? false : 'hidden'} animate="show">
        <m.div variants={fadeUp}>
          <Header model={model} onClose={onClose} />
        </m.div>

        {/*
          Whose comments these are, said out loud when it is not the desk's.

          `audienceOf` falls back to every tracked account when nothing is
          marked as the desk's, because discarding hundreds of stored comments
          and printing "none have been read" was false. But the fallback must
          never be silent either: a watched account's comment section is
          somebody else's reception, and this screen is captioned with the
          office's own name everywhere else.
        */}
        {model.basis === 'all-tracked' && (
          <m.div variants={fadeUp} className="mt-3">
            <Card tone="accent">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-bold">
                    These are comments on every account you follow
                  </p>
                  <p className="mt-1 max-w-[64ch] text-xs leading-relaxed text-ink-2">
                    No account is marked as this desk&rsquo;s, so this cannot be called your
                    reception yet &mdash; some of it may be a rival&rsquo;s. Mark the accounts that
                    belong to {store.identity?.name ?? 'this desk'} and every figure here narrows
                    to yours.
                  </p>
                </div>
                <Button size="sm" className="shrink-0" onClick={onOpenAccounts}>
                  Mark mine
                  <ArrowRight size={15} aria-hidden />
                </Button>
              </div>
            </Card>
          </m.div>
        )}

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
              <p className="text-[13px] font-bold">All Platforms</p>
              <button
                type="button"
                onClick={() => setPlatform(null)}
                aria-pressed={platform === null}
                /* The reconciliation sentence, carried on the figure it
                   qualifies rather than printed as a paragraph on the page. */
                title={`The account surveys' bulk count: ${model.positive}% positive, ${model.neutral}% neutral, ${model.negative}% negative over ${model.commentsRead} comments. The panels below count the ${model.quotes.length} comments this desk holds word for word — a different, smaller set, so the totals are not meant to match.`}
                className={cn(
                  'mt-2 flex w-full items-center gap-2.5 rounded-[var(--radius-md)] border p-2.5 text-left transition-colors',
                  platform === null
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--border-interactive)]',
                )}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--surface)] text-[var(--accent)]">
                  <MessageSquare size={16} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10.5px] leading-tight text-ink-3">
                    Total Comments Analysed
                  </span>
                  <span className="tnum block text-[18px] font-bold leading-tight">
                    {compact(model.commentsRead)}
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
                        <PlatformBadge platform={p.platform} size={26} className="rounded-[8px]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold">
                            {p.platform}
                          </span>
                          <span className="block truncate text-[10px] text-ink-3">
                            {p.commentsRead > 0 ? `${p.commentsRead} comments` : 'not read'}
                          </span>
                        </span>
                        <ChevronRight size={13} className="shrink-0 text-ink-3" aria-hidden />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {/* Pinned to the foot so the card fills its column rather than
                  stopping short and leaving blank page under it. */}
              <div className="mt-auto pt-3">
                {/* One line. "Open your accounts" wrapped in this column and
                    stranded its icon on the left, so the button looked half
                    drawn. */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full whitespace-nowrap"
                  style={{
                    color: 'var(--accent)',
                    borderColor: 'color-mix(in oklab, var(--accent) 45%, transparent)',
                  }}
                  onClick={onOpenAccounts}
                >
                  <BarChart3 size={14} aria-hidden />
                  Your Accounts
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
                  {/*
                    THE FIRST THREE ARE THE SURVEYS' SPLIT. The panels further
                    down count the comments this desk holds word for word; the
                    surveys walked each account in bulk over a wider set. The
                    two do not match and cannot be made to, and each figure's
                    hover title says which set it was counted over.
                  */}
                  {/* "Overall sentiment" over a 14% that sits beside "Neutral
                      82%" reads as a score out of a hundred, and it is not one
                      — it is the positive share of the same three-way split
                      the next two tiles carry. Named for what it measures. */}
                  <Tile
                    label="Positive"
                    value={`${shown.positive}%`}
                    hint={`Praise, thanks and support: ${shown.positive}% of the ${shown.commentsRead} comments the account surveys counted in bulk${voice ? ` on ${voice.platform}` : ''}. The comments quoted below are the ${onPlatform.length} held word for word — a different, smaller set, so the totals are not meant to match.`}
                    icon={<Smile size={17} aria-hidden />}
                    tint={{ bg: 'var(--pos-soft)', fg: 'var(--pos)' }}
                    bar={shown.positive / 100}
                  />
                  <Tile
                    label="Neutral"
                    value={`${shown.neutral}%`}
                    hint={`Greetings, tags and plain reactions, of the same ${shown.commentsRead} comments the surveys counted.`}
                    icon={<Meh size={17} aria-hidden />}
                    tint={{ bg: 'var(--warn-soft)', fg: 'var(--chart-mid)' }}
                    bar={shown.neutral / 100}
                  />
                  <Tile
                    label="Negative"
                    value={`${shown.negative}%`}
                    hint={`Criticism, demands and anger, of the same ${shown.commentsRead} comments the surveys counted.`}
                    icon={<Frown size={17} aria-hidden />}
                    tint={{ bg: 'var(--neg-soft)', fg: 'var(--neg)' }}
                    bar={shown.negative / 100}
                  />
                  {/* The reference's "Engagement on Comments", printed with
                      its real denominator in the slot where the reference
                      draws a trend arrow — one reading, no series, no arrow. */}
                  <Tile
                    label="Likes on Comments"
                    value={railTiles.likes == null ? 'NA' : compact(railTiles.likes)}
                    hint={`Likes other readers gave the comments themselves, over the ${railTiles.likesOver} comments that show a like count. Almost nobody likes a comment on a politician's post, so this is usually very small; it is printed as a count with its denominator rather than as a share that would flatter it. No trend arrow: this desk holds one reading per account, not a series.`}
                    icon={<ThumbsUp size={17} aria-hidden />}
                    tint={{ bg: 'var(--accent-soft)', fg: 'var(--accent)' }}
                  />
                  {/* The reference's "Unique People Talking", now under that
                      name at the owner's order. The figure is the count of
                      distinct commenter IDs on the comments kept in full;
                      the denominators moved behind the hover so the tile
                      reads like the reference's. */}
                  <Tile
                    label="Unique People Talking"
                    value={compact(railTiles.names)}
                    hint={`Distinct commenter IDs on the ${railTiles.named} comments that carry one, of ${model.storedComments} stored whole. An ID is not quite a person — one person under two accounts counts twice. No trend arrow: this desk holds one reading per account, not a series.`}
                    icon={<Users size={17} aria-hidden />}
                    tint={{ bg: 'var(--info-soft)', fg: 'var(--info)' }}
                  />
                </m.div>

                <m.div
                  variants={fadeUp}
                  /* items-start, so the emotions card ends with its tiles. It
                     was stretched to the topics card beside it and left a hole
                     where the reference's "View emotion trends over time" link
                     sits — a link this desk cannot honour, holding one reading
                     per account and no series. The space goes with it. */
                  className="grid items-start gap-3 @2xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]"
                >
                  {/* ── topics ─────────────────────────────────────────── */}
                  {/*
                    HEADED FOR WHAT IT COUNTS. This ring is built from the topic
                    each POST was read as being about — one entry per post of
                    the desk's own — so "What are people talking about?" named
                    the audience over a measurement of the office's own output,
                    and the admission sat two cards away in a disclosure list.
                    No platform publishes what a comment thread was about, so
                    the ring cannot be rebuilt over comments; the title moves to
                    the thing that is actually on the screen. Deliberate
                    divergence from the reference, which heads it at the
                    audience.
                  */}
                  <Panel
                    title="What Your Posts Are About"
                    sub={`Topics across ${railTopics.topicPosts} of your${voice ? ` ${voice.platform}` : ''} posts read in full.`}
                    hint="Counted over posts, not comments. A reading assigns one topic to a post; no platform publishes what a comment thread was about, so there is nothing honest to count a comment-side ring over."
                  >
                    {railTopics.topics.length === 0 ? (
                      <p className="text-[11.5px] leading-relaxed text-ink-3">
                        No post of yours has a full reading yet, so no topic is recorded.
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center justify-center gap-4">
                        <DonutBreakdown
                          size={166}
                          thickness={24}
                          segments={railTopics.topics.map((t, i) => ({
                            label: String(t.topic),
                            value: t.posts,
                            color: topicHue(i, railTopics.topics.length, railTopicTail.length > 0),
                          }))}
                          centerLabel={String(railTopics.topicPosts)}
                          centerSub="posts"
                          className="shrink-0"
                        />
                        <ul className="flex min-w-[190px] flex-1 flex-col justify-center gap-1.5">
                          {(showAllTopics && railTopicTail.length > 0
                            ? [...railTopics.topics.slice(0, -1), ...railTopicTail]
                            : railTopics.topics
                          ).map((t, i) => (
                            <li key={String(t.topic)} className="flex items-center gap-2">
                              <span
                                aria-hidden
                                className="size-2 shrink-0 rounded-full"
                                style={{
                                  /* An unfolded tail row keeps the colour of
                                     the "Other" arc it is a slice of. */
                                  background: topicHue(
                                    Math.min(i, railTopics.topics.length - 1),
                                    railTopics.topics.length,
                                    railTopicTail.length > 0,
                                  ),
                                }}
                              />
                              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">
                                {t.topic}
                              </span>
                              {/* The reference's third column is a second,
                                  different measure — comments under those
                                  posts. This desk counts posts, and the base
                                  is exactly 100 of them, so the column printed
                                  "29% 29" down every row and read as a
                                  rendering fault. The ring's centre already
                                  says what the base is. Deliberate divergence:
                                  the second measure does not exist here. */}
                              <span className="tnum shrink-0 text-[11.5px] font-bold">
                                {t.pct}%
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {railTopicTail.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowAllTopics((v) => !v)}
                        className="mt-3 inline-flex min-h-8 items-center gap-1 self-start rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-3 text-[11.5px] font-semibold text-[var(--accent)] transition-colors hover:border-[var(--border-interactive)]"
                      >
                        {showAllTopics ? 'Show fewer topics' : 'View all topics'}
                        <ArrowRight size={12} aria-hidden />
                      </button>
                    )}
                  </Panel>

                  {/* ── emotions ───────────────────────────────────────── */}
                  <Panel
                    title="How People Feel About You"
                    sub={`From the comments on ${feelings.answered} of your ${feelings.read} posts read in full.`}
                    hint="An emotion is read out of the reply thread, so a post nobody answered has no audience feeling to read. Readings made with no comments in front of them record the post's own register, not the audience's, and are left out of these shares. No trend link: this desk holds one reading per account rather than a series, so there is no emotion series to open."
                  >
                    {feelings.shares.length === 0 ? (
                      <p className="text-[11.5px] leading-relaxed text-ink-3">
                        {feelings.read === 0
                          ? 'No post of yours has a full reading yet.'
                          : `None of your ${feelings.read} posts read in full drew a comment, so there is no audience feeling to show. What those posts themselves say is on the post pages.`}
                      </p>
                    ) : (
                      <ul className="grid grid-cols-3 content-start gap-2 @md:grid-cols-6">
                        {feelings.shares.map((e) => {
                          const tint = EMOTION_TINT[String(e.emotion)] ?? EMOTION_TINT['Other']!
                          return (
                            <li
                              key={String(e.emotion)}
                              className="flex flex-col items-center justify-center rounded-[var(--radius-md)] border px-2.5 py-3.5 text-center"
                              style={{
                                background: tint.bg,
                                borderColor: `color-mix(in oklab, ${tint.fg} 22%, transparent)`,
                              }}
                              title={`${e.pct}% of the emotion weight the readings recorded across the ${feelings.answered} answered posts. It was recorded at all on ${e.posts} of them.`}
                            >
                              <span className="text-[24px] leading-none">
                                {EMOTION_GLYPH[e.emotion as Emotion] ?? '\u{1F4AD}'}
                              </span>
                              <p className="mt-1.5 text-[11px] font-medium text-ink-2">
                                {e.emotion}
                              </p>
                              {/* ONE MEASURE PER TILE. This used to print the
                                  weighted share and, under it, the number of
                                  posts the emotion was recorded on — so Joy
                                  34% and Trust 28% both read "43 posts", two
                                  percentages over one denominator that cannot
                                  produce either. The share is the measure; the
                                  post count is on the hover, where it is a
                                  provenance note rather than a second figure
                                  pretending to reconcile with the first. */}
                              <p className="tnum mt-1 text-[19px] font-bold leading-none text-ink">
                                {e.pct}%
                              </p>
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

          </div>

          {tab === 'saying' && (
                <m.div
                  variants={fadeUp}
                  /* Full width, below the rail: the office asked for the rail to end
                     with the row above and this card to take the freed space.
                     The comments side leads the split now — it is the reading
                     surface; the roll-ups ride beside it. */
                  className="mt-3 grid gap-3 @2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"
                >
                  {/* ── the comments themselves ────────────────────────── */}
                  <Panel
                    title="What People Are Saying In Comments"
                    sub={`${quotes.length} real comments${platform ? ` on ${platform}` : ' across your accounts'}.`}
                    hint={`${scored} of the ${onPlatform.length} carry a side from the readings. ${railTiles.named} carry the name the platform published; the comment readings count and quote but do not keep an author.`}
                    action={
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {/* The scoring run, relocated from the banner the
                            reference has no room for. Only offered while
                            something is actually unscored. */}
                        {/* A quiet text action, not a pill. As an outlined
                            button beside the sort control it carried the same
                            weight as the sort control and read as the primary
                            call to action in a list header — which is not what
                            a maintenance run is. */}
                        {unscored > 0 && (
                          <button
                            type="button"
                            onClick={() => void runScoring()}
                            disabled={scoring !== null}
                            title={`${unscored} of ${onPlatform.length} comments were stored whole by post readings, which keep the words but score nothing. Reading an account's opinion is what assigns positive, neutral or negative.`}
                            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)] disabled:opacity-45"
                          >
                            {scoring !== null ? (
                              <>
                                <LoaderCircle size={12} className="animate-spin" aria-hidden />
                                Reading
                              </>
                            ) : (
                              'Score these'
                            )}
                          </button>
                        )}
                        <label className="sr-only" htmlFor="audience-comment-sort">
                          Sort comments
                        </label>
                        <select
                          id="audience-comment-sort"
                          value={sort}
                          onChange={(e) => setSort(e.target.value as typeof sort)}
                          className={selectClass}
                        >
                          <option value="relevant">Most relevant</option>
                          <option value="newest">Newest</option>
                          <option value="liked">Most liked</option>
                        </select>
                      </div>
                    }
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

                    {/* What the scoring run is doing, and what it did. */}
                    {scoring !== null && (
                      <p className="mt-2 text-[11px] font-medium text-[var(--accent)]">{scoring}</p>
                    )}
                    {scoreNote !== null && scoring === null && (
                      <p className="mt-2 text-[11px] font-medium text-ink-2">{scoreNote}</p>
                    )}

                    {quotes.length === 0 ? (
                      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
                        {side === 'neutral'
                          ? 'These readings quoted no neutral comments for this account.'
                          : 'No comment on this side was quoted for this account.'}
                      </p>
                    ) : (
                      /* Whitespace separates these rows, as in the reference.
                         A full-width rule between every row drew six lines down
                         a card whose job is to be read. */
                      <ul className="mt-1">
                        {quotes.slice(0, showAll ? quotes.length : 6).map((q, i) => (
                          <CommentRow key={`${q.platform}-${i}`} q={q} />
                        ))}
                      </ul>
                    )}
                    {quotes.length > 6 && (
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

                  {/* The right column: one split praise/complaints card,
                      the three-way summary, and the action strip pinned to
                      the foot so the column bottom-aligns with the comments. */}
                  <div className="flex min-w-0 flex-col gap-3">
                    <Card className="@container p-4">
                      <div className="grid gap-4 @md:grid-cols-2 @md:gap-0">
                        <div className="min-w-0 @md:pr-4">
                          <p
                            className="flex items-center gap-1.5 text-[13px] font-bold tracking-[-0.01em]"
                            title={`Grouped by what each comment was about, from ${positiveQuotes} praising of the ${onPlatform.length} comments held word for word.`}
                          >
                            <ThumbsUp
                              size={14}
                              fill="currentColor"
                              className="text-[var(--pos)]"
                              aria-hidden
                            />
                            Top Praise &amp; Appreciation
                          </p>
                          {praiseThemes.length > 0 ? (
                            <>
                              <ul className="mt-2">
                                {(showAllPraise ? praiseThemes : praiseThemes.slice(0, 4)).map(
                                  (t) => (
                                    <ThemeRow key={t.term} term={sentenceCase(t.term)} count={t.count} />
                                  ),
                                )}
                              </ul>
                              {praiseThemes.length > 4 && (
                                <button
                                  type="button"
                                  onClick={() => setShowAllPraise((v) => !v)}
                                  className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)]"
                                >
                                  {showAllPraise ? 'Show fewer' : 'View all praise'}
                                  <ArrowRight size={12} aria-hidden />
                                </button>
                              )}
                            </>
                          ) : positiveQuotes > 0 ? (
                            /* No praising comment on this rail set carries a
                               theme, so the comments themselves are the
                               honest answer. */
                            <div className="mt-2">
                              <SideQuotes
                                tone="pos"
                                quotes={onPlatform.filter((q) => q.side === 'positive')}
                              />
                            </div>
                          ) : (
                            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
                              The readings quoted no praising comments.
                            </p>
                          )}
                        </div>
                        <div className="min-w-0 border-t border-[var(--rule)] pt-4 @md:border-l @md:border-t-0 @md:pl-4 @md:pt-0">
                          <p
                            className="flex items-center gap-1.5 text-[13px] font-bold tracking-[-0.01em]"
                            title={`Grouped by what each comment was about, from ${negativeQuotes} critical of the ${onPlatform.length} comments held word for word.`}
                          >
                            <TriangleAlert
                              size={14}
                              fill="currentColor"
                              className="text-[var(--neg)]"
                              aria-hidden
                            />
                            Top Complaints &amp; Concerns
                          </p>
                          {complaintThemes.length > 0 ? (
                            <>
                              <ul className="mt-2">
                                {(showAllComplaints
                                  ? complaintThemes
                                  : complaintThemes.slice(0, 4)
                                ).map((t) => (
                                  <ThemeRow key={t.term} term={sentenceCase(t.term)} count={t.count} />
                                ))}
                              </ul>
                              {complaintThemes.length > 4 && (
                                <button
                                  type="button"
                                  onClick={() => setShowAllComplaints((v) => !v)}
                                  className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)]"
                                >
                                  {showAllComplaints ? 'Show fewer' : 'View all complaints'}
                                  <ArrowRight size={12} aria-hidden />
                                </button>
                              )}
                            </>
                          ) : negativeQuotes > 0 ? (
                            <div className="mt-2">
                              <SideQuotes
                                tone="neg"
                                quotes={onPlatform.filter((q) => q.side === 'negative')}
                              />
                            </div>
                          ) : (
                            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
                              {`Not one of the ${onPlatform.length} comments held word for word reads as critical. That is a finding, not a gap.`}
                            </p>
                          )}
                        </div>
                      </div>
                    </Card>

                    {/* Natural heights, strip snug beneath the summary — the
                        office's words: "move suggested action up to close the
                        space". The earlier fix stretched the summary card to
                        fill the column, which just moved the void inside the
                        card; this keeps every card its content's size. */}
                    <QuickSummary model={model} platform={platform} />
                    <SuggestedAction model={model} identity={store.identity} />
                  </div>
                </m.div>
          )}
        </div>
      </m.div>
    </Shell>
  )
}

/* ── one comment ─────────────────────────────────────────────────────────── */

function CommentRow({ q }: { q: QuotedComment }) {
  const tone = q.side ? SIDE_TONE[q.side] : null
  return (
    <li className="flex items-start gap-2.5 py-2">
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
          /* Normal inline flow rather than a flex row: the reference's
             separator dot has to stay attached to the name when the line wraps
             on a phone, and a flex child cannot. */
          <p className="text-[10.5px] leading-relaxed text-ink-3">
            {q.author && <span className="font-semibold text-ink">{q.author}</span>}
            {q.author && q.publishedAt && <span aria-hidden>{' · '}</span>}
            {q.publishedAt && <span>{relativeTime(q.publishedAt)}</span>}
          </p>
        )}
        {/* No quote marks. Every row on this card is a comment, the reference
            sets them plain, and curly quotes around Telugu script and emoji
            made the words harder to read rather than easier to place. */}
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-2">{q.text}</p>
        <p className="tnum mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-ink-3">
          {/* The like slot is reserved whether or not this comment carries a
              count, so the actions line up down the card instead of stepping
              left on every row the platform published no figure for. */}
          <span className="inline-flex w-8 shrink-0 items-center gap-1">
            {q.likes != null && q.likes > 0 && (
              <>
                <ThumbsUp size={10} aria-hidden />
                {q.likes}
              </>
            )}
          </span>
          {/* The comment's own post, so the office can check the desk's
              reading against the platform. Only a comment stored BY a post
              reading knows which post it was on — the account survey quotes
              across many without recording which — so the link appears
              exactly where it can land on the right thing. */}
          {q.postUrl && (
            <a
              href={q.postUrl}
              target="_blank"
              rel="noreferrer noopener"
              title="Open the post this comment is under"
              className="inline-flex items-center gap-1 font-semibold text-[var(--accent)]"
            >
              View post
              <ExternalLink size={10} aria-hidden />
            </a>
          )}
        </p>
      </div>
      {tone ? (
        <Chip tone={tone.chip}>{sentenceCase(q.side!)}</Chip>
      ) : (
        <Chip title="This comment was stored whole by a post reading, which does not score a side.">
          Not scored
        </Chip>
      )}
    </li>
  )
}

/* ── the three-way summary ───────────────────────────────────────────────── */

/**
 * The reference's "Quick Summary". Every line is either a word the readings
 * counted or a sentence the readings wrote; none of it is composed here.
 */
function QuickSummary({
  model,
  platform,
}: {
  model: AudienceModel
  /** The rail's selection, or null for the whole desk. */
  platform: string | null
}) {
  /**
   * "What it means for you" printed summaries[0] under every rail state, so
   * with YouTube selected the two quote columns beside it narrowed correctly
   * to three YouTube comments while this column went on quoting the FACEBOOK
   * reading — one card stating a conclusion about an account the reader was
   * not looking at.
   */
  const summaries = platform
    ? model.summaries.filter((s) => s.platform === platform)
    : model.summaries
  return (
    <Panel
      title="What It Means For You"
      hint="Straight from the reading, in its own sentence. Nothing here is composed by this screen — which is also why the reference's two summary lists are gone: rephrasing a reading is writing, and repeating it word for word is what those lists were doing."
    >
      {/*
        THE TWO LIST PANELS ARE GONE. "What people like" listed Party support,
        National pride, Praise for leader, Support for modi and "What people do
        not like" listed Private medical shop, Railway connectivity, Authenticity
        concern, Caste appointments — all eight verbatim duplicates of the praise
        and complaints card sitting about 150px above, so the block summarised
        nothing. The reference rephrases them; rephrasing a reading is composing
        text about a real person, which this desk does not do. Deliberate
        divergence: the summary keeps the one thing the readings actually wrote.
      */}
      <div className="rounded-[var(--radius-md)] bg-[var(--accent-soft)] p-3">
          {summaries.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-ink-3">
              {platform
                ? `No reading has written a summary for ${platform} yet.`
                : 'No reading has written a summary yet.'}
            </p>
          ) : (
            /* No clamp. Six lines cut this reading in the middle of the word
               "explicit" with nothing to press to see the rest — a real
               sentence a real reading wrote, truncated mid-word on the face of
               the card. The panel grows to hold it. */
            <p className="text-[11px] leading-relaxed text-ink-2">{summaries[0]!.text}</p>
          )}
      </div>
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
  className,
}: {
  model: AudienceModel
  identity: ReturnType<typeof useStore>['identity']
  className?: string
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
    /*
      A TINTED STRIP, NOT A PEER CARD. This was a full white card with the
      lightbulb in a 56px pale circle and a solid blue button dropped on its own
      second row — the loudest thing in the column, louder than any reading on
      the screen, for the one element here that measures nothing. The reference
      makes it a pale strip with a bare glyph and an outlined secondary button
      sitting inline on the right, and so does this.
    */
    <div
      className={cn(
        '@container rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--accent)_18%,transparent)] bg-[var(--accent-soft)] px-4 py-3',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Lightbulb size={17} className="shrink-0 text-[var(--accent)]" aria-hidden />
        <div className="min-w-0 flex-1 basis-48">
          {/* "An AI suggestion, not a measurement" is a caveat, and a caveat
              belongs on the hover rather than on the face of the strip. */}
          <p
            className="text-[13px] font-bold tracking-[-0.01em]"
            title="An AI suggestion, not a measurement — the only thing on this screen that is not counted, and the only one that costs a live model call."
          >
            Suggested Action
          </p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-2">
            {draft ? draft.whatToPostNext : 'Nothing drafted yet.'}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          style={{ color: 'var(--accent)' }}
          className="shrink-0"
          onClick={generate}
          disabled={busy}
        >
          {busy ? (
            <>
              <LoaderCircle size={14} className="animate-spin" aria-hidden />
              Drafting
            </>
          ) : (
            <>
              <Sparkles size={14} aria-hidden />
              {draft ? 'Generate again' : 'Generate post'}
            </>
          )}
        </Button>
      </div>
      {error && <p className="mt-2 text-[11px] leading-relaxed text-[var(--neg)]">{error}</p>}
      {draft && (
        <>
          <div className="mt-3 rounded-[var(--radius-md)] bg-[var(--surface)] p-2.5">
            <p className="whitespace-pre-line text-[11px] leading-relaxed text-ink-2">
              {draft.text}
            </p>
          </div>
          <div className="mt-2">
            <Chip tone="accent">{draft.angle}</Chip>
          </div>
        </>
      )}
    </div>
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
        title="Account By Account"
        sub={`${readPlatforms} of your ${model.platforms.length} accounts have had their comments read.`}
      >
        <ul className="space-y-2">
          {model.platforms.map((p) => (
            <li
              key={`${p.platform}-${p.handle}`}
              className="rounded-[var(--radius-md)] border border-[var(--rule)] p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <PlatformBadge platform={p.platform} size={26} className="rounded-[8px]" />
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
        title="What This Screen Cannot Tell You"
        sub="Stated rather than left for somebody to assume."
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
            {/* "Of which" made one set out of two. The surveys counted 280 in
                bulk and the desk holds 182 word for word; the second is not a
                subset of the first, and saying it was turned two measurements
                into one number nobody could check. */}
            Two reads sit under this screen and they cover different comments. The account surveys
            counted {model.commentsRead} comments under {model.postsRead} of your{' '}
            {model.postsStored} stored posts, keeping a handful of them word for word. Between
            those and the comments stored by post readings, {model.quotes.length} are held word for
            word, and those are the ones quoted, sided and linked here.
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
          What People Are Saying About You
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
        {/* Three controls, one weight. "Export Report" was a size larger and
            heavier than the reading pill beside it, and "Back" was bare bold
            text with no container floating at the far right, which read as an
            element somebody had not finished. The absent date-range control is
            a deliberate divergence: one reading per account, no window. */}
        <span
          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm font-medium text-ink-2 shadow-[var(--e1)]"
          title="A comment reading is taken per account, not per day, so there is one reading to show rather than a window to choose."
        >
          <MessageSquare size={14} className="text-ink-3" aria-hidden />
          Latest reading
        </span>
        <Button
          size="sm"
          variant="outline"
          style={{ color: 'var(--accent)' }}
          onClick={() => downloadComments(model)}
          disabled={model.quotes.length === 0}
        >
          <Download size={15} aria-hidden />
          Export Report
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>
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
