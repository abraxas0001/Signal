import { PLAIN_CODEC, STORE_KEY, invalidateStore, setCodec, setStorageKey } from '@/lib/store'
import { isLocked, resealDefaultScope, signOut } from '@/lib/vault'

/**
 * A handed-over desk: sign in with a desk id and passphrase, and the desk the
 * office populates every morning opens here, on this machine, with everything
 * the member changed last time still in it.
 *
 * HOW IT RELATES TO THE VAULT. A vault account is sealed with a key derived
 * from a passphrase that never leaves this device; a handed-over desk is the
 * opposite trade, made knowingly: its records live on the server precisely so
 * the office that feeds it and the member who works it stay one desk. The two
 * kinds of account do not mix. Opening a desk signs any vault account out
 * first, exactly as the demo does, and for the same reason: the codec and the
 * storage key must always move together.
 *
 * HOW SYNC STAYS SAFE. Every write to the server names the revision it was
 * based on, and the server refuses a write based on a revision it has moved
 * past — handing back the current records in the refusal. Whoever loses the
 * race adopts what came back and retries from there. The office's own push
 * script merges additively (it only ever appends records), so a refusal here
 * means the member's edits from another device, and adopting the server copy
 * is the correct outcome.
 */

const SESSION_KEY = 'signal.desk.session'

/** Every base key that belongs to one desk and therefore syncs. */
const SYNCED_BASES = [
  'signal:store',
  'signal.handles.v1',
  'signal.standing.v1',
  'signal.standingNote.v1',
] as const

export interface DeskSession {
  deskId: string
  name: string
  token: string
  expiresAt: number
  /** The server revision the local copy is based on. */
  rev: number
}

export function readDeskSession(): DeskSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as DeskSession
    if (!s.deskId || !s.token || s.expiresAt < Date.now()) return null
    return s
  } catch {
    return null
  }
}

function saveDeskSession(s: DeskSession | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* the desk still works this tab; it will ask again next visit */
  }
}

const scopeOf = (deskId: string): string => `${STORE_KEY}:desk-${deskId}`

/** base name -> the scoped localStorage key this desk reads it at. */
function scopedName(base: string, deskId: string): string {
  return base === 'signal:store' ? scopeOf(deskId) : `${base}::desk-${deskId}`
}

/* ── the wire ────────────────────────────────────────────────────────────── */

interface Bundle {
  rev: number
  keys: Record<string, string>
}

async function pullBundle(token: string): Promise<Bundle> {
  const res = await fetch('/api/desk-sync', {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`)
  const body = (await res.json()) as { rev?: number; keys?: Record<string, string> }
  return { rev: body.rev ?? 0, keys: body.keys ?? {} }
}

async function pushBundle(
  token: string,
  baseRev: number,
  keys: Record<string, string>,
): Promise<{ rev: number } | { conflict: Bundle }> {
  const res = await fetch('/api/desk-sync', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ baseRev, keys, by: 'member' }),
    signal: AbortSignal.timeout(30_000),
  })
  if (res.status === 409) {
    const body = (await res.json()) as { rev?: number; keys?: Record<string, string> }
    return { conflict: { rev: body.rev ?? 0, keys: body.keys ?? {} } }
  }
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`)
  return { rev: ((await res.json()) as { rev: number }).rev }
}

/* ── local <-> bundle ────────────────────────────────────────────────────── */

function collectLocal(deskId: string): Record<string, string> {
  const keys: Record<string, string> = {}
  for (const base of SYNCED_BASES) {
    try {
      const v = localStorage.getItem(scopedName(base, deskId))
      if (v !== null) keys[base] = v
    } catch {
      /* an unreadable key syncs nothing, which is the truth of it */
    }
  }
  return keys
}

function adoptBundle(deskId: string, bundle: Bundle): void {
  for (const [base, value] of Object.entries(bundle.keys)) {
    try {
      localStorage.setItem(scopedName(base, deskId), value)
    } catch {
      /* quota: the next pull will try again */
    }
  }
  const s = readDeskSession()
  if (s && s.deskId === deskId) saveDeskSession({ ...s, rev: bundle.rev })
}

/**
 * Who to tell when the desk's records just changed underneath the app.
 *
 * Adopting a bundle writes localStorage, and nothing on screen re-reads it:
 * the dashboard loads its handles and standings once per mount, on purpose.
 * So the office pushing the morning's data into an OPEN desk changed the disk
 * and not the screen, and the member kept reading yesterday until she signed
 * out. The shell subscribes and remounts the desk when this fires.
 */
const refreshListeners = new Set<() => void>()

export function onDeskRefresh(fn: () => void): () => void {
  refreshListeners.add(fn)
  return () => refreshListeners.delete(fn)
}

function notifyRefresh(): void {
  // The store module serves reads from an in-memory cache; the adopt wrote
  // straight to disk. Drop the cache FIRST, or the remounted desk would read
  // the very staleness this refresh exists to clear.
  invalidateStore()
  for (const fn of refreshListeners) fn()
}

/* ── the session ─────────────────────────────────────────────────────────── */

export async function deskSignIn(deskId: string, passphrase: string): Promise<void> {
  /**
   * The transport's own failures, said in words.
   *
   * `AbortSignal.timeout` rejects with a DOMException whose message is the
   * literal string "signal timed out", and an unreachable host rejects with
   * "Failed to fetch". Both are Errors, so both sailed straight past the
   * caller's fallback message and onto the login card — where "signal timed
   * out" reads like this product's own name announcing a fault, to a member
   * whose only actual problem is a train tunnel.
   */
  let res: Response
  try {
    res = await fetch('/api/desk-auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'signin', deskId, passphrase }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    throw new Error(
      err instanceof DOMException && err.name === 'TimeoutError'
        ? 'The office server did not answer in time. Check the connection and try again.'
        : 'Could not reach the office server. Check the connection and try again.',
    )
  }

  let body: { token?: string; name?: string; expiresAt?: number; error?: string }
  try {
    body = (await res.json()) as typeof body
  } catch {
    // A desk id typed onto a deploy with no desk sync answers with the SPA's
    // own index.html, not JSON. Parsing that must not throw a syntax error at
    // somebody who simply mistyped their name.
    throw new Error('The office server answered with something Signal could not read.')
  }
  if (!res.ok || !body.token) {
    throw new Error(body.error ?? 'That desk id and passphrase do not open anything.')
  }

  // Same discipline as the demo door: close any sealed account before the
  // storage key moves, or its codec would seal this desk's records.
  if (!isLocked()) await signOut()

  const id = deskId.trim().toLowerCase()
  const session: DeskSession = {
    deskId: id,
    name: body.name ?? id,
    token: body.token,
    expiresAt: body.expiresAt ?? Date.now() + 86_400_000,
    rev: 0,
  }
  saveDeskSession(session)
  rememberDeskId(id)

  // Pull before the first render, so what opens is the desk the office fed
  // this morning. A pull that fails still opens the local copy: an office on
  // a train has yesterday's desk, which beats no desk.
  try {
    const bundle = await pullBundle(session.token)
    adoptBundle(id, bundle)
  } catch {
    /* offline: the sync loop below reconciles when the network returns */
  }

  setStorageKey(scopeOf(id))
  setCodec(PLAIN_CODEC)
  startDeskSync()
}

export function deskSignOut(): void {
  stopDeskSync()
  saveDeskSession(null)
  setStorageKey(STORE_KEY)
  resealDefaultScope()
}

/* ── the padlock's half ──────────────────────────────────────────────────── */

const LAST_ID_KEY = 'signal.desk.lastId'
const RELOCK_KEY = 'signal.desk.relock'

/** The desk id last signed in on this device. An id, never a passphrase. */
export function lastDeskId(): string | null {
  try {
    return localStorage.getItem(LAST_ID_KEY)
  } catch {
    return null
  }
}

export function rememberDeskId(deskId: string): void {
  try {
    localStorage.setItem(LAST_ID_KEY, deskId)
  } catch {
    /* the form simply asks for the id again */
  }
}

/**
 * Lock the desk: end the session so the passphrase is required again, and
 * leave a one-shot note for the entry screen to open straight onto the desk
 * login with the id already filled in. The member pressed a padlock; the
 * screen that greets her next must ask for HER password, not offer somebody
 * else's vault account.
 */
export function lockDesk(): void {
  const s = readDeskSession()
  if (s) rememberDeskId(s.deskId)
  try {
    sessionStorage.setItem(RELOCK_KEY, '1')
  } catch {
    /* the login is then one tap further away, not gone */
  }
  deskSignOut()
}

/** True exactly once after `lockDesk`, so the desk form opens by itself. */
export function consumeRelock(): boolean {
  try {
    if (sessionStorage.getItem(RELOCK_KEY) === '1') {
      sessionStorage.removeItem(RELOCK_KEY)
      return true
    }
  } catch {
    /* fall through */
  }
  return false
}

/** Reopen the desk on boot, exactly as the demo scope restores. */
export function restoreDeskIfActive(): boolean {
  const s = readDeskSession()
  if (!s) return false
  setStorageKey(scopeOf(s.deskId))
  setCodec(PLAIN_CODEC)
  startDeskSync()
  // Refresh from the server in the background; the local copy renders now.
  void pullFresh()
  return true
}

async function pullFresh(): Promise<void> {
  const s = readDeskSession()
  if (!s) return
  try {
    const bundle = await pullBundle(s.token)
    // Only adopt a NEWER revision. Adopting rev-equal would clobber local
    // edits made since boot but not yet pushed.
    if (bundle.rev > s.rev) {
      adoptBundle(s.deskId, bundle)
      lastPushed = JSON.stringify(collectLocal(s.deskId))
      notifyRefresh()
    }
  } catch {
    /* offline is fine */
  }
}

/* ── the loop ────────────────────────────────────────────────────────────── */

let timer: ReturnType<typeof setInterval> | null = null
let lastPushed = ''
let pushing = false
let ticks = 0

/**
 * Push when the records changed, every 20 seconds, cheaply: the comparison is
 * one string join, and an unchanged desk costs no network at all. Every third
 * tick also pulls, so the office pushing the morning's data reaches a desk
 * that is already open within a minute rather than at the next sign-in.
 */
export function startDeskSync(): void {
  if (timer !== null) return
  const s = readDeskSession()
  if (!s) return
  lastPushed = JSON.stringify(collectLocal(s.deskId))
  timer = setInterval(() => {
    ticks += 1
    void syncOnce()
    if (ticks % 3 === 0) void pullFresh()
  }, 20_000)
}

export function stopDeskSync(): void {
  if (timer !== null) clearInterval(timer)
  timer = null
}

async function syncOnce(): Promise<void> {
  if (pushing) return
  const s = readDeskSession()
  if (!s) {
    stopDeskSync()
    return
  }
  const keys = collectLocal(s.deskId)
  const now = JSON.stringify(keys)
  if (now === lastPushed) return

  pushing = true
  try {
    const result = await pushBundle(s.token, s.rev, keys)
    if ('rev' in result) {
      saveDeskSession({ ...readDeskSession()!, rev: result.rev })
      lastPushed = now
    } else {
      // Lost the race. The server copy wins; our unpushed delta is re-applied
      // by the member doing it again, which is rare enough to be acceptable —
      // the alternative is a merge engine over opaque strings.
      adoptBundle(s.deskId, result.conflict)
      lastPushed = JSON.stringify(collectLocal(s.deskId))
      notifyRefresh()
    }
  } catch {
    /* offline or expired: the next tick retries; a 401 surfaces at next boot */
  } finally {
    pushing = false
  }
}
