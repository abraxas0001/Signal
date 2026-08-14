/**
 * Helpers for pulling JSON out of pages that embed it in <script> tags.
 *
 * Regex is the wrong tool here: YouTube's blobs contain braces, quotes and
 * escapes *inside* string values, so any `\{.*\}` pattern either stops early or
 * swallows the rest of the document. These walk the text properly instead.
 */

/**
 * Starting at `marker`, find the first `{` (or `[`) after it and return the
 * complete balanced literal, respecting string state and backslash escapes.
 */
export function extractBalanced(source: string, marker: string): string | null {
  const at = source.indexOf(marker)
  if (at === -1) return null

  let i = at + marker.length
  while (i < source.length && source[i] !== '{' && source[i] !== '[') {
    // Only skip over the assignment noise: `= `, `:`, whitespace.
    if (!/[\s=:()]/.test(source[i] as string)) return null
    i++
  }
  if (i >= source.length) return null

  const open = source[i] as string
  const close = open === '{' ? '}' : ']'
  const start = i

  let depth = 0
  let inString = false
  let escaped = false

  for (; i < source.length; i++) {
    const ch = source[i] as string

    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      if (inString) escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return null
}

export function parseEmbedded<T = Record<string, unknown>>(
  html: string,
  markers: string[],
): T | null {
  for (const marker of markers) {
    const raw = extractBalanced(html, marker)
    if (!raw) continue
    try {
      return JSON.parse(raw) as T
    } catch {
      /* try the next marker */
    }
  }
  return null
}

type Json = Record<string, unknown>

/**
 * Breadth-first search for the first object containing `key`, returning that
 * key's value. YouTube nests the same renderer at wildly different depths
 * between layouts, so addressing by path alone is brittle.
 */
export function findKey(root: unknown, key: string, maxNodes = 200_000): unknown {
  const queue: unknown[] = [root]
  let seen = 0

  while (queue.length && seen < maxNodes) {
    const node = queue.shift()
    seen++
    if (!node || typeof node !== 'object') continue

    if (!Array.isArray(node)) {
      const obj = node as Json
      if (key in obj) return obj[key]
      for (const v of Object.values(obj)) {
        if (v && typeof v === 'object') queue.push(v)
      }
    } else {
      for (const v of node) if (v && typeof v === 'object') queue.push(v)
    }
  }
  return undefined
}

/** Like `findKey`, but returns the *containing* object rather than the value. */
export function findObjectWith(root: unknown, key: string, maxNodes = 200_000): Json | undefined {
  const queue: unknown[] = [root]
  let seen = 0

  while (queue.length && seen < maxNodes) {
    const node = queue.shift()
    seen++
    if (!node || typeof node !== 'object') continue

    if (!Array.isArray(node)) {
      const obj = node as Json
      if (key in obj) return obj
      for (const v of Object.values(obj)) if (v && typeof v === 'object') queue.push(v)
    } else {
      for (const v of node) if (v && typeof v === 'object') queue.push(v)
    }
  }
  return undefined
}

/** Collect every value stored under `key`, anywhere in the tree. */
export function collectKey(root: unknown, key: string, limit = 50): unknown[] {
  const out: unknown[] = []
  const queue: unknown[] = [root]

  while (queue.length && out.length < limit) {
    const node = queue.shift()
    if (!node || typeof node !== 'object') continue

    if (!Array.isArray(node)) {
      const obj = node as Json
      if (key in obj) out.push(obj[key])
      for (const v of Object.values(obj)) if (v && typeof v === 'object') queue.push(v)
    } else {
      for (const v of node) if (v && typeof v === 'object') queue.push(v)
    }
  }
  return out
}

/**
 * YouTube stores display strings as either `{simpleText}` or `{runs:[{text}]}`.
 * Flatten either shape to a plain string.
 */
export function ytText(node: unknown): string | null {
  if (!node) return null
  if (typeof node === 'string') return node
  if (typeof node !== 'object') return null

  const o = node as Json
  if (typeof o['simpleText'] === 'string') return o['simpleText']

  if (Array.isArray(o['runs'])) {
    const text = (o['runs'] as Json[])
      .map((r) => (typeof r?.['text'] === 'string' ? r['text'] : ''))
      .join('')
    return text || null
  }

  if (typeof o['content'] === 'string') return o['content']
  if (o['accessibility']) {
    const label = findKey(o['accessibility'], 'label')
    if (typeof label === 'string') return label
  }
  return null
}

/**
 * Decode a JSON string body that was captured by regex rather than parsed.
 *
 * Several adapters pull a single value out of a megabyte of embedded JSON with
 * a targeted regex, because parsing the whole blob to read one field is both
 * wasteful and fragile. The cost is that the captured text is still *encoded*:
 * it arrives with \uXXXX, \n, \/ and \" intact.
 *
 * That is not cosmetic. A Facebook page named in mathematical bold capitals is
 * transmitted as 𝐂𝐁..., and it was being shown to the
 * user exactly like that — as literal backslash-u escapes. Telugu and Hindi
 * carry the same risk: an escaped source would turn a whole post into
 * అమ..., which would then be handed to the model as the text to
 * analyse and translate.
 *
 * Surrogate pairs have to be recombined rather than decoded one unit at a time;
 * decoding each half separately yields two lone surrogates and a broken string.
 * Routing the whole fragment through JSON.parse gets that right for free, and
 * the manual pass below only runs when the fragment is not valid JSON alone.
 */
export function decodeJsonString(raw: string | null | undefined): string | null {
  if (raw == null) return null
  if (!raw.includes('\\')) return raw

  try {
    // The capture is the *body* of a string, so re-wrap it before parsing. Any
    // bare quote inside it would already have been escaped by the producer.
    const parsed: unknown = JSON.parse(`"${raw}"`)
    if (typeof parsed === 'string') return parsed
  } catch {
    /* not independently valid JSON — fall through to the manual pass */
  }

  return raw
    .replace(/\\u([0-9a-fA-F]{4})\\u([0-9a-fA-F]{4})/g, (whole, hi: string, lo: string) => {
      const h = parseInt(hi, 16)
      const l = parseInt(lo, 16)
      // A high surrogate followed by a low surrogate is one character.
      return h >= 0xd800 && h <= 0xdbff && l >= 0xdc00 && l <= 0xdfff
        ? String.fromCharCode(h, l)
        : whole
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

/**
 * Read a JSON string *value* out of raw text, following escapes properly.
 *
 * The obvious `/"name":"([^"]+)"/` stops at the first quote, so it truncates any
 * value containing an escaped one — and a page called `He said "no"` is not
 * unusual. This walks the value the way a parser would, then decodes it.
 */
export function readJsonStringField(source: string, key: string, from = 0): string | null {
  const marker = `"${key}":"`
  const at = source.indexOf(marker, from)
  if (at === -1) return null

  let i = at + marker.length
  let escaped = false
  for (; i < source.length; i++) {
    const ch = source[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') break
  }
  if (i >= source.length) return null
  return decodeJsonString(source.slice(at + marker.length, i))
}
