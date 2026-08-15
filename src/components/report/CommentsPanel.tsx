import * as m from 'motion/react-m'
import { MessageSquare } from 'lucide-react'
import type { Report } from '@shared/types'
import { Card, Chip, SectionTitle, type ChipTone } from '../ui'
import { fadeUp } from '@/lib/motion'

/**
 * What the audience made of it.
 *
 * This is a reading, not a transcript. Listing a hundred comments hands the
 * reader the raw material and asks them to do the work — which is the job this
 * product exists to do for them. So the panel leads with the conclusion, backs
 * it with the three most-liked comments as evidence, and leaves the full set to
 * the spreadsheet, where it can be sorted and filtered.
 *
 * Shown on both the full report and the figures-only one. On the deployed site
 * the analysis can run out of time, and a panel that lived only on the full
 * report would hide the comments in the case where they are the only
 * interpretation available.
 */

const NARRATIVE_TONE: Record<string, ChipTone> = {
  Happy: 'positive',
  Agreed: 'positive',
  Divided: 'warning',
  Resentment: 'negative',
  Outraged: 'negative',
}

export function CommentsPanel({ report }: { report: Report }) {
  const { snapshot, analysis } = report
  const comments = snapshot.comments ?? []
  if (!comments.length) return null

  const total = snapshot.engagement.comments.value
  const read = comments.length
  const narrative = analysis?.sentiment.publicNarrative ?? null
  // Most-liked first — the same order the analysis weighed them in.
  const top = [...comments].sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0)).slice(0, 3)

  return (
    <m.section variants={fadeUp} className="defer-paint">
      <SectionTitle
        hint={
          total != null && total > read
            ? `Read from the ${read} comments ${snapshot.platform} publishes without a login, of ${total.toLocaleString('en-IN')}.`
            : `Read from all ${read} comment${read === 1 ? '' : 's'} on this post.`
        }
      >
        What people made of it
      </SectionTitle>

      <Card>
        {narrative ? (
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={NARRATIVE_TONE[narrative] ?? 'neutral'} icon={<MessageSquare size={12} />}>
              {narrative}
            </Chip>
            <span className="text-xs text-ink-3">the mood in the replies</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="neutral" icon={<MessageSquare size={12} />}>
              {read} comments read
            </Chip>
            <span className="text-xs text-ink-3">not yet interpreted</span>
          </div>
        )}

        {/* The rationale is where the model says what the comments actually
            argued, which is the sentence worth reading. */}
        {analysis?.sentiment.rationale && (
          <p className="mt-3 text-sm text-ink-1">{analysis.sentiment.rationale}</p>
        )}

        <p className="mt-4 text-xs uppercase tracking-wide text-ink-3">Most-liked comments</p>
        <ul className="mt-2 space-y-2.5">
          {top.map((c, i) => (
            <li key={i} className="border-l-2 border-[var(--border)] pl-3">
              <p
                className="text-sm text-ink-1"
                lang={snapshot.content.languageCode ?? undefined}
              >
                {c.text.length > 220 ? `${c.text.slice(0, 220)}…` : c.text}
              </p>
              <p className="mt-0.5 text-xs text-ink-3">
                {c.author ?? 'Someone'}
                {c.likes != null && c.likes > 0 && ` · ${c.likes.toLocaleString('en-IN')} likes`}
              </p>
            </li>
          ))}
        </ul>

        {read > top.length && (
          <p className="mt-3 text-xs text-ink-3">
            All {read} are in the exported spreadsheet, on their own sheet.
          </p>
        )}
      </Card>
    </m.section>
  )
}
