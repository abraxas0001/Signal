import { complete } from './openai-compat'
import { resolveProviders } from './provider'

/**
 * One JSON answer from whichever model can actually produce it.
 *
 * The pattern every analysis endpoint here converged on, extracted before a
 * third copy drifted: try each configured provider with the strict schema,
 * accept only an answer the caller's `usable` check can render, and fall back
 * to Gemini's NATIVE endpoint with responseMimeType json — the one path that
 * has produced clean nested JSON on every scraper pass, while the
 * OpenAI-compatible wrapper around the same model flattens nested arrays.
 */
export async function groundedJson<T extends Record<string, unknown>>(input: {
  system: string
  user: string
  schema: Record<string, unknown>
  usable: (candidate: T) => boolean
  /** Stop early only when this also holds; the best usable answer is kept. */
  preferred?: (candidate: T) => boolean
}): Promise<T | null> {
  const { system, user, schema, usable, preferred } = input

  /**
   * Gemini is DELIBERATELY not tried through the OpenAI-compatible wrapper:
   * that path flattens nested arrays into junk (measured, repeatedly), so an
   * attempt there is spent generation time with no chance of a usable
   * answer — and locally the whole function has 30 seconds. The native call
   * below is the same model done right.
   */
  const compat = resolveProviders().filter(
    (p) => p.baseUrl && !/gemini|generativelanguage/i.test(`${p.baseUrl} ${p.model ?? ''}`),
  )

  let best: T | null = null
  for (const provider of compat) {
    try {
      const out = await complete({ provider, system, user, schema })
      const candidate = JSON.parse(out.text) as T
      if (!usable(candidate)) continue
      best = candidate
      if (!preferred || preferred(candidate)) return best
    } catch {
      /* next provider */
    }
  }
  if (best) return best

  const key = process.env['GEMINI_API_KEY']
  if (!key) return null
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${system}\n\n${user}` }] }],
          generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(40_000),
      },
    )
    if (!res.ok) return null
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const candidate = JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text ?? '') as T
    return usable(candidate) ? candidate : null
  } catch {
    return null
  }
}
