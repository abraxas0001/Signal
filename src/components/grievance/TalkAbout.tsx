import { useMemo, useState } from 'react'
import { Lightbulb, PenLine } from 'lucide-react'
import { PLATFORM_META } from '@/components/kit'
import { openingsOf, type Opening } from '@/lib/next-post'
import { useStore, type Store } from '@/lib/store'
import { cn } from '@/lib/utils'
import { SEVERITY, TopicTile } from './desk-kit'

/**
 * "What should I talk about?" — the reference sheet's right card, built to it.
 *
 * Ranked cards, each severity-tinted: a rank badge with the severity word
 * under it, the topic tile, a title and two lines of why, a quote box, the
 * reason it is ranked where it is, the platforms to say it on, and the button
 * that starts a draft.
 *
 * THE QUOTE BOX IS THE PART THAT HAS TO BE HONEST. The reference prints a
 * finished post inside every card — "Visited affected areas in Ranga Reddy
 * today..." — as though four posts had already been written. Writing those
 * here would put words in a member's mouth that no model produced and no
 * human approved, and a screenshot of it would outlive any caveat. So the box
 * carries the counter-narrative the analysis actually recorded for that issue
 * when there is one, and otherwise says plainly that nothing is drafted yet
 * and offers the button that drafts it.
 *
 * THE RATIONALE IS COUNTED, NOT CLAIMED. The sheet's footers read "82%
 * negative sentiment and high engagement on this issue." We do not measure
 * engagement on a newspaper story and will not imply we do, so each footer
 * states the share of that issue's own records read as negative, which is a
 * real count, and the severity and volume the ranker actually used.
 */

type Filter = 'all' | 'High' | 'Medium' | 'Low'

/** The three tiers a card can actually be drawn as. */
type Tier = Exclude<Filter, 'all'>

/** What one chip's row says about the set behind it. */
type Counts = Record<Filter, number> & {
  /**
   * How many of the counted rows carry no severity the taxonomy recognises.
   *
   * They are ranked Medium by `sevOf`, and a chip reading "Medium severity: 4"
   * over a set where two of the four were never graded is the label claiming a
   * reading nobody made. The figure rides the Medium chip's own hover.
   */
  unrated: number
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All issues' },
  // Critical folds into High here and in the badge, so every tier a card can
  // show is reachable from a chip and the counts reconcile with All.
  { id: 'High', label: 'High severity' },
  { id: 'Medium', label: 'Medium severity' },
  { id: 'Low', label: 'Low severity' },
]

/**
 * What a chip's count says, in words, for its hover and its screen-reader name.
 *
 * Written out per tier rather than as one template, because "High severity"
 * here also holds every Critical issue — the badge folds the two — and a hover
 * that said "4 high severity" over a list containing a Critical one would be
 * the label lying about what it counts.
 */
function chipHint(f: { id: Filter; label: string }, counts: Counts): string {
  const n = counts[f.id]
  const issues = `${n} ${n === 1 ? 'issue' : 'issues'}`
  // The list is capped, so a count that is larger than the cap has to say so.
  // "12 issues ranked here" over six cards is the hover contradicting the
  // screen, which is the one thing a count in a tooltip must never do.
  const capped = n > SHOWN ? `; the top ${SHOWN} are shown` : ''
  if (f.id === 'all') return `${issues} ranked here${capped}.`
  if (f.id === 'High') return `${issues} of ${counts.all}, counting critical ones${capped}.`
  // Medium is the tier the unrated fall into, so it is the one that has to own
  // up to them. Said here rather than left to the reader to notice that the
  // three tiers sum to All only because something ungraded was folded in.
  if (f.id === 'Medium' && counts.unrated > 0)
    return `${issues} of ${counts.all}, including ${counts.unrated} with no severity recorded${capped}.`
  return `${issues} of ${counts.all}${capped}.`
}

/** How many cards the column carries. The reference draws four; this is what
    fits beside a five-row table without the two halves of the screen ending a
    page apart. */
const SHOWN = 6

/** The three the reference draws, in its order. */
const PLATFORMS = ['Facebook', 'Instagram', 'Twitter/X'] as const

/**
 * The tier a row is DRAWN as — the one rule, used by the badge and the counts.
 *
 * The counts used to be taken separately, matching only the four literal
 * severity words, while the badge came through here and put everything else in
 * Medium. So an opening carrying no severity at all — a news story the reading
 * did not grade — was drawn on a Medium card, excluded from the Medium chip's
 * count AND from the list that chip filters to. Measured on this desk: All 12,
 * High 8, Medium 2, Low 0, with two cards on screen that no chip would own.
 * One helper decides the tier now, and both the count and the filter call it.
 */
const sevOf = (s: string | null): Tier =>
  s === 'Critical' || s === 'High' ? 'High' : s === 'Medium' || s === 'Low' ? s : 'Medium'

/** Whether the taxonomy actually graded this row, as opposed to `sevOf` placing it. */
const isRated = (s: string | null): boolean =>
  s === 'Critical' || s === 'High' || s === 'Medium' || s === 'Low'

/**
 * The issue's real topic.
 *
 * `Opening.issue.category` is the literal string 'grievance' for every
 * grievance row — a kind, not a topic — so every card drew the same fallback
 * tile. The topic is on the cluster itself.
 */
function topicOf(store: Store, opening: Opening): string | null {
  if (opening.kind !== 'grievance') return null
  return store.issues.find((x) => x.id === opening.id)?.category ?? null
}

/** The two lines of context the reference puts under each title. */
function contextOf(store: Store, opening: Opening): string | null {
  if (opening.kind !== 'grievance') return null
  const summary = store.issues.find((x) => x.id === opening.id)?.summary?.trim()
  return summary && summary.length > 0 ? summary : null
}

/** The line the analysis already wrote back for this issue, if it wrote one. */
function draftFor(store: Store, opening: Opening): string | null {
  if (opening.kind !== 'grievance') return null
  const line = store.issues.find((x) => x.id === opening.id)?.counterNarrative?.trim()
  return line && line.length > 0 ? line : null
}

/**
 * How the records behind this issue were read.
 *
 * Returns null when the issue has no records we can count — a story-shaped
 * opening, or a tally rather than a cluster — because a share of nothing is
 * not a zero.
 */
function negativeShare(store: Store, opening: Opening): { pct: number; of: number } | null {
  if (opening.kind !== 'grievance') return null
  const issue = store.issues.find((x) => x.id === opening.id)
  if (!issue || issue.recordIds.length === 0) return null
  const ids = new Set(issue.recordIds)
  const rows = store.grievances.filter((r) => ids.has(r.id))
  if (rows.length === 0) return null
  const neg = rows.filter((r) => r.sentiment === 'Negative' || r.sentiment === 'Strong Negative').length
  return { pct: Math.round((neg / rows.length) * 100), of: rows.length }
}

function PlatformDot({ platform }: { platform: string }) {
  const meta = PLATFORM_META[platform]
  if (!meta) return null
  const { Icon, bg, color } = meta
  return (
    <span
      className="grid size-[18px] shrink-0 place-items-center rounded-full"
      style={{ background: bg, color }}
      title={platform}
      aria-hidden
    >
      <Icon size={10} />
    </span>
  )
}

export function TalkAbout({
  since,
  issueIds = null,
  emptyNote,
  onDraft,
}: {
  since: number
  /**
   * The issues the page's window leaves standing, or null for no window.
   *
   * `since` alone cannot do this job. It reaches `newsSelection`, which does
   * window the news openings by it — but `issuesFor` ignores it entirely
   * whenever the desk holds clustered issues, which is the normal case. So a
   * window control wired to `since` would have visibly moved the news half of
   * this list and silently left the grievance half exactly as it was, which
   * is the picker-that-does-nothing this was added to avoid. The caller owns
   * the records, so the caller decides which issues survive its window.
   */
  issueIds?: ReadonlySet<string> | null
  /**
   * What to say when the caller's window leaves this panel with nothing.
   *
   * The same contract the issues table beside it already has. A desk whose
   * records are all older than the window loses every card here, and this
   * panel cannot tell that from a desk with nothing on it — the caller owns
   * the records and the window, so the caller writes the sentence. Without it
   * a desk re-dated forty-five days back went silently blank on this half of
   * the screen while the half beside it explained itself.
   */
  emptyNote?: string
  onDraft?: (opening: Opening) => void
}) {
  const store = useStore()
  const [filter, setFilter] = useState<Filter>('all')

  const model = useMemo(() => openingsOf(store, since), [store, since])

  /** The window applied, before anything is counted or filtered. */
  const windowed = useMemo(
    () =>
      model.rows.filter((r) => r.kind !== 'grievance' || issueIds === null || issueIds.has(r.id)),
    [model.rows, issueIds],
  )

  const counts = useMemo<Counts>(() => {
    const out: Counts = { all: windowed.length, High: 0, Medium: 0, Low: 0, unrated: 0 }
    for (const r of windowed) {
      out[sevOf(r.severity)]++
      if (!isRated(r.severity)) out.unrated++
    }
    return out
  }, [windowed])

  const rows = useMemo(
    () => (filter === 'all' ? windowed : windowed.filter((r) => sevOf(r.severity) === filter)),
    [windowed, filter],
  )

  /**
   * What the caller's window is holding back, counted.
   *
   * The empty note below only fires when the window takes EVERYTHING, and on a
   * desk that also has news openings it never fires at all: the grievance half
   * vanishes and six story cards stay, so the panel looks full while eight
   * issues have quietly left it. Measured on a desk re-dated forty-five days
   * back — every issue gone, no line on the screen saying so. The count is
   * printed whenever it is not zero, whether the window took some or all.
   */
  const heldBack = model.rows.length - windowed.length

  return (
    <div>
      <h2 className="text-[15px] font-bold tracking-[-0.012em]">
        What should I talk about?{' '}
        <span className="font-normal text-ink-3">(Post suggestions)</span>
      </h2>
      <p className="mt-1 max-w-[52ch] text-[12.5px] leading-relaxed text-ink-3">
        Data-driven post ideas to address issues and influence positive sentiment.
      </p>

      {/* THE COUNTS MOVED TO THE HOVER, NOT OUT OF THE PRODUCT.
          Four chips each carrying a figure read as a row of statistics rather
          than as a set of cuts, and the reference's row is four plain words.
          The figures are real and worth keeping, so each chip says its own on
          hover and in its accessible name — where a screen reader gets it too,
          which the printed digit never guaranteed. */}
      <div className="mt-3.5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            title={chipHint(f, counts)}
            aria-label={`${f.label}. ${chipHint(f, counts)}`}
            className={cn(
              'inline-flex h-[29px] items-center rounded-[8px] border px-3 text-[11.5px] transition-colors',
              filter === f.id
                ? 'border-[color-mix(in_oklab,var(--accent)_35%,transparent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
                : 'border-[var(--border)] bg-[var(--surface)] font-medium text-ink-2 hover:border-[var(--border-interactive)]',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* THE HELD-BACK LINE IS GONE, NOT REWORDED.
          It named the window as the only reason an issue was missing and
          counted only the rows the window itself cut — measured against a
          desk where five were missing, it said three, and it said the window
          did it. Two cuts run before the window (the relevance check, and
          this card's own cap) and it accounted for neither. A count that is
          wrong and a cause that is wrong are not fixed by softening the
          sentence; the empty state below already says which cut emptied the
          list, and it says it only where it is true. */}

      {rows.length === 0 ? (
        /*
         * THREE DIFFERENT EMPTIES, AND THEY ARE NOT THE SAME SENTENCE.
         *
         * This was two, and the fall-through produced "Nothing on the list is
         * all severity." — reachable the moment the window emptied the panel
         * while the desk still held issues, because `filter` is 'all' there
         * and the branch assumed it never could be. So the severity sentence
         * is now written only where a severity chip is actually the cut, and
         * every other empty says which cut did it.
         */
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          {windowed.length > 0 && filter !== 'all'
            /* "…to see the 12 that are here" promised twelve cards and the
               card draws six. It now points at the control without pricing
               it, because the number a reader would check is the one this
               list cannot show. */
            ? `Nothing on this list is ranked ${filter.toLowerCase()} severity. Pick “All issues” to see the rest.`
            : model.rows.length > 0
              ? (emptyNote ??
                'Everything this desk has to answer falls outside the window at the top of the screen. Widen it to see what is here.')
              : (emptyNote ??
                'Nothing is waiting on an answer. Once the desk files an issue or reads a story that clears the relevance check, it will be ranked here.')}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2.5">
          {rows.slice(0, SHOWN).map((row, i) => {
            const level = sevOf(row.severity)
            const t = SEVERITY[level]
            const draft = draftFor(store, row)
            const share = negativeShare(store, row)
            return (
              <li
                key={`${row.kind}-${row.id}`}
                className="rounded-[10px] border p-3"
                style={{ background: t.cardFill, borderColor: t.cardBorder }}
              >
                <div className="flex items-start gap-2.5">
                  {/* rank badge with the severity word beneath it */}
                  {/* A FIXED COLUMN THE WIDTH OF THE NUMERAL, and the pill
                      beneath fills it rather than setting it. Left to size
                      itself, the column took the width of the severity WORD —
                      "Medium" is wider than "High" — so the medium cards'
                      titles sat further right than the high ones' and their
                      quote boxes wrapped a line earlier than everyone else's.
                      Measured on the running screen: 46px against 42px, and a
                      quote that fitted one line in four cards and two in the
                      other two. */}
                  <span className="flex w-[42px] shrink-0 flex-col items-center">
                    <span
                      className="tnum grid size-[42px] place-items-center rounded-[9px] text-[22px] font-bold leading-none"
                      style={{ background: t.badgeFill, color: t.chipText }}
                    >
                      {i + 1}
                    </span>
                    {/* A PILL, not a bare word. The reference sets the severity
                        in a tinted rounded rect under the numeral, which is the
                        same object the table's rows carry — and a word floating
                        under a badge read as a caption rather than as the
                        row's severity. */}
                    <span
                      className="mt-1.5 flex w-full items-center justify-center truncate rounded-[6px] px-0.5 py-[2px] text-[10px] font-semibold leading-[1.4]"
                      style={{ background: t.chipFill, color: t.chipText }}
                    >
                      {level}
                    </span>
                  </span>

                  <TopicTile topic={topicOf(store, row)} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-[14px] font-bold leading-snug">{row.title}</p>
                      {onDraft && (
                        <button
                          type="button"
                          onClick={() => onDraft(row)}
                          className="inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-[12.5px] font-semibold text-[var(--accent)] transition-colors hover:border-[var(--accent)]"
                        >
                          <PenLine size={13} aria-hidden />
                          Use this
                        </button>
                      )}
                    </div>
                    {/* Two lines, as the reference draws them. A summary that
                        runs longer is not cut off from the reader: the whole of
                        it is on the hover, and all of it is in the record the
                        Use this button opens. */}
                    <p
                      title={contextOf(store, row) ?? row.why}
                      className="mt-1 line-clamp-2 text-[12.5px] leading-[1.4] text-ink-2"
                    >
                      {contextOf(store, row) ?? row.why}
                    </p>

                    {/* the draft, or an honest absence of one */}
                    <div
                      className="mt-2 rounded-[10px] px-3 py-2.5"
                      style={{ background: t.quoteFill }}
                    >
                      {draft ? (
                        <p className="text-[12px] leading-[1.45] text-ink-2">&ldquo;{draft}&rdquo;</p>
                      ) : (
                        <p className="text-[12px] leading-[1.45] text-ink-3">
                          No line has been drafted for this yet. Use this to write one.
                        </p>
                      )}
                    </div>

                  </div>
                </div>

                {/* One footer strip across the whole card, as the reference
                    draws it: the reason on the left, the platforms right. */}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                  <p className="min-w-0 flex-1 text-[11px] leading-snug text-ink-3">
                    <span className="font-semibold">Why it is here:</span>{' '}
                    {share
                      ? `${share.pct}% of the ${share.of} ${share.of === 1 ? 'record' : 'records'} behind it read as negative.`
                      : row.why}
                  </p>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[11px] text-ink-3">Suggested platforms:</span>
                    {PLATFORMS.map((p) => (
                      <PlatformDot key={p} platform={p} />
                    ))}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-3.5 flex gap-2 rounded-[10px] border border-[color-mix(in_oklab,var(--accent)_14%,transparent)] bg-[var(--accent-soft)] p-2.5 text-[11px] leading-relaxed text-[var(--accent)]">
        <Lightbulb size={14} className="mt-px shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          Ranked by severity and how many records sit behind each issue. Engagement is not part of
          it: we do not measure engagement on a newspaper story.
        </span>
      </p>
    </div>
  )
}
