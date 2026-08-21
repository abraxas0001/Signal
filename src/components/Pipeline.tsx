import * as m from 'motion/react-m'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import { Check, X } from 'lucide-react'
import type { AnalysisState } from '@/hooks/useAnalysis'
import { Mascot, type MascotState } from './Mascot'
import { Button } from './ui'
import { cn } from '@/lib/utils'
import { ease, spring } from '@/lib/motion'

/**
 * The processing screen.
 *
 * Every label here is driven by a real server event — the stepper advances
 * because a stage genuinely finished, never because a timer fired. That
 * distinction is the whole reason the screen is trustworthy: users notice
 * fake progress, and once they do the rest of the report reads as theatre too.
 */
export function Pipeline({
  state,
  onCancel,
}: {
  state: AnalysisState
  onCancel: () => void
}) {
  const reduced = useReducedMotion()
  const active = state.stages.find((s) => s.state === 'active')
  const mascot: MascotState = state.status === 'error' ? 'error' : 'thinking'

  // Past the expected duration, say so rather than letting the stepper sit
  // silently and look hung.
  const overrun = state.elapsed >= 35

  return (
    <m.div
      className="shell shell-prose flex flex-col items-center"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.glide}
    >
      <Mascot state={mascot} size={128} />

      {/* Narration: verb-first, present-continuous, second person.
          The live region is what makes this screen exist for a screen-reader
          user — otherwise a 30-second wait is 30 seconds of silence with no
          indication anything is happening. It announces the stage label only,
          not the per-second counter, which would be unbearable. */}
      <div
        className="mt-5 h-14 text-center"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <AnimatePresence mode="wait">
          <m.p
            key={active?.stage ?? 'done'}
            className="text-xl font-semibold tracking-[-0.011em]"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={ease.out}
          >
            {overrun ? 'Almost there. This one’s dense' : (active?.activeLabel ?? 'Finishing up')}
          </m.p>
        </AnimatePresence>
        <AnimatePresence>
          {active?.detail && (
            <m.p
              key={active.detail}
              className="mt-1 text-sm text-ink-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={ease.out}
            >
              {active.detail}
            </m.p>
          )}
        </AnimatePresence>
      </div>

      {/* Weighted progress — eases toward each stage ceiling so it slows but
          never stalls or reverses. */}
      <div
        className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-[var(--surface-3)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(state.progress * 100)}
        aria-label="Analysis progress"
      >
        <m.div
          className="h-full rounded-full bg-[var(--accent)]"
          style={{ transformOrigin: 'left center' }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: state.progress }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      {/* The counter changes every second, so it is hidden from the live
          region above and from assistive tech entirely. */}
      <p className="mt-2 text-2xs tabular-nums text-ink-3" aria-hidden="true">
        {Math.round(state.progress * 100)}% · {state.elapsed}s
      </p>

      {/* Stepper — exactly one row is ever active. */}
      <ol className="mt-7 w-full space-y-1">
        {state.stages.map((s, i) => (
          <StageRow key={s.stage} view={s} index={i} reduced={Boolean(reduced)} />
        ))}
      </ol>

      <Button variant="ghost" size="sm" onClick={onCancel} className="mt-7">
        Cancel
      </Button>
    </m.div>
  )
}

function StageRow({
  view,
  index,
  reduced,
}: {
  view: AnalysisState['stages'][number]
  index: number
  reduced: boolean
}) {
  const { state, label, detail } = view

  return (
    <m.li
      className={cn(
        'flex items-center gap-3 rounded-[--radius-md] px-3 py-2.5 transition-colors',
        state === 'active' && 'bg-[var(--surface-2)]',
      )}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: state === 'pending' ? 0.45 : 1, x: 0 }}
      transition={{ ...spring.pop, delay: reduced ? 0 : index * 0.04 }}
    >
      {/* Indicator: hollow ring → pulsing accent ring → popped checkmark. */}
      <span
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-full border-2',
          state === 'pending' && 'border-[var(--border-interactive)]',
          state === 'active' && 'ring-live border-[var(--accent)]',
          state === 'done' && 'border-[var(--pos)] bg-[var(--pos)]',
          state === 'skipped' && 'border-[var(--border-interactive)] bg-[var(--surface-3)]',
        )}
      >
        <AnimatePresence>
          {state === 'done' && (
            <m.span
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={spring.pop}
              style={{ transformOrigin: 'bottom center' }}
            >
              <Check size={13} strokeWidth={3.5} className="text-[var(--accent-fg)]" />
            </m.span>
          )}
          {state === 'skipped' && (
            <m.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring.pop}>
              <X size={12} strokeWidth={3} className="text-ink-3" />
            </m.span>
          )}
        </AnimatePresence>
      </span>

      <span
        className={cn(
          'flex-1 text-sm font-medium',
          state === 'active' ? 'text-ink' : 'text-ink-2',
        )}
      >
        {label}
      </span>

      {state === 'done' && detail && (
        <m.span
          className="max-w-[45%] truncate text-2xs text-ink-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={ease.out}
        >
          {detail}
        </m.span>
      )}
      {state === 'skipped' && (
        <span className="text-2xs text-ink-3">not available</span>
      )}
    </m.li>
  )
}
