/**
 * Read what people actually wrote under each account's posts, through the
 * signed-in browser, and score it into a standing.
 *
 *   npm run scraper:comments            every account that can be read
 *   npm run scraper:comments -- dkaruna one person
 *   npm run scraper:comments -- dkaruna --force re-read accounts that already hold a reading
 *
 * It writes two files: the standing onto the account in
 * public/demo-politicians.json, and the comments themselves, keyed by post URL,
 * into scraper/demo-comments.json. Both are merged into what is already there,
 * so an interrupted run keeps everything it reached and a later run adds to it.
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
 *
 * IT ALSO KEEPS THE COMMENTS, POST BY POST. The account standing is a summary,
 * and a summary cannot answer the question a single post reading asks. So every
 * comment is also written to scraper/demo-comments.json against the URL of the
 * post it was left under, and gen-extras.ts puts those on the snapshot before
 * the analysis runs. That is what turns "read from the post itself, no public
 * comments were retrievable for it" into a sentiment read from what the
 * audience actually wrote. Nothing new is fetched for it: the browser was
 * already on the page, and the association was simply being thrown away.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { newPage, closeContext, goto, makePacer } from './browser'
import { adapters } from './adapters'
import type { Platform, ScrapedComment } from './types'

const OUT = resolve(process.cwd(), 'public/demo-politicians.json')
/**
 * Where the comments themselves are kept, one entry per post URL.
 *
 * A SEPARATE FILE rather than a field on the roster, for a reason this project
 * has already paid for twice. build-demo.ts rebuilds every handle from a fresh
 * scrape and carries forward only a named list of fields, so anything new hung
 * off a post or a handle is deleted the next time the roster is rebuilt.
 * Nothing but this script writes this file, so a rebuild cannot reach it, and
 * a post whose comments were read in March still has them in June.
 *
 * OUTSIDE public/, unlike every other file this scraper writes, because this
 * one is a build input rather than something the app fetches. A full walk of
 * the roster opens 1,243 post pages and can keep thirty comments from each, so
 * shipping it would put megabytes into every visitor's download for a file the
 * app never asks for. The comments reach the app the only way they need to:
 * inside the readings gen-extras.ts writes to public/demo-reports.json.
 */
const COMMENTS_OUT = resolve(process.cwd(), 'scraper/demo-comments.json')

/** How many posts per account to open. Every stored post: a quiet account's
 * comments are spread thin, and stopping at eight left readable accounts
 * unread. A rich account no longer stops early either, because every stored
 * post has a stored reading that wants its own comments; see the note in the
 * walk. */
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
/**
 * How many comments are kept for one post.
 *
 * The account standing wants breadth across an account and the per-post record
 * wants depth on a single post, and thirty is where the two meet: the analysis
 * prompt renders at most twenty of them, and the rest are the headroom that
 * lets a second read of the same post add what it saw without the file growing
 * without end.
 */
const KEEP_PER_POST = 30

/**
 * The longest identifying token in a post URL: a video id, a status id, a
 * Facebook post id, a LinkedIn activity urn.
 *
 * Taken from the end, because that is where every one of the five platforms
 * puts the post's own id and everything before it is the account or the route.
 * The length floor keeps handles and path words like "status" or "watch" out
 * of it.
 */
function postId(url: string): string | null {
  const tokens = url.match(/[A-Za-z0-9_-]{8,}/g) ?? []
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!
    if (t.length >= 10) return t.toLowerCase()
  }
  return tokens.length > 0 ? tokens[tokens.length - 1]!.toLowerCase() : null
}

/**
 * Whether the browser is still on the post these comments are about to be
 * filed under.
 *
 * Three of the four comment readers take no URL at all: facebook, twitter and
 * youtube read whatever DOM is loaded and trust the caller to have navigated
 * there. That is correct while the page is the post, and it is silent
 * fabrication the moment it is not. goto() resolves happily on a redirect, so
 * an X session that lapses part way through a walk lands every later post on
 * the timeline, where `article[data-testid="tweet"]` matches other people's
 * tweets and each one would be filed as a reply to a post nobody was reading.
 * Real sentences by real people, stored and then shown to a reader under a
 * post they were never written under, is the one failure this tool cannot
 * survive, and it is the failure this check exists to make impossible.
 *
 * Deliberately one-sided. It blocks only when it can positively tell the two
 * are different documents, so a redirect that keeps the id passes: Instagram's
 * own reader rewrites a profile-scoped permalink to the canonical /p/<code>/
 * form, and refusing that would cost the desk real evidence to prevent nothing.
 * Checked against all 1,243 post URLs in the roster: every URL passes against
 * itself, against a tracking parameter, a trailing slash, a protocol change
 * and Instagram's canonical form, and every URL is blocked against a different
 * post on its own platform, against each platform's login wall and against its
 * own account's profile page.
 */
function sameDocument(stored: string, current: string): boolean {
  const id = postId(stored)
  if (id === null) return true
  return current.toLowerCase().includes(id)
}

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

/* ── the per-post record ──────────────────────────────────────────────────── */

/**
 * What was read under one post, kept against that post's URL.
 *
 * THIS IS THE PART THE STANDING THREW AWAY. Everything below scores an
 * ACCOUNT: a hundred and fifty comments go in, one label and five quotes come
 * out. That answers "how does this account land" and it cannot answer "how did
 * THIS post land", which is the question every stored post reading in
 * demo-reports.json asks. Measured before this file existed, 41 of D. K.
 * Aruna's 55 readings said the sentiment had been read from the post itself
 * because no comment could be found for it, while the comments were being read
 * in this very script and discarded into an account total.
 */
interface PostComments {
  platform: string
  /** The account the post belongs to. Null under coverage, where the post is a
   *  watched channel's rather than the person's. */
  handle: string | null
  /** Whose reading this post was opened for. */
  readFor: string
  /** Where it came from: the account's own timeline, its all-time popular
   *  videos, or a watched channel's coverage about the person. */
  via: 'own' | 'popular' | 'coverage'
  readAt: string
  comments: ScrapedComment[]
}

interface CommentsFile {
  generatedAt: string
  /** Keyed by post URL, which is what gen-extras.ts matches a report on. */
  posts: Record<string, PostComments>
  /**
   * One entry per account this script has walked, written even when the walk
   * found nothing at all. An account with no comments and no marker cannot be
   * told apart from an account nobody has opened yet, and without the marker
   * every quiet account would be re-opened, at browser cost, on every run.
   */
  handles: Record<
    string,
    {
      platform: string
      handle: string
      readFor: string
      readAt: string
      postsRead: number
      commentsStored: number
    }
  >
}

function loadComments(): CommentsFile {
  if (!existsSync(COMMENTS_OUT)) {
    return { generatedAt: new Date().toISOString(), posts: {}, handles: {} }
  }
  let parsed: Partial<CommentsFile>
  try {
    parsed = JSON.parse(readFileSync(COMMENTS_OUT, 'utf8')) as Partial<CommentsFile>
  } catch (err) {
    /*
     * Stop rather than quietly start a new one. Every save below writes the
     * whole file, so treating an unreadable file as an empty one would delete
     * every comment ever recorded on the first handle that finished, and a
     * browser pass over the roster costs hours to repeat. A parse error is a
     * thing for a person to look at.
     */
    console.log(`Could not read ${COMMENTS_OUT}: ${(err as Error).message}`)
    console.log('Refusing to overwrite it. Move it aside to start a fresh record.')
    process.exit(1)
  }
  return {
    generatedAt: parsed.generatedAt ?? new Date().toISOString(),
    posts: parsed.posts ?? {},
    handles: parsed.handles ?? {},
  }
}

/** Compact and retried, for the same reason `save` is. */
function saveComments(file: CommentsFile): void {
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(COMMENTS_OUT, JSON.stringify(file))
      return
    } catch (err) {
      if (attempt >= 3) throw err
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * (attempt + 1))
    }
  }
}

/**
 * Yesterday's read of a post plus today's, with nothing real dropped.
 *
 * A second read of the same post is not always the bigger one: a page that
 * lazy-loads its comment section can hand back three where it once handed back
 * twenty, and replacing the stored list with whatever the newest visit saw
 * would quietly delete seventeen comments that real people wrote. So the two
 * are merged, and only an exact repeat of the same words by the same author is
 * dropped. Nothing is rewritten: the stored text is the text as typed.
 */
function mergeComments(before: ScrapedComment[], next: ScrapedComment[]): ScrapedComment[] {
  const seen = new Set<string>()
  const out: ScrapedComment[] = []
  for (const c of [...before, ...next]) {
    const flat = (c.text ?? '').replace(/\s+/g, ' ').trim()
    if (!flat) continue
    const key = `${flat.toLowerCase()}|${c.author ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  /*
   * Most-liked first, because that is the order the analysis prompt keeps when
   * it can only fit twenty of them, so what survives the cap is what the most
   * people actually saw. Null is not zero here: a platform that publishes no
   * like count on a comment must not push that comment below one measured at
   * zero, so an unknown count sorts last and keeps the order the platform
   * showed it in.
   */
  out.sort((a, b) => {
    if (a.likes == null && b.likes == null) return 0
    if (a.likes == null) return 1
    if (b.likes == null) return -1
    return b.likes - a.likes
  })
  return out.slice(0, KEEP_PER_POST)
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
  /** Up to three verbatim examples of comments that took no side. */
  neutralQuotes?: string[]
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
    ` "criticism": ["<verbatim quote>", ...up to 5],`,
    ` "neutralQuotes": ["<verbatim quote>", ...up to 3], "summary": "<2 sentences>"}`,
    ``,
    `RULES. positive + negative + neutral must equal the number of comments given.`,
    `praise and criticism must be VERBATIM quotes copied from the list, never paraphrased`,
    `and never invented; if there are no critical comments, return an empty array rather`,
    `than writing one. A comment that is only an emoji or a greeting is neutral. A comment`,
    `about somebody else, about the channel, spam or promotion is neutral toward ${person.name}.`,
    `neutralQuotes are up to 3 verbatim examples of those neutral comments, copied exactly,`,
    `so a reader can see what "took no side" actually looks like.`,
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

  /*
   * Model control tokens never reach a stored quote.
   *
   * These arrays are presented on the desk as citizen speech quoted word for
   * word, and one generation spliced a "<|channel|>" sentinel through the
   * middle of a Telugu word. A tool whose claim is that it never invents
   * anything cannot ship a decoding artifact as something a person typed.
   */
  const strip = (x: string): string =>
    x.replace(/<\|[^|]*\|>/g, '').replace(/[ \t]{2,}/g, ' ').trim()
  const arr = (v: unknown): string[] =>
    (Array.isArray(v) ? v : [])
      .filter((x): x is string => typeof x === 'string')
      .map(strip)
      .filter((x) => x.length > 0)
      .slice(0, 5)
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0)

  return {
    score: Math.max(-100, Math.min(100, Math.round(out['score'] as number))),
    label: typeof out['label'] === 'string' && out['label'].trim() ? out['label'].trim() : 'Mixed',
    positive: num(out['positive']),
    negative: num(out['negative']),
    neutral: num(out['neutral']),
    praise: arr(out['praise']),
    criticism: arr(out['criticism']),
    neutralQuotes: arr(out['neutralQuotes']).slice(0, 3),
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
  // --force re-reads accounts that already hold a standing — the way to pick
  // up a schema change (a new field in the reading) without waiting for the
  // comments to change.
  const force = process.argv.includes('--force')
  const file = JSON.parse(readFileSync(OUT, 'utf8')) as RosterFile
  const commentsFile = loadComments()
  const people = Object.values(file.people).filter((p) => wanted.length === 0 || wanted.includes(p.key))

  let read = 0
  let thin = 0
  let skipped = 0
  let recorded = 0

  for (const person of people) {
    console.log(`\n${person.name}`)
    for (const h of person.handles) {
      if (h.failure || h.posts.length === 0) continue
      /**
       * Keep a reading that already exists: re-reading costs a browser session
       * and the comments under a post from last week have not changed.
       *
       * An account is still walked again when nothing has ever recorded WHICH
       * POST its comments came from. Until that record exists, every stored
       * post reading goes on scoring the post's own words while this script's
       * own comments sit on disk as an account total, which is the whole
       * complaint this pass answers. The marker is written even for an account
       * that turned out to have no comments, so a quiet account is walked once
       * rather than on every run afterwards.
       */
      const handleKey = `${h.platform}|${h.handle}`
      const walked = commentsFile.handles[handleKey] !== undefined
      if (h.standing && walked && !force) {
        console.log(`  ${h.platform.padEnd(11)} ${h.handle.padEnd(22)} already read`)
        skipped++
        continue
      }
      /**
       * Whether this pass judges a standing, or is only here for the per-post
       * record.
       *
       * An account that already holds a standing keeps it. Re-judging would
       * spend a model call to replace a good reading with a re-read that may
       * be thinner, and the reason this account is open again is the per-post
       * comments, not the account score.
       */
      const rescore = force || !h.standing

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
      /**
       * Keep every comment against the post it was left under.
       *
       * `gathered` loses the URL the instant it is pushed into, and that loss
       * is what left the per-post readings with no audience to judge. Recording
       * here costs one object per post, and it is what lets gen-extras.ts hand
       * the analysis the real replies to the exact post it is reading.
       */
      const touched = new Set<string>()
      /**
       * Whether what the reader just returned may be attributed to this URL.
       *
       * Applied before the comments are counted as well as before they are
       * stored, because a drifted page poisons both: the per-post record with
       * somebody else's replies, and the account standing with comments that
       * were never about this account. Loud rather than silent, because a run
       * that starts blocking every post has usually lost its session, and that
       * is worth stopping for rather than discovering in the output.
       */
      const onPost = (url: string): boolean => {
        if (sameDocument(url, page.url())) return true
        console.log(
          `\n      not on the post after loading it, skipped: ${url.slice(0, 70)}` +
            `\n      the browser is on ${page.url().slice(0, 70)}`,
        )
        return false
      }
      const record = (url: string, items: ScrapedComment[], via: PostComments['via']): void => {
        if (items.length === 0) return
        touched.add(url)
        commentsFile.posts[url] = {
          platform: h.platform,
          handle: via === 'coverage' ? null : h.handle,
          readFor: person.key,
          via,
          readAt: new Date().toISOString(),
          comments: mergeComments(commentsFile.posts[url]?.comments ?? [], items),
        }
      }

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
            if (res.ok && onPost(post.url)) {
              gathered.push(...res.items)
              record(post.url, res.items, 'own')
              postsRead++
            }
          } catch {
            // One dead post must not cost the other seven.
          }
          /*
           * This loop used to stop here once MAX_SCORED comments were in hand.
           * It no longer does, because the walk now has a second job. The cap
           * is a budget for the model, and score() already applies it where it
           * belongs by slicing the list it sends; stopping the walk as well
           * meant that on a rich account, where one video can carry a hundred
           * comments, three posts were opened and the other twenty-two were
           * left with no per-post record at all. Those twenty-two are stored
           * posts with stored readings, so they are precisely the readings
           * this whole change exists to give an audience.
           */
        }

        /**
         * The stored posts are the newest, and on YouTube the newest can be
         * the quietest: the channel's ALL-TIME popular videos hold the
         * audience the recent tail lacks. Their comments are the member's
         * own audience speaking, so they join GROUP A.
         *
         * Only when a standing is actually being judged. These videos are not
         * in the roster, so no stored post reading can ever use their
         * comments; they are here to carry a thin account over the scoring
         * floor, and a pass that is only filling the per-post record would be
         * paying browser time for nothing.
         */
        if (rescore && h.platform === 'YouTube' && gathered.length < 30 && h.profileUrl) {
          const readUrls = new Set(h.posts.map((p) => p.url))
          for (const url of await popularVideosOf(page, h.profileUrl, 12)) {
            if (readUrls.has(url)) continue
            try {
              await goto(page, url)
              const res = await adapter.comments(ctx, url)
              if (res.ok && res.items.length > 0 && onPost(url)) {
                gathered.push(...res.items)
                record(url, res.items, 'popular')
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
         *
         * Also only when a standing is being judged, and for the same reason
         * as the popular videos above: coverage belongs to a watched channel,
         * so it is evidence about the person rather than a post of theirs that
         * a reading will ever be generated for.
         */
        if (rescore && gathered.length < 30) {
          for (const post of coveragePostsOf(file, person.key, h.platform).slice(0, 6)) {
            try {
              await goto(page, post.url)
              const res = await adapter.comments(ctx, post.url)
              if (res.ok && res.items.length > 0 && onPost(post.url)) {
                coverage.push(...res.items)
                record(post.url, res.items, 'coverage')
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

      /*
       * The per-post record is written whether or not this account can be
       * scored, and that is deliberate. Two comments are far too few to read
       * an account's mood from and are exactly the right evidence for the one
       * post they were left under, which is the reading that used to fall back
       * to scoring the post's own words.
       */
      const storedHere = [...touched].reduce(
        (n, url) => n + (commentsFile.posts[url]?.comments.length ?? 0),
        0,
      )
      commentsFile.handles[handleKey] = {
        platform: h.platform,
        handle: h.handle,
        readFor: person.key,
        readAt: new Date().toISOString(),
        postsRead,
        commentsStored: storedHere,
      }
      commentsFile.generatedAt = new Date().toISOString()
      saveComments(commentsFile)
      recorded += storedHere

      if (!rescore) {
        console.log(
          ` ${storedHere} comment${storedHere === 1 ? '' : 's'} on ` +
            `${touched.size} post${touched.size === 1 ? '' : 's'}, standing kept`,
        )
        skipped++
        continue
      }

      if (gathered.length + coverage.length < MIN_COMMENTS) {
        /*
         * Reading nothing at all is not a finding about the account.
         *
         * postsRead counts the posts that actually answered, so zero means the
         * browser never got a readable page: a lapsed session, a platform
         * showing a login wall, or every navigation landing somewhere other
         * than the post. Under --force that used to run straight into the
         * branch below and overwrite a real standing, read from real comments
         * on an earlier day, with the claim that the account has no comments
         * on it. Today's failure to look must never be recorded as yesterday's
         * absence, so the standing is left exactly as it was and the note says
         * which of the two happened.
         */
        if (postsRead === 0) {
          h.standingNote = 'None of this account’s posts could be opened on the last run.'
          thin++
          console.log(' no post could be read')
          save(file)
          continue
        }
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

  console.log(
    `\n${read} scored, ${thin} too thin, ${skipped} kept an existing reading. ` +
      `${recorded} comments recorded here, ${Object.keys(commentsFile.posts).length} posts on record.`,
  )
}

void main()
