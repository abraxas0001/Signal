import type { Report } from '@shared/types'
import { isDemoScope, isDeskScope, scopedKey } from '@/lib/store'
import { fetchWithTimeout } from '@/lib/net'

/**
 * Every full report this desk can lay hands on, keyed by the post's URL.
 *
 * Two sources, deliberately in this order of authority:
 *
 *   1. The analysis history on this device — reports the reader actually ran,
 *      stored by the Analyse screen under `signal:history:v1`. These win any
 *      collision, because a reading the office asked for this week beats one
 *      shipped with the example dataset.
 *   2. On the example desk only, `/demo-reports.json` — pre-generated full
 *      reports for the demo politicians' own posts, so the dashboard's
 *      highlights section has something real to expand on a fresh device.
 *
 * The demo file may be absent or half-written while its generator is still
 * running; both read as an empty map rather than an error. Nothing here ever
 * invents a report, and a post with no entry in the map simply has not been
 * read in full yet — the screen says exactly that.
 */

/** Enough of a Report to render: an id and a snapshot. Anything less is noise. */
function looksLikeReport(v: unknown): v is Report {
  if (!v || typeof v !== 'object') return false
  const r = v as { id?: unknown; snapshot?: unknown }
  return typeof r.id === 'string' && typeof r.snapshot === 'object' && r.snapshot !== null
}

/** The reports the reader ran themselves, straight out of the history key. */
function historyReports(): Map<string, Report> {
  const out = new Map<string, Report>()
  try {
    const raw = localStorage.getItem(scopedKey('signal:history:v1'))
    if (!raw) return out
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return out
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as { url?: unknown; report?: unknown }
      if (typeof e.url === 'string' && looksLikeReport(e.report)) out.set(e.url, e.report)
    }
  } catch {
    /* a corrupt history is an empty map, never a crash on the dashboard */
  }
  return out
}

/**
 * Cached at module level because the file is fetched from this origin, does
 * not change within a session, and can run to megabytes — refetching it every
 * time the dashboard re-renders would be pure waste. A failed or absent file
 * caches as empty; a page reload is the retry, which matches how often the
 * generator actually finishes.
 */
let demoReportsPromise: Promise<Map<string, Report>> | null = null

function demoReports(): Promise<Map<string, Report>> {
  demoReportsPromise ??= (async () => {
    const out = new Map<string, Report>()
    try {
      const res = await fetchWithTimeout('/demo-reports.json')
      if (!res.ok) return out
      const payload = (await res.json()) as { reports?: Record<string, unknown> } | null
      const reports = payload?.reports
      if (!reports || typeof reports !== 'object') return out
      for (const [url, report] of Object.entries(reports)) {
        if (looksLikeReport(report)) out.set(url, report)
      }
    } catch {
      /* absent, partial or unparseable: the demo simply has no reports yet */
    }
    return out
  })()
  return demoReportsPromise
}

/**
 * The combined map. Async because the demo half may need a fetch; on a real
 * desk it resolves immediately from localStorage alone.
 */
export async function loadPostReports(): Promise<Map<string, Report>> {
  /**
   * Shipped reports load on the example desk AND on a handed-over desk. The
   * handed-over desk carries the same posts the office generated reports for,
   * and without this branch a member signing into her own desk saw "none of
   * your posts has been read" over posts the office had read in full. The map
   * is keyed by exact post URL, so on any desk tracking other posts the file
   * contributes nothing.
   */
  const out = isDemoScope() || isDeskScope() ? new Map(await demoReports()) : new Map<string, Report>()
  // History second, so the reader's own fresher reading overwrites the
  // shipped one for the same URL.
  for (const [url, report] of historyReports()) out.set(url, report)
  return out
}
