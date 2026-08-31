import { useMemo } from 'react'
import { MessageSquare, UserRound } from 'lucide-react'
import { Button, Card, Chip, Empty } from '../ui'
import { DonutBreakdown } from '@/components/kit'
import { recurringTerms } from '@/lib/terms'
import { readStandingCache, type Standing, type TrackedHandle } from '@/lib/handles'
import type { OpinionSurvey } from '@/lib/opinion'

/**
 * What the people think of the member, aggregated across the desk's own
 * accounts — and labelled by where each reading actually came from, because
 * the two sources are not the same claim:
 *
 *   comments — real people's words under this office's own posts
 *   record   — published coverage about the person
 *
 * A record reading is not a sample of constituents and is never drawn as one:
 * it gets no positive/neutral/negative bar (nothing was counted) and carries
 * its own source line. The two kinds are never averaged together.
 *
 * The theme chips underneath are the "what comes up in the comments" the
 * owner asked for — people, party, incidents and topics — and they come only
 * from comment readings, because that is the only place a constituent said
 * anything.
 */

/** Platforms that publish nothing about an account to an unauthenticated reader. */
const GATED = new Set(['Facebook', 'Instagram', 'Twitter/X', 'LinkedIn'])

interface AccountReading {
  handle: string
  platform: TrackedHandle['platform']
  standing: Standing
}

interface Aggregate {
  comments: AccountReading[]
  record: AccountReading[]
  /** Weighted by comments read, so 400 comments outvote 9. */
  positive: number
  neutral: number
  negative: number
  score: number | null
  commentsRead: number
  postsRead: number
  praise: string[]
  criticism: string[]
  gated: TrackedHandle[]
  unmeasured: TrackedHandle[]
}

function aggregateOf(handles: TrackedHandle[]): Aggregate {
  const comments: AccountReading[] = []
  const record: AccountReading[] = []
  const gated: TrackedHandle[] = []
  const unmeasured: TrackedHandle[] = []

  for (const h of handles) {
    const standing = readStandingCache(h.id)
    if (standing) {
      const reading = { handle: h.displayName ?? h.handle, platform: h.platform, standing }
      // Absent means comments: every reading cached before the field existed
      // came from the comment path.
      if (standing.source === 'record') record.push(reading)
      else comments.push(reading)
    } else if (GATED.has(h.platform)) {
      gated.push(h)
    } else {
      unmeasured.push(h)
    }
  }

  const weight = comments.reduce((s, m) => s + Math.max(m.standing.commentsRead, 1), 0)
  const weighted = (pick: (s: Standing) => number): number =>
    comments.length === 0
      ? 0
      : comments.reduce((s, m) => s + pick(m.standing) * Math.max(m.standing.commentsRead, 1), 0) /
        weight

  /**
   * As PERCENTAGES of the comments counted, not as raw weighted counts. The
   * standing stores counts (positive + neutral + negative = comments read),
   * and rendering the weighted means with a % sign put "41% · 16% · 3%" on
   * screen — sixty percent of an audience unaccounted for.
   */
  const rawPos = weighted((s) => s.positive)
  const rawNeu = weighted((s) => s.neutral)
  const rawNeg = weighted((s) => s.negative)
  const total = rawPos + rawNeu + rawNeg

  const scored = comments.filter((m) => m.standing.score !== null)
  const scoreWeight = scored.reduce((s, m) => s + Math.max(m.standing.commentsRead, 1), 0)

  return {
    comments: comments.sort((a, b) => b.standing.commentsRead - a.standing.commentsRead),
    record,
    positive: total > 0 ? Math.round((rawPos / total) * 100) : 0,
    neutral: total > 0 ? Math.round((rawNeu / total) * 100) : 0,
    negative: total > 0 ? Math.round((rawNeg / total) * 100) : 0,
    score:
      scored.length === 0
        ? null
        : scored.reduce(
            (s, m) => s + (m.standing.score ?? 0) * Math.max(m.standing.commentsRead, 1),
            0,
          ) / scoreWeight,
    commentsRead: comments.reduce((s, m) => s + m.standing.commentsRead, 0),
    postsRead: comments.reduce((s, m) => s + m.standing.postsRead, 0),
    // Deduplicated: the same complaint under a YouTube video and a Facebook
    // post is one grievance, not two.
    praise: [...new Set(comments.flatMap((m) => m.standing.praise))].slice(0, 6),
    criticism: [...new Set(comments.flatMap((m) => m.standing.criticism))].slice(0, 6),
    gated,
    unmeasured,
  }
}

export function SentimentGlance({
  handles,
  opinion,
  onOpenAccounts,
}: {
  /** The desk's OWN handles only. Watched accounts have no business here. */
  handles: TrackedHandle[]
  /** The grounded coverage survey, surfaced as the coverage reading. */
  opinion: OpinionSurvey | null
  onOpenAccounts: () => void
}) {
  const agg = useMemo(() => aggregateOf(handles), [handles])

  /* The "why" chips the owner's reference dashboard carries under the donut:
     the words that actually recur across the praising and the critical
     comments, counted by the same tokenizer the compare screen uses. A side
     where nothing recurs shows nothing — the quotes themselves live in the
     platform cards below. Computed here, above the empty-state return, so the
     hook order never depends on the data. */
  const praiseTerms = useMemo(
    () => recurringTerms(agg.comments.flatMap((m) => m.standing.praise), 5) ?? [],
    [agg],
  )
  const criticismTerms = useMemo(
    () => recurringTerms(agg.comments.flatMap((m) => m.standing.criticism), 5) ?? [],
    [agg],
  )

  // A survey with no verdict has read nothing worth repeating; treating it as
  // a coverage reading would render an empty block under an honest heading.
  const coverage = opinion && opinion.verdict ? opinion : null

  const nothing =
    agg.comments.length === 0 && agg.record.length === 0 && !coverage
  if (nothing) {
    return (
      <Empty
        icon={<UserRound size={18} aria-hidden />}
        title="No reading of the public exists yet"
        body={
          handles.length === 0
            ? 'No account is marked as yours.'
            : agg.gated.length > 0 && agg.unmeasured.length === 0
              ? `Comments unavailable on ${[...new Set(agg.gated.map((h) => h.platform))].join(' and ')}.`
              : 'No comments read yet.'
        }
        action={
          <Button size="sm" onClick={onOpenAccounts}>
            <UserRound size={15} />
            Open your accounts
          </Button>
        }
      />
    )
  }

  const score = agg.score ?? 0
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
    { label: 'Positive', n: agg.positive, colour: 'var(--chart-pos)' },
    { label: 'Neutral', n: agg.neutral, colour: 'var(--chart-mid)' },
    { label: 'Negative', n: agg.negative, colour: 'var(--chart-neg)' },
  ]

  return (
    <Card>
      {/* ── the comment reading, when one exists ─────────────────────────── */}
      {agg.comments.length > 0 ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-lg font-bold leading-snug tracking-[-0.015em]">{verdict}</p>
            <p className="tnum text-sm text-ink-3">
              {agg.commentsRead.toLocaleString('en-IN')} comments · {agg.postsRead} posts
            </p>
          </div>

          {/* Donut and bar carry the same three numbers on purpose: the donut
              is the glance, the bar with its labelled percentages is the
              reading, and neither asks the eye to decode colour alone. */}
          <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
            <DonutBreakdown
              size={132}
              thickness={18}
              segments={segments.map((seg) => ({ label: seg.label, value: seg.n, color: seg.colour }))}
              centerLabel={`${agg.positive}%`}
              centerSub="positive"
              className="shrink-0"
            />
            <div className="w-full min-w-0 flex-1">
              <div
                className="flex h-3 w-full gap-[3px]"
                role="img"
                aria-label={`${agg.positive}% positive, ${agg.neutral}% neutral, ${agg.negative}% negative`}
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

              {(praiseTerms.length > 0 || criticismTerms.length > 0) && (
                <div className="mt-3.5 space-y-2 border-t border-[var(--rule)] pt-3">
                  {praiseTerms.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--pos)]">
                        Praised for
                      </span>
                      {praiseTerms.map((t) => (
                        <Chip key={t} tone="positive">{t}</Chip>
                      ))}
                    </div>
                  )}
                  {criticismTerms.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--neg)]">
                        Criticised over
                      </span>
                      {criticismTerms.map((t) => (
                        <Chip key={t} tone="negative">{t}</Chip>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Named sources — a reading from the wrong account is otherwise
              indistinguishable from a reading from the right one. */}
          <ul className="mt-3.5 flex flex-wrap gap-1.5">
            {agg.comments.map((a) => (
              <li key={`${a.platform}-${a.handle}`} className="min-w-0 max-w-full">
                <Chip className="max-w-full" icon={<MessageSquare size={11} aria-hidden />}>
                  <span className="min-w-0 truncate">
                    {a.platform} · {a.handle} · {a.standing.commentsRead} comments
                  </span>
                </Chip>
              </li>
            ))}
          </ul>

          {agg.commentsRead < 30 && (
            <p className="mt-3">
              <Chip tone="warning">Small sample</Chip>
            </p>
          )}
        </>
      ) : (
        <p className="text-sm leading-relaxed text-ink-2">No comments read yet.</p>
      )}

      {/* The theme chips and the published-record block that closed this card
          are gone as duplicates: this card now OPENS the "what people are
          saying" section, and the platform cards directly beneath it carry the
          same complaints, credits and record reading in full. This card's one
          job is the overall verdict. */}

      {/* Own accounts that could be read and have not been. */}
      {agg.unmeasured.length > 0 && (
        <button
          onClick={onOpenAccounts}
          className="mt-3 inline-flex min-h-11 items-center text-left text-xs font-medium text-ink-3 underline decoration-[var(--rule)] underline-offset-4 hover:text-ink-2"
        >
          {agg.unmeasured.length} of your accounts {agg.unmeasured.length === 1 ? 'has' : 'have'} not been read yet
        </button>
      )}
    </Card>
  )
}
