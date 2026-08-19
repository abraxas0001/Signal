/**
 * Account separation.
 *
 * The store has been per-account since accounts existed. Four other caches were
 * not, and nobody noticed until a dashboard put one of them on screen: signing
 * in as a second person showed the first person's tracked accounts and the
 * public-opinion readings measured on them — including the text of comments
 * real people had left.
 *
 * That is the single worst failure this product can have. Everything it holds
 * is a record about named citizens and unproven allegations, and its entire
 * promise is that those records stay where they were put. So the separation is
 * asserted here rather than left to whoever next adds a cache.
 *
 * Run: npm run test:scoping
 */

/* A localStorage that lives in memory, installed before anything imports. */
class MemoryStorage {
  private data = new Map<string, string>()
  getItem(k: string): string | null {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v)
  }
  removeItem(k: string): void {
    this.data.delete(k)
  }
  clear(): void {
    this.data.clear()
  }
  keys(): string[] {
    return [...this.data.keys()]
  }
}

const memory = new MemoryStorage()
;(globalThis as Record<string, unknown>)['localStorage'] = memory

const { STORE_KEY, scopedKey, setStorageKey } = await import('../src/lib/store')

let failures = 0
const results: { ok: boolean; label: string; detail: string }[] = []

function check(label: string, ok: boolean, detail = ''): void {
  results.push({ ok, label, detail })
  if (!ok) failures += 1
}

/* ── the default account keeps the original keys ─────────────────────────── */

setStorageKey(STORE_KEY)

const BASES = [
  'signal.handles.v1',
  'signal.standing.v1',
  'signal.rivals.v1',
  'signal:history:v1',
]

for (const base of BASES) {
  check(
    `default account keeps "${base}" unchanged`,
    scopedKey(base) === base,
    `got ${scopedKey(base)}`,
  )
}

/* ── a second account gets its own namespace ─────────────────────────────── */

const ACCOUNT_A = `${STORE_KEY}:aaaa1111`
const ACCOUNT_B = `${STORE_KEY}:bbbb2222`

setStorageKey(ACCOUNT_A)
const forA = BASES.map(scopedKey)

setStorageKey(ACCOUNT_B)
const forB = BASES.map(scopedKey)

for (let i = 0; i < BASES.length; i += 1) {
  const base = BASES[i]!
  check(
    `"${base}" differs between two accounts`,
    forA[i] !== forB[i],
    `A=${forA[i]} B=${forB[i]}`,
  )
  check(
    `"${base}" differs from the default account`,
    forA[i] !== base,
    `A=${forA[i]}`,
  )
}

/* ── and switching back returns the same namespace, not a new one ────────── */

setStorageKey(ACCOUNT_A)
check(
  'switching back to an account restores its own keys',
  BASES.map(scopedKey).every((k, i) => k === forA[i]),
  'keys were not stable across a switch away and back',
)

/* ── the real thing: writes under one account are invisible to another ───── */

const handles = await import('../src/lib/handles')

memory.clear()

setStorageKey(ACCOUNT_A)
handles.saveHandle({
  id: 'youtube:alpha',
  platform: 'YouTube',
  handle: 'alpha',
  displayName: 'Account A page',
  profileUrl: 'https://youtube.com/@alpha',
  avatarUrl: null,
  own: true,
  label: null,
  listingNote: '',
  snapshots: [],
})
handles.saveStandingCache('youtube:alpha', {
  score: 70,
  label: 'Warm',
  positive: 70,
  negative: 0,
  neutral: 30,
  praise: ['a comment only account A should ever see'],
  criticism: [],
  summary: '',
  commentsRead: 60,
  postsRead: 2,
  readAt: new Date(0).toISOString(),
})

const aHandles = handles.listHandles()
check('account A sees its own handle', aHandles.length === 1, `saw ${aHandles.length}`)

setStorageKey(ACCOUNT_B)
const bHandles = handles.listHandles()
check(
  'account B sees NONE of account A handles',
  bHandles.length === 0,
  `leaked ${bHandles.length}: ${bHandles.map((h) => h.handle).join(', ')}`,
)
check(
  'account B sees NONE of account A standing readings',
  handles.readStandingCache('youtube:alpha') === null,
  'a standing reading leaked across accounts',
)

setStorageKey(ACCOUNT_A)
check(
  'account A still has its handle after B looked',
  handles.listHandles().length === 1,
  'account A lost its own data',
)
check(
  'account A still has its standing reading',
  handles.readStandingCache('youtube:alpha')?.commentsRead === 60,
  'account A lost its own reading',
)

/* ── report ──────────────────────────────────────────────────────────────── */

const bold = (s: string): string => `[1m${s}[0m`
const green = (s: string): string => `[32m${s}[0m`
const red = (s: string): string => `[31m${s}[0m`

console.log(`\n${bold('Account separation')}\n`)
for (const r of results) {
  const mark = r.ok ? green('PASS') : red('FAIL')
  console.log(`  ${mark}  ${r.label}${r.ok || !r.detail ? '' : `\n        ${r.detail}`}`)
}

console.log(`\n${results.length - failures} passed, ${failures} failed`)

if (failures > 0) {
  console.log(
    red(
      bold(
        '\nFAIL — one account can read another account records. Any new localStorage key must go through scopedKey().',
      ),
    ),
  )
  process.exit(1)
}
console.log(green(bold('\nPASS — accounts cannot see each other data')))
