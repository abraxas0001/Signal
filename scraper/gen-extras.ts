/**
 * Fill the gaps the first collection left, using the app's own pipeline.
 *
 *   npx tsx scraper/gen-extras.ts stances     classify creator mentions
 *   npx tsx scraper/gen-extras.ts opinions    grounded opinion survey per person
 *   npx tsx scraper/gen-extras.ts reports     full analyse run over top posts
 *   npx tsx scraper/gen-extras.ts all
 *
 * Everything here lands in the demo dataset, so the same rule applies as in
 * read-opinions.ts: nothing is scored in this file. Stances come from a model
 * reading the real headline, opinions from the app's own /api/opinion, and
 * reports from the app's own extraction and analysis. A failure is recorded or
 * skipped, never papered over with a made-up value.
 *
 * `relevance`, `stances` and `opinions` call a model API or the app's own
 * endpoints behind `netlify dev`, so start the app before running those.
 * `reports` no longer needs it: it runs the same extractPost and analysePost
 * the endpoint runs, in this process, because between those two calls is the
 * only place the comments read by `npm run scraper:comments` can be put on the
 * snapshot. The note above analyseOne says why that matters.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractPost } from '../netlify/functions/lib/extract/index'
import { analysePost } from '../netlify/functions/lib/analyse'
import { PROVIDER_ENV_VARS, resolveProviders } from '../netlify/functions/lib/provider'
import type { Provider } from '../netlify/functions/lib/provider'
import type { Comment, Report } from '../shared/types'

const ROSTER = resolve(process.cwd(), 'public/demo-politicians.json')
const REPORTS = resolve(process.cwd(), 'public/demo-reports.json')
/**
 * The comments the signed-in browser scraper read, keyed by the URL of the post
 * they were left under. Written by scraper/read-comments.ts, and absent until
 * that has been run once, which is a supported state and reported as one. It
 * sits outside public/ because it is an input to this script rather than
 * something the app fetches; the comments reach the app inside the readings
 * written below.
 */
const COMMENTS = resolve(process.cwd(), 'scraper/demo-comments.json')
const API = process.env['SIGNAL_API'] ?? 'http://localhost:8888'

/**
 * How many comments a stored report carries.
 *
 * The prompt renders at most twenty of them and the report view lists the rest,
 * so forty is generous to a reader and still bounded: demo-reports.json is
 * already 941 KB and ships to every visitor of the example desk.
 */
const KEEP_PER_REPORT = 40

interface Post {
  url: string
  title?: string | null
  thumbnailUrl?: string | null
  likes?: number | null
  comments?: number | null
  shares?: number | null
  views?: number | null
  publishedAt?: string | null
  stances?: Record<string, { stance: string; about: string }>
  [k: string]: unknown
}
interface Handle {
  platform: string
  handle: string
  posts: Post[]
  failure?: string
  [k: string]: unknown
}
interface Person {
  key: string
  name: string
  party?: string
  partyTag?: string
  role?: string
  aliases?: string[]
  office?: { constituency?: string; state?: string } | null
  handles: Handle[]
  opinion?: unknown
  [k: string]: unknown
}
interface RosterFile {
  generatedAt: string
  pairings: { principal: string; rivals: unknown[] }[]
  people: Record<string, Person>
  creators: { key: string; name: string; handles: Handle[]; [k: string]: unknown }[]
  [k: string]: unknown
}

function loadRoster(): RosterFile {
  if (!existsSync(ROSTER)) {
    console.error('No demo dataset. Run the collection first.')
    process.exit(1)
  }
  return JSON.parse(readFileSync(ROSTER, 'utf8')) as RosterFile
}
/** Compact on purpose: the shipped file is compact and a pretty rewrite would
 *  turn a three-line change into a 40,000-line diff. */
function saveRoster(file: RosterFile): void {
  /**
   * Retried, because Windows hands out transient locks. A vite build copies
   * public/ while it runs, and one write landing in that window killed a
   * 400-post judging run at 72 percent with errno -4094. Three attempts with
   * a pause outlives any copy; a real failure still throws.
   */
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(ROSTER, JSON.stringify(file))
      return
    } catch (err) {
      if (attempt >= 3) throw err
      const wait = 500 * (attempt + 1)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait)
    }
  }
}

/**
 * The per-post comments, or an empty map when none have been read yet.
 *
 * The scraper stores its own ScrapedComment, which carries exactly the five
 * fields shared/types.ts calls a Comment: text, author, likes, publishedAt,
 * isReply. So the list goes onto the snapshot as it stands, and nothing here
 * fills in a field the platform did not publish. A like count the platform
 * never showed stays null and never becomes a zero.
 */
function loadComments(): Record<string, Comment[]> {
  if (!existsSync(COMMENTS)) return {}
  let parsed: { posts?: Record<string, { comments?: Comment[] }> }
  try {
    parsed = JSON.parse(readFileSync(COMMENTS, 'utf8')) as typeof parsed
  } catch (err) {
    /*
     * Stop rather than carry on without it. Carrying on would quietly generate
     * a hundred readings that score the post's own words, look completely
     * normal on the desk, and cache themselves against a re-read.
     */
    console.error(`reports: ${COMMENTS} could not be read: ${(err as Error).message}`)
    process.exit(1)
  }
  const out: Record<string, Comment[]> = {}
  for (const [url, entry] of Object.entries(parsed.posts ?? {})) {
    const list = (entry.comments ?? []).filter((c) => typeof c.text === 'string' && c.text.trim())
    if (list.length > 0) out[url] = list
  }
  return out
}

/**
 * What the serverless extractor could see, plus what the signed-in browser
 * could.
 *
 * The two are not alternatives. The extractor reads a post the way a signed-out
 * stranger does, and on Facebook it genuinely comes back with two or three; the
 * browser scraper is signed in and sees the section the way the public sees it.
 * Both are real comments on the same post, so the union is kept, and only an
 * exact repeat of the same words by the same author is dropped. The extractor's
 * own come first, because those are the ones the live product would have shown.
 */
function mergeComments(
  fromPost: Comment[] | undefined,
  fromScraper: Comment[],
  platform?: string,
): Comment[] | undefined {
  const merged: Comment[] = []
  const seen = new Set<string>()
  /*
   * On YouTube the two sources spell the same person differently and the
   * author cannot be part of the key.
   *
   * The browser reads `#author-text`, which is the handle: "@ravikumar123".
   * The extractor reads `displayName`, which is the name: "Ravi Kumar". Same
   * person, same comment, two keys, so one real comment became two, the header
   * told the model "2 shown of 2 the platform reports", and one voice was
   * weighted twice in the sentiment read. Four stored readings already carry
   * two hundred extractor comments, so this fires on the next run.
   *
   * Matching on the words alone costs something real in the other direction:
   * three different people each writing "Jai Hind" collapse to one. That is a
   * worse count and a better reading. Inflating the evidence and double-voting
   * one opinion is the more damaging of the two, so the words win here, and
   * only here: every other platform keeps the author in the key, because
   * elsewhere the two sources agree on how a person is named.
   */
  const authorless = platform === 'YouTube'
  for (const c of [...(fromPost ?? []), ...fromScraper]) {
    const flat = (c.text ?? '').replace(/\s+/g, ' ').trim()
    if (!flat) continue
    const key = authorless ? flat.toLowerCase() : `${flat.toLowerCase()}|${c.author ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(c)
  }
  /*
   * Undefined rather than an empty array. shared/types.ts is explicit that an
   * absent comment list means none could be retrieved, and an empty array would
   * be read as the claim that the post has none.
   */
  return merged.length > 0 ? merged.slice(0, KEEP_PER_REPORT) : undefined
}

/**
 * Put the keys where the app's own code looks for them.
 *
 * resolveProviders() and the extractors read process.env, which is how they are
 * handed their keys under `netlify dev`. This script is started as a plain
 * `npx tsx`, where nothing has loaded .env, and without this the analysis would
 * find no provider at all and every post would come back as measured figures
 * with no reading: a silent, file-filling failure rather than a loud one.
 */
function loadEnvKeys(): void {
  for (const name of [
    ...PROVIDER_ENV_VARS,
    'LLM_PROVIDER',
    'LLM_MODEL',
    'LLM_LABEL',
    'LLM_BASE_URL',
    'LLM_MAX_TOKENS',
    'YOUTUBE_API_KEY',
    'META_APP_TOKEN',
  ]) {
    if (process.env[name]) continue
    const value = envValue(name)
    if (value) process.env[name] = value
  }
}

function envValue(name: string): string | null {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    for (const line of raw.split('\n')) {
      const at = line.indexOf('=')
      if (at > 0 && line.slice(0, at).trim() === name) return line.slice(at + 1).trim()
    }
  } catch {
    /* fall through */
  }
  return null
}

/* ── the same words demo-content.ts uses to decide "about us" ────────────── */

const UNPUBLISHABLE =
  /\b(accused|arrested|rape|raped|molest|assault|murder|missing|victim|kidnap|pocso|posco|suicide)\b/i

function termsOf(p: Person): { term: string; about: 'person' | 'seat' | 'party' }[] {
  const out: { term: string; about: 'person' | 'seat' | 'party' }[] = []
  const push = (t: string | undefined | null, about: 'person' | 'seat' | 'party') => {
    if (typeof t === 'string' && t.length > 3) out.push({ term: t.toLowerCase(), about })
  }
  push(p.name, 'person')
  for (const a of p.aliases ?? []) push(a, 'person')
  push(p.office?.constituency, 'seat')
  push(p.partyTag, 'party')
  return out
}

/* ── stances: a model reads each matched headline once ───────────────────── */

async function groqJson(key: string, prompt: string): Promise<Record<string, unknown> | null> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      // The id the app's own provider file uses. llama-3.3-70b-versatile was
      // retired from this key; provider.ts moved to gpt-oss-120b for speed and
      // its comment carries the measurements.
      model: 'openai/gpt-oss-120b',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!res.ok) {
    // The full body, not a 120-char stub: the limiter names WHICH limit and
    // when it resets, and a run that cannot see that cannot decide whether to
    // wait a minute or stop for the day.
    console.log(`    groq HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`)
    return null
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  try {
    return JSON.parse(j.choices?.[0]?.message?.content ?? '') as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * The same JSON-out call against Gemini, for the day the Groq allowance runs
 * dry. The 568-post judging pass costs about 90k tokens, and the free Groq
 * tier caps at 200k a day shared with everything else this machine ran; the
 * run that hit the cap advanced through 132 posts writing nothing at all,
 * which is worse than stopping. Two providers, one honest answer.
 */
async function geminiJson(key: string, prompt: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(90_000),
    },
  )
  if (!res.ok) {
    console.log(`    gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return null
  }
  const j = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  try {
    return JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text ?? '') as Record<string, unknown>
  } catch {
    return null
  }
}

async function genStances(file: RosterFile): Promise<void> {
  const key = envValue('GROQ_API_KEY')
  if (!key) {
    console.error('stances: no GROQ_API_KEY in .env')
    return
  }
  const principals = file.pairings.map((p) => p.principal)

  interface Item {
    id: string
    post: Post
    principal: Person
    about: 'person' | 'seat' | 'party'
    outlet: string
    title: string
  }
  const items: Item[] = []
  for (const c of file.creators) {
    for (const h of c.handles) {
      for (const post of h.posts) {
        const title = (post.title ?? '').trim()
        if (!title || UNPUBLISHABLE.test(title)) continue
        const lower = title.toLowerCase()
        for (const pk of principals) {
          const person = file.people[pk]
          if (!person) continue
          if (post.stances?.[pk]) continue
          const hit = termsOf(person).find((t) => lower.includes(t.term))
          if (!hit) continue
          items.push({
            id: `${items.length}`,
            post,
            principal: person,
            about: hit.about,
            outlet: c.name,
            title,
          })
        }
      }
    }
  }
  console.log(`stances: ${items.length} matched headlines to classify`)

  for (let i = 0; i < items.length; i += 20) {
    const batch = items.slice(i, i + 20)
    const byPrincipal = new Map<string, Item[]>()
    for (const it of batch) {
      const list = byPrincipal.get(it.principal.key) ?? []
      list.push(it)
      byPrincipal.set(it.principal.key, list)
    }
    for (const [pk, group] of byPrincipal) {
      const p = file.people[pk]!
      const prompt = [
        `These are real headlines from Indian news and commentary accounts that mention ${p.name} (${p.role ?? ''}, ${p.party ?? ''}).`,
        `For each, judge the stance of the piece toward ${p.name}: "supportive", "critical", or "neutral".`,
        `Plain reporting or event coverage with no evaluation is "neutral". Judge only from the headline; do not guess beyond it.`,
        `Answer as JSON: {"items":[{"id":"<id>","stance":"supportive|critical|neutral"}]}`,
        ``,
        ...group.map((it) => `id ${it.id} [${it.outlet}]: ${it.title}`),
      ].join('\n')
      const out = await groqJson(key, prompt)
      const rows = Array.isArray(out?.['items']) ? (out!['items'] as Record<string, unknown>[]) : []
      for (const row of rows) {
        const it = group.find((g) => g.id === String(row['id']))
        const stance = String(row['stance'] ?? '')
        if (!it || !['supportive', 'critical', 'neutral'].includes(stance)) continue
        it.post.stances = { ...(it.post.stances ?? {}), [pk]: { stance, about: it.about } }
      }
      saveRoster(file)
      process.stdout.write(`  ${pk}: ${rows.length} judged\n`)
      await new Promise((r) => setTimeout(r, 1200))
    }
  }
}

/* ── opinions: the app's own grounded survey, one per person ─────────────── */

async function genOpinions(file: RosterFile): Promise<void> {
  const people = Object.values(file.people)
  let done = 0
  for (const p of people) {
    if (p.opinion) {
      console.log(`opinion  ${p.name.padEnd(26)} already read, skipping`)
      continue
    }
    process.stdout.write(`opinion  ${p.name.padEnd(26)}`)
    try {
      const searchRes = await fetch(`${API}/api/opinion`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          step: 'search',
          name: p.name,
          role: p.role ?? null,
          constituency: p.office?.constituency ?? null,
          state: p.office?.state ?? null,
          party: p.party ?? null,
        }),
        signal: AbortSignal.timeout(120_000),
      })
      const search = (await searchRes.json()) as { notes?: string; sources?: unknown[]; error?: string }
      if (!searchRes.ok || !search.notes) {
        console.log(`— ${String(search.error ?? `HTTP ${searchRes.status}`).slice(0, 60)}`)
        continue
      }
      const structRes = await fetch(`${API}/api/opinion`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step: 'structure', notes: search.notes, sources: search.sources ?? [] }),
        signal: AbortSignal.timeout(120_000),
      })
      const survey = (await structRes.json()) as Record<string, unknown>
      if (!structRes.ok || survey['error']) {
        console.log(`— ${String(survey['error'] ?? `HTTP ${structRes.status}`).slice(0, 60)}`)
        continue
      }
      p.opinion = { ...survey, readAt: new Date().toISOString() }
      saveRoster(file)
      done++
      console.log(`ok (score ${String(survey['score'] ?? '?')})`)
    } catch (err) {
      console.log(`— ${((err as Error).message ?? 'failed').split('\n')[0]?.slice(0, 60)}`)
    }
  }
  console.log(`opinions: ${done} written`)
}

/* ── reports: the real analyse pipeline over each principal's top posts ──── */

interface ReportsFile {
  generatedAt: string
  reports: Record<string, unknown>
}

/**
 * Retried, for the reason saveRoster is.
 *
 * This used to be a bare writeFileSync, and it was survivable while the file
 * was only ever appended to on a fresh run. It is not survivable now: a
 * re-read that lands in the window where a vite build is copying public/ would
 * throw errno -4094, take the run down, and lose the reading the model had just
 * been paid for.
 */
function saveReports(out: ReportsFile): void {
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(REPORTS, JSON.stringify(out))
      return
    } catch (err) {
      if (attempt >= 3) throw err
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * (attempt + 1))
    }
  }
}

/**
 * One post through the app's own pipeline, in this process.
 *
 * This used to POST to /api/analyse behind `netlify dev`, and it still calls
 * the two functions that endpoint calls, in the order it calls them. The one
 * thing it does between them is the reason it changed: it puts the comments on
 * `snapshot.comments`. AnalyseRequest has no field for comments, so over HTTP
 * there was nowhere to hand them in, and every stored reading went on scoring
 * the post's own words while real replies to that same post sat on disk
 * unused. lib/analyse.ts renderComments() does the rest: with comments present
 * it tells the model to judge sentiment and emotions from them rather than from
 * the post, and to say in the rationale that the reading is of the comments.
 *
 * The endpoint's response deadline is deliberately not reproduced. It exists
 * because Netlify kills a synchronous function at about sixteen seconds and a
 * truncated stream is worse than a short report; nothing kills this script, and
 * a stored example should hold the complete reading rather than whichever half
 * of it fitted inside a serverless budget.
 */
async function analyseOne(
  url: string,
  comments: Comment[],
  providers: Provider[],
): Promise<Report | null> {
  const started = Date.now()
  const { snapshot, extra } = await extractPost(url, {
    keys: { youtube: process.env['YOUTUBE_API_KEY'], meta: process.env['META_APP_TOKEN'] },
  })
  snapshot.comments = mergeComments(snapshot.comments, comments, snapshot.platform)

  const outcome = await analysePost(snapshot, extra, { providers }).catch((err: unknown) => {
    console.log(`\n    ${(err instanceof Error ? err.message : String(err)).slice(0, 140)}`)
    return null
  })
  /*
   * No half-report is stored. The endpoint hands the browser a figures-only
   * report when the model fails, because a person who has waited deserves the
   * numbers that were measured. A cache has no such excuse: every one of the
   * readings on disk carries a real analysis today, and writing an entry with a
   * null one would take that post out of the queue for good on the next run,
   * which is the cache poisoning itself.
   */
  if (!outcome) return null

  return {
    id: `rep_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    snapshot,
    analysis: outcome.analysis,
    meta: {
      model: outcome.model,
      durationMs: Date.now() - started,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      heuristicOnly: false,
    },
  }
}

async function genReports(file: RosterFile): Promise<void> {
  const out: ReportsFile = existsSync(REPORTS)
    ? (JSON.parse(readFileSync(REPORTS, 'utf8')) as ReportsFile)
    : { generatedAt: new Date().toISOString(), reports: {} }

  const providers = resolveProviders()
  if (providers.length === 0) {
    // Stopping, not proceeding. Without a provider every post would be
    // extracted, fail at the model, and print a line, and the run would spend
    // several minutes fetching a hundred posts to write nothing at all.
    console.error(`reports: no model is configured. Set one of ${PROVIDER_ENV_VARS.join(', ')} in .env.`)
    return
  }
  const comments = loadComments()
  const known = Object.keys(comments).length
  console.log(
    `reports: ${providers.map((p) => p.label).join(' then ')}. ` +
      (known > 0
        ? `${known} posts have comments on record.`
        : `no comments on record yet. Run \`npm run scraper:comments\` first, or every ` +
          `reading will score the post's own words.`),
  )

  const engagement = (p: Post): number =>
    (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + Math.round((p.views ?? 0) / 100)

  for (const pairing of file.pairings) {
    const person = file.people[pairing.principal]
    if (!person) continue
    const posts: { post: Post; platform: string }[] = []
    for (const h of person.handles) {
      if (h.failure) continue
      for (const post of h.posts) {
        if (!(post.title ?? '').trim() && !post.thumbnailUrl) continue
        posts.push({ post, platform: h.platform })
      }
    }
    posts.sort((a, b) => engagement(b.post) - engagement(a.post))

    /**
     * Top ten by engagement, but never more than four from one platform:
     * a strip of ten Facebook posts would say nothing about how the same
     * office lands on YouTube or X.
     */
    /* The desk's own person is read deeply, the rivals broadly.
       Every screen that shows a post shows the office's OWN posts eight at a
       time and offers a reading on each, so ten reports across four platforms
       left most rows saying "not read". A rival's column needs only enough to
       characterise them. */
    const own = pairing.principal === file.pairings[0]?.principal
    const perPlatformCap = own ? 10 : 4
    const totalCap = own ? 32 : 10
    const perPlatform = new Map<string, number>()
    const chosen: { post: Post; platform: string }[] = []
    const add = (row: { post: Post; platform: string }): void => {
      if (chosen.length >= totalCap) return
      if (chosen.some((c) => c.post.url === row.post.url)) return
      const n = perPlatform.get(row.platform) ?? 0
      if (n >= perPlatformCap) return
      perPlatform.set(row.platform, n + 1)
      chosen.push(row)
    }

    /**
     * Cover what the dashboard will actually show, both ends of it.
     *
     * The tables list top performers AND underperformers, filled by taking
     * each platform's best and worst in turn — so a budget spent purely on
     * the globally most-engaging posts left every underperforming row saying
     * "Not read", which is the one table where the reason matters most. Each
     * platform's top three and bottom three are taken first, ranked the way
     * the app ranks them (reactions where the platform publishes any, views
     * where it publishes only those), and whatever budget remains goes to the
     * strongest posts overall.
     */
    const byPlatform = new Map<string, { post: Post; platform: string }[]>()
    for (const row of posts) {
      byPlatform.set(row.platform, [...(byPlatform.get(row.platform) ?? []), row])
    }
    for (const list of byPlatform.values()) {
      const measured = list.some(
        (r) => r.post.likes != null || r.post.comments != null || r.post.shares != null,
      )
      const score = (r: { post: Post }): number =>
        measured
          ? (r.post.likes ?? 0) + (r.post.comments ?? 0) + (r.post.shares ?? 0)
          : (r.post.views ?? 0)
      const ranked = [...list].sort((a, b) => score(b) - score(a))
      for (const row of ranked.slice(0, 3)) add(row)
      for (const row of ranked.slice(-3)) add(row)
    }
    for (const row of posts) add(row)

    console.log(`reports  ${person.name}: ${chosen.length} posts`)
    for (const { post, platform } of chosen) {
      const forPost = comments[post.url] ?? []
      const stored = out.reports[post.url] as Report | undefined
      const storedComments = stored?.snapshot?.comments?.length ?? 0
      /*
       * A cached reading is kept unless there are now more comments on record
       * for that post than the reading was made from.
       *
       * A report generated before the scraper recorded this post's comments
       * judged its sentiment from the post's own words, and says exactly that
       * in its rationale; real replies to read instead are worth the one model
       * call. The comparison rather than a plain "has any" also picks up a
       * reading made from the two comments a signed-out fetch could see when
       * the signed-in browser has since read twenty-five. It converges: the
       * re-read stores the comments it used, so the next run finds them there
       * and skips.
       */
      if (stored && forPost.length <= storedComments) {
        console.log(`  ${platform.padEnd(11)} cached`)
        continue
      }
      const note = stored
        ? `re-reading, ${storedComments} comments to ${forPost.length} `
        : forPost.length > 0
          ? `${forPost.length} comments `
          : 'no comments '
      process.stdout.write(`  ${platform.padEnd(11)} ${post.url.slice(0, 52)} ${note}`)
      try {
        const report = await analyseOne(post.url, forPost, providers)
        if (report) {
          out.reports[post.url] = report
          out.generatedAt = new Date().toISOString()
          saveReports(out)
          // The count the model actually read, which is the extractor's own
          // comments and the scraper's together and is the only number worth
          // printing here.
          console.log(`ok, ${report.snapshot.comments?.length ?? 0} comments read`)
        } else {
          console.log('— no report')
        }
      } catch (err) {
        console.log(`— ${((err as Error).message ?? 'failed').split('\n')[0]?.slice(0, 50)}`)
      }
    }
  }
  console.log(`reports: ${Object.keys(out.reports).length} total on disk`)
}


/* ── relevance: the judge reads EVERY creator post, not just word matches ── */

/**
 * Why this exists when genStances already does. Stances only classified the
 * posts a WATCH WORD had already caught, and on this dataset that was the
 * whole problem in miniature: the Aruna desk's watched Telangana accounts hold
 * 409 posts and the literal strings "D. K. Aruna" or "Mahabubnagar" appear in
 * exactly one of them, because Telugu headlines write her name in Telugu or
 * call her "the Mahabubnagar MP". The app's own fix is the relevance layer,
 * which judges rather than matches; the demo makes no server calls, so the
 * judging happens here once, at build time, with the same rules the live
 * endpoint uses. Nothing is invented: a model reads the real headline and
 * says which of the five principals it is about, or none.
 */
async function genRelevance(file: RosterFile): Promise<void> {
  const key = envValue('GROQ_API_KEY')
  if (!key) {
    console.error('relevance: no GROQ_API_KEY in .env')
    return
  }
  const principals = file.pairings.map((pk) => file.people[pk.principal]).filter(Boolean) as Person[]
  const roster = principals
    .map(
      (p) =>
        `  ${p.key}: ${p.name}, ${p.role ?? ''}, ${p.party ?? ''}` +
        `${p.office?.constituency ? `, seat ${p.office.constituency}` : ''}` +
        `${p.aliases?.length ? `, also written ${p.aliases.join(' / ')}` : ''}`,
    )
    .join('\n')

  interface Item {
    id: number
    post: Post
    outlet: string
    title: string
  }
  const items: Item[] = []
  for (const c of file.creators) {
    for (const h of c.handles) {
      for (const post of h.posts) {
        const title = (post.title ?? '').trim()
        if (!title || UNPUBLISHABLE.test(title)) continue
        // Already judged against every principal in an earlier run.
        if (post.stances && principals.every((p) => p.key in (post.stances ?? {}))) continue
        items.push({ id: items.length, post, outlet: c.name, title })
      }
    }
  }
  console.log(`relevance: ${items.length} creator posts to judge against ${principals.length} principals`)

  let written = 0
  for (let i = 0; i < items.length; i += 12) {
    const batch = items.slice(i, i + 12)
    const prompt = [
      `These are real headlines from Indian news and commentary accounts. The politicians of interest:`,
      roster,
      ``,
      `For EACH headline, say which of those politicians it concerns, if any.`,
      `A politician is concerned when the piece is about them personally (about-person, including`,
      `when named only by office, like "the Mahabubnagar MP"), about their seat or its`,
      `administration (about-seat), or about their party in their own state (about-party).`,
      `A headline that merely contains a similar name is NOT about them. SPORT IS NEVER about a`,
      `politician: cricket, kabaddi, athletics, tournaments, players who share a surname. Films,`,
      `horoscopes, gold rates, weather, recipes and exam results are never about them either.`,
      `Also judge the stance of the piece toward that politician: supportive, critical, or neutral`,
      `(plain reporting is neutral).`,
      `Answer as JSON: {"items":[{"id":<id>,"hits":[{"key":"<principal key>",`,
      `"verdict":"about-person|about-seat|about-party","stance":"supportive|critical|neutral"}]}]}`,
      `A headline about none of them gets "hits": [].`,
      ``,
      ...batch.map((it) => `id ${it.id} [${it.outlet}]: ${it.title.slice(0, 140)}`),
    ].join('\n')

    let out: Record<string, unknown> | null = null
    const gemini = envValue('GEMINI_API_KEY')
    for (let attempt = 0; attempt < 2 && !out; attempt++) {
      out = await groqJson(key, prompt)
      if (!out && gemini) out = await geminiJson(gemini, prompt)
      if (!out) await new Promise((r) => setTimeout(r, 15_000))
    }
    const rows = Array.isArray(out?.['items']) ? (out!['items'] as Record<string, unknown>[]) : []
    for (const row of rows) {
      const it = batch.find((b) => b.id === Number(row['id']))
      if (!it) continue
      const hits = Array.isArray(row['hits']) ? (row['hits'] as Record<string, unknown>[]) : []
      for (const hit of hits) {
        const pk = String(hit['key'] ?? '')
        const verdict = String(hit['verdict'] ?? '')
        const stance = String(hit['stance'] ?? '')
        if (!principals.some((p) => p.key === pk)) continue
        if (!['about-person', 'about-seat', 'about-party'].includes(verdict)) continue
        if (!['supportive', 'critical', 'neutral'].includes(stance)) continue
        const about = verdict === 'about-person' ? 'person' : verdict === 'about-seat' ? 'seat' : 'party'
        it.post.stances = { ...(it.post.stances ?? {}), [pk]: { stance, about } }
        written++
      }
    }
    saveRoster(file)
    process.stdout.write(`  ${Math.min(i + 12, items.length)}/${items.length} judged, ${written} hits so far\n`)
    await new Promise((r) => setTimeout(r, 1500))
  }
  console.log(`relevance: ${written} principal-post links written`)
}

/* ── main ─────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const which = process.argv[2] ?? 'all'
  loadEnvKeys()
  const file = loadRoster()
  if (which === 'relevance' || which === 'all') await genRelevance(file)
  if (which === 'stances' || which === 'all') await genStances(file)
  if (which === 'opinions' || which === 'all') await genOpinions(file)
  if (which === 'reports' || which === 'all') await genReports(file)
  console.log('done')
}

void main()
