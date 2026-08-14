import type { PostSnapshot } from '../../../../shared/types'
import type { ConfidenceTier } from '../../../../shared/taxonomy'

/** API keys, all optional — the product is designed to work with none of them. */
export interface ApiKeys {
  anthropic?: string
  youtube?: string
  /** Meta app access token, for Facebook/Instagram oEmbed. */
  meta?: string
}

export interface ExtractContext {
  keys: ApiKeys
  /** Post text the user pasted after a blocked fetch. */
  manualText?: string
  /** Screenshot data URI, read by the vision model. */
  screenshot?: string
}

export interface ExtractResult {
  ok: boolean
  /** Partial because no single adapter fills every field; the caller merges. */
  snapshot?: Partial<PostSnapshot>
  attempts: Array<{ strategy: string; ok: boolean; note?: string }>
  confidence?: ConfidenceTier
  /** Set when the platform refused us and the user can rescue the run. */
  blocked?: { reason: string; suggestion: string }
  /** Adapter-specific extras the analyser can use as context. */
  extra?: Record<string, unknown>
}
