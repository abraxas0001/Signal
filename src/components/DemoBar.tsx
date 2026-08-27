/**
 * The example desk's three pieces of furniture, each where it belongs.
 *
 *   DemoBar      a row of names above the dashboard. Change desks, or leave.
 *   DemoPairing  why this rival — on Compare, where the rival is the subject.
 *   DemoNote     the "worked examples" caveat — on Grievances and Tasks, the
 *                only two screens it is true of.
 *
 * They started as one card stacked above the dashboard, and that was the
 * problem: a heading, a paragraph and a panel, all of it restating the person
 * the dashboard names in its own much larger heading a few pixels below. The
 * caption arrived before the thing it captioned, and the work began half a page
 * down. Splitting them puts each next to what it describes, and leaves the top
 * of the screen to the switcher alone.
 *
 * The demo still says it is a demo — but on the screens where that changes how
 * something should be read, rather than as a banner over everything. A
 * disclaimer attached to data it is not about teaches a reader to distrust the
 * real figures too.
 */

import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Swords, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { partyColor } from '@/components/gazetteer'
import {
  applyPrincipal,
  principalsOf,
  readChoice,
  saveChoice,
  type DemoRoster,
} from '@/lib/demo-roster'

export function DemoBar({
  roster,
  onSwitched,
  onExit,
}: {
  roster: DemoRoster
  /** Fired after the tracked list is rewritten, so the screen can remount. */
  onSwitched: (principalKey: string) => void
  /** Clears the demo and hands the reader an empty desk of their own. */
  onExit: () => void
}) {
  const entries = useMemo(() => principalsOf(roster), [roster])
  const [active, setActive] = useState<string>(
    () => readChoice() ?? entries[0]?.person.key ?? '',
  )

  // Keep the selection valid if the dataset is rebuilt with a different roster.
  useEffect(() => {
    if (entries.length > 0 && !entries.some((e) => e.person.key === active)) {
      setActive(entries[0]!.person.key)
    }
  }, [entries, active])

  const current = entries.find((e) => e.person.key === active) ?? entries[0]
  if (!current) return null

  function choose(key: string) {
    if (key === active) return
    setActive(key)
    saveChoice(key)
    applyPrincipal(roster, key)
    onSwitched(key)
  }

  const collected = roster.generatedAt ? new Date(roster.generatedAt) : null

  /**
   * A row of names and a way out. Nothing else.
   *
   * This was a card: an icon badge, a heading, a paragraph saying what was real
   * and what was illustrative, and a panel repeating the person's name, role
   * and why their rival was chosen. All of it sat ABOVE the dashboard, which
   * opens by naming the same person in a much larger heading and stating the
   * same seat in its own chips — so the first screenful was a caption for the
   * screenful below it, and the actual work started half a page down.
   *
   * Everything that was here still exists, moved to where it means something:
   * the pairing rationale to the Compare screen, where the rival is the subject
   * rather than an aside, and the "worked examples" caveat to the Grievances
   * and Tasks screens, which are the only places it applies. What is left is
   * the one thing this bar alone can do.
   */
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="tablist"
      aria-label="Example desk: whose desk to show"
    >
      {entries.map(({ person }) => {
        const on = person.key === active
        return (
          <button
            key={person.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => choose(person.key)}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition',
              on
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-ink'
                : 'border-[var(--border)] bg-[var(--surface)] text-ink-2 hover:border-[var(--border-strong)]',
            )}
          >
            {/* Party colour on the dot rather than the whole chip, so five of
                these together read as one control instead of a rainbow. */}
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: partyColor(person.party) }}
              aria-hidden
            />
            <span className="whitespace-nowrap">{person.name}</span>
          </button>
        )
      })}

      {/* The way out. Quiet, and last, but never absent: without it there is no
          way off the example desk short of clearing site data. */}
      <button
        type="button"
        onClick={onExit}
        title={
          collected
            ? `Example desk. Posts and followers collected ${collected.toLocaleDateString()}.`
            : 'Example desk.'
        }
        className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs text-ink-3 transition-colors hover:text-[var(--accent)]"
      >
        <RefreshCw size={13} aria-hidden />
        Use my own accounts
      </button>
    </div>
  )
}

/**
 * The caveat, on the two screens it applies to.
 *
 * The posts, followers and engagement everywhere else are real, read off live
 * profiles. These two screens are not: a grievance caseload is what the
 * analysis pipeline produces from news and comments, and nothing scraped
 * contains an office's private workload. So it is written — and written to make
 * no claim about any named person, which is why every record is a service
 * matter addressed to a department.
 *
 * It belongs here rather than on the dashboard. On the dashboard it was a
 * disclaimer attached to data it was not about, which teaches a reader to
 * distrust the real figures too; here it sits on the thing it describes.
 */
export function DemoNote() {
  return (
    <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-ink-3">
      <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
      <span>
        Example records. Posts, followers and engagement elsewhere are real.
      </span>
    </p>
  )
}

/**
 * Why this rival, shown where the comparison is.
 *
 * Rendered on the Compare screen rather than the dashboard. "He was her
 * runner-up in Mahabubnagar in 2024, losing by roughly 4,500 votes" is the
 * sentence that makes a comparison worth reading — but it is an answer to a
 * question the reader only asks once they are looking at the comparison, and on
 * the dashboard it was a caption on something else entirely.
 */
export function DemoPairing({ roster }: { roster: DemoRoster }) {
  const entries = useMemo(() => principalsOf(roster), [roster])
  const key = readChoice() ?? entries[0]?.person.key
  const current = entries.find((e) => e.person.key === key)
  if (!current || current.rivals.length === 0) return null

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="icon-badge shrink-0" style={{ background: 'var(--accent-soft)' }}>
          <Swords size={18} style={{ color: 'var(--accent)' }} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="hed text-base">
            {current.person.name} is measured against{' '}
            {current.rivals.length === 1 ? 'one rival' : `${current.rivals.length} rivals`}
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
            <span
              className="size-2 rounded-full"
              style={{ background: partyColor(current.person.party) }}
              aria-hidden
            />
            {current.person.role}
          </p>

          {/* One row each, with the reason. Almost nobody in politics has
              exactly one opponent, and the reason is what makes a comparison
              worth reading rather than a chart of two numbers. */}
          <ul className="mt-3 space-y-2.5">
            {current.rivals.map(({ person, why }) => (
              <li key={person.key} className="flex items-start gap-2.5">
                <span
                  className="mt-1.5 size-2 shrink-0 rounded-full"
                  style={{ background: partyColor(person.party) }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {person.name}
                    <span className="font-normal text-ink-3"> · {person.role}</span>
                  </p>
                  {why && <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{why}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
