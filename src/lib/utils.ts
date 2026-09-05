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
  if (n == null || !Number.isFinite(n)) return 'NA'
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
  if (n == null || !Number.isFinite(n)) return 'NA'
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

/**
 * A quoted comment, with model control tokens stripped out.
 *
 * The readings are produced by a model, and a generation that slips a control
 * sentinel into its output ("జై బ<|channel|>...") carries it all the way to a
 * screen whose whole claim is that the words on it are what a person typed.
 * The sentinel is not a person's word, so it does not survive to the page.
 * The comment around it is left exactly as it was written.
 */
/**
 * Is this "title" the platform's own accessibility caption rather than words
 * the office wrote?
 *
 * Instagram and Facebook generate a description for every image and store it
 * where a caption would go, so a post with no written caption arrives titled
 * "Photo by DK Aruna on August 31, 2026. May be an image of one or more
 * people, people standing, dais and text that says ...". That is a machine
 * describing a picture to a screen reader. Printed as the post's title it
 * tells the office nothing it cannot see in the thumbnail directly above it,
 * and it crowds out the reading's own headline, which does say something.
 *
 * Matched on the platform's fixed phrasing rather than on length, so a long
 * caption somebody actually wrote is untouched.
 */
export function isPlatformAltText(title: string | null | undefined): boolean {
  const t = (title ?? '').trim()
  if (!t) return false
  return (
    /^photo (?:by|shared by) .+ on \w+ \d{1,2}, \d{4}/i.test(t) ||
    /^may be an (?:image|illustration) of/i.test(t) ||
    /^no photo description available/i.test(t) ||
    /^photo by /i.test(t)
  )
}

export function cleanQuote(text: string): string {
  const clean = text
    .replace(/<\|[^|]*\|>/g, '')
    .replace(COMMENT_PREFIX, '')
    .replace(COMMENT_CHROME, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  // A row that is nothing BUT the platform's furniture is not a comment at
  // all, so it cleans to the empty string every caller already skips. Done
  // last, on the cleaned text, so a real comment that happens to sit behind a
  // Facebook name-and-age prefix is judged on its own words.
  return COMMENT_IS_CHROME.test(clean) ? '' : clean
}

/**
 * The platform's own furniture, which is not part of what anybody wrote.
 *
 * Facebook renders the author, the age and any badge in the SAME text run as
 * the comment, with no separator between them, so a reading stored
 * "Karunakarreddy Patel · 22 घंटेమహబూబ్‌నగర్ …" and the desk was shown the
 * scraper's view of the page rather than the sentence a person typed. A few
 * comments are nothing but that furniture — a bare Like/Reply row — and clean
 * to an empty string, which is the correct answer: they were never comments.
 *
 * Deliberately narrow. The prefix must look like "<name> · <number> <unit>" at
 * the very start, and only the two known badge words are removed, so a comment
 * that merely contains a middle dot keeps every word of its text.
 */
const COMMENT_PREFIX =
  /^[^\n·]{2,40}·\s*\d+\s*(?:घंटे|दिन|मिनट|सप्ताह|सेकंड|साल|महीने|hours?|days?|weeks?|mins?|minutes?|[hdwmy])(?:\s*·\s*(?:टॉप\s*फ़ैन|Top\s*fan))?/u

const COMMENT_CHROME =
  /(लाइक\s*करें|जवाब\s*दें|अनुवाद\s*देखें|See\s*translation|टॉप\s*फ़ैन|Top\s*fan|GIPHY)/giu

/**
 * Rows that are the platform's comment LIST furniture, not a comment in it.
 *
 * Instagram renders each comment's age as its own text node ("2 d", "19 h",
 * "64 w") and paints a verified account's badge as the word "Verified" run
 * straight onto the username ("m_k_krishna_bjpVerified"). The scraper reads
 * text nodes, so eleven of these landed in the desk's stored comments: reel
 * DaApzwuOb-p held the seven comments Instagram actually published plus three
 * of them, and every count over that post read ten. Five carried a classified
 * side as well, so they voted in the sentiment split, and they were quoted
 * back to the office verbatim as things people had said.
 *
 * Matched against the WHOLE cleaned string rather than removed from inside
 * one, because both shapes occur inside genuine comments: "3 d" is how a
 * person writes a deadline and a comment may well name a verified account.
 * A row consisting of nothing else is furniture; a sentence containing it is
 * a sentence.
 *
 * The username shape is Instagram's own alphabet (letters, digits, full stops
 * and underscores) so a real one-word comment ending in "Verified" with any
 * other character in it survives.
 */
const COMMENT_IS_CHROME = /^(?:\d+\s*[smhdwy]|[A-Za-z0-9._]{1,30}Verified)$/u
