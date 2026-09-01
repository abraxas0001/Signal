/**
 * The national set: what a card carries when the occasion is a public one.
 *
 * A festival card is decorated at the foot with diyas or lanterns. A national
 * card is decorated with PEOPLE, and with the places they stand in: a crowd
 * facing a stage with flags over it, a skyline, a ceremonial arch, the
 * tricolour itself. That is the whole of this file, and the four pieces are
 * meant to be mixed rather than stacked. A crowd along the foot with a flag
 * sweeping behind the headline is one card; a skyline along the foot with
 * nothing else is another.
 *
 * WHAT IS DELIBERATELY ABSENT. There is no wheel in the white band of any flag
 * drawn here, and no dome or arch in this file is a portrait of a real building.
 * Both decisions are argued where they are taken, because both of them would be
 * easy to "finish" later by somebody who thought the ornament looked bare, and
 * both would be published under a member's name before anybody checked.
 *
 * ON GROUND. These are drawn for the pale ground the reference cards use, cream
 * or white, so every tone in here is a DARK tone: silhouettes and outlines
 * carried most of the way to the palette's own ink. On the party accent as a
 * ground they still read, because a tone darker than the accent is still a tone,
 * but they read as relief rather than as drawing, and the crowd is the only one
 * of the four that was designed to survive that. The kit hands an ornament no
 * way to ask what colour it has been laid on, so this is a choice made once,
 * here, rather than a decision quietly deferred to the caller.
 */

import { mix, rng, soft, type Ink, type Ornament } from './kit'

const TAU = Math.PI * 2

/**
 * The national colours, as the three bands and nothing else.
 *
 * Hardcoded, where rule 3 says colours come from `p`, and the carve out is rule
 * 4's own: the bands of the national flag are the national flag's bands, and a
 * tricolour repainted in a party's palette is a different object with a meaning
 * nobody intended. These are the same three values the product already uses
 * elsewhere for the same purpose.
 */
const TRICOLOUR = ['#ff9933', '#ffffff', '#138808'] as const

/**
 * The drawing tone: the desk's accent carried most of the way to its own ink.
 *
 * Not the accent itself, which on a saffron desk would give a crowd the colour
 * of a fire, and not flat black, which sits apart from everything else on the
 * card. Mixing towards `p.ink` keeps the mass inside the palette it was handed
 * while still going dark enough to read as shadow.
 */
const shade = (p: Ink, t: number): string => mix(p.accent, p.ink, t)

/* ===========================================================================
   The crowd
   =========================================================================== */

/**
 * One person seen from behind, added to the path already open on `ctx`.
 *
 * Two sub-paths, a rounded torso and a whole head circle overlapping its top
 * edge, rather than one outline traced around a neck. The union of the two is
 * the silhouette, and it is seamless only as long as every sub-path in the rank
 * winds the same way, which is why the torso is traced up the left side and down
 * the right and never the other way about. Wind one of them backwards and the
 * nonzero fill rule punches the overlap out as a hole, which on this shape looks
 * exactly like a person with their throat cut away.
 */
function figure(ctx: CanvasRenderingContext2D, cx: number, base: number, hr: number): void {
  const sw = hr * 1.9
  const sh = hr * 1.72
  const top = base - sh
  ctx.moveTo(cx - sw, base)
  ctx.lineTo(cx - sw, base - sh * 0.44)
  ctx.quadraticCurveTo(cx - sw, top, cx - sw * 0.44, top)
  ctx.lineTo(cx + sw * 0.44, top)
  ctx.quadraticCurveTo(cx + sw, top, cx + sw, base - sh * 0.44)
  ctx.lineTo(cx + sw, base)
  ctx.closePath()
  const hy = base - sh - hr * 0.66
  ctx.moveTo(cx + hr, hy)
  ctx.arc(cx, hy, hr, 0, TAU)
}

/**
 * A tapered limb from a to b, as a closed quadrilateral on the open path.
 *
 * A stroked line would have been shorter, and is wrong here for the same reason
 * the head is a circle: the whole rank has to be ONE fill at ONE alpha. Stroking
 * the arms separately would composite them over the torso a second time and
 * every raised arm would show a darker patch at the shoulder. The vertex order
 * below is the one that winds clockwise for any direction of travel, which is
 * what keeps a limb unioning with the body instead of cancelling against it.
 */
function limb(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  wa: number,
  wb: number,
): void {
  const len = Math.hypot(bx - ax, by - ay) || 1
  const nx = -(by - ay) / len
  const ny = (bx - ax) / len
  ctx.moveTo(ax - nx * wa, ay - ny * wa)
  ctx.lineTo(bx - nx * wb, by - ny * wb)
  ctx.lineTo(bx + nx * wb, by + ny * wb)
  ctx.lineTo(ax + nx * wa, ay + ny * wa)
  ctx.closePath()
}

/**
 * A raised arm: upper arm, forearm bent outward at the elbow, and a fist.
 *
 * The bend is the point. A straight taper from shoulder to hand reads as a stick
 * held up beside somebody, and two of them in the same rank read as antennae.
 * One kink at the elbow is enough for the eye to accept an arm.
 */
function raisedArm(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  hx: number,
  hy: number,
  w: number,
): void {
  const out = hx - sx >= 0 ? 1 : -1
  const ex = sx + (hx - sx) * 0.34 + w * 2.6 * out
  const ey = sy + (hy - sy) * 0.52
  limb(ctx, sx, sy, ex, ey, w * 1.25, w)
  limb(ctx, ex, ey, hx, hy, w, w * 0.86)
  ctx.moveTo(hx + w * 1.2, hy)
  ctx.arc(hx, hy, w * 1.2, 0, TAU)
}

/**
 * A small flag on a stick: the cloth hanging off the top of the staff, waving.
 *
 * The wave grows with distance from the staff, and that is the one thing that
 * makes a rectangle read as cloth rather than as a label. The edge gripped in
 * the fist cannot move; the free edge does. The whole outline is stroked in the
 * silhouette tone afterwards for the white band's sake, which on a cream card
 * would otherwise be a hole through the middle of the flag.
 */
function flagCloth(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  phase: number,
  ink: string,
): void {
  const wob = (t: number, at: number): number =>
    y + at + Math.sin(t * Math.PI * 1.8 + phase) * h * 0.26 * t
  const strip = (a: number, b: number): void => {
    ctx.beginPath()
    for (let s = 0; s <= 10; s++) {
      const t = s / 10
      if (s === 0) ctx.moveTo(x, wob(t, a))
      else ctx.lineTo(x + w * t, wob(t, a))
    }
    for (let s = 10; s >= 0; s--) {
      const t = s / 10
      ctx.lineTo(x + w * t, wob(t, b))
    }
    ctx.closePath()
  }
  TRICOLOUR.forEach((colour, i) => {
    strip((h * i) / 3, (h * (i + 1)) / 3)
    ctx.fillStyle = colour
    ctx.fill()
  })
  strip(0, h)
  ctx.lineWidth = Math.max(1, h * 0.06)
  ctx.strokeStyle = soft(ink, 0.42)
  ctx.stroke()
}

/** A flag waiting its turn, drawn over the ranks once every silhouette is down. */
interface Banner {
  x: number
  y: number
  w: number
  h: number
  phase: number
}

/**
 * The ranks, back to front. Every number is a fraction of the crowd band, so the
 * whole thing scales with the strip it is given and never with the poster.
 *
 * `lift` raises a rank's feet off the foot of the box, which is what puts the
 * back rows further away; `head` shrinks them; `alpha` fades them. The three
 * together are the entire depth cue, and they are set so the back rank's heads
 * clear the front rank's by a comfortable margin. Ranks whose heads land at the
 * same height read as one row of lollipops however many of them there are, and
 * that is the failure this ornament is most likely to fall into.
 */
const RANKS = [
  { lift: 0.57, head: 0.055, tone: 0.34, alpha: 0.44, arm: 0.12, flag: 0.07 },
  { lift: 0.4, head: 0.072, tone: 0.5, alpha: 0.56, arm: 0.18, flag: 0.09 },
  { lift: 0.19, head: 0.095, tone: 0.68, alpha: 0.8, arm: 0.24, flag: 0.11 },
  { lift: 0.0, head: 0.122, tone: 0.84, alpha: 1, arm: 0.26, flag: 0.12 },
] as const

/**
 * A silhouetted crowd along the foot of the box, seen from behind.
 *
 * The most used ornament in the set. A rally, a public meeting, a national day
 * and a swearing in all take the same picture and it is this one. Four ranks,
 * each drawn as a single path and filled once so the overlapping bodies merge
 * into one mass, with a scatter of raised arms and small flags above them. Three
 * ranks were the first attempt and were not enough: a crowd has to look like
 * MANY people, and the fourth, palest row behind the others is most of what
 * carries that.
 *
 * The box is treated as a foot strip whatever its height, and the band is capped
 * against the WIDTH rather than the height. A caller who hands this the whole
 * card therefore still gets a crowd along the bottom of it instead of a crowd of
 * giants: a crowd is a horizontal thing, and its scale is set by how many people
 * fit across it, not by how much room happens to be free above them.
 */
export const drawCrowd: Ornament = (ctx, o) => {
  const r = rng(o.seed ?? 1)
  const band = Math.min(o.h, o.w * 0.27)
  const foot = o.y + o.h
  const ink = shade(o.p, 0.88)

  ctx.save()
  ctx.globalAlpha = o.alpha ?? 1
  // Clipped, and it is not belt and braces. The front rank's feet are jittered
  // BELOW the foot of the box so that no gap of ground can open under the crowd,
  // which means the rank genuinely does overrun the box and rule 1 has to be
  // paid for somewhere. Here is cheaper than trimming every shape.
  ctx.beginPath()
  ctx.rect(o.x, o.y, o.w, o.h)
  ctx.clip()

  const banners: Banner[] = []

  for (const rank of RANKS) {
    const hr = band * rank.head
    const line = foot - band * rank.lift
    const tone = shade(o.p, rank.tone)

    ctx.beginPath()
    // Begin with a whole body outside the left edge and finish with one outside
    // the right, so the crowd is cut off by the box rather than ending in a tidy
    // last person. A crowd with two visible ends is a queue.
    let cx = o.x - hr * 1.6
    while (cx < o.x + o.w + hr * 1.6) {
      const hh = hr * (0.82 + r() * 0.4)
      // Jittered DOWNWARD only. Lifting a body off its rank's line left a notch
      // of bare card under it, and on the front rank that notch is a white bite
      // out of the bottom edge of the poster.
      const base = line + r() * hr * 0.45
      figure(ctx, cx, base, hh)

      const sh = hh * 1.72
      const side = r() < 0.5 ? -1 : 1
      const sx = cx + side * hh * 1.3
      const sy = base - sh * 0.78
      const roll = r()
      const fh = hh * 1.45
      const fw = fh * 1.5
      // A flag is refused where one is already flying. The roll is per person
      // and it clusters: three seeds out of ten put two or three flags within a
      // cloth's width of each other, and stacked flags read as one torn banner
      // rather than as a crowd carrying several. The person still raises an arm.
      const room = banners.every((b) => Math.abs(b.x - sx) > fw * 0.9)
      if (roll < rank.flag && room) {
        // The staff is a limb like any other, so it joins the silhouette. Only
        // the cloth is painted over the top afterwards, and only because it is
        // the one part of this ornament that is not a shadow.
        const reach = hh * (2.9 + r() * 0.9)
        const fistY = Math.max(o.y + hh * 3.2, sy - reach)
        const fistX = sx + side * hh * 0.55
        raisedArm(ctx, sx, sy, fistX, fistY, hh * 0.2)
        // The staff is kept short enough that the cloth clears the top of the
        // box on its own. Clamping it there instead would flatten every flag
        // against the ceiling and the crowd would lose the depth the ranks just
        // bought, because a distant flag has to sit LOWER than a near one.
        const staffTop = Math.max(o.y + hh * 0.2, fistY - hh * (1.7 + r() * 0.5))
        limb(ctx, fistX, fistY + hh * 0.4, fistX, staffTop, hh * 0.1, hh * 0.08)
        // Not clamped into the box: a flag whose staff is inside is allowed to
        // hang off the right edge and be cut by the clip, which is what a flag
        // at the edge of a photograph does. Clamping it instead slid every flag
        // held by somebody outside the frame onto the same x, and two of them
        // landed on top of each other as one six banded flag.
        banners.push({ x: fistX, y: staffTop + hh * 0.12, w: fw, h: fh, phase: r() * TAU })
      } else if (roll < rank.flag + rank.arm) {
        const reach = hh * (2.5 + r() * 1.1)
        const hy = Math.max(o.y + hh * 0.6, sy - reach)
        raisedArm(ctx, sx, sy, sx + side * hh * 0.75, hy, hh * 0.19)
      }

      // Advance by less than a body's width, so the next person overlaps this
      // one. The random half of the step is what stops the row falling into a
      // visible beat, which is what two ranks stepping in time would give it.
      cx += hh * (2.05 + r() * 1.25)
    }
    ctx.fillStyle = soft(tone, rank.alpha)
    ctx.fill()
  }

  for (const b of banners) flagCloth(ctx, b.x, b.y, b.w, b.h, b.phase, ink)

  ctx.restore()
}

/* ===========================================================================
   The skyline
   =========================================================================== */

/** A stroked rectangle open at the bottom, which is every building on a ground line. */
function block(ctx: CanvasRenderingContext2D, x: number, base: number, w: number, h: number): void {
  ctx.beginPath()
  ctx.moveTo(x, base)
  ctx.lineTo(x, base - h)
  ctx.lineTo(x + w, base - h)
  ctx.lineTo(x + w, base)
  ctx.stroke()
}

/**
 * A grid of window openings inside a block, inset off its own edges.
 *
 * Wide cells and few rows on purpose. A true grid of small squares at poster
 * scale turns a building into graph paper and the whole foot of the card into
 * texture, which is the opposite of what an outline skyline is for.
 */
function windows(
  ctx: CanvasRenderingContext2D,
  x: number,
  base: number,
  w: number,
  h: number,
  unit: number,
): void {
  const cols = Math.max(2, Math.round(w / (unit * 1.6)))
  const rows = Math.max(1, Math.floor(h / (unit * 2)))
  const gx = w / (cols * 2 + 1)
  const cw = gx
  const ch = h / (rows * 1.7 + 1)
  for (let c = 0; c < cols; c++) {
    for (let ro = 0; ro < rows; ro++) {
      const wx = x + gx + c * (cw + gx)
      const wy = base - h + ch * 0.85 + ro * ch * 1.7
      if (wy + ch > base - ch * 0.4) continue
      ctx.strokeRect(wx, wy, cw, ch)
    }
  }
}

/** A shaft with a balcony, a small dome and a finial: the minaret beside the hall. */
function minaret(ctx: CanvasRenderingContext2D, cx: number, base: number, h: number): void {
  const w = h * 0.13
  ctx.beginPath()
  ctx.moveTo(cx - w / 2, base)
  ctx.lineTo(cx - w / 2, base - h * 0.8)
  ctx.lineTo(cx + w / 2, base - h * 0.8)
  ctx.lineTo(cx + w / 2, base)
  ctx.stroke()
  // The balcony, two rules and a slight overhang. Without it the shaft is a
  // post; with it the eye reads a tower somebody is allowed to stand on.
  ctx.beginPath()
  ctx.moveTo(cx - w * 0.9, base - h * 0.55)
  ctx.lineTo(cx + w * 0.9, base - h * 0.55)
  ctx.moveTo(cx - w * 0.9, base - h * 0.61)
  ctx.lineTo(cx + w * 0.9, base - h * 0.61)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, base - h * 0.8, w * 0.66, Math.PI, 0)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, base - h * 0.8 - w * 0.66)
  ctx.lineTo(cx, base - h * 0.94)
  ctx.stroke()
}

/**
 * A domed hall between two minarets.
 *
 * A generic one. A low arcaded base, a drum and a hemisphere is the shape a
 * domed civic building takes over most of the country and is not the shape of
 * any particular one. The same caution as `drawMonument` applies here and for
 * the same reason: the type, never the instance.
 */
function domedHall(ctx: CanvasRenderingContext2D, x: number, base: number, w: number): void {
  const h = w * 0.42
  const cx = x + w / 2
  block(ctx, x, base, w, h)

  // Three arched openings along the front of the hall.
  const ow = w / 7
  for (let i = -1; i <= 1; i++) {
    const ox = cx + i * ow * 1.9 - ow / 2
    ctx.beginPath()
    ctx.moveTo(ox, base)
    ctx.lineTo(ox, base - h * 0.38)
    ctx.arc(ox + ow / 2, base - h * 0.38, ow / 2, Math.PI, 0)
    ctx.lineTo(ox + ow, base)
    ctx.stroke()
  }

  const drumW = w * 0.42
  const drumH = h * 0.26
  ctx.beginPath()
  ctx.moveTo(cx - drumW / 2, base - h)
  ctx.lineTo(cx - drumW / 2, base - h - drumH)
  ctx.lineTo(cx + drumW / 2, base - h - drumH)
  ctx.lineTo(cx + drumW / 2, base - h)
  ctx.stroke()

  const dome = base - h - drumH
  const rad = drumW * 0.56
  ctx.beginPath()
  ctx.arc(cx, dome, rad, Math.PI, 0)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, dome - rad)
  ctx.lineTo(cx, dome - rad - w * 0.1)
  ctx.stroke()

  minaret(ctx, x + w * 0.055, base, h * 1.45)
  minaret(ctx, x + w * 0.945, base, h * 1.45)
}

/**
 * A city skyline in outline along the foot of the box.
 *
 * OUTLINE AND NOT SILHOUETTE, which is the one thing that had to be right. The
 * reference cards draw the city as a fine line so the headline above it keeps
 * every bit of its contrast, and a filled skyline in the same place turns the
 * bottom of the card into a bar. Everything here is stroked at a weight that
 * scales with the band, with the windows a step fainter than the walls so a tall
 * block reads as a building rather than as a table.
 *
 * The mix is mostly fixed rather than seeded: plain blocks, one domed hall with
 * minarets slightly off centre, and a scatter of stepped crowns and spires. A
 * fully seeded skyline drew a plausible city about half the time and a row of
 * similar boxes the other half, and the half that failed failed silently.
 */
export const drawSkyline: Ornament = (ctx, o) => {
  const r = rng(o.seed ?? 1)
  const band = Math.min(o.h, o.w * 0.23)
  const foot = o.y + o.h
  const line = shade(o.p, 0.9)
  const unit = band * 0.09
  const stroke = Math.max(1.1, band * 0.014)

  ctx.save()
  ctx.globalAlpha = o.alpha ?? 1
  ctx.lineJoin = 'round'
  ctx.lineCap = 'butt'
  // Clipped, so the run can start outside the left edge and end outside the
  // right. A skyline whose first and last buildings both happen to have a
  // complete outline has two visible ends, and a city with two ends is a model
  // of a city. Cut off at both edges it carries on past the card.
  ctx.beginPath()
  ctx.rect(o.x, o.y, o.w, o.h)
  ctx.clip()

  // The hall sits a little past the middle, off centre on purpose: dead centre
  // makes the skyline symmetrical, and a symmetrical skyline reads as a logo.
  const domeAt = o.x + o.w * (0.5 + r() * 0.16)
  let placed = false
  let cx = o.x - band * (0.1 + r() * 0.16)

  while (cx < o.x + o.w) {
    const room = o.x + o.w - cx
    ctx.lineWidth = stroke
    ctx.strokeStyle = soft(line, 0.62)

    if (!placed && cx + band * 0.9 > domeAt && room > band * 1.05) {
      domedHall(ctx, cx, foot, band * 0.95)
      cx += band * 1.02
      placed = true
      continue
    }

    const bw = Math.min(room, band * (0.21 + r() * 0.26))
    const bh = band * (0.3 + r() * 0.5)
    block(ctx, cx, foot, bw, bh)

    const crown = r()
    if (crown < 0.24) {
      // A stepped crown, narrower than the block under it, with a mast.
      const sw = bw * 0.54
      block(ctx, cx + (bw - sw) / 2, foot - bh, sw, band * 0.13)
      ctx.beginPath()
      ctx.moveTo(cx + bw / 2, foot - bh - band * 0.13)
      ctx.lineTo(cx + bw / 2, foot - bh - band * 0.26)
      ctx.stroke()
    } else if (crown < 0.42) {
      // A shallow gable with a mast off it, which is the cheapest way to break a
      // run of flat tops without inventing a landmark.
      ctx.beginPath()
      ctx.moveTo(cx, foot - bh)
      ctx.lineTo(cx + bw / 2, foot - bh - band * 0.15)
      ctx.lineTo(cx + bw, foot - bh)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx + bw / 2, foot - bh - band * 0.15)
      ctx.lineTo(cx + bw / 2, foot - bh - band * 0.29)
      ctx.stroke()
    }

    ctx.lineWidth = Math.max(0.8, stroke * 0.72)
    ctx.strokeStyle = soft(line, 0.3)
    windows(ctx, cx, foot, bw, bh, unit)

    cx += bw + unit * (0.12 + r() * 0.4)
  }

  // The ground the city stands on, so the run of open bottomed blocks closes.
  // Half a stroke up from the foot, because a line centred on the edge of the
  // box would put its outer half outside the box.
  ctx.lineWidth = stroke
  ctx.strokeStyle = soft(line, 0.5)
  ctx.beginPath()
  ctx.moveTo(o.x, foot - stroke / 2)
  ctx.lineTo(o.x + o.w, foot - stroke / 2)
  ctx.stroke()

  ctx.restore()
}

/* ===========================================================================
   The arch
   =========================================================================== */

/**
 * A free standing ceremonial arch in outline, centred in the box.
 *
 * A GENERIC ARCH, AND THAT IS THE DECISION. India Gate is the building a
 * national card reaches for here, and it is the building this will not draw. A
 * recognisable monument reconstructed from memory in canvas arithmetic is a bad
 * likeness of a real place: the proportion is wrong, the inscription is missing,
 * and the office ends up publishing something that presents itself as a national
 * memorial and is not quite it. What is drawn instead is the TYPE rather than
 * the instance, a broad arch with a heavy cornice on a stepped plinth, which is
 * the shape of a ceremonial gateway anywhere and the shape of nothing in
 * particular. It reads at a glance as exactly what the poster needs it to read
 * as, and it makes no claim that can turn out to be wrong.
 *
 * The barrel is two arcs a little apart with short returns between them, and
 * that is the whole of the perspective. A single arc is a hole cut in a wall;
 * the second arc set back inside it is what says the wall has thickness and that
 * you are looking through it.
 */
export const drawMonument: Ornament = (ctx, o) => {
  const line = shade(o.p, 0.9)
  // Sized off both dimensions, so a wide short box gives a wide short arch
  // rather than one that runs out through the top of it. The proportion is
  // squarer than a doorway on purpose: a gateway is a thing you drive a
  // procession through, and a tall narrow one reads as a church window.
  const H = Math.min(o.h * 0.94, o.w * 0.86)
  const W = H * 0.9
  const cx = o.x + o.w / 2
  // Every course is a fraction of H, so the total is known before anything is
  // drawn and the whole arch can be centred on the box rather than hung off a
  // guessed baseline.
  const stepH = H * 0.028
  const massH = H * 0.6
  const slabH = H * 0.05
  const atticH = H * 0.155
  const capH = H * 0.022
  const total = stepH * 3 + massH + H * 0.028 + slabH + atticH + capH
  const foot = o.y + o.h / 2 + total / 2

  ctx.save()
  ctx.globalAlpha = o.alpha ?? 1
  ctx.lineJoin = 'miter'
  ctx.lineCap = 'butt'
  ctx.lineWidth = Math.max(1.4, H * 0.012)
  ctx.strokeStyle = soft(line, 0.72)

  // The plinth: three steps, each wider than the one above it.
  for (let i = 0; i < 3; i++) {
    const sw = W * (1.16 - i * 0.06)
    const sy = foot - stepH * i
    ctx.strokeRect(cx - sw / 2, sy - stepH, sw, stepH)
  }
  const plinth = foot - stepH * 3
  const massTop = plinth - massH

  // The mass, with the barrel cut through it. Springing the arch halfway up the
  // pier and running the crown almost into the cornice is what makes this an
  // arch rather than a hole: the eye reads the gap between crown and cornice as
  // the thickness of the wall it is looking through.
  const open = W * 0.235
  const spring = plinth - H * 0.3
  const inset = open * 0.22

  ctx.beginPath()
  ctx.moveTo(cx - W / 2, plinth)
  ctx.lineTo(cx - W / 2, massTop)
  ctx.lineTo(cx + W / 2, massTop)
  ctx.lineTo(cx + W / 2, plinth)
  ctx.stroke()

  const barrel = (r: number): void => {
    ctx.beginPath()
    ctx.moveTo(cx - r, plinth)
    ctx.lineTo(cx - r, spring)
    ctx.arc(cx, spring, r, Math.PI, 0)
    ctx.lineTo(cx + r, plinth)
    ctx.stroke()
  }
  barrel(open)
  barrel(open - inset)

  // THE SHALLOW RECESSED BARREL, and it is three lines. Two returns at the foot
  // of the opening tie the near arch to the far one, and three short ribs across
  // the head of it do the same job where the two arcs curve apart. Without them
  // the second arc is not a barrel seen end on, it is somebody having drawn the
  // same arch twice, which is exactly what the first version of this looked like.
  ctx.beginPath()
  ctx.moveTo(cx - open, plinth)
  ctx.lineTo(cx - open + inset, plinth)
  ctx.moveTo(cx + open, plinth)
  ctx.lineTo(cx + open - inset, plinth)
  for (const a of [Math.PI * 1.16, Math.PI * 1.5, Math.PI * 1.84]) {
    ctx.moveTo(cx + open * Math.cos(a), spring + open * Math.sin(a))
    ctx.lineTo(cx + (open - inset) * Math.cos(a), spring + (open - inset) * Math.sin(a))
  }
  ctx.stroke()

  // The impost: the moulding the arch springs from, carried across both piers
  // and projecting a little into the opening. It is the single cheapest line in
  // this drawing and the one that most makes it read as masonry, because it is
  // where a mason would have had to change what he was doing.
  for (const side of [-1, 1]) {
    const inner = cx + side * (open - inset * 0.6)
    const outer = cx + side * (W / 2)
    ctx.beginPath()
    ctx.moveTo(inner, spring)
    ctx.lineTo(outer, spring)
    ctx.moveTo(inner, spring - H * 0.018)
    ctx.lineTo(outer, spring - H * 0.018)
    ctx.stroke()
  }

  // The keystone, sitting astride the arch head and cutting into it top and
  // bottom. Drawn small it floated over the crown like a label; it has to
  // straddle both arcs to read as the stone that holds them up.
  const crown = spring - open
  ctx.beginPath()
  ctx.moveTo(cx - H * 0.03, crown + inset * 1.1)
  ctx.lineTo(cx - H * 0.042, crown - H * 0.042)
  ctx.lineTo(cx + H * 0.042, crown - H * 0.042)
  ctx.lineTo(cx + H * 0.03, crown + inset * 1.1)
  ctx.stroke()

  // A tall panel on each pier over the impost, and a small one under it. An
  // undivided pier reads as an empty box whatever else is drawn around it.
  const pierW = W / 2 - open
  for (const side of [-1, 1]) {
    const px = cx + side * (open + pierW / 2)
    const pw = pierW * 0.42
    ctx.strokeRect(px - pw / 2, massTop + H * 0.055, pw, spring - H * 0.06 - (massTop + H * 0.055))
    ctx.strokeRect(px - pw / 2, spring + H * 0.05, pw, plinth - H * 0.05 - (spring + H * 0.05))
  }

  // The cornice: two mouldings stepping out of the wall, then the heavy slab.
  ctx.beginPath()
  ctx.moveTo(cx - W * 0.52, massTop - H * 0.014)
  ctx.lineTo(cx + W * 0.52, massTop - H * 0.014)
  ctx.moveTo(cx - W * 0.54, massTop - H * 0.028)
  ctx.lineTo(cx + W * 0.54, massTop - H * 0.028)
  ctx.stroke()
  const slabTop = massTop - H * 0.028 - slabH
  ctx.strokeRect(cx - W * 0.57, slabTop, W * 1.14, slabH)

  // The attic over the cornice, with a shallow recess in it. The recess is left
  // EMPTY on purpose: it is where a real monument carries its inscription, and
  // this file has no business writing one.
  const atticTop = slabTop - atticH
  ctx.strokeRect(cx - W * 0.29, atticTop, W * 0.58, atticH)
  ctx.strokeRect(cx - W * 0.17, atticTop + atticH * 0.24, W * 0.34, atticH * 0.52)
  ctx.strokeRect(cx - W * 0.33, atticTop - capH, W * 0.66, capH)

  ctx.restore()
}

/* ===========================================================================
   The tricolour
   =========================================================================== */

/**
 * A tricolour ribbon sweeping across the box.
 *
 * NO CHAKRA, AND IT IS NOT AN OVERSIGHT. The Flag Code of India governs how the
 * national flag is displayed, and the twenty four spoked wheel is the thing that
 * makes a tricolour THE FLAG rather than a decorative band. Drawing an
 * approximation of it, with the spokes miscounted or the proportion wrong, puts
 * a defaced national flag on a poster published under a member's name. Drawing
 * it correctly is worse in a quieter way: it turns this ribbon into a display of
 * the flag, and a display has to obey the Code on how the flag is flown, draped,
 * hung and disposed of, none of which a wavy band behind a headline can promise.
 * A ribbon in the national colours is neither of those things. It is decoration,
 * it is what the reference cards actually carry, and it puts no obligation on
 * the office that the office can unknowingly breach. So this draws three bands
 * and stops.
 *
 * The colours are the exact saffron, white and green, and unlike everything else
 * in this file they do not come from `p`, because a tricolour in a party's
 * colours is not a tricolour.
 */
export const drawFlagWave: Ornament = (ctx, o) => {
  // The ribbon and its wave together have to fit the box, so the two are
  // budgeted against the height rather than picked independently. Thickness is
  // capped against the width as well: a ribbon as deep as a short box is wide
  // stops being a sweep and becomes a stripe.
  const thick = Math.min(o.h * 0.34, o.w * 0.12)
  const amp = Math.max(thick * 0.16, Math.min((o.h - thick) / 2 - thick * 0.28, thick * 0.66))
  const mid = o.y + o.h / 2
  const phase = ((o.seed ?? 1) % 9) * 0.7
  const k = Math.PI * 2.1

  const edge = (t: number, at: number): number =>
    mid + Math.sin(t * k + phase) * amp + (at - 0.5) * thick

  const ribbon = (a: number, b: number): void => {
    ctx.beginPath()
    for (let s = 0; s <= 64; s++) {
      const t = s / 64
      const px = o.x + o.w * t
      if (s === 0) ctx.moveTo(px, edge(t, a))
      else ctx.lineTo(px, edge(t, a))
    }
    for (let s = 64; s >= 0; s--) {
      const t = s / 64
      ctx.lineTo(o.x + o.w * t, edge(t, b))
    }
    ctx.closePath()
  }

  ctx.save()
  ctx.globalAlpha = o.alpha ?? 1

  // The shadow is cast ONCE, off the whole ribbon, before any band is painted.
  // Shadowing the three bands separately prints the middle band's shadow across
  // the band below it, and the seam shows as two grey lines through the middle
  // of the flag. Plain black at a low alpha: a shadow is an absence of light
  // rather than a colour, and tinting it in the party's accent would make the
  // cloth look lit by a coloured lamp.
  ctx.shadowColor = 'rgba(0, 0, 0, 0.28)'
  ctx.shadowBlur = thick * 0.45
  ctx.shadowOffsetY = thick * 0.22
  ribbon(0, 1)
  ctx.fillStyle = TRICOLOUR[1]
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0

  TRICOLOUR.forEach((colour, i) => {
    ribbon(i / 3, (i + 1) / 3)
    ctx.fillStyle = colour
    ctx.fill()
  })

  // The folds. A flat band of three colours reads as a printed stripe; cloth
  // reads as cloth because it turns away from the light somewhere. The shading
  // is strongest where the ribbon is steepest, which is where a real sweep of
  // cloth is nearest to edge on, so the darkening is driven by the slope of the
  // same sine the bands follow rather than scattered about at random.
  ctx.save()
  ribbon(0, 1)
  ctx.clip()
  const fold = ctx.createLinearGradient(o.x, 0, o.x + o.w, 0)
  for (let s = 0; s <= 40; s++) {
    const t = s / 40
    fold.addColorStop(t, soft('#000000', 0.26 * Math.max(0, Math.cos(t * k + phase))))
  }
  ctx.fillStyle = fold
  ctx.fillRect(o.x, o.y, o.w, o.h)
  ctx.restore()

  // A hairline along both edges, in the palette's ink rather than in black. On a
  // cream card the white band has no edge of its own and the ribbon loses a third
  // of its depth; this puts it back without darkening the colours.
  ribbon(0, 1)
  ctx.lineWidth = Math.max(1, thick * 0.035)
  ctx.strokeStyle = soft(o.p.ink, 0.3)
  ctx.stroke()

  ctx.restore()
}
