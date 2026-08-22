import { useEffect, useRef } from 'react'
import * as m from 'motion/react-m'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import {
  Brain,
  Check,
  FileText,
  Languages,
  Link2,
  PenLine,
  ScanText,
  ShieldAlert,
  X,
} from 'lucide-react'
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

type StageIcon = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

/** One glyph per pipeline stage, so a badge is readable before its label. */
const STAGE_ICON: Record<string, StageIcon> = {
  resolve: Link2,
  fetch: FileText,
  read: ScanText,
  translate: Languages,
  analyse: Brain,
  assess: ShieldAlert,
  compose: PenLine,
}

export function Pipeline({
  state,
  onCancel,
}: {
  state: AnalysisState
  onCancel: () => void
}) {
  const reduced = useReducedMotion()
  const stripRef = useRef<HTMLOListElement>(null)
  const active = state.stages.find((s) => s.state === 'active')
  const mascot: MascotState = state.status === 'error' ? 'error' : 'thinking'

  // Past the expected duration, say so rather than letting the stepper sit
  // silently and look hung.
  const overrun = state.elapsed >= 35

  // On a phone the strip scrolls; keep the stage that is actually working in
  // view without asking the reader to chase it.
  useEffect(() => {
    const el = stripRef.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', inline: 'center', block: 'nearest' })
  }, [active?.stage, reduced])

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
      {/* min-h, not h: at 375px the overrun headline wraps to two lines and a
          detail line beneath it overflowed a fixed 56px box straight into the
          stepper card. The minimum still reserves space against jitter. */}
      <div
        className="mt-5 min-h-14 text-center"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <AnimatePresence mode="wait">
          <m.p
            key={active?.stage ?? 'done'}
            className="hed text-xl"
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

      {/* ── The stepper card ──────────────────────────────────────────────
          One icon badge per stage on a horizontal line — hollow ahead of the
          work, pulsing accent where the work is, a soft green check behind
          it. The connectors fill with the blue gradient as each stage lands. */}
      <div className="card card-lift mt-4 w-full p-5 sm:p-6">
        <div className="overflow-x-auto pb-1">
          <ol ref={stripRef} className="flex w-full min-w-max items-start px-1 sm:min-w-0">
            {state.stages.map((s, i) => (
              <StageStep
                key={s.stage}
                view={s}
                index={i}
                last={i === state.stages.length - 1}
                reduced={Boolean(reduced)}
              />
            ))}
          </ol>
        </div>

        {/* Weighted progress — eases toward each stage ceiling so it slows
            but never stalls or reverses. */}
        <div
          className="mt-5 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(state.progress * 100)}
          aria-label="Analysis progress"
        >
          <m.div
            className="h-full rounded-full"
            style={{ background: 'var(--grad-blue)', transformOrigin: 'left center' }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: state.progress }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
        {/* The counter changes every second, so it is hidden from the live
            region above and from assistive tech entirely. */}
        <p className="mt-2 text-center text-2xs tabular-nums text-ink-3" aria-hidden="true">
          {Math.round(state.progress * 100)}% · {state.elapsed}s
        </p>
      </div>

      <Button variant="ghost" size="sm" onClick={onCancel} className="mt-6">
        Cancel
      </Button>
    </m.div>
  )
}

function StageStep({
  view,
  index,
  last,
  reduced,
}: {
  view: AnalysisState['stages'][number]
  index: number
  last: boolean
  reduced: boolean
}) {
  const { stage, state, label, detail } = view
  const Icon = STAGE_ICON[stage] ?? Link2
  const passed = state === 'done' || state === 'skipped'

  return (
    <m.li
      data-active={state === 'active' ? 'true' : undefined}
      className="relative flex w-[76px] shrink-0 flex-col items-center sm:w-auto sm:flex-1"
      title={detail ? `${label} — ${detail}` : label}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: state === 'pending' ? 0.55 : 1, y: 0 }}
      transition={{ ...spring.pop, delay: reduced ? 0 : index * 0.04 }}
    >
      {/* The connector to the next badge: a quiet track that takes the blue
          gradient once this stage has landed. */}
      {!last && (
        <span
          aria-hidden
          className="absolute left-1/2 top-[19px] z-0 h-[3px] w-full overflow-hidden rounded-full bg-[var(--surface-3)]"
        >
          <m.span
            className="block h-full w-full origin-left rounded-full"
            style={{ background: 'var(--grad-blue)' }}
            initial={reduced ? false : { scaleX: 0 }}
            animate={{ scaleX: passed ? 1 : 0 }}
            transition={spring.settle}
          />
        </span>
      )}

      {/* Badge: hollow ring → pulsing accent → soft green check. */}
      <span
        className={cn(
          'relative z-10 grid size-10 shrink-0 place-items-center rounded-full transition-colors',
          state === 'pending' && 'border-2 border-[var(--border-strong)] bg-[var(--surface)] text-ink-3',
          state === 'active' && 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--e2)]',
          state === 'done' && 'bg-[var(--pos-soft)] text-[var(--pos)]',
          state === 'skipped' && 'bg-[var(--surface-3)] text-ink-3',
        )}
      >
        {state === 'active' && !reduced && (
          <m.span
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-[var(--accent)]"
            animate={{ scale: [1, 1.5], opacity: [0.55, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <AnimatePresence mode="wait" initial={false}>
          {state === 'done' ? (
            <m.span
              key="done"
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={spring.pop}
              style={{ transformOrigin: 'bottom center' }}
            >
              <Check size={17} strokeWidth={3} />
            </m.span>
          ) : state === 'skipped' ? (
            <m.span key="skipped" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring.pop}>
              <X size={15} strokeWidth={3} />
            </m.span>
          ) : (
            <span key="icon">
              <Icon size={17} strokeWidth={2.2} />
            </span>
          )}
        </AnimatePresence>
      </span>

      <span
        className={cn(
          'mt-2 max-w-full truncate text-center text-[11px] font-semibold',
          state === 'active' ? 'text-ink' : 'text-ink-3',
        )}
      >
        {label}
      </span>
      {state === 'skipped' && (
        <span className="mt-0.5 text-[10px] leading-tight text-ink-3">not available</span>
      )}
      {/* What a finished stage found stays available to assistive tech even
          though the strip has no room to print it. */}
      {state === 'done' && detail && <span className="sr-only">{detail}</span>}
    </m.li>
  )
}
