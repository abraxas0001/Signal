import { useCallback, useEffect, useRef, useState } from 'react'
import { isDemoScope, readStore, update, useStore } from '@/lib/store'
import { planDesk, applyDeskPlan, planTerms } from '@/lib/autoconfig'
import { resolvePlace } from '@shared/places'
import { pruneMentions } from '@shared/grievance'
import { fetchWithTimeout } from '@/lib/net'

/**
 * The scan that runs without being asked.
 *
 * Setting the desk up wrote a configuration and then sat there. An office
 * picked their member, watched the app say it would read eight papers for
 * Mahabubnagar, landed on the dashboard — and found every section empty, with
 * buttons inviting them to go and run things. Configuring is not the same as
 * doing, and from the reader's chair the difference is invisible: the product
 * had told them it was set up, so an empty screen read as "nothing is
 * happening", which is the one thing it must never say when it does not know.
 *
 * So the desk now reads the papers by itself, once a morning.
 *
 * WHAT IT RUNS AND WHAT IT DOES NOT, because the difference is money.
 *
 * `find` reads each masthead's index page and returns the stories whose
 * headline or address carries one of the desk's words. It calls no model at
 * all — it is a handful of page fetches, and it is safe to run on a timer.
 *
 * `analyse` is two model calls per story. It is NOT run automatically, ever. An
 * office that opens the app four times a day would spend its provider's whole
 * free tier before lunch, and the result would be the same stories read four
 * times. Found stories are surfaced with a count and read on request.
 *
 * That split is also the honest one: finding is a claim about what exists, and
 * an office can check it against the headline. Reading is a claim about what a
 * story means, and nobody should be spending a model's opinion on their behalf
 * without being asked.
 */

/**
 * When the day's papers are considered out: 07:30, local time.
 *
 * This replaced a rolling six-hour window, which was the wrong shape for the
 * job. A rolling window drifts: scan at 21:00 and the next automatic read is
 * due at 03:00, so a desk opened at 07:00 was shown last night's stories under
 * today's date. Nobody reads a morning briefing on a schedule set by when they
 * last happened to open the app.
 *
 * A boundary does not drift. Everything before 07:30 belongs to yesterday's
 * reading; the first open after it gets a fresh one, and every open after that
 * reuses it until tomorrow.
 */
const SCAN_HOUR = 7
const SCAN_MINUTE = 30

/**
 * The most recent 07:30 that has already passed.
 *
 * Local time on purpose. The office reads the Telugu papers over breakfast in
 * Mahabubnagar, and a UTC boundary would fire that reading at one in the
 * afternoon.
 */
export function lastScanBoundary(now: Date = new Date()): Date {
  const boundary = new Date(now)
  boundary.setHours(SCAN_HOUR, SCAN_MINUTE, 0, 0)
  // Before this morning's boundary, the one that governs is yesterday's.
  if (boundary.getTime() > now.getTime()) boundary.setDate(boundary.getDate() - 1)
  return boundary
}

/** Whether a scan taken at `iso` is still today's reading. */
export function scanIsCurrent(iso: string | null, now: Date = new Date()): boolean {
  if (!iso) return false
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return false
  return at >= lastScanBoundary(now).getTime()
}

/** Bound on what is kept, so the store cannot grow without limit. */
const MAX_CANDIDATES = 60

/**
 * How long a reading of the local accounts stays fresh.
 *
 * Twice a day. Longer than the paper scan because it costs far more — a live
 * fetch and a model call per account against a handful of page reads — and
 * because these channels post a few times a day, so a shorter interval would
 * pay full price to be told the same thing.
 */
const INFLUENCER_FRESH_MS = 12 * 60 * 60 * 1000

/**
 * How many accounts one run reads, taken by reach.
 *
 * A channel with two million subscribers moves a constituency and one with four
 * hundred does not. When only some can be read, it should be the ones people
 * are actually watching.
 */
const MAX_ACCOUNTS_PER_RUN = 6

export interface ScanState {
  /** The local accounts are being read right now. */
  influencersBusy: boolean
  /** Running right now. */
  busy: boolean
  /** When the last scan finished, from the store. */
  lastAt: string | null
  /** Why the desk is not scanning, when it is not. Null when it is fine. */
  blocked: string | null
  error: string | null
  /** Per-masthead outcome from the last run, so a dead source is visible. */
  sources: { portal: string; found: number; error: string | null }[]
  notes: string[]
}

interface FindResponse {
  candidates?: { url?: unknown; title?: unknown; portal?: unknown }[]
  sources?: { portal?: unknown; url?: unknown; found?: unknown; error?: unknown }[]
  notes?: unknown[]
  error?: string
}

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null

/**
 * Read the papers for this desk.
 *
 * Never throws. This runs unattended on a screen somebody is reading, so every
 * failure has to end as a sentence in `blocked` or `error` rather than as an
 * unhandled rejection that takes the dashboard down.
 */
export function useMorningScan(): ScanState & { run: (force?: boolean) => void } {
  const store = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sources, setSources] = useState<ScanState['sources']>([])
  const [notes, setNotes] = useState<string[]>([])

  // One run at a time, and never a second on a re-render. React will mount this
  // twice in development, and two concurrent scans of eight mastheads is both
  // pointless and rude to the publishers.
  const running = useRef(false)
  const seeding = useRef(false)
  const sourcing = useRef(false)
  const reading = useRef(false)
  const [influencersBusy, setInfluencersBusy] = useState(false)

  const identity = store.identity
  const profile = store.profile
  const lastAt = store.lastScanAt ?? null

  /* ── can this desk scan at all? ────────────────────────────────────────── */

  const blocked = ((): string | null => {
    if (!identity) return 'This desk has not been told who it is for.'
    const portals = profile?.portals ?? []
    const custom = profile?.customPortalUrls ?? []
    if (portals.length === 0 && custom.length === 0) {
      return 'No mastheads are selected, so there is nothing to read.'
    }
    if ((profile?.watchTerms ?? []).length === 0) {
      return 'No search words are set, so every story would match or none would.'
    }
    return null
  })()

  const run = useCallback(
    (force = false) => {
      if (running.current) return

      const current = readStore()
      const person = current.identity
      const desk = current.profile
      if (!person || !desk) return

      const portals = desk.portals ?? []
      const custom = desk.customPortalUrls ?? []
      if (portals.length === 0 && custom.length === 0) return

      // Today's reading already exists unless we are past a boundary it predates.
      if (!force && scanIsCurrent(current.lastScanAt ?? null)) return

      running.current = true
      setBusy(true)
      setError(null)

      void (async () => {
        try {
          const res = await fetchWithTimeout('/api/persona', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              action: 'find',
              persona: person.name,
              /*
                The person and their patch — never the party.

                Sending the whole watch list returned twenty-four stories for a
                Gadwal MLA, nineteen of them national BJP items that mentioned
                her nowhere. A member shown "24 stories mention you" above a
                list where none do learns within a week that the number means
                nothing, and then misses the morning it is real.
              */
              aliases: planTerms(
                person,
                resolvePlace({
                  state: desk.state,
                  district: desk.district,
                  constituency: desk.constituency,
                }),
              ).persona.filter((t) => t !== person.name),
              portals,
              customUrls: custom,
              state: desk.state ?? null,
              // The district, not the seat — publishers issue editions by
              // district and the seat finds no district route.
              city: desk.district ?? desk.constituency ?? null,
            }),
          })

          const payload = (await res.json().catch(() => null)) as FindResponse | null

          if (!res.ok) {
            setError(
              payload?.error ??
                (res.status === 429
                  ? 'The papers have been read several times in a row. The next scan will run in a few minutes.'
                  : 'The mastheads could not be read just now.'),
            )
            return
          }

          const candidates = (payload?.candidates ?? [])
            .map((c) => ({
              url: text(c.url),
              title: text(c.title),
              portal: text(c.portal) ?? 'unknown',
            }))
            .filter(
              (c): c is { url: string; title: string; portal: string } =>
                c.url !== null && c.title !== null,
            )
            .slice(0, MAX_CANDIDATES)

          setSources(
            (payload?.sources ?? []).map((s) => ({
              portal: text(s.portal) ?? 'unknown',
              found: typeof s.found === 'number' ? s.found : 0,
              error: text(s.error),
            })),
          )
          setNotes((payload?.notes ?? []).map(text).filter((n): n is string => n !== null))

          update((prev) => {
            // Anything already read keeps its reading. Re-finding a story the
            // office has already had analysed must not push it back into the
            // "unread" pile every morning.
            const read = new Set(prev.personaMentions.map((m) => m.url))
            return {
              ...prev,
              newsCandidates: candidates.filter((c) => !read.has(c.url)),
              lastScanAt: new Date().toISOString(),
            }
          })
        } catch {
          setError('Could not reach the server, so the papers were not read.')
        } finally {
          running.current = false
          setBusy(false)
        }
      })()
    },
    [],
  )

  /* ── the pages that carry news about THIS person ───────────────────────── */

  /**
   * Find the publisher pages dedicated to this person, once per desk.
   *
   * The masthead list is organised by place, and for a great many members that
   * turns out to be the wrong axis entirely. Scanning the eight papers covering
   * this member's district returned nothing at all: her name was on none of
   * their front pages, and the two district editions that would have carried
   * local news serve their district feed on the reader's location rather than
   * on the URL — from a server they hand back the state wire, so the desk read
   * eighty stories about Bengaluru, Meerut and a film star's farm and reported
   * a quiet week.
   *
   * Meanwhile four publishers were each maintaining a page collecting her
   * coverage — one of them with 191 stories — and nothing here knew they
   * existed.
   *
   * A tag page is the best source a person-centred desk can have: the publisher
   * maintains it, it is exactly one person's coverage so no search terms are
   * needed to filter it, and once found it keeps working every morning. Finding
   * them is a grounded search plus a handful of page reads, which is why it
   * happens once rather than daily.
   */
  const seedNewsSources = useCallback(() => {
    if (sourcing.current) return

    const current = readStore()
    const person = current.identity
    if (!person || current.newsSourcesSeededAt) return

    sourcing.current = true
    void (async () => {
      try {
        const res = await fetchWithTimeout('/api/news-sources', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: person.name,
            role: person.role,
            constituency: person.constituency,
            state: person.state,
            party: person.party,
          }),
        })
        const payload = (await res.json().catch(() => null)) as
          | { sources?: { url?: unknown; standing?: unknown }[] }
          | null
        if (!res.ok) return

        const found = (payload?.sources ?? [])
          .filter((x) => typeof x?.url === 'string')
          .map((x) => x.url as string)

        update((prev) => {
          const existing = prev.profile?.customPortalUrls ?? []
          const merged = [...new Set([...existing, ...found])]
          return {
            ...prev,
            profile: prev.profile
              ? { ...prev.profile, customPortalUrls: merged }
              : prev.profile,
            // Stamped even when nothing was found, so a person nobody writes
            // about is not re-searched on every visit for ever.
            newsSourcesSeededAt: new Date().toISOString(),
            // The next scan should use them rather than waiting six hours.
            lastScanAt: found.length > 0 ? null : prev.lastScanAt,
          }
        })
      } catch {
        /* a desk without dedicated pages still has its mastheads */
      } finally {
        sourcing.current = false
      }
    })()
  }, [])

  /* ── the local media, found once ───────────────────────────────────────── */

  /**
   * Seed the influencer roster with the channels that cover this seat.
   *
   * Runs at most once per desk — when the roster is empty and the desk knows
   * where it is — because it opens sixteen channels and then asks a model which
   * of them are actually covering local politics. That is far too expensive to
   * repeat on a dashboard load, and the answer barely moves week to week.
   *
   * YouTube only, and the response says so. It is the one platform of the seven
   * that answers a keyless search from a server; Facebook, Instagram, LinkedIn
   * and X publish no such thing at any price short of a login, so a roster on
   * those has to be typed in. Measured on a real seat this returns around a
   * dozen real channels — the district's own Urdu news channel among them —
   * without any key configured at all.
   */
  const seedInfluencers = useCallback(() => {
    if (seeding.current) return
    const current = readStore()
    const person = current.identity
    const desk = current.profile

    if (!person || !desk) return
    // Only ever into an empty roster. An office that has curated its own list,
    // or deleted suggestions it did not want, must not have them pushed back.
    if (current.influencers.length > 0) return
    if (current.influencersSeededAt) return

    const where = desk.district ?? desk.constituency
    if (!where) return

    seeding.current = true
    void (async () => {
      try {
        const res = await fetch(
          `/api/influencers?constituency=${encodeURIComponent(where)}&subject=${encodeURIComponent(person.name)}`,
        )
        const payload = (await res.json().catch(() => null)) as
          | { influencers?: unknown[]; notes?: unknown[] }
          | null
        if (!res.ok) return

        const found = (payload?.influencers ?? []).filter(
          (x): x is Record<string, unknown> => typeof x === 'object' && x !== null,
        )

        update((prev) => {
          const known = new Set(prev.influencers.map((i) => i.id))
          const fresh = found
            .map((raw) => raw as unknown as (typeof prev.influencers)[number])
            .filter((i) => i && typeof i.id === 'string' && !known.has(i.id))
          return {
            ...prev,
            influencers: [...prev.influencers, ...fresh],
            // Stamped whether or not anything was found, so a seat with no
            // local channels is not re-searched on every visit forever.
            influencersSeededAt: new Date().toISOString(),
          }
        })
      } catch {
        /* a roster that could not be seeded is a manual roster, not an error */
      } finally {
        seeding.current = false
      }
    })()
  }, [])

  /* ── and what those accounts actually said ─────────────────────────────── */

  /**
   * Read the local accounts for mentions of this person.
   *
   * This is the step that turns a roster into an answer. Seeding found twelve
   * channels with an audience in the seat; this opens their recent posts and
   * asks, of each one that names the member, whether it is for them or against
   * them and whether the claim in it stands up. Without it the Influencer
   * screen is a list of subscriber counts, which tells a member nothing they
   * wanted to know.
   *
   * Once every twelve hours, and never on a timer shorter than that. Each
   * account is a live fetch and a model call, so running it per dashboard visit
   * would spend a day's tokens before lunch and return the same answer each
   * time — these are channels posting a few times a day, not a live feed.
   *
   * Bounded to six accounts per run for the same reason. Which six is decided
   * by reach: a channel with two million subscribers moves the seat and one
   * with four hundred does not, and when only some can be read it should be the
   * ones people actually watch.
   */
  const readInfluencers = useCallback((force = false) => {
    if (reading.current) return

    const current = readStore()
    const person = current.identity
    if (!person || current.influencers.length === 0) return

    const since = current.influencersReadAt ? Date.parse(current.influencersReadAt) : 0
    if (!force && Number.isFinite(since) && Date.now() - since < INFLUENCER_FRESH_MS) return

    const roster = [...current.influencers]
      .sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))
      .slice(0, MAX_ACCOUNTS_PER_RUN)

    reading.current = true
    setInfluencersBusy(true)

    void (async () => {
      try {
        // The person and their patch. The party is left out for the same
        // reason the news scan leaves it out: it matches the national wire and
        // buries anything that is actually about this member.
        const watchTerms = planTerms(
          person,
          resolvePlace({
            state: current.profile?.state,
            district: current.profile?.district,
            constituency: current.profile?.constituency,
          }),
        ).persona

        /**
         * Did the server judge these, or just list them?
         *
         * Mirrors the server's own test — it drops terms under two characters
         * and reads unfiltered when none survive. A thin identity can produce
         * no usable terms, and this scan runs on its own without anybody asking
         * for it, so an unjudged reply arriving here must not be allowed to
         * overwrite what a model already worked out.
         */
        const judged = watchTerms.filter((t) => t.trim().length >= 2).length > 0

        const res = await fetchWithTimeout('/api/influencers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ influencers: roster, watchTerms }),
        })

        const payload = (await res.json().catch(() => null)) as
          | { mentions?: unknown[] }
          | null
        if (!res.ok) return

        const incoming = (payload?.mentions ?? []).filter(
          (m): m is Record<string, unknown> => typeof m === 'object' && m !== null,
        )

        update((prev) => {
          // Keyed on the post, so re-reading a channel does not file the same
          // video twice — and so a mention somebody has already acknowledged
          // stays acknowledged.
          const byUrl = new Map(prev.mentions.map((m) => [m.postUrl, m]))
          for (const raw of incoming) {
            const row = raw as unknown as (typeof prev.mentions)[number]
            if (!row || typeof row.postUrl !== 'string') continue
            const existing = byUrl.get(row.postUrl)
            // The richer record wins: an unjudged listing must never downgrade
            // a post a model already read. Same rule as the manual check in
            // components/Influencers.tsx.
            if (existing && !judged) continue
            byUrl.set(row.postUrl, existing ? { ...row, acknowledged: existing.acknowledged } : row)
          }
          return {
            ...prev,
            mentions: pruneMentions([...byUrl.values()]),
            influencersReadAt: new Date().toISOString(),
          }
        })
      } catch {
        /* unreadable accounts are a normal state, not an error to surface */
      } finally {
        reading.current = false
        setInfluencersBusy(false)
      }
    })()
  }, [])

  /* ── the automatic part ────────────────────────────────────────────────── */

  /**
   * The example desk never calls the server on its own.
   *
   * It is a fixed dataset — its own notes say "read once and stored, not a live
   * feed" — so every automatic refresher in here is asking a backend to redo
   * work that already shipped in the JSON. Measured on the built app: a single
   * fresh demo visit fired POST /api/persona and POST /api/opinion twice each.
   *
   * That is not merely wasteful. `lastScanAt` is written only on SUCCESS, so a
   * failure never backs off and the call repeats on every mount for the life of
   * the deployment. With no model key configured the visitor is shown the
   * function's own error text — "No language model is configured... set
   * GROQ_API_KEY in the site environment and redeploy" — as the body of a card
   * on the showcase screen. With a key configured, every anonymous visitor
   * spends a billed grounded search instead.
   *
   * Only the AUTOMATIC paths are stopped. Anything the reader asks for by
   * tapping — Analyse, or the refresh control — still runs, because a demo
   * where the buttons do nothing is a worse demo.
   */
  useEffect(() => {
    if (!identity || isDemoScope()) return

    // A desk whose identity exists but whose profile was never written — set up
    // before auto-configuration existed, or half-written by an interrupted
    // session — is repaired here rather than left permanently unable to scan.
    if (!profile || (profile.portals ?? []).length === 0) {
      const plan = planDesk(identity)
      if (plan.portals.length > 0) applyDeskPlan(identity, plan, { overwritePortals: true })
      return
    }

    // Sources first: it can clear `lastScanAt`, and the scan below should then
    // read the pages it just found rather than waiting for the next window.
    seedNewsSources()
    run()
    seedInfluencers()
    readInfluencers()

    /**
     * And again when the next 07:30 arrives, for a desk that is left open.
     *
     * The office computer is not closed overnight. Without this it would still
     * be showing yesterday's papers at nine in the morning, having crossed the
     * boundary at 07:30 with nobody there to reload it — and the one number on
     * screen that says how current this is would be a lie by omission.
     *
     * One timeout, not an interval: it fires once, the scan re-runs, and the
     * effect that scheduled it is not re-entered. A desk left open for several
     * days therefore refreshes on the first morning and then waits to be
     * touched, which is the honest limit of what a page can promise about a
     * clock it does not own.
     */
    const nextBoundary = new Date(lastScanBoundary())
    nextBoundary.setDate(nextBoundary.getDate() + 1)
    const wait = nextBoundary.getTime() - Date.now()
    // setTimeout overflows past ~24.8 days; a day is comfortably inside it.
    const timer = window.setTimeout(() => {
      seedNewsSources()
      run()
      readInfluencers()
    }, Math.max(1000, wait))
    return () => window.clearTimeout(timer)
    // `run` and `seedInfluencers` are stable and read the store themselves;
    // depending on the store here would re-fire the effect on every write the
    // scan itself makes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    identity,
    profile?.portals?.length,
    profile?.customPortalUrls?.length,
    run,
    seedInfluencers,
    readInfluencers,
    seedNewsSources,
  ])

  return { busy, influencersBusy, lastAt, blocked, error, sources, notes, run }
}
