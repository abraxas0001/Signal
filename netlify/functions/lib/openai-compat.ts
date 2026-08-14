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
    json_schema: { name: 'analysis', strict: true, schema },
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

  for (let attempt = 0; attempt < FORMATS.length; attempt++) {
    const format = FORMATS[attempt]!(req.schema)

    // In the loosest mode nothing constrains the shape, so the schema has to be
    // stated in the prompt instead.
    const system =
      format.type === 'json_object'
        ? `${req.system}\n\nRespond with a single JSON object and nothing else. It must match this JSON Schema exactly:\n${JSON.stringify(req.schema)}`
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
        max_tokens: req.maxTokens ?? provider.maxTokens,
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
