import * as m from 'motion/react-m'
import { AnimatePresence } from 'motion/react'
import { useReducedMotion } from 'motion/react'
import { spring } from '@/lib/motion'
import { cn } from '@/lib/utils'

export type MascotState = 'idle' | 'thinking' | 'success' | 'error' | 'empty'

/**
 * "Pip" — the antenna creature that hosts the waiting screen.
 *
 * Two-state model, the way Duolingo and Rive do it: an IDLE loop that always
 * runs, plus REACTIVE states triggered by real pipeline events that play and
 * settle back. A character that ever goes fully static reads as a broken
 * image, so the breathing never stops — it only changes tempo.
 *
 * Built as inline SVG rather than a Rive/Lottie file so there is no runtime to
 * download, nothing to lazy-load before first paint, and it inherits the theme
 * tokens automatically in both light and dark.
 */
export function Mascot({
  state = 'idle',
  size = 132,
  className,
}: {
  state?: MascotState
  size?: number
  className?: string
}) {
  const reduced = useReducedMotion()

  // Breathing speeds up when it is working and relaxes when it is done.
  const tempo = state === 'thinking' ? 1.6 : state === 'success' ? 2.4 : 3.6

  const body = reduced
    ? {}
    : {
        animate:
          state === 'success'
            ? { scale: [1, 1.14, 0.96, 1.04, 1], y: [0, -14, 2, -4, 0], rotate: [0, -4, 3, -1, 0] }
            : { scale: [1, 1.035, 1], rotate: [0, 1.2, 0, -1.2, 0], y: [0, -3, 0] },
        transition:
          state === 'success'
            ? ({ duration: 0.9, ease: [0.16, 1, 0.3, 1] } as const)
            : ({
                duration: tempo,
                repeat: Infinity,
                ease: 'easeInOut',
                repeatType: 'mirror',
              } as const),
      }

  const accent =
    state === 'success' ? 'var(--pos)' : state === 'error' ? 'var(--neg)' : 'var(--accent)'

  return (
    <m.div
      className={cn('relative select-none', className)}
      style={{ width: size, height: size, transformOrigin: 'bottom center' }}
      {...body}
    >
      <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
        <defs>
          <radialGradient id="pip-body" cx="38%" cy="30%">
            <stop offset="0%" stopColor="color-mix(in oklab, var(--surface) 92%, white)" />
            <stop offset="100%" stopColor="var(--surface-3)" />
          </radialGradient>
          <linearGradient id="pip-glow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.55" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Contact shadow — grounds the character so it squashes against a
            surface rather than floating in mid-air. */}
        <ellipse cx="60" cy="108" rx="26" ry="5" fill="rgb(0 0 0 / 0.18)" />

        {/* Antenna */}
        <path
          d="M60 34 Q60 22 60 18"
          stroke="var(--border-strong)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        {/* Pulse via `scale`, never the `r` attribute: `r` is a layout property
            that forces a re-layout every frame, and Motion emits an undefined
            first value for it, which SVG rejects outright. */}
        {!reduced ? (
          <m.circle
            cx="60"
            cy="15"
            r="6"
            fill={accent}
            style={{ transformOrigin: '60px 15px' }}
            animate={
              state === 'thinking'
                ? { scale: [0.85, 1.25, 0.85], opacity: [0.75, 1, 0.75] }
                : { scale: [0.95, 1.1, 0.95], opacity: [0.85, 1, 0.85] }
            }
            transition={{
              duration: state === 'thinking' ? 0.85 : 2.2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        ) : (
          <circle cx="60" cy="15" r="6" fill={accent} />
        )}

        {/* Signal rings — only while it is genuinely working */}
        {state === 'thinking' && !reduced && (
          <>
            {[0, 0.45, 0.9].map((delay) => (
              <m.circle
                key={delay}
                cx="60"
                cy="15"
                r="6"
                fill="none"
                stroke={accent}
                strokeWidth="1.5"
                initial={{ scale: 1, opacity: 0.6 }}
                animate={{ scale: 3.2, opacity: 0 }}
                transition={{ duration: 1.35, repeat: Infinity, delay, ease: 'easeOut' }}
                style={{ transformOrigin: '60px 15px' }}
              />
            ))}
          </>
        )}

        {/* Body */}
        <rect x="24" y="34" width="72" height="66" rx="26" fill="url(#pip-body)" stroke="var(--border-strong)" strokeWidth="2" />
        <rect x="24" y="34" width="72" height="34" rx="26" fill="url(#pip-glow)" opacity="0.5" />

        {/* Face */}
        <Eyes state={state} reduced={Boolean(reduced)} />
        <Mouth state={state} reduced={Boolean(reduced)} />
      </svg>
    </m.div>
  )
}

function Eyes({ state, reduced }: { state: MascotState; reduced: boolean }) {
  if (state === 'success') {
    // Happy closed arcs.
    return (
      <g stroke="var(--text)" strokeWidth="3.5" strokeLinecap="round" fill="none">
        <path d="M42 62 q6 -7 12 0" />
        <path d="M66 62 q6 -7 12 0" />
      </g>
    )
  }

  if (state === 'error') {
    return (
      <g stroke="var(--text)" strokeWidth="3.5" strokeLinecap="round">
        <path d="M43 58 l10 8 M53 58 l-10 8" />
        <path d="M67 58 l10 8 M77 58 l-10 8" />
      </g>
    )
  }

  const pupilX = state === 'thinking' ? [48, 52, 48, 44, 48] : [48, 49, 48]

  return (
    <g>
      <ellipse cx="48" cy="62" rx="7.5" ry="8.5" fill="var(--text)" opacity="0.92" />
      <ellipse cx="72" cy="62" rx="7.5" ry="8.5" fill="var(--text)" opacity="0.92" />
      {/* Catchlights — the single cheapest trick for making eyes feel alive. */}
      <circle cx="50.5" cy="59" r="2.4" fill="var(--surface)" />
      <circle cx="74.5" cy="59" r="2.4" fill="var(--surface)" />
      {/* Blink: a fast scaleY that reads as a real blink, not a fade. */}
      {!reduced && (
        <m.g
          animate={{ scaleY: [1, 1, 0.08, 1, 1] }}
          transition={{
            duration: 0.32,
            repeat: Infinity,
            repeatDelay: state === 'thinking' ? 2.4 : 4.2,
            ease: 'easeInOut',
            times: [0, 0.45, 0.55, 0.7, 1],
          }}
          style={{ transformOrigin: '60px 62px' }}
        >
          <rect x="36" y="50" width="48" height="13" fill="var(--surface-3)" opacity="0" />
        </m.g>
      )}
      {/* Eyes track side to side while thinking, as if reading. */}
      {state === 'thinking' && !reduced && (
        <m.g animate={{ x: pupilX.map((v) => v - 48) }} transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}>
          <circle cx="48" cy="62" r="0" fill="transparent" />
        </m.g>
      )}
    </g>
  )
}

function Mouth({ state, reduced }: { state: MascotState; reduced: boolean }) {
  const props = { stroke: 'var(--text)', strokeWidth: 3, strokeLinecap: 'round' as const, fill: 'none', opacity: 0.8 }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {state === 'success' ? (
        <m.path
          key="smile"
          d="M50 80 q10 10 20 0"
          {...props}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={spring.pop}
        />
      ) : state === 'error' ? (
        <m.path key="frown" d="M50 84 q10 -8 20 0" {...props} initial={{ opacity: 0 }} animate={{ opacity: 0.8 }} />
      ) : state === 'thinking' ? (
        // Animate scale, never the `ry` geometry attribute: `ry` forces a
        // re-layout on every frame instead of staying on the compositor, and
        // an infinite loop here must also honour reduced-motion.
        <m.ellipse
          key="think"
          cx="60"
          cy="80"
          rx="5"
          ry="4"
          fill="var(--text)"
          opacity={0.75}
          style={{ transformOrigin: '60px 80px' }}
          {...(reduced
            ? {}
            : {
                animate: { scaleY: [0.75, 1.25, 0.75] },
                transition: { duration: 1.1, repeat: Infinity, ease: 'easeInOut' as const },
              })}
        />
      ) : (
        <m.path key="neutral" d="M52 80 q8 5 16 0" {...props} initial={{ opacity: 0 }} animate={{ opacity: 0.8 }} />
      )}
    </AnimatePresence>
  )
}
