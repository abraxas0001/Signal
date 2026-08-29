import { useCallback, useEffect, useState } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import { ChevronRight, CircleCheck, Key, RefreshCw, Search } from 'lucide-react'
import { Avatar, Button, Card, Chip, PageHeader } from './ui'
import { CardHead, PlatformBadge } from '@/components/kit'
import { NAV, badgeOf, type Tab } from '@/lib/nav'
import { fadeUp, listStagger } from '@/lib/motion'
import { getSettingsKey, setSettingsKey } from '@/lib/settings-key'
import { IdentityRows } from './IdentityEditor'
import { Grievances } from './Grievances'
import { GrievanceDeskSection, InfluencerSection } from '@/components/settings/DeskConfig'
import { editField, saveIdentity } from '@/lib/identity'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { fetchWithTimeout } from '@/lib/net'
import { currentNavState } from '@/lib/nav-history'

/**
 * The desk's back room: its tools, its configuration, who it is for, and the
 * office's accounts.
 *
 * The tools list comes first because it is why most visits happen now. The
 * product owner asked for everything that is not a daily read — Accounts,
 * Tasks, History, People — to live off the main navigation and behind
 * Settings, so this screen is the one unconditional route to those four.
 * Influencers was on that list for one release and then went back to the bar
 * at the owner's request. The rows only navigate; each screen stays its own
 * component and is rendered by App exactly as it was when it had a nav slot.
 *
 * Under the tools sit the two configuration sections — the grievance desk's
 * papers and words, the influencer roster — closed by default, per the owner:
 * nothing shows at first glance, and the pencil on each working screen lands
 * here with the right one open.
 *
 * Below that, the original admin surface: connecting accounts is gated by a
 * key only the office holds (`SETTINGS_ACCESS_KEY` server-side, see
 * `lib/admin-gate.ts`), because anyone who could reach it could trigger a
 * real OAuth grant against the office's real accounts.
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

const PLATFORMS: { platform: ConnectionStatus['platform']; slug: string; label: string }[] = [
  { platform: 'YouTube', slug: 'youtube', label: 'YouTube' },
  { platform: 'LinkedIn', slug: 'linkedin', label: 'LinkedIn' },
  { platform: 'Twitter/X', slug: 'x', label: 'X / Twitter' },
]

/**
 * The four screens the product owner moved off the main navigation. Order is
 * rough frequency of use, not alphabet. The blurbs exist because a bare label
 * like "Accounts" no longer has a nav group heading to lean on for meaning.
 * Influencers left this list when it took its bar slot back — a row here as
 * well would be a second door beside an open one.
 */
const TOOLS: { id: Tab; blurb: string }[] = [
  { id: 'accounts', blurb: 'Every handle the desk follows and how its posts are doing.' },
  { id: 'actions', blurb: 'Work the desk has raised and what is still open.' },
  { id: 'history', blurb: 'Every report this device has run, ready to reopen.' },
  { id: 'personas', blurb: 'What the papers are saying about named people.' },
]

async function fetchStatus(key: string): Promise<StatusResponse | 'unauthorised'> {
  const res = await fetchWithTimeout('/api/connections', { headers: { 'X-Settings-Key': key } })
  if (res.status === 403) return 'unauthorised'
  if (!res.ok) throw new Error(`The server answered HTTP ${res.status}.`)
  return (await res.json()) as StatusResponse
}

export function Settings({
  onClose,
  onChangePerson,
  onOpenTool,
  toolCounts,
  focusSection,
}: {
  onClose: () => void
  /**
   * Which configuration section arrives open and scrolled into view. Set by
   * the pencil buttons on the grievance and influencer screens; absent on a
   * plain visit, when both sections start closed.
   */
  focusSection?: 'grievances' | 'influencers'
  /**
   * Reopens the setup search.
   *
   * Editing a field and changing who the desk is for are different actions and
   * are kept apart: one is a correction, the other throws away the watch terms,
   * the news scan and every reading keyed to them.
   */
  onChangePerson: () => void
  /**
   * Opens one of the tool screens. App owns the special cases — History is a
   * panel, not a tab — so this component only says which tool was asked for.
   */
  onOpenTool: (t: Tab) => void
  /**
   * Waiting counts for the tool rows: unacknowledged mentions, open tasks,
   * saved reports. Absent or zero shows no badge, because a number that is
   * always there is a number the eye learns to skip.
   */
  toolCounts?: Partial<Record<Tab, number>>
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
    if (params.has('settings')) window.history.replaceState(currentNavState(), '', window.location.pathname)
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
          subtitle="Your desk&rsquo;s tools, who it is for, and the office&rsquo;s own accounts."
          actions={
            <Button variant="ghost" onClick={onClose}>
              Back
            </Button>
          }
        />
      </m.div>

      {/* ── Your desk's tools ─────────────────────────────────────────────
          First, because it is why most visits happen: these five screens left
          the main navigation when the owner asked for everything that is not
          a daily read to live under Settings, and this list is now their one
          unconditional route. It has to sit above the admin surface below or
          the person looking for Tasks reads a key prompt and concludes the
          screen is not for them. */}
      <m.section variants={fadeUp} aria-labelledby="tools-heading">
        <div className="mb-3">
          <h2 id="tools-heading" className="text-lg font-semibold tracking-[-0.011em]">
            Your desk&rsquo;s tools
          </h2>
        </div>
        <Card padded={false}>
          <ul className="divide-y divide-[var(--border)]">
            {TOOLS.map(({ id, blurb }) => {
              const { label, Icon } = NAV[id]
              const badge = badgeOf(toolCounts?.[id])
              return (
                <li key={id}>
                  <button
                    onClick={() => onOpenTool(id)}
                    // The badge is a bare number, folded into the name for
                    // readers the same way the nav rows do it. No unit: the
                    // caller decided what it counts.
                    aria-label={badge ? `${label}, ${badge}` : undefined}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"
                  >
                    <span
                      className="icon-badge icon-badge-sm shrink-0"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      <Icon size={16} strokeWidth={2} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {label}
                      </span>
                      <span className="block truncate text-xs text-ink-3">{blurb}</span>
                    </span>
                    {badge && (
                      <span
                        aria-hidden
                        className="tnum grid min-w-5 shrink-0 place-items-center rounded-full bg-[var(--accent)] px-1.5 text-2xs font-bold leading-5 text-[var(--accent-fg)]"
                      >
                        {badge}
                      </span>
                    )}
                    <ChevronRight size={15} className="shrink-0 text-ink-3" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      </m.section>

      {/* ── The desk's configuration ──────────────────────────────────────
          Closed boxes, name and count only, per the owner. Each pencil on a
          working screen lands here with its own section already open; a plain
          visit finds both shut. The bodies mount only when opened, so the
          store work behind them costs nothing until then. */}
      <m.section variants={fadeUp} aria-label="Desk configuration" className="space-y-3">
        <GrievanceDeskSection focus={focusSection === 'grievances'} />
        <InfluencerSection focus={focusSection === 'influencers'} />
      </m.section>

      {/* ── Who this desk is for ──────────────────────────────────────────
          Above the connected-accounts block deliberately. This is the setting
          people actually come here to change, it needs no key and no OAuth
          application, and burying it under an admin gate is what made the
          screen look like it had nothing on it. */}
      <m.section variants={fadeUp} aria-labelledby="identity-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 id="identity-heading" className="text-lg font-semibold tracking-[-0.011em]">
              Who this desk is for
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
              Tap any value to correct it.
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
              <div className="flex items-start gap-4 sm:items-center">
                {/* The gradient ring the reference profile cards wear — a
                    surface gap between ring and photograph so it reads as a
                    ring, not a border. */}
                <span
                  className="grid shrink-0 place-items-center rounded-full p-[3px]"
                  style={{ background: 'var(--accent)' }}
                >
                  <span className="grid place-items-center rounded-full bg-[var(--surface)] p-[3px]">
                    <Avatar src={identity.photoUrl} name={identity.name} size={72} />
                  </span>
                </span>
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

              {/* The words the news scan actually searches on. Shown because a
                  scan that finds nothing is otherwise indistinguishable from a
                  quiet week, and the usual cause is a wrong seat here. */}
              {identity.watchTerms.length > 0 && (
                <div className="mt-4 border-t border-[var(--border)] pt-4">
                  <p className="kicker">The news scan searches for</p>
                  <ul className="mt-2.5 flex flex-wrap gap-1.5">
                    {identity.watchTerms.map((term) => (
                      <li key={term}>
                        <Chip tone="accent">{term}</Chip>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            <Card padded={false}>
              <IdentityRows
                identity={identity}
                onEdit={(field, next) => saveIdentity(editField(identity, field, next))}
              />
            </Card>
          </>
        ) : (
          <Card>
            <p className="text-sm leading-relaxed text-ink-2">No person set yet.</p>
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
        <Grievances mode="records" embedded onClose={onClose} />
      </m.section>

      {/* ── The office's own accounts ─────────────────────────────────── */}
      <m.section variants={fadeUp} aria-labelledby="connections-heading">
        <div className="mb-3">
          <h2 id="connections-heading" className="text-lg font-semibold tracking-[-0.011em]">
            Connected accounts
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
            Authorise Signal to read the office&rsquo;s own accounts: real comments and exact
            counts, straight from each platform.
          </p>
        </div>

        <div className="space-y-3">
          {(!key || refused) && (
            <Card
              className={
                refused ? 'border-[color-mix(in_oklab,var(--neg)_30%,transparent)]' : undefined
              }
            >
              {/* The reference card header, with the tint carrying the state:
                  warm when the key was refused, product blue otherwise. The
                  refused state's full explanation stays in the body below —
                  a CardHead sub truncates, and this copy must not. */}
              <CardHead
                icon={<Key size={15} aria-hidden />}
                title={refused ? 'That key was not accepted' : 'Connecting accounts needs a key'}
                sub={refused ? 'Check it with whoever set the server up' : 'Everything else on this screen works without one'}
                tint={refused ? 'orange' : 'blue'}
              />

              {/* What the key actually is, in a sentence, because "admin key
                  required" told an office nothing about whose key, what for, or
                  whether they were supposed to have one. */}
              <p className="text-sm leading-relaxed text-ink-2">
                {refused && 'It is not your account password. '}
                Ask whoever set the server up for{' '}
                <code className="rounded bg-[var(--surface-2)] px-1 py-0.5 text-[13px]">
                  SETTINGS_ACCESS_KEY
                </code>
                .
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
                  className="min-h-11 min-w-0 flex-1 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm shadow-[var(--e1)] outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)]"
                />
                <Button size="sm" onClick={saveKey} disabled={!keyInput.trim()}>
                  Continue
                </Button>
              </div>

              {key && (
                <button
                  onClick={forgetKey}
                  className="mt-3 min-h-11 text-xs font-medium text-ink-3 underline decoration-[var(--rule)] underline-offset-4 hover:text-ink-2"
                >
                  Forget the stored key
                </button>
              )}
            </Card>
          )}

          {notice && (
            <Card className="border-[color-mix(in_oklab,var(--pos)_30%,transparent)] bg-[var(--pos-soft)]">
              <p className="text-sm font-medium text-[var(--pos)]">{notice}</p>
            </Card>
          )}
          {error && (
            <Card className="border-[color-mix(in_oklab,var(--neg)_30%,transparent)] bg-[var(--neg-soft)]">
              <p className="text-sm font-medium text-[var(--neg)]">{error}</p>
            </Card>
          )}

          {/* The platform cards need `status`, not merely a key.
              They rendered on `key` alone, so a saved-but-refused key still drew
              four live Connect buttons — every one of which starts an OAuth
              redirect the server will reject at the door. A control that cannot
              work must not look like one that can. */}
          {status && (
            <div className="grid gap-3 lg:grid-cols-2">
              {PLATFORMS.map(({ platform, slug, label }) => {
                const conn = byPlatform.get(platform)
                return (
                  <Card
                    key={platform}
                    /* One row on a laptop; at 375px the button drops below the
                       account line as a full-width bar instead of crushing the
                       text against the badge. */
                    className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <PlatformBadge platform={platform} size={40} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{label}</span>
                          {conn ? (
                            <Chip tone={conn.lastError ? 'warning' : 'positive'} icon={<CircleCheck size={11} />}>
                              Connected
                            </Chip>
                          ) : (
                            <Chip tone="neutral">Not connected</Chip>
                          )}
                        </div>
                        {/* Two lines, not truncate: at 375px a one-line clamp
                            cut the failure reason — the only part worth
                            reading — clean off. */}
                        <p className="mt-0.5 line-clamp-2 text-xs text-ink-3">
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
                      className="w-full shrink-0 sm:w-auto"
                      onClick={() => (conn ? disconnect(platform) : connect(slug))}
                    >
                      {conn ? 'Disconnect' : 'Connect'}
                    </Button>
                  </Card>
                )
              })}

              <Card className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex shrink-0 -space-x-2">
                    <PlatformBadge platform="Facebook" size={40} className="ring-2 ring-[var(--surface)]" />
                    <PlatformBadge platform="Instagram" size={40} className="ring-2 ring-[var(--surface)]" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">Facebook / Instagram</span>
                      {status?.meta.configured ? (
                        <Chip tone={status.meta.working ? 'positive' : 'warning'} icon={<CircleCheck size={11} />}>
                          {status.meta.working ? 'Connected' : 'Configured'}
                        </Chip>
                      ) : (
                        <Chip tone="neutral">Not connected</Chip>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-ink-3">
                      {status?.meta.working
                        ? `${status.meta.page ?? 'Page connected'}${status.meta.instagramLinked ? ' · Instagram linked' : ''}`
                        : status?.meta.why
                          ? status.meta.why
                          : 'Set META_PAGE_TOKEN on the server to connect. See README.'}
                    </p>
                  </div>
                </div>
              </Card>

              <div className={cn('flex justify-end lg:col-span-2', loading ? 'opacity-100' : 'opacity-0')}>
                <RefreshCw size={14} className="animate-spin text-ink-3" aria-hidden />
              </div>
            </div>
          )}
        </div>
      </m.section>
    </m.div>
  )
}
