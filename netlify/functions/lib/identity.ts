import { fetchText } from './fetcher'
import {
  qidForArticle,
  wikidataFacts,
  tidyConstituency,
  tidyRole,
  type WikidataFacts,
} from './wikidata'
import { infoboxFor, tidyOffice, type InfoboxFacts } from './infobox'
import { discoverHandlesGrounded, groundedSearchAvailable } from './grounded'
import { tidyParty, partyAbbreviation } from '../../../shared/identity'
import { resolvePlace, stateCorroborated } from '../../../shared/places'
import { parseMetadata } from './metadata'
import { complete } from './openai-compat'
import { resolveProviders } from './provider'
import {
  statedIdentity,
  watchTermsFor,
  type Confidence,
  type Identity,
  type IdentityField,
  type IdentityOrigin,
  type IdentitySource,
  type SocialHandle,
} from '../../../shared/identity'

/**
 * Work out who somebody is from a public profile address.
 *
 * The office arrives with a link — their X account, their Facebook page, a
 * Wikipedia article, the assembly's own member page — and this turns it into
 * the card at the top of their dashboard: photograph, seat, party, a couple of
 * sentences, and the words the news scan will search on tomorrow morning.
 *
 * The whole design problem here is that a language model will happily fill in
 * a party affiliation and a date of birth for any Indian name you hand it,
 * with total fluency and no source. For an office whose actual problem is
 * fabricated claims circulating about them, an identity card that confidently
 * states the wrong constituency is not a rough edge — it is the product doing
 * the thing it exists to fight.
 *
 * So three rules, enforced here rather than left to the prompt:
 *
 *   1. The model only ever reads text this function fetched. It is never asked
 *      what it knows, only what the page in front of it says.
 *   2. Anything the page does not state comes back null. The prompt says so,
 *      the schema allows it, and `sanitise` below drops values the fetched text
 *      cannot support.
 *   3. Every surviving field carries where it came from and how sure the read
 *      was, and the card renders low confidence differently. An office can then
 *      correct it in one tap, which is the only real fix.
 *
 * What this deliberately does NOT do is search the web. That needs a search key
 * the deployment does not have, and a model asked to search without one simply
 * invents the results. When the office gives no URL, this returns what they
 * typed and says plainly that nothing was looked up.
 */

/** One page read, and how long it may take. */
const FETCH_TIMEOUT_MS = 10_000

/**
 * How much of a page the model sees.
 *
 * Sized against Groq's per-minute ceiling, which counts the prompt before it
 * generates anything. A Wikipedia lead section and an infobox both land inside
 * this; the rest of a long article is biography the card has no room for.
 */
const PAGE_TEXT_LIMIT = 6_000

/** Ceiling on how many extra pages one resolve will read. */
const MAX_EXTRA_PAGES = 2

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

const str = (description: string) => ({
  type: ['string', 'null'] as const,
  description,
})

const obj = <T extends Record<string, unknown>>(properties: T) => ({
  type: 'object' as const,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})

const CONFIDENCE_ENUM = {
  type: 'string' as const,
  enum: ['high', 'medium', 'low'],
  description:
    'high: the page states this outright. medium: the page implies it clearly. low: you are reading between the lines.',
}

const IDENTITY_SCHEMA: Record<string, unknown> = obj({
  name: str('The person’s full name as the page writes it. Never null.'),
  aliases: {
    type: 'array' as const,
    items: { type: 'string' as const },
    description:
      'Other spellings the page shows, including the native-script form (Telugu, Hindi, Tamil) when present. Empty array when the page shows none.',
  },
  role: str('The office they hold NOW: "MLA", "Member of Parliament", "Minister for Roads and Buildings". A biography lists every post someone has ever held — read the tense and the dates, and give the one that has not ended. Null when the page does not make the current one clear.'),
  party: str('Political party, when the page names one. Null otherwise. Never guess from the state or the region.'),
  constituency: str('The seat they represent NOW. A page that says someone represented a seat "between 2014 and 2018" is describing a seat they have LEFT — do not report it. Null when the page names only former seats.'),
  district: str('District, when named. Null otherwise.'),
  state: str('Indian state or union territory, when named. Null otherwise.'),
  dateOfBirth: str('Date of birth as an ISO date (YYYY-MM-DD), or just the year (YYYY) when only a year is given. Null when the page does not state it. Do not compute this from an age.'),
  age: {
    type: ['integer', 'null'] as const,
    description:
      'Age in years, ONLY when the page states an age outright. Null when the page gives only a date of birth — the app computes it. Null when the page says nothing.',
  },
  education: str('Highest qualification the page names. Null otherwise.'),
  inOfficeSince: str('When they took the current office, in the page’s own words: "2019", "May 2024". Null otherwise.'),
  bio: str('Two or three sentences a stranger could read to know who this is, drawn only from this page. Neutral, factual, no praise and no criticism. Null when there is not enough on the page.'),
  handles: {
    type: 'array' as const,
    description:
      'Social accounts this page links to or names as belonging to this person. Empty array when there are none. Never construct a handle you did not see.',
    items: obj({
      platform: {
        type: 'string' as const,
        description: 'Platform name: X, Facebook, Instagram, YouTube, LinkedIn, Telegram.',
      },
      handle: { type: 'string' as const, description: 'The @name or page name.' },
      url: { type: 'string' as const, description: 'The full address, exactly as the page gives it.' },
    }),
  },
  confidence: obj({
    role: CONFIDENCE_ENUM,
    party: CONFIDENCE_ENUM,
    constituency: CONFIDENCE_ENUM,
    dateOfBirth: CONFIDENCE_ENUM,
    education: CONFIDENCE_ENUM,
    inOfficeSince: CONFIDENCE_ENUM,
    bio: CONFIDENCE_ENUM,
  }),
  notes: {
    type: 'array' as const,
    items: { type: 'string' as const },
    description:
      'PROBLEMS ONLY. A login wall instead of a profile; two different people sharing this name; the page looking years out of date; the page being about somebody else. An empty array is the normal and expected answer — most pages have nothing wrong with them. Do NOT describe the page, do NOT say what you read, do NOT confirm that things went well. A reader shown three meaningless notices stops reading the fourth, and the fourth is the one that matters.',
  },
})

const SYSTEM = `You read ONE web page and extract who it is about. The reader is the office of an Indian public figure setting up a media-monitoring tool, and this becomes the identity card at the top of their dashboard.

## The one rule

You have no knowledge of this person. You have only the page text below. If the page does not state something, the answer is null.

This is not a style preference. A wrong party or a wrong constituency, stated confidently, is worse for this office than a blank field — they will not notice it, and every news scan afterwards will be keyed on it. A blank field takes them one tap to fill in. A wrong one takes them a week to discover.

So:
- Do NOT supply a party because you recognise the name. Only because the page names one.
- Read TENSE AND DATES on offices. A biography lists everything a person has ever held, and the desk is being set up for what they hold today. "Represented X between 2014 and 2018" is a former seat; "Member of parliament, Constituency-Y" with no end date is the current one. Reporting a seat somebody lost is worse than reporting none, because the whole news scan is then keyed on the wrong place and simply finds nothing.
- Do NOT infer a constituency from a district, or a state from a language.
- Do NOT compute a date of birth from an age, or an age from a date of birth. Report whichever the page actually gives and leave the other null.
- Do NOT write a bio from general knowledge. Every sentence must be supported by the page in front of you.
- If the page is a login wall, a 404, a search results page, or is about somebody else entirely, set name to your best reading and put what happened in notes.

## Confidence

Grade each field honestly. "high" means the page states it in so many words. "medium" means the page makes it plain without stating it — an infobox row, a caption. "low" means you are inferring, and the office will be asked to confirm it.

If a field is null, its confidence is ignored — send "low".

## Tone

The bio is neutral. This office is not your client and this is not a press release: no "distinguished", no "veteran", no "tireless". State what they hold, where, and since when. If the page carries allegations or controversy, the bio does not repeat them — that is what the rest of the app is for, with sourcing attached.`

// ─────────────────────────────────────────────────────────────────────────────
// Fetching
// ─────────────────────────────────────────────────────────────────────────────

/** Recognised profile hosts, so a source can be labelled for the reader. */
function labelFor(url: string): string {
  let host: string
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'the page you gave'
  }

  const known: Record<string, string> = {
    'x.com': 'X',
    'twitter.com': 'X',
    'facebook.com': 'Facebook',
    'instagram.com': 'Instagram',
    'youtube.com': 'YouTube',
    'linkedin.com': 'LinkedIn',
    't.me': 'Telegram',
    'en.wikipedia.org': 'Wikipedia',
    'wikipedia.org': 'Wikipedia',
    'myneta.info': 'MyNeta',
    'prsindia.org': 'PRS Legislative Research',
    'sansad.in': 'Parliament of India',
    'eci.gov.in': 'Election Commission of India',
  }
  return known[host] ?? host
}

/** Which platform a profile address belongs to, for the handle list. */
function platformOf(url: string): { platform: string; handle: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname.replace(/^www\./, '')
  const first = parsed.pathname.split('/').filter(Boolean)[0]
  if (!first) return null

  const map: Record<string, string> = {
    'x.com': 'X',
    'twitter.com': 'X',
    'facebook.com': 'Facebook',
    'instagram.com': 'Instagram',
    'youtube.com': 'YouTube',
    'linkedin.com': 'LinkedIn',
    't.me': 'Telegram',
  }
  const platform = map[host]
  if (!platform) return null
  return { platform, handle: first.replace(/^@/, '') }
}

interface ReadPage {
  url: string
  label: string
  /** The article title, when this page was an English Wikipedia article. */
  wikiTitle: string | null
  title: string | null
  description: string | null
  image: string | null
  text: string
  isWall: boolean
}

/**
 * Read one page down to the text the model will see.
 *
 * A failure here is not fatal and is not thrown: an office that pasted a
 * Facebook page which answers a login wall should still get a dashboard, and
 * should be told that is what happened rather than shown a stack trace.
 */
async function readPage(url: string): Promise<ReadPage | null> {
  const res = await fetchText(url, { timeout: FETCH_TIMEOUT_MS }).catch(() => null)
  if (!res?.ok || !res.body) return null

  const meta = parseMetadata(res.body, res.url)
  const text = [meta.title, meta.description, meta.articleText]
    .filter((part): part is string => Boolean(part?.trim()))
    .join('\n\n')
    .slice(0, PAGE_TEXT_LIMIT)

  if (!text.trim()) return null

  // The article title is recoverable from the address, and it is what the
  // Wikidata lookup keys on. Taking it from the page title instead would carry
  // the " - Wikipedia" suffix and any disambiguation the title picked up.
  const wikiTitle = /(^|\.)wikipedia\.org$/i.test(new URL(res.url).hostname)
    ? decodeURIComponent(new URL(res.url).pathname.replace(/^\/wiki\//, '')).replace(/_/g, ' ')
    : null

  return {
    url: res.url,
    label: labelFor(res.url),
    wikiTitle,
    title: meta.title,
    description: meta.description,
    image: meta.image,
    text,
    isWall: meta.isWall,
  }
}

/**
 * A Wikipedia article for this name, when one exists.
 *
 * This is the one lookup worth doing beyond the page the office gave, and it is
 * a real search against a real index rather than a model being asked to
 * remember: Wikipedia's own opensearch endpoint returns article titles for a
 * query, and the article that comes back is a page this function then reads
 * like any other. For sitting members it is usually the single best source of a
 * seat, a party and a date of birth in one place.
 *
 * It is a bonus, never a requirement. A miss, a timeout or an ambiguous result
 * all end the same way: nothing is added and nothing is claimed.
 */
async function findWikipedia(name: string, hint: string | null): Promise<string | null> {
  const query = hint ? `${name} ${hint}` : name
  const endpoint = `https://en.wikipedia.org/w/api.php?action=opensearch&limit=1&namespace=0&format=json&search=${encodeURIComponent(query)}`

  const res = await fetchText(endpoint, { timeout: FETCH_TIMEOUT_MS, agent: 'browser' }).catch(
    () => null,
  )
  if (!res?.ok) return null

  try {
    // opensearch answers [query, [titles], [descriptions], [urls]].
    const parsed = JSON.parse(res.body) as unknown
    if (!Array.isArray(parsed)) return null
    const urls = parsed[3]
    if (!Array.isArray(urls)) return null
    const first = urls[0]
    return typeof first === 'string' && first.startsWith('https://') ? first : null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The model call
// ─────────────────────────────────────────────────────────────────────────────

async function ask(
  system: string,
  user: string,
  schema: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const providers = resolveProviders()
  if (!providers.length) {
    throw new Error(
      'No language model is configured, so the profile cannot be read. Set GROQ_API_KEY (free, no card) in the site environment and redeploy.',
    )
  }

  let lastError = ''
  for (const provider of providers) {
    // `complete` speaks the OpenAI-shaped chat API. An Anthropic key reaches the
    // model through the SDK path in analyse.ts and has no equivalent here.
    if (!provider.baseUrl) {
      lastError = `${provider.label} is configured, but profile reading only calls OpenAI-compatible providers. Set GROQ_API_KEY or GEMINI_API_KEY as well.`
      continue
    }
    try {
      const out = await complete({ provider, system, user, schema, signal })
      return JSON.parse(out.text) as Record<string, unknown>
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.log(`[signal] identity: ${provider.label} failed (${lastError})`)
    }
  }
  throw new Error(lastError || 'Every configured model refused the request.')
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading the model back
// ─────────────────────────────────────────────────────────────────────────────

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null
  // Models answer "null", "N/A" and "unknown" as strings often enough that
  // treating them as values puts the word "Unknown" on the identity card.
  if (/^(null|n\/?a|none|unknown|not (stated|specified|available|mentioned))$/i.test(trimmed)) {
    return null
  }
  return trimmed
}

const confidenceOf = (v: unknown): Confidence =>
  v === 'high' || v === 'medium' || v === 'low' ? v : 'low'

/**
 * Age from a date of birth.
 *
 * Computed here rather than asked for, because a model asked for both produces
 * two numbers that disagree about one in five times, and the office then has to
 * work out which to believe.
 */
function ageFrom(dob: string | null): number | null {
  if (!dob) return null

  const yearOnly = /^(\d{4})$/.exec(dob)
  const now = new Date()

  if (yearOnly) {
    const year = Number(yearOnly[1])
    if (year < 1900 || year > now.getFullYear()) return null
    // A year alone cannot give an exact age; this is the older of the two
    // possible values only when the birthday has passed, so it is not stated
    // as exact anywhere it is shown.
    return now.getFullYear() - year
  }

  const parsed = Date.parse(dob)
  if (Number.isNaN(parsed)) return null
  const born = new Date(parsed)
  if (born.getFullYear() < 1900 || born > now) return null

  let age = now.getFullYear() - born.getFullYear()
  const monthDelta = now.getMonth() - born.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) age -= 1
  return age >= 18 && age <= 110 ? age : null
}

/**
 * Drop anything the fetched pages cannot support.
 *
 * The prompt forbids invention and the schema allows null, and models still
 * occasionally supply a party nobody mentioned. This is the check that does not
 * depend on the model cooperating: a short factual value that appears nowhere
 * in the text we actually read is not reported.
 *
 * Deliberately not applied to `bio`, which is a paraphrase and will not appear
 * verbatim by design, nor to values over 40 characters, where a substring test
 * produces false negatives on ordinary rewording.
 */
function grounded(value: string | null, corpus: string): string | null {
  if (!value) return null
  if (value.length > 40) return value
  return corpus.toLowerCase().includes(value.toLowerCase()) ? value : null
}

/**
 * A term start date as an office would say it.
 *
 * Wikidata stores "2023-12-03"; a person says "December 2023". The day is
 * dropped rather than shown because it is the swearing-in date, which is not
 * the thing anyone means by "in office since".
 */
function formatTermStart(iso: string): string {
  const match = /^(\d{4})(?:-(\d{2}))?/.exec(iso)
  if (!match) return iso
  const [, year, month] = match
  if (!month) return year!
  const name = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ][Number(month) - 1]
  return name ? `${name} ${year}` : year!
}

// ─────────────────────────────────────────────────────────────────────────────
// The entry point
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolveInput {
  url?: string | null
  name?: string | null
  role?: string | null
  constituency?: string | null
  state?: string | null
  signal?: AbortSignal
}

export interface ResolveResult {
  identity: Identity
  /** Plain-language account of what was read and what was not. */
  notes: string[]
}

export async function resolveIdentity(input: ResolveInput): Promise<ResolveResult> {
  const notes: string[] = []
  const pages: ReadPage[] = []

  const givenUrl = input.url?.trim() || null
  const givenName = input.name?.trim() || null

  if (!givenUrl && !givenName) {
    throw new Error('Give a public profile link, or the name of the person this desk is for.')
  }

  /* ── read the page the office gave ──────────────────────────────────── */

  if (givenUrl) {
    const page = await readPage(givenUrl)
    if (!page) {
      notes.push(
        `That address could not be read. It may need a login, or it may block automated readers. Anything below comes from elsewhere.`,
      )
    } else if (page.isWall) {
      notes.push(
        `${page.label} answered with a login wall rather than the profile, so only the little it shows publicly was read.`,
      )
      pages.push(page)
    } else {
      pages.push(page)
    }
  }

  /* ── and the encyclopaedia, which is where the seat usually lives ───── */

  const nameForSearch = givenName ?? pages[0]?.title?.split(/[|–—-]/)[0]?.trim() ?? null

  if (nameForSearch && pages.length < MAX_EXTRA_PAGES) {
    const hint = input.constituency ?? input.state ?? input.role ?? null
    const wikiUrl = await findWikipedia(nameForSearch, hint)
    if (wikiUrl && !pages.some((p) => p.url === wikiUrl)) {
      const wiki = await readPage(wikiUrl)
      if (wiki) pages.push(wiki)
    }
  }

  /* ── nothing readable: hand back what the office typed ───────────────── */

  if (pages.length === 0) {
    if (!givenName) {
      throw new Error(
        'Nothing could be read from that address, and no name was given to look up. Try the name instead, or a different link.',
      )
    }
    notes.push('Nothing could be read online, so this card holds only what you typed.')
    const stated = statedIdentity({
      name: givenName,
      role: input.role,
      constituency: input.constituency,
      state: input.state,
    })
    return { identity: { ...stated, notes }, notes }
  }

  /* ── the structured facts, where the person has an item ────────────────
     Run before the model rather than after, because they are strictly better
     evidence: a typed date beats a sentence mentioning a year, and a linked
     party entity beats a party name that happened to appear in a paragraph.
     The model still reads the prose — it writes the biography and catches
     everything Wikidata does not model — but it no longer has the last word on
     any field a database can state. */

  let facts: WikidataFacts | null = null
  let box: InfoboxFacts | null = null
  const wikiPage = pages.find((page) => page.wikiTitle)
  if (wikiPage?.wikiTitle) {
    // Both, in parallel. They disagree often enough that having each of them is
    // the point: the infobox is edited on election night, the Wikidata item
    // months later, and the article's prose never states which office is
    // current in a form anything can parse.
    const [qid, infobox] = await Promise.all([
      qidForArticle(wikiPage.wikiTitle),
      infoboxFor(wikiPage.wikiTitle),
    ])
    box = infobox
    if (qid) {
      facts = await wikidataFacts(qid)
      if (facts?.hasOnlyFormer && !box?.current) {
        notes.push(
          'The public record lists only offices this person has left, so their current role and seat were read from the article instead. Worth confirming: an election usually explains this, and the news scan is keyed on the seat.',
        )
      }
      if (facts?.dateOfDeath) {
        notes.push(
          'Wikidata records this person as deceased. If that is wrong it needs correcting there; if it is right, this is probably not the desk you meant to set up.',
        )
      }
    }
  }

  /* ── read them ───────────────────────────────────────────────────────── */

  const corpus = pages.map((p) => p.text).join('\n\n')

  const user = [
    givenName ? `The office says this is about: ${givenName}` : null,
    input.role ? `They describe the role as: ${input.role}` : null,
    input.constituency ? `They describe the constituency as: ${input.constituency}` : null,
    input.state ? `They say the state is: ${input.state}` : null,
    '',
    ...pages.map(
      (page, i) =>
        `## Page ${i + 1} — ${page.label}\nAddress: ${page.url}\n\n${page.text}`,
    ),
  ]
    .filter((line) => line !== null)
    .join('\n')

  const parsed = await ask(SYSTEM, user, IDENTITY_SCHEMA, input.signal)

  /* ── back into our shape, dropping anything unsupported ──────────────── */

  const modelConfidence = (parsed['confidence'] ?? {}) as Record<string, unknown>
  const confidence: Identity['confidence'] = {}
  const origin: Identity['origin'] = {}

  const take = (
    field: IdentityField,
    value: string | null,
    from: IdentityOrigin = 'profile-page',
  ): string | null => {
    if (value === null) return null
    confidence[field] = confidenceOf(modelConfidence[field])
    origin[field] = from
    return value
  }

  const name = text(parsed['name']) ?? givenName
  if (!name) {
    throw new Error('That page did not name anyone. Try the person’s name instead.')
  }
  confidence.name = 'high'
  origin.name = givenName ? 'stated' : 'profile-page'

  // What the office typed always wins over what a page said. They know their
  // own seat; the page may be three elections out of date.
  const role = input.role ? take('role', input.role, 'stated') : take('role', text(parsed['role']))
  const party = take('party', grounded(text(parsed['party']), corpus))
  const constituency = input.constituency
    ? take('constituency', input.constituency, 'stated')
    : take('constituency', grounded(text(parsed['constituency']), corpus))
  const state = input.state
    ? take('state', input.state, 'stated')
    : take('state', grounded(text(parsed['state']), corpus))
  const district = take('district', grounded(text(parsed['district']), corpus))
  const education = take('education', text(parsed['education']))
  const inOfficeSince = take('inOfficeSince', grounded(text(parsed['inOfficeSince']), corpus))
  const bio = take('bio', text(parsed['bio']))
  const dateOfBirth = take('dateOfBirth', grounded(text(parsed['dateOfBirth']), corpus))

  // Age: computed from the date of birth when there is one, and only taken from
  // the model when there is not. Two sources for one number is how they end up
  // disagreeing on screen.
  const computedAge = ageFrom(dateOfBirth)
  const statedAge =
    typeof parsed['age'] === 'number' && parsed['age'] > 17 && parsed['age'] < 111
      ? Math.round(parsed['age'])
      : null
  const age = computedAge ?? statedAge
  if (age !== null) {
    origin.age = dateOfBirth ? origin.dateOfBirth ?? 'profile-page' : 'profile-page'
    confidence.age = computedAge !== null ? (confidence.dateOfBirth ?? 'medium') : 'low'
  }

  /* ── handles ─────────────────────────────────────────────────────────── */

  const handles: SocialHandle[] = []
  const seen = new Set<string>()

  // The address the office pasted is itself a handle, when it is a social one,
  // and it is the most trustworthy entry in the list: they gave it to us.
  if (givenUrl) {
    const own = platformOf(givenUrl)
    if (own) {
      // Keyed on the pasted address, which is the only form we have here.
      handles.push({
        platform: own.platform,
        handle: own.handle,
        url: givenUrl,
        verified: false,
        followers: null,
        connected: false,
      })
      seen.add(givenUrl.toLowerCase())
    }
  }

  for (const raw of Array.isArray(parsed['handles']) ? parsed['handles'] : []) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const url = text(row['url'])
    if (!url || !/^https?:\/\//i.test(url)) continue
    if (seen.has(url.toLowerCase())) continue

    const derived = platformOf(url)
    const handle = text(row['handle']) ?? derived?.handle
    const platform = text(row['platform']) ?? derived?.platform
    if (!handle || !platform) continue

    seen.add(url.toLowerCase())
    handles.push({ platform, handle, url, verified: false, followers: null, connected: false })
  }
  if (handles.length) origin.handles = 'profile-page'

  /* ── aliases, photograph, sources ────────────────────────────────────── */

  const aliases = (Array.isArray(parsed['aliases']) ? parsed['aliases'] : [])
    .map(text)
    .filter((a): a is string => a !== null && a !== name)
    .slice(0, 8)
  if (aliases.length) origin.aliases = 'profile-page'

  // The first page with an image wins, and the page the office gave is first in
  // the list — their own profile picture beats an encyclopaedia's file photo.
  const photoUrl = pages.find((p) => p.image)?.image ?? null
  if (photoUrl) {
    origin.photoUrl = 'profile-page'
    confidence.photoUrl = 'medium'
  }

  const sources: IdentitySource[] = pages.map((p) => ({ url: p.url, label: p.label }))

  /*
    A whitelist, because three blacklists in a row leaked.

    The model was asked for problems and kept returning descriptions — "Page
    source: Wikipedia", "Wikipedia article about D. K. Aruna", "Extracted from
    Wikipedia page". Each new pattern was caught by a new rule and the next one
    got through. The rules were the wrong shape: they enumerated what is not a
    warning, and there are unlimited ways to describe a page.

    So a note now has to LOOK like a problem to be shown at all. Every genuine
    case the schema asks for — a login wall, two people of one name, a stale
    page, the wrong person — says so in words. A description of what was read
    does not, and is silently dropped.

    Everything the office actually needs to be told about a normal resolve is
    generated by this file, not by the model: the district spelling that was
    corrected, the record that lists only former offices, the accounts that were
    found and could not be opened.
  */
  const PROBLEM =
    /(wall|login|log in|sign ?in|blocked|refus|could not|cannot|unable|fail|missing|absent|no (longer|current|official)|out of date|outdated|stale|years old|different person|another person|someone else|same name|share[sd]? (a|the|this) name|ambigu|unclear|uncertain|conflict|contradict|disput|unverified|not verified|may be|might be|appears to be (a|an)?\s*(different|former)|former|resigned|deceased|died|404|not found|error)/i

  for (const note of Array.isArray(parsed['notes']) ? parsed['notes'] : []) {
    const line = text(note)
    if (line && line.length >= 20 && PROBLEM.test(line)) notes.push(line)
  }

  /* ── let the database overrule the paragraph ───────────────────────────
     Order of authority, highest first: what the office typed, then Wikidata,
     then what a model read in prose. The middle rank is the new one and it is
     the one that matters — every field below came back null or wrong from the
     prose pass on a real politician whose item states it plainly. */

  const fromFacts = <T,>(
    field: IdentityField,
    factValue: T | null,
    prose: T | null,
  ): T | null => {
    if (origin[field] === 'stated') return prose
    if (factValue === null || factValue === undefined) return prose
    confidence[field] = 'high'
    origin[field] = 'profile-page'
    return factValue
  }

  const finalDob = fromFacts('dateOfBirth', facts?.dateOfBirth ?? null, dateOfBirth)
  const finalParty = fromFacts('party', tidyParty(facts?.party ?? null), party)
  /*
    The infobox outranks everything except the office's own typing.

    Order of authority for the two fields the news scan is keyed on:
      1. what the office typed
      2. the Wikipedia infobox's current office — dated, unfinished, structured
      3. Wikidata's current position — same idea, updated far more slowly
      4. whatever a model read in the prose

    Measured on a real member: the infobox said MP for Mahabubnagar since June
    2024, Wikidata said MLA for Gadwal with no dates at all, and the prose pass
    said "Vice President of Bharatiya Janata Party" with no seat. Only the first
    is the office a constituency media desk should be built around.
  */
  const boxOffice = box?.current ?? null

  const finalRole = fromFacts(
    'role',
    tidyOffice(boxOffice?.office ?? null) ?? tidyRole(facts?.role ?? null),
    role,
  )
  const finalConstituency = fromFacts(
    'constituency',
    boxOffice?.constituency
      ? tidyConstituency(boxOffice.constituency)
      : tidyConstituency(facts?.constituency ?? null),
    constituency,
  )

  // A role and a seat read out of prose, with a database sitting right there
  // that could not confirm them, is exactly the pair an office should check.
  // These two drive the news scan, so a stale one fails by finding nothing.
  if (facts?.hasOnlyFormer && !boxOffice) {
    if (finalRole && origin.role !== 'stated') confidence.role = 'low'
    if (finalConstituency && origin.constituency !== 'stated') confidence.constituency = 'low'
  }
  const finalPhoto = fromFacts('photoUrl', facts?.photoUrl ?? null, photoUrl)

  // Recomputed, because the date of birth it derives from may have just been
  // replaced by a typed one. This is the field the prose pass most often could
  // not produce at all.
  const factAge = ageFrom(finalDob)
  const finalAge = factAge ?? age
  if (finalAge !== null) {
    confidence.age = factAge !== null ? (confidence.dateOfBirth ?? 'high') : (confidence.age ?? 'low')
    origin.age = origin.dateOfBirth ?? origin.age ?? 'profile-page'
  }

  // The term currently being served, which is what "in office since" means to
  // an office. A model reading prose routinely returns the date of a different
  // post the person also holds.
  const currentTerm = facts?.positions.find((position) => position.current)
  const finalInOffice = fromFacts(
    'inOfficeSince',
    // The infobox's term_start belongs to the same office it named above, which
    // is what stops the card pairing one post's title with another's date.
    boxOffice?.termStart ?? (currentTerm?.start ? formatTermStart(currentTerm.start) : null),
    inOfficeSince,
  )

  /*
    Mixing sources can produce a card that contradicts itself.

    Concretely: Wikidata gave a role of MLA, while the model — reading prose
    about a national party post the same person also holds — gave an "in office
    since" of September 2020. Each is defensible on its own and together they
    assert something no source says, that she has been an MLA since then.

    So when the role came from the database and the date did not, the date is
    marked unconfirmed. It still shows, because it is probably a real date about
    something; it just stops being presented as the term of the office named
    beside it, and the office is asked to look.
  */
  if (
    finalInOffice &&
    origin.role === 'profile-page' &&
    facts !== null &&
    !currentTerm?.start &&
    // Not when the infobox supplied the office and its start date together.
    // The guard exists to catch a title from one source paired with a date from
    // another; when one structured field named both, they cannot disagree.
    !(boxOffice?.office && boxOffice.termStart)
  ) {
    confidence.inOfficeSince = 'low'
  }

  // Accounts recorded as typed identifiers, which is the only place most of
  // these ever appear — a profile page links to them inconsistently and a model
  // reading prose invents them outright.
  for (const handle of facts?.handles ?? []) {
    if (seen.has(handle.url.toLowerCase())) continue
    seen.add(handle.url.toLowerCase())
    handles.push(handle)
  }
  if (facts?.handles.length) origin.handles = 'profile-page'

  /* ── the place, in the spelling the masthead registry uses ─────────────
     Resolved here rather than left to the client, because a district the app
     cannot place silently downgrades the news scan from one constituency to a
     whole state — and the identity card would meanwhile show the office their
     own district spelled a way nothing matches. Both halves are fixed by
     resolving once, at the point the value enters the system. */

  const place = resolvePlace({ state, district, constituency: finalConstituency })

  const finalState = place.state ?? state
  const finalDistrict = place.district ?? district
  /**
   * An exact hit in the region registry is confirmation, whether or not it
   * changed the value.
   *
   * These two conditions used to be `place.state !== state`, so confidence was
   * raised only when the registry CORRECTED the guess. When it agreed with it,
   * nothing happened and a perfectly good value stayed marked low — which is
   * how an MP for Mahabubnagar was told on the dashboard that her state "could
   * not be confirmed" while the registry was sitting there with an exact match
   * for it. Agreement between two independent sources is not weaker evidence
   * than a correction by one of them; it is stronger.
   */
  if (
    place.state &&
    (place.state !== state ||
      stateCorroborated(place.state, place.district ?? district, finalConstituency))
  ) {
    confidence.state = 'high'
    origin.state = origin.state === 'stated' ? 'stated' : 'profile-page'
  }
  if (place.district && place.districtMatch?.confidence === 'exact') {
    confidence.district = 'high'
    origin.district = origin.district === 'stated' ? 'stated' : 'profile-page'
  }
  for (const line of place.notes) notes.push(line)

  /* ── and if the reference works still have nothing, search the web ──────
     Reached for last, deliberately. Wikidata and the infobox are edited by
     people and cite themselves; a grounded search is a model reading results,
     and even with every address fetched back it is the weaker evidence. But for
     most sitting members it is the ONLY evidence: this person's encyclopaedia
     entry linked fourteen pages and not one was an account, while a grounded
     search found her Facebook page on the first try. */

  if (handles.length === 0 && groundedSearchAvailable()) {
    const discovered = await discoverHandlesGrounded({
      name,
      role: finalRole,
      constituency: finalConstituency,
      state: finalState,
      party: finalParty,
      signal: input.signal,
    })

    for (const handle of discovered.handles) {
      if (seen.has(handle.url.toLowerCase())) continue
      seen.add(handle.url.toLowerCase())
      handles.push({
        platform: handle.platform,
        handle: handle.handle,
        url: handle.url,
        verified: handle.verified,
        followers: handle.followers,
        connected: handle.connected,
      })
    }

    for (const line of discovered.notes) notes.push(line)
    if (discovered.handles.length > 0) {
      origin.handles = 'model'
      confidence.handles = discovered.handles.some((h) => h.confirmed) ? 'medium' : 'low'
    }
  }

  if (facts) {
    sources.push({ url: `https://www.wikidata.org/wiki/${facts.qid}`, label: 'Wikidata' })
  }




  /* ── the party abbreviation, as a searchable alias ─────────────────────── */

  const abbreviation = partyAbbreviation(finalParty)

  const identity: Identity = {
    name,
    aliases,
    photoUrl: finalPhoto,
    role: finalRole,
    party: finalParty,
    constituency: finalConstituency,
    district: finalDistrict,
    state: finalState,
    age: finalAge,
    dateOfBirth: finalDob,
    education,
    inOfficeSince: finalInOffice,
    bio,
    handles,
    watchTerms: watchTermsFor({
      name,
      constituency: finalConstituency,
      // The abbreviation, not the registered name. "BJP" is what a Telugu
      // headline prints; "Bharatiya Janata Party" is what a form asks for.
      party: abbreviation ?? finalParty,
      aliases,
    }),
    confidence,
    origin,
    sources,
    notes,
    resolvedAt: new Date().toISOString(),
  }

  return { identity, notes }
}


// ─────────────────────────────────────────────────────────────────────────────
// Searching for who somebody means
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One person the office might mean.
 *
 * `person` is not a guess. Wikipedia puts every biography of a living person in
 * Category:Living people, and the search below asks for that one category by
 * name — so a page either carries it or does not. That matters more than it
 * sounds: searching "aruna mahabubnagar" ranks the *constituency* above the
 * member, and without a real person test the first thing offered is a place.
 */
export interface PersonCandidate {
  name: string
  /** Wikidata's one-liner: "Indian politician". Null when the page has none. */
  description: string | null
  url: string
  thumbnail: string | null
  /** True when this page is a biography of a living person. */
  person: boolean
}

/**
 * How many results one search returns.
 *
 * Eight from the index, because a typeahead that offers fifteen options is one
 * the reader scrolls rather than reads.
 */
const SEARCH_LIMIT = 8

/** Shorter than a page read: this fires while somebody is still typing. */
const SEARCH_TIMEOUT_MS = 6_000

/**
 * Find people matching what the office typed.
 *
 * This is deliberately a real search against a real index rather than a model
 * being asked who it can remember. A model asked "who is K. L. Aruna" will
 * produce a fluent, confident, entirely invented member for a constituency
 * that may not exist — which is the precise failure this product exists to
 * catch, committed by the product itself on its own first screen.
 *
 * Wikipedia's full-text search is used because it is fuzzy in the way people
 * actually type: extra context words narrow it rather than breaking it, so
 * "aruna" finding nothing useful and "aruna mahabubnagar" finding the member is
 * the behaviour the office already expects from a search box. Wikidata's entity
 * search was tried first and rejected — it matches labels by prefix and
 * returned nothing at all for the same queries.
 *
 * WHAT THIS CANNOT DO, and the caller must say so rather than imply otherwise:
 * Wikipedia's coverage of sitting MLAs is partial and of ward-level office
 * holders close to nil. A search that finds nobody is a normal outcome, not an
 * error, and the office must always be able to proceed with what they typed.
 */
export async function searchPeople(query: string): Promise<PersonCandidate[]> {
  const trimmed = query.trim()
  if (trimmed.length < 3) return []

  const endpoint =
    'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2' +
    `&generator=search&gsrsearch=${encodeURIComponent(trimmed)}&gsrlimit=${SEARCH_LIMIT}` +
    '&prop=pageterms|pageimages|categories' +
    '&wbptterms=description&piprop=thumbnail&pithumbsize=160' +
    // Asking for exactly these two categories turns an expensive listing into a
    // yes/no: the array comes back populated or absent.
    '&clcategories=' + encodeURIComponent('Category:Living people|Category:Possibly living people')

  const res = await fetchText(endpoint, { timeout: SEARCH_TIMEOUT_MS }).catch(() => null)
  if (!res?.ok) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(res.body)
  } catch {
    return []
  }

  const pages = (parsed as { query?: { pages?: unknown[] } })?.query?.pages
  if (!Array.isArray(pages)) return []

  const candidates: (PersonCandidate & { index: number })[] = []

  for (const raw of pages) {
    if (!raw || typeof raw !== 'object') continue
    const page = raw as Record<string, unknown>

    const title = typeof page['title'] === 'string' ? page['title'] : null
    if (!title) continue

    // Disambiguation pages list people rather than being one, and picking one
    // sends the resolver at a page with six biographies on it.
    if (/\(disambiguation\)$/i.test(title)) continue

    // `terms`, not `pageterms`: prop=pageterms is the name of the module, and
    // the key it writes into each page is `terms`. Getting this wrong is silent
    // — every result comes back with a null description and the list reads as
    // eight bare names with no way to tell them apart.
    const terms = page['terms'] as { description?: unknown } | undefined
    const description =
      Array.isArray(terms?.description) && typeof terms.description[0] === 'string'
        ? (terms.description[0] as string)
        : null

    // A list article is never a person and never worth offering.
    if (description && /^wikimedia (list|disambiguation)/i.test(description)) continue

    const thumb = page['thumbnail'] as { source?: unknown } | undefined
    const thumbnail = typeof thumb?.source === 'string' ? thumb.source : null

    candidates.push({
      name: title,
      description,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      thumbnail,
      person: Array.isArray(page['categories']) && page['categories'].length > 0,
      index: typeof page['index'] === 'number' ? page['index'] : 99,
    })
  }

  return candidates
    // People first, then the index's own ranking within each group. Without
    // this the top suggestion for a member's own name is routinely their
    // constituency, which is the one thing on the list they are not.
    .sort((a, b) => Number(b.person) - Number(a.person) || a.index - b.index)
    .map(({ index: _index, ...rest }) => rest)
}
