/**
 * The demo roster: five politicians, each against the rival they actually face.
 *
 * WHY THIS FILE EXISTS AT ALL. A wrong handle does not fail loudly — it scrapes
 * a stranger's feed and files it under a politician's name, and every number
 * downstream is then confidently wrong. That already happened once here: a
 * guessed "DKArunaBJP" came back as an unavailable account, and had it instead
 * belonged to somebody else the dashboard would have shown their posts as hers.
 * So every handle below was researched and then separately verified against the
 * live page, and the ones that could not be confirmed are null rather than
 * best-guess.
 *
 * CONFIDENCE IS RECORDED, NOT ASSUMED. `low` handles are carried here for the
 * record but skipped by the builder — see `scrapableHandles`. A profile nobody
 * could confirm is not worth the risk of attributing to the wrong person.
 *
 * THE PAIRINGS ARE THE POINT. A comparison dashboard is only meaningful if the
 * rival is the person the principal is actually measured against — the same
 * seat, the same state contest, or the direct national counterpart. Each pairing
 * below carries its reason so the choice can be argued with rather than taken on
 * faith.
 */

import type { Platform } from './types'

export type Confidence = 'high' | 'medium' | 'low' | 'none'

export interface RosterHandle {
  platform: Platform
  handle: string
  confidence: Confidence
}

/**
 * Where this person holds office.
 *
 * Carried so the demo desk can present itself as THEIR desk. The greeting, the
 * constituency card and the map all read from the office profile, and without
 * it switching politician would redraw every chart while the header went on
 * naming somebody else. `district` is separate from `constituency` on purpose:
 * newspapers publish editions by district, never by assembly segment.
 */
export interface Office {
  constituency: string
  state: string
  district: string
}

export interface Person {
  key: string
  name: string
  party: string
  /** Short party tag used for colour and chips in the UI. */
  partyTag: 'BJP' | 'INC' | 'BRS' | 'SP'
  role: string
  office: Office
  /**
   * How this person's name is written in the languages their audience posts in.
   *
   * Load-bearing, not decoration. A watch list of Latin spellings finds nothing
   * in a Telugu or Hindi feed, and these are Telugu and Hindi feeds: measured
   * across the roster, matching on Latin names alone found six mentions of the
   * Prime Minister in his rival's posts and none at all of three other
   * principals. Adding the native-script forms found four more that were really
   * there. An office monitoring an Indian seat with English-only search words is
   * reading a fraction of what is said about it.
   */
  aliases: string[]
  handles: RosterHandle[]
}

/**
 * An account that TALKS ABOUT politicians rather than being one.
 *
 * A separate list from PEOPLE, because they answer a different question and
 * belong on a different screen. A rival's feed says what the opposition is
 * campaigning on; a broadcaster's or a commentator's says what is being said
 * about you — which is the question the influencer watch exists for, and the
 * one an office cannot answer by reading its own posts.
 *
 * Rival politicians were standing in here for a while and it was the wrong
 * shape: watching your opponent tells you nothing about coverage, and a screen
 * headed "what people are saying" that only lists people you are running
 * against answers a question nobody asked.
 */
export interface Creator {
  key: string
  name: string
  kind: 'News channel' | 'Digital news' | 'Commentator' | 'Fact-checker' | 'Creator'
  language: string
  /**
   * Which desks this account is worth watching from.
   *
   * A Mahabubnagar MP does not need Delhi's daily national bulletins on her
   * influencer screen, and the Prime Minister's office is not served by a
   * Telangana district feed. `both` is for accounts that genuinely cover each.
   */
  scope: 'telangana' | 'national' | 'both'
  /** Why this account is on the list at all. */
  why: string
  handles: RosterHandle[]
}

/** One opponent, and the reason they are on this desk. */
export interface Rival {
  key: string
  why: string
}

/**
 * Who a principal is measured against.
 *
 * A LIST, because almost nobody in politics has exactly one opponent. A sitting
 * MP is pressed by the candidate who nearly took the seat AND by the third
 * party working the same ground; a Chief Minister answers to the opposition he
 * displaced AND to the national party trying to displace him. Modelling that as
 * a single rival forced a choice the office does not make, and left the
 * comparison screens showing one column where the real contest has two or
 * three.
 */
export interface Pairing {
  principal: string
  rivals: Rival[]
}

export const PEOPLE: Person[] = [
  {
    key: 'dkaruna',
    name: 'D. K. Aruna',
    party: 'Bharatiya Janata Party',
    partyTag: 'BJP',
    role: 'MP, Mahabubnagar · National Vice President, BJP',
    office: { constituency: 'Mahabubnagar', state: 'Telangana', district: 'Mahabubnagar' },
    aliases: ['అరుణ', 'డి.కె.అరుణ', 'अरुणा', 'మహబూబ్ నగర్', 'పాలమూరు'],
    handles: [
      { platform: 'Facebook', handle: 'DKAruna.TG', confidence: 'high' },
      { platform: 'Instagram', handle: 'dkarunaofficial', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'Aruna_DK', confidence: 'high' },
      /**
       * Her own channel, not a supporter's.
       *
       * Two lookalikes exist — a 655-subscriber one with an empty bio and a
       * 229-subscriber song channel — and BOTH copy her Facebook, Instagram and
       * X links into their descriptions, so the outbound links prove nothing on
       * their own. What settles it is the first-person Telugu bio signed
       * "లోక్ సభ బీజేపీ అభ్యర్థి డీకే అరుణ", same-day uploads of her own
       * constituency work, and roughly five times the subscribers of the
       * nearest impostor.
       */
      { platform: 'YouTube', handle: 'DKArunaBJPOfficial', confidence: 'high' },
      // Carried, not scraped. A one-connection profile whose headline is frozen
      // at an office she left in 2014, and LinkedIn answers HTTP 999 so the page
      // was never actually loaded — as likely a staffer's or an impostor's shell
      // as hers.
      { platform: 'LinkedIn', handle: 'in/dk-aruna-a4a1a759', confidence: 'low' },
    ],
  },
  {
    key: 'vamshi',
    name: 'Challa Vamshi Chand Reddy',
    party: 'Indian National Congress',
    partyTag: 'INC',
role: 'INC, Mahabubnagar, runner-up, 2024 Lok Sabha',
    office: { constituency: 'Mahabubnagar', state: 'Telangana', district: 'Mahabubnagar' },
    aliases: ['వంశీ', 'వంశీచంద్', 'చల్లా', 'మహబూబ్ నగర్'],
    handles: [
      { platform: 'Facebook', handle: 'vamshiyouthcongress', confidence: 'high' },
      { platform: 'Instagram', handle: 'vamshichandreddyinc', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'VamsiChandReddy', confidence: 'high' },
      { platform: 'YouTube', handle: 'ChallaVamsiChandReddy', confidence: 'high' },
    ],
  },
  {
    key: 'modi',
    name: 'Narendra Modi',
    party: 'Bharatiya Janata Party',
    partyTag: 'BJP',
    role: 'Prime Minister of India',
    office: { constituency: 'Varanasi', state: 'Uttar Pradesh', district: 'Varanasi' },
    aliases: ['మోదీ', 'मोदी', 'నరేంద్ర', 'नरेंद्र', 'ప్రధాని', 'प्रधानमंत्री'],
    handles: [
      { platform: 'Facebook', handle: 'narendramodi', confidence: 'high' },
      { platform: 'Instagram', handle: 'narendramodi', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'narendramodi', confidence: 'high' },
      { platform: 'LinkedIn', handle: 'in/narendramodi', confidence: 'high' },
      { platform: 'YouTube', handle: 'narendramodi', confidence: 'high' },
    ],
  },
  {
    key: 'rahul',
    name: 'Rahul Gandhi',
    party: 'Indian National Congress',
    partyTag: 'INC',
    role: 'Leader of the Opposition, Lok Sabha',
    office: { constituency: 'Rae Bareli', state: 'Uttar Pradesh', district: 'Rae Bareli' },
    aliases: ['రాహుల్', 'राहुल', 'గాంధీ', 'गांधी'],
    handles: [
      { platform: 'Facebook', handle: 'rahulgandhi', confidence: 'high' },
      { platform: 'Instagram', handle: 'rahulgandhi', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'RahulGandhi', confidence: 'high' },
      // Carried but not scraped: the LinkedIn profile could not be confirmed as
      // his rather than a supporter-run page.
      { platform: 'LinkedIn', handle: 'in/rahulgandhiofficial', confidence: 'low' },
      { platform: 'YouTube', handle: 'rahulgandhi', confidence: 'high' },
    ],
  },
  {
    key: 'revanth',
    name: 'A. Revanth Reddy',
    party: 'Indian National Congress',
    partyTag: 'INC',
    role: 'Chief Minister of Telangana',
    office: { constituency: 'Kodangal', state: 'Telangana', district: 'Vikarabad' },
    aliases: ['రేవంత్', 'रेवंत', 'రేవంత్ రెడ్డి', 'ముఖ్యమంత్రి'],
    handles: [
      { platform: 'Facebook', handle: 'revanthofficial', confidence: 'high' },
      { platform: 'Instagram', handle: 'revanthofficial', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'revanth_anumula', confidence: 'high' },
      // Carried, not scraped: plausible but never confirmed as the Chief
      // Minister's own channel rather than a party or supporter one.
      { platform: 'YouTube', handle: 'REVANTHREDDYCHANNEL', confidence: 'medium' },
    ],
  },
  {
    key: 'ktr',
    name: 'K. T. Rama Rao',
    party: 'Bharat Rashtra Samithi',
    partyTag: 'BRS',
    role: 'Working President, BRS',
    office: { constituency: 'Sircilla', state: 'Telangana', district: 'Rajanna Sircilla' },
    aliases: ['కేటీఆర్', 'రామారావు', 'केटीआर', 'కె.టి.రామారావు'],
    handles: [
      { platform: 'Facebook', handle: 'KTRTRS', confidence: 'high' },
      { platform: 'Instagram', handle: 'ktrtrs', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'KTRBRS', confidence: 'high' },
      { platform: 'LinkedIn', handle: 'in/ktramarao', confidence: 'high' },
      { platform: 'YouTube', handle: 'KTarakaRamaRao', confidence: 'high' },
    ],
  },
  {
    key: 'manne',
    name: 'Manne Srinivas Reddy',
    party: 'Bharat Rashtra Samithi',
    partyTag: 'BRS',
role: 'Former MP, Mahabubnagar (2019 to 24)',
    office: { constituency: 'Mahabubnagar', state: 'Telangana', district: 'Mahabubnagar' },
    aliases: ['మన్నె', 'శ్రీనివాస్ రెడ్డి', 'మహబూబ్ నగర్'],
    handles: [
      // X only. No Facebook or Instagram account could be confirmed as his
      // rather than a supporter page, and a guess would attribute a stranger's
      // posts to a former Member of Parliament.
      { platform: 'Twitter/X', handle: 'MpManne', confidence: 'high' },
    ],
  },
  {
    key: 'kharge',
    name: 'Mallikarjun Kharge',
    party: 'Indian National Congress',
    partyTag: 'INC',
    role: 'Congress national president · LoP, Rajya Sabha',
    office: { constituency: 'Karnataka (Rajya Sabha)', state: 'Karnataka', district: 'Kalaburagi' },
    aliases: ['खरगे', 'ఖర్గే', 'मल्लिकार्जुन'],
    handles: [
      { platform: 'Twitter/X', handle: 'kharge', confidence: 'high' },
      // Carried, not scraped: could not be confirmed as his own channel rather
      // than a supporter's or a news outlet's.
      { platform: 'YouTube', handle: 'mallikarjunkharge8172', confidence: 'low' },
    ],
  },
  {
    key: 'akhilesh',
    name: 'Akhilesh Yadav',
    party: 'Samajwadi Party',
    partyTag: 'SP',
    role: 'National president, Samajwadi Party · MP, Kannauj',
    office: { constituency: 'Kannauj', state: 'Uttar Pradesh', district: 'Kannauj' },
    aliases: ['अखिलेश', 'यादव', 'అఖిలేష్'],
    handles: [
      { platform: 'Facebook', handle: 'yadavakhilesh', confidence: 'high' },
      { platform: 'Instagram', handle: 'socialist_akhileshyadav', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'yadavakhilesh', confidence: 'high' },
    ],
  },
  {
    key: 'amitshah',
    name: 'Amit Shah',
    party: 'Bharatiya Janata Party',
    partyTag: 'BJP',
    role: 'Union Home Minister · MP, Gandhinagar',
    office: { constituency: 'Gandhinagar', state: 'Gujarat', district: 'Gandhinagar' },
    aliases: ['अमित शाह', 'అమిత్ షా', 'शाह'],
    handles: [
      { platform: 'Facebook', handle: 'amitshahofficial', confidence: 'high' },
      { platform: 'Instagram', handle: 'amitshahofficial', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'AmitShah', confidence: 'high' },
      { platform: 'YouTube', handle: 'AmitShah', confidence: 'high' },
    ],
  },
  {
    key: 'yogi',
    name: 'Yogi Adityanath',
    party: 'Bharatiya Janata Party',
    partyTag: 'BJP',
    role: 'Chief Minister of Uttar Pradesh',
    office: { constituency: 'Gorakhpur', state: 'Uttar Pradesh', district: 'Gorakhpur' },
    aliases: ['योगी', 'आदित्यनाथ', 'యోగి'],
    handles: [
      { platform: 'Facebook', handle: 'MYogiAdityanath', confidence: 'high' },
      { platform: 'Instagram', handle: 'myogi_adityanath', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'myogiadityanath', confidence: 'high' },
      { platform: 'YouTube', handle: 'myogiadityanath', confidence: 'high' },
    ],
  },
  {
    key: 'bandi',
    name: 'Bandi Sanjay Kumar',
    party: 'Bharatiya Janata Party',
    partyTag: 'BJP',
    role: 'Union MoS Home Affairs · MP, Karimnagar',
    office: { constituency: 'Karimnagar', state: 'Telangana', district: 'Karimnagar' },
    aliases: ['బండి సంజయ్', 'సంజయ్', 'बंडी संजय'],
    handles: [
      { platform: 'Facebook', handle: 'bandisanjaykumar', confidence: 'high' },
      { platform: 'Instagram', handle: 'bandisanjay_bjp', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'bandisanjay_bjp', confidence: 'high' },
      { platform: 'YouTube', handle: 'bandisanjay_bjp', confidence: 'high' },
    ],
  },
  {
    key: 'kishan',
    name: 'G. Kishan Reddy',
    party: 'Bharatiya Janata Party',
    partyTag: 'BJP',
    role: 'Union Minister of Coal & Mines · MP, Secunderabad',
    office: { constituency: 'Secunderabad', state: 'Telangana', district: 'Hyderabad' },
    aliases: ['కిషన్ రెడ్డి', 'కిషన్', 'किशन रेड्डी'],
    handles: [
      { platform: 'Facebook', handle: 'gkishanreddy', confidence: 'high' },
      { platform: 'Instagram', handle: 'gkishanreddyofficial', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'kishanreddybjp', confidence: 'high' },
      { platform: 'YouTube', handle: 'GKishanReddyBJP', confidence: 'high' },
    ],
  },
  {
    key: 'ramchander',
    name: 'N. Ramchander Rao',
    party: 'Bharatiya Janata Party',
    partyTag: 'BJP',
    role: 'President, BJP Telangana',
    office: { constituency: 'Hyderabad', state: 'Telangana', district: 'Hyderabad' },
    aliases: ['రామచందర్ రావు', 'రామచందర్'],
    handles: [
      { platform: 'Facebook', handle: 'ramchanderraonaraparaju', confidence: 'high' },
      { platform: 'Instagram', handle: 'n_ramchanderrao', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'N_RamchanderRao', confidence: 'high' },
      // Carried for the record, skipped by the builder: could not be confirmed
      // as his rather than a namesake.
      { platform: 'LinkedIn', handle: 'in/nramchanderrao', confidence: 'low' },
      { platform: 'YouTube', handle: 'N_Ramchandererao', confidence: 'high' },
    ],
  },
]

/**
 * Who each principal is measured against, and why.
 *
 * Rivals are drawn from PEOPLE above rather than named freely, because a rival
 * with no handles cannot be scraped and would render as an empty column.
 */
export const PAIRINGS: Pairing[] = [
  {
    principal: 'dkaruna',
    rivals: [
      {
        key: 'vamshi',
why: 'Lost Mahabubnagar to her in 2024 by about 4,500 votes, 506,247 to her 510,747, the narrowest margin in Telangana, and remains the Congress claimant on the seat.',
      },
      {
        key: 'manne',
        why: 'The sitting MP she unseated. He held Mahabubnagar for BRS from 2019 with a 77,829-vote majority and was re-fielded in 2024, finishing third.',
      },
      {
        key: 'revanth',
why: 'His own assembly seat, Kodangal, is one of the seven segments inside her Lok Sabha constituency, and the two trade attacks over the Palamuru-Rangareddy lift irrigation scheme.',
      },
    ],
  },
  {
    principal: 'modi',
    rivals: [
{ key: 'rahul', why: 'Leader of the Opposition in the Lok Sabha, the constitutional counterweight on the same floor of the same House.' },
      { key: 'kharge', why: 'Congress national president and Leader of the Opposition in the Rajya Sabha: the party-head counterpart in national messaging.' },
{ key: 'akhilesh', why: 'His party took 37 of Uttar Pradesh’s 80 seats in 2024, the third-largest bloc in the House, in the state where Modi holds Varanasi.' },
    ],
  },
  {
    principal: 'rahul',
    rivals: [
      { key: 'modi', why: 'The standing Prime Minister versus Leader of the Opposition pairing; each answers the other in the Lok Sabha.' },
      { key: 'amitshah', why: 'The government’s designated responder to him in the House, and campaigned against him personally in Rae Bareli in 2024.' },
      { key: 'yogi', why: 'Runs the state that contains Rae Bareli, and has attacked its sitting MP by name at events inside the constituency.' },
    ],
  },
  {
    principal: 'revanth',
    rivals: [
      { key: 'ktr', why: 'BRS working president and the principal opposition attacker on his government; publicly challenged him to an open debate on governance and the agrarian crisis.' },
{ key: 'bandi', why: 'Union Minister of State for Home Affairs and two-term Karimnagar MP, the BJP’s most aggressive day-to-day critic of his record.' },
{ key: 'kishan', why: 'The senior-most Telangana BJP figure in the Union Cabinet, and the one who rebuts him directly on Centre-State disputes.' },
    ],
  },
  {
    principal: 'ktr',
    rivals: [
{ key: 'revanth', why: 'The Chief Minister whose Congress unseated the BRS government in December 2023, the man KTR names almost daily.' },
      { key: 'bandi', why: 'KTR’s own Sircilla seat sits inside Bandi Sanjay’s Karimnagar Lok Sabha constituency, which he won in 2024 by 2.25 lakh votes.' },
{ key: 'ramchander', why: 'BJP’s Telangana state president, his direct organisational counterpart, party chief against party working president.' },
    ],
  },
]

export function personByKey(key: string): Person | undefined {
  return PEOPLE.find((p) => p.key === key)
}

/**
 * The handles worth actually visiting.
 *
 * Anything below `high` is left out. Scraping a profile we could not confirm
 * belongs to this person is how a stranger's posts end up on a politician's
 * dashboard, and the cost of that is far higher than a missing platform column.
 */
export function scrapableHandles(person: Person): RosterHandle[] {
  return person.handles.filter((h) => h.confidence === 'high')
}
