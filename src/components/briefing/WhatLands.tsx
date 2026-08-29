import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { Card } from '../ui'
import type { LandsReading } from '@/lib/briefing'

/**
 * What lands and what does not, as two short lists with the arithmetic that
 * earned each entry printed under it. The computation lives in
 * `whatLandsOf` (src/lib/briefing.ts); this only draws its findings.
 *
 * Below five measured posts the card says so instead of forcing a claim. A
 * pattern read off three dots is not a pattern, and this product's standing
 * rests on refusing to pretend otherwise.
 */
export function WhatLandsCard({ lands }: { lands: LandsReading }) {
  if (lands.thin) {
    return (
      <Card>
        <p className="text-[15px] font-bold">Too few measured posts to say what lands</p>
        <p className="tnum mt-1.5 text-sm leading-relaxed text-ink-2">
          {lands.measuredPosts} of 5 posts measured.
        </p>
      </Card>
    )
  }

  const empty = lands.working.length === 0 && lands.notLanding.length === 0

  return (
    <Card>
      {/* The reactions sentence renders only when the figure exists. It used
          to substitute a dash into the prose when typicalReactions was null,
          which read as a broken sentence rather than as an absent number. */}
      <p className="text-sm leading-relaxed text-ink-2">
        {lands.measuredPosts} posts measured
        {lands.readPosts > 0 ? ` · ${lands.readPosts} read in full` : ''}
        {lands.typicalReactions != null
          ? ` · typical post ${lands.typicalReactions.toLocaleString('en-IN')} reactions`
          : ''}
      </p>

      {empty ? (
        <p className="mt-3 border-t border-[var(--rule)] pt-3 text-sm leading-relaxed text-ink-2">
          No clear pattern yet.
        </p>
      ) : (
        <div className="mt-4 grid gap-x-8 gap-y-4 border-t border-[var(--rule)] pt-4 sm:grid-cols-2">
          {lands.working.length > 0 && (
            <div>
              <p className="kicker flex items-center gap-1.5 text-[var(--pos)]">
                <ThumbsUp size={12} aria-hidden />
                Working for you
              </p>
              <ul className="mt-2 space-y-2.5">
                {lands.working.map((f) => (
                  <li key={`${f.kind}-${f.label}`}>
                    <p className="text-sm font-semibold leading-snug">{f.label}</p>
                    <p className="tnum mt-0.5 text-xs leading-relaxed text-ink-3">{f.evidence}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {lands.notLanding.length > 0 && (
            <div>
              <p className="kicker flex items-center gap-1.5 text-[var(--neg)]">
                <ThumbsDown size={12} aria-hidden />
                Not landing
              </p>
              <ul className="mt-2 space-y-2.5">
                {lands.notLanding.map((f) => (
                  <li key={`${f.kind}-${f.label}`}>
                    <p className="text-sm font-semibold leading-snug">{f.label}</p>
                    <p className="tnum mt-0.5 text-xs leading-relaxed text-ink-3">{f.evidence}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
