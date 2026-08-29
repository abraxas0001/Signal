import type { Config, Context } from '@netlify/functions'
import { complete } from './lib/openai-compat'
import { resolveProviders } from './lib/provider'
import { HOUSE_STYLE } from './lib/house-style'

/**
 * The week's rivalry, read closely.
 *
 *   POST /api/week-compare { window, people: [{ name, own, posts: [...] }] }
 *     -> { people: [{ name, playbook, bestPost, whyItWorked }], lessons: [...] }
 *     -> { error }
 *
 * One model call, grounded ONLY in the posts sent with the request — the
 * titles, platforms and reaction counts the desk already collected. The card
 * on the dashboard says who won the week; this says HOW: what each rival
 * actually posted, which post carried their week and why, and what the
 * office should copy. The prompt bans invention outright: every claim must
 * point at a post in the list, because "they post reels at 6pm" is only
 * analysis if the list shows it.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const text = (v: unknown, cap = 200): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, cap) : null
}

/** Posts per person in the prompt. Their top of the week, not their archive. */
const MAX_POSTS = 8
const MAX_PEOPLE = 5

const SYSTEM = [
  'You analyse how Indian politicians run their social media, for the office of one of them.',
  'You are given one week of posts for several people: platform, title, reactions, views.',
  'The FIRST person marked "own": true is the office you are advising. The rest are rivals.',
  '',
  'Ground every claim in the posts provided. Never invent a post, a number, a time of day',
  'or a format the list does not show. If the titles do not reveal a pattern, say what the',
  'numbers do show instead. Judge reach by the numbers given, nothing else.',
  '',
  HOUSE_STYLE,
  '',
  'Answer as JSON:',
  '{"people": [{"name": "<as given>",',
  '  "playbook": "<2 short sentences: what they posted this week and how they run the handle - volume, platforms, formats, topics>",',
  '  "bestPost": "<the title of their highest-reach post, verbatim from the list, trimmed>",',
  '  "whyItWorked": "<1 sentence on why that post led their week, grounded in its topic or format>"}],',
  ' "lessons": ["<a specific, doable move for the office, learned from what worked for the rivals>", ...3 to 5]}',
  '',
  'Every person in the input appears in "people", the office included. lessons are',
  'imperatives addressed to the office, each traceable to something in the lists.',
].join('\n')

const SCHEMA = {
  name: 'week_compare',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['people', 'lessons'],
    properties: {
      people: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'playbook', 'bestPost', 'whyItWorked'],
          properties: {
            name: { type: 'string' },
            playbook: { type: 'string' },
            bestPost: { type: 'string' },
            whyItWorked: { type: 'string' },
          },
        },
      },
      lessons: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } },
    },
  },
} as const

interface WeekPost {
  platform: string
  title: string
  reactions: number
  views: number | null
}

export default async function handler(req: Request, _ctx: Context): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'The body is not JSON.' }, 400)
  }

  const rawPeople = Array.isArray(body['people']) ? body['people'] : []
  const people = rawPeople
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
    .slice(0, MAX_PEOPLE)
    .map((p) => ({
      name: text(p['name'], 120) ?? 'Unnamed',
      own: p['own'] === true,
      posts: (Array.isArray(p['posts']) ? p['posts'] : [])
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map(
          (x): WeekPost => ({
            platform: text(x['platform'], 20) ?? '?',
            title: text(x['title'], 120) ?? '(no caption)',
            reactions: typeof x['reactions'] === 'number' ? x['reactions'] : 0,
            views: typeof x['views'] === 'number' ? x['views'] : null,
          }),
        )
        .slice(0, MAX_POSTS),
    }))
    .filter((p) => p.posts.length > 0)

  if (people.length < 2 || !people.some((p) => p.own)) {
    return json({ error: 'A comparison needs the office and at least one rival with posts.' }, 400)
  }

  const providers = resolveProviders()
  if (!providers.length) {
    return json({ error: 'No language model is configured. Set a provider key.' })
  }

  const user = [
    `WEEK: ${text(body['window'], 60) ?? 'the last seven days'}`,
    '',
    ...people.flatMap((p) => [
      `${p.name}${p.own ? ' (own: true - the office you advise)' : ''}:`,
      ...p.posts.map(
        (x) =>
          `- [${x.platform}] ${x.reactions} reactions${x.views != null ? `, ${x.views} views` : ''}: ${x.title}`,
      ),
      '',
    ]),
    'Analyse the week.',
  ].join('\n')

  /**
   * A candidate that can actually render: people is an array of OBJECTS with
   * the two fields the cards need. The check exists because Gemini's
   * OpenAI-compatible endpoint, handed the strict schema, sometimes flattens
   * the array of objects into an array of alternating strings — valid JSON,
   * nothing usable — while the same model given plain json_object mode
   * follows the prompt's example faithfully.
   */
  const usable = (c: { people?: unknown }): boolean =>
    Array.isArray(c.people) &&
    c.people.some(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as Record<string, unknown>)['name'] === 'string' &&
        typeof (p as Record<string, unknown>)['playbook'] === 'string',
    )

  const started = Date.now()
  let parsed: { people?: unknown; lessons?: unknown } | null = null
  outer: for (const provider of providers.filter((p) => p.baseUrl)) {
    for (const schema of [SCHEMA] as const) {
      try {
        const out = await complete({ provider, system: SYSTEM, user, schema })
        const candidate = JSON.parse(out.text) as { people?: unknown; lessons?: unknown }
        if (!usable(candidate)) continue
        parsed = candidate
        // Done only once the lessons arrived too: they are the half the
        // office opens this for, and models forget them intermittently.
        if (Array.isArray(candidate.lessons) && candidate.lessons.length > 0) break outer
      } catch {
        /* next mode, then next provider */
      }
    }
  }
  /**
   * The proven fallback: Gemini's NATIVE endpoint with responseMimeType json.
   *
   * The OpenAI-compatible wrapper is where Gemini's answers go wrong — its
   * schema translation flattens nested arrays, and its loose mode emitted
   * bare numbers under test — while the native endpoint has produced clean
   * nested JSON for every scraper pass this dataset was built with. When the
   * compat loop yields nothing usable, this is the path that actually works.
   */
  if (!parsed || !usable(parsed)) {
    const key = process.env['GEMINI_API_KEY']
    if (key) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${SYSTEM}\n\n${user}` }] }],
              generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
            }),
            signal: AbortSignal.timeout(25_000),
          },
        )
        if (res.ok) {
          const j = (await res.json()) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[]
          }
          const candidate = JSON.parse(
            j.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
          ) as { people?: unknown; lessons?: unknown }
          if (usable(candidate)) parsed = candidate
        }
      } catch {
        /* the error below says what to do */
      }
    }
  }

  if (!parsed || !usable(parsed)) {
    return json({
      error: 'The model could not be reached, or answered with something unreadable. Try again.',
      ms: Date.now() - started,
    })
  }

  /**
   * The lessons are the half the office opens this for, and on the loose
   * json_object fallback the model forgets them roughly every other run. A
   * second, lessons-only ask converges where re-rolling the whole reading
   * does not: the small prompt has exactly one job.
   */
  if (!Array.isArray(parsed.lessons) || parsed.lessons.length === 0) {
    const LESSONS_SCHEMA = {
      name: 'week_lessons',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['lessons'],
        properties: {
          lessons: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } },
        },
      },
    } as const
    for (const provider of providers.filter((p) => p.baseUrl)) {
      try {
        const out = await complete({
          provider,
          system:
            'You advise an Indian politician\'s office on social media. Given one week of posts for the office and its rivals, answer as JSON {"lessons": ["...", ...3 to 5]}: specific, doable moves for the office, each learned from something that visibly worked in the lists. No invention beyond the lists.',
          user,
          schema: LESSONS_SCHEMA,
        })
        const extra = JSON.parse(out.text) as { lessons?: unknown }
        if (Array.isArray(extra.lessons) && extra.lessons.length > 0) {
          parsed.lessons = extra.lessons
          break
        }
      } catch {
        /* next provider */
      }
    }
  }

  const out = {
    people: (Array.isArray(parsed.people) ? parsed.people : [])
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      .map((p) => ({
        name: text(p['name'], 120) ?? '',
        playbook: text(p['playbook'], 500) ?? '',
        bestPost: text(p['bestPost'], 200) ?? '',
        whyItWorked: text(p['whyItWorked'], 300) ?? '',
      }))
      .filter((p) => p.name && p.playbook),
    lessons: (Array.isArray(parsed.lessons) ? parsed.lessons : [])
      .map((l) => text(l, 300))
      .filter((l): l is string => l !== null)
      .slice(0, 5),
    readAt: new Date().toISOString(),
  }
  if (out.people.length === 0) {
    return json({ error: 'The model answered with nothing usable. Try again.' })
  }
  return json(out)
}

export const config: Config = { path: '/api/week-compare' }
