import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { db } from './firebase'

/**
 * A handed-over desk: one named person's Signal, held on the server so their
 * office and ours stay the same desk.
 *
 * WHY THIS EXISTS when the whole product keeps records on the office's own
 * device. The flagship desk is populated from a signed-in browser on OUR
 * machine — comment readings, influencer rosters, grievance records that a
 * server without sessions cannot gather. The member's office runs the app on
 * THEIR machine. Without a meeting point, every morning's population lands on
 * the wrong computer, and anything the member edits exists only where we
 * cannot see it, one push away from being overwritten. So the desk lives in
 * Firestore, both sides pull before they write, and a write names the revision
 * it read — the write loses politely when somebody else got there first,
 * instead of winning silently.
 *
 * SHAPE. `deskAccounts/{deskId}` holds who may open it (a scrypt hash, never
 * the passphrase). The records live one localStorage key per document under
 * `deskStores/{deskId}/keys/{key}`, because the whole desk in one document
 * would meet Firestore's 1MB ceiling the first week the grievance archive got
 * serious. `deskStores/{deskId}` itself holds only the revision counter and
 * the key list.
 *
 * AUTH. Sign-in verifies the passphrase and mints an HMAC token the sync
 * endpoint checks on every call. The secret is DESK_SYNC_SECRET, falling back
 * to SETTINGS_ACCESS_KEY so an existing deploy needs no new configuration.
 */

const ACCOUNTS = 'deskAccounts'
const STORES = 'deskStores'
const KEYS = 'keys'

/** Thirty days. The office signs in again after a month, not every morning. */
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type DeskResult<T> = { ok: true; value: T } | { ok: false; status: number; note: string }

const fail = <T>(status: number, note: string): DeskResult<T> => ({ ok: false, status, note })

export function deskConfigured(): boolean {
  return db() !== null && secret() !== null
}

function secret(): string | null {
  const s = process.env['DESK_SYNC_SECRET'] || process.env['SETTINGS_ACCESS_KEY']
  return s && s.trim() ? s.trim() : null
}

/** Desk ids are slugs: printable, lowercase, no surprises in a document path. */
export function normaliseDeskId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug.length >= 3 ? slug : null
}

/* ── credentials ─────────────────────────────────────────────────────────── */

function hashPass(passphrase: string, salt: Buffer): Buffer {
  // N=16384 keeps a sign-in under ~50ms on the function while still making a
  // stolen hash expensive to grind. The passphrase is never stored.
  return scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 })
}

export interface DeskAccount {
  deskId: string
  name: string
  createdAt: string
}

export async function createDeskAccount(
  deskId: string,
  name: string,
  passphrase: string,
): Promise<DeskResult<DeskAccount>> {
  const store = db()
  if (!store) return fail(503, 'This deploy has no Firebase credentials.')
  if (passphrase.length < 8) return fail(400, 'The passphrase needs at least 8 characters.')

  const salt = randomBytes(16)
  const record = {
    name: name.trim().slice(0, 120),
    salt: salt.toString('base64'),
    passHash: hashPass(passphrase, salt).toString('base64'),
    createdAt: new Date().toISOString(),
  }
  try {
    await store.collection(ACCOUNTS).doc(deskId).set(record)
    return { ok: true, value: { deskId, name: record.name, createdAt: record.createdAt } }
  } catch (err) {
    return fail(502, `Firestore refused the account: ${(err as Error).message}`)
  }
}

/* ── tokens ──────────────────────────────────────────────────────────────── */

function sign(deskId: string, expiresAt: number): string {
  const s = secret()
  if (!s) throw new Error('desk sync has no secret')
  const mac = createHmac('sha256', s).update(`${deskId}.${expiresAt}`).digest('hex')
  return `${deskId}.${expiresAt}.${mac}`
}

/** The desk id the token names, or null for anything expired or forged. */
export function verifyToken(token: string | null): string | null {
  const s = secret()
  if (!s || !token) return null
  const at = token.lastIndexOf('.')
  const mid = token.lastIndexOf('.', at - 1)
  if (mid <= 0 || at <= mid) return null
  const deskId = token.slice(0, mid)
  const expiresAt = Number(token.slice(mid + 1, at))
  const mac = token.slice(at + 1)
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null
  const expected = createHmac('sha256', s).update(`${deskId}.${expiresAt}`).digest('hex')
  const a = Buffer.from(mac, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b) ? deskId : null
}

export async function signInDesk(
  deskId: string,
  passphrase: string,
): Promise<DeskResult<{ token: string; name: string; expiresAt: number }>> {
  const store = db()
  if (!store) return fail(503, 'This deploy has no Firebase credentials.')
  if (!secret()) return fail(503, 'This deploy has no sync secret configured.')

  let doc
  try {
    doc = await store.collection(ACCOUNTS).doc(deskId).get()
  } catch (err) {
    return fail(502, `Firestore refused the read: ${(err as Error).message}`)
  }
  const data = doc.data()
  // One message for a wrong id and a wrong passphrase, or the form becomes an
  // oracle for which desks exist.
  const wrong = fail<{ token: string; name: string; expiresAt: number }>(
    401,
    'That desk id and passphrase do not open anything.',
  )
  if (!doc.exists || !data) return wrong

  try {
    const salt = Buffer.from(String(data['salt']), 'base64')
    const expected = Buffer.from(String(data['passHash']), 'base64')
    const got = hashPass(passphrase, salt)
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return wrong
  } catch {
    return wrong
  }

  const expiresAt = Date.now() + TOKEN_TTL_MS
  return {
    ok: true,
    value: { token: sign(deskId, expiresAt), name: String(data['name'] ?? deskId), expiresAt },
  }
}

/* ── the desk's records ──────────────────────────────────────────────────── */

export interface DeskBundle {
  rev: number
  updatedAt: string | null
  updatedBy: string | null
  keys: Record<string, string>
}

/** Firestore document ids cannot hold '/', and ':' is worth escaping too. */
const encodeKey = (k: string): string => encodeURIComponent(k)
const decodeKey = (k: string): string => decodeURIComponent(k)

export async function readDeskBundle(deskId: string): Promise<DeskResult<DeskBundle>> {
  const store = db()
  if (!store) return fail(503, 'This deploy has no Firebase credentials.')
  try {
    const metaRef = store.collection(STORES).doc(deskId)
    const [meta, keyDocs] = await Promise.all([metaRef.get(), metaRef.collection(KEYS).get()])
    const m = meta.data()
    const keys: Record<string, string> = {}
    for (const d of keyDocs.docs) {
      const v = d.data()['value']
      if (typeof v === 'string') keys[decodeKey(d.id)] = v
    }
    return {
      ok: true,
      value: {
        rev: typeof m?.['rev'] === 'number' ? m['rev'] : 0,
        updatedAt: typeof m?.['updatedAt'] === 'string' ? m['updatedAt'] : null,
        updatedBy: typeof m?.['updatedBy'] === 'string' ? m['updatedBy'] : null,
        keys,
      },
    }
  } catch (err) {
    return fail(502, `Firestore refused the read: ${(err as Error).message}`)
  }
}

/**
 * Write the desk, but only from where the writer last saw it.
 *
 * `baseRev` is the revision the writer pulled before editing. If the server
 * has moved past it, NOTHING is written and the current bundle comes back in
 * the refusal — the writer merges and tries again. This is the entire defence
 * against the office and the member silently overwriting each other, so no
 * caller gets to skip it.
 */
export async function writeDeskBundle(
  deskId: string,
  baseRev: number,
  keys: Record<string, string>,
  updatedBy: string,
): Promise<DeskResult<{ rev: number }>> {
  const store = db()
  if (!store) return fail(503, 'This deploy has no Firebase credentials.')

  // Firestore documents cap at ~1MB; refuse a value that cannot fit rather
  // than letting the transaction die with a less legible error.
  for (const [k, v] of Object.entries(keys)) {
    if (Buffer.byteLength(v, 'utf8') > 950_000) {
      return fail(413, `The record at "${k}" is too large to sync (over 950KB).`)
    }
  }

  const metaRef = store.collection(STORES).doc(deskId)
  try {
    const conflict = await store.runTransaction(async (tx) => {
      const meta = await tx.get(metaRef)
      const current = typeof meta.data()?.['rev'] === 'number' ? (meta.data()?.['rev'] as number) : 0
      if (current !== baseRev) return current
      tx.set(metaRef, {
        rev: current + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: updatedBy.slice(0, 40),
        keyList: Object.keys(keys),
      })
      for (const [k, v] of Object.entries(keys)) {
        tx.set(metaRef.collection(KEYS).doc(encodeKey(k)), { value: v })
      }
      return null
    })
    if (conflict !== null) {
      return fail(409, `The desk moved to revision ${conflict} while this write was based on ${baseRev}.`)
    }
    return { ok: true, value: { rev: baseRev + 1 } }
  } catch (err) {
    return fail(502, `Firestore refused the write: ${(err as Error).message}`)
  }
}
