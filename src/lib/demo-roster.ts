/**
 * The demo roster: five politicians, each against the rival they actually face.
 *
 * A visitor who opens this product to an empty dashboard has no way to judge
 * it. Every chart is a blank, every comparison is a placeholder, and the work
 * of configuring accounts comes before any evidence that configuring them is
 * worth it. So an empty store gets seeded with real, scraped data for real
 * politicians, and the reader can see the thing working before deciding whether
 * to point it at their own office.
 *
 * THIS IS REAL DATA, NOT A MOCK. `public/demo-politicians.json` is produced by
 * `npm run scraper:demo`, which visits each profile in a signed-in browser and
 * records what was actually there — real permalinks, real follower counts, real
 * engagement where the platform exposes it. Nothing here is invented, and where
 * a number could not be read it is null rather than filled in, exactly as it
 * would be for a paying office. A demo built on fabricated numbers would
 * misrepresent the product to the person deciding whether to buy it.
 *
 * IT NEVER OVERWRITES REAL WORK. The demo has its own storage namespace — see
 * demo-mode.ts — so it is not written over anybody's accounts at all; the two
 * are as separate as two real accounts are from each other. It opens by itself
 * only on a device with nothing configured, and otherwise on request: the
 * "example desk" link on the sign-in screen, or `?example=1`.
 *
 * (`?demo=1` is a different thing that predates this: a single worked report on
 * the analyse screen. The two do not interact.)
 */

import {
  handleId,
  replaceAllHandles,
  saveStandingCache,
  type Standing,
  type TrackedHandle,
} from '@/lib/handles'
import { update } from '@/lib/store'
import { buildDemoContent } from '@/lib/demo-content'
import type { Platform } from '@shared/taxonomy'

export interface DemoPost {
  url: string
  title: string | null
  publishedAt: string | null
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  thumbnailUrl?: string | null
}

export interface DemoHandle {
  platform: Platform
  handle: string
  profileUrl: string
  displayName: string | null
  avatarUrl: string | null
  followers: number | null
  takenAt: string
  posts: DemoPost[]
  /** Present only when the read failed. `posts` is then empty and means nothing. */
  failure?: string
  /**
   * What the app's own opinion reader returned for this account.
   *
   * Produced by `npm run scraper:opinions`, which calls `/api/standing` — the
   * same endpoint the "Read opinion" button uses — so this is a real reading,
   * not a seeded number. Absent on accounts the server could not read, which is
   * most of them: Facebook, Instagram and X publish no comments to a server
   * without a page token, and the reader refuses to score a handful.
   */
  standing?: unknown
  /** Why there is no reading. Kept so an empty card can say it was tried. */
  standingNote?: string
}

export interface DemoPerson {
  key: string
  name: string
  party: string
  partyTag: string
  role: string
  office?: { constituency: string; state: string; district: string }
  /** Native-script spellings; see scraper/roster.ts for why they matter. */
  aliases?: string[]
  handles: DemoHandle[]
}

/**
 * An account that talks ABOUT politicians rather than being one.
 *
 * Broadcasters, digital outlets, commentators, fact-checkers. They answer "what
 * is being said about us", which is a different question from "what is my
 * opponent campaigning on" — and putting rivals on the influencer screen
 * answered the second while the screen asked the first.
 */
export interface DemoCreator {
  key: string
  name: string
  kind: string
  language: string
  /** Which desks this account is worth watching from. */
  scope: 'telangana' | 'national' | 'both'
  why: string
  handles: DemoHandle[]
}

export interface DemoRival {
  key: string
  why: string
}

export interface DemoPairing {
  principal: string
  rivals?: DemoRival[]
  /**
   * The single-rival shape this file used to carry.
   *
   * Read but never written. A dataset built before rivals became a list is
   * still valid JSON sitting in someone's `public/`, and the alternative to
   * accepting it is a demo that throws on a field rename. `rivalsOf` normalises
   * both into one shape so nothing downstream has to know which it got.
   */
  rival?: string
  why?: string
}

export interface DemoRoster {
  generatedAt: string
  pairings: DemoPairing[]
  people: Record<string, DemoPerson>
  /** Optional so a dataset built before creators existed still loads. */
  creators?: DemoCreator[]
}

let cached: DemoRoster | null = null

/** Fetch the dataset once per session. Null when it is not deployed. */
export async function loadDemoRoster(): Promise<DemoRoster | null> {
  if (cached) return cached
  try {
    const res = await fetch('/demo-politicians.json')
    if (!res.ok) return null
    const data = (await res.json()) as DemoRoster
    if (!data?.people || Object.keys(data.people).length === 0) return null
    cached = data
    return data
  } catch {
    // Absent file, offline, or malformed JSON. The app works without it; the
    // dashboard is simply empty until someone adds their own accounts.
    return null
  }
}

/** The principals, in roster order, each paired with its rival. */
export interface PrincipalEntry {
  person: DemoPerson
  rivals: ResolvedRival[]
}

/** The principals, in roster order, each with everyone they are set against. */
export function principalsOf(roster: DemoRoster): PrincipalEntry[] {
  return roster.pairings
    .map((p) => {
      const person = roster.people[p.principal]
      if (!person) return null
      return { person, rivals: rivalsOf(roster, p.principal) }
    })
    .filter((x): x is PrincipalEntry => x !== null)
}

/**
 * Turn one scraped handle into the shape the dashboard already reads.
 *
 * A handle that failed to read contributes NO snapshot rather than an empty
 * one. A snapshot saying "zero posts, taken just now" is a measurement, and the
 * charts would draw it as a politician who has gone quiet. An absent snapshot
 * is an absent reading, which is the truth.
 */
function toTracked(h: DemoHandle, person: DemoPerson, own: boolean): TrackedHandle {
  return {
    id: handleId(h.platform, h.handle),
    platform: h.platform,
    handle: h.handle,
    displayName: person.name,
    profileUrl: h.profileUrl,
    avatarUrl: h.avatarUrl,
    own,
    label: person.partyTag,
    listingNote: h.failure ? `Could not read: ${h.failure}` : person.role,
    snapshots: h.failure
      ? []
      : [
          {
            takenAt: h.takenAt,
            followers: h.followers,
            posts: h.posts.map((p) => ({
              url: p.url,
              title: p.title,
              publishedAt: p.publishedAt,
              views: p.views,
              likes: p.likes,
              comments: p.comments,
              shares: p.shares,
              thumbnailUrl: p.thumbnailUrl ?? null,
            })),
          },
        ],
  }
}

/**
 * Build one desk: this politician, and the rival they actually contest against.
 *
 * `own` is the desk you are sitting at; the rival is what it is measured
 * against. Switching principal rebuilds both, so the five example desks are
 * five different offices rather than five orderings of one pile.
 */
export function applyPrincipal(roster: DemoRoster, principalKey: string): TrackedHandle[] {
  const principal = roster.people[principalKey]
  if (!principal) return []

  const rivals = rivalsOf(roster, principalKey)

  /**
   * This desk, and the one person it is actually up against. Nobody else.
   *
   * A previous version loaded the entire roster and marked one person `own`, so
   * every other politician on it became a "watched" account on every desk. That
   * put the Prime Minister on an MP's dashboard as her competitor, which is not
   * a comparison anybody in that office would make — she contests Mahabubnagar
   * against one man, and her follower count, her engagement and her share of
   * voice all mean something only against his.
   *
   * It also poisoned every derived number. Total followers summed six
   * politicians. The five-row follower board was five strangers. The mention
   * feed filled with national figures who had never mentioned her. The desk was
   * no longer about anybody.
   *
   * So a desk holds two people. Switching principal rebuilds it around the next
   * pair, which is what makes the five example desks genuinely different rather
   * than five orderings of one pile.
   */
  const cast = [principal, ...rivals.map((r) => r.person)]
  const tracked = cast.flatMap((person) =>
    person.handles.map((h) => toTracked(h, person, person.key === principalKey)),
  )

  replaceAllHandles(tracked)

  /**
   * The opinion readings, put back in the cache the app reads them from.
   *
   * Each one came from `/api/standing` — the same endpoint the "Read opinion"
   * button calls — via `npm run scraper:opinions`, so these are real readings
   * of real comments rather than seeded numbers. Only the accounts the server
   * could actually read carry one; the rest have none, and the card stays empty
   * because it genuinely is.
   */
  for (const person of cast) {
    for (const h of person.handles) {
      if (!h.standing) continue
      saveStandingCache(handleId(h.platform, h.handle), h.standing as Standing)
    }
  }

  /**
   * Make the desk belong to this person, not just the charts.
   *
   * Without this the demo opened on the setup screen — a store with no profile
   * has never been onboarded, so the app quite correctly asked whose office it
   * was before showing anything, and the seeded data sat behind a form. Worse,
   * once past it every chart would switch politician while the greeting, the
   * constituency card and the map went on naming whoever was set up first.
   *
   * `onboardedAt` is stamped here for the same reason: this desk HAS been
   * configured — by the roster rather than by a person, but configured — and
   * asking a visitor to fill in an office they do not have is the opposite of
   * letting them look around.
   */
  const office = principal.office
  const watchTerms = [principal.name, office?.constituency, principal.partyTag].filter(
    (t): t is string => typeof t === 'string' && t.length > 0,
  )

  update((prev) => ({
    ...prev,
    profile: {
      subject: principal.name,
      constituency: office?.constituency ?? '',
      // What "this post is about us" means for this person. The surname alone
      // is deliberately absent: "Reddy" and "Gandhi" would match half of Indian
      // politics and the mention feed would fill with strangers.
      watchTerms,
      state: office?.state,
      district: office?.district,
      /**
       * The mastheads this desk reads, so the morning scan can actually run.
       *
       * Without them the scan refuses before it starts — "no mastheads are
       * selected, so there is nothing to read" — and the news side of the
       * product is inert on a desk that otherwise looks configured. These are
       * labels from PORTALS in shared/regions.ts, chosen by where the seat is:
       * a Telangana office reads the Telugu editions, a national one reads the
       * Hindi and English nationals.
       *
       * Seeded rather than scraped, because which papers an office reads is a
       * choice it makes, not a fact about it — and these are the obvious
       * defaults for each patch rather than a claim about anybody's habits.
       */
      portals:
        office?.state === 'Telangana'
          ? ['Eenadu', 'Sakshi', 'Namasthe Telangana', 'Andhra Jyothy', 'NTV Telugu']
          : ['Aaj Tak', 'ABP News', 'Dainik Jagran', 'Amar Ujala'],
    },
    /**
     * The identity card behind the greeting and the header chips.
     *
     * Distinct from `profile`, and both are needed: `profile` is what the desk
     * WATCHES FOR, `identity` is who the desk IS. The greeting, the role and
     * party chips, and the follower rail all read the second one, so seeding
     * only the first left the header reading "Good afternoon." with no name
     * over a dashboard that had already switched politician.
     *
     * Everything unknown is null rather than plausible. Age, education, date of
     * birth and biography are all findable facts about these five people, and
     * inventing them to fill a card would be the one thing a monitoring tool
     * for a political office must never do — a demo that fabricates a
     * politician's details is a demo that teaches its reader the numbers are
     * decorative too.
     */
    identity: {
      name: principal.name,
      aliases: principal.aliases ?? [],
      photoUrl: principal.handles.find((h) => h.avatarUrl)?.avatarUrl ?? null,
      // The roster's role runs long ("MP, Mahabubnagar · National Vice
      // President, BJP"); the chip wants the office, not the full honours list.
      role: principal.role.split(/[·—]/)[0]?.trim() ?? null,
      party: principal.party,
      constituency: office?.constituency ?? null,
      district: office?.district ?? null,
      state: office?.state ?? null,
      age: null,
      dateOfBirth: null,
      education: null,
      inOfficeSince: null,
      bio: null,
      handles: principal.handles
        .filter((h) => !h.failure)
        .map((h) => ({
          platform: h.platform,
          handle: h.handle,
          url: h.profileUrl,
          // Not asserted. The scrape reads follower counts, not badges, and
          // claiming verification we never checked is exactly the kind of
          // detail an impersonated office would be misled by.
          verified: false,
          followers: h.followers,
          connected: false,
        })),
      watchTerms: [...watchTerms, ...(principal.aliases ?? [])],
      /**
       * Provenance, filled in honestly rather than left blank.
       *
       * The name, office and party were researched and then separately verified
       * against the live profiles before anything was scraped, which is what
       * `high` means here. The photo and follower counts were read off the
       * profile page itself, so their origin is `profile-page` — a weaker claim
       * than `stated`, and correctly so: nobody at these offices typed them.
       *
       * Fields nobody established stay absent from both maps. An empty entry
       * says "unknown"; a `low` entry would say "we have a value and doubt it",
       * which is a different and untrue statement.
       */
      confidence: {
        name: 'high',
        role: 'high',
        party: 'high',
        constituency: 'high',
        district: 'high',
        state: 'high',
        handles: 'high',
        ...(principal.handles.some((h) => h.avatarUrl) ? { photoUrl: 'medium' as const } : {}),
      },
      origin: {
        name: 'stated',
        role: 'stated',
        party: 'stated',
        constituency: 'stated',
        district: 'stated',
        state: 'stated',
        handles: 'profile-page',
        ...(principal.handles.some((h) => h.avatarUrl)
          ? { photoUrl: 'profile-page' as const }
          : {}),
      },
      sources: principal.handles
        .filter((h) => !h.failure)
        .map((h) => ({ url: h.profileUrl, label: h.platform })),
      notes: [
        'Example data. These are real public accounts, read once and stored — not a live feed.',
      ],
      resolvedAt: roster.generatedAt,
    },
    onboardedAt: prev.onboardedAt ?? new Date().toISOString(),
    ...buildDemoContent(roster, principalKey),
    // Stamped so the influencer screen does not offer to go and find a roster
    // it already has, and the morning scan does not run against a desk nobody
    // is actually staffing.
    influencersSeededAt: roster.generatedAt,
    influencersReadAt: roster.generatedAt,
    /**
     * Same reason, and it was the one stamp missing — with an expensive
     * consequence.
     *
     * `seedNewsSources` fires whenever an identity exists and this is unset,
     * so switching politician re-armed it every single time: five taps, five
     * grounded searches against a backend the demo does not need, none of
     * whose answers it would keep. The visible symptom was not a slow scan
     * though, it was missing pictures. Those requests can run for half a
     * minute, a browser allows six connections to one host, and the demo's
     * thumbnails and avatars queue behind them — measured at 0 of 14 images
     * loaded after a switch, and 13 of 14 with the same requests cut off.
     *
     * The roster ships its own `sources`, written a few lines above, so there
     * was never anything to go and find.
     */
    newsSourcesSeededAt: roster.generatedAt,
    lastSeenAt: prev.lastSeenAt,
  }))

  return tracked
}

export interface ResolvedRival {
  person: DemoPerson
  why: string
}

/**
 * Everyone this principal is measured against, with the reason for each.
 *
 * Normalises the old single-rival shape into the list, so a dataset built
 * before the rename still resolves rather than throwing. A rival named in the
 * pairings but absent from `people` is dropped: it cannot be scraped, and a
 * column with no account behind it is worse than one fewer column.
 */
export function rivalsOf(roster: DemoRoster, principalKey: string): ResolvedRival[] {
  const pairing = roster.pairings.find((p) => p.principal === principalKey)
  if (!pairing) return []

  const listed: DemoRival[] =
    pairing.rivals ??
    (pairing.rival ? [{ key: pairing.rival, why: pairing.why ?? '' }] : [])

  return listed
    .map((r) => {
      const person = roster.people[r.key]
      return person ? { person, why: r.why } : null
    })
    .filter((x): x is ResolvedRival => x !== null)
}

/** Which principal the reader last chose, so a refresh does not reset it. */
const CHOICE_KEY = 'signal.demo.principal'

export function readChoice(): string | null {
  try {
    return localStorage.getItem(CHOICE_KEY)
  } catch {
    return null
  }
}

export function saveChoice(key: string): void {
  try {
    localStorage.setItem(CHOICE_KEY, key)
  } catch {
    /* private mode or quota; the choice simply will not survive a refresh */
  }
}

/**
 * Leave the demo.
 *
 * The stored choice doubles as the record that the tracked list is seeded
 * rather than the reader's own — which is what stops a returning visitor from
 * being shown a politician's accounts as though they were theirs, and what
 * stops the banner appearing over real work. Clearing it is therefore the whole
 * of "this desk is mine now".
 */
export function clearChoice(): void {
  try {
    localStorage.removeItem(CHOICE_KEY)
  } catch {
    /* nothing to clear, or storage is unavailable; either way the caller
       empties the tracked list itself, which is the part that matters */
  }
}
