import type { Provider } from './provider'

/**
 * A streaming chat-completions call against any OpenAI-shaped endpoint.
 *
 * Written against `fetch` rather than a vendor SDK deliberately: Groq, Cerebras,
 * Gemini's compatibility layer, OpenRouter and a self-hosted vLLM all speak this
 * shape, and adding an SDK per provider would be four dependencies to reach the
 * same three fields.
 *
 * Note this does NOT use the hardened fetcher in `fetcher.ts`. That exists to
 * defend against a user-supplied URL resolving somewhere private; the endpoint
 * here is an operator-configured constant, and pinning its DNS would break
 * providers that load-balance across regions.
 */

export interface CompletionResult {
  /** The raw JSON body the model produced. */
  text: string
  inputTokens?: number
  outputTokens?: number
}

export interface CompletionRequest {
  provider: Provider
  system: string
  user: string
  /** Data URI, when the user supplied a screenshot as the rescue path. */
  image?: { mediaType: string; data: string } | null
  schema: Record<string, unknown>
  maxTokens?: number
  /** Called with each text delta, so the caller can track progress honestly. */
  onDelta?: (delta: string) => void
  signal?: AbortSignal
}

type Msg = { role: 'system' | 'user'; content: unknown }

function buildMessages(req: CompletionRequest): Msg[] {
  const { system, user, image } = req
  if (!image) {
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]
  }
  // The multimodal content shape is shared across every provider that supports
  // images on this API.
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } },
        { type: 'text', text: user },
      ],
    },
  ]
}

/**
 * How many output tokens to reserve, sized against this specific prompt.
 *
 * Groq counts input + max_tokens against a per-minute ceiling BEFORE generating
 * and refuses the whole request if the sum is over — in under 400ms, with no
 * analysis at all. A constant reserve cannot satisfy both a 1,608-character
 * post and a 5,202-character one, so it is computed.
 *
 * Calibrated against real responses rather than assumed:
 *   1,608 chars -> 3,466 input tokens
 *   1,771 chars -> 3,318
 *   5,202 chars -> 4,040
 * which is a fixed ~3,000 (the JSON schema in response_format dominates it)
 * plus the prompt. The divisor is 2.5 rather than the ~4 those samples imply,
 * because Telugu and Hindi tokenize far worse than Latin text and this has to
 * hold for the content this product actually reads.
 *
 * The floor is 2,200: below that the model returns truncated JSON and the run
 * fails anyway ("Failed to generate JSON" at 2,048). Returning a too-small
 * budget would trade a clean failover for a broken response, so when the sum
 * cannot fit we ask for the floor and let the provider refuse — the next
 * provider in the chain then picks it up.
 */
function outputBudget(
  provider: Provider,
  req: CompletionRequest,
  system: string,
): number {
  const ceiling = req.maxTokens ?? provider.maxTokens
  if (!provider.tpmLimit) return ceiling

  const chars = system.length + req.user.length
  // 2,300 is the lean schema (~2,020) plus request scaffolding, measured.
  const estimatedInput = 2_300 + Math.ceil(chars / 2.5)
  const room = provider.tpmLimit - estimatedInput - 200 // margin for our own estimate

  return Math.max(2_200, Math.min(ceiling, room))
}

/**
 * Drop `description` fields from the schema.
 *
 * Groq counts the schema in response_format as input tokens — measured at
 * ~3,500 of an 8,000 tokens-per-minute ceiling, before a single word of the
 * post is read. Descriptions are 5,205 of the schema's 12,276 characters, so
 * removing them returns ~1,500 tokens of budget and is the difference between
 * the request being accepted and refused outright.
 *
 * What survives is what actually constrains the output: the field names, the
 * types, and all 24 enums — which is where the taxonomy lives. The guidance the
 * descriptions carried is already stated at length in the system prompt, so it
 * is not lost, only stated once instead of twice.
 *
 * Applied only to providers that meter this way. Gemini does not count the
 * schema against input at all (measured: 571 input tokens on a prompt Groq
 * charged 3,466 for), so it keeps the fully documented schema.
 */
function stripDescriptions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripDescriptions)
  if (!node || typeof node !== 'object') return node

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'description') continue
    out[key] = stripDescriptions(value)
  }
  return out
}

/**
 * Rewrite a JSON Schema into the shape strict structured-output mode demands.
 *
 * OpenAI-compatible strict mode is not "the schema, enforced" — it is a narrow
 * dialect. Every object must carry `additionalProperties: false` and must list
 * every one of its properties in `required`; optionality is expressed by
 * allowing null in the type, not by omission. A schema that misses this is not
 * rejected up front with a useful message. The model generates, the provider
 * validates, and the request dies with "Generated JSON does not match the
 * expected schema" — after paying for the generation.
 *
 * That failure was cascading: both json_schema attempts failed, the run fell
 * through to json_object, and json_object inlines the whole 12KB schema into
 * the prompt as text — which then breached the 8,000 token-per-minute ceiling
 * and refused the request outright. One incompatible schema, three failures.
 *
 * Requiring every field is the right semantics here anyway: the prompt already
 * instructs the model to fill every field and use empty strings and empty
 * arrays rather than omitting anything.
 */
function toStrictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSchema)
  if (!node || typeof node !== 'object') return node

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] = toStrictSchema(value)
  }

  if (out['type'] === 'object' && out['properties'] && typeof out['properties'] === 'object') {
    out['additionalProperties'] = false
    out['required'] = Object.keys(out['properties'] as Record<string, unknown>)
  }
  return out
}

/**
 * Ask for JSON, in the strictest mode the provider will accept.
 *
 * `json_schema` is the one that actually constrains the output, but support is
 * uneven — several providers advertise it and then reject a schema this large,
 * and some accept it only without `strict`. Rather than maintain a matrix of
 * which provider tolerates what, try the strongest form and step down on a
 * 4xx that names the parameter.
 */
const FORMATS = [
  (schema: Record<string, unknown>) => ({
    type: 'json_schema' as const,
    json_schema: {
      name: 'analysis',
      strict: true,
      schema: toStrictSchema(schema) as Record<string, unknown>,
    },
  }),
  (schema: Record<string, unknown>) => ({
    type: 'json_schema' as const,
    json_schema: { name: 'analysis', schema },
  }),
  () => ({ type: 'json_object' as const }),
]

function isFormatRejection(status: number, body: string): boolean {
  if (status !== 400 && status !== 422 && status !== 404) return false
  return /response_format|json_schema|schema|strict|not supported|unsupported/i.test(body)
}

export async function complete(req: CompletionRequest): Promise<CompletionResult> {
  const { provider } = req
  let lastError = ''

  // On a provider that charges for the schema, send the lean one.
  const schema = (
    provider.tpmLimit ? stripDescriptions(req.schema) : req.schema
  ) as Record<string, unknown>

  for (let attempt = 0; attempt < FORMATS.length; attempt++) {
    const format = FORMATS[attempt]!(schema)

    // In the loosest mode nothing constrains the shape, so the schema has to be
    // stated in the prompt instead.
    const system =
      format.type === 'json_object'
        ? `${req.system}\n\nRespond with a single JSON object and nothing else. It must match this JSON Schema exactly:\n${JSON.stringify(schema)}`
        : req.system

    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      signal: req.signal ?? null,
      body: JSON.stringify({
        model: provider.model,
        messages: buildMessages({ ...req, system }),
        max_tokens: outputBudget(provider, req, system),
        temperature: 0.2,
        stream: true,
        stream_options: { include_usage: true },
        response_format: format,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      lastError = `HTTP ${res.status} ${body.slice(0, 300)}`
      // Step down to a looser JSON mode and try again.
      if (isFormatRejection(res.status, body) && attempt < FORMATS.length - 1) continue
      throw new Error(providerError(provider, res.status, body))
    }

    return readStream(res, req.onDelta)
  }

  throw new Error(`${provider.label} refused every JSON mode. ${lastError}`)
}

/** Turn a provider's error body into something an operator can act on. */
function providerError(provider: Provider, status: number, body: string): string {
  // Not every provider uses 401 for a bad key — Gemini answers 400 with
  // "Please pass a valid API key", which would otherwise surface as a generic
  // bad-request and send an operator hunting in the wrong place.
  const authish = /valid api key|invalid api key|api key not valid|unauthenticated|permission denied/i
  if (status === 401 || status === 403 || authish.test(body)) {
    return `${provider.label} rejected the API key. Check the value and that the key is active.`
  }
  // Groq counts max_tokens against tokens-per-minute BEFORE generating, so an
  // over-provisioned ceiling is refused outright even on a one-word prompt.
  // Naming that is the difference between a fixable message and a mystery.
  if (status === 413) {
    return `${provider.label} refused the request as too large for its tokens-per-minute allowance. The output ceiling is counted up front, so lower it with LLM_MAX_TOKENS (currently ${provider.maxTokens}).`
  }
  if (status === 429) {
    const wait = /try again in ([\d.]+\s*\w+)/i.exec(body)?.[1]
    return `${provider.label} rate-limited this request${wait ? ` — retry in ${wait}` : ''}. Free tiers cap tokens per minute and requests per day.`
  }
  if (status === 404) {
    return `${provider.label} does not have a model called "${provider.model}". Set LLM_MODEL to one it offers.`
  }
  const detail = /"message"\s*:\s*"([^"]{1,200})"/.exec(body)?.[1]
  return `${provider.label} returned HTTP ${status}${detail ? `: ${detail}` : ''}`
}

/**
 * Read an SSE stream of chat-completion chunks into the finished text.
 *
 * Buffering by line matters: a chunk boundary can land mid-event, and treating
 * each network read as a complete message drops whatever straddles the split.
 */
async function readStream(
  res: Response,
  onDelta?: (delta: string) => void,
): Promise<CompletionResult> {
  if (!res.body) throw new Error('The model returned an empty response.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let inputTokens: number | undefined
  let outputTokens: number | undefined

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue

      const payload = line.slice(5).trim()
      if (payload === '[DONE]') continue

      let chunk: {
        choices?: Array<{ delta?: { content?: string | null } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      try {
        chunk = JSON.parse(payload)
      } catch {
        continue
      }

      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) {
        text += delta
        onDelta?.(delta)
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens
        outputTokens = chunk.usage.completion_tokens
      }
    }
  }

  if (!text.trim()) throw new Error('The model returned no analysis.')
  return { text: stripFence(text), inputTokens, outputTokens }
}

/**
 * Some models wrap JSON in a markdown fence even when asked not to. Strip it
 * rather than fail the whole run on three stray backticks.
 */
function stripFence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}
