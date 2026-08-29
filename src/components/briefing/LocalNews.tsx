import { useState, type ReactNode } from 'react'
import { Eye, EyeOff, ExternalLink, HelpCircle, MapPin, Megaphone, ScanEye, Users } from 'lucide-react'
import type { Influencer, InfluencerMention } from '@shared/grievance'
import type { Identity } from '@shared/identity'
import { Card, Chip, Empty, type ChipTone } from '../ui'
import { PlatformBadge } from '@/components/kit'
import { full } from '@/lib/utils'
import type { NewsItem } from '@/lib/briefing'
import type { RelevanceCounts, Verdict } from '@/lib/news-relevance'

/**
 * What the local accounts published in the last seven days, grouped by
 * stance — the account-mentions half of "in the local news".
 *
 * The window is anchored to the NEWEST mention's own date, not to the clock
 * on the wall. The demo dataset is fixed; measured against "now" it would age
 * out of a seven-day window within a week of being generated and the section
 * would go blank while holding perfectly good records. The heading names the
 * real dates so nobody mistakes the window for this calendar week.
 *
 * Mentions nothing has read for tone are counted, never judged: an unclear
 * stance and an unjudged listing both land in "not yet read for tone" rather
 * than being folded into neutral, because "a model found this even-handed"
 * and "nobody has looked" are different claims.
 *
 * The second half of this file, below the account mentions, is the newspaper
 * side of the same section: the labels a judged story wears and the account of
 * what the relevance filter removed. See the block comment there.
 */

const DAY_MS = 86_400_000

export interface LocalNewsRow {
  id: string
  outlet: string
  platform: string
  followers: number | null
  excerpt: string
  about: 'person' | 'party' | 'seat' | null
  postedAt: string | null
  postUrl: string
  suspect: boolean
}

export interface LocalNewsModel {
  /** The real dates, e.g. "21 to 27 August". */
  label: string
  supportive: LocalNewsRow[]
  critical: LocalNewsRow[]
  neutral: LocalNewsRow[]
  /** In the window but never read for tone. Counted, not judged. */
  unread: number
  total: number
}

const at = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/** Null when no mention carries a date at all — there is no window to draw. */
export function localNewsOf(
  influencers: Influencer[],
  mentions: InfluencerMention[],
): LocalNewsModel | null {
  const dated = mentions
    .map((m) => ({ m, t: at(m.postedAt) ?? at(m.seenAt) }))
    .filter((x): x is { m: InfluencerMention; t: number } => x.t !== null)
  if (dated.length === 0) return null

  const newest = Math.max(...dated.map((x) => x.t))
  // Seven calendar days ending on the newest post's own day.
  const end = new Date(newest)
  end.setHours(23, 59, 59, 999)
  const start = new Date(end.getTime() - 6 * DAY_MS)
  start.setHours(0, 0, 0, 0)

  const inWindow = dated.filter((x) => x.t >= start.getTime())

  const byId = new Map(influencers.map((i) => [i.id, i]))
  const rows: { row: LocalNewsRow; stance: InfluencerMention['stance']; judged: boolean }[] =
    inWindow
      .sort((a, b) => b.t - a.t)
      .map(({ m }) => {
        const account = byId.get(m.influencerId)
        return {
          row: {
            id: m.id,
            outlet: account?.displayName ?? account?.handle ?? 'unknown account',
            platform: account?.platform ?? 'unknown',
            followers: account?.followers ?? null,
            excerpt: m.excerpt,
            about: m.about ?? null,
            postedAt: m.postedAt,
            postUrl: m.postUrl,
            suspect: m.fake !== null && m.fake.suspicion !== 'No',
          },
          stance: m.stance,
          judged: m.judged !== false,
        }
      })

  const pick = (stance: InfluencerMention['stance']): LocalNewsRow[] =>
    rows.filter((r) => r.judged && r.stance === stance).map((r) => r.row)

  const monthOf = (d: Date): string => d.toLocaleDateString('en-IN', { month: 'long' })
  const label =
    monthOf(start) === monthOf(end)
      ? `${start.getDate()} to ${end.getDate()} ${monthOf(end)}`
      : `${start.getDate()} ${monthOf(start)} to ${end.getDate()} ${monthOf(end)}`

  return {
    label,
    supportive: pick('supportive'),
    critical: pick('critical'),
    neutral: pick('neutral'),
    unread: rows.filter((r) => !r.judged || r.stance === 'unclear').length,
    total: rows.length,
  }
}

/** The word the about-chip actually renders, from the identity on this desk. */
function aboutWord(about: LocalNewsRow['about'], identity: Identity | null): string | null {
  if (!about) return null
  if (about === 'person') return identity?.name ?? 'You'
  if (about === 'party') return identity?.party ?? 'Your party'
  return identity?.constituency ?? 'Your seat'
}

function MentionRow({
  row,
  identity,
  onRead,
}: {
  row: LocalNewsRow
  identity: Identity | null
  onRead: (postUrl: string) => void
}) {
  const word = aboutWord(row.about, identity)
  const day = row.postedAt
    ? new Date(row.postedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null

  return (
    <li className="border-t border-[var(--rule)] pt-3 first:border-t-0 first:pt-0">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
        <PlatformBadge platform={row.platform} size={20} />
        <span className="font-semibold text-ink-2">{row.outlet}</span>
        {row.followers != null && <span>· {full(row.followers)} followers</span>}
        {day && <span>· {day}</span>}
        {word && <Chip className="!py-0.5">{word}</Chip>}
        {row.suspect && (
          <Chip tone="negative" icon={<ScanEye size={11} aria-hidden />}>
            Check this
          </Chip>
        )}
      </p>

      {/* The excerpt reads it in the app; the small link beside it still goes
          to the platform, because sometimes the original is what you want. */}
      <button
        type="button"
        onClick={() => onRead(row.postUrl)}
        className="mt-1.5 block w-full text-left text-sm leading-relaxed text-ink-2 underline decoration-[var(--rule)] underline-offset-4 hover:text-ink hover:decoration-[var(--accent)]"
      >
        <span className="line-clamp-2">{row.excerpt}</span>
      </button>

      <span className="mt-1 flex items-center gap-3">
        <button
          type="button"
          onClick={() => onRead(row.postUrl)}
          className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
        >
          <ScanEye size={12} aria-hidden />
          Analyse
        </button>
        <a
          href={row.postUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-11 items-center gap-1 text-xs text-ink-3 hover:text-ink-2"
        >
          <ExternalLink size={11} aria-hidden />
          open
        </a>
      </span>
    </li>
  )
}

function StanceGroup({
  title,
  colour,
  rows,
  identity,
  onRead,
  onOpenInfluencers,
}: {
  title: string
  colour: string
  rows: LocalNewsRow[]
  identity: Identity | null
  onRead: (postUrl: string) => void
  onOpenInfluencers: () => void
}) {
  if (rows.length === 0) return null
  const shown = rows.slice(0, 4)
  return (
    <Card className="h-full">
      <p className="kicker" style={{ color: colour }}>
        {title} · {rows.length}
      </p>
      <ul className="mt-3 space-y-3">
        {shown.map((row) => (
          <MentionRow key={row.id} row={row} identity={identity} onRead={onRead} />
        ))}
      </ul>
      {rows.length > shown.length && (
        <button
          type="button"
          onClick={onOpenInfluencers}
          className="mt-2 inline-flex min-h-11 items-center text-xs font-medium text-ink-3 underline decoration-[var(--rule)] underline-offset-4 hover:text-ink-2"
        >
          {rows.length - shown.length} more on the accounts screen
        </button>
      )}
    </Card>
  )
}

export function LocalNewsList({
  model,
  identity,
  onRead,
  onOpenInfluencers,
}: {
  model: LocalNewsModel | null
  identity: Identity | null
  onRead: (postUrl: string) => void
  onOpenInfluencers: () => void
}) {
  if (model === null || model.total === 0) {
    return (
      <Empty
        icon={<Megaphone size={18} aria-hidden />}
        title="Nothing from the local accounts yet"
        body="The watched accounts have no recorded posts in this window."
      />
    )
  }

  return (
    <div className="stack-tight">
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <StanceGroup
          title="Supportive"
          colour="var(--pos)"
          rows={model.supportive}
          identity={identity}
          onRead={onRead}
          onOpenInfluencers={onOpenInfluencers}
        />
        <StanceGroup
          title="Critical"
          colour="var(--neg)"
          rows={model.critical}
          identity={identity}
          onRead={onRead}
          onOpenInfluencers={onOpenInfluencers}
        />
        <StanceGroup
          title="Neutral"
          colour="var(--text-3)"
          rows={model.neutral}
          identity={identity}
          onRead={onRead}
          onOpenInfluencers={onOpenInfluencers}
        />
      </div>

      {model.unread > 0 && (
        <button
          type="button"
          onClick={onOpenInfluencers}
          className="inline-flex min-h-11 items-center text-left text-xs font-medium text-ink-3 underline decoration-[var(--rule)] underline-offset-4 hover:text-ink-2"
        >
          {model.unread} {model.unread === 1 ? 'post is' : 'posts are'} not yet read for tone.
        </button>
      )}
    </div>
  )
}

/* ── the relevance verdicts, made visible ────────────────────────────────── */

/**
 * The second half of this section: the newspaper stories, and what the
 * relevance check decided about them.
 *
 * News reaching this desk was selected by whole-word matching alone, which
 * admits a cricket report that happens to carry the member's name and misses a
 * front page that calls her "the Mahabubnagar MP". The check that now judges
 * each story returns a verdict for every candidate rather than discarding any,
 * and these components are what stop that verdict being a black box:
 *
 *   a story about the seat or the party carries a word saying so, rather than
 *   being presented as coverage of the member herself;
 *
 *   a story nothing has checked carries a word saying that too, and is still
 *   shown, because "not checked" is not a finding;
 *
 *   the stories that were hidden are counted at the foot of the section and can
 *   be opened, with the judge's own reason against each. An office that cannot
 *   see what was taken off its desk cannot tell a working filter from a broken
 *   scan, and this desk has been accused of both.
 */

interface RelevanceNote {
  label: string
  tone: ChipTone
  icon: ReactNode
  /** The judge's reason, written out. */
  reason: string
}

/**
 * Why a story was let through or set aside, in a sentence.
 *
 * The confidence is folded in rather than shown as its own figure: "medium"
 * beside a headline means nothing to a reader, while "the check reported medium
 * confidence" tells them how hard to argue with it.
 */
function reasonOf(v: Verdict): string {
  const why = v.why?.trim()
  if (!why) {
    return v.verdict === 'unjudged' ? 'Not checked yet.' : 'No reason recorded.'
  }
  return why
}

/**
 * The word a story wears, or none at all.
 *
 * `about-person` gets nothing. It is the norm on this desk, and a badge on the
 * norm is decoration rather than information: label every card and the label
 * stops being a signal, so the one card that is really about the party no
 * longer stands out.
 */
function noteOf(v: Verdict, identity: Identity | null): RelevanceNote | null {
  if (v.verdict === 'about-person') return null

  if (v.verdict === 'about-seat') {
    return {
      label: `About ${identity?.constituency ?? 'your seat'}, not about you`,
      tone: 'info',
      icon: <MapPin size={11} aria-hidden />,
      reason: reasonOf(v),
    }
  }

  if (v.verdict === 'about-party') {
    return {
      label: `About ${identity?.party ?? 'your party'}, not about you`,
      tone: 'info',
      icon: <Users size={11} aria-hidden />,
      reason: reasonOf(v),
    }
  }

  if (v.verdict === 'unjudged') {
    return {
      label: 'Not yet checked',
      tone: 'warning',
      icon: <HelpCircle size={11} aria-hidden />,
      reason: reasonOf(v),
    }
  }

  return {
    label: 'Judged unrelated',
    tone: 'neutral',
    icon: <EyeOff size={11} aria-hidden />,
    reason: reasonOf(v),
  }
}

/**
 * The chip that goes on a news card.
 *
 * Allowed to wrap. A constituency name and a party name are both long in
 * Telangana, and a chip that will not wrap pushes a card sideways on a 390px
 * phone, which is the screen this is read on.
 */
export function RelevanceChip({
  verdict,
  identity,
}: {
  verdict: Verdict
  identity: Identity | null
}) {
  const note = noteOf(verdict, identity)
  if (!note) return null
  return (
    <Chip
      tone={note.tone}
      icon={note.icon}
      title={note.reason}
      className="max-w-full !whitespace-normal"
    >
      {note.label}
    </Chip>
  )
}

function HiddenRow({
  item,
  onRead,
}: {
  item: NewsItem
  onRead: (postUrl: string) => void
}) {
  const { mention } = item
  const when = mention.publishedAt ?? mention.seenAt
  const day = when
    ? new Date(when).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null

  return (
    <li className="border-t border-[var(--rule)] pt-3 first:border-t-0 first:pt-0">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
        {mention.publisher && (
          <span className="font-semibold text-ink-2">{mention.publisher}</span>
        )}
        {day && <span>· {day}</span>}
        {/* The one hidden story worth a second look is the one the judge was
            least sure about, so that is the only thing chipped here. Chipping
            all of them would repeat the heading on every row. */}
        {item.verdict.confidence === 'low' && (
          <Chip tone="warning" className="!py-0.5">
            Low confidence
          </Chip>
        )}
      </p>

      <button
        type="button"
        onClick={() => onRead(mention.url)}
        className="mt-1.5 block w-full text-left text-sm leading-relaxed text-ink-2 underline decoration-[var(--rule)] underline-offset-4 hover:text-ink hover:decoration-[var(--accent)]"
      >
        <span className="line-clamp-2">{mention.headline}</span>
      </button>

      <p className="mt-1 text-xs leading-relaxed text-ink-3">{reasonOf(item.verdict)}</p>

      <span className="mt-0.5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => onRead(mention.url)}
          className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
        >
          <ScanEye size={12} aria-hidden />
          Read it anyway
        </button>
        <a
          href={mention.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-11 items-center gap-1 text-xs text-ink-3 hover:text-ink-2"
        >
          <ExternalLink size={11} aria-hidden />
          open
        </a>
      </span>
    </li>
  )
}

/**
 * What the filter did, at the foot of the news, and how to undo it.
 *
 * Renders nothing when the check has neither hidden anything nor left anything
 * unchecked, so it can be dropped in unconditionally.
 *
 * Two states are worth naming. When some stories were hidden and others shown,
 * this is one quiet line and a toggle. When EVERY story was hidden, the section
 * above it is empty, and an empty news section with no explanation is the exact
 * failure this feature was supposed to remove: it reads as "the scan found
 * nothing" when the truth is "the scan found nine things and the check decided
 * none of them was about you". That case gets a panel that says so.
 */
export function HiddenStories({
  hidden,
  counts,
  onRead,
}: {
  hidden: NewsItem[]
  counts: RelevanceCounts
  identity: Identity | null
  onRead: (postUrl: string) => void
}) {
  const [open, setOpen] = useState(false)

  if (counts.unrelated === 0 && counts.unjudged === 0) return null

  const n = counts.unrelated
  const list = open && hidden.length > 0 && (
    <Card level="quiet">
      <p className="kicker">Hidden as unrelated to you</p>
      <ul className="mt-3 space-y-3">
        {hidden.map((item) => (
          <HiddenRow key={item.mention.id} item={item} onRead={onRead} />
        ))}
      </ul>
      {n > hidden.length && (
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          {hidden.length} of the {n} are listed here.
        </p>
      )}
    </Card>
  )

  /*
    No button when there are no rows behind it. The count is the true number of
    stories the check set aside; the rows are capped. A control that opens onto
    nothing is worse than no control, because it reads as a broken reveal rather
    than as a bounded list.
  */
  const toggle =
    hidden.length === 0 ? null : (
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-ink-3 underline decoration-[var(--rule)] underline-offset-4 hover:text-ink-2"
      >
        {open ? <EyeOff size={12} aria-hidden /> : <Eye size={12} aria-hidden />}
        {open ? 'Hide them again' : n === 1 ? 'Show it' : 'Show them'}
      </button>
    )

  return (
    <div className="stack-tight mt-3">
      {n > 0 &&
        (counts.shown === 0 ? (
          <Empty
            icon={<EyeOff size={18} aria-hidden />}
            title="Nothing found this week was about you"
            body={`${counts.total} ${counts.total === 1 ? 'story' : 'stories'} hidden.`}
            action={toggle}
          />
        ) : (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-relaxed text-ink-3">
            <span>
              {n} {n === 1 ? 'story was' : 'stories were'} hidden as not about you.
            </span>
            {toggle}
          </p>
        ))}

      {list}

      {counts.unjudged > 0 && (
        <p className="text-xs leading-relaxed text-ink-3">
          {counts.unjudged === counts.total
            ? 'No story here has been checked for relevance yet.'
            : `${counts.unjudged} of the stories above ${
                counts.unjudged === 1 ? 'has' : 'have'
              } not been checked for relevance.`}
        </p>
      )}
    </div>
  )
}
