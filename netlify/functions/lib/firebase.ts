import { cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

/**
 * The one place this codebase talks to Firebase.
 *
 * Everything that persists across a request lives behind `db()`. It is a
 * function rather than an exported constant on purpose: a module-level
 * `getFirestore()` throws "the default Firebase app does not exist" the moment
 * the file is imported, which in a Netlify function means the endpoint 500s
 * before its handler is ever entered and the log says nothing about Firebase.
 * That is exactly how the first cut of `sync-profiles` failed.
 *
 * ABSENT CONFIG DEGRADES, IT DOES NOT THROW. This follows the rule the rest of
 * the product already keeps — `metaCredentials()` returns null,
 * `resolveProviders()` returns an empty list — because the analyser, the
 * dashboard's live reads and every public extraction path work with no
 * database at all. Firestore only adds the *stored* half: batch-tracked posts,
 * the Instagram cache, the cross-function rate-limit ledger. A deploy without
 * Firebase credentials should lose those and keep the rest, so `db()` returns
 * `null` and callers treat that as "nothing stored yet".
 *
 * Note the SDK: this is `firebase-admin`, the server SDK, whose surface is
 * chained and method-based (`db.collection('x').where(…).get()`). It is NOT
 * the modular web SDK (`collection(db, 'x')`, `getDocs(q)`, `setDoc(ref)`),
 * and the two are not interchangeable — those free functions do not exist in
 * `firebase-admin/firestore` at all.
 */

/**
 * A service-account private key cannot survive an env var with real newlines,
 * so it is stored with the newlines escaped and has to be put back. Netlify's
 * UI, `.env` files and shell exports each mangle it slightly differently:
 * some keep `\n` as two characters, some wrap the whole value in quotes, and
 * pasting through a JSON field can double the backslash. Undo all three.
 */
function normalisePrivateKey(raw: string): string {
  let key = raw.trim()
  if (key.length >= 2 && key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1)
  // `\\n` (a backslash that was itself escaped) before `\n`, so the first pass
  // does not leave a stray backslash welded to the start of a base64 line.
  return key.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n')
}

interface ServiceAccount {
  projectId: string
  clientEmail: string
  privateKey: string
}

/**
 * Two accepted shapes, because operators arrive with one or the other:
 * the whole service-account JSON in `FIREBASE_SERVICE_ACCOUNT`, or the three
 * fields that matter split out as `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL`
 * / `FIREBASE_PRIVATE_KEY`. The remaining six fields Firebase puts in that JSON
 * (`private_key_id`, `client_id`, the three fixed OAuth URLs, the cert URL) are
 * not read by the Admin SDK and are ignored here rather than demanded.
 */
function serviceAccount(): ServiceAccount | null {
  const blob = process.env['FIREBASE_SERVICE_ACCOUNT']
  if (blob) {
    try {
      const parsed = JSON.parse(blob) as Record<string, unknown>
      const projectId = parsed['project_id'] ?? parsed['projectId']
      const clientEmail = parsed['client_email'] ?? parsed['clientEmail']
      const privateKey = parsed['private_key'] ?? parsed['privateKey']
      if (
        typeof projectId === 'string' &&
        typeof clientEmail === 'string' &&
        typeof privateKey === 'string'
      ) {
        return { projectId, clientEmail, privateKey: normalisePrivateKey(privateKey) }
      }
    } catch {
      /* fall through to the split fields, and report below if those are absent too */
    }
  }

  const projectId = process.env['FIREBASE_PROJECT_ID']
  const clientEmail = process.env['FIREBASE_CLIENT_EMAIL']
  const privateKey = process.env['FIREBASE_PRIVATE_KEY']
  if (!projectId || !clientEmail || !privateKey) return null

  return { projectId, clientEmail, privateKey: normalisePrivateKey(privateKey) }
}

let cached: Firestore | null | undefined
let initError: string | null = null

function app(): App | null {
  const existing = getApps()
  if (existing.length > 0) return getApp()

  const account = serviceAccount()
  if (!account) {
    initError =
      'Firebase is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (or FIREBASE_SERVICE_ACCOUNT).'
    return null
  }

  try {
    return initializeApp({ credential: cert(account), projectId: account.projectId })
  } catch (err) {
    // Almost always a private key that lost its newlines on the way into the
    // environment. Say so, because "Failed to parse private key" on its own
    // sends people back to the Firebase console to regenerate a key that was
    // never the problem.
    initError = err instanceof Error ? err.message : 'Firebase failed to initialise.'
    return null
  }
}

/**
 * The Firestore handle, or `null` when this deploy has no Firebase credentials.
 *
 * Callers must handle `null`. The shape that reads best at the call site is
 * `const store = db(); if (!store) return []` — an unconfigured deploy has
 * stored nothing, which is the same answer as a configured one that has not
 * synced yet.
 */
export function db(): Firestore | null {
  if (cached !== undefined) return cached
  const instance = app()
  cached = instance ? getFirestore(instance) : null
  return cached
}

/** True when this deploy can persist. Used by `/api/diag` and the dashboard. */
export function firestoreConfigured(): boolean {
  return db() !== null
}

/** Why `db()` is null, for the diagnostics endpoint. Null when it isn't. */
export function firestoreError(): string | null {
  db()
  return db() === null ? initError : null
}

/**
 * A real round trip to Firestore, for `/api/diag`.
 *
 * `firestoreConfigured()` only proves the credentials parsed. It does not prove
 * the project has a Firestore database provisioned, that the service account
 * carries the datastore role, or that the network can reach Google — each of
 * which fails much later and much less legibly, inside a batch sync that has
 * already spent two minutes reading platforms.
 */
export async function firestorePing(): Promise<{ ok: boolean; note: string }> {
  const store = db()
  if (!store) return { ok: false, note: initError ?? 'Firebase is not configured.' }
  try {
    await store.collection('_healthcheck').doc('ping').get()
    return { ok: true, note: 'Firestore answered a read.' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, note: `Firestore refused a read: ${message}` }
  }
}
