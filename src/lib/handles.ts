import type { Platform } from '@shared/taxonomy'

/**
 * The dashboard's store, kept on the reader's own machine.
 *
 * localStorage rather than a server database, deliberately. The posts this
 * product reads name real citizens making real allegations against named
 * officials; putting a running history of that on a shared server creates a
 * durable record of who complained about whom, sitting somewhere nobody in the
 * office controls. Keeping it in the browser means the data lives on the
 * machine of the person already entitled to read it, and clearing the browser
 * clears it. It costs cross-device sync, which is a fair trade for that.
 *
 * Every snapshot is retained rather than overwritten, so the trend line comes
 * from measurements actually taken rather than from interpolation.
 */

const KEY = 'signal.handles.v1'
/** Roughly a year of daily refreshes per handle, and a bound on the quota. */
const MAX_SNAPSHOTS = 400

export interface TrackedPost {
  url: string
  title: string | null
  publishedAt: string | null
  views: number | null
  likes: number | null
  comments: number | null
  /** Only ever present when read through an owned-page API token. */
  shares?: number | null
}

export interface HandleSnapshot {
  /** When this reading was taken, not when the posts were published. */
  takenAt: string
  followers: number | null
  posts: TrackedPost[]
}

export interface TrackedHandle {
  id: string
  platform: Platform
  handle: string
  displayName: string | null
  profileUrl: string
  avatarUrl: string | null
  /** Marks the accounts the office runs, as against the ones it watches. */
  own: boolean
  /** Free-text grouping the user controls — a party, a district, a rival. */
  label: string | null
  listingNote: string
  snapshots: HandleSnapshot[]
}

function read(): TrackedHandle[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as TrackedHandle[]) : []
  } catch {
    // A corrupt or quota-evicted entry must not take the dashboard down with
    // it; an empty list is recoverable, a thrown error on mount is not.
    return []
  }
}

function write(handles: TrackedHandle[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(handles))
  } catch {
    // Over quota. Drop the oldest snapshots rather than losing the handles
    // themselves — which accounts are tracked is the part the user typed in.
    const trimmed = handles.map((h) => ({ ...h, snapshots: h.snapshots.slice(-20) }))
    try {
      localStorage.setItem(KEY, JSON.stringify(trimmed))
    } catch {
      /* nothing further to try; the session still works, it just will not persist */
    }
  }
}

export function listHandles(): TrackedHandle[] {
  return read()
}

export function saveHandle(h: TrackedHandle): TrackedHandle[] {
  const all = read()
  const i = all.findIndex((x) => x.id === h.id)
  if (i === -1) all.push(h)
  else all[i] = h
  write(all)
  return all
}

export function removeHandle(id: string): TrackedHandle[] {
  const all = read().filter((h) => h.id !== id)
  write(all)
  return all
}

export const handleId = (platform: Platform, handle: string): string =>
  `${platform}:${handle.toLowerCase()}`

/** Record a reading, keeping the history bounded. */
export function addSnapshot(id: string, snapshot: HandleSnapshot): TrackedHandle[] {
  const all = read()
  const h = all.find((x) => x.id === id)
  if (!h) return all
  h.snapshots.push(snapshot)
  if (h.snapshots.length > MAX_SNAPSHOTS) h.snapshots = h.snapshots.slice(-MAX_SNAPSHOTS)
  write(all)
  return all
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived numbers
// ─────────────────────────────────────────────────────────────────────────────

export interface HandleStats {
  followers: number | null
  posts: number
  totalViews: number | null
  totalLikes: number | null
  totalComments: number | null
  /** Interactions per post, averaged. Null when nothing measurable came back. */
  avgEngagement: number | null
  /**
   * Interactions as a share of followers, per post. The comparable number: a
   * 20,000-follower account and a 2,000,000-follower one cannot be judged by
   * raw likes, and comparing them by raw likes is the mistake this exists to
   * prevent.
   */
  engagementRate: number | null
  postsPerWeek: number | null
  /** Views per post, where the platform publishes them. */
  avgViews: number | null
  /**
   * Comments as a share of all interactions.
   *
   * A like is a tap; a comment is a sentence someone chose to write. Two
   * accounts with the same engagement rate are doing different things if one
   * is 2% comments and the other 30% — the first is being applauded, the
   * second argued with. For a political office the second is the signal.
   */
  talkRatio: number | null
  /** How evenly posts perform: 0 is erratic, 1 is metronomic. */
  consistency: number | null
  best: { title: string | null; url: string; interactions: number } | null
}

export function statsFor(snapshot: HandleSnapshot | undefined): HandleStats {
  const empty: HandleStats = {
    followers: snapshot?.followers ?? null,
    posts: 0,
    totalViews: null,
    totalLikes: null,
    totalComments: null,
    avgEngagement: null,
    engagementRate: null,
    postsPerWeek: null,
    avgViews: null,
    talkRatio: null,
    consistency: null,
    best: null,
  }
  if (!snapshot?.posts.length) return empty

  const posts = snapshot.posts
  const sum = (pick: (p: TrackedPost) => number | null): number | null => {
    const vals = posts.map(pick).filter((v): v is number => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null
  }

  const likes = sum((p) => p.likes)
  const comments = sum((p) => p.comments)
  const interactions = (likes ?? 0) + (comments ?? 0)
  const measurable = likes != null || comments != null

  // Cadence, from the actual span between the oldest and newest post rather
  // than from a fixed window — a channel that posted five times last year and
  // a channel that posted five times last week are not the same.
  const dates = posts
    .map((p) => (p.publishedAt ? new Date(p.publishedAt).getTime() : null))
    .filter((t): t is number => t != null && Number.isFinite(t))
  let postsPerWeek: number | null = null
  if (dates.length >= 2) {
    const spanDays = (Math.max(...dates) - Math.min(...dates)) / 86_400_000
    if (spanDays > 0.5) postsPerWeek = Number(((posts.length / spanDays) * 7).toFixed(1))
  }

  const followers = snapshot.followers ?? null
  const views = sum((p) => p.views)

  // Per-post interaction totals, used for the best post and for spread.
  const perPost = posts.map((p) => (p.likes ?? 0) + (p.comments ?? 0))
  const mean = perPost.length ? perPost.reduce((a, b) => a + b, 0) / perPost.length : 0
  // Coefficient of variation, inverted and clamped: a channel whose posts all
  // land within a narrow band scores near 1, one with a single viral outlier
  // among flops scores near 0. Meaningless below three posts, so it is null.
  let consistency: number | null = null
  if (perPost.length >= 3 && mean > 0) {
    const sd = Math.sqrt(perPost.reduce((a, v) => a + (v - mean) ** 2, 0) / perPost.length)
    consistency = Number(Math.max(0, Math.min(1, 1 - sd / mean)).toFixed(2))
  }

  let best: HandleStats['best'] = null
  posts.forEach((p, i) => {
    const n = perPost[i] ?? 0
    if (!best || n > best.interactions) best = { title: p.title, url: p.url, interactions: n }
  })

  return {
    followers,
    posts: posts.length,
    totalViews: views,
    totalLikes: likes,
    totalComments: comments,
    avgEngagement: measurable ? Math.round(interactions / posts.length) : null,
    engagementRate:
      measurable && followers && followers > 0
        ? Number(((interactions / posts.length / followers) * 100).toFixed(3))
        : null,
    postsPerWeek,
    avgViews: views != null ? Math.round(views / posts.length) : null,
    talkRatio:
      comments != null && interactions > 0
        ? Number(((comments / interactions) * 100).toFixed(1))
        : null,
    consistency,
    best,
  }
}

/** Movement against the previous reading, for the trend line. */
export interface Delta {
  followers: number | null
  avgEngagement: number | null
  since: string | null
}

export function deltaFor(h: TrackedHandle): Delta {
  const n = h.snapshots.length
  if (n < 2) return { followers: null, avgEngagement: null, since: null }
  const now = statsFor(h.snapshots[n - 1])
  const before = statsFor(h.snapshots[n - 2])
  const diff = (a: number | null, b: number | null): number | null =>
    a != null && b != null ? a - b : null
  return {
    followers: diff(now.followers, before.followers),
    avgEngagement: diff(now.avgEngagement, before.avgEngagement),
    since: h.snapshots[n - 2]?.takenAt ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovered rivals
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoveredRival {
  name: string
  why: string
  cohort: string
  followers: number | null
  platforms: string[]
  profileUrl: string
}

export interface RivalCache {
  subject: string
  role: string
  rivals: DiscoveredRival[]
  checked: number
  discarded: number
  foundAt: string
}

const RIVALS_KEY = 'signal.rivals.v1'

/**
 * Discovery is cached because it is the expensive half.
 *
 * Working out who someone should be compared against costs a model call plus a
 * dozen live profile checks. Who a sitting MLA's rivals are does not change
 * between two taps of a tab, so re-deriving it on every visit would spend real
 * money to reprint the same list.
 */
export function readRivals(handleId: string): RivalCache | null {
  try {
    const all = JSON.parse(localStorage.getItem(RIVALS_KEY) ?? '{}') as Record<string, RivalCache>
    return all[handleId] ?? null
  } catch {
    return null
  }
}

export function saveRivals(handleId: string, cache: RivalCache): void {
  try {
    const all = JSON.parse(localStorage.getItem(RIVALS_KEY) ?? '{}') as Record<string, RivalCache>
    all[handleId] = cache
    localStorage.setItem(RIVALS_KEY, JSON.stringify(all))
  } catch {
    /* a cache that cannot be written is a slower app, not a broken one */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public standing
// ─────────────────────────────────────────────────────────────────────────────

export interface Standing {
  score: number
  label: string
  positive: number
  negative: number
  neutral: number
  praise: string[]
  criticism: string[]
  summary: string
  commentsRead: number
  postsRead: number
  readAt: string
}

const STANDING_KEY = 'signal.standing.v1'

/**
 * Cached because it is the most expensive thing this product does: several live
 * post fetches plus a model call, per account. What the public thinks of a
 * politician does not move between two taps of a tab.
 */
export function readStandingCache(handleId: string): Standing | null {
  try {
    const all = JSON.parse(localStorage.getItem(STANDING_KEY) ?? '{}') as Record<string, Standing>
    return all[handleId] ?? null
  } catch {
    return null
  }
}

export function saveStandingCache(handleId: string, standing: Standing): void {
  try {
    const all = JSON.parse(localStorage.getItem(STANDING_KEY) ?? '{}') as Record<string, Standing>
    all[handleId] = standing
    localStorage.setItem(STANDING_KEY, JSON.stringify(all))
  } catch {
    /* a cache that will not write is a slower app, not a broken one */
  }
}
