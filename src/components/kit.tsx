/**
 * The premium chart kit — every visual atom the redesigned screens share.
 *
 * Built to the dataviz method, not to taste:
 *   • series colours come from --chart-1…5, validated with the six-check
 *     script against both surfaces (see index.css for the run record);
 *   • text wears ink tokens, never the series colour — a coloured dot beside
 *     it carries identity;
 *   • thin marks, rounded data-ends, 2px surface gaps between fills;
 *   • every plot ships a hover layer (crosshair + tooltip on lines, per-mark
 *     tooltip on bars/segments) — the only form without one is the bare tile;
 *   • ≥2 series always get a legend; ≤4 also get direct end-labels;
 *   • one axis, always. Two measures of different scale = two charts.
 *
 * Motion follows lib/motion's laws: springs never drive opacity, draw-ins are
 * transform/pathLength only, and everything collapses under reduced motion.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import NumberFlow from '@number-flow/react'
import { ArrowDownRight, ArrowUpRight, AtSign, Globe, ImageOff, MessageCircle, Minus, Quote, Send, Sparkles } from 'lucide-react'
import { cn, compact } from '@/lib/utils'
import { spring } from '@/lib/motion'

/* ── Brand glyphs ────────────────────────────────────────────────────────── */

/**
 * This lucide build ships no brand icons, so the five that matter are drawn
 * here as single-path SVGs. They accept the same {size} contract lucide
 * icons do, so PLATFORM_META can hold either kind.
 */
type IconLike = React.ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>

const brand =
  (children: (sw: number) => ReactNode): IconLike =>
  ({ size = 16, strokeWidth = 2 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {children(strokeWidth)}
    </svg>
  )

const InstagramGlyph = brand((sw) => (
  <>
    <rect x="2.6" y="2.6" width="18.8" height="18.8" rx="5.4" fill="none" stroke="currentColor" strokeWidth={sw} />
    <circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" strokeWidth={sw} />
    <circle cx="17.2" cy="6.8" r="1.25" />
  </>
))

const FacebookGlyph = brand(() => (
  <path d="M13.6 21v-7.1h2.4l.45-3.1H13.6V8.9c0-.9.35-1.55 1.65-1.55h1.35V4.6c-.35-.05-1.2-.15-2.1-.15-2.1 0-3.55 1.3-3.55 3.65v2.7H8.4v3.1h2.55V21h2.65Z" />
))

const XGlyph = brand(() => (
  <path d="M17.7 3h3.05l-6.66 7.62L22 21h-6.13l-4.8-6.28L5.57 21H2.5l7.13-8.16L2 3h6.29l4.34 5.74L17.7 3Zm-1.07 16.2h1.69L7.37 4.7H5.55l11.08 14.5Z" />
))

const YoutubeGlyph = brand(() => (
  <path
    fillRule="evenodd"
    d="M22.5 12s0-3.55-.45-5.25a2.72 2.72 0 0 0-1.92-1.93C18.4 4.4 12 4.4 12 4.4s-6.4 0-8.13.42A2.72 2.72 0 0 0 1.95 6.75C1.5 8.45 1.5 12 1.5 12s0 3.55.45 5.25a2.72 2.72 0 0 0 1.92 1.93c1.73.42 8.13.42 8.13.42s6.4 0 8.13-.42a2.72 2.72 0 0 0 1.92-1.93c.45-1.7.45-5.25.45-5.25ZM9.9 8.65 15.7 12l-5.8 3.35v-6.7Z"
  />
))

const LinkedinGlyph = brand(() => (
  <path d="M6.94 8.6H3.78V20h3.16V8.6ZM5.36 3.4a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8ZM20.22 13.3c0-3.02-1.61-4.94-4.2-4.94-1.49 0-2.5.72-3.08 1.7V8.6H9.82V20h3.12v-6.03c0-1.4.8-2.3 2-2.3 1.17 0 1.86.8 1.86 2.3V20h3.42v-6.7Z" />
))

/* ── Series palette ──────────────────────────────────────────────────────── */

/** Fixed assignment order — never cycled, never re-ranked (dataviz rule). */
export const SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const

export const seriesColor = (i: number): string => SERIES[i % SERIES.length] as string

/* ── Platform identity ───────────────────────────────────────────────────── */

/**
 * One place that knows what each platform looks like: brand tint for the
 * badge, a lucide glyph, and a readable short label. Brand colours are
 * identity, not data — they never appear inside a chart's series palette.
 */
export const PLATFORM_META: Record<string, { color: string; bg: string; Icon: IconLike; short: string }> = {
  Instagram: { color: '#ffffff', bg: 'linear-gradient(135deg,#F58529 0%,#DD2A7B 50%,#8134AF 100%)', Icon: InstagramGlyph, short: 'IG' },
  Facebook: { color: '#ffffff', bg: '#1877F2', Icon: FacebookGlyph, short: 'FB' },
  'Twitter/X': { color: '#ffffff', bg: '#0F1419', Icon: XGlyph, short: 'X' },
  YouTube: { color: '#ffffff', bg: '#FF0033', Icon: YoutubeGlyph, short: 'YT' },
  LinkedIn: { color: '#ffffff', bg: '#0A66C2', Icon: LinkedinGlyph, short: 'LI' },
  Threads: { color: '#ffffff', bg: '#000000', Icon: AtSign, short: 'TH' },
  Bluesky: { color: '#ffffff', bg: '#1185FE', Icon: MessageCircle, short: 'BS' },
  Mastodon: { color: '#ffffff', bg: '#6364FF', Icon: MessageCircle, short: 'MD' },
  Telegram: { color: '#ffffff', bg: '#26A5E4', Icon: Send, short: 'TG' },
}

export function PlatformBadge({ platform, size = 28, className }: { platform: string; size?: number; className?: string }) {
  const meta = PLATFORM_META[platform] ?? { color: '#fff', bg: 'var(--accent)', Icon: Globe, short: '•' }
  const { Icon } = meta
  return (
    <span
      className={cn('grid shrink-0 place-items-center rounded-full', className)}
      style={{ width: size, height: size, background: meta.bg, color: meta.color }}
      title={platform}
      aria-label={platform}
    >
      <Icon size={Math.round(size * 0.55)} strokeWidth={2.2} aria-hidden />
    </span>
  )
}

/* ── Delta chip ──────────────────────────────────────────────────────────── */

/**
 * "47.4% ↗" — the green/red pill beside every headline number in the
 * reference shots. Direction is carried by BOTH the arrow and the colour, so
 * it survives CVD and grayscale.
 */
export function DeltaChip({
  value,
  suffix = '%',
  className,
  title,
}: {
  /** Signed change. Null renders a quiet neutral chip. */
  value: number | null
  suffix?: string
  className?: string
  title?: string
}) {
  if (value == null) {
    return (
      <span className={cn('inline-flex items-center gap-0.5 rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[11px] font-semibold text-ink-3', className)} title={title}>
        <Minus size={11} aria-hidden /> —
      </span>
    )
  }
  const up = value > 0
  const flat = value === 0
  const Arrow = up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums',
        flat
          ? 'bg-[var(--surface-3)] text-ink-3'
          : up
            ? 'bg-[var(--pos-soft)] text-[var(--pos)]'
            : 'bg-[var(--neg-soft)] text-[var(--neg)]',
        className,
      )}
      title={title}
    >
      {!flat && <Arrow size={11} strokeWidth={2.6} aria-hidden />}
      {Math.abs(value) >= 100 ? compact(Math.abs(value)) : Math.abs(value) % 1 === 0 ? Math.abs(value) : Math.abs(value).toFixed(1)}
      {suffix}
    </span>
  )
}

/* ── Icon stat tile ──────────────────────────────────────────────────────── */

const TINTS = {
  blue: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  violet: { bg: 'var(--accent-2-soft)', fg: 'var(--accent-2)' },
  green: { bg: 'var(--pos-soft)', fg: 'var(--pos)' },
  orange: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  pink: { bg: 'color-mix(in oklab, var(--chart-5) 12%, transparent)', fg: 'var(--chart-5)' },
  teal: { bg: 'color-mix(in oklab, var(--chart-3) 12%, transparent)', fg: 'var(--chart-3)' },
} as const

export type Tint = keyof typeof TINTS

/**
 * The "Performance Summary" tile: icon badge, label, big number, delta chip,
 * comparison line. The whole Statistic row of the reference shots is a grid
 * of these.
 */
export function IconStat({
  icon,
  label,
  value,
  display,
  delta,
  deltaLabel,
  tint = 'blue',
  hero = false,
  onClick,
  className,
}: {
  icon: ReactNode
  label: string
  /** Null reads as "—" with the reason on the title attribute. */
  value: number | null
  /** Pre-formatted override (e.g. "1.26k", "2%"). */
  display?: string
  delta?: number | null
  deltaLabel?: string
  tint?: Tint
  /** The one filled tile in a row (the "Followers" card in InFluence). */
  hero?: boolean
  onClick?: () => void
  className?: string
}) {
  const t = TINTS[tint]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { onClick, type: 'button' as const } : {})}
      className={cn(
        'card card-hover flex flex-col gap-3 p-4 text-left sm:p-5',
        hero && 'text-white',
        onClick && 'cursor-pointer',
        className,
      )}
      style={hero ? { background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 130%)', border: 'none' } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="icon-badge"
          style={hero ? { background: 'rgb(255 255 255 / 0.18)', color: '#fff' } : { background: t.bg, color: t.fg }}
        >
          {icon}
        </span>
        {delta !== undefined && <DeltaChip value={delta} {...(deltaLabel ? { title: deltaLabel } : {})} />}
      </div>
      <div>
        <p className={cn('text-[13px] font-medium', hero ? 'text-white/80' : 'text-ink-3')}>{label}</p>
        <p className={cn('tnum mt-0.5 text-[26px] font-bold leading-none tracking-[-0.02em]', hero ? 'text-white' : 'text-ink')}>
          {display ?? (value == null ? '—' : value < 100_000 ? <NumberFlow value={value} /> : compact(value))}
        </p>
        {deltaLabel && <p className={cn('mt-1.5 text-[11px]', hero ? 'text-white/70' : 'text-ink-3')}>{deltaLabel}</p>}
      </div>
    </Tag>
  )
}

/* ── Card header ─────────────────────────────────────────────────────────── */

/**
 * The reference dashboards' card header, as one component: a tinted icon
 * badge, a bold title with an optional ⓘ hint riding the title attribute, a
 * quiet subtitle, and a right-hand slot for the pill control ("Last 30 days
 * ˅", a filter, a Manage link). Standardised here so every card on every
 * screen opens the same way instead of each screen hand-rolling the row.
 */
export function CardHead({
  icon,
  title,
  sub,
  hint,
  tint = 'blue',
  action,
  className,
}: {
  icon: ReactNode
  title: string
  /** The quiet second line. */
  sub?: string
  /** Hover explanation — the reference's ⓘ, without the extra glyph noise. */
  hint?: string
  tint?: Tint
  /** Right-hand control: a selectClass pill, a Manage link, a Chip. */
  action?: ReactNode
  className?: string
}) {
  const t = TINTS[tint]
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 items-center gap-2.5" {...(hint ? { title: hint } : {})}>
        <span className="icon-badge-sm" style={{ background: t.bg, color: t.fg }}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-tight">{title}</p>
          {sub && <p className="truncate text-[11px] leading-tight text-ink-3">{sub}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/* ── Tooltip machinery (shared by every plot) ────────────────────────────── */

interface TipState {
  x: number
  y: number
  node: ReactNode
}

function useTip() {
  const [tip, setTip] = useState<TipState | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const show = useCallback((clientX: number, clientY: number, node: ReactNode) => {
    const host = ref.current
    if (!host) return
    const r = host.getBoundingClientRect()
    setTip({ x: clientX - r.left, y: clientY - r.top, node })
  }, [])
  const hide = useCallback(() => setTip(null), [])
  const overlay = tip ? (
    <div
      className="chart-tip"
      style={{
        left: Math.min(Math.max(tip.x + 12, 8), (ref.current?.clientWidth ?? 300) - 140),
        top: Math.max(tip.y - 12, 4),
      }}
    >
      {tip.node}
    </div>
  ) : null
  return { ref, tip, show, hide, overlay }
}

function TipRow({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-ink-2">
        {color && <i className="size-2 shrink-0 rounded-full" style={{ background: color }} />}
        {label}
      </span>
      <span className="tnum font-semibold text-ink">{value}</span>
    </div>
  )
}

/** Legend — always rendered for ≥2 series; the title names a single one. */
export function Legend({ items, className }: { items: { label: string; color: string }[]; className?: string }) {
  if (items.length < 2) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1', className)}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
          <i className="size-2.5 rounded-full" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/* ── Measured width ──────────────────────────────────────────────────────── */

/**
 * The rendered width of a chart's container, in CSS pixels.
 *
 * The plots draw into a viewBox and let the SVG scale — which also scales the
 * TEXT, so an axis label authored at 11 units became ~6px on a phone and was
 * illegible. Sizing the viewBox to the measured width makes one SVG unit one
 * pixel: type is crisp at 11px on every screen, and the marks reflow instead
 * of shrinking. Falls back to the given default before first measure.
 */
function useMeasuredWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 40) setWidth(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

/* ── Line / area chart ───────────────────────────────────────────────────── */

export interface LineSeries {
  name: string
  /** A var(--chart-n) reference — assign by entity, never by rank. */
  color: string
  values: (number | null)[]
}

/** Catmull-Rom → cubic bezier, for the smooth lines every reference uses. */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0]!.x},${pts[0]!.y}`
  let d = `M${pts[0]!.x},${pts[0]!.y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x},${p2.y}`
  }
  return d
}

/**
 * The "Growth Overview" chart: smooth multi-series lines over a recessive
 * grid, soft gradient area under the first series, crosshair + tooltip on
 * hover, direct end-labels for ≤4 series.
 */
export function LineChart({
  labels,
  series,
  height = 240,
  area = true,
  formatValue = compact,
  className,
}: {
  labels: string[]
  series: LineSeries[]
  height?: number
  area?: boolean
  formatValue?: (n: number | null | undefined) => string
  className?: string
}) {
  const reduced = useReducedMotion()
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const { ref, show, hide, overlay } = useTip()
  const { ref: mref, width: W } = useMeasuredWidth<HTMLDivElement>(720)
  const [hoverI, setHoverI] = useState<number | null>(null)

  const H = height
  const PAD = { l: 44, r: 16, t: 12, b: 26 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  /**
   * The y-range follows the DATA, with a little headroom — it is not pinned to
   * zero.
   *
   * Zero-baselining is a rule for BAR charts, where the length of the mark
   * encodes the magnitude and a truncated bar lies about the ratio. A line
   * chart encodes value by POSITION and is read for its shape over time, so
   * forcing zero into the range is what flattens an indexed or narrow-range
   * series into four straight lines stacked on the axis. Padding by a tenth of
   * the span keeps the marks off the frame edge.
   */
  const allValues = series.flatMap((s) => s.values.filter((v): v is number => v != null))
  const rawMax = allValues.length ? Math.max(...allValues) : 1
  const rawMin = allValues.length ? Math.min(...allValues) : 0
  const pad = (rawMax - rawMin || Math.abs(rawMax) || 1) * 0.12
  const maxV = rawMax + pad
  // Never dip below zero for a series that is entirely non-negative: a count
  // cannot be negative, and an axis that implies it can is misleading.
  const minV = rawMin >= 0 ? Math.max(0, rawMin - pad) : rawMin - pad
  const span = maxV - minV || 1

  const x = (i: number) => PAD.l + (labels.length < 2 ? innerW / 2 : (i / (labels.length - 1)) * innerW)
  const y = (v: number) => PAD.t + innerH - ((v - minV) / span) * innerH

  const ticks = useMemo(() => {
    const n = 4
    return Array.from({ length: n + 1 }, (_, i) => minV + (span / n) * i)
  }, [minV, span])

  const pointsFor = (s: LineSeries) =>
    s.values.map((v, i) => (v == null ? null : { x: x(i), y: y(v), v, i })).filter((p): p is { x: number; y: number; v: number; i: number } => p != null)

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((px - PAD.l) / innerW) * (labels.length - 1))
    const ci = Math.max(0, Math.min(labels.length - 1, i))
    setHoverI(ci)
    show(
      e.clientX,
      e.clientY,
      <div className="space-y-1">
        <p className="font-semibold text-ink">{labels[ci]}</p>
        {series.map((s) => (
          <TipRow key={s.name} color={s.color} label={s.name} value={formatValue(s.values[ci])} />
        ))}
      </div>,
    )
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <div ref={mref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={`Line chart: ${series.map((s) => s.name).join(', ')}`}>
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`la-${uid}-${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((t, i) => (
          <g key={i}>
            <line className="chart-grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="chart-axis-label" x={PAD.l - 8} y={y(t) + 3.5} textAnchor="end">
              {formatValue(t)}
            </text>
          </g>
        ))}

        {labels.map((lb, i) => {
          // Thin out x labels when they would collide — ~56px per label.
          const step = Math.ceil(labels.length / Math.max(3, Math.floor(innerW / 56)))
          if (i % step !== 0 && i !== labels.length - 1) return null
          return (
            <text key={i} className="chart-axis-label" x={x(i)} y={H - 8} textAnchor="middle">
              {lb}
            </text>
          )
        })}

        {hoverI != null && (
          <line x1={x(hoverI)} x2={x(hoverI)} y1={PAD.t} y2={PAD.t + innerH} stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="3 3" />
        )}

        {series.map((s, si) => {
          const pts = pointsFor(s)
          if (pts.length === 0) return null
          const d = smoothPath(pts)
          const areaD = `${d} L${pts[pts.length - 1]!.x},${PAD.t + innerH} L${pts[0]!.x},${PAD.t + innerH} Z`
          return (
            <g key={s.name}>
              {area && si === 0 && <path d={areaD} fill={`url(#la-${uid}-${si})`} />}
              <m.path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth="2.5"
                strokeLinecap="round"
                initial={reduced ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: si * 0.15 }}
              />
              {pts.map((p) => (
                <circle
                  key={p.i}
                  cx={p.x}
                  cy={p.y}
                  r={hoverI === p.i ? 5 : 3}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth="2"
                  opacity={pts.length > 24 && hoverI !== p.i ? 0 : 1}
                />
              ))}
            </g>
          )
        })}

        {/* Hover capture layer — bigger than any mark. */}
        <rect
          x={PAD.l}
          y={PAD.t}
          width={innerW}
          height={innerH}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => {
            setHoverI(null)
            hide()
          }}
        />
      </svg>
      </div>
      {overlay}
      <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} className="mt-3" />
    </div>
  )
}

/* ── Sparkline ───────────────────────────────────────────────────────────── */

export function Sparkline({
  values,
  color = 'var(--chart-1)',
  height = 40,
  className,
}: {
  values: (number | null)[]
  color?: string
  height?: number
  className?: string
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const clean = values.filter((v): v is number => v != null)
  if (clean.length < 2) return null
  const W = 160
  const max = Math.max(...clean)
  const min = Math.min(...clean)
  const span = max - min || 1
  const pts = clean.map((v, i) => ({ x: (i / (clean.length - 1)) * W, y: 4 + (height - 8) * (1 - (v - min) / span) }))
  const d = smoothPath(pts)
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className={cn('w-full', className)} style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={`sp-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${W},${height} L0,${height} Z`} fill={`url(#sp-${uid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/* ── Donut gauge (value vs goal) ─────────────────────────────────────────── */

/**
 * The "115% of monthly goal" ring. One value against one target — a gauge,
 * not a breakdown, so it takes a gradient stroke without lying about parts
 * of a whole.
 */
export function DonutGauge({
  value,
  max = 100,
  size = 168,
  thickness = 16,
  label,
  sublabel,
  from = '#f6a723',
  to = '#db2777',
  className,
}: {
  value: number
  max?: number
  size?: number
  thickness?: number
  label?: string
  sublabel?: string
  from?: string
  to?: string
  className?: string
}) {
  const reduced = useReducedMotion()
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(1, value / Math.max(max, 1)))
  return (
    <div className={cn('relative inline-grid place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label ?? 'Progress'}: ${Math.round((value / max) * 100)}%`}>
        <defs>
          <linearGradient id={`dg-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
        <m.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#dg-${uid})`}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          initial={reduced ? false : { strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - frac) }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="tnum text-[26px] font-bold leading-none">{label ?? `${Math.round((value / max) * 100)}%`}</p>
          {sublabel && <p className="mt-1 text-[11px] text-ink-3">{sublabel}</p>}
        </div>
      </div>
    </div>
  )
}

/* ── Donut breakdown (parts of a whole) ──────────────────────────────────── */

export interface DonutSegment {
  label: string
  value: number
  color: string
}

/**
 * Post-type / sentiment breakdown ring with 2px surface gaps between
 * segments (the dataviz spacer rule) and a per-segment hover tooltip.
 */
export function DonutBreakdown({
  segments,
  size = 150,
  thickness = 20,
  centerLabel,
  centerSub,
  className,
}: {
  segments: DonutSegment[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerSub?: string
  className?: string
}) {
  const { ref, show, hide, overlay } = useTip()
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const GAP = total > 0 && segments.filter((s) => s.value > 0).length > 1 ? 2.5 : 0

  let acc = 0
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const frac = total > 0 ? s.value / total : 0
      const start = acc
      acc += frac
      return { ...s, frac, start }
    })

  return (
    <div ref={ref} className={cn('relative inline-grid place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}>
        {total === 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />}
        {arcs.map((a) => {
          const len = Math.max(a.frac * c - GAP, 1)
          return (
            <circle
              key={a.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-a.start * c}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="cursor-pointer transition-opacity hover:opacity-80"
              onMouseMove={(e) =>
                show(e.clientX, e.clientY, (
                  <TipRow color={a.color} label={a.label} value={`${compact(a.value)} · ${Math.round(a.frac * 100)}%`} />
                ))
              }
              onMouseLeave={hide}
            />
          )
        })}
      </svg>
      {(centerLabel || centerSub) && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            {centerLabel && <p className="tnum text-xl font-bold leading-none">{centerLabel}</p>}
            {centerSub && <p className="mt-0.5 text-[10.5px] text-ink-3">{centerSub}</p>}
          </div>
        </div>
      )}
      {overlay}
    </div>
  )
}

/* ── Radar chart ─────────────────────────────────────────────────────────── */

export interface RadarSeries {
  name: string
  color: string
  /** One value per axis, same order as `axes`. */
  values: number[]
}

/** The "Followers Interest" spider chart. ≤3 series, translucent fills. */
export function RadarChart({
  axes,
  series,
  max,
  size = 300,
  className,
}: {
  axes: string[]
  series: RadarSeries[]
  max?: number
  size?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  const cx = size / 2
  const cy = size / 2
  const R = size / 2 - 42
  const maxV = max ?? Math.max(...series.flatMap((s) => s.values), 1)
  const n = axes.length

  const pt = (axis: number, frac: number) => {
    const ang = (Math.PI * 2 * axis) / n - Math.PI / 2
    return { x: cx + Math.cos(ang) * R * frac, y: cy + Math.sin(ang) * R * frac }
  }
  const ring = (frac: number) =>
    Array.from({ length: n }, (_, i) => {
      const p = pt(i, frac)
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    }).join(' ')

  return (
    <div className={cn('relative', className)}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full" role="img" aria-label={`Radar chart across ${axes.join(', ')}`}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon key={f} points={ring(f)} fill="none" className="chart-grid" />
        ))}
        {axes.map((_, i) => {
          const p = pt(i, 1)
          return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} className="chart-grid" />
        })}
        {series.slice(0, 3).map((s, si) => {
          const pts = s.values.map((v, i) => pt(i, Math.max(0, Math.min(1, v / maxV))))
          const d = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
          return (
            <m.g
              key={s.name}
              initial={reduced ? false : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ ...spring.settle, delay: si * 0.12 }}
              style={{ transformOrigin: `${cx}px ${cy}px` }}
            >
              <polygon points={d} fill={s.color} fillOpacity="0.14" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="3.5" fill={s.color} stroke="var(--surface)" strokeWidth="1.5">
                  <title>{`${s.name} · ${axes[i]}: ${s.values[i]}`}</title>
                </circle>
              ))}
            </m.g>
          )
        })}
        {axes.map((a, i) => {
          const p = pt(i, 1.16)
          return (
            <text key={a} x={p.x} y={p.y + 3} textAnchor="middle" className="chart-axis-label">
              {a}
            </text>
          )
        })}
      </svg>
      <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} className="mt-2 justify-center" />
    </div>
  )
}

/* ── Column chart ────────────────────────────────────────────────────────── */

export interface Column {
  label: string
  value: number
  /** Marks the column the reader should look at first. */
  highlight?: boolean
}

/**
 * The "Discovery" / "Best time to post" verticals: gradient columns, rounded
 * tops, 2px gaps, per-column hover tooltip, one highlighted column.
 */
export function ColumnChart({
  columns,
  height = 190,
  gradient = 'blue',
  formatValue = compact,
  className,
}: {
  columns: Column[]
  height?: number
  gradient?: 'blue' | 'violet' | 'sunset' | 'mint'
  formatValue?: (n: number | null | undefined) => string
  className?: string
}) {
  const reduced = useReducedMotion()
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const { ref, show, hide, overlay } = useTip()
  const { ref: mref, width: W } = useMeasuredWidth<HTMLDivElement>(520)
  const H = height
  const PAD = { l: 34, r: 8, t: 10, b: 24 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const maxV = Math.max(...columns.map((col) => col.value), 1)
  const bw = Math.min(34, (innerW / Math.max(columns.length, 1)) * 0.55)

  const stops: Record<string, [string, string]> = {
    blue: ['#46c6f5', '#2563eb'],
    violet: ['#a78bfa', '#6d28d9'],
    sunset: ['#f6a723', '#db2777'],
    mint: ['#34d399', '#0d9488'],
  }
  const [s0, s1] = stops[gradient] ?? stops['blue']!

  return (
    <div ref={ref} className={cn('relative', className)}>
      <div ref={mref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label="Column chart">
        <defs>
          <linearGradient id={`col-${uid}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={s0} />
            <stop offset="100%" stopColor={s1} />
          </linearGradient>
        </defs>
        {[0.5, 1].map((f) => (
          <line key={f} className="chart-grid" x1={PAD.l} x2={W - PAD.r} y1={PAD.t + innerH * (1 - f)} y2={PAD.t + innerH * (1 - f)} />
        ))}
        <text className="chart-axis-label" x={PAD.l - 6} y={PAD.t + 4} textAnchor="end">
          {formatValue(maxV)}
        </text>
        {columns.map((col, i) => {
          const h = Math.max((col.value / maxV) * innerH, col.value > 0 ? 3 : 0)
          const cxp = PAD.l + (innerW / columns.length) * (i + 0.5)
          return (
            <g key={`${col.label}-${i}`}>
              <m.rect
                x={cxp - bw / 2}
                width={bw}
                rx={Math.min(6, bw / 2)}
                fill={`url(#col-${uid})`}
                opacity={col.highlight === false ? 0.85 : col.highlight ? 1 : 0.85}
                initial={reduced ? false : { height: 0, y: PAD.t + innerH }}
                animate={{ height: h, y: PAD.t + innerH - h }}
                transition={{ ...spring.settle, delay: i * 0.04 }}
                onMouseMove={(e) => show(e.clientX, e.clientY, <TipRow label={col.label} value={formatValue(col.value)} />)}
                onMouseLeave={hide}
                className="cursor-pointer"
              />
              {col.highlight && (
                <circle cx={cxp} cy={PAD.t + innerH - h} r="5" fill={s1} stroke="var(--surface)" strokeWidth="2.5" />
              )}
              <text className="chart-axis-label" x={cxp} y={H - 6} textAnchor="middle">
                {col.label}
              </text>
            </g>
          )
        })}
      </svg>
      </div>
      {overlay}
    </div>
  )
}

/* ── Horizontal gradient bars with benchmark lines ───────────────────────── */

export interface HBarRow {
  label: string
  value: number
  /** Leading visual — an Avatar or PlatformBadge. */
  lead?: ReactNode
  /**
   * The second line beside the name: a role, a seat, or a set of platform
   * badges.
   *
   * A ReactNode rather than a string because a row can stand for a PERSON
   * rather than one account, and then the useful second line is which platforms
   * they are on — four small badges, not a sentence naming them.
   */
  sublabel?: ReactNode
  /** Marks the subject's own row. */
  emphasis?: boolean
}

/**
 * The "Avg. Engagement Rate" board from the competitor-overview reference:
 * one gradient bar per account over a full-width track, value labels on the
 * right in ink, and dotted vertical benchmark lines with pill labels.
 */
export function HBarBoard({
  rows,
  benchmarks = [],
  max,
  formatValue = (n) => `${n}`,
  className,
}: {
  rows: HBarRow[]
  benchmarks?: { label: string; value: number }[]
  max?: number
  formatValue?: (n: number) => string
  className?: string
}) {
  const reduced = useReducedMotion()
  const maxV = max ?? Math.max(...rows.map((r) => r.value), ...benchmarks.map((b) => b.value), 0.0001) * 1.08

  return (
    <div className={cn('relative', className)}>
      {/* Benchmark verticals span the full board, behind the bars. */}
      <div className="pointer-events-none absolute inset-y-0 left-[190px] right-[86px] hidden sm:block">
        {benchmarks.map((b) => (
          <div key={b.label} className="absolute inset-y-0" style={{ left: `${(b.value / maxV) * 100}%` }}>
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--accent-2)] px-2 py-0.5 text-[10px] font-bold text-white shadow-[var(--e2)]">
              {formatValue(b.value)}
            </div>
            <svg className="h-full w-[3px] overflow-visible" aria-hidden>
              <line x1="1.5" x2="1.5" y1="18" y2="100%" className="benchmark-line" />
            </svg>
          </div>
        ))}
      </div>

      {/* Each row names WHO it is before it measures them: the lead visual, the
          name, and the role or handle beneath it. A board of anonymous bars
          makes the reader match colours to a legend to learn anything. */}
      <div className={cn('space-y-3.5', benchmarks.length > 0 && 'pt-6')}>
        {rows.map((r, i) => (
          /* Two-row on a phone (identity above, bar below full-width), one row
             from sm up. A 375px screen cannot fit avatar + name column + bar +
             value on one line without the bar shrinking to a stub — and the
             bar IS the chart. */
          <div key={`${r.label}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:flex-nowrap" title={`${r.label}: ${formatValue(r.value)}`}>
            {r.lead && <div className="shrink-0">{r.lead}</div>}
            <div className="min-w-0 flex-1 basis-0 sm:w-[136px] sm:flex-none">
              <p className={cn('truncate text-[13px] leading-tight', r.emphasis ? 'font-bold text-ink' : 'font-semibold text-ink-2')}>
                {r.label}
              </p>
              {/* A div, not a p: the sublabel may now be badges rather than
                  text, and an element inside a paragraph is invalid markup that
                  React hydrates into a broken tree. `truncate` is dropped for
                  the same reason — it would clip the badge row. */}
              {r.sublabel != null && (
                <div className="min-w-0 text-[11px] leading-tight text-ink-3">{r.sublabel}</div>
              )}
            </div>
            <div className="tnum shrink-0 text-right text-sm sm:order-last sm:w-[74px]">
              <span className={cn(r.emphasis ? 'font-bold text-ink' : 'font-semibold text-ink-2')}>
                {formatValue(r.value)}
              </span>
            </div>
            <div className="relative h-3 w-full min-w-0 basis-full overflow-hidden rounded-full bg-[var(--surface-3)] sm:w-auto sm:flex-1 sm:basis-0">
              <m.div
                className="absolute inset-y-0 left-0 origin-left rounded-full"
                style={{ background: 'var(--grad-blue)', width: `${Math.min(100, (r.value / maxV) * 100)}%` }}
                initial={reduced ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ ...spring.settle, delay: 0.06 * i }}
              />
            </div>
          </div>
        ))}
      </div>

      {benchmarks.length > 0 && (
        <Legend
          className="mt-4"
          items={[
            { label: 'Tracked accounts', color: 'var(--chart-1)' },
            ...benchmarks.map((b) => ({ label: b.label, color: 'var(--accent-2)' })),
          ]}
        />
      )}
    </div>
  )
}

/* ── Progress row ────────────────────────────────────────────────────────── */

/** "Reels — 42.4% — 22,726 impressions": label, share, thin bar, detail. */
export function ProgressRow({
  label,
  fraction,
  detail,
  color = 'var(--chart-1)',
  delay = 0,
  className,
}: {
  label: string
  /** 0…1 */
  fraction: number
  detail?: string
  color?: string
  delay?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="tnum text-sm font-semibold text-ink-2">{Math.round(fraction * 1000) / 10}%</p>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <m.div
          className="h-full origin-left rounded-full"
          style={{ background: color, width: `${Math.min(100, fraction * 100)}%` }}
          initial={reduced ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ ...spring.settle, delay }}
        />
      </div>
      {detail && <p className="mt-1 text-[11px] text-ink-3">{detail}</p>}
    </div>
  )
}

/* ── Pill tabs ───────────────────────────────────────────────────────────── */

export function PillTabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { id: T; label: string }[]
  active: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={cn('pill-tabs max-w-full overflow-x-auto', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className="pill-tab"
          onClick={() => onChange(t.id)}
          type="button"
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/* ── Post thumbnail card ─────────────────────────────────────────────────── */

/**
 * The "Most Engaging Posts" card: media on top, platform badge + duration
 * chip overlaid, author row and date beneath. Until the gated platforms have
 * stored posts, the thumbnails come from YouTube reads — the one platform
 * that hands us imagery freely.
 */
export function PostThumbCard({
  thumbnailUrl,
  platform,
  title,
  author,
  authorLead,
  metaLine,
  badge,
  onClick,
  onAnalyse,
  href,
  className,
}: {
  thumbnailUrl?: string | null
  platform: string
  title?: string | null
  author?: string | null
  authorLead?: ReactNode
  metaLine?: string | null
  /** Top-right overlay — a DeltaChip or rank star. */
  badge?: ReactNode
  onClick?: () => void
  /** Runs an AI analysis of this post — renders an overlaid "Analyse" button. */
  onAnalyse?: () => void
  href?: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const Tag: 'a' | 'button' | 'div' = href ? 'a' : onClick ? 'button' : 'div'
  return (
    <Tag
      {...(href ? { href, target: '_blank', rel: 'noreferrer noopener' } : {})}
      {...(onClick && !href ? { onClick, type: 'button' as const } : {})}
      className={cn(
        'card card-hover group relative block w-[160px] shrink-0 overflow-hidden p-0 text-left sm:w-[186px]',
        (onClick || href) && 'cursor-pointer',
        className,
      )}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-[var(--surface-3)]">
        {thumbnailUrl && !failed ? (
          <img
            src={thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
          />
        ) : title ? (
          /**
           * A post with no picture is not a post with no content.
           *
           * Most of what a politician publishes on X, Facebook and LinkedIn is
           * words: a condolence, a greeting, a line about a phone call. There
           * is no image to fetch and there never will be, so treating those as
           * a failed thumbnail was answering the wrong question. The old
           * fallback washed the tile in brand colour and centred a 44px
           * platform logo in it — the same logo already sitting in the corner
           * two centimetres away — which is why a strip of them read as a row
           * of broken images rather than a row of text posts.
           *
           * So show what it said. The text is the artwork, and a reader
           * scanning the strip can now tell these posts apart from each other
           * instead of seeing four identical logos.
           */
          <div
            className="flex size-full flex-col justify-center px-3.5 pb-12 pt-10"
            style={{
              background: `linear-gradient(157deg, ${brandTint(platform)} 0%, var(--surface-2) 68%)`,
            }}
          >
            <Quote
              size={13}
              className="mb-1.5 shrink-0 text-ink-3 opacity-60"
              fill="currentColor"
              strokeWidth={0}
              aria-hidden
            />
            <p className="line-clamp-6 text-[12.5px] font-medium leading-[1.45] text-ink-2">
              {title}
            </p>
          </div>
        ) : (
          /**
           * Neither picture nor words came back for this one. Rare, and it
           * stays quiet: a muted ground and a small glyph that says "no
           * image", rather than a brand wash that implies the tile is still
           * loading something.
           */
          <div className="grid size-full place-items-center bg-[var(--surface-3)]">
            <ImageOff size={20} className="text-ink-3 opacity-45" aria-hidden />
          </div>
        )}
        {/* Legibility scrim so the overlays never sit on a bright still. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/35 to-transparent" />
        <div className="absolute left-2 top-2">
          <PlatformBadge platform={platform} size={24} />
        </div>
        {badge && <div className="absolute right-2 top-2">{badge}</div>}

        {/* Analyse — slides up on hover (always visible on touch). Stops the
            card's own click so a tap on it runs the analysis, not navigation. */}
        {onAnalyse && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onAnalyse()
            }}
            className="absolute inset-x-2 bottom-2 flex min-h-9 translate-y-0 items-center justify-center gap-1.5 rounded-full bg-white/95 text-[12.5px] font-semibold text-[var(--accent)] shadow-[var(--e2)] backdrop-blur transition-all hover:bg-white hover:shadow-[var(--e3)] sm:bottom-2.5 sm:translate-y-1 sm:opacity-90 sm:group-hover:translate-y-0 sm:group-hover:opacity-100"
          >
            <Sparkles size={14} strokeWidth={2.4} aria-hidden />
            Analyse
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 p-3">
        {authorLead}
        <div className="min-w-0">
          {author && <p className="truncate text-[12.5px] font-semibold text-ink">{author}</p>}
          {/* `metaLine ?? title` would repeat the post's text on a card whose
              face is already that text, so the title only fills in when it was
              not used above. */}
          {(metaLine ?? (thumbnailUrl && !failed ? title : null)) && (
            <p className="mt-0.5 truncate text-[11px] text-ink-3">
              {metaLine ?? title}
            </p>
          )}
        </div>
      </div>
    </Tag>
  )
}

/** A platform's brand colour at low alpha, for gradient washes. */
function brandTint(platform: string): string {
  const solid: Record<string, string> = {
    Instagram: 'rgba(221,42,123,0.28)',
    Facebook: 'rgba(24,119,242,0.24)',
    'Twitter/X': 'rgba(30,30,35,0.22)',
    YouTube: 'rgba(255,0,51,0.20)',
    LinkedIn: 'rgba(10,102,194,0.24)',
    Threads: 'rgba(20,20,20,0.20)',
    Bluesky: 'rgba(17,133,254,0.24)',
    Telegram: 'rgba(38,165,228,0.24)',
  }
  return solid[platform] ?? 'rgba(37,99,235,0.20)'
}

/* ── YouTube thumbnail derivation ────────────────────────────────────────── */

/**
 * Stored posts carry no imagery, but a YouTube URL names its own thumbnail:
 * i.ytimg.com serves stills by video id to anyone. Until the gated platforms
 * have supplied post links, this is what fills every media slot honestly —
 * the one platform that hands us pictures freely.
 */
export function youtubeThumb(url: string): string | null {
  try {
    const u = new URL(url)
    let id: string | null = null
    if (/(^|\.)youtu\.be$/.test(u.hostname)) id = u.pathname.split('/')[1] ?? null
    else if (/youtube\.com$/.test(u.hostname)) {
      id =
        u.searchParams.get('v') ??
        u.pathname.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{6,})/)?.[1] ??
        null
    }
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null
  } catch {
    return null
  }
}

/* ── Ranked list row ─────────────────────────────────────────────────────── */

/** "#1 · #urbanjungle · 223,053 views" — the numbered soft-badge list. */
export function RankRow({
  rank,
  label,
  value,
  tint = 'blue',
  onClick,
  title,
  className,
}: {
  rank: number
  label: ReactNode
  value: string
  tint?: Tint
  /** Makes the whole row a button — e.g. to analyse the post it names. */
  onClick?: () => void
  title?: string
  className?: string
}) {
  const t = TINTS[tint]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { onClick, type: 'button' as const, title } : { title })}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl py-1.5 text-left transition-colors',
        onClick && 'group -mx-2 px-2 hover:bg-[var(--surface-2)]',
        className,
      )}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-bold" style={{ background: t.bg, color: t.fg }}>
        {rank}
      </span>
      <div className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{label}</div>
      <span className="tnum shrink-0 text-[13px] font-medium text-ink-3">{value}</span>
      {onClick && (
        <Sparkles
          size={14}
          className="shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      )}
    </Tag>
  )
}

/* ── India constituency / news-origin map ────────────────────────────────── */

export interface MapMarker {
  lon: number
  lat: number
  label: string
  /** Second line — a count, a state, a sentiment word. */
  detail?: string
  tone?: 'accent' | 'positive' | 'warning' | 'negative' | 'violet'
  /** Relative weight 0…1 → marker size. Defaults to a mid dot. */
  weight?: number
}

export interface MapZone {
  lon: number
  lat: number
  /** Radius in degrees — the constituency's rough reach. */
  radiusDeg: number
  label?: string
}

const MARKER_TONE: Record<string, string> = {
  accent: 'var(--accent)',
  positive: 'var(--pos)',
  warning: 'var(--warn)',
  negative: 'var(--neg)',
  violet: 'var(--accent-2)',
}

/**
 * A dotted map of India that can light a home zone (the constituency) and drop
 * weighted, animated markers (news origins, mentions by area). Same honest
 * contract as everything else: callers pass coordinates from the gazetteer,
 * and anything that will not resolve is simply not drawn — never guessed onto
 * the map.
 *
 * Projection matches india-dots.ts: lon [lon0,lon1] → x 0…100, lat [lat1,lat0]
 * → y 0…H. Aspect follows the bbox so the subcontinent is not stretched.
 */
export function IndiaMap({
  dots,
  bbox,
  zones = [],
  markers = [],
  height,
  /** The party/home colour for the lit zone and its dots. Defaults to accent. */
  accentColor = 'var(--accent)',
  className,
}: {
  dots: ReadonlyArray<readonly [number, number]>
  bbox: { lon0: number; lon1: number; lat0: number; lat1: number }
  zones?: MapZone[]
  markers?: MapMarker[]
  /** SVG height in the 0…100-wide frame. Defaults to bbox aspect. */
  height?: number
  accentColor?: string
  className?: string
}) {
  const reduced = useReducedMotion()
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const { ref, show, hide, overlay } = useTip()
  const spanLon = bbox.lon1 - bbox.lon0
  const spanLat = bbox.lat1 - bbox.lat0
  const H = height ?? Math.round((spanLat / spanLon) * 100)
  const X = (lon: number) => ((lon - bbox.lon0) / spanLon) * 100
  const Y = (lat: number) => ((bbox.lat1 - lat) / spanLat) * H

  return (
    <div ref={ref} className={cn('relative', className)}>
      <svg viewBox={`0 0 100 ${H}`} className="w-full" role="img" aria-label="Map of India with tracked locations">
        <defs>
          <radialGradient id={`zone-${uid}`}>
            <stop offset="0%" stopColor={accentColor} stopOpacity="0.4" />
            <stop offset="65%" stopColor={accentColor} stopOpacity="0.14" />
            <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
          </radialGradient>
          {/* Soft depth: dots carry a faint drop so the map reads raised. */}
          <filter id={`dotsh-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0.25" stdDeviation="0.25" floodColor={accentColor} floodOpacity="0.35" />
          </filter>
        </defs>

        {/* Home zones under the dots, so the lit region reads as ground glow. */}
        {zones.map((z, i) => (
          <g key={i}>
            <circle cx={X(z.lon)} cy={Y(z.lat)} r={(z.radiusDeg / spanLon) * 100} fill={`url(#zone-${uid})`} />
            {!reduced && (
              <circle cx={X(z.lon)} cy={Y(z.lat)} r={(z.radiusDeg / spanLon) * 100} fill="none" stroke={accentColor} strokeWidth="0.4" opacity="0.5">
                <animate attributeName="r" values={`0;${(z.radiusDeg / spanLon) * 100}`} dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.6;0" dur="2.4s" repeatCount="indefinite" />
              </circle>
            )}
          </g>
        ))}

        {/* The land, as blue dots. Dots inside a zone take the party colour and
            a soft glow, so the office's ground reads at a glance. */}
        {dots.map(([lon, lat], i) => {
          const lit = zones.some((z) => Math.hypot(lon - z.lon, lat - z.lat) <= z.radiusDeg)
          return (
            // Same radius for every dot — the land reads as one even weave and
            // the office's ground is distinguished by COLOUR alone. A larger
            // lit dot made the constituency look like a blot, and a radius
            // near the grid step (1.0 unit) makes neighbours touch and the
            // whole map turn to mush. 0.34 keeps a clear gap on every side.
            <circle
              key={i}
              cx={X(lon)}
              cy={Y(lat)}
              r={0.34}
              fill={lit ? accentColor : 'color-mix(in oklab, var(--accent) 55%, var(--border-strong))'}
              opacity={lit ? 1 : 0.62}
            />
          )
        })}

        {/* Markers on top, sized by weight, with a soft halo and hover. */}
        {markers.map((mk, i) => {
          const color = MARKER_TONE[mk.tone ?? 'negative'] ?? 'var(--neg)'
          const r = 0.9 + (mk.weight ?? 0.5) * 1.8
          return (
            <g
              key={`${mk.label}-${i}`}
              className="cursor-pointer"
              onMouseMove={(e) =>
                show(e.clientX, e.clientY, (
                  <div>
                    <p className="font-semibold text-ink">{mk.label}</p>
                    {mk.detail && <p className="text-ink-2">{mk.detail}</p>}
                  </div>
                ))
              }
              onMouseLeave={hide}
            >
              <circle cx={X(mk.lon)} cy={Y(mk.lat)} r={r * 2.2} fill={color} opacity="0.16" />
              <m.circle
                cx={X(mk.lon)}
                cy={Y(mk.lat)}
                r={r}
                fill={color}
                stroke="var(--surface)"
                strokeWidth="0.4"
                initial={reduced ? false : { scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ ...spring.pop, delay: 0.15 + i * 0.06 }}
                style={{ transformOrigin: `${X(mk.lon)}px ${Y(mk.lat)}px` }}
              />
            </g>
          )
        })}
      </svg>
      {overlay}
      {zones.some((z) => z.label) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {zones
            .filter((z) => z.label)
            .map((z) => (
              <span key={z.label} className="flex items-center gap-1.5">
                <i className="size-2.5 rounded-full" style={{ background: accentColor }} />
                {z.label}
              </span>
            ))}
        </div>
      )}
    </div>
  )
}

/* ── Stacked column chart ────────────────────────────────────────────────── */

export interface StackGroup {
  label: string
  /** One value per series, same order as `series`. */
  values: number[]
}

/**
 * The "Audience ages" stacked columns (reference 5). Segments carry a 2px
 * surface gap (the dataviz spacer rule) and a per-segment hover tooltip.
 */
export function StackedColumnChart({
  groups,
  series,
  height = 200,
  formatValue = (n) => `${n}`,
  className,
}: {
  groups: StackGroup[]
  series: { name: string; color: string }[]
  height?: number
  formatValue?: (n: number) => string
  className?: string
}) {
  const reduced = useReducedMotion()
  const { ref, show, hide, overlay } = useTip()
  const W = 520
  const PAD = { l: 40, r: 8, t: 12, b: 26 }
  const innerW = W - PAD.l - PAD.r
  const innerH = height - PAD.t - PAD.b
  const totals = groups.map((g) => g.values.reduce((s, v) => s + Math.max(0, v), 0))
  const maxV = Math.max(...totals, 1)
  const bw = Math.min(40, (innerW / Math.max(groups.length, 1)) * 0.6)

  return (
    <div ref={ref} className={cn('relative', className)}>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="Stacked column chart">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="chart-grid" x1={PAD.l} x2={W - PAD.r} y1={PAD.t + innerH * (1 - f)} y2={PAD.t + innerH * (1 - f)} />
            <text className="chart-axis-label" x={PAD.l - 6} y={PAD.t + innerH * (1 - f) + 3} textAnchor="end">
              {formatValue(maxV * f)}
            </text>
          </g>
        ))}
        {groups.map((g, gi) => {
          const cx = PAD.l + (innerW / groups.length) * (gi + 0.5)
          let acc = 0
          return (
            <g key={g.label}>
              {g.values.map((v, si) => {
                const h = (Math.max(0, v) / maxV) * innerH
                const y = PAD.t + innerH - acc - h
                acc += h + 2 // 2px surface gap between segments
                const s = series[si]
                if (!s || h <= 0) return null
                return (
                  <m.rect
                    key={si}
                    x={cx - bw / 2}
                    width={bw}
                    y={y}
                    rx="2"
                    fill={s.color}
                    initial={reduced ? false : { height: 0, y: PAD.t + innerH }}
                    animate={{ height: Math.max(h - 2, 0), y }}
                    transition={{ ...spring.settle, delay: gi * 0.05 + si * 0.03 }}
                    className="cursor-pointer"
                    onMouseMove={(e) => show(e.clientX, e.clientY, <TipRow color={s.color} label={`${g.label} · ${s.name}`} value={formatValue(v)} />)}
                    onMouseLeave={hide}
                  />
                )
              })}
              <text className="chart-axis-label" x={cx} y={height - 8} textAnchor="middle">
                {g.label}
              </text>
            </g>
          )
        })}
      </svg>
      {overlay}
      <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} className="mt-3" />
    </div>
  )
}

/* ── Grouped column chart (side-by-side compare) ─────────────────────────── */

/** Compare N entities across M categories — the graphical half of Compare. */
export function GroupedColumnChart({
  categories,
  series,
  height = 220,
  formatValue = compact,
  className,
}: {
  categories: string[]
  series: { name: string; color: string; values: number[] }[]
  height?: number
  formatValue?: (n: number | null | undefined) => string
  className?: string
}) {
  const reduced = useReducedMotion()
  const { ref, show, hide, overlay } = useTip()
  const W = 640
  const PAD = { l: 42, r: 10, t: 12, b: 28 }
  const innerW = W - PAD.l - PAD.r
  const innerH = height - PAD.t - PAD.b
  const maxV = Math.max(...series.flatMap((s) => s.values), 1)
  const groupW = innerW / Math.max(categories.length, 1)
  const bw = Math.min(26, (groupW * 0.8) / Math.max(series.length, 1))

  return (
    <div ref={ref} className={cn('relative', className)}>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="Grouped column comparison">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="chart-grid" x1={PAD.l} x2={W - PAD.r} y1={PAD.t + innerH * (1 - f)} y2={PAD.t + innerH * (1 - f)} />
            <text className="chart-axis-label" x={PAD.l - 6} y={PAD.t + innerH * (1 - f) + 3} textAnchor="end">
              {formatValue(maxV * f)}
            </text>
          </g>
        ))}
        {categories.map((cat, ci) => {
          const gx = PAD.l + groupW * ci
          const totalBarsW = bw * series.length + 2 * (series.length - 1)
          const startX = gx + (groupW - totalBarsW) / 2
          return (
            <g key={cat}>
              {series.map((s, si) => {
                const v = s.values[ci] ?? 0
                const h = (v / maxV) * innerH
                const x = startX + si * (bw + 2)
                return (
                  <m.rect
                    key={s.name}
                    x={x}
                    width={bw}
                    rx="3"
                    fill={s.color}
                    initial={reduced ? false : { height: 0, y: PAD.t + innerH }}
                    animate={{ height: h, y: PAD.t + innerH - h }}
                    transition={{ ...spring.settle, delay: ci * 0.05 + si * 0.04 }}
                    className="cursor-pointer"
                    onMouseMove={(e) => show(e.clientX, e.clientY, <TipRow color={s.color} label={`${s.name} · ${cat}`} value={formatValue(v)} />)}
                    onMouseLeave={hide}
                  />
                )
              })}
              <text className="chart-axis-label" x={gx + groupW / 2} y={height - 9} textAnchor="middle">
                {cat}
              </text>
            </g>
          )
        })}
      </svg>
      {overlay}
      <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} className="mt-3" />
    </div>
  )
}

/* ── Platform / channel switcher ─────────────────────────────────────────── */

/**
 * The circle-badge channel switcher from reference 1, plus an "All" pill. One
 * selected at a time; brand badges carry identity. Purely presentational — the
 * caller owns the filter state.
 */
export function PlatformSwitcher({
  platforms,
  active,
  onChange,
  className,
}: {
  /** Platform names present in the data, in display order. */
  platforms: string[]
  /** null = "All". */
  active: string | null
  onChange: (p: string | null) => void
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-2', className)} role="tablist" aria-label="Filter by platform">
      <button
        type="button"
        role="tab"
        aria-selected={active === null}
        onClick={() => onChange(null)}
        className={cn(
          'min-h-9 rounded-full px-3.5 text-sm font-semibold transition-colors',
          active === null ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--e1)]' : 'bg-[var(--surface)] text-ink-2 border border-[var(--border)] hover:text-ink',
        )}
      >
        All
      </button>
      {platforms.map((p) => (
        <button
          key={p}
          type="button"
          role="tab"
          aria-selected={active === p}
          onClick={() => onChange(p)}
          title={p}
          className={cn(
            'grid size-9 place-items-center rounded-full transition-transform',
            active === p ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]' : 'opacity-60 hover:opacity-100',
          )}
        >
          <PlatformBadge platform={p} size={36} />
        </button>
      ))}
    </div>
  )
}

/* ── Profile hero card ───────────────────────────────────────────────────── */

/**
 * The influencer/profile hero (reference 5): a big media panel with the handle
 * over a gradient scrim, an optional platform badge, and a caption line.
 */
export function ProfileHeroCard({
  name,
  handle,
  platform,
  photoUrl,
  caption,
  className,
}: {
  name: string
  handle?: string | null
  platform?: string
  photoUrl?: string | null
  caption?: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <div className={cn('card card-hover relative aspect-[4/5] overflow-hidden p-0', className)}>
      {photoUrl && !failed ? (
        <img src={photoUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        // No photo: a soft branded gradient with a big monogram and the
        // platform badge — never a flat brand slab, which reads as broken.
        <div
          className="grid size-full place-items-center"
          style={{ background: `radial-gradient(130% 130% at 50% 0%, ${brandTint(platform ?? '')} 0%, var(--surface-3) 60%, var(--surface-2) 100%)` }}
        >
          <div className="grid place-items-center gap-3 pb-14">
            <span className="grid size-16 place-items-center rounded-full bg-[var(--surface)] text-[22px] font-bold text-ink-2 shadow-[var(--e2)]">
              {initials || '·'}
            </span>
            {platform && <PlatformBadge platform={platform} size={30} />}
          </div>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-4 pt-12">
        <div className="flex items-center gap-2">
          {platform && <PlatformBadge platform={platform} size={22} />}
          <p className="text-lg font-bold leading-tight text-white">{name}</p>
        </div>
        {handle && <p className="mt-0.5 text-sm text-white/85">@{handle}</p>}
        {caption && <p className="mt-1 text-xs text-white/75">{caption}</p>}
      </div>
    </div>
  )
}

/* ── Stat tile with sparkline ────────────────────────────────────────────── */

/**
 * IconStat's richer cousin: a headline number with a delta AND a trend
 * sparkline, for the account cards. Trend colour follows the delta sign.
 */
export function StatSpark({
  icon,
  label,
  value,
  display,
  delta,
  trend,
  tint = 'blue',
  className,
}: {
  icon: ReactNode
  label: string
  value: number | null
  display?: string
  delta?: number | null
  trend?: (number | null)[]
  tint?: Tint
  className?: string
}) {
  const t = TINTS[tint]
  const trendColor = delta == null || delta === 0 ? 'var(--chart-mid)' : delta > 0 ? 'var(--pos)' : 'var(--neg)'
  return (
    <div className={cn('card card-hover flex flex-col gap-2 p-4', className)}>
      <div className="flex items-center justify-between">
        <span className="icon-badge-sm" style={{ background: t.bg, color: t.fg }}>
          {icon}
        </span>
        {delta !== undefined && <DeltaChip value={delta} />}
      </div>
      <div>
        <p className="text-[12px] font-medium text-ink-3">{label}</p>
        <p className="tnum text-[22px] font-bold leading-none tracking-[-0.02em]">
          {display ?? (value == null ? '—' : value < 100_000 ? <NumberFlow value={value} /> : compact(value))}
        </p>
      </div>
      {trend && trend.filter((v) => v != null).length >= 2 && <Sparkline values={trend} color={trendColor} height={32} />}
    </div>
  )
}

/* ── Dotted map ──────────────────────────────────────────────────────────── */

export interface MapPin {
  /** Longitude, latitude. */
  lon: number
  lat: number
  label: string
  value: string
}

/**
 * The dotted-world panel with location pills. Dots come from
 * `world-dots.ts`, generated offline from Natural Earth land polygons —
 * no runtime geo dependency, no network. Equirectangular, lon −180…180 →
 * x 0…100, lat 84…−56 → y 0…100 (the generator's frame).
 */
export function DottedMap({
  dots,
  pins = [],
  accents = [],
  className,
}: {
  /** [x, y] pairs on a 0…100 grid, from world-dots.ts. */
  dots: ReadonlyArray<readonly [number, number]>
  pins?: MapPin[]
  /** Dot indexes to tint accent-blue (a lit region, e.g. India). */
  accents?: ReadonlySet<number> | number[]
  className?: string
}) {
  const accentSet = useMemo(() => (accents instanceof Set ? accents : new Set(accents)), [accents])
  const project = (lon: number, lat: number) => ({
    x: ((lon + 180) / 360) * 100,
    y: ((84 - lat) / 140) * 100,
  })
  return (
    <div className={cn('relative', className)}>
      <svg viewBox="0 0 100 56" className="w-full" role="img" aria-label="World map of audience locations">
        {dots.map(([dx, dy], i) => (
          <circle
            key={i}
            cx={dx}
            cy={dy * 0.56}
            r="0.34"
            fill={accentSet.has(i) ? 'var(--accent)' : 'var(--border-strong)'}
            opacity={accentSet.has(i) ? 0.9 : 0.55}
          />
        ))}
      </svg>
      {pins.map((p) => {
        const { x, y } = project(p.lon, p.lat)
        return (
          <div
            key={p.label}
            className="absolute -translate-x-1/2 -translate-y-full"
            style={{ left: `${x}%`, top: `${y * 0.56 + 2}%` } as CSSProperties}
          >
            <div className="whitespace-nowrap rounded-lg bg-[var(--accent)] px-2 py-1 text-[10px] font-bold leading-tight text-white shadow-[var(--e2)]">
              {p.label}
              <span className="ml-1 font-extrabold">{p.value}</span>
            </div>
            <div className="mx-auto size-1.5 -translate-y-[1px] rotate-45 bg-[var(--accent)]" />
          </div>
        )
      })}
    </div>
  )
}
