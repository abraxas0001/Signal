import type { Report } from '@shared/types'
import { audienceOf, type AudienceModel } from '@/lib/audience'
import {
  issuesFor,
  newsSelection,
  ownPostsOf,
  whatLandsOf,
  type LandsFinding,
  type LandsReading,
  type OwnPost,
  type RankedIssue,
} from '@/lib/briefing'
import type { TrackedHandle } from '@/lib/handles'
import {
  countVerdicts,
  describeVerdict,
  readVerdicts,
  verdictFor,
  worthShowing,
} from '@/lib/news-relevance'
import type { Store } from '@/lib/store'
import { inWindow, newestPostDate, windowLabel, windowStart, type WindowId } from '@/lib/window'
import type { SuggestionIssue } from '@/lib/suggest'

/**
 * What should you post next: the model.
 *
 * The reference this screen was built against is a page of confident
 * percentages: "82% positive on development posts", "2.4x engagement",
 * "+38% potential reach". This file is what became of that page after an
 * adversarial pass measured every proposed figure against what the desk
 * actually stores, and the record of what died there is worth keeping,
 * because each deletion is a rule:
 *
 *   "POSITIVE SENTIMENT PER THEME" DOES NOT EXIST. Comment sentiment is read
 *   per ACCOUNT and no scored comment carries a post or a topic, so nothing
 *   can honestly say which theme the positive comments were under. What CAN
 *   be said per theme is the audience's recorded answer to each post, the
 *   `publicNarrative`, tallied with its denominator. That is what this model
 *   says instead.
 *
 *   DESK-WIDE ENGAGEMENT MULTIPLES ARE A PLATFORM ARTIFACT. Median reactions
 *   on this desk run Facebook 107, Instagram 478, X 34, and the themes
 *   cluster by platform, so "this theme drew 2x your typical post" mostly
 *   reports where the theme was posted. A lift is quoted only WITHIN one
 *   platform, needs three measured posts there, and travels with its n. The
 *   same rule this product already states twice, in highlights.ts and on the
 *   platform board.
 *
 *   FORECASTS ARE NOT MEASUREMENTS. Nothing here says "will work" or
 *   "+38% potential". Every sentence is past tense with its denominator:
 *   what was posted, what was read, how it landed.
 *
 *   NUMBERS MUST AGREE ACROSS SCREENS. The split comes from `audienceOf`,
 *   the findings from `whatLandsOf`, the issues from `issuesFor`, verbatim,
 *   because two screens deriving the same label differently is the product
 *   contradicting itself. Where this screen windows its input and a sibling
 *   does not, every figure carries its own count so the basis is visible.
 *
 *   BELOW A FLOOR, THE COUNT IS THE FINDING. Three read posts before a theme
 *   may be graded, five measured before the section speaks at all, and the
 *   thin state prints "2 posts read on this theme" as content, not as an
 *   apology. On two of the example desks the whole table is thin, and that
 *   is a true statement about those desks.
 */

/* ── the shape ──────────────────────────────────────────────────────────── */

export interface ThemeRow {
  topic: string
  /** Posts read in full under this topic, in the window. */
  posts: number
  /**
   * Mean sentiment score of those readings, only at three or more posts.
   * This is the tone of the POSTS as read, not of the audience.
   */
  meanScore: number | null
  verdict: 'working' | 'not-landing' | 'mixed' | 'thin'
  /** The whatLandsOf sentence for this topic, verbatim, when it made one. */
  evidence: string | null
  /** The audience's recorded answers, tallied: e.g. Agreed 5, Divided 1. */
  narrative: { label: string; posts: number }[]
  /** How many of the topic's readings carried an answer at all. */
  narrativeOver: number
  /**
   * Reactions against ONE platform's own average, when this topic has three
   * or more measured posts there. Never across platforms.
   */
  lift: { platform: string; multiple: number; n: number; typical: number } | null
  /** Published comment counts, summed where the platform published one. */
  comments: { total: number; over: number } | null
  /** One notable quote a reading recorded against a post of this theme. */
  quote: { text: string; from: string } | null
}

export interface CadenceRow {
  platform: string
  /** Posts in the window that carry a date at all (post date, else report). */
  dated: number
  /** Posts in the window, dated or not. */
  total: number
  /** Dated posts per week across the window's dated span, or null under 4. */
  perWeek: number | null
}

export interface NextPostModel {
  empty: boolean
  windowId: WindowId
  windowLabel: string
  /* provenance */
  postsStored: number
  postsWalked: number
  postsAnalysed: number
  postsInWindow: number
  measuredInWindow: number
  commentsRead: number
  platforms: number
  /* the shared models, reused verbatim */
  audience: AudienceModel
  lands: LandsReading
  /* this screen's own tables */
  themes: ThemeRow[]
  /** Topics folded away for having a single read post, with the count. */
  thinTopics: number
  credibility: { clean: number; unsure: number; of: number } | null
  cadence: CadenceRow[]
  /** All cadence caveats in one place: which platforms publish no dates. */
  undatedNote: string | null
  /** Deterministic, from the same findings the dashboard advice card reads. */
  recommendation: string
}

/* ── the window ─────────────────────────────────────────────────────────── */

/**
 * A post's date, from wherever one truly exists.
 *
 * The same rule the platform board uses: the tracked post's own date, else the
 * full report's. Facebook and Instagram publish no date to the collector, so
 * without the fallback a window would silently hold only X and YouTube and the
 * label "last week" would be a lie of omission.
 */
const dateOf = (post: OwnPost, report: Report | undefined): string | null =>
  post.publishedAt ?? report?.snapshot.publishedAt ?? null

/* ── the model ──────────────────────────────────────────────────────────── */

const EMPTY_MODEL: NextPostModel = {
  empty: true,
  windowId: 'all',
  windowLabel: 'All time',
  postsStored: 0,
  postsWalked: 0,
  postsAnalysed: 0,
  postsInWindow: 0,
  measuredInWindow: 0,
  commentsRead: 0,
  platforms: 0,
  audience: undefined as unknown as AudienceModel,
  lands: {
    measuredPosts: 0,
    readPosts: 0,
    thin: true,
    typicalReactions: null,
    working: [],
    notLanding: [],
  },
  themes: [],
  thinTopics: 0,
  credibility: null,
  cadence: [],
  undatedNote: null,
  recommendation: 'Nothing has been read yet, so there is nothing to recommend.',
}

export function nextPostModelOf(
  handles: TrackedHandle[],
  reports: Map<string, Report> | null,
  windowId: WindowId,
): NextPostModel {
  const audience = audienceOf(handles, reports)
  // `ownPostsOf` walks whatever it is handed, and this screen was handed the
  // whole desk: rivals included. The first render caught it advising the
  // member on the strength of the Prime Minister's Raksha Bandhan post, which
  // is somebody else's theme read against somebody else's audience. Only the
  // desk's own accounts speak here.
  const all = ownPostsOf(handles.filter((h) => h.own))
  const map = reports ?? new Map<string, Report>()
  if (all.length === 0 && audience.postsStored === 0) return { ...EMPTY_MODEL, windowId }

  /* the window, anchored to the newest dated post so a fixed dataset does not
     empty itself a week after capture — the same anchoring the week card uses */
  const anchor = newestPostDate(all.map((p) => dateOf(p, map.get(p.url))))
  const start = windowStart(anchor, windowId)
  const posts = all.filter((p) => inWindow(dateOf(p, map.get(p.url)), start))
  const lands = whatLandsOf(posts, map)

  /* the readings in the window */
  interface Read {
    post: OwnPost
    report: Report
  }
  const reads: Read[] = []
  for (const post of posts) {
    const report = map.get(post.url)
    if (report?.analysis) reads.push({ post, report })
  }

  /* per-platform means over measured posts, for the within-platform lift */
  const byPlatform = new Map<string, OwnPost[]>()
  for (const p of posts) {
    if (!p.measured) continue
    byPlatform.set(p.platform, [...(byPlatform.get(p.platform) ?? []), p])
  }
  const platformTypical = new Map<string, number>()
  for (const [platform, list] of byPlatform) {
    if (list.length >= 3) {
      platformTypical.set(platform, list.reduce((s, p) => s + p.reactions, 0) / list.length)
    }
  }

  /* the themes */
  const byTopic = new Map<string, Read[]>()
  for (const r of reads) {
    const topic = r.report.analysis?.topics.primary
    if (!topic) continue
    byTopic.set(topic, [...(byTopic.get(topic) ?? []), r])
  }

  const evidenceFor = (topic: string): string | null => {
    const hit = [...lands.working, ...lands.notLanding].find(
      (f: LandsFinding) => f.kind === 'topic' && f.label === topic,
    )
    return hit ? hit.evidence : null
  }

  const themes: ThemeRow[] = []
  let thinTopics = 0
  for (const [topic, list] of byTopic) {
    if (list.length < 2) {
      thinTopics += 1
      continue
    }
    const scores = list.map((r) => r.report.analysis?.sentiment.score ?? 0)
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length

    /* the audience's recorded answer, tallied over the readings that gave one */
    const tally = new Map<string, number>()
    let answered = 0
    for (const r of list) {
      const narrative = r.report.analysis?.sentiment.publicNarrative
      if (!narrative || narrative === 'NA') continue
      answered += 1
      tally.set(narrative, (tally.get(narrative) ?? 0) + 1)
    }
    const narrative = [...tally.entries()]
      .map(([label, posts]) => ({ label, posts }))
      .sort((a, b) => b.posts - a.posts)
      .slice(0, 3)

    /* the within-platform lift, only where one platform carries the theme */
    let lift: ThemeRow['lift'] = null
    const measured = new Map<string, OwnPost[]>()
    for (const r of list) {
      if (!r.post.measured) continue
      measured.set(r.post.platform, [...(measured.get(r.post.platform) ?? []), r.post])
    }
    for (const [platform, on] of measured) {
      const typical = platformTypical.get(platform)
      if (on.length < 3 || typical === undefined || typical <= 0) continue
      const avg = on.reduce((s, p) => s + p.reactions, 0) / on.length
      const candidate = { platform, multiple: avg / typical, n: on.length, typical }
      // One lift per row, the best-evidenced: more posts wins, not more lift.
      if (!lift || candidate.n > lift.n) lift = candidate
    }

    /* published comment counts, summed only where a figure was published */
    let commentTotal = 0
    let commentOver = 0
    for (const r of list) {
      if (r.post.comments !== null) {
        commentTotal += r.post.comments
        commentOver += 1
      }
    }

    /* one quote a reading actually recorded, never stitched */
    let quote: ThemeRow['quote'] = null
    for (const r of list) {
      const q = r.report.analysis?.notableQuotes?.[0]
      if (q) {
        // The translation where one exists, because the desk reads the screen
        // in English; the original is what the reading actually recorded and
        // is what the report screen shows.
        quote = {
          text: q.translation ?? q.original,
          from: r.report.analysis?.headline ?? r.post.title ?? topic,
        }
        break
      }
    }

    themes.push({
      topic,
      posts: list.length,
      meanScore: list.length >= 3 ? mean : null,
      verdict:
        list.length < 3 ? 'thin' : mean >= 15 ? 'working' : mean <= -15 ? 'not-landing' : 'mixed',
      evidence: evidenceFor(topic),
      narrative,
      narrativeOver: answered,
      lift,
      comments: commentOver > 0 ? { total: commentTotal, over: commentOver } : null,
      quote,
    })
  }
  themes.sort((a, b) => (b.meanScore ?? -999) - (a.meanScore ?? -999) || b.posts - a.posts)

  /* the reader's own credibility check across the window */
  let clean = 0
  let unsure = 0
  for (const r of reads) {
    const flag = r.report.analysis?.credibility.suspectedFalse
    if (flag === 'No') clean += 1
    else if (flag) unsure += 1
  }

  /* cadence: what can be said about WHEN, which is less than the reference
     wanted. Day-of-week buckets on this desk run one to eight posts, and the
     Instagram timestamps are date-only wearing a midnight, so a best-day or
     best-hour claim would be noise dressed as advice. Posts per week per
     platform is what the dates can actually carry. */
  const cadence: CadenceRow[] = []
  const undated: string[] = []
  const byPlat = new Map<string, OwnPost[]>()
  for (const p of posts) byPlat.set(p.platform, [...(byPlat.get(p.platform) ?? []), p])
  for (const [platform, list] of byPlat) {
    const dates = list
      .map((p) => Date.parse(dateOf(p, map.get(p.url)) ?? ''))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b)
    const dated = dates.length
    let perWeek: number | null = null
    const first = dates[0]
    const last = dates[dates.length - 1]
    if (dated >= 4 && first !== undefined && last !== undefined && last > first) {
      perWeek = dated / Math.max(1, (last - first) / (7 * 86_400_000))
    }
    if (dated === 0) undated.push(platform)
    cadence.push({ platform, dated, total: list.length, perWeek })
  }
  cadence.sort((a, b) => b.dated - a.dated)

  /* the sentence, from the same findings the dashboard's advice card reads,
     so the two screens can never name different best themes */
  const workingTopics = lands.working.filter((f) => f.kind === 'topic').slice(0, 2)
  const workingBucket = lands.working.find((f) => f.kind !== 'topic')
  let recommendation: string
  if (lands.thin) {
    recommendation = `Only ${lands.measuredPosts} posts carry measured reactions in this window, too few to recommend from. Read more posts first.`
  } else if (workingTopics.length > 0) {
    const names = workingTopics.map((f) => f.label).join(' and ')
    recommendation = `Your readings back more on ${names}${
      workingBucket ? `, and ${workingBucket.label} posts are carrying furthest` : ''
    }.`
  } else if (workingBucket) {
    recommendation = `No theme has three warm readings yet, but ${workingBucket.label} posts are carrying furthest.`
  } else {
    recommendation = `Nothing stands out from your typical post in this window. The openings tab may still have something worth answering.`
  }

  return {
    empty: false,
    windowId,
    windowLabel: windowLabel(anchor, windowId),
    postsStored: audience.postsStored,
    postsWalked: audience.postsRead,
    postsAnalysed: audience.postsAnalysed,
    postsInWindow: posts.length,
    measuredInWindow: lands.measuredPosts,
    commentsRead: audience.commentsRead,
    platforms: new Set(posts.map((p) => p.platform)).size,
    audience,
    lands,
    themes,
    thinTopics,
    credibility: reads.length > 0 ? { clean, unsure, of: reads.length } : null,
    cadence,
    undatedNote:
      undated.length > 0
        ? `${undated.join(' and ')} published no dates to the collector, so those posts cannot be placed in time.`
        : null,
    recommendation,
  }
}

/* ── tab two: the openings ──────────────────────────────────────────────── */

export interface Opening {
  kind: 'news' | 'grievance'
  id: string
  title: string
  /** Why this is on the list, in the pipeline's own words. */
  why: string
  severity: string | null
  url: string | null
  /** Shaped for the suggest endpoint, so a draft is one tap away. */
  issue: SuggestionIssue
}

export interface OpeningsModel {
  rows: Opening[]
  /** Stories read but held back by the relevance verdicts, never silent. */
  hiddenNews: number
  newsRead: number
  grievances: number
}

/**
 * What is worth answering this week: the stories the relevance pipeline let
 * through, and the open grievances, each already ranked by the module that
 * owns it. This function adds NO ranking of its own; it interleaves two lists
 * that arrive ranked, grievances first, because a grievance is somebody who
 * asked the office for something and a story is somebody who wrote about it.
 */
export function openingsOf(store: Store, since: number): OpeningsModel {
  const rows: Opening[] = []

  const issues: RankedIssue[] = issuesFor(store, since, 6)
  for (const issue of issues) {
    rows.push({
      kind: 'grievance',
      id: issue.id,
      title: issue.title,
      why:
        issue.count > 1
          ? `${issue.severity} severity, ${issue.count} records behind it.`
          : `${issue.severity} severity.`,
      severity: issue.severity,
      url: null,
      issue: {
        title: issue.title,
        summary: issue.summary ?? issue.title,
        category: 'grievance',
        severity: issue.severity,
      },
    })
  }

  const verdicts = readVerdicts(store.identity?.name ?? null)
  const news = newsSelection(store.personaMentions, since, 6, verdicts)
  const shown = news.filter((n) => worthShowing(verdictFor(n.mention.url, verdicts)))
  for (const n of shown) {
    const verdict = describeVerdict(verdictFor(n.mention.url, verdicts))
    rows.push({
      kind: 'news',
      id: n.mention.url,
      title: n.mention.headline,
      why:
        n.reason === 'suspect'
          ? 'Suspected false, and answering it early is the whole game.'
          : n.reason === 'critical'
            ? `Critical of you. ${verdict.label}.`
            : n.reason === 'action'
              ? `The reading recommends a response. ${verdict.label}.`
              : verdict.label,
      severity: n.reason === 'suspect' ? 'Critical' : n.reason === 'critical' ? 'High' : null,
      url: n.mention.url,
      issue: {
        title: n.mention.headline,
        summary: n.mention.summary ?? n.mention.headline,
        category: 'news',
        severity: n.reason === 'suspect' || n.reason === 'critical' ? 'High' : 'Medium',
      },
    })
  }

  const counts = countVerdicts(
    store.personaMentions.map((m) => verdictFor(m.url, verdicts)),
  )

  return {
    rows,
    hiddenNews: counts.hidden,
    newsRead: store.personaMentions.length,
    grievances: issues.length,
  }
}
