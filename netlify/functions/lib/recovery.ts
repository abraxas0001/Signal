import { complete } from './openai-compat'
import { resolveProviders } from './provider'
import { HOUSE_STYLE } from './house-style'
import { COMMS_CHANNELS } from '../../../shared/taxonomy'

/**
 * What to actually DO about hostile coverage.
 *
 * The opinion panel could tell an office that its coverage was divided and that
 * three named things were being said against it, and then it stopped. That is
 * the half of the job that is easy to automate and the less useful half: a
 * member who already knows they are being attacked over land allocations does
 * not need a screen to confirm it. They need to know which of the three
 * attacks is actually moving, what is underneath it, and what to do this week.
 *
 * So this takes the criticisms that were already gathered and read them the
 * other way round: for each one, what is the root cause, is it a fact problem
 * or a story problem, and what closes it. It is deliberately NOT another web
 * search. The evidence has already been collected by the opinion pass and
 * paying for a second grounded search would double the cost and the wait to
 * re-read the same articles.
 *
 * TWO THINGS IT IS NOT ALLOWED TO DO, both enforced in the prompt:
 *
 * It must not propose denying or burying something. An office that files
 * "issue a rebuttal" against a true allegation has been given a way to make
 * things worse, and this product would be the thing that handed it to them.
 * Where the criticism looks founded, the plan has to say so and the remedy has
 * to be substantive.
 *
 * It must not invent facts about what the office has done. It has the
 * criticisms and the praise and nothing else, so a step reads "publish the
 * ward-level spend for the last two years", never "point out that you already
 * published it".
 */

export interface RecoveryStep {
  /** The instruction, as a person would give it. */
  action: string
  /** Why this one, tied to the criticism it answers. */
  rationale: string
  /** Where it happens. One of COMMS_CHANNELS, or null when it is not comms. */
  channel: string | null
  /** What to say, if anything. Empty when the step is work rather than words. */
  talkingPoints: string[]
  priority: 'Critical' | 'High' | 'Medium' | 'Low'
  /**
   * Which numbered criticism this answers, 1-based. 0 when it answers none.
   *
   * A number rather than the label text. Asked to copy the label back, the
   * model wrote a talking point into the field instead, twice out of two
   * runs. An index is a thing it can get right.
   */
  answers: number
}

export interface RecoveryCause {
  /** The criticism, in the office's own words. */
  issue: string
  /**
   * What is really driving it.
   *
   * The distinction that matters operationally: a SUBSTANCE problem is fixed by
   * doing something, a PERCEPTION problem is fixed by saying something, and
   * treating one as the other is how offices make things worse.
   */
  kind: 'substance' | 'perception' | 'both' | 'unclear'
  /** The reasoning, two or three sentences. */
  why: string
  /** Whether the record suggests the criticism is founded. */
  founded: 'looks founded' | 'looks contested' | 'looks unfounded' | 'cannot tell'
}

export interface RecoveryPlan {
  /** One sentence on what is actually wrong. */
  reading: string
  causes: RecoveryCause[]
  steps: RecoveryStep[]
  /** What NOT to do. Offices act on this as much as on the steps. */
  avoid: string[]
}

const SYSTEM = `You advise the office of an Indian elected representative on repairing their standing after hostile coverage.

You are given what is being said against them, what is being said for them, and how loud each is. You are NOT given a record of what the office has already done, so never assert that they have done anything.

Work in two passes.

FIRST, the root cause of each criticism. For each one decide:
- kind: "substance" if it is fixed by doing something, "perception" if it is fixed by explaining something, "both" if it needs each, "unclear" if the evidence does not say.
- founded: is the criticism supported by what you were given? Use "looks founded", "looks contested", "looks unfounded" or "cannot tell". Judge the evidence, not the politics.
- why: what is underneath it.

SECOND, the steps. Concrete, this-week actions, most important first. Six at most, and fewer is better than padding.

RULES YOU MUST NOT BREAK:
- Where a criticism looks founded, the remedy is substantive. Do not propose denial, deflection, attacking the accuser, or burying it. Say plainly that it needs fixing, and what fixing it looks like.
- NEVER invent an achievement, a project, a place name, a figure or a date. You do
  not know what this office has done, and a talking point asserting something
  untrue is worse for them than saying nothing.
- A talking point may only use specifics that appear in the material above. Where
  a point needs a specific the office must supply, write it as a square-bracket
  blank for them to fill: "we completed [name the scheme] in [name the village]".
  Never fill such a blank yourself, and never write a placeholder like "X, Y, Z".
- No step may involve misleading anyone, buying coverage, or attacking a private individual.
- Where the honest answer is that nothing can be said until an enquiry reports, say that, and make the step about preparing for it.
- "avoid" is for the specific mistakes this office is likely to make here. Two or three, or none.

Channels must be one of: ${COMMS_CHANNELS.join(', ')}. Use null when a step is work rather than communication.

${HOUSE_STYLE}`

const CAUSE = {
  type: 'object' as const,
  properties: {
    issue: { type: 'string' },
    kind: { type: 'string', enum: ['substance', 'perception', 'both', 'unclear'] },
    why: { type: 'string' },
    founded: {
      type: 'string',
      enum: ['looks founded', 'looks contested', 'looks unfounded', 'cannot tell'],
    },
  },
  required: ['issue', 'kind', 'why', 'founded'],
  additionalProperties: false,
}

const STEP = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string',
      description: 'The instruction. What to do, as you would say it to a staffer.',
    },
    rationale: { type: 'string', description: 'Why this step, in one sentence.' },
    channel: {
      type: ['string', 'null'],
      description: 'Where it happens, from the allowed list. null when it is work rather than words.',
    },
    talkingPoints: {
      type: 'array',
      items: { type: 'string' },
      description: 'What to SAY, quoted, if this step involves speaking. Empty array when it does not.',
    },
    priority: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
    answers: {
      type: 'integer',
      description:
        'The NUMBER of the criticism this step answers, from the numbered list you were given. A number only. Use 0 if it answers none of them.',
    },
  },
  required: ['action', 'rationale', 'channel', 'talkingPoints', 'priority', 'answers'],
  additionalProperties: false,
}

const SCHEMA = {
  type: 'object' as const,
  properties: {
    reading: { type: 'string' },
    causes: { type: 'array', items: CAUSE },
    steps: { type: 'array', items: STEP },
    avoid: { type: 'array', items: { type: 'string' } },
  },
  required: ['reading', 'causes', 'steps', 'avoid'],
  additionalProperties: false,
}

export interface RecoveryInput {
  name: string
  role?: string | null
  constituency?: string | null
  party?: string | null
  score: number
  favourable?: number | null
  hostile?: number | null
  verdict?: string | null
  criticism: { label: string; detail: string; weight?: string | null; who?: string | null }[]
  praise: { label: string; detail: string }[]
  controversies: { label: string; detail: string }[]
}

const line = (t: { label: string; detail: string; weight?: string | null; who?: string | null }): string =>
  `- ${t.label}${t.who ? ` (said by ${t.who})` : ''}${t.weight ? ` [${t.weight}]` : ''}: ${t.detail}`

export async function planRecovery(
  input: RecoveryInput,
  signal?: AbortSignal,
): Promise<RecoveryPlan | null> {
  const providers = resolveProviders()
  if (!providers.length) return null

  const who = [input.name, input.role, input.constituency, input.party].filter(Boolean).join(', ')

  const user = [
    `OFFICE: ${who}`,
    `NET SCORE: ${input.score} on a scale of -100 to +100.`,
    input.favourable != null && input.hostile != null
      ? `Praise measured ${input.favourable} out of 100 for loudness; criticism ${input.hostile}.`
      : '',
    input.verdict ? `SUMMARY ALREADY WRITTEN: ${input.verdict}` : '',
    '',
    'WHAT IS SAID AGAINST THEM (numbered, for the `answers` field):',
    ...(input.criticism.length
      ? input.criticism.map((t, i) => `${i + 1}. ${line(t).slice(2)}`)
      : ['- nothing recorded']),
    '',
    'CONTROVERSIES:',
    ...(input.controversies.length ? input.controversies.map(line) : ['- none recorded']),
    '',
    'WHAT IS SAID FOR THEM:',
    ...(input.praise.length ? input.praise.map(line) : ['- nothing recorded']),
    '',
    'Give the root cause of each criticism, then the steps that would actually move this.',
  ]
    .filter(Boolean)
    .join('\n')

  /**
   * Every provider in turn, same as the opinion pass.
   *
   * One key being rate-limited must not lose the plan, because by the time
   * this runs the office has already paid for a grounded search to gather the
   * criticisms it is reasoning about.
   */
  let parsed: RecoveryPlan | null = null
  for (const provider of providers.filter((p) => p.baseUrl)) {
    try {
      const out = await complete({ provider, system: SYSTEM, user, schema: SCHEMA, signal })
      parsed = JSON.parse(out.text) as RecoveryPlan
      break
    } catch {
      /* next provider */
    }
  }
  if (!parsed) return null

  const channels = new Set<string>(COMMS_CHANNELS)
  return {
    reading: typeof parsed.reading === 'string' ? parsed.reading : '',
    causes: (Array.isArray(parsed.causes) ? parsed.causes : []).slice(0, 8),
    steps: (Array.isArray(parsed.steps) ? parsed.steps : []).slice(0, 6).map((s) => ({
      ...s,
      // A channel the app does not know about cannot be filed against, and a
      // step that silently loses its channel is worse than one with none.
      channel: s.channel && channels.has(s.channel) ? s.channel : null,
      talkingPoints: Array.isArray(s.talkingPoints) ? s.talkingPoints.slice(0, 4) : [],
      // An index into a list that does not have that many entries would make
      // the screen group a step under the wrong complaint.
      answers:
        typeof s.answers === 'number' && s.answers >= 1 && s.answers <= input.criticism.length
          ? s.answers
          : 0,
    })),
    avoid: (Array.isArray(parsed.avoid) ? parsed.avoid : []).slice(0, 4),
  }
}
