import type {
  AccountType,
  ActionCategory,
  ActionPriority,
  CommsChannel,
  ConfidenceTier,
  DebunkStatus,
  Emotion,
  EvidenceSource,
  FakeNewsType,
  FakeSuspicion,
  GrievanceType,
  NarrativeCategory,
  Platform,
  PostType,
  PriorityTag,
  PublicNarrative,
  ReachScope,
  ResponseStatus,
  RiskLevel,
  Sentiment,
  Severity,
  Target,
  Tone,
  Topic,
  UrbanRural,
} from './taxonomy'

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — what we could actually fetch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A number we may or may not have been able to measure. `source` is what makes
 * the honesty of the UI possible: an inferred 'likes' renders differently from
 * one pulled off the YouTube Data API.
 */
export interface Metric {
  value: number | null
  source: EvidenceSource
  /** Verbatim string when the platform gives a label rather than a count. */
  display?: string
}

export interface MediaItem {
  kind: 'image' | 'video' | 'audio' | 'document'
  url: string
  thumbnailUrl?: string | null
  width?: number | null
  height?: number | null
  durationSeconds?: number | null
  alt?: string | null
}

export interface Author {
  name: string | null
  handle: string | null
  profileUrl: string | null
  avatarUrl: string | null
  verified: boolean | null
  followers: Metric
  accountType: AccountType
  /** Free text from the profile bio or a post location tag. */
  declaredLocation: string | null
}

export interface PostContent {
  /** The post exactly as written — native script preserved, never normalised. */
  text: string | null
  title: string | null
  /** BCP-47-ish code the detector returned, e.g. "te", "hi", "en". */
  languageCode: string | null
  /** Human label for the chip, e.g. "Telugu". */
  languageName: string | null
  /** English rendering. Null when the post is already English. */
  translation: string | null
  /** Transcript for video posts, when captions were available. */
  transcript: string | null
  hashtags: string[]
  mentions: string[]
  outboundLinks: string[]
}

export interface Engagement {
  likes: Metric
  comments: Metric
  shares: Metric
  views: Metric
  /** Interactions ÷ views, when both are real numbers. */
  engagementRate: number | null
}

/** How the fetch went — surfaced in the UI so nothing looks silently broken. */
export interface ExtractionMeta {
  /** Adapter that produced the data, e.g. "youtube:oembed". */
  strategy: string
  /** Every adapter attempted, in order, with its outcome. */
  attempts: Array<{ strategy: string; ok: boolean; note?: string }>
  confidence: ConfidenceTier
  /** True when the user pasted text or uploaded a screenshot to fill gaps. */
  userAssisted: boolean
  fetchedAt: string
  /** Set when the platform blocked us and the UI should offer the rescue path. */
  blocked?: { reason: string; suggestion: string }
}

/**
 * One public comment on a post.
 *
 * Comment text is the only direct evidence of how a post actually landed.
 * Everything else in this product is a property of the post; this is a property
 * of the audience, and it is what turns `sentiment.publicNarrative` from an
 * inference about the post into a reading of the replies.
 *
 * Treated as untrusted throughout: it is attacker-controlled text from the open
 * internet, and it is handed to a model.
 */
export interface Comment {
  text: string
  author: string | null
  likes: number | null
  publishedAt: string | null
  /** A reply to another comment rather than to the post itself. */
  isReply: boolean
}

export interface PostSnapshot {
  inputUrl: string
  canonicalUrl: string
  platform: Platform
  postType: PostType
  publishedAt: string | null
  author: Author
  content: PostContent
  engagement: Engagement
  /**
   * Top public comments, best-effort. Absent where the platform publishes no
   * comments, exposes none without a login, or ran out of time — which is why
   * this is optional rather than an empty array meaning "none exist".
   */
  comments?: Comment[]
  media: MediaItem[]
  extraction: ExtractionMeta
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — what the model made of it
// ─────────────────────────────────────────────────────────────────────────────

export interface EmotionScore {
  emotion: Emotion
  /** 0–100. The set should roughly sum to 100. */
  weight: number
}

export interface Entity {
  name: string
  kind: 'person' | 'organisation' | 'place' | 'scheme' | 'event' | 'other'
  /** e.g. "Home Minister", "YSRCP Eluru Coordinator". */
  role: string | null
  /** How this post treats them. */
  stance: 'praised' | 'criticised' | 'neutral' | 'mentioned'
}

export interface SentimentReading {
  label: Sentiment
  /** −100 … +100, for the meter needle. */
  score: number
  /** One line on why this label was assigned — the sheet's "Rationale" column. */
  rationale: string
  tone: Tone
  /** What the comments/quotes suggest the audience felt, vs. the author's tone. */
  publicNarrative: PublicNarrative
}

export interface TopicReading {
  primary: Topic
  /** Free text — the sheet's Subtopic column is unconstrained. */
  subtopic: string
  secondary: Topic[]
  /** Short tags for the tag cloud, e.g. "#water-crisis", "pending-bills". */
  tags: string[]
}

export interface ReachReading {
  scope: ReachScope
  /** Model's estimate of people who plausibly saw this. */
  estimatedImpressions: number | null
  /** Named accounts spreading it further. */
  amplifiers: string[]
  amplifiedByPoliticalActors: boolean
  urbanRural: UrbanRural
  /** Place names the post is about, for the location chips. */
  places: string[]
}

export interface CredibilityReading {
  suspectedFalse: FakeSuspicion
  fakeNewsType: FakeNewsType
  debunkStatus: DebunkStatus
  /** Specific claims worth checking, each with why it's checkable. */
  checkableClaims: Array<{ claim: string; why: string }>
  /** Signals that argue for or against authenticity. */
  signals: Array<{ signal: string; direction: 'supports' | 'undermines' }>
  notes: string | null
}

/**
 * The political / governance layer. Null when the post simply isn't civic —
 * a product launch or a cricket clip gets everything above and none of this.
 */
export interface CivicReading {
  isGrievance: boolean
  grievanceType: GrievanceType
  /** One-line statement of the problem, praise, or claim. */
  issueDescription: string
  target: Target
  severity: Severity
  riskToGovernment: RiskLevel
  riskRationale: string
  narrativeCategory: NarrativeCategory
  governmentResponse: {
    status: ResponseStatus
    respondent: string | null
    adequacy: string | null
  }
  suggestedAction: string
  actionCategory: ActionCategory
  actionPriority: ActionPriority
  /** 2–4 short lines a minister could say verbatim. */
  talkingPoints: string[]
  suggestedChannels: CommsChannel[]
  priorityTag: PriorityTag
  /** Suggested counter-narrative, from the NARRATIVE INTELLIGENCE sheet. */
  counterNarrative: string | null
}

export interface Analysis {
  /** One punchy line: what this post *is*. Drives the hero. */
  headline: string
  /** 2–3 sentences: what it's about. */
  summary: string
  /** What the author is trying to convey or achieve. */
  intent: string
  /** The 3–5 things actually being said. */
  keyPoints: string[]
  /** Quoted phrases worth reproducing verbatim — the sheet requires exact quotes for allegations. */
  notableQuotes: Array<{ original: string; translation: string | null }>

  sentiment: SentimentReading
  emotions: EmotionScore[]
  topics: TopicReading
  entities: Entity[]
  reach: ReachReading
  credibility: CredibilityReading
  /** Present only when the post has a civic/political dimension. */
  civic: CivicReading | null

  /** Whatever else is worth knowing that the fixed fields didn't capture. */
  observations: string[]
  confidence: ConfidenceTier
  /** Which fields the model had to guess at, so the UI can mark them. */
  inferredFields: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// The full report
// ─────────────────────────────────────────────────────────────────────────────

export interface Report {
  id: string
  createdAt: string
  snapshot: PostSnapshot
  /**
   * Null when no language model ran.
   *
   * That is a complete result, not a failed one: the platform figures, the post
   * text, the author and the media are all measurements, and they stand on
   * their own. Interpretation — sentiment, intent, translation, recommended
   * action — is the only part that needs a model, so its absence is reported as
   * a narrower report rather than as an error.
   */
  analysis: Analysis | null
  /** Model + token accounting, shown in the debug drawer. */
  meta: {
    /** Null in data-only mode, where nothing was inferred. */
    model: string | null
    durationMs: number
    inputTokens?: number
    outputTokens?: number
    /** True when no ANTHROPIC_API_KEY was configured and heuristics were used. */
    heuristicOnly: boolean
  /**
   * Set when the run returned measurements but no written analysis — the
   * request ran out of time. The counts are real; the interpretation is absent
   * rather than guessed.
   */
  incomplete?: string
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire protocol — the analyse endpoint streams these as NDJSON
// ─────────────────────────────────────────────────────────────────────────────

export const PIPELINE_STAGES = [
  'resolve',
  'fetch',
  'read',
  'translate',
  'analyse',
  'assess',
  'compose',
] as const
export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export type StreamEvent =
  | { type: 'stage'; stage: PipelineStage; status: 'start' | 'done' | 'skip'; detail?: string }
  | { type: 'snapshot'; snapshot: PostSnapshot }
  | { type: 'partial'; text: string }
  | { type: 'report'; report: Report }
  | {
      type: 'error'
      message: string
      /** Set when the user can rescue the run by pasting text or a screenshot. */
      recoverable?: { reason: string; suggestion: string }
    }

/** What the client POSTs to /api/analyse. */
export interface AnalyseRequest {
  url: string
  /** Pasted post text, when the platform blocked us. */
  manualText?: string
  /** Data URI of a screenshot, read by the vision model. */
  screenshot?: string
  /** Numbers the user typed in themselves after a blocked fetch. */
  manualEngagement?: {
    likes?: number
    comments?: number
    shares?: number
    views?: number
    followers?: number
  }
}
