import { useCallback, useEffect, useMemo, useState } from 'react'
import * as m from 'motion/react-m'
import { Plus, RefreshCw, Trash2, ExternalLink, TrendingUp, TrendingDown, Radar, ShieldCheck, MessageSquareHeart } from 'lucide-react'
import type { Platform } from '@shared/taxonomy'
import { Button, Card, Chip, SectionTitle } from './ui'
import { cn } from '@/lib/utils'
import { fadeUp, listStagger } from '@/lib/motion'
import { parseHandleUrl } from '@shared/handle-url'
import {
  analysedPostsFor,
  readStandingCache,
  saveStandingCache,
  readRivals,
  saveRivals,
  listHandles,
  saveHandle,
  removeHandle,
  addSnapshot,
  handleId,
  statsFor,
  deltaFor,
  type HandleStats,
  type TrackedHandle,
  type RivalCache,
  type Standing,
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

/**
 * The follower history, drawn from the readings actually stored.
 *
 * The dashboard has been keeping every snapshot since the first refresh and
 * showing none of it — a number and an arrow, where the shape of the last
 * month is the thing a press officer actually wants. Two readings is enough to
 * draw a line; below that there is nothing to say and it renders nothing
 * rather than a flat line implying stability nobody measured.
 */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - lo) / span) * 24}`)
    .join(' ')
  const rising = (values.at(-1) ?? 0) >= (values[0] ?? 0)

  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="mt-2 h-8 w-full"
      role="img"
      aria-label={`Followers over the last ${values.length} readings, ${rising ? 'rising' : 'falling'}`}
    >
      <polyline
        points={pts}
        fill="none"
        stroke={rising ? 'var(--pos)' : 'var(--neg)'}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** The platform's own mark, so a row is identifiable before it is read. */
function PlatformDot({ platform }: { platform: Platform }) {
  const tone: Record<string, string> = {
    YouTube: '#FF0033',
    Instagram: '#C13584',
    Facebook: '#0866FF',
    LinkedIn: '#0A66C2',
    Bluesky: '#1185FE',
    Mastodon: '#6364FF',
  }
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={{ background: tone[platform] ?? 'var(--ink-3)' }}
    />
  )
}

/**
 * What a comparison is actually made of.
 *
 * Ranking by followers says who is bigger, which everyone already knows. These
 * are the lines that separate two accounts of similar size: how hard the
 * audience works, whether they argue or applaud, how reliably posts land, and
 * how often anything is posted at all.
 *
 * `better` is per-measure and deliberately not universal. More reach is better;
 * fewer posts is neither better nor worse, so cadence is never marked.
 */
const MEASURES: {
  label: string
  note: string
  better: 'high' | 'low' | 'none'
  get: (s: HandleStats) => number | null
  fmt: (n: number) => string
}[] = [
  {
    label: 'Followers',
    note: 'reach',
    better: 'high',
    get: (s) => s.followers,
    fmt: (n) => n.toLocaleString('en-IN'),
  },
  {
    label: 'Engagement',
    note: 'interactions per post, as % of followers',
    better: 'high',
    get: (s) => s.engagementRate,
    fmt: (n) => `${n.toFixed(2)}%`,
  },
  {
    label: 'Per post',
    note: 'likes + comments',
    better: 'high',
    get: (s) => s.avgEngagement,
    fmt: (n) => n.toLocaleString('en-IN'),
  },
  {
    label: 'Views per post',
    note: 'where published',
    better: 'high',
    get: (s) => s.avgViews,
    fmt: (n) => n.toLocaleString('en-IN'),
  },
  {
    label: 'Talk ratio',
    note: 'share of interactions that are comments, not likes',
    better: 'high',
    get: (s) => s.talkRatio,
    fmt: (n) => `${n.toFixed(1)}%`,
  },
  {
    label: 'Consistency',
    note: '1.0 = every post lands the same; low = one hit, many misses',
    better: 'high',
    get: (s) => s.consistency,
    fmt: (n) => n.toFixed(2),
  },
  {
    label: 'Posts a week',
    note: 'output — neither more nor less is better',
    better: 'none',
    get: (s) => s.postsPerWeek,
    fmt: (n) => n.toFixed(1),
  },
]

export function Dashboard({
  onClose,
  mode = 'accounts',
}: {
  onClose: () => void
  /**
   * 'compare' shows only the side-by-side. It is the same data and the same
   * component — a separate screen would have meant a second copy of every
   * number and an argument about which was right.
   */
  mode?: 'accounts' | 'compare'
}) {
  const [handles, setHandles] = useState<TrackedHandle[]>([])
  const [input, setInput] = useState('')
  const [platform, setPlatform] = useState<Platform>('YouTube')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rivals, setRivals] = useState<RivalCache | null>(null)
  const [finding, setFinding] = useState(false)
  const [standings, setStandings] = useState<Record<string, Standing>>({})
  const [reading, setReading] = useState<string | null>(null)

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
          // The server knows the real handle; the client only had whatever was
          // pasted, which for a URL meant the card read "@https://www.youtu…".
          if (s.handle) existing.handle = s.handle
          if (s.platform) existing.platform = s.platform
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

      // The URL decides the platform, not the picker. Filing a pasted link
      // under whatever the dropdown showed meant Modi's Facebook page was
      // stored as a YouTube account, and — because the id was built from the
      // same guess — it collided with his YouTube entry instead of joining it.
      // You could attach one platform per person, never several.
      const ref = parseHandleUrl(value, platform)
      if (!ref) {
        setError(
          'That does not look like a profile link. Paste the address of the profile page, or pick a platform and type just the handle.',
        )
        return
      }

      const created: TrackedHandle = {
        id: handleId(ref.platform, ref.handle),
        platform: ref.platform,
        handle: ref.handle,
        displayName: null,
        profileUrl: /^https?:\/\//i.test(value) ? value : '',
        avatarUrl: null,
        own,
        label: null,
        listingNote: '',
        snapshots: [],
      }
      setError(null)
      setHandles(saveHandle(created))
      setInput('')
      await refresh([{ ...created, profileUrl: created.profileUrl || ref.handle }])
    },
    [input, platform, refresh],
  )

  /** The account we discover rivals for: the first one marked as yours. */
  const primary = useMemo(() => handles.find((h) => h.own) ?? handles[0], [handles])

  useEffect(() => {
    if (primary) setRivals(readRivals(primary.id))
  }, [primary])

  const discover = useCallback(async () => {
    if (!primary) return
    setFinding(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/rivals?q=${encodeURIComponent(primary.profileUrl || primary.handle)}`,
      )
      const j = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        setError(String(j['error'] ?? 'Could not work out who to compare against.'))
        return
      }
      const cache: RivalCache = {
        subject: String(j['subject'] ?? primary.handle),
        role: String(j['role'] ?? ''),
        checked: Number(j['checked'] ?? 0),
        discarded: Number(j['discarded'] ?? 0),
        foundAt: new Date().toISOString(),
        rivals: ((j['rivals'] as Record<string, unknown>[]) ?? []).map((r) => {
          const profiles = (r['profiles'] as Record<string, unknown>[]) ?? []
          return {
            name: String(r['name'] ?? ''),
            why: String(r['why'] ?? ''),
            cohort: String(r['cohort'] ?? 'Comparable'),
            followers: (r['followers'] as number | null) ?? null,
            platforms: profiles.map((p) => String(p['platform'])),
            profileUrl: String(profiles[0]?.['profileUrl'] ?? ''),
          }
        }),
      }
      saveRivals(primary.id, cache)
      setRivals(cache)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setFinding(false)
    }
  }, [primary])

  /** Track a discovered rival, so it joins the measured comparison. */
  const trackRival = useCallback(
    async (r: { name: string; profileUrl: string }) => {
      const ref = r.profileUrl
      if (!ref) return
      const created: TrackedHandle = {
        id: handleId('YouTube', ref),
        platform: 'YouTube',
        handle: r.name,
        displayName: r.name,
        profileUrl: ref,
        avatarUrl: null,
        own: false,
        label: null,
        listingNote: '',
        snapshots: [],
      }
      setHandles(saveHandle(created))
      await refresh([created])
    },
    [refresh],
  )

  /** Accounts with a reading, yours first — the table's column order. */
  const compared = useMemo(
    () =>
      handles
        .filter((h) => h.snapshots.length > 0)
        .sort((a, b) => Number(b.own) - Number(a.own))
        .slice(0, 4),
    [handles],
  )

  /**
   * One sentence naming where you actually stand.
   *
   * A table of seven numbers still leaves the reader to do the comparing. This
   * says the thing out loud, and says it about engagement rather than reach,
   * because reach is the line everybody already knows.
   */
  const verdict = useMemo(() => {
    const mine = compared.find((h) => h.own)
    if (!mine || compared.length < 2) return null
    const s = statsFor(mine.snapshots.at(-1))
    if (s.engagementRate == null) return null
    const others = compared
      .filter((h) => !h.own)
      .map((h) => ({ h, r: statsFor(h.snapshots.at(-1)).engagementRate }))
      .filter((x): x is { h: TrackedHandle; r: number } => x.r != null)
    if (!others.length) return null

    const beaten = others.filter((o) => s.engagementRate! > o.r)
    const name = mine.displayName ?? mine.handle
    if (beaten.length === others.length) {
      return `${name} gets more out of each follower than everyone here — ${s.engagementRate.toFixed(2)}% against ${others.map((o) => o.r.toFixed(2) + '%').join(' and ')}.`
    }
    const top = others.sort((a, b) => b.r - a.r)[0]!
    return `${top.h.displayName ?? top.h.handle} reaches a larger share of their following — ${top.r.toFixed(2)}% against ${name}'s ${s.engagementRate.toFixed(2)}%. Reach is not the gap; engagement is.`
  }, [compared])

  // Load whatever opinion readings are already cached for the compared set.
  useEffect(() => {
    const found: Record<string, Standing> = {}
    for (const h of handles) {
      const c = readStandingCache(h.id)
      if (c) found[h.id] = c
    }
    setStandings(found)
  }, [handles])

  /**
   * Read what the public thinks of one account.
   *
   * Paid per account and only when asked, because it costs several live post
   * fetches and a model call. The result is cached on the device.
   */
  const readOpinion = useCallback(async (h: TrackedHandle) => {
    setReading(h.id)
    setError(null)
    try {
      // Platforms that publish a post list get crawled. The rest are scored on
      // the posts this user has already analysed, which is the only honest way
      // to reach a Facebook or LinkedIn account at all.
      const crawlable = AUTO.has(h.platform)
      const own = crawlable ? [] : analysedPostsFor(h)

      if (!crawlable && !own.length) {
        setError(
          `${h.platform} does not publish this account's posts. Analyse a few of them with the link button and they will be read from here.`,
        )
        return
      }

      const res = crawlable
        ? await fetch(`/api/standing?q=${encodeURIComponent(h.profileUrl || h.handle)}`)
        : await fetch('/api/standing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: own, platform: h.platform, handle: h.handle }),
          })

      const j = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        setError(String(j['error'] ?? 'Could not read public opinion.'))
        return
      }
      const standing: Standing = {
        score: Number(j['score'] ?? 0),
        label: String(j['label'] ?? 'Mixed'),
        positive: Number(j['positive'] ?? 0),
        negative: Number(j['negative'] ?? 0),
        neutral: Number(j['neutral'] ?? 0),
        praise: (j['praise'] as string[]) ?? [],
        criticism: (j['criticism'] as string[]) ?? [],
        summary: String(j['summary'] ?? ''),
        commentsRead: Number(j['commentsRead'] ?? 0),
        postsRead: Number(j['postsRead'] ?? 0),
        readAt: new Date().toISOString(),
      }
      saveStandingCache(h.id, standing)
      setStandings((prev) => ({ ...prev, [h.id]: standing }))
    } catch {
      setError('Could not reach the server.')
    } finally {
      setReading(null)
    }
  }, [])

  const own = useMemo(() => handles.filter((h) => h.own), [handles])
  const watched = useMemo(() => handles.filter((h) => !h.own), [handles])

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
          <h1 className="hed text-2xl">{mode === 'compare' ? 'Compare' : 'Accounts'}</h1>
          <p className="text-sm text-ink-3">
            {handles.length
              ? `${own.length} yours · ${watched.length} watched`
              : 'Track your handles and the ones you are measured against.'}
          </p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Back
        </Button>
      </m.div>

      {/* ── Add ─────────────────────────────────────────────────────────── */}
      {mode === 'accounts' && (
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
      )}

      {mode === 'accounts' && handles.length > 0 && (
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

      {/* ── Who to compare against, found rather than typed ─────────────── */}
      {mode === 'compare' && primary && (
        <m.section variants={fadeUp}>
          <SectionTitle
            hint={
              rivals
                ? `${rivals.checked} handles were checked against the live platforms; ${rivals.discarded} did not resolve and were dropped.`
                : 'Worked out from who this account belongs to — a head of government is measured against different people than a district legislator.'
            }
          >
            Who {primary.displayName ?? primary.handle} is measured against
          </SectionTitle>

          <Card>
            {!rivals ? (
              <div className="text-center">
                <p className="text-sm text-ink-2">
                  Find the people this account is fairly compared with.
                </p>
                <Button
                  className="mt-3"
                  size="sm"
                  onClick={() => void discover()}
                  disabled={finding}
                >
                  <Radar size={14} className={finding ? 'animate-spin' : ''} />
                  {finding ? 'Working out who matters…' : 'Find competitors'}
                </Button>
                <p className="mt-3 text-xs text-ink-3">
                  Costs one model call. The answer is kept on this device, so it is
                  only paid once.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="accent">{rivals.role || 'Public account'}</Chip>
                  <Chip tone="positive" icon={<ShieldCheck size={12} />}>
                    {rivals.rivals.length} verified
                  </Chip>
                  <button
                    onClick={() => void discover()}
                    disabled={finding}
                    className="ml-auto text-xs text-ink-3 underline decoration-dotted hover:text-ink-1"
                  >
                    {finding ? 'checking…' : 'redo'}
                  </button>
                </div>

                {/* Grouped by cohort, because "compared against" means different
                    things at once: the same office, the same seat, the same
                    trade. Flattening them into one list loses the reason. */}
                {[...new Set(rivals.rivals.map((r) => r.cohort))].map((cohort) => (
                  <div key={cohort} className="mt-4">
                    <p className="text-xs uppercase tracking-wide text-ink-3">{cohort}</p>
                    <ul className="mt-2 space-y-2">
                      {rivals.rivals
                        .filter((r) => r.cohort === cohort)
                        .map((r) => {
                          const tracked = handles.some(
                            (h) => h.profileUrl === r.profileUrl && r.profileUrl,
                          )
                          return (
                            <li
                              key={r.name + r.profileUrl}
                              className="rounded-[--radius-md] border border-[var(--border)] p-3"
                            >
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <span className="text-sm font-medium text-ink-1">{r.name}</span>
                                <span className="num text-xs text-ink-3">
                                  {r.followers != null
                                    ? `${r.followers.toLocaleString('en-IN')} followers`
                                    : '—'}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-ink-2">{r.why}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="text-xs text-ink-3">
                                  {r.platforms.join(' · ')}
                                </span>
                                {/* The full comparison is a second model call,
                                    so it is only paid for the person actually
                                    asked about. */}
                                <Button
                                  size="sm"
                                  variant={tracked ? 'ghost' : 'outline'}
                                  className="ml-auto"
                                  disabled={tracked || busy != null || !r.profileUrl}
                                  onClick={() => void trackRival(r)}
                                >
                                  {tracked ? 'Tracked' : 'Compare with this'}
                                </Button>
                              </div>
                            </li>
                          )
                        })}
                    </ul>
                  </div>
                ))}

                <p className="mt-4 text-xs text-ink-3">
                  Names and reasons come from the model and may be out of date. Every
                  handle above was fetched from the platform — follower counts are
                  live, and any account that did not resolve was dropped rather than
                  shown.
                </p>
              </>
            )}
          </Card>
        </m.section>
      )}

      {/* ── What people think ───────────────────────────────────────────── */}
      {mode === 'compare' && compared.length > 0 && (
        <m.section variants={fadeUp}>
          <SectionTitle hint="Read from the comments on each account's recent posts — not from follower counts. This is the measure the other seven cannot give you.">
            What people think
          </SectionTitle>
          <div className="space-y-3">
            {compared.map((h) => {
              const st = standings[h.id]
              const busy = reading === h.id
              return (
                <Card key={h.id} tone={h.own ? 'accent' : undefined}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <PlatformDot platform={h.platform} />
                      <span className="truncate text-sm font-medium text-ink-1">
                        {h.displayName ?? h.handle}
                      </span>
                      {h.own && <span className="text-xs text-[var(--accent)]">you</span>}
                    </span>
                    {!st && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || reading != null}
                        onClick={() => void readOpinion(h)}
                      >
                        <MessageSquareHeart size={14} />
                        {busy ? 'Reading comments…' : 'Read opinion'}
                      </Button>
                    )}
                  </div>

                  {st && (
                    <>
                      <div className="mt-3 flex items-end gap-3">
                        <span
                          className="num text-3xl leading-none"
                          style={{
                            color:
                              st.score > 15
                                ? 'var(--pos)'
                                : st.score < -15
                                  ? 'var(--neg)'
                                  : 'var(--warn)',
                          }}
                        >
                          {st.score > 0 ? '+' : ''}
                          {st.score}
                        </span>
                        <span className="pb-0.5">
                          <span className="block text-sm text-ink-1">{st.label}</span>
                          <span className="block text-xs text-ink-3">
                            {st.commentsRead} comments across {st.postsRead} posts
                          </span>
                        </span>
                      </div>

                      {/* The split, as one bar. Three numbers in a row would be
                          read as three facts; this reads as one shape. */}
                      <div className="mt-3 flex h-2 overflow-hidden rounded-full">
                        <span style={{ width: `${st.positive}%`, background: 'var(--pos)' }} />
                        <span style={{ width: `${st.neutral}%`, background: 'var(--ink-3)', opacity: 0.35 }} />
                        <span style={{ width: `${st.negative}%`, background: 'var(--neg)' }} />
                      </div>
                      <p className="mt-1.5 text-xs text-ink-3">
                        {st.positive}% positive · {st.neutral}% neutral · {st.negative}% negative
                      </p>

                      {st.summary && <p className="mt-3 text-sm text-ink-1">{st.summary}</p>}

                      {/* Criticism first. It is the half an office has to act on,
                          and putting praise above it buries the work. */}
                      {st.criticism.length > 0 && (
                        <div className="mt-3">
                          <p className="kicker">What they complain about</p>
                          <ul className="mt-1.5 space-y-1">
                            {st.criticism.slice(0, 3).map((c, i) => (
                              <li key={i} className="text-xs text-ink-2">
                                • {c}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {st.praise.length > 0 && (
                        <div className="mt-2.5">
                          <p className="kicker">What they praise</p>
                          <ul className="mt-1.5 space-y-1">
                            {st.praise.slice(0, 2).map((c, i) => (
                              <li key={i} className="text-xs text-ink-2">
                                • {c}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </Card>
              )
            })}
          </div>
        </m.section>
      )}

      {/* ── Head to head ────────────────────────────────────────────────── */}
      {handles.filter((h) => h.snapshots.length).length > 1 && (
        <m.section variants={fadeUp}>
          <SectionTitle hint="Seven measures, not one. An account can lead on reach and lose on every other line — that is the useful part.">
            Head to head
          </SectionTitle>
          <Card>
            {/* Not a table.
                
                A seven-row, four-column grid needs about 520px, and this is
                used on a 390px phone — the values ended up off-screen behind a
                sideways scroll while the labels sat in view, which is the worst
                possible split. Each measure is now its own block with the
                figures beneath it, so everything is legible at any width and
                nothing scrolls horizontally. */}
            <div className="space-y-3">
              {MEASURES.map((measure) => {
                const vals = compared.map((h) => measure.get(statsFor(h.snapshots.at(-1))))
                const nums = vals.filter((v): v is number => v != null)
                const best =
                  measure.better === 'none' || nums.length < 2
                    ? null
                    : measure.better === 'high'
                      ? Math.max(...nums)
                      : Math.min(...nums)
                // A bar under each figure, scaled to the biggest in the row, so
                // the gap is visible without reading the digits.
                const peak = nums.length ? Math.max(...nums.map(Math.abs)) : 0

                return (
                  <div
                    key={measure.label}
                    className="rounded-[--radius-md] border border-[var(--border)] p-3"
                  >
                    <p className="text-sm text-ink-1">{measure.label}</p>
                    <p className="text-xs text-ink-3">{measure.note}</p>
                    <div className="mt-2.5 space-y-2">
                      {compared.map((h, i) => {
                        const v = vals[i]
                        const leads = v != null && best != null && v === best
                        return (
                          <div key={h.id}>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-2">
                                <PlatformDot platform={h.platform} />
                                <span className="truncate">
                                  {h.displayName ?? h.handle}
                                </span>
                                {/* The platform is the distinguishing part when
                                    one person is tracked on several. Four rows
                                    reading "narendramodi" told you nothing. */}
                                <span className="shrink-0 text-ink-3">{h.platform}</span>
                              </span>
                              <span
                                className={cn(
                                  'num shrink-0 text-sm tabular-nums',
                                  leads ? 'font-semibold text-[var(--accent)]' : 'text-ink-1',
                                )}
                              >
                                {v == null ? '—' : measure.fmt(v)}
                              </span>
                            </div>
                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: peak > 0 && v != null ? `${(Math.abs(v) / peak) * 100}%` : '0%',
                                  background: leads ? 'var(--accent)' : 'var(--ink-3)',
                                  opacity: leads ? 1 : 0.4,
                                }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* The sentence a press officer would actually say out loud. */}
            {verdict && <p className="mt-4 text-sm text-ink-1">{verdict}</p>}

            <p className="mt-3 text-xs text-ink-3">
              Measured from the most recent reading of each account. A dash means the
              platform does not publish that figure — not that it is zero.
            </p>
          </Card>
        </m.section>
      )}

      {/* ── The accounts ────────────────────────────────────────────────── */}
      {(mode === 'compare' ? [] : [
        { title: 'Your accounts', rows: own },
        { title: 'Who you are watching', rows: watched },
      ])
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
                      <div className="flex min-w-0 items-center gap-2.5">
                        {h.avatarUrl ? (
                          <img
                            src={h.avatarUrl}
                            alt=""
                            loading="lazy"
                            // The CDN serves this fine to a direct request and
                            // refuses it with a referrer attached, which is why
                            // it rendered as a broken image.
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none'
                            }}
                            className="size-9 shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]"
                          />
                        ) : (
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-sm font-semibold text-ink-3">
                            {(h.displayName ?? h.handle).replace(/^@/, '').charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <PlatformDot platform={h.platform} />
                            <span className="truncate text-sm font-medium text-ink-1">
                              {h.displayName ?? h.handle}
                            </span>
                          </span>
                          <span className="block truncate text-xs text-ink-3">
                            {h.platform} · @{h.handle.replace(/^@/, '')}
                          </span>
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

                    <Sparkline
                      values={h.snapshots
                        .map((x) => x.followers)
                        .filter((f): f is number => f != null)}
                    />

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
                        About {s.postsPerWeek} posts a week, across the last {s.posts} we
                        can see.
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

      {handles.length === 0 && mode === 'accounts' && (
        <m.section variants={fadeUp}>
          <Card>
            <p className="text-sm text-ink-1">Nothing tracked yet.</p>
            <p className="mt-1 text-xs text-ink-3">
              Start with one of these — they are public accounts that read cleanly.
            </p>
            <ul className="mt-3 space-y-2">
              {[
                { url: 'https://www.youtube.com/@narendramodi', label: 'Narendra Modi', note: 'YouTube · 3.13 crore' },
                { url: 'https://www.facebook.com/narendramodi/', label: 'Narendra Modi', note: 'Facebook · 6.2 crore, followers only' },
                { url: 'https://www.youtube.com/@PMOIndia', label: 'PMO India', note: 'YouTube · 22 lakh' },
              ].map((ex) => (
                <li key={ex.url}>
                  <button
                    onClick={() => setInput(ex.url)}
                    className="flex w-full items-center justify-between gap-2 rounded-[--radius-md] border border-[var(--border)] px-3 py-2 text-left hover:border-[var(--accent)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink-1">{ex.label}</span>
                      <span className="block truncate text-xs text-ink-3">{ex.note}</span>
                    </span>
                    <Plus size={14} className="shrink-0 text-ink-3" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </m.section>
      )}

      {handles.length === 0 && mode === 'compare' && (
        <m.p variants={fadeUp} className="py-8 text-center text-sm text-ink-3">
          Add at least one account under Accounts, then come back here.
        </m.p>
      )}

      {mode === 'compare' && handles.length > 0 &&
        handles.filter((h) => statsFor(h.snapshots.at(-1)).engagementRate != null).length < 2 && (
          <m.p variants={fadeUp} className="py-8 text-center text-sm text-ink-3">
            A comparison needs two accounts with a follower count and at least one post
            read. Refresh them under Accounts.
          </m.p>
        )}

      <m.p variants={fadeUp} className="text-center text-xs text-ink-3">
        Everything here is stored on this device only, never on a server.
      </m.p>
    </m.div>
  )
}
