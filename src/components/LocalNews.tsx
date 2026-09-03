import { useMemo, useState } from 'react'
import * as m from 'motion/react-m'
import {
  ArrowRight,
  Bookmark,
  Building2,
  Download,
  ExternalLink,
  Info,
  MapPin,
  Megaphone,
  Newspaper,
  Radio,
  Users,
} from 'lucide-react'
import type { Sentiment } from '@shared/taxonomy'
import { useStore } from '@/lib/store'
import { recurringTerms } from '@/lib/terms'
import { newsMentionsOf } from '@/lib/news-mentions'
import { cn } from '@/lib/utils'
import { fadeUp, listStagger } from '@/lib/motion'
import { Avatar, Button, Card, Empty, PageHeader, Shell } from './ui'
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
 * readership to us and we do not estimate it, so that row says so in words
 * rather than showing a number nobody measured. It is the difference between
 * a gap that names itself and a fabrication, and it is the whole reason this
 * product is trusted with a member's briefing.
 *
 * SENTIMENT IS THE STANCE THE READING RECORDED. `stance` is what the model
 * concluded about a story; `sentiment` is a second, coarser field that is
 * often null. Stance leads because it is the one that is populated, and the
 * word is printed beside the colour on every badge, because roughly one man in
 * twelve cannot separate the red from the green.
 */

/* ── the window ──────────────────────────────────────────────────────────── */

type Window = 7 | 30 | 90

const WINDOWS: { id: Window; label: string }[] = [
  { id: 7, label: 'Last 7 days' },
  { id: 30, label: 'Last 30 days' },
  { id: 90, label: 'Last 90 days' },
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

const pct = (n: number, of: number): number => (of === 0 ? 0 : Math.round((n / of) * 1000) / 10)

const compactNum = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
      : String(n)

function stampOf(mention: PersonaMention): number {
  const raw = mention.publishedAt ?? mention.seenAt
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : 0
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

/* ── the page ────────────────────────────────────────────────────────────── */

export function LocalNews({ onClose }: { onClose?: () => void }) {
  const store = useStore()
  const [days, setDays] = useState<Window>(7)
  const [tone, setTone] = useState<Tone | 'all'>('all')
  const [talkLens, setTalkLens] = useState<'keywords' | 'topics'>('keywords')
  const [place, setPlace] = useState('all')
  const [source, setSource] = useState('all')

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

  /** Everything inside the chosen window, newest first. */
  const inWindow = useMemo(() => {
    const cut = Date.now() - days * 86_400_000
    return [...all].filter((x) => stampOf(x) >= cut).sort((a, b) => stampOf(b) - stampOf(a))
  }, [all, days])

  /** The lists the filter bar offers: only values that actually occur. */
  const placeOptions = useMemo(
    () => [...new Set(inWindow.map((x) => (x.place ?? '').trim()).filter(Boolean))].sort(),
    [inWindow],
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
          (source === 'all' || (x.publisher ?? '').trim() === source),
      ),
    [inWindow, place, source],
  )

  /** The same length of window immediately before this one, for the delta. */
  const previous = useMemo(() => {
    const end = Date.now() - days * 86_400_000
    const start = end - days * 86_400_000
    return all.filter((x) => stampOf(x) >= start && stampOf(x) < end).length
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
      out.push(window.filter((x) => stampOf(x) >= start.getTime() && stampOf(x) < end).length)
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
    const own = new Set(
      [store.identity?.name, store.identity?.party]
        .filter((v): v is string => Boolean(v))
        .flatMap((v) => v.toLowerCase().split(/\s+/)),
    )
    const terms = recurringTerms(texts, 8, own) ?? []
    return terms
      .map((term) => {
        const needle = term.toLowerCase()
        const hits = window.filter((x) => `${x.headline} ${x.excerpt}`.toLowerCase().includes(needle))
        let positive = 0
        for (const h of hits) if (toneOf(h) === 'positive') positive++
        return { term, count: hits.length, positive: pct(positive, hits.length) }
      })
      .filter((k) => k.count > 0)
  }, [window, store.identity])

  /** Places, used as the second lens, because a topic list we cannot derive
      honestly is worse than a second real cut of the same stories. */
  const topics = useMemo(
    () =>
      places.slice(0, 8).map((p) => {
        const hits = window.filter((x) => (x.place ?? '').toLowerCase() === p.name.toLowerCase())
        let positive = 0
        for (const h of hits) if (toneOf(h) === 'positive') positive++
        return { term: p.name, count: p.total, positive: pct(positive, p.total) }
      }),
    [places, window],
  )

  /** Who the desk tracks, counted across the stories that name them. */
  const entities = useMemo(() => {
    const rows = store.personas.map((p) => {
      const mine = window.filter((x) => x.personaId === p.id)
      let positive = 0
      let negative = 0
      let neutral = 0
      for (const x of mine) {
        const t = toneOf(x)
        if (t === 'positive') positive++
        else if (t === 'negative') negative++
        else if (t === 'neutral') neutral++
      }
      const prevStart = Date.now() - 2 * days * 86_400_000
      const prevEnd = Date.now() - days * 86_400_000
      const previous = all.filter(
        (x) => x.personaId === p.id && stampOf(x) >= prevStart && stampOf(x) < prevEnd,
      ).length
      return { id: p.id, name: p.name, total: mine.length, positive, negative, neutral, previous }
    })
    return rows.filter((r) => r.total > 0).sort((a, b) => b.total - a.total)
  }, [store.personas, window, all, days])

  const shown = useMemo(
    () => (tone === 'all' ? window : window.filter((x) => toneOf(x) === tone)),
    [window, tone],
  )

  const windowLabel = WINDOWS.find((w) => w.id === days)?.label ?? 'Last 7 days'

  return (
    <Shell>
      <m.div
        variants={listStagger}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-3 pb-8"
      >
        <m.header variants={fadeUp}>
          <PageHeader
            title="Local news mentions"
            subtitle="Track what is being said in local news about you, your party, and key topics."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative">
                  <span className="sr-only">Window</span>
                  <select
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value) as Window)}
                    className="h-10 appearance-none rounded-[10px] border border-[var(--border)] bg-[var(--surface)] pl-3.5 pr-9 text-[13px] font-semibold outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)]"
                  >
                    {WINDOWS.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </label>
                <ExportButton mentions={shown} windowLabel={windowLabel} />
                {onClose && (
                  <Button variant="outline" size="sm" onClick={onClose}>
                    Back
                  </Button>
                )}
              </div>
            }
          />
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
            <div className="grid gap-3 xl:grid-cols-[minmax(0,17.5rem)_minmax(0,1fr)] xl:items-start">
              {/* ── left rail ───────────────────────────────────────── */}
              <m.div variants={fadeUp} className="grid gap-3">
                <OverallMentions
                  counts={counts}
                  sources={sources.length}
                  places={places.length}
                  windowLabel={windowLabel}
                  previous={previous}
                  days={days}
                  daily={daily}
                />
                <ByLocation places={places} total={counts.total} />
                <OverTime mentions={window} days={days} />
                <p className="flex gap-2.5 rounded-[var(--radius-lg)] bg-[var(--accent-soft)] p-3 text-[11.5px] leading-relaxed text-[var(--accent)]">
                  <Info size={15} className="mt-px shrink-0" aria-hidden />
                  <span>
                    Counted from stories this desk searched for and had read. Nothing here is
                    estimated.
                  </span>
                </p>
              </m.div>

              {/* ── main area ───────────────────────────────────────── */}
              <div className="grid min-w-0 gap-3">
                {/* The reference's filter row. Every option here is a value
                    that actually occurs in the window, so the bar can never
                    offer a cut that returns nothing. */}
                <m.div variants={fadeUp} className="flex flex-wrap gap-2">
                  <FilterPill
                    label="All locations"
                    value={place}
                    onChange={setPlace}
                    options={placeOptions}
                    icon={<MapPin size={13} aria-hidden />}
                  />
                  <FilterPill
                    label="All sentiment"
                    value={tone}
                    onChange={(v) => setTone(v as Tone | 'all')}
                    options={['positive', 'negative', 'neutral']}
                    labels={TONE_LABEL}
                    icon={<Radio size={13} aria-hidden />}
                  />
                  <FilterPill
                    label="All sources"
                    value={source}
                    onChange={setSource}
                    options={sourceOptions}
                    icon={<Building2 size={13} aria-hidden />}
                  />
                  {(place !== 'all' || source !== 'all' || tone !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setPlace('all')
                        setSource('all')
                        setTone('all')
                      }}
                      className="inline-flex h-9 items-center rounded-[8px] px-3 text-[12px] font-semibold text-[var(--accent)]"
                    >
                      Clear filters
                    </button>
                  )}
                </m.div>

                <m.div variants={fadeUp} className="grid gap-3 lg:grid-cols-[minmax(0,505fr)_minmax(0,648fr)] lg:items-stretch">
                  <SentimentOverviewCard counts={counts} />
                  <TopEntities entities={entities} />
                </m.div>

                <m.div variants={fadeUp} className="grid gap-3 xl:grid-cols-[minmax(0,739fr)_minmax(0,412fr)] xl:items-start">
                  <RecentMentions
                    mentions={shown}
                    tone={tone}
                    onTone={setTone}
                    counts={counts}
                  />
                  <div className="grid min-w-0 gap-3">
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

            {/* Full page width, left-aligned with the rail: in the reference
                this band runs edge to edge under both columns. */}
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
  icon,
  labels,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
  icon: React.ReactNode
  /** Display names, where the stored value is a code rather than a word. */
  labels?: Record<string, string>
}) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">
        {icon}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={options.length === 0}
        className="h-9 appearance-none rounded-[8px] border border-[var(--border)] bg-[var(--surface)] pl-8 pr-8 text-[12px] font-semibold outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)] disabled:opacity-55"
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
  windowLabel,
  previous,
  days,
  daily,
}: {
  counts: { total: number; positive: number; negative: number; neutral: number; unread: number }
  sources: number
  places: number
  windowLabel: string
  /** Stories in the window immediately before this one. */
  previous: number
  days: number
  /** One count per day across the window, for the sparkline. */
  daily: number[]
}) {
  // A change is only reportable when there is a previous window to compare
  // against. Against zero there is no percentage to state, so the card says
  // what it can instead of dividing by nothing.
  const delta =
    previous > 0 ? Math.round(((counts.total - previous) / previous) * 1000) / 10 : null
  const tiles: { tone: Tone; n: number }[] = [
    { tone: 'positive', n: counts.positive },
    { tone: 'negative', n: counts.negative },
    { tone: 'neutral', n: counts.neutral },
  ]
  return (
    <Card className="p-4">
      <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">
        Overall mentions <span className="font-medium text-ink-3">({windowLabel})</span>
      </h2>

      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tnum text-[30px] font-extrabold leading-none">{counts.total}</p>
          <p className="mt-1.5 text-[12px] font-semibold text-ink-2">Total mentions</p>
        </div>
        {daily.length > 1 && (
          <svg
            viewBox="0 0 90 34"
            className="mt-1 h-[34px] w-[90px] shrink-0"
            fill="none"
            role="img"
            aria-label={`Daily story count over the last ${days} days`}
          >
            <polyline
              points={daily
                .map(
                  (n, i) =>
                    `${(i / (daily.length - 1)) * 88 + 1},${32 - (n / Math.max(1, ...daily)) * 28}`,
                )
                .join(' ')}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>
      {delta !== null ? (
        <p
          className="tnum mt-1.5 text-[10.5px] font-semibold"
          style={{ color: delta >= 0 ? 'var(--pos)' : 'var(--neg)' }}
        >
          {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}% vs previous {days} days
        </p>
      ) : (
        <p className="mt-1.5 text-[10.5px] text-ink-3">
          Nothing was read in the {days} days before this, so there is no change to report
        </p>
      )}
      {counts.unread > 0 && (
        <p className="mt-1 text-[10.5px] leading-relaxed text-ink-3">
          {counts.unread} of these could not be called either way
        </p>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        {tiles.map(({ tone, n }) => (
          <div
            key={tone}
            className="rounded-[10px] p-2.5"
            style={{ background: TONE_VAR[tone].soft }}
          >
            <p className="tnum text-[17px] font-extrabold leading-none" style={{ color: TONE_VAR[tone].fg }}>
              {n}
            </p>
            <p className="mt-1.5 text-[10.5px] font-semibold" style={{ color: TONE_VAR[tone].fg }}>
              {TONE_LABEL[tone]}
            </p>
            <p className="tnum mt-0.5 text-[10px] text-ink-3">{pct(n, counts.total)}%</p>
            <span className="mt-1.5 block h-[5px] overflow-hidden rounded-full bg-[var(--surface-3)]">
              <span
                className="block h-full rounded-full"
                style={{ width: `${pct(n, counts.total)}%`, background: TONE_VAR[tone].fg }}
              />
            </span>
          </div>
        ))}
      </div>

      <ul className="mt-3 divide-y divide-[var(--rule)] border-t border-[var(--rule)]">
        <StatRow icon={<Newspaper size={13} />} label="News articles" value={String(counts.total)} />
        <StatRow icon={<Radio size={13} />} label="Sources" value={String(sources)} />
        <StatRow icon={<MapPin size={13} />} label="Locations covered" value={String(places)} />
        {/* The reference's fourth figure. A paper does not publish its
            readership to us and we do not model one, so this says so. */}
        <StatRow
          icon={<Megaphone size={13} />}
          label="Potential reach"
          value="Not measured"
          muted
        />
      </ul>
    </Card>
  )
}

function StatRow({
  icon,
  label,
  value,
  muted,
}: {
  icon: React.ReactNode
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <li className="flex items-center gap-2.5 py-2.5">
      <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink-2">{label}</span>
      <span
        className={cn(
          'tnum shrink-0 text-[12px] font-bold',
          muted ? 'text-[10.5px] font-medium text-ink-3' : 'text-ink',
        )}
      >
        {value}
      </span>
    </li>
  )
}

function ByLocation({ places, total }: { places: { name: string; total: number }[]; total: number }) {
  const top = places.slice(0, 5)
  const others = places.slice(5).reduce((n, p) => n + p.total, 0)
  const rows = others > 0 ? [...top, { name: 'Others', total: others }] : top
  const placed = rows.reduce((n, r) => n + r.total, 0)

  return (
    <Card className="p-4">
      <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">Mentions by location</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">
          None of the stories read so far names a place.
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-4">
            <Donut
              slices={rows.map((r, i) => ({ value: r.total, color: wheelAt(i) }))}
              total={placed}
              size={78}
            />
            <ul className="min-w-0 flex-1 space-y-1.5">
              {rows.map((r, i) => (
                <li key={r.name} className="flex items-center gap-2 text-[11px]">
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
          {total > placed && (
            <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink-3">
              {total - placed} of {total} stories name no place, so they are not on this wheel.
            </p>
          )}
          {places.length > 5 && (
            <p className="mt-2 text-[10.5px] text-ink-3">
              {places.length - 5} more {places.length - 5 === 1 ? 'place is' : 'places are'} inside
              Others. Use the location filter above to read any one of them.
            </p>
          )}
        </>
      )}
    </Card>
  )
}

const WHEEL = ['#4f46e5', '#14b8a6', '#7c3aed', '#0ea5e9', '#f59e0b', '#94a3b8']

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
  size,
}: {
  slices: { value: number; color: string }[]
  total: number
  size: number
}) {
  const r = 15.9155
  const circ = 2 * Math.PI * r
  let offset = 0
  return (
    <svg viewBox="0 0 42 42" width={size} height={size} className="shrink-0" aria-hidden>
      <circle cx="21" cy="21" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="7" />
      {slices.map((s, i) => {
        const len = total === 0 ? 0 : (s.value / total) * circ
        const el = (
          <circle
            key={i}
            cx="21"
            cy="21"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="7"
            strokeDasharray={`${len} ${circ - len}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 21 21)"
          />
        )
        offset += len
        return el
      })}
    </svg>
  )
}

function OverTime({ mentions, days }: { mentions: PersonaMention[]; days: number }) {
  const series = useMemo(() => {
    const span = Math.min(days, 14)
    const out: { label: string; positive: number; negative: number; neutral: number }[] = []
    for (let i = span - 1; i >= 0; i--) {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      start.setDate(start.getDate() - i)
      const end = start.getTime() + 86_400_000
      const day = mentions.filter((x) => stampOf(x) >= start.getTime() && stampOf(x) < end)
      let positive = 0
      let negative = 0
      let neutral = 0
      for (const x of day) {
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
    return out
  }, [mentions, days])

  const peak = Math.max(1, ...series.map((d) => Math.max(d.positive, d.negative, d.neutral)))

  return (
    <Card className="p-4">
      <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">Mentions by sentiment over time</h2>
      <div className="mt-2.5 flex flex-wrap gap-3">
        {(['positive', 'negative', 'neutral'] as Tone[]).map((t) => (
          <span key={t} className="flex items-center gap-1.5 text-[10.5px] font-medium text-ink-2">
            <span className="size-2 rounded-full" style={{ background: TONE_VAR[t].fg }} aria-hidden />
            {TONE_LABEL[t]}
          </span>
        ))}
      </div>

      {/* Three lines over the window, as the reference draws it. Plotted on
          a shared scale so the shapes are comparable, with the peak printed
          against the axis so a reader can size them. */}
      <svg viewBox="0 0 280 92" className="mt-3 h-[92px] w-full" fill="none" role="img" aria-label="Mentions by sentiment over time">
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1="26"
            x2="278"
            y1={10 + f * 64}
            y2={10 + f * 64}
            stroke="var(--rule)"
            strokeWidth="1"
          />
        ))}
        {[0, 0.5, 1].map((f) => (
          <text
            key={f}
            x="22"
            y={13 + f * 64}
            textAnchor="end"
            className="tnum"
            fontSize="8"
            fill="var(--text-3)"
          >
            {Math.round(peak * (1 - f))}
          </text>
        ))}
        {(['positive', 'negative', 'neutral'] as Tone[]).map((t) => {
          const step: number = series.length > 1 ? 252 / (series.length - 1) : 0
          const pts = series
            .map((d, i) => `${26 + i * step},${10 + (1 - d[t] / peak) * 64}`)
            .join(' ')
          return (
            <g key={t}>
              <polyline
                points={pts}
                fill="none"
                stroke={TONE_VAR[t].fg}
                strokeWidth="2.4"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {series.map((d, i) => (
                <circle
                  key={i}
                  cx={26 + i * step}
                  cy={10 + (1 - d[t] / peak) * 64}
                  r="2.2"
                  fill={TONE_VAR[t].fg}
                />
              ))}
            </g>
          )
        })}
      </svg>
      <div className="mt-1.5 flex justify-between text-[9px] font-medium text-ink-3">
        <span>{series[0]?.label}</span>
        <span>{series[series.length - 1]?.label}</span>
      </div>
    </Card>
  )
}

/* ── main area ───────────────────────────────────────────────────────────── */

function SentimentOverviewCard({
  counts,
}: {
  counts: { total: number; positive: number; negative: number; neutral: number }
}) {
  const cols: { tone: Tone; n: number }[] = [
    { tone: 'positive', n: counts.positive },
    { tone: 'negative', n: counts.negative },
    { tone: 'neutral', n: counts.neutral },
  ]
  const called = counts.positive + counts.negative + counts.neutral
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">Sentiment overview</h2>
      <div className="mt-4 flex flex-wrap items-center gap-5">
        <div className="relative shrink-0">
          <Donut
            slices={cols.map((c) => ({ value: c.n, color: TONE_VAR[c.tone].fg }))}
            total={called}
            size={86}
          />
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="text-center">
              <span className="tnum block text-[18px] font-extrabold leading-none">{counts.total}</span>
              <span className="block text-[9.5px] font-medium text-ink-3">Total</span>
            </span>
          </span>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-3 divide-x divide-[var(--rule)]">
          {cols.map(({ tone, n }) => (
            <div key={tone} className="min-w-0 px-2 text-center first:pl-0 last:pr-0">
              <p className="tnum text-[17px] font-extrabold leading-none" style={{ color: TONE_VAR[tone].fg }}>
                {pct(n, called)}%
              </p>
              <p className="mt-1 text-[11px] font-semibold text-ink-2">{TONE_LABEL[tone]}</p>
              <p className="tnum mt-0.5 text-[10px] text-ink-3">
                {n} {n === 1 ? 'story' : 'stories'}
              </p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

interface EntityRow {
  id: string
  name: string
  total: number
  positive: number
  negative: number
  neutral: number
  /** The same person's count in the window before this one. */
  previous: number
}

function TopEntities({ entities }: { entities: EntityRow[] }) {
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">Top entities mentioned</h2>
      {entities.length === 0 ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">
          No one on your People list is named in the stories read so far.
        </p>
      ) : (
        <div className="mt-3 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr))]">
          {entities.slice(0, 5).map((e) => (
            <span
              key={e.id}
              className="flex min-w-0 items-center gap-2.5 rounded-[10px] border border-[var(--rule)] bg-[var(--surface-2)] py-2 pl-2 pr-3"
            >
              <Avatar src={null} name={e.name} size={30} />
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-bold">{e.name}</span>
                <span className="tnum block text-[10.5px] text-ink-3">
                  {e.total} {e.total === 1 ? 'mention' : 'mentions'}
                </span>
              </span>
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}

function RecentMentions({
  mentions,
  tone,
  onTone,
  counts,
}: {
  mentions: PersonaMention[]
  tone: Tone | 'all'
  onTone: (t: Tone | 'all') => void
  counts: { total: number; positive: number; negative: number; neutral: number }
}) {
  const TABS: { id: Tone | 'all'; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: counts.total },
    { id: 'positive', label: 'Positive', n: counts.positive },
    { id: 'negative', label: 'Negative', n: counts.negative },
    { id: 'neutral', label: 'Neutral', n: counts.neutral },
  ]
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">Recent mentions</h2>
          <p className="mt-0.5 text-[10.5px] text-ink-3">
            Stories the desk has read that name the people you track
          </p>
        </div>
        <div className="flex shrink-0 rounded-[8px] bg-[var(--surface-3)] p-[3px]">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTone(t.id)}
              aria-pressed={tone === t.id}
              className={cn(
                'tnum rounded-[6px] px-2.5 py-1 text-[10.5px] font-semibold transition-colors',
                tone === t.id
                  ? 'bg-[var(--surface)] text-ink shadow-[var(--e1)]'
                  : 'text-ink-3 hover:text-ink-2',
              )}
            >
              {t.label} {t.n}
            </button>
          ))}
        </div>
      </div>

      {mentions.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          {tone === 'all'
            ? 'No stories in this window.'
            : `No story in this window was read as ${TONE_LABEL[tone].toLowerCase()}.`}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--rule)]">
          {mentions.slice(0, 12).map((x) => (
            <MentionRow key={x.id} mention={x} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function MentionRow({ mention }: { mention: PersonaMention }) {
  const t = toneOf(mention)
  const tags = [mention.persona, mention.place, mention.language].filter(Boolean) as string[]
  const source = (mention.publisher ?? '').trim()
  return (
    <li className="flex gap-3 py-3.5">
      {/* Image slot first, then the pill, then the story: the reference's own
          row order, measured off it. A feed gives us no photograph, so the
          masthead's mark fills the slot at the same 16:9 box rather than a
          grey rectangle pretending a picture failed to load. */}
      <span
        className="hidden h-[54px] w-[96px] shrink-0 flex-col items-center justify-center rounded-[8px] sm:flex"
        style={{
          background: `${hueOf(source || '?')}14`,
          color: hueOf(source || '?'),
        }}
        aria-hidden
      >
        <Newspaper size={16} strokeWidth={2.2} />
        <span className="mt-1 max-w-[86px] truncate px-1 text-[8.5px] font-bold uppercase tracking-[0.04em]">
          {source || 'Source'}
        </span>
      </span>

      <span className="flex w-[68px] shrink-0 justify-start pt-0.5">
        {t ? (
          <span
            className="inline-flex rounded-[6px] px-2 py-1 text-[9.5px] font-bold"
            style={{ background: TONE_VAR[t].soft, color: TONE_VAR[t].fg }}
          >
            {TONE_LABEL[t]}
          </span>
        ) : (
          <span className="inline-flex rounded-[6px] bg-[var(--surface-3)] px-2 py-1 text-[9.5px] font-bold text-ink-3">
            Not called
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <a
          href={mention.url}
          target="_blank"
          rel="noreferrer noopener"
          className="group flex items-start gap-1.5"
        >
          <span className="line-clamp-2 text-[12.5px] font-bold leading-[1.45] group-hover:underline">
            {mention.headline}
          </span>
          <ExternalLink size={12} className="mt-1 shrink-0 text-ink-3" aria-hidden />
        </a>
        <p className="mt-1.5 truncate text-[10.5px] text-ink-3">
          {source || 'Publisher not recorded'} · {whenOf(mention)}
        </p>
        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-[5px] bg-[var(--accent-soft)] px-1.5 py-0.5 text-[9.5px] font-semibold text-[var(--accent)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* The reference's right-hand column carries Potential Reach. We hold no
          readership figure for a newspaper, and repeating the stance pill here
          would say the same thing twice, so this column stays empty unless the
          reading raised a doubt worth acting on. */}
      <div className="hidden w-[92px] shrink-0 text-right sm:block">
        {mention.fake && mention.fake.suspicion !== 'No' && (
          <p className="text-[9.5px] font-bold leading-tight text-[var(--warn)]">
            Check this claim
          </p>
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
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">What&rsquo;s being talked about?</h2>
      <div className="mt-2.5 inline-flex rounded-[7px] bg-[var(--surface-3)] p-[3px]">
        {(['keywords', 'topics'] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onLens(l)}
            aria-pressed={lens === l}
            className={cn(
              'rounded-[5px] px-2.5 py-1 text-[10.5px] font-semibold capitalize transition-colors',
              lens === l ? 'bg-[var(--surface)] text-ink shadow-[var(--e1)]' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            By {l === 'keywords' ? 'keywords' : 'places'}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-2">
          {lens === 'keywords'
            ? 'No word recurs across the stories read so far.'
            : 'None of the stories read so far names a place.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((r) => (
            <li key={r.term} className="flex items-center gap-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] font-semibold capitalize">{r.term}</span>
                <span className="tnum block text-[10px] text-ink-3">
                  {r.count} {r.count === 1 ? 'mention' : 'mentions'}
                </span>
              </span>
              <span className="h-[6px] w-[84px] shrink-0 overflow-hidden rounded-full bg-[var(--surface-3)]">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${r.positive}%`,
                    background: r.positive >= 50 ? 'var(--pos)' : 'var(--neg)',
                  }}
                />
              </span>
              <span
                className="tnum w-9 shrink-0 text-right text-[10.5px] font-bold"
                style={{ color: r.positive >= 50 ? 'var(--pos)' : 'var(--neg)' }}
              >
                {r.positive}%
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <p className="mt-3 text-[10px] leading-relaxed text-ink-3">
          The right-hand figure is the share of those stories read as positive.
        </p>
      )}
    </Card>
  )
}

function TopSources({
  sources,
}: {
  sources: { name: string; total: number; positive: number; negative: number; neutral: number }[]
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">Top news sources</h2>
        <span className="shrink-0 text-[10px] font-semibold text-ink-3">By mentions</span>
      </div>
      {sources.length === 0 ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">
          None of the stories read so far records a publisher.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {sources.slice(0, 6).map((s) => {
            const called = s.positive + s.negative + s.neutral
            return (
              <li key={s.name} className="flex items-center gap-2.5">
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-extrabold"
                  style={{ background: `${hueOf(s.name)}1f`, color: hueOf(s.name) }}
                  aria-hidden
                >
                  {s.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-semibold">{s.name}</span>
                  <span className="tnum block text-[10px] text-ink-3">
                    {s.total} {s.total === 1 ? 'mention' : 'mentions'}
                  </span>
                </span>
                {called > 0 ? (
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className="flex w-[62px] overflow-hidden rounded-full"
                      title={`${s.positive} positive, ${s.negative} negative, ${s.neutral} neutral`}
                    >
                      {(['positive', 'negative', 'neutral'] as Tone[]).map((t) => (
                        <span
                          key={t}
                          className="block h-[6px]"
                          style={{ flex: s[t], minWidth: s[t] > 0 ? 3 : 0, background: TONE_VAR[t].fg }}
                          aria-hidden
                        />
                      ))}
                    </span>
                    <span className="tnum flex shrink-0 gap-1 text-[9px] font-bold">
                      {(['positive', 'negative', 'neutral'] as Tone[]).map((t) => (
                        <span key={t} style={{ color: TONE_VAR[t].fg }}>
                          {pct(s[t], called)}%
                        </span>
                      ))}
                    </span>
                  </span>
                ) : (
                  <span className="shrink-0 text-[9.5px] text-ink-3">Not called</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {sources.length > 6 && (
        <p className="mt-3 text-[10px] text-ink-3">
          {sources.length - 6} more {sources.length - 6 === 1 ? 'masthead is' : 'mastheads are'} in
          this window. Use the source filter above to read any one of them.
        </p>
      )}
    </Card>
  )
}

function KeyEntities({ entities, days }: { entities: EntityRow[]; days: number }) {
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-[12.5px] font-bold tracking-[-0.01em]">Mentions about key entities</h2>
      {entities.length === 0 ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">
          No one on your People list is named in the stories read so far.
        </p>
      ) : (
        <div className="mt-3 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
          {entities.slice(0, 5).map((e) => {
            const called = e.positive + e.negative + e.neutral
            return (
              <div key={e.id} className="rounded-[10px] border border-[var(--rule)] bg-[var(--surface-2)] p-3">
                <div className="flex items-center gap-2.5">
                  <Avatar src={null} name={e.name} size={40} />
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-bold">{e.name}</p>
                    <p className="tnum truncate text-[10.5px] text-ink-3">
                      {e.total} {e.total === 1 ? 'mention' : 'mentions'}
                    </p>
                  </div>
                </div>
                {called > 0 ? (
                  <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
                    {(['positive', 'negative', 'neutral'] as Tone[]).map((t) => (
                      <span key={t} className="flex items-center gap-1 text-[10px] font-semibold">
                        <span
                          className="size-1.5 rounded-full"
                          style={{ background: TONE_VAR[t].fg }}
                          aria-hidden
                        />
                        <span className="tnum" style={{ color: TONE_VAR[t].fg }}>
                          {pct(e[t], called)}%
                        </span>
                        <span className="tnum text-ink-3">({e[t]})</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2.5 text-[10px] text-ink-3">
                    None of these stories could be called either way.
                  </p>
                )}
                {e.previous > 0 ? (
                  <p
                    className="tnum mt-2 text-[10px] font-semibold"
                    style={{
                      color:
                        e.total >= e.previous ? 'var(--pos)' : 'var(--neg)',
                    }}
                  >
                    {e.total >= e.previous ? '↑' : '↓'}{' '}
                    {Math.abs(Math.round(((e.total - e.previous) / e.previous) * 1000) / 10)}% vs
                    previous {days} days
                  </p>
                ) : (
                  <p className="mt-2 text-[10px] text-ink-3">First window with any mentions</p>
                )}
              </div>
            )
          })}
        </div>
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
    <Button size="sm" onClick={download} disabled={mentions.length === 0}>
      <Download size={15} />
      Export report
    </Button>
  )
}
