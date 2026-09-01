import type { Config, Context } from '@netlify/functions'
import { groundedJson } from './lib/grounded-json'
import { resolveProviders } from './lib/provider'
import { HOUSE_STYLE } from './lib/house-style'

/**
 * What to post next after one post, and the post itself.
 *
 *   POST /api/post-idea { person, post, landed, about, audience, notes, hasComments }
 *     -> { whatToPostNext, idea: { text, angle, platform }, readAt }
 *     -> { error }   a sentence the office can read
 *
 * Two answers in one call, because they are one thought. The paragraph says
 * what this post's reception points to; the draft acts on it. Asking twice
 * would pay a model twice for the same reading, and would let the draft quietly
 * argue with the paragraph printed above it on the same screen.
 *
 * The evidence arrives as ENGLISH SENTENCES the client has already written from
 * the stored reading, and no raw metric ever reaches this endpoint. That is
 * deliberate. A model handed `{likes: 268, shares: null}` writes "engagement was
 * mixed across the metrics"; a model handed "Facebook published 268 likes and 22
 * comments. Shares were not published." writes about the 268, and knows the
 * shares were never measured rather than measured at zero. A sentence can carry
 * an absence. A number cannot.
 *
 * Grounding is the contract, as it is in suggest-posts next door: the draft goes
 * out under a serving member's name, so an invented statistic, date or promise
 * is strictly worse than no draft at all. A specific only the office can supply
 * is written as a [square-bracket blank] and never filled in here.
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

/**
 * How many sentences of each kind one suggestion is grounded in.
 *
 * The same reasoning suggest-posts caps its records with: past this point more
 * evidence is a longer prompt rather than a better post, and an uncapped body is
 * a way for one request to spend a whole per-minute token allowance. Eight is
 * comfortably above what a single reading produces for any of these four lists.
 */
const MAX_LINES = 8

/** A summary line the client wrote. */
const LINE_CAP = 300
/** A verbatim comment, which runs longer than a line written to fit. */
const QUOTE_CAP = 400

/** Sentences off the wire, sanitised and capped. */
const lines = (v: unknown, cap = LINE_CAP): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => text(x, cap))
    .filter((x): x is string => x !== null)
    .slice(0, MAX_LINES)

/**
 * Fold whatever the model named onto a platform this desk actually publishes on.
 *
 * The strict schema constrains this on providers that honour json_schema, but
 * the loosest fallback mode constrains nothing, and a chip reading "X (formerly
 * Twitter)" on the highlights screen is the model's phrasing leaking into the
 * UI. The platform is a suggestion rather than a finding, so folding an
 * unrecognised value onto the platform this post was published on loses nothing
 * true.
 */
function toPlatform(v: unknown, fallback: string): string {
  const raw = typeof v === 'string' ? v.toLowerCase() : ''
  if (raw.includes('facebook') || raw === 'fb') return 'Facebook'
  if (raw.includes('insta')) return 'Instagram'
  if (raw.includes('youtube') || raw === 'yt') return 'YouTube'
  if (raw.includes('linkedin')) return 'LinkedIn'
  if (raw.includes('thread')) return 'Threads'
  if (raw.includes('twitter') || raw === 'x' || raw.includes('/x')) return 'Twitter/X'
  return fallback
}

/**
 * The paragraph that stops this endpoint putting words in the public's mouth.
 *
 * A reading of a post with no comments under it still carries a sentiment score
 * and a set of emotion weights, and on screen they look exactly like the ones on
 * a post with two hundred comments. They are not the same measurement. With
 * comments they are the audience answering. Without them they are the register
 * of the post itself, which is the office's own voice measured and handed back.
 *
 * A model that misses the distinction writes "your followers are asking for a
 * clear timeline" on the strength of the office's own anxious phrasing, and the
 * office then answers a public demand that nobody ever made. So on those posts
 * the prompt does not merely leave the audience out. It forbids the claim
 * outright and says what the figures actually are.
 */
const NO_COMMENTS_NOTICE = [
  'NO COMMENTS WERE RETRIEVABLE FOR THIS POST.',
  'Every emotion and sentiment figure above therefore describes the register of the post itself, not of anybody answering it.',
  'Do not write that the audience asked for anything, wanted anything, felt anything, or responded in any way.',
  'Nobody has been heard from on this post. Say that plainly where it bears on your reasoning.',
].join(' ')

const SYSTEM = `You advise the office of an Indian elected representative on what to publish next. The office has already read how one of their own posts landed, and that reading is the ONLY evidence you get.

Answer two questions in one go, because they are one thought:
- whatToPostNext: one short paragraph, three or four sentences, on what this office should post next and what in this reading points there. Reasoning, not a draft.
- idea: one post they could publish today, ready to paste.

RULES YOU MUST NOT BREAK:
- Write the draft in the first person, as the officeholder speaking to their constituents.
- Ground both answers ONLY in the evidence supplied. NEVER invent a statistic, a name, a scheme, an event, or a promise with a date. Where the draft needs a specific only the office can supply, write it as a square-bracket blank for them to fill: "work resumes on [date]". Never fill such a blank yourself.
- Place names are the invention that slips through most easily. Name a village, canal, ward, project stage or office ONLY where the evidence names it. Where the draft wants one it was not given, write [place] and leave it for the office. A canal that does not exist, published under this member's name, is a correction she has to issue.
- When the evidence says no comments were retrievable for the post, the emotion and sentiment figures are the register of the post itself, not the audience answering it. On such a post you must not claim the audience asked for anything, wanted anything, or felt anything. Nobody has been heard from, and saying so is the honest reading.
- Quote the audience only where a verbatim comment is supplied, and quote it as it was written.
- The draft stays under 280 characters, counting spaces and hashtags.
- At most 2 hashtags in the draft, and none is fine.
- Plain English. When the constituency is in Telangana, the draft may close with a single line in Telugu; every other line stays English.
- No exclamation marks. No marketing voice.
- "angle" is a 3 to 6 word label for the approach, such as "thank them and name the next step" or "answer the criticism directly".
- "platform" is where this next post fits best.
- If the evidence here is thin, say the evidence is thin, in those words, and stop. A confident suggestion resting on nothing is worse for this office than a short one that admits what is missing.

${HOUSE_STYLE}`

const SCHEMA = {
  type: 'object' as const,
  properties: {
    whatToPostNext: {
      type: 'string',
      description:
        'Three or four sentences on what to post next and what in the reading points there.',
    },
    idea: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The post itself, ready to publish. Under 280 characters.',
        },
        angle: {
          type: 'string',
          description:
            'A 3 to 6 word label for the approach, e.g. "answer the criticism directly".',
        },
        platform: { type: 'string', description: 'Where this next post fits best.' },
      },
      required: ['text', 'angle', 'platform'],
      additionalProperties: false,
    },
  },
  required: ['whatToPostNext', 'idea'],
  additionalProperties: false,
}

/**
 * What the model is asked for, before any of it has been checked.
 *
 * A type alias rather than an interface on purpose: `groundedJson` is generic
 * over `Record<string, unknown>`, and TypeScript grants an implicit index
 * signature to an anonymous object type but never to an interface. Declaring
 * this as an interface fails to compile with a message about a missing index
 * signature that says nothing about the real cause.
 */
type Draft = {
  whatToPostNext?: unknown
  idea?: unknown
}

export default async function handler(req: Request, _c: Context): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Send a POST.' }, 405)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'That request was not valid JSON.' }, 400)
  }

  const person =
    typeof body['person'] === 'object' && body['person'] !== null
      ? (body['person'] as Record<string, unknown>)
      : {}
  const post =
    typeof body['post'] === 'object' && body['post'] !== null
      ? (body['post'] as Record<string, unknown>)
      : {}

  const name = text(person['name'], 120)
  if (!name) return json({ error: 'Name the person this suggestion speaks for.' }, 400)

  const title = text(post['title'], 300)
  /**
   * The post's own platform is what an unrecognised suggestion folds onto, so a
   * body without one leaves nothing to fold onto. Any desk that has read a post
   * knows which platform it read it from, which makes this a malformed request
   * rather than a thin one.
   */
  const platform = text(post['platform'], 40)
  if (!title || !platform) {
    return json({ error: 'Name the post and the platform this suggestion follows from.' }, 400)
  }

  const publishedAt = text(post['publishedAt'], 40)
  const landed = lines(body['landed'])
  const about = lines(body['about'])
  const audience = lines(body['audience'], QUOTE_CAP)
  const notes = lines(body['notes'])
  /**
   * Absent means absent. A body that omits the flag has not told us this post
   * had comments, so it is read as the cautious case and the model is warned off
   * the audience either way.
   */
  const hasComments = body['hasComments'] === true

  /**
   * No evidence is a refusal, not an empty draft.
   *
   * Everything the suggestion may say has to come from the reading, so with no
   * reading in front of it the model would have to invent the substance. An
   * invented post published under a politician's name is the one output this
   * endpoint must never produce, which is the same line suggest-posts holds when
   * an issue arrives with none of its records.
   */
  if (landed.length + about.length + audience.length + notes.length === 0) {
    return json({
      error:
        'The reading for this post carried nothing to ground a suggestion in. Read the post again, then draft.',
    })
  }

  const providers = resolveProviders()
  if (!providers.length) {
    return json({
      error:
        'No language model is configured, so no suggestion could be drafted. Set a provider key.',
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

  /**
   * The audience section has three states, and they are three different facts.
   * Comments read and passed on is evidence. Comments read but not passed on is
   * a gap in this request. No comments retrievable at all is a property of the
   * post, and it is the one that changes what the emotion figures mean.
   */
  const audienceBlock = !hasComments
    ? NO_COMMENTS_NOTICE
    : audience.length
      ? `WHAT THE AUDIENCE SAID:\n${audience.map((x) => `- ${x}`).join('\n')}`
      : 'Comments were read on this post, but none of their text was sent with this request. Do not quote the audience, and do not characterise what it said.'

  const user = [
    `OFFICEHOLDER: ${who}`,
    '',
    `THE POST THEY ALREADY PUBLISHED, on ${platform}${publishedAt ? `, ${publishedAt}` : ''}:`,
    title,
    '',
    landed.length ? `HOW IT LANDED:\n${landed.map((x) => `- ${x}`).join('\n')}` : '',
    about.length ? `WHAT IT WAS ABOUT:\n${about.map((x) => `- ${x}`).join('\n')}` : '',
    audienceBlock,
    notes.length ? `THE READING'S OWN NOTES:\n${notes.map((x) => `- ${x}`).join('\n')}` : '',
    '',
    'Write what to post next, and the post.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const started = Date.now()
  const out = await groundedJson<Draft>({
    system: SYSTEM,
    user,
    schema: SCHEMA,
    usable: (c) =>
      typeof c.whatToPostNext === 'string' &&
      c.whatToPostNext.trim().length > 0 &&
      typeof c.idea === 'object' &&
      c.idea !== null &&
      typeof (c.idea as Record<string, unknown>)['text'] === 'string',
  })
  if (!out) {
    return json({
      error: 'The model could not be reached, or answered with something unreadable. Try again.',
      ms: Date.now() - started,
    })
  }

  const idea =
    typeof out.idea === 'object' && out.idea !== null ? (out.idea as Record<string, unknown>) : {}

  /**
   * Neither of these goes through the capping helper, and that is the point.
   * `text()` would slice an over-long answer down to the cap and let it pass,
   * which publishes a sentence cut mid-thought under a member's name. An answer
   * that overshoots the length rule this badly has ignored it, so it is dropped
   * whole and the office is told to draft again.
   */
  const whatToPostNext = typeof out.whatToPostNext === 'string' ? out.whatToPostNext.trim() : ''
  const draft = typeof idea['text'] === 'string' ? idea['text'].trim() : ''
  const angle = text(idea['angle'], 80) ?? ''

  const usable =
    whatToPostNext.length > 0 &&
    whatToPostNext.length <= 1200 &&
    draft.length > 0 &&
    draft.length <= 400 &&
    angle.length > 0
  if (!usable) {
    return json({
      error: 'The model returned nothing that passed the checks. Draft again.',
      ms: Date.now() - started,
    })
  }

  return json({
    whatToPostNext,
    idea: { text: draft, angle, platform: toPlatform(idea['platform'], platform) },
    readAt: new Date().toISOString(),
    ms: Date.now() - started,
  })
}

export const config: Config = {
  path: '/api/post-idea',
  /**
   * One model call, run when somebody opens one post on the highlights screen
   * and asks for a suggestion. A desk works through several posts in a sitting,
   * so the window is a little wider than suggest-posts', and still far too tight
   * for a loop to burn the provider key.
   */
  rateLimit: { windowLimit: 15, windowSize: 120, aggregateBy: ['ip'] },
}
