/**
 * Desk auto-configuration.
 *
 * When an office picks a person, this app decides on their behalf which
 * newspapers get read every morning and which words count as being about them.
 * Both decisions fail silently when they are wrong: the wrong district reads a
 * whole state and finds nothing, and a missing search term means the one story
 * that mattered was never seen. Neither produces an error. Both look exactly
 * like a quiet week.
 *
 * So the assertions here are mostly about the failures that produce silence,
 * and about the two lists that have to agree with each other — the terms shown
 * on the identity card and the terms the scanner actually searches. Those drifted
 * apart once already, which meant Settings displayed an office a list of words
 * that was not the list being used.
 *
 * Run: npm run test:autoconfig
 */

/* localStorage stub, installed before anything that touches the store loads. */
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
}
;(globalThis as Record<string, unknown>)['localStorage'] = new MemoryStorage()

const { planDesk, planWatchTerms, planTerms, describePlan, PORTAL_BUDGET } = await import('../src/lib/autoconfig')
const { partyAbbreviation, tidyParty } = await import('../shared/identity')
const { resolvePlace } = await import('../shared/places')
const { indexUrlFor, PORTALS } = await import('../shared/regions')
type Identity = import('../shared/identity').Identity

let failures = 0
const results: { ok: boolean; label: string; detail: string }[] = []
const check = (label: string, ok: boolean, detail = ''): void => {
  results.push({ ok, label, detail })
  if (!ok) failures += 1
}

function person(over: Partial<Identity>): Identity {
  return {
    name: 'D. K. Aruna',
    aliases: [],
    photoUrl: null,
    role: 'MLA',
    party: 'Bharatiya Janata Party',
    constituency: 'Gadwal',
    district: 'Mahabubnagar',
    state: 'Telangana',
    age: 66,
    dateOfBirth: '1960-05-04',
    education: null,
    inOfficeSince: null,
    bio: null,
    handles: [],
    watchTerms: [],
    confidence: {},
    origin: {},
    sources: [],
    notes: [],
    resolvedAt: new Date(0).toISOString(),
    ...over,
  }
}

/* ── the district edition, which is the whole point ──────────────────────── */

const aruna = planDesk(person({}))

check('a state with mastheads on file produces portals', aruna.portals.length > 0, '0 portals')
check(
  'at least one paper is read at its district edition',
  aruna.portals.some((p) => p.reach === 'district'),
  aruna.portals.map((p) => `${p.label}:${p.reach}`).join(', '),
)
check(
  'every district-reach portal really points at the district',
  aruna.portals
    .filter((p) => p.reach === 'district')
    .every((p) => p.indexUrl.toLowerCase().includes('mahabubnagar')),
  aruna.portals.filter((p) => p.reach === 'district').map((p) => p.indexUrl).join(' | '),
)
check(
  'the portal count never exceeds what the scanner reads',
  aruna.portals.length <= PORTAL_BUDGET,
  `${aruna.portals.length} portals`,
)
check(
  'portals left out are counted rather than dropped silently',
  aruna.omittedPortals > 0,
  `omitted=${aruna.omittedPortals}`,
)
check(
  'local-language papers outrank English ones at the same reach',
  (() => {
    const state = aruna.portals.filter((p) => p.reach === 'state')
    const firstEnglish = state.findIndex((p) => p.language === 'English')
    const lastLocal = state.map((p) => p.language !== 'English').lastIndexOf(true)
    return firstEnglish === -1 || lastLocal === -1 || lastLocal < firstEnglish
  })(),
  aruna.portals.map((p) => `${p.label}(${p.language})`).join(', '),
)

/* ── the search terms ────────────────────────────────────────────────────── */

const terms = aruna.watchTerms

check('the full name is searched for', terms.includes('D. K. Aruna'), terms.join(', '))
check(
  'the surname alone is searched for — Telugu headlines print only that',
  terms.includes('Aruna'),
  terms.join(', '),
)
check(
  'the run-together initials form is searched for',
  terms.includes('DK Aruna'),
  terms.join(', '),
)
check('the seat is searched for', terms.includes('Gadwal'), terms.join(', '))
check('the district is searched for', terms.includes('Mahabubnagar'), terms.join(', '))
check(
  'the party ABBREVIATION is searched for, not the registered name',
  terms.includes('BJP') && !terms.includes('Bharatiya Janata Party'),
  terms.join(', '),
)
check(
  'no term is short enough to match everything',
  terms.every((t) => t.trim().length > 2),
  terms.filter((t) => t.trim().length <= 2).join(', '),
)

/* ── the party term, and where it must not go ────────────────────────────── */
/*
   Measured, not theorised. Scanning eight Telangana mastheads for a Gadwal MLA
   with the party in the alias list returned 24 stories, of which 19 were
   national BJP items — a Kolkata meeting, a Kejriwal quote, a party chief
   addressing youth workers — and none mentioned her at all. Removing the party
   term returned 0, which is the honest answer for that morning.

   So the party belongs to the grievance desk, which asks "what is happening
   politically near us", and never to the persona scan, which asks "what is
   being said about this person".
*/
const split = planTerms(
  person({}),
  resolvePlace({ state: 'Telangana', district: 'Mahabubnagar', constituency: 'Gadwal' }),
)

check(
  'the party term is NOT in what a persona scan searches',
  !split.persona.some((t) => /bjp|bharatiya/i.test(t)),
  split.persona.join(', '),
)
check(
  'the party term IS in the wide list the grievance desk uses',
  split.all.includes('BJP'),
  split.all.join(', '),
)
check(
  'a persona scan still searches the name and the patch',
  split.persona.includes('D. K. Aruna') &&
    split.persona.includes('Aruna') &&
    split.persona.includes('Gadwal') &&
    split.persona.includes('Mahabubnagar'),
  split.persona.join(', '),
)
check(
  'the groups do not overlap where they must not',
  split.name.every((t) => !split.party.includes(t)),
  `name=${split.name.join(',')} party=${split.party.join(',')}`,
)
check(
  'every group is a subset of the flat list',
  [...split.name, ...split.place, ...split.party].every((t) => split.all.includes(t)),
  'a term exists in a group but not in all',
)

/* ── the two lists that must agree ───────────────────────────────────────── */
/*
   The identity card shows one list and the scanner uses another. They were
   computed by two different functions and had already drifted — five terms
   shown against eight searched. Whichever number a reader believes, one of
   them is a lie, and nothing on screen says which.
*/
const viaPlanner = planWatchTerms(
  person({}),
  resolvePlace({ state: 'Telangana', district: 'Mahabubnagar', constituency: 'Gadwal' }),
)
check(
  'the terms shown and the terms searched are the same list',
  JSON.stringify(viaPlanner) === JSON.stringify(aruna.watchTerms),
  `${viaPlanner.join(',')} vs ${aruna.watchTerms.join(',')}`,
)

/* ── the misspelling that started all of this ────────────────────────────── */

const misspelled = planDesk(person({ district: 'Mahaboobnagar' }))
check(
  'a differently-spelled district still reaches the district edition',
  misspelled.portals.some(
    (p) => p.reach === 'district' && p.indexUrl.toLowerCase().includes('mahabubnagar'),
  ),
  misspelled.portals.map((p) => `${p.label}:${p.reach}`).join(', '),
)
check(
  'and the office is told the spelling was changed',
  misspelled.notes.some((n) => n.includes('Mahabubnagar')),
  JSON.stringify(misspelled.notes),
)

/* ── degrading honestly ──────────────────────────────────────────────────── */

const noState = planDesk(person({ state: null, district: null, constituency: null }))
check('no state means no portals', noState.portals.length === 0, `${noState.portals.length}`)
check(
  'and it says so rather than looking configured',
  noState.notes.some((n) => n.toLowerCase().includes('no state')),
  JSON.stringify(noState.notes),
)
check(
  'the name is still searched for even with no place at all',
  noState.watchTerms.includes('D. K. Aruna'),
  noState.watchTerms.join(', '),
)

const noHandles = planDesk(person({ handles: [] }))
check(
  'an office with no accounts is told what that costs them',
  noHandles.notes.some((n) => n.includes('what people are saying')),
  JSON.stringify(noHandles.notes),
)

/* ── party names ─────────────────────────────────────────────────────────── */

for (const [full, short] of [
  ['Bharatiya Janata Party, Telangana', 'BJP'],
  ['Indian National Congress', 'Congress'],
  ['Bharat Rashtra Samithi', 'BRS'],
  ['Telugu Desam Party', 'TDP'],
  ['YSR Congress Party', 'YSRCP'],
  ['All India Majlis-e-Ittehadul Muslimeen', 'AIMIM'],
] as [string, string][]) {
  check(`"${full}" abbreviates to ${short}`, partyAbbreviation(full) === short, String(partyAbbreviation(full)))
}
check(
  'the state unit suffix is stripped from a party name',
  tidyParty('Bharatiya Janata Party, Telangana') === 'Bharatiya Janata Party',
  String(tidyParty('Bharatiya Janata Party, Telangana')),
)
check(
  'an unknown party is left alone rather than mangled',
  partyAbbreviation('Some Local Front') === null,
  String(partyAbbreviation('Some Local Front')),
)

/* ── the summary sentence ────────────────────────────────────────────────── */

check(
  'the summary names the place, not just a count',
  describePlan(aruna).includes('Mahabubnagar') && describePlan(aruna).includes('Telangana'),
  describePlan(aruna),
)

/* ── a state with no local papers on file must not pretend ───────────────── */

const goa = planDesk(person({ state: 'Goa', district: 'Panaji', constituency: 'Panaji' }))
check(
  'a thin state either finds portals or says it has none',
  goa.portals.length > 0 || goa.notes.some((n) => n.includes('on file')),
  `${goa.portals.length} portals, notes=${JSON.stringify(goa.notes)}`,
)

/* ── the whole chain, end to end ─────────────────────────────────────────── */
/*
   The plan promised two district editions and the scanner never fetched them.

   `applyDeskPlan` wrote the seat into `profile.constituency`, the grievance
   screen passed that as the scan's city, and `indexUrlFor` — handed "Gadwal"
   where it wanted "Mahabubnagar" — found no district route and returned the
   state page. Every layer behaved as written. The desk read the whole of
   Telangana, found nothing about one assembly segment, and reported calm.

   So this asserts the value the scanner actually receives, not the value the
   plan computed. They were different for three layers and nothing said so.
*/
const routed = resolvePlace({
  state: 'Telangana',
  district: 'Mahabubnagar',
  constituency: 'Gadwal',
})

check(
  'the scan is routed on the district, and the seat alone would lose it',
  (() => {
    const sakshi = PORTALS.find((p) => p.label === 'Sakshi')
    if (!sakshi) return false
    const viaSeat = indexUrlFor(sakshi, 'Gadwal', 'Telangana')
    const viaDistrict = indexUrlFor(sakshi, routed.district, 'Telangana')
    return !viaSeat.includes('mahabubnagar') && viaDistrict.includes('mahabubnagar')
  })(),
  'the seat and the district now resolve the same way, so this no longer proves anything',
)

check(
  'every planned portal label resolves to a real masthead',
  aruna.portals.every((p) => PORTALS.some((registry) => registry.label === p.label)),
  aruna.portals
    .filter((p) => !PORTALS.some((r) => r.label === p.label))
    .map((p) => p.label)
    .join(', '),
)

check(
  'a planned district URL is reproducible from the label the scanner is given',
  aruna.portals
    .filter((p) => p.reach === 'district')
    .every((planned) => {
      const registry = PORTALS.find((r) => r.label === planned.label)
      return registry ? indexUrlFor(registry, routed.district, 'Telangana') === planned.indexUrl : false
    }),
  'the plan showed a URL the scanner would not fetch',
)

/* ── report ──────────────────────────────────────────────────────────────── */

const bold = (s: string): string => `[1m${s}[0m`
const green = (s: string): string => `[32m${s}[0m`
const red = (s: string): string => `[31m${s}[0m`

console.log(`\n${bold('Desk auto-configuration')}\n`)
for (const r of results) {
  console.log(
    `  ${r.ok ? green('PASS') : red('FAIL')}  ${r.label}${r.ok || !r.detail ? '' : `\n        got: ${r.detail}`}`,
  )
}
console.log(`\n${results.length - failures} passed, ${failures} failed`)

if (failures > 0) {
  console.log(red(bold('\nFAIL — a desk would be configured for the wrong place, or for nothing.')))
  process.exit(1)
}
console.log(green(bold('\nPASS — the desk configures itself, and admits what it could not do')))
