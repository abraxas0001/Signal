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
 * reports from the app's own /api/analyse. A failure is recorded or skipped,
 * never papered over with a made-up value.
 *
 * The endpoints run behind `netlify dev`, so start the app first.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROSTER = resolve(process.cwd(), 'public/demo-politicians.json')
const REPORTS = resolve(process.cwd(), 'public/demo-reports.json')
const API = process.env['SIGNAL_API'] ?? 'http://localhost:8888'

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

async function analyseOne(url: string): Promise<unknown | null> {
  const res = await fetch(`${API}/api/analyse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(240_000),
  })
  if (!res.ok || !res.body) return null
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let report: unknown = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          const evt = JSON.parse(line.slice(6)) as { type?: string; report?: unknown; message?: string }
          if (evt.type === 'report' && evt.report) report = evt.report
          if (evt.type === 'error') console.log(`    ${String(evt.message).slice(0, 70)}`)
        } catch {
          /* partial frame */
        }
      }
    }
  }
  return report
}

async function genReports(file: RosterFile): Promise<void> {
  const out: ReportsFile = existsSync(REPORTS)
    ? (JSON.parse(readFileSync(REPORTS, 'utf8')) as ReportsFile)
    : { generatedAt: new Date().toISOString(), reports: {} }

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
    const perPlatform = new Map<string, number>()
    const chosen: { post: Post; platform: string }[] = []
    for (const row of posts) {
      if (chosen.length >= 10) break
      const n = perPlatform.get(row.platform) ?? 0
      if (n >= 4) continue
      perPlatform.set(row.platform, n + 1)
      chosen.push(row)
    }

    console.log(`reports  ${person.name}: ${chosen.length} posts`)
    for (const { post, platform } of chosen) {
      if (out.reports[post.url]) {
        console.log(`  ${platform.padEnd(11)} cached`)
        continue
      }
      process.stdout.write(`  ${platform.padEnd(11)} ${post.url.slice(0, 62)} `)
      try {
        const report = await analyseOne(post.url)
        if (report) {
          out.reports[post.url] = report
          out.generatedAt = new Date().toISOString()
          writeFileSync(REPORTS, JSON.stringify(out))
          console.log('ok')
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
  const file = loadRoster()
  if (which === 'relevance' || which === 'all') await genRelevance(file)
  if (which === 'stances' || which === 'all') await genStances(file)
  if (which === 'opinions' || which === 'all') await genOpinions(file)
  if (which === 'reports' || which === 'all') await genReports(file)
  console.log('done')
}

void main()
