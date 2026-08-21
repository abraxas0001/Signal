import type { Report } from '@shared/types'

/**
 * A worked example, shown via ?demo=1 or the "See an example" link.
 *
 * Built from a real post in the Eluru dataset and the numbers our own
 * extractors returned for it, so it is an honest illustration of the output
 * rather than an idealised mock. It also means the product is explorable
 * before anyone configures an API key.
 */
export const DEMO_REPORT: Report = {
  id: 'rep_demo',
  createdAt: new Date().toISOString(),
  snapshot: {
    inputUrl: 'https://x.com/greatandhranews/status/1994279726521688528',
    canonicalUrl: 'https://x.com/greatandhranews/status/1994279726521688528',
    platform: 'Twitter/X',
    postType: 'Original Post',
    publishedAt: '2025-11-28T05:38:33.000Z',
    author: {
      name: 'greatandhra',
      handle: 'greatandhranews',
      profileUrl: 'https://x.com/greatandhranews',
      avatarUrl: null,
      verified: true,
      followers: { value: 94669, source: 'public-endpoint' },
      accountType: 'News Outlet',
      declaredLocation: 'Andhra Pradesh',
    },
    content: {
      text: 'ఏపీలో రోజురోజుకు పెరిగిపోతున్న మంత్రుల అరాచకాలు\n\nనిన్న ఓ మంత్రి పీఏ ఓ మహిళను శారీరకంగా వేధించినా పట్టించుకోని ప్రభుత్వం... నేడు స్వయంగా హోం మంత్రిగారే ఓ మహిళ భూములను లాక్కోవడానికి ఎంత ఇబ్బంది పెడుతుందో..',
      title: null,
      languageCode: 'te',
      languageName: 'Telugu',
      translation:
        'The lawlessness of ministers in AP is growing by the day.\n\nYesterday a minister’s PA physically harassed a woman and the government paid no attention. Today the Home Minister herself is putting a woman through hardship to seize her land.',
      transcript: null,
      hashtags: [],
      mentions: [],
      outboundLinks: [],
    },
    engagement: {
      likes: { value: 546, source: 'public-endpoint' },
      comments: { value: 9, source: 'public-endpoint' },
      shares: { value: 165, source: 'public-endpoint' },
      views: { value: 15335, source: 'public-endpoint' },
      engagementRate: 0.0469,
    },
    media: [
      {
        kind: 'video',
        url: 'https://x.com/greatandhranews/status/1994279726521688528',
        thumbnailUrl: null,
        durationSeconds: 399,
        alt: null,
      },
    ],
    extraction: {
      strategy: 'twitter:fxtwitter',
      attempts: [
        {
          strategy: 'twitter:fxtwitter',
          ok: true,
          note: 'likes, replies, retweets, quotes, views, followers',
        },
      ],
      confidence: 'high',
      userAssisted: false,
      fetchedAt: new Date().toISOString(),
    },
  },
  analysis: {
    headline: 'News outlet accuses the Home Minister of seizing a woman’s land',
    summary:
      'A verified regional news account alleges a pattern of ministerial misconduct in Andhra Pradesh, citing two incidents in two days: a minister’s aide accused of harassing a woman, and the Home Minister accused of pressuring a woman over her land. The post frames both as government inaction rather than isolated events.',
    intent:
      'To build a cumulative narrative that ministerial misconduct is escalating and going unpunished, rather than to report a single incident.',
    keyPoints: [
      'Alleges a minister’s personal assistant physically harassed a woman and no action followed.',
      'Alleges Home Minister Vangalapudi Anitha is pressuring a woman to give up her land.',
      'Frames the two incidents as a pattern of "lawlessness" growing day by day.',
      'Attributes the lack of consequence to the government itself, not to individuals.',
    ],
    notableQuotes: [
      {
        original: 'ఏపీలో రోజురోజుకు పెరిగిపోతున్న మంత్రుల అరాచకాలు',
        translation: 'The lawlessness of ministers in AP is growing by the day',
      },
    ],
    sentiment: {
      label: 'Strong Negative',
      score: -78,
      rationale:
        'Uses "అరాచకాలు" (lawlessness) and frames the government as indifferent to two separate allegations.',
      tone: 'Accusatory',
      publicNarrative: 'Resentment',
    },
    emotions: [
      { emotion: 'Anger', weight: 46 },
      { emotion: 'Disgust', weight: 24 },
      { emotion: 'Fear', weight: 18 },
      { emotion: 'Sadness', weight: 12 },
    ],
    topics: {
      primary: 'Corruption',
      subtopic: 'Alleged land grabbing by a sitting minister',
      secondary: ['Law & Order', 'Crime / Injustice'],
      tags: ['land-grabbing', 'ministerial-conduct', 'womens-safety', 'accountability'],
    },
    entities: [
      {
        name: 'Vangalapudi Anitha',
        kind: 'person',
        role: 'Home Minister, Andhra Pradesh',
        stance: 'criticised',
      },
      { name: 'Andhra Pradesh Government', kind: 'organisation', role: null, stance: 'criticised' },
      { name: 'Andhra Pradesh', kind: 'place', role: null, stance: 'mentioned' },
    ],
    reach: {
      scope: 'State-wide',
      estimatedImpressions: 15335,
      amplifiers: ['greatandhra'],
      amplifiedByPoliticalActors: false,
      urbanRural: 'Mixed',
      places: ['Andhra Pradesh', 'Payakaraopeta'],
    },
    credibility: {
      suspectedFalse: 'Unsure',
      fakeNewsType: 'Not Applicable',
      debunkStatus: 'Under Review',
      checkableClaims: [
        {
          claim: 'A minister’s PA physically harassed a woman and no action was taken.',
          why: 'A police complaint would exist and be verifiable through the local station.',
        },
        {
          claim: 'The Home Minister is pressuring a woman over her land.',
          why: 'Land records and any revenue-court filing would be on the public record.',
        },
      ],
      signals: [
        { signal: 'Posted by a verified outlet with 94,669 followers', direction: 'supports' },
        { signal: 'Names a specific minister and a specific location', direction: 'supports' },
        { signal: 'No documents, case number or official source is cited', direction: 'undermines' },
        { signal: 'Two unrelated incidents are framed as one pattern', direction: 'undermines' },
      ],
      notes:
        'The allegations are specific enough to check but carry no supporting documentation in the post itself.',
    },
    civic: {
      isGrievance: true,
      grievanceType: 'Allegation',
      issueDescription:
        'A verified news outlet alleges the Home Minister is coercing a woman over her land, and that an earlier harassment complaint went unaddressed.',
      target: 'Minister',
      severity: 'High',
      riskToGovernment: 'High',
      riskRationale:
        'A named sitting minister, a women’s-safety angle, and a state-wide outlet carrying it. This compounds quickly if it goes unanswered.',
      narrativeCategory: 'Emerging Trend',
      governmentResponse: { status: 'No', respondent: null, adequacy: null },
      suggestedAction:
        'Get the district administration to confirm within 24 hours whether a complaint exists and what stage it is at, then respond with that specific fact rather than a general denial.',
      actionCategory: 'Ground verification',
      actionPriority: 'High',
      talkingPoints: [
        'Every complaint gets looked at the same way, whoever it involves.',
        'The Collector has been asked to report on this case by tomorrow.',
        'If there is a land dispute here, it goes to the revenue court, not to any minister’s office.',
        'Anyone who feels pressured over their land should come to us directly.',
      ],
      suggestedChannels: ['Local press', 'Official X handle'],
      priorityTag: 'Escalate',
      counterNarrative:
        'Answer the specific case with a verifiable fact, such as a complaint number and its status, rather than disputing the framing. A general denial reads as confirmation.',
    },
    observations: [
      'The 3.6% engagement rate is high for this account, so it is travelling further than its usual reach.',
      'Reposts outnumber replies 18:1, which is a spreading pattern rather than a discussion.',
      'A second account posted the same allegation within two hours, suggesting coordinated distribution.',
    ],
    confidence: 'high',
    inferredFields: ['reach.scope', 'reach.estimatedImpressions', 'civic.riskToGovernment'],
  },
  meta: {
    model: 'claude-opus-5',
    durationMs: 18420,
    inputTokens: 2140,
    outputTokens: 1685,
    heuristicOnly: false,
  },
}
