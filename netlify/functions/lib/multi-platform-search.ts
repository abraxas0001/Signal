import type { Platform } from '../../../shared/taxonomy'
import type { Confidence } from '../../../shared/identity'
import { searchPeople, type PersonCandidate } from './identity'
import { searchYouTubeChannels } from './influencers'
import { readHandle, type HandlePost, type HandleRef, type HandleSummary } from './handles'
import { qidForArticle, wikidataFacts } from './wikidata'

/**
 * One person's accounts across the platforms, from their name.
 *
 * The version of this file that this replaces lower-cased the name, joined the
 * words five different ways and handed back `https://instagram.com/<guess>` as
 * a profile URL. That is the exact failure this product exists to catch,
 * committed by the product on its own search screen: a confident-looking
 * address for an account belonging to somebody else, or to nobody.
 *
 * So nothing here is constructed from a name. Every account comes from a source
 * that asserts it, and is then read back off the platform:
 *
 *   YouTube    InnerTube's channel search — a real index, keyless from a
 *              server. It answers for a NAME, so it also returns fan channels,
 *              news channels covering the person, and impersonators. A result
 *              says the channel exists; it says nothing about whose it is.
 *   Facebook   Wikidata's typed identifiers (P2013, P2003, P2002). Somebody
 *   Instagram  edited those in and cited the account, which is a record rather
 *   Twitter/X  than a search — and the only route left, because a server gets
 *              HTTP 429 from Instagram, 503 from X, and zero post permalinks
 *              from Facebook under every crawler identity tried.
 *   LinkedIn   nothing at all. Authwall on one side, no typed identifier on
 *              the other. The coverage row says so, rather than leaving the
 *              reader to wonder why one platform is quietly missing.
 *
 * The heavier ladder — the article's infobox, then a grounded model search —
 * already exists in identity.ts behind /api/identity and costs a model call per
 * person. This is the cheap half: one search index, one database, no model, so
 * it can run while somebody is still deciding who they meant.
 *
 * Every row carries its own confidence and the caller is expected to render it.
 * A recorded X handle nobody could read must not sit beside a channel that was
 * fetched as though the two were equally known.
 */

/** Long enough that "d" does not run a search, short enough for "K L". */
const MIN_QUERY = 3
const MAX_QUERY = 120

/** Channels one name search offers before the list stops being read. */
const YOUTUBE_CHANNELS = 4

/**
 * How many candidates get a live read.
 *
 * Each is a page fetch of a second or two and they run together, so the ceiling
 * is about the platforms' patience rather than the clock: Instagram begins
 * answering 429 well before a dozen reads arrive from one address.
 */
const MAX_VERIFICATIONS = 10

/**
 * Wikidata's platform names, and only the ones handles.ts can read back.
 *
 * The item also records TikTok (P7085) and Telegram (P3789). Both are left out
 * deliberately: `readByPlatform` has no reader for either, so they could only
 * be passed through as assertions nothing in this module ever checked, which is
 * the behaviour this file was rewritten to remove.
 */
const RECORDED_PLATFORMS: Record<string, Platform> = {
  X: 'Twitter/X',
  Facebook: 'Facebook',
  Instagram: 'Instagram',
  YouTube: 'YouTube',
}

/** How the account was arrived at, which decides what it is evidence of. */
export type Discovery = 'public-record' | 'name-search'

export interface PlatformProfile {
  platform: Platform
  handle: string
  name: string | null
  profileUrl: string
  followers: number | null
  /**
   * What the reader listed, newest first. Empty on every gated platform, and
   * `listing` says which of those two an empty list is.
   *
   * Carried on the search result rather than left to a second call because the
   * read that verified the account already had it: a caller that wants to
   * analyse this person's recent posts would otherwise fetch every profile
   * twice to get back what was thrown away here.
   */
  recentPosts: HandlePost[]
  /** Why the post list is empty, in the reader's own words. */
  listing: string
  discovery: Discovery
  /**
   * The platform served something only a real account has — a follower count,
   * or a post list. False means it could not be checked from a server, NOT that
   * the account is fake: X and LinkedIn refuse every unauthenticated read.
   *
   * True can also come off the last sync's stored post list rather than a read
   * made just now. `note` says which, because those are not the same freshness.
   */
  platformConfirmed: boolean
  confidence: Confidence
  /** Shown verbatim: what this row is, and what it is not evidence of. */
  note: string
}

export interface PlatformCoverage {
  platform: Platform
  /** Where candidates for this platform can come from at all. */
  route: Discovery | 'none'
  /** Accounts this run returned for it. */
  found: number
  note: string
}

export interface MultiPlatformSearchResult {
  query: string
  /** The article whose record was read. Null when the encyclopaedia matched nobody. */
  person: { name: string; description: string | null; url: string; wikidata: string | null } | null
  /** Everyone the name matched, so the caller can offer to search a different one. */
  people: PersonCandidate[]
  profiles: PlatformProfile[]
  coverage: PlatformCoverage[]
  /** Candidate accounts that were read back off their platform. */
  checked: number
  searchedAt: string
}

/**
 * The per-platform notes, written from what was measured rather than from what
 * the platforms document. The figures are the ones recorded in handles.ts and
 * account-search.mts, taken from a residential connection on real accounts.
 */
const COVERAGE: readonly Omit<PlatformCoverage, 'found'>[] = [
  {
    platform: 'YouTube',
    route: 'name-search',
    note: 'Searched. InnerTube answers a server without a key, so a name returns real channels — tied to this person by nothing except the name they share.',
  },
  {
    platform: 'Facebook',
    route: 'public-record',
    note: 'No keyless name search. A page read returned 0 post permalinks under four crawler identities on a 4.9MB page, so anything here comes from Wikidata recording the account.',
  },
  {
    platform: 'Instagram',
    route: 'public-record',
    note: 'No keyless name search: a server gets HTTP 429. Anything here comes from Wikidata recording the account.',
  },
  {
    platform: 'Twitter/X',
    route: 'public-record',
    note: 'No keyless name search: HTTP 503, even to Googlebot. Anything here comes from Wikidata recording the account, and cannot be read back to check it.',
  },
  {
    platform: 'LinkedIn',
    route: 'none',
    note: 'Neither route reaches it. LinkedIn shows a server an authwall, and the public record carries no typed LinkedIn identifier to fall back on.',
  },
]

/**
 * A handle counts as real when the platform gives us something only a real
 * account has. HTTP 200 is not evidence: Facebook and Instagram answer 200 for
 * accounts that do not exist.
 *
 * The same test rivals.ts applies to a model's guesses, for the same reason and
 * with the same exclusion — a reseller's rows would happily verify a handle
 * nobody has confirmed, so every read below passes `licensed: false` and this
 * refuses the licensed route should one ever reach it anyway.
 */
function servedByPlatform(summary: HandleSummary): boolean {
  return (
    summary.followers != null || (summary.posts.length > 0 && summary.listing.route !== 'licensed')
  )
}

interface Candidate {
  ref: HandleRef
  /** The address the source gave, for platforms whose reader builds none. */
  statedUrl: string
  name: string | null
  discovery: Discovery
  /** Collapses a channel id and an @handle for the same channel into one row. */
  key: string
}

async function youtubeCandidates(query: string): Promise<Candidate[]> {
  const channels = await searchYouTubeChannels(query, YOUTUBE_CHANNELS)
  return channels.map((channel) => ({
    // By handle rather than channel id wherever there is one: the id path skips
    // the channel page, and the page is the only place YouTube publishes a
    // subscriber count.
    ref: { platform: 'YouTube', handle: channel.handle ?? channel.channelId },
    statedUrl: channel.handle
      ? `https://www.youtube.com/${channel.handle}`
      : `https://www.youtube.com/channel/${channel.channelId}`,
    name: channel.name,
    discovery: 'name-search',
    key: `YouTube:${channel.channelId.toLowerCase()}`,
  }))
}

async function recordedCandidates(
  person: PersonCandidate,
): Promise<{ qid: string | null; candidates: Candidate[] }> {
  const qid = await qidForArticle(person.name).catch(() => null)
  if (!qid) return { qid: null, candidates: [] }

  const facts = await wikidataFacts(qid).catch(() => null)
  if (!facts) return { qid, candidates: [] }

  const candidates: Candidate[] = []
  for (const handle of facts.handles) {
    const platform = RECORDED_PLATFORMS[handle.platform]
    if (!platform) continue
    candidates.push({
      ref: { platform, handle: handle.handle },
      statedUrl: handle.url,
      name: person.name,
      discovery: 'public-record',
      // P2397 records a channel id, which is what a search result is keyed on
      // too, so one channel found both ways collapses to a single row.
      key: `${platform}:${handle.handle.toLowerCase()}`,
    })
  }
  return { qid, candidates }
}

function noteFor(
  platform: Platform,
  discovery: Discovery,
  confirmed: boolean,
  summary: HandleSummary | null,
): string {
  // A confirmation can also come off the last sync's stored post list, which is
  // a real read but not this request's. Writing that up as "and Facebook served
  // it" back-dates somebody else's fetch onto this one, on exactly the
  // platforms likeliest to have gone dark since — so the route sets the tense.
  const stored = summary?.listing.route === 'stored'

  if (discovery === 'public-record') {
    if (confirmed) {
      return stored
        ? `The public record names this as their ${platform} account, and the last sync read posts from it. ${platform} did not answer just now, so nothing here was re-checked.`
        : `The public record names this as their ${platform} account, and ${platform} served it.`
    }
    const why =
      summary?.listing.note ?? `${platform} did not answer, so nothing here could be checked.`
    return `The public record names this as their ${platform} account, unread. ${why}`
  }
  if (confirmed) {
    const how = stored
      ? `returned this channel for the name; its page did not answer just now, so the posts shown are the last sync's`
      : `returned this channel for the name and served its page`
    return `${platform} ${how}. That the channel is real has been checked; that it is theirs has not — a name search also finds fan channels, news channels covering them, and impersonators.`
  }
  return `${platform} returned this channel for the name, but its page did not answer. Neither the channel nor whose it is has been checked.`
}

async function verify(candidate: Candidate): Promise<PlatformProfile> {
  // `licensed: false` because these are candidates, not confirmed accounts.
  // Letting discovery fall through to a paid provider would bill a lookup for
  // every name a search happened to return, and a provider that answered for
  // one would be vouching for an account nobody has tied to this person.
  const summary = await readHandle(candidate.ref, { licensed: false }).catch(() => null)
  const confirmed = summary !== null && servedByPlatform(summary)
  const platform = candidate.ref.platform
  const recorded = candidate.discovery === 'public-record'

  return {
    platform,
    handle: summary?.handle ?? candidate.ref.handle,
    name: summary?.displayName ?? candidate.name,
    profileUrl: summary?.profileUrl || candidate.statedUrl,
    followers: summary?.followers ?? null,
    recentPosts: summary?.posts ?? [],
    listing:
      summary?.listing.note ??
      `${platform} did not answer this account, so there is no post list to show.`,
    discovery: candidate.discovery,
    platformConfirmed: confirmed,
    // Recorded and read is the only pairing worth calling high. Recorded but
    // unreadable, and read but tied to nobody, are different half-answers that
    // happen to deserve the same weight.
    confidence: recorded ? (confirmed ? 'high' : 'medium') : confirmed ? 'medium' : 'low',
    note: noteFor(platform, candidate.discovery, confirmed, summary),
  }
}

const weight = (confidence: Confidence): number =>
  confidence === 'high' ? 2 : confidence === 'medium' ? 1 : 0

/**
 * Find a person's accounts by name.
 *
 * `opts.person` pins which article the record is read from, for when the name
 * matched several. It matters more than it sounds: "aruna" ranks her
 * constituency above her, and a constituency's Wikidata item carries no social
 * accounts at all — so an unpinned search for a common name can come back with
 * the YouTube half and no explanation for the rest.
 *
 * Finding nothing is an ordinary outcome rather than an error. Wikipedia's
 * coverage of sitting MLAs is partial and of ward-level office holders close to
 * nil, and four of the five platforms cannot be searched at all, so the caller
 * must always be able to proceed by pasting a profile link instead.
 */
export async function searchAcrossAllPlatforms(
  query: string,
  opts: { person?: string } = {},
): Promise<MultiPlatformSearchResult> {
  const trimmed = query.trim().slice(0, MAX_QUERY)
  if (trimmed.length < MIN_QUERY) {
    throw new Error(`Give at least ${MIN_QUERY} characters of a name to search for.`)
  }

  const pinned = opts.person?.trim() ?? ''
  const people = await searchPeople(pinned || trimmed).catch(() => [])
  // searchPeople already sorts biographies of living people above everything
  // else, so the first flagged entry is the one whose record is worth reading.
  const chosen = people.find((candidate) => candidate.person) ?? people[0] ?? null

  const [record, searched] = await Promise.all([
    chosen ? recordedCandidates(chosen) : Promise.resolve({ qid: null, candidates: [] }),
    // Either half standing on its own is a useful answer, so neither is allowed
    // to take the other down: an InnerTube outage must not also hide the four
    // accounts the public record just supplied.
    youtubeCandidates(trimmed).catch((): Candidate[] => []),
  ])

  const byKey = new Map<string, Candidate>()
  for (const candidate of [...record.candidates, ...searched]) {
    const seen = byKey.get(candidate.key)
    if (!seen) {
      byKey.set(candidate.key, candidate)
      continue
    }
    // The same channel from both sources. Keep the record's claim about whose
    // it is, and read it at whichever address answers: a channel id skips the
    // channel page, which is the only place the subscriber count is published.
    if (!seen.ref.handle.startsWith('@') && candidate.ref.handle.startsWith('@')) {
      byKey.set(candidate.key, { ...seen, ref: candidate.ref, statedUrl: candidate.statedUrl })
    }
  }

  const candidates = [...byKey.values()].slice(0, MAX_VERIFICATIONS)
  const profiles = await Promise.all(candidates.map(verify))
  profiles.sort((a, b) => weight(b.confidence) - weight(a.confidence))

  return {
    query: trimmed,
    person: chosen
      ? {
          name: chosen.name,
          description: chosen.description,
          url: chosen.url,
          wikidata: record.qid,
        }
      : null,
    people,
    profiles,
    coverage: COVERAGE.map((row) => ({
      ...row,
      found: profiles.filter((profile) => profile.platform === row.platform).length,
    })),
    checked: candidates.length,
    searchedAt: new Date().toISOString(),
  }
}
