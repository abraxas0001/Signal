import { useEffect, useRef } from 'react'
import * as m from 'motion/react-m'
import { AnimatePresence } from 'motion/react'
import { Trash2, X } from 'lucide-react'
import type { HistoryEntry } from '@/hooks/useHistory'
import { Button, Chip, type ChipTone } from './ui'
import { SENTIMENT_TONE } from '@shared/taxonomy'
import type { Sentiment } from '@shared/taxonomy'
import { ease, listItem, listStagger, spring } from '@/lib/motion'
import { relativeTime } from '@/lib/utils'
import { useFocusTrap } from '@/hooks/useFocusTrap'

const TONE_TO_CHIP: Record<string, ChipTone> = {
  positive: 'positive',
  negative: 'negative',
  mixed: 'warning',
  neutral: 'neutral',
}

/** Everything analysed on this device, newest first. */
export function HistoryPanel({
  open,
  entries,
  onClose,
  onOpen,
  onRemove,
  onClear,
}: {
  open: boolean
  entries: HistoryEntry[]
  onClose: () => void
  onOpen: (entry: HistoryEntry) => void
  onRemove: (id: string) => void
  onClear: () => void
}) {
  const panelRef = useRef<HTMLElement>(null)

  // aria-modal promises the rest of the page is inert; this makes that true.
  useFocusTrap(panelRef, open)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <>
          <m.div
            className="fixed inset-0 z-40 bg-black/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={ease.out}
            onClick={onClose}
          />

          <m.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="History"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[86svh] overflow-y-auto rounded-t-[--radius-2xl] border-t border-[var(--border)] bg-[var(--surface)] scroller"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={spring.settle}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 500) onClose()
            }}
          >
            <div className="sticky top-0 z-10 flex justify-center bg-[var(--surface)] pb-1 pt-3">
              <div className="h-1 w-9 rounded-full bg-[var(--text-3)]/40" />
            </div>

            <div className="px-4 pb-[calc(var(--sab)+20px)] pt-2">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">
                  History
                  <span className="ml-2 text-sm font-normal text-ink-3">
                    {entries.length}
                  </span>
                </h2>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="-mr-1 grid size-11 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-2)]"
                >
                  <X size={19} />
                </button>
              </div>

              <p className="mt-1 text-xs text-ink-3">
                Stored on this device only. Opening one re-runs it, because engagement counts move.
              </p>

              <m.ul className="mt-4 space-y-2" variants={listStagger} initial="hidden" animate="show">
                {entries.map((e) => {
                  const tone =
                    TONE_TO_CHIP[SENTIMENT_TONE[e.sentiment as Sentiment] ?? 'neutral'] ?? 'neutral'
                  return (
                    <m.li key={e.id} variants={listItem}>
                      <div className="flex items-center gap-3 rounded-[--radius-md] bg-[var(--surface-2)] p-2.5">
                        <button
                          onClick={() => onOpen(e)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          {e.thumbnail ? (
                            <img
                              src={e.thumbnail}
                              alt=""
                              loading="lazy"
                              className="size-11 shrink-0 rounded-[--radius-sm] object-cover"
                            />
                          ) : (
                            <span className="grid size-11 shrink-0 place-items-center rounded-[--radius-sm] bg-[var(--surface-3)] text-xs text-ink-3">
                              {e.platform.slice(0, 2)}
                            </span>
                          )}

                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 block text-sm font-medium leading-snug">
                              {e.headline}
                            </span>
                            <span className="mt-0.5 flex items-center gap-2 text-2xs text-ink-3">
                              <Chip tone={tone} className="!px-1.5 !py-0.5 !text-[10px]">
                                {e.sentiment}
                              </Chip>
                              {relativeTime(e.createdAt)}
                            </span>
                          </span>
                        </button>

                        <button
                          onClick={() => onRemove(e.id)}
                          aria-label="Remove from history"
                          className="grid size-10 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-3)] hover:text-[var(--neg)]"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </m.li>
                  )
                })}
              </m.ul>

              {entries.length > 0 && (
                <Button variant="ghost" onClick={onClear} className="mt-4 w-full">
                  Clear all
                </Button>
              )}
            </div>
          </m.aside>
        </>
      )}
    </AnimatePresence>
  )
}
