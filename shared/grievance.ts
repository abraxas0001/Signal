import type {
  ActionCategory,
  ActionPriority,
  CommsChannel,
  ConfidenceTier,
  DebunkStatus,
  FakeNewsType,
  FakeSuspicion,
  GrievanceType,
  NarrativeCategory,
  Platform,
  Sentiment,
  Severity,
  Target,
  Topic,
} from './taxonomy'

/**
 * The record types behind the cockpit.
 *
 * These are not invented. The client's workbook already specifies all of this
 * across five sheets — RAW_ENTRIES for intake, FAKE_NEWS for misinformation,
 * ISSUE CLUSTERING for ranking, NARRATIVE INTELLIGENCE for counter-messaging,
 * and Future Tasks for the action tracker with its SLA and escalation columns.
 *
 * Four of those five sheets contain no records at all. They were designed and
 * never filled, because filling them by hand is a full-time job nobody had.
 * That is the whole thesis of this product, and it is why the shapes below
 * follow their columns rather than a design of my own: whatever the office
 * exports has to drop back into the process they already run.
 */

/**
 * Assembly segments this office covers.
 *
 * Seeded from the constituencies that actually appear in the workbook. An
 * office elsewhere adds its own — this is a starting list, not a closed set,
 * which is why the field that uses it is a plain string.
 */
export const CONSTITUENCIES = [
  'Eluru',
  'Nuzvid',
  'Chintalapudi',
  'Kaikalur',
  'Polavaram',
  'Denduluru',
  'Unguturu',
  'Gopalapuram',
] as const

/** Publishers the grievance desk reads. Used to seed the intake screen. */
export const NEWS_SOURCES: { label: string; host: string }[] = [
  { label: 'Eenadu', host: 'eenadu.net' },
  { label: 'Sakshi', host: 'sakshi.com' },
  { label: 'Andhra Jyothy', host: 'andhrajyothy.com' },
  { label: 'NTV Telugu', host: 'ntvtelugu.com' },
  { label: 'V6 Velugu', host: 'v6velugu.com' },
  { label: 'The Hindu', host: 'thehindu.com' },
  { label: 'Times of India', host: 'timesofindia.indiatimes.com' },
]

/**
 * Every assembly segment in Andhra Pradesh, by district.
 *
 * The desk shipped with eight — the home district's — which is fine for one
 * office and useless for anyone else, and wrong even here the moment a story
 * from a neighbouring segment matters. The state has 175.
 *
 * This list is a convenience, not an authority. Segment names get transliterated
 * several ways, boundaries were redrawn when the districts were reorganised, and
 * an office knows its own patch better than a table written elsewhere. So the
 * picker that uses this also accepts anything typed into it: a name missing or
 * spelled differently here costs the operator one keystroke, not the feature.
 */
export const AP_ASSEMBLIES_BY_DISTRICT: { district: string; segments: string[] }[] = [
  { district: 'Srikakulam', segments: ['Ichchapuram', 'Palasa', 'Tekkali', 'Pathapatnam', 'Srikakulam', 'Amadalavalasa', 'Etcherla', 'Narasannapeta', 'Rajam'] },
  { district: 'Parvathipuram Manyam', segments: ['Palakonda', 'Kurupam', 'Parvathipuram', 'Salur'] },
  { district: 'Vizianagaram', segments: ['Bobbili', 'Cheepurupalli', 'Gajapathinagaram', 'Nellimarla', 'Vizianagaram', 'Srungavarapukota'] },
  { district: 'Visakhapatnam', segments: ['Bheemili', 'Visakhapatnam East', 'Visakhapatnam South', 'Visakhapatnam North', 'Visakhapatnam West', 'Gajuwaka', 'Pendurthi'] },
  { district: 'Anakapalli', segments: ['Chodavaram', 'Madugula', 'Anakapalle', 'Elamanchili', 'Payakaraopeta', 'Narsipatnam'] },
  { district: 'Alluri Sitharama Raju', segments: ['Paderu', 'Araku Valley', 'Rampachodavaram'] },
  { district: 'Kakinada', segments: ['Tuni', 'Prathipadu', 'Pithapuram', 'Kakinada Rural', 'Peddapuram', 'Kakinada City', 'Jaggampeta'] },
  { district: 'Konaseema', segments: ['Ramachandrapuram', 'Mummidivaram', 'Amalapuram', 'Razole', 'Gannavaram (Konaseema)', 'Kothapeta', 'Mandapeta', 'P. Gannavaram'] },
  { district: 'East Godavari', segments: ['Rajanagaram', 'Rajahmundry City', 'Rajahmundry Rural', 'Anaparthy', 'Kovvur', 'Nidadavole', 'Gopalapuram'] },
  { district: 'West Godavari', segments: ['Achanta', 'Palacole', 'Narasapuram', 'Bhimavaram', 'Undi', 'Tanuku', 'Tadepalligudem'] },
  { district: 'Eluru', segments: ['Unguturu', 'Denduluru', 'Eluru', 'Polavaram', 'Chintalapudi', 'Nuzvid', 'Kaikalur'] },
  { district: 'Krishna', segments: ['Gudivada', 'Pedana', 'Machilipatnam', 'Avanigadda', 'Pamarru', 'Penamaluru', 'Gannavaram'] },
  { district: 'NTR', segments: ['Tiruvuru', 'Nandigama', 'Jaggayyapeta', 'Mylavaram', 'Vijayawada West', 'Vijayawada Central', 'Vijayawada East'] },
  { district: 'Guntur', segments: ['Tadikonda', 'Mangalagiri', 'Ponnuru', 'Tenali', 'Prathipadu (Guntur)', 'Guntur West', 'Guntur East'] },
  { district: 'Palnadu', segments: ['Pedakurapadu', 'Chilakaluripet', 'Narasaraopet', 'Sattenapalle', 'Vinukonda', 'Gurazala', 'Macherla'] },
  { district: 'Bapatla', segments: ['Vemuru', 'Repalle', 'Bapatla', 'Parchur', 'Addanki', 'Chirala', 'Santhanuthalapadu'] },
  { district: 'Prakasam', segments: ['Darsi', 'Kondapi', 'Markapuram', 'Giddalur', 'Kanigiri', 'Ongole', 'Yerragondapalem'] },
  { district: 'Nellore', segments: ['Kavali', 'Atmakur', 'Kovur', 'Nellore City', 'Nellore Rural', 'Sarvepalli', 'Udayagiri'] },
  { district: 'Tirupati', segments: ['Sullurpeta', 'Venkatagiri', 'Gudur', 'Sri Kalahasti', 'Satyavedu', 'Tirupati', 'Chandragiri'] },
  { district: 'Chittoor', segments: ['Palamaner', 'Kuppam', 'Nagari', 'Gangadhara Nellore', 'Chittoor', 'Puthalapattu', 'Punganur'] },
  { district: 'Annamayya', segments: ['Rajampet', 'Thamballapalle', 'Pileru', 'Madanapalle', 'Rayachoti'] },
  { district: 'YSR Kadapa', segments: ['Badvel', 'Kadapa', 'Pulivendula', 'Kamalapuram', 'Jammalamadugu', 'Proddatur', 'Mydukur'] },
  { district: 'Nandyal', segments: ['Allagadda', 'Srisailam', 'Nandikotkur', 'Banaganapalle', 'Dhone', 'Nandyal', 'Panyam'] },
  { district: 'Kurnool', segments: ['Kurnool', 'Pattikonda', 'Kodumur', 'Yemmiganur', 'Mantralayam', 'Adoni', 'Alur'] },
  { district: 'Anantapur', segments: ['Rayadurg', 'Uravakonda', 'Guntakal', 'Tadpatri', 'Singanamala', 'Anantapur Urban', 'Kalyandurg', 'Raptadu'] },
  { district: 'Sri Sathya Sai', segments: ['Madakasira', 'Hindupur', 'Penukonda', 'Puttaparthi', 'Dharmavaram', 'Kadiri'] },
]

/** Flat list, for search. */
export const ALL_ASSEMBLIES: string[] = AP_ASSEMBLIES_BY_DISTRICT.flatMap((d) => d.segments)

/** Which district a segment sits in, for the portal links and the label. */
export function districtOf(assembly: string): string | null {
  const needle = assembly.trim().toLowerCase()
  return (
    AP_ASSEMBLIES_BY_DISTRICT.find((d) =>
      d.segments.some((s) => s.toLowerCase() === needle),
    )?.district ?? null
  )
}

/**
 * The Telugu spelling of each segment, so a record written in Telugu can be
 * matched to the same assembly as one written in English. Without this an
 * office filing ఏలూరు stories and Eluru stories ends up with two piles.
 *
 * Only the home district is spelled out. Transliterating 175 segments from
 * outside the state is how a tool ends up confidently mislabelling somebody's
 * constituency, so the rest fall back to the English name until an office that
 * works there fills them in.
 */
export const ASSEMBLY_TELUGU: Record<string, string> = {
  Eluru: 'ఏలూరు',
  Nuzvid: 'నూజివీడు',
  Chintalapudi: 'చింతలపూడి',
  Kaikalur: 'కైకలూరు',
  Polavaram: 'పోలవరం',
  Denduluru: 'దెందులూరు',
  Unguturu: 'ఉంగుటూరు',
  Gopalapuram: 'గోపాలపురం',
}

export interface PortalPage {
  label: string
  host: string
  /** The section that carries this district's reporting. */
  url: string
  /**
   * True when we have confirmed the publisher serves a genuinely different
   * page for this district. See the note on DISTRICT_PAGES_ARE_GEO_GATED.
   */
  districtSpecific: boolean
}

/**
 * Both Telugu majors answer their district URLs, and both return byte-identical
 * pages for Eluru, West Godavari and Krishna when fetched from this server —
 * the district edition is served on the reader's location, not the path. In an
 * office in Andhra Pradesh these links open the district's own news; from a
 * datacentre they open the national feed.
 *
 * The distinction matters because it decides who does the work: the office can
 * open these and copy today's district links, but the product cannot crawl them
 * on the office's behalf. Saying so is better than shipping a button that
 * quietly returns national news.
 */
export const DISTRICT_PAGES_ARE_GEO_GATED = true

/**
 * Where each segment's news is published.
 *
 * The district grouping is the desk's own, not an official boundary — segments
 * get redrawn and an office knows its own patch better than a hardcoded table
 * does. It is shown in the interface so a wrong entry is visible rather than
 * silently filtering the wrong stories.
 */
export function portalsFor(assembly: string): PortalPage[] {
  // Both Telugu majors slug their district sections in lower-case with hyphens.
  const district = (districtOf(assembly) ?? 'Eluru').toLowerCase().replace(/\s+/g, '-')
  return [
    {
      label: 'Eenadu',
      host: 'eenadu.net',
      url: `https://www.eenadu.net/telugu-news/districts/${district}`,
      districtSpecific: false,
    },
    {
      label: 'Sakshi',
      host: 'sakshi.com',
      url: `https://www.sakshi.com/telugu-news/andhra-pradesh/${district}`,
      districtSpecific: false,
    },
    {
      label: 'V6 Velugu',
      host: 'v6velugu.com',
      url: 'https://www.v6velugu.com/andhra-pradesh',
      districtSpecific: false,
    },
    {
      label: 'The Hindu',
      host: 'thehindu.com',
      url: 'https://www.thehindu.com/news/national/andhra-pradesh/',
      districtSpecific: false,
    },
  ]
}

/**
 * Words that mean "this story is about our patch".
 *
 * Two kinds, and both are needed. The place words decide whether a story
 * belongs to this desk at all; the subject words decide which pile it goes in.
 * They are suggestions — an office adds the names of its own mandals, which no
 * table shipped from outside could know.
 */
export function suggestedTagsFor(assembly: string): { place: string[]; subject: string[] } {
  const telugu = ASSEMBLY_TELUGU[assembly]
  const district = districtOf(assembly)
  return {
    place: [assembly, telugu, district ? `${district} district` : null]
      .filter((t): t is string => Boolean(t))
      .map((t) => t.trim()),
    subject: [
      'Drinking water',
      'Roads',
      'Power cuts',
      'Drainage',
      'Ration',
      'Pensions',
      'Land / 22A',
      'Hospital',
      'School',
      'Farmers',
    ],
  }
}

/** A person named in a story, with whatever role the story gave them. */
export interface NamedPerson {
  name: string
  role: string | null
}

/**
 * One piece of evidence about whether something is fabricated.
 *
 * Deliberately not a verdict. There is no reliable classifier for "was this
 * video generated by AI", and accuracy collapses further on the compressed
 * re-uploads that actually circulate here — so the product assembles signals
 * and a person decides. The workbook models it the same way, with a
 * "Verification Status" and a human "Debunk Source", and its own vocabulary
 * includes "Under Review".
 */
export interface FakeSignal {
  kind: 'provenance' | 'recirculation' | 'source' | 'consistency' | 'corroboration'
  /** What was observed, in plain language. */
  finding: string
  confidence: ConfidenceTier
  /** Which way this one signal points. Signals may disagree; that is useful. */
  supports: 'authentic' | 'fabricated' | 'inconclusive'
}

export interface FakeAssessment {
  suspicion: FakeSuspicion
  type: FakeNewsType | null
  debunkStatus: DebunkStatus
  signals: FakeSignal[]
  /** Why the reviewer should look, or why they need not. */
  note: string | null
}

/** What the office should do about a record. The workbook's section F and I. */
export interface Recommendation {
  action: ActionCategory
  priority: ActionPriority
  /** Two to four lines the MLA can actually say. */
  talkingPoints: string[]
  channel: CommsChannel
  rationale: string
}

/**
 * One news item, classified. This is RAW_ENTRIES, filled by the model rather
 * than by an associate typing at midnight.
 */
export interface GrievanceRecord {
  id: string
  createdAt: string
  /** Where it came from, and what we managed to read of it. */
  sourceUrl: string
  publisher: string | null
  headline: string
  publishedAt: string | null
  language: string | null
  excerpt: string

  topic: Topic
  subtopic: string | null
  constituency: string | null
  /** Villages, mandals, wards named in the story. Drives the heat view. */
  places: string[]
  isGrievance: boolean
  grievanceType: GrievanceType
  severity: Severity
  target: Target
  namedPersons: NamedPerson[]
  hashtags: string[]
  sentiment: Sentiment
  narrativeCategory: NarrativeCategory | null
  summary: string

  fake: FakeAssessment
  recommendation: Recommendation
}

/**
 * Records grouped into an issue. The ISSUE CLUSTERING sheet, generated.
 *
 * Ranking is by volume, severity and recency together — one furious post about
 * a pothole is not the week's top issue, and forty calm ones about water are.
 */
export interface IssueCluster {
  id: string
  rank: number
  title: string
  category: Topic
  summary: string
  sentiment: Sentiment
  severity: Severity
  constituency: string | null
  places: string[]
  recordIds: string[]
  evidenceUrls: string[]
  /** Whether political actors are driving it, and who. */
  politicalInvolvement: string | null
  /** What to say back, from NARRATIVE INTELLIGENCE. */
  counterNarrative: string | null
}

export const ACTION_STATUSES = ['Planned', 'In Progress', 'Completed', 'Declined'] as const
export type ActionStatus = (typeof ACTION_STATUSES)[number]

export const ESCALATION_LEVELS = ['None', 'Officer', 'Department', 'Minister'] as const
export type EscalationLevel = (typeof ESCALATION_LEVELS)[number]

/**
 * A finding turned into someone's job, with a clock on it.
 *
 * This is the Future Tasks sheet, and it is the difference between an app that
 * monitors and one that runs an office.
 */
/**
 * One thing somebody actually has to do, and where.
 *
 * An action used to be a paragraph in a notes field: "Suggested channel:
 * Official Facebook page" buried under a rationale, with the lines to say
 * further down again. Nobody works from a paragraph — they work from a list
 * they can tick, and the two questions they need answered per line are what to
 * say and where to say it.
 */
export interface ActionStep {
  id: string
  text: string
  /**
   * Where this is carried out. From COMMS_CHANNELS, which is already the
   * vocabulary the reader assigns — "Official Facebook page", "Local press",
   * "Field visit". Null when the step is not a communication.
   */
  channel: string | null
  done: boolean
  /** When it was ticked, so a finished action can say when it finished. */
  doneAt: string | null
}

export interface ActionItem {
  id: string
  /**
   * The steps that make this up, each tickable.
   *
   * Optional because every action filed before this existed has none, and a
   * migration that invented steps for them would be putting words in the
   * office's mouth. Those keep working from `description` and `notes`.
   */
  steps?: ActionStep[]
  createdAt: string
  linkedRecordIds: string[]
  description: string
  department: string | null
  owner: string | null
  status: ActionStatus
  priority: ActionPriority
  /** The promise. Breaching it is what the escalation column exists for. */
  dueAt: string | null
  completedAt: string | null
  escalation: EscalationLevel
  delayReason: string | null
  notes: string | null
}

/** A page worth watching in a constituency. */
export interface Influencer {
  id: string
  platform: Platform
  handle: string
  displayName: string | null
  url: string
  constituency: string | null
  followers: number | null
  addedAt: string
  /** Why this page is on the list. */
  note: string | null
}

/** Something an influencer said that mentions the office. */
export interface InfluencerMention {
  id: string
  influencerId: string
  postUrl: string
  postedAt: string | null
  excerpt: string
  /** Whether it is actually about the subject, or merely nearby. */
  mentionsSubject: boolean
  stance: 'supportive' | 'critical' | 'neutral' | 'unclear'
  sentiment: Sentiment
  fake: FakeAssessment | null
  seenAt: string
  /** Cleared by a person, so it stops appearing in the digest. */
  acknowledged: boolean
}

/** Who this installation is watching on behalf of. */
export interface OfficeProfile {
  /** The MLA or office this cockpit belongs to. */
  subject: string
  constituency: string
  /** Words that mean "this is about us" when they appear in someone's post. */
  watchTerms: string[]
  /**
   * Where the desk works and which mastheads it reads. Optional because a
   * profile written before the scanner existed will not have them, and an
   * office that only ever pastes links never needs them.
   */
  state?: string
  /**
   * The district whose edition the news scan should read.
   *
   * Distinct from `constituency` and load-bearing. Publishers issue editions by
   * district, never by assembly segment, so `indexUrlFor` handed a constituency
   * finds no district route and silently returns the state page instead. A
   * Gadwal desk was therefore scanning the whole of Telangana — the district
   * editions its own setup screen had just promised it were never fetched, and
   * nothing anywhere reported a problem.
   */
  district?: string
  /** Labels from PORTALS in shared/regions.ts. */
  portals?: string[]
  /** Index pages the office added itself. */
  customPortalUrls?: string[]
}

/** Severity and priority both sort high-first; one comparator for both. */
export const bySeverityThenRecency = (
  rank: Record<string, number>,
  a: { severity: string; createdAt: string },
  b: { severity: string; createdAt: string },
): number =>
  (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0) ||
  Date.parse(b.createdAt) - Date.parse(a.createdAt)
