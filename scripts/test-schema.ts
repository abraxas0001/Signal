/**
 * Validates ANALYSIS_SCHEMA against the constraints the Messages API enforces
 * on `output_config.format`.
 *
 * This exists because the failure mode is invisible until runtime and then
 * total: an unsupported keyword makes the API reject *every* analysis with a
 * 400, and the schema is generated from the taxonomy, so a future edit to a
 * vocabulary could introduce one without anyone noticing.
 *
 *   npx tsx scripts/test-schema.ts
 */

import { ANALYSIS_SCHEMA } from '../netlify/functions/lib/schema'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YEL = '\x1b[33m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

/** Keywords the structured-outputs validator rejects outright. */
const UNSUPPORTED = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'patternProperties',
  'dependencies',
  'if',
  'then',
  'else',
  'not',
  'oneOf',
]

const SUPPORTED_TYPES = ['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']

interface Problem {
  path: string
  message: string
  severity: 'error' | 'warn'
}

const problems: Problem[] = []
let objects = 0
let enums = 0
let fields = 0
let maxDepth = 0

function walk(node: unknown, path: string, depth: number, seen: Set<unknown>) {
  if (!node || typeof node !== 'object') return
  maxDepth = Math.max(maxDepth, depth)

  // Structured outputs do not support recursive schemas; a cycle would also
  // hang this walker.
  if (seen.has(node)) {
    problems.push({ path, message: 'recursive schema (not supported)', severity: 'error' })
    return
  }
  const nextSeen = new Set(seen).add(node)

  const n = node as Record<string, unknown>

  for (const key of UNSUPPORTED) {
    if (key in n) {
      problems.push({
        path,
        message: `uses "${key}" — rejected by structured outputs; express it in the description instead`,
        severity: 'error',
      })
    }
  }

  const type = n['type']
  if (typeof type === 'string' && !SUPPORTED_TYPES.includes(type)) {
    problems.push({ path, message: `unsupported type "${type}"`, severity: 'error' })
  }

  if (type === 'object') {
    objects++
    const props = n['properties']
    if (!props || typeof props !== 'object') {
      problems.push({ path, message: 'object has no properties', severity: 'error' })
      return
    }

    if (n['additionalProperties'] !== false) {
      problems.push({
        path,
        message: 'missing "additionalProperties": false (required on every object)',
        severity: 'error',
      })
    }

    // Strict mode requires every property to be listed in `required`.
    const propKeys = Object.keys(props as Record<string, unknown>)
    const required = Array.isArray(n['required']) ? (n['required'] as string[]) : []
    const missing = propKeys.filter((k) => !required.includes(k))
    if (missing.length) {
      problems.push({
        path,
        message: `not in "required": ${missing.join(', ')} — every property must be required`,
        severity: 'error',
      })
    }
    const extra = required.filter((k) => !propKeys.includes(k))
    if (extra.length) {
      problems.push({
        path,
        message: `"required" names properties that do not exist: ${extra.join(', ')}`,
        severity: 'error',
      })
    }

    for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
      fields++
      const child = v as Record<string, unknown>
      // A field with no description is a field the model will guess at.
      if (!child['description'] && child['type'] !== 'object') {
        problems.push({ path: `${path}.${k}`, message: 'no description', severity: 'warn' })
      }
      walk(v, `${path}.${k}`, depth + 1, nextSeen)
    }
    return
  }

  if (type === 'array') {
    const items = n['items']
    if (!items) {
      problems.push({ path, message: 'array has no "items"', severity: 'error' })
      return
    }
    walk(items, `${path}[]`, depth + 1, nextSeen)
    return
  }

  if (Array.isArray(n['enum'])) {
    enums++
    const values = n['enum'] as unknown[]
    if (values.length === 0) {
      problems.push({ path, message: 'empty enum', severity: 'error' })
    }
    if (new Set(values).size !== values.length) {
      problems.push({ path, message: 'enum has duplicate values', severity: 'error' })
    }
    if (values.some((v) => typeof v !== 'string')) {
      problems.push({ path, message: 'enum mixes non-string values', severity: 'warn' })
    }
  }
}

console.log(`${BOLD}Validating ANALYSIS_SCHEMA against structured-output constraints${OFF}\n`)

walk(ANALYSIS_SCHEMA, 'root', 0, new Set())

// The schema is sent on every request and counts as input tokens.
const serialised = JSON.stringify(ANALYSIS_SCHEMA)
const approxTokens = Math.round(serialised.length / 4)

console.log(`  objects        ${objects}`)
console.log(`  fields         ${fields}`)
console.log(`  enums          ${enums}`)
console.log(`  max depth      ${maxDepth}`)
console.log(`  serialised     ${(serialised.length / 1024).toFixed(1)} KB  ${DIM}(~${approxTokens} tokens per request)${OFF}`)

// Must round-trip: the SDK serialises this into the request body.
try {
  JSON.parse(serialised)
  console.log(`  round-trip     ${GREEN}ok${OFF}`)
} catch {
  problems.push({ path: 'root', message: 'schema is not JSON-serialisable', severity: 'error' })
}

const errors = problems.filter((p) => p.severity === 'error')
const warns = problems.filter((p) => p.severity === 'warn')

if (warns.length) {
  console.log(`\n${YEL}${warns.length} warning(s)${OFF}`)
  for (const w of warns.slice(0, 12)) console.log(`  ${DIM}${w.path}${OFF} — ${w.message}`)
  if (warns.length > 12) console.log(`  ${DIM}…and ${warns.length - 12} more${OFF}`)
}

if (errors.length) {
  console.log(`\n${RED}${BOLD}${errors.length} error(s) — the API would reject this schema${OFF}`)
  for (const e of errors) console.log(`  ${RED}${e.path}${OFF} — ${e.message}`)
  process.exit(1)
}

console.log(`\n${GREEN}${BOLD}PASS — schema is valid for output_config.format${OFF}\n`)
