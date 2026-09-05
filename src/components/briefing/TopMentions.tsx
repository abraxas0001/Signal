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
import { cleanQuote, cn } from '@/lib/utils'

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
  /** What this comment is about, in its own words. Null when it gives no reason. */
  theme: string | null
  /** The post it sits under, where the reading recorded which one. */
  postUrl: string | null
}

interface Row {
  key: string
  label: string
  sub: string | null
  count: number
  /**
   * ONE LINK PER PLATFORM THIS MENTION WAS FOUND ON.
   *
   * The office's reason for wanting them: "the user should redirect to that
   * post and he can manually verify that, yes, these mentions were there so
   * that we can verify our platform is extracting the correct data."
   *
   * It used to be a single `sampleUrl` — `hits.find(h => h.postUrl)` — so a
   * name mentioned on Facebook, Instagram AND YouTube offered exactly one
   * link and the row's own platform marks said three. You could verify a
   * third of what the row claimed.
   *
   * `kind` is the honest part. A comment read from a POST carries its
   * permalink, so that link lands on the thing being quoted. A comment from
   * an account-level reading does not record which post it was on — the
   * survey quotes across a whole account — so the best that can be offered
   * is the account itself, and the link says "account", never "post". A
   * verification link that lands somewhere other than it promised is worse
   * than none.
   */
  sources: { platform: string; url: string; kind: 'post' | 'account' }[]
  avatarUrl: string | null
  platforms: string[]
  /** How the comments naming this were read. Unscored ones are in none. */
  positive: number
  negative: number
  neutral: number
  /**
   * A couple of the comments behind each side, for the hover.
   *
   * "3 positive" is a count, and a count is not a reason. The comments that
   * earned it are already in hand at this point, so the row keeps a sample of
   * each side rather than making a reader open the audience screen to find
   * out what "positive" meant here.
   */
  examples: { positive: string[]; negative: string[]; neutral: string[] }
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

/**
 * One verifiable link per platform, best evidence first.
 *
 * A post permalink beats an account address on the same platform, because it
 * lands on the comment being quoted rather than somewhere it might be. Only
 * one link per platform: a row mentioned in nine YouTube comments does not
 * need nine identical-looking links, it needs one that proves YouTube.
 */
function sourcesOf(
  hits: Quote[],
  profileOf: Map<string, string>,
): { platform: string; url: string; kind: 'post' | 'account' }[] {
  /**
   * ONE LINK PER POST, not one per platform.
   *
   * This used to key on the PLATFORM, so a row whose sub-line said "6 posts"
   * offered a single link — five sixths of what it claimed was unverifiable,
   * and the office said so: "if there are 6 posts then there should be 6
   * links". Keyed on the URL, a row offers exactly as many links as it has
   * distinct posts behind it, and the count beside it is computed from the
   * same set so the two can never disagree again.
   */
  const posts = new Map<string, { platform: string; url: string; kind: 'post' }>()
  for (const h of hits) {
    if (!h.postUrl) continue
    if (!posts.has(h.postUrl)) {
      posts.set(h.postUrl, { platform: h.platform, url: h.postUrl, kind: 'post' })
    }
  }

  /**
   * NO ACCOUNT LINKS. There used to be a fallback here: a platform whose
   * comments came only from an account-level reading, which does not record
   * which post each comment sat under, got a link to the account instead.
   * The office asked the right question about it: the claim being verified
   * is "this comment was written under this post", and an account link
   * proves only that the account exists, which nobody disputed. A link that
   * cannot verify the claim beside it dresses the row up without evidencing
   * it, so a comment whose post is unknown now carries no link at all, and
   * the absence is the honest statement that the reading did not record one.
   */
  return [...posts.values()]
}

function rowFrom(
  key: string,
  label: string,
  sub: string | null,
  hits: Quote[],
  avatarUrl: string | null,
  /** handle -> its profile address, for quotes that know no post. */
  profileOf: Map<string, string>,
): Row {
  let positive = 0
  let negative = 0
  let neutral = 0
  const examples = { positive: [] as string[], negative: [] as string[], neutral: [] as string[] }
  for (const h of hits) {
    if (h.side === 'positive') positive++
    else if (h.side === 'negative') negative++
    else if (h.side === 'neutral') neutral++
    if (h.side && examples[h.side].length < 2) examples[h.side].push(h.text)
  }
  return {
    key,
    label,
    sub,
    count: hits.length,
    sources: sourcesOf(hits, profileOf),
    avatarUrl,
    platforms: [...new Set(hits.map((h) => h.platform))],
    positive,
    negative,
    neutral,
    examples,
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

  /**
   * handle -> profile address, so a quote that knows no post can still be
   * traced to the account it was left on. Keyed the same way a Quote names
   * itself: platform + handle.
   */
  const profileOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const h of handles) {
      const url = h.profileUrl?.trim()
      if (!url) continue
      /**
       * Keyed under BOTH names the quote might carry.
       *
       * `audienceOf` names an account-level quote with `displayName ?? handle`
       * — so a comment on D. K. Aruna's Facebook page arrives as
       * "Facebook:D. K. Aruna", while the tracked handle is
       * "Facebook:DKAruna.TG". Keying on the raw handle alone missed every
       * one of them, which is why the People lens showed no links at all.
       */
      m.set(`${h.platform}:${h.handle}`, url)
      if (h.displayName) m.set(`${h.platform}:${h.displayName}`, url)
    }
    return m
  }, [handles])

  const quotes = useMemo<Quote[]>(
    () =>
      model.quotes.map((q) => ({
        text: q.text,
        platform: q.platform,
        handle: q.handle,
        side: q.side,
        theme: q.theme,
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
            profileOf,
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
        .map((p) => rowFrom(p, p, null, matches(quotes, [p]), null, profileOf))
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
    }

    if (lens === 'incidents') {
      /*
       * AN INCIDENT IS WHAT THE COMMENT IS ABOUT, NOT WHERE IT WAS TYPED.
       *
       * This lens used to match comments on the PLACE named in a grievance
       * and then head the row with that grievance's CATEGORY. Those are two
       * different claims, and the office caught it: a comment reading "Madam
       * Ji Shadnagar chattanpally railway gate please" was filed under
       * "Roads", because a Roads grievance happened to exist in Shadnagar.
       * The comment names a railway gate. Nothing in it is about roads, and
       * the tooltip went as far as "1 negative comment naming Roads", which
       * was simply untrue.
       *
       * Every comment now carries its own subject, read out of the comment
       * itself by classify-comments.ts. So the lens groups by that: a row is
       * a matter people actually raised, counted over the comments that
       * raised it, with the places those comments name shown beside it as
       * context rather than as the thing being claimed. A comment that gave
       * no reason joins no row, because there is nothing to file it under.
       */
      const places = new Set<string>()
      for (const i of issues) {
        for (const place of [i.constituency, ...i.places]) {
          const p = (place ?? '').trim()
          if (p) places.add(p.toLowerCase())
        }
      }

      const byTheme = new Map<string, { hits: Quote[]; places: Set<string> }>()
      for (const q of quotes) {
        const theme = (q.theme ?? '').trim().toLowerCase()
        if (!theme) continue
        const row = byTheme.get(theme) ?? { hits: [], places: new Set<string>() }
        row.hits.push(q)
        // Only a place the desk tracks, and only because this comment says it.
        const hay = ` ${q.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `
        for (const place of places) {
          if (hay.includes(` ${place} `)) row.places.add(place)
        }
        byTheme.set(theme, row)
      }

      const titleOf = (s: string): string => s.replace(/\p{L}/gu, (c) => c.toUpperCase())

      return [...byTheme.entries()]
        .map(([theme, row]) =>
          rowFrom(
            `theme:${theme}`,
            titleOf(theme),
            row.places.size > 0 ? [...row.places].map(titleOf).join(', ') : null,
            row.hits,
            null,
            profileOf,
          ),
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
    const byTopic = new Map<string, { comments: Quote[]; posts: Set<string> }>()
    for (const h of handles) {
      if (!h.own) continue
      for (const post of h.snapshots.at(-1)?.posts ?? []) {
        const topic = reports?.get(post.url)?.analysis?.topics?.primary
        if (!topic) continue
        const row = byTopic.get(topic) ?? { comments: [], posts: new Set<string>() }
        /**
         * Posts that actually CONTRIBUTED a comment, not posts on the topic.
         *
         * This counted every post filed under the topic, so a row read
         * "Agriculture · 6 posts" while carrying no comments and no links —
         * a count with nothing behind it on a card about comments. The set
         * below is the same one the links are built from, so the number and
         * the links cannot drift apart.
         */
        /* Cleaned the way `audienceOf` cleans the other three lenses, so
           every lens on this card counts the same population. Left raw, the
           Topics lens counted Instagram's age chips and verified badges as
           comments and the card's own subtitle disagreed with its rows. */
        const comments = (reports?.get(post.url)?.snapshot.comments ?? [])
          .map((c) => ({ ...c, text: cleanQuote(c.text ?? '') }))
          .filter((c) => c.text.length > 0)
        if (comments.length > 0) row.posts.add(post.url)
        for (const c of comments) {
          row.comments.push({
            text: c.text,
            platform: h.platform,
            handle: h.displayName ?? h.handle,
            /* Each comment's own reading, from classify-comments.ts. It
               used to be looked up by matching text against the account
               survey's handful of quotes, which found a side for almost
               none of them. Null still means not classified, never neutral. */
            side: c.side ?? null,
            theme: c.theme ?? null,
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
          `${row.posts.size} ${row.posts.size === 1 ? 'post' : 'posts'}`,
          row.comments,
          null,
          profileOf,
        ),
      )
      /**
       * A topic with no comments is not a mention.
       *
       * The other lenses drop empty rows; this one did not, so topics with a
       * post count and nothing else sat on a card titled "Top mentions in
       * comments" — the office's words: "in agriculture, education and all
       * you are showing n posts but the rest of the data is empty".
       */
      .filter((r) => r.count > 0)
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

  /**
   * WHAT THE NUMBER IN THE SUBTITLE IS A COUNT OF.
   *
   * It read "Counted across every one of the N comments this desk holds",
   * which was three claims and none of them true. The list is two populations
   * at once: comments this desk stores in full, read off its own posts, and
   * comments an account survey quoted while counting a far larger set it did
   * not keep. On this desk that larger set is 280 comments against 173 stored,
   * so no single number here is "the comments this desk holds", and the word
   * "every" promised a completeness the list never had.
   *
   * `postUrl` is the honest divider: a comment read off a post carries the
   * post's address, a comment lifted out of a bulk survey has no post to name.
   * Both are counted, each is named for what it is, and the reader can see at
   * a glance how much of the card rests on comments the desk can show them.
   */
  const stored = quotes.filter((q) => q.postUrl !== null).length
  const surveyed = quotes.length - stored
  const countedOver =
    stored > 0 && surveyed > 0
      ? `Counted across ${stored} comments stored in full on your posts, and ${surveyed} more quoted by the account readings`
      : stored > 0
        ? `Counted across ${stored} comment${stored === 1 ? '' : 's'} stored in full on your posts`
        : surveyed > 0
          ? `Counted across ${surveyed} comment${surveyed === 1 ? '' : 's'} the account readings quoted`
          : 'No comments have been read on your accounts yet'

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
        <p className="mt-0.5 text-xs text-ink-3">{countedOver}</p>
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
                      <span
                        key={label}
                        className="inline-flex cursor-help items-center gap-1"
                        style={{ color: colour }}
                        /* The comments that earned this count, on the count
                           itself. A number nobody can check is a number
                           nobody should have to take on trust. */
                        title={
                          r.examples[label].length > 0
                            ? `${n} ${label} comment${n === 1 ? '' : 's'} naming ${r.label}:\n\n` +
                              r.examples[label]
                                .map((q) => `\u201c${q.length > 160 ? `${q.slice(0, 160)}\u2026` : q}\u201d`)
                                .join('\n\n')
                            : `${n} comment${n === 1 ? '' : 's'} naming ${r.label} were read as ${label}. The reading counted them without quoting them.`
                        }
                      >
                        <span className="size-1.5 rounded-full" style={{ background: colour }} aria-hidden />
                        {n} {label}
                      </span>
                    ))}
                  {/*
                      THE COMMENTS THE SIDES DO NOT ACCOUNT FOR, NAMED.
                      A row read "10 comments · 2 positive · 2 neutral" and
                      left the reader to notice that four is not ten. The
                      missing six were real — stored, counted, quoted, simply
                      never read for a side — but nothing on the row said so,
                      so the only two readings available were "the count is
                      wrong" or "six comments were neither positive, neutral
                      nor negative". Both are worse than the truth.
                  */}
                  {(() => {
                    const scored = r.positive + r.negative + r.neutral
                    const unread = r.count - scored
                    if (scored > 0 && unread <= 0) return null
                    return (
                      <span className="inline-flex items-center gap-1 text-ink-3">
                        {scored === 0 ? 'Not scored' : `${unread} not scored`}
                        <InfoMark note="An account reading scores the comments it quotes; the rest are stored whole but carry no side. These comments are counted and quoted here, and their sentiment simply has not been read." />
                      </span>
                    )
                  })()}
                </p>
              </div>
              {/*
                The quote, then one link per platform, STACKED.

                The links used to run along one line beside a separate cluster
                of platform badges — so a mention found on three platforms
                showed three logos that did nothing and one link that did, and
                past two links the row ran out of width and truncated.

                The badge cluster is gone: every link now carries its own
                platform mark, so drawing the same logos twice said the same
                thing twice and only one set of them was clickable. One link
                per line, each naming its platform and what it opens.
              */}
              {/*
                NO SAMPLE QUOTE HERE ANY MORE. One comment was printed beside
                the row to show what the mentions sounded like; the tone counts
                to the left now carry their own comments on hover, per side,
                which is the same evidence organised better. Printing one of
                them again out here said it twice and spent the row's width on
                the repeat.

                The links WRAP rather than stacking. One per line was fine at
                two or three; a row with seventeen comments behind it turned
                into a column of eleven and drove the card past five hundred
                pixels of height for a single entity.
              */}
              <div className="hidden min-w-0 max-w-[46%] flex-wrap items-center justify-end gap-x-2.5 gap-y-1 sm:flex">
                {r.sources.map((src) => (
                  <a
                    key={`${src.platform}:${src.url}`}
                    href={src.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(e) => e.stopPropagation()}
                    title={`Open the ${src.platform} post this comment is under`}
                    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-semibold text-[var(--accent)]"
                  >
                    <PlatformBadge platform={src.platform} size={13} />
                    post
                    <ExternalLink size={11} aria-hidden />
                  </a>
                ))}
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
