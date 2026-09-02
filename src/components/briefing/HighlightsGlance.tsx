import { useMemo } from 'react'
import { ArrowRight, MessageSquare, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { Report } from '@shared/types'
import { Button, Card, Chip } from '../ui'
import { DonutBreakdown, PlatformBadge, PostPicture } from '@/components/kit'
import { highlightsOf } from '@/lib/highlights'
import { audienceOf, audienceVerdict } from '@/lib/audience'
import { nextPostModelOf } from '@/lib/next-post'
import type { TrackedHandle } from '@/lib/handles'
import { cn, compact } from '@/lib/utils'

/**
 * The two compact cards that carry the deep screens.
 *
 * Each says the one thing worth knowing at a glance and offers the door to
 * the whole analysis. They are deliberately small: the dashboard is a place
 * to notice something, and the screens behind these are where an office goes
 * to understand it. Nothing here is computed twice — both cards read the same
 * models their full screens read, so a number can never disagree with itself
 * across the two.
 */

const scoreTone = (score: number): 'positive' | 'warning' | 'negative' =>
  score >= 15 ? 'positive' : score <= -15 ? 'negative' : 'warning'

/** The heading and the door, identical whether the card has data or not. */
function GlanceHead({
  title,
  sub,
  onExplore,
}: {
  title: string
  sub: string
  onExplore: () => void
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-[17px] font-bold tracking-[-0.015em]">{title}</h2>
        <p className="mt-0.5 text-xs text-ink-3">{sub}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onExplore}>
        Explore all
        <ArrowRight size={14} aria-hidden />
      </Button>
    </div>
  )
}

/* ── post highlights ─────────────────────────────────────────────────────── */

export function HighlightsGlance({
  handles,
  reports,
  onExplore,
  onOpenReport,
}: {
  handles: TrackedHandle[]
  reports: Map<string, Report> | null
  onExplore: () => void
  onOpenReport: (report: Report) => void
}) {
  const { highlights, unread } = useMemo(
    () => highlightsOf(handles, reports),
    [handles, reports],
  )

  /*
   * An empty card, never an absent one.
   *
   * This used to `return null`, and on any desk that tracks posts but has not
   * had one read in full — which is every desk on the day it is set up — the
   * section rendered at zero height between "Sentiment overview" and "Content
   * insights". A feature that leaves no trace is indistinguishable from a
   * feature that was never built, and it was read here as exactly that. Every
   * neighbouring card on this dashboard degrades to a sentence; so does this
   * one, and it still offers its door, because the screen behind it explains
   * what to do about an unread post.
   */
  if (highlights.length === 0) {
    return (
      <Card className="p-4 sm:p-5">
        <GlanceHead
          title="Post highlights"
          sub={
            reports === null
              ? 'Reading the analyses stored on this device'
              : unread > 0
                ? `None of your ${unread} stored posts has been read in full yet`
                : 'No posts are stored for your accounts yet'
          }
          onExplore={onExplore}
        />
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          {reports === null
            ? 'One moment.'
            : unread > 0
              ? 'A reading is what tells you which post moved people and why. Open one and press Analyse; it is run once and kept forever.'
              : 'Once your accounts have posts on the desk, the ones that drew the strongest reaction appear here.'}
        </p>
      </Card>
    )
  }

  const top = highlights.slice(0, 3)

  return (
    <Card className="p-4 sm:p-5">
      <GlanceHead
        title="Post highlights"
        sub={`The posts that moved people most, of ${highlights.length} read in full${
          unread > 0 ? ` · ${unread} not read yet` : ''
        }`}
        onExplore={onExplore}
      />

      <ul className="mt-3 divide-y divide-[var(--rule)]">
        {top.map((h) => (
          <li key={h.url}>
            <button
              type="button"
              onClick={() => onOpenReport(h.report)}
              title={`Open the stored reading: ${h.title}`}
              className="group flex w-full items-center gap-3 py-2.5 text-left"
            >
              <PostPicture
                url={h.thumbnailUrl}
                platform={h.platform}
                postUrl={h.url}
                className="size-11 shrink-0 rounded-[var(--radius-md)]"
              />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 text-[13px] font-semibold group-hover:text-[var(--accent)]">
                  {h.title}
                </span>
                {/* The mood word leads, not the score out of 100. That score
                    saturates: every well received post reads 95/100, so the
                    most prominent thing on the card was a constant that looked
                    like a broken performance mark. The word varies and says
                    what it means; the number keeps its place on the full
                    screen, where a rationale sits beside it. */}
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <PlatformBadge platform={h.platform} size={15} />
                  <Chip tone={scoreTone(h.score)}>{h.narrative ?? h.label}</Chip>
                  <span className="tnum text-[11px] text-ink-3" title={h.reactionsNote}>
                    {h.measured
                      ? `${compact(h.reactions)} reactions`
                      : h.views != null
                        ? `${compact(h.views)} views`
                        : 'No figures published'}
                  </span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/* ── what people are saying ──────────────────────────────────────────────── */

/**
 * The words that recur on one side of the comments, counted.
 *
 * These are word counts, and the box says so: "praised for X" reads as a
 * finding the office can act on, which a frequency list is not. An empty box
 * says how many comments were searched, because "nothing recurs across four
 * quoted comments" and "nothing recurs across four hundred" are different
 * facts and only one of them is about the public.
 */
function ThemeBox({
  tone,
  icon,
  title,
  terms,
  quoted,
}: {
  tone: 'pos' | 'neg'
  icon: React.ReactNode
  title: string
  terms: { term: string }[]
  quoted: number
}) {
  return (
    <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-2.5">
      <p
        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.05em]"
        style={{ color: `var(--${tone})` }}
      >
        {icon}
        {title}
      </p>
      {terms.length > 0 ? (
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-2">
          {terms.slice(0, 4).map((t) => t.term).join(', ')}
        </p>
      ) : (
        <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
          {quoted === 0
            ? 'None quoted on this side yet.'
            : `No word recurs across the ${quoted} quoted.`}
        </p>
      )}
    </div>
  )
}

export function AudienceGlance({
  handles,
  reports,
  onExplore,
}: {
  handles: TrackedHandle[]
  reports: Map<string, Report> | null
  onExplore: () => void
}) {
  const model = useMemo(() => audienceOf(handles, reports), [handles, reports])

  /* Same reasoning as the card beside it: a sentence, never a disappearance.
     The platform notes are the honest answer to "why is there nothing" —
     comments are gated on some platforms and simply unread on others, and the
     reading itself recorded which. */
  if (model.commentsRead === 0) {
    const notes = model.platforms.map((p) => p.note).filter((n): n is string => Boolean(n))
    return (
      <Card className="p-4 sm:p-5">
        <GlanceHead
          title="What people are saying about you"
          sub="Comments read under your own posts"
          onExplore={onExplore}
        />
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          {model.platforms.length === 0
            ? 'No account is marked as yours yet, so there is nothing to read comments under.'
            : 'No comments have been read on your accounts yet.'}
        </p>
        {notes.length > 0 && (
          <ul className="mt-2 space-y-1">
            {[...new Set(notes)].slice(0, 4).map((n) => (
              <li key={n} className="text-[11px] leading-relaxed text-ink-3">
                {n}
              </li>
            ))}
          </ul>
        )}
      </Card>
    )
  }

  const positiveQuotes = model.quotes.filter((q) => q.side === 'positive').length
  const negativeQuotes = model.quotes.filter((q) => q.side === 'negative').length

  const segments = [
    { label: 'Positive', value: model.positive, color: 'var(--chart-pos)' },
    { label: 'Neutral', value: model.neutral, color: 'var(--chart-mid)' },
    { label: 'Negative', value: model.negative, color: 'var(--chart-neg)' },
  ]
  /* The centre names the segment the ring is mostly made of. It used to read
     the positive share whatever the shape, so a mostly grey donut carried
     "17% positive" in the middle and appeared to contradict itself. */
  const largest = segments.reduce((a, b) => (b.value > a.value ? b : a))

  return (
    <Card className="p-4 sm:p-5">
      <GlanceHead
        title="What people are saying about you"
        sub={`${model.commentsRead.toLocaleString('en-IN')} comments read under ${model.postsRead} of your ${model.postsStored} stored posts`}
        onExplore={onExplore}
      />

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
        <DonutBreakdown
          size={116}
          thickness={15}
          segments={segments}
          centerLabel={`${largest.value}%`}
          centerSub={largest.label.toLowerCase()}
          className="shrink-0 self-center"
        />

        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-snug">{audienceVerdict(model)}</p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {segments.map((s) => (
              <li key={s.label} className="flex items-center gap-1.5 text-xs">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="tnum font-bold">{s.value}%</span>
                <span className="text-ink-2">{s.label}</span>
              </li>
            ))}
          </ul>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <ThemeBox
              tone="pos"
              icon={<ThumbsUp size={10} aria-hidden />}
              title="Words in the praise"
              terms={model.praise}
              quoted={positiveQuotes}
            />
            <ThemeBox
              tone="neg"
              icon={<ThumbsDown size={10} aria-hidden />}
              title="Words in the criticism"
              terms={model.complaints}
              quoted={negativeQuotes}
            />
          </div>
        </div>
      </div>

      {/* Which accounts this rests on, so a warm verdict from one platform is
          never mistaken for the whole audience. */}
      <ul className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--rule)] pt-2.5">
        {model.platforms.map((p) => (
          <li key={`${p.platform}-${p.handle}`}>
            <span
              className={cn(
                'inline-flex min-h-7 items-center gap-1.5 rounded-[var(--radius-pill)] border px-2 text-[11px]',
                p.commentsRead > 0
                  ? 'border-[var(--border)] bg-[var(--surface-2)] text-ink-2'
                  : 'border-dashed border-[var(--border)] text-ink-3',
              )}
              title={p.note ?? `${p.commentsRead} comments read`}
            >
              <PlatformBadge platform={p.platform} size={14} />
              {p.commentsRead > 0 ? (
                <>
                  <MessageSquare size={10} aria-hidden />
                  <span className="tnum">{p.commentsRead}</span>
                </>
              ) : (
                'not read'
              )}
            </span>
          </li>
        ))}
        {model.postsAnalysed > 0 && (
          <li>
            <span className="inline-flex min-h-7 items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--accent-soft)] px-2 text-[11px] text-[var(--accent)]">
              <Sparkles size={10} aria-hidden />
              {model.postsAnalysed} posts read in full
            </span>
          </li>
        )}
      </ul>
    </Card>
  )
}

/* ── what to post next ───────────────────────────────────────────────────── */

/**
 * The door to the recommendations screen: the deterministic sentence and the
 * top themes, nothing else. The sentence is the model's own, computed from
 * the same findings the advice cards read, so this card, the advice cards and
 * the full screen can only ever name the same themes. Nothing here quotes the
 * AI-drafted plan: that is per-day cached model text, and a dashboard card
 * quoting it would go stale against the screen's own regeneration.
 */
export function NextPostGlance({
  handles,
  reports,
  onExplore,
}: {
  handles: TrackedHandle[]
  reports: Map<string, Report> | null
  onExplore: () => void
}) {
  const model = useMemo(() => nextPostModelOf(handles, reports, 'all'), [handles, reports])

  if (model.empty) {
    return (
      <Card className="p-4">
        <GlanceHead
          title="What should you post next?"
          sub="Written from your readings, once there are some."
          onExplore={onExplore}
        />
      </Card>
    )
  }

  const top = model.themes.slice(0, 3)
  const most = top[0]?.posts ?? 1

  return (
    <Card className="@container p-4">
      <GlanceHead
        title="What should you post next?"
        sub={`Over ${model.postsAnalysed} posts read in full and ${compact(model.commentsRead)} comments counted.`}
        onExplore={onExplore}
      />
      <div className="mt-3 grid gap-3 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] @2xl:items-center">
        <p className="rounded-[var(--radius-md)] bg-[var(--accent-soft)] p-3 text-[12.5px] font-semibold leading-snug text-ink">
          {model.recommendation}
        </p>
        {top.length > 0 && (
          <ul className="space-y-1.5">
            {top.map((t) => (
              <li key={t.topic} className="flex items-center gap-2 text-[11.5px]">
                <span className="w-[38%] min-w-0 truncate text-ink-2">{t.topic}</span>
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <span
                    className="block h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${Math.max(8, Math.round((t.posts / most) * 100))}%` }}
                  />
                </span>
                <span className="tnum shrink-0 text-[10.5px] text-ink-3">
                  {t.posts} {t.posts === 1 ? 'post' : 'posts'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
