import * as m from 'motion/react-m'
import { Gauge, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BAR_SIDE, type Tab } from '@/lib/nav'

/**
 * The bottom navigation.
 *
 * This product is used one-handed, on a mid-range Android, often outdoors. That
 * puts every primary action within reach of a thumb at the bottom of the screen
 * rather than in a header the hand has to stretch for.
 *
 * The centre slot is raised and is the one thing this product does: paste a
 * link, get a reading. It is deliberately the largest target and the only one
 * carrying the accent fill, because a tab bar where everything looks equally
 * important tells the user nothing about what to do first.
 *
 * There are TEN destinations and five slots, and this comment used to say eight
 * and two. That undercount is why the rule it stated stopped working: it also
 * said the rest "are reached from the dashboard", and the dashboard does not
 * keep that promise on an empty desk — of its seventeen navigation call sites
 * exactly one is unconditional, and Settings' only route runs when the news
 * scan is BROKEN. Five screens were reachable by no route at all at 360px.
 *
 * The same comment argued that a "More" button "would mean the bar had failed
 * to choose". The bar did choose, and its four daily screens are unchanged. It
 * is the delegation that failed — and an app whose overflow menu appears only
 * when a fetch fails already had one, just an invisible one. So slot five is
 * now a labelled door, and `lib/nav.ts` makes the compiler check that every
 * destination is behind one.
 *
 * Everything animates on transform and opacity only. This bar is fixed and
 * composited above scrolling content, so animating width, height or a
 * box-shadow here would repaint the whole surface on a device that cannot
 * afford it.
 */

/** Re-exported so existing importers keep working; it is owned by lib/nav.ts. */
export type { Tab }

interface Props {
  active: Tab
  onSelect: (tab: Tab) => void
  /** Unreviewed grievance records and unacknowledged mentions. */
  counts?: Partial<Record<Tab, number>>
}

/**
 * Four side slots and the raised centre. The fifth used to be History; it is
 * now More, and History moved into the sheet behind it.
 *
 * History was the weakest of the five: it is a log of past readings, looked at
 * occasionally, while Settings — which shares its new home — could not be
 * opened on a phone at all. Swapping which of the two is one tap away and which
 * is two costs the reader almost nothing and buys five screens a route.
 */
const SIDE = BAR_SIDE

function TabButton({
  label,
  Icon,
  active,
  badge,
  onClick,
}: {
  label: string
  Icon: typeof Gauge
  active: boolean
  badge?: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        // 56px of height on a control a thumb hits while walking.
        'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl',
        'transition-colors duration-200',
        active ? 'text-[var(--accent)]' : 'text-ink-3 hover:text-ink-2',
      )}
    >
      <span className="relative">
        <Icon size={20} strokeWidth={active ? 2.4 : 1.9} />
        {badge != null && badge > 0 && (
          <span className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-semibold leading-4 text-[var(--accent-fg)]">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className="text-[11px] font-medium leading-none">{label}</span>

      {/* The active mark. Scaled rather than grown, and it is not the only
          signal — colour, stroke weight and aria-current all say the same
          thing, so it still reads without colour vision. */}
      <m.span
        aria-hidden
        className="absolute inset-x-4 top-0 h-0.5 origin-center rounded-full bg-[var(--accent)]"
        initial={false}
        animate={{ scaleX: active ? 1 : 0, opacity: active ? 1 : 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      />
    </button>
  )
}

export function TabBar({ active, onSelect, counts }: Props) {
  // Overflow screens light the More slot instead of borrowing the dashboard's,
  // so the bar always shows where the reader actually is. `personas` is
  // unlisted, and falls back to the dashboard because it has no slot at all.
  const lit = (id: Tab): boolean => active === id || (id === 'dashboard' && active === 'personas')

  return (
    <nav
      aria-label="Main"
      className={cn(
        // Hidden from lg up: at that width the sidebar is the navigation.
        // Material's adaptive-navigation rule is explicit that large screens
        // prefer a sidebar, and showing both is the mixed-patterns mistake —
        // two controls answering the same question in one viewport.
        'fixed inset-x-0 bottom-0 z-30 no-print lg:hidden',
        'border-t border-[var(--border)] bg-[var(--surface-1)]/88 backdrop-blur-xl',
      )}
      style={{ paddingBottom: 'var(--sab)' }}
    >
      <div className="mx-auto flex w-full max-w-lg items-end gap-1 px-2 pb-1 pt-1">
        {SIDE.slice(0, 2).map((t) => (
          <TabButton
            key={t.id}
            label={t.label}
            Icon={t.Icon}
            active={lit(t.id)}
            badge={counts?.[t.id]}
            onClick={() => onSelect(t.id)}
          />
        ))}

        {/* The centre: the whole product in one control. */}
        <div className="flex flex-1 justify-center">
          <m.button
            onClick={() => onSelect('analyse')}
            aria-label="Analyse a link"
            aria-current={active === 'analyse' ? 'page' : undefined}
            whileTap={{ scale: 0.93 }}
            transition={{ type: 'spring', stiffness: 520, damping: 30 }}
            className={cn(
              'relative -translate-y-3 grid size-14 place-items-center rounded-2xl',
              'bg-[var(--accent)] text-[var(--accent-fg)]',
              'shadow-lg shadow-[var(--accent)]/35',
              'ring-4 ring-[var(--surface-1)]',
            )}
          >
            <Link2 size={22} strokeWidth={2.3} />
            {/* A quiet pulse so the primary action reads as the live one. It is
                transform-only and stops when the user asks for less motion. */}
            <m.span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-2xl bg-[var(--accent)] opacity-0 motion-reduce:hidden"
              animate={{ scale: [1, 1.35], opacity: [0.35, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
            />
          </m.button>
        </div>

        {SIDE.slice(2).map((t) => (
          <TabButton
            key={t.id}
            label={t.label}
            Icon={t.Icon}
            active={lit(t.id)}
            badge={counts?.[t.id]}
            onClick={() => onSelect(t.id)}
          />
        ))}
      </div>
    </nav>
  )
}
