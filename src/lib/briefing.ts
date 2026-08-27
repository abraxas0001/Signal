import type { ActionItem, GrievanceRecord, Recommendation } from '@shared/grievance'
import { PRIORITY_RANK } from '@shared/taxonomy'
import type { Identity } from '@shared/identity'
import type { PersonaMention } from '@/components/Persona'
import type { Store } from '@/lib/store'
import { full } from '@/lib/utils'
import { listHandles, readStandingCache, type Standing, type TrackedHandle } from '@/lib/handles'

/**
 * What the dashboard is actually about.
 *
 * The screen this replaces opened with three navigation shortcuts, a "since you
 * last looked" digest, four counters, a sentiment bar, a topic ranking and
 * three quotes. Every one of those is a real thing the product knows. None of
 * them is what the person the desk belongs to came to find out.
 *
 * They came to find out three things, in this order:
 *
 *   1. What is being said about me.
 *   2. Is any of it wrong, or dangerous.
 *   3. What should I do about it today.
 *
 * Everything below computes exactly those, and deliberately computes nothing
 * else. Counters that open a list live on that list's own screen now; a number
 * on the dashboard whose only purpose is to be tapped is a navigation control
 * wearing a statistic's clothes.
 *
 * The other rule here: nothing is invented to fill a section. A desk with no
 * news gets a section that says there is no news, not a section quietly
 * back-filled from last week so the screen looks populated. This product exists
 * to catch confident claims that are not supported, and a dashboard that does
 * it to its own reader has no standing to complain.
 */

const DAY_MS = 86_400_000

/** Parse to null rather than NaN, so every comparison below stays honest. */
function at(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/* ── what people think ───────────────────────────────────────────────────── */

/**
 * What the public thinks, read from the accounts this office actually runs.
 *
 * The first version of this averaged the sentiment of everything the desk had
 * ever read — grievance records, influencer mentions, news stories. That is a
 * measurement of the desk's reading list, not of public opinion, and it is
 * trivially skewed: paste four angry articles into the analyser and the
 * dashboard reports that the public has turned on you.
 *
 * What people think is what people said, and people say it in the comments
 * under this office's own posts. So this reads `Standing` — the model that
 * already pulls real comments from an account's recent posts and reports what
 * those commenters think — for every handle the office has marked as its own,
 * whether that account was connected through OAuth or simply added on the
 * Accounts screen.
 *
 * Nothing else is mixed in. A dashboard that silently blends "comments on my
 * posts" with "articles I pasted" produces a number that means neither.
 */
export interface Mood {
  /** Percentages of comments read, as Standing reports them. */
  positive: number
  neutral: number
  negative: number
  /** How many comments the reading actually rests on. */
  commentsRead: number
  postsRead: number
  /** −100 … 100, averaged across accounts by weight of comments. Null when none. */
  score: number | null
  /** What commenters praise and complain about, in their words. */
  praise: string[]
  criticism: string[]
  /** Per-account, so an office with two handles can see them apart. */
  accounts: { handle: string; platform: string; standing: Standing }[]
  /** Own accounts that have never been measured but could be. */
  unmeasured: TrackedHandle[]
  /**
   * Own accounts on a platform that publishes nothing to a stranger.
   *
   * Kept apart from `unmeasured` because they are a different problem with a
   * different fix, and conflating them produced the worst report this screen
   * has given: somebody added their Facebook page, the panel said "no account
   * of yours is being read", and the only offered action was to add an account
   * they had just added. Facebook, Instagram, X and LinkedIn show a server
   * nothing at all — those need the account connected, not added.
   */
  gated: TrackedHandle[]
  /** True when the office has marked no account as its own. */
  noAccounts: boolean
  /** A score from nine comments is not a mandate, and must not be shown as one. */
  thin: boolean
}

/**
 * Platforms that publish nothing about an account to an unauthenticated reader.
 *
 * Not a limitation of this app: Facebook and Instagram require a Page token,
 * X requires OAuth, LinkedIn requires a member token. An account on one of
 * these can sit on the roster forever and never produce a single comment until
 * the office connects it, and a screen that does not say so reads as broken.
 */
const GATED_PLATFORMS = new Set(['Facebook', 'Instagram', 'Twitter/X', 'LinkedIn'])

const EMPTY_MOOD: Mood = {
  positive: 0,
  neutral: 0,
  negative: 0,
  commentsRead: 0,
  postsRead: 0,
  score: null,
  praise: [],
  criticism: [],
  accounts: [],
  unmeasured: [],
  gated: [],
  noAccounts: true,
  thin: false,
}

/**
 * How few comments is too few to report a trend from.
 *
 * Thirty is the point below which one organised reply-guy moves the number
 * more than the electorate does.
 */
const THIN_BELOW = 30

export function moodOf(): Mood {
  const own = listHandles().filter((h) => h.own)
  if (own.length === 0) return EMPTY_MOOD

  const measured: { handle: string; platform: string; standing: Standing }[] = []
  const unmeasured: TrackedHandle[] = []
  const gated: TrackedHandle[] = []

  for (const h of own) {
    const standing = readStandingCache(h.id)
    if (standing) {
      measured.push({ handle: h.displayName ?? h.handle, platform: h.platform, standing })
    } else if (GATED_PLATFORMS.has(h.platform)) {
      gated.push(h)
    } else {
      unmeasured.push(h)
    }
  }

  if (measured.length === 0) {
    return { ...EMPTY_MOOD, noAccounts: false, unmeasured, gated }
  }

  // Weighted by comments read, so an account with 400 comments is not averaged
  // flat against one with 9. An unweighted mean across accounts is how a tiny
  // second handle ends up dictating the headline number.
  const weight = measured.reduce((sum, m) => sum + Math.max(m.standing.commentsRead, 1), 0)
  const weighted = (pick: (s: Standing) => number): number =>
    measured.reduce(
      (sum, m) => sum + pick(m.standing) * Math.max(m.standing.commentsRead, 1),
      0,
    ) / weight

  const commentsRead = measured.reduce((n, m) => n + m.standing.commentsRead, 0)

  return {
    positive: Math.round(weighted((s) => s.positive)),
    neutral: Math.round(weighted((s) => s.neutral)),
    negative: Math.round(weighted((s) => s.negative)),
    commentsRead,
    postsRead: measured.reduce((n, m) => n + m.standing.postsRead, 0),
    /**
     * Averaged over the accounts that actually produced a score.
     *
     * An unscored account must not be folded in as a zero: zero is the
     * midpoint of this scale, so counting one would drag a hostile or warm
     * average towards "balanced" on the strength of a reading nobody made.
     * With no scored account at all the answer is null, which the briefing
     * already handles — it checks `score !== null` before drawing on it.
     */
    score: (() => {
      const scored = measured.filter((m) => m.standing.score !== null)
      if (scored.length === 0) return null
      const w = scored.reduce((sum, m) => sum + Math.max(m.standing.commentsRead, 1), 0)
      return (
        scored.reduce(
          (sum, m) => sum + m.standing.score! * Math.max(m.standing.commentsRead, 1),
          0,
        ) / w
      )
    })(),
    // Deduplicated across accounts: the same complaint raised under a YouTube
    // video and a Facebook post is one grievance, not two.
    praise: [...new Set(measured.flatMap((m) => m.standing.praise))].slice(0, 4),
    criticism: [...new Set(measured.flatMap((m) => m.standing.criticism))].slice(0, 4),
    accounts: measured.sort((a, b) => b.standing.commentsRead - a.standing.commentsRead),
    unmeasured,
    gated,
    noAccounts: false,
    thin: commentsRead < THIN_BELOW,
  }
}

/* ── how the coverage reads ──────────────────────────────────────────────── */

export interface Perception {
  supportive: number
  critical: number
  neutral: number
  total: number
  /** −100 … 100. Null when there is nothing to average. */
  score: number | null
  /** What the coverage is actually about, most frequent first. */
  themes: string[]
  /** Stories flagged as questionable, which colour everything else. */
  suspect: number
  /** Too little to read a trend into. */
  thin: boolean
  /** The publishers this rests on, so an aggregate can be checked. */
  publishers: string[]
}

/**
 * What the coverage says about this person, as the reader assessed it.
 *
 * The dashboard already had a "what people are saying" panel and it measured
 * exactly one thing: comments under the office's own posts. That is the best
 * source there is — it is the public speaking in its own words — and for most
 * Indian members it is also entirely unavailable, because Facebook and
 * Instagram publish nothing to a stranger and the office has usually not
 * connected anything yet. So the panel sat empty and the product looked like it
 * had no opinion about a person it had just read nine stories about.
 *
 * This is the second reading, and it is deliberately kept SEPARATE rather than
 * blended into the first. They answer different questions:
 *
 *   comments — what the public thinks
 *   coverage — what the press is saying, which is what the public will read
 *
 * Averaging them into one number would produce a figure that answers neither,
 * and would let three angry commenters cancel out a week of hostile front
 * pages. The panel shows whichever it has, says which, and never implies the
 * other.
 */
export function perceptionOf(mentions: PersonaMention[], since: number): Perception {
  const recent = mentions.filter((m) => (at(m.seenAt) ?? at(m.publishedAt) ?? 0) >= since)

  let supportive = 0
  let critical = 0
  let neutral = 0
  let suspect = 0

  const themes = new Map<string, number>()
  const publishers = new Set<string>()

  for (const mention of recent) {
    if (mention.stance === 'supportive') supportive += 1
    else if (mention.stance === 'critical') critical += 1
    else neutral += 1

    if (mention.fake && mention.fake.suspicion !== 'No') suspect += 1
    if (mention.publisher) publishers.add(mention.publisher)

    // The reader's own recommendation is the closest thing to a theme that is
    // actually grounded — it was written against this specific story rather
    // than inferred from a pile of headlines.
    const action = mention.recommendation?.action
    if (action) themes.set(action, (themes.get(action) ?? 0) + 1)
  }

  const total = recent.length

  return {
    supportive,
    critical,
    neutral,
    total,
    score: total === 0 ? null : ((supportive - critical) / total) * 100,
    themes: [...themes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([theme]) => theme),
    suspect,
    // Under five stories is a handful of headlines, not a climate.
    thin: total > 0 && total < 5,
    publishers: [...publishers].slice(0, 6),
  }
}

/* ── what the local accounts are saying ──────────────────────────────────── */

export interface VoiceOf {
  /** The account, named, because "an influencer" is not actionable. */
  handle: string
  displayName: string | null
  platform: string
  /** How many people hear it. The reason one critic outranks another. */
  followers: number | null
  stance: 'supportive' | 'critical' | 'neutral' | 'unclear'
  /** What they actually said, in their words. */
  excerpt: string
  postUrl: string
  postedAt: string | null
  /** Flagged as possibly fabricated, recycled or misleading. */
  suspect: boolean
  /** Why it was flagged, in the reader's words. */
  fakeNote: string | null
  /**
   * Whether this names the member, or their patch.
   *
   * Both matter and they are not the same thing. A member wants to know that a
   * channel attacked them personally, and separately that four videos went out
   * about their district this week — the second is most of local politics and
   * is exactly what an office is paid to stay ahead of.
   */
  about: 'you' | 'constituency'
}

export interface InfluencerVoice {
  /**
   * Posts naming the member's seat rather than the member.
   *
   * These were being discarded outright, which is how a desk covering a real
   * district ended up with an empty screen: the model correctly judged four
   * videos to be about Mahabubnagar and a local candidate rather than about the
   * member, and the code read "not about her" as "not worth showing". For the
   * office of the MP for Mahabubnagar, videos about Mahabubnagar are the job.
   */
  aboutSeat: VoiceOf[]
  /** Accounts on the roster that could actually be read at all. */
  readable: number
  /** On the roster but publishing nothing a stranger can see. */
  unreadable: number
  supportive: VoiceOf[]
  critical: VoiceOf[]
  neutral: VoiceOf[]
  /**
   * Named the member, but nothing has read them for tone yet.
   *
   * Held apart from `neutral`, which used to absorb them. The two are different
   * claims: "a model read this and found it even-handed" against "nobody has
   * looked". Folding the second into the first let a screen report a stance
   * nothing had decided — and worse, a desk whose posts were ALL unread showed
   * zero for and zero against, which the verdict then announced as "they are
   * evenly split".
   */
  unread: VoiceOf[]
  /** Anything questionable, which outranks everything else here. */
  suspect: VoiceOf[]
  total: number
  /** Combined following of the accounts that were critical. */
  criticalReach: number
  /** Never looked, as against looked and found nothing. */
  neverRun: boolean
}

/**
 * What the accounts that move opinion locally are saying about this person.
 *
 * The Influencer screen already held all of this and showed it as a list of
 * rows: an account, a follower count, an excerpt, a chip. That is a database
 * view. A member does not want to read twelve rows and work out the pattern —
 * they want to know whether the people with an audience in their seat are
 * currently for them or against them, who the loudest critic is, and whether
 * any of it is made up.
 *
 * So the rows are sorted into that answer here. Two things are deliberately
 * carried through rather than aggregated away:
 *
 * The account is always NAMED. "Three critical mentions" is a statistic; "the
 * channel with 1.4 million subscribers is critical" is something an office can
 * act on this morning.
 *
 * Reach is attached to stance. One critic with two million subscribers and six
 * with four hundred are not the same situation, and a count treats them as
 * identical.
 */
export function influencerVoiceOf(store: Store, since: number): InfluencerVoice {
  const byId = new Map(store.influencers.map((i) => [i.id, i]))
  const voices: VoiceOf[] = []

  for (const mention of store.mentions) {
    if ((at(mention.seenAt) ?? 0) < since) continue
    /**
     * A post nobody read cannot be briefed on.
     *
     * A check with no search words returns everything an account published,
     * unmatched and unscored. Those rows carry `mentionsSubject: false` like
     * any other, so they used to fall into the "about your constituency"
     * bucket and the dashboard announced "94 more posts are about your
     * constituency" — a claim nothing had checked, over posts that may be
     * about cinema. They are still waiting on the influencer screen, and the
     * navigation badge still counts them; a briefing is the one place that
     * must not summarise what it has not read.
     */
    if (mention.judged === false) continue

    const account = byId.get(mention.influencerId)
    voices.push({
      // Kept, not discarded. The stance figures below still count only what is
      // about the member — a video about the district saying nothing about her
      // must not move her approval either way — but it is shown, because a desk
      // that hides local coverage is hiding the thing it was bought for.
      about: mention.mentionsSubject ? ('you' as const) : ('constituency' as const),
      handle: account?.handle ?? 'unknown account',
      displayName: account?.displayName ?? null,
      platform: account?.platform ?? 'unknown',
      followers: account?.followers ?? null,
      stance: mention.stance,
      excerpt: mention.excerpt,
      postUrl: mention.postUrl,
      postedAt: mention.postedAt,
      suspect: mention.fake !== null && mention.fake.suspicion !== 'No',
      fakeNote: mention.fake?.note ?? null,
    })
  }

  // Loudest first within each group: reach is what makes one of these urgent.
  const byReach = (a: VoiceOf, b: VoiceOf): number => (b.followers ?? 0) - (a.followers ?? 0)

  // Stance is only ever counted from posts that are actually about the member.
  // A district story that never names her is not evidence of support or
  // hostility towards her, and letting it vote would make the figure meaningless.
  const personal = voices.filter((v) => v.about === 'you')

  const critical = personal.filter((v) => v.stance === 'critical').sort(byReach)
  const supportive = personal.filter((v) => v.stance === 'supportive').sort(byReach)
  const neutral = personal.filter((v) => v.stance === 'neutral').sort(byReach)
  // Matched by a search word but never scored — see `unread` on the interface.
  const unread = personal.filter((v) => v.stance === 'unclear').sort(byReach)
  const suspect = personal.filter((v) => v.suspect).sort(byReach)
  const aboutSeat = voices.filter((v) => v.about === 'constituency').sort(byReach)
  const heard = new Set(voices.map((v) => v.handle)).size

  return {
    readable: heard,
    unreadable: Math.max(0, store.influencers.length - heard),
    supportive,
    critical,
    neutral,
    unread,
    suspect,
    aboutSeat,
    total: personal.length,
    criticalReach: critical.reduce((sum, v) => sum + (v.followers ?? 0), 0),
    // No roster at all is a different problem from a roster nobody has read.
    neverRun: store.influencers.length > 0 && store.mentions.length === 0,
  }
}

/* ── the news ────────────────────────────────────────────────────────────── */

export interface NewsItem {
  mention: PersonaMention
  /** Why this one is on the screen when others are not. */
  reason: 'suspect' | 'critical' | 'action' | 'recent'
  /** Suspected fabricated, recycled or misleading. */
  suspect: boolean
}

/**
 * Rank, then take a few.
 *
 * Not "the most recent five". A story from Tuesday alleging something
 * fabricated outranks four routine mentions filed this morning, and a screen
 * that sorts by clock alone buries it. Order is: anything flagged as suspect,
 * then anything critical that needs an answer, then everything else by recency.
 */
export function newsWorthNoticing(
  mentions: PersonaMention[],
  since: number,
  limit = 6,
): NewsItem[] {
  const scored = mentions
    .filter((m) => (at(m.seenAt) ?? at(m.publishedAt) ?? 0) >= since)
    .map((mention): NewsItem & { rank: number; when: number } => {
      const suspect = mention.fake !== null && mention.fake.suspicion !== 'No'
      const needsAction = mention.recommendation !== null
      const critical = mention.stance === 'critical'

      const reason: NewsItem['reason'] = suspect
        ? 'suspect'
        : critical
          ? 'critical'
          : needsAction
            ? 'action'
            : 'recent'

      // Suspicion outranks everything. It is the one category where being late
      // is materially worse than being wrong about the ranking.
      const rank = suspect ? 3 : critical ? 2 : needsAction ? 1 : 0

      return {
        mention,
        reason,
        suspect,
        rank,
        when: at(mention.publishedAt) ?? at(mention.seenAt) ?? 0,
      }
    })
    .sort((a, b) => b.rank - a.rank || b.when - a.when)

  return scored.slice(0, limit).map(({ mention, reason, suspect }) => ({
    mention,
    reason,
    suspect,
  }))
}

/* ── what to do ──────────────────────────────────────────────────────────── */

export interface Suggestion {
  /** Stable across renders, and what an action is linked to. */
  sourceId: string
  recommendation: Recommendation
  headline: string
  publisher: string | null
  url: string | null
  subject: string | null
  /** Already has an open task, so the button reads differently. */
  filed: boolean
}

/**
 * The model's recommendations, deduplicated and ranked.
 *
 * These come from the news reader, one per story it thought needed something.
 * Two things happen here that do not happen at the source: anything already
 * turned into an open task drops to the bottom rather than disappearing — an
 * office should be able to see it was dealt with — and the whole list is capped,
 * because a dashboard offering eleven things to do today is a dashboard nobody
 * acts on.
 */
export function suggestionsFrom(
  mentions: PersonaMention[],
  actions: ActionItem[],
  limit = 4,
): Suggestion[] {
  const openFor = new Set(
    actions
      .filter((a) => a.status === 'Planned' || a.status === 'In Progress')
      .flatMap((a) => a.linkedRecordIds),
  )

  return mentions
    .filter((m): m is PersonaMention & { recommendation: Recommendation } =>
      m.recommendation !== null,
    )
    .map((m) => ({
      sourceId: m.id,
      recommendation: m.recommendation,
      headline: m.headline,
      publisher: m.publisher,
      url: m.url,
      subject: m.persona,
      filed: openFor.has(m.id),
    }))
    .sort(
      (a, b) =>
        Number(a.filed) - Number(b.filed) ||
        (PRIORITY_RANK[b.recommendation.priority] ?? 0) -
          (PRIORITY_RANK[a.recommendation.priority] ?? 0),
    )
    .slice(0, limit)
}

/* ── what the constituency is complaining about ──────────────────────────── */

export interface RankedIssue {
  id: string
  title: string
  summary: string | null
  severity: string
  count: number
  /** True when this was counted by topic rather than clustered into an issue. */
  tallied: boolean
}

/**
 * The issues, ranked by what should worry an office rather than by volume.
 *
 * Volume alone puts a hundred routine road complaints above two reports of a
 * water contamination, which is backwards for the person who has to answer for
 * both. Severity leads, volume breaks ties, and recency breaks those.
 *
 * This was on the old dashboard, taken off in a rewrite as a duplicate of the
 * grievance desk, and that was a misjudgement. The desk is where an operator
 * works through records one at a time; this is the member being told what their
 * constituency is angry about this week. Same data, genuinely different
 * question — and the second one is the whole reason the office bought the tool.
 */
export function issuesFor(store: Store, since: number, limit = 4): RankedIssue[] {
  const severityRank: Record<string, number> = {
    Critical: 4,
    High: 3,
    Medium: 2,
    Low: 1,
  }

  if (store.issues.length > 0) {
    return [...store.issues]
      .map((issue) => ({
        id: issue.id,
        title: issue.title,
        summary: issue.summary ?? null,
        severity: issue.severity,
        count: issue.recordIds?.length ?? 0,
        tallied: false,
      }))
      .sort(
        (a, b) =>
          (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0) || b.count - a.count,
      )
      .slice(0, limit)
  }

  // No clustering has been run, so the records are tallied by their own topic.
  // Reported as `tallied` because "12 items mention water" and "an issue about
  // water affecting 12 people" are different claims and the screen must not
  // make the stronger one on the weaker evidence.
  const byTopic = new Map<string, { count: number; severity: string }>()
  for (const record of store.grievances) {
    if ((at(record.createdAt) ?? 0) < since) continue
    const topic = record.topic?.trim()
    if (!topic) continue
    const existing = byTopic.get(topic)
    const severity = record.severity ?? 'Low'
    if (!existing) {
      byTopic.set(topic, { count: 1, severity })
    } else {
      existing.count += 1
      if ((severityRank[severity] ?? 0) > (severityRank[existing.severity] ?? 0)) {
        existing.severity = severity
      }
    }
  }

  return [...byTopic.entries()]
    .map(([title, v]) => ({
      id: `topic-${title}`,
      title,
      summary: null,
      severity: v.severity,
      count: v.count,
      tallied: true,
    }))
    .sort(
      (a, b) =>
        (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0) || b.count - a.count,
    )
    .slice(0, limit)
}

/* ── what the member can say out loud ────────────────────────────────────── */

export interface SpokenLine {
  text: string
  /** The record or story it was written against, so it can be checked. */
  source: string
  url: string | null
}

/**
 * Lines the member could actually say, word for word.
 *
 * The single most-used thing on a political media desk, and the one with the
 * highest cost of being wrong: these get read aloud to reporters. So every line
 * carries what it was written against, and nothing is assembled here — a line
 * is quoted exactly as the reader produced it against a specific story, never
 * stitched together from several.
 *
 * Drawn from news coverage first and grievance records second. A line answering
 * this morning's story is worth more than one answering a complaint filed last
 * Tuesday, because the first is what a reporter is about to ask about.
 */
export function linesFor(store: Store, news: NewsItem[], limit = 3): SpokenLine[] {
  const lines: SpokenLine[] = []
  const seen = new Set<string>()

  const push = (text: string, source: string, url: string | null): void => {
    const trimmed = text.trim()
    // Under forty characters is a fragment, not a line somebody can say.
    if (trimmed.length < 40) return
    const key = trimmed.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    lines.push({ text: trimmed, source, url })
  }

  for (const item of news) {
    for (const point of item.mention.recommendation?.talkingPoints ?? []) {
      push(point, item.mention.publisher ?? item.mention.headline, item.mention.url)
    }
  }

  for (const record of store.grievances) {
    for (const point of record.recommendation?.talkingPoints ?? []) {
      push(point, record.publisher ?? record.topic ?? 'a filed record', record.sourceUrl ?? null)
    }
  }

  return lines.slice(0, limit)
}

/* ── the one thing ───────────────────────────────────────────────────────── */

export interface Lead {
  tone: 'critical' | 'warning' | 'calm'
  line: string
  detail: string | null
  cta: string
  to: 'grievances' | 'actions' | 'personas' | 'influencers' | 'accounts' | 'analyse'
}

const isOpen = (a: ActionItem): boolean => a.status === 'Planned' || a.status === 'In Progress'

/**
 * The single sentence at the top.
 *
 * Ordered by what would actually ruin the day, worst first. A fabricated claim
 * circulating about the member outranks an overdue task, which outranks a run
 * of critical coverage. Only one is ever shown: a screen that leads with three
 * equally-urgent statements has ranked nothing, and the reader does the sorting
 * themselves at 7am in a car, which is the job this was supposed to do.
 */
export function leadOf(input: {
  suspect: NewsItem[]
  overdue: ActionItem[]
  openActions: ActionItem[]
  mood: Mood
  /** How the press is reading them — the second, separate reading. */
  perception: Perception
  /** What the accounts with a local audience are saying. */
  voice: InfluencerVoice
  news: NewsItem[]
  grievances: GrievanceRecord[]
}): Lead {
  const { suspect, overdue, openActions, mood, news } = input

  if (suspect.length > 0) {
    const first = suspect[0]!.mention
    return {
      tone: 'critical',
      line:
        suspect.length === 1
          ? 'One story about you looks questionable.'
          : `${suspect.length} stories about you look questionable.`,
      detail: `${first.publisher ?? 'A publisher'}: “${first.headline}”. Flagged for a person to check, not judged.`,
      cta: 'Look at what was flagged',
      to: 'personas',
    }
  }

  if (overdue.length > 0) {
    return {
      tone: 'warning',
      line: `${overdue.length} ${overdue.length === 1 ? 'task is' : 'tasks are'} past the date you promised.`,
      detail: overdue[0]?.description ?? null,
      cta: 'Open the task list',
      to: 'actions',
    }
  }

  const critical = news.filter((n) => n.reason === 'critical')
  if (critical.length >= 2) {
    return {
      tone: 'warning',
      line: `${critical.length} critical stories about you today.`,
      detail: critical[0]?.mention.headline ?? null,
      cta: 'Read what they said',
      to: 'personas',
    }
  }

  /*
    A critic with an audience outranks the aggregate.

    A hundred thousand people hearing one hostile video today is a different
    morning from a slow drift in tone, and the office has to be told which it
    is. The threshold is reach rather than count: one channel at 1.4 million
    subscribers matters more than six at four hundred, and a count cannot see
    the difference.
  */
  if (input.voice.critical.length > 0 && input.voice.criticalReach >= 100_000) {
    const loudest = input.voice.critical[0]!
    return {
      tone: 'warning',
      line: `${loudest.displayName ?? loudest.handle} is criticising you to ${
        loudest.followers ? full(loudest.followers) : 'a large'
      } followers.`,
      detail: loudest.excerpt.slice(0, 180),
      cta: 'See what they said',
      to: 'influencers',
    }
  }

  // The press turning is a different alarm from the comments turning, and for
  // most Indian members it is the only one available — Facebook and Instagram
  // publish no comments to a stranger, so `mood` is empty far more often than
  // it is bad. Checked first for that reason.
  if (
    input.perception.score !== null &&
    input.perception.score < -30 &&
    !input.perception.thin
  ) {
    return {
      tone: 'warning',
      line: 'The coverage has turned against you.',
      detail: `${input.perception.critical} of ${input.perception.total} stories read this week are critical${
        input.perception.publishers.length > 0
          ? `, in ${input.perception.publishers.slice(0, 3).join(', ')}`
          : ''
      }.`,
      cta: 'Read what they said',
      to: 'personas',
    }
  }

  if (mood.score !== null && mood.score < -25 && !mood.thin) {
    return {
      tone: 'warning',
      line: 'The comments on your own posts have turned against you.',
      detail:
        mood.criticism[0] ??
        `${mood.negative}% of ${mood.commentsRead} comments read are negative.`,
      cta: 'See what people are saying',
      to: 'accounts',
    }
  }

  if (news.length > 0) {
    return {
      tone: 'calm',
      line: 'Nothing needs you urgently.',
      detail: `${news.length} ${news.length === 1 ? 'story' : 'stories'} came in, none of them flagged.`,
      cta: 'Read today’s coverage',
      to: 'personas',
    }
  }

  return {
    tone: 'calm',
    line: 'Nothing is overdue and nothing new is flagged.',
    detail:
      openActions.length > 0
        ? `${openActions.length} ${openActions.length === 1 ? 'task' : 'tasks'} still open, none of them late.`
        : 'No open actions either.',
    cta: openActions.length > 0 ? 'Open the task list' : 'Read a link',
    to: openActions.length > 0 ? 'actions' : 'analyse',
  }
}

/**
 * The name to greet somebody by.
 *
 * Not the first token. A great many Indian public figures are written with
 * leading initials — "D. K. Aruna", "Y. S. Jagan Mohan Reddy" — and taking the
 * first word greeted the member of Gadwal as "Good morning, D.." on the screen
 * they open every morning.
 *
 * The first token of real length is the given name in both shapes: "Aruna" from
 * the first, "Jagan" from the second, and "Narendra" from "Narendra Modi",
 * which has no initials at all. Where there is nothing but initials the whole
 * name is used rather than a letter.
 */
export function givenNameOf(name: string | null | undefined): string | null {
  const trimmed = name?.trim()
  if (!trimmed) return null

  const tokens = trimmed.split(/\s+/).filter(Boolean)
  const substantial = tokens.find((token) => token.replace(/[.\s]/g, '').length >= 3)
  return substantial ?? trimmed
}

/* ── the whole model ─────────────────────────────────────────────────────── */

export interface Briefing {
  identity: Identity | null
  /** "Good morning" / "Good afternoon" / "Good evening", in IST. */
  greeting: string
  /** Just the given name, for the greeting. Null when nobody is named. */
  firstName: string | null
  today: string
  /** True when the desk has read nothing at all yet. */
  empty: boolean
  /** True when the desk knows who it is for but has read no news about them. */
  noNews: boolean
  mood: Mood
  /** How the press is reading them — the second, separate reading. */
  perception: Perception
  /** What the accounts with a local audience are saying. */
  voice: InfluencerVoice
  news: NewsItem[]
  suspect: NewsItem[]
  suggestions: Suggestion[]
  issues: RankedIssue[]
  lines: SpokenLine[]
  lead: Lead
  openActions: ActionItem[]
  overdue: ActionItem[]
  /** How far back the figures above reach, in words. */
  windowLabel: string
}

/**
 * The window the dashboard reads.
 *
 * Seven days, not one. An office does not open this every morning without fail,
 * and a screen showing only today is blank on a Monday after a quiet weekend —
 * which reads as "nothing is happening" rather than "you have not looked since
 * Friday". A week is short enough to still be news.
 */
const WINDOW_DAYS = 7

export function briefingOf(store: Store, now: Date = new Date()): Briefing {
  const since = now.getTime() - WINDOW_DAYS * DAY_MS
  const identity = store.identity

  const news = newsWorthNoticing(store.personaMentions, since)
  const suspect = news.filter((n) => n.suspect)
  const mood = moodOf()
  const perception = perceptionOf(store.personaMentions, since)
  const voice = influencerVoiceOf(store, since)

  const openActions = store.actions.filter(isOpen)
  const overdue = openActions.filter((a) => {
    const due = at(a.dueAt)
    return due !== null && due < now.getTime()
  })

  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Asia/Kolkata',
    }).format(now),
  )

  const greeting =
    Number.isFinite(hour) && hour < 12
      ? 'Good morning'
      : Number.isFinite(hour) && hour < 17
        ? 'Good afternoon'
        : 'Good evening'

  return {
    identity,
    greeting,
    firstName: givenNameOf(identity?.name),
    today: now.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'Asia/Kolkata',
    }),
    empty:
      store.grievances.length === 0 &&
      store.personaMentions.length === 0 &&
      store.mentions.length === 0 &&
      store.actions.length === 0,
    noNews: store.personaMentions.length === 0,
    mood,
    perception,
    voice,
    news,
    suspect,
    suggestions: suggestionsFrom(
      news.map((n) => n.mention),
      store.actions,
    ),
    issues: issuesFor(store, since),
    lines: linesFor(store, news),
    lead: leadOf({
      suspect,
      overdue,
      openActions,
      mood,
      perception,
      voice,
      news,
      grievances: store.grievances,
    }),
    openActions,
    overdue,
    windowLabel: 'Last 7 days',
  }
}
