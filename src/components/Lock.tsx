import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { AnimatePresence, LazyMotion, domAnimation } from 'motion/react'
import * as m from 'motion/react-m'
import {
  ArrowLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Upload,
  User,
  UserPlus,
} from 'lucide-react'
import { Button, Card, SignalGlyph } from '@/components/ui'
import { EntryPitch } from '@/components/EntryPitch'
import { consumeRelock, deskSignIn, lastDeskId } from '@/lib/desk-session'
import { ease, fadeUp, haptic, listStagger, spring } from '@/lib/motion'
import { cn } from '@/lib/utils'
import {
  accountsUnreadable,
  activeAccount,
  createAccount,
  exportBackup,
  hasAccounts,
  hasUnprotectedRecords,
  importBackup,
  isLocked,
  isRestoring,
  restoreSession,
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
 * here checks who anybody is. A correct password is simply one that decrypts
 * a blob. Pretending otherwise would be the single most dishonest screen in the
 * product, so this screen says out loud, before anyone commits to it:
 *
 *   • a forgotten password means the records are gone, with nobody to ask;
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
 * component is `if (locked) return <EntryScreen … />`, which unmounts it the
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
    // to be signed straight back in — a flash of "enter your password" that
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
export function download(blob: Blob, filename: string): void {
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
export function backupFilename(name: string | null): string {
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

export function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/* ── Fields ──────────────────────────────────────────────────────────────── */

export function PassphraseField({
  id,
  label,
  value,
  onChange,
  onEnter,
  autoComplete,
  hint,
  invalid,
  autoFocus,
  inputRef,
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
  /** So the identifier field above can hand focus straight down to this one. */
  inputRef?: RefObject<HTMLInputElement | null>
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
          ref={inputRef}
          /* A revealed password must still not be autocorrected into a
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
          aria-label={shown ? 'Hide password' : 'Show password'}
          className="grid w-12 shrink-0 place-items-center rounded-full text-ink-3 hover:text-ink-2"
        >
          {shown ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {hint && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

/**
 * A single-line text field.
 *
 * Named for its first job and now doing two: the name on an account, and the
 * identifier on the login form. The defaults are the account-name ones, so
 * every existing caller is unchanged; the login form overrides them, because
 * a desk id is not a person's name and must not be title-cased by an Android
 * keyboard or capped at a name's length.
 */
function NameField({
  id,
  label,
  value,
  onChange,
  onEnter,
  hint,
  autoFocus,
  autoComplete = 'off',
  autoCapitalize = 'words',
  spellCheck,
  maxLength = VAULT_PARAMS.maxName,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  onEnter?: () => void
  hint?: string
  autoFocus?: boolean
  autoComplete?: string
  autoCapitalize?: 'off' | 'none' | 'words'
  spellCheck?: boolean
  maxLength?: number
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
        maxLength={maxLength}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCapitalize === 'words' ? 'on' : 'off'}
        spellCheck={spellCheck}
        enterKeyHint="next"
        autoFocus={autoFocus}
        className="mt-1.5 h-12 w-full rounded-full border border-[var(--border-interactive)] bg-[var(--surface-2)] px-4 text-[16px] outline-none transition-colors focus:border-[var(--accent)] placeholder:text-ink-3"
      />
      {hint && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

/**
 * `info` exists so that a statement of fact does not have to borrow the colour
 * of a warning. The adopt-your-existing-records note on the create card is
 * reassurance with a consequence attached, and amber would read as "something
 * is wrong" over a sentence that says the opposite.
 */
export function Notice({ tone, children }: { tone: 'warn' | 'neg' | 'info'; children: ReactNode }) {
  const Icon = tone === 'info' ? Info : TriangleAlert
  return (
    <div
      role={tone === 'neg' ? 'alert' : undefined}
      className={
        'flex gap-2.5 rounded-[var(--radius-md)] p-3 text-sm leading-relaxed ' +
        (tone === 'neg'
          ? 'bg-[var(--neg-soft)] text-[var(--neg)]'
          : tone === 'info'
            ? 'bg-[var(--info-soft)] text-[var(--info)]'
            : 'bg-[var(--warn-soft)] text-[var(--warn)]')
      }
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  )
}

export function Busy({ label, busy }: { label: string; busy: boolean }) {
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
export function ThreatModel() {
  return (
    <p className="text-xs leading-relaxed text-ink-3">
      This keeps your records apart from other people who use this device, so keep the phone
      with you.
    </p>
  )
}

/* ── The entrance ────────────────────────────────────────────────────────── */

/**
 * ONE DOOR, NOT THREE.
 *
 * This screen used to offer three of them, in three vocabularies: "Sign in"
 * over a list of vault accounts, a blue pill labelled "Login" that unfolded
 * into a second form for handed-over desks, and "Try the demo". "Add another
 * person" was how you created an account. Two of those forms could be on the
 * card at once, which was handled by HIDING half the card whenever the second
 * one opened — eight `hidden` toggles, and the reason they were needed is that
 * two sign-in forms stacked read as one broken one.
 *
 * So there is one form now: an identifier and a password, the words every
 * other product on the phone uses. Which kind of account it opens is worked
 * out from what was typed, not asked as a question:
 *
 *   the identifier names an account on this device  →  the vault
 *   anything else                                   →  a desk id, over the wire
 *
 * That dispatch is exact rather than a guess. Account names are unique per
 * device — `nameProblemAgainst` refuses a duplicate precisely so the picker
 * could not offer two identical rows — so at most one local account can match,
 * and the failure message can name which door it tried.
 *
 * WHY THE PITCH IS ON IT. The other half of this screen says what Signal does.
 * A padlock and a password box is the correct screen for somebody who already
 * has an account and the wrong one for everybody else, and everybody else is
 * who "Create new account" is for.
 *
 * WHAT IT STILL REFUSES TO SOFTEN. A vault account is sealed with a key derived
 * from its password and nothing anywhere holds a copy. There is no reset, and
 * the create card and "Forgotten password?" both say so in those words. It also
 * stops the person who picks the phone up and not the person who takes it away.
 * An office that learns either sentence on the day it matters has already lost.
 */

type Step = 'login' | 'create' | 'backup' | 'recover' | 'restore' | 'restored' | 'blocked'

/**
 * The two screens this card owns before it hands over.
 *
 * TWO, not three, even though setup follows. Onboarding runs its own pills —
 * "1 Who this is for / 2 Confirm the details" — so counting it as a third step
 * here put "Step 2 of 3" directly above a screen that then called itself step
 * 1. Two numbering schemes disagreeing in the same flow is worse than no
 * numbering at all. This card counts what this card does; the backup screen
 * names what comes next in words instead.
 */
const PIPELINE = ['Create account', 'Recovery file'] as const

/**
 * Where you are in that pipeline.
 *
 * Create used to drop straight onto a backup screen with no indication that
 * anything followed it, and then onto a setup screen with no indication that
 * anything had preceded it. Unannounced screens in a row is how a sign-up gets
 * abandoned in the middle.
 */
function Stepper({ current }: { current: 1 | 2 }) {
  return (
    <div>
      <div className="flex items-center gap-1.5" aria-hidden>
        {[1, 2].map((n) => (
          <span
            key={n}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              n <= current ? 'bg-[var(--accent)]' : 'bg-[var(--surface-3)]',
            )}
          />
        ))}
      </div>
      <p className="kicker mt-2.5">
        Step {current} of 2 &middot; {PIPELINE[current - 1]}
      </p>
    </div>
  )
}

/**
 * The accounts this device already holds, as chips above the form.
 *
 * The picker step this replaces was a whole screen that a device with one
 * account never even saw — an effect skipped straight past it — so on most
 * devices it was code that never rendered. As chips it is always there, costs
 * one line of the card, and does the one useful thing the picker did: save
 * somebody typing their own name.
 */
function SavedAccounts({
  accounts,
  chosen,
  onPick,
}: {
  accounts: AccountSummary[]
  chosen: string
  onPick: (name: string) => void
}) {
  const same = (a: string, b: string): boolean =>
    a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

  return (
    <div className="mt-5">
      <p className="kicker">Saved on this device</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {accounts.map((a) => {
          const active = same(a.name, chosen)
          return (
            <li key={a.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => {
                  haptic.tap()
                  onPick(a.name)
                }}
                className={cn(
                  'flex min-h-11 max-w-full items-center gap-2 rounded-full border py-1 pl-1.5 pr-3.5 text-sm font-semibold transition-colors',
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border-[var(--border-strong)] bg-[var(--surface)] hover:border-[var(--border-interactive)]',
                )}
              >
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full',
                    active
                      ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                      : 'bg-[var(--accent-soft)] text-[var(--accent)]',
                  )}
                >
                  <User size={14} aria-hidden />
                </span>
                <span className="max-w-[10rem] truncate">{a.name}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Create new account — green and solid, Facebook's own convention for the
 * action that is secondary in traffic and primary in importance.
 *
 * `--accent-fg` rather than white, for the reason DemoDoor documents at
 * length: it is white in light and near-black in dark, which takes this button
 * to 5.7:1 on the light `--pos` and 9.9:1 on the dark one. White alone would
 * be 2.0:1 in dark and illegible.
 */
function CreateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap()
        onClick()
      }}
      className={cn(
        'flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold',
        'bg-[var(--pos)] text-[var(--accent-fg)]',
        'shadow-[0_1px_2px_rgb(16_24_40/0.1),0_8px_20px_-6px_color-mix(in_oklab,var(--pos)_55%,transparent)]',
        'transition-[transform,box-shadow,filter] duration-200 ease-out',
        'hover:-translate-y-0.5 hover:brightness-110',
        'active:translate-y-0 active:brightness-95',
      )}
    >
      <UserPlus size={16} aria-hidden />
      Create new account
    </button>
  )
}

/**
 * The demo, kept short.
 *
 * It was a full-weight violet slab repeated on three steps of this screen,
 * which made the loudest control on a sign-in page an advertisement. The pitch
 * beside the card now carries the "see what this is" job — its specimen opens
 * the same demo — so here it only needs to be findable.
 */
function DemoLink({ onDemo }: { onDemo: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap()
        onDemo()
      }}
      className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold text-[var(--accent-2)] transition-colors hover:bg-[var(--accent-2-soft)]"
    >
      <Eye size={16} aria-hidden />
      Try the demo &mdash; no account needed
    </button>
  )
}

function QuietLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center justify-center gap-2 text-sm font-medium text-ink-2 transition-colors hover:text-ink"
    >
      {children}
    </button>
  )
}

export function EntryScreen({
  onUnlocked,
  onDemo,
  onDeskOpened,
  variant = 'page',
}: {
  onUnlocked: () => void
  /**
   * Open the example desk without an account.
   *
   * Absent on the padlock's panel, where the reader is already inside the demo
   * and the door would lead where they are standing.
   */
  onDemo?: () => void
  /**
   * A handed-over desk opened. Absent when the host has nothing to re-key, in
   * which case a reload does the same job — a desk sign-in has just repointed
   * the whole store and every screen behind this one is reading the wrong
   * namespace until something remounts them.
   */
  onDeskOpened?: () => void
  /**
   * `page` is the app's entrance: the pitch beside the form, full bleed.
   * `panel` is the padlock's overlay from inside the demo, where the pitch is
   * redundant and the card is the whole point.
   */
  variant?: 'page' | 'panel'
}) {
  const { accounts } = useVaultState()

  const [step, setStep] = useState<Step>(() =>
    accountsUnreadable() ? 'blocked' : 'login',
  )

  /**
   * The padlock on a handed-over desk ended that session and left a one-shot
   * note. Consumed here, once, to say so — the prefill below would happen
   * anyway, and a member who pressed a padlock deserves to be told the desk is
   * locked rather than left to wonder why she is at a login screen.
   */
  const [relocked] = useState(consumeRelock)

  /**
   * Prefilled the way every login on the phone prefills: with whoever used
   * this device last. A desk that was just locked wins over a vault account,
   * because that is who is standing there.
   */
  const [identifier, setIdentifier] = useState(() => {
    const desk = lastDeskId()
    if (relocked && desk) return desk
    return listAccounts()[0]?.name ?? desk ?? ''
  })
  const [password, setPassword] = useState('')

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
  const passwordRef = useRef<HTMLInputElement>(null)

  /** Read once: it can only become false, and only because of what happens here. */
  const [unprotected] = useState(hasUnprotectedRecords)

  // A crash or a route change must never leave the app gated on a flag that
  // nothing is left to clear.
  useEffect(() => () => setHolding(false), [])

  const finish = useCallback(() => {
    setPassword('')
    setPassphrase('')
    setConfirm('')
    setName('')
    setHolding(false)
    onUnlocked()
  }, [onUnlocked])

  const goto = (next: Step): void => {
    setStep(next)
    setError(null)
    setPassword('')
    setPassphrase('')
    setConfirm('')
    setName('')
    setFile(null)
  }

  /**
   * One submit, two destinations, decided by what was typed.
   *
   * The local branch is tried only on an exact name match, so this never fires
   * a network request at somebody's vault password, and never sends a desk
   * password through a key derivation that was going to fail anyway.
   */
  const doLogin = useCallback(async () => {
    if (busy) return
    const typed = identifier.trim()

    /**
     * Validated on submit rather than by disabling the button.
     *
     * A greyed-out primary action is the first thing this screen shows every
     * visitor, and an empty form that opens with its main button already dead
     * reads as an app that is broken rather than a form that is empty. Say
     * which field is missing instead — the same trade every login on the
     * phone makes.
     */
    if (typed.length === 0) {
      setError('Enter the name on your account, or the desk ID your office issued you.')
      return
    }
    if (password.length === 0) {
      setError('Enter your password.')
      return
    }

    const local = accounts.find(
      (a) => a.name.trim().toLocaleLowerCase() === typed.toLocaleLowerCase(),
    )

    setBusy(true)
    setError(null)
    try {
      if (local) {
        await signIn(local.id, password)
        haptic.success()
        finish()
      } else {
        await deskSignIn(typed, password)
        haptic.success()
        setPassword('')
        setHolding(false)
        if (onDeskOpened) onDeskOpened()
        else window.location.reload()
      }
    } catch (err) {
      haptic.error()
      const fallback = local
        ? `That password did not open ${local.name}'s account on this device.`
        : 'That did not open anything. Check the ID and the password.'
      setError(messageOf(err, fallback))
    } finally {
      setBusy(false)
    }
  }, [busy, identifier, password, accounts, finish, onDeskOpened])

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
      setError('The two passwords do not match. Retype the second one.')
      return
    }
    if (!written) {
      setError(
        'Write the password down first, then tick the box. There is no way to recover it later.',
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

  /* ── the card ─────────────────────────────────────────────────────────── */

  const card = (
    <>
      {step === 'blocked' && (
        <Card level="lift">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--neg-soft)] text-[var(--neg)]">
              <TriangleAlert size={20} />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-[-0.015em]">The account list is damaged</h1>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                Signal can see that this device has accounts on it but cannot read the list of them,
                so it will not change anything. Writing over it could hide records that are still
                here.
              </p>
            </div>
          </div>

          <div className="mt-5">
            <Notice tone="warn">
              The encrypted records have not been touched. If you have a backup file, restore it on
              another device. Clearing this site&rsquo;s data would remove every account on this
              one, permanently.
            </Notice>
          </div>

          <Button variant="outline" className="mt-5 w-full" onClick={() => goto('restore')}>
            <Upload size={15} />
            Restore from a backup file
          </Button>
        </Card>
      )}

      {step === 'login' && (
        <Card level="lift">
          <h1 className="text-xl font-bold tracking-[-0.015em]">Log in</h1>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">
            An account on this device, or the desk ID your office issued you.
          </p>

          {/* Not decoration: she pressed a padlock and the app took her desk
              away. Saying so is the difference between a lock that worked and
              an app that logged her out. */}
          {relocked && (
            <div className="mt-4 flex gap-2.5 rounded-[var(--radius-md)] bg-[var(--accent-soft)] p-3 text-sm leading-relaxed text-[var(--accent)]">
              <Lock size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span className="min-w-0">
                Locked. Enter the password to open this desk again.
              </span>
            </div>
          )}

          {accounts.length > 0 && (
            <SavedAccounts
              accounts={accounts}
              chosen={identifier}
              onPick={(picked) => {
                setIdentifier(picked)
                setPassword('')
                setError(null)
                passwordRef.current?.focus()
              }}
            />
          )}

          <div className="mt-5 space-y-4">
            <NameField
              id="entry-identifier"
              label="Name or desk ID"
              value={identifier}
              onChange={(v) => {
                setIdentifier(v)
                if (error) setError(null)
              }}
              onEnter={() => passwordRef.current?.focus()}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={80}
              autoFocus={identifier.length === 0}
            />
            <PassphraseField
              id="entry-password"
              label="Password"
              value={password}
              onChange={(v) => {
                setPassword(v)
                if (error) setError(null)
              }}
              onEnter={() => void doLogin()}
              autoComplete="current-password"
              invalid={error !== null}
              inputRef={passwordRef}
              autoFocus={identifier.length > 0}
            />
          </div>

          {error && (
            <div className="mt-3">
              <Notice tone="neg">{error}</Notice>
            </div>
          )}

          <Button className="mt-5 w-full" onClick={() => void doLogin()} disabled={busy}>
            <Busy label={busy ? 'Opening' : 'Log in'} busy={busy} />
          </Button>

          <QuietLink onClick={() => goto('recover')}>Forgotten password?</QuietLink>

          <div className="my-4 flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-[var(--rule)]" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              or
            </span>
            <span className="h-px flex-1 bg-[var(--rule)]" />
          </div>

          <CreateButton onClick={() => goto('create')} />
          {onDemo !== undefined && <DemoLink onDemo={onDemo} />}
        </Card>
      )}

      {step === 'create' && (
        <Card level="lift">
          <Stepper current={1} />

          <div className="mt-5">
            <h1 className="text-xl font-bold tracking-[-0.015em]">Create your account</h1>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              Records stay on this device, encrypted with your password.
            </p>
          </div>

          {/* The one warning that survives the trim. Everything else on this
              screen was explanation a person can look up later; this is the
              only line with a consequence they cannot undo, and it has to be
              read BEFORE the fields, not after the button. */}
          <div className="mt-5">
            <Notice tone="warn">
              There is no reset. A forgotten password cannot be recovered by anyone, and this
              account&rsquo;s records go with it. Write it down.
            </Notice>
          </div>

          {/* A device that has been used signed-out is about to be asked for a
              password by a screen that never asked before. `createAccount`
              adopts what is already here rather than starting empty, and that
              has to be said before the decision, not discovered after it. */}
          {unprotected && (
            <div className="mt-3">
              <Notice tone="info">
                This device already has records saved with no account protecting them. The first
                account created here takes them with it &mdash; nothing is lost.
              </Notice>
            </div>
          )}

          <div className="mt-5 space-y-4">
            <NameField
              id="entry-name"
              label="Your name"
              value={name}
              onChange={(v) => {
                setName(v)
                if (error) setError(null)
              }}
              hint="A first name is enough. This is what you log in with."
              autoFocus
            />
            <PassphraseField
              id="entry-new"
              label="Password"
              value={passphrase}
              onChange={(v) => {
                setPassphrase(v)
                if (error) setError(null)
              }}
              autoComplete="new-password"
              hint={`At least ${VAULT_PARAMS.minPassphrase} characters. Four ordinary words beat one short clever one.`}
            />
            <PassphraseField
              id="entry-confirm"
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
            <span>I have written this password down somewhere safe.</span>
          </label>

          {error && (
            <div className="mt-3">
              <Notice tone="neg">{error}</Notice>
            </div>
          )}

          <Button className="mt-5 w-full" onClick={() => void doCreate()} disabled={busy}>
            <Busy label={busy ? 'Encrypting' : 'Create account'} busy={busy} />
          </Button>

          <QuietLink onClick={() => goto('login')}>
            <ArrowLeft size={15} aria-hidden />
            Already have an account? Log in
          </QuietLink>

          {/* `ThreatModel` says what the encryption is FOR; this says what it
              reaches. Two facts, so two sentences — but they were four, saying
              the first one twice, on the tallest card in the product. */}
          <div className="mt-4 space-y-1.5 border-t border-[var(--border)] pt-3.5">
            <ThreatModel />
            <p className="text-xs leading-relaxed text-ink-3">
              It covers grievances, issues, actions, influencers and the people you track. Saved
              reports and account handles are shared on this device and are not encrypted.
            </p>
          </div>
        </Card>
      )}

      {step === 'backup' && (
        <Card level="lift">
          <Stepper current={2} />

          <div className="mt-5 flex flex-col items-center gap-3 text-center">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--pos-soft)] text-[var(--pos)]">
              <ShieldCheck size={20} />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-[-0.015em]">Encrypted. Save a copy.</h1>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                This file is the only other copy of this account&rsquo;s records, and it opens with
                the same password. Put it somewhere the office controls.
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
            <ChevronRight size={15} />
          </Button>

          {/* What is on the other side of that button. Setup counts its own
              steps, so this names it rather than numbering it. */}
          <p className="mt-3 text-center text-xs text-ink-3">
            Next: telling Signal whose desk this is.
          </p>
        </Card>
      )}

      {step === 'recover' && (
        <Card level="lift">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
              <KeyRound size={20} />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-[-0.015em]">Forgotten password?</h1>
            </div>
          </div>

          {/* Two answers, because there are two kinds of account and only one
              of them has anybody to ask. Neither answer is "we will email you
              a link", and pretending otherwise on this screen would be the
              single most dishonest sentence in the product. */}
          <div className="mt-5 space-y-4 text-sm leading-relaxed text-ink-2">
            <p>
              <span className="font-semibold text-ink">An account on this device.</span> There is no
              reset. The records are encrypted with the password and no copy of it exists anywhere
              &mdash; not on this device, not on a server, not with us. A backup file is the only
              way back, and it opens with the password it was made with.
            </p>
            <p>
              <span className="font-semibold text-ink">An office desk.</span> Ask the office that
              issued the desk ID. They can set a new password on it and hand it to you again.
            </p>
          </div>

          <Button variant="outline" className="mt-5 w-full" onClick={() => goto('restore')}>
            <Upload size={15} />
            Restore from a backup file
          </Button>

          <QuietLink onClick={() => goto('login')}>
            <ArrowLeft size={15} aria-hidden />
            Back to log in
          </QuietLink>
        </Card>
      )}

      {step === 'restore' && (
        <Card level="lift">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
              <Upload size={20} />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-[-0.015em]">Restore from a backup</h1>
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
              id="entry-restore-name"
              label="Name for the restored account"
              value={name}
              onChange={(v) => {
                setName(v)
                if (error) setError(null)
              }}
              hint="Not stored in the file."
            />
            <PassphraseField
              id="entry-restore"
              label="Password for that file"
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

          <QuietLink onClick={() => goto(accountsUnreadable() ? 'blocked' : 'login')}>
            <ArrowLeft size={15} aria-hidden />
            Back
          </QuietLink>

          <p className="mt-3 text-xs leading-relaxed text-ink-3">
            Nothing already on this device is changed or removed.
          </p>
        </Card>
      )}

      {step === 'restored' && restored && (
        <Card level="lift">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--pos-soft)] text-[var(--pos)]">
              <ShieldCheck size={20} />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-[-0.015em]">Restored</h1>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                This account now holds what was in the file, encrypted with the password you just
                used.
              </p>
            </div>
          </div>

          {/* Counts, not a tick. A backup that silently restored nothing looks
              exactly like one that worked. */}
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
            <ChevronRight size={15} />
          </Button>
        </Card>
      )}
    </>
  )

  /* ── the screen ───────────────────────────────────────────────────────── */

  return (
    /* Its own LazyMotion: the shell may gate this screen above the app's
       provider, and `m.*` throws without one in scope. Nesting is free. */
    <LazyMotion features={domAnimation} strict>
      {/* The ambient field the stylesheet has always defined and nothing ever
          mounted. It is `position: fixed`, costs one rasterisation, and turns
          itself off on low-end devices and under reduced motion. */}
      {variant === 'page' && (
        <div className="field" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      )}

      <div
        className={cn(
          'relative z-[1] min-h-screen-safe',
          variant === 'page' && 'lg:grid lg:place-items-center',
        )}
      >
        <m.div
          variants={listStagger}
          initial="hidden"
          animate="show"
          className={cn(
            'mx-auto w-full px-4 py-10 safe-b',
            variant === 'page'
              ? 'max-w-6xl lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,25rem)] lg:items-center lg:gap-x-14 lg:px-8 lg:py-10'
              : 'max-w-md',
          )}
        >
          {/* The phone's masthead. The pitch beside the card carries its own
              wordmark from lg up and hides it below that, because on a 375px
              screen the form has to be the first thing and two wordmarks would
              push it further down than the pitch already does. */}
          {variant === 'page' && (
            <m.div variants={fadeUp} className="mb-7 lg:hidden">
              <div className="flex items-center gap-2.5">
                <span
                  className="grid size-9 place-items-center rounded-xl text-[var(--accent-fg)] shadow-[var(--e2)]"
                  style={{
                    background:
                      'linear-gradient(140deg, var(--accent) 0%, color-mix(in oklab, var(--accent) 74%, var(--aurora-2)) 100%)',
                  }}
                >
                  <SignalGlyph size={17} />
                </span>
                <span className="hed text-lg leading-none">Signal</span>
              </div>
              <p className="mt-3 max-w-[38ch] text-sm leading-relaxed text-ink-2">
                Read any public post &mdash; the verdict, the grievance, and what to say back.
              </p>
            </m.div>
          )}

          {/* Card before pitch in the document, reordered only from lg up.
              On a phone this container is not a grid, so `order` does nothing
              and the DOM sequence is what ships: the control that does the
              work first, the standing text under it. */}
          <m.div variants={fadeUp} className="min-w-0 lg:order-2">
            {card}
          </m.div>

          {variant === 'page' && (
            <div className="mt-12 min-w-0 lg:order-1 lg:mt-0">
              <EntryPitch onDemo={onDemo} />
            </div>
          )}
        </m.div>
      </div>
    </LazyMotion>
  )
}

/* ── Where the padlock went ──────────────────────────────────────────────────
 *
 * `LockButton` and `VaultSheet` lived here: a padlock in the header that
 * opened a sheet holding backup, change-password, sign-out and delete.
 *
 * The icon was the problem. It meant three different things depending on what
 * was signed in — an account menu, a whole sign-in screen, or ending a desk
 * session — and "lock" described none of them. Nobody could tell which they
 * were about to get, and account management is not something people look for
 * in a header icon anyway.
 *
 * Its four jobs went where each one belongs:
 *
 *   who you are        the header now shows the desk's face and name, and
 *                      goes to Settings
 *   sign out           the navigation foot, beside the only other control
 *                      that changes which desk you are on (App's `navDemo`)
 *   password, backup,
 *   delete account     Settings -> Your account (components/settings/Account)
 *   forgotten password the login card, which is the only screen where a
 *                      person who cannot get in is standing
 *
 * This file is now the entrance and nothing else.
 * ------------------------------------------------------------------------- */
