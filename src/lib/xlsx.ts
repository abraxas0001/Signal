/**
 * A minimal .xlsx writer — ZIP container and all — with no dependencies.
 *
 * Why not CSV: on a phone, a .csv has no registered handler. Android opens it
 * in a text viewer, so 62 comma-separated columns arrive as a wall of
 * punctuation. A .xlsx opens on tap in Google Sheets, Excel or WPS, which is
 * the difference between "I can read this in the field" and "I'll look at it
 * when I'm back at a desk". This audience is on a phone.
 *
 * Why not a library: SheetJS and ExcelJS are 400KB+ of parser we would never
 * use, on a product budgeted for a mid-range Android on 4G. Writing is a small
 * fraction of the format — six XML parts in a ZIP — so we write those six.
 *
 * Scope is deliberately narrow: one flat sheet per table, inline strings, and
 * the handful of styles that make a sheet usable (frozen header, filters,
 * widths, wrapped text, real dates). No formulas, no charts, no shared strings.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ZIP
// ─────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

/**
 * Deflate via the platform, falling back to stored (uncompressed) entries.
 *
 * ZIP method 8 wants a raw deflate stream, which is exactly what
 * CompressionStream('deflate-raw') produces. Where it is missing we store
 * instead — a larger file, but a completely valid one, which matters more than
 * bytes on a report that is a few hundred kilobytes either way.
 */
async function deflateRaw(bytes: Uint8Array): Promise<{ data: Uint8Array; method: number }> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream
  if (!CS) return { data: bytes, method: 0 }
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CS('deflate-raw'))
    const packed = new Uint8Array(await new Response(stream).arrayBuffer())
    // Storing is cheaper than a deflate that grew the input (tiny parts do).
    return packed.length < bytes.length ? { data: packed, method: 8 } : { data: bytes, method: 0 }
  } catch {
    return { data: bytes, method: 0 }
  }
}

interface ZipEntry {
  name: string
  bytes: Uint8Array
}

/** DOS timestamp — second resolution, which is all the format carries. */
function dosStamp(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    // DOS years count from 1980 and the format cannot represent anything before.
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

async function zip(entries: ZipEntry[]): Promise<Blob> {
  const { time, date } = dosStamp(new Date())
  const encoder = new TextEncoder()

  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const { data, method } = await deflateRaw(entry.bytes)
    const crc = crc32(entry.bytes)

    const local = new DataView(new ArrayBuffer(30 + name.length))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true) // version needed
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(8, method, true)
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, entry.bytes.length, true)
    local.setUint16(26, name.length, true)
    const localBytes = new Uint8Array(local.buffer)
    localBytes.set(name, 30)

    const central = new DataView(new ArrayBuffer(46 + name.length))
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true) // version made by
    central.setUint16(6, 20, true) // version needed
    central.setUint16(8, 0x0800, true)
    central.setUint16(10, method, true)
    central.setUint16(12, time, true)
    central.setUint16(14, date, true)
    central.setUint32(16, crc, true)
    central.setUint32(20, data.length, true)
    central.setUint32(24, entry.bytes.length, true)
    central.setUint16(28, name.length, true)
    central.setUint32(42, offset, true)
    const centralBytes = new Uint8Array(central.buffer)
    centralBytes.set(name, 46)

    locals.push(localBytes, data)
    centrals.push(centralBytes)
    offset += localBytes.length + data.length
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)

  return new Blob([...locals, ...centrals, new Uint8Array(end.buffer)] as BlobPart[], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// XML
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape for XML text, dropping anything the format cannot carry.
 *
 * Both filters are load-bearing rather than defensive. Scraped post text
 * regularly contains C0 control characters, and a single one makes Excel
 * declare the whole workbook corrupt and refuse to open it — the user sees a
 * repair dialog, not a spreadsheet. Lone surrogates do the same.
 *
 * Done as one charCode scan rather than a regex on purpose: writing the control
 * range as a character class means putting those characters into the source,
 * which is exactly the hazard being guarded against.
 */
function xmlText(input: string): string {
  let out = ''
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)

    // XML 1.0 permits only tab, newline and carriage return below 0x20. A
    // single stray control character makes Excel declare the whole workbook
    // corrupt and offer to repair it, so the user never sees the data at all.
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) continue
    if (c === 0x7f) continue

    // Lone surrogates are equally fatal, and truncating a long caption between
    // the halves of an emoji is an ordinary way to produce one.
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = input.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i]! + input[i + 1]!
        i++
      }
      continue
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue

    const ch = input[i]!
    out += ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch
  }
  return out
}

/** A1-style column name: 1 → A, 27 → AA. */
function colName(index: number): string {
  let n = index
  let name = ''
  while (n > 0) {
    const r = (n - 1) % 26
    name = String.fromCharCode(65 + r) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

/**
 * Excel's serial date: days since 1899-12-30, in the reader's own frame.
 *
 * Built from local calendar parts on purpose. A post published at 11pm IST
 * must show as that evening's date in an Eluru office; converting through UTC
 * would file it under the following day.
 */
function serialDate(d: Date): number {
  const local = Date.UTC(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  )
  return (local - Date.UTC(1899, 11, 30)) / 86_400_000
}

/** Excel refuses a cell longer than this, so cut and say that we cut. */
const MAX_CELL = 32_767

// ─────────────────────────────────────────────────────────────────────────────
// Sheet building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `int` carries thousand separators and `number` two decimals — the difference
 * between reading "13,223" and "13223" at a glance.
 */
export type CellKind = 'text' | 'long' | 'number' | 'int' | 'date' | 'datetime'

const KINDS: CellKind[] = ['text', 'long', 'number', 'int', 'date', 'datetime']

/** A titled band spanning `span` columns, drawn above the header row. */
export interface Section {
  title: string
  span: number
  /** Hex without alpha, e.g. '3D3BD1'. White text is drawn on it. */
  color: string
}

export interface Column {
  header: string
  /** Width in characters, as Excel counts them. */
  width: number
  kind: CellKind
}

export type CellValue = string | number | Date | null | undefined

export interface Sheet {
  name: string
  columns: Column[]
  rows: CellValue[][]
  /** Grouping bands above the headers. Spans must sum to columns.length. */
  sections?: Section[]
  /** Freeze the header row and add filter dropdowns. Default true. */
  freeze?: boolean
  /** Shade alternate rows. Default true. */
  zebra?: boolean
}

/** Style indices, matching the cellXfs order in STYLES below. */
function cellXml(ref: string, value: CellValue, kind: CellKind, style: number): string {
  if (value == null || value === '') return ''

  if (kind === 'date' || kind === 'datetime') {
    const d = value instanceof Date ? value : new Date(String(value))
    if (Number.isNaN(d.getTime())) return ''
    return `<c r="${ref}" s="${style}"><v>${serialDate(d)}</v></c>`
  }

  if (kind === 'number' || kind === 'int') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''))
    // A value that will not parse is still worth showing as the text it is,
    // rather than as an empty cell that reads as "not published".
    if (!Number.isFinite(n)) {
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(String(value))}</t></is></c>`
    }
    return `<c r="${ref}" s="${style}"><v>${n}</v></c>`
  }

  let s = String(value)
  if (s.length > MAX_CELL) s = `${s.slice(0, MAX_CELL - 1)}\u2026`
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(s)}</t></is></c>`
}

function sheetXml(sheet: Sheet, styles: StyleBook): string {
  const { columns, rows, sections } = sheet
  const lastCol = colName(columns.length)
  const freeze = sheet.freeze !== false
  const zebra = sheet.zebra !== false

  const headerRow = sections?.length ? 2 : 1
  const firstDataRow = headerRow + 1

  const cols = columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`)
    .join('')

  let bandXml = ''
  const merges: string[] = []
  if (sections?.length) {
    let at = 1
    const cells: string[] = []
    sections.forEach((section, i) => {
      const from = at
      const to = at + section.span - 1
      cells.push(cellXml(`${colName(from)}1`, section.title, 'text', styles.sectionXf(i)))
      // Every covered cell has to be present and styled, or the fill stops
      // after the first column instead of running the width of the merge.
      for (let c = from + 1; c <= to; c++) {
        cells.push(cellXml(`${colName(c)}1`, ' ', 'text', styles.sectionXf(i)))
      }
      if (to > from) merges.push(`<mergeCell ref="${colName(from)}1:${colName(to)}1"/>`)
      at = to + 1
    })
    bandXml = `<row r="1" ht="24" customHeight="1">${cells.join('')}</row>`
  }

  const header = `<row r="${headerRow}" ht="34" customHeight="1">${columns
    .map((c, i) => cellXml(`${colName(i + 1)}${headerRow}`, c.header, 'text', styles.headerXf))
    .join('')}</row>`

  const body = rows
    .map((row, r) => {
      const n = firstDataRow + r
      const striped = zebra && r % 2 === 1
      const cells = columns
        .map((c, i) => cellXml(`${colName(i + 1)}${n}`, row[i], c.kind, styles.xf(c.kind, striped)))
        .join('')
      return `<row r="${n}">${cells}</row>`
    })
    .join('')

  // Freezing the first two columns as well as the header is what makes a wide
  // sheet navigable: the date and platform stay put while the rest scrolls.
  const frozenCols = freeze && columns.length > 8 ? 2 : 0
  const pane = freeze
    ? `<pane xSplit="${frozenCols}" ySplit="${headerRow}" topLeftCell="${colName(frozenCols + 1)}${firstDataRow}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight"/>`
    : ''
  const filter = freeze ? `<autoFilter ref="A${headerRow}:${lastCol}${headerRow}"/>` : ''
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>`
    : ''

  // Gridlines off: with a rule under every row and a banded header, Excel's own
  // grid is noise fighting the structure.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView showGridLines="0" workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${bandXml}${header}${body}</sheetData>${filter}${mergeXml}</worksheet>`
}

const INK = 'FF1F2933'
const INK_STRONG = 'FF0B1220'
const HEADER_FILL = 'FFEEF1F7'
const ZEBRA_FILL = 'FFF8FAFC'
const RULE = 'FFE3E8EF'
const RULE_STRONG = 'FFC3CCDA'

interface StyleBook {
  xml: string
  xf: (kind: CellKind, zebra: boolean) => number
  headerXf: number
  sectionXf: (i: number) => number
}

/**
 * Build styles.xml and the index map cells are addressed by.
 *
 * Generated rather than hard-coded because the number of section colours varies
 * per workbook, and an index that drifts out of step with the XML does not
 * fail loudly — it shows up as dates rendered as five-digit numbers.
 *
 * The formatting itself is not decoration. Fifty columns with no banding, no
 * frozen header and no grouping is unreadable at any width, and the person
 * reading it is scrolling on a handset.
 */
function buildStyles(sectionColors: string[]): StyleBook {
  const HEADER_FILL_ID = 2
  const ZEBRA_FILL_ID = 3
  const SECTION_FILL_BASE = 4

  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    `<fill><patternFill patternType="solid"><fgColor rgb="${HEADER_FILL}"/><bgColor indexed="64"/></patternFill></fill>`,
    `<fill><patternFill patternType="solid"><fgColor rgb="${ZEBRA_FILL}"/><bgColor indexed="64"/></patternFill></fill>`,
    ...sectionColors.map(
      (c) =>
        `<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`,
    ),
  ]

  const fonts = [
    `<font><sz val="10.5"/><color rgb="${INK}"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="10.5"/><color rgb="${INK_STRONG}"/><name val="Calibri"/></font>`,
    '<font><b/><sz val="10.5"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',
  ]

  const borders = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    // A hairline under every data row: the one thing that keeps the eye on a
    // single record while scrolling sideways across fifty columns.
    `<border><left/><right/><top/><bottom style="thin"><color rgb="${RULE}"/></bottom><diagonal/></border>`,
    `<border><left/><right/><top/><bottom style="medium"><color rgb="${RULE_STRONG}"/></bottom><diagonal/></border>`,
  ]

  const numFmt = (kind: CellKind): number =>
    kind === 'date' ? 164 : kind === 'datetime' ? 165 : kind === 'int' ? 166 : kind === 'number' ? 167 : 0

  const xfs: string[] = []
  for (const zebra of [false, true]) {
    for (const kind of KINDS) {
      const wrap = kind === 'long' ? ' wrapText="1"' : ''
      const align = kind === 'int' || kind === 'number' ? ' horizontal="right"' : ''
      xfs.push(
        `<xf numFmtId="${numFmt(kind)}" fontId="0" fillId="${zebra ? ZEBRA_FILL_ID : 0}" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"${wrap}${align}/></xf>`,
      )
    }
  }

  const headerXf = xfs.length
  xfs.push(
    `<xf numFmtId="0" fontId="1" fillId="${HEADER_FILL_ID}" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`,
  )

  const sectionBase = xfs.length
  for (let i = 0; i < sectionColors.length; i++) {
    xfs.push(
      `<xf numFmtId="0" fontId="2" fillId="${SECTION_FILL_BASE + i}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" horizontal="center"/></xf>`,
    )
  }

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="4"><numFmt numFmtId="164" formatCode="dd\ mmm\ yyyy"/><numFmt numFmtId="165" formatCode="dd\ mmm\ yyyy\ hh:mm"/><numFmt numFmtId="166" formatCode="#,##0"/><numFmt numFmtId="167" formatCode="0.00"/></numFmts><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

  return {
    xml,
    xf: (kind, zebra) => (zebra ? KINDS.length : 0) + KINDS.indexOf(kind),
    headerXf,
    sectionXf: (i) => sectionBase + i,
  }
}

/** Sheet names cannot contain []:*?/\\ and cap at 31 characters. */
function safeSheetName(name: string, index: number): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31)
  return cleaned || `Sheet${index + 1}`
}

export async function buildWorkbook(sheets: Sheet[]): Promise<Blob> {
  const encoder = new TextEncoder()
  const names = sheets.map((s, i) => safeSheetName(s.name, i))
  // One style table serves the whole workbook, so every sheet's section colours
  // have to be gathered before any sheet is written.
  const styles = buildStyles(sheets.flatMap((s) => (s.sections ?? []).map((x) => x.color)))

  let colorOffset = 0
  const sheetParts = sheets.map((sheet) => {
    const offset = colorOffset
    const xml = sheetXml(sheet, { ...styles, sectionXf: (i: number) => styles.sectionXf(offset + i) })
    colorOffset += sheet.sections?.length ?? 0
    return xml
  })

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
    .map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets></workbook>`

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

  return zip([
    // [Content_Types].xml must be the first entry in the archive.
    { name: '[Content_Types].xml', bytes: encoder.encode(contentTypes) },
    { name: '_rels/.rels', bytes: encoder.encode(rootRels) },
    { name: 'xl/workbook.xml', bytes: encoder.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', bytes: encoder.encode(workbookRels) },
    { name: 'xl/styles.xml', bytes: encoder.encode(styles.xml) },
    ...sheetParts.map((xml, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      bytes: encoder.encode(xml),
    })),
  ])
}

/** Hand a blob to the user as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoking immediately cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
