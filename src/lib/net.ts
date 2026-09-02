/**
 * One place where "this request is never coming back" is decided.
 *
 * Every call to the analysis endpoints used to be a bare `fetch` with no
 * deadline, which meant a request that stalled stalled for the lifetime of the
 * page. That is worse than it sounds, and the way it showed up was not a
 * spinner that never stopped.
 *
 * A browser opens at most six connections to one host over HTTP/1.1. Two
 * stalled function calls therefore cost a third of the page's capacity to
 * fetch anything at all — and what a dashboard mostly fetches is images. The
 * demo desk was measured at zero of fourteen thumbnails loaded while two
 * `/api` calls hung, and thirteen of fourteen when the same two were cut off.
 * Nobody looking at that screen would have guessed the cause was a request
 * they could not see, for data they were not waiting on.
 *
 * So requests get a deadline. It is not there to make anything faster; it is
 * there so a failure stays the size of the thing that failed.
 */

/**
 * Longer than the longest thing the server is allowed to take, on purpose.
 *
 * This was 35s, reasoned from the 30s cap `netlify dev` enforces locally. That
 * is the wrong number for production: `netlify.toml` gives fifteen functions
 * `timeout = 60`, and several of them budget nearly all of it — the grounded
 * search behind `compare` allows itself 45s, `sync-profiles` budgets a 45s
 * pass, and `handle` fans out over six accounts. A 35s client deadline would
 * have aborted every one of those a full 25 seconds before the platform was
 * even finished, turning working-but-slow endpoints into "could not reach the
 * server" — the exact failure the `compare` block in netlify.toml was written
 * to fix, reintroduced from the other end of the wire.
 *
 * So this is a backstop, not a budget. It fires only when the platform itself
 * has already given up and no reply is ever coming, which is what it was added
 * for: a request that never settles holds one of the six connections a browser
 * allows per host, and a page whose images are queued behind two of those
 * loads none of them. Measured on the built app: 0 of 14 thumbnails while two
 * `/api` calls hung, 13 of 14 with the same two cut off.
 */
export const API_TIMEOUT_MS = 65_000

/**
 * `fetch` that gives up.
 *
 * `AbortSignal.timeout` rejects with a `TimeoutError`, which reads as a network
 * failure to callers already handling one — no call site needs a new branch.
 * Any signal the caller passes is respected as well, so a component that
 * unmounts mid-flight still cancels its own work.
 */
export function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  ms: number = API_TIMEOUT_MS,
): Promise<Response> {
  const timeout = AbortSignal.timeout(ms)
  const caller = init.signal
  return fetch(input, {
    ...init,
    // `AbortSignal.any` is what lets a caller's own cancellation and the
    // deadline coexist; without it, passing one would silently discard the
    // other.
    signal: caller ? AbortSignal.any([caller, timeout]) : timeout,
  })
}

/**
 * A response that could be JSON, or could be the platform's HTML apology.
 *
 * The failure this exists for: a function that exceeds its real time limit or
 * crashes is answered by Netlify, not by the function, with an HTML error
 * page. A caller that reaches straight for `res.json()` then throws
 * "Unexpected token '<'", and that parser complaint is what the office sees
 * instead of the thing that actually went wrong. The scan endpoint hit this
 * often enough that the office learned the phrase.
 *
 * So: look before parsing. A JSON content-type is read as JSON. Anything else
 * is read as text and turned into a sentence an office can act on, keyed off
 * the status the platform did manage to send. The one thing this never does
 * is surface a tag soup as an error message.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly isHtml: boolean,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function readJson<T>(res: Response): Promise<T> {
  const type = res.headers.get('content-type') ?? ''
  if (type.includes('application/json')) {
    // A JSON body, whether the status was ok or not: the endpoints put their
    // own error sentences in a JSON `error` field, and this preserves them.
    return (await res.json()) as T
  }

  // Not JSON. Read what did come back, but never put HTML on the screen.
  const raw = (await res.text().catch(() => '')).trim()
  const looksHtml = raw.startsWith('<') || type.includes('text/html')
  const message = looksHtml
    ? res.status === 502 || res.status === 504 || res.status === 500
      ? 'The scanner took too long and was cut off before it answered. Try again, or select fewer mastheads so it can finish inside its time limit.'
      : `The service answered with a page instead of data (${res.status || 'no status'}). Try again in a moment.`
    : raw.slice(0, 160) || `The service gave an empty reply (${res.status || 'no status'}).`
  throw new ApiError(message, res.status, looksHtml)
}
