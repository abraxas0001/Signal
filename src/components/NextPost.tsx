import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import {
  ArrowLeft,
  ArrowRight,
  AudioWaveform,
  BadgeCheck,
  Briefcase,
  CalendarDays,
  ChartColumn,
  Church,
  Download,
  FileText,
  GraduationCap,
  HeartPulse,
  Info,
  Landmark,
  Lightbulb,
  LoaderCircle,
  MessageSquare,
  Newspaper,
  RefreshCw,
  Sparkle,
  Sparkles,
  ThumbsUp,
  TrendingUp,
  Vote,
  Wand2,
} from 'lucide-react'
import { Button, Card, Chip, Empty, Shell } from './ui'
import { DonutBreakdown, PlatformBadge, seriesColor } from '@/components/kit'
import { listHandles } from '@/lib/handles'
import { loadPostReports } from '@/lib/post-reports'
import { isDemoScope, readStore, useStore } from '@/lib/store'
import { issuesFor, platformReachOf, ownPostsOf } from '@/lib/briefing'
import {
  keyFindingOf,
  nextPostModelOf,
  openingsOf,
  quoteSpreadOf,
  topicRingOf,
  type NextPostModel,
  type Opening,
  type RingSlice,
  type ThemeRow,
} from '@/lib/next-post'
import {
  loadPostPlan,
  planReady,
  readPlanCache,
  type PlanInput,
  type PlanResult,
} from '@/lib/post-plan'
import { InfoMark } from '@/components/briefing/controls'
import {
  fetchSuggestions,
  readSuggestions,
  saveSuggestions,
  type SuggestedPost,
} from '@/lib/suggest'
import { buildWorkbook, saveBlob } from '@/lib/xlsx'
import { WINDOWS, type WindowId } from '@/lib/window'
import type { Report } from '@shared/types'
import { cn, compact } from '@/lib/utils'
import { fadeUp, listStagger } from '@/lib/motion'

/**
 * "What should you post next", built to the owner's reference and then made to
 * tell the truth.
 *
 * The reference page carries five stat tiles, three numbered tabs, and a
 * three-column body: reasons on the left, a post-type table in the middle,
 * data points and sample comments on the right. That shape is kept — down to
 * the squircle tile icons, the ranked theme strip and the tinted quote
 * blocks. What changed is what fills it, and the rules are written on the
 * model (src/lib/next-post.ts): nothing here forecasts, nothing crosses
 * platforms, every figure carries its denominator, and below the floors the
 * count itself is the content. The three tabs map onto three pipelines this
 * product already runs: the stored readings (why), the news and grievance
 * desks (openings), and the plan-and-studio pair (ideas), which is what turns
 * a recommendation into a poster without leaving the product.
 */

type TabId = 'why' | 'openings' | 'ideas'

const TABS: { id: TabId; n: number; label: string }[] = [
  { id: 'why', n: 1, label: 'What your readings back' },
  { id: 'openings', n: 2, label: 'Openings to answer' },
  { id: 'ideas', n: 3, label: 'Ready to run ideas' },
]

export function NextPost({
  onClose,
  onMakePost,
}: {
  onClose: () => void
  /** Hands a drafted idea to the content studio as its opening brief. */
  onMakePost: (brief: string) => void
}) {
  const store = useStore()
  const reduce = useReducedMotion()
  const [tab, setTab] = useState<TabId>('why')
  const [windowId, setWindowId] = useState<WindowId>('all')
  const [reports, setReports] = useState<Map<string, Report> | null>(null)

  useEffect(() => {
    let alive = true
    void loadPostReports().then((r) => alive && setReports(r))
    return () => {
      alive = false
    }
  }, [])

  const handles = useMemo(() => listHandles(), [])
  const model = useMemo(
    () => nextPostModelOf(handles, reports, windowId),
    [handles, reports, windowId],
  )

  const exportReport = useCallback(() => void exportModel(model), [model])

  return (
    <Shell className="stack">
      <m.div variants={listStagger} initial={reduce ? false : 'hidden'} animate="show">
        {/* ── the head ─────────────────────────────────────────────────── */}
        <m.div
          variants={fadeUp}
          className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2.5 text-[clamp(1.45rem,1.15rem+1vw,1.75rem)] font-bold tracking-[-0.022em]">
              What Should You Post Next?
              <span
                className="grid size-[26px] shrink-0 place-items-center rounded-full border border-[var(--border-strong)] text-ink-2"
                aria-hidden
              >
                <Sparkle size={14} />
              </span>
            </h1>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
              Read from your own posts and comments. Nothing here is a forecast.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="nextpost-window">
              Time window
            </label>
            <span className="flex min-h-11 items-center rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] pl-3 shadow-[var(--e1)]">
              <CalendarDays size={14} className="shrink-0 text-ink-3" aria-hidden />
              <select
                id="nextpost-window"
                value={windowId}
                onChange={(e) => setWindowId(e.target.value as WindowId)}
                className="select bg-transparent py-2 pl-2 text-[13px] font-semibold text-ink"
              >
                {WINDOWS.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
            </span>
            <Button variant="outline" onClick={exportReport} disabled={model.empty}>
              <Download size={15} className="text-[var(--accent)]" aria-hidden />
              Export report
            </Button>
            <Button variant="ghost" onClick={onClose}>
              <ArrowLeft size={15} aria-hidden />
              Back
            </Button>
          </div>
        </m.div>

        {model.empty ? (
          <m.div variants={fadeUp} className="mt-4">
            {/* "NOTHING READ YET" WAS FALSE IN THE STATE THIS BRANCH GUARDS.
                `model.empty` is `no own posts stored AND no posts on any
                tracked account` — it says nothing whatever about READINGS,
                which live in a separate store keyed by post URL. Intercept
                this desk's accounts and the branch fires with all 100 post
                readings still on disk, so the screen told an office that had
                read a hundred posts that nothing had been read, and invited
                it to "let a reading run" that had already run. What is
                actually absent is the posts to attribute those readings to,
                and that is what the card says now. */}
            <Empty
              icon={<Lightbulb size={18} aria-hidden />}
              title="No posts of your own on file"
              body="This screen is written from your desk's own posts and the comments under them, and no posts are stored against your accounts. Add the accounts you post from, and what has been read will be counted here."
            />
          </m.div>
        ) : (
          <>
            {/* ── the five tiles ─────────────────────────────────────── */}
            <m.div variants={fadeUp} className="@container mt-4">
              {/* FIVE ACROSS, ON THE SCREEN THE OFFICE ACTUALLY USES, AND THE
                  SQUIRCLE BESIDE THE CAPTION AS IN THE REFERENCE.
                  @5xl is 1024px OF CONTAINER, and the shell's 240px rail and
                  gutters leave 976px at a 1280 laptop, so the reference's one
                  row of five still broke into 3 + 2 on the commonest screen
                  there is — measured, not assumed. 60rem (960px) is the widest
                  threshold a 1280 viewport clears, and it holds at every width
                  above it because the container caps at 1320. At that width a
                  tile is 182.4px.

                  The previous pass answered that width by moving the squircle
                  ABOVE the caption, which bought 54px of text and gave up the
                  one piece of tile anatomy the reference is unambiguous
                  about. It is beside the caption again at every width. What
                  paid for it is not layout but TYPE: a tile whose value is a
                  measurement prints it at 23px, and a tile with no
                  measurement to print says so at 14px (`Tile`'s `measured`),
                  because "Not scored" is a sentence and never wore a figure's
                  clothes honestly in the first place. Measured after, at
                  1280 / 1440 / 1536: no figure and no denominator wraps, and
                  the five captions share one baseline (TILE_LABEL_BOX). */}
              <div className="grid items-stretch gap-4 @lg:grid-cols-2 @3xl:grid-cols-3 @min-[60rem]:grid-cols-5">
                <Tile
                  icon={<MessageSquare size={20} aria-hidden />}
                  color="var(--pos)"
                  bg="var(--pos-soft)"
                  label="Comments Positive"
                  /* NULL IS NOT ZERO. `audienceOf` divides by the comment
                     total and returns 0 where nothing was read, so a desk
                     with posts and no comment reading printed a confident
                     "0%" — an absent measurement rendered as a measured
                     absence of warmth, in green, at the top of the screen.
                     Where nothing was scored the tile says so.

                     AND IT SAYS THE TRUE THING. The guard was `commentsRead`
                     and the fallback read "no comments have been read on your
                     accounts", which is false on the desk it guards: strip
                     the standings and this desk still holds 187 comments
                     stored whole by its post readings, with 220 more counted
                     under the themes in the table below. What is missing is
                     not the comments, it is the reading that SCORES them.

                     Both halves name `commentsScored` because that, and not
                     `commentsRead`, is what the percentage was divided by —
                     see the model. */
                  measured={model.commentsScored > 0}
                  value={model.commentsScored > 0 ? `${model.audience.positive}%` : 'Not scored'}
                  note={
                    model.commentsScored > 0
                      ? `of ${compact(model.commentsScored)} comments scored on your accounts`
                      : /* AND IT DOES NOT ASSERT WHY. `commentsScored` is 0 in
                           three different states — no standing at all, a
                           press-record standing that scored nothing, and a
                           reading that ran and came back with zero counts —
                           and "no account reading has scored your comments
                           yet" is false in the third: a reading did run. What
                           the guard actually knows is the sum, so the sum is
                           what it reports. */
                        'the account readings scored no comments'
                  }
                  hover={perAccountHover(model.windowId, model.commentsScored)}
                />
                <Tile
                  icon={<TrendingUp size={20} aria-hidden />}
                  color="var(--accent-2)"
                  bg="var(--accent-2-soft)"
                  label="Carrying Furthest"
                  measured={bestBucket(model) !== null}
                  value={bestBucket(model) ?? 'Nothing yet'}
                  note={bestBucketNote(model)}
                  hover={bestBucketHover(model)}
                />
                <Tile
                  icon={<Sparkles size={20} aria-hidden />}
                  color="var(--neg)"
                  bg="var(--neg-soft)"
                  label="Themes Read"
                  value={String(model.themes.length)}
                  note={`of ${model.analysedInWindow} posts read in full`}
                  hover={`Counted only where two or more of the ${model.analysedInWindow} posts read in full in this window share a theme.`}
                />
                <Tile
                  icon={<ChartColumn size={20} aria-hidden />}
                  color="var(--warn)"
                  bg="var(--warn-soft)"
                  label="Measured Here"
                  /* The denominator moves to the note rather than out of the
                     tile: "99 of 100" at 23px does not fit beside the
                     squircle at 182px, and the note is where every other tile
                     in this row already carries its "of N". */
                  value={String(model.measuredInWindow)}
                  note={`of ${model.postsInWindow} posts, ${model.platforms} platforms`}
                  hover={`Reactions counted only where the platform published them: a post with no published figure is left out. Window: ${model.windowLabel}.`}
                />
                {/* Tile five is the one meant to stand out: the reference's
                    tinted panel, same label type as the other four, same
                    squircle. It was white with a blue heading that read as a
                    link, so the one card carrying the conclusion was the one
                    that asserted least. */}
                {/* The tint has to be INLINE. `.card` sets `background:
                    var(--surface)` as unlayered author CSS, and unlayered
                    author CSS beats a Tailwind utility in `@layer utilities`
                    no matter how specific — which is why this panel had a
                    `bg-[var(--accent-soft)]` class on it and still rendered
                    plain white, the one card meant to stand out standing out
                    least. `--accent-soft` is also a hair off the page ground;
                    the lavender is the reference's own tint and separates
                    from both the white cards and the page. */}
                <div
                  className="card relative overflow-hidden p-4 @lg:col-span-2 @min-[60rem]:col-span-1"
                  style={{
                    background: 'var(--accent-2-soft)',
                    borderColor: 'color-mix(in oklab, var(--accent) 42%, transparent)',
                  }}
                >
                  <div className={TILE_ROW}>
                    <Squircle
                      icon={<Wand2 size={20} aria-hidden />}
                      color="var(--accent)"
                      bg="var(--surface)"
                      size={TILE_ICON}
                      radius={12}
                    />
                    <div className="min-w-0">
                      {/* THE BASIS GLYPH IS OFF THE CAPTION AND ON THE
                          SENTENCE, WHICH IS WHERE IT BELONGS ANYWAY.
                          "Overall Recommendation" already takes both lines of
                          the caption box at a 182px tile. In a flex row the
                          glyph beside it was pushed 5.8px past the card's own
                          `overflow-hidden` edge and vanished; inline it
                          wrapped to a third line and put this one caption
                          15px below the other four, which is the fault the
                          box exists to prevent. On the sentence it clips
                          nothing, moves nothing, and sits against the text it
                          is the basis for. */}
                      <p className={cn(TILE_LABEL, TILE_LABEL_BOX)}>Overall Recommendation</p>
                      {/* The only prose in the row, and the only thing in it
                          that can outrun its tile at five across. THE CLAMP IS
                          GONE. It was `line-clamp-5` over a sentence that runs
                          six lines in a 94px column, so the one card carrying
                          the conclusion was the one card cut off mid-sentence,
                          with the rest of it hidden on a hover no touch device
                          has. The recommendation strings are bounded — the
                          longest the model can emit is 86 characters — and the
                          row is tall enough to hold it. What it was counted
                          over still rides the glyph above. */}
                      <p
                        className="mt-1 text-[12.5px] font-semibold leading-snug text-ink"
                        title={model.recommendation}
                      >
                        {model.recommendation}
                        <Hover text={model.recommendationBasis} size={11} />
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </m.div>

            {/* ── the tabs ───────────────────────────────────────────── */}
            {/* One bordered container with the active tab as a pill inside it,
                the reference's rhythm — three floating bordered pills read as
                three unrelated buttons. */}
            <m.div variants={fadeUp} className="mt-4">
              <div className="inline-flex max-w-full flex-wrap gap-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--e1)]">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    aria-pressed={tab === t.id}
                    className={cn(
                      'flex min-h-10 items-center gap-2.5 rounded-[var(--radius-sm)] border px-3.5 text-[13.5px] font-semibold transition-colors',
                      tab === t.id
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'border-transparent text-ink-2 hover:bg-[var(--surface-2)]',
                    )}
                  >
                    <span
                      className={cn(
                        'tnum grid size-[22px] place-items-center rounded-full text-[11px] font-bold',
                        tab === t.id
                          ? 'bg-[var(--accent)] text-white'
                          : 'bg-[var(--surface-3)] text-ink-2',
                      )}
                    >
                      {t.n}
                    </span>
                    {t.label}
                  </button>
                ))}
              </div>
            </m.div>

            <m.div variants={fadeUp} className="mt-4">
              {tab === 'why' && <WhyTab model={model} />}
              {tab === 'openings' && <OpeningsTab />}
              {tab === 'ideas' && <IdeasTab model={model} onMakePost={onMakePost} />}
            </m.div>
          </>
        )}
      </m.div>
    </Shell>
  )
}

/* ── small shared pieces ──────────────────────────────────────────────────── */

/** The reference's tinted squircle icon, at whatever size a row calls for. */
function Squircle({
  icon,
  color,
  bg,
  size = 32,
  radius = 10,
}: {
  icon: ReactNode
  color: string
  bg: string
  size?: number
  radius?: number
}) {
  return (
    <span
      className="grid shrink-0 place-items-center"
      style={{ width: size, height: size, borderRadius: radius, background: bg, color }}
      aria-hidden
    >
      {icon}
    </span>
  )
}

/** An Info glyph whose hover carries the explanation the screen must not. */
function Hover({ text, size = 12 }: { text: string; size?: number }) {
  return (
    <span
      title={text}
      aria-label={text}
      role="img"
      className="ml-1 inline-grid translate-y-[1px] place-items-center align-middle text-ink-3"
    >
      <Info size={size} aria-hidden />
    </span>
  )
}

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n))

/** A picture for a reach bucket, cosmetic only — it never adds a claim. */
const carriedIcon = (kind: string) => (kind === 'format' ? FileText : TrendingUp)

/**
 * The ring's colours: the five validated categorical hues, then grey.
 *
 * `seriesColor` cycles a five-colour palette, so a seven-slice ring drew
 * topic six in topic one's blue and the legend showed two different things in
 * the same colour. The model folds the ring to five named slices for exactly
 * this reason; the remainder is the neutral, which is what a remainder is.
 */
const ringColor = (slice: RingSlice, i: number): string =>
  slice.other ? 'var(--mood-mid)' : seriesColor(i)

/* ── tile ─────────────────────────────────────────────────────────────────── */

/**
 * The caption over a tile's figure.
 *
 * It was 13.5px semibold in the same near-black as the number under it, so on
 * a narrow column it wrapped to two lines, pushed the five figures onto four
 * different baselines, and competed with the thing it was labelling. The
 * reference's is a small quiet caption; this is that, and every tile — the
 * recommendation panel included — wears it.
 */
const TILE_LABEL = 'text-[12px] font-medium leading-tight text-ink-2'

/**
 * TWO LINES HELD FOR THE CAPTION, SO THE FIVE FIGURES SIT ON ONE BASELINE.
 *
 * This box was removed last pass on the claim that no caption wraps once the
 * caption has the tile's full 148px. Measured at that very width it is not
 * true: "Overall Recommendation" rendered 30px against the other four
 * captions' 15px, which put one of the five figures a line below its
 * neighbours — the exact fault the box exists to prevent. With the squircle
 * back beside the caption (the reference's arrangement) the captions have
 * 94px at a 1280 laptop and three of the five wrap, so the box is load
 * bearing at every width this app renders, not just the narrow ones. 30px is
 * two lines of 12px at leading-tight, measured off the rendered captions.
 */
const TILE_LABEL_BOX = 'min-h-[30px]'

/**
 * THE SQUIRCLE, AND THE 102px IT LEAVES THE CAPTION.
 *
 * A 44px squircle and a 12px gap left 94px inside a 182.4px tile, and
 * "Recommendation" sets 100px at 12px medium — one unbreakable word, 6px over
 * its box, hanging into the card's padding. 40px and an 8px gap leave 102.4px,
 * which clears it with margin at the narrowest tile this app can render and
 * costs the icon four pixels nobody will miss. Both cells in the row wear it:
 * five tiles whose icons differ in size are five different tiles.
 */
const TILE_ICON = 40
const TILE_ROW = 'grid grid-cols-[40px_1fr] items-start gap-2'

function Tile({
  icon,
  color,
  bg,
  label,
  value,
  note,
  hover,
  measured = true,
}: {
  icon: ReactNode
  color: string
  bg: string
  label: string
  value: string
  note: string
  hover?: string | null
  /**
   * Whether `value` is a figure or a statement that there isn't one.
   *
   * "Not scored" and "Nothing yet" are sentences. Set in 23px bold beside a
   * 44px squircle they both overrun the tile AND read as findings, which is
   * the second time this screen has had to be told that an absent measurement
   * must not wear a measurement's clothes. They print as text.
   */
  measured?: boolean
}) {
  return (
    <Card padded={false} className="h-full p-4">
      <div className={cn(TILE_ROW, 'h-full')}>
        <Squircle icon={icon} color={color} bg={bg} size={TILE_ICON} radius={12} />
        <div className="flex min-w-0 flex-col">
          <p className={cn(TILE_LABEL, TILE_LABEL_BOX)}>{label}</p>
          <p
            className={cn(
              'tnum mt-1 leading-tight',
              measured
                ? 'text-[23px] font-bold tracking-[-0.015em]'
                : 'text-[14px] font-semibold text-ink-2',
            )}
          >
            {value}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">
            {note}
            {hover && <Hover text={hover} size={11} />}
          </p>
        </div>
      </div>
    </Card>
  )
}

/**
 * WHY THE COMMENT TILE DOES NOT MOVE WITH THE WINDOW.
 *
 * The split comes from `audienceOf`, which reads ONE stored comment reading
 * per account: a standing carrying counts, with nothing in it to split by
 * date. So every window shows the same 14% over the same 280 comments, and an
 * office that switches the picker and watches the tile sit still is owed the
 * reason. A per-window split cannot be synthesised — these are a real
 * person's figures, and a manufactured difference would be worse than the
 * stillness — so the tile says plainly what the picker cannot reach. The
 * sentence rides the Info hover now, per the reference's density: one glyph
 * on the tile, the reason one hover away.
 *
 * Only in the narrowed windows, where the figure is genuinely wider than the
 * window on screen. On All time the count and the window already agree and
 * there is nothing to explain.
 */
/**
 * ONLY WHERE THERE IS A READING TO SPEAK OF.
 *
 * Guarding on the window alone made the sentence assert readings that may not
 * exist: a desk whose accounts have never been scored holds no standing at
 * all, and the tile then read "of 0 comments read on your accounts. One
 * reading per account…" — a true conclusion (0 stays 0 in every window)
 * resting on a false premise. The count is the guard: nothing scored, no
 * claim about how it was scored.
 */
const perAccountHover = (windowId: WindowId, commentsScored: number): string | null =>
  windowId === 'all' || commentsScored <= 0
    ? null
    : 'One reading per account, with no split by date, so the window does not narrow this.'

/**
 * The multiple alone, with the thing it belongs to in the note.
 *
 * "Instagram 3.4x" is fourteen characters, which at the tile's figure size
 * wraps to two lines in a five-across row and drops that one tile's number
 * onto its own baseline. The name is not lost — it leads the note directly
 * underneath, which is where the reference puts the same qualifier.
 */
const bestBucket = (model: NextPostModel): string | null => {
  const f = model.lands.working.find((x) => x.kind !== 'topic')
  return f ? `${(Math.round(f.value * 10) / 10).toFixed(1)}x` : null
}

/**
 * The tile note, cut to a caption.
 *
 * The whole finding sentence ran three lines under a one-line figure and made
 * the tile row ragged. The denominator has to stay — that is doctrine — so it
 * stays, as a fragment, and the sentence it came from rides the hover.
 */
const bestBucketNote = (model: NextPostModel): string => {
  const f = model.lands.working.find((x) => x.kind !== 'topic')
  if (!f) {
    return model.lands.thin
      ? `only ${model.measuredInWindow} measured posts, too few to compare`
      : 'nothing sits above your typical post here'
  }
  // The bucket's name, then the first clause of its finding verbatim — that
  // is the clause carrying the count.
  return `${f.label}, ${(f.evidence.split(',')[0] ?? f.evidence).replace(/\.$/, '')}`
}

const bestBucketHover = (model: NextPostModel): string | null =>
  model.lands.working.find((x) => x.kind !== 'topic')?.evidence ?? null

/* ── tab one: what the readings back ─────────────────────────────────────── */

function WhyTab({ model }: { model: NextPostModel }) {
  const ring = useMemo(() => topicRingOf(model.audience), [model.audience])
  const quotes = useMemo(() => quoteSpreadOf(model.audience.quotes), [model.audience])
  const finding = useMemo(() => keyFindingOf(model.themes), [model.themes])
  const themedComments = model.themes.reduce(
    (acc, t) =>
      t.comments
        ? { total: acc.total + t.comments.total, over: acc.over + t.comments.over }
        : acc,
    { total: 0, over: 0 },
  )
  const hasDataRows =
    model.commentsScored > 0 || themedComments.over > 0 || model.credibility !== null
  /**
   * THE ONE CARD ON THIS SCREEN THAT MAY NOT SPEAK OF SENTIMENT.
   *
   * `lands.working` holds two kinds of finding under one roof: reaction
   * buckets — picture against text, a platform against itself — counted over
   * published reactions, and TOPIC findings, whose value is a mean of every
   * reading's sentiment score INCLUDING the posts nobody commented on. This
   * card printed the top three of that mixed list, so "Elections — 6 posts
   * read at +62 in the full analysis" rendered in positive green inches from a
   * table whose own means exclude uncommented posts on purpose, under one
   * word — carried — doing duty for a reach figure and a sentiment one at
   * once. The topic findings are out of this card. What is left is a single
   * measurement, named by the card's own subtitle.
   */
  const carried = model.lands.working.filter((f) => f.kind !== 'topic').slice(0, 3)
  /* Only the graded rows may be ranked: the strip's figure is a mean, and a
     row with no mean has nothing to be ranked by. */
  const graded = model.themes.flatMap((t) =>
    t.meanScore === null ? [] : [{ t, mean: Math.round(t.meanScore) }],
  )
  /* Five cards is the reference's strip and it is what the grid holds. What
     the strip must not do is DROP a graded theme in silence: this desk has
     six, and Law & Order (Mixed, mean over 3, +7) was in the table and
     nowhere in the strip, with nothing on the screen saying a sixth existed.
     The overflow is named under the strip. */
  const ranked = graded.slice(0, 5)
  const unranked = graded.slice(5)

  return (
    // The body's own container is NAMED. The left column is a container too -
    // the donut asks about it - so an unnamed query written inside that column
    // measures the column's 320px and never the body's 1320. The one rule that
    // has to ask about the body from inside the column says so by name.
    <div className="@container/why">
      {/* THREE COLUMNS DO NOT FIT ON A LAPTOP. MEASURED, THEN BELIEVED.
          The reference is a 1472px band with no app rail, split 257 / 760 /
          434. This app keeps a 240px rail, so the band is 976px at a 1280
          viewport, 1136px at 1440, 1216px at 1536, and it stops growing at
          1320 (--shell) whatever the screen. The floors these three columns
          actually need are measured, not guessed: 320px on the left (the ring
          beside its legend with no label wrapping), 540px in the middle (the
          four-column table with zero clipped cells starts at a 496px table
          box), 336px on the right (the rows there wrap onto two lines below
          it). That is 1228px of band — a 1548 viewport. Every laptop is
          under it.

          THE FLOORS WERE TOO GENEROUS AND COST THE READER THE THIRD COLUMN.
          320 + 540 + 336 needs a 1548 viewport, so every laptop got two
          columns and the right-hand cards fell into a band across the foot —
          which is the opposite of the reference, where three columns are what
          MAKES the screen fit one page. The reference's own left column is
          257px wide and holds the ring beside its legend perfectly well, so
          272 is the honest floor there, not 320; the table needs its measured
          496; the right column's rows fit 320.

          The middle floor is 544 rather than 496, because 496 is the width
          the TABLE BOX needs and the column carries the panel's padding on
          top of it — at a 512px column the table fell back to its stacked
          form and every row went from 85px to 195px, which is the whole of
          why this screen was three times the reference's height at 1440.

          256 + 544 + 300 + 2x16 = 1132px of band against the 1136 a 1440
          viewport gives. Three columns from there, two below. */}
      <div className="grid gap-4 @4xl:grid-cols-[minmax(272px,0.9fr)_minmax(496px,2.1fr)] @min-[70rem]:grid-cols-[minmax(256px,0.82fr)_minmax(544px,2fr)_minmax(300px,1fr)]">
        {/* left: why, and what the posts are about */}
        <div className="@container space-y-4">
          <Panel
            title="Why these recommendations?"
            sub="Counted from your desk's own posts, comments and readings."
          >
            <ul className="divide-y divide-[var(--rule)]">
              {/* ONE WINDOW PER SENTENCE.
                  This read "100 posts read in full / of the 100 your desk
                  stores, across 4 platforms": two UNWINDOWED counts and one
                  WINDOWED one in a single sentence, on a screen with a window
                  picker over it. Driven at Last 7 days it still said 100 of
                  100 while the platform count had dropped to 3 and the table
                  below it had rebuilt itself on 63 posts. Every figure in this
                  row is now the window's; the desk's lifetime totals are on
                  the export's provenance sheet, where nothing is windowed. */}
              <FactRow
                icon={<FileText size={16} />}
                color="var(--pos)"
                bg="var(--pos-soft)"
                head={`${model.analysedInWindow} posts read in full`}
                body={`of the ${model.postsInWindow} posts in this window, across ${model.platforms} platforms`}
              />
              <FactRow
                icon={<MessageSquare size={16} />}
                color="var(--accent)"
                bg="var(--accent-soft)"
                head={`${compact(model.commentsRead)} comments counted`}
                /* Says its own basis, because the row above it is windowed and
                   this one cannot be: one reading per account, no date in it. */
                body={`under ${model.postsWalked} posts, by the per-account comment readings, whatever the window`}
              />
              <FactRow
                icon={<ThumbsUp size={16} />}
                color="var(--warn)"
                bg="var(--warn-soft)"
                head={`${model.measuredInWindow} posts with published figures`}
                /* "A GAP STAYS A GAP" WAS TRUE OF POSTS AND FALSE OF FIELDS,
                   AND THE REPLACEMENT STILL DENIED IT.
                   `ownPostsOf` marks a post measured when ANY of likes,
                   comments or shares was published and then sums the three
                   with `?? 0`, so the cancer-camp post — 1.4K likes, 10
                   comments, shares NA — is counted at 1,410 with its missing
                   shares treated as none. "The missing field is not counted
                   as none" is precisely what `?? 0` does not honour: adding
                   only the published fields IS counting the absent one as
                   zero, and the post is then compared, total against total,
                   with posts that published all three. The post-level rule is
                   the true half; the field-level consequence is stated rather
                   than denied. */
                body="of the posts in this window"
                note="Posts with no published figure at all are left out. Where only some of likes, comments or shares were published, the total is the sum of those — so a post missing a field carries a smaller total than one that published all three, and the two are still compared as totals."
              />
              <FactRow
                icon={<AudioWaveform size={16} />}
                color="var(--chart-3)"
                bg="color-mix(in srgb, var(--chart-3) 14%, transparent)"
                head="Sentiment from comments"
                body="where any were retrievable"
                note="Where no comment could be retrieved under a post, the reading falls back to the post's own register — and every figure on this screen says which of the two it came from."
              />
            </ul>
          </Panel>

          <Panel
            title="What your posts are about"
            /* THE BASIS IS ON SCREEN, NOT ONLY IN THE HOVER.
               This ring's figure does not move with the window picker above
               it — `audienceOf` takes no window — so on Last 7 days it prints
               "100 posts" beside a column rebuilt on 63, and a reader has no
               way to know the two are counted differently. The hover said so;
               a hover is not where a reader looks before believing a number
               they can see. Making the count windowed would mean changing a
               helper the audience screen shares, so the honest move is to
               name the basis where the figure is. */
            sub="Every post read in full, whatever the window."
            /* This ring comes from `audienceOf`, which takes no window, so its
               count stays at 100 while the middle column rebuilds on 63. The
               hover says so rather than letting the picker above be read onto
               it. The visible centre figure is still unwindowed — see the
               note in the report; a window-aware ring is not something this
               model can produce. */
            info={`The five largest of the ${model.audience.topicPosts} posts read in full, with the rest in one bucket, whatever the window. Same counts the audience screen draws.`}
          >
            {ring.length === 0 ? (
              <p className="text-[11.5px] text-ink-3">No topics read yet.</p>
            ) : (
              // Beside the ring where this column is wide enough to hold the
              // labels — the reference's own layout — and stacked under it
              // below that. The comment here used to describe behaviour that
              // had never rendered: the branch asked for 320px of column and
              // the column was pinned on a 240px floor at every viewport from
              // 1280 to 1728, so the ring sat above its legend forever and the
              // card paid 116px for a layout it never got. The query asks for
              // 304 against a 256px floor that grows past it by 1536, so it
              // fires with margin: the floor is 256 now (see the body grid).
              <div className="flex flex-col items-center gap-3 @min-[19rem]:flex-row @min-[19rem]:items-center">
                <DonutBreakdown
                  size={104}
                  thickness={12}
                  segments={ring.map((t, i) => ({
                    label: t.label,
                    value: t.posts,
                    color: ringColor(t, i),
                  }))}
                  centerLabel={String(model.audience.topicPosts)}
                  centerSub="posts"
                />
                <ul className="w-full min-w-0 space-y-1.5">
                  {ring.map((t, i) => (
                    <li key={t.label} className="flex items-center gap-2 text-[11px]">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: ringColor(t, i) }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 text-ink-2">{t.label}</span>
                      <span className="tnum shrink-0 font-bold">{t.pct}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          {/* The reference's third left-hand card is always there — rows of
              measured audience response closing the column level with the
              other two. This slot held "The reader's own check", which
              rendered only where a credibility reading existed, so on a desk
              without one the left column stopped at the donut. These are the
              same past-tense findings the right column prints as a single
              row, and where there are none the card says so. The credibility
              check is not lost: it is still a row of "Data behind this". */}
          <Panel
            title="What carried furthest, by reactions"
            /* AND THE TYPICAL IS THE WINDOW'S, NOT THE DESK'S. `whatLandsOf`
               is handed the WINDOWED posts, so its typical is the mean over
               the measured posts in the window and it moves with the picker —
               284 at All time, 377 at Last 7 days on this desk. "This desk's
               own typical post" named a desk-wide figure that is not computed
               anywhere, and put an unwindowed claim on a windowed number. */
            sub="Against the typical post in this window, by published reactions."
            /* "ONE PLATFORM AGAINST ITSELF" WAS NOT WHAT RAN.
               `whatLandsOf` computes one typical — the mean reactions of
               every measured post on the desk — and divides EVERY bucket by
               it, formats and platforms alike. So "Instagram 3.4x" is
               Instagram against the desk, not Instagram against Instagram,
               and nothing in this card is compared with itself. The card's
               own subtitle had it right the whole time; the hover now says
               the same thing, and says which posts the typical is over. (The
               within-platform lift the model does compute is in the theme
               table, where it carries its platform and its n.) */
            info="Picture against text, and each platform, all divided by the same figure: the mean reactions of every post in this window whose reactions the platform published. That figure moves with the window picker. Three posts before a bucket may speak, five measured before the card speaks at all. No sentiment is in this card: sentiment is read from comments, and these buckets count posts whether or not anyone commented."
          >
            {carried.length === 0 ? (
              <p className="text-[11.5px] leading-relaxed text-ink-3">
                {model.lands.thin
                  ? `Only ${model.lands.measuredPosts} posts carry published reactions in this window, too few to compare.`
                  : 'Nothing sits above your typical post in this window.'}
              </p>
            ) : (
              <ul className="divide-y divide-[var(--rule)]">
                {carried.map((f) => {
                  const Icon = carriedIcon(f.kind)
                  return (
                    <FactRow
                      key={`${f.kind}-${f.label}`}
                      icon={<Icon size={16} />}
                      color="var(--pos)"
                      bg="var(--pos-soft)"
                      head={f.label}
                      body={f.evidence}
                    />
                  )
                })}
              </ul>
            )}
          </Panel>

          {/* Provenance sits with provenance while the body is two columns;
              at three columns the same card renders in the right-hand one instead.
              See DataBehindPanel. */}
          {hasDataRows && (
            <div className="@min-[70rem]/why:hidden">
              <DataBehindPanel model={model} themedComments={themedComments} />
            </div>
          )}
        </div>

        {/* centre: the themes. Its own @container, because THEME_COLS is
            measured against the box the table is actually drawn in. A
            breakpoint read off the wrapper switches the table on at the width
            where the middle column is a quarter of that wrapper, which is how
            a four-column table came to be asked for inside 384px. */}
        <div className="@container space-y-4">
          <Panel
            title="How your themes have read"
            sub={`${model.themes.length} themes with two or more read posts, ${model.windowLabel}.`}
          >
            {model.themes.length === 0 ? (
              <p className="text-[11.5px] leading-relaxed text-ink-3">
                {/* The guard was `postsAnalysed`, which is UNWINDOWED, while
                    both sentences it chooses between are about the window. A
                    desk with 100 readings and none inside the window took the
                    else-branch and said "No theme has two read posts in this
                    window. 0 appeared once." — implying posts had been read
                    here — when the true sentence was the other one. */}
                {model.analysedInWindow === 0
                  ? 'No posts read in full in this window.'
                  : `No theme has two read posts in this window. ${model.thinTopics} appeared once.`}
              </p>
            ) : (
              <ThemeTable rows={model.themes} />
            )}
            {model.thinTopics > 0 && model.themes.length > 0 && (
              <p className="mt-2 border-t border-[var(--rule)] pt-2 text-[10.5px] text-ink-3">
                {model.thinTopics} more {model.thinTopics === 1 ? 'topic' : 'topics'} appeared on a
                single read post, too few to show.
              </p>
            )}
            {finding && (
              <div className="mt-3 flex items-center gap-2.5 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] p-3">
                <Squircle
                  icon={<Lightbulb size={16} />}
                  color="var(--accent)"
                  bg="var(--surface)"
                  size={30}
                />
                <p className="text-[12.5px] leading-snug text-ink">
                  <span className="font-bold text-[var(--accent)]">Key insight:</span> {finding}
                </p>
              </div>
            )}
          </Panel>
          {/* THE RANKED STRIP SITS IN THE MIDDLE COLUMN, under the table it
              ranks — which is where the reference puts it. Full width across
              the foot, it took its height out of the middle column and added
              it under all three, which is a third of why the screen stopped
              fitting on one page. */}
              {model.themes.length > 0 && (
                <div className="mt-4">
              <Panel
                title="Themes ranked by how they read"
                sub={
                  unranked.length > 0
                    ? `The ${ranked.length} warmest of ${graded.length} graded themes, by the mean reading of the posts that drew comments, ${model.windowLabel}.`
                    : `Ranked by the mean reading of the posts that drew comments, ${model.windowLabel}.`
                }
                info="The mean of the readings of a theme's posts that drew comments, at three or more of them. Posts nobody commented on are not in it, and a theme without three such posts is not ranked here at all."
              >
                {/* The sub says "ranked by mean reading", and the sort fell back to
                    post count where a mean was absent — then printed that post
                    count in the figure slot, in the same 20px bold as a reading, so
                    "9" under Governance was a count and "+35" under Development was
                    a score. Only graded rows are in this strip. */}
                {ranked.length === 0 ? (
                  <p className="text-[11.5px] leading-relaxed text-ink-3">
                    No theme has three posts with comments under them in this window, so none can be
                    ranked by how it read.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 @min-[32rem]:grid-cols-5">
                    {ranked.map((r, i) => (
                      <RankCard key={r.t.topic} t={r.t} rank={i + 1} mean={r.mean} />
                    ))}
                  </div>
                )}
                {unranked.length > 0 && (
                  <p className="mt-2 border-t border-[var(--rule)] pt-2 text-[10.5px] leading-relaxed text-ink-3">
                    {unranked.length} more graded{' '}
                    {unranked.length === 1 ? 'theme reads' : 'themes read'} below these and{' '}
                    {unranked.length === 1 ? 'is' : 'are'} in the table above:{' '}
                    {unranked.map((r) => `${r.t.topic} ${signed(r.mean)}`).join(', ')}.
                  </p>
                )}
              </Panel>
            </div>
          )}
        </div>

        {/* right: the raw material. A column at the same width the grid grows
            a third one — these gates were left on the old @7xl when the grid
            moved to 70rem, so the band declared three columns and then left
            the third empty while its cards sat below. Below that width these
            cards run
            as a band across the foot of both columns rather than being crushed
            into a 320px gutter where their own rows wrap onto two lines. Two
            up, because the third of them is up in the left column at these
            widths — see DataBehindPanel. */}
        <div className="grid gap-4 @4xl:col-span-2 @4xl:grid-cols-2 @min-[70rem]:col-span-1 @min-[70rem]:block @min-[70rem]:space-y-4">
          {hasDataRows && (
            <div className="hidden @min-[70rem]/why:block">
              <DataBehindPanel model={model} themedComments={themedComments} />
            </div>
          )}

          <Panel
            title="Sample from audience comments"
            sub={`${quotes.length} of ${model.audience.quotes.length} comments the readings quoted. The audience screen carries the full reading.`}
          >
            {quotes.length === 0 ? (
              <p className="text-[11.5px] text-ink-3">No comments quoted by the readings yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {quotes.map((q, i) => (
                  <QuoteBlock key={i} q={q} />
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="How often you post"
            sub={`Dated posts a week, per account, ${model.windowLabel}.`}
          >
            <ul className="divide-y divide-[var(--rule)]">
              {model.cadence.map((c) => (
                <li
                  key={c.platform}
                  className="flex items-center gap-2.5 py-2 text-[12px] first:pt-0 last:pb-0"
                >
                  <PlatformBadge platform={c.platform as never} size={22} />
                  {/* The badge alone left a 250px gutter and no label at all,
                      so the reader had to decode a glyph to know which
                      account the figure belonged to. */}
                  <span className="min-w-0 flex-1 truncate text-ink-2">{c.platform}</span>
                  <span className="tnum shrink-0 font-semibold text-ink">
                    {c.perWeek !== null
                      ? `${(Math.round(c.perWeek * 10) / 10).toFixed(1)} a week`
                      : c.dated > 0
                        ? `${c.dated} dated posts`
                        : 'no dates published'}
                  </span>
                </li>
              ))}
            </ul>
            {model.undatedNote && (
              <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">{model.undatedNote}</p>
            )}
            <p className="mt-2 border-t border-[var(--rule)] pt-2 text-[11px] text-ink-3">
              Best day and hour are not shown for this desk.
              <Hover text="At these counts a day-or-hour bucket holds one to eight posts, which is noise, not advice. Instagram publishes date-only timestamps, so hours are not even on file." />
            </p>
          </Panel>

          {/* A "Themes on these posts" panel stood here and printed a chip for
              every one of the twelve theme names — the middle column's table,
              retyped, while that table was paging the same twelve rows five at
              a time and the ranked strip was naming the top five under both.
              The same list three times on one screen. The table shows all
              twelve now, and the topics that appeared on a single read post
              are counted in the footnote directly under it, so there is
              nothing left here that is not already said. A duplicate is not a
              section. */}
        </div>
      </div>

      {/*
        THE RANKED STRIP RUNS UNDER THE COLUMNS, NOT INSIDE ONE OF THEM — a
        deliberate departure from the reference, for card width: at a 590px
        middle column five cards would be ~102px each against the reference's
        145px, and full width gives 179px at 1280 rising to 248px at 1728.

        FIVE ACROSS FROM 32rem, MEASURED AGAINST THE COLUMN IT LIVES IN.
        The strip moved into the middle column and kept a threshold sized for
        the full-width band it used to occupy — @3xl is 768px and the middle
        column is 548-674px, so it rendered two across, three rows deep, and
        the panel stood 508px tall against the reference's ~200. That single
        mismatch was most of the height this screen had left to lose.

        The old note, still true of the card itself: It waited
        for @6xl — 1152px of container, a 1456px viewport — and rendered 3 + 2
        below that. Swept: at five across the grid is 121.8px tall at EVERY
        container from 1286 down to 746, because `min-h-[34px]` and the name's
        `line-clamp-2` already absorb the wrap; the card only reaches the
        reference's 145px at a 773px container. 768 is that floor. The
        @2xl three-across step had nothing left to do between 672 and 768 and
        is gone.
      */}
    </div>
  )
}

/**
 * DATA BEHIND THIS — THE ONE CARD THAT CHANGES COLUMNS.
 *
 * It is provenance: the same kind of statement as "Why these recommendations?"
 * at the head of the left column, and it sits beside the reference's sample
 * comments in the right one. Which column it belongs to is a question of
 * balance, and the answer differs by width, so it is defined once here and
 * placed twice — one of the two is always `display: none`, which takes no
 * grid cell, no space and no place in the accessibility tree.
 *
 * The measurement that earns the second placement: with the pager gone the
 * middle column runs 1113px, and the left column's three cards run 686px at a
 * 1536 viewport. Left where it stands, that is 427px of white under the left
 * column — the same hole the pager dug, moved one column over. This card fills
 * 300 of it. Where a third column exists it is that column that would
 * run short instead, so there the card goes back where the reference has it.
 */
function DataBehindPanel({
  model,
  themedComments,
}: {
  model: NextPostModel
  themedComments: { total: number; over: number }
}) {
  return (
  <Panel
          title="Data behind this"
          sub="Key figures read from your own accounts."
          /* "NOTHING HERE IS SUMMED ACROSS PLATFORMS" WAS FALSE OF HALF THESE
             ROWS. "Comments positive, 14% of 280" is four account readings on
             four platforms added together, and the themed-comment row sums
             every platform that published a count. The claim is gone rather
             than softened; what replaces it is the rule that actually holds. */
          info="Each figure is counted on your own accounts and carries the denominator it was taken over."
        >
          <ul className="divide-y divide-[var(--rule)]">
            {/* Labels short enough to hold one line: the denominators are
                already in the values, so nothing is lost by cutting the
                label back to what the figure measures. The glyph is kept
                on the one row whose caveat changes what the number means;
                the rest carry theirs on the row itself. */}
            {model.commentsScored > 0 && (
              <DataRow
                icon={<ThumbsUp size={15} />}
                color="var(--pos)"
                bg="var(--pos-soft)"
                label="Comments positive"
                /* `commentsScored`, not `commentsRead`: the share above the
                   "of" was divided by this and by nothing else. */
                value={`${model.audience.positive}% of ${compact(model.commentsScored)}`}
                hover="Every comment the account readings scored, summed across your accounts. One reading per account, with no split by date."
              />
            )}
            {/* A "BEST PLATFORM LIFT" ROW STOOD HERE AND IS GONE, TWICE OVER.
                It printed `lands.working`'s first non-topic finding — which is
                the FIRST card in the left column, "What carried furthest",
                stating the same bucket and the same multiple with its full
                evidence sentence. In two columns this panel renders directly
                underneath that card, so the two sat an inch apart saying
                "Instagram 3.4x" twice.
                And the label was a lie waiting to happen: the selection is
                `kind !== 'topic'`, which `whatLandsOf` also fills with FORMAT
                buckets, so on a desk where pictures beat text the row would
                have printed "Posts with a picture" under a label promising a
                platform. Deleting the row settles both. */}
            {themedComments.over > 0 && (
              <DataRow
                icon={<MessageSquare size={15} />}
                color="var(--accent)"
                bg="var(--accent-soft)"
                label="Comments on themed posts"
                value={`${compact(themedComments.total)} across ${themedComments.over}`}
                note="Summed only where the platform published a comment count."
              />
            )}
            {model.credibility && (
              <DataRow
                icon={<BadgeCheck size={15} />}
                color="var(--neg)"
                bg="var(--neg-soft)"
                label="Reader's check clean"
                // The unsure count travels with the clean one. It used to
                // be printed by the left column's credibility card, and
                // that card is now the always-present "How your posts
                // have carried"; a figure the desk holds does not get
                // dropped in a layout change.
                value={`${model.credibility.clean} of ${model.credibility.of}${
                  model.credibility.unsure > 0 ? `, ${model.credibility.unsure} unsure` : ''
                }`}
                note="The model's check of your own posts, not a measure of audience trust."
              />
            )}
          </ul>
        </Panel>
  )
}

/**
 * ONE LINE OF BASIS ON SCREEN, THE CAVEAT IN THE HOVER.
 *
 * Two of these rows carried a four-line paragraph — the whole of the
 * published-figure rule, the whole of the sentiment fallback — and between
 * them they made this card 500px tall in a column the reference draws at
 * about 260. The reference's own rows are a heading and two short lines.
 *
 * The office's standing rule settles which half goes where: explanatory prose
 * belongs in a hover, not on screen. So `body` is the short basis a reader
 * needs to read the figure, and `note` is the caveat they need only if they
 * question it — reachable on the row's own mark, not spent on every reader.
 */
function FactRow({
  icon,
  color,
  bg,
  head,
  body,
  note,
}: {
  icon: ReactNode
  color: string
  bg: string
  head: string
  body: string
  note?: string
}) {
  return (
    <li className="grid grid-cols-[30px_1fr] items-start gap-2.5 py-2 first:pt-0 last:pb-0">
      <Squircle icon={icon} color={color} bg={bg} />
      <div className="min-w-0">
        <p className="flex items-start gap-1 text-[12.5px] font-semibold leading-snug text-ink">
          <span className="min-w-0">{head}</span>
          {note && <InfoMark note={note} className="mt-px size-[14px] shrink-0" />}
        </p>
        <p className="mt-0.5 text-[10.5px] leading-snug text-ink-3">{body}</p>
      </div>
    </li>
  )
}

function DataRow({
  icon,
  color,
  bg,
  label,
  value,
  hover,
  note,
}: {
  icon: ReactNode
  color: string
  bg: string
  label: string
  value: string
  /** Shown as a visible glyph: the caveat changes what the figure means. */
  hover?: string
  /** Carried on the row itself, with no glyph competing with the label. */
  note?: string
}) {
  return (
    <li className="flex items-center gap-2.5 py-2.5 first:pt-0 last:pb-0" title={note}>
      <Squircle icon={icon} color={color} bg={bg} />
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink-2">
        {label}
        {hover && <Hover text={hover} size={11} />}
      </span>
      <span className="tnum shrink-0 text-[13px] font-bold">{value}</span>
    </li>
  )
}

/* ── the themes as the reference's four-column table ─────────────────────── */

/**
 * A glyph for a theme name, cosmetic only: the mapping never invents a claim,
 * it just picks a picture, and anything unrecognised gets the neutral spark.
 */
const themeIcon = (topic: string) => {
  const t = topic.toLowerCase()
  if (/(develop|infra|road|works)/.test(t)) return TrendingUp
  if (/(governance|govern|admin)/.test(t)) return Landmark
  if (/(health)/.test(t)) return HeartPulse
  if (/(educat|youth|student)/.test(t)) return GraduationCap
  if (/(religion|culture|festival|temple)/.test(t)) return Church
  if (/(business|econom|industr)/.test(t)) return Briefcase
  if (/(election|campaign|poll)/.test(t)) return Vote
  return Sparkles
}

const VERDICT_META: Record<
  ThemeRow['verdict'],
  { word: string; color: string; bg: string }
> = {
  working: { word: 'Working', color: 'var(--pos)', bg: 'var(--pos-soft)' },
  'not-landing': { word: 'Not landing', color: 'var(--neg)', bg: 'var(--neg-soft)' },
  mixed: { word: 'Mixed', color: 'var(--warn)', bg: 'var(--warn-soft)' },
  thin: { word: '', color: 'var(--ink-3, currentColor)', bg: 'var(--surface-2)' },
}

/**
 * THE ROW, AND WHY IT SAYS EACH NUMBER ONCE.
 *
 * The Religion & Culture row used to print "9 posts" under the name, "9 posts
 * read at +69 in the full analysis" in the second cell, "+69 mean over 9
 * posts read" as its first bullet, and "+69" in the chip: the same two
 * figures four times inside one row, with "The audience's recorded answer:"
 * repeating down ten of the twelve rows to introduce the only cell that was
 * actually saying something new. That, plus cells top-aligned in rows sized
 * by the tallest, is what turned a five-row table into 12 rows of 150–300px
 * and the page into 3,700px of scroll.
 *
 * So each column now owns exactly one measurement, and the header does the
 * introducing:
 *   Theme    — the name and the count of posts read, stated once.
 *   Answered — the audience's own recorded answer per post, which is the one
 *              per-theme audience fact this desk holds. Comment sentiment is
 *              read per ACCOUNT and cannot be split by theme; this is not it,
 *              and it is not named as if it were.
 *   Support  — the within-platform lift and the published comment counts, as
 *              fragments, each with its denominator and its full sentence one
 *              hover away.
 *   Reading  — the mean of the POST readings, the only place it appears.
 */
/**
 * ONE SET OF TRACKS, DECLARED ONCE.
 *
 * The header and every row used to be independent grid containers resolving
 * the same `0.85fr / 1fr / 1.5fr` list against their own content minimums —
 * `1fr` is `minmax(auto, 1fr)`, so a row whose "Agreed 5 · Divided 1" ran
 * long bid its track wider than its neighbours', the column edges walked left
 * and right down the table, and the header labels stopped sitting over the
 * columns they name. The tracks live on one grid now and the header and every
 * row are subgrids of it, so there is exactly one set of edges. Every track
 * is `minmax(0, …)` and every cell carries `min-w-0`, so no cell can bid a
 * track wider than its share and nothing is ever clipped at the card's edge —
 * the reading badge was the first thing to disappear on a 1280 laptop.
 *
 * THE BREAKPOINT AND THE FLOORS, BOTH MEASURED ON THE TABLE ITSELF.
 *
 * The threshold is read off the MIDDLE COLUMN's own container, not the
 * wrapper's — but @lg (512px) was the wrong number in both directions. Too
 * high, because the middle column was 384px at 1280 and 470px at 1366, so the
 * reference's four-column table never once rendered as a table on a laptop; it
 * fell back to the stacked form. And too LOW, because a swept table box only
 * comes clean — 84–86px rows, zero clipped cells — from 496px, which is a
 * 530px column: between 512 and 529 the rule licensed a four-column table with
 * cells cut off. 34rem (544px) clears the clean floor with margin, and the two
 * column shapes above keep the middle column at 640 / 779 / 834 / 590 at 1280 /
 * 1440 / 1536 / 1728, over it at every one.
 *
 * The tracks carry real minimums for the same reason. `minmax(0, …)` lets a
 * track fall under its content and CLIP: 6 clipped cells at a 476px box, 10 at
 * 350. 120px is the measured min-content of the theme cell (30px squircle, gap,
 * "Development"), 104px of the answered cell, 66px of the supporting cell. With
 * these floors a narrow table wraps, which is legible, instead of cutting, which
 * is a lie about the figure.
 */
const THEME_COLS =
  '@min-[34rem]:grid-cols-[minmax(120px,1.15fr)_minmax(104px,1fr)_minmax(66px,1.3fr)_104px] @min-[34rem]:gap-x-3'

/**
 * FIVE ROWS AND A NUMBERED PAGER, WHICH IS WHAT THE OFFICE ASKED FOR.
 *
 * A previous pass deleted the pager to close a hole of dead white under this
 * column, and traded the office's actual instruction for a layout metric:
 * "if number exceeds ... page numbering below so that we can pile up things in
 * same page like local news portal and avoid scrolling". Twelve rows do not
 * pile up on one page. They are 927px of table where the reference has 360,
 * and the screen they produced is the one the office rejected on sight.
 *
 * The hole was real and is closed a different way, the way the reference
 * closes it: the ranked strip moved back INTO this column instead of running
 * as a band across the foot, and the third column now fits from a 1440
 * viewport instead of never. Neither of those costs the reader a row.
 *
 * Five is the reference's own count, and the page numbers sit below the table
 * as the local news portal draws them.
 */
const THEME_PAGE = 5

function ThemeTable({ rows }: { rows: ThemeRow[] }) {
  const [page, setPage] = useState(0)
  const pages = Math.ceil(rows.length / THEME_PAGE)
  /* A page that no longer exists — the window narrowed under the reader —
     would render an empty table with a live pager under it. */
  const at = Math.min(page, Math.max(0, pages - 1))
  const shown = rows.slice(at * THEME_PAGE, at * THEME_PAGE + THEME_PAGE)
  return (
    <>
    <div className={cn('grid grid-cols-1', THEME_COLS)}>
      <div className="col-span-full hidden grid-cols-subgrid border-b border-[var(--rule)] pb-2 text-[11px] font-semibold text-ink-3 @min-[34rem]:grid">
        <span className="min-w-0">Theme</span>
        <span className="min-w-0">Audience answered</span>
        <span className="min-w-0">Supporting data</span>
        <span className="min-w-0 text-right">Reading</span>
      </div>
      {/* `contents` so each row is a grid item of the table's own grid and
          can subgrid its columns; the list role is kept by hand, since a
          box that is not generated cannot carry one. */}
      <ul role="list" className="contents">
        {shown.map((t) => (
          <ThemeTableRow key={t.topic} t={t} />
        ))}
      </ul>
    </div>
    {/* Only where there IS a second page. A pager under a table showing
        everything it holds is a control that does nothing. */}
    {pages > 1 && (
      <nav
        aria-label="Theme pages"
        className="mt-2 flex items-center justify-between gap-2 pt-2"
      >
        <p className="text-[10.5px] text-ink-3">
          {at * THEME_PAGE + 1}&ndash;{at * THEME_PAGE + shown.length} of {rows.length}
        </p>
        <span className="flex items-center gap-1">
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setPage(i)}
              aria-current={i === at ? 'page' : undefined}
              className={cn(
                'h-6 min-w-6 rounded-[6px] px-1.5 text-[11px] font-semibold transition-colors',
                i === at
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-ink-3 hover:bg-[var(--surface-2)] hover:text-ink',
              )}
            >
              {i + 1}
            </button>
          ))}
        </span>
      </nav>
    )}
    </>
  )
}

/** The three answers the cell names, and how many posts the rest hold. */
const NARRATIVE_NAMED = 3

/** Every recorded answer with its count, and what the tally is over. */
const narrativeHover = (t: ThemeRow): string | undefined =>
  t.narrative.length === 0
    ? undefined
    : `${t.narrative.map((n) => `${n.label} ${n.posts}`).join(', ')} — the audience's recorded answer on the ${t.narrativeOver} posts of this theme that drew comments AND carried one, of ${t.posts} read in full. Posts with no comments under them are not in it.`

function ThemeTableRow({ t }: { t: ThemeRow }) {
  const Icon = themeIcon(t.topic)
  const named = t.narrative.slice(0, NARRATIVE_NAMED)
  const rest = t.narrative.slice(NARRATIVE_NAMED).reduce((s, n) => s + n.posts, 0)
  // Tinted by verdict, not by row index: a five-colour series cycled over
  // twelve rows repeated its tints down the table for no reason a reader
  // could name. The verdict is a real property of the row.
  const meta = VERDICT_META[t.verdict]
  return (
    <li className="col-span-full grid grid-cols-subgrid gap-y-2 border-t border-[var(--rule)] py-2.5 first:border-t-0 @min-[34rem]:items-center">
      {/* theme */}
      <div className="flex min-w-0 items-center gap-2.5">
        <Squircle icon={<Icon size={16} />} color={meta.color} bg={meta.bg} size={30} />
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold leading-snug">{t.topic}</p>
          <p className="tnum mt-0.5 text-[10.5px] text-ink-3">
            {t.posts} read {t.posts === 1 ? 'post' : 'posts'}
          </p>
        </div>
      </div>

      {/* What the audience answered. The column header introduces it on a wide
          screen; below the table's breakpoint the header row is gone, so the
          cell says it itself rather than leaving a bare tally with no
          subject. */}
      {/* THE THREE NAMED ANSWERS AND THE REMAINDER THEY LEFT.
          The model handed over the top three and the cell printed them
          against the FULL denominator, so Governance read "Agreed 7 · Happy 6
          · Divided 5 of 19 answered" — 18 accounted for, one gone with no
          word about it, in a column headed "Audience answered". Three still
          fit the track; the rest are counted, and the whole tally rides the
          cell's own hover. */}
      <div className="min-w-0 text-[11.5px] leading-snug" title={narrativeHover(t)}>
        <span className="mr-1 font-semibold text-ink-3 @min-[34rem]:hidden">
          Audience answered:
        </span>
        {t.narrative.length > 0 ? (
          <>
            <span className="font-semibold text-ink">
              {named.map((n) => `${n.label} ${n.posts}`).join(' · ')}
            </span>
            {/* The comma matters: "Happy 1 · 1 more of 8" reads as one more
                of eight. "Happy 1 · 1 more, of 8 answered" reads as the list
                it is. Every answer by name is on the cell's hover. */}
            {rest > 0 && <span className="tnum text-ink-3"> · {rest} more,</span>}
            <span className="tnum text-ink-3"> of {t.narrativeOver} answered</span>
          </>
        ) : (
          <span className="text-ink-3">no answer recorded</span>
        )}
      </div>

      {/* supporting data, as fragments; the sentences ride the hovers */}
      <ul className="min-w-0 space-y-1 text-[11px] leading-snug text-ink-2">
        {t.lift && (
          <DataBullet
            tone={meta.color}
            /* A RISING ARROW IS A CLAIM. `> 1` drew one on 1.02x, which is
               noise wearing a direction. 1.25x is the floor `whatLandsOf`
               uses before it will call a bucket working anywhere else in this
               product, and it is the floor here too; under it the row keeps
               its neutral dot and the figure still prints in full. */
            rising={t.lift.multiple >= 1.25}
            hover={`On ${t.lift.platform}, ${t.lift.n} posts averaged ${(Math.round(t.lift.multiple * 10) / 10).toFixed(1)}x that platform’s typical ${compact(Math.round(t.lift.typical))} reactions.`}
          >
            {t.lift.platform} {(Math.round(t.lift.multiple * 10) / 10).toFixed(1)}x typical,{' '}
            {t.lift.n} posts
          </DataBullet>
        )}
        {t.comments && (
          <DataBullet
            tone={meta.color}
            hover="Summed only where the platform published a comment count."
          >
            {compact(t.comments.total)} {t.comments.total === 1 ? 'comment' : 'comments'} on{' '}
            {t.comments.over} {t.comments.over === 1 ? 'post' : 'posts'}
          </DataBullet>
        )}
        {!t.lift && !t.comments && (
          <li className="text-ink-3">No reactions or comment counts published</li>
        )}
      </ul>

      {/* reading — the verdict as the reference's stacked badge, past tense */}
      <div className="min-w-0 @min-[34rem]:justify-self-end">
        <VerdictBadge t={t} />
      </div>
    </li>
  )
}

/**
 * A supporting fact, printed in full.
 *
 * It used to be `truncate` inside a track ~68px wide, so "Facebook 2.3x
 * typical, 4 posts" rendered as a few characters and an ellipsis and the
 * denominator — which the house rule says travels with the figure — survived
 * only in the hover. It wraps now. The glyph is keyed the way the reference
 * keys it: a rising arrow where the figure is a lift above that platform's
 * own typical post, otherwise a dot in the row's verdict tint, which is the
 * neutral where the row has no direction to carry.
 */
function DataBullet({
  children,
  hover,
  tone,
  rising,
}: {
  children: ReactNode
  hover?: string
  tone: string
  rising?: boolean
}) {
  return (
    <li className="tnum flex items-start gap-1.5" title={hover}>
      {rising ? (
        <TrendingUp
          size={11}
          className="mt-[2px] shrink-0"
          style={{ color: 'var(--pos)' }}
          aria-hidden
        />
      ) : (
        <span
          className="mt-[5px] size-1.5 shrink-0 rounded-full"
          style={{ background: tone }}
          aria-hidden
        />
      )}
      <span className="min-w-0">{children}</span>
    </li>
  )
}

function VerdictBadge({ t }: { t: ThemeRow }) {
  const meta = VERDICT_META[t.verdict]
  const mean = t.meanScore === null ? null : Math.round(t.meanScore)
  return (
    // The caption used to read "mean reading", two inches from a cell reading
    // "9 read posts", while the mean was taken over the four of those nine
    // that drew comments. One figure, the wrong denominator beside it. The
    // caption carries its own count now and the sentence rides the hover.
    <div
      className="inline-flex min-w-[92px] flex-col items-center rounded-[10px] px-2.5 py-2 text-center"
      style={{ background: meta.bg }}
      title={
        mean === null
          ? undefined
          : `Mean of the readings of the ${t.meanOver} posts on this theme that drew comments, of ${t.posts} read in full. Posts with no comments are not in it.`
      }
    >
      {t.verdict === 'thin' ? (
        <>
          <span className="tnum text-[12px] font-bold leading-tight text-ink-2">
            {t.posts} posts
          </span>
          <span className="mt-0.5 text-[9px] leading-tight text-ink-3">too few to grade</span>
        </>
      ) : (
        <>
          <span className="text-[12px] font-bold leading-tight" style={{ color: meta.color }}>
            {meta.word}
          </span>
          {mean !== null && (
            <>
              <span className="tnum mt-0.5 text-[9px] leading-tight text-ink-3">
                mean over {t.meanOver}
              </span>
              <span className="tnum text-[13px] font-bold" style={{ color: meta.color }}>
                {signed(mean)}
              </span>
            </>
          )}
        </>
      )}
    </div>
  )
}

/* ── the ranked strip ─────────────────────────────────────────────────────── */

/**
 * TINTED BY THE VERDICT, NOT BY THE RANK.
 *
 * The tints were a fixed five-colour ramp indexed by position, and position
 * five was the NEGATIVE tint: on this desk card five is Governance at +35 with
 * the verdict working, so the strip printed a red card carrying a green
 * "Working". Colour that contradicts the word beside it is worse than no
 * colour. The verdict is a real property of the row — the table two feet
 * above already tints by it — so the card wears it, and five working themes
 * look like five working themes, which is what they are.
 */
function RankCard({ t, rank, mean }: { t: ThemeRow; rank: number; mean: number }) {
  const meta = VERDICT_META[t.verdict]
  return (
    // The rank and the NAME share the top row, as in the reference. With the
    // figure up there instead, the strip read "+69 +62 +57 +53 +47" and the
    // themes it was ranking were the third line down. `h-full` plus the bar
    // on `mt-auto` puts every bar on one baseline whether the name takes one
    // line or two — they used to sit 36px apart across five cards.
    <div className="flex h-full flex-col rounded-[var(--radius-sm)] p-3" style={{ background: meta.bg }}>
      {/* Two lines held for the name whether it takes one or two, so every
          card's figure, caption and bar sit on the same baselines across the
          strip. "Development & Infrastructure" used to take three lines and
          push its own numbers a row below its neighbours'. */}
      <div className="flex min-h-[34px] items-center gap-2">
        <span
          className="tnum grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold"
          style={{ background: 'var(--surface)', color: meta.color }}
        >
          {rank}
        </span>
        <p
          /* `break-words`, because line-clamp only clamps LINES — a single
             word wider than the card ("Development" needs 77px in the 44 a
             five-across strip gives at 1440) still overflows it. The card is
             the reference's, so the name breaks rather than the strip
             dropping to two across and standing twice as tall. */
          className="line-clamp-2 min-w-0 flex-1 break-words text-[11.5px] font-semibold leading-snug"
          title={t.topic}
        >
          {t.topic}
        </p>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="tnum text-[20px] font-bold leading-none" style={{ color: meta.color }}>
          {signed(mean)}
        </span>
        {/* The word the colour is carrying, so the colour is not the only
            thing saying it. */}
        {meta.word && (
          <span className="text-[10.5px] font-semibold" style={{ color: meta.color }}>
            {meta.word}
          </span>
        )}
      </div>
      {/* The mean's own denominator, not the row's post count: the mean is
          taken over the posts that drew comments, which on this desk is four
          of nine as often as it is nine of nine. */}
      <p className="tnum mt-0.5 text-[10px] text-ink-3">
        mean over {t.meanOver} of {t.posts} read
      </p>
      <div
        className="mt-auto pt-2.5"
        title={`Mean reading ${signed(mean)} on the -100..+100 scale, over the ${t.meanOver} posts of this theme that drew comments, of ${t.posts} read in full. The bar fills that same scale.`}
      >
        <div
          className="h-1.5 w-full overflow-hidden rounded-full"
          style={{ background: 'var(--surface-3)' }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.round(((mean + 100) / 200) * 100)}%`,
              background: meta.color,
            }}
          />
        </div>
      </div>
    </div>
  )
}

/* ── the quote blocks ─────────────────────────────────────────────────────── */

function QuoteBlock({ q }: { q: NextPostModel['audience']['quotes'][number] }) {
  // The chip's tint is mixed OVER the block's own wash rather than dropped
  // to white. Its soft tone was invisible on a soft-tinted block, and the
  // white bordered pill it became read identically for Positive and for
  // Negative, so the tone survived only in the block behind it. The
  // reference's chip is a tinted rounded RECT, which is the shape every other
  // tag on this screen wears.
  const tone =
    q.side === 'positive'
      ? {
          bg: 'var(--pos-soft)',
          glyph: 'var(--pos)',
          chipBg: 'color-mix(in oklab, var(--pos) 22%, var(--surface))',
          chipFg: 'var(--pos)',
          word: 'Positive',
        }
      : q.side === 'negative'
        ? {
            bg: 'var(--neg-soft)',
            glyph: 'var(--neg)',
            chipBg: 'color-mix(in oklab, var(--neg) 22%, var(--surface))',
            chipFg: 'var(--neg)',
            word: 'Negative',
          }
        : {
            bg: 'var(--surface-2)',
            glyph: 'var(--border-interactive)',
            chipBg: 'var(--surface)',
            chipFg: 'var(--text-2)',
            word: q.side === 'neutral' ? 'Neutral' : 'Unscored',
          }
  return (
    // Glyph in a left gutter beside the text, not on a row of its own opposite
    // the chip — that pushed every quote onto a third line. Two lines, cut by
    // line-clamp so the cut carries an ellipsis: these strings arrive already
    // truncated by the reading, and stopping mid-syllable with nothing after
    // it read as a rendering fault rather than a deliberate excerpt.
    <li className="rounded-[10px] p-3" style={{ background: tone.bg }} title={q.text}>
      <div className="grid grid-cols-[16px_minmax(0,1fr)] gap-2">
        <span
          aria-hidden
          className="font-serif text-[24px] font-bold leading-[0.9]"
          style={{ color: tone.glyph }}
        >
          &ldquo;
        </span>
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink-2">
              {q.text}
            </p>
            <span
              className="shrink-0 whitespace-nowrap rounded-[var(--radius-xs)] px-1.5 py-1 text-[10px] font-semibold leading-none"
              style={{ background: tone.chipBg, color: tone.chipFg }}
            >
              {tone.word}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">&mdash; {q.platform}</p>
        </div>
      </div>
    </li>
  )
}

/* ── tab two: openings ────────────────────────────────────────────────────── */

function OpeningsTab() {
  const store = useStore()
  const since = useMemo(() => Date.now() - 14 * 86_400_000, [])
  const model = useMemo(() => openingsOf(readStore(), since), [store, since])

  return (
    <div className="@container">
      <div className="grid gap-3 @3xl:grid-cols-2">
        {model.rows.length === 0 ? (
          <div className="@3xl:col-span-2">
            <Empty
              icon={<Newspaper size={18} aria-hidden />}
              title="No openings on file"
              body={
                model.newsRead === 0
                  ? 'No news has been read for this desk yet, and no grievances are open. The scan fills this as it runs.'
                  : 'Nothing the relevance readings let through, and no open grievances.'
              }
            />
          </div>
        ) : (
          model.rows.map((row) => <OpeningCard key={row.id} row={row} />)
        )}
      </div>
      {isDemoScope() && model.grievances > 0 && (
        <p className="mt-2.5 text-[10.5px] text-ink-3">
          Example desk: these grievance records are illustrative, seeded so the screens have
          something to show.
        </p>
      )}
      {model.hiddenNews > 0 && (
        <p className="mt-2.5 text-[10.5px] text-ink-3">
          {model.hiddenNews} stories were read and held back by the relevance verdicts. The news
          desk lists them.
        </p>
      )}
    </div>
  )
}

function OpeningCard({ row }: { row: Opening }) {
  const [posts, setPosts] = useState<SuggestedPost[] | null>(
    () => readSuggestions(row.id)?.posts ?? null,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const draft = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const identity = readStore().identity
      const drafted = await fetchSuggestions(row.issue, [], {
        name: identity?.name ?? 'This office',
        role: identity?.role ?? null,
        party: identity?.party ?? null,
        constituency: identity?.constituency ?? null,
      })
      saveSuggestions(row.id, drafted)
      setPosts(drafted)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The drafts could not be written.')
    } finally {
      setBusy(false)
    }
  }, [row])

  return (
    <Card className="flex flex-col p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">
          {row.kind === 'news' ? (
            <Newspaper size={13} aria-hidden />
          ) : (
            <FileText size={13} aria-hidden />
          )}
          {row.kind === 'news' ? 'In the news' : 'Grievance'}
        </p>
        {row.severity && (
          <Chip tone={row.severity === 'Critical' || row.severity === 'High' ? 'negative' : 'neutral'}>
            {row.severity}
          </Chip>
        )}
      </div>
      <p className="mt-1.5 text-[13px] font-semibold leading-snug">{row.title}</p>
      {row.issue.summary && row.issue.summary !== row.title && (
        <p className="mt-1 line-clamp-3 text-[11.5px] leading-relaxed text-ink-2">
          {row.issue.summary}
        </p>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{row.why}</p>

      {posts && posts.length > 0 && (
        <ul className="mt-2.5 space-y-1.5 border-t border-[var(--rule)] pt-2.5">
          {posts.slice(0, 2).map((p, i) => (
            <li key={i} className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-2">
              <p className="text-[11px] leading-relaxed text-ink-2">{p.text}</p>
              <p className="mt-1 text-[9.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                {p.angle} - drafted, check before you post
              </p>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-[10.5px] text-[var(--neg)]">{error}</p>}

      <div className="mt-auto pt-2.5">
        <Button size="sm" variant="outline" onClick={() => void draft()} disabled={busy}>
          {busy ? (
            <LoaderCircle size={13} className="animate-spin" aria-hidden />
          ) : (
            <Sparkles size={13} aria-hidden />
          )}
          {posts ? 'Draft fresh posts' : 'Draft posts for this'}
        </Button>
      </div>
    </Card>
  )
}

/* ── tab three: ideas ─────────────────────────────────────────────────────── */

function IdeasTab({
  model,
  onMakePost,
}: {
  model: NextPostModel
  onMakePost: (brief: string) => void
}) {
  const [result, setResult] = useState<PlanResult | null>(() => readPlanCache())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const input = useMemo((): PlanInput => {
    const store = readStore()
    const handles = listHandles()
    const own = handles.filter((h) => h.own)
    return {
      identity: store.identity,
      reach: platformReachOf(own),
      lands: model.lands,
      ownHandles: own,
      allHandles: handles,
      issues: issuesFor(store, Date.now() - 14 * 86_400_000),
    }
  }, [model])

  const load = useCallback(
    async (force: boolean) => {
      setBusy(true)
      setError(null)
      try {
        setResult(await loadPostPlan(input, force))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The plan could not be drafted.')
      } finally {
        setBusy(false)
      }
    },
    [input],
  )

  const ready = planReady(input)

  return (
    <div className="@container">
      {/* The two-sentence explainer that used to open this tab now rides the
          hover, per the prose rule; what is left is a label and the action. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center text-[13px] font-semibold text-ink">
          Worked-out plans
          <Hover
            text="Drafted by the model from the same memos this screen shows. Blanks in square brackets are facts it wants from you, never guesses."
            size={13}
          />
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void load(result !== null)}
          disabled={busy || !ready}
        >
          {busy ? (
            <LoaderCircle size={13} className="animate-spin" aria-hidden />
          ) : (
            <RefreshCw size={13} aria-hidden />
          )}
          {result ? 'Draft a fresh plan' : 'Draft the plan'}
        </Button>
      </div>

      {!ready && (
        <p className="mt-2 text-[11px] text-ink-3">
          The plan needs a set-up desk with at least one finding or open issue to stand on.
        </p>
      )}
      {error && <p className="mt-2 text-[11px] text-[var(--neg)]">{error}</p>}

      {/* Nothing drafted is a STATE, not a blank page. This tab rendered 800px
          of empty white when `result` was null, with the Empty component
          already imported two screens above. */}
      {result === null && !busy && !error && (
        <div className="mt-3">
          <Empty
            icon={<Lightbulb size={18} aria-hidden />}
            title="No plan drafted yet"
            body={
              ready
                ? 'Use “Draft the plan” above and the model writes one worked-out post per opening, from this desk’s own readings and open issues.'
                : 'There is nothing for a plan to stand on yet.'
            }
          />
        </div>
      )}

      {busy && result === null && (
        <div className="mt-3">
          <Empty
            icon={<LoaderCircle size={18} className="animate-spin" aria-hidden />}
            title="Drafting the plan"
            body="The model is reading this desk's findings and open issues."
          />
        </div>
      )}

      {result && (
        <div className="mt-3 grid gap-3 @3xl:grid-cols-2">
          {result.plans.map((plan, i) => (
            <Card key={i} className="flex flex-col p-3.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-semibold leading-snug">{plan.title}</p>
                <Chip tone={plan.priority === 'High' ? 'positive' : 'neutral'}>
                  {plan.priority}
                </Chip>
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <PlatformBadge platform={plan.platform as never} size={12} />
                <span className="text-[10.5px] text-ink-3">{plan.platform}</span>
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">{plan.why}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-ink-2">
                {plan.steps.map((s, j) => (
                  <li key={j}>{s}</li>
                ))}
              </ol>
              <blockquote className="mt-2.5 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-2.5 text-[11.5px] leading-relaxed text-ink-2">
                {plan.draft}
              </blockquote>
              <p className="mt-1.5 text-[9.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                Drafted by the model - check every fact before it goes out
              </p>
              <div className="mt-auto pt-2.5">
                <Button
                  size="sm"
                  onClick={() => onMakePost(`${plan.title}. ${plan.draft}`)}
                >
                  <Wand2 size={13} aria-hidden />
                  Make this in the studio
                  <ArrowRight size={12} aria-hidden />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── the shared panel ─────────────────────────────────────────────────────── */

function Panel({
  title,
  sub,
  info,
  children,
}: {
  title: string
  sub?: string
  /** Explanation the screen must not carry: it rides an Info hover instead. */
  info?: string
  children: ReactNode
}) {
  return (
    <Card padded={false} className="p-4">
      <p className="flex items-center text-[15px] font-bold leading-tight">
        {title}
        {info && <Hover text={info} size={13} />}
      </p>
      {sub && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{sub}</p>}
      <div className="mt-3">{children}</div>
    </Card>
  )
}

/* ── export ───────────────────────────────────────────────────────────────── */

/**
 * The screen as a workbook: the themes with their evidence, and the
 * provenance. The same figures, the same denominators, nothing added on the
 * way out.
 */
async function exportModel(model: NextPostModel): Promise<void> {
  const themes = {
    name: 'Themes',
    columns: [
      { header: 'Theme', width: 28, kind: 'text' as const },
      { header: 'Posts read', width: 11, kind: 'number' as const },
      { header: 'Posts that drew comments', width: 22, kind: 'number' as const },
      { header: 'Verdict', width: 16, kind: 'text' as const },
      { header: 'Mean reading', width: 13, kind: 'number' as const },
      // Named for what it is counted over, same as the mean two columns left:
      // the posts of the theme that drew comments, never every reading.
      { header: 'Audience answer, over commented posts', width: 44, kind: 'text' as const },
      { header: 'Platform lift', width: 44, kind: 'text' as const },
    ],
    // The Evidence column carried `whatLandsOf`'s topic sentence, whose mean
    // is taken over every reading including the uncommented ones — the one
    // figure this screen exists to refuse, leaving the product in a
    // spreadsheet next to a mean that excludes them. The mean's own
    // denominator goes out instead.
    rows: model.themes.map((t) => [
      t.topic,
      t.posts,
      t.meanOver,
      t.verdict,
      t.meanScore === null ? null : Math.round(t.meanScore),
      t.narrative.length > 0
        ? `${t.narrative.map((n) => `${n.label} on ${n.posts}`).join(', ')} of ${t.narrativeOver}`
        : null,
      t.lift
        ? `${t.lift.platform}: ${t.lift.n} posts at ${(Math.round(t.lift.multiple * 10) / 10).toFixed(1)}x typical`
        : null,
    ]),
  }
  const provenance = {
    name: 'Provenance',
    columns: [
      { header: 'Fact', width: 40, kind: 'text' as const },
      { header: 'Value', width: 40, kind: 'text' as const },
    ],
    rows: [
      // EVERY ROW NAMES ITS OWN BASIS. One "Window" row at the top and then a
      // column of bare counts let the window be read onto all of them, and
      // four of these six are not windowed at all.
      ['Window', model.windowLabel],
      ['Posts stored, whatever the window', String(model.postsStored)],
      ['Posts read in full, whatever the window', String(model.postsAnalysed)],
      ['Posts in window', String(model.postsInWindow)],
      ['Posts read in full in the window', String(model.analysedInWindow)],
      ['Posts with published figures in the window', String(model.measuredInWindow)],
      ['Comments counted on your accounts, whatever the window', String(model.commentsRead)],
      ['Comments scored into the split, whatever the window', String(model.commentsScored)],
      [
        // Zero out of zero is not 0% positive — and the guard has to be the
        // count the split was DIVIDED by, which is the scored one. The two
        // agree on this desk at 280 and disagree on three of the other four.
        'Comment split, over the comments scored',
        model.commentsScored > 0
          ? `${model.audience.positive}% positive, ${model.audience.neutral}% neutral, ${model.audience.negative}% negative of ${model.commentsScored} scored`
          : 'the account readings scored no comments',
      ],
      ['Recommendation', model.recommendation],
      ['Recommendation counted over', model.recommendationBasis],
    ],
  }
  const blob = await buildWorkbook([themes, provenance])
  const stamp = new Date().toISOString().slice(0, 10)
  saveBlob(blob, `what-to-post-next-${stamp}.xlsx`)
}
