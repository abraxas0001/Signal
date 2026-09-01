/**
 * The poster renderer: one canvas, one drawing pass, two outputs.
 *
 * WHY A CANVAS AND NOT DOM OR SVG. The studio shows the office a live preview
 * and then hands them a file to post. If the preview were DOM and the export
 * were a second code path, they would be two renderers of the same design, and
 * two renderers drift: a line that wrapped at three lines on screen wraps at
 * four in the file, a webfont that had loaded in the preview had not loaded in
 * the export, a rule lands two pixels lower. The drift is never noticed in the
 * studio. It is noticed after the poster is on a Facebook page under a
 * politician's name. Drawing both from `renderPoster` means the preview is the
 * export at a different scale, and nothing can differ but the number of pixels.
 *
 * WHAT THIS MODULE WILL NOT DO. It never derives a date. There is no date field
 * in `PosterInput` and no calendar anywhere in this file, because a movable
 * festival is computed from a lunisolar calendar and a wrong date published
 * under an officeholder's name cannot be taken back. Whatever date appears on a
 * poster is text the desk typed. It also renders exactly one speaker: the
 * signature on every template carries `name` and `designation`, which are the
 * desk owner's, and no template has a slot for a second attribution, so a
 * poster made here cannot present a sentence as somebody else's.
 */

/** The three shapes a template can take, which is what the picker groups by. */
import { drawDiyaRow, drawMarigolds } from './ornaments/diwali'
import { drawCrowd, drawFlagWave, drawMonument, drawSkyline } from './ornaments/nation'
import { drawBalloons, drawBunting, drawCake, drawConfetti } from './ornaments/celebrate'
import {
  drawMandalaCorner,
  drawPaperGrain,
  drawTricolourWash,
  drawWashBottomLeft,
  drawWashTopLeft,
  drawWashTopRight,
} from './ornaments/ground'
import { mix, soft, type Ink } from './ornaments/kit'

export type PosterKind = 'image' | 'text' | 'quote'

export interface PosterTemplate {
  id: string
  name: string
  kind: PosterKind
  /**
   * Party-neutral by default. The desk's own colours are passed in, not baked
   * in. `accent2` is the second party colour, the one a foot rule or an edge
   * band is set in, and it is optional because the five original templates were
   * designed without one and still are.
   */
  palette: { bg: string; accent: string; accent2?: string | null; ink: string; onAccent: string }
  /** One line on what this template is for, shown under its name in the picker. */
  about: string
  /**
   * True when this template is drawn in the DESK'S OWN party colours, carries
   * the party's mark and has room for the leaders.
   *
   * The flag exists so the studio knows which templates to hand the desk's
   * palette to. Handing it to all of them would be simpler and wrong: the quote
   * card is a dark card and the festival card is warm paper, both chosen for
   * the layout rather than for any party, and repainting them in saffron would
   * take away the office's only way to publish something that does not look
   * like a party poster. A condolence notice is the obvious case.
   */
  party?: boolean
}

export interface PosterInput {
  template: PosterTemplate
  /** The big line. Usually the greeting or the claim. */
  headline: string
  /** The sentence or two under it. May be empty. */
  body: string
  /** Who is speaking: name, then designation on a second line. */
  name: string
  designation: string
  /** The desk owner's own photograph. Null renders the layout without it. */
  photoUrl: string | null
  /**
   * The party's colours. Falls back to template.palette when absent.
   *
   * Every field below this line is optional, and that is a contract rather than
   * a convenience: the studio called this module before any of them existed and
   * has to keep calling it the same way, drawing exactly what it drew before.
   * A template that reserves room for one of these slots and is handed nothing
   * closes the room up. None of them ever leaves a placeholder on the poster.
   */
  palette?: {
    bg: string
    accent: string
    accent2?: string | null
    ink: string
    onAccent: string
  } | null
  /** The party's mark, supplied by the desk. Never bundled with the product. */
  partyMarkUrl?: string | null
  /** The party's national figure, supplied by the desk. */
  leaderUrl?: string | null
  /** A second figure, usually the state leader. */
  leader2Url?: string | null
  /** The short party name, set beside the mark where a template has room. */
  partyShort?: string | null
  /**
   * The party's own name in the script of the card, e.g. the Devanagari or
   * Telugu form, set in small type under the mark.
   *
   * Separate from `partyShort` and not derived from it, because the two do
   * different jobs: the short form is what goes in a disc when there is no
   * mark, and this is what goes under the mark when there is one. A card that
   * fell back from one to the other would set "BJP" in Latin under a Hindi
   * greeting, which is the tell that a foreigner made the poster.
   */
  partyName?: string | null
  /** A line the office puts on every poster. */
  slogan?: string | null
  /**
   * The small line over the greeting: "Happy" over "Diwali", or the Hindi
   * equivalent over the festival's name.
   *
   * A field of its own rather than the first word of the headline, because
   * splitting on a space would set "Together" small over "for a Stronger
   * India", and because there is no rule that finds it: the office knows which
   * part of their greeting is the little word and nothing here does.
   */
  eyebrow?: string | null
  /** 1080x1350 by default, which is what Instagram and Facebook both accept. */
  size?: { w: number; h: number }
}

/** The default frame. Instagram's tallest accepted ratio, and Facebook takes it too. */
export const POSTER_SIZE = { w: 1080, h: 1350 } as const

/**
 * What became of the photograph on the last pass.
 *
 * `unavailable` is not the same as `none`, and the studio must not show them
 * the same way: `none` means the desk has chosen no photograph, while
 * `unavailable` means they chose one and it could not be loaded, so the poster
 * in front of them is missing something they asked for.
 */
export type PhotoOutcome = 'none' | 'drawn' | 'unavailable'

export interface PosterRender {
  photo: PhotoOutcome
  /**
   * False when the platform has no face for a script in the text, so the
   * headline is rendering as boxes. Drawing continues either way, because a
   * poster the desk can see is wrong is more useful than an exception.
   */
  glyphsCovered: boolean
}

/* ===========================================================================
   Type
   =========================================================================== */

/**
 * The font stack, and why it is not simply `--font-ui` from index.css.
 *
 * Canvas takes a CSS font shorthand and resolves it against the document's
 * fonts, so the same per-glyph fallback applies here as in the DOM: Inter comes
 * first and its @font-face declares a Latin `unicode-range`, which means a
 * Telugu or Devanagari code point never matches it and falls through to the
 * Indic faces behind it. That ordering is deliberate. Putting an Indic face
 * first would work, but it would also draw the Latin words in it, and the
 * poster's English would stop matching the rest of the product.
 *
 * The Indic half is wider than `--font-telugu` in index.css because that stack
 * only has to survive on the machines this desk runs on, whereas a poster gets
 * drawn wherever the office happens to be: Nirmala UI on Windows, Kohinoor and
 * the Sangam faces on macOS and iOS, Noto on Android and Linux. Devanagari is
 * listed beside Telugu, since Hindi captions go through the same field.
 */
const STACK =
  "'Inter', 'Noto Sans Telugu', 'Noto Sans Devanagari', 'Nirmala UI', Gautami, " +
  "'Kohinoor Telugu', 'Kohinoor Devanagari', 'Telugu Sangam MN', 'Devanagari Sangam MN', " +
  "Mangal, ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif"

/** Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam. */
const INDIC =
  /[\u0900-\u097f\u0980-\u09ff\u0a00-\u0a7f\u0a80-\u0aff\u0b00-\u0b7f\u0b80-\u0bff\u0c00-\u0c7f\u0c80-\u0cff\u0d00-\u0d7f]/

const isIndic = (s: string): boolean => INDIC.test(s)

/**
 * The display faces, and why they are STACKS rather than single families.
 *
 * The reference sheet sets its greetings in a script and its statements in a
 * serif, and every one of those cards is in English or Hindi. This desk posts
 * in Telugu. No script face on earth covers Telugu, Devanagari and Latin, so a
 * greeting set in one of these will fall through, glyph by glyph, to whichever
 * face in the stack has the character: the script for the Latin word, the
 * Indic face for the Telugu one. That is not a compromise, it is the only
 * behaviour that does not draw a row of empty boxes on somebody's festival
 * card, and it is the same per-glyph fallback the body stack already relies on.
 */
const SCRIPT =
  "'Playfair Display', 'Instrument Serif', 'Noto Serif Devanagari', " +
  "'Noto Serif Telugu', Georgia, " + STACK
const DISPLAY =
  "'Instrument Serif', 'Playfair Display', 'Noto Serif Devanagari', " +
  "'Noto Serif Telugu', Georgia, " + STACK

/** Which face a block is set in. `body` is the product's own sans. */
export type Face = 'body' | 'display' | 'script'

const FACES: Record<Face, string> = { body: STACK, display: DISPLAY, script: SCRIPT }

const font = (weight: number, size: number, face: Face = 'body'): string =>
  `${weight} ${size}px ${FACES[face]}`

/**
 * Wait for the faces before drawing, which the DOM never has to do.
 *
 * `font-display: swap` gives a DOM heading a second chance: it paints in the
 * fallback and repaints when the file lands. Canvas has no second chance. It
 * rasterises once with whatever is resident at that instant, and a preview
 * drawn a beat too early is silently set in the wrong face for as long as it is
 * on screen. Failing here is not fatal, so it is swallowed: the poster is drawn
 * in the fallback rather than not drawn at all.
 */
async function ensureFaces(sample: string): Promise<void> {
  const set = typeof document === 'undefined' ? null : document.fonts
  if (!set) return
  // TWO SAMPLES, AND THE SECOND ONE IS THE POINT. Whether a face loads is
  // decided by the unicode-range it DECLARES, never by the glyphs it really
  // has: `document.fonts.load` resolves happily with an empty list when
  // nothing matches, having fetched nothing. Inter and Instrument Serif both
  // declare a Latin range, so a poster written entirely in Telugu matches
  // neither and both stay unloaded, and the name and the designation, which
  // are Latin, then draw in a fallback face. A plain Latin sample alongside
  // the poster's own text asks for both halves of the stack.
  //
  // It matters more than it sounds. A canvas drawn one tick before a face
  // arrives is not merely wrong for that tick: nothing repaints it, so the
  // poster the office downloads is in the wrong face permanently.
  const samples = [sample, 'Aa']
  const wanted: [number, number, Face][] = [
    [700, 96, 'body'],
    [600, 40, 'body'],
    [400, 36, 'body'],
    [700, 104, 'display'],
    [400, 40, 'display'],
    [700, 118, 'script'],
  ]
  await Promise.allSettled(
    wanted.flatMap(([weight, size, face]) =>
      samples.map((text) => set.load(font(weight, size, face), text)),
    ),
  )
}

/**
 * Whether every glyph in the text has a face behind it, or the poster is about
 * to render tofu.
 *
 * Measured rather than asked, because nothing answers this directly:
 * `document.fonts.check` reports on @font-face rules and returns true for any
 * family it does not manage, which is every system font, so it cannot see a
 * Windows install with no Telugu face on it. What it can be measured against is
 * U+FFFF, a permanent noncharacter no font has a glyph for, so whatever the
 * platform draws for it is its missing-glyph mark. A character that measures
 * the same width as that mark, or measures nothing at all on the platforms that
 * draw a blank instead of a box, has no face behind it.
 *
 * A heuristic, and it is aimed at the failure that actually happens: not one
 * rare conjunct, but a machine with no Indic face at all, where the whole
 * Telugu headline comes out as a row of boxes.
 */
export function hasGlyphCoverage(text: string): boolean {
  if (typeof document === 'undefined' || !text) return true
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return true
  ctx.font = font(400, 64)
  const tofu = ctx.measureText('\uFFFF').width
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    // ASCII always resolves, and a combining mark measured on its own says
    // nothing: it has no advance of its own to compare. Format characters are
    // skipped for a sharper reason: a zero width joiner, a zero width space or
    // a soft hyphen is SUPPOSED to measure nothing, and counting that as a
    // missing face made this report tofu for text the platform draws perfectly.
    // A caption pasted from a browser or a chat routinely carries one, and
    // Devanagari and Telugu use the joiners on purpose, so the studio would have
    // told the desk their machine had no Indic font while it was rendering fine.
    if (code < 0x0080 || /\s/.test(ch) || /[\p{M}\p{Cf}]/u.test(ch)) continue
    const w = ctx.measureText(ch).width
    if (w === 0 || Math.abs(w - tofu) < 0.01) return false
  }
  return true
}

/**
 * Grapheme clusters, so a mid-word break never lands inside a letter.
 *
 * Splitting a string by code point is wrong for every script this poster is
 * likely to carry: a Telugu syllable is a consonant plus a vowel sign plus
 * often a virama and a second consonant, and cutting between them leaves a
 * dangling matra at the start of the next line. `Intl.Segmenter` knows where
 * the seams are. The fallback is only reached on browsers that predate it, and
 * code points are at least better there than UTF-16 units, which would split a
 * surrogate pair in half.
 */
const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

const clusters = (s: string): string[] =>
  segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s)

/**
 * Break one paragraph to a width.
 *
 * Canvas has no wrapping of any kind, so this is the whole of it. Words first,
 * greedily, which is what every reader expects. The second half is the one that
 * matters here: Telugu compounds and long Devanagari runs frequently arrive as
 * a single token wider than the card, and a word-only wrapper would push them
 * off the edge with no space to break on. Anything that cannot fit a line of
 * its own is broken by grapheme cluster instead.
 */
function wrapParagraph(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  const lines: string[] = []
  let line = ''

  const pushBroken = (word: string): void => {
    let part = ''
    for (const c of clusters(word)) {
      const next = part + c
      if (part && ctx.measureText(next).width > maxWidth) {
        lines.push(part)
        part = c
      } else {
        part = next
      }
    }
    line = part
  }

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate
      continue
    }
    if (line) {
      lines.push(line)
      line = ''
    }
    if (ctx.measureText(word).width <= maxWidth) line = word
    else pushBroken(word)
  }
  if (line) lines.push(line)
  return lines
}

/** A block of text that has been measured and is ready to paint. */
interface Block {
  lines: string[]
  size: number
  /** Line-to-line distance in design pixels. */
  step: number
  weight: number
  face: Face
  height: number
  /** True when the type reached its floor and the text still had to be cut. */
  clipped: boolean
}

interface FitOptions {
  maxWidth: number
  maxLines: number
  /** The size this block wants, before any shrinking. */
  size: number
  /** The smallest it may become. Below this the poster stops reading at a glance. */
  minSize: number
  weight: number
  /** Line height multiplier for Latin. An Indic run raises it, see below. */
  leading: number
  /**
   * The vertical room this block actually has, when that is tighter than
   * `maxLines` on its own.
   *
   * A line count alone is not a bound on height, and the two came apart on the
   * photo led card: three lines of headline at the size it asked for ran a
   * seventeen pixel overlap into the signature rule below it. Passing the room
   * instead lets the shrink loop answer the question that was actually being
   * asked, which is whether the block fits, not how many lines it has.
   */
  maxHeight?: number
  /** The face this block is set in. Defaults to the product's own sans. */
  face?: Face
}

const EMPTY_BLOCK: Block = {
  lines: [],
  size: 0,
  step: 0,
  weight: 400,
  face: 'body',
  height: 0,
  clipped: false,
}

/**
 * Wrap the text, then shrink a step at a time until it fits its allowance.
 *
 * The alternative, letting a long caption overflow, is the failure this
 * function exists to prevent: nobody checks the bottom edge of a card before
 * posting it, and a headline that runs off it is discovered exactly once. Nine
 * per cent a step is small enough that no single step is visible and large
 * enough that six of them cover a two-to-one range.
 *
 * At the floor the remaining lines are cut and the last one takes an ellipsis.
 * That is deliberate: dropping the end of a sentence silently hides the
 * problem, whereas an ellipsis on the card tells the desk their caption is too
 * long while they can still shorten it.
 */
function fit(ctx: CanvasRenderingContext2D, text: string, o: FitOptions): Block {
  const trimmed = text.trim()
  if (!trimmed) return EMPTY_BLOCK

  // Indic matras sit above and below the base line, so Latin leading crowds
  // them and the reph collides with the line above. This is the same carve-out
  // index.css makes for :lang(te).
  const leading = isIndic(trimmed) ? Math.max(o.leading, 1.45) : o.leading
  const paragraphs = trimmed.split(/\r?\n/)

  let size = o.size
  for (;;) {
    ctx.font = font(o.weight, size, o.face)
    const lines = paragraphs.flatMap((p) =>
      p.trim() ? wrapParagraph(ctx, p.trim(), o.maxWidth) : [''],
    )
    const step = Math.round(size * leading)
    const room =
      o.maxHeight === undefined
        ? o.maxLines
        : Math.min(o.maxLines, Math.max(1, Math.floor(o.maxHeight / step)))
    if (lines.length <= room || size <= o.minSize) {
      const clipped = lines.length > room
      const kept = clipped ? lines.slice(0, room) : lines
      const last = kept[kept.length - 1]
      if (clipped && last !== undefined) {
        // The ellipsis has a width of its own, so the line carrying it has to
        // give room back. Appending it to a line that already filled the
        // measure hangs the mark past the measure it was wrapped to, which on
        // the split card is the gap in front of the photograph.
        const cs = clusters(last)
        while (cs.length > 1 && ctx.measureText(cs.join('') + '…').width > o.maxWidth) cs.pop()
        kept[kept.length - 1] = cs.join('') + '…'
      }
      return {
        lines: kept,
        size,
        step,
        weight: o.weight,
        face: o.face ?? 'body',
        height: kept.length * step,
        clipped,
      }
    }
    size = Math.max(o.minSize, Math.round(size * 0.91))
  }
}

type Align = 'left' | 'right' | 'center'

/** Paint a fitted block from its top edge, returning the y just past it. */
function paint(
  ctx: CanvasRenderingContext2D,
  b: Block,
  x: number,
  top: number,
  color: string | CanvasGradient,
  align: Align = 'left',
): number {
  if (b.lines.length === 0) return top
  ctx.font = font(b.weight, b.size, b.face)
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'top'
  // The em box is taller than the type in it, so a block set flush at `top`
  // reads as though it starts low. Lifting it by a tenth of the size puts the
  // cap height where the eye expects the block to begin.
  let y = top - b.size * 0.1
  for (const line of b.lines) {
    ctx.fillText(line, x, y)
    y += b.step
  }
  ctx.textAlign = 'left'
  return top + b.height
}

/**
 * Paint a block with a colour per line, cycling when the block has more lines
 * than colours.
 *
 * Every reference poster the owner supplied picks one word or one line of the
 * greeting out in a second colour: "\u0936\u0941\u092d" in dark ink over
 * "\u0926\u0940\u092a\u093e\u0935\u0932\u0940" in the party's own, and
 * the card reads as a poster rather than as a paragraph because of it. Doing it
 * per WORD would mean painting runs inside a wrapped line and re-measuring each
 * one, and the office would have to learn a markup to say which word. Per LINE
 * needs no markup at all, because the office already decides where the line
 * breaks by how they write the greeting, and it lands on the same effect.
 */
function paintLines(
  ctx: CanvasRenderingContext2D,
  b: Block,
  x: number,
  top: number,
  colours: (string | CanvasGradient)[],
  align: Align = 'left',
): number {
  if (b.lines.length === 0 || colours.length === 0) return top
  ctx.font = font(b.weight, b.size, b.face)
  ctx.textAlign = align
  ctx.textBaseline = 'top'
  let y = top - b.size * 0.1
  b.lines.forEach((line, i) => {
    // The LAST line takes the last colour, not the (i mod n)th, so a two line
    // greeting and a three line one both end on the accent. Cycling from the
    // front would put the accent in the middle of a three line block, which is
    // where it never belongs.
    const from = colours.length - b.lines.length + i
    ctx.fillStyle = colours[from < 0 ? Math.min(i, colours.length - 1) : from] ?? colours[0]!
    ctx.fillText(line, x, y)
    y += b.step
  })
  ctx.textAlign = 'left'
  return top + b.height
}

/* ===========================================================================
   Shapes and photographs
   =========================================================================== */

/**
 * Load the photograph, and never let it take the poster down with it.
 *
 * `crossOrigin` is set BEFORE `src`, which is the whole trick and the reason
 * this cannot be inlined at the call site. With it set, a remote image either
 * arrives with CORS headers and leaves the canvas clean, or it fails outright
 * and the layout is drawn without it. Without it, a remote image loads happily
 * and TAINTS the canvas, and the failure surfaces at `toBlob`, at the end, when
 * the office presses download. A poster with no face is usable; a security
 * error on the download button is a dead end with nothing to do about it.
 *
 * Resolves null rather than rejecting for the same reason: every caller wants
 * the layout drawn either way.
 */
async function loadPhoto(url: string | null): Promise<HTMLImageElement | null> {
  if (!url || typeof document === 'undefined') return null
  return await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * Draw a photograph to fill a box, cropping the overflow rather than squashing
 * it.
 *
 * The crop is biased to the upper part of the source. These are portraits, and
 * a centred crop of a portrait takes the top off the head before it takes
 * anything off the chest.
 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const sw = img.naturalWidth
  const sh = img.naturalHeight
  if (sw === 0 || sh === 0) return
  const scale = Math.max(w / sw, h / sh)
  const dw = sw * scale
  const dh = sh * scale
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) * 0.32, dw, dh)
}

/** The desk owner's initials, for the space a template reserved for a photograph. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]
  if (first === undefined) return ''
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined
  return (clusters(first)[0] ?? '') + (last === undefined ? '' : (clusters(last)[0] ?? ''))
}

/* `soft` and `mix` live in the ornament kit now, because the ornaments need
   them too and two copies of a colour helper is how two files end up disagreeing
   about what a 40 per cent ink looks like. */

/* ===========================================================================
   Party furniture

   Everything a party puts on a poster arrives here as a SLOT the desk fills.
   The product ships to more than one office and it bundles no party's mark and
   no leader's photograph, because the rights to those images are not ours to
   redistribute. A desk points these fields at files it holds, once, and the
   studio reuses them from then on.

   The one thing this section will never do is draw a party's symbol from
   memory. An approximated lotus, wheel, hand, cycle or lamp is a WRONG symbol,
   and a wrong symbol on a member's poster is worse than a poster carrying no
   symbol at all: the first is a false claim about the party, the second is
   simply a blank the desk can fill. Where no mark has been supplied the layout
   closes over the space, or falls back to the party's short name set as text
   inside a plain disc, which is a word and not a mark.
   =========================================================================== */

/** The palette as the drawing routines see it: a template's, or the desk's. */
type Palette = PosterTemplate['palette']

const clean = (v: string | null | undefined): string => (v ?? '').trim()

/**
 * Relative luminance and contrast, so the ink on a party field is measured
 * rather than assumed.
 *
 * This is here because of one failure in particular. Saffron is a light
 * colour: white type on the bright saffron these templates use as their field
 * measures about 2.1 to 1, which no reader can hold at any size, while the same
 * white on the deep saffron of the bands measures about 5.9 to 1 and is
 * comfortable. A routine that hardcoded "white on the party colour" would
 * therefore be right in one half of its own composition and wrong in the other,
 * and wrong again the first time a desk of another party passed its own
 * palette. Asking the numbers instead means every ground in this file gets
 * whichever of the palette's two inks can actually be read on it.
 *
 * The formula is WCAG 2.1, the same one scripts/test-contrast.ts holds the
 * interface to, so a colour that passes there passes here.
 */
const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

function luminance(hex: string): number {
  const n = hex.replace('#', '')
  const full =
    n.length === 3
      ? n
          .split('')
          .map((c) => c + c)
          .join('')
      : n
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  // A colour this cannot parse reads as black rather than NaN. NaN compares
  // false against everything, which would make `inkOn` pick whichever ink it
  // happened to test second and hide the bad value; black at least makes the
  // choice deterministic and sends the lighter ink forward.
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 0
  return 0.2126 * linear(r / 255) + 0.7152 * linear(g / 255) + 0.0722 * linear(b / 255)
}

function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Whichever of the palette's two inks can be read on this ground. */
const inkOn = (p: Palette, ground: string): string =>
  contrast(p.ink, ground) >= contrast(p.onAccent, ground) ? p.ink : p.onAccent

/**
 * The party field the three party templates ship with, and why colours are in
 * the product when a mark and a portrait are not.
 *
 * A party's colours are widely published facts about its identity rather than
 * an asset with an owner's rights attached, so they can sit in the library
 * where a logo and a leader's photograph cannot. They are still only a DEFAULT:
 * a desk of any other party passes `palette` on the input and these three
 * templates redraw themselves in its colours without another line of code.
 *
 * The pairs, measured with `contrast` above and chosen on the numbers:
 *   dark ink #2b1503 on the bright field #ff9d2e ....... 8.3 to 1
 *   white on the deep band #b23c07 ..................... 5.9 to 1
 *   white on the bright field .......................... 2.1 to 1  never used
 *   green #0f7a2e against the deep band ................ 1.1 to 1  blocks only
 *
 * The last two lines are the ones that shaped the layouts. White reversed out
 * of saffron is the commonest way one of these posters ends up unreadable, so
 * the greeting is set in dark ink wherever the bright field is the ground, and
 * the deep band is reserved for anything white. And green sits at almost the
 * same luminance as deep saffron, so the green in this palette is only ever a
 * broad block, where the shift in hue carries it, never a hairline or a word.
 */
const PARTY_FIELD = {
  bg: '#ff9d2e',
  accent: '#b23c07',
  accent2: '#0f7a2e',
  ink: '#2b1503',
  onAccent: '#ffffff',
} as const

/* ===========================================================================
   The templates

   There used to be ten of these, each its own drawing routine: a festival
   card, a banner, a quote card, a photo led card, a split panel, and five
   party layouts written on top of them. They are gone, and the reason is worth
   recording. Every one was designed from a DESCRIPTION of what an Indian party
   poster looks like. When the owner finally put the real thing in front of us,
   fifteen cards from a template sheet their office would actually buy, not one
   of the ten was close, and no amount of adjusting was going to get a layout
   invented from a description to arrive at a layout drawn from life.

   What is here instead is one family with five members, measured off that
   sheet, parameterised by the desk's own party. `palette` stays a field on the
   template rather than a constant so a party's colours can still override it.
   =========================================================================== */

interface CardSpec {
  id: string
  name: string
  about: string
  /** Ivory for a festival, near white for everything else. */
  paper: 'ivory' | 'white'
  /** What is laid on the paper before anything is set on it. */
  behind: 'mandala' | 'tricolour-top' | 'corner-pair' | 'none'
  /** What hangs from the top edge. */
  top: 'bunting' | 'none'
  /** What runs along the foot, in front of the standing figure. */
  foot: 'diyas' | 'crowd' | 'flagwave' | 'balloons' | 'none'
  /** A single illustration set behind the message. */
  centre: 'monument' | 'skyline' | 'none'
  /** The colour rhythm of the greeting's lines. */
  rhythm: 'two-tone' | 'alternating' | 'plain'
  /** The face the greeting is set in. */
  face: Face
}

/**
 * Five cards, and they are DATA rather than five drawing routines.
 *
 * The owner asked for at least five templates for each of several parties.
 * Fifteen routines would have got there and then frozen there: a sixteenth
 * party, or a sixth card, would have meant another routine and another copy of
 * the same arithmetic to keep in step. These five are one routine and five
 * rows, and the party is a runtime argument, so a BJP desk gets five cards, a
 * Congress desk gets five in Congress colours with the Congress mark and the
 * Congress figure, and a desk of a party this file has never heard of gets five
 * as well. Sixteen parties, eighty cards, five rows of data.
 */
const WORKER_CARDS: CardSpec[] = [
  {
    id: 'greet',
    name: 'Festival greeting',
    about: 'Ivory and gold, the greeting in a script, lit lamps along the foot.',
    paper: 'ivory',
    behind: 'mandala',
    top: 'none',
    foot: 'diyas',
    centre: 'none',
    rhythm: 'two-tone',
    face: 'script',
  },
  {
    id: 'nationday',
    name: 'National day',
    about: 'A monument in outline, the national colours sweeping across the foot.',
    paper: 'white',
    behind: 'none',
    top: 'none',
    foot: 'flagwave',
    centre: 'monument',
    rhythm: 'two-tone',
    face: 'display',
  },
  {
    id: 'together',
    name: 'Message card',
    about: 'The national colours washed across the top, a crowd with flags at the foot.',
    paper: 'white',
    behind: 'tricolour-top',
    top: 'none',
    foot: 'crowd',
    centre: 'none',
    rhythm: 'two-tone',
    face: 'display',
  },
  {
    id: 'wishes',
    name: 'Birthday wishes',
    about: 'Bunting overhead and balloons at the foot, the wish set in a script.',
    paper: 'white',
    behind: 'none',
    top: 'bunting',
    foot: 'balloons',
    centre: 'none',
    rhythm: 'two-tone',
    face: 'script',
  },
  {
    id: 'slogan',
    name: 'Slogan card',
    about: 'A short slogan set large, line by line, in the party colours.',
    paper: 'white',
    behind: 'corner-pair',
    top: 'none',
    foot: 'crowd',
    centre: 'skyline',
    rhythm: 'alternating',
    face: 'display',
  },
]

export const TEMPLATES: PosterTemplate[] = WORKER_CARDS.map((c) => ({
  id: c.id,
  name: c.name,
  kind: 'image' as const,
  palette: { ...PARTY_FIELD },
  party: true,
  about: c.about,
}))

interface Scene {
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  p: Palette
  input: PosterInput
  photo: HTMLImageElement | null
  /** The party mark, when the desk has supplied one and it loaded. */
  mark: HTMLImageElement | null
  /**
   * Only the leader portraits that actually arrived, in the order they were
   * given. A slot the desk has not filled, and a slot whose file has since gone
   * missing, are both simply absent from this list, which is what lets a leader
   * strip reflow to the faces it has instead of ruling off space for faces it
   * does not.
   */
  leaders: HTMLImageElement[]
}

/** The margin every template shares, so a set of posters reads as one desk's work. */
const PAD = 84







/* ===========================================================================
   Cut-outs, marks and leader strips

   The shapes the party grammar is built out of. Every one of them has to
   survive its slot being empty, because a desk sets these up once and then
   posts from the studio every week in between.
   =========================================================================== */

/**
 * Draw an image whole inside a box, letterboxing rather than cropping.
 *
 * The counterpart to `drawCover`, and the difference matters in exactly one
 * place: a party mark is a shape with proportions of its own, and cropping it
 * to fill a circle the way a face is cropped cuts the shape. A cut mark is a
 * wrong mark, which is the thing this file is most careful never to publish.
 */
function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const sw = img.naturalWidth
  const sh = img.naturalHeight
  if (sw === 0 || sh === 0) return
  const scale = Math.min(w / sw, h / sh)
  const dw = sw * scale
  const dh = sh * scale
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

interface Cutout {
  /** The ring around the circle, which is the convention for these portraits. */
  ring: string
  ringWidth?: number
  /** What the circle carries before anything is drawn into it. */
  fill: string
  /** Set in the middle when no image arrived. Text only, never a drawn symbol. */
  label?: string
  labelInk?: string
  /** A mark is fitted whole; a face is cropped to fill. */
  whole?: boolean
}

/**
 * A circular cut-out with a ring, which is how every face on one of these
 * posters is presented.
 *
 * The ring is inset by half its own width so it sits over the image rather than
 * half outside the circle, which keeps a row of them evenly spaced whatever the
 * ring weight. An image that failed to load leaves the fill and the label
 * behind, on the principle `loadPhoto` already works to: a poster missing a
 * face is usable, a poster that threw is not.
 */
function disc(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  cx: number,
  cy: number,
  d: number,
  o: Cutout,
): void {
  const r = d / 2
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.fillStyle = o.fill
  ctx.fill()
  ctx.clip()
  if (img && o.whole) {
    const inset = d * 0.17
    drawContain(ctx, img, cx - r + inset, cy - r + inset, d - inset * 2, d - inset * 2)
  } else if (img) {
    drawCover(ctx, img, cx - r, cy - r, d, d)
  } else if (o.label) {
    const b = fit(ctx, o.label, {
      maxWidth: d * 0.74,
      maxLines: 1,
      size: Math.round(d * 0.36),
      minSize: 14,
      weight: 700,
      leading: 1,
    })
    paint(ctx, b, cx, cy - b.height / 2, o.labelInk ?? o.ring, 'center')
  }
  ctx.restore()
  const rw = o.ringWidth ?? Math.max(4, Math.round(d * 0.032))
  ctx.beginPath()
  ctx.arc(cx, cy, r - rw / 2, 0, Math.PI * 2)
  ctx.lineWidth = rw
  ctx.strokeStyle = o.ring
  ctx.stroke()
}

/** Ink, plate and ring for one piece of party furniture on a given ground. */
interface Furniture {
  ink: string
  plate: string
  ring: string
}

/**
 * The party mark, or nothing at all.
 *
 * Returns whether it drew, so the caller can close the lockup up instead of
 * leaving a gap where a mark was going to be. There are three cases and only
 * three: the desk supplied a mark and it is drawn whole; the desk supplied no
 * mark but did give a short party name, and the disc carries that name as TEXT;
 * or the desk has set up neither yet, and the space closes. There is
 * deliberately no fourth case in which this file invents a symbol, because a
 * symbol invented here would be a party's emblem drawn wrong and published
 * under a member's name.
 */
function drawMark(s: Scene, cx: number, cy: number, d: number, o: Furniture): boolean {
  const short = clean(s.input.partyShort)
  if (!s.mark && !short) return false
  disc(s.ctx, s.mark, cx, cy, d, {
    ring: o.ring,
    ringWidth: Math.max(3, Math.round(d * 0.045)),
    fill: o.plate,
    label: s.mark ? '' : clusters(short).slice(0, 4).join(''),
    labelInk: o.ink,
    whole: true,
  })
  return true
}


/** The width a row of `n` cut-outs occupies, so a caller can right-align or centre it. */
const rowWidth = (n: number, d: number, gap: number): number => (n === 0 ? 0 : n * d + (n - 1) * gap)





/* ===========================================================================
   The tricolour grammar
   =========================================================================== */

/**
 * The national colours, at the values the flag publishes them at.
 *
 * India saffron, white and India green. Constants rather than palette fields
 * because they are not the desk's to choose: a sweep in some other office's
 * two colours is not a tricolour, it is a sweep, and these templates already
 * have one of those.
 *
 * WHAT IS NOT DRAWN HERE, and will not be: the Ashoka Chakra. Three bands
 * across a hoarding are the national colours, which every party in the country
 * prints on everything. The same three bands with the wheel on them are the
 * National Flag, and the Flag Code has a great deal to say about where that may
 * appear and what may be printed over it. An office publishing under its own
 * name should not be put on the wrong side of that by a default in a drawing
 * routine, so the wheel is absent by decision rather than by oversight.
 */
const TRICOLOUR = ['#ff9933', '#ffffff', '#138808'] as const

/**
 * The tricolour sweeping across the card, as cloth rather than as three stripes.
 *
 * Drawn as one silhouette with a shadow first and the three colours over it,
 * which is the only ordering that gets a shadow under the whole ribbon: a
 * shadow on each band in turn falls on the band below it and prints two dark
 * rules through the middle of the sweep.
 */
function ribbon(
  ctx: CanvasRenderingContext2D,
  w: number,
  top: number,
  amp: number,
  band: number,
): void {
  // Run the path well past both edges. A wave that begins at x=0 shows a flat
  // end against the frame, and the poster is cropped by nothing.
  const over = 90

  const layer = (base: number, phase: number, alpha: number, shadow: boolean): void => {
    const wave = (x: number, i: number): number =>
      base + i * band + amp * Math.sin((x / w) * Math.PI * 1.9 + phase)
    const sweep = (from: number, to: number): void => {
      ctx.beginPath()
      ctx.moveTo(-over, wave(-over, from))
      for (let x = -over; x <= w + over; x += 10) ctx.lineTo(x, wave(x, from))
      for (let x = w + over; x >= -over; x -= 10) ctx.lineTo(x, wave(x, to) + band)
      ctx.closePath()
    }
    ctx.save()
    ctx.globalAlpha = alpha
    if (shadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.26)'
      ctx.shadowBlur = 30
      ctx.shadowOffsetY = 12
      sweep(0, TRICOLOUR.length - 1)
      ctx.fillStyle = TRICOLOUR[0] ?? '#ff9933'
      ctx.fill()
      ctx.shadowColor = 'transparent'
    }
    TRICOLOUR.forEach((colour, i) => {
      sweep(i, i)
      ctx.fillStyle = colour
      ctx.fill()
    })
    sweep(0, 0)
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(120, 44, 4, 0.45)'
    ctx.stroke()
    ctx.restore()
  }

  // Two sweeps, the back one paler, higher and out of phase. One ribbon on its
  // own reads as a stripe across a flat card; two crossing read as cloth, which
  // is what these posters actually look like.
  layer(top - band * 1.1, -1.5, 0.42, false)
  layer(top, -0.7, 1, true)
}


/**
 * Take the studio background out of a portrait, from the edges inwards.
 *
 * WHY THIS EXISTS. Official portraits are shot against a blown-out white wall,
 * and for as long as these cards had a white ground that did not matter: white
 * on white is invisible. The moment the ground became the party's own colour it
 * mattered a great deal, because the photograph's own background arrived as a
 * bright rectangle of white sitting in the middle of a saffron card, and the
 * figure read as a cut-out pasted on rather than as somebody standing there.
 *
 * IT FLOODS FROM THE BORDER, and that is the whole reason it is safe. A naive
 * pass that removed every near-white pixel would take the prime minister's
 * beard, the white of an eye and a pale kurta with it. This one starts only at
 * pixels on the edge of the frame and spreads through neighbours, so it can
 * only ever remove background that is CONNECTED to the outside. A white beard
 * enclosed by a face is never reached.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not try to be a matting algorithm.
 * A pale kurta touching the frame edge will leak, and a photograph shot against
 * a grey or a coloured wall is left alone entirely. Both are correct failures:
 * the office can supply a proper cut-out PNG and this then finds nothing to do,
 * whereas a clever threshold that guessed would eventually eat somebody's
 * shoulder on a poster nobody checked before posting.
 *
 * The edge is feathered rather than cut, because a hard alpha boundary at this
 * scale prints a white fringe of half-removed pixels around the hair.
 */
function knockOutBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  let img: ImageData
  try {
    img = ctx.getImageData(0, 0, w, h)
  } catch {
    // A tainted canvas. Nothing here is worth losing the figure over.
    return 0
  }
  const d = img.data
  const n = w * h

  // THE THRESHOLD IS MEASURED FROM THE PICTURE, not fixed.
  //
  // It was fixed, at 244, and an adversarial reader found what that costs: on
  // one portrait the wall clips at 255 and the subject's white kurta sits at
  // 246, so 244 cut a gash straight through his chest, while on another the
  // wall itself is at 246 and 244 left a rim of it round the head. There is no
  // single number that is right for both, because the number that matters is
  // not a property of white, it is a property of THIS photograph's wall.
  //
  // So look at the wall. The border ring of the frame is background by
  // definition on a portrait, and its median tells us what the wall clips at.
  // Cutting four points below that takes the wall and leaves everything the
  // photographer actually lit, whatever value they lit it to. It also means an
  // office uploading its own picture gets the same treatment, which a table of
  // hand-tuned numbers per library entry could never have given them.
  //
  // Two guards. A dark or coloured border is not a wall, so nothing is removed
  // at all rather than a hole being punched in a photograph of a room. And the
  // cut never goes below 228: past that the surviving margin over a white
  // kurta or a grey beard is too thin to trust.
  const ring: number[] = []
  const lum = (i: number): number =>
    0.299 * (d[i * 4] ?? 0) + 0.587 * (d[i * 4 + 1] ?? 0) + 0.114 * (d[i * 4 + 2] ?? 0)
  const sat = (i: number): number => {
    const r = d[i * 4] ?? 0
    const g = d[i * 4 + 1] ?? 0
    const b = d[i * 4 + 2] ?? 0
    return Math.max(r, g, b) - Math.min(r, g, b)
  }
  const step = Math.max(1, Math.round(Math.min(w, h) / 220))
  for (let x = 0; x < w; x += step) {
    ring.push(x)
    ring.push((h - 1) * w + x)
  }
  for (let y = 0; y < h; y += step) {
    ring.push(y * w)
    ring.push(y * w + w - 1)
  }
  if (ring.length === 0) return 0
  const lums = ring.map(lum).sort((a, b) => a - b)
  const sats = ring.map(sat).sort((a, b) => a - b)
  const midL = lums[Math.floor(lums.length / 2)] ?? 0
  const midS = sats[Math.floor(sats.length / 2)] ?? 255
  // Not a light neutral wall. Leave the photograph alone.
  if (midL < 232 || midS > 18) return 0
  const cut = Math.max(228, Math.min(252, midL - 4))

  const backdrop = (i: number): boolean => {
    const r = d[i * 4] ?? 0
    const g = d[i * 4 + 1] ?? 0
    const b = d[i * 4 + 2] ?? 0
    if (r < cut || g < cut || b < cut) return false
    return sat(i) < 14
  }

  const seen = new Uint8Array(n)
  // A typed stack rather than a JS array: this runs over a million pixels and
  // an array of that length spends more time growing than flooding.
  const stack = new Int32Array(n)
  let top = 0
  const push = (i: number): void => {
    if (seen[i] === 0) {
      seen[i] = 1
      stack[top++] = i
    }
  }
  for (let x = 0; x < w; x++) {
    push(x)
    push((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    push(y * w)
    push(y * w + w - 1)
  }
  let cleared = 0
  while (top > 0) {
    const i = stack[--top] ?? 0
    if (!backdrop(i)) continue
    d[i * 4 + 3] = 0
    cleared++
    const x = i % w
    const y = (i / w) | 0
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (y > 0) push(i - w)
    if (y < h - 1) push(i + w)
  }

  // Feather: any pixel still opaque but touching a cleared one is pulled down
  // towards transparent. One pass is enough at this scale and costs a single
  // sweep, where a proper blur would cost several.
  const alpha = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) alpha[i] = d[i * 4 + 3] ?? 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if ((alpha[i] ?? 0) === 0) continue
      const clear =
        ((alpha[i - 1] ?? 0) === 0 ? 1 : 0) +
        ((alpha[i + 1] ?? 0) === 0 ? 1 : 0) +
        ((alpha[i - w] ?? 0) === 0 ? 1 : 0) +
        ((alpha[i + w] ?? 0) === 0 ? 1 : 0)
      if (clear > 0) d[i * 4 + 3] = Math.round(255 * (1 - clear / 6))
    }
  }
  ctx.putImageData(img, 0, 0)
  return cleared / n
}

/**
 * Is this photograph a figure that can stand on the card, or a picture of a
 * room with somebody in it?
 *
 * THIS REPLACES A HEURISTIC THAT WAS SIMPLY WRONG. It used to ask whether the
 * image was taller than it was wide, on the reasoning that a cut-out portrait
 * is tall. So it is; so is a 293 by 450 snapshot of a party leader standing in
 * front of a mural, and that one went down the cut-out path, was drawn with no
 * fades at all because a cut-out needs none, and landed on the poster as a hard
 * grey rectangle covering half the card. Aspect ratio cannot answer this
 * question. Whether there is a background to remove can only be found by
 * looking for one.
 *
 * So: knock the backdrop out of a small copy and see how much came away. A
 * studio portrait loses a quarter to a half of its frame; a photograph taken at
 * an event loses almost nothing, because a stage and a crowd are not white.
 * Anything already carrying transparency is a real cut-out and says so at once.
 *
 * Measured at 120 pixels wide, which is about eighteen thousand pixels and
 * costs nothing, and held per image because the answer cannot change.
 */
type FigureKind = 'cutout' | 'photo'
const FIGURE_KIND = new Map<string, FigureKind>()

function figureKind(img: HTMLImageElement): FigureKind {
  const held = FIGURE_KIND.get(img.src)
  if (held) return held
  let kind: FigureKind = 'photo'
  const cw = 120
  const ch = Math.max(1, Math.round((cw * img.naturalHeight) / Math.max(1, img.naturalWidth)))
  const probe = document.createElement('canvas')
  probe.width = cw
  probe.height = ch
  const c = probe.getContext('2d', { willReadFrequently: true })
  if (c) {
    c.drawImage(img, 0, 0, cw, ch)
    let transparent = 0
    try {
      const px = c.getImageData(0, 0, cw, ch).data
      for (let i = 3; i < px.length; i += 4) if ((px[i] ?? 255) < 24) transparent++
    } catch {
      /* tainted: fall through to the knockout test, which will also fail
         quietly and leave this a photo, which is the safe answer */
    }
    // An eighth of the frame already transparent is a PNG somebody cut out.
    if (transparent / (cw * ch) > 0.12) kind = 'cutout'
    else if (knockOutBackdrop(c, cw, ch) > 0.1) kind = 'cutout'
  }
  FIGURE_KIND.set(img.src, kind)
  return kind
}

/**
 * Cut-out figures, kept between redraws.
 *
 * The poster is redrawn on every keystroke in the copy fields, and a flood fill
 * over a million pixels on each of those would make typing stutter. The result
 * depends only on the photograph and the size it is drawn at, neither of which
 * changes while somebody types, so it is computed once and held. Six is enough
 * for every figure on a card at both the sizes a card uses, and the oldest goes
 * when a seventh arrives, so a desk that tries twenty photographs does not
 * accumulate twenty canvases.
 */
const CUTOUTS = new Map<string, HTMLCanvasElement>()
const CUTOUT_CAP = 6

/**
 * A portrait faded out at its foot and at its inner edge, so it stands on the
 * field instead of sitting in a box on it.
 *
 * The office supplies whatever photograph it has, which is a square avatar with
 * a background in it. A hoarding cuts its figures out; this cannot, so it does
 * the next honest thing and dissolves the edges rather than ruling a rectangle
 * round somebody's shoulders and calling it a design.
 *
 * The fade is cut on a scratch canvas and composited, which is what makes it
 * work over ANY ground. Erasing straight onto the poster would take the field
 * out along with the photograph, and fading to a flat colour would leave a pale
 * rectangle wherever the ground behind it was a gradient, which here it always
 * is. The scratch is sized in device pixels off the live transform, so the
 * composite is as sharp as everything drawn beside it.
 */
function fadedFigure(
  s: Scene,
  img: HTMLImageElement,
  x: number,
  y: number,
  cw: number,
  ch: number,
  inner: 'left' | 'right' | null,
  /**
   * False for a figure that runs off the bottom edge of the card.
   *
   * A leader standing at the foot of a poster is CUT by the frame, not faded
   * into it, and fading one that reaches the edge makes them look as though
   * they are dissolving into the floor. False also turns off the fade at the
   * TOP, for the same reason: a figure whose box starts at the top of the card
   * has no edge there to soften.
   */
  footFade = true,
): void {
  const { ctx } = s
  const k = ctx.getTransform().a || 1
  const pw = Math.max(1, Math.round(cw * k))
  const ph = Math.max(1, Math.round(ch * k))
  const key = `${img.src}|${pw}x${ph}|${inner ?? 'none'}|${footFade ? 'f' : 'c'}`
  const held = CUTOUTS.get(key)
  if (held) {
    ctx.drawImage(held, x, y, cw, ch)
    return
  }
  const off = document.createElement('canvas')
  off.width = pw
  off.height = ph
  const o = off.getContext('2d', { willReadFrequently: true })
  // No scratch context is not a reason to lose the figure. A hard edge is worse
  // than a fade and a great deal better than a hole.
  if (!o) {
    drawCover(ctx, img, x, y, cw, ch)
    return
  }
  drawCover(o, img, 0, 0, pw, ph)
  knockOutBackdrop(o, pw, ph)
  o.globalCompositeOperation = 'destination-out'
  if (footFade) {
    const foot = o.createLinearGradient(0, ph * 0.52, 0, ph)
    foot.addColorStop(0, 'rgba(0, 0, 0, 0)')
    foot.addColorStop(1, 'rgba(0, 0, 0, 1)')
    o.fillStyle = foot
    o.fillRect(0, 0, pw, ph)
    // The top as well, and this is the one that was missing. A square avatar
    // dropped into the middle of a card has FOUR edges, and softening three of
    // them leaves a hard horizontal line across the top of somebody's head that
    // reads, correctly, as the edge of a photograph pasted on.
    const cap = o.createLinearGradient(0, 0, 0, ph * 0.16)
    cap.addColorStop(0, 'rgba(0, 0, 0, 0.85)')
    cap.addColorStop(1, 'rgba(0, 0, 0, 0)')
    o.fillStyle = cap
    o.fillRect(0, 0, pw, ph)
  }
  if (inner === null) {
    CUTOUTS.set(key, off)
    ctx.drawImage(off, x, y, cw, ch)
    return
  }
  // The inner edge only. The outer one runs off the card and needs no help.
  const side = o.createLinearGradient(
    inner === 'right' ? pw : 0,
    0,
    inner === 'right' ? pw * 0.78 : pw * 0.22,
    0,
  )
  // Fully opaque at the edge, not nearly. At 0.72 the last quarter of the
  // photograph survived and printed a hard vertical line down the field, which
  // is the exact seam this function exists to avoid.
  side.addColorStop(0, 'rgba(0, 0, 0, 1)')
  side.addColorStop(1, 'rgba(0, 0, 0, 0)')
  o.fillStyle = side
  o.fillRect(0, 0, pw, ph)
  if (CUTOUTS.size >= CUTOUT_CAP) {
    const oldest = CUTOUTS.keys().next().value
    if (oldest !== undefined) CUTOUTS.delete(oldest)
  }
  CUTOUTS.set(key, off)
  ctx.drawImage(off, x, y, cw, ch)
}


/**
 * A straight tricolour bar, for a card that wants the national colours as a
 * rule rather than as a sweep across the middle.
 *
 * The bands overlap by a pixel because three rects stacked on a fractional
 * band height leave hairline gaps at some canvas widths, and a gap between
 * saffron and white on a poster reads as a printing fault.
 */
function flagBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bw: number,
  bh: number,
): void {
  const band = bh / TRICOLOUR.length
  TRICOLOUR.forEach((colour, i) => {
    ctx.fillStyle = colour
    ctx.fillRect(x, y + i * band, bw, band + (i < TRICOLOUR.length - 1 ? 1 : 0))
  })
}


/* ===========================================================================
   The worker card

   The shape fifteen of the owner's sixteen reference posters are cut from, and
   the one an Indian party office actually publishes most days of the year.
   =========================================================================== */

/**
 * WHO IS THE SUBJECT, AND WHY IT CHANGES HERE.
 *
 * The ten templates this file used to carry put the desk owner at the centre
 * of every card and anybody else small. These do the opposite: the party's
 * national figure stands large at the lower left and the member is a small
 * circle on the right over their own name. That is not a slip, it is the
 * genre. These are karyakarta cards, the greeting a party worker posts on a
 * festival morning, and the whole point of one is that the worker greets the
 * public ALONGSIDE the party rather than in place of it. A card of this kind
 * with the local member's face at the centre and the party leader in a
 * thumbnail would read, to anybody in the constituency, as somebody promoting
 * themselves on a festival.
 *
 * What does NOT change is the rule underneath: exactly one signature, and it
 * is the desk owner's. The bar at the foot carries `input.name` and
 * `input.designation` and there is no second slot on the card for anybody
 * else's name, so a face on this poster is a face and never becomes an
 * attributed quotation.
 *
 * THE NUMBERS ARE MEASURED, NOT CHOSEN. Every position below was taken off the
 * owner's reference sheet, fifteen cards their office would actually buy,
 * scaled from the sheet's cards into this 1080 by 1350 frame. That is why they
 * are not round, and it is the whole reason this family replaced the ten that
 * were designed from a description instead.
 */

/**
 * THINGS THAT HAVE A COLOUR OF THEIR OWN KEEP IT.
 *
 * The ground of these cards is the desk's party colour, and that is where the
 * party colour stops. It was not obvious enough: the first saffron ground turned
 * the WHITE BAND OF THE NATIONAL FLAG saffron, because the tricolour ornament
 * paints saffron and green and lets the card's paper show through between them,
 * and the paper was no longer white. On a poster going out under a Member of
 * Parliament's name, that is not a styling slip.
 *
 * So the rule, and it applies to anything added here later. A party's ground,
 * bands, rules and marks take the party's colour. Anything that exists in the
 * world with a colour of its own is drawn in that colour: the flag is saffron,
 * WHITE and green whatever the card is; a monument is the colour of its stone;
 * a diya's flame is the colour of fire. A crowd is the exception that proves
 * it, and only because a crowd at a party rally really is dressed in the
 * party's colour.
 */

/**
 * The national colours as palettes, so a wash can be asked for in saffron or in
 * green without the party's own colour reaching it.
 *
 * The ornaments take a palette and paint themselves from it, which is what lets
 * one wash serve sixteen parties. It is also what makes these two necessary:
 * asked for a tricolour, the card must hand it the tricolour's colours and not
 * its own, or a Congress desk gets a green flag and a BJP desk an orange one.
 */
const SAFFRON_INK: Ink = {
  bg: '#ff9933',
  accent: '#d2691e',
  accent2: null,
  ink: '#1e1205',
  onAccent: '#ffffff',
}
const GREEN_INK: Ink = {
  bg: '#138808',
  accent: '#0c5c05',
  accent2: null,
  ink: '#ffffff',
  onAccent: '#ffffff',
}

/** Sandstone, for a monument or a skyline. Nobody's party, and not meant to be. */
const STONE: Ink = {
  bg: '#e2d3bb',
  accent: '#93795a',
  accent2: null,
  ink: '#4a3d2c',
  onAccent: '#ffffff',
}

/** The mark at the head of every card. */
const MARK_CY = 118
const MARK_D = 150
/** The message column: centred right of the standing figure, not on the card. */
const HEAD_CX = 648
const HEAD_W = 632
/**
 * The member, on the right.
 *
 * The reference sheet draws this circle small, and small was wrong for this
 * desk: on the sheet it is a placeholder captioned "your photo here", printed
 * at a size that says "somebody will drop a face in". On a real card it is the
 * member of parliament whose name is under it, and the whole reason the office
 * publishes the poster. Half again the sheet's size still leaves the party's
 * figure the larger of the two, which is the hierarchy the genre wants, and it
 * makes the face recognisable at the size these are actually seen: a thumbnail
 * in somebody's feed.
 */
const PHOTO_CX = 828
const PHOTO_CY = 872
const PHOTO_D = 320
/** The one signature. */
const BAR_X = 596
const BAR_W = 416
const BAR_Y = 1188
const BAR_H = 62

/**
 * Letter-spaced type, where the platform will do it.
 *
 * The small line over the greeting is set in caps and tracked open, which is
 * what stops "HAPPY" over "Diwali" reading as a mistake rather than as a
 * decision. `letterSpacing` on a canvas context is recent, and where it is
 * missing the line simply sets untracked, which is a slightly tighter word and
 * not a broken card, so there is no fallback worth writing.
 */
function tracked(ctx: CanvasRenderingContext2D, px: number, draw: () => void): void {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  const had = c.letterSpacing
  if (had !== undefined) c.letterSpacing = `${px}px`
  draw()
  if (had !== undefined) c.letterSpacing = had
}

/** A hairline rule inset from the edge, the frame a festival card carries. */
function hairlineFrame(ctx: CanvasRenderingContext2D, w: number, h: number, ink: string): void {
  ctx.save()
  ctx.strokeStyle = ink
  ctx.lineWidth = 2
  ctx.strokeRect(22, 22, w - 44, h - 44)
  ctx.lineWidth = 1
  ctx.strokeRect(31, 31, w - 62, h - 62)
  ctx.restore()
}

/**
 * The card, drawn once for all five.
 */
function drawWorkerCard(s: Scene, spec: CardSpec): void {
  const { ctx, w, h, p, input, photo, leaders } = s

  // ── the paper ───────────────────────────────────────────────────────────
  // THE GROUND IS THE PARTY'S OWN COLOUR, not white with a hint of it. The
  // first version mixed five per cent of the party colour into white and the
  // result read as white, which is not what a saffron party's card looks like.
  // A third of the way to the party colour is a ground somebody would call
  // bhagwa on a BJP desk, green on a Congress one and blue on an AAP one, and
  // it is still light enough to carry dark type at better than ten to one.
  //
  // Two tones, not one: the deeper mix over the whole card and the lighter one
  // lifted behind the message. A single flat tint at this strength turns the
  // paragraph under the greeting into small dark type on a mid field, which is
  // where a card starts being hard to read on a phone. The lift keeps the
  // reading area near the pale end and lets the edges carry the colour.
  const tint = spec.paper === 'ivory' ? 0.34 : 0.24
  const paper = mix('#ffffff', p.bg, tint)
  const deeper = mix('#ffffff', p.bg, Math.min(0.72, tint + 0.24))
  ctx.fillStyle = deeper
  ctx.fillRect(0, 0, w, h)
  const lift = ctx.createRadialGradient(w * 0.56, h * 0.3, 90, w * 0.56, h * 0.3, h * 0.82)
  lift.addColorStop(0, paper)
  lift.addColorStop(0.5, paper)
  lift.addColorStop(1, soft(paper, 0))
  ctx.fillStyle = lift
  ctx.fillRect(0, 0, w, h)

  // The ink is the party's accent taken almost to black. A neutral grey would
  // work and would look like every other piece of software; a very dark saffron
  // on warm ivory is what a printer would have mixed.
  const ink = mix(p.accent, '#000000', 0.62)
  const accent = p.accent
  const second = p.accent2 ?? p.accent
  // The template's own palette declares accent2 optional and the ornament kit
  // does not, because an ornament always has to know whether a second colour
  // exists and "absent" and "null" are the same answer to it.
  const kit: Ink = { ...p, accent2: p.accent2 ?? null }

  const box = (
    x: number,
    y: number,
    bw: number,
    bh: number,
    alpha?: number,
    seed?: number,
    ink: Ink = kit,
  ) => ({
    x,
    y,
    w: bw,
    h: bh,
    p: ink,
    ...(alpha === undefined ? {} : { alpha }),
    ...(seed === undefined ? {} : { seed }),
  })

  // Faint. The grain is here to stop a flat fill reading as a flat fill, and
  // the moment anybody can SEE it as speckle it has gone from paper to noise.
  drawPaperGrain(ctx, box(0, 0, w, h, 0.35, 3))

  // ── what is laid on the paper before anything is set on it ──────────────
  if (spec.behind === 'mandala') {
    drawMandalaCorner(ctx, box(w - 500, -70, 500, 500, 0.9, 5))
    drawMandalaCorner(ctx, box(-70, h - 500, 500, 500, 0.7, 9))
  } else if (spec.behind === 'tricolour-top') {
    // WHITE PAPER FIRST. The tricolour wash paints saffron and green and leaves
    // the middle for the ground to show through, which is exactly right on
    // white paper and produces a flag with a saffron centre band on a saffron
    // card. The card owes the flag its white, so the card lays it: a white
    // field over the band, feathered top and bottom so it reads as paper
    // showing rather than as a white rectangle ruled across the poster.
    // The white runs deeper than the wash does, so the mark and the greeting
    // both sit on paper rather than on the green. That is how the reference
    // card is built and it is also the protocol: this is the flag's white, and
    // the flag's white is not the card's to tint.
    const band = ctx.createLinearGradient(0, 0, 0, 470)
    band.addColorStop(0, soft('#ffffff', 0.98))
    band.addColorStop(0.6, soft('#ffffff', 0.98))
    band.addColorStop(1, soft('#ffffff', 0))
    ctx.fillStyle = band
    ctx.fillRect(0, 0, w, 470)
    // TWO CORNER BLEEDS, not a stack of bands. `drawTricolourWash` lays its
    // saffron along the top of its box and its green along the FOOT of the
    // same box, which is a flag when the box is the whole card and a pair of
    // horizontal stripes when the box is only the head of one. The reference
    // card washes saffron in from the top left and green in from the top right
    // and leaves paper between them, so that is what this asks for, in the
    // flag's colours rather than the desk's.
    drawWashTopLeft(ctx, box(0, 0, 660, 330, 0.92, 4, SAFFRON_INK))
    drawWashTopRight(ctx, box(w - 660, 0, 660, 330, 0.92, 6, GREEN_INK))
  } else if (spec.behind === 'corner-pair') {
    drawWashTopLeft(ctx, box(0, 0, 720, 460, 0.85, 2))
    drawWashBottomLeft(ctx, box(0, h - 520, w, 520, 0.7, 6))
  }
  if (spec.top === 'bunting') {
    drawWashTopRight(ctx, box(w - 620, 0, 620, 380, 0.55, 8))
    // Confined to the head of the card and drawn UNDER everything. The first
    // version scattered it over the whole poster, which put a paper streamer
    // across the prime minister's face and two more through the greeting.
    // Decoration that lands on a face is not decoration.
    drawConfetti(ctx, box(0, 60, w, 300, 0.45, 6))
    // Top LEFT, in the corner above where the figure begins and left of where
    // the words begin. On the right they sat squarely on the greeting, which
    // is the same mistake as the confetti and was just as visible.
    drawBalloons(ctx, box(48, 104, 300, 330, 1, 4))
    // Before the mark, not after. The mark sits at the head of every card and
    // a string of flags drawn over it hides the one thing that says whose
    // poster this is.
    drawBunting(ctx, box(0, 0, w, 150, 1, 7))
  }

  // ── the illustration behind the message ─────────────────────────────────
  // Below the message and clear of the member's circle on the right. Drawn
  // before a word is set, so if it ever does collide it collides behind rather
  // than over. Both are set in STONE and not in the party's colour: a
  // ceremonial arch is sandstone whoever is publishing the card.
  if (spec.centre === 'monument') drawMonument(ctx, box(388, 600, 272, 320, 0.95, 1, STONE))
  else if (spec.centre === 'skyline') drawSkyline(ctx, box(390, 892, 690, 236, 0.42, 11, STONE))

  // ── the head: the mark, and the party's own name under it ───────────────
  const drew = drawMark(s, w / 2, MARK_CY, MARK_D, {
    ink: accent,
    plate: '#ffffff',
    ring: soft(accent, 0.85),
  })
  let head = drew ? MARK_CY + MARK_D / 2 + 20 : 96

  const partyLine = fit(ctx, clean(input.partyName), {
    maxWidth: w - 220,
    maxLines: 1,
    size: 27,
    minSize: 18,
    weight: 600,
    leading: 1.3,
  })
  if (partyLine.height > 0) head = paint(ctx, partyLine, w / 2, head, soft(ink, 0.8), 'center') + 6

  // ── the standing figure, lower left, cut by the frame ───────────────────
  const first = leaders[0]
  /** The right edge of whatever the figure occupies, so the words can clear it. */
  let figureRight = 0
  if (first) {
    // The box depends on WHAT THE OFFICE SUPPLIED, and this is the difference
    // between a poster and a mistake. A cut-out portrait, taller than it is
    // wide with its background removed, is what these cards are designed
    // around: it runs to the bottom edge and is cut by it, exactly as on a
    // hoarding. Most offices have a square avatar saved off a social account
    // instead, and forcing one of those into a tall box makes `drawCover` crop
    // a narrow strip through the middle of somebody's face. A square source
    // gets a square box, head and shoulders, faded at the foot so it sits on
    // the ground rather than ending in a straight cut across the chest.
    // TWO QUESTIONS, ANSWERED SEPARATELY, and keeping them apart is the point.
    //
    // WHAT SHAPE IS IT is answered by the picture's proportions, and it decides
    // the box. A near-square studio portrait gets a square box in the lower
    // left, head and shoulders; a tall picture gets a tall one. Deriving the
    // box from anything else went wrong twice: a fixed tall frame cropped a
    // square portrait to a strip through the middle of the prime minister's
    // face, and a frame that exactly matched the picture's ratio drew him
    // correctly and too small, because a poster wants a little crop into the
    // subject and a photograph is not composed for one.
    //
    // CAN ITS BACKGROUND BE REMOVED is a different question and it is measured
    // rather than guessed. It decides only the FADES: a figure whose backdrop
    // has come away stands on the card and is cut by the bottom edge, and one
    // that still has a room behind it is dissolved on every edge and drawn
    // smaller, so it reads as an inset rather than as a rectangle of somebody
    // else's stage pasted onto the poster.
    const tall = first.naturalHeight / Math.max(1, first.naturalWidth) > 1.3
    const cut = figureKind(first) === 'cutout'
    if (cut && tall) {
      fadedFigure(s, first, -26, 300, 560, h - 300, 'right', false)
      figureRight = 534
    } else if (cut) {
      // A shadow on the paper under the figure. Without it a portrait whose
      // white backdrop has just been removed sits at almost the value of the
      // ground and reads as a ghost rather than as somebody standing there.
      const glow = ctx.createRadialGradient(220, 1030, 30, 220, 1030, 430)
      glow.addColorStop(0, soft(ink, 0.2))
      glow.addColorStop(0.6, soft(ink, 0.09))
      glow.addColorStop(1, soft(ink, 0))
      ctx.fillStyle = glow
      ctx.fillRect(0, 620, 660, 730)
      fadedFigure(s, first, -40, 520, 600, 700, 'right', true)
      figureRight = 366
    } else {
      // Run the left edge off the card. `fadedFigure` softens the inner edge,
      // the top and the foot, which leaves the outer one, and an inset placed
      // clear of the frame shows that one as a hard vertical line down the side
      // of the photograph. Off the edge there is nothing to show.
      fadedFigure(s, first, -34, 566, 470, 560, 'right', true)
      figureRight = 436
    }
  }

  // ── the message ─────────────────────────────────────────────────────────
  // THE WORDS START WHERE THE FIGURE STOPS. They used to be centred on a fixed
  // column, which was right for a narrow cut-out and wrong the moment the
  // figure was wider, and the greeting then ran across somebody's shoulder. A
  // little overlap onto the faded inner edge is deliberate and reads as depth;
  // running over the face does not.
  const textLeft = figureRight > 0 ? Math.max(figureRight - 34, 332) : 96
  const textW = Math.min(HEAD_W, w - textLeft - 64)
  const textCx = textLeft + textW / 2

  let y = head + 40

  const eyebrow = fit(ctx, clean(input.eyebrow), {
    maxWidth: textW,
    maxLines: 1,
    size: 44,
    minSize: 24,
    weight: 700,
    leading: 1.2,
    face: spec.face === 'script' ? 'body' : spec.face,
  })
  if (eyebrow.height > 0) {
    // Tracked open and set in the plain face even on a script card. A script
    // capital tracked out at 44 points is illegible, and the reference sets its
    // little word in a plain face for exactly that reason.
    tracked(ctx, 5, () => {
      y = paint(ctx, eyebrow, textCx, y, soft(ink, 0.88), 'center') + 6
    })
  }

  const headline = fit(ctx, input.headline, {
    maxWidth: textW,
    maxLines: 4,
    maxHeight: 330,
    size: spec.face === 'script' ? 118 : 92,
    minSize: 46,
    weight: 700,
    leading: spec.face === 'script' ? 1.02 : 1.14,
    face: spec.face,
  })
  // The rhythm of the colours down the greeting. `two-tone` ends on the party's
  // colour, which is what "Happy" in dark over "Diwali" in saffron is doing on
  // the reference sheet. `alternating` runs dark, accent, dark, second down
  // four lines, which is the Hindi slogan card.
  const rhythm =
    spec.rhythm === 'plain'
      ? [ink]
      : spec.rhythm === 'alternating'
        ? [ink, accent, ink, second]
        : [ink, accent]
  y = paintLines(ctx, headline, textCx, y, rhythm, 'center')

  const body = fit(ctx, input.body, {
    maxWidth: textW - 60,
    maxLines: 4,
    maxHeight: 210,
    size: 29,
    minSize: 21,
    weight: 400,
    leading: 1.5,
  })
  if (body.height > 0) paint(ctx, body, textCx, y + 26, soft(ink, 0.78), 'center')

  // ── the foot, in front of the figure ────────────────────────────────────
  if (spec.foot === 'diyas') {
    drawMarigolds(ctx, box(96, 1150, 200, 170, 1, 12))
    drawDiyaRow(ctx, box(150, 1120, 430, 210, 1, 5))
  } else if (spec.foot === 'crowd') {
    // Low. A crowd is a BASE for the card, not a subject in it, and every
    // pixel it climbs is a pixel of somebody's designation it eats.
    drawCrowd(ctx, box(0, h - 168, w, 168, 1, 5))
  } else if (spec.foot === 'flagwave') {
    drawFlagWave(ctx, box(0, h - 190, w, 190, 1, 3))
  } else if (spec.foot === 'balloons') {
    drawCake(ctx, box(422, 1074, 280, 250, 1, 2))
  }

  // ── the member, small, over their own name ──────────────────────────────
  // A white plate behind it before the ring, so a portrait with a busy
  // background still reads as a portrait on a coloured ground.
  ctx.save()
  ctx.beginPath()
  ctx.arc(PHOTO_CX, PHOTO_CY, PHOTO_D / 2 + 9, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()
  disc(ctx, photo, PHOTO_CX, PHOTO_CY, PHOTO_D, {
    ring: soft(accent, 0.65),
    ringWidth: 7,
    fill: soft('#ffffff', 0.9),
    label: initials(input.name),
    labelInk: soft(ink, 0.5),
  })

  // ── the one signature ───────────────────────────────────────────────────
  const name = fit(ctx, input.name, {
    maxWidth: BAR_W - 34,
    maxLines: 1,
    size: 36,
    minSize: 22,
    weight: 700,
    leading: 1.2,
  })
  if (name.height > 0) {
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, 6)
    ctx.fill()
    paint(ctx, name, BAR_X + BAR_W / 2, BAR_Y + (BAR_H - name.height) / 2, p.onAccent, 'center')
  }
  const role = fit(ctx, input.designation, {
    maxWidth: BAR_W,
    maxLines: 2,
    size: 24,
    minSize: 17,
    weight: 500,
    leading: 1.34,
  })
  if (role.height > 0) {
    // A pale plate under it, but ONLY where something is standing behind it.
    // Three of the five cards put a crowd silhouette or a tricolour band across
    // the foot and dark grey type on either is type nobody can read. On the
    // other two the ground is the card's own colour, and a plate there is a
    // white box round the designation that everybody can see and nobody asked
    // for. It used to be drawn on all five, which was invisible while the
    // ground was white and became a box the moment the ground became saffron.
    if (spec.foot === 'crowd' || spec.foot === 'flagwave') {
      const rw = role.lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0)
      ctx.fillStyle = soft(paper, 0.9)
      ctx.beginPath()
      ctx.roundRect(
        BAR_X + BAR_W / 2 - Math.min(BAR_W, rw + 28) / 2,
        BAR_Y + BAR_H + 6,
        Math.min(BAR_W, rw + 28),
        role.height + 14,
        5,
      )
      ctx.fill()
    }
    paint(ctx, role, BAR_X + BAR_W / 2, BAR_Y + BAR_H + 13, soft(ink, 0.78), 'center')
  }

  // ── depth, last, over everything ────────────────────────────────────────
  // A vignette in the party's deep tone. Every card in the reference sheet is
  // darker at its edges than at its middle, and it is what stops a printed
  // poster reading as a flat fill with things arranged on it. Kept under a
  // tenth: past that it stops being depth and starts being a filter.
  const vignette = ctx.createRadialGradient(w / 2, h * 0.42, h * 0.34, w / 2, h * 0.42, h * 0.86)
  vignette.addColorStop(0, soft(accent, 0))
  vignette.addColorStop(1, soft(accent, 0.09))
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, w, h)

  if (spec.paper === 'ivory') hairlineFrame(ctx, w, h, soft(accent, 0.35))
}

/** One drawing routine per card, bound to its own row. */
function workerRoutine(id: string): ((s: Scene) => void) | null {
  const spec = WORKER_CARDS.find((c) => c.id === id)
  return spec ? (s: Scene): void => drawWorkerCard(s, spec) : null
}

/**
 * Which drawing routine runs.
 *
 * Falls back to the banner rather than throwing, because a saved poster keeps
 * only its `templateId` and a template can be renamed or retired between
 * releases. A card the desk can still read beats an empty frame.
 */
function routine(id: string): (s: Scene) => void {
  const worker = workerRoutine(id)
  // A saved poster keeps only its `templateId`, and this product has already
  // retired one whole generation of templates. A card whose row is gone falls
  // back to the first one rather than throwing, because a poster the office can
  // still read beats an empty frame and a stack trace.
  return worker ?? ((s: Scene): void => drawWorkerCard(s, WORKER_CARDS[0]!))
}

/* ===========================================================================
   Rendering
   =========================================================================== */

/**
 * Everything above is laid out in a 1080-wide space, whatever the canvas is.
 *
 * The alternative, laying out in the canvas's own pixels, would make every
 * padding and type size in this file a fraction of the width, and the preview
 * and the export would then be running slightly different arithmetic on
 * different numbers. One design space with a single scale on the context means
 * the preview is the export, scaled.
 */
const DESIGN_W = 1080

/** Twice the design width is as sharp as any screen can show. Past it is memory for nothing. */
const MAX_BACKING = DESIGN_W * 2

async function renderTo(
  canvas: HTMLCanvasElement,
  input: PosterInput,
  backingW: number,
): Promise<PosterRender> {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw the poster. Try a different browser.')

  const frame = input.size ?? POSTER_SIZE
  const designH = Math.round((DESIGN_W * frame.h) / frame.w)
  const scale = backingW / DESIGN_W

  canvas.width = Math.max(1, Math.round(backingW))
  canvas.height = Math.max(1, Math.round(designH * scale))

  // The party furniture goes into the sample too. A short party name or a
  // standing line in Telugu needs its face resident before the first paint
  // exactly as the headline does, and if this machine has no face for it the
  // studio should say so rather than let the band render as a row of boxes.
  const text = `${input.headline}\n${input.body}\n${input.name}\n${input.designation}\n${clean(
    input.partyShort,
  )}\n${clean(input.slogan)}`
  // Every image the poster might carry is loaded in one pass, and every one of
  // them resolves null rather than rejecting, so a mark or a leader portrait
  // that has been moved or deleted since the desk set it up costs that slot and
  // nothing else. The leaders are collapsed to the ones that arrived here, at
  // the single point where it can be done once for every template.
  const [photo, mark, leader1, leader2] = await Promise.all([
    loadPhoto(input.photoUrl),
    loadPhoto(input.partyMarkUrl ?? null),
    loadPhoto(input.leaderUrl ?? null),
    loadPhoto(input.leader2Url ?? null),
    ensureFaces(text),
  ])

  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.clearRect(0, 0, DESIGN_W, designH)
  routine(input.template.id)({
    ctx,
    w: DESIGN_W,
    h: designH,
    // The desk's own colours win over the template's, which is what lets one
    // set of party layouts serve an office of any party.
    p: input.palette ?? input.template.palette,
    input,
    photo,
    mark,
    leaders: [leader1, leader2].filter((i): i is HTMLImageElement => i !== null),
  })
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  return {
    photo: input.photoUrl ? (photo ? 'drawn' : 'unavailable') : 'none',
    glyphsCovered: hasGlyphCoverage(text),
  }
}

/**
 * Draw into a canvas, and report what happened while drawing it.
 *
 * `drawPoster` is the contracted call and returns nothing; this one exists so
 * the studio can tell the office that the photograph they chose could not be
 * loaded, or that this machine has no face for the script they typed. Neither
 * is worth an exception, and both are worth a line on the screen.
 *
 * A canvas that has been laid out is drawn at its CSS width times the device
 * pixel ratio, so the preview is not soft on a phone. A detached one, which is
 * how `posterBlob` and `posterThumbnail` use this, is drawn at the width they
 * ask for. Nothing here sets a CSS size: the caller owns the layout, and the
 * canvas element's intrinsic ratio comes from the attributes set below.
 */
export async function renderPoster(
  canvas: HTMLCanvasElement,
  input: PosterInput,
): Promise<PosterRender> {
  const css = canvas.clientWidth
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const backing = css > 0 ? Math.min(MAX_BACKING, Math.round(css * dpr)) : DESIGN_W
  return await renderTo(canvas, input, backing)
}

export async function drawPoster(canvas: HTMLCanvasElement, input: PosterInput): Promise<void> {
  await renderPoster(canvas, input)
}

/**
 * The file the office posts.
 *
 * Always the full design width, whatever the preview happens to be showing, and
 * always PNG: the extension is then predictable for the filename the caller
 * passes, and the pixels are the ones that were drawn rather than the ones a
 * JPEG encoder decided on.
 */
export async function posterBlob(input: PosterInput, kind: 'png' | 'jpg' = 'png'): Promise<Blob> {
  const canvas = document.createElement('canvas')
  await renderTo(canvas, input, DESIGN_W)
  // JPEG has no alpha, and a canvas is transparent wherever nothing was drawn.
  // Encoded straight, every transparent pixel comes out BLACK, which on a card
  // whose figure was cut out of its background would put a black silhouette
  // round somebody's head. So a JPEG is composited onto white first, on a
  // second canvas, leaving the PNG path exactly as it was.
  let out = canvas
  if (kind === 'jpg') {
    const flat = document.createElement('canvas')
    flat.width = canvas.width
    flat.height = canvas.height
    const fc = flat.getContext('2d')
    if (fc) {
      fc.fillStyle = '#ffffff'
      fc.fillRect(0, 0, flat.width, flat.height)
      fc.drawImage(canvas, 0, 0)
      out = flat
    }
  }
  return await new Promise<Blob>((resolve, reject) => {
    try {
      out.toBlob((blob) => {
        if (blob) resolve(blob)
        // A null blob is the encoder giving up, which on a card this size means
        // the device has run out of room for it.
        else reject(new Error('The poster could not be saved. Close a few tabs and try again.'))
        // 0.92 rather than the browser default of 0.8. These posters carry
        // large flat colour fields and fine gold rules, and JPEG puts visible
        // blocking into both below about 0.9. At 0.92 a card comes out around a
        // third of the PNG with nothing an eye can find.
      }, kind === 'jpg' ? 'image/jpeg' : 'image/png', kind === 'jpg' ? 0.92 : undefined)
    } catch {
      // `toBlob` throws rather than returning null when the canvas is tainted.
      // `loadPhoto` sets crossOrigin precisely so this cannot happen, so if it
      // does the photograph is the only candidate, and the desk needs to hear
      // which half of the poster to change.
      reject(
        new Error(
          'The poster could not be saved because the photograph came from another site. Upload the photograph from this device and try again.',
        ),
      )
    }
  })
}

/**
 * A small JPEG data URL of the same poster, for the saved list.
 *
 * Deliberately narrow and lossy. A saved poster lives in localStorage, which is
 * a few megabytes for the whole desk, and full size PNG data URLs would spend
 * the lot on three of them. This is a picture of a poster in a list, not the
 * poster.
 */
export async function posterThumbnail(input: PosterInput, width = 360): Promise<string> {
  const canvas = document.createElement('canvas')
  await renderTo(canvas, input, Math.max(120, Math.round(width)))
  return canvas.toDataURL('image/jpeg', 0.82)
}

/**
 * Hand the blob to the browser as a download.
 *
 * The same anchor dance as `saveBlob` in xlsx.ts, including the delayed revoke:
 * revoking immediately cancels the download in Safari. The filename is cleaned
 * on the way through because the studio builds it from the headline, and a
 * headline with a colon or a slash in it is a filename Windows refuses.
 */
export function downloadPoster(blob: Blob, filename: string): void {
  const stem =
    filename
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\.(png|jpe?g)$/i, '')
      .slice(0, 80)
      .trim() || 'poster'
  const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png'

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${stem}.${ext}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
