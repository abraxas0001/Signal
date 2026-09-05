import { useCallback, useMemo, useState } from 'react'
import { useBackToDismiss } from '@/lib/nav-history'
import { ArrowRight } from 'lucide-react'
import type { Report } from '@shared/types'
import type { Sentiment } from '@shared/taxonomy'
import { Card } from '../ui'
import { DonutBreakdown, LineChart, PlatformBadge } from '@/components/kit'
import { InfoMark, WindowPicker } from './controls'
import {
  inWindow,
  presentAnchor,
  sameWindowNote,
  windowLabel,
  windowStart,
  type WindowId,
} from '@/lib/window'
import { readStandingCache, type TrackedHandle } from '@/lib/handles'
import { absoluteDate, cleanQuote, cn } from '@/lib/utils'

/**
 * "Sentiment Overview" — the left card of the reference design's second row.
 *
 * ONE POPULATION, AND THE CARD SAYS WHICH. Every figure here is counted from
 * the comments this desk holds word for word under its own posts: the donut is
 * their three way split, the "why" chips are the reasons those same comments
 * gave, and the quotes are those same comments. The trend below is about the
 * POSTS and says so on its own mark.
 *
 * IT USED TO BE TWO POPULATIONS SIDE BY SIDE, AND THEY DISAGREED IN PUBLIC.
 * The donut came from the account surveys, which walk an account in bulk and
 * return three counts; the chips beside it were counted from the side stored
 * on each comment. On the Facebook tab of the demo desk that drew a 0%
 * Negative donut next to chips built from eight negative comments, and then
 * printed "No comment has been read on this side yet" directly under those
 * chips, because the survey's own criticism list happened to be empty. Three
 * statements about the same thing on one card, no two of them agreeing.
 *
 * The per comment sides are the better source and the card is now drawn from
 * them alone: they exist for every comment classify-comments.ts has read, they
 * carry the REASON as well as the side, and each one can be traced back to the
 * comment and the post it came from. The surveys read more comments than the
 * desk stores whole, so what they counted is named on the header's mark and
 * left out of the split rather than mixed into it.
 */

/** One comment held word for word under an own post, and what was read from it. */
/** How one comment was read. Lowercase, as the readings themselves store it. */
type CommentSide = 'positive' | 'neutral' | 'negative'

interface ReadComment {
  text: string
  platform: TrackedHandle['platform']
  /**
   * The side read on this ONE comment, or null when no reading has scored it.
   *
   * Null is never folded into neutral. A comment nobody has read is a comment
   * nobody has read, and the header says how many of those are stored.
   */
  side: CommentSide | null
  /** The reason it gave, in two to four words, or null where it gave none. */
  theme: string | null
  postUrl: string
  /**
   * The date the POST this comment sits under was published, ISO, or null
   * where the platform published none.
   *
   * NOT the comment's own date, deliberately. `Comment.publishedAt` is stored
   * for only some comments, so windowing on it would silently drop a third of
   * the evidence and leave the donut counting a different set from the trend
   * beside it. The post's date is already the trend's key, it resolves for
   * every comment the demo desk holds, and using it here puts both halves of
   * the card on ONE population — which is the guarantee this file exists for.
   */
  postedAt: string | null
}

/** One point on the trend: the post behind it, and how it was read. */
interface TrendRow {
  at: string
  label: Sentiment
  url: string
  title: string
  why: string
  score: number | null
  comments: number
  /**
   * The sides of THIS post's comments, which is what the trend is drawn from.
   *
   * WHY THE LINE IS NOT DRAWN FROM `label`. It was, and the card contradicted
   * itself in front of the office: the block on the left said "No comment
   * under your Twitter/X posts published in this window has been read as
   * positive" while the chart beside it ran a green line to 100% — because
   * the two halves were counting different things. `label` is the reading of
   * a POST taken as a whole; the block, the donut and every figure above
   * count COMMENTS one by one. A post can be read positive overall without
   * any single comment under it being filed as positive, so both statements
   * were true and together they were nonsense.
   *
   * One card, one population. The trend now counts the same comments the rest
   * of the card counts, so a side that is absent from the block is absent
   * from the line by construction.
   */
  sides: CommentSide[]
}

type Side = 'Positive' | 'Neutral' | 'Negative'

/** One tab's worth of the card: the split, the reasons and the comments. */
interface Slice {
  /** Shares of the comments that carry a side. Never of the ones that do not. */
  positive: number
  neutral: number
  negative: number
  counts: Record<Side, number>
  /** Comments a reading has put on a side, which every percentage is over. */
  scored: number
  /** Comments held whole that no reading has scored. Stated, never counted. */
  unread: number
  /** Own posts those scored comments sit under. */
  posts: number
  quotes: Record<Side, ReadComment[]>
  chips: Record<Side, { term: string; count: number }[]>
}

/**
 * Two rows under one post that are the same comment stored twice.
 *
 * The scraper merges its cleaned collection with the raw browser one, and the
 * merge key missed every pair that differed only by a trailing "See
 * translation", an emoji, a lost newline or a truncation. Seventeen comments
 * were stored twice, and because a chip counted ROWS, "women safety (2)" and
 * "land grabbing (2)" were each one person counted twice, under a hover
 * reading "2 comments on this side were read as being about women safety".
 *
 * Two rows are the same comment when they sit under the same post and their
 * words agree over the first forty characters once spacing and case are taken
 * out, UNLESS both carry a name and the names differ. That last clause is what
 * keeps two people who posted the same boilerplate under one post counted as
 * the two commenters they are.
 */
const identityOf = (text: string): string =>
  text.replace(/\s+/gu, '').toLowerCase().slice(0, 40)

/**
 * A stored date normalised to ISO, or null when there is no readable date.
 *
 * WHY NORMALISING IS NOT OPTIONAL HERE. The window compares date strings
 * lexicographically, and seventy-eight of this desk's stored snapshots carry
 * Twitter's own format — "Wed Aug 26 11:23:57 +0000 2026". "W" sorts above
 * "2", so an unnormalised post from 2023 would pass EVERY window as though it
 * were from this week, and the card would state a figure for a period the post
 * is not in. Parsing it once, here, also puts the trend's sort, its year test
 * and the opened point's date on real dates rather than on string order.
 *
 * An unparseable date is null, never today: "not published" and "published" do
 * not get to read the same.
 */
const isoOf = (raw: string | null | undefined): string | null => {
  const t = Date.parse(raw ?? '')
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** Every comment held whole under these accounts' posts, each counted once. */
function readCommentsOf(
  handles: TrackedHandle[],
  reports: Map<string, Report> | null,
): ReadComment[] {
  const out: ReadComment[] = []
  /** post + opening words, against the name on the copy already kept. */
  const kept = new Map<string, string>()
  for (const h of handles) {
    for (const post of h.snapshots.at(-1)?.posts ?? []) {
      const report = reports?.get(post.url)
      /* Resolved once per post rather than once per comment, and with the very
         fallback the trend uses — half the Instagram posts carry no date in the
         scrape, and the report's own snapshot date is what stands in — so the
         donut and the trend cannot end up windowed on two different dates. */
      const postedAt = isoOf(post.publishedAt) ?? isoOf(report?.snapshot.publishedAt)
      for (const c of report?.snapshot.comments ?? []) {
        /* A "comment" that was only Facebook's Like and Reply row cleans to
           nothing. It was never a comment, so it is not counted as one. */
        const text = cleanQuote(c.text ?? '')
        if (!text) continue
        const key = `${post.url}\n${identityOf(text)}`
        const author = (c.author ?? '').trim().toLowerCase()
        const first = kept.get(key)
        if (first !== undefined && (first === '' || author === '' || first === author)) continue
        if (first === undefined) kept.set(key, author)
        out.push({
          text,
          platform: h.platform,
          side: c.side ?? null,
          theme: (c.theme ?? '').trim() || null,
          postUrl: post.url,
          postedAt,
        })
      }
    }
  }
  return out
}

/**
 * The reasons one side gave, counted over comments rather than over rows.
 *
 * The number on a chip is how many separate comments carried that reason, so
 * a chip cannot claim two until two different comments gave it.
 */
function themesOf(comments: ReadComment[]): { term: string; count: number }[] {
  const tally = new Map<string, number>()
  for (const c of comments) {
    if (!c.theme) continue
    tally.set(c.theme, (tally.get(c.theme) ?? 0) + 1)
  }
  return [...tally.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, 5)
}

function sliceOf(comments: ReadComment[]): Slice {
  const on = (side: ReadComment['side']): ReadComment[] => comments.filter((c) => c.side === side)
  const quotes = { Positive: on('positive'), Neutral: on('neutral'), Negative: on('negative') }
  const scored = quotes.Positive.length + quotes.Neutral.length + quotes.Negative.length
  /* Over the comments that carry a side, never over every stored comment: an
     unread comment is not a neutral one, and dividing by it would quietly
     shrink all three shares to make room for a reading nobody has made. */
  const pct = (n: number): number => (scored > 0 ? Math.round((n / scored) * 100) : 0)
  return {
    positive: pct(quotes.Positive.length),
    neutral: pct(quotes.Neutral.length),
    negative: pct(quotes.Negative.length),
    counts: {
      Positive: quotes.Positive.length,
      Neutral: quotes.Neutral.length,
      Negative: quotes.Negative.length,
    },
    scored,
    unread: comments.length - scored,
    posts: new Set(comments.filter((c) => c.side).map((c) => c.postUrl)).size,
    quotes,
    chips: {
      Positive: themesOf(quotes.Positive),
      Neutral: themesOf(quotes.Neutral),
      Negative: themesOf(quotes.Negative),
    },
  }
}

/**
 * One side of the reading, answered with the comments themselves.
 *
 * THIS WAS KEYWORD CHIPS AND THEY COULD NOT WORK. The chips were the words
 * that recur across the comments on a side, and after three rounds of
 * cleaning — slogans out, kinship terms out, the desk's own names out, words
 * used by both camps out — what survived was still "women / minister /
 * national / president" for praise and "telangana / leaders" for criticism.
 * The office's verdict was exact: nobody can conclude anything from that.
 *
 * They are right, and the reason is structural rather than a tuning problem.
 * A word count over a hundred and fifty comments finds the SUBJECTS people
 * mention, never the REASONS they approve or object — "minister" is who she
 * is, not what anyone thinks of her. The reference sheet's "Good work (1.2K)"
 * comes from a corpus of thousands where a judgement phrase genuinely recurs;
 * at this desk's volume no judgement repeats often enough to count.
 *
 * What the desk does hold, per side, is the comments a reading actually put
 * there. Those are real, they are quoted verbatim, and a person can read three
 * of them and know why the side reads the way it does — which is the whole
 * job. So the comments are the answer, and the word count is gone.
 */
function WhyBlock({
  title,
  tone,
  chips,
  quotes,
  linkLabel,
  onOpenAll,
  empty,
}: {
  title: string
  tone: 'positive' | 'negative' | 'neutral'
  /** Reasons read out of the comments on this side, with how many gave each. */
  chips: { term: string; count: number }[]
  /*
   * The very comments the chips were counted over, so the block cannot
   * contradict itself. Chips and quotes are two views of one list now: a side
   * showing chips has comments to show, and the empty line below can only
   * appear when the side is genuinely empty. It used to be reachable with
   * chips above it, because the chips were counted from the stored comments
   * and the quotes came from the account survey's own list.
   */
  quotes: ReadComment[]
  linkLabel: string
  onOpenAll: () => void
  empty: string
}) {
  const skin =
    tone === 'positive'
      ? { fill: 'var(--pos-soft)', text: 'var(--pos)' }
      : tone === 'negative'
        ? { fill: 'var(--neg-soft)', text: 'var(--neg)' }
        : { fill: 'var(--warn-soft)', text: 'var(--warn)' }

  return (
    <div className="min-w-0">
      <p className="text-[15px] font-bold tracking-[-0.01em] text-ink">{title}</p>

      {/*
       * THE REASONS, READ RATHER THAN COUNTED.
       *
       * These chips were tried three times as a word count and failed three
       * times, always the same way: minister, gadwal, telangana, bjp, kishan
       * reddy, and finally her own name in Telugu. That was never a tuning
       * problem. A frequency count over comments written TO a politician
       * finds who they are and where they live, because that is what people
       * type; the judgement sits in the sentence, not in any word that
       * repeats across sentences.
       *
       * So the phrase is read out of each comment instead of counted across
       * them. classify-comments.ts asks what the comment is about and takes
       * a two-to-four word answer in the reader's own register, refusing any
       * answer that is only a person, a place or a party. What arrives is
       * "land encroachment", "railway connectivity", "development work" -
       * reasons, which is what the heading above promised all along.
       *
       * The number is comments carrying that reason, counted over comments
       * and not over stored rows: a comment the scraper filed twice is one
       * commenter and votes once. A side whose comments gave no reason shows
       * no chips and lets the comments speak.
       */}
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c.term}
              className="inline-flex items-center gap-1 rounded-[7px] px-2 py-1 text-[11.5px] font-semibold capitalize"
              style={{ background: skin.fill, color: skin.text }}
              title={
                c.count === 1
                  ? `One comment on this side was read as being about ${c.term}`
                  : `${c.count} separate comments on this side were read as being about ${c.term}`
              }
            >
              {c.term}
              <span className="tnum opacity-70">({c.count})</span>
            </span>
          ))}
        </div>
      )}

      {quotes.length > 0 ? (
        <>
          <ul className="mt-2 space-y-1.5">
            {quotes.slice(0, 3).map((q, i) => (
              <li
                /* Keyed by position, not by text: two people under two posts
                   do write the same three words, and React was handed the
                   same key twice for two real comments. */
                key={`${q.postUrl}-${i}`}
                className="flex items-start gap-2 rounded-[8px] px-2 py-1.5"
                style={{ background: skin.fill }}
              >
                <PlatformBadge platform={q.platform} size={14} className="mt-0.5 shrink-0" />
                <span className="min-w-0 text-[11.5px] leading-relaxed" style={{ color: skin.text }}>
                  &ldquo;{q.text.length > 130 ? `${q.text.slice(0, 130)}…` : q.text}&rdquo;
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onOpenAll}
            className="mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--accent)]"
          >
            {linkLabel}
            <ArrowRight size={13} aria-hidden />
          </button>
        </>
      ) : (
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">{empty}</p>
      )}
    </div>
  )
}

export function SentimentOverview({
  handles,
  reports,
  onOpenAccounts,
  onOpenAudience,
}: {
  /** The desk's OWN accounts. Watched accounts are somebody else's audience. */
  handles: TrackedHandle[]
  /** Full reports by post url; null while they are still loading. */
  reports: Map<string, Report> | null
  onOpenAccounts: () => void
  /** The screen that breaks the reading down platform by platform. */
  onOpenAudience: () => void
}) {
  /** Every comment held whole under this desk's own posts, each counted once. */
  const held = useMemo(() => readCommentsOf(handles, reports), [handles, reports])

  /** Which platform tab the reader pressed. What the card USES is derived. */
  const [picked, setPicked] = useState<string>('overall')

  /**
   * THE WINDOW GOVERNS THE WHOLE CARD, NOT ONLY THE TREND.
   *
   * A "Last 10 / 20 / 50 posts" select used to sit beside the trend's title and
   * cut the trend alone. Everything else on the card — the donut, the legend,
   * "where it came from", both "why" blocks, the header count — was a lifetime
   * figure sitting under a control that looked like it governed them. The
   * office asked for a time window instead, and for the section to answer to
   * it, so the control moved to the card header where a section-level control
   * belongs and every figure below is now counted inside the window.
   *
   * Local state, as ContentInsights and FollowerGrowth hold theirs, so the
   * briefing that mounts this card needs no change. Counted back from NOW: a
   * desk not read this week says the week is empty rather than sliding the
   * window to wherever the data happens to be.
   */
  const [window, setWindow] = useState<WindowId>('month')
  const anchor = presentAnchor()
  const start = windowStart(anchor, window)
  /** "6 Aug 2026 – 5 Sep 2026", the resolved range, named wherever it applies. */
  const range = windowLabel(anchor, window).replace(' to ', ' – ')

  /** Every held comment whose post was published inside the window. */
  const windowed = useMemo(() => held.filter((c) => inWindow(c.postedAt, start)), [held, start])

  /* The platforms that have comments IN THIS WINDOW, biggest first. A platform
     whose account was surveyed but whose posts hold no stored comment here gets
     no tab, because the tab would open on an empty card — this card's own rule
     from the start, and a narrow window is what makes it bite again. */
  const tabs = useMemo(() => {
    const perPlatform = new Map<string, number>()
    for (const c of windowed) perPlatform.set(c.platform, (perPlatform.get(c.platform) ?? 0) + 1)
    return [
      { id: 'overall', label: 'Overall' },
      ...[...perPlatform.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([pl]) => ({ id: pl, label: pl })),
    ]
  }, [windowed])

  /* Derived from the tab list rather than corrected by an effect: narrowing the
     window can take the pressed platform's tab away, and a stale selection
     would strand the reader on an empty card with no tab lit. Overall is where
     the card falls back to, on the same render, with no flash of nothing. */
  const tab = tabs.some((t) => t.id === picked) ? picked : 'overall'

  const shown = useMemo(
    () => (tab === 'overall' ? windowed : windowed.filter((c) => c.platform === tab)),
    [windowed, tab],
  )
  const slice = useMemo(() => sliceOf(shown), [shown])

  /**
   * What this window does NOT reach, counted rather than assumed.
   *
   * Two different absences, and the card must not fold them together. `older`
   * is held comments under posts published before the cutoff — a wider window
   * reaches those. `undated` is held comments under posts the platform
   * published no date for at all: `inWindow` refuses an undated thing whenever
   * a cutoff exists, so NO window on offer can hold them, and saying "widen the
   * window" about those would be false. It is 0 on this demo desk and 42% of
   * tracked posts carry no date repo-wide, so it is counted, never assumed.
   */
  const outOfWindow = useMemo(() => {
    let older = 0
    let undated = 0
    let scoped = 0
    for (const c of held) {
      if (tab !== 'overall' && c.platform !== tab) continue
      scoped += 1
      if (c.postedAt === null) undated += 1
      else if (!inWindow(c.postedAt, start)) older += 1
    }
    return { older, undated, scoped }
  }, [held, tab, start])

  /** The earliest post date this card actually counted, ISO or null. */
  const oldestCounted = useMemo(() => {
    let out: string | null = null
    for (const c of shown) if (c.postedAt && (out === null || c.postedAt < out)) out = c.postedAt
    return out
  }, [shown])

  /**
   * What the account surveys counted, named but never drawn.
   *
   * A survey walks the account itself and returns three totals over comments
   * this desk never stored, so it reaches further than this card can: 280
   * comments against the 183 held whole on the demo desk. That is worth
   * saying, because the audience card is drawn from it and a reader comparing
   * the two would otherwise be looking at two numbers with no way to tell why
   * they differ. It is said on the header's mark and kept out of the split.
   */
  const surveyed = useMemo(() => {
    let counted = 0
    for (const h of handles) {
      if (tab !== 'overall' && h.platform !== tab) continue
      const standing = readStandingCache(h.id)
      if (standing && standing.source !== 'record') counted += standing.commentsRead
    }
    return counted
  }, [handles, tab])

  /** Which side the donut's centre reads out, and which "why" leads. */
  const [side, setSide] = useState<Side>('Positive')

  /**
   * The comments a side answers with, the ones that gave a reason first.
   *
   * Three of them are shown and the block is headed "why", so a comment that
   * recorded WHY it reads the way it does is the more useful one to lead
   * with. Everything else keeps the order it was stored in.
   */
  const answering = (which: Side): ReadComment[] =>
    [...slice.quotes[which]].sort(
      (a, b) => (b.theme ? 1 : 0) - (a.theme ? 1 : 0),
    )

  /**
   * EVERY SIDE ANSWERS THE SAME QUESTION, INCLUDING NEUTRAL.
   *
   * The card used to pin one block to "why positive" and the other to "why
   * negative", so the largest side on most desks - neutral, by a wide margin -
   * had no explanation anywhere, and selecting it in the legend changed only
   * a number. The reader's selection now leads: whichever side they pick is
   * the block that answers first, and the block beneath it carries the side
   * that most contrasts with it, so the comparison the reference draws is
   * still on the page.
   */
  const whyOf = (
    which: Side,
  ): {
    title: string
    tone: 'positive' | 'negative' | 'neutral'
    chips: { term: string; count: number }[]
    quotes: ReadComment[]
    linkLabel: string
    empty: string
  } => {
    /* One sentence for all three sides, and it is now a statement about this
       card's own population rather than about the surveys. The neutral block
       used to say the readings never quote neutral comments; they are quoted
       here like any other, because the card holds them. */
    /* The window clause is not decoration. Without it a quiet week would have
       this card assert a desk-wide absence that is false — "no comment has ever
       been read as positive" — when what is true is only that none was read as
       positive under a post published in the window the reader chose. */
    const empty = `No comment under ${
      tab === 'overall' ? 'your posts' : `your ${tab} posts`
    } published in this window has been read as ${which.toLowerCase()}.`
    if (which === 'Positive') {
      return {
        title: 'Why the positive comments were positive',
        tone: 'positive',
        chips: slice.chips.Positive,
        quotes: answering('Positive'),
        linkLabel: 'See all positive comments',
        empty,
      }
    }
    if (which === 'Negative') {
      return {
        title: 'Why the negative comments were negative',
        tone: 'negative',
        chips: slice.chips.Negative,
        quotes: answering('Negative'),
        linkLabel: 'See all negative comments',
        empty,
      }
    }
    return {
      title: 'Why the neutral comments were neutral',
      tone: 'neutral',
      chips: slice.chips.Neutral,
      quotes: answering('Neutral'),
      linkLabel: 'See all neutral comments',
      empty,
    }
  }

  /**
   * WHERE THE SELECTED SIDE ACTUALLY COMES FROM.
   *
   * The space beside the legend was empty, and pressing a side moved only the
   * donut's centre figure. This fills it with the two things the desk holds
   * about a side that the "why" block beside it does not say: which of your
   * accounts it is on, and which single post drew the most of it.
   *
   * It is counted, never composed. Every figure here is a tally of the comments
   * already on this card — the same set the ring is drawn over — so pressing
   * Negative and reading "13 of 21 on Instagram" is a fact the office can check
   * against the list, not a sentence a model wrote about them.
   */
  const sideDetail = useMemo(() => {
    const mine = shown.filter((c) => c.side === side.toLowerCase())
    if (mine.length === 0) return null
    const byPlatform = new Map<string, number>()
    const byPost = new Map<string, number>()
    for (const c of mine) {
      byPlatform.set(c.platform, (byPlatform.get(c.platform) ?? 0) + 1)
      if (c.postUrl) byPost.set(c.postUrl, (byPost.get(c.postUrl) ?? 0) + 1)
    }
    const platforms = [...byPlatform.entries()].sort((a, b) => b[1] - a[1])
    const top = [...byPost.entries()].sort((a, b) => b[1] - a[1])[0] ?? null
    /**
     * THE POST'S OWN TWO DENOMINATORS, BECAUSE "5 COMMENTS" WAS READ AS THE
     * POST HAVING FIVE.
     *
     * The office opened the busiest post and found twenty-eight. Both numbers
     * were right and the label named neither: five is how many comments on the
     * SELECTED SIDE sit under that post, eighteen is how many the desk holds
     * from it, and twenty-eight is what Instagram publishes. A count with no
     * denominator beside it will be read as the whole.
     */
    const topRead = top ? (shown.filter((c) => c.postUrl === top[0]).length || null) : null
    const topPublished = top
      ? (reports?.get(top[0])?.snapshot.engagement.comments?.value ?? null)
      : null
    return { total: mine.length, platforms, topPost: top, topRead, topPublished }
  }, [shown, side, reports])

  const leadWhy = whyOf(side)
  const foilWhy = whyOf(side === 'Negative' ? 'Positive' : 'Negative')

  /**
   * The three lines, from the posts' own recorded readings.
   *
   * WHERE THE THREE SIDES COME FROM. Every analysed post carries one sentiment
   * LABEL - Strong Positive through Strong Negative - which is a real reading
   * stored against that post. A single post is therefore all of one side, so
   * plotting each post on its own would draw three lines flicking between 0
   * and 100 and would tell an office nothing. Each point is instead the share
   * of the last few posts that read each way, which is what makes the shape
   * legible while every number behind it stays counted rather than modelled.
   *
   * WHAT THIS IS NOT. It is not the three-way split of the COMMENTS, which is
   * the donut above and is counted comment by comment. A post carries one
   * label, so these lines can only ever say what share of the posts read each
   * way. They are about the posts, which is what this trend always plotted: it
   * simply plotted the score before, and the sides now. Posts nobody commented
   * on are not points on it, because their label was read from the post's own
   * words rather than from anybody's reply.
   */
  const trend = useMemo(() => {
    const posts = handles
      .filter((h) => tab === 'overall' || h.platform === tab)
      .flatMap((h) => h.snapshots.at(-1)?.posts ?? [])

    /* The very comments the rest of the card is counting, gathered under the
       post they sit beneath. `shown` is already cut to this platform and this
       window, so the line cannot be drawn over a wider set than the block
       beside it — which is exactly how the two came to disagree. */
    const sidesByPost = new Map<string, CommentSide[]>()
    for (const c of shown) {
      if (!c.side) continue
      const held = sidesByPost.get(c.postUrl)
      if (held) held.push(c.side)
      else sidesByPost.set(c.postUrl, [c.side])
    }

    const rows = posts
      .map((p) => {
        const report = reports?.get(p.url)
        // A report whose analysis never came back scores nothing; it is not a
        // zero on the trend, it is simply not a point on it. The DATE falls
        // back to the report's own snapshot - half the Instagram posts carry
        // no date in the scrape, and dropping them flattened a ten-point
        // trend to two.
        // Normalised, so the window's comparison, the sort below, the year
        // test and the opened point's date all run on a real date rather than
        // on Twitter's "Wed Aug 26 ..." sorting above every ISO string.
        const at = isoOf(p.publishedAt) ?? isoOf(report?.snapshot.publishedAt)
        /*
         * ONLY POSTS THE AUDIENCE ANSWERED.
         *
         * A reading made with no comments in front of it scores the post's
         * own words, and this line plotted those beside readings made from
         * hundreds of replies as though they measured the same thing. They do
         * not: one is how people reacted, the other is how the post was
         * written. A post nobody commented on is not a low point on the
         * trend, it is not a point on it at all.
         */
        /* Not "has comments" but "has comments that were READ for a side".
           A post whose comments are all unscored contributes no numerator and
           no denominator, so it is not a point — the same rule the donut
           applies, applied here. */
        const sides = sidesByPost.get(p.url) ?? []
        const answered = sides.length > 0
        const label = answered ? (report?.analysis?.sentiment.label ?? null) : null
        /* The point carries its post, so the chart can say what happened on
           that day rather than only what share of posts read which way. */
        return label && at
          ? {
              at,
              label,
              url: p.url,
              title: (p.title ?? report?.analysis?.headline ?? '').trim(),
              why: (report?.analysis?.sentiment.rationale ?? '').trim(),
              score: report?.analysis?.sentiment.score ?? null,
              comments: report?.snapshot.comments?.length ?? 0,
              sides,
            }
          : null
      })
      .filter((r): r is TrendRow => r !== null)
      /* The window, not a count of posts. "Last 20 posts" said nothing about
         when those posts were, so the trend answered a different question from
         every figure above it; both halves of the card are now cut by the same
         dates, on the same resolved post date. */
      .filter((r) => inWindow(r.at, start))
      .sort((a, b) => a.at.localeCompare(b.at))

    if (rows.length < 2) return null

    // Wide enough to smooth a single post's swing, short enough that ten
    // points still show movement.
    const win = Math.min(5, Math.max(2, Math.ceil(rows.length / 3)))
    /**
     * The share of COMMENTS reading each way across the posts in the rolling
     * window — the same comments, counted the same way, as the donut and the
     * blocks above.
     */
    const shareAt = (i: number, side: CommentSide): number => {
      const from = Math.max(0, i - win + 1)
      const heard = rows.slice(from, i + 1).flatMap((r) => r.sides)
      if (heard.length === 0) return 0
      return Math.round((heard.filter((s) => s === side).length / heard.length) * 100)
    }

    const years = new Set(rows.map((r) => r.at.slice(0, 4)))
    return {
      labels: rows.map((r) =>
        new Date(r.at).toLocaleDateString(
          'en-IN',
          years.size > 1
            ? { day: 'numeric', month: 'short', year: '2-digit' }
            : { day: 'numeric', month: 'short' },
        ),
      ),
      series: [
        {
          name: 'Positive',
          color: 'var(--chart-pos)',
          values: rows.map((_, i) => shareAt(i, 'positive')),
        },
        {
          name: 'Neutral',
          color: 'var(--chart-mid)',
          values: rows.map((_, i) => shareAt(i, 'neutral')),
        },
        {
          name: 'Negative',
          color: 'var(--chart-neg)',
          values: rows.map((_, i) => shareAt(i, 'negative')),
        },
      ],
      count: rows.length,
      win,
      rows,
    }
  }, [handles, reports, tab, start])

  /** Which trend point the reader opened, or null for none. */
  const [openPoint, setOpenPoint] = useState<number | null>(null)
  /* System back dismisses the trend point's detail window, the way it already does for the identical
     layer on the grievance record. Without this the reader's back press left
     the whole screen instead of closing what they had opened. */
  useBackToDismiss(openPoint !== null, useCallback(() => setOpenPoint(null), []))

  /** The ring's centre states the side the reader has selected, not always Positive. */
  const sidePct =
    side === 'Positive' ? slice.positive : side === 'Neutral' ? slice.neutral : slice.negative

  if (held.length === 0) {
    return (
      <Card className="p-4 sm:p-5">
        <h2 className="text-[17px] font-bold tracking-[-0.015em]">Sentiment overview</h2>
        <p className="mt-0.5 text-xs text-ink-3">From the comments under your posts</p>
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          No comment is stored under your posts yet, so there is nothing here to break down.
          Analysing a post is what stores the comments on it.
        </p>
        {/* The surveys are named even here. A desk that has run one has read
            comments, and telling it that none have been read would be false. */}
        {surveyed > 0 && (
          <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
            Your account surveys have counted {surveyed.toLocaleString('en-IN')} comments in bulk.
            That count is on the audience card; it carries no comment this card could quote or
            give a reason for.
          </p>
        )}
        <button
          type="button"
          onClick={onOpenAccounts}
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--accent)]"
        >
          Open your accounts
          <ArrowRight size={14} aria-hidden />
        </button>
      </Card>
    )
  }

  /*
   * EVERY EXCLUSION, SAID IN ONE PLACE AND COUNTED.
   *
   * House doctrine puts explanation in the hover, so this is where the window's
   * costs are stated rather than on screen: the comments stored but unread, the
   * ones under posts older than the cutoff, the ones under posts carrying no
   * date that no window can hold, and the account surveys' bulk figure — which
   * has one readAt for the whole account and no per-comment dates behind it, so
   * cutting it to a window would be arithmetic on an undated number. It stays
   * whole and is labelled as the lifetime read it is.
   */
  const sameNote = sameWindowNote(oldestCounted, window)
  const headerNote =
    (shown.length === 0
      ? `No comment this desk holds sits under a post published ${range}.`
      : `Counted from the ${shown.length.toLocaleString('en-IN')} comments stored word for word under your posts published ${range}, ${slice.scored.toLocaleString('en-IN')} of which carry a side.`) +
    (slice.unread > 0
      ? ` The other ${slice.unread.toLocaleString('en-IN')} are stored but unread, so they are not in this split — an unread comment is not a neutral one.`
      : '') +
    (outOfWindow.older > 0
      ? ` A further ${outOfWindow.older.toLocaleString('en-IN')} held comments sit under posts published before this window; a wider window reaches them.`
      : '') +
    (outOfWindow.undated > 0
      ? ` ${outOfWindow.undated.toLocaleString('en-IN')} more sit under posts the platform published no date for, so no window on offer can hold them.`
      : '') +
    (sameNote ? ` ${sameNote}` : '') +
    (surveyed > 0
      ? ` Your account surveys counted ${surveyed.toLocaleString('en-IN')} separately, in bulk across the whole account: they carry one reading date and no per-comment dates, so no window cuts that figure. That wider read is on the audience card.`
      : '')

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[19px] font-bold tracking-[-0.018em]">Sentiment overview</h2>
          <p className="mt-0.5 flex items-center gap-1 text-[13px] text-ink-3">
            {/* The header states the set the card is drawn from. With nothing
                scored there is no such set yet, and "from 0 comments under 0
                of your posts" would read as a measurement rather than as work
                not yet done. */}
            {/* THE POST COUNT IS GONE FROM THE HEADING, DELIBERATELY.
                It read "under 41 of your posts", and the office's next question
                was the one the number invites and cannot answer in place: why
                41 and not all of them. The answer is long — a post earns a
                place here by having had its comments read, which depends on
                what each platform served — and it belongs behind the mark, not
                in the line. What the line states is the thing the donut is
                actually drawn over: the comments. */}
            {/* The range is named on the line itself, not left to the picker
                beside it. A count with no period against it will be read as a
                lifetime figure, which is exactly what these numbers stopped
                being the moment the window started governing them. */}
            <span>
              {shown.length === 0
                ? 'No comment under a post published in this window'
                : slice.scored > 0
                  ? `From ${slice.scored.toLocaleString('en-IN')} comments read one by one`
                  : `${shown.length.toLocaleString('en-IN')} comments stored, none read for a side yet`}
              {' · '}
              {range}
            </span>
            <InfoMark note={headerNote} />
          </p>
        </div>
        {/* The control governs the SECTION, so it sits on the section's header
            rather than beside the trend's title, where its predecessor made a
            promise it only kept for one chart. */}
        <WindowPicker value={window} onChange={setWindow} options={['week', 'month', 'half']} />
      </div>

      {/* The reference's segmented control: one grey track holding an
          "Overall" pill and then the platform marks as buttons, no text
          labels beside them. */}
      <div className="mt-3 flex w-full items-center gap-1 rounded-[10px] bg-[var(--surface-3)] p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setPicked(t.id)}
            aria-pressed={tab === t.id}
            title={t.label}
            aria-label={t.label}
            className={cn(
              'inline-flex h-9 items-center justify-center gap-1.5 rounded-[7px] border text-xs font-semibold transition-colors',
              // "Overall" sizes to its word; the marks share what is left, so
              // the track fills the row as the reference's does instead of
              // huddling at the left edge.
              t.id === 'overall' ? 'shrink-0 px-3.5' : 'min-w-0 flex-1',
              tab === t.id
                ? 'border-[color-mix(in_oklab,var(--accent)_55%,transparent)] bg-[var(--surface)] text-[var(--accent)] shadow-[var(--e1)]'
                : 'border-transparent text-ink-2 hover:bg-[color-mix(in_oklab,var(--surface)_60%,transparent)]',
            )}
          >
            {t.id === 'overall' ? t.label : <PlatformBadge platform={t.id} size={22} />}
          </button>
        ))}
      </div>

      {/* ── upper half: the donut, and why the positive comments were positive
          The reference lays the card out as four quadrants divided by
          hairlines rather than as stacked bands, so the donut reads against
          the praise beside it and the complaints read against the trend. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,197fr)_minmax(0,134fr)] sm:gap-0">
        <div className="flex flex-nowrap items-center gap-3 sm:pr-4">
          {/*
            NOTHING SCORED IS NOT A ZERO SPLIT.

            A tab whose comments are all stored but none yet read would draw
            0% / 0% / 0% and a ring of three empty arcs, which reads as "we
            looked and found nothing on any side". The desk has not looked.
          */}
          {/*
            TWO DIFFERENT ABSENCES, AND THEY DO NOT GET THE SAME SENTENCE.

            "No comment here" and "comments here, none read" are separate facts.
            Folded together, an empty week printed "None of the 0 comments
            stored under these posts has been read for a side yet", which is
            nonsense, and it blamed the reading for what the filter did.
          */}
          {shown.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              No comment sits under a post published in this window, so there is no split to draw.
              The desk holds {outOfWindow.scoped.toLocaleString('en-IN')} under posts this window
              does not reach
              {outOfWindow.older > 0
                ? ' — a wider window brings the older ones back.'
                : '; every one of them sits under a post the platform published no date for.'}
            </p>
          ) : slice.scored === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              None of the {shown.length} comments stored under posts published in this window has
              been read for a side yet, so there is no split to draw. Reading an account&rsquo;s
              opinion is what assigns positive, neutral or negative.
            </p>
          ) : (
            <>
              <DonutBreakdown
                size={150}
                thickness={22}
                segments={[
                  { label: 'Positive', value: slice.positive, color: 'var(--chart-pos)' },
                  { label: 'Neutral', value: slice.neutral, color: 'var(--chart-mid)' },
                  { label: 'Negative', value: slice.negative, color: 'var(--chart-neg)' },
                ]}
                centerLabel={`${sidePct}%`}
                centerSub={side}
                centerLabelClass="text-[27px] font-semibold tracking-[-0.02em]"
                className="shrink-0"
              />
              {/* The reference's legend: a dot, the figure, the word. Pressing one
                  swings the donut's centre to that side, which is the only thing
                  the selection still drives now that both "why" blocks are up at
                  once instead of taking turns in one panel. */}
              <div className="grid min-w-0 shrink gap-0.5">
                {(
                  [
                    { label: 'Positive' as const, n: slice.positive, colour: 'var(--chart-pos)' },
                    { label: 'Neutral' as const, n: slice.neutral, colour: 'var(--chart-mid)' },
                    { label: 'Negative' as const, n: slice.negative, colour: 'var(--chart-neg)' },
                  ]
                ).map((seg) => (
                  <button
                    key={seg.label}
                    type="button"
                    onClick={() => setSide(seg.label)}
                    aria-pressed={side === seg.label}
                    /* The count behind the percentage, so a reader can tie the
                       ring to the chips and the quotes beside it without having
                       to work backwards from a rounded share. */
                    title={`${slice.counts[seg.label]} of the ${slice.scored} comments read one by one, under your posts published ${range}`}
                    className={cn(
                      'flex min-h-8 items-center gap-2 rounded-[8px] px-1.5 text-left transition-colors',
                      'hover:bg-[var(--surface-2)]',
                    )}
                  >
                    <span
                      aria-hidden
                      className="size-[11px] shrink-0 rounded-full"
                      style={{ background: seg.colour }}
                    />
                    <span className="tnum text-[13.5px] font-bold">{seg.n}%</span>
                    <span
                      className={cn(
                        'truncate text-[13.5px]',
                        side === seg.label ? 'font-semibold text-ink' : 'text-ink-2',
                      )}
                    >
                      {seg.label}
                    </span>
                  </button>
                ))}
              </div>

              {sideDetail && (
                <div className="hidden min-w-0 flex-1 border-l border-[var(--rule)] pl-4 lg:block">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                    Where the {side.toLowerCase()} came from
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {sideDetail.platforms.map(([name, n]) => (
                      <li key={name} className="flex items-center gap-2">
                        <PlatformBadge platform={name} size={16} />
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{name}</span>
                        <span className="tnum text-[11.5px] font-bold">{n}</span>
                        <span className="tnum w-9 shrink-0 text-right text-[10.5px] text-ink-3">
                          {Math.round((n / sideDetail.total) * 100)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                  {sideDetail.topPost && (
                    <p
                      className="mt-2 cursor-help border-t border-[var(--rule)] pt-2 text-[10.5px] leading-relaxed text-ink-3"
                      title={
                        sideDetail.topPublished != null
                          ? `${sideDetail.platforms[0]?.[0] ?? 'The platform'} publishes ${sideDetail.topPublished} comments on that post; the desk holds ${sideDetail.topRead ?? 0} of them, and ${sideDetail.topPost[1]} of those read as ${side.toLowerCase()}.`
                          : `The desk holds ${sideDetail.topRead ?? 0} comments from that post, and ${sideDetail.topPost[1]} of them read as ${side.toLowerCase()}.`
                      }
                    >
                      Most on one post:{' '}
                      <span className="font-semibold text-ink-2">
                        {sideDetail.topPost[1]} {side.toLowerCase()}
                      </span>
                      {sideDetail.topRead != null && `, of ${sideDetail.topRead} read there`}.{' '}
                      <a
                        href={sideDetail.topPost[0]}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-[var(--accent)] hover:underline"
                      >
                        Open it
                      </a>
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="sm:border-l sm:border-[var(--rule)] sm:pl-4">
          <WhyBlock
            title={leadWhy.title}
            tone={leadWhy.tone}
            chips={leadWhy.chips}
            quotes={leadWhy.quotes}
            linkLabel={leadWhy.linkLabel}
            onOpenAll={onOpenAudience}
            empty={leadWhy.empty}
          />
        </div>
      </div>

      {/* ── lower half: why the negative ones were negative, and the trend ── */}
      <div className="mt-4 grid gap-4 border-t border-[var(--rule)] pt-4 sm:grid-cols-[minmax(0,135fr)_minmax(0,194fr)] sm:gap-0">
        <div className="sm:pr-4">
          <WhyBlock
            title={foilWhy.title}
            tone={foilWhy.tone}
            chips={foilWhy.chips}
            quotes={foilWhy.quotes}
            linkLabel={foilWhy.linkLabel}
            onOpenAll={onOpenAudience}
            empty={foilWhy.empty}
          />
        </div>

        <div className="min-w-0 sm:border-l sm:border-[var(--rule)] sm:pl-4">
          {/* The "Last 10 / 20 / 50 posts" select stood here and is gone. It
              governed this chart alone while reading, beside a full card of
              lifetime figures, as though it governed all of them; the card's
              window is in the header now and cuts this chart with everything
              else. The rolling width still adapts to whatever the window
              holds, and the mark states both numbers so the smoothing is read
              against a stated total. */}
          <p className="flex items-center gap-1 text-[15px] font-bold tracking-[-0.01em] text-ink">
            Sentiment trend
            <InfoMark
              note={
                trend
                  ? `The share of posts reading each way across the ${trend.count} of your posts read in full and answered inside ${range}, taken over a rolling ${trend.win} of them so a single post does not swing the line to 0 or 100. Every post carries one recorded sentiment label; Mixed is counted with Neutral. This is about the POSTS, and only the ones the audience answered: a post with no comments was read from its own words and is not a point here. The three-way split of the COMMENTS is the donut above.`
                  : `The share of posts reading each way, once at least two of your posts published ${range} have been analysed and answered.`
              }
            />
          </p>
          {trend ? (
            <div className="mt-1">
              {/* WHY THESE LINES ARE ABOUT POSTS AND THE DONUT IS ABOUT
                  COMMENTS. A post's analysis records ONE sentiment label, not
                  a three-way split of the comments under it, so the only
                  honest series here is the share of posts reading each way.
                  The comments' own split is the donut above, counted comment
                  by comment. That caveat rides on the heading's i mark rather
                  than as a paragraph under the chart. */}
              <LineChart
                labels={trend.labels}
                series={trend.series}
                height={150}
                area={false}
                markers="hollow"
                tickCount={2}
                domain={[0, 100]}
                formatValue={(n) => (n == null ? 'NA' : `${Math.round(n)}%`)}
                /* What actually happened on that day, under the three shares.
                   A share is the shape of the week; the post is the reason. */
                pointDetail={(i) => {
                  const row = trend.rows[i]
                  if (!row) return null
                  return (
                    <div className="mt-1.5 border-t border-[var(--rule)] pt-1.5">
                      <p className="text-[11px] font-semibold text-ink">
                        {row.title || 'Untitled post'}
                      </p>
                      {/* THE SPLIT OF THIS POST'S COMMENTS, which is what the
                          line is made of. It read "Read as Positive from 2
                          comments" — the post's overall reading — beside a
                          line counting comments, so a point could say
                          Positive on a post whose comments the card had
                          filed elsewhere. */}
                      <p className="mt-0.5 text-[10.5px] text-ink-2">
                        {(() => {
                          const heard = row.sides.length
                          const pos = row.sides.filter((s) => s === 'positive').length
                          const neg = row.sides.filter((s) => s === 'negative').length
                          const neu = heard - pos - neg
                          const parts = [
                            pos > 0 ? `${pos} positive` : null,
                            neu > 0 ? `${neu} neutral` : null,
                            neg > 0 ? `${neg} negative` : null,
                          ].filter((s): s is string => s !== null)
                          return `${heard} comment${heard === 1 ? '' : 's'} read here — ${parts.join(', ')}`
                        })()}
                      </p>
                    </div>
                  )
                }}
                onPointClick={(i) => setOpenPoint(i)}
              />
            </div>
          ) : (
            /* It must name the window. Unchanged, this blamed the desk for
               having analysed too little when the real cause was often the
               filter the reader had just chosen, and it offered the one remedy
               that would not help. */
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
              A trend needs at least two of your posts published {range} read in full and answered
              by their audience. Widen the window, or open a post and press Analyse to add one.
            </p>
          )}
        </div>
      </div>

      {/* The rule above the footer spans the card's full content width, as the
          reference draws it; hanging it off the button itself made it stop
          where the words did. */}
      <div className="mt-3 border-t border-[var(--rule)] pt-1">
        <button
          type="button"
          onClick={onOpenAudience}
          className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-[var(--accent)]"
        >
          View platform-wise sentiment
          <ArrowRight size={14} aria-hidden />
        </button>
      </div>

      {/*
       * THE POINT, OPENED.
       *
       * A trend point answers "what share of posts read this way". The
       * office's question at that point is a different one: what was the
       * post, and why was it read like that. The hover gives the headline
       * and the reading; this gives the model's own rationale, the comment
       * count it worked from, and the way out to the post itself.
       */}
      {openPoint != null &&
        trend?.rows[openPoint] &&
        (() => {
          const row = trend.rows[openPoint]
          if (!row) return null
          const tone =
            row.label === 'Strong Positive' || row.label === 'Positive'
              ? { fill: 'var(--pos-soft)', text: 'var(--pos)' }
              : row.label === 'Strong Negative' || row.label === 'Negative'
                ? { fill: 'var(--neg-soft)', text: 'var(--neg)' }
                : { fill: 'var(--warn-soft)', text: 'var(--warn)' }
          return (
            <div
              className="fixed inset-0 z-50 grid place-items-center bg-[rgba(15,23,42,0.45)] p-4"
              role="dialog"
              aria-modal="true"
              aria-label="The post behind this point"
              onClick={() => setOpenPoint(null)}
            >
              <div
                className="max-h-[80vh] w-full max-w-[520px] overflow-auto rounded-[var(--radius-lg)] bg-[var(--surface)] p-5 shadow-[var(--e3)]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className="inline-flex rounded-[7px] px-2 py-1 text-[11px] font-bold"
                    style={{ background: tone.fill, color: tone.text }}
                  >
                    {row.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenPoint(null)}
                    aria-label="Close"
                    className="text-[13px] font-semibold text-ink-3 hover:text-ink"
                  >
                    Close
                  </button>
                </div>

                <h3 className="mt-2.5 text-[15px] font-bold leading-snug">
                  {row.title || 'Untitled post'}
                </h3>
                <p className="mt-1 text-[12px] text-ink-3">
                  {absoluteDate(row.at)}
                  {row.score != null ? ` \u00b7 scored ${row.score}` : ''}
                  {row.comments > 0
                    ? ` \u00b7 read from ${row.comments} comment${row.comments === 1 ? '' : 's'}`
                    : ' \u00b7 read from the post itself, no comments stored'}
                </p>

                {row.why ? (
                  <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
                    {row.why}
                  </p>
                ) : (
                  <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
                    The reading recorded no rationale for this post.
                  </p>
                )}

                {row.url && (
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--accent)]"
                  >
                    Open the post
                    <ArrowRight size={13} aria-hidden />
                  </a>
                )}
              </div>
            </div>
          )
        })()}
    </Card>
  )
}
