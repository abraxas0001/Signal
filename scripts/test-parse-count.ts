/**
 * The count parser, against strings these platforms actually rendered.
 *
 *   npm run test:counts
 *
 * Every case below was copied from a real page during a real scrape, not
 * invented. That matters for the Indian-numbering ones especially: the reason
 * this file exists is that Facebook renders this desk's own page in Hindi, and
 * "2.8 लाख फ़ॉलोअर" — 280,000 followers — was being read as 3. Five orders of
 * magnitude, on a politician's follower count, with nothing downstream able to
 * notice. A unit test is cheap next to that.
 *
 * The refusal cases matter just as much as the conversions. "18 घंटे" is a
 * timestamp meaning eighteen hours, and a parser willing to guess would file it
 * as an engagement figure of 18.
 */

import { parseCount } from '../scraper/types'

const CASES: [string, number | null][] = [
  // Indian numbering, as Facebook renders it in Hindi.
  ['2.8 लाख फ़ॉलोअर', 280_000],
  ['1.2 करोड़', 12_000_000],
  ['45 हज़ार', 45_000],
  // Telugu, the other language this desk's audience posts in.
  ['3.4 లక్ష', 340_000],
  ['2 కోటి', 20_000_000],
  // Latin abbreviations, as X and Instagram render them.
  ['107.1M Followers', 107_100_000],
  ['88.8k followers', 88_800],
  ['5.2 lakh', 520_000],
  // Plain figures with an ASCII word beside them.
  ['12,134,770 followers', 12_134_770],
  ['1271 Likes. Like', 1_271],
  ['173 Replies. Reply', 173],
  ['1,541 reactions', 1_541],
  // Refusals. A number next to a unit we do not understand is not a number we
  // know, and null is the honest answer.
  ['18 घंटे', null], // "18 hours" — a timestamp, not a count
  ['లక్ష', null], // a unit with no figure at all
  ['', null],
]

let failed = 0
for (const [input, expected] of CASES) {
  const actual = parseCount(input)
  const ok = actual === expected
  if (!ok) failed++
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${JSON.stringify(input).padEnd(30)} -> ${String(actual).padEnd(12)}` +
      (ok ? '' : `expected ${expected}`),
  )
}

console.log('')
if (failed > 0) {
  console.log(`${failed} of ${CASES.length} failed`)
  process.exit(1)
}
console.log(`${CASES.length} cases pass`)
