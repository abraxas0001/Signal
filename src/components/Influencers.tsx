import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import {
  Check,
  ChevronRight,
  ExternalLink,
  Info,
  Megaphone,
  MessagesSquare,
  Plus,
  RefreshCw,
  ScanEye,
  Search,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react'
import type {
  FakeAssessment,
  FakeSignal,
  Influencer,
  InfluencerMention,
} from '@shared/grievance'
import { isWaiting, pruneMentions } from '@shared/grievance'
import { deskPlaces } from '@/lib/autoconfig'
import {
  CONFIDENCE_TIERS,
  DEBUNK_STATUSES,
  FAKE_NEWS_TYPES,
  FAKE_SUSPICION,
  SENTIMENTS,
  SENTIMENT_TONE,
} from '@shared/taxonomy'
import type { Platform } from '@shared/taxonomy'
import { readStore, update, useStore } from '@/lib/store'
import { Mascot } from './Mascot'
import {
  Button,
  Card,
  Chip,
  Empty,
  PageHeader,
  SectionTitle,
  selectClass,
  type ChipTone,
} from './ui'
import { CardHead, DonutBreakdown, Legend, PlatformBadge, RankRow } from '@/components/kit'
import { AddInfluencer, SearchInfluencers } from './AddInfluencer'
import { cn, compact, full, relativeTime } from '@/lib/utils'
import { fadeUp, listItem, listStagger } from '@/lib/motion'
import { fetchWithTimeout } from '@/lib/net'

/**
 * Influencer watch.
 *
 * The honest version of a feature that is usually sold dishonestly. Products
 * like this advertise "real-time alerts", and the promise is almost always
 * false on a phone: there is no server here holding the roster, no scheduled
 * job reading it and no push channel to arrive on. What this screen can do is
 * read the watched accounts when someone taps, and tell them what is new since
 * they last opened the app — which is what `store.lastSeenAt` is for.
 *
 * So the screen says that outright, at the top, before anything else. An office
 * that believes it will be told when an attack starts, and is not, is worse off
 * than an office that knows it has to look. Stating the limit is the feature.
 *
 * The other honesty is per account. Facebook, Instagram, LinkedIn and X publish
 * nothing about a stranger's posts to a server-side read, so a page on those
 * can be on the roster and never produce a single mention. A card that simply
 * showed nothing would read as "this page is quiet". Each one carries the real
 * reason instead, taken from the platform reader itself once a check has run.
 */

/* ── Local vocabularies ──────────────────────────────────────────────────── */

/** Platforms worth offering when someone types a bare handle. */
const PLATFORM_OPTIONS: Platform[] = [
  'YouTube',
  'Facebook',
  'Instagram',
  'Bluesky',
  'Mastodon',
  'LinkedIn',
  'Twitter/X',
]

/**
 * Why a platform will never yield a post list, stated before any check runs.
 *
 * Measured, not assumed — these are the same gates the connector board on the
 * dashboard reports, and they are why an account here can be real, correct and
 * permanently unreadable.
 */

const STANCE_TONE: Record<InfluencerMention['stance'], ChipTone> = {
  supportive: 'positive',
  critical: 'negative',
  neutral: 'neutral',
  unclear: 'warning',
}

/**
 * The chip. "unclear" is spelled out, because a blank stance chip reads as a
 * bug.
 *
 * Kept separate from STANCE_SENTENCE below because the two are read in
 * different places and cannot share a string. The chip stands alone and has to
 * name what it is measuring; the sentence already supplies "towards you" from
 * its own grammar, and reusing the chip's wording there produced "Neutral
 * towards you towards you, neutral in tone".
 */
const STANCE_LABEL: Record<InfluencerMention['stance'], string> = {
  supportive: 'Supportive',
  critical: 'Critical',
  neutral: 'Neutral towards you',
  unclear: 'Stance unclear',
}

/** The same four stances as they read mid-sentence, before "towards you". */
const STANCE_SENTENCE: Record<InfluencerMention['stance'], string> = {
  supportive: 'Supportive',
  critical: 'Critical',
  neutral: 'Neutral',
  unclear: 'Unclear',
}

const SENTIMENT_CHIP: Record<string, ChipTone> = {
  positive: 'positive',
  negative: 'negative',
  mixed: 'warning',
  neutral: 'neutral',
}

const SIGNAL_KINDS = [
  'provenance',
  'recirculation',
  'source',
  'consistency',
  'corroboration',
] as const satisfies readonly FakeSignal['kind'][]

const SIGNAL_SUPPORTS = [
  'authentic',
  'fabricated',
  'inconclusive',
] as const satisfies readonly FakeSignal['supports'][]

const STANCES = [
  'supportive',
  'critical',
  'neutral',
  'unclear',
] as const satisfies readonly InfluencerMention['stance'][]

/* ── Reading an untrusted response ───────────────────────────────────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const number = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const nonNull = <T,>(v: T | null): v is T => v !== null

/** Narrow a value to a known vocabulary without asserting anything. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value !== 'string') return fallback
  return allowed.find((a) => a === value) ?? fallback
}

function toFake(raw: unknown): FakeAssessment | null {
  if (!isRecord(raw)) return null
  const type = FAKE_NEWS_TYPES.find((t) => t === raw['type']) ?? null
  const signals = (Array.isArray(raw['signals']) ? raw['signals'] : [])
    .map((sig): FakeSignal | null => {
      if (!isRecord(sig)) return null
      const finding = text(sig['finding'])
      if (!finding) return null
      return {
        kind: oneOf(sig['kind'], SIGNAL_KINDS, 'consistency'),
        finding,
        confidence: oneOf(sig['confidence'], CONFIDENCE_TIERS, 'low'),
        supports: oneOf(sig['supports'], SIGNAL_SUPPORTS, 'inconclusive'),
      }
    })
    .filter(nonNull)

  return {
    suspicion: oneOf(raw['suspicion'], FAKE_SUSPICION, 'Unsure'),
    type,
    debunkStatus: oneOf(raw['debunkStatus'], DEBUNK_STATUSES, 'Under Review'),
    signals,
    note: text(raw['note']),
  }
}

function toInfluencer(raw: unknown): Influencer | null {
  if (!isRecord(raw)) return null
  const handle = text(raw['handle'])
  const id = text(raw['id'])
  const platform = PLATFORM_OPTIONS.find((p) => p === raw['platform'])
  if (!handle || !id || !platform) return null
  return {
    id,
    platform,
    handle,
    displayName: text(raw['displayName']),
    url: text(raw['url']) ?? '',
    constituency: text(raw['constituency']),
    followers: number(raw['followers']),
    addedAt: text(raw['addedAt']) ?? new Date().toISOString(),
    note: text(raw['note']),
  }
}

function toMention(raw: unknown): InfluencerMention | null {
  if (!isRecord(raw)) return null
  const id = text(raw['id'])
  const influencerId = text(raw['influencerId'])
  const postUrl = text(raw['postUrl'])
  if (!id || !influencerId || !postUrl) return null
  return {
    id,
    influencerId,
    postUrl,
    postedAt: text(raw['postedAt']),
    excerpt: text(raw['excerpt']) ?? '',
    mentionsSubject: raw['mentionsSubject'] !== false,
    // Absent means judged: only the unfiltered path sends an explicit false.
    judged: raw['judged'] !== false,
    stance: oneOf(raw['stance'], STANCES, 'unclear'),
    sentiment: oneOf(raw['sentiment'], SENTIMENTS, 'Neutral'),
    fake: toFake(raw['fake']),
    seenAt: text(raw['seenAt']) ?? new Date().toISOString(),
    acknowledged: raw['acknowledged'] === true,
  }
}

/** What the last check managed to read, per account. */


/* ── Identity ────────────────────────────────────────────────────────────── */

/**
 * The same derivation the server uses.
 *
 * Adding a page by hand and later accepting it as a suggestion has to produce
 * one row, not two — and the mention ids are built from this, so a roster entry
 * whose id changed would orphan everything already acknowledged against it.
 */

/** The profile page for a bare handle, so a card can still link out. */

/* ── Profile-card atoms ──────────────────────────────────────────────────── */

/**
 * One small stat cell inside a profile card — the violet-badged mini tiles of
 * the influencer-profile reference. Not an IconStat: these live INSIDE a card
 * and a card-in-a-card reads as a rendering bug.
 */
function MiniStat({
  icon,
  label,
  value,
  title,
}: {
  icon: ReactNode
  label: string
  value: string
  title?: string
}) {
  /**
   * Stacked, not side-by-side.
   *
   * Three of these sit in a row inside a card that is itself one of three
   * across, so a horizontal badge-then-text layout left about forty pixels for
   * the label and every one of them truncated to "Follo…". The badge sits above
   * the number instead, which gives the label the full width of the tile.
   */
  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-2.5"
      title={title}
    >
      <span
        className="icon-badge icon-badge-sm"
        style={{ background: 'var(--accent-2-soft)', color: 'var(--accent-2)' }}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="tnum block truncate text-[15px] font-bold leading-none text-ink">{value}</span>
        <span className="mt-1 block text-[10.5px] font-medium leading-tight text-ink-3">{label}</span>
      </span>
    </div>
  )
}

/**
 * One watched account as a profile card: ringed avatar, name and handle,
 * the platform's own badge, and whatever numbers this device actually holds
 * about it — never more. There is no engagement tile because nothing here
 * measures engagement; inventing one would be the dishonesty this product
 * exists to avoid.
 */
function InfluencerCard({
  influencer,
  mentions,
}: {
  influencer: Influencer
  mentions: InfluencerMention[]
}) {
  const name = influencer.displayName ?? influencer.handle

  /**
   * The account's own coverage, over the posts a model actually read.
   *
   * `judged !== false` on purpose: an unfiltered listing carries struct-default
   * "Neutral" and no `mentionsSubject`, so counting those would invent a calm
   * — and an about-you tally — that nothing measured. The same rule the global
   * donut uses, applied to one account.
   */
  const judged = mentions.filter((x) => x.judged !== false)
  const aboutYou = judged.filter((x) => x.mentionsSubject).length
  const pos = judged.filter((x) => SENTIMENT_TONE[x.sentiment] === 'positive').length
  const neg = judged.filter((x) => SENTIMENT_TONE[x.sentiment] === 'negative').length
  const mid = judged.length - pos - neg

  /**
   * No photo hero.
   *
   * A watched page stores no picture, so a tall 4:5 panel had nothing to put
   * in it but a monogram on a wash — a huge empty rectangle above three small
   * numbers, which is the opposite of a dense board. The name simply heads the
   * card that carries the figures, which is where a reader is looking anyway.
   */
  const heading = (
    <div className="flex min-w-0 items-center gap-2.5">
      <PlatformBadge platform={influencer.platform} size={34} />
      <div className="min-w-0">
        <p className="truncate text-[14px] font-bold leading-tight">{name}</p>
        <p className="truncate text-[11.5px] text-ink-3">
          @{influencer.handle.replace(/^@/, '')}
          {influencer.followers != null && ` · ${compact(influencer.followers)} followers`}
        </p>
      </div>
    </div>
  )

  return (
    <div className="card card-hover flex flex-col gap-4 p-4">
      {/* The name heads the figures. The whole row is the tap target out to
          the profile when we hold a link for it. */}
      {influencer.url ? (
        <a
          href={influencer.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open ${name} on ${influencer.platform}`}
          className="group flex items-center justify-between gap-2 rounded-xl transition-colors hover:bg-[var(--surface-2)]"
        >
          {heading}
          <ExternalLink size={15} className="shrink-0 text-ink-3 transition-colors group-hover:text-[var(--accent)]" aria-hidden />
        </a>
      ) : (
        heading
      )}

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          <MiniStat
            icon={<Users size={15} />}
            label="Followers"
            value={influencer.followers != null ? compact(influencer.followers) : '—'}
            title={
              influencer.followers != null
                ? `${full(influencer.followers)} followers, read from the platform`
                : 'No follower reading yet'
            }
          />
          <MiniStat
            icon={<MessagesSquare size={15} />}
            label="Posts read"
            value={String(mentions.length)}
            title="Posts a check has brought back from this account"
          />
          <MiniStat
            icon={<Megaphone size={15} />}
            label="About you"
            value={String(aboutYou)}
            title="Posts a model judged to be about this office"
          />
        </div>

        {/* This account's sentiment, drawn only from posts a model read. Gated
            pages never reach a check, so most cards never show this — which is
            the honest outcome, not an empty ring. */}
        {judged.length > 0 && (
          // Wraps rather than squeezes: when the tile is too narrow for ring
          // plus legend side by side, the legend takes its own row.
          <div className="flex flex-wrap items-center gap-4">
            <DonutBreakdown
              segments={[
                { label: 'Positive', value: pos, color: 'var(--chart-pos)' },
                { label: 'Neutral or mixed', value: mid, color: 'var(--chart-mid)' },
                { label: 'Negative', value: neg, color: 'var(--chart-neg)' },
              ]}
              size={96}
              thickness={15}
              centerLabel={String(judged.length)}
              centerSub="read"
            />
            <div className="min-w-[9rem] flex-1">
              <p className="kicker">How it reads</p>
              <Legend
                className="mt-1.5"
                items={[
                  { label: 'Positive', color: 'var(--chart-pos)' },
                  { label: 'Neutral or mixed', color: 'var(--chart-mid)' },
                  { label: 'Negative', color: 'var(--chart-neg)' },
                ]}
              />
            </div>
          </div>
        )}

        {/* Why this page is on the list — provenance, kept in the account's own words. */}
        {influencer.note && (
          <p className="text-[11px] leading-relaxed text-ink-3">{influencer.note}</p>
        )}
      </div>
    </div>
  )
}

/* ── Screen ──────────────────────────────────────────────────────────────── */

/**
 * The words a check matches a post against, edited where the check happens.
 *
 * These lived only on the grievance desk's intake screen. So an office that
 * came here first — which is what happens, because this screen is in the
 * navigation and that step is four screens deep — pressed Check now and got
 * "no watch terms are set", with the fix on a page the message did not name and
 * no way to do anything about it from here. The check was working exactly as
 * built and the screen was useless.
 *
 * They are still the same list the desk uses: one office, one answer to "what
 * counts as being about us". Editing here edits there.
 */
function WatchTerms() {
  const store = useStore()
  const terms = store.profile?.watchTerms ?? []
  const [draft, setDraft] = useState('')

  const write = (next: string[]): void => {
    update((s) => ({
      ...s,
      profile: {
        // Spread FIRST, then fill required fields. Listing the fields without
        // the spread dropped every optional one on each edit — `district` most
        // damagingly, which the news scan needs to fetch a district edition.
        // Editing a watch word here silently widened the scan to the whole
        // state, which is the exact failure the comment on OfficeProfile.district
        // describes. A rebuild that names its fields goes stale the day someone
        // adds a field; the spread cannot.
        ...(s.profile ?? {}),
        subject: s.profile?.subject ?? 'This office',
        constituency: s.profile?.constituency ?? '',
        state: s.profile?.state ?? '',
        portals: s.profile?.portals ?? [],
        customPortalUrls: s.profile?.customPortalUrls ?? [],
        watchTerms: next,
      },
    }))
  }

  const add = (): void => {
    const value = draft.trim()
    if (!value || terms.some((t) => t.toLowerCase() === value.toLowerCase())) return
    write([...terms, value])
    setDraft('')
  }

  return (
    <Card>
      <CardHead
        icon={<Search size={16} />}
        title="Words that mean a post is about you"
        sub="Shared with the grievance desk"
        hint="One list for the whole office. Editing it here edits it everywhere a check runs."
        tint="violet"
      />
      <p className="text-xs leading-relaxed text-ink-2">
        We flag a post when it uses one of these words. Add the member&rsquo;s name, the Telugu
        spelling, the constituency, a scheme &mdash; whatever the channels actually say. Leave
        this empty and we will simply show you everything these accounts post.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="Eluru, ఏలూరు, the member's name…"
          aria-label="Add a word to look for"
          className="min-h-11 min-w-0 flex-1 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm shadow-[var(--e1)] outline-none transition-colors focus:border-[var(--accent)]"
        />
        <Button size="sm" variant="outline" onClick={add} disabled={!draft.trim()}>
          <Plus size={14} />
          Add
        </Button>
      </div>

      {terms.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {terms.map((t) => (
            <button
              key={t}
              onClick={() => write(terms.filter((x) => x !== t))}
              aria-label={`Stop looking for ${t}`}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-fg)]"
            >
              {t}
              <X size={11} />
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--warn)]">
          <TriangleAlert size={13} />
          No search words yet, so Check now will show you everything these accounts post.
        </p>
      )}
    </Card>
  )
}

export function Influencers({
  onClose,
  onRead,
}: {
  onClose: () => void
  /**
   * Run the full analysis on one mention's post.
   *
   * Owned by App rather than here, because the app has exactly one analysis in
   * flight at a time and one place that renders it. A second hook in this
   * screen would be a second source of truth for "is something running", and
   * the two would disagree the first time somebody started a run from the
   * paste box and then opened this list.
   */
  onRead: (mention: InfluencerMention) => void
}) {
  const store = useStore()
  const reduced = useReducedMotion()
  /**
   * Where a newly added account is watched for.
   *
   * Seeded from the desk's own seat rather than from a fixed list. It used to
   * fall back to the first of eight hardcoded Eluru segments, so an office
   * anywhere else silently filed every account it added under a constituency
   * four hundred kilometres away.
   */
  const places = useMemo(() => deskPlaces(store.profile), [store.profile])
  const [constituency] = useState<string>(
    store.profile?.constituency ?? places[0] ?? '',
  )
  const [busy, setBusy] = useState<'suggest' | 'check' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [capped, setCapped] = useState<string[]>([])

  /**
   * Did the last check run without usable search words?
   *
   * Drives the heading over the coverage card. Filing "we did not filter any of
   * this" under "What this check missed" read as an apology for a fault; it is
   * a description of the mode the office asked for.
   */
  const [unfilteredRead, setUnfilteredRead] = useState(false)

  /**
   * Sort and scope for the list below.
   *
   * The view defaults to "everything" when no search words are set, because in
   * that state nothing is marked as being about the office and defaulting to
   * "about you" would show an empty list directly under a result that just
   * fetched twenty posts.
   */
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')

  /**
   * Is there anything for the "about you" view to show?
   *
   * Keyed on the stored posts, NOT on whether search words are set. Keying it
   * on the words meant typing one retroactively emptied the screen: ninety-six
   * posts fetched under no words are all marked not-about-you, so the moment a
   * word existed the default flipped to a view that excluded every one of them
   * and the office watched their results vanish on a keystroke, with no check
   * having run. What is on screen should only ever change when the data does.
   */
  const hasAboutYou = store.mentions.some((x) => x.mentionsSubject)

  /**
   * `null` means "nobody has chosen", so the default can follow the terms.
   *
   * Not a useState default, because what it should default to is not known at
   * mount: the desk seeds itself in an effect that runs after the first render,
   * and a check can land later still. Deriving it each render fixes that, and
   * the moment somebody touches the control their choice sticks.
   */
  const [viewChoice, setViewChoice] = useState<'about' | 'all' | null>(null)
  const view: 'about' | 'all' = viewChoice ?? (hasAboutYou ? 'about' : 'all')
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [verified, setVerified] = useState<{ checked: number; discarded: number; added: number } | null>(null)

  /* ── Derived ───────────────────────────────────────────────────────────── */

  const byInfluencer = useMemo(() => {
    const map = new Map<string, Influencer>()
    for (const inf of store.influencers) map.set(inf.id, inf)
    return map
  }, [store.influencers])

  /** Every stored post, grouped by the account that published it. */
  const mentionsByInfluencer = useMemo(() => {
    const map = new Map<string, InfluencerMention[]>()
    for (const x of store.mentions) {
      const list = map.get(x.influencerId)
      if (list) list.push(x)
      else map.set(x.influencerId, [x])
    }
    return map
  }, [store.mentions])

  /**
   * How the judged coverage splits by sentiment — for the one donut.
   *
   * Only posts a model actually read count. An unfiltered listing holds its
   * struct-default "Neutral", and charting defaults as findings would invent a
   * calm the data never measured.
   */
  const sentimentSplit = useMemo(() => {
    const judged = store.mentions.filter((x) => x.judged !== false)
    const pos = judged.filter((x) => SENTIMENT_TONE[x.sentiment] === 'positive').length
    const neg = judged.filter((x) => SENTIMENT_TONE[x.sentiment] === 'negative').length
    return { judged: judged.length, pos, neg, mid: judged.length - pos - neg }
  }, [store.mentions])

  /** The accounts producing the most of what is on this screen, ranked. */
  const topVoices = useMemo(() => {
    const counts = new Map<string, number>()
    for (const x of store.mentions) counts.set(x.influencerId, (counts.get(x.influencerId) ?? 0) + 1)
    return [...counts.entries()]
      .map(([id, count]) => ({ influencer: byInfluencer.get(id) ?? null, count }))
      .filter((r): r is { influencer: Influencer; count: number } => r.influencer !== null)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  }, [store.mentions, byInfluencer])

  /* ── What is new ───────────────────────────────────────────────────────── */

  /**
   * When a post went up, for ordering.
   *
   * `postedAt` is what the platform says and it is what a reader means by
   * "latest". It is nullable, so `seenAt` — when we read it — is the fallback.
   * Ordering on `seenAt` alone was the bug: every post from one check shares a
   * timestamp to the millisecond, so a batch of twenty came out in whatever
   * order the accounts happened to be read in, and the newest video of the day
   * could sit below a clip from last month.
   */
  const postedTime = (x: InfluencerMention): number | null => {
    const posted = x.postedAt ? Date.parse(x.postedAt) : Number.NaN
    return Number.isNaN(posted) ? null : posted
  }

  /**
   * Undated posts go last, whichever way the sort runs.
   *
   * Falling back to `seenAt` put them at the top of "Newest first" — seenAt is
   * the time of the last check, so an undated post always looks like the most
   * recent thing that exists, and it would sit above a video published an hour
   * ago, permanently. Gated platforms are the ones that publish no date, so
   * that was a standing false top-of-list. Sinking them under BOTH orders is
   * the only arrangement that never claims a date it does not have; the server
   * already does exactly this in `newestFirst`.
   */
  const byDate = (a: InfluencerMention, b: InfluencerMention, dir: 'newest' | 'oldest'): number => {
    const ta = postedTime(a)
    const tb = postedTime(b)
    if (ta === null && tb === null) return Date.parse(b.seenAt) - Date.parse(a.seenAt)
    if (ta === null) return 1
    if (tb === null) return -1
    return dir === 'newest' ? tb - ta : ta - tb
  }

  /**
   * What the list shows, in the order asked for.
   *
   * `view` exists because a check with no search words set returns everything
   * the accounts posted, and none of it claims to be about this office. Under
   * the old fixed `mentionsSubject` filter that whole result would have been
   * fetched and then hidden, which is the most confusing possible outcome. It
   * also earns its keep with words set: "everything" is how you find out that a
   * channel you watch has gone quiet about you but is posting constantly.
   */
  const mentions = useMemo(() => {
    const rows = view === 'all' ? [...store.mentions] : store.mentions.filter((x) => x.mentionsSubject)
    return rows.sort((a, b) => byDate(a, b, sort))
  }, [store.mentions, view, sort])

  /**
   * Not yet cleared by a person. The only count worth putting a badge on.
   *
   * Computed from the STORE, not from the filtered list above, and that is
   * load-bearing. The badge, the page subtitle and the "Clear all" button all
   * read this number. Deriving it from a filtered view would mean narrowing the
   * filter appeared to clear the inbox — the office would switch to "only posts
   * about you", watch "12 new" drop to "2 new", and reasonably believe ten
   * items had gone somewhere. A filter changes what you are looking at; it must
   * never change what is waiting for you.
   */
  const unread = useMemo(() => store.mentions.filter(isWaiting), [store.mentions])

  /** Waiting AND actually about the office — the only thing worth alarming over. */
  const alarming = useMemo(
    () => unread.filter((x) => x.judged !== false && x.mentionsSubject),
    [unread],
  )

  /* ── Actions ───────────────────────────────────────────────────────────── */

  const acknowledge = useCallback((id: string) => {
    update((s) => ({
      ...s,
      mentions: s.mentions.map((x) => (x.id === id ? { ...x, acknowledged: true } : x)),
    }))
  }, [])

  const acknowledgeAll = useCallback(() => {
    update((s) => ({ ...s, mentions: s.mentions.map((x) => ({ ...x, acknowledged: true })) }))
  }, [])

  /** Shared by both ways onto the roster, so neither can drift from the other. */
  const tracked = useCallback(
    (platform: Platform, handle: string) =>
      readStore().influencers.some(
        (i) => i.platform === platform && i.handle.toLowerCase() === handle.toLowerCase(),
      ),
    [],
  )

  const addInfluencer = useCallback((influencer: Influencer) => {
    update((s) => ({
      ...s,
      influencers: s.influencers.some((i) => i.id === influencer.id)
        ? s.influencers
        : [...s.influencers, influencer],
    }))
  }, [])

  /**
   * Read the watched accounts again.
   *
   * The roster comes from the store rather than from anything on screen: it is
   * filled automatically by the morning scan, and there is no longer a list here
   * for somebody to curate.
   */
  const check = useCallback(async () => {
    const current = readStore()
    if (current.influencers.length === 0) {
      setError(
        'You are not watching any accounts yet. Tap Suggest and we will find the channels people follow around here.',
      )
      return
    }

    // No guard on the search words on purpose. With none set the server reads
    // the accounts anyway and hands back everything it found, unjudged — see
    // the `unfiltered` path in lib/influencers.ts. Blocking the read until a
    // word was typed meant an office could not look at its own channels until
    // it had already guessed what to look for.
    const watchTerms = current.profile?.watchTerms ?? []

    /**
     * Start where the last check stopped.
     *
     * The server reads the first N of whatever it is sent. Sending the roster
     * rotated means N moves down the list on every check instead of pinning to
     * the top, so an office with more accounts than one check can cover reaches
     * all of them by checking again — which is what the coverage note now tells
     * them to do. Before this, that advice would have been false.
     */
    const roster = current.influencers
    const offset = roster.length > 0 ? current.influencerScanOffset % roster.length : 0
    const rotated = offset === 0 ? roster : [...roster.slice(offset), ...roster.slice(0, offset)]

    setBusy('check')
    setError(null)
    setCapped([])

    try {
      const res = await fetchWithTimeout('/api/influencers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ influencers: rotated, watchTerms }),
      })
      const parsed: unknown = await res.json()
      const body = isRecord(parsed) ? parsed : {}

      if (!res.ok) {
        setError(text(body['error']) ?? 'We could not read those accounts. Try again in a minute.')
        return
      }

      const incoming = (Array.isArray(body['mentions']) ? body['mentions'] : [])
        .map(toMention)
        .filter(nonNull)

      // How many accounts the server actually got through: one coverage row per
      // account attempted, readable or not. Taken from the response rather than
      // assumed, so the cursor cannot drift out of step with the server's cap.
      const read = Array.isArray(body['coverage']) ? body['coverage'].length : 0

      /**
       * Was this response judged by a model, or is it a raw listing?
       *
       * Mirrors the server's own test: it drops terms shorter than two
       * characters, and reads unfiltered when nothing survives. Getting this
       * wrong in either direction only costs a refresh, but getting it right
       * prevents the overwrite below.
       */
      const judged = watchTerms.filter((t) => t.trim().length >= 2).length > 0

      update((s) => {
        // Keyed on the post, so re-reading a channel does not file the same
        // video twice — and a mention already cleared stays cleared.
        const byId = new Map(s.mentions.map((x) => [x.postUrl, x]))
        for (const row of incoming) {
          const existing = byId.get(row.postUrl)
          // An unjudged row must never overwrite a judged one. A check with no
          // search words returns every post with stance "unclear" and no fake
          // assessment; letting that land on top of a post a model had already
          // read as hostile would silently downgrade it and drop it out of the
          // about-you view. The post itself has not changed — only how much we
          // know about it — so the richer record wins.
          if (existing && !judged) continue
          byId.set(row.postUrl, existing ? { ...row, acknowledged: existing.acknowledged } : row)
        }
        return {
          ...s,
          mentions: pruneMentions([...byId.values()]),
          // Advance past what was just read. Modulo the CURRENT roster length,
          // which may have grown while the check was in flight.
          influencerScanOffset:
            s.influencers.length > 0 ? (offset + read) % s.influencers.length : 0,
        }
      })

      setCapped(
        (Array.isArray(body['capped']) ? body['capped'] : []).filter(
          (c): c is string => typeof c === 'string',
        ),
      )
      setUnfilteredRead(!judged)
      setCheckedAt(new Date().toISOString())
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }, [])

  /** Find the channels with an audience in this seat. */
  const suggest = useCallback(async () => {
    const subject = readStore().profile?.subject?.trim()
    if (!subject) {
      setError('Set up the desk first. We need to know whose name to search for.')
      return
    }

    setBusy('suggest')
    setError(null)
    setVerified(null)

    try {
      const res = await fetch(
        `/api/influencers?constituency=${encodeURIComponent(constituency)}&subject=${encodeURIComponent(subject)}`,
      )
      const parsed: unknown = await res.json()
      const body = isRecord(parsed) ? parsed : {}

      if (!res.ok) {
        setError(text(body['error']) ?? 'We could not find any accounts just now. Try again in a minute.')
        return
      }

      const found = (Array.isArray(body['influencers']) ? body['influencers'] : [])
        .map(toInfluencer)
        .filter(nonNull)

      const known = new Set(readStore().influencers.map((x) => x.id))
      const fresh = found.filter((x) => !known.has(x.id))
      if (fresh.length > 0) {
        update((s) => ({ ...s, influencers: [...s.influencers, ...fresh] }))
      }

      setVerified({
        checked: number(body['checked']) ?? 0,
        discarded: number(body['discarded']) ?? 0,
        added: fresh.length,
      })
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }, [constituency])

  /* ── Render ────────────────────────────────────────────────────────────── */

  return (
    <m.div
      className="shell shell-wide page-end"
      variants={listStagger}
      initial={reduced ? false : 'hidden'}
      animate="show"
    >
      <m.header variants={fadeUp}>
        <PageHeader
          lead={
            <Mascot
              // The alarm face is for something said about the office, not for
              // a listing nobody has read. An unjudged pile is work waiting,
              // which is not the same as bad news.
              state={busy ? 'thinking' : alarming.length > 0 ? 'error' : 'idle'}
              size={40}
              className="mt-1 shrink-0"
            />
          }
          title="Influencer watch"
          subtitle={
            store.influencers.length
              ? `You are watching ${store.influencers.length} ${store.influencers.length === 1 ? 'account' : 'accounts'}. ${unread.length > 0 ? `${unread.length} waiting for you.` : 'Nothing new right now.'}`
              : 'The pages and channels that move opinion where you work.'
          }
          actions={
            <Button variant="ghost" onClick={onClose}>
              Back
            </Button>
          }
        />
      </m.header>

      <m.div variants={fadeUp} className="mt-4">
        <WatchTerms />
      </m.div>

      {/* Two ways onto the roster, and both end in a live read before anything
          is stored. Search covers YouTube, which is the only platform that
          answers a query from a server; everything else has to be named. This
          is the screen's one lifted panel: the roster fills itself, so the
          thing worth a reader's first look is how to steer it. */}
      <m.div variants={fadeUp} className="mt-4">
        <Card level="lift" className="space-y-5">
          <SearchInfluencers
            constituency={store.identity?.constituency ?? null}
            suggestedQuery={
              [store.identity?.constituency, store.identity?.state].find(Boolean)
                ? `${[store.identity?.constituency, store.identity?.state].find(Boolean)} politics`
                : ''
            }
            isTracked={tracked}
            onAdd={addInfluencer}
          />

          <div className="border-t border-[var(--border)] pt-5">
            <AddInfluencer
              constituency={store.identity?.constituency ?? null}
              isTracked={tracked}
              onAdd={addInfluencer}
            />
          </div>
        </Card>
      </m.div>

      <m.div variants={fadeUp} className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void check()} disabled={busy !== null}>
          {busy === 'check' ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          {busy === 'check' ? 'Reading…' : 'Check now'}
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => void suggest()}
          disabled={busy !== null || !constituency}
        >
          <Search size={14} />
          {busy === 'suggest' ? 'Searching…' : `Suggest for ${constituency || 'this seat'}`}
        </Button>

        {unread.length > 0 && (
          <Button size="sm" variant="ghost" onClick={acknowledgeAll}>
            <Check size={14} />
            Clear all
          </Button>
        )}

        {checkedAt && (
          <span className="text-xs text-ink-3">We last read these {relativeTime(checkedAt)}.</span>
        )}
      </m.div>

      {error && (
        <m.p variants={fadeUp} role="alert" className="mt-3 text-sm text-[var(--neg)]">
          {error}
        </m.p>
      )}

      {verified && (
        <m.p variants={fadeUp} className="mt-3 text-sm text-ink-2">
          We opened {verified.checked} {verified.checked === 1 ? 'channel' : 'channels'},{' '}
          {verified.discarded} would not load, and added {verified.added} to your list.
        </m.p>
      )}

      {/* ── The roster, as profile cards ─────────────────────────────────────
          Read-only on purpose. The curated watch list went away because
          `seedInfluencers` in lib/morning-scan.ts maintains the roster itself;
          what remains worth showing is who is on it and what this device
          actually knows about each of them. */}
      {store.influencers.length > 0 && (
        <m.section variants={fadeUp} className="mt-6">
          <SectionTitle hint="Filled by the morning scan and by anything you add above. Follower counts come from the platforms themselves.">
            Who you are watching
            <span className="ml-2 text-sm font-normal text-ink-3">{store.influencers.length}</span>
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
            {store.influencers.map((inf) => (
              <InfluencerCard
                key={inf.id}
                influencer={inf}
                mentions={mentionsByInfluencer.get(inf.id) ?? []}
              />
            ))}
          </div>
        </m.section>
      )}

      {/* ── What the coverage adds up to ─────────────────────────────────────
          One donut, one ranked board — both derived from the same stored posts
          the list below shows, so they can never disagree with it. */}
      {(sentimentSplit.judged > 0 || topVoices.length > 0) && (
        <m.div
          variants={fadeUp}
          // Two columns only when both cards exist — a lone card in a half-width
          // track left the other half of the row as orphan white space.
          className={cn(
            'mt-6 grid items-start gap-4',
            sentimentSplit.judged > 0 && topVoices.length > 0 && 'lg:grid-cols-2',
          )}
        >
          {sentimentSplit.judged > 0 && (
            <Card>
              {/* The sub keeps the honesty mark short enough to survive a 375px
                  head; the full provenance sentence rides the hint. */}
              <CardHead
                icon={<MessagesSquare size={16} />}
                title="How the coverage reads"
                sub="Unjudged listings are not counted"
                hint="Sentiment across the posts a model has actually read. Unjudged listings are not counted."
                tint="violet"
              />
              {/* Ring above legend on a phone; ring beside a stacked legend
                  from sm up, the reference-5 arrangement. */}
              <div className="flex flex-col items-center gap-4 pt-2 sm:flex-row sm:justify-center sm:gap-8">
                <DonutBreakdown
                  segments={[
                    { label: 'Positive', value: sentimentSplit.pos, color: 'var(--chart-pos)' },
                    { label: 'Neutral or mixed', value: sentimentSplit.mid, color: 'var(--chart-mid)' },
                    { label: 'Negative', value: sentimentSplit.neg, color: 'var(--chart-neg)' },
                  ]}
                  size={150}
                  centerLabel={String(sentimentSplit.judged)}
                  centerSub="posts read"
                />
                <Legend
                  className="justify-center sm:flex-col sm:items-start sm:gap-y-2"
                  items={[
                    { label: 'Positive', color: 'var(--chart-pos)' },
                    { label: 'Neutral or mixed', color: 'var(--chart-mid)' },
                    { label: 'Negative', color: 'var(--chart-neg)' },
                  ]}
                />
              </div>
            </Card>
          )}

          {topVoices.length > 0 && (
            <Card>
              <CardHead
                icon={<Megaphone size={16} />}
                title="Most heard from"
                sub="Ranked by posts we have read"
                hint="The accounts behind the posts on this screen, by how many we have read."
                tint="blue"
              />
              <div>
                {topVoices.map((r, i) => (
                  <RankRow
                    key={r.influencer.id}
                    rank={i + 1}
                    tint={i === 0 ? 'violet' : 'blue'}
                    label={
                      <span className="flex min-w-0 items-center gap-2">
                        <PlatformBadge platform={r.influencer.platform} size={20} />
                        <span className="truncate">
                          {r.influencer.displayName ?? r.influencer.handle}
                        </span>
                      </span>
                    }
                    value={`${r.count} ${r.count === 1 ? 'post' : 'posts'}`}
                  />
                ))}
              </div>
            </Card>
          )}
        </m.div>
      )}

      {/* One column.

          The right-hand column was the watch list — a roster of accounts added
          and removed by hand. It has gone, because nothing needs a person to
          maintain it any more: `seedInfluencers` in lib/morning-scan.ts finds
          the accounts with an audience in this seat and writes them itself, and
          both the check here and the automatic one read that roster from the
          store rather than from anything on screen. A list somebody curates,
          beside a list the app curates for them, was two answers to one
          question. */}
      <m.section variants={fadeUp} className="mt-6">
        <SectionTitle
          hint={
            view === 'all'
              ? 'Everything the channels you watch have posted recently.'
              : 'What the channels people follow around here are saying about you.'
          }
        >
          To look at
          {unread.length > 0 && (
            <span className="ml-2 text-sm font-normal text-ink-3">{unread.length} new</span>
          )}
        </SectionTitle>

        {capped.length > 0 && (
          <div className="mb-3 flex gap-2.5 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4">
            <Info size={15} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {unfilteredRead ? 'About this check' : 'What this check missed'}
              </p>
              <ul className="mt-1.5 space-y-1">
                {capped.map((line) => (
                  <li key={line} className="text-sm leading-relaxed text-ink-2">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Same row pattern as the grievance filters: one line that scrolls
            sideways inside itself on a phone and wraps on a desktop, so the
            page body never scrolls sideways. */}
        {store.mentions.length > 0 && (
          <div className="-mx-4 mb-3 flex items-center gap-2 overflow-x-auto px-4 pb-1 scroller lg:mx-0 lg:flex-wrap lg:overflow-x-visible lg:px-0">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value === 'oldest' ? 'oldest' : 'newest')}
              aria-label="Order posts by date"
              className={cn(selectClass, sort === 'oldest' && 'select-active')}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>

            <select
              value={view}
              onChange={(e) => setViewChoice(e.target.value === 'all' ? 'all' : 'about')}
              aria-label="Which posts to show"
              className={cn(selectClass, view === 'all' && 'select-active')}
            >
              <option value="about">Only posts about you</option>
              <option value="all">Everything we read</option>
            </select>

            <span className="shrink-0 text-sm text-ink-3">
              {mentions.length} {mentions.length === 1 ? 'post' : 'posts'}
            </span>
          </div>
        )}

        {mentions.length === 0 ? (
          <Empty
            icon={<ScanEye size={18} />}
            title="Nothing yet"
            body={
              store.influencers.length === 0
                ? 'You are not watching anything yet. Tap Suggest to find the channels people follow around here.'
                : view === 'about' && store.mentions.length > 0
                  ? 'None of the posts we read mention you. Switch to “Everything we read” above to see what these accounts did post.'
                  : 'These accounts have not posted anything that mentions you. Tap Check now to read them again.'
            }
          />
        ) : (
          <m.ul className="space-y-3" variants={listStagger}>
            {mentions.map((mention) => (
              <m.li key={mention.id} variants={listItem}>
                <MentionRow
                  mention={mention}
                  influencer={byInfluencer.get(mention.influencerId) ?? null}
                  onAcknowledge={acknowledge}
                  onRead={onRead}
                />
              </m.li>
            ))}
          </m.ul>
        )}
      </m.section>
    </m.div>
  )
}

/* ── Rows ────────────────────────────────────────────────────────────────── */
function MentionRow({
  mention,
  influencer,
  onAcknowledge,
  onRead,
}: {
  mention: InfluencerMention
  influencer: Influencer | null
  onAcknowledge: (id: string) => void
  /** Hand this post to the full analysis pipeline — the paste box's own route. */
  onRead: (mention: InfluencerMention) => void
}) {
  const open = !mention.acknowledged
  const fake = mention.fake
  /**
   * Whether the full reading is showing.
   *
   * The card carried the whole analysis already — stance, sentiment, the fake
   * assessment and every signal behind it — and showed a four-line clamp of the
   * excerpt with no way to get at the rest. The only clickable thing on it was
   * a link straight out to the publisher, so the one action the card offered
   * was to leave and read the story yourself, which is the work this screen
   * exists to have already done.
   */
  const [expanded, setExpanded] = useState(false)

  /**
   * Listed, not read. Everything below that looks like a judgement is hidden.
   *
   * `judged` is absent on records stored before unfiltered checks existed, and
   * every one of those came from the scored path — so only an explicit false
   * counts.
   */
  const unjudged = mention.judged === false

  return (
    // Not an <li>: the caller already wraps this in one. Two nested list items
    // is invalid markup and ran the stagger variant twice on every card.
    <article
        className={cn(
          'card p-4 sm:p-5',
          // Colour alone never carries "unread": the left rule is reinforced
          // by the "New" chip in the header row.
          open && 'border-l-4 border-l-[var(--accent)]',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {influencer && <PlatformBadge platform={influencer.platform} size={30} />}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">
                {influencer?.displayName ?? influencer?.handle ?? 'Account removed'}
              </p>
              <p className="mt-0.5 text-xs text-ink-3">
                {mention.postedAt
                  ? relativeTime(mention.postedAt)
                  : `No date on this one. We read it ${relativeTime(mention.seenAt)}`}
              </p>
            </div>
          </div>
          {open && (
            <Chip tone="accent" className="shrink-0">
              New
            </Chip>
          )}
        </div>

        {/* Nothing read this post, so it gets no verdict chips.
            The row below used to render regardless, which meant a post nobody
            had assessed still displayed a stance, a sentiment, and a "Not about
            you" chip whose tooltip said one of your words had appeared — a
            thing that cannot have happened, because with no words set nothing
            was matched. Those values are struct defaults, not findings. */}
        {unjudged ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Chip tone="neutral" title="This came from a check with no search words set, so it was listed rather than read.">
              Not read yet
            </Chip>
          </div>
        ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip tone={STANCE_TONE[mention.stance]}>{STANCE_LABEL[mention.stance]}</Chip>
          <Chip tone={SENTIMENT_CHIP[SENTIMENT_TONE[mention.sentiment]] ?? 'neutral'}>
            {mention.sentiment}
          </Chip>
          {!mention.mentionsSubject && (
            <Chip tone="neutral" title="One of your words showed up, but the post turned out to be about something else">
              Not about you
            </Chip>
          )}
          {fake && (
            <Chip
              tone={fake.suspicion === 'Yes' ? 'negative' : 'warning'}
              icon={<TriangleAlert size={12} />}
              title={[`Suspicion: ${fake.suspicion}`, fake.note].filter(Boolean).join('. ')}
            >
              {/* The suspicion level rode in the label as a raw enum, so this
                  chip read "Fabricated quote · Yes" — a data dump. The type is
                  the useful half; the level moves into the tooltip. */}
              {fake.type ?? 'Needs checking'}
            </Chip>
          )}
        </div>
        )}

        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-2.5 block w-full text-left"
        >
          <span
            className={cn(
              'block text-sm leading-relaxed text-ink-2',
              expanded ? 'whitespace-pre-line' : 'line-clamp-4',
            )}
          >
            {mention.excerpt}
          </span>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)]">
            {/* Nothing worked out what this says about anyone, so the link
                does not offer to tell you. */}
            {expanded ? 'Show less' : unjudged ? 'Show the whole post' : 'What this says about you'}
            <ChevronRight
              size={12}
              aria-hidden
              className={cn('transition-transform', expanded && 'rotate-90')}
            />
          </span>
        </button>

        {expanded && (
          <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
            <div>
              {/* An unjudged post has no reading, so it does not get a sentence
                  that sounds like one. "Unclear towards you, neutral in tone"
                  is not a finding — it is three struct defaults read aloud, and
                  an office would take it for an assessment. */}
              <p className="kicker">{unjudged ? 'What we know' : 'How it reads'}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
                {unjudged ? (
                  <>
                    Nobody has read this one yet. It came back from a check with no search
                    words set, so we listed it without working out whether it is about you or
                    what it says
                    {influencer?.followers
                      ? `. The account has ${influencer.followers.toLocaleString('en-IN')} followers`
                      : ''}
                    . Add a search word and check again, or open it and read it yourself.
                  </>
                ) : (
                  <>
                    {STANCE_SENTENCE[mention.stance]} towards you, {mention.sentiment.toLowerCase()}{' '}
                    in tone
                    {influencer?.followers
                      ? `, from an account ${influencer.followers.toLocaleString('en-IN')} people follow`
                      : ''}
                    .
                  </>
                )}
              </p>
            </div>

            {/* Every signal behind the flag, not just the verdict. A card that
                says "possibly false" and will not say why is an accusation an
                office cannot defend, and this product is in the business of the
                opposite. */}
            {fake && fake.signals.length > 0 && (
              <div>
                <p className="kicker">What we spotted</p>
                <ul className="mt-1.5 space-y-2">
                  {fake.signals.map((signal, i) => (
                    <li key={`${signal.kind}-${i}`} className="flex gap-2 text-sm leading-relaxed">
                      <span
                        aria-hidden
                        className={cn(
                          'mt-1.5 size-1.5 shrink-0 rounded-full',
                          signal.supports === 'fabricated'
                            ? 'bg-[var(--neg)]'
                            : signal.supports === 'authentic'
                              ? 'bg-[var(--pos)]'
                              : 'bg-[var(--border-strong)]',
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block text-ink-2">{signal.finding}</span>
                        <span className="mt-0.5 block text-xs text-ink-3">
                          {signal.kind} · {signal.confidence} confidence
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {fake && fake.signals.length === 0 && fake.suspicion === 'No' && (
              <p className="text-sm leading-relaxed text-ink-2">
                Nothing about this one looked fabricated. It is ordinary coverage.
              </p>
            )}
          </div>
        )}

        {fake?.note && (
          <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-sm)] bg-[var(--warn-soft)] px-3 py-2 text-xs leading-relaxed text-ink-2">
            <TriangleAlert size={13} className="mt-0.5 shrink-0 text-[var(--warn)]" aria-hidden />
            <span>{fake.note} Nobody has checked this yet, so someone should take a look.</span>
          </p>
        )}

        {/* Wraps: on a 375px card an unread row carries the link plus two
            buttons, which is wider than the card — squeezing them shrank the
            tap targets instead of moving one to the next line. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <a
            href={mention.postUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-[var(--accent)]"
          >
            <ExternalLink size={13} />
            Open the post
          </a>

          {/* The same analysis the paste box runs, on the post this card is
              about. "Open the post" sends the reader off to do the reading
              themselves, which is the work this screen exists to have already
              done — this does it here instead. */}
          <Button size="sm" variant="outline" onClick={() => onRead(mention)}>
            <ScanEye size={14} />
            Read it fully
          </Button>

          {open && (
            <Button size="sm" variant="ghost" onClick={() => onAcknowledge(mention.id)}>
              <Check size={14} />
              Clear
            </Button>
          )}
        </div>
      </article>
  )
}
