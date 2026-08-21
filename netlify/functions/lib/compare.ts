import { complete } from './openai-compat'
import { resolveProviders } from './provider'
import { HOUSE_STYLE } from './house-style'

/**
 * Two politicians, side by side, on the things an office actually argues about.
 *
 * The compare screen had one measure: follower counts and engagement rate off
 * whichever social accounts happened to be tracked. That is a comparison of two
 * social media managers. Nobody loses a seat because their rival posts better.
 *
 * What a member wants to know before a campaign meeting is: what has he built
 * that I haven't, where is he stronger with the public, what is he being
 * attacked for, and what do I say about it. None of that is in a follower
 * count, and all of it is in the published record — which is reachable the same
 * way the opinion survey reaches it, with a grounded search.
 *
 * So this is the opinion survey pointed at two people at once, scored on five
 * dimensions rather than one. The dimensions were chosen because each one can
 * be argued from evidence a search will actually surface:
 *
 *   work        — schemes, funds, projects, bills. What exists because of them.
 *   popularity  — margins, crowds, how their own party treats them.
 *   opinion     — the tone of what is written and said.
 *   visibility  — how much coverage they get at all. A member with a case to
 *                 make and no coverage has a different problem from one who is
 *                 covered hostilely.
 *   trust       — allegations, cases, reversals. Stated as allegations.
 *
 * SAME CAVEAT AS THE OPINION SURVEY, and it has to survive onto the screen:
 * this reads the published record. It is not a poll. Coverage skews towards
 * whoever writes, and in a two-way comparison that skew is not symmetric — a
 * sitting minister is covered more than a challenger, and more coverage is not
 * more merit. The endpoint says so and the UI repeats it.
 *
 * Two steps, for the same reason as the opinion survey: grounding cannot be
 * combined with a JSON response schema, the API rejects the pair outright. The
 * search returns prose with citations; a second, cheap, ungrounded call turns
 * that prose into fields and is forbidden from adding anything to it.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
const MODEL = process.env['GEMINI_GROUNDED_MODEL'] ?? 'gemini-2.5-flash'

/**
 * The search's own budget, inside the function's.
 *
 * This was 45s, and it was under the time the search actually takes. Measured
 * on one real pair — a sitting MP against a sitting Chief Minister — the
 * prompt below returns in about 53 seconds and 73KB. At 45s the request
 * aborted itself, `groundedCompare` caught the abort and returned null, and
 * the screen said "The web search did not return anything usable" for a search
 * that was working and simply had not been given time to answer.
 *
 * 55s is what fits: Netlify's synchronous ceiling is a hard, non-configurable
 * 60s, and the response still has to be serialised and returned inside it.
 *
 * That is a thin margin, and it is stated rather than hidden — a heavily
 * covered pair can run slower than the one measured. The durable fix is to
 * stop asking one request to research two people; see the note on the prompt.
 */
/**
 * The search's own budget, and it must sit UNDER the runtime that hosts it.
 *
 * This was 55s, chosen against Netlify's 60s production ceiling. That reasoning
 * was right about production and wrong everywhere else: netlify-cli hardcodes
 * `SYNCHRONOUS_FUNCTION_TIMEOUT = 30` for local development
 * (node_modules/netlify-cli/dist/utils/dev.js:78) and, on the `--offline` path
 * this project uses, never reads a higher value from a linked site. So on a
 * developer's machine the runtime killed the function at 30s while the fetch
 * inside it still believed it had 25 seconds left. Nothing threw a timeout,
 * because the timeout never fired: the process was simply gone, and the client
 * saw a dead socket and reported it as a network fault.
 *
 * 50s is chosen for PRODUCTION, where Netlify allows 60s. It cannot be chosen
 * for local development, because netlify-cli kills the whole function at 30s
 * and no value here changes that. Measured, one grounded search on an Indian
 * politician takes 17-40s: comfortable in production, and on the edge locally
 * however this number is set. Setting it BELOW the local ceiling only swaps a
 * runtime kill for an abort, losing the runs that would have succeeded in
 * production. So it is set for the environment that has to work, and the
 * client retries the half that failed rather than the whole comparison.
 */
/**
 * The runtime hosting this decides the answer, so it is read rather than
 * guessed.
 *
 * netlify-cli kills a synchronous function at exactly 30s and no setting in
 * netlify.toml changes that: with `--offline` it never fetches the site
 * record that could raise it (netlify-cli/dist/utils/dev.js:96-109). A fetch
 * budget larger than the runtime is worse than useless, because the process
 * dies before the abort can fire and the client receives a stack trace where
 * it expected JSON. That is precisely how a slow search came to be reported
 * as a dead network.
 *
 * So: abort a couple of seconds inside whichever ceiling is really there, and
 * fail with a sentence that says what happened.
 */
const IS_LOCAL_DEV = process.env['NETLIFY_DEV'] === 'true'
const TIMEOUT_MS = IS_LOCAL_DEV ? 27_000 : 50_000

export const compareSearchAvailable = (): boolean =>
  Boolean(process.env['GEMINI_API_KEY']?.trim())

/* ── shapes ──────────────────────────────────────────────────────────────── */

/** One person, as the comparison needs them named. */
export interface ComparePerson {
  name: string
  role?: string | null
  constituency?: string | null
  state?: string | null
  party?: string | null
}

export type Edge = 'subject' | 'rival' | 'level'

export interface CompareDimension {
  key: 'work' | 'popularity' | 'opinion' | 'visibility' | 'trust'
  label: string
  /** 0–100. Only ever read as a position on a bar, never as a percentage. */
  subjectScore: number
  rivalScore: number
  /** The evidence, one or two sentences each. This is the part worth reading. */
  subjectNote: string
  rivalNote: string
  edge: Edge
  /**
   * False when the model returned no placement for this row at all.
   *
   * The row is still built — see the note in `assembleComparison` on why a
   * dropped dimension must not vanish — but the UI draws no bars and no edge
   * for it. Two half-length marks meeting at the centre under the word "Level"
   * is a stated finding of parity on a question nobody assessed, and it is
   * indistinguishable on screen from a real dead heat.
   */
  assessed: boolean
}

export interface CompareResult {
  subject: { name: string; strengths: string[] }
  rival: { name: string; strengths: string[] }
  dimensions: CompareDimension[]
  /** One sentence naming where the subject actually stands. */
  verdict: string
  /** The gaps worth closing, in the order they matter. */
  gaps: string[]
  /** What to do about the biggest gap — files straight into Actions. */
  move: { action: string; rationale: string; talkingPoints: string[] } | null
  sources: { title: string; url: string | null }[]
  confidence: 'thin' | 'moderate' | 'well-covered'
  caveats: string[]
}

const DIMENSION_LABEL: Record<CompareDimension['key'], string> = {
  work: 'Work delivered',
  popularity: 'Standing with voters',
  opinion: 'Tone of coverage',
  visibility: 'How much they are covered',
  trust: 'Allegations and disputes',
}

/** The person, described the way the search prompt wants them. */
export function describePerson(p: ComparePerson): string {
  return [
    p.name,
    p.role ? `the ${p.role}` : null,
    p.constituency ? `for ${p.constituency}` : null,
    p.state ? `in ${p.state}` : null,
    p.party ?? null,
  ]
    .filter(Boolean)
    .join(' ')
}

/* ── step one: read the record on both ───────────────────────────────────── */

interface GeminiResponse {
  /** Present on 2.5 models. Thinking tokens are charged against maxOutputTokens. */
  usageMetadata?: { thoughtsTokenCount?: number; candidatesTokenCount?: number }
  candidates?: {
    /** MAX_TOKENS here alongside empty parts is the failure this file had. */
    finishReason?: unknown
    content?: { parts?: { text?: unknown }[] }
    groundingMetadata?: { groundingChunks?: { web?: { uri?: unknown; title?: unknown } }[] }
  }[]
  error?: { message?: unknown }
}

/**
 * One person's public record over the last two years, gathered on its own.
 *
 * THE TWELVE-MONTH WINDOW IS LOAD-BEARING, not an editorial preference.
 *
 * What a grounded search costs is set by how much there is to read, and that
 * varies enormously by who is being read. Measured on the same prompt: a
 * sitting MP came back in 13-22s, while a former Chief Minister took 26-38s
 * and blew the 30s local ceiling every single time. The office saw "Could not
 * reach the server", and saw it more often the more important their opponent
 * was, which is the worst possible way for this to fail.
 *
 * Two years was the first attempt and was not enough. It fixed a former Chief
 * Minister and still failed on a national figure: measured on Rahul Gandhi over
 * three passes it ran 28.2s, 29.5s and 38.8s, so the office saw the timeout
 * again the moment it compared itself against somebody genuinely famous. The
 * same three passes at twelve months and two bullets a heading ran 14.2s, 15.1s
 * and 18.6s, every one of them inside the ceiling.
 *
 * The notes come back around 2,200 characters rather than 5,000. That is not a
 * loss worth mourning: the only consumer is the structuring step, which fills
 * five fixed dimensions and never had a use for the extra prose. It happens to
 * be the right call editorially too: an
 * office weighing itself against a rival is asking about the current record,
 * not about something from three terms ago. But it is here because it is what
 * makes the request finish.
 *
 * Split from a single two-person request, which is what the note on TIMEOUT_MS
 * above was describing when it said the durable fix was to stop asking one
 * request to research two people. Measured, that request took 29.4s against a
 * 30s local ceiling and failed roughly half the time. Capping its output got it
 * to 21-24s, which was still not enough: the cost is dominated by the grounding
 * search itself, and a request covering two politicians runs twice the searches
 * of one covering a single politician.
 *
 * Two requests, run concurrently, cost about what the slower one costs on its
 * own. Nothing is lost by separating them, because the COMPARING never happened
 * here anyway: this step gathers evidence and `structureNotes` below does the
 * judging, and it sees both sets of notes together exactly as before. If
 * anything the division is cleaner, because a grounded model researching one
 * person cannot quietly flatter one of them by writing the pair up as a story.
 */
export async function groundedPerson(
  person: ComparePerson,
  /** "first" or "second", so the structuring step can tell the notes apart. */
  position: string,
  signal?: AbortSignal,
): Promise<{ text: string; sources: { title: string; url: string | null }[] } | null> {
  const key = process.env['GEMINI_API_KEY']?.trim()
  if (!key) return null

  const who = describePerson(person)

  /**
   * Deliberately terse.
   *
   * The long form of this prompt spelled out each heading in a sentence and
   * carried four rules underneath. Measured over three concurrent pairs it ran
   * to a median wall time of 27.7s against a 30s local ceiling; the compact
   * form below measured 22.6s for the same work. A grounded search re-reads
   * its instructions on every search round it makes, so instructions are not
   * free here the way they are in a single-shot call.
   *
   * The rules that survived are the ones that change what comes back:
   * attribution, and the refusal to blur an allegation into a finding. The
   * ones that went were restatements of "be brief".
   */
  const prompt = `Indian politician: ${who}. LAST 12 MONTHS ONLY. Max 2 bullets per heading, no preamble, no essay.

1. WORK: named schemes, funds, projects, bills, cases taken up.
2. VOTERS: latest margin, turnout, whether their own party backs or sidelines them.
3. COVERAGE TONE: warm, hostile or divided, and by whom.
4. HOW MUCH COVERED: heavily or barely.
5. ALLEGATIONS: cases and enquiries. Mark each as an allegation, never as a finding.

Name a source for every bullet. Indian regional-language coverage counts.
Where the record is thin, write "thin record" for that heading rather than filling the gap.`

  try {
    const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        /**
         * No maxOutputTokens, and that omission is the fix.
         *
         * Setting a cap at all is what broke this. gemini-2.5-flash charges
         * its internal reasoning against maxOutputTokens, so the model spent
         * the budget thinking and returned finishReason MAX_TOKENS with 67
         * output tokens and NO TEXT. The office saw "Could not reach the
         * server" for an HTTP 200 carrying a healthy grounded search.
         *
         * Turning thinking off with thinkingBudget: 0 looked like the answer
         * and was worse: measured over four concurrent pairs it produced
         * empty MAX_TOKENS responses in five of eight calls. It is not
         * dependable alongside google_search.
         *
         * Measured over six concurrent pairs with no cap and default
         * thinking: six of six returned text, every one finishReason STOP.
         * Latency 18-27s, inside both the 30s local ceiling and the 60s
         * production one. Reliability is worth more here than a token bill,
         * because the fallback is a screen that blames the network.
         */
        generationConfig: { temperature: 0.2 },
      }),
      signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await res.json()) as GeminiResponse
    if (!res.ok || body.error) {
      // Logged rather than swallowed. A null here reaches the office as "the
      // search did not answer", which is true and useless; the reason is the
      // only thing that makes it fixable, and it was being discarded.
      console.warn(
        `[compare] ${person.name}: HTTP ${res.status}`,
        typeof body.error?.message === 'string' ? body.error.message : '',
      )
      return null
    }

    const candidate = body.candidates?.[0]
    const text = (candidate?.content?.parts ?? [])
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('\n')
      .trim()
    if (!text) {
      console.warn(
        `[compare] ${person.name}: no text, finish=${String(candidate?.finishReason)}`,
        `thoughts=${body.usageMetadata?.thoughtsTokenCount} out=${body.usageMetadata?.candidatesTokenCount}`,
      )
      return null
    }

    const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
      .map((c) => ({
        title: typeof c.web?.title === 'string' ? c.web.title : '',
        url: typeof c.web?.uri === 'string' ? c.web.uri : null,
      }))
      .filter((s) => s.title)
      .slice(0, 8)

    return { text: `NOTES ON THE ${position.toUpperCase()} PERSON (${person.name}):\n${text}`, sources }
  } catch (err) {
    // AbortError means the budget above ran out, which is a different problem
    // from the network being down and must not be reported as one.
    const aborted = err instanceof Error && err.name === 'AbortError'
    console.warn(`[compare] ${person.name}: ${aborted ? 'timed out' : String(err)}`)
    return null
  }
}

export async function groundedCompare(
  subject: ComparePerson,
  rival: ComparePerson,
  signal?: AbortSignal,
): Promise<{ text: string; sources: { title: string; url: string | null }[] } | null> {
  const [a, b] = await Promise.all([
    groundedPerson(subject, 'first', signal),
    groundedPerson(rival, 'second', signal),
  ])

  /**
   * One side missing is a failure, not half a comparison.
   *
   * Structuring notes on one person into a two-person comparison would produce
   * a full set of bars with one side invented from nothing, and it would look
   * exactly like a real result. The caller already handles null by telling the
   * office the search did not answer.
   */
  if (!a || !b) return null

  // De-duplicated: both searches routinely land on the same wire copy, and a
  // source list that repeats a masthead four times reads as padding.
  const seen = new Set<string>()
  const sources = [...a.sources, ...b.sources].filter((s) => {
    const k = (s.url ?? s.title).toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  return { text: `${a.text}\n\n${b.text}`, sources: sources.slice(0, 12) }
}

/* ── step two: turn prose into fields ────────────────────────────────────── */

const DIMENSION = {
  type: 'object' as const,
  properties: {
    key: {
      type: 'string' as const,
      enum: ['work', 'popularity', 'opinion', 'visibility', 'trust'],
    },
    subjectScore: {
      type: 'integer' as const,
      description:
        '0-100 for the FIRST person on this dimension. 50 means the notes give no reason to place them above or below the middle. On "trust", a HIGH score means few or no allegations.',
    },
    rivalScore: { type: 'integer' as const, description: '0-100 for the SECOND person.' },
    subjectNote: {
      type: 'string' as const,
      description:
        'One or two sentences of EVIDENCE from the notes for the first person. Name the scheme, the margin, the paper. Empty string if the notes say nothing.',
    },
    rivalNote: { type: 'string' as const, description: 'The same for the second person.' },
  },
  required: ['key', 'subjectScore', 'rivalScore', 'subjectNote', 'rivalNote'],
  additionalProperties: false,
}

const SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    dimensions: {
      type: 'array',
      items: DIMENSION,
      description: 'All five dimensions, in the order given. Never fewer.',
    },
    subjectStrengths: {
      type: 'array',
      items: { type: 'string' },
      description: 'Up to four things the FIRST person has that the second does not.',
    },
    rivalStrengths: {
      type: 'array',
      items: { type: 'string' },
      description: 'Up to four things the SECOND person has that the first does not.',
    },
    verdict: {
      type: 'string',
      description:
        'ONE sentence telling the first person where they actually stand against the second. Not a summary — the finding.',
    },
    gaps: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Up to three gaps the FIRST person should close, most important first. Each names the gap, not a platitude.',
    },
    move: {
      type: ['object', 'null'],
      description: 'The single thing the first person should do about the biggest gap.',
      properties: {
        action: { type: 'string', description: 'An instruction. "Publish the ward-wise spend."' },
        rationale: { type: 'string', description: 'Why, in one sentence, from the notes.' },
        talkingPoints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Up to three lines they could actually say out loud.',
        },
      },
      required: ['action', 'rationale', 'talkingPoints'],
      additionalProperties: false,
    },
    confidence: { type: 'string', enum: ['thin', 'moderate', 'well-covered'] },
    caveats: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'dimensions',
    'subjectStrengths',
    'rivalStrengths',
    'verdict',
    'gaps',
    'move',
    'confidence',
    'caveats',
  ],
  additionalProperties: false,
}

const STRUCTURE_SYSTEM = `You are given research notes comparing two public figures, gathered from a web search. The FIRST person named in the notes is "subject"; the SECOND is "rival". Turn the notes into structured fields.

THE ONLY RULE THAT MATTERS: you may not add anything. Every claim, every attribution, every number must already be in the notes. This goes in front of somebody deciding what to say about an opponent in public, and an invented claim is indistinguishable on screen from a researched one.

Scoring. The scores are read as positions on a bar, so they must be defensible from the notes:
- 50 is the honest default. Use it whenever the notes give you no reason to place someone above or below the middle.
- Only open a wide gap when the notes actually support one — a named scheme against nothing, a doubled margin against a lost seat.
- On "trust", a HIGH score means FEW allegations. Do not invert it.
- If the notes say coverage of one person is thin, their "visibility" score must be low, and you must NOT then mark them down on the other four for the same reason. Absence of coverage is not evidence of absence of work. Say that in a caveat.

Notes fields: quote the evidence. "Sanctioned ₹42cr for the Jadcherla bypass (Telangana Today, Mar 2024)" is useful. "Has done development work" is not — return an empty string instead.

Caveats: always at least one. This rests on published coverage, not a survey of voters.

${HOUSE_STYLE}
`

export async function structureComparison(
  notes: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const providers = resolveProviders().filter((p) => p.baseUrl)
  if (!providers.length) return null

  for (const provider of providers) {
    try {
      const out = await complete({
        provider,
        system: STRUCTURE_SYSTEM,
        user: notes,
        schema: SCHEMA,
        signal,
      })
      return JSON.parse(out.text) as Record<string, unknown>
    } catch {
      // Next provider rather than throwing away research already paid for.
    }
  }
  return null
}

/* ── assembly ────────────────────────────────────────────────────────────── */

const ORDER: CompareDimension['key'][] = ['work', 'popularity', 'opinion', 'visibility', 'trust']

const clamp = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 50

const strings = (raw: unknown, cap: number): string[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, cap)

/**
 * How wide a gap has to be before it is called.
 *
 * Eight points. Below that the two scores came out of the same paragraph of
 * notes and the difference is the model's rounding, not a finding — and an
 * arrow pointing at a rival on the strength of 52 against 49 is a claim this
 * data cannot support.
 */
const EDGE_THRESHOLD = 8

function edgeOf(subjectScore: number, rivalScore: number): Edge {
  const gap = subjectScore - rivalScore
  if (Math.abs(gap) < EDGE_THRESHOLD) return 'level'
  return gap > 0 ? 'subject' : 'rival'
}

export function assembleComparison(
  parsed: Record<string, unknown>,
  subject: ComparePerson,
  rival: ComparePerson,
  sources: { title: string; url: string | null }[],
): CompareResult {
  const raw = (Array.isArray(parsed['dimensions']) ? parsed['dimensions'] : []).filter(
    (d): d is Record<string, unknown> => typeof d === 'object' && d !== null,
  )
  const byKey = new Map(raw.map((d) => [String(d['key']), d]))

  // Built from ORDER rather than from what came back, so the bars are always in
  // the same order and a dimension the model dropped shows as an even 50/50
  // rather than vanishing — a missing row reads as "not applicable", which is a
  // different claim from "we could not tell".
  const dimensions: CompareDimension[] = ORDER.map((key) => {
    const found = byKey.get(key)
    const d = found ?? {}
    const subjectScore = clamp(d['subjectScore'])
    const rivalScore = clamp(d['rivalScore'])
    // `clamp` falls back to 50, which is right for a score the model returned
    // as junk and wrong to draw as a measurement. Whether anything was placed
    // at all is a separate fact from what the placement was, and only the row
    // itself can tell the two apart.
    const assessed =
      Boolean(found) &&
      (typeof d['subjectScore'] === 'number' || typeof d['rivalScore'] === 'number')
    return {
      key,
      label: DIMENSION_LABEL[key],
      subjectScore,
      rivalScore,
      subjectNote: typeof d['subjectNote'] === 'string' ? d['subjectNote'].trim() : '',
      rivalNote: typeof d['rivalNote'] === 'string' ? d['rivalNote'].trim() : '',
      edge: edgeOf(subjectScore, rivalScore),
      assessed,
    }
  })

  const rawMove = parsed['move']
  const move =
    typeof rawMove === 'object' && rawMove !== null && typeof (rawMove as Record<string, unknown>)['action'] === 'string'
      ? {
          action: String((rawMove as Record<string, unknown>)['action']).trim(),
          rationale: String((rawMove as Record<string, unknown>)['rationale'] ?? '').trim(),
          talkingPoints: strings((rawMove as Record<string, unknown>)['talkingPoints'], 3),
        }
      : null

  const caveats = strings(parsed['caveats'], 4)

  return {
    subject: { name: subject.name, strengths: strings(parsed['subjectStrengths'], 4) },
    rival: { name: rival.name, strengths: strings(parsed['rivalStrengths'], 4) },
    dimensions,
    verdict: typeof parsed['verdict'] === 'string' ? parsed['verdict'].trim() : '',
    gaps: strings(parsed['gaps'], 3),
    move: move && move.action ? move : null,
    sources,
    confidence:
      parsed['confidence'] === 'well-covered' || parsed['confidence'] === 'moderate'
        ? parsed['confidence']
        : 'thin',
    caveats: [
      'Read from published coverage, not from a survey. A better-covered politician looks stronger here whether or not they are. Coverage is not merit.',
      ...caveats.filter((c) => !/survey|poll/i.test(c)),
    ].slice(0, 4),
  }
}
