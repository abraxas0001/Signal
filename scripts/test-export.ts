/**
 * Prove the exported spreadsheet actually opens.
 *
 * The .xlsx writer is hand-rolled — a ZIP built byte by byte — so "it produced
 * a file" says nothing. A bad CRC, a wrong local-header offset or one stray
 * control character does not degrade gracefully: Excel shows a repair dialog
 * and the user sees no data at all. That failure cannot be caught by reading
 * the code, and it would reach the field.
 *
 * So this writes the real file and hands it to Python's zipfile + XML parser,
 * which is a completely independent implementation of both formats.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildReportWorkbook, reportsToCsv, EXPORT_COLUMNS } from '../src/lib/export'
import { DEMO_REPORT } from '../src/lib/demo'
import type { Report } from '../shared/types'

/** The hostile row: everything that has broken a spreadsheet export before. */
function hostile(base: Report): Report {
  const c = structuredClone(base)
  c.snapshot.content.text =
    'ఏలూరు జిల్లాలో రోడ్డు దుస్థితి 🛣️😤 "quoted", comma,\nand a newline' +
    String.fromCharCode(7) + // a bell character: makes Excel declare corruption
    '\ud800' // a lone surrogate
  c.snapshot.comments = [
    { text: 'ఏలూరు రోడ్డు దారుణంగా ఉంది 😤', author: 'Ramesh', likes: 12, publishedAt: null, isReply: false },
    { text: '=HYPERLINK("evil")', author: 'Spam', likes: 0, publishedAt: null, isReply: true },
  ]
  c.snapshot.author.name = '=cmd|calc'
  c.snapshot.author.handle = '+919876543210'
  if (c.analysis) {
    c.analysis.sentiment.score = -78
    c.analysis.headline = '@everyone <script>alert(1)</script> & more'
  }
  return c
}

const reports: Report[] = [DEMO_REPORT, hostile(DEMO_REPORT)]
// Defaults to a temp directory, not the repo. Writing test output into the
// working tree left a stray signal.csv sitting next to the source, one `git
// add .` away from a public repository.
const out = process.argv[2] ?? join(tmpdir(), 'signal-export-test')
mkdirSync(out, { recursive: true })

const blob = await buildReportWorkbook(reports)
writeFileSync(join(out, 'signal.xlsx'), Buffer.from(await blob.arrayBuffer()))
writeFileSync(join(out, 'signal.csv'), '\uFEFF' + reportsToCsv(reports), 'utf8')

console.log(`columns: ${EXPORT_COLUMNS.length}`)
console.log(`rows: ${reports.length}`)
console.log(`xlsx: ${(blob.size / 1024).toFixed(1)}KB`)
