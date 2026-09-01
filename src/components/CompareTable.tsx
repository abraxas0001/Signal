import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ExternalLink,
  GitCompareArrows,
  Loader2,
  MessageSquareHeart,
  Plus,
  Search,
  UserPlus,
  X,
} from 'lucide-react'
import type { Platform } from '@shared/taxonomy'
import type { Identity } from '@shared/identity'
import { Avatar, Button, Card, Chip } from './ui'
import { PlatformBadge } from '@/components/kit'
import { cn, compact } from '@/lib/utils'
import { FORMAT_IMAGE, FORMAT_TEXT } from '@/lib/briefing'
import { scopedKey } from '@/lib/store'
import { fetchWithTimeout } from '@/lib/net'
import {
  handleId,
  saveHandle,
  type Standing,
  type TrackedHandle,
  type TrackedPost,
} from '@/lib/handles'
import type { RivalRef } from './HeadToHead'

/**
 * The comparison table: the subject in the first data column, one column per
 * watched person, seven rows that answer the questions an office actually
 * argues about. One table rather than a stack of cards, because the point of a
 * comparison is reading ACROSS, and the card stack this replaces made the
 * reader hold four scores in their head while scrolling.
 *
 * A person, not an account, per column. The same rival tracked on YouTube and
 * Facebook is one opponent, and giving them two columns would make them look
 * like two. Handles are grouped by display name (falling back to the label the
 * office typed, then the handle), which is the same grouping the compare
 * screen's account picker already used.
 *
 * Honesty rules carried through from the rest of the app:
 *   - a missing figure is a dash with an explanation, never a zero;
 *   - views are counted apart from reactions, because a view is not something
 *     a person chose to do to the post;
 *   - a standing read from published coverage is labelled as coverage, because
 *     it is not a sample of constituents and must never be shown as one;
 *   - the "what they talk about" row is word counting over stored titles and
 *     says so, because five chips under a person's face read as insight unless
 *     the label refuses the claim.
 *
 * Which columns are shown persists per account under
 * `signal.compare.cols.v1`. Nothing stored means every watched person is
 * shown, so the default table needs no setup and a person tracked later
 * appears without ceremony until the office starts curating.
 *
 * The three volume rows (posted, reactions, best post) can be read over the
 * last week or over everything stored; the choice persists under
 * `signal.compare.window.v1`. The week is anchored to the newest dated post
 * across the compared columns, not to the clock: the demo dataset is fixed,
 * and a wall-clock week would read empty on every day but capture day.
 */

/* ── person grouping ─────────────────────────────────────────────────────── */

interface PersonColumn {
  key: string
  name: string
  own: boolean
  handles: TrackedHandle[]
  avatarUrl: string | null
  subline: string
}

const personKeyOf = (h: TrackedHandle): string =>
  (h.displayName?.trim() || h.label?.trim() || h.handle).toLowerCase()

const latestFollowers = (h: TrackedHandle): number | null =>
  h.snapshots.at(-1)?.followers ?? null

/** Every post in each handle's latest reading, tagged with its platform. */
interface PersonPost {
  post: TrackedPost
  platform: Platform
}

const personPosts = (p: PersonColumn): PersonPost[] =>
  p.handles.flatMap((h) =>
    (h.snapshots.at(-1)?.posts ?? []).map((post) => ({ post, platform: h.platform })),
  )

/**
 * Reactions are what a person did to the post. Views are counted elsewhere,
 * deliberately: summing them in would let one YouTube video outweigh every
 * conversation on every other platform.
 */
const hasReactions = (p: TrackedPost): boolean =>
  p.likes != null || p.comments != null || p.shares != null

const reactionsOf = (p: TrackedPost): number =>
  (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0)

/** The account most worth reading opinion from: where the audience is. */
const biggestHandle = (p: PersonColumn): TrackedHandle | null => {
  let best: TrackedHandle | null = null
  for (const h of p.handles) {
    if (!best || (latestFollowers(h) ?? 0) > (latestFollowers(best) ?? 0)) best = h
  }
  return best
}

/* ── column persistence ──────────────────────────────────────────────────── */

const COLS_KEY = (): string => scopedKey('signal.compare.cols.v1')

/** Null means "never curated", which renders as every watched person shown. */
function readShownCols(): string[] | null {
  try {
    const raw = localStorage.getItem(COLS_KEY())
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : null
  } catch {
    return null
  }
}

function saveShownCols(keys: string[]): void {
  try {
    localStorage.setItem(COLS_KEY(), JSON.stringify(keys))
  } catch {
    /* a preference that will not persist is an inconvenience, not a failure */
  }
}

/* ── window persistence ──────────────────────────────────────────────────── */

type CompareWindow = 'week' | 'all'

const WINDOW_KEY = (): string => scopedKey('signal.compare.window.v1')

/** Anything but a stored "all" reads as the default week view. */
function readWindow(): CompareWindow {
  try {
    return localStorage.getItem(WINDOW_KEY()) === 'all' ? 'all' : 'week'
  } catch {
    return 'week'
  }
}

function saveWindow(w: CompareWindow): void {
  try {
    localStorage.setItem(WINDOW_KEY(), w)
  } catch {
    /* a preference that will not persist is an inconvenience, not a failure */
  }
}

const WEEK_MS = 7 * 86_400_000

/* ── theme extraction ────────────────────────────────────────────────────── */

/**
 * Words that carry no subject: English function words, the Hindi and Telugu
 * ones that show up in mixed-script titles, platform boilerplate ("live",
 * "shorts") and honorifics. Kept deliberately small; a stopword list that
 * grows opinions stops being a stopword list.
 */
const STOPWORDS = new Set<string>([
  // English function words
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'of', 'to',
  'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'has', 'have',
  'had', 'having', 'will', 'would', 'shall', 'should', 'can', 'could', 'may',
  'might', 'must', 'not', 'no', 'nor', 'this', 'that', 'these', 'those', 'it',
  'its', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their', 'we', 'us',
  'our', 'you', 'your', 'who', 'whom', 'whose', 'which', 'what', 'when',
  'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'only', 'own', 'same', 'very', 'too', 'also',
  'just', 'about', 'into', 'over', 'under', 'again', 'once', 'here', 'there',
  'out', 'up', 'down', 'off', 'after', 'before', 'during', 'between',
  'through', 'via', 'per', 'new', 'now', 'day', 'get', 'let',
  // platform boilerplate that recurs in every channel's titles
  'live', 'video', 'watch', 'full', 'shorts', 'official', 'channel',
  'subscribe', 'promo', 'part', 'episode',
  // honorifics
  'shri', 'sri', 'smt', 'ji', 'garu', 'sir', 'madam', 'mr', 'mrs', 'dr',
  // Hindi function words, romanised
  'ka', 'ki', 'ke', 'ko', 'se', 'me', 'mein', 'par', 'aur', 'hai', 'hain',
  'ho', 'bhi', 'nahi', 'nahin', 'hi', 'ne', 'ye', 'yeh', 'wo', 'woh', 'ek',
  'kya', 'ab', 'jab', 'tab', 'kar', 'raha', 'rahe', 'rahi', 'gaya', 'gaye',
  'liye', 'wala', 'wale', 'wali', 'tha', 'thi', 'hum', 'aap', 'na', 'ya',
  // Hindi function words, Devanagari
  'का', 'की', 'के', 'को', 'से', 'में', 'पर', 'और', 'है', 'हैं', 'हो', 'भी',
  'नहीं', 'तो', 'ही', 'ने', 'ये', 'यह', 'वह', 'वो', 'एक', 'क्या', 'अब', 'जी',
  'हम', 'आप', 'इस', 'उस', 'कर', 'रहा', 'रहे', 'रही', 'गया', 'गए', 'लिए',
  'वाला', 'वाले', 'वाली', 'था', 'थे', 'थी', 'ना', 'या',
  // Telugu function words
  'లో', 'కి', 'కు', 'ఈ', 'ఆ', 'ఒక', 'మరియు', 'తో', 'పై', 'గా', 'కోసం', 'అని',
  'ఇది', 'అది', 'ఉంది', 'ఉన్న', 'నుంచి', 'నుండి', 'వద్ద', 'గారు', 'మీద',
  'కూడా', 'ఇక', 'మన', 'నా', 'మీ', 'వారి', 'తన',
])

/**
 * The top recurring terms across a set of short texts: post titles for the
 * themes row, comment quotes for the praise and criticism keywords.
 *
 * Word counting, nothing more, and the rows that use it say so. Unigrams and
 * bigrams, weighted a little towards earlier texts so a caller passing
 * newest-first gets last month's campaign over last year's, and a term has to
 * appear twice before it counts as recurring at all: a word used once is a
 * sentence, not a theme.
 *
 * Returns null when there are no texts to count, as against an empty list,
 * which means texts exist but nothing repeats.
 */
function recurringTerms(texts: string[], max = 5): string[] | null {
  if (!texts.length) return null

  const stats = new Map<string, { count: number; score: number; bigram: boolean }>()
  const bump = (term: string, weight: number, bigram: boolean): void => {
    const s = stats.get(term) ?? { count: 0, score: 0, bigram }
    s.count += 1
    s.score += weight
    stats.set(term, s)
  }

  texts.forEach((text, idx) => {
    // The first text weighs 1.0, each later one a little less, floored so a
    // term that genuinely recurs late still beats an early one-off.
    const weight = Math.max(0.5, 1 - idx * 0.05)
    const tokens = text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      // \p{M} is load-bearing: Devanagari and Telugu build words out of
      // combining marks — the virama in आरक्षण is one — and a split that
      // treats marks as separators shreds every conjunct into fragments a
      // reader sees as gibberish ("आरक षण"). Apostrophes stay inside words
      // for the same reason: "hon'ble" is one token, not "hon ble".
      .split(/[^\p{L}\p{M}\p{N}'’]+/u)
      .map((t) => t.replace(/^['’]+|['’]+$/g, ''))
      .filter((t) => {
        if (!t || /^\d+$/.test(t) || STOPWORDS.has(t)) return false
        // Latin needs three letters to mean anything; Indic scripts can pack
        // a whole word into two.
        return /^[a-z0-9]+$/.test(t) ? t.length >= 3 : t.length >= 2
      })
    tokens.forEach((t, i) => {
      bump(t, weight, false)
      const next = tokens[i + 1]
      // Bigrams outrank their halves: "road repair" says more than "road".
      if (next) bump(`${t} ${next}`, weight * 1.6, true)
    })
  })

  const picked: string[] = []
  const candidates = [...stats.entries()]
    .filter(([, s]) => s.count >= 2)
    .sort((a, b) => b[1].score - a[1].score)
  for (const [term, s] of candidates) {
    if (picked.length >= max) break
    // A unigram already inside a chosen bigram would count the same words twice.
    if (!s.bigram && picked.some((p) => p.split(' ').includes(term))) continue
    picked.push(term)
  }
  return picked
}

/** The last ten stored titles, newest first, for the recurring-words row. */
const recentTitles = (posts: PersonPost[]): string[] =>
  [...posts]
    .sort((a, b) => (b.post.publishedAt ?? '').localeCompare(a.post.publishedAt ?? ''))
    .slice(0, 10)
    .map((p) => p.post.title?.trim())
    .filter((t): t is string => Boolean(t))

/**
 * The content kind that outperforms this person's typical post: the same
 * picture-against-text split whatLandsOf uses on the briefing, plus one bucket
 * per platform. Only posts with published reactions are averaged, so a post
 * the platform said nothing about is excluded, never counted as a zero. A
 * bucket needs three such posts before it may speak, and a kind is only named
 * when it beats the person's overall average by at least 1.3x.
 */
function strongestKind(measured: PersonPost[]): { label: string; ratio: string } | null {
  if (measured.length < 3) return null
  const avg = (subset: PersonPost[]): number =>
    subset.reduce((a, p) => a + reactionsOf(p.post), 0) / subset.length
  const typical = avg(measured)
  if (typical <= 0) return null

  const buckets: [string, PersonPost[]][] = [
    [FORMAT_IMAGE, measured.filter((p) => p.post.thumbnailUrl)],
    [FORMAT_TEXT, measured.filter((p) => !p.post.thumbnailUrl)],
  ]
  for (const platform of new Set(measured.map((p) => p.platform))) {
    buckets.push([`Posts on ${platform}`, measured.filter((p) => p.platform === platform)])
  }

  let best: { label: string; value: number } | null = null
  for (const [label, subset] of buckets) {
    if (subset.length < 3) continue
    const ratio = avg(subset) / typical
    if (ratio >= 1.3 && (!best || ratio > best.value)) best = { label, value: ratio }
  }
  return best ? { label: best.label, ratio: (Math.round(best.value * 10) / 10).toFixed(1) } : null
}

/** A verbatim quote clipped to fit a table cell. */
const clipQuote = (t: string): string =>
  t.length > 90 ? `${t.slice(0, 89).trimEnd()}…` : t

/* ── small shared pieces ─────────────────────────────────────────────────── */

/** The quiet explanation a cell gives instead of an invented number. */
function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-[11px] leading-relaxed text-ink-3', className)}>{children}</p>
}

/** A theme chip that wraps: praise and criticism arrive as phrases, not words. */
function ThemeTag({ tone, children }: { tone: 'pos' | 'neg'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-block rounded-lg px-2 py-1 text-[11px] font-medium leading-snug',
        tone === 'pos'
          ? 'bg-[var(--pos-soft)] text-[var(--pos)]'
          : 'bg-[var(--neg-soft)] text-[var(--neg)]',
      )}
    >
      {children}
    </span>
  )
}

/* ── the add-a-competitor panel ──────────────────────────────────────────── */

interface FoundProfile {
  platform: Platform
  handle: string
  name: string | null
  profileUrl: string
  followers: number | null
  listing?: string
  confidence?: 'high' | 'medium' | 'low'
  note?: string
}

interface SearchAnswer {
  person?: { name: string } | null
  people?: { name: string; description: string | null; person: boolean }[]
  profiles?: FoundProfile[]
  error?: string
}

/** Long enough that "d" does not run a search; matches the server's own gate. */
const MIN_QUERY = 3

/**
 * Search a name across the platforms and track the accounts that come back.
 *
 * One explicit search per press rather than a typeahead, because a single call
 * to /api/multi-platform-search is up to ten live profile reads and the
 * endpoint allows twenty a minute. A debounce would spend that budget on
 * half-typed names.
 */
function AddCompetitor({
  isTracked,
  onTrack,
  onClose,
}: {
  isTracked: (account: { platform: Platform; handle: string }) => boolean
  onTrack: (created: TrackedHandle) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [answer, setAnswer] = useState<SearchAnswer | null>(null)
  /** The name the shown results were searched for, kept for the label. */
  const [searchedFor, setSearchedFor] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = async (person?: string): Promise<void> => {
    const q = query.trim()
    if (q.length < MIN_QUERY || searching) return
    setSearching(true)
    setError(null)
    setAnswer(null)
    try {
      const url = `/api/multi-platform-search?q=${encodeURIComponent(q)}${
        person ? `&person=${encodeURIComponent(person)}` : ''
      }`
      const res = await fetchWithTimeout(url)
      const j = (await res.json()) as SearchAnswer
      // The endpoint answers 200 with an `error` when the search itself is
      // down, so the status code alone is not the verdict.
      if (j.error) {
        setError(j.error)
        return
      }
      setAnswer(j)
      setSearchedFor(person ?? j.person?.name ?? q)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setSearching(false)
    }
  }

  const track = (p: FoundProfile): void => {
    onTrack({
      id: handleId(p.platform, p.handle),
      platform: p.platform,
      handle: p.handle,
      displayName: p.name ?? searchedFor,
      profileUrl: p.profileUrl,
      avatarUrl: null,
      own: false,
      label: searchedFor,
      listingNote: p.listing ?? '',
      snapshots: [],
    })
  }

  const profiles = answer?.profiles ?? []
  const people = (answer?.people ?? []).filter((p) => p.person)

  return (
    <Card level="quiet">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">Add a competitor</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
            Searches the public record and the platforms for a name, live.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the competitor search"
          className="grid size-9 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-2)] hover:text-ink"
        >
          <X size={14} aria-hidden />
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
          placeholder="Type a person's name"
          aria-label="Competitor name to search for"
          className="min-h-11 w-full min-w-0 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm text-ink shadow-[var(--e1)] outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)] sm:flex-1"
        />
        <Button
          size="sm"
          onClick={() => void run()}
          disabled={query.trim().length < MIN_QUERY || searching}
          className="w-full sm:w-auto"
        >
          <Search size={14} />
          {searching ? 'Searching…' : 'Search'}
        </Button>
      </div>

      {searching && (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-2">
          <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
          Reading the record and each platform live. This can take up to half a minute.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--neg)]">
          {error}
        </p>
      )}

      {answer && profiles.length > 0 && (
        <ul className="mt-3 space-y-2">
          {profiles.map((p) => {
            const tracked = isTracked({ platform: p.platform, handle: p.handle })
            return (
              <li
                key={`${p.platform}:${p.handle}`}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-2.5 shadow-[var(--e1)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 grow basis-48 items-center gap-2.5">
                    <PlatformBadge platform={p.platform} size={28} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-tight text-ink">
                        {p.name ?? p.handle}
                      </span>
                      <span className="block truncate text-xs text-ink-3">
                        @{p.handle.replace(/^@/, '')}
                        {p.followers != null && ` · ${compact(p.followers)} followers`}
                      </span>
                    </span>
                    {p.confidence && p.confidence !== 'high' && (
                      <Chip tone="warning">{p.confidence} confidence</Chip>
                    )}
                  </span>
                  {tracked ? (
                    <Chip tone="neutral">Already tracked</Chip>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => track(p)}>
                      <Plus size={13} /> Track
                    </Button>
                  )}
                </div>
                {/* The server's own words on what this row is evidence of. A
                    handle only the record asserts and one that answered a live
                    read are different claims, and this line is the difference. */}
                {p.note && <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">{p.note}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {answer && profiles.length === 0 && (
        <div className="mt-3">
          <p className="text-xs leading-relaxed text-ink-3">
            No account was found for &ldquo;{searchedFor}&rdquo;. The public record is thin below
            state level. A profile address can still be pasted on the Accounts screen, and the
            account then appears here as a column.
          </p>
          {people.length > 1 && (
            <>
              <p className="mt-3 text-xs font-medium text-ink-2">
                The record matched more than one person. Pick who you meant:
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {people.map((person) => (
                  <button
                    key={person.name}
                    type="button"
                    onClick={() => void run(person.name)}
                    className="inline-flex min-h-11 items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-xs font-semibold text-ink-2 transition-colors hover:border-[var(--border-interactive)] hover:text-ink"
                  >
                    {person.name}
                    {person.description && (
                      <span className="ml-1.5 font-normal text-ink-3">{person.description}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}

/* ── the table itself ────────────────────────────────────────────────────── */

export function CompareTable({
  handles,
  identity,
  standings,
  readingId,
  readingPhase,
  onReadOpinion,
  onCompareRecord,
  onTracked,
}: {
  handles: TrackedHandle[]
  identity: Identity | null
  /** Cached opinion readings, keyed by handle id. The owner loads and refreshes these. */
  standings: Record<string, Standing>
  /** The handle whose opinion is being read right now, or null. */
  readingId: string | null
  readingPhase: 'searching' | 'structuring' | null
  onReadOpinion: (h: TrackedHandle) => void
  /** Open the full head-to-head record comparison. Absent until the desk has an identity. */
  onCompareRecord?: ((ref: RivalRef) => void) | undefined
  /** A competitor was tracked from the search panel; the owner refreshes it. */
  onTracked: (next: TrackedHandle[], created: TrackedHandle) => void
}) {
  const [shownKeys, setShownKeys] = useState<string[] | null>(readShownCols)
  const [adding, setAdding] = useState(false)
  const [windowMode, setWindowMode] = useState<CompareWindow>(readWindow)

  const pickWindow = (w: CompareWindow): void => {
    setWindowMode(w)
    saveWindow(w)
  }

  /** All of the office's own handles as one column, named for the person. */
  const subject = useMemo((): PersonColumn | null => {
    const mine = handles.filter((h) => h.own)
    const first = mine[0]
    if (!first) return null
    return {
      key: '__subject__',
      name: identity?.name ?? first.displayName ?? first.handle,
      own: true,
      handles: mine,
      avatarUrl: identity?.photoUrl ?? mine.find((h) => h.avatarUrl)?.avatarUrl ?? null,
      subline:
        [identity?.party, identity?.constituency].filter(Boolean).join(' · ') || 'Your accounts',
    }
  }, [handles, identity])

  /** Watched persons: non-own handles grouped by who they belong to. */
  const persons = useMemo((): PersonColumn[] => {
    const map = new Map<string, PersonColumn>()
    for (const h of handles) {
      if (h.own) continue
      const key = personKeyOf(h)
      const held = map.get(key)
      if (held) {
        held.handles.push(h)
        if (!held.avatarUrl && h.avatarUrl) held.avatarUrl = h.avatarUrl
      } else {
        map.set(key, {
          key,
          name: h.displayName?.trim() || h.label?.trim() || h.handle,
          own: false,
          handles: [h],
          avatarUrl: h.avatarUrl,
          subline: h.label?.trim() || 'Watched',
        })
      }
    }
    const reach = (p: PersonColumn): number =>
      p.handles.reduce((a, h) => a + (latestFollowers(h) ?? 0), 0)
    return [...map.values()].sort((a, b) => reach(b) - reach(a))
  }, [handles])

  const shownSet = useMemo(
    () => new Set(shownKeys ?? persons.map((p) => p.key)),
    [shownKeys, persons],
  )

  const toggle = (key: string): void => {
    const current = shownKeys ?? persons.map((p) => p.key)
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    setShownKeys(next)
    saveShownCols(next)
  }

  const columns = useMemo(() => {
    const cols: PersonColumn[] = []
    if (subject) cols.push(subject)
    for (const p of persons) if (shownSet.has(p.key)) cols.push(p)
    return cols
  }, [subject, persons, shownSet])

  /**
   * The week's far edge: the newest dated post anywhere in the table. Null
   * when no compared post carries a date, and the week view then has nothing
   * to count for anyone.
   */
  const windowEnd = useMemo((): number | null => {
    let max: number | null = null
    for (const col of columns) {
      for (const { post } of personPosts(col)) {
        if (!post.publishedAt) continue
        const t = new Date(post.publishedAt).getTime()
        if (Number.isFinite(t) && (max === null || t > max)) max = t
      }
    }
    return max
  }, [columns])

  /** Each column's dated posts inside the seven days ending at `windowEnd`. */
  const weekPosts = useMemo((): Map<string, PersonPost[]> => {
    const map = new Map<string, PersonPost[]>()
    for (const col of columns) {
      map.set(
        col.key,
        windowEnd === null
          ? []
          : personPosts(col).filter(({ post }) => {
              if (!post.publishedAt) return false
              const t = new Date(post.publishedAt).getTime()
              return Number.isFinite(t) && t >= windowEnd - WEEK_MS && t <= windowEnd
            }),
      )
    }
    return map
  }, [columns, windowEnd])

  const weekPostsOf = (col: PersonColumn): PersonPost[] => weekPosts.get(col.key) ?? []

  /** "19 Aug to 26 Aug 2025." so the row states its window as dates, not prose. */
  const windowLabel = useMemo((): string | null => {
    if (windowEnd === null) return null
    const day = (d: Date): string =>
      d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    const start = new Date(windowEnd - WEEK_MS)
    const end = new Date(windowEnd)
    return start.getFullYear() === end.getFullYear()
      ? `${day(start)} to ${day(end)} ${end.getFullYear()}.`
      : `${day(start)} ${start.getFullYear()} to ${day(end)} ${end.getFullYear()}.`
  }, [windowEnd])

  const isTracked = (account: { platform: Platform; handle: string }): boolean =>
    handles.some((h) => h.id === handleId(account.platform, account.handle))

  /**
   * Save the tracked account here, where the spec puts it, and make sure the
   * new person's column is switched on before the owner refreshes: tracking
   * somebody and not seeing them appear would read as the add having failed.
   */
  const handleTrack = (created: TrackedHandle): void => {
    const next = saveHandle(created)
    if (shownKeys !== null) {
      const key = personKeyOf(created)
      if (!shownKeys.includes(key)) {
        const grown = [...shownKeys, key]
        setShownKeys(grown)
        saveShownCols(grown)
      }
    }
    onTracked(next, created)
  }

  const bestStanding = (p: PersonColumn): Standing | null => {
    let best: Standing | null = null
    for (const h of p.handles) {
      const s = standings[h.id]
      if (!s) continue
      if (!best) {
        best = s
        continue
      }
      // Comments outrank coverage: people's own words are the better evidence.
      const bestFromComments = (best.source ?? 'comments') === 'comments'
      const nextFromComments = (s.source ?? 'comments') === 'comments'
      if (bestFromComments !== nextFromComments) {
        if (nextFromComments) best = s
        continue
      }
      if (s.readAt > best.readAt) best = s
    }
    return best
  }

  const refFor = (p: PersonColumn): RivalRef => {
    const biggest = biggestHandle(p)
    return {
      name: p.name,
      state: identity?.state ?? null,
      followers: biggest ? latestFollowers(biggest) : null,
      platforms: p.handles.map((h) => h.platform),
      profileUrl: biggest?.profileUrl ?? null,
      photoUrl: p.avatarUrl,
    }
  }

  /* ── cell renderers, one per row ─────────────────────────────────────── */

  const reachCell = (col: PersonColumn): ReactNode => {
    const lines = col.handles.map((h) => ({ h, followers: latestFollowers(h) }))
    const known = lines.filter(
      (l): l is { h: TrackedHandle; followers: number } => l.followers != null,
    )
    const total = known.reduce((a, l) => a + l.followers, 0)
    return (
      <div className="space-y-1.5">
        {lines.map(({ h, followers }) => (
          <span key={h.id} className="flex items-center gap-1.5">
            <PlatformBadge platform={h.platform} size={16} />
            {followers != null ? (
              <span className="tnum text-sm font-semibold text-ink">{compact(followers)}</span>
            ) : (
              <span
                className="text-sm text-ink-3"
                title={`${h.platform} has no follower reading yet. Refresh this account on the Accounts screen to take one.`}
              >
                NA
              </span>
            )}
          </span>
        ))}
        {known.length >= 2 && (
          <span className="block pt-0.5 text-xs text-ink-3">
            <span className="tnum font-semibold text-ink-2">{compact(total)}</span> together
          </span>
        )}
      </div>
    )
  }

  const engagementCell = (col: PersonColumn): ReactNode => {
    const posts = personPosts(col)
    if (!posts.length) {
      return <Note>No posts are stored yet. A sync on the Accounts screen fills this in.</Note>
    }
    const measured = posts.filter((p) => hasReactions(p.post))
    const viewed = posts.filter((p) => p.post.views != null)
    const viewsTotal = viewed.reduce((a, p) => a + (p.post.views ?? 0), 0)
    const viewsLine = viewed.length > 0 && (
      <span className="block text-[11px] text-ink-3">
        {compact(viewsTotal)} views across {viewed.length} {viewed.length === 1 ? 'post' : 'posts'}.
      </span>
    )
    if (!measured.length) {
      return (
        <div className="space-y-1">
          <Note>
            Reactions are not published on any of the {posts.length} stored{' '}
            {posts.length === 1 ? 'post' : 'posts'}.
          </Note>
          {viewsLine}
        </div>
      )
    }
    const total = measured.reduce((a, p) => a + reactionsOf(p.post), 0)
    return (
      <div className="space-y-1">
        <span className="tnum block text-lg font-bold leading-none text-ink">{compact(total)}</span>
        <span className="block text-[11px] text-ink-3">
          reactions across {measured.length} stored {measured.length === 1 ? 'post' : 'posts'}
        </span>
        <span className="block text-xs text-ink-2">
          <span className="tnum font-semibold">{compact(Math.round(total / measured.length))}</span>{' '}
          per post
        </span>
        {viewsLine}
      </div>
    )
  }

  const sentimentCell = (col: PersonColumn): ReactNode => {
    const st = bestStanding(col)
    if (!st) {
      const target = biggestHandle(col)
      const busy = target !== null && readingId === target.id
      return (
        <div className="space-y-2">
          <Note>No reading yet.</Note>
          {target && (
            <Button
              size="sm"
              variant="outline"
              disabled={readingId !== null}
              onClick={() => onReadOpinion(target)}
            >
              <MessageSquareHeart size={13} />
              {busy
                ? readingPhase === 'searching'
                  ? 'Reading the record…'
                  : readingPhase === 'structuring'
                    ? 'Weighing it up…'
                    : 'Reading comments…'
                : 'Read opinion'}
            </Button>
          )}
        </div>
      )
    }
    return (
      <div className="space-y-1.5">
        <span className="flex flex-wrap items-center gap-2">
          {st.score !== null ? (
            <span
              className={cn(
                'tnum inline-flex rounded-full px-2 py-0.5 text-xs font-bold',
                st.score > 15
                  ? 'bg-[var(--pos-soft)] text-[var(--pos)]'
                  : st.score < -15
                    ? 'bg-[var(--neg-soft)] text-[var(--neg)]'
                    : 'bg-[var(--warn-soft)] text-[var(--warn)]',
              )}
              title="On a scale of minus 100 to plus 100."
            >
              {st.score > 0 ? '+' : st.score === 0 ? '±' : ''}
              {st.score}
            </span>
          ) : (
            <span className="text-sm font-bold text-ink-3" title="No score came back for this reading.">
              NA
            </span>
          )}
          <span className="text-xs font-semibold text-ink">{st.label}</span>
        </span>
        {/* The provenance line. A comment reading and a coverage reading are
            different claims, and the cell must say which one it is making. */}
        {(st.source ?? 'comments') === 'comments' ? (
          <span className="block text-[11px] leading-relaxed text-ink-3">
            From {st.commentsRead} comments across {st.postsRead} posts.
          </span>
        ) : (
          <Chip tone="neutral">Coverage</Chip>
        )}
      </div>
    )
  }

  const themesCell = (col: PersonColumn): ReactNode => {
    const terms = recurringTerms(recentTitles(personPosts(col)))
    if (terms === null) return <Note>No post titles are stored to count words from.</Note>
    if (!terms.length) return <Note>No word repeats across the stored titles.</Note>
    return (
      <div className="flex flex-wrap gap-1.5">
        {terms.map((t) => (
          <Chip key={t}>{t}</Chip>
        ))}
      </div>
    )
  }

  /** One post as a title link with its platform and the figure it ranks by. */
  const postLink = (p: PersonPost, meta: string): ReactNode => (
    <a
      key={p.post.url}
      href={p.post.url}
      target="_blank"
      rel="noreferrer noopener"
      className="group block"
    >
      <span className="block text-xs font-medium leading-snug text-ink line-clamp-2 group-hover:text-[var(--accent)]">
        {p.post.title?.trim() || 'Untitled post'}
      </span>
      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-3">
        <PlatformBadge platform={p.platform} size={12} />
        <span className="tnum">{meta}</span>
        <ExternalLink size={10} aria-hidden />
      </span>
    </a>
  )

  const workingCell = (col: PersonColumn): ReactNode => {
    const posts = personPosts(col)
    if (!posts.length) return <Note>No posts are stored yet.</Note>

    const withReactions = posts
      .filter((p) => hasReactions(p.post))
      .sort((a, b) => reactionsOf(b.post) - reactionsOf(a.post))
    if (withReactions.length) {
      const kind = strongestKind(withReactions)
      return (
        <div className="space-y-2.5">
          {kind && (
            <Chip tone="accent">
              {kind.label} · {kind.ratio}x {col.own ? 'your' : 'their'} typical
            </Chip>
          )}
          {withReactions
            .slice(0, 2)
            .map((p) => postLink(p, `${compact(reactionsOf(p.post))} reactions`))}
        </div>
      )
    }

    // YouTube publishes views and often nothing else, so ranking by views is
    // the honest fallback there, said out loud rather than passed off as
    // reactions.
    const withViews = posts
      .filter((p) => p.post.views != null)
      .sort((a, b) => (b.post.views ?? 0) - (a.post.views ?? 0))
    if (withViews.length) {
      return (
        <div className="space-y-2.5">
          {withViews.slice(0, 2).map((p) => postLink(p, `${compact(p.post.views)} views`))}
          <Note>Ranked by views. Reactions are not published here.</Note>
        </div>
      )
    }

    return <Note>Nothing here can be ranked.</Note>
  }

  /** Post count with per-platform figures, but only when platforms mix. */
  const postedCounts = (posts: PersonPost[]): ReactNode => {
    const byPlatform = new Map<Platform, number>()
    for (const p of posts) byPlatform.set(p.platform, (byPlatform.get(p.platform) ?? 0) + 1)
    return (
      <div className="space-y-1.5">
        <span className="tnum block text-lg font-bold leading-none text-ink">{posts.length}</span>
        <span className="block text-[11px] text-ink-3">{posts.length === 1 ? 'post' : 'posts'}</span>
        {/* Always, not only for multi-platform weeks: "12 posts" alone made
            the reader guess where they went, and the guess was the question
            the row exists to answer. */}
        {byPlatform.size > 0 && (
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-0.5">
            {[...byPlatform.entries()].map(([platform, n]) => (
              <span key={platform} className="flex items-center gap-1">
                <PlatformBadge platform={platform} size={14} />
                <span className="tnum text-xs font-semibold text-ink-2">{n}</span>
              </span>
            ))}
          </span>
        )}
      </div>
    )
  }

  const postedAllCell = (col: PersonColumn): ReactNode => {
    const posts = personPosts(col)
    if (!posts.length) {
      return <Note>No posts are stored yet. A sync on the Accounts screen fills this in.</Note>
    }
    return postedCounts(posts)
  }

  const weekReactionsCell = (col: PersonColumn): ReactNode => {
    const posts = weekPostsOf(col)
    const measured = posts.filter((p) => hasReactions(p.post))
    const viewed = posts.filter((p) => p.post.views != null)
    const viewsTotal = viewed.reduce((a, p) => a + (p.post.views ?? 0), 0)
    const viewsLine = viewed.length > 0 && (
      <span className="block text-[11px] text-ink-3">
        {compact(viewsTotal)} views across {viewed.length} {viewed.length === 1 ? 'post' : 'posts'}.
      </span>
    )
    if (!measured.length) {
      // The week has posts, only nothing published about them: a dash, never a
      // zero a reader would take for a flop.
      return (
        <div className="space-y-1">
          <span
            className="text-sm font-bold text-ink-3"
            title="Reactions are not published on the posts from this week."
          >
            NA
          </span>
          {viewsLine}
        </div>
      )
    }
    const total = measured.reduce((a, p) => a + reactionsOf(p.post), 0)
    return (
      <div className="space-y-1">
        <span className="tnum block text-lg font-bold leading-none text-ink">{compact(total)}</span>
        <span className="block text-[11px] text-ink-3">
          reactions on {measured.length} {measured.length === 1 ? 'post' : 'posts'}
        </span>
        {viewsLine}
      </div>
    )
  }

  const bestWeekCell = (col: PersonColumn): ReactNode => {
    const posts = weekPostsOf(col)
    const topReacted = [...posts]
      .filter((p) => hasReactions(p.post))
      .sort((a, b) => reactionsOf(b.post) - reactionsOf(a.post))
      .at(0)
    if (topReacted) return postLink(topReacted, `${compact(reactionsOf(topReacted.post))} reactions`)
    // Same views fallback as the all-time row, and said out loud for the same
    // reason: a views figure passed off as reactions would win every week.
    const topViewed = [...posts]
      .filter((p) => p.post.views != null)
      .sort((a, b) => (b.post.views ?? 0) - (a.post.views ?? 0))
      .at(0)
    if (topViewed) {
      return (
        <div className="space-y-2.5">
          {postLink(topViewed, `${compact(topViewed.post.views)} views`)}
          <Note>Ranked by views. Reactions are not published here.</Note>
        </div>
      )
    }
    return <Note>The platform publishes no reactions or views for these posts, so nothing can be ranked.</Note>
  }

  /**
   * The one cell a column with an empty week gets, spanning all three volume
   * rows. Three claims kept apart: no posts held at all, posts held but
   * undated, and dated posts that simply predate the window. Only the last
   * one is really "posted nothing this week".
   */
  const emptyWeekCell = (col: PersonColumn): ReactNode => {
    const stored = personPosts(col)
    if (!stored.length) {
      return <Note>No posts are stored yet. A sync on the Accounts screen fills this in.</Note>
    }
    if (!stored.some((p) => p.post.publishedAt)) {
      return <Note>The stored posts carry no dates, so this week cannot be counted.</Note>
    }
    return <Note>Nothing posted this week.</Note>
  }

  const mentionsCell = (col: PersonColumn): ReactNode => {
    const st = bestStanding(col)
    if (!st) return <Note>No reading yet. Read opinion in the sentiment row fills this in.</Note>
    const quotes = [
      ...st.praise.slice(0, 3).map((t) => ({ t, tone: 'pos' as const })),
      ...st.criticism.slice(0, 3).map((t) => ({ t, tone: 'neg' as const })),
    ]
    return (
      <div className="space-y-1.5">
        {(st.source ?? 'comments') === 'record' && <Chip tone="neutral">Coverage</Chip>}
        {quotes.length ? (
          <div className="flex flex-wrap gap-1.5">
            {quotes.map(({ t, tone }, i) => (
              <ThemeTag key={i} tone={tone}>
                &ldquo;{clipQuote(t)}&rdquo;
              </ThemeTag>
            ))}
          </div>
        ) : (
          <Note>The reading recorded no quotes.</Note>
        )}
      </div>
    )
  }

  const recordCell = (col: PersonColumn): ReactNode => {
    const st = bestStanding(col)
    if (!st) return <Note>No reading yet.</Note>
    const side = (tone: 'pos' | 'neg', quotes: string[]): ReactNode => {
      if (!quotes.length) return <Note className="mt-1">None recorded in this reading.</Note>
      // A handful of short quotes can repeat no word at all. That gets said
      // plainly: the earlier fallback printed the reading's own verdict label
      // here, and a chip saying "Warm" under COMPLAINED ABOUT claimed people
      // complain about the person for being warm.
      const terms = recurringTerms(quotes, 4)
      if (!terms?.length) {
        return <Note className="mt-1">No word recurs across the quotes held.</Note>
      }
      return (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {terms.map((t) => (
            <ThemeTag key={t} tone={tone}>
              {t}
            </ThemeTag>
          ))}
        </div>
      )
    }
    return (
      <div className="space-y-2.5">
        {(st.source ?? 'comments') === 'record' && <Chip tone="neutral">Coverage</Chip>}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--pos)]">
            Praised for
          </p>
          {side('pos', st.praise)}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--neg)]">
            Complained about
          </p>
          {side('neg', st.criticism)}
        </div>
      </div>
    )
  }

  interface TableRow {
    key: string
    label: string
    sub: string
    cell: (col: PersonColumn) => ReactNode
    /** Counts only the week's posts; a column with an empty week collapses these. */
    windowed?: boolean
  }

  /* Rows shared by both windows. The sentiment and theme rows are never
     windowed: an opinion reading carries its own dates, and slicing it to a
     week it was not read over would be an invented figure. */
  const reachRow: TableRow = {
    key: 'reach',
    label: 'Reach',
    sub: 'Followers per platform, from the latest reading.',
    cell: reachCell,
  }
  const sentimentRow: TableRow = {
    key: 'sentiment',
    label: 'Sentiment',
    sub: 'The best opinion reading held for this person.',
    cell: sentimentCell,
  }
  const themesRow: TableRow = {
    key: 'themes',
    label: 'Recurring words in their last 10 posts',
    sub: 'From post titles.',
    cell: themesCell,
  }
  const mentionsRow: TableRow = {
    key: 'mentions',
    label: 'Comment mentions',
    sub: 'Up to three quotes each way, word for word.',
    cell: mentionsCell,
  }
  const recordRow: TableRow = {
    key: 'record',
    label: 'Praised for and complained about',
    sub: 'Recurring words from the reading, up to four each way.',
    cell: recordCell,
  }

  /* The three volume rows swap meaning with the window; everything else
     stays put. Under the week they sit together so an empty column can hold
     one spanned cell instead of saying nothing three times. */
  const rows: TableRow[] =
    windowMode === 'week'
      ? [
          reachRow,
          {
            key: 'posted',
            label: 'Posted this week',
            sub: windowLabel ?? 'No compared post carries a date to anchor the week.',
            cell: (col) => postedCounts(weekPostsOf(col)),
            windowed: true,
          },
          {
            key: 'engagement',
            label: 'Reactions this week',
            sub: 'Likes, comments and shares this week.',
            cell: weekReactionsCell,
            windowed: true,
          },
          {
            key: 'working',
            label: 'Best post this week',
            sub: 'Their top post of the week by reactions.',
            cell: bestWeekCell,
            windowed: true,
          },
          sentimentRow,
          themesRow,
          mentionsRow,
          recordRow,
        ]
      : [
          reachRow,
          {
            key: 'posted',
            label: 'Posts stored',
            sub: 'All posts held, from the latest readings.',
            cell: postedAllCell,
          },
          {
            key: 'engagement',
            label: 'Engagement',
            sub: 'Likes, comments and shares on stored posts.',
            cell: engagementCell,
          },
          sentimentRow,
          themesRow,
          {
            key: 'working',
            label: 'What is working',
            sub: 'Their strongest kind of post, and their top posts by reactions.',
            cell: workingCell,
          },
          mentionsRow,
          recordRow,
        ]

  const windowedRowCount = rows.filter((r) => r.windowed).length
  const firstWindowedKey = rows.find((r) => r.windowed)?.key

  const subjectTint = 'bg-[color-mix(in_oklab,var(--accent)_5%,transparent)]'
  /** Sticky cells need an opaque ground, or rows show through as they slide under. */
  const stickyCol =
    'sticky left-0 z-10 border-r border-[var(--rule)] bg-[var(--surface)] text-left align-top'

  const anyReading = handles.some((h) => h.snapshots.length > 0)

  return (
    <div className="space-y-4">
      {/* ── Who is in the table ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {subject && (
          <Chip tone="accent" className="min-h-11 px-3.5" title="Your own accounts hold the first column.">
            {subject.name}
          </Chip>
        )}
        {persons.map((p) => {
          const pressed = shownSet.has(p.key)
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={pressed}
              onClick={() => toggle(p.key)}
              title={pressed ? `Remove ${p.name} from the table` : `Add ${p.name} to the table`}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-colors',
                pressed
                  ? 'border-transparent bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-[var(--border-strong)] bg-[var(--surface)] text-ink-3 hover:border-[var(--border-interactive)] hover:text-ink',
              )}
            >
              {p.name}
              {pressed ? <X size={12} aria-hidden /> : <Plus size={12} aria-hidden />}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-[var(--border-strong)] px-3.5 text-xs font-semibold text-ink-2 transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <UserPlus size={13} aria-hidden />
          Add a competitor
        </button>
      </div>

      {adding && (
        <AddCompetitor
          isTracked={isTracked}
          onTrack={handleTrack}
          onClose={() => setAdding(false)}
        />
      )}

      {/* ── The window ──────────────────────────────────────────────────── */}
      {/* aria-pressed rather than tabs: the control reframes the volume rows
          in place, it does not switch panels. */}
      {columns.length > 0 && (
        <div
          role="group"
          aria-label="Which posts the volume rows count"
          className="pill-tabs max-w-full overflow-x-auto"
        >
          {(
            [
              ['week', 'This week'],
              ['all', 'All stored'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={windowMode === id}
              onClick={() => pickWindow(id)}
              className={cn('pill-tab min-h-11', windowMode === id && 'is-active')}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── The table ───────────────────────────────────────────────────── */}
      {columns.length === 0 ? (
        <Card>
          <p className="text-sm leading-relaxed text-ink-2">
            Every column is switched off. Tap a name above to bring a person back into the table.
          </p>
        </Card>
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th scope="col" className={cn(stickyCol, 'min-w-[10.5rem] px-4 py-4 align-bottom')}>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                      Measure
                    </span>
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      className={cn(
                        'min-w-[13rem] px-4 py-4 text-left align-bottom',
                        col.own && subjectTint,
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <Avatar src={col.avatarUrl} name={col.name} size={36} />
                        <span className="min-w-0">
                          {/* Wraps rather than truncates. This table is the
                              whole point of the section and the column is a
                              person: "Challa Vamshi Chand Reddy" cut to
                              "Challa Vamshi Chand R..." makes the comparison
                              unreadable, and the table already scrolls
                              sideways, so there is room to spend. */}
                          <span className="flex items-start gap-1.5 text-sm font-bold leading-tight text-ink">
                            <span className="max-w-[13rem]">{col.name}</span>
                            {col.own && <Chip tone="accent">you</Chip>}
                          </span>
                          <span className="mt-0.5 block max-w-[13rem] text-[11px] font-normal leading-tight text-ink-3">
                            {col.subline}
                          </span>
                        </span>
                      </span>
                      {/* The record comparison, reachable from the person the
                          reader is already looking at. It lived on the old
                          card list this table replaced, and losing it would
                          re-open the exact gap that card fixed. */}
                      {!col.own && onCompareRecord && (
                        <button
                          type="button"
                          onClick={() => onCompareRecord(refFor(col))}
                          title={`Compare ${identity?.name ?? 'your desk'} against ${col.name} on the published record.`}
                          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[11px] font-semibold text-[var(--accent)] hover:underline sm:min-h-9"
                        >
                          <GitCompareArrows size={12} aria-hidden />
                          Head to head
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row" className={cn(stickyCol, 'px-4 py-4 border-t border-t-[var(--rule)]')}>
                      <span className="block text-[13px] font-semibold leading-snug text-ink">
                        {row.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] font-normal leading-relaxed text-ink-3">
                        {row.sub}
                      </span>
                    </th>
                    {columns.map((col) => {
                      // A column with an empty week holds one spanned cell
                      // across the volume rows, so "Nothing posted this week."
                      // is said once instead of three dashed cells implying
                      // three separate unknowns.
                      if (row.windowed && weekPostsOf(col).length === 0) {
                        if (row.key !== firstWindowedKey) return null
                        return (
                          <td
                            key={col.key}
                            rowSpan={windowedRowCount}
                            className={cn(
                              'border-t border-[var(--rule)] px-4 py-4 align-top',
                              col.own && subjectTint,
                            )}
                          >
                            {emptyWeekCell(col)}
                          </td>
                        )
                      }
                      return (
                        <td
                          key={col.key}
                          className={cn(
                            'border-t border-[var(--rule)] px-4 py-4 align-top',
                            col.own && subjectTint,
                          )}
                        >
                          {row.cell(col)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!anyReading && (
            <p className="border-t border-[var(--rule)] px-5 py-3.5 text-xs leading-relaxed text-ink-3">
              No account here has a stored reading yet. Refresh them under Accounts and the table
              fills in.
            </p>
          )}
        </Card>
      )}
    </div>
  )
}
