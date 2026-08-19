/**
 * Which stories count as being about this desk.
 *
 * Both bugs below were found by running the real scan for a real member and
 * reading what came back, not by reasoning about the code. Both produce a
 * confident wrong answer rather than an error, which is the only kind of bug
 * that matters here: the screen says "these stories are about you" and the
 * office believes it.
 *
 * Run: npm run test:matching
 */

import { matchTags, worthKeeping } from '../netlify/functions/lib/scan'

let failures = 0
const results: { ok: boolean; label: string; detail: string }[] = []
const check = (label: string, ok: boolean, detail = ''): void => {
  results.push({ ok, label, detail })
  if (!ok) failures += 1
}

/* ── the substring bug ───────────────────────────────────────────────────── */
/*
   An MP named Aruna was handed two stories about a rain ritual. The Telugu
   వరుణ (Varuna, the rain god) transliterates into a URL slug as "varuna",
   which contains "aruna", and the matcher was a plain `includes`.
*/

check(
  '"Aruna" does NOT match inside "varuna"',
  matchTags(
    'వరుణ యాగాన్ని ప్రారంభించిన మంత్రి ఉత్తమ్',
    'https://www.andhrajyothy.com/2026/telangana/varuna-yagam-started-1234',
    ['Aruna'],
  ).length === 0,
  'matched a rain ritual as coverage of the member',
)

check(
  '"Aruna" still matches her own name in a slug',
  matchTags(
    'D. K. Aruna meets farmers',
    'https://www.thehindu.com/news/dk-aruna-meets-farmers-99999',
    ['Aruna'],
  ).length === 1,
  'the boundary rule broke a real match',
)

for (const [tag, title, url] of [
  ['Modi', 'New rules on modification of land records', 'https://x.com/a/modification-of-records-1'],
  ['Rao', 'Uproar over the new bypass', 'https://x.com/a/uproar-over-bypass-2'],
  ['Gadwal', 'Gadwalpet residents protest', 'https://x.com/a/gadwalpet-residents-3'],
] as [string, string, string][]) {
  check(
    `"${tag}" does not match inside a longer word`,
    matchTags(title, url, [tag]).length === 0,
    `matched "${title}"`,
  )
}

check(
  'a multi-word tag still matches',
  matchTags('D. K. Aruna speaks', 'https://x.com/a/dk-aruna-speaks-4', ['D. K. Aruna']).length === 1,
  'multi-word matching broke',
)

check(
  'a place matches in the headline as well as the slug',
  matchTags('Water crisis in Mahabubnagar', 'https://x.com/a/story-5', ['Mahabubnagar']).length === 1,
  'headline matching broke',
)

/* ── the breadth bug ─────────────────────────────────────────────────────── */
/*
   Scanning eight Telangana mastheads for a Mahabubnagar MP returned 23 stories,
   every one matched only on "BJP": a Kolkata meeting, a Kejriwal quote, poll
   in-charges for Punjab. All real news, none of it hers.
*/

const broad = new Set(['BJP'])

check(
  'a story matching ONLY the party is dropped',
  !worthKeeping(['BJP'], broad, true),
  'the national wire is still being reported as coverage of the member',
)
check(
  'a story matching the party AND the state is kept',
  worthKeeping(['Telangana', 'BJP'], broad, true),
  'legitimate local party news was dropped',
)
check(
  'a story matching only a narrow term is kept',
  worthKeeping(['Mahabubnagar'], broad, true),
  'a plain local story was dropped',
)
check(
  'with no narrow words at all, the broad ones are honoured',
  worthKeeping(['BJP'], broad, false),
  'a desk that only supplied a party got nothing at all',
)
check(
  'nothing matched is never kept',
  !worthKeeping([], broad, true),
  'an unmatched story was kept',
)
check(
  'with no broad words declared, everything matched is kept',
  worthKeeping(['BJP'], new Set(), true),
  'filtering happened without a broad list',
)

/* ── report ──────────────────────────────────────────────────────────────── */

const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`
const green = (s: string): string => `\x1b[32m${s}\x1b[0m`
const red = (s: string): string => `\x1b[31m${s}\x1b[0m`

console.log(`\n${bold('Story matching')}\n`)
for (const r of results) {
  console.log(`  ${r.ok ? green('PASS') : red('FAIL')}  ${r.label}${r.ok || !r.detail ? '' : `\n        ${r.detail}`}`)
}
console.log(`\n${results.length - failures} passed, ${failures} failed`)
if (failures > 0) {
  console.log(red(bold('\nFAIL — stories would be reported as being about this desk when they are not.')))
  process.exit(1)
}
console.log(green(bold('\nPASS — only stories actually about this desk are kept')))
