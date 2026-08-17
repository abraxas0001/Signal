/**
 * Guard the dashboard's arithmetic and its handle parsing.
 *
 * The comparison is the part that can mislead silently. If engagement rate is
 * computed wrongly, or falls back to raw interactions when followers are
 * missing, the dashboard will confidently rank a 3-crore account above a local
 * MLA on a number that means the opposite — which is the exact mistake the rate
 * exists to prevent.
 */
import { parseHandle } from '../netlify/functions/lib/handles'
import { statsFor, deltaFor, type TrackedHandle, type HandleSnapshot } from '../src/lib/handles'

const g = (s: string) => `\x1b[32m${s}\x1b[0m`
const r = (s: string) => `\x1b[31m${s}\x1b[0m`
let pass = 0
let fail = 0
const chk = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ${g('✓')} ${label} ${detail}`) }
  else { fail++; console.log(`  ${r('✗')} ${label} ${detail}`) }
}

console.log('\n\x1b[1mHandle parsing\x1b[0m\n')
for (const [input, platform, handle] of [
  ['https://www.youtube.com/@JournalistYNR', 'YouTube', '@JournalistYNR'],
  ['https://youtube.com/channel/UCabcdefghijklmnopqrstu', 'YouTube', 'UCabcdefghijklmnopqrstu'],
  ['https://bsky.app/profile/bsky.app', 'Bluesky', 'bsky.app'],
  ['https://www.instagram.com/bjp4india/', 'Instagram', 'bjp4india'],
  ['https://www.facebook.com/BJP4India/', 'Facebook', 'BJP4India'],
  ['https://www.linkedin.com/in/narendramodi/', 'LinkedIn', 'narendramodi'],
  ['https://mastodon.social/@Gargron', 'Mastodon', '@Gargron@mastodon.social'],
] as const) {
  const p = parseHandle(input)
  chk(`${input.slice(8, 46)}`, p?.platform === platform && p?.handle === handle,
    `→ ${p?.platform}/${p?.handle}`)
}
chk('bare handle needs a platform hint', parseHandle('@someone') === null)
chk('bare handle with hint resolves', parseHandle('@someone', 'YouTube')?.handle === 'someone')
chk('nonsense is rejected', parseHandle('not a url') === null)

console.log('\n\x1b[1mEngagement arithmetic\x1b[0m\n')
const snap = (followers: number | null, posts: [number, number][]): HandleSnapshot => ({
  takenAt: new Date().toISOString(),
  followers,
  posts: posts.map(([likes, comments], i) => ({
    url: `u${i}`, title: null, publishedAt: null, views: null, likes, comments,
  })),
})

const big = statsFor(snap(34_552_460, Array.from({ length: 20 }, () => [4000, 460] as [number, number])))
const small = statsFor(snap(300_000, Array.from({ length: 15 }, () => [450, 26] as [number, number])))

chk('avg engagement is per post', big.avgEngagement === 4460, `got ${big.avgEngagement}`)
chk('rate is a share of followers', small.engagementRate === 0.159, `got ${small.engagementRate}`)
// The whole point of the metric.
chk('the smaller account wins on RATE despite far fewer raw interactions',
  (small.engagementRate ?? 0) > (big.engagementRate ?? 0),
  `${small.engagementRate}% vs ${big.engagementRate}%`)
chk('raw interactions would have said the opposite',
  (big.avgEngagement ?? 0) > (small.avgEngagement ?? 0))

chk('no followers means no rate, not a zero',
  statsFor(snap(null, [[10, 2]])).engagementRate === null)
chk('no posts means no invented averages',
  statsFor(snap(1000, [])).avgEngagement === null)
chk('a missing snapshot is handled', statsFor(undefined).posts === 0)

console.log('\n\x1b[1mTrend\x1b[0m\n')
const h = (snapshots: HandleSnapshot[]): TrackedHandle => ({
  id: 'x', platform: 'YouTube', handle: 'x', displayName: null, profileUrl: '',
  avatarUrl: null, own: true, label: null, listingNote: '', snapshots,
})
chk('one reading yields no trend', deltaFor(h([snap(100, [[1, 1]])])).followers === null)
const d = deltaFor(h([snap(100, [[1, 1]]), snap(150, [[1, 1]])]))
chk('two readings yield the difference', d.followers === 50, `got ${d.followers}`)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail > 0 ? 1 : 0)
