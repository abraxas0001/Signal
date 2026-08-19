import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import {
  Clock,
  GitCompareArrows,
  Inbox,
  LayoutGrid,
  Link2,
  ListChecks,
  Lock,
  Megaphone,
  Newspaper,
  Settings as SettingsIcon,
  UserSearch,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SignalGlyph } from '@/components/ui'
import { pressable, spring } from '@/lib/motion'

/**
 * The desktop navigation.
 *
 * A bottom bar is the right answer on a phone and the wrong one on a laptop:
 * pinned to the bottom of a 1440px screen it sits as far from the reading eye
 * as the layout allows, and it only has room for five things. This product has
 * eight. So from lg: up the navigation moves to a fixed left column and the
 * caller drops TabBar.
 *
 * Eight flat rows is a list, not a hierarchy. They are split by when they get
 * used: the screens the office opens every morning on top, the ones it goes
 * looking for below. Analyse sits above both and keeps the accent fill it has
 * in the tab bar — one product, one primary action, the same colour in both
 * layouts.
 *
 * Everything animates on transform and opacity. This column is fixed and
 * composited over the page background, so animating width or a box-shadow here
 * would repaint the whole strip.
 */

export type NavKey =
  | 'dashboard'
  | 'grievances'
  | 'personas'
  | 'influencers'
  | 'actions'
  | 'accounts'
  | 'compare'
  | 'analyse'
  | 'history'
  | 'settings'

interface Props {
  active: NavKey
  onSelect: (k: NavKey) => void
  /** Row badges. A key that is absent or zero shows no badge. */
  counts?: Partial<Record<NavKey, number>>
  /** Omitted when there is nothing to lock behind — then no lock control. */
  onLock?: () => void
}

interface NavItem {
  id: NavKey
  label: string
  Icon: typeof Newspaper
}

const GROUPS: ReadonlyArray<{ heading: string; items: readonly NavItem[] }> = [
  {
    heading: 'Today',
    items: [
      { id: 'dashboard', label: 'Dashboard', Icon: Newspaper },
      { id: 'grievances', label: 'Grievances', Icon: Inbox },
      { id: 'personas', label: 'People', Icon: UserSearch },
      { id: 'influencers', label: 'Influencers', Icon: Megaphone },
      { id: 'actions', label: 'Actions', Icon: ListChecks },
    ],
  },
  {
    heading: 'Reference',
    items: [
      { id: 'accounts', label: 'Accounts', Icon: LayoutGrid },
      { id: 'compare', label: 'Compare', Icon: GitCompareArrows },
      { id: 'history', label: 'History', Icon: Clock },
      { id: 'settings', label: 'Settings', Icon: SettingsIcon },
    ],
  },
]

/**
 * index.css rounds every :focus-visible target to --radius-xs, and that rule is
 * written after the utility layers, so it wins on source order. Without an
 * override the row's corners snap square the moment it takes keyboard focus,
 * which reads as a rendering fault rather than as focus.
 */
const FOCUS =
  'focus-visible:rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]'

/** 44px minimum on every row — this layout is also what a tablet gets. */
const ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-xl text-left transition-colors duration-200'

function NavRow({
  item,
  active,
  count,
  reduced,
  onSelect,
}: {
  item: NavItem
  active: boolean
  count: number | undefined
  reduced: boolean
  onSelect: (k: NavKey) => void
}) {
  const { id, label, Icon } = item
  const badge = count != null && count > 0 ? (count > 99 ? '99+' : String(count)) : null

  return (
    <button
      onClick={() => onSelect(id)}
      aria-current={active ? 'page' : undefined}
      // The badge is a bare number, so it is hidden from the reader and folded
      // into the name instead. No unit is added: the caller decides what it is
      // counting and this component does not get to guess.
      aria-label={badge ? `${label}, ${badge}` : undefined}
      className={cn(
        ROW,
        FOCUS,
        'relative pl-4 pr-2.5',
        active
          ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
          : 'text-ink-2 hover:bg-[var(--surface-2)] hover:text-ink',
      )}
    >
      {/* The active mark, turned on its side from the tab bar's. Colour is not
          carrying this alone — the rail, the heavier stroke, the bolder label
          and aria-current all say the same thing, so the row still reads
          without colour vision. */}
      <m.span
        aria-hidden
        className="absolute left-0 top-1/2 h-6 w-[3px] origin-center -translate-y-1/2 rounded-full bg-[var(--accent)]"
        initial={false}
        animate={{ scaleY: active ? 1 : 0, opacity: active ? 1 : 0 }}
        transition={reduced ? { duration: 0 } : spring.snap}
      />

      <Icon size={18} strokeWidth={active ? 2.4 : 1.9} className="shrink-0" aria-hidden />
      <span
        className={cn('min-w-0 flex-1 truncate text-sm', active ? 'font-semibold' : 'font-medium')}
      >
        {label}
      </span>

      {badge && (
        <span
          aria-hidden
          className="tnum grid min-w-5 shrink-0 place-items-center rounded-full bg-[var(--accent)] px-1.5 text-2xs font-semibold leading-5 text-[var(--accent-fg)]"
        >
          {badge}
        </span>
      )}
    </button>
  )
}

export function SideNav({ active, onSelect, counts, onLock }: Props) {
  const reduced = useReducedMotion() === true

  return (
    <m.nav
      aria-label="Main"
      initial={reduced ? false : { opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={spring.settle}
      className={cn(
        // Nothing below lg: the phone keeps TabBar, and two navigations on
        // screen at once is two answers to the same question.
        'no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col lg:flex',
        'border-r border-[var(--border)] backdrop-blur-xl',
      )}
      // TabBar and DataReport both reach for --surface-1; the stylesheet ships
      // --surface. The fallback means this column is a surface under either
      // name rather than letting the page background show straight through it.
      style={{
        background: 'color-mix(in oklab, var(--surface-1, var(--surface)) 88%, transparent)',
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-5">
        {/* The same lockup the mobile header carries. It was a gradient-filled
            rounded tile here, which made the app wear two different marks
            depending on the width of the window. */}
        <div className="mb-5 flex items-center gap-2.5 px-1">
          <span className="shrink-0 text-[var(--accent)]">
            <SignalGlyph size={24} />
          </span>
          <span className="hed text-[1.3rem] leading-none tracking-[-0.005em]">Signal</span>
        </div>

        {/* The one thing this product does, in the one colour that means "do
            this first". When it is the open screen it takes a ring rather than
            a different fill: it is already accent, so the state has to be a
            change of shape or it is invisible. */}
        <m.button
          onClick={() => onSelect('analyse')}
          aria-current={active === 'analyse' ? 'page' : undefined}
          {...(reduced ? {} : pressable)}
          className={cn(
            ROW,
            FOCUS,
            'px-3.5 text-sm font-semibold',
            'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--e2)]',
            active === 'analyse' &&
              'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface)]',
          )}
        >
          <Link2 size={18} strokeWidth={2.3} className="shrink-0" aria-hidden />
          Analyse a link
        </m.button>

        {/* Scrolls on its own so a short laptop window never pushes the lock
            control off the bottom of the column. */}
        <div className="scroller mt-6 min-h-0 flex-1 space-y-5 overflow-y-auto">
          {GROUPS.map((group) => (
            <div key={group.heading}>
              <p
                aria-hidden
                className="tracking-kicker px-4 pb-1.5 text-2xs font-semibold uppercase text-ink-3"
              >
                {group.heading}
              </p>
              <ul aria-label={group.heading} className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <NavRow
                      item={item}
                      active={active === item.id}
                      count={counts?.[item.id]}
                      reduced={reduced}
                      onSelect={onSelect}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {onLock && (
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <button
              onClick={onLock}
              className={cn(
                ROW,
                FOCUS,
                'px-4 text-sm font-medium',
                'text-ink-2 hover:bg-[var(--surface-2)] hover:text-ink',
              )}
            >
              <Lock size={16} strokeWidth={1.9} className="shrink-0" aria-hidden />
              Lock
            </button>
          </div>
        )}
      </div>
    </m.nav>
  )
}
