import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  Pencil,
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
import {
  VOICE_KIND_HINT,
  VOICE_KIND_ICON,
  VOICE_KIND_LABEL,
  voiceAffiliationOf,
  voiceKindOf,
  type VoiceKind,
} from './briefing/InfluencerVoices'
import { AddInfluencer, SearchInfluencers } from './AddInfluencer'
import { useInfluencerRoster } from '@/components/settings/DeskConfig'
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

/**
 * Mirrors InfluencerMention['about']. Guarded the same way STANCES is, so a
 * value the shared type grows and this list lacks stops the build.
 *
 * There is no fallback member on purpose. A reading that did not say what a
 * post is about carries no `about` at all, because the news digest groups on
 * this field and a default would file every unanswered post under the member's
 * own name.
 */
const ABOUTS = ['person', 'party', 'seat'] as const satisfies readonly NonNullable<
  InfluencerMention['about']
>[]

/**
 * The chip. Deliberately not the member's own name.
 *
 * The dashboard's news list substitutes the identity into these, which reads
 * well beside a headline. Here the chip sits directly under the account that
 * wrote the post, in a column of posts that are all about the same office, so
 * repeating the name on every row is noise. "About you" carries the same
 * claim in three characters.
 */
const ABOUT_LABEL: Record<NonNullable<InfluencerMention['about']>, string> = {
  person: 'About you',
  party: 'About your party',
  seat: 'About your seat',
}

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

/**
 * A stored account, plus the two fields the shared record cannot carry yet.
 *
 * Discovery decides whether a channel is an outlet, a commentator speaking in
 * their own name or an account campaigning for a party, and sends that
 * alongside the shared fields. `Influencer` in shared/grievance.ts has nowhere
 * to put it, so it rides as two optional extras that the store keeps and
 * `voiceKindOf` reads back. An account somebody typed in by hand has neither,
 * and reads as "kind not known" rather than being guessed at.
 */
interface StoredVoice extends Influencer {
  kind?: VoiceKind
  affiliation?: string | null
}

function toInfluencer(raw: unknown): StoredVoice | null {
  if (!isRecord(raw)) return null
  const handle = text(raw['handle'])
  const id = text(raw['id'])
  const platform = PLATFORM_OPTIONS.find((p) => p === raw['platform'])
  if (!handle || !id || !platform) return null

  // Narrowed through the same reader the screen renders with, so a response
  // carrying a kind this build does not know about becomes "unclear" rather
  // than a chip with a raw string in it.
  const kind = voiceKindOf(raw)
  const affiliation = voiceAffiliationOf(raw)

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
    kind,
    affiliation,
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
    // Only when the reading actually said. The server omits it whenever the
    // desk did not supply a name, a party and a seat, and an absent field here
    // has to stay absent rather than becoming "person".
    ...(ABOUTS.some((a) => a === raw['about'])
      ? { about: oneOf(raw['about'], ABOUTS, 'person') }
      : {}),
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
/**
 * What kind of voice this is, as a chip.
 *
 * Shared by the roster card and the focused panel, because the two saying
 * different words about one account is a class of bug this app has already
 * had. An aligned account shows the party it works for instead of the generic
 * label, since "BJP" is the useful half and "Party account" is the category.
 */
function KindChip({ influencer }: { influencer: Influencer }) {
  const kind = voiceKindOf(influencer)
  const affiliation = voiceAffiliationOf(influencer)
  return (
    <Chip
      tone={kind === 'aligned' ? 'warning' : kind === 'unclear' ? 'neutral' : 'info'}
      icon={VOICE_KIND_ICON[kind]}
      title={
        affiliation
          ? `${VOICE_KIND_HINT[kind]} It campaigns for ${affiliation}.`
          : VOICE_KIND_HINT[kind]
      }
    >
      {/* Capped: a Chip does not wrap, and a party's full name is long enough
          to push a 375px card sideways. The full name rides the tooltip. */}
      <span className="block max-w-[10rem] truncate">
        {kind === 'aligned' && affiliation ? affiliation : VOICE_KIND_LABEL[kind]}
      </span>
    </Chip>
  )
}

function InfluencerCard({
  influencer,
  mentions,
  focused,
  onOpen,
}: {
  influencer: Influencer
  mentions: InfluencerMention[]
  /** Ringed, so the card the panel above is about is findable in the grid. */
  focused: boolean
  onOpen: (influencerId: string) => void
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
    <div
      className={cn(
        'card card-hover flex flex-col gap-4 p-4',
        focused && 'ring-2 ring-[var(--accent)]',
      )}
    >
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
        {/* An outlet and a party worker are read differently, so the card says
            which this is before it says anything else about it. */}
        <div className="flex flex-wrap gap-1.5">
          <KindChip influencer={influencer} />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <MiniStat
            icon={<Users size={15} />}
            label="Followers"
            value={influencer.followers != null ? compact(influencer.followers) : 'NA'}
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

        {/* The same action the dashboard's voices section offers, so an office
            that arrives here directly is not worse off than one that came
            through a link. */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onOpen(influencer.id)}
          disabled={focused}
        >
          <ScanEye size={14} />
          {focused ? 'Showing this account' : 'Full analysis'}
        </Button>
      </div>
    </div>
  )
}

/**
 * One account, opened.
 *
 * The panel the dashboard sends a reader to. It carries nothing the roster
 * card does not already hold, and that is deliberate: the numbers here are the
 * same numbers, counted the same way, so an office cannot come away with two
 * different readings of one account depending on which screen it looked at.
 * What it adds is scope. While this is open the post list below shows only
 * this account, which is what "the whole analysis of it" means in practice.
 */
function VoiceDetail({
  influencer,
  mentions,
  onClearFocus,
}: {
  influencer: Influencer
  mentions: InfluencerMention[]
  onClearFocus: () => void
}) {
  const name = influencer.displayName ?? influencer.handle

  /**
   * Split the stored posts the same way the rest of the app does.
   *
   * `judged !== false` first, because an unfiltered listing holds a
   * struct-default stance and counting those would invent a calm nothing
   * measured. A judged post with stance "unclear" is counted apart again: a
   * model read it and could not call it, which is a different thing from
   * nobody having read it, and an office acts differently on each.
   */
  const judged = mentions.filter((x) => x.judged !== false)
  const unread = mentions.length - judged.length
  const aboutYou = judged.filter((x) => x.mentionsSubject)
  const supportive = aboutYou.filter((x) => x.stance === 'supportive').length
  const critical = aboutYou.filter((x) => x.stance === 'critical').length
  const neutral = aboutYou.filter((x) => x.stance === 'neutral').length
  const unclear = aboutYou.filter((x) => x.stance === 'unclear').length
  const suspect = judged.filter((x) => x.fake !== null && x.fake.suspicion !== 'No').length

  /**
   * One sentence, assembled from the counts that are not zero.
   *
   * Never a template with holes in it. "0 supportive posts" reads as a finding
   * about an account nobody has finished reading, and this screen exists to
   * stop exactly that.
   */
  const parts = [
    critical > 0 ? `${critical} critical` : null,
    supportive > 0 ? `${supportive} supportive` : null,
    neutral > 0 ? `${neutral} neither way` : null,
  ].filter((x): x is string => x !== null)

  return (
    // Accent-bordered rather than lifted: the search panel below is this
    // screen's one lifted card, and two panels competing for first read is how
    // a screen stops having a first read at all.
    <Card tone="accent">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <PlatformBadge platform={influencer.platform} size={38} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold leading-tight">{name}</p>
            <p className="truncate text-xs text-ink-3">
              @{influencer.handle.replace(/^@/, '')}
              {influencer.constituency ? ` · watched for ${influencer.constituency}` : ''}
            </p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onClearFocus}>
          Show every account
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <KindChip influencer={influencer} />
        <Chip
          tone="neutral"
          title={
            influencer.followers != null
              ? `${full(influencer.followers)} followers, read from the platform`
              : 'Nothing has read this account’s follower count yet.'
          }
        >
          {influencer.followers != null
            ? `${compact(influencer.followers)} followers`
            : 'Followers not read'}
        </Chip>
        {suspect > 0 && (
          <Chip tone="negative" icon={<TriangleAlert size={11} />}>
            {suspect} {suspect === 1 ? 'claim needs' : 'claims need'} checking
          </Chip>
        )}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-ink-2">
        {aboutYou.length === 0 ? (
          <>
            We hold {mentions.length} {mentions.length === 1 ? 'post' : 'posts'} from this account
            and none of them has been read as being about you.
          </>
        ) : (
          <>
            {aboutYou.length} of the {mentions.length} posts we hold from this account are about
            you{parts.length > 0 ? `: ${parts.join(', ')}` : ''}.
            {unclear > 0 && (
              <>
                {' '}
                {unclear} {unclear === 1 ? 'was' : 'were'} read and too short to call either way.
              </>
            )}
          </>
        )}
        {unread > 0 && (
          <>
            {' '}
            {unread} {unread === 1 ? 'post' : 'posts'} not read yet.
          </>
        )}
      </p>

      {influencer.note && (
        <div className="mt-3">
          <p className="kicker">Why this account is on the list</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">{influencer.note}</p>
        </div>
      )}

      {influencer.url && (
        <a
          href={influencer.url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-[var(--accent)]"
        >
          <ExternalLink size={13} aria-hidden />
          Open the account on {influencer.platform}
        </a>
      )}
    </Card>
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
  // The example in the box is the reader's own seat, not the first client's.
  const seatExample = readStore().profile?.constituency ?? 'your constituency'
  const watchPlaceholder = `${seatExample}, the member's name…`
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
        tint="violet"
      />

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
          placeholder={watchPlaceholder}
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
  focusId = null,
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
  /**
   * Open on one account rather than on the whole roster.
   *
   * The dashboard's voices section names an account and sends the reader here
   * to read it in full. Rather than build a second reader over there, the
   * navigation carries the id and this screen scopes itself to it: the account
   * gets its own panel at the top and the post list below shows only its
   * posts. There is exactly one place in this app that renders influencer
   * detail, which is the only way the two can never disagree.
   *
   * Null is the ordinary case and changes nothing.
   */
  focusId?: string | null
}) {
  const store = useStore()
  const reduced = useReducedMotion()

  /**
   * Which account the screen is scoped to, if any.
   *
   * Seeded from the prop and kept locally, because the reader can also change
   * it from here: every roster card offers the same action, so arriving with
   * nothing focused and then choosing an account works without a round trip
   * through the app's navigation.
   */
  const [focus, setFocus] = useState<string | null>(focusId)

  /**
   * Whether the watch's controls are on screen.
   *
   * The watch terms, the channel search and the paste box are setup, and an
   * office does setup once. Rendered permanently they cost two screens of
   * scrolling before the first voice, every visit — so they live behind the
   * pencil, on THIS screen, in place. The one exception is an empty roster:
   * with nothing watched yet, the setup IS the screen, and hiding it behind
   * an icon would strand whoever just arrived.
   */
  const [editing, setEditing] = useState(false)
  const focusRef = useRef<HTMLDivElement | null>(null)

  // Keyed on the incoming id alone. Depending on the local choice as well
  // would fight the reader: every tap on a different card would be undone by
  // this on the next render.
  useEffect(() => {
    if (focusId) setFocus(focusId)
  }, [focusId])

  // Arriving from the dashboard lands below the fold on a phone, so the panel
  // that was asked for has to be brought to the reader rather than waiting to
  // be scrolled to.
  useEffect(() => {
    if (focus) focusRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }, [focus, reduced])
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

  /**
   * The account the screen is scoped to, resolved against the live roster.
   *
   * Null when an id arrives for an account that has since been removed. The
   * screen says so rather than silently widening back to everything, because a
   * link that lands on the full list looks like a link that did not work.
   */
  const focused = focus ? (byInfluencer.get(focus) ?? null) : null

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
    // Scoped to one account when the reader asked for one account. The counts
    // above and the "waiting for you" badge deliberately do not narrow with
    // it: a filter changes what you are looking at, never what is waiting.
    const scoped = focus ? rows.filter((x) => x.influencerId === focus) : rows
    return scoped.sort((a, b) => byDate(a, b, sort))
  }, [store.mentions, view, sort, focus])

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

  /**
   * The roster writes, from the module Settings' "Influencer settings"
   * section also renders through. Defining them here a second time is how the
   * two surfaces would come to disagree about what "already watched" means.
   */
  const { isTracked: tracked, add: addInfluencer } = useInfluencerRoster()

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
      setError('You are not watching any accounts yet. Tap Suggest first.')
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
      /**
       * Who the reading is for.
       *
       * Without this the server can score a stance but cannot say whether a
       * post is about the member, their party or their seat: the watch terms
       * are a flat list and "Aruna", "BJP" and "Mahabubnagar" all look alike
       * in it. All three fields or none, which is the server's own test.
       */
      const person = current.identity
      const subject = {
        name: person?.name ?? null,
        party: person?.party ?? null,
        seat: person?.constituency ?? current.profile?.district ?? null,
      }

      const res = await fetchWithTimeout('/api/influencers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ influencers: rotated, watchTerms, subject }),
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
       * characters, and reads unfiltered when nothing survives. Only used for
       * the heading over the coverage card now. The merge below reads each
       * row's own flag instead, which is the honest test: a scored response
       * can still contain a post the model skipped, and inferring "everything
       * here was judged" from the request would overwrite a real reading with
       * that gap.
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
          if (existing && existing.judged !== false && row.judged === false) continue
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
    const current = readStore()
    const subject = current.profile?.subject?.trim()
    if (!subject) {
      setError('Set up the desk first.')
      return
    }

    setBusy('suggest')
    setError(null)
    setVerified(null)

    try {
      /**
       * The party and the state, when the desk knows them.
       *
       * Both only widen the search. The party adds a question that finds the
       * accounts campaigning on either side, which a search for "<district>
       * news" never returns, and the state stops the judge guessing which
       * state this seat is in from a region table.
       */
      const query = new URLSearchParams({ constituency, subject })
      const party = current.identity?.party?.trim()
      const state = (current.identity?.state ?? current.profile?.state)?.trim()
      if (party) query.set('party', party)
      if (state) query.set('state', state)

      const res = await fetch(`/api/influencers?${query.toString()}`)
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
              : 'The channels that move opinion here.'
          }
          actions={
            <>
              {/* Shows and hides the watch's own controls, right here. It
                  used to route to Settings, which took the reader off the
                  screen they were configuring to configure it. */}
              <Button
                variant="ghost"
                onClick={() => setEditing((v) => !v)}
                aria-label={editing ? 'Close the watch settings' : 'Edit the watch'}
                title={editing ? 'Close the watch settings' : 'Edit the watch'}
                aria-pressed={editing}
                // Square, matching the grievance desk's pencil.
                className={cn('size-12 px-0', editing && 'bg-[var(--accent-soft)] text-[var(--accent)]')}
              >
                <Pencil size={16} aria-hidden />
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Back
              </Button>
            </>
          }
        />
      </m.header>

      {/* The account the reader came here to read, first.
          Above the setup panels rather than below them: somebody who tapped a
          named voice on the dashboard did not come here to edit watch terms,
          and putting two screens of controls in front of the thing they asked
          for is the app ignoring them. */}
      {focused && (
        <m.div variants={fadeUp} className="mt-4" ref={focusRef}>
          <VoiceDetail
            influencer={focused}
            mentions={mentionsByInfluencer.get(focused.id) ?? []}
            onClearFocus={() => setFocus(null)}
          />
        </m.div>
      )}

      {/* Asked for by id, and gone from the roster since. Says so rather than
          silently showing the whole list, which would look like the link had
          simply not worked. */}
      {focus && !focused && (
        <m.p variants={fadeUp} className="mt-4 text-sm text-ink-2">
          That account is no longer on your list.
        </m.p>
      )}

      {/* Setup, behind the pencil. With nothing watched yet the setup IS the
          screen and shows regardless — an icon a new visitor has no reason to
          press must never be the only way to start. */}
      {(editing || store.influencers.length === 0) && (
        <>
          <m.div variants={fadeUp} className="mt-4">
            <WatchTerms />
          </m.div>

          {/* Two ways onto the roster, and both end in a live read before
              anything is stored. Search covers YouTube, which is the only
              platform that answers a query from a server; everything else has
              to be named. */}
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
        </>
      )}

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
          {verified.checked} opened · {verified.discarded} would not load · {verified.added} added
        </m.p>
      )}

      {/* ── The roster, as profile cards ─────────────────────────────────────
          Read-only on purpose. The curated watch list went away because
          `seedInfluencers` in lib/morning-scan.ts maintains the roster itself.

          Behind the pencil with the rest of the watch's furniture: WHO is
          watched is configuration, WHAT they said is the reading. The screen
          opens on the reading — the summary cards and the post list — and the
          roster shows only while the pencil is lit. */}
      {editing && store.influencers.length > 0 && (
        <m.section variants={fadeUp} className="mt-6">
          <SectionTitle>
            Who you are watching
            <span className="ml-2 text-sm font-normal text-ink-3">{store.influencers.length}</span>
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
            {store.influencers.map((inf) => (
              <InfluencerCard
                key={inf.id}
                influencer={inf}
                mentions={mentionsByInfluencer.get(inf.id) ?? []}
                focused={inf.id === focus}
                onOpen={setFocus}
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
            focused ? `Only posts from ${focused.displayName ?? focused.handle}.` : undefined
          }
        >
          {focused ? `From ${focused.displayName ?? focused.handle}` : 'To look at'}
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
                ? 'You are not watching anything yet. Tap Suggest.'
                : focused
                  ? `We hold nothing from ${focused.displayName ?? focused.handle} that fits this view.`
                  : view === 'about' && store.mentions.length > 0
                    ? 'None of the posts we read mention you.'
                    : 'These accounts have not posted anything that mentions you.'
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
                  : `No date · read ${relativeTime(mention.seenAt)}`}
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
          {/* Rendered only when the reading actually answered it. Older posts
              and readings taken before the desk knew the member's party and
              seat carry no `about` at all, and a chip guessed from silence
              would be the fabrication this screen exists to catch. */}
          {mention.mentionsSubject && mention.about && (
            <Chip
              tone="neutral"
              title="What this post is really about, from the same reading that scored its stance."
            >
              {ABOUT_LABEL[mention.about]}
            </Chip>
          )}
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
                    Nobody has read this one yet
                    {influencer?.followers
                      ? `. The account has ${influencer.followers.toLocaleString('en-IN')} followers`
                      : ''}
                    . Add a search word and check again.
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
                Nothing about this one looked fabricated.
              </p>
            )}
          </div>
        )}

        {fake?.note && (
          <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-sm)] bg-[var(--warn-soft)] px-3 py-2 text-xs leading-relaxed text-ink-2">
            <TriangleAlert size={13} className="mt-0.5 shrink-0 text-[var(--warn)]" aria-hidden />
            <span>{fake.note}</span>
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
