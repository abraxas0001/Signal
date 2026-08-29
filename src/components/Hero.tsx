import { useEffect, useRef, useState } from 'react'
import * as m from 'motion/react-m'
import { AnimatePresence } from 'motion/react'
import { ArrowRight, CircleAlert, ClipboardPaste, Link2, Sparkles } from 'lucide-react'
import { Mascot } from './Mascot'
import { HeroPreview } from './HeroPreview'
import { Button, Chip } from './ui'
import { ease, haptic, listItem, listStagger, wordIn, wordStagger } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { readStore } from '@/lib/store'

/**
 * Platforms we have a dedicated adapter for, shown so expectations are set.
 * Ordered by how complete the extraction actually is, not by platform size —
 * the first names are the ones that return every metric exactly.
 */
const SUPPORTED = [
  'YouTube',
  'X',
  'Facebook',
  'Instagram',
  'Bluesky',
  'Mastodon',
  'LinkedIn',
  'Reddit',
  'Telegram',
  'TikTok',
  'News sites',
]

export function Hero({
  onSubmit,
  onOpenExample,
  onClose,
  initialUrl = '',
}: {
  onSubmit: (url: string) => void
  /** Opens the worked example, so the home screen can show its own output. */
  onOpenExample: () => void
  /**
   * Back to the dashboard.
   *
   * Every other screen carries one and this was the only one that did not: a
   * desk that tapped "Analyse a link", then thought better of it, had no way
   * out except the navigation — which reads as being stuck on a screen you
   * only meant to glance at. Optional, because on a first run this IS the
   * screen and there is nothing behind it.
   */
  onClose?: () => void
  initialUrl?: string
}) {
  /**
   * The dateline seat. `readStore` rather than `useStore`: the hero is the
   * analyse screen's static opening and has no reason to re-render on every
   * store write, and the seat does not change mid-visit.
   */
  const deskName = (() => {
    const p = readStore().profile
    const seat = p?.district ?? p?.constituency
    return seat && seat.trim() ? `${seat} desk` : 'Your desk'
  })()

  const [url, setUrl] = useState(initialUrl)
  const [error, setError] = useState<string | null>(null)
  const [canPaste, setCanPaste] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // navigator.clipboard.readText only exists in secure contexts, and Safari
    // refuses it outside a user gesture — feature-detect rather than assume.
    setCanPaste(typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText))
  }, [])

  const submit = () => {
    const trimmed = url.trim()
    if (!trimmed) {
      setError('Paste a link to a post first.')
      inputRef.current?.focus()
      return
    }
    if (!/\./.test(trimmed)) {
      setError('That does not look like a link.')
      return
    }
    setError(null)
    haptic.tap()
    onSubmit(trimmed)
  }

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text?.trim()) {
        setUrl(text.trim())
        setError(null)
        haptic.tap()
      }
    } catch {
      // Permission denied is normal; the user can still paste manually.
      inputRef.current?.focus()
    }
  }

  return (
    <m.div
      className="shell shell-prose pb-10"
      variants={listStagger}
      initial="hidden"
      animate="show"
    >
      {/* The way out, in the same place and with the same words every other
          screen puts it. Absent on a first run, where this is the whole app
          and there is nothing behind it to go back to. */}
      {onClose && (
        <m.div variants={listItem} className="flex justify-end pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Back
          </Button>
        </m.div>
      )}

      {/* ── Opening ─────────────────────────────────────────────────────────
          A dateline, not a badge: where this desk sits, and what it can read.
          The mascot's mood is the app's state, not decoration — idle here,
          thinking while a screen is reading. */}
      <m.div variants={listItem} className="mt-5 flex items-center gap-3">
        <Mascot state="idle" size={44} className="shrink-0" />
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          {/* Whose desk, read from the store, not a hardcoded seat. This said
              "Eluru desk" for every office: the string survived from the first
              client's build and shipped to a demo whose flagship seat is
              Mahabubnagar. A dateline that names the wrong district is worse
              than none. */}
          <span className="kicker text-[var(--accent)]">{deskName}</span>
          <span aria-hidden className="h-3 w-px bg-[var(--rule)]" />
          <span className="kicker">Telugu · Hindi · English</span>
        </div>
      </m.div>

      {/* Assembles word by word. Each word is its own transform, so the line
          arrives with authorship rather than appearing finished. One bold
          sans voice; the closing word takes the product blue instead of a
          typeface change. */}
      <m.h1
        className="hed mt-6 text-4xl"
        variants={wordStagger}
        initial="hidden"
        animate="show"
      >
        {['Read', 'any', 'post'].map((w) => (
          <m.span key={w} variants={wordIn} className="mr-[0.22em] inline-block">
            {w}
          </m.span>
        ))}
        <br />
        <m.span variants={wordIn} className="inline-block text-[var(--accent)]">
          properly.
        </m.span>
      </m.h1>

      <m.p
        variants={listItem}
        className="mt-4 max-w-[36ch] text-base leading-relaxed text-ink-2"
      >
        Paste a link to a public post. You get{' '}
        <span className="marked font-medium text-ink">what it says, what it means</span>, and what
        to do about it.
      </m.p>

      {/* ── The analyse card ────────────────────────────────────────────────
          The primary control of the whole product, so it gets the one lifted
          panel on the screen: a large pill field and a full-width pill CTA
          inside a white card. 16px input text minimum, or iOS zooms the
          viewport on focus. */}
      <m.div variants={listItem} className="mt-8">
        <div className="card card-lift p-5 sm:p-6">
          <label htmlFor="post-link" className="kicker block">
            Post link
          </label>

          <div
            className={cn(
              'mt-3 flex items-center overflow-hidden rounded-full border bg-[var(--surface-2)]',
              'transition-[border-color,box-shadow,background-color] duration-200',
              error
                ? 'border-[var(--neg)]'
                : 'border-[var(--border-strong)] focus-within:border-[var(--accent)] focus-within:bg-[var(--surface)] focus-within:shadow-[0_0_0_4px_var(--accent-soft)]',
            )}
          >
            <span className="grid w-12 shrink-0 place-items-center text-ink-3">
              <Link2 size={18} />
            </span>

            <input
              id="post-link"
              ref={inputRef}
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                if (error) setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              placeholder="youtube.com/watch?v=…"
              aria-label="Post link"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'url-error' : undefined}
              className="h-14 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-3"
            />

            {canPaste && !url && (
              <button
                onClick={pasteFromClipboard}
                aria-label="Paste from clipboard"
                className="mr-1.5 grid size-11 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-[var(--surface-3)] hover:text-ink"
              >
                <ClipboardPaste size={17} />
              </button>
            )}
          </div>

          <AnimatePresence>
            {error && (
              <m.p
                id="url-error"
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={ease.out}
                /* An icon as well as red: the state must not rest on colour
                   alone. */
                className="mt-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--neg)]"
              >
                <CircleAlert size={14} className="shrink-0" aria-hidden />
                {error}
              </m.p>
            )}
          </AnimatePresence>

          <Button onClick={submit} size="lg" className="sheen mt-4 w-full">
            <Sparkles size={17} />
            Analyse this post
            <ArrowRight size={17} />
          </Button>
        </div>
      </m.div>

      {/* ── Proof ───────────────────────────────────────────────────────────
          Three facts that answer the questions a new user actually has, then
          the output itself. A form that describes its result is asking to be
          imagined; showing the result is the whole difference. */}
      <m.div variants={listItem} className="mt-7">
        <HeroPreview onOpen={onOpenExample} />
      </m.div>

      {/* ── Colophon ────────────────────────────────────────────────────────
          Quiet soft-tinted labels, not buttons: no borders, no shadows, and
          nothing here promises an interaction that does not exist. */}
      <m.div variants={listItem} className="mt-8">
        <p className="kicker">Works with</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUPPORTED.map((p) => (
            <Chip key={p}>{p}</Chip>
          ))}
        </div>
      </m.div>

    </m.div>
  )
}
