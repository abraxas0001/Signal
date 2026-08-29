import { useMemo } from 'react'
import { ExternalLink, Flag, HelpCircle, Megaphone, Newspaper, ScanEye, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Influencer, InfluencerMention } from '@shared/grievance'
import type { Identity } from '@shared/identity'
import { Button, Card, Chip, Empty, type ChipTone } from '../ui'
import { PlatformBadge } from '@/components/kit'
import { compact, full } from '@/lib/utils'

/**
 * Who is talking about the member, and which way.
 *
 * The dashboard already had a section for what the local accounts PUBLISHED.
 * This one answers the question the office actually asks out loud, which is a
 * different question: who is saying it. An office does not plan its week around
 * fourteen posts. It plans it around the four people those fourteen posts came
 * from, because those are who it can ring, brief, rebut or ignore.
 *
 * So the unit here is the account, not the post. Each voice carries three
 * things and all three are measured rather than assumed:
 *
 *   WHAT KIND OF VOICE IT IS. A wire service and a rival party's loudest
 *   worker saying the same sentence are not the same event, and a screen that
 *   stacks them in one column has quietly told the office they are. Discovery
 *   now records whether an account is an outlet, an independent commentator or
 *   an account that campaigns, and this is where that lands.
 *
 *   WHICH WAY IT LEANS, over the window and not in general. Grouped by stance,
 *   with the split named on the row when an account has posted both ways. An
 *   account with two critical posts and two supportive ones has not taken a
 *   side and is not filed as though it had.
 *
 *   HOW FAR IT CARRIES. The follower count read off the platform, or nothing.
 *   Never a zero: an account whose reach was never read is not an account with
 *   no reach.
 *
 * WHAT IS NOT JUDGED IS NOT SHOWN AS JUDGED. Two separate things end up in the
 * unjudged count and neither is neutral. A post nobody read at all comes from a
 * check that ran with no search words set, and a post read but too short to
 * call comes back with stance "unclear". Both are counted under their own
 * heading, and the heading says which is which. Folding either into "neutral"
 * would tell an office that an attack it has not read yet was even-handed,
 * which is the single most expensive lie this screen could tell.
 *
 * The window is the seven days ending on the newest post's own date, not on
 * today. The example desk is a fixed dataset; measured against the wall clock
 * it would empty itself a week after it shipped while holding perfectly good
 * records. The heading names the real dates so nobody reads the window as this
 * calendar week.
 */

const DAY_MS = 86_400_000

/** Voices per stance group before the rest are sent to the accounts screen. */
const PER_GROUP = 3

/* ── The kind of voice ───────────────────────────────────────────────────── */

/**
 * What sort of voice an account is.
 *
 * Mirrors VOICE_KINDS in netlify/functions/lib/influencers.ts, which is where
 * the value is decided. Kept as its own list rather than imported because
 * nothing in src/ imports from netlify/functions, and a client bundle pulling
 * in the InnerTube reader to get four strings would be a poor trade.
 */
export const VOICE_KINDS = ['outlet', 'commentator', 'aligned', 'unclear'] as const
export type VoiceKind = (typeof VOICE_KINDS)[number]

/**
 * Read the kind off a stored account.
 *
 * The shared `Influencer` record has no field for this yet: discovery sends it
 * as an extra property and the store keeps it, so it is present on every
 * account the search found and absent on every account somebody typed in by
 * hand. Both are normal, and an account with no kind reads as "unclear" rather
 * than being guessed at from its follower count or its name.
 *
 * Exported because the accounts screen renders the same label, and the two
 * saying different words about one account is a bug this app has already had
 * elsewhere. One reader, two callers.
 *
 * Takes `unknown` and narrows with `in`, so it needs no cast at either end. A
 * stored `Influencer` has no such property in its type and a raw JSON row has
 * no type at all, and both have to be readable through one function or the
 * screens will drift apart.
 */
export function voiceKindOf(account: unknown): VoiceKind {
  if (typeof account !== 'object' || account === null || !('kind' in account)) return 'unclear'
  const raw: unknown = account.kind
  return VOICE_KINDS.find((k) => k === raw) ?? 'unclear'
}

/** The party an aligned account campaigns for, when discovery recorded one. */
export function voiceAffiliationOf(account: unknown): string | null {
  if (typeof account !== 'object' || account === null || !('affiliation' in account)) return null
  const raw: unknown = account.affiliation
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

export const VOICE_KIND_LABEL: Record<VoiceKind, string> = {
  outlet: 'News outlet',
  commentator: 'Commentator',
  aligned: 'Party account',
  unclear: 'Kind not known',
}

/** What each label actually claims, on the chip's own tooltip. */
export const VOICE_KIND_HINT: Record<VoiceKind, string> = {
  outlet: 'A news organisation. It publishes news as its business.',
  commentator: 'One person speaking in their own name: an analyst, a political channel, a debate host.',
  aligned: 'An account that campaigns for a party. Read it as one side speaking, not as reporting.',
  unclear: 'Nothing has classified this account. It may be any of the three.',
}

export const VOICE_KIND_ICON: Record<VoiceKind, ReactNode> = {
  outlet: <Newspaper size={11} aria-hidden />,
  commentator: <UserRound size={11} aria-hidden />,
  aligned: <Flag size={11} aria-hidden />,
  unclear: <HelpCircle size={11} aria-hidden />,
}

/** The chip tone. 'aligned' is warned on, because it is the one to read twice. */
const KIND_TONE: Record<VoiceKind, ChipTone> = {
  outlet: 'info',
  commentator: 'accent',
  aligned: 'warning',
  unclear: 'neutral',
}

/** The kind as it reads inside a sentence about one account. */
const KIND_PHRASE: Record<VoiceKind, string> = {
  outlet: 'a news outlet',
  commentator: 'an independent commentator',
  aligned: 'a party account',
  unclear: 'an account we have not classified',
}

/* ── The model ───────────────────────────────────────────────────────────── */

/** Which way a voice leans over the window. 'split' means it posted both ways. */
type Lean = 'critical' | 'supportive' | 'neutral' | 'split'

interface Voice {
  influencer: Influencer
  kind: VoiceKind
  affiliation: string | null
  lean: Lean
  /** Posts about this office, in this window, that carry a definite stance. */
  posts: number
  critical: number
  supportive: number
  neutral: number
  /** The most recent post that earned the lean, quoted verbatim. */
  quote: string
  quoteUrl: string
  quotedAt: string | null
  /** Set on any post in the window this account published. */
  suspect: boolean
}

interface VoicesModel {
  /** The real dates, e.g. "21 to 27 August". */
  label: string
  groups: { lean: Lean; voices: Voice[] }[]
  /** Voices with a definite lean, most posts first. */
  ranked: Voice[]
  /** Posts about this office, judged, with a definite stance. */
  judged: number
  critical: number
  supportive: number
  neutral: number
  /** In the window and never read by anything. */
  unread: number
  /** Read, about this office, and too short to call either way. */
  unclear: number
  /** Read, and found to be about something else. */
  notAbout: number
  /** Every post in the window, however it was classified. */
  total: number
}

const at = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/**
 * Build the window, then the voices inside it.
 *
 * Returns null only when not one stored post carries a usable date, because
 * there is then no window to draw and saying "nothing this week" would be a
 * claim about a week nobody measured.
 */
function voicesOf(influencers: Influencer[], mentions: InfluencerMention[]): VoicesModel | null {
  const dated = mentions
    .map((m) => ({ m, t: at(m.postedAt) ?? at(m.seenAt) }))
    .filter((x): x is { m: InfluencerMention; t: number } => x.t !== null)
  if (dated.length === 0) return null

  const newest = Math.max(...dated.map((x) => x.t))
  const end = new Date(newest)
  end.setHours(23, 59, 59, 999)
  const start = new Date(end.getTime() - 6 * DAY_MS)
  start.setHours(0, 0, 0, 0)

  const inWindow = dated.filter((x) => x.t >= start.getTime()).sort((a, b) => b.t - a.t)

  let unread = 0
  let unclear = 0
  let notAbout = 0

  const byId = new Map(influencers.map((i) => [i.id, i]))
  /** Newest first inside each account, because `inWindow` already is. */
  const perAccount = new Map<string, { m: InfluencerMention; t: number }[]>()

  for (const row of inWindow) {
    const m = row.m
    // `judged` is absent on records written before unfiltered checks existed,
    // and every one of those came from the scored path. Only an explicit false
    // means nobody read it.
    if (m.judged === false) {
      unread += 1
      continue
    }
    if (!m.mentionsSubject) {
      notAbout += 1
      continue
    }
    if (m.stance === 'unclear') {
      unclear += 1
      continue
    }
    const list = perAccount.get(m.influencerId)
    if (list) list.push(row)
    else perAccount.set(m.influencerId, [row])
  }

  const voices: Voice[] = []
  for (const [id, rows] of perAccount) {
    const influencer = byId.get(id)
    // An account deleted from the roster after its posts were stored has
    // nothing to render: no name, no reach, no link. Its posts still count in
    // the totals above, which is where they belong.
    if (!influencer) continue

    const critical = rows.filter((r) => r.m.stance === 'critical').length
    const supportive = rows.filter((r) => r.m.stance === 'supportive').length
    const neutral = rows.filter((r) => r.m.stance === 'neutral').length

    /**
     * The lean, decided between the two sides and nothing else.
     *
     * Neutral posts do not compete for the label, they only fail to take a
     * side, so an account with one attack and five even-handed reports leans
     * critical and the row says "6 posts, 1 critical, 5 neither way" beside
     * it. A plurality over all three read better on paper and was wrong on
     * screen: it filed that account under "neither way", which is the reading
     * an office would most want back.
     *
     * An equal number of attacks and defences is 'split' and stays 'split'.
     * That is a finding rather than a gap, and filing it under whichever
     * arrived last would erase it.
     */
    const lean: Lean =
      critical > 0 && critical === supportive
        ? 'split'
        : critical > supportive
          ? 'critical'
          : supportive > critical
            ? 'supportive'
            : 'neutral'

    // The most recent post that earned the lean, so the quote and the label
    // cannot contradict each other. On a split, the most recent of any of them.
    const source =
      (lean === 'split' ? rows[0] : rows.find((r) => r.m.stance === lean)) ?? rows[0]
    if (!source) continue

    voices.push({
      influencer,
      kind: voiceKindOf(influencer),
      affiliation: voiceAffiliationOf(influencer),
      lean,
      posts: rows.length,
      critical,
      supportive,
      neutral,
      quote: source.m.excerpt,
      quoteUrl: source.m.postUrl,
      quotedAt: source.m.postedAt,
      suspect: rows.some((r) => r.m.fake !== null && r.m.fake.suspicion !== 'No'),
    })
  }

  /**
   * Loudest first: posts in the window, then reach.
   *
   * Posts first because that is what was measured here. Reach is the tiebreak
   * rather than the ranking, since an account with two million subscribers and
   * one post has not been loud this week, it has merely been large. Accounts
   * with no follower reading sort last within a tie rather than as zero.
   */
  const loudest = (a: Voice, b: Voice): number =>
    b.posts - a.posts || (b.influencer.followers ?? -1) - (a.influencer.followers ?? -1)

  const ranked = [...voices].sort(loudest)
  const group = (lean: Lean) => ({ lean, voices: ranked.filter((v) => v.lean === lean) })

  const monthOf = (d: Date): string => d.toLocaleDateString('en-IN', { month: 'long' })
  const label =
    monthOf(start) === monthOf(end)
      ? `${start.getDate()} to ${end.getDate()} ${monthOf(end)}`
      : `${start.getDate()} ${monthOf(start)} to ${end.getDate()} ${monthOf(end)}`

  return {
    label,
    groups: [group('critical'), group('supportive'), group('neutral'), group('split')],
    ranked,
    judged: voices.reduce((n, v) => n + v.posts, 0),
    critical: voices.reduce((n, v) => n + v.critical, 0),
    supportive: voices.reduce((n, v) => n + v.supportive, 0),
    neutral: voices.reduce((n, v) => n + v.neutral, 0),
    unread,
    unclear,
    notAbout,
    total: inWindow.length,
  }
}

/* ── The verdict line ────────────────────────────────────────────────────── */

/**
 * Every title has to be true of every account filed under it.
 *
 * "Neither way" means the account took no side at all, not that it balanced
 * out. "Posting both ways" means equal attacks and defences, which is the only
 * case that reaches it.
 */
const LEAN_TITLE: Record<Lean, string> = {
  critical: 'Critical of you',
  supportive: 'Supportive of you',
  neutral: 'Neither way',
  split: 'Posting both ways',
}

const LEAN_COLOUR: Record<Lean, string> = {
  critical: 'var(--neg)',
  supportive: 'var(--pos)',
  neutral: 'var(--text-3)',
  split: 'var(--warn)',
}

/**
 * One or two sentences over the window, built from the counts and nothing else.
 *
 * Assembled as clauses rather than written as a template with holes, because a
 * template has to render every hole. "0 supportive" is a measurement an office
 * would read as a finding, and on a desk where nothing has been judged it is
 * not even that. Every clause here is dropped when its number is zero.
 */
function verdictLines(model: VoicesModel, identity: Identity | null): string[] {
  const who = identity?.name ?? 'this office'
  const lines: string[] = []

  if (model.judged === 0) {
    lines.push(
      model.total === 0
        ? `Nothing was read from the watched accounts over ${model.label}.`
        : `${model.total} ${model.total === 1 ? 'post' : 'posts'} came back over ${model.label} and none of them has been read as being about ${who}.`,
    )
    return lines
  }

  const accounts = model.ranked.length
  lines.push(
    `Over ${model.label}, ${accounts} ${accounts === 1 ? 'account' : 'accounts'} posted ${model.judged} ${model.judged === 1 ? 'time' : 'times'} about ${who}.`,
  )

  const parts: string[] = []
  if (model.critical > 0) parts.push(`${model.critical} critical`)
  if (model.supportive > 0) parts.push(`${model.supportive} supportive`)
  if (model.neutral > 0) parts.push(`${model.neutral} neither way`)
  if (parts.length > 0) lines.push(`${parts.join(', ')}.`)

  const loudest = model.ranked[0]
  if (loudest) {
    const name = loudest.influencer.displayName ?? loudest.influencer.handle
    const reach = loudest.influencer.followers
    lines.push(
      `The loudest was ${name}, ${KIND_PHRASE[loudest.kind]}${reach != null ? ` with ${compact(reach)} followers` : ''}.`,
    )
  }

  return lines
}

/* ── Rows ────────────────────────────────────────────────────────────────── */

function VoiceRow({
  voice,
  onOpenVoice,
}: {
  voice: Voice
  onOpenVoice: (influencerId: string) => void
}) {
  const name = voice.influencer.displayName ?? voice.influencer.handle
  const day = voice.quotedAt
    ? new Date(voice.quotedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null

  /**
   * The split, spelled out on the row that carries it.
   *
   * A voice filed under "Critical of you" that has also posted twice in the
   * office's favour is not simply critical, and the heading alone would say it
   * was. The counts go on the row so the heading never has to carry more than
   * it can.
   */
  const breakdown = [
    voice.critical > 0 ? `${voice.critical} critical` : null,
    voice.supportive > 0 ? `${voice.supportive} supportive` : null,
    voice.neutral > 0 ? `${voice.neutral} neither way` : null,
  ].filter((x): x is string => x !== null)

  return (
    <li className="border-t border-[var(--rule)] pt-3 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 items-center gap-2">
        <PlatformBadge platform={voice.influencer.platform} size={22} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{name}</span>
      </div>

      {/* Wraps rather than scrolls: at 390px this is three chips plus a
          follower count, and squeezing them clipped the party name off the
          one chip that has to be readable. */}
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
        <Chip
          tone={KIND_TONE[voice.kind]}
          icon={VOICE_KIND_ICON[voice.kind]}
          title={
            voice.affiliation
              ? `${VOICE_KIND_HINT[voice.kind]} It campaigns for ${voice.affiliation}.`
              : VOICE_KIND_HINT[voice.kind]
          }
        >
          {/* Capped, because a party's full name can be sixty characters and
              a Chip does not wrap. At 390px an uncapped one pushed the whole
              row wider than the card. The full name stays on the tooltip. */}
          <span className="block max-w-[10rem] truncate">
            {voice.kind === 'aligned' && voice.affiliation
              ? voice.affiliation
              : VOICE_KIND_LABEL[voice.kind]}
          </span>
        </Chip>
        {voice.influencer.followers != null ? (
          <span title={`${full(voice.influencer.followers)} followers, read from the platform`}>
            {compact(voice.influencer.followers)} followers
          </span>
        ) : (
          <span title="Nothing has read this account's follower count yet.">
            Followers not read
          </span>
        )}
        <span>
          · {voice.posts} {voice.posts === 1 ? 'post' : 'posts'}
        </span>
        {breakdown.length > 1 && <span>· {breakdown.join(', ')}</span>}
        {voice.suspect && (
          <Chip tone="negative" icon={<ScanEye size={11} aria-hidden />}>
            Check a claim
          </Chip>
        )}
      </p>

      {/* break-words, because a post excerpt is somebody else's text and a
          long unbroken URL or hashtag in it would push the card past 390px. */}
      <blockquote className="mt-2 border-l-2 border-[var(--rule)] pl-2.5 text-sm leading-relaxed text-ink-2">
        <span className="line-clamp-2 break-words">{voice.quote}</span>
      </blockquote>

      <div className="mt-1 flex flex-wrap items-center gap-x-4">
        {/* The action the section exists for. Everything else on the row is
            the summary; this is where the office goes to read the account in
            full, on the screen that already renders it. */}
        <button
          type="button"
          onClick={() => onOpenVoice(voice.influencer.id)}
          className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:underline"
        >
          <ScanEye size={12} aria-hidden />
          Full analysis
        </button>
        <a
          href={voice.quoteUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-11 items-center gap-1 text-xs text-ink-3 hover:text-ink-2"
        >
          <ExternalLink size={11} aria-hidden />
          {day ? `the post, ${day}` : 'the post'}
        </a>
      </div>
    </li>
  )
}

function LeanGroup({
  lean,
  voices,
  onOpenVoice,
  onOpenAll,
}: {
  lean: Lean
  voices: Voice[]
  onOpenVoice: (influencerId: string) => void
  onOpenAll: () => void
}) {
  if (voices.length === 0) return null
  const shown = voices.slice(0, PER_GROUP)

  return (
    <Card className="h-full">
      <p className="kicker" style={{ color: LEAN_COLOUR[lean] }}>
        {LEAN_TITLE[lean]} · {voices.length}
      </p>
      <ul className="mt-3 space-y-3">
        {shown.map((voice) => (
          <VoiceRow key={voice.influencer.id} voice={voice} onOpenVoice={onOpenVoice} />
        ))}
      </ul>
      {voices.length > shown.length && (
        <button
          type="button"
          onClick={onOpenAll}
          className="mt-2 inline-flex min-h-11 items-center text-xs font-medium text-ink-3 underline decoration-[var(--rule)] underline-offset-4 hover:text-ink-2"
        >
          {voices.length - shown.length} more on the accounts screen
        </button>
      )}
    </Card>
  )
}

/* ── The section ─────────────────────────────────────────────────────────── */

export function InfluencerVoices({
  influencers,
  mentions,
  identity,
  onOpenVoice,
  onOpenAll,
}: {
  /** The watched roster, straight from the store. */
  influencers: Influencer[]
  /** Every stored post, straight from the store. The window is cut here. */
  mentions: InfluencerMention[]
  /** Whose desk this is, so the verdict can name them rather than say "you". */
  identity: Identity | null
  /**
   * Open one account's full analysis.
   *
   * The accounts screen already renders influencer detail, so this hands it an
   * id rather than opening a second reader here. Two components rendering the
   * same account would be two answers to one question, and they would drift.
   */
  onOpenVoice: (influencerId: string) => void
  /** Open the accounts screen with nothing focused. */
  onOpenAll: () => void
}) {
  const model = useMemo(() => voicesOf(influencers, mentions), [influencers, mentions])

  if (influencers.length === 0) {
    return (
      <Empty
        icon={<Megaphone size={18} aria-hidden />}
        title="No accounts are being watched yet"
        action={
          <Button size="sm" variant="outline" onClick={onOpenAll}>
            Open the accounts screen
          </Button>
        }
      />
    )
  }

  if (model === null) {
    return (
      <Empty
        icon={<Megaphone size={18} aria-hidden />}
        title="Nothing read from these accounts yet"
        body={`The ${influencers.length} ${influencers.length === 1 ? 'account' : 'accounts'} on your roster ${influencers.length === 1 ? 'has' : 'have'} no stored posts.`}
        action={
          <Button size="sm" variant="outline" onClick={onOpenAll}>
            Check them now
          </Button>
        }
      />
    )
  }

  const lines = verdictLines(model, identity)
  const anyVoices = model.ranked.length > 0

  return (
    <div className="stack-tight">
      {/* The verdict, one lifted panel. It is the only thing on this section a
          reader has to take in before deciding whether to read further. */}
      <Card level="lift">
        <div className="flex items-start gap-3">
          <span
            className="icon-badge shrink-0"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            aria-hidden
          >
            <Megaphone size={17} />
          </span>
          <div className="min-w-0">
            {lines.map((line) => (
              <p key={line} className="text-sm leading-relaxed text-ink-2 first:font-semibold first:text-ink">
                {line}
              </p>
            ))}
          </div>
        </div>
      </Card>

      {anyVoices && (
        // One column on a phone, two from lg. Each card is a stance group and
        // an empty group renders nothing at all, so a desk with only critical
        // voices gets one card rather than three with dashes in them.
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {model.groups.map((group) => (
            <LeanGroup
              key={group.lean}
              lean={group.lean}
              voices={group.voices}
              onOpenVoice={onOpenVoice}
              onOpenAll={onOpenAll}
            />
          ))}
        </div>
      )}

      {/* Counted, never judged. Two different things live in here and the
          sentence says which is which, because "nobody looked" and "somebody
          looked and could not tell" are different claims about the same post
          and an office acts differently on each. */}
      {(model.unread > 0 || model.unclear > 0) && (
        <button
          type="button"
          onClick={onOpenAll}
          // A block, not an inline-flex. Each clause was its own <span>, which
          // in a flex row are separate items that cannot wrap: at 390px the
          // two sentences ran off the side of the page. Plain text in a block
          // wraps the way text is supposed to.
          className="block min-h-11 w-full text-left text-xs font-medium leading-relaxed text-ink-3 underline decoration-[var(--rule)] underline-offset-4 hover:text-ink-2"
        >
          {model.unread > 0 &&
            `${model.unread} ${model.unread === 1 ? 'post is' : 'posts are'} not read at all. `}
          {model.unclear > 0 &&
            `${model.unclear} ${model.unclear === 1 ? 'post was' : 'posts were'} read but too short to call.`}
        </button>
      )}

      {model.notAbout > 0 && (
        <p className="text-xs leading-relaxed text-ink-3">
          {model.notAbout} unrelated {model.notAbout === 1 ? 'post' : 'posts'} hidden.
        </p>
      )}
    </div>
  )
}
