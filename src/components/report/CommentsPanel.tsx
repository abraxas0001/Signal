import * as m from 'motion/react-m'
import type { PostSnapshot } from '@shared/types'
import { Card, SectionTitle } from '../ui'
import { fadeUp } from '@/lib/motion'

/**
 * What the audience actually said.
 *
 * Shown on both the full report and the figures-only one. That is not a
 * convenience: on the deployed site the analysis often runs out of time and the
 * figures-only report is what a user sees, so a panel that lived only on the
 * full report would hide the comments in exactly the case where they are the
 * only interpretation available.
 */
export function CommentsPanel({ snapshot }: { snapshot: PostSnapshot }) {
  const comments = snapshot.comments ?? []
  if (!comments.length) return null

  const total = snapshot.engagement.comments.value
  const read = comments.length

  return (
    <m.section variants={fadeUp} className="defer-paint">
      <SectionTitle>What people said</SectionTitle>
      <Card>
        {/* The gap between what we read and what exists is the whole honesty of
            this panel. Facebook serves two comments on a reel with 361; showing
            those two unqualified would present a sample as the public reaction. */}
        <p className="text-xs text-ink-3">
          {total != null && total > read
            ? `The ${read} below are the comments ${snapshot.platform} publishes without a login, out of ${total.toLocaleString('en-IN')}. A sample, not the whole reaction.`
            : `All ${read} comment${read === 1 ? '' : 's'} on this post.`}
        </p>
        <ul className="mt-3 space-y-3">
          {comments.slice(0, 12).map((c, i) => (
            <li key={i} className="border-l-2 border-[var(--border)] pl-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs font-medium text-ink-2">{c.author ?? 'Someone'}</span>
                {c.likes != null && c.likes > 0 && (
                  <span className="text-xs text-ink-3">
                    {c.likes.toLocaleString('en-IN')} likes
                  </span>
                )}
              </div>
              <p
                className="mt-0.5 whitespace-pre-wrap text-sm text-ink-1"
                lang={snapshot.content.languageCode ?? undefined}
              >
                {c.text}
              </p>
            </li>
          ))}
        </ul>
        {read > 12 && (
          <p className="mt-3 text-xs text-ink-3">
            {read - 12} more in the exported spreadsheet.
          </p>
        )}
      </Card>
    </m.section>
  )
}
