import type { Transition, Variants } from 'motion/react'

/**
 * Motion tokens.
 *
 * Two laws that everything else follows from:
 *   • Never spring an opacity or a colour — springs overshoot past 1 and you
 *     get a visible flash. Use `ease.out`.
 *   • Never bounce a sheet or modal. A bouncing sheet reads as broken. Use
 *     `settle`, which has bounce: 0.
 *
 * Exits are always faster than entrances so going back feels snappy.
 */

export const spring = {
  /** Press, release, toggles. ≈ stiffness 900 / damping 40. */
  snap: { type: 'spring', visualDuration: 0.18, bounce: 0.1 },
  /** Badges, chips, stat tiles. ≈ stiffness 420 / damping 18. */
  pop: { type: 'spring', visualDuration: 0.32, bounce: 0.38 },
  /** Celebration, mascot, the streak digit. ≈ stiffness 260 / damping 12. */
  bouncy: { type: 'spring', visualDuration: 0.5, bounce: 0.55 },
  /** Sheets, drawers, layout. Bounce is deliberately zero. */
  settle: { type: 'spring', visualDuration: 0.42, bounce: 0 },
  /** Route and page transitions. */
  glide: { type: 'spring', visualDuration: 0.6, bounce: 0.15 },
} satisfies Record<string, Transition>

export const ease = {
  /** expo.out — opacity, colour, fades. */
  out: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  /** Exits: faster than entrances. */
  in: { duration: 0.14, ease: [0.7, 0, 0.84, 0] },
  soft: { duration: 0.24, ease: [0.4, 0, 0.2, 1] },
} satisfies Record<string, Transition>

/**
 * The Duolingo signature: anticipation, then squash-and-stretch with volume
 * conservation — X and Y scale inversely, so the thing looks like it has mass.
 * Pair with `transformOrigin: 'bottom center'` so it squashes against a
 * surface rather than in mid-air; that origin is half the effect.
 */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.6 },
  show: {
    opacity: 1,
    scaleX: [0.6, 1.18, 0.94, 1.02, 1],
    scaleY: [0.6, 0.82, 1.08, 0.98, 1],
    transition: {
      scaleX: { duration: 0.55, times: [0, 0.35, 0.6, 0.8, 1], ease: [0.16, 1, 0.3, 1] },
      scaleY: { duration: 0.55, times: [0, 0.35, 0.6, 0.8, 1], ease: [0.16, 1, 0.3, 1] },
      opacity: { duration: 0.18 },
    },
  },
}

/** Siblings never arrive together — order encodes the narrative. */
export const listStagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
}

export const listItem: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: spring.pop },
}

/** Cheaper cascade for lists longer than ~8 items, to stay under 500ms total. */
export const listStaggerFast: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03, delayChildren: 0.04 } },
}

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: spring.pop },
  exit: { opacity: 0, y: -8, transition: ease.in },
}

/** Screen-level transition. */
export const pageIn: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: spring.glide },
  exit: { opacity: 0, y: -8, transition: ease.in },
}

/** The idle breathing loop — a static character reads as a broken image. */
export const idleBreath = {
  animate: { scale: [1, 1.03, 1], rotate: [0, 1.2, 0, -1.2, 0], y: [0, -3, 0] },
  transition: { duration: 3.6, repeat: Infinity, ease: 'easeInOut', repeatType: 'mirror' },
} as const

/** Put this on everything tappable. */
export const pressable = {
  whileTap: { scale: 0.96 },
  whileHover: { scale: 1.02 },
  transition: spring.snap,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Device capability
// ─────────────────────────────────────────────────────────────────────────────

interface NavigatorWithHints extends Navigator {
  deviceMemory?: number
  connection?: { effectiveType?: string }
}

/**
 * Detected once at boot. Gates the aurora, grain, glass and confetti so a
 * Redmi-class phone on 4G gets a flat, fast surface instead of dropped frames.
 */
export function detectLowEnd(): boolean {
  if (typeof navigator === 'undefined') return false
  const n = navigator as NavigatorWithHints
  const memory = n.deviceMemory ?? 8
  const cores = n.hardwareConcurrency ?? 8
  const net = n.connection?.effectiveType ?? '4g'
  return memory <= 4 || cores <= 4 || /(^|\W)(slow-2g|2g|3g)$/.test(net)
}

export function applyDeviceClass(): boolean {
  const low = detectLowEnd()
  document.documentElement.classList.toggle('low-end', low)
  return low
}

/**
 * Haptics. Android Chromium only — WebKit exposes no vibration API at all, and
 * the `<input type="checkbox" switch>` workaround was patched in Safari 26.5.
 * Every haptic is paired with a visual change so iOS users lose nothing.
 */
export const haptic = {
  tap: () => buzz(8),
  success: () => buzz(12),
  celebrate: () => buzz([10, 40, 10]),
  error: () => buzz([25, 30, 25]),
}

function buzz(pattern: number | number[]) {
  try {
    if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    navigator.vibrate(pattern)
  } catch {
    /* never let a nice-to-have throw */
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Arrival
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A headline that assembles itself, word by word.
 *
 * The page had one entrance stagger on whole blocks, which is not enough to
 * read as motion — the eye sees a finished screen. Per-word arrival is the
 * cheapest thing that makes a page feel authored: it is still transform and
 * opacity, and it runs once.
 */
export const wordStagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.08 } },
}

export const wordIn: Variants = {
  hidden: { opacity: 0, y: '0.4em', rotate: -1.5 },
  show: {
    opacity: 1,
    y: 0,
    rotate: 0,
    transition: { type: 'spring', visualDuration: 0.55, bounce: 0.28 },
  },
}

/** Sections arriving on scroll: further and slower than a list item. */
export const revealUp: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', visualDuration: 0.55, bounce: 0.18 },
  },
}
