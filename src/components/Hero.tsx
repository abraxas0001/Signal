import { useEffect, useRef, useState } from 'react'
import * as m from 'motion/react-m'
import { AnimatePresence } from 'motion/react'
import { ArrowRight, ClipboardPaste, Link2, Sparkles } from 'lucide-react'
import { Mascot } from './Mascot'
import { HeroPreview } from './HeroPreview'
import { Button } from './ui'
import { ease, haptic, listItem, listStagger, spring, wordIn, wordStagger } from '@/lib/motion'
import { cn } from '@/lib/utils'

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
          A dateline, not a badge.

          This was a cartoon face beside a pastel pill. On a screen an office
          opens to check what is being said about them — including who is
          spreading fabricated video — a mascot is the single loudest signal
          that the tool is not serious, and it was the largest object above the
          fold. The line that replaces it is the one a wire dispatch carries:
          where this desk sits, and what it can read. */}
      <m.div variants={listItem} className="mt-5 flex items-center gap-3">
        {/* Back by request, and sized to sit beside the dateline rather than
            loom over the headline the way it first did. Its mood is the app's
            state, not decoration: idle here, thinking while a screen is reading,
            alarmed where something is overdue. */}
        <Mascot state="idle" size={44} className="shrink-0" />
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="kicker text-[var(--accent)]">Eluru desk</span>
          <span aria-hidden className="h-3 w-px bg-[var(--rule)]" />
          <span className="kicker">Telugu · Hindi · English</span>
        </div>
      </m.div>
      <div className="mt-3 border-b border-[var(--rule)]" />

      {/* Assembles word by word. Each word is its own transform, so the line
          arrives with authorship rather than appearing finished. */}
      <m.h1
        className="hed hed-grad mt-5 text-4xl"
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
        {/* The one classic note on the screen: a high-contrast italic serif,
            set slightly larger to hold its weight against the sans. Used here
            and on pull quotes, nowhere else. */}
        <m.span variants={wordIn} className="serif inline-block text-[1.08em]">
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

      {/* ── The wire slot ───────────────────────────────────────────────────
          A ruled field rather than a rounded box: one hairline above, one ink
          rule below that takes the accent on focus. 16px text minimum, or iOS
          zooms the viewport on focus. */}
      <m.div variants={listItem} className="mt-8">
        {/* A real, soft-edged field again. The bare ruled line was austere and
            gave the primary control of the whole product no presence. */}
        <div
          className={cn(
            'flex items-stretch overflow-hidden rounded-[--radius-lg] border bg-[var(--surface)] shadow-[var(--e2)]',
            'transition-[border-color,box-shadow] duration-200',
            error
              ? 'border-[var(--neg)]'
              : 'border-[var(--border-interactive)] focus-within:border-[var(--accent)] focus-within:shadow-[var(--e3)]',
          )}
        >
          <span className="grid w-11 shrink-0 place-items-center text-ink-3">
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
              className="grid size-12 shrink-0 place-items-center border-l border-[var(--border)] text-ink-3 transition-colors hover:bg-[var(--surface-2)] hover:text-ink"
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
              /* Mono as well as red: the state must not rest on colour alone. */
              className="mt-2 font-[var(--font-mono)] text-[12px] uppercase tracking-[0.08em] text-[var(--neg)]"
            >
              {error}
            </m.p>
          )}
        </AnimatePresence>

        <Button onClick={submit} size="lg" className="sheen mt-3 w-full">
          <Sparkles size={17} />
          Analyse this post
          <ArrowRight size={17} />
        </Button>
      </m.div>

      {/* ── Proof ───────────────────────────────────────────────────────────
          Three facts that answer the questions a new user actually has, then
          the output itself. A form that describes its result is asking to be
          imagined; showing the result is the whole difference. */}
      <m.div variants={listItem} className="mt-7 grid grid-cols-3 gap-3">
        {[
          ['14', 'platforms'],
          ['0', 'API keys needed'],
          ['~4s', 'per post'],
        ].map(([value, label]) => (
          <div key={label} className="border-t border-[var(--border)] pt-2.5">
            <p className="num text-xl">{value}</p>
            <p className="mt-0.5 text-2xs leading-tight text-ink-3">{label}</p>
          </div>
        ))}
      </m.div>

      <m.div variants={listItem} className="mt-7">
        <HeroPreview onOpen={onOpenExample} />
      </m.div>

      {/* ── Colophon ────────────────────────────────────────────────────────
          Eleven pill chips read as eleven buttons, and none of them were
          tappable. A single mono line says the same thing, recovers about
          90px, and stops promising an interaction that does not exist. */}
      <m.div variants={listItem} className="mt-8 border-t border-[var(--border)] pt-3">
        <p className="kicker">Works with</p>
        <p className="mt-2 font-[var(--font-mono)] text-[11px] leading-[1.9] tracking-[0.08em] text-ink-3">
          {SUPPORTED.join(' · ').toUpperCase()}
        </p>
      </m.div>

      <m.p
        variants={listItem}
        className="mt-5 border-t border-[var(--border)] pt-3 text-xs leading-relaxed text-ink-3"
      >
        Public posts only. Nothing is stored on a server, so your history stays on this device.
      </m.p>
    </m.div>
  )
}
