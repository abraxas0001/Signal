import type { Platform } from '@shared/taxonomy'
import { readStandingCache, type TrackedHandle, type TrackedPost } from '@/lib/handles'
import { recurringTerms } from '@/lib/terms'
import { scopedKey } from '@/lib/store'

/**
 * The numbers behind the dashboard's comparison board: one record per PERSON,
 * built from the same stored readings every other screen reads. Nothing here
 * fetches, nothing estimates — a person the desk has not measured gets nulls,
 * and the board's job is to render those nulls as honest gaps.
 *
 * Handles are grouped into people by display name, exactly as the compare
 * screen groups them: the same rival on YouTube and Facebook is one opponent,
 * not two columns.
 */

export interface BoardPerson {
  key: string
  name: string
  own: boolean
  avatarUrl: string | null
  party: string | null
  /** Latest follower reading per platform. Only platforms actually tracked. */
  platforms: { platform: Platform; followers: number | null }[]
  totalReach: number | null
  engagement: {
    /** Mean reactions on the newest dated posts that published any. */
    avg: number | null
    /** How many posts that mean is over — the honest window, never padded. */
    window: number
    /** Reactions summed over every stored post that published any. */
    total: number | null
    posts: number
    /** Per-post reactions, oldest to newest, for the trend line. */
    series: number[]
  }
  sentiment: {
    positive: number
    neutral: number
    negative: number
    commentsRead: number
  } | null
  /** Recurring words across the last ten stored post titles. */
  topics: string[]
  working: {
    /** The content kind with the best average reactions, when one clearly exists. */
    format: string | null
    formatAvg: number | null
    /** The single most-viewed stored post, as "what carried furthest". */
    bestReach: { kind: string; views: number } | null
    /** What the praising comments keep coming back to. */
    praisedTopics: string[]
  }
  /** What people keep saying in the quoted comments, both ways. */
  mentions: string[]
  praise: string[]
  criticism: string[]
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
}

/** The content kind of one post, by what is stored about it. */
function kindOf(p: PersonPost): string {
  if (p.platform === 'YouTube' || /\/(reel|reels|video)s?\//.test(p.post.url)) return 'Video posts'
  if (p.post.thumbnailUrl) return 'Picture posts'
  return 'Text posts'
}

function buildPerson(key: string, handles: TrackedHandle[], own: boolean): BoardPerson {
  const name = handles.map((h) => h.displayName?.trim()).find(Boolean) ?? handles[0]!.handle
  const avatarUrl = handles.map((h) => h.avatarUrl).find(Boolean) ?? null
  const party = handles.map((h) => h.label?.trim()).find(Boolean) ?? null

  /* One row per platform, largest first, so the donut's ring order is the
     legend's order is the reading order. */
  const byPlatform = new Map<Platform, number | null>()
  for (const h of handles) {
    const f = h.snapshots.at(-1)?.followers ?? null
    const prev = byPlatform.get(h.platform)
    byPlatform.set(h.platform, prev == null ? f : f == null ? prev : prev + f)
  }
  const platforms = [...byPlatform.entries()]
    .map(([platform, followers]) => ({ platform, followers }))
    .sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1))
  const read = platforms.map((p) => p.followers).filter((f): f is number => f != null)
  const totalReach = read.length ? read.reduce((a, b) => a + b, 0) : null

  const posts: PersonPost[] = handles.flatMap((h) =>
    (h.snapshots.at(-1)?.posts ?? []).map((post) => ({ post, platform: h.platform })),
  )
  const measured = posts.filter((p) => hasReactions(p.post))
  const dated = measured
    .filter((p) => p.post.publishedAt)
    .sort((a, b) => (a.post.publishedAt ?? '').localeCompare(b.post.publishedAt ?? ''))
  const recent = dated.slice(-6)
  const series = dated.slice(-12).map((p) => reactionsOf(p.post))
  const total = measured.length
    ? measured.reduce((a, p) => a + reactionsOf(p.post), 0)
    : null

  /* The sentiment aggregate, weighted by comments read — the same arithmetic
     the sentiment card runs over the desk's own accounts. Comment readings
     only; a coverage reading is not a sample of anybody's audience. */
  const standings = handles
    .map((h) => readStandingCache(h.id))
    .filter((s): s is NonNullable<typeof s> => s != null && s.source !== 'record')
  let sentiment: BoardPerson['sentiment'] = null
  if (standings.length > 0) {
    const w = (pick: (s: (typeof standings)[number]) => number): number =>
      standings.reduce((a, s) => a + pick(s) * Math.max(s.commentsRead, 1), 0)
    const pos = w((s) => s.positive)
    const neu = w((s) => s.neutral)
    const neg = w((s) => s.negative)
    const sum = pos + neu + neg
    sentiment = {
      positive: sum > 0 ? Math.round((pos / sum) * 100) : 0,
      neutral: sum > 0 ? Math.round((neu / sum) * 100) : 0,
      negative: sum > 0 ? Math.round((neg / sum) * 100) : 0,
      commentsRead: standings.reduce((a, s) => a + s.commentsRead, 0),
    }
  }

  const titles = [...posts]
    .sort((a, b) => (b.post.publishedAt ?? '').localeCompare(a.post.publishedAt ?? ''))
    .slice(0, 10)
    .map((p) => p.post.title?.trim())
    .filter((t): t is string => Boolean(t))

  /* What is working: the kind with the best average, over kinds with at
     least three measured posts — one lucky video is luck, not a lesson. */
  let format: string | null = null
  let formatAvg: number | null = null
  const kinds = new Map<string, number[]>()
  for (const p of measured) {
    const k = kindOf(p)
    kinds.set(k, [...(kinds.get(k) ?? []), reactionsOf(p.post)])
  }
  for (const [k, values] of kinds) {
    if (values.length < 3) continue
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    if (formatAvg == null || avg > formatAvg) {
      format = k
      formatAvg = Math.round(avg)
    }
  }

  const viewed = posts.filter((p) => p.post.views != null)
  const top = viewed.sort((a, b) => (b.post.views ?? 0) - (a.post.views ?? 0))[0]
  const bestReach = top ? { kind: kindOf(top), views: top.post.views ?? 0 } : null

  const praiseQuotes = standings.flatMap((s) => s.praise)
  const criticismQuotes = standings.flatMap((s) => s.criticism)

  return {
    key,
    name,
    own,
    avatarUrl,
    party,
    platforms,
    totalReach,
    engagement: {
      avg: recent.length ? Math.round(recent.reduce((a, p) => a + reactionsOf(p.post), 0) / recent.length) : null,
      window: recent.length,
      total,
      posts: measured.length,
      series,
    },
    sentiment,
    topics: recurringTerms(titles, 6) ?? [],
    working: {
      format,
      formatAvg,
      bestReach,
      praisedTopics: recurringTerms(praiseQuotes, 3) ?? [],
    },
    mentions: recurringTerms([...praiseQuotes, ...criticismQuotes], 5) ?? [],
    praise: recurringTerms(praiseQuotes, 4) ?? [],
    criticism: recurringTerms(criticismQuotes, 4) ?? [],
  }
}

/** Everyone on the desk, the office's own person first, rivals by reach. */
export function boardPeopleOf(handles: TrackedHandle[]): BoardPerson[] {
  const own = handles.filter((h) => h.own)
  const watched = handles.filter((h) => !h.own)

  const groups = new Map<string, TrackedHandle[]>()
  for (const h of watched) {
    const key = personKeyOf(h)
    groups.set(key, [...(groups.get(key) ?? []), h])
  }

  const people: BoardPerson[] = []
  if (own.length > 0) people.push(buildPerson('__own__', own, true))
  for (const [key, hs] of groups) people.push(buildPerson(key, hs, false))

  const [first, ...rest] = people
  rest.sort((a, b) => (b.totalReach ?? -1) - (a.totalReach ?? -1))
  return first ? [first, ...rest] : rest
}

/* ── which rivals the board shows, persisted per desk ────────────────────── */

const SHOWN_KEY = (): string => scopedKey('signal.compareBoard.shown.v1')

/** Null means "never curated": the board shows its default cut of rivals. */
export function readShownRivals(): string[] | null {
  try {
    const raw = localStorage.getItem(SHOWN_KEY())
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : null
  } catch {
    return null
  }
}

export function saveShownRivals(keys: string[]): void {
  try {
    localStorage.setItem(SHOWN_KEY(), JSON.stringify(keys))
  } catch {
    /* a preference that will not persist is an inconvenience, not a failure */
  }
}
