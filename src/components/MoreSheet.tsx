import { useEffect, useRef } from 'react'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { X } from 'lucide-react'
import { Avatar } from './ui'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { ease, spring } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { OVERFLOW_GROUPS, badgeOf, isUnlisted, type Tab } from '@/lib/nav'
import { DemoDoor, type DemoDoorProps } from '@/components/DemoDoor'
import { isDemoScope, subscribe } from '@/lib/store'

/**
 * The desk's own sheet, on a phone: whose desk this is, the Settings row, the
 * example-desk door.
 *
 * Settings is back in `OVERFLOW_GROUPS` — it gave its bar slot to Influencers
 * when the product owner asked for that button back — so the loop below
 * renders it again, exactly as promised when the list was kept through its
 * empty spell: one edit in lib/nav.ts, no UI work here.
 *
 * The sheet's other three jobs never depended on the destination list: the
 * header avatar needs somewhere to open, the way out belongs behind the member's own
 * face, and the example desk needs a door on every width — the sidebar's is
 * lg:+ only.
 */

/**
 * The pill grammar, matching SideNav row for row so the phone and the laptop
 * disagree about nothing but width. Stated here rather than imported from
 * lib/nav because lib/* is shared surface this redesign does not touch — if
 * the two ever drift, SideNav is the reference.
 */
const PILL_FOCUS =
  'focus-visible:rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]'
const PILL_ROW =
  'flex min-h-12 w-full items-center gap-3 rounded-full text-left transition-colors duration-200'
const PILL_ACTIVE =
  'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_1px_2px_rgb(16_24_40/0.1),0_8px_20px_-6px_color-mix(in_oklab,var(--accent)_55%,transparent)]'
const PILL_IDLE = 'text-ink-2 hover:bg-[var(--surface-2)] hover:text-ink'

export function MoreSheet({
  open,
  active,
  counts,
  onSelect,
  onClose,
  demo,
  person,
}: {
  open: boolean
  active: Tab
  counts?: Partial<Record<Tab, number>>
  onSelect: (t: Tab) => void
  onClose: () => void
  /** Omitted when there is no account to lock, and then no lock row. */
  /**
   * The example desk, if there is one to offer. Identical shape to SideNav's,
   * and App passes both surfaces the same binding — the sidebar is `lg:`+ only,
   * so without this every phone would be left without a door.
   */
  demo?: DemoDoorProps
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
            className="scroller fixed inset-x-0 bottom-0 z-50 max-h-[86svh] overflow-y-auto rounded-t-[var(--radius-xl)] bg-[var(--surface)] shadow-[var(--e4)] lg:hidden"
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: '100%' }}
            // The CSS reduced-motion rule only damps CSS durations, so a JS
            // spring on `y` ignores it. Gated here instead of assumed.
            transition={reduced ? { duration: 0 } : spring.settle}
          >
            <div className="sticky top-0 z-10 flex justify-center bg-[var(--surface)] pb-1 pt-3">
              <div className="h-1.5 w-10 rounded-full bg-[var(--border-strong)]" aria-hidden />
            </div>

            <div className="px-4 pb-[calc(var(--sab)+20px)] pt-2">
              <div className="flex items-start justify-between gap-3">
                {/* Whose desk this is, first. The sheet opens from the member's
                    own face in the header, so it should carry on saying so
                    rather than opening on an abstract noun. */}
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar src={person?.photoUrl} name={person?.name ?? 'Signal'} size={44} />
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold tracking-[-0.011em]">
                      {person?.name ?? 'Your desk'}
                    </h2>
                    {subtitle && (
                      <p className="truncate text-xs text-ink-3">{subtitle}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className={cn(
                    '-mr-1 grid size-11 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-ink-3 shadow-[var(--e1)] transition-colors hover:bg-[var(--surface-2)]',
                    PILL_FOCUS,
                  )}
                >
                  <X size={19} />
                </button>
              </div>

              {OVERFLOW_GROUPS.map((group) => (
                <div key={group.heading} className="mt-6">
                  <p aria-hidden className="kicker px-4 pb-2">
                    {group.heading}
                  </p>
                  <ul aria-label={group.heading} className="space-y-1">
                    {group.items.map((item) => {
                      const badge = badgeOf(counts?.[item.id])
                      // The tool screens open from Settings' own list and have
                      // no row anywhere on the phone, so the Settings row here
                      // stays lit while one of them is open — the same rule
                      // the sidebar's foot card applies.
                      const isActive =
                        active === item.id || (item.id === 'settings' && isUnlisted(active))
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
                              PILL_ROW,
                              PILL_FOCUS,
                              'pl-4 pr-3',
                              isActive ? PILL_ACTIVE : PILL_IDLE,
                            )}
                          >
                            <item.Icon
                              size={18}
                              strokeWidth={isActive ? 2.4 : 1.9}
                              className="shrink-0"
                              aria-hidden
                            />
                            <span
                              className={cn(
                                'min-w-0 flex-1 truncate text-sm',
                                isActive ? 'font-semibold' : 'font-medium',
                              )}
                            >
                              {item.label}
                            </span>
                            {badge && (
                              <span
                                aria-hidden
                                className={cn(
                                  'tnum grid min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-2xs font-bold leading-5',
                                  // Inverted on the filled pill, or the count
                                  // would vanish into its own colour.
                                  isActive
                                    ? 'bg-[var(--accent-fg)] text-[var(--accent)]'
                                    : 'bg-[var(--accent)] text-[var(--accent-fg)]',
                                )}
                              >
                                {badge}
                              </span>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}

              {/* The way out of the desk, where the sidebar also puts it —
                  last, under a rule, away from the destinations.
                  
                  There was a second control here called "Lock", which signed
                  the account out. Two rows for one action, and the one whose
                  label nobody could read was the one that did it. `demo` is
                  now that door for every kind of session — Logout on an
                  account and on a handed-over desk, Leave the demo in the
                  example one — so there is one row and it says what it does. */}
              {demo && (
                <div className="mt-6 space-y-2 border-t border-[var(--border)] pt-3">
                  {demo && (
                    <DemoDoor
                      {...demo}
                      /* The sheet closes only if the scope actually moved.
                         A naive `onClose(); onClick()` would shut the sheet
                         even when the reader cancelled the sign-out
                         confirmation — costing them the menu they were in the
                         middle of using, for a choice they declined. Asking
                         the store where it is now beats threading a boolean
                         back through the callback. */
                      onClick={() => {
                        /**
                         * Subscribed, not awaited.
                         *
                         * App hands this down as `() => void openDemo()`, which
                         * returns undefined immediately — so a `.then` on it
                         * resolves one microtask later, long before
                         * `enterDemoMode` has finished awaiting the roster
                         * fetch. The scope was always still unchanged at that
                         * point and the sheet never closed. Listening to the
                         * store instead closes it exactly when the namespace
                         * moves, however long that takes, and the unsubscribe
                         * timer stops a cancelled confirmation from leaving a
                         * listener behind.
                         */
                        const want = demo.mode === 'enter'
                        if (isDemoScope() === want) {
                          demo.onClick()
                          onClose()
                          return
                        }
                        const stop = subscribe(() => {
                          if (isDemoScope() !== want) return
                          stop()
                          clearTimeout(giveUp)
                          onClose()
                        })
                        const giveUp = setTimeout(stop, 15_000)
                        demo.onClick()
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </m.aside>
        </>
      )}
    </AnimatePresence>
  )
}
