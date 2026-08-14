import * as m from 'motion/react-m'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { pressable, spring } from '@/lib/motion'

/* ── Button ──────────────────────────────────────────────────────────────── */

type ButtonProps = {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'outline' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
  'aria-label'?: string
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <m.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      {...(disabled ? {} : pressable)}
      className={cn(
        'relative inline-flex items-center justify-center gap-2 rounded-[--radius-md] font-medium',
        'select-none disabled:cursor-not-allowed disabled:opacity-45',
        // 48px minimum on anything a thumb hits in motion.
        size === 'sm' && 'min-h-11 px-3.5 text-sm',
        size === 'md' && 'min-h-12 px-5 text-base',
        size === 'lg' && 'min-h-14 px-6 text-lg',
        variant === 'primary' && 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--e2)]',
        variant === 'outline' && 'border border-[var(--border-interactive)] bg-[var(--surface)] text-ink',
        variant === 'ghost' && 'text-ink-2 hover:bg-[var(--surface-2)]',
        variant === 'danger' && 'bg-[var(--neg)] text-white',
        className,
      )}
      {...rest}
    >
      {children}
    </m.button>
  )
}

/* ── Chip ────────────────────────────────────────────────────────────────── */

export type ChipTone = 'neutral' | 'accent' | 'positive' | 'warning' | 'negative' | 'info'

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: 'bg-[var(--surface-2)] text-ink-2 border-[var(--border)]',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent)] border-[color-mix(in_oklab,var(--accent)_28%,transparent)]',
  positive: 'bg-[var(--pos-soft)] text-[var(--pos)] border-[color-mix(in_oklab,var(--pos)_28%,transparent)]',
  warning: 'bg-[var(--warn-soft)] text-[var(--warn)] border-[color-mix(in_oklab,var(--warn)_28%,transparent)]',
  negative: 'bg-[var(--neg-soft)] text-[var(--neg)] border-[color-mix(in_oklab,var(--neg)_28%,transparent)]',
  info: 'bg-[var(--info-soft)] text-[var(--info)] border-[color-mix(in_oklab,var(--info)_28%,transparent)]',
}

export function Chip({
  children,
  tone = 'neutral',
  icon,
  className,
  title,
}: {
  children: ReactNode
  tone?: ChipTone
  icon?: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1',
        'text-xs font-medium leading-none whitespace-nowrap',
        CHIP_TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

/* ── Card ────────────────────────────────────────────────────────────────── */

export function Card({
  children,
  className,
  padded = true,
  tone,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
  tone?: 'accent'
}) {
  return (
    <div
      className={cn(
        'card relative overflow-hidden',
        tone === 'accent' && 'grad-border',
        padded && 'p-4 sm:p-5',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * Section heading. `hint` carries the "why this matters" line — the difference
 * between a dashboard someone can read and one they have to be taught.
 */
export function SectionTitle({
  children,
  hint,
  action,
}: {
  children: ReactNode
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-[-0.011em]">{children}</h2>
        {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

/* ── Provenance ──────────────────────────────────────────────────────────── */

/**
 * A small mark showing where a number came from. This is what keeps the
 * product honest: a measured like count and an estimated reach must never look
 * identical, or the whole readout becomes untrustworthy.
 */
/** Where a value came from. Null for the ones that need no explaining. */
const PROVENANCE: Record<string, { label: string | null; tone: ChipTone; title: string }> = {
  // Measured. These are the overwhelming majority, and a badge on every one of
  // them is decoration, not information — the origin still rides on the tile's
  // title attribute for anyone who wants it.
  'platform-api': { label: null, tone: 'positive', title: 'From the platform’s official API' },
  'public-endpoint': { label: null, tone: 'positive', title: 'From a public platform endpoint' },
  'page-scrape': { label: null, tone: 'positive', title: 'Read from the page itself' },
  // Not measured by us. These are the ones a reader has to know about.
  'user-supplied': { label: 'you added this', tone: 'accent', title: 'You entered this figure' },
  vision: { label: 'from screenshot', tone: 'accent', title: 'Read from your screenshot' },
  inferred: { label: 'estimate', tone: 'warning', title: 'Estimated — not measured' },
  unavailable: { label: null, tone: 'neutral', title: 'This platform does not publish it' },
}

export function provenanceTitle(source: string): string {
  return (PROVENANCE[source] ?? PROVENANCE['unavailable']!).title
}

/**
 * A note on where a figure came from — rendered only when it is not simply
 * measured.
 *
 * Every tile used to carry a green "EXACT". Four identical badges on four
 * numbers tell a reader nothing: if the norm is labelled, the label stops being
 * a signal and the one figure that *was* estimated no longer stands out. So
 * measurement is now silent and only the exceptions speak.
 */
export function Provenance({ source, className }: { source: string; className?: string }) {
  const meta = PROVENANCE[source] ?? PROVENANCE['unavailable']!
  if (!meta.label) return null

  return (
    <span
      title={meta.title}
      className={cn(
        'text-2xs font-medium',
        meta.tone === 'warning' && 'text-[var(--warn)]',
        meta.tone === 'accent' && 'text-[var(--accent)]',
        meta.tone === 'neutral' && 'text-ink-3',
        className,
      )}
    >
      {meta.label}
    </span>
  )
}

/* ── Meter ───────────────────────────────────────────────────────────────── */

export function Bar({
  value,
  tone = 'accent',
  className,
  delay = 0,
}: {
  /** 0…1 */
  value: number
  tone?: 'accent' | 'positive' | 'warning' | 'negative'
  className?: string
  delay?: number
}) {
  const colour = {
    accent: 'var(--accent)',
    positive: 'var(--pos)',
    warning: 'var(--warn)',
    negative: 'var(--neg)',
  }[tone]

  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]', className)}>
      <m.div
        className="h-full rounded-full"
        style={{ background: colour, transformOrigin: 'left center' }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: Math.max(0, Math.min(1, value)) }}
        transition={{ ...spring.settle, delay }}
      />
    </div>
  )
}

/* ── Empty / skeleton ────────────────────────────────────────────────────── */

/** Decreasing widths read as text; equal-width bars read as a broken loader. */
export function SkeletonLines({ lines = 4, className }: { lines?: number; className?: string }) {
  const widths = ['100%', '92%', '78%', '60%', '84%', '70%']
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="sk h-3" style={{ width: widths[i % widths.length] }} />
      ))}
    </div>
  )
}
