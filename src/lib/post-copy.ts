import { fetchWithTimeout } from '@/lib/net'

/**
 * The words for one poster: the headline, the line under it, and the caption.
 *
 * The client half of /api/post-copy, and the sibling of post-idea.ts next door.
 * It is deliberately thinner than that one. post-idea keeps a cache, because a
 * post's reading does not change and the highlights screen is reopened all day.
 * A poster is different: the office picks an occasion, types a brief, reads the
 * copy, changes the brief and asks again. Nothing here is worth keeping between
 * sittings, and a cache would hand back the copy for a brief that has since been
 * rewritten.
 *
 * The doctrine that governs this whole feature lives on the server, in
 * netlify/functions/post-copy.mts, because that is where the model is reached.
 * The one part of it this file carries is COPY_CHECK_NOTICE below: the copy is
 * the model's, and the screen has to say so.
 */

export type CopyLanguage = 'English' | 'Telugu' | 'Hindi'

export interface CopyPayload {
  person: { name: string; role: string | null; party: string | null; constituency: string | null }
  /** The occasion, when one was chosen. Null for a post about nothing in particular. */
  occasion: { name: string; date: string } | null
  kind: 'image' | 'text' | 'quote'
  language: CopyLanguage
  /** What the office wants to say, in their own words. May be empty. */
  brief: string
}

export interface CopyResult {
  /** The big line on the poster. Short: it is set large. */
  headline: string
  /** One or two sentences under it. */
  body: string
  /** The caption to paste beside the image when posting. */
  caption: string
  hashtags: string[]
  readAt: string
}

/**
 * What the screen prints under the drafted copy.
 *
 * This product shows measurements everywhere else, and this one screen writes
 * something instead. The office must never be left guessing which of the two
 * they are looking at, so the copy is labelled the model's work and the reader
 * is told to check it. The wording is the convention this repo already uses,
 * under the drafted suggestions in Grievances.tsx: a generated draft carries
 * "check every post before it goes out".
 *
 * Exported rather than written into the screen so the two lines cannot drift
 * apart, and so a future screen that shows this copy inherits the notice
 * instead of forgetting it.
 */
export const COPY_CHECK_NOTICE = 'check every post before it goes out'

/**
 * The server's cap on the brief as well.
 *
 * Trimming here saves posting a body the server would only cut to the same
 * length. Six hundred characters is a long paragraph of instruction, and the
 * brief is guidance rather than published text: none of it is set on the poster
 * as typed.
 */
const BRIEF_CAP = 600

/** Hashtags off the wire, kept only where they are strings with something in them. */
const toHashtags = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((x) => x.length > 0)

/**
 * Ask the server for the words on this poster.
 *
 * Resolves with the copy, or throws an Error whose message is a sentence the
 * office can read. The server writes its refusals that way, including the ones
 * that are the point of the feature (an occasion with no date, a request with
 * nothing to write about), and the two failures it cannot phrase (the network
 * dying, a reply that is not JSON) are phrased here so no caller has to invent
 * copy of its own.
 *
 * Nothing is cached. The caller decides what to do with an answer, which keeps a
 * failed draft from replacing copy the office was still reading.
 */
export async function fetchPostCopy(payload: CopyPayload): Promise<CopyResult> {
  let res: Response
  try {
    res = await fetchWithTimeout('/api/post-copy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, brief: payload.brief.slice(0, BRIEF_CAP) }),
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
    headline?: unknown
    body?: unknown
    caption?: unknown
    hashtags?: unknown
    readAt?: unknown
    error?: unknown
  }

  // The server's own sentence wins over anything invented here, whatever the
  // status code was.
  if (typeof body.error === 'string' && body.error) throw new Error(body.error)
  if (!res.ok) {
    throw new Error(`The drafting service gave an unexpected answer (${res.status}). Try again.`)
  }

  const headline = typeof body.headline === 'string' ? body.headline.trim() : ''
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  const caption = typeof body.caption === 'string' ? body.caption.trim() : ''
  /**
   * The headline and the body are what the poster sets, so a reply missing
   * either is unusable. The caption is not: it is pasted beside the image and an
   * office that has the poster can write the caption itself, so an empty one is
   * handed over as empty rather than throwing away good copy.
   */
  if (!headline || !text) {
    throw new Error('The drafting service answered with nothing usable. Try again.')
  }

  return {
    headline,
    body: text,
    caption,
    hashtags: toHashtags(body.hashtags),
    // The server stamps this; a reply without one is stamped here rather than
    // left blank, because the screen prints when the copy was written.
    readAt: typeof body.readAt === 'string' ? body.readAt : new Date().toISOString(),
  }
}
