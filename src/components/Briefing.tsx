import { useEffect, useMemo, useState } from 'react'
import { PersonaBar } from '@/components/PersonaBar'
import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { CalendarDays, GitCompareArrows, UserRound } from 'lucide-react'
import type { Identity } from '@shared/identity'
import type { Report } from '@shared/types'
import { readStore, useStore } from '@/lib/store'
import { briefingOf } from '@/lib/briefing'
import { growthSummary } from '@/lib/growth'
import { loadPostReports } from '@/lib/post-reports'
import { useMorningScan } from '@/lib/morning-scan'
import { ownedBySubject, listHandles, readStandingCache, reconcileOwnership } from '@/lib/handles'
import { Avatar, Button, Shell } from './ui'
import { fadeUp, listStagger } from '@/lib/motion'
import { OverallReach } from './briefing/OverallReach'
import { SentimentOverview } from './briefing/SentimentOverview'
import { TopMentions } from './briefing/TopMentions'
import { ContentInsights } from './briefing/ContentInsights'
import { FollowerGrowth } from './briefing/FollowerGrowth'
import { AudienceGlance, HighlightsGlance, NextPostGlance } from './briefing/HighlightsGlance'

/**
 * The dashboard, rebuilt to the product owner's reference design.
 *
 * Four sections, in the reference's order:
 *
 *   1. Overall reach   — one card per platform, then the desk's totals.
 *   2. Sentiment and mentions — what the comments say, and who they name.
 *   3. Content insights — what is working, what is not, platform by platform.
 *   4. Follower growth  — the lines, the figures, and where that puts you.
 *
 * Everything that used to sit between and below these — the lead card, the
 * ground map, the week-against-rivals board, post highlights, the what-to-post
 * planner, the local news list, the issue cards and the lines-to-use block —
 * is off this page at the owner's instruction: the dashboard is this design
 * and nothing else. Those screens still exist and are still reachable from
 * the navigation; the code for the blocks that lived only here is in git at
 * commit db79d08 if any of it is wanted back.
 *
 * The one rule that survives the redesign unchanged: every figure is a
 * measurement with its source attached. Where the reference shows a number
 * this desk cannot honestly produce — impressions, profile visits, a
 * percentile against every MP in the state — the same slot carries the
 * nearest figure that IS real and says what it is. A monitoring tool whose
 * whole claim is that it catches unsupported statements cannot make them.
 */

export type Destination =
  | 'grievances'
  | 'influencers'
  | 'actions'
  | 'personas'
  | 'accounts'
  | 'compare'
  | 'settings'
  | 'analyse'
  | 'weekly'
  | 'highlights'
  | 'audience'
  | 'nextpost'

export function Briefing({
  onNavigate,
  onEditIdentity,
  onRead,
  onOpenReport,
  onPersonaSwitched,
}: {
  onNavigate: (to: Destination, issueId?: string) => void
  /**
   * A different politician's desk is now open. Everything below reads a
   * different storage namespace, so the host remounts rather than this
   * component trying to re-derive its own state in place.
   */
  onPersonaSwitched: () => void
  /** Run the full analysis on one post, in the app rather than on the platform. */
  onRead: (postUrl: string) => void
  /** Open a report that already exists, on the analyse screen, instantly. */
  onOpenReport: (report: Report) => void
  /** Reopens the setup screen, where who the desk is for is decided. */
  onEditIdentity: () => void
}) {
  const store = useStore()
  const reduce = useReducedMotion() === true
  const b = useMemo(() => briefingOf(store), [store])

  // Kept mounted: this is what actually reads the morning's papers and the
  // influencer accounts on a real desk. Its results are read on the
  // Grievances and Influencers screens rather than here.
  useMorningScan()

  const go = (to: Destination) => () => onNavigate(to)

  /**
   * Put the ownership flags right before anything reads them.
   *
   * `ownedBySubject` below fixes what THIS component draws; this fixes what
   * every other consumer of `own` draws — the follower board, the mention
   * counts, the week against rivals, the greeting. They all read the stored
   * flag, and a desk carrying somebody else's account marked "ours" feeds it
   * into all of them.
   *
   * Runs before the first read rather than in an effect, so nothing paints a
   * wrong total for a frame first.
   */
  const handles = useMemo(() => {
    reconcileOwnership(readStore().identity)
    return listHandles()
  }, [])
  /**
   * The desk's own accounts, checked against WHO THE DESK IS FOR rather than
   * taken from a flag that was set once and never revisited. See
   * `ownedBySubject` — a desk that was set up for somebody else, or handed a
   * bundle somebody else assembled, keeps their accounts marked "ours" for
   * ever otherwise, and every total here is labelled "across your accounts".
   */
  const ownHandles = useMemo(
    () => ownedBySubject(handles, store.identity),
    [handles, store.identity],
  )
  const ownIds = useMemo(() => new Set(ownHandles.map((h) => h.id)), [ownHandles])
  // Everything that is not the subject's is something the desk watches —
  // including an account still flagged `own` that the record says is not
  // theirs. It belongs on the comparison board, not in the totals.
  const watchedHandles = useMemo(
    () => handles.filter((h) => !ownIds.has(h.id)),
    [handles, ownIds],
  )
  /**
   * The accounts these sections describe: THIS DESK'S OWN, and nothing else.
   *
   * It used to fall back to every tracked handle when none were marked own —
   * "on a desk that marked nothing, all of them is the only available reading
   * of the question". It is not. Every card downstream labels these figures
   * as the desk's: "followers on every account", "across your accounts",
   * "your follower growth". Summing the accounts of people the office is
   * WATCHING under those words does not answer the question loosely, it
   * answers a different question and puts somebody else's name on the answer.
   *
   * What that fallback actually produced, on a desk holding one 1.6-crore
   * account belonging to somebody else: a total reach of 1.6 crore, a growth
   * rate of 3477.9%, and "your follower growth is ahead of 2 of the 3 accounts
   * you watch" — every one of them a confident statement about the wrong
   * politician. An empty card that says nothing is read yet is recoverable.
   * A wrong number nobody can tell is wrong is not.
   *
   * A desk with no own accounts now shows the empty state, which is true, and
   * the Accounts screen is where an account gets marked as the desk's.
   */
  const postHandles = ownHandles

  /** Full reports by post url. Null while loading, so cards can say so. */
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

  const growth = useMemo(() => growthSummary(postHandles), [postHandles])

  const commentsRead = useMemo(
    () =>
      postHandles.reduce((sum, h) => {
        const st = readStandingCache(h.id)
        return sum + (st && st.source !== 'record' ? st.commentsRead : 0)
      }, 0),
    [postHandles],
  )

  /**
   * The window the post figures actually cover, for the header's date pill.
   *
   * Read off the posts themselves rather than the clock. The reference shows
   * a date-range picker; this desk holds one reading per account, so the pill
   * reports the range the stored posts span instead of offering windows the
   * data cannot be cut into.
   */
  const windowLabel = useMemo(() => {
    const dates = postHandles
      .flatMap((h) => h.snapshots.at(-1)?.posts ?? [])
      .map((p) => p.publishedAt)
      .filter((d): d is string => Boolean(d))
      .sort()
    if (dates.length === 0) return 'Latest reading'
    const fmt = (iso: string): string =>
      new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    const first = fmt(dates[0]!)
    const last = fmt(dates.at(-1)!)
    return first === last ? first : `${first} to ${last}`
  }, [postHandles])

  return (
    <Shell className="stack">
      <m.div
        className="stack"
        variants={listStagger}
        initial={reduce ? false : 'hidden'}
        animate="show"
      >
        <m.header variants={fadeUp}>
          <DashboardHeader
            greeting={b.greeting}
            firstName={b.firstName}
            identity={b.identity}
            window={windowLabel}
            onSetUp={onEditIdentity}
            onCompare={go('compare')}
            onPersonaSwitched={onPersonaSwitched}
          />
        </m.header>

        {/* ── 1 · overall reach ───────────────────────────────────────── */}
        <m.section variants={fadeUp} aria-label="Overall reach">
          <OverallReach handles={postHandles} growth={growth} commentsRead={commentsRead} reports={reports} />
        </m.section>

        {/* ── 2 · sentiment, and who the comments name ────────────────── */}
        <m.section variants={fadeUp} aria-label="Sentiment and mentions">
          <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
            <SentimentOverview
              handles={postHandles}
              reports={reports}
              onOpenAccounts={go('accounts')}
            />
            <TopMentions
              handles={handles}
              identity={b.identity}
              issues={store.issues}
              onOpenAccounts={go('accounts')}
            />
          </div>
        </m.section>

        {/* ── 3 · the two deep readings, in short ──────────────────────
            Each card says the one thing worth noticing and opens the whole
            analysis behind it. They sit after the mood and before the
            performance tables because that is the order an office asks: how
            do people feel, which posts caused it, then what should I do. */}
        <m.section variants={fadeUp} aria-label="Post highlights and audience">
          {/* These two stretch to match, unlike the row above: they are the
              same weight of card and a 26px difference in their bottom edges
              reads as a near-miss rather than a deliberate stagger. */}
          <div className="grid gap-3 xl:grid-cols-2">
            <HighlightsGlance
              handles={postHandles}
              reports={reports}
              onExplore={go('highlights')}
              onOpenReport={onOpenReport}
            />
            <AudienceGlance
              handles={postHandles}
              reports={reports}
              onExplore={go('audience')}
            />
          </div>
          {/* The third door: what to do about the two readings above. Full
              width under them, because it is their conclusion, not a sibling. */}
          <div className="mt-3">
            <NextPostGlance handles={postHandles} reports={reports} onExplore={go('nextpost')} />
          </div>
        </m.section>

        {/* ── 4 · content insights ────────────────────────────────────── */}
        <m.section variants={fadeUp} aria-label="Content insights">
          <ContentInsights
            handles={postHandles}
            reports={reports}
            onRead={onRead}
            onOpenReport={onOpenReport}
            onOpenAccounts={go('accounts')}
          />
        </m.section>

        {/* ── 4 · follower growth ─────────────────────────────────────── */}
        <m.section variants={fadeUp} aria-label="Follower growth">
          <FollowerGrowth
            growth={growth}
            ownHandles={postHandles}
            watchedHandles={watchedHandles}
            onOpenAccounts={go('accounts')}
          />
        </m.section>
      </m.div>
    </Shell>
  )
}

/* ── the header ──────────────────────────────────────────────────────────── */

/**
 * The greeting, and the two controls the reference puts opposite it: the
 * window the figures cover, and the way into the comparison screen.
 *
 * The face stays. This is a tool an office runs on behalf of one named
 * person, and opening it on somebody else's desk is a failure that is
 * otherwise invisible — every number after this would be confidently about
 * the wrong politician.
 */
function DashboardHeader({
  greeting,
  firstName,
  identity,
  window: windowLabel,
  onSetUp,
  onCompare,
  onPersonaSwitched,
}: {
  greeting: string
  firstName: string | null
  identity: Identity | null
  window: string
  onSetUp: () => void
  onCompare: () => void
  onPersonaSwitched: () => void
}) {
  if (!identity) {
    return (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="display text-[clamp(1.4rem,1.1rem+1.4vw,2.1rem)]">{greeting}.</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-2">Nobody has been set up yet.</p>
        </div>
        <Button onClick={onSetUp} className="shrink-0">
          <UserRound size={16} />
          Tell it who you are
        </Button>
      </div>
    )
  }

  return (
    <div>
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar
          src={identity.photoUrl}
          name={identity.name}
          size={44}
          className="shrink-0 lg:size-[52px]"
        />
        <div className="min-w-0">
          <h1 className="display text-[clamp(1.35rem,1.05rem+1.3vw,2rem)]">
            {greeting}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-0.5 truncate text-[13px] text-ink-2">
            Here is what is happening across your social media
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-3.5 text-[13px] font-medium text-ink-2 shadow-[var(--e1)]">
          <CalendarDays size={15} className="text-ink-3" aria-hidden />
          {windowLabel}
        </span>
        <Button variant="outline" onClick={onCompare}>
          <GitCompareArrows size={15} aria-hidden />
          Compare
        </Button>
      </div>
    </div>

    {/* Under the greeting rather than beside it. The chips are a row that
        grows — a desk watching four politicians would otherwise push the name
        and the two controls into each other at every width. */}
    <PersonaBar
      primaryName={identity.name}
      primaryPhoto={identity.photoUrl}
      onSwitched={onPersonaSwitched}
    />
    </div>
  )
}
