/**
 * Who this desk belongs to.
 *
 * The product opened on an empty box that asked for a link to a post. That is
 * the right first screen for a tool somebody already understands and the wrong
 * one for a member's office opening it for the first time: they do not have a
 * link, they have a name and a constituency, and what they want to know is
 * what is being said about them today.
 *
 * So the first thing the app now asks for is who you are, and everything below
 * describes what it managed to find out. Two rules shape the shape:
 *
 * The first is that a field the app inferred and a field the office typed must
 * never look the same. Every value carries where it came from and how sure the
 * reading was, because an identity card that states the wrong party with the
 * same confidence as the right name is worse than one that states nothing.
 *
 * The second is that nothing here is load-bearing for correctness elsewhere. A
 * missing constituency degrades the news scan to a wider net; it does not break
 * it. Offices will open this app before the internet has caught up with a
 * by-election, and the app has to be useful that morning.
 */

import { stateCorroborated } from './places'

/** How much weight a reader should put on one field. */
export type Confidence = 'high' | 'medium' | 'low'

/**
 * Where a value came from.
 *
 * `stated` outranks everything: the office typed it, so it is not a reading at
 * all and carries no doubt. The rest are readings, in descending order of how
 * directly the value appeared.
 */
export type IdentityOrigin = 'stated' | 'profile-page' | 'oauth' | 'model'

export interface IdentitySource {
  /** The page this was read from, when there was one. */
  url: string | null
  /** Publisher or platform, for display: "Wikipedia", "X", "The Hindu". */
  label: string
}

/**
 * The social accounts this person is on.
 *
 * `verified` means the platform said so on the page we read, not that we
 * checked anything ourselves — the distinction matters, because an office
 * whose impersonator is the problem is exactly who is reading this.
 */
export interface SocialHandle {
  platform: string
  handle: string
  url: string
  verified: boolean
  followers: number | null
  /** True when the office connected it through OAuth rather than pasting it. */
  connected: boolean
}

export interface Identity {
  /** How the name should be written on screen. */
  name: string
  /**
   * Other spellings and the native-script form. These are what the news scan
   * actually searches on, so a Telugu masthead's rendering of the name is not
   * an ornament here — without it the scan finds nothing.
   */
  aliases: string[]
  photoUrl: string | null
  /** "MLA", "MP", "Minister for Roads", "Mayor". Free text: titles vary. */
  role: string | null
  party: string | null
  /** The assembly or parliamentary seat. */
  constituency: string | null
  district: string | null
  state: string | null
  age: number | null
  /** ISO date when a full one is known; a bare year is stored as YYYY. */
  dateOfBirth: string | null
  education: string | null
  /** When they took the current office, as text: "2019", "May 2024". */
  inOfficeSince: string | null
  /** Two or three sentences a stranger could read to know who this is. */
  bio: string | null
  handles: SocialHandle[]
  /**
   * Words that mean "this is about us" in somebody else's headline. Seeded
   * from the name, constituency and party, and editable by the office.
   */
  watchTerms: string[]
  /** Per-field, keyed by the field names above. Absent means unknown. */
  confidence: Partial<Record<IdentityField, Confidence>>
  origin: Partial<Record<IdentityField, IdentityOrigin>>
  sources: IdentitySource[]
  /** Anything the reader has to be told, in plain words. Shown, not logged. */
  notes: string[]
  /** When this was last resolved. */
  resolvedAt: string
}

/**
 * The fields that carry provenance.
 *
 * Named as a union rather than `keyof Identity` so that `confidence` and
 * `origin` cannot themselves be given a confidence, which is the kind of
 * recursive nonsense a plain keyof invites.
 */
export type IdentityField =
  | 'name'
  | 'photoUrl'
  | 'role'
  | 'party'
  | 'constituency'
  | 'district'
  | 'state'
  | 'age'
  | 'dateOfBirth'
  | 'education'
  | 'inOfficeSince'
  | 'bio'
  | 'aliases'
  | 'handles'

/** What the office sends to have an identity resolved. */
export interface IdentityRequest {
  /** A public profile address: a social account, a Wikipedia page, a bio page. */
  url?: string
  /** Used when there is no URL, or to disambiguate one. */
  name?: string
  role?: string
  constituency?: string
  state?: string
}

export interface IdentityResponse {
  identity: Identity | null
  error?: string
  /** Milliseconds the resolve took, for the diagnostics drawer. */
  ms?: number
}

/**
 * An empty identity carrying only what the office typed.
 *
 * Used when enrichment fails or is skipped. The app must work with this: an
 * office that pastes nothing and types a name still gets a dashboard, it just
 * gets one that knows less.
 */
export function statedIdentity(input: {
  name: string
  role?: string | null
  party?: string | null
  constituency?: string | null
  state?: string | null
}): Identity {
  const origin: Identity['origin'] = { name: 'stated' }
  const confidence: Identity['confidence'] = { name: 'high' }
  for (const key of ['role', 'party', 'constituency', 'state'] as const) {
    if (input[key]) {
      origin[key] = 'stated'
      confidence[key] = 'high'
    }
  }

  return {
    name: input.name,
    aliases: [],
    photoUrl: null,
    role: input.role ?? null,
    party: input.party ?? null,
    constituency: input.constituency ?? null,
    district: null,
    state: input.state ?? null,
    age: null,
    dateOfBirth: null,
    education: null,
    inOfficeSince: null,
    bio: null,
    handles: [],
    watchTerms: watchTermsFor({
      name: input.name,
      constituency: input.constituency ?? null,
      party: input.party ?? null,
    }),
    confidence,
    origin,
    sources: [],
    notes: [],
    resolvedAt: new Date().toISOString(),
  }
}

/**
 * The words a news scan searches on.
 *
 * Surname alone is deliberately included: Telugu and Hindi mastheads routinely
 * carry only the surname in a headline, and a scan keyed on the full name
 * misses the story that matters. Two-character fragments are dropped — they
 * match everything and the desk drowns.
 */
export function watchTermsFor(input: {
  name: string
  constituency: string | null
  party: string | null
  aliases?: string[]
}): string[] {
  const terms = new Set<string>()
  const add = (t: string | null | undefined): void => {
    const trimmed = t?.trim()
    if (trimmed && trimmed.length > 2) terms.add(trimmed)
  }

  add(input.name)
  for (const alias of input.aliases ?? []) add(alias)
  add(input.constituency)
  add(input.party)

  const parts = input.name.trim().split(/\s+/).filter(Boolean)
  if (parts.length > 1) {
    // The surname, and the given-name-plus-surname pair for names carried with
    // an initial ("Y. S. Jagan" gives "Jagan" and "Y. Jagan").
    add(parts[parts.length - 1])
    if (parts.length > 2) add(`${parts[0]} ${parts[parts.length - 1]}`)
  }

  return [...terms]
}

/**
 * Whether there is enough here to be worth showing as an identity card.
 *
 * A name on its own is not: that is what the office typed, and echoing it back
 * inside a card framed as "here is what we found" is the app taking credit for
 * knowing nothing.
 */
export function isEnriched(identity: Identity | null): boolean {
  if (!identity) return false
  return Boolean(
    identity.photoUrl ||
      identity.party ||
      identity.constituency ||
      identity.bio ||
      identity.handles.length > 0,
  )
}

/**
 * Fields worth a second look, in the order the card shows them.
 *
 * Deliberately only the fields the news scan is keyed on. It used to include
 * age, education and "in office since", which produced the sentence "We are not
 * confident about your in office since" on the dashboard — ungrammatical, and
 * worse, untrue about why it mattered: none of those three change what gets
 * searched. Prompting somebody to verify a date that affects nothing teaches
 * them to dismiss the prompt that appears when their constituency is wrong.
 */
export function unverifiedFields(identity: Identity): string[] {
  const labels: Partial<Record<IdentityField, string>> = {
    name: 'name',
    role: 'role',
    party: 'party',
    constituency: 'constituency',
    district: 'district',
    state: 'state',
  }

  /**
   * A value the region registry corroborates is not worth a second look, even
   * if the reading that produced it was unsure.
   *
   * Checked here rather than only at resolve time because confidence is
   * STORED. A desk set up before the resolver learned to corroborate keeps its
   * saved `low` for ever — nothing re-resolves an identity once it is on the
   * device — so an MP for Mahabubnagar was told her state could not be
   * confirmed every morning, by an app that could confirm it from its own
   * tables in a millisecond.
   *
   * `stateCorroborated` is a genuine cross-check, not a spell-check: the
   * district or seat has to map back to the same state. A stored "Kerala"
   * against a Mahabubnagar seat stays flagged, which is the whole point of
   * the prompt.
   */
  const corroborated = stateCorroborated(identity.state, identity.district, identity.constituency)

  return (Object.keys(labels) as IdentityField[])
    .filter((key) => {
      const value = (identity as unknown as Record<string, unknown>)[key]
      if (value == null || identity.confidence[key] !== 'low') return false
      if ((key === 'state' || key === 'district') && corroborated) return false
      return true
    })
    .map((key) => labels[key]!)
}

/**
 * The party as a desk would name it, and its abbreviation.
 *
 * Wikidata records the state unit — "Bharatiya Janata Party, Telangana" —
 * because that is a distinct organisation. As a search term it is close to
 * useless: no headline has ever printed it. The papers print "BJP".
 *
 * The abbreviation matters more than the tidy name. A week of Telugu coverage
 * will carry "BJP" a hundred times and the full name once, so a scan keyed only
 * on the full name reads as a quiet week on the busiest possible day.
 */
const PARTY_ABBREVIATIONS: [RegExp, string][] = [
  [/bharatiya janata/i, 'BJP'],
  [/indian national congress|^congress/i, 'Congress'],
  [/telangana rashtra samithi|bharat rashtra samithi/i, 'BRS'],
  [/yuvajana sramika rythu congress|ysr congress/i, 'YSRCP'],
  [/telugu desam/i, 'TDP'],
  [/all india majlis-e-ittehadul muslimeen/i, 'AIMIM'],
  [/communist party of india \(marxist\)/i, 'CPI(M)'],
  [/communist party of india/i, 'CPI'],
  [/aam aadmi party/i, 'AAP'],
  [/dravida munnetra kazhagam/i, 'DMK'],
  [/all india anna dravida/i, 'AIADMK'],
  [/shiv sena/i, 'Shiv Sena'],
  [/nationalist congress party/i, 'NCP'],
  [/samajwadi party/i, 'SP'],
  [/bahujan samaj party/i, 'BSP'],
  [/rashtriya janata dal/i, 'RJD'],
  [/janata dal \(united\)/i, 'JD(U)'],
  [/trinamool congress/i, 'TMC'],
  [/biju janata dal/i, 'BJD'],
  [/jana sena/i, 'Jana Sena'],
]

/** Strip the state unit, so the name is the one people use. */
export function tidyParty(name: string | null): string | null {
  if (!name) return null
  return name.replace(/,\s*[A-Za-z ]+$/, '').trim() || name
}

/** The short form a headline would print, when there is a well-known one. */
export function partyAbbreviation(name: string | null): string | null {
  if (!name) return null
  for (const [pattern, short] of PARTY_ABBREVIATIONS) {
    if (pattern.test(name)) return short
  }
  return null
}
