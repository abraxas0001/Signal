import { useMemo } from 'react'
import { ArrowRight, ExternalLink, Newspaper, TriangleAlert } from 'lucide-react'
import type { Sentiment } from '@shared/taxonomy'
import { useStore } from '@/lib/store'
import { newsMentionsOf } from '@/lib/news-mentions'
import { Card } from '../ui'
import type { PersonaMention } from '../Persona'
import type { NewsItem } from '@/lib/briefing'

/**
 * "Local news mentions", on the dashboard.
 *
 * The short form of the Local News Mentions page: how many stories the papers
 * carried in the last seven days, how they were read, which mastheads carried
 * them, and the three most recent headlines. The long form is one press away.
 *
 * Every figure is a count of stories this desk actually had read. A desk that
 * has read nothing sees a card that says so and offers the way to fill it —
 * not a zero, which would read as "the papers wrote nothing about you".
 */

type Tone = 'positive' | 'negative' | 'neutral'

const TONE_LABEL: Record<Tone, string> = {
  positive: 'Positive',
  negative: 'Negative',
  neutral: 'Neutral',
}

const TONE_VAR: Record<Tone, { fg: string; soft: string }> = {
  positive: { fg: 'var(--pos)', soft: 'var(--pos-soft)' },
  negative: { fg: 'var(--neg)', soft: 'var(--neg-soft)' },
  neutral: { fg: 'var(--warn)', soft: 'var(--warn-soft)' },
}

function toneOf(mention: PersonaMention): Tone | null {
  if (mention.stance === 'supportive') return 'positive'
  if (mention.stance === 'critical') return 'negative'
  if (mention.stance === 'neutral') return 'neutral'
  const s: Sentiment | null = mention.sentiment
  if (s === 'Strong Positive' || s === 'Positive') return 'positive'
  if (s === 'Strong Negative' || s === 'Negative') return 'negative'
  if (s === 'Neutral') return 'neutral'
  return null
}

const stampOf = (x: PersonaMention): number => {
  const t = Date.parse(x.publishedAt ?? x.seenAt)
  return Number.isFinite(t) ? t : 0
}

export function LocalNewsGlance({
  news,
  suspect,
  onExplore,
}: {
  /**
   * The morning's stories, already ranked by the briefing.
   *
   * Ranked rather than merely recent: a story alleging something fabricated
   * outranks four routine mentions filed this morning. This is the reading
   * the dashboard's news section used before the revamp was reverted and the
   * card that showed it was deleted with it.
   */
  news: NewsItem[]
  /** Of those, the ones a reading flagged as suspected false. */
  suspect: NewsItem[]
  onExplore: () => void
}) {
  const store = useStore()

  const week = useMemo(() => {
    const cut = Date.now() - 7 * 86_400_000
    // Both shelves, as the full screen reads them: scanned mentions and the
    // stories the grievance desk filed.
    return newsMentionsOf(store, store.identity?.name ?? 'this desk')
      .filter((x) => stampOf(x) >= cut)
      .sort((a, b) => stampOf(b) - stampOf(a))
  }, [store])

  const counts = useMemo(() => {
    let positive = 0
    let negative = 0
    let neutral = 0
    for (const x of week) {
      const t = toneOf(x)
      if (t === 'positive') positive++
      else if (t === 'negative') negative++
      else if (t === 'neutral') neutral++
    }
    const sources = new Set(
      week.map((x) => (x.publisher ?? '').trim().toLowerCase()).filter(Boolean),
    )
    return { total: week.length, positive, negative, neutral, sources: sources.size }
  }, [week])

  const everRead = store.personaMentions.length > 0 || store.grievances.length > 0

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Newspaper size={17} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold tracking-[-0.015em]">Local news mentions</h2>
            <p className="mt-0.5 text-xs text-ink-3">
              {counts.total > 0
                ? `${counts.total} ${counts.total === 1 ? 'story' : 'stories'} in the last 7 days across ${counts.sources} ${counts.sources === 1 ? 'masthead' : 'mastheads'}`
                : everRead
                  ? 'No story in the last 7 days named anyone you track'
                  : 'What the papers are saying about you, your party and your seat'}
            </p>
          </div>
        </div>

        {counts.total > 0 && (
          <div className="flex shrink-0 gap-1.5">
            {(['positive', 'negative', 'neutral'] as Tone[]).map((t) => (
              <span
                key={t}
                className="tnum rounded-[var(--radius-pill)] px-2.5 py-1 text-[11px] font-bold"
                style={{ background: TONE_VAR[t].soft, color: TONE_VAR[t].fg }}
              >
                {counts[t]} {TONE_LABEL[t].toLowerCase()}
              </span>
            ))}
          </div>
        )}
      </div>

      {suspect.length > 0 && (
        <p className="mt-3 flex gap-2 rounded-[var(--radius-md)] bg-[var(--warn-soft)] p-2.5 text-[12px] leading-relaxed text-[var(--warn)]">
          <TriangleAlert size={14} className="mt-px shrink-0" aria-hidden />
          <span>
            {suspect.length} {suspect.length === 1 ? 'story is' : 'stories are'} flagged as
            suspected false. Answering those early is the whole game.
          </span>
        </p>
      )}

      {week.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          {everRead
            ? 'The papers this desk reads carried nothing naming the people you track this week. Older stories are on the full page.'
            : 'Nothing has been read yet. Add the people to watch on the People screen and run a check, and the stories the papers carry will be counted here.'}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--rule)]">
          {(news.length > 0 ? news.slice(0, 3).map((n) => n.mention) : week.slice(0, 3)).map((x) => {
            const t = toneOf(x)
            return (
              <li key={x.id} className="flex items-start gap-2.5 py-2.5">
                <span
                  className="mt-0.5 shrink-0 rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-bold"
                  style={
                    t
                      ? { background: TONE_VAR[t].soft, color: TONE_VAR[t].fg }
                      : { background: 'var(--surface-3)', color: 'var(--text-3)' }
                  }
                >
                  {t ? TONE_LABEL[t] : 'Not called'}
                </span>
                <span className="min-w-0 flex-1">
                  <a
                    href={x.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="group flex items-start gap-1.5"
                  >
                    <span className="line-clamp-2 text-[13px] font-semibold leading-snug group-hover:underline">
                      {x.headline}
                    </span>
                    <ExternalLink size={11} className="mt-1 shrink-0 text-ink-3" aria-hidden />
                  </a>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-3">
                    {x.publisher ?? 'Publisher not recorded'}
                    {x.place ? ` · ${x.place}` : ''}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={onExplore}
        className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--accent)]"
      >
        {week.length === 0 ? 'Open local news' : 'See all local news'}
        <ArrowRight size={14} aria-hidden />
      </button>
    </Card>
  )
}
