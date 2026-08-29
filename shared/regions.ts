/**
 * Where a desk works, and who publishes there.
 *
 * The first version of this shipped the eight assembly segments of one district
 * and nothing else, so an operator searching for Hyderabad found nothing —
 * Hyderabad is in Telangana, and the list did not know Telangana existed. A
 * cockpit that only works for the office it was demoed to is a demo.
 *
 * So the region is chosen in two steps, state then city, which is how people
 * actually describe where they work.
 *
 * ACCURACY, STATED PLAINLY: the two Telugu states are listed district by
 * district because that is the patch this product was built for. Everywhere
 * else carries major cities rather than a full district roll — enough to get a
 * desk running, not a claim to be the register. Every picker that reads this
 * also accepts free text, so a missing or differently-spelled name costs a
 * keystroke rather than blocking the work.
 */

export interface Region {
  state: string
  /** Districts for the Telugu states; major cities elsewhere. */
  cities: string[]
  /** True when this is a full district roll rather than a sample of cities. */
  complete: boolean
  /**
   * The languages this state's OWN press publishes in.
   *
   * Not "languages read here", which is a wider and less useful list. Punjab
   * reads four Hindi dailies and its own press is Punjabi; the distinction is
   * the whole point of the field.
   *
   * Added because "not English" had been standing in for "the local language"
   * when a desk's opening set was picked, and the two are not the same thing.
   * Four Hindi dailies publish a Maharashtra section and no Marathi masthead
   * publishes a section path at all, so a Pune office was handed Amar Ujala,
   * Dainik Bhaskar, Hindustan and Dainik Jagran ahead of Loksatta and Sakal.
   * Every one of those is a real newspaper and not one is what Pune reads over
   * breakfast. The Hindi titles are still offered; they are ranked as what they
   * are, which is outside press with a page for the state.
   *
   * Only languages `PortalLanguage` can name are listed, so Goa carries Marathi
   * and not Konkani. That is a gap in the union rather than a claim about Goa,
   * and it costs nothing today because no Konkani masthead is on file.
   */
  languages: PortalLanguage[]
}

export const REGIONS: Region[] = [
  {
    state: 'Andhra Pradesh',
    complete: true,
    languages: ['Telugu'],
    cities: [
      'Srikakulam', 'Parvathipuram Manyam', 'Vizianagaram', 'Visakhapatnam', 'Anakapalli',
      'Alluri Sitharama Raju', 'Kakinada', 'Konaseema', 'East Godavari', 'West Godavari',
      'Eluru', 'Krishna', 'NTR', 'Guntur', 'Palnadu', 'Bapatla', 'Prakasam', 'Nellore',
      'Tirupati', 'Chittoor', 'Annamayya', 'YSR Kadapa', 'Nandyal', 'Kurnool', 'Anantapur',
      'Sri Sathya Sai',
    ],
  },
  {
    state: 'Telangana',
    complete: true,
    languages: ['Telugu'],
    cities: [
      'Hyderabad', 'Rangareddy', 'Medchal-Malkajgiri', 'Sangareddy', 'Vikarabad', 'Siddipet',
      'Medak', 'Kamareddy', 'Nizamabad', 'Jagtial', 'Rajanna Sircilla', 'Karimnagar',
      'Peddapalli', 'Jayashankar Bhupalpally', 'Mulugu', 'Bhadradri Kothagudem', 'Khammam',
      'Mahabubabad', 'Warangal', 'Hanamkonda', 'Janagaon', 'Yadadri Bhuvanagiri', 'Nalgonda',
      'Suryapet', 'Nagarkurnool', 'Wanaparthy', 'Jogulamba Gadwal', 'Mahabubnagar',
      'Narayanpet', 'Adilabad', 'Nirmal', 'Mancherial', 'Komaram Bheem Asifabad',
    ],
  },
  { state: 'Karnataka', complete: false, languages: ['Kannada'], cities: ['Bengaluru', 'Mysuru', 'Hubballi', 'Mangaluru', 'Belagavi', 'Kalaburagi', 'Ballari', 'Davanagere', 'Shivamogga', 'Tumakuru'] },
  { state: 'Tamil Nadu', complete: false, languages: ['Tamil'], cities: ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Erode', 'Vellore', 'Thoothukudi', 'Thanjavur'] },
  { state: 'Maharashtra', complete: false, languages: ['Marathi'], cities: ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Aurangabad', 'Solapur', 'Kolhapur', 'Amravati', 'Thane', 'Navi Mumbai'] },
  { state: 'Kerala', complete: false, languages: ['Malayalam'], cities: ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam', 'Kannur', 'Alappuzha', 'Palakkad'] },
  { state: 'Odisha', complete: false, languages: ['Odia'], cities: ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur', 'Puri'] },
  { state: 'Delhi', complete: false, languages: ['Hindi'], cities: ['New Delhi', 'North Delhi', 'South Delhi', 'East Delhi', 'West Delhi'] },
  { state: 'Uttar Pradesh', complete: false, languages: ['Hindi'], cities: ['Lucknow', 'Kanpur', 'Varanasi', 'Prayagraj', 'Agra', 'Meerut', 'Noida', 'Ghaziabad', 'Gorakhpur'] },
  { state: 'West Bengal', complete: false, languages: ['Bengali'], cities: ['Kolkata', 'Howrah', 'Siliguri', 'Durgapur', 'Asansol'] },
  { state: 'Gujarat', complete: false, languages: ['Gujarati'], cities: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Gandhinagar'] },
  { state: 'Rajasthan', complete: false, languages: ['Hindi'], cities: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer', 'Bikaner'] },
  { state: 'Madhya Pradesh', complete: false, languages: ['Hindi'], cities: ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Ujjain'] },
  { state: 'Bihar', complete: false, languages: ['Hindi'], cities: ['Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Darbhanga'] },
  { state: 'Punjab', complete: false, languages: ['Punjabi'], cities: ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Mohali'] },
  { state: 'Haryana', complete: false, languages: ['Hindi'], cities: ['Gurugram', 'Faridabad', 'Panipat', 'Ambala', 'Hisar'] },
  { state: 'Assam', complete: false, languages: ['Assamese'], cities: ['Guwahati', 'Dibrugarh', 'Silchar', 'Jorhat'] },
  { state: 'Jharkhand', complete: false, languages: ['Hindi'], cities: ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro'] },
  { state: 'Chhattisgarh', complete: false, languages: ['Hindi'], cities: ['Raipur', 'Bhilai', 'Bilaspur', 'Korba'] },
  { state: 'Uttarakhand', complete: false, languages: ['Hindi'], cities: ['Dehradun', 'Haridwar', 'Haldwani', 'Roorkee'] },
  { state: 'Himachal Pradesh', complete: false, languages: ['Hindi'], cities: ['Shimla', 'Dharamshala', 'Mandi', 'Solan'] },
  // Konkani is the state language and no Konkani masthead is on file, so this
  // names the other language a Goan desk reads rather than leaving it empty.
  { state: 'Goa', complete: false, languages: ['Marathi'], cities: ['Panaji', 'Margao', 'Vasco da Gama'] },
]

export const ALL_STATES: string[] = REGIONS.map((r) => r.state)

export function citiesOf(state: string): string[] {
  return REGIONS.find((r) => r.state === state)?.cities ?? []
}

/**
 * The languages a desk in this state reads, or an empty list for a place the
 * region roll does not carry.
 *
 * Empty is the honest answer for free text: the pickers all accept a state
 * nobody has listed here, and guessing a language from a name we do not
 * recognise would be worse than saying nothing. A caller that gets nothing back
 * should treat every masthead as non-local rather than treat every masthead as
 * local.
 */
export function languagesOf(state: string | null): PortalLanguage[] {
  if (!state) return []
  return REGIONS.find((r) => r.state === state)?.languages ?? []
}

export function stateOfCity(city: string): string | null {
  const needle = city.trim().toLowerCase()
  return REGIONS.find((r) => r.cities.some((c) => c.toLowerCase() === needle))?.state ?? null
}

/* ── portals ──────────────────────────────────────────────────────────────── */

/**
 * The languages the mastheads below publish in.
 *
 * This union was three wide — Telugu, English, Hindi — and the office said so
 * twice: "the number of news portal is very low pls add much more and regional
 * newspapers as well". A desk in a Marathi, Odia or Assamese district was being
 * handed the national English press and nothing its own voters read.
 */
export type PortalLanguage =
  | 'Telugu'
  | 'English'
  | 'Hindi'
  | 'Tamil'
  | 'Kannada'
  | 'Malayalam'
  | 'Marathi'
  | 'Bengali'
  | 'Gujarati'
  | 'Odia'
  | 'Punjabi'
  | 'Assamese'

/**
 * What sort of publisher this is, where it changes how a desk should read it.
 *
 * Absent means an ordinary newsroom, which is what all but a handful of these
 * are, so the field only appears where the answer is not "a newspaper or a
 * channel".
 *
 * The two named kinds behave differently enough to be worth separating. A wire
 * agency files everything for everybody: PTI's index is the whole country's
 * news, so it is a fine safety net and a poor first choice for an office that
 * has four papers printed in its own district. A fact-check desk is narrower
 * still: it publishes only when a claim is already circulating, which is
 * exactly what a member's office wants on the day a rumour starts and nothing
 * at all on the other three hundred days.
 *
 * `planPortals` reads this to keep both out of a desk's opening set unless
 * there is room after the local press. Without the field they sort as ordinary
 * national mastheads and quietly take slots from the papers that carry mandal
 * news.
 */
export type PortalKind = 'agency' | 'factcheck'

export interface NewsPortal {
  label: string
  host: string
  /** The page Signal reads to find today's stories. */
  indexUrl: string
  language: PortalLanguage
  /** A wire agency or a fact-check desk. Absent for an ordinary newsroom. */
  kind?: PortalKind
  /**
   * Which states this masthead actually covers. 'all' for national papers.
   *
   * This is the field that answers the reported bug: a desk set to Uttar
   * Pradesh / Varanasi was handed a scan full of Pune stories, because the
   * portal list did not record who a masthead is for. Nothing here claims a
   * state whose section or edition was not fetched and found to carry
   * articles, so a Varanasi desk is never offered a Maharashtra paper at all,
   * and the national mastheads that are offered resolve to a UP page.
   */
  states: string[] | 'all'
  /**
   * The publisher's RSS feed for `indexUrl`.
   *
   * THIS IS THE OPEN-SOURCE ROUTE THE OFFICE ASKED ABOUT — "if u have any open
   * source to cover regional news use that as well". Most Indian papers still
   * publish RSS: an open, machine-readable format the publisher maintains on
   * purpose, so it is far steadier than scraping an index whose markup changes
   * without warning, and it is a few kilobytes instead of a megabyte of
   * homepage. On an entry that is not marked `unverified`, every feed named
   * here was fetched and parsed as RSS or Atom, and a masthead with no `rssUrl`
   * is one whose feed we looked for and could not find rather than one we did
   * not try. On an `unverified` entry neither claim holds; see that field.
   */
  rssUrl?: string
  /**
   * True when nobody has fetched this masthead's index or feed from this
   * codebase yet.
   *
   * The registry's older entries were each read before they were added, which
   * is what lets the comment above promise that a missing `rssUrl` means a feed
   * that does not exist. The batch added when the office asked for "most news
   * portal we can" was assembled from the mastheads an Indian political desk
   * reads, not from a crawl, so the address may be right and the exact section
   * path may not be.
   *
   * Marking them is the difference between a list and a claim. A reader of this
   * file can see which rows are evidence and which are intent; `planPortals`
   * ranks a checked masthead above an unchecked one at equal footing, so a
   * desk's opening set is drawn from sources known to answer; and a dead entry
   * shows up as a named error in the scan's per-source report rather than as a
   * quiet morning. Clear the flag on an entry once it has been fetched and seen
   * to return stories.
   */
  unverified?: true
  /**
   * When a publisher slugs its sections by district, the template that builds
   * one. Signal still reads the generic index if the district page turns out to
   * be the same page — several publishers serve the district edition on the
   * reader's location rather than the path.
   *
   * The state is passed because the Telugu mastheads nest districts under the
   * state, not at the root: Khammam lives under /telangana/ and Eluru under
   * /andhra-pradesh/. It is null when the operator typed a place the region
   * list does not know, in which case the portal picks its own default.
   *
   * Returns null when this publisher prints no edition for that district, so
   * the caller falls back to the state index instead of a page that is gone.
   */
  districtPath?: (districtSlug: string, state: string | null) => string | null
  /**
   * For a national masthead, the section carrying one state's news. Returns
   * null when the publisher has no section for that state, so the caller can
   * fall back to the general index rather than request a 404.
   */
  statePath?: (state: string) => string | null
  /**
   * The feed carrying one state's news, where the publisher splits its RSS by
   * state. Same contract as `statePath`: null means this publisher has no feed
   * for that state, not that the state is unknown.
   */
  stateFeed?: (state: string) => string | null
}

const slug = (s: string): string => s.toLowerCase().replace(/\s+/g, '-')

/**
 * A lookup that answers null rather than undefined, because that is what the
 * statePath and stateFeed contracts promise for a state a publisher does not
 * carry, and `indexUrlFor` tests the result for null.
 */
const from =
  (map: Record<string, string>) =>
  (state: string): string | null =>
    map[state] ?? null

/**
 * The two Telugu mastheads file districts under the state segment, and both
 * cover exactly Andhra Pradesh and Telangana. When the state is unknown —
 * because the operator typed a place the region list does not carry — Andhra
 * Pradesh is the default, which is the state this product's desk sits in.
 */
const teluguStateSegment = (state: string | null): string =>
  state === 'Telangana' ? 'telangana' : 'andhra-pradesh'

const TELUGU_STATES = ['Andhra Pradesh', 'Telangana']

const SOUTHERN_STATES = ['Andhra Pradesh', 'Telangana', 'Tamil Nadu', 'Karnataka', 'Kerala']

/**
 * The states a Hindi masthead without state sections is actually read in.
 *
 * A Hindi channel is not "national" in the sense that matters to a desk: it is
 * no use to a Kozhikode office, and marking it `states: 'all'` is exactly how a
 * Kerala operator ends up scanning Hindi politics. These are the states whose
 * desks a Hindi outlet genuinely serves.
 */
const HINDI_BELT = [
  'Uttar Pradesh', 'Bihar', 'Jharkhand', 'Rajasthan', 'Madhya Pradesh', 'Chhattisgarh',
  'Haryana', 'Punjab', 'Himachal Pradesh', 'Uttarakhand', 'Delhi',
]

/**
 * Which districts each Telugu masthead actually prints an edition for.
 *
 * A newspaper edition is not a district. Both papers group several of the 2022
 * districts into one edition and print none at all for the smallest, so asking
 * for every district by name sends a third of the state's desks to a dead page:
 * Eenadu answers /telangana/districts/mulugu with its "410 gone" page, and
 * Sakshi bounces the ones it lacks to its homepage — both under HTTP 200, so
 * nothing downstream can tell the difference. These lists were produced by
 * fetching every district of both states against both publishers and keeping
 * the ones that landed on a real district page.
 *
 * A district missing here is not an error, it is a district the paper does not
 * cover; the desk gets that publisher's state index instead, which carries real
 * news. Publishers do redraw editions, so treat this as a dated snapshot.
 */
const EDITIONS: Record<string, Record<string, readonly string[]>> = {
  Eenadu: {
    'Andhra Pradesh': [
      'Alluri Sitharama Raju', 'Anakapalli', 'Anantapur', 'Bapatla', 'Chittoor', 'East Godavari',
      'Eluru', 'Guntur', 'Kakinada', 'Konaseema', 'Krishna', 'Kurnool', 'Nandyal', 'Nellore',
      'Palnadu', 'Prakasam', 'Srikakulam', 'Tirupati', 'Visakhapatnam', 'Vizianagaram',
      'West Godavari', 'YSR Kadapa',
    ],
    Telangana: [
      'Adilabad', 'Hyderabad', 'Karimnagar', 'Khammam', 'Mahabubnagar', 'Medak', 'Nalgonda',
      'Nizamabad', 'Warangal',
    ],
  },
  Sakshi: {
    'Andhra Pradesh': [
      'Annamayya', 'Bapatla', 'Chittoor', 'Eluru', 'Guntur', 'Kakinada', 'Konaseema', 'Krishna',
      'Kurnool', 'NTR', 'Palnadu', 'Parvathipuram Manyam', 'Prakasam', 'Srikakulam', 'Tirupati',
      'Visakhapatnam', 'Vizianagaram',
    ],
    Telangana: [
      'Adilabad', 'Hyderabad', 'Jagtial', 'Kamareddy', 'Karimnagar', 'Khammam', 'Mahabubabad',
      'Mahabubnagar', 'Mancherial', 'Medak', 'Nagarkurnool', 'Nalgonda', 'Nirmal', 'Nizamabad',
      'Peddapalli', 'Sangareddy', 'Siddipet', 'Suryapet', 'Vikarabad', 'Wanaparthy', 'Warangal',
    ],
  },
}

/** Does this masthead print an edition for this district? Slug-compared, so
 * the caller's spelling and capitalisation do not matter. */
const hasEdition = (portal: string, state: string | null, districtSlug: string): boolean => {
  const byState = EDITIONS[portal]
  if (!byState) return false
  const list = byState[state ?? 'Andhra Pradesh']
  return list ? list.some((d) => slug(d) === districtSlug) : false
}

/**
 * The Hindu's per-state sections, confirmed by fetching every one of them.
 * Delhi is the exception: /news/national/delhi/ is a 404 and the capital is
 * filed under cities instead, with a capitalised segment the site preserves.
 */
const HINDU_SECTIONS: Record<string, string> = {
  Delhi: 'https://www.thehindu.com/news/cities/Delhi/',
}

/**
 * Times of India's city pages, keyed by the district slug this app produces.
 *
 * Only the cities listed here answer. TOI files Prayagraj under "allahabad",
 * Bengaluru under "bangalore" and Tiruchirappalli under "trichy", and it has no
 * page at all for Belagavi, Rajahmundry or YSR Kadapa — asking for the district
 * name we display would have sent those desks to a 404, so the mapping is
 * explicit and was built by fetching every city in REGIONS against /city/.
 *
 * Fair warning on yield: these pages build their story list in JavaScript, so a
 * server-side read finds six or seven links where a reader sees fifty. It is
 * still the desk's own city rather than the national front, which is the point.
 */
const TOI_CITIES: Record<string, string> = {
  agra: 'agra', ahmedabad: 'ahmedabad', ajmer: 'ajmer', amritsar: 'amritsar',
  aurangabad: 'aurangabad', bengaluru: 'bangalore', bhopal: 'bhopal',
  bhubaneswar: 'bhubaneswar', chennai: 'chennai', coimbatore: 'coimbatore',
  cuttack: 'cuttack', dehradun: 'dehradun', erode: 'erode', faridabad: 'faridabad',
  ghaziabad: 'ghaziabad', gurugram: 'gurgaon', guwahati: 'guwahati', hubballi: 'hubli',
  hyderabad: 'hyderabad', indore: 'indore', jaipur: 'jaipur', jamshedpur: 'jamshedpur',
  jodhpur: 'jodhpur', kanpur: 'kanpur', kochi: 'kochi', kolhapur: 'kolhapur',
  kolkata: 'kolkata', kozhikode: 'kozhikode', lucknow: 'lucknow', ludhiana: 'ludhiana',
  madurai: 'madurai', mangaluru: 'mangalore', meerut: 'meerut', mumbai: 'mumbai',
  mysuru: 'mysuru', nagpur: 'nagpur', nashik: 'nashik', 'navi-mumbai': 'navi-mumbai',
  noida: 'noida', patna: 'patna', prayagraj: 'allahabad', pune: 'pune', raipur: 'raipur',
  rajkot: 'rajkot', ranchi: 'ranchi', salem: 'salem', shimla: 'shimla', surat: 'surat',
  thane: 'thane', thiruvananthapuram: 'thiruvananthapuram', tiruchirappalli: 'trichy',
  udaipur: 'udaipur', vadodara: 'vadodara', varanasi: 'varanasi',
  visakhapatnam: 'visakhapatnam',
}

/**
 * Dainik Bhaskar's local editions. Uttar Pradesh is absent on purpose:
 * /local/up/ is a 404 under every spelling tried, so a UP desk gets Bhaskar's
 * front page instead of a dead section — and its own Hindi papers besides.
 */
const BHASKAR_SECTIONS: Record<string, string> = {
  'Madhya Pradesh': 'mp', Rajasthan: 'rajasthan', Chhattisgarh: 'chhattisgarh',
  Bihar: 'bihar', Jharkhand: 'jharkhand', Haryana: 'haryana', Punjab: 'punjab',
  Uttarakhand: 'uttarakhand', 'Himachal Pradesh': 'himachal', Delhi: 'delhi-ncr',
  Maharashtra: 'maharashtra', Gujarat: 'gujarat',
}

/**
 * Amar Ujala's state sections. The southern states are left out although
 * /karnataka and /kerala return 200: they redirect to /tags/<state>, which is a
 * keyword archive rather than an edition, and a desk deserves the difference.
 */
const AMAR_UJALA_STATES = [
  'Uttar Pradesh', 'Bihar', 'Jharkhand', 'Rajasthan', 'Madhya Pradesh', 'Chhattisgarh',
  'Haryana', 'Punjab', 'Himachal Pradesh', 'Uttarakhand', 'Delhi', 'Maharashtra',
  'West Bengal', 'Gujarat', 'Goa',
]

/** Dainik Jagran's state sections. Delhi is missing because /delhi is a 404 —
 * the paper files the capital under its NCR city pages instead. */
const JAGRAN_STATES = [
  'Uttar Pradesh', 'Bihar', 'Jharkhand', 'Rajasthan', 'Madhya Pradesh', 'Chhattisgarh',
  'Haryana', 'Punjab', 'Himachal Pradesh', 'Uttarakhand', 'West Bengal', 'Maharashtra',
  'Gujarat',
]

/** Hindustan (livehindustan.com) prints a section and a feed for each of these
 * and 404s on the rest, which is a fair description of its footprint. */
const HINDUSTAN_STATES = [
  'Uttar Pradesh', 'Bihar', 'Jharkhand', 'Rajasthan', 'Madhya Pradesh', 'Chhattisgarh',
  'Haryana', 'Punjab', 'Uttarakhand', 'Himachal Pradesh', 'West Bengal', 'Maharashtra',
  'Gujarat', 'Odisha',
]

const NIE_STATES = [...SOUTHERN_STATES, 'Odisha']

export const PORTALS: NewsPortal[] = [
  /* ── Telugu ─────────────────────────────────────────────────────────────── */
  {
    label: 'Eenadu',
    host: 'eenadu.net',
    indexUrl: 'https://www.eenadu.net/andhra-pradesh/districts',
    language: 'Telugu',
    states: TELUGU_STATES,
    districtPath: (d, state) =>
      hasEdition('Eenadu', state, d)
        ? `https://www.eenadu.net/${teluguStateSegment(state)}/districts/${d}`
        : null,
    statePath: (state) =>
      EDITIONS['Eenadu']?.[state]
        ? `https://www.eenadu.net/${teluguStateSegment(state)}/districts`
        : null,
  },
  {
    label: 'Sakshi',
    host: 'sakshi.com',
    indexUrl: 'https://www.sakshi.com/andhra-pradesh',
    language: 'Telugu',
    states: TELUGU_STATES,
    rssUrl: 'https://www.sakshi.com/rss.xml',
    districtPath: (d, state) =>
      hasEdition('Sakshi', state, d) ? `https://www.sakshi.com/${teluguStateSegment(state)}/${d}` : null,
    statePath: (state) =>
      EDITIONS['Sakshi']?.[state] ? `https://www.sakshi.com/${teluguStateSegment(state)}` : null,
  },
  {
    label: 'Andhra Jyothy',
    host: 'andhrajyothy.com',
    indexUrl: 'https://www.andhrajyothy.com/andhra-pradesh',
    language: 'Telugu',
    states: TELUGU_STATES,
    // This masthead claims both Telugu states but its `indexUrl` is the Andhra
    // Pradesh section, so without this every Telangana desk — Hyderabad,
    // Khammam, Warangal, all 33 — was handed a page of Andhra Pradesh district
    // links. Same shape as the Varanasi/Pune bug this list exists to stop, one
    // state pair over. Both sections were fetched: /telangana answers 200 and
    // carries /telangana/<district> links, /andhra-pradesh carries
    // /andhra-pradesh/<district> ones. No districtPath, because this publisher
    // exposes no per-district page worth routing to.
    statePath: (state) =>
      TELUGU_STATES.includes(state)
        ? `https://www.andhrajyothy.com/${teluguStateSegment(state)}`
        : null,
  },
  {
    /*
     * V6 Velugu was dropped from this list once, and it is back because both
     * reasons it was dropped for have gone.
     *
     * It files every article at the site root — /cm-revanth-unveils-sarvai-
     * papanna-goud-statue-on-tank-bund — and the scanner used to require a link
     * two segments deep, so every read of its index found nothing at all.
     * `looksLikeArticle` now accepts a single segment carrying four hyphens or
     * more, which that address does. The scan also reads `rssUrl` in preference
     * to the index, so the feed is what will actually be fetched.
     *
     * Scoped to Telangana alone rather than both Telugu states: this is a
     * Telangana channel, and an Andhra Pradesh desk offered it would be reading
     * somebody else's assembly.
     */
    label: 'V6 Velugu',
    host: 'v6velugu.com',
    indexUrl: 'https://www.v6velugu.com/',
    language: 'Telugu',
    states: ['Telangana'],
    rssUrl: 'https://www.v6velugu.com/feed/',
  },
  {
    label: 'NTV Telugu',
    host: 'ntvtelugu.com',
    indexUrl: 'https://www.ntvtelugu.com/',
    language: 'Telugu',
    states: TELUGU_STATES,
    rssUrl: 'https://www.ntvtelugu.com/feed/',
  },
  {
    label: 'Namasthe Telangana',
    host: 'ntnews.com',
    indexUrl: 'https://www.ntnews.com/',
    language: 'Telugu',
    // Both Telugu states before, which was never true: this paper prints no
    // Andhra Pradesh edition, and the claim cost it as much as it cost an
    // Andhra desk. A masthead serving one state has more of every page about
    // that state, and the planner scores it accordingly, so declaring two
    // states pushed the largest Telangana daily below a channel that publishes
    // for both.
    states: ['Telangana'],
    rssUrl: 'https://www.ntnews.com/feed',
  },
  {
    label: '10TV',
    host: '10tv.in',
    indexUrl: 'https://10tv.in/',
    language: 'Telugu',
    states: TELUGU_STATES,
    rssUrl: 'https://10tv.in/feed/',
  },
  {
    label: 'TV9 Telugu',
    host: 'tv9telugu.com',
    indexUrl: 'https://tv9telugu.com/',
    language: 'Telugu',
    states: TELUGU_STATES,
    rssUrl: 'https://tv9telugu.com/feed',
  },
  {
    label: 'HMTV',
    host: 'hmtvlive.com',
    indexUrl: 'https://www.hmtvlive.com/',
    language: 'Telugu',
    states: TELUGU_STATES,
    rssUrl: 'https://www.hmtvlive.com/feed',
  },
  {
    label: 'Vaartha',
    host: 'vaartha.com',
    indexUrl: 'https://vaartha.com/',
    language: 'Telugu',
    states: TELUGU_STATES,
    rssUrl: 'https://vaartha.com/feed/',
  },
  {
    label: 'Suryaa',
    host: 'suryaa.com',
    indexUrl: 'https://www.suryaa.com/',
    language: 'Telugu',
    states: TELUGU_STATES,
    rssUrl: 'https://www.suryaa.com/feed/',
  },
  {
    label: 'Great Andhra',
    host: 'greatandhra.com',
    indexUrl: 'https://www.greatandhra.com/',
    language: 'Telugu',
    states: TELUGU_STATES,
    rssUrl: 'https://www.greatandhra.com/feed/',
  },
  {
    label: 'Telugu360',
    host: 'telugu360.com',
    indexUrl: 'https://www.telugu360.com/',
    language: 'Telugu',
    states: TELUGU_STATES,
    rssUrl: 'https://www.telugu360.com/feed/',
  },
  {
    label: 'Samayam Telugu',
    host: 'telugu.samayam.com',
    indexUrl: 'https://telugu.samayam.com/',
    language: 'Telugu',
    states: TELUGU_STATES,
  },
  {
    label: 'Oneindia Telugu',
    host: 'telugu.oneindia.com',
    indexUrl: 'https://telugu.oneindia.com/',
    language: 'Telugu',
    states: TELUGU_STATES,
    rssUrl: 'https://telugu.oneindia.com/rss/telugu-news-fb.xml',
  },
  {
    label: 'News18 Telugu',
    host: 'telugu.news18.com',
    indexUrl: 'https://telugu.news18.com/',
    language: 'Telugu',
    states: TELUGU_STATES,
    // News18 files one feed per state, which is the cleanest state resolution
    // any masthead here offers: a Telangana desk gets Telangana stories, not
    // the two-state front page it would otherwise have to sift.
    stateFeed: from({
      'Andhra Pradesh': 'https://telugu.news18.com/commonfeeds/v1/tel/rss/andhra-pradesh.xml',
      Telangana: 'https://telugu.news18.com/commonfeeds/v1/tel/rss/telangana.xml',
    }),
  },
  /*
   * The rest of the Telugu press, added when the office said "we need to track
   * news channel very perfectly bcs they post most of the things, so keep most
   * news portal we can".
   *
   * Every entry below carries `unverified` because it was written from the
   * mastheads a Telangana desk reads rather than from a crawl. Where the exact
   * section path was not certain the site root is used, which is the address
   * least likely to move; a wrong section would 404 and cost the whole source,
   * while a root page costs only precision.
   *
   * The same caution decides which of these declare an `rssUrl`. The scan reads
   * the feed INSTEAD of the index wherever one is named, and a feed that
   * answers 404 returns nothing at all rather than falling back, so a feed is
   * only claimed here where the publisher's platform makes the address
   * predictable: WordPress at /feed/, and the ABP language sites, whose three
   * verified siblings in this file all serve /news/feed.
   */
  {
    label: 'Nava Telangana',
    host: 'navatelangana.com',
    indexUrl: 'https://www.navatelangana.com/',
    language: 'Telugu',
    // The Telangana daily of the CPI(M) after the bifurcation; Prajasakti
    // below is the masthead that kept publishing for Andhra Pradesh. They are
    // separate papers, not editions of one, so they are scoped separately.
    states: ['Telangana'],
  },
  {
    label: 'Mana Telangana',
    host: 'manatelangana.news',
    indexUrl: 'https://www.manatelangana.news/',
    language: 'Telugu',
    states: ['Telangana'],
  },
  {
    label: 'Prajasakti',
    host: 'prajasakti.com',
    indexUrl: 'https://prajasakti.com/',
    language: 'Telugu',
    states: TELUGU_STATES,
  },
  {
    label: 'Visalaandhra',
    host: 'visalaandhra.com',
    indexUrl: 'https://www.visalaandhra.com/',
    language: 'Telugu',
    states: ['Andhra Pradesh'],
  },
  {
    label: 'ABN Andhra Jyothy',
    host: 'abnandhrajyothy.com',
    indexUrl: 'https://www.abnandhrajyothy.com/',
    language: 'Telugu',
    // The channel, which is a separate newsroom from the andhrajyothy.com
    // paper above and files different stories. Both are listed because an
    // office watching one is not watching the other.
    states: TELUGU_STATES,
  },
  {
    label: 'ABP Desam',
    host: 'telugu.abplive.com',
    indexUrl: 'https://telugu.abplive.com/',
    language: 'Telugu',
    states: TELUGU_STATES,
    rssUrl: 'https://telugu.abplive.com/news/feed',
  },
  {
    label: 'Zee Telugu News',
    // The same host as the Hindi and Bengali Zee entries, which is how this
    // publisher files its languages. Two rows may share a host; the scanner
    // compares hosts to decide whether a link belongs to the page it came
    // from, and all three answer to this one.
    host: 'zeenews.india.com',
    indexUrl: 'https://zeenews.india.com/telugu',
    language: 'Telugu',
    states: TELUGU_STATES,
  },
  {
    label: 'Tolivelugu',
    host: 'tolivelugu.com',
    indexUrl: 'https://www.tolivelugu.com/',
    language: 'Telugu',
    states: TELUGU_STATES,
  },
  {
    label: 'The Hans India',
    host: 'thehansindia.com',
    indexUrl: 'https://www.thehansindia.com/',
    language: 'English',
    states: TELUGU_STATES,
    statePath: from({
      'Andhra Pradesh': 'https://www.thehansindia.com/andhra-pradesh',
      Telangana: 'https://www.thehansindia.com/telangana',
    }),
    stateFeed: from({
      'Andhra Pradesh': 'https://www.thehansindia.com/rss/andhra-pradesh',
      Telangana: 'https://www.thehansindia.com/rss/telangana',
    }),
  },

  /*
   * English mastheads published for the two Telugu states.
   *
   * These are not national papers with a southern section. They are Hyderabad
   * and Vijayawada newsrooms whose whole output is this patch, which makes them
   * worth more to a Mahabubnagar office than a Delhi front page, and worth less
   * than the Telugu press, which is what carries mandal-level news.
   *
   * Telangana Today is the pointed omission this batch fixes. `looksLikeArticle`
   * in the scanner was rewritten around it — its tag page for a sitting MP
   * carried twenty-eight stories about her and the scanner rejected every one —
   * and the masthead itself was still not on this list, so no desk was reading
   * it in the first place.
   */
  {
    label: 'Telangana Today',
    host: 'telanganatoday.com',
    indexUrl: 'https://telanganatoday.com/',
    language: 'English',
    states: ['Telangana'],
    rssUrl: 'https://telanganatoday.com/feed',
  },
  {
    label: 'The Siasat Daily',
    host: 'siasat.com',
    indexUrl: 'https://www.siasat.com/',
    language: 'English',
    // Hyderabad's own English daily. Scoped to Telangana rather than both
    // Telugu states because its reporting is the city and the state around it.
    states: ['Telangana'],
    rssUrl: 'https://www.siasat.com/feed/',
  },
  {
    label: 'Sakshi Post',
    host: 'sakshipost.com',
    indexUrl: 'https://www.sakshipost.com/',
    language: 'English',
    states: TELUGU_STATES,
  },
  {
    label: 'Gulte',
    host: 'gulte.com',
    indexUrl: 'https://www.gulte.com/',
    language: 'English',
    states: TELUGU_STATES,
    rssUrl: 'https://www.gulte.com/feed/',
  },
  {
    label: 'The News Minute',
    host: 'thenewsminute.com',
    indexUrl: 'https://www.thenewsminute.com/',
    language: 'English',
    // The southern five, the same footprint as The New Indian Express below.
    states: SOUTHERN_STATES,
    // Quintype serves /stories.rss, which is the address fourteen verified
    // mastheads in this file already answer on.
    rssUrl: 'https://www.thenewsminute.com/stories.rss',
  },

  /* ── Hindi ──────────────────────────────────────────────────────────────── */
  {
    label: 'Dainik Bhaskar',
    host: 'bhaskar.com',
    indexUrl: 'https://www.bhaskar.com/',
    language: 'Hindi',
    states: Object.keys(BHASKAR_SECTIONS),
    rssUrl: 'https://www.bhaskar.com/rss-v1--category-1061.xml',
    statePath: (state) => {
      const section = BHASKAR_SECTIONS[state]
      return section ? `https://www.bhaskar.com/local/${section}/` : null
    },
  },
  {
    label: 'Amar Ujala',
    host: 'amarujala.com',
    indexUrl: 'https://www.amarujala.com/',
    language: 'Hindi',
    states: AMAR_UJALA_STATES,
    rssUrl: 'https://www.amarujala.com/rss/india-news.xml',
    statePath: (state) =>
      AMAR_UJALA_STATES.includes(state) ? `https://www.amarujala.com/${slug(state)}` : null,
  },
  {
    label: 'Dainik Jagran',
    host: 'jagran.com',
    indexUrl: 'https://www.jagran.com/',
    language: 'Hindi',
    states: JAGRAN_STATES,
    statePath: (state) =>
      JAGRAN_STATES.includes(state) ? `https://www.jagran.com/${slug(state)}` : null,
  },
  {
    label: 'Hindustan',
    host: 'livehindustan.com',
    indexUrl: 'https://www.livehindustan.com/',
    language: 'Hindi',
    states: HINDUSTAN_STATES,
    statePath: (state) =>
      HINDUSTAN_STATES.includes(state) ? `https://www.livehindustan.com/${slug(state)}` : null,
    // The feeds sit on the publisher's API host rather than the site host, so
    // this cannot be derived from statePath by appending a suffix.
    stateFeed: (state) =>
      HINDUSTAN_STATES.includes(state)
        ? `https://api.livehindustan.com/feeds/rss/${slug(state)}/rssfeed.xml`
        : null,
  },
  {
    label: 'Aaj Tak',
    host: 'aajtak.in',
    indexUrl: 'https://www.aajtak.in/',
    language: 'Hindi',
    states: HINDI_BELT,
    rssUrl: 'https://www.aajtak.in/rssfeeds/?id=home',
  },
  {
    label: 'ABP News',
    host: 'abplive.com',
    indexUrl: 'https://www.abplive.com/news/india',
    language: 'Hindi',
    states: HINDI_BELT,
    rssUrl: 'https://www.abplive.com/states/feed',
  },
  {
    label: 'News18 Hindi',
    host: 'hindi.news18.com',
    indexUrl: 'https://hindi.news18.com/',
    language: 'Hindi',
    states: HINDI_BELT,
    // The commonfeeds path the other News18 languages use answers 200 with an
    // HTML error page here; the older /rss/khabar/ path is the live one.
    rssUrl: 'https://hindi.news18.com/rss/khabar/nation.xml',
  },
  {
    label: 'NDTV India',
    host: 'ndtv.in',
    indexUrl: 'https://ndtv.in/',
    language: 'Hindi',
    states: HINDI_BELT,
    rssUrl: 'https://feeds.feedburner.com/ndtvkhabar-latest',
  },
  {
    label: 'Zee News Hindi',
    host: 'zeenews.india.com',
    indexUrl: 'https://zeenews.india.com/hindi',
    language: 'Hindi',
    states: HINDI_BELT,
  },
  {
    label: 'Jansatta',
    host: 'jansatta.com',
    indexUrl: 'https://www.jansatta.com/',
    language: 'Hindi',
    states: HINDI_BELT,
  },
  {
    label: 'Prabhat Khabar',
    host: 'prabhatkhabar.com',
    indexUrl: 'https://www.prabhatkhabar.com/',
    language: 'Hindi',
    states: ['Jharkhand', 'Bihar', 'West Bengal'],
    rssUrl: 'https://www.prabhatkhabar.com/feed',
  },
  {
    label: 'Naidunia',
    host: 'naidunia.com',
    indexUrl: 'https://www.naidunia.com/',
    language: 'Hindi',
    states: ['Madhya Pradesh', 'Chhattisgarh'],
  },

  /* ── Tamil ──────────────────────────────────────────────────────────────── */
  {
    label: 'Dinamalar',
    host: 'dinamalar.com',
    indexUrl: 'https://www.dinamalar.com/',
    language: 'Tamil',
    states: ['Tamil Nadu'],
  },
  {
    label: 'Dinamani',
    host: 'dinamani.com',
    indexUrl: 'https://www.dinamani.com/',
    language: 'Tamil',
    states: ['Tamil Nadu'],
    rssUrl: 'https://www.dinamani.com/stories.rss',
  },
  {
    label: 'Daily Thanthi',
    host: 'dailythanthi.com',
    indexUrl: 'https://www.dailythanthi.com/',
    language: 'Tamil',
    states: ['Tamil Nadu'],
    rssUrl: 'https://www.dailythanthi.com/stories.rss',
  },
  {
    label: 'Hindu Tamil Thisai',
    host: 'hindutamil.in',
    indexUrl: 'https://www.hindutamil.in/',
    language: 'Tamil',
    states: ['Tamil Nadu'],
    rssUrl: 'https://www.hindutamil.in/stories.rss',
  },
  {
    label: 'Dinakaran',
    host: 'dinakaran.com',
    indexUrl: 'https://www.dinakaran.com/',
    language: 'Tamil',
    states: ['Tamil Nadu'],
  },
  {
    label: 'Maalaimalar',
    host: 'maalaimalar.com',
    indexUrl: 'https://www.maalaimalar.com/',
    language: 'Tamil',
    states: ['Tamil Nadu'],
    rssUrl: 'https://www.maalaimalar.com/stories.rss',
  },
  {
    label: 'Vikatan',
    host: 'vikatan.com',
    indexUrl: 'https://www.vikatan.com/',
    language: 'Tamil',
    states: ['Tamil Nadu'],
    rssUrl: 'https://www.vikatan.com/stories.rss',
  },
  {
    label: 'Puthiya Thalaimurai',
    host: 'puthiyathalaimurai.com',
    indexUrl: 'https://www.puthiyathalaimurai.com/',
    language: 'Tamil',
    states: ['Tamil Nadu'],
    rssUrl: 'https://www.puthiyathalaimurai.com/stories.rss',
  },
  {
    label: 'News18 Tamil',
    host: 'tamil.news18.com',
    indexUrl: 'https://tamil.news18.com/',
    language: 'Tamil',
    states: ['Tamil Nadu'],
    rssUrl: 'https://tamil.news18.com/commonfeeds/v1/tam/rss/tamil-nadu.xml',
  },
  {
    label: 'Oneindia Tamil',
    host: 'tamil.oneindia.com',
    indexUrl: 'https://tamil.oneindia.com/',
    language: 'Tamil',
    states: ['Tamil Nadu'],
    rssUrl: 'https://tamil.oneindia.com/rss/tamil-news-fb.xml',
  },

  /* ── Kannada ────────────────────────────────────────────────────────────── */
  {
    label: 'Prajavani',
    host: 'prajavani.net',
    indexUrl: 'https://www.prajavani.net/',
    language: 'Kannada',
    states: ['Karnataka'],
    rssUrl: 'https://www.prajavani.net/stories.rss',
  },
  {
    label: 'Kannada Prabha',
    host: 'kannadaprabha.com',
    indexUrl: 'https://www.kannadaprabha.com/',
    language: 'Kannada',
    states: ['Karnataka'],
    rssUrl: 'https://www.kannadaprabha.com/stories.rss',
  },
  {
    label: 'Udayavani',
    host: 'udayavani.com',
    indexUrl: 'https://udayavani.com/',
    language: 'Kannada',
    states: ['Karnataka'],
  },
  {
    label: 'Vijaya Karnataka',
    host: 'vijaykarnataka.com',
    indexUrl: 'https://vijaykarnataka.com/',
    language: 'Kannada',
    states: ['Karnataka'],
  },
  {
    label: 'News18 Kannada',
    host: 'kannada.news18.com',
    indexUrl: 'https://kannada.news18.com/',
    language: 'Kannada',
    states: ['Karnataka'],
    rssUrl: 'https://kannada.news18.com/commonfeeds/v1/kan/rss/latest.xml',
  },
  {
    label: 'Oneindia Kannada',
    host: 'kannada.oneindia.com',
    indexUrl: 'https://kannada.oneindia.com/',
    language: 'Kannada',
    states: ['Karnataka'],
    rssUrl: 'https://kannada.oneindia.com/rss/kannada-news-fb.xml',
  },
  {
    label: 'Suvarna News',
    host: 'kannada.asianetnews.com',
    indexUrl: 'https://kannada.asianetnews.com/',
    language: 'Kannada',
    states: ['Karnataka'],
  },
  {
    label: 'Deccan Herald',
    host: 'deccanherald.com',
    indexUrl: 'https://www.deccanherald.com/',
    language: 'English',
    states: ['Karnataka'],
    rssUrl: 'https://www.deccanherald.com/stories.rss',
  },

  /* ── Malayalam ──────────────────────────────────────────────────────────── */
  {
    label: 'Malayala Manorama',
    host: 'manoramaonline.com',
    indexUrl: 'https://www.manoramaonline.com/',
    language: 'Malayalam',
    states: ['Kerala'],
  },
  {
    label: 'Mathrubhumi',
    host: 'mathrubhumi.com',
    indexUrl: 'https://www.mathrubhumi.com/',
    language: 'Malayalam',
    states: ['Kerala'],
    // The feed the site's own <link rel="alternate"> points at is long gone
    // (410); this sitemap path is the one that still serves items.
    rssUrl: 'https://www.mathrubhumi.com/sitemaps/mathrubhumi/rss',
  },
  {
    label: 'Madhyamam',
    host: 'madhyamam.com',
    indexUrl: 'https://www.madhyamam.com/',
    language: 'Malayalam',
    states: ['Kerala'],
  },
  {
    label: 'Asianet News',
    host: 'asianetnews.com',
    indexUrl: 'https://www.asianetnews.com/',
    language: 'Malayalam',
    states: ['Kerala'],
  },
  {
    label: 'News18 Kerala',
    host: 'malayalam.news18.com',
    indexUrl: 'https://malayalam.news18.com/',
    language: 'Malayalam',
    states: ['Kerala'],
    rssUrl: 'https://malayalam.news18.com/commonfeeds/v1/mal/rss/kerala.xml',
  },
  {
    label: 'Oneindia Malayalam',
    host: 'malayalam.oneindia.com',
    indexUrl: 'https://malayalam.oneindia.com/',
    language: 'Malayalam',
    states: ['Kerala'],
    rssUrl: 'https://malayalam.oneindia.com/rss/malayalam-news-fb.xml',
  },
  {
    label: '24 News',
    host: 'twentyfournews.com',
    indexUrl: 'https://www.twentyfournews.com/',
    language: 'Malayalam',
    states: ['Kerala'],
    rssUrl: 'https://www.twentyfournews.com/feed',
  },
  {
    label: 'Onmanorama',
    host: 'onmanorama.com',
    indexUrl: 'https://www.onmanorama.com/',
    language: 'English',
    states: ['Kerala'],
    rssUrl: 'https://www.onmanorama.com/kerala.feeds.onmrss.xml',
  },

  /* ── Marathi ────────────────────────────────────────────────────────────── */
  {
    label: 'Loksatta',
    host: 'loksatta.com',
    indexUrl: 'https://www.loksatta.com/',
    language: 'Marathi',
    states: ['Maharashtra'],
  },
  {
    label: 'Lokmat',
    host: 'lokmat.com',
    indexUrl: 'https://www.lokmat.com/',
    language: 'Marathi',
    states: ['Maharashtra'],
    rssUrl: 'https://www.lokmat.com/rss/maharashtra.xml',
  },
  {
    label: 'Sakal',
    host: 'esakal.com',
    indexUrl: 'https://www.esakal.com/',
    language: 'Marathi',
    states: ['Maharashtra'],
    rssUrl: 'https://www.esakal.com/stories.rss',
  },
  {
    label: 'Divya Marathi',
    host: 'divyamarathi.bhaskar.com',
    indexUrl: 'https://divyamarathi.bhaskar.com/',
    language: 'Marathi',
    states: ['Maharashtra'],
  },
  {
    label: 'Pudhari',
    host: 'pudhari.news',
    indexUrl: 'https://pudhari.news/',
    language: 'Marathi',
    states: ['Maharashtra'],
    rssUrl: 'https://pudhari.news/stories.rss',
  },
  {
    label: 'ABP Majha',
    host: 'marathi.abplive.com',
    indexUrl: 'https://marathi.abplive.com/',
    language: 'Marathi',
    states: ['Maharashtra'],
    rssUrl: 'https://marathi.abplive.com/news/feed',
  },
  {
    label: 'News18 Lokmat',
    // marathi.news18.com redirects here, and a link on the redirected page is
    // only recognised as a story when the host compared against is the one that
    // actually served it.
    host: 'news18marathi.com',
    indexUrl: 'https://news18marathi.com/',
    language: 'Marathi',
    states: ['Maharashtra'],
    rssUrl: 'https://news18marathi.com/commonfeeds/v1/mar/rss/maharashtra.xml',
  },
  {
    label: 'TV9 Marathi',
    host: 'tv9marathi.com',
    indexUrl: 'https://www.tv9marathi.com/',
    language: 'Marathi',
    states: ['Maharashtra'],
    rssUrl: 'https://www.tv9marathi.com/feed',
  },
  {
    label: 'Free Press Journal',
    host: 'freepressjournal.in',
    indexUrl: 'https://www.freepressjournal.in/',
    language: 'English',
    states: ['Maharashtra', 'Madhya Pradesh'],
    rssUrl: 'https://www.freepressjournal.in/stories.rss',
  },

  /* ── Bengali ────────────────────────────────────────────────────────────── */
  {
    label: 'Anandabazar Patrika',
    host: 'anandabazar.com',
    indexUrl: 'https://www.anandabazar.com/',
    language: 'Bengali',
    states: ['West Bengal'],
  },
  {
    label: 'Bartaman Patrika',
    host: 'bartamanpatrika.com',
    indexUrl: 'https://bartamanpatrika.com/',
    language: 'Bengali',
    states: ['West Bengal'],
  },
  {
    label: 'Sangbad Pratidin',
    host: 'sangbadpratidin.in',
    indexUrl: 'https://www.sangbadpratidin.in/',
    language: 'Bengali',
    states: ['West Bengal'],
    rssUrl: 'https://www.sangbadpratidin.in/feed/',
  },
  {
    label: 'Aajkaal',
    host: 'aajkaal.in',
    indexUrl: 'https://www.aajkaal.in/',
    language: 'Bengali',
    states: ['West Bengal'],
  },
  {
    label: 'ABP Ananda',
    host: 'bengali.abplive.com',
    indexUrl: 'https://bengali.abplive.com/',
    language: 'Bengali',
    states: ['West Bengal'],
    rssUrl: 'https://bengali.abplive.com/news/feed',
  },
  {
    label: 'News18 Bangla',
    host: 'bengali.news18.com',
    indexUrl: 'https://bengali.news18.com/',
    language: 'Bengali',
    states: ['West Bengal'],
    rssUrl: 'https://bengali.news18.com/commonfeeds/v1/ben/rss/west-bengal.xml',
  },
  {
    label: 'TV9 Bangla',
    host: 'tv9bangla.com',
    indexUrl: 'https://tv9bangla.com/',
    language: 'Bengali',
    states: ['West Bengal'],
    rssUrl: 'https://tv9bangla.com/feed',
  },
  {
    label: 'Zee 24 Ghanta',
    host: 'zeenews.india.com',
    indexUrl: 'https://zeenews.india.com/bengali',
    language: 'Bengali',
    states: ['West Bengal'],
  },
  {
    label: 'The Telegraph',
    host: 'telegraphindia.com',
    indexUrl: 'https://www.telegraphindia.com/',
    language: 'English',
    states: ['West Bengal'],
  },

  /* ── Gujarati ───────────────────────────────────────────────────────────── */
  {
    label: 'Divya Bhaskar',
    host: 'divyabhaskar.co.in',
    indexUrl: 'https://www.divyabhaskar.co.in/',
    language: 'Gujarati',
    states: ['Gujarat'],
  },
  {
    label: 'Gujarat Samachar',
    host: 'gujaratsamachar.com',
    indexUrl: 'https://www.gujaratsamachar.com/',
    language: 'Gujarati',
    states: ['Gujarat'],
  },
  {
    label: 'ABP Asmita',
    host: 'gujarati.abplive.com',
    indexUrl: 'https://gujarati.abplive.com/',
    language: 'Gujarati',
    states: ['Gujarat'],
    rssUrl: 'https://gujarati.abplive.com/news/feed',
  },
  {
    label: 'News18 Gujarati',
    host: 'gujarati.news18.com',
    indexUrl: 'https://gujarati.news18.com/',
    language: 'Gujarati',
    states: ['Gujarat'],
    rssUrl: 'https://gujarati.news18.com/commonfeeds/v1/guj/rss/gujarat.xml',
  },
  {
    label: 'Oneindia Gujarati',
    host: 'gujarati.oneindia.com',
    indexUrl: 'https://gujarati.oneindia.com/',
    language: 'Gujarati',
    states: ['Gujarat'],
    rssUrl: 'https://gujarati.oneindia.com/rss/gujarati-news-fb.xml',
  },
  {
    label: 'TV9 Gujarati',
    host: 'tv9gujarati.com',
    indexUrl: 'https://tv9gujarati.com/',
    language: 'Gujarati',
    states: ['Gujarat'],
    rssUrl: 'https://tv9gujarati.com/feed',
  },
  {
    label: 'Gujarati Mid-day',
    host: 'gujaratimidday.com',
    indexUrl: 'https://www.gujaratimidday.com/',
    language: 'Gujarati',
    states: ['Gujarat'],
  },

  /* ── Odia ───────────────────────────────────────────────────────────────── */
  {
    label: 'Sambad',
    host: 'sambad.in',
    indexUrl: 'https://sambad.in/',
    language: 'Odia',
    states: ['Odisha'],
  },
  {
    label: 'OdishaTV',
    host: 'odishatv.in',
    indexUrl: 'https://odishatv.in/',
    language: 'Odia',
    states: ['Odisha'],
    rssUrl: 'https://odishatv.in/rss',
  },
  {
    label: 'Kalinga TV',
    host: 'kalingatv.com',
    indexUrl: 'https://kalingatv.com/',
    language: 'Odia',
    states: ['Odisha'],
    rssUrl: 'https://kalingatv.com/feed/',
  },
  {
    label: 'Sambad English',
    host: 'sambadenglish.com',
    indexUrl: 'https://sambadenglish.com/',
    language: 'English',
    states: ['Odisha'],
  },

  /* ── Punjabi ────────────────────────────────────────────────────────────── */
  {
    label: 'Punjabi Tribune',
    host: 'punjabitribuneonline.com',
    indexUrl: 'https://www.punjabitribuneonline.com/',
    language: 'Punjabi',
    states: ['Punjab'],
  },
  {
    label: 'Jagbani',
    host: 'jagbani.punjabkesari.in',
    indexUrl: 'https://jagbani.punjabkesari.in/',
    language: 'Punjabi',
    states: ['Punjab'],
  },
  {
    label: 'Ajit',
    host: 'ajitjalandhar.com',
    indexUrl: 'https://www.ajitjalandhar.com/',
    language: 'Punjabi',
    states: ['Punjab'],
  },
  {
    label: 'Rozana Spokesman',
    host: 'rozanaspokesman.in',
    indexUrl: 'https://www.rozanaspokesman.in/',
    language: 'Punjabi',
    states: ['Punjab'],
  },
  {
    label: 'The Tribune',
    host: 'tribuneindia.com',
    indexUrl: 'https://www.tribuneindia.com/',
    language: 'English',
    states: ['Punjab', 'Haryana', 'Himachal Pradesh'],
  },

  /* ── Assamese and the North East ────────────────────────────────────────── */
  {
    label: 'Asomiya Pratidin',
    host: 'asomiyapratidin.in',
    indexUrl: 'https://www.asomiyapratidin.in/',
    language: 'Assamese',
    states: ['Assam'],
  },
  {
    label: 'Pratidin Time',
    host: 'pratidintime.com',
    indexUrl: 'https://www.pratidintime.com/',
    language: 'Assamese',
    states: ['Assam'],
    rssUrl: 'https://www.pratidintime.com/rss',
  },
  {
    label: 'The Assam Tribune',
    host: 'assamtribune.com',
    indexUrl: 'https://assamtribune.com/',
    language: 'English',
    states: ['Assam'],
    rssUrl: 'https://assamtribune.com/feed',
  },
  {
    label: 'The Sentinel',
    host: 'sentinelassam.com',
    indexUrl: 'https://www.sentinelassam.com/',
    language: 'English',
    states: ['Assam'],
    rssUrl: 'https://www.sentinelassam.com/stories.rss',
  },
  {
    label: 'Northeast Now',
    host: 'nenow.in',
    indexUrl: 'https://nenow.in/',
    language: 'English',
    states: ['Assam'],
    rssUrl: 'https://nenow.in/feed',
  },

  /* ── English, national ──────────────────────────────────────────────────── */
  {
    label: 'The Hindu',
    host: 'thehindu.com',
    // The national umbrella, not a state section. This masthead claims every
    // state, so a state-specific page here is read by every desk in the
    // country: a Lucknow operator was being served Andhra Pradesh.
    indexUrl: 'https://www.thehindu.com/news/national/',
    language: 'English',
    states: 'all',
    rssUrl: 'https://www.thehindu.com/news/national/feeder/default.rss',
    statePath: (state) =>
      HINDU_SECTIONS[state] ??
      (ALL_STATES.includes(state) ? `https://www.thehindu.com/news/national/${slug(state)}/` : null),
    // Delhi is the one state with a section but no feed beneath it, because the
    // capital is filed under /news/cities/ and the feeder path only exists
    // under /news/national/.
    stateFeed: (state) =>
      state !== 'Delhi' && ALL_STATES.includes(state)
        ? `https://www.thehindu.com/news/national/${slug(state)}/feeder/default.rss`
        : null,
  },
  {
    label: 'Times of India',
    host: 'timesofindia.indiatimes.com',
    indexUrl: 'https://timesofindia.indiatimes.com/india',
    language: 'English',
    states: 'all',
    rssUrl: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
    districtPath: (d) => {
      const city = TOI_CITIES[d]
      return city ? `https://timesofindia.indiatimes.com/city/${city}` : null
    },
  },
  {
    label: 'The Indian Express',
    host: 'indianexpress.com',
    indexUrl: 'https://indianexpress.com/section/india/',
    language: 'English',
    states: 'all',
    rssUrl: 'https://indianexpress.com/section/india/feed/',
  },
  {
    label: 'Hindustan Times',
    host: 'hindustantimes.com',
    indexUrl: 'https://www.hindustantimes.com/india-news',
    language: 'English',
    states: 'all',
    rssUrl: 'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml',
  },
  {
    label: 'NDTV',
    host: 'ndtv.com',
    indexUrl: 'https://www.ndtv.com/india',
    language: 'English',
    states: 'all',
    rssUrl: 'https://feeds.feedburner.com/ndtvnews-india-news',
  },
  {
    label: 'News18',
    host: 'news18.com',
    indexUrl: 'https://www.news18.com/india/',
    language: 'English',
    states: 'all',
    rssUrl: 'https://www.news18.com/commonfeeds/v1/eng/rss/india.xml',
  },
  {
    label: 'ThePrint',
    host: 'theprint.in',
    indexUrl: 'https://theprint.in/',
    language: 'English',
    states: 'all',
  },
  {
    label: 'The New Indian Express',
    host: 'newindianexpress.com',
    indexUrl: 'https://www.newindianexpress.com/india',
    language: 'English',
    states: NIE_STATES,
    rssUrl: 'https://www.newindianexpress.com/stories.rss',
    statePath: (state) =>
      NIE_STATES.includes(state) ? `https://www.newindianexpress.com/states/${slug(state)}` : null,
  },
  {
    label: 'Deccan Chronicle',
    host: 'deccanchronicle.com',
    indexUrl: 'https://www.deccanchronicle.com/nation',
    language: 'English',
    // Marked 'all' before, which is how a Varanasi desk was offered a paper
    // printed for the south. Its only state sections are the southern five.
    states: SOUTHERN_STATES,
    rssUrl: 'https://www.deccanchronicle.com/feed',
    statePath: (state) =>
      SOUTHERN_STATES.includes(state)
        ? `https://www.deccanchronicle.com/southern-states/${slug(state)}`
        : null,
  },
  /*
   * The rest of the national English press, added in the same batch and under
   * the same caution: `unverified` on every row, the site root or a long-lived
   * section for the index, and an `rssUrl` only where the publisher's platform
   * makes the address predictable.
   *
   * None of these declares a `statePath`. Several do publish state pages, but
   * an unchecked state path is worse than no state path: `indexUrlFor` would
   * prefer it over the general index, and a 404 there costs the whole source
   * for that scan. The general index is the honest fallback until somebody
   * fetches the sections.
   */
  {
    label: 'India Today',
    host: 'indiatoday.in',
    indexUrl: 'https://www.indiatoday.in/india',
    language: 'English',
    states: 'all',
  },
  {
    label: 'The Quint',
    host: 'thequint.com',
    indexUrl: 'https://www.thequint.com/news/india',
    language: 'English',
    states: 'all',
    rssUrl: 'https://www.thequint.com/stories.rss',
  },
  {
    label: 'The Wire',
    host: 'thewire.in',
    indexUrl: 'https://thewire.in/politics',
    // The index is a JavaScript shell with zero anchors for a server; the CMS
    // feed is the real door. Verified live: 126 items of XML.
    rssUrl: 'https://cms.thewire.in/feed',
    language: 'English',
    states: 'all',
  },
  {
    label: 'Scroll.in',
    host: 'scroll.in',
    indexUrl: 'https://scroll.in/',
    language: 'English',
    states: 'all',
  },
  {
    label: 'Firstpost',
    host: 'firstpost.com',
    indexUrl: 'https://www.firstpost.com/india/',
    language: 'English',
    states: 'all',
  },
  {
    label: 'The Federal',
    host: 'thefederal.com',
    indexUrl: 'https://thefederal.com/',
    language: 'English',
    states: 'all',
  },
  {
    label: 'The Economic Times',
    host: 'economictimes.indiatimes.com',
    indexUrl: 'https://economictimes.indiatimes.com/news/india',
    language: 'English',
    states: 'all',
    // The same publisher and the same feed path as the verified Times of India
    // entry above, on that group's other masthead.
    rssUrl: 'https://economictimes.indiatimes.com/rssfeedstopstories.cms',
  },
  {
    label: 'Business Standard',
    host: 'business-standard.com',
    indexUrl: 'https://www.business-standard.com/india-news',
    language: 'English',
    states: 'all',
  },
  {
    label: 'Mint',
    host: 'livemint.com',
    indexUrl: 'https://www.livemint.com/politics',
    language: 'English',
    states: 'all',
  },

  /* ── Wire services and fact-checkers ────────────────────────────────────── */
  /*
   * Two kinds of source a member's office needs and should not open the morning
   * with, which is why they carry `kind` and why `planPortals` gives them the
   * last slot rather than an early one.
   *
   * A wire agency is the floor under everything else: when a story about the
   * member breaks nationally it is on the wire before it is in any paper, and
   * the wire files it whether or not a masthead the desk follows picks it up.
   *
   * A fact-check desk answers a different question entirely. The grievance
   * record already carries a `fake` field, and the office's real need is to
   * know whether a claim now circulating about the member has been ruled on by
   * somebody whose job that is. These four publish nothing on a quiet week and
   * are the first thing to read on a bad one.
   *
   * All are marked national because that is what they are. The consequence
   * worth knowing: the persona tracker adds every `states: 'all'` masthead
   * underneath a desk's own choices, so these lengthen that list.
   */
  {
    label: 'ANI',
    host: 'aninews.in',
    indexUrl: 'https://www.aninews.in/category/national/general-news/',
    language: 'English',
    kind: 'agency',
    states: 'all',
  },
  {
    label: 'Alt News',
    host: 'altnews.in',
    indexUrl: 'https://www.altnews.in/',
    language: 'English',
    kind: 'factcheck',
    states: 'all',
    rssUrl: 'https://www.altnews.in/feed/',
  },
  {
    label: 'BOOM',
    host: 'boomlive.in',
    indexUrl: 'https://www.boomlive.in/fact-check',
    language: 'English',
    kind: 'factcheck',
    states: 'all',
  },
  {
    label: 'Factly',
    host: 'factly.in',
    indexUrl: 'https://factly.in/',
    language: 'English',
    kind: 'factcheck',
    states: 'all',
    rssUrl: 'https://factly.in/feed/',
  },
  {
    label: 'The Quint WebQoof',
    // The Quint's fact-check desk, on the same host as the masthead above. It
    // is a separate row because the two answer different questions and a desk
    // should be able to follow the fact-checks without the news feed.
    host: 'thequint.com',
    indexUrl: 'https://www.thequint.com/news/webqoof',
    language: 'English',
    kind: 'factcheck',
    states: 'all',
  },
]

export function portalsForState(state: string): NewsPortal[] {
  return PORTALS.filter((p) => p.states === 'all' || p.states.includes(state))
}

/**
 * The page to read for a given desk, most specific route first: the district
 * edition, then the state section, then the masthead's general index.
 *
 * The state is derived from the city when the caller does not pass one, so the
 * existing two-argument callers get state-correct routing without threading a
 * new field through the scan request. Both Telugu states are listed district by
 * district, so `stateOfCity` resolves every district they cover.
 */
export function indexUrlFor(
  portal: NewsPortal,
  city: string | null,
  state?: string | null,
): string {
  const place = state ?? (city ? stateOfCity(city) : null)

  if (city && portal.districtPath) {
    const district = portal.districtPath(slug(city), place)
    if (district) return district
  }
  if (place && portal.statePath) {
    const section = portal.statePath(place)
    if (section) return section
  }
  return portal.indexUrl
}

/**
 * The feed to read for a given desk, or null when this masthead publishes none.
 *
 * Same order of preference as `indexUrlFor`: the state's own feed where the
 * publisher splits by state, otherwise the masthead's general feed.
 */
export function feedUrlFor(
  portal: NewsPortal,
  city: string | null,
  state?: string | null,
): string | null {
  const place = state ?? (city ? stateOfCity(city) : null)

  if (place && portal.stateFeed) {
    const feed = portal.stateFeed(place)
    if (feed) return feed
  }
  return portal.rssUrl ?? null
}
