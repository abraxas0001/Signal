import { useCallback, useState } from 'react'
import { Download, KeyRound, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react'
import {
  Busy,
  Notice,
  PassphraseField,
  ThreatModel,
  backupFilename,
  download,
  messageOf,
} from '@/components/Lock'
import { Button, Card } from '@/components/ui'
import {
  VAULT_PARAMS,
  activeAccount,
  changePassphrase,
  deleteAccount,
  exportBackup,
} from '@/lib/vault'
import { haptic } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * Your account, in Settings, where an account belongs.
 *
 * These four things — see who is signed in, take a backup, change the
 * password, delete the account — used to live behind a padlock icon in the
 * header that opened a sheet. Two problems with that, and the second is the
 * one that mattered:
 *
 * A padlock is not a word. It reads as "lock the app" and it did not lock the
 * app; it opened a menu, and on a device with no account it opened a whole
 * sign-in screen over the top instead. One icon, three meanings, none of them
 * written down.
 *
 * And account management is not a header control. Every product a person
 * already knows puts it in Settings — that is where somebody goes when they
 * think "I want to change my password", and a header icon is where nobody
 * looks. Signing out moved to the navigation foot, beside the other door that
 * changes which desk you are on, and the rest is here.
 *
 * WHAT IS DELIBERATELY NOT HERE. Forgotten-password recovery. There is nothing
 * to recover from inside a signed-in session — the records are open, so the
 * password is known. The honest place for "I cannot get in" is the screen
 * where you cannot get in, and it is on the login card.
 */

type Panel = 'password' | 'backup' | 'delete' | null

export function AccountSection() {
  const account = activeAccount()

  const [panel, setPanel] = useState<Panel>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  /** One panel open at a time, and every field cleared on the way. */
  const open = (which: Panel): void => {
    setPanel((was) => (was === which ? null : which))
    setCurrent('')
    setNext('')
    setConfirmName('')
    setError(null)
    setNote(null)
  }

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
      setNote('Password changed. Your old backup files still open with the old one.')
      setCurrent('')
      setNext('')
      setPanel(null)
      haptic.success()
    } catch (err) {
      haptic.error()
      setError(messageOf(err, 'Could not change the password.'))
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
      // No navigation. Deleting the open account signs it out, and the shell
      // watches the vault — the entrance takes the screen back on its own.
    } catch (err) {
      haptic.error()
      setError(messageOf(err, 'Could not delete this account.'))
    } finally {
      setBusy(false)
    }
  }, [busy, account, current])

  /**
   * Typing the name is the confirmation. A second "are you sure" button gets
   * tapped through without being read; a name has to be looked at to be
   * copied.
   */
  const deleteArmed = account !== null && confirmName.trim() === account.name.trim()

  // A handed-over desk has no vault account to manage: its password lives with
  // the office that issued it, and nothing on this card would work.
  if (account === null) return null

  const row =
    'flex w-full min-h-14 items-center gap-3 px-4 text-left transition-colors hover:bg-[var(--surface-2)]'

  return (
    <Card padded={false}>
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
          <ShieldCheck size={18} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{account.name}</p>
          <p className="truncate text-xs text-ink-3">Signed in on this device</p>
        </div>
      </div>

      {note && (
        <p className="mx-4 mt-3 rounded-[var(--radius-md)] bg-[var(--pos-soft)] p-3 text-sm leading-relaxed text-[var(--pos)]">
          {note}
        </p>
      )}

      <ul className="divide-y divide-[var(--border)]">
        {/* ── change password ─────────────────────────────────────────── */}
        <li>
          <button type="button" onClick={() => open('password')} className={row} aria-expanded={panel === 'password'}>
            <KeyRound size={17} className="shrink-0 text-ink-3" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Change password</span>
              <span className="block text-xs text-ink-3">Re-encrypts this account&rsquo;s records</span>
            </span>
          </button>
          {panel === 'password' && (
            <div className="border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
              <p className="text-sm leading-relaxed text-ink-2">
                Backup files you have already downloaded keep opening with the password they were
                made with. Take a fresh one afterwards.
              </p>
              <div className="mt-4 space-y-4">
                <PassphraseField
                  id="acct-current"
                  label="Current password"
                  value={current}
                  onChange={(v) => {
                    setCurrent(v)
                    if (error) setError(null)
                  }}
                  autoComplete="current-password"
                  invalid={error !== null}
                />
                <PassphraseField
                  id="acct-next"
                  label="New password"
                  value={next}
                  onChange={(v) => {
                    setNext(v)
                    if (error) setError(null)
                  }}
                  onEnter={() => void doChange()}
                  autoComplete="new-password"
                  hint={`At least ${VAULT_PARAMS.minPassphrase} characters. Changes only this account.`}
                />
              </div>
              {error && (
                <div className="mt-3">
                  <Notice tone="neg">{error}</Notice>
                </div>
              )}
              <Button
                className="mt-4 w-full"
                onClick={() => void doChange()}
                disabled={busy || current.length === 0 || next.length === 0}
              >
                <Busy label={busy ? 'Re-encrypting' : 'Change password'} busy={busy} />
              </Button>
            </div>
          )}
        </li>

        {/* ── backup ──────────────────────────────────────────────────── */}
        <li>
          <button type="button" onClick={() => open('backup')} className={row} aria-expanded={panel === 'backup'}>
            <Download size={17} className="shrink-0 text-ink-3" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Download a backup</span>
              <span className="block text-xs text-ink-3">The only other copy of these records</span>
            </span>
          </button>
          {panel === 'backup' && (
            <div className="border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
              <p className="text-sm leading-relaxed text-ink-2">
                The file is encrypted with the password you type here. It does not have to be this
                account&rsquo;s password.
              </p>
              <div className="mt-4">
                <PassphraseField
                  id="acct-backup"
                  label="Password for the backup file"
                  value={current}
                  onChange={(v) => {
                    setCurrent(v)
                    if (error) setError(null)
                  }}
                  onEnter={() => void doBackup()}
                  autoComplete="new-password"
                  invalid={error !== null}
                />
              </div>
              {error && (
                <div className="mt-3">
                  <Notice tone="neg">{error}</Notice>
                </div>
              )}
              <Button
                className="mt-4 w-full"
                onClick={() => void doBackup()}
                disabled={busy || current.length === 0}
              >
                {busy ? <RefreshCw size={15} className="animate-spin" /> : <Download size={15} />}
                Download backup
              </Button>
            </div>
          )}
        </li>

        {/* ── delete ──────────────────────────────────────────────────── */}
        <li>
          <button
            type="button"
            onClick={() => open('delete')}
            className={cn(row, 'text-[var(--neg)]')}
            aria-expanded={panel === 'delete'}
          >
            <Trash2 size={17} className="shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Delete this account</span>
              <span className="block text-xs text-ink-3">Removes its records from this device</span>
            </span>
          </button>
          {panel === 'delete' && (
            <div className="border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-4">
              <Notice tone="warn">
                This removes this account&rsquo;s records from this device and cannot be undone.
                Nobody else&rsquo;s accounts are touched. A backup file and the password it was made
                with is the only way back.
              </Notice>
              <div className="mt-4 space-y-4">
                <PassphraseField
                  id="acct-delete"
                  label="This account&rsquo;s password"
                  value={current}
                  onChange={(v) => {
                    setCurrent(v)
                    if (error) setError(null)
                  }}
                  autoComplete="current-password"
                  invalid={error !== null}
                />
                <div>
                  <label
                    htmlFor="acct-confirm"
                    className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3"
                  >
                    Type {account.name} to confirm
                  </label>
                  <input
                    id="acct-confirm"
                    type="text"
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    autoComplete="off"
                    className="mt-1.5 h-12 w-full rounded-full border border-[var(--border-interactive)] bg-[var(--surface)] px-4 text-[16px] outline-none transition-colors focus:border-[var(--neg)]"
                  />
                </div>
              </div>
              {error && (
                <div className="mt-3">
                  <Notice tone="neg">{error}</Notice>
                </div>
              )}
              <Button
                variant="danger"
                className="mt-4 w-full"
                onClick={() => void doDelete()}
                disabled={busy || !deleteArmed || current.length === 0}
              >
                <TriangleAlert size={15} />
                <Busy label={busy ? 'Deleting' : 'Delete this account'} busy={busy} />
              </Button>
            </div>
          )}
        </li>
      </ul>

      <div className="border-t border-[var(--border)] px-4 py-3.5">
        <ThreatModel />
      </div>
    </Card>
  )
}
