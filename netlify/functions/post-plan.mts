import type { Config, Context } from '@netlify/functions'
import { groundedJson } from './lib/grounded-json'
import { HOUSE_STYLE } from './lib/house-style'

/**
 * The week's content plan: what to actually post, step by step.
 *
 *   POST /api/post-plan { person, reach, working, notLanding, praise,
 *                         criticism, issues, rivalHits }
 *     -> { plans: [{ title, platform, priority, why, steps, draft }] }
 *     -> { error }
 *
 * The dashboard's arithmetic already knows WHAT works — pictures at 1.6x,
 * Instagram at 2.2x, a -90 scheme post. The office asked for the missing
 * half: what to DO about it, written like a colleague would write it, with
 * the steps in order and a draft to start from.
 *
 * Grounding is the whole contract, tighter here than anywhere: these plans
 * go out under a sitting MP's name. Every plan must cite which supplied fact
 * it answers. The model may not invent statistics, dates, beneficiary
 * numbers or promises; where a fact belongs that was not supplied, the draft
 * carries a [square-bracket blank] the office must fill — the same
 * convention the recovery planner and the grievance drafts already use.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const text = (v: unknown, cap = 300): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, cap) : null
}

const strings = (v: unknown, cap: number, each = 220): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => text(x, each))
    .filter((x): x is string => x !== null)
    .slice(0, cap)

const SYSTEM = [
  'You are the social media strategist inside an Indian politician\'s office. You write',
  'the weekly content plan: specific, doable, in plain language, for staff who will',
  'execute it tomorrow morning. The goal is trust, credibility and followers earned',
  'honestly - never engagement bait, never communal provocation, never attacks below',
  'the belt.',
  '',
  'Ground every plan in the EVIDENCE sections supplied. Each plan answers one supplied',
  'fact: a format that works, a platform that under- or over-performs, a criticism to',
  'answer, a live local issue, a move that worked for a rival. Never invent statistics,',
  'dates, scheme names, beneficiary counts or events. In draft text, put a',
  '[square-bracket blank] wherever a real fact must be filled in by the office.',
  '',
  HOUSE_STYLE,
  '',
  'Answer as JSON:',
  '{"plans": [{',
  '  "title": "<imperative, under 10 words>",',
  '  "platform": "<Instagram | Facebook | Twitter/X | YouTube | All>",',
  '  "priority": "<High | Medium>",',
  '  "why": "<2-3 sentences: which supplied number, quote or issue this answers, and',
  '          how it builds trust or reach. Cite the actual figures given.>",',
  '  "steps": ["<step a staffer can do, concrete: what to shoot, who to call, what to',
  '            write, when to post>", ...3 to 5 steps],',
  '  "draft": "<a ready post text in her voice, 1-3 sentences, with [blanks] for facts',
  '           not supplied. Empty string when the plan is not a single post.>"',
  '}, ...exactly 4 or 5 plans]}',
].join('\n')

const SCHEMA = {
  name: 'post_plan',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['plans'],
    properties: {
      plans: {
        type: 'array',
        minItems: 4,
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'platform', 'priority', 'why', 'steps', 'draft'],
          properties: {
            title: { type: 'string' },
            platform: { type: 'string' },
            priority: { type: 'string' },
            why: { type: 'string' },
            steps: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } },
            draft: { type: 'string' },
          },
        },
      },
    },
  },
} as const

interface Plan {
  title: string
  platform: string
  priority: 'High' | 'Medium'
  why: string
  steps: string[]
  draft: string
}

export default async function handler(req: Request, _ctx: Context): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'The body is not JSON.' }, 400)
  }

  const person = (typeof body['person'] === 'object' && body['person']) || {}
  const p = person as Record<string, unknown>
  const who = [text(p['name'], 120), text(p['role'], 120), text(p['party'], 120), text(p['constituency'], 120)]
    .filter(Boolean)
    .join(', ')
  if (!who) return json({ error: 'A plan needs to know whose desk this is.' }, 400)

  const reach = strings(body['reach'], 8, 160)
  const working = strings(body['working'], 6, 200)
  const notLanding = strings(body['notLanding'], 6, 200)
  const praise = strings(body['praise'], 6)
  const criticism = strings(body['criticism'], 6)
  const issues = strings(body['issues'], 6, 200)
  const rivalHits = strings(body['rivalHits'], 6, 240)

  const evidence = [
    `OFFICEHOLDER: ${who}`,
    '',
    reach.length && `REACH, latest reading:\n${reach.map((x) => `- ${x}`).join('\n')}`,
    working.length && `WHAT WORKS FOR HER (measured):\n${working.map((x) => `- ${x}`).join('\n')}`,
    notLanding.length && `WHAT IS NOT LANDING (measured):\n${notLanding.map((x) => `- ${x}`).join('\n')}`,
    praise.length && `WHAT PEOPLE PRAISE HER FOR (verbatim comments):\n${praise.map((x) => `- "${x}"`).join('\n')}`,
    criticism.length && `WHAT PEOPLE CRITICISE (verbatim comments):\n${criticism.map((x) => `- "${x}"`).join('\n')}`,
    issues.length && `LIVE LOCAL ISSUES ON HER DESK THIS WEEK:\n${issues.map((x) => `- ${x}`).join('\n')}`,
    rivalHits.length && `WHAT WORKED FOR RIVALS THIS WEEK:\n${rivalHits.map((x) => `- ${x}`).join('\n')}`,
    '',
    'Write the plan.',
  ]
    .filter(Boolean)
    .join('\n\n')

  if (working.length + notLanding.length + issues.length + criticism.length === 0) {
    return json({ error: 'Not enough measured evidence to plan from yet.' }, 400)
  }

  const out = await groundedJson<{ plans?: unknown }>({
    system: SYSTEM,
    user: evidence,
    schema: SCHEMA,
    usable: (c) =>
      Array.isArray(c.plans) &&
      c.plans.some(
        (x) =>
          typeof x === 'object' &&
          x !== null &&
          typeof (x as Record<string, unknown>)['title'] === 'string' &&
          Array.isArray((x as Record<string, unknown>)['steps']),
      ),
  })
  if (!out) {
    return json({ error: 'The model could not be reached, or answered with something unreadable. Try again.' })
  }

  const plans: Plan[] = (Array.isArray(out.plans) ? out.plans : [])
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({
      title: text(x['title'], 120) ?? '',
      platform: text(x['platform'], 20) ?? 'All',
      priority: text(x['priority'], 10) === 'High' ? ('High' as const) : ('Medium' as const),
      why: text(x['why'], 600) ?? '',
      steps: strings(x['steps'], 5, 300),
      draft: text(x['draft'], 600) ?? '',
    }))
    .filter((x) => x.title && x.steps.length >= 2)
    .slice(0, 5)

  if (plans.length === 0) {
    return json({ error: 'The model answered with nothing usable. Try again.' })
  }
  return json({ plans, readAt: new Date().toISOString() })
}

export const config: Config = { path: '/api/post-plan' }
