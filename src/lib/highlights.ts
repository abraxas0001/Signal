import type { Report } from '@shared/types'
import type { TrackedHandle, TrackedPost } from '@/lib/handles'
import { isPlatformAltText } from '@/lib/utils'

/**
 * "Post highlights": the office's own posts that drew the strongest reaction,
 * each with the full reading already stored behind it.
 *
 * Every field here comes out of a reading this desk has already paid for.
 * Nothing is scored in this file, nothing is fetched, and a post without a
 * reading is not ranked at all rather than ranked at zero — it appears in the
 * count of what is still unread, which is a fact the screen states.
 *
 * The reference design scores each post out of 100. The readings carry a
 * −100…+100 sentiment score, so the badge is that score mapped onto 0…100 and
 * labelled as what it is: how the audience answered, not a quality mark on
 * the post.
 */

export interface Highlight {
  url: string
  platform: TrackedHandle['platform']
  title: string
  thumbnailUrl: string | null
  publishedAt: string | null
  likes: number | null
  comments: number | null
  shares: number | null
  views: number | null
  /** Likes plus comments plus shares, over the figures actually published. */
  reactions: number
  /** True only when the platform published at least one reaction figure. */
  measured: boolean
  /**
   * What that total is made of, in words.
   *
   * A rollup that silently coalesces an unpublished figure to zero presents a
   * partial count as a complete one. The sum stays over what was published;
   * this sentence says which figures those were, and which were not there.
   */
  reactionsNote: string
  /** When the platform's figures above were read off the account. */
  readAt: string | null
  /**
   * Whether the reading had real comments under it.
   *
   * The emotions on a reading mean two different things: on a post with
   * comments they are the audience answering, on a post without them they are
   * the register of the post itself. The screen has to say which.
   */
  hasComments: boolean
  /**
   * How this post's reactions compare with the same account's typical post.
   *
   * Per-handle, never desk-wide. The platform means are not comparable at all
   * on this desk: Facebook averages 187 reactions over 25 posts, Instagram
   * 988, Twitter/X 42, and YouTube publishes no reaction figure whatsoever. A
   * single "better than your average post" across all four would say more
   * about which platform a post went out on than about the post.
   */
  versusTypical: { pct: number; baseline: number; posts: number } | null
  /** Why there is no comparison, where there is none. Null when there is one. */
  versusNote: string | null
  /**
   * Interactions against the audience that could have seen them, computed
   * fresh rather than read from the stored `engagementRate`.
   *
   * The stored field cannot be used: it is a fraction rather than a percent,
   * it is hard-set to null for Facebook and Instagram by the extractors
   * regardless of what was read, and where it does exist Twitter and YouTube
   * compute it from different numerators. Worse, it has no denominator
   * attached, and a rate whose denominator is unstated is not a measurement.
   * So the basis travels with the figure and the tile prints it.
   */
  engagement: {
    pct: number
    basis: 'views' | 'followers'
    denominator: number
    /** When the follower figure was read. Null on the views basis. */
    readAt: string | null
  } | null
  /** −100…+100 from the reading. */
  score: number
  /** The same score on the reference's 0…100 scale. */
  scoreOutOf100: number
  label: string
  /** How the audience answered, in the reading's own word. */
  narrative: string | null
  report: Report
}

/**
 * READING FIRST, LIKE EVERY OTHER FIGURE ON THIS SCREEN.
 *
 * These read the collector's listing alone while the cards beside them print
 * `figure()`, which prefers the post's own reading — so one row said "915
 * reactions" under a card reading 797 likes + 24 comments + 30 shares, and
 * three more rows disagreed with their own cards. Two numbers for one post on
 * one row is worse than either number alone.
 */
const reactionsOf = (p: TrackedPost, report: Report | null): number =>
  (figure(p, report, 'likes') ?? 0) +
  (figure(p, report, 'comments') ?? 0) +
  (figure(p, report, 'shares') ?? 0)

const hasReactions = (p: TrackedPost, report: Report | null): boolean =>
  figure(p, report, 'likes') != null ||
  figure(p, report, 'comments') != null ||
  figure(p, report, 'shares') != null

/**
 * The figure the platform published, preferring the stored reading's own
 * record over the collector's shorter one.
 *
 * These disagree, and on one platform the disagreement was total: the
 * collector stores no likes and no comments for ANY YouTube post, while the
 * full reading holds both for every YouTube post it has read. So this screen
 * printed "NA" sixteen times over figures that were sitting in the report it
 * was already displaying. The reading wins where it has a number, because it
 * is the more complete read; the collector fills in where the reading has
 * none. Null still means null in both, and is never coalesced to zero.
 */
const figure = (
  post: TrackedPost,
  /* Nullable: the baseline walks every post on the account, including ones
     with no stored reading, and must fall back to the collector for those. */
  report: Report | null,
  key: 'likes' | 'comments' | 'shares' | 'views',
): number | null => report?.snapshot.engagement[key]?.value ?? post[key] ?? null

/**
 * Interactions against the audience that could have seen them.
 *
 * Views first, because a view is a person who actually saw it. Where the
 * platform publishes none, the account's following stands in, and the tile
 * says which one it is: those are different denominators and a rate computed
 * over one is not comparable with a rate computed over the other. The
 * follower figure is the one last read, never one from the day of the post,
 * because no platform publishes a historical follower count and pretending
 * otherwise would date a number that has no date.
 */
function engagementOf(
  post: TrackedPost,
  report: Report,
  followers: number | null,
  followersReadAt: string | null,
): Highlight['engagement'] {
  const interactions =
    (figure(post, report, 'likes') ?? 0) +
    (figure(post, report, 'comments') ?? 0) +
    (figure(post, report, 'shares') ?? 0)
  if (interactions <= 0) return null

  const views = figure(post, report, 'views')
  if (views != null && views > 0) {
    return { pct: (interactions / views) * 100, basis: 'views', denominator: views, readAt: null }
  }
  if (followers != null && followers > 0) {
    return {
      pct: (interactions / followers) * 100,
      basis: 'followers',
      denominator: followers,
      readAt: followersReadAt,
    }
  }
  return null
}

/** Which of the three figures the total is actually made of. */
function reactionsNoteOf(p: TrackedPost, report: Report | null): string {
  /* Named over the SAME merged figures the row prints, so the note can never
     itemise a different total than the one beside it. */
  const parts: [string, number | null | undefined][] = [
    ['likes', figure(p, report, 'likes')],
    ['comments', figure(p, report, 'comments')],
    ['shares', figure(p, report, 'shares')],
  ]
  const had = parts.filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`)
  const missing = parts.filter(([, v]) => v == null).map(([k]) => k)
  if (had.length === 0) return 'This platform published no reaction figure for this post.'
  const sum = `Reactions counts ${had.join(' plus ')}.`
  return missing.length === 0
    ? sum
    : `${sum} ${missing.join(' and ')} ${missing.length === 1 ? 'was' : 'were'} not published for this post, so ${missing.length === 1 ? 'it is' : 'they are'} not in the total.`
}

/**
 * A picture that an image tag can actually render.
 *
 * A video attachment is a legitimate piece of a post's media record and a
 * hopeless src for an img: the Twitter reading stores an .mp4, the tag decodes
 * nothing, and the card renders as a grey rectangle with no fallback because
 * the url was never null. Only stills are offered here; a post whose only
 * media is video falls through to the tile that says so.
 */
const stillOf = (report: Report): string | null => {
  const image = report.snapshot.media.find((m) => m.kind === 'image')?.url
  if (image) return image
  const other = report.snapshot.media.find(
    (m) => m.kind === 'video' && /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(m.url),
  )
  return other?.url ?? null
}

/** Where the collector cuts a caption, and the platforms it cuts. */
const CAPTION_CUT = 140
const CUT_PLATFORMS = new Set(['Facebook', 'Instagram', 'LinkedIn', 'YouTube'])

/**
 * A stored caption, with the collector's cut shown as a cut.
 *
 * Four adapters store `text.slice(0, 140)` (scraper/adapters/facebook.ts:746
 * and its siblings in instagram.ts, linkedin.ts and youtube.ts), so 286
 * captions on this roster are exactly 140 characters long and end mid-word.
 * One of D. K. Aruna's reads "…బసవతారకం క్యాన్సర్ ఆసుపత్రి నిపుణులైన వైద్య
 * బృందం చేత జడ్చర్ల నియోజక", severed inside "నియోజకవర్గం", and every screen
 * that prints it presents those 140 characters as the whole of what the
 * office wrote. The words cannot be recovered here; that they were cut can be
 * said, and an ellipsis is the difference between a caption and the first 140
 * characters of one.
 *
 * Twitter/X is not in the set: no adapter cuts it below the platform's own
 * 280, so a tweet that runs to exactly 140 is complete, and one on this
 * roster is. Nothing is appended to a caption that already ends in an
 * ellipsis of its own.
 */
export function captionOf(title: string | null | undefined, platform: string): string {
  const raw = title ?? ''
  const shown = raw.trim()
  if (!shown || raw.length !== CAPTION_CUT || !CUT_PLATFORMS.has(platform)) return shown
  return /(?:…|\.\.\.)$/.test(shown) ? shown : `${shown}…`
}

/**
 * THE SAME KEYWORD WRITTEN TWO WAYS IS ONE KEYWORD.
 *
 * The chip row is built from the post's own hashtags plus the tags the reading
 * assigned, and those two sources disagree on shape rather than on substance:
 * the caption carries `#FreeHealthCamp` and `#Mahabubnagar`, the reading files
 * `free-health-camp` and `mahabubnagar`. `new Set()` over the raw strings saw
 * four distinct values in each pair, so ten chips on this desk's top post were
 * six words, four of them printed twice in two casings.
 *
 * The comparison case-folds and drops every separator, which is the only
 * difference between the two forms. The DISPLAY keeps the first form seen —
 * the office's own hashtag, since the post's own tags are listed first — so
 * nothing is rewritten, only the second spelling of an already-listed word is
 * dropped.
 */
export function dedupeTags(tags: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const shown = (raw ?? '').trim().replace(/^#+/, '').trim()
    if (!shown) continue
    const key = shown.toLowerCase().replace(/[\s._\-/\\]+/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(shown)
  }
  return out
}

/**
 * Every own post that carries a full reading, strongest reaction first.
 *
 * "Strongest reaction" is deliberately not "most likes": a post that drew two
 * hundred furious comments is a highlight, and ranking on applause alone
 * would bury it. Posts are ordered by how far the audience moved from
 * indifference — the absolute sentiment score — with engagement breaking ties.
 */
export function highlightsOf(
  handles: TrackedHandle[],
  reports: Map<string, Report> | null,
): { highlights: Highlight[]; unread: number } {
  if (!reports) return { highlights: [], unread: 0 }
  const own = handles.filter((h) => h.own)
  const out: Highlight[] = []
  let unread = 0

  for (const h of own) {
    const snapshot = h.snapshots.at(-1)
    const posts = snapshot?.posts ?? []

    /*
     * What a typical post on THIS account draws, over the posts the desk
     * holds for it. Posts the platform published no reaction figure for are
     * left out of the mean rather than counted as zero: a YouTube account
     * publishes no likes at all, and averaging its twenty-five silences would
     * produce a baseline of nought and a comparison saying every post beats
     * it by infinity.
     */
    const measuredPosts = posts.filter((p) => hasReactions(p, reports.get(p.url) ?? null))
    /**
     * THE MEDIAN, NOT THE MEAN.
     *
     * "Your average post" was the arithmetic mean, and on an account with one
     * post that went far — which is most political accounts — the mean sits
     * well above anything the account typically does. A perfectly ordinary
     * post then reported "drawing 89% below your average", which is true of
     * the mean and useless as a judgement: the desk read it as the post having
     * failed when it had done what its posts normally do.
     *
     * The median is what "a typical post" means in plain English: half do
     * better, half do worse, and one runaway cannot move it.
     */
    const sortedReactions = measuredPosts
      .map((p) => reactionsOf(p, reports.get(p.url) ?? null))
      .sort((x, y) => x - y)
    const mid = Math.floor(sortedReactions.length / 2)
    const baseline =
      sortedReactions.length >= 3
        ? sortedReactions.length % 2 === 1
          ? sortedReactions[mid]!
          : (sortedReactions[mid - 1]! + sortedReactions[mid]!) / 2
        : null

    for (const p of posts) {
      const report = reports.get(p.url)
      const analysis = report?.analysis
      if (!report || !analysis) {
        unread += 1
        continue
      }
      const score = analysis.sentiment.score
      const mine = reactionsOf(p, report)
      const followers =
        report.snapshot.author.followers?.value ?? snapshot?.followers ?? null

      out.push({
        url: p.url,
        platform: h.platform,
        /* The reading's headline beats the platform's alt text: one says
           what the post is about, the other describes the picture that is
           already on screen beside it. The last resort is words, not the
           permalink: a post whose caption and headline are both empty has no
           title, and printing its address in the title slot says nothing and
           looks like a caption. Content insights had the same last resort and
           printed a bare facebook.com/reel/… address as a post title. */
        title: isPlatformAltText(p.title)
          ? analysis.headline?.trim() || captionOf(p.title, h.platform) || 'Untitled post'
          : captionOf(p.title, h.platform) || analysis.headline?.trim() || 'Untitled post',
        thumbnailUrl: p.thumbnailUrl ?? stillOf(report),
        publishedAt: p.publishedAt ?? report.snapshot.publishedAt ?? null,
        likes: figure(p, report, 'likes'),
        comments: figure(p, report, 'comments'),
        shares: figure(p, report, 'shares'),
        views: figure(p, report, 'views'),
        versusTypical:
          baseline != null && baseline > 0 && hasReactions(p, report)
            ? {
                pct: ((mine - baseline) / baseline) * 100,
                baseline: Math.round(baseline),
                posts: measuredPosts.length,
              }
            : null,
        versusNote:
          baseline == null || baseline <= 0
            ? 'No baseline to compare against.'
            : hasReactions(p, report)
              ? null
              : 'Not published for this post.',
        engagement: engagementOf(p, report, followers, snapshot?.takenAt ?? null),
        reactions: reactionsOf(p, report),
        measured: hasReactions(p, report),
        reactionsNote: reactionsNoteOf(p, report),
        readAt: snapshot?.takenAt ?? null,
        hasComments: (report.snapshot.comments?.length ?? 0) > 0,
        score,
        scoreOutOf100: Math.round((score + 100) / 2),
        label: analysis.sentiment.label,
        narrative:
          analysis.sentiment.publicNarrative && analysis.sentiment.publicNarrative !== 'NA'
            ? analysis.sentiment.publicNarrative
            : null,
        report,
      })
    }
  }

  out.sort((a, b) => {
    const move = Math.abs(b.score) - Math.abs(a.score)
    if (move !== 0) return move
    return b.reactions - a.reactions
  })
  return { highlights: out, unread }
}

/** The strongest few, for the dashboard's compact card. */
export const topHighlights = (all: Highlight[], n: number): Highlight[] => all.slice(0, n)

/**
 * RECEPTION IS A THING THE AUDIENCE DID, SO ONLY POSTS WITH AN AUDIENCE
 * REPLY ARE IN THESE TWO RANKINGS.
 *
 * Both used to filter on the score alone. On a post nobody commented on that
 * score was read from the post's OWN words, so "Worst received" put
 * https://www.youtube.com/watch?v=FWEVHaubanE third of five at −80 over a
 * video with no comments, on a stored rationale that opens "judging from the
 * post itself, which uses accusatory language"; and 21 of the 56 rows in
 * "Best received" were the same mistake in the warm direction. `hasComments`
 * was already on every highlight and nothing consulted it here.
 *
 * The filter, not a chip: a lens whose name is a claim about how people
 * received a post cannot list posts no one received. The unfiltered ranking
 * of every read post still exists, under "By platform", where the cards say
 * on their face which posts have no comments behind their score.
 *
 * Warmly received first, over the posts that have comments to be received in.
 */
export const bestReceived = (all: Highlight[]): Highlight[] =>
  [...all].filter((h) => h.hasComments && h.score > 0).sort((a, b) => b.score - a.score)

/** Worst received first, on the same terms. */
export const worstReceived = (all: Highlight[]): Highlight[] =>
  [...all].filter((h) => h.hasComments && h.score < 0).sort((a, b) => a.score - b.score)
