import { useCallback, useEffect, useMemo, useState } from 'react'
import * as m from 'motion/react-m'
import {
  Plus,
  RefreshCw,
  Trash2,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Radar,
  ShieldCheck,
  MessageSquareHeart,
  GitCompareArrows,
} from 'lucide-react'
import type { Platform } from '@shared/taxonomy'
import { Button, Card, Chip, PageHeader, SectionTitle } from './ui'
import { SuggestedAccounts } from './SuggestedAccounts'
import { FindByName } from './FindByName'
import { HeadToHead, type RivalRef } from './HeadToHead'
import { useStore } from '@/lib/store'
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
  standingFromSurvey,
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
    note: 'output: neither more nor less is better',
    better: 'none',
    get: (s) => s.postsPerWeek,
    fmt: (n) => n.toFixed(1),
  },
]

export function Dashboard({
  onClose,
  onOpenActions,
  mode = 'accounts',
}: {
  onClose: () => void
  /** Route to the task list, for anything on this screen that files one. */
  onOpenActions?: () => void
  /**
   * 'compare' shows only the side-by-side. It is the same data and the same
   * component — a separate screen would have meant a second copy of every
   * number and an argument about which was right.
   */
  mode?: 'accounts' | 'compare'
}) {
  const store = useStore()
  /** The desk's own person, used to name the subject of a record reading. */
  const identity = store.identity
  const [handles, setHandles] = useState<TrackedHandle[]>([])
  const [input, setInput] = useState('')
  const [platform, setPlatform] = useState<Platform>('YouTube')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rivals, setRivals] = useState<RivalCache | null>(null)
  const [finding, setFinding] = useState(false)
  const [standings, setStandings] = useState<Record<string, Standing>>({})
  const [reading, setReading] = useState<string | null>(null)
  /**
   * Which half of the record reading is running.
   *
   * The grounded survey is two calls and takes the better part of a minute, and
   * a single unexplained spinner for that long is what made the old button feel
   * dead. Naming the step is most of the fix.
   */
  const [readingPhase, setReadingPhase] = useState<'searching' | 'structuring' | null>(null)
  /**
   * The person being compared in depth, or null for the list.
   *
   * One at a time and only when asked: each comparison is a grounded search
   * across two people plus a structuring call.
   */
  const [versus, setVersus] = useState<RivalRef | null>(null)
  /**
   * Whether the rival search has been asked for.
   *
   * Off by default. Discovery is a model call plus a dozen live profile reads,
   * and it fired on every visit to this tab to answer a question whose answer
   * moves about once per election.
   */
  const [showRivals, setShowRivals] = useState(false)

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

  /** Whether a suggested account is already on the tracker. */
  const isTracked = useCallback(
    (s: { platform: Platform; handle: string }) =>
      handles.some((h) => h.id === handleId(s.platform, s.handle)),
    [handles],
  )

  /**
   * Add one account chosen from a name search.
   *
   * Separate from `add` below because the two start from different things: that
   * one parses a string somebody typed and can fail on it, this one already has
   * a platform, a handle and an address that came from the identity lookup. It
   * still goes through the same `saveHandle` + `refresh`, so an account added
   * either way is the same record and cannot be filed twice.
   */
  const addSuggested = useCallback(
    async (s: { platform: Platform; handle: string; url: string; displayName: string | null }, own: boolean) => {
      const created: TrackedHandle = {
        id: handleId(s.platform, s.handle),
        platform: s.platform,
        handle: s.handle,
        displayName: s.displayName,
        profileUrl: s.url,
        avatarUrl: null,
        own,
        label: null,
        listingNote: '',
        snapshots: [],
      }
      setError(null)
      setHandles(saveHandle(created))
      await refresh([created])
    },
    [refresh],
  )

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

  /**
   * Track a discovered rival, so it joins the measured comparison.
   *
   * The platform is read off the URL rather than assumed. This used to file
   * every rival as YouTube and to pass the profile URL where every other call
   * site passes a handle — so a rival whose account is on Facebook was stored
   * under a YouTube id, never collided with the same person added by hand, and
   * was then fetched with the wrong platform's reader.
   */
  const trackRival = useCallback(
    async (r: { name: string; profileUrl: string }) => {
      const ref = r.profileUrl
      if (!ref) return
      const parsed = parseHandleUrl(ref)
      if (!parsed) return
      const created: TrackedHandle = {
        id: handleId(parsed.platform, parsed.handle),
        platform: parsed.platform,
        handle: parsed.handle,
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
      return `${name} gets more out of each follower than everyone here: ${s.engagementRate.toFixed(2)}% against ${others.map((o) => o.r.toFixed(2) + '%').join(' and ')}.`
    }
    const top = others.sort((a, b) => b.r - a.r)[0]!
    return `${top.h.displayName ?? top.h.handle} reaches a larger share of their following: ${top.r.toFixed(2)}% against ${name}'s ${s.engagementRate.toFixed(2)}%. Reach is not the gap; engagement is.`
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
   * Read what the public thinks — from comments where they exist, from the
   * published record where they do not.
   *
   * This button did nothing useful for most offices and it is worth being
   * precise about why. It only ever read comments. Facebook, Instagram and
   * LinkedIn publish no comments to a server without a page access token for a
   * page the office administers, and the offices using this overwhelmingly do
   * not administer their own pages. So the button's own code reached the line
   * that says "analyse a few posts with the link button and they will be read
   * from here", printed it, and stopped. Pressed twice, it printed the same
   * thing twice. It was reported as broken because from the outside it was
   * indistinguishable from broken.
   *
   * The fix is not more platform plumbing — that door is shut and no amount of
   * engineering opens it. It is to answer the question a different way: go and
   * read what has been WRITTEN about the person, which is what anybody
   * researching an opponent would do, and which grounded search does properly
   * against a real index with citations back.
   *
   * So: comments when they are genuinely reachable, because somebody's own
   * words under a post are better evidence than an editorial. The record
   * otherwise. Which one produced the reading is stored on it and shown on
   * screen, because "72% of commenters" and "coverage is broadly favourable"
   * are different claims and an office acting on the second while believing the
   * first will get it wrong.
   */
  const readOpinion = useCallback(
    async (h: TrackedHandle) => {
      setReading(h.id)
      setError(null)
      try {
        // Platforms that publish a post list get crawled. The rest are scored
        // on posts this office has already analysed by hand.
        const crawlable = AUTO.has(h.platform)
        const own = crawlable ? [] : analysedPostsFor(h)
        let standing: Standing | null = null

        if (crawlable || own.length > 0) {
          const res = crawlable
            ? await fetch(`/api/standing?q=${encodeURIComponent(h.profileUrl || h.handle)}`)
            : await fetch('/api/standing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: own, platform: h.platform, handle: h.handle }),
              })
          const j = (await res.json()) as Record<string, unknown>

          // A comment read that returned no comments is not a result. Falling
          // through to the record is right; reporting "0% negative across 0
          // comments" as a finding is not.
          if (res.ok && Number(j['commentsRead'] ?? 0) > 0) {
            standing = {
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
              source: 'comments',
            }
          }
        }

        if (!standing) {
          // The record. Named from the identity when this is the office's own
          // account — the desk knows the seat and the party, and a search that
          // carries them finds the right person rather than a namesake.
          const mine = h.own && identity ? identity : null
          const subject = {
            name: mine?.name ?? h.displayName ?? h.handle,
            role: mine?.role ?? null,
            constituency: mine?.constituency ?? null,
            state: mine?.state ?? null,
            party: mine?.party ?? null,
          }

          setReadingPhase('searching')
          const searched = await fetch('/api/opinion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ step: 'search', ...subject }),
          })
          const found = (await searched.json()) as {
            notes?: string | null
            sources?: { title: string; url: string | null }[]
            error?: string
          }
          if (!searched.ok || found.error || !found.notes) {
            setError(
              found.error ??
                `Nothing readable was found about ${subject.name}. Comments are not available on ${h.platform}, and the search returned nothing usable.`,
            )
            return
          }

          setReadingPhase('structuring')
          const structured = await fetch('/api/opinion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              step: 'structure',
              notes: found.notes,
              sources: found.sources ?? [],
            }),
          })
          const survey = (await structured.json()) as Record<string, unknown>
          if (!structured.ok || survey['error']) {
            setError(String(survey['error'] ?? 'The reading could not be assembled.'))
            return
          }

          standing = standingFromSurvey(survey)
        }

        saveStandingCache(h.id, standing)
        setStandings((prev) => ({ ...prev, [h.id]: standing! }))
      } catch {
        setError('Could not reach the server.')
      } finally {
        setReading(null)
        setReadingPhase(null)
      }
    },
    [identity],
  )


  const own = useMemo(() => handles.filter((h) => h.own), [handles])
  const watched = useMemo(() => handles.filter((h) => !h.own), [handles])

  return (
    <m.div
      className="shell shell-wide stack page-end"
      variants={listStagger}
      initial="hidden"
      animate="show"
    >
      <m.div variants={fadeUp}>
        <PageHeader
          title={mode === 'compare' ? 'Compare' : 'Accounts'}
          subtitle={
            handles.length
              ? `${own.length} yours · ${watched.length} watched`
              : 'Track your handles and the ones you are measured against.'
          }
          actions={
            <Button variant="ghost" onClick={onClose}>
              Back
            </Button>
          }
        />
      </m.div>

      {/* Compare mode had no error slot at all: the only one lives inside the
          accounts-only Add card below, so a failed rival discovery or opinion
          read set state that nothing rendered and the button simply stopped
          spinning. A failure that shows as nothing happening is the failure
          this product exists to prevent. */}
      {mode === 'compare' && error && (
        <m.p
          variants={fadeUp}
          role="alert"
          className="rounded-[--radius-md] border border-[color-mix(in_oklab,var(--neg)_30%,transparent)] bg-[var(--neg-soft)] px-3 py-2 text-sm text-[var(--neg)]"
        >
          {error}
        </m.p>
      )}

      {/* ── Accounts we already believe are theirs ──────────────────────
          Above the paste box, because an office that has just said who they
          are should meet their own accounts before they meet an empty field. */}
      {mode === 'accounts' && store.identity && (
        <m.div variants={fadeUp}>
          <SuggestedAccounts identity={store.identity} onAdded={setHandles} />
        </m.div>
      )}

      {/* ── Add ─────────────────────────────────────────────────────────── */}
      {mode === 'accounts' && (
      <m.div variants={fadeUp}>
        <Card>
          {/* Name first, address second. Most people being tracked here are
              found by name; almost nobody has a rival's channel URL to hand,
              and the box below used to be the only way in. */}
          <FindByName onAdd={addSuggested} isTracked={isTracked} />

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-[var(--rule)]" aria-hidden />
            <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3">
              or paste the address
            </span>
            <span className="h-px flex-1 bg-[var(--rule)]" aria-hidden />
          </div>

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
            do not publish a post list without a login. Those show what we can read, and fill in as
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

      {/* ── One rival, in depth ──────────────────────────────────────────
          Takes over the tab while it is open. The list behind it is a chooser,
          and leaving it on screen under a comparison invites somebody to start
          a second grounded search over the top of the first. */}
      {mode === 'compare' && versus && identity && (
        // Keyed on the opponent, so switching from one comparison to another
        // remounts rather than leaving the previous person's photo and
        // dimensions on screen while the new search runs.
        <HeadToHead
          key={versus.name.toLowerCase()}
          identity={identity}
          rival={versus}
          onClose={() => setVersus(null)}
          onOpenActions={onOpenActions}
        />
      )}

      {/* ── Who to compare against, found rather than typed ───────────────
          Behind a press. Working out who a member is measured against is a
          model call and a dozen live profile reads, and it was running its way
          onto the screen every time the tab was opened — for an answer that
          changes about once an election. */}
      {mode === 'compare' && !versus && primary && !showRivals && (
        <m.section variants={fadeUp}>
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold">
                  Compare {primary.displayName ?? primary.handle} against rivals
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">
                  Finds who this account is actually measured against: a member is compared
                  with other members, not with a national leader. It then reads each one live.
                </p>
              </div>
              <Button size="sm" className="shrink-0" onClick={() => setShowRivals(true)}>
                <Radar size={15} />
                Look for comparisons
              </Button>
            </div>
          </Card>
        </m.section>
      )}

      {mode === 'compare' && !versus && primary && showRivals && (
        <m.section variants={fadeUp}>
          <SectionTitle
            hint={
              rivals
                ? `${rivals.checked} handles were checked against the live platforms; ${rivals.discarded} did not resolve and were dropped.`
                : 'Worked out from who this account belongs to. A head of government is measured against different people than a district legislator.'
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
                                <span className="ml-auto flex items-center gap-1.5">
                                  {/* The one that matters. Tracking an account
                                      compares follower counts; this compares
                                      the two people on the record, which is
                                      the question somebody opened this tab
                                      with. It needs no handle at all — a rival
                                      with no social presence is still a rival,
                                      and the old row could do nothing with
                                      one. */}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={!identity}
                                    onClick={() =>
                                      setVersus({
                                        name: r.name,
                                        state: identity?.state ?? null,
                                        // Everything discovery already knows,
                                        // rather than the name alone. The
                                        // search prompt is built from these,
                                        // and a rival described as "Ramesh
                                        // Kumar in Telangana" against a subject
                                        // carrying role, seat and party is
                                        // searched less well — which then reads
                                        // as thin coverage of him.
                                        why: r.why,
                                        cohort: r.cohort,
                                        followers: r.followers,
                                        platforms: r.platforms,
                                        profileUrl: r.profileUrl,
                                      })
                                    }
                                  >
                                    <Radar size={14} />
                                    Compare
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={tracked || busy != null || !r.profileUrl}
                                    onClick={() => void trackRival(r)}
                                  >
                                    {tracked ? 'Tracked' : 'Track'}
                                  </Button>
                                </span>
                              </div>
                            </li>
                          )
                        })}
                    </ul>
                  </div>
                ))}

                <p className="mt-4 text-xs text-ink-3">
                  Names and reasons come from the model and may be out of date. Every
                  handle above was fetched from the platform, so follower counts are
                  live, and any account that did not resolve was dropped rather than
                  shown.
                </p>
              </>
            )}
          </Card>
        </m.section>
      )}

      {/* ── What people think ───────────────────────────────────────────── */}
      {mode === 'compare' && !versus && compared.length > 0 && (
        <m.section variants={fadeUp}>
          <SectionTitle hint="Read from the comments on each account's recent posts, not from follower counts. This is the measure the other seven cannot give you.">
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
                    <span className="flex shrink-0 items-center gap-1.5">
                      {/*
                        Head to head, from the row the office is already
                        looking at.

                        A Compare button existed, but only inside the rival
                        DISCOVERY list, which appears after paying for a
                        /api/rivals search. So an office that had added its own
                        account and an opponent by hand could see both sitting
                        in this list and had no way to put them against each
                        other. The one question the screen is named for could
                        not be asked from it.

                        Only on the accounts the office does not run: comparing
                        somebody with themselves is not a question.

                        NOTE the disabled test. `busy` inside this map is a
                        different variable from the component-level `busy` and
                        means "this row is reading opinion"; using it here
                        would be wrong but harmless, while using the outer one
                        would disable the button permanently. It is deliberately
                        gated on `identity` alone, which is what HeadToHead
                        actually requires.
                      */}
                      {!h.own && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!identity}
                          title={
                            identity
                              ? `Compare ${identity.name} against ${h.displayName ?? h.handle}`
                              : 'Set up the desk first, so there is somebody to compare against.'
                          }
                          onClick={() =>
                            setVersus({
                              /*
                               * The display name is the best name available.
                               * A tracked handle stores no role, party or seat,
                               * so the search is given less to work with than
                               * a discovered rival gets. The state comes from
                               * the desk, because a rival tracked by this
                               * office is almost always in the same one, and
                               * naming it stops the search wandering to a
                               * namesake in another state.
                               */
                              name: h.displayName ?? h.handle,
                              state: identity?.state ?? null,
                              followers: h.snapshots.at(-1)?.followers ?? null,
                              platforms: [h.platform],
                              profileUrl: h.profileUrl,
                              photoUrl: h.avatarUrl,
                            })
                          }
                        >
                          <GitCompareArrows size={14} />
                          Compare
                        </Button>
                      )}
                      {!st && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || reading != null}
                          onClick={() => void readOpinion(h)}
                        >
                          <MessageSquareHeart size={14} />
                          {busy
                            ? readingPhase === 'searching'
                              ? 'Reading the record…'
                              : readingPhase === 'structuring'
                                ? 'Weighing it up…'
                                : 'Reading comments…'
                            : 'Read opinion'}
                        </Button>
                      )}
                    </span>
                  </div>

                  {st && (
                    <>
                      {/* The score, with its scale attached.
                          A bare "0" beside "read from 10 published sources"
                          reads as "nothing found" — the opposite of what it
                          means, which is that praise and criticism balanced
                          out. "+45" and "−30" carry their own scale; zero is
                          the one value on a signed axis that does not, so it
                          is the one value that has to be told where it sits.
                          A score that was never produced says so instead of
                          borrowing zero's place on the axis. */}
                      <div className="mt-3 flex items-end gap-3">
                        {st.score === null ? (
                          <span className="num text-3xl leading-none text-ink-3">&mdash;</span>
                        ) : (
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
                            {st.score > 0 ? '+' : st.score === 0 ? '±' : ''}
                            {st.score}
                          </span>
                        )}
                        <span className="pb-0.5">
                          <span className="block text-sm text-ink-1">{st.label}</span>
                          <span className="block text-xs text-ink-3">
                            {st.score === null
                              ? 'No score came back for this reading.'
                              : st.source === 'record'
                                ? `On a scale of −100 to +100, from ${st.sources?.length ?? 0} published ${
                                    (st.sources?.length ?? 0) === 1 ? 'source' : 'sources'
                                  }`
                                : `On a scale of −100 to +100, from ${st.commentsRead} comments across ${st.postsRead} posts`}
                          </span>

                          {/* The two sides the score is the difference of.
                              Without these a zero is unreadable: praise 85 /
                              criticism 85 and praise 5 / criticism 5 both come
                              to zero and mean opposite things — a fight, and
                              invisibility. The number answers "which way"; only
                              these answer "how much is being said at all". */}
                          {st.favourable != null && st.hostile != null && (
                            <span className="mt-1 block text-xs text-ink-3">
                              <span className="text-[var(--pos)]">Praise {st.favourable}</span>
                              <span className="px-1.5 text-ink-3">·</span>
                              <span className="text-[var(--neg)]">Criticism {st.hostile}</span>
                              <span className="pl-1.5 text-ink-3">each out of 100</span>
                            </span>
                          )}
                        </span>
                      </div>

                      {/* The split, as one bar. Three numbers in a row would be
                          read as three facts; this reads as one shape.

                          Drawn ONLY for a comment reading. The split comes from
                          counting what individual people wrote, and a reading of
                          published coverage has nothing to count — so a record
                          reading gets no bar rather than a bar derived from its
                          score. That derivation would put an invented
                          percentage in the one place on this card that looks
                          most like a measurement. */}
                      {st.source !== 'record' && (
                        <>
                          <div className="mt-3 flex h-2 overflow-hidden rounded-full">
                            <span style={{ width: `${st.positive}%`, background: 'var(--pos)' }} />
                            <span style={{ width: `${st.neutral}%`, background: 'var(--ink-3)', opacity: 0.35 }} />
                            <span style={{ width: `${st.negative}%`, background: 'var(--neg)' }} />
                          </div>
                          <p className="mt-1.5 text-xs text-ink-3">
                            {st.positive}% positive · {st.neutral}% neutral · {st.negative}% negative
                          </p>
                        </>
                      )}

                      {st.source === 'record' && (
                        <p className="mt-2 text-xs leading-relaxed text-ink-3">
                          {st.caveats?.[0] ??
                            'Read from published coverage, not from a survey of constituents.'}
                        </p>
                      )}

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

      {/* ── Head to head ──────────────────────────────────────────────────
          Accounts only. This block had no mode guard at all, so it rendered
          UNDER an open comparison — putting its engagement-rate verdict
          directly beneath the record verdict from HeadToHead. Two different
          verdict sentences about the same two people, drawn from incompatible
          evidence, one screen apart. It is right where it is; it is only wrong
          on the compare tab. */}
      {mode === 'accounts' && handles.filter((h) => h.snapshots.length).length > 1 && (
        <m.section variants={fadeUp}>
          <SectionTitle hint="Seven measures. An account can lead on reach and lose everywhere else.">
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
              platform does not publish that figure, not that it is zero.
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
              Start with one of these. They are public accounts that read cleanly.
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

      {/* Both of these are about the ACCOUNT comparison, which needs handles.
          A record comparison needs none — it reads two names off the published
          record — so printing "a comparison needs two accounts" underneath a
          completed one contradicts the screen above it. */}
      {handles.length === 0 && mode === 'compare' && !versus && (
        <m.p variants={fadeUp} className="py-8 text-center text-sm text-ink-3">
          Add at least one account under Accounts, then come back here.
        </m.p>
      )}

      {mode === 'compare' && !versus && handles.length > 0 &&
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
