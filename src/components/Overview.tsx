import { Fragment } from 'react'
import * as m from 'motion/react-m'
import { CheckCircle2, MinusCircle, Link2, LayoutGrid, GitCompareArrows } from 'lucide-react'
import type { Platform } from '@shared/taxonomy'
import { Card, SectionTitle, Button, SignalGlyph } from './ui'
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
    note: 'Follower count only — the page publishes no post list to anyone without a login. Individual posts read fine, with 10 comments each (2 on reels).',
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
    note: 'Individual posts read fine. Replies are capped at 1–3 by the platform, so they are not collected.',
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

/** The platform's own mark, so a row is identifiable before it is read. */
function PlatformDot({ platform }: { platform: Platform }) {
  const tone: Record<string, string> = {
    YouTube: '#FF0033',
    Instagram: '#C13584',
    Facebook: '#0866FF',
    LinkedIn: '#0A66C2',
    Bluesky: '#1185FE',
    Mastodon: '#6364FF',
    'Twitter/X': '#111111',
  }
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full ring-1 ring-black/10"
      style={{ background: tone[platform] ?? 'var(--ink-3)' }}
    />
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
      className="mx-auto w-full max-w-2xl space-y-9 px-4 pb-[calc(7rem+var(--sab))] pt-1"
      variants={listStagger}
      initial="hidden"
      animate="show"
    >
      <m.div variants={fadeUp}>
        {/* The mark, not a text kicker. The header carries it and the hero
            carries it; the dashboard spelling "SIGNAL" in mono was the odd one
            out and part of why this screen read as a different product. */}
        <span className="inline-flex items-center gap-2 text-[var(--accent)]">
          <span className="grid size-7 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-fg)]">
            <SignalGlyph size={15} />
          </span>
          <span className="text-sm font-semibold tracking-[-0.03em] text-ink-1">Signal</span>
        </span>

        <h1 className="hed hed-grad mt-6 text-[2.6rem]">
          Where you
          <br />
          <span className="serif">stand today.</span>
        </h1>
        {/* The mascot reacts to the state of the board rather than sitting
            there as decoration: pleased once something is being tracked,
            waiting when the board is empty. Beside the line, not above it —
            looming over the headline is what made the product read as a toy. */}
        {withReadings.length > 0 ? (
          <div className="mt-4 flex items-center gap-3">
            <Mascot state="success" size={48} />
            <p className="text-[15px] leading-relaxed text-ink-2">
              <span className="num text-ink-1">{fmt(totalFollowers)}</span> people follow the{' '}
              <span className="num text-ink-1">{withReadings.length}</span>{' '}
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
          <SectionTitle>Your accounts</SectionTitle>
          <div className="space-y-2">
            {withReadings.slice(0, 4).map((h) => {
              const s = statsFor(h.snapshots.at(-1))
              const d = deltaFor(h)
              return (
                <Card key={h.id} tone={h.own ? 'accent' : undefined} className="grain">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="kicker block">{h.platform}</span>
                      <span className="mt-1.5 block truncate text-[15px] font-semibold text-ink-1">
                        {h.displayName ?? h.handle}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-3">
                        {fmt(s.followers)} followers
                        {d.followers != null && d.followers !== 0 && (
                          <span className={d.followers > 0 ? 'text-[var(--pos)]' : 'text-[var(--neg)]'}>
                            {' '}
                            {d.followers > 0 ? '▲' : '▼'} {fmt(Math.abs(d.followers))}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block text-2xl leading-none text-ink-1">
                        {s.engagementRate != null ? s.engagementRate.toFixed(2) : '—'}
                        {s.engagementRate != null && (
                          <span className="text-base text-ink-3">%</span>
                        )}
                      </span>
                      <span className="kicker mt-1.5 block">engagement</span>
                    </span>
                  </div>
                </Card>
              )
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onAccounts}>
              <LayoutGrid size={14} /> Manage accounts
            </Button>
            {withReadings.length > 1 && (
              <Button size="sm" variant="outline" onClick={onCompare}>
                <GitCompareArrows size={14} /> Compare
              </Button>
            )}
          </div>
        </m.section>
      )}

      {/* ── Read a post ─────────────────────────────────────────────────── */}
      <m.section variants={fadeUp}>
        <Card tone="accent" className="grain">
          <p className="text-sm text-ink-1">
            Paste a link to any public post and get what it says, what it means, and what
            people made of it.
          </p>
          <Button className="mt-3" size="sm" onClick={onAnalyse}>
            <Link2 size={14} /> Read a post
          </Button>
          {historyCount > 0 && (
            <p className="mt-2 text-xs text-ink-3">
              {historyCount} post{historyCount === 1 ? '' : 's'} read so far.
            </p>
          )}
        </Card>
      </m.section>

      {/* ── What we can see, per platform ───────────────────────────────── */}
      <m.section variants={fadeUp}>
        <SectionTitle hint="Each platform gates a different thing, and the gates move. Measured, not assumed.">
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
                <span className="flex items-center gap-2 border-t border-[var(--border)] py-2.5">
                  <PlatformDot platform={c.platform} />
                  <span className="text-sm text-ink-1">
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
          <details className="mt-4 border-t border-[var(--border)] pt-3">
            <summary className="cursor-pointer text-xs text-ink-3">
              What each platform actually gives
            </summary>
            <ul className="mt-2 space-y-2">
              {CONNECTORS.map((c) => (
                <li key={c.platform} className="text-xs text-ink-3">
                  <span className="text-ink-2">
                    {c.platform === 'Twitter/X' ? 'X' : c.platform}
                  </span>{' '}
                  — {c.note}
                </li>
              ))}
            </ul>
          </details>
        </Card>
      </m.section>

      {mine.length === 0 && (
        <m.div variants={fadeUp}>
          <Card>
            <p className="text-sm text-ink-1">Track your first account</p>
            <p className="mt-1 text-xs text-ink-3">
              Add a YouTube channel to get posts, engagement and comments. Facebook and
              Instagram will show follower counts.
            </p>
            <Button className="mt-3" size="sm" onClick={onAccounts}>
              <LayoutGrid size={14} /> Add an account
            </Button>
          </Card>
        </m.div>
      )}

      <m.p variants={fadeUp} className="text-center text-xs text-ink-3">
        Public posts only. Everything is stored on this device, never on a server.
      </m.p>
    </m.div>
  )
}
