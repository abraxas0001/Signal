import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Heart,
  Lightbulb,
  LoaderCircle,
  MapPin,
  MessageSquare,
  PenLine,
  Quote,
  Share2,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  X,
} from 'lucide-react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import type { Report } from '@shared/types'
import { EMOTION_GLYPH } from '@shared/taxonomy'
import type { Emotion } from '@shared/taxonomy'
import { Button, Card, Chip, Empty, Shell } from './ui'
import { DonutBreakdown, DonutGauge, PlatformBadge, PostPicture } from '@/components/kit'
import { listHandles, readStandingCache, type TrackedHandle } from '@/lib/handles'
import { loadPostReports } from '@/lib/post-reports'
import { useStore } from '@/lib/store'
import { bestReceived, highlightsOf, worstReceived, type Highlight } from '@/lib/highlights'
import { WINDOWS, inWindow, newestPostDate, windowStart, type WindowId } from '@/lib/window'
import { downloadCsv } from '@/lib/export'
import { cn, compact } from '@/lib/utils'
import { fadeUp, listStagger } from '@/lib/motion'
import type { PostIdeaEntry } from '@/lib/post-idea'

/**
 * Post Highlights, built to the product owner's reference design.
 *
 * The shape is the reference's: a header with a window picker and an export,
 * four underlined lenses, a horizontal strip of ranked post cards with an
 * arrow at each edge, one expanded post opened underneath in a grid of ten
 * numbered blocks, and the rest of the ranking as rows below.
 *
 * WHAT THE REFERENCE ASKS FOR THAT THIS DESK CANNOT HONESTLY PRODUCE, AND WHAT
 * SITS IN THOSE SLOTS INSTEAD. This is the whole of the difference, written
 * down, because a monitoring tool whose claim is that it catches unsupported
 * statements cannot make them:
 *
 *   Block 2's ring is drawn in the reference as the positive, neutral and
 *   negative split OF ONE POST'S COMMENTS. No such field exists and none can
 *   be derived: a stored comment carries text, an author, likes and a date,
 *   and nothing about its tone. The sample would not carry it either, because
 *   41 of the 55 read posts have no retrievable comments at all and the best
 *   of the remaining 14 has nine, against this codebase's own floor of thirty
 *   for scoring a split. So the ring shows the split that IS measured, the one
 *   for the whole account, and says on its face that it is the account's and
 *   not the post's.
 *
 *   The reference's second headline tile is "Reach". The nearest stored field
 *   is an estimated impressions figure, and it is a model's guess rather than
 *   a reading: on most posts it repeats the view count, on one it repeats the
 *   follower count, and on Instagram it comes back as zero over posts with
 *   five thousand likes. It is not shown. The tile carries views where a
 *   platform published them and says which platform did.
 *
 *   Blocks 3, 5 and 6 are drawn with a percentage against every row. Topics,
 *   entities and credibility signals carry no count, no weight and no
 *   frequency anywhere in a reading, so those percentages would be invented
 *   outright. The rows are shown without them, and where the reading recorded
 *   a stance or a direction that is shown instead, because that is real.
 *
 * Blocks 9 and 10 are the only two on the screen that are not measurements.
 * They are a model's opinion about what to do next, they cost a live call, and
 * they say so.
 */

/* ── the loader ──────────────────────────────────────────────────────────── */

/**
 * The stored readings, loaded when this screen opens.
 *
 * Loaded here rather than handed down from the app shell: the shell mounts
 * before the desk's storage scope is settled, and a load that runs then sees
 * the empty default and caches it, which is exactly how this screen came to
 * say "none has been analysed" over a hundred readings that existed.
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

/* ── small helpers ───────────────────────────────────────────────────────── */

type Lens = 'overall' | 'platform' | 'positive' | 'negative'

const LENSES: { id: Lens; label: string }[] = [
  { id: 'overall', label: 'Overall (Top 5)' },
  { id: 'platform', label: 'By Platform' },
  { id: 'positive', label: 'Top Positive' },
  { id: 'negative', label: 'Top Negative' },
]

const dayOf = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Date not published'

const dayTimeOf = (iso: string | null): string => {
  if (!iso) return 'Date not published'
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  // A date stored with no time on it is midnight, and printing "12:00 am"
  // would state a publication time the platform never gave.
  return d.getHours() === 0 && d.getMinutes() === 0 ? day : `${day} · ${time}`
}

/** The face beside the score on a strip card, matching its tone. */
const scoreFace = (score: number): string =>
  score >= 15 ? '\u{1F60A}' : score <= -15 ? '\u{1F620}' : '\u{1F610}'

const toneColour = (score: number): string =>
  score >= 15 ? 'var(--pos)' : score <= -15 ? 'var(--neg)' : 'var(--warn)'

/**
 * A tint per emotion, so the row of faces reads at a glance.
 *
 * All nine circles were one grey, which made the row a wall of identical
 * discs and put the whole burden of telling joy from anger on a 15px emoji.
 * Warm for the warm feelings, red for anger, blue for the low ones, and grey
 * only for "Other", which genuinely has no character to carry.
 */
const EMOTION_TINT: Record<string, string> = {
  Joy: 'rgba(245,158,11,0.16)',
  Trust: 'rgba(16,185,129,0.16)',
  Anticipation: 'rgba(139,92,246,0.16)',
  Surprise: 'rgba(14,165,233,0.16)',
  Sadness: 'rgba(59,130,246,0.16)',
  Fear: 'rgba(99,102,241,0.16)',
  Anger: 'rgba(239,68,68,0.16)',
  Disgust: 'rgba(132,204,22,0.18)',
  Other: 'var(--surface-3)',
}

/* ── the numbered block ──────────────────────────────────────────────────── */

/**
 * One of the ten panels, all the same width and all the same internal rhythm.
 *
 * The owner asked for equally sized boxes and consistent spacing, so the
 * heading, the sub-line and the body are laid out here once rather than at ten
 * call sites where they would drift apart within a week. `h-full` against a
 * stretching grid is what actually squares the row: a card sized to its own
 * content leaves a ragged bottom edge across five columns.
 */
function Block({
  n,
  title,
  sub,
  icon,
  children,
}: {
  n: number
  title: string
  sub: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="flex items-start gap-1.5 text-[12.5px] font-bold leading-snug tracking-[-0.01em]">
        <span className="mt-px shrink-0 text-[var(--accent)]">{icon}</span>
        <span className="min-w-0">
          {n}. {title}
        </span>
      </p>
      <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">{sub}</p>
      <div className="mt-2.5 min-w-0 flex-1">{children}</div>
    </section>
  )
}

function Nothing({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-ink-3">{children}</p>
}

/**
 * One published figure, or an absence that says it is one.
 *
 * Four of these share a single bordered box divided by hairlines, which is
 * how the reference draws them. Four separately tinted tiles read as four
 * unrelated cards and fought the two boxed rates directly underneath.
 */
function Metric({ label, value, icon }: { label: string; value: number | null; icon: ReactNode }) {
  return (
    <div className="min-w-0 px-1 py-1.5 text-center">
      <p className="tnum text-[14px] font-bold leading-none">
        {value == null ? (
          <span className="text-ink-3" title={`${label} was not published for this post.`}>
            NA
          </span>
        ) : (
          compact(value)
        )}
      </p>
      <p className="mt-1 flex items-center justify-center gap-0.5 text-[9px] font-medium text-ink-3">
        {icon}
        {label}
      </p>
    </div>
  )
}

/** A boxed figure with the thing it was measured against printed under it. */
function Basis({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-md)] border border-[var(--rule)] px-2 py-1.5">
      <p className="text-[9px] font-medium uppercase tracking-[0.04em] text-ink-3">{label}</p>
      <p className="tnum mt-0.5 text-[15px] font-bold leading-none">{value}</p>
      <p className="mt-1 text-[9px] leading-relaxed text-ink-3">{note}</p>
    </div>
  )
}

/** A named group inside the mentions block, with the stance the reading gave. */
function NameGroup({
  title,
  icon,
  names,
}: {
  title: string
  icon: ReactNode
  names: { name: string; stance?: string | null }[]
}) {
  if (names.length === 0) return null
  return (
    <div>
      <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.04em] text-ink-3">
        {icon}
        {title}
      </p>
      {/* Rows, not chips. The reference lays each mention out as a line with
          something in the right-hand column, and it puts a share there. There
          is no share to put: a reading names each of these exactly once, so
          the column carries the stance it recorded, which is real. */}
      <ul className="mt-1 space-y-0.5">
        {names.slice(0, 5).map((p) => (
          <li key={p.name} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{
                background:
                  p.stance === 'praised'
                    ? 'var(--pos)'
                    : p.stance === 'criticised'
                      ? 'var(--neg)'
                      : 'var(--ink-3)',
              }}
            />
            <span className="min-w-0 flex-1 truncate text-[10px] text-ink-2">{p.name}</span>
            {p.stance && p.stance !== 'mentioned' && (
              <span
                className="shrink-0 text-[9px] font-semibold"
                style={{
                  color:
                    p.stance === 'praised'
                      ? 'var(--pos)'
                      : p.stance === 'criticised'
                        ? 'var(--neg)'
                        : 'var(--ink-3)',
                }}
              >
                {p.stance}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── blocks 9 and 10 ─────────────────────────────────────────────────────── */

/**
 * The only two blocks on this screen that are not measurements.
 *
 * Everything else here is a reading this desk has already paid for and stored.
 * These two are a model's opinion about what to do next, they cost a live call
 * each time they are generated, and they say so on their face. Nothing is
 * pre-filled: a tinted box holding a ready-to-paste post is indistinguishable
 * at a glance from one a person wrote, so it stays empty until somebody asks.
 */
function PostIdeaBlocks({ h }: { h: Highlight }) {
  const store = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [entry, setEntry] = useState<PostIdeaEntry | null>(null)

  // Re-read as the selection changes, so stepping through the strip never
  // shows one post's draft under another post's heading.
  useEffect(() => {
    let alive = true
    void (async () => {
      const mod = await import('@/lib/post-idea').catch(() => null)
      if (!alive || !mod) return
      setEntry(mod.readPostIdea(h.url) ?? null)
      setError(null)
      setCopied(false)
    })()
    return () => {
      alive = false
    }
  }, [h.url])

  const generate = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const mod = await import('@/lib/post-idea')
      const a = h.report.analysis
      const comments = h.report.snapshot.comments ?? []
      const result = await mod.fetchPostIdea({
        person: {
          name: store.identity?.name ?? 'This office',
          role: store.identity?.role ?? null,
          party: store.identity?.party ?? null,
          constituency: store.identity?.constituency ?? null,
        },
        post: { platform: h.platform, publishedAt: h.publishedAt, title: h.title },
        landed: [
          `The reading scored it ${h.score > 0 ? '+' : ''}${h.score} out of 100 and called it ${
            a?.sentiment.label ?? 'unread'
          }.`,
          h.reactionsNote,
          h.versusTypical
            ? `That is ${Math.abs(Math.round(h.versusTypical.pct))}% ${
                h.versusTypical.pct >= 0 ? 'above' : 'below'
              } the mean of ${h.versusTypical.baseline} reactions across the ${
                h.versusTypical.posts
              } posts this desk holds for the account.`
            : (h.versusNote ?? ''),
        ].filter(Boolean),
        about: [
          a?.summary ?? '',
          a?.topics?.primary ? `The reading filed it under ${a.topics.primary}.` : '',
          ...(a?.keyPoints ?? []).slice(0, 4),
        ].filter(Boolean),
        audience: comments.slice(0, 6).map((c) => c.text),
        notes: [...(a?.observations ?? []).slice(0, 3), a?.civic?.suggestedAction ?? ''].filter(
          Boolean,
        ),
        hasComments: h.hasComments,
      })
      // Stored before the state is set, so a reader who leaves mid-generation
      // still has the answer they paid for when they come back.
      setEntry(mod.savePostIdea(h.url, result))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The suggestion could not be drafted.')
    } finally {
      setBusy(false)
    }
  }, [h, store.identity])

  const copy = useCallback(() => {
    if (!entry) return
    void navigator.clipboard.writeText(entry.idea.text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }, [entry])

  return (
    <>
      <Block
        n={9}

        icon={<Sparkles size={13} aria-hidden />}
        title="What To Post Next"
        sub="An AI suggestion, not a measurement. This one costs a live call."
      >
        {entry ? (
          /* Clamped, because this one paragraph was setting the height of the
             whole second row: four neighbouring blocks carried two hundred
             pixels of empty card each so that a model's answer could run to
             fourteen lines. The full text is one hover away. */
          <p
            className="line-clamp-6 text-[10.5px] leading-relaxed text-ink-2"
            title={entry.whatToPostNext}
          >
            {entry.whatToPostNext}
          </p>
        ) : (
          <Nothing>
            No suggestion has been drafted for this post yet.{' '}
            {h.hasComments
              ? `It will be written from this post's reading and the ${
                  h.report.snapshot.comments?.length ?? 0
                } comments stored with it.`
              : 'It will be written from this post’s reading alone.'}
          </Nothing>
        )}
        {error && <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--neg)]">{error}</p>}
        <Button size="sm" variant="outline" className="mt-2.5" onClick={generate} disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle size={13} className="animate-spin" aria-hidden />
              Drafting
            </>
          ) : (
            <>
              <Sparkles size={13} aria-hidden />
              {entry ? 'Generate again' : 'Generate Post Idea'}
            </>
          )}
        </Button>
      </Block>

      <Block n={10} icon={<PenLine size={13} aria-hidden />} title="Suggested Post Idea" sub="A draft to check and edit, never to send unread">
        {entry ? (
          <div className="flex h-full flex-col">
            <div className="rounded-[var(--radius-md)] bg-[var(--pos-soft)] p-2.5">
              <p
                className="line-clamp-6 whitespace-pre-line text-[10.5px] leading-relaxed text-ink-2"
                title={entry.idea.text}
              >
                {entry.idea.text}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Chip>{entry.idea.platform}</Chip>
              <Chip tone="accent">{entry.idea.angle}</Chip>
            </div>
            <button
              type="button"
              onClick={copy}
              className="mt-2 inline-flex min-h-8 items-center gap-1.5 self-start rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[10.5px] font-semibold text-[var(--accent)] shadow-[var(--e1)] transition-colors hover:border-[var(--border-interactive)]"
            >
              {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
              {copied ? 'Copied' : 'Use this idea'}
              <ArrowRight size={11} aria-hidden />
            </button>
          </div>
        ) : (
          <Nothing>No draft yet. Press Generate Post Idea in the block beside this one.</Nothing>
        )}
      </Block>
    </>
  )
}

/* ── the ten blocks ──────────────────────────────────────────────────────── */

function Reading({
  h,
  all,
  handles,
  onOpenReport,
}: {
  h: Highlight
  /**
   * Every post that carries a reading, so a topic chip can print a share with
   * a denominator the office can check. The reference puts a percentage on
   * each topic; there is none per post, because a reading assigns a topic
   * rather than weighing it. There IS one across the desk, and that is what
   * these show, labelled as such on hover.
   */
  all: Highlight[]
  handles: TrackedHandle[]
  onOpenReport: (r: Report) => void
}) {
  /**
   * The account's own comment split, which is the only measured one.
   *
   * Read off the handle this post belongs to. Where a handle has never had its
   * comments read the block says so rather than drawing an empty ring.
   */
  const standing = useMemo(() => {
    const handle = handles.find((x) => x.own && x.platform === h.platform)
    const st = handle ? readStandingCache(handle.id) : null
    return st && st.source !== 'record' ? st : null
  }, [handles, h.platform])

  const a = h.report.analysis
  if (!a) return <Nothing>This reading did not come back with an analysis.</Nothing>

  const comments = h.report.snapshot.comments ?? []
  const emotions = a.emotions ?? []
  const emotionTotal = emotions.reduce((s, e) => s + e.weight, 0) || 1
  const people = (a.entities ?? []).filter((e) => e.kind === 'person')
  const orgs = (a.entities ?? []).filter((e) => e.kind === 'organisation')
  const places = a.reach?.places ?? []
  const signals = a.credibility?.signals ?? []
  const tags = [
    ...new Set([...(h.report.snapshot.content.hashtags ?? []), ...(a.topics?.tags ?? [])]),
  ]
  const quotes = a.notableQuotes ?? []
  const observations = a.observations ?? []
  const schemes = (a.entities ?? []).filter((e) => e.kind === 'scheme')
  const claims = a.credibility?.checkableClaims ?? []

  /**
   * How often each of this post's topics turns up across every post the desk
   * has read. A real share with a real denominator, which is the nearest
   * honest thing to the reference's per-topic percentage.
   */
  const readWithTopic = all.filter((x) => x.report.analysis?.topics?.primary)
  const topicShare = (topic: string): number | null => {
    if (readWithTopic.length < 4) return null
    const hits = readWithTopic.filter((x) => {
      const t = x.report.analysis?.topics
      return t?.primary === topic || (t?.secondary ?? []).includes(topic as never)
    }).length
    return Math.round((hits / readWithTopic.length) * 100)
  }

  return (
    /* Container queries, not viewport breakpoints. This grid sits inside a
       240px navigation rail and a capped shell, so a 1440px laptop leaves it
       about 1180px and `2xl:` (1536px of VIEWPORT) never fired. The owner saw
       three columns where the reference draws five, at every window size short
       of 1700px. The question this layout is asking is how much room it has,
       so that is now the question it asks. */
    <div className="@container">
      <div className="grid items-stretch gap-2 @md:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-5">
      {/* ── 1 ────────────────────────────────────────────────────────────── */}
      <Block n={1} icon={<TrendingUp size={13} aria-hidden />} title="Overall Performance" sub="How this post landed with your audience">
        <div className="flex items-center gap-2.5">
          <DonutGauge
            value={h.scoreOutOf100}
            size={86}
            thickness={9}
            label={String(h.scoreOutOf100)}
            from={toneColour(h.score)}
            to={toneColour(h.score)}
            className="shrink-0"
          />
          <div className="min-w-0">
            <p
              className="text-[12.5px] font-bold leading-tight"
              style={{ color: toneColour(h.score) }}
            >
              {a.sentiment.label}
            </p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-ink-3">
              {h.hasComments
                ? 'How the audience answered, out of 100.'
                : 'Read from the post itself.'}
            </p>
          </div>
        </div>

        {/* The reference's green pill. Per platform, because the platform means
            are not comparable on this desk, and printed as a reason rather
            than a figure where the account publishes no reaction count. */}
        <div className="mt-2">
          {h.versusTypical ? (
            <p
              className="flex items-start gap-1.5 rounded-[var(--radius-md)] px-2 py-1.5 text-[10px] font-semibold leading-snug"
              style={{
                background: h.versusTypical.pct >= 0 ? 'var(--pos-soft)' : 'var(--neg-soft)',
                color: h.versusTypical.pct >= 0 ? 'var(--pos)' : 'var(--neg)',
              }}
              title={`Against a mean of ${h.versusTypical.baseline} reactions over the ${h.versusTypical.posts} posts this desk holds for the account.`}
            >
              <TrendingUp size={11} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                {h.versusTypical.pct >= 0 ? 'Performing ' : 'Drawing '}
                {Math.abs(Math.round(h.versusTypical.pct))}%{' '}
                {h.versusTypical.pct >= 0 ? 'better than' : 'below'} your average {h.platform} post
              </span>
            </p>
          ) : (
            <p className="rounded-[var(--radius-md)] bg-[var(--surface-2)] px-2 py-1.5 text-[10px] leading-relaxed text-ink-3">
              {h.versusNote}
            </p>
          )}
        </div>

        <div className="mt-2 grid grid-cols-4 divide-x divide-[var(--rule)] rounded-[var(--radius-md)] border border-[var(--rule)]">
          <Metric label="Likes" value={h.likes} icon={<Heart size={9} aria-hidden />} />
          <Metric label="Comments" value={h.comments} icon={<MessageSquare size={9} aria-hidden />} />
          <Metric label="Shares" value={h.shares} icon={<Share2 size={9} aria-hidden />} />
          <Metric label="Views" value={h.views} icon={<Eye size={9} aria-hidden />} />
        </div>

        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <Basis
            label="Engagement"
            value={h.engagement ? `${h.engagement.pct.toFixed(2)}%` : 'NA'}
            note={
              h.engagement
                ? h.engagement.basis === 'views'
                  ? `of ${compact(h.engagement.denominator)} views`
                  : `of ${compact(h.engagement.denominator)} followers, as last read`
                : 'No denominator available'
            }
          />
          <Basis
            label="Views"
            value={h.views == null ? 'NA' : compact(h.views)}
            note={
              h.views == null
                ? 'Not published'
                : `Published by ${h.platform}`
            }
          />
        </div>
      </Block>

      {/* ── 2 ────────────────────────────────────────────────────────────── */}
      <Block
        n={2}

        icon={<Sparkles size={13} aria-hidden />}
        title="Sentiment and Emotions"
        sub={
          h.hasComments
            ? `Emotions the reading found in the ${comments.length} comments stored with this post`
            : 'The register of the post itself'
        }
      >
        {standing ? (
          <>
            <div className="flex items-center gap-3">
              <DonutBreakdown
                size={88}
                thickness={13}
                segments={[
                  { label: 'Positive', value: standing.positive, color: 'var(--chart-pos)' },
                  { label: 'Neutral', value: standing.neutral, color: 'var(--chart-mid)' },
                  { label: 'Negative', value: standing.negative, color: 'var(--chart-neg)' },
                ]}
                className="shrink-0"
              />
              <ul className="min-w-0 space-y-1">
                {(
                  [
                    ['Positive', standing.positive, 'var(--chart-pos)'],
                    ['Neutral', standing.neutral, 'var(--chart-mid)'],
                    ['Negative', standing.negative, 'var(--chart-neg)'],
                  ] as const
                ).map(([label, n, colour]) => {
                  const total = standing.positive + standing.neutral + standing.negative || 1
                  return (
                    <li key={label} className="flex items-center gap-1.5 text-[10px]">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: colour }}
                      />
                      <span className="tnum font-bold">{Math.round((n / total) * 100)}%</span>
                      <span className="text-ink-2">{label}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
            {/* The split above is the account's, not this post's, and saying so
                is the difference between a measurement and a claim. */}
            <p className="mt-1.5 text-[9px] leading-relaxed text-ink-3">
              Across {standing.commentsRead} comments on your {h.platform} account, not this post
              alone. No platform publishes the tone of one post&rsquo;s comments.
            </p>
          </>
        ) : (
          <Nothing>No comments have been read on this account yet.</Nothing>
        )}

        {/* The reading's own reason for the label it gave. Present on every
            post, and the block was carrying a ring and a row of faces with
            nothing in words between them. */}
        <p className="mt-2 line-clamp-3 text-[10px] leading-relaxed text-ink-2">
          {a.sentiment.rationale}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {a.sentiment.tone && <Chip>{a.sentiment.tone}</Chip>}
          {a.sentiment.publicNarrative && a.sentiment.publicNarrative !== 'NA' && (
            <Chip tone="accent">{a.sentiment.publicNarrative}</Chip>
          )}
        </div>

        <p className="mt-2.5 text-[9px] font-semibold uppercase tracking-[0.04em] text-ink-3">
          Top emotions
        </p>
        {emotions.length === 0 ? (
          <Nothing>No emotion was recorded for this post.</Nothing>
        ) : (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {emotions.map((e) => (
              <li key={e.emotion} className="w-[44px] text-center">
                <span
                  className="mx-auto grid size-8 place-items-center rounded-full text-[15px]"
                  style={{ background: EMOTION_TINT[e.emotion] ?? 'var(--surface-3)' }}
                >
                  {EMOTION_GLYPH[e.emotion as Emotion] ?? '\u{1F4AD}'}
                </span>
                <p className="mt-0.5 truncate text-[9px] text-ink-3">{e.emotion}</p>
                <p className="tnum text-[10px] font-bold">
                  {((e.weight / emotionTotal) * 100).toFixed(1)}%
                </p>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {/* ── 3 ────────────────────────────────────────────────────────────── */}
      <Block
        n={3}

        icon={<MessageSquare size={13} aria-hidden />}
        title="What People Are Talking About"
        sub="The topic the reading assigned, and the post's own words"
      >
        <p className="text-[9px] font-semibold uppercase tracking-[0.04em] text-ink-3">Top topics</p>
        <ul className="mt-1.5 space-y-1">
          {[
            ...(a.topics?.primary ? [a.topics.primary as string] : []),
            ...((a.topics?.secondary ?? []) as string[]),
          ].map((t, i) => {
            const share = topicShare(t)
            return (
              <li key={t} className="flex items-center gap-1.5">
                <Chip tone={i === 0 ? 'accent' : undefined}>{t}</Chip>
                {share != null && (
                  <span
                    className="tnum shrink-0 text-[10px] font-semibold text-ink-3"
                    title={`${t} is the topic on ${share}% of the ${readWithTopic.length} posts this desk has read in full. A reading assigns one topic to a post rather than weighing it, so there is no share within this post to give.`}
                  >
                    {share}%
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        {a.topics?.subtopic && (
          <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-ink-2">
            {a.topics.subtopic}
          </p>
        )}

        <p className="mt-2.5 text-[9px] font-semibold uppercase tracking-[0.04em] text-ink-3">
          Top keywords
        </p>
        {tags.length === 0 ? (
          <Nothing>The post carried no hashtags and the reading assigned no tags.</Nothing>
        ) : (
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {tags.slice(0, 14).map((t) => (
              <li
                key={t}
                className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[9.5px] text-ink-2"
              >
                {t}
              </li>
            ))}
            {tags.length > 14 && (
              <li className="px-1 py-0.5 text-[9.5px] text-ink-3">+{tags.length - 14} more</li>
            )}
          </ul>
        )}

        {(a.keyPoints ?? []).length > 0 && (
          <>
            <p className="mt-2.5 text-[9px] font-semibold uppercase tracking-[0.04em] text-ink-3">
              What the post says
            </p>
            <ul className="mt-1 space-y-1">
              {(a.keyPoints ?? []).slice(0, 3).map((k, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span
                    aria-hidden
                    className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--accent)]"
                  />
                  <span className="line-clamp-2 text-[10px] leading-relaxed text-ink-2">{k}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Block>

      {/* ── 4 ────────────────────────────────────────────────────────────── */}
      <Block
        n={4}

        icon={<Quote size={13} aria-hidden />}
        title="Worth Highlighting"
        sub="Lines the reading pulled out, and comments where any were published"
      >
        {quotes.length > 0 && (
          <>
            <p className="text-[9px] font-semibold uppercase tracking-[0.04em] text-ink-3">
              From the post
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {quotes.slice(0, 2).map((q, i) => (
                <li key={i} className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-2">
                  <Quote size={10} className="text-ink-3 opacity-60" aria-hidden />
                  <p
                    className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-ink-2"
                    title={typeof q === 'string' ? q : q.original}
                  >
                    {typeof q === 'string' ? q : q.original}
                  </p>
                  {typeof q !== 'string' && q.translation && (
                    <p className="mt-0.5 line-clamp-1 text-[9px] italic leading-relaxed text-ink-3">
                      {q.translation}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="mt-2.5 text-[9px] font-semibold uppercase tracking-[0.04em] text-ink-3">
          From the audience
        </p>
        {comments.length === 0 ? (
          <Nothing>
            No comments are stored for this post.
          </Nothing>
        ) : (
          <>
            <ul className="mt-1.5 space-y-1.5">
              {comments.slice(0, 2).map((c, i) => (
                <li key={i} className="rounded-[var(--radius-md)] border border-[var(--rule)] p-2">
                  <p
                    className="line-clamp-2 text-[10px] leading-relaxed text-ink-2"
                    title={c.text}
                  >
                    {c.text}
                  </p>
                  {c.author && <p className="mt-1 text-[9px] text-ink-3">{c.author}</p>}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => onOpenReport(h.report)}
              className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--accent)]"
            >
              {comments.length > 2
                ? `View all ${comments.length} retrieved`
                : 'Open the full reading'}
              <ArrowRight size={11} aria-hidden />
            </button>
          </>
        )}
      </Block>

      {/* ── 5 ────────────────────────────────────────────────────────────── */}
      <Block
        n={5}

        icon={<Users size={13} aria-hidden />}
        title="Mentions Summary"
        sub="People, parties and places the reading named in this post"
      >
        {/* All four kinds a reading records, not two of them. Schemes were
            being dropped entirely, and they are named on fifteen of the
            fifty-five read posts. */}
        {people.length === 0 && orgs.length === 0 && places.length === 0 && schemes.length === 0 ? (
          <Nothing>The reading named nobody and nowhere in this post.</Nothing>
        ) : (
          <div className="space-y-1.5">
            <NameGroup title="People" icon={<Users size={9} aria-hidden />} names={people} />
            <NameGroup title="Parties and bodies" icon={<Users size={9} aria-hidden />} names={orgs} />
            <NameGroup title="Schemes" icon={<Target size={9} aria-hidden />} names={schemes} />
            {places.length > 0 && (
              <div>
                <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.04em] text-ink-3">
                  <MapPin size={9} aria-hidden />
                  Places
                </p>
                <ul className="mt-1 space-y-0.5">
                  {places.slice(0, 5).map((p) => (
                    <li key={p} className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full bg-[var(--accent)]"
                      />
                      <span className="min-w-0 flex-1 truncate text-[10px] text-ink-2">{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {a.reach?.scope && (
          <div className="mt-2 border-t border-[var(--rule)] pt-2">
            <p className="text-[9px] font-semibold uppercase tracking-[0.04em] text-ink-3">
              Where it travelled
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              <Chip>{a.reach.scope}</Chip>
              {a.reach.urbanRural && <Chip>{a.reach.urbanRural}</Chip>}
              {a.reach.amplifiedByPoliticalActors && <Chip tone="accent">Amplified politically</Chip>}
            </div>
            {(a.reach.amplifiers ?? []).length > 0 && (
              <p className="mt-1 line-clamp-2 text-[9.5px] leading-relaxed text-ink-3">
                Carried further by {a.reach.amplifiers.slice(0, 3).join(', ')}.
              </p>
            )}
          </div>
        )}
      </Block>

      {/* ── 6 ────────────────────────────────────────────────────────────── */}
      <Block
        n={6}

        icon={<BadgeCheck size={13} aria-hidden />}
        title="Credibility Check"
        sub="Whether anything in this post would survive a fact check"
      >
        {/* The reference puts the findings first and closes with the verdict
            chip, which is the order a fact check is actually read in. */}
        {signals.length === 0 && claims.length > 0 ? (
          <>
            <p className="text-[9px] font-semibold uppercase tracking-[0.04em] text-ink-3">
              Claims worth checking
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {claims.slice(0, 3).map((c, i) => (
                <li key={i}>
                  <p className="line-clamp-2 text-[10px] leading-relaxed text-ink-2">{c.claim}</p>
                  <p className="line-clamp-1 text-[9px] leading-relaxed text-ink-3">{c.why}</p>
                </li>
              ))}
            </ul>
          </>
        ) : signals.length === 0 ? (
          <p className="text-[10px] leading-relaxed text-ink-3">
            The reading recorded nothing for or against this post&rsquo;s verifiability.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {signals.slice(0, 4).map((s, i) => (
              <li key={i} className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 min-w-0 text-[10px] leading-relaxed text-ink-2">
                  {s.signal}
                </span>
                <span
                  className="shrink-0 text-[9px] font-semibold"
                  style={{ color: s.direction === 'undermines' ? 'var(--neg)' : 'var(--pos)' }}
                >
                  {s.direction === 'undermines' ? 'against' : 'supports'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-[var(--rule)] pt-2">
          <Chip
            tone={a.credibility?.suspectedFalse === 'No' ? 'positive' : 'warning'}
            icon={<BadgeCheck size={10} aria-hidden />}
          >
            {a.credibility?.suspectedFalse === 'No'
              ? 'Nothing suspected false'
              : `Suspected false: ${a.credibility?.suspectedFalse ?? 'unknown'}`}
          </Chip>
          {a.credibility?.debunkStatus && a.credibility.debunkStatus !== 'Not Checked' && (
            <Chip tone="warning">{a.credibility.debunkStatus}</Chip>
          )}
          {a.credibility?.fakeNewsType && a.credibility.fakeNewsType !== 'Not Applicable' && (
            <Chip tone="warning">{a.credibility.fakeNewsType}</Chip>
          )}
        </div>
        <div className="mt-2 border-t border-[var(--rule)] pt-2">
          <p className="text-[9px] font-semibold uppercase tracking-[0.04em] text-ink-3">
            How sure the reading was
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {a.confidence && (
              <Chip tone={a.confidence === 'high' ? 'positive' : 'warning'}>
                {a.confidence} confidence
              </Chip>
            )}
            {(a.inferredFields ?? []).length > 0 && (
              <span
                className="text-[9.5px] text-ink-3"
                title={`The reading marked these as inferred rather than read: ${(a.inferredFields ?? []).join(', ')}.`}
              >
                {(a.inferredFields ?? []).length} field
                {(a.inferredFields ?? []).length === 1 ? '' : 's'} inferred
              </span>
            )}
          </div>
          {a.credibility?.notes && (
            <p className="mt-1 line-clamp-2 text-[9.5px] leading-relaxed text-ink-3">
              {a.credibility.notes}
            </p>
          )}
        </div>
        <p className="mt-1.5 text-[9px] leading-relaxed text-ink-3">
          This is the reading of the post, not of doubts anyone raised about it.
        </p>
      </Block>

      {/* ── 7 ────────────────────────────────────────────────────────────── */}
      <Block n={7} icon={<Lightbulb size={13} aria-hidden />} title="What It Means For You" sub="The reading's own observations about this post">
        {observations.length === 0 ? (
          <Nothing>The reading recorded no observation of its own for this post.</Nothing>
        ) : (
          <ul className="space-y-1.5">
            {observations.slice(0, 4).map((o, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-2">
                <Check size={11} className="mt-0.5 shrink-0 text-[var(--pos)]" aria-hidden />
                <span className="line-clamp-3">{o}</span>
              </li>
            ))}
          </ul>
        )}
        {/* Under its own heading, never folded into the ticks above. An
            observation is the reading's view of what the post MEANS; intent is
            its view of what the post was FOR. Two different claims, and
            printing one under the other's tick would be the quiet kind of
            relabelling this desk exists to catch. */}
        {a.intent && (
          <div className="mt-2 border-t border-[var(--rule)] pt-2">
            <p className="text-[9px] font-semibold uppercase tracking-[0.04em] text-ink-3">
              What the post was for
            </p>
            <p className="mt-1 line-clamp-3 text-[10px] leading-relaxed text-ink-2">{a.intent}</p>
          </div>
        )}
      </Block>

      {/* ── 8 ────────────────────────────────────────────────────────────── */}
      <Block
        n={8}

        icon={<Target size={13} aria-hidden />}
        title="Recommended Action"
        sub="What the reading recorded as the ask behind this post"
      >
        <div className="flex flex-wrap gap-1.5">
          {a.civic?.actionCategory && <Chip tone="accent">{a.civic.actionCategory}</Chip>}
          {a.civic?.actionPriority && <Chip>{a.civic.actionPriority} priority</Chip>}
          {a.civic?.priorityTag && <Chip>{a.civic.priorityTag}</Chip>}
          {a.civic?.isGrievance && a.civic.grievanceType && (
            <Chip tone="warning">{a.civic.grievanceType}</Chip>
          )}
        </div>
        {a.civic?.issueDescription && (
          <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-ink-3">
            {a.civic.issueDescription}
          </p>
        )}
        {a.civic?.suggestedAction && a.civic.suggestedAction !== 'Monitor only' ? (
          <p className="mt-2 line-clamp-4 text-[10px] leading-relaxed text-ink-2">
            {a.civic.suggestedAction}
          </p>
        ) : (
          <p className="mt-2 text-[10px] leading-relaxed text-ink-2">
            No action was recorded for this post. The reading filed it to watch rather than to
            answer.
          </p>
        )}
        {(a.civic?.talkingPoints ?? []).length > 0 && (
          <ul className="mt-2 space-y-1 border-t border-[var(--rule)] pt-2">
            {(a.civic?.talkingPoints ?? []).slice(0, 3).map((t, i) => (
              <li key={i} className="line-clamp-2 text-[9.5px] leading-relaxed text-ink-3">
                {t}
              </li>
            ))}
          </ul>
        )}
      </Block>

        <PostIdeaBlocks h={h} />
      </div>
    </div>
  )
}

/* ── the strip ───────────────────────────────────────────────────────────── */

/** One figure on a strip card. An absent one is dropped, never shown as nought. */
function Stat({ icon, value, label }: { icon: ReactNode; value: number | null; label: string }) {
  if (value == null) return null
  return (
    <span
      className="tnum flex shrink-0 items-center gap-0.5 text-[10px] text-ink-3"
      title={`${value.toLocaleString('en-IN')} ${label}`}
    >
      {icon}
      {compact(value)}
    </span>
  )
}

function StripCard({
  h,
  rank,
  active,
  onOpen,
}: {
  h: Highlight
  rank: number
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-[214px] shrink-0 overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--surface)] text-left transition-shadow',
        active
          ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]'
          : 'border-[var(--border)] shadow-[var(--e1)] hover:border-[var(--border-interactive)]',
      )}
    >
      <div className="flex items-center justify-between px-2.5 pt-2.5">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'tnum grid size-5 place-items-center rounded-full text-[10px] font-bold',
              active ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface-3)] text-ink-2',
            )}
          >
            {rank}
          </span>
          <PlatformBadge platform={h.platform} size={18} />
        </span>
        <span className="text-[10px] text-ink-3">{dayOf(h.publishedAt)}</span>
      </div>

      <div className="mt-2 px-2.5">
        <PostPicture
          url={h.thumbnailUrl}
          platform={h.platform}
          postUrl={h.url}
          iconSize={16}
          className="aspect-[16/9] w-full rounded-[var(--radius-md)]"
        />
      </div>

      <p className="mt-2 line-clamp-1 px-2.5 text-[11.5px] font-semibold">{h.title}</p>

      {/* One line, not two. The reference sets the score and the four figures
          as a single run under the title, and a wrapped fifth item made the
          cards in a row different heights. */}
      <div className="mt-1.5 flex flex-nowrap items-center gap-x-1.5 overflow-hidden px-2.5 pb-2.5">
        <span className="flex shrink-0 items-center gap-1">
          <span aria-hidden className="text-[11px] leading-none">
            {scoreFace(h.score)}
          </span>
          <span className="tnum text-[11px] font-bold" style={{ color: toneColour(h.score) }}>
            {h.scoreOutOf100}
            <span className="text-[9px] font-medium text-ink-3">/100</span>
          </span>
        </span>
        <Stat icon={<Heart size={9} aria-hidden />} value={h.likes} label="likes" />
        <Stat icon={<MessageSquare size={9} aria-hidden />} value={h.comments} label="comments" />
        <Stat icon={<Share2 size={9} aria-hidden />} value={h.shares} label="shares" />
        <Stat icon={<Eye size={9} aria-hidden />} value={h.views} label="views" />
      </div>
    </button>
  )
}

/** The arrow over each edge of the strip, as the reference draws it. */
function StripArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Scroll back' : 'Scroll forward'}
      className={cn(
        'absolute top-1/2 z-10 hidden size-8 -translate-y-1/2 place-items-center rounded-full',
        'border border-[var(--border)] bg-[var(--surface)] text-ink-2 shadow-[var(--e1)]',
        'transition-colors hover:border-[var(--border-interactive)] hover:text-ink lg:grid',
        side === 'left' ? 'left-0' : 'right-0',
      )}
    >
      {side === 'left' ? <ChevronLeft size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
    </button>
  )
}

/* ── the header ──────────────────────────────────────────────────────────── */

function Header({
  win,
  onWin,
  onClose,
  exportable,
  anchor,
}: {
  win: WindowId
  onWin: (w: WindowId) => void
  onClose: () => void
  exportable: Report[]
  anchor: string | null
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {/* Sans, not the serif `.display` voice. The reference sets this
            screen in the same grotesque as the rest of its chrome, and the
            serif read as a different product sitting inside this one. */}
        <h1 className="text-[clamp(1.35rem,1.1rem+0.9vw,1.6rem)] font-bold tracking-[-0.022em]">
          Post Highlights
        </h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
          Deep insights into the posts that got the strongest reactions.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <select
          value={win}
          onChange={(e) => onWin(e.target.value as WindowId)}
          aria-label="The window these figures cover"
          className="select min-h-10 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] py-2 pl-3.5 text-[13px] font-medium text-ink shadow-[var(--e1)] outline-none"
          /* The windows are measured back from the newest post this desk
             holds, not from today. A dataset read last month would otherwise
             report an empty "last 7 days" and read as a desk that has stopped
             working, which is a different and far more alarming claim. */
          title={
            anchor
              ? `Measured back from your newest stored post, ${dayOf(anchor)}.`
              : 'No stored post carries a date.'
          }
        >
          {WINDOWS.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          onClick={() => downloadCsv(exportable)}
          disabled={exportable.length === 0}
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

/* ── the screen ──────────────────────────────────────────────────────────── */

export function PostHighlights({
  onClose,
  onOpenReport,
  onRead,
}: {
  onClose: () => void
  onOpenReport: (report: Report) => void
  onRead: (postUrl: string) => void
}) {
  const reduce = useReducedMotion() === true
  const reports = useStoredReports()
  const handles = useMemo<TrackedHandle[]>(() => listHandles(), [])
  const { highlights, unread } = useMemo(() => highlightsOf(handles, reports), [handles, reports])

  const [lens, setLens] = useState<Lens>('overall')
  const [platform, setPlatform] = useState<string | null>(null)
  const [win, setWin] = useState<WindowId>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  const platforms = useMemo(() => [...new Set(highlights.map((h) => h.platform))], [highlights])

  /**
   * The window is anchored to the newest post this desk holds, not to the
   * clock, for the reason written against the picker above.
   */
  const anchor = useMemo(() => newestPostDate(highlights.map((h) => h.publishedAt)), [highlights])
  const inRange = useMemo(() => {
    const start = windowStart(anchor, win)
    return highlights.filter((h) => inWindow(h.publishedAt, start))
  }, [highlights, anchor, win])

  const shown = useMemo(() => {
    if (lens === 'positive') return bestReceived(inRange)
    if (lens === 'negative') return worstReceived(inRange)
    if (lens === 'platform') {
      const p = platform ?? platforms[0]
      return inRange.filter((h) => h.platform === p)
    }
    return inRange.slice(0, 5)
  }, [lens, platform, platforms, inRange])

  const current = shown.find((h) => h.url === open) ?? shown[0] ?? null
  const rest = shown.filter((h) => h.url !== current?.url)

  /* The strip's own arrows, per the reference. One card per press. */
  const strip = useRef<HTMLDivElement | null>(null)
  const nudge = useCallback((dir: -1 | 1) => {
    strip.current?.scrollBy({ left: dir * 226, behavior: 'smooth' })
  }, [])

  if (highlights.length === 0) {
    return (
      <Shell className="stack">
        <Header win={win} onWin={setWin} onClose={onClose} exportable={[]} anchor={anchor} />
        <Empty
          icon={<Sparkles size={18} aria-hidden />}
          title="No post has been read in full yet"
          body={
            unread > 0
              ? `${unread} of your posts are stored but none has been analysed. Open one and press Analyse; a reading is run once and kept forever.`
              : 'No posts are stored for your accounts yet.'
          }
          action={
            <Button size="sm" onClick={onClose}>
              Back to the dashboard
            </Button>
          }
        />
      </Shell>
    )
  }

  return (
    <Shell className="stack">
      <m.div variants={listStagger} initial={reduce ? false : 'hidden'} animate="show">
        <m.div variants={fadeUp}>
          <Header
            win={win}
            onWin={setWin}
            onClose={onClose}
            exportable={shown.map((h) => h.report)}
            anchor={anchor}
          />
        </m.div>

        {/* ── the lenses, underlined per the reference ─────────────────── */}
        <m.div variants={fadeUp} className="mt-3 border-b border-[var(--border)]">
          <div className="flex flex-wrap items-end gap-x-1">
            {LENSES.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLens(l.id)}
                aria-pressed={lens === l.id}
                className={cn(
                  'relative min-h-10 px-3 pb-2 text-[13px] font-semibold transition-colors',
                  lens === l.id ? 'text-[var(--accent)]' : 'text-ink-3 hover:text-ink-2',
                )}
              >
                <span className="flex items-center gap-1">
                  {l.label}
                  {l.id === 'platform' && <ChevronDown size={13} aria-hidden />}
                </span>
                {lens === l.id && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--accent)]"
                  />
                )}
              </button>
            ))}
          </div>
        </m.div>

        {lens === 'platform' && (
          <m.div variants={fadeUp} className="mt-2 flex flex-wrap gap-1.5">
            {platforms.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                aria-pressed={(platform ?? platforms[0]) === p}
                title={p}
                className={cn(
                  'inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 text-xs font-semibold transition-colors',
                  (platform ?? platforms[0]) === p
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border-[var(--border)] bg-[var(--surface-2)] text-ink-2',
                )}
              >
                <PlatformBadge platform={p} size={16} />
                {p}
              </button>
            ))}
          </m.div>
        )}

        {/* ── the strip, with an arrow at each edge ────────────────────── */}
        <m.div variants={fadeUp} className="relative mt-3">
          {shown.length === 0 ? (
            <Card>
              <p className="text-sm leading-relaxed text-ink-2">
                {lens === 'positive'
                  ? 'No post of yours was received warmly in the readings held.'
                  : lens === 'negative'
                    ? 'No post of yours was received badly in the readings held. That is a finding, not a gap.'
                    : `Nothing read in this window. ${
                        anchor
                          ? `Your newest stored post is from ${dayOf(anchor)}.`
                          : 'No stored post carries a date.'
                      }`}
              </p>
            </Card>
          ) : (
            <>
              <StripArrow side="left" onClick={() => nudge(-1)} />
              <div ref={strip} className="flex gap-3 overflow-x-auto scroll-smooth px-1 pb-2 lg:px-10">
                {shown.map((h, i) => (
                  <StripCard
                    key={h.url}
                    h={h}
                    rank={i + 1}
                    active={current?.url === h.url}
                    onOpen={() => {
                      setOpen(h.url)
                      setCollapsed(false)
                    }}
                  />
                ))}
              </div>
              <StripArrow side="right" onClick={() => nudge(1)} />
            </>
          )}
        </m.div>

        {/* ── the expanded post ───────────────────────────────────────── */}
        {current && !collapsed && (
          <m.div variants={fadeUp} className="mt-3">
            <div className="rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface-2)] p-2.5 shadow-[var(--e1)]">
              <div className="mb-2.5 flex items-start gap-2.5 px-1 pt-0.5">
                <PlatformBadge platform={current.platform} size={26} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-[14px] font-bold">{current.title}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">{dayTimeOf(current.publishedAt)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  aria-label="Close this reading"
                  className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-[var(--surface-3)] hover:text-ink"
                >
                  <X size={16} aria-hidden />
                </button>
              </div>
              <Reading
                h={current}
                all={highlights}
                handles={handles}
                onOpenReport={onOpenReport}
              />
            </div>
          </m.div>
        )}

        {/* ── the rest of the ranking ─────────────────────────────────── */}
        {rest.length > 0 && (
          <m.ul variants={fadeUp} className="mt-3 space-y-1.5">
            {rest.map((h) => {
              const rank = shown.findIndex((x) => x.url === h.url) + 1
              return (
                <li key={h.url}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(h.url)
                      setCollapsed(false)
                    }}
                    className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-left transition-colors hover:border-[var(--border-interactive)]"
                  >
                    <span className="tnum w-4 shrink-0 text-[12px] font-bold text-ink-3">{rank}</span>
                    <PlatformBadge platform={h.platform} size={20} />
                    <span className="line-clamp-1 min-w-0 flex-1 text-[13px] font-medium">
                      {h.title}
                    </span>
                    <span className="hidden shrink-0 text-[11px] text-ink-3 sm:block">
                      {dayOf(h.publishedAt)}
                    </span>
                    <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-ink-3 md:flex">
                      Sentiment score
                      <span className="tnum font-bold" style={{ color: toneColour(h.score) }}>
                        {h.scoreOutOf100}/100
                      </span>
                    </span>
                    <span
                      className="hidden shrink-0 text-[11px] font-semibold lg:block"
                      style={{ color: toneColour(h.score) }}
                    >
                      {h.narrative ?? h.label}
                    </span>
                    <ChevronDown size={15} className="shrink-0 text-ink-3" aria-hidden />
                  </button>
                </li>
              )
            })}
          </m.ul>
        )}

        {unread > 0 && (
          <m.div variants={fadeUp} className="mt-3">
            <Card level="quiet">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-2">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" aria-hidden />
                {unread} of your stored posts have no reading yet, so they cannot be ranked here. A
                reading is run once and kept forever.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => {
                  const first = handles
                    .filter((x) => x.own)
                    .flatMap((x) => x.snapshots.at(-1)?.posts ?? [])
                    .find((p) => !reports?.get(p.url))
                  if (first) onRead(first.url)
                }}
              >
                Analyse the next one
                <ArrowRight size={14} aria-hidden />
              </Button>
            </Card>
          </m.div>
        )}
      </m.div>
    </Shell>
  )
}
