import { useMemo, useState } from 'react'
import { AtSign } from 'lucide-react'
import { Avatar, Card } from '../ui'
import { CardHead, PillTabs, PlatformBadge } from '@/components/kit'
import { recurringTerms } from '@/lib/terms'
import { readStandingCache, type TrackedHandle } from '@/lib/handles'
import type { Identity } from '@shared/identity'

/**
 * Who and what turns up in the comments under this office's own posts.
 *
 * Three lenses over ONE body of text: the comments quoted in the latest
 * opinion readings. People are matched against the desk's own watch roster —
 * the politicians this office already tracks — because a name match against
 * the open web would be guesswork, and a mention board that guesses is a
 * rumour mill. Parties are matched against the party tags on the same roster.
 * Topics are plain recurring-word counting, by the same tokenizer the compare
 * screen uses.
 *
 * Every count is a count of QUOTED comments, and the sub line says so. The
 * readings quote a sample, not the full comment stream; a board that said
 * "1,245 mentions" off thirty quotes would be inventing a scale.
 */

type Lens = 'people' | 'party' | 'topics'

interface MentionRow {
  key: string
  label: string
  count: number
  sample: string
  avatarUrl?: string | null
  platforms: string[]
}

interface QuoteRecord {
  text: string
  platform: string
}

/** Match tokens for a person: the full name plus any distinctive word of it. */
function tokensOf(name: string): string[] {
  const full = name.trim().toLowerCase()
  const words = full.split(/\s+/).filter((w) => w.replace(/\./g, '').length >= 4)
  return [full, ...words]
}

function rowsFor(
  lens: Lens,
  quotes: QuoteRecord[],
  people: { name: string; avatarUrl: string | null }[],
  parties: string[],
): MentionRow[] {
  const count = (needles: string[]): { hits: QuoteRecord[] } => {
    const lows = needles.map((n) => n.toLowerCase())
    return { hits: quotes.filter((q) => lows.some((n) => q.text.toLowerCase().includes(n))) }
  }

  if (lens === 'people') {
    return people
      .map((p) => {
        const { hits } = count(tokensOf(p.name))
        return {
          key: p.name,
          label: p.name,
          count: hits.length,
          sample: hits[0]?.text ?? '',
          avatarUrl: p.avatarUrl,
          platforms: [...new Set(hits.map((h) => h.platform))],
        }
      })
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  }

  if (lens === 'party') {
    return parties
      .map((party) => {
        const { hits } = count([party])
        return {
          key: party,
          label: party,
          count: hits.length,
          sample: hits[0]?.text ?? '',
          platforms: [...new Set(hits.map((h) => h.platform))],
        }
      })
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  }

  const terms = recurringTerms(quotes.map((q) => q.text), 6) ?? []
  return terms
    .map((term) => {
      const { hits } = count([term])
      return {
        key: term,
        label: term,
        count: hits.length,
        sample: hits[0]?.text ?? '',
        platforms: [...new Set(hits.map((h) => h.platform))],
      }
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
}

export function TopMentions({
  handles,
  identity,
}: {
  /** The whole tracked list: own accounts supply the quotes, watched ones the roster. */
  handles: TrackedHandle[]
  identity: Identity | null
}) {
  const [lens, setLens] = useState<Lens>('people')

  const quotes = useMemo<QuoteRecord[]>(() => {
    const out: QuoteRecord[] = []
    for (const h of handles) {
      if (!h.own) continue
      const st = readStandingCache(h.id)
      if (!st || st.source === 'record') continue
      for (const text of [...st.praise, ...st.criticism]) out.push({ text, platform: h.platform })
    }
    return out
  }, [handles])

  const people = useMemo(() => {
    const seen = new Map<string, { name: string; avatarUrl: string | null }>()
    for (const h of handles) {
      if (h.own) continue
      const name = h.displayName?.trim()
      if (!name) continue
      const key = name.toLowerCase()
      if (!seen.has(key)) seen.set(key, { name, avatarUrl: h.avatarUrl ?? null })
      else if (!seen.get(key)!.avatarUrl && h.avatarUrl) seen.get(key)!.avatarUrl = h.avatarUrl
    }
    return [...seen.values()]
  }, [handles])

  const parties = useMemo(() => {
    const set = new Set<string>()
    for (const h of handles) if (h.label?.trim()) set.add(h.label.trim())
    if (identity?.party) set.add(identity.party)
    return [...set]
  }, [handles, identity])

  const rows = useMemo(() => rowsFor(lens, quotes, people, parties), [lens, quotes, people, parties])

  if (quotes.length === 0) return null

  return (
    <Card>
      <CardHead
        icon={<AtSign size={16} aria-hidden />}
        tint="pink"
        title="Turning up in your comments"
        sub={`Counted across the ${quotes.length} comments quoted in your latest readings`}
        action={
          <PillTabs<Lens>
            tabs={[
              { id: 'people', label: 'People' },
              { id: 'party', label: 'Party' },
              { id: 'topics', label: 'Topics' },
            ]}
            active={lens}
            onChange={setLens}
          />
        }
      />

      {rows.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-2">
          {lens === 'people'
            ? 'None of the people you track are named in the quoted comments.'
            : lens === 'party'
              ? 'No party is named in the quoted comments.'
              : 'No word recurs across the quoted comments.'}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--rule)]">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              {lens === 'people' ? (
                <Avatar src={r.avatarUrl ?? null} name={r.label} size={34} />
              ) : (
                <span
                  className="icon-badge icon-badge-sm shrink-0"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <AtSign size={14} aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="truncate text-sm font-semibold">{r.label}</span>
                  <span className="tnum text-xs text-ink-3">
                    {r.count} {r.count === 1 ? 'comment' : 'comments'}
                  </span>
                </p>
                {r.sample && (
                  <p className="mt-0.5 line-clamp-1 text-xs text-ink-3">&ldquo;{r.sample}&rdquo;</p>
                )}
              </div>
              <span className="flex shrink-0 -space-x-1.5">
                {r.platforms.slice(0, 3).map((p) => (
                  <PlatformBadge key={p} platform={p} size={18} className="ring-2 ring-[var(--surface)]" />
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
