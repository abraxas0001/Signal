import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBackToDismiss } from '@/lib/nav-history'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import NumberFlow from '@number-flow/react'
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  Hash,
  IdCard,
  Languages,
  ShieldAlert,
  Sparkles,
  ArrowRight,
  Bookmark,
  Download,
  ExternalLink,
  Flag,
  MapPin,
  Newspaper,
  Radio,
} from 'lucide-react'
import type { Sentiment } from '@shared/taxonomy'
import { useStore } from '@/lib/store'
import { listHandles } from '@/lib/handles'
import { demoPartyMark, type PartyMark } from '@/lib/party-brand'
import { NON_TOPIC, recurringTerms } from '@/lib/terms'
import { newsMentionsOf } from '@/lib/news-mentions'
import { cn } from '@/lib/utils'
import { fadeUp, listStagger } from '@/lib/motion'
import { Avatar, Card, Empty, Shell } from './ui'
import type { PersonaMention } from './Persona'

/**
 * Local News Mentions — the owner's reference page, built to it element for
 * element, and wired to what the desk has actually read.
 *
 * WHAT IS REAL HERE. Every figure on this screen is counted from
 * `personaMentions`: stories the desk searched for, opened and had read. The
 * reference sheet carries a worked example (356 mentions, 47.2% positive, a
 * 2.1M reach); an office that has read nine stories has to see nine, so the
 * layout is the reference's and the arithmetic is the desk's.
 *
 * THE ONE FIGURE WE DO NOT HAVE. The reference puts "Potential Reach" beside
 * every story and at the head of the page. A newspaper does not publish its
 * readership to us and we do not estimate it — the only reach-like figure in
 * this product is a model's guess about social posts, which is exactly the
 * fabrication this screen refuses. So the slot the reference spends on reach
 * carries a figure this desk actually holds instead: the number of distinct
 * days in the window on which a stored story was published.
 *
 * EVERY WINDOW IS THE ARTICLE'S OWN. Windowed figures and deltas key on
 * `publishedAt` — the date the portal printed — never on when the desk read
 * the story. A story whose portal gave no date joins no window and no delta;
 * it counts in all-time totals and stands in the all-time list only.
 *
 * SENTIMENT IS THE STANCE THE READING RECORDED. `stance` is what the model
 * concluded about a story; `sentiment` is a second, coarser field that is
 * often null. Stance leads because it is the one that is populated, and the
 * word is printed beside the colour on every badge, because roughly one man in
 * twelve cannot separate the red from the green.
 */

/* ── the window ──────────────────────────────────────────────────────────── */

type Window = 7 | 30 | 90 | 180

const WINDOWS: { id: Window; label: string }[] = [
  { id: 7, label: 'Last 7 Days' },
  { id: 30, label: 'Last 30 Days' },
  { id: 90, label: 'Last 90 Days' },
  // Six months, at the office's request: the short windows on a desk read in
  // batches can be sparse, and this is the press that widens out of them.
  { id: 180, label: 'Last 6 Months' },
]

type Tone = 'positive' | 'negative' | 'neutral'

/** Supportive/critical/neutral, collapsed to the three the page counts in. */
function toneOf(mention: PersonaMention): Tone | null {
  if (mention.stance === 'supportive') return 'positive'
  if (mention.stance === 'critical') return 'negative'
  if (mention.stance === 'neutral') return 'neutral'
  // 'unclear' is not a neutral reading, it is an absent one. Counting it as
  // neutral would inflate the neutral share with stories nobody could call.
  const s: Sentiment | null = mention.sentiment
  if (s === 'Strong Positive' || s === 'Positive') return 'positive'
  if (s === 'Strong Negative' || s === 'Negative') return 'negative'
  if (s === 'Neutral') return 'neutral'
  // 'Mixed' is a real reading, but it is not one of the three columns this
  // page counts in, so it stays out rather than being rounded into one.
  return null
}

const TONE_LABEL: Record<Tone, string> = {
  positive: 'Positive',
  negative: 'Negative',
  neutral: 'Neutral',
}

const TONE_VAR: Record<Tone, { fg: string; soft: string }> = {
  positive: { fg: 'var(--pos)', soft: 'var(--pos-soft)' },
  negative: { fg: 'var(--neg)', soft: 'var(--neg-soft)' },
  neutral: { fg: 'var(--warn)', soft: 'var(--warn-soft)' },
}

/**
 * The same three tones as FILLS — wheel segments, bars, chart lines.
 *
 * Text and paint want different neutrals: at 10px on a cream chip the amber
 * the reference paints its wheel with is unreadable, and the dark shade that
 * reads there turns the wheel's largest segment to mud. So text keeps
 * `TONE_VAR[...].fg` and everything filled takes this.
 */
const TONE_MARK: Record<Tone, string> = {
  positive: 'var(--pos)',
  negative: 'var(--neg)',
  neutral: 'var(--ln-neutral)',
}

/**
 * The language a story ran in, in one form.
 *
 * The desk's two shelves record this differently — a scanned mention carries
 * the ISO code "en", a filed record carries the word "Telugu" — and printing
 * both side by side made one field look like two. Nothing is guessed: an
 * unrecognised value is passed through as it was stored.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  te: 'Telugu',
  hi: 'Hindi',
  ur: 'Urdu',
  ta: 'Tamil',
  kn: 'Kannada',
  mr: 'Marathi',
}

function languageName(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  return LANGUAGE_NAMES[v.toLowerCase()] ?? v
}

/**
 * Words a headline uses to be a headline, not to be about anything.
 *
 * "Report", "supply" and "update" recur across any week's press and say
 * nothing about what the week was about, so a keyword list led by them reads
 * as noise. This drops them from the ranking only; every count elsewhere on
 * the page still includes the stories they came from.
 */
const NEWS_STOPWORDS = new Set([
  // the words a headline uses to be a headline
  'report', 'reports', 'reported', 'news', 'update', 'updates', 'says', 'said',
  'latest', 'today', 'story', 'stories', 'article', 'articles', 'amid',
  'ahead', 'held', 'seen', 'told', 'adds', 'amidst',
  // place-in-a-sentence words that outlived the shared function-word list
  'last', 'main', 'first', 'next', 'another', 'several', 'many', 'area',
  'areas', 'local', 'due', 'soon', 'week', 'weeks', 'month', 'months', 'year',
  'years', 'since', 'near', 'top', 'big', 'small', 'high', 'low', 'long',
  'whole', 'way', 'ways', 'days', 'one', 'two', 'three', 'single', 'double',
  'various', 'different', 'number', 'total', 'among', 'across',
])

const pct = (n: number, of: number): number => (of === 0 ? 0 : Math.round((n / of) * 1000) / 10)

const compactNum = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
      : String(n)

/**
 * The instant a story was PUBLISHED, or null when its portal printed no date.
 *
 * Every window and delta on this screen keys on this — the article's own
 * date, never the desk's reading time. A batch read this week is not this
 * week's news, and windowing on `seenAt` once let exactly that batch pile
 * into the current window and print a four-digit percent against a thin
 * previous one. A dateless story joins no window and no delta; it counts in
 * all-time totals and holds its place on the all-time list only.
 */
function stampOf(mention: PersonaMention): number | null {
  if (!mention.publishedAt) return null
  const t = Date.parse(mention.publishedAt)
  return Number.isFinite(t) ? t : null
}

/**
 * Percent change against the previous window, or null when it refuses.
 *
 * The floor is three stories on BOTH sides. Guarding only the previous side
 * let three old stories against a fat current window print "↑ 2266.7%" — a
 * ratio, not a trend — so a thin side on either end, or no movement at all,
 * renders nothing rather than dressing a tiny base up as one.
 */
function deltaOf(current: number, previous: number): number | null {
  if (current < 3 || previous < 3 || current === previous) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

/** "31 May, 2025 · 10:45 AM", or just the date when no clock time is on file. */
function whenOf(mention: PersonaMention): string {
  const raw = mention.publishedAt
  if (!raw) return 'Date not published'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return 'Date not published'
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  // A feed that carried only a date parses to local midnight. Printing
  // "12:00 AM" against it would invent a publication time.
  const midnight = d.getHours() === 0 && d.getMinutes() === 0
  if (midnight) return date
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${time}`
}

/* ── the reference's one-screen fit, as CSS knobs ────────────────────────── */

/**
 * The reference sheet is a fixed 1536x1024 composition that never scrolls, and
 * this app hangs a 60px top bar over the same window. Every height that
 * decides whether the page fits — card padding, grid gaps, chart heights, the
 * mention thumbnail — is a variable here, set once for the reference ratio and
 * once more for shorter laptops (1600x900), so the whole fit is tuned in one
 * place instead of forty. Scoped to `.ln`, which only this screen renders.
 *
 * The tinted colours carry their own dark-theme overrides the same way
 * `.entry-accent` does in index.css; nothing here leaks past this screen.
 */
const LN_CSS = `
.ln {
  --radius-lg: 14px;
  --ln-pad: 12px;
  --ln-gap: 10px;
  --ln-thumb: 60px;
  --ln-chart: 88px;
  --ln-spark: 42px;
  --ln-donut: 96px;
  --ln-donut-s: 86px;
  --ln-mrow: 7px;
  --ln-krow: 23px;
  --ln-srow: 30px;
  --ln-neutral-mark: #94a3b8;
  /*
   * THE NEUTRAL FILL. The --warn token is #b45309, a burnt brown that has to survive
   * as small text on a cream chip; painted across the sentiment wheel's
   * largest segment it turned the whole card muddy. The reference's neutral
   * is a warm amber, so every FILL on this screen — wheel segment, tile bar,
   * the over-time line — takes that amber, while neutral TEXT keeps the dark
   * shade it needs to stay readable at 10px.
   */
  --ln-neutral: #e3a946;
  /*
   * THE ONE-SCREEN FIT. The reference is a 1536x1024 sheet that owns the
   * whole window; this app keeps a 240px sidebar and a 60px top bar around
   * the same glass. Rather than squeezing every card differently per laptop,
   * the composition is drawn once at the reference's own density and scaled
   * as a whole into what the chrome leaves — the sidebar's share happens to
   * equal the top bar's, so one factor honours both axes. Browsers without
   * zoom simply scroll, losing nothing.
   */
  zoom: 0.95;
  max-width: none;
}
@media (min-height: 1180px) {
  .ln { zoom: 1; }
}
@media (max-height: 950px) {
  .ln {
    zoom: 0.87;
    --ln-pad: 10px;
    --ln-gap: 8px;
    --ln-chart: 74px;
    --ln-spark: 34px;
    --ln-donut: 90px;
    --ln-donut-s: 80px;
    --ln-mrow: 6px;
    --ln-krow: 21px;
    --ln-srow: 28px;
  }
}
@media (max-height: 820px) {
  .ln { zoom: 0.7; }
}
/* The app shell breathes 32px over and 64px under every screen; a sheet
   built to fill one window exactly needs that slice back. Scoped by :has so
   it holds only while this screen is mounted. */
main:has(.ln) { padding-top: 8px; padding-bottom: 6px; }
/* NumberFlow reserves over a quarter-em above and below for its digit roll;
   on a one-screen sheet that spacer is rent this page cannot pay. */
.ln number-flow-react { --number-flow-mask-height: 0.05em; }
.ln-ground { position: fixed; inset: 0; z-index: -1; background: #f4f4fb; }
.ln-tint-0 { background: #eef0fe; }
.ln-tint-1 { background: #fdf4e3; }
.ln-tint-2 { background: #e8f8ef; }
.ln-tint-3 { background: #e8f2fd; }
.ln-tint-4 { background: #f1edfd; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .ln-ground { background: var(--bg); }
  :root:not([data-theme='light']) .ln .ln-tint-0,
  :root:not([data-theme='light']) .ln .ln-tint-1,
  :root:not([data-theme='light']) .ln .ln-tint-2,
  :root:not([data-theme='light']) .ln .ln-tint-3,
  :root:not([data-theme='light']) .ln .ln-tint-4 { background: var(--surface-2); }
  :root:not([data-theme='light']) .ln { --ln-neutral-mark: #64748b; --ln-neutral: #e0ab55; }
}
[data-theme='dark'] .ln-ground { background: var(--bg); }
[data-theme='dark'] .ln .ln-tint-0,
[data-theme='dark'] .ln .ln-tint-1,
[data-theme='dark'] .ln .ln-tint-2,
[data-theme='dark'] .ln .ln-tint-3,
[data-theme='dark'] .ln .ln-tint-4 { background: var(--surface-2); }
[data-theme='dark'] .ln { --ln-neutral-mark: #64748b; --ln-neutral: #e0ab55; }
/*
 * THE FILTER PILLS' OWN TYPE SIZE.
 *
 * index.css sets a font-size floor of max(16px, var(--text-base)) on every
 * input, select and textarea, OUTSIDE every cascade layer, and unlayered author CSS beats a layered
 * Tailwind utility no matter how specific the utility is — so these pills
 * rendered at 17px however small a class they carried, louder than every card
 * title on the sheet. That floor exists to stop iOS zooming a focused field,
 * which is a phone problem and stays one: this rule is unlayered too, more
 * specific, and scoped to this screen and to widths where no phone keyboard
 * will ever open. The cap keeps a pill near the reference's ~110px when one
 * option's text runs long, and ellipsis rather than clipping says so.
 */
@media (min-width: 640px) {
  .ln select { font-size: 12px; max-width: 140px; text-overflow: ellipsis; }
  .ln select.ln-window { font-size: 12.5px; max-width: none; }
}
@keyframes ln-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.ln-bar { transform-origin: left; animation: ln-grow 0.8s cubic-bezier(0.25, 0.8, 0.3, 1) both; }
.ln-lift { transition: transform 0.15s ease, box-shadow 0.15s ease; }
.ln-lift:hover { transform: translateY(-1px); }
.ln-link .ln-arrow { transition: transform 0.15s ease; }
.ln-link:hover .ln-arrow { transform: translateX(2px); }
@media (prefers-reduced-motion: reduce) {
  .ln-bar { animation: none; }
  .ln-lift, .ln-lift:hover { transform: none; transition: none; }
  .ln-link:hover .ln-arrow { transform: none; }
}
`

/** The style knobs plus the lavender sheet the reference sits on. */
function LocalNewsChrome() {
  return (
    <>
      <style>{LN_CSS}</style>
      <div className="ln-ground" aria-hidden />
    </>
  )
}

/**
 * A figure that counts up to its real value on arrival — the reference's
 * counters imply exactly this motion. The value it lands on is the counted
 * one; only the journey is animation, and a reader who asked for stillness
 * gets the number straight away.
 */
function CountUp({ value, className }: { value: number; className?: string }) {
  const still = useReducedMotion()
  const [shown, setShown] = useState(still ? value : 0)
  useEffect(() => {
    if (still) {
      setShown(value)
      return
    }
    const raf = requestAnimationFrame(() => setShown(value))
    return () => cancelAnimationFrame(raf)
  }, [value, still])
  return <NumberFlow value={shown} className={className} />
}

/** The reference's "View all … →" link, arrow nudging on hover. */
function ViewAllLink({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'ln-link inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)]',
        className,
      )}
    >
      {children}
      <ArrowRight size={12} className="ln-arrow" aria-hidden />
    </button>
  )
}

/* ── the page ────────────────────────────────────────────────────────────── */

/*
 * THE ONE SCREEN IN THE APP WITH NO WAY BACK.
 *
 * `onClose` was accepted and then discarded, on the reasoning that the
 * reference image carries no Back control and that system back plus the
 * navigation rail were exit enough. Audited across all thirteen screens, this
 * was the only one without a visible way out, and the office found it: "there
 * are pages which doesnt have back buttons".
 *
 * The rail is `lg:` and up, so on a phone there was no on-screen exit at all —
 * only the hardware gesture. A reference screenshot is a picture of a page,
 * not a specification for a screen inside an app that has somewhere to go
 * back to. The control goes above the title rather than into the header row,
 * so the reference's one-line header is left exactly as it was drawn.
 */
export function LocalNews({ onClose }: { onClose?: () => void }) {
  const store = useStore()
  const [days, setDays] = useState<Window>(7)
  const [tone, setTone] = useState<Tone | 'all'>('all')
  /**
   * The story whose reading is open, or null for the list.
   *
   * A PAGE, not a panel under the row. Printed inline it pushed the rest of
   * the feed down and put two things on screen competing for the same read;
   * the office asked for the button to take them somewhere.
   */
  const [reading, setReading] = useState<PersonaMention | null>(null)
  /* System back dismisses the full story reading over the mentions list, the way it already does for the identical
     layer on the grievance record. Without this the reader's back press left
     the whole screen instead of closing what they had opened. */
  useBackToDismiss(reading !== null, useCallback(() => setReading(null), []))
  const [talkLens, setTalkLens] = useState<'keywords' | 'topics'>('keywords')
  /**
   * Does the mentions list answer the window, or the whole shelf?
   *
   * It answered the whole shelf always, which put "11 Total Mentions (Last 7
   * Days)" four inches from "19 stories" and shipped an all-time CSV named for
   * a window it did not obey. The window now rules the list like it rules
   * every other card, and the reference's own "View all mentions" link is what
   * widens it — a reader's deliberate act, with the card's subtitle, its
   * counts and the export's name all following wherever it stands.
   */
  const [showAll, setShowAll] = useState(false)
  const [place, setPlace] = useState('all')
  const [source, setSource] = useState('all')
  const [topic, setTopic] = useState('all')

  /**
   * Both shelves: the persona scan's mentions AND the stories the grievance
   * desk filed. They are the same kind of thing — a piece a local paper ran —
   * and keeping them apart left this screen empty on a desk whose grievance
   * list was full of the morning's coverage.
   */
  const all = useMemo(
    () => newsMentionsOf(store, store.identity?.name ?? 'this desk'),
    [store],
  )

  /** Everything PUBLISHED inside the chosen window, newest first. A story
      whose portal printed no date belongs to no window, so it is not here. */
  const inWindow = useMemo(() => {
    const cut = Date.now() - days * 86_400_000
    return all
      .filter((x) => {
        const t = stampOf(x)
        return t !== null && t >= cut
      })
      .sort((a, b) => (stampOf(b) ?? 0) - (stampOf(a) ?? 0))
  }, [all, days])

  /** The lists the filter bar offers: only values that actually occur. */
  const placeOptions = useMemo(
    () => [...new Set(inWindow.map((x) => (x.place ?? '').trim()).filter(Boolean))].sort(),
    [inWindow],
  )
  /**
   * Only the subjects that actually occur in this window.
   *
   * Stories the persona scan found carry no topic at all, so they never appear
   * here, and choosing a subject leaves them out: the filter answers for the
   * records the desk actually classified rather than pretending the whole
   * shelf is filed by subject.
   */
  const topicOptions = useMemo(
    () =>
      [...new Set(all.map((x) => (x.topic ? String(x.topic) : null)).filter((s): s is string => Boolean(s)))].sort(),
    [all],
  )

  const sourceOptions = useMemo(
    () => [...new Set(inWindow.map((x) => (x.publisher ?? '').trim()).filter(Boolean))].sort(),
    [inWindow],
  )

  /** What the whole page counts: the window, narrowed by the filter bar. */
  const window = useMemo(
    () =>
      inWindow.filter(
        (x) =>
          (place === 'all' || (x.place ?? '').trim() === place) &&
          (source === 'all' || (x.publisher ?? '').trim() === source) &&
          // A story the desk never classified cannot answer a subject filter,
          // so choosing one leaves it out rather than guessing where it sits.
          (topic === 'all' || x.topic === topic),
      ),
    [inWindow, place, source, topic],
  )

  /**
   * The same length of window immediately before this one, split by tone, so
   * the sentiment card can report movement per side the way the reference
   * does and not only a movement in volume.
   */
  const previous = useMemo(() => {
    const end = Date.now() - days * 86_400_000
    const start = end - days * 86_400_000
    const rows = all.filter((x) => {
      const t = stampOf(x)
      return t !== null && t >= start && t < end
    })
    let positive = 0
    let negative = 0
    let neutral = 0
    for (const x of rows) {
      const tn = toneOf(x)
      if (tn === 'positive') positive++
      else if (tn === 'negative') negative++
      else if (tn === 'neutral') neutral++
    }
    return { total: rows.length, positive, negative, neutral }
  }, [all, days])

  const counts = useMemo(() => {
    let positive = 0
    let negative = 0
    let neutral = 0
    let unread = 0
    for (const x of window) {
      const t = toneOf(x)
      if (t === 'positive') positive++
      else if (t === 'negative') negative++
      else if (t === 'neutral') neutral++
      else unread++
    }
    return { total: window.length, positive, negative, neutral, unread }
  }, [window])

  /** One count per day across the window. Drives the card's sparkline. */
  const daily = useMemo(() => {
    const span = Math.min(days, 14)
    const out: number[] = []
    for (let i = span - 1; i >= 0; i--) {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      start.setDate(start.getDate() - i)
      const end = start.getTime() + 86_400_000
      out.push(
        window.filter((x) => {
          const t = stampOf(x)
          return t !== null && t >= start.getTime() && t < end
        }).length,
      )
    }
    return out
  }, [window, days])

  const sources = useMemo(() => {
    const by = new Map<string, { name: string; total: number; positive: number; negative: number; neutral: number }>()
    for (const x of window) {
      const name = (x.publisher ?? '').trim()
      if (!name) continue
      const k = name.toLowerCase()
      const row = by.get(k) ?? { name, total: 0, positive: 0, negative: 0, neutral: 0 }
      row.total++
      const t = toneOf(x)
      if (t) row[t]++
      by.set(k, row)
    }
    return [...by.values()].sort((a, b) => b.total - a.total)
  }, [window])

  const places = useMemo(() => {
    const by = new Map<string, { name: string; total: number }>()
    for (const x of window) {
      const name = (x.place ?? '').trim()
      if (!name) continue
      const k = name.toLowerCase()
      const row = by.get(k) ?? { name, total: 0 }
      row.total++
      by.set(k, row)
    }
    return [...by.values()].sort((a, b) => b.total - a.total)
  }, [window])

  /** The words that actually recur across the headlines the desk has read. */
  const keywords = useMemo(() => {
    const texts = window.map((x) => `${x.headline} ${x.excerpt}`)
    /* The desk's own name, plus the shared list of words that are real words
       and never a subject — the same one the compare screen counts by. */
    const own = new Set([
      ...NON_TOPIC,
      ...[store.identity?.name, store.identity?.party]
        .filter((v): v is string => Boolean(v))
        .flatMap((v) => v.toLowerCase().split(/\s+/)),
    ])
    // Twenty collected, eight shown: the card's "View all keywords" needs a
    // fuller list than its first screen, and the counting is the same either
    // way.
    /* Places answer "Mentions by Location" two cards away; ranking them here
       as things being talked ABOUT put a district where a subject belongs. */
    const placeWords = new Set(
      places.flatMap((p) => p.name.toLowerCase().split(/[^a-z]+/i)).filter(Boolean),
    )
    const terms = recurringTerms(texts, 20, own) ?? []
    return terms
      .filter((term) => {
        const k = term.toLowerCase()
        return !NEWS_STOPWORDS.has(k) && !placeWords.has(k)
      })
      .map((term) => {
        const needle = term.toLowerCase()
        const hits = window.filter((x) => `${x.headline} ${x.excerpt}`.toLowerCase().includes(needle))
        let positive = 0
        for (const h of hits) if (toneOf(h) === 'positive') positive++
        return { term, count: hits.length, positive: pct(positive, hits.length) }
      })
      .filter((k) => k.count > 0)
  }, [window, places, store.identity])

  /** Places, used as the second lens, because a topic list we cannot derive
      honestly is worse than a second real cut of the same stories. */
  /**
   * REAL SUBJECTS, NOT PLACES WEARING THE NAME. This memo used to rank places
   * because mentions carried no topic and a place was the nearest thing to
   * one; the button above it even said "By places" while the reference says
   * "By topics". Mentions that arrive from the grievance desk now carry the
   * taxonomy's own subject, so the lens can finally answer the question its
   * name asks. Stories the scan never classified carry no topic and are
   * simply not counted here, which the empty state says out loud.
   */
  const topics = useMemo(() => {
    const byTopic = new Map<string, { count: number; positive: number }>()
    for (const x of window) {
      const subject = x.topic ? String(x.topic) : null
      if (!subject) continue
      const row = byTopic.get(subject) ?? { count: 0, positive: 0 }
      row.count++
      if (toneOf(x) === 'positive') row.positive++
      byTopic.set(subject, row)
    }
    return [...byTopic.entries()]
      .map(([term, r]) => ({ term, count: r.count, positive: pct(r.positive, r.count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  }, [window])

  /**
   * THE ENTITIES THE STORIES ACTUALLY CARRY, from three real sources and no
   * other: the person each story was searched for and filed under (this used
   * to key on personaId alone, so grievance-origin stories counted for
   * nobody and the persona tile undercounted its own subject); the places
   * the stories' own place field names; and the parties whose names occur in
   * the text the desk holds — a count of stories whose headline or excerpt
   * literally prints "BJP" is a checkable fact, where "stories about the
   * BJP" would be a guess. An entity with no story in the window is simply
   * absent: nothing here is padded to fill a row of five.
   */
  const entities = useMemo(() => {
    const prevStart = Date.now() - 2 * days * 86_400_000
    const prevEnd = Date.now() - days * 86_400_000
    const inPrev = (x: PersonaMention): boolean => {
      const t = stampOf(x)
      return t !== null && t >= prevStart && t < prevEnd
    }
    const build = (
      id: string,
      name: string,
      kind: EntityKind,
      match: (x: PersonaMention) => boolean,
      art: PartyMark | null = null,
    ): EntityRow | null => {
      const mine = window.filter(match)
      if (mine.length === 0) return null
      let positive = 0
      let negative = 0
      let neutral = 0
      for (const x of mine) {
        const t = toneOf(x)
        if (t === 'positive') positive++
        else if (t === 'negative') negative++
        else if (t === 'neutral') neutral++
      }
      const prevCount = all.filter((x) => inPrev(x) && match(x)).length
      return { id, name, kind, art, total: mine.length, positive, negative, neutral, previous: prevCount }
    }

    /**
     * The faces the desk already stores, matched by the name a story is filed
     * under: the subject's own identity photograph first, then any tracked
     * account whose display name is the same. Stored files only — nothing is
     * fetched here, and a name with no stored face keeps its glyph.
     */
    const roster = listHandles()
    const artFor = (key: string, name: string): PartyMark | null => {
      const idn = store.identity
      if (idn?.photoUrl && [idn.name, ...idn.aliases].some((a) => a.trim().toLowerCase() === key))
        return { url: idn.photoUrl, alt: idn.name }
      const known = roster.find(
        (h) => h.avatarUrl && (h.displayName ?? '').trim().toLowerCase() === key,
      )
      return known?.avatarUrl ? { url: known.avatarUrl, alt: known.displayName ?? name } : null
    }

    const rows: EntityRow[] = []
    // Every name a story in the window is filed under — roster or not.
    const people = new Map<string, string>()
    for (const x of window) {
      const n = (x.persona || '').trim()
      if (n && !people.has(n.toLowerCase())) people.set(n.toLowerCase(), n)
    }
    for (const [key, name] of people) {
      const row = build(
        `person_${key}`,
        name,
        'person',
        (x) => (x.persona || '').trim().toLowerCase() === key,
        artFor(key, name),
      )
      if (row) rows.push(row)
    }
    // Every place the stories' own place field names.
    const placeNames = new Map<string, string>()
    for (const x of window) {
      const n = (x.place ?? '').trim()
      if (n && !placeNames.has(n.toLowerCase())) placeNames.set(n.toLowerCase(), n)
    }
    for (const [key, name] of placeNames) {
      const row = build(`place_${key}`, name, 'place', (x) => (x.place ?? '').trim().toLowerCase() === key)
      if (row) rows.push(row)
    }
    // Parties, counted by their name actually occurring in the story's text.
    for (const p of PARTY_PATTERNS) {
      const row = build(
        `party_${p.name}`,
        p.name,
        'party',
        (x) => p.re.test(`${x.headline} ${x.excerpt}`),
        // The official mark, and only on the example desk — a real office's
        // screen never carries a symbol its own files did not supply.
        demoPartyMark(p.name),
      )
      if (row) rows.push(row)
    }
    return rows.sort((a, b) => b.total - a.total)
  }, [window, all, days, store.identity])

  /**
   * WHAT THE LIST PAGES THROUGH: by default exactly the stories every other
   * card on this page counts — the window, narrowed by the filter bar — so the
   * sheet answers one question. Older and dateless stories are not lost: the
   * reference's "View all mentions" link opens the whole shelf, and when it is
   * open the card's subtitle, its counts and the export's own name all say so.
   */
  const shelf = useMemo(
    () =>
      all.filter(
        (x) =>
          (place === 'all' || (x.place ?? '').trim() === place) &&
          (source === 'all' || (x.publisher ?? '').trim() === source) &&
          (topic === 'all' || x.topic === topic),
      ),
    [all, place, source, topic],
  )

  const feedBase = showAll ? shelf : window

  const feed = useMemo(
    () => (tone === 'all' ? feedBase : feedBase.filter((x) => toneOf(x) === tone)),
    [feedBase, tone],
  )

  /** The tone tabs' counts, from the same all-time list the tabs cut. */
  const feedCounts = useMemo(() => {
    let positive = 0
    let negative = 0
    let neutral = 0
    for (const x of feedBase) {
      const t = toneOf(x)
      if (t === 'positive') positive++
      else if (t === 'negative') negative++
      else if (t === 'neutral') neutral++
    }
    return { total: feedBase.length, positive, negative, neutral }
  }, [feedBase])

  /**
   * Distinct languages the window's stories were published in — a counted
   * fact, and one this desk's press genuinely splits on. It stands where the
   * reference repeats its own headline number as "News Articles"; a card
   * stating one fact twice is a row spent saying nothing.
   */
  const languages = useMemo(() => {
    const seen = new Set<string>()
    for (const x of window) {
      const n = languageName(x.language)
      if (n) seen.add(n.toLowerCase())
    }
    return seen.size
  }, [window])

  /**
   * Distinct days in the window on which a stored story was PUBLISHED — a
   * counted fact standing where the reference spends a "Potential Reach"
   * nobody can measure honestly.
   */
  const daysCovered = useMemo(() => {
    const seen = new Set<string>()
    for (const x of window) {
      const t = stampOf(x)
      if (t !== null) seen.add(new Date(t).toDateString())
    }
    return seen.size
  }, [window])

  const windowLabel = WINDOWS.find((w) => w.id === days)?.label ?? 'Last 7 Days'

  // The reading takes the screen. Shown under the feed it competed with the
  // list for the same read, which is what the office objected to.
  if (reading) {
    return (
      <Shell className="entry-accent ln">
        <LocalNewsChrome />
        <div className="pb-8 pt-2">
          <ReadingPage mention={reading} onBack={() => setReading(null)} />
        </div>
      </Shell>
    )
  }

  return (
    <Shell className="entry-accent ln">
      <LocalNewsChrome />
      <m.div
        variants={listStagger}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-[var(--ln-gap)] pb-0.5 pt-0.5"
      >
        {onClose ? (
          <m.div variants={fadeUp} className="-mb-1">
            <button
              type="button"
              onClick={onClose}
              className={
                'inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-2 -ml-2 ' +
                'text-[13px] font-semibold text-ink-2 transition-colors ' +
                'hover:bg-[var(--surface-2)] hover:text-ink'
              }
            >
              <ArrowLeft size={16} aria-hidden />
              Back
            </button>
          </m.div>
        ) : null}
        {/* The reference's header row: a bold sans title with a lavender
            pin badge, the subtitle beneath, and the window + export pills at
            the right — one line. */}
        <m.header
          variants={fadeUp}
          className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2"
        >
          <div className="min-w-0">
            {/* The weight is inline because index.css sets h1 to 600 OUTSIDE
                any cascade layer, and unlayered author CSS beats every
                Tailwind utility — font-extrabold silently rendered 600 here
                until this was measured against the reference's 700. */}
            <h1
              style={{ fontWeight: 700 }}
              className="flex items-center gap-2 text-[26px] leading-tight tracking-[-0.02em]"
            >
              Local News Mentions
              {/* The reference marks this screen with a location pin in a
                  soft rounded square beside its title. */}
              <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-[var(--accent-soft)] text-[var(--accent)]">
                <MapPin size={14} aria-hidden />
              </span>
            </h1>
            <p className="mt-0.5 text-[12.5px] text-ink-2">
              Track what&rsquo;s being said in local news about you, your party, and key topics.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">Window</span>
              <Calendar
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2"
                aria-hidden
              />
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value) as Window)}
                className="ln-window h-9 appearance-none rounded-[10px] border border-[var(--border)] bg-[var(--surface)] pl-8 pr-8 text-[12.5px] font-semibold outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)]"
              >
                {WINDOWS.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
              {/* No chevron drawn here: the app's global select style already
                  paints one, and drawing a second beside it doubled the arrow. */}
            </label>
            {/* Named for exactly the rows it carries: the window while the
                list obeys it, the whole shelf once the reader opens it. */}
            <ExportButton mentions={feed} windowLabel={showAll ? 'All stories' : windowLabel} />
          </div>
        </m.header>

        {all.length === 0 ? (
          <m.div variants={fadeUp}>
            <Empty
              icon={<Newspaper size={19} />}
              title="No local news has been read yet"
              body="This page counts stories the desk has searched for and had read. Run a scan from the People screen to start filling it, and every figure here will be a count of those readings."
            />
          </m.div>
        ) : (
          <>
            {/* ── the body: left rail, then the main area ─────────────── */}
            <div className="grid gap-[var(--ln-gap)] xl:grid-cols-[minmax(0,17.5rem)_minmax(0,1fr)] xl:items-start">
              {/* ── left rail ───────────────────────────────────────── */}
              <m.div variants={fadeUp} className="grid gap-[var(--ln-gap)]">
                <OverallMentions
                  counts={counts}
                  sources={sources.length}
                  places={places.length}
                  languages={languages}
                  windowLabel={windowLabel}
                  previous={previous.total}
                  daysCovered={daysCovered}
                  days={days}
                  daily={daily}
                />
                <ByLocation places={places} total={counts.total} />
                <OverTime mentions={window} days={days} />
              </m.div>

              {/* ── main area ───────────────────────────────────────── */}
              <div className="grid min-w-0 gap-[var(--ln-gap)]">
                {/* The reference's filter row: white text-only pills with a
                    chevron. Every option here is a value that actually occurs
                    in the window, so the bar can never offer a cut that
                    returns nothing. */}
                <m.div variants={fadeUp} className="flex flex-wrap gap-2">
                  <FilterPill label="All Locations" value={place} onChange={setPlace} options={placeOptions} />
                  {topicOptions.length > 0 && (
                    <FilterPill label="All Topics" value={topic} onChange={setTopic} options={topicOptions} />
                  )}
                  <FilterPill
                    label="All Sentiment"
                    value={tone}
                    onChange={(v) => setTone(v as Tone | 'all')}
                    options={['positive', 'negative', 'neutral']}
                    labels={TONE_LABEL}
                  />
                  <FilterPill label="All Sources" value={source} onChange={setSource} options={sourceOptions} />
                  {(place !== 'all' || source !== 'all' || tone !== 'all' || topic !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setPlace('all')
                        setSource('all')
                        setTone('all')
                        setTopic('all')
                      }}
                      className="inline-flex h-8 items-center rounded-[8px] px-3 text-[12px] font-semibold text-[var(--accent)]"
                    >
                      Clear filters
                    </button>
                  )}
                </m.div>

                <m.div variants={fadeUp} className="grid gap-[var(--ln-gap)] lg:grid-cols-[minmax(0,505fr)_minmax(0,648fr)] lg:items-stretch">
                  <SentimentOverviewCard counts={counts} prev={previous} />
                  <TopEntities entities={entities} />
                </m.div>

                <m.div variants={fadeUp} className="grid gap-[var(--ln-gap)] xl:grid-cols-[minmax(0,739fr)_minmax(0,412fr)] xl:items-start">
                  <RecentMentions
                    mentions={feed}
                    tone={tone}
                    onTone={setTone}
                    counts={feedCounts}
                    onOpenReading={setReading}
                    windowLabel={windowLabel}
                    showAll={showAll}
                    onShowAll={setShowAll}
                    shelfTotal={shelf.length}
                  />
                  <div className="grid min-w-0 gap-[var(--ln-gap)]">
                    <TalkedAbout
                      lens={talkLens}
                      onLens={setTalkLens}
                      rows={talkLens === 'keywords' ? keywords : topics}
                    />
                    <TopSources sources={sources} />
                  </div>
                </m.div>

              </div>
            </div>

            {/* The reference closes the page with this band, and the office
                asked for the reference exactly. It is not quite the card at
                the top: the tiles up there answer "who is named", while these
                cards carry each entity's tone split and its movement against
                the previous window, which fits nowhere in a tile. */}
            <m.div variants={fadeUp}>
              <KeyEntities entities={entities} days={days} />
            </m.div>
          </>
        )}
      </m.div>
    </Shell>
  )
}

function FilterPill({
  label,
  value,
  onChange,
  options,
  labels,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
  /** Display names, where the stored value is a code rather than a word. */
  labels?: Record<string, string>
}) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      {/* Text only — the reference's pills carry no leading icon, and the
          app's global select style already paints the one chevron. A Lucide
          chevron drawn on top of it is how these pills grew two arrows. */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={options.length === 0}
        className="h-8 appearance-none rounded-[8px] border border-[var(--border)] bg-[var(--surface)] pl-3 pr-7 text-[12px] font-semibold outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)] disabled:opacity-55"
      >
        <option value="all">{label}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {labels?.[o] ?? o}
          </option>
        ))}
      </select>
    </label>
  )
}

/* ── left rail ───────────────────────────────────────────────────────────── */

function OverallMentions({
  counts,
  sources,
  places,
  languages,
  windowLabel,
  previous,
  daysCovered,
  days,
  daily,
}: {
  counts: { total: number; positive: number; negative: number; neutral: number; unread: number }
  sources: number
  places: number
  /** Distinct languages the window's stories were published in. */
  languages: number
  windowLabel: string
  /** Stories published in the window immediately before this one. */
  previous: number
  /** Distinct publication days with at least one story, in this window. */
  daysCovered: number
  days: number
  /** One count per day across the window, for the sparkline. */
  daily: number[]
}) {
  const tiles: { tone: Tone; n: number }[] = [
    { tone: 'positive', n: counts.positive },
    { tone: 'negative', n: counts.negative },
    { tone: 'neutral', n: counts.neutral },
  ]
  /**
   * The reference's "↑ 18.6% vs previous 7 days" line — printed only when
   * BOTH windows hold at least three published stories, per deltaOf. Below
   * that floor a percent is a story or two wearing arithmetic ("↑ 4733.3%"
   * happened, and guarding one side only still let "↑ 2266.7%" through), so
   * the slot stays absent rather than dressing a tiny base up as a trend.
   */
  const change = deltaOf(counts.total, previous)
  const still = useReducedMotion()
  return (
    <Card padded={false} className="p-[var(--ln-pad)]">
      <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">
        Overall Mentions <span className="font-medium text-ink-3">({windowLabel})</span>
      </h2>

      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <CountUp value={counts.total} className="tnum block text-[30px] font-extrabold leading-none" />
          <p className="mt-1 text-[12px] font-semibold text-ink-2">Total Mentions</p>
        </div>
        {daily.length > 1 && (
          (() => {
            const peak = Math.max(1, ...daily)
            const pts = daily.map(
              (n, i) => [(i / (daily.length - 1)) * 86 + 2, 36 - (n / peak) * 30] as const,
            )
            // The reference's sparkline: an indigo line with a round marker on
            // every point over a soft gradient fill, drawing itself in.
            const line = pts.reduce(
              (acc, [x, y], i) => (i === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`),
              '',
            )
            const area = `${line} L ${pts[pts.length - 1]?.[0] ?? 88} 39 L 2 39 Z`
            return (
              <svg
                viewBox="0 0 90 40"
                preserveAspectRatio="none"
                className="mt-1 w-[90px] shrink-0"
                style={{ height: 'var(--ln-spark)' }}
                fill="none"
                role="img"
                aria-label={`Daily story count over the last ${days} days`}
              >
                <defs>
                  <linearGradient id="ln-spark-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <m.path
                  d={area}
                  fill="url(#ln-spark-fill)"
                  initial={still ? undefined : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.5 }}
                />
                <m.path
                  d={line}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  initial={still ? undefined : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
                {pts.map(([x, y], i) => (
                  <m.circle
                    key={i}
                    cx={x}
                    cy={y}
                    r="2"
                    fill="var(--accent)"
                    initial={still ? undefined : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.15 + (i / pts.length) * 0.65 }}
                  />
                ))}
              </svg>
            )
          })()
        )}
      </div>
      {change !== null && (
        <p
          className="tnum mt-0.5 whitespace-nowrap text-[10.5px] font-semibold"
          style={{ color: change >= 0 ? 'var(--pos)' : 'var(--neg)' }}
          title="Against the window immediately before this one."
        >
          {change >= 0 ? '↑' : '↓'} {Math.abs(change)}% vs previous {days} days
        </p>
      )}
      {counts.unread > 0 && (
        <p className="mt-1 text-[10.5px] leading-relaxed text-ink-3">
          {counts.unread} of these could not be called either way
        </p>
      )}

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {tiles.map(({ tone, n }) => (
          <div
            key={tone}
            className="rounded-[10px] p-1.5"
            style={{ background: TONE_VAR[tone].soft }}
          >
            <span className="block leading-none" style={{ color: TONE_VAR[tone].fg }}>
              <CountUp value={n} className="tnum text-[16px] font-extrabold leading-none" />
            </span>
            <p className="mt-1 text-[10px] font-semibold" style={{ color: TONE_VAR[tone].fg }}>
              {TONE_LABEL[tone]}
            </p>
            <p className="tnum text-[9.5px] leading-snug text-ink-3">{pct(n, counts.total)}%</p>
            <span className="mt-0.5 block h-[4px] overflow-hidden rounded-full bg-[var(--surface)]">
              <span
                className="ln-bar block h-full rounded-full"
                style={{ width: `${pct(n, counts.total)}%`, background: TONE_MARK[tone] }}
              />
            </span>
          </div>
        ))}
      </div>

      <ul className="mt-2 divide-y divide-[var(--rule)] border-t border-[var(--rule)]">
        {/* The slot the reference spends on "Potential Reach" carries a
            counted fact instead: no paper publishes its readership to this
            desk and we do not model one, so the row is the number of days in
            the window on which a stored story was actually published. */}
        <StatRow
          icon={<Calendar size={12} />}
          label="Days with Coverage"
          value={`${daysCovered} of ${days}`}
          title="Days in this window on which at least one stored story was published. Reach is not shown because no outlet publishes its readership to this desk."
        />
        {/* The reference's second row repeats its own headline number; a card
            that states one fact twice is a row spent saying nothing, so this
            slot carries a figure the headline does not already hold. */}
        <StatRow
          icon={<Languages size={12} />}
          label="Languages"
          value={String(languages)}
          title="Distinct languages the stories in this window were published in."
        />
        <StatRow icon={<Radio size={12} />} label="Sources" value={String(sources)} />
        <StatRow icon={<MapPin size={12} />} label="Locations Covered" value={String(places)} />
      </ul>
    </Card>
  )
}

function StatRow({
  icon,
  label,
  value,
  title,
}: {
  icon: React.ReactNode
  label: string
  value: string
  /** What this row's figure measures, said on hover. */
  title?: string
}) {
  return (
    <li className="flex items-center gap-2.5 py-1" title={title}>
      {/* The reference draws these chips as small grey rounded squares with a
          dark glyph, not accent-tinted ones. */}
      <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-[var(--surface-3)] text-ink-2">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink-2">{label}</span>
      {/* ONE COLUMN, fixed, right-aligned: the reference rules these values
          down a single axis, and they only held that axis here while every
          row happened to be the same width. */}
      <span className="tnum w-[62px] shrink-0 text-right text-[12px] font-bold text-ink">
        {value}
      </span>
    </li>
  )
}

function ByLocation({ places, total }: { places: { name: string; total: number }[]; total: number }) {
  /** The reference's "View all locations →": the full legend, in place. */
  const [expanded, setExpanded] = useState(false)
  const top = places.slice(0, 5)
  const tail = places.slice(5)
  const others = tail.reduce((n, p) => n + p.total, 0)
  /* "Others" is for a tail, not for one place the desk can name — and the
     filter bar above offers that place by name two inches away. One left over
     takes the sixth seat under its own name; two or more become the tail. */
  const rows = expanded
    ? places
    : tail.length > 1
      ? [...top, { name: 'Others', total: others }]
      : places.slice(0, 6)
  const placed = places.reduce((n, r) => n + r.total, 0)

  return (
    <Card
      padded={false} className="p-[var(--ln-pad)]"
      title={
        total > placed
          ? `${total - placed} of ${total} stories name no place, so they are not on this wheel.`
          : undefined
      }
    >
      <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">Mentions by Location</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">
          None of the stories read so far names a place.
        </p>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-4">
            <Donut
              slices={rows.map((r, i) => ({ value: r.total, color: wheelAt(i) }))}
              total={placed}
              cssSize="var(--ln-donut-s)"
              thick
            />
            <ul className="min-w-0 flex-1 space-y-0.5">
              {rows.map((r, i) => (
                <li key={r.name} className="flex items-center gap-2 text-[11px] leading-[1.35]">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: wheelAt(i) }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-ink-2">{r.name}</span>
                  <span className="tnum shrink-0 font-semibold">{pct(r.total, placed)}%</span>
                </li>
              ))}
            </ul>
          </div>
          {places.length > 6 && (
            <ViewAllLink
              className="mt-1.5"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Show fewer' : 'View all locations'}
            </ViewAllLink>
          )}
        </>
      )}
    </Card>
  )
}

/**
 * The reference wheel's own order: blue, teal, green, red, orange, then grey
 * for Others. Also the pool masthead marks draw from, so a source keeps a
 * colour between visits.
 */
const WHEEL = ['#4e6ef2', '#14b8a6', '#22c55e', '#ef4444', '#f59e0b', '#94a3b8']

/** A stable mark colour per masthead, so a source keeps its colour between visits. */
function hueOf(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return WHEEL[h % WHEEL.length] ?? '#4f46e5'
}
const wheelAt = (i: number): string => WHEEL[i % WHEEL.length] ?? '#94a3b8'

function Donut({
  slices,
  total,
  cssSize,
  thick,
  rounded,
}: {
  slices: { value: number; color: string }[]
  total: number
  /** A CSS length, so the fit tiers can size the wheel without a re-render. */
  cssSize: string
  thick?: boolean
  /** The reference's sentiment wheel joins its segments with round caps. */
  rounded?: boolean
}) {
  const still = useReducedMotion()
  const r = 15.9155
  const circ = 2 * Math.PI * r
  const width = thick ? 8.5 : 7
  const drawn = slices.filter((s) => s.value > 0)
  let offset = 0
  return (
    <svg
      viewBox="0 0 42 42"
      className="shrink-0"
      style={{ width: cssSize, height: cssSize }}
      aria-hidden
    >
      <circle cx="21" cy="21" r={r} fill="none" stroke="var(--surface-3)" strokeWidth={width} />
      {drawn.map((s, i) => {
        const len = total === 0 ? 0 : (s.value / total) * circ
        const start = offset
        // Round caps overrun the arc by half a stroke width on each end, so
        // each segment is shortened by that much to keep its neighbour's
        // colour visible — a joint treatment, not a change to any share.
        const trim = rounded && drawn.length > 1 ? Math.min(width * 0.42, len * 0.3) : 0
        const el = (
          <m.circle
            key={i}
            cx="21"
            cy="21"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={width}
            strokeLinecap={rounded ? 'round' : 'butt'}
            transform="rotate(-90 21 21)"
            strokeDashoffset={-(start + trim / 2)}
            initial={still ? undefined : { strokeDasharray: `0 ${circ}` }}
            animate={{ strokeDasharray: `${Math.max(0.001, len - trim)} ${circ}` }}
            transition={{ duration: 0.7, delay: 0.1 + (start / circ) * 0.5, ease: 'easeOut' }}
          />
        )
        offset += len
        return el
      })}
    </svg>
  )
}

function OverTime({ mentions, days }: { mentions: PersonaMention[]; days: number }) {
  const still = useReducedMotion()
  const series = useMemo(() => {
    /**
     * One column per day on a short window, per week on a month or a quarter,
     * per month on the half-year. A hundred and eighty daily columns in a
     * 250-pixel chart is a barcode; the bucket width grows with the window so
     * every column stays wide enough to read, and the whole window is covered
     * rather than the truncated fortnight this chart used to silently show.
     */
    const bucketDays = days <= 14 ? 1 : days <= 90 ? 7 : 30
    const slots = Math.ceil(days / bucketDays)
    const out: { label: string; positive: number; negative: number; neutral: number }[] = []
    for (let i = slots - 1; i >= 0; i--) {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      start.setDate(start.getDate() - (i + 1) * bucketDays + 1)
      const end = start.getTime() + bucketDays * 86_400_000
      const bucket = mentions.filter((x) => {
        const t = stampOf(x)
        return t !== null && t >= start.getTime() && t < end
      })
      let positive = 0
      let negative = 0
      let neutral = 0
      for (const x of bucket) {
        const t = toneOf(x)
        if (t === 'positive') positive++
        else if (t === 'negative') negative++
        else if (t === 'neutral') neutral++
      }
      out.push({
        label: start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        positive,
        negative,
        neutral,
      })
    }

    /*
     * THE COUNT FOR EACH DAY ON ITS OWN, as the reference plots it.
     *
     * This chart spent a spell as running totals, because a desk reading
     * eleven stories a week draws a 0-1-0-2 lattice as three crossing lines.
     * The owner asked for the reference exactly, and the reference is
     * per-day: the clamped curve and the dot on every real point are what
     * keep small counts readable, not a different series. Every marker sits
     * at the exact count for its own day or bucket, nothing accumulated.
     */
    return out
  }, [mentions, days])

  const peak = Math.max(1, ...series.map((d) => Math.max(d.positive, d.negative, d.neutral)))
  /** Integer gridlines when the counts are small; thirds would lie. */
  const ticks =
    peak <= 4
      ? Array.from({ length: peak + 1 }, (_, i) => peak - i)
      : [peak, Math.round(peak / 2), 0]
  /** One label per day on a week; thinned to ~5 on longer windows. */
  const labelEvery = Math.max(1, Math.ceil(series.length / 7))

  return (
    <Card
      padded={false} className="p-[var(--ln-pad)]"
      title="Each point is the number of stories read that way on that day alone. Longer windows bucket days together so every point stays readable."
    >
      <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">Mentions by Sentiment Over Time</h2>
      <div className="mt-1.5 flex flex-wrap gap-3">
        {(['positive', 'negative', 'neutral'] as Tone[]).map((t) => (
          <span key={t} className="flex items-center gap-1.5 text-[10px] font-medium text-ink-2">
            <span
              className="h-[2px] w-3 rounded-full"
              style={{ background: TONE_MARK[t] }}
              aria-hidden
            />
            <span
              className="-ml-[9px] size-[5px] rounded-full"
              style={{ background: TONE_MARK[t] }}
              aria-hidden
            />
            <span className="pl-0.5">{TONE_LABEL[t]}</span>
          </span>
        ))}
      </div>

      {/*
       * THREE LINES, AS THE REFERENCE DRAWS THEM.
       *
       * This used to be stacked bars, on the reasoning that a daily count of
       * 0, 1 or 2 draws a zigzag as a line and that reads as violent swings
       * in coverage rather than as rounding. That is still true of a single
       * day's bucket - but the office asked for the reference's own form, not
       * a paraphrase of it, and the fix for a jagged small-number line is a
       * SMOOTHER CURVE and real point markers, not a different chart type.
       * Nothing here is smoothed in VALUE, only in how the segments between
       * real points are drawn: every marker still sits at the exact count
       * `series` computed, the same bucketed-by-window counts as before.
       */}
      <svg
        viewBox="0 0 280 84"
        preserveAspectRatio="none"
        className="mt-2 w-full"
        style={{ height: 'var(--ln-chart)' }}
        fill="none"
        role="img"
        aria-label="Mentions by sentiment over time"
      >
        {ticks.map((v, i) => (
          <line
            key={i}
            x1="26"
            x2="278"
            y1={10 + (i / (ticks.length - 1)) * 64}
            y2={10 + (i / (ticks.length - 1)) * 64}
            stroke="var(--rule)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {ticks.map((v, i) => (
          <text
            key={i}
            x="22"
            y={13 + (i / (ticks.length - 1)) * 64}
            textAnchor="end"
            className="tnum"
            fontSize="8"
            fill="var(--text-3)"
          >
            {v}
          </text>
        ))}
        {(['neutral', 'negative', 'positive'] as Tone[]).map((tone) => {
          const slot = series.length > 1 ? 252 / (series.length - 1) : 0
          const pts = series.map(
            (d, i) => [26 + slot * i, 74 - (d[tone] / peak) * 64] as const,
          )
          /*
           * STRAIGHT SEGMENTS, because a daily count is an integer.
           *
           * This joined the points with a clamped cubic curve, on the
           * reasoning that a 0-1-0-2 run of days reads as a saw blade. It
           * does — but every pixel of that curve between two real points is
           * ink standing where no day's count ever stood, and three of them
           * crossing turned the card into a sine-wave lattice that reads as
           * decoration. The markers still carry the counts; the line now only
           * joins them.
           */
          const path = pts.reduce(
            (acc, [x, y], i) => (i === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`),
            '',
          )
          return (
            <g key={tone}>
              <m.path
                d={path}
                fill="none"
                stroke={TONE_MARK[tone]}
                strokeWidth="1.8"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                initial={still ? undefined : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
              />
              {pts.map(([x, y], i) => (
                <m.circle
                  key={i}
                  cx={x}
                  cy={y}
                  r="2.2"
                  fill={TONE_MARK[tone]}
                  initial={still ? undefined : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.1 + (i / pts.length) * 0.75 }}
                />
              ))}
            </g>
          )
        })}
      </svg>
      {/* One label per point, each centred under its own day the way the
          reference rules the axis; longer windows thin to every nth. */}
      <div className="relative mt-1 h-[12px] text-[8.5px] font-medium text-ink-3">
        {series.map((d, i) =>
          i % labelEvery === 0 || i === series.length - 1 ? (
            <span
              key={i}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
              style={{
                left: `calc(${(26 / 280) * 100}% + ${
                  series.length > 1 ? (i / (series.length - 1)) * ((252 / 280) * 100) : 0
                }%)`,
              }}
            >
              {d.label}
            </span>
          ) : null,
        )}
      </div>
    </Card>
  )
}

/* ── main area ───────────────────────────────────────────────────────────── */

function SentimentOverviewCard({
  counts,
  prev,
}: {
  counts: { total: number; positive: number; negative: number; neutral: number }
  prev: { total: number; positive: number; negative: number; neutral: number }
}) {
  const cols: { tone: Tone; n: number }[] = [
    { tone: 'positive', n: counts.positive },
    { tone: 'negative', n: counts.negative },
    { tone: 'neutral', n: counts.neutral },
  ]
  const called = counts.positive + counts.negative + counts.neutral
  const prevCalled = prev.positive + prev.negative + prev.neutral
  /**
   * Movement per side, in percentage POINTS of share, as the reference draws
   * it. Only reportable when the previous window read anything at all: a
   * delta against an empty window is not a change, it is the first reading.
   */
  const moveOf = (tone: Tone): number | null => {
    // Ten called stories on EACH side is the floor. Below that a share is a
    // couple of articles wearing a percent sign, and the movement between two
    // such windows printed "↓ 33.1 pts" off five stories against three.
    if (called < 10 || prevCalled < 10) return null
    const nowShare = (counts[tone] / called) * 100
    const prevShare = (prev[tone] / prevCalled) * 100
    return Math.round((nowShare - prevShare) * 10) / 10
  }
  return (
    <Card padded={false} className="p-[var(--ln-pad)]">
      <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">Sentiment Overview</h2>
      <div className="mt-2 flex flex-wrap items-center gap-5">
        <div className="relative shrink-0">
          <Donut
            slices={cols.map((c) => ({ value: c.n, color: TONE_MARK[c.tone] }))}
            total={called}
            cssSize="var(--ln-donut)"
            thick
            rounded
          />
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="text-center">
              <CountUp value={counts.total} className="tnum block text-[19px] font-extrabold leading-none" />
              <span className="block text-[9.5px] font-medium text-ink-3">Total</span>
            </span>
          </span>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-3 divide-x divide-[var(--rule)]">
          {cols.map(({ tone, n }) => (
            <div key={tone} className="min-w-0 px-2 text-center first:pl-0 last:pr-0">
              {/* The big share is set in ink, as the reference sets it \u2014 the
                  tone's own colour lives in the delta and the wheel. */}
              <p className="tnum text-[19px] font-extrabold leading-none">{pct(n, called)}%</p>
              <p className="mt-1 text-[11px] font-semibold text-ink-2">{TONE_LABEL[tone]}</p>
              {(() => {
                const move = moveOf(tone)
                if (move === null)
                  // With no reportable movement the third line stays a count,
                  // which is a fact this desk holds either way.
                  return (
                    <p className="tnum mt-0.5 text-[10px] text-ink-3">
                      {n} {n === 1 ? 'story' : 'stories'}
                    </p>
                  )
                const up = move >= 0
                return (
                  <p
                    className="tnum mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-semibold"
                    style={{ color: up ? 'var(--pos)' : 'var(--neg)' }}
                    title="Change in this side's share of the called stories, in percentage points, against the window immediately before this one."
                  >
                    {up ? '\u2191' : '\u2193'} {Math.abs(move)} pts
                  </p>
                )
              })()}
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

type EntityKind = 'person' | 'place' | 'party'

/**
 * The parties this desk's press could plausibly print, matched as words in
 * the text the desk actually holds. The full names fold into their initials
 * so "Bharat Rashtra Samithi" and "BRS" are one entity, not two.
 */
const PARTY_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'BJP', re: /\b(?:BJP|Bharatiya\s+Janata)\b/i },
  { name: 'Congress', re: /\bCongress\b/i },
  { name: 'BRS', re: /\b(?:BRS|Bharat\s+Rashtra\s+Samithi)\b/i },
  { name: 'TRS', re: /\b(?:TRS|Telangana\s+Rashtra\s+Samithi)\b/i },
]

/** What each tile's count actually measures, said on hover. */
const KIND_TITLE: Record<EntityKind, string> = {
  person: 'Stories this desk searched for and filed under this name.',
  place: 'Stories whose own place field names this place.',
  party: 'Stories whose headline or excerpt prints this party’s name.',
}

interface EntityRow {
  id: string
  name: string
  kind: EntityKind
  /**
   * A picture the desk already stores for this entity — the subject's own
   * identity photograph, a tracked account's face, or the demo desk's party
   * mark — with the alt text it must carry. Null when nothing is stored:
   * nothing is fetched or guessed for a tile, a name without a stored face
   * keeps its glyph.
   */
  art: PartyMark | null
  total: number
  positive: number
  negative: number
  neutral: number
  /** The same entity's count in the window before this one. */
  previous: number
}

/** The tile icons' colours, cycling the way the reference's row does. */
const TILE_ICON = ['var(--accent)', '#f59e0b', '#22c55e', '#3b82f6', '#7c3aed']

function TopEntities({ entities }: { entities: EntityRow[] }) {
  return (
    <Card padded={false} className="p-[var(--ln-pad)]">
      <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">Top Entities Mentioned</h2>
      {entities.length === 0 ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">
          No person, place, or party is named by the stories published in this window.
        </p>
      ) : (
        /* The reference's chip: badge at the left, name over count at the
           right, and NOTHING else — its deltas and tone dots live only in the
           key-entities band at the foot of the page, and carrying them here
           made the chip half again taller than the sheet's. `flex-auto`
           rather than equal tracks for the same reason the reference's own
           chips differ in width: the widest real name ("Secunderabad") only
           fits because a chip may take the width its words need. */
        /* Two columns on a phone: five tiles squeezed onto one line left
           every name a stump ("Sh…", "Ja…") and every count "3 …". */
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:flex">
          {entities.slice(0, 5).map((e, i) => {
            /* The badge holds the party's own stored mark when the desk has
               one; otherwise the kind's glyph — a person the id card, a
               place the pin, a party the flag. A person's photograph is NOT
               shown here on purpose: the reference keeps faces for the band
               below and gives this row the violet id-card glyph. */
            const Glyph = e.kind === 'person' ? IdCard : e.kind === 'place' ? MapPin : Flag
            return (
              <span
                key={e.id}
                title={KIND_TITLE[e.kind]}
                className={cn(
                  'ln-lift flex min-w-0 flex-auto items-center gap-1.5 rounded-[12px] py-2 pl-1.5 pr-1',
                  `ln-tint-${i % 5}`,
                )}
              >
                <span
                  className="grid size-[30px] shrink-0 place-items-center rounded-[10px] bg-[var(--surface)] shadow-[var(--e1)]"
                  style={{ color: TILE_ICON[i % 5] }}
                >
                  {e.kind === 'party' && e.art ? (
                    <img
                      src={e.art.url}
                      alt={e.art.alt}
                      width={18}
                      height={18}
                      loading="lazy"
                      decoding="async"
                      className="size-[18px] object-contain"
                    />
                  ) : (
                    <Glyph size={16} aria-hidden />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-bold leading-[1.3] tracking-[-0.02em]">
                    {e.name}
                  </span>
                  <span className="tnum block truncate text-[9.5px] leading-[1.35] text-ink-3">
                    {e.total} {e.total === 1 ? 'mention' : 'mentions'}
                  </span>
                </span>
              </span>
            )
          })}
        </div>
      )}
    </Card>
  )
}

/**
 * One story's reading, on its own page.
 *
 * Everything here was already carried on the mention and shown nowhere: the
 * model's summary, the lines it suggests saying back, and its judgement on
 * whether the claim is worth checking before anyone repeats it.
 */
function ReadingPage({ mention, onBack }: { mention: PersonaMention; onBack: () => void }) {
  const t = toneOf(mention)
  const points = mention.recommendation?.talkingPoints ?? []
  return (
    <div className="mx-auto w-full max-w-[760px] space-y-4">
      <button
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden />
        All mentions
      </button>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {t && (
            <span
              className="inline-flex rounded-[6px] px-2 py-1 text-[10.5px] font-bold"
              style={{ background: TONE_VAR[t].soft, color: TONE_VAR[t].fg }}
            >
              {TONE_LABEL[t]}
            </span>
          )}
          {mention.place && (
            <span className="rounded-[6px] bg-[var(--accent-soft)] px-2 py-1 text-[10.5px] font-semibold text-[var(--accent)]">
              {mention.place}
            </span>
          )}
          {mention.fake && mention.fake.suspicion !== 'No' && (
            <span className="inline-flex items-center gap-1 rounded-[6px] bg-[var(--warn-soft)] px-2 py-1 text-[10.5px] font-bold text-[var(--warn)]">
              <ShieldAlert size={11} aria-hidden />
              Worth checking
            </span>
          )}
        </div>

        <h2 className="mt-2.5 text-lg font-semibold leading-snug">{mention.headline}</h2>
        <p className="mt-1 text-xs text-ink-3">
          {(mention.publisher ?? 'Publisher not recorded')} · {whenOf(mention)}
        </p>

        {mention.summary?.trim() && (
          <p className="mt-3 rounded-2xl bg-[var(--surface-2)] px-4 py-3 text-sm leading-relaxed text-ink-2">
            {mention.summary.trim()}
          </p>
        )}

        {mention.excerpt?.trim() && (
          <p className="mt-3 border-l-2 border-[var(--rule)] pl-3 text-[13px] leading-relaxed text-ink-3">
            &ldquo;{mention.excerpt.trim()}&rdquo;
          </p>
        )}

        {points.length > 0 && (
          <div className="mt-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.05em] text-ink-3">
              What to say back
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {points.map((line) => (
                <li key={line} className="text-[13px] leading-relaxed text-ink-2">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}

        {mention.fake?.note?.trim() && (
          <div className="mt-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.05em] text-ink-3">
              On whether it is true
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
              {mention.fake.note.trim()}
            </p>
          </div>
        )}

        {mention.url && (
          <a
            href={mention.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--accent)]"
          >
            Read the story on {mention.publisher ?? 'the publisher'}
            <ExternalLink size={13} aria-hidden />
          </a>
        )}
      </Card>
    </div>
  )
}

function RecentMentions({
  mentions,
  tone,
  onTone,
  counts,
  onOpenReading,
  windowLabel,
  showAll,
  onShowAll,
  shelfTotal,
}: {
  mentions: PersonaMention[]
  tone: Tone | 'all'
  onTone: (t: Tone | 'all') => void
  counts: { total: number; positive: number; negative: number; neutral: number }
  onOpenReading?: (m: PersonaMention) => void
  /** The window every other card on the page is counting. */
  windowLabel: string
  /** Is the list showing the whole shelf rather than that window? */
  showAll: boolean
  onShowAll: (v: boolean) => void
  /** How many stories the desk holds in total, under the same filter bar. */
  shelfTotal: number
}) {
  const TABS: { id: Tone | 'all'; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: counts.total },
    { id: 'positive', label: 'Positive', n: counts.positive },
    { id: 'negative', label: 'Negative', n: counts.negative },
    { id: 'neutral', label: 'Neutral', n: counts.neutral },
  ]

  /**
   * FIVE ROWS AND A NUMBERED PAGER. The office asked for pages, not a
   * fold-out: the list walks EVERY story the desk holds, newest first, five
   * to a page so the card never grows past the one-screen fit. The page
   * snaps back to 1 whenever the list itself changes — a page number into a
   * list that no longer exists points at nothing.
   */
  const PER_PAGE = 5
  const [page, setPage] = useState(1)
  /* The persona chip earned its place on the reference, where the desk
     watches several names. It says nothing on a list every row of which is
     about the same person, so it appears only when the list holds more. */
  const showPersona = new Set(mentions.map((x) => x.persona)).size > 1
  useEffect(() => {
    setPage(1)
  }, [mentions])
  const pages = Math.max(1, Math.ceil(mentions.length / PER_PAGE))
  const current = Math.min(page, pages)
  const shownRows = mentions.slice((current - 1) * PER_PAGE, current * PER_PAGE)
  return (
    <Card padded={false} className="p-[var(--ln-pad)]">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">Recent Mentions</h2>
          <p className="mt-0.5 text-[10.5px] text-ink-3">
            {showAll ? 'Every story the desk holds, newest first' : `${windowLabel}, newest first`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* The reference's segmented control: one grey rounded-full
              container, the active option a solid accent pill with white
              text, no counts in the labels — the counts ride the hover
              title instead. */}
          <div className="flex items-center rounded-full bg-[var(--surface-3)] p-[3px]">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onTone(t.id)}
                aria-pressed={tone === t.id}
                title={`${t.n} ${t.n === 1 ? 'story' : 'stories'}`}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[10.5px] font-semibold transition-colors',
                  tone === t.id
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-ink-3 hover:text-ink-2',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mentions.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          {tone === 'all'
            ? 'No stored story matches these filters.'
            : `No stored story matching these filters was read as ${TONE_LABEL[tone].toLowerCase()}.`}
        </p>
      ) : (
        <>
          <ul className="mt-1 divide-y divide-[var(--rule)]">
            {shownRows.map((x) => (
              <MentionRow
                key={x.id}
                mention={x}
                onOpenReading={onOpenReading}
                showPersona={showPersona}
              />
            ))}
          </ul>

          {(pages > 1 || showAll || shelfTotal > counts.total) && (
            <nav
              className="flex items-center justify-between gap-2 border-t border-[var(--rule)] pt-1.5"
              aria-label="Mention pages"
            >
              <div className="flex min-w-0 items-center gap-2">
                <p className="tnum shrink-0 text-[10px] text-ink-3">
                  {mentions.length} {mentions.length === 1 ? 'story' : 'stories'}
                </p>
                {/* The reference's own footer link. Widening the list is the
                    reader's act, and everything that names the list — this
                    subtitle, these counts, the export's filename — follows it. */}
                {(showAll || shelfTotal > counts.total) && (
                  <ViewAllLink onClick={() => onShowAll(!showAll)}>
                    {showAll ? 'Show this window only' : `View all ${shelfTotal} mentions`}
                  </ViewAllLink>
                )}
              </div>
              <div className={cn('flex items-center gap-1', pages > 1 ? '' : 'hidden')}>
                {pageItems(current, pages).map((it, i) =>
                  it === '…' ? (
                    <span key={`gap${i}`} className="px-0.5 text-[10px] text-ink-3" aria-hidden>
                      …
                    </span>
                  ) : (
                    <button
                      key={it}
                      type="button"
                      onClick={() => setPage(it)}
                      aria-current={it === current ? 'page' : undefined}
                      className={cn(
                        'tnum grid h-6 min-w-6 place-items-center rounded-[6px] px-1 text-[10.5px] font-semibold transition-colors',
                        it === current
                          ? 'bg-[var(--accent)] text-white'
                          : 'text-ink-2 hover:bg-[var(--surface-3)]',
                      )}
                    >
                      {it}
                    </button>
                  ),
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </Card>
  )
}

/**
 * The pager's row of numbers: every page when they fit, otherwise the ends
 * and the current page's neighbours with an ellipsis over each gap.
 */
function pageItems(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const keep = new Set(
    [1, 2, current - 1, current, current + 1, total - 1, total].filter((n) => n >= 1 && n <= total),
  )
  const sorted = [...keep].sort((a, b) => a - b)
  const out: (number | '…')[] = []
  let prev = 0
  for (const n of sorted) {
    if (n - prev > 1) out.push('…')
    out.push(n)
    prev = n
  }
  return out
}

function MentionRow({
  mention,
  onOpenReading,
  showPersona,
}: {
  mention: PersonaMention
  onOpenReading?: (m: PersonaMention) => void
  /** Whether the name this story is filed under distinguishes it from its neighbours. */
  showPersona?: boolean
}) {
  const t = toneOf(mention)
  /**
   * The reading, behind a button on the row that carries it.
   *
   * Every mention arrives with the model's own summary, its recommendation and
   * its judgement on whether the claim smells false — and the row printed the
   * headline, the masthead and the date, so the desk saw a link and concluded
   * there was no analysis. It was there the whole time with nothing to open it.
   */
  const hasReading =
    Boolean(mention.summary?.trim()) ||
    Boolean(mention.recommendation) ||
    (mention.fake != null && mention.fake.suspicion !== 'No')
  /**
   * The reference's three chips: entity, place, subject.
   *
   * The entity chip only earns its slot on a list holding more than one name.
   * The subject is the taxonomy's own, where the reading recorded one. The
   * language chip is gone: the desk's two shelves store it two ways ("en" on
   * one, "Telugu" on the other) and printing both made one field look like
   * two — the count of languages in the window now stands in the left rail,
   * where the two forms are folded together before they are counted.
   */
  const tags = [
    showPersona ? mention.persona : null,
    mention.place,
    mention.topic ? String(mention.topic) : null,
  ].filter(Boolean) as string[]
  const flagged = mention.fake != null && mention.fake.suspicion !== 'No'
  const source = (mention.publisher ?? '').trim()
  return (
    <li className="flex gap-2.5 py-[var(--ln-mrow)]">
      {/* Image slot first, then the pill, then the story: the reference's own
          row order, at its 118x82 proportion. A feed gives us no photograph,
          so the masthead's mark fills the slot rather than a grey rectangle
          pretending a picture failed to load. */}
      {/* The masthead's monogram, in the same stable colour Top News Sources
          gives it, at the reference photograph's 118x82 proportion. The name
          used to be printed here as well, at 8px and truncated mid-word
          ("ANDHRA JYOT…"), beside the same name set in full two centimetres
          to the right; and a generic newspaper glyph repeated down five rows
          said nothing at all, on a tint so faint it read as a photograph that
          had failed to load. No logo is on file for any of these papers and
          none is invented here. */}
      <span
        className="hidden shrink-0 items-center justify-center rounded-[8px] text-[24px] font-extrabold leading-none sm:flex"
        style={{
          height: 'var(--ln-thumb)',
          width: 'calc(var(--ln-thumb) * 1.44)',
          background: `${hueOf(source || '?')}1f`,
          color: hueOf(source || '?'),
        }}
        aria-hidden
      >
        {(source || '?').trim().charAt(0).toUpperCase()}
      </span>

      {/* The tone pill hugs the photo slot, top-aligned, as the reference
          tucks it. */}
      {/* `items-start`, or the pill — an inline-flex child of a stretch
          container — grows to the whole row's height and lands as a 72px
          colour slab with a 9.5px word pinned at its top. */}
      <span className="flex shrink-0 items-start justify-start pt-0.5">
        {t ? (
          <span
            className="inline-flex rounded-[6px] px-1.5 py-0.5 text-[9.5px] font-bold"
            style={{ background: TONE_VAR[t].soft, color: TONE_VAR[t].fg }}
          >
            {TONE_LABEL[t]}
          </span>
        ) : (
          <span className="inline-flex rounded-[6px] bg-[var(--surface-3)] px-1.5 py-0.5 text-[9.5px] font-bold text-ink-3">
            Not called
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        {/* The mark sits INSIDE the clamped text, so it trails the last word
            on a one-line headline and on a two-line one alike. Held outside as
            a flex sibling it hugged short headlines and floated 300px away
            from wrapped ones, two rows apart in the same list. */}
        <a
          href={mention.url}
          target="_blank"
          rel="noreferrer noopener"
          className="group block"
        >
          <span className="line-clamp-2 text-[13px] font-bold leading-[1.35] group-hover:underline">
            {mention.headline}
            <ExternalLink
              size={12}
              className="relative top-[2px] ml-1 inline-block text-ink-3"
              aria-hidden
            />
          </span>
        </a>
        <p className="mt-0.5 truncate text-[10.5px] text-ink-3">
          {source || 'Publisher not recorded'} · {whenOf(mention)}
        </p>
        {(tags.length > 0 || flagged || (hasReading && onOpenReading)) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-[5px] bg-[var(--accent-soft)] px-1.5 py-0.5 text-[9.5px] font-semibold text-[var(--accent)]"
              >
                {tag}
              </span>
            ))}
            {/* The claim flag used to live in a right-hand "Potential Reach"
                column; the reach slot is gone — no paper publishes its
                readership to this desk and nothing here is estimated — so
                the flag rides with the story's other tags. */}
            {flagged && (
              <span className="inline-flex items-center gap-1 rounded-[5px] bg-[var(--warn-soft)] px-1.5 py-0.5 text-[9.5px] font-bold text-[var(--warn)]">
                <ShieldAlert size={9} aria-hidden />
                Check this claim
              </span>
            )}
            {hasReading && onOpenReading && (
              <button
                type="button"
                onClick={() => onOpenReading(mention)}
                className="inline-flex items-center gap-1 rounded-[5px] bg-[var(--accent-soft)] px-1.5 py-0.5 text-[9.5px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
              >
                <Sparkles size={9} aria-hidden />
                AI analysis
              </button>
            )}
          </div>
        )}

      </div>

      <span className="hidden shrink-0 pt-0.5 text-ink-3 sm:block" aria-hidden>
        <Bookmark size={14} />
      </span>
    </li>
  )
}

function TalkedAbout({
  lens,
  onLens,
  rows,
}: {
  lens: 'keywords' | 'topics'
  onLens: (l: 'keywords' | 'topics') => void
  rows: { term: string; count: number; positive: number }[]
}) {
  /** The reference's "View all keywords": the full list, in place. */
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? rows : rows.slice(0, 8)
  return (
    <Card padded={false} className="p-[var(--ln-pad)]">
      <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">What&rsquo;s Being Talked About?</h2>
      {/* The reference's tabs: the active lens is a white pill with an accent
          border and accent text; the idle one sits plain. */}
      <div className="mt-2 flex gap-1.5">
        {(['keywords', 'topics'] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onLens(l)}
            aria-pressed={lens === l}
            className={cn(
              'rounded-[8px] px-2.5 py-1 text-[10.5px] font-semibold transition-colors',
              lens === l
                ? 'border border-[var(--accent)] bg-[var(--surface)] text-[var(--accent)]'
                : 'border border-transparent text-ink-3 hover:text-ink-2',
            )}
          >
            By {l === 'keywords' ? 'Keywords' : 'Topics'}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-2">
          {lens === 'keywords'
            ? 'No word recurs across the stories read so far.'
            : 'No story in this window carries a classified subject yet. Stories filed by the grievance desk carry one; scanned stories do not.'}
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {shown.map((r) => (
            <li
              key={r.term}
              className="flex items-center gap-2"
              style={{ minHeight: 'var(--ln-krow)' }}
            >
              {/* A grey circle with a dark glyph, per the reference. The hash
                  stays: a per-keyword pictogram cannot be derived honestly. */}
              <span
                className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--surface-3)] text-ink-2"
                aria-hidden
              >
                <Hash size={10} />
              </span>
              <span className="w-[30%] min-w-0 truncate text-[11.5px] font-semibold capitalize">
                {r.term}
              </span>
              <span className="tnum w-[62px] shrink-0 text-[10px] text-ink-3">
                {r.count} {r.count === 1 ? 'mention' : 'mentions'}
              </span>
              {/* A NIL SHARE IS A MARK, NOT A BLANK TRACK. A row whose stories
                  were all read negative drew an empty grey rail, which reads as
                  a bar that failed to render rather than as the zero it is. */}
              <span className="flex h-[6px] min-w-0 flex-1 items-center overflow-hidden rounded-full bg-[var(--surface-3)]">
                {r.positive > 0 ? (
                  <span
                    className="ln-bar block h-full rounded-full"
                    style={{
                      width: `${r.positive}%`,
                      background: r.positive >= 50 ? 'var(--pos)' : 'var(--neg)',
                    }}
                  />
                ) : (
                  <span
                    className="ml-[1px] size-[4px] shrink-0 rounded-full"
                    style={{ background: 'var(--neg)' }}
                    aria-hidden
                  />
                )}
              </span>
              <span
                className="tnum w-9 shrink-0 text-right text-[10.5px] font-bold"
                style={{ color: r.positive >= 50 ? 'var(--pos)' : 'var(--neg)' }}
                title="Share of these stories read as positive, counted from this desk's readings."
              >
                {r.positive}%
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 8 && (
        <ViewAllLink className="mt-2" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show fewer' : `View all ${lens === 'keywords' ? 'keywords' : 'topics'}`}
        </ViewAllLink>
      )}
    </Card>
  )
}

function TopSources({
  sources,
}: {
  sources: { name: string; total: number; positive: number; negative: number; neutral: number }[]
}) {
  /**
   * The reference's "By Mentions" is a control, not a caption. Two orders
   * are real on this data: how often a masthead wrote, and how warmly its
   * stories read. Anything else would be sorting on a figure we do not hold.
   */
  const [order, setOrder] = useState<'mentions' | 'positive'>('mentions')
  const [expanded, setExpanded] = useState(false)
  const ranked = [...sources].sort((a, b) => {
    if (order === 'mentions') return b.total - a.total
    const ac = a.positive + a.negative + a.neutral
    const bc = b.positive + b.negative + b.neutral
    return (bc > 0 ? b.positive / bc : 0) - (ac > 0 ? a.positive / ac : 0)
  })
  // Five rows, the reference's own count; the rest live behind the link.
  const shown = expanded ? ranked : ranked.slice(0, 5)
  return (
    <Card padded={false} className="p-[var(--ln-pad)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">Top News Sources</h2>
        {/* A native <select> here rendered its font at the browser's 16px
            iOS-zoom floor no matter what size class it carried, which blew
            this control up to several times the reference's plain
            label-plus-chevron. Two options toggle on a click instead of
            opening a dropdown, which the reference's own control does not
            do either - it is a link, not a form field. */}
        <button
          type="button"
          onClick={() => setOrder((o) => (o === 'mentions' ? 'positive' : 'mentions'))}
          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-ink-2 hover:text-ink"
        >
          {order === 'mentions' ? 'By Mentions' : 'By Positive Share'}
          <ChevronDown size={12} aria-hidden />
        </button>
      </div>
      {sources.length === 0 ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">
          None of the stories read so far records a publisher.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-0.5">
          {shown.map((s) => {
            const called = s.positive + s.negative + s.neutral
            /* Neutral is drawn grey here, and only here, because that is how
               the reference inks this row; the word rides the hover title. */
            const seg = (tone: Tone): number => (called > 0 ? s[tone] / called : 0)
            const MARK: Record<Tone, string> = {
              positive: 'var(--pos)',
              negative: 'var(--neg)',
              neutral: 'var(--ln-neutral-mark)',
            }
            return (
              <li
                key={s.name}
                className="flex items-center gap-2"
                style={{ minHeight: 'var(--ln-srow)' }}
              >
                {/* No logo is on file for a masthead, so its mark is a
                    monogram in a stable colour, never a fabricated crest. */}
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-extrabold"
                  style={{ background: `${hueOf(s.name)}1f`, color: hueOf(s.name) }}
                  aria-hidden
                >
                  {s.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="w-[118px] min-w-0 shrink-0" title={s.name}>
                  <span className="block truncate text-[11px] font-semibold leading-tight">
                    {s.name}
                  </span>
                  <span className="tnum block text-[9.5px] leading-tight text-ink-3">
                    {s.total} {s.total === 1 ? 'mention' : 'mentions'}
                  </span>
                </span>
                {called > 0 ? (
                  /*
                   * THREE FIXED COLUMNS, and the bar between them.
                   *
                   * Every percent used to sit inline with its own segment, so
                   * a row with no positive story printed "0%" hard against the
                   * next "0%" and no numeral lined up with the numeral above
                   * it. The three figures now hold fixed cells the whole card
                   * down — the reference's own arrangement, green left of the
                   * track, red and grey right of it — and the track carries
                   * every share proportionally, so a nil share simply takes no
                   * width instead of pushing the numbers around.
                   */
                  <span
                    className="flex min-w-0 flex-1 items-center gap-1"
                    title={`${s.positive} positive, ${s.negative} negative, ${s.neutral} neutral`}
                  >
                    <SourcePct value={pct(s.positive, called)} color={MARK.positive} />
                    <span className="flex h-[5px] min-w-0 flex-1 items-center gap-[2px]">
                      {(['positive', 'negative', 'neutral'] as Tone[]).map((t) =>
                        s[t] > 0 ? (
                          <span
                            key={t}
                            className="ln-bar h-full rounded-full"
                            style={{ flexGrow: seg(t), flexBasis: 0, background: MARK[t] }}
                            aria-hidden
                          />
                        ) : null,
                      )}
                    </span>
                    <SourcePct value={pct(s.negative, called)} color={MARK.negative} />
                    <SourcePct value={pct(s.neutral, called)} color={MARK.neutral} />
                  </span>
                ) : (
                  <span className="shrink-0 text-[9.5px] text-ink-3">Not called</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {sources.length > 5 && (
        <ViewAllLink className="mt-2" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show fewer' : `View all ${sources.length} sources`}
        </ViewAllLink>
      )}
    </Card>
  )
}

/**
 * One masthead's share, in a cell of its own.
 *
 * Fixed width and right-aligned so the three columns hold their axis down the
 * whole card. A measured zero is still printed — it is a count this desk made,
 * not an absence — but in muted ink, because a nil share shouting in red or
 * green reads as an alarm where the row's real news is the segment beside it.
 */
function SourcePct({ value, color }: { value: number; color: string }) {
  return (
    <span
      className="tnum w-[24px] shrink-0 text-right text-[9px] font-bold"
      style={value > 0 ? { color } : undefined}
    >
      <span className={value > 0 ? undefined : 'text-ink-3'}>{value}%</span>
    </span>
  )
}

function KeyEntities({ entities, days }: { entities: EntityRow[]; days: number }) {
  /** "View all entities →": the whole roster unfolds in place. */
  const [expanded, setExpanded] = useState(false)
  return (
    <Card padded={false} className="p-[var(--ln-pad)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">Mentions About Key Entities</h2>
        {/* The link rides the heading row: a footer line of its own under
            the band is the difference between fitting the screen and not.
            A link to nothing is dishonest, so it appears only when more
            entities exist than the band can seat. */}
        {entities.length > 5 && (
          <ViewAllLink onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show fewer' : 'View all entities'}
          </ViewAllLink>
        )}
      </div>
      {entities.length === 0 ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">
          No person, place, or party is named by the stories published in this window.
        </p>
      ) : (
        <>
          {/* auto-FILL, not auto-fit, same fix as the tiles above: with one
              entity, auto-fit's "1fr" stretched a single column to the whole
              card width. The reference boxes each entity in its own bordered
              sub-card, so these are bordered again on its word. The max must
              stay 1fr: auto-fill counts its tracks by the MAX of the minmax,
              and a 16rem cap seated only four cards where five fit, wrapping
              the fifth into a row that broke the one-screen fit. */}
          <div className="mt-1 grid gap-[var(--ln-gap)] [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
            {(expanded ? entities : entities.slice(0, 5)).map((e) => {
              const called = e.positive + e.negative + e.neutral
              const change = deltaOf(e.total, e.previous)
              /* The reference inks the third dot grey on this band. */
              const MARK: Record<Tone, string> = {
                positive: 'var(--pos)',
                negative: 'var(--neg)',
                neutral: 'var(--ln-neutral-mark)',
              }
              return (
                <div
                  key={e.id}
                  title={KIND_TITLE[e.kind]}
                  className="ln-lift min-w-0 rounded-[12px] border border-[var(--rule)] p-2"
                >
                  <div className="flex items-center gap-3">
                    {/* The reference's 48px medallion: a person's own stored
                        photograph (initials only when the desk holds none), a
                        party's stored mark on a cream disc, a place's pin on a
                        pale blue one. The discs reuse the tint classes so the
                        dark theme dims them the same way it dims the chips. */}
                    {e.kind === 'person' ? (
                      <Avatar src={e.art?.url ?? null} alt={e.art?.alt} name={e.name} size={48} />
                    ) : e.kind === 'party' ? (
                      <span className="ln-tint-1 grid size-12 shrink-0 place-items-center rounded-full">
                        {e.art ? (
                          <img
                            src={e.art.url}
                            alt={e.art.alt}
                            width={26}
                            height={26}
                            loading="lazy"
                            decoding="async"
                            className="size-[26px] object-contain"
                          />
                        ) : (
                          <Flag size={20} className="text-[#f59e0b]" aria-hidden />
                        )}
                      </span>
                    ) : (
                      <span className="ln-tint-3 grid size-12 shrink-0 place-items-center rounded-full">
                        <MapPin size={20} className="text-[#3b82f6]" aria-hidden />
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-[14.5px] font-bold leading-tight">{e.name}</p>
                      <p className="tnum mt-0.5 truncate text-[12px] text-ink-3">
                        {e.total} {e.total === 1 ? 'Mention' : 'Mentions'}
                      </p>
                    </div>
                  </div>
                  {called > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                      {(['positive', 'negative', 'neutral'] as Tone[]).map((t) => (
                        <span
                          key={t}
                          className="flex items-center gap-1 text-[11px] font-semibold"
                          title={TONE_LABEL[t]}
                        >
                          <span
                            className="size-2 rounded-full"
                            style={{ background: MARK[t] }}
                            aria-hidden
                          />
                          <span className="tnum" style={{ color: MARK[t] }}>
                            {pct(e[t], called)}%
                          </span>
                          <span className="tnum text-ink-3">({e[t]})</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-ink-3">
                      None of these stories could be called either way.
                    </p>
                  )}
                  {/* deltaOf's floor, same as everywhere on this page: three
                      published stories on BOTH sides, or no line at all — a
                      thin side on either end printed "↑ 2266.7%" once. */}
                  {change !== null ? (
                    <p
                      className="tnum mt-0.5 text-[11.5px] font-semibold"
                      style={{
                        color: change >= 0 ? 'var(--pos)' : 'var(--neg)',
                      }}
                      title="Against the window immediately before this one."
                    >
                      {change >= 0 ? '↑' : '↓'} {Math.abs(change)}% vs previous {days} days
                    </p>
                  ) : (
                    /* THE REFUSAL STILL OCCUPIES ITS LINE. Four of five cards
                       stopped a line short of the first, so a row that is
                       deliberately restrained read as a row that failed to
                       finish. The floor is kept; only the hole is filled. */
                    <p
                      className="mt-0.5 text-[11.5px] text-ink-3"
                      title="A percent change is only printed with at least three published stories on both sides of the comparison."
                    >
                      {e.previous === 0
                        ? 'None published in the previous window'
                        : 'Too few stories to compare'}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </Card>
  )
}

/* ── export ──────────────────────────────────────────────────────────────── */

/**
 * The reference's "Export Report". A CSV of exactly the rows on screen, so
 * what an office files matches what it read.
 */
function ExportButton({
  mentions,
  windowLabel,
}: {
  mentions: PersonaMention[]
  windowLabel: string
}) {
  const download = (): void => {
    const esc = (s: string): string => `"${s.replace(/"/g, '""')}"`
    const head = ['Headline', 'Publisher', 'Published', 'Stance', 'Person', 'Place', 'URL']
    const lines = [head.join(',')]
    for (const x of mentions) {
      const t = toneOf(x)
      lines.push(
        [
          esc(x.headline),
          esc(x.publisher ?? ''),
          esc(x.publishedAt ?? ''),
          esc(t ? TONE_LABEL[t] : 'Not called'),
          esc(x.persona),
          esc(x.place ?? ''),
          esc(x.url),
        ].join(','),
      )
    }
    const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `local-news-${windowLabel.toLowerCase().replace(/\s+/g, '-')}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    // The reference's Export is an OUTLINE pill — white ground, accent text
    // and a light accent border — not a solid filled button.
    <button
      type="button"
      onClick={download}
      disabled={mentions.length === 0}
      className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[color-mix(in_oklab,var(--accent)_38%,transparent)] bg-[var(--surface)] px-3.5 text-[12.5px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-55"
    >
      <Download size={14} aria-hidden />
      Export Report
    </button>
  )
}
