import type { Identity, IdentityField } from '@shared/identity'
import { statedIdentity } from '@shared/identity'
import { resolvePlace } from '@shared/places'
import { planWatchTerms } from '@/lib/autoconfig'
import { update } from '@/lib/store'
import { fetchWithTimeout } from '@/lib/net'

/**
 * The client half of working out whose desk this is.
 *
 * Thin on purpose. Everything that decides what is true happens on the server,
 * where the pages are actually fetched — a browser cannot read a Wikipedia
 * article cross-origin, and a client that could would be one an office could
 * point at its own intranet. This module calls that endpoint, keeps the result
 * honest on the way in, and writes it to the store.
 */

export interface ResolveInput {
  url?: string
  name?: string
  role?: string
  constituency?: string
  state?: string
}

export interface ResolveOutcome {
  identity: Identity | null
  error: string | null
}

/** Longer than the other endpoints: this reads up to three pages and a model. */
const TIMEOUT_MS = 35_000

/**
 * Ask the server who this is.
 *
 * Never throws. Every failure path returns an outcome with a sentence the
 * office can act on, because this runs on the first screen anybody sees and a
 * thrown error there is a white page on somebody's first morning.
 */
export async function resolveIdentity(input: ResolveInput): Promise<ResolveOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetchWithTimeout('/api/identity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    })

    const payload = (await res.json().catch(() => null)) as
      | { identity?: Identity | null; error?: string }
      | null

    if (!res.ok || !payload?.identity) {
      return {
        identity: null,
        error:
          payload?.error ??
          (res.status === 429
            ? 'That has been tried a few times in a row. Wait a minute and try again.'
            : 'The profile could not be read just now. You can type the details in instead.'),
      }
    }

    return { identity: normalise(payload.identity), error: null }
  } catch (err) {
    if (controller.signal.aborted) {
      return {
        identity: null,
        error:
          'Reading that profile took too long. Try again, or type the details in. That is quicker and the result is more accurate.',
      }
    }
    return {
      identity: null,
      error:
        err instanceof Error && err.message
          ? `Could not reach the server: ${err.message}`
          : 'Could not reach the server.',
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Make a payload from the network safe to render.
 *
 * The endpoint is ours and its shape is checked there, but this is the boundary
 * where a deployed-yesterday front end meets a deployed-today function, and a
 * missing array here is a blank screen rather than a missing field. Every list
 * is coerced and every string is bounded.
 */
function normalise(raw: Identity): Identity {
  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  const str = (v: unknown, cap: number): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, cap) : null

  return {
    name: str(raw.name, 120) ?? 'Unnamed',
    aliases: list<string>(raw.aliases).filter((a) => typeof a === 'string').slice(0, 12),
    photoUrl: httpsOnly(raw.photoUrl),
    role: str(raw.role, 120),
    party: str(raw.party, 120),
    constituency: str(raw.constituency, 120),
    district: str(raw.district, 120),
    state: str(raw.state, 80),
    age: typeof raw.age === 'number' && raw.age > 17 && raw.age < 111 ? Math.round(raw.age) : null,
    dateOfBirth: str(raw.dateOfBirth, 40),
    education: str(raw.education, 200),
    inOfficeSince: str(raw.inOfficeSince, 60),
    bio: str(raw.bio, 900),
    handles: list<Identity['handles'][number]>(raw.handles)
      .filter((h) => h && typeof h.url === 'string' && /^https?:\/\//i.test(h.url))
      .slice(0, 10),
    watchTerms: list<string>(raw.watchTerms).slice(0, 24),
    confidence: (raw.confidence ?? {}) as Identity['confidence'],
    origin: (raw.origin ?? {}) as Identity['origin'],
    sources: list<Identity['sources'][number]>(raw.sources).slice(0, 8),
    notes: list<string>(raw.notes).slice(0, 8),
    resolvedAt: str(raw.resolvedAt, 40) ?? new Date().toISOString(),
  }
}

/**
 * A photograph address the page can actually load.
 *
 * An http image on an https page is blocked as mixed content and renders as a
 * broken icon on the one element that says whose desk this is. A data URI would
 * render, and is refused anyway — it is not something a profile page hands out,
 * so seeing one means something has gone wrong upstream.
 */
function httpsOnly(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/**
 * Record who this desk is for, and mark setup done.
 *
 * Watch terms are recomputed here rather than trusted from the payload, because
 * by this point the office may have corrected the constituency on the review
 * screen — and a scan still keyed on the wrong seat is the most expensive kind
 * of stale, since it fails by finding nothing rather than by erroring.
 */
export function saveIdentity(identity: Identity): void {
  // Planned with the same function the news scan is configured from, not with
  // a second implementation that happens to look similar. They had drifted
  // already: the identity card listed five terms while the scanner searched
  // eight, so Settings showed an office a list of words that was not the list
  // being searched. One of those two numbers is a lie whichever way round it
  // is, and there is no way for a reader to tell which.
  const withTerms: Identity = {
    ...identity,
    watchTerms: planWatchTerms(
      identity,
      resolvePlace({
        state: identity.state,
        district: identity.district,
        constituency: identity.constituency,
      }),
    ),
  }

  update((s) => ({
    ...s,
    identity: withTerms,
    onboardedAt: s.onboardedAt ?? new Date().toISOString(),
    // The scanning profile is seeded from the identity the first time only.
    // After that it belongs to whoever has been editing it on the Accounts
    // screen, and silently rewriting their watch terms from an identity refresh
    // would undo an afternoon's tuning.
    profile:
      s.profile ??
      (identity.constituency
        ? {
            subject: identity.name,
            constituency: identity.constituency,
            watchTerms: withTerms.watchTerms,
            state: identity.state ?? undefined,
          }
        : null),
  }))
}

/** Finish setup without saying who this is. */
export function skipOnboarding(): void {
  update((s) => ({ ...s, onboardedAt: s.onboardedAt ?? new Date().toISOString() }))
}

/**
 * Apply an edit made on the review screen.
 *
 * An edited field becomes `stated` and stops carrying doubt — the office has
 * just told us, and continuing to render their own correction as "unconfirmed"
 * is the app arguing with the only authority it has.
 */
export function editField(
  identity: Identity,
  field: IdentityField,
  value: string | null,
): Identity {
  const next: Identity = { ...identity }
  const trimmed = value?.trim() || null

  switch (field) {
    case 'name':
      next.name = trimmed ?? identity.name
      break
    case 'role':
    case 'party':
    case 'constituency':
    case 'district':
    case 'state':
    case 'education':
    case 'inOfficeSince':
    case 'bio':
      next[field] = trimmed
      break
    case 'age': {
      const n = trimmed ? Number(trimmed) : NaN
      next.age = Number.isFinite(n) && n > 17 && n < 111 ? Math.round(n) : null
      break
    }
    default:
      return identity
  }

  return {
    ...next,
    confidence: { ...identity.confidence, [field]: 'high' },
    origin: { ...identity.origin, [field]: 'stated' },
  }
}

/** Build the fallback identity for an office that types its own details. */
export { statedIdentity }

/**
 * One person the search offered, as the endpoint returns them.
 *
 * Mirrors PersonCandidate in netlify/functions/lib/identity.ts. Declared again
 * rather than imported because the function directory is not in the browser
 * bundle's path, and a type-only import across that boundary is a build-order
 * dependency for no runtime gain.
 */
export interface PersonCandidate {
  name: string
  description: string | null
  url: string
  thumbnail: string | null
  person: boolean
}

/**
 * Is this an address rather than a name?
 *
 * Deliberately loose. It decides whether the setup box searches an index or
 * resolves a page, and both branches are recoverable — the cost of guessing
 * wrong is one wasted request, not a dead end. "x.com/handle" has to count:
 * people paste that far more often than they paste a full https address.
 */
export function looksLikeUrl(value: string): boolean {
  const trimmed = value.trim()
  if (/^https?:\/\//i.test(trimmed)) return true
  // A bare domain: no spaces, a dot with something either side, and a path or
  // a known-looking TLD. "D. K. Aruna" must not match, so a space disqualifies.
  return !/\s/.test(trimmed) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(trimmed)
}
