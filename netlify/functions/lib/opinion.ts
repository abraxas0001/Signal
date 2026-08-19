import { complete } from './openai-compat'
import { resolveProviders } from './provider'

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
    score: {
      type: ['integer', 'null'],
      description:
        '-100 (uniformly hostile coverage) to 100 (uniformly favourable). Null when the text says coverage is too thin to judge.',
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
  required: ['score', 'verdict', 'praise', 'criticism', 'controversies', 'confidence', 'caveats'],
  additionalProperties: false,
}

const STRUCTURE_SYSTEM = `You are given research notes about one public figure, gathered from a web search. Turn them into structured fields.

THE ONLY RULE THAT MATTERS: you may not add anything. Every theme, every attribution, every judgement must already be present in the notes. If the notes do not say who is making a criticism, the "who" field is an empty string — do not infer it from the criticism itself. If the notes describe two criticisms, return two, not five.

You are a formatter here, not a researcher. An invented theme is indistinguishable on screen from a researched one, and this goes in front of somebody deciding what to say to reporters.

Weight: "dominant" only when the notes present it as the main thing being said. Most themes are "occasional".

Caveats: always include at least one. This reading comes from published coverage, not from a survey of constituents, and whoever reads it must be told that.`

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
export function assembleSurvey(
  parsed: Record<string, unknown>,
  sources: { title: string; url: string | null }[],
): OpinionSurvey {
  const score =
    typeof parsed['score'] === 'number' && Number.isFinite(parsed['score'])
      ? Math.max(-100, Math.min(100, Math.round(parsed['score'])))
      : null

  const caveats = (Array.isArray(parsed['caveats']) ? parsed['caveats'] : []).filter(
    (c): c is string => typeof c === 'string' && c.trim().length > 0,
  )

  return {
    score,
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
      'Read from published coverage, not from a survey. It reflects what journalists, opponents and commentators have written — not a sample of your constituents.',
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

  const score =
    typeof parsed['score'] === 'number' && Number.isFinite(parsed['score'])
      ? Math.max(-100, Math.min(100, Math.round(parsed['score'])))
      : null

  const caveats = (Array.isArray(parsed['caveats']) ? parsed['caveats'] : [])
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)

  return {
    score,
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
      'Read from published coverage, not from a survey. It reflects what journalists, opponents and commentators have written — not a sample of your constituents.',
      ...caveats.filter((c) => !/survey|poll/i.test(c)),
    ].slice(0, 4),
    searched: true,
  }
}
