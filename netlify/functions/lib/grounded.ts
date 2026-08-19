import { fetchText, ALLOW_CRAWLER_UA } from './fetcher'
import type { SocialHandle } from '../../../shared/identity'

/**
 * Finding somebody's accounts by searching the live web.
 *
 * The encyclopaedia route runs out fast. For a sitting Member of Parliament,
 * Wikidata carried no social claims at all and her Wikipedia article linked
 * fourteen external pages, every one of them a news story. Facebook, Instagram
 * and X answer no keyless search, so there was nothing left to try — and the
 * Accounts screen sat empty for a person with a large, entirely public
 * following.
 *
 * Gemini's grounded search is the missing piece, and it is a real search rather
 * than a recollection: the model queries Google, reads what comes back, and the
 * response carries the pages it used. Asked about that same member it returned
 * facebook.com/DKAruna.TG, whose own page describes her as "Member of
 * Parliament - Mahabubnagar | National BJP Vice President | Former MLA -
 * Gadwal" — correct, current, and found nowhere else this app can reach.
 *
 * THE RULE THAT MAKES THIS SAFE.
 *
 * Nothing the model says is taken as true. It is taken as a LEAD. Every address
 * it produces is then fetched, and only an address that resolves to a page
 * naming this person is offered — and offered as a suggestion somebody has to
 * accept, never as a fact.
 *
 * That is not caution for its own sake. A wrong handle here is not a typo: an
 * account marked as the office's own is what the public-mood reading is taken
 * from, and a public figure's impersonator is the single thing this product
 * most exists to catch. Handing somebody an impostor's page labelled "your
 * account" would be the worst failure available to it.
 *
 * WHAT THIS CANNOT DO, and no amount of model will change: it cannot read the
 * comments under those posts. Facebook and Instagram require an authenticated
 * token for that and a language model cannot log in. Grounded search finds what
 * Google has indexed — pages, not comment threads. Discovery and reading are
 * different problems and only the first one is solved here.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
const MODEL = process.env['GEMINI_GROUNDED_MODEL'] ?? 'gemini-2.5-flash'
const TIMEOUT_MS = 20_000
const VERIFY_TIMEOUT_MS = 8_000

/** At most this many addresses are fetched back. Each one is a live request. */
const MAX_VERIFY = 8

export interface GroundedHandle extends SocialHandle {
  /** The page was fetched and it names this person. */
  confirmed: boolean
  /** The name the page itself showed, for a human to compare. */
  pageName: string | null
}

export interface GroundedDiscovery {
  handles: GroundedHandle[]
  /** Pages the model said it used, for the reader to check. */
  sources: string[]
  notes: string[]
  /** False when no key is configured, so callers can say why nothing happened. */
  searched: boolean
}

export const groundedSearchAvailable = (): boolean =>
  Boolean(process.env['GEMINI_API_KEY']?.trim())

/* ── which addresses are profiles ────────────────────────────────────────── */

/**
 * A profile address, or null.
 *
 * The exclusions carry the weight. A grounded answer cites the pages it read,
 * and those are overwhelmingly individual posts, photos and videos —
 * `/posts/…`, `/watch?v=…`, `/p/…`. Every one of them sits on a platform
 * hostname and would pass a naive host check, so the roster would fill with
 * links to single posts presented as accounts.
 */
function asProfile(raw: string): { platform: string; handle: string; url: string } | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\.|^m\.|^web\./, '').toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)
  const first = segments[0]
  if (!first) return null

  // Paths that are content rather than an account, on every platform.
  const NOT_A_PROFILE =
    /^(posts?|photos?|videos?|watch|reel|reels|share|permalink|events?|groups?|hashtag|explore|search|story|stories|status|p|pg|media|about|home|login|help|policies|privacy|terms|marketplace|pages)$/i
  if (NOT_A_PROFILE.test(first)) return null
  if (segments.some((s) => /^\d{6,}$/.test(s))) return null

  const clean = (value: string): string => value.replace(/^@/, '').trim()

  switch (host) {
    case 'x.com':
    case 'twitter.com': {
      if (segments.length !== 1) return null
      return { platform: 'X', handle: clean(first), url: `https://x.com/${clean(first)}` }
    }
    case 'facebook.com': {
      if (segments.length > 2) return null
      // profile.php?id=… is a real profile but not a handle we can name.
      if (first === 'profile.php') return null
      return {
        platform: 'Facebook',
        handle: clean(first),
        url: `https://www.facebook.com/${clean(first)}`,
      }
    }
    case 'instagram.com': {
      if (segments.length !== 1) return null
      return {
        platform: 'Instagram',
        handle: clean(first),
        url: `https://www.instagram.com/${clean(first)}/`,
      }
    }
    case 'youtube.com': {
      if (first.startsWith('@')) {
        return { platform: 'YouTube', handle: clean(first), url: `https://www.youtube.com/${first}` }
      }
      if ((first === 'channel' || first === 'c' || first === 'user') && segments[1]) {
        return {
          platform: 'YouTube',
          handle: segments[1],
          url: `https://www.youtube.com/${first}/${segments[1]}`,
        }
      }
      return null
    }
    case 't.me':
    case 'telegram.me':
      return { platform: 'Telegram', handle: clean(first), url: `https://t.me/${clean(first)}` }
    case 'linkedin.com':
      if (first !== 'in' || !segments[1]) return null
      return {
        platform: 'LinkedIn',
        handle: segments[1],
        url: `https://www.linkedin.com/in/${segments[1]}/`,
      }
    default:
      return null
  }
}

/* ── verification ────────────────────────────────────────────────────────── */

/** The distinctive parts of a name, for comparing against a page title. */
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 4)
}

/**
 * Fetch the address and see whether it really is this person.
 *
 * Only the page's own title is used. It is the one thing every platform serves
 * to an anonymous reader — Facebook returns `<title>D K Aruna</title>` for a
 * page whose body is a login wall — and it is the thing a human would check.
 *
 * A page that cannot be fetched comes back unconfirmed rather than rejected.
 * X and Instagram refuse servers outright, and treating "we were blocked" as
 * "this is not them" would throw away every correct answer on two platforms.
 */
async function verify(
  candidate: { platform: string; handle: string; url: string },
  name: string,
): Promise<{ confirmed: boolean; pageName: string | null }> {
  /*
    Two identities, in order.

    A plain browser user-agent gets a login wall from Facebook with no title in
    it, which reads as "this account could not be confirmed" for an account that
    plainly exists — the page under test returns `<title>D K Aruna</title>` the
    moment it is asked for by a crawler. Every other adapter here already fails
    over the same way, behind the same switch, and this is exactly the case it
    was added for: a page the publisher serves to search engines and hides from
    everybody else.
  */
  const attempts: ('browser' | 'google')[] = ALLOW_CRAWLER_UA ? ['browser', 'google'] : ['browser']

  let title: string | null = null
  for (const agent of attempts) {
    const res = await fetchText(candidate.url, {
      timeout: VERIFY_TIMEOUT_MS,
      agent,
    }).catch(() => null)
    if (!res?.ok || !res.body) continue

    title =
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(res.body)?.[1] ??
      /<title[^>]*>([^<]+)<\/title>/i.exec(res.body)?.[1] ??
      null

    // A login wall has a title too, and it is never the person's name — so a
    // useless title is a reason to try the next identity, not to give up.
    if (title && !/log in|sign up|facebook|instagram|watch|redirect/i.test(title)) break
    title = null
  }

  if (!title) return { confirmed: false, pageName: null }

  const pageName = title.replace(/\s+/g, ' ').trim().slice(0, 120)
  const haystack = pageName.toLowerCase()
  const tokens = nameTokens(name)

  // At least one distinctive part of the name, which for "D. K. Aruna" means
  // "aruna" — the initials are too short to prove anything.
  const confirmed = tokens.length > 0 && tokens.some((token) => haystack.includes(token))
  return { confirmed, pageName }
}

/* ── the grounded call ───────────────────────────────────────────────────── */

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: unknown }[] }
    groundingMetadata?: { groundingChunks?: { web?: { uri?: unknown; title?: unknown } }[] }
  }[]
  error?: { message?: unknown }
}

export interface DiscoverInput {
  name: string
  role?: string | null
  constituency?: string | null
  state?: string | null
  party?: string | null
  signal?: AbortSignal
}

export async function discoverHandlesGrounded(
  input: DiscoverInput,
): Promise<GroundedDiscovery> {
  const key = process.env['GEMINI_API_KEY']?.trim()
  if (!key) {
    return {
      handles: [],
      sources: [],
      searched: false,
      notes: [
        'No Gemini key is set, so the web was not searched for accounts. Add GEMINI_API_KEY to look them up automatically.',
      ],
    }
  }

  const who = [
    input.name,
    input.role ? `the ${input.role}` : null,
    input.constituency ? `for ${input.constituency}` : null,
    input.state ? `in ${input.state}` : null,
    input.party ? `(${input.party})` : null,
  ]
    .filter(Boolean)
    .join(' ')

  /*
    The prompt asks for addresses and forbids construction.

    A model asked for "the Twitter handle of X" will produce a plausible string
    for anybody, because the shape of a handle is trivially guessable. Requiring
    that each one appear on a page it actually read is what turns the answer
    from a guess into a citation — and everything is fetched afterwards anyway.
  */
  const prompt = `Find the OFFICIAL social media accounts of ${who}.

Search for accounts on X (Twitter), Facebook, Instagram, YouTube and Telegram.

Rules:
- Give the full URL of each account's PROFILE page. Not a post, not a video, not a photo.
- Only give an address you actually saw in a search result. Do NOT construct a plausible handle from the person's name — a guessed handle is worse than no handle, because somebody will be shown an impostor's page labelled as their own.
- Say explicitly which platforms you could NOT find an account for. That is a useful answer.
- If several accounts claim to be this person, list them all and say they are unverified. Do not pick one.
- This person is an Indian public figure. Fan pages, parody accounts and news channels that cover them are NOT their accounts.`

  let body: GeminiResponse
  try {
    const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // Grounding and a JSON response schema cannot be combined — the API
        // refuses the pair outright. So the answer comes back as prose and the
        // addresses are pulled out of it by pattern, which is the more robust
        // half anyway: a URL either parses as a profile or it does not.
        tools: [{ google_search: {} }],
      }),
      signal: input.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    })

    body = (await res.json()) as GeminiResponse

    if (!res.ok || body.error) {
      const message =
        typeof body.error?.message === 'string' ? body.error.message : `HTTP ${res.status}`
      return {
        handles: [],
        sources: [],
        searched: true,
        notes: [`The web search for accounts did not run: ${message}`],
      }
    }
  } catch (err) {
    return {
      handles: [],
      sources: [],
      searched: true,
      notes: [
        `The web search for accounts could not be reached: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ],
    }
  }

  const candidate = body.candidates?.[0]
  const answer = (candidate?.content?.parts ?? [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('\n')

  /* ── every address the answer mentioned, plus every page it read ───────── */

  const seen = new Set<string>()
  const found: { platform: string; handle: string; url: string }[] = []

  const consider = (raw: string): void => {
    const profile = asProfile(raw)
    if (!profile) return
    const key2 = `${profile.platform}:${profile.handle}`.toLowerCase()
    if (seen.has(key2)) return
    seen.add(key2)
    found.push(profile)
  }

  for (const match of answer.matchAll(/https?:\/\/[^\s)<>"'\]`*,;]+/g)) {
    consider(match[0].replace(/[.,;:`*)\]]+$/, ''))
  }

  const sources: string[] = []
  for (const chunk of candidate?.groundingMetadata?.groundingChunks ?? []) {
    const uri = chunk.web?.uri
    const title = chunk.web?.title
    if (typeof title === 'string') sources.push(title)
    if (typeof uri === 'string') consider(uri)
  }

  /* ── prove each one ────────────────────────────────────────────────────── */

  const checked = await Promise.all(
    found.slice(0, MAX_VERIFY).map(async (profile) => {
      const { confirmed, pageName } = await verify(profile, input.name)
      const handle: GroundedHandle = {
        platform: profile.platform,
        handle: profile.handle,
        url: profile.url,
        verified: false,
        followers: null,
        connected: false,
        confirmed,
        pageName,
      }
      return handle
    }),
  )

  // Confirmed first: those are the ones a reader can accept quickly.
  checked.sort((a, b) => Number(b.confirmed) - Number(a.confirmed))

  const notes: string[] = []
  const confirmedCount = checked.filter((h) => h.confirmed).length
  const unconfirmed = checked.length - confirmedCount

  if (checked.length === 0) {
    notes.push(
      'The web was searched and no official account could be found. Many members have none, and Facebook, Instagram and X publish nothing that a search can confirm.',
    )
  } else {
    if (confirmedCount > 0) {
      notes.push(
        `${confirmedCount} ${confirmedCount === 1 ? 'account was' : 'accounts were'} opened and the page named this person. Check each one before marking it as yours.`,
      )
    }
    if (unconfirmed > 0) {
      notes.push(
        `${unconfirmed} ${unconfirmed === 1 ? 'address' : 'addresses'} could not be opened — X and Instagram refuse automated readers, so this is normal and does not mean the account is wrong. Open them yourself before accepting.`,
      )
    }
  }

  if (found.length > MAX_VERIFY) {
    notes.push(
      `${found.length - MAX_VERIFY} further addresses were found and not checked, to bound the work.`,
    )
  }

  return { handles: checked, sources: [...new Set(sources)].slice(0, 8), searched: true, notes }
}
