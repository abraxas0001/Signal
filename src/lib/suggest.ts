import { scopedKey } from '@/lib/store'
import { fetchWithTimeout } from '@/lib/net'

/**
 * Suggested social posts for one issue, and the cache that keeps them.
 *
 * Drafting costs a model call, and an office reopens an issue card far more
 * often than the issue itself changes — so what was drafted is kept per issue
 * and shown from the cache until somebody asks for a fresh set. Drafting
 * again overwrites that one issue's entry and touches no other.
 *
 * localStorage, scoped per account, for the same reason the rest of the desk
 * is: these are draft statements in a politician's first person, and a shared
 * server copy of half-written posts is a record nobody asked this product to
 * keep.
 */

export interface SuggestedPost {
  /** The post, ready to paste. Under 280 characters when the model behaved. */
  text: string
  /** A three-to-six word label for the approach, e.g. "acknowledge and set a deadline". */
  angle: string
  /** Where the post fits best. A suggestion, not a requirement. */
  platform: string
}

export interface SuggestionEntry {
  generatedAt: string
  posts: SuggestedPost[]
}

/** The slice of an issue the drafting service needs. */
export interface SuggestionIssue {
  title: string
  summary: string
  category: string
  severity: string
}

/** The slice of a record the drafting service needs. */
export interface SuggestionRecord {
  headline: string
  excerpt: string
  publisher: string | null
}

/** Who the posts speak as. */
export interface SuggestionPerson {
  name: string
  role: string | null
  party: string | null
  constituency: string | null
}

/**
 * Read through a function rather than captured in a constant, same as every
 * other cache here: the active account changes at runtime, and a module-level
 * constant would freeze whichever account was signed in at first import.
 */
const KEY = (): string => scopedKey('signal.suggestions.v1')

export function readSuggestions(issueId: string): SuggestionEntry | null {
  try {
    const all = JSON.parse(localStorage.getItem(KEY()) ?? '{}') as Record<string, SuggestionEntry>
    return all[issueId] ?? null
  } catch {
    return null
  }
}

export function saveSuggestions(issueId: string, posts: SuggestedPost[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(KEY()) ?? '{}') as Record<string, SuggestionEntry>
    all[issueId] = { generatedAt: new Date().toISOString(), posts }
    localStorage.setItem(KEY(), JSON.stringify(all))
  } catch {
    /* private mode: the drafts still render this session, they just will not
       survive a reload */
  }
}

const toPost = (raw: unknown): SuggestedPost | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const text = typeof o['text'] === 'string' ? o['text'].trim() : ''
  const angle = typeof o['angle'] === 'string' ? o['angle'].trim() : ''
  const platform = typeof o['platform'] === 'string' ? o['platform'].trim() : ''
  if (!text || !angle || !platform) return null
  return { text, angle, platform }
}

/**
 * Ask the server to draft posts for one issue.
 *
 * Resolves with the posts, or throws an Error whose message is a sentence the
 * office can read — the server writes its refusals that way, and the two
 * failures it cannot phrase (the network dying, a reply that is not JSON) are
 * phrased here so the caller never has to invent copy.
 */
export async function fetchSuggestions(
  issue: SuggestionIssue,
  records: SuggestionRecord[],
  person: SuggestionPerson,
): Promise<SuggestedPost[]> {
  let res: Response
  try {
    res = await fetchWithTimeout('/api/suggest-posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Five records is the server's cap as well; trimming here keeps a desk
      // with forty records behind an issue from posting a body it will discard.
      body: JSON.stringify({ issue, records: records.slice(0, 5), person }),
    })
  } catch {
    throw new Error('Could not reach the drafting service. Check the connection and try again.')
  }

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* a non-JSON reply is handled by the status check below */
  }
  const body = (
    typeof data === 'object' && data !== null ? data : {}
  ) as { posts?: unknown; error?: unknown }

  // The server's own sentence wins over anything invented here, whatever the
  // status code was.
  if (typeof body.error === 'string' && body.error) throw new Error(body.error)
  if (!res.ok) {
    throw new Error(`The drafting service gave an unexpected answer (${res.status}). Try again.`)
  }

  const posts = (Array.isArray(body.posts) ? body.posts : []).flatMap((raw) => {
    const post = toPost(raw)
    return post ? [post] : []
  })
  if (posts.length === 0) {
    throw new Error('The drafting service answered with no usable posts. Try again.')
  }
  return posts
}
