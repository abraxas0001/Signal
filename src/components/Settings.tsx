import { useCallback, useEffect, useState } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import { AtSign, Briefcase, CircleCheck, Key, RefreshCw, Search, Share2, Video } from 'lucide-react'
import { Avatar, Button, Card, Chip, PageHeader } from './ui'
import { fadeUp, listStagger } from '@/lib/motion'
import { getSettingsKey, setSettingsKey } from '@/lib/settings-key'
import { IdentityRows } from './IdentityEditor'
import { Grievances } from './Grievances'
import { editField, saveIdentity } from '@/lib/identity'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * Connect the office's own accounts.
 *
 * This is admin surface, not a work screen — everyone else here reads what a
 * platform published; this one lets the office authorise Signal to read more
 * than that, for accounts it owns. Gated by a key only the office holds
 * (`SETTINGS_ACCESS_KEY` server-side, see `lib/admin-gate.ts`), because
 * anyone who could reach this could trigger a real OAuth grant against the
 * office's real accounts.
 *
 * Facebook/Instagram are shown read-only: that connection is still a token
 * pasted into an environment variable by whoever administers the deployment,
 * not something clicked from here — see meta-graph.ts.
 */

interface ConnectionStatus {
  platform: 'YouTube' | 'LinkedIn' | 'Twitter/X'
  ownerName: string | null
  ownerId: string
  connectedAt: string
  expiresAt: string | null
  lastError: string | null
  lastErrorAt: string | null
}

interface MetaStatus {
  configured: boolean
  page: string | null
  instagramLinked: boolean
  working: boolean
  why: string | null
}

interface StatusResponse {
  connections: ConnectionStatus[]
  meta: MetaStatus
}

const PLATFORMS: { platform: ConnectionStatus['platform']; slug: string; label: string; Icon: typeof Video }[] = [
  { platform: 'YouTube', slug: 'youtube', label: 'YouTube', Icon: Video },
  { platform: 'LinkedIn', slug: 'linkedin', label: 'LinkedIn', Icon: Briefcase },
  { platform: 'Twitter/X', slug: 'x', label: 'X / Twitter', Icon: AtSign },
]

async function fetchStatus(key: string): Promise<StatusResponse | 'unauthorised'> {
  const res = await fetch('/api/connections', { headers: { 'X-Settings-Key': key } })
  if (res.status === 403) return 'unauthorised'
  if (!res.ok) throw new Error(`The server answered HTTP ${res.status}.`)
  return (await res.json()) as StatusResponse
}

export function Settings({
  onClose,
  onChangePerson,
}: {
  onClose: () => void
  /**
   * Reopens the setup search.
   *
   * Editing a field and changing who the desk is for are different actions and
   * are kept apart: one is a correction, the other throws away the watch terms,
   * the news scan and every reading keyed to them.
   */
  onChangePerson: () => void
}) {
  const store = useStore()
  const identity = store.identity
  const reduced = useReducedMotion()
  const [key, setKey] = useState(() => getSettingsKey() ?? '')
  const [keyInput, setKeyInput] = useState('')
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /**
   * The key was refused, as against anything else going wrong.
   *
   * Held apart from `error` because it needs a different screen: a rejected key
   * must put the key field back, and a saved-but-wrong key previously could not
   * be changed at all — the field was gated behind `!key`, so once a wrong
   * value was stored the screen showed a red message and no way to fix it.
   */
  const [refused, setRefused] = useState(false)

  const load = useCallback((k: string) => {
    setLoading(true)
    setError(null)
    setRefused(false)
    fetchStatus(k)
      .then((res) => {
        if (res === 'unauthorised') {
          setRefused(true)
          setStatus(null)
          return
        }
        setStatus(res)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load connection status.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (key) load(key)
  }, [key, load])

  // The OAuth callback lands back here with a one-shot query flag — same
  // pattern App.tsx already uses for ?demo=1 and ?sample=1.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('connected')
    const failed = params.get('connect_error')
    if (connected) {
      setNotice(`Connected. Reading real data for this account now.`)
      if (key) load(key)
    }
    if (failed) setError(`Could not connect ${failed}. The attempt may have expired. Try again.`)
    if (params.has('settings')) window.history.replaceState({}, '', window.location.pathname)
    // Runs once, on mount, to consume the redirect's query string exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveKey = () => {
    const trimmed = keyInput.trim()
    if (!trimmed) return
    setSettingsKey(trimmed)
    setKey(trimmed)
    setKeyInput('')
  }

  /** Drop a stored key so the field comes back. */
  const forgetKey = () => {
    setSettingsKey('')
    setKey('')
    setStatus(null)
    setRefused(false)
    setError(null)
  }

  const connect = (slug: string) => {
    window.location.href = `/api/oauth/${slug}/start?key=${encodeURIComponent(key)}`
  }

  const disconnect = async (platform: ConnectionStatus['platform']) => {
    setLoading(true)
    try {
      await fetch(`/api/connections?platform=${encodeURIComponent(platform)}`, {
        method: 'DELETE',
        headers: { 'X-Settings-Key': key },
      })
      load(key)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect.')
      setLoading(false)
    }
  }

  const byPlatform = new Map((status?.connections ?? []).map((c) => [c.platform, c] as const))

  return (
    <m.div
      className="shell shell-wide stack page-end"
      variants={listStagger}
      initial={reduced ? false : 'hidden'}
      animate="show"
    >
      <m.div variants={fadeUp}>
        <PageHeader
          title="Settings"
          subtitle="Connect the office&rsquo;s own accounts for real comments and exact counts."
          actions={
            <Button variant="ghost" onClick={onClose}>
              Back
            </Button>
          }
        />
      </m.div>

      {/* ── Who this desk is for ──────────────────────────────────────────
          Above the connected-accounts block deliberately. This is the setting
          people actually come here to change, it needs no key and no OAuth
          application, and burying it under an admin gate is what made the
          screen look like it had nothing on it. */}
      <m.section variants={fadeUp} aria-labelledby="identity-heading">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 id="identity-heading" className="text-lg font-semibold tracking-[-0.011em]">
              Who this desk is for
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
              Tap any value to correct it. What you type is treated as certain; what we read
              is not.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onChangePerson}>
            <Search size={15} aria-hidden />
            Change person
          </Button>
        </div>

        {identity ? (
          <>
            <Card className="mb-3">
              <div className="flex items-start gap-4">
                <Avatar src={identity.photoUrl} name={identity.name} size={60} />
                <div className="min-w-0 flex-1">
                  <p className="hed text-[1.4rem] leading-tight">{identity.name}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
                    {[identity.role, identity.constituency, identity.party]
                      .filter(Boolean)
                      .join(' · ') || 'No office or seat recorded yet.'}
                  </p>
                  {identity.sources.length > 0 && (
                    <p className="mt-2 text-xs text-ink-3">
                      Read from {identity.sources.map((src) => src.label).join(', ')}.
                    </p>
                  )}
                </div>
              </div>
            </Card>

            <Card padded={false}>
              <IdentityRows
                identity={identity}
                onEdit={(field, next) => saveIdentity(editField(identity, field, next))}
              />
            </Card>

            {/* The words the news scan actually searches on. Shown because a
                scan that finds nothing is otherwise indistinguishable from a
                quiet week, and the usual cause is a wrong seat here. */}
            {identity.watchTerms.length > 0 && (
              <div className="mt-3">
                <p className="kicker">The news scan searches for</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {identity.watchTerms.map((term) => (
                    <li key={term}>
                      <Chip>{term}</Chip>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs leading-relaxed text-ink-3">
                  Rebuilt from the name, seat and party above whenever you change one.
                </p>
              </div>
            )}
          </>
        ) : (
          <Card>
            <p className="text-sm leading-relaxed text-ink-2">
              This desk has not been told whose it is, so the news scan has nothing to
              search for and the dashboard cannot say what is being said about you.
            </p>
            <Button size="sm" className="mt-3" onClick={onChangePerson}>
              <Search size={15} aria-hidden />
              Set that up
            </Button>
          </Card>
        )}
      </m.section>

      {/* ── The desk itself ───────────────────────────────────────────────
          Which mastheads get read, which words count, and everything already
          filed. This lived behind a tab on the Grievances screen, which meant
          the person who wanted this week's issues landed on a portal picker,
          and the person configuring the desk had to know that "Grievances" was
          where the settings were. Configuration belongs in settings. */}
      <m.section variants={fadeUp} aria-labelledby="desk-heading">
        <div className="mb-3">
          <h2 id="desk-heading" className="text-lg font-semibold tracking-[-0.011em]">
            The news desk
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
            Which papers get read every morning, the words they are searched for, and
            everything filed so far.
          </p>
        </div>
        <Grievances mode="records" onClose={onClose} />
      </m.section>

      {(!key || refused) && (
        <m.div variants={fadeUp}>
          <Card
            className={
              refused ? 'border-[color-mix(in_oklab,var(--neg)_30%,transparent)]' : undefined
            }
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Key size={16} className={refused ? 'text-[var(--neg)]' : 'text-ink-3'} aria-hidden />
              {refused ? 'That key was not accepted' : 'Connecting accounts needs a key'}
            </div>

            {/* What the key actually is, in a sentence, because "admin key
                required" told an office nothing about whose key, what for, or
                whether they were supposed to have one. */}
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
              {refused
                ? 'It is not your account password. It is a shared value set on the server when this deployment was created.'
                : 'Everything else on this screen works without one.'}{' '}
              Connecting a real YouTube, LinkedIn or X account grants this deployment
              long-lived access to that account, so it is held behind a value only whoever
              set the server up can hand out:{' '}
              <code className="rounded bg-[var(--surface-2)] px-1 py-0.5 text-[13px]">
                SETTINGS_ACCESS_KEY
              </code>
              . It stays on this device and is never sent anywhere else.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                type="password"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder="Admin key"
                aria-label="Admin key"
                className="min-h-11 min-w-0 flex-1 rounded-[--radius-sm] border border-[var(--border-interactive)] bg-[var(--surface-2)] px-3 text-sm outline-none focus:border-[var(--accent)]"
              />
              <Button size="sm" onClick={saveKey} disabled={!keyInput.trim()}>
                Continue
              </Button>
            </div>

            {key && (
              <button
                onClick={forgetKey}
                className="mt-3 text-xs font-medium text-ink-3 underline decoration-[var(--rule)] underline-offset-4 hover:text-ink-2"
              >
                Forget the stored key
              </button>
            )}
          </Card>
        </m.div>
      )}

      {notice && (
        <m.div variants={fadeUp}>
          <Card className="border-[color-mix(in_oklab,var(--pos)_30%,transparent)] bg-[var(--pos-soft)]">
            <p className="text-sm font-medium text-[var(--pos)]">{notice}</p>
          </Card>
        </m.div>
      )}
      {error && (
        <m.div variants={fadeUp}>
          <Card className="border-[color-mix(in_oklab,var(--neg)_30%,transparent)] bg-[var(--neg-soft)]">
            <p className="text-sm font-medium text-[var(--neg)]">{error}</p>
          </Card>
        </m.div>
      )}

      {/* The platform cards need `status`, not merely a key.
          They rendered on `key` alone, so a saved-but-refused key still drew
          four live Connect buttons — every one of which starts an OAuth
          redirect the server will reject at the door. A control that cannot
          work must not look like one that can. */}
      {status && (
        <m.div variants={fadeUp} className="space-y-3">
          {PLATFORMS.map(({ platform, slug, label, Icon }) => {
            const conn = byPlatform.get(platform)
            return (
              <Card key={platform} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Icon size={20} className="shrink-0 text-ink-3" aria-hidden />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{label}</span>
                      {conn ? (
                        <Chip tone={conn.lastError ? 'warning' : 'positive'} icon={<CircleCheck size={11} />}>
                          Connected
                        </Chip>
                      ) : (
                        <Chip tone="neutral">Not connected</Chip>
                      )}
                    </div>
                    <p className="truncate text-xs text-ink-3">
                      {conn?.lastError
                        ? `Reconnect. The last refresh failed: ${conn.lastError}`
                        : conn
                          ? (conn.ownerName ?? conn.ownerId)
                          : 'No account connected yet.'}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={conn ? 'outline' : 'primary'}
                  disabled={loading}
                  onClick={() => (conn ? disconnect(platform) : connect(slug))}
                >
                  {conn ? 'Disconnect' : 'Connect'}
                </Button>
              </Card>
            )
          })}

          <Card className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex shrink-0 text-ink-3">
                <Share2 size={20} aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">Facebook / Instagram</span>
                  {status?.meta.configured ? (
                    <Chip tone={status.meta.working ? 'positive' : 'warning'} icon={<CircleCheck size={11} />}>
                      {status.meta.working ? 'Connected' : 'Configured'}
                    </Chip>
                  ) : (
                    <Chip tone="neutral">Not connected</Chip>
                  )}
                </div>
                <p className="truncate text-xs text-ink-3">
                  {status?.meta.working
                    ? `${status.meta.page ?? 'Page connected'}${status.meta.instagramLinked ? ' · Instagram linked' : ''}`
                    : status?.meta.why
                      ? status.meta.why
                      : 'Set META_PAGE_TOKEN on the server to connect. See README.'}
                </p>
              </div>
            </div>
          </Card>

          <div className={cn('flex justify-end', loading ? 'opacity-100' : 'opacity-0')}>
            <RefreshCw size={14} className="animate-spin text-ink-3" aria-hidden />
          </div>
        </m.div>
      )}
    </m.div>
  )
}
