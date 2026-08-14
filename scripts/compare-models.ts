/**
 * The same posts through every configured model, side by side.
 *
 * Choosing a provider is not a spec-sheet decision. Free tiers differ far more
 * in how well they read Telugu and how completely they fill the schema than in
 * their advertised limits, and the only way to see that is to run real posts
 * through each and read the output.
 *
 *   npx tsx scripts/compare-models.ts
 *
 * Uses whichever keys are present. Fetches each post once and reuses the
 * snapshot, so every model sees byte-identical input.
 */

import { extractPost } from '../netlify/functions/lib/extract/index'
import { analysePost } from '../netlify/functions/lib/analyse'
import type { Provider } from '../netlify/functions/lib/provider'
import type { Analysis, PostSnapshot } from '../shared/types'

const G = '\x1b[32m'
const Y = '\x1b[33m'
const D = '\x1b[2m'
const B = '\x1b[1m'
const O = '\x1b[0m'

/** Every provider with a key present, not just the one that would win. */
function configured(): Provider[] {
  const out: Provider[] = []
  const add = (
    env: string,
    label: string,
    model: string,
    baseUrl: string | undefined,
    maxTokens: number,
    privateByDefault: boolean,
  ) => {
    const apiKey = process.env[env]?.trim()
    if (!apiKey) return
    out.push({
      kind: baseUrl ? 'openai-compat' : 'anthropic',
      label,
      model,
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      privateByDefault,
      maxTokens,
    })
  }
  add('ANTHROPIC_API_KEY', 'Claude', 'claude-opus-5', undefined, 16000, true)
  add('GROQ_API_KEY', 'Groq', 'llama-3.3-70b-versatile', 'https://api.groq.com/openai/v1', 4096, true)
  add('CEREBRAS_API_KEY', 'Cerebras', 'llama-3.3-70b', 'https://api.cerebras.ai/v1', 4096, false)
  add('GEMINI_API_KEY', 'Gemini', 'gemini-2.5-flash', 'https://generativelanguage.googleapis.com/v1beta/openai', 8192, false)
  return out
}

const providers = configured()
if (providers.length < 2) {
  console.log(`\n${Y}Only ${providers.length} provider configured — nothing to compare.${O}\n`)
  process.exit(0)
}

/** Real posts from the client workbook, spanning praise and grievance. */
const URLS = [
  'https://www.facebook.com/share/p/17Tdmz2JiY/',
  'https://x.com/greatandhranews/status/1994279726521688528',
]

console.log(`\n${B}Comparing:${O} ${providers.map((p) => `${p.label} (${p.model})`).join('  ·  ')}\n`)

for (const url of URLS) {
  console.log(`${B}${'─'.repeat(76)}${O}`)
  const { snapshot, extra } = await extractPost(url, { keys: {} })
  const text = (snapshot.content.text ?? '').replace(/\s+/g, ' ').slice(0, 70)
  console.log(`${B}${snapshot.platform}${O} ${D}${text}…${O}\n`)

  for (const provider of providers) {
    // Each model gets its own copy: normalise() writes language and translation
    // back onto the snapshot, so a shared object would let one model's output
    // leak into the next one's input.
    const fresh: PostSnapshot = JSON.parse(JSON.stringify(snapshot))
    const started = Date.now()
    try {
      const { analysis: a, inputTokens, outputTokens } = await analysePost(fresh, extra, { providers: [provider] })
      report(provider, a, fresh, Date.now() - started, inputTokens, outputTokens)
    } catch (err) {
      console.log(`  ${B}${provider.label.padEnd(9)}${O} ${Y}failed${O} — ${err instanceof Error ? err.message : err}`)
    }
    console.log('')
  }
}

function report(
  p: Provider,
  a: Analysis,
  snap: PostSnapshot,
  ms: number,
  inTok?: number,
  outTok?: number,
) {
  console.log(
    `  ${B}${p.label.padEnd(9)}${O} ${G}${(ms / 1000).toFixed(1)}s${O}` +
      `${inTok ? ` ${D}${inTok}→${outTok} tok${O}` : ''}`,
  )
  console.log(`    headline   ${a.headline}`)
  console.log(`    sentiment  ${a.sentiment.label} (${a.sentiment.score}) · ${a.sentiment.tone}`)
  console.log(`    topic      ${a.topics.primary}`)
  if (a.civic) {
    console.log(
      `    civic      ${a.civic.grievanceType} · sev ${a.civic.severity} · risk ${a.civic.riskToGovernment} · ${a.civic.actionPriority}`,
    )
  }
  // Depth is the thing that actually separates these models: a thin answer is
  // still schema-valid, so counting what came back is the honest measure.
  console.log(
    `    depth      ${a.keyPoints.length} points · ${a.notableQuotes.length} quotes · ${a.entities.length} entities · ${a.emotions.length} emotions · ${a.civic?.talkingPoints.length ?? 0} talking`,
  )
  const tr = snap.content.translation
  console.log(`    translated ${tr ? `${tr.slice(0, 88)}${tr.length > 88 ? '…' : ''}` : `${Y}none${O}`}`)
}
