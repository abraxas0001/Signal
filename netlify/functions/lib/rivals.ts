import { complete } from './openai-compat'
import { resolveProviders } from './provider'
import { parseHandle, readHandle, type HandleSummary } from './handles'
import type { Platform } from '../../../shared/taxonomy'

/**
 * Working out who an account should be compared against.
 *
 * The comparison is only worth having if the comparators are the right ones,
 * and the right ones depend entirely on who the account belongs to. A sitting
 * Prime Minister is measured against predecessors in the office, the opposition
 * figures contesting it next, heads of government abroad, and — separately and
 * just as really — whoever contests the parliamentary seat he personally
 * stands in. A district MLA is measured against neighbouring MLAs and the
 * rivals in their own constituency. Those are different questions and a fixed
 * list of "competitors" answers neither.
 *
 * So the model supplies the judgement and this module supplies the facts:
 *
 *   1. The model is told who the account is and proposes cohorts of
 *      comparators, each with the handles it believes they use.
 *   2. EVERY proposed handle is then fetched. The ones that do not resolve are
 *      dropped before the user ever sees them.
 *
 * Step 2 is the whole design. A language model asked for someone's social
 * handle will produce a plausible one whether or not it exists, and a
 * dashboard that presented those as competitors would be inventing rivals for
 * a sitting politician — confidently, with follower counts beside them. The
 * model is allowed to say who matters; it is not allowed to say what is true.
 */

export interface RivalCandidate {
  name: string
  /** Why this person is a fair comparator, in one line, from the model. */
  why: string
  cohort: string
  handles: { platform: Platform; handle: string }[]
}

export interface VerifiedRival {
  name: string
  why: string
  cohort: string
  /** Only handles that actually resolved. */
  profiles: HandleSummary[]
  followers: number | null
}

const SYSTEM = `You identify who a public social media account belongs to, and who that person or organisation is fairly compared against.

Return cohorts appropriate to WHO THEY ACTUALLY ARE. Do not use a generic list. Judge from their role:

- A head of government: those who previously held the same office; the leaders of opposing parties who contest it; heads of government of comparable countries; and, separately, the rivals for the specific legislative seat they personally contest.
- A state or district legislator: legislators of neighbouring constituencies, the rival candidates in their own constituency, and the state leaders of the main parties.
- A news outlet: other outlets covering the same region and language.
- A company or brand: direct competitors in the same market.

Name a cohort for what it is ("Former Prime Ministers", "Contests the same seat", "Heads of government abroad", "Rival parties in the state").

For each person give the handles you believe they use. Give your best guess of the exact handle string. It is expected that some will be wrong — every one is checked against the live platform before it is shown, and wrong ones are discarded. Do not omit someone because you are unsure of their handle; give the handle you think is most likely.

Prefer accounts that are official and active. Return between 4 and 10 people in total across all cohorts. Keep "why" to one factual line about their relationship to the subject, not praise or criticism.`

const SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'role', 'candidates'],
  properties: {
    subject: { type: 'string', description: 'Who this account belongs to' },
    role: { type: 'string', description: 'Their position, in a few words' },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'why', 'cohort', 'handles'],
        properties: {
          name: { type: 'string' },
          why: { type: 'string' },
          cohort: { type: 'string' },
          handles: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['platform', 'handle'],
              properties: {
                platform: {
                  type: 'string',
                  enum: ['YouTube', 'Instagram', 'Facebook', 'Twitter/X', 'LinkedIn', 'Bluesky'],
                },
                handle: {
                  type: 'string',
                  description: 'Just the handle, without @ or a URL',
                },
              },
            },
          },
        },
      },
    },
  },
}

/** Build the URL a platform expects, so verification hits the real profile. */
function profileUrl(platform: Platform, handle: string): string | null {
  const h = handle.replace(/^@/, '').trim()
  if (!h) return null
  switch (platform) {
    case 'YouTube':
      return `https://www.youtube.com/@${h}`
    case 'Instagram':
      return `https://www.instagram.com/${h}/`
    case 'Facebook':
      return `https://www.facebook.com/${h}/`
    case 'LinkedIn':
      return `https://www.linkedin.com/in/${h}/`
    case 'Bluesky':
      return `https://bsky.app/profile/${h}`
    default:
      return null
  }
}

/**
 * A handle counts as real when the platform gives us something only a real
 * account has — a follower count or a post list. A page that merely returns
 * HTTP 200 is not evidence: Facebook and Instagram answer 200 for accounts that
 * do not exist.
 */
function resolved(s: HandleSummary): boolean {
  // A reseller's rows are not proof that a model's guess names a real account:
  // a provider that answers for a fabricated handle would verify an invented
  // opponent, which is precisely what this file exists to make impossible.
  // Discovery passes `licensed: false` so this should never be reachable —
  // it is here so that stops being load-bearing.
  return s.followers != null || (s.posts.length > 0 && s.listing.route !== 'licensed')
}

export interface RivalsResult {
  subject: string
  role: string
  rivals: VerifiedRival[]
  /** Named so the user can see the discovery was checked, not just trusted. */
  checked: number
  discarded: number
}

export async function findRivals(subject: HandleSummary): Promise<RivalsResult> {
  const providers = resolveProviders()
  if (!providers.length) throw new Error('No model is configured.')

  const user = [
    `PLATFORM: ${subject.platform}`,
    `HANDLE: ${subject.handle}`,
    subject.displayName ? `NAME: ${subject.displayName}` : null,
    subject.followers != null ? `FOLLOWERS: ${subject.followers}` : null,
    subject.posts.length
      ? `RECENT POST TITLES:\n${subject.posts.slice(0, 6).map((p) => `- ${p.title ?? ''}`).join('\n')}`
      : null,
    '',
    'Who is this, and who should they be compared against?',
  ]
    .filter(Boolean)
    .join('\n')

  interface Proposal {
    subject?: string
    role?: string
    candidates?: RivalCandidate[]
  }
  let proposal: Proposal | null = null
  let lastError = ''
  for (const provider of providers) {
    try {
      const out = await complete({ provider, system: SYSTEM, user, schema: SCHEMA })
      proposal = JSON.parse(out.text) as Proposal
      break
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  if (!proposal?.candidates?.length) {
    throw new Error(lastError || 'Could not work out who to compare against.')
  }

  // Verify every proposed handle against the live platform, in parallel. This
  // is the step that separates a comparison from a fabrication.
  let checked = 0
  const verified = await Promise.all(
    (proposal.candidates ?? []).slice(0, 10).map(async (c: RivalCandidate): Promise<VerifiedRival | null> => {
      const profiles: HandleSummary[] = []
      for (const h of (c.handles ?? []).slice(0, 3)) {
        const url = profileUrl(h.platform, h.handle)
        if (!url) continue
        const ref = parseHandle(url)
        if (!ref) continue
        checked++
        try {
          // `licensed: false` because every handle in this loop is a MODEL'S
          // GUESS, not a confirmed account. Letting discovery fall through to
          // the paid provider means buying a lookup for each invented handle —
          // one press of "Find rivals" is up to ten candidates times three
          // handles. Discovery only needs `resolved()`, which a free read
          // answers; the paid read happens later, once, when a person presses
          // Track on a rival they have actually confirmed.
          const summary = await readHandle(ref, { licensed: false })
          if (resolved(summary)) profiles.push(summary)
        } catch {
          /* an unreachable handle is a discarded guess, not an error */
        }
      }
      if (!profiles.length) return null
      const followers = profiles
        .map((p) => p.followers)
        .filter((f): f is number => f != null)
        .sort((a, b) => b - a)[0]
      return {
        name: c.name,
        why: c.why,
        cohort: c.cohort,
        profiles,
        followers: followers ?? null,
      }
    }),
  )

  const rivals = verified.filter((r): r is VerifiedRival => r !== null)
  return {
    subject: proposal.subject ?? subject.displayName ?? subject.handle,
    role: proposal.role ?? '',
    rivals,
    checked,
    discarded: checked - rivals.reduce((n, r: VerifiedRival) => n + r.profiles.length, 0),
  }
}
