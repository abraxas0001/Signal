import type { TrackedHandle } from '@/lib/handles'
import { scopedKey } from '@/lib/store'
import { deskKey } from '@/lib/personas'
import { fetchWithTimeout } from '@/lib/net'

/**
 * The week's rivalry, computed once and read by two screens: the dashboard
 * card that says who won, and the Explore page that says how.
 *
 * Every figure is a count over dated posts in the same seven days, the window
 * anchored to the newest dated post anywhere on the desk — the demo dataset
 * is fixed, and a wall-clock week would empty both screens seven days after
 * capture. A person whose stored posts carry no dates cannot be placed in
 * any week and is left off rather than shown at zero.
 */

export interface WeekPost {
  platform: TrackedHandle['platform']
  title: string
  reactions: number
  views: number | null
}

export interface PersonWeek {
  name: string
  own: boolean
  avatarUrl: string | null
  /** The free-text label on the tracked handles — usually the party tag. */
  label: string | null
  posts: number
  reactions: number
  platforms: TrackedHandle['platform'][]
  /** Their week's posts, biggest first, capped for the prompt. */
  top: WeekPost[]
}

export interface WeekModel {
  label: string
  rows: PersonWeek[]
}

export interface WeekAnalysis {
  people: { name: string; playbook: string; bestPost: string; whyItWorked: string }[]
  lessons: string[]
  readAt: string
}

const WEEK_MS = 7 * 86_400_000

export function weekOf(handles: TrackedHandle[]): WeekModel | null {
  // The window's far edge: the newest dated post anywhere.
  let end: number | null = null
  for (const h of handles) {
    for (const p of h.snapshots[h.snapshots.length - 1]?.posts ?? []) {
      if (!p.publishedAt) continue
      const t = Date.parse(p.publishedAt)
      if (Number.isFinite(t) && (end === null || t > end)) end = t
    }
  }
  if (end === null) return null

  const byPerson = new Map<string, PersonWeek>()
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
        reactions: 0,
        platforms: [],
        top: [],
      } as PersonWeek)
    for (const p of h.snapshots[h.snapshots.length - 1]?.posts ?? []) {
      if (!p.publishedAt) continue
      const t = Date.parse(p.publishedAt)
      if (!Number.isFinite(t) || t < end - WEEK_MS || t > end) continue
      const reactions = (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0)
      entry.posts += 1
      entry.reactions += reactions
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
    .sort((a, b) => b.reactions - a.reactions)
  for (const r of rows) r.top = r.top.sort((a, b) => b.reactions - a.reactions).slice(0, 8)
  if (rows.length < 2 || !rows.some((r) => r.own)) return null

  const day = (t: number): string =>
    new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return { label: `${day(end - WEEK_MS)} to ${day(end)}`, rows }
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
