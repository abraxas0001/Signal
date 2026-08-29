import type { Config, Context } from '@netlify/functions'
import { complete } from './lib/openai-compat'
import { resolveProviders } from './lib/provider'
import { HOUSE_STYLE } from './lib/house-style'

/**
 * Suggested social posts for one issue on the grievance desk.
 *
 *   POST /api/suggest-posts { issue, records, person }
 *     -> { posts: [{ text, angle, platform }] }   three or four of them
 *     -> { error }                                 a sentence the office can read
 *
 * One model call and no search, like /api/recovery next door: the evidence
 * arrives with the request, having already been paid for when the desk read
 * the stories. The records sent are the ones behind the issue, capped at
 * five, and they are the ONLY material the model is allowed to draw on.
 *
 * That grounding rule is the whole design. A drafted post goes out under the
 * member's own name, so a post that invents a statistic, a completion date or
 * a person is strictly worse than no post at all — it is this product writing
 * a falsehood into a politician's mouth. The prompt bans invention outright
 * and the square-bracket convention (borrowed from recovery) gives the model
 * a legal way to leave a blank the office must fill.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const text = (v: unknown, cap = 400): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, cap) : null
}

/** How many records one draft is grounded in. More is a longer prompt, not a better post. */
const MAX_RECORDS = 5

/** The platforms a post may be suggested for. */
const PLATFORMS = ['Twitter/X', 'Facebook', 'Instagram'] as const

/**
 * Fold whatever the model wrote into one of the three platforms.
 *
 * The strict schema constrains this already on providers that honour
 * json_schema, but the loosest fallback mode constrains nothing, and a chip
 * reading "X (formerly Twitter)" on the issue card is the model's phrasing
 * leaking into the UI. The platform is a suggestion, not a finding, so folding
 * an unrecognised value to the default suggestion loses nothing true.
 */
function toPlatform(v: unknown): (typeof PLATFORMS)[number] {
  const raw = typeof v === 'string' ? v.toLowerCase() : ''
  if (raw.includes('facebook') || raw === 'fb') return 'Facebook'
  if (raw.includes('insta')) return 'Instagram'
  return 'Twitter/X'
}

interface DraftRecord {
  headline: string
  excerpt: string | null
  publisher: string | null
}

/** Records off the wire, capped so a huge body cannot become a huge prompt. */
function toRecords(raw: unknown): DraftRecord[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      headline: text(r['headline'], 300) ?? '',
      excerpt: text(r['excerpt'], 600),
      publisher: text(r['publisher'], 120),
    }))
    .filter((r) => r.headline)
    .slice(0, MAX_RECORDS)
}

const SYSTEM = `You draft social media posts for the office of an Indian elected representative. The office has read the press about one local issue and needs three or four posts the officeholder could publish about it.

RULES YOU MUST NOT BREAK:
- Write in the first person, as the officeholder speaking to their constituents.
- Ground every post ONLY in the records supplied. NEVER invent a statistic, a name, a scheme, or a promise with a date. Where a post needs a specific only the office can supply, write it as a square-bracket blank for them to fill: "work resumes on [date]". Never fill such a blank yourself.
- Plain English. When the constituency is in Telangana, at most one post may close with a single line in Telugu; every other line stays English.
- Each post stays under 280 characters, counting spaces and hashtags.
- At most 2 hashtags in a post, and none is fine.
- No exclamation marks. No marketing voice.
- Each post takes a different approach. "angle" is a 3 to 6 word label for that approach, such as "acknowledge and set a deadline" or "correct the record calmly".
- "platform" is where the post fits best: Twitter/X, Facebook, or Instagram.
- Return 3 or 4 posts. Three good ones beat four padded ones.

${HOUSE_STYLE}`

const POST = {
  type: 'object' as const,
  properties: {
    text: {
      type: 'string',
      description: 'The post itself, ready to publish. Under 280 characters.',
    },
    angle: {
      type: 'string',
      description: 'A 3 to 6 word label for the approach, e.g. "acknowledge and set a deadline".',
    },
    platform: { type: 'string', enum: [...PLATFORMS] },
  },
  required: ['text', 'angle', 'platform'],
  additionalProperties: false,
}

const SCHEMA = {
  type: 'object' as const,
  properties: {
    posts: { type: 'array', items: POST },
  },
  required: ['posts'],
  additionalProperties: false,
}

export default async function handler(req: Request, _c: Context): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Send a POST.' }, 405)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'That request was not valid JSON.' }, 400)
  }

  const issue =
    typeof body['issue'] === 'object' && body['issue'] !== null
      ? (body['issue'] as Record<string, unknown>)
      : {}
  const person =
    typeof body['person'] === 'object' && body['person'] !== null
      ? (body['person'] as Record<string, unknown>)
      : {}

  const title = text(issue['title'], 300)
  if (!title) return json({ error: 'Name the issue these posts are about.' }, 400)

  const name = text(person['name'], 120)
  if (!name) return json({ error: 'Name the person these posts speak for.' }, 400)

  const records = toRecords(body['records'])

  /**
   * No records is a refusal, not an empty draft.
   *
   * The posts are only allowed to use what the papers printed, so with nothing
   * printed in front of it the model would have to invent the substance — and
   * an invented post under a politician's name is the one output this endpoint
   * must never produce.
   */
  if (records.length === 0) {
    return json({
      error:
        'None of the records behind this issue are on this device, so there is nothing to ground a post in. Open the issue with its records present and draft again.',
    })
  }

  const providers = resolveProviders()
  if (!providers.length) {
    return json({
      error: 'No language model is configured, so no posts could be drafted. Set a provider key.',
    })
  }

  const who = [
    name,
    text(person['role'], 120),
    text(person['party'], 120),
    text(person['constituency'], 120),
  ]
    .filter(Boolean)
    .join(', ')

  const user = [
    `OFFICEHOLDER: ${who}`,
    '',
    `THE ISSUE: ${title}`,
    [text(issue['severity'], 20) && `Severity ${text(issue['severity'], 20)}`,
      text(issue['category'], 60) && `category ${text(issue['category'], 60)}`]
      .filter(Boolean)
      .join(', '),
    text(issue['summary'], 900) ?? '',
    '',
    'WHAT THE PAPERS PRINTED:',
    ...records.map(
      (r) =>
        `- ${r.publisher ?? 'Paper not named'}: ${r.headline}${r.excerpt ? `. ${r.excerpt}` : ''}`,
    ),
    '',
    'Write the posts.',
  ]
    .filter(Boolean)
    .join('\n')

  /**
   * Every provider in turn, same as the recovery planner. One key being
   * rate-limited must not lose the draft: by the time this runs the office has
   * already paid to read the records it is drafting from.
   */
  const started = Date.now()
  let parsed: { posts?: unknown } | null = null
  for (const provider of providers.filter((p) => p.baseUrl)) {
    try {
      const out = await complete({ provider, system: SYSTEM, user, schema: SCHEMA })
      parsed = JSON.parse(out.text) as { posts?: unknown }
      break
    } catch {
      /* next provider */
    }
  }
  if (!parsed) {
    return json({
      error: 'The model could not be reached, or answered with something unreadable. Try again.',
      ms: Date.now() - started,
    })
  }

  /**
   * The model's output, checked before it reaches a screen. A post over 400
   * characters has ignored the length rule badly enough that trimming it would
   * publish a sentence cut mid-thought, so it is dropped whole instead.
   */
  const posts = (Array.isArray(parsed.posts) ? parsed.posts : [])
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
    .map((p) => ({
      // Not the capped text() helper: capping would trim an over-long post to
      // 400 and pass it, and the filter below is meant to reject it whole.
      text: typeof p['text'] === 'string' ? p['text'].trim() : '',
      angle: text(p['angle'], 80) ?? '',
      platform: toPlatform(p['platform']),
    }))
    .filter((p) => p.text.length > 0 && p.text.length <= 400 && p.angle)
    .slice(0, 4)

  if (posts.length === 0) {
    return json({
      error: 'The model returned nothing that passed the checks. Draft again.',
      ms: Date.now() - started,
    })
  }

  return json({ posts, ms: Date.now() - started })
}

export const config: Config = {
  path: '/api/suggest-posts',
  /**
   * One model call, run when somebody presses a button on one issue card.
   * Generous enough to redraft a few issues in a sitting, tight enough that a
   * loop cannot burn the provider key.
   */
  rateLimit: { windowLimit: 10, windowSize: 120, aggregateBy: ['ip'] },
}
