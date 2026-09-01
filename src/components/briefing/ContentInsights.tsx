import { useMemo, useState } from 'react'
import { ArrowRight, ExternalLink, Quote, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import type { Report } from '@shared/types'
import type { PublicNarrative } from '@shared/taxonomy'
import { Card, Chip } from '../ui'
import { PlatformBadge, youtubeThumb } from '@/components/kit'
import type { TrackedHandle, TrackedPost } from '@/lib/handles'
import { cn, compact } from '@/lib/utils'
import { inWindow, newestPostDate, windowLabel, windowStart, type WindowId } from '@/lib/window'
import { WindowPicker } from './controls'

/**
 * "Content Insights" — what is working and what is not, judged the way the
 * owner asked: by the AUDIENCE. The office wrote the posts; it does not need
 * the desk to repeat them back. So the Mood column is the audience's recorded
 * reaction from each post's stored full report — Happy, Agreed, Divided,
 * Outraged — not a re-description of the post, and tapping a row opens that
 * stored report on the analyse screen, instantly, the same page an analysis
 * lands on. Nothing is re-analysed: a report is run once, kept (in the
 * device's history, or shipped with the example desk), and reread from there.
 *
 * Ranking is by what each platform actually published, and NO PLATFORM MAY
 * VANISH. Ranking on reactions alone deleted YouTube outright: the channel
 * publishes view counts and no like counts to a signed-out reader, so all 25
 * videos scored zero reactions and never reached a table — the account was
 * read, counted in the totals, and invisible in the one section about what
 * lands. So each platform's best and weakest post lead the tables, judged on
 * the figure that platform publishes, and a view is never compared against a
 * like.
 */

interface Row {
  url: string
  platform: string
  /** True when the platform published a reaction count for this post. */
  measured: boolean
  title: string
  thumbnailUrl: string | null
  publishedAt: string | null
  views: number | null
  reactions: number
  report: Report | null
  narrative: PublicNarrative | null
  score: number | null
  rationale: string | null
}

const hasReactions = (p: TrackedPost): boolean =>
  p.likes != null || p.comments != null || p.shares != null

function rowsOf(handles: TrackedHandle[], reports: Map<string, Report> | null): Row[] {
  const out: Row[] = []
  for (const h of handles) {
    for (const p of h.snapshots.at(-1)?.posts ?? []) {
      // Either figure earns a place. Only a post the platform said nothing
      // about at all is left out, because there is nothing to rank it by.
      if (!hasReactions(p) && p.views == null) continue
      const report = reports?.get(p.url) ?? null
      const sentiment = report?.analysis?.sentiment ?? null
      out.push({
        url: p.url,
        platform: h.platform,
        measured: hasReactions(p),
        title: p.title?.trim() || p.url,
        /* The picture, from wherever one truly exists: the stored post, the
           full report's own media record, or YouTube's public still. */
        thumbnailUrl:
          p.thumbnailUrl ??
          report?.snapshot.media.find((m) => m.kind === 'image' || m.kind === 'video')?.url ??
          (h.platform === 'YouTube' ? youtubeThumb(p.url) : null),
        // The report often knows the date the scrape did not carry.
        publishedAt: p.publishedAt ?? report?.snapshot.publishedAt ?? null,
        views: p.views,
        reactions: (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0),
        report,
        narrative: sentiment?.publicNarrative ?? null,
        score: sentiment?.score ?? null,
        rationale: sentiment?.rationale ?? null,
      })
    }
  }
  return out
}

const dayOf = (iso: string | null): string | null =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

/* ── the audience's word ─────────────────────────────────────────────────── */

const NARRATIVE_TONE: Record<string, 'positive' | 'warning' | 'negative'> = {
  Happy: 'positive',
  Agreed: 'positive',
  Divided: 'warning',
  Indifferent: 'warning',
  Resentment: 'negative',
  Outraged: 'negative',
}

/**
 * The Mood column: the audience's recorded reaction, in its own word. Only
 * when the reaction itself was unclear does the AI's read of the post fill
 * in, and the hover says which claim is being made.
 */
function MoodCell({ row }: { row: Row }) {
  if (!row.report) {
    return (
      <span
        className="cursor-help text-[11px] text-ink-3"
        title="This post has not been read in full yet. Tap the row to analyse it."
      >
        Not read
      </span>
    )
  }
  if (row.narrative && row.narrative !== 'NA') {
    return (
      <span title={row.rationale ?? 'The audience reaction recorded in the full reading.'}>
        <Chip tone={NARRATIVE_TONE[row.narrative] ?? 'warning'}>{row.narrative}</Chip>
      </span>
    )
  }
  if (row.score != null) {
    const label = row.score >= 15 ? 'Positive' : row.score <= -15 ? 'Negative' : 'Neutral'
    const tone = row.score >= 15 ? 'positive' : row.score <= -15 ? 'negative' : 'warning'
    return (
      <span title="The audience reaction was unclear in the comments, so this is the reading of the post itself.">
        <Chip tone={tone}>{label}</Chip>
      </span>
    )
  }
  return <span className="text-[11px] text-ink-3">Unclear</span>
}

/* ── the picture, or the account's own face ──────────────────────────────── */

function Thumb({ row }: { row: Row }) {
  const [failed, setFailed] = useState(false)
  if (row.thumbnailUrl && !failed) {
    return (
      <img
        src={row.thumbnailUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-9 shrink-0 rounded-[var(--radius-sm)] object-cover"
      />
    )
  }
  /* The post's OWN picture or none at all.
     The account's profile photo used to fill in here, and it read as a
     thumbnail: eight rows of the same face, each implying it was the picture
     on that post. A tinted tile carrying the platform's colour says "this
     post has no picture", which is the truth and is never mistaken for one. */
  return (
    <span
      className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)]"
      style={{ background: THUMB_TINT[row.platform] ?? 'var(--surface-3)' }}
      title="No picture is stored for this post."
    >
      <Quote size={12} className="text-ink-3 opacity-70" fill="currentColor" strokeWidth={0} aria-hidden />
    </span>
  )
}

/** Brand colour at low alpha, so a text post still says where it lives. */
const THUMB_TINT: Record<string, string> = {
  Instagram: 'rgba(221,42,123,0.14)',
  Facebook: 'rgba(24,119,242,0.12)',
  'Twitter/X': 'rgba(15,20,25,0.10)',
  YouTube: 'rgba(255,0,51,0.10)',
  LinkedIn: 'rgba(10,102,194,0.12)',
}

/* ── one ranked table ────────────────────────────────────────────────────── */

function PostTable({
  title,
  icon,
  rows,
  tone,
  showViews,
  onRead,
  onOpenReport,
}: {
  title: string
  icon: React.ReactNode
  rows: Row[]
  tone: 'pos' | 'neg'
  /** Off when nothing listed published a view count — a column of blanks is furniture. */
  showViews: boolean
  onRead: (postUrl: string) => void
  onOpenReport: (report: Report) => void
}) {
  const heads = [
    { h: 'Post', why: 'The post, and how its audience answered' },
    { h: 'App', why: 'Which platform it was posted on' },
    ...(showViews ? [{ h: 'Views', why: 'View count, where the platform publishes one' }] : []),
    { h: 'Likes', why: 'Likes plus comments plus shares, as published' },
    { h: 'Mood', why: 'The audience reaction from the full reading of the post' },
  ]

  return (
    <div className="min-w-0">
      <p
        className={cn(
          'mb-2 flex items-center gap-1.5 text-[13px] font-bold',
          tone === 'pos' ? 'text-[var(--pos)]' : 'text-[var(--neg)]',
        )}
      >
        {icon}
        {title}
      </p>

      {rows.length === 0 ? (
        <p className="text-xs leading-relaxed text-ink-3">
          No post here published enough for a ranking in this window.
        </p>
      ) : (
        <div className="relative">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--rule)]">
                {heads.map(({ h, why }) => (
                  <th
                    key={h}
                    title={why}
                    className="cursor-help pb-1.5 pr-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.url} className="border-b border-[var(--rule)] last:border-0">
                  <td className="py-2 pr-2">
                    {/* Navigation, not disclosure, per the owner: a stored
                        reading opens on the analyse page, where every report
                        lives, and Back returns here. */}
                    <button
                      type="button"
                      onClick={() => (r.report ? onOpenReport(r.report) : onRead(r.url))}
                      title={
                        r.report
                          ? 'Open the stored reading. Already analysed, so it opens instantly.'
                          : 'Run the full analysis on this post.'
                      }
                      className="group flex min-w-0 items-center gap-2 text-left"
                    >
                      <Thumb row={r} />
                      <span className="min-w-0">
                        <span className="line-clamp-1 max-w-[11rem] text-xs font-medium text-ink group-hover:text-[var(--accent)] xl:max-w-[14rem]">
                          {r.title}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-[10.5px] text-ink-3">
                          {dayOf(r.publishedAt) ?? 'Date not published'}
                          {r.report && <ExternalLink size={10} aria-hidden className="opacity-60" />}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="py-2 pr-2">
                    <PlatformBadge platform={r.platform} size={20} />
                  </td>
                  {showViews && (
                    <td className="tnum py-2 pr-2 text-xs font-semibold">
                      {r.views == null ? '' : compact(r.views)}
                    </td>
                  )}
                  <td className="tnum py-2 pr-2 text-xs font-semibold">
                    {r.measured ? compact(r.reactions) : ''}
                  </td>
                  <td className="py-2">
                    <MoodCell row={r} />
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
          {/* Phone-only right-edge fade: at 390px the Mood pills cut
              mid-word, and the fade is the "there is more, swipe" sign the
              cut edge alone never was. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--surface)] to-transparent sm:hidden"
          />
        </div>
      )}
    </div>
  )
}

/* ── the section ─────────────────────────────────────────────────────────── */

export function ContentInsights({
  handles,
  reports,
  onRead,
  onOpenReport,
  onOpenAccounts,
}: {
  /** The desk's own accounts: this section is about the office's own output. */
  handles: TrackedHandle[]
  reports: Map<string, Report> | null
  onRead: (postUrl: string) => void
  /** Open an already-stored reading on the analyse screen. */
  onOpenReport: (report: Report) => void
  onOpenAccounts: () => void
}) {
  const [platform, setPlatform] = useState<string>('all')
  const [window, setWindow] = useState<WindowId>('all')

  const anchor = useMemo(
    () =>
      newestPostDate(
        handles.flatMap((h) => (h.snapshots.at(-1)?.posts ?? []).map((p) => p.publishedAt)),
      ),
    [handles],
  )
  const start = windowStart(anchor, window)

  const all = useMemo(
    () => rowsOf(handles, reports).filter((r) => inWindow(r.publishedAt, start)),
    [handles, reports, start],
  )
  const rows = platform === 'all' ? all : all.filter((r) => r.platform === platform)

  /* What this post is judged on: its reactions where the platform published
     any, its views where that is all the platform gives. */
  const scoreOf = (r: Row): number => (r.measured ? r.reactions : (r.views ?? 0))

  const { top, bottom } = useMemo(() => {
    const byPlatform = new Map<string, Row[]>()
    for (const r of rows) byPlatform.set(r.platform, [...(byPlatform.get(r.platform) ?? []), r])

    /* One platform selected: an ordinary top three and bottom three within
       it. Everything selected: each platform's own best and own weakest, so
       a channel that publishes different figures still has its say. */
    if (byPlatform.size <= 1) {
      const ranked = [...rows].sort((a, b) => scoreOf(b) - scoreOf(a))
      // Eight a side: the section has the height for them, and a top three
      // on a desk holding a hundred posts is a sample, not a ranking.
      const half = Math.min(8, Math.floor(ranked.length / 2))
      return {
        top: ranked.slice(0, Math.max(1, Math.min(8, ranked.length))),
        bottom: half > 0 ? ranked.slice(-half).reverse() : [],
      }
    }

    /* Eight a side, filled fairly: each platform's best (and worst) first, so
       no channel can be crowded out, then the next best from each in turn
       until the tables are full. A post never appears in both. */
    const ranked = new Map<string, Row[]>()
    for (const [platform, list] of byPlatform) {
      ranked.set(platform, [...list].sort((a, b) => scoreOf(b) - scoreOf(a)))
    }
    const take = (from: 'top' | 'bottom', limit: number, avoid: Set<string>): Row[] => {
      const out: Row[] = []
      for (let depth = 0; out.length < limit; depth++) {
        let grew = false
        for (const list of ranked.values()) {
          const row = from === 'top' ? list[depth] : list[list.length - 1 - depth]
          if (!row || avoid.has(row.url) || out.some((r) => r.url === row.url)) continue
          out.push(row)
          grew = true
          if (out.length >= limit) break
        }
        if (!grew) break
      }
      return out
    }
    const bests = take('top', 8, new Set())
    const worsts = take('bottom', 8, new Set(bests.map((r) => r.url)))
    return {
      top: bests.sort((a, b) => scoreOf(b) - scoreOf(a)),
      bottom: worsts.sort((a, b) => scoreOf(a) - scoreOf(b)),
    }
  }, [rows])

  const showViewsTop = top.some((r) => r.views != null)
  const showViewsBottom = bottom.some((r) => r.views != null)

  const analysed = all.filter((r) => r.report).length

  /* The per-platform board: what this platform's best posts average against
     what its weakest average, over the same posts the tables rank. */
  const board = useMemo(() => {
    const byPlatform = new Map<string, Row[]>()
    for (const r of all) byPlatform.set(r.platform, [...(byPlatform.get(r.platform) ?? []), r])
    return [...byPlatform.entries()]
      .map(([platform, list]) => {
        const measured = list.some((r) => r.measured)
        const score = (r: Row): number => (measured ? r.reactions : (r.views ?? 0))
        const sorted = [...list].sort((a, b) => score(b) - score(a))
        const half = Math.max(1, Math.floor(sorted.length / 2))
        const mean = (xs: Row[]): number =>
          Math.round(xs.reduce((a, r) => a + score(r), 0) / Math.max(xs.length, 1))
        return {
          platform,
          unit: measured ? 'reactions' : 'views',
          best: mean(sorted.slice(0, half)),
          worst: mean(sorted.slice(-half)),
        }
      })
      .sort((a, b) => b.best - a.best)
  }, [all])
  const platforms = [...new Set(all.map((r) => r.platform))]

  if (all.length === 0 && window === 'all') return null

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-[-0.015em]">Content insights</h2>
          <p className="mt-0.5 text-xs text-ink-3">
            How your audience answered · {windowLabel(anchor, window)}
            {analysed > 0 && ` · ${analysed} posts read in full`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <WindowPicker value={window} onChange={setWindow} />
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPlatform('all')}
              aria-pressed={platform === 'all'}
              className={cn(
                'inline-flex min-h-9 items-center rounded-[var(--radius-pill)] border px-3 text-xs font-semibold transition-colors',
                platform === 'all'
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-[var(--border)] bg-[var(--surface-2)] text-ink-2',
              )}
            >
              All platforms
            </button>
            {platforms.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                aria-pressed={platform === p}
                aria-label={p}
                title={p}
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-full border transition-colors',
                  platform === p
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-[var(--border)] bg-[var(--surface-2)]',
                )}
              >
                <PlatformBadge platform={p} size={20} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          No post with published engagement falls inside this window.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2 2xl:grid-cols-[1fr_1fr_minmax(240px,0.62fr)]">
          <PostTable
            title="Top performing posts"
            icon={<TrendingUp size={14} aria-hidden />}
            rows={top}
            tone="pos"
            showViews={showViewsTop}
            onRead={onRead}
            onOpenReport={onOpenReport}
          />
          <PostTable
            title="Underperforming posts"
            icon={<TrendingDown size={14} aria-hidden />}
            rows={bottom}
            tone="neg"
            showViews={showViewsBottom}
            onRead={onRead}
            onOpenReport={onOpenReport}
          />

          <div className="min-w-0 lg:col-span-2 2xl:col-span-1">
            <p className="mb-2 text-[13px] font-bold">Platform-wise performance</p>
            {board.length === 0 ? (
              <p className="text-xs leading-relaxed text-ink-3">Nothing measured yet.</p>
            ) : (
              <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-1">
                {board.map((b) => (
                  <li key={b.platform}>
                    <div className="flex items-center gap-2">
                      <PlatformBadge platform={b.platform} size={20} />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-2">
                        {b.platform}
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                          <div className="h-full w-full rounded-full bg-[var(--pos)]" />
                        </div>
                        <p className="tnum mt-1 text-[11px] font-semibold text-[var(--pos)]">
                          {compact(b.best)}
                        </p>
                      </div>
                      <div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                          <div
                            className="h-full rounded-full bg-[var(--neg)]"
                            style={{
                              width: `${Math.max((b.worst / Math.max(b.best, 1)) * 100, 3)}%`,
                            }}
                          />
                        </div>
                        <p className="tnum mt-1 text-[11px] font-semibold text-[var(--neg)]">
                          {compact(b.worst)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-0.5 text-[10px] text-ink-3">{b.unit}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">
              Each platform&rsquo;s stronger half against its own weaker half, in the figure that
              platform publishes. Bars compare a platform with itself, never with another.
            </p>

            {/* A nudge with a number behind it: the audience verdicts above
                only exist for posts that were read in full, and a reading is
                run once and kept. */}
            {analysed < all.length && (
              <p className="mt-2 flex items-start gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent-soft)] p-2.5 text-[11px] leading-relaxed text-ink-2">
                <Sparkles size={12} className="mt-0.5 shrink-0 text-[var(--accent)]" aria-hidden />
                {all.length - analysed} posts have no reading yet. Tap one to analyse it; once
                read, it opens instantly forever.
              </p>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onOpenAccounts}
        className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--accent)]"
      >
        View all posts
        <ArrowRight size={14} aria-hidden />
      </button>
    </Card>
  )
}
