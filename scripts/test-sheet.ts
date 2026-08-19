/**
 * The acceptance test: every link in the client's own workbook.
 *
 * `test-extract.ts` proves each adapter works on a link chosen to exercise it.
 * This proves the product works on the 28 links the client actually has —
 * which is a different and harder question, because their dataset is 16
 * Facebook share-links, a Telugu e-paper and a WhatsApp forward, not a tidy
 * spread across platforms.
 *
 * It also compares what we extract against what the team recorded by hand in
 * columns AD–AG. Those two numbers disagreeing is not a bug: the sheet is a
 * snapshot from November and the post kept moving. Quantifying that drift is
 * the argument for the product, so it is printed rather than hidden.
 *
 *   npx tsx scripts/test-sheet.ts           # all of them
 *   npx tsx scripts/test-sheet.ts --json    # machine-readable, for diffing
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractPost } from '../netlify/functions/lib/extract/index'
import { parseCount } from '../shared/parse'

interface SheetLink {
  row: number
  entryId: string | null
  url: string
  sheetSays: {
    platform: string | null
    handle: string | null
    verified: string | null
    followers: string | null
    postType: string | null
    likes: string | null
    comments: string | null
    shares: string | null
    views: string | null
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const DATA = join(here, 'sheet-links.json')

/**
 * The dataset is deliberately not in the repository.
 *
 * It is derived from the client's workbook, which names real officials and
 * real allegations, so it is git-ignored rather than published. Regenerate it
 * locally from the workbook, or point this at your own list in the same shape.
 */
let LINKS: SheetLink[]
try {
  LINKS = JSON.parse(readFileSync(DATA, 'utf8'))
} catch {
  console.log('\nNo dataset found at scripts/sheet-links.json')
  console.log(
    'This file is git-ignored on purpose: it is derived from the client workbook\n' +
      'and names real officials and real allegations. Generate it locally from the\n' +
      'workbook, or supply your own list of { url, sheetSays } entries in the same\n' +
      'shape.\n',
  )
  process.exit(0)
}

const G = '\x1b[32m'
const R = '\x1b[31m'
const Y = '\x1b[33m'
const D = '\x1b[2m'
const B = '\x1b[1m'
const C = '\x1b[36m'
const O = '\x1b[0m'

/** The fields the sheet has a column for — the bar the product has to clear. */
const FIELDS = ['author', 'followers', 'date', 'text', 'likes', 'comments', 'shares', 'views'] as const
type Field = (typeof FIELDS)[number]

interface Row {
  link: SheetLink
  platform: string
  ms: number
  confidence: string
  got: Record<Field, boolean>
  values: Record<Field, string>
  drift: Partial<Record<Field, { sheet: number; live: number; pct: number }>>
  strategy: string
  blocked: string | null
  error: string | null
}

const jsonMode = process.argv.includes('--json')
const log = (s = '') => {
  if (!jsonMode) console.log(s)
}

async function run(link: SheetLink): Promise<Row> {
  const started = Date.now()
  try {
    const { snapshot } = await extractPost(link.url, {
      keys: {
        youtube: process.env['YOUTUBE_API_KEY'],
        meta: process.env['META_APP_TOKEN'],
      },
    })

    const e = snapshot.engagement
    const text = snapshot.content.text ?? snapshot.content.title ?? ''

    const got: Record<Field, boolean> = {
      author: Boolean(snapshot.author.name),
      followers: snapshot.author.followers.value != null,
      date: Boolean(snapshot.publishedAt),
      text: text.trim().length > 0,
      likes: e.likes.value != null,
      comments: e.comments.value != null,
      shares: e.shares.value != null,
      views: e.views.value != null,
    }

    const values: Record<Field, string> = {
      author: snapshot.author.name ?? '—',
      followers: fmt(snapshot.author.followers.value),
      date: snapshot.publishedAt?.slice(0, 10) ?? '—',
      text: text.trim() ? `${text.trim().replace(/\s+/g, ' ').slice(0, 44)}…` : '—',
      likes: fmt(e.likes.value),
      comments: fmt(e.comments.value),
      shares: fmt(e.shares.value),
      views: fmt(e.views.value),
    }

    // How far the hand-recorded figure has drifted from reality.
    const drift: Row['drift'] = {}
    const pairs: Array<[Field, number | null, string | null]> = [
      ['likes', e.likes.value, link.sheetSays.likes],
      ['comments', e.comments.value, link.sheetSays.comments],
      ['shares', e.shares.value, link.sheetSays.shares],
      ['views', e.views.value, link.sheetSays.views],
      ['followers', snapshot.author.followers.value, link.sheetSays.followers],
    ]
    for (const [field, live, recorded] of pairs) {
      const sheet = parseCount(recorded)
      if (sheet == null || live == null || sheet === 0) continue
      drift[field] = { sheet, live, pct: ((live - sheet) / sheet) * 100 }
    }

    return {
      link,
      platform: snapshot.platform,
      ms: Date.now() - started,
      confidence: snapshot.extraction.confidence,
      got,
      values,
      drift,
      strategy: snapshot.extraction.strategy,
      blocked: snapshot.extraction.blocked?.reason ?? null,
      error: null,
    }
  } catch (err) {
    const blank = Object.fromEntries(FIELDS.map((f) => [f, false])) as Record<Field, boolean>
    return {
      link,
      platform: '?',
      ms: Date.now() - started,
      confidence: 'low',
      got: blank,
      values: Object.fromEntries(FIELDS.map((f) => [f, '—'])) as Record<Field, string>,
      drift: {},
      strategy: 'threw',
      blocked: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-IN'))

// ── Run them in small batches: fully parallel trips Meta's rate limiting and
// turns a coverage test into a throttling test. ──────────────────────────────
const results: Row[] = []
const BATCH = 4
for (let i = 0; i < LINKS.length; i += BATCH) {
  const batch = LINKS.slice(i, i + BATCH)
  if (!jsonMode) process.stdout.write(`${D}  …${i + batch.length}/${LINKS.length}${O}\r`)
  results.push(...(await Promise.all(batch.map(run))))
}

if (jsonMode) {
  console.log(JSON.stringify(results, null, 2))
  process.exit(0)
}

// ── Per-link detail ──────────────────────────────────────────────────────────
log(`\n${B}${'═'.repeat(96)}${O}`)
log(`${B}Every link in Eluru_Social_Listening.xlsx${O}`)
log(`${D}${LINKS.length} links · columns AD–AG are what the team recorded by hand${O}`)
log(`${B}${'═'.repeat(96)}${O}`)

for (const r of results) {
  const mark = r.error ? `${R}THREW${O}` : Object.values(r.got).some(Boolean) ? `${G}OK${O}` : `${R}NOTHING${O}`
  log(`\n${B}row ${r.link.row}${O} ${D}· entry ${r.link.entryId ?? '?'} · ${r.platform} · ${r.ms}ms · ${r.confidence}${O}  ${mark}`)
  log(`${D}${r.link.url.slice(0, 88)}${O}`)

  const cells = FIELDS.map((f) => {
    const ok = r.got[f]
    return `${ok ? G : D}${f}${O}`
  })
  log(`  ${cells.join(' ')}`)
  log(
    `  ${D}author${O} ${r.values.author}  ${D}followers${O} ${r.values.followers}  ${D}date${O} ${r.values.date}`,
  )
  log(
    `  ${D}likes${O} ${r.values.likes}  ${D}comments${O} ${r.values.comments}  ${D}shares${O} ${r.values.shares}  ${D}views${O} ${r.values.views}`,
  )
  if (r.values.text !== '—') log(`  ${D}text${O} ${r.values.text}`)

  const drifts = Object.entries(r.drift)
  if (drifts.length) {
    const parts = drifts.map(([f, d]) => {
      const sign = d.pct >= 0 ? '+' : ''
      const tone = Math.abs(d.pct) >= 20 ? Y : D
      return `${f} ${d.sheet.toLocaleString('en-IN')}→${d.live.toLocaleString('en-IN')} ${tone}${sign}${d.pct.toFixed(0)}%${O}`
    })
    log(`  ${D}vs sheet:${O} ${parts.join('  ')}`)
  }
  if (r.blocked) log(`  ${Y}note${O} ${r.blocked.slice(0, 84)}`)
  if (r.error) log(`  ${R}error${O} ${r.error}`)
}

// ── Coverage matrix ──────────────────────────────────────────────────────────
log(`\n${B}${'═'.repeat(96)}${O}`)
log(`${B}Coverage by platform${O}  ${D}(share of that platform's links where the field came back)${O}`)
log(`${B}${'═'.repeat(96)}${O}\n`)

const groups = new Map<string, Row[]>()
for (const r of results) {
  const key = r.platform
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key)!.push(r)
}

const head = ['platform', ...FIELDS].map((h, i) => (i === 0 ? h.padEnd(12) : h.slice(0, 6).padStart(7)))
log(`  ${D}${head.join('')}${O}   n`)

for (const [platform, rows] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const cells = FIELDS.map((f) => {
    const hits = rows.filter((r) => r.got[f]).length
    const all = hits === rows.length
    const none = hits === 0
    const tone = all ? G : none ? D : Y
    const label = all ? 'all' : none ? '—' : `${hits}/${rows.length}`
    return `${tone}${label.padStart(7)}${O}`
  })
  log(`  ${platform.padEnd(12)}${cells.join('')}   ${D}${rows.length}${O}`)
}

// ── Bottom line ──────────────────────────────────────────────────────────────
const usable = results.filter((r) => r.got.text || r.got.likes || r.got.views)
const withCounts = results.filter((r) => r.got.likes || r.got.comments || r.got.shares || r.got.views)
const fullyBlank = results.filter((r) => !Object.values(r.got).some(Boolean))

log(`\n${B}${'═'.repeat(96)}${O}`)
log(`${B}${usable.length}/${results.length}${O} returned something usable`)
log(`${B}${withCounts.length}/${results.length}${O} returned at least one engagement number`)
if (fullyBlank.length) {
  log(`${R}${fullyBlank.length} returned nothing at all:${O}`)
  for (const r of fullyBlank) log(`  ${D}row ${r.link.row} · ${r.link.url.slice(0, 76)}${O}`)
}

const moved = results.flatMap((r) =>
  Object.entries(r.drift).filter(([, d]) => Math.abs(d.pct) >= 10),
)
if (moved.length) {
  log(
    `\n${Y}${moved.length}${O} recorded figures have drifted 10%+ from the live value ${D}— the reason this product exists${O}`,
  )
}
log('')
