import {
  emptyStore,
  makeId,
  readStore,
  setCodec,
  setStorageKey,
  STORE_KEY,
  STORE_VERSION,
  type Store,
} from '@/lib/store'

/**
 * Sign-in for a device that has no server behind it.
 *
 * There is no server behind Signal, no hosting agreement, no retention policy
 * and nobody accountable for a breach — and the records name private citizens,
 * serving officials and allegations nobody has proved. Cloud accounts would not
 * fix any of that; they would move the exposure somewhere with more copies of
 * it. So the answer is at-rest encryption on the one device that holds the
 * data, with a passphrase that never leaves memory.
 *
 * ── What changed, and why ───────────────────────────────────────────────────
 *
 * This used to be ONE vault per device. One passphrase, one pile of records,
 * and `createVault` threw the moment a second person tried. That is wrong for
 * the office it was built for: the MLA and two or three staffers share a phone
 * and a desktop, and "everyone types the same passphrase" means nobody has a
 * private workspace and a departing staffer keeps the keys to everything.
 *
 * So: an index of accounts on the device, each with its own display name, its
 * own random salt, its own iteration count and its own encrypted blob under its
 * own localStorage key. Signing in derives one account's key; signing out drops
 * it. `store.ts` is pointed at the active account's key at the same moment the
 * codec is installed, so one person's records are not merely hidden from
 * another's session — they are not in the address space of it.
 *
 * ── What this is NOT ────────────────────────────────────────────────────────
 *
 * It is not authentication. Nothing verifies who anyone is; a correct
 * passphrase is simply one that decrypts a blob. It stops the person who picks
 * the phone up. It does not stop a person who has the device and real intent:
 * every account's ciphertext sits in localStorage either way, and can be copied
 * off and attacked offline for as long as they like. The UI says this in those
 * words, because an office that believes otherwise will put things in here that
 * it should not.
 *
 * WebCrypto only. A dependency here is a supply-chain hole aimed directly at
 * the thing being protected.
 *
 * ── The sync/async problem, and what was done about it ──────────────────────
 *
 * `setCodec` takes a SYNCHRONOUS encode/decode pair. Every WebCrypto primitive
 * is asynchronous, and there is no synchronous WebCrypto anywhere. The two
 * honest ways out were:
 *
 *   (a) derive the key asynchronously at sign-in, then run a cipher implemented
 *       in plain JavaScript synchronously over those key bytes, or
 *   (b) do every cryptographic operation at sign-in/sign-out/write time and
 *       leave the codec doing nothing but framing.
 *
 * This is (b), and the deciding argument against (a) was that it requires
 * hand-writing an AEAD. A hand-written AES-GCM or ChaCha20-Poly1305 in a
 * government office tool is a worse risk than the one it removes, and it also
 * forces the derived key to be extractable so JavaScript can read its bytes —
 * which is exactly the property `extractable: false` exists to deny.
 *
 * So the store's plaintext is authoritative in memory, and localStorage is an
 * encrypted mirror written behind it:
 *
 *   • `encode` serialises the store, hands the plaintext to an async flush, and
 *     synchronously returns the ciphertext that is ALREADY on disk. localStorage
 *     therefore never holds a cleartext record, not even for one tick.
 *   • the flush encrypts and overwrites the active account's key a fraction of a
 *     millisecond later, in order, coalescing bursts.
 *   • `decode` returns the plaintext that sign-in already decrypted.
 *
 * The cost is a durability window: if the tab is killed between a write and its
 * flush landing, the last edit is lost. It is bounded by one AES-GCM operation
 * over a payload of tens of kilobytes — well under a millisecond in practice —
 * and the previous ciphertext is never destroyed until the replacement exists,
 * so the failure mode is "lost the last edit", never "lost the account".
 * `signOut()`, `signIn()`, `deleteAccount()` and `exportBackup()` all await the
 * flush before they touch anything.
 */

/* ── Parameters ──────────────────────────────────────────────────────────── */

const MAGIC = 'signal-vault'
const ENVELOPE_VERSION = 1
const KDF_NAME = 'PBKDF2-SHA256'

/**
 * OWASP's floor for PBKDF2-SHA256. It is stored per account rather than assumed
 * here, along with the salt: neither is a secret, and an account that hardcodes
 * either becomes unopenable the day somebody raises the number. Two accounts on
 * one device made a year apart can and will carry different counts.
 */
const DEFAULT_ITERATIONS = 310_000

/** Anything below this was not stretched enough to be worth calling encrypted. */
const MIN_ITERATIONS = 250_000

/**
 * A blob claiming ten million rounds is not a stronger account, it is a way to
 * freeze a mid-range Android for a minute per attempt.
 */
const MAX_ITERATIONS = 4_000_000

const SALT_BYTES = 16
const IV_BYTES = 12

const MIN_PASSPHRASE = 10

/** A name has to fit a button on a 360px phone and mean something to a person. */
const MAX_NAME = 40

/**
 * A floor on how long any sign-in attempt takes, so a wrong passphrase, an
 * account whose blob has gone missing, and a blob Signal cannot parse all cost
 * the same wall-clock. It doubles as rate limiting for anyone typing guesses
 * into a found phone.
 */
const OPEN_FLOOR_MS = 700

/**
 * Shown on the create screen. Accurate for accounts this build creates — an
 * older account carries its own iteration count in its own header.
 *
 * `minPassphrase` is here rather than restated in the UI copy so the rule and
 * the sentence describing it cannot drift apart.
 */
export const VAULT_PARAMS = {
  cipher: 'AES-256-GCM',
  kdf: KDF_NAME,
  iterations: DEFAULT_ITERATIONS,
  minPassphrase: MIN_PASSPHRASE,
  maxName: MAX_NAME,
} as const

/* ── Errors ──────────────────────────────────────────────────────────────── */

export type VaultErrorCode =
  | 'unsupported'
  | 'locked'
  | 'exists'
  | 'unreadable'
  | 'weak'
  | 'storage'
  | 'name'
  | 'missing'

export class VaultError extends Error {
  readonly code: VaultErrorCode
  constructor(code: VaultErrorCode, message: string) {
    super(message)
    this.name = 'VaultError'
    this.code = code
  }
}

/**
 * One message covers "wrong passphrase", "this blob is damaged" and "the blob
 * for this account is not on the device any more". A separate message for each
 * would tell anyone holding the phone which accounts are real and which
 * passphrase got closest, and there is no version of that which helps the
 * person who actually owns the records.
 */
const CANNOT_OPEN =
  'That did not open. Either the passphrase is wrong or these records are damaged. Capitals and spaces count — check and try again. Nothing has been deleted.'

/* ── Bytes ───────────────────────────────────────────────────────────────── */

const TEXT = new TextEncoder()
const BYTES = new TextDecoder()

/**
 * Spelled out rather than left as a bare `Uint8Array`.
 *
 * TypeScript's DOM lib defines `BufferSource` as a view over a plain
 * `ArrayBuffer`, and a bare `Uint8Array` is a view over `ArrayBufferLike` —
 * which includes `SharedArrayBuffer` and so will not pass to any WebCrypto
 * call. Every buffer here really is a plain one; saying so is what lets the
 * calls typecheck without a cast.
 */
type Bytes = Uint8Array<ArrayBuffer>

/**
 * Chunked because `String.fromCharCode(...bytes)` overflows the argument stack
 * somewhere north of a hundred thousand bytes, and an office with a year of
 * records is well past that.
 */
function toB64(bytes: Bytes): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function fromB64(text: string): Bytes {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length))
}

/* ── Envelope ────────────────────────────────────────────────────────────── */

interface Header {
  v: number
  kdf: typeof KDF_NAME
  iterations: number
  salt: Bytes
}

interface Envelope {
  header: Header
  iv: Bytes
  ct: Bytes
}

function newHeader(): Header {
  return {
    v: ENVELOPE_VERSION,
    kdf: KDF_NAME,
    iterations: DEFAULT_ITERATIONS,
    salt: randomBytes(SALT_BYTES),
  }
}

/**
 * The KDF header, bound into the ciphertext as AES-GCM additional data.
 *
 * Not written with `JSON.stringify`: the additional data has to be reproduced
 * byte for byte at decrypt time, and a stringify over an object rebuilt from a
 * parsed blob depends on key insertion order to do that. A fixed string cannot
 * drift.
 *
 * Honest about what this buys. The salt and the iteration count already reach
 * the key, so tampering with those breaks decryption on its own. What the tag
 * adds is that the format version and the algorithm label cannot be rewritten
 * to send a future reader down a different code path without failing first.
 */
function headerBytes(h: Header): Bytes {
  return TEXT.encode(`${MAGIC}|${h.v}|${h.kdf}|${h.iterations}|${toB64(h.salt)}`)
}

function serialiseEnvelope(e: Envelope): string {
  return JSON.stringify({
    app: MAGIC,
    v: e.header.v,
    kdf: e.header.kdf,
    iterations: e.header.iterations,
    salt: toB64(e.header.salt),
    iv: toB64(e.iv),
    ct: toB64(e.ct),
  })
}

/**
 * Returns null for anything that is not a well-formed envelope. Callers must
 * treat null as "cannot open" rather than as a distinct outcome — see
 * `openWithFloor`, which spends the same time on it either way.
 */
function parseEnvelope(raw: string): Envelope | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    if (parsed['app'] !== MAGIC) return null
    if (parsed['kdf'] !== KDF_NAME) return null

    const v = parsed['v']
    const iterations = parsed['iterations']
    const salt = parsed['salt']
    const iv = parsed['iv']
    const ct = parsed['ct']
    if (typeof v !== 'number' || v > ENVELOPE_VERSION) return null
    if (typeof iterations !== 'number' || !Number.isInteger(iterations)) return null
    if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return null
    if (typeof salt !== 'string' || typeof iv !== 'string' || typeof ct !== 'string') return null

    const saltBytes = fromB64(salt)
    const ivBytes = fromB64(iv)
    const ctBytes = fromB64(ct)
    if (saltBytes.length !== SALT_BYTES || ivBytes.length !== IV_BYTES) return null
    // GCM appends a 16-byte tag, so anything this short cannot be authenticated.
    if (ctBytes.length <= 16) return null

    return { header: { v, kdf: KDF_NAME, iterations, salt: saltBytes }, iv: ivBytes, ct: ctBytes }
  } catch {
    return null
  }
}

/** An envelope that cannot open, so a malformed blob still costs a full derive. */
function decoyEnvelope(): Envelope {
  return { header: newHeader(), iv: randomBytes(IV_BYTES), ct: randomBytes(64) }
}

/**
 * "Is this an encrypted blob", answered without decoding anything.
 *
 * `parseEnvelope` base64-decodes the whole ciphertext, and this runs on every
 * render of the lock screen — once per keystroke of the passphrase. On a year
 * of records that is hundreds of kilobytes decoded per character typed.
 *
 * The prefix is exact rather than a guess: `serialiseEnvelope` writes `app`
 * first and `JSON.stringify` keeps insertion order, and this only ever answers
 * for blobs this module wrote. It deliberately still says yes to a truncated or
 * corrupted blob — damaged records are emphatically not an empty device, and
 * treating them as one is how account creation would overwrite the only copy.
 */
const VAULT_MARKER = `{"app":"${MAGIC}"`

function looksLikeVault(raw: string): boolean {
  return raw.startsWith(VAULT_MARKER)
}

/* ── The account index ───────────────────────────────────────────────────── */

const ACCOUNTS_KEY = 'signal:accounts'
const ACCOUNTS_MAGIC = 'signal-accounts'
const ACCOUNTS_VERSION = 1

/** Where a new account's ciphertext goes: one localStorage key per account. */
const BLOB_PREFIX = 'signal:store:'

/**
 * What the device knows about an account WITHOUT anyone signing in.
 *
 * The index deliberately carries no salt, no iteration count, no password hash,
 * no verifier, no wrapped key and no checksum of the plaintext. Everything the
 * KDF needs lives inside the account's own encrypted blob, where reading it
 * costs the attacker nothing they did not already have — but where there is
 * also nothing to test a guess against faster than a full AES-GCM decrypt. An
 * index with a verifier in it would hand an offline attacker a cheap oracle and
 * make the 310,000 rounds decorative.
 *
 * It does leak the display names. That is unavoidable: the picker has to show
 * whose accounts these are before anybody has proved anything, and a picker of
 * anonymous slots is a picker nobody can use. Names should be first names, not
 * "MLA — grievance files", and the create screen says so.
 */
export interface AccountSummary {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
}

interface AccountRecord extends AccountSummary {
  /** The localStorage key holding this account's ciphertext. */
  blob: string
}

interface AccountIndex {
  active: string | null
  accounts: AccountRecord[]
}

/**
 * `ok: false` means "there is something at the index key and it is not an index
 * I can read".
 *
 * This is a separate outcome from "no index yet" on purpose. Collapsing the two
 * would mean a single corrupted byte in the index made the device look brand
 * new, and the next account created would write a fresh index over the pointers
 * to every existing account's blob. The ciphertext would still be sitting in
 * localStorage, unreachable, with nothing in the UI admitting it. Refusing to
 * act is the only safe answer.
 */
type IndexState = { ok: true; index: AccountIndex } | { ok: false }

const EMPTY_INDEX: AccountIndex = { active: null, accounts: [] }

/**
 * Rebuilt field by field, and a single bad entry rejects the whole index.
 *
 * Dropping just the bad entry would be quietly deleting somebody's account from
 * the picker while their records stayed on disk, which is worse than saying
 * "this is unreadable" out loud.
 */
function parseAccount(value: unknown): AccountRecord | null {
  if (!isRecord(value)) return null
  const id = value['id']
  const name = value['name']
  const blob = value['blob']
  const createdAt = value['createdAt']
  const lastUsedAt = value['lastUsedAt']
  if (typeof id !== 'string' || id.length === 0) return null
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME) return null
  if (typeof createdAt !== 'string') return null
  if (lastUsedAt !== null && typeof lastUsedAt !== 'string') return null
  // The blob key is whitelisted rather than trusted. Without this, a tampered
  // or hand-edited index could point an account at `signal:theme`, at another
  // account's key, or at the legacy key, and the next write would encrypt over
  // whatever was there. A pointer read from disk is untrusted input.
  if (typeof blob !== 'string') return null
  if (blob !== STORE_KEY && !(blob.startsWith(BLOB_PREFIX) && blob.length > BLOB_PREFIX.length)) {
    return null
  }
  return { id, name, blob, createdAt, lastUsedAt }
}

function readIndex(): IndexState {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(ACCOUNTS_KEY)
  } catch {
    // Storage is unreadable entirely — private mode with everything blocked.
    // Not "no accounts": refusing beats silently starting over.
    return { ok: false }
  }
  if (raw === null) return { ok: true, index: EMPTY_INDEX }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return { ok: false }
    if (parsed['app'] !== ACCOUNTS_MAGIC) return { ok: false }
    const v = parsed['v']
    if (typeof v !== 'number' || v > ACCOUNTS_VERSION) return { ok: false }
    const list = parsed['accounts']
    if (!Array.isArray(list)) return { ok: false }

    const accounts: AccountRecord[] = []
    const seenIds = new Set<string>()
    const seenBlobs = new Set<string>()
    for (const entry of list) {
      const account = parseAccount(entry)
      if (account === null) return { ok: false }
      // Two accounts sharing an id or a blob key is not a display bug, it is
      // two people writing over each other's records. Refuse rather than pick.
      if (seenIds.has(account.id) || seenBlobs.has(account.blob)) return { ok: false }
      seenIds.add(account.id)
      seenBlobs.add(account.blob)
      accounts.push(account)
    }

    const active = parsed['active']
    const activeId = typeof active === 'string' && seenIds.has(active) ? active : null
    return { ok: true, index: { active: activeId, accounts } }
  } catch {
    return { ok: false }
  }
}

function writeIndex(index: AccountIndex): void {
  const payload = JSON.stringify({
    app: ACCOUNTS_MAGIC,
    v: ACCOUNTS_VERSION,
    active: index.active,
    accounts: index.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      blob: a.blob,
      createdAt: a.createdAt,
      lastUsedAt: a.lastUsedAt,
    })),
  })
  try {
    localStorage.setItem(ACCOUNTS_KEY, payload)
  } catch {
    throw new VaultError(
      'storage',
      'This device would not save the account list — storage is full, or the browser is in private mode. Free some space, or open Signal in a normal window, and try again.',
    )
  }
}

function requireIndex(): AccountIndex {
  const state = readIndex()
  if (!state.ok) {
    throw new VaultError(
      'storage',
      'Signal cannot read the list of accounts on this device, so it will not change it — that could hide records rather than lose them. The encrypted records are still here. Restore a backup on another device, or clear this site’s data only if you have one.',
    )
  }
  return state.index
}

/**
 * True when the account list itself is damaged. The lock screen shows the
 * refusal above instead of a create form, so nobody is invited to start over on
 * top of records that are still on the device.
 */
export function accountsUnreadable(): boolean {
  return !readIndex().ok
}

export function listAccounts(): AccountSummary[] {
  const state = readIndex()
  if (!state.ok) return []
  // Most recently used first: on a shared desk the same two people sign in all
  // day, and hunting for a name in creation order gets old immediately.
  return [...state.index.accounts]
    .sort((a, b) => (b.lastUsedAt ?? b.createdAt).localeCompare(a.lastUsedAt ?? a.createdAt))
    .map(({ id, name, createdAt, lastUsedAt }) => ({ id, name, createdAt, lastUsedAt }))
}

export function hasAccounts(): boolean {
  const state = readIndex()
  return state.ok && state.index.accounts.length > 0
}

/** Which account the picker should preselect. Null on a device nobody has used. */
export function lastUsedAccountId(): string | null {
  const state = readIndex()
  return state.ok ? state.index.active : null
}

function nameProblemAgainst(name: string, accounts: AccountRecord[], exceptId?: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'Give this account a name, so the right person can find it.'
  if (trimmed.length > MAX_NAME) return `Keep the name under ${MAX_NAME} characters.`
  const clash = accounts.some(
    (a) => a.id !== exceptId && a.name.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
  )
  // Two identical names in the picker means somebody signs in as the wrong
  // person, types a passphrase that fails, and has no way to tell which is which.
  if (clash) return 'This device already has an account with that name. Use something that tells them apart.'
  return null
}

export function nameProblem(name: string): string | null {
  const state = readIndex()
  return nameProblemAgainst(name, state.ok ? state.index.accounts : [])
}

/* ── Crypto ──────────────────────────────────────────────────────────────── */

function requireCrypto(): void {
  if (typeof crypto === 'undefined' || typeof crypto.subtle === 'undefined') {
    throw new VaultError(
      'unsupported',
      'This browser will not encrypt anything on an insecure page. Open Signal over https, or on localhost, and try again.',
    )
  }
}

/**
 * `trim` and NFKC are not cosmetic. Android keyboards append a space after the
 * last word of a phrase, and the same Telugu or Hindi passphrase types as two
 * different byte sequences depending on the keyboard. Either one produces an
 * account that the person who set it cannot open, with no way to tell why. Both
 * normalisations have to be applied identically on every path, which is why
 * they live here and nowhere else.
 */
async function deriveKey(passphrase: string, header: Header): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    TEXT.encode(passphrase.normalize('NFKC').trim()),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  // extractable: false — nothing in the app, and nothing injected into it, can
  // read these bytes back out.
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: header.salt, iterations: header.iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** A fresh IV every write. Reusing one under the same key breaks GCM outright. */
async function seal(key: CryptoKey, header: Header, plaintext: string): Promise<string> {
  const iv = randomBytes(IV_BYTES)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: headerBytes(header) },
      key,
      TEXT.encode(plaintext),
    ),
  )
  return serialiseEnvelope({ header, iv, ct })
}

async function unseal(key: CryptoKey, envelope: Envelope): Promise<string> {
  const opened = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: envelope.iv, additionalData: headerBytes(envelope.header) },
    key,
    envelope.ct,
  )
  return BYTES.decode(opened)
}

interface Opened {
  key: CryptoKey
  header: Header
  plaintext: string
}

type Settled<T> = { ok: true; value: T } | { ok: false }

async function settle<T>(work: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await work }
  } catch {
    return { ok: false }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Derive, decrypt, and take the same wall-clock doing it whether the blob was
 * unparseable, the tag failed, the account was not on the device, or the
 * plaintext turned out not to be a store.
 *
 * The work is settled before the floor is awaited: `Promise.all` over a
 * rejecting promise short-circuits, which would have made a missing account
 * return visibly faster than a wrong passphrase and defeated the whole point.
 */
async function openWithFloor(passphrase: string, envelope: Envelope | null): Promise<Opened> {
  const target = envelope ?? decoyEnvelope()
  const work = (async (): Promise<Opened> => {
    const key = await deriveKey(passphrase, target.header)
    const plaintext = await unseal(key, target)
    if (envelope === null) throw new VaultError('unreadable', CANNOT_OPEN)
    // A payload that decrypts but is not a store means the blob is damaged in a
    // way the tag cannot see. Finding that out here keeps it away from `decode`,
    // which must never throw.
    const parsed: unknown = JSON.parse(plaintext)
    if (!isRecord(parsed)) throw new VaultError('unreadable', CANNOT_OPEN)
    return { key, header: target.header, plaintext }
  })()

  const [result] = await Promise.all([settle(work), sleep(OPEN_FLOOR_MS)])
  if (!result.ok) throw new VaultError('unreadable', CANNOT_OPEN)
  return result.value
}

/** Open a named blob key. Missing and damaged cost exactly the same as wrong. */
async function openBlob(blobKey: string, passphrase: string): Promise<Opened> {
  const raw = readRawAt(blobKey)
  return openWithFloor(passphrase, raw === null ? null : parseEnvelope(raw))
}

/* ── In-memory state ─────────────────────────────────────────────────────── */

/**
 * All of these are memory only. Nothing here is ever written to localStorage,
 * sessionStorage, a cookie or a URL. The passphrase itself is not kept at all —
 * only the derived key, which cannot be read back out.
 *
 * `signOut` nulls every one of them. `plain` in particular: leaving one
 * person's decrypted store in this variable while the next person signs in is
 * precisely how account separation would become a lie, because `decode` hands
 * `plain` straight back to the store regardless of whose blob is on disk.
 */
let key: CryptoKey | null = null
let header: Header | null = null
/** The authoritative store, as JSON. Null whenever nobody is signed in. */
let plain: string | null = null
/** The exact ciphertext currently in localStorage, for the write-behind mirror. */
let envelope: string | null = null
/** The signed-in account, and the localStorage key its ciphertext lives under. */
let activeId: string | null = null
let activeBlob: string | null = null

let pending: string | null = null
let flushing: Promise<void> | null = null
/** Surfaced rather than swallowed: a full disk means edits are not being saved. */
let writeError: string | null = null

const watchers = new Set<() => void>()

function notify(): void {
  for (const watcher of watchers) watcher()
}

export function subscribeVault(fn: () => void): () => void {
  watchers.add(fn)
  return () => {
    watchers.delete(fn)
  }
}

function readRawAt(storageKey: string): string | null {
  try {
    return localStorage.getItem(storageKey)
  } catch {
    return null
  }
}

function writeRawAt(storageKey: string, value: string): void {
  try {
    localStorage.setItem(storageKey, value)
  } catch {
    throw new VaultError(
      'storage',
      'This device would not save the records — storage is full, or the browser is in private mode. Free some space, or open Signal in a normal window, and try again.',
    )
  }
}

function removeRawAt(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey)
  } catch {
    /* nothing to remove, or storage is refusing us entirely */
  }
}

/* ── Write-behind flush ──────────────────────────────────────────────────── */

function queueFlush(text: string): void {
  pending = text
  if (flushing) return
  flushing = (async () => {
    // A loop rather than a promise chain: it coalesces a burst of edits into one
    // encryption and guarantees the newest plaintext is the one that lands. A
    // chain would encrypt every intermediate state and could land them out of
    // order, leaving an older store on disk than the one on screen.
    //
    // `activeBlob` is re-read every iteration, and the loop stops the moment the
    // key is gone. Both matter now that sign-out can happen mid-flush: writing
    // one account's ciphertext to whichever key happened to be active when the
    // loop started is the multi-account version of losing everything.
    while (pending !== null && key !== null && header !== null && activeBlob !== null) {
      const next = pending
      const target = activeBlob
      pending = null
      try {
        const sealed = await seal(key, header, next)
        localStorage.setItem(target, sealed)
        envelope = sealed
        if (writeError !== null) {
          writeError = null
          notify()
        }
      } catch {
        writeError =
          'Signal could not save your last change to this device. Storage may be full. Download a backup now, then free some space.'
        notify()
        break
      }
    }
    flushing = null
  })()
}

async function flushNow(): Promise<void> {
  while (flushing) await flushing
}

export function lastWriteError(): string | null {
  return writeError
}

/* ── The codec ───────────────────────────────────────────────────────────── */

function encodeUnlocked(store: Store): string {
  const text = JSON.stringify(store)
  plain = text
  queueFlush(text)

  if (envelope === null) {
    // Invariant: every path that installs this codec writes a sealed envelope
    // first. Refusing is the only safe response if that ever stops being true —
    // returning `text` would drop every named citizen in the store into
    // localStorage in cleartext. The flush queued above still lands the
    // ciphertext, so throwing costs nothing but a redundant synchronous write.
    throw new VaultError(
      'storage',
      'Signal has nothing sealed to write over yet. Sign out and back in, then try again.',
    )
  }
  return envelope
}

function decodeUnlocked(raw: string): unknown {
  // This must not throw under any circumstances. `readStore` treats a throwing
  // decode as "start empty", and the next write would then seal an empty store
  // over an office's records.
  try {
    if (plain === null) return { version: STORE_VERSION }
    if (raw !== envelope) {
      console.warn(
        'Signal: the records on disk changed outside this tab; showing the copy this tab opened.',
      )
    }
    return JSON.parse(plain) as unknown
  } catch {
    return { version: STORE_VERSION }
  }
}

const LIVE_CODEC = { encode: encodeUnlocked, decode: decodeUnlocked }

/**
 * The signed-out codec reads as empty and refuses to write.
 *
 * Refusing is the point. Without it, any component that fires a write before
 * anyone has signed in would serialise an empty store straight over the
 * ciphertext. `writeStore` wraps its write in a try/catch, so a throw here is
 * absorbed and localStorage is left exactly as it was.
 */
const SEALED_CODEC = {
  encode: (): string => {
    throw new VaultError(
      'locked',
      'Nobody is signed in. Sign in with a passphrase before making changes.',
    )
  },
  decode: (): unknown => ({ version: STORE_VERSION }),
}

/* ── State the UI asks about ─────────────────────────────────────────────── */

export function isLocked(): boolean {
  return key === null
}

export function activeAccount(): AccountSummary | null {
  const id = activeId
  if (id === null) return null
  const state = readIndex()
  if (!state.ok) return null
  const found = state.index.accounts.find((a) => a.id === id)
  if (found === undefined) return null
  const { name, createdAt, lastUsedAt } = found
  return { id: found.id, name, createdAt, lastUsedAt }
}

/* ── Startup ─────────────────────────────────────────────────────────────── */

/**
 * Adopt a device that was locked before accounts existed.
 *
 * A single-vault device has ciphertext at `signal:store` and no index. It
 * cannot be re-keyed here — that needs the passphrase, which nobody has typed
 * yet — so the account keeps pointing at the old key forever. `parseAccount`
 * whitelists `STORE_KEY` for exactly this reason and no other.
 *
 * The name is a placeholder because there is genuinely nothing on the device
 * that says whose records these are. Inventing one would be a lie in the
 * picker; leaving it blank would fail the index parser.
 */
function migrateLegacyVault(): void {
  const state = readIndex()
  if (!state.ok || state.index.accounts.length > 0) return
  const raw = readRawAt(STORE_KEY)
  if (raw === null || !looksLikeVault(raw)) return

  const now = new Date().toISOString()
  const account: AccountRecord = {
    id: uniqueId([]),
    name: 'This device',
    blob: STORE_KEY,
    createdAt: now,
    lastUsedAt: null,
  }
  try {
    writeIndex({ active: account.id, accounts: [account] })
  } catch {
    // Storage refused. The ciphertext is untouched and the next load tries
    // again; the alternative — throwing at import — is a blank app.
  }
}

let installed = false

/**
 * Seal the store the moment this module loads, before any component can write.
 *
 * The store's default codec is `JSON.stringify`. Between page load and someone
 * signing in, a single stray `update()` under that codec would replace the
 * ciphertext with a cleartext empty store — losing the records and publishing
 * what was left of them in the same stroke. That window has to be closed at
 * import time, not in an effect.
 *
 * Sealing also when the index is unreadable, not just when accounts exist: an
 * index that will not parse is the case where records are most likely present
 * and least likely to be recoverable if something writes over them.
 */
export function initVault(): void {
  if (installed) return
  installed = true
  migrateLegacyVault()
  const state = readIndex()
  if (!state.ok || state.index.accounts.length > 0) setCodec(SEALED_CODEC)
}

initVault()

/* ── Accounts ────────────────────────────────────────────────────────────── */

function uniqueId(taken: AccountRecord[]): string {
  // `makeId` is milliseconds plus six random characters, which is fine for a
  // record id and not fine for something that names a storage key: a collision
  // would silently point two accounts at one blob and let each overwrite the
  // other. Cheap to rule out, catastrophic to leave to chance.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = makeId('acc')
    if (!taken.some((a) => a.id === id)) return id
  }
  throw new VaultError('storage', 'Could not allocate an account id on this device. Reload and try again.')
}

function touch(index: AccountIndex, id: string): AccountIndex {
  const now = new Date().toISOString()
  return {
    active: id,
    accounts: index.accounts.map((a) => (a.id === id ? { ...a, lastUsedAt: now } : a)),
  }
}

/** Install a freshly opened account as the live session. */
function adopt(account: AccountRecord, opened: { key: CryptoKey; header: Header }, sealed: string, text: string): void {
  key = opened.key
  header = opened.header
  plain = text
  envelope = sealed
  activeId = account.id
  activeBlob = account.blob
  writeError = null
  // Order matters: point the store at this account's key BEFORE installing the
  // codec. `setCodec` emits, subscribers call `readStore`, and a read against
  // the previous account's key with this account's plaintext in `plain` is the
  // one combination that would put the wrong records on screen.
  setStorageKey(account.blob)
  setCodec(LIVE_CODEC)
  notify()
}

/**
 * What a brand-new account starts with — normally nothing.
 *
 * The exception is the very first account on a device that used Signal before
 * any of this existed: its records are sitting at `signal:store` in cleartext,
 * and starting empty would throw away everything the office had at the moment
 * it decided to protect it.
 */
function adoptableCleartext(): string | null {
  const raw = readRawAt(STORE_KEY)
  if (raw === null) return null
  // Encrypted already: that is the legacy-vault path, handled at import, and
  // this must never treat it as adoptable cleartext.
  if (looksLikeVault(raw)) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? raw : null
  } catch {
    return null
  }
}

/**
 * Add a person to this device.
 *
 * Signs whoever was signed in out first, flushing their last edit — creating an
 * account and landing in it is the only sequence that makes sense from the
 * picker, and leaving two sessions half-live is how records cross over.
 */
export async function createAccount(name: string, passphrase: string): Promise<AccountSummary> {
  requireCrypto()
  requirePassphrase(passphrase)

  const index = requireIndex()
  const problem = nameProblemAgainst(name, index.accounts)
  if (problem !== null) throw new VaultError('name', problem)

  const trimmed = name.trim()
  const id = uniqueId(index.accounts)
  const blob = `${BLOB_PREFIX}${id}`

  // Refuse rather than encrypt over something. Nothing should exist at a key
  // named after an id that was just generated, and if something does, this
  // device is in a state no write is going to improve.
  if (readRawAt(blob) !== null) {
    throw new VaultError(
      'exists',
      'This device already has records stored under that account slot. Reload Signal and try again.',
    )
  }

  const inherited = index.accounts.length === 0 ? adoptableCleartext() : null
  const text = inherited ?? JSON.stringify(emptyStore())

  const nextHeader = newHeader()
  const nextKey = await deriveKey(passphrase, nextHeader)
  const sealed = await seal(nextKey, nextHeader, text)

  // Everything above is pure computation. From here the device changes, so the
  // current session is flushed and dropped first.
  await signOut()

  writeRawAt(blob, sealed)

  const now = new Date().toISOString()
  const account: AccountRecord = { id, name: trimmed, blob, createdAt: now, lastUsedAt: now }
  try {
    writeIndex({ active: id, accounts: [...index.accounts, account] })
  } catch (err) {
    // The index is what makes the blob findable. If it will not save, the blob
    // is unreachable dead weight — remove it rather than leave an orphan that
    // nothing can ever open or delete.
    removeRawAt(blob)
    throw err
  }

  if (inherited !== null) {
    // Only now, with the ciphertext written and the index naming it, is it safe
    // to delete the cleartext copy. Doing it any earlier risks a quota failure
    // between the two and an office with no records at all.
    if (readRawAt(blob) === sealed) removeRawAt(STORE_KEY)
  }

  adopt(account, { key: nextKey, header: nextHeader }, sealed, text)
  return { id, name: trimmed, createdAt: now, lastUsedAt: now }
}

/**
 * Sign in to one account.
 *
 * The blob is opened BEFORE the current session is disturbed. Signing out first
 * and then failing would mean a mistyped passphrase kicked the person who was
 * already working out of their own records.
 */
export async function signIn(accountId: string, passphrase: string): Promise<void> {
  requireCrypto()
  const index = requireIndex()
  const account = index.accounts.find((a) => a.id === accountId)

  // A missing account still costs a full derive and returns the same message as
  // a wrong passphrase. The picker should make this unreachable; someone poking
  // at the app should not learn which ids are real.
  const opened = await openBlob(account?.blob ?? `${BLOB_PREFIX}absent`, passphrase)
  if (account === undefined) throw new VaultError('unreadable', CANNOT_OPEN)

  await signOut()

  const raw = readRawAt(account.blob)
  if (raw === null) throw new VaultError('unreadable', CANNOT_OPEN)

  adopt(account, opened, raw, opened.plaintext)
  try {
    writeIndex(touch(index, account.id))
  } catch {
    // Not being able to record "last used" is cosmetic. The session is open and
    // the records are readable; failing the sign-in over a timestamp would be
    // the wrong trade.
  }
}

/**
 * Drop the derived key and every trace of the session from memory.
 *
 * Asynchronous on purpose: a pending write still has to be sealed with the key
 * we are about to throw away, so dropping it first would silently lose the last
 * edit the person made before walking away.
 */
export async function signOut(): Promise<void> {
  await flushNow()
  // Anything still queued belongs to the account being closed and can no longer
  // be sealed. Clearing it stops the next account's first write from inheriting
  // a stale pending payload that was never theirs.
  pending = null
  key = null
  header = null
  plain = null
  envelope = null
  activeId = null
  activeBlob = null
  setStorageKey(STORE_KEY)
  setCodec(SEALED_CODEC)
  notify()
}

export async function changePassphrase(
  oldPassphrase: string,
  newPassphrase: string,
): Promise<void> {
  requireCrypto()
  const blob = activeBlob
  if (key === null || blob === null) {
    throw new VaultError('locked', 'Sign in before changing a passphrase.')
  }
  requirePassphrase(newPassphrase)

  // Prove they know the current passphrase against the blob itself. Standing in
  // front of an unlocked phone is not the same as knowing the passphrase, and a
  // silent change is how somebody gets locked out of their own records — or
  // locks the MLA out of theirs.
  await openBlob(blob, oldPassphrase)

  await flushNow()
  // Re-seal the live store rather than the copy that was on disk, so an edit
  // made since sign-in is not rolled back by a passphrase change.
  const text = plain ?? JSON.stringify(readStore())
  const nextHeader = newHeader()
  const nextKey = await deriveKey(newPassphrase, nextHeader)
  const sealed = await seal(nextKey, nextHeader, text)
  writeRawAt(blob, sealed)

  key = nextKey
  header = nextHeader
  plain = text
  envelope = sealed
  notify()
}

/**
 * Remove an account and its records from this device.
 *
 * The passphrase is required, and that is a deliberate trade. Without it, the
 * picker would hand anyone who picked the phone up a one-tap button to destroy
 * the MLA's entire grievance file — strictly worse than the reading they came
 * to do. The cost is that a genuinely forgotten passphrase leaves a dead entry
 * in the picker forever. Those records are already unreadable by then, so the
 * entry is untidy rather than harmful, and the UI says so instead of offering a
 * shortcut that doubles as an attack.
 */
export async function deleteAccount(accountId: string, passphrase: string): Promise<void> {
  requireCrypto()
  const index = requireIndex()
  const account = index.accounts.find((a) => a.id === accountId)

  await openBlob(account?.blob ?? `${BLOB_PREFIX}absent`, passphrase)
  if (account === undefined) throw new VaultError('unreadable', CANNOT_OPEN)

  // Close the session first if this is the account being deleted, so no queued
  // flush can rewrite the blob a moment after it is removed.
  if (activeId === account.id) await signOut()

  // The index goes first. If the removal is interrupted between the two writes,
  // an unreferenced blob is dead weight; an index entry pointing at a blob that
  // is gone is an account that looks real and can never open.
  writeIndex({
    active: index.active === account.id ? null : index.active,
    accounts: index.accounts.filter((a) => a.id !== account.id),
  })
  removeRawAt(account.blob)
  notify()
}

/* ── Backup ──────────────────────────────────────────────────────────────── */

export async function exportBackup(passphrase: string): Promise<Blob> {
  requireCrypto()
  if (key === null) {
    throw new VaultError('locked', 'Sign in before downloading a backup.')
  }
  requirePassphrase(passphrase)

  await flushNow()
  const text = plain ?? JSON.stringify(readStore())

  // A fresh salt, never the device's. Reusing it would mean one cracked file
  // hands over the other, and a backup travels through places the phone does
  // not — a laptop, an email, a shared drive.
  const backupHeader = newHeader()
  const backupKey = await deriveKey(passphrase, backupHeader)
  const sealed = await seal(backupKey, backupHeader, text)
  return new Blob([sealed], { type: 'application/json' })
}

export interface ImportSummary {
  grievances: number
  issues: number
  actions: number
  influencers: number
  mentions: number
}

function countRecords(plaintext: string): ImportSummary {
  const zero: ImportSummary = { grievances: 0, issues: 0, actions: 0, influencers: 0, mentions: 0 }
  try {
    const parsed: unknown = JSON.parse(plaintext)
    if (!isRecord(parsed)) return zero
    const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0)
    return {
      grievances: count(parsed['grievances']),
      issues: count(parsed['issues']),
      actions: count(parsed['actions']),
      influencers: count(parsed['influencers']),
      mentions: count(parsed['mentions']),
    }
  } catch {
    return zero
  }
}

/**
 * Restore a backup.
 *
 * Two cases, and they are genuinely different operations:
 *
 *   • Signed in — the records replace the ACTIVE account's, re-sealed under the
 *     passphrase already in use there. The account's own passphrase does not
 *     silently become whatever the backup was made with, and no other account
 *     on the device is touched.
 *   • Signed out — this is the replacement-phone case the feature exists for.
 *     A new account is created from the file, named by whoever is restoring it,
 *     sealed under the backup's own passphrase, and signed in.
 *
 * Nothing is written until the backup has decrypted, so a wrong passphrase
 * leaves the device exactly as it was.
 */
export async function importBackup(
  file: File,
  passphrase: string,
  newAccountName?: string,
): Promise<ImportSummary> {
  requireCrypto()
  const text = await file.text()
  const opened = await openWithFloor(passphrase, parseEnvelope(text))

  const deviceKey = key
  const deviceHeader = header
  const deviceBlob = activeBlob

  if (deviceKey !== null && deviceHeader !== null && deviceBlob !== null) {
    await flushNow()
    const sealed = await seal(deviceKey, deviceHeader, opened.plaintext)
    writeRawAt(deviceBlob, sealed)

    plain = opened.plaintext
    envelope = sealed
    writeError = null
    // Re-installing the codec is what clears the store's cache, so every screen
    // re-reads the restored records instead of the ones already on it.
    setCodec(LIVE_CODEC)
    notify()
    return countRecords(opened.plaintext)
  }

  const index = requireIndex()
  const problem = nameProblemAgainst(newAccountName ?? '', index.accounts)
  if (problem !== null) throw new VaultError('name', problem)
  const trimmed = (newAccountName ?? '').trim()

  const id = uniqueId(index.accounts)
  const blob = `${BLOB_PREFIX}${id}`
  if (readRawAt(blob) !== null) {
    throw new VaultError(
      'exists',
      'This device already has records stored under that account slot. Reload Signal and try again.',
    )
  }

  // Note what is NOT checked here: `requirePassphrase`. The passphrase is
  // inherited from the file, not chosen now, and it has already proved itself
  // by decrypting. Enforcing today's minimum length would refuse a legitimate
  // restore of a backup made under an older rule — losing the records to a
  // policy check, which is the worst possible reason to lose them.
  const nextHeader = newHeader()
  const nextKey = await deriveKey(passphrase, nextHeader)
  const sealed = await seal(nextKey, nextHeader, opened.plaintext)
  writeRawAt(blob, sealed)

  const now = new Date().toISOString()
  const account: AccountRecord = { id, name: trimmed, blob, createdAt: now, lastUsedAt: now }
  try {
    writeIndex({ active: id, accounts: [...index.accounts, account] })
  } catch (err) {
    removeRawAt(blob)
    throw err
  }

  adopt(account, { key: nextKey, header: nextHeader }, sealed, opened.plaintext)
  return countRecords(opened.plaintext)
}

/* ── Passphrase rules ────────────────────────────────────────────────────── */

export function passphraseProblem(passphrase: string): string | null {
  if (passphrase.normalize('NFKC').trim().length < MIN_PASSPHRASE) {
    return `Use at least ${MIN_PASSPHRASE} characters. Four ordinary words you will remember beats one short clever one.`
  }
  return null
}

function requirePassphrase(passphrase: string): void {
  const problem = passphraseProblem(passphrase)
  if (problem !== null) throw new VaultError('weak', problem)
}

/* ── Other tabs ──────────────────────────────────────────────────────────── */

/**
 * A second tab on the office desktop is the quiet way to lose a day's work:
 * both hold their own plaintext, and whichever writes last wins. Re-reading the
 * active account's blob when another tab writes it keeps them agreed.
 *
 * If the new ciphertext will not open with the key we hold — the other tab
 * changed the passphrase — signing out is the correct answer. It destroys
 * nothing, and the truth comes back off disk at the next sign-in.
 *
 * The index is watched too, but only to repaint: another tab adding or deleting
 * an account changes what the picker should show, and a stale picker offering a
 * deleted account is a sign-in that can only fail.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === ACCOUNTS_KEY) {
      notify()
      return
    }
    const blob = activeBlob
    const activeKey = key
    if (blob === null || activeKey === null || event.key !== blob) return
    if (flushing !== null) return
    const raw = readRawAt(blob)
    if (raw === null || raw === envelope) return
    const parsed = parseEnvelope(raw)
    if (parsed === null) return
    void (async () => {
      try {
        const text = await unseal(activeKey, parsed)
        plain = text
        envelope = raw
        header = parsed.header
        setCodec(LIVE_CODEC)
      } catch {
        await signOut()
      }
    })()
  })
}
