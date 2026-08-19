import { fetchText } from './fetcher'
import type { SocialHandle } from '../../../shared/identity'
import { tidyParty, partyAbbreviation } from '../../../shared/identity'

/**
 * Structured facts about a public figure, from Wikidata.
 *
 * This exists because of a measured gap. Resolving D. K. Aruna by having a
 * model read her Wikipedia article produced a null date of birth, a null age,
 * and a role of "Vice President of Bharatiya Janata Party" — which is a post
 * she holds, but not the one an office runs a media desk for. The same person's
 * Wikidata item carries her date of birth as a typed date (1960-05-04), her
 * party as a linked entity, and her seat as a qualifier on the position she
 * holds: Gadwal Assembly constituency.
 *
 * The difference is not the model being poor. It is that prose states things
 * once, in passing, in whatever order the article was written, and a database
 * states them as fields. Asking a language model to be a database is the
 * expensive way to get a worse answer.
 *
 * So: where a person has a Wikidata item, these facts are read directly and
 * treated as authoritative over anything read from prose. They are still never
 * treated as authoritative over what the office typed — the office knows its
 * own seat, and Wikidata is routinely a term out of date after an election.
 *
 * WHAT THIS CANNOT DO: most sitting MLAs have no Wikidata item, and many that
 * do carry only a name and a party. A null return is the normal case, not a
 * failure, and every caller has to work without it.
 */

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php'
const TIMEOUT_MS = 8_000

/* ── the properties worth reading ────────────────────────────────────────── */

const P = {
  image: 'P18',
  placeOfBirth: 'P19',
  gender: 'P21',
  country: 'P27',
  positionHeld: 'P39',
  party: 'P102',
  occupation: 'P106',
  dateOfBirth: 'P569',
  dateOfDeath: 'P570',
  electoralDistrict: 'P768',
  startTime: 'P580',
  endTime: 'P582',
  website: 'P856',
  instagram: 'P2003',
  x: 'P2002',
  facebook: 'P2013',
  youtube: 'P2397',
  tiktok: 'P7085',
  telegram: 'P3789',
} as const

export interface HeldPosition {
  label: string
  /** The seat, when the item records one as a qualifier. */
  constituency: string | null
  start: string | null
  end: string | null
  /** Started and has not ended: the one an office is currently in. */
  current: boolean
}

export interface WikidataFacts {
  qid: string
  dateOfBirth: string | null
  /** Set when the item records a death. A desk must not be built for the dead. */
  dateOfDeath: string | null
  party: string | null
  positions: HeldPosition[]
  /** The seat from the position currently held, when there is one. */
  constituency: string | null
  /** The role from the position currently held. */
  role: string | null
  /**
   * The item lists offices but none of them is current, so it cannot say what
   * this person holds today. Almost always means an election has happened since
   * anybody last edited it.
   */
  hasOnlyFormer: boolean
  photoUrl: string | null
  website: string | null
  occupation: string | null
  placeOfBirth: string | null
  handles: SocialHandle[]
}

/* ── tiny helpers over the API's shapes ──────────────────────────────────── */

interface Snak {
  datavalue?: { value?: unknown; type?: string }
}

interface Claim {
  mainsnak?: Snak
  rank?: string
  qualifiers?: Record<string, Snak[]>
}

const itemId = (snak: Snak | undefined): string | null => {
  const value = snak?.datavalue?.value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'string' ? id : null
  }
  return null
}

const stringValue = (snak: Snak | undefined): string | null => {
  const value = snak?.datavalue?.value
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * A Wikidata time to an ISO date.
 *
 * Precision matters and is not decoration: 9 means only the year is known, 10
 * the month, 11 the day. Emitting "1960-01-01" for a year-precision value would
 * put a fabricated birthday on an identity card, so anything below day
 * precision is truncated to what is actually known.
 */
function timeValue(snak: Snak | undefined): string | null {
  const value = snak?.datavalue?.value
  if (!value || typeof value !== 'object') return null
  const { time, precision } = value as { time?: unknown; precision?: unknown }
  if (typeof time !== 'string') return null

  // "+1960-05-04T00:00:00Z" — the sign is an era marker, and BCE is not
  // something this app has any business rendering.
  const match = /^\+(\d{4})-(\d{2})-(\d{2})T/.exec(time)
  if (!match) return null

  const [, year, month, day] = match
  const p = typeof precision === 'number' ? precision : 11
  if (p >= 11) return `${year}-${month}-${day}`
  if (p === 10) return `${year}-${month}`
  if (p === 9) return year!
  return null
}

/** A Commons filename to an image the browser can load. */
function commonsUrl(filename: string | null): string | null {
  if (!filename) return null
  // Special:FilePath redirects to the real upload host and takes a width, which
  // keeps an 8MB press photograph off a phone on 4G.
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    filename,
  )}?width=400`
}

async function getJson(url: string): Promise<unknown | null> {
  const res = await fetchText(url, { timeout: TIMEOUT_MS }).catch(() => null)
  if (!res?.ok) return null
  try {
    return JSON.parse(res.body) as unknown
  } catch {
    return null
  }
}

/* ── the entry point ─────────────────────────────────────────────────────── */

/** The Wikidata item id behind an English Wikipedia article title. */
export async function qidForArticle(title: string): Promise<string | null> {
  const url =
    `${WIKIPEDIA_API}?action=query&format=json&formatversion=2` +
    `&titles=${encodeURIComponent(title)}&prop=pageprops&ppprop=wikibase_item`

  const parsed = (await getJson(url)) as
    | { query?: { pages?: { pageprops?: { wikibase_item?: unknown } }[] } }
    | null

  const qid = parsed?.query?.pages?.[0]?.pageprops?.wikibase_item
  return typeof qid === 'string' && /^Q\d+$/.test(qid) ? qid : null
}

/**
 * Read one person's structured facts.
 *
 * Two requests, never more: one for the claims, one to turn every referenced
 * entity id into a readable label in a single batch. Resolving labels one at a
 * time would be a dozen round trips for a card nobody is waiting on that long
 * for.
 */
export async function wikidataFacts(qid: string): Promise<WikidataFacts | null> {
  const claimsUrl = `${WIKIDATA_API}?action=wbgetentities&format=json&ids=${qid}&props=claims`
  const parsed = (await getJson(claimsUrl)) as
    | { entities?: Record<string, { claims?: Record<string, Claim[]> }> }
    | null

  const claims = parsed?.entities?.[qid]?.claims
  if (!claims) return null

  /* ── collect every entity id we will need a label for ──────────────────── */

  const needed = new Set<string>()
  const collect = (property: string): void => {
    for (const claim of claims[property] ?? []) {
      const id = itemId(claim.mainsnak)
      if (id) needed.add(id)
      for (const q of claim.qualifiers?.[P.electoralDistrict] ?? []) {
        const qId = itemId(q)
        if (qId) needed.add(qId)
      }
    }
  }
  collect(P.party)
  collect(P.positionHeld)
  collect(P.occupation)
  collect(P.placeOfBirth)

  const labels = await fetchLabels([...needed])
  const label = (id: string | null): string | null => (id ? (labels.get(id) ?? null) : null)

  /* ── positions, which is where the seat lives ──────────────────────────── */

  const positions: HeldPosition[] = []
  for (const claim of claims[P.positionHeld] ?? []) {
    // Deprecated statements are Wikidata's way of recording something that was
    // asserted and is now known to be wrong. Reading them back is worse than
    // reading nothing.
    if (claim.rank === 'deprecated') continue

    const name = label(itemId(claim.mainsnak))
    if (!name) continue

    const start = timeValue(claim.qualifiers?.[P.startTime]?.[0])
    const end = timeValue(claim.qualifiers?.[P.endTime]?.[0])

    positions.push({
      label: name,
      constituency: label(itemId(claim.qualifiers?.[P.electoralDistrict]?.[0])),
      start,
      end,
      // A term with a start and no end is the one being served now. A term with
      // neither is undated and cannot be ranked, so it is not treated as
      // current — guessing here is how an office gets set up for a seat they
      // lost two elections ago.
      current: start !== null && end === null,
    })
  }

  /*
    Best-evidenced first, not merely first.

    Four signals, in order. A term explicitly still running wins outright. Then
    a position that names a seat, because that is the one an office runs a media
    desk for and a bare "Member of Parliament" with no constituency is usually a
    stub statement. Then a recorded start date, most recent first. Position in
    the source list is the last resort and is not meaningful — Wikidata is not
    ordered.
  */
  const score = (p: HeldPosition): number =>
    (p.current ? 1000 : 0) + (p.constituency ? 100 : 0) + (p.start ? 10 : 0)

  positions.sort(
    (a, b) => score(b) - score(a) || (b.start ?? '').localeCompare(a.start ?? ''),
  )

  /*
    Only a position that is demonstrably current. No fallback.

    The fallback used to be `positions[0]`, and it produced the worst wrong
    answer this file has yet given: D. K. Aruna's item holds two assembly seats,
    both of which she left — Andhra Pradesh in 2014, Telangana in 2018 — neither
    carrying a date, and no Lok Sabha statement at all. Her article says plainly
    that she is now a Member of Parliament for Mahabubnagar. Taking the first
    statement told her own office she was an MLA for Gadwal: the right person,
    the wrong chamber, a seat she has not held for years, and a news scan keyed
    on it.

    An election changes this and Wikidata catches up months later, so "the item
    lists positions but cannot say which is current" is a normal state and must
    resolve to null rather than to a guess. The prose pass reads the article,
    where the present tense actually lives.
  */
  const currentPosition = positions.find((p) => p.current) ?? null

  // Positions the item records as finished. Their presence is what tells the
  // caller that a null `role` means "out of date", not "nothing known".
  const hasOnlyFormer = positions.length > 0 && currentPosition === null

  /* ── social accounts, built from typed identifiers ─────────────────────── */

  const handles: SocialHandle[] = []
  const addHandle = (
    property: string,
    platform: string,
    toUrl: (id: string) => string,
  ): void => {
    for (const claim of claims[property] ?? []) {
      if (claim.rank === 'deprecated') continue
      const id = stringValue(claim.mainsnak)
      if (!id) continue
      handles.push({
        platform,
        handle: id,
        url: toUrl(id),
        // Wikidata records the account; it does not record a platform's
        // verification badge, and claiming otherwise on a product whose users
        // are impersonated would be its own kind of lie.
        verified: false,
        followers: null,
        connected: false,
      })
      // One per platform. A person with three recorded X accounts has a
      // disambiguation problem this file cannot solve.
      break
    }
  }

  addHandle(P.x, 'X', (id) => `https://x.com/${id}`)
  addHandle(P.facebook, 'Facebook', (id) => `https://www.facebook.com/${id}`)
  addHandle(P.instagram, 'Instagram', (id) => `https://www.instagram.com/${id}`)
  addHandle(P.youtube, 'YouTube', (id) => `https://www.youtube.com/channel/${id}`)
  addHandle(P.tiktok, 'TikTok', (id) => `https://www.tiktok.com/@${id}`)
  addHandle(P.telegram, 'Telegram', (id) => `https://t.me/${id}`)

  return {
    qid,
    dateOfBirth: timeValue(claims[P.dateOfBirth]?.[0]?.mainsnak),
    dateOfDeath: timeValue(claims[P.dateOfDeath]?.[0]?.mainsnak),
    party: label(itemId(claims[P.party]?.[0]?.mainsnak)),
    positions,
    // Both taken from the SAME position, never one from each. Mixing them
    // produces a card reading "MLA for Gadwal" built from a defunct Andhra
    // Pradesh seat and a current Telangana one, which is a sentence no source
    // actually asserts.
    constituency: currentPosition?.constituency ?? null,
    role: currentPosition?.label ?? null,
    hasOnlyFormer,
    photoUrl: commonsUrl(stringValue(claims[P.image]?.[0]?.mainsnak)),
    website: stringValue(claims[P.website]?.[0]?.mainsnak),
    occupation: label(itemId(claims[P.occupation]?.[0]?.mainsnak)),
    placeOfBirth: label(itemId(claims[P.placeOfBirth]?.[0]?.mainsnak)),
    handles,
  }
}

/** Turn entity ids into English labels, in one request. */
async function fetchLabels(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out

  // The API takes 50 ids per call, which is far more than one person needs.
  const batch = ids.slice(0, 50)
  const url =
    `${WIKIDATA_API}?action=wbgetentities&format=json` +
    `&ids=${batch.join('|')}&props=labels&languages=en`

  const parsed = (await getJson(url)) as
    | { entities?: Record<string, { labels?: { en?: { value?: unknown } } }> }
    | null

  for (const [id, entity] of Object.entries(parsed?.entities ?? {})) {
    const value = entity.labels?.en?.value
    if (typeof value === 'string' && value.trim()) out.set(id, value.trim())
  }
  return out
}

/**
 * Tidy a Wikidata seat name into what a headline would print.
 *
 * Wikidata records "Gadwal Assembly constituency" because it is describing the
 * constituency as an object. An office says "Gadwal", the papers print
 * "Gadwal", and the news scan searches for what the papers print.
 */
export function tidyConstituency(name: string | null): string | null {
  if (!name) return null
  return (
    name
      .replace(/\s+(Assembly|Parliamentary|Lok Sabha|Vidhan Sabha)\s+constituency$/i, '')
      .replace(/\s+constituency$/i, '')
      .trim() || null
  )
}

/**
 * Shorten a position title to the office an MLA would recognise.
 *
 * "Member of the Telangana Legislative Assembly" is correct and is not what
 * anybody calls it.
 */
export function tidyRole(name: string | null): string | null {
  if (!name) return null
  const rules: [RegExp, string][] = [
    [/^Member of the .*Legislative Assembly$/i, 'MLA'],
    [/^Member of the .*Legislative Council$/i, 'MLC'],
    [/^Member of the Lok Sabha$/i, 'MP (Lok Sabha)'],
    [/^Member of the Rajya Sabha$/i, 'MP (Rajya Sabha)'],
    [/^Member of Parliament.*$/i, 'MP'],
  ]
  for (const [pattern, short] of rules) {
    if (pattern.test(name)) return short
  }
  return name
}
