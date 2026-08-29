import type { Config } from '@netlify/functions'
import handler from './daily-scan.mts'

/**
 * The 06:50 IST alarm clock, and nothing else.
 *
 * `daily-scan` wants two lives: a scheduled morning run, and a URL an office
 * can hit by hand from its own machine. Netlify refuses a function that has
 * both — a schedule in netlify.toml beside a `path` in the function's own
 * Config fails the whole build with "Scheduled functions must not specify a
 * custom path", which is exactly how deploy 28f630e died. So the schedule
 * lives here, on a wrapper whose only job is to invoke the same handler the
 * URL invokes, and neither life costs the other.
 *
 * 01:20 UTC is 06:50 IST — the server's reading lands before the client's
 * own 07:30 boundary rather than racing it.
 */
export default async (): Promise<Response> =>
  handler(new Request('https://scheduled.internal/api/daily-scan'), {} as never)

export const config: Config = {
  schedule: '20 1-6 * * *',
}
