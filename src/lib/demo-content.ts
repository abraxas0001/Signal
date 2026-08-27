/**
 * The rest of the demo desk: what the office would be working on.
 *
 * The dashboard runs on scraped posts, which are real. These screens do not:
 * grievances, issues and tasks are what the ANALYSIS pipeline produces after
 * reading news and comments, and nothing we scraped contains them. So this
 * module builds them, and the line it draws matters:
 *
 * WHAT IS REAL. The influencer roster and every mention on it. Those are
 * broadcasters, commentators and fact-checkers with real follower counts, and
 * the mentions are posts they actually published which actually contain a search
 * word for the principal — matched here, in code, not asserted. The tone of each
 * is genuinely unknown: `stance` stays 'unclear' and the briefing shows them
 * under "Not read yet" rather than counting them as neutral, because "nobody has
 * read this" is not a finding of even-handedness.
 *
 * WHAT IS ILLUSTRATIVE. The grievance records and the tasks. These are written
 * here, and they are written under a hard rule: THEY MAKE NO CLAIM ABOUT ANY
 * NAMED PERSON. Every one is a civic service matter — a transformer, a bus
 * route, a hostel roof — addressed to a department, never to a politician.
 * `grievanceType` is never "Allegation" and `target` is never "MP" or "MLA".
 *
 * That rule is not squeamishness. These are real, living politicians. Inventing
 * constituent complaints ABOUT them and rendering those in a product that looks
 * like a monitoring tool would manufacture a record that reads as evidence, and
 * a screenshot of it would outlive any caveat attached to it here. A demo can
 * show how the workflow feels without putting words in a stranger's mouth about
 * a named public figure.
 */

import type {
  ActionItem,
  GrievanceRecord,
  Influencer,
  InfluencerMention,
  IssueCluster,
} from '@shared/grievance'
import type { Topic } from '@shared/taxonomy'
import type { TrackedPersona } from '@/components/Persona'
import { rivalsOf, type DemoCreator, type DemoRoster } from '@/lib/demo-roster'

/* ── the illustrative civic caseload ──────────────────────────────────────── */

interface CivicTemplate {
  headline: string
  excerpt: string
  summary: string
  topic: Topic
  severity: GrievanceRecord['severity']
  grievanceType: GrievanceRecord['grievanceType']
  department: string
  /** What the office would actually do about it. */
  actionTitle: string
  actionDescription: string
}

/**
 * Ordinary constituency work, in the shape every MP's office recognises.
 *
 * Service delivery only, and deliberately mundane. The point of these on screen
 * is to show what triage, ownership and a due date look like when the list is
 * full — not to characterise anybody's performance.
 */
const CIVIC: CivicTemplate[] = [
  {
    headline: 'Transformer at {place} out for four days',
    excerpt:
      'Residents of {place} report the distribution transformer has been out since Sunday, affecting roughly 60 households and two borewells. A replacement was requested at the section office.',
    summary: 'Distribution transformer failure at {place}; replacement requested, not yet fitted.',
    topic: 'Electricity',
    severity: 'High',
    grievanceType: 'Request for service',
    department: 'Electricity Department',
    actionTitle: 'Chase transformer replacement at {place}',
    actionDescription:
      'Call the section officer for a fitting date, and confirm back to the residents who raised it.',
  },
  {
    headline: 'Drinking water supply irregular in {place}',
    excerpt:
      'Supply to {place} has been every third day for the past fortnight against the scheduled alternate-day cycle. Tanker support has been requested for the two wards worst affected.',
    summary: 'Piped supply to {place} running below schedule; tankers requested as interim cover.',
    topic: 'Water & Sanitation',
    severity: 'High',
    grievanceType: 'Complaint',
    department: 'Rural Water Supply',
    actionTitle: 'Arrange tanker cover for {place}',
    actionDescription: 'Confirm the tanker schedule with the RWS engineer and publish it locally.',
  },
  {
    headline: 'Approach road to {place} damaged after rain',
    excerpt:
      'The approach road to {place} has broken up over about 400 metres following last week’s rain, and auto drivers are refusing the route after dark. A patching estimate has been sought.',
    summary: 'Approach road at {place} needs patching; estimate sought from R&B.',
    topic: 'Roads',
    severity: 'Medium',
    grievanceType: 'Request for service',
    department: 'Roads & Buildings',
    actionTitle: 'Get the patching estimate for {place}',
    actionDescription: 'Ask R&B for the estimate and a start date; note it against this record.',
  },
  {
    headline: 'Pension payments delayed for {place} beneficiaries',
    excerpt:
      'Around 40 beneficiaries in {place} report their monthly pension has not been credited this cycle. Most are Asara pensioners drawing through the same branch.',
    summary: 'Pension credits missed for one cycle at {place}; single branch appears common to all.',
    topic: 'Social Welfare / Pensions',
    severity: 'High',
    grievanceType: 'Request for help',
    department: 'Rural Development',
    actionTitle: 'Take the {place} pension list to the MPDO',
    actionDescription: 'Hand over the beneficiary list and get the credit date in writing.',
  },
  {
    headline: 'Hostel roof leaking at the {place} welfare hostel',
    excerpt:
      'Wardens at the {place} social welfare hostel report water entering two dormitories during rain. Around 70 students are accommodated there.',
    summary: 'Roof repair needed at the {place} welfare hostel before the next spell of rain.',
    topic: 'Education',
    severity: 'Medium',
    grievanceType: 'Request for service',
    department: 'Social Welfare',
    actionTitle: 'Raise hostel roof repair for {place}',
    actionDescription: 'Ask the welfare officer for a repair estimate and a date.',
  },
  {
    headline: 'Bus service to {place} withdrawn on the evening run',
    excerpt:
      'The 6.40pm service to {place} has not run for three weeks. Students returning from the junior college are the main users of it.',
    summary: 'Evening bus to {place} suspended; college students affected.',
    topic: 'Transport',
    severity: 'Medium',
    grievanceType: 'Demand for clarification',
    department: 'Road Transport Corporation',
    actionTitle: 'Ask RTC why the {place} evening run stopped',
    actionDescription: 'Get the reason and, if it is crew shortage, a date for restoration.',
  },
  {
    headline: 'PHC at {place} without a second staff nurse',
    excerpt:
      'The primary health centre at {place} has been running with one staff nurse since a transfer in the last cycle. Night deliveries are being referred onward.',
    summary: 'Staff nurse vacancy at the {place} PHC; night cases being referred.',
    topic: 'Health',
    severity: 'Critical',
    grievanceType: 'Request for help',
    department: 'Health & Family Welfare',
    actionTitle: 'Push for the {place} PHC nurse posting',
    actionDescription: 'Write to the DM&HO for a posting against the vacant sanction.',
  },
  {
    headline: 'Crop insurance claims pending for {place} farmers',
    excerpt:
      'Farmers from {place} report claims filed after the unseasonal rain have not been settled. Documentation was submitted through the agriculture extension officer.',
    summary: 'Insurance claims from {place} unsettled; filed through the extension officer.',
    topic: 'Agriculture',
    severity: 'Medium',
    grievanceType: 'Request for help',
    department: 'Agriculture Department',
    actionTitle: 'Follow up {place} insurance claims',
    actionDescription: 'Get a status list from the AEO and identify which are stuck and why.',
  },
]

/**
 * Places, by constituency.
 *
 * Real localities within each seat, so the map and the place chips have
 * something true to plot. The ISSUES attached to them are illustrative; the
 * places themselves are simply where the seat is.
 */
const PLACES: Record<string, string[]> = {
  Mahabubnagar: ['Jadcherla', 'Gadwal', 'Shadnagar', 'Wanaparthy', 'Narayanpet', 'Bhoothpur'],
  Varanasi: ['Ramnagar', 'Sarnath', 'Shivpur', 'Rohania', 'Cantt'],
  'Rae Bareli': ['Bachhrawan', 'Salon', 'Harchandpur', 'Unchahar', 'Lalganj'],
  Kodangal: ['Kosgi', 'Bomraspet', 'Doulatabad', 'Kodangal'],
  Sircilla: ['Vemulawada', 'Konaraopeta', 'Ellanthakunta', 'Rudrangi'],
}

/** Stable pseudo-randomness: the same desk looks the same on every visit. */
function seeded(key: string): () => number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h += 0x6d2b79f5
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString()
}

function inDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString()
}

export interface DemoContent {
  grievances: GrievanceRecord[]
  issues: IssueCluster[]
  actions: ActionItem[]
  influencers: Influencer[]
  mentions: InfluencerMention[]
  /** The people this desk follows through the papers. */
  personas: TrackedPersona[]
}

export function buildDemoContent(roster: DemoRoster, principalKey: string): DemoContent {
  const principal = roster.people[principalKey]
  if (!principal) {
    return { grievances: [], issues: [], actions: [], influencers: [], mentions: [], personas: [] }
  }

  const constituency = principal.office?.constituency ?? ''
  const places = PLACES[constituency] ?? [constituency].filter(Boolean)
  const rand = seeded(principalKey)

  /* ── illustrative caseload ─────────────────────────────────────────────── */

  const grievances: GrievanceRecord[] = []
  const actions: ActionItem[] = []

  CIVIC.forEach((t, i) => {
    const place = places[i % Math.max(places.length, 1)] ?? constituency
    const fill = (s: string) => s.replaceAll('{place}', place)
    /**
     * Some of the caseload has to be from today.
     *
     * The grievance desk opens on a "Today" filter, which is right for a screen
     * somebody checks each morning — but the first version dated every record
     * one to twelve days back, so the demo landed on "Nothing matches these
     * filters. All 8 issues are hidden by them." Eight records, none visible,
     * and the reader's first impression was of an empty product with a bug.
     * Three arrive today; the rest spread back over the fortnight so the
     * earlier-days view has something in it too.
     */
    const age = i < 3 ? 0 : Math.floor(rand() * 12) + 1
    const id = `demo_g_${principalKey}_${i}`

    grievances.push({
      id,
      createdAt: daysAgo(age),
      sourceUrl: '',
      publisher: 'Constituency office intake',
      headline: fill(t.headline),
      publishedAt: daysAgo(age),
      language: 'en',
      excerpt: fill(t.excerpt),
      topic: t.topic,
      subtopic: null,
      constituency,
      places: [place],
      isGrievance: true,
      grievanceType: t.grievanceType,
      severity: t.severity,
      // Addressed to the department that owns the service. NEVER a person, and
      // never the officeholder whose desk this is — see the file header.
      target: 'Specific Department',
      namedPersons: [],
      hashtags: [],
      sentiment: t.severity === 'Critical' || t.severity === 'High' ? 'Negative' : 'Neutral',
      narrativeCategory: 'One-off Complaint',
      summary: fill(t.summary),
      fake: {
        suspicion: 'No',
        type: null,
        debunkStatus: 'Not a misinformation',
        signals: [],
        note: 'Routine service matter reported through the office; nothing to verify.',
      },
      recommendation: {
        action: 'Rapid response through local administration',
        priority: t.severity === 'Critical' ? 'Critical' : t.severity === 'High' ? 'High' : 'Medium',
        talkingPoints: [],
        channel: 'Field visit',
        rationale: 'Service delivery matter for the concerned department.',
      },
    })

    // Roughly two thirds of the caseload has been picked up; the rest is still
    // sitting in the queue, which is what a real desk looks like.
    const picked = i % 3 !== 2
    actions.push({
      id: `demo_a_${principalKey}_${i}`,
      createdAt: daysAgo(age),
      linkedRecordIds: [id],
      // `description` is the line the task list renders, so it carries the
      // instruction — "chase the transformer" — and the detail goes to `notes`.
      // There is no `title` field on an ActionItem; adding one and casting the
      // literal to the type is how a `status: 'Not Started'` reached the screen
      // and crashed it, since only Planned / In Progress / Completed / Declined
      // exist. The casts are gone from this file for that reason.
      description: fill(t.actionTitle),
      department: t.department,
      owner: picked ? 'Constituency office' : null,
      status: i % 4 === 0 ? 'Completed' : picked ? 'In Progress' : 'Planned',
      priority: t.severity === 'Critical' ? 'Critical' : t.severity === 'High' ? 'High' : 'Medium',
      dueAt: inDays(Math.floor(rand() * 10) - 2),
      completedAt: i % 4 === 0 ? daysAgo(Math.max(1, age - 2)) : null,
      escalation: t.severity === 'Critical' ? 'Department' : 'None',
      delayReason: null,
      notes: fill(t.actionDescription),
    })
  })

  /* ── issues: the caseload, clustered by topic ──────────────────────────── */

  const byTopic = new Map<Topic, GrievanceRecord[]>()
  for (const g of grievances) {
    byTopic.set(g.topic, [...(byTopic.get(g.topic) ?? []), g])
  }

  const issues: IssueCluster[] = [...byTopic.entries()].map(([topic, records], i) => ({
    id: `demo_i_${principalKey}_${i}`,
    rank: i + 1,
    title: `${topic} in ${constituency}`,
    category: topic,
    summary: records.map((r) => r.summary).join(' '),
    sentiment: records.some((r) => r.severity === 'Critical' || r.severity === 'High')
      ? 'Negative'
      : 'Neutral',
    severity: records.some((r) => r.severity === 'Critical')
      ? 'Critical'
      : records.some((r) => r.severity === 'High')
        ? 'High'
        : 'Medium',
    constituency,
    places: [...new Set(records.flatMap((r) => r.places))],
    recordIds: records.map((r) => r.id),
    evidenceUrls: [],
    politicalInvolvement: null,
    counterNarrative: null,
  }))

  /* ── influencers and mentions: entirely real ───────────────────────────── */

  const influencers: Influencer[] = []
  const mentions: InfluencerMention[] = []

  /**
   * What counts as "about us".
   *
   * The full name, the seat, the party tag and the native-script spellings —
   * and deliberately NOT the loose tokens of the name.
   *
   * It used to include every token of four characters or more, and that is a
   * surname matcher on a subcontinent of shared surnames. `demo-roster.ts`
   * already knew this and says so where it builds `watchTerms`: "the surname
   * alone is deliberately absent: 'Reddy' and 'Gandhi' would match half of
   * Indian politics and the mention feed would fill with strangers." This
   * function did not get the memo, and strangers is exactly what it filled
   * with. Reproduced against the shipped roster: a news item headlined
   * "Nepal Floods: Hyderabad Woman Suhasini Reddy Missing, Family in Panic"
   * was filed as coverage of a sitting politician, because "reddy".
   *
   * A missing woman is not a mention of a politician who shares her surname.
   * Requiring the whole name costs a few true matches and stops the feed
   * making claims about people who have nothing to do with the office.
   */
  const terms = [
    principal.name,
    constituency,
    principal.partyTag,
    // The native-script spellings. Without them this matched almost nothing:
    // these are Telugu and Hindi feeds, and a Latin-only word list reads a
    // fraction of what is written about somebody in them.
    ...(principal.aliases ?? []),
  ]
    .filter((t) => t.length > 3)
    .map((t) => t.toLowerCase())

  /**
   * Headlines this desk will not republish, whoever they name.
   *
   * A mention carries the headline verbatim as its excerpt, so a fact-check
   * headed "Does Viral Image Show NEET Paper Leak Accused <name> with Rahul
   * Gandhi?" gets rendered as the claim with the debunk stripped off — the
   * precise amplification that publishing a fact-check is meant to prevent.
   * The same rule keeps a named victim, a named missing person and a named
   * accused off a political monitoring board, where the framing alone does
   * them harm regardless of what the story said.
   *
   * A public figure's OWN post is untouched by this: it filters what other
   * accounts said, not what the office published.
   */
  const UNPUBLISHABLE =
    /(accused|arrested|rape|raped|molest|assault|murder|missing|victim|kidnap|pocso|posco|suicide)/i

  /**
   * The accounts that TALK ABOUT this politician — not the ones they run
   * against.
   *
   * Rival politicians stood in here for a while and it was the wrong answer to
   * the question. An influencer watch exists so an office can see what is being
   * SAID about them; a rival's feed shows what the opposition is campaigning
   * on, which is a different thing and already covered by the comparison
   * screens. A screen headed "what people are saying" that listed only people
   * you are running against answered a question nobody asked.
   *
   * So these are broadcasters, digital outlets, commentators and fact-checkers
   * — the accounts whose coverage actually reaches this seat — filtered to the
   * ones relevant to where the desk sits. A Mahabubnagar MP does not need
   * Delhi's national bulletins, and the Prime Minister is not served by a
   * district feed.
   */
  const region: 'telangana' | 'national' =
    principal.office?.state === 'Telangana' ? 'telangana' : 'national'

  const watched: DemoCreator[] = (roster.creators ?? []).filter(
    (c) => c.scope === 'both' || c.scope === region,
  )

  for (const creator of watched) {
    for (const h of creator.handles) {
      if (h.failure) continue
      const influencerId = `demo_inf_${creator.key}_${h.platform}`

      influencers.push({
        id: influencerId,
        platform: h.platform,
        handle: h.handle,
        displayName: creator.name,
        url: h.profileUrl,
        // A broadcaster covers a state, not a seat. Claiming a constituency for
        // one would put it on the map as though it were local to the desk.
        constituency: null,
        followers: h.followers,
        addedAt: roster.generatedAt,
        note: `${creator.kind} · ${creator.language}`,
      })

      for (const post of h.posts) {
        const raw = post.title ?? ''
        const text = raw.toLowerCase()
        if (!text) continue
        if (!terms.some((t) => text.includes(t))) continue
        // Checked after the term match, so the cost is paid only on things that
        // were going to be shown.
        if (UNPUBLISHABLE.test(raw)) continue

        mentions.push({
          id: `demo_m_${influencerId}_${mentions.length}`,
          influencerId,
          postUrl: post.url,
          postedAt: post.publishedAt,
          excerpt: post.title ?? '',
          // A search word matched, in this function, on the post's real text.
          mentionsSubject: true,
          /**
           * A term match DID run, so this is a listing that was checked.
           *
           * `judged: false` is for the other case — a check that ran with no
           * usable search words, where nothing matched and `mentionsSubject`
           * carries no meaning either. Marking these false suppressed them from
           * the briefing entirely, so a desk with forty real posts naming it
           * read "Local-account posts: 0".
           *
           * The tone is still genuinely unknown, and `stance: 'unclear'` now
           * says so on its own: the briefing counts these as posts that name
           * the member, keeps them out of the for/against verdict, and shows
           * them under "Not read yet" rather than as neutral.
           */
          judged: true,
          stance: 'unclear',
          sentiment: 'Neutral',
          fake: null,
          seenAt: roster.generatedAt,
          acknowledged: false,
        })
      }
    }
  }

  /**
   * The people this desk follows through the papers.
   *
   * The principal and the rivals: an office reads the press about itself first,
   * and about the people it contests against second. `lastCheckedAt` is null
   * because nothing has been checked — that is what makes the news screen offer
   * to run rather than showing a scan somebody else supposedly did.
   *
   * The aliases matter more here than anywhere else. A Telugu masthead prints
   * "డి.కె.అరుణ", never "D. K. Aruna", so a search list of Latin spellings finds
   * an empty paper and reports it as a quiet week.
   */
  const followed = [principal, ...rivalsOf(roster, principalKey).map((r) => r.person)]
  const personas: TrackedPersona[] = followed.map((person) => ({
    id: `demo_p_${person.key}`,
    name: person.name,
    aliases: person.aliases ?? [],
    addedAt: roster.generatedAt,
    lastCheckedAt: null,
  }))

  return { grievances, issues, actions, influencers, mentions, personas }
}
