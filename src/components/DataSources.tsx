import { useEffect, useState } from 'react'
import { CircleCheck, CircleX, Loader2, ChevronRight } from 'lucide-react'
import { Card, Chip } from './ui'
import { cn } from '@/lib/utils'

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

export function DataSources() {
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
        const res = await fetch('/api/capabilities')
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
          functions running — on a plain <code>vite</code> server there are none.
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
        <p className="mb-3 text-sm leading-relaxed text-ink-2">
          <span className="font-semibold text-ink">
            {summary.on} of {summary.total} sources are switched on.
          </span>{' '}
          Everything below that is off is a real limit, not a bug — each one says what it would
          take.
        </p>
      )}

      <ul className="space-y-2">
        {caps.map((cap) => {
          const isOpen = open === cap.id
          return (
            <li key={cap.id}>
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
                  className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-[var(--surface-2)]"
                >
                  <span className="mt-0.5 shrink-0">
                    {cap.on ? (
                      <CircleCheck size={18} className="text-[var(--pos)]" aria-hidden />
                    ) : (
                      <CircleX size={18} className="text-ink-3" aria-hidden />
                    )}
                  </span>

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

                  <ChevronRight
                    size={16}
                    aria-hidden
                    className={cn(
                      'mt-1 shrink-0 text-ink-3 transition-transform',
                      isOpen && 'rotate-90',
                    )}
                  />
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
                      only ever reads, so you can safely remove those in the app dashboard — a
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
            </li>
          )
        })}
      </ul>
    </div>
  )
}
