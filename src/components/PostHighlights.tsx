import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Forward,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Quote,
  Smile,
  Sparkles,
  ThumbsUp,
  TrendingDown,
  TrendingUp,
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
import {
  bestReceived,
  dedupeTags,
  highlightsOf,
  worstReceived,
  type Highlight,
} from '@/lib/highlights'
import {
  WINDOWS,
  inWindow,
  newestPostDate,
  sameWindowNote,
  windowStart,
  type WindowId,
} from '@/lib/window'
import { downloadCsv } from '@/lib/export'
import { cn, compact, pluralise } from '@/lib/utils'
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

/*
 * Exported because the dashboard now ASKS for a lens. "View all top posts" on
 * the content tables opens this screen already on Best received, and "View all
 * underperforming posts" on Worst received, so the caller has to be able to
 * name one without re-declaring a string union that would drift from this one.
 */
export type Lens = 'overall' | 'platform' | 'positive' | 'negative'

/**
 * NAME EACH LENS AFTER WHAT IT ACTUALLY RANKS.
 *
 * The first one was "Overall (Top 5)", and `highlightsOf` orders by
 * `Math.abs(score)` — the STRENGTH of the reaction, in either direction, ties
 * broken by reactions. So a savaged post outranks a mildly-liked one, and a
 * post with plenty of likes but calm comments sinks to the bottom. Read
 * against a tab labelled "Overall", that is a scoreboard saying the office's
 * popular post performed badly: "even if a post has more likes it is showing
 * it is performing low".
 *
 * The ordering is the right one for this screen — the posts worth a person's
 * attention this week are the ones that moved people, and a post nobody
 * reacted to is not news. What was wrong is a label that promised a ranking
 * of quality and delivered a ranking of intensity. So the label changed, not
 * the sort: blending sentiment and engagement into one "performance" number
 * would mean adding two things measured in different units and presenting the
 * result as a fact.
 */
const LENSES: { id: Lens; label: string }[] = [
  /* "(Top 5)" is back on the first lens. The reference carried it and the
     rename dropped it, taking with it the one thing on the row that told a
     reader how many cards the strip holds — and this lens is the only one
     that is capped, so the number is a fact about it rather than decoration. */
  { id: 'overall', label: 'Strongest reactions (Top 5)' },
  { id: 'platform', label: 'By platform' },
  { id: 'positive', label: 'Best received' },
  { id: 'negative', label: 'Worst received' },
]

/**
 * What each lens ranks by, held in each tab's hover so the order is never a
 * guess on a screen the reference draws without a caption under the strip.
 *
 * Three of the four are claims about how people RECEIVED a post, and all
 * three now list only posts that have comments under them, for the reason
 * written against `bestReceived` in lib/highlights.ts. "By platform" is the
 * one lens that promises every read post, so it keeps them all and leaves the
 * score slot empty where there is nothing to score.
 */
const LENS_NOTE: Record<Lens, string> = {
  overall:
    'Ranked by how strongly the comments read, not by likes. Posts with no comments are not ranked — there is nothing to rank them on.',
  platform:
    'Every read post on this platform, strongest reaction first. A post with no comments carries no score here.',
  positive: 'Posts whose comments read warmest first.',
  negative: 'Posts whose comments read most hostile first.',
}

/**
 * ONE DATE FORMAT FOR THE WHOLE SCREEN.
 *
 * There were two, and neither was stable. The strip printed "2 Sept, 2026"
 * with a comma and the rows printed "2 Sept 2026" without, so one screen
 * carried the same date in two shapes; and `toLocaleDateString('en-IN', {
 * month: 'short' })` renders September as "Sept" — four letters where every
 * other month on this desk gets three, so a column of dates was ragged in a
 * way no reader could attribute to the data. The months are written out here
 * rather than asked of the locale, because three letters is the property that
 * matters and the locale does not guarantee it.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const dayOf = (iso: string | null): string => {
  if (!iso) return 'Date not published'
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

const dayTimeOf = (iso: string | null): string => {
  if (!iso) return 'Date not published'
  const d = new Date(iso)
  const day = dayOf(iso)
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  // A date stored with no time on it is midnight, and printing "12:00 am"
  // would state a publication time the platform never gave.
  return d.getHours() === 0 && d.getMinutes() === 0 ? day : `${day} · ${time.toUpperCase()}`
}

const toneColour = (score: number): string =>
  score >= 15 ? 'var(--pos)' : score <= -15 ? 'var(--neg)' : 'var(--warn)'

/**
 * The neutral arc of block 2's ring, as gold as the contrast floor allows.
 *
 * The reference draws neutral in a bright amber near #fbbf24. On this desk's
 * white surface that measures 1.67:1, and index.css darkened the shared
 * `--chart-mid` to #b8801a on purpose to clear the 3:1 a non-text mark needs
 * (the reasoning is written out at that token, and `npm run test:contrast`
 * holds it). Two-thirds of a ring in that brown genuinely reads muddy, so
 * this drops the blue out of it and lifts what is left as far as the floor
 * allows: #c08800 is a clean gold at 3.11:1 on white, against #b8801a's
 * 3.42:1 — brighter and purer, still clear of the floor rather than shaving
 * it. Dark mode keeps the token's own bright amber, which has a dark ground
 * to sit against and needs no darkening at all.
 */
const NEUTRAL_ARC = 'light-dark(#c08800, #fbbf24)'

/**
 * A stored comment with the collector's leading punctuation off the front.
 *
 * Comment rows arrive carrying fragments of the markup they were cut out of:
 * the top comment on this desk's strongest post is stored as ".. జై జై
 * జేజమ్మ", and those two dots are not something a person typed. Only a
 * leading run of punctuation and space is removed, and only from the display
 * — the hover and the full reading still hold the stored string exactly.
 * Nothing inside or after the comment is touched, because a trailing run of
 * dots may well be the commenter's own.
 */
const commentText = (s: string): string => s.replace(/^[\s.,;:·•|–—-]+/, '').trim()

/**
 * The first sentence of a stored line, where the block has room for one.
 *
 * Not a summary and not a rewrite: the sentence break is the reading's own,
 * and every caller that uses this puts the untouched string in the element's
 * hover. Where there is no break the line is returned whole and the clamp
 * around it does the rest.
 */
const firstSentence = (s: string): string => {
  const trimmed = s.trim()
  const cut = trimmed.search(/[.!?](\s|$)/)
  return cut > 0 ? trimmed.slice(0, cut + 1) : trimmed
}

/**
 * The floors under block 1's "vs typical" box. Below either, the comparison
 * is refused rather than printed: five measured posts before the median may
 * speak (the briefing's own floor), and a median of at least ten reactions,
 * because two reactions against a median of two once printed "100% below
 * your typical YouTube post" — arithmetic a base that small cannot carry.
 */
const DELTA_MIN_POSTS = 5
const DELTA_MIN_BASELINE = 10

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
 *
 * Per the reference, blocks 1–6 carry no title icon and blocks 7–10 carry a
 * small accent-tinted rounded-square Sparkles badge — those four are the
 * model's own voice rather than a measurement, and the badge is the mark.
 * The sub-line is optional; where the reference shows none, the explanation
 * lives in the heading's hover instead of on the screen.
 */
function Block({
  n,
  title,
  sub,
  badge,
  hover,
  children,
}: {
  n: number
  title: string
  sub?: string
  /** The reference's Sparkles mark, on blocks 7–10 only. */
  badge?: boolean
  /** At most two short sentences of method, held in the heading's hover. */
  hover?: string
  children: ReactNode
}) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <p
        className={cn(
          'flex items-start gap-1.5 text-[12.5px] font-bold leading-snug tracking-[-0.01em]',
          hover && 'cursor-help',
        )}
        title={hover}
      >
        {badge && (
          <span
            aria-hidden
            className="grid size-5 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent)]"
          >
            <Sparkles size={12} />
          </span>
        )}
        <span className="min-w-0">
          {n}. {title}
        </span>
      </p>
      {sub && <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">{sub}</p>}
      <div className="mt-2.5 min-w-0 flex-1">{children}</div>
    </section>
  )
}

/** A truthful absence, its longer explanation one hover away where one exists. */
function Nothing({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <p className={cn('text-[11px] leading-relaxed text-ink-3', title && 'cursor-help')} title={title}>
      {children}
    </p>
  )
}

/** The reference's bold mini-heading inside a block: "Top Emotions", "Top Comment". */
function MiniHead({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-[10px] font-bold', className)}>{children}</p>
}

/**
 * One published figure, or an absence that says it is one.
 *
 * Four separate hairline tiles, accent value over grey label and no icon
 * inside, which is how the reference draws them.
 */
function Metric({
  label,
  value,
  hint,
}: {
  label: string
  value: number | null
  /** What this figure measures, where the word alone could mean two things. */
  hint?: string
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-[var(--radius-md)] border border-[var(--rule)] px-1.5 py-1.5 text-center',
        hint && 'cursor-help',
      )}
      title={hint}
    >
      <p className="tnum text-[14px] font-bold leading-none text-[var(--accent)]">
        {value == null ? (
          /* An absence must not wear the colour of a figure, and it must not
             out-shout one either. `text-ink-3` at this weight is #5d6a87,
             which beside three indigo siblings reads as the boldest thing in
             the row — so the tile keeps the row's baseline and steps back to
             a plain placeholder tone. */
          <span
            className="font-semibold text-ink-3 opacity-65"
            title={`${label} was not published for this post.`}
          >
            NA
          </span>
        ) : (
          compact(value)
        )}
      </p>
      {/* The longest of these labels ("Comments") needs 47px in the 38px the
          tile gets, so it was being cut to "Commen…" — the one word on the
          tile that says what the figure above it counts. Wrapping costs a few
          pixels of height across a row that already aligns to its tallest
          tile; a guessable label costs the reader the figure. */}
      <p className="mt-1 text-[9px] font-medium leading-tight text-ink-3">{label}</p>
    </div>
  )
}

/**
 * A boxed rate or count, the thing it was measured against in the hover.
 *
 * Sentence case on one line, matching the four tiles directly above rather
 * than shouting over them: "ENGAGEMENT RATE" in letterspaced caps wrapped to
 * two lines, which pushed its figure a line below its neighbour's and left
 * the two wide tiles visibly out of alignment.
 */
function Basis({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div
      className="min-w-0 cursor-help rounded-[var(--radius-md)] border border-[var(--rule)] px-2 py-1.5"
      title={note}
    >
      <p className="truncate text-[9.5px] font-medium text-ink-3">{label}</p>
      <p className="tnum mt-0.5 text-[15px] font-bold leading-none">{value}</p>
    </div>
  )
}

/** A named group inside the mentions block, with the stance the reading gave. */
function NameGroup({
  title,
  kind,
  names,
}: {
  title: string
  kind: 'person' | 'place' | 'org'
  names: { name: string; stance?: string | null }[]
}) {
  if (names.length === 0) return null
  return (
    <div className="mt-2 first:mt-0">
      <MiniHead>{title}</MiniHead>
      {/* Two columns and no dividers, which is the reference's density: as a
          single column with a hairline between every group this block ran as
          a tall sparse list beside four compact neighbours.

          The reference puts a share in each row's right-hand column. There is
          none to put — a reading names each of these exactly once, so there is
          no frequency anywhere in it — and the column carries the stance the
          reading recorded instead, which is real. The reference's avatars have
          no honest source either, since no reading holds a photograph, so
          people and parties wear an initial disc and places the map pin;
          nothing is fetched to dress the rows up. */}
      <ul className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1">
        {names.slice(0, 6).map((p) => (
          <li key={p.name} className="flex min-w-0 items-center gap-1.5">
            {kind === 'place' ? (
              <MapPin size={11} className="shrink-0 text-[var(--accent)]" aria-hidden />
            ) : (
              <span
                aria-hidden
                className="grid size-4 shrink-0 place-items-center rounded-full bg-[var(--surface-3)] text-[8px] font-bold text-ink-2"
              >
                {p.name.trim().charAt(0).toUpperCase()}
              </span>
            )}
            {/* Wraps at its spaces rather than truncating: at two columns
                "Basavatarakam Cancer Hospital" came out as "Basavataraka…",
                and half a proper noun names nobody. The stance sits under the
                name rather than beside it, because a cell this narrow shared
                between the two broke "Congress government" mid-word. */}
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] leading-tight text-ink-2" title={p.name}>
                {p.name}
              </span>
              {p.stance && p.stance !== 'mentioned' && (
                <span
                  className="block text-[9px] font-semibold leading-tight"
                  style={{
                    color:
                      p.stance === 'praised'
                        ? 'var(--pos)'
                        : p.stance === 'criticised'
                          ? 'var(--neg)'
                          : 'var(--text-3)',
                  }}
                >
                  {p.stance}
                </span>
              )}
            </span>
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
              } the median of ${h.versusTypical.baseline} reactions across the ${
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
      {/* "(AI Suggestion)" would not fit this column beside the badge, and it
          wrapped as "(AI" / "Suggestion)" — a parenthetical split across two
          lines is worse than a short one. The mark stays: the Sparkles badge
          is on this block for exactly this reason, the hover says it in
          words, and the button repeats it. */}
      <Block
        n={9}
        badge
        title="What To Post Next (AI)"
        hover="An AI suggestion, not a measurement. Drafting it costs a live call."
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
          <Nothing
            title={
              h.hasComments
                ? `It will be written from this post's reading and the ${
                    h.report.snapshot.comments?.length ?? 0
                  } comments stored with it.`
                : 'It will be written from this post’s reading alone.'
            }
          >
            No suggestion drafted yet.
          </Nothing>
        )}
        {error && <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--neg)]">{error}</p>}
        {/* The reference's small lavender-tinted button with indigo text. As
            a white outline pill with black label it was the loudest element
            in the whole bottom row — a control competing with the readings it
            sits among. */}
        <Button
          size="sm"
          variant="outline"
          className="mt-2.5 min-h-8 gap-1.5 rounded-[var(--radius-xs)] border-transparent bg-[var(--accent-soft)] px-2.5 text-[11px] text-[var(--accent)] shadow-none hover:bg-[var(--accent-soft)] hover:brightness-[0.97]"
          title="An AI suggestion, not a measurement. Drafting costs a live call."
          onClick={generate}
          disabled={busy}
        >
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

      <Block
        n={10}
        badge
        title="Suggested Post Idea"
        hover="A draft to check and edit, never to send unread."
      >
        {entry ? (
          <div className="flex h-full flex-col">
            <div
              className="rounded-[var(--radius-md)] bg-[var(--pos-soft)] p-2.5"
              title={`Drafted for ${entry.idea.platform}; angle: ${entry.idea.angle}. Check and edit before sending.`}
            >
              <p
                className="line-clamp-6 whitespace-pre-line text-[10.5px] leading-relaxed text-ink-2"
                title={entry.idea.text}
              >
                {entry.idea.text}
              </p>
            </div>
            <button
              type="button"
              onClick={copy}
              className="mt-2 inline-flex min-h-8 items-center gap-1.5 self-start rounded-[var(--radius-xs)] border border-[var(--accent-soft)] bg-[var(--surface)] px-2.5 text-[10.5px] font-semibold text-[var(--accent)] transition-colors hover:border-[var(--border-interactive)]"
            >
              <Check size={11} aria-hidden />
              {copied ? 'Copied' : 'Use This Idea'}
              <ArrowRight size={11} aria-hidden />
            </button>
          </div>
        ) : (
          /* The absence stays an absence — nothing is pre-filled here — but it
             takes the shape of the box it is the absence OF. As four bare
             words on an otherwise blank card this block was 85% whitespace and
             closed the bottom row on what looked like a failed render. */
          <div
            className="grid min-h-[68px] cursor-help place-items-center rounded-[var(--radius-md)] border border-dashed border-[var(--rule)] bg-[var(--surface-2)] p-2.5 text-center"
            title="Press Generate Post Idea in the block beside this one. Nothing is drafted until somebody asks, so nothing here can be mistaken for a post the office wrote."
          >
            <p className="text-[10.5px] leading-relaxed text-ink-3">No draft yet</p>
          </div>
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
  const a = h.report.analysis
  if (!a) return <Nothing>This reading did not come back with an analysis.</Nothing>

  const comments = h.report.snapshot.comments ?? []

  /**
   * THE TWO COMMENT COUNTS ON THIS CARD ARE TWO DIFFERENT MEASUREMENTS.
   *
   * The Comments tile prints what the platform published on the post. Every
   * caption around it counts the comment rows this desk actually retrieved
   * and stored, which is what the split, the emotions and the quotes are all
   * made from. Those two numbers disagree on 28 of the 68 analysed posts on
   * this desk, in both directions: Facebook published 24 comments on
   * reel/1097305012953793 and 2 were retrieved, while
   * x.com/Aruna_DK/status/2093993831758708747 published none and 4 are
   * stored. The card was printing "0" in the tile and "All 4 comments on this
   * post, read one by one" a column away, under the same word, which is
   * exactly the quiet contradiction this desk exists to catch.
   *
   * Both numbers stay, because both are true and neither answers the other's
   * question. Each is named for what it measures, and the difference between
   * them is stated in the Comments tile's hover — the reference leaves no
   * printed line for it, so the tile keeps the platform's figure and its hover
   * names the stored count the blocks beside it are read from.
   */
  const storedComments = comments.length
  const publishedComments = h.comments
  const commentsDiffer =
    publishedComments == null ? storedComments > 0 : publishedComments !== storedComments

  /**
   * The split of THIS post's comments, from the comments themselves.
   *
   * The ring here used to be the ACCOUNT's standing, with a line underneath
   * admitting it: "across 72 comments on your Facebook account, not this post
   * alone". That was honest and it was still the wrong figure on a card about
   * one post - the reader is looking at six comments and being shown a
   * seventy-two comment answer. Each comment now carries its own side from
   * classify-comments.ts, so the post can be asked directly.
   *
   * Only comments that were actually classified count toward the split, and
   * the caption says how many that was: an unclassified comment is not a
   * neutral one.
   */
  const postSplit = (() => {
    let positive = 0
    let negative = 0
    let neutral = 0
    for (const c of comments) {
      if (c.side === 'positive') positive++
      else if (c.side === 'negative') negative++
      else if (c.side === 'neutral') neutral++
    }
    const placed = positive + negative + neutral
    return placed > 0 ? { positive, negative, neutral, placed } : null
  })()

  const emotions = a.emotions ?? []
  const emotionTotal = emotions.reduce((s, e) => s + e.weight, 0) || 1

  /**
   * "People" does not mean the account whose post this is.
   *
   * Every reading of this desk's own posts names the desk's own handle, so
   * the People group was a heading over one entry reading "DKAruna" — the
   * office being told, on its own post, that its own account was mentioned.
   * That is not a mention of a person, it is the byline. The handles the desk
   * marks as its own are the only ones dropped; a genuine third party who
   * happens to share a name with nothing here is untouched.
   */
  const ownNames = new Set(
    handles
      .filter((x) => x.own)
      .flatMap((x) => [x.handle, x.displayName])
      .filter((s): s is string => Boolean(s))
      .map((s) => s.replace(/^@/, '').toLowerCase().replace(/[\s._-]+/g, '')),
  )
  const isOwnAccount = (name: string): boolean =>
    ownNames.has(name.replace(/^@/, '').toLowerCase().replace(/[\s._-]+/g, ''))

  const people = (a.entities ?? []).filter((e) => e.kind === 'person' && !isOwnAccount(e.name))
  const orgs = (a.entities ?? []).filter((e) => e.kind === 'organisation')
  const places = a.reach?.places ?? []
  const signals = a.credibility?.signals ?? []
  /* Case-folded and separator-stripped before the slice, so `#Mahabubnagar`
     from the caption and `mahabubnagar` from the reading are one chip rather
     than two. See `dedupeTags`. */
  const tags = dedupeTags([
    ...(h.report.snapshot.content.hashtags ?? []),
    ...(a.topics?.tags ?? []),
  ])
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
      <Block
        n={1}
        title="How this post read"
        sub="How the comments read"
        hover="The ring and its label are the comments. The tiles under them are what the platform published on the post."
      >
        {/*
         * SENTIMENT IS WHAT THE AUDIENCE SAID, OR IT IS NOTHING.
         *
         * This drew the ring from `analysis.sentiment` whatever that reading
         * was made from, and disclosed the difference in a caption: "tone of
         * the post's own words". That caption was true and the figure was
         * still wrong to show. A post with no comments, no likes and six
         * views was given "10 / Strong Negative" in the same red ring the
         * card uses for a genuinely hostile audience, because a model had
         * read the post's OWN headline and found it negative in tone. Nobody
         * had reacted to that post at all. Sentiment on this desk means how
         * people responded; a post nobody answered has no sentiment, and an
         * absence said plainly is worth more than a number that answers a
         * question the reader did not ask.
         */}
        {h.hasComments ? (
          <div
            className="flex cursor-help items-center gap-2.5"
            title="Tone of the comments, out of 100. Not a measure of reach."
          >
            {/* Thin ring over its track and the numeral in the tone's own
                colour, as the reference draws it. At a nine-pixel stroke with
                a near-black extra-bold figure inside, this one mark carried
                more visual weight than the four published figures beneath it
                put together — and it is the softest thing on the card, being
                a model's read of a handful of comments. The colour is set on
                the wrapper because the gauge's centre figure inherits it. */}
            <span className="shrink-0" style={{ color: toneColour(h.score) }}>
              <DonutGauge
                value={h.scoreOutOf100}
                size={70}
                thickness={7}
                label={String(h.scoreOutOf100)}
                from={toneColour(h.score)}
                to={toneColour(h.score)}
              />
            </span>
            <div className="min-w-0">
              <p
                className="text-[12.5px] font-bold leading-tight"
                style={{ color: toneColour(h.score) }}
              >
                {a.sentiment.label}
              </p>
              {/* The reference's verdict slot, filled with the reading's own
                  word for how the audience answered — never a canned line. */}
              {h.narrative && (
                <p className="mt-0.5 line-clamp-1 text-[10px] leading-relaxed text-ink-3">
                  {h.narrative}
                </p>
              )}
              {/* The reference's "performing N% better" chip, tucked under the
                  label on the right where the reference puts it, only where
                  the arithmetic can carry it: the floors above this file's
                  fold refuse the tiny-base verdicts that got the line removed
                  once already. Below a floor, or where the delta rounds to
                  nothing, nothing is rendered — a refusal, not a softer
                  sentence. As a full-bleed mint bar across the whole card it
                  read as the card's headline, which a comparison against a
                  median of a few dozen reactions has no business being. */}
              {(() => {
                const v = h.versusTypical
                if (!v || v.posts < DELTA_MIN_POSTS || v.baseline < DELTA_MIN_BASELINE) return null
                const pct = Math.round(Math.abs(v.pct))
                if (pct === 0) return null
                const up = v.pct >= 0
                return (
                  <span
                    className="mt-1.5 inline-flex cursor-help items-start gap-1 rounded-[var(--radius-sm)] px-1.5 py-1"
                    style={{ background: up ? 'var(--pos-soft)' : 'var(--warn-soft)' }}
                    title={`Against the median of ${v.baseline} reactions across ${v.posts} posts on this account.`}
                  >
                    {up ? (
                      <TrendingUp size={11} className="mt-px shrink-0 text-[var(--pos)]" aria-hidden />
                    ) : (
                      <TrendingDown
                        size={11}
                        className="mt-px shrink-0 text-[var(--warn)]"
                        aria-hidden
                      />
                    )}
                    <span
                      className="text-[9.5px] font-semibold leading-tight"
                      style={{ color: up ? 'var(--pos)' : 'var(--warn)' }}
                    >
                      {pct}% {up ? 'above' : 'below'} your
                      <br />
                      typical post
                    </span>
                  </span>
                )
              })()}
            </div>
          </div>
        ) : (
          <div
            className="cursor-help rounded-[var(--radius-md)] bg-[var(--surface-2)] px-3 py-2.5"
            title="Sentiment here is how people answered, and nobody commented on this post. The figures below are what the platform published."
          >
            <p className="text-[12px] font-semibold text-ink-2">No comments to read</p>
          </div>
        )}

        {/* Four EQUAL columns gave each tile 38px, and "Comments" needs 47 —
            a single word cannot wrap out of that, so the label was cut to
            "Commen…". The columns now size to their content with a shared
            floor, so the widest label sets its own tile and the three short
            ones give up the few pixels it needs. */}
        <div className="mt-2.5 grid grid-cols-[repeat(4,minmax(0,auto))] justify-between gap-1.5">
          <Metric label="Likes" value={h.likes} />
          <Metric
            label="Comments"
            value={h.comments}
            hint={
              !commentsDiffer
                ? `The number of comments ${h.platform} published on this post.`
                : publishedComments == null
                  ? `${h.platform} published no comment count on this post; ${storedComments} ${pluralise(storedComments, 'comment is', 'comments are')} stored here. The blocks beside this read the stored ones.`
                  : storedComments === 0
                    ? `${h.platform} published ${publishedComments} ${pluralise(publishedComments, 'comment')} on this post; none could be retrieved, so nothing on this card is read from the audience.`
                    : `${h.platform} published ${publishedComments} ${pluralise(publishedComments, 'comment')} on this post; ${storedComments} ${pluralise(storedComments, 'is', 'are')} stored here. The blocks beside this read the stored ones, not the platform's count.`
            }
          />
          <Metric label="Shares" value={h.shares} />
          <Metric label="Views" value={h.views} />
        </div>

        {/* ONE WIDE TILE, BECAUSE THERE IS ONE FIGURE TO PUT IN IT.
            The reference's second wide tile is Reach, and this desk has no
            honest reach: the nearest stored field is a model's estimate that
            repeats the view count on most posts, the follower count on one,
            and comes back as zero on Instagram posts with five thousand
            likes. Views stood in — and views are already the fourth tile
            directly above, so the same figure was printed twice forty pixels
            apart. A slot with nothing new to say is dropped, not filled with
            its neighbour. The rate itself takes one decimal, like every other
            percentage on the screen. */}
        <div className="mt-1.5">
          <Basis
            label={
              h.engagement
                ? `Engagement rate, of ${compact(h.engagement.denominator)} ${h.engagement.basis}`
                : 'Engagement rate'
            }
            value={h.engagement ? `${h.engagement.pct.toFixed(1)}%` : 'NA'}
            note={
              h.engagement
                ? h.engagement.basis === 'views'
                  ? `Interactions divided by ${compact(h.engagement.denominator)} views, the audience that could have seen them.`
                  : `Interactions divided by ${compact(h.engagement.denominator)} followers, as last read; no view count was published.`
                : 'No denominator available, so no rate can be computed.'
            }
          />
        </div>
      </Block>

      {/* ── 2 ────────────────────────────────────────────────────────────── */}
      <Block
        n={2}
        title="Sentiment & Emotions"
        sub="In this post's comments"
        hover="Every figure in this block is read from the comments stored for this post, never from the post's own words."
      >
        {/*
         * THIS BLOCK IS ABOUT THE COMMENTS ON THIS POST, OR IT IS EMPTY.
         *
         * It used to render whatever the reading held: the rationale, the
         * tone chip and the emotion faces all came straight off
         * `analysis`, and on a post nobody commented on that analysis was
         * made by reading the POST. So a video with no replies was given
         * "Anger 50%, Disgust 30%" and a sentence beginning "judging from
         * the post itself", under a heading about sentiment and emotions.
         * Those are the author's register, not the audience's feeling, and
         * printing them here answered a question nobody asked.
         *
         * Where the post HAS comments the reading was made from them, and
         * every figure below is theirs. Where it has none there is nothing
         * to show, and the block says so.
         */}
        {!h.hasComments ? (
          <Nothing title="No comments were read on this post, so there is no audience sentiment or emotion to show. What the post itself says is in the panels to the right.">
            No comments to read
          </Nothing>
        ) : (
        <>
        {postSplit ? (
          /* "Stored", never "on this post": the stored rows are what this
             donut is drawn from, and they are not always what the platform
             published. That sentence rides the donut's hover; the reading's
             own rationale rides the legend's; each row's hover carries its
             count. Nothing of it is printed — the reference shows only the
             ring and the three percentages. */
          <div
            className="flex cursor-help items-center gap-3"
            title={`${
              postSplit.placed === storedComments
                ? `All ${storedComments} ${pluralise(storedComments, 'comment')} stored for this post, read one by one.`
                : `${postSplit.placed} of the ${storedComments} comments stored for this post; the rest were not placed on a side.`
            } Stored comments, not the platform's published count.`}
          >
            <DonutBreakdown
              size={76}
              thickness={13}
              segments={[
                { label: 'Positive', value: postSplit.positive, color: 'var(--chart-pos)' },
                { label: 'Neutral', value: postSplit.neutral, color: NEUTRAL_ARC },
                { label: 'Negative', value: postSplit.negative, color: 'var(--chart-neg)' },
              ]}
              className="shrink-0"
            />
            <ul className="min-w-0 space-y-1" title={a.sentiment.rationale}>
              {(
                [
                  ['Positive', postSplit.positive, 'var(--chart-pos)'],
                  ['Neutral', postSplit.neutral, NEUTRAL_ARC],
                  ['Negative', postSplit.negative, 'var(--chart-neg)'],
                ] as const
              ).map(([label, n, colour]) => (
                <li
                  key={label}
                  className="flex items-center gap-1.5 text-[10px]"
                  title={`${n} of the ${postSplit.placed} classified ${pluralise(postSplit.placed, 'comment')}.`}
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: colour }}
                  />
                  <span className="tnum font-bold">
                    {((n / postSplit.placed) * 100).toFixed(1)}%
                  </span>
                  <span className="text-ink-2">{label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Nothing title="The comments on this post have not been read one by one yet, so there is no split to show for it.">
            Comments not yet read one by one
          </Nothing>
        )}

        <MiniHead className="mt-2.5">Top Emotions</MiniHead>
        {emotions.length === 0 ? (
          <Nothing title="No emotion was recorded for this post.">None recorded</Nothing>
        ) : (
          /* A NAME THAT DOES NOT FIT IS NOT A NAME.
             Each cell was a fixed 44px with `truncate`, so "Anticipation"
             printed as "Anticipa…" — a severed word under an emoji, and the
             first thing the eye lands on in this block. The cells now size to
             their contents and share the row evenly, so the longest emotion
             this taxonomy holds still reads whole. */
          <ul className="mt-1.5 flex flex-wrap justify-around gap-x-1 gap-y-1.5 rounded-[var(--radius-md)] border border-[var(--rule)] px-1 py-2">
            {emotions.map((e) => (
              <li key={e.emotion} className="min-w-0 px-0.5 text-center">
                <span
                  className="mx-auto grid size-8 place-items-center rounded-full text-[15px]"
                  style={{ background: EMOTION_TINT[e.emotion] ?? 'var(--surface-3)' }}
                >
                  {EMOTION_GLYPH[e.emotion as Emotion] ?? '\u{1F4AD}'}
                </span>
                <p className="mt-0.5 text-[9px] leading-tight text-ink-3">{e.emotion}</p>
                <p className="tnum text-[10px] font-bold">
                  {((e.weight / emotionTotal) * 100).toFixed(1)}%
                </p>
              </li>
            ))}
          </ul>
        )}
        </>
        )}
      </Block>

      {/* ── 3 ────────────────────────────────────────────────────────────── */}
      {/* The reference's sub here is "Key topics from the comment section".
          These topics are NOT comment-derived — the reading assigns them from
          the post — and printing that provenance would fabricate one. The sub
          stays truthful instead. */}
      {/* NOT "What People Are Talking About". The reference uses that heading,
          but these topics and keywords are assigned from the POST — its own
          text, its own hashtags — not from anything the audience said. A
          13px heading asserting audience voice over post-derived tags is the
          same provenance lie this product removed from the mood column, and
          it outranks matching the reference word for word. */}
      <Block n={3} title="What This Post Was About" sub="Topics and tags read from the post itself">
        {/* THE COLUMN IS NAMED, AND IT DESCENDS.
            A bare "10%" against a topic on a card about ONE post reads as that
            topic's share of this post's comments. It is not: a reading assigns
            a topic rather than weighing it, so the only real share is how
            often the topic turns up across every post this desk has read in
            full, and the heading now says so rather than leaving the reader to
            assume the wrong denominator. Ordered by that share, because
            10 / 18 / 35 under the word "Top" reads as a broken sort. */}
        <div className="flex items-baseline justify-between gap-2">
          <MiniHead>Top Topics</MiniHead>
          {readWithTopic.length >= 4 && (
            <span
              className="cursor-help text-[9px] font-medium text-ink-3"
              title={`Share of the ${readWithTopic.length} posts this desk has read in full that carry the topic. A reading assigns one topic to a post rather than weighing it, so there is no share within this post to give.`}
            >
              % of read posts
            </span>
          )}
        </div>
        <ul className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {[
            ...(a.topics?.primary ? [a.topics.primary as string] : []),
            ...((a.topics?.secondary ?? []) as string[]),
          ]
            .map((t) => ({ topic: t, share: topicShare(t) }))
            .sort((x, y) => (y.share ?? -1) - (x.share ?? -1))
            .map(({ topic, share }) => (
              <li key={topic} className="flex items-center gap-1">
                <Chip
                  tone={topic === a.topics?.primary ? 'accent' : undefined}
                  title={topic === a.topics?.primary ? (a.topics?.subtopic ?? undefined) : undefined}
                  className="px-2 py-0.5 text-[9.5px]"
                >
                  {topic}
                </Chip>
                {share != null && (
                  <span
                    className="tnum shrink-0 cursor-help text-[10px] font-semibold text-ink-3"
                    title={`${topic} is the topic on ${share}% of the ${readWithTopic.length} posts this desk has read in full, not ${share}% of this post's comments.`}
                  >
                    {share}%
                  </span>
                )}
              </li>
            ))}
        </ul>
        <MiniHead className="mt-2.5">Top Keywords</MiniHead>
        {tags.length === 0 ? (
          <Nothing title="The post carried no hashtags and the reading assigned no tags.">
            None recorded
          </Nothing>
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

      </Block>

      {/* ── 4 ────────────────────────────────────────────────────────────── */}
      <Block n={4} title="Worth Highlighting" sub="Comments from this post's audience">
        {/* The reference's quote boxes hold audience comments only; the lines
            the reading pulled from the post itself live in the full reading.
            "Top" is only claimed where the stored comments carry likes to
            rank by — otherwise these are simply the first comments stored,
            and the heading says "Comments" rather than promising a ranking
            that was never computed. */}
        {comments.length === 0 ? (
          <Nothing>No comments are stored for this post.</Nothing>
        ) : (
          (() => {
            const ranked = comments.some((c) => c.likes != null)
            const byLikes = ranked
              ? [...comments].sort((x, y) => (y.likes ?? -1) - (x.likes ?? -1))
              : comments
            const top = byLikes[0]!
            const topPositive = ranked
              ? byLikes.find((c) => c !== top && c.side === 'positive')
              : byLikes[1]
            /* The quote mark sits inline to the left of the first line, as
               the reference draws it. On its own line it cost a whole line of
               a three-line box and rendered as a small double-comma artifact
               floating in the padding. The attribution is italic, also per
               the reference. */
            const box = (c: (typeof comments)[number]) => (
              <blockquote className="mt-1.5 rounded-[var(--radius-md)] bg-[var(--accent-soft)] p-2">
                <div className="flex gap-1.5">
                  <Quote
                    size={13}
                    className="mt-0.5 shrink-0 text-[var(--accent)]"
                    fill="currentColor"
                    aria-hidden
                  />
                  <p
                    className="min-w-0 line-clamp-3 text-[10px] leading-relaxed text-ink-2"
                    title={c.text}
                  >
                    {commentText(c.text)}
                  </p>
                </div>
                {c.author && <p className="mt-1 text-[9px] italic text-ink-3">– {c.author}</p>}
              </blockquote>
            )
            return (
              <>
                <MiniHead>{ranked ? 'Top Comment' : 'Comments'}</MiniHead>
                {box(top)}
                {topPositive && (
                  <>
                    {ranked && <MiniHead className="mt-2">Top Positive Comment</MiniHead>}
                    {box(topPositive)}
                  </>
                )}
                <button
                  type="button"
                  onClick={() => onOpenReport(h.report)}
                  title={`All ${comments.length} ${pluralise(comments.length, 'comment')} stored for this post.`}
                  className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--accent)]"
                >
                  View more comments
                  <ArrowRight size={11} aria-hidden />
                </button>
              </>
            )
          })()
        )}
      </Block>

      {/* ── 5 ────────────────────────────────────────────────────────────── */}
      <Block
        n={5}
        title="Mentions Summary"
        sub="People, places, parties mentioned"
        hover="Named by this post's reading. Each is named once; the right-hand word is the stance the reading recorded."
      >
        {/* All four kinds a reading records, not two of them. Schemes were
            being dropped entirely, and they are named on fifteen of the
            fifty-five read posts — the one additive deviation from the
            reference's three groups, styled identically. The reference's
            right-hand percentage has no honest source (a reading names each
            of these once, weightless), so the stance word holds that slot. */}
        {people.length === 0 && orgs.length === 0 && places.length === 0 && schemes.length === 0 ? (
          <Nothing title="The reading named nobody and nowhere in this post.">None named</Nothing>
        ) : (
          <div>
            <NameGroup title="People" kind="person" names={people} />
            <NameGroup title="Places" kind="place" names={places.map((p) => ({ name: p }))} />
            <NameGroup title="Parties and bodies" kind="org" names={orgs} />
            <NameGroup title="Schemes" kind="org" names={schemes} />
          </div>
        )}
      </Block>

      {/* ── 6 ────────────────────────────────────────────────────────────── */}
      <Block
        n={6}
        title="Credibility Check"
        sub="Would this survive a fact check"
        hover="Signals read from the post itself, not doubts anyone raised about it."
      >
        {/* The reference puts the findings first and closes with the verdict
            chip, which is the order a fact check is actually read in. */}
        {signals.length === 0 && claims.length > 0 ? (
          <>
            <MiniHead>Claims worth checking</MiniHead>
            <ul className="mt-1.5 space-y-1.5">
              {claims.slice(0, 3).map((c, i) => (
                <li key={i} className="cursor-help" title={c.why}>
                  <p className="line-clamp-2 text-[10px] leading-relaxed text-ink-2">{c.claim}</p>
                </li>
              ))}
            </ul>
          </>
        ) : signals.length === 0 ? (
          <Nothing title="The reading recorded nothing for or against this post's verifiability.">
            Nothing recorded either way
          </Nothing>
        ) : (
          /* The direction word belongs to the ROW, not to its first line.
             Pinned inline it sat beside line one of a two-line finding and
             read as an interruption of the sentence; the reference keeps a
             right-hand column against the whole item, so it is aligned to the
             row's top and given a column of its own. */
          <ul className="space-y-1.5">
            {signals.slice(0, 4).map((s, i) => (
              <li key={i} className="grid grid-cols-[1fr_auto] items-start gap-2">
                <span className="line-clamp-2 min-w-0 text-[10px] leading-relaxed text-ink-2">
                  {s.signal}
                </span>
                <span
                  className="w-[42px] shrink-0 text-right text-[9px] font-semibold leading-relaxed"
                  style={{ color: s.direction === 'undermines' ? 'var(--neg)' : 'var(--pos)' }}
                >
                  {s.direction === 'undermines' ? 'against' : 'supports'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {/* The reference closes on a borderless tinted chip with no icon and
            no rule above it. */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Chip
            tone={a.credibility?.suspectedFalse === 'No' ? 'positive' : 'warning'}
            title={[
              a.confidence
                ? `The reading marked ${a.confidence} confidence${
                    (a.inferredFields ?? []).length > 0
                      ? `, with ${(a.inferredFields ?? []).length} ${pluralise((a.inferredFields ?? []).length, 'field')} inferred rather than read`
                      : ''
                  }.`
                : undefined,
              a.credibility?.notes ?? undefined,
            ]
              .filter(Boolean)
              .join(' ')}
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
      </Block>

      {/* ── 7 ────────────────────────────────────────────────────────────── */}
      <Block
        n={7}
        badge
        title="What It Means For You"
        hover="The reading's own observations about this post."
      >
        {observations.length === 0 ? (
          <Nothing title="The reading recorded no observation of its own for this post.">
            None recorded
          </Nothing>
        ) : (
          /* THE REFERENCE'S FRAGMENTS, NOT PARAGRAPHS.
             The reference sets four one-line telegraphic notes here. The
             reading writes whole sentences, and two of them at three lines
             each is exactly the explanatory prose this screen is not allowed
             to carry. The observation is not rewritten — that would be
             putting words in the reading's mouth — it is cut at its own first
             sentence boundary and the whole of it rides the row's hover. */
          <ul className="space-y-1.5">
            {observations.slice(0, 4).map((o, i) => (
              <li
                key={i}
                className="flex cursor-help items-start gap-1.5 text-[10px] leading-relaxed text-ink-2"
                title={o}
              >
                <span
                  aria-hidden
                  className="mt-px grid size-3.5 shrink-0 place-items-center rounded-full bg-[var(--pos)] text-white"
                >
                  <Check size={9} strokeWidth={3.2} />
                </span>
                <span className="line-clamp-3">{firstSentence(o)}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {/* ── 8 ────────────────────────────────────────────────────────────── */}
      <Block
        n={8}
        badge
        title="Recommended Action"
        hover={[
          'What the reading recorded as the ask behind this post.',
          a.civic?.actionCategory
            ? `Filed as ${a.civic.actionCategory}${a.civic.actionPriority ? `, ${a.civic.actionPriority} priority` : ''}${a.civic.isGrievance && a.civic.grievanceType ? `, ${a.civic.grievanceType}` : ''}.`
            : undefined,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* The reference draws this block as two plain ink paragraphs and
            nothing else; those two are real fields off the reading, so they
            simply lose their chrome. The filing chips ride the title hover. */}
        {/* The clamp was two lines over a card with eighty pixels of empty
            space under it, so the first sentence was severed at "camp for
            women in Mahabubnagar…" for no reason at all. Both fields get the
            room the block already has, and the hover holds the whole of each
            for the rare line that still runs past it. */}
        {a.civic?.issueDescription && (
          <p
            className="line-clamp-4 cursor-help text-[10px] leading-relaxed text-ink-2"
            title={a.civic.issueDescription}
          >
            {a.civic.issueDescription}
          </p>
        )}
        {a.civic?.suggestedAction && a.civic.suggestedAction !== 'Monitor only' ? (
          <p
            className="mt-2 line-clamp-5 cursor-help text-[10px] leading-relaxed text-ink-2"
            title={a.civic.suggestedAction}
          >
            {a.civic.suggestedAction}
          </p>
        ) : (
          <p className="mt-2 text-[10px] leading-relaxed text-ink-2">
            No action recorded. The reading filed it to watch, not to answer.
          </p>
        )}
      </Block>

        <PostIdeaBlocks h={h} />
      </div>
    </div>
  )
}

/* ── the strip ───────────────────────────────────────────────────────────── */

/**
 * One figure on a strip card. Never shown as nought, and never dropped.
 *
 * It used to disappear when the platform published nothing, so the five cards
 * in a row carried three, four, two, three and three figures and the strip
 * had no readable columns at all — the eye could not compare card 3's likes
 * with card 4's because they were not in the same place. The slot is held and
 * marked NA, which is the same absence said in a way that keeps the row.
 */
function Stat({
  icon,
  value,
  label,
  platform,
}: {
  icon: ReactNode
  value: number | null
  label: string
  platform: string
}) {
  return (
    <span
      className="tnum flex shrink-0 items-center gap-0.5 text-[10px] text-ink-3"
      title={
        value == null
          ? `${platform} published no ${label} figure for this post.`
          : `${value.toLocaleString('en-IN')} ${label}`
      }
    >
      {icon}
      {value == null ? <span className="opacity-55">NA</span> : compact(value)}
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
      title={
        h.hasComments
          ? undefined
          : 'No comments were read under this post, so there is no audience sentiment to score. The figures shown are what the platform published.'
      }
      className={cn(
        /* Grows to share the container out when a lens holds five cards or
           fewer, so the strip has no dead margin at its right edge, and
           holds its width and scrolls when a lens holds more. */
        'w-[214px] max-w-[280px] shrink-0 grow overflow-hidden rounded-[var(--radius-md)] border bg-[var(--surface)] text-left transition-shadow',
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
          /* Large enough to read as a deliberate "no picture is stored" mark
             rather than as a speck left over from a render that failed. */
          iconSize={24}
          className="aspect-[16/9] w-full rounded-[var(--radius-md)]"
        />
      </div>

      <p className="mt-2 line-clamp-1 px-2.5 text-[11.5px] font-semibold">{h.title}</p>

      {/* One line, not two. The reference sets the score and the four figures
          as a single run under the title, and a wrapped fifth item made the
          cards in a row different heights. */}
      <div className="mt-1.5 flex flex-nowrap items-center gap-x-1.5 overflow-hidden px-2.5 pb-2.5">
        {/* THE SCORE SLOT IS EMPTY WHERE THERE IS NOTHING TO SCORE.
            The "By platform" lens lists every read post, comments or none.
            On a post nobody commented on the stored score is the reading of
            the post's own words, which is not a reaction and must not wear
            the badge of one — so the slot renders nothing and the card's own
            hover says why, in place of a printed caption the reference has
            no room for. */}
        {h.hasComments && (
          <span
            className="flex shrink-0 cursor-help items-center gap-1"
            title="Tone of the comments, out of 100. The stored readings are coarse and often tie at the top, and where they do the stronger reaction total ranks first — so the figures beside this are what separates these cards, not the score."
          >
            <Smile size={12} style={{ color: toneColour(h.score) }} aria-hidden />
            <span className="tnum text-[11px] font-bold" style={{ color: toneColour(h.score) }}>
              {h.scoreOutOf100}
              <span className="text-[9px] font-medium text-ink-3">/100</span>
            </span>
          </span>
        )}
        <Stat
          icon={<ThumbsUp size={9} aria-hidden />}
          value={h.likes}
          label="likes"
          platform={h.platform}
        />
        <Stat
          icon={<MessageCircle size={9} aria-hidden />}
          value={h.comments}
          label="comments"
          platform={h.platform}
        />
        <Stat
          icon={<Forward size={9} aria-hidden />}
          value={h.shares}
          label="shares"
          platform={h.platform}
        />
        <Stat
          icon={<Eye size={9} aria-hidden />}
          value={h.views}
          label="views"
          platform={h.platform}
        />
      </div>
    </button>
  )
}

/**
 * The arrow half-on each edge of the strip's container, as the reference
 * draws it. Free-floating on the page ground with forty pixels of gap to the
 * nearest card, they read as two unattached buttons rather than as the
 * controls of the row they scroll.
 */
function StripArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Scroll back' : 'Scroll forward'}
      className={cn(
        'absolute top-1/2 z-10 hidden size-7 -translate-y-1/2 place-items-center rounded-full',
        'border border-[var(--border)] bg-[var(--surface)] text-ink-2 shadow-[var(--e1)]',
        'transition-colors hover:border-[var(--border-interactive)] hover:text-ink lg:grid',
        side === 'left' ? '-left-3.5' : '-right-3.5',
      )}
    >
      {side === 'left' ? <ChevronLeft size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
    </button>
  )
}

/* ── the header ──────────────────────────────────────────────────────────── */

function Header({
  win,
  sameNote,
  onWin,
  onClose,
  exportable,
  anchor,
}: {
  win: WindowId
  /** Why a wider window shows the same cards, where that is the case. */
  sameNote?: string
  onWin: (w: WindowId) => void
  onClose: () => void
  exportable: Report[]
  anchor: string | null
}) {
  return (
    <div>
      {/* NAVIGATION IS CHROME, NOT PART OF THE SCREEN'S HEADER.
          The reference's header ends at Export Report. "Back" sat to the
          right of it as a third control of equal weight, and at 390 it
          orphaned onto its own line at an indent that lined up with nothing.
          As a breadcrumb above the title it is where a reader looks for a way
          out, it stops competing with the two controls that act on the data,
          and it has somewhere to sit at every width. */}
      <button
        type="button"
        onClick={onClose}
        className="-ml-1 mb-1 inline-flex min-h-8 items-center gap-1 rounded-[var(--radius-xs)] px-1 text-[12px] font-semibold text-ink-3 transition-colors hover:text-ink"
      >
        <ChevronLeft size={14} aria-hidden />
        Back to the dashboard
      </button>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {/* Sans, not the serif `.display` voice. The reference sets this
              screen in the same grotesque as the rest of its chrome, and the
              serif read as a different product sitting inside this one.
              Stepped down again: against the strip's 214px cards the title
              was running near twice the reference's share of the row, so the
              loudest thing on a screen of measurements was its own name. */}
          <h1 className="text-[clamp(1.2rem,1.05rem+0.5vw,1.35rem)] font-bold tracking-[-0.022em]">
            Post Highlights
          </h1>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">
            Deep insights into the posts that got the strongest reactions.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
        <select
          value={win}
          onChange={(e) => onWin(e.target.value as WindowId)}
          aria-label="The window these figures cover"
          className="select min-h-9 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-3 text-[12.5px] font-medium text-ink shadow-[var(--e1)] outline-none"
          /* The windows are measured back from the newest post this desk
             holds, not from today. A dataset read last month would otherwise
             report an empty "last 7 days" and read as a desk that has stopped
             working, which is a different and far more alarming claim. */
          /* Where every card is under a week old a wider window changes
             nothing. That fact used to be a printed line under the caption;
             the office read the silent control as broken, but the reference
             allows one caption line, so the explanation rides here. */
          title={
            anchor
              ? `Measured back from your newest stored post, ${dayOf(anchor)}.${
                  sameNote
                    ? ' Everything shown is under a week old, so wider windows hold the same cards.'
                    : ''
                }`
              : 'No stored post carries a date.'
          }
        >
          {WINDOWS.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
          {/* The reference's indigo-on-white export: text and icon in the
              accent, a light accent border, a moderate radius. As black bold
              text in a full pill it was the heaviest element in the header,
              on a screen where the heaviest element should be a figure. */}
          <Button
            variant="outline"
            className="min-h-9 gap-1.5 rounded-[var(--radius-xs)] border-[var(--accent-soft)] px-3 text-[12.5px] text-[var(--accent)] hover:border-[var(--accent)]"
            onClick={() => downloadCsv(exportable)}
            disabled={exportable.length === 0}
          >
            <Download size={14} aria-hidden />
            Export Report
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── the screen ──────────────────────────────────────────────────────────── */

export function PostHighlights({
  onClose,
  onOpenReport,
  onRead,
  initialLens,
  initialWindow,
}: {
  onClose: () => void
  onOpenReport: (report: Report) => void
  onRead: (postUrl: string) => void
  /**
   * The lens to OPEN on, when the reader arrived by asking for one.
   *
   * Optional, because the dashboard's inert preview of this screen mounts it
   * with three props and must keep opening on the default lens.
   */
  initialLens?: Lens
  /**
   * The window to open on, carried from wherever the reader came from.
   *
   * WITHOUT IT THE DESTINATION QUIETLY RE-WINDOWS. The dashboard's tables
   * default to a month and this screen to a week, so following a link from a
   * table showing thirty days' posts landed on a list showing seven — the
   * same reader, the same posts, two different periods, and nothing on
   * either screen saying they had changed. The picker still governs from
   * there; this only decides where it starts.
   */
  initialWindow?: WindowId
}) {
  const reduce = useReducedMotion() === true
  const reports = useStoredReports()
  const handles = useMemo<TrackedHandle[]>(() => listHandles(), [])
  const { highlights, unread } = useMemo(() => highlightsOf(handles, reports), [handles, reports])

  /*
   * SEEDED, NOT CONTROLLED. The tab row below is still the only thing that
   * moves the lens after mount. An effect syncing it to the prop would fight
   * the reader — and worse, the shell keeps this screen mounted through its
   * exit animation, so clearing the request on the way out would visibly snap
   * the leaving screen back to the default lens under the reader's eyes.
   */
  const [lens, setLens] = useState<Lens>(initialLens ?? 'overall')
  const [platform, setPlatform] = useState<string | null>(null)
  /* The reference opens on seven days and the screen opened on all time,
     which is not a styling difference: it changes what every figure on the
     screen covers. Seven days is safe to default to here because the window
     is measured back from the newest stored post rather than from the clock
     (see the picker's own note), so the lens can never open empty. */
  const [win, setWin] = useState<WindowId>(initialWindow ?? 'week')
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
    /* "Strongest reactions" is a reaction ranking, so a post nobody reacted
       to in words is not in it. `highlightsOf` orders by the absolute
       sentiment score, and on a post with no comments that score was read
       from the post's own wording, which would put a post nobody answered at
       the top of a strip about how people answered. */
    return inRange.filter((h) => h.hasComments).slice(0, 5)
  }, [lens, platform, platforms, inRange])

  /* Computed over what the strip ACTUALLY shows, not over everything stored,
     so the sentence is about the cards in front of the reader. */
  const sameNote = useMemo(() => {
    const dates = shown.map((h) => h.publishedAt).filter((d): d is string => Boolean(d))
    if (dates.length === 0) return ''
    return sameWindowNote(dates.reduce((a, b) => (a < b ? a : b)), win)
  }, [shown, win])

  const current = shown.find((h) => h.url === open) ?? shown[0] ?? null
  const rest = shown.filter((h) => h.url !== current?.url)

  /* The strip's own arrows, per the reference. One card per press. */
  const strip = useRef<HTMLDivElement | null>(null)
  const nudge = useCallback((dir: -1 | 1) => {
    strip.current?.scrollBy({ left: dir * 226, behavior: 'smooth' })
  }, [])

  if (highlights.length === 0) {
    return (
      <Shell className="stack entry-accent">
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
    <Shell className="stack entry-accent">
      <m.div variants={listStagger} initial={reduce ? false : 'hidden'} animate="show">
        <m.div variants={fadeUp}>
          <Header
            win={win}
            onWin={setWin}
            onClose={onClose}
            exportable={shown.map((h) => h.report)}
            anchor={anchor}
            sameNote={sameNote}
          />
        </m.div>

        {/* ── the lenses, underlined per the reference ─────────────────── */}
        {/* The reference's tab row: a tinted rounded-top ground behind the
            active label, a thick indigo underline on it, a hairline rule
            running the full width beneath the whole row, and inactive labels
            in charcoal rather than the grey that made three of the four read
            as disabled. */}
        <m.div variants={fadeUp} className="mt-3 border-b border-[var(--border-strong)]">
          <div className="flex flex-wrap items-end gap-x-0.5">
            {LENSES.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLens(l.id)}
                aria-pressed={lens === l.id}
                title={LENS_NOTE[l.id]}
                className={cn(
                  'relative min-h-9 rounded-t-[var(--radius-xs)] px-3 pb-2 pt-1.5 text-[12.5px] font-semibold transition-colors',
                  lens === l.id
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'text-ink-2 hover:bg-[var(--surface-2)]',
                )}
              >
                <span className="flex items-center gap-1">
                  {l.label}
                  {l.id === 'platform' && <ChevronDown size={13} aria-hidden />}
                </span>
                {lens === l.id && (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 -bottom-px h-[2.5px] rounded-t-full bg-[var(--accent)]"
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
              {/* An empty lens has to say WHICH emptiness it is. Three of the
                  four now list only posts with comments under them, so "no
                  post was received badly" and "no post of yours has a comment
                  to be received in" are different facts, and a desk that
                  printed the first over the second would be reporting calm
                  where it has no reading at all. */}
              <p className="text-sm leading-relaxed text-ink-2">
                {lens === 'positive'
                  ? 'No post of yours with comments under it was received warmly in the readings held.'
                  : lens === 'negative'
                    ? 'No post of yours with comments under it was received badly in the readings held. That is a finding, not a gap.'
                    : lens === 'overall' && inRange.length > 0
                      ? `Nothing to rank in this window. ${inRange.length} ${
                          inRange.length === 1 ? 'post was' : 'posts were'
                        } read here and no comment was retrieved on any of them, so there is no reaction to rank them by.`
                      : `Nothing read in this window. ${
                          anchor
                            ? `Your newest stored post is from ${dayOf(anchor)}.`
                            : 'No stored post carries a date.'
                        }`}
              </p>
            </Card>
          ) : (
            /* The reference sits the five cards inside a bordered white
               container with the two chevrons half-on its edges. Floating on
               the page's lavender wash they had no shared ground at all, so
               the strip read as five unrelated tiles rather than as one
               ranked row. */
            <div className="relative rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-2.5 shadow-[var(--e1)]">
              <StripArrow side="left" onClick={() => nudge(-1)} />
              <div ref={strip} className="flex gap-2.5 overflow-x-auto scroll-smooth pb-0.5">
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
            </div>
          )}
        </m.div>

        {/* ── the expanded post ───────────────────────────────────────── */}
        {current && !collapsed && (
          <m.div variants={fadeUp} className="mt-3">
            {/* White with a hairline, as the reference draws it. On a lavender
                wash the ten white blocks read as tiles floating on a coloured
                sheet, which put a second ground between the page and the
                data and made the whole panel heavier than anything on it. */}
            <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-2.5 shadow-[var(--e1)]">
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
          /* ONE CARD WITH HAIRLINES, NOT FOUR FLOATING PANELS.
             Each row carried its own 20px radius, its own border and a gap to
             the next, so a ranked list read as four unrelated cards and the
             ranking itself — the only reason the rows are in that order —
             had no shared frame to be read down. */
          <m.ul
            variants={fadeUp}
            className="mt-3 divide-y divide-[var(--rule)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--e1)]"
          >
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
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <span className="tnum grid size-5 shrink-0 place-items-center rounded-full bg-[var(--surface-3)] text-[10px] font-bold text-ink-2">
                      {rank}
                    </span>
                    {/* One shape for the whole column. Facebook's badge is a
                        circle and Instagram's a rounded square, so the icon
                        column changed shape from row to row; the reference
                        squares them all off. */}
                    <PlatformBadge platform={h.platform} size={20} className="rounded-[6px]" />
                    <span className="line-clamp-1 min-w-0 flex-1 text-[12.5px] font-medium">
                      {h.title}
                    </span>
                    <span className="hidden shrink-0 text-[11px] text-ink-3 sm:block">
                      {dayOf(h.publishedAt)}
                    </span>
                    {/* WHAT ACTUALLY ORDERED THESE ROWS.
                        The stored −100…+100 scores are coarse and the top of
                        this desk's ranking ties at 90, which maps to 95 on
                        every card and every row — nine identical numbers under
                        a heading about ranking. The tie is real and inventing
                        spread to hide it is out of the question, so the column
                        that breaks the tie is printed beside the one that
                        does not: `highlightsOf` sorts on the strength of the
                        reaction and settles ties on the reaction total, and
                        that total is this. */}
                    {h.measured && (
                      <span
                        className="tnum hidden shrink-0 cursor-help text-[11px] text-ink-3 lg:block"
                        title={`${h.reactionsNote} Where two posts read the same, the larger total ranks first.`}
                      >
                        {compact(h.reactions)} reactions
                      </span>
                    )}
                    {/* Same rule as the strip card above: no comments, no
                        sentiment score and no mood word. Both of those are
                        readings of how people answered, and where nobody
                        answered the row says that instead of printing the
                        post's own register in the column reserved for the
                        audience's. */}
                    {h.hasComments ? (
                      <>
                        <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-ink-3 md:flex">
                          Sentiment Score
                          <span className="tnum font-bold" style={{ color: toneColour(h.score) }}>
                            {h.scoreOutOf100}/100
                          </span>
                        </span>
                        {/* ONE TONE VOCABULARY PER SCREEN, IN THE REFERENCE'S
                            CHIP. This slot printed the reading's free-text
                            narrative — "Agreed", "Happy" — beside a panel
                            calling the same tone "Strong Positive", so one
                            screen carried two vocabularies for one thing. The
                            label is the reading's own classification and it is
                            the word block 1 uses; the narrative it replaces is
                            one hover away. */}
                        <span
                          className="hidden w-[104px] shrink-0 justify-center rounded-full px-2 py-0.5 text-center text-[10.5px] font-semibold lg:inline-flex"
                          style={{
                            color: toneColour(h.score),
                            background:
                              h.score >= 15
                                ? 'var(--pos-soft)'
                                : h.score <= -15
                                  ? 'var(--neg-soft)'
                                  : 'var(--warn-soft)',
                          }}
                          title={`The reading's own classification of this post's comments.${
                            h.narrative ? ` It read the public narrative as "${h.narrative}".` : ''
                          }`}
                        >
                          {h.label}
                        </span>
                      </>
                    ) : (
                      /* The hover used to assert "Nobody commented on this
                         one" without looking: the same words covered a post
                         whose count is zero and a post whose comments were
                         never fetched, and only the first is true of the
                         audience. The count the desk holds is what separates
                         them. */
                      <span
                        className="hidden shrink-0 cursor-help text-[11px] text-ink-3 md:block"
                        title={
                          h.comments === 0
                            ? 'Nobody commented on this post — nothing to score.'
                            : h.comments != null && h.comments > 0
                              ? `${h.platform} shows ${h.comments.toLocaleString('en-IN')} comment${h.comments === 1 ? '' : 's'} here; none has been read yet.`
                              : 'No comments read, and no comment count published — not known whether anybody commented.'
                        }
                      >
                        {h.comments === 0
                          ? 'No comments'
                          : h.comments != null && h.comments > 0
                            ? `${h.comments.toLocaleString('en-IN')} unread`
                            : 'Not known'}
                      </span>
                    )}
                    <ChevronDown size={15} className="shrink-0 text-ink-3" aria-hidden />
                  </button>
                </li>
              )
            })}
          </m.ul>
        )}

      </m.div>
    </Shell>
  )
}
