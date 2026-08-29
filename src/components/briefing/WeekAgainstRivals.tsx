import { useMemo } from 'react'
import { ScanEye, Swords } from 'lucide-react'
import { Avatar, Button, Card } from '../ui'
import { CardHead, HBarBoard } from '@/components/kit'
import type { TrackedHandle } from '@/lib/handles'
import type { LandsReading, LandsFinding } from '@/lib/briefing'
import { FORMAT_IMAGE } from '@/lib/briefing'
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
  onExplore,
}: {
  /** Every tracked handle — the office's own AND the watched rivals. */
  handles: TrackedHandle[]
  lands: LandsReading
  /** Open the full analysis page. */
  onExplore: () => void
}) {
  const week = useMemo(() => weekOf(handles), [handles])
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
          rows={week.rows.slice(0, 5).map((r) => ({
            label: r.name,
            sublabel: `${r.posts} ${r.posts === 1 ? 'post' : 'posts'} this week`,
            value: r.reactions,
            lead: <Avatar src={r.avatarUrl} name={r.name} size={38} />,
            emphasis: r.own,
          }))}
          formatValue={(n) => compact(Math.round(n))}
        />
      </div>
    </Card>
  )
}
