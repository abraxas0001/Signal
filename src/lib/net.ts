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
