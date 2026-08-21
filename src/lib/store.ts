import { useEffect, useState } from 'react'
import type {
  ActionItem,
  GrievanceRecord,
  Influencer,
  InfluencerMention,
  IssueCluster,
  OfficeProfile,
} from '@shared/grievance'
/**
 * The persona tracker owns these two shapes, so they are imported from it
 * rather than declared here or added to @shared/grievance — the endpoint behind
 * that screen models the same records server-side, and two authorities for one
 * shape is how they drift apart. The import is type-only and erases completely,
 * so nothing circular reaches the bundle.
 */
import type { PersonaMention, TrackedPersona } from '@/components/Persona'
import type { Identity } from '@shared/identity'
import type { OpinionSurvey } from '@/lib/opinion'

/**
 * One owner of on-device state.
 *
 * Before this, each feature invented its own localStorage key and its own
 * shape. That is survivable while there is one feature and fatal once there
 * are six: nothing can be locked behind a passphrase, migrated, exported or
 * synced if no single thing knows what "the data" is.
 *
 * Everything stays on the device deliberately. This data names private
 * citizens, serving officials and unproven allegations, and the office has no
 * hosting agreement, no retention policy and nobody accountable for a breach.
 * A server can be added later — the codec seam below is where encryption and
 * sync go — but it is not something to slip in quietly.
 */

/**
 * The default storage key, and the one every pre-accounts device wrote to.
 *
 * Still exported and still the fallback, but no longer the only place records
 * live: once several people share a device, each account owns its own key and
 * `setStorageKey` points this module at the one belonging to whoever is signed
 * in. Keeping the constant unchanged is what lets the vault recognise and adopt
 * a device that was locked before accounts existed.
 */
export const STORE_KEY = 'signal:store'
export const STORE_VERSION = 1

/**
 * Which localStorage key reads and writes currently land on.
 *
 * Module-level rather than threaded through every call because `readStore` and
 * `useStore` are called from a dozen components that have no business knowing
 * an account exists. The vault is the only thing that sets this, and it sets it
 * in the same breath as it installs the codec — the two must move together, or
 * one account's plaintext would be sealed into another's blob.
 */
let storageKey: string = STORE_KEY

export function activeStorageKey(): string {
  return storageKey
}

/**
 * Scope a localStorage key to whoever is signed in.
 *
 * The main store has been per-account since accounts existed. Four other caches
 * were not, and that was a real leak rather than an oversight with no
 * consequence: `signal.handles.v1` holds which accounts an office watches and
 * which are its own, `signal.standing.v1` holds the actual text of comments
 * real people left on those accounts, and both sat at one device-wide key. Sign
 * in as somebody else and you were shown the previous person's tracked handles
 * and the public opinion measured on them — on a product whose entire promise
 * is that these records stay separate.
 *
 * They are also outside the vault's codec, so they stayed in cleartext while
 * the store beside them was sealed. Scoping does not fix that second half; it
 * fixes the half where one account can read another's.
 *
 * The default account's keys are returned unchanged, so a device that has never
 * had a second account needs no migration and loses nothing.
 */
export function scopedKey(base: string): string {
  if (storageKey === STORE_KEY) return base
  // `signal:store:ab12` -> `ab12`, appended so the two namespaces stay legible
  // in devtools rather than becoming opaque hashes.
  const discriminator = storageKey.slice(STORE_KEY.length + 1)
  return discriminator ? `${base}::${discriminator}` : base
}

/**
 * Point the store at an account's storage.
 *
 * Clearing the cache is not optional. Without it, switching accounts would hand
 * the next person the previous person's records straight out of memory — the
 * exact separation this exists to provide — and the first write under the new
 * account would then seal them into the new account's blob.
 */
export function setStorageKey(next: string): void {
  if (storageKey === next) return
  storageKey = next
  cache = null
  emit()
}

export interface Store {
  version: number
  profile: OfficeProfile | null
  /**
   * Whose desk this is.
   *
   * Held apart from `profile` rather than folded into it. `profile` is the
   * scanning configuration — which mastheads to read, which words mean us — and
   * it is edited constantly. This is the answer to "who are you", which is
   * asked once at setup and then only corrected. Merging them would mean a
   * routine edit to a watch term rewrites the identity card, and it is the
   * identity card that decides whether the whole dashboard is about the right
   * person.
   */
  identity: Identity | null
  /**
   * Whether setup has been completed, including by being declined.
   *
   * Separate from `identity !== null` on purpose: somebody who skips setup has
   * finished it, and must not be asked again on every load. Without this the
   * office that chose to go straight to pasting links gets the setup screen
   * every morning.
   */
  onboardedAt: string | null
  grievances: GrievanceRecord[]
  issues: IssueCluster[]
  actions: ActionItem[]
  influencers: Influencer[]
  mentions: InfluencerMention[]
  /**
   * Named people the office follows through the papers, and what was found
   * about them. These live here rather than in a key of their own because the
   * vault encrypts exactly one key: a roster of private citizens and unproven
   * allegations sitting outside it would be the one thing on the device written
   * in cleartext.
   */
  personas: TrackedPersona[]
  personaMentions: PersonaMention[]
  /**
   * Stories the morning scan found and nobody has read yet.
   *
   * Held apart from `personaMentions`, which are stories that have actually
   * been read by the model. A candidate is a headline that matched a search
   * word — a claim that something exists, checkable against the headline
   * itself. A mention is a claim about what a story says. Storing them in one
   * list would mean the dashboard could not tell an office which of the two it
   * was showing them.
   */
  newsCandidates: { url: string; title: string; portal: string }[]
  /** When the papers were last read. Drives the once-a-morning scan. */
  lastScanAt: string | null
  /**
   * When the local-media roster was searched for, whether or not it found any.
   *
   * Stamped even on a miss: a seat with no local YouTube channels must not be
   * re-searched on every dashboard load forever, and "we looked and found
   * nothing" is a different state from "we have not looked".
   */
  influencersSeededAt: string | null
  /** When the local accounts were last read for mentions of this person. */
  influencersReadAt: string | null
  /**
   * Where the next check should start in the roster.
   *
   * A check reads at most eight accounts, and it used to always read the first
   * eight of them. On a roster of eighteen that meant accounts nine to eighteen
   * were never read — not "read later", never. The screen said so plainly ("the
   * other 10 were not checked at all") and the advice it implied, run it again,
   * would have re-read the same eight forever.
   *
   * The cursor lives here rather than on the server because there is no
   * database behind /api/influencers and no scheduled job holding state; the
   * client is the only thing with a memory. Each check rotates the roster by
   * this much before sending, then advances it, so consecutive checks walk the
   * whole list.
   */
  influencerScanOffset: number
  /**
   * When the web was searched for publisher pages dedicated to this person.
   *
   * Stamped even on a miss. A person no publisher maintains a tag page for is a
   * normal case, and re-running a grounded search plus eight page fetches on
   * every dashboard visit to rediscover that would be expensive and pointless.
   */
  newsSourcesSeededAt: string | null
  /**
   * What the published record says about this person.
   *
   * The answer to "what do people think" for every office that cannot reach its
   * own comment sections — which is most of them, since Facebook and Instagram
   * publish nothing to a server without a page token. Cached because it is a
   * grounded web search and a structuring call, and refreshed daily.
   */
  opinion: OpinionSurvey | null
  /** When the operator last opened the app, for the "since you looked" digest. */
  lastSeenAt: string | null
  updatedAt: string | null
}

export const emptyStore = (): Store => ({
  version: STORE_VERSION,
  profile: null,
  identity: null,
  onboardedAt: null,
  grievances: [],
  issues: [],
  actions: [],
  influencers: [],
  mentions: [],
  personas: [],
  personaMentions: [],
  newsCandidates: [],
  lastScanAt: null,
  influencersSeededAt: null,
  influencersReadAt: null,
  influencerScanOffset: 0,
  newsSourcesSeededAt: null,
  opinion: null,
  lastSeenAt: null,
  updatedAt: null,
})

/**
 * Bring an older payload up to the current shape.
 *
 * Written before there is a second version on purpose: the migration that gets
 * skipped is the one that had nowhere obvious to live, and the cost of an
 * empty switch now is nothing.
 */
function migrate(raw: unknown): Store {
  if (!raw || typeof raw !== 'object') return emptyStore()
  const data = raw as Partial<Store> & { version?: number }
  const base = emptyStore()

  // Unknown future version — refuse to downgrade rather than shed fields the
  // newer app was relying on.
  if (typeof data.version === 'number' && data.version > STORE_VERSION) {
    throw new Error(
      `This device holds data from a newer version of Signal (v${data.version}). Update the app rather than risk losing records.`,
    )
  }

  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

  return {
    ...base,
    profile: (data.profile as OfficeProfile | null) ?? null,
    identity: (data.identity as Identity | null) ?? null,
    onboardedAt: typeof data.onboardedAt === 'string' ? data.onboardedAt : null,
    grievances: list<GrievanceRecord>(data.grievances),
    issues: list<IssueCluster>(data.issues),
    actions: list<ActionItem>(data.actions),
    influencers: list<Influencer>(data.influencers),
    mentions: list<InfluencerMention>(data.mentions),
    // Named explicitly, like every other field: this function rebuilds the
    // store key by key, so anything it does not list is dropped the next time
    // the app opens. A roster that survived the session and vanished on reload
    // would look like the feature worked right up until it mattered.
    personas: list<TrackedPersona>(data.personas),
    personaMentions: list<PersonaMention>(data.personaMentions),
    newsCandidates: list<{ url: string; title: string; portal: string }>(data.newsCandidates),
    lastScanAt: typeof data.lastScanAt === 'string' ? data.lastScanAt : null,
    influencersSeededAt:
      typeof data.influencersSeededAt === 'string' ? data.influencersSeededAt : null,
    influencersReadAt:
      typeof data.influencersReadAt === 'string' ? data.influencersReadAt : null,
    influencerScanOffset:
      typeof data.influencerScanOffset === 'number' && Number.isFinite(data.influencerScanOffset)
        ? Math.max(0, Math.floor(data.influencerScanOffset))
        : 0,
    newsSourcesSeededAt:
      typeof data.newsSourcesSeededAt === 'string' ? data.newsSourcesSeededAt : null,
    opinion: (data.opinion as OpinionSurvey | null) ?? null,
    lastSeenAt: typeof data.lastSeenAt === 'string' ? data.lastSeenAt : null,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    version: STORE_VERSION,
  }
}

/**
 * The codec seam.
 *
 * Reads and writes go through these two, so adding at-rest encryption later is
 * a change here rather than a change everywhere. They are identity today.
 */
let encode: (s: Store) => string = (s) => JSON.stringify(s)
let decode: (raw: string) => unknown = (raw) => JSON.parse(raw) as unknown

export function setCodec(next: {
  encode: (s: Store) => string
  decode: (raw: string) => unknown
}): void {
  encode = next.encode
  decode = next.decode
  cache = null
  emit()
}

let cache: Store | null = null

export function readStore(): Store {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(storageKey)
    cache = raw ? migrate(decode(raw)) : emptyStore()
  } catch (err) {
    // A corrupt or unreadable payload must not brick the app. The bad value is
    // left in place rather than overwritten, so it can still be recovered by
    // hand — losing an office's records to a parse error would be unforgivable.
    if (err instanceof Error && err.message.startsWith('This device holds data')) throw err
    console.warn('Signal: could not read local store; starting empty.', err)
    cache = emptyStore()
  }
  return cache
}

export function writeStore(next: Store): Store {
  cache = { ...next, version: STORE_VERSION, updatedAt: new Date().toISOString() }
  try {
    localStorage.setItem(storageKey, encode(cache))
  } catch {
    /* private mode, or the quota is full — the session still works in memory */
  }
  emit()
  return cache
}

/**
 * Apply a change and persist it.
 *
 * The callback receives a shallow copy and returns the next store, so callers
 * cannot accidentally mutate the cached object and leave subscribers stale.
 */
export function update(fn: (s: Store) => Store): Store {
  return writeStore(fn({ ...readStore() }))
}

/**
 * Wipe the records of whoever is currently signed in. Used by "start fresh" and
 * by account deletion — deliberately scoped to the active key, so one person
 * clearing their own records cannot take another account's down with them.
 */
export function clearStore(): void {
  cache = emptyStore()
  try {
    localStorage.removeItem(storageKey)
  } catch {
    /* nothing to remove */
  }
  emit()
}

// ── subscriptions ────────────────────────────────────────────────────────────

const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Read the store in a component and re-render when it changes.
 *
 * Not `useSyncExternalStore`: that requires a snapshot which is referentially
 * stable between changes, and the store object is replaced on every write,
 * which would loop. A version counter is simpler and does the same job.
 */
export function useStore(): Store {
  const [, bump] = useState(0)
  useEffect(() => subscribe(() => bump((n) => n + 1)), [])
  return readStore()
}

/** Ids that read as ids in an export, rather than opaque hashes. */
export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}
