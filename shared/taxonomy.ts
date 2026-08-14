/**
 * Signal — analysis taxonomy.
 *
 * Every controlled vocabulary here is derived from the Eluru_Social_Listening
 * workbook: the METADATA sheet defines the canonical lists, and the values
 * actually used across RAW_ENTRIES / FAKE_NEWS / NARRATIVE INTELLIGENCE extend
 * them. Keeping these as `as const` arrays means one source of truth for the
 * LLM's JSON schema, the UI's colour maps, and the export layer.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Platform & post metadata
// ─────────────────────────────────────────────────────────────────────────────

export const PLATFORMS = [
  'YouTube',
  'Facebook',
  'Instagram',
  'Twitter/X',
  'Threads',
  'TikTok',
  'LinkedIn',
  'Reddit',
  'Telegram',
  'WhatsApp',
  'Bluesky',
  'Mastodon',
  'Pinterest',
  'Snapchat',
  'News Site',
  'Blog',
  'Forum',
  'Other',
] as const
export type Platform = (typeof PLATFORMS)[number]

export const POST_TYPES = [
  'Original Post',
  'Video',
  'Short / Reel',
  'Comment',
  'Thread',
  'Repost / Share',
  'Live',
  'Article',
  'Image',
] as const
export type PostType = (typeof POST_TYPES)[number]

/** METADATA!B4, extended with the roles observed in RAW_ENTRIES. */
export const ACCOUNT_TYPES = [
  'Individual',
  'Journalist',
  'News Outlet',
  'Page',
  'Influencer',
  'Party Account',
  'MLA',
  'MP',
  'Minister',
  'Local Leader',
  'Department',
  'Government Body',
  'Brand / Business',
  'Bot Suspected',
  'Unknown',
] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Sentiment & emotion
// ─────────────────────────────────────────────────────────────────────────────

/** METADATA!B2 — the five-point scale. RAW_ENTRIES also uses "Mixed". */
export const SENTIMENTS = [
  'Strong Positive',
  'Positive',
  'Neutral',
  'Mixed',
  'Negative',
  'Strong Negative',
] as const
export type Sentiment = (typeof SENTIMENTS)[number]

export const TONES = [
  'Supportive',
  'Celebratory',
  'Informational',
  'Analytical',
  'Request for help',
  'Plea',
  'Demanding',
  'Accusatory',
  'Sarcastic',
  'Satirical',
  'Outraged',
  'Mournful',
  'Promotional',
] as const
export type Tone = (typeof TONES)[number]

/** Ekman set + the "Other" bucket the sheet uses. */
export const EMOTIONS = [
  'Joy',
  'Trust',
  'Anticipation',
  'Surprise',
  'Sadness',
  'Fear',
  'Anger',
  'Disgust',
  'Other',
] as const
export type Emotion = (typeof EMOTIONS)[number]

/** RAW_ENTRIES col 14 — the crowd's read, distinct from the author's tone. */
export const PUBLIC_NARRATIVES = [
  'Happy',
  'Agreed',
  'Divided',
  'Indifferent',
  'Resentment',
  'Outraged',
  'NA',
] as const
export type PublicNarrative = (typeof PUBLIC_NARRATIVES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Topic & issue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Civic topics from the sheet, plus general-purpose topics so the product works
 * on any post — the client asked for it to handle anything, with the civic
 * layer surfacing only when the post is actually civic.
 */
export const TOPICS = [
  // Civic / governance (from RAW_ENTRIES col 15)
  'Governance',
  'Corruption',
  'Scheme',
  'Education',
  'Health',
  'Roads',
  'Transport',
  'Water & Sanitation',
  'Electricity',
  'Agriculture',
  'Employment',
  'Housing',
  'Law & Order',
  'Crime / Injustice',
  'Development Works',
  'Social Welfare / Pensions',
  'Environment',
  'Land & Revenue',
  'Elections',
  'MLA Performance',
  // General-purpose
  'Business & Economy',
  'Technology',
  'Sports',
  'Entertainment',
  'Religion & Culture',
  'Personal / Lifestyle',
  'Marketing / Promotion',
  'Other',
] as const
export type Topic = (typeof TOPICS)[number]

/** RAW_ENTRIES col 17 — who the post is aimed at. */
export const TARGETS = [
  'Government',
  'Specific Department',
  'Minister',
  'MLA',
  'MP',
  'Bureaucracy',
  'Opposition',
  'Party',
  'Individual',
  'Company / Brand',
  'General Public',
  'No Clear Target',
] as const
export type Target = (typeof TARGETS)[number]

/** RAW_ENTRIES col 26. */
export const GRIEVANCE_TYPES = [
  'Complaint',
  'Request for service',
  'Request for help',
  'Demand for clarification',
  'Allegation',
  'Protest',
  'Other',
  'Not a grievance',
] as const
export type GrievanceType = (typeof GRIEVANCE_TYPES)[number]

/** METADATA!B6 — impact on public order or reputation. */
export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const
export type Severity = (typeof SEVERITIES)[number]

/** RAW_ENTRIES col 28 — geographic spread, not raw impressions. */
export const REACH_SCOPES = [
  'Local',
  'Constituency-wide',
  'District-wide',
  'State-wide',
  'National',
  'Viral beyond state',
] as const
export type ReachScope = (typeof REACH_SCOPES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Misinformation
// ─────────────────────────────────────────────────────────────────────────────

/** METADATA!B7. */
export const DEBUNK_STATUSES = [
  'Not Checked',
  'Under Review',
  'Debunked',
  'Confirmed False',
  'Confirmed True',
  'Not a misinformation',
] as const
export type DebunkStatus = (typeof DEBUNK_STATUSES)[number]

export const FAKE_SUSPICION = ['No', 'Unsure', 'Likely', 'Yes'] as const
export type FakeSuspicion = (typeof FAKE_SUSPICION)[number]

/** FAKE_NEWS!D — the shape the falsehood takes. */
export const FAKE_NEWS_TYPES = [
  'Fabricated Claim',
  'Misleading Context',
  'Manipulated Media',
  'Impersonation',
  'Satire Taken as Fact',
  'Outdated Content Recirculated',
  'Doctored Statistic',
  'AI-Generated / Deepfake',
  'Not Applicable',
] as const
export type FakeNewsType = (typeof FAKE_NEWS_TYPES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Government response tracking
// ─────────────────────────────────────────────────────────────────────────────

export const RESPONSE_STATUSES = ['Yes', 'Partial', 'No', 'Not checked'] as const
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number]

/** METADATA!r60. */
export const RESPONSE_ADEQUACY = [
  'Adequate',
  'Inadequate',
  'Misleading',
  'No Response',
] as const
export type ResponseAdequacy = (typeof RESPONSE_ADEQUACY)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Analysis & recommended action
// ─────────────────────────────────────────────────────────────────────────────

/** METADATA!r76 — how this item behaves as a story, not what it is about. */
export const NARRATIVE_CATEGORIES = [
  'Emerging Trend',
  'One-off Complaint',
  'Coordinated Campaign',
  'Rapidly Viral',
  'Local Issue',
  'Election-related',
  'Policy backlash',
  'Praise / Goodwill',
  'Routine Update',
] as const
export type NarrativeCategory = (typeof NARRATIVE_CATEGORIES)[number]

/** METADATA!r62 — suggested action by ministry. */
export const ACTION_CATEGORIES = [
  'Public clarification',
  'Press release',
  'Ground verification',
  'Rapid response through local administration',
  'Social media rebuttal',
  'Policy review',
  'Legal action',
  'Amplify / Celebrate',
  'Monitor only',
  'Ignore',
] as const
export type ActionCategory = (typeof ACTION_CATEGORIES)[number]

/** METADATA!B8. */
export const ACTION_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const
export type ActionPriority = (typeof ACTION_PRIORITIES)[number]

/** METADATA!r78. */
export const RISK_LEVELS = ['None', 'Low', 'Medium', 'High'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

/** METADATA!r82. */
export const COMMS_CHANNELS = [
  'Official X handle',
  'Official Facebook page',
  'Instagram',
  'WhatsApp broadcast',
  'Local press',
  'Press conference',
  'Video message',
  'Field visit',
  'Public notice',
] as const
export type CommsChannel = (typeof COMMS_CHANNELS)[number]

/** METADATA!r94. */
export const PRIORITY_TAGS = ['Escalate', 'Monitor', 'Archive'] as const
export type PriorityTag = (typeof PRIORITY_TAGS)[number]

export const URBAN_RURAL = ['Urban', 'Rural', 'Mixed', 'Unknown'] as const
export type UrbanRural = (typeof URBAN_RURAL)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Confidence — how much of the report rests on real data vs. inference
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drives the whole graceful-degradation story. Facebook frequently returns
 * nothing to a server-side fetch, so the UI must be honest about which tier a
 * given report sits in rather than presenting inference as measurement.
 */
export const CONFIDENCE_TIERS = ['high', 'medium', 'low'] as const
export type ConfidenceTier = (typeof CONFIDENCE_TIERS)[number]

/** Where a single field's value came from. Rendered as a provenance chip. */
export const EVIDENCE_SOURCES = [
  'platform-api', // official API with a key — exact numbers
  'public-endpoint', // unauthenticated syndication/oEmbed — exact but unofficial
  'page-scrape', // OpenGraph / JSON-LD parsed from the HTML
  'user-supplied', // pasted text or uploaded screenshot
  'vision', // read off an uploaded screenshot by the model
  'inferred', // the model's judgement, no direct measurement
  'unavailable',
] as const
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Presentation metadata
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sentiment → semantic token name. The actual colour values live in the theme
 * so light/dark stay in sync; this only maps meaning → role.
 */
export const SENTIMENT_TONE: Record<Sentiment, 'positive' | 'neutral' | 'mixed' | 'negative'> = {
  'Strong Positive': 'positive',
  Positive: 'positive',
  Neutral: 'neutral',
  Mixed: 'mixed',
  Negative: 'negative',
  'Strong Negative': 'negative',
}

/** −1 … +1, for the sentiment meter needle and for aggregation. */
export const SENTIMENT_SCORE: Record<Sentiment, number> = {
  'Strong Positive': 1,
  Positive: 0.5,
  Neutral: 0,
  Mixed: 0,
  Negative: -0.5,
  'Strong Negative': -1,
}

export const SEVERITY_RANK: Record<Severity, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
}

export const PRIORITY_RANK: Record<ActionPriority, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
}

export const RISK_RANK: Record<RiskLevel, number> = {
  None: 0,
  Low: 1,
  Medium: 2,
  High: 3,
}

/** Emoji used in the emotion ring. Deliberately one per Ekman category. */
export const EMOTION_GLYPH: Record<Emotion, string> = {
  Joy: '😊',
  Trust: '🤝',
  Anticipation: '👀',
  Surprise: '😮',
  Sadness: '😔',
  Fear: '😰',
  Anger: '😠',
  Disgust: '🤢',
  Other: '💭',
}
