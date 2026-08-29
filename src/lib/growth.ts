import type { TrackedHandle } from '@/lib/handles'

/**
 * Follower growth against last week, from readings actually taken.
 *
 * The rule that shapes everything here: one reading is a number, not a trend.
 * A handle measured once has no growth, and rendering 0% for it would assert a
 * steadiness nobody measured — the exact confident-but-unsupported claim this
 * product exists to catch. So a handle without a usable baseline returns null
 * deltas, and the screen says plainly when the next collection will change
 * that.
 *
 * The baseline is the most recent reading at least twenty hours older than
 * the latest, preferring one taken six to nine days before it. A full day
 * apart is a real day-over-day reading and a desk read daily should say what
 * changed since yesterday rather than sit silent until Thursday — the card
 * names the baseline's actual date, so a day never masquerades as a week.
 * Under twenty hours is the same morning talking to itself, and that stays
 * refused.
 */

const DAY_MS = 86_400_000

export interface FollowerReading {
  followers: number
  takenAt: string
}

export interface HandleGrowth {
  id: string
  platform: TrackedHandle['platform']
  name: string
  /** The newest follower reading. Null when the handle was never read at all. */
  latest: FollowerReading | null
  /**
   * The reading the delta is measured against. Null when only one reading
   * exists, or when every earlier reading is too recent to compare honestly.
   */
  baseline: FollowerReading | null
  /** latest − baseline. Null whenever baseline is null — never a fabricated 0. */
  delta: number | null
  /** Percentage change on the baseline. Null when it cannot be computed. */
  pct: number | null
}

/** Every reading of this handle that actually carries a follower count. */
function readings(h: TrackedHandle): FollowerReading[] {
  return h.snapshots
    .filter((s) => typeof s.followers === 'number' && Number.isFinite(Date.parse(s.takenAt)))
    .map((s) => ({ followers: s.followers as number, takenAt: s.takenAt }))
    .sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt))
}

export function growthFor(h: TrackedHandle): HandleGrowth {
  const all = readings(h)
  const latest = all[all.length - 1] ?? null

  const empty: HandleGrowth = {
    id: h.id,
    platform: h.platform,
    name: h.displayName || h.handle,
    latest,
    baseline: null,
    delta: null,
    pct: null,
  }
  if (!latest || all.length < 2) return empty

  const latestAt = Date.parse(latest.takenAt)
  // Old enough to compare against. Under twenty hours is the same morning
  // talking to itself; a day apart is a reading.
  const candidates = all
    .slice(0, -1)
    .filter((r) => latestAt - Date.parse(r.takenAt) >= (20 / 24) * DAY_MS)
  if (candidates.length === 0) return empty

  // Prefer a reading six to nine days old — the closest thing to "last week"
  // that was actually taken — and within that band the one nearest seven days.
  const weekOld = candidates.filter((r) => {
    const age = latestAt - Date.parse(r.takenAt)
    return age >= 6 * DAY_MS && age <= 9 * DAY_MS
  })
  const baseline =
    weekOld.length > 0
      ? weekOld.reduce((best, r) =>
          Math.abs(latestAt - Date.parse(r.takenAt) - 7 * DAY_MS) <
          Math.abs(latestAt - Date.parse(best.takenAt) - 7 * DAY_MS)
            ? r
            : best,
        )
      : // Otherwise the most recent reading that clears the three-day floor.
        candidates[candidates.length - 1]!

  const delta = latest.followers - baseline.followers
  return {
    ...empty,
    baseline,
    delta,
    pct: baseline.followers > 0 ? (delta / baseline.followers) * 100 : null,
  }
}

export interface GrowthSummary {
  /** Handles with a real baseline, so their deltas are measurements. */
  measured: HandleGrowth[]
  /** Handles read at least once but without a comparable earlier reading. */
  single: HandleGrowth[]
  /** Sum of measured deltas. Null when nothing was measurable. */
  totalDelta: number | null
  /** The total delta as a share of the summed baselines. */
  totalPct: number | null
  /** Per-platform deltas, only over the measured handles. */
  byPlatform: { platform: TrackedHandle['platform']; delta: number; pct: number | null }[]
}

export function growthSummary(handles: TrackedHandle[]): GrowthSummary {
  const grown = handles.map(growthFor).filter((g) => g.latest !== null)
  const measured = grown.filter((g) => g.baseline !== null)
  const single = grown.filter((g) => g.baseline === null)

  if (measured.length === 0) {
    return { measured, single, totalDelta: null, totalPct: null, byPlatform: [] }
  }

  const totalDelta = measured.reduce((s, g) => s + (g.delta ?? 0), 0)
  const totalBase = measured.reduce((s, g) => s + (g.baseline?.followers ?? 0), 0)

  const byPlatform = new Map<
    TrackedHandle['platform'],
    { delta: number; base: number }
  >()
  for (const g of measured) {
    const entry = byPlatform.get(g.platform) ?? { delta: 0, base: 0 }
    entry.delta += g.delta ?? 0
    entry.base += g.baseline?.followers ?? 0
    byPlatform.set(g.platform, entry)
  }

  return {
    measured,
    single,
    totalDelta,
    totalPct: totalBase > 0 ? (totalDelta / totalBase) * 100 : null,
    byPlatform: [...byPlatform.entries()]
      .map(([platform, v]) => ({
        platform,
        delta: v.delta,
        pct: v.base > 0 ? (v.delta / v.base) * 100 : null,
      }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
  }
}
