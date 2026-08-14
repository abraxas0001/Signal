import { useEffect, useRef, useState } from 'react'
import * as m from 'motion/react-m'
import { AnimatePresence } from 'motion/react'
import { ImageUp, Trash2, X } from 'lucide-react'
import type { AnalyseRequest } from '@shared/types'
import { Button } from './ui'
import { spring, ease, haptic } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { parseCountField } from '@shared/parse'

/**
 * The rescue path, offered whenever a platform gave us less than we needed.
 *
 * Ordering here follows what actually works: pasting the text is a ten-second
 * job against a card that already shows which post it is, so it comes first.
 * The screenshot route is genuinely useful for private or age-gated posts that
 * no server-side method can ever reach, but it is slower and lossier, so it is
 * offered second rather than as the headline fix.
 *
 * Hand-rolled rather than pulled from a drawer library: this sheet contains
 * inputs, and the two candidate libraries each fail that case differently
 * (Base UI has no keyboard-aware repositioning; vaul has been frozen since
 * 2024). Motion's spring.settle gives the same feel in far less code.
 */
export function RescueSheet({
  open,
  reason,
  suggestion,
  onClose,
  onSubmit,
}: {
  open: boolean
  reason?: string
  suggestion?: string
  onClose: () => void
  onSubmit: (patch: Partial<AnalyseRequest>) => void
}) {
  const [text, setText] = useState('')
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [counts, setCounts] = useState({ likes: '', comments: '', shares: '', views: '' })
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const scrollY = useRef(0)

  // aria-modal promises the rest of the page is inert. This makes that true:
  // without it, Tab walks straight out of the sheet into the report behind it.
  useFocusTrap(sheetRef, open)

  /**
   * Clear the form on every open.
   *
   * The component stays mounted between analyses, so without this a user who
   * pastes one post's text, closes the sheet, then opens it for a different
   * post submits the first post's words as the second's — analysing the wrong
   * content while presenting it as that post's report.
   */
  useEffect(() => {
    if (!open) return
    setText('')
    setScreenshot(null)
    setCounts({ likes: '', comments: '', shares: '', views: '' })
    setError(null)
    setFieldErrors([])
    if (fileRef.current) fileRef.current.value = ''
  }, [open])

  // Locking the body with `overflow: hidden` does not hold on iOS — touchmove
  // bubbles past it. Fixing the body and restoring scroll is what actually works.
  useEffect(() => {
    if (!open) return
    scrollY.current = window.scrollY
    const { style } = document.body
    const prev = { position: style.position, top: style.top, width: style.width }
    style.position = 'fixed'
    style.top = `-${scrollY.current}px`
    style.width = '100%'
    return () => {
      style.position = prev.position
      style.top = prev.top
      style.width = prev.width
      window.scrollTo(0, scrollY.current)
    }
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const pickFile = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image.')
      return
    }
    if (file.size > 5_000_000) {
      setError('That image is over 5 MB. Try a smaller screenshot.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setScreenshot(typeof reader.result === 'string' ? reader.result : null)
      setError(null)
      haptic.tap()
    }
    reader.onerror = () => setError('Could not read that file.')
    reader.readAsDataURL(file)
  }

  const submit = () => {
    // Parse with the same rules the server uses, so "1.2K" means 1200 rather
    // than 12 and an unreadable entry becomes an error rather than a wrong
    // number presented as a measurement.
    const parsed: Record<string, number> = {}
    const bad: string[] = []

    for (const [key, raw] of Object.entries(counts)) {
      const result = parseCountField(raw)
      if (result.state === 'ok') parsed[key] = result.value
      else if (result.state === 'invalid') bad.push(key)
    }

    if (bad.length) {
      setFieldErrors(bad)
      setError(
        `We could not read the ${bad.join(' and ')} figure. Numbers like 1200, 1.2K or 12L all work.`,
      )
      return
    }

    const hasCounts = Object.keys(parsed).length > 0

    if (!text.trim() && !screenshot && !hasCounts) {
      setError('Add the post text, a screenshot, or at least one number.')
      return
    }

    haptic.success()
    setFieldErrors([])
    onSubmit({
      ...(text.trim() ? { manualText: text.trim() } : {}),
      ...(screenshot ? { screenshot } : {}),
      ...(hasCounts ? { manualEngagement: parsed as AnalyseRequest['manualEngagement'] } : {}),
    })
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <m.div
            className="fixed inset-0 z-40 bg-black/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={ease.out}
            onClick={onClose}
          />

          <m.div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Add the missing details"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[92svh] overflow-y-auto rounded-t-[--radius-2xl] border-t border-[var(--border)] bg-[var(--surface)] scroller"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            /* Never bounce a sheet — a bouncing sheet reads as broken. */
            transition={spring.settle}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 500) onClose()
            }}
          >
            {/* Grab handle */}
            <div className="sticky top-0 z-10 flex justify-center bg-[var(--surface)] pb-1 pt-3">
              <div className="h-1 w-9 rounded-full bg-[var(--text-3)]/40" />
            </div>

            <div className="px-4 pb-[calc(var(--sab)+20px)] pt-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold">Fill in the gaps</h2>
                  {reason && (
                    <p className="mt-1 text-sm text-ink-2">{reason}</p>
                  )}
                  {suggestion && (
                    <p className="mt-1 text-sm text-ink-3">{suggestion}</p>
                  )}
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="-mr-1 grid size-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-2)]"
                >
                  <X size={19} />
                </button>
              </div>

              {/* 1. Post text — the fastest and most reliable rescue. */}
              <label className="mt-5 block">
                <span className="text-sm font-medium">Post text</span>
                <span className="ml-1.5 text-xs text-ink-3">
                  paste it in any language
                </span>
                <textarea
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value)
                    setError(null)
                  }}
                  rows={5}
                  placeholder="Paste the words from the post here…"
                  className="mt-1.5 w-full resize-y rounded-[--radius-md] border border-[var(--border-interactive)] bg-[var(--surface-2)] p-3 leading-relaxed outline-none focus:border-[var(--accent)]"
                />
              </label>

              {/* 2. Engagement numbers */}
              <fieldset className="mt-4">
                <legend className="text-sm font-medium">Engagement</legend>
                <p className="text-xs text-ink-3">
                  Only what you can see. Leave the rest blank.
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(['likes', 'comments', 'shares', 'views'] as const).map((k) => (
                    <label key={k} className="block">
                      <span className="text-2xs uppercase tracking-[0.04em] text-ink-3">
                        {k}
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={counts[k]}
                        onChange={(e) => {
                          setCounts((c) => ({ ...c, [k]: e.target.value }))
                          setError(null)
                          setFieldErrors((f) => f.filter((x) => x !== k))
                        }}
                        placeholder="—"
                        aria-invalid={fieldErrors.includes(k)}
                        className={cn(
                          'mt-0.5 w-full rounded-[--radius-sm] border bg-[var(--surface-2)] px-2.5 py-2 tabular-nums outline-none focus:border-[var(--accent)]',
                          fieldErrors.includes(k)
                            ? 'border-[var(--neg)]'
                            : 'border-[var(--border-interactive)]',
                        )}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* 3. Screenshot — slower and lossier, so offered last. */}
              <div className="mt-4">
                <span className="text-sm font-medium">Screenshot</span>
                <span className="ml-1.5 text-xs text-ink-3">
                  optional — we will read it
                </span>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                />

                {screenshot ? (
                  <div className="relative mt-1.5 overflow-hidden rounded-[--radius-md] border border-[var(--border)]">
                    <img src={screenshot} alt="Your screenshot" className="max-h-56 w-full object-contain bg-[var(--surface-2)]" />
                    <button
                      onClick={() => setScreenshot(null)}
                      aria-label="Remove screenshot"
                      className="absolute right-2 top-2 grid size-9 place-items-center rounded-full bg-black/60 text-white"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="mt-1.5 flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded-[--radius-md] border border-dashed border-[var(--border-interactive)] bg-[var(--surface-2)] text-ink-3"
                  >
                    <ImageUp size={20} />
                    <span className="text-sm">Add a screenshot</span>
                  </button>
                )}
              </div>

              <AnimatePresence>
                {error && (
                  <m.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-3 text-sm text-[var(--neg)]"
                  >
                    {error}
                  </m.p>
                )}
              </AnimatePresence>

              <div className={cn('mt-5 flex gap-2')}>
                <Button variant="outline" onClick={onClose} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={submit} className="flex-[2]">
                  Analyse with this
                </Button>
              </div>
            </div>
          </m.div>
        </>
      )}
    </AnimatePresence>
  )
}
