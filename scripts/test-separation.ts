/**
 * Data separation: nothing about one desk may reach another.
 *
 * There are four ways data can cross on this product, and each has produced a
 * real bug:
 *
 *   account -> account   two people on one office phone (scopedKey)
 *   desk -> desk         two politicians on one account (deskKey)
 *   demo -> real         the example desk and a real one (isDemoScope)
 *   watched -> own       another politician's account counted as yours
 *
 * This walks the source rather than the runtime, because the failure mode is
 * always the same: ONE cache that was not routed through the right key. A test
 * that exercises the caches it knows about cannot catch the one somebody adds
 * next month; a test that reads every storage key in src/ can.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const OFF = '\x1b[0m'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? GREEN + 'PASS' + OFF : RED + 'FAIL' + OFF}  ${name}${detail ? `  ${DIM}${detail}${OFF}` : ''}`)
  ok ? (pass += 1) : (fail += 1)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

const files = walk('src')

/* ── 1 · every storage key is scoped ─────────────────────────────────────── */

/**
 * Keys that are correctly device-wide, with the reason. Anything else that
 * reaches localStorage without a scoping helper is a leak between accounts.
 */
const DEVICE_WIDE: Record<string, string> = {
  'signal:theme': 'a display preference',
  'signal:accounts': 'the vault account index itself',
  'signal:session': 'this tab’s session token',
  'signal:settingsKey': 'the admin key, deliberately device-level',
  signalNav: 'browser navigation history',
  'signal.demo.seed': 'which demo dataset version is installed',
  'signal.demo.mode': 'which namespace is open',
  'signal.demo.principal': 'demo-only, and the demo is one namespace',
  'signal.desk.session': 'the handed-over desk session',
  'signal.desk.lastId': 'the last desk id typed on this device',
  'signal.desk.relock': 'a one-shot note to the entry screen',
}

const literalKey = /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*'([^']+)'/g
const unscoped: string[] = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(literalKey)) {
    const key = m[1]!
    if (key in DEVICE_WIDE) continue
    unscoped.push(`${f}: ${key}`)
  }
}
check(
  'no literal storage key bypasses scoping',
  unscoped.length === 0,
  unscoped.length ? unscoped.join('; ') : `${Object.keys(DEVICE_WIDE).length} device-wide keys allowed`,
)

/* ── 2 · subject-derived caches use deskKey, not scopedKey ───────────────── */

/**
 * A cache holding something ABOUT a politician must move when the desk moves.
 * Keyed per account only, switching to another politician's desk hands back
 * the previous one's content under the new one's name.
 */
const PER_DESK = [
  'signal.handles.v1',
  'signal.rivals.v1',
  'signal.standing.v1',
  'signal.standingNote.v1',
  'signal.relevance.v1',
  'signal.deskBrand.v1',
  'signal.postIdea.v1',
  'signal.postPlan.v1',
  'signal.posters.v1',
  'signal.suggestions.v1',
  'signal.weekCompare.v1',
  'signal.scanjob.v1',
  'signal:compare-notes:',
]

const wrongScope: string[] = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  for (const base of PER_DESK) {
    // Find how this base is keyed, wherever it is declared.
    // Plain string search rather than a regex: the bases contain dots and
    // colons, and an escaping slip here would silently match nothing, which
    // is the one failure mode a separation test must not have.
    const scoped = src.includes("scopedKey('" + base) || src.includes('scopedKey(`' + base)
    const desk = src.includes("deskKey('" + base) || src.includes('deskKey(`' + base)
    if (scoped && !desk) wrongScope.push(`${f}: ${base}`)
  }
}
check(
  'every subject-derived cache is keyed per desk',
  wrongScope.length === 0,
  wrongScope.length ? wrongScope.join('; ') : `${PER_DESK.length} caches checked`,
)

/* ── 3 · no "if nothing is ours, count everything" fallback ──────────────── */

/**
 * The bug that put another politician's 1.6 crore followers into a desk's own
 * reach. It existed in two components with the same shape.
 */
const fallback = /own(?:Handles)?\.length\s*>\s*0\s*\?\s*own(?:Handles)?\s*:\s*handles/
const fallbacks = files.filter((f) => fallback.test(readFileSync(f, 'utf8')))
check(
  'no screen totals watched accounts when none are marked own',
  fallbacks.length === 0,
  fallbacks.length ? fallbacks.join('; ') : 'checked every component',
)

/* ── 4 · the demo is never desk-suffixed ─────────────────────────────────── */

const personas = readFileSync('src/lib/personas.ts', 'utf8')
check(
  'the example desk is exempt from desk suffixes',
  /isDemoScope\(\)\s*\)?\s*return PRIMARY/.test(personas),
  'activePersona() short-circuits in the demo',
)
check(
  'the example desk refuses to have a desk selected',
  /export function setActivePersona[\s\S]{0,220}isDemoScope\(\)\s*\)?\s*return/.test(personas),
  'setActivePersona() short-circuits in the demo',
)

/* ── 5 · the persona list itself is not desk-scoped ──────────────────────── */

check(
  'the desk list is stored per account, not per desk',
  /LIST_KEY\s*=\s*\(\):\s*string\s*=>\s*scopedKey/.test(personas) &&
    /ACTIVE_KEY\s*=\s*\(\):\s*string\s*=>\s*scopedKey/.test(personas),
  'a desk list inside a desk would lose the way back',
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
