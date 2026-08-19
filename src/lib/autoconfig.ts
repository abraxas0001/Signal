import type { Identity, SocialHandle } from '@shared/identity'
import { partyAbbreviation } from '@shared/identity'
import { resolvePlace, placeVariants, type ResolvedPlace } from '@shared/places'
import {
  PORTALS,
  portalsForState,
  indexUrlFor,
  feedUrlFor,
  citiesOf,
  type NewsPortal,
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

export interface PlannedPortal {
  label: string
  host: string
  language: string
  reach: PortalReach
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
 * lib/scan.ts) and each one is a live fetch of somebody else's server. Handing
 * it twelve would mean four are silently dropped every morning — the exact
 * failure mode this file exists to avoid — so the plan stops where the scanner
 * does, and says how many it left out.
 */
const PORTAL_BUDGET = 8

/**
 * Which mastheads to read, and in what order.
 *
 * Ranked by how specifically each one can be pointed at this desk, because that
 * is what decides whether the scan comes back with this constituency's news or
 * the whole state's. A paper with a district edition for Mahabubnagar is worth
 * more to a Gadwal office than a national daily, whatever their circulations.
 *
 * Language is a tiebreak rather than a filter. The registry already restricts
 * by state, and the local-language papers are the ones that actually carry
 * mandal-level news — but an office that reads only English must not end up
 * with an empty desk, so English titles are kept, just lower.
 */
function planPortals(place: ResolvedPlace): { portals: PlannedPortal[]; omitted: number } {
  if (!place.state) return { portals: [], omitted: 0 }

  const available = portalsForState(place.state)

  const scored = available.map((portal: NewsPortal) => {
    const districtUrl = place.district ? indexUrlFor(portal, place.district, place.state) : null
    const stateUrl = indexUrlFor(portal, null, place.state)

    // `indexUrlFor` falls back silently, so "did the district route work" is
    // answered by comparing what came back, not by trusting that it did.
    const hasDistrict = Boolean(districtUrl && districtUrl !== portal.indexUrl && districtUrl !== stateUrl)
    const hasState = stateUrl !== portal.indexUrl

    const reach: PortalReach = hasDistrict ? 'district' : hasState ? 'state' : 'general'
    const indexUrl = hasDistrict ? districtUrl! : stateUrl

    return {
      label: portal.label,
      host: portal.host,
      language: portal.language,
      reach,
      indexUrl,
      hasFeed: feedUrlFor(portal, place.district, place.state) !== null,
      // District beats state beats general; within a tier, a paper in the
      // region's own language beats an English one.
      rank:
        (hasDistrict ? 200 : hasState ? 100 : 0) +
        (portal.language === 'English' ? 0 : 10) +
        (portal.rssUrl ? 1 : 0),
    }
  })

  scored.sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label))

  const chosen = scored.slice(0, PORTAL_BUDGET)
  return {
    portals: chosen.map(({ rank: _rank, ...rest }) => rest),
    omitted: Math.max(0, scored.length - chosen.length),
  }
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
}

export function planTerms(identity: Identity, place: ResolvedPlace): DeskTerms {
  const nameTerms: string[] = []
  const placeTerms: string[] = []
  const partyTerms: string[] = []

  const push = (into: string[], value: string | null | undefined): void => {
    const trimmed = value?.trim()
    if (trimmed && trimmed.length > 2 && !into.includes(trimmed)) into.push(trimmed)
  }

  push(nameTerms, identity.name)
  for (const alias of identity.aliases) push(nameTerms, alias)

  const parts = identity.name.trim().split(/\s+/).filter(Boolean)
  if (parts.length > 1) {
    // The surname alone: Telugu and Hindi mastheads routinely print only that.
    push(nameTerms, parts[parts.length - 1])
    if (parts.length > 2) push(nameTerms, `${parts[0]} ${parts[parts.length - 1]}`)
    // "D. K. Aruna" is also written "DK Aruna", and neither form matches the
    // other under a plain substring test.
    const initials = parts.slice(0, -1).map((x) => x.replace(/\W/g, '')).join('')
    if (initials.length >= 2) push(nameTerms, `${initials} ${parts[parts.length - 1]}`)
  }

  for (const variant of placeVariants(place.districtMatch, identity.district)) {
    push(placeTerms, variant)
  }
  push(placeTerms, identity.constituency)

  // The abbreviation, not the registered name: a week of Telugu coverage
  // carries "BJP" a hundred times and the full name once.
  const abbreviation = partyAbbreviation(identity.party)
  push(partyTerms, abbreviation ?? identity.party)

  return {
    name: nameTerms,
    place: placeTerms,
    party: partyTerms,
    all: [...new Set([...nameTerms, ...placeTerms, ...partyTerms])],
    persona: [...new Set([...nameTerms, ...placeTerms])],
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
      `No mastheads are on file for ${place.state} yet. The desk still works — add the papers you read by address on the grievance desk.`,
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
  }

  if (identity.handles.length === 0) {
    notes.push(
      'No social accounts were found on the profile page. Add them on the Accounts screen and mark them as yours — the comments under your own posts are where "what people are saying" comes from.',
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
