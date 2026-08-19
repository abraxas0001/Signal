/**
 * Place resolution.
 *
 * The case that produced this file: resolving D. K. Aruna returned a district
 * of "Mahaboobnagar" and a constituency of "Gadwal". The registry spells them
 * "Mahabubnagar" and "Jogulamba Gadwal", `indexUrlFor` does not throw on a
 * district it cannot place, and the whole news scan silently widened from one
 * assembly segment to the entire state — returning nothing, which an office
 * reads as a quiet week.
 *
 * Every case below is either a real spelling seen in the wild or a guard
 * against the matcher becoming so loose that it places things that are not
 * there. The second half matters as much as the first: a matcher that always
 * finds something is exactly as useless as one that never does.
 *
 * Run: npm run test:places
 */

import { foldPlace, matchPlace, resolvePlace, placeVariants } from '../shared/places'
import { citiesOf, indexUrlFor, PORTALS } from '../shared/regions'

let failures = 0
const results: { ok: boolean; label: string; detail: string }[] = []

function check(label: string, ok: boolean, detail = ''): void {
  results.push({ ok, label, detail })
  if (!ok) failures += 1
}

/* ── folding ─────────────────────────────────────────────────────────────── */

const FOLD_SAME: [string, string][] = [
  ['Mahabubnagar', 'Mahaboobnagar'],
  ['Mahabubnagar', 'Mehboobnagar'],
  ['Mahabubnagar', 'Mahboobnagar'],
  ['Mahabubnagar', 'Mahbubnagar'],
  ['Karimnagar', 'Kareemnagar'],
  ['Nizamabad', 'Nizamabaad'],
  ['Bhadradri Kothagudem', 'Badradri Kotagudem'],
]

// Asserted as "resolves to the same district", not "folds to an identical
// string". Folding is one of four passes and the skeleton pass exists precisely
// for the spellings folding cannot reconcile; testing the internal
// representation instead of the outcome would fail on a correct matcher.
for (const [a, b] of FOLD_SAME) {
  const pool = [a]
  check(
    `"${b}" resolves to "${a}"`,
    matchPlace(b, pool)?.canonical === a,
    `matched ${matchPlace(b, pool)?.canonical ?? 'nothing'}`,
  )
}

// And the guard: genuinely different districts must NOT collapse.
const FOLD_DIFFERENT: [string, string][] = [
  ['Mahabubnagar', 'Mahabubabad'],
  ['Warangal', 'Wanaparthy'],
  ['Nalgonda', 'Nagarkurnool'],
  ['Medak', 'Medchal-Malkajgiri'],
]
for (const [a, b] of FOLD_DIFFERENT) {
  check(`"${a}" and "${b}" stay apart`, foldPlace(a) !== foldPlace(b), `both folded to ${foldPlace(a)}`)
}

/* ── the real case ───────────────────────────────────────────────────────── */

const telangana = citiesOf('Telangana')

const aruna = resolvePlace({
  state: 'Telangana',
  district: 'Mahaboobnagar',
  constituency: 'Gadwal',
})

check('D. K. Aruna: state resolves', aruna.state === 'Telangana', String(aruna.state))
check(
  'D. K. Aruna: "Mahaboobnagar" resolves to Mahabubnagar',
  aruna.district === 'Mahabubnagar',
  String(aruna.district),
)
check(
  'D. K. Aruna: the correction is reported, not silent',
  aruna.notes.some((n) => n.includes('Mahabubnagar')),
  JSON.stringify(aruna.notes),
)

// And the thing that actually broke: the district edition URL.
const eenadu = PORTALS.find((p) => p.label === 'Eenadu')!
const before = indexUrlFor(eenadu, 'Mahaboobnagar', 'Telangana')
const after = indexUrlFor(eenadu, aruna.district, 'Telangana')
check(
  'the unresolved spelling really did fall back to the state index',
  !before.includes('mahabubnagar'),
  `expected a fallback, got ${before}`,
)
check(
  'the resolved spelling reaches the district edition',
  after.includes('mahabubnagar'),
  after,
)

/* ── constituency standing in for district ───────────────────────────────── */

const gadwalOnly = resolvePlace({ state: 'Telangana', constituency: 'Gadwal' })
check(
  '"Gadwal" alone finds Jogulamba Gadwal',
  gadwalOnly.district === 'Jogulamba Gadwal',
  String(gadwalOnly.district),
)

const jadcherla = resolvePlace({ state: 'Telangana', constituency: 'Jadcherla' })
check(
  'a town inside a district resolves to the district',
  jadcherla.district === 'Mahabubnagar',
  String(jadcherla.district),
)

/* ── other real spellings ────────────────────────────────────────────────── */

const CASES: { given: string; expect: string }[] = [
  { given: 'Warangal Urban', expect: 'Hanamkonda' },
  { given: 'Bhupalpally', expect: 'Jayashankar Bhupalpally' },
  { given: 'Asifabad', expect: 'Komaram Bheem Asifabad' },
  { given: 'Sircilla', expect: 'Rajanna Sircilla' },
  { given: 'Kothagudem', expect: 'Bhadradri Kothagudem' },
  { given: 'Ranga Reddy', expect: 'Rangareddy' },
  { given: 'Secunderabad', expect: 'Hyderabad' },
]
for (const c of CASES) {
  const hit = matchPlace(c.given, telangana)
  check(`"${c.given}" resolves to ${c.expect}`, hit?.canonical === c.expect, String(hit?.canonical))
}

const ap = citiesOf('Andhra Pradesh')
for (const c of [
  { given: 'Vizag', expect: 'Visakhapatnam' },
  { given: 'Cuddapah', expect: 'YSR Kadapa' },
  { given: 'Anantapuramu', expect: 'Anantapur' },
]) {
  const hit = matchPlace(c.given, ap)
  check(`"${c.given}" resolves to ${c.expect}`, hit?.canonical === c.expect, String(hit?.canonical))
}

/* ── the guards: it must refuse rather than guess ────────────────────────── */

for (const nonsense of ['Zzzzville', 'Springfield', 'Neverwhere', 'Q']) {
  check(
    `"${nonsense}" is refused rather than guessed at`,
    matchPlace(nonsense, telangana) === null,
    `matched ${matchPlace(nonsense, telangana)?.canonical}`,
  )
}

const unplaceable = resolvePlace({ state: 'Telangana', district: 'Springfield' })
check(
  'an unplaceable district is reported to the office',
  unplaceable.district === null && unplaceable.notes.some((n) => n.includes('Could not place')),
  JSON.stringify(unplaceable.notes),
)

/* ── deriving the state from the district ────────────────────────────────── */

const derived = resolvePlace({ district: 'Khammam' })
check(
  'a district with no state derives Telangana',
  derived.state === 'Telangana' && derived.district === 'Khammam',
  `${derived.state} / ${derived.district}`,
)
check(
  'and says that it derived it',
  derived.notes.some((n) => n.includes('taken from the district')),
  JSON.stringify(derived.notes),
)

/* ── search variants ─────────────────────────────────────────────────────── */

const variants = placeVariants(gadwalOnly.districtMatch, 'Gadwal')
check(
  'variants carry both the registry name and the word a headline uses',
  variants.includes('Jogulamba Gadwal') && variants.includes('Gadwal'),
  variants.join(', '),
)

/* ── report ──────────────────────────────────────────────────────────────── */

const bold = (s: string): string => `[1m${s}[0m`
const green = (s: string): string => `[32m${s}[0m`
const red = (s: string): string => `[31m${s}[0m`

console.log(`\n${bold('Place resolution')}\n`)
for (const r of results) {
  console.log(
    `  ${r.ok ? green('PASS') : red('FAIL')}  ${r.label}${r.ok || !r.detail ? '' : `\n        got: ${r.detail}`}`,
  )
}
console.log(`\n${results.length - failures} passed, ${failures} failed`)

if (failures > 0) {
  console.log(red(bold('\nFAIL — a desk would be pointed at the wrong district, or at none.')))
  process.exit(1)
}
console.log(green(bold('\nPASS — place names resolve, and refuse when they cannot')))
