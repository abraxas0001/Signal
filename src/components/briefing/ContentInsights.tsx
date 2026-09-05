import { Fragment, useEffect, useMemo, useState } from 'react'
import { ArrowRight, ExternalLink, Quote, TrendingDown, TrendingUp } from 'lucide-react'
import type { Report } from '@shared/types'
import type { PublicNarrative } from '@shared/taxonomy'
import { Card, Chip } from '../ui'
import { PlatformBadge, youtubeThumb } from '@/components/kit'
import type { TrackedHandle } from '@/lib/handles'
import { captionOf } from '@/lib/highlights'
import { cn, compact, isPlatformAltText } from '@/lib/utils'
import {
  inWindow,
  presentAnchor,
  sameWindowNote,
  windowLabel,
  windowStart,
  type WindowId,
} from '@/lib/window'
import { NoData, WindowPicker, noReactionsReason, noViewsReason } from './controls'
import type { Lens as HighlightLens } from '@/components/PostHighlights'

/**
 * "Content Insights" — what is working and what is not, judged the way the
 * owner asked: by the AUDIENCE. The office wrote the posts; it does not need
 * the desk to repeat them back. So the Mood column is the audience's recorded
 * reaction from each post's stored full report — Happy, Agreed, Divided,
 * Outraged — not a re-description of the post, and tapping a row opens that
 * stored report on the analyse screen, instantly, the same page an analysis
 * lands on. Nothing is re-analysed: a report is run once, kept (in the
 * device's history, or shipped with the example desk), and reread from there.
 *
 * That last claim is now enforced rather than asserted. A post with no
 * comment stored under it has no audience reaction of any kind, so its Mood
 * cell says so and prints nothing else; the reading of the post's own words
 * stays in the full report, where it is labelled as what it is. What the
 * column was printing instead is written against MoodCell below.
 *
 * Ranking is by what each platform actually published, and NO PLATFORM MAY
 * VANISH. Ranking on reactions alone deleted YouTube outright: the channel
 * publishes view counts and no like counts to a signed-out reader, so all 25
 * videos scored zero reactions and never reached a table — the account was
 * read, counted in the totals, and invisible in the one section about what
 * lands. So each platform's best and weakest post lead the tables, judged on
 * the figure that platform publishes, and a view is never compared against a
 * like.
 */

interface Row {
  url: string
  platform: string
  /** True when the platform published a reaction count for this post. */
  measured: boolean
  title: string
  thumbnailUrl: string | null
  publishedAt: string | null
  views: number | null
  reactions: number
  report: Report | null
  narrative: PublicNarrative | null
  score: number | null
  rationale: string | null
  /**
   * Whether any comment was retrieved under this post.
   *
   * The Mood column is a claim about the audience, and the only thing that
   * can support it is the audience's own words. This flag is what stops the
   * column answering from the post instead.
   */
  hasComments: boolean
  /**
   * How many comments the platform SAYS this post has, or null where neither
   * the listing nor the reading states one.
   *
   * `hasComments` above answers "did we retrieve any words"; this answers "were
   * there any words to retrieve", and the Mood column was collapsing the two.
   * Measured on this roster: of the 62 read posts holding no comment body, 25
   * genuinely have a count of zero and 36 have a count between 1 and 43. One
   * label — "No comments read" — was printed over both, so a post nobody had
   * commented on and a post whose 43 comments the desk failed to fetch looked
   * identical, and only one of those is something the office can act on.
   */
  commentCount: number | null
  /** Which witness supplied `commentCount` — named in the hover, because "the
      platform says zero" is only worth reading if you know who was asked. */
  commentCountFrom: 'the reading' | 'the account listing' | null
  /** What the reactions sum actually contains, for the cell's hover: 52 of
      this desk's 100 posts publish an incomplete set even of the figures
      their platform does publish, and a sum that silently treats a missing
      share count as zero is this card's own forbidden move. */
  reactionsNote: string
  /** The components behind `reactions`, kept apart so a surface can name them
      rather than printing one number and calling it "reactions". */
  likes: number | null
  commentCount2: number | null
  shares: number | null
}

/**
 * How many comments the platform says are under this post.
 *
 * The reading first: its count comes from the same document the comment bodies
 * would have come from, so it is the count the Mood cell's claim is about. The
 * two witnesses disagree on five of this desk's posts, every one a counter
 * that moved between two reads (4 against 5, 9 against 10).
 *
 * The exception is a zero. A zero is what makes the cell say "No comments",
 * and one witness saying "some" is enough to stop the other's zero being
 * printed as none: no disagreement on this roster crosses zero today, so the
 * guard changes nothing now — it exists for the day one does.
 */
function pickCommentCount(
  listing: number | null,
  reading: number | null,
): { count: number | null; from: Row['commentCountFrom'] } {
  if (listing != null && reading != null) {
    if (reading === 0 && listing > 0) return { count: listing, from: 'the account listing' }
    return { count: reading, from: 'the reading' }
  }
  if (reading != null) return { count: reading, from: 'the reading' }
  if (listing != null) return { count: listing, from: 'the account listing' }
  return { count: null, from: null }
}

function rowsOf(handles: TrackedHandle[], reports: Map<string, Report> | null): Row[] {
  const out: Row[] = []
  for (const h of handles) {
    for (const p of h.snapshots.at(-1)?.posts ?? []) {
      const report = reports?.get(p.url) ?? null
      const sentiment = report?.analysis?.sentiment ?? null
      /**
       * Reactions from either place the desk holds them, component by
       * component — the same rule the views and the date already follow, and
       * for the same reason. The listing for
       * instagram.com/dkarunaofficial/reel/DcwAldwNQo6/ carries no likes at
       * all while the reading beside it holds 15,082, and this row printed
       * "NA" reactions on the desk's most-viewed post of the month — a false
       * statement about a figure we have. A component neither place states
       * stays null, so a missing count is still never summed as a zero it
       * does not have.
       */
      const likes = report?.snapshot.engagement.likes?.value ?? p.likes ?? null
      const commentCt = report?.snapshot.engagement.comments?.value ?? p.comments ?? null
      const shares = report?.snapshot.engagement.shares?.value ?? p.shares ?? null
      const measured = likes != null || commentCt != null || shares != null
      /* Reading first here too. This file read the listing first for views and
         the reading first for the comment count, and highlights.ts reads the
         reading first for everything, so one post could carry two view counts
         on one dashboard (4,111 on this table, 3,937 in its own reading). One
         witness order, everywhere: the per-post reading, then the listing. */
      const views = report?.snapshot.engagement.views?.value ?? p.views ?? null
      // Either figure earns a place. Only a post NEITHER source said anything
      // about is left out, because there is nothing to rank it by.
      if (!measured && views == null) continue
      const commentSay = pickCommentCount(
        p.comments ?? null,
        report?.snapshot.engagement.comments?.value ?? null,
      )
      out.push({
        url: p.url,
        platform: h.platform,
        measured,
        /* Same rule as the highlights strip: a machine's description of the
           picture is not the post's title.
           AND NEVER THE PERMALINK. The last resort here was `p.url`, and 72
           stored titles across this roster are null, so Facebook's lowest
           measured post, https://www.facebook.com/reel/1130011936016828/,
           printed its own address in the title cell of "Underperforming
           posts", clamped to one line. A raw permalink is not a caption and
           tells the office nothing. Every sibling surface says so in words
           instead: CompareTable prints "Untitled post" and week.ts "(no
           caption)". The reading's headline first, where there is one.
           `captionOf` marks the collector's 140-character cut where the
           caption ran into it, so a severed caption is not read as a whole
           one. */
        title: isPlatformAltText(p.title)
          ? report?.analysis?.headline?.trim() || 'Untitled post'
          : captionOf(p.title, h.platform) ||
            report?.analysis?.headline?.trim() ||
            'Untitled post',
        /* The picture, from wherever one truly exists: the stored post, the
           full report's own media record, or YouTube's public still. */
        thumbnailUrl:
          p.thumbnailUrl ??
          report?.snapshot.media.find((m) => m.kind === 'image' || m.kind === 'video')?.url ??
          (h.platform === 'YouTube' ? youtubeThumb(p.url) : null),
        // The report often knows the date the scrape did not carry.
        publishedAt: p.publishedAt ?? report?.snapshot.publishedAt ?? null,
        /* And the view count, on the same terms as the date above. The
           collector stored no views for https://www.facebook.com/reel/1097305012953793/
           while the reading beside it holds 15,759 read off the page, and a
           cell that says "NA, views not published by Facebook" over a figure
           this desk is holding is a false statement about the platform. Nine
           posts on this roster are in that position. */
        views,
        reactions: (likes ?? 0) + (commentCt ?? 0) + (shares ?? 0),
        report,
        narrative: sentiment?.publicNarrative ?? null,
        score: sentiment?.score ?? null,
        rationale: sentiment?.rationale ?? null,
        hasComments: (report?.snapshot.comments?.length ?? 0) > 0,
        // Witness order and the zero guard both live on pickCommentCount.
        commentCount: commentSay.count,
        commentCountFrom: commentSay.from,
        likes,
        commentCount2: commentCt,
        shares,
        reactionsNote: !measured
          ? 'No reaction figure was published for this post.'
          : [
              ['likes', likes] as const,
              ['comments', commentCt] as const,
              ['shares', shares] as const,
            ].some(([, v]) => v == null)
            ? `Reactions counts ${[['likes', likes] as const, ['comments', commentCt] as const, ['shares', shares] as const]
                .filter(([, v]) => v != null)
                .map(([k]) => k)
                .join(' + ')} only — the rest were not published.`
            : 'Likes + comments + shares, all published.',
      })
    }
  }
  return out
}

const dayOf = (iso: string | null): string | null =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

/* ── the audience's word ─────────────────────────────────────────────────── */

const NARRATIVE_TONE: Record<string, 'positive' | 'warning' | 'negative'> = {
  Happy: 'positive',
  Agreed: 'positive',
  Divided: 'warning',
  Indifferent: 'warning',
  Resentment: 'negative',
  Outraged: 'negative',
}

/**
 * The app's fixed entity-colour assignment, mirrored from FollowerGrowth's
 * PLATFORM_ORDER (that constant is not exported and the file is owned by
 * another engineer right now — the two lists MUST stay identical). Facebook
 * wears chart-1 blue, Instagram chart-2 orange, Twitter/X chart-3 teal,
 * YouTube chart-5 pink, everywhere on the dashboard. Never re-ranked, never
 * cycled.
 */
const PLATFORM_ORDER: readonly string[] = [
  'Facebook',
  'Instagram',
  'Twitter/X',
  'LinkedIn',
  'YouTube',
]

/**
 * The Mood column: the audience's recorded reaction, in its own word, and
 * NOTHING ELSE IN THAT COLUMN.
 *
 * It used to fall through to `analysis.sentiment.score` whenever the reading
 * recorded no narrative word, and on a post with no comments that score was
 * read from the post's own text. So a Twitter/X post scored 90, whose stored
 * rationale opens "The post itself is highly positive, celebrating 'progress
 * racing'", wore a green "Positive" chip in a column headed as the audience's
 * reaction, under a card headed "How your audience answered". Six of the
 * sixteen rows this section renders on the demo desk were that. The only
 * disclosure was a hover, unavailable on a phone, and it said the reaction
 * "was unclear in the comments" where there were no comments at all.
 *
 * The comment check comes FIRST, before the narrative word: 21 readings on
 * this roster carry a narrative ("Happy", "Agreed", "Resentment") on a post
 * with no comment stored under it, and a mood word taken off the post is no
 * more the audience's answer than a score taken off it. Where nobody answered
 * the cell says nobody answered, which is a finding the office can act on and
 * a chip in the wrong column is not.
 */
function MoodCell({ row }: { row: Row }) {
  if (!row.report) {
    return (
      <span
        className="cursor-help text-[11px] text-ink-3"
        title="This post has not been read in full yet. Tap the row to analyse it."
      >
        Not read
      </span>
    )
  }
  if (!row.hasComments) {
    /**
     * TWO DIFFERENT FACTS, TWO DIFFERENT SENTENCES.
     *
     * "No comments read" was printed over both of these, and the office read it
     * as a failure every time. Only one of them is one. A post nobody commented
     * on is a finding about the audience; a post whose comments the desk did
     * not fetch is a gap in the desk, and it is the second that someone can act
     * on. The wording now says which, and the count is what separates them.
     *
     * Kept SHORT on purpose: this cell sits in the narrowest column of two
     * side-by-side tables, and the old sentence wrapped onto three lines, which
     * is what made the underperforming table tower over the top one.
     */
    if (row.commentCount === 0) {
      return (
        <span
          className="cursor-help whitespace-nowrap text-[11px] text-ink-3"
          title={`${row.platform} published a count of 0 for this post when ${row.commentCountFrom ?? 'the desk'} was taken — nothing to read. A published zero is the platform's claim, not proof.`}
        >
          No comments
        </span>
      )
    }
    if (row.commentCount != null && row.commentCount > 0) {
      return (
        <span
          className="cursor-help whitespace-nowrap text-[11px] text-ink-3"
          title={`${row.platform} shows ${row.commentCount.toLocaleString('en-IN')} comment${row.commentCount === 1 ? '' : 's'} here (${row.commentCountFrom ?? 'unknown witness'}); none has been read yet. Tap the row to read them.`}
        >
          {compact(row.commentCount)} unread
        </span>
      )
    }
    return (
      <span
        className="cursor-help whitespace-nowrap text-[11px] text-ink-3"
        title="No comments read, and no comment count published — not known whether anybody commented. This is not zero."
      >
        Not known
      </span>
    )
  }
  if (row.narrative && row.narrative !== 'NA') {
    /*
     * ONE VOCABULARY PER COLUMN.
     *
     * This column printed the reading's own narrative word — Agreed, Happy,
     * Divided, Resentment — beside cells reading Positive and Neutral from
     * the score branch below, so a single column carried two vocabularies and
     * a reader had no way to rank "Agreed" against "Positive". The reference
     * heads this column Sentiment and gives it three words. The recorded word
     * is not lost: NARRATIVE_TONE is the app's own mapping and the exact word
     * the reading wrote rides the hover, where the rationale already was.
     */
    const tone = NARRATIVE_TONE[row.narrative] ?? 'warning'
    const word = tone === 'positive' ? 'Positive' : tone === 'negative' ? 'Negative' : 'Neutral'
    return (
      <span
        className="cursor-help"
        title={`The audience reaction recorded in the full reading: “${row.narrative}”.${row.rationale ? ` ${row.rationale}` : ''}`}
      >
        <Chip tone={tone}>{word}</Chip>
      </span>
    )
  }
  if (row.score != null) {
    const label = row.score >= 15 ? 'Positive' : row.score <= -15 ? 'Negative' : 'Neutral'
    const tone = row.score >= 15 ? 'positive' : row.score <= -15 ? 'negative' : 'warning'
    return (
      <span title="The reading put no single word to how the audience answered, so this is its score of the comments on this post.">
        <Chip tone={tone}>{label}</Chip>
      </span>
    )
  }
  return <span className="text-[11px] text-ink-3">Unclear</span>
}

/* ── the picture, or the account's own face ──────────────────────────────── */

function Thumb({ row }: { row: Row }) {
  const [failed, setFailed] = useState(false)
  if (row.thumbnailUrl && !failed) {
    return (
      <img
        src={row.thumbnailUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-9 shrink-0 rounded-[var(--radius-sm)] object-cover"
      />
    )
  }
  /* The post's OWN picture or none at all.
     The account's profile photo used to fill in here, and it read as a
     thumbnail: eight rows of the same face, each implying it was the picture
     on that post. A tinted tile carrying the platform's colour says "this
     post has no picture", which is the truth and is never mistaken for one. */
  return (
    <span
      className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)]"
      style={{ background: THUMB_TINT[row.platform] ?? 'var(--surface-3)' }}
      title="No picture is stored for this post."
    >
      <Quote size={12} className="text-ink-3 opacity-70" fill="currentColor" strokeWidth={0} aria-hidden />
    </span>
  )
}

/** Brand colour at low alpha, so a text post still says where it lives. */
const THUMB_TINT: Record<string, string> = {
  Instagram: 'rgba(221,42,123,0.14)',
  Facebook: 'rgba(24,119,242,0.12)',
  'Twitter/X': 'rgba(15,20,25,0.10)',
  YouTube: 'rgba(255,0,51,0.10)',
  LinkedIn: 'rgba(10,102,194,0.12)',
}

/* ── the contest each row is standing in ─────────────────────────────────── */

/* What a post is judged on: its reactions where the platform published any,
   its views where that is all the platform gives. Module scope, because the
   standings below must use the IDENTICAL function the tables rank with — an
   explanation that can drift from the placement it explains is worse than
   none. */
const scoreOf = (r: Row): number => (r.measured ? r.reactions : (r.views ?? 0))

/** Where a post stands among its own platform's posts in this window. */
interface Standing {
  /** 1 = that platform's strongest post here. Competition ranking: ties share. */
  place: number
  of: number
  tied: boolean
}

/**
 * THE TABLES ARE FOUR PER-PLATFORM CONTESTS PRINTED AS TWO LISTS, and nothing
 * on the card said so. A YouTube video with 1 reaction sat under "Top
 * performing" two rows from an Instagram post with 155 in "Underperforming",
 * both correctly — each is its own channel's best or worst — and the office
 * read the pair as a broken ranking. The standing prints the contest:
 * "#1 of 1" says exactly why a 5-view video is in the top table.
 *
 * Built from the windowed rows BEFORE the platform picker filters them, so a
 * row's rank never changes when the reader narrows the view. Cohorts are per
 * platform and per figure — a view is never ranked against a like — and equal
 * figures share a place (three of this desk's Twitter posts score exactly 8;
 * printing 14th, 15th, 16th over them would assert an order the figures do
 * not contain).
 */
function standingsOf(rows: Row[]): Map<string, Standing> {
  const out = new Map<string, Standing>()
  const cohorts = new Map<string, Row[]>()
  for (const r of rows) {
    const key = `${r.platform}::${r.measured ? 'reactions' : 'views'}`
    cohorts.set(key, [...(cohorts.get(key) ?? []), r])
  }
  for (const list of cohorts.values()) {
    const sorted = [...list].sort((a, b) => scoreOf(b) - scoreOf(a))
    const sharing = new Map<number, number>()
    for (const r of sorted) sharing.set(scoreOf(r), (sharing.get(scoreOf(r)) ?? 0) + 1)
    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i]
      if (!row) continue
      const s = scoreOf(row)
      const prev = i > 0 ? sorted[i - 1] : undefined
      const place = prev && s === scoreOf(prev) ? (out.get(prev.url)?.place ?? i + 1) : i + 1
      out.set(row.url, { place, of: sorted.length, tied: (sharing.get(s) ?? 1) > 1 })
    }
  }
  return out
}

/**
 * The standing, carried entirely by the App cell's hover.
 *
 * It was printed under the badge as "#1 of 18". The office asked for it out of
 * the column: sixteen rows each stating their own rank turned the narrowest
 * column into a second table, and the rank is context for a row rather than a
 * figure to be read down. So the badge is the whole cell again, and the
 * sentence — which contest, how many in it, and which figure it was judged on —
 * is one hover away.
 *
 * Returns the sentence, not an element: the caller hangs it on the badge, so
 * there is exactly one hover target in the cell instead of two stacked ones.
 */
function standingNote(row: Row, standing: Standing | undefined): string {
  if (!standing) return row.platform
  if (standing.of === 1) {
    return `${row.platform} — the only ${row.platform} post in this window. It holds a place because every platform gets its say, not because it out-performed anything.`
  }
  return `${row.platform} — ${standing.place}${standing.tied ? ' equal' : ''} of ${standing.of} ${row.platform} posts in this window, strongest first, on ${
    row.measured ? 'reactions' : 'view counts'
  }. Ranked within its own app, never across apps.`
}

/* ── the two lists, and the panel that rolls them up ─────────────────────── */

/**
 * The one ranking this card has: strongest engagement first, weakest last,
 * EIGHT a side — ten filled the height of the old ledger, and when the panel
 * shortened to the reference's table the owner asked for the extra rows back
 * out. Factored out because TWO surfaces must agree on it to the row —
 * the pair of post tables, and the platform panel that averages each app's
 * posts on those same lists. A copy that drifted would print a rolled-up
 * figure the tables cannot account for.
 */
/**
 * FIVE A SIDE.
 *
 * It was eight, and the two tables made this the tallest block on the page by
 * a long way — a wall of sixteen rows where the reference shows three. A
 * ranked list is read from the top; rows six to eight of "top performing" are
 * neither top nor a finding, and the screen that holds every post ranked by
 * reception is one link away at the foot of each table.
 */
const PER_LIST = 5

function rankLists(list: Row[]): { top: Row[]; bottom: Row[]; ranked: number } {
  const ranked = [...list].sort((a, b) => scoreOf(b) - scoreOf(a))
  const top = ranked.slice(0, Math.max(1, Math.min(PER_LIST, ranked.length)))
  const rest = ranked.slice(top.length)
  return {
    top,
    bottom: rest.length > 0 ? rest.slice(-Math.min(PER_LIST, rest.length)).reverse() : [],
    ranked: ranked.length,
  }
}

/**
 * One cell of the platform panel: the mean engagement of one app's posts on
 * one of the two lists. Units are never mixed inside a mean — a view is never
 * averaged against a like — so a cell is either a reactions mean (bar
 * eligible), a views mean (figure only, labelled, NO bar on the reactions
 * scale), or NA with the reason.
 */
interface PanelCell {
  value: number | null
  unit: 'reactions' | 'views' | null
  note: string
}

function cellOf(mine: Row[], platform: string): PanelCell {
  if (mine.length === 0) {
    return { value: null, unit: null, note: `${platform} has nothing to rank on this side in this window.` }
  }
  const measured = mine.filter((r) => r.measured)
  if (measured.length > 0) {
    const mean = Math.round(measured.reduce((a, r) => a + r.reactions, 0) / measured.length)
    const excluded = mine.length - measured.length
    return {
      value: mean,
      unit: 'reactions',
      note:
        `Mean reactions (likes + comments + shares, as published) of ${platform}'s ${measured.length} post${measured.length === 1 ? '' : 's'} on this side.` +
        (excluded > 0
          ? ` ${excluded} more publish${excluded === 1 ? 'es' : ''} views only and sit${excluded === 1 ? 's' : ''} outside this mean.`
          : ''),
    }
  }
  const viewed = mine.filter((r) => r.views != null)
  if (viewed.length === 0) {
    // rowsOf drops any post with neither figure, so this is unreachable today
    // — kept so a future collector change degrades to an honest NA, not a 0.
    return { value: null, unit: null, note: 'No engagement figure was published for these posts.' }
  }
  const mean = Math.round(viewed.reduce((a, r) => a + (r.views ?? 0), 0) / viewed.length)
  return {
    value: mean,
    unit: 'views',
    note: `${platform} publishes view counts here, not reactions, so this is the mean views of its ${viewed.length} post${viewed.length === 1 ? '' : 's'} on this list. No bar: a view is never drawn on the reactions scale.`,
  }
}

/**
 * Figure-plus-bar, the reference's row anatomy: bold figure, then a pill bar
 * on a shared light track — green for the top column, red for the
 * underperforming one. One linear scale PER COLUMN, over reactions means
 * only; a views mean prints its unit and draws nothing. Identity is never
 * colour-alone: the column header names it and the figure sits printed
 * beside every bar (the pos/neg pair's CVD ΔE of 6.8 is legal exactly
 * because of that secondary encoding — dataviz validator, run this change).
 */
function PanelCellView({
  cell,
  tone,
  max,
  mounted,
  delay,
}: {
  cell: PanelCell
  tone: 'pos' | 'neg'
  /** The largest reactions mean in this column — the column's linear scale. */
  max: number
  mounted: boolean
  delay: number
}) {
  if (cell.value == null) {
    return <NoData reason={cell.note} className="text-[11px]" />
  }
  const figure = (
    <span className="tnum w-10 shrink-0 cursor-help text-xs font-bold text-ink" title={cell.note}>
      {compact(cell.value)}
    </span>
  )
  if (cell.unit === 'views') {
    return (
      <span className="flex min-w-0 items-center gap-2">
        {figure}
        <span
          className="cursor-help text-[9.5px] uppercase tracking-wide text-ink-3"
          title={cell.note}
        >
          views
        </span>
      </span>
    )
  }
  const pct = max > 0 ? (cell.value / max) * 100 : 0
  return (
    <span className="flex min-w-0 items-center gap-2">
      {figure}
      <span
        className="block h-1.5 min-w-6 flex-1 cursor-help rounded-full bg-[var(--surface-3)]"
        title={`Both bars in this column share one linear scale; the longest stands for ${compact(max)}.`}
      >
        <span
          className="block h-1.5 rounded-full transition-[width] duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{
            width: mounted ? `${pct}%` : 0,
            minWidth: '3px',
            background: tone === 'pos' ? 'var(--pos)' : 'var(--neg)',
            transitionDelay: `${delay}ms`,
          }}
        />
      </span>
    </span>
  )
}

/* ── one ranked table ────────────────────────────────────────────────────── */

function PostTable({
  title,
  icon,
  rows,
  tone,
  showViews,
  standings,
  emptyNote,
  footer,
  onRead,
  onOpenReport,
}: {
  title: string
  icon: React.ReactNode
  rows: Row[]
  tone: 'pos' | 'neg'
  /** Off when nothing listed published a view count — a column of blanks is furniture. */
  showViews: boolean
  standings: Map<string, Standing>
  /** What an empty table means HERE: "every post is in the other table" and
      "nothing published a figure" are different facts. */
  emptyNote: string
  /** What the footer link says, and where it goes. Null draws no footer. */
  footer: { label: string; onOpen: () => void } | null
  onRead: (postUrl: string) => void
  onOpenReport: (report: Report) => void
}) {
  const heads = [
    {
      /* THE APP COLUMN IS GONE, NOT THE APP. Five columns did not fit the
         track this table gets, so both tables scrolled sideways and the
         Sentiment column was cut mid-word — "Ser", "Sent", "No c" — which is
         the one column a reader cannot guess from a stub. The platform was
         the cheapest column to lose because it was one 20px badge wide and
         belongs with the post it describes; it now sits on the post's own
         thumbnail, carrying the same standing hover it always did. */
      h: 'Post',
      why: "The post, which app it was published on, and where it stands among that app's own posts in this window. Ranked within its app, never across apps.",
    },
    ...(showViews
      ? [
          {
            /* HEADED "VIEWS", NOT "IMPRESSIONS". The column said Impressions
               and its own hover said "Not true impressions" — a heading
               contradicted by its own explanation two lines later. What the
               platform publishes here is a view count, and one person can
               account for several views, so the two words are not synonyms
               and the honest one is the one that names the figure. */
            h: 'Views',
            why: 'The view count the platform published. One person can account for several, so these are not impressions.',
          },
        ]
      : []),
    // Headed for what it holds: this column is the SUM of likes, comments and
    // shares, and under the word "Likes" a post with 546 likes read as 720.
    {
      h: 'Reactions',
      why: "Likes plus comments plus shares, over whichever of the three the app published. On Facebook the first of those is a reaction total — every reaction type, not likes alone.",
    },
    // Headed for what it holds here too: this column is read from the
    // comments under the post and from nothing else, and where no comment was
    // retrieved it says so rather than answering from the post's own words.
    {
      h: 'Sentiment',
      why: 'How the audience answered, read from comments only.',
    },
  ]

  return (
    /* THE REFERENCE'S BORDERED INNER PANEL. Without it the two lists ran
       loose inside the card and simply stopped at the last row, which is what
       left the whole block with no bottom edge. */
    <div className="flex min-w-0 flex-col rounded-[12px] border border-[var(--rule)] p-3">
      <p
        className={cn(
          'mb-2 flex items-center gap-1.5 text-[13px] font-bold',
          tone === 'pos' ? 'text-[var(--pos)]' : 'text-[var(--neg)]',
        )}
      >
        {icon}
        {title}
      </p>

      {rows.length === 0 ? (
        <p className="text-xs leading-relaxed text-ink-3">{emptyNote}</p>
      ) : (
        <div className="relative">
          <div className="overflow-x-auto">
            {/* A REAL minimum, so the wrapper's overflow-x-auto engages.
                At 360px the columns simply crushed inside the card's
                overflow-hidden and the words were amputated — "Senti", "Pos",
                "No commen". A table that scrolls is readable; a table that
                clips is not. */}
            <table className="w-full min-w-[330px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--rule)]">
                {heads.map(({ h, why }, i) => (
                  <th
                    key={h}
                    title={why}
                    /* The last column carries no right padding, so its header
                       is not pressed against the panel's border. */
                    style={i === heads.length - 1 ? { paddingRight: 0 } : undefined}
                    /* SENTENCE CASE, AND NEVER TWO LINES. All-caps at 10px
                       with letter-spacing made "TOTAL IMPRESSIONS" wrap, so
                       the header row sat two lines tall over single-line
                       neighbours and nothing lined up. The rest of this app
                       is sentence case; so is the reference. */
                    className="cursor-help pb-1.5 pr-2 text-[11px] font-semibold leading-tight text-ink-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.url} className="border-b border-[var(--rule)] last:border-0">
                  <td className="py-2 pr-2">
                    {/* Navigation, not disclosure, per the owner: a stored
                        reading opens on the analyse page, where every report
                        lives, and Back returns here. */}
                    <button
                      type="button"
                      onClick={() => (r.report ? onOpenReport(r.report) : onRead(r.url))}
                      title={
                        r.report
                          ? 'Open the stored reading. Already analysed, so it opens instantly.'
                          : 'Run the full analysis on this post.'
                      }
                      className="group flex min-w-0 items-center gap-2 text-left"
                    >
                      <span
                        className="relative inline-flex shrink-0 cursor-help"
                        title={standingNote(r, standings.get(r.url))}
                        aria-label={standingNote(r, standings.get(r.url))}
                      >
                        <Thumb row={r} />
                        {/* Ringed in the card's own surface so the badge reads
                            as sitting ON the thumbnail rather than clipped
                            into it. */}
                        <span className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-[var(--surface)]">
                          <PlatformBadge platform={r.platform} size={15} />
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="line-clamp-1 text-xs font-medium text-ink group-hover:text-[var(--accent)]">
                          {r.title}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-[10.5px] text-ink-3">
                          {dayOf(r.publishedAt) ?? 'Date not published'}
                          {r.report && <ExternalLink size={10} aria-hidden className="opacity-60" />}
                        </span>
                      </span>
                    </button>
                  </td>
                  {/* A MISSING FIGURE IS NA WITH A REASON, NEVER AN EMPTY
                      CELL. The views column is shown as soon as any listed
                      row published one, and on the default view four of the
                      eight rows are Facebook's and Instagram's, which publish
                      none: four blanks in a column of numbers read as a desk
                      that failed to fetch them, or as nought. The NA mark and
                      its reason say the desk looked and the platform said
                      nothing, which is the same mark and the same wording the
                      reach tiles already use. */}
                  {showViews && (
                    <td className="tnum py-2 pr-2 text-xs font-semibold">
                      {r.views == null ? (
                        /* THE NA IS NOT THE RANKING. The office read a row
                           reading "NA impressions, #2 of 16" and asked how a
                           post with no impressions could be ranked second.
                           It is ranked on its reactions — the tables rank on
                           views only where a platform publishes nothing else
                           — so the dash says which, right where the question
                           gets asked. */
                        <NoData
                          reason={
                            r.measured
                              ? `${noViewsReason(r.platform)} This post is ranked on its reactions instead, not on views.`
                              : noViewsReason(r.platform)
                          }
                          className="text-[11px]"
                        />
                      ) : (
                        compact(r.views)
                      )}
                    </td>
                  )}
                  <td className="tnum py-2 pr-2 text-xs font-semibold">
                    {r.measured ? (
                      /* The sum is only as complete as what was published:
                         Instagram's "300" is 298 likes + 2 comments and no
                         share figure at all. The hover says which components
                         are inside, so a partial sum never reads as a full
                         one. The arithmetic itself stays — changing it would
                         move the ranking. */
                      <span className="cursor-help" title={r.reactionsNote}>
                        {compact(r.reactions)}
                      </span>
                    ) : (
                      <NoData reason={noReactionsReason(r.platform)} className="text-[11px]" />
                    )}
                  </td>
                  <td className="py-2">
                    <MoodCell row={r} />
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
          {/* Phone-only right-edge fade: at 390px the Mood pills cut
              mid-word, and the fade is the "there is more, swipe" sign the
              cut edge alone never was. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--surface)] to-transparent sm:hidden"
          />
        </div>
      )}

      {/* The row that closes the list, as the reference closes all three of
          its inner panels. It lands on Post highlights, which is the screen
          that actually ranks every post by how it was received — not on a
          "detailed report" screen this app does not have. */}
      {footer && (
        <button
          type="button"
          onClick={footer.onOpen}
          className="mt-auto inline-flex min-h-9 items-center gap-1.5 self-start pt-2.5 text-[12.5px] font-semibold text-[var(--accent)]"
        >
          {footer.label}
          <ArrowRight size={13} aria-hidden />
        </button>
      )}
    </div>
  )
}

/* ── the section ─────────────────────────────────────────────────────────── */

/**
 * The unit beside a figure, agreeing with it.
 *
 * YouTube's row read "1 likes". The count is real and the word was not, and a
 * surface that gets small grammar wrong is read as one that might be getting
 * the numbers wrong too.
 */
function unit(n: number, plural: string): string {
  return n === 1 ? plural.replace(/s$/, '') : plural
}

export function ContentInsights({
  handles,
  reports,
  onRead,
  onOpenReport,
  onOpenAccounts,
  onOpenAllPosts,
}: {
  /** The desk's own accounts: this section is about the office's own output. */
  handles: TrackedHandle[]
  reports: Map<string, Report> | null
  onRead: (postUrl: string) => void
  /** Open an already-stored reading on the analyse screen. */
  onOpenReport: (report: Report) => void
  onOpenAccounts: () => void
  /** The screen that ranks every post by how it was received. */
  /** Opens the full highlights screen already on the matching lens. */
  onOpenAllPosts: (lens: HighlightLens, win: WindowId) => void
}) {
  const [platform, setPlatform] = useState<string>('all')
  const [window, setWindow] = useState<WindowId>('month')

  // Counted back from now, matching the rest of the dashboard's windows.
  const anchor = presentAnchor()
  const start = windowStart(anchor, window)

  const all = useMemo(
    () => rowsOf(handles, reports).filter((r) => inWindow(r.publishedAt, start)),
    [handles, reports, start],
  )
  const rows = platform === 'all' ? all : all.filter((r) => r.platform === platform)

  /* Standings come from `all` — the windowed set BEFORE the platform picker —
     so a row's rank is identical whether "All platforms" or one app is
     selected. Filtering narrows the view; it never renumbers a contest. */
  const standings = useMemo(() => standingsOf(all), [all])

  /* Over the rows actually on screen, so the sentence is about what the reader
     is looking at — with Instagram pressed it is Instagram's posts that are all
     under a week old, not the desk's. */
  const sameNote = useMemo(() => {
    const dates = rows.map((r) => r.publishedAt).filter((d): d is string => Boolean(d))
    if (dates.length === 0) return ''
    return sameWindowNote(dates.reduce((a, b) => (a < b ? a : b)), window)
  }, [rows, window])


  const { top, bottom, ranked } = useMemo(() => {
    /**
     * RANKED BY ENGAGEMENT, PLAINLY — THE FAIR-FILL IS GONE.
     *
     * The fair-fill guaranteed every platform a seat, which is how a YouTube
     * video with one reaction sat in "Top performing" while Instagram posts
     * carrying hundreds sat in "Underperforming". Correct under its own rule,
     * and the office read it as a broken ranking every single time. Their
     * instruction settles it: "just show as per the engagement" — so this is
     * now the reference's simple order, strongest engagement first, weakest
     * last, whatever platform that favours. The per-app standing still rides
     * the badge hover for anyone who wants the contest view.
     *
     * FIVE a side; the slicing itself lives in rankLists.
     */
    return rankLists(rows)
  }, [rows])

  const showViewsTop = top.some((r) => r.views != null)
  const showViewsBottom = bottom.some((r) => r.views != null)

  /**
   * Posts read in full, counted over the posts themselves.
   *
   * This counted `all`, which is the RANKABLE set: rowsOf drops any post the
   * platform published no figure for at all, because there is nothing to rank
   * it by. That is right for the tables and wrong for this sentence. A post
   * with a full reading and no published figures has still been read in full,
   * and the header said 67 where the desk holds 68. The tables keep their
   * filter; the claim counts what it claims to count.
   */
  const analysed = useMemo(() => {
    let n = 0
    for (const h of handles) {
      for (const post of h.snapshots.at(-1)?.posts ?? []) {
        const report = reports?.get(post.url)
        if (!report?.analysis) continue
        const at = post.publishedAt ?? report.snapshot.publishedAt ?? null
        if (!inWindow(at, start)) continue
        if (platform !== 'all' && h.platform !== platform) continue
        n += 1
      }
    }
    return n
  }, [handles, reports, start, platform])

  /**
   * The reference's right-hand panel: one row per app, its strongest posts'
   * mean against its weakest posts' mean.
   *
   * NO LONGER THE TWO TABLES ROLLED UP. Deriving cells from top/bottom list
   * membership printed NA for most of the board: eight-row lists are
   * Instagram-heavy, so an app with no seat on a list had no figure — and the
   * office read a board of NAs, correctly, as broken. Each app is now ranked
   * against ITSELF: its in-window posts sorted by the same scoreOf the tables
   * use, stronger half against weaker half. Every app with a post has a
   * figure; an app with a single post has a top figure and an honest NA
   * underneath, because one post has nothing to rank against.
   */
  const panel = useMemo(() => {
    const present = [...new Set(all.map((r) => r.platform))]
    const ordered = [
      ...PLATFORM_ORDER.filter((p) => present.includes(p)),
      ...present.filter((p) => !PLATFORM_ORDER.includes(p)),
    ]
    return ordered.map((p) => {
      const mine = [...all.filter((r) => r.platform === p)].sort((a, b) => scoreOf(b) - scoreOf(a))
      const half = Math.ceil(mine.length / 2)
      const upper = mine.slice(0, half)
      const lower = mine.slice(half)
      const sumOf = (pick: (r: Row) => number | null): number | null => {
        const vals = mine.map(pick).filter((v): v is number => v != null)
        return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null
      }
      return {
        platform: p,
        posts: mine.length,
        top: cellOf(upper, p),
        bottom:
          mine.length === 1
            ? ({
                value: null,
                unit: null,
                note: `${p} has one post in this window — nothing to rank it against.`,
              } as PanelCell)
            : cellOf(lower, p),
        /* The marks the office asked back: the window's real component
           totals, absent where the platform publishes none — never zero. */
        likes: sumOf((r) => r.likes),
        comments: sumOf((r) => r.commentCount2),
        shares: sumOf((r) => r.shares),
        views: sumOf((r) => r.views),
      }
    })
  }, [all])
  const platforms = [...new Set(all.map((r) => r.platform))]

  /* One linear scale per column, over reactions means only — a views mean
     never joins a reactions scale; it prints its unit and no bar instead. */
  const maxTop = panel.reduce(
    (m, p) => (p.top.unit === 'reactions' ? Math.max(m, p.top.value ?? 0) : m),
    0,
  )
  const maxBottom = panel.reduce(
    (m, p) => (p.bottom.unit === 'reactions' ? Math.max(m, p.bottom.value ?? 0) : m),
    0,
  )

  /* Mount-only cascade for the platform panel's bars. Reduced
     motion starts at the final state instantly; nothing loops, and no number
     counts up — a mid-animation figure is a figure the desk never held. */
  const [barsMounted, setBarsMounted] = useState(
    () =>
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const id = requestAnimationFrame(() => setBarsMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  /* Nothing to rank in the widest window this card now offers: the card has
     no story, so it stands down rather than printing empty tables. The test
     used to name 'all', which the picker no longer shows. */
  if (all.length === 0 && window === 'month') return null

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-[-0.015em]">Content insights</h2>
          <p className="mt-0.5 text-xs text-ink-3">
            How your audience answered · {windowLabel(anchor, window).replace(' to ', ' – ')}
            {analysed > 0 && ` · ${analysed} posts read in full`}
            {sameNote && <span className="block">{sameNote}</span>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <WindowPicker value={window} onChange={setWindow} options={['week', 'month']} />
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPlatform('all')}
              aria-pressed={platform === 'all'}
              className={cn(
                'inline-flex min-h-9 items-center rounded-[var(--radius-pill)] border px-3 text-xs font-semibold transition-colors',
                platform === 'all'
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-[var(--border)] bg-[var(--surface-2)] text-ink-2',
              )}
            >
              All platforms
            </button>
            {platforms.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                aria-pressed={platform === p}
                aria-label={p}
                title={p}
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-full border transition-colors',
                  platform === p
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-[var(--border)] bg-[var(--surface-2)]',
                )}
              >
                <PlatformBadge platform={p} size={20} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          No post with published engagement falls inside this window.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2 2xl:grid-cols-[1fr_1fr_minmax(300px,0.86fr)]">
          <PostTable
            title="Top performing posts"
            icon={<TrendingUp size={14} aria-hidden />}
            rows={top}
            tone="pos"
            showViews={showViewsTop}
            standings={standings}
            emptyNote="No post here published enough for a ranking in this window."
            /* SHOWN WHENEVER THERE IS A LIST TO SEE. The link used to appear
               only when the table was hiding rows, because it used to promise
               "all top posts". It now points at a DIFFERENT reading of the
               same posts — how their comments read rather than how they
               performed — so it is worth offering even when this table is
               showing everything it has. */
            footer={
              top.length > 0
                ? {
                    /* NAMED FOR THE DESTINATION, NOT FOR THIS TABLE. The
                       office asked these to lead to Best and Worst received,
                       and those lists are ranked by how the COMMENTS read
                       while this table ranks by engagement — so "View all top
                       posts" promised the same five posts and delivered a
                       different set. The link now says where it goes. */
                    label: 'See best received posts',
                    onOpen: () => onOpenAllPosts('positive', window),
                  }
                : null
            }
            onRead={onRead}
            onOpenReport={onOpenReport}
          />
          <PostTable
            title="Underperforming posts"
            icon={<TrendingDown size={14} aria-hidden />}
            rows={bottom}
            tone="neg"
            showViews={showViewsBottom}
            standings={standings}
            emptyNote={
              rows.length > 0
                ? `Every post this desk holds in this window — ${rows.length} of ${rows.length === 1 ? 'it' : 'them'} — is in the other table.`
                : 'No post here published enough for a ranking in this window.'
            }
            footer={
              bottom.length > 0
                ? { label: 'See worst received posts', onOpen: () => onOpenAllPosts('negative', window) }
                : null
            }
            onRead={onRead}
            onOpenReport={onOpenReport}
          />

          <div className="flex min-w-0 flex-col rounded-[12px] border border-[var(--rule)] p-3 lg:col-span-2 2xl:col-span-1">
            <p className="mb-2 text-[13px] font-bold">Platform-wise performance</p>
            {/* Pressing a platform chip narrows the two tables and leaves this
                panel whole, which read as a dead control. It is not: comparing
                the apps IS this panel's job, and a one-row comparison is no
                comparison. So it says which it is. */}
            {platform !== 'all' && (
              <p className="mb-2 text-[10.5px] leading-relaxed text-ink-3">
                Every app, for comparison — this panel ignores the {platform} filter.
              </p>
            )}
            {panel.length === 0 ? (
              <p className="text-xs leading-relaxed text-ink-3">Nothing measured yet.</p>
            ) : (
              <div className="grid grid-cols-[max-content_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 gap-y-4 pt-1 sm:gap-x-4 2xl:gap-y-5">
                {/* The reference's muted header row — sentence case, like every
                    other label in this app (the reference Title-Cases it;
                    flagged rather than silently splitting the convention). */}
                <span
                  className="cursor-help self-end text-[11px] leading-tight text-ink-3"
                  title="Every tracked app, in the dashboard's fixed order — never re-ranked by value."
                >
                  Platform
                </span>
                <span
                  className="cursor-help self-end text-[11px] leading-tight text-ink-3"
                  title="The average engagement of each app's stronger half of posts in this window. Judged on the figure each app publishes."
                >
                  Top posts
                  <span className="block">(avg engagement)</span>
                </span>
                <span
                  className="cursor-help self-end text-[11px] leading-tight text-ink-3"
                  title="The average engagement of each app's weaker half of posts in this window. Judged on the figure each app publishes."
                >
                  Underperforming
                  <span className="block">(avg engagement)</span>
                </span>

                {panel.map((p, i) => (
                  <Fragment key={p.platform}>
                    <span
                      className="inline-flex cursor-help"
                      title={`${p.platform} — ${p.posts} post${p.posts === 1 ? '' : 's'} in this window. Rows keep the dashboard's fixed platform order, not a ranking.`}
                      aria-label={p.platform}
                    >
                      <PlatformBadge platform={p.platform} size={20} />
                    </span>
                    <PanelCellView
                      cell={p.top}
                      tone="pos"
                      max={maxTop}
                      mounted={barsMounted}
                      delay={i * 60}
                    />
                    <PanelCellView
                      cell={p.bottom}
                      tone="neg"
                      max={maxBottom}
                      mounted={barsMounted}
                      delay={i * 60}
                    />
                    {/*
                        THE MARKS ARE NAMED NOW, NOT JUST DRAWN.
                        The office asked for the words: an emoji alone is a
                        rebus, and it was also the ONLY label these figures
                        had — the explanation lived in a `title`, which a
                        screen reader never announces and a touch device
                        cannot reach, so the row read aloud as "thumbs up sign
                        12.4K". The word is real text; the mark stays beside it
                        as the quick visual key it always was.

                        ONE NOUN PER CONCEPT, ON EVERY PLATFORM. X and
                        LinkedIn say "reposts", Facebook says "shares", and
                        this panel's whole job is comparing the apps to each
                        other — five words down one column would make that
                        harder, not clearer. The platform's own term goes in
                        the hover instead.

                        A figure the app does not publish is absent, never
                        zero: Instagram's grid carries no share or view count,
                        and YouTube publishes no shares — though a stored
                        reading can fill either in, so the absences are not
                        fixed per platform.

                        ONE LINE, NEVER WRAPPED. The office asked for these
                        on a single line and they are right: wrapped, the rows
                        broke at different points per platform — Instagram on
                        one line, X on two — so nothing lined up down the
                        column and each platform's block was a different
                        height. `flex-nowrap` guarantees the line; the panel's
                        own track was widened to hold it (see the grid on the
                        card), because naming the figures costs about 80px
                        that the emoji alone did not. */}
                    <p className="col-span-3 -mt-3 flex flex-nowrap items-center gap-x-2 pl-7 text-[9.5px] text-ink-3">
                      {p.likes != null && (
                        <span
                          className="tnum whitespace-nowrap"
                          title={
                            p.platform === 'Facebook' || p.platform === 'LinkedIn'
                              ? `${p.platform} publishes a reaction total here — every reaction type, not likes alone. Summed over the posts that published one.`
                              : 'Likes, as published. Summed over the posts that published a figure.'
                          }
                        >
                          👍 {compact(p.likes)} <span className="text-ink-3">{unit(p.likes, 'likes')}</span>
                        </span>
                      )}
                      {p.comments != null && (
                        <span className="tnum whitespace-nowrap" title="Comments, as published. Summed over the posts that published a figure — not every post in the row's count.">
                          💬 {compact(p.comments)} <span className="text-ink-3">{unit(p.comments, 'comments')}</span>
                        </span>
                      )}
                      {p.shares != null && (
                        <span
                          className="tnum whitespace-nowrap"
                          title="Shares, as published, over the posts that published a figure. X and LinkedIn call these reposts."
                        >
                          🔁 {compact(p.shares)} <span className="text-ink-3">{unit(p.shares, 'shares')}</span>
                        </span>
                      )}
                      {p.views != null && (
                        <span
                          className="tnum whitespace-nowrap"
                          title="Views, as published, over the posts that published a figure. Not impressions — one person can account for several."
                        >
                          ▶ {compact(p.views)} <span className="text-ink-3">{unit(p.views, 'views')}</span>
                        </span>
                      )}
                    </p>
                  </Fragment>
                ))}
              </div>
            )}
            {/* The reference closes on a "View detailed platform report →"
                link. No such report screen exists in this app, and a dead
                link is worse than none — so the panel ends on its last row. */}
          </div>
        </div>
      )}

    </Card>
  )
}
