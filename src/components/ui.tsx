import * as m from 'motion/react-m'
import { useState } from 'react'
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
        // Squared and set in mono, so a chip reads as a label filed against a
        // record rather than a badge on a marketing page. The rounded pastel
        // pill it replaced is the most over-used component on the web, and a
        // row of six of them told the reader nothing about which mattered.
        'inline-flex shrink-0 items-center gap-1.5 rounded-[3px] border px-2 py-[3px]',
        'font-mono text-[10px] font-medium uppercase leading-none tracking-[0.07em] whitespace-nowrap',
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

/**
 * The Signal mark: four bars, one peak.
 *
 * It lived as a private function inside App.tsx, which is why the dashboard had
 * a text kicker where the header has a logo. Same mark in both places now, so
 * the two screens read as one product.
 */
/**
 * The mark: a ruled register, and the one column that breaks the line.
 *
 * What it replaced was four rounded bars of descending height — a bar chart,
 * which is the stock glyph for "analytics" and said nothing about this
 * product. It also fought the interface, because a chart icon above a screen
 * of charts reads as a chart.
 *
 * This is drawn in the same language as everything else here: a rule, and
 * columns hung from it, like the ruled page the office is replacing. Three
 * columns stop at the rule; one carries through it. That is the product in
 * one gesture — a great many voices, and the one that matters today.
 *
 * Four strokes is the budget. At 16px in the tab bar anything finer collapses
 * into a smudge, so the geometry is aligned to whole units and the breaking
 * column is the heaviest thing in the mark, which is what survives when the
 * rest stops resolving.
 */
/**
 * The mark, matching `public/favicon.svg` exactly.
 *
 * Three bars rising inside a rounded tile. The app briefly wore a different
 * drawing — a ruled register with one column breaking the line — and it was a
 * better argument than it was a logo: the tab, the installed icon and the
 * header showed two different marks, and the one people actually recognise a
 * product by is the one in the tab.
 *
 * The gradient is mixed from `--accent` rather than the favicon's fixed indigo,
 * so the tile sits in whichever palette is loaded and follows the theme instead
 * of fighting it. Geometry is the favicon's, scaled from its 32-unit grid.
 */
export function SignalGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="signal-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop
            offset="1"
            stopColor="color-mix(in oklab, var(--accent) 62%, var(--info, #3B82C4))"
          />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#signal-mark)" />
      <rect x="5" y="18" width="4.4" height="9" rx="2.2" fill="#fff" opacity=".55" />
      <rect x="12.2" y="12.6" width="4.4" height="14.4" rx="2.2" fill="#fff" opacity=".75" />
      <rect x="19.4" y="5" width="4.4" height="22" rx="2.2" fill="#fff" />
    </svg>
  )
}

/* ── Layout ──────────────────────────────────────────────────────────────── */

/**
 * The one container every screen sits in.
 *
 * Screens used to each pick their own `max-w-*`, which is why nothing lined up:
 * the header was 672px wide while the grievance desk under it was 1152px, and
 * on a laptop the dashboard's 896px left a third of the window empty on either
 * side. The measure is chosen by what the screen is for, and the gutter comes
 * from a variable so the page edge is the same number everywhere.
 */
export function Shell({
  children,
  width = 'default',
  className,
  as: Tag = 'div',
}: {
  children: ReactNode
  /**
   * `default` — working screens: grids, tiles, lists.
   * `wide`    — dense boards where a fourth column earns its place.
   * `prose`   — anything read start to finish, capped near 70ch.
   */
  width?: 'default' | 'wide' | 'prose'
  className?: string
  as?: 'div' | 'section' | 'main' | 'header'
}) {
  return (
    <Tag
      className={cn(
        'shell',
        width === 'wide' && 'shell-wide',
        width === 'prose' && 'shell-prose',
        className,
      )}
    >
      {children}
    </Tag>
  )
}

/**
 * The heading block at the top of a screen.
 *
 * Every screen had grown its own arrangement of title, subtitle and buttons,
 * and they disagreed on all three: some centred the actions, some pushed them
 * to a second row, one put the back arrow to the right of the title. Baseline
 * alignment between the title and its actions is the thing that reads as
 * "designed", and it is exactly what a per-screen hand-roll loses.
 */
export function PageHeader({
  kicker,
  title,
  subtitle,
  actions,
  lead,
  className,
}: {
  kicker?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** Buttons. Wrap under the title on narrow screens rather than squeezing it. */
  actions?: ReactNode
  /** An avatar or icon set to the left of the whole block. */
  lead?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-4">
        {lead}
        <div className="min-w-0">
          {kicker && <p className="kicker">{kicker}</p>}
          <h1
            className={cn(
              'hed text-[clamp(1.6rem,1.2rem+1.6vw,2.25rem)] leading-[1.1]',
              kicker && 'mt-1.5',
            )}
          >
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink-2">{subtitle}</p>
          )}
        </div>
      </div>

      {actions && (
        // shrink-0 so a long title never crushes the buttons into two words per
        // line, which is what happened on the grievance desk at 1024px.
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  )
}

/* ── Avatar ──────────────────────────────────────────────────────────────── */

/**
 * A person's photograph, or their initials when there is none.
 *
 * Remote images fail constantly here — a profile picture URL read off a public
 * page is hotlink-protected as often as not, and a broken image icon on the
 * one element that says whose desk this is looks like the product is broken.
 * So a failed load falls back to initials rather than to the browser's glyph.
 */
export function Avatar({
  src,
  name,
  size = 56,
  className,
}: {
  src?: string | null
  name: string
  size?: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  const show = src && !failed

  return (
    <span
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden rounded-full',
        'border border-[var(--border)] bg-[var(--surface-2)]',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {show ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="font-semibold leading-none text-ink-2"
          style={{ fontSize: Math.round(size * 0.36) }}
        >
          {initials || '·'}
        </span>
      )}
    </span>
  )
}

/* ── Empty state ─────────────────────────────────────────────────────────── */

/**
 * What a screen says when it has nothing yet.
 *
 * Written as one component because the four screens that needed it had four
 * different answers — one showed a spinner forever, one showed nothing at all.
 * An empty screen has to say what belongs here and offer the one step that
 * fills it, or the reader cannot tell it apart from a failure.
 */
export function Empty({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[--radius-sm] border border-dashed',
        'border-[var(--border)] px-5 py-7 text-center sm:py-8',
        className,
      )}
    >
      {icon && (
        <span className="mb-2.5 grid size-9 place-items-center rounded-full bg-[var(--surface-2)] text-ink-3">
          {icon}
        </span>
      )}
      <p className="text-[15px] font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-[52ch] text-sm leading-relaxed text-ink-2">{body}</p>}
      {action && <div className="mt-3.5">{action}</div>}
    </div>
  )
}
