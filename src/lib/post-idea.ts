import { scopedKey } from '@/lib/store'
import { deskKey } from '@/lib/personas'
import { fetchWithTimeout } from '@/lib/net'

/**
 * What to post next after one of the office's own posts, and the cache that
 * keeps it.
 *
 * Drafting costs a model call, and the highlights screen is reopened far more
 * often than a post's reading changes, so what was drafted is kept per post and
 * shown from the cache until somebody asks for a fresh one. Drafting again
 * overwrites that one post's entry and touches no other.
 *
 * localStorage, scoped per account, for the same reason the rest of the desk is:
 * these are draft statements in a politician's first person, and a shared server
 * copy of half-written posts is a record nobody asked this product to keep. That
 * is also why this key is deliberately NOT in `SYNCED_BASES` in desk-session.ts.
 * The handles and the standing readings sync because a handed-over desk is
 * useless without them. An unsent draft is not a finding about the world, it is
 * something the officeholder has not decided to say yet, and it stays on the
 * device where it was written.
 */

/** One drafted post, ready to paste. */
export interface PostIdea {
  /** The post itself. Under 280 characters when the model behaved. */
  text: string
  /** A three-to-six word label for the approach, e.g. "answer the criticism directly". */
  angle: string
  /** Where this next post fits best. A suggestion, not a requirement. */
  platform: string
}

/** What is held per post: the reasoning, the draft, and when they were made. */
export interface PostIdeaEntry {
  generatedAt: string
  /** One short paragraph on what to post next, and what in the reading points there. */
  whatToPostNext: string
  idea: PostIdea
}

/** Who the draft speaks as. */
export interface PostIdeaPerson {
  name: string
  role: string | null
  party: string | null
  constituency: string | null
}

/** The post the suggestion follows on from. */
export interface PostIdeaPost {
  platform: string
  publishedAt: string | null
  title: string
}

/**
 * The evidence, pre-rendered as English sentences.
 *
 * Written on this side rather than sent as figures, the way post-plan.ts writes
 * its payload. The server never sees a raw metric, so it can never coalesce an
 * unpublished figure to zero and report the absence of a measurement as a
 * measurement of nothing. "Shares were not published" is a sentence. There is no
 * number that says it.
 */
export interface PostIdeaPayload {
  person: PostIdeaPerson
  post: PostIdeaPost
  /** How it landed: the score, the label, the reaction figures that exist. */
  landed: string[]
  /** What it was about: topic, subtopic, key points. */
  about: string[]
  /** What the comments said, verbatim where there are quotes to give. */
  audience: string[]
  /** The reading's own observations and its suggested civic action. */
  notes: string[]
  /**
   * False means no comments were retrievable for this post. The server changes
   * what it allows the model to claim on that basis, so it is never guessed at
   * here: pass the reading's own answer.
   */
  hasComments: boolean
}

/** What the endpoint returns when it drafted something. */
export interface PostIdeaResult {
  whatToPostNext: string
  idea: PostIdea
  readAt: string
}

/**
 * Read through a function rather than captured in a constant, same as every
 * other cache here: the active account changes at runtime, and a module-level
 * constant would freeze whichever account was signed in at first import.
 */
const KEY = (): string => deskKey('signal.postIdea.v1')

/**
 * How many posts' suggestions this device keeps.
 *
 * The equivalent map in suggest.ts is uncapped, which is survivable there
 * because an office runs a handful of issues. Highlights are different: a desk
 * tracking four accounts can have a hundred read posts, and a paragraph plus a
 * draft per post is a few hundred bytes each. Left uncapped this one key grows
 * until a write throws, and the write that throws takes down whichever cache was
 * unlucky enough to be next, not this one. Forty is far more than anybody scrolls
 * back through in a sitting, and the oldest suggestion is the one nobody wants.
 */
const MAX_ENTRIES = 40

/** The server's cap as well. Trimming here saves posting a body it will discard. */
const MAX_LINES = 8

const readAll = (): Record<string, PostIdeaEntry> => {
  const raw = localStorage.getItem(KEY())
  return raw ? (JSON.parse(raw) as Record<string, PostIdeaEntry>) : {}
}

export function readPostIdea(url: string): PostIdeaEntry | null {
  try {
    return readAll()[url] ?? null
  } catch {
    return null
  }
}

/**
 * Store one post's suggestion, and hand back exactly what was stored.
 *
 * The entry is returned rather than nothing so a caller that has just drafted
 * can render the stored form without stamping a second, slightly different
 * `generatedAt` of its own. It is returned whether or not the write landed: a
 * device over quota still shows the suggestion for this session, and pretending
 * otherwise would hide a good draft behind a storage failure.
 */
export function savePostIdea(
  url: string,
  value: Omit<PostIdeaEntry, 'generatedAt'>,
): PostIdeaEntry {
  const entry: PostIdeaEntry = {
    generatedAt: new Date().toISOString(),
    whatToPostNext: value.whatToPostNext,
    idea: value.idea,
  }
  try {
    const all = readAll()
    /**
     * Deleted before it is written back so that re-drafting an old post moves it
     * to the end of the map's insertion order rather than leaving it where it
     * first landed. That order is what the trim below reads as age, and it
     * survives the JSON round trip, so no timestamp has to be parsed to know
     * which entry is the stalest.
     */
    delete all[url]
    all[url] = entry
    const urls = Object.keys(all)
    for (const stale of urls.slice(0, Math.max(0, urls.length - MAX_ENTRIES))) delete all[stale]
    localStorage.setItem(KEY(), JSON.stringify(all))
  } catch {
    /* private mode, or over quota: the suggestion still renders this session, it
       just will not survive a reload */
  }
  return entry
}

const toIdea = (raw: unknown): PostIdea | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const text = typeof o['text'] === 'string' ? o['text'].trim() : ''
  const angle = typeof o['angle'] === 'string' ? o['angle'].trim() : ''
  const platform = typeof o['platform'] === 'string' ? o['platform'].trim() : ''
  if (!text || !angle || !platform) return null
  return { text, angle, platform }
}

/**
 * Ask the server what to post next after this post, and for the post itself.
 *
 * Resolves with both, or throws an Error whose message is a sentence the office
 * can read. The server writes its refusals that way, and the two failures it
 * cannot phrase (the network dying, a reply that is not JSON) are phrased here
 * so the caller never has to invent copy.
 *
 * Nothing is cached by this function. The caller decides whether an answer is
 * worth keeping and calls savePostIdea, which keeps a failed draft from
 * overwriting a good one already on the device.
 */
export async function fetchPostIdea(payload: PostIdeaPayload): Promise<PostIdeaResult> {
  let res: Response
  try {
    res = await fetchWithTimeout('/api/post-idea', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        landed: payload.landed.slice(0, MAX_LINES),
        about: payload.about.slice(0, MAX_LINES),
        audience: payload.audience.slice(0, MAX_LINES),
        notes: payload.notes.slice(0, MAX_LINES),
      }),
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
  const body = (typeof data === 'object' && data !== null ? data : {}) as {
    whatToPostNext?: unknown
    idea?: unknown
    readAt?: unknown
    error?: unknown
  }

  // The server's own sentence wins over anything invented here, whatever the
  // status code was.
  if (typeof body.error === 'string' && body.error) throw new Error(body.error)
  if (!res.ok) {
    throw new Error(`The drafting service gave an unexpected answer (${res.status}). Try again.`)
  }

  const idea = toIdea(body.idea)
  const whatToPostNext =
    typeof body.whatToPostNext === 'string' ? body.whatToPostNext.trim() : ''
  if (!idea || !whatToPostNext) {
    throw new Error('The drafting service answered with nothing usable. Try again.')
  }

  return {
    whatToPostNext,
    idea,
    // The server stamps this; a reply without one is stamped here rather than
    // left blank, because the screen prints when the suggestion was written.
    readAt: typeof body.readAt === 'string' ? body.readAt : new Date().toISOString(),
  }
}
