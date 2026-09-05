import { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Info,
  Newspaper,
  ShieldAlert,
} from 'lucide-react'
import type { GrievanceRecord } from '@shared/grievance'
import { SEVERITIES, TOPICS, type Severity } from '@shared/taxonomy'
import { absoluteDate, cn } from '@/lib/utils'
import { PublisherMark, SeverityPill, TopicTile } from './desk-kit'

/**
 * "List of issues" — the reference sheet's left card, built to it.
 *
 * Five columns, in its order: the issue with its topic tile and category, the
 * severity pill, who published it, the quoted snippet with a Read More, and
 * the date with a link out. Hairline rules, no zebra, no per-row card, five
 * rows a page.
 *
 * WHAT THE ROWS ARE. Real records off the desk, not a fixture: every row is a
 * story this office read and filed, and the snippet is the excerpt the reader
 * stored, quoted rather than paraphrased. The filters offer only values that
 * actually occur in the records on screen, so the bar can never present a cut
 * that returns an empty table.
 */

const PAGE = 5

type SortKey = 'recent' | 'severe' | 'oldest'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'recent', label: 'Most recent' },
  { id: 'severe', label: 'Most severe' },
  { id: 'oldest', label: 'Oldest first' },
]

/**
 * Does this address point at a story, or only at the paper?
 *
 * A front page is "eenadu.net" or "sakshi.com/telangana"; a story has a
 * deeper path, usually with an id or a slug in it.
 */
function isDeepLink(url: string): boolean {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/+$/, '')
    return path.split('/').filter(Boolean).length >= 2
  } catch {
    return false
  }
}

const RANK: Record<Severity, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 }

/**
 * What the reading made of this story, in one line, for the quote's hover.
 *
 * These three facts — how the story was read, whether it smells false, and the
 * model's own summary — used to be printed INSIDE the row: a second quoted
 * block under the snippet, a sentiment pill and an "AI analysis" chip. Three
 * stacked extras made every row about twice the height the reference draws,
 * and the reference's row carries none of them.
 *
 * So they moved rather than went. The whole reading is one press away behind
 * "Read more", which opens the record itself — sentiment, summary, the fake
 * check and what to say back, all of it. This line is the glance version, on
 * the hover of the quote it belongs to.
 */
function readingNote(r: GrievanceRecord): string {
  const head =
    r.fake.suspicion === 'No'
      ? `Read as ${r.sentiment.toLowerCase()}.`
      : `Read as ${r.sentiment.toLowerCase()}. Worth checking whether it is genuine.`
  const summary = r.summary.trim()
  return summary ? `${head} ${summary}` : `${head} No summary was stored for it.`
}

const stampOf = (r: GrievanceRecord): number => {
  const t = Date.parse(r.publishedAt ?? r.createdAt)
  return Number.isFinite(t) ? t : 0
}

function Select({
  value,
  onChange,
  options,
  allLabel,
  width,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  allLabel: string
  width?: number
}) {
  return (
    <label className="relative block min-w-0 flex-1 basis-0">
      <span className="sr-only">{allLabel}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={options.length === 0}
        /* Below about 1600 the longest of these ("All locations") is a few
           pixels wider than the share of the bar it gets, so it truncates.
           The whole label stays on the control's own hover rather than the
           reader being left with a stub. */
        title={value === 'all' ? allLabel : `${allLabel}: ${value}`}
        /*
         * INLINE, BECAUSE TWO UNLAYERED ELEMENT RULES BEAT THE UTILITIES.
         *
         * Measured on the running screen: this control reported font 17px and
         * a 36px right padding while its classes asked for 11px and 16px.
         * index.css styles `select` on the ELEMENT — `font-size: max(16px,
         * ...)` to stop iOS zooming on focus, and `padding-inline-end:
         * 2.25rem` to reserve room for the chevron it draws as a background
         * image — and unlayered author CSS outranks every Tailwind utility.
         *
         * So the four filters were rendering half again as large as intended,
         * which is the whole reason they could not sit on one row and came out
         * ragged. An inline style is the one thing that beats a stylesheet
         * without `!important`. 28px still clears the chevron: it is 16px wide
         * sitting 12px from the edge.
         *
         * (The iOS rule is right for touch and wrong for a mouse; scoping it
         * to `pointer: coarse` would fix every select in the app at once, but
         * that is fifteen controls across five screens and not this change.)
         */
        style={{ fontSize: 11, paddingInlineEnd: 28, ...(width ? { width } : {}) }}
        /* A NATIVE SELECT SIZES ITSELF TO ITS WIDEST OPTION, which is why these
         four came out at four different widths and wrapped onto three ragged
         rows: "All severity" holds three short words, "All locations" holds
         every place name the desk has read. The control is a filter, not a
         list, so its width belongs to the row rather than to its longest
         member. A FIXED width cannot be right at every width either: the bar
         is 552px at 1440 and 797px at 1920, so any number that fits the first
         wastes the second. The four share the row instead — equal by flex,
         never wrapping, truncating inside themselves the way the reference's
         do. */
      className="h-[30px] w-full appearance-none truncate rounded-[8px] border border-[var(--border)] bg-[var(--surface)] pl-1.5 pr-4 text-[11px] font-medium text-ink outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)] disabled:opacity-55"
      >
        <option value="all">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

export function IssuesTable({
  records,
  onOpen,
  emptyNote,
}: {
  records: GrievanceRecord[]
  /** Open one record's full reading. */
  onOpen?: (record: GrievanceRecord) => void
  /**
   * What to say when nothing was handed to this table.
   *
   * The desk now filters this list by a window in the page header, and a
   * window that cuts everything is not the same state as a desk nobody has
   * filed anything on. The caller knows which of the two it is; this table
   * does not, so it prints what it is given and falls back to the empty-desk
   * line when it is given nothing.
   */
  emptyNote?: string
}) {
  const [severity, setSeverity] = useState('all')
  const [topic, setTopic] = useState('all')
  const [place, setPlace] = useState('all')
  const [source, setSource] = useState('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [page, setPage] = useState(0)

  /** Only values that actually occur, so no cut can return an empty table. */
  const options = useMemo(() => {
    const sev = new Set<string>()
    const top = new Set<string>()
    const pl = new Set<string>()
    const src = new Set<string>()
    for (const r of records) {
      sev.add(r.severity)
      top.add(r.topic)
      for (const p of r.places) if (p.trim()) pl.add(p.trim())
      if (r.constituency?.trim()) pl.add(r.constituency.trim())
      if (r.publisher?.trim()) src.add(r.publisher.trim())
    }
    return {
      severity: SEVERITIES.filter((s) => sev.has(s)),
      topic: TOPICS.filter((t) => top.has(t)),
      place: [...pl].sort(),
      source: [...src].sort(),
    }
  }, [records])

  /**
   * A filter value the records no longer carry is dropped.
   *
   * The lists above are rebuilt from the records on screen, so a value can
   * leave them under a filter that is still applied: a rescan finds no
   * Critical story, the desk switches to a person nobody has filed a health
   * story about, an example desk is cleared. The select then renders disabled
   * on an empty list with the stale value still cutting the table, so the desk
   * reads "nothing matches all of those filters" over a control it cannot
   * operate to widen them. Only a value that has gone is reset; a cut the desk
   * chose that still exists is left exactly as it set it.
   */
  useEffect(() => {
    const gone = (v: string, list: readonly string[]) => v !== 'all' && !list.includes(v)
    if (gone(severity, options.severity)) setSeverity('all')
    if (gone(topic, options.topic)) setTopic('all')
    if (gone(place, options.place)) setPlace('all')
    if (gone(source, options.source)) setSource('all')
  }, [options, severity, topic, place, source])

  const rows = useMemo(() => {
    const kept = records.filter(
      (r) =>
        (severity === 'all' || r.severity === severity) &&
        (topic === 'all' || r.topic === topic) &&
        (place === 'all' ||
          r.places.some((p) => p.trim() === place) ||
          r.constituency?.trim() === place) &&
        (source === 'all' || (r.publisher ?? '').trim() === source),
    )
    const sorted = [...kept]
    if (sort === 'recent') sorted.sort((a, b) => stampOf(b) - stampOf(a))
    else if (sort === 'oldest') sorted.sort((a, b) => stampOf(a) - stampOf(b))
    else
      sorted.sort(
        (a, b) => RANK[b.severity] - RANK[a.severity] || stampOf(b) - stampOf(a),
      )
    return sorted
  }, [records, severity, topic, place, source, sort])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE))
  const current = Math.min(page, pages - 1)
  const shown = rows.slice(current * PAGE, current * PAGE + PAGE)
  const from = rows.length === 0 ? 0 : current * PAGE + 1
  const to = Math.min(rows.length, (current + 1) * PAGE)

  const reset = (fn: (v: string) => void) => (v: string) => {
    fn(v)
    setPage(0)
  }

  return (
    <div>
      {/* ── the filter row ─────────────────────────────────────────────── */}
      {/* NO RULE OF ITS OWN. The keywords panel above already closes itself
          with a border-b, so this border-t drew a SECOND hairline a few
          pixels under the first with a band of empty card between them. One
          divider, drawn by the thing that ends. */}
      <div className="flex flex-wrap items-center gap-2 pt-3">
        {/* The four filters share one line and never wrap against each other;
            where the column is too narrow to seat the sort beside them, that
            one control drops below rather than the set breaking up. */}
        <div className="flex min-w-0 flex-1 basis-[260px] items-center gap-2">
          <Select value={severity} onChange={reset(setSeverity)} options={options.severity} allLabel="All severity" />
          <Select value={topic} onChange={reset(setTopic)} options={options.topic} allLabel="All topics" />
          <Select value={place} onChange={reset(setPlace)} options={options.place} allLabel="All locations" />
          <Select value={source} onChange={reset(setSource)} options={options.source} allLabel="All sources" />
        </div>
        {/* THE PREFIX MOVES OFF THE CONTROL AND ONTO ITS LABEL.
            Measured: the four filters need 486px of this bar and
            "Sort by: Most recent" needs another 192, against a bar that is
            552px at 1440 and 628px at 1600 — so with the prefix on screen the
            row could not be a row at any width this app renders. The word the
            reader needs is WHICH ORDER, not the word "sort"; the control's own
            accessible name and hover still say it. */}
        <label className="relative ml-auto shrink-0" title="Sort the issues">
          <span className="sr-only">Sort by</span>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey)
              setPage(0)
            }}
            /* Fixed, like the four beside it: "Sort by: Most recent" sized
               this control to 216px, and four filters plus a control that
               wide do not fit the column the reference draws them in. */
            style={{ fontSize: 11, paddingInlineEnd: 28 }}
            className="h-[30px] w-[112px] shrink-0 appearance-none truncate rounded-[8px] border border-[var(--border)] bg-[var(--surface)] pl-2 pr-5 text-[11px] font-medium text-ink outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)]"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ── the table ──────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <p className="mt-5 text-sm leading-relaxed text-ink-2">
          {records.length === 0
            ? (emptyNote ??
              'Nothing has been filed on this desk yet. Paste the morning’s news links below and the issues will be listed here.')
            : 'Nothing matches all of those filters. Widen one of them to see the rest.'}
        </p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[540px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--rule)]">
                  {['Issue', 'Severity', 'Published in', 'Snippet', 'Date'].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="pb-2.5 pr-2 text-[12px] font-semibold text-ink-2 last:pr-0"
                    >
                      {h}
                    </th>
                  ))}

                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--rule)] align-top">
                    {/* THE HEADLINE GETS ITS WIDTH BACK.

                        Measured at 1440 before this change: a 155px Issue cell
                        less a 42px tile and a 12px gap left the title 93px, and
                        every one of the five headlines clamped at three lines.
                        The cell is the widest in the reference and it was the
                        narrowest here, because the auto table algorithm hands
                        the flexible columns only what the fixed ones leave —
                        and the publisher, date and severity columns had grown
                        to their content. They are on a diet below; the hint
                        here is raised to take what that frees. */}
                    <td className="w-[36%] py-4 pr-2">
                      <div className="flex gap-[10px]">
                        <TopicTile topic={r.topic} size={36} />
                        <div className="min-w-0">
                          {/* Three lines, as the reference draws them; the
                              whole headline is on the hover, so a clamp never
                              costs the reader a word. */}
                          <p
                            title={r.headline}
                            className="line-clamp-3 text-[13px] font-bold leading-[1.35]"
                          >
                            {r.headline}
                          </p>
                          <p className="mt-1.5 text-[11.5px] text-ink-3">{r.topic}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 pr-1">
                      <SeverityPill level={r.severity} />
                      {/* THE FAKE-NEWS FLAG, BACK ON THE ROW.

                          It went out with the sentiment pill and the summary
                          block, and it should not have: those two restate what
                          the reading thought, and this one is a WARNING that
                          the story may not be true. A desk that cannot see
                          which of five rows is suspect until it opens each one
                          is not being warned at all. It sits under the severity
                          it qualifies, where the column already had the room —
                          the row height is unchanged.

                          Only 'No' is silent. 'Unsure' flags too: an unresolved
                          check is not a clean bill, and treating it as one is
                          the same lie in the other direction. */}
                      {r.fake.suspicion !== 'No' && (
                        <span
                          className="mt-1.5 flex w-fit items-center gap-1 rounded-[5px] bg-[var(--warn-soft)] px-1.5 py-[2px] text-[10px] font-semibold text-[var(--warn)]"
                          title={`This story may not be genuine: the desk's reading rated it ${r.fake.suspicion.toLowerCase()} on the fake-news check. Read more opens the check itself.`}
                        >
                          <ShieldAlert size={10} aria-hidden />
                          <span aria-hidden>Check</span>
                          <span className="sr-only">
                            Worth checking whether this story is genuine: rated{' '}
                            {r.fake.suspicion.toLowerCase()} on the fake-news check.
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="py-4 pr-2">
                      {/* A 28px disc and 12.5px type sized this column to 107px
                          at 1440 and took it out of the headline beside it. The
                          mark is still legible at 24 and the name still wraps
                          rather than truncating, so nothing here is lost. */}
                      <div className="flex items-center gap-1.5">
                        <PublisherMark name={r.publisher} size={24} />
                        <span className="min-w-0 text-[12px] font-semibold leading-tight">
                          {r.publisher ?? 'Not recorded'}
                        </span>
                      </div>
                    </td>
                    <td className="w-[27%] py-4 pr-2">
                      {/* THE QUOTE AND ITS LINK, AND NOTHING ELSE.

                          Three things used to sit under this snippet — the
                          model's summary in a second quoted block, a sentiment
                          pill, and an "AI analysis" chip. Stacked, they made
                          every row about twice the height the reference draws,
                          and the reference's row carries none of them.

                          Nothing was deleted. "Read more" opens the record's
                          whole reading — summary, sentiment, the fake check,
                          what to say back — and the glance version of the same
                          three facts is on this quote's own hover. */}
                      <p
                        title={readingNote(r)}
                        className={cn(
                          'line-clamp-3 text-[12px] leading-[1.42]',
                          r.excerpt.trim() ? 'text-ink-2' : 'text-ink-3',
                        )}
                      >
                        {r.excerpt.trim()
                          ? `"...${r.excerpt.trim()}..."`
                          : 'No excerpt was stored.'}
                      </p>
                      {onOpen && (
                        <button
                          type="button"
                          onClick={() => onOpen(r)}
                          /* Named "Read more" as the reference names it, and
                             the hover says what it actually opens: not more of
                             the quote, but the desk's reading of the story. */
                          title="Open the desk's full reading of this story: its summary, how it was read, who it names, whether it looks genuine, and what to say back."
                          className="mt-1.5 text-[11.5px] font-semibold text-[var(--accent)] transition-colors hover:text-ink hover:underline"
                        >
                          Read more
                        </button>
                      )}
                    </td>
                    {/* 102px of a 552px table went on a date and a link box.
                        Half a point of type and four pixels off the icon give
                        nine of them back to the two columns that needed them,
                        and the date still sets on one line at every width. */}
                    <td className="whitespace-nowrap py-4 align-middle text-[11.5px] text-ink-3">
                      <span className="flex items-center gap-1.5">
                        {absoluteDate(r.publishedAt ?? r.createdAt)}
                        {r.sourceUrl &&
                          (() => {
                            /**
                             * A LINK TO THE PAPER IS NOT A LINK TO THE STORY.
                             *
                             * Records filed by a real scan carry the story's
                             * own address. Example records carry only the
                             * paper's front page, because the cutting they
                             * stand for was never a published article — and
                             * dressing that up with a "open the story" label
                             * sent the desk to eenadu.net and left them
                             * hunting for a piece that is not there. The link
                             * says which of the two it is.
                             */
                            const deep = isDeepLink(r.sourceUrl)
                            return (
                              <a
                                href={r.sourceUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                title={
                                  deep
                                    ? `Open this story on ${r.publisher ?? 'the publisher'}`
                                    : `Open ${r.publisher ?? 'the publisher'}. This record has no direct address for the story itself, so this goes to the paper.`
                                }
                                aria-label={
                                  deep
                                    ? `Open this story on ${r.publisher ?? 'the publisher'}`
                                    : `Open ${r.publisher ?? 'the publisher'}, the paper this record came from`
                                }
                                className={cn(
                                  'grid size-5 shrink-0 place-items-center rounded-md hover:bg-[var(--surface-2)]',
                                  deep ? 'text-[var(--accent)]' : 'text-ink-3',
                                )}
                              >
                                {deep ? <ExternalLink size={13} /> : <Newspaper size={13} />}
                              </a>
                            )
                          })()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── pagination ───────────────────────────────────────────── */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="tnum text-[12px] text-ink-3">
              {/* RECORDS, NOT ISSUES. Every line of this table is one story
                  this desk read and filed; an issue is a CLUSTER of them, and
                  the panel beside this one counts those. A footer that called
                  five records "5 issues" put a different number under the same
                  word on two halves of one screen. */}
              Showing {from} to {to} of {rows.length} {rows.length === 1 ? 'record' : 'records'}
            </p>
            {pages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage((n) => Math.max(0, n - 1))}
                  disabled={current === 0}
                  aria-label="Previous page"
                  className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-[var(--surface-2)] disabled:opacity-35"
                >
                  <ChevronLeft size={14} />
                </button>
                {Array.from({ length: pages }, (_, i) => i).map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPage(i)}
                    aria-current={i === current ? 'page' : undefined}
                    className={cn(
                      'tnum grid h-[27px] min-w-[26px] place-items-center rounded-[7px] px-1.5 text-[12px] font-semibold',
                      i === current
                        ? 'border border-[color-mix(in_oklab,var(--accent)_35%,transparent)] bg-[var(--surface)] text-[var(--accent)]'
                        : 'text-ink-2 hover:bg-[var(--surface-2)]',
                    )}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPage((n) => Math.min(pages - 1, n + 1))}
                  disabled={current >= pages - 1}
                  aria-label="Next page"
                  className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-[var(--surface-2)] disabled:opacity-35"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── the card's footnote bar ────────────────────────────────────── */}
      <p className="mt-4 flex gap-2 rounded-[10px] border border-[color-mix(in_oklab,var(--accent)_14%,transparent)] bg-[var(--accent-soft)] p-2.5 text-[11px] leading-relaxed text-[var(--accent)]">
        <Info size={14} className="mt-px shrink-0" aria-hidden />
        <span>
          Issues are aggregated from the newspapers and digital portals this desk is set to read.
          Snippets are quoted from the story, never rewritten.
        </span>
      </p>
    </div>
  )
}
