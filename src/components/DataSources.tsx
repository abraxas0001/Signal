import { useEffect, useState } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import { ChevronRight, Globe, Loader2, Network, Newspaper, Search, Sparkles } from 'lucide-react'
import { Card, Chip } from './ui'
import { CardHead, PlatformBadge, ProgressRow } from '@/components/kit'
import { listItem, listStaggerFast } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { fetchWithTimeout } from '@/lib/net'

/**
 * What this deployment can read, and what it would take to read more.
 *
 * The screen that should have existed from the start. An office added their
 * Facebook page — a real page, with 282,000 followers — and the dashboard said
 * nothing had been read about them. From where they sat, that was
 * indistinguishable from a broken product. It was not broken: Facebook refuses
 * a server outright, and no amount of clicking was ever going to change it.
 *
 * The distinction that matters, and which nothing in the app was drawing:
 *
 *   working          — nothing needed, it already runs
 *   needs a free key — five minutes and no card
 *   needs setup      — free but real work, and only you can do it
 *   costs money      — say the number rather than implying it is coming
 *
 * A product that cannot say which of those four it is standing in front of is
 * one an office stops trusting, because every empty screen might be a bug.
 */

interface Capability {
  id: string
  label: string
  unlocks: string
  on: boolean
  needs: string[]
  cost: 'none' | 'free-key' | 'free-with-setup' | 'paid'
  steps: string[]
  status?: string | null
  token?: {
    type: string | null
    page: string | null
    scopes: string[]
    missingScopes: string[]
    writeScopes: string[]
    expiresAt: string | null
    problems: string[]
  } | null
}

const COST_LABEL: Record<Capability['cost'], string> = {
  none: 'nothing needed',
  'free-key': 'free key',
  'free-with-setup': 'free, some setup',
  paid: 'costs money',
}

/* ── Source identity ─────────────────────────────────────────────────────
   Each row leads with a favicon-ish badge: the platform-shaped sources wear
   their real brand circle (PlatformBadge — brand colour is identity, not
   data), everything else a soft-tinted icon square. Purely presentational;
   the capability payload is untouched. */

const SOURCE_PLATFORM: Record<string, string> = {
  youtube: 'YouTube',
  x: 'Twitter/X',
}

const SOURCE_ICONS: Record<string, { Icon: typeof Newspaper; bg: string; fg: string }> = {
  news: { Icon: Newspaper, bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  model: { Icon: Sparkles, bg: 'var(--accent-2-soft)', fg: 'var(--accent-2)' },
  grounded: { Icon: Search, bg: 'color-mix(in oklab, var(--chart-3) 12%, transparent)', fg: 'var(--chart-3)' },
  provider: { Icon: Network, bg: 'var(--warn-soft)', fg: 'var(--warn)' },
}

function SourceBadge({ id }: { id: string }) {
  if (id === 'meta') {
    return (
      <span className="flex shrink-0 -space-x-2.5">
        <PlatformBadge platform="Facebook" size={32} className="ring-2 ring-[var(--surface)]" />
        <PlatformBadge platform="Instagram" size={32} className="ring-2 ring-[var(--surface)]" />
      </span>
    )
  }
  const platform = SOURCE_PLATFORM[id]
  if (platform) return <PlatformBadge platform={platform} size={40} />
  const meta = SOURCE_ICONS[id] ?? { Icon: Globe, bg: 'var(--surface-3)', fg: 'var(--text-2)' }
  const { Icon } = meta
  return (
    <span className="icon-badge" style={{ background: meta.bg, color: meta.fg }}>
      <Icon size={18} aria-hidden />
    </span>
  )
}

/**
 * A switch that only reports. Whether a source is on is decided by the
 * server's environment, not by a click here, so this is state made visible —
 * the row's real affordance stays "expand and read what it would take".
 */
function ToggleState({ on }: { on: boolean }) {
  return (
    <span
      role="img"
      aria-label={on ? 'Switched on' : 'Switched off'}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        on ? 'bg-[var(--pos)]' : 'border border-[var(--border)] bg-[var(--surface-3)]',
      )}
    >
      <span
        className={cn(
          'absolute size-3.5 rounded-full bg-white shadow-[var(--e1)] transition-transform',
          on ? 'translate-x-[18px]' : 'translate-x-[3px]',
        )}
      />
    </span>
  )
}

export function DataSources() {
  const reduced = useReducedMotion()
  const [caps, setCaps] = useState<Capability[] | null>(null)
  const [summary, setSummary] = useState<{ on: number; total: number; nextBest: string | null } | null>(
    null,
  )
  const [open, setOpen] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchWithTimeout('/api/capabilities')
        if (!res.ok) throw new Error(String(res.status))
        const payload = (await res.json()) as {
          capabilities?: Capability[]
          summary?: { on: number; total: number; nextBest: string | null }
        }
        if (cancelled) return
        setCaps(payload.capabilities ?? [])
        setSummary(payload.summary ?? null)
        // The most useful one to fix is opened, because a list of six
        // collapsed rows is a list nobody expands.
        if (payload.summary?.nextBest) setOpen(payload.summary.nextBest)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) {
    return (
      <Card>
        <p className="text-sm text-ink-2">
          The server could not say what it is able to read. This screen needs the site&rsquo;s
          functions running. On a plain <code>vite</code> server there are none.
        </p>
      </Card>
    )
  }

  if (!caps) {
    return (
      <Card>
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <Loader2 size={15} className="animate-spin" aria-hidden />
          Checking what this deployment can read…
        </p>
      </Card>
    )
  }

  return (
    <div>
      {summary && (
        <Card className="mb-3">
          {/* The reference card header. The sentence that keeps this screen
              honest stays as body copy below it — a CardHead sub truncates,
              and this copy must never be cut. */}
          <CardHead
            icon={<Globe size={15} aria-hidden />}
            title={`${summary.on} of ${summary.total} sources are switched on`}
            sub="What this deployment can read right now"
            tint="blue"
          />
          {summary.total > 0 && (
            <ProgressRow
              className="mt-3"
              label="Sources reading"
              fraction={summary.on / summary.total}
              detail={`${summary.on} on · ${summary.total - summary.on} off`}
              color="var(--pos)"
            />
          )}
        </Card>
      )}

      <m.ul
        className="space-y-2.5"
        variants={listStaggerFast}
        initial={reduced ? false : 'hidden'}
        animate="show"
      >
        {caps.map((cap) => {
          const isOpen = open === cap.id
          return (
            <m.li key={cap.id} variants={listItem}>
              <Card
                padded={false}
                className={cn(
                  'overflow-hidden',
                  cap.on && 'border-[color-mix(in_oklab,var(--pos)_30%,var(--rule))]',
                )}
              >
                <button
                  onClick={() => setOpen(isOpen ? null : cap.id)}
                  aria-expanded={isOpen}
                  className="flex min-h-11 w-full items-start gap-3 p-4 text-left transition-colors hover:bg-[var(--surface-2)]"
                >
                  <SourceBadge id={cap.id} />

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">{cap.label}</span>
                      <Chip
                        tone={
                          cap.cost === 'none'
                            ? 'positive'
                            : cap.cost === 'paid'
                              ? 'negative'
                              : 'neutral'
                        }
                      >
                        {COST_LABEL[cap.cost]}
                      </Chip>
                    </span>

                    <span className="mt-1 block text-sm leading-relaxed text-ink-2">
                      {cap.unlocks}
                    </span>

                    {cap.status && (
                      <span
                        className={cn(
                          'mt-1.5 block text-xs leading-relaxed',
                          cap.on ? 'text-[var(--pos)]' : 'text-[var(--warn)]',
                        )}
                      >
                        {cap.status}
                      </span>
                    )}
                  </span>

                  <span className="flex shrink-0 items-center gap-2 pt-2">
                    <ToggleState on={cap.on} />
                    <ChevronRight
                      size={16}
                      aria-hidden
                      className={cn(
                        'shrink-0 text-ink-3 transition-transform',
                        isOpen && 'rotate-90',
                      )}
                    />
                  </span>
                </button>

                {/* A token that is set but wrong is the commonest state during
                    setup, and every wrong one fails identically from outside.
                    These name which mistake it is. Shown whether or not the row
                    is expanded, because it is the answer somebody is looking
                    for and a collapsed row hides it. */}
                {cap.token && cap.token.problems.length > 0 && (
                  <div className="border-t border-[var(--rule)] bg-[var(--neg-soft)] px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--neg)]">
                      What is wrong with the token
                    </p>
                    <ul className="mt-2 space-y-2">
                      {cap.token.problems.map((problem) => (
                        <li
                          key={problem}
                          className="text-sm leading-relaxed text-[var(--neg)]"
                        >
                          {problem}
                        </li>
                      ))}
                    </ul>
                    {(cap.token.type || cap.token.page) && (
                      <p className="mt-2.5 text-xs text-[var(--neg)] opacity-80">
                        Meta reports it as a {cap.token.type ?? 'unknown'} token
                        {cap.token.page ? ` for “${cap.token.page}”` : ''}
                        {cap.token.scopes.length > 0
                          ? `, granting ${cap.token.scopes.join(', ')}`
                          : ', granting no permissions'}
                        .
                      </p>
                    )}
                  </div>
                )}

                {/* Granted more than needed. Not an error and not blocked —
                    it is their page — but a monitoring tool holding
                    delete-a-comment rights is worth saying out loud, because
                    nobody ticks that deliberately. */}
                {cap.token && cap.token.writeScopes.length > 0 && (
                  <div className="border-t border-[var(--rule)] bg-[var(--warn-soft)] px-4 py-3">
                    <p className="text-sm leading-relaxed text-[var(--warn)]">
                      This token can also change things: {cap.token.writeScopes.join(', ')}. Signal
                      only ever reads, so you can safely remove those in the app dashboard. A
                      monitoring tool should not be able to delete a constituent&rsquo;s comment.
                    </p>
                  </div>
                )}

                {isOpen && (cap.steps.length > 0 || cap.needs.length > 0) && (
                  <div className="border-t border-[var(--rule)] bg-[var(--surface-2)] p-4">
                    {cap.needs.length > 0 && (
                      <p className="text-xs leading-relaxed text-ink-2">
                        Set{' '}
                        {cap.needs.map((name, i) => (
                          <span key={name}>
                            {i > 0 && ', '}
                            <code className="rounded bg-[var(--surface)] px-1 py-0.5 text-[12px]">
                              {name}
                            </code>
                          </span>
                        ))}{' '}
                        in the site environment, then redeploy.
                      </p>
                    )}

                    {cap.steps.length > 0 && (
                      <ol className="mt-3 space-y-2">
                        {cap.steps.map((step, i) => (
                          <li key={step} className="flex gap-2.5 text-sm leading-relaxed text-ink-2">
                            <span className="kicker mt-0.5 shrink-0 text-ink-3">{i + 1}</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </Card>
            </m.li>
          )
        })}
      </m.ul>
    </div>
  )
}
