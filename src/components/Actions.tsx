import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import {
  ArrowUp,
  Ban,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleDashed,
  Clock,
  Flag,
  Link2,
  ListChecks,
  Play,
  Plus,
  Trash2,
  TriangleAlert,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  ACTION_STATUSES,
  ESCALATION_LEVELS,
  type ActionItem,
  type ActionStatus,
  type EscalationLevel,
  type GrievanceRecord,
} from '@shared/grievance'
import { ACTION_PRIORITIES, PRIORITY_RANK, type ActionPriority } from '@shared/taxonomy'
import { Button, Card, Chip, PageHeader, type ChipTone } from './ui'
import { makeId, update, useStore } from '@/lib/store'
import { Mascot } from './Mascot'
import { fadeUp, haptic, listStagger } from '@/lib/motion'
import { absoluteDate, cn, pluralise } from '@/lib/utils'

/**
 * The action tracker — the Future Tasks sheet, filled in.
 *
 * Every other screen in this product observes. This one commits: a complaint
 * becomes a line with a department against it and a date the office promised.
 * The sheet has existed for months with its SLA and escalation columns drawn
 * and not one row entered, because a spreadsheet cannot tell anybody that a
 * promise ran out yesterday.
 *
 * That is the only job of this screen, which is why overdue work is lifted out
 * of its status column and put above everything else rather than being left to
 * be found by scrolling — the first grouping tried was status alone, and a
 * three-week-late water connection sat fourth in a Planned column under three
 * items that were not due yet.
 */

const DAY = 86_400_000

/**
 * Parse a stored timestamp.
 *
 * Everything on disk is meant to be ISO, but this store is a year of a phone's
 * localStorage and one hand-edited import away from holding something that is
 * not. An unreadable date sorts to the top and renders "NaN days overdue", so
 * it is treated as absent instead.
 */
function parseIso(iso: string | null): number | null {
  if (!iso) return null
  const at = new Date(iso).getTime()
  return Number.isNaN(at) ? null : at
}

/** The largest unit that still describes the gap honestly. */
function span(ms: number): { count: number; unit: 'minute' | 'hour' | 'day' | 'week' } {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return { count: Math.max(1, minutes), unit: 'minute' }
  const hours = Math.round(minutes / 60)
  if (hours < 36) return { count: hours, unit: 'hour' }
  const days = Math.round(hours / 24)
  if (days < 14) return { count: Math.max(1, days), unit: 'day' }
  return { count: Math.round(days / 7), unit: 'week' }
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/**
 * Time to a deadline, in the words an office uses.
 *
 * Deliberately not `relativeTime` from utils: that one measures backwards from
 * now and collapses anything still ahead into "just now", which would print a
 * deadline three days out as though it had already arrived. Lateness is phrased
 * "3 days overdue" rather than "3 days ago" because the second reads as when
 * something happened, not how late it is.
 */
function dueInWords(remaining: number): string {
  const { count, unit } = span(remaining)
  return RELATIVE.format(count, unit)
}

function overdueInWords(elapsed: number): string {
  const { count, unit } = span(elapsed)
  return `${count} ${pluralise(count, unit)} overdue`
}

/**
 * A date picker hands back "2026-08-20" and no time of day. Storing that as
 * midnight would mark the item overdue the moment the day it is due begins, so
 * the promise runs to the end of that day, in the office's own timezone.
 */
function dueIsoFrom(dateValue: string): string | null {
  if (!dateValue) return null
  const at = new Date(`${dateValue}T23:59:59`)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

/**
 * The other direction, for the date input.
 *
 * Slicing `toISOString()` would be shorter and wrong: an end-of-day deadline in
 * IST is the previous day in UTC, so every date field would open showing the
 * day before the one that was set.
 */
function dateInputValue(iso: string | null): string {
  const at = parseIso(iso)
  if (at === null) return ''
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/* ── The SLA ─────────────────────────────────────────────────────────────── */

type SlaTone = 'breached' | 'soon' | 'ahead' | 'met' | 'late' | 'none'

interface Sla {
  tone: SlaTone
  /** The line a person reads: "3 days overdue", "in 2 days", "Done 1 day late". */
  label: string
  /** The promised date spelled out, or null when nobody set one. */
  due: string | null
}

function slaOf(item: ActionItem, now: number): Sla {
  const dueAt = parseIso(item.dueAt)
  const due = dueAt === null ? null : absoluteDate(item.dueAt)

  // A declined item was never going to be done, so measuring it against a
  // deadline reports a breach nobody owes anyone.
  if (item.status === 'Declined') return { tone: 'none', label: 'Not being taken up', due }

  // Closed work is judged against when it actually closed, not against the
  // clock — "9 days overdue" on something finished last week is nonsense.
  if (item.status === 'Completed') {
    const closedAt = parseIso(item.completedAt)
    if (dueAt === null || closedAt === null) return { tone: 'met', label: 'Done', due }
    const slack = dueAt - closedAt
    const { count, unit } = span(Math.abs(slack))
    if (unit === 'minute' || unit === 'hour') {
      return { tone: 'met', label: 'Done on the day it was due', due }
    }
    return slack >= 0
      ? { tone: 'met', label: `Done ${count} ${pluralise(count, unit)} early`, due }
      : { tone: 'late', label: `Done ${count} ${pluralise(count, unit)} late`, due }
  }

  if (dueAt === null) {
    return { tone: 'none', label: 'No date set, so this will never show as late', due: null }
  }

  const remaining = dueAt - now
  if (remaining < 0) return { tone: 'breached', label: overdueInWords(-remaining), due }
  return { tone: remaining < 2 * DAY ? 'soon' : 'ahead', label: dueInWords(remaining), due }
}

function isOverdue(item: ActionItem, now: number): boolean {
  if (item.status === 'Completed' || item.status === 'Declined') return false
  const dueAt = parseIso(item.dueAt)
  return dueAt !== null && dueAt < now
}

/** Undated work cannot be urgent, so it sits below everything with a clock. */
const dueRank = (item: ActionItem): number => parseIso(item.dueAt) ?? Number.POSITIVE_INFINITY

function byUrgency(a: ActionItem, b: ActionItem): number {
  const da = dueRank(a)
  const db = dueRank(b)
  return (
    // Both undated means both Infinity, and Infinity − Infinity is NaN, which
    // sorts as "equal" in some engines and randomly in others.
    (da === db ? 0 : da - db) ||
    PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
    (parseIso(b.createdAt) ?? 0) - (parseIso(a.createdAt) ?? 0)
  )
}

/** Closed work reads newest first: what was cleared this week, not this year. */
function byClosedRecency(a: ActionItem, b: ActionItem): number {
  const rank = (i: ActionItem) => parseIso(i.completedAt) ?? parseIso(i.createdAt) ?? 0
  return rank(b) - rank(a)
}

/* ── Vocabulary ──────────────────────────────────────────────────────────── */

const STATUS_META: Record<ActionStatus, { icon: LucideIcon; tone: ChipTone; blurb: string }> = {
  Planned: { icon: CircleDashed, tone: 'neutral', blurb: 'Agreed, not started' },
  'In Progress': { icon: Play, tone: 'info', blurb: 'Someone is on it now' },
  Completed: { icon: CircleCheck, tone: 'positive', blurb: 'Closed, with the date it closed' },
  Declined: { icon: Ban, tone: 'neutral', blurb: 'Not being taken up' },
}

const PRIORITY_TONE: Record<ActionPriority, ChipTone> = {
  Critical: 'negative',
  High: 'warning',
  Medium: 'accent',
  Low: 'neutral',
}

/**
 * A select hands back a bare string. These narrow it back rather than casting,
 * so a value outside the vocabulary is refused instead of being written to the
 * store and breaking the export that reads the same lists.
 */
const asPriority = (v: string): ActionPriority | null =>
  ACTION_PRIORITIES.find((p) => p === v) ?? null
const asEscalation = (v: string): EscalationLevel | null =>
  ESCALATION_LEVELS.find((e) => e === v) ?? null

function nextEscalation(level: EscalationLevel): EscalationLevel | null {
  const at = ESCALATION_LEVELS.indexOf(level)
  if (at < 0) return null
  return ESCALATION_LEVELS[at + 1] ?? null
}

const FIELD =
  'w-full min-h-11 rounded-[--radius-sm] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-ink-1 outline-none placeholder:text-ink-3 focus:border-[var(--accent)]'

const LABEL = 'block text-xs font-medium text-ink-2'

/* ── A field that cannot lose what was typed into it ─────────────────────── */

/**
 * Writes through to the store shortly after typing stops.
 *
 * Committing on blur alone loses the sentence when someone types a delay reason
 * and then taps Back or switches apps, which on a phone is most of the time.
 * Committing on every keystroke re-serialises the whole store — every grievance
 * and every mention — once per character.
 */
function LiveField({
  id,
  label,
  value,
  placeholder,
  multiline,
  onCommit,
}: {
  id: string
  label: string
  value: string | null
  placeholder: string
  multiline?: boolean
  onCommit: (next: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  const timer = useRef<number | null>(null)
  /** Text typed but not yet written. Null once it has landed in the store. */
  const queued = useRef<string | null>(null)
  const send = useRef(onCommit)
  useEffect(() => {
    send.current = onCommit
  })

  const write = (text: string) => {
    queued.current = null
    const trimmed = text.trim()
    send.current(trimmed === '' ? null : trimmed)
  }

  const change = (text: string) => {
    setDraft(text)
    queued.current = text
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      write(text)
    }, 400)
  }

  const flush = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    if (queued.current !== null) write(queued.current)
  }

  // Unmounting with a write still queued — collapsing the card, leaving the
  // screen — must not drop it.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      if (queued.current !== null) write(queued.current)
    },
    [],
  )

  return (
    <div>
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          rows={2}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => change(e.target.value)}
          onBlur={flush}
          className={cn(FIELD, 'mt-1 resize-y leading-relaxed')}
        />
      ) : (
        <input
          id={id}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => change(e.target.value)}
          onBlur={flush}
          className={cn(FIELD, 'mt-1')}
        />
      )}
    </div>
  )
}

/* ── Status control ──────────────────────────────────────────────────────── */

/**
 * Four buttons, one tap each.
 *
 * A dropdown would be tidier and would cost two taps plus a system picker to
 * mark something done — the single thing this screen exists to make easy. They
 * wrap rather than scroll sideways so a narrow board column never hides one.
 */
function StatusPills({
  current,
  onSelect,
}: {
  current: ActionStatus
  onSelect: (next: ActionStatus) => void
}) {
  return (
    <div role="group" aria-label="Status" className="flex flex-wrap gap-1">
      {ACTION_STATUSES.map((status) => {
        const active = status === current
        const Icon = STATUS_META[status].icon
        return (
          <button
            key={status}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(status)}
            className={cn(
              'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[--radius-sm] px-2.5',
              'text-[11px] font-medium whitespace-nowrap transition-transform active:scale-[0.97]',
              active
                ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                : 'bg-[var(--surface-2)] text-ink-2 hover:bg-[var(--surface-3)]',
            )}
          >
            <Icon size={13} aria-hidden />
            {status}
          </button>
        )
      })}
    </div>
  )
}

/* ── One action ──────────────────────────────────────────────────────────── */

function ActionCard({
  item,
  records,
  now,
  onPatch,
  onRemove,
}: {
  item: ActionItem
  records: Map<string, GrievanceRecord>
  now: number
  onPatch: (change: Partial<ActionItem>) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState(false)

  // An armed delete left sitting on a card is a mis-tap waiting to happen.
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(t)
  }, [armed])

  const sla = slaOf(item, now)
  const breached = sla.tone === 'breached'
  const raiseTo = breached ? nextEscalation(item.escalation) : null

  const linked = item.linkedRecordIds.map((id) => records.get(id))
  const found = linked.filter((r): r is GrievanceRecord => r != null)
  const missing = linked.length - found.length

  const setStatus = (next: ActionStatus) => {
    if (next === item.status) return
    if (next === 'Completed') haptic.success()
    else haptic.tap()
    onPatch({
      status: next,
      // Only completion stamps a time, and reopening clears it. An item showing
      // "In Progress" alongside a completion date exports as a promise met that
      // was not; declining is not completing, so it stamps nothing at all.
      completedAt:
        next === 'Completed' ? (item.completedAt ?? new Date().toISOString()) : null,
    })
  }

  const slaColour =
    sla.tone === 'breached'
      ? 'text-[var(--neg)] font-semibold'
      : sla.tone === 'soon' || sla.tone === 'late'
        ? 'text-[var(--warn)]'
        : sla.tone === 'met'
          ? 'text-[var(--pos)]'
          : 'text-ink-3'

  return (
    <Card
      padded={false}
      className={cn(
        'p-3.5',
        breached && 'ring-1 ring-[color-mix(in_oklab,var(--neg)_45%,transparent)]',
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone={PRIORITY_TONE[item.priority]}>{item.priority}</Chip>
        {breached && (
          // Colour alone would fail anyone reading this outdoors or with a
          // colour deficiency, so the mark is icon plus the word as well.
          <Chip tone="negative" icon={<TriangleAlert size={12} aria-hidden />}>
            Overdue
          </Chip>
        )}
        {item.escalation !== 'None' && (
          <Chip tone="warning" icon={<Flag size={12} aria-hidden />}>
            {item.escalation}
          </Chip>
        )}
      </div>

      <p className="mt-2 text-[15px] leading-snug font-medium text-ink-1">{item.description}</p>

      {(item.department || item.owner) && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
          {item.department && (
            <span className="inline-flex items-center gap-1">
              <Building2 size={12} aria-hidden />
              {item.department}
            </span>
          )}
          {item.owner && (
            <span className="inline-flex items-center gap-1">
              <UserRound size={12} aria-hidden />
              {item.owner}
            </span>
          )}
        </p>
      )}

      <p className={cn('mt-2 flex items-start gap-1.5 text-xs', slaColour)}>
        {breached ? (
          <TriangleAlert size={13} className="mt-px shrink-0" aria-hidden />
        ) : (
          <Clock size={13} className="mt-px shrink-0" aria-hidden />
        )}
        <span>
          {sla.label}
          {sla.due && <span className="text-ink-3"> · due {sla.due}</span>}
        </span>
      </p>

      {breached && (
        <div className="mt-3 space-y-2 rounded-[--radius-sm] bg-[var(--neg-soft)] p-2.5">
          {raiseTo ? (
            <button
              type="button"
              onClick={() => {
                haptic.tap()
                onPatch({ escalation: raiseTo })
              }}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-[--radius-sm] bg-[var(--neg)] px-3 text-xs font-medium text-white transition-transform active:scale-[0.97]"
            >
              <ArrowUp size={13} aria-hidden />
              Raise to {raiseTo}
            </button>
          ) : (
            <p className="text-xs text-[var(--neg)]">
              Already at the top of the escalation list. Chase it directly.
            </p>
          )}
          <LiveField
            id={`${item.id}-delay`}
            label="Why is it late?"
            value={item.delayReason}
            placeholder="No engineer assigned yet"
            onCommit={(next) => onPatch({ delayReason: next })}
          />
        </div>
      )}

      <div className="mt-3">
        <StatusPills current={item.status} onSelect={setStatus} />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <label
          className="inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-3"
          htmlFor={`${item.id}-escalation`}
        >
          <Flag size={13} aria-hidden />
          Escalation
        </label>
        <select
          id={`${item.id}-escalation`}
          value={item.escalation}
          onChange={(e) => {
            const next = asEscalation(e.target.value)
            if (next) onPatch({ escalation: next })
          }}
          className="min-h-11 min-w-0 flex-1 rounded-[--radius-sm] border border-[var(--border)] bg-[var(--surface-2)] px-2 text-xs text-ink-2 outline-none focus:border-[var(--accent)]"
        >
          {ESCALATION_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level === 'None' ? 'Not escalated' : level}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs text-ink-3 hover:text-ink-2"
      >
        {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        {open ? 'Less' : 'Date, next step, records'}
        {!open && found.length > 0 && (
          <span className="ml-1 inline-flex items-center gap-1 text-ink-3">
            <Link2 size={12} aria-hidden />
            {found.length}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-3 border-t border-[var(--border)] pt-3">
          <div>
            <label className={LABEL} htmlFor={`${item.id}-due`}>
              Due date
            </label>
            <input
              id={`${item.id}-due`}
              type="date"
              value={dateInputValue(item.dueAt)}
              onChange={(e) => onPatch({ dueAt: dueIsoFrom(e.target.value) })}
              className={cn(FIELD, 'mt-1')}
            />
          </div>

          <div>
            <label className={LABEL} htmlFor={`${item.id}-priority`}>
              Priority
            </label>
            <select
              id={`${item.id}-priority`}
              value={item.priority}
              onChange={(e) => {
                const next = asPriority(e.target.value)
                if (next) onPatch({ priority: next })
              }}
              className={cn(FIELD, 'mt-1')}
            >
              {ACTION_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <LiveField
            id={`${item.id}-department`}
            label="Department"
            value={item.department}
            placeholder="Panchayat Raj Engineering"
            onCommit={(next) => onPatch({ department: next })}
          />

          <LiveField
            id={`${item.id}-owner`}
            label="Who is doing it"
            value={item.owner}
            placeholder="Name or designation"
            onCommit={(next) => onPatch({ owner: next })}
          />

          {/* ── The steps, tickable ────────────────────────────────────
              Above the free-text box, because this is the part somebody works
              from. The channel sits on each line: "where do I do this" and
              "what do I say" are the two questions per step, and burying the
              answer to the first in a notes paragraph meant it was read once
              and then guessed at. */}
          {(item.steps ?? []).length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">
                Steps
                <span className="tnum ml-2 normal-case tracking-normal text-ink-3">
                  {(item.steps ?? []).filter((x) => x.done).length} of{' '}
                  {(item.steps ?? []).length} done
                </span>
              </p>

              <ul className="mt-2 space-y-1.5">
                {(item.steps ?? []).map((step) => (
                  <li key={step.id}>
                    <button
                      onClick={() =>
                        onPatch({
                          steps: (item.steps ?? []).map((x) =>
                            x.id === step.id
                              ? {
                                  ...x,
                                  done: !x.done,
                                  doneAt: x.done ? null : new Date().toISOString(),
                                }
                              : x,
                          ),
                        })
                      }
                      className="flex w-full items-start gap-2.5 rounded-[--radius-sm] px-2 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[4px] border transition-colors',
                          step.done
                            ? 'border-[var(--pos)] bg-[var(--pos)] text-white'
                            : 'border-[var(--border-interactive)]',
                        )}
                      >
                        {step.done && <Check size={12} strokeWidth={3} />}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block text-sm leading-snug',
                            step.done && 'text-ink-3 line-through',
                          )}
                        >
                          {step.text}
                        </span>
                        {step.channel && (
                          <span className="mt-1 inline-flex items-center gap-1.5">
                            <Chip tone={step.done ? 'neutral' : 'accent'}>{step.channel}</Chip>
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <LiveField
            id={`${item.id}-notes`}
            label={(item.steps ?? []).length > 0 ? 'Anything else' : 'Next step'}
            value={item.notes}
            placeholder="Site visit on Thursday, then a written reply"
            multiline
            onCommit={(next) => onPatch({ notes: next })}
          />

          {!breached && (
            <LiveField
              id={`${item.id}-delay-open`}
              label="Delay reason"
              value={item.delayReason}
              placeholder="Blank unless something is holding it up"
              onCommit={(next) => onPatch({ delayReason: next })}
            />
          )}

          <div>
            <p className="kicker">Linked records</p>
            {found.length === 0 && missing === 0 ? (
              <p className="mt-1 text-xs text-ink-3">
                Nothing linked. This action stands on its own.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {found.map((r) => (
                  <li key={r.id} className="flex items-start gap-1.5 text-xs text-ink-2">
                    <Link2 size={12} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
                    <span className="line-clamp-2">{r.headline}</span>
                  </li>
                ))}
              </ul>
            )}
            {missing > 0 && (
              <p className="mt-1.5 text-xs text-ink-3">
                {missing} linked {pluralise(missing, 'record')} no longer stored on this device.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              if (!armed) {
                setArmed(true)
                return
              }
              haptic.error()
              onRemove()
            }}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-[--radius-sm] px-3 text-xs font-medium',
              armed
                ? 'bg-[var(--neg)] text-white'
                : 'text-ink-3 hover:bg-[var(--surface-2)] hover:text-[var(--neg)]',
            )}
          >
            <Trash2 size={13} aria-hidden />
            {armed ? 'Tap again to delete for good' : 'Delete'}
          </button>
        </div>
      )}
    </Card>
  )
}

/* ── The composer ────────────────────────────────────────────────────────── */

function Composer({
  records,
  onCreate,
  onCancel,
}: {
  records: GrievanceRecord[]
  onCreate: (item: ActionItem) => void
  onCancel: () => void
}) {
  const [description, setDescription] = useState('')
  const [department, setDepartment] = useState('')
  const [owner, setOwner] = useState('')
  const [priority, setPriority] = useState<ActionPriority>('Medium')
  const [escalation, setEscalation] = useState<EscalationLevel>('None')
  const [due, setDue] = useState('')
  const [notes, setNotes] = useState('')
  const [linked, setLinked] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    first.current?.focus()
  }, [])

  const toggle = (id: string) =>
    setLinked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  const submit = () => {
    const text = description.trim()
    if (!text) {
      setError('Say what needs doing. A department cannot act on a blank line.')
      first.current?.focus()
      return
    }
    onCreate({
      id: makeId('action'),
      createdAt: new Date().toISOString(),
      linkedRecordIds: linked,
      description: text,
      department: department.trim() || null,
      owner: owner.trim() || null,
      status: 'Planned',
      priority,
      dueAt: dueIsoFrom(due),
      completedAt: null,
      escalation,
      delayReason: null,
      notes: notes.trim() || null,
    })
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink-1">New action</h2>
          <p className="mt-0.5 text-xs text-ink-3">
            One line someone can be held to, with the date you promised.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="-mr-1 -mt-1 grid size-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-2)]"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className={LABEL} htmlFor="action-description">
            What needs doing
          </label>
          <textarea
            id="action-description"
            ref={first}
            rows={2}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              if (error) setError(null)
            }}
            placeholder="Restore the borewell at Pedapadu, ward 4"
            className={cn(FIELD, 'mt-1 resize-y leading-relaxed')}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="action-department">
              Department
            </label>
            <input
              id="action-department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="Rural Water Supply"
              className={cn(FIELD, 'mt-1')}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="action-owner">
              Who is doing it
            </label>
            <input
              id="action-owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Name or designation"
              className={cn(FIELD, 'mt-1')}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={LABEL} htmlFor="action-due">
              Due date
            </label>
            <input
              id="action-due"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className={cn(FIELD, 'mt-1')}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="action-priority">
              Priority
            </label>
            <select
              id="action-priority"
              value={priority}
              onChange={(e) => {
                const next = asPriority(e.target.value)
                if (next) setPriority(next)
              }}
              className={cn(FIELD, 'mt-1')}
            >
              {ACTION_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="action-escalation">
              Escalation
            </label>
            <select
              id="action-escalation"
              value={escalation}
              onChange={(e) => {
                const next = asEscalation(e.target.value)
                if (next) setEscalation(next)
              }}
              className={cn(FIELD, 'mt-1')}
            >
              {ESCALATION_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level === 'None' ? 'Not escalated' : level}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!due && (
          <p className="text-xs text-ink-3">
            Without a date this never appears as late. Set one if the office promised one.
          </p>
        )}

        <div>
          <label className={LABEL} htmlFor="action-notes">
            Next step
          </label>
          <textarea
            id="action-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Call the AE, then confirm in writing"
            className={cn(FIELD, 'mt-1 resize-y leading-relaxed')}
          />
        </div>

        <div>
          <p className={LABEL}>Link records</p>
          {records.length === 0 ? (
            <p className="mt-1 text-xs text-ink-3">
              No records saved on this device yet, so there is nothing to link. The action works
              on its own.
            </p>
          ) : (
            <>
              <p className="mt-0.5 text-xs text-ink-3">
                The complaints this answers. Linking keeps the evidence with the promise.
              </p>
              <div className="scroller mt-2 max-h-48 space-y-1 overflow-y-auto rounded-[--radius-sm] border border-[var(--border)] p-1">
                {records.map((r) => (
                  <label
                    key={r.id}
                    className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-[--radius-xs] px-2 py-2 hover:bg-[var(--surface-2)]"
                  >
                    <input
                      type="checkbox"
                      checked={linked.includes(r.id)}
                      onChange={() => toggle(r.id)}
                      className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                    />
                    <span className="min-w-0">
                      <span className="line-clamp-2 block text-xs text-ink-1">{r.headline}</span>
                      <span className="mt-0.5 block text-2xs text-ink-3">
                        {r.topic}
                        {r.constituency ? ` · ${r.constituency}` : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded-[--radius-sm] bg-[var(--neg-soft)] p-2.5 text-xs text-[var(--neg)]"
          >
            <TriangleAlert size={14} className="mt-px shrink-0" aria-hidden />
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={submit}>
            <Plus size={15} aria-hidden />
            Create action
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  )
}

/* ── A status column ─────────────────────────────────────────────────────── */

function Column({
  status,
  items,
  pulled,
  records,
  now,
  onPatch,
  onRemove,
}: {
  status: ActionStatus
  items: ActionItem[]
  /** How many of this status are shown in the overdue band instead. */
  pulled: number
  records: Map<string, GrievanceRecord>
  now: number
  onPatch: (id: string, change: Partial<ActionItem>) => void
  onRemove: (id: string) => void
}) {
  const [showAll, setShowAll] = useState(false)

  // Closed work accumulates forever and is the least useful thing on the
  // screen, so it is capped until someone asks for the rest.
  const capped = status === 'Completed' || status === 'Declined'
  const shown = capped && !showAll ? items.slice(0, 6) : items
  const meta = STATUS_META[status]
  const Icon = meta.icon

  return (
    <section aria-label={status}>
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-1">
          <Icon size={14} className="text-ink-3" aria-hidden />
          {status}
          <span className="num text-xs text-ink-3">{items.length}</span>
        </h2>
        {pulled > 0 && (
          <span className="text-2xs text-[var(--neg)]">
            {pulled} overdue above
          </span>
        )}
      </div>
      <p className="mb-2.5 text-2xs text-ink-3">{meta.blurb}</p>

      {items.length === 0 ? (
        <p className="rounded-[--radius-md] border border-dashed border-[var(--border)] p-3 text-xs text-ink-3">
          Nothing here.
        </p>
      ) : (
        <div className="space-y-3">
          {shown.map((item) => (
            <ActionCard
              key={item.id}
              item={item}
              records={records}
              now={now}
              onPatch={(change) => onPatch(item.id, change)}
              onRemove={() => onRemove(item.id)}
            />
          ))}
          {capped && !showAll && items.length > shown.length && (
            <Button
              size="sm"
              variant="ghost"
              className="w-full"
              onClick={() => setShowAll(true)}
            >
              Show all {items.length}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

/* ── The screen ──────────────────────────────────────────────────────────── */

export function Actions({ onClose }: { onClose: () => void }) {
  const store = useStore()
  const reduced = useReducedMotion()
  const [composing, setComposing] = useState(false)

  // A deadline that reads "in 2 hours" for the whole afternoon is a lie. One
  // minute is fine: nothing here is measured in seconds.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(tick)
  }, [])

  const actions = store.actions
  const records = useMemo(
    () => new Map(store.grievances.map((g) => [g.id, g] as const)),
    [store.grievances],
  )

  const overdue = useMemo(
    () => actions.filter((a) => isOverdue(a, now)).sort(byUrgency),
    [actions, now],
  )

  const columns = useMemo(() => {
    const lifted = new Set(overdue.map((a) => a.id))
    return ACTION_STATUSES.map((status) => {
      const mine = actions.filter((a) => a.status === status)
      const stays = mine.filter((a) => !lifted.has(a.id))
      return {
        status,
        items: stays.sort(
          status === 'Completed' || status === 'Declined' ? byClosedRecency : byUrgency,
        ),
        pulled: mine.length - stays.length,
      }
    })
  }, [actions, overdue])

  const openCount = actions.filter(
    (a) => a.status === 'Planned' || a.status === 'In Progress',
  ).length
  const doneCount = actions.filter((a) => a.status === 'Completed').length

  const patch = useCallback((id: string, change: Partial<ActionItem>) => {
    update((s) => ({
      ...s,
      actions: s.actions.map((a) => (a.id === id ? { ...a, ...change } : a)),
    }))
  }, [])

  const remove = useCallback((id: string) => {
    update((s) => ({ ...s, actions: s.actions.filter((a) => a.id !== id) }))
  }, [])

  const create = useCallback((item: ActionItem) => {
    update((s) => ({ ...s, actions: [item, ...s.actions] }))
    haptic.success()
    setComposing(false)
  }, [])

  const summary =
    actions.length === 0
      ? 'Nothing is being tracked yet.'
      : [
          overdue.length > 0 ? `${overdue.length} overdue` : null,
          `${openCount} open`,
          `${doneCount} done`,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')

  return (
    <m.div
      className="shell shell-wide stack page-end"
      variants={listStagger}
      initial={reduced ? false : 'hidden'}
      animate="show"
    >
      <m.div variants={fadeUp}>
        <PageHeader
          lead={
            <Mascot
              state={overdue.length > 0 ? 'error' : 'success'}
              size={40}
              className="mt-1 shrink-0"
            />
          }
          title="Actions"
          subtitle={
            <span className={overdue.length > 0 ? 'font-medium text-[var(--neg)]' : undefined}>
              {summary}
            </span>
          }
          actions={
            <>
              {!composing && actions.length > 0 && (
                <Button size="sm" onClick={() => setComposing(true)}>
                  <Plus size={15} aria-hidden />
                  New action
                </Button>
              )}
              <Button variant="ghost" onClick={onClose}>
                Back
              </Button>
            </>
          }
        />
      </m.div>

      {composing && (
        <m.div variants={fadeUp}>
          <Composer
            records={store.grievances}
            onCreate={create}
            onCancel={() => setComposing(false)}
          />
        </m.div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {actions.length === 0 && !composing && (
        <m.div variants={fadeUp}>
          <Card tone="accent" className="grain">
            <span className="grid size-10 place-items-center rounded-[--radius-md] bg-[var(--accent-soft)] text-[var(--accent)]">
              <ListChecks size={19} aria-hidden />
            </span>
            <h2 className="mt-3 text-base font-semibold text-ink-1">
              No actions yet
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
              An action is a complaint turned into somebody’s job: what needs doing, which
              department owns it, and the date the office promised. Once it has a date, this
              screen is what tells you it has run out — and what to escalate.
            </p>
            <ul className="mt-3 space-y-1.5 text-xs text-ink-3">
              <li className="flex items-start gap-1.5">
                <CalendarClock size={13} className="mt-0.5 shrink-0" aria-hidden />
                Overdue work is lifted above everything else, so it cannot be scrolled past.
              </li>
              <li className="flex items-start gap-1.5">
                <ArrowUp size={13} className="mt-0.5 shrink-0" aria-hidden />
                A late item offers the next escalation level — officer, department, minister.
              </li>
              <li className="flex items-start gap-1.5">
                <Link2 size={13} className="mt-0.5 shrink-0" aria-hidden />
                Link the records it answers, so the evidence stays with the promise.
              </li>
            </ul>
            <Button className="mt-4" size="sm" onClick={() => setComposing(true)}>
              <Plus size={15} aria-hidden />
              Create the first one
            </Button>
          </Card>
        </m.div>
      )}

      {/* ── Overdue, above everything ────────────────────────────────────── */}
      {overdue.length > 0 && (
        <m.section variants={fadeUp} aria-label="Overdue">
          <div className="rounded-[--radius-lg] border border-[color-mix(in_oklab,var(--neg)_32%,transparent)] bg-[var(--neg-soft)] p-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--neg)]">
              <TriangleAlert size={16} aria-hidden />
              {overdue.length} {pluralise(overdue.length, 'action')} overdue
            </h2>
            <p className="mt-1 text-xs text-[var(--neg)]">
              Past the date the office promised. Taken out of their columns so they cannot be
              missed.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {overdue.map((item) => (
                <ActionCard
                  key={item.id}
                  item={item}
                  records={records}
                  now={now}
                  onPatch={(change) => patch(item.id, change)}
                  onRemove={() => remove(item.id)}
                />
              ))}
            </div>
          </div>
        </m.section>
      )}

      {/* ── The board ────────────────────────────────────────────────────── */}
      {actions.length > 0 && (
        <m.div
          variants={fadeUp}
          className="grid gap-7 lg:grid-cols-2 lg:gap-5 xl:grid-cols-4"
        >
          {columns.map((col) => (
            <Column
              key={col.status}
              status={col.status}
              items={col.items}
              pulled={col.pulled}
              records={records}
              now={now}
              onPatch={patch}
              onRemove={remove}
            />
          ))}
        </m.div>
      )}

      <m.p variants={fadeUp} className="text-center text-xs text-ink-3">
        Stored on this device only. Nothing here is sent to a server.
      </m.p>
    </m.div>
  )
}
