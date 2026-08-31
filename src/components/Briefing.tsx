import { useEffect, useMemo, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Check,
  CircleAlert,
  ExternalLink,
  ListChecks,
  MapPin,
  Newspaper,
  OctagonAlert,
  Plus,
  Quote,
  RefreshCw,
  ScanEye,
  TriangleAlert,
  UserRound,
} from 'lucide-react'
import type { Identity } from '@shared/identity'
import { unverifiedFields } from '@shared/identity'
import type { Report } from '@shared/types'
import { useStore } from '@/lib/store'
import {
  briefingOf,
  nextPostsOf,
  ownPostsOf,
  platformReachOf,
  whatLandsOf,
  type NewsItem,
  type RankedIssue,
  type Suggestion,
} from '@/lib/briefing'
import { growthSummary } from '@/lib/growth'
import { loadPostReports } from '@/lib/post-reports'
import { fileAction } from '@/lib/actions'
import { useMorningScan } from '@/lib/morning-scan'
import { useOpinion } from '@/lib/opinion'
import { OpinionPanel } from './OpinionPanel'
import { Avatar, Button, Card, Chip, Empty, Shell, type ChipTone } from './ui'
import { CardHead, IndiaMap, PlatformBadge, type MapMarker } from '@/components/kit'
import { HiddenStories, RelevanceChip } from '@/components/briefing/LocalNews'
import { geocodePlace, type Place } from './gazetteer'
import { INDIA_DOTS, INDIA_BBOX } from './india-dots'
import { listHandles } from '@/lib/handles'
import { cn, relativeTime } from '@/lib/utils'
import { fadeUp, listItem, listStagger } from '@/lib/motion'
import { DeskOverview, MostEngagingStrip, deskPosts } from './briefing/DeskOverview'
import { GrowthCard, PlatformReachRow } from './briefing/Glance'
import { SentimentGlance } from './briefing/SentimentGlance'
import { TopMentions } from './briefing/TopMentions'
import { CompareBoard } from './briefing/CompareBoard'
import { WeekAgainstRivals } from './briefing/WeekAgainstRivals'
import { PostHighlights } from './briefing/PostHighlights'
import { NextPosts } from './briefing/NextPosts'
import { PerceptionPanel, PlatformVoices } from './briefing/PlatformVoices'
import { LocalNewsList, localNewsOf } from './briefing/LocalNews'

/**
 * The dashboard.
 *
 * Restructured around six questions, asked in the order an office asks them:
 *
 *   1. Where do I stand?            — the desk at a glance: reach on each
 *      platform, what the public thinks and where they said it, what lands
 *      and what does not, growth against last week, the ground and the board.
 *   2. Which of my posts mattered?  — post highlights: every own post that has
 *      been read in full, expandable into the same deep report the Analyse
 *      screen shows.
 *   3. What is travelling?          — the most engaging posts strip.
 *   4. What should I post next?     — recommendations computed from the
 *      numbers above, never from a model's imagination.
 *   5. What is each platform saying about me?
 *   6. What is in the local news this week?
 *
 * Two rules hold everything together. Every figure is a measurement with its
 * source attached — a record reading is never dressed as a sample of
 * constituents, and a platform that published nothing shows a dash, not a
 * zero. And no section invents content to avoid looking empty: a desk with
 * too little data gets a sentence saying exactly what is missing and what
 * will fill it in. This product's whole claim is that it catches confident
 * unsupported statements; a dashboard that pads itself has no standing to
 * make that claim.
 *
 * The greeting and the one-thing lead stay on top: whatever the structure
 * below, the first thing the member sees is whether today needs them.
 */

type Destination =
  | 'grievances'
  | 'influencers'
  | 'actions'
  | 'personas'
  | 'accounts'
  | 'compare'
  | 'settings'
  | 'analyse'
  | 'weekly'

/** A stable empty map, so memos do not recompute against a fresh literal. */
const NO_REPORTS: Map<string, Report> = new Map()

export function Briefing({
  onNavigate,
  onEditIdentity,
  onRead,
}: {
  /** The second argument names an issue to open on arrival. */
  onNavigate: (to: Destination, issueId?: string) => void
  /**
   * Run the full analysis on one post, in the app.
   *
   * Every post on this screen used to be a link straight out to YouTube or
   * Facebook. That hands the reader back to the platform to do the reading
   * themselves — which is the work this desk exists to have already done — and
   * the office loses the translation, the sentiment, the comment reading and
   * the fake-news check on the way out of the door.
   */
  onRead: (postUrl: string) => void
  /**
   * Reopens the setup screen.
   *
   * Not a Destination: the identity card is edited on the screen that created
   * it, and routing this to Settings — which is about connecting platform
   * accounts and asks for an administrator's key — sent somebody who wanted to
   * fix a misread constituency to a password prompt they had no way to answer.
   */
  onEditIdentity: () => void
}) {
  const store = useStore()
  const reduce = useReducedMotion() === true
  const b = useMemo(() => briefingOf(store), [store])
  const scan = useMorningScan()
  const opinion = useOpinion()

  const go = (to: Destination) => () => onNavigate(to)

  const candidates = store.newsCandidates ?? []

  /* Where the read stories come from, for the news-origin map. A purely
     presentational reduction over the news the briefing already computed:
     every story whose free-text place resolves against the offline gazetteer
     becomes a weighted marker, and anything that will not resolve is simply
     never placed — honesty over a full-looking map. */
  const newsOrigins = useMemo(() => newsOriginMap(b.news), [b.news])

  /* The tracked accounts, read once, so the home fills with the office's own
     ground and reach even before the morning scan has found a single story.
     Presentational only — the same list the Accounts screen reads, surfaced
     here so the dashboard is never an empty page when accounts exist. */
  const handles = useMemo(() => listHandles(), [])
  const ownHandles = useMemo(() => handles.filter((h) => h.own), [handles])
  /**
   * The accounts whose posts the desk's sections describe. Own accounts when
   * any are marked; otherwise everything, because on a desk that marked
   * nothing "all of them" is the only available reading of the question.
   */
  const postHandles = ownHandles.length > 0 ? ownHandles : handles

  /**
   * Every full report reachable for matching against own posts — the reader's
   * history plus, on the example desk, the shipped demo reports. Async because
   * the demo file may need one fetch; null means still loading, and the
   * sections that depend on it say so rather than claiming there are none.
   */
  const [reports, setReports] = useState<Map<string, Report> | null>(null)
  useEffect(() => {
    let alive = true
    loadPostReports().then(
      (map) => {
        if (alive) setReports(map)
      },
      () => {
        if (alive) setReports(new Map())
      },
    )
    return () => {
      alive = false
    }
  }, [])

  const ownPosts = useMemo(() => ownPostsOf(postHandles), [postHandles])
  const reach = useMemo(() => platformReachOf(postHandles), [postHandles])
  const growth = useMemo(() => growthSummary(postHandles), [postHandles])
  const strip = useMemo(() => deskPosts(postHandles), [postHandles])
  const lands = useMemo(() => whatLandsOf(ownPosts, reports ?? NO_REPORTS), [ownPosts, reports])
  const nextCards = useMemo(
    () => nextPostsOf({ lands, reach, posts: ownPosts, reports: reports ?? NO_REPORTS }),
    [lands, reach, ownPosts, reports],
  )
  const localNews = useMemo(
    () => localNewsOf(store.influencers, store.mentions),
    [store.influencers, store.mentions],
  )

  /* The closing card of the platform-wise section: the published record.
     The grounded survey when one exists (or is being taken), otherwise the
     press-perception reading over the stories this desk actually read. */
  const publishedRecord =
    opinion.survey || opinion.busy || opinion.error ? (
      <OpinionPanel
        survey={opinion.survey}
        person={b.identity}
        onOpenActions={go('actions')}
        busy={opinion.busy}
        stage={opinion.stage}
        error={opinion.error}
        onRefresh={opinion.refresh}
      />
    ) : b.perception.total > 0 ? (
      <PerceptionPanel
        perception={b.perception}
        onOpenCoverage={go('personas')}
        onOpenAccounts={go('accounts')}
      />
    ) : null

  return (
    <Shell className="stack">
      <m.div
        className="stack"
        variants={listStagger}
        initial={reduce ? false : 'hidden'}
        animate="show"
      >
        {/* ── who this is ─────────────────────────────────────────────── */}
        <m.header variants={fadeUp}>
          <Greeting
            greeting={b.greeting}
            firstName={b.firstName}
            today={b.today}
            identity={b.identity}
            onSetUp={onEditIdentity}
          />
        </m.header>

        {/* ── the one thing ───────────────────────────────────────────── */}
        <m.section variants={fadeUp} aria-labelledby="lead-heading">
          <LeadCard lead={b.lead} onOpen={(to) => onNavigate(to)} />
        </m.section>

        {/* ── 1 · the desk at a glance ────────────────────────────────────
            Reach, sentiment, what lands and growth, all read from records
            this device already holds. The compare link lives on the section
            heading because the sidebar it also lives in is desktop-only, and
            a feature reachable only on a laptop is a feature this office
            does not have. */}
        {(handles.length > 0 || b.identity !== null) && (
          <m.section variants={fadeUp} aria-labelledby="desk-heading">
            <Heading
              id="desk-heading"
              title="Your desk at a glance"
              action={<LinkOut label="Against a rival" onClick={go('compare')} />}
            />
            <div className="stack-tight">
              <PlatformReachRow reach={reach} own={ownHandles.length > 0} growth={growth} />

              <DeskOverview
                handles={handles}
                identity={b.identity}
                onManage={() => onNavigate('accounts')}
                onRead={onRead}
              />

              {/* The what-works breakdown that sat here is folded into two
                  places that carry it better: the week-against-rivals verdict
                  below and the "What to post next" cards further down. */}
              <WeekAgainstRivals handles={handles} lands={lands} onExplore={go('weekly')} />

              {/* The collapsible comparison the owner asked onto the main
                  dashboard: folded to one strip until the office wants the
                  full board. Distinct from the week card above — that scores
                  ONE week's reactions, this compares the whole standing. */}
              <CompareBoard handles={handles} onOpenAccounts={go('accounts')} />

              {handles.length > 0 && <GrowthCard growth={growth} handles={postHandles} />}
            </div>
          </m.section>
        )}

        {/* ── 2 · post highlights ─────────────────────────────────────── */}
        {ownPosts.length > 0 && (
          <m.section variants={fadeUp} aria-labelledby="highlights-heading">
            <Heading id="highlights-heading" title="Post highlights" />
            <PostHighlights posts={ownPosts} reports={reports} />
          </m.section>
        )}

        {/* ── 3 · most engaging posts ─────────────────────────────────── */}
        {strip.length > 0 && (
          <m.section variants={fadeUp} aria-label="Most engaging posts">
            <MostEngagingStrip posts={strip} onRead={onRead} />
          </m.section>
        )}

        {/* ── 4 · what to post next ───────────────────────────────────── */}
        {ownPosts.length > 0 && (
          <m.section variants={fadeUp} aria-labelledby="next-heading">
            <Heading id="next-heading" title="What to post next" />
            <NextPosts
              cards={nextCards}
              input={{
                identity: b.identity,
                reach,
                lands,
                ownHandles,
                allHandles: handles,
                issues: b.issues,
              }}
            />
          </m.section>
        )}

        {/* ── 5 · what people are saying ────────────────────────────────
            ONE section for public sentiment: the overall reading across every
            comment the desk holds, then each platform's own cards. It was two
            sections — a verdict card in "at a glance" and a platform spread
            four screens later — which is the same data told twice in two
            stylings, and the owner called it that. */}
        {(handles.length > 0 || publishedRecord !== null) && (
          <m.section variants={fadeUp} aria-labelledby="platform-heading">
            <Heading
              id="platform-heading"
              title="What people are saying about you"
              action={<LinkOut label="Per account" onClick={go('accounts')} />}
            />
            {/* The verdict card and the mention board side by side on a
                laptop — the owner's reference pairs them — stacked on a
                phone. The board renders nothing until comments exist, and
                the grid collapses to one column around it. */}
            <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
              <SentimentGlance
                handles={ownHandles}
                opinion={store.opinion}
                onOpenAccounts={go('accounts')}
              />
              <TopMentions handles={handles} identity={b.identity} />
            </div>
            <div className="mt-3">
            <PlatformVoices
              handles={ownHandles}
              influencers={store.influencers}
              mentions={store.mentions}
              closing={
                publishedRecord && (
                  <div>
                    <p className="kicker">In the published record</p>
                    <div className="mt-2">{publishedRecord}</div>
                  </div>
                )
              }
            />
            </div>
          </m.section>
        )}

        {/* The "watched voices" section that sat here is gone as a duplicate:
            it grouped the same store.mentions the local-news section below
            groups, over the same window, and the two read as one section told
            twice. The Influencers screen keeps the full account-by-account
            view, one tap away on the section head below. */}

        {/* ── 6 · in the local news ───────────────────────────────────── */}
        <m.section variants={fadeUp} aria-labelledby="local-heading">
          <Heading
            id="local-heading"
            title="In the local news"
            hint={localNews ? localNews.label : undefined}
            action={<LinkOut label="All accounts" onClick={go('influencers')} />}
          />

          {scan.influencersBusy ? (
            <Card>
              <div className="flex items-center gap-3.5">
                <span
                  className="icon-badge"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <RefreshCw size={17} className="animate-spin" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[15px] font-bold">Reading the local accounts…</p>
                </div>
              </div>
            </Card>
          ) : (
            <LocalNewsList
              model={localNews}
              identity={b.identity}
              onRead={onRead}
              onOpenInfluencers={go('influencers')}
            />
          )}

          {/* The newspaper scan, kept as the section's second block. A
              headline that matched a search word and a story somebody has
              actually assessed are different kinds of claim, and both are
              different again from the account mentions above — so each keeps
              its own container and its own label. */}
          <div className="mt-5">
            <p className="kicker">From the morning papers</p>
            {/* Outside the ternary on purpose.
                When the judge rules every story unrelated, `b.news` is empty
                and the branch above renders ScanPanel, which says the scan
                found nothing. That is not what happened: it found nine and
                decided none were about her. This says so, and offers them. */}
            <HiddenStories
              hidden={b.newsHidden}
              counts={b.newsFilter}
              identity={b.identity}
              onRead={onRead}
            />
            <div className="mt-2.5">
              {b.news.length === 0 ? (
                <ScanPanel
                  scan={scan}
                  candidates={candidates}
                  onOpenPeople={go('personas')}
                  onOpenSettings={go('settings')}
                />
              ) : (
                <div className="stack-tight">
                  {/* Where today's coverage is coming from. Only drawn when at
                      least one story names a place the gazetteer can resolve;
                      the rest of the stories are listed below, unpinned and
                      unchanged. */}
                  {newsOrigins.markers.length > 0 && (
                    <NewsOriginCard
                      markers={newsOrigins.markers}
                      placed={newsOrigins.placed}
                      total={b.news.length}
                    />
                  )}

                  <m.ul className="grid gap-3 lg:grid-cols-2" variants={listStagger}>
                    {b.news.map((item) => (
                      <m.li key={item.mention.id} variants={listItem}>
                        <NewsCard item={item} identity={b.identity} onRead={onRead} />
                      </m.li>
                    ))}
                  </m.ul>

                  {/* Found this morning and not yet read. Kept below the read
                      stories rather than mixed in: a headline that matched a
                      search word and a story somebody has actually assessed are
                      different kinds of claim, and merging them would let the
                      weaker one borrow the stronger one's authority. */}
                  {candidates.length > 0 && (
                    <FoundToday
                      count={candidates.length}
                      busy={scan.busy}
                      onRead={go('personas')}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </m.section>

        {/* ── what the constituency is angry about ────────────────────── */}
        {b.issues.length > 0 && (
          <m.section variants={fadeUp} aria-labelledby="issues-heading">
            <Heading
              id="issues-heading"
              title={
                b.identity?.constituency
                  ? `What ${b.identity.constituency} is complaining about`
                  : 'What people are complaining about'
              }
              action={<LinkOut label="Grievance desk" onClick={go('grievances')} />}
            />
            <m.ul className="grid gap-3 lg:grid-cols-2" variants={listStagger}>
              {b.issues.map((issue, i) => (
                <m.li key={issue.id} variants={listItem}>
                  <IssueCard
                    issue={issue}
                    rank={i + 1}
                    onOpen={() => onNavigate('grievances', issue.id)}
                  />
                </m.li>
              ))}
            </m.ul>
          </m.section>
        )}

        {/* ── what the member can say ─────────────────────────────────────
            High on the page rather than at the foot of it. This is the thing
            somebody opens the app for while walking into a press gaggle, and
            anything below the fold at that moment does not exist. */}
        {b.lines.length > 0 && (
          <m.section variants={fadeUp} aria-labelledby="lines-heading">
            <Heading id="lines-heading" title="Lines you could use today" />
            <Card>
              <ol className="space-y-4">
                {b.lines.map((line) => (
                  <li key={line.text}>
                    <p className="flex gap-2.5 text-[15px] leading-relaxed">
                      <Quote size={15} className="mt-1.5 shrink-0 text-[var(--accent-2)]" aria-hidden />
                      <span>{line.text}</span>
                    </p>
                    <p className="mt-1 pl-[26px] text-xs text-ink-3">
                      On:{' '}
                      {line.url ? (
                        <a
                          href={line.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline decoration-[var(--rule)] underline-offset-2 hover:text-ink-2"
                        >
                          {line.source}
                        </a>
                      ) : (
                        line.source
                      )}
                    </p>
                  </li>
                ))}
              </ol>
            </Card>
          </m.section>
        )}

        {/* ── what to do ──────────────────────────────────────────────── */}
        {b.suggestions.length > 0 && (
          <m.section variants={fadeUp} aria-labelledby="do-heading">
            <Heading
              id="do-heading"
              title="What to do about it"
              action={<LinkOut label="Action list" onClick={go('actions')} />}
            />
            <m.ul className="stack-tight" variants={listStagger}>
              {b.suggestions.map((s) => (
                <m.li key={s.sourceId} variants={listItem}>
                  <SuggestionCard suggestion={s} onOpenActions={go('actions')} />
                </m.li>
              ))}
            </m.ul>
          </m.section>
        )}

      </m.div>
    </Shell>
  )
}

/* ── greeting + identity ─────────────────────────────────────────────────── */

/**
 * Who the desk is for, and whether we have them right.
 *
 * The photograph is doing real work rather than decorating: this is a tool an
 * office runs on behalf of one named person, and getting the wrong person is a
 * failure mode that is otherwise invisible — every screen after this would be
 * confidently about somebody else. A face is the fastest possible check.
 */
function Greeting({
  greeting,
  firstName,
  today,
  identity,
  onSetUp,
}: {
  greeting: string
  firstName: string | null
  today: string
  identity: Identity | null
  onSetUp: () => void
}) {
  if (!identity) {
    return (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="kicker">{today}</p>
          <h1 className="display mt-2 text-[clamp(1.5rem,1.1rem+1.8vw,2.75rem)]">
            {greeting}.
          </h1>
          <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-ink-2">
            Nobody has been set up yet.
          </p>
        </div>
        <Button onClick={onSetUp} className="shrink-0">
          <UserRound size={16} />
          Tell it who you are
        </Button>
      </div>
    )
  }

  const unverified = unverifiedFields(identity)
  const facts = [
    identity.role,
    identity.constituency,
    identity.party,
    identity.age !== null ? `${identity.age}` : null,
  ].filter((f): f is string => Boolean(f))

  return (
    <div>
      {/* Side by side only when there is genuinely room, which is not at 640px.
          `sm:flex-row` put the salutation and the platform row on one line from
          640 up, and between there and about 1024 the heading column was left
          so narrow that "Good evening, Narendra." broke over three lines and
          the fact chips turned into tall pills with single words wrapping
          inside them. Stacked is not a compromise at that width, it is the
          correct layout; the row waits for lg. */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar src={identity.photoUrl} name={identity.name} size={48} className="lg:size-[72px]" />

          <div className="min-w-0">
            <p className="kicker">{today}</p>
            {/* Starts smaller on a phone. At 1.75rem the salutation ran to
                two lines beside a 64px avatar and took a fifth of the screen
                to say good evening. It still grows to the same size on a
                desktop, where there is room for it to be the anchor. */}
            <h1 className="display mt-1.5 text-[clamp(1.5rem,1.1rem+1.8vw,2.75rem)] lg:mt-2">
              {greeting}
              {firstName ? `, ${firstName}` : ''}.
            </h1>

            {/* Pills, not a rule-separated run.
                Each fact used to carry its own LEADING divider, so the moment
                the row wrapped, a stray vertical rule started the next line
                with nothing before it. On a phone this line always wraps: role,
                seat, party and age do not fit on 390px. Giving each fact its
                own container removes the possibility rather than tuning the
                breakpoint, and reads as a set of facts rather than as one
                sentence that has been chopped up. */}
            {/* One line on a phone, chips from sm: up.
                Role, seat and party as three bordered chips wrapped to two
                rows at 390px and read as three separate controls, which they
                are not. Interpuncts carry the same facts in one row and half
                the height, and the chips return the moment there is width for
                them on one line. */}
            {facts.length > 0 && (
              <p className="mt-2 text-[13px] leading-snug text-ink-2 lg:hidden">
                {facts.join(' · ')}
              </p>
            )}
            {facts.length > 0 && (
              <ul className="mt-2.5 hidden flex-wrap items-center gap-1.5 lg:flex">
                {facts.map((fact) => (
                  <li
                    key={fact}
                    className="rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-xs text-ink-2"
                  >
                    {fact}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {identity.handles.length > 0 && (
          <ul className="flex shrink-0 flex-wrap items-center gap-1.5">
            {identity.handles.slice(0, 4).map((handle) => (
              <li key={handle.url}>
                <a
                  href={handle.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={`${handle.platform}: @${handle.handle}`}
                  /* Icon only on a phone, icon and name from sm: up.
                     Four named pills wrapped to two rows at 390px, spending
                     about 100px of the first screen to repeat what the badge
                     already says in colour and mark. The name is still on the
                     title and the accessible label, so nothing is lost to a
                     screen reader or a long press. */
                  className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-1.5 text-xs font-medium text-ink-2 shadow-[var(--e1)] transition-colors hover:border-[var(--border-interactive)] hover:text-ink lg:justify-start lg:py-1.5 lg:pl-1.5 lg:pr-3.5"
                  aria-label={`${handle.platform}: @${handle.handle}`}
                >
                  <PlatformBadge platform={handle.platform} size={24} />
                  <span className="hidden lg:inline">{handle.platform}</span>
                  {handle.connected && (
                    <BadgeCheck size={13} className="hidden text-[var(--pos)] lg:inline" aria-hidden />
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* A reading the app is not sure of, offered once, where it can be fixed
          in one tap. Silently carrying a low-confidence constituency is how
          every scan after it quietly searches the wrong seat. */}
      {unverified.length > 0 && (
        <button
          onClick={onSetUp}
          className="mt-4 flex min-h-11 w-full items-center gap-2.5 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--warn)_28%,transparent)] bg-[var(--warn-soft)] px-3.5 py-2.5 text-left transition-opacity hover:opacity-90"
        >
          <CircleAlert size={15} className="shrink-0 text-[var(--warn)]" aria-hidden />
          <span className="min-w-0 flex-1 text-sm leading-snug text-[var(--warn)]">
            {unverified.length === 1
              ? `Your ${unverified[0]} could not be confirmed.`
              : `These could not be confirmed: ${unverified.join(', ')}.`}
          </span>
          <ArrowRight size={14} className="shrink-0 text-[var(--warn)]" aria-hidden />
        </button>
      )}
    </div>
  )
}

/* ── lead ────────────────────────────────────────────────────────────────── */

function LeadCard({
  lead,
  onOpen,
}: {
  lead: ReturnType<typeof briefingOf>['lead']
  onOpen: (to: Destination) => void
}) {
  const tone = {
    critical: { colour: 'var(--neg)', soft: 'var(--neg-soft)', Icon: OctagonAlert },
    warning: { colour: 'var(--warn)', soft: 'var(--warn-soft)', Icon: TriangleAlert },
    calm: { colour: 'var(--pos)', soft: 'var(--pos-soft)', Icon: CheckCircle2 },
  }[lead.tone]

  return (
    <Card level="lift">
      <div className="absolute inset-y-0 left-0 w-1" style={{ background: tone.colour }} aria-hidden />
      <div className="flex items-start gap-3.5 pl-1.5">
        <span
          className="icon-badge mt-0.5"
          style={{ background: tone.soft, color: tone.colour }}
        >
          <tone.Icon size={19} aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <p id="lead-heading" className="kicker">
            Needs you today
          </p>
          <p className="mt-1.5 text-lg font-bold leading-snug tracking-[-0.015em]">
            {lead.line}
          </p>
          {lead.detail && (
            <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-2">{lead.detail}</p>
          )}
          <Button className="mt-3.5" size="sm" onClick={() => onOpen(lead.to)}>
            {lead.cta}
            <ArrowRight size={14} />
          </Button>
        </div>
      </div>
    </Card>
  )
}

/* ── the morning scan ────────────────────────────────────────────────────── */

/**
 * What the desk did without being asked, and what it found.
 *
 * Four genuinely different situations, and collapsing them into one apologetic
 * empty box is what made the old screen useless: an office could not tell
 * "nothing happened today" from "this was never set up" from "the papers are
 * refusing us". Each has a different fix and each says which.
 */
function ScanPanel({
  scan,
  candidates,
  onOpenPeople,
  onOpenSettings,
}: {
  scan: ReturnType<typeof useMorningScan>
  candidates: { url: string; title: string; portal: string }[]
  onOpenPeople: () => void
  onOpenSettings: () => void
}) {
  /* the desk cannot scan at all */
  if (scan.blocked) {
    return (
      <Empty
        icon={<CircleAlert size={18} aria-hidden />}
        title="The papers are not being read"
        body={scan.blocked}
        action={
          <Button size="sm" onClick={onOpenSettings}>
            Choose the papers to read
          </Button>
        }
      />
    )
  }

  /* it is happening right now */
  if (scan.busy) {
    return (
      <Card>
        <div className="flex items-center gap-3.5">
          <span
            className="icon-badge"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <RefreshCw size={17} className="animate-spin" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-bold">Reading this morning&rsquo;s papers…</p>
          </div>
        </div>
      </Card>
    )
  }

  /* it ran and found stories nobody has read */
  if (candidates.length > 0) {
    return <FoundToday count={candidates.length} busy={false} onRead={onOpenPeople} />
  }

  /* it failed */
  if (scan.error) {
    return (
      <Empty
        icon={<CircleAlert size={18} aria-hidden />}
        title="The papers could not be read"
        body={scan.error}
        action={
          <Button size="sm" onClick={() => scan.run(true)}>
            <RefreshCw size={15} />
            Try again
          </Button>
        }
      />
    )
  }

  /* It ran and there was genuinely nothing — or it has not run at all yet.
     Two different truths, and they used to share one headline: "Nothing in
     this morning's papers names you" over "The papers have not been read yet"
     asserted a result the line below admitted was never computed. The desk
     may only claim an absence it actually checked. */
  const dead = scan.sources.filter((s) => s.error !== null)

  if (!scan.lastAt) {
    return (
      <Empty
        icon={<ScanEye size={18} aria-hidden />}
        title="The papers have not been read yet"
        body="Nothing is known about this morning until they are."
        action={
          <Button size="sm" variant="outline" onClick={() => scan.run(true)}>
            <RefreshCw size={15} />
            Read them now
          </Button>
        }
      />
    )
  }

  return (
    <Empty
      icon={<ScanEye size={18} aria-hidden />}
      title="Nothing in this morning&rsquo;s papers names you"
      body={`${scan.sources.length} mastheads were read ${relativeTime(scan.lastAt)}${
        dead.length > 0 ? `, and ${dead.length} did not answer.` : '.'
      }`}
      action={
        <Button size="sm" variant="outline" onClick={() => scan.run(true)}>
          <RefreshCw size={15} />
          Read them again
        </Button>
      }
    />
  )
}

/**
 * Stories found but not yet assessed.
 *
 * The count is a headline match, not a reading, and the copy says so. Reading
 * them is two model calls per story and is the one thing here that spends
 * money, so it stays behind a press.
 */
function FoundToday({
  count,
  busy,
  onRead,
}: {
  count: number
  busy: boolean
  onRead: () => void
}) {
  return (
    <Card tone="accent">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <span
            className="icon-badge"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <Newspaper size={18} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-bold">
              {count} {count === 1 ? 'story' : 'stories'} in today&rsquo;s papers mention you
            </p>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">Not read yet.</p>
          </div>
        </div>
        <Button size="sm" className="shrink-0" onClick={onRead} disabled={busy}>
          <ScanEye size={15} />
          Read {count === 1 ? 'it' : 'them'}
        </Button>
      </div>
    </Card>
  )
}

/* ── where the news comes from ───────────────────────────────────────────── */

/**
 * A story's tone, collapsed to the three the map can colour. A flagged or
 * critical story reads red, a supportive one green, everything else amber —
 * the same safety-first order the rest of this screen uses, so a place with
 * one hostile story is never painted calm by two routine ones beside it.
 */
function storyTone(item: NewsItem): 'neg' | 'pos' | 'mid' {
  if (item.suspect || item.mention.stance === 'critical') return 'neg'
  if (item.mention.stance === 'supportive') return 'pos'
  return 'mid'
}

/**
 * Reduce the read stories to weighted map markers, one per resolved place.
 *
 * Stories are grouped by the location their free-text place resolves to, so two
 * stories out of Hyderabad make one heavier marker rather than two stacked
 * pins. Marker weight follows how many stories a place carries; its colour
 * follows the strongest tone among them. `placed` counts the stories that were
 * actually mapped, so the card can say honestly how many were not.
 */
function newsOriginMap(news: NewsItem[]): { markers: MapMarker[]; placed: number } {
  const byKey = new Map<string, { place: Place; count: number; tones: Set<'neg' | 'pos' | 'mid'> }>()
  let placed = 0

  for (const item of news) {
    const place = geocodePlace(item.mention.place)
    if (!place) continue // never a pin we cannot honestly place
    placed += 1
    const key = `${place.lon},${place.lat}`
    const bucket = byKey.get(key)
    if (bucket) {
      bucket.count += 1
      bucket.tones.add(storyTone(item))
    } else {
      byKey.set(key, { place, count: 1, tones: new Set([storyTone(item)]) })
    }
  }

  const buckets = [...byKey.values()]
  if (buckets.length === 0) return { markers: [], placed }
  const maxCount = Math.max(...buckets.map((x) => x.count))

  const markers = buckets.map(({ place, count, tones }): MapMarker => {
    const tone: MapMarker['tone'] = tones.has('neg') ? 'negative' : tones.has('pos') ? 'positive' : 'warning'
    const word = tone === 'negative' ? 'critical or flagged' : tone === 'positive' ? 'supportive' : 'neutral'
    return {
      lon: place.lon,
      lat: place.lat,
      label: place.name,
      detail: `${place.state} · ${count} ${count === 1 ? 'story' : 'stories'} · ${word}`,
      tone,
      weight: 0.35 + 0.65 * (count / maxCount),
    }
  })

  return { markers, placed }
}

/**
 * The news-origin map card. Marker size reads how much of the morning's
 * coverage a place carries; marker colour reads its tone. Stories the
 * gazetteer cannot place are counted openly and left in the list below.
 */
function NewsOriginCard({ markers, placed, total }: { markers: MapMarker[]; placed: number; total: number }) {
  const tones = new Set(markers.map((mk) => mk.tone))
  const legend = [
    { tone: 'negative' as const, label: 'Critical or flagged', colour: 'var(--neg)' },
    { tone: 'positive' as const, label: 'Supportive', colour: 'var(--pos)' },
    { tone: 'warning' as const, label: 'Neutral', colour: 'var(--warn)' },
  ].filter((l) => tones.has(l.tone))

  return (
    <Card className="p-4 sm:p-6">
      {/* The standard opening; the explanation stays a full paragraph below it
          because CardHead's one-line sub would truncate the honest count. */}
      <CardHead
        icon={<MapPin size={16} aria-hidden />}
        tint="blue"
        title="Where today’s news is coming from"
        className="mb-2"
      />
      <p className="tnum text-sm leading-relaxed text-ink-2">
        {placed} of {total} {total === 1 ? 'story' : 'stories'} placed on the map.
      </p>

      <div className="mt-4">
        <IndiaMap dots={INDIA_DOTS} bbox={INDIA_BBOX} markers={markers} className="mx-auto max-w-[380px]" />
      </div>

      {legend.length > 0 && (
        <ul className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1.5">
          {legend.map((seg) => (
            <li key={seg.label} className="flex items-center gap-2 text-xs text-ink-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: seg.colour }} />
              {seg.label}
            </li>
          ))}
        </ul>
      )}

      {total > placed && (
        <p className="mt-3 border-t border-[var(--rule)] pt-3 text-xs leading-relaxed text-ink-3">
          {total - placed} {total - placed === 1 ? 'story' : 'stories'} not mapped.
        </p>
      )}
    </Card>
  )
}

/* ── one story ───────────────────────────────────────────────────────────── */

const STANCE_TONE: Record<string, ChipTone> = {
  supportive: 'positive',
  critical: 'negative',
  neutral: 'neutral',
  unclear: 'neutral',
}

const STANCE_LABEL: Record<string, string> = {
  supportive: 'Supportive',
  critical: 'Critical',
  neutral: 'Neutral',
  unclear: 'Stance unclear',
}

function NewsCard({
  item,
  identity,
  onRead,
}: {
  item: NewsItem
  /** Needed to name the seat and the party in the relevance chip. */
  identity: Identity | null
  onRead: (postUrl: string) => void
}) {
  const { mention, suspect } = item
  const when = mention.publishedAt ?? mention.seenAt
  // Only chipped when the free-text place resolves against the gazetteer, so a
  // location shown here is one the map can also carry — never a guess.
  const place = useMemo(() => geocodePlace(mention.place), [mention.place])

  // The soft icon badge is tinted by what kind of story this is — flagged
  // first, then by stance. The tint repeats the chip's reading; it never
  // replaces it.
  const badge = suspect
    ? { bg: 'var(--neg-soft)', fg: 'var(--neg)', Icon: ScanEye }
    : mention.stance === 'critical'
      ? { bg: 'var(--warn-soft)', fg: 'var(--warn)', Icon: Newspaper }
      : mention.stance === 'supportive'
        ? { bg: 'var(--pos-soft)', fg: 'var(--pos)', Icon: Newspaper }
        : { bg: 'var(--accent-soft)', fg: 'var(--accent)', Icon: Newspaper }

  return (
    <Card
      className={cn(
        'h-full',
        // The one visual difference that matters, and it is a border rather
        // than a fill: a card flooded with red reads as an error state, and
        // this is a story somebody still has to judge.
        suspect && 'border-[color-mix(in_oklab,var(--neg)_45%,var(--rule))]',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className="icon-badge icon-badge-sm mt-0.5"
          style={{ background: badge.bg, color: badge.fg }}
        >
          <badge.Icon size={16} aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {suspect && (
              <Chip tone="negative" icon={<ScanEye size={11} aria-hidden />}>
                Check this
              </Chip>
            )}
            <Chip tone={STANCE_TONE[mention.stance] ?? 'neutral'}>
              {STANCE_LABEL[mention.stance] ?? mention.stance}
            </Chip>
            {/* Says when a story is about the seat or the party rather than
                about the member, and when it has not been checked at all.
                Without it a story about the constituency reads as a story
                about her, which is the quieter half of the same complaint
                that put a cricket fixture on this desk. */}
            <RelevanceChip verdict={item.verdict} identity={identity} />
            {mention.publisher && (
              <span className="text-xs font-medium text-ink-3">{mention.publisher}</span>
            )}
            {when && <span className="text-xs text-ink-3">· {relativeTime(when)}</span>}
            {place && (
              <span
                className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-ink-2"
                title={`${place.name}, ${place.state}`}
              >
                <MapPin size={11} className="text-[var(--accent)]" aria-hidden />
                {place.name}
              </span>
            )}
          </div>

          <h3 className="mt-2.5 text-[15px] font-bold leading-snug">
            <button
              type="button"
              onClick={() => onRead(mention.url)}
              className="text-left underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--accent)]"
            >
              {mention.headline}
            </button>
          </h3>

          {/* The full reading here, the original a tap away. A headline that only
              ever led out to the publisher meant the office did its own reading on
              the publisher's site — losing the translation, the stance and the
              fake-news check this card is announcing. */}
          <span className="mt-1 flex items-center gap-3">
            <button
              type="button"
              onClick={() => onRead(mention.url)}
              className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
            >
              <ScanEye size={12} aria-hidden />
              Read it fully
            </button>
            <a
              href={mention.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-h-11 items-center gap-1 text-xs text-ink-3 hover:text-ink-2"
            >
              <ExternalLink size={11} aria-hidden />
              open
            </a>
          </span>

          {mention.summary && (
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-2">{mention.summary}</p>
          )}

          {/* What was actually observed, in the reader's own words. A "suspected
              fake" badge with no reason attached is an accusation the office cannot
              defend, and this product is in the business of the opposite. */}
          {suspect && mention.fake?.note && (
            <p className="mt-3 border-t border-[var(--rule)] pt-3 text-sm leading-relaxed text-ink-2">
              <span className="font-medium text-[var(--neg)]">Why it was flagged: </span>
              {mention.fake.note}
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}

/* ── one issue ───────────────────────────────────────────────────────────── */

const SEVERITY_TONE: Record<string, ChipTone> = {
  Critical: 'negative',
  High: 'warning',
  Medium: 'accent',
  Low: 'neutral',
}

/** The soft badge tint that pairs with each severity / priority chip. */
const LEVEL_BADGE: Record<string, { background: string; color: string }> = {
  Critical: { background: 'var(--neg-soft)', color: 'var(--neg)' },
  High: { background: 'var(--warn-soft)', color: 'var(--warn)' },
  Medium: { background: 'var(--accent-soft)', color: 'var(--accent)' },
  Low: { background: 'var(--surface-3)', color: 'var(--text-3)' },
}

function IssueCard({
  issue,
  rank,
  onOpen,
}: {
  issue: RankedIssue
  rank: number
  onOpen: () => void
}) {
  return (
    <button
      onClick={onOpen}
      className="card card-hover flex h-full min-h-11 w-full cursor-pointer items-start gap-3 p-4 text-left sm:p-5"
    >
      <span
        className="grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-bold"
        style={LEVEL_BADGE[issue.severity] ?? LEVEL_BADGE['Low']}
      >
        {rank}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-bold leading-snug">{issue.title}</span>
          <Chip tone={SEVERITY_TONE[issue.severity] ?? 'neutral'}>{issue.severity}</Chip>
        </span>

        {issue.summary && (
          <span className="mt-1 line-clamp-2 block text-sm leading-relaxed text-ink-2">
            {issue.summary}
          </span>
        )}

        <span className="mt-2 block text-xs text-ink-3">
          {issue.count} {issue.count === 1 ? 'item' : 'items'}
          {issue.tallied ? ' mention this topic' : ' in this issue'}
        </span>
      </span>

      <ArrowRight size={15} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
    </button>
  )
}

/* ── one suggestion ──────────────────────────────────────────────────────── */

const PRIORITY_TONE: Record<string, ChipTone> = {
  Critical: 'negative',
  High: 'warning',
  Medium: 'accent',
  Low: 'neutral',
}

/**
 * A recommendation, and the one button that turns it into work.
 *
 * The button reports what happened rather than optimistically re-rendering:
 * filing is the only thing on this screen that writes a record somebody else
 * will be held to, and an office needs to see that it landed.
 */
function SuggestionCard({
  suggestion,
  onOpenActions,
}: {
  suggestion: Suggestion
  onOpenActions: () => void
}) {
  const [filed, setFiled] = useState(suggestion.filed)
  const rec = suggestion.recommendation

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className="icon-badge icon-badge-sm mt-0.5"
            style={LEVEL_BADGE[rec.priority] ?? LEVEL_BADGE['Medium']}
          >
            <ListChecks size={16} aria-hidden />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={PRIORITY_TONE[rec.priority] ?? 'neutral'}>{rec.priority}</Chip>
              <span className="text-sm font-bold">{rec.action}</span>
            </div>

            <p className="mt-2 text-sm leading-relaxed text-ink-2">{rec.rationale}</p>

            <p className="mt-2 text-xs text-ink-3">
              On:{' '}
              {suggestion.url ? (
                <a
                  href={suggestion.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 underline decoration-[var(--rule)] underline-offset-2 hover:text-ink-2"
                >
                  {suggestion.headline}
                  <ExternalLink size={11} aria-hidden />
                </a>
              ) : (
                suggestion.headline
              )}
            </p>

            {rec.talkingPoints.length > 0 && (
              <details className="group mt-3">
                <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs font-medium text-ink-3 hover:text-ink-2">
                  {rec.talkingPoints.length} line
                  {rec.talkingPoints.length === 1 ? '' : 's'} you could say
                  <span className="ml-1 inline-block transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <ul className="mt-2 space-y-2 border-l border-[var(--rule)] pl-3">
                  {rec.talkingPoints.map((point) => (
                    <li key={point} className="text-sm leading-relaxed text-ink-2">
                      {point}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>

        <div className="shrink-0">
          {filed ? (
            <button
              onClick={onOpenActions}
              className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--pos)_35%,transparent)] bg-[var(--pos-soft)] px-3.5 text-sm font-medium text-[var(--pos)]"
            >
              <Check size={15} aria-hidden />
              On the action list
            </button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                fileAction(rec, {
                  id: suggestion.sourceId,
                  headline: suggestion.headline,
                  url: suggestion.url,
                  publisher: suggestion.publisher,
                  subject: suggestion.subject,
                  raisedFrom: 'dashboard',
                })
                setFiled(true)
              }}
            >
              <Plus size={15} />
              Add to actions
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

/* ── small parts ─────────────────────────────────────────────────────────── */

function Heading({
  id,
  title,
  hint,
  action,
}: {
  id: string
  title: string
  hint?: string
  action?: React.ReactNode
}) {
  return (
    <div className="section-head">
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-semibold tracking-[-0.011em]">
          {title}
        </h2>
        {hint && <p className="measure mt-1.5 text-sm leading-relaxed text-ink-3">{hint}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function LinkOut({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap text-sm font-semibold text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)]"
    >
      {label}
      <ArrowRight size={14} aria-hidden />
    </button>
  )
}
