import {
  ACTION_CATEGORIES,
  ACTION_PRIORITIES,
  COMMS_CHANNELS,
  DEBUNK_STATUSES,
  EMOTIONS,
  FAKE_NEWS_TYPES,
  FAKE_SUSPICION,
  GRIEVANCE_TYPES,
  NARRATIVE_CATEGORIES,
  PRIORITY_TAGS,
  PUBLIC_NARRATIVES,
  REACH_SCOPES,
  RESPONSE_STATUSES,
  RISK_LEVELS,
  SENTIMENTS,
  SEVERITIES,
  TARGETS,
  TONES,
  TOPICS,
  URBAN_RURAL,
} from '../../../shared/taxonomy'

/**
 * The JSON Schema handed to `output_config.format`, generated from the same
 * `as const` arrays the UI renders from. Structured outputs guarantee the model
 * returns exactly this shape, which removes every "the model returned prose
 * instead of JSON" failure mode.
 *
 * Constraints that structured outputs do not support (minItems, maxItems,
 * minimum/maximum) are expressed in the field descriptions instead — the model
 * honours them reliably and the API would reject them in the schema.
 */

const enumOf = (values: readonly string[], description: string) => ({
  type: 'string' as const,
  enum: [...values],
  description,
})

const str = (description: string) => ({ type: 'string' as const, description })
const strArray = (description: string) => ({
  type: 'array' as const,
  items: { type: 'string' as const },
  description,
})

const obj = <T extends Record<string, unknown>>(properties: T, description?: string) => ({
  type: 'object' as const,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
  ...(description ? { description } : {}),
})

export const ANALYSIS_SCHEMA = obj({
  // Language comes first deliberately. Structured outputs are emitted in
  // schema order, so this both matches the pipeline the interface narrates
  // (read -> translate -> analyse) and gives the model an English rendering of
  // the post before it reasons about sentiment and intent.
  language: obj({
    code: str('BCP-47 code of the post language, e.g. "te", "hi", "en".'),
    name: str('Language name in English, e.g. "Telugu".'),
    translation: str(
      'Full English translation of the post text. Empty string if the post is already English.',
    ),
  }),

  headline: str(
    'One punchy sentence naming what this post IS. Max 12 words. Not a summary — a label a busy reader could scan. E.g. "Farmer scheme payout accused of skipping tenant farmers".',
  ),
  summary: str('Two to three sentences on what the post is about, in English.'),
  intent: str(
    'What the author is trying to achieve: persuade, complain, celebrate, mobilise, inform, sell, deflect. One or two sentences, naming the goal.',
  ),
  keyPoints: strArray('The 3–5 distinct claims or points actually made. One sentence each.'),

  notableQuotes: {
    type: 'array' as const,
    description:
      'Up to 3 phrases worth reproducing verbatim, especially any allegation. Copy the original exactly, in its own script — never paraphrase or transliterate. Empty array if nothing stands out.',
    items: obj({
      original: str('The exact phrase as written in the post, original script preserved.'),
      translation: str('English rendering. Repeat the original if it is already English.'),
    }),
  },

  sentiment: obj({
    label: enumOf(SENTIMENTS, 'Overall sentiment of the post toward its subject.'),
    score: {
      type: 'integer' as const,
      description: 'Sentiment as -100 (most negative) to +100 (most positive). 0 is neutral.',
    },
    rationale: str('One line on why this label was assigned. Point at specific wording.'),
    tone: enumOf(TONES, 'The register the author writes in.'),
    publicNarrative: enumOf(
      PUBLIC_NARRATIVES,
      'How the audience appears to be receiving it, judging from engagement ratios and any visible reaction. "NA" if there is no signal.',
    ),
  }),

  emotions: {
    type: 'array' as const,
    description:
      'The 3–4 strongest emotions present, with weights that sum to roughly 100. Strongest first.',
    items: obj({
      emotion: enumOf(EMOTIONS, 'Emotion category.'),
      weight: { type: 'integer' as const, description: 'Relative strength, 0–100.' },
    }),
  },

  topics: obj({
    primary: enumOf(TOPICS, 'The single dominant topic.'),
    subtopic: str('Free-text specific subject, e.g. "Annadata Sukhibhava second instalment".'),
    secondary: {
      type: 'array' as const,
      items: enumOf(TOPICS, 'A secondary topic.'),
      description: 'Up to 3 other topics present. Empty array if none.',
    },
    tags: strArray('3–6 short kebab-case tags, e.g. "pending-bills", "tenant-farmers".'),
  }),

  entities: {
    type: 'array' as const,
    description:
      'Named people, organisations, places, schemes and events. Up to 10. Preserve names as written.',
    items: obj({
      name: str('The entity as named in the post.'),
      kind: enumOf(
        ['person', 'organisation', 'place', 'scheme', 'event', 'other'],
        'Entity category.',
      ),
      role: str('Their position or relevance, e.g. "Home Minister". Empty string if unknown.'),
      stance: enumOf(
        ['praised', 'criticised', 'neutral', 'mentioned'],
        'How this post treats them.',
      ),
    }),
  },

  reach: obj({
    scope: enumOf(REACH_SCOPES, 'Geographic spread of the issue, not the raw impression count.'),
    estimatedImpressions: {
      type: 'integer' as const,
      description:
        'Best estimate of how many people plausibly saw this, from the metrics given. Use -1 if there is no basis to estimate.',
    },
    amplifiers: strArray(
      'Named accounts or outlets spreading this further. Empty array if none evident.',
    ),
    amplifiedByPoliticalActors: { type: 'boolean' as const, description: 'Politicians or party accounts pushing it.' },
    urbanRural: enumOf(URBAN_RURAL, 'Setting the post concerns.'),
    places: strArray('Place names mentioned. Empty array if none.'),
  }),

  credibility: obj({
    suspectedFalse: enumOf(FAKE_SUSPICION, 'Whether the post looks false or misleading.'),
    fakeNewsType: enumOf(FAKE_NEWS_TYPES, 'The shape of the falsehood, or "Not Applicable".'),
    debunkStatus: enumOf(DEBUNK_STATUSES, 'Verification state. Default "Not Checked".'),
    checkableClaims: {
      type: 'array' as const,
      description: 'Up to 3 specific factual claims a fact-checker could verify. Empty if none.',
      items: obj({
        claim: str('The claim, stated plainly.'),
        why: str('What makes it checkable and against which source.'),
      }),
    },
    signals: {
      type: 'array' as const,
      description: 'Up to 4 concrete signals about authenticity. Empty array if none.',
      items: obj({
        signal: str('The observation, e.g. "cites a specific GO number".'),
        direction: enumOf(['supports', 'undermines'], 'Whether it supports or undermines credibility.'),
      }),
    },
    notes: str('Any further credibility note. Empty string if none.'),
  }),

  civic: obj(
    {
      applicable: {
        type: 'boolean' as const,
        description:
          'TRUE only if the post concerns government, public services, politics, civic grievances or public officials. FALSE for product launches, sports, entertainment, personal posts — leave the rest of this object at its defaults when false.',
      },
      isGrievance: { type: 'boolean' as const, description: 'Does this raise a complaint or request?' },
      grievanceType: enumOf(GRIEVANCE_TYPES, 'Kind of grievance, or "Not a grievance".'),
      issueDescription: str('One line stating the problem, praise, or claim.'),
      target: enumOf(TARGETS, 'Who the post is aimed at.'),
      severity: enumOf(SEVERITIES, 'Impact on public order or reputation.'),
      riskToGovernment: enumOf(RISK_LEVELS, 'Reputational or political risk.'),
      riskRationale: str('One line on why that risk level.'),
      narrativeCategory: enumOf(NARRATIVE_CATEGORIES, 'How this behaves as a story.'),
      governmentResponseStatus: enumOf(RESPONSE_STATUSES, 'Has an official account responded?'),
      respondent: str('Who responded, if anyone. Empty string if none.'),
      suggestedAction: str('The single most useful next step, stated concretely.'),
      actionCategory: enumOf(ACTION_CATEGORIES, 'Category of that action.'),
      actionPriority: enumOf(ACTION_PRIORITIES, 'How urgent.'),
      talkingPoints: strArray(
        '2–4 short lines an official could say verbatim. Plain spoken language, not bureaucratic prose. Empty array if not applicable.',
      ),
      suggestedChannels: {
        type: 'array' as const,
        items: enumOf(COMMS_CHANNELS, 'A channel.'),
        description: 'Up to 3 channels for the response. Empty array if not applicable.',
      },
      priorityTag: enumOf(PRIORITY_TAGS, 'Escalate, Monitor, or Archive.'),
      counterNarrative: str(
        'A suggested counter-narrative if this is an attack or falsehood. Empty string otherwise.',
      ),
    },
    'The civic/political layer. Set applicable=false for non-civic posts.',
  ),

  observations: strArray(
    'Up to 4 things worth knowing that the fixed fields did not capture. Empty array if none.',
  ),
  inferredFields: strArray(
    'Names of fields you had to judge without direct evidence, so the interface can mark them as estimates. E.g. "reach.estimatedImpressions".',
  ),
})

export type AnalysisSchemaShape = typeof ANALYSIS_SCHEMA
