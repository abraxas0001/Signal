import { isDemoScope, scopedKey } from '@/lib/store'

/**
 * More than one politician on one desk.
 *
 * The desk is set up for ONE person — the name given in "who is this desk for",
 * which decides the news scan's search terms, the dashboard's face and every
 * greeting. That person is the PRIMARY, and nothing here can change who they
 * are; changing them means going back to setup, which is the honest place for
 * a decision that reconfigures the whole product.
 *
 * What this adds is the ability to keep a SECOND desk beside it — an ally, a
 * rival, a colleague the office also watches — with its own tracked accounts,
 * its own follower readings and its own opinion cache, and to switch between
 * them. The example desk has done exactly this since it shipped: five
 * politicians, five separate desks, one switch. This is that mechanism for
 * real accounts, with one difference that matters — the demo can rebuild a
 * desk from a bundled dataset on every switch (`applyPrincipal` calls
 * `replaceAllHandles`), and real desks cannot, because their readings were
 * fetched over minutes and must survive the switch.
 *
 * SO IT SCOPES RATHER THAN REPLACES. Every per-desk cache already goes through
 * `scopedKey`, which separates one signed-in ACCOUNT from another. This adds a
 * second suffix underneath it, for the persona:
 *
 *   signal.handles.v1                       primary, on the default account
 *   signal.handles.v1::acc9f2               primary, on a second account
 *   signal.handles.v1::acc9f2::p-modi       a secondary persona on that account
 *
 * THE PRIMARY CARRIES NO SUFFIX, deliberately. A desk that never adds a second
 * persona reads and writes exactly the keys it always did, so there is no
 * migration, nothing to back-fill, and no version of this that can lose an
 * existing office its follower history. It also keeps desk sync working: the
 * bases in `lib/desk-session.ts` are the unsuffixed names, so a handed-over
 * desk syncs its primary and leaves the personas local — which is the correct
 * trade rather than an oversight. A persona is a thing this office is looking
 * at; the desk the office was handed is what the office IS.
 */

export interface Persona {
  /** Stable, slug-shaped, and the storage suffix. Never reused or renamed. */
  key: string
  name: string
  role: string | null
  constituency: string | null
  state: string | null
  party: string | null
  photoUrl: string | null
  addedAt: string
}

/**
 * The list, and which one is open.
 *
 * Account-scoped, NOT persona-scoped — `scopedKey` and not `personaKey`. A
 * persona list stored inside a persona's own namespace would be invisible from
 * every other persona, so switching away from one would lose the way back.
 */
const LIST_KEY = (): string => scopedKey('signal.personas.v1')
const ACTIVE_KEY = (): string => scopedKey('signal.personas.active.v1')

/** The primary persona's key. Empty, because the primary has no suffix. */
export const PRIMARY = ''

const listeners = new Set<() => void>()

export function subscribePersonas(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify(): void {
  for (const fn of listeners) fn()
}

export function listPersonas(): Persona[] {
  try {
    const raw = localStorage.getItem(LIST_KEY())
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p): p is Persona => {
      const r = p as Partial<Persona>
      return typeof r?.key === 'string' && r.key.length > 0 && typeof r?.name === 'string'
    })
  } catch {
    return []
  }
}

function writeList(next: Persona[]): void {
  try {
    localStorage.setItem(LIST_KEY(), JSON.stringify(next))
  } catch {
    /* a full disk loses the persona, never the desk it was added from */
  }
}

/**
 * Which persona is open.
 *
 * Validated against the list on every read rather than trusted. A stored key
 * whose persona has been deleted would otherwise point the whole dashboard at
 * a namespace nothing writes to — an empty desk with a name in the greeting
 * and no way to tell it from a desk that has simply not been read yet.
 */
export function activePersona(): string {
  // THE EXAMPLE DESK IS NEVER PERSONA-SCOPED. It has its own switcher over the
  // same storage — `DemoBar` picks one of five principals and `applyPrincipal`
  // rewrites the tracked list wholesale. Two independent "whose desk is this"
  // mechanisms layered on one key is not a tidiness problem, it is a
  // correctness one: the demo would write the new principal's accounts under
  // one suffix while the dashboard read another, and the previous
  // politician's followers would stay on screen and be summed into the new
  // one's totals. Returning PRIMARY here takes the suffix off every key in
  // the demo, which leaves the demo exactly as it was before personas existed.
  if (isDemoScope()) return PRIMARY
  try {
    const key = localStorage.getItem(ACTIVE_KEY()) ?? PRIMARY
    if (key === PRIMARY) return PRIMARY
    return listPersonas().some((p) => p.key === key) ? key : PRIMARY
  } catch {
    return PRIMARY
  }
}

/**
 * Whether this desk may keep personas at all.
 *
 * False inside the example desk, which switches politician its own way. The
 * bar hides itself rather than rendering a second switcher that would disagree
 * with the first one.
 */
export function personasAvailable(): boolean {
  return !isDemoScope()
}

export function setActivePersona(key: string): void {
  // Refused in the demo for the same reason `activePersona` ignores it there:
  // nothing in the example desk may move the suffix its own switcher writes
  // under.
  if (isDemoScope()) return
  try {
    if (key === PRIMARY) localStorage.removeItem(ACTIVE_KEY())
    else localStorage.setItem(ACTIVE_KEY(), key)
  } catch {
    /* the switch still holds for this render; it just will not survive a reload */
  }
  notify()
}

/** The persona currently open, or null when that is the primary. */
export function activePersonaEntry(): Persona | null {
  const key = activePersona()
  if (key === PRIMARY) return null
  return listPersonas().find((p) => p.key === key) ?? null
}

/**
 * THE KEY FOR ANYTHING THAT IS ABOUT A PARTICULAR POLITICIAN.
 *
 * Two scopes in one, and the distinction is the whole point:
 *
 *   scopedKey(base)  — separates one signed-in ACCOUNT from another. Correct
 *                      for anything that belongs to the person USING the app:
 *                      the report history, display preferences, the persona
 *                      list itself.
 *   deskKey(base)    — separates one DESK from another as well. Correct for
 *                      anything derived from who the desk is ABOUT: tracked
 *                      accounts, follower readings, opinion, news relevance,
 *                      post ideas, posters, the week against rivals.
 *
 * Getting this wrong is not a namespacing nicety. `signal.postPlan.v1`
 * describes itself as "one plan per desk per day" and was keyed per ACCOUNT,
 * so switching to another politician's desk would have handed back the
 * previous one's plan, built from the previous one's grievances, under the new
 * one's name. Every cache in the second list has that shape.
 *
 * The primary desk adds no suffix, so a device that never opens a second desk
 * reads and writes exactly the keys it always did.
 */
export function deskKey(base: string): string {
  const account = scopedKey(base)
  const key = activePersona()
  return key === PRIMARY ? account : `${account}::p-${key}`
}

/**
 * A key from a name: lowercase, ASCII, hyphenated.
 *
 * It ends up inside a localStorage key, so a Telugu name or a slash would
 * produce something unreadable in devtools at best. A name that reduces to
 * nothing (entirely non-Latin) falls back to a timestamp, because a persona
 * with no key is a persona that silently shares the primary's namespace —
 * which would merge two politicians' accounts into one desk.
 */
function keyFrom(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || `p${Date.now().toString(36)}`
  if (!taken.has(base)) return base
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

export interface NewPersona {
  name: string
  role?: string | null
  constituency?: string | null
  state?: string | null
  party?: string | null
  photoUrl?: string | null
}

/**
 * Add a persona and open it.
 *
 * Returns the existing entry when the name is already on the list rather than
 * creating a second namespace for the same politician — an office that adds
 * "Narendra Modi" twice means the one it already has, and a duplicate would
 * split his accounts across two desks that each look half-read.
 */
export function addPersona(input: NewPersona): Persona {
  const name = input.name.trim()
  const list = listPersonas()
  const existing = list.find((p) => p.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())
  if (existing) {
    setActivePersona(existing.key)
    return existing
  }

  const persona: Persona = {
    key: keyFrom(name, new Set(list.map((p) => p.key))),
    name,
    role: input.role ?? null,
    constituency: input.constituency ?? null,
    state: input.state ?? null,
    party: input.party ?? null,
    photoUrl: input.photoUrl ?? null,
    addedAt: new Date().toISOString(),
  }
  writeList([...list, persona])
  setActivePersona(persona.key)
  return persona
}

/**
 * Remove a persona and everything read for it.
 *
 * The caches are deleted here rather than left behind. A persona removed and
 * re-added under the same name would otherwise inherit the old one's follower
 * readings — months stale, presented as current — which is worse than starting
 * empty. The primary can never be removed: it is the desk itself.
 */
export function removePersona(key: string): void {
  if (key === PRIMARY) return
  writeList(listPersonas().filter((p) => p.key !== key))
  const suffix = `::p-${key}`
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (k && k.endsWith(suffix)) doomed.push(k)
    }
    for (const k of doomed) localStorage.removeItem(k)
  } catch {
    /* the entry is gone from the list either way, which is what the UI reads */
  }
  if (activePersona() === key) setActivePersona(PRIMARY)
  else notify()
}
