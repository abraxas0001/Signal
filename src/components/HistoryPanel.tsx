import { useEffect, useRef } from 'react'
import * as m from 'motion/react-m'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import { Clock, Eye, Heart, MessageCircle, Trash2, X } from 'lucide-react'
import type { HistoryEntry } from '@/hooks/useHistory'
import { Button, Chip, Provenance, type ChipTone } from './ui'
import { PlatformBadge, youtubeThumb } from '@/components/kit'
import { SENTIMENT_TONE } from '@shared/taxonomy'
import type { Sentiment } from '@shared/taxonomy'
import { ease, listItem, listStagger, spring } from '@/lib/motion'
import { compact, relativeTime } from '@/lib/utils'
import { downloadCsv, downloadWorkbook } from '@/lib/export'
import { ExportButton } from '@/components/ExportButton'
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
  const reduced = useReducedMotion() === true

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
            className="fixed inset-x-0 bottom-0 z-50 max-h-[86svh] overflow-y-auto rounded-t-[var(--radius-2xl)] border-t border-[var(--border)] bg-[var(--surface)] scroller"
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: '100%' }}
            /**
             * Gated here, not in CSS.
             *
             * index.css's `prefers-reduced-motion` block sets
             * `animation-duration` and `transition-duration`, which are CSS
             * properties — they do nothing to a JavaScript spring driving `y`.
             * So this panel slid up at full travel for a reader who had asked
             * the system for less motion, and the app looked like it ignored
             * the setting. It did.
             */
            transition={reduced ? { duration: 0 } : spring.settle}
            /**
             * NO `drag` props.
             *
             * There were four here — `drag="y"`, `dragConstraints`,
             * `dragElastic` and `onDragEnd` — and not one of them ever fired.
             * The app mounts `<LazyMotion features={domAnimation}>`, and the
             * package builds that bundle as `animations + gestureAnimations`;
             * `drag` ships only in `domMax`. So this read as a
             * swipe-to-dismiss sheet in the source and was a plain sheet on the
             * device. Removed rather than fixed: pulling in `domMax` would put
             * the drag and projection bundles on a mid-range Android to buy one
             * gesture that the scrim, the close button and Escape already cover.
             */
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
                Opening one re-runs the analysis.
              </p>

              {/* An empty sheet used to be just the header over blank space,
                  which read as a loading failure. One quiet, honest row. */}
              {entries.length === 0 && (
                <div className="mt-4 flex items-center gap-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4">
                  <span
                    className="icon-badge-sm"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <Clock size={15} aria-hidden />
                  </span>
                  <p className="text-sm leading-relaxed text-ink-2">
                    Nothing analysed yet. Reports land here as you run them.
                  </p>
                </div>
              )}

              <m.ul className="mt-4 space-y-2" variants={listStagger} initial="hidden" animate="show">
                {entries.map((e) => {
                  const tone =
                    TONE_TO_CHIP[SENTIMENT_TONE[e.sentiment as Sentiment] ?? 'neutral'] ?? 'neutral'
                  // Stored posts carry no imagery except what the snapshot
                  // kept — but a YouTube URL names its own thumbnail, so a
                  // row is never a grey square when the platform hands us a
                  // still for free.
                  const thumb = e.thumbnail ?? youtubeThumb(e.url)
                  const eng = e.report.snapshot.engagement
                  // Carry each metric whole, not just its value: `source` is
                  // what keeps a measured like count from reading like an
                  // estimated one. Provenance stays silent for the measured
                  // majority and speaks only on the figures a reader must not
                  // mistake for exact.
                  const minis = [
                    { key: 'likes', Icon: Heart, metric: eng.likes },
                    { key: 'comments', Icon: MessageCircle, metric: eng.comments },
                    { key: 'views', Icon: Eye, metric: eng.views },
                  ].filter((f) => f.metric.value != null)
                  return (
                    <m.li key={e.id} variants={listItem}>
                      <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-2.5">
                        <button
                          onClick={() => onOpen(e)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="relative shrink-0">
                            {thumb ? (
                              <img
                                src={thumb}
                                alt=""
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                className="size-14 rounded-[var(--radius-md)] object-cover"
                              />
                            ) : (
                              <span className="grid size-14 place-items-center rounded-[var(--radius-md)] bg-[var(--surface-3)]">
                                <PlatformBadge platform={e.platform} size={24} />
                              </span>
                            )}
                            {thumb && (
                              <span className="absolute -bottom-1 -right-1">
                                <PlatformBadge
                                  platform={e.platform}
                                  size={16}
                                  className="ring-2 ring-[var(--surface-2)]"
                                />
                              </span>
                            )}
                          </span>

                          <span className="min-w-0 flex-1">
                            <span
                              className="line-clamp-2 block text-sm font-semibold leading-snug"
                              lang={e.report.snapshot.content.languageCode ?? undefined}
                            >
                              {e.headline}
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-2xs text-ink-3">
                              {e.sentiment && (
                                <Chip tone={tone} className="!px-1.5 !py-0.5 !text-[10px]">
                                  {e.sentiment}
                                </Chip>
                              )}
                              {minis.map(({ key, Icon, metric }) => (
                                <span key={key} className="inline-flex items-center gap-0.5 tabular-nums">
                                  <Icon size={10} aria-hidden />
                                  {compact(metric.value)}
                                  <Provenance source={metric.source} className="ml-0.5" />
                                </span>
                              ))}
                              {relativeTime(e.createdAt)}
                            </span>
                          </span>
                        </button>

                        <button
                          onClick={() => onRemove(e.id)}
                          aria-label="Remove from history"
                          className="grid size-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-3)] hover:text-[var(--neg)]"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </m.li>
                  )
                })}
              </m.ul>

              {entries.length > 0 && (
                <div className="mt-4 space-y-2">
                  {/* Exporting the whole history is the one that matters: it
                      turns a session of one-off lookups into the weekly sheet
                      this team already files. */}
                  <ExportButton
                    className="w-full [&>div]:w-full [&>div>button]:flex-1"
                    size="md"
                    count={entries.length}
                    noun="post"
                    run={(format) => {
                      const reports = entries.map((e) => e.report)
                      return format === 'csv' ? downloadCsv(reports) : downloadWorkbook(reports)
                    }}
                  />
                  <Button variant="ghost" onClick={onClear} className="w-full">
                    Clear all
                  </Button>
                </div>
              )}
            </div>
          </m.aside>
        </>
      )}
    </AnimatePresence>
  )
}
