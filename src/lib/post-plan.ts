import type { Identity } from '@shared/identity'
import type { LandsReading, PlatformReach, RankedIssue } from '@/lib/briefing'
import { readStandingCache, type TrackedHandle } from '@/lib/handles'
import { weekOf } from '@/lib/week'
import { scopedKey } from '@/lib/store'
import { deskKey } from '@/lib/personas'
import { fetchWithTimeout } from '@/lib/net'
import { compact } from '@/lib/utils'

/**
 * The weekly content plan: the desk's own evidence, sent once, and four or
 * five worked-out plans back — steps a staffer can execute, drafts with
 * [blanks] where a real fact must be filled in.
 *
 * The payload is assembled HERE, from the same memos the dashboard already
 * computed, so the plan can only ever cite what the screens above it show:
 * the reach card's numbers, the what-works arithmetic, the verbatim praise
 * and criticism, this week's grievance issues, and what worked for rivals.
 */

export interface PostPlan {
  title: string
  platform: string
  priority: 'High' | 'Medium'
  why: string
  steps: string[]
  draft: string
}

export interface PlanResult {
  plans: PostPlan[]
  readAt: string
}

export interface PlanInput {
  identity: Identity | null
  reach: PlatformReach[]
  lands: LandsReading
  ownHandles: TrackedHandle[]
  allHandles: TrackedHandle[]
  issues: RankedIssue[]
}

/** True when there is enough measured evidence for a plan to stand on. */
export function planReady(input: PlanInput): boolean {
  return (
    input.identity !== null &&
    input.lands.working.length + input.lands.notLanding.length + input.issues.length > 0
  )
}

function payloadOf(input: PlanInput): Record<string, unknown> {
  const { identity, reach, lands, ownHandles, allHandles, issues } = input

  const praise: string[] = []
  const criticism: string[] = []
  for (const h of ownHandles) {
    const s = readStandingCache(h.id)
    if (!s) continue
    praise.push(...s.praise)
    criticism.push(...s.criticism)
  }

  const week = weekOf(allHandles)
  const rivalHits =
    week?.rows
      .filter((r) => !r.own)
      .flatMap((r) =>
        r.top
          .slice(0, 2)
          .map((p) => `${r.name} on ${p.platform}: "${p.title}" drew ${compact(p.reactions)} reactions`),
      ) ?? []

  return {
    person: {
      name: identity?.name,
      role: identity?.role,
      party: identity?.party,
      constituency: identity?.constituency,
    },
    reach: reach.map(
      (r) =>
        `${r.platform}: ${r.followers == null ? 'followers unread' : `${compact(r.followers)} followers`}${
          r.postsTotal != null ? `, ${compact(r.postsTotal)} lifetime posts` : ''
        }${r.reactions != null ? `, ${compact(r.reactions)} reactions on the last ${r.posts}` : ''}`,
    ),
    working: lands.working.map((f) => `${f.label} - ${f.evidence}`),
    notLanding: lands.notLanding.map((f) => `${f.label} - ${f.evidence}`),
    praise: [...new Set(praise)].slice(0, 6),
    criticism: [...new Set(criticism)].slice(0, 6),
    issues: issues.map((i) => `${i.title} (${i.severity}${i.summary ? `): ${i.summary}` : ')'}`),
    rivalHits: rivalHits.slice(0, 6),
  }
}

/* ── cache: one plan per desk per day ────────────────────────────────────── */

const CACHE_KEY = (): string => deskKey('signal.postPlan.v1')
const today = (): string => new Date().toISOString().slice(0, 10)

export function readPlanCache(): PlanResult | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY())
    if (!raw) return null
    const all = JSON.parse(raw) as Record<string, PlanResult>
    return all[today()] ?? null
  } catch {
    return null
  }
}

function savePlanCache(plan: PlanResult): void {
  try {
    localStorage.setItem(CACHE_KEY(), JSON.stringify({ [today()]: plan }))
  } catch {
    /* over quota: the plan still shows this session */
  }
}

export async function loadPostPlan(input: PlanInput, force = false): Promise<PlanResult> {
  if (!force) {
    const cached = readPlanCache()
    if (cached) return cached
  }
  const res = await fetchWithTimeout(
    '/api/post-plan',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payloadOf(input)),
    },
    60_000,
  )
  // The body can be a plain-text stack on a platform timeout; a JSON.parse
  // crash here would show the office "Unexpected token 'T'" instead of a
  // sentence.
  let body: Partial<PlanResult> & { error?: string }
  try {
    body = (await res.json()) as Partial<PlanResult> & { error?: string }
  } catch {
    throw new Error(`The plan took too long to draft (HTTP ${res.status}). Try again.`)
  }
  if (!res.ok || body.error || !Array.isArray(body.plans)) {
    throw new Error(body.error ?? `The plan could not be drafted (HTTP ${res.status}).`)
  }
  const result = body as PlanResult
  savePlanCache(result)
  return result
}
