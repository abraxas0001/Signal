import type { Report } from '@shared/types'
import type { Emotion, Topic } from '@shared/taxonomy'
import { readStandingCache, readStandingNote, type Standing, type TrackedHandle } from '@/lib/handles'
import { recurringTerms, termCount } from '@/lib/terms'
import { cleanQuote } from '@/lib/utils'

/**
 * "What people are saying about you", assembled from what this desk has
 * actually read.
 *
 * TWO SOURCES, KEPT APART BY WHAT EACH CAN SUPPORT.
 *
 *   The comment readings (one per own account) carry the split of positive,
 *   neutral and negative, how many comments that rests on, and the comments
 *   themselves quoted verbatim. Everything about WHAT PEOPLE SAID comes from
 *   here, because these are the only real words anybody typed.
 *
 *   The full post readings carry the audience's emotions and the topic each
 *   post was about. Everything about HOW PEOPLE FELT and WHAT THE
 *   CONVERSATION WAS ABOUT comes from here.
 *
 * The reference design also shows "engagement on comments" and "unique people
 * talking". No platform publishes either to a reader outside the account, and
 * neither is derivable from what is stored, so neither is invented: the screen
 * shows what it can support and says plainly what it cannot.
 */

export interface QuotedComment {
  text: string
  platform: TrackedHandle['platform']
  handle: string
  /**
   * Which side the reading put it on, or null when nothing scored it.
   *
   * Two sources feed this list and they know different things. The comment
   * readings quote a comment and say which side it sat on but do not keep who
   * wrote it. The post readings store the comment whole, with its author, its
   * like count and its date, but score nothing. Null is the honest answer for
   * a comment that only the second source has seen, and it is shown as such
   * rather than being quietly filed as neutral.
   */
  side: 'positive' | 'neutral' | 'negative' | null
  /** Who wrote it, where the platform published a name. */
  author: string | null
  /** Likes on the comment itself. Null where the platform published none. */
  likes: number | null
  publishedAt: string | null
}

export interface PlatformVoice {
  platform: TrackedHandle['platform']
  handle: string
  commentsRead: number
  postsRead: number
  positive: number
  neutral: number
  negative: number
  score: number | null
  label: string
  /** Why there is no reading, where there is none. */
  note: string | null
}

export interface ThemeCount {
  term: string
  /** Quoted comments on that side which use this word. */
  count: number
  pct: number
}

export interface TopicShare {
  topic: Topic | string
  posts: number
  pct: number
}

export interface EmotionShare {
  emotion: Emotion | string
  pct: number
  /** Readings that recorded this emotion at all. */
  posts: number
}

export interface AudienceModel {
  commentsRead: number
  /** Own posts whose comments were read, never more than the desk stores. */
  postsRead: number
  /** Own posts the desk holds at all, so `postsRead` can be read as a share. */
  postsStored: number
  positive: number
  neutral: number
  negative: number
  /** Weighted mean of the per-account scores, or null when none scored. */
  score: number | null
  platforms: PlatformVoice[]
  quotes: QuotedComment[]
  praise: ThemeCount[]
  complaints: ThemeCount[]
  /**
   * Comments stored whole by the post readings, as against counted by the
   * comment readings. A much smaller number, and the only one that carries a
   * name, a date or a like count.
   */
  storedComments: number
  /** Of those, how many the platform published a name against. */
  authoredComments: number
  /**
   * Distinct names across the stored comments.
   *
   * The reference calls this "unique people talking". It is not that, and the
   * screen must not say it is: it is how many different names appear on the
   * handful of comments this desk keeps in full, which is a sample of a sample.
   * One person posting under two names counts twice, and one name used by two
   * people counts once. It is still a real count of real names.
   */
  distinctAuthors: number
  /**
   * Likes the stored comments themselves drew, and how many carried a figure.
   *
   * Null where no stored comment published one. On this desk the answer is
   * usually close to nought, and that is a finding rather than a gap: almost
   * nobody likes a comment on a politician's post.
   */
  commentLikes: number | null
  commentLikesOver: number
  /** What each account's reading concluded, in the reading's own sentence. */
  summaries: { platform: TrackedHandle['platform']; handle: string; text: string }[]
  topics: TopicShare[]
  /** Read posts that carried a topic at all, which the donut is drawn over. */
  topicPosts: number
  emotions: EmotionShare[]
  /** Own posts carrying a full reading, which the emotion half rests on. */
  postsAnalysed: number
  /**
   * How many of those readings had real comments under them.
   *
   * The emotion figures mean two different things across these two groups: on
   * a post with comments they are the audience answering, on a post without
   * they are the register of the post itself. The screen says which is which
   * rather than presenting the post's own tone as public feeling.
   */
  postsWithComments: number
  postsWithoutComments: number
}

const EMPTY: AudienceModel = {
  commentsRead: 0,
  postsRead: 0,
  postsStored: 0,
  positive: 0,
  neutral: 0,
  negative: 0,
  score: null,
  platforms: [],
  quotes: [],
  praise: [],
  complaints: [],
  storedComments: 0,
  authoredComments: 0,
  distinctAuthors: 0,
  commentLikes: null,
  commentLikesOver: 0,
  summaries: [],
  topics: [],
  topicPosts: 0,
  emotions: [],
  postsAnalysed: 0,
  postsWithComments: 0,
  postsWithoutComments: 0,
}

/**
 * Words that recur on one side, with the share of that side's quotes.
 *
 * A word has to appear in TWO of the quoted comments before it is listed.
 * The bar used to be one, and it made a theme out of a single sentence: the
 * praise list carried "stop", lifted out of one demand for a railway halt,
 * beside a complaint list that refused to print anything for exactly the same
 * reason. One bar, both sides, and what is printed is a word two people used.
 */
function themesOf(quotes: string[], max: number, extraStop: Set<string>): ThemeCount[] {
  if (quotes.length === 0) return []
  const terms = recurringTerms(quotes, max, extraStop) ?? []
  return terms
    .map((term) => {
      const count = termCount(quotes, term)
      return { term, count, pct: Math.round((count / quotes.length) * 100) }
    })
    .filter((t) => t.count >= 2)
    .sort((a, b) => b.count - a.count)
}

/**
 * The desk owner's own name, so it never appears as a thing people praise.
 *
 * Almost every comment written to an MP names the MP. Counting that produces
 * a "praised for" list whose first entry is the principal, which is a fact
 * about who the account belongs to and not about what anyone said.
 */
function ownNames(handles: TrackedHandle[]): Set<string> {
  const out = new Set<string>()
  for (const h of handles) {
    for (const source of [h.displayName ?? '', h.handle]) {
      for (const raw of source.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u)) {
        if (!raw) continue
        if (/^[a-z0-9]+$/.test(raw) ? raw.length >= 3 : raw.length >= 2) out.add(raw)
      }
    }
  }
  return out
}

export function audienceOf(
  handles: TrackedHandle[],
  reports: Map<string, Report> | null,
): AudienceModel {
  const own = handles.filter((h) => h.own)
  if (own.length === 0) return EMPTY

  /* ── the comment readings ─────────────────────────────────────────────── */
  const platforms: PlatformVoice[] = []
  const readings: Standing[] = []
  const quotes: QuotedComment[] = []
  const summaries: AudienceModel['summaries'] = []

  /**
   * How many posts this desk actually holds per account.
   *
   * A comment reading records how many posts it walked at the time it ran,
   * and that can be more than the account's stored post list — the YouTube
   * reading walked 33 videos, the desk keeps the most recent 25. Left alone
   * the card claimed comments read under 101 "of your posts" beside a sibling
   * card counting 100 in total, which reads as one of the two being wrong.
   * The claim is capped at what the desk can actually show.
   */
  const storedPosts = new Map<string, number>(
    own.map((h) => [h.id, (h.snapshots.at(-1)?.posts ?? []).length]),
  )

  for (const h of own) {
    const st = readStandingCache(h.id)
    const who = h.displayName ?? h.handle
    if (!st || st.source === 'record') {
      platforms.push({
        platform: h.platform,
        handle: who,
        commentsRead: 0,
        postsRead: 0,
        positive: 0,
        neutral: 0,
        negative: 0,
        score: null,
        label: 'Not read',
        note: readStandingNote(h.id) ?? 'No comments have been read on this account yet.',
      })
      continue
    }
    const held = storedPosts.get(h.id) ?? 0
    const postsRead = held > 0 ? Math.min(st.postsRead, held) : st.postsRead
    readings.push({ ...st, postsRead })
    const total = st.positive + st.neutral + st.negative || 1
    platforms.push({
      platform: h.platform,
      handle: who,
      commentsRead: st.commentsRead,
      postsRead,
      positive: Math.round((st.positive / total) * 100),
      neutral: Math.round((st.neutral / total) * 100),
      negative: Math.round((st.negative / total) * 100),
      score: st.score,
      label: st.label,
      note: null,
    })
    const quoted = (text: string, side: QuotedComment['side']): void => {
      quotes.push({
        text: cleanQuote(text),
        platform: h.platform,
        handle: who,
        side,
        author: null,
        likes: null,
        publishedAt: null,
      })
    }
    for (const text of st.praise) quoted(text, 'positive')
    for (const text of st.criticism) quoted(text, 'negative')
    for (const text of st.neutralQuotes ?? []) quoted(text, 'neutral')
    if (st.summary?.trim()) {
      summaries.push({ platform: h.platform, handle: who, text: st.summary.trim() })
    }
  }

  platforms.sort((a, b) => b.commentsRead - a.commentsRead)
  if (readings.length === 0) return { ...EMPTY, platforms }

  /*
   * The split is the plain sum of the counts, not a weighted mean of them.
   *
   * `positive`, `neutral` and `negative` on a reading are COUNTS of comments,
   * so adding them already gives four hundred comments their four hundred
   * votes against another account's nine. Multiplying each count by its own
   * account's comment total weighted the data a second time and produced a
   * split — 17 / 80 / 3 — that disagreed with the per-account column printed
   * inches away on the same screen (43 of 287 positive, which is 15).
   */
  const rawPos = readings.reduce((s, r) => s + r.positive, 0)
  const rawNeu = readings.reduce((s, r) => s + r.neutral, 0)
  const rawNeg = readings.reduce((s, r) => s + r.negative, 0)
  const sum = rawPos + rawNeu + rawNeg

  const scored = readings.filter((r) => r.score !== null)
  const scoreWeight = scored.reduce((s, r) => s + Math.max(r.commentsRead, 1), 0)

  /* ── the post readings: emotions and topics ───────────────────────────── */
  const ownUrls = new Set(own.flatMap((h) => (h.snapshots.at(-1)?.posts ?? []).map((p) => p.url)))
  /** Which account each own post belongs to, so a stored comment can say. */
  const urlPlatform = new Map<
    string,
    { platform: TrackedHandle['platform']; handle: string }
  >()
  for (const h of own) {
    for (const post of h.snapshots.at(-1)?.posts ?? []) {
      urlPlatform.set(post.url, { platform: h.platform, handle: h.displayName ?? h.handle })
    }
  }
  const analysed = reports
    ? [...reports.entries()].filter(([url, r]) => ownUrls.has(url) && r.analysis)
    : []

  const emotionWeight = new Map<string, { weight: number; posts: number }>()
  const topicPosts = new Map<string, number>()
  let withComments = 0

  /*
   * The second source. A comment reading counts comments and quotes a few; a
   * post reading keeps whole comments, with the name, the date and the like
   * count the platform published against each. Only this half can answer "who
   * is talking", and only over the posts that have been read in full, which is
   * why every figure derived from it travels with that denominator.
   */
  let storedComments = 0
  let authoredComments = 0
  let likesOver = 0
  let likesSum = 0
  const authors = new Set<string>()
  /** Stored comments keyed by their text, to enrich a quote that matches. */
  const detail = new Map<string, { author: string | null; likes: number | null; at: string | null }>()

  for (const [url, report] of analysed) {
    const analysis = report.analysis
    if (!analysis) continue
    const stored = report.snapshot.comments ?? []
    if (stored.length > 0) withComments += 1
    const platform = urlPlatform.get(url) ?? null
    for (const c of stored) {
      const text = cleanQuote(c.text ?? '')
      if (!text) continue
      storedComments += 1
      const author = c.author?.trim() || null
      if (author) {
        authoredComments += 1
        authors.add(author.toLowerCase())
      }
      if (typeof c.likes === 'number') {
        likesOver += 1
        likesSum += c.likes
      }
      detail.set(text, { author, likes: c.likes ?? null, at: c.publishedAt ?? null })
      // A stored comment nothing scored is still a real comment somebody
      // wrote. It joins the list with a null side rather than being dropped,
      // because dropping it would hide most of what this desk actually holds.
      if (platform && !quotes.some((q) => q.text === text)) {
        quotes.push({
          text,
          platform: platform.platform,
          handle: platform.handle,
          side: null,
          author,
          likes: c.likes ?? null,
          publishedAt: c.publishedAt ?? null,
        })
      }
    }
    for (const e of analysis.emotions ?? []) {
      const prev = emotionWeight.get(e.emotion) ?? { weight: 0, posts: 0 }
      emotionWeight.set(e.emotion, { weight: prev.weight + e.weight, posts: prev.posts + 1 })
    }
    const primary = analysis.topics?.primary
    if (primary) topicPosts.set(primary, (topicPosts.get(primary) ?? 0) + 1)
  }

  const emotionTotal = [...emotionWeight.values()].reduce((s, e) => s + e.weight, 0)
  const emotions: EmotionShare[] = [...emotionWeight.entries()]
    .map(([emotion, v]) => ({
      emotion,
      posts: v.posts,
      pct: emotionTotal > 0 ? Math.round((v.weight / emotionTotal) * 100) : 0,
    }))
    .filter((e) => e.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6)

  /*
   * The ring is drawn over every post that carried a topic, not over the six
   * largest of them. A donut normalises to the segments it is handed, so a
   * top-six ring beside percentages taken against the whole set drew each arc
   * a quarter longer than its own label, and the twelve posts in the tail
   * disappeared from a chart that still read as complete. The tail is folded
   * into one honest segment instead.
   */
  const topicTotal = [...topicPosts.values()].reduce((s, n) => s + n, 0)
  const ranked = [...topicPosts.entries()].sort((a, b) => b[1] - a[1])
  const pctOf = (n: number): number => (topicTotal > 0 ? Math.round((n / topicTotal) * 100) : 0)
  const head = ranked.slice(0, 6)
  const tail = ranked.slice(6).reduce((s, [, n]) => s + n, 0)
  const topics: TopicShare[] = head.map(([topic, posts]) => ({
    topic,
    posts,
    pct: pctOf(posts),
  }))
  if (tail > 0) {
    topics.push({
      topic: `Other topics (${ranked.length - head.length})`,
      posts: tail,
      pct: pctOf(tail),
    })
  }

  const stop = ownNames(own)

  /* A quote the comment reading scored and the post reading also stored is one
     comment seen twice. Where the text matches, the name and the like count
     from the second source are attached to the first, so the row can carry a
     side AND a name instead of one or the other. */
  for (const q of quotes) {
    if (q.author !== null) continue
    const found = detail.get(q.text)
    if (!found) continue
    q.author = found.author
    q.likes = found.likes
    q.publishedAt = found.at
  }

  return {
    storedComments,
    authoredComments,
    distinctAuthors: authors.size,
    commentLikes: likesOver > 0 ? likesSum : null,
    commentLikesOver: likesOver,
    summaries,
    commentsRead: readings.reduce((s, r) => s + r.commentsRead, 0),
    postsRead: readings.reduce((s, r) => s + r.postsRead, 0),
    postsStored: [...storedPosts.values()].reduce((s, n) => s + n, 0),
    positive: sum > 0 ? Math.round((rawPos / sum) * 100) : 0,
    neutral: sum > 0 ? Math.round((rawNeu / sum) * 100) : 0,
    negative: sum > 0 ? Math.round((rawNeg / sum) * 100) : 0,
    score:
      scored.length === 0
        ? null
        : Math.round(
            scored.reduce((s, r) => s + (r.score ?? 0) * Math.max(r.commentsRead, 1), 0) /
              scoreWeight,
          ),
    platforms,
    quotes,
    praise: themesOf(
      quotes.filter((q) => q.side === 'positive').map((q) => q.text),
      6,
      stop,
    ),
    complaints: themesOf(
      quotes.filter((q) => q.side === 'negative').map((q) => q.text),
      6,
      stop,
    ),
    topics,
    topicPosts: topicTotal,
    emotions,
    postsAnalysed: analysed.length,
    postsWithComments: withComments,
    postsWithoutComments: analysed.length - withComments,
  }
}

/** The verdict the cards lead with. Never a number pretending to be a sentence. */
export function audienceVerdict(m: AudienceModel): string {
  if (m.commentsRead === 0) return 'No comments have been read yet.'
  const s = m.score ?? 0
  if (s > 30) return 'People are warm about you.'
  if (s > 8) return 'Leaning positive.'
  if (s < -30) return 'People are hostile.'
  if (s < -8) return 'Leaning negative.'
  return 'Genuinely divided.'
}
