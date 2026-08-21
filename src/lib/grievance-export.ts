import type { FakeSignal, GrievanceRecord } from '@shared/grievance'
import type { ConfidenceTier } from '@shared/taxonomy'
import { buildWorkbook, saveBlob, type CellValue, type Column, type Section } from './xlsx'

/**
 * Grievance export, in the client's own RAW_ENTRIES shape.
 *
 * Forty-nine columns, in their order, under their headings. This is not the
 * app's data model wearing a spreadsheet costume: the office pastes these rows
 * into the workbook they already keep, so a renamed heading or a swapped pair
 * of columns costs them the entire benefit of the export and they go back to
 * typing. The order below is copied from their sheet and should only ever
 * change when their sheet does.
 *
 * Half of those columns come out empty, and that is the honest answer rather
 * than a gap to be filled later. Their sheet was drawn for social posts logged
 * by an associate who had the post open in front of them; a GrievanceRecord is
 * a newspaper story read by a model. Likes, Comments, Shares, Views, Followers,
 * Account Type, Verified and Handle have no source at all on a news article, so
 * they are written empty and never 0 — zero means "measured, and it was none",
 * empty means "does not apply to a newspaper story". Every average and every
 * ranking downstream depends on telling those two apart, so writing a
 * comfortable 0 would be the most expensive kind of wrong.
 *
 * Shape follows src/lib/export.ts: banded sections above the header, typed
 * cells so dates sort as dates, .xlsx as the primary format because on a phone
 * a .csv has no handler and opens as a wall of punctuation, and CSV kept for
 * feeding other tools.
 */

/** Multi-value cells use one separator throughout, so a reader can split on it. */
const JOIN = '; '

// ─────────────────────────────────────────────────────────────────────────────
// The office's clock
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Their sheet keeps Date Observed and Time Observed in separate columns, and
 * the desk reads both in IST.
 *
 * Rendering from the machine's own zone put every story published after 18:30
 * IST on the following day — an evening story about a water cut lands in
 * tomorrow's briefing, after the morning meeting it was needed for. So the
 * split happens in Asia/Kolkata explicitly rather than wherever the browser or
 * the build server happens to be.
 */
const IST_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** Just the IST calendar day, for filenames. en-CA formats it as YYYY-MM-DD. */
const IST_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** A trailing Z or +hh:mm / -hhmm — the timestamp says which zone it is in. */
const HAS_ZONE = /(?:[Zz]|[+-]\d{2}:?\d{2})$/

interface Observed {
  /** Midnight of the IST calendar day, carried in the machine's own zone. */
  date: Date | null
  /** 24-hour HH:mm, or null when the source carried no clock time at all. */
  time: string | null
}

function observedAt(iso: string | null): Observed {
  if (!iso) return { date: null, time: null }
  const raw = iso.trim()

  // Several Telugu dailies stamp a story with a date and no clock time at all.
  const carriesTime = /\d{2}:\d{2}/.test(raw)

  // A timestamp with a time and no zone is parsed in whatever zone the machine
  // is in, which on a build server is UTC — five and a half hours adrift, and a
  // whole day adrift for anything after 18:30. These publishers write in IST,
  // and src/lib/desk-day.ts makes the same assumption: the day a record exports
  // under has to be the day the desk sees it grouped under, or the row that is
  // missing from the sheet is the one on screen.
  const stamped = carriesTime && !HAS_ZONE.test(raw) ? `${raw}+05:30` : raw

  const at = new Date(stamped)
  if (Number.isNaN(at.getTime())) return { date: null, time: null }

  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
  for (const part of IST_PARTS.formatToParts(at)) parts[part.type] = part.value
  const { year, month, day, hour, minute } = parts
  if (!year || !month || !day) return { date: null, time: null }

  // xlsx.ts builds Excel's serial date out of a Date's *local* calendar parts,
  // deliberately, so an 11pm story keeps its own evening. That means the IST
  // wall clock has to travel inside a Date rather than as an offset: rebuilt
  // from these parts, it reads back as the IST day on a machine in any zone.
  const date = new Date(Number(year), Number(month) - 1, Number(day))

  // A date with no clock time left alone exports as 00:00, which is a time
  // nobody observed and which the desk would reasonably read as "published at
  // midnight". It gets no Time Observed at all instead.
  //
  // Some ICU builds render midnight as "24" under hour12: false.
  const hh = hour === '24' ? '00' : hour
  const time = carriesTime && hh && minute ? `${hh}:${minute}` : null

  return { date, time }
}

/** ISO day from a Date's local parts — the Date already carries IST's calendar. */
function isoDay(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

// ─────────────────────────────────────────────────────────────────────────────
// The sheet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ten lettered bands drawn above the headers.
 *
 * Their workbook groups these columns under lettered sections; the letters here
 * are this export's reading of where the groups fall, since the client's file
 * is not in the repository to copy them from. Nothing downstream depends on the
 * letters — the band is row 1, the headers are row 2, and it is the header row
 * and the column order that the office pastes against. What the bands buy is
 * that forty-nine headings in one undifferentiated run stop needing to be
 * counted across on a phone screen.
 */
/**
 * Only the columns a news story can actually fill.
 *
 * The first version carried all 49 of the client's RAW_ENTRIES columns, which
 * meant a dozen were structurally always blank: their sheet was drawn for
 * social posts, and an article has no handle, no follower count, no likes and
 * no shares. A sheet where a quarter of the columns are empty in every row is
 * not faithful to their process, it is just wide — the reader scrolls past
 * blanks looking for the two columns that matter.
 *
 * What is kept: everything the classifier produces, plus the response and
 * quality columns the office fills in by hand. Those are empty today because
 * the work has not been done yet, which is a different thing from a column that
 * can never be filled.
 */
const SECTIONS: Section[] = [
  { title: 'A · ENTRY', span: 4, color: '3D3BD1' },
  { title: 'B · THE SOURCE', span: 4, color: '1D6FA3' },
  { title: 'C · WHAT IT SAYS', span: 6, color: '1F6F5C' },
  { title: 'D · THE ISSUE', span: 5, color: 'B45309' },
  { title: 'E · WORTH CHECKING', span: 3, color: '9F1239' },
  { title: 'F · OFFICIAL RESPONSE', span: 5, color: '0F766E' },
  { title: 'G · WHAT TO DO', span: 5, color: '15803D' },
  { title: 'H · DESK NOTES', span: 2, color: '475569' },
]

/**
 * RAW_ENTRIES, in the client's column order.
 *
 * Headings are their spelling, question marks and slashes included. They look
 * untidy next to the rest of this codebase and they are not ours to tidy: a
 * staffer matching columns by eye is matching on these exact strings.
 */
const COLUMNS: Column[] = [
  // A · ENTRY
  { header: 'Entry ID', width: 16, kind: 'text' },
  { header: 'Date Observed', width: 13, kind: 'date' },
  { header: 'Time Observed', width: 9, kind: 'text' },
  { header: 'Assembly Constituency', width: 20, kind: 'text' },

  // B · THE SOURCE
  { header: 'Publisher', width: 18, kind: 'text' },
  { header: 'Language', width: 11, kind: 'text' },
  { header: 'Headline', width: 52, kind: 'long' },
  { header: 'Link', width: 46, kind: 'text' },

  // C · WHAT IT SAYS
  { header: 'What it says', width: 58, kind: 'long' },
  { header: 'Primary Topic', width: 20, kind: 'text' },
  { header: 'Subtopic', width: 20, kind: 'text' },
  { header: 'Target', width: 18, kind: 'text' },
  { header: 'Named Persons Mentioned', width: 32, kind: 'long' },
  { header: 'Places Named', width: 26, kind: 'text' },

  // D · THE ISSUE
  { header: 'Is Grievance?', width: 12, kind: 'text' },
  { header: 'Grievance Type', width: 18, kind: 'text' },
  { header: 'Severity', width: 11, kind: 'text' },
  { header: 'Sentiment', width: 14, kind: 'text' },
  { header: 'Hashtags', width: 24, kind: 'text' },

  // E · WORTH CHECKING
  { header: 'Suspected Fake/False?', width: 15, kind: 'text' },
  { header: 'Type of Fake News', width: 22, kind: 'text' },
  { header: 'Debunk Status', width: 16, kind: 'text' },

  // F · OFFICIAL RESPONSE
  { header: 'Govt Response?', width: 13, kind: 'text' },
  { header: 'Respondent', width: 20, kind: 'text' },
  { header: 'Response Adequacy', width: 16, kind: 'text' },
  { header: 'Response Date', width: 13, kind: 'date' },
  { header: 'Response Content Link', width: 30, kind: 'text' },

  // G · WHAT TO DO
  { header: 'Narrative Category', width: 20, kind: 'text' },
  { header: 'Suggested Action', width: 28, kind: 'text' },
  { header: 'Action Priority', width: 13, kind: 'text' },
  { header: 'Recommended Talking Points', width: 58, kind: 'long' },
  { header: 'Suggested Communication Channel', width: 22, kind: 'text' },

  // H · DESK NOTES
  { header: 'Internal Notes', width: 58, kind: 'long' },
  { header: 'Quality Check Flag', width: 14, kind: 'text' },
]

/**
 * Everything the office would otherwise lose.
 *
 * Their sheet has no column for the link, the publisher or the language,
 * because it was drawn for posts the associate already had open in a tab. A row
 * nobody can trace back to the story it came from is not evidence, and the
 * first question anyone asks about a Critical row is where it came from — so
 * those go here, labelled, rather than nowhere.
 *
 * The recommendation's rationale lands here too. It is the reason for the
 * suggested action, while their Rationale column sits inside the sentiment band
 * and means the reason for the reading. Filing one under the other would put an
 * answer beside the wrong question.
 */
function internalNotes(r: GrievanceRecord): string {
  const lines: string[] = []
  const source = [r.publisher, r.sourceUrl].filter(Boolean).join(' · ')
  if (source) lines.push(`Source: ${source}`)
  if (r.language) lines.push(`Language: ${r.language}`)
  if (r.places.length) lines.push(`Places named: ${r.places.join(JOIN)}`)
  if (r.recommendation.rationale) lines.push(`Why this action: ${r.recommendation.rationale}`)
  if (r.fake.note) lines.push(`Fake check: ${r.fake.note}`)
  if (r.fake.type) lines.push(`Suspected type: ${r.fake.type}`)
  // The CSV has nowhere to put the signals themselves, so at minimum it says
  // how many there were and that somebody should go and read them.
  if (r.fake.signals.length) lines.push(`Fake-check signals recorded: ${r.fake.signals.length}`)
  return lines.join('\n')
}

function grievanceCells(r: GrievanceRecord): CellValue[] {
  const observed = observedAt(r.publishedAt)
  const rec = r.recommendation

  // The role is what makes a name useful — "Ramesh" is noise, "Ramesh
  // (Tahsildar)" is who to call.
  const persons = r.namedPersons
    .map((p) => (p.role ? `${p.name} (${p.role})` : p.name))
    .filter(Boolean)
    .join(JOIN)

  return [
    // A · ENTRY
    r.id,
    // Empty rather than falling back to createdAt when the story carried no
    // date. createdAt is when we filed it, and a desk sorting by Date Observed
    // would read that as when it was published.
    observed.date,
    observed.time,
    r.constituency ?? '',

    // B · THE SOURCE
    // Their sheet had no column for any of this, because it was drawn for posts
    // the associate already had open in a tab. A row nobody can trace back to
    // the story it came from is not evidence, and the first question anyone
    // asks about a Critical row is where it came from.
    r.publisher ?? '',
    r.language ?? '',
    r.headline,
    r.sourceUrl,

    // C · WHAT IT SAYS
    r.summary,
    r.topic,
    r.subtopic ?? '',
    r.target,
    persons,
    r.places.join(JOIN),

    // D · THE ISSUE
    r.isGrievance ? 'Yes' : 'No',
    r.grievanceType,
    r.severity,
    r.sentiment,
    r.hashtags.join(JOIN),

    // E · WORTH CHECKING
    r.fake.suspicion,
    r.fake.type ?? '',
    r.fake.debunkStatus,

    // F · OFFICIAL RESPONSE
    // Empty because the work has not been done, not because it cannot be. This
    // band is the office's to fill, and it is the half their workbook was built
    // around — dropping it would remove the follow-up, not tidy the sheet.
    '', // Govt Response?
    '', // Respondent
    '', // Response Adequacy
    null, // Response Date
    '', // Response Content Link

    // G · WHAT TO DO
    r.narrativeCategory ?? '',
    rec.action,
    rec.priority,
    rec.talkingPoints.join('\n'),
    rec.channel,

    // H · DESK NOTES
    [
      rec.rationale ? `Why this action: ${rec.rationale}` : '',
      r.fake.note ? `Fake check: ${r.fake.note}` : '',
      r.fake.signals.length
        ? `Fake-check signals recorded: ${r.fake.signals.length} (see the Evidence sheet)`
        : '',
      r.excerpt ? `Opening of the article: ${r.excerpt.slice(0, 300)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    // Quality Check Flag stays empty on purpose: it records that a person
    // checked the row, and at the moment of export no person has.
    '',
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// The evidence sheet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Signals, one per row, on a sheet of their own.
 *
 * The assessment deliberately stops short of a verdict, which makes the signals
 * the actual product: a reviewer decides "is this fabricated" by reading them.
 * Five of them crammed into one cell of a forty-nine column sheet is a cell
 * nobody opens, and it cannot be filtered down to everything pointing at
 * fabricated — which is the one question this data exists to answer.
 *
 * Written as Records rather than inline strings so that renaming a signal kind
 * in shared/grievance.ts breaks the build here instead of quietly exporting an
 * undefined.
 */
const SIGNAL_KIND: Record<FakeSignal['kind'], string> = {
  provenance: 'Provenance',
  recirculation: 'Recirculated',
  source: 'Source',
  consistency: 'Internal consistency',
  corroboration: 'Corroboration',
}

const SIGNAL_SUPPORTS: Record<FakeSignal['supports'], string> = {
  authentic: 'Authentic',
  fabricated: 'Fabricated',
  inconclusive: 'Inconclusive',
}

const SIGNAL_CONFIDENCE: Record<ConfidenceTier, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const SIGNAL_COLUMNS: Column[] = [
  { header: 'Entry ID', width: 16, kind: 'text' },
  // The headline is carried across so the sheet can be read on its own.
  // Scrolling back to RAW_ENTRIES to find out which story an id belongs to is
  // how a reviewer stops reading the evidence.
  { header: 'Headline', width: 44, kind: 'long' },
  { header: 'Signal', width: 20, kind: 'text' },
  { header: 'Finding', width: 70, kind: 'long' },
  { header: 'Confidence', width: 12, kind: 'text' },
  { header: 'Points To', width: 14, kind: 'text' },
]

function signalRows(records: GrievanceRecord[]): CellValue[][] {
  const rows: CellValue[][] = []
  for (const r of records) {
    for (const s of r.fake.signals) {
      rows.push([
        r.id,
        r.headline,
        SIGNAL_KIND[s.kind],
        s.finding,
        SIGNAL_CONFIDENCE[s.confidence],
        SIGNAL_SUPPORTS[s.supports],
      ])
    }
  }
  return rows
}

// ─────────────────────────────────────────────────────────────────────────────
// Files
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A filename that sorts chronologically and says what it holds.
 *
 * Dated in IST rather than from toISOString: a file exported at half past
 * midnight in Eluru would otherwise carry yesterday's date, and these get
 * mailed around as "the 18th's list".
 */
function baseName(label?: string): string {
  const stamp = IST_DAY.format(new Date())
  const slug = (label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 24)
    .replace(/^-|-$/g, '')
  return slug ? `signal-grievances-${slug}-${stamp}` : `signal-grievances-${stamp}`
}

/** The workbook itself, separated from the download so tests can read it back. */
export function buildGrievanceWorkbook(records: GrievanceRecord[]): Promise<Blob> {
  const signals = signalRows(records)
  return buildWorkbook([
    // Named for the sheet it is meant to be pasted into.
    { name: 'RAW_ENTRIES', columns: COLUMNS, rows: records.map(grievanceCells), sections: SECTIONS },
    // Omitted entirely when nothing was assessed. An empty sheet reads as "we
    // looked and found nothing suspicious", which is a different claim from "no
    // fake check ran". Not called FAKE_NEWS: that is a sheet in their workbook
    // with its own columns, and this is not it.
    ...(signals.length
      ? [{ name: 'FAKE_CHECK_SIGNALS', columns: SIGNAL_COLUMNS, rows: signals }]
      : []),
  ])
}

/** The primary export: a real spreadsheet, openable on a phone. */
export async function downloadGrievanceWorkbook(
  records: GrievanceRecord[],
  label?: string,
): Promise<void> {
  saveBlob(await buildGrievanceWorkbook(records), `${baseName(label)}.xlsx`)
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV — kept for feeding other tools, which is the one thing it is better at
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RFC 4180: quote anything containing a delimiter, quote or newline.
 *
 * A near-copy of the one in export.ts rather than a shared helper, because that
 * one is private to its module and this file owns no other file. The two have
 * to stay in step.
 */
function csvCell(value: CellValue): string {
  let s: string
  if (value == null) {
    s = ''
  } else if (value instanceof Date) {
    // ISO, not a locale format. Date Observed has a time column of its own
    // beside it, so printing 00:00:00 would be noise — and dd/mm/yyyy reads as
    // a US date or as plain text depending on which machine opens the file.
    s = Number.isNaN(value.getTime()) ? '' : isoDay(value)
  } else {
    s = String(value)
  }

  // A leading =, +, - or @ makes Excel and Sheets evaluate the cell as a
  // formula, and a headline routinely starts with a dash. Prefixing an
  // apostrophe neutralises that; numbers are exempt, because escaping them
  // turns a numeric column into text and breaks every sort built on it.
  const isNumber = s !== '' && Number.isFinite(Number(s))
  if (!isNumber && /^[=+\-@\t\r]/.test(s)) s = `'${s}`

  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * The sheet as text. CRLF throughout, which is what RFC 4180 asks for and what
 * Excel's importer is least surprised by.
 *
 * No byte-order mark here — that belongs to the file, and downloadGrievanceCsv
 * adds it. A mark returned in the string ends up in the middle of the output
 * the moment a caller concatenates two exports.
 */
export function grievancesToCsv(records: GrievanceRecord[]): string {
  const header = COLUMNS.map((c) => csvCell(c.header)).join(',')
  const rows = records.map((r) => grievanceCells(r).map(csvCell).join(','))
  return [header, ...rows].join('\r\n')
}

/**
 * The BOM is load-bearing. Excel on Windows reads BOM-less UTF-8 as the system
 * codepage, so without it every Telugu row opens as mojibake.
 */
export function downloadGrievanceCsv(records: GrievanceRecord[], label?: string): void {
  const blob = new Blob(['﻿' + grievancesToCsv(records)], {
    type: 'text/csv;charset=utf-8;',
  })
  saveBlob(blob, `${baseName(label)}.csv`)
}
