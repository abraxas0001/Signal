import type { Platform } from '@shared/taxonomy'
import { scopedKey } from '@/lib/store'

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

/**
 * Scoped per signed-in account, not device-wide.
 *
 * Read through a function rather than captured in a constant on purpose: the
 * active account changes at runtime when somebody signs in or out, and a
 * module-level constant would freeze whichever account happened to be active
 * when this module was first imported.
 */
const KEY = (): string => scopedKey('signal.handles.v1')
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
  /**
   * The post's own picture, already downloaded and served from this origin.
   *
   * Never a platform CDN address. Those hosts refuse cross-origin embedding and
   * their signed URLs expire within days, so one stored here would render as a
   * broken image within the week — `scraper:media` downloads them and rewrites
   * this to a local path. Null for a text-only post, which renders as the
   * platform's own tile.
   */
  thumbnailUrl?: string | null
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
    const raw = localStorage.getItem(KEY())
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
    localStorage.setItem(KEY(), JSON.stringify(handles))
  } catch {
    // Over quota. Drop the oldest snapshots rather than losing the handles
    // themselves — which accounts are tracked is the part the user typed in.
    const trimmed = handles.map((h) => ({ ...h, snapshots: h.snapshots.slice(-20) }))
    try {
      localStorage.setItem(KEY(), JSON.stringify(trimmed))
    } catch {
      /* nothing further to try; the session still works, it just will not persist */
    }
  }
}

export function listHandles(): TrackedHandle[] {
  return read()
}

/**
 * Replace the whole tracked list in one write.
 *
 * `saveHandle` is the right call when a person adds or refreshes one account.
 * Seeding a set of them through it would mean one `localStorage` write per
 * handle, each re-serialising the whole list — and on a demo roster of two
 * politicians across four platforms that is eight full rewrites to land one
 * state. This does it once.
 *
 * Deliberately destructive, and therefore never called on a store that holds
 * someone's real work: see the demo loader, which only seeds an empty store or
 * one the reader explicitly asked to replace.
 */
export function replaceAllHandles(handles: TrackedHandle[]): TrackedHandle[] {
  write(handles)
  return handles
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

const RIVALS_KEY = (): string => scopedKey('signal.rivals.v1')

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
    const all = JSON.parse(localStorage.getItem(RIVALS_KEY()) ?? '{}') as Record<string, RivalCache>
    return all[handleId] ?? null
  } catch {
    return null
  }
}

export function saveRivals(handleId: string, cache: RivalCache): void {
  try {
    const all = JSON.parse(localStorage.getItem(RIVALS_KEY()) ?? '{}') as Record<string, RivalCache>
    all[handleId] = cache
    localStorage.setItem(RIVALS_KEY(), JSON.stringify(all))
  } catch {
    /* a cache that cannot be written is a slower app, not a broken one */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public standing
// ─────────────────────────────────────────────────────────────────────────────

export interface Standing {
  /**
   * −100 to +100, or null when no score was produced.
   *
   * Null and zero are different claims and must stay apart: zero says the
   * coverage read is genuinely balanced, null says nothing was scored.
   */
  score: number | null
  /**
   * The two magnitudes the score is the difference of, 0–100 each.
   *
   * Without them a zero is unreadable: loudly praised AND loudly attacked
   * comes to zero, and so does nobody mentioning you at all. Those are
   * opposite findings and an office needs to know which one it is looking at.
   * Null on readings taken before these were recorded.
   */
  favourable?: number | null
  hostile?: number | null
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
  /**
   * Where the reading came from, and it has to be on the record because the two
   * are not the same claim.
   *
   * 'comments' means people's own words under this account's posts. 'record'
   * means published coverage about the person — editorials, reporting,
   * opposition statements — which is what the grounded survey reads when no
   * comments are reachable, and that is the usual case: Facebook, Instagram and
   * LinkedIn hand a server nothing without a page token the office rarely has.
   *
   * A record reading is not a sample of constituents and must never be shown as
   * one. Older cached entries have no field; they were all comment readings, so
   * an absent value reads as 'comments'.
   */
  source?: 'comments' | 'record'
  /** Publishers the record reading rested on. Empty for a comment reading. */
  sources?: { title: string; url: string | null }[]
  /** What the reader has to be told before trusting it. */
  caveats?: string[]
}

/**
 * Turn a grounded opinion survey into a Standing.
 *
 * The two readings answer the same question from different evidence, so they
 * share a shape and the screen renders one component. What they do NOT share is
 * a positive/neutral/negative split: that comes from counting comments, and a
 * reading of published coverage has nothing to count. Those three fields are
 * therefore left at zero and the UI draws no bar for a record reading — rather
 * than deriving a plausible-looking 60/25/15 from the score, which would be a
 * number nobody measured, presented in the one place on this screen that looks
 * most like a measurement.
 */
export function standingFromSurvey(survey: Record<string, unknown>): Standing {
  const themes = (raw: unknown): string[] =>
    (Array.isArray(raw) ? raw : [])
      .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
      .map((t) => {
        const label = typeof t['label'] === 'string' ? t['label'] : ''
        const who = typeof t['who'] === 'string' && t['who'].trim() ? t['who'].trim() : ''
        return who ? `${label} (${who})` : label
      })
      .filter(Boolean)

  /**
   * Null when the survey returned no score at all — NOT zero.
   *
   * Zero on this scale is a real finding: it means the coverage read is
   * genuinely balanced between praise and criticism. Falling back to it when
   * the model returned nothing made those two states identical on screen, and
   * the app then labelled a missing reading "Coverage divided" — a verdict
   * nobody reached, in the one place on the card that looks most like a
   * measurement.
   */
  const score =
    typeof survey['score'] === 'number' && Number.isFinite(survey['score'])
      ? Math.max(-100, Math.min(100, Math.round(survey['score'])))
      : null

  const mag = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null
  const favourable = mag(survey['favourable'])
  const hostile = mag(survey['hostile'])

  /**
   * "Divided" and "barely covered" both land near zero and are opposite
   * findings, so the label distinguishes them from the magnitudes rather than
   * from the score. Below 15 on both sides nobody is saying much at all, and
   * calling that "divided" credits the coverage with a balance it never had.
   */
  const quiet = favourable !== null && hostile !== null && favourable < 15 && hostile < 15

  return {
    score,
    favourable,
    hostile,
    // Named for coverage, not for a crowd. "Mostly warm" is a claim about what
    // has been written; "Mostly positive" would be read as a claim about voters.
    label:
      score === null
        ? 'Not scored'
        : quiet
          ? 'Barely covered'
          : score > 25
            ? 'Coverage mostly warm'
            : score < -25
              ? 'Coverage mostly hostile'
              : 'Coverage divided',
    positive: 0,
    neutral: 0,
    negative: 0,
    praise: themes(survey['praise']),
    criticism: [...themes(survey['criticism']), ...themes(survey['controversies'])],
    summary: typeof survey['verdict'] === 'string' ? survey['verdict'] : '',
    commentsRead: 0,
    postsRead: 0,
    readAt: new Date().toISOString(),
    source: 'record',
    sources: (Array.isArray(survey['sources']) ? survey['sources'] : [])
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .map((x) => ({
        title: typeof x['title'] === 'string' ? x['title'] : '',
        url: typeof x['url'] === 'string' ? x['url'] : null,
      }))
      .filter((x) => x.title),
    caveats: (Array.isArray(survey['caveats']) ? survey['caveats'] : []).filter(
      (c): c is string => typeof c === 'string' && c.trim().length > 0,
    ),
  }
}

const STANDING_KEY = (): string => scopedKey('signal.standing.v1')

/**
 * Cached because it is the most expensive thing this product does: several live
 * post fetches plus a model call, per account. What the public thinks of a
 * politician does not move between two taps of a tab.
 */
export function readStandingCache(handleId: string): Standing | null {
  try {
    const all = JSON.parse(localStorage.getItem(STANDING_KEY()) ?? '{}') as Record<string, Standing>
    return all[handleId] ?? null
  } catch {
    return null
  }
}

export function saveStandingCache(handleId: string, standing: Standing): void {
  try {
    const all = JSON.parse(localStorage.getItem(STANDING_KEY()) ?? '{}') as Record<string, Standing>
    all[handleId] = standing
    localStorage.setItem(STANDING_KEY(), JSON.stringify(all))
  } catch {
    /* a cache that will not write is a slower app, not a broken one */
  }
}

/**
 * Posts the user has already analysed that belong to a tracked account.
 *
 * The bridge for the gated platforms. Facebook, Instagram, LinkedIn and X will
 * not list an account's posts to a stranger, so those accounts can never be
 * crawled — but every post read through this product was read in full,
 * comments included. Matching them back to the account turns a permanently
 * blank row into a real sample.
 *
 * Matched on platform plus author handle, falling back to the display name,
 * because the same person's handle is spelled differently across platforms
 * and an unmatched post is better than one attributed to the wrong account.
 */
export function analysedPostsFor(handle: TrackedHandle): string[] {
  let entries: { url?: string; platform?: string; report?: unknown }[] = []
  try {
    entries = JSON.parse(localStorage.getItem(scopedKey('signal:history:v1')) ?? '[]') as typeof entries
  } catch {
    return []
  }

  const want = handle.handle.replace(/^@/, '').toLowerCase()
  const wantName = (handle.displayName ?? '').trim().toLowerCase()

  const urls: string[] = []
  for (const e of entries) {
    if (!e.url || e.platform !== handle.platform) continue
    const snap = (e.report as { snapshot?: { author?: { handle?: string; name?: string } } })
      ?.snapshot
    const h = (snap?.author?.handle ?? '').replace(/^@/, '').toLowerCase()
    const n = (snap?.author?.name ?? '').trim().toLowerCase()
    if (h === want || (wantName && n === wantName)) urls.push(e.url)
  }
  // Newest first: recent posts describe the audience the account has now.
  return [...new Set(urls)]
}
