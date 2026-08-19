import type { Config, Context } from '@netlify/functions'
import { extractPost } from './lib/extract/index'
import { resolveProviders } from './lib/provider'
import { metaCredentials, whoAmI, facebookPagePosts, instagramMedia } from './lib/meta-graph'
import { listConnections } from './lib/connections'

/**
 * GET /api/diag — what actually happens from the deployed server.
 *
 * Every extraction method in this product was validated from a residential
 * connection in India. The functions run on AWS, and the platforms that matter
 * most here treat those two networks completely differently: YouTube answers a
 * datacentre IP with "Sign in to confirm you're not a bot", and Meta's
 * behaviour varies by endpoint and by hour.
 *
 * Reproducing that locally is not possible, and reasoning about it from proxies
 * produced a wrong answer once already. So this runs the real adapters from the
 * real environment and reports what came back, per platform, with the attempt
 * log that names which leg failed.
 *
 * Deliberately narrow: it accepts no user input, only fetches a fixed set of
 * public posts, and returns no secrets — only whether a key is present.
 */

/** Fixed, public, and chosen to exercise a different mechanism each. */
const PROBES = [
  { platform: 'YouTube', url: 'https://youtu.be/_hFUH1dUp1g', why: 'watch page, then InnerTube' },
  { platform: 'Instagram', url: 'https://www.instagram.com/reel/DYcPX8gzk9I/', why: 'embed + og page' },
  { platform: 'Facebook', url: 'https://www.facebook.com/share/p/17Tdmz2JiY/', why: 'crawler UA + Relay payload' },
  { platform: 'X', url: 'https://x.com/greatandhranews/status/1994279726521688528', why: 'public syndication' },
  { platform: 'Bluesky', url: 'https://bsky.app/profile/bsky.app/post/3msqpusnigc2t', why: 'documented public API' },
] as const

export default async (_req: Request, _ctx: Context): Promise<Response> => {
  const started = Date.now()

  // The single most useful fact: which network the platforms actually see.
  let egress: unknown = null
  try {
    const r = await fetch('https://api.ipify.org?format=json', {
      signal: AbortSignal.timeout(5000),
    })
    egress = await r.json()
  } catch {
    egress = { error: 'could not determine egress IP' }
  }

  const results = []
  for (const probe of PROBES) {
    const t = Date.now()
    try {
      const { snapshot } = await extractPost(probe.url, { keys: {} })
      const e = snapshot.engagement
      results.push({
        platform: probe.platform,
        mechanism: probe.why,
        ok: snapshot.extraction.attempts.some((a) => a.ok),
        ms: Date.now() - t,
        confidence: snapshot.extraction.confidence,
        author: snapshot.author.name,
        likes: e.likes.value,
        comments: e.comments.value,
        views: e.views.value,
        textChars: (snapshot.content.text ?? '').length,
        // The whole point: which leg failed, and what the platform said.
        attempts: snapshot.extraction.attempts,
        blocked: snapshot.extraction.blocked?.reason ?? null,
      })
    } catch (err) {
      results.push({
        platform: probe.platform,
        mechanism: probe.why,
        ok: false,
        ms: Date.now() - t,
        threw: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Whether the Meta page token works, and what it can actually see. An
  // operator pasting a token needs to know it took effect before they trust a
  // number that came through it — and a token that has silently expired looks
  // identical to no token at all from the outside.
  let meta: Record<string, unknown> = { configured: false }
  const creds = metaCredentials()
  if (creds) {
    meta = { configured: true, instagramLinked: Boolean(creds.igUserId) }
    try {
      const me = await whoAmI(creds)
      const [posts, media] = await Promise.all([
        facebookPagePosts(creds).catch(() => []),
        instagramMedia(creds).catch(() => []),
      ])
      meta = {
        ...meta,
        page: me.name,
        pageId: me.id,
        followers: me.followers,
        facebookPosts: posts.length,
        instagramPosts: media.length,
        // Proof the API gives what scraping cannot.
        sharesAvailable: posts.some((p) => p.shares != null),
        reelPlaysAvailable: [...posts, ...media].some((p) => p.views != null),
      }
    } catch (err) {
      meta = { ...meta, working: false, why: err instanceof Error ? err.message : String(err) }
    }
  }

  const providers = resolveProviders()

  // Office-owned OAuth connections. Status only, from listConnections() —
  // never a token, matching this endpoint's own stated purpose.
  const connections = await listConnections().catch(() => [])

  return Response.json(
    {
      egress,
      node: process.version,
      // Presence only. Never the value.
      model: {
        configured: providers.map((p) => `${p.label} (${p.model})`),
        pinned: process.env['LLM_PROVIDER'] ?? null,
      },
      crawlerUaAllowed: process.env['ALLOW_CRAWLER_UA'] !== 'false',
      meta,
      connections,
      // The deadline the running function is actually using. Netlify injects
      // environment variables at deploy time, so a dashboard change that has
      // not been redeployed reads correctly in the UI and does nothing here —
      // which cost a round of "I changed it" versus "it fired at the old
      // value". Reporting the effective number ends that argument.
      analysisDeadlineMs: (() => {
        const raw = Number(process.env['ANALYSIS_DEADLINE_MS'])
        return Number.isFinite(raw) && raw >= 8_000 && raw <= 60_000 ? raw : 40_000
      })(),
      totalMs: Date.now() - started,
      results,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export const config: Config = {
  path: '/api/diag',
  // Five live extractions; the default 10s is nowhere near enough.
  rateLimit: { windowLimit: 4, windowSize: 120, aggregateBy: ['ip'] },
}
