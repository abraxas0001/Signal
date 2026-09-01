/**
 * Grounds and frames: the layer every other ornament stands on.
 *
 * WHY THIS MODULE IS THE ONE THAT MATTERS. A festival card is a cream
 * rectangle, a portrait, a headline and a foot ornament. Fifteen of them built
 * from the same parts read as fifteen versions of one file unless something
 * underneath them differs, and on the reference sheets that something is always
 * the ground: a wash of the party colour bleeding in from a different corner, a
 * different corner filled with linework, a differently shaped band along the
 * foot. Everything in here is that layer.
 *
 * THE FAILURE THIS FILE IS WRITTEN AGAINST, and the one it fell into first.
 * The lazy way to get "a wash" is `createLinearGradient` and one fill, which is
 * instantly recognisable as software: a straight iso-line, a perfectly even
 * rate of change, and no edge at all. The first attempt here avoided that and
 * landed somewhere no better. It scattered two dozen soft radial gradients
 * along a line, on the theory that overlapping blobs would read as pigment.
 * They do not. Every one of those blobs fades to nothing at its own rim, so
 * their union fades to nothing everywhere, and the result was an airbrush
 * spray with a few pale ovals floating off it that looked like dust on the
 * lens. Rendered and looked at, it was obviously wrong.
 *
 * WHAT ACTUALLY MAKES A WASH READ AS ONE is the opposite of softness. Ink on
 * wet paper has a definite boundary; what it does not have is a SMOOTH one. The
 * boundary is torn, with bays and tongues at several scales at once, and the
 * pigment POOLS along it, so the darkest part of a wash is the last few
 * millimetres before it stops. So this builds the shape first, as a closed path
 * whose front edge is displaced by five octaves of seeded sine noise, fills it
 * near-opaque with a gradient running across the front, feathers it by only a
 * few pixels, and then strokes the same outline from inside a clip to lay the
 * pooled rim down. The mottle, the pale blooms and the spatter go on after.
 *
 * WHY EVERY WASH IS COMPOSED ON A SCRATCH CANVAS. The blooms are erased with
 * `destination-out`, which takes out whatever is already in the destination.
 * Doing that on the poster would take the cream ground with it and leave holes
 * through to the page. The scratch is sized in device pixels off the live
 * transform, the same way `fadedFigure` in poster.ts sizes its own, so a wash
 * composited into a 2x export is as sharp as the type beside it.
 *
 * AND WHY THE SCRATCH IS THEN KEPT. The studio redraws the whole poster on
 * every keystroke in the copy fields. Composing a wash costs about 69 ms at
 * 1080 by 1350 on this machine, which is affordable once and not affordable at
 * typing speed, so a composed wash is held against the box, the colours, the
 * direction and the scale that produced it, and a redraw that changed only the
 * headline becomes a single `drawImage` at about 0.02 ms. The cache is bounded,
 * because a session steps through templates and palettes and an unbounded one
 * would be a slow leak of full-size canvases.
 */

import { clamp, mix, rng, soft, type Ink, type Ornament, type OrnamentOptions } from './kit'

/* ===========================================================================
   Scratch canvases and the cache behind them
   =========================================================================== */

/**
 * Composed layers, keyed by everything that went into them.
 *
 * Twelve is chosen off the way the studio is actually used: a desk works on one
 * poster at a time, so the live working set is one wash, and the rest of the
 * room is there so that flipping back and forth between two templates or two
 * palettes does not rebuild on every flip. Past that the oldest entry goes.
 */
const LAYERS = new Map<string, HTMLCanvasElement>()
const LAYER_LIMIT = 12

/**
 * A composed layer for this box, built once and reused after that.
 *
 * `paint` is handed a context already in DESIGN space: it writes the same
 * numbers whether the poster is being previewed at 360 or exported at 2160, and
 * the scale lives only in the size of the bitmap underneath. Returns null when
 * the platform will not give a second 2D context, which is the caller's signal
 * to skip the ornament rather than to throw. Decoration is the one thing on
 * this poster that can be dropped without the office losing information.
 */
function layer(
  key: string,
  w: number,
  h: number,
  k: number,
  paint: (g: CanvasRenderingContext2D) => void,
): HTMLCanvasElement | null {
  const hit = LAYERS.get(key)
  if (hit) return hit
  if (typeof document === 'undefined') return null

  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k))
  c.height = Math.max(1, Math.round(h * k))
  const g = c.getContext('2d')
  if (!g) return null
  g.setTransform(k, 0, 0, k, 0, 0)
  paint(g)

  if (LAYERS.size >= LAYER_LIMIT) {
    const oldest = LAYERS.keys().next().value
    if (oldest !== undefined) LAYERS.delete(oldest)
  }
  LAYERS.set(key, c)
  return c
}

/** The live scale on the caller's context, which is what a scratch has to match. */
function scaleOf(ctx: CanvasRenderingContext2D): number {
  const k = Math.abs(ctx.getTransform().a)
  // A degenerate or absent transform reads as 1 rather than as zero. Zero would
  // size the scratch bitmap at nothing and the ornament would silently vanish,
  // which is far harder to notice than a wash drawn at design size.
  return k > 0.01 && Number.isFinite(k) ? k : 1
}

/**
 * A blur on the context, where the platform has one.
 *
 * `ctx.filter` is what feathers a wash edge by the few pixels that separate ink
 * on paper from a vector shape. Where it is missing the assignment is ignored
 * and the edge comes out crisp, which is the right way for this to degrade: a
 * hard-edged ragged wash still reads as paint, whereas the fallbacks that avoid
 * `filter` altogether, eroding the shape with repeated strokes or offsetting it
 * against itself, produce visible banding that looks like a bug.
 */
function blurred(g: CanvasRenderingContext2D, px: number): void {
  g.filter = px > 0 ? `blur(${px.toFixed(2)}px)` : 'none'
}

/* ===========================================================================
   Paper grain

   One tile, generated once for the life of the page, repeated as a pattern.
   =========================================================================== */

const GRAIN_TILE = 157

let grainTile: HTMLCanvasElement | null = null

/**
 * The grain tile.
 *
 * HOW THIS IS KEPT CHEAP, since a 1080 by 1350 preview redraws on every
 * keystroke. The obvious implementation walks 1.46 million pixels through
 * `ImageData` per redraw, which is tens of milliseconds and reads as lag in the
 * copy fields. This walks 24,649 pixels ONCE, ever, and every draw after that
 * is a `createPattern` plus one `fillRect` the compositor does. Measured in the
 * check harness on this machine, over a full 1080 by 1350 box: the first call
 * costs 2.3 ms including building the tile, and forty calls after it average
 * 0.02 ms each, which is a five-hundredth of a 60 Hz frame.
 *
 * 157 is prime and divides none of 1080, 1350 or the preview widths, so the
 * repeat never lands in step with the canvas and no seam reads as a grid.
 *
 * The speckle is half dark and half light in equal measure, on purpose. Noise
 * that is only dark is dirt: it drags a cream ground perceptibly grey, and the
 * larger the flat area the worse it looks. Balanced speckle leaves the mean
 * luminance where it was and reads as the tooth of the paper, which is the
 * thing being imitated.
 */
function grain(): HTMLCanvasElement | null {
  if (grainTile) return grainTile
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = GRAIN_TILE
  c.height = GRAIN_TILE
  const g = c.getContext('2d')
  if (!g) return null

  const img = g.createImageData(GRAIN_TILE, GRAIN_TILE)
  const d = img.data
  const r = rng(90210)
  for (let i = 0; i < d.length; i += 4) {
    const v = r() < 0.5 ? 0 : 255
    d[i] = v
    d[i + 1] = v
    d[i + 2] = v
    // Cubed, so most pixels are almost clear and a few carry the speck. Flat
    // random alpha gives an even hiss that reads as television static; the long
    // tail gives the sparse, uneven fleck that paper actually has.
    d[i + 3] = Math.round(r() ** 3 * 90)
  }
  g.putImageData(img, 0, 0)
  grainTile = c
  return c
}

/**
 * A very faint noise over the whole box, so a flat cream ground stops reading
 * as a flat digital fill.
 *
 * `o.alpha` scales it and the base is deliberately low: at this strength the
 * grain is invisible as texture and visible as the absence of plastic, which is
 * the whole point. Anything you can consciously see is too much on a poster
 * Facebook is going to recompress. It was set nearly three times higher to
 * begin with, which looked defensible on a swatch on its own and looked like
 * sensor noise the moment it was rendered over a whole card with a wash and a
 * band under it. A swatch is not the test; the stack is.
 *
 * The tile repeats in DESIGN pixels, not device pixels, so a speck is the same
 * size relative to the type in the preview and in the export. Pinning it to the
 * output resolution instead would make the exported file's texture finer than
 * the one the desk approved on screen, which is the drift poster.ts is built to
 * avoid.
 */
export const drawPaperGrain: Ornament = (ctx, o) => {
  const tile = grain()
  if (!tile) return
  ctx.save()
  ctx.translate(o.x, o.y)
  const pattern = ctx.createPattern(tile, 'repeat')
  if (pattern) {
    ctx.globalAlpha *= clamp(o.alpha ?? 1, 0, 1) * 0.3
    ctx.fillStyle = pattern
    ctx.fillRect(0, 0, o.w, o.h)
  }
  ctx.restore()
}

/** The grain laid only where the layer already has pigment, used inside a wash. */
function grainInto(g: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
  const tile = grain()
  if (!tile) return
  const pattern = g.createPattern(tile, 'repeat')
  if (!pattern) return
  g.globalCompositeOperation = 'source-atop'
  g.globalAlpha = alpha
  g.fillStyle = pattern
  g.fillRect(0, 0, w, h)
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'
}

/* ===========================================================================
   The wash
   =========================================================================== */

/**
 * Where a wash comes in from.
 *
 * `diag` is the sash the reference sheets run across a corner rather than a
 * bloom sitting in one; the other three are blooms anchored on a corner.
 */
type WashDir = 'tl' | 'tr' | 'bl' | 'diag'

/**
 * The line a wash is built along, and how far in front of it the pigment
 * reaches before the tearing starts.
 *
 * A corner bloom is modelled as a front, not as a point, and the difference is
 * the whole look. Pigment gathered around a POINT is a disc, and a disc laid
 * over a corner reads as a circle somebody drew there. Built along a line
 * cutting across the corner it is a front, which is what a wash running off two
 * edges of the paper is. The spine ends are pushed outside the box on purpose
 * and the shape is traced further past them again, so the wash is at full
 * strength where it meets the edge instead of tapering just before it.
 */
interface Spine {
  ax: number
  ay: number
  bx: number
  by: number
  /** The reach in front of the spine, before the noise multiplies it. */
  band: number
}

function spineFor(dir: WashDir, w: number, h: number): Spine {
  const m = Math.min(w, h)
  switch (dir) {
    case 'tl':
      return {
        ax: -0.14 * w,
        ay: 0.5 * h,
        bx: 0.56 * w,
        by: -0.16 * h,
        band: m * 0.15,
      }
    case 'tr':
      return {
        ax: 1.14 * w,
        ay: 0.5 * h,
        bx: 0.44 * w,
        by: -0.16 * h,
        band: m * 0.15,
      }
    case 'bl':
      return {
        ax: -0.14 * w,
        ay: 0.5 * h,
        bx: 0.56 * w,
        by: 1.16 * h,
        band: m * 0.15,
      }
    case 'diag':
      return {
        ax: -0.12 * w,
        ay: 1.02 * h,
        bx: 1.02 * w,
        by: -0.12 * h,
        band: m * 0.2,
      }
  }
}

/**
 * Five sine octaves with seeded phases and near-irrational frequency ratios,
 * summing to about one, with the fine three under a slow envelope.
 *
 * THE ENVELOPE IS THE PART THAT WAS LEARNED BY LOOKING. Without it the fine
 * octaves ripple at a constant amplitude the whole way along, and the rendered
 * edge came out as an even row of cog teeth, which is a doily rather than a
 * bleed. A torn edge is INTERMITTENT: long smooth stretches where the paper
 * took the ink evenly, then a busy patch where it did not. Multiplying the
 * three fine octaves by a slow sine, so their amplitude comes and goes across
 * the front, is what buys that, and it is the single change that took this from
 * looking machine cut to looking wet.
 *
 * What each octave does: the first two, under one and around two cycles across
 * the front, are the broad bays and headlands that give a wash its silhouette
 * and matter most at a glance. The third is finger width. The last two are the
 * fibre-scale chatter you only see close up, which on a 1080 poster the office
 * certainly will.
 *
 * The frequencies are deliberately not whole multiples of each other. Harmonic
 * ratios make the sum periodic, and a periodic edge repeats its own silhouette
 * across the card, which is the tell that gives a generated coastline away
 * every time.
 */
function noiseFn(r: () => number): (s: number) => number {
  const TAU = Math.PI * 2
  const p1 = r() * TAU
  const p2 = r() * TAU
  const p3 = r() * TAU
  const p4 = r() * TAU
  const p5 = r() * TAU
  const pe = r() * TAU
  const f1 = 1.0 + r() * 0.6
  const f2 = 2.6 + r() * 0.9
  const f3 = 5.4 + r() * 1.3
  const f4 = 10.3 + r() * 2.4
  const f5 = 19.1 + r() * 4.3
  const fe = 1.1 + r() * 0.9
  return (s) => {
    const env = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(s * fe * TAU + pe))
    return (
      0.46 * Math.sin(s * f1 * TAU + p1) +
      0.31 * Math.sin(s * f2 * TAU + p2) +
      env *
        (0.14 * Math.sin(s * f3 * TAU + p3) +
          0.08 * Math.sin(s * f4 * TAU + p4) +
          0.04 * Math.sin(s * f5 * TAU + p5))
    )
  }
}

/** The geometry a front is traced in: the spine, its direction and its normal. */
interface Frame {
  ax: number
  ay: number
  dx: number
  dy: number
  /** Unit normal, pointing the way the wash advances. */
  nx: number
  ny: number
  band: number
}

/**
 * The frame for a spine, with the normal turned to face the middle of the box.
 *
 * THE TURN IS NOT A FLOURISH, IT IS A BUG FIX. A spine's normal is whichever of
 * its two perpendiculars `(-dy, dx)` happens to be, and which one that is
 * depends on the order the two ends were written in. For the top left corner it
 * came out pointing into the card, which is what a bloom needs. For the top
 * right and bottom left corners, whose spines run the other way, it came out
 * pointing off the paper, and those two blooms therefore drew themselves
 * backwards: the torn leading edge went off into the corner where nothing can
 * see it, and the deliberately STRAIGHT trailing edge, the one meant to sit
 * four bands back and off the page, landed across the middle of the card as a
 * dead straight diagonal. That is the exact artefact this whole file exists to
 * avoid, and it survived until the seed sweep was rendered and looked at.
 *
 * Facing the normal at the box centre makes the orientation a property of where
 * the wash is going rather than of the order two numbers were typed in, so a
 * direction added later cannot bring it back. A sash is torn on both sides and
 * does not care which way this comes out.
 */
function frameOf(s: Spine, cx: number, cy: number): Frame {
  const dx = s.bx - s.ax
  const dy = s.by - s.ay
  const len = Math.hypot(dx, dy) || 1
  let nx = -dy / len
  let ny = dx / len
  const towards = (cx - (s.ax + dx / 2)) * nx + (cy - (s.ay + dy / 2)) * ny
  if (towards < 0) {
    nx = -nx
    ny = -ny
  }
  return { ax: s.ax, ay: s.ay, dx, dy, nx, ny, band: s.band }
}

/**
 * Trace the closed outline of one front: out along the leading edge, back along
 * the trailing one.
 *
 * `t` runs from a quarter before the spine to a quarter past it, so the shape
 * is already off the paper at both ends and no wash ever shows a tidy end cap
 * inside the card. `ahead` and `behind` are offsets along the normal in design
 * pixels, and 320 samples is enough that the twenty-cycle octave gets sixteen
 * points a wavelength, which is where the edge stops faceting.
 */
function traceFront(
  g: CanvasRenderingContext2D,
  f: Frame,
  ahead: (s: number) => number,
  behind: (s: number) => number,
): void {
  const n = 320
  const at = (i: number, off: number): [number, number] => {
    const t = -0.25 + 1.5 * (i / n)
    return [f.ax + f.dx * t + f.nx * off, f.ay + f.dy * t + f.ny * off]
  }
  g.beginPath()
  for (let i = 0; i <= n; i++) {
    const [x, y] = at(i, ahead(i / n))
    if (i === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  for (let i = n; i >= 0; i--) {
    const [x, y] = at(i, behind(i / n))
    g.lineTo(x, y)
  }
  g.closePath()
}

/** A soft ellipse, for mottling inside a wash and for erasing blooms out of it. */
function softBlob(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rad: number,
  squash: number,
  tilt: number,
  color: string,
  alpha: number,
  erase = false,
): void {
  g.save()
  g.translate(cx, cy)
  g.rotate(tilt)
  g.scale(1, squash)
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, rad)
  grad.addColorStop(0, soft(color, alpha))
  grad.addColorStop(0.45, soft(color, alpha * 0.7))
  grad.addColorStop(1, soft(color, 0))
  g.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
  g.fillStyle = grad
  g.beginPath()
  g.arc(0, 0, rad, 0, Math.PI * 2)
  g.fill()
  g.restore()
  g.globalCompositeOperation = 'source-over'
}

/**
 * Compose one front of pigment onto a scratch layer.
 *
 * Five passes, in the order a brush lays them:
 *
 *   1. The body. The torn outline, filled with a gradient running ACROSS the
 *      front rather than down the card: near-opaque behind, thinning towards
 *      the leading edge, and carrying the deepened tone at the back where a
 *      suspension settles thickest. Feathered by a few design pixels, which is
 *      as much softness as an edge on paper actually has.
 *   2. Mottle. A handful of deep, very soft ellipses clipped inside the shape,
 *      because paint dries unevenly and a flat interior gives the shape away.
 *   3. Blooms. Two or three of the same erased instead of laid down, which is
 *      what happens where the paper was already wet when the colour arrived.
 *   4. The second lay. A smaller torn front inside the first, at a third alpha.
 *      A wash is almost never one pass, and the boundary between a first and a
 *      second lay is the most recognisable thing about the medium after the
 *      rim. Without it the interior rendered as a flat orange slab with a
 *      wobbly outline, which reads as a sticker rather than as paint.
 *   5. The rim, last, so nothing paints over it. The outline stroked from
 *      inside a clip of itself, so only the inner half of the stroke survives.
 *      This is the pass that makes it watercolour rather than airbrush: pigment
 *      carried out by the water is left behind as the water goes, so a real
 *      wash is DARKEST in its last few millimetres, which is the one thing no
 *      gradient anybody reaches for is.
 *   6. Spatter. Two or three small torn shapes just off the leading edge. They
 *      are small and they are CLOSE, which is the correction after a first
 *      attempt scattered large pale ovals far out into the empty card, where
 *      they read as dust on the lens rather than as paint.
 */
function composeFront(
  g: CanvasRenderingContext2D,
  spine: Spine,
  w: number,
  h: number,
  light: string,
  deep: string,
  seed: number,
  sash: boolean,
  feather: number,
): void {
  const f = frameOf(spine, w / 2, h / 2)
  const r = rng(seed)
  const nAhead = noiseFn(r)
  const nBack = noiseFn(r)
  const nInner = noiseFn(r)

  // A bloom's trailing edge is far behind the spine and off the paper, so the
  // corner it comes from is solid colour. A sash is torn on both sides.
  const ahead = sash
    ? (s: number): number => f.band * (0.82 + 0.55 * nAhead(s))
    : (s: number): number => f.band * (1.0 + 0.98 * nAhead(s))
  const behind = sash
    ? (s: number): number => -f.band * (0.82 + 0.55 * nBack(s))
    : (): number => -f.band * 4

  const mx = f.ax + f.dx * 0.5
  const my = f.ay + f.dy * 0.5
  const along = (d: number): [number, number] => [mx + f.nx * d, my + f.ny * d]

  // 1. The body.
  const [g0x, g0y] = along(sash ? -f.band * 1.5 : -f.band * 1.4)
  const [g1x, g1y] = along(sash ? f.band * 1.5 : f.band * 2.2)
  const grad = g.createLinearGradient(g0x, g0y, g1x, g1y)
  if (sash) {
    grad.addColorStop(0, soft(light, 0.34))
    grad.addColorStop(0.26, soft(light, 0.72))
    grad.addColorStop(0.5, soft(deep, 0.92))
    grad.addColorStop(0.74, soft(light, 0.72))
    grad.addColorStop(1, soft(light, 0.34))
  } else {
    grad.addColorStop(0, soft(deep, 0.95))
    grad.addColorStop(0.34, soft(light, 0.88))
    grad.addColorStop(0.72, soft(light, 0.74))
    grad.addColorStop(1, soft(light, 0.52))
  }
  blurred(g, feather)
  traceFront(g, f, ahead, behind)
  g.fillStyle = grad
  g.fill()
  blurred(g, 0)

  // 2 to 5 all live inside the shape.
  g.save()
  traceFront(g, f, ahead, behind)
  g.clip()

  for (let i = 0; i < 7; i++) {
    const s = r()
    const off = ahead(s) * (0.1 + r() * 0.75)
    softBlob(
      g,
      f.ax + f.dx * (-0.2 + 1.4 * s) + f.nx * off,
      f.ay + f.dy * (-0.2 + 1.4 * s) + f.ny * off,
      f.band * (0.3 + r() * 0.5),
      0.5 + r() * 0.7,
      r() * Math.PI,
      deep,
      0.1 + r() * 0.12,
    )
  }
  for (let i = 0; i < 3; i++) {
    const s = r()
    const off = ahead(s) * (0.15 + r() * 0.6)
    softBlob(
      g,
      f.ax + f.dx * (-0.15 + 1.3 * s) + f.nx * off,
      f.ay + f.dy * (-0.15 + 1.3 * s) + f.ny * off,
      f.band * (0.2 + r() * 0.3),
      0.5 + r() * 0.6,
      r() * Math.PI,
      '#000000',
      0.14 + r() * 0.16,
      true,
    )
  }

  // 4. The second lay, pulled back off the leading edge so its own torn
  // boundary shows as a line inside the wash rather than tracking the outline.
  blurred(g, feather)
  const inner = (s: number): number => ahead(s) * (0.52 + 0.3 * nInner(s))
  traceFront(g, f, inner, behind)
  g.fillStyle = soft(deep, sash ? 0.16 : 0.24)
  g.fill()
  blurred(g, 0)

  // 5. The rim, last, so nothing lays over it.
  blurred(g, feather * 0.6)
  traceFront(g, f, ahead, behind)
  g.lineWidth = f.band * 0.17
  g.strokeStyle = soft(deep, 0.6)
  g.stroke()
  blurred(g, 0)
  g.restore()

  // 6. Spatter, sitting just past the leading edge.
  blurred(g, feather)
  for (let i = 0; i < 3; i++) {
    const s = 0.1 + r() * 0.8
    const off = ahead(s) + f.band * (0.06 + r() * 0.26)
    const cx = f.ax + f.dx * (-0.1 + 1.2 * s) + f.nx * off
    const cy = f.ay + f.dy * (-0.1 + 1.2 * s) + f.ny * off
    const rad = f.band * (0.05 + r() * 0.09)
    const n = noiseFn(r)
    g.beginPath()
    for (let j = 0; j <= 48; j++) {
      const a = (j / 48) * Math.PI * 2
      const rr = rad * (1 + 0.3 * n(j / 48))
      const x = cx + Math.cos(a) * rr
      const y = cy + Math.sin(a) * rr * 0.8
      if (j === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.closePath()
    g.fillStyle = soft(light, 0.42 + r() * 0.3)
    g.fill()
  }
  blurred(g, 0)
}

/**
 * The resolution a wash layer is composed at, as a fraction of the output.
 *
 * A wash has no detail finer than the feather on its own edge, so composing it
 * at full device resolution is paying four times over for something nobody can
 * see. Measured in the check harness at 1080 by 1350: composing at full
 * resolution cost 245 ms, which is a visible stall the first time a template is
 * opened and four times that again on a 2x export. At half it is 69 ms, and the
 * upscale on the way out costs nothing and softens the edge slightly in the
 * bargain, which is the direction this wants to be wrong in anyway.
 *
 * Half and no lower. At a third the torn edge starts to show the interpolation
 * as a soft stair, which is a different artefact and a worse one.
 */
const WASH_RES = 0.5

/** Paint a composed wash layer into the caller's box. */
function paintWash(
  ctx: CanvasRenderingContext2D,
  o: OrnamentOptions,
  dir: WashDir,
  light: string,
  deep: string,
): void {
  const k = scaleOf(ctx)
  const seed = Math.abs(Math.floor(o.seed ?? 1)) || 1
  const box = `${Math.round(o.w)}x${Math.round(o.h)}`
  const canvas = layer(
    `wash|${dir}|${box}|${k.toFixed(3)}|${light}|${deep}|${seed}`,
    o.w,
    o.h,
    k * WASH_RES,
    (g) => {
      // The feather is a fraction of the box, not a constant, so a wash on a
      // 360 wide preview thumbnail is softened by the same amount RELATIVE to
      // its own edge as one on a full card. A fixed pixel blur would look
      // right at one size and like fog at the other.
      composeFront(
        g,
        spineFor(dir, o.w, o.h),
        o.w,
        o.h,
        light,
        deep,
        seed,
        dir === 'diag',
        Math.min(o.w, o.h) * 0.0045,
      )
      grainInto(g, o.w, o.h, 0.28)
    },
  )
  if (!canvas) return
  ctx.save()
  ctx.globalAlpha *= clamp(o.alpha ?? 1, 0, 1)
  ctx.drawImage(canvas, o.x, o.y, o.w, o.h)
  ctx.restore()
}

/** The two tones a party wash is mixed from: the field colour, and it deepened. */
function washTones(p: Ink): { light: string; deep: string } {
  return {
    light: p.bg,
    // Not `p.accent` itself. On several of these palettes the accent is a very
    // dark brown or a near-black green, and a wash carrying it at the back came
    // out muddy rather than saturated. Half way there keeps the hue and gains
    // the weight.
    deep: mix(p.bg, p.accent, 0.5),
  }
}

/**
 * A watercolour wash bleeding in from an edge, in the desk's own party colour.
 *
 * THE DIRECTION COMES FROM THE SEED, cycling top left, top right, bottom left,
 * diagonal sash on `seed % 4` in that order. That is what makes a set of cards
 * differ from each other for nothing: the caller already varies the seed to
 * shuffle every other ornament, so a run of templates gets a run of different
 * grounds without the integrator choosing one each time. Where a layout NEEDS a
 * particular corner left clear, because a portrait or a headline is going
 * there, call `drawWashTopLeft`, `drawWashTopRight`, `drawWashBottomLeft` or
 * `drawWashSash` instead, and the seed then varies only the shape.
 */
export const drawWash: Ornament = (ctx, o) => {
  const dirs: WashDir[] = ['tl', 'tr', 'bl', 'diag']
  const pick = dirs[Math.abs(Math.floor(o.seed ?? 1)) % 4] ?? 'tl'
  const t = washTones(o.p)
  paintWash(ctx, o, pick, t.light, t.deep)
}

/** The wash pinned to the top left corner, whatever the seed. */
export const drawWashTopLeft: Ornament = (ctx, o) => {
  const t = washTones(o.p)
  paintWash(ctx, o, 'tl', t.light, t.deep)
}

/** The wash pinned to the top right corner, whatever the seed. */
export const drawWashTopRight: Ornament = (ctx, o) => {
  const t = washTones(o.p)
  paintWash(ctx, o, 'tr', t.light, t.deep)
}

/** The wash pinned to the bottom left corner, under where a leader stands. */
export const drawWashBottomLeft: Ornament = (ctx, o) => {
  const t = washTones(o.p)
  paintWash(ctx, o, 'bl', t.light, t.deep)
}

/** The diagonal band across a corner, rather than a bloom sitting in one. */
export const drawWashSash: Ornament = (ctx, o) => {
  const t = washTones(o.p)
  paintWash(ctx, o, 'diag', t.light, t.deep)
}

/* ===========================================================================
   The tricolour wash
   =========================================================================== */

/**
 * The national colours, and why these two are constants when nothing else in
 * this folder is.
 *
 * Rule 3 in the kit sends every colour through `p`, and rule 4 says in the same
 * breath that the national colours as bands are fine. Both hold here. The
 * tricolour is not the desk's party colour rendered in three parts; it is the
 * same three colours on a BJP card, a Congress card and an AAP card, and
 * repainting it in the desk's palette would produce a saffron-and-blue flag
 * that is nobody's. So this one ornament is fixed, and it is fixed at the
 * published values rather than at an approximation of them.
 *
 * The white is not listed because it is not painted. The middle of the box is
 * simply left alone, which is what "the paper showing between them" means on a
 * card whose ground is already cream. A white band laid over cream would put a
 * rectangle of a second, colder paper down the middle of the poster.
 *
 * There is no wheel here and there will not be one. See rule 4.
 */
const SAFFRON = '#ff9933'
const GREEN = '#138808'

/**
 * The tricolour treatment: saffron bleeding down from the top edge, green up
 * from the foot, the paper left to show through the middle.
 *
 * Horizontal, because that is the way the bands run, and because this serves
 * both as a full card ground and as a strip and both want the same axis. The
 * two spines run edge to edge rather than across a corner, they are measured
 * off the HEIGHT so the fronts keep their gap whatever the box's aspect, and
 * they are held apart so roughly the middle third of the box is never reached
 * by either. That gap is the design: bring them closer and the two fringes
 * overlap into a brown that reads as a fault in the printing.
 *
 * Neither front is level with the edge it comes from. A tilt of a few per cent
 * of the height stops the pair reading as two ruled bands, which is exactly
 * what a flag drawn in code looks like and exactly what these cards are not.
 */
export const drawTricolourWash: Ornament = (ctx, o) => {
  const k = scaleOf(ctx)
  const seed = Math.abs(Math.floor(o.seed ?? 1)) || 1
  const box = `${Math.round(o.w)}x${Math.round(o.h)}`
  const canvas = layer(`tri|${box}|${k.toFixed(3)}|${seed}`, o.w, o.h, k * WASH_RES, (g) => {
    const band = o.h * 0.1
    const feather = Math.min(o.w, o.h) * 0.0045
    // The two spines run in OPPOSITE directions along the box, which is what
    // turns the normal round: the top front advances downwards into the card
    // and the foot front advances upwards, and neither needs a special case.
    composeFront(
      g,
      {
        ax: -0.12 * o.w,
        ay: 0.04 * o.h,
        bx: 1.12 * o.w,
        by: 0.11 * o.h,
        band,
      },
      o.w,
      o.h,
      SAFFRON,
      // Deepened towards a burnt brown, not towards black. Both national
      // colours dulled with black go grey, and grey in a flag reads as a fault
      // in the printing rather than as depth in the paint.
      mix(SAFFRON, '#7a3d00', 0.3),
      seed,
      false,
      feather,
    )
    composeFront(
      g,
      {
        ax: 1.12 * o.w,
        ay: 0.96 * o.h,
        bx: -0.12 * o.w,
        by: 0.89 * o.h,
        band,
      },
      o.w,
      o.h,
      GREEN,
      mix(GREEN, '#0a3b12', 0.35),
      seed + 977,
      false,
      feather,
    )
    grainInto(g, o.w, o.h, 0.28)
  })
  if (!canvas) return
  ctx.save()
  ctx.globalAlpha *= clamp(o.alpha ?? 1, 0, 1)
  ctx.drawImage(canvas, o.x, o.y, o.w, o.h)
  ctx.restore()
}

/* ===========================================================================
   The corner mandala
   =========================================================================== */

/**
 * Fine linework tucked into a corner: concentric arcs, two rings of petals, a
 * scalloped edge, a pair of paisleys and a scatter of dots.
 *
 * WHICH CORNER. `seed % 4` picks it, top left, top right, bottom right, bottom
 * left in that order, and the motif is a QUARTER of a mandala centred exactly
 * on that corner of the box with its outer ring reaching the far edges. So the
 * integrator hands this the square of empty card they want filled and gets the
 * quarter that belongs there. Seeds 4, 5, 6 and 7 name the corner outright
 * while leaving 8 and up free to vary the dot scatter on the same corner.
 *
 * WHY A QUARTER AND NOT A WHOLE ONE. A mandala's centre is its subject, and a
 * complete one dropped in a corner either overlaps the type or shrinks to a
 * doily. Quartered and anchored off the paper it reads as a much larger pattern
 * the card happens to be cropping, which is what the reference cards do, and it
 * is also cheaper: the same linework at three times the radius.
 *
 * EVERYTHING HERE IS ARCS, PETALS AND DOTS, and nothing here is a ring with
 * spokes in it. That is a live constraint rather than a taste: a circle with
 * twenty-four radial lines IS the Ashoka Chakra, which rule 4 forbids, so this
 * file draws no radial spoke at any count.
 */
export const drawMandalaCorner: Ornament = (ctx, o) => {
  const seed = Math.abs(Math.floor(o.seed ?? 1)) || 1
  const corner = seed % 4
  const R = Math.min(o.w, o.h)

  ctx.save()
  ctx.globalAlpha *= clamp(o.alpha ?? 1, 0, 1)
  // Move the origin to the chosen corner and flip the quarter into place, so
  // the geometry below is written once, in the first quadrant, and never has to
  // branch on which corner it is serving.
  ctx.translate(
    corner === 1 || corner === 2 ? o.x + o.w : o.x,
    corner === 2 || corner === 3 ? o.y + o.h : o.y,
  )
  ctx.scale(corner === 1 || corner === 2 ? -1 : 1, corner === 2 || corner === 3 ? -1 : 1)

  // Thin, but never hairline. At 1080 wide these run between one and a half and
  // three design pixels; in a 360 preview the finest is half a pixel, which the
  // browser renders as a paler line rather than dropping, so the motif thins out
  // instead of breaking up.
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  /**
   * The whole motif, in one set of inks, twice.
   *
   * WHY TWICE, which is not obvious and was not in the first draft. An ornament
   * is handed the palette but never the ground it is landing on, and this one
   * is linework at twelve to twenty per cent: drawn only in `p.accent` it is
   * beautiful on cream and completely INVISIBLE on a card whose field is that
   * same accent, which is the second half of every party grammar in this
   * product. Rendered on the AAP palette over its own deep blue, the motif
   * simply was not there.
   *
   * So the same geometry is laid down twice at the same widths, the light ink
   * first and the dark ink over it. On a pale ground the second pass covers the
   * first and you see the dark line, which is what the reference cards have. On
   * a dark ground the dark pass adds almost nothing and the light one beneath
   * shows through it as a lift of a little over a tenth, which is faint and is
   * meant to be: this is background linework, and the alternative to faint is
   * not bolder, it is absent.
   *
   * It costs a second pass over about a hundred and twenty short paths, which
   * measured at 0.53 ms for the pair on a 1080 box. Nothing worth optimising.
   */
  const pass = (line: string, faint: string, warm: string): void => {
    const r = rng(seed)

    const arcAt = (rad: number, width: number, color: string): void => {
      ctx.beginPath()
      ctx.arc(0, 0, rad, 0, Math.PI / 2)
      ctx.lineWidth = width
      ctx.strokeStyle = color
      ctx.stroke()
    }

    // The concentric ground. Unevenly spaced, because evenly spaced rings read as
    // a target: pairs of close rings with a wide gap after them is how this
    // linework is actually set out.
    for (const f of [0.15, 0.18, 0.36, 0.4, 0.63, 0.66, 0.94, 0.97]) {
      arcAt(R * f, f > 0.9 ? 2.6 : 1.6, f > 0.6 ? faint : line)
    }

    /**
     * One petal standing on the ring at `rad` and pointing outward: two mirrored
     * curves meeting at a tip, drawn in the petal's own frame so the shape is one
     * expression rather than four rotated copies of a fragment.
     */
    const petal = (
      rad: number,
      angle: number,
      len: number,
      halfWidth: number,
      color: string,
      width: number,
    ): void => {
      ctx.save()
      ctx.rotate(angle)
      ctx.translate(rad, 0)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.quadraticCurveTo(len * 0.42, -halfWidth, len, 0)
      ctx.quadraticCurveTo(len * 0.42, halfWidth, 0, 0)
      ctx.closePath()
      ctx.lineWidth = width
      ctx.strokeStyle = color
      ctx.stroke()
      ctx.restore()
    }

    // Two rings of petals at coprime counts, so the inner and outer rings never
    // line up into visible radial columns.
    const inner = 7
    for (let i = 0; i < inner; i++) {
      petal(R * 0.19, ((i + 0.5) / inner) * (Math.PI / 2), R * 0.15, R * 0.045, line, 1.7)
    }
    const outer = 11
    for (let i = 0; i < outer; i++) {
      const a = ((i + 0.5) / outer) * (Math.PI / 2)
      petal(R * 0.41, a, R * 0.2, R * 0.042, i % 2 === 0 ? line : warm, 1.7)
      // A shorter petal nested inside the first. One outline reads as a
      // wireframe; two nested outlines read as a drawn petal with a vein.
      petal(R * 0.41, a, R * 0.11, R * 0.02, faint, 1.4)
    }

    // The scallop: half circles hung off a ring, which is the lace edge this kind
    // of border always finishes with.
    const scallops = 17
    for (let i = 0; i < scallops; i++) {
      ctx.save()
      ctx.rotate(((i + 0.5) / scallops) * (Math.PI / 2))
      ctx.beginPath()
      ctx.arc(R * 0.7, 0, R * 0.036, -Math.PI / 2, Math.PI / 2)
      ctx.lineWidth = 1.5
      ctx.strokeStyle = line
      ctx.stroke()
      ctx.restore()
    }
    arcAt(R * 0.7, 1.4, faint)

    /**
     * A paisley, tip inward and body swelling outward, with a smaller one nested
     * inside it. A ring of them fills the band between the petal tips and the
     * outer arcs, which is the one that otherwise reads as empty.
     *
     * THE TIP IS THE WHOLE SHAPE. The first attempt closed the outline with two
     * symmetric curves meeting at the origin, and rendered it read as an egg:
     * both tangents arrived at the point almost parallel, so the corner rounded
     * itself off and the boteh became an oval with something in it. What makes a
     * paisley a paisley is that the two flanks meet at a sharp angle and that
     * they are not the same length, so the body leans over its own tip. Hence the
     * asymmetry in the numbers below, which is deliberate rather than sloppy.
     */
    const paisley = (
      angle: number,
      rad: number,
      size: number,
      width: number,
      color: string,
    ): void => {
      ctx.save()
      ctx.rotate(angle)
      ctx.translate(rad, 0)
      // Local +y is radially outward after this, so the tip sits at the inner end
      // and the body opens towards the edge of the card.
      ctx.rotate(-Math.PI / 2)
      const shape = (s: number, ox: number, oy: number): void => {
        ctx.beginPath()
        ctx.moveTo(ox, oy)
        ctx.bezierCurveTo(
          ox + s * 0.34,
          oy + s * 0.16,
          ox + s * 0.62,
          oy + s * 0.44,
          ox + s * 0.52,
          oy + s * 0.78,
        )
        ctx.bezierCurveTo(
          ox + s * 0.44,
          oy + s * 1.06,
          ox + s * 0.08,
          oy + s * 1.18,
          ox - s * 0.1,
          oy + s * 0.96,
        )
        ctx.bezierCurveTo(ox - s * 0.3, oy + s * 0.74, ox - s * 0.24, oy + s * 0.4, ox, oy)
        ctx.stroke()
      }
      ctx.lineWidth = width
      ctx.strokeStyle = color
      shape(size, 0, 0)
      ctx.lineWidth = width * 0.75
      ctx.strokeStyle = warm
      shape(size * 0.52, size * 0.06, size * 0.3)
      ctx.restore()
    }
    const paisleys = 5
    for (let i = 0; i < paisleys; i++) {
      paisley(((i + 0.5) / paisleys) * (Math.PI / 2), R * 0.79, R * 0.13, 1.8, line)
    }

    // The scatter. Seeded, so it holds still while the desk types, and pushed
    // outward by the square root because a flat random radius on a quarter disc
    // crowds every dot into the middle.
    ctx.fillStyle = line
    for (let i = 0; i < 54; i++) {
      const a = r() * (Math.PI / 2)
      // Stopped short of the full radius on purpose. A dot is a filled circle
      // with a radius of its own, and at 0.98 the widest of them put a couple
      // of pixels outside the box on a small motif, which is rule 1. The outer
      // arcs are pulled in for the same reason: half a line width counts.
      const rad = R * (0.12 + Math.sqrt(r()) * 0.82)
      ctx.beginPath()
      ctx.arc(Math.cos(a) * rad, Math.sin(a) * rad, 1.4 + r() * 2.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // The light pass uses `onAccent` for all three inks. Its job is only to exist
  // under the dark pass on a dark card, and giving it the two-tone treatment as
  // well would put a second, differently coloured motif half a shade off the
  // first one.
  pass(soft(o.p.onAccent, 0.2), soft(o.p.onAccent, 0.13), soft(o.p.onAccent, 0.17))
  pass(soft(o.p.accent, 0.2), soft(o.p.accent, 0.12), soft(o.p.bg, 0.3))

  ctx.restore()
}

/* ===========================================================================
   The foot band
   =========================================================================== */

interface Wave {
  base: number
  amp: number
  f1: number
  f2: number
  ph1: number
  ph2: number
}

/**
 * The height of the wave at `t` across the width.
 *
 * Two sine terms at frequencies that are not multiples of each other, so the
 * crest never repeats across the band. One term alone is a corrugation, and a
 * corrugation is the single thing that most reliably gives a hand-drawn edge
 * away as generated. The phases come off the seed, so two cards in a set get
 * their crests in different places from the same code.
 */
const waveAt = (t: number, v: Wave): number =>
  v.base +
  v.amp *
    (0.64 * Math.sin(t * v.f1 * Math.PI * 2 + v.ph1) +
      0.36 * Math.sin(t * v.f2 * Math.PI * 2 + v.ph2))

/**
 * Trace the wave across the box, left to right.
 *
 * Six design pixels a step. Finer is invisible even at a 2x export and
 * measurably slower across a 1080 wide band; coarser and the crest facets.
 */
function traceWave(ctx: CanvasRenderingContext2D, o: OrnamentOptions, v: Wave): void {
  ctx.moveTo(o.x, waveAt(0, v))
  for (let px = 6; px < o.w; px += 6) ctx.lineTo(o.x + px, waveAt(px / o.w, v))
  ctx.lineTo(o.x + o.w, waveAt(1, v))
}

/**
 * A coloured band across the foot of the box, its top edge a shallow wave.
 *
 * The box handed in IS the band: this fills the whole of it and only the top
 * edge moves. Every measurement is a fraction of `o.h`, so a 150 pixel band at
 * the foot of a poster and a 60 pixel strip inside a card both come out in
 * proportion.
 *
 * THREE LAYERS, and the middle one is the band proper:
 *   - a paler wash of the same colour riding a little higher, so the band reads
 *     as something lapping over the card rather than as a rectangle with a
 *     wobble cut out of it;
 *   - the band itself, in the party colour;
 *   - where the palette has a genuine second party colour, a thin strip of it
 *     along the very bottom. Where it has none, nothing. The kit's `accent2` is
 *     null precisely because some parties have one colour, and inventing a
 *     second by darkening the first would put a stripe on the poster that the
 *     party does not have.
 *
 * A hairline in the deepened party colour follows the crest in both cases. A
 * flat band meeting a cream ground with no edge at all looks unresolved at the
 * size these are read, and the line is the same hue, so it defines the wave
 * without introducing a colour.
 */
export const drawFootBand: Ornament = (ctx, o) => {
  const seed = Math.abs(Math.floor(o.seed ?? 1)) || 1
  const r = rng(seed)
  const bottom = o.y + o.h
  const ph1 = r() * Math.PI * 2
  const ph2 = r() * Math.PI * 2
  const f1 = 1.3 + r() * 0.7
  const f2 = 2.7 + r() * 1.1

  // The crest of the main band can rise to y + 0.11h and the lapping wash above
  // it to y + 0.015h, so nothing in this ornament leaves the box.
  const crest: Wave = {
    base: o.y + o.h * 0.22,
    amp: o.h * 0.11,
    f1,
    f2,
    ph1,
    ph2,
  }
  const lap: Wave = {
    base: o.y + o.h * 0.085,
    amp: o.h * 0.07,
    f1: f1 * 0.8,
    f2: f2 * 0.7,
    ph1: ph1 + 1.1,
    ph2: ph2 + 2.3,
  }

  ctx.save()
  ctx.globalAlpha *= clamp(o.alpha ?? 1, 0, 1)

  ctx.beginPath()
  traceWave(ctx, o, lap)
  ctx.lineTo(o.x + o.w, bottom)
  ctx.lineTo(o.x, bottom)
  ctx.closePath()
  ctx.fillStyle = soft(o.p.bg, 0.3)
  ctx.fill()

  const second = o.p.accent2
  const bandBottom = second === null ? bottom : bottom - Math.max(4, o.h * 0.14)
  if (second !== null) {
    ctx.fillStyle = second
    ctx.fillRect(o.x, bandBottom, o.w, bottom - bandBottom)
  }

  ctx.beginPath()
  traceWave(ctx, o, crest)
  ctx.lineTo(o.x + o.w, bandBottom)
  ctx.lineTo(o.x, bandBottom)
  ctx.closePath()
  ctx.fillStyle = o.p.bg
  ctx.fill()

  // The crest line is stroked on its own open path, so it does not also run
  // down the two sides and back along the foot the way stroking the fill would.
  ctx.beginPath()
  traceWave(ctx, o, crest)
  ctx.lineWidth = Math.max(2, o.h * 0.018)
  ctx.strokeStyle = soft(mix(o.p.bg, o.p.accent, 0.55), 0.85)
  ctx.stroke()

  ctx.restore()
}
