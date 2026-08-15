import type { Report } from '@shared/types'
import { buildWorkbook, saveBlob, type CellValue, type Column, type Section } from './xlsx'

/**
 * Export, in the shape of the workbook this product replaces.
 *
 * The column order follows RAW_ENTRIES, so a staffer can paste a row straight
 * into the sheet they already keep rather than re-mapping fields by hand. That
 * is the whole point: this does not export "the app's data model", it exports
 * the thing their process already expects.
 *
 * The primary format is .xlsx rather than .csv, and that is a usability
 * decision, not a preference. On Android a .csv has no registered handler and
 * opens in a text viewer — 62 comma-separated columns as a wall of punctuation.
 * A .xlsx opens on tap in Sheets, Excel or WPS. This audience works from a
 * phone, so the file has to be openable on one. CSV stays available for feeding
 * other tools.
 *
 * Cells are typed rather than stringified: counts are numbers and dates are
 * dates, so sorting by engagement or filtering by week works in the sheet
 * instead of sorting "1000" before "9".
 */


/**
 * The sheet, in seven groups.
 *
 * Grouped rather than listed because fifty columns in one undifferentiated run
 * is what the workbook this replaces already looked like, and reading it meant
 * counting across. The bands say where you are: who posted, what they said, how
 * it landed, how far it went, what the issue is, what to do, what to check.
 *
 * Deliberately absent: the model that wrote the analysis, the extraction route,
 * and the per-metric source columns. That is plumbing — how the data got here,
 * not what it says — and it belongs in the app, not in the working document
 * someone reads in a meeting.
 */
const SECTIONS: Section[] = [
  { title: 'THE POST', span: 8, color: '3D3BD1' },
  { title: 'WHAT IT SAYS', span: 8, color: '1F6F5C' },
  { title: 'HOW IT LANDED', span: 7, color: 'A33A5B' },
  { title: 'HOW FAR IT WENT', span: 8, color: '1D6FA3' },
  { title: 'THE ISSUE', span: 8, color: 'B45309' },
  { title: 'WHAT TO DO', span: 7, color: '15803D' },
  { title: 'WORTH CHECKING', span: 4, color: '475569' },
]

const COLUMNS: Column[] = [
  // THE POST
  { header: 'Date', width: 13, kind: 'date' },
  { header: 'Time', width: 8, kind: 'text' },
  { header: 'Platform', width: 12, kind: 'text' },
  { header: 'Post Type', width: 14, kind: 'text' },
  { header: 'Author', width: 22, kind: 'text' },
  { header: 'Handle', width: 18, kind: 'text' },
  { header: 'Followers', width: 11, kind: 'int' },
  { header: 'Link', width: 38, kind: 'text' },

  // WHAT IT SAYS
  { header: 'Post Text', width: 58, kind: 'long' },
  { header: 'Language', width: 12, kind: 'text' },
  { header: 'English Translation', width: 58, kind: 'long' },
  { header: 'Headline', width: 38, kind: 'long' },
  { header: 'Summary', width: 58, kind: 'long' },
  { header: 'Intent', width: 16, kind: 'text' },
  { header: 'Key Points', width: 48, kind: 'long' },
  { header: 'Notable Quotes', width: 48, kind: 'long' },

  // HOW IT LANDED
  { header: 'Sentiment', width: 13, kind: 'text' },
  { header: 'Score', width: 8, kind: 'number' },
  { header: 'Tone', width: 14, kind: 'text' },
  { header: 'Public Narrative', width: 16, kind: 'text' },
  { header: 'Main Emotion', width: 14, kind: 'text' },
  { header: 'Emotion Mix', width: 32, kind: 'text' },
  { header: 'Why This Reading', width: 48, kind: 'long' },

  // HOW FAR IT WENT
  { header: 'Likes', width: 10, kind: 'int' },
  { header: 'Comments', width: 11, kind: 'int' },
  { header: 'Shares', width: 10, kind: 'int' },
  { header: 'Views', width: 12, kind: 'int' },
  { header: 'Engagement %', width: 13, kind: 'number' },
  { header: 'Estimated Reach', width: 16, kind: 'text' },
  { header: 'Urban / Rural', width: 13, kind: 'text' },
  // Distinct from the Comments count: how many we actually read and analysed.
  { header: 'Comments Read', width: 14, kind: 'int' },

  // THE ISSUE
  { header: 'Is Grievance', width: 12, kind: 'text' },
  { header: 'Grievance Type', width: 18, kind: 'text' },
  { header: 'Issue', width: 48, kind: 'long' },
  { header: 'Directed At', width: 22, kind: 'text' },
  { header: 'Severity', width: 11, kind: 'text' },
  { header: 'Risk', width: 11, kind: 'text' },
  { header: 'Why This Risk', width: 48, kind: 'long' },
  { header: 'Theme', width: 20, kind: 'text' },

  // WHAT TO DO
  { header: 'Priority', width: 11, kind: 'text' },
  { header: 'Recommended Action', width: 48, kind: 'long' },
  { header: 'Action Type', width: 18, kind: 'text' },
  { header: 'Talking Points', width: 48, kind: 'long' },
  { header: 'Channels', width: 24, kind: 'text' },
  { header: 'Counter-Narrative', width: 48, kind: 'long' },
  { header: 'Official Response', width: 15, kind: 'text' },

  // WORTH CHECKING
  { header: 'Suspected False', width: 14, kind: 'text' },
  { header: 'Credibility Notes', width: 38, kind: 'long' },
  { header: 'Also Worth Knowing', width: 48, kind: 'long' },
  { header: 'Topic', width: 20, kind: 'text' },
]

function reportCells(r: Report): CellValue[] {
  const s = r.snapshot
  const a = r.analysis
  const c = a?.civic ?? null
  const e = s.engagement
  const when = s.publishedAt ? new Date(s.publishedAt) : null
  const valid = when && !Number.isNaN(when.getTime()) ? when : null

  const list = (items: string[]): string => items.map((t, i) => `${i + 1}. ${t}`).join('\n')

  return [
    // THE POST
    valid,
    valid ? valid.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '',
    s.platform,
    s.postType,
    // The verified tick belongs on the name, not in a column of its own.
    (s.author.name ?? '') + (s.author.verified ? ' \u2713' : ''),
    s.author.handle ?? '',
    s.author.followers.value,
    s.canonicalUrl,

    // WHAT IT SAYS
    s.content.text ?? '',
    s.content.languageName ?? s.content.languageCode ?? '',
    s.content.translation ?? '',
    a?.headline ?? '',
    a?.summary ?? '',
    a?.intent ?? '',
    list(a?.keyPoints ?? []),
    (a?.notableQuotes ?? [])
      .map((q) => (q.translation ? `\u201c${q.original}\u201d \u2014 ${q.translation}` : `\u201c${q.original}\u201d`))
      .join('\n'),

    // HOW IT LANDED
    a?.sentiment.label ?? '',
    a?.sentiment.score ?? null,
    a?.sentiment.tone ?? '',
    a?.sentiment.publicNarrative ?? '',
    a?.emotions[0]?.emotion ?? '',
    (a?.emotions ?? []).map((x) => `${x.emotion} ${x.weight}%`).join(', '),
    a?.sentiment.rationale ?? '',

    // HOW FAR IT WENT
    e.likes.value,
    e.comments.value,
    e.shares.value,
    e.views.value,
    e.engagementRate != null ? Number((e.engagementRate * 100).toFixed(2)) : null,
    a?.reach.scope ?? '',
    a?.reach.urbanRural ?? '',
    s.comments?.length ?? null,

    // THE ISSUE
    c ? (c.isGrievance ? 'Yes' : 'No') : '',
    c?.grievanceType ?? '',
    c?.issueDescription ?? '',
    c?.target ?? '',
    c?.severity ?? '',
    c?.riskToGovernment ?? '',
    c?.riskRationale ?? '',
    c?.narrativeCategory ?? '',

    // WHAT TO DO
    c?.priorityTag ?? c?.actionPriority ?? '',
    c?.suggestedAction ?? '',
    c?.actionCategory ?? '',
    list(c?.talkingPoints ?? []),
    (c?.suggestedChannels ?? []).join(', '),
    c?.counterNarrative ?? '',
    c?.governmentResponse.status ?? '',

    // WORTH CHECKING
    a?.credibility.suspectedFalse ?? '',
    (a?.credibility.signals ?? []).join('\n'),
    list(a?.observations ?? []),
    [a?.topics.primary, ...(a?.topics.secondary ?? [])].filter(Boolean).join(' \u00b7 '),
  ]
}

/** A filename that sorts chronologically and says what it holds. */
function baseName(reports: Report[]): string {
  const stamp = new Date().toISOString().slice(0, 10)
  const first = reports[0]
  if (reports.length === 1 && first) {
    const platform = first.snapshot.platform.toLowerCase().replace(/[^a-z]/g, '')
    const who = (first.snapshot.author.handle ?? first.snapshot.author.name ?? 'post')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 24)
      .replace(/^-|-$/g, '')
    return `signal-${platform}-${who || 'post'}-${stamp}`
  }
  return `signal-${reports.length}-posts-${stamp}`
}

/**
 * One row per comment, on its own sheet.
 *
 * Not a "Top Comments" cell on the post row: a hundred comments in one cell is
 * unreadable and unsortable, and the entire reason to have them is to sort by
 * likes, filter to a platform and read what people actually said. As rows they
 * are data; as a blob of text they are decoration.
 */
const COMMENT_COLUMNS: Column[] = [
  { header: 'Date', width: 13, kind: 'date' },
  { header: 'Platform', width: 12, kind: 'text' },
  { header: 'Post By', width: 20, kind: 'text' },
  { header: 'Post', width: 40, kind: 'long' },
  { header: 'Commenter', width: 20, kind: 'text' },
  { header: 'Likes', width: 9, kind: 'int' },
  { header: 'Reply', width: 8, kind: 'text' },
  { header: 'Comment', width: 80, kind: 'long' },
]

function commentRows(reports: Report[]): CellValue[][] {
  const rows: CellValue[][] = []
  for (const r of reports) {
    const s = r.snapshot
    if (!s.comments?.length) continue
    const when = s.publishedAt ? new Date(s.publishedAt) : null
    const valid = when && !Number.isNaN(when.getTime()) ? when : null
    // Most-liked first, matching the order the analysis actually weighed them in.
    const ranked = [...s.comments].sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
    for (const c of ranked) {
      rows.push([
        valid,
        s.platform,
        s.author.handle ?? s.author.name ?? '',
        s.canonicalUrl,
        c.author ?? '',
        c.likes,
        c.isReply ? 'Yes' : '',
        c.text,
      ])
    }
  }
  return rows
}

/** The workbook itself, separated from the download so tests can read it back. */
export function buildReportWorkbook(reports: Report[]): Promise<Blob> {
  const comments = commentRows(reports)
  return buildWorkbook([
    { name: 'Posts', columns: COLUMNS, rows: reports.map(reportCells), sections: SECTIONS },
    // Omitted entirely when nothing was retrieved — an empty sheet reads as
    // "this post had no comments", which is a different claim.
    ...(comments.length
      ? [{ name: 'Comments', columns: COMMENT_COLUMNS, rows: comments }]
      : []),
  ])
}

/** The primary export: a real spreadsheet, openable on a phone. */
export async function downloadWorkbook(reports: Report[]): Promise<void> {
  saveBlob(await buildReportWorkbook(reports), `${baseName(reports)}.xlsx`)
}

/** Column headers, in sheet order — used by the export test. */
export const EXPORT_COLUMNS = COLUMNS

// ─────────────────────────────────────────────────────────────────────────────
// CSV — kept for feeding other tools, which is the one thing it is better at
// ─────────────────────────────────────────────────────────────────────────────

/** RFC 4180: quote anything containing a delimiter, quote or newline. */
function csvCell(value: CellValue): string {
  if (value == null) return ''
  let s =
    value instanceof Date
      ? Number.isNaN(value.getTime())
        ? ''
        : value.toLocaleString('en-GB')
      : String(value)

  // A leading =, +, - or @ makes Excel and Sheets evaluate the cell as a
  // formula, and post text routinely starts with one. Prefixing an apostrophe
  // neutralises that.
  //
  // But a negative number is not a formula. Sentiment scores run to -100, and
  // escaping them turned the column into text — which silently breaks sorting,
  // filtering and every chart built on it. So numbers are exempt.
  const isNumber = s !== '' && Number.isFinite(Number(s))
  if (!isNumber && /^[=+\-@\t\r]/.test(s)) s = `'${s}`

  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function reportsToCsv(reports: Report[]): string {
  const header = COLUMNS.map((c) => csvCell(c.header)).join(',')
  const rows = reports.map((r) => reportCells(r).map(csvCell).join(','))
  return [header, ...rows].join('\r\n')
}

/**
 * The BOM is load-bearing. Excel on Windows reads BOM-less UTF-8 as the system
 * codepage, so without it every Telugu row opens as mojibake.
 */
export function downloadCsv(reports: Report[]): void {
  const blob = new Blob(['﻿' + reportsToCsv(reports)], { type: 'text/csv;charset=utf-8;' })
  saveBlob(blob, `${baseName(reports)}.csv`)
}
