/**
 * Create (or re-key) a handed-over desk account, from this machine.
 *
 *   npm run desk:provision -- dkaruna "D. K. Aruna" "the-passphrase"
 *
 * Writes the credential record straight into Firestore with the service
 * account in .env — the same credentials the deployed functions use. The
 * passphrase is printed once, here, and stored nowhere but your handover note:
 * the server keeps only a scrypt hash.
 */

import { createDeskAccount, normaliseDeskId } from '../netlify/functions/lib/desk-sync'

async function main(): Promise<void> {
  const [rawId, name, passphrase] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const deskId = normaliseDeskId(rawId)
  if (!deskId || !name || !passphrase) {
    console.log('Usage: npm run desk:provision -- <deskId> "<Full Name>" "<passphrase>"')
    process.exit(1)
  }

  const made = await createDeskAccount(deskId, name, passphrase)
  if (!made.ok) {
    console.log(`Could not provision: ${made.note}`)
    process.exit(1)
  }
  console.log(`Desk account ready.`)
  console.log(`  desk id:    ${deskId}`)
  console.log(`  name:       ${made.value.name}`)
  console.log(`  passphrase: ${passphrase}`)
  console.log(`\nHand these over together. Running this again with a new passphrase re-keys the desk.`)
}

void main()
