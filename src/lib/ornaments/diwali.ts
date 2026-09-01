/**
 * The Diwali set: the lamps, flowers, garlands and glow that go along the foot
 * and over the head of a festival card.
 *
 * WHY THE NATURALS ARE NOT TAKEN FROM THE PALETTE. Rule 3 in kit.ts says take
 * your colours from `p`, and most of this file does. Four colours here do not,
 * and each of them is a fact about the object rather than a choice about the
 * card: clay is a fired terracotta brown, a flame is amber going to white at
 * its core, a marigold is orange or gold, and a mango leaf is green. A green
 * flame is not a flame, and a blue marigold is not a marigold; a desk of any
 * party lighting a lamp lights the same coloured lamp. What the palette does
 * own is everything the card chose to hang up: the lantern paper, the glow the
 * lamps throw, the tassels on the garland, the tint in the sparkle. That is the
 * line, and it is drawn where the object stops being an object and starts being
 * decoration.
 *
 * WHY EVERY PIECE CLIPS TO ITS BOX. A lamp's glow and a bloom's outer petals
 * are soft edges, and a soft edge is exactly the kind that creeps two units
 * past the box while looking fine in isolation. The caller has already worked
 * out that the box is free, so each export clips to it once at the top: past
 * the edge the piece simply stops, rather than landing on somebody's face.
 */

import { clamp, mix, rng, soft, type Ornament, type OrnamentOptions } from './kit'

/* ===========================================================================
   The naturals
   =========================================================================== */

/** Fired terracotta, the colour a diya actually comes out of the kiln. */
const CLAY = '#9d5a33'
const CLAY_DARK = '#5f3319'
const CLAY_LIGHT = '#cf8b57'

/**
 * The flame, from its base to its tip. A wick flame is close to white where it
 * is hottest and runs to orange at the point, which is why this is three
 * colours and not one: a single amber fill reads as a plastic teardrop.
 */
const FLAME_HOT = '#fff4cd'
const FLAME_MID = '#ffc23f'
const FLAME_TIP = '#f4700c'

/** Marigold, in its two common market colours, and the leaf that comes with it. */
const PETAL_DEEP = '#e3670e'
const PETAL_GOLD = '#f8b62a'
const LEAF = '#40803a'
const LEAF_DARK = '#295623'

/**
 * A warm near-black for contact shadows and wicks.
 *
 * Not `p.ink`: the ink of a palette is a text colour that can be almost white
 * on a dark card, and a lamp's shadow that turns white when the ground turns
 * dark is not a shadow. This one is always laid at a low alpha, so on a light
 * ground it grounds the object and on a dark one it all but disappears, which
 * is what a shadow does on a dark floor anyway.
 */
const SHADE = '#3a2413'

/* ===========================================================================
   Shared shapes
   =========================================================================== */

/**
 * One marigold: three rings of overlapping petals packed around a knot.
 *
 * Two things separate this from the scalloped clipart flower it would
 * otherwise be. The rings step in TONE rather than in hue, deep at the rim and
 * gold at the crown, so the bloom reads as a dome instead of as a ring inside a
 * ring; and every petal's size and seat is jittered, so the outline is a little
 * ragged the way a genda's is. Three rings is the fewest that closes the middle
 * up: with two, the eye finds the gap and reads a daisy.
 */
function bloom(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  deep: string,
  gold: string,
  rand: () => number,
): void {
  const turn = rand() * Math.PI * 2
  const rings: Array<{ at: number; n: number; len: number; wide: number; col: string }> = [
    { at: 0.68, n: 15, len: 0.36, wide: 0.24, col: deep },
    { at: 0.45, n: 12, len: 0.32, wide: 0.22, col: mix(deep, gold, 0.5) },
    { at: 0.24, n: 9, len: 0.28, wide: 0.2, col: mix(deep, gold, 0.85) },
  ]

  for (const ring of rings) {
    ctx.fillStyle = ring.col
    ctx.strokeStyle = soft(deep, 0.28)
    ctx.lineWidth = Math.max(0.5, r * 0.02)
    for (let i = 0; i < ring.n; i++) {
      const a = turn * ring.at + (i / ring.n) * Math.PI * 2
      const seat = ring.at * (0.94 + rand() * 0.12)
      const k = 0.86 + rand() * 0.26
      ctx.beginPath()
      ctx.ellipse(
        cx + Math.cos(a) * r * seat,
        cy + Math.sin(a) * r * seat,
        r * ring.len * k,
        r * ring.wide * k,
        a,
        0,
        Math.PI * 2,
      )
      ctx.fill()
      ctx.stroke()
    }
  }

  // The crown: a knot of very small petals, not a disc in a third colour. A
  // marigold has no eye, and drawing one is what makes a flower look printed.
  ctx.fillStyle = gold
  for (let i = 0; i < 7; i++) {
    const a = turn + (i / 7) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(cx + Math.cos(a) * r * 0.12, cy + Math.sin(a) * r * 0.12, r * 0.12, 0, Math.PI * 2)
    ctx.fill()
  }
}

/**
 * One leaf, growing along +y from its stem end, then rotated into place.
 *
 * Rotating rather than drawing the curve at an angle keeps the shape identical
 * whichever way it points, which is what stops a scattered cluster looking like
 * several different plants.
 */
function leaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  wid: number,
  angle: number,
  fill: string,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(wid, len * 0.44, 0, len)
  ctx.quadraticCurveTo(-wid, len * 0.44, 0, 0)
  ctx.fillStyle = fill
  ctx.fill()
  // The midrib is what separates a leaf from a pointed blob at small sizes.
  ctx.beginPath()
  ctx.moveTo(0, len * 0.06)
  ctx.lineTo(0, len * 0.92)
  ctx.lineWidth = Math.max(1, len * 0.035)
  ctx.strokeStyle = soft(LEAF_DARK, 0.6)
  ctx.stroke()
  ctx.restore()
}

/**
 * A four-pointed twinkle: a diamond with its sides pulled in to the waist, at
 * whatever angle it was given. The angle matters more than it sounds: a field
 * of stars all square to the page reads as a repeated glyph, and a quarter
 * turn on some of them is the cheapest possible cure.
 */
function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, turn: number): void {
  const k = r * 0.1
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(turn)
  ctx.translate(-cx, -cy)
  ctx.beginPath()
  ctx.moveTo(cx, cy - r)
  ctx.quadraticCurveTo(cx + k, cy - k, cx + r, cy)
  ctx.quadraticCurveTo(cx + k, cy + k, cx, cy + r)
  ctx.quadraticCurveTo(cx - k, cy + k, cx - r, cy)
  ctx.quadraticCurveTo(cx - k, cy - k, cx, cy - r)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/* ===========================================================================
   The lamps
   =========================================================================== */

/**
 * One lit diya, standing with its foot on `baseY`.
 *
 * The order of the parts is the whole trick. The contact shadow goes down
 * first, then the clay, then the glow OVER the clay so the lamp is warmed by
 * its own flame, then the flame last so nothing veils it. Drawing the glow
 * before the bowl instead leaves a lamp that appears to be lit from behind.
 */
function diya(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  lw: number,
  glow: string,
  front: boolean,
  rand: () => number,
): void {
  const hw = lw / 2
  const bowlH = lw * 0.33
  const rimY = baseY - bowlH
  const rimRy = lw * 0.085
  // Which end the wick sits on. A row where every lamp is pinched on the same
  // side reads as one stamp repeated, and that is the failure this whole file
  // is trying to avoid.
  const dir = rand() < 0.5 ? -1 : 1

  ctx.beginPath()
  ctx.ellipse(cx, baseY + lw * 0.015, hw * 0.85, lw * 0.055, 0, 0, Math.PI * 2)
  ctx.fillStyle = soft(SHADE, 0.22)
  ctx.fill()

  // The body: down from the rim on both sides to a narrow foot, then closed
  // along the front half of the rim ellipse so the lamp is seen slightly from
  // above, which is how one on a step in front of you looks.
  ctx.beginPath()
  ctx.moveTo(cx - hw, rimY)
  ctx.bezierCurveTo(cx - hw, rimY + bowlH * 0.66, cx - lw * 0.34, baseY, cx - lw * 0.2, baseY)
  ctx.lineTo(cx + lw * 0.2, baseY)
  ctx.bezierCurveTo(cx + lw * 0.34, baseY, cx + hw, rimY + bowlH * 0.66, cx + hw, rimY)
  ctx.ellipse(cx, rimY, hw, rimRy, 0, 0, Math.PI)
  ctx.closePath()
  const body = ctx.createLinearGradient(cx - hw, 0, cx + hw, 0)
  body.addColorStop(0, mix(CLAY, CLAY_DARK, 0.45))
  body.addColorStop(0.38, CLAY)
  body.addColorStop(1, mix(CLAY, CLAY_DARK, 0.55))
  ctx.fillStyle = body
  ctx.fill()

  // The wick lip: a pinch in the rim, pulled out to one side. It is kept
  // between the rim's own top and bottom and filled in the body's colour,
  // because a lip drawn taller or lighter than the rim stops reading as a
  // pinch in the clay and starts reading as a tab stuck on the side.
  ctx.beginPath()
  ctx.moveTo(cx + dir * hw * 0.42, rimY - rimRy * 0.55)
  ctx.quadraticCurveTo(cx + dir * hw * 0.95, rimY - rimRy * 0.5, cx + dir * hw * 1.17, rimY - rimRy * 0.1)
  ctx.quadraticCurveTo(cx + dir * hw * 0.98, rimY + rimRy * 0.85, cx + dir * hw * 0.42, rimY + rimRy * 1.0)
  ctx.closePath()
  ctx.fillStyle = mix(CLAY, CLAY_DARK, dir > 0 ? 0.4 : 0.2)
  ctx.fill()

  // The oil inside, seen as the rim ellipse. Darker at the wall, warm in the
  // middle where the flame is standing in it.
  ctx.beginPath()
  ctx.ellipse(cx, rimY, hw * 0.99, rimRy, 0, 0, Math.PI * 2)
  ctx.fillStyle = CLAY_DARK
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(cx, rimY, hw * 0.72, rimRy * 0.62, 0, 0, Math.PI * 2)
  ctx.fillStyle = mix(CLAY_DARK, FLAME_MID, 0.42)
  ctx.fill()

  if (front) {
    // A lens of reflected light down the near shoulder. Only on the front
    // lamps: putting it on the ones behind flattens the row back into a line.
    ctx.beginPath()
    ctx.ellipse(cx, rimY + bowlH * 0.3, hw * 0.72, bowlH * 0.6, 0, Math.PI * 0.82, Math.PI * 1.12)
    ctx.lineWidth = lw * 0.035
    ctx.lineCap = 'round'
    ctx.strokeStyle = soft(CLAY_LIGHT, 0.34)
    ctx.stroke()
  }

  const fx = cx + dir * hw * 1.02
  const fy = rimY - lw * 0.07
  const fh = lw * (front ? 0.72 : 0.62)
  const fw = lw * 0.15

  // The wick, a dark stub between the oil and the flame. Two units of it, and
  // without them the flame appears to float.
  ctx.beginPath()
  ctx.moveTo(fx - dir * lw * 0.03, fy + lw * 0.06)
  ctx.lineTo(fx, fy - lw * 0.01)
  ctx.lineWidth = lw * 0.035
  ctx.strokeStyle = soft(SHADE, 0.8)
  ctx.stroke()

  // The halo. Wider than it is bright, and it takes a quarter of the card's
  // own colour so the light in the poster belongs to the poster, without a
  // blue card ending up with a blue flame around a yellow one.
  const hr = lw * 0.82
  const halo = ctx.createRadialGradient(fx, fy - fh * 0.45, 0, fx, fy - fh * 0.45, hr)
  halo.addColorStop(0, soft(mix(FLAME_MID, glow, 0.25), 0.42))
  halo.addColorStop(0.4, soft(mix(FLAME_TIP, glow, 0.35), 0.14))
  halo.addColorStop(1, soft(mix(FLAME_TIP, glow, 0.35), 0))
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(fx, fy - fh * 0.45, hr, 0, Math.PI * 2)
  ctx.fill()

  // The flame: a teardrop leaning very slightly away from the bowl, brightest
  // low and running to orange at the tip.
  const lean = dir * fw * 0.28
  ctx.beginPath()
  ctx.moveTo(fx, fy)
  ctx.bezierCurveTo(fx - fw, fy - fh * 0.3, fx - fw * 0.62 + lean, fy - fh * 0.74, fx + lean, fy - fh)
  ctx.bezierCurveTo(fx + fw * 0.62 + lean, fy - fh * 0.74, fx + fw, fy - fh * 0.3, fx, fy)
  ctx.closePath()
  const fire = ctx.createLinearGradient(0, fy, 0, fy - fh)
  fire.addColorStop(0, FLAME_MID)
  fire.addColorStop(0.42, mix(FLAME_MID, FLAME_TIP, 0.4))
  fire.addColorStop(1, FLAME_TIP)
  ctx.fillStyle = fire
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(fx, fy)
  ctx.bezierCurveTo(
    fx - fw * 0.5,
    fy - fh * 0.24,
    fx - fw * 0.34 + lean * 0.5,
    fy - fh * 0.46,
    fx + lean * 0.5,
    fy - fh * 0.58,
  )
  ctx.bezierCurveTo(fx + fw * 0.34 + lean * 0.5, fy - fh * 0.46, fx + fw * 0.5, fy - fh * 0.24, fx, fy)
  ctx.closePath()
  ctx.fillStyle = soft(FLAME_HOT, 0.92)
  ctx.fill()
}

/**
 * A row of lit diyas along the foot of the box.
 *
 * About one lamp per 150 units of width, which is the density a step of them
 * has on a real card: fewer and the row reads as three objects placed, more and
 * the flames merge into a band. Some lamps stand behind the line and some in
 * front of it, drawn back to front, because a single row of identical lamps on
 * one baseline is the thing that makes decoration look generated.
 */
export const drawDiyaRow: Ornament = (ctx, o) => {
  if (o.w <= 0 || o.h <= 0) return
  const rand = rng(o.seed ?? 1)
  ctx.save()
  ctx.beginPath()
  ctx.rect(o.x, o.y, o.w, o.h)
  ctx.clip()
  ctx.globalAlpha = o.alpha ?? 1

  const n = clamp(Math.round(o.w / 150), 2, 14)
  const step = o.w / n
  const baseY = o.y + o.h * 0.94
  // The lamp is about 1.15 of its own width tall once the flame is on it, so
  // the width is capped off the height as well as off the spacing. Without the
  // second cap a short wide strip grows lamps whose flames leave the box.
  const unit = Math.min(step * 0.78, o.h * 0.56)

  // The lip and its flame reach about three quarters of a width past the
  // centre, so the centres are held that far off both edges. Clipping alone
  // would keep the row in the box, but it would keep it in by cutting the end
  // lamps in half, and a halved lamp is worse than a slightly tighter row.
  const edge = unit * 0.78
  const lamps = Array.from({ length: n }, (_, i) => ({
    cx: clamp(
      o.x + step * (i + 0.5) + (rand() - 0.5) * step * 0.18,
      o.x + edge,
      o.x + o.w - edge,
    ),
    // Heights vary by a sixth, which is enough to break the stamp and not so
    // much that one lamp looks like a different object.
    lw: unit * (0.86 + rand() * 0.17),
    front: rand() > 0.36,
  }))

  for (const l of lamps) {
    if (l.front) continue
    // The lamps behind stand a little higher and a little quieter, which is
    // the whole of the depth in this row: no perspective, just size, height
    // and weight, and three is enough.
    ctx.globalAlpha = (o.alpha ?? 1) * 0.72
    diya(ctx, l.cx, baseY - unit * 0.26, l.lw * 0.8, o.p.bg, false, rand)
  }
  ctx.globalAlpha = o.alpha ?? 1
  for (const l of lamps) {
    if (l.front) diya(ctx, l.cx, baseY, l.lw, o.p.bg, true, rand)
  }

  ctx.restore()
}

/* ===========================================================================
   The flowers
   =========================================================================== */

/**
 * A scattered cluster of marigolds and leaves, to nestle beside the lamps.
 *
 * Scattered rather than arranged: the blooms sit on a rough diagonal with the
 * larger ones low, the leaves fan out from under them, and every position is
 * jittered off the seed. A grid of evenly spaced flowers reads as a border,
 * which is a different ornament with a different job.
 */
export const drawMarigolds: Ornament = (ctx, o) => {
  if (o.w <= 0 || o.h <= 0) return
  const rand = rng(o.seed ?? 1)
  ctx.save()
  ctx.beginPath()
  ctx.rect(o.x, o.y, o.w, o.h)
  ctx.clip()
  ctx.globalAlpha = o.alpha ?? 1

  const u = Math.min(o.w, o.h)
  const r = u * 0.19
  const n = clamp(Math.round((o.w * o.h) / (u * u * 0.3)), 3, 11)

  const heads = Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1)
    // Alternating high and low along the run, then jittered. A single row of
    // blooms is a border and a random cloud of them is confetti; a cluster is
    // the zigzag in between, which is also how a handful of them actually
    // falls when somebody sets them down beside a lamp.
    const lift = i % 2 === 0 ? 0.36 : 0.64
    const rr = r * (0.66 + rand() * 0.5)
    return {
      x: o.x + r * 1.05 + t * Math.max(0, o.w - r * 2.1) + (rand() - 0.5) * u * 0.16,
      y: clamp(
        o.y + o.h * lift + (rand() - 0.5) * o.h * 0.18,
        o.y + rr * 1.02,
        o.y + o.h - rr * 1.02,
      ),
      r: rr,
      gold: rand() < 0.45,
    }
  })

  // Leaves first, and every one of them anchored to a bloom's own centre
  // rather than to the box, so only the tips come out from behind the flower
  // and the cluster holds together instead of reading as flowers and foliage
  // placed separately.
  for (const b of heads) {
    const many = 1 + Math.floor(rand() * 2)
    for (let i = 0; i < many; i++) {
      const a = Math.PI * (0.12 + rand() * 0.76) * (rand() < 0.5 ? 1 : -1)
      leaf(ctx, b.x, b.y, b.r * (1.9 + rand() * 0.8), b.r * 0.4, a, i === 0 ? LEAF : LEAF_DARK)
    }
  }

  for (const b of heads) {
    ctx.beginPath()
    ctx.ellipse(b.x, b.y + b.r * 0.96, b.r * 0.68, b.r * 0.16, 0, 0, Math.PI * 2)
    ctx.fillStyle = soft(SHADE, 0.14)
    ctx.fill()
    bloom(ctx, b.x, b.y, b.r, b.gold ? PETAL_GOLD : PETAL_DEEP, b.gold ? '#ffe08a' : PETAL_GOLD, rand)
  }

  ctx.restore()
}

/* ===========================================================================
   The garland and the lanterns
   =========================================================================== */

/**
 * A toran strung across the top of the box: a slack cord with leaves and small
 * blooms hanging off it, and a tassel at each end.
 *
 * The cord is a catenary and not a parabola, and the difference is visible: a
 * parabola of the same sag is flatter where the cord leaves its nail, so it
 * reads as an arc drawn between two points rather than as string that has been
 * hung up and left. `cosh` is normalised here to reach 1 at both ends and 0 in
 * the middle, so the shape can be scaled to whatever sag the box allows.
 */
export const drawToran: Ornament = (ctx, o) => {
  if (o.w <= 0 || o.h <= 0) return
  const rand = rng(o.seed ?? 1)
  ctx.save()
  ctx.beginPath()
  ctx.rect(o.x, o.y, o.w, o.h)
  ctx.clip()
  ctx.globalAlpha = o.alpha ?? 1

  const inset = o.w * 0.03
  const span = o.w - inset * 2
  const topY = o.y + o.h * 0.08
  const sag = o.h * 0.3
  const a = 1.7
  const norm = Math.cosh(a) - 1
  const cordY = (t: number): number => topY + sag * (1 - (Math.cosh(a * (2 * t - 1)) - 1) / norm)
  const cordX = (t: number): number => o.x + inset + t * span

  ctx.beginPath()
  for (let i = 0; i <= 64; i++) {
    const t = i / 64
    if (i === 0) ctx.moveTo(cordX(t), cordY(t))
    else ctx.lineTo(cordX(t), cordY(t))
  }
  ctx.lineWidth = clamp(o.h * 0.022, 2, 7)
  ctx.lineCap = 'round'
  ctx.strokeStyle = mix(LEAF_DARK, SHADE, 0.45)
  ctx.stroke()

  // Hangers alternate leaf, bloom, leaf. They hang VERTICALLY rather than
  // along the normal of the cord: string obeys gravity, and hangers rotated to
  // sit square to the curve fan outwards at the ends like a comb.
  const n = clamp(Math.round(o.w / 74), 5, 22)
  const drop = o.h * 0.4
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    const px = cordX(t)
    const py = cordY(t)
    const jitter = 0.86 + rand() * 0.3
    if (i % 2 === 0) {
      leaf(ctx, px, py, drop * jitter, drop * 0.19, 0, i % 4 === 0 ? LEAF : LEAF_DARK)
    } else {
      const br = drop * 0.3 * jitter
      const by = py + drop * 0.42 * jitter
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(px, by - br * 0.5)
      ctx.lineWidth = clamp(o.h * 0.012, 1, 4)
      ctx.strokeStyle = soft(LEAF_DARK, 0.85)
      ctx.stroke()
      bloom(ctx, px, by, br, i % 3 === 0 ? PETAL_DEEP : PETAL_GOLD, '#ffd76a', rand)
    }
  }

  // The two ends. This is where the card's own colour enters the garland: the
  // knot and the strands are cloth, which a party office does buy in its own
  // colours, whereas the flowers on it are whatever the market had.
  const tassel = (px: number, py: number): void => {
    const len = o.h * 0.26
    const kr = clamp(o.h * 0.042, 3, 13)
    // The strands hang almost straight and are bound at the top, which is the
    // difference between a tassel and a whisk: a fan of splayed lines off a
    // bead reads as a brush, and once seen that way it cannot be unseen.
    ctx.lineCap = 'round'
    ctx.strokeStyle = o.p.bg
    ctx.lineWidth = clamp(o.h * 0.014, 1.5, 4.5)
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath()
      ctx.moveTo(px, py + kr * 0.4)
      ctx.quadraticCurveTo(px + i * kr * 0.18, py + len * 0.6, px + i * kr * 0.4, py + len)
      ctx.stroke()
    }
    ctx.fillStyle = soft(o.p.accent, 0.9)
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath()
      ctx.arc(px + i * kr * 0.4, py + len, kr * 0.18, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.beginPath()
    ctx.arc(px, py, kr, 0, Math.PI * 2)
    ctx.fillStyle = o.p.accent
    ctx.fill()
    ctx.beginPath()
    ctx.arc(px - kr * 0.32, py - kr * 0.32, kr * 0.3, 0, Math.PI * 2)
    ctx.fillStyle = soft(o.p.onAccent, 0.35)
    ctx.fill()
  }
  tassel(cordX(0), cordY(0))
  tassel(cordX(1), cordY(1))

  ctx.restore()
}

/**
 * Paper lanterns hung from the top edge on threads of differing length.
 *
 * These take the palette, and they are the piece that most needs to: a street
 * of lanterns is whatever colour the shop sold, so a card can have them in its
 * own colours without claiming anything, and a set that came out orange every
 * time would make every party's Diwali card look like one party's.
 *
 * Each is lifted off the flat by three cheap tricks and no more: a horizontal
 * gradient so the paper turns away at the sides, ribs that follow the bulge,
 * and a warm glow low in the body where the candle would be.
 */
export const drawLanternRow: Ornament = (ctx, o) => {
  if (o.w <= 0 || o.h <= 0) return
  const rand = rng(o.seed ?? 1)
  ctx.save()
  ctx.beginPath()
  ctx.rect(o.x, o.y, o.w, o.h)
  ctx.clip()
  ctx.globalAlpha = o.alpha ?? 1

  // A party with only one colour still needs a second lantern to hang beside
  // the first, so the fallback is its own colour lightened rather than some
  // other party's green.
  const third = o.p.accent2 ?? mix(o.p.bg, '#ffffff', 0.42)
  const colours = [o.p.bg, o.p.accent, third]

  const n = clamp(Math.round(o.w / 170), 2, 9)
  const step = o.w / n

  for (let i = 0; i < n; i++) {
    const base = colours[i % colours.length] ?? o.p.bg
    // Lit paper is never the flat colour of the paper, so the whole lantern is
    // mixed a fifth of the way to white before anything else happens to it.
    // Warm cream rather than white, and a quarter of the way rather than a
    // tenth. Lit paper is always brighter than the wall behind it, and this is
    // the one piece here that gets hung on a card painted in its own colour: a
    // lantern mixed only slightly off the party blue disappears into a blue
    // card. Cream keeps the hue and lifts the value, which is what a candle
    // inside a paper shade actually does to it.
    const paper = mix(base, '#ffedc4', 0.26)
    const bh = Math.min(step * 0.72, o.h * 0.42) * (0.85 + rand() * 0.28)
    // Wider than tall once the bulge is drawn. A cubic only reaches about two
    // thirds of the way to its control points, so a body whose controls sit at
    // 0.62 of this width comes out about 0.9 of the height across, which is the
    // round paper lantern; deriving the width one to one gives an egg.
    const bw = bh * 1.12
    const capH = bh * 0.1
    // Held off both edges by half a cap, for the same reason the lamps are:
    // the clip would keep a jittered lantern inside the box by slicing it in
    // half, which is not what keeping it inside the box was for.
    const cx = clamp(
      o.x + step * (i + 0.5) + (rand() - 0.5) * step * 0.14,
      o.x + bw * 0.34,
      o.x + o.w - bw * 0.34,
    )
    // The thread has to leave room for the body, the cap and the tassel under
    // it, so what is left over after those is the only length it can take.
    const room = o.h - bh - capH - bh * 0.34
    const ty = o.y + capH + Math.max(0, room) * (0.12 + rand() * 0.62)
    const topW = bw * 0.44

    ctx.beginPath()
    ctx.moveTo(cx, o.y)
    ctx.lineTo(cx, ty - capH)
    ctx.lineWidth = clamp(bh * 0.02, 1, 3)
    ctx.strokeStyle = soft(mix(base, SHADE, 0.3), 0.6)
    ctx.stroke()

    const body = new Path2D()
    body.moveTo(cx - topW / 2, ty)
    body.bezierCurveTo(cx - bw * 0.62, ty + bh * 0.2, cx - bw * 0.62, ty + bh * 0.8, cx - topW / 2, ty + bh)
    body.lineTo(cx + topW / 2, ty + bh)
    body.bezierCurveTo(cx + bw * 0.62, ty + bh * 0.8, cx + bw * 0.62, ty + bh * 0.2, cx + topW / 2, ty)
    body.closePath()

    const shade = ctx.createLinearGradient(cx - bw * 0.62, 0, cx + bw * 0.62, 0)
    shade.addColorStop(0, mix(paper, SHADE, 0.34))
    shade.addColorStop(0.36, mix(paper, '#fffaf0', 0.16))
    shade.addColorStop(1, mix(paper, SHADE, 0.42))
    ctx.fillStyle = shade
    ctx.fill(body)

    ctx.save()
    ctx.clip(body)
    const lit = ctx.createRadialGradient(cx, ty + bh * 0.62, 0, cx, ty + bh * 0.62, bw * 0.62)
    lit.addColorStop(0, soft('#fff2c8', 0.32))
    lit.addColorStop(1, soft('#fff2c8', 0))
    ctx.fillStyle = lit
    ctx.fillRect(cx - bw, ty, bw * 2, bh)
    // Ribs, spaced across the belly and curved with it. Straight verticals
    // would flatten the lantern back into a shape with a gradient on it.
    ctx.strokeStyle = soft(mix(base, SHADE, 0.55), 0.3)
    ctx.lineWidth = Math.max(1, bh * 0.016)
    for (const k of [-0.62, -0.24, 0.24, 0.62]) {
      ctx.beginPath()
      ctx.moveTo(cx + (topW / 2) * k * 2, ty)
      ctx.bezierCurveTo(
        cx + bw * 0.62 * k,
        ty + bh * 0.22,
        cx + bw * 0.62 * k,
        ty + bh * 0.78,
        cx + (topW / 2) * k * 2,
        ty + bh,
      )
      ctx.stroke()
    }
    ctx.restore()

    // Cap and base rim, both a shade darker than the paper so they read as the
    // card the paper is glued to.
    ctx.fillStyle = mix(base, SHADE, 0.32)
    ctx.fillRect(cx - topW * 0.66, ty - capH, topW * 1.32, capH)
    ctx.fillRect(cx - topW * 0.6, ty + bh, topW * 1.2, capH * 0.8)

    // The tassel: a bound knot and five close strands, not a splay. Strands
    // fanned off the rim read as a brush hanging under the lantern.
    const tx = ty + bh + capH * 0.8
    ctx.lineCap = 'round'
    ctx.strokeStyle = mix(base, SHADE, 0.28)
    ctx.lineWidth = Math.max(1, bh * 0.024)
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath()
      ctx.moveTo(cx, tx)
      ctx.quadraticCurveTo(cx + k * bw * 0.014, tx + bh * 0.17, cx + k * bw * 0.032, tx + bh * 0.32)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.ellipse(cx, tx + bh * 0.02, bw * 0.05, bh * 0.035, 0, 0, Math.PI * 2)
    ctx.fillStyle = mix(base, SHADE, 0.4)
    ctx.fill()
  }

  ctx.restore()
}

/* ===========================================================================
   The glow
   =========================================================================== */

/**
 * A faint scatter of four-pointed sparkles and soft bokeh, for the warm haze
 * these cards carry in a corner.
 *
 * Faint is the specification and the hard part. Everything here is laid at
 * well under half opacity and the discs are soft-edged, because a sparkle
 * layer that can be read as a set of shapes has stopped being a glow and
 * started competing with the headline it was supposed to sit behind.
 */
export const drawSparkle: Ornament = (ctx, o) => {
  if (o.w <= 0 || o.h <= 0) return
  const rand = rng(o.seed ?? 1)
  ctx.save()
  ctx.beginPath()
  ctx.rect(o.x, o.y, o.w, o.h)
  ctx.clip()
  ctx.globalAlpha = o.alpha ?? 1

  const u = Math.min(o.w, o.h)
  const warm = '#fff3cf'
  // Half the scatter takes the card's colour and half stays candle cream. The
  // split is not decoration for its own sake: cream on a cream card is nothing
  // at all, and the tinted half is the only part of this that can be seen on
  // the warm paper these festival layouts are usually laid on.
  const tint = mix(warm, o.p.bg, 0.55)

  // Bokeh first, so the sparkles sit in front of the haze rather than under
  // it. Sized off the short side, which keeps a wide thin strip from filling
  // with discs taller than itself.
  const discs = clamp(Math.round((o.w * o.h) / (u * u * 0.22)), 3, 26)
  for (let i = 0; i < discs; i++) {
    const cx = o.x + rand() * o.w
    const cy = o.y + rand() * o.h
    const r = u * (0.03 + rand() * 0.075)
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    const c = rand() < 0.5 ? tint : warm
    g.addColorStop(0, soft(c, 0.2 + rand() * 0.16))
    g.addColorStop(0.55, soft(c, 0.09))
    g.addColorStop(1, soft(c, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }

  const n = clamp(Math.round((o.w * o.h) / (u * u * 0.045)), 8, 90)
  for (let i = 0; i < n; i++) {
    const cx = o.x + rand() * o.w
    const cy = o.y + rand() * o.h
    // A handful of large ones among many small: a scatter of one size reads as
    // a texture, and texture is not what a sparkle is for.
    const big = rand() < 0.16
    const r = u * (big ? 0.028 + rand() * 0.03 : 0.007 + rand() * 0.018)
    const alpha = big ? 0.44 + rand() * 0.24 : 0.3 + rand() * 0.34
    if (big) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.9)
      g.addColorStop(0, soft(warm, alpha * 0.42))
      g.addColorStop(1, soft(warm, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, r * 1.9, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = soft(rand() < 0.52 ? tint : warm, alpha)
    star(ctx, cx, cy, r, rand() * Math.PI * 0.5)
  }

  ctx.restore()
}
