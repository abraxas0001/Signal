/**
 * The provider service.
 *
 * This is the whole integration: it answers the exact contract
 * `netlify/functions/lib/social-source.ts` already speaks, so pointing
 * SOCIAL_PROVIDER_URL at it lights up the sync, the Firestore store, the
 * dashboard and the per-post analysis with no change to the app.
 *
 *   POST /provider
 *   Authorization: Bearer <SOCIAL_PROVIDER_KEY>
 *   { "kind": "posts",    "platform": "Facebook", "handle": "DKAruna.TG" }
 *   { "kind": "comments", "platform": "Facebook", "url": "...", "limit": 100 }
 *
 * TWO FAILURE SHAPES, KEPT APART. The app distinguishes "answered, holds
 * nothing" (200 with an empty array) from "could not answer" (non-200). That
 * distinction is the difference between telling the office a rival posted
 * nothing this week and telling them the session expired. Every path below
 * picks one deliberately.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { newPage, makePacer, goto, closeContext } from './browser'
import { adapters } from './adapters'
import {
  isPlatform,
  type AdapterContext,
  type Platform,
  type ProviderRequest,
  type ScrapedComment,
  type ScrapedPost,
} from './types'

const PORT = Number(process.env['SCRAPER_PORT'] ?? 8787)
const KEY = process.env['SOCIAL_PROVIDER_KEY']?.trim() || null
const QUIET = process.env['SCRAPER_QUIET'] === '1'

const log = (msg: string) => {
  if (!QUIET) console.log(`[scraper] ${msg}`)
}

/* ── cache ───────────────────────────────────────────────────────────────── */

/**
 * A short memory, because the app asks the same question repeatedly.
 *
 * The dashboard's sync walks every tracked handle, and a person pressing
 * "Sync now" twice would otherwise drive two full browser passes over the same
 * profiles — which is both slow and exactly the behaviour that gets a session
 * flagged. Successes only: a failure must be retried, not remembered.
 */
const TTL_MS = Number(process.env['SCRAPER_CACHE_MS'] ?? 15 * 60 * 1000)
const cache = new Map<string, { at: number; value: unknown[] }>()

function cached(key: string): unknown[] | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.value
}

/* ── one job at a time ───────────────────────────────────────────────────── */

/**
 * A single queue across every request.
 *
 * There is one browser and one session. Two profile scrapes in parallel would
 * share a context, interleave navigations, and race each other's pacing — the
 * fastest possible route to a rate limit. Serialising costs wall-clock time
 * and buys the session's survival, which is the scarcer resource.
 */
let chain: Promise<unknown> = Promise.resolve()
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job)
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/* ── the work ────────────────────────────────────────────────────────────── */

async function runPosts(platform: Platform, handle: string, limit: number) {
  const adapter = adapters[platform]
  const page = await newPage(true)
  const ctx: AdapterContext = { page, log, pace: makePacer(platform), limit }

  try {
    await ctx.pace()
    await goto(page, adapter.profileUrl(handle))

    if (await adapter.isLoginWall(ctx)) {
      return {
        ok: false as const,
        reason: `${platform} showed a login wall. Run \`npm run scraper:login\` and sign in.`,
        needsLogin: true,
      }
    }
    return await adapter.posts(ctx, handle)
  } finally {
    await page.close().catch(() => {})
  }
}

async function runComments(platform: Platform, url: string, limit: number) {
  const adapter = adapters[platform]
  if (!adapter.comments) {
    // Answered honestly: this adapter does not do comments, so the app should
    // fall through to its own public reader rather than treat this as an
    // outage. An empty 200 is the contract's way of saying that.
    return { ok: true as const, items: [] as ScrapedComment[], note: 'no comment adapter' }
  }
  const page = await newPage(true)
  const ctx: AdapterContext = { page, log, pace: makePacer(platform), limit }
  try {
    await ctx.pace()
    await goto(page, url)
    if (await adapter.isLoginWall(ctx)) {
      return {
        ok: false as const,
        reason: `${platform} showed a login wall.`,
        needsLogin: true,
      }
    }
    return await adapter.comments(ctx, url)
  } finally {
    await page.close().catch(() => {})
  }
}

/* ── http ────────────────────────────────────────────────────────────────── */

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(json),
  })
  res.end(json)
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

const server = createServer((req, res) => {
  void (async () => {
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { ok: true, platforms: Object.keys(adapters), cached: cache.size })
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })

    // Auth, when a key is configured. Unset means local-only and open, which
    // is the normal case: the service binds to localhost.
    if (KEY) {
      const auth = req.headers['authorization']
      if (auth !== `Bearer ${KEY}`) return send(res, 401, { error: 'bad key' })
    }

    const body = (await readBody(req)) as ProviderRequest | null
    if (!body || typeof body !== 'object') return send(res, 400, { error: 'bad json' })

    const { kind, platform, handle, url } = body
    const limit = typeof body.limit === 'number' ? Math.min(body.limit, 60) : 25

    if (!isPlatform(platform)) {
      // Not an outage: this service only covers the gated four, and the app
      // has its own free readers for everything else.
      return send(res, 200, kind === 'comments' ? { comments: [] } : { posts: [] })
    }

    try {
      if (kind === 'posts') {
        if (!handle) return send(res, 400, { error: 'handle required' })
        const key = `posts:${platform}:${handle}:${limit}`
        const hit = cached(key)
        if (hit) {
          log(`cache hit ${key}`)
          return send(res, 200, { posts: hit as ScrapedPost[], note: 'cached' })
        }

        log(`posts ${platform} @${handle}`)
        const out = await enqueue(() => runPosts(platform, handle, limit))
        if (!out.ok) return send(res, 502, { error: out.reason, needsLogin: out.needsLogin === true })

        cache.set(key, { at: Date.now(), value: out.items })
        log(`posts ${platform} @${handle} -> ${out.items.length}`)
        return send(res, 200, { posts: out.items, ...(out.note ? { note: out.note } : {}) })
      }

      if (kind === 'comments') {
        if (!url) return send(res, 400, { error: 'url required' })
        const key = `comments:${platform}:${url}:${limit}`
        const hit = cached(key)
        if (hit) return send(res, 200, { comments: hit as ScrapedComment[], note: 'cached' })

        log(`comments ${platform} ${url}`)
        const out = await enqueue(() => runComments(platform, url, limit))
        if (!out.ok) return send(res, 502, { error: out.reason, needsLogin: out.needsLogin === true })

        cache.set(key, { at: Date.now(), value: out.items })
        return send(res, 200, { comments: out.items, ...(out.note ? { note: out.note } : {}) })
      }

      return send(res, 400, { error: `unknown kind ${String(kind)}` })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      log(`FAILED: ${reason}`)
      // 502, never an empty 200: this is "could not answer".
      return send(res, 502, { error: reason })
    }
  })()
})

/**
 * A port collision is the commonest way to start this service twice, and
 * Node's default is an unhandled 'error' event and a stack trace about
 * EADDRINUSE — which says nothing about what to do. Almost always the answer
 * is "it is already running", so say that.
 */
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[scraper] port ${PORT} is already in use — the service is probably already running.\n` +
        `[scraper] Check http://127.0.0.1:${PORT}/health, or set SCRAPER_PORT to use another port.`,
    )
    process.exit(1)
  }
  throw err
})

server.listen(PORT, '127.0.0.1', () => {
  log(`listening on http://127.0.0.1:${PORT}/provider`)
  log(`auth: ${KEY ? 'bearer key required' : 'open (localhost only)'}`)
  log(`platforms: ${Object.keys(adapters).join(', ')}`)
})

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void closeContext().then(() => process.exit(0))
  })
}
