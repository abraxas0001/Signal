/**
 * Read every stored comment on its own, and record what it says and why.
 *
 *   npx tsx scraper/classify-comments.ts            every person on the roster
 *   npx tsx scraper/classify-comments.ts dkaruna    one person
 *   npx tsx scraper/classify-comments.ts --force    re-read ones already done
 *
 * WHY THIS EXISTS. The account survey in read-comments.ts answers a different
 * question: it reads a sample of an account's comments and returns a three-way
 * COUNT plus a handful of verbatim quotes. That is the right shape for "how is
 * this account doing", and the wrong shape for everything else the desk wanted
 * to ask. With 280 comments collected and 35 of them quoted, every mention row
 * showed "Not scored", no post could show the split of ITS OWN comments, and
 * the "why positive / why negative" lists had nothing to draw on but word
 * frequency, which returns names and places because that is what people type.
 *
 * So each comment is read once, on its own terms, and gets two things:
 *
 *   side   positive / negative / neutral, about the SUBJECT of the comment,
 *          not its politeness. "Fix our road" is negative even said kindly.
 *   theme  two to four words for the reason, in the reader's own register:
 *          "development work", "water supply", "road condition". Null where
 *          the comment gives no reason, which is most greetings and emoji.
 *
 * NOTHING IS INFERRED FROM THE POST. A comment is classified from its own
 * text. A comment the model declines to place keeps a null side, and null is
 * carried through to the screen as "not scored" rather than filled in with
 * the post's reading or with neutral.
 *
 * WHAT IT WRITES. `scraper/demo-comments.json` in place, and the same comments
 * where they already sit inside `public/demo-reports.json`, matched by post
 * URL and comment text. The reports are patched rather than regenerated
 * because a reading costs a model call and the reading itself has not changed:
 * only the labels on the comments it was made from.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const COMMENTS = resolve(process.cwd(), 'scraper/demo-comments.json')
const REPORTS = resolve(process.cwd(), 'public/demo-reports.json')

type Side = 'positive' | 'negative' | 'neutral'

interface StoredComment {
  text?: string
  side?: Side | null
  theme?: string | null
  [k: string]: unknown
}

interface CommentEntry {
  platform?: string
  handle?: string
  readFor?: string
  comments?: StoredComment[]
  [k: string]: unknown
}

interface CommentsFile {
  generatedAt?: string
  posts?: Record<string, CommentEntry>
  handles?: unknown
  [k: string]: unknown
}

/**
 * How many comments go to the model at once.
 *
 * Small enough that one refusal costs little and the indices stay easy for
 * the model to track, large enough that 280 comments are a couple of dozen
 * calls rather than 280.
 */
const BATCH = 20

function envValue(name: string): string | undefined {
  const direct = process.env[name]
  if (direct) return direct
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const at = line.indexOf('=')
      if (at > 0 && line.slice(0, at).trim() === name) return line.slice(at + 1).trim()
    }
  } catch {
    /* no .env is a supported state; the key may be in the environment */
  }
  return undefined
}

async function ask(prompt: string): Promise<Record<string, unknown> | null> {
  const groq = envValue('GROQ_API_KEY')
  const openai = envValue('OPENAI_API_KEY')

  if (groq) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${groq}` },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(90_000),
      })
      if (res.ok) {
        const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
        return JSON.parse(j.choices?.[0]?.message?.content ?? '') as Record<string, unknown>
      }
      console.log(`    groq ${res.status}, trying openai`)
    } catch {
      /* fall through to openai */
    }
  }

  if (!openai) return null
  try {
    /* Same chat/completions shape as the Groq call above — OpenAI is the
       native speaker of it. gpt-5-mini: one JSON call per batch, and the
       Telugu here is comfortably inside the mini tier. */
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${openai}` },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) {
      console.log(`    openai ${res.status}: ${(await res.text()).slice(0, 120)}`)
      return null
    }
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return JSON.parse(j.choices?.[0]?.message?.content ?? '') as Record<string, unknown>
  } catch (err) {
    console.log(`    openai failed: ${((err as Error).message ?? '').slice(0, 60)}`)
    return null
  }
}

const asSide = (v: unknown): Side | null =>
  v === 'positive' || v === 'negative' || v === 'neutral' ? v : null

/**
 * A theme worth keeping: short, and not a name.
 *
 * The model is told to give a reason rather than a subject, but the failure
 * mode when a comment has no reason in it is to hand back whoever it names.
 * A theme longer than four words is a sentence, and one that is simply the
 * person or place the comment mentions is the thing this whole pass exists
 * to stop appearing as an explanation.
 */
function cleanTheme(v: unknown, banned: Set<string>): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim().toLowerCase()
  if (t.length < 3 || t.length > 40) return null
  const words = t.split(' ')
  if (words.length > 4) return null
  if (words.every((w) => banned.has(w))) return null
  return t
}

async function classifyBatch(
  lines: string[],
  person: string,
  banned: Set<string>,
): Promise<{ side: Side | null; theme: string | null }[]> {
  const prompt = [
    `You are reading comments left on social media posts by ${person}, an Indian politician.`,
    `The comments are in English, Telugu, Hindi, or a romanised mix. Read each one as written.`,
    ``,
    `For EACH numbered comment return:`,
    `  "side": "positive" | "negative" | "neutral" | null`,
    `  "theme": a 2-4 word lowercase phrase naming WHY, or null`,
    ``,
    `RULES.`,
    `side is about the SUBJECT of the comment, not its politeness. A politely`,
    `worded demand to fix a road is negative. Praise is positive. Greetings,`,
    `blessings, emoji, tags and plain reactions are neutral.`,
    `Use null for side ONLY when the comment is genuinely unreadable.`,
    ``,
    `theme is the REASON, in the commenter's own register: "development work",`,
    `"water supply", "road condition", "job promises", "helping people".`,
    `theme MUST NOT be a person, a place, a party, or a title. If the comment`,
    `gives no reason - a greeting, an emoji, a bare name - theme is null.`,
    `Most neutral comments have a null theme. That is expected and correct.`,
    ``,
    `Reply as JSON: {"items":[{"i":0,"side":"...","theme":"..."}, ...]}`,
    `One entry per comment, using the SAME index shown.`,
    ``,
    ...lines,
  ].join('\n')

  const out = await ask(prompt)
  const items = Array.isArray(out?.['items']) ? (out['items'] as Record<string, unknown>[]) : []
  const byIndex = new Map<number, { side: Side | null; theme: string | null }>()
  for (const it of items) {
    const i = Number(it['i'])
    if (!Number.isInteger(i)) continue
    byIndex.set(i, { side: asSide(it['side']), theme: cleanTheme(it['theme'], banned) })
  }
  return lines.map((_, i) => byIndex.get(i) ?? { side: null, theme: null })
}

/**
 * The same comment, written two ways, reduced to one key.
 *
 * Facebook renders the author and the age inside the comment's own text run,
 * so the scraper's copy carries a prefix the reading's cleaned copy does not.
 * Stripping that, the platform's Like/Reply words and all spacing leaves the
 * sentence itself, which is what identifies the comment in both stores.
 */
const COMMENT_PREFIX =
  /^[^\n\u00b7]{2,40}\u00b7\s*\d+\s*(?:\u0918\u0902\u091f\u0947|\u0926\u093f\u0928|\u092e\u093f\u0928\u091f|\u0938\u092a\u094d\u0924\u093e\u0939|\u0938\u0947\u0915\u0902\u0921|\u0938\u093e\u0932|\u092e\u0939\u0940\u0928\u0947|hours?|days?|weeks?|mins?|minutes?|[hdwmy])(?:\s*\u00b7\s*(?:\u091f\u0949\u092a\s*\u095e\u0948\u0928|Top\s*fan))?/u

const COMMENT_CHROME =
  /(\u0932\u093e\u0907\u0915\s*\u0915\u0930\u0947\u0902|\u091c\u0935\u093e\u092c\s*\u0926\u0947\u0902|\u0905\u0928\u0941\u0935\u093e\u0926\s*\u0926\u0947\u0916\u0947\u0902|See\s*translation|\u091f\u0949\u092a\s*\u095e\u0948\u0928|Top\s*fan|GIPHY)/giu

function matchKey(text: unknown): string {
  return String(text ?? '')
    .replace(COMMENT_PREFIX, '')
    .replace(COMMENT_CHROME, ' ')
    // Same reason as gen-extras: an emoji is decoration, not identity.
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\u200B-\u200F]/gu, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

async function main(): Promise<void> {
  if (!existsSync(COMMENTS)) {
    console.log(`No ${COMMENTS}. Run npm run scraper:comments first.`)
    process.exit(1)
  }
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const force = process.argv.includes('--force')

  const file = JSON.parse(readFileSync(COMMENTS, 'utf8')) as CommentsFile
  const posts = file.posts ?? {}

  /* Names and places the desk already knows, so a "theme" that is only one of
     them can be refused without a hand-written list. */
  const banned = new Set<string>()
  try {
    const roster = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/demo-politicians.json'), 'utf8'),
    ) as { people?: Record<string, { name?: string; office?: Record<string, string> }> }
    for (const person of Object.values(roster.people ?? {})) {
      for (const w of (person.name ?? '').toLowerCase().split(/\s+/)) if (w.length >= 3) banned.add(w)
      for (const v of Object.values(person.office ?? {})) {
        for (const w of String(v).toLowerCase().split(/\s+/)) if (w.length >= 3) banned.add(w)
      }
    }
  } catch {
    /* the roster is optional here; the prompt already forbids names */
  }
  for (const w of ['bjp', 'inc', 'brs', 'congress', 'party', 'minister', 'mp', 'mla']) banned.add(w)

  let done = 0
  let scored = 0
  let themed = 0

  for (const [url, entry] of Object.entries(posts)) {
    if (wanted.length > 0 && !wanted.includes(String(entry.readFor ?? ''))) continue
    const list = entry.comments ?? []
    const todo = list.filter((c) => (c.text ?? '').trim() && (force || c.side === undefined))
    if (todo.length === 0) continue

    console.log(`${String(entry.platform ?? '?').padEnd(11)} ${url.slice(0, 54)} ${todo.length}`)

    for (let at = 0; at < todo.length; at += BATCH) {
      const slice = todo.slice(at, at + BATCH)
      const lines = slice.map(
        (c, i) => `${i}. ${(c.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)}`,
      )
      const verdicts = await classifyBatch(lines, String(entry.readFor ?? 'this politician'), banned)
      slice.forEach((c, i) => {
        const v = verdicts[i] ?? { side: null, theme: null }
        c.side = v.side
        c.theme = v.theme
        if (v.side) scored++
        if (v.theme) themed++
      })
      done += slice.length
      // The free tiers are rate limited and this pass is not urgent.
      await new Promise((r) => setTimeout(r, 700))
    }
  }

  writeFileSync(COMMENTS, JSON.stringify(file, null, 2))
  console.log(`\n${done} comments read: ${scored} placed on a side, ${themed} carry a reason.`)

  /*
   * Patch the copies already embedded in the readings, so the app sees the
   * labels without re-analysing anything.
   *
   * MATCHED ON A NORMALISED KEY, NOT THE RAW TEXT. The two stores hold the
   * same comment written differently: this file keeps what the scraper read,
   * including the author-and-age run Facebook renders inside the comment
   * ("Karunakarreddy Patel \u00b7 22 \u0918\u0902\u091f\u0947..."), while the reading kept a cleaned
   * copy. Matching the two literally therefore missed 76 of her comments and
   * left them showing "Not scored" even though they had just been classified.
   * Both sides are reduced to the same key before comparing, and a short
   * comment is additionally matched on its leading run so an emoji-only reply
   * still finds its twin.
   */
  if (existsSync(REPORTS)) {
    const reports = JSON.parse(readFileSync(REPORTS, 'utf8')) as {
      reports?: Record<string, { snapshot?: { comments?: StoredComment[] } }>
    }
    let patched = 0
    for (const [url, entry] of Object.entries(posts)) {
      const stored = reports.reports?.[url]?.snapshot?.comments
      if (!Array.isArray(stored)) continue

      const byKey = new Map<string, StoredComment>()
      const byHead = new Map<string, StoredComment>()
      for (const c of entry.comments ?? []) {
        if (c.side === undefined) continue
        const k = matchKey(c.text)
        if (k && !byKey.has(k)) byKey.set(k, c)
        const head = k.slice(0, 24)
        if (head && !byHead.has(head)) byHead.set(head, c)
      }

      for (const c of stored) {
        const k = matchKey(c.text)
        const src = byKey.get(k) ?? byHead.get(k.slice(0, 24))
        if (!src) continue
        c.side = src.side
        c.theme = src.theme
        patched++
      }
    }
    /*
     * THEN THE COMMENTS THAT ONLY EXIST IN THE READINGS.
     *
     * Two different collections sit under one post. The signed-in browser
     * scraper writes this file; the analyse pipeline separately kept whatever
     * the serverless extractor could see, and those are not the same
     * comments. Patching only in one direction therefore left 67 of hers
     * unlabelled, and they were the short ones - the emoji replies and
     * one-line greetings the extractor catches and the scraper's twenty-per-
     * post cap drops. They are real comments on her posts, so they are read
     * here too, on the same terms and with the same refusals.
     */
    const orphans: { c: StoredComment; person: string }[] = []
    for (const [url, report] of Object.entries(reports.reports ?? {})) {
      const owner = posts[url]?.readFor
      if (!owner) continue
      if (wanted.length > 0 && !wanted.includes(String(owner))) continue
      for (const c of report.snapshot?.comments ?? []) {
        if (!force && c.side !== undefined) continue
        if (!(c.text ?? '').trim()) continue
        orphans.push({ c, person: String(owner) })
      }
    }

    if (orphans.length > 0) {
      console.log(`\n${orphans.length} comments live only in the readings. Reading those too.`)
      let extra = 0
      for (let at = 0; at < orphans.length; at += BATCH) {
        const slice = orphans.slice(at, at + BATCH)
        const lines = slice.map(
          ({ c }, i) => `${i}. ${(c.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)}`,
        )
        const verdicts = await classifyBatch(lines, slice[0]?.person ?? 'this politician', banned)
        slice.forEach(({ c }, i) => {
          const v = verdicts[i] ?? { side: null, theme: null }
          c.side = v.side
          c.theme = v.theme
          if (v.side) extra++
        })
        await new Promise((r) => setTimeout(r, 700))
      }
      console.log(`${extra} of those placed on a side.`)
    }

    writeFileSync(REPORTS, JSON.stringify(reports))
    console.log(`${patched} carried across, ${orphans.length} read in place.`)
  }
}

void main()
