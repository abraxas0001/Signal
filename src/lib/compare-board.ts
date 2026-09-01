import type { Platform } from '@shared/taxonomy'
import type { Standing, TrackedHandle, TrackedPost } from '@/lib/handles'
import { recurringTerms, termCount } from '@/lib/terms'
import { inWindow, windowStart, type WindowId } from '@/lib/window'

/**
 * The comparison board's numbers: one record per PERSON, built from the same
 * stored readings every other screen reads.
 *
 * Nothing here fetches and nothing estimates. A person the desk has not
 * measured gets nulls, and the board renders those as honest gaps — the
 * reference design is a picture of a full desk, and a real one is never
 * uniformly full: Facebook publishes no view counts, X publishes no comments
 * to a stranger, and a rival added this morning has one reading.
 *
 * Handles group into people by display name, exactly as the compare screen
 * has always grouped them: the same rival on YouTube and Facebook is one
 * opponent, not two columns.
 */

export type EngagementMode = 'avg' | 'total'

export interface PlatformSlice {
  platform: Platform
  followers: number
  /** Share of this person's total reach, 0–100. */
  share: number
}

export interface KindBest {
  /** "Video posts", "Picture posts", "Text posts". */
  kind: string
  value: number
  /** The post itself, so the card can show it and open its reading. */
  post: { url: string; title: string | null; thumbnailUrl: string | null; platform: Platform }
}

export interface BoardPerson {
  key: string
  name: string
  own: boolean
  avatarUrl: string | null
  party: string | null

  /** Platforms with a follower reading, largest first. */
  platforms: PlatformSlice[]
  totalReach: number | null
  /** Platforms tracked but never read, so a gap can name itself. */
  unreadPlatforms: Platform[]

  engagement: {
    /** Mean reactions over the newest measured posts in the window. */
    avg: number | null
    /** How many posts that mean is over. */
    window: number
    /** Reactions summed over every measured post in the window. */
    total: number | null
    /** Per-post reactions, oldest to newest, for the sparkline. */
    series: number[]
    /** Change against the window before this one, as a percentage. */
    deltaPct: number | null
  }

  sentiment: {
    positive: number
    neutral: number
    negative: number
    commentsRead: number
  } | null

  working: {
    topics: string[]
    /** The post kind that carried furthest, by views. */
    reach: KindBest | null
    /** The post kind with the best average reactions. */
    engagement: KindBest | null
  }

  /** The newest post this desk holds for them, whatever the window. */
  newestPost: string | null
  /** Posts held for them across all time, so an empty window can say so. */
  postsAllTime: number
  /** Why there is no comment reading, in the reader's own words. */
  sentimentNote: string | null

  /** What people keep saying under their posts, most frequent first. */
  mentions: string[]
  /** How many recurring words there were beyond the ones shown. */
  mentionsMore: number
  praised: { term: string; pct: number }[]
  complained: { term: string; pct: number }[]
}

const hasReactions = (p: TrackedPost): boolean =>
  p.likes != null || p.comments != null || p.shares != null

const reactionsOf = (p: TrackedPost): number =>
  (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0)

const personKeyOf = (h: TrackedHandle): string =>
  (h.displayName?.trim() || h.label?.trim() || h.handle).toLowerCase()

interface PersonPost {
  post: TrackedPost
  platform: Platform
  /** publishedAt, or the date a stored report knew when the scrape did not. */
  at: string | null
}

/** What kind of post this is, from what the reading stored about it. */
function kindOf(p: PersonPost): string {
  if (p.platform === 'YouTube' || /\/(reel|reels|video)s?\//.test(p.post.url)) return 'Video posts'
  if (p.post.thumbnailUrl) return 'Picture posts'
  return 'Text posts'
}

/**
 * Term frequency as a percentage of the quotes on that side.
 *
 * The reference prints "Development 42%". That is a real quantity here: of
 * the comments quoted as praise, this share contains this word. It is not a
 * share of all comments, and the row's own subtitle says so.
 */
function themesOf(quotes: string[], max: number): { term: string; pct: number }[] {
  if (quotes.length === 0) return []
  const terms = recurringTerms(quotes, max) ?? []
  return terms
    .map((term) => ({
      term,
      pct: Math.round((termCount(quotes, term) / quotes.length) * 100),
    }))
    // A term the counter cannot find is a term this row cannot justify.
    .filter((t) => t.pct > 0)
}

function buildPerson(
  key: string,
  handles: TrackedHandle[],
  own: boolean,
  standings: Record<string, Standing>,
  notes: Record<string, string>,
  window: WindowId,
  anchor: string | null,
  dateOf: (post: TrackedPost) => string | null,
): BoardPerson {
  const name = handles.map((h) => h.displayName?.trim()).find(Boolean) ?? handles[0]!.handle
  const avatarUrl = handles.map((h) => h.avatarUrl).find(Boolean) ?? null
  const party = handles.map((h) => h.label?.trim()).find(Boolean) ?? null

  /* Reach: one slice per platform with a follower reading. */
  const byPlatform = new Map<Platform, number>()
  const unread: Platform[] = []
  for (const h of handles) {
    const f = h.snapshots.at(-1)?.followers
    if (f == null) {
      if (!unread.includes(h.platform)) unread.push(h.platform)
      continue
    }
    byPlatform.set(h.platform, (byPlatform.get(h.platform) ?? 0) + f)
  }
  const totalReach = byPlatform.size > 0 ? [...byPlatform.values()].reduce((a, b) => a + b, 0) : null
  const platforms: PlatformSlice[] = [...byPlatform.entries()]
    .map(([platform, followers]) => ({
      platform,
      followers,
      share: totalReach && totalReach > 0 ? Math.round((followers / totalReach) * 100) : 0,
    }))
    .sort((a, b) => b.followers - a.followers)

  /* Posts, dated where anything knows the date. */
  const posts: PersonPost[] = handles.flatMap((h) =>
    (h.snapshots.at(-1)?.posts ?? []).map((post) => ({
      post,
      platform: h.platform,
      at: dateOf(post),
    })),
  )
  const start = windowStart(anchor, window)
  const inSet = posts.filter((p) => inWindow(p.at, start))
  const measured = inSet.filter((p) => hasReactions(p.post))

  /* The window before this one, for the change figure. Only where the window
     is bounded and the posts carry dates: a delta against "everything" is not
     a delta. */
  let deltaPct: number | null = null
  if (start) {
    const span = Date.parse(anchor ?? start) - Date.parse(start)
    const prevStart = new Date(Date.parse(start) - span).toISOString()
    const prev = posts.filter(
      (p) => p.at != null && p.at >= prevStart && p.at < start && hasReactions(p.post),
    )
    if (prev.length > 0 && measured.length > 0) {
      const mean = (set: PersonPost[]): number =>
        set.reduce((a, p) => a + reactionsOf(p.post), 0) / set.length
      const before = mean(prev)
      if (before > 0) deltaPct = Math.round(((mean(measured) - before) / before) * 1000) / 10
    }
  }

  const dated = measured
    .filter((p) => p.at)
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
  const recent = (dated.length > 0 ? dated : measured).slice(-6)
  const series = (dated.length > 0 ? dated : measured).slice(-12).map((p) => reactionsOf(p.post))

  /* Sentiment: the comment readings on this person's accounts, weighted by
     how many comments each read. Coverage readings are not a sample of
     anybody's audience and never join this. */
  const readings = handles
    .map((h) => standings[h.id])
    .filter((s): s is Standing => s != null && s.source !== 'record')
  let sentiment: BoardPerson['sentiment'] = null
  if (readings.length > 0) {
    const w = (pick: (s: Standing) => number): number =>
      readings.reduce((a, s) => a + pick(s) * Math.max(s.commentsRead, 1), 0)
    const pos = w((s) => s.positive)
    const neu = w((s) => s.neutral)
    const neg = w((s) => s.negative)
    const sum = pos + neu + neg
    sentiment = {
      positive: sum > 0 ? Math.round((pos / sum) * 100) : 0,
      neutral: sum > 0 ? Math.round((neu / sum) * 100) : 0,
      negative: sum > 0 ? Math.round((neg / sum) * 100) : 0,
      commentsRead: readings.reduce((a, s) => a + s.commentsRead, 0),
    }
  }

  /* What is working: the topics they actually post about, the kind that
     carried furthest, and the kind that earns the most per post. */
  const titles = [...inSet]
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    .slice(0, 10)
    .map((p) => p.post.title?.trim())
    .filter((t): t is string => Boolean(t))

  const viewed = inSet.filter((p) => p.post.views != null)
  const topViewed = [...viewed].sort((a, b) => (b.post.views ?? 0) - (a.post.views ?? 0))[0]

  const asRef = (p: PersonPost): KindBest['post'] => ({
    url: p.post.url,
    title: p.post.title?.trim() ?? null,
    thumbnailUrl: p.post.thumbnailUrl ?? null,
    platform: p.platform,
  })

  const kinds = new Map<string, PersonPost[]>()
  for (const p of measured) {
    const k = kindOf(p)
    kinds.set(k, [...(kinds.get(k) ?? []), p])
  }
  let bestKind: KindBest | null = null
  for (const [kind, set] of kinds) {
    // Three measured posts before a kind may speak: one lucky video is luck.
    if (set.length < 3) continue
    const avg = Math.round(set.reduce((a, p) => a + reactionsOf(p.post), 0) / set.length)
    if (!bestKind || avg > bestKind.value) {
      // The card shows this kind's own best post: the example behind the mean.
      const best = [...set].sort((a, b) => reactionsOf(b.post) - reactionsOf(a.post))[0]!
      bestKind = { kind, value: avg, post: asRef(best) }
    }
  }

  /* Why a column has no comment reading. The reader records its own reason
     when it declines to score — "only 4 comments across 25 posts" — and that
     sentence is worth far more to an office than a blank cell. */
  const sentimentNote =
    readings.length > 0 ? null : handles.map((h) => notes[h.id]).find(Boolean) ?? null

  const newestPost = posts.reduce<string | null>(
    (best, p) => (p.at && (!best || p.at > best) ? p.at : best),
    null,
  )

  const praiseQuotes = readings.flatMap((s) => s.praise)
  const criticismQuotes = readings.flatMap((s) => s.criticism)
  const allQuotes = [...praiseQuotes, ...criticismQuotes]
  const allTerms = recurringTerms(allQuotes, 12) ?? []

  return {
    key,
    name,
    own,
    avatarUrl,
    party,
    platforms,
    totalReach,
    unreadPlatforms: unread,
    engagement: {
      avg: recent.length
        ? Math.round(recent.reduce((a, p) => a + reactionsOf(p.post), 0) / recent.length)
        : null,
      window: recent.length,
      total: measured.length
        ? measured.reduce((a, p) => a + reactionsOf(p.post), 0)
        : null,
      series,
      deltaPct,
    },
    sentiment,
    working: {
      topics: recurringTerms(titles, 3) ?? [],
      reach: topViewed
        ? { kind: kindOf(topViewed), value: topViewed.post.views ?? 0, post: asRef(topViewed) }
        : null,
      engagement: bestKind,
    },
    newestPost,
    postsAllTime: posts.length,
    sentimentNote,
    mentions: allTerms.slice(0, 6),
    mentionsMore: Math.max(0, allTerms.length - 6),
    praised: themesOf(praiseQuotes, 5),
    complained: themesOf(criticismQuotes, 5),
  }
}

/** Everyone on the desk: the office's own person first, rivals by reach. */
export function boardPeopleOf(
  handles: TrackedHandle[],
  standings: Record<string, Standing>,
  notes: Record<string, string>,
  window: WindowId,
  dateOf: (post: TrackedPost) => string | null,
): BoardPerson[] {
  /* The window is anchored to the newest dated post across everybody, not to
     the clock: readings are taken in batches, and a wall-clock week would
     empty every column on any visit a week after the last collection. */
  let anchor: string | null = null
  for (const h of handles) {
    for (const p of h.snapshots.at(-1)?.posts ?? []) {
      const at = dateOf(p)
      if (at && (!anchor || at > anchor)) anchor = at
    }
  }

  const own = handles.filter((h) => h.own)
  const groups = new Map<string, TrackedHandle[]>()
  for (const h of handles.filter((x) => !x.own)) {
    const key = personKeyOf(h)
    groups.set(key, [...(groups.get(key) ?? []), h])
  }

  const people: BoardPerson[] = []
  if (own.length > 0) {
    people.push(buildPerson('__own__', own, true, standings, notes, window, anchor, dateOf))
  }
  for (const [key, hs] of groups) {
    people.push(buildPerson(key, hs, false, standings, notes, window, anchor, dateOf))
  }

  const [first, ...rest] = people
  rest.sort((a, b) => (b.totalReach ?? -1) - (a.totalReach ?? -1))
  return first ? [first, ...rest] : rest
}

/** The window anchor, exposed so the header can label the range it resolved. */
export function boardAnchor(
  handles: TrackedHandle[],
  dateOf: (post: TrackedPost) => string | null,
): string | null {
  let anchor: string | null = null
  for (const h of handles) {
    for (const p of h.snapshots.at(-1)?.posts ?? []) {
      const at = dateOf(p)
      if (at && (!anchor || at > anchor)) anchor = at
    }
  }
  return anchor
}
