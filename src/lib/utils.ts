import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Compact number formatting using the Indian numbering system, because the
 * audience reads in lakh and crore. 12,00,000 → "12L", not "1.2M".
 */
export function compact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e7) return `${trim(n / 1e7)}Cr`
  if (abs >= 1e5) return `${trim(n / 1e5)}L`
  if (abs >= 1e3) return `${trim(n / 1e3)}K`
  return String(n)
}

function trim(v: number): string {
  // 1.0 → "1", 1.24 → "1.2"
  const r = Math.round(v * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/** Full precision with Indian digit grouping, for tooltips and detail rows. */
export function full(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-IN')
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''

  const secs = Math.round((Date.now() - then) / 1000)
  if (secs < 60) return 'just now'

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  for (const [unit, secondsIn] of units) {
    if (secs >= secondsIn) return rtf.format(-Math.floor(secs / secondsIn), unit)
  }
  return 'just now'
}

export function absoluteDate(iso: string | null | undefined): string {
  if (!iso) return 'Date unknown'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Date unknown'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Detects Telugu, Devanagari, Tamil, Kannada, Malayalam, Bengali, Gujarati. */
export function isIndicScript(text: string | null | undefined): boolean {
  if (!text) return false
  return /[ऀ-෿]/.test(text)
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Clamp a −100…100 sentiment score to a 0…1 position for the meter. */
export function scoreToPosition(score: number): number {
  return Math.min(1, Math.max(0, (score + 100) / 200))
}

export function pluralise(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many
}
