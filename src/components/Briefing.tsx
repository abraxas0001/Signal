import { useMemo, useState } from 'react'
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
  Lock,
  MapPin,
  Megaphone,
  MessageSquare,
  Newspaper,
  OctagonAlert,
  Plus,
  Quote,
  RefreshCw,
  ScanEye,
  TrendingUp,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react'
import type { Identity } from '@shared/identity'
import { unverifiedFields } from '@shared/identity'
import { useStore } from '@/lib/store'
import {
  briefingOf,
  type Mood,
  type NewsItem,
  type InfluencerVoice,
  type Perception,
  type RankedIssue,
  type VoiceOf,
  type Suggestion,
} from '@/lib/briefing'
import { fileAction } from '@/lib/actions'
import { useMorningScan } from '@/lib/morning-scan'
import { useOpinion } from '@/lib/opinion'
import { OpinionPanel } from './OpinionPanel'
import { Avatar, Button, Card, Chip, Empty, Shell, type ChipTone } from './ui'
import {
  CardHead,
  ColumnChart,
  DonutBreakdown,
  HBarBoard,
  IconStat,
  IndiaMap,
  Legend,
  LineChart,
  PlatformBadge,
  PostThumbCard,
  RankRow,
  seriesColor,
  youtubeThumb,
  type MapMarker,
} from '@/components/kit'
import { geocodePlace, partyColor, type Place } from './gazetteer'
import { INDIA_DOTS, INDIA_BBOX } from './india-dots'
import { listHandles, type TrackedHandle } from '@/lib/handles'
import { cn, compact, full, relativeTime } from '@/lib/utils'
import { fadeUp, listItem, listStagger } from '@/lib/motion'

/**
 * The dashboard.
 *
 * What was here before was a good screen about the wrong subject. It reported
 * on the tool — items captured, topics ranked, counters that opened lists — and
 * every figure on it was a door to another screen. That is a table of contents,
 * and a member's office does not open a table of contents at 7am.
 *
 * This one answers the three questions they actually arrive with, in the order
 * they arrive in:
 *
 *   Who am I to this thing, and does it have me right?   — the identity card
 *   What is being said about me?                          — mood, then the news
 *   Is any of it wrong, and what do I do?                 — flags, then actions
 *
 * Everything that used to live here and answers none of those has gone back to
 * the screen it belongs on. The counters are on the grievance desk, the topic
 * ranking is on the grievance desk, the navigation shortcuts are in the
 * navigation. None of it was deleted; it stopped being duplicated here.
 *
 * The hardest rule to hold is the last one: no section invents content to avoid
 * looking empty. A desk with no news gets a sentence saying so and a button
 * that fetches some. This product's whole claim is that it will tell an office
 * when something is unsupported — a dashboard that pads itself has no standing
 * to make that claim.
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

        {/* ── the desk at a glance ────────────────────────────────────────
            The office's own ground and reach, surfaced on the home so the
            dashboard reads as a live desk rather than an empty inbox before
            the morning scan lands. Everything here is read from the tracked
            accounts and the identity this device already holds. */}
        {(handles.length > 0 || b.identity !== null) && (
          <m.section variants={fadeUp} aria-labelledby="desk-heading">
            <h2 id="desk-heading" className="sr-only">
              Your desk at a glance
            </h2>
            <DeskOverview
              handles={handles}
              identity={b.identity}
              onManage={() => onNavigate('accounts')}
              onRead={onRead}
            />
          </m.section>
        )}

        {/* ── the morning in numbers ──────────────────────────────────────
            The counts this screen already computes, as quiet tiles rather
            than doors: none of them navigates, and none carries a delta,
            because no second reading on another day exists to compare
            against. Hidden entirely while every count is zero — a row of
            zeros is padding, not a briefing. */}
        {b.identity !== null &&
          (b.news.length > 0 ||
            b.mood.commentsRead > 0 ||
            b.voice.total > 0 ||
            b.issues.length > 0) && (
            <m.div
              className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
              variants={listStagger}
            >
              <m.div variants={listItem}>
                <IconStat
                  className="h-full"
                  icon={<Newspaper size={18} aria-hidden />}
                  label="Stories worth noticing"
                  value={b.news.length}
                  tint="blue"
                  deltaLabel={b.windowLabel}
                />
              </m.div>
              <m.div variants={listItem}>
                <IconStat
                  className="h-full"
                  icon={<MessageSquare size={18} aria-hidden />}
                  label="Comments read"
                  value={b.mood.commentsRead}
                  tint="violet"
                  deltaLabel={
                    b.mood.postsRead > 0
                      ? `Under ${b.mood.postsRead} of your own posts`
                      : b.windowLabel
                  }
                />
              </m.div>
              <m.div variants={listItem}>
                <IconStat
                  className="h-full"
                  icon={<Megaphone size={18} aria-hidden />}
                  label="Local-account posts"
                  value={b.voice.total}
                  tint="orange"
                  deltaLabel={b.windowLabel}
                />
              </m.div>
              <m.div variants={listItem}>
                <IconStat
                  className="h-full"
                  icon={<ListChecks size={18} aria-hidden />}
                  label="Complaint topics"
                  value={b.issues.length}
                  tint="teal"
                  deltaLabel={b.windowLabel}
                />
              </m.div>
            </m.div>
          )}

        {/* ── the one thing ───────────────────────────────────────────── */}
        <m.section variants={fadeUp} aria-labelledby="lead-heading">
          <LeadCard lead={b.lead} onOpen={(to) => onNavigate(to)} />
        </m.section>

        {/* ── what people think ───────────────────────────────────────── */}
        <m.section variants={fadeUp} aria-labelledby="mood-heading">
          <Heading
            id="mood-heading"
            title="What people are saying"
            hint={
              b.mood.commentsRead > 0
                ? `From ${b.mood.commentsRead.toLocaleString('en-IN')} comments under ${b.mood.postsRead} of your own posts.`
                : undefined
            }
            action={
              /* "Against a rival" is unconditional, and that is the point: the
                 compare screen lives in the desktop sidebar, and the sidebar
                 is `lg:` and up. On the mid-range Android this product is
                 actually used on there was no route to it from anywhere —
                 the tab bar has five slots and none of them is Compare, and
                 nothing else on this screen linked it. A feature reachable
                 only on a laptop is a feature this office does not have. */
              <span className="flex items-center gap-3">
                {b.mood.commentsRead > 0 && (
                  <LinkOut label="Per account" onClick={go('accounts')} />
                )}
                <LinkOut label="Against a rival" onClick={go('compare')} />
              </span>
            }
          />
          {/* Two readings, never averaged. Comments are the public in its own
              words and are the better source; coverage is what the press is
              saying, which is what the public will read next. Blending them
              would let three commenters cancel a week of hostile front pages.
              Whichever exists is shown, labelled. */}
          {/* Three readings, in descending order of how directly they hear from
              the public: comments people actually left, then the published
              record, then a gated-account explanation. Never averaged — they
              answer different questions and blending them answers none. */}
          {b.mood.commentsRead > 0 ? (
            <MoodPanel mood={b.mood} onOpenAccounts={go('accounts')} />
          ) : opinion.survey || opinion.busy ? (
            <OpinionPanel
              survey={opinion.survey}
              person={b.identity}
              onOpenActions={go('actions')}
              busy={opinion.busy}
              stage={opinion.stage}
              error={opinion.error}
              onRefresh={opinion.refresh}
            />
          ) : b.mood.gated.length > 0 ? (
            /* Gated accounts route here too. Without that the explanation for
               "I added my Facebook page and nothing happened" lived inside a
               panel that only renders once comments exist — which for a gated
               account is never, so the one message that answered the question
               was unreachable. */
            <MoodPanel mood={b.mood} onOpenAccounts={go('accounts')} />
          ) : (
            <PerceptionPanel
              perception={b.perception}
              onOpenCoverage={go('personas')}
              onOpenAccounts={go('accounts')}
            />
          )}
        </m.section>

        {/* ── what the local accounts are saying ──────────────────────── */}
        <m.section variants={fadeUp} aria-labelledby="voice-heading">
          <Heading
            id="voice-heading"
            title="What local accounts are saying about you"
            hint={
              b.voice.total > 0
                ? `${b.voice.total} ${b.voice.total === 1 ? 'post' : 'posts'} from ${b.voice.readable} ${b.voice.readable === 1 ? 'account' : 'accounts'} with an audience where you stand.`
                : undefined
            }
            action={
              b.voice.total > 0 ? (
                <LinkOut label="All accounts" onClick={go('influencers')} />
              ) : undefined
            }
          />
          <VoicePanel
            voice={b.voice}
            busy={scan.influencersBusy}
            onOpenInfluencers={go("influencers")}
            onRead={onRead}
          />
        </m.section>

        {/* ── the news ────────────────────────────────────────────────── */}
        <m.section variants={fadeUp} aria-labelledby="news-heading">
          <Heading
            id="news-heading"
            title="Today’s news worth noticing"
            hint={
              b.news.length > 0
                ? 'Anything questionable first, then anything critical. Not simply the newest.'
                : undefined
            }
            action={
              b.news.length > 0 ? (
                <LinkOut label="All coverage" onClick={go('personas')} />
              ) : undefined
            }
          />

          {b.news.length === 0 ? (
            <ScanPanel
              scan={scan}
              candidates={candidates}
              onOpenPeople={go('personas')}
              onOpenSettings={go('settings')}
            />
          ) : (
            <>
              {/* Where today's coverage is coming from. Only drawn when at least
                  one story names a place the gazetteer can resolve; the rest of
                  the stories are listed below, unpinned and unchanged. */}
              {newsOrigins.markers.length > 0 && (
                <div className="mb-4">
                  <NewsOriginCard
                    markers={newsOrigins.markers}
                    placed={newsOrigins.placed}
                    total={b.news.length}
                  />
                </div>
              )}

              <m.ul className="grid gap-3 lg:grid-cols-2" variants={listStagger}>
                {b.news.map((item) => (
                  <m.li key={item.mention.id} variants={listItem}>
                    <NewsCard item={item} onRead={onRead} />
                  </m.li>
                ))}
              </m.ul>

              {/* Found this morning and not yet read. Kept below the read
                  stories rather than mixed in: a headline that matched a search
                  word and a story somebody has actually assessed are different
                  kinds of claim, and merging them would let the weaker one
                  borrow the stronger one's authority. */}
              {candidates.length > 0 && (
                <div className="mt-4">
                  <FoundToday
                    count={candidates.length}
                    busy={scan.busy}
                    onRead={go('personas')}
                  />
                </div>
              )}
            </>
          )}
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
              hint={
                b.issues[0]?.tallied
                  ? 'Counted by topic. These have not been grouped into issues yet, so a count is a count of items, not of people.'
                  : 'Ranked by severity first, then by how many items each one covers.'
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
            <Heading
              id="lines-heading"
              title="Lines you could use today"
              hint="Word for word, against the story named under each."
            />
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
              hint="Nothing is actioned until you add it."
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

        <m.p variants={fadeUp} className="pt-1 text-xs leading-relaxed text-ink-3">
          Everything on this screen is read from records held on this device. Nothing has been
          uploaded anywhere.
        </m.p>
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
          <h1 className="hed mt-2 text-[clamp(1.75rem,1.3rem+1.8vw,2.4rem)] leading-[1.08]">
            {greeting}.
          </h1>
          <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-ink-2">
            Nobody has been set up yet, so there is nothing to scan for.
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
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar src={identity.photoUrl} name={identity.name} size={64} className="sm:size-[76px]" />

          <div className="min-w-0">
            <p className="kicker">{today}</p>
            <h1 className="hed mt-2 text-[clamp(1.75rem,1.3rem+1.8vw,2.4rem)] leading-[1.08]">
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
            {facts.length > 0 && (
              <ul className="mt-2.5 flex flex-wrap items-center gap-1.5">
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
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-1.5 pr-3.5 text-xs font-medium text-ink-2 shadow-[var(--e1)] transition-colors hover:border-[var(--border-interactive)] hover:text-ink"
                >
                  <PlatformBadge platform={handle.platform} size={24} />
                  {handle.platform}
                  {handle.connected && <BadgeCheck size={13} className="text-[var(--pos)]" aria-hidden />}
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
              : `These could not be confirmed: ${unverified.join(', ')}.`}{' '}
            The news scan searches on {unverified.length === 1 ? 'it' : 'them'}, so a wrong
            one finds nothing rather than erroring.
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

/* ── mood ────────────────────────────────────────────────────────────────── */

/**
 * What the comments under this office's own posts actually say.
 *
 * The sentence is the finding and the bar is the evidence, not the other way
 * round: a stacked bar on its own asks the reader to compare two lengths and
 * work out what it means, which is the arithmetic this screen exists to do for
 * them. Underneath, the actual complaints — because "62% negative" tells an
 * office that something is wrong and not one useful thing about what.
 *
 * Three empty states, and they are genuinely different problems with different
 * fixes, so they are not collapsed into one apologetic box:
 *   · no account is marked as yours       → mark one on Accounts
 *   · accounts are marked but never read  → run the reading
 *   · read, but too few comments to trust → shown, with the caveat attached
 */
function MoodPanel({ mood, onOpenAccounts }: { mood: Mood; onOpenAccounts: () => void }) {
  if (mood.noAccounts) {
    return (
      <Empty
        icon={<UserRound size={18} aria-hidden />}
        title="No account of yours is being read"
        body="Add your handles on the Accounts screen and mark them as yours."
        action={
          <Button size="sm" onClick={onOpenAccounts}>
            <Plus size={15} />
            Add your accounts
          </Button>
        }
      />
    )
  }

  /*
    Added an account and saw nothing? This is why.

    Facebook, Instagram, X and LinkedIn publish NOTHING about an account to an
    unauthenticated reader — not posts, not comments, at any price short of a
    login. Somebody who adds their Facebook page and is then told "no account of
    yours is being read", with a button offering to add an account, has been
    told the opposite of the truth: the app has their account and cannot use it.
  */
  if (mood.accounts.length === 0 && mood.gated.length > 0) {
    const platforms = [...new Set(mood.gated.map((h) => h.platform))]
    return (
      <Empty
        icon={<Lock size={18} aria-hidden />}
        title={`Your ${platforms.join(' and ')} ${mood.gated.length === 1 ? 'account is added but cannot be read' : 'accounts are added but cannot be read'}`}
        body={`${platforms.join(' and ')} show a server nothing at all about an account, not posts and not comments, until the account itself authorises it. Adding the handle is not enough, and nothing you do on this screen will change that. It needs connecting on the Settings screen, which needs an app registered with the platform.`}
        action={
          <Button size="sm" variant="outline" onClick={onOpenAccounts}>
            <Plus size={15} />
            Add a YouTube account instead
          </Button>
        }
      />
    )
  }

  if (mood.accounts.length === 0) {
    return (
      <Empty
        icon={<MessageSquare size={18} aria-hidden />}
        title={`${mood.unmeasured.length} of your ${mood.unmeasured.length === 1 ? 'account is' : 'accounts are'} not read yet`}
        body="Comment reading runs when you ask for it, not on its own."
        action={
          <Button size="sm" onClick={onOpenAccounts}>
            <RefreshCw size={15} />
            Read the comments
          </Button>
        }
      />
    )
  }

  const score = mood.score ?? 0
  const verdict =
    score > 30
      ? 'People are warm about you.'
      : score > 8
        ? 'Leaning positive.'
        : score < -30
          ? 'People are hostile.'
          : score < -8
            ? 'Leaning negative.'
            : 'Genuinely divided.'

  const segments = [
    { label: 'Positive', n: mood.positive, colour: 'var(--chart-pos)' },
    { label: 'Neutral', n: mood.neutral, colour: 'var(--chart-mid)' },
    { label: 'Negative', n: mood.negative, colour: 'var(--chart-neg)' },
  ]

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-lg font-bold leading-snug tracking-[-0.015em]">{verdict}</p>
        <p className="tnum text-sm text-ink-3">
          {mood.commentsRead.toLocaleString('en-IN')} comments read
        </p>
      </div>

      {/* Position and a written percentage both carry the value, so the
          reading survives without colour vision. */}
      <div
        className="mt-4 flex h-3 w-full gap-[3px]"
        role="img"
        aria-label={`${mood.positive}% positive, ${mood.neutral}% neutral, ${mood.negative}% negative`}
      >
        {segments.map((seg) =>
          seg.n === 0 ? null : (
            <span
              key={seg.label}
              className="h-full rounded-full"
              style={{ flexGrow: seg.n, background: seg.colour }}
            />
          ),
        )}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((seg) => (
          <li key={seg.label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ background: seg.colour }}
            />
            <span className="text-ink-2">{seg.label}</span>
            <span className="tnum font-semibold">{seg.n}%</span>
          </li>
        ))}
      </ul>

      {/* The half an office can act on. Criticism first and deliberately: an
          office reading this at 7am needs the complaint, not the compliment. */}
      {(mood.criticism.length > 0 || mood.praise.length > 0) && (
        <div className="mt-4 grid gap-x-8 gap-y-4 border-t border-[var(--rule)] pt-4 sm:grid-cols-2">
          {mood.criticism.length > 0 && (
            <div>
              <p className="kicker text-[var(--neg)]">What they complain about</p>
              <ul className="mt-2 space-y-1.5">
                {mood.criticism.map((line) => (
                  <li key={line} className="flex gap-2 text-sm leading-relaxed text-ink-2">
                    <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-[var(--neg)]" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {mood.praise.length > 0 && (
            <div>
              <p className="kicker text-[var(--pos)]">What they credit you for</p>
              <ul className="mt-2 space-y-1.5">
                {mood.praise.map((line) => (
                  <li key={line} className="flex gap-2 text-sm leading-relaxed text-ink-2">
                    <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-[var(--pos)]" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Which accounts this rests on, named — always, including when there is
          only one. This is not a detail for power users: a reading taken from
          the wrong account is otherwise indistinguishable from a reading taken
          from the right one, and the first time that happened the screen
          cheerfully reported an unrelated national figure's fan comments as
          what this office's constituents think. Naming the source is what makes
          that visible in the second it appears. */}
      {mood.accounts.length > 0 && (
        <div className="mt-4 border-t border-[var(--rule)] pt-3.5">
          <p className="kicker">Read from your accounts</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {mood.accounts.map((a) => (
              /* A long YouTube handle made this one chip wider than a phone
                 and dragged the whole card into horizontal overflow; the chip
                 now ellipsizes inside the card instead. The full reading rides
                 on the row that follows and on the Accounts screen. */
              <li key={`${a.platform}-${a.handle}`} className="min-w-0 max-w-full">
                <Chip className="max-w-full">
                  <span className="min-w-0 truncate">
                    {a.platform} · {a.handle} · {a.standing.commentsRead} comments
                  </span>
                </Chip>
              </li>
            ))}
          </ul>
          <button
            onClick={onOpenAccounts}
            className="mt-1 inline-flex min-h-11 items-center text-xs font-medium text-ink-3 underline decoration-[var(--rule)] underline-offset-4 hover:text-ink-2"
          >
            Not your account? Fix it on Accounts
          </button>
        </div>
      )}

      {mood.thin && (
        <p className="mt-3.5 border-t border-[var(--rule)] pt-3 text-xs leading-relaxed text-ink-3">
          Only {mood.commentsRead} comments were read, which is too few to call a mood. Treat
          this as a handful of examples rather than a measurement.
        </p>
      )}

      {mood.gated.length > 0 && (
        <p className="mt-2 text-xs leading-relaxed text-ink-3">
          Your {[...new Set(mood.gated.map((h) => h.platform))].join(' and ')}{' '}
          {mood.gated.length === 1 ? 'account is' : 'accounts are'} not included, because those
          platforms publish no comments to a server until the account authorises it.
        </p>
      )}

      {mood.unmeasured.length > 0 && (
        <button
          onClick={onOpenAccounts}
          className="mt-2 inline-flex min-h-11 items-center text-left text-xs font-medium text-ink-3 underline decoration-[var(--rule)] underline-offset-4 hover:text-ink-2"
        >
          {mood.unmeasured.length} more of your {mood.unmeasured.length === 1 ? 'account has' : 'accounts have'} not been read
        </button>
      )}
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
        body={`${scan.blocked} Until that is fixed this section cannot tell you whether it is a quiet week or a broken setup.`}
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
            <p className="mt-0.5 text-sm text-ink-2">
              Checking each front page for your name.
            </p>
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

  /* it ran and there was genuinely nothing */
  const dead = scan.sources.filter((s) => s.error !== null)

  return (
    <Empty
      icon={<ScanEye size={18} aria-hidden />}
      title="Nothing in this morning&rsquo;s papers names you"
      body={
        scan.lastAt
          ? `${scan.sources.length} mastheads were read ${relativeTime(scan.lastAt)}${
              dead.length > 0
                ? `, though ${dead.length} of them did not answer, so this is not a complete picture.`
                : '. That is a real quiet morning, not a broken scan.'
            }`
          : 'The papers have not been read yet this morning.'
      }
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
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              Found by matching your name and seat against each masthead&rsquo;s front page.
              Nobody has read them yet. What they actually say, whether any of it is
              questionable, and what to do about it all come from reading them.
            </p>
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

/* ── how the press reads ─────────────────────────────────────────────────── */

/**
 * What the coverage says, when nobody's comments are readable.
 *
 * This is the panel most Indian members will actually see. Facebook and
 * Instagram publish nothing about a stranger's posts, so the comment reading is
 * unavailable until an office connects an account — which most never will. A
 * screen that answers "what are people saying about me" with an empty box and a
 * setup instruction has failed the one question it was opened for.
 *
 * It says plainly that this is the press rather than the public. The two are
 * not the same thing and a member who confuses them makes bad decisions.
 */
function PerceptionPanel({
  perception,
  onOpenCoverage,
  onOpenAccounts,
}: {
  perception: Perception
  onOpenCoverage: () => void
  onOpenAccounts: () => void
}) {
  if (perception.total === 0) {
    return (
      <Empty
        icon={<UserRound size={18} aria-hidden />}
        title="Nothing has been read about you yet"
        body="Add your accounts, or read the stories the morning scan finds."
        action={
          <Button size="sm" onClick={onOpenAccounts}>
            <Plus size={15} />
            Add your accounts
          </Button>
        }
      />
    )
  }

  const score = perception.score ?? 0
  const verdict =
    score > 30
      ? 'The coverage is favourable.'
      : score > 8
        ? 'The coverage leans favourable.'
        : score < -30
          ? 'The coverage is hostile.'
          : score < -8
            ? 'The coverage leans critical.'
            : 'The coverage is mixed.'

  const segments = [
    { label: 'Supportive', n: perception.supportive, colour: 'var(--chart-pos)' },
    { label: 'Neutral', n: perception.neutral, colour: 'var(--chart-mid)' },
    { label: 'Critical', n: perception.critical, colour: 'var(--chart-neg)' },
  ]
  const pct = (n: number) => (perception.total === 0 ? 0 : (n / perception.total) * 100)

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-lg font-bold leading-snug tracking-[-0.015em]">{verdict}</p>
        <p className="tnum text-sm text-ink-3">
          {perception.total} {perception.total === 1 ? 'story' : 'stories'} read
        </p>
      </div>

      {/* Said before the bar, not after it. A reader who takes this for comment
          sentiment draws the wrong conclusion about their own support. */}
      <p className="mt-1 text-xs leading-relaxed text-ink-3">
        This is how the press is writing about you, not what the public said. Comment
        readings need one of your own accounts connected.
      </p>

      <div
        className="mt-4 flex h-3 w-full gap-[3px]"
        role="img"
        aria-label={`${perception.supportive} supportive, ${perception.neutral} neutral, ${perception.critical} critical`}
      >
        {segments.map((seg) =>
          seg.n === 0 ? null : (
            <span
              key={seg.label}
              className="h-full rounded-full"
              style={{ flexGrow: pct(seg.n), background: seg.colour }}
            />
          ),
        )}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((seg) => (
          <li key={seg.label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ background: seg.colour }}
            />
            <span className="text-ink-2">{seg.label}</span>
            <span className="tnum font-semibold">{seg.n}</span>
          </li>
        ))}
      </ul>

      {perception.suspect > 0 && (
        <p className="mt-3.5 flex items-start gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--neg)_28%,transparent)] bg-[var(--neg-soft)] px-3 py-2 text-sm leading-relaxed text-[var(--neg)]">
          <ScanEye size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {perception.suspect} of these {perception.suspect === 1 ? 'was' : 'were'} flagged as
            questionable, and worth a person checking before anything is answered.
          </span>
        </p>
      )}

      {perception.themes.length > 0 && (
        <div className="mt-4 border-t border-[var(--rule)] pt-3.5">
          <p className="kicker">What the coverage is asking of you</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {perception.themes.map((theme) => (
              <li key={theme}>
                <Chip>{theme}</Chip>
              </li>
            ))}
          </ul>
        </div>
      )}

      {perception.publishers.length > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          Read from {perception.publishers.join(', ')}.
        </p>
      )}

      {perception.thin && (
        <p className="mt-2 text-xs leading-relaxed text-ink-3">
          Only {perception.total} {perception.total === 1 ? 'story' : 'stories'}: a handful of
          headlines, not a climate.
        </p>
      )}

      <button
        onClick={onOpenCoverage}
        className="mt-2 inline-flex min-h-11 items-center text-xs font-medium text-ink-3 underline decoration-[var(--rule)] underline-offset-4 hover:text-ink-2"
      >
        See every story
      </button>
    </Card>
  )
}

/* ── the local accounts ──────────────────────────────────────────────────── */

/**
 * Who with an audience is for you, who is against, and what is made up.
 *
 * The Influencer screen shows the same records as a table. This is the reading
 * of them, and the difference is what a member is actually asking: not "here
 * are twelve rows" but "the channel with 1.4 million subscribers is attacking
 * you and one of the claims does not stand up".
 *
 * Accounts are always named and reach is always attached. Six critics with four
 * hundred followers each and one with two million are opposite situations, and
 * a count of seven describes neither.
 */
function VoicePanel({
  voice,
  busy,
  onOpenInfluencers,
  onRead,
}: {
  voice: InfluencerVoice
  busy: boolean
  onOpenInfluencers: () => void
  onRead: (postUrl: string) => void
}) {
  if (busy) {
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
            <p className="text-[15px] font-bold">Reading the local accounts…</p>
            <p className="mt-0.5 text-sm text-ink-2">
              Opening each channel&rsquo;s recent posts and checking what they say about you.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  if (voice.readable === 0 && voice.aboutSeat.length === 0) {
    return (
      <Empty
        icon={<Megaphone size={18} aria-hidden />}
        title={
          voice.neverRun
            ? 'The local accounts have not been read yet'
            : 'No local account has mentioned you'
        }
        body={
          voice.neverRun
            ? 'The accounts in your seat are on the roster. Reading them runs once a day.'
            : 'The accounts being watched have posted nothing that names you in the last week. That is a real quiet week, not a broken check.'
        }
        action={
          <Button size="sm" onClick={onOpenInfluencers}>
            <Megaphone size={15} />
            See what they said
          </Button>
        }
      />
    )
  }

  /**
   * Say what was found, and only claim a lean when something was scored.
   *
   * "Evenly split" was reachable two completely different ways: a genuine tie,
   * and nobody having read anything — because zero critical equals zero
   * supportive. A desk whose posts had all been listed but never scored was
   * therefore told its coverage was balanced, which is a finding, about work
   * that had not been done.
   */
  const scored = voice.supportive.length + voice.critical.length + voice.neutral.length
  const verdict =
    voice.total === 0
      ? 'Nothing names you directly this week.'
      : scored === 0
        ? `${voice.total} ${voice.total === 1 ? 'post names' : 'posts name'} you. None has been read for tone yet.`
        : voice.critical.length > voice.supportive.length
          ? 'More of them are against you than for you.'
          : voice.supportive.length > voice.critical.length
            ? 'More of them are for you than against you.'
            : 'They are evenly split.'

  return (
    <div className="stack-tight">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-lg font-bold leading-snug tracking-[-0.015em]">{verdict}</p>
          {voice.criticalReach > 0 && (
            <p className="tnum text-sm text-ink-3">
              {full(voice.criticalReach)} followers hear the critical ones
            </p>
          )}
        </div>

        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {[
            { label: 'For you', n: voice.supportive.length, colour: 'var(--chart-pos)' },
            { label: 'Neutral', n: voice.neutral.length, colour: 'var(--chart-mid)' },
            { label: 'Against you', n: voice.critical.length, colour: 'var(--chart-neg)' },
            // Its own segment, never folded into Neutral: "nobody has read this"
            // is not a finding of even-handedness.
            { label: 'Not read yet', n: voice.unread.length, colour: 'var(--border-strong)' },
          ]
            .filter((seg) => seg.n > 0)
            .map((seg) => (
            <li key={seg.label} className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: seg.colour }}
              />
              <span className="text-ink-2">{seg.label}</span>
              <span className="tnum font-semibold">{seg.n}</span>
            </li>
          ))}
        </ul>

        {voice.unreadable > 0 && (
          <p className="mt-3 border-t border-[var(--rule)] pt-3 text-xs leading-relaxed text-ink-3">
            {voice.unreadable} more {voice.unreadable === 1 ? 'account is' : 'accounts are'} being
            watched but published nothing a stranger can read. Facebook, Instagram, LinkedIn and
            X show a server nothing, so silence from those is not evidence of quiet.
          </p>
        )}
      </Card>

      {/* Questionable first. Everything else here is opinion, which an office
          can answer; a fabricated claim is a different problem with a clock on
          it. */}
      {voice.suspect.map((v) => (
        <VoiceCard key={`${v.postUrl}-suspect`} voice={v} tone="suspect" onRead={onRead} />
      ))}

      {voice.critical.slice(0, 3).map((v) =>
        v.suspect ? null : <VoiceCard key={v.postUrl} voice={v} tone="critical" onRead={onRead} />,
      )}

      {voice.critical.length === 0 &&
        voice.supportive.slice(0, 2).map((v) => (
          <VoiceCard key={v.postUrl} voice={v} tone="supportive" onRead={onRead} />
        ))}

      {/* About the seat rather than the member. Kept apart and labelled, never
          folded into the stance figures above — a video about the district that
          never names her is not evidence of support or hostility. But it is
          most of local politics, and an office that is not told about it is
          being kept from the thing it was bought to watch. */}
      {voice.aboutSeat.length > 0 && (
        <Card>
          <p className="text-[15px] font-bold">
            {voice.aboutSeat.length} more{' '}
            {voice.aboutSeat.length === 1 ? 'post is' : 'posts are'} about your constituency
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">
            These name the seat but not you, so they do not count towards the figures above.
            They are what your constituents are being shown about where they live.
          </p>
          <ul className="mt-3 space-y-2.5">
            {voice.aboutSeat.slice(0, 4).map((v) => (
              <li key={v.postUrl} className="border-t border-[var(--rule)] pt-2.5">
                <p className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <PlatformBadge platform={v.platform} size={20} />
                  <span className="font-semibold text-ink-2">{v.displayName ?? v.handle}</span>
                  {v.followers ? <span>· {full(v.followers)} followers</span> : null}
                  {v.postedAt ? <span>· {relativeTime(v.postedAt)}</span> : null}
                </p>
                {/* The headline reads it here; the small link beside it still
                    goes to the platform, because sometimes the original is
                    what you want. The default is the one that keeps the
                    reading in the app. */}
                <button
                  type="button"
                  onClick={() => onRead(v.postUrl)}
                  className="mt-1 block w-full text-left text-sm leading-relaxed text-ink-2 underline decoration-[var(--rule)] underline-offset-4 hover:decoration-[var(--accent)] hover:text-ink"
                >
                  {v.excerpt}
                </button>
                <span className="mt-1 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onRead(v.postUrl)}
                    className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
                  >
                    <ScanEye size={12} aria-hidden />
                    Read it fully
                  </button>
                  <a
                    href={v.postUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex min-h-11 items-center gap-1 text-xs text-ink-3 hover:text-ink-2"
                  >
                    <ExternalLink size={11} aria-hidden />
                    open
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function VoiceCard({
  voice,
  tone,
  onRead,
}: {
  voice: VoiceOf
  tone: 'suspect' | 'critical' | 'supportive'
  onRead: (postUrl: string) => void
}) {
  return (
    <Card
      className={cn(
        tone === 'suspect' && 'border-[color-mix(in_oklab,var(--neg)_45%,var(--rule))]',
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <PlatformBadge platform={voice.platform} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{voice.displayName ?? voice.handle}</p>
          <p className="mt-0.5 text-xs text-ink-3">
            {voice.platform}
            {voice.followers ? ` · ${full(voice.followers)} followers` : ''}
            {voice.postedAt ? ` · ${relativeTime(voice.postedAt)}` : ''}
          </p>
        </div>
        {tone === 'suspect' && (
          <Chip tone="negative" icon={<ScanEye size={11} aria-hidden />}>
            Check this
          </Chip>
        )}
        <Chip
          tone={
            voice.stance === 'critical'
              ? 'negative'
              : voice.stance === 'supportive'
                ? 'positive'
                : 'neutral'
          }
        >
          {voice.stance === 'critical'
            ? 'Against you'
            : voice.stance === 'supportive'
              ? 'For you'
              : 'Neutral'}
        </Chip>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-ink-2">
        <button
          type="button"
          onClick={() => onRead(voice.postUrl)}
          className="text-left underline decoration-[var(--rule)] underline-offset-4 hover:text-ink hover:decoration-[var(--accent)]"
        >
          {voice.excerpt}
        </button>
      </p>

      <span className="mt-1 flex items-center gap-3">
        <button
          type="button"
          onClick={() => onRead(voice.postUrl)}
          className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
        >
          <ScanEye size={12} aria-hidden />
          Read it fully
        </button>
        <a
          href={voice.postUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-11 items-center gap-1 text-xs text-ink-3 hover:text-ink-2"
        >
          <ExternalLink size={11} aria-hidden />
          open
        </a>
      </span>

      {voice.suspect && voice.fakeNote && (
        <p className="mt-3 border-t border-[var(--rule)] pt-3 text-sm leading-relaxed text-ink-2">
          <span className="font-medium text-[var(--neg)]">Why it was flagged: </span>
          {voice.fakeNote}
        </p>
      )}
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
/* ── desk overview ───────────────────────────────────────────────────────── */

/** Latest follower reading for a handle, or null when never read. */
function latestFollowers(h: TrackedHandle): number | null {
  for (let i = h.snapshots.length - 1; i >= 0; i--) {
    const f = h.snapshots[i]?.followers
    if (typeof f === 'number') return f
  }
  return null
}

interface DeskPost {
  url: string
  platform: string
  title: string | null
  author: string
  engagement: number
  /** False when the platform published no likes or comments — never a zero. */
  measured: boolean
  views: number | null
  metaLine: string
  /**
   * The picture the scrape stored for this post, served from this origin.
   *
   * Preferred over `youtubeThumb`, which only ever answers for YouTube — so
   * before this every Facebook, Instagram and X card fell through to the blank
   * platform tile even though the scrape had the image sitting in the dataset.
   */
  thumbnailUrl: string | null
}

/**
 * The most-engaging posts the given accounts have stored, biggest first.
 *
 * The HOME passes only the office's own accounts. That is deliberate: a rival
 * with a bigger following outranks everything the office published, so an
 * unfiltered list turned the dashboard's own "most engaging posts" into a feed
 * of somebody else's work. The Accounts screen, which exists to compare, shows
 * both sides side by side instead.
 */
function deskPosts(handles: TrackedHandle[]): DeskPost[] {
  const posts: DeskPost[] = []
  for (const h of handles) {
    const latest = h.snapshots[h.snapshots.length - 1]
    for (const p of latest?.posts ?? []) {
      const eng = (p.likes ?? 0) + (p.comments ?? 0)
      posts.push({
        url: p.url,
        platform: h.platform,
        title: p.title,
        thumbnailUrl: p.thumbnailUrl ?? null,
        author: h.displayName || h.handle,
        engagement: eng,
        measured: p.likes != null || p.comments != null,
        views: p.views,
        metaLine: [p.views != null ? `${compact(p.views)} views` : null, eng > 0 ? `${compact(eng)} reactions` : null]
          .filter(Boolean)
          .join(' · '),
      })
    }
  }
  /**
   * Rank by engagement, but let every channel onto the strip.
   *
   * Sorting on engagement alone deleted a whole platform from this card.
   * YouTube publishes a view count and no likes or comments, so every video
   * scored zero and none of twenty-five ever reached a strip of ten — the
   * channel was scraped, counted in the follower total, and then invisible
   * exactly where posts are shown.
   *
   * So the best post from each platform leads and the rest fills by rank.
   * Nothing is invented to manage it: views are not converted into pretend
   * likes, and `metaLine` already writes "views" for a video and "reactions"
   * for a post, so the two never read as the same measure.
   */
  /**
   * A post with no picture AND no text cannot be shown, only counted.
   *
   * A handful of Facebook records come back with an engagement figure and
   * nothing else — no caption the adapter could read, no image. They are real
   * and they stay in the dataset, because the follower and engagement totals
   * are computed from them and deleting them would quietly change true
   * numbers. But they have no business leading a strip whose entire job is to
   * show what was published: they render as an empty tile, and because they
   * rank on engagement they were taking the FIRST slots. Sorting them last
   * keeps the arithmetic honest and the strip legible.
   */
  const showable = (p: DeskPost): boolean =>
    Boolean(p.thumbnailUrl) || Boolean(p.title?.trim())

  posts.sort((a, b) => {
    if (showable(a) !== showable(b)) return showable(a) ? -1 : 1
    if (a.measured !== b.measured) return a.measured ? -1 : 1
    if (a.measured) return b.engagement - a.engagement
    return (b.views ?? 0) - (a.views ?? 0)
  })

  const seen = new Set<string>()
  const lead: DeskPost[] = []
  const rest: DeskPost[] = []
  for (const post of posts) {
    // `posts` is already showable-first, so the first post seen for a platform
    // is its best SHOWABLE one whenever it has any.
    if (seen.has(post.platform)) rest.push(post)
    else {
      seen.add(post.platform)
      lead.push(post)
    }
  }
  return [...lead, ...rest].slice(0, 10)
}

/**
 * The home's "desk at a glance" — the office's own ground and reach, drawn
 * from the tracked accounts and identity this device already holds. It is the
 * account screen's headline content surfaced on the dashboard so the home is
 * a live desk, not an empty page, before the morning scan has found anything.
 *
 * Honest by construction: the constituency lights only if the seat resolves
 * against the offline gazetteer, a handle with no reading shows a dash rather
 * than a fabricated count, and the map lights in the party's own colour.
 */
function DeskOverview({
  handles,
  identity,
  onManage,
  onRead,
}: {
  handles: TrackedHandle[]
  identity: Identity | null
  onManage: () => void
  onRead: (postUrl: string) => void
}) {
  const own = handles.filter((h) => h.own)
  const watched = handles.filter((h) => !h.own)

  /**
   * The headline figures describe THIS desk, not everything it can see.
   *
   * Both of these used to run over every tracked handle, which was survivable
   * when a desk watched one rival and became nonsense the moment it watched
   * several: an MP with 450,000 followers sat under a "total followers" of 27
   * crore, because the number had quietly become the sum of her and five
   * national figures she happens to monitor. A reader has no way to tell that
   * from a real reach figure.
   *
   * `own` is the desk; anything else is being watched. Watched accounts still
   * appear — on the board below, on Accounts, on Compare — where they are
   * labelled as rivals rather than folded into a total.
   *
   * The fallback to every handle covers a desk that has marked nothing as its
   * own: there, "all of them" is the only available reading of the question.
   */
  const counted = own.length > 0 ? own : handles
  const totalFollowers = counted.reduce((s, h) => s + (latestFollowers(h) ?? 0), 0)
  const channels = new Set(counted.map((h) => h.platform)).size

  // The seat, geocoded once. Null when it will not resolve — the map then
  // centres on India and says so rather than pinning a plausible dot. The
  // ground lights in the party's colour (BJP saffron, Congress blue, …).
  const seat = geocodePlace(identity?.constituency ?? identity?.district ?? identity?.state ?? null)
  const ground = partyColor(identity?.party)

  /**
   * The desk's own accounts first, then who it watches — each biggest first.
   *
   * Sorting the whole list purely by size reads well until the desk watches
   * somebody far larger than itself. It only shows five rows, so an MP with
   * 450,000 followers watching a handful of national figures was pushed off her
   * own board entirely: five rivals, none of them her. Grouping first keeps the
   * question the card is answering — how big are we, and next to whom — instead
   * of answering "who is biggest in India".
   */
  /**
   * The follower board: one row per PERSON, not per account.
   *
   * It listed a row per handle, so a politician on three platforms appeared
   * three times over — the same name, the same face, three bars — and a
   * five-row board was filled by not quite two people. Nobody reads that as
   * reach; they read it as a bug.
   *
   * Grouping answers the question the card actually asks. The value is the
   * person's total across everywhere they post, and which platforms those are
   * moves to badges under the name — the same information in one line rather
   * than three rows. It also means the board scales: five politicians fit where
   * not quite two did.
   */
  const board = (() => {
    const byPerson = new Map<
      string,
      {
        name: string
        own: boolean
        label: string | null
        avatarUrl: string | null
        followers: number
        platforms: TrackedHandle['platform'][]
        read: boolean
      }
    >()

    for (const h of [...own, ...watched]) {
      const name = h.displayName || h.handle
      const entry = byPerson.get(name) ?? {
        name,
        own: h.own,
        label: h.label,
        avatarUrl: h.avatarUrl,
        followers: 0,
        platforms: [] as TrackedHandle['platform'][],
        read: false,
      }
      const f = latestFollowers(h)
      if (f != null) {
        entry.followers += f
        entry.read = true
      }
      if (!entry.platforms.includes(h.platform)) entry.platforms.push(h.platform)
      // Any photo will do; they are the same person.
      if (!entry.avatarUrl && h.avatarUrl) entry.avatarUrl = h.avatarUrl
      byPerson.set(name, entry)
    }

    // `read` guards the difference between a person whose accounts could not be
    // read and one with no followers. Nobody is plotted at zero for the former.
    return [...byPerson.values()]
      .filter((p) => p.read)
      .sort((a, b) => {
        if (a.own !== b.own) return a.own ? -1 : 1
        return b.followers - a.followers
      })
  })()

  // The home shows the office's OWN posts. Rivals are compared on Accounts.
  const posts = deskPosts(own.length > 0 ? own : handles)
  const zones = seat ? [{ lon: seat.lon, lat: seat.lat, radiusDeg: 1.3, label: `${seat.name}, ${seat.state}` }] : []

  /**
   * Follower growth, INDEXED to each account's first reading (100 = where it
   * started), from the dated readings stored on this device.
   *
   * Indexed rather than raw on purpose, and it is the only honest way to draw
   * this: a national account at ten crore and a constituency page at three
   * lakh on one axis flattens the smaller line onto the baseline, so the
   * screen shows one curve and three straight lines that are not straight.
   * Two measures of different magnitude on a single axis is the classic chart
   * error; the documented fixes are separate charts or a common base, and a
   * common base is also the more useful question — who is growing fastest,
   * not who is biggest. Absolute counts are one card to the left.
   *
   * Only handles with two or more readings can be plotted: one reading is a
   * number, not a trend, and a flat line drawn from it would assert a
   * steadiness nobody measured.
   */
  const growth = (() => {
    const plottable = handles.filter((h) => h.snapshots.filter((s) => s.followers != null).length >= 2)
    if (plottable.length === 0) return null
    const days = [...new Set(plottable.flatMap((h) => h.snapshots.map((s) => s.takenAt.slice(0, 10))))].sort()
    if (days.length < 2) return null
    const labels = days.map((d) => {
      const [, mm, dd] = d.split('-')
      return `${dd}/${mm}`
    })
    const series = plottable.slice(0, 4).map((h, i) => {
      const base = h.snapshots.find((s) => s.followers != null)?.followers ?? null
      return {
        name: h.displayName || h.handle,
        color: h.own ? 'var(--vs-subject)' : seriesColor(i + 1),
        values: days.map((d) => {
          const hit = h.snapshots.filter((s) => s.takenAt.slice(0, 10) === d && s.followers != null).pop()
          if (hit?.followers == null || base == null || base === 0) return null
          return Math.round((hit.followers / base) * 1000) / 10
        }),
      }
    })
    return {
      labels,
      series,
      note: `Indexed to each account's first reading · ${days.length} readings`,
    }
  })()

  /* Share of total reach by channel. Summed from the latest reading of each
     handle, so a platform we could not read simply does not appear. */
  const reachShare = (() => {
    const byPlatform = new Map<string, number>()
    // The desk's own accounts, like every other headline figure here. Over all
    // handles this read 11L on a desk whose subject has 4.5L — the remainder
    // being her opponent's, folded into a chart captioned "your reach".
    for (const h of counted) {
      const f = latestFollowers(h)
      if (f == null) continue
      byPlatform.set(h.platform, (byPlatform.get(h.platform) ?? 0) + f)
    }
    return [...byPlatform.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([platform, value], i) => ({ label: platform, value, color: seriesColor(i) }))
  })()

  /* Engagement per stored post, newest-first along the axis. */
  const postBars = posts
    .slice(0, 8)
    .map((p, i) => ({ label: `#${i + 1}`, value: p.engagement, highlight: i === 0 }))
    .filter((c) => c.value > 0)

  return (
    <div className="stack-tight">
      {/* Ground + reach. The map is a fixed panel; the reach column fills the
          rest and never stretches its tiles to match the map's height. */}
      <div className="grid items-start gap-4 lg:grid-cols-12">
        {/* The map — the office's ground, lit in the party colour. */}
        <Card className="lg:col-span-5" padded={false} level="lift">
          {/* The standard card opening. The party colour stays on the map
              itself (the zone lights in it); the badge joins the same tinted
              system every other card on the desk opens with. */}
          <div className="border-b border-[var(--rule)] px-4 pb-1 pt-4">
            <CardHead
              icon={<MapPin size={16} aria-hidden />}
              tint="blue"
              title={seat ? `Your ground: ${seat.name}` : 'Your ground'}
              sub={
                seat
                  ? [identity?.role, identity?.party, seat.state].filter(Boolean).join(' · ')
                  : identity
                    ? 'The seat is not on the offline map yet, so nothing is pinned.'
                    : 'Set who this desk is for and the constituency lights up here.'
              }
            />
          </div>
          <div className="p-3 sm:p-4">
            <IndiaMap dots={INDIA_DOTS} bbox={INDIA_BBOX} zones={zones} accentColor={ground} />
          </div>
        </Card>

        {/* Reach — compact tiles that size to content, then the board fills. */}
        <div className="flex flex-col gap-4 lg:col-span-7">
          {/* Three tiles in a two-column phone grid left the third sitting
              beside a hole. The followers tile — the headline figure — takes
              the whole first row at 375 instead; sm and up restores the
              original three-across order. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            <IconStat icon={<UserRound size={18} aria-hidden />} label="Accounts tracked" value={handles.length} tint="blue" deltaLabel={`${own.length} yours · ${watched.length} watched`} />
            {/* The label has to say WHOSE, now that the figure is the desk's
                own rather than every account on the device. "Across every
                account" over a number that deliberately excludes most of them
                would be the same misreading, just written down. */}
            <IconStat className="order-first col-span-2 sm:order-none sm:col-span-1" icon={<Users size={18} aria-hidden />} label="Total followers" value={totalFollowers || null} tint="violet" hero={totalFollowers > 0} deltaLabel={own.length > 0 ? `Across ${own.length === 1 ? 'your account' : `your ${own.length} accounts`}` : 'Across every account'} />
            <IconStat icon={<Megaphone size={18} aria-hidden />} label="Channels" value={channels || null} tint="teal" deltaLabel={channels === 1 ? 'One platform' : own.length > 0 ? 'Platforms you post on' : 'Platforms watched'} />
          </div>

          {board.length > 1 ? (
            <Card className="flex-1 p-4 sm:p-6">
              <CardHead
                icon={<Users size={16} aria-hidden />}
                tint="green"
                title="Followers by account"
                sub="Latest reading per account"
                action={
                  <button
                    type="button"
                    onClick={onManage}
                    className="inline-flex min-h-11 items-center text-[12px] font-semibold text-[var(--accent)] hover:underline"
                  >
                    Manage
                  </button>
                }
              />
              <HBarBoard
                rows={board.slice(0, 5).map((r) => ({
                  label: r.name,
                  sublabel: (
                    <span className="flex items-center gap-1.5">
                      <span className="shrink-0">{r.own ? 'Yours' : r.label || 'Watched'}</span>
                      <span className="flex items-center gap-1">
                        {r.platforms.map((p) => (
                          <PlatformBadge key={p} platform={p} size={13} />
                        ))}
                      </span>
                    </span>
                  ),
                  value: r.followers,
                  lead: <Avatar src={r.avatarUrl} name={r.name} size={38} />,
                  emphasis: r.own,
                }))}
                formatValue={(n) => full(Math.round(n))}
              />
            </Card>
          ) : (
            // One account, so no board to draw. Rather than leave a gap, invite
            // the next account — the honest way to fill the space.
            <Card level="quiet" className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <span className="icon-badge bg-[var(--accent-soft)] text-[var(--accent)]">
                <Plus size={18} aria-hidden />
              </span>
              <p className="text-[13px] font-semibold">Add the accounts you are measured against</p>
              <p className="max-w-[36ch] text-[11px] text-ink-3">
                A rival or two turns this into a board that ranks reach at a glance.
              </p>
              <button
                type="button"
                onClick={onManage}
                className="inline-flex min-h-11 items-center text-[12px] font-semibold text-[var(--accent)] hover:underline"
              >
                Manage accounts
              </button>
            </Card>
          )}
        </div>
      </div>

      {/* ── the numbers, drawn ──────────────────────────────────────────
          Growth from the dated follower readings this device has stored, and
          the share of reach by channel. Both are measurements, not estimates,
          and neither renders until there is enough to plot honestly. */}
      {(growth !== null || reachShare.length > 1) && (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {/* When its neighbour has nothing to draw, each card takes the whole
              row rather than leaving two-thirds of it blank. */}
          {growth && (
            <Card className={cn('p-4 sm:p-6', reachShare.length > 1 ? 'lg:col-span-2' : 'lg:col-span-3')}>
              <CardHead
                icon={<TrendingUp size={16} aria-hidden />}
                tint="blue"
                title="Follower growth"
                sub={growth.note}
              />
              <LineChart
                labels={growth.labels}
                series={growth.series}
                height={210}
                area={false}
                formatValue={(n) => (n == null ? '—' : `${Math.round(n * 10) / 10}`)}
              />
            </Card>
          )}

          {reachShare.length > 1 && (
            <Card className={cn('p-4 sm:p-6', !growth && 'lg:col-span-3')}>
              <CardHead
                icon={<Users size={16} aria-hidden />}
                tint="violet"
                title="Reach by channel"
                sub="Share of followers by platform"
              />
              <div
                className={cn(
                  'flex flex-col items-center gap-3',
                  // Alone on the row, the donut and its legend sit side by
                  // side so the full-width card is not a tall empty column.
                  !growth && 'sm:flex-row sm:justify-center sm:gap-8',
                )}
              >
                <DonutBreakdown
                  segments={reachShare}
                  size={150}
                  centerLabel={compact(reachShare.reduce((s, r) => s + r.value, 0))}
                  centerSub="followers"
                />
                <Legend items={reachShare.map((r) => ({ label: r.label, color: r.color }))} className="justify-center" />
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Engagement per post, as columns — the shape of what actually landed. */}
      {postBars.length > 1 && (
        <Card className="p-4 sm:p-6">
          <CardHead
            icon={<MessageSquare size={16} aria-hidden />}
            tint="green"
            title="Engagement by post"
            sub="Likes plus comments on each stored post"
          />
          <div className="grid items-start gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <ColumnChart columns={postBars} gradient="violet" height={190} formatValue={compact} />
            </div>
            <div className="lg:col-span-2">
              <p className="eyebrow mb-2">Best performing</p>
              {posts.slice(0, 5).map((p, i) => (
                <RankRow
                  key={p.url}
                  className="min-h-11"
                  rank={i + 1}
                  label={<span className="truncate">{p.title ?? p.author}</span>}
                  value={compact(p.engagement)}
                  tint={i === 0 ? 'violet' : 'blue'}
                  onClick={() => onRead(p.url)}
                  title="Read this post in full: comments, sentiment and the fake-news check"
                />
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Most engaging posts — a scrolling strip, each with an Analyse button
          that runs the full read (comments, sentiment, fake-news) in the app. */}
      {posts.length > 0 && (
        /* Fewer than four posts cannot fill a desktop row, so the card closes
           around what it has instead of trailing a wide empty run. On a phone
           it stays full width: the strip's first partial card peeking past the
           edge is what invites the scroll. */
        <Card padded={false} className={cn(posts.length < 4 && 'lg:w-fit lg:max-w-full')}>
          <div className="px-4 pt-4">
            <CardHead
              icon={<TrendingUp size={16} aria-hidden />}
              tint="violet"
              title="Most engaging posts"
              sub="Tap Analyse to read one in full"
            />
          </div>
          {/* `.bleed` undoes the SHELL gutter; inside an unpadded card its
              negative margins shoved the strip flush against the rounded
              corners and clipped the first thumbnail. Plain padding keeps the
              strip inside the card and leaves a partial next card visible at
              375px. */}
          <div className="flex gap-4 overflow-x-auto px-4 pb-4">
            {posts.map((p) => (
              <PostThumbCard
                key={p.url}
                thumbnailUrl={p.thumbnailUrl ?? youtubeThumb(p.url)}
                platform={p.platform}
                author={p.author}
                metaLine={p.metaLine}
                title={p.title}
                onAnalyse={() => onRead(p.url)}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

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
      <p className="text-sm leading-relaxed text-ink-2">
        {placed} of {total} {total === 1 ? 'story names' : 'stories name'} a place that could be
        put on the map. A bigger marker is more coverage from there; its colour is the tone of it.
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
          {total - placed} {total - placed === 1 ? 'story does' : 'stories do'} not name a place the
          map could resolve, so {total - placed === 1 ? 'it is' : 'they are'} listed below unpinned
          rather than dropped somewhere plausible.
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

function NewsCard({ item, onRead }: { item: NewsItem; onRead: (postUrl: string) => void }) {
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
