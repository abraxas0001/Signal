import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Download,
  FileText,
  Lightbulb,
  LoaderCircle,
  MessageSquare,
  Newspaper,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Wand2,
} from 'lucide-react'
import { Button, Card, Chip, Empty, Shell } from './ui'
import { DonutBreakdown, PlatformBadge, seriesColor } from '@/components/kit'
import { listHandles } from '@/lib/handles'
import { loadPostReports } from '@/lib/post-reports'
import { isDemoScope, readStore, useStore } from '@/lib/store'
import { issuesFor, platformReachOf, ownPostsOf } from '@/lib/briefing'
import {
  nextPostModelOf,
  openingsOf,
  type NextPostModel,
  type Opening,
  type ThemeRow,
} from '@/lib/next-post'
import {
  loadPostPlan,
  planReady,
  readPlanCache,
  type PlanInput,
  type PlanResult,
} from '@/lib/post-plan'
import {
  fetchSuggestions,
  readSuggestions,
  saveSuggestions,
  type SuggestedPost,
} from '@/lib/suggest'
import { buildWorkbook, saveBlob } from '@/lib/xlsx'
import { WINDOWS, type WindowId } from '@/lib/window'
import type { Report } from '@shared/types'
import { cn, compact } from '@/lib/utils'
import { fadeUp, listStagger } from '@/lib/motion'

/**
 * "What should you post next", built to the owner's reference and then made to
 * tell the truth.
 *
 * The reference page carries five stat tiles, three numbered tabs, and a
 * three-column body: reasons on the left, a post-type table in the middle,
 * data points and sample comments on the right. That shape is kept. What
 * changed is what fills it, and the rules are written on the model
 * (src/lib/next-post.ts): nothing here forecasts, nothing crosses platforms,
 * every figure carries its denominator, and below the floors the count itself
 * is the content. The three tabs map onto three pipelines this product
 * already runs: the stored readings (why), the news and grievance desks
 * (openings), and the plan-and-studio pair (ideas), which is what turns a
 * recommendation into a poster without leaving the product.
 */

type TabId = 'why' | 'openings' | 'ideas'

const TABS: { id: TabId; n: number; label: string }[] = [
  { id: 'why', n: 1, label: 'What your readings back' },
  { id: 'openings', n: 2, label: 'Openings to answer' },
  { id: 'ideas', n: 3, label: 'Ready to run ideas' },
]

export function NextPost({
  onClose,
  onMakePost,
}: {
  onClose: () => void
  /** Hands a drafted idea to the content studio as its opening brief. */
  onMakePost: (brief: string) => void
}) {
  const store = useStore()
  const reduce = useReducedMotion()
  const [tab, setTab] = useState<TabId>('why')
  const [windowId, setWindowId] = useState<WindowId>('all')
  const [reports, setReports] = useState<Map<string, Report> | null>(null)

  useEffect(() => {
    let alive = true
    void loadPostReports().then((r) => alive && setReports(r))
    return () => {
      alive = false
    }
  }, [])

  const handles = useMemo(() => listHandles(), [])
  const model = useMemo(
    () => nextPostModelOf(handles, reports, windowId),
    [handles, reports, windowId],
  )

  const exportReport = useCallback(() => void exportModel(model), [model])

  return (
    <Shell className="stack">
      <m.div variants={listStagger} initial={reduce ? false : 'hidden'} animate="show">
        {/* ── the head ─────────────────────────────────────────────────── */}
        <m.div
          variants={fadeUp}
          className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="min-w-0">
            <h1 className="text-[clamp(1.35rem,1.1rem+0.9vw,1.6rem)] font-bold tracking-[-0.022em]">
              What should you post next?
            </h1>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
              Read from your own posts and comments. Nothing here is a forecast.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="nextpost-window">
              Time window
            </label>
            <select
              id="nextpost-window"
              value={windowId}
              onChange={(e) => setWindowId(e.target.value as WindowId)}
              className="select rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-[12.5px] text-ink"
            >
              {WINDOWS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={exportReport} disabled={model.empty}>
              <Download size={15} aria-hidden />
              Export report
            </Button>
            <Button variant="ghost" onClick={onClose}>
              <ArrowLeft size={15} aria-hidden />
              Back
            </Button>
          </div>
        </m.div>

        {model.empty ? (
          <m.div variants={fadeUp} className="mt-4">
            <Empty
              icon={<Lightbulb size={18} aria-hidden />}
              title="Nothing read yet"
              body="This screen is written from your own posts and comments. Connect your accounts and let a reading run, and it will have something to say."
            />
          </m.div>
        ) : (
          <>
            {/* ── the five tiles ─────────────────────────────────────── */}
            <m.div variants={fadeUp} className="@container mt-3">
              <div className="grid gap-2.5 @lg:grid-cols-2 @3xl:grid-cols-5">
                <Tile
                  icon={<MessageSquare size={15} aria-hidden />}
                  label="How comments run"
                  value={`${model.audience.positive}% positive`}
                  note={`of ${compact(model.commentsRead)} comments read on your accounts`}
                />
                <Tile
                  icon={<TrendingUp size={15} aria-hidden />}
                  label="Carrying furthest"
                  value={bestBucket(model) ?? 'Nothing yet'}
                  note={bestBucketNote(model)}
                />
                <Tile
                  icon={<Sparkles size={15} aria-hidden />}
                  label="Themes in your posts"
                  value={String(model.themes.length)}
                  note={`with two or more of the ${model.postsAnalysed} posts read in full`}
                />
                <Tile
                  icon={<CalendarClock size={15} aria-hidden />}
                  label="Measured here"
                  value={`${model.measuredInWindow} of ${model.postsInWindow}`}
                  note={`posts, ${model.platforms} platforms, ${model.windowLabel}`}
                />
                <Card className="border-[var(--accent)]/40 bg-[var(--accent-soft)] p-3 @3xl:col-span-1 @lg:col-span-2">
                  <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--accent)]">
                    <Wand2 size={13} aria-hidden />
                    Recommendation
                  </p>
                  <p className="mt-1.5 text-[12.5px] font-semibold leading-snug">
                    {model.recommendation}
                  </p>
                </Card>
              </div>
            </m.div>

            {/* ── the tabs ───────────────────────────────────────────── */}
            <m.div variants={fadeUp} className="mt-3 flex flex-wrap gap-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-pressed={tab === t.id}
                  className={cn(
                    'flex min-h-10 items-center gap-2 rounded-[var(--radius-pill)] border px-3.5 text-[12.5px] font-semibold transition-colors',
                    tab === t.id
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'border-[var(--border)] text-ink-2 hover:border-[var(--border-interactive)]',
                  )}
                >
                  <span
                    className={cn(
                      'tnum grid size-5 place-items-center rounded-full text-[10px] font-bold',
                      tab === t.id
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--surface-3)] text-ink-3',
                    )}
                  >
                    {t.n}
                  </span>
                  {t.label}
                </button>
              ))}
            </m.div>

            <m.div variants={fadeUp} className="mt-3">
              {tab === 'why' && <WhyTab model={model} />}
              {tab === 'openings' && <OpeningsTab />}
              {tab === 'ideas' && <IdeasTab model={model} onMakePost={onMakePost} />}
            </m.div>
          </>
        )}
      </m.div>
    </Shell>
  )
}

/* ── tile ─────────────────────────────────────────────────────────────────── */

function Tile({
  icon,
  label,
  value,
  note,
}: {
  icon: ReactNode
  label: string
  value: string
  note: string
}) {
  return (
    <Card className="p-3">
      <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">
        {icon}
        {label}
      </p>
      <p className="mt-1.5 truncate text-[17px] font-bold leading-tight" title={value}>
        {value}
      </p>
      <p className="mt-1 text-[10.5px] leading-relaxed text-ink-3">{note}</p>
    </Card>
  )
}

const bestBucket = (model: NextPostModel): string | null => {
  const f = model.lands.working.find((x) => x.kind !== 'topic')
  return f ? `${f.label} ${(Math.round(f.value * 10) / 10).toFixed(1)}x` : null
}

const bestBucketNote = (model: NextPostModel): string => {
  const f = model.lands.working.find((x) => x.kind !== 'topic')
  if (!f) {
    return model.lands.thin
      ? `only ${model.measuredInWindow} measured posts, too few to compare`
      : 'no format or platform sits above your typical post here'
  }
  return f.evidence
}

/* ── tab one: what the readings back ─────────────────────────────────────── */

function WhyTab({ model }: { model: NextPostModel }) {
  return (
    <div className="@container">
      <div className="grid gap-3 @4xl:grid-cols-[260px_minmax(0,1fr)_290px]">
        {/* left: why, and what the posts are about */}
        <div className="space-y-3">
          <Panel title="Why these recommendations?" icon={<BadgeCheck size={14} aria-hidden />}>
            <ul className="space-y-2.5 text-[11.5px] leading-relaxed text-ink-2">
              <Fact
                head={`${model.postsAnalysed} posts read in full`}
                body={`of the ${model.postsStored} your desk stores, across ${model.platforms} platforms`}
              />
              <Fact
                head={`${compact(model.commentsRead)} comments counted`}
                body={`under ${model.postsWalked} posts, by the per-account comment readings`}
              />
              <Fact
                head={`${model.measuredInWindow} posts with published figures`}
                body="reactions counted only where the platform published them; a gap stays a gap"
              />
              <Fact
                head="Sentiment from comments where retrievable"
                body="and from the post's own register where none were, said per figure"
              />
            </ul>
          </Panel>

          <Panel title="What your posts are about" icon={<FileText size={14} aria-hidden />}>
            {model.audience.topics.length === 0 ? (
              <p className="text-[11.5px] text-ink-3">No topics read yet.</p>
            ) : (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <DonutBreakdown
                  size={132}
                  thickness={18}
                  segments={model.audience.topics.map((t, i) => ({
                    label: String(t.topic),
                    value: t.posts,
                    color: seriesColor(i),
                  }))}
                  centerLabel={String(model.audience.topicPosts)}
                  centerSub="posts"
                />
                <ul className="min-w-[150px] flex-1 space-y-1">
                  {model.audience.topics.slice(0, 6).map((t, i) => (
                    <li key={String(t.topic)} className="flex items-center gap-1.5 text-[11px]">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: seriesColor(i) }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-ink-2">{String(t.topic)}</span>
                      <span className="tnum font-semibold">{t.pct}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
              Same count the audience screen draws, over {model.audience.topicPosts} read in full.
            </p>
          </Panel>

          {model.credibility && (
            <Panel title="The reader's own check" icon={<BadgeCheck size={14} aria-hidden />}>
              <p className="text-[11.5px] leading-relaxed text-ink-2">
                Nothing suspected false in {model.credibility.clean} of {model.credibility.of}{' '}
                readings{model.credibility.unsure > 0 ? `; ${model.credibility.unsure} marked unsure` : ''}.
              </p>
              <p className="mt-1 text-[10px] text-ink-3">
                The model&rsquo;s check of your own posts, not a measure of audience trust.
              </p>
            </Panel>
          )}
        </div>

        {/* centre: the themes */}
        <div className="space-y-3">
          {keyInsight(model) && (
            <Card className="border-[var(--accent)]/40 bg-[var(--accent-soft)] p-3.5">
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--accent)]">
                <Lightbulb size={13} aria-hidden />
                The one thing worth keeping
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed">{keyInsight(model)}</p>
            </Card>
          )}
          <Panel
            title="How your themes have read"
            icon={<Sparkles size={14} aria-hidden />}
            sub={`${model.themes.length} themes with two or more read posts, ${model.windowLabel}.`}
          >
            {model.themes.length === 0 ? (
              <p className="text-[11.5px] leading-relaxed text-ink-3">
                {model.postsAnalysed === 0
                  ? 'No posts read in full in this window.'
                  : `No theme has two read posts in this window. ${model.thinTopics} appeared once.`}
              </p>
            ) : (
              <ul className="divide-y divide-[var(--rule)]">
                {model.themes.map((t) => (
                  <ThemeLine key={t.topic} t={t} />
                ))}
              </ul>
            )}
            {model.thinTopics > 0 && model.themes.length > 0 && (
              <p className="mt-2 border-t border-[var(--rule)] pt-2 text-[10.5px] text-ink-3">
                {model.thinTopics} more {model.thinTopics === 1 ? 'topic' : 'topics'} appeared on a
                single read post, too few to show.
              </p>
            )}
          </Panel>

</div>

        {/* right: the raw material */}
        <div className="space-y-3">
          <Panel title="Straight from the comments" icon={<MessageSquare size={14} aria-hidden />}>
            {model.audience.quotes.length === 0 ? (
              <p className="text-[11.5px] text-ink-3">No comments quoted by the readings yet.</p>
            ) : (
              <ul className="space-y-2">
                {model.audience.quotes.slice(0, 3).map((q, i) => (
                  <li
                    key={i}
                    className="rounded-[var(--radius-md)] border border-[var(--rule)] p-2.5"
                  >
                    <p className="text-[11.5px] leading-relaxed text-ink-2">
                      &ldquo;{q.text}&rdquo;
                    </p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <PlatformBadge platform={q.platform} size={12} />
                      <Chip
                        tone={
                          q.side === 'positive'
                            ? 'positive'
                            : q.side === 'negative'
                              ? 'negative'
                              : 'neutral'
                        }
                      >
                        {q.side ?? 'unscored'}
                      </Chip>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="How often you post" icon={<CalendarClock size={14} aria-hidden />}>
            <ul className="space-y-1.5">
              {model.cadence.map((c) => (
                <li key={c.platform} className="flex items-center justify-between gap-2 text-[11.5px]">
                  <PlatformBadge platform={c.platform as never} size={12} />
                  <span className="tnum text-ink-2">
                    {c.perWeek !== null
                      ? `${(Math.round(c.perWeek * 10) / 10).toFixed(1)} a week`
                      : c.dated > 0
                        ? `${c.dated} dated posts`
                        : 'no dates published'}
                  </span>
                </li>
              ))}
            </ul>
            {model.undatedNote && (
              <p className="mt-2 text-[10px] leading-relaxed text-ink-3">{model.undatedNote}</p>
            )}
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-3">
              A best day or hour is not shown: at these counts a bucket holds one to eight posts,
              which is noise, not advice.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  )
}

const keyInsight = (model: NextPostModel): string | null => {
  const topic = model.lands.working.find((f) => f.kind === 'topic')
  if (topic) return `${topic.label}: ${topic.evidence}`
  const bucket = model.lands.working.find((f) => f.kind !== 'topic')
  return bucket ? `${bucket.label}: ${bucket.evidence}` : null
}

function Fact({ head, body }: { head: string; body: string }) {
  return (
    <li>
      <p className="font-semibold text-ink">{head}</p>
      <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">{body}</p>
    </li>
  )
}

function ThemeLine({ t }: { t: ThemeRow }) {
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[12.5px] font-semibold">{t.topic}</p>
        <span className="tnum text-[10.5px] text-ink-3">
          {t.posts} {t.posts === 1 ? 'post' : 'posts'}
        </span>
        {t.verdict === 'working' && <Chip tone="positive">working</Chip>}
        {t.verdict === 'not-landing' && <Chip tone="negative">not landing</Chip>}
        {t.verdict === 'mixed' && <Chip tone="neutral">mixed</Chip>}
        {t.verdict === 'thin' && <Chip tone="neutral">too few to grade</Chip>}
      </div>
      <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-ink-2">
        {t.evidence && <li>{t.evidence}</li>}
        {!t.evidence && t.meanScore !== null && (
          <li>
            {t.posts} posts read at {t.meanScore > 0 ? '+' : ''}
            {Math.round(t.meanScore)} in the full analysis.
          </li>
        )}
        {t.narrative.length > 0 && (
          <li>
            The audience{'’'}s recorded answer:{' '}
            {t.narrative.map((n) => `${n.label} on ${n.posts}`).join(', ')} of {t.narrativeOver}{' '}
            posts that drew one.
          </li>
        )}
        {t.lift && (
          <li>
            On {t.lift.platform}, {t.lift.n} posts averaged{' '}
            {(Math.round(t.lift.multiple * 10) / 10).toFixed(1)}x that platform{'’'}s typical{' '}
            {compact(Math.round(t.lift.typical))} reactions.
          </li>
        )}
        {t.comments && (
          <li>
            {compact(t.comments.total)} {t.comments.total === 1 ? 'comment' : 'comments'} published
            across {t.comments.over} {t.comments.over === 1 ? 'post' : 'posts'}.
          </li>
        )}
        {t.quote && (
          <li className="text-ink-3">
            &ldquo;{t.quote.text}&rdquo; <span className="text-[10px]">({t.quote.from})</span>
          </li>
        )}
      </ul>
    </li>
  )
}

/* ── tab two: openings ────────────────────────────────────────────────────── */

function OpeningsTab() {
  const store = useStore()
  const since = useMemo(() => Date.now() - 14 * 86_400_000, [])
  const model = useMemo(() => openingsOf(readStore(), since), [store, since])

  return (
    <div className="@container">
      <div className="grid gap-3 @3xl:grid-cols-2">
        {model.rows.length === 0 ? (
          <div className="@3xl:col-span-2">
            <Empty
              icon={<Newspaper size={18} aria-hidden />}
              title="No openings on file"
              body={
                model.newsRead === 0
                  ? 'No news has been read for this desk yet, and no grievances are open. The scan fills this as it runs.'
                  : 'Nothing the relevance readings let through, and no open grievances.'
              }
            />
          </div>
        ) : (
          model.rows.map((row) => <OpeningCard key={row.id} row={row} />)
        )}
      </div>
      {isDemoScope() && model.grievances > 0 && (
        <p className="mt-2.5 text-[10.5px] text-ink-3">
          Example desk: these grievance records are illustrative, seeded so the screens have
          something to show.
        </p>
      )}
      {model.hiddenNews > 0 && (
        <p className="mt-2.5 text-[10.5px] text-ink-3">
          {model.hiddenNews} stories were read and held back by the relevance verdicts. The news
          desk lists them.
        </p>
      )}
    </div>
  )
}

function OpeningCard({ row }: { row: Opening }) {
  const [posts, setPosts] = useState<SuggestedPost[] | null>(
    () => readSuggestions(row.id)?.posts ?? null,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const draft = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const identity = readStore().identity
      const drafted = await fetchSuggestions(row.issue, [], {
        name: identity?.name ?? 'This office',
        role: identity?.role ?? null,
        party: identity?.party ?? null,
        constituency: identity?.constituency ?? null,
      })
      saveSuggestions(row.id, drafted)
      setPosts(drafted)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The drafts could not be written.')
    } finally {
      setBusy(false)
    }
  }, [row])

  return (
    <Card className="flex flex-col p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">
          {row.kind === 'news' ? (
            <Newspaper size={13} aria-hidden />
          ) : (
            <FileText size={13} aria-hidden />
          )}
          {row.kind === 'news' ? 'In the news' : 'Grievance'}
        </p>
        {row.severity && (
          <Chip tone={row.severity === 'Critical' || row.severity === 'High' ? 'negative' : 'neutral'}>
            {row.severity}
          </Chip>
        )}
      </div>
      <p className="mt-1.5 text-[13px] font-semibold leading-snug">{row.title}</p>
      {row.issue.summary && row.issue.summary !== row.title && (
        <p className="mt-1 line-clamp-3 text-[11.5px] leading-relaxed text-ink-2">
          {row.issue.summary}
        </p>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{row.why}</p>

      {posts && posts.length > 0 && (
        <ul className="mt-2.5 space-y-1.5 border-t border-[var(--rule)] pt-2.5">
          {posts.slice(0, 2).map((p, i) => (
            <li key={i} className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-2">
              <p className="text-[11px] leading-relaxed text-ink-2">{p.text}</p>
              <p className="mt-1 text-[9.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                {p.angle} - drafted, check before you post
              </p>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-[10.5px] text-[var(--neg)]">{error}</p>}

      <div className="mt-auto pt-2.5">
        <Button size="sm" variant="outline" onClick={() => void draft()} disabled={busy}>
          {busy ? (
            <LoaderCircle size={13} className="animate-spin" aria-hidden />
          ) : (
            <Sparkles size={13} aria-hidden />
          )}
          {posts ? 'Draft fresh posts' : 'Draft posts for this'}
        </Button>
      </div>
    </Card>
  )
}

/* ── tab three: ideas ─────────────────────────────────────────────────────── */

function IdeasTab({
  model,
  onMakePost,
}: {
  model: NextPostModel
  onMakePost: (brief: string) => void
}) {
  const [result, setResult] = useState<PlanResult | null>(() => readPlanCache())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const input = useMemo((): PlanInput => {
    const store = readStore()
    const handles = listHandles()
    const own = handles.filter((h) => h.own)
    return {
      identity: store.identity,
      reach: platformReachOf(own),
      lands: model.lands,
      ownHandles: own,
      allHandles: handles,
      issues: issuesFor(store, Date.now() - 14 * 86_400_000),
    }
  }, [model])

  const load = useCallback(
    async (force: boolean) => {
      setBusy(true)
      setError(null)
      try {
        setResult(await loadPostPlan(input, force))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The plan could not be drafted.')
      } finally {
        setBusy(false)
      }
    },
    [input],
  )

  const ready = planReady(input)

  return (
    <div className="@container">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] leading-relaxed text-ink-3">
          Worked-out plans, drafted by the model from the same memos this screen shows. Blanks in
          square brackets are facts it wants from you, never guesses.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void load(result !== null)}
          disabled={busy || !ready}
        >
          {busy ? (
            <LoaderCircle size={13} className="animate-spin" aria-hidden />
          ) : (
            <RefreshCw size={13} aria-hidden />
          )}
          {result ? 'Draft a fresh plan' : 'Draft the plan'}
        </Button>
      </div>

      {!ready && (
        <p className="mt-2 text-[11px] text-ink-3">
          The plan needs a set-up desk with at least one finding or open issue to stand on.
        </p>
      )}
      {error && <p className="mt-2 text-[11px] text-[var(--neg)]">{error}</p>}

      {result && (
        <div className="mt-3 grid gap-3 @3xl:grid-cols-2">
          {result.plans.map((plan, i) => (
            <Card key={i} className="flex flex-col p-3.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-semibold leading-snug">{plan.title}</p>
                <Chip tone={plan.priority === 'High' ? 'positive' : 'neutral'}>
                  {plan.priority}
                </Chip>
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <PlatformBadge platform={plan.platform as never} size={12} />
                <span className="text-[10.5px] text-ink-3">{plan.platform}</span>
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">{plan.why}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-ink-2">
                {plan.steps.map((s, j) => (
                  <li key={j}>{s}</li>
                ))}
              </ol>
              <blockquote className="mt-2.5 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-2.5 text-[11.5px] leading-relaxed text-ink-2">
                {plan.draft}
              </blockquote>
              <p className="mt-1.5 text-[9.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">
                Drafted by the model - check every fact before it goes out
              </p>
              <div className="mt-auto pt-2.5">
                <Button
                  size="sm"
                  onClick={() => onMakePost(`${plan.title}. ${plan.draft}`)}
                >
                  <Wand2 size={13} aria-hidden />
                  Make this in the studio
                  <ArrowRight size={12} aria-hidden />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── the shared panel ─────────────────────────────────────────────────────── */

function Panel({
  title,
  sub,
  icon,
  children,
}: {
  title: string
  sub?: string
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="p-3.5">
      <p className="flex items-center gap-1.5 text-[12.5px] font-bold">
        {icon && <span className="text-[var(--accent)]">{icon}</span>}
        {title}
      </p>
      {sub && <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">{sub}</p>}
      <div className="mt-2.5">{children}</div>
    </Card>
  )
}

/* ── export ───────────────────────────────────────────────────────────────── */

/**
 * The screen as a workbook: the themes with their evidence, and the
 * provenance. The same figures, the same denominators, nothing added on the
 * way out.
 */
async function exportModel(model: NextPostModel): Promise<void> {
  const themes = {
    name: 'Themes',
    columns: [
      { header: 'Theme', width: 28, kind: 'text' as const },
      { header: 'Posts read', width: 11, kind: 'number' as const },
      { header: 'Verdict', width: 16, kind: 'text' as const },
      { header: 'Mean reading', width: 13, kind: 'number' as const },
      { header: 'Evidence', width: 60, kind: 'text' as const },
      { header: 'Audience answer', width: 44, kind: 'text' as const },
      { header: 'Platform lift', width: 44, kind: 'text' as const },
    ],
    rows: model.themes.map((t) => [
      t.topic,
      t.posts,
      t.verdict,
      t.meanScore === null ? null : Math.round(t.meanScore),
      t.evidence,
      t.narrative.length > 0
        ? `${t.narrative.map((n) => `${n.label} on ${n.posts}`).join(', ')} of ${t.narrativeOver}`
        : null,
      t.lift
        ? `${t.lift.platform}: ${t.lift.n} posts at ${(Math.round(t.lift.multiple * 10) / 10).toFixed(1)}x typical`
        : null,
    ]),
  }
  const provenance = {
    name: 'Provenance',
    columns: [
      { header: 'Fact', width: 40, kind: 'text' as const },
      { header: 'Value', width: 40, kind: 'text' as const },
    ],
    rows: [
      ['Window', model.windowLabel],
      ['Posts stored', String(model.postsStored)],
      ['Posts read in full', String(model.postsAnalysed)],
      ['Posts in window', String(model.postsInWindow)],
      ['Posts with published figures', String(model.measuredInWindow)],
      ['Comments counted on your accounts', String(model.commentsRead)],
      ['Comment split', `${model.audience.positive}% positive, ${model.audience.neutral}% neutral, ${model.audience.negative}% negative`],
      ['Recommendation', model.recommendation],
    ],
  }
  const blob = await buildWorkbook([themes, provenance])
  const stamp = new Date().toISOString().slice(0, 10)
  saveBlob(blob, `what-to-post-next-${stamp}.xlsx`)
}
