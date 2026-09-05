import { useEffect, useMemo, useState } from 'react'
import { PersonaBar } from '@/components/PersonaBar'
import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { CalendarDays, GitCompareArrows, Plus, UserRound } from 'lucide-react'
import type { Identity } from '@shared/identity'
import type { Report } from '@shared/types'
import { isDemoScope, readStore, useStore } from '@/lib/store'
import { briefingOf, ownPostsOf, whatLandsOf } from '@/lib/briefing'
import { growthSummary } from '@/lib/growth'
import { loadPostReports } from '@/lib/post-reports'
import { presentAnchor, windowLabel as windowRangeLabel, type WindowId } from '@/lib/window'
import { useMorningScan } from '@/lib/morning-scan'
import {
  ownedBySubject,
  listHandles,
  readStandingCache,
  reconcileOwnership,
  type Standing,
} from '@/lib/handles'
import { Avatar, Button, Card, Shell } from './ui'
import { fadeUp, listStagger } from '@/lib/motion'
import { OverallReach } from './briefing/OverallReach'
import { SentimentOverview } from './briefing/SentimentOverview'
import { TopMentions } from './briefing/TopMentions'
import { ContentInsights } from './briefing/ContentInsights'
import { FollowerGrowth } from './briefing/FollowerGrowth'
import { AudienceGlance, HighlightsGlance, NextPostGlance } from './briefing/HighlightsGlance'
import { LocalNewsGlance } from './briefing/LocalNewsGlance'
import { WeekAgainstRivals } from './briefing/WeekAgainstRivals'
import { PeekPanel } from './briefing/PeekPanel'
import { PostHighlights } from './PostHighlights'
import { AudienceScreen } from './AudienceScreen'
import { LocalNews } from './LocalNews'
import { CompareBoard } from './CompareBoard'
import type { Lens as HighlightLens } from '@/components/PostHighlights'

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
  | 'localnews'

export function Briefing({
  onNavigate,
  onEditIdentity,
  onRead,
  onOpenReport,
  onPersonaSwitched,
}: {
  onNavigate: (
    to: Destination,
    issueId?: string,
    lens?: HighlightLens,
    win?: WindowId,
  ) => void
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
  /** The controls inside a peek are inert; these never fire. */
  const noop = (): void => {}

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

  /**
   * The cached comment readings, keyed by handle, for the comparison peek.
   *
   * Read straight from the cache rather than fetched: the peek is a preview
   * and must not start a minute-long reading run just because somebody opened
   * the dashboard. An account with no cached reading shows as unread in the
   * board, which is the honest state.
   */
  const standings = useMemo(() => {
    const out: Record<string, Standing> = {}
    for (const h of handles) {
      const st = readStandingCache(h.id)
      if (st) out[h.id] = st
    }
    return out
  }, [handles])

  const growth = useMemo(() => growthSummary(postHandles), [postHandles])

  /** What lands, for the comparison card's advice line. Null until read. */
  const lands = useMemo(
    () => (reports ? whatLandsOf(ownPostsOf(postHandles), reports) : null),
    [postHandles, reports],
  )

  /**
   * The window the post figures actually cover, for the header's date pill.
   *
   * Read off the posts themselves rather than the clock. The reference shows
   * a date-range picker; this desk holds one reading per account, so the pill
   * reports the range the stored posts span instead of offering windows the
   * data cannot be cut into.
   */
  /**
   * The dashboard's window, and the dates it covers.
   *
   * THE PILL USED TO REPORT SOMETHING ELSE. It printed the span of every dated
   * post the desk holds, which is a real fact but not the one a reader takes
   * from a date beside a Last 7 days / Last 30 days switch: the office pressed
   * the switch, watched "25 Jun 2026 to 27 Aug 2026" sit unchanged, and read
   * the whole control as broken. The window now lives here, the card below
   * drives it, and the pill names the days that window actually covers.
   *
   * The anchor is the newest post the desk holds rather than today's clock,
   * so a window is measured from the last time these accounts were read. A
   * desk read on Monday and opened on Friday would otherwise report an empty
   * week and call it a quiet one.
   */
  const [window, setWindow] = useState<WindowId>('week')

  // Counted back from now, not from the newest post: the office reads the
  // resolved dates against today's calendar, and a label that ends a week ago
  // reads as a broken control however deliberate the anchor was.
  const windowAnchor = presentAnchor()

  const windowLabel = useMemo(
    () => (windowAnchor ? windowRangeLabel(windowAnchor, window) : 'Latest reading'),
    [windowAnchor, window],
  )

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

        {/*
          ── A DESK THAT FOLLOWS NOTHING SAYS SO, AT THE TOP ──────────────

          Setup asks who the desk is FOR and stops there — it records an
          identity and adds no tracked accounts. So a freshly built desk
          landed here with every card in its empty state and no reach card at
          all, and the only route to fix it was a link reading "Open your
          accounts" buried inside an empty card about comments. The Accounts
          screen is deliberately UNLISTED (the owner asked for everything that
          is not a daily read to live under Settings), which is a reasonable
          place for it once a desk is running and the wrong place for it when
          the desk cannot do anything until you have been there.

          So the desk asks, once, in the first thing on the screen, and stops
          asking the moment an account is marked as its own. Not shown on the
          example desk, which arrives with its accounts already on it.
        */}
        {ownHandles.length === 0 && handles.length > 0 && !isDemoScope() && (
          <m.section variants={fadeUp} aria-label="Mark this desk's own accounts">
            <Card tone="accent">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[15px] font-bold tracking-[-0.01em]">
                    None of your {handles.length} account
                    {handles.length === 1 ? ' is' : 's are'} marked as this desk&rsquo;s
                  </p>
                  <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-ink-2">
                    {/* The distinction this card exists for. Every figure on this
                        page is captioned "yours", so it counts only accounts the
                        desk owns — an account it merely watches belongs on the
                        comparison board, not in a total labelled with your name.
                        Saying "no accounts yet" to a desk that plainly has four
                        was worse than saying nothing: it was false, and it sent
                        the reader off to add accounts they had already added. */}
                    They are being watched, not measured. Open Accounts and mark the ones that
                    belong to {store.identity?.name ?? 'this desk'} as yours &mdash; every figure
                    here counts only the desk&rsquo;s own accounts, so a watched account cannot be
                    totalled under your name.
                  </p>
                </div>
                <Button className="shrink-0" onClick={() => onNavigate('accounts')}>
                  <Plus size={16} aria-hidden />
                  Mark mine
                </Button>
              </div>
            </Card>
          </m.section>
        )}

        {handles.length === 0 && !isDemoScope() && (
          <m.section variants={fadeUp} aria-label="Add this desk's accounts">
            <Card tone="accent">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[15px] font-bold tracking-[-0.01em]">
                    This desk follows no accounts yet
                  </p>
                  <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-ink-2">
                    {store.identity?.name
                      ? `Add ${store.identity.name}'s social accounts and every figure on this page fills in. Nothing here can be measured until then.`
                      : 'Add the accounts this desk follows and every figure on this page fills in.'}
                  </p>
                </div>
                <Button className="shrink-0" onClick={() => onNavigate('accounts')}>
                  <Plus size={16} aria-hidden />
                  Add accounts
                </Button>
              </div>
            </Card>
          </m.section>
        )}

        {/* ── SECTION 1 · 1 of 4 · overall reach ──────────────────────── */}
        <m.section variants={fadeUp} aria-label="Overall reach">
          <OverallReach
              handles={postHandles}
              reports={reports}
              window={window}
              onWindow={setWindow}
            />
        </m.section>

        {/* ── SECTION 1 · 2 of 4 · sentiment, and who the comments name ── */}
        <m.section variants={fadeUp} aria-label="Sentiment and mentions">
          {/* STACKED, NOT SIDE BY SIDE. These shared a row while each held a
              donut and a short list. Both now carry the reasons read out of
              the comments and several quotes apiece, and at half the width
              the chips wrapped to four lines and the quotes clipped. Full
              width each, one below the other. */}
          <div className="grid gap-3">
            <SentimentOverview
              handles={postHandles}
              reports={reports}
              onOpenAccounts={go('accounts')}
              onOpenAudience={go('audience')}
            />
            <TopMentions
              handles={handles}
              identity={b.identity}
              issues={store.issues}
              reports={reports}
              onOpenAudience={go('audience')}
            />
          </div>
        </m.section>

        {/* ── SECTION 1 · 3 of 4 · content insights ───────────────────── */}
        <m.section variants={fadeUp} aria-label="Content insights">
          <ContentInsights
            handles={postHandles}
            reports={reports}
            onRead={onRead}
            onOpenReport={onOpenReport}
            onOpenAccounts={go('accounts')}
            /* The two tables land on the matching half of the highlights
               screen rather than both on its default lens. */
            onOpenAllPosts={(lens, win) => onNavigate('highlights', undefined, lens, win)}
          />
        </m.section>

        {/* ── SECTION 1 · 4 of 4 · follower growth ────────────────────── */}
        <m.section variants={fadeUp} aria-label="Follower growth">
          <FollowerGrowth
            growth={growth}
            ownHandles={postHandles}
            watchedHandles={watchedHandles}
            onOpenAccounts={go('accounts')}
          />
        </m.section>

        {/* ── SECTION 2 · post highlights, at half height ───────────────
            The office numbers this desk in three: the figures above are
            section one, this is section two, and what people are saying is
            section three. They read in that order, so they sit in that order,
            each mounting the REAL screen cut off partway down rather than a
            hand-written precis of it that would have to be kept in step. */}
        <m.section variants={fadeUp} aria-label="Post highlights">
          <PeekPanel
            title="Post highlights"
            subtitle="Which posts landed, and what they had in common"
            action="Open post highlights"
            onOpen={go('highlights')}
            trim={72}
          >
            <PostHighlights onClose={noop} onOpenReport={onOpenReport} onRead={onRead} />
          </PeekPanel>
        </m.section>

        {/* ── SECTION 3 · what the comments say, at half height ────────── */}
        <m.section variants={fadeUp} aria-label="What people are saying">
          <PeekPanel
            title="What people are saying"
            subtitle="The comments under your posts, in their own words"
            action="Open what people are saying"
            onOpen={go('audience')}
            trim={72}
          >
            <AudienceScreen onClose={noop} onOpenAccounts={noop} />
          </PeekPanel>
        </m.section>

        {/* ── then the rest of the desk ───────────────────────────────── */}
        {/* ── 5 · how the week reads against the people you track ──────
            The office asked for a comparison on the dashboard. This card was
            written and never mounted, so the desk had a rivals view it could
            not reach from its front page. It renders nothing at all when the
            desk tracks no rivals, which is the honest state for a desk that
            has not been given anybody to measure against. */}
        {lands && (
          <m.section variants={fadeUp} aria-label="Your week against theirs">
            <WeekAgainstRivals handles={handles} lands={lands} onExplore={go('weekly')} />
          </m.section>
        )}

        {/* ── 6 · the comparison board, at half height ─────────────────
            The office's words: the week-against-rivals card above is "a
            different thing" — it says who posted what — and they also wanted
            the comparison proper on the front page. This is that board, the
            same one the Compare screen mounts, cut off partway down. */}
        {handles.length > 0 && (
          <m.section variants={fadeUp} aria-label="Comparison">
            <PeekPanel
              title="Compare your performance"
              subtitle="How you stack up against the people you track"
              action="Open comparison"
              onOpen={go('compare')}
              height={460}
            >
              <CompareBoard
                handles={handles}
                identity={b.identity}
                standings={standings}
                notes={{}}
                reports={reports}
                onAddCompetitor={noop}
                onUntrack={noop}
                onOpenPost={noop}
              />
            </PeekPanel>
          </m.section>
        )}

        {/* ── 8 · what to do about the readings above ─────────────────── */}
        <m.section variants={fadeUp} aria-label="What to post next">
          <NextPostGlance handles={postHandles} reports={reports} onExplore={go('nextpost')} />
        </m.section>

        {/* ── 9 · what the papers carried ─────────────────────────────── */}
        <m.section variants={fadeUp} aria-label="Local news mentions">
          <PeekPanel
            title="Local news mentions"
            subtitle="What the papers and portals printed about you"
            action="Open local news"
            onOpen={go('localnews')}
            trim={100}
          >
            <LocalNews />
          </PeekPanel>
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
