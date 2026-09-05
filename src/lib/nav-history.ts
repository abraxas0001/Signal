import { useEffect, useRef } from 'react'
import type { Tab } from '@/lib/nav'

/**
 * Make the browser's back button mean "one step back" inside the app.
 *
 * THE BUG THIS EXISTS TO FIX. Every screen change in this app was React state
 * and nothing else: `setTab('compare')` swapped what rendered and the URL never
 * moved. Measured on the built app, walking Dashboard to Grievances to Compare
 * to Settings left `history.length` at 2 the whole way and the URL at `/`. So
 * there was never a step to go back TO. Pressing back left the app outright,
 * and coming back in re-mounted `useState<Tab>('dashboard')` and landed on the
 * dashboard. That is what an office reports as "back takes me to the dashboard
 * instead of where I was".
 *
 * It is worse on a phone than a laptop. Back is the primary gesture on Android
 * and the edge swipe on iOS, and an app that exits on it feels broken in a way
 * that is hard to describe and impossible to work around.
 *
 * HOW IT WORKS. One entry per navigable point. A point is the screen plus
 * whichever full-screen overlay sits on top of it, because to a reader those
 * are the same kind of thing: the history panel covers the page, so closing it
 * is a step back, not a mode change.
 *
 *   forward  (a different screen, or an overlay opening)  ->  pushState
 *   backward (the overlay that is open, closing)          ->  history.back()
 *   popstate (the reader pressed back or forward)         ->  apply, push nothing
 *
 * Closing an overlay calls `history.back()` rather than pushing, or the stack
 * would grow on the way out and one back press would reopen the thing the
 * reader just closed. The resulting popstate hands us the point we are already
 * showing, so applying it again is a no-op.
 *
 * WHY DEPTH IS RECORDED. `history.back()` is only ours to call when the entry
 * underneath is one we pushed. On a device where the app is the first page in
 * the tab, calling it on an overlay we never pushed would walk the reader out
 * of the app while they were trying to close a sheet. `depth` counts the
 * entries this app owns, so the close path can tell the two cases apart.
 */

export interface NavPoint {
  tab: Tab
  /**
   * A full-screen layer above the screen, or null. These are the ones a reader
   * expects back to dismiss; a small popover or a tooltip is not one of them
   * and must not be listed here, or back would start consuming presses on
   * things nobody thinks of as a place.
   */
  overlay: 'history' | 'more' | null
}

interface Entry {
  point: NavPoint
  /** How many entries deep into this app we are. 0 is the first. */
  depth: number
  /**
   * How far down the page the reader was when they left this entry.
   *
   * WITHOUT THIS, BACK ALWAYS LANDED AT THE TOP. Every navigation in this app
   * ended in `window.scrollTo({ top: 0 })` — the forward path and the popstate
   * path alike — so a reader who opened a post from the platform tables three
   * screens down the dashboard and pressed back was returned to the masthead
   * and had to find their place again. The office reported it as back "leads
   * to section 1 of the dashboard".
   *
   * Going FORWARD to a new screen should start at the top; that part was
   * right. Coming BACK should not, because the reader is returning to
   * something they were already reading. So the position is stamped onto the
   * entry being left, and read back off the entry being returned to.
   */
  scrollY: number
  /**
   * How tall the page was at that moment — what makes the position mean
   * anything.
   *
   * MEASURED: restoring the number alone put the reader a whole card too far
   * down. The screen returned to is not finished when popstate fires, so an
   * early `scrollTo(1812)` lands against a half-built page; the rest renders
   * above it, and Chrome's scroll anchoring then preserves the wrong place —
   * 746px past where the reader left, Content insights replaced by the chart
   * below it. Trapping every scripted scroll proved the third movement was
   * nobody's call: it was the browser holding on to our own early guess.
   *
   * A position is only worth applying to the page it was measured against.
   */
  docHeight: number
}

const KEY = 'signalNav'

function entryOf(state: unknown): Entry | null {
  if (typeof state !== 'object' || state === null) return null
  const held = (state as Record<string, unknown>)[KEY]
  if (typeof held !== 'object' || held === null) return null
  const e = held as Record<string, unknown>
  const point = e['point']
  if (typeof point !== 'object' || point === null) return null
  const p = point as Record<string, unknown>
  if (typeof p['tab'] !== 'string') return null
  return {
    point: {
      tab: p['tab'] as Tab,
      overlay:
        p['overlay'] === 'history' || p['overlay'] === 'more'
          ? (p['overlay'] as 'history' | 'more')
          : null,
    },
    depth: typeof e['depth'] === 'number' ? e['depth'] : 0,
    // An entry stamped before this field existed reads as the top of the
    // page, which is exactly the old behaviour — never a wrong position.
    scrollY: typeof e['scrollY'] === 'number' ? e['scrollY'] : 0,
    docHeight: typeof e['docHeight'] === 'number' ? e['docHeight'] : 0,
  }
}

/**
 * Stamp the entry currently on the stack with where the reader is NOW.
 *
 * Called on the way out of a point, forward or backward, because the browser
 * gives no "you are about to leave" hook we can trust on a single-page app
 * whose screens are React state. The write is a replaceState, so it revises
 * the entry the reader is standing on rather than adding a step.
 */
/**
 * Where the page was when the reader last reached for something.
 *
 * MEASURED, NOT THEORISED. Clicking a control that is only PARTLY on screen
 * makes the browser scroll it fully into view as it takes focus, and that
 * happens during the click dispatch — before any React handler runs. So a
 * capture taken inside the handler records the position the BROWSER just
 * moved to, not the one the reader was looking at when they decided to click.
 * On this dashboard the gap measured 746px: back returned the reader most of a
 * screen below the card they had pressed.
 *
 * Pointerdown fires before that nudge, so this is the honest answer to "where
 * were they when they chose to leave". It goes stale deliberately: a
 * navigation that is not the direct result of a press — a keyboard Enter, a
 * redirect, a timer — falls through to the live position instead of restoring
 * somewhere the reader was a minute ago.
 */
let reach: { y: number; at: number } | null = null

let stampedAt = 0

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    () => {
      reach = { y: window.scrollY, at: performance.now() }
    },
    { capture: true, passive: true },
  )

  /**
   * KEEP THE ENTRY THE READER IS STANDING ON CURRENT, ALWAYS.
   *
   * The obvious place to record a position is the moment of leaving, and for
   * the browser's OWN back button there is no such moment we can reach: by the
   * time `popstate` fires the traversal has already happened, and
   * `history.state` is the entry being ARRIVED at. A `replaceState` there
   * writes the outgoing screen's position and height onto the INCOMING entry —
   * which is invisible on the first press and wrong on the second. Verified in
   * Chromium: dashboard to Compare and back restored correctly while quietly
   * stamping the dashboard's entry with Compare's numbers, so the NEXT return
   * to the dashboard restored Compare's position and then stalled waiting for
   * a height the dashboard never reaches.
   *
   * There is no hook before a browser back. The only way the outgoing entry
   * can be correct at that instant is for it to have been correct all along,
   * so the position is written as the reader scrolls. Throttled because Safari
   * rate-limits history writes (roughly a hundred per thirty seconds) and a
   * scroll fires far faster than that.
   */
  window.addEventListener(
    'scroll',
    () => {
      const now = performance.now()
      if (now - stampedAt < 250) return
      stampedAt = now
      captureScroll()
    },
    { passive: true },
  )
}

export function captureScroll(): void {
  try {
    const held = entryOf(window.history.state)
    if (!held) return
    /*
     * The rescue sheet pins the body (`position: fixed; top: -scrollY`) while
     * it is open, which makes `window.scrollY` read 0 even though the reader
     * is halfway down the page. Recording that would hand back a wrong
     * position later, which is worse than handing back none — so while the
     * body is pinned this declines to record anything and the entry keeps
     * whatever it already held.
     */
    if (document.body.style.position === 'fixed') return
    const fresh = reach !== null && performance.now() - reach.at < 1000
    const at: Entry = {
      ...held,
      scrollY: fresh && reach ? reach.y : window.scrollY,
      docHeight: document.documentElement.scrollHeight,
    }
    window.history.replaceState({ ...(window.history.state ?? {}), [KEY]: at }, '')
  } catch {
    /* A frame that refuses replaceState simply loses the position. */
  }
}

/**
 * Scroll back to a remembered position once there is a page tall enough.
 *
 * A plain `scrollTo` right after `setTab` lands nowhere: the screen being
 * returned to has not rendered yet, the document is still the height of the
 * screen being left, and the browser clamps the scroll to whatever fits. So
 * this re-applies across a handful of frames while the page is still growing
 * under it, and stops as soon as the target is reachable.
 */
/**
 * The restore currently in flight, so a second one can cancel it.
 *
 * Two backs in quick succession used to leave two rAF loops fighting over the
 * page — the stale one won as often as not — and each had saved and restored
 * `overflow-anchor` independently, so the wrong one could put back a value it
 * had captured while anchoring was already off, disabling it for the rest of
 * the session.
 */
let restoring: { cancelled: boolean } | null = null

export function restoreScroll(y: number, docHeight = 0): void {
  // Whatever was in flight is now answering a question nobody is asking.
  if (restoring) restoring.cancelled = true
  const run = { cancelled: false }
  restoring = run

  /*
   * `behavior: 'instant'` IS NOT OPTIONAL HERE. The stylesheet sets
   * `html { scroll-behavior: smooth }`, and a scrollTo that omits the key
   * inherits it — so restoring a position would ANIMATE, and the reader would
   * watch the page scroll itself down through everything they had already
   * read. Returning to a place should look like it was never left.
   */
  if (y <= 0) {
    window.scrollTo({ top: 0, behavior: 'instant' })
    restoring = null
    return
  }

  /*
   * While the rescue sheet pins the body, `scrollTo` writes to a page that is
   * `position: fixed` and the sheet's own cleanup will scroll somewhere else
   * on close. Two things steering one page ends wherever the last one wrote,
   * so this one stands down.
   */
  if (document.body.style.position === 'fixed') {
    restoring = null
    return
  }

  const root = document.documentElement
  /*
   * SCROLL ANCHORING OFF WHILE WE PLACE THE READER.
   *
   * Anchoring exists to keep what you are reading still while content loads
   * above it, and here it works against us: it treats OUR restored position
   * as the thing to preserve, so a position applied a moment too early gets
   * locked in and then carried further as the rest of the screen renders.
   * Measured, that was a 746px error — the reader left looking at Content
   * insights and came back to the follower chart below it. It goes back on
   * the moment the position is settled, because for ordinary reading it is
   * exactly the behaviour you want.
   */
  const anchoring = root.style.overflowAnchor
  root.style.overflowAnchor = 'none'

  const target = Math.max(0, y)
  /* Long enough for a screen's charts, tables and deferred tiles to lay out;
     short enough that a reader on a slow desk is not left staring at a page
     that never moves. */
  const until = performance.now() + 1500
  let finished = false

  const done = (): void => {
    if (finished) return
    finished = true
    root.style.overflowAnchor = anchoring
    if (restoring === run) restoring = null
    window.removeEventListener('wheel', abandon)
    window.removeEventListener('touchstart', abandon)
    window.removeEventListener('keydown', abandon)
  }

  /**
   * THE READER OUTRANKS THE RESTORE.
   *
   * A restore can still be waiting for a slow screen to finish laying out
   * when the reader gives up and scrolls themselves. Continuing to steer at
   * that point drags the page back out from under them, which reads as the
   * app fighting the scroll wheel. Their first deliberate move ends it.
   */
  function abandon(): void {
    run.cancelled = true
    done()
  }
  window.addEventListener('wheel', abandon, { passive: true, once: true })
  window.addEventListener('touchstart', abandon, { passive: true, once: true })
  window.addEventListener('keydown', abandon, { once: true })

  const settle = (): void => {
    if (run.cancelled) return
    const room = root.scrollHeight - window.innerHeight
    /*
     * WAIT FOR THE PAGE THE POSITION WAS MEASURED AGAINST. Applying it to a
     * half-built page is what caused the 746px error: the number only means
     * something once the document is at least as tall as it was when the
     * reader left. Where no height was recorded — an entry stamped before
     * this existed — being able to reach the target is the best test there is.
     */
    const grown = docHeight > 0 ? root.scrollHeight >= docHeight : room >= target
    if (!grown && performance.now() < until) {
      requestAnimationFrame(settle)
      return
    }
    /*
     * A SCREEN THAT CAME BACK SHORTER IS NOT A REASON TO SLAM TO THE BOTTOM.
     *
     * Clamping blindly to `room` sent the reader to the foot of the page a
     * second and a half after they pressed back, whenever the returning
     * screen could not reach its recorded height — a desk with fewer posts
     * than before, a filter left narrower. Within a small shortfall the
     * bottom genuinely is the nearest thing to where they were; beyond it
     * the honest answer is the top, which is where this app has always
     * landed and never surprises anyone.
     */
    if (room + 1 < target && target - room > target * 0.2) {
      window.scrollTo({ top: 0, behavior: 'instant' })
      done()
      return
    }
    window.scrollTo({ top: Math.min(target, Math.max(0, room)), behavior: 'instant' })
    /* One more frame after the page stops moving, so a tile that finishes
       laying out in the same frame cannot leave the reader a little short. */
    requestAnimationFrame(() => {
      if (!run.cancelled) {
        const late = root.scrollHeight - window.innerHeight
        window.scrollTo({ top: Math.min(target, Math.max(0, late)), behavior: 'instant' })
      }
      done()
    })
  }

  requestAnimationFrame(settle)
  // A screen that never reaches its old height must not leave anchoring off.
  window.setTimeout(done, 2000)
}

/**
 * How many entries into this app the reader is, so a Back CONTROL can tell
 * whether stepping back is ours to do.
 *
 * A back button that calls `setTab` walks FORWARD in history while looking
 * like it walks back: the stack grows, the position is lost, and pressing the
 * browser's own back afterwards returns to the screen the button just left.
 * Where this reports a depth above zero there is an entry of ours underneath,
 * and the honest implementation of a back control is `history.back()`.
 */
export function navDepth(): number {
  try {
    return entryOf(window.history.state)?.depth ?? 0
  } catch {
    return 0
  }
}

/** The current entry, so a caller stripping a query string can preserve it. */
export function currentNavState(): unknown {
  try {
    return window.history.state
  } catch {
    return null
  }
}

/**
 * The screen the reader was on, surviving a refresh.
 *
 * `history.state` outlives a reload — the browser hands the same entry back —
 * but the app booted `useState<Tab>('dashboard')` regardless, so F5 threw
 * away the reader's place on every screen. The overlay half of the point is
 * deliberately NOT restored: a sheet that reopens itself over a fresh page
 * reads as the app doing something the reader did not ask for.
 */
export function restoredTab(): Tab | null {
  try {
    return entryOf(window.history.state)?.point.tab ?? null
  } catch {
    return null
  }
}

const same = (a: NavPoint, b: NavPoint): boolean => a.tab === b.tab && a.overlay === b.overlay

/**
 * Keep `point` and the browser's history in step.
 *
 * `onPop` is called when the reader moves through history and must apply the
 * point WITHOUT routing back through whatever calls this hook, or the two would
 * push each other in circles.
 */
export function useNavHistory(
  point: NavPoint,
  onPop: (point: NavPoint, scrollY: number, docHeight: number) => void,
): void {
  /** The point the history stack currently reflects. */
  const shown = useRef<NavPoint>(point)
  /** Seeded from the surviving entry on mount, for the reason written there. */
  const depth = useRef(0)
  /** Set while a popstate is being applied, so the sync effect stays quiet. */
  const applying = useRef(false)
  /** Read through a ref so the listener is installed once, not per render. */
  const onPopRef = useRef(onPop)
  onPopRef.current = onPop

  // Stamp the entry the app opened on. replaceState, not push: arriving is not
  // a step, and pushing here would make the first back press a no-op that looks
  // like a frozen button.
  useEffect(() => {
    /**
     * A RELOAD IS NOT A FRESH ARRIVAL.
     *
     * This wrote `depth: 0` unconditionally, throwing away the depth the
     * surviving entry already carried — while `restoredTab()` on the way in
     * trusts that very same entry for which screen to show. So after any
     * refresh the app believed it was the first page in the tab, and every
     * Back control fell through to `goTo('dashboard')`: a FORWARD navigation,
     * growing the stack and landing on the dashboard rather than stepping
     * back to Compare. Pull-to-refresh on a phone made it routine.
     *
     * The entry that survived is the truth about where the reader is; only a
     * genuinely new entry starts at zero.
     */
    const held = entryOf(window.history.state)
    const first: Entry = held
      ? { ...held, point: shown.current }
      : { point: shown.current, depth: 0, scrollY: 0, docHeight: 0 }
    try {
      // The browser's own scroll restoration is guesswork on a page whose
      // content arrives after the entry does, and it fights the exact
      // restoration below. We own the position now, so we say so.
      if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
      depth.current = first.depth
      window.history.replaceState({ ...(window.history.state ?? {}), [KEY]: first }, '')
    } catch {
      /* Storage-partitioned or sandboxed frames can refuse. The app still
         works; back simply behaves as it did before this existed. */
    }
  }, [])

  useEffect(() => {
    const onPopState = (e: PopStateEvent): void => {
      const entry = entryOf(e.state)
      // No entry of ours means the reader has walked back past the point where
      // this app started. Let the browser do what it was going to do.
      if (!entry) return
      applying.current = true
      shown.current = entry.point
      depth.current = entry.depth
      onPopRef.current(entry.point, entry.scrollY, entry.docHeight)
      // Cleared after the render this triggers has been committed, so the sync
      // effect below sees the flag and skips the round trip.
      queueMicrotask(() => {
        applying.current = false
      })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (applying.current) return
    const from = shown.current
    if (same(from, point)) return

    /**
     * The one case that walks backward: the overlay that was open has closed
     * and nothing else moved.
     */
    const closedAnOverlay =
      from.overlay !== null && point.overlay === null && from.tab === point.tab

    /**
     * A SHEET THE READER NAVIGATED THROUGH IS NOT A PLACE.
     *
     * Opening the More sheet and tapping a destination pushed a third entry
     * on top of the sheet's own, so back from that screen RE-OPENED the sheet
     * instead of returning to where the reader started. Nobody thinks of a
     * menu as somewhere they have been; they think of it as how they got
     * somewhere. So the sheet's entry is replaced by the destination rather
     * than buried under it, and one back press lands where it should.
     */
    const navigatedThroughAnOverlay =
      from.overlay !== null && point.overlay === null && from.tab !== point.tab

    try {
      /*
       * NO CAPTURE HERE, DELIBERATELY.
       *
       * The obvious place to record the outgoing position is this effect, and
       * it is the wrong one: it runs after React has committed, by which
       * point the navigating call site has ALREADY run its own
       * `window.scrollTo({ top: 0 })` synchronously inside the click handler.
       * Reading the position here therefore records zero every single time,
       * and back would restore the top of the page while looking like it
       * remembered something. The call sites capture instead, before they
       * move anything — see `captureScroll`.
       */
      if (closedAnOverlay && depth.current > 0) {
        shown.current = point
        depth.current -= 1
        window.history.back()
        return
      }
      /* An overlay opening is the one forward move no call site records. It
         changes no screen and runs no scroll reset, so the live position is
         still the reader's own — and this is the last instant `replaceState`
         addresses the entry underneath rather than the one about to be
         pushed. Without it, closing the history panel returned to the top. */
      if (from.tab === point.tab && from.overlay === null && point.overlay !== null) {
        captureScroll()
      }
      if (navigatedThroughAnOverlay) {
        const entry: Entry = { point, depth: depth.current, scrollY: 0, docHeight: 0 }
        window.history.replaceState({ ...(window.history.state ?? {}), [KEY]: entry }, '')
        shown.current = point
        return
      }
      depth.current += 1
      // A screen arrived at is read from its top; only a screen RETURNED to
      // carries a position, and that one is already on the stack.
      const entry: Entry = { point, depth: depth.current, scrollY: 0, docHeight: 0 }
      window.history.pushState({ ...(window.history.state ?? {}), [KEY]: entry }, '')
      shown.current = point
    } catch {
      // Some embedded webviews rate-limit pushState. Losing a back step is
      // survivable; a thrown error inside a layout effect is not.
      shown.current = point
    }
  }, [point.tab, point.overlay])
}

/* ── layers a screen owns itself ─────────────────────────────────────────── */

/**
 * Layer ids are unique to this page load, not just to this session.
 *
 * The counter restarted at 1 on every reload while a `signalLayer: 1` from
 * BEFORE the reload could still be sitting in the surviving history entry. A
 * back press then matched a layer that no longer existed, and the sub-page it
 * was supposed to dismiss stayed open. The prefix makes an id from a previous
 * load unmistakable for one of ours.
 */
const LAYER_SESSION = Math.random().toString(36).slice(2, 8)
let nextLayerId = 1
const layerKey = (id: number): string => `${LAYER_SESSION}:${id}`

/**
 * Make back dismiss a full-screen layer that a screen owns, rather than leaving
 * the screen.
 *
 * `useNavHistory` covers the screens and the two overlays the shell knows
 * about, but some screens stack their own. On a phone the grievance record
 * detail REPLACES the list (`selected && 'hidden'` in Grievances.tsx) and the
 * head to head replaces the comparison; both are the whole window, both have
 * their own Back control, and back should close them for the same reason it
 * closes the history panel. Threading each one up into App would mean prop
 * plumbing through screens that have no other reason to know the shell exists,
 * so a layer registers itself instead.
 *
 * The discipline is identical to the overlay branch above, which is what lets
 * the two compose: push when the layer opens, `history.back()` when it closes
 * by any other route, and on popstate dismiss without pushing. The pushed entry
 * carries the screen's own nav point forward unchanged, so the shell's listener
 * sees the point it is already showing and does nothing.
 */
export function useBackToDismiss(open: boolean, onDismiss: () => void): void {
  /** Our entry's id while one is on the stack, else null. */
  const ours = useRef<string | null>(null)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    const onPopState = (e: PopStateEvent): void => {
      const id = ours.current
      if (id === null) return
      const state = e.state as Record<string, unknown> | null
      // Still ours means this popstate was about something else, stacked above.
      if (state && state['signalLayer'] === id) return
      ours.current = null
      dismissRef.current()
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      /**
       * UNWIND ONLY WHAT IS STILL ON TOP.
       *
       * This called `history.back()` on any unmount, which undid the very
       * navigation that caused it: leaving a screen while its sub-page was
       * open pushed the destination, then this cleanup stepped straight back
       * off it and the reader was bounced to the screen they had just left.
       *
       * Our entry is only ours to unwind while nothing has been pushed over
       * it. Once something has, the layer's entry is buried — harmless, and
       * not ours to touch.
       */
      const id = ours.current
      ours.current = null
      if (id === null) return
      try {
        const state = window.history.state as Record<string, unknown> | null
        if (state && state['signalLayer'] === id) window.history.back()
      } catch {
        /* nothing to unwind */
      }
    }
  }, [])

  useEffect(() => {
    try {
      if (open && ours.current === null) {
        // The screen underneath keeps its place, so dismissing the layer
        // returns to it rather than to its top.
        captureScroll()
        const id = layerKey(nextLayerId++)
        ours.current = id
        window.history.pushState({ ...(window.history.state ?? {}), signalLayer: id }, '')
        return
      }
      if (!open && ours.current !== null) {
        ours.current = null
        window.history.back()
      }
    } catch {
      // A webview that refuses pushState loses the back step and nothing else.
      ours.current = null
    }
  }, [open])
}
