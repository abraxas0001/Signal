/**
 * Does the configured model actually work?
 *
 * Getting a key is the fiddly part of setting this up, and the failure modes
 * all look alike from the interface: a key that was never activated, a key
 * pasted with a stray space, a model name the provider does not offer, a free
 * tier already at its daily cap. This runs one real analysis and says which of
 * those it is.
 *
 *   npm run test:model
 *   GROQ_API_KEY=gsk_... npm run test:model
 */

import { resolveProviders, PROVIDER_ENV_VARS } from '../netlify/functions/lib/provider'
import { analysePost } from '../netlify/functions/lib/analyse'
import type { PostSnapshot } from '../shared/types'

const G = '\x1b[32m'
const R = '\x1b[31m'
const Y = '\x1b[33m'
const D = '\x1b[2m'
const B = '\x1b[1m'
const O = '\x1b[0m'

const providers = resolveProviders()
const provider = providers[0]

if (!provider) {
  console.log(`\n${Y}No model is configured.${O}`)
  console.log(`${D}The app still runs — it fetches posts and reports every figure the`)
  console.log(`platform publishes. What is switched off is interpretation.${O}\n`)
  console.log('Set one of these in .env (or Netlify → Environment variables):\n')
  for (const v of PROVIDER_ENV_VARS) console.log(`  ${v}`)
  console.log(`\n${D}Free, no card, and does not train on your input: GROQ_API_KEY`)
  console.log(`Get one at https://console.groq.com — sign in, verify email, then API Keys.${O}\n`)
  process.exit(1)
}

console.log(`\n${B}Provider${O}  ${provider.label}`)
console.log(`${B}Model${O}     ${provider.model}`)
console.log(
  `${B}Privacy${O}   ${
    provider.privateByDefault
      ? `${G}does not train on your input${O}`
      : `${Y}may use your input to improve its models — check before sending real grievances${O}`
  }`,
)

/** A short Telugu civic post — the exact shape this product exists to read. */
const sample: PostSnapshot = {
  inputUrl: 'https://example.test/post',
  canonicalUrl: 'https://example.test/post',
  platform: 'Twitter/X',
  postType: 'Original Post',
  publishedAt: new Date('2026-01-15T09:00:00Z').toISOString(),
  author: {
    name: 'Test Citizen',
    handle: 'testcitizen',
    profileUrl: null,
    avatarUrl: null,
    verified: false,
    followers: { value: 4200, source: 'public-endpoint' },
    accountType: 'Individual',
    declaredLocation: 'Eluru',
  },
  content: {
    text: 'ఏలూరు మున్సిపాలిటీలో మూడు నెలలుగా చెత్త తీయడం లేదు. అధికారులు స్పందించడం లేదు. ప్రజలు అనారోగ్యం పాలవుతున్నారు.',
    title: null,
    languageCode: 'te',
    languageName: null,
    translation: null,
    transcript: null,
    hashtags: ['Eluru'],
    mentions: [],
    outboundLinks: [],
  },
  engagement: {
    likes: { value: 340, source: 'public-endpoint' },
    comments: { value: 52, source: 'public-endpoint' },
    shares: { value: 88, source: 'public-endpoint' },
    views: { value: 12400, source: 'public-endpoint' },
    engagementRate: null,
  },
  media: [],
  extraction: {
    strategy: 'test',
    attempts: [],
    confidence: 'high',
    userAssisted: false,
    fetchedAt: new Date().toISOString(),
  },
}

console.log(`\n${D}Analysing a sample Telugu grievance post…${O}`)
const started = Date.now()

try {
  const out = await analysePost(sample, {}, {
    providers,
    onSection: (s) => process.stdout.write(`${D}·${s}${O} `),
    onProviderSwitch: (from, to, reason) =>
      console.log(`
${Y}${from.label} failed${O} ${D}(${reason.slice(0, 90)})${O}
${D}falling back to ${to.label}…${O}`),
  })
  const ms = Date.now() - started
  const a = out.analysis

  console.log(`\n\n${G}${B}WORKS${O}  ${D}${(ms / 1000).toFixed(1)}s · answered by ${out.provider}${O}`)
  if (out.failedOver) {
    console.log(`${Y}Failed over from ${out.failedOver.from}${O} ${D}${out.failedOver.reason}${O}`)
  }
  if (out.inputTokens) console.log(`${D}tokens: ${out.inputTokens} in / ${out.outputTokens} out${O}`)

  console.log(`\n${B}What it produced${O}`)
  console.log(`  headline   ${a.headline}`)
  console.log(`  summary    ${a.summary.slice(0, 100)}${a.summary.length > 100 ? '…' : ''}`)
  console.log(`  sentiment  ${a.sentiment.label} (${a.sentiment.score})`)
  console.log(`  topic      ${a.topics.primary}`)
  console.log(
    `  civic      ${
      a.civic
        ? `${a.civic.grievanceType ?? '?'} · severity ${a.civic.severity ?? '?'} · risk ${a.civic.riskToGovernment ?? '?'} · ${a.civic.actionCategory ?? '?'} (${a.civic.actionPriority ?? '?'})`
        : 'not civic'
    }`,
  )
  if (a.civic) {
    console.log(`  action     ${a.civic.suggestedAction || '(none)'}`)
    console.log(`  talking    ${a.civic.talkingPoints.length} point(s)`)
  }
  console.log(`  emotions   ${a.emotions.map((e) => `${e.emotion} ${e.weight}%`).join(', ') || '(none)'}`)
  console.log(`  entities   ${a.entities.map((e) => e.name).join(', ') || '(none)'}`)
  console.log(`  quotes     ${a.notableQuotes.length}`)

  // Any enum the model left empty would render as a blank chip or crash a
  // pips scale, so name them here rather than letting the interface find out.
  const missing = a.civic
    ? (['grievanceType', 'severity', 'riskToGovernment', 'actionCategory', 'actionPriority'] as const).filter(
        (k) => !a.civic![k],
      )
    : []
  if (missing.length) {
    console.log(`
${Y}Model omitted: ${missing.join(', ')}${O}`)
  }
  // normalise() writes the detected language and translation back onto the
  // snapshot, not onto the analysis, so read it from there.
  console.log(`  language   ${sample.content.languageName ?? '?'} (${sample.content.languageCode ?? '?'})`)
  console.log(
    `  translated ${
      sample.content.translation
        ? sample.content.translation.slice(0, 110) + (sample.content.translation.length > 110 ? '…' : '')
        : `${Y}EMPTY — bilingual output is a requirement, so this is a failure${O}`
    }`,
  )

  // The one check worth making automatically: a model that silently ignores the
  // Telugu and answers in generalities is worse than one that fails outright.
  const thin = a.summary.length < 40 || a.headline.length < 15
  if (thin) {
    console.log(
      `\n${Y}The output is unusually thin.${O} ${D}This model may be struggling with Telugu or with a schema this large. Try a larger one via LLM_MODEL.${O}`,
    )
  }
  console.log('')
} catch (err) {
  console.log(`\n\n${R}${B}FAILED${O}`)
  console.log(`  ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
}
