import { useMemo, useState } from 'react'
import { ArrowRight, AtSign, Flag, Hash, TriangleAlert, Users } from 'lucide-react'
import type { Identity } from '@shared/identity'
import type { IssueCluster } from '@shared/grievance'
import { Avatar, Card } from '../ui'
import { PlatformBadge } from '@/components/kit'
import { recurringTerms } from '@/lib/terms'
import { readStandingCache, type TrackedHandle } from '@/lib/handles'
import { cn } from '@/lib/utils'

/**
 * "Top Mentions in Comments" — the right card of the reference design's
 * second row: what turns up in the comments under this office's own posts,
 * read four ways.
 *
 *   People    — the politicians this desk already tracks, matched by name
 *   Party     — the parties on those accounts, plus the office's own
 *   Incidents — the issues on this desk's own grievance desk, by place
 *   Topics    — the words that simply recur, counted
 *
 * People and parties are matched against the desk's OWN roster rather than
 * against the open web, because a name match with nothing behind it is a
 * rumour, not a mention. Every count is a count of comments actually quoted
 * in a reading, and the card's subtitle says how many that is: the reference's
 * "1,245 mentions" is a picture, and a desk that read twenty-five comments has
 * to say twenty-five.
 */

type Lens = 'people' | 'party' | 'incidents' | 'topics'

const LENSES: { id: Lens; label: string; Icon: typeof Users }[] = [
  { id: 'people', label: 'People', Icon: Users },
  { id: 'party', label: 'Party', Icon: Flag },
  { id: 'incidents', label: 'Incidents', Icon: TriangleAlert },
  { id: 'topics', label: 'Topics', Icon: Hash },
]

interface Quote {
  text: string
  platform: string
  handle: string
}

interface Row {
  key: string
  label: string
  sub: string | null
  count: number
  sample: string
  avatarUrl: string | null
  platforms: string[]
}

/** The full name plus any word of it long enough to be distinctive. */
function needlesFor(name: string): string[] {
  const full = name.trim().toLowerCase()
  const words = full.split(/\s+/).filter((w) => w.replace(/[.]/g, '').length >= 4)
  return [full, ...words]
}

function matches(quotes: Quote[], needles: string[]): Quote[] {
  const lows = needles.map((n) => n.toLowerCase()).filter(Boolean)
  return quotes.filter((q) => lows.some((n) => q.text.toLowerCase().includes(n)))
}

function rowFrom(key: string, label: string, sub: string | null, hits: Quote[], avatarUrl: string | null): Row {
  return {
    key,
    label,
    sub,
    count: hits.length,
    sample: hits[0]?.text ?? '',
    avatarUrl,
    platforms: [...new Set(hits.map((h) => h.platform))],
  }
}

export function TopMentions({
  handles,
  identity,
  issues,
  onOpenAccounts,
}: {
  /** Own accounts supply the comments; watched accounts supply the roster. */
  handles: TrackedHandle[]
  identity: Identity | null
  /** The desk's own issues, for the Incidents lens. */
  issues: IssueCluster[]
  onOpenAccounts: () => void
}) {
  const [lens, setLens] = useState<Lens>('people')

  const quotes = useMemo<Quote[]>(() => {
    const out: Quote[] = []
    for (const h of handles) {
      if (!h.own) continue
      const st = readStandingCache(h.id)
      if (!st || st.source === 'record') continue
      const who = h.displayName ?? h.handle
      for (const text of [...st.praise, ...st.criticism]) {
        out.push({ text, platform: h.platform, handle: who })
      }
    }
    return out
  }, [handles])

  const rows = useMemo<Row[]>(() => {
    if (quotes.length === 0) return []

    if (lens === 'people') {
      const seen = new Map<string, { name: string; avatarUrl: string | null; party: string | null }>()
      for (const h of handles) {
        if (h.own) continue
        const name = h.displayName?.trim()
        if (!name) continue
        const k = name.toLowerCase()
        const prev = seen.get(k)
        if (!prev) seen.set(k, { name, avatarUrl: h.avatarUrl ?? null, party: h.label ?? null })
        else if (!prev.avatarUrl && h.avatarUrl) prev.avatarUrl = h.avatarUrl
      }
      return [...seen.values()]
        .map((p) => rowFrom(p.name, p.name, p.party, matches(quotes, needlesFor(p.name)), p.avatarUrl))
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
    }

    if (lens === 'party') {
      const parties = new Set<string>()
      for (const h of handles) if (h.label?.trim()) parties.add(h.label.trim())
      if (identity?.party) parties.add(identity.party)
      return [...parties]
        .map((p) => rowFrom(p, p, null, matches(quotes, [p]), null))
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
    }

    if (lens === 'incidents') {
      /* An "incident" this desk can name is one already on its grievance
         desk. Matched on the place, which is the word a constituent would
         actually type in a comment — the issue's own title carries the
         topic, which is our vocabulary rather than theirs. */
      const seen = new Map<string, IssueCluster>()
      for (const i of issues) {
        // An issue's places are the words a constituent would actually type;
        // its title carries our topic vocabulary, not theirs.
        for (const place of [i.constituency, ...i.places]) {
          const p = (place ?? '').trim()
          if (p && !seen.has(p.toLowerCase())) seen.set(p.toLowerCase(), i)
        }
      }
      return [...seen.entries()]
        .map(([place, i]) =>
          rowFrom(`${i.id}:${place}`, place, i.category, matches(quotes, [place]), null),
        )
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
    }

    const terms = recurringTerms(quotes.map((q) => q.text), 6) ?? []
    return terms
      .map((t) => rowFrom(t, t, null, matches(quotes, [t]), null))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count)
  }, [lens, quotes, handles, identity, issues])

  const empty: Record<Lens, string> = {
    people: 'None of the people you track are named in the comments read so far.',
    party: 'No party is named in the comments read so far.',
    incidents: 'No issue from your grievance desk is named in the comments read so far.',
    topics: 'No word recurs across the comments read so far.',
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="min-w-0">
        <h2 className="text-[17px] font-bold tracking-[-0.015em]">Top mentions in comments</h2>
        <p className="mt-0.5 text-xs text-ink-3">
          {quotes.length > 0
            ? `Counted across ${quotes.length} praising and critical comments quoted in your readings`
            : 'No comments have been read on your accounts yet'}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {LENSES.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setLens(id)}
            aria-pressed={lens === id}
            className={cn(
              'inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 text-xs font-semibold transition-colors',
              lens === id
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--border)] bg-[var(--surface-2)] text-ink-2 hover:border-[var(--border-interactive)]',
            )}
          >
            <Icon size={13} aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-ink-2">{empty[lens]}</p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--rule)]">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-3 py-3">
              {lens === 'people' ? (
                <Avatar src={r.avatarUrl} name={r.label} size={38} />
              ) : (
                <span
                  className="icon-badge shrink-0"
                  style={{ background: 'var(--accent-2-soft)', color: 'var(--accent-2)' }}
                >
                  <AtSign size={16} aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{r.label}</p>
                <p className="tnum mt-0.5 text-xs text-ink-3">
                  {r.count} {r.count === 1 ? 'comment' : 'comments'}
                  {r.sub ? ` · ${r.sub}` : ''}
                </p>
              </div>
              {/* The reference links each row to the post the mention sat
                  under. A reading quotes the comment, not the permalink it
                  came from, so the row names the platform it was read on and
                  shows the comment itself instead of linking somewhere the
                  desk cannot actually point. */}
              {/* The quote sits BESIDE the badges rather than over them:
                  stacked and right-aligned, the badge row rode up onto the
                  end of the quote and read as part of the sentence. */}
              <div className="hidden min-w-0 max-w-[46%] items-center gap-2.5 sm:flex">
                {r.sample && (
                  <p className="line-clamp-1 min-w-0 text-right text-xs text-ink-3">
                    &ldquo;{r.sample}&rdquo;
                  </p>
                )}
                <span className="flex shrink-0 -space-x-1.5">
                  {r.platforms.slice(0, 4).map((p) => (
                    <PlatformBadge
                      key={p}
                      platform={p}
                      size={18}
                      className="ring-2 ring-[var(--surface)]"
                    />
                  ))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onOpenAccounts}
        className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--accent)]"
      >
        View all mentions
        <ArrowRight size={14} aria-hidden />
      </button>
    </Card>
  )
}
