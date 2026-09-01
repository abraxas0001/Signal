/**
 * `ownedBySubject`: a desk counts only the accounts of the person it is for.
 *
 * The case that shipped: a desk set up for D. K. Aruna held Rahul Gandhi's
 * Instagram, still flagged `own` from whenever it was added, and the dashboard
 * summed his 1.6 crore into her totals.
 */
import { ownedBySubject, type TrackedHandle } from '../src/lib/handles'
import type { Identity } from '../shared/identity'
import type { Platform } from '../shared/taxonomy'

let pass = 0
let fail = 0
const check = (name: string, got: unknown, want: unknown): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}`)
  if (!ok) console.log(`        got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`)
  ok ? (pass += 1) : (fail += 1)
}

const h = (platform: Platform, handle: string, own: boolean): TrackedHandle => ({
  id: `${platform}:${handle}`,
  platform,
  handle,
  displayName: handle,
  profileUrl: '',
  avatarUrl: null,
  own,
  label: null,
  listingNote: '',
  snapshots: [],
})

const identity = (handles: { platform: string; url: string }[]): Identity =>
  ({
    name: 'D. K. Aruna',
    aliases: [],
    photoUrl: null,
    role: null,
    party: null,
    constituency: null,
    district: null,
    state: null,
    age: null,
    dateOfBirth: null,
    education: null,
    inOfficeSince: null,
    bio: null,
    handles: handles.map((x) => ({ ...x, handle: '', verified: false, followers: null, connected: false })),
    watchTerms: [],
    confidence: {},
    origin: {},
    sources: [],
    notes: [],
    resolvedAt: '',
  }) as unknown as Identity

const aruna = identity([
  { platform: 'Instagram', url: 'https://www.instagram.com/dkarunaofficial' },
  { platform: 'Twitter/X', url: 'https://x.com/DKAruna1' },
])

const desk = [
  h('Instagram', 'dkarunaofficial', true),
  h('Twitter/X', 'DKAruna1', true),
  h('Instagram', 'rahulgandhi', true), // the impostor: own, but not hers
  h('Facebook', 'dkarunapage', true), // no record on Facebook -> trusted
  h('Instagram', 'revanth_anumula', false), // a rival, correctly not own
]

check(
  "another politician's account is not counted as the desk's",
  ownedBySubject(desk, aruna).map((x) => x.handle),
  ['dkarunaofficial', 'DKAruna1', 'dkarunapage'],
)

check(
  'a platform the record says nothing about keeps trusting the flag',
  ownedBySubject([h('Facebook', 'anything', true)], aruna).map((x) => x.handle),
  ['anything'],
)

check(
  'no identity at all: the flag stands, exactly as before',
  ownedBySubject(desk, null).map((x) => x.handle),
  ['dkarunaofficial', 'DKAruna1', 'rahulgandhi', 'dkarunapage'],
)

check(
  'an identity that lists no accounts changes nothing',
  ownedBySubject(desk, identity([])).map((x) => x.handle),
  ['dkarunaofficial', 'DKAruna1', 'rahulgandhi', 'dkarunapage'],
)

check(
  'the @ prefix and case do not decide who you are',
  ownedBySubject([h('Instagram', '@DKArunaOfficial', true)], aruna).map((x) => x.handle),
  ['@DKArunaOfficial'],
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
