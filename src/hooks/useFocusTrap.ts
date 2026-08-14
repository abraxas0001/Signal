import { useEffect, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Keep keyboard focus inside an open dialog, and give it back on close.
 *
 * `aria-modal="true"` is a promise to assistive technology that the rest of the
 * page is inert. Without a real trap that promise is false: Tab walks straight
 * out of the sheet into the report behind it, and a screen-reader user ends up
 * reading content the dialog claims is unavailable. Restoring focus to the
 * element that opened the dialog is the other half — otherwise focus resets to
 * the top of the document and the user loses their place entirely.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return
    const container = ref.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    // Move focus in. Prefer the first real control; fall back to the container.
    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )

    const first = focusables()[0]
    if (first) first.focus()
    else {
      container.setAttribute('tabindex', '-1')
      container.focus()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const firstItem = items[0] as HTMLElement
      const lastItem = items[items.length - 1] as HTMLElement
      const activeEl = document.activeElement

      if (e.shiftKey && (activeEl === firstItem || !container.contains(activeEl))) {
        e.preventDefault()
        lastItem.focus()
      } else if (!e.shiftKey && activeEl === lastItem) {
        e.preventDefault()
        firstItem.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      // Give focus back to whatever opened the dialog.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [ref, active])
}
