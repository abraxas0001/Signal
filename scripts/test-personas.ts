/**
 * Removing a desk must take THIS account's copy and nobody else's.
 *
 * The bug this pins: `removePersona` matched keys with
 * `k.endsWith('::p-<key>')`, which is true of every account that watches the
 * same politician. One person on a shared office phone pressing "stop
 * watching Modi" deleted every other account's Modi desk with it.
 */
import { STORE_KEY, setStorageKey, scopedKey } from '../src/lib/store'

let pass = 0
let fail = 0
const check = (name: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}`)
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)
  ok ? (pass += 1) : (fail += 1)
}

/** A localStorage good enough for key bookkeeping. */
class FakeStorage {
  private m = new Map<string, string>()
  get length(): number {
    return this.m.size
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v)
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
  clear(): void {
    this.m.clear()
  }
  keys(): string[] {
    return [...this.m.keys()].sort()
  }
}

const store = new FakeStorage()
;(globalThis as unknown as { localStorage: FakeStorage }).localStorage = store

// personas.ts reads localStorage at call time, so import after the shim.
const { addPersona, removePersona, listPersonas, setActivePersona, PRIMARY } = await import(
  '../src/lib/personas'
)

/** Every per-desk key that could exist for one persona, across three scopes. */
function seed(): void {
  store.clear()
  for (const k of [
    'signal.handles.v1::p-modi', // default account's Modi desk
    'signal.standing.v1::p-modi',
    'signal.handles.v1::acc9f2::p-modi', // another account's Modi desk
    'signal.standing.v1::acc9f2::p-modi',
    'signal.handles.v1::demo::p-modi', // the example desk's
    'signal.handles.v1', // the default account's OWN desk
    'signal.handles.v1::acc9f2', // another account's own desk
    'signal.handles.v1::p-rahul', // a different persona, same account
  ]) {
    store.setItem(k, '[]')
  }
}

/* ── on the default account ──────────────────────────────────────────────── */

setStorageKey(STORE_KEY)
seed()
store.setItem('signal.personas.v1', JSON.stringify([{ key: 'modi', name: 'Narendra Modi' }]))
removePersona('modi')

check(
  'the default account loses only its own Modi keys',
  store.keys(),
  [
    'signal.handles.v1',
    'signal.handles.v1::acc9f2',
    'signal.handles.v1::acc9f2::p-modi',
    'signal.handles.v1::demo::p-modi',
    'signal.handles.v1::p-rahul',
    'signal.personas.v1',
    'signal.standing.v1::acc9f2::p-modi',
  ],
)

/* ── on a second account ─────────────────────────────────────────────────── */

setStorageKey(`${STORE_KEY}:acc9f2`)
seed()
store.setItem(scopedKey('signal.personas.v1'), JSON.stringify([{ key: 'modi', name: 'Narendra Modi' }]))
removePersona('modi')

check(
  'a second account loses only ITS Modi keys, never the default account’s',
  store.keys().filter((k) => k.includes('p-modi')),
  ['signal.handles.v1::demo::p-modi', 'signal.handles.v1::p-modi', 'signal.standing.v1::p-modi'],
)

/* ── the primary is not removable ────────────────────────────────────────── */

setStorageKey(STORE_KEY)
seed()
removePersona(PRIMARY)
check('removing the primary is refused and deletes nothing', store.keys().length, 8)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
