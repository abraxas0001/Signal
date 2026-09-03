import { useMemo, useState } from 'react'
import { ArrowRight, AtSign, ExternalLink, Flag, Hash, TriangleAlert, Users } from 'lucide-react'
import type { Identity } from '@shared/identity'
import type { IssueCluster } from '@shared/grievance'
import { Avatar, Card } from '../ui'
import { PlatformBadge } from '@/components/kit'
import { NON_TOPIC, recurringTerms } from '@/lib/terms'
import { audienceOf, ownNames } from '@/lib/audience'
import { InfoMark } from './controls'
import { type TrackedHandle } from '@/lib/handles'
import type { Report } from '@shared/types'
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
  /** Which side the reading put it on, or null when nothing scored it. */
  side: 'positive' | 'neutral' | 'negative' | null
  /** The post it sits under, where the reading recorded which one. */
  postUrl: string | null
}

interface Row {
  key: string
  label: string
  sub: string | null
  count: number
  sample: string
  /**
   * The permalink of the post the sample comment sits under.
   *
   * The office's reason for wanting it: "the user should redirect to that post
   * and he can manually verify that, yes, these mentions were there so that we
   * can verify our platform is extracting the correct data." Null where the
   * quote came from an account-level reading, which does not record which post
   * each comment was on; the row then shows no link rather than a wrong one.
   */
  sampleUrl: string | null
  avatarUrl: string | null
  platforms: string[]
  /** How the comments naming this were read. Unscored ones are in none. */
  positive: number
  negative: number
  neutral: number
}

/** Lowercased word tokens of a name, punctuation stripped. */
function tokensOf(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4)
}

/**
 * The needles for one person, given everyone else on the roster.
 *
 * A SURNAME IS NOT A NEEDLE WHEN THE ROSTER SHARES IT. The desk watches
 * "A. Revanth Reddy", "Manne Srinivas Reddy" and "Challa Vamshi Chand Reddy",
 * and a single comment reading "Reddy garu bagunnara" was being counted once
 * for each of the three — three rows, three identical quotes, one comment. A
 * token that more than one tracked person answers to identifies nobody, so it
 * is dropped and only the full name will match for those people.
 *
 * Returns null when nothing distinctive survives, so the caller can leave the
 * person off rather than show a count built from an ambiguous word.
 */
function needlesFor(name: string, roster: string[]): string[] {
  const full = name.trim().toLowerCase()
  const shared = new Set<string>()
  const owners = new Map<string, number>()
  for (const other of roster) {
    for (const t of new Set(tokensOf(other))) owners.set(t, (owners.get(t) ?? 0) + 1)
  }
  for (const [t, n] of owners) if (n > 1) shared.add(t)
  const distinctive = tokensOf(name).filter((t) => !shared.has(t))
  return [full, ...distinctive]
}

/**
 * Comments containing one of the needles, matched on WORD BOUNDARIES.
 *
 * `includes` matched "reddy" inside unrelated words and, worse, matched a
 * needle anywhere in a name that belonged to somebody else entirely.
 */
function matches(quotes: Quote[], needles: string[]): Quote[] {
  const lows = needles.map((n) => n.toLowerCase()).filter(Boolean)
  if (lows.length === 0) return []
  return quotes.filter((q) => {
    const hay = ` ${q.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `
    return lows.some((n) => hay.includes(` ${n.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `))
  })
}

/**
 * The row's colour, from how its comments were read.
 *
 * Grey where nothing was scored, which is a real third state and not a
 * neutral reading: an unscored comment has no side, and colouring it amber
 * would claim a verdict the reader never made.
 */
function toneStyle(r: { positive: number; negative: number; neutral: number }): {
  background: string
  color: string
} {
  if (r.positive + r.negative + r.neutral === 0)
    return { background: 'var(--surface-3)', color: 'var(--text-3)' }
  if (r.positive > r.negative) return { background: 'var(--pos-soft)', color: 'var(--pos)' }
  if (r.negative > r.positive) return { background: 'var(--neg-soft)', color: 'var(--neg)' }
  return { background: 'var(--warn-soft)', color: 'var(--warn)' }
}

function rowFrom(key: string, label: string, sub: string | null, hits: Quote[], avatarUrl: string | null): Row {
  let positive = 0
  let negative = 0
  let neutral = 0
  for (const h of hits) {
    if (h.side === 'positive') positive++
    else if (h.side === 'negative') negative++
    else if (h.side === 'neutral') neutral++
  }
  return {
    key,
    label,
    sub,
    count: hits.length,
    sample: hits[0]?.text ?? '',
    // The first hit that actually knows its post, so a row is linkable
    // whenever ANY of its comments came from a post reading.
    sampleUrl: hits.find((h) => h.postUrl)?.postUrl ?? null,
    avatarUrl,
    platforms: [...new Set(hits.map((h) => h.platform))],
    positive,
    negative,
    neutral,
  }
}

export function TopMentions({
  handles,
  identity,
  issues,
  reports,
  onOpenAudience,
}: {
  /** Own accounts supply the comments; watched accounts supply the roster. */
  handles: TrackedHandle[]
  identity: Identity | null
  /** The desk's own issues, for the Incidents lens. */
  issues: IssueCluster[]
  /** The stored readings, which is where the comments actually live. */
  reports: Map<string, Report> | null
  /** Opens the comments screen. This card is about comments, not accounts. */
  onOpenAudience: () => void
}) {
  const [lens, setLens] = useState<Lens | null>(null)

  /**
   * Every comment the desk holds, not the handful of themes a survey cached.
   *
   * This card used to read `readStandingCache`, which stores only the praise
   * and criticism THEMES a standing survey wrote — a dozen phrases, already
   * summarised. The office reported it exactly: "top mentions in comments
   * need to contain all the comments". `audienceOf` is the module that
   * actually holds them, every comment the readings quoted or the posts
   * stored, each carrying the side the reading put it on.
   */
  const model = useMemo(() => audienceOf(handles, reports), [handles, reports])

  const quotes = useMemo<Quote[]>(
    () =>
      model.quotes.map((q) => ({
        text: q.text,
        platform: q.platform,
        handle: q.handle,
        side: q.side,
        postUrl: q.postUrl,
      })),
    [model.quotes],
  )

  /**
   * What is not a topic on this desk.
   *
   * The office reported it plainly: "jai, aruna aka these are not topics".
   * Three families of word were reaching the Topics lens and none of them is
   * a subject: slogans and address terms (NON_TOPIC), the people this desk
   * tracks — who have their own People lens — and the parties, which have a
   * Party lens. A word that already has a lens of its own must not also be
   * offered as a topic, or the same fact is counted twice under two names.
   */
  const topicStop = useMemo(() => {
    const out = new Set(NON_TOPIC)
    for (const w of ownNames(handles)) out.add(w)
    const feed = (value: string | null | undefined): void => {
      for (const raw of (value ?? '').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u)) {
        if (raw.length >= 2) out.add(raw)
      }
    }
    for (const h of handles) {
      feed(h.displayName)
      feed(h.handle)
      feed(h.label)
    }
    feed(identity?.name)
    feed(identity?.party)
    feed(identity?.constituency)
    feed(identity?.district)
    // Places have their own Incidents lens, so a mandal surfacing under
    // Topics is the same fact counted twice — "gadwal" is where, not what.
    for (const issue of issues) {
      feed(issue.constituency)
      for (const place of issue.places) feed(place)
    }
    return out
  }, [handles, identity, issues])

  const rowsFor = useMemo(() => (lens: Lens): Row[] => {
    if (quotes.length === 0) return []

    if (lens === 'people') {
      /**
       * THE DESK'S OWN PEOPLE COUNT TOO.
       *
       * This skipped `h.own`, on the reasoning that an office knows the
       * comments under its own posts are about it. But the lens asks who
       * commenters NAME, and on these accounts the answer is overwhelmingly
       * the member herself — so excluding her left the card reading "None of
       * the people you track are named" beneath a heading counting 47
       * comments, which is not what the desk holds. She is included and marked
       * as the desk's own, and the rivals still rank beside her on the count.
       */
      const seen = new Map<
        string,
        { name: string; avatarUrl: string | null; party: string | null; own: boolean }
      >()
      for (const h of handles) {
        const name = h.displayName?.trim()
        if (!name) continue
        const k = name.toLowerCase()
        const prev = seen.get(k)
        if (!prev)
          seen.set(k, {
            name,
            avatarUrl: h.avatarUrl ?? null,
            party: h.label ?? null,
            own: h.own === true,
          })
        else {
          if (!prev.avatarUrl && h.avatarUrl) prev.avatarUrl = h.avatarUrl
          if (h.own) prev.own = true
        }
      }
      const roster = [...seen.values()].map((p) => p.name)
      return [...seen.values()]
        .map((p) =>
          rowFrom(
            p.name,
            p.name,
            p.own ? [p.party, 'you'].filter(Boolean).join(' · ') : p.party,
            matches(quotes, needlesFor(p.name, roster)),
            p.avatarUrl,
          ),
        )
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
    }

    if (lens === 'party') {
      const parties = new Set<string>()
      for (const h of handles) if (h.label?.trim()) parties.add(h.label.trim())
      if (identity?.party) parties.add(identity.party)
      return [...parties]
        .map((p) => rowFrom(p, p, null, matches(quotes, [p]), null))
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
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
        .slice(0, 8)
    }

    /*
     * Real topics, from the readings' own classification.
     *
     * This lens used to count recurring WORDS, which is why the office saw
     * "jai" and "aruna" filed as topics: a word counter has no idea what a
     * subject is. Every reading already carries `analysis.topics.primary`
     * from the taxonomy the rest of the product uses, so the lens now asks
     * that, and counts the comments sitting under the posts of each topic.
     * A word count is a good answer to "what are people saying"; it was never
     * an answer to "what about".
     */
    const byTopic = new Map<string, { comments: Quote[]; posts: number }>()
    for (const h of handles) {
      if (!h.own) continue
      for (const post of h.snapshots.at(-1)?.posts ?? []) {
        const topic = reports?.get(post.url)?.analysis?.topics?.primary
        if (!topic) continue
        const row = byTopic.get(topic) ?? { comments: [], posts: 0 }
        row.posts += 1
        for (const c of reports?.get(post.url)?.snapshot.comments ?? []) {
          row.comments.push({
            text: c.text,
            platform: h.platform,
            handle: h.displayName ?? h.handle,
            // The stored comments carry no score. Filing them as neutral
            // would invent a reading nobody made.
            side: quotes.find((q) => q.text === c.text)?.side ?? null,
            postUrl: post.url,
          })
        }
        byTopic.set(topic, row)
      }
    }
    return [...byTopic.entries()]
      .map(([topic, row]) =>
        rowFrom(
          topic,
          topic,
          `${row.posts} ${row.posts === 1 ? 'post' : 'posts'}`,
          row.comments,
          null,
        ),
      )
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 6)
  }, [quotes, handles, identity, issues, reports, topicStop])

  /**
   * Open on a tab that has something in it.
   *
   * The card always opened on People, and on this desk commenters simply do
   * not name the rivals it tracks — so the first thing an office saw was
   * "None of the people you track are named in the comments read so far"
   * under a heading claiming 47 comments. The other lenses had rows the whole
   * time. The tab still switches by hand; this only decides where it lands.
   */
  const lensRows = useMemo(() => {
    const out = {} as Record<Lens, Row[]>
    for (const l of LENSES) out[l.id] = rowsFor(l.id)
    return out
  }, [rowsFor])

  const activeLens: Lens =
    lens ?? (LENSES.find((l) => lensRows[l.id].length > 0)?.id ?? 'people')
  const rows = lensRows[activeLens]

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
            ? `Counted across every one of the ${quotes.length} comments this desk holds`
            : 'No comments have been read on your accounts yet'}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {LENSES.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setLens(id)}
            aria-pressed={activeLens === id}
            className={cn(
              'inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 text-xs font-semibold transition-colors',
              activeLens === id
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
        <p className="mt-4 text-sm leading-relaxed text-ink-2">{empty[activeLens]}</p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--rule)]">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-3 py-3">
              {activeLens === 'people' ? (
                <Avatar src={r.avatarUrl} name={r.label} size={38} />
              ) : (
                <span
                  className="icon-badge shrink-0"
                  style={toneStyle(r)}
                >
                  <AtSign size={16} aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{r.label}</p>
                {/* How those comments were read, beside the count. The word
                    prints next to the colour: roughly one man in twelve
                    cannot separate the red from the green, and this row is
                    read outdoors on a phone. Comments nothing scored are
                    counted as unread, never as neutral. */}
                <p className="tnum mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                  <span>
                    {r.count} {r.count === 1 ? 'comment' : 'comments'}
                    {r.sub ? ` · ${r.sub}` : ''}
                  </span>
                  {(
                    [
                      ['positive', r.positive, 'var(--pos)'],
                      ['negative', r.negative, 'var(--neg)'],
                      ['neutral', r.neutral, 'var(--warn)'],
                    ] as const
                  )
                    .filter(([, n]) => n > 0)
                    .map(([label, n, colour]) => (
                      <span key={label} className="inline-flex items-center gap-1" style={{ color: colour }}>
                        <span className="size-1.5 rounded-full" style={{ background: colour }} aria-hidden />
                        {n} {label}
                      </span>
                    ))}
                  {r.positive + r.negative + r.neutral === 0 && (
                    <span className="inline-flex items-center gap-1 text-ink-3">
                      Not scored
                      <InfoMark note="An account reading scores the comments it quotes; the rest are stored whole but carry no side. These comments are counted and quoted here, and their sentiment simply has not been read." />
                    </span>
                  )}
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
                {/* The office checks the desk's work against the platform
                    itself. Only shown where the reading recorded which post
                    the comment sat under. */}
                {r.sampleUrl && (
                  <a
                    href={r.sampleUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(e) => e.stopPropagation()}
                    title="Open the post this comment is under"
                    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-semibold text-[var(--accent)]"
                  >
                    View post
                    <ExternalLink size={11} aria-hidden />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onOpenAudience}
        className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--accent)]"
      >
        View all mentions
        <ArrowRight size={14} aria-hidden />
      </button>
    </Card>
  )
}
