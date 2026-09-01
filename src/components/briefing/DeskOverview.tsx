import { useState } from 'react'
import { MapPin, MessageSquare, Plus, TrendingUp, Users } from 'lucide-react'
import type { Identity } from '@shared/identity'
import { Avatar, Card } from '../ui'
import {
  CardHead,
  ColumnChart,
  HBarBoard,
  IndiaMap,
  PillTabs,
  PlatformBadge,
  PostThumbCard,
  RankRow,
  youtubeThumb,
} from '@/components/kit'
import { geocodePlace, partyColor } from '../gazetteer'
import { INDIA_DOTS, INDIA_BBOX } from '../india-dots'
import type { TrackedHandle } from '@/lib/handles'
import { latestFollowersOf } from '@/lib/briefing'
import { scopedKey } from '@/lib/store'
import { cn, compact, full } from '@/lib/utils'

/**
 * The ground-and-reach half of the desk at a glance, moved out of Briefing.tsx
 * whole. Everything here is a measurement read from the tracked accounts and
 * the identity this device already holds; nothing fetches and nothing invents.
 * The most-engaging strip that used to close this component now lives in
 * `MostEngagingStrip`, because the restructure gives it a section of its own.
 */

export interface DeskPost {
  url: string
  platform: string
  title: string | null
  author: string
  engagement: number
  /** False when the platform published no likes or comments — never a zero. */
  measured: boolean
  views: number | null
  /**
   * When the platform said it went up, ISO. The engagement card's week
   * window keys on this; a post without one only qualifies for "All stored".
   */
  publishedAt: string | null
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
 * Every stored post from the given accounts' latest snapshots, one DeskPost
 * each — no ordering, no cap. The strip and the engagement card both start
 * here and then select differently: the strip wants one lead per platform,
 * the card wants a true ranking, and one pre-cropped list cannot serve both.
 */
function collectDeskPosts(handles: TrackedHandle[]): DeskPost[] {
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
        publishedAt: p.publishedAt,
        metaLine: [p.views != null ? `${compact(p.views)} views` : null, eng > 0 ? `${compact(eng)} reactions` : null]
          .filter(Boolean)
          .join(' · '),
      })
    }
  }
  return posts
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
export function deskPosts(handles: TrackedHandle[]): DeskPost[] {
  const posts = collectDeskPosts(handles)
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
 * The most-engaging strip, exactly as it always rendered — each card with an
 * Analyse button that runs the full read (comments, sentiment, fake-news) in
 * the app. Its own section now, but the same card, the same posts, the same
 * wiring.
 */
export function MostEngagingStrip({
  posts,
  onRead,
}: {
  posts: DeskPost[]
  onRead: (postUrl: string) => void
}) {
  if (posts.length === 0) return null
  return (
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
  )
}

/* ── Engagement-by-post window ───────────────────────────────────────────── */

/** The engagement card's two windows. A per-desk choice, so a scoped key. */
type EngagementWindow = 'week' | 'all'
const WINDOW_TABS: { id: EngagementWindow; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'all', label: 'All stored' },
]
const windowKey = (): string => scopedKey('signal.engagement.window.v1')

/** A rank row's label: where the post lives, then what it says. */
function PostRankLabel({ post }: { post: DeskPost }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <PlatformBadge platform={post.platform} size={16} />
      <span className="truncate">{post.title ?? post.author}</span>
    </span>
  )
}

/**
 * The views-only tail of the rank list: posts whose platform published a view
 * count and no reactions. They rank among themselves, in views, under their
 * own heading. Folding them into the reactions ranking was exactly the bug
 * where a YouTube video sat at "#4 best performing" showing 0.
 */
function MostViewedRows({ posts, onRead }: { posts: DeskPost[]; onRead: (postUrl: string) => void }) {
  if (posts.length === 0) return null
  return (
    <div>
      <p className="eyebrow mb-2">Most viewed</p>
      {posts.map((p, i) => (
        <RankRow
          key={p.url}
          className="min-h-11"
          rank={i + 1}
          label={<PostRankLabel post={p} />}
          value={`${compact(p.views ?? 0)} views`}
          tint="teal"
          onClick={() => onRead(p.url)}
          title="Analyse this post"
        />
      ))}
    </div>
  )
}

/**
 * The home's ground-and-reach block — the office's own ground and reach, drawn
 * from the tracked accounts and identity this device already holds. It is the
 * account screen's headline content surfaced on the dashboard so the home is
 * a live desk, not an empty page, before the morning scan has found anything.
 *
 * Honest by construction: the constituency lights only if the seat resolves
 * against the offline gazetteer, a handle with no reading shows a dash rather
 * than a fabricated count, and the map lights in the party's own colour.
 */
export function DeskOverview({
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
   * `own` is the desk; anything else is being watched, and watched accounts
   * appear on the board below and on Compare, labelled as rivals rather than
   * folded into a total.
   *
   * There is no "and if nothing is marked, total everything" fallback any
   * more. It was here and in Briefing, and it is how a desk holding one
   * 1.6-crore account belonging to another politician reported 1.6 crore as
   * its own reach. A desk that marks nothing as its own has no own figures,
   * and saying so is the only true answer.
   */
  const counted = own

  // The seat, geocoded once. Null when it will not resolve — the map then
  // centres on India and says so rather than pinning a plausible dot. The
  // ground lights in the party's colour (BJP saffron, Congress blue, …).
  const seat = geocodePlace(identity?.constituency ?? identity?.district ?? identity?.state ?? null)
  const ground = partyColor(identity?.party)


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
      const f = latestFollowersOf(h)
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
  const allPosts = collectDeskPosts(own)
  const zones = seat ? [{ lon: seat.lon, lat: seat.lat, radiusDeg: 1.3, label: `${seat.name}, ${seat.state}` }] : []

  /**
   * The engagement card's one ranking, selected before anything is drawn.
   *
   * It used to number eight bars and THEN drop the zero-value ones, so a zero
   * post left a hole in the axis (#4 missing on screen), while the row list
   * beside it was a different selection that printed "0" as the engagement of
   * a views-only YouTube post at rank 4. One set now feeds both views, so bar
   * #n is row #n and the labels are contiguous by construction.
   *
   * Zero-engagement measured posts appear nowhere: a post nobody reacted to
   * is not a best performer. Views-only posts are real but counted in a
   * different unit, so they rank in their own short list below, in views, and
   * get no bar — a reactions chart must not draw a views number.
   */
  const ranked = allPosts
    .filter((p) => p.measured && p.engagement > 0)
    .sort((a, b) => b.engagement - a.engagement)
  const mostViewed = allPosts
    .filter((p) => !p.measured && (p.views ?? 0) > 0)
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))

  /**
   * The week window anchors to the NEWEST post the desk has stored, not to
   * the wall clock: the demo dataset is fixed, and a calendar week would
   * silently empty this card seven days after the capture. A post without a
   * date cannot be placed in any week, so it only qualifies for "All stored".
   */
  const postedAt = (p: DeskPost): number | null => {
    if (!p.publishedAt) return null
    const t = new Date(p.publishedAt).getTime()
    return Number.isFinite(t) ? t : null
  }
  const newest = allPosts.reduce<number | null>((max, p) => {
    const t = postedAt(p)
    return t != null && (max == null || t > max) ? t : max
  }, null)
  const inWeek = (p: DeskPost): boolean => {
    const t = postedAt(p)
    return newest != null && t != null && newest - t <= 7 * 86_400_000
  }
  const weekRanked = ranked.filter(inWeek)

  // The saved choice wins; otherwise the week leads only when it has enough
  // to chart. Null means "never chosen", a different claim than "chose all".
  const [windowChoice, setWindowChoice] = useState<EngagementWindow | null>(() => {
    try {
      const saved = localStorage.getItem(windowKey())
      return saved === 'week' || saved === 'all' ? saved : null
    } catch {
      return null
    }
  })
  const selectWindow = (w: EngagementWindow): void => {
    setWindowChoice(w)
    try {
      localStorage.setItem(windowKey(), w)
    } catch {
      /* over quota — the tab still switches, it just will not persist */
    }
  }
  // With no dated posts there is no week to offer, whatever was saved.
  const activeWindow: EngagementWindow =
    newest == null ? 'all' : (windowChoice ?? (weekRanked.length >= 3 ? 'week' : 'all'))

  const rankedShown = (activeWindow === 'week' ? weekRanked : ranked).slice(0, 6)
  const viewedShown = (activeWindow === 'week' ? mostViewed.filter(inWeek) : mostViewed).slice(0, 3)
  // Labels assigned AFTER selection, so #1..#n stay contiguous on the axis.
  // Each bar wears its platform under it and its count above it, so the chart
  // answers "how much, where" without a trip to the list beside it.
  const postBars = rankedShown.map((p, i) => ({
    label: `#${i + 1}`,
    value: p.engagement,
    highlight: i === 0,
    icon: <PlatformBadge platform={p.platform} size={18} />,
  }))

  /* The indexed follower LineChart and the reach-share donut that rendered
     here are gone as duplicates, not casualties: GrowthCard already answers
     "growth against last week" in plain numbers one card down, and the reach
     tiles above the map already carry every figure the donut re-plotted. One
     question, one card. */

  return (
    <div className="stack-tight">
      {/* Ground + reach. The map is a fixed panel; the reach column fills the
          rest and never stretches its tiles to match the map's height. */}
      <div className="grid items-start gap-4 lg:grid-cols-12">
        {/* The map — the office's ground, lit in the party colour. A narrow
            column: the whole country is orientation, not data, and at five of
            twelve columns it spent a third of the row establishing one dot. */}
        <Card className="lg:col-span-4" padded={false} level="lift">
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
                    ? 'Seat not mapped yet.'
                    : 'Set your constituency in Settings.'
              }
            />
          </div>
          {/* Capped at every width, not only on a phone.
              The map is orientation, not data: the reader needs to see where
              the seat sits, not to read the map. The country's near-square
              aspect at full column width cost 500px of screen to establish
              one dot; capped and centred it does the same job small. */}
          <div className="grid max-h-[280px] place-items-center overflow-hidden p-3 sm:max-h-[340px] sm:p-4">
            <IndiaMap
              dots={INDIA_DOTS}
              bbox={INDIA_BBOX}
              zones={zones}
              accentColor={ground}
              className="max-h-[256px] w-auto sm:max-h-[300px]"
            />
          </div>
        </Card>

        {/* Reach — the follower board fills the column beside the map. */}
        <div className="flex flex-col gap-4 lg:col-span-8">
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

      {/* Engagement per post — the shape of what actually landed.
          The card renders whenever a window can chart two reacted posts or a
          views-only tail exists; otherwise there is nothing honest to draw. */}
      {(ranked.length >= 2 || mostViewed.length > 0) && (
        <Card className="p-4 sm:p-6">
          <CardHead
            icon={<MessageSquare size={16} aria-hidden />}
            tint="green"
            title="Engagement by post"
            sub={activeWindow === 'week' ? 'Week of newest post' : 'Every stored post'}
            action={
              newest != null ? (
                /* In the head where the width exists; below it on a phone,
                   where two pills beside the title would crush it. */
                <div className="hidden sm:block">
                  <PillTabs tabs={WINDOW_TABS} active={activeWindow} onChange={selectWindow} />
                </div>
              ) : undefined
            }
          />
          {newest != null && (
            <div className="mb-3 sm:hidden">
              <PillTabs tabs={WINDOW_TABS} active={activeWindow} onChange={selectWindow} />
            </div>
          )}
          {rankedShown.length >= 2 ? (
            /* min-w-0 on BOTH grid children, and it is not decoration: a grid
               item's default min-width is its content, and a rank row's
               content is an untruncated post title. On a phone that let the
               widest title set the column at ~2,300px, the whole card grew to
               match, and the chart — which sizes itself to its container —
               drew six bars across six screens. Truncation only works when
               something upstream refuses to grow. */
            <div className="grid items-start gap-4 lg:grid-cols-5">
              <div className="min-w-0 lg:col-span-3">
                {/* Blue, not violet. Violet is spoken for: it means "the example desk"
                  on the demo door, and a second accent used decoratively on data
                  is how a palette stops meaning anything. */}
                <ColumnChart columns={postBars} gradient="blue" height={190} formatValue={compact} showValues />
              </div>
              <div className="min-w-0 lg:col-span-2">
                <p className="eyebrow mb-2">Best performing</p>
                {rankedShown.map((p, i) => (
                  <RankRow
                    key={p.url}
                    className="min-h-11"
                    rank={i + 1}
                    label={<PostRankLabel post={p} />}
                    value={`${compact(p.engagement)} reactions`}
                    tint={i === 0 ? 'violet' : 'blue'}
                    onClick={() => onRead(p.url)}
                    title="Analyse this post"
                  />
                ))}
                {viewedShown.length > 0 && (
                  <div className="mt-4">
                    <MostViewedRows posts={viewedShown} onRead={onRead} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            // One reacted post cannot make a chart, and a one-bar chart reads
            // as broken. Say so, and hand over the window that can.
            <div>
              <p className="text-[13px] text-ink-2">
                {activeWindow === 'week'
                  ? 'Fewer than two posts drew reactions this week.'
                  : 'Fewer than two stored posts drew reactions.'}
              </p>
              {activeWindow === 'week' && ranked.length >= 2 && (
                <button
                  type="button"
                  onClick={() => selectWindow('all')}
                  className="inline-flex min-h-11 items-center text-[12px] font-semibold text-[var(--accent)] hover:underline"
                >
                  Show all stored
                </button>
              )}
              {viewedShown.length > 0 && (
                <div className="mt-3">
                  <MostViewedRows posts={viewedShown} onRead={onRead} />
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
