import { REGIONS, citiesOf, stateOfCity, ALL_STATES } from './regions'

/**
 * Turning a place name somebody wrote into a place this app knows.
 *
 * This exists because of one measured failure. Resolving D. K. Aruna returned a
 * district of "Mahaboobnagar" and a constituency of "Gadwal". The portal
 * registry spells them "Mahabubnagar" and "Jogulamba Gadwal", so neither
 * matched — and `indexUrlFor` does not throw on a district it cannot place, it
 * quietly returns the masthead's state-wide index instead. The desk would have
 * scanned the whole of Telangana looking for stories about one assembly
 * segment, found close to nothing, and reported a quiet week.
 *
 * That is the worst shape a bug can take here: it fails by producing silence,
 * and silence is indistinguishable from good news. An office would trust it.
 *
 * Place names in Indian public life have no single spelling. The same district
 * is Mahabubnagar, Mahboobnagar, Mehboobnagar and Mahbubnagar depending on who
 * is writing; districts get renamed and split; and a constituency frequently
 * shares a name with the district it sits in, or is a sub-name of it. So this
 * matches in four passes, widest confidence first, and reports which pass hit
 * rather than presenting a guess as a fact.
 */

export type PlaceConfidence = 'exact' | 'alias' | 'contains' | 'fuzzy'

export interface PlaceMatch {
  /** The registry's spelling — the one every other function expects. */
  canonical: string
  /** What was actually written. */
  given: string
  confidence: PlaceConfidence
  /** Other registry entries that also matched, best first. */
  alternatives: string[]
}

/**
 * Fold a name to something comparable.
 *
 * The vowel collapses are the substance. Indian place names transliterated from
 * Telugu, Urdu or Hindi vary almost entirely in their vowels — "oo" against
 * "u", "ee" against "i", a doubled consonant against a single one — while the
 * consonant skeleton stays put. Folding those away turns Mahaboobnagar,
 * Mehboobnagar and Mahbubnagar into one string.
 */
export function foldPlace(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      // Strip diacritics, then anything that is not a letter or digit.
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '')
      // Long vowels written two ways.
      .replace(/oo/g, 'u')
      .replace(/ee/g, 'i')
      .replace(/aa/g, 'a')
      // "e" and "a" are interchangeable in the first syllable of many of these
      // (Mehboob / Mahboob), so both collapse to "a".
      .replace(/^meh/, 'mah')
      .replace(/^mih/, 'mah')
      // Aspirated consonants are written with or without the h.
      .replace(/bh/g, 'b')
      .replace(/dh/g, 'd')
      .replace(/gh/g, 'g')
      .replace(/kh/g, 'k')
      .replace(/ph/g, 'f')
      .replace(/th/g, 't')
      // Doubled consonants carry no information here.
      .replace(/([bcdfgjklmnpqrstvwxyz])\1+/g, '$1')
  )
}

/**
 * Names the registry does not carry, mapped to the ones it does.
 *
 * Deliberately short and deliberately hand-written. This is not an attempt to
 * be the gazetteer of India — it is the set of cases where folding alone is not
 * enough, which is mostly renamings and the district-versus-constituency
 * mismatch. Anything not here still gets three more passes.
 */
const ALIASES: Record<string, string> = {
  // Constituency or town -> the district the registry lists.
  gadwal: 'Jogulamba Gadwal',
  alampur: 'Jogulamba Gadwal',
  wanaparthi: 'Wanaparthy',
  achampet: 'Nagarkurnool',
  kollapur: 'Nagarkurnool',
  devarkadra: 'Mahabubnagar',
  jadcherla: 'Mahabubnagar',
  makthal: 'Narayanpet',
  // Renamed or commonly written otherwise.
  hyderabadcity: 'Hyderabad',
  secunderabad: 'Hyderabad',
  cyberabad: 'Rangareddy',
  ranga: 'Rangareddy',
  rrdistrict: 'Rangareddy',
  warangalurban: 'Hanamkonda',
  warangalrural: 'Warangal',
  bhupalpally: 'Jayashankar Bhupalpally',
  asifabad: 'Komaram Bheem Asifabad',
  kothagudem: 'Bhadradri Kothagudem',
  bhuvanagiri: 'Yadadri Bhuvanagiri',
  yadadri: 'Yadadri Bhuvanagiri',
  sircilla: 'Rajanna Sircilla',
  // Andhra Pradesh.
  vizag: 'Visakhapatnam',
  vishakhapatnam: 'Visakhapatnam',
  vijayawada: 'NTR',
  amaravati: 'Guntur',
  rajahmundry: 'East Godavari',
  kadapa: 'YSR Kadapa',
  cuddapah: 'YSR Kadapa',
  ananthapur: 'Anantapur',
  anantapuramu: 'Anantapur',
  puttaparthi: 'Sri Sathya Sai',
  manyam: 'Parvathipuram Manyam',
  bhimavaram: 'West Godavari',
  // Elsewhere.
  bangalore: 'Bengaluru',
  mysore: 'Mysuru',
  bombay: 'Mumbai',
  calcutta: 'Kolkata',
  madras: 'Chennai',
  trivandrum: 'Thiruvananthapuram',
  cochin: 'Kochi',
  calicut: 'Kozhikode',
  pondicherry: 'Puducherry',
  gurgaon: 'Gurugram',
  allahabad: 'Prayagraj',
  benares: 'Varanasi',
  banaras: 'Varanasi',
}

/**
 * The alias table, keyed the way a lookup will actually arrive.
 *
 * The literal above is written in ordinary spelling so it can be read and
 * edited; every key is folded here, once, because a lookup only ever has a
 * folded string to offer. Keying the literal directly made half the table
 * unreachable — "Cuddapah" folds to "cudapah" when its doubled d collapses,
 * and nothing was ever going to ask for "cuddapah".
 */
const FOLDED_ALIASES: Map<string, string> = new Map(
  Object.entries(ALIASES).map(([k, v]) => [foldPlace(k), v]),
)

/**
 * The consonant skeleton.
 *
 * Transliterated Indian place names disagree about vowels far more than the
 * vowel-collapsing rules in `foldPlace` can cover: "Mahabubnagar" and
 * "Mahbubnagar" differ by a schwa that is simply written or not written, and no
 * substitution rule catches that without also destroying real distinctions.
 * Dropping vowels entirely does: both become "mhbbngr", while "Mahabubabad"
 * becomes "mhbbbd" and stays separate.
 *
 * Only used as its own matching pass, never as the primary key, because it is
 * genuinely lossy — which is why short skeletons are refused below.
 */
function skeleton(name: string): string {
  return foldPlace(name).replace(/[aeiou]/g, '')
}

/** Levenshtein, bounded — we only care whether it is within a small budget. */
function editDistance(a: string, b: string, budget: number): number {
  if (Math.abs(a.length - b.length) > budget) return budget + 1

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      )
      row[j] = value
      if (value < best) best = value
    }
    // Nothing on this row is within budget, so nothing below it can be either.
    if (best > budget) return budget + 1
    prev = row
  }
  return prev[b.length] ?? budget + 1
}

/**
 * Find the registry's spelling of a place.
 *
 * `pool` is the list to match against — the districts of one state, or every
 * state name. Returns null rather than a poor guess: a wrong district silently
 * points the whole news scan at the wrong part of the state, so "we could not
 * place this" is a far better answer than "probably this one".
 */
export function matchPlace(given: string, pool: string[]): PlaceMatch | null {
  const raw = given.trim()
  if (!raw) return null

  const folded = foldPlace(raw)
  if (!folded) return null

  const byFold = new Map<string, string>()
  for (const entry of pool) byFold.set(foldPlace(entry), entry)

  /* 1. exact, after folding */
  const exact = byFold.get(folded)
  if (exact) {
    return { canonical: exact, given: raw, confidence: 'exact', alternatives: [] }
  }

  /* 2. the hand-written alias table */
  const alias = FOLDED_ALIASES.get(folded)
  if (alias && pool.includes(alias)) {
    return { canonical: alias, given: raw, confidence: 'alias', alternatives: [] }
  }

  /* 3. the consonant skeleton — catches a written-or-not-written vowel */
  const ownSkeleton = skeleton(raw)
  // Under five consonants the skeleton stops being distinctive: "Medak" and
  // "Medchal" are different districts and both start "mdc".
  if (ownSkeleton.length >= 5) {
    const skeletal = pool.filter((entry) => skeleton(entry) === ownSkeleton)
    if (skeletal.length > 0) {
      return {
        canonical: skeletal[0]!,
        given: raw,
        confidence: 'alias',
        alternatives: skeletal.slice(1, 4),
      }
    }
  }

  /* 4. one name contained in the other — "Gadwal" inside "Jogulamba Gadwal" */
  const contains = pool.filter((entry) => {
    const entryFold = foldPlace(entry)
    return (
      // Guard against absurd substring hits: "Medak" is inside nothing useful,
      // but a three-letter fragment would match half the list.
      folded.length >= 4 &&
      (entryFold.includes(folded) || (entryFold.length >= 4 && folded.includes(entryFold)))
    )
  })
  if (contains.length > 0) {
    // Shortest first: the closest in length is the likeliest intended.
    contains.sort((a, b) => Math.abs(a.length - folded.length) - Math.abs(b.length - folded.length))
    return {
      canonical: contains[0]!,
      given: raw,
      confidence: 'contains',
      alternatives: contains.slice(1, 4),
    }
  }

  /* 5. a small number of typos */
  const budget = folded.length <= 6 ? 1 : 2
  const scored = pool
    .map((entry) => ({ entry, d: editDistance(folded, foldPlace(entry), budget) }))
    .filter((x) => x.d <= budget)
    .sort((a, b) => a.d - b.d)

  if (scored.length > 0) {
    return {
      canonical: scored[0]!.entry,
      given: raw,
      confidence: 'fuzzy',
      alternatives: scored.slice(1, 4).map((x) => x.entry),
    }
  }

  return null
}

export interface ResolvedPlace {
  state: string | null
  stateMatch: PlaceMatch | null
  /** The registry district whose edition the scan should read. */
  district: string | null
  districtMatch: PlaceMatch | null
  /** Anything the office should be told, in plain words. */
  notes: string[]
}

/**
 * Work out which state and district a desk sits in.
 *
 * Takes the constituency as well as the district because for an assembly seat
 * they are often different words for overlapping ground, and either may be the
 * one the registry carries. The district is tried first because that is what
 * the mastheads publish editions for; the constituency is the fallback, and it
 * is how "Gadwal" finds "Jogulamba Gadwal".
 *
 * When no state is given, every state's district list is searched. That is
 * slower and much less certain, so it is reported as such — an unqualified
 * "Nizamabad" is a real district in Telangana and also a town elsewhere.
 */
export function resolvePlace(input: {
  state?: string | null
  district?: string | null
  constituency?: string | null
}): ResolvedPlace {
  const notes: string[] = []

  /* ── the state ───────────────────────────────────────────────────────── */

  let stateMatch: PlaceMatch | null = null
  if (input.state) {
    stateMatch = matchPlace(input.state, ALL_STATES)
    if (!stateMatch) {
      notes.push(
        `"${input.state}" is not a state this app carries a masthead list for, so the news scan will fall back to national papers.`,
      )
    } else if (stateMatch.canonical !== stateMatch.given) {
      notes.push(`Read "${input.state}" as ${stateMatch.canonical}.`)
    }
  }

  /* ── the district ────────────────────────────────────────────────────── */

  const pool = stateMatch ? citiesOf(stateMatch.canonical) : []
  let districtMatch: PlaceMatch | null = null

  const tryAgainst = (value: string | null | undefined): PlaceMatch | null =>
    value ? matchPlace(value, pool) : null

  if (pool.length > 0) {
    districtMatch = tryAgainst(input.district) ?? tryAgainst(input.constituency)
  }

  // No state, or the state has no district roll: search every state's list, and
  // only accept a confident hit. A fuzzy match across all of India is a coin
  // toss dressed as a lookup.
  if (!districtMatch && !stateMatch) {
    for (const candidate of [input.district, input.constituency]) {
      if (!candidate) continue
      for (const region of REGIONS) {
        const hit = matchPlace(candidate, region.cities)
        if (hit && (hit.confidence === 'exact' || hit.confidence === 'alias')) {
          districtMatch = hit
          stateMatch = {
            canonical: region.state,
            given: '(derived)',
            confidence: hit.confidence,
            alternatives: [],
          }
          notes.push(
            `No state was given, so it was taken from the district: ${hit.canonical} is in ${region.state}.`,
          )
          break
        }
      }
      if (districtMatch) break
    }
  }

  if (districtMatch) {
    // Not `confidence !== 'exact'`: folding routinely produces an *exact* match
    // for a differently-spelled input, and that is precisely the case the
    // office most needs told about.
    if (districtMatch.canonical !== districtMatch.given) {
      notes.push(
        `Read "${districtMatch.given}" as the ${districtMatch.canonical} district${
          districtMatch.alternatives.length
            ? ` — it could also be ${districtMatch.alternatives.join(' or ')}`
            : ''
        }.`,
      )
    }
  } else if (input.district || input.constituency) {
    notes.push(
      `Could not place "${input.district ?? input.constituency}" in this app's district list, so the scan will read the state edition rather than the district one. It will still find stories, just more of them.`,
    )
  }

  const state = stateMatch?.canonical ?? null
  return {
    state,
    stateMatch,
    district: districtMatch?.canonical ?? null,
    districtMatch,
    notes,
  }
}

/** Every spelling of a place worth searching a headline for. */
export function placeVariants(match: PlaceMatch | null, given?: string | null): string[] {
  const out = new Set<string>()
  if (match) {
    out.add(match.canonical)
    if (match.given && match.given !== '(derived)') out.add(match.given)
    // "Jogulamba Gadwal" is never how a headline writes it; the distinctive
    // word is. Multi-word district names contribute their longest token.
    const parts = match.canonical.split(/\s+/).filter((p) => p.length > 4)
    if (parts.length > 1) for (const part of parts) out.add(part)
  }
  if (given) out.add(given)
  return [...out].filter((t) => t.trim().length > 2)
}

export { stateOfCity }
