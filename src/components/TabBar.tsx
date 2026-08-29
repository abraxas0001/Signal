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
 * The bar floats: a white pill-cornered card inset 12px from every edge,
 * riding the soft --e3 shadow, the way the reference dashboards float their
 * chrome instead of welding it to the viewport. The safe-area inset is added
 * to the 12px so the whole card clears an iPhone home indicator.
 *
 * The centre slot is raised and is the one thing this product does: paste a
 * link, get a reading. It is deliberately the largest target and the only one
 * carrying the accent gradient, because a tab bar where everything looks
 * equally important tells the user nothing about what to do first.
 *
 * There are TEN destinations and five slots. The product owner's cut is the
 * one drawn in `lib/nav.ts`: the two daily reads on the left, Influencers and
 * Compare on the right, Analyse in the centre. Settings left the bar for the
 * More sheet, and its "Your desk's tools" list is still the unconditional
 * route to the screens with no slot at all — the compiler check in nav.ts
 * holds every destination to having one.
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
  /** Row badges. A key that is absent or zero shows no badge. */
  counts?: Partial<Record<Tab, number>>
}

/**
 * Four side slots and the raised centre: dashboard, grievances | analyse |
 * influencers, compare. Derived from BAR so this file cannot drift from the
 * list the compiler checks.
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
        // 48px of height on a control a thumb hits while walking — the bar is
        // a floating card now, so its own height has to stay near --tabbar-h
        // or everything anchored above it miscalculates its clearance.
        'relative flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-xl',
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
      <span className="tab-label">{label}</span>

      {/* The active mark: a tiny dot under the label, scaled rather than
          grown, and not the only signal — colour, stroke weight and
          aria-current all say the same thing, so it still reads without
          colour vision. Positioned by calc, not a translate class, because
          motion owns this element's transform. */}
      <m.span
        aria-hidden
        className="absolute bottom-0.5 left-[calc(50%-2px)] size-1 rounded-full bg-[var(--accent)]"
        initial={false}
        animate={{ scale: active ? 1 : 0, opacity: active ? 1 : 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      />
    </button>
  )
}

export function TabBar({ active, onSelect, counts }: Props) {
  // Settings and its tool screens light nothing here: Settings left the bar
  // for the More sheet, whose own row carries the lit state for all of them.
  // A bar slot lit for a screen it does not open would be worse than none.
  const lit = (id: Tab): boolean => active === id

  return (
    <nav
      aria-label="Main"
      className={cn(
        // Hidden from lg up: at that width the sidebar is the navigation.
        // Material's adaptive-navigation rule is explicit that large screens
        // prefer a sidebar, and showing both is the mixed-patterns mistake —
        // two controls answering the same question in one viewport.
        'fixed inset-x-3 z-30 mx-auto w-auto max-w-lg no-print lg:hidden',
        'rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--e3)]',
      )}
      style={{ bottom: 'calc(var(--sab) + 12px)' }}
    >
      <div className="flex w-full items-end gap-1 px-2 py-1">
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

        {/* The centre: the whole product in one control. The lift lives on a
            plain wrapper span, not the motion button — motion owns the
            button's transform, and a whileTap scale would silently erase a
            translate utility the first time it fired. */}
        <div className="flex flex-1 justify-center">
          <span className="block -translate-y-4">
            <m.button
              onClick={() => onSelect('analyse')}
              aria-label="Analyse a link"
              aria-current={active === 'analyse' ? 'page' : undefined}
              whileTap={{ scale: 0.93 }}
              transition={{ type: 'spring', stiffness: 520, damping: 30 }}
              className={cn(
                'relative grid size-14 place-items-center rounded-full text-white',
                'shadow-[0_2px_6px_rgb(16_24_40/0.12),0_12px_28px_-8px_color-mix(in_oklab,var(--accent)_65%,transparent)]',
                'ring-4 ring-[var(--surface)]',
              )}
              style={{ background: 'var(--grad-blue)' }}
            >
              <Link2 size={22} strokeWidth={2.3} />
              {/* A quiet pulse so the primary action reads as the live one. It is
                  transform-only and stops when the user asks for less motion. */}
              <m.span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full bg-[var(--accent)] opacity-0 motion-reduce:hidden"
                animate={{ scale: [1, 1.35], opacity: [0.35, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
              />
            </m.button>
          </span>
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
