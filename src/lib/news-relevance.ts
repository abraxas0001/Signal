import { scopedKey } from '@/lib/store'
import { deskKey } from '@/lib/personas'

/**
 * What the desk believes about whether a story is actually about this member.
 *
 * News relevance in this product has, until now, been pure word matching:
 * `matchTags` in the scanner folds a headline and its URL together and tests
 * whole-word containment of each watch term. That single mechanism produces
 * both of the complaints the office has made about the morning scan.
 *
 *   It misses. A story that says "the Mahabubnagar MP told reporters" never
 *   carries the member's name, so the scan never sees it.
 *
 *   It over-admits. A watch term of "Aruna" matches a cricketer, and a term of
 *   "Gadwal" matches a district sports meet, so the desk opens on volleyball.
 *
 * The server half of the fix judges each candidate and returns a verdict for
 * every one of them rather than dropping any. This module is the client half:
 * it remembers those verdicts between sessions, and it holds the one rule that
 * every screen must apply the same way.
 *
 * The rule is deliberately asymmetric, because the two mistakes are not equally
 * expensive. Showing an office a story about their party that they did not
 * strictly need costs them four seconds. Hiding a story that was about them
 * costs them the morning. So only `unrelated` is ever hidden. A story the judge
 * could not reach at all is shown and labelled: the office asked to stop seeing
 * sport, not to stop seeing news.
 */

/* ── the vocabulary ──────────────────────────────────────────────────────── */

/**
 * `unjudged` is part of the vocabulary rather than an absence of one.
 *
 * Modelling "no verdict" as null pushed the decision onto every caller, and
 * two callers made it differently: one showed unjudged stories, the other
 * treated a missing verdict as a failed check and dropped them. Naming the
 * state means there is one answer and it is written down here.
 */
export type Relevance =
  | 'about-person'
  | 'about-seat'
  | 'seat-routine'
  | 'about-party'
  | 'unrelated'
  | 'unjudged'

export type Confidence = 'high' | 'medium' | 'low'

export interface Verdict {
  url: string
  verdict: Relevance
  /** Null when the judge produced no confidence, which is not the same as low. */
  confidence: Confidence | null
  /** The judge's reason, in its own words, so a filter can be argued with. */
  why: string | null
  /**
   * How the story reached the desk, which decides what `unjudged` is worth.
   *
   * `matched` means it carried a word this office watches. `harvested` means
   * the scanner took the whole front page and this story matched nothing at
   * all. The distinction is load-bearing: an unjudged MATCHED story still has
   * word-match evidence behind it and is worth showing, and an unjudged
   * HARVESTED story has no evidence of any kind. Absent on verdicts written
   * before the field existed, and those are treated as matched, which is what
   * the desk did with them at the time.
   */
  via?: 'matched' | 'harvested'
}

const RELEVANCES: readonly Relevance[] = [
  'about-person',
  'about-seat',
  'seat-routine',
  'about-party',
  'unrelated',
  'unjudged',
]

const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low']

/* ── the rule ────────────────────────────────────────────────────────────── */

/**
 * The one predicate every screen filters on.
 *
 * THE RULE THE OFFICE ASKED FOR, in their words: show news about the member,
 * or about her electoral location where her involvement is required or could
 * be important. Nothing else.
 *
 * about-person  shows. This is the member, and it is the whole point.
 * about-seat    shows, labelled. Her constituency, on something an elected
 *               member is expected to act on, ask about, fund or answer for.
 * seat-routine  hides, counted, revealable. It happened in her district and
 *               needs nobody: one crime, one exam conducted normally, one
 *               donation to one school. This category exists because the desk
 *               used to file all of it under about-seat and open on it.
 * about-party   hides, counted, revealable. A Mahabubnagar desk was handed a
 *               party tour of Karimnagar every morning, two hundred kilometres
 *               from the seat, and party business elsewhere in the state is not
 *               what the office asked to see.
 * unjudged      shows ONLY when the story carried a word this office watches.
 *               A matched story nobody checked still has evidence behind it.
 *               A story swept up by a whole-front-page harvest and never
 *               judged has none, and showing it is how a district paper's
 *               entire front page reached the desk.
 * unrelated     hides, counted, revealable. Never deleted.
 *
 * Everything hidden is COUNTED AND REVEALABLE. That is not a courtesy: a
 * filter this sharp is wrong sometimes, and an office that cannot see what was
 * set aside cannot correct it.
 */
export function worthShowing(v: Verdict): boolean {
  if (v.verdict === 'about-person' || v.verdict === 'about-seat') return true
  if (v.verdict === 'unjudged') return v.via !== 'harvested'
  return false
}

/**
 * Whether a shown story needs a word on it explaining what it is.
 *
 * `about-person` is the norm on this desk, and a badge on the norm is
 * decoration rather than information: if every card is labelled, the label
 * stops being a signal and the one card that is only about the party no longer
 * stands out.
 */
export function needsLabel(v: Verdict): boolean {
  return v.verdict !== 'about-person'
}

export interface RelevanceCounts {
  /** Every story considered, before anything was filtered. */
  total: number
  /** How many survive the rule above. */
  shown: number
  aboutPerson: number
  aboutSeat: number
  /** Her district, but nothing an elected member is needed for. Hidden. */
  seatRoutine: number
  aboutParty: number
  /** Nothing checked them. Shown when they carried a watched word, else not. */
  unjudged: number
  unrelated: number
  /** Everything the rule set aside, whatever the reason. */
  hidden: number
}

export function countVerdicts(verdicts: readonly Verdict[]): RelevanceCounts {
  const counts: RelevanceCounts = {
    total: verdicts.length,
    shown: 0,
    aboutPerson: 0,
    aboutSeat: 0,
    seatRoutine: 0,
    aboutParty: 0,
    unjudged: 0,
    unrelated: 0,
    hidden: 0,
  }
  for (const v of verdicts) {
    if (worthShowing(v)) counts.shown += 1
    else counts.hidden += 1
    if (v.verdict === 'about-person') counts.aboutPerson += 1
    else if (v.verdict === 'about-seat') counts.aboutSeat += 1
    else if (v.verdict === 'seat-routine') counts.seatRoutine += 1
    else if (v.verdict === 'about-party') counts.aboutParty += 1
    else if (v.verdict === 'unjudged') counts.unjudged += 1
    else counts.unrelated += 1
  }
  return counts
}

/**
 * What to call a verdict on screen, and what it means in one line.
 *
 * Written here rather than at each render site because there are now four
 * screens that label these and they were already drifting: one said "About
 * Mahabubnagar, not about you" and another re-derived the same branch by hand.
 */
export function describeVerdict(v: Verdict): { label: string; meaning: string } {
  switch (v.verdict) {
    case 'about-person':
      return { label: 'About you', meaning: 'This story is about you.' }
    case 'about-seat':
      return {
        label: 'Your seat',
        meaning: 'Your constituency, on something an office like yours is asked to act on.',
      }
    case 'seat-routine':
      return {
        label: 'Your district, not your desk',
        meaning: 'It happened in your district, but there is nothing here for you to act on.',
      }
    case 'about-party':
      return {
        label: 'Your party, elsewhere',
        meaning: 'Party business in your state, away from your seat and not about you.',
      }
    case 'unjudged':
      return {
        label: 'Not checked',
        meaning: 'Nothing has read this one against you yet.',
      }
    default:
      return { label: 'Not about you', meaning: 'Read and ruled out.' }
  }
}

/** The honest reading of a story nothing has looked at. */
export function unjudgedFor(url: string): Verdict {
  return { url, verdict: 'unjudged', confidence: null, why: null }
}

/**
 * Read one verdict off an untrusted payload.
 *
 * An unrecognised verdict word becomes `unjudged` rather than being discarded
 * or guessed at. If the server ships a sixth category tomorrow, an old client
 * shows those stories with "not yet checked" on them, which is true from where
 * the client stands, and shows them — a client that guessed would hide real
 * coverage on the strength of a word it did not understand.
 */
export function asVerdict(raw: unknown): Verdict | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  const url = typeof row['url'] === 'string' ? row['url'].trim() : ''
  if (!url) return null

  const word = typeof row['verdict'] === 'string' ? row['verdict'] : ''
  const verdict = (RELEVANCES as readonly string[]).includes(word)
    ? (word as Relevance)
    : 'unjudged'

  const conf = typeof row['confidence'] === 'string' ? row['confidence'] : ''
  const why = typeof row['why'] === 'string' ? row['why'].trim() : ''
  const via = row['via'] === 'harvested' ? 'harvested' : row['via'] === 'matched' ? 'matched' : null

  return {
    url,
    verdict,
    confidence: (CONFIDENCES as readonly string[]).includes(conf) ? (conf as Confidence) : null,
    why: why || null,
    ...(via ? { via } : {}),
  }
}

/* ── the cache ───────────────────────────────────────────────────────────── */

/**
 * Scoped per signed-in account, and read through a function rather than held in
 * a constant: the active account changes at runtime when somebody signs in, and
 * a module-level constant would freeze whichever account was live when this
 * module was first imported.
 */
const KEY = (): string => deskKey('signal.relevance.v1')

/**
 * How many judged stories are kept.
 *
 * A morning scan reads a few dozen headlines, so four hundred is roughly a
 * fortnight of them. The bound exists because this cache is written on every
 * scan and never read for anything historical: its only job is to stop the desk
 * paying to re-judge a story it saw yesterday. An unbounded cache of a few
 * hundred bytes per story would grow until a quota error took out the writes
 * that actually matter, and localStorage here is shared with the store that
 * holds the office's real work.
 */
const MAX_VERDICTS = 400

interface CachedVerdict extends Verdict {
  /** When this desk recorded the verdict, which orders the trim. */
  judgedAt: string
}

interface Envelope {
  /**
   * Who the verdicts were judged against.
   *
   * A verdict is a claim about one named person: "unrelated" means unrelated to
   * D. K. Aruna, and it says nothing at all about the next member this desk is
   * pointed at. An office that corrects a misspelled name or hands the laptop
   * to a second member would otherwise inherit a cache that hides real coverage
   * of the new subject on the strength of a judgement made about somebody else.
   *
   * Null means the writer did not say. That is treated as "trust it" rather
   * than as a mismatch, so a caller that has no identity to hand degrades to
   * the behaviour this cache had before the field existed.
   */
  subject: string | null
  entries: CachedVerdict[]
}

const EMPTY: Envelope = { subject: null, entries: [] }

function sameSubject(a: string | null, b: string | null): boolean {
  if (!a || !b) return true
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * A stable key for one story.
 *
 * The same article reaches this desk as `https://www.example.com/story/`, as
 * `http://example.com/story` off an RSS feed, and again with a `utm_source` tag
 * on the end. Keyed raw, each is a separate cache miss, and the third copy is
 * shown as "not yet checked" beside two that were. Folded here instead, and
 * folded in exactly one place so a lookup can never disagree with a save.
 *
 * A string that will not parse as a URL is used as its own key rather than
 * dropped: an unparseable URL still deserves its verdict remembered.
 */
export function keyOf(url: string): string {
  const raw = url.trim()
  try {
    const u = new URL(raw)
    for (const name of [...u.searchParams.keys()]) {
      const lower = name.toLowerCase()
      if (lower.startsWith('utm_') || lower === 'fbclid' || lower === 'gclid') {
        u.searchParams.delete(name)
      }
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '')
    return `${host}${path}${u.search}`
  } catch {
    return raw.toLowerCase()
  }
}

function parse(raw: string): Envelope {
  const data: unknown = JSON.parse(raw)
  if (typeof data !== 'object' || data === null) return EMPTY
  const box = data as Record<string, unknown>
  const rows = Array.isArray(box['entries']) ? box['entries'] : []

  const entries: CachedVerdict[] = []
  for (const row of rows) {
    const v = asVerdict(row)
    if (!v) continue
    const judgedAt =
      typeof (row as Record<string, unknown>)['judgedAt'] === 'string'
        ? ((row as Record<string, unknown>)['judgedAt'] as string)
        : ''
    entries.push({ ...v, judgedAt })
  }

  return { subject: typeof box['subject'] === 'string' ? box['subject'] : null, entries }
}

function read(): Envelope {
  try {
    const raw = localStorage.getItem(KEY())
    if (!raw) return EMPTY
    return parse(raw)
  } catch {
    // A corrupt or quota-evicted entry must not take the dashboard down with
    // it. An empty cache costs one re-judge; a thrown error on mount costs the
    // whole screen.
    return EMPTY
  }
}

function write(envelope: Envelope): void {
  try {
    localStorage.setItem(KEY(), JSON.stringify(envelope))
  } catch {
    // Over quota. Keep the newest quarter rather than losing every verdict:
    // this is a cache, and the recent end of it is the part that will be
    // looked up tomorrow morning.
    try {
      localStorage.setItem(
        KEY(),
        JSON.stringify({
          ...envelope,
          entries: envelope.entries.slice(-Math.floor(MAX_VERDICTS / 4)),
        }),
      )
    } catch {
      /* nothing further to try; the session still works, it just re-judges */
    }
  }
}

/** Throw the cache away, without disturbing anything else on the device. */
export function forgetVerdicts(): void {
  try {
    localStorage.removeItem(KEY())
  } catch {
    /* a cache that cannot be cleared is a stale cache, not a broken app */
  }
}

/**
 * Every verdict this desk holds, keyed by `keyOf` so lookups are one map hit.
 *
 * Pass the name the desk is currently set up for and a cache judged against a
 * different person is discarded rather than applied. Discarded on the spot, not
 * merely ignored, so the next read does not pay to re-parse a dead blob.
 */
export function readVerdicts(subject: string | null = null): Map<string, Verdict> {
  const envelope = read()
  if (!sameSubject(envelope.subject, subject)) {
    forgetVerdicts()
    return new Map()
  }

  const map = new Map<string, Verdict>()
  for (const entry of envelope.entries) {
    map.set(keyOf(entry.url), {
      url: entry.url,
      verdict: entry.verdict,
      confidence: entry.confidence,
      why: entry.why,
      ...(entry.via ? { via: entry.via } : {}),
    })
  }
  return map
}

/**
 * One story's verdict, never null.
 *
 * Callers reading a handful of stories can let this open the cache each time;
 * anything iterating a list should read the map once and pass it in, because
 * this parses the whole blob per call.
 */
export function verdictFor(url: string, cache?: Map<string, Verdict>): Verdict {
  const map = cache ?? readVerdicts()
  return map.get(keyOf(url)) ?? unjudgedFor(url)
}

/**
 * Record what the judge said, in one write.
 *
 * Re-judging a story replaces the old verdict and moves it to the young end of
 * the cache, so a story the desk keeps seeing is never the one trimmed. The
 * subject is remembered when the caller knows it; when it does not, whatever
 * subject the cache already carried is kept rather than being blanked.
 */
export function saveVerdicts(verdicts: readonly Verdict[], subject: string | null = null): void {
  if (verdicts.length === 0) return

  const envelope = read()
  const keep = sameSubject(envelope.subject, subject)
  const judgedAt = new Date().toISOString()

  const byKey = new Map<string, CachedVerdict>()
  if (keep) {
    for (const entry of envelope.entries) byKey.set(keyOf(entry.url), entry)
  }

  for (const v of verdicts) {
    const key = keyOf(v.url)
    // Deleted before being set so insertion order actually moves. A Map keeps
    // the original position on overwrite, which would leave a story judged this
    // morning sitting at the old end and first in line for the trim.
    byKey.delete(key)
    byKey.set(key, { ...v, judgedAt })
  }

  write({
    subject: subject ?? (keep ? envelope.subject : null),
    entries: [...byKey.values()].slice(-MAX_VERDICTS),
  })
}
