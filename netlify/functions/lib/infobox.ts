import { fetchText } from './fetcher'

/**
 * The office somebody actually holds, from the Wikipedia infobox.
 *
 * Added after the two structured sources already in place both got a sitting
 * Member of Parliament wrong in different ways.
 *
 * Wikidata held two assembly seats she had left, neither dated, and no Lok
 * Sabha statement at all — it had simply not caught up with the 2024 election.
 * The prose pass, reading the article, produced her party vice-presidency as
 * the "role" and no seat, because a biography lists everything a person has
 * ever been and the present tense is not reliably marked.
 *
 * The infobox has it exactly right, and says so in fields:
 *
 *     | office       = [[Member of Parliament, Lok Sabha]]
 *     | term_start   = 24 June 2024
 *     | term_end     =
 *     | constituency = [[Mahabubnagar Lok Sabha constituency|Mahabubnagar]]
 *     | office2      = [[Member]] of [[Telangana Legislative Assembly]]
 *     | constituency2= [[Gadwal (Assembly constituency)|Gadwal]]
 *     | term_start2  = 2 June 2014
 *     | term_end2    = 11 December 2018
 *
 * An empty `term_end` is the whole signal: that office has not ended. The
 * numbered suffixes group each office with its own dates and seat, so the
 * "MLA for Gadwal" that both other sources produced is visibly a post that
 * finished in 2018.
 *
 * Infoboxes are also the part of an article that gets edited on election night,
 * which is precisely when a media desk is most likely to be set up.
 */

const API = 'https://en.wikipedia.org/w/api.php'
const TIMEOUT_MS = 8_000

export interface InfoboxOffice {
  office: string
  constituency: string | null
  termStart: string | null
  termEnd: string | null
  /** Named, started, and not ended. The only kind that may be shown as current. */
  current: boolean
  /** 0 for the unnumbered field, then 1, 2… — the article's own ranking. */
  index: number
}

export interface InfoboxFacts {
  offices: InfoboxOffice[]
  /** The office to show. Null when the box lists nothing unfinished. */
  current: InfoboxOffice | null
  birthDate: string | null
  birthPlace: string | null
  party: string | null
  website: string | null
  /** Every social address the box links to, unparsed. */
  links: string[]
}

/* ── wikitext, reduced to something readable ─────────────────────────────── */

/**
 * Strip the markup a value can carry, without losing the value.
 *
 * `[[Mahabubnagar Lok Sabha constituency|Mahabubnagar]]` has to become
 * "Mahabubnagar" — the display half — because that is what a headline prints
 * and what the news scan searches for. Taking the target half instead yields
 * "Mahabubnagar Lok Sabha constituency", which matches nothing.
 */
export function cleanWikitext(raw: string): string {
  let value = raw

  // Piped links keep the label; plain links keep the target.
  value = value.replace(/\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]/g, '$1')
  // External links keep their label when they have one.
  value = value.replace(/\[(?:https?:\/\/\S+)\s+([^\]]+)\]/g, '$1')
  value = value.replace(/\[(https?:\/\/\S+)\]/g, '$1')
  // Line breaks inside a field are layout, not content.
  value = value.replace(/<br\s*\/?>/gi, ' ')
  value = value.replace(/<[^>]+>/g, '')
  // Remaining templates: {{small|x}} keeps x, everything else goes.
  value = value.replace(/\{\{\s*(?:small|nowrap|nobold)\s*\|([^{}]*)\}\}/gi, '$1')
  value = value.replace(/\{\{[^{}]*\}\}/g, '')
  value = value.replace(/''+/g, '')
  value = value.replace(/&nbsp;/g, ' ')

  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Split an infobox into its fields.
 *
 * Written as a depth-aware scan rather than a split on "|", because values
 * routinely contain templates and links that carry their own pipes —
 * `{{Birth date and age|1960|05|04}}` alone would produce four bogus fields.
 */
function fields(block: string): Map<string, string> {
  const out = new Map<string, string>()

  let depth = 0
  let bracket = 0
  let current = ''
  const parts: string[] = []

  for (let i = 0; i < block.length; i += 1) {
    const two = block.slice(i, i + 2)
    if (two === '{{') {
      depth += 1
      current += two
      i += 1
      continue
    }
    if (two === '}}') {
      depth -= 1
      current += two
      i += 1
      continue
    }
    if (two === '[[') {
      bracket += 1
      current += two
      i += 1
      continue
    }
    if (two === ']]') {
      bracket -= 1
      current += two
      i += 1
      continue
    }
    if (block[i] === '|' && depth === 0 && bracket === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += block[i]
  }
  parts.push(current)

  for (const part of parts) {
    const at = part.indexOf('=')
    if (at === -1) continue
    const key = part.slice(0, at).trim().toLowerCase()
    const value = part.slice(at + 1).trim()
    if (key) out.set(key, value)
  }

  return out
}

/** The `{{Infobox officeholder …}}` block, brace-balanced. */
function extractInfobox(wikitext: string): string | null {
  const start = /\{\{\s*Infobox\s+(officeholder|politician|person|MP)/i.exec(wikitext)
  if (!start) return null

  let depth = 0
  for (let i = start.index; i < wikitext.length; i += 1) {
    const two = wikitext.slice(i, i + 2)
    if (two === '{{') {
      depth += 1
      i += 1
    } else if (two === '}}') {
      depth -= 1
      i += 1
      if (depth === 0) return wikitext.slice(start.index + 2, i - 1)
    }
  }
  return null
}

/**
 * A date in the several shapes an infobox writes them.
 *
 * Returned as text rather than parsed, because "2014" and "2 June 2014" are
 * both perfectly good answers to "since when" and forcing the first into an
 * ISO date would invent a day nobody stated.
 */
function readDate(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const value = cleanWikitext(raw)
  return value ? value : null
}

/* ── the entry point ─────────────────────────────────────────────────────── */

export async function infoboxFor(title: string): Promise<InfoboxFacts | null> {
  const url =
    `${API}?action=parse&format=json&formatversion=2` +
    `&page=${encodeURIComponent(title)}&prop=wikitext&section=0`

  const res = await fetchText(url, { timeout: TIMEOUT_MS }).catch(() => null)
  if (!res?.ok) return null

  let wikitext: string
  try {
    const parsed = JSON.parse(res.body) as { parse?: { wikitext?: unknown } }
    if (typeof parsed.parse?.wikitext !== 'string') return null
    wikitext = parsed.parse.wikitext
  } catch {
    return null
  }

  const block = extractInfobox(wikitext)
  if (!block) return null

  const box = fields(block)

  /* ── the offices, grouped by their numeric suffix ──────────────────────── */

  const offices: InfoboxOffice[] = []

  for (const [key, value] of box) {
    const match = /^office(\d*)$/.exec(key)
    if (!match) continue

    const suffix = match[1] ?? ''
    const office = cleanWikitext(value)
    if (!office) continue

    const termEnd = readDate(box.get(`term_end${suffix}`))
    const termStart = readDate(box.get(`term_start${suffix}`))

    offices.push({
      office,
      constituency: readDate(box.get(`constituency${suffix}`)),
      termStart,
      termEnd,
      // An empty `term_end` is the signal. A field that is present and blank
      // means "has not ended"; one that is absent means the same thing, and
      // both are how a maintained infobox says "current".
      current: Boolean(termStart) && !termEnd,
      index: suffix === '' ? 0 : Number(suffix),
    })
  }

  offices.sort((a, b) => Number(b.current) - Number(a.current) || a.index - b.index)

  /*
    The first unfinished office, by the article's own ordering.

    Order matters and is not arbitrary: editors put the office somebody is best
    known for holding *now* in the unnumbered field, and everything else below
    it. For this person that is the Lok Sabha seat, with the party
    vice-presidency — also current, also real — as office1. Ranking by index
    within the current ones therefore picks the elected office over the party
    post, which is the one a constituency media desk is built around.
  */
  const current = offices.find((o) => o.current) ?? null

  /* ── the rest ──────────────────────────────────────────────────────────── */

  const links: string[] = []
  for (const value of box.values()) {
    for (const link of value.matchAll(/https?:\/\/[^\s|\]}]+/g)) {
      links.push(link[0])
    }
  }

  return {
    offices,
    current,
    birthDate: readDate(box.get('birth_date')),
    birthPlace: readDate(box.get('birth_place')),
    party: cleanWikitext(box.get('party') ?? '') || null,
    website: cleanWikitext(box.get('website') ?? '') || null,
    links,
  }
}

/**
 * Shorten an infobox office to what an office would call it.
 *
 * "Member of Parliament, Lok Sabha" is what the article writes and "MP" is what
 * the person's own staff say.
 */
export function tidyOffice(office: string | null): string | null {
  if (!office) return null
  const rules: [RegExp, string][] = [
    [/member of parliament,?\s*lok sabha/i, 'MP (Lok Sabha)'],
    [/member of parliament,?\s*rajya sabha/i, 'MP (Rajya Sabha)'],
    [/member of parliament/i, 'MP'],
    [/member of .*legislative assembly/i, 'MLA'],
    [/member of .*legislative council/i, 'MLC'],
  ]
  for (const [pattern, short] of rules) {
    if (pattern.test(office)) return short
  }
  return office
}
