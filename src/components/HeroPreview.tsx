import { useRef } from 'react'
import * as m from 'motion/react-m'
import { useMotionValue, useSpring, useTransform, useReducedMotion } from 'motion/react'
import { ArrowUpRight, Heart, MessageCircle, Repeat2, Eye } from 'lucide-react'
import { PlatformBadge } from '@/components/kit'
import { Chip } from './ui'
import { spring } from '@/lib/motion'

/**
 * A miniature of a real report, on the home screen.
 *
 * The home screen was a form: a headline, a field and a button, asking the
 * user to imagine what they would get back. Everything premium-feeling this
 * product was compared against — Linear, 21st.dev — shows the output on the
 * way in rather than describing it. So this is the actual thing, at a quarter
 * scale: the verdict, a sentiment reading, the counts — floating on a soft
 * blue-cast shadow so it reads as the product, not the page.
 *
 * Static content on purpose. It is a specimen, not a live fetch — nothing here
 * should cost a request or a model call before the user has asked for one, and
 * the figures are from the worked example the demo route already serves.
 */
export function HeroPreview({ onOpen }: { onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const reduced = useReducedMotion()

  // Pointer position, normalised to -0.5…0.5 across the card.
  const px = useMotionValue(0)
  const py = useMotionValue(0)
  // Springs rather than raw values: the card settles instead of snapping,
  // which is the difference between a gimmick and something that feels solid.
  const rx = useSpring(useTransform(py, [-0.5, 0.5], ['7deg', '-7deg']), {
    stiffness: 220,
    damping: 22,
  })
  const ry = useSpring(useTransform(px, [-0.5, 0.5], ['-9deg', '9deg']), {
    stiffness: 220,
    damping: 22,
  })

  const track = (e: React.PointerEvent) => {
    if (reduced) return
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    px.set((e.clientX - r.left) / r.width - 0.5)
    py.set((e.clientY - r.top) / r.height - 0.5)
  }

  const release = () => {
    px.set(0)
    py.set(0)
  }

  return (
    <m.button
      ref={ref}
      type="button"
      onClick={onOpen}
      onPointerMove={track}
      onPointerLeave={release}
      aria-label="Open a worked example report"
      className="group relative block w-full text-left [perspective:1200px]"
      initial={{ opacity: 0, y: 22, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring.glide, delay: 0.24 }}
      whileTap={{ scale: 0.985 }}
    >
      {/* The glow that gives the card somewhere to sit. Pure gradient, no
          blur filter — this sits behind a card on every page load. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-x-6 -bottom-6 -top-3 -z-10 rounded-[32px] opacity-70"
        style={{
          background:
            'radial-gradient(60% 60% at 50% 40%, color-mix(in oklab, var(--accent) 30%, transparent) 0%, transparent 70%)',
        }}
      />

      <m.div
        className="card overflow-hidden p-0 shadow-[var(--e4)] [transform-style:preserve-3d]"
        style={{ rotateX: rx, rotateY: ry }}
      >
        {/* Header strip */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5">
          <span className="flex min-w-0 items-center gap-2">
            <PlatformBadge platform="Twitter/X" size={20} />
            <span className="truncate text-xs font-semibold text-ink-2">greatandhranews</span>
          </span>
          <span className="kicker shrink-0">Worked example</span>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="accent">Corruption</Chip>
            <Chip tone="warning">Civic</Chip>
          </div>

          <p className="hed mt-3 text-lg leading-snug">
            News outlet accuses the Home Minister of seizing a woman’s land
          </p>

          {/* Sentiment, at a glance */}
          <div className="mt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-bold text-[var(--chart-neg)]">Strong Negative</span>
              <span className="tnum text-xs font-bold text-[var(--chart-neg)]">−78</span>
            </div>
            <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
              <m.span
                className="absolute inset-y-0 left-0 w-full origin-left rounded-full"
                style={{ background: 'var(--chart-neg)' }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 0.22 }}
                transition={{ ...spring.settle, delay: 0.6 }}
              />
            </div>
          </div>

          {/* The counts */}
          <div className="mt-4 grid grid-cols-4 gap-2 border-t border-[var(--border)] pt-3.5">
            {[
              [<Heart key="h" size={12} />, '546'],
              [<MessageCircle key="c" size={12} />, '9'],
              [<Repeat2 key="r" size={12} />, '165'],
              [<Eye key="v" size={12} />, '15.3K'],
            ].map(([icon, value], i) => (
              <span key={i} className="min-w-0">
                <span className="flex items-center gap-1 text-ink-3">{icon}</span>
                <span className="tnum mt-1 block text-sm font-bold text-ink">{value}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Footer call to action */}
        <span className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs font-bold text-[var(--accent)]">
          See the full report
          <ArrowUpRight size={14} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </span>
      </m.div>
    </m.button>
  )
}
