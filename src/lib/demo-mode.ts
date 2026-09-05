/**
 * The demo desk: a real, populated account that anyone can open, with no
 * passphrase.
 *
 * WHY IT IS NOT A VAULT ACCOUNT. Every other account here is encrypted, because
 * every other account holds an office's private work — constituent grievances,
 * private notes, who they are watching and why. This one holds nothing of the
 * sort: five public figures and the posts they published in public. Encrypting
 * it would mean either shipping a passphrase in the source, which protects
 * nothing and pretends to, or asking a first-time visitor to invent one before
 * they have seen a single screen. So the demo lives in its own unencrypted
 * storage namespace and is open to whoever opens the app.
 *
 * IT IS A SEPARATE NAMESPACE, NOT A MODE OVER THE TOP. `setStorageKey` points
 * the whole store at `signal:store:demo`, so the demo's handles, notes and
 * actions are as isolated from a real account's as two real accounts are from
 * each other. Nothing written while exploring can reach anybody's own desk, and
 * leaving is a matter of pointing the key back — no cleanup, no deletion, no
 * risk of taking real records with it.
 *
 * IT IS ALSO EXCLUSIVE WITH BEING SIGNED IN. The example desk and a real
 * account are two different scopes, and exactly one of them can be live. The
 * store enforces that half — the open-demo flag is a mirror of which namespace
 * is pointed at, so signing in anywhere closes the demo by construction. This
 * module enforces the other half: opening the demo signs out first, rather than
 * leaving a live account's encryption key installed over the demo's storage.
 */

import {
  DEMO_STORE_KEY,
  demoWasOpen,
  isDemoScope,
  PLAIN_CODEC,
  readStore,
  setCodec,
  update,
  setStorageKey,
  STORE_KEY,
} from '@/lib/store'
import { isLocked, resealDefaultScope, signOut } from '@/lib/vault'
import { listHandles } from '@/lib/handles'
import { applyPrincipal, loadDemoRoster, readChoice, saveChoice } from '@/lib/demo-roster'

export { DEMO_STORE_KEY }

/**
 * Is the example desk open right now?
 *
 * Asks the store which namespace is live rather than reading a flag of its own.
 * The flag says what was true when the page last loaded; this says what is true
 * now, and after somebody signs in those are different answers.
 */
export function isDemoMode(): boolean {
  return isDemoScope()
}

/**
 * What this build seeds into the demo namespace.
 *
 * Bump it whenever `applyPrincipal` starts writing something it did not write
 * before, so a visitor carrying a namespace from an older build gets the new
 * shape instead of a half-filled one.
 */
// 20: YouTube videos carry their real publish dates, read from the channel
// feed and the watch pages rather than left null.
// 22: FLUSH. A persona suffix was briefly applied to the demo's storage keys
// too, so `applyPrincipal` could write the new principal's accounts under one
// key while the dashboard read another — leaving the PREVIOUS politician's
// handles in the list, still marked as the desk's own. A desk showed D. K.
// Aruna's accounts and Rahul Gandhi's 1.6-crore Instagram together, and summed
// both into "followers across your accounts". The cause is fixed in
// lib/personas.ts (the demo is never persona-scoped); this bump is what clears
// the merged list out of browsers that already have one.
// 23: a fresh dated follower reading across the whole roster (3 Sept), so
// every account carries three readings spanning 27 Aug to 3 Sept instead of
// two inside four days. The growth chart drew a flat single line because the
// history was too short to have a shape, not because the arithmetic was
// wrong. A namespace seeded before this keeps the old two readings until the
// version moves, so this bump is what actually delivers the new data.
// 24: YouTube posts now carry like counts. The `videos.xml` feed — the only
// keyless route that ever published them — answers 404 for every channel now,
// so both readers fell through to routes that give views and no likes, and
// YouTube engagement was permanently NA. The like count is stated on each
// watch page, which the scraper already opens for the exact publish date, so
// it costs nothing extra: 25 of 25 videos now carry one.
const SEED_VERSION = '24'
const SEED_KEY = 'signal.demo.seed'

/**
 * The stamp a seeded desk carries: the build's seed version AND the dataset's
 * own generatedAt.
 *
 * The version alone had to be bumped by hand for any data change to reach a
 * desk that was already seeded, and nobody bumps a constant after running a
 * scraper: the office re-scraped the accounts, opened the demo, and read
 * last week's numbers under this week's date. The scrape already writes the
 * moment it ran into the file, so the file itself now names the seed.
 */
const seedStamp = (roster: { generatedAt: string }): string =>
  `${SEED_VERSION}:${roster.generatedAt}`

/**
 * Open the demo desk.
 *
 * Returns false when the dataset is not deployed, so the caller can leave the
 * button out rather than offering a demo that opens onto nothing.
 */
export async function enterDemoMode(): Promise<boolean> {
  const roster = await loadDemoRoster()
  if (!roster) return false

  /**
   * Close any real account first.
   *
   * Not housekeeping. A signed-in session has the vault's live codec installed,
   * which seals every write with that account's key — so pointing the store at
   * the demo without signing out would encrypt the example desk into a real
   * account's envelope, and the reader's own records would be what the demo
   * overwrote. Signing out flushes their last edit and installs the SEALING
   * codec, which refuses to write at all — the line below is what then makes
   * the demo namespace writable.
   */
  if (!isLocked()) await signOut()

  setStorageKey(DEMO_STORE_KEY)
  /**
   * The demo namespace is unencrypted, so it needs the plaintext codec — and
   * on any device that has ever had an account, it does not have it.
   *
   * `initVault` installs a sealing codec whose `encode` throws the moment the
   * account index is non-empty, and `signOut` reinstalls it. `writeStore`
   * swallows that throw on purpose, so seeding the example desk succeeded into
   * the in-memory cache and wrote nothing at all. The demo looked correct for
   * as long as the tab stayed open; one reload and it was the setup screen,
   * because nothing had ever reached disk. Measured on the built app: 25,489
   * bytes stored with no accounts on the device, 0 bytes with one.
   *
   * `store.ts` already says the key and the codec have to move together. This
   * is the call site that was not doing it.
   */
  setCodec(PLAIN_CODEC)

  /**
   * Seed unless this namespace is genuinely ready, and check three things.
   *
   * The first version asked only "are there handles?", and that made the button
   * look broken. Anyone who had opened the demo under an earlier build already
   * had twenty handles, so seeding was skipped — but that build had never
   * written the office profile, so `onboardedAt` was absent, the app quite
   * correctly showed the "whose desk is this?" setup screen, and clicking the
   * button did nothing visible forever. It was firing every time; there was
   * simply nothing behind it. Reproduced exactly: flag set, store never
   * written, still on the setup screen.
   *
   * So: the version has to match this build, the handles have to be there, and
   * the desk has to have been stamped as configured. Any one of those missing
   * and it is rebuilt from the roster.
   */
  let stamped = false
  try {
    stamped = localStorage.getItem(SEED_KEY) === seedStamp(roster)
  } catch {
    /* unreadable storage: treat as unseeded and rebuild */
  }
  const ready = stamped && listHandles().length > 0 && Boolean(readStore().onboardedAt)

  if (!ready) {
    const key = readChoice() ?? roster.pairings[0]?.principal
    if (key) {
      applyPrincipal(roster, key)
      saveChoice(key)
      try {
        localStorage.setItem(SEED_KEY, seedStamp(roster))
      } catch {
        /* the desk still opens; it will simply be rebuilt on the next visit */
      }
    }
  }
  return true
}

/**
 * Leave the demo and hand the app back to the real accounts.
 *
 * The demo's records are left where they are rather than wiped. They cost a few
 * hundred kilobytes, they contain nothing private, and keeping them means a
 * second visit reopens instantly instead of re-seeding — while the namespace
 * boundary already guarantees they cannot leak into whoever signs in next.
 */
export function exitDemoMode(): void {
  setStorageKey(STORE_KEY)
  // And put the sealing codec back, or the next write lands in cleartext on a
  // key that is supposed to hold ciphertext.
  resealDefaultScope()
}

/**
 * Point the store at the demo namespace on boot, before anything reads it.
 *
 * Only ever a guess, and deliberately a cheap one to undo: it runs before the
 * vault has had a chance to restore a stored session, so a device that was
 * signed in gets pointed at the demo for the moment it takes `restoreSession`
 * to resolve — at which point `adopt` moves the namespace to the real account
 * and the flag clears itself. Guessing the other way would be worse: a visitor
 * with the demo open would see the door for a beat before their desk came back.
 */
export function restoreDemoModeIfActive(): boolean {
  if (!demoWasOpen()) return false
  setStorageKey(DEMO_STORE_KEY)
  setCodec(PLAIN_CODEC)
  return true
}

/**
 * Rebuild a restored demo that a newer build has moved past.
 *
 * The seed check lived only inside `enterDemoMode`, so it ran when somebody
 * walked through the door and never when a returning tab was pointed straight
 * back at the namespace by the restore above. A visitor who kept the demo
 * open across a data update was stranded on the old dataset for as long as
 * they kept returning — reload after reload, always one version behind the
 * door. Returns true when it reseeded, so the caller can remount the desk.
 */
export async function reseedDemoIfStale(): Promise<boolean> {
  if (!isDemoMode()) return false
  let stamped: string | null = null
  try {
    stamped = localStorage.getItem(SEED_KEY)
  } catch {
    /* unreadable storage: leave the namespace as it is */
  }

  // The roster has to be read before the stamp can be judged, because the
  // stamp now carries the dataset's generatedAt: a fresh scrape IS a new
  // seed, with no constant to remember to bump.
  const roster = await loadDemoRoster()
  if (!roster) return false
  if (stamped === seedStamp(roster)) return false

  const key = readChoice() ?? roster.pairings[0]?.principal
  if (!key) return false

  /**
   * WORK DONE ON THIS DESK SURVIVES THE RESEED.
   *
   * applyPrincipal spreads a fresh copy of the example content over the
   * store, which is right on first entry and catastrophic on a desk somebody
   * has actually used: an office that ran a real news scan here held 145
   * scanned stories, and an automatic reseed would have replaced them with
   * the twelve example cuttings without so much as a message. Everything the
   * example seeder writes carries a `demo_` id; everything a real scan or a
   * real filing writes does not. So the reseed refreshes the example rows
   * and the scraped accounts, and every row of real work is put back exactly
   * as it was.
   */
  const before = readStore()
  applyPrincipal(roster, key)
  const keepWork = <T extends { id: string }>(prev: T[], seeded: T[]): T[] => {
    const real = prev.filter((x) => !String(x.id).startsWith('demo_'))
    if (real.length === 0) return seeded
    const ids = new Set(real.map((x) => x.id))
    return [...real, ...seeded.filter((x) => !ids.has(x.id))]
  }
  update((next) => ({
    ...next,
    personaMentions: keepWork(before.personaMentions, next.personaMentions),
    grievances: keepWork(before.grievances, next.grievances),
    issues: keepWork(before.issues, next.issues),
    mentions: keepWork(before.mentions, next.mentions),
    actions: keepWork(before.actions, next.actions),
    personas: keepWork(before.personas, next.personas),
  }))

  saveChoice(key)
  try {
    localStorage.setItem(SEED_KEY, seedStamp(roster))
  } catch {
    /* it reseeds again next visit, which is correct */
  }
  return true
}
