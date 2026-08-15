import type { Config, Context } from '@netlify/functions'

/**
 * GET /api/fbprobe?code=<share code> — a temporary diagnostic.
 *
 * A Facebook /share/p/<code>/ link resolves to the full post from a residential
 * connection and to a ~416KB placeholder from this server, and that difference
 * cannot be reproduced on a developer machine: every local attempt succeeds and
 * proves nothing. The canonical /<page>/posts/<story> form works from here, so
 * the only missing step is turning the share code into those two ids without
 * relying on a page this network does not receive.
 *
 * This runs the candidate routes from the network that actually fails and
 * reports what each returns. It is a measuring instrument, not a feature, and
 * should be deleted once the answer is known.
 *
 * Deliberately narrow: the code is validated against a strict character class
 * and every URL is built here against a fixed host list, so no user input ever
 * reaches the fetcher as a URL.
 */

const SHARE_CODE = /^[A-Za-z0-9]{4,32}$/

const UAS: Record<string, string> = {
  google: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  mobile:
    'Mozilla/5.0 (Linux; Android 12; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  none: '',
}

interface Probe {
  name: string
  url: (code: string) => string
  ua: keyof typeof UAS
  method?: 'GET' | 'HEAD'
  manual?: boolean
}

const PROBES: Probe[] = [
  // Redirects first: a Location header is issued before any page is rendered,
  // so it is the likeliest thing to survive a network Meta treats differently.
  { name: 'www manual-redirect (chrome)', url: (c) => `https://www.facebook.com/share/p/${c}/`, ua: 'chrome', manual: true },
  { name: 'www manual-redirect (google)', url: (c) => `https://www.facebook.com/share/p/${c}/`, ua: 'google', manual: true },
  { name: 'www manual-redirect (no UA)', url: (c) => `https://www.facebook.com/share/p/${c}/`, ua: 'none', manual: true },
  { name: 'www HEAD (chrome)', url: (c) => `https://www.facebook.com/share/p/${c}/`, ua: 'chrome', method: 'HEAD', manual: true },
  { name: 'm manual-redirect (mobile)', url: (c) => `https://m.facebook.com/share/p/${c}/`, ua: 'mobile', manual: true },
  { name: 'mbasic manual-redirect (mobile)', url: (c) => `https://mbasic.facebook.com/share/p/${c}/`, ua: 'mobile', manual: true },
  { name: 'web manual-redirect (chrome)', url: (c) => `https://web.facebook.com/share/p/${c}/`, ua: 'chrome', manual: true },
  { name: 'www ?_rdr manual (chrome)', url: (c) => `https://www.facebook.com/share/p/${c}/?_rdr`, ua: 'chrome', manual: true },

  // Then the followed forms, to see what body we actually land on.
  { name: 'mbasic followed (mobile)', url: (c) => `https://mbasic.facebook.com/share/p/${c}/`, ua: 'mobile' },
  { name: 'm followed (mobile)', url: (c) => `https://m.facebook.com/share/p/${c}/`, ua: 'mobile' },
  { name: 'www followed (google)', url: (c) => `https://www.facebook.com/share/p/${c}/`, ua: 'google' },
]

/** Everything worth knowing, pulled out of a response. */
function inspect(body: string, finalUrl: string, location: string | null) {
  const hay = `${finalUrl}\n${location ?? ''}\n${body}`
  const grab = (re: RegExp) => re.exec(hay)?.[1] ?? null
  return {
    storyFbid: grab(/[?&;]story_fbid=(\d{6,})/) ?? grab(/"story_fbid":"?(\d{6,})/),
    pageId: grab(/[?&;]id=(\d{6,})/) ?? grab(/"page_id":"?(\d{6,})/),
    permalink: grab(/facebook\.com\/([A-Za-z0-9.]{3,})\/posts\/(\d{8,})/),
    postId: grab(/facebook\.com\/[A-Za-z0-9.]{3,}\/posts\/(?:[^/"?]*?)(\d{10,})/),
    ogUrl: grab(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/),
    ogTitle: grab(/<meta[^>]+property="og:title"[^>]+content="([^"]{0,80})"/),
    hasPayload: /"reaction_count"|"subscription_target_id"/.test(body),
  }
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  const code = new URL(req.url).searchParams.get('code') ?? ''
  if (!SHARE_CODE.test(code)) {
    return Response.json({ error: 'code must be 4-32 alphanumeric characters' }, { status: 400 })
  }

  const started = Date.now()
  const results = []

  for (const probe of PROBES) {
    const t = Date.now()
    try {
      const headers: Record<string, string> = { 'Accept-Language': 'en-US,en;q=0.9' }
      const ua = UAS[probe.ua]
      if (ua) headers['User-Agent'] = ua

      const res = await fetch(probe.url(code), {
        method: probe.method ?? 'GET',
        headers,
        redirect: probe.manual ? 'manual' : 'follow',
        signal: AbortSignal.timeout(9000),
      })
      const location = res.headers.get('location')
      const body = probe.method === 'HEAD' ? '' : await res.text()

      results.push({
        probe: probe.name,
        status: res.status,
        ms: Date.now() - t,
        kb: Math.round(body.length / 1024),
        location,
        finalUrl: res.url === probe.url(code) ? null : res.url,
        found: inspect(body, res.url, location),
      })
    } catch (err) {
      results.push({
        probe: probe.name,
        ms: Date.now() - t,
        threw: err instanceof Error ? err.message : String(err),
      })
    }
  }

  let egress: unknown = null
  try {
    egress = await (await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) })).json()
  } catch {
    /* not essential */
  }

  return Response.json(
    { code, egress, totalMs: Date.now() - started, results },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export const config: Config = {
  path: '/api/fbprobe',
  rateLimit: { windowLimit: 6, windowSize: 120, aggregateBy: ['ip'] },
}
