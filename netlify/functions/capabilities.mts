import type { Config, Context } from '@netlify/functions'
import { resolveProviders } from './lib/provider'
import { metaCredentials, inspectToken, type TokenReport } from './lib/meta-graph'
import { groundedSearchAvailable } from './lib/grounded'
import { providerStatus } from './lib/social-source'

/**
 * What this deployment can actually do, and what it would take to do more.
 *
 * Written because the honest answer to "why is my dashboard empty" was spread
 * across six files and a README. An office added their real Facebook page, saw
 * nothing, and had no way to find out whether that was a bug, a missing key, or
 * a thing the platform simply refuses — three completely different problems
 * with three different fixes, and the app looked identical in all three.
 *
 * So each capability reports three things: whether it is on, exactly which
 * environment variable turns it on, and — the part usually left out — what it
 * costs. "Free, no card" and "needs an app review that takes weeks" are both
 * useful answers and neither is guessable from the outside.
 *
 * NO SECRET IS EVER RETURNED. Only whether one is present, and for Meta whether
 * the token still works, which is checked with a live call because an expired
 * token is indistinguishable from a missing one on every screen that matters.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export interface Capability {
  id: string
  label: string
  /** What an office gets when this is on, in their words not ours. */
  unlocks: string
  on: boolean
  /** Environment variables that switch it on. Empty when nothing is needed. */
  needs: string[]
  /** What it costs to obtain. */
  cost: 'none' | 'free-key' | 'free-with-setup' | 'paid'
  /** How to get it, in order. */
  steps: string[]
  /** Live-checked detail, when there is one. */
  status?: string | null
  /** Meta only: what the token actually is, so a wrong one names itself. */
  token?: {
    type: string | null
    page: string | null
    scopes: string[]
    missingScopes: string[]
    writeScopes: string[]
    expiresAt: string | null
    problems: string[]
  } | null
}

const has = (name: string): boolean => Boolean(process.env[name]?.trim())

export default async function handler(_req: Request, _context: Context): Promise<Response> {
  const providers = resolveProviders()
  const meta = metaCredentials()

  /* The one live check. A token that has expired reports as configured
     everywhere else, which is the least useful possible answer. */
  let metaStatus: string | null = null
  let metaWorking = false
  let metaReport: TokenReport | null = null
  if (meta) {
    metaReport = await inspectToken(meta)
    metaWorking = metaReport.ok
    metaStatus = metaReport.ok
      ? `Connected to ${metaReport.page?.name || 'a page'}${
          metaReport.page?.followers ? ` (${metaReport.page.followers.toLocaleString('en-IN')} followers)` : ''
        }${meta.igUserId ? ', with Instagram linked' : ''}.${
          metaReport.expiresAt ? ' This token expires. See below.' : ' This token does not expire.'
        }`
      : // The FIRST problem, not a generic failure. Each one names a different
        // mistake with a different fix, and "Meta refused it" names none of them.
        metaReport.problems[0] ?? 'The token is set but did not work.'
  }

  const capabilities: Capability[] = [
    {
      id: 'news',
      label: 'Reading the local papers',
      unlocks:
        'The morning scan of every masthead covering your district, and the stories that name you.',
      on: true,
      needs: [],
      cost: 'none',
      steps: [],
      status: 'Working. Newspapers publish their front pages to anyone.',
    },
    {
      id: 'model',
      label: 'Understanding what a story says',
      unlocks:
        'Stance, sentiment, whether a claim looks fabricated, and what to do about it. Nothing is interpreted without this.',
      on: providers.length > 0,
      needs: providers.length > 0 ? [] : ['GROQ_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY'],
      cost: 'free-key',
      steps: [
        'Groq and Google both give a free key with no card: console.groq.com/keys or aistudio.google.com/apikey.',
        'Add it to the site environment as GROQ_API_KEY or GEMINI_API_KEY.',
      ],
      status:
        providers.length > 0
          ? `Working, through ${providers.map((p) => p.label).join(' then ')}.`
          : null,
    },
    {
      id: 'grounded',
      label: 'Finding your accounts on the web',
      unlocks:
        'A live web search for your official accounts, so the Accounts screen fills itself in instead of asking you to paste links.',
      on: groundedSearchAvailable(),
      needs: groundedSearchAvailable() ? [] : ['GEMINI_API_KEY'],
      cost: 'free-key',
      steps: [
        'Get a key at aistudio.google.com/apikey. It is free and needs no card.',
        'Add it as GEMINI_API_KEY.',
      ],
      status: groundedSearchAvailable() ? 'Working. Every address found is opened to check it.' : null,
    },
    {
      id: 'youtube',
      label: 'YouTube posts and comments',
      unlocks:
        'The channels covering your seat, what they said about you, and the comments underneath.',
      on: true,
      needs: [],
      cost: 'none',
      steps: [],
      status:
        'Working without a key. YOUTUBE_API_KEY makes per-post figures exact but changes nothing else.',
    },
    {
      id: 'meta',
      label: 'Facebook and Instagram comments',
      unlocks:
        'The comments under YOUR OWN posts, the only place "what people are saying" can come from for most offices, because this is where constituents actually reply.',
      on: metaWorking,
      needs: meta ? [] : ['META_PAGE_TOKEN', 'META_IG_USER_ID (optional)'],
      cost: 'free-with-setup',
      steps: [
        'Facebook and Instagram publish NOTHING about an account to a server without a token. This is theirs, not ours, and no key from anywhere else changes it.',
        'You must be an admin of the Page. Create an app at developers.facebook.com, add the "Facebook Login" product, then open Graph API Explorer.',
        'Select your app, choose "Get Page Access Token", pick the Page, and grant pages_read_engagement and pages_show_list.',
        'Exchange it for a long-lived token, because a short one expires in about an hour. developers.facebook.com/tools/debug/accesstoken has the extender.',
        'Add it as META_PAGE_TOKEN. For Instagram, add the linked business account id as META_IG_USER_ID.',
        'Free. The app needs review only to read OTHER people’s pages. Your own needs no review at all.',
      ],
      status: metaStatus,
      /** Everything wrong with the token, so a half-right one is diagnosable. */
      token: metaReport
        ? {
            type: metaReport.type,
            page: metaReport.page?.name ?? null,
            scopes: metaReport.scopes,
            missingScopes: metaReport.missingScopes,
            writeScopes: metaReport.writeScopes,
            expiresAt: metaReport.expiresAt,
            problems: metaReport.problems,
          }
        : null,
    },
    {
      id: 'provider',
      label: 'Pages you do not administer',
      unlocks:
        'Posts and comments from a rival’s Facebook or Instagram: the pages no token here will ever authorise, because they are not yours.',
      on: providerStatus().configured,
      needs: providerStatus().needs,
      cost: 'paid',
      steps: [
        'Meta authorises a token for ONE page: the one you administer. There is no key, free or paid, that reads a page you do not own. That is Meta’s boundary, not this app’s.',
        'The legitimate route is a data provider that already holds it and licenses access: Apify, Bright Data and Phyllo all sell this, roughly $30 to $100 a month.',
        'They must answer a small contract: POST with { kind, platform, url } and return { comments: [...] } or { posts: [...] }. Any vendor becomes a short shim in front of that.',
        'Set SOCIAL_PROVIDER_URL and SOCIAL_PROVIDER_KEY. Anything it supplies is labelled as third-party data wherever it appears, and never blended with what the platform itself told us.',
        'Scraping these pages through a logged-in throwaway account is the other way it is done, and is not supported here: it violates the platform terms, has been litigated successfully by Meta, and breaks whenever an internal identifier rotates.',
      ],
      status: providerStatus().configured
        ? 'A provider is configured. Anything it returns is labelled as third-party data.'
        : null,
    },
    {
      id: 'x',
      label: 'X (Twitter) posts',
      unlocks: 'Your own posts and replies on X.',
      on: has('X_CLIENT_ID') && has('X_CLIENT_SECRET'),
      needs: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
      cost: 'paid',
      steps: [
        'X publishes nothing about an account to a server without OAuth, and its free tier does not include reading mentions.',
        'Reading your own posts needs an app at developer.x.com. Reading what others say about you needs the Basic tier, around $200 a month.',
        'Worth skipping until something proves you need it.',
      ],
      status: null,
    },
  ]

  return json({
    capabilities,
    /** How much of the product is actually switched on. */
    summary: {
      on: capabilities.filter((c) => c.on).length,
      total: capabilities.length,
      /** The one that would help most, if it is off. */
      nextBest: capabilities.find((c) => !c.on && c.cost !== 'paid')?.id ?? null,
    },
  })
}

export const config: Config = {
  path: '/api/capabilities',
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip'] },
}
