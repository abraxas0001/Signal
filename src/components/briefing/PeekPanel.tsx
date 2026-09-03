import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A section of the app shown on the dashboard at half height, with the rest
 * veiled, and one press to open it in full.
 *
 * WHY THE REAL SECTION AND NOT A SUMMARY. The dashboard used to carry a
 * hand-written precis of each screen — a "glance" card that picked two figures
 * out of the section and restated them. That taught a reader nothing about
 * what the section actually contains, so nobody opened it, and the precis had
 * to be maintained in step with the screen it described. This mounts the SAME
 * component the full screen mounts and simply stops drawing it partway down,
 * so what a reader sees here is what they will find when they press through.
 * There is no second version of the truth to keep in sync.
 *
 * WHY THE CONTENT IS INERT. Everything inside the veil is `aria-hidden` and
 * takes no pointer events: a preview that answered clicks would give a reader
 * two half-working copies of the same controls on one page, and a keyboard
 * user would tab through a filter bar they cannot see the results of. The one
 * thing that IS operable is the button, which opens the real screen. That
 * keeps the whole panel a single, honest affordance.
 */
export function PeekPanel({
  title,
  subtitle,
  icon,
  action,
  onOpen,
  height = 400,
  trim = 0,
  children,
  className,
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
  /** The button's words, e.g. "Open comparison". */
  action: string
  onOpen: () => void
  /** How much of the section to show before the veil starts, in pixels. */
  height?: number
  /**
   * Pixels to pull the mounted section up by, hiding its own page header.
   *
   * Every screen prints its own title, and inside a peek that repeats the
   * panel's heading two lines below it, alongside a Back button that does
   * nothing here. Trimming is per-section because the headers differ in
   * height; each value below was measured against the rendered screen.
   */
  trim?: number
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'card overflow-hidden p-0',
        // The whole panel is one target, so the cursor says so anywhere on it.
        'group cursor-pointer',
        className,
      )}
      onClick={onOpen}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-4 sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent)]">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[19px] font-bold tracking-[-0.018em]">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3.5 text-[13px] font-semibold text-[var(--accent)] transition-colors hover:border-[var(--accent)]"
        >
          {action}
          <ArrowRight size={14} aria-hidden />
        </button>
      </div>

      {/* The section itself, cut off partway down. */}
      <div className="relative">
        {/* `inert` as well as aria-hidden. aria-hidden alone hides the subtree
            from assistive tech but leaves every button and select inside it
            KEYBOARD FOCUSABLE, so tabbing across the dashboard walked into
            four invisible copies of screens the reader could not see. `inert`
            takes them out of the focus order and blocks their events too. */}
        <div
          aria-hidden
          inert
          className="pointer-events-none select-none overflow-hidden"
          style={{ height }}
        >
          {/* Negative top margin trims the mounted screen's own page header,
              which would otherwise repeat the title printed directly above. */}
          <div className="peek-body" style={{ marginTop: -trim }}>
            {children}
          </div>
        </div>

        {/* The veil: a blur that thickens downward, over a fade to the card. */}
        <div aria-hidden className="peek-veil absolute inset-x-0 bottom-0 h-40" />

        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-4"
        >
          <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--accent)] shadow-[var(--e1)] transition-colors group-hover:border-[var(--accent)]">
            {action}
            <ArrowRight size={13} aria-hidden />
          </span>
        </div>
      </div>
    </section>
  )
}
