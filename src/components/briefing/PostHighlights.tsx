import { lazy, Suspense, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Report } from '@shared/types'
import { Card, Chip, Empty, SkeletonLines } from '../ui'
import { PlatformBadge } from '@/components/kit'
import type { OwnPost } from '@/lib/briefing'
import { cn, compact } from '@/lib/utils'

/**
 * Post highlights: the office's own posts that a full report exists for,
 * split into what landed and what drew criticism by the report's own
 * sentiment score. Expanding a row shows the exact same deep-analysis UI as
 * the Analyse screen — ReportView IS that UI, mounted lazily so thirty
 * reports' worth of charts are never built for rows nobody opens.
 *
 * Nothing here scores a post itself. A post with no report is counted in the
 * quiet footer and never given a fabricated sentiment; the way onto this list
 * is to analyse the post.
 */

// Code-split: ReportView drags in charts, maps and confetti, and most visits
// never expand a row. The import price is paid on first expand, not on load.
const ReportView = lazy(() =>
  import('../report/ReportView').then((m) => ({ default: m.ReportView })),
)

interface Highlight {
  post: OwnPost
  report: Report
  score: number
}

function HighlightRow({ h }: { h: Highlight }) {
  const [open, setOpen] = useState(false)
  // Lazy-mount, then keep: children render only once a row has been opened,
  // and stay mounted afterwards so re-expanding does not rebuild the whole
  // report (or replay its mount effects) a second time.
  const [everOpened, setEverOpened] = useState(false)

  const title = h.post.title?.trim() || h.report.analysis?.headline || h.post.url
  const eng = h.post.measured
    ? `${compact(h.post.reactions)} reactions`
    : h.post.views != null
      ? `${compact(h.post.views)} views`
      : null

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          setEverOpened(true)
        }}
        aria-expanded={open}
        /* One line per post, on purpose. The row is a table of contents for
           the report behind it, and five three-line cards per group cost two
           screens of scrolling to list ten headlines. `line-clamp-1` without
           a `block` beside it: both set display, and block was winning,
           which is exactly how these rows grew tall in the first place. */
        className="flex min-h-11 w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-[var(--surface-2)] sm:px-4"
      >
        <PlatformBadge platform={h.post.platform} size={22} />
        <span className="line-clamp-1 min-w-0 flex-1 text-sm font-semibold leading-snug">
          {title}
        </span>
        {eng && <span className="tnum hidden shrink-0 text-xs text-ink-3 sm:inline">{eng}</span>}
        <Chip tone={h.score >= 0 ? 'positive' : 'negative'} className="tnum">
          {h.score > 0 ? '+' : ''}
          {Math.round(h.score)}
        </Chip>
        <ChevronDown
          size={16}
          aria-hidden
          className={cn('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')}
        />
      </button>

      {everOpened && (
        <div hidden={!open} className="border-t border-[var(--rule)] bg-[var(--surface-2)] p-2 sm:p-4">
          {/* Its own background so the nested report reads as an inset
              document rather than dissolving into the dashboard card. */}
          <div className="rounded-[var(--radius-lg)] bg-[var(--bg)] p-1 sm:p-2">
            <Suspense fallback={<SkeletonLines lines={6} className="p-4" />}>
              <ReportView report={h.report} onReset={() => setOpen(false)} celebrate={false} />
            </Suspense>
          </div>
        </div>
      )}
    </li>
  )
}

export function PostHighlights({
  posts,
  reports,
}: {
  /** The desk's own posts, from the latest snapshots. */
  posts: OwnPost[]
  /** Null while the report map is still loading. */
  reports: Map<string, Report> | null
}) {
  if (reports === null) {
    return (
      <Card>
        <SkeletonLines lines={4} />
      </Card>
    )
  }

  const matched: Highlight[] = []
  for (const post of posts) {
    const report = reports.get(post.url)
    if (!report?.analysis) continue
    matched.push({ post, report, score: report.analysis.sentiment.score })
  }

  const landed = matched
    .filter((h) => h.score >= 15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
  const criticised = matched
    .filter((h) => h.score <= -15)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)

  const unread = posts.length - matched.length

  if (matched.length === 0) {
    return (
      <Empty
        title="None of your own posts has been read in full yet"
        body="Analyse any post and it appears here."
      />
    )
  }

  return (
    <div className="stack-tight">
      {landed.length > 0 && (
        <div>
          <p className="kicker text-[var(--pos)]">What landed best</p>
          {/* One card, divided rows — not five floating cards. The rows are
              an index; the depth lives behind the tap. */}
          <Card padded={false} className="mt-2">
            <ul className="divide-y divide-[var(--rule)] py-1">
              {landed.map((h) => (
                <HighlightRow key={h.post.url} h={h} />
              ))}
            </ul>
          </Card>
        </div>
      )}

      {criticised.length > 0 && (
        <div>
          <p className="kicker text-[var(--neg)]">What drew criticism</p>
          <Card padded={false} className="mt-2">
            <ul className="divide-y divide-[var(--rule)] py-1">
              {criticised.map((h) => (
                <HighlightRow key={h.post.url} h={h} />
              ))}
            </ul>
          </Card>
        </div>
      )}

      {landed.length === 0 && criticised.length === 0 && (
        <Card>
          <p className="text-sm leading-relaxed text-ink-2">
            {matched.length} {matched.length === 1 ? 'post' : 'posts'} read. No strong reactions
            yet.
          </p>
        </Card>
      )}

      {unread > 0 && (
        <p className="text-xs leading-relaxed text-ink-3">
          {unread} more of your posts {unread === 1 ? 'has' : 'have'} not been read in full yet.
        </p>
      )}
    </div>
  )
}
