import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * At-rest encryption for the connected-account tokens in `connections.ts`.
 *
 * The same cipher choice as `src/lib/vault.ts` (AES-256-GCM), adapted for a
 * server secret rather than a human passphrase: the key material here is
 * already high-entropy and generated once by the operator, so there is no
 * PBKDF2 stretch to do.
 *
 * BE HONEST ABOUT WHAT THIS BUYS, the way `meta-graph.ts` is honest about
 * what a page token cannot do: `CONNECTIONS_ENCRYPTION_KEY` lives in the same
 * env-var scope as the function that decrypts this. It defends against the
 * Blobs store leaking independently of that scope — a misconfigured debug
 * route, a backup of blob storage handled less carefully than the env-var
 * vault — not against a compromised function or a leaked key itself.
 */

const IV_BYTES = 12

function key(): Buffer {
  const raw = process.env['CONNECTIONS_ENCRYPTION_KEY']
  if (!raw) throw new Error('CONNECTIONS_ENCRYPTION_KEY is not set.')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new Error('CONNECTIONS_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).')
  }
  return buf
}

/** iv | tag | ciphertext, each base64, dot-joined — one self-describing string to store. */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ct].map((b) => b.toString('base64')).join('.')
}

export function decryptJson<T>(envelope: string): T {
  const [ivB64, tagB64, ctB64] = envelope.split('.')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed connection envelope.')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()])
  return JSON.parse(pt.toString('utf8')) as T
}
