import { scopedKey } from '@/lib/store'
import { deskDayOf, todayDeskDay } from '@/lib/desk-day'

/**
 * The occasions a political office posts on, and the dates it is safe to state.
 *
 * READ THIS BEFORE ADDING A DATE. Half the list below carries a date and half
 * carries null, and the split is not laziness or an unfinished table. It is the
 * only honest way to hold this data in a file that ships months before the day
 * it describes.
 *
 * A fixed-date observance has the same Gregorian date every year because that
 * is how it was defined: Republic Day is 26 January because the Constitution
 * came into force on 26 January, and no reckoning moves it. Storing the month
 * and day for those is not a guess, it is a restatement, and the code below
 * rolls them forward to whichever year is next.
 *
 * A movable festival has no such date. Diwali, Ugadi, Bathukamma, Raksha
 * Bandhan, Janmashtami and Dussehra are fixed on a lunisolar calendar and land
 * on a different Gregorian date every year. Eid, Muharram and Milad un Nabi
 * depend on an actual moon sighting, so their Gregorian date is not merely
 * unknown to this file, it is not settled anywhere until days beforehand. Good
 * Friday and Easter move on the computus. Makar Sankranti is solar and is the
 * worst trap of the lot, because it has fallen on 14 January often enough to
 * look fixed while landing on 15 January in other years and under other local
 * reckonings.
 *
 * So those carry `date: null`, and nothing in this module will invent one. The
 * office enters the date itself, from its own calendar, and that entry is
 * stored per account by `setOccasionDate`.
 *
 * The failure this answers is specific and public. A politician who posts a
 * Diwali greeting on the wrong day has done it in his own name, under his own
 * face, and it screenshots and cannot be recalled. An occasion strip that
 * quietly showed a plausible date would be believed, because the whole point of
 * the strip is that the desk does not have to look the date up. Being asked for
 * the date is a small friction. Being wrong is not recoverable.
 *
 * If you are tempted to fill the gap in from memory: you are remembering one
 * year's date. Every festival below was on a different Gregorian date last year
 * and will be on another one next year, and this file has no way to tell you
 * which year you were thinking of. When in doubt about whether something moves,
 * mark it movable. The cost of that mistake is one extra prompt to the desk.
 * The cost of the other mistake is a screenshot.
 */

/**
 * 'movable' is a kind and also a promise about the data: an occasion is movable
 * if and only if this file refuses to state its Gregorian date. Everything else
 * is dated. Keeping the two in step is what lets the strip decide how to render
 * a row from `kind` alone.
 */
export type OccasionKind = 'national' | 'state' | 'observance' | 'movable'

export interface Occasion {
  id: string
  name: string
  /**
   * ISO date of this year's instance, or null when the date moves and is not
   * known.
   *
   * On a fixed occasion whose day has already gone by, this rolls to next
   * year's instance rather than pointing backwards, so the strip never shows a
   * date in the past. That is why the value is computed and not written into
   * the table below.
   */
  date: string | null
  kind: OccasionKind
  /** One line an office can build a greeting on. Never a claim, never a figure. */
  about: string
}

/* ── the table ───────────────────────────────────────────────────────────── */

/**
 * A fixed observance, held as month and day rather than as a full date.
 *
 * A full date would have to name a year, and a year written into a source file
 * is a bug with a delay fuse: right until January and then silently wrong for
 * twelve months. Month and day are the whole of what is actually known.
 *
 * No rule below falls on 29 February. If one is ever added, it needs a stated
 * answer for common years before it goes in, not a silent roll into 1 March.
 */
interface FixedRule {
  id: string
  name: string
  /** 1 to 12. */
  month: number
  /** 1 to 31, and a real day of that month in every year. */
  day: number
  kind: Exclude<OccasionKind, 'movable'>
  about: string
}

/**
 * The `about` lines describe the day and never attribute words to anyone.
 * Naming Ambedkar as the person a birth anniversary belongs to is a statement
 * about the calendar. Thanking him, quoting him, or having him endorse the desk
 * would be putting words in a dead man's mouth, and no line here does that.
 * None of them carries a figure either, because a figure on a greeting poster
 * is a claim the desk has not been asked to defend.
 */
const FIXED: FixedRule[] = [
  {
    id: 'new-year',
    name: "New Year's Day",
    month: 1,
    day: 1,
    kind: 'observance',
    about: 'The first day of the calendar year, and a day for wishing the constituency well.',
  },
  {
    id: 'national-youth-day',
    name: 'National Youth Day',
    month: 1,
    day: 12,
    kind: 'observance',
    about: 'The birth anniversary of Swami Vivekananda, and a day addressed to young people.',
  },
  {
    id: 'parakram-diwas',
    name: 'Parakram Diwas',
    month: 1,
    day: 23,
    kind: 'observance',
    about: 'The birth anniversary of Subhas Chandra Bose.',
  },
  {
    id: 'voters-day',
    name: 'National Voters Day',
    month: 1,
    day: 25,
    kind: 'observance',
    about: 'A day addressed to voters, and to everyone on the roll for the first time.',
  },
  {
    id: 'republic-day',
    name: 'Republic Day',
    month: 1,
    day: 26,
    kind: 'national',
    about: 'The day the Constitution of India came into force.',
  },
  {
    id: 'martyrs-day',
    name: "Martyrs' Day",
    month: 1,
    day: 30,
    kind: 'observance',
    about: 'The death anniversary of Mahatma Gandhi, observed with two minutes of silence.',
  },
  {
    id: 'national-science-day',
    name: 'National Science Day',
    month: 2,
    day: 28,
    kind: 'observance',
    about: 'A day addressed to science teachers, students and researchers.',
  },
  {
    id: 'womens-day',
    name: "International Women's Day",
    month: 3,
    day: 8,
    kind: 'observance',
    about: 'A day addressed to women in the constituency and to the work they carry.',
  },
  {
    id: 'ambedkar-jayanti',
    name: 'Ambedkar Jayanti',
    month: 4,
    day: 14,
    kind: 'observance',
    about:
      'The birth anniversary of Dr B. R. Ambedkar, who chaired the drafting committee of the Constitution.',
  },
  {
    id: 'labour-day',
    name: "International Workers' Day",
    month: 5,
    day: 1,
    kind: 'observance',
    about: 'A day addressed to workers and to the trades a constituency lives on.',
  },
  {
    id: 'telangana-formation-day',
    name: 'Telangana Formation Day',
    month: 6,
    day: 2,
    kind: 'state',
    about: 'The day Telangana became a state of the Union, in 2014.',
  },
  {
    id: 'yoga-day',
    name: 'International Day of Yoga',
    month: 6,
    day: 21,
    kind: 'observance',
    about: 'A day for the public sessions in the grounds, and for the practice itself.',
  },
  {
    id: 'kargil-vijay-diwas',
    name: 'Kargil Vijay Diwas',
    month: 7,
    day: 26,
    kind: 'observance',
    about: 'A day for the soldiers who fought at Kargil and for their families.',
  },
  {
    id: 'independence-day',
    name: 'Independence Day',
    month: 8,
    day: 15,
    kind: 'national',
    about: 'The day India became independent, in 1947.',
  },
  {
    id: 'teachers-day',
    name: "Teachers' Day",
    month: 9,
    day: 5,
    kind: 'observance',
    about: 'The birth anniversary of Dr S. Radhakrishnan, and a day addressed to teachers.',
  },
  {
    id: 'telangana-language-day',
    name: 'Telangana Language Day',
    month: 9,
    day: 9,
    kind: 'state',
    about:
      'The birth anniversary of Kaloji Narayana Rao, kept in Telangana as a day for Telugu and its writers.',
  },
  {
    id: 'hindi-diwas',
    name: 'Hindi Diwas',
    month: 9,
    day: 14,
    kind: 'observance',
    about: 'A day for Hindi and for the people who teach and work in it.',
  },
  {
    id: 'engineers-day',
    name: "Engineers' Day",
    month: 9,
    day: 15,
    kind: 'observance',
    about: 'The birth anniversary of Sir M. Visvesvaraya, and a day addressed to engineers.',
  },
  {
    id: 'deendayal-jayanti',
    name: 'Pandit Deendayal Upadhyaya Jayanti',
    month: 9,
    day: 25,
    kind: 'observance',
    about: 'The birth anniversary of Pandit Deendayal Upadhyaya.',
  },
  {
    id: 'gandhi-jayanti',
    name: 'Gandhi Jayanti',
    month: 10,
    day: 2,
    kind: 'national',
    about: 'The birth anniversary of Mahatma Gandhi.',
  },
  {
    id: 'shastri-jayanti',
    name: 'Lal Bahadur Shastri Jayanti',
    month: 10,
    day: 2,
    kind: 'observance',
    about: 'The birth anniversary of Lal Bahadur Shastri, kept on the same day as Gandhi Jayanti.',
  },
  {
    id: 'ekta-diwas',
    name: 'Rashtriya Ekta Diwas',
    month: 10,
    day: 31,
    kind: 'national',
    about: 'The birth anniversary of Sardar Vallabhbhai Patel, kept as National Unity Day.',
  },
  {
    id: 'childrens-day',
    name: "Children's Day",
    month: 11,
    day: 14,
    kind: 'observance',
    about: 'The birth anniversary of Jawaharlal Nehru, and a day addressed to schoolchildren.',
  },
  {
    id: 'janjatiya-gaurav-divas',
    name: 'Janjatiya Gaurav Divas',
    month: 11,
    day: 15,
    kind: 'observance',
    about: 'The birth anniversary of Birsa Munda, kept as a day for tribal communities.',
  },
  {
    id: 'constitution-day',
    name: 'Constitution Day',
    month: 11,
    day: 26,
    kind: 'national',
    about: 'The day the Constituent Assembly adopted the Constitution, in 1949.',
  },
  {
    id: 'armed-forces-flag-day',
    name: 'Armed Forces Flag Day',
    month: 12,
    day: 7,
    kind: 'observance',
    about: 'A day for serving soldiers, for veterans and for the families behind them.',
  },
  {
    id: 'good-governance-day',
    name: 'Good Governance Day',
    month: 12,
    day: 25,
    kind: 'observance',
    about: 'The birth anniversary of Atal Bihari Vajpayee, kept as a day for governance.',
  },
  {
    id: 'christmas',
    name: 'Christmas',
    month: 12,
    day: 25,
    kind: 'observance',
    about: 'A day addressed to Christian families in the constituency.',
  },
]

/**
 * A festival whose Gregorian date this file will not state.
 *
 * `why` is not decoration. It is what the strip shows the desk when it asks for
 * a date, and it is the difference between a product that looks unfinished and
 * one that is visibly refusing to guess. An office that reads "set by the lunar
 * calendar, so the date changes every year" understands why it is being asked.
 * An office that reads nothing assumes the software is broken and goes looking
 * for the version that knows Diwali.
 */
interface MovableRule {
  id: string
  name: string
  about: string
  /** Why the Gregorian date moves. Shown beside the field that asks for it. */
  why: string
}

const MOVABLE: MovableRule[] = [
  {
    id: 'makar-sankranti',
    name: 'Makar Sankranti',
    about: 'The harvest festival, and the largest three days in the Telangana calendar.',
    why: 'Sankranti follows the sun entering Makara, which falls on 14 or 15 January depending on the year and the local reckoning. It looks fixed and it is not.',
  },
  {
    id: 'maha-shivaratri',
    name: 'Maha Shivaratri',
    about: 'The night kept for Shiva, when the temples stay open until morning.',
    why: 'Set by the lunar month, so the Gregorian date changes every year.',
  },
  {
    id: 'holi',
    name: 'Holi',
    about: 'The festival of colour, kept at the end of winter.',
    why: 'Set by the full moon of Phalguna, so the Gregorian date changes every year.',
  },
  {
    id: 'ugadi',
    name: 'Ugadi',
    about: 'The Telugu new year, and the day the year ahead is read out.',
    why: 'Set by the lunisolar calendar, so the Gregorian date changes every year.',
  },
  {
    id: 'sri-rama-navami',
    name: 'Sri Rama Navami',
    about: 'Kept across the state, and at Bhadrachalam with the kalyanam.',
    why: 'Set by the lunisolar calendar, so the Gregorian date changes every year.',
  },
  {
    id: 'hanuman-jayanti',
    name: 'Hanuman Jayanti',
    about: 'Kept with the processions and the reading at the temples.',
    why: 'Set by the lunisolar calendar, and kept on different days in Telangana and in the north. The date has to come from the local calendar.',
  },
  {
    id: 'mahavir-jayanti',
    name: 'Mahavir Jayanti',
    about: 'A day addressed to Jain families in the constituency.',
    why: 'Set by the lunisolar calendar, so the Gregorian date changes every year.',
  },
  {
    id: 'good-friday',
    name: 'Good Friday',
    about: 'A day addressed to Christian families in the constituency.',
    why: 'Taken from the date of Easter, which moves every year.',
  },
  {
    id: 'easter',
    name: 'Easter Sunday',
    about: 'A day addressed to Christian families in the constituency.',
    why: 'Set by a lunar rule tied to the spring equinox, so the Gregorian date changes every year.',
  },
  {
    id: 'eid-ul-fitr',
    name: 'Eid ul Fitr',
    about: 'The end of Ramzan, and a day addressed to Muslim families in the constituency.',
    why: 'Set by the sighting of the moon, so the date is not settled anywhere until a day or two beforehand.',
  },
  {
    id: 'eid-ul-adha',
    name: 'Eid ul Adha',
    about: 'Bakrid, and a day addressed to Muslim families in the constituency.',
    why: 'Set by the sighting of the moon, so the date is not settled anywhere until a day or two beforehand.',
  },
  {
    id: 'muharram',
    name: 'Muharram',
    about: 'Kept with the processions, and observed rather than celebrated.',
    why: 'Set by the sighting of the moon, so the date is not settled anywhere until a day or two beforehand.',
  },
  {
    id: 'milad-un-nabi',
    name: 'Milad un Nabi',
    about: 'A day addressed to Muslim families in the constituency.',
    why: 'Set by the sighting of the moon, so the date is not settled anywhere until a day or two beforehand.',
  },
  {
    id: 'buddha-purnima',
    name: 'Buddha Purnima',
    about: 'A day addressed to Buddhist families and to those who follow Ambedkar.',
    why: 'Set by the full moon of Vaisakha, so the Gregorian date changes every year.',
  },
  {
    id: 'bonalu',
    name: 'Bonalu',
    about: 'The Ashada festival of the Hyderabad temples, carried by the women of each street.',
    why: 'Runs through Ashada masam and each temple keeps its own day, notified locally. There is no single date to store.',
  },
  {
    id: 'komaram-bheem-vardhanti',
    name: 'Komaram Bheem Vardhanti',
    about: 'The remembrance of Komaram Bheem, kept in the districts he came from.',
    why: 'Kept on Ashada Pournami, a lunar day, so the Gregorian date changes every year.',
  },
  {
    id: 'raksha-bandhan',
    name: 'Raksha Bandhan',
    about: 'The day sisters tie the rakhi, and a day for what a brother owes.',
    why: 'Set by the full moon of Shravana, so the Gregorian date changes every year.',
  },
  {
    id: 'janmashtami',
    name: 'Krishna Janmashtami',
    about: 'The birth of Krishna, kept through the night.',
    why: 'Set by the lunisolar calendar, and one city can keep it on two different nights by tradition. The date has to come from the local calendar.',
  },
  {
    id: 'vinayaka-chavithi',
    name: 'Vinayaka Chavithi',
    about: 'Ganesh Chaturthi, and the day the mandaps go up across the constituency.',
    why: 'Set by the lunisolar calendar, so the Gregorian date changes every year.',
  },
  {
    id: 'bathukamma',
    name: 'Bathukamma',
    about: "Telangana's own nine days of flowers, ending with Saddula Bathukamma.",
    why: 'Runs nine days from Mahalaya Amavasya, a lunar day, so the Gregorian dates change every year.',
  },
  {
    id: 'dussehra',
    name: 'Dussehra',
    about: 'Vijaya Dashami, and the day of the Jammi leaves in Telangana.',
    why: 'Set by the lunisolar calendar, so the Gregorian date changes every year.',
  },
  {
    id: 'diwali',
    name: 'Diwali',
    about: 'Deepavali, and the lamps put out at every door.',
    why: 'Set by the new moon of Kartika, so the Gregorian date changes every year.',
  },
  {
    id: 'guru-nanak-jayanti',
    name: 'Guru Nanak Jayanti',
    about: 'A day addressed to Sikh families in the constituency.',
    why: 'Set by the full moon of Kartika, so the Gregorian date changes every year.',
  },
]

/* ── day arithmetic ──────────────────────────────────────────────────────── */

const MS_PER_DAY = 86_400_000

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

const isoDay = (year: number, month: number, day: number): string =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}`

/**
 * A 'YYYY-MM-DD' as whole days since the epoch, or null when it is not a real
 * calendar date.
 *
 * `deskDayOf` does the validating, including the round trip that stops
 * `Date.UTC` quietly turning 2027-02-30 into 2 March. Reusing it rather than
 * re-deriving the rule here matters because the office's day boundary is IST
 * and there has to be exactly one thing in this codebase that decides what day
 * it is.
 */
function isDay(day: string): boolean {
  // The empty string has to be excluded by name. `deskDayOf` returns '' for
  // everything it cannot read, so a bare `deskDayOf(day) === day` agrees with
  // itself on '' and waves an empty date field through as though it were a
  // real day. The parse below then reads year, month and date as 0 and lands
  // on 1899, which is a confident wrong answer rather than an absence.
  return day !== '' && deskDayOf(day) === day
}

function dayNumber(day: string): number | null {
  if (!isDay(day)) return null
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  const date = Number(day.slice(8, 10))
  return Math.round(Date.UTC(year, month - 1, date) / MS_PER_DAY)
}

/**
 * Whole days from today to that date. Negative when it has passed.
 *
 * NaN when the string is not a real calendar date, and that is deliberate. Zero
 * would mean "today", which is the most consequential answer this function
 * gives, and handing it back for an unreadable input would put a greeting on
 * the screen for a day nobody established. Every caller in this file checks
 * with Number.isFinite, and a caller on the screen should too.
 */
export function daysUntil(iso: string, today: Date = new Date()): number {
  const target = dayNumber(iso)
  const from = dayNumber(todayDeskDay(today))
  if (target === null || from === null) return Number.NaN
  return target - from
}

/**
 * The next Gregorian date a fixed rule lands on, at or after today.
 *
 * The comparison is on 'YYYY-MM-DD' text, which sorts correctly, so no second
 * parse is needed. Today itself counts as upcoming: on the morning of 26
 * January the desk is posting for this Republic Day, not for next year's.
 */
function nextInstance(rule: FixedRule, today: Date): string | null {
  const from = todayDeskDay(today)
  if (!from) return null
  const year = Number(from.slice(0, 4))
  const thisYear = isoDay(year, rule.month, rule.day)
  return thisYear >= from ? thisYear : isoDay(year + 1, rule.month, rule.day)
}

/* ── dates the office entered by hand ────────────────────────────────────── */

/**
 * Read through a function rather than captured in a constant, same as every
 * other cache here: the active account changes at runtime, and a module-level
 * constant would freeze whichever account was signed in at first import.
 */
export const OCCASION_DATES_KEY = (): string => scopedKey('signal.studio.occasionDates.v1')

/**
 * How far past a stored date is still worth keeping. Long enough that a desk
 * reopening the studio the week after Diwali can see what it entered, short
 * enough that the store does not accumulate a decade of dead festival dates.
 */
const KEEP_PAST_DAYS = 30

/**
 * A typo guard, not a policy. Entering next year's Ugadi thirteen months out is
 * legitimate planning; entering 2036 because the year field was off by a decade
 * is not, and the two are only told apart by distance.
 */
const MAX_AHEAD_DAYS = 500

/** Every date this account has entered, by occasion id. Days, never timestamps. */
export function readOccasionDates(): Record<string, string> {
  try {
    const raw = localStorage.getItem(OCCASION_DATES_KEY())
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: Record<string, string> = {}
    for (const [id, day] of Object.entries(parsed as Record<string, unknown>)) {
      // Validated on the way out as well as on the way in. This is
      // localStorage: a hand-edited or half-written value has to read as "no
      // date entered" rather than reaching a poster.
      if (typeof day === 'string' && isDay(day)) out[id] = day
    }
    return out
  } catch {
    return {}
  }
}

function writeOccasionDates(all: Record<string, string>, today: Date): void {
  const kept: Record<string, string> = {}
  for (const [id, day] of Object.entries(all)) {
    const away = daysUntil(day, today)
    if (Number.isFinite(away) && away >= -KEEP_PAST_DAYS) kept[id] = day
  }
  try {
    localStorage.setItem(OCCASION_DATES_KEY(), JSON.stringify(kept))
  } catch {
    /* private mode, or the quota is full: the date holds for this session, it
       just will not survive a reload */
  }
}

/**
 * The answer to "did that save", phrased so the screen never has to invent copy
 * for a refusal. Same contract as the drafting service in suggest.ts: the
 * sentence comes from whoever knows why.
 */
export type SaveDateResult = { ok: true } | { ok: false; reason: string }

/**
 * Record the date a movable festival falls on this year.
 *
 * Only movable occasions accept one. A fixed date is not the desk's to change,
 * and taking an override for Republic Day would turn the one half of this file
 * that is certain into another thing somebody has to double check.
 *
 * A date already past is refused rather than stored. The desk is recording an
 * upcoming festival, and a past date here almost always means last year's
 * calendar was open in the other tab.
 */
export function setOccasionDate(id: string, day: string, today: Date = new Date()): SaveDateResult {
  if (!MOVABLE.some((m) => m.id === id)) {
    return { ok: false, reason: 'That occasion does not take a date from the office.' }
  }
  const away = isDay(day) ? daysUntil(day, today) : Number.NaN
  if (!Number.isFinite(away)) {
    return { ok: false, reason: 'Enter a real calendar date, as a day, month and year.' }
  }
  if (away < 0) {
    return { ok: false, reason: 'That date has already passed. Enter the date it falls on next.' }
  }
  if (away > MAX_AHEAD_DAYS) {
    return { ok: false, reason: 'That date is well over a year away. Check the year.' }
  }
  writeOccasionDates({ ...readOccasionDates(), [id]: day }, today)
  return { ok: true }
}

/** Forget a date the office entered, so the strip goes back to asking for it. */
export function clearOccasionDate(id: string, today: Date = new Date()): void {
  const all = readOccasionDates()
  if (!(id in all)) return
  delete all[id]
  writeOccasionDates(all, today)
}

/**
 * The date the office entered for a movable occasion, if it is still ahead.
 *
 * A stored date is a statement about one year and expires with it. Diwali
 * entered as 2026-11-08 must not still be on the strip in 2027, where it would
 * read as this year's date and be eleven days wrong. Once the day is past, the
 * occasion goes back to asking, which is the honest state rather than a
 * degraded one.
 */
function enteredDate(id: string, today: Date): string | null {
  const day = readOccasionDates()[id]
  if (!day) return null
  const away = daysUntil(day, today)
  return Number.isFinite(away) && away >= 0 ? day : null
}

/**
 * Where a date on the screen came from.
 *
 * The strip has to say this out loud. A date the office typed in is the
 * office's own claim, checked by nobody, and it must not sit there looking
 * exactly like Republic Day beside it. 'unknown' is the third state and is
 * never zero and never a placeholder date: it means nobody has said.
 */
export type OccasionDateSource = 'fixed' | 'entered' | 'unknown'

export function occasionDateSource(id: string, today: Date = new Date()): OccasionDateSource {
  if (FIXED.some((f) => f.id === id)) return 'fixed'
  return enteredDate(id, today) === null ? 'unknown' : 'entered'
}

/* ── the catalogue ───────────────────────────────────────────────────────── */

const fixedOccasion = (rule: FixedRule, today: Date): Occasion => ({
  id: rule.id,
  name: rule.name,
  date: nextInstance(rule, today),
  kind: rule.kind,
  about: rule.about,
})

const movableOccasion = (rule: MovableRule, date: string | null): Occasion => ({
  id: rule.id,
  name: rule.name,
  date,
  kind: 'movable',
  about: rule.about,
})

/**
 * Every occasion this module knows, including the ones with no date.
 *
 * Built once at import, which is right for the fields that never change and
 * approximate for `date`: the fixed dates are anchored to the moment the module
 * loaded, so a session left open across an occasion would show it a day stale.
 * Movable dates are always null here, because reading localStorage at import
 * would capture whichever account happened to be signed in first.
 *
 * So this is the catalogue, for lists and lookups by id. Anything that renders
 * a date should call `allOccasions(today)` or `occasionStrip`, which re-anchor
 * on every call and merge in what the office has entered.
 */
export const OCCASIONS: Occasion[] = [
  ...FIXED.map((rule) => fixedOccasion(rule, new Date())),
  ...MOVABLE.map((rule) => movableOccasion(rule, null)),
]

/** The catalogue re-anchored to a given day, with the office's own dates merged in. */
export function allOccasions(today: Date = new Date()): Occasion[] {
  return [
    ...FIXED.map((rule) => fixedOccasion(rule, today)),
    ...MOVABLE.map((rule) => movableOccasion(rule, enteredDate(rule.id, today))),
  ]
}

/** One occasion by id, re-anchored. Null when the id is not one this file knows. */
export function occasionById(id: string, today: Date = new Date()): Occasion | null {
  return allOccasions(today).find((o) => o.id === id) ?? null
}

/**
 * Why this occasion carries no date, for the field that asks the office for
 * one. Null for a fixed occasion, which is never asked.
 */
export function occasionDateHint(id: string): string | null {
  return MOVABLE.find((m) => m.id === id)?.why ?? null
}

/* ── what the strip renders ──────────────────────────────────────────────── */

/**
 * Occasions falling within the next N days, soonest first. Never returns a null
 * date.
 *
 * Today counts as inside the window and a day already gone does not, so the
 * strip can never offer a greeting for yesterday. Two occasions can share a
 * date, Gandhi Jayanti and Shastri Jayanti among them, so the tie is broken by
 * name to keep the order stable between renders.
 */
export function upcomingOccasions(withinDays: number, today: Date = new Date()): Occasion[] {
  // A window that is not a number is not a window of every day. Without this
  // guard `away > limit` compares against NaN, is false for every occasion, and
  // the filter lets the whole year through as if the caller had asked for it.
  const limit = Number.isFinite(withinDays) ? Math.max(0, Math.trunc(withinDays)) : 0
  return allOccasions(today)
    .flatMap((occasion) => {
      if (occasion.date === null) return []
      const away = daysUntil(occasion.date, today)
      if (!Number.isFinite(away) || away < 0 || away > limit) return []
      return [{ occasion, away }]
    })
    .sort((a, b) => a.away - b.away || a.occasion.name.localeCompare(b.occasion.name))
    .map((entry) => entry.occasion)
}

/**
 * The movable occasions with no date recorded for the season ahead.
 *
 * Returned rather than dropped, and sorted by name because there is no date to
 * sort them by. An office that opens the studio in October and sees no mention
 * of Diwali concludes the product does not know Diwali exists, goes looking for
 * one that does, and never learns that this one was declining to guess. Greyed
 * out with a field to fill teaches the opposite in one glance.
 */
export function undatedOccasions(today: Date = new Date()): Occasion[] {
  return MOVABLE.filter((rule) => enteredDate(rule.id, today) === null)
    .map((rule) => movableOccasion(rule, null))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface OccasionStrip {
  /** Dated and inside the window, soonest first. */
  upcoming: Occasion[]
  /** Movable, no date recorded. Render greyed, with a way to add the date. */
  undated: Occasion[]
}

/** Both halves of the strip in one call, anchored to the same day. */
export function occasionStrip(withinDays: number, today: Date = new Date()): OccasionStrip {
  return { upcoming: upcomingOccasions(withinDays, today), undated: undatedOccasions(today) }
}

/**
 * How far away, as the strip says it.
 *
 * 'Date not set' for a count that is not a number, never 'In 0 days' and never
 * a blank: an absence has to read as an absence, because 'Today' is the label
 * the desk acts on immediately.
 */
export function daysAwayLabel(days: number): string {
  if (!Number.isFinite(days)) return 'Date not set'
  const whole = Math.trunc(days)
  if (whole === 0) return 'Today'
  if (whole === 1) return 'Tomorrow'
  if (whole === -1) return 'Yesterday'
  if (whole < 0) return `${Math.abs(whole)} days ago`
  return `In ${whole} days`
}

/**
 * The line under a date the office entered itself.
 *
 * The studio generates, which is legitimate, but a generated poster carrying a
 * date nobody verified is the one output here that cannot be taken back. This
 * says who is answerable for the date, in the register the rest of the desk
 * uses for the same job: see the drafted posts footer in Grievances.tsx.
 */
export const ENTERED_DATE_NOTE = 'Date entered by the office. Check it before you post.'

/** The line under the festivals the studio will not date by itself. */
export const MOVABLE_DATE_NOTE =
  'These festivals fall on a different date every year. The studio does not guess them. Add the date from your own calendar.'
