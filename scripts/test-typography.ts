/**
 * Guards the Indic carve-out.
 *
 * Neither Latin face in this product has Telugu coverage, and every display
 * treatment it uses — the gradient fill, the italic serif, negative tracking —
 * damages a conjunct cluster. The browser's per-glyph fallback hides the first
 * problem, so a broken carve-out does not look broken in English and is only
 * discovered by a Telugu reader.
 *
 * It has already been lost once: a refactor replaced a block of type rules and
 * silently took the carve-out with it, and the follow-up patch matched nothing.
 * Nothing failed, nothing warned. Hence a test that reads the stylesheet.
 *
 *   npm run test:typography
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const G = '\x1b[32m'
const R = '\x1b[31m'
const D = '\x1b[2m'
const B = '\x1b[1m'
const O = '\x1b[0m'

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.css'),
  'utf8',
)

interface Check {
  name: string
  why: string
  holds: () => boolean
}

/** Strip comments so a rule mentioned in prose cannot satisfy a check. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '')

const checks: Check[] = [
  {
    name: 'Indic stack is declared',
    why: 'Georgia and Instrument Serif have no Telugu glyphs at all.',
    holds: () => /--font-telugu:\s*[^;]*Telugu/i.test(code),
  },
  {
    name: 'Indic runs claim that stack',
    why: 'Without this the browser picks the fallback font, not us.',
    holds: () => /:lang\(te\)[^{]*\{[^}]*font-family:\s*var\(--font-telugu\)/.test(code),
  },
  {
    name: 'Indic line-height is loose',
    why: 'Latin leading crowds the matras above and below the baseline.',
    holds: () => {
      const block = /:lang\(te\)[^{]*\{([^}]*)\}/.exec(code)?.[1] ?? ''
      const lh = /line-height:\s*([\d.]+)/.exec(block)?.[1]
      return lh != null && Number(lh) >= 1.7
    },
  },
  {
    name: 'Indic letter-spacing is reset',
    why: 'Tracking separates a base character from its vowel sign.',
    holds: () => /:lang\(te\)[^{]*\{[^}]*letter-spacing:\s*0/.test(code),
  },
  {
    name: 'Gradient text fill is removed on Indic',
    why: 'background-clip:text clips the reph and the vowel signs.',
    holds: () => /:lang\(te\)[^{]*hed-grad[\s\S]{0,240}?background:\s*none/.test(code),
  },
  {
    name: 'Marker stroke is removed on Indic',
    why: 'The stroke lands across the matras rather than under the baseline.',
    holds: () => /:lang\(te\)[^{]*\.marked[\s\S]{0,200}?background-image:\s*none/.test(code),
  },
  {
    name: 'Display faces are self-hosted',
    why: 'A CDN webfont is a render-blocking third-party round trip on 4G.',
    holds: () => !/@import\s+url\(["']?https?:\/\/fonts\./.test(code) && /@font-face/.test(code),
  },
  {
    name: 'Webfonts swap rather than block',
    why: 'font-display:swap paints text immediately and upgrades on arrival.',
    holds: () => {
      const faces = code.match(/@font-face\s*\{[^}]*\}/g) ?? []
      return faces.length > 0 && faces.every((f) => /font-display:\s*swap/.test(f))
    },
  },
]

console.log(`\n${B}Typography guards${O}\n`)

let failed = 0
for (const c of checks) {
  const ok = c.holds()
  if (!ok) failed++
  console.log(
    `  ${ok ? `${G}PASS${O}` : `${R}FAIL${O}`}  ${c.name}${ok ? '' : `\n        ${D}${c.why}${O}`}`,
  )
}

console.log(
  failed === 0
    ? `\n${G}${B}PASS — the Indic carve-out is intact${O}\n`
    : `\n${R}${B}${failed} failing${O}\n`,
)
process.exit(failed === 0 ? 0 : 1)
