import { useEffect, useRef } from 'react'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { Lock, X } from 'lucide-react'
import { Avatar } from './ui'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { ease, spring } from '@/lib/motion'
import { cn } from '@/lib/utils'
import {
  OVERFLOW_GROUPS,
  NAV_ACTIVE,
  NAV_FOCUS,
  NAV_IDLE,
  badgeOf,
  type Tab,
} from '@/lib/nav'

/**
 * The rest of the app, on a phone.
 *
 * The bottom bar has five slots and this product has ten destinations. Four of
 * them plus the raised Analyse control earn a permanent place; the rest were
 * supposed to be reached from the dashboard, and measurably were not — of the
 * dashboard's seventeen navigation call sites exactly one is unconditional, and
 * Settings' only route sits inside a branch that runs when the news scan is
 * BROKEN. So on a working desk, Settings could not be opened at all.
 *
 * THE OBJECTION THIS OVERRIDES, because it is written down and deserves an
 * answer rather than a silent edit. TabBar says: "it is why there is no 'More'
 * button: an overflow menu would mean the bar had failed to choose."
 *
 * That was right about a smaller problem. It counts eight destinations and two
 * delegated; there are ten and five, and one of the five is Settings. And the
 * bar did choose — what failed was the counterparty. The comment names a
 * contract, "they are reached from the dashboard", which the dashboard does not
 * keep on an empty desk. The app therefore already HAD an overflow menu: an
 * invisible one that appeared only when a fetch failed. A labelled door is not
 * a worse answer than that; it is the same answer, made honest.
 *
 * The four daily screens and the primary action are untouched. This adds a
 * door, it does not re-rank anything.
 */
export function MoreSheet({
  open,
  active,
  counts,
  onSelect,
  onClose,
  onLock,
  person,
}: {
  open: boolean
  active: Tab
  counts?: Partial<Record<Tab, number>>
  onSelect: (t: Tab) => void
  onClose: () => void
  /** Omitted when there is no account to lock, and then no lock row. */
  onLock?: () => void
  /** Who the desk is for, shown at the top so the sheet has an owner. */
  person?: { name: string; photoUrl?: string | null; role?: string | null; constituency?: string | null } | null
}) {
  const subtitle = [person?.role, person?.constituency].filter(Boolean).join(', ')
  const panelRef = useRef<HTMLElement>(null)
  const reduced = useReducedMotion() === true

  // aria-modal promises the rest of the page is inert; this makes that true.
  // Its cleanup returns focus to the control that opened the sheet, so closing
  // lands the reader back on the More button rather than at the top of the page.
  useFocusTrap(panelRef, open)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  /**
   * No `drag` props here, deliberately.
   *
   * HistoryPanel carries `drag="y"`, `dragConstraints`, `dragElastic` and
   * `onDragEnd`, and none of them has ever fired: the app mounts
   * `<LazyMotion features={domAnimation}>`, and drag lives in `domMax`.
   * Copying that block would have looked like a swipe-to-dismiss gesture and
   * been four dead props. Dismissal here is the scrim, a 44px close button and
   * Escape — three things that actually work.
   */
  return (
    <AnimatePresence>
      {open && (
        <>
          <m.div
            // lg:hidden throughout: above that width the sidebar is the
            // navigation and this must never appear beside it.
            className="fixed inset-0 z-40 bg-black/45 lg:hidden"
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
            aria-label="Your desk"
            className="scroller fixed inset-x-0 bottom-0 z-50 max-h-[86svh] overflow-y-auto rounded-t-[--radius-2xl] border-t border-[var(--border)] bg-[var(--surface)] lg:hidden"
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: '100%' }}
            // The CSS reduced-motion rule only damps CSS durations, so a JS
            // spring on `y` ignores it. Gated here instead of assumed.
            transition={reduced ? { duration: 0 } : spring.settle}
          >
            <div className="sticky top-0 z-10 flex justify-center bg-[var(--surface)] pb-1 pt-3">
              <div className="h-1 w-9 rounded-full bg-[var(--text-3)]/40" aria-hidden />
            </div>

            <div className="px-4 pb-[calc(var(--sab)+20px)] pt-2">
              <div className="flex items-start justify-between gap-3">
                {/* Whose desk this is, first. The sheet opens from the member's
                    own face in the header, so it should carry on saying so
                    rather than opening on an abstract noun. */}
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar src={person?.photoUrl} name={person?.name ?? 'Signal'} size={44} />
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold">{person?.name ?? 'Your desk'}</h2>
                    {subtitle && (
                      <p className="truncate text-xs text-ink-3">{subtitle}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className={cn('-mr-1 grid size-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-2)]', NAV_FOCUS)}
                >
                  <X size={19} />
                </button>
              </div>

              {OVERFLOW_GROUPS.map((group) => (
                <div key={group.heading} className="mt-5">
                  <p
                    aria-hidden
                    className="tracking-kicker px-1 pb-2 text-2xs font-semibold uppercase text-ink-3"
                  >
                    {group.heading}
                  </p>
                  <ul aria-label={group.heading} className="grid grid-cols-2 gap-2">
                    {group.items.map((item) => {
                      const badge = badgeOf(counts?.[item.id])
                      const isActive = active === item.id
                      return (
                        <li key={item.id}>
                          <button
                            onClick={() => {
                              onSelect(item.id)
                              onClose()
                            }}
                            aria-current={isActive ? 'page' : undefined}
                            aria-label={badge ? `${item.label}, ${badge}` : undefined}
                            className={cn(
                              // 72px tiles: two columns at 360px gives 160px of
                              // width each, which fits every label here without
                              // truncating.
                              'flex min-h-[72px] w-full flex-col items-start justify-center gap-1.5 rounded-xl border px-3 py-2 text-left transition-colors',
                              NAV_FOCUS,
                              isActive
                                ? cn(NAV_ACTIVE, 'border-[color-mix(in_oklab,var(--accent)_35%,transparent)]')
                                : cn(NAV_IDLE, 'border-[var(--border)]'),
                            )}
                          >
                            <span className="flex w-full items-center gap-2">
                              <item.Icon size={18} strokeWidth={isActive ? 2.4 : 1.9} aria-hidden />
                              {badge && (
                                <span
                                  aria-hidden
                                  className="tnum ml-auto grid min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1.5 text-2xs font-semibold leading-5 text-[var(--accent-fg)]"
                                >
                                  {badge}
                                </span>
                              )}
                            </span>
                            <span
                              className={cn(
                                'block truncate text-sm',
                                isActive ? 'font-semibold' : 'font-medium',
                              )}
                            >
                              {item.label}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}

              {/* The way out of the desk, where the sidebar also puts it —
                  last, under a rule, away from the destinations. */}
              {onLock && (
                <div className="mt-5 border-t border-[var(--border)] pt-3">
                  <button
                    onClick={() => {
                      onClose()
                      onLock()
                    }}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-ink-2 hover:bg-[var(--surface-2)] hover:text-ink',
                      NAV_FOCUS,
                    )}
                  >
                    <Lock size={16} strokeWidth={1.9} className="shrink-0" aria-hidden />
                    Lock
                  </button>
                </div>
              )}
            </div>
          </m.aside>
        </>
      )}
    </AnimatePresence>
  )
}
