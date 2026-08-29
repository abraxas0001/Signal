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
export function useNavHistory(point: NavPoint, onPop: (point: NavPoint) => void): void {
  /** The point the history stack currently reflects. */
  const shown = useRef<NavPoint>(point)
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
    const first: Entry = { point: shown.current, depth: 0 }
    try {
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
      onPopRef.current(entry.point)
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
     * and nothing else moved. Anything else is forward, including opening an
     * overlay and changing screen in the same beat.
     */
    const closedAnOverlay =
      from.overlay !== null && point.overlay === null && from.tab === point.tab

    try {
      if (closedAnOverlay && depth.current > 0) {
        shown.current = point
        depth.current -= 1
        window.history.back()
        return
      }
      depth.current += 1
      const entry: Entry = { point, depth: depth.current }
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

let nextLayerId = 1

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
  const ours = useRef<number | null>(null)
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
      // Unmounting while our entry is live would strand it, and the next back
      // press would look like it did nothing.
      if (ours.current !== null) {
        ours.current = null
        try {
          window.history.back()
        } catch {
          /* nothing to unwind */
        }
      }
    }
  }, [])

  useEffect(() => {
    try {
      if (open && ours.current === null) {
        const id = nextLayerId++
        ours.current = id
        window.history.pushState(
          { ...(window.history.state ?? {}), signalLayer: id },
          '',
        )
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
