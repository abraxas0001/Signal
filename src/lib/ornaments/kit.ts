/**
 * The ornament kit: what every piece of poster decoration is handed, and the
 * rules it draws by.
 *
 * WHY THESE ARE DRAWN AND NOT SHIPPED. A political poster in India is carried
 * by its decoration: diyas along the foot at Diwali, a crowd with flags under a
 * slogan, lanterns overhead, a mandala in the corner. The obvious way to get
 * those is a folder of stock images, and it is the wrong way three times over.
 * A stock image belongs to somebody, and this product's source is public. It
 * arrives at one size and goes soft when a poster is exported at another. And
 * it arrives in one set of colours, so the same diya that suits a saffron card
 * is wrong on a green one and wrong again on a blue one.
 *
 * Everything in this folder is arithmetic instead. It costs nothing to
 * redistribute, it is sharp at any export size, and it takes the desk's own
 * party colours as an argument, so one ornament serves every office.
 *
 * THE RULES, and they are not suggestions:
 *
 *   1. Draw inside the box you are given and nowhere else. A caller has
 *      already worked out that the space is free; an ornament that spills is
 *      an ornament that lands on somebody's face.
 *   2. Leave the context as you found it. save() first, restore() last, and no
 *      stray fillStyle, globalAlpha, shadow or transform left behind.
 *   3. Take your colours from `p`. Nothing in here hardcodes saffron.
 *   4. Draw no party's symbol, no state emblem, and no Ashoka Chakra. The
 *      national colours as bands are fine and are used elsewhere in this
 *      product; the wheel is not, and neither is anybody's lotus, hand or
 *      broom. A symbol drawn from memory is a party's emblem drawn wrong and
 *      published under a member's name.
 *   5. Be legible at 1080 wide and still be legible in a 360 wide preview.
 */

/** The palette an ornament paints itself in. The same shape the poster uses. */
export interface Ink {
  /** The party colour at poster strength. */
  bg: string
  /** That colour darkened, for bands, rules and emphasis. */
  accent: string
  /** A genuine second party colour, or null where a party has only one. */
  accent2: string | null
  /** Body text on the light field. */
  ink: string
  /** Text on the accent band. */
  onAccent: string
}

export interface OrnamentOptions {
  /** Left edge of the box. */
  x: number
  /** Top edge of the box. */
  y: number
  /** The box, in the 1080-wide design space the poster lays out in. */
  w: number
  h: number
  /** The desk's own colours. */
  p: Ink
  /** 0 to 1, applied to the whole piece. Defaults to 1. */
  alpha?: number
  /**
   * A number the caller varies to get a different arrangement of the same
   * ornament, where an ornament has more than one. Deterministic: the same
   * seed must always draw the same thing, because a poster that reshuffles
   * itself on every keystroke is a poster nobody can work on.
   */
  seed?: number
}

export type Ornament = (ctx: CanvasRenderingContext2D, o: OrnamentOptions) => void

/**
 * A hex colour at an alpha, as `rgba()`.
 *
 * Canvas has no notion of a colour with an opacity modifier, so every faded
 * ink in this product goes through here. Returns the input unchanged if it is
 * not a hex triple or sextuple, which is what keeps a caller passing a named
 * colour or an existing rgba() string from silently painting black.
 */
export function soft(hex: string, alpha: number): string {
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
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Two hex colours blended, `t` of the way from `a` to `b`. Returns a hex. */
export function mix(a: string, b: string, t: number): string {
  const part = (hex: string): [number, number, number] => {
    const n = hex.replace('#', '')
    const full =
      n.length === 3
        ? n
            .split('')
            .map((c) => c + c)
            .join('')
        : n
    return [
      parseInt(full.slice(0, 2), 16) || 0,
      parseInt(full.slice(2, 4), 16) || 0,
      parseInt(full.slice(4, 6), 16) || 0,
    ]
  }
  const [r1, g1, b1] = part(a)
  const [r2, g2, b2] = part(b)
  const k = Math.min(1, Math.max(0, t))
  const to = (v: number): string =>
    Math.round(v)
      .toString(16)
      .padStart(2, '0')
  return `#${to(r1 + (r2 - r1) * k)}${to(g1 + (g2 - g1) * k)}${to(b1 + (b2 - b1) * k)}`
}

/**
 * A deterministic pseudo-random sequence from a seed.
 *
 * An ornament that wants variety, a scatter of confetti or a crowd of
 * differing heights, must not reach for Math.random. The poster is redrawn on
 * every keystroke in the copy fields, and a random ornament would rearrange
 * itself under the office's hands while they typed. Seeded, the same poster
 * draws the same way every time and a different seed gives a different
 * arrangement, which is the only behaviour worth having.
 */
export function rng(seed: number): () => number {
  let s = (Math.floor(seed) || 1) >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Clamp, because half the ornaments need it and none of them should own it. */
export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v
