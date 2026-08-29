import { useEffect, useRef } from 'react'
import * as m from 'motion/react-m'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import {
  Check,
  CircleAlert,
  Filter,
  Layers,
  LoaderCircle,
  Newspaper,
  RefreshCw,
  ScanText,
  X,
} from 'lucide-react'
import type { ScanJobState, ScanLink, StageKey } from '@/lib/scan-job'
import { publisherFor } from '@/lib/scan-job'
import { Button, Card } from './ui'
import { CardHead } from '@/components/kit'
import { cn, hostOf, isIndicScript, pluralise, relativeTime } from '@/lib/utils'
import { ease, spring } from '@/lib/motion'

/**
 * What the sync is doing, while it does it.
 *
 * The office pressed "Sync today" and got a button that said "Looking…", then
 * "Reading…", for two or three minutes. Nothing else moved. Their words were
 * that they could not tell whether it was working, and the reasonable response
 * to a screen that says nothing for three minutes is to leave it — which, until
 * scan-job.ts existed, killed the run.
 *
 * They asked for the treatment the analyse screen gets, so this is deliberately
 * built to match components/Pipeline.tsx: the same badge strip with the same
 * four states, the same live narration above it, the same gradient progress
 * track. Two screens that report progress should not look like two products.
 *
 * Where it departs from Pipeline it is because the work is different. Pipeline
 * watches ONE post through seven stages, so a stage is the whole story. A sync
 * reads a dozen stories through four, so the list underneath is the story: each
 * link with its headline as it lands, and each failure carrying the server's own
 * sentence rather than a shared "something went wrong".
 *
 * It also has one state Pipeline has no need for: `failed` on a single stage.
 * A scan that could not reach the mastheads has to look different from one that
 * simply had nothing to find.
 */

type StageIcon = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

/** One glyph per stage, so a badge is readable before its label. */
const STAGE_ICON: Record<StageKey, StageIcon> = {
  find: Newspaper,
  sift: Filter,
  read: ScanText,
  group: Layers,
}

/**
 * What to say while a stage is the one working.
 *
 * Verb-first and present-continuous, the same voice as Pipeline's activeLabel.
 * It lives here rather than in the job because it is narration: the job records
 * what happened, this decides how to say it out loud.
 */
const STAGE_NARRATION: Record<StageKey, string> = {
  find: 'Reading the front pages',
  sift: 'Checking what the desk already has',
  read: 'Reading each story',
  group: 'Grouping them into issues',
}

/**
 * Share of the bar each stage owns.
 *
 * Not equal quarters. Finding is a handful of page fetches and comes back in a
 * second or two; reading is two model calls per story and is essentially the
 * whole wait. Equal quarters would park the bar at 25% for three minutes, which
 * is the same lie as a spinner.
 */
const WEIGHT: Record<StageKey, number> = { find: 0.14, sift: 0.04, read: 0.74, group: 0.08 }

const STATUS_LABEL: Record<ScanLink['status'], string> = {
  queued: 'Waiting',
  reading: 'Reading',
  done: 'Read',
  failed: 'Failed',
}

export function ScanProgress({
  state,
  onStop,
  onHide,
}: {
  state: ScanJobState
  /** The reader stopping the run. The ONLY thing that stops it. */
  onStop: () => void
  /** Putting away a finished report. Never offered while the run is going. */
  onHide: () => void
}) {
  const reduced = useReducedMotion()
  const stripRef = useRef<HTMLOListElement>(null)

  const running = state.status === 'scanning' || state.status === 'reading'
  const active = state.stages.find((s) => s.state === 'active')

  const total = state.links.length
  const read = state.links.filter((l) => l.status === 'done').length
  const failed = state.links.filter((l) => l.status === 'failed').length
  const settled = read + failed
  /** Anything the run owes the reader: it broke, or it left links unread. */
  const troubled = Boolean(state.error) || failed > 0

  const progress = running
    ? Math.min(
        0.98,
        state.stages.reduce((sum, s) => {
          if (s.state === 'done' || s.state === 'skipped' || s.state === 'failed') {
            return sum + WEIGHT[s.key]
          }
          if (s.state !== 'active') return sum
          // The reading stage is the only one that can report its own fraction,
          // because it is the only one that knows how much is left.
          if (s.key === 'read' && total > 0) return sum + WEIGHT.read * (settled / total)
          return sum + WEIGHT[s.key] * 0.4
        }, 0),
      )
    : 1

  // On a phone the strip scrolls; keep the stage that is actually working in
  // view without asking the reader to chase it.
  useEffect(() => {
    const el = stripRef.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', inline: 'center', block: 'nearest' })
  }, [active?.key, reduced])

  const title = running
    ? state.kind === 'read'
      ? 'Reading the pasted links'
      : 'Reading today’s papers'
    : state.kind === 'read'
      ? 'The last read'
      : 'The last sync'

  const finishedAgo = relativeTime(state.finishedAt)
  const sub = running
    ? total > 0
      ? `${read} of ${total} read`
      : 'Nothing to read yet'
    : finishedAgo
      ? `Finished ${finishedAgo}`
      : ''

  return (
    <m.div
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.settle}
    >
      <Card>
        <CardHead
          icon={
            running ? (
              <RefreshCw size={16} className="animate-spin motion-reduce:animate-none" />
            ) : troubled ? (
              <CircleAlert size={16} />
            ) : (
              <Check size={16} />
            )
          }
          title={title}
          {...(sub ? { sub } : {})}
          // A green tick over a run that left four stories unread would be the
          // same false reassurance the old button gave. Anything unfinished
          // wears the warning tint, whether the run failed or was stopped.
          tint={running ? 'blue' : troubled ? 'orange' : 'green'}
          action={
            running ? (
              <Button size="sm" variant="outline" onClick={onStop}>
                Stop
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={onHide} aria-label="Hide this report">
                <X size={14} />
                Hide
              </Button>
            )
          }
        />

        <div className="min-h-12">
          {/* The narration, and the only thing announced. Without a live region
              a three-minute sync is three minutes of silence for a screen-reader
              user. Only the stage sentence is in it: the detail line below
              changes with every headline that lands, and having that read out a
              dozen times would make the screen unusable — the same reason
              Pipeline keeps its per-second counter out of its own live region. */}
          <div role="status" aria-live="polite" aria-atomic="true">
            <AnimatePresence mode="wait">
              <m.p
                key={running ? (active?.key ?? 'finishing') : state.status}
                className={cn(
                  'text-sm font-semibold leading-relaxed',
                  !running && state.error && 'text-[var(--neg)]',
                )}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={ease.out}
              >
                {running
                  ? (active ? STAGE_NARRATION[active.key] : 'Finishing up')
                  : (state.error ?? state.note ?? 'This run has finished.')}
              </m.p>
            </AnimatePresence>
          </div>
          {/* What the live stage has actually found so far: the papers it read,
              the count it set aside, the headline that just landed. */}
          {running && active?.detail && (
            <p
              className={cn(
                'mt-1 text-xs leading-relaxed text-ink-3',
                isIndicScript(active.detail) && 'te',
              )}
            >
              {active.detail}
            </p>
          )}
        </div>

        {/* ── The stage strip ─────────────────────────────────────────────
            Straight out of Pipeline: hollow ring ahead of the work, pulsing
            accent where the work is, a soft green check behind it, and the
            connector filling with the blue gradient as each stage lands. */}
        <div className="mt-3 overflow-x-auto pb-1">
          <ol ref={stripRef} className="flex w-full min-w-max items-start px-1 sm:min-w-0">
            {state.stages.map((s, i) => (
              <StageStep
                key={s.key}
                view={s}
                index={i}
                last={i === state.stages.length - 1}
                reduced={Boolean(reduced)}
              />
            ))}
          </ol>
        </div>

        <div
          className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label="Sync progress"
        >
          <m.div
            className="h-full rounded-full"
            style={{ background: 'var(--grad-blue)', transformOrigin: 'left center' }}
            initial={reduced ? false : { scaleX: 0 }}
            animate={{ scaleX: progress }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>

        {/* The count, said plainly. Zero read is a real answer and prints as
            zero; a link nobody has reached yet is neither read nor failed and
            is counted in neither. */}
        {total > 0 && (
          <p className="mt-2 text-xs tabular-nums text-ink-3">
            {read} of {total} {pluralise(total, 'story', 'stories')} read
            {failed > 0 && ` · ${failed} could not be read`}
            {running && settled < total && ` · ${total - settled} still to go`}
          </p>
        )}

        {state.links.length > 0 && (
          <ul className="mt-3 space-y-2">
            {state.links.map((link) => (
              <LinkRow key={link.url} link={link} />
            ))}
          </ul>
        )}
      </Card>
    </m.div>
  )
}

function LinkRow({ link }: { link: ScanLink }) {
  const host = hostOf(link.url)
  const publisher = publisherFor(host)

  return (
    <li className="flex items-start gap-2.5">
      {/* The icon is the whole status for a sighted reader, so it has to carry
          the word for everyone else. */}
      <span className="mt-0.5 shrink-0" role="img" aria-label={STATUS_LABEL[link.status]}>
        {link.status === 'done' && <Check size={15} className="text-[var(--pos)]" />}
        {link.status === 'failed' && <CircleAlert size={15} className="text-[var(--neg)]" />}
        {link.status === 'reading' && (
          <LoaderCircle size={15} className="animate-spin text-[var(--accent)]" />
        )}
        {link.status === 'queued' && (
          <span className="block size-2 translate-y-1.5 rounded-full bg-[var(--surface-3)]" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-ink-3">
          {publisher ? `${publisher} · ${host}` : host}
        </span>
        {link.title && (
          <span
            className={cn('mt-0.5 block truncate text-sm', isIndicScript(link.title) && 'te')}
          >
            {link.title}
          </span>
        )}
        {link.message && (
          <span className="mt-0.5 block text-xs leading-relaxed text-[var(--neg)]">
            {link.message}
          </span>
        )}
      </span>
    </li>
  )
}

function StageStep({
  view,
  index,
  last,
  reduced,
}: {
  view: ScanJobState['stages'][number]
  index: number
  last: boolean
  reduced: boolean
}) {
  const { key, state, label, detail } = view
  const Icon = STAGE_ICON[key]
  const passed = state === 'done' || state === 'skipped'

  return (
    <m.li
      data-active={state === 'active' ? 'true' : undefined}
      className="relative flex w-[76px] shrink-0 flex-col items-center sm:w-auto sm:flex-1"
      title={detail ? `${label}: ${detail}` : label}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: state === 'pending' ? 0.55 : 1, y: 0 }}
      transition={{ ...spring.pop, delay: reduced ? 0 : index * 0.04 }}
    >
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

      <span
        className={cn(
          'relative z-10 grid size-10 shrink-0 place-items-center rounded-full transition-colors',
          state === 'pending' &&
            'border-2 border-[var(--border-strong)] bg-[var(--surface)] text-ink-3',
          state === 'active' && 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--e2)]',
          state === 'done' && 'bg-[var(--pos-soft)] text-[var(--pos)]',
          state === 'skipped' && 'bg-[var(--surface-3)] text-ink-3',
          state === 'failed' && 'bg-[var(--neg-soft)] text-[var(--neg)]',
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
            <m.span
              key="skipped"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={spring.pop}
            >
              <X size={15} strokeWidth={3} />
            </m.span>
          ) : state === 'failed' ? (
            <m.span
              key="failed"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={spring.pop}
            >
              <CircleAlert size={17} strokeWidth={2.6} />
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
      {/* "not run" rather than "not available": a stage here is skipped because
          it had nothing to do or was never reached, not because the server
          could not offer it. The reason itself rides on the title and, for
          assistive tech, on the sr-only line below. */}
      {state === 'skipped' && (
        <span className="mt-0.5 text-[10px] leading-tight text-ink-3">not run</span>
      )}
      {/* What a stage found stays available to assistive tech even though the
          strip has no room to print it. */}
      {state !== 'active' && detail && <span className="sr-only">{detail}</span>}
    </m.li>
  )
}
