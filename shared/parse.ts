/**
 * Count parsing, shared by the server adapters and the rescue sheet.
 *
 * It lives in shared/ deliberately. The rescue sheet exists because a platform
 * withheld its counts, so the user copies what the platform showed them —
 * "1.2K", "12L", "3.4M". An input that strips non-digits turns "1.2K" into 12
 * and stores it as a measurement, which is worse than having no number at all.
 * One implementation, used by both sides, is the only way those agree.
 */

/**
 * Indic digits, so a user typing on a Telugu or Hindi keyboard is understood.
 * Each block runs 0-9 consecutively from its base codepoint.
 */
const INDIC_DIGIT_BASES = [
  0x0966, // Devanagari
  0x09e6, // Bengali
  0x0a66, // Gurmukhi
  0x0ae6, // Gujarati
  0x0b66, // Odia
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
]

/** Rewrite any Indic digit as its ASCII equivalent, leaving everything else. */
export function normaliseDigits(input: string): string {
  let out = ''
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0
    const base = INDIC_DIGIT_BASES.find((b) => cp >= b && cp <= b + 9)
    out += base ? String(cp - base) : ch
  }
  return out
}

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  m: 1_000_000,
  mn: 1_000_000,
  million: 1_000_000,
  b: 1_000_000_000,
  bn: 1_000_000_000,
  billion: 1_000_000_000,
  l: 100_000,
  lakh: 100_000,
  lac: 100_000,
  lakhs: 100_000,
  cr: 10_000_000,
  crore: 10_000_000,
  crores: 10_000_000,
}

/**
 * "1.2K" → 1200 · "42k" → 42000 · "1,23,456" → 123456 · "12 లక్ష" → 1200000
 * Returns null for anything that is not a count, including "NA" and "—".
 */
export function parseCount(input: string | number | null | undefined): number | null {
  if (input == null) return null
  if (typeof input === 'number') return Number.isFinite(input) ? input : null

  const s = normaliseDigits(String(input))
    .trim()
    .toLowerCase()
    // Both grouping conventions, plus the Indian 1,23,456 form.
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')

  if (!s || /^(na|n\/a|-+|—|–|nil|none|unknown)$/.test(s)) return null

  // A leading number, then an optional unit. Anything else is not a count.
  const m = /^([\d]+(?:\.\d+)?)\s*([a-z]*)/.exec(s)
  if (!m?.[1]) return null

  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null

  const unit = (m[2] ?? '').trim()
  if (!unit) return Math.round(n)

  const mult = MULTIPLIERS[unit]
  // An unrecognised suffix means we did not understand the value; guessing at
  // it would produce a confident wrong number, which is the thing to avoid.
  return mult ? Math.round(n * mult) : null
}

/**
 * Parse for a form field: distinguishes "left blank" from "typed something we
 * cannot read", so the interface can show an error rather than silently
 * substituting a wrong number.
 */
export type CountParse =
  | { state: 'empty' }
  | { state: 'ok'; value: number }
  | { state: 'invalid' }

export function parseCountField(raw: string): CountParse {
  if (!raw.trim()) return { state: 'empty' }
  const value = parseCount(raw)
  if (value == null || value < 0) return { state: 'invalid' }
  return { state: 'ok', value }
}
