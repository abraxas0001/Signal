import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Info, Newspaper, ShieldAlert } from 'lucide-react'
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

/** The reading's own verdict on the story, tinted to the side it took. */
function toneChip(s: string): { background: string; color: string } {
  if (s === 'Strong Positive' || s === 'Positive')
    return { background: 'var(--pos-soft)', color: 'var(--pos)' }
  if (s === 'Strong Negative' || s === 'Negative')
    return { background: 'var(--neg-soft)', color: 'var(--neg)' }
  if (s === 'Mixed') return { background: 'var(--warn-soft)', color: 'var(--warn)' }
  return { background: 'var(--surface-3)', color: 'var(--text-3)' }
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
    <label className="relative block shrink-0">
      <span className="sr-only">{allLabel}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={options.length === 0}
        style={width ? { width } : undefined}
        className="h-[27px] shrink-0 appearance-none rounded-[8px] border border-[var(--border)] bg-[var(--surface)] pl-2.5 pr-6 text-[11.5px] font-medium text-ink outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)] disabled:opacity-55"
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
}: {
  records: GrievanceRecord[]
  /** Open one record's full reading. */
  onOpen?: (record: GrievanceRecord) => void
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
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--rule)] pt-4">
        <Select value={severity} onChange={reset(setSeverity)} options={options.severity} allLabel="All severity" />
        <Select value={topic} onChange={reset(setTopic)} options={options.topic} allLabel="All topics" />
        <Select value={place} onChange={reset(setPlace)} options={options.place} allLabel="All locations" />
        <Select value={source} onChange={reset(setSource)} options={options.source} allLabel="All sources" />
        <label className="relative shrink-0 sm:ml-auto">
          <span className="sr-only">Sort</span>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey)
              setPage(0)
            }}
            className="h-[27px] shrink-0 appearance-none rounded-[8px] border border-[var(--border)] bg-[var(--surface)] pl-2.5 pr-6 text-[11.5px] font-medium text-ink outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)]"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                Sort by: {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ── the table ──────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <p className="mt-5 text-sm leading-relaxed text-ink-2">
          {records.length === 0
            ? 'Nothing has been filed on this desk yet. Paste the morning’s news links below and the issues will be listed here.'
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
                    <td className="w-[34%] py-4 pr-2">
                      <div className="flex gap-3">
                        <TopicTile topic={r.topic} />
                        <div className="min-w-0">
                          <p className="line-clamp-3 text-[13px] font-bold leading-[1.35]">
                            {r.headline}
                          </p>
                          <p className="mt-1.5 text-[11.5px] text-ink-3">{r.topic}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 pr-2">
                      <SeverityPill level={r.severity} />
                    </td>
                    <td className="py-4 pr-2">
                      <div className="flex items-center gap-2">
                        <PublisherMark name={r.publisher} />
                        <span className="min-w-0 text-[12.5px] font-semibold leading-tight">
                          {r.publisher ?? 'Not recorded'}
                        </span>
                      </div>
                    </td>
                    <td className="w-[28%] py-4 pr-2">
                      {r.excerpt.trim() ? (
                        <p className="line-clamp-3 text-[12px] leading-[1.42] text-ink-2">
                          &quot;...{r.excerpt.trim()}...&quot;
                        </p>
                      ) : (
                        <p className="text-[12px] text-ink-3">No excerpt was stored.</p>
                      )}
                      {/* WHAT THE READING MADE OF IT. Every record carries the
                          model's own summary, its sentiment, whether it smells
                          false and what it recommends — and none of it reached
                          this table, so the desk saw a quoted snippet and a
                          link and called it "no AI analysis". The summary and
                          the flags belong beside the quote they came from. */}
                      {r.summary.trim() && (
                        <p className="mt-1.5 line-clamp-3 border-l-2 border-[var(--accent)] pl-2 text-[11.5px] leading-[1.4] text-ink-3">
                          {r.summary.trim()}
                        </p>
                      )}
                      <span className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span
                          className="rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold"
                          style={toneChip(r.sentiment)}
                        >
                          {r.sentiment}
                        </span>
                        {r.fake.suspicion !== 'No' && (
                          <span className="inline-flex items-center gap-1 rounded-[5px] bg-[var(--warn-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warn)]">
                            <ShieldAlert size={10} aria-hidden />
                            Worth checking
                          </span>
                        )}
                      </span>
                      {onOpen && (
                        <button
                          type="button"
                          onClick={() => onOpen(r)}
                          className="mt-1.5 text-[12px] font-semibold text-[var(--accent)]"
                        >
                          Read more
                        </button>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-4 align-middle text-[12px] text-ink-3">
                      <span className="flex items-center gap-2">
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
                                  'grid size-6 shrink-0 place-items-center rounded-md hover:bg-[var(--surface-2)]',
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
              Showing {from} to {to} of {rows.length} {rows.length === 1 ? 'issue' : 'issues'}
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
