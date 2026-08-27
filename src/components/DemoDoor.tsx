import { ChevronRight, Eye, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/motion'

/**
 * Declared once and imported by every surface that renders or forwards it.
 *
 * Written inline in three files first, which cost a real bug rather than only
 * duplication: App's `useMemo` had to infer its own type from a literal holding
 * two callbacks, one of which is handed straight back to a typed prop, and tsc
 * chased that into a circular reference it could not resolve.
 */
export interface DemoDoorProps {
  /** `enter` when the reader is on their own desk, `leave` when in the demo. */
  mode: 'enter' | 'leave'
  /**
   * The line under the label. Supplied by the caller because only it knows
   * whether this tap costs a sign-out and whose name is on the account.
   */
  note: string
  onClick: () => void
}

/**
 * The way into the example desk from inside the app, and the way back out.
 *
 * One definition, rendered by both navigations. The sidebar is `lg:` and up, so
 * a sidebar-only control would leave every phone without a door — and the whole
 * lesson of lib/nav.ts is that a surface-specific addition strands the other
 * surfaces quietly.
 *
 * It sits in the nav foot, under the rule, because below that rule already
 * means doors and actions while above it means places. The demo is a scope, not
 * a screen: it never goes active, it has nothing to count, and it is the only
 * control in the column that changes which desk you are on. That is also why it
 * is not a `Tab` — adding one would compile, and then `screen()`'s `default:`
 * would silently render the dashboard with the demo row marked as the open
 * page.
 *
 * SOLID VIOLET, and the text colour is the reason it can be.
 *
 * `--accent` is blue and belongs to signing in and to Analyse; violet says "a
 * different kind of door". The obvious objection to a solid violet control is
 * contrast, and it was real: `text-white` on the dark theme's `--accent-2`
 * (#a78bfa) is 2.72:1, which fails AA and is what the entry screens were
 * shipping. `--accent-fg` is white in light and near-black in dark, which takes
 * the same button to 5.70:1 light and 6.97:1 dark. Both pass. So the button can
 * be as loud as it should be without being illegible in either theme.
 *
 * It knows nothing about vaults or the demo dataset. Opening the example desk
 * signs a real account out, and that decision belongs to the one caller that
 * already holds the vault state, not to a button in a nav column.
 */
export function DemoDoor({ mode, note, onClick }: DemoDoorProps) {
  const leaving = mode === 'leave'
  const Icon = leaving ? LogOut : Eye

  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap()
        onClick()
      }}
      className={cn(
        'group flex w-full items-center gap-3 rounded-[var(--radius-lg)] p-3 text-left',
        'focus-visible:rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-2)]',
        // Leaving is not a thing to advertise — whoever is already inside the
        // demo found the door once. It takes the quiet card treatment the
        // Settings row wears, so only the entrance is loud.
        leaving
          ? 'card card-hover'
          : cn(
              'bg-[var(--accent-2)] text-[var(--accent-fg)]',
              // The primary button's own shadow recipe, retinted. One recipe,
              // not a second set of numbers invented here.
              'shadow-[0_1px_2px_rgb(16_24_40/0.1),0_8px_20px_-6px_color-mix(in_oklab,var(--accent-2)_55%,transparent)]',
              'transition-[transform,box-shadow,filter] duration-200 ease-out',
              'hover:-translate-y-0.5 hover:brightness-110',
              'active:translate-y-0 active:brightness-95',
            ),
      )}
    >
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-full',
          leaving ? 'bg-[var(--accent-2-soft)] text-[var(--accent-2)]' : 'bg-white/20',
        )}
      >
        <Icon size={16} strokeWidth={2} aria-hidden />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {leaving ? 'Leave the demo' : 'Try the demo'}
        </span>
        {/* Not decoration. On the entrance this is where the sign-out is
            disclosed, before the tap rather than after it. */}
        <span
          className={cn(
            'block truncate text-[11px]',
            leaving ? 'text-ink-3' : 'text-[var(--accent-fg)] opacity-80',
          )}
        >
          {note}
        </span>
      </span>

      <ChevronRight
        size={15}
        className={cn(
          'shrink-0 transition-transform duration-200 group-hover:translate-x-0.5',
          leaving ? 'text-ink-3' : 'opacity-80',
        )}
        aria-hidden
      />
    </button>
  )
}
