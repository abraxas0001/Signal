import type { Config, Context } from '@netlify/functions'
import { groundedJson } from './lib/grounded-json'
import { resolveProviders } from './lib/provider'
import { HOUSE_STYLE } from './lib/house-style'

/**
 * The words on a poster the office is about to publish.
 *
 *   POST /api/post-copy { person, occasion, kind, language, brief }
 *     -> { headline, body, caption, hashtags, readAt }
 *     -> { error }   a sentence the office can read
 *
 * The sibling of post-idea next door, grounded the same way, but the job differs
 * in one respect that changes every rule below. post-idea reads a post that
 * already happened. This writes something that has not happened yet, for a
 * poster that will carry the member's face and name, so there is no evidence to
 * lean on and nothing to check the model against afterwards. The whole defence
 * has to sit in what the model is forbidden to write.
 *
 * Three of those prohibitions are not style, they are the product:
 *
 * 1. NO DATE, EVER. Diwali, Raksha Bandhan, Ugadi, Bathukamma, Eid and Easter
 *    all move: each is computed from a lunar or lunisolar calendar and lands on
 *    a different Gregorian day every year. A model asked when Diwali falls
 *    answers confidently and is often wrong, and a wrong festival date published
 *    under a member's name is a correction the office has to issue in public. So
 *    the date arrives from the desk, in the payload, or it does not exist: an
 *    occasion without one is refused here rather than guessed at, and the model
 *    is told never to print a date at all.
 * 2. NO THIRD PARTY. The poster speaks as the member. It may not quote, thank,
 *    credit or claim the endorsement of any other named person, and that
 *    includes the quote card: the line on a quote card is the member's own
 *    sentence, never a leader's saying set in quotation marks under the member's
 *    photograph.
 * 3. NO INVENTED FACT. A greeting needs no facts. A claim needs one, and the
 *    only facts here are the ones the office typed into the brief.
 *
 * Everything it writes is the model's, and the screen says so. The footer
 * convention this product already uses is in Grievances.tsx, under the drafted
 * suggestions: "check every post before it goes out".
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

/** The languages this desk publishes in. */
const LANGUAGES = ['English', 'Telugu', 'Hindi'] as const
type Language = (typeof LANGUAGES)[number]

/** What is being made: a designed image, a plain text post, or a quote card. */
const KINDS = ['image', 'text', 'quote'] as const
type Kind = (typeof KINDS)[number]

/**
 * How long the big line may be before it is thrown away.
 *
 * Measured in what the poster sets rather than in what the office typed: a
 * headline is one line at display size over a photograph, and past roughly
 * seventy characters it either wraps into the face or is set too small to read
 * on a phone held at arm's length.
 */
const HEADLINE_MAX = 70

/** One or two sentences under it. Past this the model has written a paragraph. */
const BODY_MAX = 320

/** The caption pasted beside the image. Longer than the poster, still not an essay. */
const CAPTION_MAX = 900

/** Three is already more than most of these accounts use. */
const MAX_HASHTAGS = 3

/** The office's own words. Long enough for a paragraph of instruction. */
const BRIEF_CAP = 600

/**
 * Count what a reader sees, not what JavaScript stores.
 *
 * "మహబూబ్‌నగర్ ప్రజలందరికీ దీపావళి శుభాకాంక్షలు" is 43 code points and 24
 * grapheme clusters, because Telugu vowel signs and viramas are combining marks
 * that attach to the letter before them instead of taking a place of their own.
 * Counting code points would reject that perfectly ordinary greeting as an
 * over-long headline while passing the English line beside it, and the office
 * would press the button again and again against a rule that was never about
 * their sentence. Intl.Segmenter answers the question actually being asked,
 * which is how wide this sets on the poster.
 *
 * The fallback is there so a runtime built without the segmenter still counts
 * something sane rather than throwing. It is stricter on Indic script than the
 * segmenter is, which errs towards a rejection instead of towards a headline
 * running off the edge of the image.
 */
const SEGMENTER =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

const width = (s: string): number => (SEGMENTER ? [...SEGMENTER.segment(s)].length : [...s].length)

/**
 * The Unicode blocks that decide whether an answer came back in the language it
 * was asked for.
 *
 * Asking politely is not enough. A model told to write Telugu returns
 * "Deepavali shubhakankshalu" often enough that it has to be caught, and
 * transliterated Telugu set on a poster for a Telangana constituency reads as an
 * office that cannot write its own language.
 */
const SCRIPT: Record<Language, RegExp> = {
  English: /[A-Za-z]/g,
  Telugu: /[\u0C00-\u0C7F]/g,
  Hindi: /[\u0900-\u097F]/g,
}

const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length

/**
 * True when this text is mostly in the script that was asked for.
 *
 * Mostly rather than entirely, deliberately. A Telugu headline routinely carries
 * a party abbreviation or a place name in Latin letters, and an English one may
 * carry a single Telugu word. What is caught here is the answer written wholly
 * in the wrong script, in either direction.
 */
function inScript(s: string, language: Language): boolean {
  const wanted = count(s, SCRIPT[language])
  const other = LANGUAGES.filter((l) => l !== language).reduce((n, l) => n + count(s, SCRIPT[l]), 0)
  return wanted > 0 && wanted >= other
}

/**
 * Fold whatever arrived onto a kind this studio can lay out.
 *
 * The kind decides how the words are read on the page rather than what they are
 * allowed to claim, so an unrecognised value folding onto the poster loses
 * nothing true. The language is deliberately NOT folded this way: quietly
 * answering in English because a request said "telegu" would hand the office a
 * poster in the wrong language and make it look like the model's choice.
 */
const toKind = (v: unknown): Kind => {
  const raw = typeof v === 'string' ? v.toLowerCase().trim() : ''
  return (KINDS as readonly string[]).includes(raw) ? (raw as Kind) : 'image'
}

const LANGUAGE_RULE: Record<Language, string> = {
  English:
    'Write the headline, the body and the caption in English. Simple English that reads aloud well.',
  Telugu:
    'Write the headline and the body in TELUGU SCRIPT (తెలుగు). Not Telugu spelled out in English letters. An answer in English letters is thrown away and the office has to ask again. The caption may mix Telugu and English, which is how these accounts are actually written.',
  Hindi:
    'Write the headline and the body in DEVANAGARI SCRIPT (हिन्दी). Not Hindi spelled out in English letters. An answer in English letters is thrown away and the office has to ask again. The caption may mix Hindi and English, which is how these accounts are actually written.',
}

const KIND_RULE: Record<Kind, string> = {
  image:
    'THIS IS A POSTER. The headline is the line printed largest across it, over a photograph of the member, read at a glance on a phone. The body sits under it in small type.',
  text: 'THIS IS A TEXT POST with no image. The headline is the opening line and the body follows it, so the two read as one short statement.',
  quote:
    'THIS IS A QUOTE CARD. The headline is set in quotation marks beside the member photograph, so it has to sound like a sentence this person would say out loud. It is the member speaking. It is never a saying borrowed from a leader, a poet or a scripture, and it is never attributed to anybody else. The body is one short line of context under it.',
}

/**
 * The last line of the request, where the language rule lands hardest.
 *
 * HOUSE_STYLE closes the system prompt with "Plain, direct English", which is
 * about register but reads as an instruction about language, and a model that
 * has just been told to write English writes English. Restating the script at
 * the very end of the user message is what stops that.
 */
const FINAL_LINE: Record<Language, string> = {
  English: 'Write the headline, the body and the caption. Every line in English.',
  Telugu:
    'Write the headline, the body and the caption. The headline and the body in Telugu script.',
  Hindi:
    'Write the headline, the body and the caption. The headline and the body in Devanagari script.',
}

const systemFor = (language: Language): string =>
  `You write the words that go on a poster for the office of an Indian elected representative. The office has picked the occasion, chosen the template and supplied the photograph. You supply the words: the headline set large on the poster, the body under it, and the caption they paste beside the image when they post it.

Write AS the member, in the first person. This is their own greeting, in their own voice, to their own people.

RULES YOU MUST NOT BREAK:
- headline: ${HEADLINE_MAX} CHARACTERS MAXIMUM. It is set at poster size, so five or six words is already long and four is better. A longer line is thrown away whole rather than trimmed, because a line cut at a character count ends mid-word on a poster.
- The headline is the member speaking. Never write their own name into it as though somebody else were describing them. The poster already carries their name and their photograph.
- body: one or two sentences. Forty words at the very most.
- caption: two or three short lines for the post itself.
- NEVER invent a fact. No figures, no rupees, no scheme names, no crowd sizes, no distances, no rankings, no promises. Nothing the brief did not give you. A greeting needs no facts at all. A claim needs one, and if the brief carries none, write the greeting and stop rather than manufacture an achievement.
- NEVER WRITE A DATE. Not the date of the festival, not a year, not a deadline, not "this Sunday". Festival dates move from year to year, and a wrong one published under this member's name is a public correction. The office knows which day they are posting for.
- NEVER name, quote, thank, credit or congratulate another person. No other leader, no official, no chief minister, no "as our respected X has said". The poster carries one voice and it is the member's own. The member's own party may be named.
- Never suggest that anybody else endorsed, praised, blessed or joined the member.
- THAT RULE OUTRANKS THE BRIEF. If the brief asks you to thank, quote or credit somebody by name, write everything else the brief asks for and leave that person out of the words entirely. Do not replace the name with a title or a description of the same person either. The office can put a name on the poster themselves if they decide to. This is not a decision you make for them.
- Do not address the reader as a group the office has not named. Write to the people of the constituency, not to "my dear followers".
- No exclamation marks. No marketing voice. No "let us all come together".
- hashtags: at most ${MAX_HASHTAGS}, and none is fine. One word each, no spaces, no # sign. They belong in the hashtags field. Do not write them into the caption instead.

${LANGUAGE_RULE[language]}

${HOUSE_STYLE}`

const SCHEMA = {
  type: 'object' as const,
  properties: {
    headline: {
      type: 'string',
      description: `The big line on the poster. ${HEADLINE_MAX} characters maximum.`,
    },
    body: { type: 'string', description: 'One or two sentences under the headline.' },
    caption: { type: 'string', description: 'The caption to paste beside the image when posting.' },
    hashtags: {
      type: 'array',
      items: { type: 'string' },
      description: `At most ${MAX_HASHTAGS}, one word each, without the # sign.`,
    },
  },
  required: ['headline', 'body', 'caption', 'hashtags'],
  additionalProperties: false,
}

/**
 * What the model is asked for, before any of it has been checked.
 *
 * A type alias rather than an interface for the same reason post-idea's Draft is
 * one: `groundedJson` is generic over `Record<string, unknown>`, TypeScript
 * grants an implicit index signature to an anonymous object type and never to an
 * interface, and the failure is a compile error about a missing index signature
 * that says nothing about the real cause.
 */
type Draft = {
  headline?: unknown
  body?: unknown
  caption?: unknown
  hashtags?: unknown
}

/**
 * Hashtags off the model, made safe to paste.
 *
 * The # is added here rather than asked for, because a model asked for tags
 * returns "#Diwali", "# Diwali" and "Diwali" in the same answer and the desk
 * pastes whatever it is handed. Telugu and Devanagari letters are kept: a Telugu
 * account tags in Telugu, and stripping the script would quietly turn the tag
 * into an empty string.
 */
const TAG_STRIP = /[^0-9A-Za-z_\u0900-\u097F\u0C00-\u0C7F]/g

function toHashtags(v: unknown): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of Array.isArray(v) ? v : []) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim().replace(/^#+/, '').replace(TAG_STRIP, '')
    if (!tag || tag.length > 40) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(`#${tag}`)
    if (out.length === MAX_HASHTAGS) break
  }
  return out
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

  const name = text(person['name'], 120)
  if (!name) return json({ error: 'Name the person this copy speaks for.' }, 400)

  const language = LANGUAGES.find((l) => l === body['language'])
  if (!language) {
    return json({ error: 'Choose the language for this copy: English, Telugu or Hindi.' }, 400)
  }

  const kind = toKind(body['kind'])
  const brief = text(body['brief'], BRIEF_CAP)

  const rawOccasion =
    typeof body['occasion'] === 'object' && body['occasion'] !== null
      ? (body['occasion'] as Record<string, unknown>)
      : null
  const occasionName = rawOccasion ? text(rawOccasion['name'], 120) : null
  const occasionDate = rawOccasion ? text(rawOccasion['date'], 40) : null

  /**
   * An occasion with no date is refused, never filled in.
   *
   * This is the line the whole endpoint exists to hold. Diwali, Ugadi, Eid and
   * Raksha Bandhan land on a different Gregorian date every year, and neither
   * this function nor the model has a calendar it can point at. Guessing would
   * put a wrong date under a member's name in public, so the desk is asked for
   * the day it is posting for and nothing is drafted until it has been given.
   */
  if (occasionName && !occasionDate) {
    return json({
      error: `No date was given for ${occasionName}, and a festival date is not something this desk will guess. Enter the date the office is posting for, then draft.`,
    })
  }

  /**
   * Nothing to say is a refusal, not an empty poster.
   *
   * With no occasion and no brief there is no subject at all, so anything the
   * model wrote would be a subject it picked for a serving member. That is the
   * same line suggest-posts holds when an issue arrives with none of the records
   * behind it.
   */
  if (!occasionName && !brief) {
    return json({
      error:
        'There is no occasion and no brief here, so there is nothing to write about. Pick an occasion or type a line about what to say.',
    })
  }

  const providers = resolveProviders()
  if (!providers.length) {
    return json({
      error: 'No language model is configured, so no copy could be drafted. Set a provider key.',
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
   * The date is handed over so the model knows which day it writes for, and
   * fenced in the same breath. Printed on a poster it is a claim about the
   * calendar. Used as context it is only the office saying whether this is a
   * festival greeting or an anniversary.
   */
  const occasionBlock = occasionName
    ? [
        `THE OCCASION: ${occasionName}. The office has entered its date as ${occasionDate}.`,
        'That date is here only so you know which day this is written for. Do not print it, do not convert it to another calendar, and do not write any other date anywhere in the copy.',
      ].join('\n')
    : 'NO OCCASION WAS PICKED. This is an ordinary post, and the brief below is the whole of its subject.'

  const briefBlock = brief
    ? [
        'WHAT THE OFFICE WANTS TO SAY, in their own words:',
        brief,
        'Every specific thing in the copy comes from those words. You have no other facts.',
      ].join('\n')
    : 'THE OFFICE TYPED NO BRIEF. You have the occasion and nothing else. Write the greeting on the strength of the occasion alone. Do not invent a reason, an achievement, a visit or an event to fill the space.'

  const user = [
    `THE MEMBER, who is speaking: ${who}`,
    occasionBlock,
    briefBlock,
    KIND_RULE[kind],
    FINAL_LINE[language],
  ].join('\n\n')

  const started = Date.now()
  const out = await groundedJson<Draft>({
    system: systemFor(language),
    user,
    schema: SCHEMA,
    usable: (c) =>
      typeof c.headline === 'string' &&
      c.headline.trim().length > 0 &&
      typeof c.body === 'string' &&
      c.body.trim().length > 0,
  })
  if (!out) {
    return json({
      error: 'The model could not be reached, or answered with something unreadable. Try again.',
      ms: Date.now() - started,
    })
  }

  /**
   * None of these goes through the capping helper, and that is the point.
   * `text()` would slice an over-long answer down to the cap and let it pass,
   * which sets a headline that ends mid-word across a member's photograph. An
   * answer that overshoots has ignored the rule, so it is dropped whole and the
   * office is told to draft again, exactly as suggest-posts drops an over-long
   * post.
   */
  const headline = typeof out.headline === 'string' ? out.headline.trim() : ''
  const draftBody = typeof out.body === 'string' ? out.body.trim() : ''

  if (!headline || !draftBody) {
    return json({
      error: 'The model returned nothing that passed the checks. Draft again.',
      ms: Date.now() - started,
    })
  }

  if (width(headline) > HEADLINE_MAX) {
    return json({
      error: 'The model wrote a headline too long to set on a poster. Draft again.',
      ms: Date.now() - started,
    })
  }

  if (width(draftBody) > BODY_MAX) {
    return json({
      error: 'The model returned nothing that passed the checks. Draft again.',
      ms: Date.now() - started,
    })
  }

  /**
   * The script check covers the headline and the body only. The caption is
   * allowed to mix, because that is how these accounts write theirs.
   */
  if (!inScript(headline, language) || !inScript(draftBody, language)) {
    return json({
      error: `The model did not answer in ${language}. Draft again.`,
      ms: Date.now() - started,
    })
  }

  /**
   * A bad caption costs the caption, not the poster.
   *
   * Every check above throws the whole answer away, because the headline and
   * the body are set into a layout at a fixed size and nobody can edit them
   * before the image is downloaded. The caption is not that. It is pasted into a
   * post box the office types in anyway, so making them redraft the poster
   * because the caption ran long would cost them the good part of the answer.
   *
   * It is returned empty rather than cut for the same reason the headline is
   * rejected rather than trimmed: a caption cut at a character count ends
   * mid-word. Empty here means no caption was drafted, which is exactly what
   * the office is looking at.
   *
   * This also absorbs the one shape the strict schema cannot enforce. Gemini's
   * native fallback in grounded-json.ts is asked for JSON without a schema, and
   * it answers with the headline and body and no caption field often enough
   * that it was hit on the second live request against this endpoint.
   */
  const rawCaption = typeof out.caption === 'string' ? out.caption.trim() : ''
  const caption = width(rawCaption) <= CAPTION_MAX ? rawCaption : ''

  return json({
    headline,
    body: draftBody,
    caption,
    hashtags: toHashtags(out.hashtags),
    readAt: new Date().toISOString(),
    ms: Date.now() - started,
  })
}

export const config: Config = {
  path: '/api/post-copy',
  /**
   * One model call, run when somebody presses the write button in the studio. A
   * desk making a poster tries the same occasion in two languages and rewrites
   * the brief once or twice, so the window is a little wider than post-idea's
   * and still far too tight for a loop to burn the provider key.
   */
  rateLimit: { windowLimit: 20, windowSize: 120, aggregateBy: ['ip'] },
}
