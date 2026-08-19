import type { GrievanceRecord } from '@shared/grievance'

/**
 * The desk's working day.
 *
 * The grievance list shows every record ever filed in one flat pile. That is
 * survivable for a week and unusable after it: the office works today's news,
 * and the first hour of today should not sit under five days of settled
 * stories. Everything here answers one question — which working day does this
 * record belong to — and answers it identically wherever the code runs.
 */

/**
 * IST, because the office reads in IST and a UTC day boundary cuts the day in
 * the wrong place.
 *
 * At +05:30 the hours from midnight to 05:30 local are still yesterday in UTC,
 * so a story filed at 1am on Wednesday gets shelved under Tuesday and is not on
 * the screen the desk opens that morning. The evening is fine — 19:00 IST is
 * 13:30 UTC, the same date — which is precisely why a naive
 * `toISOString().slice(0, 10)` passes review and then loses the late-night
 * records, the ones a night-desk files after a district story breaks.
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

/** The same offset as text, for stamping a zone onto a timestamp carrying none. */
const IST_SUFFIX = '+05:30'

/**
 * A date with no clock is already a day and must not be pushed through an
 * offset. Several publishers print only this.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** A trailing Z or +hh:mm / -hhmm — the timestamp says which zone it is in. */
const HAS_ZONE = /(?:[Zz]|[+-]\d{2}:?\d{2})$/

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** What everything here returns when the date cannot be read at all. */
const UNKNOWN = ''

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** The UTC calendar parts of a Date, as a day. Never throws. */
function isoDayOf(at: Date): string {
  if (Number.isNaN(at.getTime())) return UNKNOWN
  return `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

/**
 * An instant, as the day it fell on in Eluru.
 *
 * The conversion adds a fixed +05:30 to the epoch and then reads the UTC
 * calendar parts. Deliberately not `toLocaleDateString` with
 * `{ timeZone: 'Asia/Kolkata' }`: that depends on the ICU data compiled into
 * the runtime, and Netlify's Node and a developer's machine do not carry the
 * same zone tables — one throws RangeError on a zone it does not know, another
 * quietly falls back to the machine's own. The same record has to land in the
 * same bucket in both. India has never observed daylight saving, so the offset
 * is a constant and this arithmetic is exact rather than an approximation.
 */
function deskDayAt(epochMs: number): string {
  return isoDayOf(new Date(epochMs + IST_OFFSET_MS))
}

/**
 * Split a 'YYYY-MM-DD' back into numbers, refusing anything that is not a real
 * date. Without the round-trip check `Date.UTC` quietly rolls 2026-02-30 into
 * 2 March, so a bad stored day would move records to a day nobody asked for
 * instead of reading as unknown.
 */
function partsOf(day: string): { year: number; month: number; date: number } | null {
  const parsed = DAY.exec(day)
  if (!parsed) return null
  const [, y, m, d] = parsed
  if (!y || !m || !d) return null

  const year = Number(y)
  const month = Number(m)
  const date = Number(d)
  const at = new Date(Date.UTC(year, month - 1, date))
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== date) {
    return null
  }
  return { year, month, date }
}

/**
 * The desk day an ISO timestamp falls on, or '' when it cannot be read.
 *
 * Empty and malformed strings return '' rather than throwing or guessing.
 * Timestamps arrive from the extractor, from a paste and from stores written by
 * older versions; one bad string must not take out the whole day view.
 */
export function deskDayOf(iso: string | null): string {
  if (!iso) return UNKNOWN
  const text = iso.trim()
  if (!text) return UNKNOWN

  // A bare 'YYYY-MM-DD' is already a day. Parsing it gives UTC midnight, which
  // is 05:30 the same morning in IST, so it would survive the conversion
  // unchanged anyway — but only the validation is wanted, not the round trip.
  if (DATE_ONLY.test(text)) return partsOf(text) ? text : UNKNOWN

  // A timestamp with no zone is read as IST, which is what the extractor
  // already does for Indian publishers (parseDate in metadata.ts). Leaving it
  // to the engine means it is read as the machine's local time, and the same
  // record then buckets one way on a laptop in Eluru and another on Netlify.
  const stamped = HAS_ZONE.test(text) ? text : `${text}${IST_SUFFIX}`
  const ms = Date.parse(stamped)
  if (Number.isNaN(ms)) return UNKNOWN
  return deskDayAt(ms)
}

/** Today, in the office's own reckoning. `now` is injected so tests are fixed. */
export function todayDeskDay(now: Date = new Date()): string {
  return deskDayAt(now.getTime())
}

/**
 * The day as a heading: 'Tuesday, 18 August'.
 *
 * Written out from tables rather than through `toLocaleDateString`, for the
 * same reason the conversion is: the wording must not move with the runtime's
 * default locale. 'en-US' renders this as "Tuesday, August 18", and which
 * locale a server defaults to is not something this office chose.
 */
export function formatDeskDay(day: string): string {
  const parts = partsOf(day)
  if (!parts) return 'Date unknown'

  const weekday = WEEKDAYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.date)).getUTCDay()]
  const month = MONTHS[parts.month - 1]
  // Both indices are already bounded by the parse above; this guard is how that
  // is stated to the compiler, instead of a non-null assertion.
  if (!weekday || !month) return 'Date unknown'
  return `${weekday}, ${parts.date} ${month}`
}

export function isToday(day: string, now: Date = new Date()): boolean {
  const today = todayDeskDay(now)
  return today !== UNKNOWN && day === today
}

/**
 * A day some number of days away, for the back and forward arrows.
 *
 * The addition is done on UTC calendar parts, where `Date.UTC` normalises the
 * overflow — 31 August plus one is 1 September, and February knows its own
 * length. Adding 86,400,000ms to the epoch would give the same answer only
 * because IST has no daylight saving; this stays right regardless.
 */
export function shiftDay(day: string, deltaDays: number): string {
  const parts = partsOf(day)
  if (!parts) return UNKNOWN
  const moved = Date.UTC(parts.year, parts.month - 1, parts.date + Math.trunc(deltaDays))
  return isoDayOf(new Date(moved))
}

/**
 * The day a record belongs to.
 *
 * publishedAt when the article carried one, createdAt when it did not — and the
 * fallback is not a shrug. A story with no date is not undated to this office:
 * they read it today, so today is the day it has to be worked. Filing it as
 * unknown would drop it below every dated day on the one screen anyone opens.
 * A publication date we cannot parse takes the same route, because to the desk
 * that is indistinguishable from one that was never printed.
 */
export function recordDeskDay(record: GrievanceRecord): string {
  return deskDayOf(record.publishedAt) || deskDayOf(record.createdAt)
}

export interface DayBucket {
  day: string
  records: GrievanceRecord[]
}

/**
 * The records split into days, newest day first.
 *
 * Order within a day is the caller's, untouched. The list screen already ranks
 * with bySeverityThenRecency, and sorting again here would have thrown that
 * ranking away the moment grouping was switched on — a Critical record would
 * have dropped below a Low one filed a minute later.
 *
 * 'YYYY-MM-DD' compares correctly as text, so the days need no re-parsing to
 * sort. The '' bucket — records whose dates could not be read at all — falls to
 * the bottom under a descending compare, which is where it belongs: kept and
 * visible, never above today.
 */
export function groupByDay(records: GrievanceRecord[]): DayBucket[] {
  const byDay = new Map<string, GrievanceRecord[]>()
  for (const record of records) {
    const day = recordDeskDay(record)
    const bucket = byDay.get(day)
    if (bucket) bucket.push(record)
    else byDay.set(day, [record])
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, dayRecords]) => ({ day, records: dayRecords }))
}

/** One day's records, in the order they were given. */
export function recordsOnDay(records: GrievanceRecord[], day: string): GrievanceRecord[] {
  return records.filter((record) => recordDeskDay(record) === day)
}
