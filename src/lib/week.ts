import type { TrackedHandle, TrackedPost } from '@/lib/handles'
import type { Report } from '@shared/types'
import { scopedKey } from '@/lib/store'
import { deskKey } from '@/lib/personas'
import { fetchWithTimeout } from '@/lib/net'

/**
 * The week's rivalry, computed once and read by two screens: the dashboard
 * card that says who won, and the Explore page that says how.
 *
 * Every figure is a count over dated posts in the same seven days, the window
 * anchored to the newest dated post anywhere on the desk: the demo dataset
 * is fixed, and a wall-clock week would empty both screens seven days after
 * capture. A person whose stored posts carry no dates cannot be placed in
 * any week and is left off rather than shown at zero.
 *
 * A DATE IS LOOKED FOR IN BOTH PLACES THE DESK KEEPS ONE. The collector reads
 * a publication date off the post listing on Twitter/X and almost nowhere
 * else: 0 of 293 stored Facebook posts and 13 of 300 Instagram posts carry
 * one. The full readings in demo-reports.json carry an exact publishedAt for
 * 61 of the rest, and the neighbouring cards already resolve the date from
 * both. Reading only the listing's date does not give a cautious answer here,
 * it gives a wrong one: on the Rahul desk this card read "Narendra Modi leads
 * this week: 204,621 reactions on 18 posts. You: 192,920 on 6", and over the
 * dates the app already held the same seven days are Rahul 1,024,844 on 11
 * against Modi 559,521 on 23. The stated leader was the other man.
 *
 * What is still genuinely undated stays out, and `undated` says how many that
 * is so the card can print the limitation rather than absorb it.
 */

export interface WeekPost {
  platform: TrackedHandle['platform']
  title: string
  /** Null where the platform published no like, comment or share figure. */
  reactions: number | null
  views: number | null
}

export interface PersonWeek {
  name: string
  own: boolean
  avatarUrl: string | null
  /** The free-text label on the tracked handles — usually the party tag. */
  label: string | null
  posts: number
  /**
   * Reactions over the posts that actually published a figure.
   *
   * Null when NONE of the week's posts did. YouTube publishes a view count and
   * no likes or comments, so a rival tracked only there was previously scored
   * at zero reactions and drawn as an empty bar — a verdict about their week
   * rather than about what YouTube discloses.
   */
  reactions: number | null
  /** How many of `posts` carried a reaction figure, so a mean has a denominator. */
  postsWithReactions: number
  platforms: TrackedHandle['platform'][]
  /** Their week's posts, biggest first, capped for the prompt. */
  top: WeekPost[]
}

export interface WeekModel {
  label: string
  rows: PersonWeek[]
  /**
   * Stored posts on these accounts with no publication date in either place,
   * so they sit in no week at all. Printed on the card: a comparison that
   * silently drops posts is a verdict about a week nobody can check.
   */
  undated: number
}

export interface WeekAnalysis {
  people: { name: string; playbook: string; bestPost: string; whyItWorked: string }[]
  lessons: string[]
  readAt: string
}

const WEEK_MS = 7 * 86_400_000

/**
 * When a post went up: the listing's own date, else the one its stored full
 * reading carries. The same resolution ContentInsights and the comparison
 * board make, so the three surfaces place a post in the same week.
 */
function dateOf(p: TrackedPost, reports: Map<string, Report> | null | undefined): string | null {
  return p.publishedAt ?? reports?.get(p.url)?.snapshot.publishedAt ?? null
}

export function weekOf(
  handles: TrackedHandle[],
  /**
   * The stored full readings, for the dates the listing scrape did not carry.
   *
   * Optional only so a caller that has not got the map to hand still compiles.
   * Passing nothing is not a neutral choice: it is the narrower count the
   * header comment shows reversing a verdict, so every caller should hand over
   * the same map the dashboard holds. WeekCompare.tsx and post-plan.ts do not
   * yet, and until they do the Weekly page can name a different leader from
   * the card that links to it.
   */
  reports?: Map<string, Report> | null,
): WeekModel | null {
  // The window's far edge: the newest dated post anywhere.
  let end: number | null = null
  for (const h of handles) {
    for (const p of h.snapshots[h.snapshots.length - 1]?.posts ?? []) {
      const at = dateOf(p, reports)
      if (!at) continue
      const t = Date.parse(at)
      if (Number.isFinite(t) && (end === null || t > end)) end = t
    }
  }
  if (end === null) return null

  const byPerson = new Map<string, PersonWeek>()
  /** Posts that carry no date in either place, so they sit in no week. */
  let undated = 0
  for (const h of handles) {
    const name = h.displayName || h.handle
    const entry =
      byPerson.get(name) ??
      ({
        name,
        own: h.own,
        avatarUrl: h.avatarUrl,
        label: h.label,
        posts: 0,
        reactions: null,
        postsWithReactions: 0,
        platforms: [],
        top: [],
      } as PersonWeek)
    for (const p of h.snapshots[h.snapshots.length - 1]?.posts ?? []) {
      const at = dateOf(p, reports)
      if (!at) {
        undated += 1
        continue
      }
      const t = Date.parse(at)
      if (!Number.isFinite(t)) {
        undated += 1
        continue
      }
      if (t < end - WEEK_MS || t > end) continue
      // A post the platform published nothing for is not a post with no
      // reactions. Only figures that were actually disclosed are summed.
      const published = p.likes != null || p.comments != null || p.shares != null
      const reactions = published ? (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) : null
      entry.posts += 1
      if (reactions != null) {
        entry.reactions = (entry.reactions ?? 0) + reactions
        entry.postsWithReactions += 1
      }
      if (!entry.platforms.includes(h.platform)) entry.platforms.push(h.platform)
      entry.top.push({
        platform: h.platform,
        title: p.title?.trim() || '(no caption)',
        reactions,
        views: p.views ?? null,
      })
    }
    if (!entry.avatarUrl && h.avatarUrl) entry.avatarUrl = h.avatarUrl
    if (!entry.label && h.label) entry.label = h.label
    byPerson.set(name, entry)
  }

  const rows = [...byPerson.values()]
    .filter((p) => p.posts > 0)
    .sort((a, b) => (b.reactions ?? -1) - (a.reactions ?? -1))
  for (const r of rows) r.top = r.top.sort((a, b) => (b.reactions ?? -1) - (a.reactions ?? -1)).slice(0, 8)
  if (rows.length < 2 || !rows.some((r) => r.own)) return null

  const day = (t: number): string =>
    new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return { label: `${day(end - WEEK_MS)} to ${day(end)}`, rows, undated }
}

/* ── the AI reading, cached per window ───────────────────────────────────── */

const CACHE_KEY = (): string => deskKey('signal.weekCompare.v1')

export function readWeekAnalysisCache(label: string): WeekAnalysis | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY())
    if (!raw) return null
    const all = JSON.parse(raw) as Record<string, WeekAnalysis>
    return all[label] ?? null
  } catch {
    return null
  }
}

function saveCache(label: string, a: WeekAnalysis): void {
  try {
    // One window's reading at a time: last week's analysis of last week's
    // posts is not worth the quota it sits in.
    localStorage.setItem(CACHE_KEY(), JSON.stringify({ [label]: a }))
  } catch {
    /* over quota: the reading still shows this session */
  }
}

/** One request to the reader. Throws with a plain sentence when it fails. */
async function requestWeekAnalysis(week: WeekModel): Promise<WeekAnalysis> {
  const res = await fetchWithTimeout(
    '/api/week-compare',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        window: week.label,
        people: week.rows.slice(0, 5).map((r) => ({ name: r.name, own: r.own, posts: r.top })),
      }),
    },
    60_000,
  )
  // No status codes in these sentences. "HTTP 500" told the office nothing it
  // could act on and made the product look broken in a different way than it
  // was; the sentence's whole job is "wait, then press the button again".
  let body: Partial<WeekAnalysis> & { error?: string }
  try {
    body = (await res.json()) as Partial<WeekAnalysis> & { error?: string }
  } catch {
    throw new Error('The reading took too long. Try again in a minute.')
  }
  if (!res.ok || body.error || !Array.isArray(body.people)) {
    throw new Error(body.error ?? 'The reading did not come back. Try again in a minute.')
  }
  return body as WeekAnalysis
}

/** Fetch the close reading, from the cache unless forced. Throws with a sentence. */
export async function loadWeekAnalysis(week: WeekModel, force = false): Promise<WeekAnalysis> {
  if (!force) {
    const cached = readWeekAnalysisCache(week.label)
    if (cached) return cached
  }
  let analysis: WeekAnalysis
  try {
    analysis = await requestWeekAnalysis(week)
  } catch {
    // Once more before giving up. The reading leans on a model that is slow
    // roughly one run in three and fine the next; measured on the example
    // desks, the retry turns most first-click failures into a longer wait
    // instead of an error card.
    analysis = await requestWeekAnalysis(week)
  }
  saveCache(week.label, analysis)
  return analysis
}

/**
 * The analysed person's row, matched loosely: the model trims honorifics and
 * initials ("A. Revanth Reddy" comes back "Revanth Reddy"), and an exact
 * match silently drops the figures off his card.
 */
export function rowFor(week: WeekModel, name: string): PersonWeek | null {
  const n = name.toLowerCase()
  return (
    week.rows.find((r) => r.name.toLowerCase() === n) ??
    week.rows.find((r) => r.name.toLowerCase().includes(n) || n.includes(r.name.toLowerCase())) ??
    null
  )
}
