/**
 * The picture library: party marks and leaders' photographs the office can pick
 * from without hunting for a file.
 *
 * REFERENCED, NOT COPIED, and that is the decision the whole file rests on.
 * What is stored is a URL, a licence and a credit; the bytes stay on Wikimedia
 * and are fetched by the reader's own browser. The alternative was to download
 * these into public/ and commit them, which is faster and works offline, and
 * would have meant this repository, which is public, REPUBLISHING sixty
 * photographs and party marks to anybody who clones it. An office putting its
 * own party's symbol on its own greeting card is ordinary political life. A
 * piece of software shipping every party's symbol to everybody is a
 * distribution, and a distribution is what a licence actually governs.
 *
 * WHY THERE ARE SO FEW PORTRAITS HERE.
 *
 * There were thirty-five. The owner looked at them and said one was usable.
 * They were right, and the reason is not licence or resolution, which is all
 * the first round measured. It is that a poster CUTS ITS FIGURES OUT: the
 * renderer floods inwards from the frame edge and removes the connected pale
 * backdrop, so the person stands on the card's own colour. That works on a
 * studio wall and does nothing whatever on a photograph taken at an event, and
 * a four thousand pixel picture of somebody at a podium is worth less here
 * than a six hundred pixel one of them against a white sweep.
 *
 * So the whole set was hunted again against six tests, every candidate opened
 * and looked at rather than read about, and then judged a second time by
 * somebody whose job was to reject. Thirty-two proposals, seven survived. Three
 * of the rejections were marked "pass" by the hunter who found them and would
 * have shipped a mutilated figure: one party leader whose white kurta dissolved
 * with the wall and left a floating head, one whose saree was torn open while
 * the wall stayed, and one lit brighter than his own background so that no
 * threshold existed that could separate them.
 *
 * WHAT IS MISSING IS MISSING ON PURPOSE. Arvind Kejriwal, Mallikarjun Kharge,
 * Rajnath Singh, M. K. Stalin, Chandrababu Naidu and most chief ministers have
 * no entry, because Wikimedia has no photograph of them that survives being cut
 * out. An empty slot asks the office to upload their own file, which is a fine
 * outcome and the one the studio is built for. A bad portrait goes out on a
 * poster under a Member of Parliament's name, which is not.
 *
 * EVERY STATE IS STILL HERE AS A FACT, with the party holding it and the month
 * it took office, whether or not a usable portrait exists. Those two things are
 * separate: `secondLeaderRule` in party-brand.ts needs to know who governs
 * Telangana in order to decide whether a chief minister belongs on this desk's
 * card at all, and that question has an answer even where the picture does not.
 * A row with a null `url` is exactly that: a fact without a face.
 *
 * THREE THINGS A FREE LICENCE DOES NOT GIVE YOU, recorded per entry in
 * `caution`: TRADEMARK, since every party mark below is free of copyright and
 * is still that party's mark; ENDORSEMENT, since most portraits are GODL-India
 * and that licence forbids use suggesting the government backs you; and
 * PERSONALITY, since a licence is the photographer's permission and never the
 * subject's.
 *
 * THE URLS ARE FIXED AND MUST NOT BE REWRITTEN. upload.wikimedia.org serves
 * only the widths already rendered for that particular file and returns HTTP
 * 400 for the rest, and the set differs file by file: on one portrait 250, 500,
 * 960 and 1280 work while 320, 400, 512, 640, 800 and 1024 all fail. Every URL
 * below was fetched. Anything that builds a URL by swapping the number in it
 * will work in testing and break on a picture nobody tried.
 */

/** A mark is a party's symbol; a leader is a person. */
export type PictureKind = 'mark' | 'leader'

export interface Picture {
  id: string
  /** What somebody picking from a list would call it. */
  label: string
  kind: PictureKind
  /** The party it belongs to, by the short form `party-brand.ts` uses. */
  party: string | null
  /** The state, for a chief minister. Null for everything else. */
  state: string | null
  /** The office holder's own party, so a desk can tell whether it is theirs. */
  holderParty: string | null
  /** The month they took office, so an out of date row can be recognised. */
  since: string | null
  /**
   * The exact URL that was fetched and confirmed, or NULL where this row is a
   * fact without a face: the office is known and no photograph of them survives
   * being cut out. Never build a URL from this one.
   */
  url: string | null
  /** The full size original, tried when the rendered thumbnail has gone. */
  fullUrl: string | null
  /** The file page, where the licence is stated. */
  source: string | null
  licence: string | null
  /** The credit the licence requires, or null where it requires none. */
  credit: string | null
  /** What this picture carries beyond copyright, in one line. */
  caution: string | null
}

/** The date the office holders below were checked. */
export const CHECKED_ON = '1 September 2026'

export const PICTURES: Picture[] = [
  {
    id: 'inc-hand-symbol',
    label: 'Indian National Congress hand symbol',
    kind: 'mark',
    party: 'INC',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Hand_INC.svg/960px-Hand_INC.svg.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/d/d7/Hand_INC.svg',
    source: 'https://commons.wikimedia.org/wiki/File:Hand_INC.svg',
    licence: 'CC BY-SA 3.0',
    credit: 'Furfur, CC BY-SA 3.0, via Wikimedia Commons',
    caution: 'A party\'s mark is its trademark as well as a picture. Yours to use for your own party\'s communication, and nobody else’s to borrow.',
  },
  {
    id: 'bjp-lotus-logo',
    label: 'BJP lotus logo',
    kind: 'mark',
    party: 'BJP',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Logo_of_the_Bharatiya_Janata_Party.svg/960px-Logo_of_the_Bharatiya_Janata_Party.svg.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/7/78/Logo_of_the_Bharatiya_Janata_Party.svg',
    source: 'https://commons.wikimedia.org/wiki/File:Logo_of_the_Bharatiya_Janata_Party.svg',
    licence: 'PD-ineligible',
    credit: null,
    caution: 'A party\'s mark is its trademark as well as a picture. Yours to use for your own party\'s communication, and nobody else’s to borrow.',
  },
  {
    id: 'ysrcp-ceiling-fan',
    label: 'YSRCP ceiling fan election symbol',
    kind: 'mark',
    party: 'YSRCP',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Indian_Election_Symbol_Ceiling_Fan.svg/960px-Indian_Election_Symbol_Ceiling_Fan.svg.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/6d/Indian_Election_Symbol_Ceiling_Fan.svg',
    source: 'https://commons.wikimedia.org/wiki/File:Indian_Election_Symbol_Ceiling_Fan.svg',
    licence: 'CC BY-SA 4.0',
    credit: 'Abilngeorge, CC BY-SA 4.0, via Wikimedia Commons',
    caution: 'A party\'s mark is its trademark as well as a picture. Yours to use for your own party\'s communication, and nobody else’s to borrow.',
  },
  {
    id: 'tdp-bicycle',
    label: 'TDP bicycle election symbol',
    kind: 'mark',
    party: 'TDP',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/2/25/Indian_Election_Symbol_Cycle_%28cropped%29.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/2/25/Indian_Election_Symbol_Cycle_%28cropped%29.png',
    source: 'https://commons.wikimedia.org/wiki/File:Indian_Election_Symbol_Cycle_(cropped).png',
    licence: 'CC BY-SA 4.0',
    credit: 'Abilngeorge, CC BY-SA 4.0, via Wikimedia Commons',
    caution: 'A party\'s mark is its trademark as well as a picture. Yours to use for your own party\'s communication, and nobody else’s to borrow.',
  },
  {
    id: 'aap-logo',
    label: 'Aam Aadmi Party logo',
    kind: 'mark',
    party: 'AAP',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Aam_Aadmi_Party_logo.svg/960px-Aam_Aadmi_Party_logo.svg.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/8/83/Aam_Aadmi_Party_logo.svg',
    source: 'https://commons.wikimedia.org/wiki/File:Aam_Aadmi_Party_logo.svg',
    licence: 'PD-textlogo',
    credit: null,
    caution: 'Wikimedia has an open question over whether this mark is a copyright work at all. Worth a second look before a print run.',
  },
  {
    id: 'dmk-rising-sun',
    label: 'DMK rising sun election symbol',
    kind: 'mark',
    party: 'DMK',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Indian_election_symbol_rising_sun.svg/960px-Indian_election_symbol_rising_sun.svg.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/1/1b/Indian_election_symbol_rising_sun.svg',
    source: 'https://commons.wikimedia.org/wiki/File:Indian_election_symbol_rising_sun.svg',
    licence: 'CC BY-SA 4.0',
    credit: 'Furfur, CC BY-SA 4.0, via Wikimedia Commons',
    caution: 'A party\'s mark is its trademark as well as a picture. Yours to use for your own party\'s communication, and nobody else’s to borrow.',
  },
  {
    id: 'aiadmk-two-leaves',
    label: 'AIADMK two leaves election symbol',
    kind: 'mark',
    party: 'AIADMK',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Indian_election_symbol_two_leaves.svg/960px-Indian_election_symbol_two_leaves.svg.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/8/8b/Indian_election_symbol_two_leaves.svg',
    source: 'https://commons.wikimedia.org/wiki/File:Indian_election_symbol_two_leaves.svg',
    licence: 'CC BY-SA 4.0',
    credit: 'Furfur, CC BY-SA 4.0, via Wikimedia Commons',
    caution: 'A party\'s mark is its trademark as well as a picture. Yours to use for your own party\'s communication, and nobody else’s to borrow.',
  },
  {
    id: 'sp-bicycle',
    label: 'Samajwadi Party bicycle election symbol',
    kind: 'mark',
    party: 'SP',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/b/b2/Indian_Election_Symbol_Cycle.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/b2/Indian_Election_Symbol_Cycle.png',
    source: 'https://commons.wikimedia.org/wiki/File:Indian_Election_Symbol_Cycle.png',
    licence: 'CC BY-SA 4.0',
    credit: 'Abilngeorge, CC BY-SA 4.0, via Wikimedia Commons',
    caution: 'A party\'s mark is its trademark as well as a picture. Yours to use for your own party\'s communication, and nobody else’s to borrow.',
  },
  {
    id: 'ncp-clock',
    label: 'NCP clock election symbol',
    kind: 'mark',
    party: 'NCP',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Clock_symbol_of_NCP.png/960px-Clock_symbol_of_NCP.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/0e/Clock_symbol_of_NCP.png',
    source: 'https://commons.wikimedia.org/wiki/File:Clock_symbol_of_NCP.png',
    licence: 'CC BY-SA 4.0',
    credit: 'Atharvgairola692004, CC BY-SA 4.0, via Wikimedia Commons',
    caution: 'This symbol is the subject of an order of the Supreme Court between the party\'s two factions.',
  },
  {
    id: 'jdu-arrow',
    label: 'JD(U) arrow election symbol',
    kind: 'mark',
    party: 'JD(U)',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/Indian_Election_Symbol_Arrow.svg/960px-Indian_Election_Symbol_Arrow.svg.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/f/f8/Indian_Election_Symbol_Arrow.svg',
    source: 'https://commons.wikimedia.org/wiki/File:Indian_Election_Symbol_Arrow.svg',
    licence: 'GFDL and CC BY-SA 3.0 dual',
    credit: 'Abilngeorge, CC BY-SA 3.0, via Wikimedia Commons',
    caution: 'A party\'s mark is its trademark as well as a picture. Yours to use for your own party\'s communication, and nobody else’s to borrow.',
  },
  {
    id: 'rjd-hurricane-lamp',
    label: 'RJD hurricane lamp (lantern) election symbol',
    kind: 'mark',
    party: 'RJD',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/9/95/Indian_Election_Symbol_Hurricane_Lamp.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/9/95/Indian_Election_Symbol_Hurricane_Lamp.png',
    source: 'https://commons.wikimedia.org/wiki/File:Indian_Election_Symbol_Hurricane_Lamp.png',
    licence: 'CC BY-SA 4.0',
    credit: 'Abilngeorge, CC BY-SA 4.0, via Wikimedia Commons',
    caution: 'A party\'s mark is its trademark as well as a picture. Yours to use for your own party\'s communication, and nobody else’s to borrow.',
  },
  {
    id: 'cpim-hammer-sickle-star',
    label: 'CPI(M) hammer, sickle and star election symbol',
    kind: 'mark',
    party: 'CPI(M)',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/CPI%28M%29_Election_symbol.png/960px-CPI%28M%29_Election_symbol.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/CPI%28M%29_Election_symbol.png',
    source: 'https://commons.wikimedia.org/wiki/File:CPI(M)_Election_symbol.png',
    licence: 'CC BY-SA 4.0',
    credit: 'Soumava2002, CC BY-SA 4.0, via Wikimedia Commons',
    caution: 'A party\'s mark is its trademark as well as a picture. Yours to use for your own party\'s communication, and nobody else’s to borrow.',
  },
  {
    id: 'janasena-glass-tumbler',
    label: 'Jana Sena glass tumbler election symbol',
    kind: 'mark',
    party: 'Jana Sena',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Indian_election_symbol_glass_tumbler.svg/960px-Indian_election_symbol_glass_tumbler.svg.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/0/02/Indian_election_symbol_glass_tumbler.svg',
    source: 'https://commons.wikimedia.org/wiki/File:Indian_election_symbol_glass_tumbler.svg',
    licence: 'CC BY-SA 4.0',
    credit: 'Eelelectric25, CC BY-SA 4.0, via Wikimedia Commons',
    caution: 'A party\'s mark is its trademark as well as a picture. Yours to use for your own party\'s communication, and nobody else’s to borrow.',
  },
  {
    id: 'pm-narendra-modi',
    label: 'Narendra Modi, Prime Minister',
    kind: 'leader',
    party: 'BJP',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Official_portrait_of_the_Prime_Minister_Narendra_Modi%2C_November_2020_%28cropped%29.jpg/960px-Official_portrait_of_the_Prime_Minister_Narendra_Modi%2C_November_2020_%28cropped%29.jpg',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/be/Official_portrait_of_the_Prime_Minister_Narendra_Modi%2C_November_2020_%28cropped%29.jpg',
    source: 'https://commons.wikimedia.org/wiki/File:Official_portrait_of_the_Prime_Minister_Narendra_Modi,_November_2020_(cropped).jpg',
    licence: 'GODL-India',
    credit: 'Government of India (PMO) — attribution required',
    caution: 'A government photograph. The licence asks for the credit below and forbids any use that suggests the government endorses you.',
  },
  {
    id: 'pm-narendra-modi-tall',
    label: 'Narendra Modi, Prime Minister',
    kind: 'leader',
    party: 'BJP',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Official_portrait_of_the_Prime_Minister_Narendra_Modi%2C_November_2020_%28cropped_2%29.jpg/960px-Official_portrait_of_the_Prime_Minister_Narendra_Modi%2C_November_2020_%28cropped_2%29.jpg',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/3d/Official_portrait_of_the_Prime_Minister_Narendra_Modi%2C_November_2020_%28cropped_2%29.jpg',
    source: 'https://commons.wikimedia.org/wiki/File:Official_portrait_of_the_Prime_Minister_Narendra_Modi,_November_2020_(cropped_2).jpg',
    licence: 'GODL-India',
    credit: 'Government of India (PMO) — attribution required',
    caution: 'A government photograph. The licence asks for the credit below and forbids any use that suggests the government endorses you.',
  },
  {
    id: 'fm-nirmala-sitharaman',
    label: 'Nirmala Sitharaman, Union Minister of Finance and Corporate Affairs',
    kind: 'leader',
    party: 'BJP',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Am_11._April_2025_empfing_Au%C3%9Fenministerin_Beate_Meinl-Reisinger_die_indische_Finanzministerin_Nirmala_Sitharaman_in_Wien_%2854445397025%29_%28cropped%29.jpg/500px-Am_11._April_2025_empfing_Au%C3%9Fenministerin_Beate_Meinl-Reisinger_die_indische_Finanzministerin_Nirmala_Sitharaman_in_Wien_%2854445397025%29_%28cropped%29.jpg',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/2/26/Am_11._April_2025_empfing_Au%C3%9Fenministerin_Beate_Meinl-Reisinger_die_indische_Finanzministerin_Nirmala_Sitharaman_in_Wien_%2854445397025%29_%28cropped%29.jpg',
    source: 'https://commons.wikimedia.org/wiki/File:Am_11._April_2025_empfing_Au%C3%9Fenministerin_Beate_Meinl-Reisinger_die_indische_Finanzministerin_Nirmala_Sitharaman_in_Wien_(54445397025)_(cropped).jpg',
    licence: 'CC BY 2.0',
    credit: 'Bundesministerium für europäische und internationale Angelegenheiten (Austrian Federal Ministry for European and International Affairs) — attribution required',
    caution: null,
  },
  {
    id: 'inc-rahul-gandhi',
    label: 'Rahul Gandhi, Leader of the Opposition, Lok Sabha',
    kind: 'leader',
    party: 'INC',
    state: null,
    holderParty: null,
    since: null,
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Rahul_Gandhi.jpg/960px-Rahul_Gandhi.jpg',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/e5/Rahul_Gandhi.jpg',
    source: 'https://commons.wikimedia.org/wiki/File:Rahul_Gandhi.jpg',
    licence: 'GODL-India',
    credit: 'Prime Minister\'s Office (GODL-India)',
    caution: 'A government photograph. The licence asks for the credit below and forbids any use that suggests the government endorses you.',
  },
  {
    id: 'cm-andhra-pradesh',
    label: 'N. Chandrababu Naidu, CM of Andhra Pradesh',
    kind: 'leader',
    party: null,
    state: 'Andhra Pradesh',
    holderParty: 'TDP',
    since: 'June 2024',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-assam',
    label: 'Himanta Biswa Sarma, CM of Assam',
    kind: 'leader',
    party: null,
    state: 'Assam',
    holderParty: 'BJP',
    since: 'May 2021',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-bihar',
    label: 'Samrat Choudhary, Chief Minister of Bihar, BJP, April 2026',
    kind: 'leader',
    party: null,
    state: 'Bihar',
    holderParty: 'BJP',
    since: 'April 2026',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Samrat_Chaudhry_Cm_cutout.png/1280px-Samrat_Chaudhry_Cm_cutout.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/e9/Samrat_Chaudhry_Cm_cutout.png',
    source: 'https://commons.wikimedia.org/wiki/File:Samrat_Chaudhry_Cm_cutout.png',
    licence: 'GODL-India',
    credit: 'Government of Bihar - state.bihar.gov.in, GODL-India',
    caution: 'A government photograph. The licence asks for the credit below and forbids any use that suggests the government endorses you.',
  },
  {
    id: 'cm-chhattisgarh',
    label: 'Vishnu Deo Sai, CM of Chhattisgarh',
    kind: 'leader',
    party: null,
    state: 'Chhattisgarh',
    holderParty: 'BJP',
    since: 'December 2023',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-delhi',
    label: 'Rekha Gupta, CM of Delhi',
    kind: 'leader',
    party: null,
    state: 'Delhi (NCT, union territory with legislature)',
    holderParty: 'BJP',
    since: 'February 2025',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-goa',
    label: 'Pramod Sawant, CM of Goa',
    kind: 'leader',
    party: null,
    state: 'Goa',
    holderParty: 'BJP',
    since: 'March 2019',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-gujarat',
    label: 'Bhupendra Patel, CM of Gujarat',
    kind: 'leader',
    party: null,
    state: 'Gujarat',
    holderParty: 'BJP',
    since: 'September 2021',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-haryana',
    label: 'Nayab Singh Saini, CM of Haryana',
    kind: 'leader',
    party: null,
    state: 'Haryana',
    holderParty: 'BJP',
    since: 'March 2024',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-himachal-pradesh',
    label: 'Sukhvinder Singh Sukhu, CM of Himachal Pradesh',
    kind: 'leader',
    party: null,
    state: 'Himachal Pradesh',
    holderParty: 'INC',
    since: 'December 2022',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-jammu-and-kashmir',
    label: 'Omar Abdullah, CM of Jammu and Kashmir',
    kind: 'leader',
    party: null,
    state: 'Jammu and Kashmir (union territory with legislature)',
    holderParty: 'JKNC',
    since: 'October 2024',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-jharkhand',
    label: 'Hemant Soren, Chief Minister of Jharkhand, JMM, July 2024',
    kind: 'leader',
    party: null,
    state: 'Jharkhand',
    holderParty: 'JMM',
    since: 'July 2024',
    url: 'https://upload.wikimedia.org/wikipedia/commons/5/56/Cm_260226.jpg',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/5/56/Cm_260226.jpg',
    source: 'https://commons.wikimedia.org/wiki/File:Cm_260226.jpg',
    licence: 'GODL-India',
    credit: 'Chief Minister\'s Office, Government of Jharkhand - cm.jharkhand.gov.in, GODL-India',
    caution: 'A government photograph. The licence asks for the credit below and forbids any use that suggests the government endorses you.',
  },
  {
    id: 'cm-karnataka',
    label: 'D. K. Shivakumar, CM of Karnataka',
    kind: 'leader',
    party: null,
    state: 'Karnataka',
    holderParty: 'INC',
    since: 'June 2026',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-kerala',
    label: 'V. D. Satheesan, CM of Kerala',
    kind: 'leader',
    party: null,
    state: 'Kerala',
    holderParty: 'UDF',
    since: 'May 2026',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-madhya-pradesh',
    label: 'Mohan Yadav, CM of Madhya Pradesh',
    kind: 'leader',
    party: null,
    state: 'Madhya Pradesh',
    holderParty: 'BJP',
    since: 'December 2023',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-meghalaya',
    label: 'Conrad Sangma, CM of Meghalaya',
    kind: 'leader',
    party: null,
    state: 'Meghalaya',
    holderParty: 'NPP',
    since: 'March 2018',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-mizoram',
    label: 'Lalduhoma, CM of Mizoram',
    kind: 'leader',
    party: null,
    state: 'Mizoram',
    holderParty: 'ZPM',
    since: 'December 2023',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-nagaland',
    label: 'Neiphiu Rio, CM of Nagaland',
    kind: 'leader',
    party: null,
    state: 'Nagaland',
    holderParty: 'NPF',
    since: 'March 2018',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-odisha',
    label: 'Mohan Charan Majhi, Chief Minister of Odisha, BJP, since June 2024',
    kind: 'leader',
    party: null,
    state: 'Odisha',
    holderParty: 'BJP',
    since: 'June 2024',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Cm_blue_front_png_withoutbackground.png/500px-Cm_blue_front_png_withoutbackground.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/a8/Cm_blue_front_png_withoutbackground.png',
    source: 'https://commons.wikimedia.org/wiki/File:Cm_blue_front_png_withoutbackground.png',
    licence: 'GODL-India',
    credit: 'Attribution required. The file page names no human author; the source field is the Chief Minister\'s Office, Government of Odisha (cm.odisha.gov.in). Credit as: Chief Minister\'s Office, Government of Odisha (GODL-India).',
    caution: 'A government photograph. The licence asks for the credit below and forbids any use that suggests the government endorses you.',
  },
  {
    id: 'cm-puducherry',
    label: 'N. Rangaswamy, CM of Puducherry',
    kind: 'leader',
    party: null,
    state: 'Puducherry (union territory with legislature)',
    holderParty: 'AINRC',
    since: 'May 2021',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-punjab',
    label: 'Bhagwant Mann, CM of Punjab',
    kind: 'leader',
    party: null,
    state: 'Punjab',
    holderParty: 'AAP',
    since: 'March 2022',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-rajasthan',
    label: 'Bhajan Lal Sharma, CM of Rajasthan',
    kind: 'leader',
    party: null,
    state: 'Rajasthan',
    holderParty: 'BJP',
    since: 'December 2023',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-sikkim',
    label: 'Prem Singh Tamang, CM of Sikkim',
    kind: 'leader',
    party: null,
    state: 'Sikkim',
    holderParty: 'SKM',
    since: 'May 2019',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-telangana',
    label: 'Revanth Reddy, CM of Telangana',
    kind: 'leader',
    party: null,
    state: 'Telangana',
    holderParty: 'INC',
    since: 'December 2023',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-tripura',
    label: 'Manik Saha, CM of Tripura',
    kind: 'leader',
    party: null,
    state: 'Tripura',
    holderParty: 'BJP',
    since: 'May 2022',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-uttar-pradesh',
    label: 'Yogi Adityanath, CM of Uttar Pradesh',
    kind: 'leader',
    party: null,
    state: 'Uttar Pradesh',
    holderParty: 'BJP',
    since: 'March 2017',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-uttarakhand',
    label: 'Pushkar Singh Dhami, CM of Uttarakhand',
    kind: 'leader',
    party: null,
    state: 'Uttarakhand',
    holderParty: 'BJP',
    since: 'July 2021',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
  {
    id: 'cm-west-bengal',
    label: 'Suvendu Adhikari, CM of West Bengal',
    kind: 'leader',
    party: null,
    state: 'West Bengal',
    holderParty: 'BJP',
    since: 'May 2026',
    url: null,
    fullUrl: null,
    source: null,
    licence: null,
    credit: null,
    caution: null,
  },
]

/** Only the rows that carry a picture. Everything a picker may offer. */
const SHOWN = PICTURES.filter((p) => p.url !== null)

const BY_ID = new Map(PICTURES.map((p) => [p.id, p]))
const BY_URL = new Map(SHOWN.map((p) => [p.url as string, p]))

export const pictureById = (id: string): Picture | null => BY_ID.get(id) ?? null

/**
 * The picture a stored slot is holding, or null when the office uploaded their
 * own file.
 *
 * This is how a credit survives a reload. The desk's brand store keeps a URL
 * and nothing else, which is all it needs to draw the poster, and the licence
 * and the credit are recovered from here rather than duplicated into storage
 * where they could drift out of step with this table.
 */
export const pictureByUrl = (url: string | null): Picture | null =>
  url === null ? null : (BY_URL.get(url) ?? null)

/** Every mark this library holds for a party. Empty when it holds none. */
export function marksFor(party: string | null): Picture[] {
  if (!party) return []
  return SHOWN.filter((p) => p.kind === 'mark' && p.party === party)
}

/**
 * The figures a desk of this party would put on a poster.
 *
 * A desk of a party with no entry gets an empty list and an upload slot, which
 * is the right answer: this library will never be complete, and offering a
 * Congress desk the prime minister because he is the only face on file would be
 * worse than offering nothing.
 */
export function leadersFor(party: string | null): Picture[] {
  if (!party) return []
  return SHOWN.filter((p) => p.kind === 'leader' && p.party === party)
}

/**
 * The chief minister of a state, WITH OR WITHOUT a portrait.
 *
 * Returns the fact, because the caller that matters is the rule deciding
 * whether a chief minister belongs on this desk's card, and that decision turns
 * on which party holds the state rather than on whether a photograph exists.
 * Check `url` before offering it as a picture.
 */
export function chiefMinisterOf(state: string | null): Picture | null {
  if (!state) return null
  const want = state.trim().toLowerCase()
  return PICTURES.find((p) => p.state !== null && p.state.toLowerCase() === want) ?? null
}

/**
 * The credit line for a set of pictures, or null when none of them needs one.
 *
 * Deduplicated, because two portraits from the Prime Minister's Office under
 * the same licence are one credit and not two, and a poster with the same
 * sentence printed twice under it looks like a fault rather than a courtesy.
 */
export function creditLine(pictures: (Picture | null)[]): string | null {
  const seen = new Set<string>()
  for (const p of pictures) {
    if (p?.credit) seen.add(p.credit)
  }
  return seen.size === 0 ? null : Array.from(seen).join(' \u00b7 ')
}

/** Everything a set of pictures asks the office to be careful about. */
export function cautions(pictures: (Picture | null)[]): string[] {
  const seen = new Set<string>()
  for (const p of pictures) {
    if (p?.caution) seen.add(p.caution)
  }
  return Array.from(seen)
}
