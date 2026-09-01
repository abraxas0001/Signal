import type { Identity, SocialHandle } from '@shared/identity'
import { partyAbbreviation } from '@shared/identity'
import { resolvePlace, placeTermsFor, type ResolvedPlace } from '@shared/places'
import {
  PORTALS,
  portalsForState,
  indexUrlFor,
  feedUrlFor,
  citiesOf,
  languagesOf,
  type NewsPortal,
  type PortalLanguage,
} from '@shared/regions'
import { update } from '@/lib/store'

/**
 * Setting a desk up around one person.
 *
 * Before this, an office finished setup knowing who it was for and nothing
 * else: the grievance desk had no mastheads selected, the news scan had no
 * words to search on, and the Accounts screen was empty. Every screen was a
 * form waiting to be filled in by somebody who did not yet know what the
 * product wanted. The commonest outcome of that is a tool nobody opens twice.
 *
 * Everything below is derived from the identity and nothing is invented. The
 * mastheads come out of the portal registry filtered by the state we resolved;
 * the search terms come out of the name, seat and party; the accounts come out
 * of what the profile page actually linked to. Where a step could not be taken
 * — an unplaceable district, a state with no local papers on file — it is
 * reported rather than quietly skipped, because a desk that thinks it is
 * watching eight papers and is watching none is worse than one that knows it
 * has nothing.
 *
 * The plan is built and shown BEFORE it is applied. An office should see that
 * this app has decided to read Eenadu's Mahabubnagar edition on their behalf,
 * and be able to disagree, rather than discovering it three days later when the
 * wrong district's stories arrive.
 */

/** How specifically a masthead can be read for this desk. */
export type PortalReach = 'district' | 'state' | 'general'

/**
 * Which shelf of the news-stand a masthead sits on, for this desk.
 *
 * Reach answers "how narrowly can we address this publisher", which is a fact
 * about their URLs. This answers "whose paper is it", which is a fact about
 * their newsroom, and where the two disagree the second is the one that
 * matters. The Hindu publishes a /telangana section, so its reach is 'state'.
 * Namasthe Telangana publishes no section paths at all, so its reach is
 * 'general'. The first is a national daily's regional page and the second is
 * the state's largest Telugu daily reporting its districts every morning, and
 * a ranking that knows only about reach puts them in that order.
 *
 * It did. Ranking the Mahabubnagar desk by reach alone returned Sakshi,
 * Eenadu, Andhra Jyothy, Deccan Chronicle, The Hindu, The New Indian Express,
 * The Hans India and 10TV: four English mastheads, and exactly one of the
 * Telugu channels the office asked for, on the day it said "we need to track
 * news channel very perfectly bcs they post most of the things".
 */
export type PortalLane = 'local' | 'localOther' | 'national' | 'wire'

export interface PlannedPortal {
  label: string
  host: string
  language: string
  reach: PortalReach
  /** Which shelf this came off, so the spread below is checkable. */
  lane: PortalLane
  /** The exact page the scan will read, so the choice is checkable. */
  indexUrl: string
  hasFeed: boolean
}

export interface DeskPlan {
  place: ResolvedPlace
  /** Mastheads to scan, best coverage first. */
  portals: PlannedPortal[]
  /** Mastheads covering this state that were left out, and why. */
  omittedPortals: number
  /** What the scan searches headlines for, flat. */
  watchTerms: string[]
  /** The same words, grouped by what they are good for. */
  terms: DeskTerms
  /** Accounts the identity says are this person's, to offer as "yours". */
  ownHandles: SocialHandle[]
  /** Plain sentences the office must read before this is applied. */
  notes: string[]
  /** True when there is genuinely nothing to configure. */
  empty: boolean
}

/**
 * How many mastheads the desk starts with.
 *
 * The scanner reads at most eight index pages in one request (MAX_SOURCES in
 * netlify/functions/lib/scan.ts) and each one is a live fetch of somebody
 * else's server. Planning more than the scanner reads does not read more
 * papers; it reads the first eight of a longer list and files a note saying the
 * rest were skipped, which is a desk that believes it is watching twelve papers
 * and is watching eight.
 *
 * So this number and MAX_SOURCES are one decision written in two files, and
 * they have to move together. There is a third: test-autoconfig.ts asserts the
 * plan never exceeds what the scanner reads, against a literal 8. Raising the
 * budget alone breaks that test, which is the intended behaviour rather than an
 * inconvenience: it is the assertion that stops these two drifting apart.
 *
 * Exported so the scanner's cap and this one can be compared in a test rather
 * than restated as a literal in a third place.
 */
export const PORTAL_BUDGET = 12

/**
 * The four shelves, in the order a desk should be filled from them.
 *
 * Own state and own language first, then the state's English press, then the
 * national front pages, then the wires. That is the order an office reads in,
 * and the order matters more than it looks: the lanes are filled to their quota
 * in this sequence, so when a state has fewer local papers than its quota the
 * spare slots run downhill to the national end rather than the other way.
 */
const LANE_ORDER: PortalLane[] = ['local', 'localOther', 'national', 'wire']

/**
 * Whose paper is this, from the desk's point of view.
 *
 * `states` carries most of the answer already: a masthead that names states is
 * printed for those states, and one marked 'all' is a national title with a
 * regional page at best. `kind` separates the wires and the fact-check desks,
 * which are national in a different sense again.
 *
 * The language half used to read `portal.language === 'English'`, on the theory
 * that anything else must be the state's own tongue. That theory is false in
 * exactly the places it matters. Four Hindi dailies publish a Maharashtra
 * section and every Marathi masthead publishes none, so a Pune desk counted
 * Amar Ujala, Dainik Bhaskar, Hindustan and Dainik Jagran as its local press
 * and got one Marathi title in eight. `languages` on the region roll answers
 * the question properly.
 *
 * 'localOther' is therefore "printed for this state, in a language the state
 * does not read", which is English nearly always and Hindi in Goa.
 */
function laneOf(portal: NewsPortal, spoken: PortalLanguage[]): PortalLane {
  if (portal.kind) return 'wire'
  if (portal.states === 'all') return 'national'
  return spoken.includes(portal.language) ? 'local' : 'localOther'
}

/**
 * How the shelves divide a budget.
 *
 * Half to the state's own press, a quarter to its English papers, a quarter to
 * the national front pages, and a wire only once there are ten slots to spend.
 * The shares are the argument of this whole file in numbers: a member's office
 * is reported on locally, so most of the budget goes where the reporting is,
 * and the national quarter exists because the day the member is national news
 * is the day the desk must not be reading eight district editions.
 *
 * Each lane may fall short of its quota. A thin state has no local press at
 * all, and 22 states have no wire in the registry that is not already national,
 * so the caller fills what is left over by rank and the shares stay a
 * preference rather than a promise.
 */
function laneQuota(budget: number): Record<PortalLane, number> {
  const wire = budget >= 10 ? 1 : 0
  const rest = Math.max(0, budget - wire)
  const local = Math.max(1, Math.round(rest * 0.5))
  const localOther = Math.max(1, Math.round(rest * 0.25))
  return { local, localOther, national: Math.max(0, rest - local - localOther), wire }
}

/** A scored candidate: what the plan will show, plus why it was chosen. */
type ScoredPortal = PlannedPortal & { rank: number }

/**
 * The hundreds column of a masthead's score, by shelf.
 *
 * The gaps are 100 and every other bonus totals less than that, which is the
 * property `scorePortal` explains and test-autoconfig.ts asserts.
 */
const LANE_BASE: Record<PortalLane, number> = {
  local: 500,
  localOther: 400,
  national: 200,
  wire: 100,
}

/**
 * How good a source this masthead is for this desk, as one number.
 *
 * The lane decides the hundreds and everything else decides the rest, because
 * whose paper it is outweighs every other consideration here. Inside a lane:
 *
 *   reach     a district edition (+90) beats a state section (+40) beats a
 *             homepage, because it is the difference between this
 *             constituency's news and the whole state's.
 *   focus     a masthead printed for one state (+20) beats one printed for two
 *             or three (+10) beats a regional group, because a smaller
 *             footprint means more of every page is about this desk.
 *   checked   a masthead somebody has actually fetched (+12) beats one added
 *             from a reading list, because an opening set should be drawn from
 *             sources known to answer. See `unverified` in shared/regions.ts.
 *   feed      a publisher offering RSS (+6) beats one whose index has to be
 *             scraped: the feed is steadier and returns ten times as many
 *             stories.
 *
 * The bonuses total less than the gap between two lanes at the same reach, and
 * that is deliberate rather than incidental. It is what makes the sorted list
 * monotonic in lane inside any one reach, so a Telugu paper read at its state
 * section can never fall below an English one read at its state section.
 * test-autoconfig.ts asserts exactly that. A non-English masthead marked
 * `states: 'all'` would break it, so if one is ever added, the lanes and not
 * the language are what need revisiting.
 */
function scorePortal(
  portal: NewsPortal,
  place: ResolvedPlace,
  spoken: PortalLanguage[],
): ScoredPortal {
  const districtUrl = place.district ? indexUrlFor(portal, place.district, place.state) : null
  const stateUrl = indexUrlFor(portal, null, place.state)

  // `indexUrlFor` falls back silently, so "did the district route work" is
  // answered by comparing what came back, not by trusting that it did.
  const hasDistrict = Boolean(
    districtUrl && districtUrl !== portal.indexUrl && districtUrl !== stateUrl,
  )
  const hasState = stateUrl !== portal.indexUrl

  const lane = laneOf(portal, spoken)
  const hasFeed = feedUrlFor(portal, place.district, place.state) !== null
  const footprint = portal.states === 'all' ? 0 : portal.states.length

  return {
    label: portal.label,
    host: portal.host,
    language: portal.language,
    reach: hasDistrict ? 'district' : hasState ? 'state' : 'general',
    lane,
    indexUrl: hasDistrict ? districtUrl! : stateUrl,
    hasFeed,
    rank:
      LANE_BASE[lane] +
      // A fact-check desk publishes only when a claim is circulating, so it is
      // the last thing to spend a slot on and the first thing to want on a bad
      // morning. Below the wires, above nothing.
      (portal.kind === 'factcheck' ? -40 : 0) +
      (hasDistrict ? 90 : hasState ? 40 : 0) +
      (footprint === 1 ? 20 : footprint > 0 && footprint <= 4 ? 10 : 0) +
      (portal.unverified ? 0 : 12) +
      (hasFeed ? 6 : 0),
  }
}

const byRank = (a: ScoredPortal, b: ScoredPortal): number =>
  b.rank - a.rank || a.label.localeCompare(b.label)

/**
 * Which mastheads to read, and in what order.
 *
 * Two decisions, and they are not the same decision. Which eight is a question
 * about spread; what order to list them in is a question about merit. Taking
 * the top eight by rank answers the second and gets the first wrong, and that
 * became the whole problem when the registry grew from 102 mastheads to 134.
 * Adding twelve more Telugu titles changed a Telangana desk's opening set by
 * nothing at all, because four English mastheads publish a /telangana page and
 * not one Telugu channel publishes a section path, so the four sat above every
 * new arrival no matter how many arrived. The office had just said the channels
 * are where the news is, and expanding the registry could not put one there.
 *
 * So the lanes take their quota in turn (see `laneQuota`), any slots a thin
 * lane could not fill run to the next, and the chosen set is then sorted by
 * rank for display, so the office still reads them best first.
 *
 * Nothing here filters. Every masthead the registry holds for this state stays
 * available on the grievance desk's own picker; this only decides which ones a
 * desk starts with, and `omitted` says how many it did not.
 */
function planPortals(place: ResolvedPlace): { portals: PlannedPortal[]; omitted: number } {
  if (!place.state) return { portals: [], omitted: 0 }

  const spoken = languagesOf(place.state)
  const scored = portalsForState(place.state).map((portal: NewsPortal) =>
    scorePortal(portal, place, spoken),
  )
  scored.sort(byRank)

  const quota = laneQuota(PORTAL_BUDGET)
  const chosen: ScoredPortal[] = []
  const taken = new Set<ScoredPortal>()

  for (const lane of LANE_ORDER) {
    let filled = 0
    for (const candidate of scored) {
      if (chosen.length >= PORTAL_BUDGET || filled >= quota[lane]) break
      if (candidate.lane !== lane || taken.has(candidate)) continue
      chosen.push(candidate)
      taken.add(candidate)
      filled += 1
    }
  }

  // Whatever the quotas could not place. A state with two local papers and no
  // wire must still leave here with eight sources rather than four.
  for (const candidate of scored) {
    if (chosen.length >= PORTAL_BUDGET) break
    if (taken.has(candidate)) continue
    chosen.push(candidate)
    taken.add(candidate)
  }

  chosen.sort(byRank)
  return {
    portals: chosen.map(({ rank: _rank, ...rest }) => rest),
    omitted: Math.max(0, scored.length - chosen.length),
  }
}

/**
 * The spread, in a sentence, for an office looking at the plan before it runs.
 *
 * A count of papers says nothing about whether the desk is pointed at itself.
 * "Four Telugu papers and two national mastheads" is checkable against what the
 * office knows it reads, and it is the line that makes a bad plan visible: a
 * Mahabubnagar desk whose mix comes back as six national mastheads has a
 * registry problem, and the office should not have to open a URL to see it.
 */
function describeMix(portals: PlannedPortal[], state: string): string | null {
  const parts: string[] = []
  const of = (lane: PortalLane): PlannedPortal[] => portals.filter((p) => p.lane === lane)
  const noun = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

  /**
   * The one language a lane is written in, or null when it holds several.
   *
   * Naming it is the point of the sentence. "Four Telugu papers" is something a
   * Mahabubnagar office can check against what it actually reads; "four local
   * papers" is a number it has to take on trust.
   */
  const solelyIn = (list: PlannedPortal[]): string | null => {
    const languages = [...new Set(list.map((p) => p.language))]
    return languages.length === 1 ? (languages[0] ?? null) : null
  }

  const local = of('local')
  if (local.length > 0) {
    const language = solelyIn(local)
    parts.push(
      language
        ? `${local.length} ${language} ${local.length === 1 ? 'paper' : 'papers'}`
        : `${noun(local.length, 'paper', 'papers')} in the languages of ${state}`,
    )
  }

  const other = of('localOther')
  if (other.length > 0) {
    const language = solelyIn(other)
    parts.push(
      `${other.length}${language ? ` ${language}` : ''} ${
        other.length === 1 ? 'paper' : 'papers'
      } printed for ${state}`,
    )
  }

  const national = of('national')
  if (national.length > 0) {
    parts.push(noun(national.length, 'national masthead', 'national mastheads'))
  }

  const wire = of('wire')
  if (wire.length > 0) {
    parts.push(noun(wire.length, 'wire or fact-check desk', 'wire and fact-check desks'))
  }

  const last = parts.pop()
  if (!last) return null
  return `The mix is ${parts.length > 0 ? `${parts.join(', ')}, and ${last}` : last}.`
}

/**
 * What the scan searches headlines for.
 *
 * Three groups, and the reason each is here is different.
 *
 * The name and its variants are the point of the exercise. The surname alone is
 * included because Telugu and Hindi mastheads routinely print only that, and a
 * scan keyed on the full name misses the story that matters.
 *
 * The place terms are what turn a state-wide feed into a local one. Several
 * publishers serve their district edition on the reader's location rather than
 * the URL, so a server fetching the page gets the state feed whatever address
 * it asks for — the place words are how a district story is recovered from it.
 *
 * The party is included and the office can remove it. It is the noisiest term
 * here by a distance, and on a quiet week it is also the only one that finds
 * anything.
 */
/**
 * The search words, kept in the three groups that behave differently.
 *
 * They were one flat list, and the first live scan showed why that is wrong.
 * Searching the mastheads for a Gadwal MLA returned twenty-four stories, of
 * which nineteen were national BJP items — Kejriwal, a Kolkata meeting, a party
 * chief addressing youth workers. Every one matched "BJP" and not one was about
 * her. An office opening that sees "24 stories mention you" above a list where
 * none do, and the number stops meaning anything by Thursday.
 *
 * The groups are not a tidiness exercise. They answer different questions and
 * belong to different scans:
 *
 *   name   — "what is being said about this person". The persona tracker's
 *            entire job. A party name here is noise by construction.
 *   place  — "what is happening in this constituency". Also what recovers a
 *            district story from a state feed, since several publishers serve
 *            the district edition on the reader's location rather than the URL.
 *   party  — the widest net and the least specific. Useful on the grievance
 *            desk, where the question really is "what is happening politically
 *            near us", and actively harmful on a persona scan.
 */
export interface DeskTerms {
  name: string[]
  place: string[]
  party: string[]
  /** Everything, for the grievance desk, which wants the wide net. */
  all: string[]
  /**
   * What a persona scan should search: the person and their patch, never the
   * party. This is the field that stops a national story about a party chief
   * being reported to a member as coverage of themselves.
   */
  persona: string[]
  /**
   * Not a fourth group but a subset of the three: the words that are only ever
   * evidence when another watched word lands with them.
   *
   * Every term in here matched something real and wrong. "BJP" returned the
   * national wire. "Aruna", the surname this planner mints out of "D. K.
   * Aruna", matched a cricketer, and a cricket report reached an MLA's desk. A
   * district token carved out of a compound name matched a district sports
   * meet. None of them can be dropped instead: a Telugu masthead prints the
   * surname alone, and no masthead ever prints "Jogulamba Gadwal".
   *
   * A word the office named itself is never in here, however it also arrives.
   * See `owned` in planTerms.
   *
   * So they stay in `all` and are named here instead, and the scanner's
   * `worthKeeping` (netlify/functions/lib/scan.ts) keeps a story only when
   * something outside this list matched it too. That machinery already exists
   * for the party term, and this covers everything that machinery covers today
   * plus the two words the planner mints.
   *
   * It is not, however, the whole of what a `broadTags` caller needs. Only
   * words this planner produced can be listed here, and an office can add its
   * own: `broadTermsFor` in netlify/functions/daily-scan.mts also demotes the
   * desk's state and the registered party name, neither of which this planner
   * ever emits. Sending this list in place of that one would hand "Telangana"
   * back its old power to stand alone, which is the state-wide feed arriving as
   * local news. A caller wanting both has to union the two.
   */
  corroborating: string[]
}

export function planTerms(identity: Identity, place: ResolvedPlace): DeskTerms {
  const nameTerms: string[] = []
  const placeTerms: string[] = []
  const partyTerms: string[] = []
  /**
   * The words below that must not stand alone. Named for the scanner's own
   * parameter, because this is the list that becomes its `broadTags`.
   */
  const broad: string[] = []

  const push = (into: string[], value: string | null | undefined): void => {
    const trimmed = value?.trim()
    if (trimmed && trimmed.length > 2 && !into.includes(trimmed)) into.push(trimmed)
  }

  push(nameTerms, identity.name)
  for (const alias of identity.aliases) push(nameTerms, alias)

  const parts = identity.name.trim().split(/\s+/).filter(Boolean)
  if (parts.length > 1) {
    // The surname alone: Telugu and Hindi mastheads routinely print only that.
    // Watched, and marked broad, because by itself it is also a name half the
    // subcontinent shares: on its own "Aruna" put a cricketer's innings on the
    // desk of the member of Gadwal, which is the story this office complained
    // about. Alongside her seat or her full name it is still what finds the
    // Telugu headline that carries nothing else.
    push(nameTerms, parts[parts.length - 1])
    push(broad, parts[parts.length - 1])
    if (parts.length > 2) push(nameTerms, `${parts[0]} ${parts[parts.length - 1]}`)
    // "D. K. Aruna" is also written "DK Aruna", and neither form matches the
    // other under a plain substring test.
    const initials = parts.slice(0, -1).map((x) => x.replace(/\W/g, '')).join('')
    if (initials.length >= 2) push(nameTerms, `${initials} ${parts[parts.length - 1]}`)
  }

  const where = placeTermsFor(place.districtMatch, identity.district)
  for (const variant of where.all) push(placeTerms, variant)
  // A token split out of a compound district name is the other half of the same
  // failure the surname is: "Gadwal", carved off "Jogulamba Gadwal", matched a
  // district sports meet. placeTermsFor decides which tokens it invented.
  for (const fragment of where.corroborating) push(broad, fragment)
  push(placeTerms, identity.constituency)

  // The abbreviation, not the registered name: a week of Telugu coverage
  // carries "BJP" a hundred times and the full name once.
  const abbreviation = partyAbbreviation(identity.party)
  push(partyTerms, abbreviation ?? identity.party)
  push(broad, abbreviation ?? identity.party)

  /**
   * A word the office wrote whole is not a fragment, however else it reaches
   * this list.
   *
   * A desk that gave its seat as "Gadwal" watches "Gadwal" as its subject, and
   * the same string also arrives here as a token carved off the district name
   * "Jogulamba Gadwal". Demoting it on that account would take the desk's own
   * patch away from it and leave "Gadwal hospital has no doctors" needing a
   * second word before it counted. The same protection covers an alias the
   * office typed in by hand: choosing to watch a word is a decision this
   * planner does not get to overrule.
   */
  const owned = new Set(
    [identity.name, identity.constituency, ...identity.aliases]
      .map((value) => value?.trim().toLowerCase() ?? '')
      .filter(Boolean),
  )

  return {
    name: nameTerms,
    place: placeTerms,
    party: partyTerms,
    all: [...new Set([...nameTerms, ...placeTerms, ...partyTerms])],
    persona: [...new Set([...nameTerms, ...placeTerms])],
    corroborating: broad.filter((term) => !owned.has(term.toLowerCase())),
  }
}

/** The flat list the grievance desk and the profile store. */
export function planWatchTerms(identity: Identity, place: ResolvedPlace): string[] {
  return planTerms(identity, place).all
}

/** Build the plan without changing anything. */
export function planDesk(identity: Identity): DeskPlan {
  const place = resolvePlace({
    state: identity.state,
    district: identity.district,
    constituency: identity.constituency,
  })

  const { portals, omitted } = planPortals(place)
  const terms = planTerms(identity, place)
  const watchTerms = terms.all
  const notes = [...place.notes]

  if (!place.state) {
    notes.push(
      'No state could be worked out, so no local mastheads were selected. Add them on the grievance desk, or set the state in Settings.',
    )
  } else if (portals.length === 0) {
    notes.push(
      `No mastheads are on file for ${place.state} yet. The desk still works. Add the papers you read by address on the grievance desk.`,
    )
  } else {
    const district = portals.filter((p) => p.reach === 'district').length
    if (district > 0) {
      notes.push(
        `${district} of ${portals.length} papers can be read at their ${place.district} edition rather than state-wide, which is what makes local stories findable.`,
      )
    } else if (place.district) {
      notes.push(
        `None of these papers publish a separate ${place.district} edition, so the scan reads their state pages and relies on the search words below to find local stories.`,
      )
    }

    // Below three papers the mix is self-evident from the list itself, and a
    // sentence restating it is noise on a screen that already has plenty.
    const mix = portals.length >= 3 ? describeMix(portals, place.state) : null
    if (mix) notes.push(mix)
  }

  if (identity.handles.length === 0) {
    notes.push(
      'No social accounts were found on the profile page. Add them on the Accounts screen and mark them as yours. The comments under your own posts are where "what people are saying" comes from.',
    )
  }

  return {
    place,
    portals,
    omittedPortals: omitted,
    watchTerms,
    terms,
    ownHandles: identity.handles,
    notes,
    empty: portals.length === 0 && watchTerms.length <= 1,
  }
}

/**
 * Write the plan into the desk's own settings.
 *
 * Only the fields this plan is entitled to own. An office that has been tuning
 * its masthead list for a fortnight must not have that overwritten because
 * somebody corrected a date of birth, so `preserveExisting` is the default and
 * a real reconfiguration has to be asked for.
 */
export function applyDeskPlan(
  identity: Identity,
  plan: DeskPlan,
  opts: { overwritePortals?: boolean } = {},
): void {
  update((store) => {
    const existing = store.profile
    const keepPortals =
      !opts.overwritePortals && existing?.portals && existing.portals.length > 0

    return {
      ...store,
      profile: {
        subject: identity.name,
        constituency: identity.constituency ?? plan.place.district ?? '',
        watchTerms: plan.watchTerms,
        state: plan.place.state ?? undefined,
        // The resolved district, which is what the scanner routes on. Without
        // it the seat is used as the city and every district edition the plan
        // just showed the office is quietly replaced by a state page.
        district: plan.place.district ?? undefined,
        portals: keepPortals ? existing!.portals : plan.portals.map((p) => p.label),
        customPortalUrls: existing?.customPortalUrls ?? [],
      },
    }
  })
}

/**
 * A one-line account of what a plan will do, for a confirmation screen.
 *
 * Written as a sentence rather than a count because "8 portals, 11 terms" tells
 * an office nothing about whether the thing is pointed at them.
 */
export function describePlan(plan: DeskPlan): string {
  const where = plan.place.district
    ? `${plan.place.district}, ${plan.place.state}`
    : (plan.place.state ?? 'no region set')

  if (plan.portals.length === 0) {
    return `No local papers on file for ${where}. The desk will still read anything you paste.`
  }

  const district = plan.portals.filter((p) => p.reach === 'district').length
  return district > 0
    ? `Reading ${plan.portals.length} papers for ${where}, ${district} of them at their district edition.`
    : `Reading ${plan.portals.length} papers covering ${where}.`
}

/** Every masthead on file for a state, for the "show me the rest" control. */
export function allPortalsFor(state: string | null): NewsPortal[] {
  return state ? portalsForState(state) : PORTALS
}

/**
 * The places this desk might file an account or a record under.
 *
 * `CONSTITUENCIES` in shared/grievance.ts is the eight assembly segments of one
 * district in Andhra Pradesh — the office this product was first built for.
 * Every screen that offered it as a dropdown was therefore unusable for anybody
 * else: a Gadwal desk was shown eight Eluru segments, none of them its own, and
 * the influencer search quietly ran against Eluru because that was the first
 * option in the list. Not an empty state, not an error — the wrong district's
 * YouTube channels, presented as this office's local media.
 *
 * So the list is built from the desk instead: its own seat first, then its
 * district, then the rest of its state. The original eight are appended when
 * the desk actually is in that district and are otherwise absent.
 *
 * Every caller must still accept free text. This is a convenience, not a
 * register, and a seat missing from it has to cost a keystroke rather than
 * block the work.
 */
export function deskPlaces(profile: {
  constituency?: string | null
  state?: string | null
} | null): string[] {
  const out: string[] = []
  const push = (value: string | null | undefined): void => {
    const trimmed = value?.trim()
    if (trimmed && !out.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      out.push(trimmed)
    }
  }

  // The desk's own seat leads, because it is the answer nine times in ten and
  // a picker whose first option is right needs no interaction at all.
  push(profile?.constituency)

  const place = resolvePlace({
    state: profile?.state,
    constituency: profile?.constituency,
  })
  push(place.district)

  for (const district of place.state ? citiesOf(place.state) : []) push(district)

  return out
}
