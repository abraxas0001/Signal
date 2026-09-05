import type { Report } from '@shared/types'
import type { Emotion, Topic } from '@shared/taxonomy'
import { readStandingCache, readStandingNote, type Standing, type TrackedHandle } from '@/lib/handles'
import { NON_TOPIC, recurringTerms, termCount } from '@/lib/terms'
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
  /**
   * What this comment is ABOUT, in two to four words, as classify-comments.ts
   * read it: "railway connectivity", "road condition", "water supply".
   *
   * Null for a comment that gives no reason, which is most greetings and
   * emoji. This is the comment's own subject and never the subject of the
   * post it sits under, which is a different fact about a different thing.
   */
  theme: string | null
  /** Who wrote it, where the platform published a name. */
  author: string | null
  /** Likes on the comment itself. Null where the platform published none. */
  likes: number | null
  publishedAt: string | null
  /**
   * The post this comment sits under, where we know which one it is.
   *
   * The office asked to be able to press a mention and land on the post, so
   * they can see for themselves that the desk read it correctly. That is only
   * answerable for comments taken from a POST reading, which stores the
   * comment against its own permalink. Comments that came from an account
   * reading were quoted out of a bulk pass over many posts and the reading
   * does not record which one each came from, so this is null and no link is
   * offered. An approximate link would be worse than none: it would send the
   * office to a post that does not contain the comment they pressed.
   */
  postUrl: string | null
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
  /**
   * Which accounts these comments came from.
   *
   * `own` — the desk's own accounts, the correct basis for "your reception".
   * `all-tracked` — nothing is marked as the desk's, so this is every account
   * it follows. The screen must say so rather than captioning a watched
   * account's comments as the office's own.
   */
  basis: 'own' | 'all-tracked'
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
  /**
   * The comments themselves, from BOTH sources, one row per comment.
   *
   * A row with a `postUrl` is a comment this desk stores in full, read off a
   * post it holds. A row without one is a comment an account survey quoted
   * while counting a much larger set it did not keep. The two are different
   * populations and a caption over this list has to say which it is counting,
   * because neither number is "the comments this desk holds": the surveys
   * counted hundreds more than they quoted.
   */
  quotes: QuotedComment[]
  praise: ThemeCount[]
  complaints: ThemeCount[]
  /**
   * Comments stored whole by the post readings, as against counted by the
   * comment readings. A much smaller number, and the only one that carries a
   * name, a date or a like count.
   *
   * Distinct comments, not stored rows: a comment captured twice under one
   * post is one comment, and a row that was only the platform's furniture was
   * never one at all.
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
  /**
   * The topics beyond the six largest, which the ring folds into one honest
   * "Other topics (N)" segment. Kept so "View all topics" can unfold the
   * bucket in the legend without redrawing the arcs it was folded into.
   */
  topicTail: TopicShare[]
  /** Read posts that carried a topic at all, which the donut is drawn over. */
  topicPosts: number
  emotions: EmotionShare[]
  /**
   * The same two panels, split by the account the post was published on.
   *
   * The topic ring and the emotion grid are counted over POSTS, and every post
   * belongs to exactly one account — so both narrow honestly when the rail
   * selects one. They did not, and the mix genuinely differs: YouTube is 47%
   * Governance where Twitter/X is 33% Development Works, and Twitter/X reads
   * 47% Trust where YouTube reads 27% Joy. A frozen ring over a selected
   * account was answering a question the reader had stopped asking.
   */
  byPlatform: Record<
    string,
    {
      topics: TopicShare[]
      /** The topics folded into "Other topics (N)", same as the model's. */
      topicTail: TopicShare[]
      topicPosts: number
      emotions: EmotionShare[]
      postsAnalysed: number
      withComments: number
    }
  >
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
  basis: 'own',
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
  topicTail: [],
  topicPosts: 0,
  byPlatform: {},
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
export function ownNames(handles: TrackedHandle[]): Set<string> {
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
  /**
   * WHOSE COMMENTS THIS IS ABOUT — and never "nobody's".
   *
   * `own` is the right basis: comments under the desk's own posts are the
   * desk's reception, and an account it merely watches is somebody else's.
   *
   * But this used to `return EMPTY` the moment nothing was marked own, and
   * that threw away every comment the desk had ever read. An office with four
   * accounts added as WATCHED — the state a desk lands in when it pastes
   * addresses without marking them — was told "No comments have been read
   * yet" over hundreds of stored comments. The words were false and the work
   * was invisible: the readings were on disk the whole time.
   *
   * So the list falls back to every tracked account, and `basis` records
   * which rule produced it. Showing somebody the comments they collected and
   * naming whose they are is honest. Claiming none exist is not.
   */
  const ownMarked = handles.filter((h) => h.own)
  const own = ownMarked.length > 0 ? ownMarked : handles
  const basis: AudienceModel['basis'] = ownMarked.length > 0 ? 'own' : 'all-tracked'
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

  /**
   * Survey quotes still waiting for the comment they are a copy of.
   *
   * An account survey and a post reading routinely see the SAME comment: the
   * survey quotes it having scored it, the post reading stores it whole with
   * its author, its date and, since classify-comments.ts, its own side and
   * theme. Two rows for one comment would count that comment twice, so the
   * stored half claims the survey's row out of this index and fills it in
   * rather than a second row being pushed.
   *
   * Keyed by account as well as text, because the same words under two
   * different accounts are two different people saying them, and a list of
   * quoted comments must not answer "who said this" with the wrong account.
   * A list, not a single entry, because a survey can quote the same sentence
   * more than once and each copy may have its own comment behind it.
   */
  const unclaimed = new Map<string, QuotedComment[]>()
  const quoteKey = (platform: string, handle: string, text: string): string =>
    `${platform}\n${handle}\n${text}`

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
      // A "comment" that was only the platform's Like/Reply row cleans to
      // nothing. It was never a comment, so it is not quoted as one.
      const clean = cleanQuote(text)
      if (!clean) return
      const q: QuotedComment = {
        text: clean,
        platform: h.platform,
        handle: who,
        side,
        theme: null,
        author: null,
        likes: null,
        publishedAt: null,
        // An account reading quotes across many posts without recording which.
        postUrl: null,
      }
      quotes.push(q)
      const key = quoteKey(h.platform, who, clean)
      const waiting = unclaimed.get(key)
      if (waiting) waiting.push(q)
      else unclaimed.set(key, [q])
    }
    for (const text of st.praise) quoted(text, 'positive')
    for (const text of st.criticism) quoted(text, 'negative')
    for (const text of st.neutralQuotes ?? []) quoted(text, 'neutral')
    if (st.summary?.trim()) {
      summaries.push({ platform: h.platform, handle: who, text: st.summary.trim() })
    }
  }

  platforms.sort((a, b) => b.commentsRead - a.commentsRead)

  /*
   * NO EARLY RETURN HERE, deliberately.
   *
   * This used to bail with EMPTY as soon as no account-level reading existed,
   * which threw away everything below: the comments stored against individual
   * POST readings, their authors, their like counts, the emotions and the
   * topics. Those are a different source with a different trigger — an office
   * that pastes its own post URLs into Analyse accumulates them without ever
   * running an account survey — so a desk could hold hundreds of real, read
   * comments and be told it had none.
   *
   * Everything below is already written for the empty case: the split is
   * guarded by `sum > 0`, the score returns null when nothing was scored, and
   * the reduces over `readings` are simply zero-length.
   */

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
  /** The same tallies again, kept per account so the rail can narrow them. */
  const perPlat = new Map<
    string,
    {
      topics: Map<string, number>
      emotions: Map<string, { weight: number; posts: number }>
      analysed: number
      withComments: number
    }
  >()
  const platBucket = (name: string) => {
    let b = perPlat.get(name)
    if (!b) {
      b = { topics: new Map(), emotions: new Map(), analysed: 0, withComments: 0 }
      perPlat.set(name, b)
    }
    return b
  }
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
  /**
   * WHICH COMMENTS HAVE ALREADY BEEN COUNTED, by what makes one a comment.
   *
   * A comment is identified by the post it sits under, the name against it
   * and the words in it. Not by its words alone: "🙏" appears under a dozen
   * posts written by a dozen different people, and they are a dozen comments.
   * Not by its position in the array either: a scrape that captured one
   * comment twice under one post stored two rows for one thing, and every
   * figure over the array counted it twice.
   */
  const seen = new Set<string>()

  for (const [url, report] of analysed) {
    const analysis = report.analysis
    if (!analysis) continue
    const stored = report.snapshot.comments ?? []
    const platform = urlPlatform.get(url) ?? null
    /* Comments, not rows. A post whose stored rows were all Instagram's time
       chips has no comments on it, and must not be counted among the posts
       whose emotions the audience supplied. */
    let real = 0
    for (const c of stored) {
      const text = cleanQuote(c.text ?? '')
      // Same rule for comments stored against a post reading.
      if (!text) continue
      const author = c.author?.trim() || null
      const identity = `${url}\n${(author ?? '').toLowerCase()}\n${text}`
      if (seen.has(identity)) continue
      seen.add(identity)
      real += 1
      storedComments += 1
      if (author) {
        authoredComments += 1
        authors.add(author.toLowerCase())
      }
      if (typeof c.likes === 'number') {
        likesOver += 1
        likesSum += c.likes
      }
      if (!platform) continue

      /*
       * ONE COMMENT, ONE ROW, AND THE BETTER READING OF IT WINS.
       *
       * This used to skip the stored comment outright whenever any existing
       * quote carried the identical text. The survey's row was pushed first,
       * so the survey's label won and the comment's own classification was
       * thrown away: "Modi ji ki jai ho Jai Hind Jai Bharat Mata ki Jai ho"
       * was read positive by classify-comments and displayed neutral because
       * the survey's neutral list held the same words, and a demand to keep
       * the Palamuru railway stop was read negative and displayed neutral the
       * same way. The check was also global across every post, so 37 stored
       * comments vanished from the screen because a DIFFERENT person had
       * written the same words under a different post.
       *
       * The per-comment reading is the better evidence: it was made by
       * reading that one comment, where the survey's label came from a bulk
       * pass and does not even record which post it was quoting. So the row
       * is kept and filled in with everything the stored comment knows, the
       * side included, and only an unmatched survey quote keeps the survey's
       * label. Absent stays null: not classified is not the same as neutral.
       */
      const survey = unclaimed.get(quoteKey(platform.platform, platform.handle, text))?.shift()
      if (survey) {
        if (c.side) survey.side = c.side
        survey.theme = c.theme ?? null
        survey.author = author
        survey.likes = c.likes ?? null
        survey.publishedAt = c.publishedAt ?? null
        survey.postUrl = report.snapshot.canonicalUrl || url
        continue
      }

      // A stored comment nothing scored is still a real comment somebody
      // wrote. It joins the list with a null side rather than being dropped,
      // because dropping it would hide most of what this desk actually holds.
      quotes.push({
        text,
        platform: platform.platform,
        handle: platform.handle,
        side: c.side ?? null,
        theme: c.theme ?? null,
        author,
        likes: c.likes ?? null,
        publishedAt: c.publishedAt ?? null,
        postUrl: report.snapshot.canonicalUrl || url,
      })
    }
    if (real > 0) withComments += 1
    const bucket = platform ? platBucket(platform.platform) : null
    if (bucket) {
      bucket.analysed += 1
      if (real > 0) bucket.withComments += 1
    }
    for (const e of analysis.emotions ?? []) {
      const prev = emotionWeight.get(e.emotion) ?? { weight: 0, posts: 0 }
      emotionWeight.set(e.emotion, { weight: prev.weight + e.weight, posts: prev.posts + 1 })
      if (bucket) {
        const bp = bucket.emotions.get(e.emotion) ?? { weight: 0, posts: 0 }
        bucket.emotions.set(e.emotion, { weight: bp.weight + e.weight, posts: bp.posts + 1 })
      }
    }
    const primary = analysis.topics?.primary
    if (primary) {
      topicPosts.set(primary, (topicPosts.get(primary) ?? 0) + 1)
      if (bucket) bucket.topics.set(primary, (bucket.topics.get(primary) ?? 0) + 1)
    }
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
  const tailTopics: TopicShare[] = ranked
    .slice(6)
    .map(([topic, posts]) => ({ topic, posts, pct: pctOf(posts) }))
  const tail = tailTopics.reduce((s, t) => s + t.posts, 0)
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

  /**
   * What can never be a REASON somebody praised or criticised you.
   *
   * This was the desk's own names alone, so the praise list led with "jai",
   * "akka", "happy" and "bjp" — a chant, a kinship term, a mood and a party.
   * None of them is something a person is praised FOR, and the office said so
   * plainly: this makes no sense. NON_TOPIC carries the slogans, the address
   * terms and the bare verdicts; the desk's own names come on top.
   */
  const stop = new Set<string>([...NON_TOPIC, ...ownNames(own)])

  /**
   * Praise and complaints, with the vocabulary they SHARE removed.
   *
   * "bjp" was appearing in both lists at once — the office's second report.
   * A word both camps use is not a reason either camp holds; it is simply
   * what this account's comments are about. Cutting it from both leaves the
   * words that actually separate the people praising from the people
   * complaining, which is the only thing these two lists are for.
   */
  const sides = ((): { praise: ThemeCount[]; complaints: ThemeCount[] } => {
    const pos = themesOf(quotes.filter((q) => q.side === 'positive').map((q) => q.text), 12, stop)
    const neg = themesOf(quotes.filter((q) => q.side === 'negative').map((q) => q.text), 12, stop)
    const shared = new Set(
      pos.map((t) => t.term).filter((t) => neg.some((n) => n.term === t)),
    )
    return {
      praise: pos.filter((t) => !shared.has(t.term)).slice(0, 6),
      complaints: neg.filter((t) => !shared.has(t.term)).slice(0, 6),
    }
  })()

  /* The pass that used to sit here attached a name to a survey quote by
     looking its text up in every stored comment on the desk, across accounts.
     The loop above now does that against the one comment the quote is
     actually a copy of, on the same account, so a Facebook quote can no
     longer be captioned with the name of an Instagram commenter who happened
     to type the same words. A survey quote nothing matched keeps no name,
     which is the truth: the survey never recorded one. */

  /* The same two reductions the desk-wide panels use, run once per account.
     Shares are computed inside each account so a ring drawn for YouTube sums
     to YouTube's own hundred, never to a slice of the desk's. */
  const byPlatform: AudienceModel['byPlatform'] = {}
  for (const [name, b] of perPlat) {
    const eTotal = [...b.emotions.values()].reduce((s, e) => s + e.weight, 0)
    const pEmotions: EmotionShare[] = [...b.emotions.entries()]
      .map(([emotion, v]) => ({
        emotion,
        posts: v.posts,
        pct: eTotal > 0 ? Math.round((v.weight / eTotal) * 100) : 0,
      }))
      .filter((e) => e.pct > 0)
      .sort((a, b2) => b2.pct - a.pct)
      .slice(0, 6)

    const tTotal = [...b.topics.values()].reduce((s, n) => s + n, 0)
    const tRanked = [...b.topics.entries()].sort((a, b2) => b2[1] - a[1])
    const tPct = (n: number): number => (tTotal > 0 ? Math.round((n / tTotal) * 100) : 0)
    const tHead = tRanked.slice(0, 6)
    const tTailTopics: TopicShare[] = tRanked
      .slice(6)
      .map(([topic, posts]) => ({ topic, posts, pct: tPct(posts) }))
    const tTail = tTailTopics.reduce((s, t) => s + t.posts, 0)
    const pTopics: TopicShare[] = tHead.map(([topic, posts]) => ({ topic, posts, pct: tPct(posts) }))
    if (tTail > 0) {
      pTopics.push({
        topic: `Other topics (${tRanked.length - tHead.length})` as TopicShare['topic'],
        posts: tTail,
        pct: tPct(tTail),
      })
    }
    byPlatform[name] = {
      topics: pTopics,
      topicTail: tTailTopics,
      topicPosts: tTotal,
      emotions: pEmotions,
      postsAnalysed: b.analysed,
      withComments: b.withComments,
    }
  }

  return {
    basis,
    byPlatform,
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
    ...sides,
    topics,
    topicTail: tailTopics,
    topicPosts: topicTotal,
    emotions,
    postsAnalysed: analysed.length,
    postsWithComments: withComments,
    postsWithoutComments: analysed.length - withComments,
  }
}

/** The verdict the cards lead with. Never a number pretending to be a sentence. */
/**
 * The verdict for ONE account, read from that account's own distribution.
 *
 * Deliberately NOT the stored score. Facebook's standing on this desk is 100,
 * which sounds emphatic and rests on two positive comments in seventy-two —
 * the same account is 97% neutral. Swapping the score in when the rail selects
 * a platform would have printed "People are warm about you" over the quietest
 * audience the office has. The shares cannot lie that way: they are counted
 * over every comment the survey read, so a neutral account reads as neutral.
 */
export function voiceVerdict(
  v: { positive: number; neutral: number; negative: number; commentsRead: number },
  platform: string,
): string {
  if (v.commentsRead === 0) return `No comments have been read on ${platform}.`
  if (v.neutral >= 60) return `Mostly neutral on ${platform}.`
  const margin = v.positive - v.negative
  if (margin > 30) return `People are warm about you on ${platform}.`
  if (margin > 8) return `Leaning positive on ${platform}.`
  if (margin < -30) return `People are hostile on ${platform}.`
  if (margin < -8) return `Leaning negative on ${platform}.`
  return `Genuinely divided on ${platform}.`
}

export function audienceVerdict(m: AudienceModel): string {
  if (m.commentsRead === 0) return 'No comments have been read yet.'
  const s = m.score ?? 0
  if (s > 30) return 'People are warm about you.'
  if (s > 8) return 'Leaning positive.'
  if (s < -30) return 'People are hostile.'
  if (s < -8) return 'Leaning negative.'
  return 'Genuinely divided.'
}
