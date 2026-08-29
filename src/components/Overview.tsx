import { Fragment } from 'react'
import * as m from 'motion/react-m'
import { CheckCircle2, MinusCircle, Info, Link2, LayoutGrid, GitCompareArrows } from 'lucide-react'
import type { Platform } from '@shared/taxonomy'
import { Card, SectionTitle, Button, SignalGlyph } from './ui'
import { CardHead, PlatformBadge, DeltaChip, Sparkline } from '@/components/kit'
import { Mascot } from './Mascot'
import { fadeUp, listStagger } from '@/lib/motion'
import { listHandles, statsFor, deltaFor, type TrackedHandle } from '@/lib/handles'

/**
 * The dashboard: what is being watched, and what this tool can currently see.
 *
 * This is the landing screen, so it answers the two questions someone opening
 * the app actually has — how are my accounts doing, and is anything broken —
 * without making them tap into a section to find out.
 *
 * The connector status board is the part that earns its place. Every platform
 * this product reads is gated differently, and those gates move: Instagram
 * gives a follower count and no timeline, Facebook gives a follower count and
 * no posts, YouTube gives everything. Burying that in a paragraph inside
 * Accounts meant a user could sit looking at an empty Instagram row deciding
 * the product was broken. Stated up front, it is a known limit rather than a
 * fault.
 */

interface Connector {
  platform: Platform
  posts: 'full' | 'partial' | 'none'
  comments: 'full' | 'partial' | 'none'
  followers: boolean
  note: string
}

/**
 * Measured, not assumed — every line here was established by fetching the
 * thing and recording what came back.
 */
const CONNECTORS: Connector[] = [
  {
    platform: 'YouTube',
    posts: 'full',
    comments: 'full',
    followers: true,
    note: '15 recent uploads with views and likes; up to 100 comments a post.',
  },
  {
    platform: 'Bluesky',
    posts: 'full',
    comments: 'full',
    followers: true,
    note: '20 recent posts; replies come with the thread.',
  },
  {
    platform: 'Mastodon',
    posts: 'full',
    comments: 'full',
    followers: true,
    note: '20 recent posts and their replies, from the public timeline.',
  },
  {
    platform: 'Facebook',
    posts: 'none',
    comments: 'partial',
    followers: true,
    note: 'Follower count only. The page publishes no post list to anyone without a login. Individual posts read fine, with 10 comments each (2 on reels).',
  },
  {
    platform: 'Instagram',
    posts: 'none',
    comments: 'none',
    followers: true,
    note: 'Follower count only. The timeline needs a login, and comment bodies are not reachable at all.',
  },
  {
    platform: 'LinkedIn',
    posts: 'none',
    comments: 'partial',
    followers: false,
    note: 'Activity sits behind a login. Individual posts read fine, with up to 10 comments.',
  },
  {
    platform: 'Twitter/X',
    posts: 'none',
    comments: 'none',
    followers: false,
    note: 'Individual posts read fine. Replies are capped at one to three by the platform, so they are not collected.',
  },
]

const MARK = {
  full: { icon: CheckCircle2, tone: 'text-[var(--pos)]', label: 'yes' },
  partial: { icon: MinusCircle, tone: 'text-[var(--warn)]', label: 'partly' },
  none: { icon: MinusCircle, tone: 'text-ink-3', label: 'no' },
} as const

/**
 * One cell of the matrix: the mark only.
 *
 * The word was repeated in every cell under a column header that already said
 * it, so a seven-row grid carried twenty-one redundant labels. The icon differs
 * by shape as well as colour — a filled tick against an open dash — so it still
 * reads without colour vision, and the full sentence stays available to a
 * screen reader.
 */
function Mark({ state, what }: { state: Connector['posts']; what: string }) {
  const { icon: Icon, tone, label } = MARK[state]
  return (
    <span className={tone} title={`${what}: ${label}`}>
      <Icon size={15} aria-hidden />
      <span className="sr-only">{`${what}: ${label}`}</span>
    </span>
  )
}

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-IN'))

export function Overview({
  onAnalyse,
  onAccounts,
  onCompare,
  historyCount,
}: {
  onAnalyse: () => void
  onAccounts: () => void
  onCompare: () => void
  historyCount: number
}) {
  const handles: TrackedHandle[] = listHandles()
  const withReadings = handles.filter((h) => h.snapshots.length > 0)
  const mine = withReadings.filter((h) => h.own)

  const totalFollowers = withReadings
    .map((h) => statsFor(h.snapshots.at(-1)).followers)
    .filter((f): f is number => f != null)
    .reduce((a, b) => a + b, 0)

  return (
    <m.div
      className="shell shell-prose stack page-end"
      variants={listStagger}
      initial="hidden"
      animate="show"
    >
      <m.div variants={fadeUp}>
        {/* The mark, not a text kicker. The header carries it and the hero
            carries it; the dashboard spelling "SIGNAL" in mono was the odd one
            out and part of why this screen read as a different product. */}
        <span className="inline-flex items-center gap-2 text-[var(--accent)]">
          <span className="grid size-7 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] shadow-[var(--e1)]">
            <SignalGlyph size={15} />
          </span>
          <span className="text-sm font-semibold tracking-[-0.03em] text-ink">Signal</span>
        </span>

        <h1 className="hed mt-6 text-[2.6rem]">
          Where you
          <br />
          <span className="text-[var(--accent)]">stand today.</span>
        </h1>
        {/* The mascot reacts to the state of the board rather than sitting
            there as decoration: pleased once something is being tracked,
            waiting when the board is empty. Beside the line, not above it —
            looming over the headline is what made the product read as a toy. */}
        {withReadings.length > 0 ? (
          <div className="mt-4 flex items-center gap-3">
            <Mascot state="success" size={48} />
            <p className="text-[15px] leading-relaxed text-ink-2">
              <span className="tnum font-bold text-ink">{fmt(totalFollowers)}</span> people follow the{' '}
              <span className="tnum font-bold text-ink">{withReadings.length}</span>{' '}
              account{withReadings.length === 1 ? '' : 's'} you watch.
            </p>
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-3">
            <Mascot state="empty" size={48} />
            <p className="text-[15px] leading-relaxed text-ink-2">
              Nothing tracked yet. Add an account, or read a single post.
            </p>
          </div>
        )}
      </m.div>

      {/* ── At a glance ─────────────────────────────────────────────────── */}
      {withReadings.length > 0 && (
        <m.section variants={fadeUp}>
          <SectionTitle
            action={
              <Button size="sm" variant="outline" onClick={onAccounts} aria-label="Manage accounts">
                <LayoutGrid size={14} /> Manage
              </Button>
            }
          >
            Your accounts
          </SectionTitle>
          <div className="space-y-3">
            {withReadings.slice(0, 4).map((h) => {
              const s = statsFor(h.snapshots.at(-1))
              const d = deltaFor(h)
              // The follower reading from every snapshot on record — a real
              // trend line drawn only from measurements actually taken. The
              // Sparkline draws nothing under two readings, so a freshly-added
              // account shows no invented shape.
              const followerTrend = h.snapshots.map((snap) => snap.followers)
              const hasTrend = followerTrend.filter((v) => v != null).length >= 2
              const trendColor =
                d.followers == null || d.followers === 0
                  ? 'var(--accent)'
                  : d.followers > 0
                    ? 'var(--pos)'
                    : 'var(--neg)'
              return (
                <Card key={h.id} tone={h.own ? 'accent' : undefined} className="card-hover">
                  <div className="flex items-center gap-3">
                    <PlatformBadge platform={h.platform} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-ink">
                        {h.displayName ?? h.handle}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                        <span className="tnum">{fmt(s.followers)} followers</span>
                        {d.followers != null && d.followers !== 0 && (
                          <DeltaChip
                            value={d.followers}
                            suffix=""
                            title="Change since the previous reading"
                          />
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="tnum block text-2xl font-bold leading-none tracking-[-0.02em] text-ink">
                        {s.engagementRate != null ? s.engagementRate.toFixed(2) : '—'}
                        {s.engagementRate != null && (
                          <span className="text-sm font-semibold text-ink-3">%</span>
                        )}
                      </span>
                      <span className="kicker mt-1.5 block">engagement</span>
                    </span>
                  </div>
                  {hasTrend && (
                    <div className="mt-3 flex items-center gap-3 border-t border-[var(--border)] pt-3">
                      <span className="kicker shrink-0">followers</span>
                      <div className="min-w-0 flex-1">
                        <Sparkline values={followerTrend} color={trendColor} height={30} />
                      </div>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
          {withReadings.length > 1 && (
            <div className="mt-4">
              <Button size="sm" variant="outline" onClick={onCompare}>
                <GitCompareArrows size={14} /> Compare
              </Button>
            </div>
          )}
        </m.section>
      )}

      {/* ── Read a post ─────────────────────────────────────────────────── */}
      <m.section variants={fadeUp}>
        <Card tone="accent" level="lift">
          <CardHead
            icon={<Link2 size={16} aria-hidden />}
            tint="blue"
            title="Read a post"
            sub="Any public link, in any language"
          />
          <Button className="mt-4" size="sm" onClick={onAnalyse}>
            <Link2 size={14} /> Read a post
          </Button>
          {historyCount > 0 && (
            <p className="tnum mt-2.5 text-xs text-ink-3">
              {historyCount} post{historyCount === 1 ? '' : 's'} read so far.
            </p>
          )}
        </Card>
      </m.section>

      {/* ── What we can see, per platform ───────────────────────────────── */}
      <m.section variants={fadeUp}>
        <SectionTitle>
          What we can read
        </SectionTitle>
        <Card>
          <div className="grid grid-cols-[1fr_repeat(3,minmax(3.6rem,auto))] items-center gap-x-2 gap-y-0">
            <span />
            {['Followers', 'Posts', 'Comments'].map((h) => (
              <span key={h} className="kicker pb-2 text-center">
                {h}
              </span>
            ))}

            {CONNECTORS.map((c) => (
              <Fragment key={c.platform}>
                <span className="flex items-center gap-2.5 border-t border-[var(--border)] py-2.5">
                  <PlatformBadge platform={c.platform} size={24} />
                  <span className="truncate text-sm font-medium text-ink">
                    {c.platform === 'Twitter/X' ? 'X' : c.platform}
                  </span>
                </span>
                {([c.followers ? 'full' : 'none', c.posts, c.comments] as const).map((state, i) => (
                  <span
                    key={i}
                    className="grid place-items-center border-t border-[var(--border)] py-2.5"
                  >
                    <Mark state={state} what={['followers', 'posts', 'comments'][i]!} />
                  </span>
                ))}
              </Fragment>
            ))}
          </div>

          {/* The detail lives under the grid rather than beside every row, so
              the matrix stays scannable and the caveats stay readable. */}
          <details className="group mt-4 rounded-[var(--radius-md)] bg-[var(--surface-2)]">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3.5 text-xs font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
              <Info size={14} className="shrink-0 text-ink-3" aria-hidden />
              What each platform actually gives
            </summary>
            <ul className="space-y-2 px-3.5 pb-3.5">
              {CONNECTORS.map((c) => (
                <li key={c.platform} className="text-xs leading-relaxed text-ink-3">
                  <span className="font-semibold text-ink-2">
                    {c.platform === 'Twitter/X' ? 'X' : c.platform}
                  </span>{': '}
                  {c.note}
                </li>
              ))}
            </ul>
          </details>
        </Card>
      </m.section>

      {mine.length === 0 && (
        <m.div variants={fadeUp}>
          <Card>
            <CardHead
              icon={<LayoutGrid size={16} aria-hidden />}
              tint="violet"
              title="Track your first account"
              sub="Start with a YouTube channel"
            />
            <Button className="mt-4" size="sm" onClick={onAccounts}>
              <LayoutGrid size={14} /> Add an account
            </Button>
          </Card>
        </m.div>
      )}
    </m.div>
  )
}
