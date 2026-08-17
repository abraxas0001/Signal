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
  return {
    followers,
    posts: posts.length,
    totalViews: sum((p) => p.views),
    totalLikes: likes,
    totalComments: comments,
    avgEngagement: measurable ? Math.round(interactions / posts.length) : null,
    engagementRate:
      measurable && followers && followers > 0
        ? Number(((interactions / posts.length / followers) * 100).toFixed(3))
        : null,
    postsPerWeek,
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
