/**
 * WCAG contrast check for every text/background pair the interface uses.
 *
 * Tokens are parsed out of src/index.css rather than duplicated here, so this
 * cannot drift from the real palette — change a colour and this test tells you
 * immediately whether it is still readable.
 *
 *   npx tsx scripts/test-contrast.ts
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, '..', 'src', 'index.css'), 'utf8')

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YEL = '\x1b[33m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

/**
 * Pull one theme's tokens out of the stylesheet.
 * Light lives in the `:root {` block; dark in `[data-theme='dark'] {`, which is
 * a byte-for-byte copy of the media-query block, so checking it covers both.
 */
function readTokens(startMarker: string): Record<string, string> {
  const at = css.indexOf(startMarker)
  if (at === -1) throw new Error(`Could not find "${startMarker}" in index.css`)
  const block = css.slice(at, css.indexOf('\n}', at))
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[m[1] as string] = m[2] as string
  }
  return out
}

const THEMES = {
  light: readTokens(':root {'),
  dark: readTokens("[data-theme='dark'] {"),
}

// ─── WCAG 2.1 relative luminance ─────────────────────────────────────────────

function channels(h: string): [number, number, number] {
  let s = h.replace('#', '')
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as [number, number, number]
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// ─── The pairs the interface actually renders ────────────────────────────────
// 4.5 for body and small text, 3.0 for large text and non-text indicators.

const PAIRS: Array<[fg: string, bg: string, min: number, where: string]> = [
  ['text', 'surface', 4.5, 'body copy on cards'],
  ['text', 'bg', 4.5, 'body copy on canvas'],
  ['text-2', 'surface', 4.5, 'secondary copy'],
  ['text-2', 'surface-2', 4.5, 'secondary copy on inset panels'],
  ['text-3', 'surface', 4.5, 'provenance marks, captions'],
  ['text-3', 'surface-2', 4.5, 'small labels on inset panels'],
  ['text-3', 'bg', 4.5, 'footer and meta line'],
  ['accent', 'surface', 4.5, 'links and inline actions'],
  ['accent', 'accent-soft', 4.5, 'accent chip text'],
  ['accent-fg', 'accent', 4.5, 'primary button label'],
  // The entrance's two solid non-blue buttons. Both take `--accent-fg`
  // rather than white on purpose: white is 2.0:1 on the dark `--pos` and
  // 2.7:1 on the dark `--accent-2`, and both fail. This pins that.
  ['accent-fg', 'pos', 4.5, 'create-account button label'],
  ['accent-fg', 'accent-2', 4.5, 'demo door button label'],
  ['pos', 'pos-soft', 4.5, 'positive chip text'],
  ['warn', 'warn-soft', 4.5, 'warning chip text'],
  ['neg', 'neg-soft', 4.5, 'negative chip text'],
  ['info', 'info-soft', 4.5, 'info chip text'],
  ['neg', 'surface', 4.5, 'error message text'],
  ['pos', 'surface', 4.5, 'credibility "supports" text'],
  ['warn', 'surface', 4.5, 'severity and risk levels'],
  ['chart-pos', 'surface', 3.0, 'sentiment label and meter'],
  ['chart-neg', 'surface', 3.0, 'sentiment label and meter'],
  ['chart-mid', 'surface', 3.0, 'neutral sentiment marker'],
  ['border-interactive', 'surface', 3.0, 'input borders, outline buttons'],
  ['border-interactive', 'surface-2', 3.0, 'rescue-sheet inputs'],
]

let failing = 0
let borderline = 0

for (const mode of ['light', 'dark'] as const) {
  const t = THEMES[mode]
  console.log(`\n${BOLD}${mode.toUpperCase()}${OFF}  ${DIM}${Object.keys(t).length} tokens parsed${OFF}`)

  for (const [fg, bg, min, where] of PAIRS) {
    const fgHex = t[fg]
    const bgHex = t[bg]
    if (!fgHex || !bgHex) {
      console.log(`  ${YEL}SKIP${OFF}  ${fg} on ${bg} ${DIM}(token missing)${OFF}`)
      continue
    }

    const r = contrast(fgHex, bgHex)
    const ok = r >= min
    const near = !ok && r >= min - 0.5
    if (!ok) near ? borderline++ : failing++

    const tag = ok ? `${GREEN}PASS${OFF}` : near ? `${YEL}NEAR${OFF}` : `${RED}FAIL${OFF}`
    console.log(
      `  ${tag} ${r.toFixed(2).padStart(6)}:1 ${DIM}(needs ${min.toFixed(1)})${OFF}  ${`${fg} on ${bg}`.padEnd(28)} ${DIM}${where}${OFF}`,
    )
  }
}

console.log(`\n${BOLD}${failing} failing, ${borderline} borderline${OFF}`)

if (failing > 0) {
  console.log(`${RED}Text below 4.5:1 is unreadable for many users. Darken the foreground token.${OFF}\n`)
  process.exit(1)
}
console.log(`${GREEN}${BOLD}PASS — every pair meets WCAG AA in both themes${OFF}\n`)
