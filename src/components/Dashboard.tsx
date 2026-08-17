import { useCallback, useEffect, useMemo, useState } from 'react'
import * as m from 'motion/react-m'
import { Plus, RefreshCw, Trash2, ExternalLink, TrendingUp, TrendingDown } from 'lucide-react'
import type { Platform } from '@shared/taxonomy'
import { Button, Card, Chip, SectionTitle, Bar } from './ui'
import { fadeUp, listStagger } from '@/lib/motion'
import {
  listHandles,
  saveHandle,
  removeHandle,
  addSnapshot,
  handleId,
  statsFor,
  deltaFor,
  type TrackedHandle,
} from '@/lib/handles'

/**
 * The account dashboard.
 *
 * Two questions, one screen: how are our own handles doing, and how does that
 * compare with the people we are measured against. They share every number, so
 * splitting them into two screens would mean two of everything and an argument
 * about which one is authoritative.
 *
 * The comparison is by engagement RATE rather than raw interactions, because
 * raw interactions across accounts of different sizes is the single most
 * common way a dashboard like this misleads: a 2-crore page will out-like a
 * 20,000-follower MLA on every post while reaching a far smaller share of the
 * people who follow it.
 */

const PLATFORMS: Platform[] = [
  'YouTube',
  'Bluesky',
  'Mastodon',
  'Facebook',
  'Instagram',
  'LinkedIn',
]

/** Platforms whose post list we can pull without anyone logging in. */
const AUTO = new Set<Platform>(['YouTube', 'Bluesky', 'Mastodon', 'Reddit'])

const fmt = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('en-IN')

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

/**
 * A derived figure, without provenance.
 *
 * Deliberately not StatTile: that component exists to carry where a number came
 * from — measured, estimated, or typed in — and these are averages this app
 * computed. Borrowing it would attach a provenance mark to arithmetic.
 */
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[--radius-md] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="num mt-0.5 text-lg text-ink-1">{value}</p>
    </div>
  )
}

export function Dashboard({ onClose }: { onClose: () => void }) {
  const [handles, setHandles] = useState<TrackedHandle[]>([])
  const [input, setInput] = useState('')
  const [platform, setPlatform] = useState<Platform>('YouTube')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setHandles(listHandles()), [])

  /** Read one or more handles and store a snapshot of each. */
  const refresh = useCallback(async (targets: TrackedHandle[]) => {
    if (!targets.length) return
    setBusy(targets.length === 1 ? targets[0]!.id : 'all')
    setError(null)
    try {
      const qs = targets.map((h) => `q=${encodeURIComponent(h.profileUrl || h.handle)}`).join('&')
      const res = await fetch(`/api/handle?${qs}`)
      const json = (await res.json()) as { handles?: unknown[] }
      let next = listHandles()
      for (const [i, raw] of (json.handles ?? []).entries()) {
        const s = raw as {
          platform?: Platform
          handle?: string
          displayName?: string | null
          avatarUrl?: string | null
          followers?: number | null
          posts?: TrackedHandle['snapshots'][number]['posts']
          listing?: { note?: string }
          error?: string
        }
        const target = targets[i]
        if (!target) continue
        if (s.error) {
          setError(s.error)
          continue
        }
        const existing = next.find((h) => h.id === target.id)
        if (existing) {
          existing.displayName = s.displayName ?? existing.displayName
          existing.avatarUrl = s.avatarUrl ?? existing.avatarUrl
          existing.listingNote = s.listing?.note ?? existing.listingNote
          next = saveHandle(existing)
        }
        next = addSnapshot(target.id, {
          takenAt: new Date().toISOString(),
          followers: s.followers ?? null,
          posts: s.posts ?? [],
        })
      }
      setHandles(next)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }, [])

  const add = useCallback(
    async (own: boolean) => {
      const value = input.trim()
      if (!value) return
      const isUrl = /^https?:\/\//i.test(value)
      const bare = value.replace(/^@/, '')
      const created: TrackedHandle = {
        id: handleId(platform, bare),
        platform,
        handle: bare,
        displayName: null,
        profileUrl: isUrl ? value : '',
        avatarUrl: null,
        own,
        label: null,
        listingNote: '',
        snapshots: [],
      }
      // A pasted URL carries its own platform; the picker only matters for a
      // bare handle, so do not let a stale picker mislabel a link.
      if (isUrl) created.id = handleId(platform, value)
      setHandles(saveHandle(created))
      setInput('')
      await refresh([{ ...created, profileUrl: isUrl ? value : bare }])
    },
    [input, platform, refresh],
  )

  const own = useMemo(() => handles.filter((h) => h.own), [handles])
  const rivals = useMemo(() => handles.filter((h) => !h.own), [handles])

  // One scale for the comparison bars, so the lengths mean something across
  // rows rather than each row being normalised to itself.
  const peak = useMemo(() => {
    const rates = handles
      .map((h) => statsFor(h.snapshots.at(-1)).engagementRate)
      .filter((r): r is number => r != null)
    return rates.length ? Math.max(...rates) : 0
  }, [handles])

  return (
    <m.div
      className="mx-auto w-full max-w-3xl space-y-6 px-4 pb-28"
      variants={listStagger}
      initial="hidden"
      animate="show"
    >
      <m.div variants={fadeUp} className="flex items-center justify-between gap-3 pt-2">
        <div>
          <h1 className="hed text-2xl">Accounts</h1>
          <p className="text-sm text-ink-3">
            {handles.length
              ? `${own.length} yours · ${rivals.length} watched`
              : 'Track your handles and the ones you are measured against.'}
          </p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Back
        </Button>
      </m.div>

      {/* ── Add ─────────────────────────────────────────────────────────── */}
      <m.div variants={fadeUp}>
        <Card>
          <label className="text-xs uppercase tracking-wide text-ink-3" htmlFor="handle-input">
            Profile link or handle
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id="handle-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="youtube.com/@channel  ·  bsky.app/profile/…  ·  @handle"
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-ink-1 outline-none focus:border-[var(--accent)]"
            />
            <select
              aria-label="Platform, used when you type a bare handle"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2 text-sm text-ink-2"
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void add(true)} disabled={!input.trim()} size="sm">
              <Plus size={14} /> Add as mine
            </Button>
            <Button
              variant="outline"
              onClick={() => void add(false)}
              disabled={!input.trim()}
              size="sm"
            >
              <Plus size={14} /> Add as competitor
            </Button>
          </div>
          {error && <p className="mt-3 text-sm text-[var(--negative)]">{error}</p>}
          <p className="mt-3 text-xs text-ink-3">
            YouTube, Bluesky and Mastodon are pulled automatically. Facebook, Instagram and LinkedIn
            do not publish a post list without a login — those show what we can read, and fill in as
            you analyse individual posts.
          </p>
        </Card>
      </m.div>

      {handles.length > 0 && (
        <m.div variants={fadeUp} className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh(handles)}
            disabled={busy != null}
          >
            <RefreshCw size={14} className={busy === 'all' ? 'animate-spin' : ''} />
            {busy === 'all' ? 'Reading…' : 'Refresh all'}
          </Button>
        </m.div>
      )}

      {/* ── Comparison ──────────────────────────────────────────────────── */}
      {handles.filter((h) => statsFor(h.snapshots.at(-1)).engagementRate != null).length > 1 && (
        <m.section variants={fadeUp}>
          <SectionTitle hint="Interactions per post as a share of followers — the only fair way to put a 20,000-follower account beside a 2-crore one.">
            Side by side
          </SectionTitle>
          <Card>
            <ul className="space-y-3">
              {[...handles]
                .filter((h) => statsFor(h.snapshots.at(-1)).engagementRate != null)
                .sort(
                  (a, b) =>
                    (statsFor(b.snapshots.at(-1)).engagementRate ?? 0) -
                    (statsFor(a.snapshots.at(-1)).engagementRate ?? 0),
                )
                .map((h) => {
                  const s = statsFor(h.snapshots.at(-1))
                  return (
                    <li key={h.id}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm text-ink-1">
                          {h.displayName ?? h.handle}
                          {h.own && (
                            <span className="ml-2 text-xs text-[var(--accent)]">you</span>
                          )}
                        </span>
                        <span className="num shrink-0 text-sm text-ink-2">
                          {s.engagementRate?.toFixed(2)}%
                        </span>
                      </div>
                      <Bar
                        value={peak > 0 ? (s.engagementRate ?? 0) / peak : 0}
                        className={h.own ? undefined : 'opacity-45'}
                      />
                      <p className="mt-1 text-xs text-ink-3">
                        {h.platform} · {fmt(s.followers)} followers · {fmt(s.avgEngagement)} per post
                      </p>
                    </li>
                  )
                })}
            </ul>
          </Card>
        </m.section>
      )}

      {/* ── The accounts ────────────────────────────────────────────────── */}
      {[
        { title: 'Your accounts', rows: own },
        { title: 'Who you are watching', rows: rivals },
      ]
        .filter((g) => g.rows.length)
        .map((group) => (
          <m.section key={group.title} variants={fadeUp}>
            <SectionTitle>{group.title}</SectionTitle>
            <div className="space-y-3">
              {group.rows.map((h) => {
                const latest = h.snapshots.at(-1)
                const s = statsFor(latest)
                const d = deltaFor(h)
                const auto = AUTO.has(h.platform)
                return (
                  <Card key={h.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Chip tone={h.own ? 'accent' : 'neutral'}>{h.platform}</Chip>
                        <span className="truncate text-sm font-medium text-ink-1">
                          {h.displayName ?? h.handle}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {h.profileUrl && (
                          <a
                            href={h.profileUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="rounded p-1.5 text-ink-3 hover:text-ink-1"
                            aria-label={`Open ${h.handle} on ${h.platform}`}
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                        <button
                          onClick={() => void refresh([h])}
                          disabled={busy != null}
                          className="rounded p-1.5 text-ink-3 hover:text-ink-1"
                          aria-label={`Refresh ${h.handle}`}
                        >
                          <RefreshCw size={14} className={busy === h.id ? 'animate-spin' : ''} />
                        </button>
                        <button
                          onClick={() => setHandles(removeHandle(h.id))}
                          className="rounded p-1.5 text-ink-3 hover:text-[var(--negative)]"
                          aria-label={`Stop tracking ${h.handle}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Tile label="Followers" value={fmt(s.followers)} />
                      <Tile label="Posts read" value={fmt(s.posts)} />
                      <Tile label="Per post" value={fmt(s.avgEngagement)} />
                      <Tile
                        label="Engagement"
                        value={s.engagementRate != null ? `${s.engagementRate.toFixed(2)}%` : '—'}
                      />
                    </div>

                    {/* Movement is only shown once there are two readings to
                        compare. A "0%" change on a first refresh would be an
                        invention, not a measurement. */}
                    {(d.followers != null || d.avgEngagement != null) && (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
                        {d.followers != null && d.followers !== 0 && (
                          <span className="inline-flex items-center gap-1">
                            {d.followers > 0 ? (
                              <TrendingUp size={12} className="text-[var(--positive)]" />
                            ) : (
                              <TrendingDown size={12} className="text-[var(--negative)]" />
                            )}
                            {d.followers > 0 ? '+' : ''}
                            {fmt(d.followers)} followers since {ago(d.since)}
                          </span>
                        )}
                        {d.avgEngagement != null && d.avgEngagement !== 0 && (
                          <span>
                            {d.avgEngagement > 0 ? '+' : ''}
                            {fmt(d.avgEngagement)} per post
                          </span>
                        )}
                      </div>
                    )}

                    {s.postsPerWeek != null && (
                      <p className="mt-2 text-xs text-ink-3">
                        Posting about {s.postsPerWeek} times a week.
                      </p>
                    )}

                    {!auto && (
                      <p className="mt-2 text-xs text-ink-3">{h.listingNote}</p>
                    )}

                    <p className="mt-2 text-xs text-ink-3">
                      Read {ago(latest?.takenAt ?? null)}
                      {h.snapshots.length > 1 && ` · ${h.snapshots.length} readings kept`}
                    </p>
                  </Card>
                )
              })}
            </div>
          </m.section>
        ))}

      {handles.length === 0 && (
        <m.p variants={fadeUp} className="py-8 text-center text-sm text-ink-3">
          Nothing tracked yet. Paste a channel or profile link above.
        </m.p>
      )}

      <m.p variants={fadeUp} className="text-center text-xs text-ink-3">
        Everything here is stored on this device only, never on a server.
      </m.p>
    </m.div>
  )
}
