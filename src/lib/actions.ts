import type { ActionItem, ActionStep, Recommendation } from '@shared/grievance'
import type { ActionPriority, CommsChannel } from '@shared/taxonomy'
import { makeId, readStore, update } from '@/lib/store'

/**
 * Turning a recommendation into somebody's job.
 *
 * This lived inside the persona tracker, which is where it was first needed and
 * the wrong place for it to stay: the dashboard now offers the same button on
 * the same recommendations, and two copies of "what a task made from a model's
 * suggestion looks like" is two things to keep in step. They drift on the field
 * nobody notices — the due date — and then the office has two escalation
 * clocks running at different speeds off the same priority.
 */

/**
 * How long the office has, by priority.
 *
 * These are the desk's own service levels, not a guess: Critical is same-day
 * because it means a fabricated claim is circulating, and Low is a week because
 * it means somebody should mention it at the next review.
 */
const DUE_DAYS: Record<ActionPriority, number> = {
  Critical: 1,
  High: 2,
  Medium: 4,
  Low: 7,
}

/** End of the working day N days out, so nothing is due at an odd hour. */
function dueIn(days: number): string {
  const at = new Date()
  at.setDate(at.getDate() + days)
  at.setHours(23, 59, 59, 0)
  return at.toISOString()
}

export interface ActionSource {
  /** The record, mention or story this came from. */
  id: string
  /** What the task is about, in a few words. Becomes part of the description. */
  headline: string
  url?: string | null
  publisher?: string | null
  /** Who the story concerns, when the task is about a person. */
  subject?: string | null
  /** Which screen raised it, so the note says where to go back to. */
  raisedFrom: string
}

/**
 * Build the task without filing it, so a caller can show it before committing.
 *
 * The notes deliberately restate the story rather than relying on the link.
 * `linkedRecordIds` is resolved by the Actions screen against grievance records
 * only, so a task raised from a news mention shows there as "no longer stored
 * on this device" — a task that stands on its own beats a task pointing at
 * something the other screen cannot open.
 */
export function actionFromRecommendation(
  rec: Recommendation,
  source: ActionSource,
): ActionItem {
  /*
    The steps, in the order somebody would do them.

    The action itself first — "Issue a rebuttal" — then each line to say, all
    on the channel the reader picked. They were previously three separate
    paragraphs in a notes blob, which meant the office read them once and then
    worked from memory.
  */
  const steps: ActionStep[] = [
    {
      id: `${source.id}-do`,
      text: rec.action,
      channel: rec.channel,
      done: false,
      doneAt: null,
    },
    ...rec.talkingPoints.map((point, i) => ({
      id: `${source.id}-say-${i}`,
      text: `Say: “${point}”`,
      channel: rec.channel,
      done: false,
      doneAt: null,
    })),
  ]

  return {
    id: makeId('action'),
    createdAt: new Date().toISOString(),
    steps,
    linkedRecordIds: [source.id],
    description: [rec.action, source.subject, source.headline]
      .filter((part): part is string => Boolean(part))
      .join(' · '),
    department: null,
    owner: null,
    status: 'Planned',
    priority: rec.priority,
    dueAt: dueIn(DUE_DAYS[rec.priority]),
    completedAt: null,
    escalation: 'None',
    delayReason: null,
    /**
     * Left empty on purpose.
     *
     * This used to be filled with the rationale, the suggested channel, the
     * talking points and where it came from. Every one of those already has a
     * home on the card: the lines ARE the steps, the channel sits on each
     * step, and the provenance is the linked record. So the field rendered a
     * second copy of the card underneath the card, inside a textarea, under a
     * heading reading "Anything else" - which is precisely what it was not.
     *
     * The field itself stays. An office writing "spoke to the collector, he
     * will call back Tuesday" is the entire point of it. It just starts blank
     * now, so what is in it was written by a person.
     */
    notes: '',
  }
}

/**
 * File a task whose instruction is free text rather than a category.
 *
 * `Recommendation.action` is an ActionCategory — one of ten fixed values —
 * because a grievance record's recommendation is classified, not written. The
 * comparison produces something different: one specific instruction for one
 * specific gap, "publish the ward-wise spend against his figure". Forcing that
 * through the enum would file it as "Public clarification" and drop the only
 * sentence in it worth reading.
 *
 * So this takes the instruction as written and makes it the first step. Same
 * dedup rule as fileAction, same shape out — the Actions screen cannot tell the
 * two apart, and should not need to.
 */
export function fileFreeAction(input: {
  action: string
  rationale: string
  talkingPoints: string[]
  priority: ActionPriority
  channel: CommsChannel
  source: ActionSource
}): boolean {
  const { action, rationale, talkingPoints, priority, channel, source } = input

  const already = readStore().actions.some(
    (a) =>
      a.linkedRecordIds.includes(source.id) &&
      (a.status === 'Planned' || a.status === 'In Progress'),
  )
  if (already) return false

  const steps: ActionStep[] = [
    { id: `${source.id}-do`, text: action, channel, done: false, doneAt: null },
    ...talkingPoints.map((point, i) => ({
      id: `${source.id}-say-${i}`,
      text: `Say: “${point}”`,
      channel,
      done: false,
      doneAt: null,
    })),
  ]

  const item: ActionItem = {
    id: makeId('action'),
    createdAt: new Date().toISOString(),
    steps,
    linkedRecordIds: [source.id],
    description: [action, source.subject, source.headline]
      .filter((part): part is string => Boolean(part))
      .join(' · '),
    department: null,
    owner: null,
    status: 'Planned',
    priority,
    dueAt: dueIn(DUE_DAYS[priority]),
    completedAt: null,
    escalation: 'None',
    delayReason: null,
    /** Blank, for the reason given on actionFromRecommendation above. */
    notes: '',
  }

  update((s) => ({ ...s, actions: [item, ...s.actions] }))
  return true
}

/**
 * File a plan whose STEPS are the instructions, each its own checkbox.
 *
 * `fileFreeAction` renders extra lines as `Say: "…"`, which is right for
 * talking points and wrong for a content plan — "Shoot a 30-second clip at
 * the site" is something to do, not to say. Same dedup rule, same shape out.
 */
export function fileStepsAction(input: {
  title: string
  steps: string[]
  priority: ActionPriority
  channel: CommsChannel
  source: ActionSource
}): boolean {
  const { title, steps, priority, channel, source } = input

  const already = readStore().actions.some(
    (a) =>
      a.linkedRecordIds.includes(source.id) &&
      (a.status === 'Planned' || a.status === 'In Progress'),
  )
  if (already) return false

  const item: ActionItem = {
    id: makeId('action'),
    createdAt: new Date().toISOString(),
    steps: steps.map((step, i) => ({
      id: `${source.id}-step-${i}`,
      text: step,
      channel,
      done: false,
      doneAt: null,
    })),
    linkedRecordIds: [source.id],
    description: [title, source.headline].filter(Boolean).join(' · '),
    department: null,
    owner: null,
    status: 'Planned',
    priority,
    dueAt: dueIn(DUE_DAYS[priority]),
    completedAt: null,
    escalation: 'None',
    delayReason: null,
    notes: '',
  }

  update((s) => ({ ...s, actions: [item, ...s.actions] }))
  return true
}

/**
 * File it.
 *
 * Returns false when this source already has an open task, rather than filing a
 * second one. The dashboard offers this button on every recommendation it
 * shows, and it shows the same story every morning until somebody deals with
 * it — without this check, one story that nobody has got to yet quietly becomes
 * five identical tasks by Friday.
 */
export function fileAction(rec: Recommendation, source: ActionSource): boolean {
  const already = readStore().actions.some(
    (a) =>
      a.linkedRecordIds.includes(source.id) &&
      (a.status === 'Planned' || a.status === 'In Progress'),
  )
  if (already) return false

  const item = actionFromRecommendation(rec, source)
  update((s) => ({ ...s, actions: [item, ...s.actions] }))
  return true
}

/** Whether this source already has a task somebody still owes. */
export function hasOpenAction(sourceId: string): boolean {
  return readStore().actions.some(
    (a) =>
      a.linkedRecordIds.includes(sourceId) &&
      (a.status === 'Planned' || a.status === 'In Progress'),
  )
}
