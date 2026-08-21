import type { Config, Context } from '@netlify/functions'
import { searchYouTubeChannels } from './lib/influencers'
import { readHandle } from './lib/handles'

/**
 * Accounts matching a name, on the platforms that will answer a search.
 *
 *   GET /api/accounts/search?q=d+k+aruna
 *
 * The account box already resolves a person through /api/identity, which
 * returns whatever Wikidata and the profile pages record. That is the right
 * primary source — somebody stated those handles — but its coverage of Indian
 * politicians below national level is thin, and a person who resolves with one
 * Facebook page and nothing else reads on screen as somebody who is only on
 * Facebook. They are usually not; nobody has filled Wikidata in.
 *
 * So this exists to say what a search index actually returns, and it covers
 * exactly ONE platform, because exactly one will answer:
 *
 *   YouTube    InnerTube search, keyless, from a server.  Works.
 *   Facebook   no keyless search. Measured: 0 post permalinks under four
 *              crawler identities on a 4.9MB page.
 *   Instagram  no keyless search. Measured: HTTP 429 to a server.
 *   X          no keyless search. Measured: HTTP 503 to Googlebot.
 *   LinkedIn   authwall.
 *
 * There is no version of this endpoint that grows to cover the other four, and
 * the screen says so rather than leaving the reader to wonder why one platform
 * appears. A model asked to name handles on those platforms returns plausible
 * strings that are not real accounts — that failure is what discovery in
 * influencers.ts was rewritten to remove, and it is not being reintroduced
 * here.
 *
 * WHAT A RESULT MEANS: the channel exists and YouTube returned it for this
 * name. Not that it belongs to the person. A name search surfaces fan
 * channels, news channels covering them, and impersonators. The caller shows
 * these as candidates to check.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // The channels YouTube lists for a name do not move between keystrokes.
      'cache-control': 'public, max-age=300',
    },
  })

const MIN_QUERY = 3
const MAX_QUERY = 120

export default async function handler(req: Request, _context: Context): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Send a GET with ?q=' }, 405)

  const raw = new URL(req.url).searchParams.get('q')?.trim() ?? ''
  if (raw.length < MIN_QUERY) return json({ query: raw, accounts: [] })

  const query = raw.slice(0, MAX_QUERY)
  const started = Date.now()

  /**
   * `verify=1` reads each channel before returning it.
   *
   * Costs one more fetch per result and is worth it, because the count is the
   * only thing that separates a real channel from a lookalike. Taking five
   * channel names from a web search and checking them here, one did not exist
   * at all and one came back with 67 subscribers under the name of a broadcaster
   * that has millions. A roster is a list of accounts an office will trust; a
   * plausible name with no reach beside it is exactly how an impersonator gets
   * onto one.
   */
  const verify = new URL(req.url).searchParams.get('verify') === '1'

  try {
    const channels = await searchYouTubeChannels(query)

    const accounts = await Promise.all(
      channels.map(async (c) => {
        const handle = c.handle ?? c.channelId
        const base = {
          platform: 'YouTube' as const,
          handle,
          name: c.name,
          url: c.handle
            ? `https://www.youtube.com/${c.handle}`
            : `https://www.youtube.com/channel/${c.channelId}`,
          followers: null as number | null,
          posts: 0,
          verified: false,
        }
        if (!verify) return base
        try {
          // By handle rather than channel id: the id path skips the channel
          // page, which is the only place a subscriber count is published.
          const read = await readHandle({ platform: 'YouTube', handle }, { licensed: false })
          return {
            ...base,
            name: read.displayName ?? base.name,
            followers: read.followers,
            posts: read.posts.length,
            // Read successfully, and the platform acknowledged it. Not a claim
            // that the account is who it says it is — only a person can judge
            // that, which is why the count is shown rather than hidden.
            verified: read.followers != null || read.posts.length > 0,
          }
        } catch {
          return base
        }
      }),
    )

    return json({
      query,
      accounts,
      /** Named so the screen can say which platforms were not searched, and why. */
      searched: ['YouTube'],
      ms: Date.now() - started,
    })
  } catch {
    // Never fatal: the identity lookup's own results still stand.
    return json({ query, accounts: [], searched: [], error: 'The account search is not answering just now.' })
  }
}

export const config: Config = {
  path: '/api/accounts/search',
  /**
   * One InnerTube call, no model. Fires when somebody picks a person, not on
   * every keystroke, so this is generous without being an invitation.
   */
  rateLimit: { windowLimit: 40, windowSize: 60, aggregateBy: ['ip'] },
}
