import * as m from 'motion/react-m'
import { Gauge, LayoutGrid, GitCompareArrows, Clock, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'

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
 * Everything animates on transform and opacity only. This bar is fixed and
 * composited above scrolling content, so animating width, height or a
 * box-shadow here would repaint the whole surface on a device that cannot
 * afford it.
 */

export type Tab = 'dashboard' | 'accounts' | 'analyse' | 'compare' | 'history'

interface Props {
  active: Tab
  onSelect: (tab: Tab) => void
  /** Shown as a badge on History. */
  historyCount?: number
}

const SIDE = [
  { id: 'dashboard' as const, label: 'Dashboard', Icon: Gauge },
  { id: 'accounts' as const, label: 'Accounts', Icon: LayoutGrid },
  { id: 'compare' as const, label: 'Compare', Icon: GitCompareArrows },
  { id: 'history' as const, label: 'History', Icon: Clock },
]

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

export function TabBar({ active, onSelect, historyCount = 0 }: Props) {
  return (
    <nav
      aria-label="Main"
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 no-print',
        'border-t border-[var(--border)] bg-[var(--surface-1)]/88 backdrop-blur-xl',
      )}
      style={{ paddingBottom: 'var(--sab)' }}
    >
      <div className="mx-auto flex w-full max-w-2xl items-end gap-1 px-2 pb-1 pt-1">
        {SIDE.slice(0, 2).map((t) => (
          <TabButton
            key={t.id}
            label={t.label}
            Icon={t.Icon}
            active={active === t.id}
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
            active={active === t.id}
            badge={t.id === 'history' ? historyCount : undefined}
            onClick={() => onSelect(t.id)}
          />
        ))}
      </div>
    </nav>
  )
}
