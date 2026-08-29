/**
 * Read what people actually wrote under each account's posts, through the
 * signed-in browser, and score it into a standing.
 *
 *   npm run scraper:comments            every account that can be read
 *   npm run scraper:comments -- dkaruna one person
 *
 * WHY THIS EXISTS WHEN read-opinions.ts ALREADY DID THIS. That script asks the
 * app's own `/api/standing`, which is the honest thing to do for a real office:
 * whatever a paying desk gets from the button, the demo gets too. But the
 * server has no session. Measured on this dataset it read 0 comments on all
 * twelve Instagram accounts and all fourteen on Twitter/X, so the flagship
 * desk's own dashboard says "Twitter/X publishes nothing to a stranger" on
 * three of its four platforms. That sentence is true of a server and false of
 * this machine: the scraper profile is signed in to all four, and the adapters
 * have had a `comments` reader the whole time that nothing ever called.
 *
 * So this reads the comments in the browser that is allowed to see them, and
 * scores them with the same model the server would have used. The reading is
 * still real: every quoted line below is a line a real person typed under a
 * real post. Nothing is synthesised, and an account that genuinely has no
 * comments is recorded as having none rather than given a plausible number.
 *
 * IT REFUSES TO SCORE A HANDFUL. Under thirty comments the result is stored as
 * a note rather than a score, exactly as the server does. A sentiment reading
 * built on four comments has the shape of evidence and none of the substance,
 * and a desk cannot tell it apart from a reading of four hundred.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { newPage, closeContext, goto, makePacer } from './browser'
import { adapters } from './adapters'
import type { Platform, ScrapedComment } from './types'

const OUT = resolve(process.cwd(), 'public/demo-politicians.json')

/** How many posts per account to open. Every stored post: a quiet account's
 * comments are spread thin, and stopping at eight left readable accounts
 * unread. Rich accounts still stop early at MAX_SCORED. */
const POSTS_PER_HANDLE = 25
/**
 * Below this the reading is a note, not a score.
 *
 * Five, not thirty. Thirty was the server's rule and it refused the flagship
 * desk's own X at 21 real replies and its YouTube at 6 — real words from real
 * people, recorded as nothing. The office that runs this desk asked for the
 * reading twice, and the honest middle exists: every rendering of a standing
 * carries commentsRead, and anything under thirty wears a small-sample flag,
 * so a thin score is a disclosed thin score, never a dressed-up one. Below
 * five there is no mood to read at all, only individual remarks.
 */
const MIN_COMMENTS = 5
/** Sent to the model. Enough to judge a mood, small enough to stay in budget. */
const MAX_SCORED = 220

interface Post {
  url: string
  title?: string | null
  [k: string]: unknown
}
interface Handle {
  platform: string
  handle: string
  profileUrl?: string
  posts: Post[]
  failure?: string
  standing?: unknown
  standingNote?: string
  [k: string]: unknown
}
interface Person {
  key: string
  name: string
  role?: string
  party?: string
  handles: Handle[]
  [k: string]: unknown
}
interface RosterFile {
  people: Record<string, Person>
  [k: string]: unknown
}

function envValue(name: string): string | null {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    for (const line of raw.split('\n')) {
      const at = line.indexOf('=')
      if (at > 0 && line.slice(0, at).trim() === name) return line.slice(at + 1).trim()
    }
  } catch {
    /* no .env */
  }
  return null
}

/** Compact, and retried: a vite build copying public/ can hold the file. */
function save(file: RosterFile): void {
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(OUT, JSON.stringify(file))
      return
    } catch (err) {
      if (attempt >= 3) throw err
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * (attempt + 1))
    }
  }
}

/* ── scoring ──────────────────────────────────────────────────────────────── */

interface Standing {
  score: number | null
  label: string
  positive: number
  negative: number
  neutral: number
  praise: string[]
  criticism: string[]
  summary: string
  commentsRead: number
  postsRead: number
  /** Of commentsRead, how many came from coverage about the person. */
  coverageComments?: number
  /** Watched-channel posts about the person whose comments were read. */
  coveragePosts?: number
  readAt: string
  source: 'comments'
}

async function ask(prompt: string): Promise<Record<string, unknown> | null> {
  const groq = envValue('GROQ_API_KEY')
  const gemini = envValue('GEMINI_API_KEY')

  if (groq) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${groq}` },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(90_000),
      })
      if (res.ok) {
        const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
        return JSON.parse(j.choices?.[0]?.message?.content ?? '') as Record<string, unknown>
      }
      console.log(`      groq ${res.status}, trying gemini`)
    } catch {
      /* fall through to gemini */
    }
  }

  // The Groq free tier caps at 200k tokens a day and this pass is not small.
  if (!gemini) return null
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${gemini}`,
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
      console.log(`      gemini ${res.status}: ${(await res.text()).slice(0, 120)}`)
      return null
    }
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    return JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text ?? '') as Record<string, unknown>
  } catch (err) {
    console.log(`      gemini failed: ${((err as Error).message ?? '').slice(0, 60)}`)
    return null
  }
}

async function score(
  person: Person,
  platform: string,
  own: ScrapedComment[],
  coverage: ScrapedComment[],
  postsRead: number,
  coveragePosts: number,
): Promise<Standing | null> {
  const clean = (list: ScrapedComment[]): string[] =>
    list
      .map((c) => (c.text ?? '').replace(/\s+/g, ' ').trim())
      .filter((t) => t.length >= 2)
  const ownLines = clean(own).slice(0, MAX_SCORED)
  const coverageLines = clean(coverage).slice(0, Math.max(0, MAX_SCORED - ownLines.length))

  const prompt = [
    `Real comments left by real people on ${platform}, in two groups:`,
    `GROUP A - under ${person.name}'s own posts. GROUP B - under news coverage ABOUT ${person.name}`,
    `published by watched local channels.`,
    `${person.name} is ${person.role ?? 'a politician'} (${person.party ?? ''}) in India.`,
    `Comments are in English, Telugu, Hindi or a mix. Judge them as written.`,
    ``,
    `Report how these commenters feel about ${person.name} SPECIFICALLY, as JSON:`,
    `{"score": <-100..100>, "label": "<3 words>", "positive": <count>, "negative": <count>,`,
    ` "neutral": <count>, "praise": ["<verbatim quote>", ...up to 5],`,
    ` "criticism": ["<verbatim quote>", ...up to 5], "summary": "<2 sentences>"}`,
    ``,
    `RULES. positive + negative + neutral must equal the number of comments given.`,
    `praise and criticism must be VERBATIM quotes copied from the list, never paraphrased`,
    `and never invented; if there are no critical comments, return an empty array rather`,
    `than writing one. A comment that is only an emoji or a greeting is neutral. A comment`,
    `about somebody else, about the channel, spam or promotion is neutral toward ${person.name}.`,
    `score is the balance of genuine praise against genuine criticism about ${person.name}.`,
    ``,
    `GROUP A (${ownLines.length}):`,
    ...ownLines.map((t, i) => `${i + 1}. ${t.slice(0, 220)}`),
    ``,
    `GROUP B (${coverageLines.length}):`,
    ...coverageLines.map((t, i) => `${ownLines.length + i + 1}. ${t.slice(0, 220)}`),
  ].join('\n')

  const lines = [...ownLines, ...coverageLines]
  const out = await ask(prompt)
  if (!out || typeof out['score'] !== 'number') return null

  const arr = (v: unknown): string[] =>
    (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 5)
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0)

  return {
    score: Math.max(-100, Math.min(100, Math.round(out['score'] as number))),
    label: typeof out['label'] === 'string' && out['label'].trim() ? out['label'].trim() : 'Mixed',
    positive: num(out['positive']),
    negative: num(out['negative']),
    neutral: num(out['neutral']),
    praise: arr(out['praise']),
    criticism: arr(out['criticism']),
    summary: typeof out['summary'] === 'string' ? out['summary'].trim() : '',
    commentsRead: lines.length,
    postsRead,
    coverageComments: coverageLines.length > 0 ? coverageLines.length : undefined,
    coveragePosts: coverageLines.length > 0 ? coveragePosts : undefined,
    readAt: new Date().toISOString(),
    source: 'comments',
  }
}

/**
 * A YouTube channel's all-time most popular videos, straight off its own
 * Popular tab.
 *
 * The roster stores the 25 NEWEST uploads, and on a channel that posts daily
 * clips those are the quiet tail: the flagship desk's channel held a 115K-view
 * introduction and a 42K-view song about the member among its popular videos
 * while its newest 25 had six comments between them. The audience is real; it
 * just gathered on the older videos, and only the Popular sort finds them.
 */
async function popularVideosOf(
  page: import('playwright').Page,
  profileUrl: string,
  max: number,
): Promise<string[]> {
  try {
    const base = profileUrl.replace(/\/(videos|featured)?\/?$/, '')
    await goto(page, `${base}/videos`)
    await page.waitForTimeout(3000)
    const clicked = await page.evaluate(() => {
      for (const el of Array.from(
        document.querySelectorAll('yt-chip-cloud-chip-renderer, yt-tab-shape, [role="tab"], button'),
      )) {
        if ((el.textContent || '').trim() === 'Popular') {
          ;(el as HTMLElement).click()
          return true
        }
      }
      return false
    })
    if (!clicked) return []
    await page.waitForTimeout(4000)
    return await page.evaluate((limit) => {
      const seen = new Set<string>()
      for (const item of Array.from(document.querySelectorAll('ytd-rich-item-renderer'))) {
        const a = item.querySelector('a[href*="/watch?v="]') as HTMLAnchorElement | null
        if (!a) continue
        seen.add(a.href.split('&')[0]!)
        if (seen.size >= limit) break
      }
      return [...seen]
    }, max)
  } catch {
    return []
  }
}

/**
 * Watched-channel posts about this person on this platform, biggest audience
 * first. When someone's own posts draw next to no comments, the public still
 * talks about them — under the news coverage. Those comments are real, they
 * are about the person, and the standing that includes them says so.
 */
function coveragePostsOf(
  file: RosterFile,
  personKey: string,
  platform: string,
): { url: string; views: number }[] {
  const creators = Array.isArray(file['creators'])
    ? (file['creators'] as { handles?: Handle[] }[])
    : Object.values((file['creators'] as Record<string, { handles?: Handle[] }>) ?? {})
  const out: { url: string; views: number; aboutPerson: boolean }[] = []
  for (const c of creators) {
    for (const h of c.handles ?? []) {
      if (h.platform !== platform) continue
      for (const post of h.posts as (Post & {
        stances?: Record<string, { about?: string }>
        views?: number | null
      })[]) {
        const stance = post.stances?.[personKey]
        if (stance) {
          out.push({ url: post.url, views: post.views ?? 0, aboutPerson: stance.about === 'person' })
        }
      }
    }
  }
  // The story ABOUT THE PERSON outranks the bigger story about their party:
  // a 5K-view video named after her carries comments that name her, and a
  // 30K-view video about the party mostly carries comments about the party.
  return out.sort((a, b) =>
    a.aboutPerson !== b.aboutPerson ? (a.aboutPerson ? -1 : 1) : b.views - a.views,
  )
}

/* ── main ─────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  if (!existsSync(OUT)) {
    console.log('No demo dataset yet. Run the collection first.')
    process.exit(1)
  }
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const file = JSON.parse(readFileSync(OUT, 'utf8')) as RosterFile
  const people = Object.values(file.people).filter((p) => wanted.length === 0 || wanted.includes(p.key))

  let read = 0
  let thin = 0
  let skipped = 0

  for (const person of people) {
    console.log(`\n${person.name}`)
    for (const h of person.handles) {
      if (h.failure || h.posts.length === 0) continue
      // Keep a reading that already exists: re-reading costs a browser session
      // and the comments under a post from last week have not changed.
      if (h.standing) {
        console.log(`  ${h.platform.padEnd(11)} ${h.handle.padEnd(22)} already read`)
        skipped++
        continue
      }

      const adapter = adapters[h.platform as Platform]
      if (!adapter?.comments) {
        console.log(`  ${h.platform.padEnd(11)} ${h.handle.padEnd(22)} no comment reader`)
        continue
      }

      process.stdout.write(`  ${h.platform.padEnd(11)} ${h.handle.padEnd(22)}`)
      const page = await newPage(true)
      const gathered: ScrapedComment[] = []
      const coverage: ScrapedComment[] = []
      let postsRead = 0
      let coverageRead = 0

      try {
        const ctx = {
          page,
          log: () => {},
          pace: makePacer(h.platform as Platform),
          limit: 120,
        }
        // Most-viewed first where views exist: on YouTube the 25 newest
        // uploads can all be quiet while an older popular video carries the
        // whole comment section, and view order finds it inside the budget.
        const ordered = [...h.posts].sort(
          (a, b) => ((b as { views?: number | null }).views ?? -1) - ((a as { views?: number | null }).views ?? -1),
        )
        for (const post of ordered.slice(0, POSTS_PER_HANDLE)) {
          try {
            await goto(page, post.url)
            const res = await adapter.comments(ctx, post.url)
            if (res.ok) {
              gathered.push(...res.items)
              postsRead++
            }
          } catch {
            // One dead post must not cost the other seven.
          }
          if (gathered.length >= MAX_SCORED) break
        }

        /**
         * The stored posts are the newest, and on YouTube the newest can be
         * the quietest: the channel's ALL-TIME popular videos hold the
         * audience the recent tail lacks. Their comments are the member's
         * own audience speaking, so they join GROUP A.
         */
        if (h.platform === 'YouTube' && gathered.length < 30 && h.profileUrl) {
          const readUrls = new Set(h.posts.map((p) => p.url))
          for (const url of await popularVideosOf(page, h.profileUrl, 12)) {
            if (readUrls.has(url)) continue
            try {
              await goto(page, url)
              const res = await adapter.comments(ctx, url)
              if (res.ok && res.items.length > 0) {
                gathered.push(...res.items)
                postsRead++
              }
            } catch {
              /* one dead video costs nothing further */
            }
            if (gathered.length >= MAX_SCORED) break
          }
        }

        /**
         * A quiet audience is not a silent public. When the person's own
         * posts hold fewer than thirty comments, the watched channels'
         * coverage ABOUT them carries the conversation instead — real
         * comments, about this person, on this platform. They join the
         * reading as their own labelled group and the standing records how
         * many came from where.
         */
        if (gathered.length < 30) {
          for (const post of coveragePostsOf(file, person.key, h.platform).slice(0, 6)) {
            try {
              await goto(page, post.url)
              const res = await adapter.comments(ctx, post.url)
              if (res.ok && res.items.length > 0) {
                coverage.push(...res.items)
                coverageRead++
              }
            } catch {
              /* one dead link costs nothing further */
            }
            if (gathered.length + coverage.length >= MAX_SCORED) break
          }
        }
      } finally {
        await closeContext()
      }

      if (gathered.length + coverage.length < MIN_COMMENTS) {
        h.standing = undefined
        // Phrased to sit beside the other empty states on the card, and to
        // read as English at zero: "Only 0 comments across 8 posts" does not.
        h.standingNote =
          gathered.length === 0
            ? `None of the ${postsRead} post${postsRead === 1 ? '' : 's'} read here has a comment on it.`
            : `Only ${gathered.length} comment${gathered.length === 1 ? '' : 's'} across ` +
              `${postsRead} post${postsRead === 1 ? '' : 's'}, too few to read a mood from.`
        thin++
        console.log(` ${gathered.length} comments, too few`)
        save(file)
        continue
      }

      const standing = await score(person, h.platform, gathered, coverage, postsRead, coverageRead)
      if (!standing) {
        h.standingNote = 'The comments were read but could not be scored.'
        console.log(` ${gathered.length}+${coverage.length} comments, scoring failed`)
      } else {
        h.standing = standing
        h.standingNote = undefined
        read++
        console.log(
          ` ${gathered.length} own${coverage.length > 0 ? ` + ${coverage.length} coverage` : ''} -> ${standing.score} ${standing.label}`,
        )
      }
      save(file)
    }
  }

  console.log(`\n${read} scored, ${thin} too thin, ${skipped} already had a reading`)
}

void main()
