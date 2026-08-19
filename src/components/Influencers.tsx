import { useCallback, useMemo, useState } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import {
  Check,
  ChevronRight,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react'
import type {
  FakeAssessment,
  FakeSignal,
  Influencer,
  InfluencerMention,
} from '@shared/grievance'
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
import { Button, Card, Chip, PageHeader, SectionTitle, type ChipTone } from './ui'
import { cn, relativeTime } from '@/lib/utils'
import { fadeUp, listItem, listStagger } from '@/lib/motion'

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

/** "unclear" is spelled out, because a blank stance chip reads as a bug. */
const STANCE_LABEL: Record<InfluencerMention['stance'], string> = {
  supportive: 'Supportive',
  critical: 'Critical',
  neutral: 'Neutral towards you',
  unclear: 'Stance unclear',
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

/** The platform's own mark, so a row is identifiable before it is read. */
function PlatformDot({ platform }: { platform: Platform }) {
  const tone: Record<string, string> = {
    YouTube: '#FF0033',
    Instagram: '#C13584',
    Facebook: '#0866FF',
    LinkedIn: '#0A66C2',
    Bluesky: '#1185FE',
    Mastodon: '#6364FF',
    'Twitter/X': '#71767B',
  }
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={{ background: tone[platform] ?? 'var(--text-3)' }}
    />
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
      <p className="text-sm font-medium">What counts as being about you</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">
        A post is only surfaced when it carries one of these. Add the member&rsquo;s name, the
        Telugu spelling, the constituency, a scheme — whatever the channels actually say.
        Without at least one word a check has nothing to match and reads nothing.
      </p>

      <div className="mt-3 flex gap-2">
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
          aria-label="Add a word this check should look for"
          className="min-h-11 min-w-0 flex-1 rounded-[--radius-sm] border border-[var(--border-interactive)] bg-[var(--surface-2)] px-3 text-sm outline-none focus:border-[var(--accent)]"
        />
        <Button size="sm" variant="outline" onClick={add} disabled={!draft.trim()}>
          <Plus size={14} />
          Add
        </Button>
      </div>

      {terms.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {terms.map((t) => (
            <button
              key={t}
              onClick={() => write(terms.filter((x) => x !== t))}
              aria-label={`Stop looking for ${t}`}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-[3px] border border-[var(--accent)] bg-[var(--accent-soft)] px-2 font-mono text-[10px] font-medium uppercase tracking-[0.07em] text-[var(--accent)]"
            >
              {t}
              <X size={10} />
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-[var(--warn)]">
          <TriangleAlert size={13} />
          No words set — Check now has nothing to look for.
        </p>
      )}
    </Card>
  )
}

export function Influencers({ onClose }: { onClose: () => void }) {
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
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [verified, setVerified] = useState<{ checked: number; discarded: number; added: number } | null>(null)

  /* ── Derived ───────────────────────────────────────────────────────────── */

  const byInfluencer = useMemo(() => {
    const map = new Map<string, Influencer>()
    for (const inf of store.influencers) map.set(inf.id, inf)
    return map
  }, [store.influencers])

  /* ── What is new ───────────────────────────────────────────────────────── */

  /**
   * Mentions that are actually about this office, newest first.
   *
   * A mention the reader judged not to be about the subject is kept in the
   * store — it is evidence about what a channel covers — but it is not shown
   * here, because this list answers "what did they say about us".
   */
  const mentions = useMemo(
    () =>
      [...store.mentions]
        .filter((x) => x.mentionsSubject)
        .sort((a, b) => Date.parse(b.seenAt) - Date.parse(a.seenAt)),
    [store.mentions],
  )

  /** Not yet cleared by a person. The only count worth putting a badge on. */
  const unread = useMemo(() => mentions.filter((x) => !x.acknowledged), [mentions])

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
        'No accounts are being watched yet. Tap Suggest to find the channels with an audience in this seat.',
      )
      return
    }

    const watchTerms = current.profile?.watchTerms ?? []
    if (watchTerms.length === 0) {
      setError('No search words are set, so a check has nothing to match. Add one above.')
      return
    }

    setBusy('check')
    setError(null)
    setCapped([])

    try {
      const res = await fetch('/api/influencers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ influencers: current.influencers, watchTerms }),
      })
      const parsed: unknown = await res.json()
      const body = isRecord(parsed) ? parsed : {}

      if (!res.ok) {
        setError(text(body['error']) ?? 'Could not read those accounts. Try again in a minute.')
        return
      }

      const incoming = (Array.isArray(body['mentions']) ? body['mentions'] : [])
        .map(toMention)
        .filter(nonNull)

      update((s) => {
        // Keyed on the post, so re-reading a channel does not file the same
        // video twice — and a mention already cleared stays cleared.
        const byId = new Map(s.mentions.map((x) => [x.postUrl, x]))
        for (const row of incoming) {
          const existing = byId.get(row.postUrl)
          byId.set(row.postUrl, existing ? { ...row, acknowledged: existing.acknowledged } : row)
        }
        return { ...s, mentions: [...byId.values()] }
      })

      setCapped(
        (Array.isArray(body['capped']) ? body['capped'] : []).filter(
          (c): c is string => typeof c === 'string',
        ),
      )
      setCheckedAt(new Date().toISOString())
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }, [])

  /** Find the channels with an audience in this seat. */
  const suggest = useCallback(async () => {
    const subject = readStore().profile?.subject?.trim()
    if (!subject) {
      setError('Set up the desk first — a suggestion needs the name it is meant to find accounts about.')
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
        setError(text(body['error']) ?? 'Could not suggest accounts. Try again in a minute.')
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
      setError('Could not reach the server. Check your connection and try again.')
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
              state={busy ? 'thinking' : unread.length > 0 ? 'error' : 'idle'}
              size={40}
              className="mt-1 shrink-0"
            />
          }
          title="Influencer watch"
          subtitle={
            store.influencers.length
              ? `${store.influencers.length} ${store.influencers.length === 1 ? 'account' : 'accounts'} watched · ${unread.length} to look at`
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
          <span className="text-xs text-ink-3">Last read {relativeTime(checkedAt)}.</span>
        )}
      </m.div>

      {error && (
        <m.p variants={fadeUp} role="alert" className="mt-3 text-sm text-[var(--neg)]">
          {error}
        </m.p>
      )}

      {verified && (
        <m.p variants={fadeUp} className="mt-3 text-sm text-ink-2">
          Opened {verified.checked} {verified.checked === 1 ? 'channel' : 'channels'}, dropped{' '}
          {verified.discarded} that could not be read, added {verified.added}.
        </m.p>
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
          hint="What the accounts with an audience here have actually said about you."
        >
          To look at
          {unread.length > 0 && (
            <span className="ml-2 text-sm font-normal text-ink-3">{unread.length} new</span>
          )}
        </SectionTitle>

        {capped.length > 0 && (
          <Card className="mb-3">
            <p className="text-sm font-medium">What that check did not cover</p>
            <ul className="mt-1.5 space-y-1">
              {capped.map((line) => (
                <li key={line} className="text-sm leading-relaxed text-ink-2">
                  {line}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {mentions.length === 0 ? (
          <Card>
            <p className="text-sm font-medium">Nothing yet</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-3">
              {store.influencers.length === 0
                ? 'No accounts are being watched. Tap Suggest to find the channels with an audience in this seat — it needs no key and takes a few seconds.'
                : 'The accounts being watched have posted nothing that names you. Tap Check now to read them again.'}
            </p>
          </Card>
        ) : (
          <m.ul className="space-y-3" variants={listStagger}>
            {mentions.map((mention) => (
              <m.li key={mention.id} variants={listItem}>
                <MentionRow
                  mention={mention}
                  influencer={byInfluencer.get(mention.influencerId) ?? null}
                  onAcknowledge={acknowledge}
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
}: {
  mention: InfluencerMention
  influencer: Influencer | null
  onAcknowledge: (id: string) => void
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

  return (
    <m.li variants={listItem}>
      <article
        className={cn(
          'rounded-[--radius-md] border p-3',
          // Colour alone never carries this: the accent tint is reinforced by
          // the left rule and by the "not acknowledged" chip below.
          open
            ? 'border-l-4 border-[var(--accent)] bg-[var(--accent-soft)]'
            : 'border-[var(--border)] bg-[var(--surface-2)]',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              {influencer && <PlatformDot platform={influencer.platform} />}
              <span className="truncate">
                {influencer?.displayName ?? influencer?.handle ?? 'Account removed'}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-ink-3">
              {mention.postedAt
                ? relativeTime(mention.postedAt)
                : `date not published · read ${relativeTime(mention.seenAt)}`}
            </p>
          </div>
          {open && (
            <Chip tone="accent" className="shrink-0">
              Not acknowledged
            </Chip>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip tone={STANCE_TONE[mention.stance]}>{STANCE_LABEL[mention.stance]}</Chip>
          <Chip tone={SENTIMENT_CHIP[SENTIMENT_TONE[mention.sentiment]] ?? 'neutral'}>
            {mention.sentiment}
          </Chip>
          {!mention.mentionsSubject && (
            <Chip tone="neutral" title="A watch term appeared, but the post is about something else">
              not about you
            </Chip>
          )}
          {fake && (
            <Chip
              tone={fake.suspicion === 'Yes' ? 'negative' : 'warning'}
              icon={<TriangleAlert size={12} />}
              title={fake.note ?? undefined}
            >
              {fake.type ?? 'Needs checking'} · {fake.suspicion}
            </Chip>
          )}
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-2 block w-full text-left"
        >
          <span
            className={cn(
              'block text-sm text-ink-2',
              expanded ? 'whitespace-pre-line' : 'line-clamp-4',
            )}
          >
            {mention.excerpt}
          </span>
          <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)]">
            {expanded ? 'Show less' : 'What this says about you'}
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
              <p className="kicker">How it reads</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">
                {STANCE_LABEL[mention.stance]} towards you, {mention.sentiment.toLowerCase()} in
                tone
                {influencer?.followers
                  ? `, from an account ${influencer.followers.toLocaleString('en-IN')} people follow`
                  : ''}
                .
              </p>
            </div>

            {/* Every signal behind the flag, not just the verdict. A card that
                says "possibly false" and will not say why is an accusation an
                office cannot defend, and this product is in the business of the
                opposite. */}
            {fake && fake.signals.length > 0 && (
              <div>
                <p className="kicker">What was noticed</p>
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
          <p className="mt-2 border-l-2 border-[var(--border-strong)] pl-3 text-xs text-ink-3">
            {fake.note} Nobody has checked this yet — it is flagged for a person to look at.
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <a
            href={mention.postUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-[var(--accent)]"
          >
            <ExternalLink size={13} />
            Open the post
          </a>
          {open && (
            <Button size="sm" variant="ghost" onClick={() => onAcknowledge(mention.id)}>
              <Check size={14} />
              Acknowledge
            </Button>
          )}
        </div>
      </article>
    </m.li>
  )
}
