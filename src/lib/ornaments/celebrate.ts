/**
 * The celebration set: balloons, gifts, bunting, confetti and a cake.
 *
 * WHAT THIS LAYER IS FOR. A birthday card and a national day card carry the
 * same portrait, the same headline block and the same signature plate. The only
 * thing that tells a reader which one they are looking at is the ornament along
 * the foot and the corner behind it, so this layer is doing the work the words
 * cannot: it is what stops fifteen templates reading as one template with the
 * text swapped. That is worth drawing carefully rather than quickly.
 *
 * THE TWO GROUNDS PROBLEM, which shaped nearly every colour decision below.
 * These pieces are laid on cream paper on some cards and directly on the deep
 * party tone on others, and the ornament is not told which. So no fill here is
 * ever a mid tone at the same weight as one of the grounds: the bodies are
 * either the bright party colour, the second party colour, a warm paper white,
 * or a pale tint of the deep tone, all of which sit clear of cream at one end
 * and clear of the deep tone at the other. Everything then takes a hairline
 * outline of its OWN colour darkened, which is what lets the paper white
 * balloon still read as a balloon when it is floating over cream: the outline
 * carries the shape when the fill cannot.
 *
 * The one thing measured against neither palette is a candle flame. A flame is
 * warm gold in every photograph anybody has ever taken of a birthday cake, and
 * painting it in the desk's colours would put a blue flame on one party's card
 * and a green one on another's, which reads as a mistake rather than as a
 * choice. It is a plain neutral and stays one.
 */

import { clamp, mix, rng, soft, type Ink, type Ornament, type OrnamentOptions } from './kit'

/**
 * A warm near black, and never `#000`. Every ground these sit on is warm, and a
 * neutral black outline on a saffron or a cream field reads as clip art pasted
 * on rather than as a drawn edge. Mixing towards this instead keeps an outline
 * in the same family as the thing it outlines.
 */
const SOOT = '#2a1a0c'

/** Warm paper white: the neutral body colour, and the icing on the cake. */
const PAPER = '#fdf4e6'

/** The flame, and its hotter middle. Neutral by the argument in the header. */
const FLAME = '#ffb545'
const FLAME_CORE = '#fff2c9'

/** A colour darkened towards SOOT, for the outline and the shaded face. */
const darken = (c: string, t: number): string => mix(c, SOOT, t)

/** A colour lifted towards white, for a lit face or a highlight. */
const lighten = (c: string, t: number): string => mix(c, '#ffffff', t)

/**
 * The four festive bodies, in the desk's own colours.
 *
 * A party with only one colour still has to get a bunch of balloons that is not
 * four balloons of the same saffron, so `accent2` missing is filled with a tint
 * of the party colour rather than left out: a lighter version of the same hue
 * still reads as a second balloon, where a repeat of the first reads as a
 * rendering fault. The fourth is a pale wash of the deep tone, which is the one
 * that keeps the set from looking like three colours on a rota.
 */
function bodies(p: Ink): string[] {
  const second = p.accent2 ?? lighten(p.bg, 0.44)
  return [p.bg, PAPER, second, lighten(p.accent, 0.55)]
}

/** Index into a colour set without tripping noUncheckedIndexedAccess. */
const pick = (set: string[], i: number): string =>
  set[((i % set.length) + set.length) % set.length] ?? PAPER

/**
 * The colour a string, a cord or any other thin line is drawn in.
 *
 * Half way between the deep party tone and white, which is the only band that
 * survives both grounds: `ink` would vanish into the deep tone and the party
 * colour itself would vanish into cream. A hairline has no area to carry a hue
 * with, so it has to win on lightness alone.
 */
const thread = (p: Ink): string => lighten(p.accent, 0.38)

/**
 * Open a piece: clip to the box, move the origin to its corner, apply the
 * caller's alpha.
 *
 * The clip is belt and braces rather than a licence to overflow. Every routine
 * below is composed to sit inside its box on its own arithmetic, and the clip
 * is there because the alternative to a piece being trimmed at the edge is a
 * balloon drawn across somebody's face, and of those two failures only one can
 * be published without anybody noticing.
 */
function open(ctx: CanvasRenderingContext2D, o: OrnamentOptions): number {
  ctx.save()
  ctx.beginPath()
  ctx.rect(o.x, o.y, o.w, o.h)
  ctx.clip()
  ctx.translate(o.x, o.y)
  const a = clamp(o.alpha ?? 1, 0, 1)
  ctx.globalAlpha = a
  return a
}

/* ===========================================================================
   Balloons
   =========================================================================== */

/**
 * One balloon, centred on the origin of the current transform.
 *
 * The body is a teardrop and not an ellipse, and that is the whole difference
 * between a balloon and a bubble: the widest point sits above the middle, the
 * sides fall inwards towards the neck, and the neck is what the knot and the
 * string hang from. Four beziers, mirrored, because a balloon is symmetrical
 * and an eye catches an asymmetric one immediately.
 */
function balloonBody(ctx: CanvasRenderingContext2D, rx: number, ry: number, fill: string): void {
  const tip = ry * 1.04

  // Held as a Path2D rather than as the context's current path, and that is not
  // a style preference. The shading below needs its own path to clip against,
  // and setting one wipes the current path, so a body built the ordinary way
  // came back to be outlined and had the SHADING ellipse stroked instead of the
  // balloon. Every balloon in the first render wore a brown hoop.
  const body = new Path2D()
  body.moveTo(0, -ry)
  body.bezierCurveTo(rx * 0.96, -ry * 0.96, rx * 1.02, ry * 0.2, rx * 0.26, ry * 0.84)
  body.bezierCurveTo(rx * 0.14, ry * 0.95, rx * 0.06, tip * 0.99, 0, tip)
  body.bezierCurveTo(-rx * 0.06, tip * 0.99, -rx * 0.14, ry * 0.95, -rx * 0.26, ry * 0.84)
  body.bezierCurveTo(-rx * 1.02, ry * 0.2, -rx * 0.96, -ry * 0.96, 0, -ry)
  body.closePath()
  ctx.fillStyle = fill
  ctx.fill(body)

  // The turned side, as a gradient across the body rather than as a shape laid
  // on it. Rubber has no edges on it, and a shaded ellipse inside the outline
  // put one down the middle of every balloon.
  ctx.save()
  ctx.clip(body)
  const shade = ctx.createLinearGradient(-rx, 0, rx, 0)
  shade.addColorStop(0, soft('#ffffff', 0.16))
  shade.addColorStop(0.42, soft('#ffffff', 0))
  shade.addColorStop(1, soft(darken(fill, 0.6), 0.26))
  ctx.fillStyle = shade
  ctx.fillRect(-rx * 1.1, -ry * 1.2, rx * 2.2, ry * 2.6)
  ctx.restore()

  ctx.lineWidth = Math.max(1, rx * 0.045)
  ctx.strokeStyle = darken(fill, 0.42)
  ctx.stroke(body)

  // The specular: a soft slash on the upper left, at two strengths so it has an
  // edge without a hard rim. One flat white blob here read as a sticker.
  ctx.fillStyle = soft('#ffffff', 0.5)
  ctx.beginPath()
  ctx.ellipse(-rx * 0.36, -ry * 0.38, rx * 0.2, ry * 0.3, -0.42, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = soft('#ffffff', 0.62)
  ctx.beginPath()
  ctx.ellipse(-rx * 0.4, -ry * 0.44, rx * 0.1, ry * 0.16, -0.42, 0, Math.PI * 2)
  ctx.fill()

  // The knot: a small pinch under the neck, no bigger than that. The first pass
  // drew it a fifth of the balloon long and every balloon in the bunch looked
  // like it had an arrowhead hanging off it.
  ctx.beginPath()
  ctx.moveTo(-rx * 0.1, tip - ry * 0.02)
  ctx.lineTo(rx * 0.1, tip - ry * 0.02)
  ctx.lineTo(0, tip + ry * 0.1)
  ctx.closePath()
  ctx.fillStyle = darken(fill, 0.3)
  ctx.fill()
}

/**
 * A cluster of balloons rising from one bottom corner on curved strings.
 *
 * The strings are the part that has to be right. A bunch whose strings run
 * straight from a corner to each knot looks like a diagram of a bunch; real
 * ones bow, and each bows a different way, so every string here is a quadratic
 * with its control point pushed off the chord by an amount and a sign taken
 * from the seed. They are also drawn BEFORE the bodies, so a string that passes
 * behind a lower balloon disappears behind it, which is what gives the cluster
 * any depth at all.
 *
 * The corner is chosen from the seed rather than passed in, since the caller
 * that wants a particular side can pass a seed that produces it and every
 * caller that does not care gets variety across a set of cards.
 */
export const drawBalloons: Ornament = (ctx, o) => {
  const { w, h, p } = o
  const rnd = rng(o.seed ?? 1)
  const alpha = open(ctx, o)
  const set = bodies(p)

  // Left or right foot. The whole cluster mirrors with it.
  const onLeft = rnd() < 0.5
  const ax = onLeft ? w * 0.15 : w * 0.85
  const ay = h - 1

  // Sized off both dimensions: a wide flat box would otherwise get balloons
  // taller than the room they have, and a tall narrow one would get four across
  // a measure that fits two.
  const rx = Math.min(w * 0.1, h * 0.15)
  const ry = rx * 1.16

  // The colour rota is fixed once and then walked, rather than drawn per
  // balloon. Rolling a colour for each one looked like the same thing and was
  // not: the generator's top bit fell into step with the loop counter and a
  // whole bunch came out in two of the four colours, with no saffron in a
  // saffron desk's balloons at all. Walking a rota cannot do that.
  const start = Math.floor(rnd() * 4)
  const cols = 4
  const margin = rx * 1.12
  const span = w - margin * 2
  const rowGap = ry * 1.42

  interface Puff {
    cx: number
    cy: number
    rx: number
    tilt: number
    fill: string
    bow: number
  }
  const puffs: Puff[] = []

  // Four across the top, three tucked under and offset half a column: the
  // brick pattern is what makes seven circles read as a bunch instead of a
  // grid. Everything after that is jitter.
  for (let i = 0; i < 7; i += 1) {
    const row = i < cols ? 0 : 1
    const col = row === 0 ? i : i - cols
    const per = span / cols
    const base = margin + per * (col + 0.5) + (row === 1 ? per * 0.5 : 0)
    const scale = 0.76 + rnd() * 0.3
    const cx = clamp(base + (rnd() - 0.5) * per * 0.42, rx + 3, w - rx - 3)
    const cy = clamp(
      ry * 1.2 + row * rowGap + (rnd() - 0.5) * ry * 0.4,
      ry * 1.14 + 2,
      h * 0.62,
    )
    puffs.push({
      cx,
      cy,
      rx: rx * scale,
      tilt: (rnd() - 0.5) * 0.34,
      fill: pick(set, i + start),
      bow: (rnd() < 0.5 ? -1 : 1) * (0.3 + rnd() * 0.4),
    })
  }

  // Small ones first, so the largest balloons finish in front. Depth in a
  // drawing this flat has to come from overlap order, and the alternative,
  // drawing them in the order they were generated, produced a small balloon
  // sitting on top of a large one with no reason to be there.
  puffs.sort((a, b) => a.rx - b.rx)

  ctx.lineCap = 'round'
  ctx.strokeStyle = soft(thread(p), 0.95 * alpha)
  ctx.lineWidth = Math.max(1.1, w * 0.0032)
  for (const b of puffs) {
    const bry = b.rx * 1.16
    const kx = b.cx - Math.sin(b.tilt) * bry * 1.2
    const ky = b.cy + Math.cos(b.tilt) * bry * 1.2
    const mx = (ax + kx) / 2
    const my = (ay + ky) / 2
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.quadraticCurveTo(mx + (ky - ay) * b.bow * 0.42, my + (ax - kx) * b.bow * 0.42, kx, ky)
    ctx.stroke()
  }

  for (const b of puffs) {
    ctx.save()
    ctx.translate(b.cx, b.cy)
    ctx.rotate(b.tilt)
    balloonBody(ctx, b.rx, b.rx * 1.16, b.fill)
    ctx.restore()
  }

  ctx.restore()
}

/* ===========================================================================
   Gifts
   =========================================================================== */

/**
 * A wrapped box, seen slightly from above and to the left.
 *
 * Three faces rather than one. A gift drawn as a flat rectangle with a cross on
 * it is a envelope, and the ribbon has nowhere to go: the whole point of the
 * ornament is the band running up the front, over the lid and down the far
 * side, and that needs a lid and a side to run over. The lift is a shear rather
 * than a projection, which is all a shape this size can carry.
 *
 * `gx, gy` is the bottom left of the FRONT face, so a row of boxes of different
 * heights stands on one floor line by sharing `gy`. `s0` and `u0` place the
 * knot on the lid, across the width and back into the depth: they exist so the
 * box at the bottom of a pile can wear its bow to one side, clear of whatever
 * is standing on it. Centred, it is simply hidden.
 */
function gift(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  bw: number,
  bh: number,
  body: string,
  ribbon: string,
  s0 = 0.5,
  u0 = 0.5,
): void {
  // The lid is shallow on purpose. A deeper one starts to read as a crate seen
  // from above and the front face, which is where the eye goes, gets small.
  const dx = bw * 0.24
  const dy = bh * 0.26
  const top = gy - bh
  const lid = top - dy
  const edge = darken(body, 0.44)
  const rw = Math.max(3, bw * 0.11)

  const quad = (
    pts: Array<[number, number]>,
    fill: string,
    stroke: string | null,
    lineW: number,
  ): void => {
    ctx.beginPath()
    pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)))
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    if (stroke) {
      ctx.lineWidth = lineW
      ctx.strokeStyle = stroke
      ctx.stroke()
    }
  }

  const outline = Math.max(1, bw * 0.014)

  // Front, lid, far side. The lid catches the light and the side turns away
  // from it, which is the only thing telling the reader this is a box.
  quad(
    [
      [gx, top],
      [gx + bw, top],
      [gx + bw, gy],
      [gx, gy],
    ],
    body,
    edge,
    outline,
  )
  quad(
    [
      [gx + bw, top],
      [gx + bw + dx, lid],
      [gx + bw + dx, lid + bh],
      [gx + bw, gy],
    ],
    darken(body, 0.24),
    edge,
    outline,
  )
  quad(
    [
      [gx, top],
      [gx + dx, lid],
      [gx + bw + dx, lid],
      [gx + bw, top],
    ],
    lighten(body, 0.18),
    edge,
    outline,
  )

  // The ribbon, in three pieces that are one ribbon: up the front, back across
  // the lid, and down the far side. `u` runs along the depth direction and `s`
  // across the width, so each piece is just a band in that little coordinate
  // system.
  const half = rw / (2 * Math.hypot(dx, dy))
  const lidPt = (s: number, u: number): [number, number] => [gx + s * bw + dx * u, top - dy * u]
  const sidePt = (u: number, t: number): [number, number] => [
    gx + bw + dx * u,
    top - dy * u + t * bh,
  ]

  const sw = rw / (2 * bw)
  quad(
    [
      [gx + s0 * bw - rw / 2, top],
      [gx + s0 * bw + rw / 2, top],
      [gx + s0 * bw + rw / 2, gy],
      [gx + s0 * bw - rw / 2, gy],
    ],
    ribbon,
    null,
    0,
  )
  quad(
    [lidPt(s0 - sw, 0), lidPt(s0 + sw, 0), lidPt(s0 + sw, 1), lidPt(s0 - sw, 1)],
    lighten(ribbon, 0.14),
    null,
    0,
  )
  quad(
    [lidPt(0, u0 - half), lidPt(1, u0 - half), lidPt(1, u0 + half), lidPt(0, u0 + half)],
    lighten(ribbon, 0.14),
    null,
    0,
  )
  quad(
    [sidePt(u0 - half, 0), sidePt(u0 + half, 0), sidePt(u0 + half, 1), sidePt(u0 - half, 1)],
    darken(ribbon, 0.22),
    null,
    0,
  )

  // The bow, where the two lid bands cross. Two loops, two tails and a knot:
  // the tails are what stop it reading as a pair of spectacles.
  const [bx, by] = lidPt(s0, u0)
  const lr = Math.max(4, bw * 0.17)
  const bowFill = lighten(ribbon, 0.1)
  const bowEdge = darken(ribbon, 0.4)
  const loop = (sign: number): void => {
    ctx.beginPath()
    ctx.ellipse(bx + sign * lr * 0.78, by - lr * 0.26, lr * 0.8, lr * 0.5, sign * 0.42, 0, Math.PI * 2)
    ctx.fillStyle = bowFill
    ctx.fill()
    ctx.lineWidth = Math.max(1, bw * 0.012)
    ctx.strokeStyle = bowEdge
    ctx.stroke()
  }
  const tail = (sign: number): void => {
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.quadraticCurveTo(bx + sign * lr * 0.5, by + lr * 0.5, bx + sign * lr * 1.05, by + lr * 0.72)
    ctx.lineTo(bx + sign * lr * 0.72, by + lr * 0.28)
    ctx.closePath()
    ctx.fillStyle = darken(ribbon, 0.1)
    ctx.fill()
  }
  tail(-1)
  tail(1)
  loop(-1)
  loop(1)
  ctx.beginPath()
  ctx.arc(bx, by, lr * 0.28, 0, Math.PI * 2)
  ctx.fillStyle = darken(ribbon, 0.16)
  ctx.fill()
  ctx.lineWidth = Math.max(1, bw * 0.012)
  ctx.strokeStyle = bowEdge
  ctx.stroke()
}

/**
 * Three wrapped boxes stacked along the foot of the box.
 *
 * A pile and not a row: one large box on the left with a small one balanced on
 * its lid, and a middle sized one standing beside them. Three boxes in a line
 * at three heights reads as a chart. The arrangement is fixed and only the
 * colours and the small box's lean come off the seed, because this piece sits
 * under a headline and a pile that reshuffled its own silhouette between two
 * cards of the same set would look like two different ornaments.
 */
export const drawGifts: Ornament = (ctx, o) => {
  const { w, h, p } = o
  const rnd = rng(o.seed ?? 1)
  open(ctx, o)
  const set = bodies(p)

  // The floor sits a little above the bottom edge so the boxes have somewhere
  // to cast their shadow, and so a caller butting this ornament against a band
  // does not get boxes apparently sunk into it.
  const k = Math.floor(rnd() * 4)

  // One unit sets every box, and it is bounded by the HEIGHT as well as the
  // width. Sized off the width alone, a foot strip four times as wide as it is
  // deep produced three boxes a quarter as tall as they were broad, which read
  // as packing crates. Bounded, a shallow strip simply gets smaller boxes with
  // air at the sides, which is the right answer for an ornament under a line
  // of type.
  const unit = Math.min(w * 0.3, h * 0.6)
  const big = { x: 0, w: unit, h: unit * 0.72 }
  const mid = { x: 0, w: unit * 0.78, h: unit * 0.54 }
  const gap = unit * 0.12
  const span = big.w + gap + mid.w + mid.w * 0.24
  big.x = (w - span) / 2
  mid.x = big.x + big.w + gap

  // The floor leaves the pile room for the small box on top of the large one
  // plus the lid it stands on, so the stack cannot run off the top edge of a
  // shallow box.
  const floor = Math.min(h * 0.94, h - unit * 0.06)

  // A soft ground shadow, one ellipse under the whole pile. Per box shadows
  // fought with each other where the boxes overlap.
  ctx.fillStyle = soft(SOOT, 0.13)
  ctx.beginPath()
  ctx.ellipse(big.x + span / 2, floor + unit * 0.03, span * 0.56, unit * 0.07, 0, 0, Math.PI * 2)
  ctx.fill()

  gift(ctx, mid.x, floor, mid.w, mid.h, pick(set, k + 2), pick(set, k + 1))
  // The large box wears its bow to the front left, out from under the small
  // one. A centred knot and a box standing on the lid cannot both have the
  // middle of it, and of the two the bow is the part a reader looks for.
  gift(ctx, big.x, floor, big.w, big.h, pick(set, k), pick(set, k + 3), 0.3, 0.36)

  // The small box stands on the lid of the large one, pushed to the BACK LEFT
  // of it. Centred on the lid, which is where it went first, it sat squarely on
  // top of the large box's bow and hid it, and the large box was left showing a
  // ribbon that ran up its front and stopped for no reason. Back and to one
  // side, both bows are visible and the pile gains a diagonal.
  const smallW = unit * 0.5
  const smallH = unit * 0.4
  const back = 0.82
  const lidY = floor - big.h - big.h * 0.26 * back
  ctx.save()
  // Far enough back and across to stand ON the lid: the small box's own depth
  // is added to its width when working out whether it fits, since the box that
  // overhangs the lid's back edge reads as floating rather than as stacked.
  ctx.translate(big.x + big.w * 0.62 + big.w * 0.24 * back, lidY)
  ctx.rotate((rnd() - 0.5) * 0.12)
  gift(ctx, -smallW / 2, 0, smallW, smallH, pick(set, k + 1), pick(set, k + 2))
  ctx.restore()

  ctx.restore()
}

/* ===========================================================================
   Bunting
   =========================================================================== */

/**
 * A slack cord between two points, sampled.
 *
 * A real string between two nails is a catenary, and a parabola is within a
 * pixel of one over this span, so the parabola is what is drawn: `cosh` costs
 * more arithmetic per sample and no reader could tell the two apart at the size
 * a poster prints at.
 */
const cordAt = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  sag: number,
  t: number,
): [number, number] => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + 4 * sag * t * (1 - t)]

/**
 * One string of triangular flags.
 *
 * The flags hang PERPENDICULAR TO THE CORD, not straight down, and that is the
 * single decision this routine exists to get right. Triangles dropped vertically
 * from a sagging line splay apart at the ends and crowd in the middle, and the
 * cord stops reading as one string with flags on it: it reads as a line with a
 * row of unrelated triangles under it. Taking the tangent at each flag's own
 * point and hanging the flag off its normal keeps the row even the whole way
 * along, and makes the ends of the string tip outwards the way real bunting
 * does.
 */
function buntingRun(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  sag: number,
  flagW: number,
  set: string[],
  offset: number,
  cord: string,
): void {
  const steps = 96
  ctx.beginPath()
  for (let i = 0; i <= steps; i += 1) {
    const [px, py] = cordAt(x0, y0, x1, y1, sag, i / steps)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.lineWidth = Math.max(1.4, flagW * 0.07)
  ctx.lineCap = 'round'
  ctx.strokeStyle = cord
  ctx.stroke()

  const span = Math.hypot(x1 - x0, y1 - y0) + Math.abs(sag) * 1.4
  const n = Math.max(3, Math.round(span / (flagW * 1.12)))
  const fl = flagW * 1.42

  for (let k = 0; k < n; k += 1) {
    const t = (k + 0.5) / n
    const [px, py] = cordAt(x0, y0, x1, y1, sag, t)
    const e = 0.5 / steps
    const [ax, ay] = cordAt(x0, y0, x1, y1, sag, Math.max(0, t - e))
    const [bx, by] = cordAt(x0, y0, x1, y1, sag, Math.min(1, t + e))
    const len = Math.hypot(bx - ax, by - ay) || 1
    const tx = (bx - ax) / len
    const ty = (by - ay) / len
    // Whichever normal points down the page. The cord rises on one half of a
    // sag and falls on the other, so the sign cannot be assumed.
    let nx = -ty
    let ny = tx
    if (ny < 0) {
      nx = -nx
      ny = -ny
    }
    const hw = flagW * 0.46
    const fill = pick(set, k + offset)
    ctx.beginPath()
    ctx.moveTo(px - tx * hw, py - ty * hw)
    ctx.lineTo(px + tx * hw, py + ty * hw)
    ctx.lineTo(px + nx * fl, py + ny * fl)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.lineWidth = Math.max(1, flagW * 0.035)
    ctx.strokeStyle = darken(fill, 0.4)
    ctx.stroke()
    // A darker wedge down the trailing half. Flat triangles at this size look
    // printed on; a fold gives them a front and a back.
    ctx.beginPath()
    ctx.moveTo(px + tx * hw * 0.1, py + ty * hw * 0.1)
    ctx.lineTo(px + tx * hw, py + ty * hw)
    ctx.lineTo(px + nx * fl, py + ny * fl)
    ctx.closePath()
    ctx.fillStyle = soft(darken(fill, 0.6), 0.16)
    ctx.fill()
  }
}

/**
 * Two or three strings of bunting across the top of the box.
 *
 * The runs cross rather than sit parallel: each one starts and ends at a
 * different height, so the second passes under the first at one end and over it
 * at the other. Parallel runs at an even spacing read as ruled lines, which is
 * the failure this whole ornament exists to avoid.
 *
 * The third run is drawn only when the box is deep enough to hold it under the
 * first two, since a run whose flags would be clipped by the bottom edge is
 * worse than no third run.
 */
export const drawBunting: Ornament = (ctx, o) => {
  const { w, h, p } = o
  const rnd = rng(o.seed ?? 1)
  open(ctx, o)
  const set = bodies(p)
  const cord = soft(thread(p), 0.9)

  const flagW = clamp(w * 0.052, 10, 54)
  const fl = flagW * 1.42
  const inset = flagW * 0.35

  interface Run {
    y0: number
    y1: number
    sag: number
    /** Flag size against the base, which is this run's distance from the reader. */
    scale: number
  }
  const runs: Run[] = [
    { y0: h * 0.06, y1: h * 0.14, sag: h * 0.14, scale: 0.84 },
    { y0: h * 0.2, y1: h * 0.08, sag: h * 0.17, scale: 1 },
  ]
  // Room for a third means room for its sag and its flags with a little air
  // under them, measured rather than guessed at a ratio.
  const third = { y0: h * 0.34, y1: h * 0.3, sag: h * 0.15, scale: 1.12 }
  if (third.y0 + third.sag + fl * third.scale < h * 0.97) runs.push(third)

  runs.forEach((r, i) => {
    // Each run starts its colour rota on a different foot, so two crossing
    // strings never show the same colour at the crossing. The sizes differ too:
    // three runs of identical flags at an even spacing read as ruled lines,
    // and the near one being frankly bigger is what puts air between them.
    const offset = i * 2 + Math.floor(rnd() * 3)
    buntingRun(ctx, inset, r.y0, w - inset, r.y1, r.sag, flagW * r.scale, set, offset, cord)
  })

  ctx.restore()
}

/* ===========================================================================
   Confetti
   =========================================================================== */

/**
 * A tapered streamer: a ribbon that curls as it falls.
 *
 * Built as a filled shape from two offset copies of a wave rather than as a
 * stroked line, because a stroke has one width for its whole length and a
 * paper streamer does not: it is wide where it faces the reader and narrow
 * where it has twisted edge on. The half width is tapered by a sine along the
 * length, which is what produces the pinch in the middle that makes the curl
 * legible.
 */
function streamer(
  ctx: CanvasRenderingContext2D,
  len: number,
  amp: number,
  wide: number,
  phase: number,
  fill: string,
): void {
  const steps = 22
  const top: Array<[number, number]> = []
  const bot: Array<[number, number]> = []
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps
    const px = u * len
    const py = Math.sin(u * Math.PI * 1.7 + phase) * amp
    const dx = 1
    const dy = Math.cos(u * Math.PI * 1.7 + phase) * amp * ((Math.PI * 1.7) / len)
    const m = Math.hypot(dx, dy)
    const hw = wide * (0.25 + 0.75 * Math.abs(Math.sin(u * Math.PI * 1.6 + 0.5)))
    top.push([px - (dy / m) * hw, py + (dx / m) * hw])
    bot.push([px + (dy / m) * hw, py - (dx / m) * hw])
  }
  ctx.beginPath()
  top.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)))
  for (let i = bot.length - 1; i >= 0; i -= 1) {
    const q = bot[i]
    if (q) ctx.lineTo(q[0], q[1])
  }
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.stroke()
}

/**
 * A scatter of paper falling through the box.
 *
 * Three kinds and not one. Flat rectangles alone come out as a field of evenly
 * lit dashes, so a third of the pieces are drawn as a trapezium instead, which
 * is what a square of paper looks like at the moment it turns edge on, and a
 * few are streamers curling as they fall. Between them the scatter has near and
 * far pieces and stops looking like a texture.
 *
 * The count is taken from the AREA of the box rather than fixed, so the same
 * ornament is not sparse across a full card and choked in a corner motif.
 */
export const drawConfetti: Ornament = (ctx, o) => {
  const { w, h, p } = o
  const rnd = rng(o.seed ?? 1)
  const alpha = open(ctx, o)
  const set = bodies(p)

  // The size of a piece is bounded by the shorter side, but a shallow strip is
  // allowed pieces larger than its own depth: keyed to the height alone, a foot
  // strip across a full card came back covered in six pixel specks that read as
  // dust on the scan rather than as paper in the air.
  const unit = Math.min(w, h * 2.2)
  // Density measured against the size of a piece rather than against the box,
  // so a strip and a full card get the same scatter and not the same COUNT.
  // The first pass divided by too large a figure and put eighteen pieces across
  // a whole card, which reads as a printing fault rather than as confetti.
  const n = clamp(Math.round((w * h) / (unit * unit * 0.015)), 24, 110)
  // Walked, not rolled, for the reason given in the balloons.
  const start = Math.floor(rnd() * 4)

  // Scattered over a jittered GRID rather than at free random points. A uniform
  // scatter is not an even one: the first version left a bare band across the
  // middle of one card and a knot of six pieces in the corner of another, and a
  // reader reads that as the ornament having failed rather than as chance. One
  // piece per cell, thrown anywhere inside its cell, covers the box and still
  // has nothing regular about it.
  const cols = Math.max(1, Math.round(Math.sqrt((n * w) / h)))
  const rows = Math.max(1, Math.ceil(n / cols))
  const cellW = w / cols
  const cellH = h / rows

  for (let i = 0; i < cols * rows; i += 1) {
    const px = (i % cols) * cellW + cellW * (0.12 + rnd() * 0.76)
    const py = Math.floor(i / cols) * cellH + cellH * (0.12 + rnd() * 0.76)
    const turn = (rnd() - 0.5) * Math.PI * 1.6
    const fill = pick(set, i + start)
    // Depth: the faint pieces read as further back. Nothing goes below about
    // three quarters, since a piece any fainter than that disappears entirely
    // on the deep party grounds and the scatter starts to look uneven.
    const depth = 0.74 + rnd() * 0.26
    const scale = 0.6 + rnd() * 0.8
    const kind = rnd()

    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(turn)
    ctx.globalAlpha = alpha * depth

    // Every piece is outlined, which matters most for the paper white ones: on
    // cream they are the same colour as the ground and the edge is the only
    // thing that makes them a piece of paper rather than a gap.
    ctx.lineWidth = Math.max(0.7, unit * 0.0022)
    ctx.strokeStyle = darken(fill, 0.36)
    ctx.fillStyle = fill

    if (kind < 0.1) {
      // Short and tight. Long ones at a big amplitude, which is where this
      // started, stopped being paper falling and became a scatter of worms
      // across the card, and they pulled the eye off everything else in it.
      streamer(ctx, unit * 0.1 * scale, unit * 0.015 * scale, unit * 0.008 * scale, rnd() * 6, fill)
    } else if (kind < 0.48) {
      // Edge on: the far edge shorter than the near one.
      const pw = unit * 0.036 * scale
      const ph = unit * 0.019 * scale
      const squash = 0.3 + rnd() * 0.5
      ctx.beginPath()
      ctx.moveTo(-pw / 2, -ph / 2)
      ctx.lineTo(pw / 2, -ph / 2)
      ctx.lineTo((pw / 2) * squash, ph / 2)
      ctx.lineTo((-pw / 2) * squash, ph / 2)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    } else {
      const pw = unit * 0.032 * scale
      const ph = unit * 0.015 * scale
      ctx.beginPath()
      ctx.rect(-pw / 2, -ph / 2, pw, ph)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }

  ctx.restore()
}

/* ===========================================================================
   Cake
   =========================================================================== */

/**
 * A tier: a cylinder, drawn as a body with an elliptical top and a rounded
 * bottom.
 *
 * Two flat rectangles stacked would be the cheap version and it looks like two
 * flat rectangles stacked. The ellipse at the top is the only thing that tells
 * a reader they are looking down slightly at a round cake, and it is also what
 * the piping and the candles are laid out along, so it has to be a real curve
 * and not a suggestion.
 */
function tier(
  ctx: CanvasRenderingContext2D,
  cx: number,
  topY: number,
  baseY: number,
  rx: number,
  ry: number,
  fill: string,
): void {
  ctx.beginPath()
  ctx.moveTo(cx - rx, topY)
  ctx.lineTo(cx - rx, baseY)
  ctx.ellipse(cx, baseY, rx, ry, 0, Math.PI, 0, true)
  ctx.lineTo(cx + rx, topY)
  ctx.ellipse(cx, topY, rx, ry, 0, 0, Math.PI, true)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()

  // The curve of the side, as a gradient across the cylinder. Drawn first as
  // two flat panels, one light and one dark, which gave the cake two vertical
  // seams down its front and made it read as a hexagonal box. A round thing
  // has no seams, so the shading cannot have edges either.
  ctx.save()
  ctx.clip()
  const round = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0)
  round.addColorStop(0, soft(darken(fill, 0.6), 0.14))
  round.addColorStop(0.24, soft('#ffffff', 0.16))
  round.addColorStop(0.55, soft('#ffffff', 0))
  round.addColorStop(1, soft(darken(fill, 0.6), 0.24))
  ctx.fillStyle = round
  ctx.fillRect(cx - rx, topY - ry, rx * 2, baseY - topY + ry * 2)
  ctx.restore()

  ctx.lineWidth = Math.max(1, rx * 0.018)
  ctx.strokeStyle = darken(fill, 0.4)
  ctx.stroke()

  // The top face, lit, so the tier has a surface for the tier above to stand on.
  ctx.beginPath()
  ctx.ellipse(cx, topY, rx, ry, 0, 0, Math.PI * 2)
  ctx.fillStyle = lighten(fill, 0.22)
  ctx.fill()
  ctx.strokeStyle = darken(fill, 0.3)
  ctx.stroke()
}

/**
 * A row of piped icing beads following the rim of a tier.
 *
 * Spaced by ARC LENGTH and not by angle, which is the whole of this function.
 * A tier's rim is a flattened ellipse, so equal steps in angle put the beads
 * three times closer together at the left and right ends than across the front,
 * and the first render came back with an even row along the front of the cake
 * and two lumps of icing piled up at the sides. The rim is sampled, its length
 * accumulated, and the beads dropped at even distances along it.
 */
function piping(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  bead: number,
  fill: string,
): void {
  const steps = 240
  const pts: Array<[number, number]> = []
  const run: number[] = [0]
  for (let i = 0; i <= steps; i += 1) {
    const a = (Math.PI * 2 * i) / steps
    const px = cx + Math.cos(a) * rx
    const py = cy + Math.sin(a) * ry
    pts.push([px, py])
    if (i > 0) {
      const q = pts[i - 1] ?? [px, py]
      run.push((run[i - 1] ?? 0) + Math.hypot(px - q[0], py - q[1]))
    }
  }
  const total = run[steps] ?? 0
  const n = Math.max(10, Math.round(total / (bead * 1.7)))
  ctx.lineWidth = Math.max(0.8, bead * 0.16)
  ctx.strokeStyle = darken(fill, 0.3)
  ctx.fillStyle = fill
  let at = 0
  for (let k = 0; k < n; k += 1) {
    const want = (total * k) / n
    while (at < steps && (run[at + 1] ?? total) < want) at += 1
    const q = pts[at] ?? [cx, cy]
    ctx.beginPath()
    ctx.arc(q[0], q[1], bead, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
}

/**
 * A two tier cake on a plate at the foot of the box, candles lit.
 *
 * Laid out from the plate upwards and sized against BOTH dimensions, because
 * this is the one piece in the set with a fixed proportion to keep: a cake
 * stretched to fill a wide shallow strip stops being a cake and becomes a
 * wedding marquee. In a box wider than the cake wants, it centres and leaves
 * the air at the sides, which is the right answer for an ornament that sits
 * under a headline.
 *
 * The flames are the only part not taken from the palette, for the reason given
 * at the head of this file.
 */
export const drawCake: Ornament = (ctx, o) => {
  const { w, h, p } = o
  const rnd = rng(o.seed ?? 1)
  open(ctx, o)
  const set = bodies(p)
  const second = p.accent2 ?? lighten(p.bg, 0.44)

  // The cake wants to be about twice as wide as the lower tier and about as
  // tall as the box; whichever of the two runs out first sets the scale.
  const unit = Math.min(w * 0.3, h * 0.42)
  const cx = w / 2

  // Plate: two ellipses, the lower one darker, which is a rim without having to
  // draw a rim. Its centre is set from the rim's own depth rather than from a
  // fraction of the box, because a plate placed at nine tenths of the height
  // put half its front rim below the bottom edge and the cake came back
  // standing on a plate sliced off flat.
  const prx = unit * 1.24
  const pry = prx * 0.17
  const plateY = h - pry * 1.55
  ctx.beginPath()
  ctx.ellipse(cx, plateY + pry * 0.42, prx, pry, 0, 0, Math.PI * 2)
  ctx.fillStyle = darken(lighten(p.accent, 0.62), 0.22)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(cx, plateY, prx, pry, 0, 0, Math.PI * 2)
  ctx.fillStyle = lighten(p.accent, 0.72)
  ctx.fill()
  ctx.lineWidth = Math.max(1, unit * 0.014)
  ctx.strokeStyle = darken(lighten(p.accent, 0.62), 0.34)
  ctx.stroke()

  const rx1 = unit
  const ry1 = rx1 * 0.2
  const base1 = plateY - pry * 0.3
  const top1 = base1 - unit * 0.62

  const rx2 = unit * 0.62
  const ry2 = rx2 * 0.2
  const base2 = top1 + ry1 * 0.35
  const top2 = base2 - unit * 0.5

  tier(ctx, cx, top1, base1, rx1, ry1, p.bg)

  // Sprinkles on the lower tier, in the second colour, kept to the front half
  // of the cylinder so none of them lands on the shaded edge and reads as dirt.
  for (let i = 0; i < 9; i += 1) {
    const sx = cx + (rnd() - 0.5) * rx1 * 1.5
    const sy = top1 + ry1 + (base1 - top1 - ry1) * (0.2 + rnd() * 0.7)
    ctx.save()
    ctx.translate(sx, sy)
    ctx.rotate((rnd() - 0.5) * 1.6)
    ctx.fillStyle = soft(second, 0.9)
    ctx.fillRect(-unit * 0.035, -unit * 0.012, unit * 0.07, unit * 0.024)
    ctx.restore()
  }

  piping(ctx, cx, top1, rx1 * 0.99, ry1 * 0.99, Math.max(2, unit * 0.048), PAPER)

  tier(ctx, cx, top2, base2, rx2, ry2, PAPER)
  piping(ctx, cx, top2, rx2 * 0.99, ry2 * 0.99, Math.max(1.6, unit * 0.032), second)

  // The candles stand on the front half of the top face, on the ellipse rather
  // than on a straight line, so the outer ones sit lower than the middle ones
  // and the row keeps the same perspective as the tier under it.
  const candles: number = 5
  const cw = Math.max(3, unit * 0.062)
  const tall = unit * 0.42
  for (let i = 0; i < candles; i += 1) {
    const u = candles === 1 ? 0 : -0.62 + (1.24 * i) / (candles - 1)
    const kx = cx + u * rx2
    const ky = top2 + ry2 * 0.34 * Math.cos(u * 1.5)
    const wax = pick(set, i % 2 === 0 ? 0 : 2)
    // Candles burn down at their own rate and a row of five identical ones
    // reads as a comb. The variation is small and seeded, so the card is the
    // same card every time it is drawn.
    const ch = tall * (0.86 + rnd() * 0.2)

    ctx.fillStyle = wax
    ctx.fillRect(kx - cw / 2, ky - ch, cw, ch)
    ctx.lineWidth = Math.max(0.8, cw * 0.13)
    ctx.strokeStyle = darken(wax, 0.42)
    ctx.strokeRect(kx - cw / 2, ky - ch, cw, ch)
    // One stripe, banded round the candle. Two or three at this size turn into
    // a smear.
    ctx.fillStyle = soft(darken(wax, 0.45), 0.5)
    ctx.fillRect(kx - cw / 2, ky - ch * 0.62, cw, cw * 0.34)

    // Wick, then the flame: an outer teardrop and a hotter core inside it.
    ctx.strokeStyle = SOOT
    ctx.lineWidth = Math.max(0.9, cw * 0.16)
    ctx.beginPath()
    ctx.moveTo(kx, ky - ch)
    ctx.lineTo(kx, ky - ch - cw * 0.34)
    ctx.stroke()

    const fy = ky - ch - cw * 0.34
    const fh = cw * 1.5
    const flame = (scale: number, fill: string): void => {
      ctx.beginPath()
      ctx.moveTo(kx, fy - fh * scale)
      ctx.bezierCurveTo(
        kx + cw * 0.42 * scale,
        fy - fh * 0.42 * scale,
        kx + cw * 0.36 * scale,
        fy + cw * 0.1 * scale,
        kx,
        fy + cw * 0.12 * scale,
      )
      ctx.bezierCurveTo(
        kx - cw * 0.36 * scale,
        fy + cw * 0.1 * scale,
        kx - cw * 0.42 * scale,
        fy - fh * 0.42 * scale,
        kx,
        fy - fh * scale,
      )
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
    }
    // A glow first, wide and faint. Without it the flames read as orange leaves.
    ctx.fillStyle = soft(FLAME, 0.16)
    ctx.beginPath()
    ctx.ellipse(kx, fy - fh * 0.4, cw * 1.1, fh * 0.9, 0, 0, Math.PI * 2)
    ctx.fill()
    flame(1, FLAME)
    flame(0.5, FLAME_CORE)
  }

  ctx.restore()
}
