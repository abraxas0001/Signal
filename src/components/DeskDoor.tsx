import { useState } from 'react'
import { Building2, ChevronRight, Eye, EyeOff, X } from 'lucide-react'
import { Button } from './ui'
import { deskSignIn } from '@/lib/desk-session'
import { cn } from '@/lib/utils'

/**
 * The door to a handed-over desk: a desk id and a passphrase, both issued by
 * the office that feeds the desk. It renders as one quiet line until asked,
 * because on any given device at most one person ever needs it — but for that
 * person it is the whole product.
 *
 * Mounted on the lock screen and on the setup screen, which between them are
 * every first screen the app has: whichever one the member lands on, the door
 * is on it.
 */
export function DeskDoor({
  onOpened,
  onOpenChange,
  className,
}: {
  onOpened: () => void
  /** Fires as the form opens and closes, so the host can clear the stage. */
  onOpenChange?: (open: boolean) => void
  className?: string
}) {
  const [open, setOpenState] = useState(false)
  const setOpen = (v: boolean): void => {
    setOpenState(v)
    onOpenChange?.(v)
  }
  const [deskId, setDeskId] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (busy || deskId.trim().length === 0 || passphrase.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await deskSignIn(deskId, passphrase)
      onOpened()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not open.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      /* The demo door's own construction — icon disc, label, chevron, the
         lifted pill — in the sign-in blue rather than the demo's violet, so
         the two doors read as siblings without reading as the same door. */
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'group flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 text-left',
          'bg-[var(--accent)] text-[var(--accent-fg)]',
          'shadow-[0_1px_2px_rgb(16_24_40/0.1),0_10px_24px_-8px_color-mix(in_oklab,var(--accent)_60%,transparent)]',
          'transition-[transform,box-shadow,filter] duration-200 ease-out',
          'hover:-translate-y-0.5 hover:brightness-110',
          'hover:shadow-[0_2px_4px_rgb(16_24_40/0.12),0_16px_32px_-10px_color-mix(in_oklab,var(--accent)_70%,transparent)]',
          'active:translate-y-0 active:brightness-95',
          className,
        )}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/20">
          <Building2 size={17} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-[15px] font-semibold">Login</span>
        <ChevronRight
          size={17}
          className="shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
          aria-hidden
        />
      </button>
    )
  }

  const field =
    'w-full rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-3 text-sm shadow-[var(--e1)] outline-none focus:border-[var(--accent)]'

  return (
    <div
      // min-w so the form stays usable when the collapsed pill sat in an
      // auto-width flex slot: the pill can shrink to its label, the two
      // passphrase fields cannot.
      className={cn(
        'min-w-[300px] max-w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Building2 size={15} aria-hidden />
          Login
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Back to sign in"
          className="-my-1 grid size-9 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-3)]"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      <div className="mt-3 space-y-2.5">
        <input
          value={deskId}
          onChange={(e) => {
            setDeskId(e.target.value)
            if (error) setError(null)
          }}
          placeholder="Desk id"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Desk id"
          className={field}
        />
        <div className="relative">
          <input
            type={shown ? 'text' : 'password'}
            value={passphrase}
            onChange={(e) => {
              setPassphrase(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            placeholder="Passphrase"
            autoComplete="current-password"
            aria-label="Desk passphrase"
            className={cn(field, 'pr-11')}
          />
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? 'Hide passphrase' : 'Show passphrase'}
            className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-3)]"
          >
            {shown ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--neg)_30%,transparent)] bg-[var(--neg-soft)] px-3 py-2 text-sm leading-relaxed text-[var(--neg)]">
          {error}
        </p>
      )}

      <Button
        className="mt-3.5 w-full"
        onClick={() => void submit()}
        disabled={busy || deskId.trim().length === 0 || passphrase.length === 0}
      >
        {busy ? 'Opening…' : 'Open the desk'}
        <ChevronRight size={15} />
      </Button>
    </div>
  )
}
