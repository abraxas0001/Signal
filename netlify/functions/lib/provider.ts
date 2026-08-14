/**
 * Which language model runs the analysis, and how to reach it.
 *
 * Signal's extraction needs no key at all. Interpretation does — sentiment,
 * intent, translation, topics, recommended action are all a model reading the
 * post, and there is no keyless substitute for that.
 *
 * So rather than hard-wire one vendor, this resolves whichever provider the
 * operator has configured. Every option below is reachable with an OpenAI-shaped
 * chat-completions call except Anthropic, which has its own SDK path.
 *
 * Ordering is by suitability for *this* product, not by popularity. The content
 * here is named allegations about real officials and citizens' grievances, so a
 * provider that trains on its inputs is a genuine problem rather than a
 * preference — see README, "Choosing a provider".
 */

export type ProviderKind = 'anthropic' | 'openai-compat'

export interface Provider {
  kind: ProviderKind
  /** Shown in the report footer and the debug drawer. */
  label: string
  model: string
  apiKey: string
  /** OpenAI-compatible base, without a trailing slash. Unused for Anthropic. */
  baseUrl?: string
  /**
   * True when the provider's own terms say inputs are not used for training.
   * Surfaced so an operator can see at a glance what they picked.
   */
  privateByDefault: boolean
  /**
   * Ceiling on generated tokens.
   *
   * Not a safety valve — a budget. Groq bills `max_tokens` against its
   * tokens-per-minute allowance *before* generating anything, so asking for
   * 16,000 on a 12,000 TPM free tier is rejected outright with HTTP 413 even
   * for a one-word prompt. Measured output for a full analysis is around 1,400
   * tokens, so these are set from what the work actually costs rather than from
   * what the model could theoretically emit.
   */
  maxTokens: number
}

interface Candidate {
  env: string
  build: (key: string) => Provider
}

/**
 * Sensible default models per provider, overridable with LLM_MODEL.
 *
 * These are deliberately the largest free-tier-eligible option each provider
 * offers: the analysis is one call per post, and the quality gap on Telugu
 * between a small and a large model is wide enough to matter.
 */
const CANDIDATES: Candidate[] = [
  {
    env: 'ANTHROPIC_API_KEY',
    build: (apiKey) => ({
      kind: 'anthropic',
      label: 'Claude',
      model: process.env['LLM_MODEL'] ?? 'claude-opus-5',
      apiKey,
      privateByDefault: true,
      // No TPM coupling here, so headroom is free.
      maxTokens: 16000,
    }),
  },
  {
    env: 'GROQ_API_KEY',
    build: (apiKey) => ({
      kind: 'openai-compat',
      label: 'Groq',
      model: process.env['LLM_MODEL'] ?? 'llama-3.3-70b-versatile',
      apiKey,
      baseUrl: 'https://api.groq.com/openai/v1',
      // Groq's services agreement bars training on inputs or outputs without
      // explicit permission, and inference data is not retained by default.
      privateByDefault: true,
      // The free tier allows 12,000 tokens per minute and counts max_tokens
      // against it up front. The prompt and inlined schema are ~5,000, so this
      // leaves room for the request to be accepted at all.
      maxTokens: 4096,
    }),
  },
  {
    env: 'CEREBRAS_API_KEY',
    build: (apiKey) => ({
      kind: 'openai-compat',
      label: 'Cerebras',
      model: process.env['LLM_MODEL'] ?? 'llama-3.3-70b',
      apiKey,
      baseUrl: 'https://api.cerebras.ai/v1',
      privateByDefault: false,
      maxTokens: 4096,
    }),
  },
  {
    env: 'GEMINI_API_KEY',
    build: (apiKey) => ({
      kind: 'openai-compat',
      label: 'Gemini',
      model: process.env['LLM_MODEL'] ?? 'gemini-2.5-flash',
      apiKey,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      maxTokens: 8192,
      // Google states free-tier inputs and outputs may be used to improve its
      // models. Paid keys are excluded from that, but we cannot tell which kind
      // of key this is, so the honest default is false.
      privateByDefault: false,
    }),
  },
  {
    // The escape hatch: OpenRouter, Together, a local vLLM, anything that
    // speaks the same shape.
    env: 'LLM_API_KEY',
    build: (apiKey) => ({
      kind: 'openai-compat',
      label: process.env['LLM_LABEL'] ?? 'Custom model',
      model: process.env['LLM_MODEL'] ?? 'gpt-4o-mini',
      apiKey,
      baseUrl: (process.env['LLM_BASE_URL'] ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
      privateByDefault: false,
      maxTokens: Number(process.env['LLM_MAX_TOKENS']) || 4096,
    }),
  },
]

/** Every provider we know how to use, for the setup docs and error messages. */
export const PROVIDER_ENV_VARS = CANDIDATES.map((c) => c.env)

/**
 * The configured provider, or null when none is set.
 *
 * Null is a supported state, not an error: the app runs in data-only mode and
 * returns everything it measured.
 */
/**
 * Every configured provider, best first — a primary and its stand-ins.
 *
 * They are tried strictly in order and strictly one at a time. Nothing here
 * ever calls two providers for the same post: the second is reached only when
 * the first has already failed, so having a spare key configured costs nothing
 * until the day it is needed.
 *
 * That matters most on free tiers, where the limit is requests and tokens per
 * day rather than money. A second key doubles the headroom precisely because it
 * stays idle.
 */
export function resolveProviders(): Provider[] {
  const pinned = process.env['LLM_PROVIDER']?.trim().toLowerCase()
  const available = CANDIDATES.map((c) => {
    const key = process.env[c.env]?.trim()
    return key ? c.build(key) : null
  }).filter((p): p is Provider => p !== null)

  if (!pinned) return available

  const match = CANDIDATES.find(
    (c) => c.env.toLowerCase().startsWith(pinned) || c.build('x').label.toLowerCase() === pinned,
  )
  const primary = match ? available.find((p) => p.label === match.build('x').label) : undefined
  if (!primary) {
    throw new Error(
      `LLM_PROVIDER is set to "${pinned}" but no matching key is configured. Set ${
        match?.env ?? 'one of ' + PROVIDER_ENV_VARS.join(', ')
      }, or unset LLM_PROVIDER.`,
    )
  }
  // The pinned one leads; everything else stays as a fallback rather than
  // being discarded, which is the whole point of configuring a second key.
  return [primary, ...available.filter((p) => p !== primary)]
}

export function resolveProvider(): Provider | null {
  // An explicit choice beats resolution order. With several keys set, "whichever
  // comes first in this list" is a surprising way to decide something that
  // changes both the quality of the analysis and who sees the post text, so
  // LLM_PROVIDER lets an operator say it outright and keep the other keys in
  // place for comparison.
  const pinned = process.env['LLM_PROVIDER']?.trim().toLowerCase()
  if (pinned) {
    const match = CANDIDATES.find(
      (c) => c.env.toLowerCase().startsWith(pinned) || c.build('x').label.toLowerCase() === pinned,
    )
    const key = match ? process.env[match.env]?.trim() : undefined
    if (match && key) return match.build(key)
    // Naming an unreachable provider is a configuration mistake, not a reason
    // to silently analyse with a different one than the operator asked for.
    throw new Error(
      `LLM_PROVIDER is set to "${pinned}" but no matching key is configured. Set ${
        match?.env ?? 'one of ' + PROVIDER_ENV_VARS.join(', ')
      }, or unset LLM_PROVIDER.`,
    )
  }

  for (const c of CANDIDATES) {
    const key = process.env[c.env]?.trim()
    if (key) return c.build(key)
  }
  return null
}

