import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { ChevronRight, Link2, Settings as SettingsIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GROUPS, isUnlisted, type NavItem, type Tab } from '@/lib/nav'
import { SignalGlyph } from '@/components/ui'
import { DemoDoor, type DemoDoorProps } from '@/components/DemoDoor'
import { pressable, spring } from '@/lib/motion'

/**
 * The desktop navigation.
 *
 * A bottom bar is the right answer on a phone and the wrong one on a laptop:
 * pinned to the bottom of a 1440px screen it sits as far from the reading eye
 * as the layout allows. So from lg: up the navigation moves to a fixed left
 * column and the caller drops TabBar.
 *
 * The column is short now, on purpose: four daily rows, the Analyse button
 * above them, and Settings pinned at the foot. Everything else — Accounts,
 * Tasks, History, People — lives on the Settings screen's tools list, per the
 * product owner's cut in lib/nav.ts. Analyse keeps the accent fill it has in
 * the tab bar — one product, one primary action, the same colour in both
 * layouts.
 *
 * Everything animates on transform and opacity. This column is fixed and
 * composited over the page background, so animating width or a box-shadow here
 * would repaint the whole strip.
 */

export type NavKey = Tab

interface Props {
  active: NavKey
  onSelect: (k: NavKey) => void
  /** Row badges. A key that is absent or zero shows no badge. */
  counts?: Partial<Record<NavKey, number>>
  /**
   * The example desk, if there is one to offer.
   *
   * An optional callback rather than a boolean, the same shape MoreSheet's
   * the door prop already uses: absent means it does not exist, so it is never
   * offered onto a dataset that was not deployed. `mode` and `note` come from
   * the caller because only App knows whether this tap costs a sign-out.
   */
  demo?: DemoDoorProps
}

/**
 * The sidebar's own body, taken from lib/nav rather than retyped.
 *
 * This file used to keep a fifth copy of the destination list, and copies are
 * what let five screens go unreachable on a phone while every list looked
 * complete on its own. Settings is filtered out here and pinned at the foot
 * instead — it stays in the shared groups because GROUPS is the one statement
 * of the taxonomy, and a group that quietly omitted a destination would defeat
 * the completeness check that reads it.
 */
const SIDEBAR_GROUPS = GROUPS.map((g) => ({
  heading: g.heading,
  items: g.items.filter((i) => i.id !== 'settings'),
})).filter((g) => g.items.length > 0)

/**
 * index.css rounds every :focus-visible target to --radius-xs, and that rule is
 * written after the utility layers, so it wins on source order. The rows are
 * full pills now, so the override has to be a pill too — a keyboard focus that
 * snaps the corners square reads as a rendering fault rather than as focus.
 */
const FOCUS =
  'focus-visible:rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]'

/** 48px pills — this layout is also what a tablet gets, so thumbs count. */
const ROW =
  'flex min-h-12 w-full items-center gap-3 rounded-full text-left transition-colors duration-200'

/**
 * The Sociolyze "Home" treatment: the open screen is a SOLID accent pill with
 * accent-fg text and the accent-tinted soft shadow the primary Button already
 * wears — one shadow recipe, not two. Idle rows stay quiet ink and only take
 * a surface wash on hover.
 */
const PILL_ACTIVE =
  'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[0_1px_2px_rgb(16_24_40/0.1),0_8px_20px_-6px_color-mix(in_oklab,var(--accent)_55%,transparent)]'
const PILL_IDLE = 'text-ink-2 hover:bg-[var(--surface-2)] hover:text-ink'

function NavRow({
  item,
  active,
  count,
  onSelect,
}: {
  item: NavItem
  active: boolean
  count: number | undefined
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
      className={cn(ROW, FOCUS, 'pl-4 pr-3', active ? PILL_ACTIVE : PILL_IDLE)}
    >
      <Icon size={18} strokeWidth={active ? 2.4 : 1.9} className="shrink-0" aria-hidden />
      <span
        className={cn('min-w-0 flex-1 truncate text-sm', active ? 'font-semibold' : 'font-medium')}
      >
        {label}
      </span>

      {badge && (
        <span
          aria-hidden
          className={cn(
            'tnum grid min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-2xs font-bold leading-5',
            // On the filled pill the badge inverts, or it would vanish into
            // its own colour. Colour is never carrying the count alone — the
            // number is folded into the aria-label above.
            active
              ? 'bg-[var(--accent-fg)] text-[var(--accent)]'
              : 'bg-[var(--accent)] text-[var(--accent-fg)]',
          )}
        >
          {badge}
        </span>
      )}

      {/* The chevron the reference's active "Home" row carries. Decorative:
          the fill, the heavier stroke, the bolder label and aria-current all
          already say "you are here", so it is hidden from readers. */}
      {active && <ChevronRight size={15} strokeWidth={2.4} className="shrink-0 opacity-70" aria-hidden />}
    </button>
  )
}

export function SideNav({ active, onSelect, counts, demo }: Props) {
  const reduced = useReducedMotion() === true

  // The tool screens open from Settings and have no row of their own, so the
  // Settings card stays lit while one is on screen. The alternative is a
  // column where nothing is lit, which says the reader is nowhere.
  const settingsLit = active === 'settings' || isUnlisted(active)

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
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <span className="shrink-0 text-[var(--accent)]">
            <SignalGlyph size={26} />
          </span>
          <span className="hed text-[1.35rem] leading-none tracking-[-0.005em]">Signal</span>
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
            'px-4 text-sm font-semibold',
            PILL_ACTIVE,
            active === 'analyse' &&
              'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface)]',
          )}
        >
          <Link2 size={18} strokeWidth={2.3} className="shrink-0" aria-hidden />
          Analyse a link
        </m.button>

        {/* Scrolls on its own so a short laptop window never pushes the foot
            card off the bottom of the column. */}
        <div className="scroller mt-6 min-h-0 flex-1 space-y-6 overflow-y-auto">
          {SIDEBAR_GROUPS.map((group) => (
            <div key={group.heading}>
              <p aria-hidden className="kicker px-4 pb-2">
                {group.heading}
              </p>
              <ul aria-label={group.heading} className="space-y-1">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <NavRow
                      item={item}
                      active={active === item.id}
                      count={counts?.[item.id]}
                      onSelect={onSelect}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Settings sits at the foot, pinned under a rule, the way settings
            usually does — restyled as the compact card the reference keeps in
            this slot: icon badge, two lines, a quiet door. No progress bar,
            because nothing here measures progress and a meter with nothing to
            measure would be decoration lying about data.

            The control that used to share this foot was Lock, which is now
            only in the header: it is beside the theme toggle and the history
            button there, present on every width including the phone, and a
            padlock is the one control an office reaches for in a hurry. */}
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          {/* First under the rule, above Settings. That is the right slot on
              its own merits: this is the only control here that changes which
              desk you are on. */}
          {demo && <DemoDoor {...demo} />}

          <button
            onClick={() => onSelect('settings')}
            aria-current={settingsLit ? 'page' : undefined}
            className={cn(
              'card card-hover flex w-full items-center gap-2.5 px-2.5 py-3 text-left',
              'focus-visible:rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
              settingsLit && 'ring-2 ring-[var(--accent)]',
            )}
          >
            <span
              className="icon-badge icon-badge-sm"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <SettingsIcon
                size={16}
                strokeWidth={settingsLit ? 2.4 : 2}
                aria-hidden
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">Settings</span>
              <span className="block truncate text-[11px] text-ink-3">
                Keys and preferences
              </span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-ink-3" aria-hidden />
          </button>
        </div>
      </div>
    </m.nav>
  )
}
