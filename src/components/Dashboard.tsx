import { useCallback, useEffect, useMemo, useState } from 'react'
import * as m from 'motion/react-m'
import {
  Plus,
  RefreshCw,
  Trash2,
  ExternalLink,
  Radar,
  ShieldCheck,
  GitCompareArrows,
  Info,
  AtSign,
  Users,
  Newspaper,
  History,
  MapPin,
  TrendingUp,
  BarChart3,
} from 'lucide-react'
import type { Platform } from '@shared/taxonomy'
import type { Report } from '@shared/types'
import { loadPostReports } from '@/lib/post-reports'
import { Button, Card, Chip, PageHeader, SectionTitle, selectClass } from './ui'
import {
  CardHead,
  DeltaChip,
  HBarBoard,
  IconStat,
  IndiaMap,
  LineChart,
  PlatformBadge,
  PlatformSwitcher,
  PostThumbCard,
  Sparkline,
  seriesColor,
  youtubeThumb,
} from '@/components/kit'
import { INDIA_DOTS, INDIA_BBOX } from './india-dots'
import { geocodePlace } from './gazetteer'
import { SuggestedAccounts } from './SuggestedAccounts'
import { FindByName } from './FindByName'
import { HeadToHead, type RivalRef } from './HeadToHead'
import { CompareBoard } from './CompareBoard'
import { useStore } from '@/lib/store'
import { cn, compact } from '@/lib/utils'
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
  readStandingNote,
  removeHandle,
  addSnapshot,
  handleId,
  statsFor,
  deltaFor,
  type HandleStats,
  type TrackedHandle,
  type TrackedPost,
  standingFromSurvey,
  type RivalCache,
  type Standing,
} from '@/lib/handles'
import { fetchWithTimeout } from '@/lib/net'
import { useBackToDismiss } from '@/lib/nav-history'

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
  n == null ? 'NA' : n.toLocaleString('en-IN')

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
    <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2.5">
      <p className="text-[11px] font-medium text-ink-3">{label}</p>
      <p className="tnum mt-0.5 text-[15px] font-bold text-ink">{value}</p>
    </div>
  )
}

/*
 * The follower history sparkline now comes from the kit. Same discipline as
 * the hand-rolled one it replaced: two readings is enough to draw a line;
 * below that it renders nothing rather than a flat line implying stability
 * nobody measured.
 */

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

/**
 * How many accounts `/api/handle` will read in one request (MAX_HANDLES in
 * netlify/functions/handle.mts). Named here so the client cannot drift past a
 * limit it has no other way to learn about.
 */
const READ_BATCH = 6

export function Dashboard({
  onClose,
  onOpenActions,
  onRead,
  onOpenReport,
  mode = 'accounts',
}: {
  onClose: () => void
  /** Route to the task list, for anything on this screen that files one. */
  onOpenActions?: () => void
  /**
   * Run the full analysis on one post, in the app.
   *
   * Optional, because `compare` mode shows no posts. When absent the post
   * cards simply link out, which is what they did before.
   */
  onRead?: (postUrl: string) => void
  /** Open a reading that already exists, instantly, on the analyse screen. */
  onOpenReport?: (report: Report) => void
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
  /**
   * What the running sync is doing, named rather than counted.
   *
   * A sync spends most of its time waiting on purpose, and the waits are
   * uneven — seconds for YouTube, a minute for Instagram. A bare spinner
   * through that reads as a hang, and the account currently being read is the
   * one fact that explains the pause.
   */
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [rivals, setRivals] = useState<RivalCache | null>(null)
  const [finding, setFinding] = useState(false)
  const [standings, setStandings] = useState<Record<string, Standing>>({})

  /**
   * Why an account has no reading, keyed by handle id.
   *
   * The reader records its own refusal — "only 4 comments across 25 posts,
   * too few to read a mood from" — and that sentence is what turns a blank
   * comparison cell into a finding about the account.
   */
  const standingNotes = useMemo(() => {
    const out: Record<string, string> = {}
    for (const h of handles) {
      const note = readStandingNote(h.id)
      if (note) out[h.id] = note
    }
    return out
  }, [handles])
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
   * Stored full readings, for the dates a scrape did not carry. The compare
   * board windows on post dates, and half the Instagram posts on this desk
   * carry none in the scrape while their reading does.
   */
  const [reports, setReports] = useState<Map<string, Report> | null>(null)
  useEffect(() => {
    let alive = true
    loadPostReports().then(
      (map) => alive && setReports(map),
      () => alive && setReports(new Map()),
    )
    return () => {
      alive = false
    }
  }, [])
  // The head to head takes the whole window, so back closes it rather than
  // leaving the comparison screen.
  useBackToDismiss(versus !== null, useCallback(() => setVersus(null), []))
  /**
   * Whether the rival search has been asked for.
   *
   * Off by default. Discovery is a model call plus a dozen live profile reads,
   * and it fired on every visit to this tab to answer a question whose answer
   * moves about once per election.
   */
  const [showRivals, setShowRivals] = useState(false)
  /**
   * A view filter over the account list, nothing more. It reorders no data
   * and forgets itself on the next visit; it exists so an office tracking a
   * dozen handles can look at one platform at a time.
   */
  const [platformFilter, setPlatformFilter] = useState<Platform | null>(null)

  useEffect(() => setHandles(listHandles()), [])

  /**
   * Read one or more handles and store a snapshot of each.
   *
   * IN BATCHES OF SIX, because that is what `/api/handle` accepts. "Refresh
   * all" handed it the whole desk, so a desk tracking seven accounts got a 400
   * carrying `{ error }` and no `handles` array — the loop below then ran zero
   * times, every card kept its old reading, and nothing on screen said why.
   * The size of the desk silently decided whether the button worked.
   */
  const refresh = useCallback(async (targets: TrackedHandle[]) => {
    if (!targets.length) return
    setBusy(targets.length === 1 ? targets[0]!.id : 'all')
    setError(null)
    try {
      let next = listHandles()
      for (let from = 0; from < targets.length; from += READ_BATCH) {
        const batch = targets.slice(from, from + READ_BATCH)
        const qs = batch.map((h) => `q=${encodeURIComponent(h.profileUrl || h.handle)}`).join('&')
        const res = await fetch(`/api/handle?${qs}`)
        const json = (await res.json()) as { handles?: unknown[]; error?: string }
        // A whole-request refusal, which is not the same as one account that
        // could not be read. It was going unreported entirely.
        if (json.error) {
          setError(json.error)
          continue
        }
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
          const target = batch[i]
          if (!target) continue
          /**
           * A read that failed stores NOTHING.
           *
           * Not a snapshot of nulls — that is a claim that this account was
           * read and found empty, and the card says "Not read yet" over it for
           * ever because nothing retries a finished read. Leaving the handle
           * with no snapshot keeps it honestly unread, and the message says
           * what went wrong so the next press of Refresh is an informed one.
           */
          if (s.error) {
            setError(s.error)
            continue
          }
          const existing = next.find((h) => h.id === target.id)
          if (existing) {
            // The server knows the real handle; the client only had whatever
            // was pasted, which for a URL meant the card read
            // "@https://www.youtu…".
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
      }
      setHandles(next)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }, [])

  /**
   * Ask the server to read every tracked account slowly and keep what it finds.
   *
   * WHY THIS IS A LOOP. A pass is bounded by the function's timeout, and the
   * whole sync is not: Instagram alone costs a minute per account, deliberately,
   * because that pacing is the only reason a gated profile answers at all. So
   * the server does as much as it can in one pass and says how many accounts it
   * did not reach; this calls again until it says none. The first version fired
   * one request, slept two seconds and refreshed — for work measured in
   * minutes, which is why the screen never changed.
   *
   * The device's tracked list travels with the request. It lives in
   * localStorage on purpose (see `src/lib/store.ts`), so the server cannot read
   * it, and pressing this button is what hands it over.
   */
  const syncAll = useCallback(async () => {
    if (!handles.length) return
    setBusy('sync-all')
    setError(null)
    setSyncNote('Starting…')

    // A bound on the loop, not on the work. Twelve passes at ~45s is nine
    // minutes, comfortably past the slowest realistic list; without it a server
    // that always reported one account remaining would spin forever.
    const MAX_PASSES = 12
    let synced = 0

    try {
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        const res = await fetchWithTimeout('/api/batch-track-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            handles: handles.map((h) => ({
              platform: h.platform,
              handle: h.handle,
              name: h.displayName ?? h.handle,
              profileUrl: h.profileUrl,
              own: h.own,
            })),
          }),
        })

        if (!res.ok || !res.body) {
          let message = 'The sync could not be started.'
          try {
            const j = (await res.json()) as { error?: string }
            if (j.error) message = j.error
          } catch {
            /* no JSON body — the generic message stands */
          }
          setError(message)
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let done = false
        let remaining = 0

        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          buffer += decoder.decode(chunk.value, { stream: true })

          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''

          for (const frame of frames) {
            const line = frame.split('\n').find((l) => l.startsWith('data:'))
            if (!line) continue
            let event: Record<string, unknown>
            try {
              event = JSON.parse(line.slice(5).trim()) as Record<string, unknown>
            } catch {
              continue
            }

            if (event['type'] === 'account') {
              synced++
              const posts = typeof event['posts'] === 'number' ? event['posts'] : 0
              // Name the account being read. A count alone cannot tell the
              // reader that the long pause is Instagram behaving normally.
              setSyncNote(
                `${String(event['handle'])}: ${posts} post${posts === 1 ? '' : 's'} (${synced}/${handles.length})`,
              )
            } else if (event['type'] === 'complete') {
              done = event['done'] === true
              remaining = typeof event['remaining'] === 'number' ? event['remaining'] : 0
            } else if (event['type'] === 'error') {
              setError(String(event['message'] ?? 'The sync failed.'))
              return
            }
          }
        }

        if (done) break
        setSyncNote(`${remaining} account${remaining === 1 ? '' : 's'} left. Continuing…`)
      }

      setSyncNote('Reading back what was stored…')
      await refresh(handles)
      setSyncNote(null)
    } catch {
      setError('Could not reach the server. Check your connection.')
    } finally {
      setBusy(null)
    }
  }, [handles, refresh])

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

  /**
   * The account we discover rivals for: the first one marked as yours.
   *
   * No `?? handles[0]` fallback. It meant a desk that had marked nothing as
   * its own discovered rivals for whatever account happened to be first in the
   * list — some other politician entirely — and cached the result under that
   * account's id. Rivals "for you" that are somebody else's rivals is the same
   * class of wrong as totalling their followers as yours.
   */
  const primary = useMemo(() => handles.find((h) => h.own), [handles])

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

  /**
   * Accounts with a reading, yours first — the table's column order.
   *
   * A flat "yours first, take four" cut worked while a desk watched one rival,
   * and broke the moment it watched three: an office running four of its own
   * accounts filled every slot, and the comparison screen listed nobody to
   * compare against. The screen is named for a question it had stopped being
   * able to ask.
   *
   * So the office's own accounts are taken first — all of them, since a desk
   * wants its standing per channel — and then ONE account per rival, their
   * largest. That is the right sample for the question this screen asks: "what
   * do people think of them" is about the person, and their biggest account is
   * where most of the comments are. Four rows per rival would be the same
   * person four times, crowding out the other opponents.
   */
  const compared = useMemo(() => {
    const withReadings = handles.filter((h) => h.snapshots.length > 0)
    const mine = withReadings.filter((h) => h.own)

    const followersOf = (h: TrackedHandle): number =>
      h.snapshots.at(-1)?.followers ?? 0

    // The biggest account for each rival, keyed by who they are.
    const bestPerRival = new Map<string, TrackedHandle>()
    for (const h of withReadings) {
      if (h.own) continue
      const who = h.displayName ?? h.handle
      const held = bestPerRival.get(who)
      if (!held || followersOf(h) > followersOf(held)) bestPerRival.set(who, h)
    }

    const rivals = [...bestPerRival.values()].sort((a, b) => followersOf(b) - followersOf(a))
    return [...mine, ...rivals]
  }, [handles])

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
            : await fetchWithTimeout('/api/standing', {
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
          const searched = await fetchWithTimeout('/api/opinion', {
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
          const structured = await fetchWithTimeout('/api/opinion', {
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

  /**
   * The set the flagship sections read from — the tracked list, narrowed by the
   * channel switcher. A view lens only: it hides rows, never reorders or
   * refetches, and forgets itself on the next visit. When no channel is chosen
   * it is the whole list, so an unfiltered dashboard is byte-for-byte what it
   * was before the switcher existed.
   */
  const shown = useMemo(
    () => (platformFilter ? handles.filter((h) => h.platform === platformFilter) : handles),
    [handles, platformFilter],
  )
  const shownOwn = useMemo(() => shown.filter((h) => h.own).length, [shown])

  /**
   * Where the desk sits, placed on the offline gazetteer — or null when the
   * seat is not one it knows. Honest by construction: an unplaceable name lights
   * no zone rather than guessing a pin somewhere plausible.
   */
  const ground = useMemo(() => {
    if (!identity) return null
    return (
      geocodePlace(identity.constituency) ??
      geocodePlace(identity.district) ??
      geocodePlace(identity.state)
    )
  }, [identity])

  /**
   * Follower history per account on one shared date axis, for the growth chart.
   * Own accounts take the subject colour; watched accounts take the validated
   * series palette, offset past blue so none collides with the subject. Only an
   * account with two placed readings draws a line — a single reading is a dot,
   * not a trend — and the whole card stays hidden until at least one qualifies.
   */
  const growth = useMemo(() => {
    const withHistory = [...shown]
      .filter((h) => h.snapshots.filter((s) => s.followers != null).length >= 2)
      .sort((a, b) => Number(b.own) - Number(a.own))
    if (!withHistory.length) return null
    // One shared time axis: every reading time across the qualifying accounts,
    // ISO strings so a lexical sort is a chronological one. Each account's line
    // spans only its own readings — nulls elsewhere are skipped, never bridged
    // with a value nobody took.
    const times = [
      ...new Set(
        withHistory.flatMap((h) =>
          h.snapshots.filter((s) => s.followers != null).map((s) => s.takenAt),
        ),
      ),
    ].sort()
    let w = 0
    const series = withHistory.map((h) => {
      const byTime = new Map<string, number>()
      for (const s of h.snapshots) if (s.followers != null) byTime.set(s.takenAt, s.followers)
      return {
        name: h.displayName ?? h.handle,
        color: h.own ? 'var(--vs-subject)' : seriesColor(w++ + 1),
        values: times.map((t) => byTime.get(t) ?? null),
      }
    })
    const labels = times.map((t) =>
      new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    )
    return { labels, series }
  }, [shown])

  /**
   * The follower board — one gradient bar per account, brand-badge lead, the
   * desk's own rows emphasised. Counted from the latest reading each account
   * holds; accounts with no follower reading are left off rather than drawn at
   * a zero nobody measured.
   *
   * The desk's own accounts are ALWAYS on it. A plain top-8 cut once produced
   * a board with zero of them — an MP whose largest account ranks ninth among
   * the rivals she watches saw a card about "your accounts" made entirely of
   * other people — so her rows are seated first and the largest watched
   * accounts fill whatever is left, with the whole board then sorted by size.
   */
  const followerBoard = useMemo(() => {
    const readable = shown
      .map((h) => ({ h, followers: statsFor(h.snapshots.at(-1)).followers }))
      .filter((x): x is { h: TrackedHandle; followers: number } => x.followers != null)
      .sort((a, b) => b.followers - a.followers)
    const own = readable.filter((x) => x.h.own)
    const watched = readable.filter((x) => !x.h.own)
    return [...own, ...watched.slice(0, Math.max(0, 8 - own.length))].sort(
      (a, b) => b.followers - a.followers,
    )
  }, [shown])

  /**
   * The headline figures, added up from readings already on this device.
   * Nothing here is fetched and nothing is estimated — it is the tracked
   * list, counted. Deltas are deliberately absent: a change needs two
   * readings of the same total to exist before it can be claimed, and no
   * such total is stored.
   */
  const kpis = useMemo(() => {
    const latest = shown.map((h) => statsFor(h.snapshots.at(-1)))
    const followerCounts = latest
      .map((s) => s.followers)
      .filter((v): v is number => v != null)
    return {
      totalFollowers: followerCounts.length
        ? followerCounts.reduce((a, b) => a + b, 0)
        : null,
      withFollowers: followerCounts.length,
      postsRead: latest.reduce((a, s) => a + s.posts, 0),
      readingsKept: shown.reduce((a, h) => a + h.snapshots.length, 0),
    }
  }, [shown])

  /**
   * The most engaging posts across every latest reading, ranked by the
   * interactions the platforms actually publish. Posts whose likes and
   * comments are both unpublished sink to the end rather than pretending
   * to a zero nobody measured.
   */
  const topPosts = useMemo(() => {
    const rows: { post: TrackedPost; handle: TrackedHandle; interactions: number; measured: boolean }[] = []
    for (const h of shown) {
      for (const p of h.snapshots.at(-1)?.posts ?? []) {
        rows.push({
          post: p,
          handle: h,
          interactions: (p.likes ?? 0) + (p.comments ?? 0),
          measured: p.likes != null || p.comments != null,
        })
      }
    }
    /**
     * Rank by interactions, but give every channel a place on the strip.
     *
     * Sorting on interactions alone silently deleted a whole platform. YouTube
     * publishes a view count and no likes or comments, so every video scored
     * zero and none of the twenty-five ever reached a strip of eight — the
     * channel was scraped, counted in the follower totals, and then invisible
     * wherever posts are actually shown.
     *
     * So the best post from each platform leads, and the rest of the strip
     * fills by rank. Nothing is invented to achieve it: a video's views are not
     * converted into pretend likes, and `measured` still tells the card to say
     * "interactions not published" rather than implying a zero.
     */
    /**
     * Anything with neither a picture nor a caption sorts last, whatever it
     * scored. A few Facebook records carry an engagement figure and no
     * readable content at all; they belong in the totals, which are computed
     * from them, but a tile with nothing on it should never outrank a post
     * that can actually be read.
     */
    const showable = (r: (typeof rows)[number]): boolean =>
      Boolean(r.post.thumbnailUrl) ||
      Boolean(r.post.title?.trim()) ||
      r.handle.platform === 'YouTube'

    rows.sort((a, b) => {
      if (showable(a) !== showable(b)) return showable(a) ? -1 : 1
      if (a.measured !== b.measured) return a.measured ? -1 : 1
      if (a.measured) return b.interactions - a.interactions
      return (b.post.views ?? 0) - (a.post.views ?? 0)
    })

    // Keyed by platform AND side, so a rival's YouTube does not stand in for
    // the office's own.
    const seen = new Set<string>()
    const lead: typeof rows = []
    const rest: typeof rows = []
    for (const r of rows) {
      const key = `${r.handle.platform}:${r.handle.own ? 'own' : 'rival'}`
      if (seen.has(key)) rest.push(r)
      else {
        seen.add(key)
        lead.push(r)
      }
    }
    return [...lead, ...rest].slice(0, 14)
  }, [shown])

  /**
   * The same posts, split by side.
   *
   * One merged list was the wrong shape for a screen whose whole job is
   * comparison: a rival with a larger following takes every slot, and the
   * office's own best post is off the end of the strip. Ranked within each
   * side and shown as two rows, so both are legible at once — and a side with
   * nothing stored says so rather than silently vanishing.
   */
  const topPostsOwn = useMemo(() => topPosts.filter((r) => r.handle.own).slice(0, 6), [topPosts])
  const topPostsRivals = useMemo(() => topPosts.filter((r) => !r.handle.own).slice(0, 6), [topPosts])

  /** The platforms actually present in the list, for the channel switcher. */
  const platformsTracked = useMemo(
    () => [...new Set(handles.map((h) => h.platform))],
    [handles],
  )

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

      {/* ── Channel switcher ─────────────────────────────────────────────
          The circle-badge lens from the reference boards. Client-side only:
          it narrows the flagship sections and the account list to one channel
          at a time and drives nothing but that view state. */}
      {mode === 'accounts' && platformsTracked.length > 1 && (
        /* Full-bleed and free to scroll sideways on a phone: many channels
           simply do not fit 375px. The gutter padding plus the mask fade at
           each edge is what says "there is more" without a scrollbar; py gives
           the active ring room so it is not clipped by the scroll clip box. */
        <m.div
          variants={fadeUp}
          className="bleed -mt-1 flex items-center gap-3 overflow-x-auto py-1.5 [mask-image:linear-gradient(to_right,transparent,black_var(--gutter),black_calc(100%_-_var(--gutter)),transparent)]"
        >
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
            Channels
          </span>
          <PlatformSwitcher
            className="shrink-0"
            platforms={platformsTracked}
            active={platformFilter}
            onChange={(p) => setPlatformFilter(p as Platform | null)}
          />
        </m.div>
      )}

      {/* ── The headline numbers ─────────────────────────────────────────
          Counted from the readings this device already holds. No delta chips:
          a change needs two readings of the same total before it can be
          claimed, and these totals are computed fresh each visit. */}
      {mode === 'accounts' && handles.length > 0 && (
        <m.div variants={fadeUp} className="grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-4">
          <IconStat
            icon={<AtSign size={18} />}
            label="Accounts tracked"
            value={shown.length}
            tint="blue"
            deltaLabel={`${shownOwn} yours · ${shown.length - shownOwn} watched`}
          />
          <IconStat
            icon={<Users size={18} />}
            label="Total followers"
            value={kpis.totalFollowers}
            tint="violet"
            hero={kpis.totalFollowers != null}
            deltaLabel={
              kpis.withFollowers === 0
                ? 'No follower reading yet. Refresh to take one.'
                : kpis.withFollowers < shown.length
                  ? `Across the ${kpis.withFollowers} of ${shown.length} accounts with a reading`
                  : 'Across every account shown'
            }
          />
          <IconStat
            icon={<Newspaper size={18} />}
            label="Posts read"
            value={kpis.postsRead}
            tint="teal"
            deltaLabel="From the latest reading of each account"
          />
          <IconStat
            icon={<History size={18} />}
            label="Readings kept"
            value={kpis.readingsKept}
            tint="orange"
          />
        </m.div>
      )}

      {/* ── Where this desk sits ─────────────────────────────────────────
          The map that replaced the flat "where she's from" line. Lights the
          seat when the offline gazetteer knows it, and — when it does not —
          shows the dotted country with nothing pinned rather than a guessed
          dot, because a full-looking map is not worth a placed lie. */}
      {mode === 'accounts' && (
        <m.section variants={fadeUp}>
          <Card>
            {/* The kit's standard card opening. The identity chips would crush
                the title from CardHead's shrink-0 action slot on a 375px
                screen, so they get their own wrapping row beneath instead. */}
            <CardHead
              icon={<MapPin size={16} />}
              tint="blue"
              title={ground ? `Your ground: ${ground.name}` : identity ? 'Your ground' : 'Where this desk sits'}
              sub={identity ? undefined : 'Set who this desk is for.'}
            />
            {identity && (identity.role || identity.party || identity.state) && (
              <div className="-mt-1 mb-4 flex flex-wrap items-center gap-1.5">
                {identity.role && <Chip tone="accent">{identity.role}</Chip>}
                {identity.party && <Chip>{identity.party}</Chip>}
                {identity.state && <Chip>{identity.state}</Chip>}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-[1.5fr_1fr] sm:items-start">
              <div className="rounded-2xl bg-[var(--surface-2)] p-3">
                <IndiaMap
                  dots={INDIA_DOTS}
                  bbox={INDIA_BBOX}
                  zones={ground ? [{ lon: ground.lon, lat: ground.lat, radiusDeg: 1.2, label: ground.name }] : []}
                />
              </div>
              <div className="space-y-3">
                {ground ? (
                  <>
                    <div className="rounded-2xl bg-[var(--surface-2)] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                        Home ground
                      </p>
                      <p className="mt-1 text-[17px] font-bold text-ink">{ground.name}</p>
                      <p className="mt-0.5 text-sm text-ink-3">{ground.state}</p>
                      {(identity?.role || identity?.party) && (
                        <p className="mt-2 text-xs leading-relaxed text-ink-2">
                          {[identity?.role, identity?.party].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    {/* The short column would otherwise leave a strip of dead
                        white beside the tall map, so the honesty of the pin
                        gets said out loud instead of left in a code comment. */}
                  </>
                ) : identity ? (
                  <div className="flex items-start gap-2.5 rounded-2xl bg-[var(--surface-2)] p-4">
                    <Info size={14} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
                    <p className="text-xs leading-relaxed text-ink-3">
                      {identity.constituency || identity.district || identity.state
                        ? `${identity.constituency ?? identity.district ?? identity.state} is not on the map yet.`
                        : 'No seat is set for this desk yet.'}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-[var(--surface-2)] p-4">
                    <p className="text-[15px] font-semibold text-ink">No person set yet</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-3">
                      Set who this desk is for.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </m.section>
      )}

      {/* The "Growth across your accounts" line chart that sat here is gone
          at the owner's request; the dashboard's growth card carries the same
          readings as plain deltas. */}

      {/* ── Followers across your accounts ───────────────────────────────
          The gradient board from the reference, brand-badge leads, the desk's
          own rows emphasised. Follower counts only — the one figure every
          platform publishes — so no account is drawn at a number it never gave. */}
      {mode === 'accounts' && followerBoard.length > 1 && (
        <m.section variants={fadeUp}>
          <Card>
            <CardHead
              icon={<BarChart3 size={16} />}
              tint="teal"
              title="Followers, yours against theirs"
              sub="The latest reading each account holds, largest first. Your rows are highlighted."
            />
            <div className="mt-1">
              <HBarBoard
                rows={followerBoard.map(({ h, followers }) => ({
                  label: h.displayName ?? h.handle,
                  value: followers,
                  lead: <PlatformBadge platform={h.platform} size={28} />,
                  emphasis: h.own,
                }))}
                formatValue={(n) => compact(n)}
              />
            </div>
          </Card>
        </m.section>
      )}

      {/* Compare mode had no error slot at all: the only one lives inside the
          accounts-only Add card below, so a failed rival discovery or opinion
          read set state that nothing rendered and the button simply stopped
          spinning. A failure that shows as nothing happening is the failure
          this product exists to prevent. */}
      {mode === 'compare' && error && (
        <m.p
          variants={fadeUp}
          role="alert"
          className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--neg)_30%,transparent)] bg-[var(--neg-soft)] px-3 py-2 text-sm text-[var(--neg)]"
        >
          {error}
        </m.p>
      )}

      {/* ── Accounts we already believe are theirs ──────────────────────
          Above the paste box, because an office that has just said who they
          are should meet their own accounts before they meet an empty field. */}
      {mode === 'accounts' && store.identity && (
        <m.div variants={fadeUp}>
          {/* `onAdded` hands back what it just created, and those get read
              immediately — every other add path on this screen already does
              (`refresh([created])` below). This one did not, so the accounts a
              desk adds on its very first visit, from the suggestions for the
              person it just named, were saved with no snapshot and never
              fetched. That is the "NA / Not read yet" a fresh desk opens on. */}
          <SuggestedAccounts
            identity={store.identity}
            onAdded={(all, created) => {
              setHandles(all)
              if (created.length) void refresh(created)
            }}
          />
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

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-[var(--rule)]" aria-hidden />
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
              or paste the address
            </span>
            <span className="h-px flex-1 bg-[var(--rule)]" aria-hidden />
          </div>

          <label
            className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3"
            htmlFor="handle-input"
          >
            Profile link or handle
          </label>
          {/* Stacked on a phone, one row from sm up. Sharing 343px between a
              URL input, a platform picker and two labelled buttons left the
              input too narrow to show the address being pasted into it. */}
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="handle-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="youtube.com/@channel  ·  bsky.app/profile/…  ·  @handle"
              className="min-h-11 w-full min-w-0 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm text-ink shadow-[var(--e1)] outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)] sm:flex-1"
            />
            <select
              aria-label="Platform, used when you type a bare handle"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform)}
              className={cn(selectClass, 'w-full sm:w-auto')}
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              onClick={() => void add(true)}
              disabled={!input.trim()}
              size="sm"
              className="w-full sm:w-auto"
            >
              <Plus size={14} /> Add as mine
            </Button>
            <Button
              variant="outline"
              onClick={() => void add(false)}
              disabled={!input.trim()}
              size="sm"
              className="w-full sm:w-auto"
            >
              <Plus size={14} /> Add as competitor
            </Button>
          </div>
          {error && (
            <p className="mt-3 text-sm text-[var(--neg)]" role="alert">
              {error}
            </p>
          )}
          <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-[var(--surface-2)] px-3.5 py-3">
            <Info size={14} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
            <p className="text-xs leading-relaxed text-ink-3">
              Some platforms show followers only.
            </p>
          </div>
        </Card>
      </m.div>
      )}

      {mode === 'accounts' && handles.length > 0 && (
        <m.div variants={fadeUp} className="flex flex-wrap items-center justify-end gap-2">
          {/* The running commentary sits beside the button rather than
              replacing its label, so the account being read stays legible
              while the button keeps saying what it is doing. On a phone it
              takes its own full line above the buttons instead of squeezing
              a long handle name against them. */}
          {syncNote && (
            <span
              className="w-full min-w-0 text-left text-xs text-ink-3 tabular-nums sm:w-auto sm:flex-1 sm:text-right"
              aria-live="polite"
            >
              {syncNote}
            </span>
          )}
          <Button
            size="sm"
            onClick={() => void syncAll()}
            disabled={busy != null}
            title="A slow full read. Takes minutes."
          >
            <RefreshCw size={14} className={busy === 'sync-all' ? 'animate-spin' : ''} />
            {busy === 'sync-all' ? 'Syncing…' : 'Sync now'}
          </Button>
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

      {/* ── The comparison table ─────────────────────────────────────────
          The primary content of this tab: the subject's column first, one
          column per watched person, and a chip row that adds and removes
          columns. It replaces the card stack that used to live here, which
          made the reader hold four readings in their head to compare two
          people. The table reuses this component's data outright: the same
          `handles`, the same cached `standings`, and the same readOpinion
          plumbing drive both modes, so there is exactly one version of every
          number. */}
      {mode === 'compare' && !versus && handles.length > 0 && (
        <m.section variants={fadeUp}>
          <CompareBoard
            handles={handles}
            identity={identity}
            standings={standings}
            notes={standingNotes}
            reports={reports}
            onAddCompetitor={() => setShowRivals(true)}
            onOpenPost={(url) => {
              // A post read once is read forever: the stored reading opens
              // with no model call, and only an unread post starts one.
              const stored = reports?.get(url)
              if (stored && onOpenReport) onOpenReport(stored)
              else onRead?.(url)
            }}
            onUntrack={(person, theirs) => {
              if (
                !window.confirm(
                  `Stop tracking ${person.name}? Their ${theirs.length} ${
                    theirs.length === 1 ? 'account' : 'accounts'
                  } and every reading taken of them are removed from this desk.`,
                )
              ) {
                return
              }
              let next = handles
              for (const h of theirs) next = removeHandle(h.id)
              setHandles(next)
            }}
          />
        </m.section>
      )}

      {/* ── Who to compare against, found rather than typed ───────────────
          Behind a press. Working out who a member is measured against is a
          model call and a dozen live profile reads, and it was running its way
          onto the screen every time the tab was opened — for an answer that
          changes about once an election. */}
      {mode === 'compare' && !versus && primary && !showRivals && (
        <m.section variants={fadeUp}>
          <Card>
            {/* The button stays below the copy rather than in CardHead's
                action slot: "Look for comparisons" is ~180px wide and would
                crush the title to a few letters on a 375px screen. */}
            <CardHead
              icon={<Radar size={16} />}
              tint="violet"
              title={`Compare ${primary.displayName ?? primary.handle} against rivals`}
            />
            <Button size="sm" className="mt-3" onClick={() => setShowRivals(true)}>
              <Radar size={15} />
              Look for comparisons
            </Button>
          </Card>
        </m.section>
      )}

      {mode === 'compare' && !versus && primary && showRivals && (
        <m.section variants={fadeUp}>
          <SectionTitle
            hint={rivals ? `${rivals.checked} checked · ${rivals.discarded} dropped` : undefined}
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
                    className="ml-auto min-h-11 text-xs font-medium text-ink-3 underline decoration-dotted hover:text-ink"
                  >
                    {finding ? 'checking…' : 'redo'}
                  </button>
                </div>

                {/* Grouped by cohort, because "compared against" means different
                    things at once: the same office, the same seat, the same
                    trade. Flattening them into one list loses the reason. */}
                {[...new Set(rivals.rivals.map((r) => r.cohort))].map((cohort) => (
                  <div key={cohort} className="mt-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                      {cohort}
                    </p>
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
                              className="rounded-2xl bg-[var(--surface-2)] p-4"
                            >
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <span className="text-sm font-semibold text-ink">{r.name}</span>
                                <span className="tnum text-xs text-ink-3">
                                  {r.followers != null
                                    ? `${r.followers.toLocaleString('en-IN')} followers`
                                    : 'NA'}
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
              </>
            )}
          </Card>
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
          <SectionTitle>Head to head</SectionTitle>
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
                  <div key={measure.label} className="rounded-2xl bg-[var(--surface-2)] p-4">
                    <p className="text-sm font-semibold text-ink">{measure.label}</p>
                    <p className="mt-0.5 text-xs text-ink-3">{measure.note}</p>
                    <div className="mt-3 space-y-2.5">
                      {compared.map((h, i) => {
                        const v = vals[i]
                        const leads = v != null && best != null && v === best
                        return (
                          <div key={h.id}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-ink-2">
                                <PlatformBadge platform={h.platform} size={16} />
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
                                  'tnum shrink-0 text-sm',
                                  leads ? 'font-bold text-[var(--accent)]' : 'font-medium text-ink',
                                )}
                              >
                                {v == null ? 'NA' : measure.fmt(v)}
                              </span>
                            </div>
                            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: peak > 0 && v != null ? `${(Math.abs(v) / peak) * 100}%` : '0%',
                                  background: leads ? 'var(--grad-blue)' : 'var(--border-strong)',
                                  opacity: leads ? 1 : 0.7,
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
            {verdict && (
              <p className="mt-4 rounded-xl bg-[var(--accent-soft)] px-4 py-3 text-sm font-medium leading-relaxed text-ink">
                {verdict}
              </p>
            )}
          </Card>
        </m.section>
      )}

      {/* ── Most engaging posts ─────────────────────────────────────────
          The strip from the reference boards, filled honestly: YouTube names
          its own thumbnail, and every other platform gets the brand-tinted
          fallback rather than an image we do not have. Ranked by the
          interactions the platforms actually publish. */}
      {mode === 'accounts' && topPosts.length > 0 && (
        <m.section variants={fadeUp}>
          <SectionTitle hint="Ranked by likes and comments.">
            Most engaging posts
          </SectionTitle>
          <div className="space-y-4">
            {[
              { key: 'own', label: 'Yours', rows: topPostsOwn, tone: 'var(--vs-subject)' },
              { key: 'rivals', label: 'Who you are watching', rows: topPostsRivals, tone: 'var(--vs-rival)' },
            ]
              .filter((side) => side.rows.length > 0)
              .map((side) => (
                <div key={side.key}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: side.tone }} aria-hidden />
                    <p className="eyebrow">{side.label}</p>
                    <span className="text-[11px] text-ink-3">
                      {side.rows.length} {side.rows.length === 1 ? 'post' : 'posts'}
                    </span>
                  </div>
                  <div className="bleed flex gap-4 overflow-x-auto pb-2">
                    {side.rows.map(({ post, handle, interactions, measured }) => (
                      /* 150px at base, the kit's own width from sm up. At the
                         kit's 160px a 375px screen fits exactly two cards with
                         a 7px sliver of the third — invisible, so the row read
                         as complete. 150px leaves a ~27px peek that says
                         "scroll me". */
                      <PostThumbCard
                        className="w-[150px]"
                        key={`${handle.id}:${post.url}`}
                        thumbnailUrl={
                          post.thumbnailUrl ??
                          (handle.platform === 'YouTube' ? youtubeThumb(post.url) : null)
                        }
                        platform={handle.platform}
                        author={handle.displayName ?? handle.handle}
                        title={post.title}
                        metaLine={
                          measured
                            ? `${compact(interactions)} interactions${post.views != null ? ` · ${compact(post.views)} views` : ''}`
                            : post.views != null
                              ? `${compact(post.views)} views`
                              : 'Interactions not published'
                        }
                        href={post.url}
                        {...(onRead ? { onAnalyse: () => onRead(post.url) } : {})}
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </m.section>
      )}

      {/* The channel lens now lives in the header (PlatformSwitcher), where it
          narrows the whole screen at once. The account list reads the same
          `platformFilter` it always did — client-side only, hiding rows,
          reordering and refetching nothing. */}

      {/* ── The accounts ────────────────────────────────────────────────── */}
      {(mode === 'compare' ? [] : [
        { title: 'Your accounts', rows: own.filter((h) => !platformFilter || h.platform === platformFilter) },
        { title: 'Who you are watching', rows: watched.filter((h) => !platformFilter || h.platform === platformFilter) },
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
                const sparkValues = h.snapshots
                  .map((x) => x.followers)
                  .filter((f): f is number => f != null)
                const rising = (sparkValues.at(-1) ?? 0) >= (sparkValues[0] ?? 0)
                return (
                  <Card key={h.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="relative shrink-0">
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
                              className="size-11 rounded-full object-cover ring-1 ring-[var(--border)]"
                            />
                          ) : (
                            <span className="grid size-11 place-items-center rounded-full bg-[var(--surface-3)] text-[15px] font-bold text-ink-3">
                              {(h.displayName ?? h.handle).replace(/^@/, '').charAt(0).toUpperCase()}
                            </span>
                          )}
                          <PlatformBadge
                            platform={h.platform}
                            size={18}
                            className="absolute -bottom-0.5 -right-0.5 ring-2 ring-[var(--surface)]"
                          />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-bold text-ink">
                            {h.displayName ?? h.handle}
                          </span>
                          <span className="block truncate text-xs font-medium text-ink-3">
                            {h.platform} · @{h.handle.replace(/^@/, '')}
                          </span>
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center">
                        {h.profileUrl && (
                          <a
                            href={h.profileUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="grid size-11 place-items-center rounded-full text-ink-3 transition-colors hover:bg-[var(--surface-2)] hover:text-ink"
                            aria-label={`Open ${h.handle} on ${h.platform}`}
                          >
                            <ExternalLink size={16} />
                          </a>
                        )}
                        <button
                          onClick={() => void refresh([h])}
                          disabled={busy != null}
                          className="grid size-11 place-items-center rounded-full text-ink-3 transition-colors hover:bg-[var(--surface-2)] hover:text-ink disabled:opacity-45"
                          aria-label={`Refresh ${h.handle}`}
                        >
                          <RefreshCw size={16} className={busy === h.id ? 'animate-spin' : ''} />
                        </button>
                        <button
                          onClick={() => setHandles(removeHandle(h.id))}
                          className="grid size-11 place-items-center rounded-full text-ink-3 transition-colors hover:bg-[var(--neg-soft)] hover:text-[var(--neg)]"
                          aria-label={`Stop tracking ${h.handle}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    {/* The headline figure, with the shape of its history
                        beside it. Movement is only shown once there are two
                        readings to compare — a "0%" change on a first refresh
                        would be an invention, not a measurement. */}
                    <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-ink-3">Followers</p>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="tnum text-[28px] font-bold leading-none tracking-[-0.02em] text-ink">
                            {fmt(s.followers)}
                          </span>
                          {d.followers != null && d.followers !== 0 && (
                            <DeltaChip
                              value={d.followers}
                              suffix=""
                              title={`Since the reading ${ago(d.since)}`}
                            />
                          )}
                        </div>
                      </div>
                      {sparkValues.length >= 2 && (
                        <div className="min-w-28 max-w-[220px] flex-1">
                          <Sparkline
                            values={sparkValues}
                            color={rising ? 'var(--pos)' : 'var(--neg)'}
                            height={40}
                          />
                        </div>
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Tile label="Followers" value={fmt(s.followers)} />
                      <Tile label="Posts read" value={fmt(s.posts)} />
                      <Tile label="Per post" value={fmt(s.avgEngagement)} />
                      <Tile
                        label="Engagement"
                        value={s.engagementRate != null ? `${s.engagementRate.toFixed(2)}%` : 'NA'}
                      />
                    </div>

                    {(d.followers != null || d.avgEngagement != null) && (
                      <div className="tnum mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
                        {d.followers != null && d.followers !== 0 && (
                          <span>
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
                      <p className="mt-3 text-xs text-ink-3">
                        About {s.postsPerWeek} posts a week.
                      </p>
                    )}

                    {/* The gated-platform note. This copy is the product's
                        honesty about what it can and cannot read — it gets a
                        quiet room of its own, never the bin. */}
                    {!auto && h.listingNote && (
                      <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-[var(--surface-2)] px-3.5 py-3">
                        <Info size={14} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
                        <p className="text-xs leading-relaxed text-ink-3">{h.listingNote}</p>
                      </div>
                    )}

                    <p className="mt-3 text-xs text-ink-3">
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
            <CardHead
              icon={<Users size={16} />}
              tint="blue"
              title="Nothing tracked yet"
              sub="Start with one of these"
            />
            <ul className="mt-3 space-y-2">
              {[
                { url: 'https://www.youtube.com/@narendramodi', label: 'Narendra Modi', note: 'YouTube · 3.13 crore', platform: 'YouTube' },
                { url: 'https://www.facebook.com/narendramodi/', label: 'Narendra Modi', note: 'Facebook · 6.2 crore, followers only', platform: 'Facebook' },
                { url: 'https://www.youtube.com/@PMOIndia', label: 'PMO India', note: 'YouTube · 22 lakh', platform: 'YouTube' },
              ].map((ex) => (
                <li key={ex.url}>
                  <button
                    onClick={() => setInput(ex.url)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
                  >
                    <PlatformBadge platform={ex.platform} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{ex.label}</span>
                      <span className="block truncate text-xs text-ink-3">{ex.note}</span>
                    </span>
                    <Plus size={16} className="shrink-0 text-ink-3" />
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
        <m.section variants={fadeUp}>
          <Card>
            <CardHead
              icon={<GitCompareArrows size={16} />}
              tint="blue"
              title="Nothing to compare yet"
            />
            <p className="text-sm leading-relaxed text-ink-2">
              Add an account under Accounts first.
            </p>
            <Button className="mt-3" size="sm" variant="outline" onClick={onClose}>
              Back to accounts
            </Button>
          </Card>
        </m.section>
      )}

      {/* The old "not enough read to compare" card is gone on purpose: the
          table above renders with any tracked account and says per cell what
          is missing and how to fill it, which is more useful than a wall. */}
    </m.div>
  )
}
