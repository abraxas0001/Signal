import { useEffect, useMemo, useState } from 'react'
import { ScanEye, Swords } from 'lucide-react'
import { Avatar, Button, Card } from '../ui'
import { CardHead, HBarBoard } from '@/components/kit'
import type { TrackedHandle } from '@/lib/handles'
import type { Report } from '@shared/types'
import type { LandsReading, LandsFinding } from '@/lib/briefing'
import { FORMAT_IMAGE } from '@/lib/briefing'
import { loadPostReports } from '@/lib/post-reports'
import { weekOf } from '@/lib/week'
import { compact } from '@/lib/utils'

/**
 * The week, scored: what the office posted against what its rivals posted,
 * who drew more reaction, and the one change most likely to close the gap.
 * The close reading — what each rival actually posted, why their best post
 * carried the week, what to copy — lives on its own page behind Explore,
 * where it has the room those answers need.
 */

/** The one change most likely to move the needle, from the lands arithmetic. */
function adviceOf(lands: LandsReading): string | null {
  const best = lands.working[0]
  if (!best) return null
  const x = `${Math.round(best.value * 10) / 10}x your typical post`
  const line = (f: LandsFinding): string => {
    if (f.kind === 'platform') return `Post more on ${f.label}: ${x}.`
    if (f.kind === 'topic') return `Say more about ${f.label}.`
    return f.label === FORMAT_IMAGE
      ? `Lead with a picture or a video: ${x}.`
      : `Write more text posts: ${x}.`
  }
  return line(best)
}

export function WeekAgainstRivals({
  handles,
  lands,
  reports,
  onExplore,
}: {
  /** Every tracked handle: the office's own AND the watched rivals. */
  handles: TrackedHandle[]
  lands: LandsReading
  /**
   * The stored full readings, which carry the publication dates the listing
   * scrape did not. See `weekOf`: without them this card counted only the
   * Twitter/X half of everybody's week and named the wrong leader on the
   * Rahul and Modi desks.
   */
  reports?: Map<string, Report> | null
  /** Open the full analysis page. */
  onExplore: () => void
}) {
  /**
   * The reports map from the dashboard when it hands one over, and otherwise
   * fetched here.
   *
   * Not a second copy: `loadPostReports` caches the file at module level, so
   * this resolves off the same map the dashboard already loaded. The card
   * cannot simply do without it, because the verdict computed from the listing
   * dates alone is not a cautious verdict, it is a different one.
   */
  const [loaded, setLoaded] = useState<Map<string, Report> | null>(null)
  useEffect(() => {
    if (reports !== undefined) return
    let alive = true
    loadPostReports().then(
      (map) => {
        if (alive) setLoaded(map)
      },
      () => {
        if (alive) setLoaded(new Map())
      },
    )
    return () => {
      alive = false
    }
  }, [reports])
  const dated = reports === undefined ? loaded : reports

  const week = useMemo(() => weekOf(handles, dated), [handles, dated])
  if (!week) return null

  const leader = week.rows[0]!
  const you = week.rows.find((r) => r.own)!
  const verdict = leader.own
    ? `You lead this week: ${compact(you.reactions)} reactions on ${you.posts} ${you.posts === 1 ? 'post' : 'posts'}.`
    : `${leader.name} leads this week: ${compact(leader.reactions)} reactions on ${leader.posts} ${leader.posts === 1 ? 'post' : 'posts'}. You: ${compact(you.reactions)} on ${you.posts}.`
  const advice = leader.own ? null : adviceOf(lands)

  return (
    <Card className="p-4 sm:p-6">
      <CardHead
        icon={<Swords size={16} aria-hidden />}
        tint="violet"
        title="Your week against theirs"
        sub={week.label}
        action={
          <Button size="sm" variant="outline" onClick={onExplore}>
            <ScanEye size={14} />
            Explore
          </Button>
        }
      />

      <p className="text-[15px] font-bold leading-snug">{verdict}</p>
      {advice && <p className="tnum mt-1 text-sm leading-relaxed text-ink-2">{advice}</p>}

      <div className="mt-4">
        <HBarBoard
          rows={week.rows
            .filter((r): r is typeof r & { reactions: number } => r.reactions != null)
            .slice(0, 5)
            .map((r) => ({
              label: r.name,
              sublabel: `${r.reactions.toLocaleString('en-IN')} on ${r.postsWithReactions} of ${r.posts} ${r.posts === 1 ? 'post' : 'posts'}`,
              value: r.reactions,
              lead: <Avatar src={r.avatarUrl} name={r.name} size={38} />,
              emphasis: r.own,
            }))}
          formatValue={(n) => compact(Math.round(n))}
        />
        {week.rows.some((r) => r.reactions == null) && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
            {week.rows.filter((r) => r.reactions == null).length} of these accounts are not on the
            board: the platforms they posted on published no like, comment or share figure this
            week, and a bar of zero would say they were ignored rather than unmeasured.
          </p>
        )}
        {/* WHAT THIS WEEK COULD NOT SEE, ON THE CARD.
            A post with no publication date anywhere sits in no week, so it is
            in nobody's total here. That used to be silent, and silence on a
            board that names a winner reads as completeness: on this desk it
            hid most of Facebook, where the collector reads no date at all. */}
        {week.undated > 0 && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
            {week.undated.toLocaleString('en-IN')} stored{' '}
            {week.undated === 1 ? 'post carries' : 'posts carry'} no publication date, in the
            listing or in its full reading, so {week.undated === 1 ? 'it sits' : 'they sit'} in no
            week and {week.undated === 1 ? 'is' : 'are'} counted for nobody above.
          </p>
        )}
      </div>
    </Card>
  )
}
