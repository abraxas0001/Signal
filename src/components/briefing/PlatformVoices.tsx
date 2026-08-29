import { useMemo, useState } from 'react'
import { MessageSquare, Newspaper, Plus, ScanEye, UserRound, X } from 'lucide-react'
import type { Influencer, InfluencerMention } from '@shared/grievance'
import { Button, Card, Chip, Empty } from '../ui'
import { CardHead, PlatformBadge } from '@/components/kit'
import {
  readStandingCache,
  readStandingNote,
  type Standing,
  type TrackedHandle,
} from '@/lib/handles'
import type { Perception } from '@/lib/briefing'

/**
 * What people are saying about you, platform by platform: one card per
 * platform the office actually posts on, each carrying its standing reading
 * (labelled by source, because a record reading is not a sample of
 * constituents), the complaints and credits from that reading, and how many
 * posts the watched local accounts on that platform have produced.
 *
 * A platform with no reading gets one honest line, not a blank half-card and
 * not a number nobody measured.
 */

/** Platforms that publish nothing about an account to an unauthenticated reader. */
const GATED = new Set(['Facebook', 'Instagram', 'Twitter/X', 'LinkedIn'])

/** The order the platform cards render in, the familiar roll-call first. */
const PLATFORM_ORDER = ['Facebook', 'Instagram', 'Twitter/X', 'YouTube', 'LinkedIn']

interface PlatformVoice {
  platform: TrackedHandle['platform']
  handles: string[]
  /** The reading shown. Comment-sourced wins over record when both exist. */
  standing: Standing | null
  praise: string[]
  criticism: string[]
  /** Posts from watched local accounts on this platform. Null = none watched. */
  mentionCount: number | null
  /**
   * Replies counted on this desk's own stored posts here.
   *
   * The card used to explain a missing reading with "this platform publishes
   * nothing to a stranger", which is true of a SERVER and was being printed
   * over accounts whose comments had in fact been read. On D. K. Aruna's X
   * account the real reason is smaller and more useful: 25 stored posts drew
   * 21 replies between them, and a mood cannot be called from 21. The desk
   * already holds that number on every post, so it can say the true thing.
   */
  repliesOnOwnPosts: number
  /** Own posts here whose comment count we actually have a figure for. */
  postsCounted: number
  /** What the reader said when it declined to score this account. */
  note: string | null
}

function voicesOf(
  handles: TrackedHandle[],
  influencers: Influencer[],
  mentions: InfluencerMention[],
): PlatformVoice[] {
  const platforms = [...new Set(handles.map((h) => h.platform))].sort((a, b) => {
    const ia = PLATFORM_ORDER.indexOf(a)
    const ib = PLATFORM_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b)
  })

  return platforms.map((platform) => {
    const here = handles.filter((h) => h.platform === platform)
    const standings = here
      .map((h) => readStandingCache(h.id))
      .filter((s): s is Standing => s !== null)
    const note = here.map((h) => readStandingNote(h.id)).find((n): n is string => n !== null) ?? null

    // Comments outrank the record: people's own words beat coverage about
    // them. Within a source, the reading resting on the most comments wins.
    const comment = standings
      .filter((s) => s.source !== 'record')
      .sort((a, b) => b.commentsRead - a.commentsRead)[0]
    const record = standings.find((s) => s.source === 'record')
    const standing = comment ?? record ?? null

    const watched = new Set(
      influencers.filter((i) => i.platform === platform).map((i) => i.id),
    )
    const mentionCount =
      watched.size === 0 ? null : mentions.filter((m) => watched.has(m.influencerId)).length

    // Counted off the latest reading of each account on this platform. A post
    // whose comment count is null is a post we never got a figure for, so it
    // is left out of both totals rather than counted as a zero: "none of your
    // posts drew a comment" and "we could not read the comment counts" are
    // different sentences and only one of them is true.
    let postsCounted = 0
    const repliesOnOwnPosts = here.reduce((total, h) => {
      const latest = h.snapshots[h.snapshots.length - 1]
      return (
        total +
        (latest?.posts ?? []).reduce((n, post) => {
          if (typeof post.comments !== 'number') return n
          postsCounted += 1
          return n + post.comments
        }, 0)
      )
    }, 0)

    return {
      platform,
      handles: here.map((h) => h.displayName ?? h.handle),
      standing,
      repliesOnOwnPosts,
      postsCounted,
      note,
      praise: [...new Set(standings.flatMap((s) => s.praise))].slice(0, 4),
      criticism: [...new Set(standings.flatMap((s) => s.criticism))].slice(0, 4),
      mentionCount,
    }
  })
}

/**
 * One quote, cut short on purpose: a single faded line that reads as a
 * teaser, because the card is a summary and the whole comment lives one tap
 * away. The fade does the truncating visually — the ellipsis alone read as
 * the text being broken rather than being previewed.
 */
function QuoteChip({
  tone,
  text,
  onOpen,
}: {
  tone: 'negative' | 'positive'
  text: string
  onOpen: () => void
}) {
  return (
    <button type="button" onClick={onOpen} className="block max-w-full text-left" title="Read in full">
      <Chip tone={tone} className="max-w-full">
        <span
          className="block max-w-[240px] overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_78%,transparent)]"
        >
          {text}
        </span>
      </Chip>
    </button>
  )
}

export function PlatformVoices({
  handles,
  influencers,
  mentions,
  closing,
}: {
  /** The desk's OWN handles only. */
  handles: TrackedHandle[]
  influencers: Influencer[]
  mentions: InfluencerMention[]
  /** The "in the published record" card that closes the section. */
  closing?: React.ReactNode
}) {
  const voices = useMemo(
    () => voicesOf(handles, influencers, mentions),
    [handles, influencers, mentions],
  )
  /** Which platform's full reading is open, if any. */
  const [detail, setDetail] = useState<string | null>(null)

  if (voices.length === 0) {
    return (
      <Empty
        icon={<UserRound size={18} aria-hidden />}
        title="No account of yours is being read"
        body="Mark your handles as yours on the Accounts screen."
      />
    )
  }

  return (
    <div className="stack-tight">
      <div className="grid gap-3 lg:grid-cols-2">
        {voices.map((v) => (
          <Card key={v.platform} className="h-full">
            <CardHead
              icon={<PlatformBadge platform={v.platform} size={22} />}
              tint="blue"
              title={v.platform}
              sub={v.handles.join(' · ')}
              action={
                // The named way into the full reading. The quote chips open
                // it too, but a teaser that fades out must sit next to a
                // control that SAYS the rest exists, or nobody learns to tap.
                v.standing && v.standing.source !== 'record' ? (
                  <button
                    type="button"
                    onClick={() => setDetail(detail === v.platform ? null : v.platform)}
                    aria-expanded={detail === v.platform}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)]"
                  >
                    <ScanEye size={14} aria-hidden />
                    {detail === v.platform ? 'Close' : 'Full reading'}
                  </button>
                ) : undefined
              }
            />

            {v.standing ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[15px] font-bold leading-snug">{v.standing.label}</p>
                  {v.standing.score !== null && (
                    <Chip tone={v.standing.score >= 0 ? 'positive' : 'negative'} className="tnum">
                      {v.standing.score > 0 ? '+' : ''}
                      {v.standing.score}
                    </Chip>
                  )}
                </div>
                {v.standing.source === 'record' ? (
                  <p className="mt-1.5">
                    <Chip icon={<Newspaper size={11} aria-hidden />}>Record reading</Chip>
                  </p>
                ) : (
                  <p className="tnum mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                    <MessageSquare size={12} className="shrink-0" aria-hidden />
                    {/* Says whose comments these are. A reading that folds in
                        the public's reaction under news coverage about the
                        member must not present that count as her own
                        audience. */}
                    {(v.standing.coverageComments ?? 0) > 0 ? (
                      <>
                        {(v.standing.commentsRead - (v.standing.coverageComments ?? 0)).toLocaleString('en-IN')}{' '}
                        on your posts · {(v.standing.coverageComments ?? 0).toLocaleString('en-IN')} under
                        news about you
                      </>
                    ) : (
                      <>
                        {v.standing.commentsRead.toLocaleString('en-IN')} comments ·{' '}
                        {v.standing.postsRead} posts
                      </>
                    )}
                    {/* A score from a handful of comments is a real reading
                        of a thin base, and the flag is what keeps it honest
                        at a glance. Same threshold as the aggregate card. */}
                    {v.standing.commentsRead < 30 && <Chip tone="warning">Small sample</Chip>}
                  </p>
                )}

                {(v.criticism.length > 0 || v.praise.length > 0) && (
                  <div className="mt-3.5 space-y-2.5 border-t border-[var(--rule)] pt-3">
                    {v.criticism.length > 0 && (
                      <div>
                        <p className="kicker text-[var(--neg)]">Complaints</p>
                        <ul className="mt-1.5 flex flex-wrap gap-1.5">
                          {v.criticism.map((theme) => (
                            <li key={theme} className="min-w-0 max-w-full">
                              <QuoteChip
                                tone="negative"
                                text={theme}
                                onOpen={() => setDetail(detail === v.platform ? null : v.platform)}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {v.praise.length > 0 && (
                      <div>
                        <p className="kicker text-[var(--pos)]">Credits</p>
                        <ul className="mt-1.5 flex flex-wrap gap-1.5">
                          {v.praise.map((theme) => (
                            <li key={theme} className="min-w-0 max-w-full">
                              <QuoteChip
                                tone="positive"
                                text={theme}
                                onOpen={() => setDetail(detail === v.platform ? null : v.platform)}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* ── the full reading, on tap ─────────────────────────────
                    Every quote above is a teaser; this is where it reads in
                    full — the whole comment, the balance behind the score,
                    and the model's two-sentence summary of the audience. */}
                {detail === v.platform && (
                  <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--rule)] bg-[var(--surface-2)] p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold">The full reading</p>
                      <button
                        type="button"
                        onClick={() => setDetail(null)}
                        aria-label="Close the full reading"
                        className="-my-1 grid size-9 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-3)]"
                      >
                        <X size={15} aria-hidden />
                      </button>
                    </div>

                    {v.standing.summary && (
                      <p className="mt-1 text-sm leading-relaxed text-ink-2">{v.standing.summary}</p>
                    )}

                    {(() => {
                      // Older readings stored the balance as percentages of
                      // 100, newer ones as raw counts. "87 positive" over 23
                      // comments is the giveaway; render the unit that is
                      // actually true.
                      const sum = v.standing.positive + v.standing.neutral + v.standing.negative
                      const pct = sum > v.standing.commentsRead
                      const unit = pct ? '%' : ''
                      return (
                        <p className="tnum mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
                          <span>
                            <span className="font-semibold text-[var(--pos)]">
                              {v.standing.positive}
                              {unit}
                            </span>{' '}
                            positive
                          </span>
                          <span>
                            <span className="font-semibold text-ink-2">
                              {v.standing.neutral}
                              {unit}
                            </span>{' '}
                            neutral
                          </span>
                          <span>
                            <span className="font-semibold text-[var(--neg)]">
                              {v.standing.negative}
                              {unit}
                            </span>{' '}
                            negative
                          </span>
                        </p>
                      )
                    })()}

                    {v.standing.criticism.length > 0 && (
                      <ul className="mt-3 space-y-2">
                        {v.standing.criticism.map((q) => (
                          <li
                            key={q}
                            className="border-l-2 border-[var(--neg)] pl-3 text-sm leading-relaxed text-ink-2"
                          >
                            {q}
                          </li>
                        ))}
                      </ul>
                    )}
                    {v.standing.praise.length > 0 && (
                      <ul className="mt-3 space-y-2">
                        {v.standing.praise.map((q) => (
                          <li
                            key={q}
                            className="border-l-2 border-[var(--pos)] pl-3 text-sm leading-relaxed text-ink-2"
                          >
                            {q}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm leading-relaxed text-ink-2">
                {v.repliesOnOwnPosts > 0
                  ? `Your posts here drew ${v.repliesOnOwnPosts} ${v.repliesOnOwnPosts === 1 ? 'reply' : 'replies'}, too few to read a mood from.`
                  : v.postsCounted > 0
                    ? // We read them. They are simply empty, which is a finding
                      // about the account, not a failure of the reader.
                      `Nobody has commented on your ${v.postsCounted === 1 ? 'post' : `${v.postsCounted} posts`} here.`
                    : // The reader's own words about why it declined. Beats
                      // both guesses below, because it was actually there.
                      (v.note ??
                      (GATED.has(v.platform)
                        ? `Comments unavailable on ${v.platform}.`
                        : 'No comment reading exists for this account yet.'))}
              </p>
            )}

            {v.mentionCount !== null && (
              <p className="mt-3.5 border-t border-[var(--rule)] pt-3 text-xs leading-relaxed text-ink-3">
                {/* Says whose posts these are. "No posts from the watched
                    accounts yet" sat directly under a line about how many
                    replies her own posts drew, and the two read as a
                    contradiction rather than as two different counts. */}
                {v.mentionCount === 0
                  ? 'No posts about you from the influencers you watch here.'
                  : `${v.mentionCount} ${v.mentionCount === 1 ? 'post' : 'posts'} about you from the influencers you watch here.`}
              </p>
            )}
          </Card>
        ))}
      </div>

      {closing}
    </div>
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
export function PerceptionPanel({
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
        body="Add your accounts to begin."
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
      <p className="mt-2">
        <Chip icon={<Newspaper size={11} aria-hidden />}>Press coverage</Chip>
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
            questionable.
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
        <p className="mt-2">
          <Chip tone="warning">Small sample</Chip>
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
