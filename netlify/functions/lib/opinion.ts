import { complete } from './openai-compat'
import { resolveProviders } from './provider'
import { HOUSE_STYLE } from './house-style'

/**
 * What the public thinks, when nobody's comments are readable.
 *
 * The dashboard's central question is "what do people say about me", and for
 * most Indian offices every direct route to an answer is shut. Facebook and
 * Instagram publish no comments to a server without a page token, and the
 * office frequently does not administer the page. YouTube works, but a member
 * with no channel of her own has no comment section to read.
 *
 * So the honest fallback is the one a researcher would use: go and read what
 * has been written, and summarise it. Grounded search does exactly that — a
 * real query against a real index, returning the pages it used — and it can
 * reach editorials, opposition statements, local reporting and forum threads
 * that no API here will ever see.
 *
 * WHAT THIS IS AND IS NOT, because the difference has to survive onto the
 * screen. This is a READING OF THE PUBLISHED RECORD. It is not a poll, it is
 * not a sample of constituents, and it must never be rendered as one. Its
 * sources skew towards whoever writes: journalists, party workers, the
 * politically engaged. A member who mistakes it for their electorate will make
 * bad decisions with it, so every figure it produces carries that caveat and
 * the UI repeats it.
 *
 * Two calls, and the split is deliberate. Grounding refuses to run alongside a
 * JSON response schema — the API rejects the pair outright — so the search runs
 * first and returns prose with citations, then a second, cheap, ungrounded call
 * turns that prose into fields. The second call is explicitly forbidden from
 * adding anything the first did not say.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
const MODEL = process.env['GEMINI_GROUNDED_MODEL'] ?? 'gemini-2.5-flash'
const TIMEOUT_MS = 45_000

export interface OpinionTheme {
  /** The claim, in a few words: "handling of the Kodangal case". */
  label: string
  /** Two or three sentences on what is actually being said. */
  detail: string
  /** How often this came up across what was read. */
  weight: 'dominant' | 'frequent' | 'occasional'
  /** Who is saying it: "opposition leaders", "local reporting", "party workers". */
  who: string | null
}

export interface OpinionSurvey {
  /** −100 … 100. Null when the record is too thin to average. */
  score: number | null
  /**
   * The two magnitudes the score is the difference of, 0–100 each.
   *
   * Carried through rather than discarded because the score alone cannot tell
   * two opposite situations apart: loudly praised AND loudly attacked comes to
   * zero, and so does nobody saying anything at all. A member told "0" learns
   * nothing; told "praise 75, criticism 75" they learn they are in a fight,
   * and told "praise 0, criticism 0" they learn they are invisible.
   */
  favourable: number | null
  hostile: number | null
  /** One sentence a member could read and act on. */
  verdict: string
  praise: OpinionTheme[]
  criticism: OpinionTheme[]
  /** Live disputes worth knowing about today. */
  controversies: OpinionTheme[]
  /** Publishers and pages this rests on. */
  sources: { title: string; url: string | null }[]
  /** How much to trust it, stated rather than implied. */
  confidence: 'thin' | 'moderate' | 'well-covered'
  /** Anything the reader must be told. Never empty in practice. */
  caveats: string[]
  searched: boolean
}

export const opinionSearchAvailable = (): boolean =>
  Boolean(process.env['GEMINI_API_KEY']?.trim())

/* ── step one: read the record ───────────────────────────────────────────── */

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: unknown }[] }
    groundingMetadata?: { groundingChunks?: { web?: { uri?: unknown; title?: unknown } }[] }
  }[]
  error?: { message?: unknown }
}

export async function groundedRead(
  who: string,
  signal?: AbortSignal,
): Promise<{ text: string; sources: { title: string; url: string | null }[] } | null> {
  const key = process.env['GEMINI_API_KEY']?.trim()
  if (!key) return null

  const prompt = `Research what is being said publicly about ${who}, and report it as it stands.

Cover:
- What supporters and favourable coverage credit them with. Be specific: name the scheme, the case, the decision.
- What critics and opposition figures attack them over. Again, specific.
- Any live controversy or dispute in the last few months.
- Whether the overall tone of coverage is warm, hostile or divided.
- Roughly how much has been written: is this a heavily covered figure or a lightly covered one?

Rules:
- Report what OTHERS say. Do not give me your own assessment of whether they are a good politician.
- Attribute: say who is making each claim — opposition leaders, a named paper, party colleagues, local reporting.
- Distinguish an allegation from a finding. "X was accused of" is not "X did".
- If coverage is thin, say so plainly. A short honest answer is more useful than a padded one.
- Indian regional-language coverage counts. Search it.`

  try {
    const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
      signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await res.json()) as GeminiResponse
    if (!res.ok || body.error) return null

    const candidate = body.candidates?.[0]
    const text = (candidate?.content?.parts ?? [])
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('\n')
      .trim()
    if (!text) return null

    const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
      .map((c) => ({
        title: typeof c.web?.title === 'string' ? c.web.title : '',
        url: typeof c.web?.uri === 'string' ? c.web.uri : null,
      }))
      .filter((s) => s.title)
      .slice(0, 10)

    return { text, sources }
  } catch {
    return null
  }
}

/* ── step two: turn prose into fields ────────────────────────────────────── */

const THEME = {
  type: 'object' as const,
  properties: {
    label: { type: 'string' as const, description: 'The claim in a few words.' },
    detail: { type: 'string' as const, description: 'Two or three sentences on what is said.' },
    weight: {
      type: 'string' as const,
      enum: ['dominant', 'frequent', 'occasional'],
      description: 'How much of the coverage this accounts for.',
    },
    who: {
      type: 'string' as const,
      description: 'Who is saying it. Empty string when the text does not say.',
    },
  },
  required: ['label', 'detail', 'weight', 'who'],
  additionalProperties: false,
}

const SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    /**
     * Two independent magnitudes rather than one signed score.
     *
     * Asked for separately, and combined in code, because a single -100..+100
     * field has a midpoint that doubles as "I did not decide" — and on mixed
     * coverage the model took it every time. Measured on the real notes behind
     * this screen: the anchored signed scale returned 0, then -1, while its own
     * verdict field said "Negative". Two unipolar judgements have no such
     * refuge; "how loud is the praise" and "how loud is the attack" are
     * questions with no safe middle, and the lean falls out of the subtraction.
     */
    favourable: {
      type: 'integer',
      description:
        'How LOUD the favourable coverage is, 0-100, judged on prominence not count. ' +
        '0 nobody is defending them. 20 mild or generic praise ("experienced", "hardworking") — what is said about everybody. ' +
        '50 substantial, specific praise from named supporters. 80+ the favourable line dominates the coverage. ' +
        'Judge this on its own, WITHOUT reference to the criticism.',
    },
    hostile: {
      type: 'integer',
      description:
        'How LOUD the hostile coverage is, 0-100, judged on prominence not count. ' +
        '0 nobody is attacking them. 20 passing or unattributed grumbling. ' +
        '50 specific, attributed criticism repeated across outlets. 80+ the attack dominates the coverage. ' +
        'A named, checkable allegation from a named opponent scores far higher than vague disapproval. ' +
        'Judge this on its own, WITHOUT reference to the praise.',
    },
    verdict: {
      type: 'string',
      description:
        'ONE sentence a member could act on. Not a summary of the summary — the finding.',
    },
    praise: { type: 'array', items: THEME },
    criticism: { type: 'array', items: THEME },
    controversies: { type: 'array', items: THEME },
    confidence: {
      type: 'string',
      enum: ['thin', 'moderate', 'well-covered'],
      description: 'How much material the reading rests on.',
    },
    caveats: {
      type: 'array',
      items: { type: 'string' },
      description: 'Anything a reader must know before trusting this.',
    },
  },
  required: [
    'favourable',
    'hostile',
    'verdict',
    'praise',
    'criticism',
    'controversies',
    'confidence',
    'caveats',
  ],
  additionalProperties: false,
}

const STRUCTURE_SYSTEM = `You are given research notes about one public figure, gathered from a web search. Turn them into structured fields.

THE ONLY RULE THAT MATTERS: you may not add anything. Every theme, every attribution, every judgement must already be present in the notes. If the notes do not say who is making a criticism, the "who" field is an empty string — do not infer it from the criticism itself. If the notes describe two criticisms, return two, not five.

You are a formatter here, not a researcher. An invented theme is indistinguishable on screen from a researched one, and this goes in front of somebody deciding what to say to reporters.

Weight: "dominant" only when the notes present it as the main thing being said. Most themes are "occasional".

SCORING. Do NOT try to produce a single balanced verdict number. Answer two separate questions, each on its own, and let the arithmetic downstream find the lean:

  favourable — how loud is the praise?
  hostile    — how loud is the attack?

Judge each WITHOUT looking at the other. A figure can be loudly praised and loudly attacked at once (both high), or barely mentioned either way (both low) — those are completely different situations and a single mixed score cannot tell them apart.

- USE THE WHOLE 0-100 RANGE. Calibrate against these, they are not decoration:
    0-10   near silence on that side. Reserve it for genuine absence.
    15-30  present but generic or passing. "Experienced", "hardworking", one unattributed grumble.
    40-60  specific and attributed. A named opponent making a checkable allegation; a named official confirming delivered work.
    70-90  that side dominates the coverage — front pages, repeated across outlets, the main thing being said.
  A named allegation repeated across several papers is 50-70 hostile. It is not 8. Generic praise is 15-25. It is not 2.
- PROMINENCE, not count. One criticism the notes call dominant outbids three occasional compliments.
- SPECIFIC beats generic. A named, checkable allegation from a named opponent is loud. "Has extensive experience" is what coverage says about everybody, and is quiet.
- Do not round the two towards each other to seem fair. If the attack is specific and repeated and the praise is generic, the gap between the numbers should show it.
- Both numbers LOW means nobody is saying much either way. Both numbers HIGH means a fight — loudly praised and loudly attacked at once. These are opposite situations, so do not collapse either into the middle.
- Too thin to judge at all: set confidence "thin" and give both magnitudes honestly low, rather than inventing volume on either side.

Caveats: always include at least one. This reading comes from published coverage, not from a survey of constituents, and whoever reads it must be told that.

${HOUSE_STYLE}
`

export async function structureNotes(
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
      // Try the next provider rather than losing the research we already paid
      // for because one key is rate-limited.
    }
  }
  return null
}

/* ── the entry point ─────────────────────────────────────────────────────── */

const themes = (raw: unknown): OpinionTheme[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .map((t) => ({
      label: typeof t['label'] === 'string' ? t['label'] : '',
      detail: typeof t['detail'] === 'string' ? t['detail'] : '',
      weight: (t['weight'] === 'dominant' || t['weight'] === 'frequent'
        ? t['weight']
        : 'occasional') as OpinionTheme['weight'],
      who: typeof t['who'] === 'string' && t['who'].trim() ? t['who'].trim() : null,
    }))
    .filter((t) => t.label && t.detail)
    .slice(0, 6)

export interface SurveyInput {
  name: string
  role?: string | null
  constituency?: string | null
  state?: string | null
  party?: string | null
  signal?: AbortSignal
}

/**
 * Assemble the final survey from the two halves.
 *
 * Split out so the endpoint can run the halves as separate requests. The local
 * dev runtime enforces a hard thirty seconds per function call whatever the
 * config says, and a grounded web search followed by a structuring call reliably
 * exceeds it — the whole thing died at exactly 30.00s having done all the work
 * and returned none of it.
 */
/**
 * The lean, from the two magnitudes the model judged separately.
 *
 * Subtraction rather than a model-produced signed score, for the reason set
 * out on the schema fields: asked for one number on -100..+100 the model
 * parked on the midpoint whatever the evidence said. Asked how loud each side
 * is, it discriminates — and the arithmetic cannot hedge.
 *
 * `null` only when the model gave neither magnitude, which means the schema
 * was not honoured at all. Both-zero is NOT null: it is the real and useful
 * finding that nobody is saying much either way, and the screen distinguishes
 * "nobody is talking about you" from "we could not tell".
 *
 * The legacy `score` field is still read as a fallback so a cached survey
 * written before this change keeps working.
 */
function deriveScore(parsed: Record<string, unknown>): {
  score: number | null
  favourable: number | null
  hostile: number | null
} {
  const mag = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null

  const favourable = mag(parsed['favourable'])
  const hostile = mag(parsed['hostile'])

  if (favourable !== null || hostile !== null) {
    return {
      score: Math.max(-100, Math.min(100, (favourable ?? 0) - (hostile ?? 0))),
      favourable,
      hostile,
    }
  }

  const legacy = parsed['score']
  return {
    score:
      typeof legacy === 'number' && Number.isFinite(legacy)
        ? Math.max(-100, Math.min(100, Math.round(legacy)))
        : null,
    favourable: null,
    hostile: null,
  }
}

export function assembleSurvey(
  parsed: Record<string, unknown>,
  sources: { title: string; url: string | null }[],
): OpinionSurvey {
  const { score, favourable, hostile } = deriveScore(parsed)

  const caveats = (Array.isArray(parsed['caveats']) ? parsed['caveats'] : []).filter(
    (c): c is string => typeof c === 'string' && c.trim().length > 0,
  )

  return {
    score,
    favourable,
    hostile,
    verdict: typeof parsed['verdict'] === 'string' ? parsed['verdict'] : '',
    praise: themes(parsed['praise']),
    criticism: themes(parsed['criticism']),
    controversies: themes(parsed['controversies']),
    sources,
    confidence:
      parsed['confidence'] === 'well-covered' || parsed['confidence'] === 'moderate'
        ? parsed['confidence']
        : 'thin',
    caveats: [
      'Read from published coverage, not from a survey. It reflects what journalists, opponents and commentators have written, not a sample of your constituents.',
      ...caveats.filter((c) => !/survey|poll/i.test(c)),
    ].slice(0, 4),
    searched: true,
  }
}

/** The person, described the way the search prompt wants them. */
export function describeSubject(input: SurveyInput): string {
  return [
    input.name,
    input.role ? `the ${input.role}` : null,
    input.constituency ? `for ${input.constituency}` : null,
    input.state ? `in ${input.state}` : null,
    input.party ?? null,
  ]
    .filter(Boolean)
    .join(' ')
}

export async function surveyOpinion(input: SurveyInput): Promise<OpinionSurvey> {
  const empty = (caveat: string): OpinionSurvey => ({
    score: null,
    favourable: null,
    hostile: null,
    verdict: '',
    praise: [],
    criticism: [],
    controversies: [],
    sources: [],
    confidence: 'thin',
    caveats: [caveat],
    searched: false,
  })

  if (!opinionSearchAvailable()) {
    return empty('No Gemini key is set, so the published record could not be read.')
  }

  const who = [
    input.name,
    input.role ? `the ${input.role}` : null,
    input.constituency ? `for ${input.constituency}` : null,
    input.state ? `in ${input.state}` : null,
    input.party ?? null,
  ]
    .filter(Boolean)
    .join(' ')

  const read = await groundedRead(who, input.signal)
  if (!read) {
    return { ...empty('The web search did not return anything usable.'), searched: true }
  }

  const parsed = await structureNotes(read.text, input.signal)
  if (!parsed) {
    return {
      ...empty(
        'The research was gathered but no language model was available to structure it. Set GROQ_API_KEY or GEMINI_API_KEY.',
      ),
      searched: true,
      sources: read.sources,
    }
  }

  // Same derivation as the split path above — one place decides what the
  // number means, so the two entry points cannot drift apart.
  const { score, favourable, hostile } = deriveScore(parsed)

  const caveats = (Array.isArray(parsed['caveats']) ? parsed['caveats'] : [])
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)

  return {
    score,
    favourable,
    hostile,
    verdict: typeof parsed['verdict'] === 'string' ? parsed['verdict'] : '',
    praise: themes(parsed['praise']),
    criticism: themes(parsed['criticism']),
    controversies: themes(parsed['controversies']),
    sources: read.sources,
    confidence:
      parsed['confidence'] === 'well-covered' || parsed['confidence'] === 'moderate'
        ? parsed['confidence']
        : 'thin',
    // Enforced rather than requested. The distinction between "what has been
    // published" and "what constituents think" is the single thing a reader
    // most needs, and a model that forgets it once would ship a poll that was
    // never taken.
    caveats: [
      'Read from published coverage, not from a survey. It reflects what journalists, opponents and commentators have written, not a sample of your constituents.',
      ...caveats.filter((c) => !/survey|poll/i.test(c)),
    ].slice(0, 4),
    searched: true,
  }
}
