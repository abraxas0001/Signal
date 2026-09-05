/**
 * The dashboard's time window: the last week, month or six months, or
 * everything stored.
 *
 * ANCHORED TO TODAY, at the office's instruction. These windows used to
 * anchor on the newest dated post the desk holds, so that a desk read in one
 * batch never showed an empty week — but the office read the resolved label
 * ("20 Aug to 27 Aug") against a calendar that said 4 September and called
 * the control broken, and they are right about what "last 7 days" promises:
 * it counts back from now. The cost is honest instead of hidden — a desk
 * whose accounts have not been read this week now SAYS the week is empty
 * rather than quietly sliding the window back to wherever the data is, and
 * the six-month window exists so a sparse week is one press from context.
 */

export type WindowId = 'week' | 'month' | 'half' | 'all'

export const WINDOWS: { id: WindowId; label: string }[] = [
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'Last 30 days' },
  { id: 'half', label: 'Last 6 months' },
  { id: 'all', label: 'All time' },
]

const DAY_MS = 86_400_000

/** How far back each window reaches, in days. Null when it never cuts. */
export function windowDays(id: WindowId): number | null {
  if (id === 'week') return 7
  if (id === 'month') return 30
  if (id === 'half') return 180
  return null
}

/**
 * The moment the windows count back from: now.
 *
 * A plain function rather than a constant so every render asks the clock,
 * and a desk left open overnight does not keep yesterday's window.
 */
export function presentAnchor(): string {
  return new Date().toISOString()
}

/** The newest post date across the handles' latest snapshots, ISO or null. */
export function newestPostDate(dates: (string | null | undefined)[]): string | null {
  let newest: string | null = null
  for (const d of dates) {
    if (d && (!newest || d > newest)) newest = d
  }
  return newest
}

/** The cutoff ISO for a window, or null when everything qualifies. */
export function windowStart(anchor: string | null, id: WindowId): string | null {
  const days = windowDays(id)
  if (days === null || !anchor) return null
  return new Date(Date.parse(anchor) - days * DAY_MS).toISOString()
}

/** Whether one dated thing falls inside the window. Undated only fits "all". */
export function inWindow(date: string | null | undefined, start: string | null): boolean {
  if (start === null) return true
  return Boolean(date && date >= start)
}

/** "18 Aug – 27 Aug 2026", from the resolved cutoff and anchor. */
export function windowLabel(anchor: string | null, id: WindowId): string {
  const fmt = (iso: string): string =>
    new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  if (!anchor) return 'No dated posts'
  if (id === 'all') return `Up to ${fmt(anchor)}`
  const start = windowStart(anchor, id)!
  return `${fmt(start)} to ${fmt(anchor)}`
}

/**
 * WHY A WIDER WINDOW SHOWED THE SAME FIGURES.
 *
 * The office switched a card from Last 7 days to Last 30 days, watched every
 * number stay put, and read it as a broken filter. It was not: every item the
 * card counts is younger than a week, so the two windows hold the same set.
 *
 * That is a fact worth one sentence and worth nothing more — so this returns a
 * clause ONLY when it is true, and empty otherwise. It never manufactures a
 * difference, which is the one thing a card must not do to make a control look
 * alive: the figures are about a real person, and a fabricated movement is
 * worse than an unexplained stillness.
 *
 * `oldest` is the earliest item the card actually counted, ISO. `windowId` is
 * what the picker currently shows.
 */
export function sameWindowNote(oldest: string | null, windowId: WindowId): string {
  if (windowId === 'week' || oldest === null) return ''
  const age = Date.now() - new Date(oldest).getTime()
  if (!Number.isFinite(age)) return ''
  if (age >= 7 * DAY_MS) return ''
  return 'Everything here is under a week old, so Last 7 days shows the same.'
}
