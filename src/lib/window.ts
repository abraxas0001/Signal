/**
 * The dashboard's time window: last week, last month, or everything stored.
 *
 * Anchored to the newest DATED POST the desk holds, not to the clock. The
 * readings are taken in batches — on the example desk everything was read on
 * one day — and a wall-clock week would empty every section on any visit
 * that falls a week after the last reading, which says something about the
 * calendar, not the desk. The picker's label carries the resolved dates so
 * the anchor is never a secret.
 */

export type WindowId = 'week' | 'month' | 'all'

export const WINDOWS: { id: WindowId; label: string }[] = [
  { id: 'week', label: 'Last week' },
  { id: 'month', label: 'Last month' },
  { id: 'all', label: 'All time' },
]

const DAY_MS = 86_400_000

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
  if (id === 'all' || !anchor) return null
  const days = id === 'week' ? 7 : 30
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
