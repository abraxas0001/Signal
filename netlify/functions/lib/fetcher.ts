import { isIP } from 'node:net'
import type { LookupAddress, LookupOptions } from 'node:dns'
import { Agent } from 'undici'
import { resolvePublicTarget, BlockedAddressError } from './ssrf'

/**
 * Identities we present when fetching. Many sites (Facebook, news paywalls)
 * serve OpenGraph tags to crawlers but a JS shell or login wall to browsers,
 * so trying more than one identity materially changes what we get back.
 */
export const AGENTS = {
  browser:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  twitter: 'Twitterbot/1.0',
  google: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  // A second, independently-operated crawler identity. Threads gates its
  // embedded post JSON on being a search crawler, so when Googlebot is refused
  // this is a genuine failover rather than the same request twice.
  bing: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  whatsapp: 'WhatsApp/2.23.20.0',
} as const

export type AgentName = keyof typeof AGENTS

/**
 * Whether we may present a search-crawler identity we do not have.
 *
 * Facebook, Instagram and Threads serve their data to crawlers but not to
 * browsers, so this switch is the difference between reading engagement counts
 * and asking the user to type them in. It is also the most legally exposed
 * thing in this codebase — see README, "Scraping and terms of service".
 *
 * One flag, read in one place, so it cannot be honoured by some adapters and
 * quietly ignored by others.
 */
export const ALLOW_CRAWLER_UA = process.env['ALLOW_CRAWLER_UA'] !== 'false'

const MAX_BYTES = 5_000_000 // 5 MB — plenty for HTML, guards against a stream bomb
const DEFAULT_TIMEOUT = 9_000
const MAX_REDIRECTS = 5

export { BlockedAddressError }

/**
 * A DNS lookup that only ever answers with addresses we already validated.
 *
 * Without this there is a window between "we checked the name" and "the socket
 * connects" in which a hostile DNS server can answer differently — the DNS
 * rebinding attack. Pinning closes it: the connection can only go where the
 * check said it could.
 *
 * Ordering matters as much as pinning. Most large hosts are dual-stack, and
 * when the resolver answers with the AAAA first, handing back only that address
 * strands the request on a network with no working IPv6 route — the socket
 * hangs until the timeout even though a perfectly reachable A record was in the
 * same answer. That is not hypothetical: it made Bluesky fail intermittently
 * from a v4-only connection while curl succeeded every time. So return every
 * validated address, ordered v4-first, and let Happy Eyeballs race them.
 */
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void

function pinnedLookup(addresses: string[]) {
  const results: LookupAddress[] = addresses
    .map((address) => ({ address, family: isIP(address) || 4 }))
    // v4 first: it is the family more likely to be routable from a datacentre
    // or a consumer ISP, and it is what a single-address caller will get.
    .sort((a, b) => a.family - b.family)

  return (_hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    if (!results.length) {
      callback(new Error('No validated address for this host') as NodeJS.ErrnoException, '')
      return
    }

    if (options?.all) {
      callback(null, results)
      return
    }
    const first = results[0] as LookupAddress
    callback(null, first.address, first.family)
  }
}

interface GuardedResponse {
  res: Response
  finalUrl: string
}

/**
 * Fetch with the SSRF boundary applied at every hop.
 *
 * Redirects are followed manually rather than by the runtime, because the
 * runtime will happily follow a public URL to a private one — a 302 to
 * http://169.254.169.254/ is the standard way past a naive front-door check.
 */
async function guardedFetch(
  startUrl: string,
  initial: RequestInit,
  timeout: number,
): Promise<GuardedResponse> {
  let current = startUrl
  let init = initial

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = await resolvePublicTarget(current)

    const agent = new Agent({
      connect: {
        lookup: pinnedLookup(target.addresses),
        // Happy Eyeballs (RFC 8305): open sockets to both families and keep
        // whichever answers first, instead of committing to one and waiting out
        // the timeout if that family has no route. Every address offered here
        // has already cleared the SSRF check, so racing them is safe.
        autoSelectFamily: true,
        autoSelectFamilyAttemptTimeout: 750,
      },
      headersTimeout: timeout,
      bodyTimeout: timeout,
    })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
      const res = await fetch(current, {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
        // `dispatcher` is undici's extension to fetch init; Node's global fetch
        // honours it, but the DOM RequestInit type does not describe it.
        ...({ dispatcher: agent } as Record<string, unknown>),
      })

      const location = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && location) {
        // Resolve relative Location values against the current URL, then loop
        // so the next hop is validated exactly like the first.
        current = new URL(location, current).toString()
        // Browsers turn a redirected POST into a GET on 301/302/303 and drop
        // the body. Match that: re-POSTing a body to a host we did not choose
        // is how a redirect turns one request into an unintended write.
        if (init.method === 'POST' && res.status !== 307 && res.status !== 308) {
          init = { ...init, method: 'GET', body: undefined }
        }
        continue
      }

      return { res, finalUrl: current }
    } finally {
      clearTimeout(timer)
      void agent.close().catch(() => {})
    }
  }

  throw new Error('That link redirected too many times.')
}

export interface FetchTextResult {
  ok: boolean
  status: number
  url: string
  /** Decoded body, honouring the charset the server or the markup declared. */
  body: string
  contentType: string
  /** Which User-Agent produced this response. */
  agent: AgentName
  /** Set when the SSRF boundary refused the URL, so callers can explain why. */
  blockedReason?: string
}

/**
 * Decode a response body using the correct charset.
 *
 * Node's `res.text()` assumes UTF-8. Indian regional news sites still serve
 * windows-1252 and ISO-8859-1, and getting this wrong turns Telugu into
 * mojibake that then poisons the model's translation. So: read bytes, work out
 * the charset from the header or a meta tag, then decode deliberately.
 */
/**
 * Read a body, stopping once it exceeds the cap.
 *
 * Trusting Content-Length is not enough: it is set by the peer and simply
 * absent on any chunked response, so a hostile or broken server can stream
 * unbounded data into the function's memory. This counts the bytes we have
 * actually received and gives up when they exceed the ceiling.
 */
async function readCapped(res: Response, limit: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0)

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    chunks.push(value)
    if (total > limit) {
      await reader.cancel().catch(() => {})
      break
    }
  }

  return Buffer.concat(chunks, Math.min(total, limit))
}

async function decodeBody(res: Response): Promise<{ text: string; contentType: string }> {
  const contentType = res.headers.get('content-type') ?? ''
  const buf = await readCapped(res, MAX_BYTES)

  let charset = /charset=["']?([^;"'\s]+)/i.exec(contentType)?.[1]?.toLowerCase()

  if (!charset) {
    // Sniff the first 2 KB as Latin-1 to find a <meta charset> without
    // committing to a decoding yet.
    const head = buf.subarray(0, 2048).toString('latin1')
    charset =
      /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase() ??
      /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head)?.[1]?.toLowerCase()
  }

  const normalised = (charset ?? 'utf-8').replace(/^utf8$/, 'utf-8')
  try {
    return { text: new TextDecoder(normalised).decode(buf), contentType }
  } catch {
    // Unknown label — UTF-8 is the safest guess for anything modern.
    return { text: buf.toString('utf-8'), contentType }
  }
}

export async function fetchText(
  url: string,
  opts: { agent?: AgentName; timeout?: number; headers?: Record<string, string> } = {},
): Promise<FetchTextResult> {
  const agent = opts.agent ?? 'browser'

  try {
    const { res, finalUrl } = await guardedFetch(
      url,
      {
        headers: {
          'User-Agent': AGENTS[agent],
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,te;q=0.8,hi;q=0.7',
          'Cache-Control': 'no-cache',
          ...opts.headers,
        },
      },
      opts.timeout ?? DEFAULT_TIMEOUT,
    )

    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_BYTES) {
      return { ok: false, status: 413, url: finalUrl, body: '', contentType: '', agent }
    }

    const { text, contentType } = await decodeBody(res)
    return {
      ok: res.ok,
      status: res.status,
      url: finalUrl,
      body: text.slice(0, MAX_BYTES),
      contentType,
      agent,
    }
  } catch (err) {
    if (err instanceof BlockedAddressError) {
      return { ok: false, status: 403, url, body: '', contentType: '', agent, blockedReason: err.message }
    }
    const aborted = err instanceof Error && err.name === 'AbortError'
    return { ok: false, status: aborted ? 408 : 0, url, body: '', contentType: '', agent }
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: {
    agent?: AgentName
    timeout?: number
    headers?: Record<string, string>
    /** Send a POST with this JSON body. Used for YouTube's InnerTube endpoint. */
    json?: unknown
  } = {},
): Promise<{ ok: boolean; status: number; data: T | null; blockedReason?: string }> {
  try {
    const { res } = await guardedFetch(
      url,
      {
        ...(opts.json === undefined
          ? {}
          : { method: 'POST', body: JSON.stringify(opts.json) }),
        headers: {
          'User-Agent': AGENTS[opts.agent ?? 'browser'],
          Accept: 'application/json,text/plain,*/*',
          ...(opts.json === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...opts.headers,
        },
      },
      opts.timeout ?? DEFAULT_TIMEOUT,
    )

    const raw = await res.text()
    if (!raw) return { ok: false, status: res.status, data: null }
    try {
      return { ok: res.ok, status: res.status, data: JSON.parse(raw) as T }
    } catch {
      // Several of these endpoints answer a dead id with an HTML error page.
      return { ok: false, status: res.status, data: null }
    }
  } catch (err) {
    if (err instanceof BlockedAddressError) {
      return { ok: false, status: 403, data: null, blockedReason: err.message }
    }
    return { ok: false, status: 0, data: null }
  }
}

/**
 * Try a sequence of identities until one returns something usable.
 * `accept` decides what "usable" means — for Facebook that is "contains an
 * og:title", not merely "HTTP 200", because the login wall is a 200.
 */
export async function fetchWithAgents(
  url: string,
  agents: AgentName[],
  accept: (r: FetchTextResult) => boolean,
): Promise<FetchTextResult | null> {
  let last: FetchTextResult | null = null
  for (const agent of agents) {
    const res = await fetchText(url, { agent })
    last = res
    if (res.ok && accept(res)) return res
    // A blocked address will not become unblocked with a different UA.
    if (res.blockedReason) return res
  }
  return last
}
