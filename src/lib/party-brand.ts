import { CHECKED_ON, PICTURES, type Picture } from '@/lib/picture-library'
import { isDemoScope, scopedKey } from '@/lib/store'
import { deskKey } from '@/lib/personas'

/**
 * What a desk's party looks like, and where the desk's own brand images live.
 *
 * WHY COLOURS ARE IN THE PRODUCT AND IMAGES ARE NOT. A party's colours are a
 * published fact about its identity: the saffron and green of a BJP flag are
 * printed on every hoarding in the country and nobody owns the pair of hex
 * values. A party's mark and a leader's photograph are the opposite. They are
 * somebody's rights, this product ships to more than one desk, and a lotus or a
 * portrait bundled into the bundle would travel to every desk that installs it,
 * including the desks it does not belong to. So the colours are a table here,
 * and every image is a SLOT the desk fills once from its own files. Nothing in
 * this module hardcodes a path to a person, and nothing in it draws a party's
 * symbol: a lotus approximated from memory is a wrong lotus, and a wrong party
 * symbol on a member's poster is worse than no symbol at all.
 *
 * WHY THIS IS NOT `partyColor` IN gazetteer.ts. That function answers a
 * different question with a different kind of answer: one hex for one dot on a
 * map, falling back to `var(--accent)` when the party is unknown. A poster needs
 * five colours that have been chosen against each other, and it needs every one
 * of them to be a literal, because a canvas `fillStyle` does not resolve CSS
 * custom properties and silently paints black when handed one. Which is why
 * every value below is a plain hex string, in the form poster.ts's `soft()`
 * parses by hand.
 *
 * WHERE THE VALUES COME FROM. Each `bg` is the colour the party is known by, at
 * the strength a full poster field can carry. Each `accent` is that same hue
 * darkened for the band, the rules and the foot: it is not a claim about a
 * second party colour, it is a shade of the first that white type can sit on.
 * `accent2` is a genuine second colour and is null wherever a party does not
 * plainly have one, because inventing a second colour for a party that has one
 * colour is the same mistake as drawing its symbol from memory.
 */

export interface PartyPalette {
  /** The field the poster sits on. */
  bg: string
  /** The band, the rules, the emphasis. */
  accent: string
  /** A second party colour where one exists, for a rule or a sweep. Null when it does not. */
  accent2: string | null
  /** Body text on the field. */
  ink: string
  /** Text on the accent band. */
  onAccent: string
}

export interface PartyBrand {
  /** As the identity records it, e.g. "Bharatiya Janata Party". */
  name: string
  /** The short form an office actually uses on a poster. */
  short: string
  palette: PartyPalette
  /**
   * The party's own name in Devanagari and in Telugu, or null where this file
   * cannot state one.
   *
   * Every reference poster an Indian office publishes carries the party's name
   * under its mark in the language of the card, and a Hindi greeting card with
   * "BJP" set in Latin under the lotus looks like a foreigner made it. These
   * are the forms the parties use of themselves, not transliterations invented
   * here, and where this file is not certain of one it holds null and the card
   * sets the Latin short form instead. A wrong rendering of a party's own name
   * on a poster going out under a member's signature is not a typo, it is an
   * insult, so an empty field is the better failure.
   *
   * Telugu is here beside Hindi because this desk is in Telangana and posts in
   * Telugu, and a product that only spoke Hindi to an Indian office would be
   * making an assumption about India that this one does not get to make.
   */
  names: { hi: string | null; te: string | null }
}

/** Every party this module knows the colours of. */
export const PARTIES: PartyBrand[] = [
  {
    name: 'Bharatiya Janata Party',
    short: 'BJP',
    /**
     * The pairing this whole table exists for, so it is the one worth being
     * exact about. The party flag is saffron with green, the same two colours
     * the national flag publishes as #ff9933 (deep saffron) and #138808 (India
     * green), and those two values are used here unchanged rather than a pair
     * eyeballed from a photograph of a hoarding. The accent is that saffron
     * burnt down until white type reads on it, which the field itself cannot
     * carry: white on #ff9933 measures about 2.1 to 1 and is unreadable at a
     * glance, so the ink on the field is near black and the white is kept for
     * the band.
     */
    palette: {
      bg: '#ff9933',
      accent: '#c2410c',
      accent2: '#138808',
      ink: '#1e1205',
      onAccent: '#ffffff',
    },
    names: { hi: 'भारतीय जनता पार्टी', te: 'భారతీయ జనతా పార్టీ' },
  },
  {
    name: 'Indian National Congress',
    short: 'INC',
    // The party's sky blue, deepened for the field: the light form it is drawn
    // in on a chart cannot carry white type, and dark type on sky blue reads as
    // a corporate slide rather than as a party poster.
    palette: { bg: '#1183c9', accent: '#0a4f80', accent2: null, ink: '#ffffff', onAccent: '#ffffff' },
    names: { hi: 'भारतीय राष्ट्रीय कांग्रेस', te: 'భారత జాతీయ కాంగ్రెస్' },
  },
  {
    name: 'Bharat Rashtra Samithi',
    short: 'BRS',
    // Pink, which the party kept through the rename from Telangana Rashtra
    // Samithi, so one entry serves a desk whichever name it recorded.
    palette: { bg: '#d6367a', accent: '#8a1e4e', accent2: null, ink: '#ffffff', onAccent: '#ffffff' },
    names: { hi: 'भारत राष्ट्र समिति', te: 'భారత రాష్ట్ర సమితి' },
  },
  {
    name: 'YSR Congress Party',
    short: 'YSRCP',
    palette: { bg: '#1c6fd6', accent: '#10457f', accent2: null, ink: '#ffffff', onAccent: '#ffffff' },
    names: { hi: null, te: 'వైఎస్సార్ కాంగ్రెస్ పార్టీ' },
  },
  {
    name: 'Telugu Desam Party',
    short: 'TDP',
    // Yellow takes near black ink for the same reason saffron does, and the
    // band is the yellow darkened rather than the red that turns up on some
    // party material, which is a poster choice and not a published colour.
    palette: { bg: '#f2c200', accent: '#8a6a00', accent2: null, ink: '#1e1a05', onAccent: '#ffffff' },
    names: { hi: null, te: 'తెలుగుదేశం పార్టీ' },
  },
  {
    name: 'Aam Aadmi Party',
    short: 'AAP',
    palette: { bg: '#1b62b5', accent: '#0d3d77', accent2: null, ink: '#ffffff', onAccent: '#ffffff' },
    names: { hi: 'आम आदमी पार्टी', te: 'ఆమ్ ఆద్మీ పార్టీ' },
  },
  {
    name: 'Dravida Munnetra Kazhagam',
    short: 'DMK',
    // Red and black, the two halves of the flag, so the black is a real second
    // colour here rather than a darkening of the first.
    palette: { bg: '#d31f26', accent: '#8e1218', accent2: '#141414', ink: '#ffffff', onAccent: '#ffffff' },
    names: { hi: null, te: null },
  },
  {
    name: 'All India Anna Dravida Munnetra Kazhagam',
    short: 'AIADMK',
    palette: { bg: '#c4161c', accent: '#7e0f14', accent2: '#141414', ink: '#ffffff', onAccent: '#ffffff' },
    names: { hi: null, te: null },
  },
  {
    name: 'Samajwadi Party',
    short: 'SP',
    // Red with green, which is the flag, and the green is what the foot rule
    // should take.
    palette: { bg: '#d22128', accent: '#8c1216', accent2: '#0f8a45', ink: '#ffffff', onAccent: '#ffffff' },
    names: { hi: 'समाजवादी पार्टी', te: null },
  },
  {
    name: 'All India Trinamool Congress',
    short: 'TMC',
    palette: { bg: '#12874a', accent: '#0a5a31', accent2: null, ink: '#ffffff', onAccent: '#ffffff' },
    names: { hi: null, te: null },
  },
  {
    name: 'Shiv Sena',
    short: 'Shiv Sena',
    // Saffron, and one entry for both factions on purpose: the split produced
    // two organisations with the same colour, and a desk on either side of it
    // wants the same poster.
    palette: { bg: '#f26722', accent: '#a83a08', accent2: null, ink: '#1e1004', onAccent: '#ffffff' },
    names: { hi: 'शिवसेना', te: null },
  },
  {
    name: 'Nationalist Congress Party',
    short: 'NCP',
    palette: { bg: '#0b5ca8', accent: '#063a6b', accent2: null, ink: '#ffffff', onAccent: '#ffffff' },
    names: { hi: null, te: null },
  },
  {
    name: 'Janata Dal (United)',
    short: 'JD(U)',
    palette: { bg: '#0e7a3f', accent: '#0a5227', accent2: null, ink: '#ffffff', onAccent: '#ffffff' },
    names: { hi: null, te: null },
  },
  {
    name: 'Rashtriya Janata Dal',
    short: 'RJD',
    // Green with yellow, as the flag has it.
    palette: { bg: '#0f8a3c', accent: '#0a5c28', accent2: '#f2c200', ink: '#ffffff', onAccent: '#ffffff' },
    names: { hi: 'राष्ट्रीय जनता दल', te: null },
  },
  {
    name: 'Communist Party of India (Marxist)',
    short: 'CPI(M)',
    // Red with the yellow the hammer, sickle and star are drawn in. The
    // unbracketed Communist Party of India is a different party and is
    // deliberately not folded in here, however similar the red.
    palette: { bg: '#c1272d', accent: '#7a1418', accent2: '#f2c200', ink: '#ffffff', onAccent: '#ffffff' },
    names: { hi: null, te: null },
  },
  {
    name: 'Jana Sena Party',
    short: 'Jana Sena',
    palette: { bg: '#ce1b23', accent: '#8a1016', accent2: '#141414', ink: '#ffffff', onAccent: '#ffffff' },
    names: { hi: null, te: 'జనసేన పార్టీ' },
  },
]

/**
 * The neutral brand, used when the desk's party is not recognised.
 *
 * The palette is the warm paper and restrained brown the festival template
 * already ships with, so a desk this module cannot place sees exactly what the
 * studio showed it before party colours existed, rather than a downgrade.
 *
 * It is named for what the palette is and not for an affiliation. Calling it
 * Independent would be the product asserting something about the member: an
 * unrecognised party string means this table is short a row, not that the
 * person sits as an independent, and a poster that labels them one is a claim
 * their office never made. It is also kept out of `PARTIES`, which is the list
 * of parties whose colours are known, and neutral is the absence of one.
 */
export const NEUTRAL: PartyBrand = {
  name: 'Neutral',
  short: 'Neutral',
  palette: { bg: '#fbf7f0', accent: '#8c6a3f', accent2: null, ink: '#16181d', onAccent: '#ffffff' },
  names: { hi: null, te: null },
}

const BY_SHORT = new Map(PARTIES.map((p) => [p.short, p]))

/**
 * How a written party is recognised, in the order the patterns are tried.
 *
 * Two orders, deliberately: `PARTIES` is ordered for a picker, and this is
 * ordered for matching, most specific first. The reason is the word Congress.
 * It sits inside YSR Congress Party, Nationalist Congress Party and All India
 * Trinamool Congress, so a generic `congress` tried first would light a
 * Vijayawada desk and a Kolkata desk alike in Congress sky blue. Anna Dravida
 * Munnetra Kazhagam contains Dravida Munnetra Kazhagam for the same reason and
 * has to be asked about first.
 *
 * Every pattern carries both the registered name and the abbreviation, because
 * a desk's party field is filled from whatever source found it: Wikidata
 * records "Bharatiya Janata Party, Telangana" and a headline prints "BJP", and
 * both have to arrive at the same saffron. The abbreviations are anchored on
 * word boundaries so a two letter form like SP cannot match inside a longer
 * word.
 */
const MATCHERS: [RegExp, string][] = [
  [/\baiadmk\b|all india anna dravida|anna dravida munnetra/i, 'AIADMK'],
  // All India N.R. Congress, and it is here purely to STOP a match. Puducherry's
  // governing party contains the word Congress, so without this line a
  // Puducherry desk was lit in Congress sky blue and told, on the second leader
  // slot, that the Congress was its own party. It resolves to a short form this
  // file holds no palette for, so it falls to neutral, which is the correct
  // answer: the table is short a row, and saying so beats guessing.
  [/\bainrc\b|all india n\.? ?r\.? ?congress/i, 'AINRC'],
  [/\bdmk\b|dravida munnetra kazhagam/i, 'DMK'],
  [/\bysrcp\b|ysr congress|yuvajana sramika/i, 'YSRCP'],
  [/\bncp\b|nationalist congress/i, 'NCP'],
  [/\btmc\b|\baitc\b|trinamool/i, 'TMC'],
  [/\bbrs\b|\btrs\b|bharat rashtra samithi|telangana rashtra samithi/i, 'BRS'],
  [/\btdp\b|telugu desam/i, 'TDP'],
  [/\baap\b|aam aadmi/i, 'AAP'],
  [/\bsp\b|samajwadi/i, 'SP'],
  [/\brjd\b|rashtriya janata dal/i, 'RJD'],
  [/\bjd ?\(?u\)?\b|janata dal ?\(?united\)?/i, 'JD(U)'],
  [/\bcpi ?\(?m\)?\b|\bcpm\b|communist party of india ?\(marxist\)/i, 'CPI(M)'],
  [/shiv ?sena|\bshs\b/i, 'Shiv Sena'],
  [/jana ?sena|\bjsp\b/i, 'Jana Sena'],
  [/\bbjp\b|bharatiya janata/i, 'BJP'],
  // Last, and only last: everything above that carries the word Congress has
  // already had its turn.
  [/\binc\b|indian national congress|\bcongress\b/i, 'INC'],
]

/** The brand for a party name or abbreviation, or a neutral one when unknown. */
export function brandFor(party: string | null): PartyBrand {
  const text = (party ?? '').trim()
  if (!text) return NEUTRAL
  for (const [pattern, short] of MATCHERS) {
    // The patterns carry no /g flag, so none of them holds a `lastIndex`
    // between calls and this loop is safe to run on every render.
    if (pattern.test(text)) return BY_SHORT.get(short) ?? NEUTRAL
  }
  return NEUTRAL
}

/* ===========================================================================
   The desk's own brand images

   The slots the desk fills, held per account for the same reason every other
   cache here is: a device can be shared, and one office's uploads are not the
   next office's to see.
   =========================================================================== */

export interface DeskBrand {
  /** The party's mark, as a data URL the desk uploaded. Null until they do. */
  markUrl: string | null
  /** The party's national figure. Null until the desk supplies one. */
  leaderUrl: string | null
  /** A second figure, usually the state leader. Null until supplied. */
  leader2Url: string | null
  /** A line the office puts on every poster, e.g. a constituency slogan. */
  slogan: string | null
}

/**
 * Read through a function rather than captured in a constant, same as every
 * other cache here: the active account changes at runtime, and a module-level
 * constant would freeze whichever account was signed in at first import.
 */
const KEY = (): string => deskKey('signal.deskBrand.v1')

/**
 * The cap on one image slot, in characters of data URL.
 *
 * A portrait cut out with no background is a PNG, and a PNG of a face at any
 * useful size runs to hundreds of kilobytes before base64 adds a third on top.
 * localStorage is a few megabytes for the entire desk and this app has already
 * been bitten by that ceiling twice: `handles.ts` drops its oldest snapshots at
 * the quota and `news-relevance.ts` keeps only its newest quarter, both written
 * after a write threw. The bill here is worse than either, because three slots
 * of unbounded image would not merely lose their own key, they would take down
 * whichever cache was unlucky enough to write next. Roughly 180,000 characters
 * is about 135KB of picture, which is a generous 512px portrait and is stored
 * as about 360KB once the browser counts it in UTF-16.
 */
const MAX_IMAGE_CHARS = 180_000

/** A line on a poster, not a paragraph. Longer than this is a mistake, not a slogan. */
const MAX_SLOGAN_CHARS = 160

const EMPTY: DeskBrand = { markUrl: null, leaderUrl: null, leader2Url: null, slogan: null }

/**
 * What the desk has set this session, and the scoped key it belongs to.
 *
 * Two jobs, and the second is why it holds the key as well as the value. It
 * serves what could not be persisted: a portrait over `MAX_IMAGE_CHARS` is kept
 * here and left out of the write, so the poster the desk just built still draws
 * the face they chose instead of the slot appearing to reject their upload the
 * instant they made it. And it is invalidated by comparing keys rather than
 * living as a bare value, because the storage scope moves at runtime when
 * somebody signs in or the example desk opens, and a cache that ignored that
 * would hand one office the portrait another office uploaded.
 */
let memo: { key: string; brand: DeskBrand } | null = null

/**
 * An image slot as the disk may hold it, or null.
 *
 * The one place the cap is enforced, on both sides: it decides what a write
 * puts in the key, and it discards anything a read finds over the limit, which
 * is how a value left by an older build or edited by hand is handled.
 * Oversized values are dropped rather than cut, because a truncated data URL is
 * a string that still looks like an image and decodes to nothing.
 */
const image = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t || t.length > MAX_IMAGE_CHARS) return null
  return t
}

/**
 * A slot as it stands in memory: trimmed, with the empty string folded to null
 * so "cleared" has exactly one representation. No cap is applied here, because
 * the cap is a storage limit and not a limit on what the studio may draw this
 * session, and `image` above enforces it on the way to the disk.
 */
const slot = (v: string | null): string | null => {
  const t = (v ?? '').trim()
  return t || null
}

const line = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  // By code point rather than by UTF-16 unit, so a cut never lands inside a
  // surrogate pair and leaves half a character on the poster. It is not cluster
  // safe, and saying so is the point: a Telugu matra is a code point of its own,
  // so a line cut at exactly this length can still strand one and draw it as a
  // dotted circle. That is accepted at 160 characters, where a cut at all means
  // the office typed a paragraph into a line meant for a phrase.
  return Array.from(t).slice(0, MAX_SLOGAN_CHARS).join('')
}

export function readDeskBrand(): DeskBrand {
  const key = KEY()
  if (memo && memo.key === key) return memo.brand
  let brand = EMPTY
  try {
    const raw = localStorage.getItem(key)
    const o = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    brand = {
      markUrl: image(o['markUrl']),
      leaderUrl: image(o['leaderUrl']),
      leader2Url: image(o['leader2Url']),
      slogan: line(o['slogan']),
    }
  } catch {
    /* private mode, or a corrupt entry: the desk starts with empty slots rather
       than the studio failing to open */
  }
  memo = { key, brand }
  return brand
}

/** Undefined means "not supplied", which is not the same as an explicit null. */
const pick = <T,>(patched: T | undefined, current: T): T =>
  patched === undefined ? current : patched

/**
 * Set some of the slots, and hand back the whole brand as it now stands.
 *
 * A patch is merged field by field rather than by spreading, because a caller
 * that passes `{ leaderUrl: someMaybeUndefined }` would otherwise write
 * undefined into a field this module promises is a string or null, and every
 * later read would carry it.
 *
 * What is returned is what the studio should draw, which is not always what
 * reached the disk: an image over the cap is kept for the session and written
 * as an empty slot. The slot is emptied rather than left holding the picture it
 * replaced, because the desk chose the new one, and quietly reviving the old
 * one on the next reload would put a face on a poster that nobody picked.
 */
export function saveDeskBrand(patch: Partial<DeskBrand>): DeskBrand {
  const current = readDeskBrand()
  const key = KEY()
  const merged: DeskBrand = {
    markUrl: slot(pick(patch.markUrl, current.markUrl)),
    leaderUrl: slot(pick(patch.leaderUrl, current.leaderUrl)),
    leader2Url: slot(pick(patch.leader2Url, current.leader2Url)),
    slogan: line(pick(patch.slogan, current.slogan)),
  }
  memo = { key, brand: merged }
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        markUrl: image(merged.markUrl),
        leaderUrl: image(merged.leaderUrl),
        leader2Url: image(merged.leader2Url),
        slogan: merged.slogan,
      }),
    )
  } catch {
    /* private mode, or over quota: the slots still render this session, they
       just will not survive a reload */
  }
  return merged
}

/**
 * Empty every slot.
 *
 * The memo is set to the empty brand rather than dropped, so a device that
 * cannot write, or cannot remove, still shows the clear as having happened. A
 * dropped memo would send the next read back to a key the removal failed to
 * delete, and the desk would press clear and watch nothing change.
 */
export function clearDeskBrand(): void {
  const key = KEY()
  memo = { key, brand: EMPTY }
  try {
    localStorage.removeItem(key)
  } catch {
    /* nothing to remove */
  }
}

/**
 * Portraits the EXAMPLE desk may point a slot at, by party.
 *
 * These are files already in this repository as demo data, which is the only
 * reason they can be named at all. Nothing here is a product asset: on a real
 * desk this table is never consulted, and a desk that installs this app gets an
 * empty slot and a screen asking for its own file.
 *
 * There is no entry for a party mark, in this table or anywhere else, because
 * the repository has no party's mark in it and will not be given one.
 */
const DEMO_LEADERS: Record<string, string> = {
  BJP: '/demo-avatars/modi-twitter-x.jpg',
  INC: '/demo-avatars/rahul-twitter-x.jpg',
}

/** Paths the EXAMPLE desk may point its slots at. Empty on a real desk. */
export function demoBrandSuggestions(party: string | null): Partial<DeskBrand> {
  // The gate is the storage scope and not a flag of this module's own, because
  // the store is the one thing that knows which desk is open, and a second
  // answer to that question is how a real office ends up with demo data on a
  // poster going out under its own name.
  if (!isDemoScope()) return {}
  const url = DEMO_LEADERS[brandFor(party).short]
  // One figure and not two. The second slot on a poster like this is the state
  // leader, and this function is handed a party and nothing else: it cannot
  // tell a Telangana desk from an Uttar Pradesh one, and filling that slot from
  // a guess would put the wrong state's leader over a member's own face.
  return url ? { leaderUrl: url } : {}
}


/* ===========================================================================
   Who leads the state, and whether they belong on this desk's poster
   =========================================================================== */

/**
 * The rule the office asked for, in one sentence: the prime minister goes on
 * the card, and the chief minister goes on it as well WHEN THE STATE IS THE
 * DESK'S OWN PARTY. On this desk that means the prime minister alone, because
 * Telangana is governed by the Congress and the member sits for the BJP.
 *
 * The alternative was to let the office fill both slots and never ask. That
 * produces, sooner or later, a greeting under a BJP member's name carrying the
 * face of a Congress chief minister, which is not a design mistake, it is a
 * defection notice printed at 1080 by 1350 and posted to forty thousand people.
 *
 * WHERE THE ANSWER COMES FROM, AND WHY IT IS NOT A TABLE IN THIS FILE ANY MORE.
 * It used to be: twenty-nine states hardcoded here, each with the month its
 * government took office and a five-year clock. That was wrong in two ways at
 * once. It was a second copy of a fact `picture-library.ts` already held, and
 * two copies of a fact about who governs Kerala is one copy too many. And the
 * clock did not work: several states record a CONTINUOUS tenure rather than the
 * current term, so Uttar Pradesh carried March 2017 and the five-year rule
 * declared it expired in 2022, which it plainly is not.
 *
 * Now it reads the library, where each chief minister's party was verified
 * against a live source on a stated day and the portrait beside it was fetched
 * to prove it exists. One fact, one place, checked.
 *
 * IT STILL GOES OUT OF DATE, and that is handled rather than ignored. Past the
 * window below the whole snapshot stops asserting and starts asking, because a
 * year-old answer about who governs a state is not an answer. It does not fall
 * through to "not your party" either: suppressing a leader the office is
 * entitled to put up is its own kind of wrong.
 */

/**
 * How long the library's snapshot of who governs where is allowed to speak for
 * itself.
 *
 * Eighteen months is chosen against the thing it is protecting from, which is
 * an election. Indian states go to the polls on their own cycles and several
 * fall in any given year, so a snapshot older than this has almost certainly
 * been overtaken somewhere. Shorter and the office is asked a question the
 * product could have answered; much longer and the product answers a question
 * it no longer knows.
 */
const SNAPSHOT_MONTHS = 18

/** The state name as the library writes it, with its parenthetical stripped. */
const plainState = (v: string): string => v.replace(/\s*\(.*$/, '').trim().toLowerCase()

/** Whether the library's snapshot is still recent enough to answer with. */
function snapshotHolds(now: Date): boolean {
  const taken = new Date(CHECKED_ON)
  if (Number.isNaN(taken.getTime())) return false
  const edge = new Date(taken)
  edge.setMonth(edge.getMonth() + SNAPSHOT_MONTHS)
  return now.getTime() < edge.getTime()
}

export type SecondLeaderSlot = 'offer' | 'hide' | 'ask'

export interface SecondLeaderRule {
  /**
   * `offer` when the state is the desk's own party and the second face belongs
   * on the card. `hide` when it plainly does not. `ask` when this product
   * cannot say and the desk can.
   */
  slot: SecondLeaderSlot
  /** The party leading the state, when the library stands behind it. */
  stateParty: string | null
  /** The chief minister's picture, ready for the slot, when there is one. */
  picture: Picture | null
  /** One line for the screen, and one only. */
  note: string
}

/**
 * Whether the second leader slot is offered for a desk of this party in this
 * state.
 *
 * `now` is a parameter so a test can put the clock anywhere. It defaults to the
 * real one, which is what every caller in the product passes by not passing it.
 */
export function secondLeaderRule(
  party: string | null,
  state: string | null,
  now: Date = new Date(),
): SecondLeaderRule {
  const own = (party ?? '').trim()
  const where = (state ?? '').trim()
  if (!own || !where) {
    return {
      slot: 'ask',
      stateParty: null,
      picture: null,
      note: 'Your party and state are not both set, so this one is your call.',
    }
  }
  if (!snapshotHolds(now)) {
    return {
      slot: 'ask',
      stateParty: null,
      picture: null,
      note: `Who leads ${where} was last checked on ${CHECKED_ON}, so this one is your call.`,
    }
  }
  const want = plainState(where)
  const row = PICTURES.find((x) => x.state !== null && plainState(x.state) === want) ?? null
  if (!row || !row.holderParty) {
    return { slot: 'ask', stateParty: null, picture: null, note: `Who leads ${where} is your call.` }
  }
  if (sameParty(row.holderParty, own)) {
    return {
      slot: 'offer',
      stateParty: row.holderParty,
      picture: row,
      note: `${where} is your party's government, so the chief minister can go on the card.`,
    }
  }
  return {
    slot: 'hide',
    stateParty: row.holderParty,
    picture: null,
    note: `${where} is led by ${row.holderParty}, so the card carries the prime minister alone.`,
  }
}


/**
 * Whether two written party names are the same party.
 *
 * Through `brandFor` when both are recognised, which is what makes "BJP" and
 * "Bharatiya Janata Party, Telangana" one answer. When either falls to neutral
 * the comparison drops to the plain strings, because neutral is the absence of
 * a match and not a party: two unrecognised names would otherwise both be
 * "Neutral" and compare equal, and a Jharkhand desk would be told the Congress
 * was its own party.
 */
function sameParty(a: string, b: string): boolean {
  const x = brandFor(a)
  const y = brandFor(b)
  if (x !== NEUTRAL && y !== NEUTRAL) return x.short === y.short
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}
