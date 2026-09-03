import { useState } from 'react'
import { Info, Pencil, Plus, RefreshCw, X } from 'lucide-react'
import { Button } from '../ui'
import { absoluteDate, cn } from '@/lib/utils'

/**
 * "Keywords used" — the head of the grievance desk, from the reference sheet.
 *
 * The desk already had these words; it kept them behind a pencil in a settings
 * drawer, which meant the one question a reader asks about a list of issues —
 * "what did you search for to get this?" — was answered two clicks away. The
 * reference puts them on the face of the screen as removable chips, and that
 * is the right call: a scan is only as trustworthy as its search terms, and an
 * office that cannot see them cannot correct them.
 *
 * Two figures ride with it, and both are counts rather than claims. The source
 * count is how many papers this desk is actually set to read, and the stamp is
 * when they were last read. A desk that has never scanned says so instead of
 * showing a date, because "not yet" and "a while ago" are different states and
 * only one of them means something is wrong.
 */

export function KeywordsPanel({
  terms,
  sources,
  lastScanAt,
  onRemove,
  onAdd,
  onManage,
  onRescan,
}: {
  /** The words the scan searches on. */
  terms: string[]
  /** How many papers this desk is set to read. */
  sources: number
  /** When they were last read, or null when never. */
  lastScanAt: string | null
  onRemove?: (term: string) => void
  onAdd?: (term: string) => void
  onManage?: () => void
  onRescan?: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const commit = (): void => {
    const next = draft.trim()
    if (next.length > 0 && onAdd) onAdd(next)
    setDraft('')
    setAdding(false)
  }

  return (
    <div className="border-b border-[var(--rule)] pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold tracking-[-0.012em]">
            Keywords used <span className="font-normal text-ink-3">(editable)</span>
          </h2>
          <p className="mt-0.5 max-w-[44ch] text-[12.5px] leading-relaxed text-ink-3">
            These keywords were used across news portals to gather the issues.
          </p>
        </div>
        {onManage && (
          <Button size="sm" variant="outline" className="shrink-0" onClick={onManage}>
            <Pencil size={14} />
            Manage keywords
          </Button>
        )}
      </div>

      {terms.length === 0 ? (
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
          No search words are set, so a scan would have nothing to look for. Add the member&rsquo;s
          name, the seat, and the issues the office follows.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {terms.map((term) => (
            <span
              key={term}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] py-1 pl-2.5 pr-1.5 text-[11.5px] font-medium text-ink-2"
            >
              {term}
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(term)}
                  aria-label={`Remove ${term} from the search words`}
                  className="grid size-4 place-items-center rounded-full text-ink-3 transition-colors hover:bg-[var(--surface)] hover:text-ink"
                >
                  <X size={11} aria-hidden />
                </button>
              )}
            </span>
          ))}

        </div>
      )}

      {onAdd && (
        <div className="mt-2">
          {adding ? (
              <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--accent)] bg-[var(--surface)] py-0.5 pl-2.5 pr-1">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit()
                    if (e.key === 'Escape') {
                      setDraft('')
                      setAdding(false)
                    }
                  }}
                  onBlur={commit}
                  placeholder="new word"
                  maxLength={40}
                  className="w-28 bg-transparent text-[11.5px] font-semibold outline-none placeholder:font-normal placeholder:text-ink-3"
                />
              </span>
          ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-[8px] border border-[color-mix(in_oklab,var(--accent)_28%,transparent)]',
                  'bg-[var(--accent-soft)] px-2.5 py-1.5 text-[11.5px] font-semibold text-[var(--accent)] transition-colors hover:border-[var(--accent)]',
                )}
              >
                <Plus size={12} aria-hidden />
                Add keyword
            </button>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[11.5px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <Info size={13} aria-hidden />
          {sources > 0
            ? `Searched in ${sources} news ${sources === 1 ? 'source' : 'sources'}`
            : 'No news sources chosen yet'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <RefreshCw size={13} aria-hidden />
          {lastScanAt ? (
            <>Last updated {absoluteDate(lastScanAt)}</>
          ) : (
            <>Never scanned</>
          )}
          {onRescan && (
            <button
              type="button"
              onClick={onRescan}
              className="ml-1 font-semibold text-[var(--accent)]"
            >
              Scan now
            </button>
          )}
        </span>
      </div>
    </div>
  )
}
