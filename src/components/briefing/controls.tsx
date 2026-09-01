import { Info } from 'lucide-react'
import { WINDOWS, type WindowId } from '@/lib/window'
import { cn } from '@/lib/utils'

/**
 * The small controls every dashboard section shares: the time-window picker,
 * and the honest dash.
 */

/** Last week / Last month / All time, one segmented pill. */
export function WindowPicker({
  value,
  onChange,
  options,
  className,
}: {
  value: WindowId
  onChange: (w: WindowId) => void
  /** Which windows to offer; defaults to all three. */
  options?: WindowId[]
  className?: string
}) {
  return (
    <div
      className={cn(
        'inline-flex rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface-2)] p-0.5',
        className,
      )}
      role="group"
      aria-label="Time window"
    >
      {WINDOWS.filter((w) => !options || options.includes(w.id)).map((w) => (
        <button
          key={w.id}
          type="button"
          onClick={() => onChange(w.id)}
          aria-pressed={value === w.id}
          className={cn(
            'min-h-9 rounded-[var(--radius-pill)] px-2.5 text-xs font-semibold transition-colors',
            value === w.id
              ? 'bg-[var(--surface)] text-ink shadow-[var(--e1)]'
              : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {w.label}
        </button>
      ))}
    </div>
  )
}

/**
 * A figure the platform did not publish: a dash with the reason one hover
 * away. The owner's rule — a bare em dash made the reader wonder whether the
 * desk was broken; the dash with an ⓘ says the desk looked and the platform
 * said nothing.
 */
export function NoData({ reason, className }: { reason: string; className?: string }) {
  return (
    <span
      className={cn('inline-flex cursor-help items-center gap-1 text-ink-3', className)}
      title={reason}
      aria-label={reason}
    >
      NA
      <Info size={11} aria-hidden className="opacity-60" />
    </span>
  )
}

/**
 * Why a figure is absent, in as few words as carry the meaning.
 *
 * These used to be a sentence each, per platform, explaining what that company
 * does and does not publish. The office does not need a lecture about
 * Facebook's product decisions on a card showing their own reach. What they do
 * need is to know the number is missing rather than nought, and two words
 * carry that.
 */
export function noViewsReason(platform: string): string {
  return `Views not published by ${platform}.`
}

export function noReactionsReason(platform: string): string {
  return `Reactions not published by ${platform}.`
}
