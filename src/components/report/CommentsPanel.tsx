import * as m from 'motion/react-m'
import { MessageSquare } from 'lucide-react'
import type { Report } from '@shared/types'
import { Card, Chip, SectionTitle, type ChipTone } from '../ui'
import { fadeUp } from '@/lib/motion'
import { cleanQuote } from '@/lib/utils'

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
  /*
   * Comments, not stored rows.
   *
   * The scraper reads text nodes, so Instagram's per-comment age chips ("2 d",
   * "19 h") and its verified badges ("m_k_krishna_bjpVerified") arrive stored
   * alongside the comments. `cleanQuote` reduces a row that is nothing but
   * that furniture to an empty string, which is how the rest of the desk drops
   * them. Counting them here made this panel claim ten comments on reel
   * DaApzwuOb-p, where Instagram published seven and seven is what it holds,
   * and a badge row could be quoted back to the office as somebody's words.
   */
  const comments = (snapshot.comments ?? [])
    .map((c) => ({ ...c, text: cleanQuote(c.text ?? '') }))
    .filter((c) => c.text.length > 0)
  if (!comments.length) return null

  const total = snapshot.engagement.comments.value
  const read = comments.length
  const narrative = analysis?.sentiment.publicNarrative ?? null
  // Most-liked first — the same order the analysis weighed them in.
  const top = [...comments].sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0)).slice(0, 3)

  return (
    <m.section variants={fadeUp} className="defer-paint">
      <SectionTitle
        /*
         * FOUR THINGS CAN BE TRUE, AND ONLY ONE OF THEM IS "all".
         *
         * This guarded the direction `total > read` alone and let everything
         * else fall through to the word "all", so wherever the desk holds
         * MORE rows than the platform published it asserted completeness
         * against the larger of two numbers that disagree. On the demo desk
         * that is five of D. K. Aruna's own posts, the sharpest being
         * x.com/Aruna_DK/status/2093993831758708747: four comments stored,
         * a published reply count of nought, and a hint reading "Read from
         * all 4 comments on this post". A reply the platform counts in a
         * thread rather than on the post, a comment hidden since the read and
         * a figure the platform rounds all land on that side. Saying both
         * numbers is the only honest answer.
         *
         * A post the platform published no count for at all is a fourth case
         * and not a match: unknown is not agreement, so it does not get to
         * borrow the word "all" either.
         */
        hint={
          total == null
            ? `Read from the ${read} comment${read === 1 ? '' : 's'} stored on this post. ${snapshot.platform} publishes no comment count to check that against.`
            : total > read
              ? `${read} of ${total.toLocaleString('en-IN')} comments read.`
              : read > total
                ? `${read} comment${read === 1 ? '' : 's'} stored here and all of ${read === 1 ? 'it' : 'them'} read. ${snapshot.platform} publishes a comment count of ${total.toLocaleString('en-IN')}, fewer than the desk holds.`
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
            All {read} in the export.
          </p>
        )}
      </Card>
    </m.section>
  )
}
