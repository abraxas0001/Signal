import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, LazyMotion, domAnimation } from 'motion/react'
import * as m from 'motion/react-m'
import {
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  UserPlus,
  X,
} from 'lucide-react'
import { Button, Card, SignalGlyph } from '@/components/ui'
import { DeskDoor } from '@/components/DeskDoor'
import { ease, fadeUp, haptic, listStagger, spring } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import {
  accountsUnreadable,
  activeAccount,
  changePassphrase,
  createAccount,
  deleteAccount,
  exportBackup,
  hasAccounts,
  importBackup,
  isLocked,
  isRestoring,
  restoreSession,
  lastWriteError,
  listAccounts,
  nameProblem,
  passphraseProblem,
  signIn,
  signOut,
  subscribeVault,
  VAULT_PARAMS,
  type AccountSummary,
  type ImportSummary,
} from '@/lib/vault'

/**
 * The door.
 *
 * This is a sign-in, and it is not authentication. Several people can keep
 * separate, separately-encrypted workspaces on one shared office phone; nothing
 * here checks who anybody is. A correct passphrase is simply one that decrypts
 * a blob. Pretending otherwise would be the single most dishonest screen in the
 * product, so this screen says out loud, before anyone commits to it:
 *
 *   • a forgotten passphrase means the records are gone, with nobody to ask;
 *   • this stops the person who picks the phone up, and does not stop a person
 *     who takes the phone away — the encrypted records are on the device either
 *     way, and can be attacked offline for as long as they like.
 *
 * Both sentences are on the create screen, not in a tooltip and not after the
 * fact. An office that learns either one the day it matters has already lost.
 */

/* ── App-shell gating ────────────────────────────────────────────────────── */

/**
 * The lock screen still has something to say after an account opens — namely
 * "take a backup now, this is the only copy". But the natural way to mount this
 * component is `if (locked) return <LockScreen … />`, which unmounts it the
 * instant `createAccount` resolves, so that step would never be seen.
 *
 * So `useVaultState().locked` means "the lock screen is still holding the app",
 * not "the key is null". `isLocked()` in the vault remains the cryptographic
 * truth; this is only about who owns the screen.
 */
let holding = false
const holders = new Set<() => void>()

function setHolding(next: boolean): void {
  if (holding === next) return
  holding = next
  for (const notify of holders) notify()
}

export interface VaultState {
  /** The lock screen should own the app. */
  locked: boolean
  /** This device has at least one account. Kept for callers that gate on it. */
  exists: boolean
  /** Everyone with a workspace on this device, most recently used first. */
  accounts: AccountSummary[]
  /** Who is signed in, or null. */
  account: AccountSummary | null
  /** A stored tab session is being checked; hold the screen until it settles. */
  restoring: boolean
}

export function useVaultState(): VaultState {
  const [, bump] = useState(0)
  useEffect(() => {
    const rerender = (): void => bump((n) => n + 1)
    const unsubscribe = subscribeVault(rerender)
    holders.add(rerender)
    // Put this tab's session back after a reload. Safe to call from every
    // mount: it returns immediately once the check has been made.
    void restoreSession()
    return () => {
      unsubscribe()
      holders.delete(rerender)
    }
  }, [])
  const accounts = listAccounts()
  return {
    locked: isLocked() || holding,
    exists: accounts.length > 0,
    accounts,
    account: activeAccount(),
    // True only while a tab's stored session is being checked on load. The app
    // waits on it rather than painting a lock screen at somebody who is about
    // to be signed straight back in — a flash of "enter your passphrase" that
    // vanishes is worse than a moment of nothing.
    restoring: isRestoring(),
  }
}

/* ── Download ────────────────────────────────────────────────────────────── */

/**
 * Deliberately not `saveBlob` from lib/xlsx. Importing that module to reuse six
 * lines would pull the whole workbook writer into the first chunk the app
 * loads, and the lock screen is the first thing every single session paints.
 */
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // Revoking immediately cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * The account name is in the filename because a device with four accounts
 * produces four files that are otherwise indistinguishable, and restoring the
 * wrong one onto a replacement phone is a silent, expensive mistake. Reduced to
 * plain characters: a Telugu name or a slash in a filename is refused outright
 * by some Android download managers.
 */
function backupFilename(name: string | null): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const slug = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return slug.length > 0 ? `signal-${slug}-${stamp}.json` : `signal-backup-${stamp}.json`
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/* ── Fields ──────────────────────────────────────────────────────────────── */

function PassphraseField({
  id,
  label,
  value,
  onChange,
  onEnter,
  autoComplete,
  hint,
  invalid,
  autoFocus,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  onEnter?: () => void
  autoComplete: 'current-password' | 'new-password'
  hint?: string
  invalid?: boolean
  autoFocus?: boolean
}) {
  const [shown, setShown] = useState(false)

  return (
    <div>
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3"
      >
        {label}
      </label>
      <div
        className={
          'mt-1.5 flex items-stretch overflow-hidden rounded-full border bg-[var(--surface-2)] transition-colors ' +
          (invalid
            ? 'border-[var(--neg)]'
            : 'border-[var(--border-interactive)] focus-within:border-[var(--accent)]')
        }
      >
        <input
          id={id}
          /* A revealed passphrase must still not be autocorrected into a
             different one, which is what happens to a long phrase in a plain
             text field on Android. */
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) onEnter()
          }}
          autoComplete={autoComplete}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          autoFocus={autoFocus}
          aria-invalid={invalid === true}
          /* 16px or iOS Safari zooms the whole page on focus. */
          className="h-12 min-w-0 flex-1 bg-transparent px-4 text-[16px] outline-none placeholder:text-ink-3"
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Hide passphrase' : 'Show passphrase'}
          className="grid w-12 shrink-0 place-items-center rounded-full text-ink-3 hover:text-ink-2"
        >
          {shown ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {hint && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

function NameField({
  id,
  label,
  value,
  onChange,
  onEnter,
  hint,
  autoFocus,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  onEnter?: () => void
  hint?: string
  autoFocus?: boolean
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3"
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) onEnter()
        }}
        maxLength={VAULT_PARAMS.maxName}
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint="next"
        autoFocus={autoFocus}
        className="mt-1.5 h-12 w-full rounded-full border border-[var(--border-interactive)] bg-[var(--surface-2)] px-4 text-[16px] outline-none transition-colors focus:border-[var(--accent)] placeholder:text-ink-3"
      />
      {hint && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'neg'; children: ReactNode }) {
  return (
    <div
      role={tone === 'neg' ? 'alert' : undefined}
      className={
        'flex gap-2.5 rounded-[var(--radius-md)] p-3 text-sm leading-relaxed ' +
        (tone === 'neg'
          ? 'bg-[var(--neg-soft)] text-[var(--neg)]'
          : 'bg-[var(--warn-soft)] text-[var(--warn)]')
      }
    >
      <TriangleAlert size={16} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  )
}

function Busy({ label, busy }: { label: string; busy: boolean }) {
  return (
    <>
      {busy && <RefreshCw size={15} className="animate-spin" />}
      {label}
    </>
  )
}

/**
 * The sentence that keeps this honest, in one place so it cannot be softened on
 * one screen and not another.
 */
function ThreatModel() {
  return (
    <p className="text-xs leading-relaxed text-ink-3">
      This keeps your records apart from other people who use this device, so keep the phone
      with you.
    </p>
  )
}

/* ── Lock screen ─────────────────────────────────────────────────────────── */

type Step = 'pick' | 'signin' | 'create' | 'backup' | 'restore' | 'restored' | 'blocked'

/**
 * The second of the two ways in.
 *
 * A person arriving here has exactly two useful things they might want: to open
 * their own desk, or to find out what this thing is. Those deserve equal
 * billing. This started life as a line of underlined text below the card, which
 * put "see the product" in the visual position of a legal disclaimer — somebody
 * who had not signed up yet had to notice a footnote to get past a passphrase
 * prompt for accounts that were not theirs.
 *
 * It sits INSIDE the card, in the same list as the accounts, because that is
 * where the eye already is. It stays visually secondary to a real account —
 * dashed rather than solid, no filled background — since a returning user came
 * here to sign in and should not have to step around an advertisement.
 */
function DemoOption({ onDemo }: { onDemo: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap()
        onDemo()
      }}
      /**
       * Violet and solid, at the weight of a real action.
       *
       * It was a dashed outline in muted grey, which is the language this
       * interface uses for "add another", "restore from a file" — the
       * housekeeping nobody arrives wanting. A visitor who has not signed up is
       * here to find out what the product is, and the one control that answers
       * that read as the least important thing on the card.
       *
       * `--accent-2` rather than `--accent`: the blue belongs to signing in, and
       * two blue buttons of equal weight would make the reader choose between
       * things that look identical. Violet says "a different kind of door".
       */
      className={cn(
        'group mt-4 flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 text-left',
        'bg-[var(--accent-2)] text-[var(--accent-fg)]',
        // The primary button's own shadow recipe, tinted to this colour: a
        // tight contact shadow over a wide soft one in the button's own hue.
        'shadow-[0_1px_2px_rgb(16_24_40/0.1),0_10px_24px_-8px_color-mix(in_oklab,var(--accent-2)_60%,transparent)]',
        'transition-[transform,box-shadow,filter] duration-200 ease-out',
        'hover:-translate-y-0.5 hover:brightness-110',
        'hover:shadow-[0_2px_4px_rgb(16_24_40/0.12),0_16px_32px_-10px_color-mix(in_oklab,var(--accent-2)_70%,transparent)]',
        'active:translate-y-0 active:brightness-95',
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/20">
        <Eye size={17} />
      </span>
      <span className="min-w-0 flex-1 text-[15px] font-semibold">Try the demo</span>
      <ChevronRight
        size={17}
        className="shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
      />
    </button>
  )
}

export function LockScreen({
  onUnlocked,
  onDemo,
  onDeskOpened,
}: {
  onUnlocked: () => void
  /**
   * Open the example desk without signing in.
   *
   * Absent when the demo dataset is not deployed, so the door is never offered
   * onto an empty room.
   */
  onDemo?: () => void
  /** A handed-over desk opened through the office sign-in. */
  onDeskOpened?: () => void
}) {
  const { accounts } = useVaultState()

  // Read once on mount. Re-deriving the step from `accounts` on every render
  // would yank the person off the create screen the moment their account
  // appears in the index.
  const [step, setStep] = useState<Step>(() => {
    if (accountsUnreadable()) return 'blocked'
    if (!hasAccounts()) return 'create'
    return 'pick'
  })
  const [chosen, setChosen] = useState<AccountSummary | null>(null)

  const [name, setName] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [written, setWritten] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [restored, setRestored] = useState<ImportSummary | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // With exactly one account there is nothing to pick between, so the picker is
  // a dead tap. Jump straight to the passphrase.
  const single = accounts.length === 1 ? accounts[0] : undefined
  useEffect(() => {
    if (step === 'pick' && single !== undefined) {
      setChosen(single)
      setStep('signin')
    }
  }, [step, single])

  // A crash or a route change must never leave the app gated on a flag that
  // nothing is left to clear.
  useEffect(() => () => setHolding(false), [])

  const finish = useCallback(() => {
    setPassphrase('')
    setConfirm('')
    setName('')
    setHolding(false)
    onUnlocked()
  }, [onUnlocked])

  const goto = (next: Step): void => {
    setStep(next)
    setError(null)
    setPassphrase('')
    setConfirm('')
    setName('')
    setFile(null)
  }

  const doSignIn = useCallback(async () => {
    if (busy || chosen === null || passphrase.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await signIn(chosen.id, passphrase)
      haptic.success()
      finish()
    } catch (err) {
      haptic.error()
      setError(messageOf(err, 'That did not open. Check the passphrase and try again.'))
    } finally {
      setBusy(false)
    }
  }, [busy, chosen, passphrase, finish])

  const doCreate = useCallback(async () => {
    if (busy) return
    const badName = nameProblem(name)
    if (badName !== null) {
      setError(badName)
      return
    }
    const problem = passphraseProblem(passphrase)
    if (problem !== null) {
      setError(problem)
      return
    }
    if (passphrase !== confirm) {
      setError('The two passphrases do not match. Retype the second one.')
      return
    }
    if (!written) {
      setError(
        'Write the passphrase down first, then tick the box. There is no way to recover it later.',
      )
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Hold the app before the account opens, so the backup step below is not
      // unmounted by the shell the moment `locked` flips.
      setHolding(true)
      await createAccount(name, passphrase)
      haptic.success()
      setStep('backup')
    } catch (err) {
      setHolding(false)
      haptic.error()
      setError(messageOf(err, 'Could not create the account on this device.'))
    } finally {
      setBusy(false)
    }
  }, [busy, name, passphrase, confirm, written])

  const doBackup = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      download(await exportBackup(passphrase), backupFilename(activeAccount()?.name ?? null))
      setDownloaded(true)
      haptic.success()
    } catch (err) {
      haptic.error()
      setError(messageOf(err, 'Could not build the backup file.'))
    } finally {
      setBusy(false)
    }
  }, [busy, passphrase])

  const doRestore = useCallback(async () => {
    if (busy || file === null) return
    setBusy(true)
    setError(null)
    try {
      // Hold the app across the import for the same reason as create: a
      // successful restore signs the account in, and the shell would otherwise
      // take the screen away before anyone sees what came back.
      setHolding(true)
      const summary = await importBackup(file, passphrase, name)
      setRestored(summary)
      setStep('restored')
      haptic.success()
    } catch (err) {
      setHolding(false)
      haptic.error()
      setError(messageOf(err, 'That backup did not open.'))
    } finally {
      setBusy(false)
    }
  }, [busy, file, passphrase, name])

  return (
    /* Its own LazyMotion: the shell may gate this screen above the app's
       provider, and `m.*` throws without one in scope. Nesting is free. */
    <LazyMotion features={domAnimation} strict>
      <div className="relative flex min-h-screen-safe flex-col justify-center">
        <m.div
          variants={listStagger}
          initial="hidden"
          animate="show"
          className="mx-auto w-full max-w-md px-4 py-10 safe-b"
        >
          <m.div variants={fadeUp} className="mb-6 flex items-center justify-center gap-2.5">
            <span
              className="grid size-10 place-items-center rounded-xl text-[var(--accent-fg)] shadow-[var(--e2)]"
              style={{
                background:
                  'linear-gradient(140deg, var(--accent) 0%, color-mix(in oklab, var(--accent) 74%, var(--aurora-2)) 100%)',
              }}
            >
              <SignalGlyph size={18} />
            </span>
            <span className="hed text-xl leading-none">Signal</span>
          </m.div>

          {step === 'blocked' && (
            <m.div variants={fadeUp}>
              <Card level="lift">
                <div className="flex flex-col items-center gap-3 text-center">
                  <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--neg-soft)] text-[var(--neg)]">
                    <TriangleAlert size={20} />
                  </span>
                  <div className="min-w-0">
                    <h1 className="text-xl font-bold tracking-[-0.015em]">
                      The account list is damaged
                    </h1>
                    <p className="mt-1 text-sm leading-relaxed text-ink-2">
                      Signal can see that this device has accounts on it but cannot read the list of
                      them, so it will not change anything. Writing over it could hide records that
                      are still here.
                    </p>
                  </div>
                </div>

                <div className="mt-5">
                  <Notice tone="warn">
                    The encrypted records have not been touched. If you have a backup file, restore
                    it on another device. Clearing this site's data would remove every account on
                    this one, permanently.
                  </Notice>
                </div>

                <Button variant="outline" className="mt-5 w-full" onClick={() => goto('restore')}>
                  <Upload size={15} />
                  Restore from a backup file
                </Button>
              </Card>
            </m.div>
          )}

          {step === 'pick' && (
            <m.div variants={fadeUp}>
              <Card level="lift">
                <div className="flex flex-col items-center gap-3 text-center">
                  <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                    <Lock size={20} />
                  </span>
                  <div className="min-w-0">
                    <h1 className="text-xl font-bold tracking-[-0.015em]">Sign in</h1>
                    <p className="mt-1 text-sm leading-relaxed text-ink-2">
                      Each account has its own passphrase.
                    </p>
                  </div>
                </div>

                <ul className="mt-5 space-y-2">
                  {accounts.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          haptic.tap()
                          setChosen(a)
                          setError(null)
                          setPassphrase('')
                          setStep('signin')
                        }}
                        className="flex min-h-14 w-full items-center gap-3 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-left shadow-[var(--e1)] transition-colors hover:border-[var(--accent)]"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                          <User size={16} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{a.name}</span>
                        <ChevronRight size={16} className="shrink-0 text-ink-3" />
                      </button>
                    </li>
                  ))}
                </ul>

                {onDemo !== undefined && <DemoOption onDemo={onDemo} />}

                {/* The handed-over desk's own door, at the demo door's weight
                    and directly under it: the two are the ways IN for someone
                    with no vault account on this device. Opening one moves the
                    store's scope, which the shell watches; nothing here needs
                    to know what happens next. */}
                {onDeskOpened !== undefined && <DeskDoor onOpened={onDeskOpened} className="mt-3" />}

                <button
                  type="button"
                  onClick={() => goto('create')}
                  className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 text-sm font-medium text-ink-2"
                >
                  <UserPlus size={15} />
                  Add another person
                </button>
                <button
                  type="button"
                  onClick={() => goto('restore')}
                  className="flex min-h-11 w-full items-center justify-center gap-2 text-sm font-medium text-ink-2"
                >
                  <Upload size={15} />
                  Restore from a backup file
                </button>
              </Card>
            </m.div>
          )}

          {step === 'signin' && chosen !== null && (
            <m.div variants={fadeUp}>
              <Card level="lift">
                <div className="flex flex-col items-center gap-3 text-center">
                  <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                    <Lock size={20} />
                  </span>
                  <div className="min-w-0 max-w-full">
                    {/* No tight tracking here: the name is dynamic and may be Indic. */}
                    <h1 className="truncate text-xl font-bold">{chosen.name}</h1>
                  </div>
                </div>

                <div className="mt-5">
                  <PassphraseField
                    id="vault-passphrase"
                    label="Passphrase"
                    value={passphrase}
                    onChange={(v) => {
                      setPassphrase(v)
                      if (error) setError(null)
                    }}
                    onEnter={() => void doSignIn()}
                    autoComplete="current-password"
                    invalid={error !== null}
                    autoFocus
                  />
                </div>

                {error && (
                  <div className="mt-3">
                    <Notice tone="neg">{error}</Notice>
                  </div>
                )}

                <Button
                  className="mt-5 w-full"
                  onClick={() => void doSignIn()}
                  disabled={busy || passphrase.length === 0}
                >
                  <Busy label={busy ? 'Opening' : 'Sign in'} busy={busy} />
                </Button>

                {/**
                 * The demo belongs on this screen most of all.
                 *
                 * It was on 'pick' and 'create' only — and a device with
                 * exactly ONE account never sees 'pick', because the effect
                 * above skips a picker with nothing to pick between and comes
                 * straight here. That is the overwhelmingly common case, so on
                 * most devices the button existed in the code and nowhere on
                 * screen. Anyone who wanted to show a colleague what Signal
                 * does had to sign in first, or add a second account.
                 */}
                {onDemo !== undefined && <DemoOption onDemo={onDemo} />}

                {/* The handed-over desk's door, HERE as well as on the picker.
                    A device with exactly one vault account skips the picker
                    entirely — this passphrase card is its whole entrance — and
                    the member issued desk credentials had no way in on
                    precisely the screen she was most likely to meet. */}
                {onDeskOpened !== undefined && <DeskDoor onOpened={onDeskOpened} className="mt-3" />}

                {/* The quiet links, spaced as one group rather than each
                    carrying its own margin — the first of them varies with the
                    account count, so a margin on any single one leaves the
                    others touching whatever sits above. */}
                <div className="mt-4">
                  {accounts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setChosen(null)
                        goto('pick')
                      }}
                      className="flex min-h-11 w-full items-center justify-center gap-2 text-sm font-medium text-ink-2"
                    >
                      Sign in as someone else
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => goto('create')}
                    className="flex min-h-11 w-full items-center justify-center gap-2 text-sm font-medium text-ink-2"
                  >
                    <UserPlus size={15} />
                    Add another person
                  </button>
                  <button
                    type="button"
                    onClick={() => goto('restore')}
                    className="flex min-h-11 w-full items-center justify-center gap-2 text-sm font-medium text-ink-2"
                  >
                    <Upload size={15} />
                    Restore from a backup file
                  </button>
                </div>
              </Card>
            </m.div>
          )}

          {step === 'create' && (
            <m.div variants={fadeUp}>
              <Card level="lift">
                <div className="flex flex-col items-center gap-3 text-center">
                  <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                    <ShieldCheck size={20} />
                  </span>
                  <div className="min-w-0">
                    <h1 className="text-xl font-bold tracking-[-0.015em]">
                      {hasAccounts() ? 'Add an account' : 'Create your account'}
                    </h1>
                    <p className="mt-1 text-sm leading-relaxed text-ink-2">
                      Records stay on this device, encrypted with your passphrase.
                    </p>
                  </div>
                </div>

                {/* The one warning that survives the trim.
                    Everything else on this screen was explanation a person can
                    look up later; this is the only line with a consequence they
                    cannot undo, and it has to be read BEFORE the fields, not
                    after the button. */}
                <div className="mt-5">
                  <Notice tone="warn">
                    There is no reset. A forgotten passphrase cannot be recovered by anyone, and
                    this account&rsquo;s records go with it. Write it down.
                  </Notice>
                </div>

                <div className="mt-5 space-y-4">
                  <NameField
                    id="vault-name"
                    label="Name on this account"
                    value={name}
                    onChange={(v) => {
                      setName(v)
                      if (error) setError(null)
                    }}
                    hint="A first name is enough."
                    autoFocus
                  />
                  <PassphraseField
                    id="vault-new"
                    label="Passphrase"
                    value={passphrase}
                    onChange={(v) => {
                      setPassphrase(v)
                      if (error) setError(null)
                    }}
                    autoComplete="new-password"
                    hint={`At least ${VAULT_PARAMS.minPassphrase} characters.`}
                  />
                  <PassphraseField
                    id="vault-confirm"
                    label="Type it again"
                    value={confirm}
                    onChange={(v) => {
                      setConfirm(v)
                      if (error) setError(null)
                    }}
                    onEnter={() => void doCreate()}
                    autoComplete="new-password"
                  />
                </div>

                <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={written}
                    onChange={(e) => {
                      setWritten(e.target.checked)
                      if (error) setError(null)
                    }}
                    className="size-5 shrink-0 accent-[var(--accent)]"
                  />
                  <span>I have written this passphrase down somewhere safe.</span>
                </label>

                {error && (
                  <div className="mt-3">
                    <Notice tone="neg">{error}</Notice>
                  </div>
                )}

                <Button className="mt-5 w-full" onClick={() => void doCreate()} disabled={busy}>
                  <Busy label={busy ? 'Encrypting' : 'Create this account'} busy={busy} />
                </Button>

                {hasAccounts() && (
                  <Button
                    variant="ghost"
                    className="mt-2 w-full"
                    onClick={() => {
                      setChosen(null)
                      goto('pick')
                    }}
                  >
                    Back
                  </Button>
                )}

                {/**
                 * The first screen a brand-new device ever shows is this one,
                 * and until now its only offer was "invent a passphrase for a
                 * product you have not seen". The example desk belongs here
                 * more than anywhere else.
                 */}
                {onDemo !== undefined && <DemoOption onDemo={onDemo} />}

                <div className="mt-5 space-y-2 border-t border-[var(--border)] pt-4">
                  <ThreatModel />
                  <p className="text-xs leading-relaxed text-ink-3">
                    This covers the grievance records, issues, actions, the influencer list and the
                    people you track. Saved report history and account handles are shared across
                    everyone on this device and are not encrypted.
                  </p>
                </div>
              </Card>
            </m.div>
          )}

          {step === 'backup' && (
            <m.div variants={fadeUp}>
              <Card level="lift">
                <div className="flex flex-col items-center gap-3 text-center">
                  <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--pos-soft)] text-[var(--pos)]">
                    <ShieldCheck size={20} />
                  </span>
                  <div className="min-w-0">
                    <h1 className="text-xl font-bold tracking-[-0.015em]">
                      Encrypted. Take a backup.
                    </h1>
                    <p className="mt-1 text-sm leading-relaxed text-ink-2">
                      This file is the only other copy of this account's records, and it is
                      encrypted with the same passphrase. Put it somewhere the office controls.
                    </p>
                  </div>
                </div>

                {error && (
                  <div className="mt-4">
                    <Notice tone="neg">{error}</Notice>
                  </div>
                )}

                <Button className="mt-5 w-full" onClick={() => void doBackup()} disabled={busy}>
                  {busy ? <RefreshCw size={15} className="animate-spin" /> : <Download size={15} />}
                  {downloaded ? 'Download again' : 'Download backup'}
                </Button>

                <Button variant="ghost" className="mt-2 w-full" onClick={finish}>
                  {downloaded ? 'Continue' : 'Skip for now'}
                </Button>

              </Card>
            </m.div>
          )}

          {step === 'restore' && (
            <m.div variants={fadeUp}>
              <Card level="lift">
                <div className="flex flex-col items-center gap-3 text-center">
                  <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                    <Upload size={20} />
                  </span>
                  <div className="min-w-0">
                    <h1 className="text-xl font-bold tracking-[-0.015em]">
                      Restore from a backup
                    </h1>
                  </div>
                </div>

                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null)
                    setError(null)
                  }}
                />

                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="mt-5 flex min-h-14 w-full items-center gap-3 rounded-2xl border border-dashed border-[var(--border-interactive)] bg-[var(--surface-2)] px-4 text-left transition-colors hover:border-[var(--accent)]"
                >
                  <Upload size={18} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {file ? file.name : 'Choose a backup file'}
                  </span>
                </button>

                <div className="mt-4 space-y-4">
                  <NameField
                    id="vault-restore-name"
                    label="Name for the restored account"
                    value={name}
                    onChange={(v) => {
                      setName(v)
                      if (error) setError(null)
                    }}
                    hint="Not stored in the file."
                  />
                  <PassphraseField
                    id="vault-restore"
                    label="Passphrase for that file"
                    value={passphrase}
                    onChange={(v) => {
                      setPassphrase(v)
                      if (error) setError(null)
                    }}
                    onEnter={() => void doRestore()}
                    autoComplete="current-password"
                    invalid={error !== null}
                  />
                </div>

                {error && (
                  <div className="mt-3">
                    <Notice tone="neg">{error}</Notice>
                  </div>
                )}

                <Button
                  className="mt-5 w-full"
                  onClick={() => void doRestore()}
                  disabled={busy || file === null || passphrase.length === 0}
                >
                  <Busy label={busy ? 'Restoring' : 'Restore'} busy={busy} />
                </Button>

                <Button
                  variant="ghost"
                  className="mt-2 w-full"
                  onClick={() => {
                    setChosen(null)
                    goto(accountsUnreadable() ? 'blocked' : hasAccounts() ? 'pick' : 'create')
                  }}
                >
                  Back
                </Button>

                <p className="mt-4 text-xs leading-relaxed text-ink-3">
                  Nothing already on this device is changed or removed.
                </p>
              </Card>
            </m.div>
          )}

          {step === 'restored' && restored && (
            <m.div variants={fadeUp}>
              <Card level="lift">
                <div className="flex flex-col items-center gap-3 text-center">
                  <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--pos-soft)] text-[var(--pos)]">
                    <ShieldCheck size={20} />
                  </span>
                  <div className="min-w-0">
                    <h1 className="text-xl font-bold tracking-[-0.015em]">Restored</h1>
                    <p className="mt-1 text-sm leading-relaxed text-ink-2">
                      This account now holds what was in the file, encrypted with the passphrase you
                      just used.
                    </p>
                  </div>
                </div>

                {/* Counts, not a tick. A backup that silently restored nothing
                    looks exactly like one that worked. */}
                <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {(
                    [
                      ['Records', restored.grievances],
                      ['Issues', restored.issues],
                      ['Actions', restored.actions],
                      ['Influencers', restored.influencers],
                      ['Mentions', restored.mentions],
                    ] as const
                  ).map(([label, count]) => (
                    <div key={label} className="flex items-baseline justify-between gap-2">
                      <dt className="text-ink-3">{label}</dt>
                      <dd className="tnum font-semibold">{count}</dd>
                    </div>
                  ))}
                </dl>

                <Button className="mt-5 w-full" onClick={finish}>
                  Continue
                </Button>
              </Card>
            </m.div>
          )}

        </m.div>
      </div>
    </LazyMotion>
  )
}

/* ── The control that signs out again ────────────────────────────────────── */

/**
 * Sign out, backup, passphrase change and account deletion need somewhere to
 * live once the app is open, and the lock screen is gone by then. Drop this in
 * the app header.
 */
export function LockButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const { account } = useVaultState()

  /**
   * Two different things behind one control, chosen by whether anybody is
   * signed in.
   *
   * It used to be the sheet unconditionally, and the sheet is the menu for an
   * account that already exists: back it up, change its passphrase, sign out of
   * it, delete it. On a device that had never had an account those four options
   * were the only thing on offer and every one of them was meaningless — there
   * was no way to create the first account anywhere in the app. So nobody could
   * be signed in, "Sign out" did nothing but close the sheet, and no sign-in
   * screen ever appeared afterwards because there was no account to sign in to.
   *
   * LockScreen already handles both halves — it offers the account picker when
   * accounts exist and the create form when none do — so signed-out simply goes
   * there.
   */
  /**
   * Which of the two opened, decided on the tap and held until it closes.
   *
   * Reading `account` on every render instead was a bug with a nasty shape:
   * creating an account flips it non-null the instant the key is derived, so
   * the setup flow was torn out from under itself one step early and the backup
   * screen — the only copy of records that cannot otherwise be recovered —
   * never appeared. The flow has to outlive the state change it causes.
   */
  const [mode, setMode] = useState<'sheet' | 'setup' | null>(null)
  const signedIn = mode === 'sheet'

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMode(account !== null ? 'sheet' : 'setup')
          setOpen(true)
        }}
        aria-label={
          account ? `Account and sign out, signed in as ${account.name}` : 'Sign in or create an account'
        }
        title={account ? `Signed in as ${account.name}` : 'Sign in or create an account'}
        className={
          'grid size-11 place-items-center rounded-full text-ink-2 transition-colors hover:bg-[var(--surface-2)] ' +
          (className ?? '')
        }
      >
        <Lock size={18} />
      </button>

      {signedIn ? (
        <VaultSheet open={open} onClose={() => { setOpen(false); setMode(null) }} />
      ) : (
        open &&
        /**
         * Portalled to <body>, and it has to be.
         *
         * This button lives in the header, and the header wears `.glass` —
         * which means `backdrop-filter`. A filtered element becomes the
         * CONTAINING BLOCK for its `position: fixed` descendants, so
         * `fixed inset-0` stopped meaning "the viewport" and started meaning
         * "the header": the whole sign-in screen was laid out inside a 60px
         * strip at the top of the page and clipped. `transform`, `filter`,
         * `perspective`, `contain` and `will-change` do the same thing, so an
         * overlay rendered from anywhere in the tree cannot rely on being able
         * to escape its ancestors. Rendering into <body> is the fix that does
         * not care what any ancestor is doing.
         */
        createPortal(
          <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg)]">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setMode(null)
              }}
              aria-label="Close"
              className="absolute right-3 top-[max(0.75rem,var(--sat))] z-10 grid size-11 place-items-center rounded-full text-ink-2 hover:bg-[var(--surface-2)]"
            >
              <X size={18} />
            </button>
            <LockScreen onUnlocked={() => { setOpen(false); setMode(null) }} />
          </div>,
          document.body,
        )
      )}
    </>
  )
}

type SheetMode = 'menu' | 'backup' | 'passphrase' | 'delete'

function VaultSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sheetRef = useRef<HTMLDivElement>(null)
  useFocusTrap(sheetRef, open)

  const { account, accounts } = useVaultState()
  const [mode, setMode] = useState<SheetMode>('menu')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // A failed write is the one thing in here the operator has to be told about
  // without asking, so it is subscribed rather than read once at render.
  const [writeProblem, setWriteProblem] = useState<string | null>(lastWriteError)
  useEffect(() => subscribeVault(() => setWriteProblem(lastWriteError())), [])

  useEffect(() => {
    if (!open) return
    setMode('menu')
    setCurrent('')
    setNext('')
    setConfirmName('')
    setError(null)
    setNote(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const doBackup = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      download(await exportBackup(current), backupFilename(account?.name ?? null))
      setNote('Backup downloaded. Keep it somewhere the office controls.')
      setCurrent('')
      haptic.success()
    } catch (err) {
      haptic.error()
      setError(messageOf(err, 'Could not build the backup file.'))
    } finally {
      setBusy(false)
    }
  }, [busy, current, account])

  const doChange = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await changePassphrase(current, next)
      setNote('Passphrase changed. Your old backup files still open with the old one.')
      setCurrent('')
      setNext('')
      setMode('menu')
      haptic.success()
    } catch (err) {
      haptic.error()
      setError(messageOf(err, 'Could not change the passphrase.'))
    } finally {
      setBusy(false)
    }
  }, [busy, current, next])

  const doDelete = useCallback(async () => {
    if (busy || account === null) return
    setBusy(true)
    setError(null)
    try {
      await deleteAccount(account.id, current)
      haptic.success()
      onClose()
    } catch (err) {
      haptic.error()
      setError(messageOf(err, 'Could not delete this account.'))
    } finally {
      setBusy(false)
    }
  }, [busy, account, current, onClose])

  // Typing the name is the confirmation step. A second "are you sure" button is
  // tapped through without reading; a name has to be looked at to be copied.
  const deleteArmed = account !== null && confirmName.trim() === account.name.trim()

  /**
   * Portalled to <body> for the same reason the sign-in overlay is: the
   * control that opens this sheet sits in the `.glass` header, whose
   * `backdrop-filter` makes it the containing block for fixed descendants.
   * Without the portal the scrim and the sheet lay out inside the header
   * strip instead of over the page.
   */
  return createPortal(
    <LazyMotion features={domAnimation} strict>
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
              aria-label="Account"
              className="scroller fixed inset-x-0 bottom-0 z-50 max-h-[92svh] overflow-y-auto rounded-t-[var(--radius-2xl)] border-t border-[var(--border)] bg-[var(--surface)]"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              /* Never bounce a sheet. */
              transition={spring.settle}
            >
              <div className="px-4 pb-[calc(var(--sab)+20px)] pt-5">
                <div className="mx-auto flex w-full max-w-md items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-bold">
                      {account ? account.name : 'Account'}
                    </h2>
                    {accounts.length > 1 && (
                      <p className="mt-1 text-sm text-ink-2">
                        {`Your records, encrypted separately from the other ${accounts.length - 1} on this device.`}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="grid size-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-2)]"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="mx-auto mt-5 w-full max-w-md space-y-3">
                  {writeProblem && <Notice tone="neg">{writeProblem}</Notice>}
                  {note && (
                    <p className="rounded-[var(--radius-md)] bg-[var(--pos-soft)] p-3 text-sm text-[var(--pos)]">
                      {note}
                    </p>
                  )}
                  {error && <Notice tone="neg">{error}</Notice>}

                  {mode === 'menu' && (
                    <>
                      <Button variant="outline" className="w-full" onClick={() => setMode('backup')}>
                        <Download size={15} />
                        Download a backup
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => setMode('passphrase')}
                      >
                        <KeyRound size={15} />
                        Change passphrase
                      </Button>
                      <Button
                        className="w-full"
                        onClick={() => {
                          haptic.tap()
                          onClose()
                          void signOut()
                        }}
                      >
                        <LogOut size={15} />
                        Sign out
                      </Button>
                      <p className="pt-1 text-xs leading-relaxed text-ink-3">
                        Your passphrase is needed again to read anything.
                      </p>

                      <div className="border-t border-[var(--border)] pt-3">
                        <button
                          type="button"
                          onClick={() => {
                            setMode('delete')
                            setError(null)
                            setNote(null)
                          }}
                          className="flex min-h-11 w-full items-center justify-center gap-2 text-sm font-medium text-[var(--neg)]"
                        >
                          <Trash2 size={15} />
                          Delete this account
                        </button>
                      </div>
                    </>
                  )}

                  {mode === 'backup' && (
                    <>
                      <p className="text-sm leading-relaxed text-ink-2">
                        The backup file holds this account's records only, encrypted with the
                        passphrase you type here. It does not have to be this account's passphrase.
                      </p>
                      <PassphraseField
                        id="vault-backup-pass"
                        label="Passphrase for the backup file"
                        value={current}
                        onChange={setCurrent}
                        onEnter={() => void doBackup()}
                        autoComplete="new-password"
                        autoFocus
                      />
                      <Button className="w-full" onClick={() => void doBackup()} disabled={busy}>
                        <Busy label={busy ? 'Building' : 'Download backup'} busy={busy} />
                      </Button>
                      <Button variant="ghost" className="w-full" onClick={() => setMode('menu')}>
                        Back
                      </Button>
                    </>
                  )}

                  {mode === 'passphrase' && (
                    <>
                      <Notice tone="warn">
                        Backup files already downloaded keep opening with the passphrase they were
                        made with. Take a fresh one afterwards. The new one cannot be recovered
                        either.
                      </Notice>
                      <PassphraseField
                        id="vault-old-pass"
                        label="Current passphrase"
                        value={current}
                        onChange={setCurrent}
                        autoComplete="current-password"
                        autoFocus
                      />
                      <PassphraseField
                        id="vault-next-pass"
                        label="New passphrase"
                        value={next}
                        onChange={setNext}
                        onEnter={() => void doChange()}
                        autoComplete="new-password"
                        hint={`At least ${VAULT_PARAMS.minPassphrase} characters. Changes only your account.`}
                      />
                      <Button
                        className="w-full"
                        onClick={() => void doChange()}
                        disabled={busy || current.length === 0 || next.length === 0}
                      >
                        <Busy label={busy ? 'Re-encrypting' : 'Change passphrase'} busy={busy} />
                      </Button>
                      <Button variant="ghost" className="w-full" onClick={() => setMode('menu')}>
                        Back
                      </Button>
                    </>
                  )}

                  {mode === 'delete' && account !== null && (
                    <>
                      {/* Said before the fields, in counts rather than in the
                          abstract. "Delete account" reads like closing a
                          subscription; it is not. */}
                      <Notice tone="neg">
                        This permanently deletes {account.name}'s grievance records, issues, actions,
                        influencers and tracked people from this device. They cannot be brought back
                        without a backup file and the passphrase it was made with. Nobody else's
                        records are touched.
                      </Notice>
                      <PassphraseField
                        id="vault-delete-pass"
                        label="This account's passphrase"
                        value={current}
                        onChange={setCurrent}
                        autoComplete="current-password"
                        hint="So a stranger cannot wipe records."
                        autoFocus
                      />
                      <NameField
                        id="vault-delete-name"
                        label={`Type ${account.name} to confirm`}
                        value={confirmName}
                        onChange={setConfirmName}
                      />
                      <Button
                        className="w-full"
                        onClick={() => void doDelete()}
                        disabled={busy || !deleteArmed || current.length === 0}
                      >
                        <Busy
                          label={busy ? 'Deleting' : `Delete ${account.name} and their records`}
                          busy={busy}
                        />
                      </Button>
                      <Button variant="ghost" className="w-full" onClick={() => setMode('menu')}>
                        Keep this account
                      </Button>
                      <p className="text-xs leading-relaxed text-ink-3">
                        If the passphrase for an account is lost, it cannot be deleted from here,
                        and its records are already unreadable to everyone, including us. The entry
                        stays in the list doing nothing.
                      </p>
                    </>
                  )}

                  {mode === 'menu' && (
                    <div className="border-t border-[var(--border)] pt-3">
                      <ThreatModel />
                    </div>
                  )}
                </div>
              </div>
            </m.div>
          </>
        )}
      </AnimatePresence>
    </LazyMotion>,
    document.body,
  )
}
