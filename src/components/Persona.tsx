import { useCallback, useMemo, useState } from 'react'
import * as m from 'motion/react-m'
import { useReducedMotion } from 'motion/react'
import {
  ArrowLeft,
  BellOff,
  Check,
  ExternalLink,
  ListChecks,
  MapPin,
  Megaphone,
  Minus,
  Newspaper,
  PieChart,
  Plus,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TrendingUp,
  TriangleAlert,
  UserSearch,
  Users,
} from 'lucide-react'
import type { ActionItem, FakeAssessment, FakeSignal, Recommendation } from '@shared/grievance'
import {
  ACTION_CATEGORIES,
  ACTION_PRIORITIES,
  COMMS_CHANNELS,
  CONFIDENCE_TIERS,
  DEBUNK_STATUSES,
  FAKE_NEWS_TYPES,
  FAKE_SUSPICION,
  SENTIMENTS,
  SENTIMENT_TONE,
} from '@shared/taxonomy'
import type { ActionPriority, ConfidenceTier, Sentiment } from '@shared/taxonomy'
import { makeId, readStore, update, useStore } from '@/lib/store'
import { PORTALS } from '@shared/regions'
import { Avatar, Bar, Button, Card, Chip, PageHeader, SectionTitle, type ChipTone } from './ui'
import { CardHead, DonutBreakdown, IconStat, IndiaMap, Legend, Sparkline, type MapMarker } from '@/components/kit'
import { geocodePlace, type Place } from './gazetteer'
import { INDIA_BBOX, INDIA_DOTS } from './india-dots'
import { LevelPips } from './charts'
import { absoluteDate, cn, hostOf, pluralise, relativeTime } from '@/lib/utils'
import { fadeUp, listItem, listStagger } from '@/lib/motion'
import { fetchWithTimeout } from '@/lib/net'

/**
 * Persona tracker.
 *
 * The office does not read the papers looking for topics. It reads them looking
 * for names — the member, whoever contests against them, the officer whose
 * department keeps appearing — and the question is always the same two: what
 * was said, and is any of it made up. The grievance desk answers that per link.
 * This answers it per person, across whatever the papers published today.
 *
 * Two honesty problems shaped this screen.
 *
 * The first is the word "track", which in every product like this implies a
 * server watching on the office's behalf and a notification when something
 * lands. There is none. Nothing here runs while the screen is shut: no job, no
 * push, no inbox. "Continuously" means somebody opens this tab and taps Check
 * now. That is stated at the top, in the first card, before anything that could
 * be mistaken for a feed — an office that believes it will be told and is not
 * is worse off than one that knows it has to look.
 *
 * The second is the name itself. A name written in Telugu does not match an
 * English headline and never will, so a roster holding only the English
 * spelling finds a fraction of the coverage and presents it as all of it. Hence
 * the second field on the add form, and hence the fact that it is explained
 * rather than left as a blank box somebody skips.
 */

/* ── The shapes this screen owns ─────────────────────────────────────────── */

export type PersonaStance = 'supportive' | 'critical' | 'neutral' | 'unclear'

/** A person on the roster. Names only — no claims about them live here. */
export interface TrackedPersona {
  id: string
  name: string
  /**
   * Other spellings of the same name: the Telugu form, initials, the short
   * form the papers actually print. These go to the server as search terms.
   */
  aliases: string[]
  addedAt: string
  /** When Check now last finished for this person. Null until it has run. */
  lastCheckedAt: string | null
}

/**
 * One story that named a tracked person, as read back from /api/persona.
 *
 * `sentiment`, `fake` and `recommendation` are nullable here even though the
 * endpoint sends them on every mention it can classify. A missing sentiment
 * rendered as "Neutral" would be a fabricated reading of a story nobody scored,
 * and this product exists to catch exactly that kind of invention — so the
 * absence is carried through and the interface says so.
 */
export interface PersonaMention {
  id: string
  /** Which roster row asked for this. Set here, never taken from the server. */
  personaId: string
  /** The name the search ran on, as the server echoed it back. */
  persona: string
  url: string
  headline: string
  publisher: string | null
  publishedAt: string | null
  language: string | null
  excerpt: string
  place: string | null
  stance: PersonaStance
  sentiment: Sentiment | null
  fake: FakeAssessment | null
  summary: string
  recommendation: Recommendation | null
  seenAt: string
}

/* ── Vocabularies ────────────────────────────────────────────────────────── */

const STANCES: readonly PersonaStance[] = ['supportive', 'critical', 'neutral', 'unclear']

/**
 * Stance is shown as a word first and a colour second, everywhere it appears.
 *
 * Roughly one man in twelve cannot separate the red from the green, and this
 * screen is read outdoors on a phone with the brightness losing to the sun. A
 * row whose only difference from its neighbour is a hue is a row that gets
 * misread on the day it matters.
 */
const STANCE_LABEL: Record<PersonaStance, string> = {
  supportive: 'Supportive',
  critical: 'Critical',
  neutral: 'Neutral',
  unclear: 'Stance unclear',
}

const STANCE_TONE: Record<PersonaStance, ChipTone> = {
  supportive: 'positive',
  critical: 'negative',
  neutral: 'neutral',
  unclear: 'warning',
}

const SENTIMENT_CHIP: Record<'positive' | 'neutral' | 'mixed' | 'negative', ChipTone> = {
  positive: 'positive',
  neutral: 'neutral',
  mixed: 'warning',
  negative: 'negative',
}

const PRIORITY_TONE: Record<ActionPriority, ChipTone> = {
  Low: 'neutral',
  Medium: 'info',
  High: 'warning',
  Critical: 'negative',
}

/** The same vocabulary as the grievance detail, so one signal reads one way. */
const SIGNAL_LABEL: Record<FakeSignal['kind'], string> = {
  provenance: 'Where it came from',
  recirculation: 'Seen before',
  source: 'The source',
  consistency: 'Internal consistency',
  corroboration: 'Corroboration',
}

const SUPPORTS_LABEL: Record<FakeSignal['supports'], string> = {
  authentic: 'Points to real',
  fabricated: 'Points to fake',
  inconclusive: 'Settles nothing',
}

const SUPPORTS_TONE: Record<FakeSignal['supports'], ChipTone> = {
  authentic: 'positive',
  fabricated: 'negative',
  inconclusive: 'neutral',
}

const CONFIDENCE_LABEL: Record<ConfidenceTier, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

const SIGNAL_KINDS: readonly FakeSignal['kind'][] = [
  'provenance',
  'recirculation',
  'source',
  'consistency',
  'corroboration',
]

const SIGNAL_SUPPORTS: readonly FakeSignal['supports'][] = [
  'authentic',
  'fabricated',
  'inconclusive',
]

/**
 * The short marker a row carries when the fake check is not a clean "No".
 *
 * Worded as what was flagged rather than what is true. The assessment is a
 * suspicion with signals under it, and a chip reading "Fake" on a story nobody
 * has verified is the same offence this screen exists to catch.
 */
const SUSPICION_LABEL: Record<string, string> = {
  Unsure: 'Needs checking',
  Likely: 'Likely fabricated',
  Yes: 'Fabrication flagged',
}

/**
 * How many stories one Check now reads, and how many go in a single request.
 *
 * Not a performance knob. `netlify dev` kills a request at thirty seconds no
 * matter what the config says, and reading a story means fetching it and then
 * putting it through a model. Four, taken two at a time, finishes inside that
 * with room to spare; a dozen in one call returns nothing at all and the office
 * is told the check failed when in fact it was cut off part-way through.
 */
const READ_LIMIT = 4
const READ_CHUNK = 2

/** Deadline by priority. A critical item due next week is not a deadline. */
const DUE_DAYS: Record<ActionPriority, number> = {
  Critical: 1,
  High: 2,
  Medium: 4,
  Low: 7,
}

/* ── Reading an untrusted response ───────────────────────────────────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const nonNull = <T,>(v: T | null): v is T => v !== null

/** Narrow to a known vocabulary. Anything else is unknown, not a default. */
function pick<T extends string>(allowed: readonly T[], v: unknown): T | null {
  if (typeof v !== 'string') return null
  return allowed.find((a) => a === v) ?? null
}

function toSignal(raw: unknown): FakeSignal | null {
  if (!isRecord(raw)) return null
  const finding = text(raw['finding'])
  const kind = pick(SIGNAL_KINDS, raw['kind'])
  const supports = pick(SIGNAL_SUPPORTS, raw['supports'])
  const confidence = pick(CONFIDENCE_TIERS, raw['confidence'])
  if (!finding || !kind || !supports || !confidence) return null
  return { kind, finding, confidence, supports }
}

function toFake(raw: unknown): FakeAssessment | null {
  if (!isRecord(raw)) return null
  const suspicion = pick(FAKE_SUSPICION, raw['suspicion'])
  const debunkStatus = pick(DEBUNK_STATUSES, raw['debunkStatus'])
  if (!suspicion || !debunkStatus) return null
  return {
    suspicion,
    type: pick(FAKE_NEWS_TYPES, raw['type']),
    debunkStatus,
    signals: (Array.isArray(raw['signals']) ? raw['signals'] : []).map(toSignal).filter(nonNull),
    note: text(raw['note']),
  }
}

function toRecommendation(raw: unknown): Recommendation | null {
  if (!isRecord(raw)) return null
  const action = pick(ACTION_CATEGORIES, raw['action'])
  const priority = pick(ACTION_PRIORITIES, raw['priority'])
  const channel = pick(COMMS_CHANNELS, raw['channel'])
  // A recommendation missing any of the three cannot become a task, and a
  // half-filled one on screen invites the office to act at a priority nobody
  // set. Dropped to null instead, and the detail says none came back.
  if (!action || !priority || !channel) return null
  return {
    action,
    priority,
    talkingPoints: (Array.isArray(raw['talkingPoints']) ? raw['talkingPoints'] : [])
      .map(text)
      .filter(nonNull),
    channel,
    rationale: text(raw['rationale']) ?? '',
  }
}

function toMention(raw: unknown, person: TrackedPersona): PersonaMention | null {
  if (!isRecord(raw)) return null
  const url = text(raw['url'])
  const headline = text(raw['headline'])
  // Without these two there is nothing to show and nothing to open again.
  // Everything else has an honest empty rendering; a mention that cannot be
  // read back to its source has none.
  if (!url || !headline) return null

  return {
    id: text(raw['id']) ?? mentionId(person.id, url),
    personaId: person.id,
    persona: text(raw['persona']) ?? person.name,
    url,
    headline,
    publisher: text(raw['publisher']) ?? hostOf(url),
    publishedAt: text(raw['publishedAt']),
    language: text(raw['language']),
    excerpt: text(raw['excerpt']) ?? '',
    place: text(raw['place']),
    // "unclear" is not a fallback invented here — it is the vocabulary's own
    // word for a stance nobody could read, which is exactly what a missing
    // value means.
    stance: pick(STANCES, raw['stance']) ?? 'unclear',
    sentiment: pick(SENTIMENTS, raw['sentiment']),
    fake: toFake(raw['fake']),
    summary: text(raw['summary']) ?? '',
    recommendation: toRecommendation(raw['recommendation']),
    seenAt: text(raw['seenAt']) ?? new Date().toISOString(),
  }
}

interface Candidate {
  url: string
  title: string
  portal: string
}

function toCandidate(raw: unknown): Candidate | null {
  if (!isRecord(raw)) return null
  const url = text(raw['url'])
  if (!url) return null
  return { url, title: text(raw['title']) ?? url, portal: text(raw['portal']) ?? hostOf(url) }
}

/* ── Identity ────────────────────────────────────────────────────────────── */

/** Keeps Telugu letters, so two people whose names differ only in Telugu do not collide. */
const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9ఀ-౿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

/**
 * A person's id is derived from the name rather than from a counter.
 *
 * Adding the same person twice has to collide instead of producing two rows
 * with two half-filled histories, and the mention ids hang off this — a roster
 * id that changed would orphan every mention already linked to an action.
 */
function personaKey(name: string): string {
  return `per-${slugify(name) || Math.random().toString(36).slice(2, 8)}`
}

/**
 * FNV-1a over the URL. Not security, just a short stable key: the same story
 * found again on a later check must land on the same row and keep its original
 * seenAt, instead of arriving as a second copy of itself.
 */
function hash(value: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

function mentionId(person: string, url: string): string {
  return `pm-${person}-${hash(url)}`
}

/** Newest first on what the paper published, falling back to when we read it. */
function stamp(mention: PersonaMention): number {
  const at = Date.parse(mention.publishedAt ?? mention.seenAt)
  return Number.isNaN(at) ? 0 : at
}

/** End of the local day, N days out — the convention the Actions sheet uses. */
function dueIn(days: number): string {
  const at = new Date()
  at.setDate(at.getDate() + days)
  at.setHours(23, 59, 59, 0)
  return at.toISOString()
}

/* ── One request ─────────────────────────────────────────────────────────── */

interface ApiResult {
  ok: boolean
  body: Record<string, unknown>
  error: string | null
}

/**
 * Every failure mode of /api/persona reduced to one shape.
 *
 * The endpoint is being built alongside this screen, so this treats it as a
 * stranger: an HTML error page, a 502 from the platform, a body that is not
 * JSON, and a clean 200 all have to leave the office with a sentence it can act
 * on rather than a stack trace or, worse, a silently empty list.
 */
async function callPersona(payload: Record<string, unknown>): Promise<ApiResult> {
  let res: Response
  try {
    res = await fetchWithTimeout('/api/persona', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return {
      ok: false,
      body: {},
      error: 'Could not reach the server. Check the connection and try again.',
    }
  }

  let parsed: unknown = null
  try {
    parsed = await res.json()
  } catch {
    parsed = null
  }
  const body = isRecord(parsed) ? parsed : {}

  if (!res.ok) {
    return {
      ok: false,
      body,
      error: text(body['error']) ?? `The tracker could not run (HTTP ${res.status}).`,
    }
  }
  return { ok: true, body, error: text(body['error']) }
}

/* ── Progress ────────────────────────────────────────────────────────────── */

interface Progress {
  personaId: string
  phase: 'finding' | 'reading'
  read: number
  total: number
}

/** What the last check did, kept on screen until the next one replaces it. */
interface CheckReport {
  personaId: string
  found: number
  read: number
  added: number
  /** Papers that answered, and what with, so a quiet run is explicable. */
  sources: string[]
  /** Candidates the read limit left untouched, offered as plain links. */
  unread: Candidate[]
  notes: string[]
}

/* ── Screen ──────────────────────────────────────────────────────────────── */

export function Persona({ onClose }: { onClose: () => void }) {
  const store = useStore()
  const reduced = useReducedMotion()

  const [name, setName] = useState('')
  const [aliases, setAliases] = useState('')
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null)
  const [selectedMention, setSelectedMention] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [report, setReport] = useState<CheckReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const personas = store.personas
  /**
   * Which papers a persona check reads.
   *
   * It used to be exactly the grievance desk's selection, which made this
   * screen do nothing at all in two situations. First, a desk that had not been
   * configured yet had no papers, so "Check now" searched nothing and reported
   * nothing — the screen looked broken when it was merely empty. Second, and
   * worse, the desk's papers are district sections: searching an Andhra Pradesh
   * district feed for a Prime Minister returns zero, correctly, because he is
   * not district news. A run against four such feeds surfaced 120 stories and
   * none of them carried the name.
   *
   * So the desk's choice is a starting point rather than the whole answer, and
   * the national mastheads are added underneath it. Somebody tracked here is
   * usually tracked because they are covered widely.
   */
  const portals = useMemo(() => {
    const chosen = store.profile?.portals ?? []
    const national = PORTALS.filter((p) => p.states === 'all').map((p) => p.label)
    return [...new Set([...chosen, ...national])]
  }, [store.profile])
  const customUrls = useMemo(
    () => (store.profile?.customPortalUrls ?? []).filter(Boolean),
    [store.profile],
  )
  const canSearch = portals.length > 0 || customUrls.length > 0

  /** The row on screen: the chosen one, or the first if nothing is chosen. */
  const current = useMemo(
    () => personas.find((p) => p.id === selectedPersona) ?? personas[0] ?? null,
    [personas, selectedPersona],
  )

  const countByPersona = useMemo(() => {
    const counts = new Map<string, number>()
    for (const mention of store.personaMentions) {
      counts.set(mention.personaId, (counts.get(mention.personaId) ?? 0) + 1)
    }
    return counts
  }, [store.personaMentions])

  const mentions = useMemo(() => {
    if (!current) return []
    return store.personaMentions
      .filter((x) => x.personaId === current.id)
      .sort((a, b) => stamp(b) - stamp(a))
  }, [store.personaMentions, current])

  const openMention = useMemo(
    () => mentions.find((x) => x.id === selectedMention) ?? null,
    [mentions, selectedMention],
  )

  /** Mentions already raised as tasks, so the button cannot fire twice. */
  const actioned = useMemo(() => {
    const ids = new Set<string>()
    for (const action of store.actions) for (const id of action.linkedRecordIds) ids.add(id)
    return ids
  }, [store.actions])

  /* ── Roster ────────────────────────────────────────────────────────────── */

  const addPersona = useCallback(() => {
    const trimmed = name.trim()
    if (!trimmed) return

    const id = personaKey(trimmed)
    if (readStore().personas.some((p) => p.id === id)) {
      setError(`${trimmed} is already being followed.`)
      return
    }

    const created: TrackedPersona = {
      id,
      name: trimmed,
      aliases: aliases
        .split(/[,\n]/)
        .map((a) => a.trim())
        .filter(Boolean),
      addedAt: new Date().toISOString(),
      lastCheckedAt: null,
    }
    update((s) => ({ ...s, personas: [...s.personas, created] }))
    setSelectedPersona(id)
    setSelectedMention(null)
    setName('')
    setAliases('')
    setError(null)
  }, [name, aliases])

  const removePersona = useCallback((id: string) => {
    update((s) => ({
      ...s,
      personas: s.personas.filter((p) => p.id !== id),
      // Mentions with no name left against them cannot be read back or judged.
      // They would sit on the device as anonymous accusations about somebody.
      personaMentions: s.personaMentions.filter((x) => x.personaId !== id),
    }))
    setSelectedPersona((cur) => (cur === id ? null : cur))
    setSelectedMention(null)
    setReport((cur) => (cur?.personaId === id ? null : cur))
  }, [])

  /* ── Check now ─────────────────────────────────────────────────────────── */

  const check = useCallback(
    async (person: TrackedPersona) => {
      if (!canSearch) {
        setError(
          'Signal does not know which papers to search. Set the state and tick the mastheads on the intake screen first, then come back.',
        )
        return
      }

      setError(null)
      setReport(null)
      setSelectedPersona(person.id)
      setSelectedMention(null)
      setProgress({ personaId: person.id, phase: 'finding', read: 0, total: 0 })

      const found = await callPersona({
        action: 'find',
        persona: person.name,
        aliases: person.aliases,
        portals,
        customUrls,
        state: store.profile?.state ?? null,
        // District, not seat — see Grievances. The persona scan reads the same
        // masthead index pages and degrades the same silent way.
        city: store.profile?.district ?? store.profile?.constituency ?? null,
      })

      if (!found.ok) {
        setProgress(null)
        setError(found.error)
        return
      }

      const candidates = (Array.isArray(found.body['candidates']) ? found.body['candidates'] : [])
        .map(toCandidate)
        .filter(nonNull)

      const sources = (Array.isArray(found.body['sources']) ? found.body['sources'] : [])
        .map((raw): string | null => {
          if (!isRecord(raw)) return null
          const portal = text(raw['portal'])
          if (!portal) return null
          const failure = text(raw['error'])
          const count = typeof raw['found'] === 'number' ? raw['found'] : 0
          return failure ? `${portal}: ${failure}` : `${portal} ${count}`
        })
        .filter(nonNull)

      const notes = (Array.isArray(found.body['notes']) ? found.body['notes'] : [])
        .map(text)
        .filter(nonNull)

      const at = new Date().toISOString()
      const stampChecked = () =>
        update((s) => ({
          ...s,
          personas: s.personas.map((p) => (p.id === person.id ? { ...p, lastCheckedAt: at } : p)),
        }))

      const targets = candidates.slice(0, READ_LIMIT)
      if (targets.length === 0) {
        setProgress(null)
        stampChecked()
        setReport({ personaId: person.id, found: 0, read: 0, added: 0, sources, unread: [], notes })
        return
      }

      // Read in small batches and write each one as it lands. A connection that
      // drops on the third story should cost the office the third story, not
      // the two already read and paid for.
      let added = 0
      const collected = [...notes]
      for (let i = 0; i < targets.length; i += READ_CHUNK) {
        const batch = targets.slice(i, i + READ_CHUNK)
        setProgress({ personaId: person.id, phase: 'reading', read: i, total: targets.length })

        const analysed = await callPersona({
          action: 'analyse',
          persona: person.name,
          urls: batch.map((c) => c.url),
        })

        if (!analysed.ok) {
          setError(
            `${analysed.error ?? 'The reader stopped.'} ${added} of ${targets.length} ${pluralise(targets.length, 'story', 'stories')} had been read by then; those are below.`,
          )
          break
        }

        const capped = text(analysed.body['capped'])
        if (capped) collected.push(capped)

        const incoming = (Array.isArray(analysed.body['mentions']) ? analysed.body['mentions'] : [])
          .map((raw) => toMention(raw, person))
          .filter(nonNull)

        if (incoming.length) {
          update((s) => {
            const byId = new Map<string, PersonaMention>()
            for (const existing of s.personaMentions) byId.set(existing.id, existing)
            for (const fresh of incoming) {
              const existing = byId.get(fresh.id)
              // Re-running a check finds yesterday's stories again. Keeping the
              // original seenAt is what stops the list reshuffling itself every
              // time somebody taps the button.
              byId.set(fresh.id, existing ? { ...fresh, seenAt: existing.seenAt } : fresh)
            }
            return { ...s, personaMentions: [...byId.values()] }
          })
          added += incoming.length
        }
      }

      stampChecked()
      setProgress(null)
      setReport({
        personaId: person.id,
        found: candidates.length,
        read: targets.length,
        added,
        sources,
        unread: candidates.slice(READ_LIMIT, READ_LIMIT + 6),
        notes: collected,
      })
    },
    [canSearch, portals, customUrls, store.profile],
  )

  /* ── A recommendation, turned into somebody's job ──────────────────────── */

  const makeAction = useCallback((mention: PersonaMention, person: TrackedPersona) => {
    const rec = mention.recommendation
    if (!rec) return

    const item: ActionItem = {
      id: makeId('action'),
      createdAt: new Date().toISOString(),
      // The mention id, as the client asked for. The Actions screen resolves
      // linked ids against grievance records and will report this one as "no
      // longer stored on this device" — which is why the notes below repeat the
      // story instead of relying on the link. Better a task that stands on its
      // own than a task pointing at something the other screen cannot open.
      linkedRecordIds: [mention.id],
      description: `${rec.action} (${person.name}): ${mention.headline}`,
      department: null,
      owner: null,
      status: 'Planned',
      priority: rec.priority,
      dueAt: dueIn(DUE_DAYS[rec.priority]),
      completedAt: null,
      escalation: 'None',
      delayReason: null,
      notes: [
        rec.rationale,
        `Suggested channel: ${rec.channel}.`,
        mention.publisher ? `Published by ${mention.publisher}.` : null,
        `Story: ${mention.url}`,
        'Raised from the persona tracker.',
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
    }
    update((s) => ({ ...s, actions: [item, ...s.actions] }))
  }, [])

  /* ── Render ────────────────────────────────────────────────────────────── */

  const total = store.personaMentions.length
  /** Rows whose fake-news check was not a clean "No" — same test FakeMarker uses. */
  const flagged = useMemo(
    () => store.personaMentions.filter((x) => x.fake != null && x.fake.suspicion !== 'No').length,
    [store.personaMentions],
  )

  return (
    <m.div
      className="shell shell-wide page-end"
      variants={listStagger}
      initial={reduced ? false : 'hidden'}
      animate="show"
    >
      <m.header variants={fadeUp}>
        <PageHeader
          kicker="Names, not topics"
          title="Persona tracker"
          subtitle={
            personas.length
              ? `${personas.length} ${pluralise(personas.length, 'person', 'people')} followed · ${total} ${pluralise(total, 'mention')} on file`
              : 'What the papers are saying about the people this office watches.'
          }
          actions={
            <Button variant="ghost" onClick={onClose}>
              Back
            </Button>
          }
        />
      </m.header>

      {/* ── The headline numbers ──────────────────────────────────────────
          Counted from what this device already holds. No delta chips: these
          totals are recomputed on every visit, so there is no second reading
          to claim a change against. */}
      {personas.length > 0 && (
        <m.div variants={fadeUp} className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          <IconStat
            icon={<Users size={18} />}
            label="People followed"
            value={personas.length}
            tint="blue"
            deltaLabel="Checked by hand. No server watches for you."
          />
          <IconStat
            icon={<Newspaper size={18} />}
            label="Mentions on file"
            value={total}
            tint="violet"
            deltaLabel="Stored on this device only"
          />
          <IconStat
            icon={<TriangleAlert size={18} />}
            label="Flagged as suspect"
            value={flagged}
            tint="orange"
            deltaLabel={
              flagged > 0
                ? 'Stories whose fake-news check was not a clean no'
                : 'No fabrication flags right now'
            }
            /* Three tiles in a two-column phone grid leave an orphan cell;
               the third spans the row instead of sitting beside a hole. */
            className="col-span-2 sm:col-span-1"
          />
        </m.div>
      )}

      {/* ── What this actually does ───────────────────────────────────────── */}
      <m.div variants={fadeUp} className="mt-4">
        <Card>
          <CardHead
            icon={<BellOff size={16} aria-hidden />}
            tint="blue"
            title="Nothing runs while this screen is shut"
            sub="No server watches on your behalf"
          />
          <div className="text-sm leading-relaxed text-ink-2">
            <p>
              There is no server holding this list and no job reading the papers on your behalf,
              so Signal cannot alert you and will never send a notification. Following someone
              means opening this screen and tapping Check now: it searches the papers set on the
              intake screen for that name, reads the first {READ_LIMIT} stories it finds, and puts
              them below. Everything here stays on this device.
            </p>
            {!canSearch && (
              <p className="mt-2.5 rounded-[var(--radius-md)] bg-[var(--warn-soft)] px-3 py-2 font-medium text-[var(--warn)]">
                No papers are set yet, so a check has nothing to search. Pick the state and tick
                the mastheads on the intake screen first.
              </p>
            )}
          </div>
        </Card>
      </m.div>

      {error && (
        <m.p
          variants={fadeUp}
          role="alert"
          className="mt-3 rounded-[var(--radius-md)] bg-[var(--neg-soft)] px-4 py-3 text-sm font-medium text-[var(--neg)]"
        >
          {error}
        </m.p>
      )}

      {/* ── Roster ────────────────────────────────────────────────────────── */}
      <m.section variants={fadeUp} className="mt-6">
        <SectionTitle hint="Removing somebody takes their mentions with them. Tasks you already raised stay in Actions.">
          Followed
          <span className="ml-2 text-sm font-normal text-ink-3">{personas.length}</span>
        </SectionTitle>

        <Card className="mb-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                className="text-2xs font-medium uppercase tracking-[0.04em] text-ink-3"
                htmlFor="persona-name"
              >
                Name
              </label>
              <input
                id="persona-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="As the English papers print it"
                className="mt-1.5 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2 text-sm text-ink outline-none transition-colors focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </div>
            <div>
              <label
                className="text-2xs font-medium uppercase tracking-[0.04em] text-ink-3"
                htmlFor="persona-aliases"
              >
                Other spellings
              </label>
              <input
                id="persona-aliases"
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                placeholder="Telugu spelling, initials, short form"
                className="mt-1.5 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2 text-sm text-ink outline-none transition-colors focus:border-[var(--accent)] focus:bg-[var(--surface)]"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-ink-3">
            Separate spellings with commas. A name written in Telugu will never match an English
            headline, and the papers here print both. Without the second spelling a check finds
            part of the coverage and presents it as all of it.
          </p>
          <div className="mt-3">
            <Button size="sm" onClick={addPersona} disabled={!name.trim()}>
              <Plus size={14} aria-hidden /> Add
            </Button>
          </div>
        </Card>

        {personas.length === 0 ? (
          <EmptyRoster subject={store.profile?.subject ?? null} />
        ) : (
          <m.ul
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
            variants={listStagger}
            initial={reduced ? false : 'hidden'}
            animate="show"
          >
            {personas.map((person) => (
              <PersonaCard
                key={person.id}
                person={person}
                count={countByPersona.get(person.id) ?? 0}
                selected={current?.id === person.id}
                progress={progress?.personaId === person.id ? progress : null}
                busy={progress != null}
                onSelect={() => {
                  setSelectedPersona(person.id)
                  setSelectedMention(null)
                }}
                onCheck={() => void check(person)}
                onRemove={() => removePersona(person.id)}
              />
            ))}
          </m.ul>
        )}
      </m.section>

      {current && report?.personaId === current.id && (
        <m.div variants={fadeUp} className="mt-4">
          <CheckSummary report={report} name={current.name} />
        </m.div>
      )}

      {/* ── The person on screen, drawn from what this device already holds ─ */}
      {current && mentions.length > 0 && (
        <m.section variants={fadeUp} className="mt-6">
          <PersonaProfilePanel person={current} mentions={mentions} />
        </m.section>
      )}

      {/* ── The mentions, and the one that is open ────────────────────────── */}
      {current && (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
          {/* On a phone the detail replaces the list; at lg they sit side by side. */}
          <section className={cn('min-w-0', openMention && 'hidden lg:block')}>
            <SectionTitle
              hint={
                current.lastCheckedAt
                  ? `Last checked ${relativeTime(current.lastCheckedAt)}. Newest first.`
                  : 'Not checked yet on this device.'
              }
            >
              {current.name}
              <span className="ml-2 text-sm font-normal text-ink-3">{mentions.length}</span>
            </SectionTitle>

            {mentions.length === 0 ? (
              <Card level="quiet">
                <p className="text-sm leading-relaxed text-ink-2">
                  {current.lastCheckedAt
                    ? 'The last check found nothing carrying this name. Add the Telugu spelling and the short form the papers use, then check again.'
                    : `Nothing read for ${current.name} yet. Tap Check now on their card above.`}
                </p>
              </Card>
            ) : (
              <m.ul
                className="space-y-2"
                variants={listStagger}
                initial={reduced ? false : 'hidden'}
                animate="show"
              >
                {mentions.map((mention) => (
                  <MentionRow
                    key={mention.id}
                    mention={mention}
                    open={openMention?.id === mention.id}
                    onOpen={() => {
                      setSelectedMention(mention.id)
                      // On a phone the detail replaces this list, so land at its
                      // top. On a desktop both are on screen and yanking the
                      // page would lose the reader's place in the list.
                      if (window.innerWidth < 1024) window.scrollTo({ top: 0 })
                    }}
                  />
                ))}
              </m.ul>
            )}
          </section>

          <section className={cn('min-w-0', !openMention && 'hidden lg:block')}>
            {openMention ? (
              <MentionDetail
                mention={openMention}
                person={current}
                alreadyActioned={actioned.has(openMention.id)}
                onBack={() => setSelectedMention(null)}
                onMakeAction={() => makeAction(openMention, current)}
              />
            ) : (
              <Card level="quiet">
                <p className="text-sm leading-relaxed text-ink-3">
                  Open a mention to read the summary, what the fake-news check found, and what it
                  suggests doing about it.
                </p>
              </Card>
            )}
          </section>
        </div>
      )}
    </m.div>
  )
}

/* ── Empty state ─────────────────────────────────────────────────────────── */

/**
 * The empty state teaches, because nobody arrives here already knowing what a
 * persona tracker is for. Roles rather than names: this product exists to catch
 * invented claims about named people, so it does not get to invent names of its
 * own. The one real name it offers is the office's own subject, which is
 * already on the device.
 */
function EmptyRoster({ subject }: { subject: string | null }) {
  const first = [
    subject
      ? `${subject}, the member this office belongs to. Most of what needs answering is said about them.`
      : 'The member this office belongs to. Most of what needs answering is said about them.',
    'Whoever contests against them, because that is where the attacks start.',
    'The officials your grievances keep naming: the collector, the executive engineer, the tahsildar whose department is in every second complaint.',
    'Any local figure whose posts your associates keep forwarding to you.',
  ]

  return (
    <Card>
      <CardHead
        icon={<UserSearch size={16} aria-hidden />}
        tint="violet"
        title="Nobody is being followed yet"
        sub="Who this screen is for"
      />
      <div className="text-sm leading-relaxed text-ink-2">
        <p>
          A persona tracker follows one named person through the papers this desk already reads.
          It collects what was written about them, whether the story reads as supportive or
          critical, and whether anything about it looks fabricated, so the office hears it here
          rather than in a phone call at ten at night.
        </p>
        <p className="mt-4 text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
          Who to add first
        </p>
        <ul className="mt-2 space-y-2">
          {first.map((line) => (
            <li key={line} className="flex gap-2.5">
              <span
                aria-hidden
                className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--accent)]"
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3">Add each of them in both scripts, or you will only see half of it.</p>
      </div>
    </Card>
  )
}

/* ── Roster card ─────────────────────────────────────────────────────────── */

function PersonaCard({
  person,
  count,
  selected,
  progress,
  busy,
  onSelect,
  onCheck,
  onRemove,
}: {
  person: TrackedPersona
  count: number
  selected: boolean
  progress: Progress | null
  busy: boolean
  onSelect: () => void
  onCheck: () => void
  onRemove: () => void
}) {
  return (
    <m.li variants={listItem}>
      <div
        className={cn(
          'card h-full p-4',
          // The accent ring never carries this alone: the word "Showing"
          // sits beside the button, so the state survives grayscale.
          selected ? 'ring-2 ring-[var(--accent)]' : 'card-hover',
        )}
      >
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <Avatar name={person.name} size={44} />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold text-ink">{person.name}</span>
              <span className="mt-0.5 block text-xs text-ink-3">
                {count} {pluralise(count, 'mention')}
                {person.lastCheckedAt
                  ? ` · checked ${relativeTime(person.lastCheckedAt)}`
                  : ' · not checked yet'}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Stop following ${person.name}`}
            className="-m-1 grid size-11 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-[var(--neg-soft)] hover:text-[var(--neg)]"
          >
            <Trash2 size={15} aria-hidden />
          </button>
        </div>

        {person.aliases.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {person.aliases.map((alias) => (
              <Chip key={alias} tone="neutral">
                {alias}
              </Chip>
            ))}
          </div>
        )}

        {progress ? (
          <div className="mt-4" role="status">
            <p className="text-xs font-medium text-ink-2">
              {progress.phase === 'finding'
                ? 'Searching the papers…'
                : `Reading story ${Math.min(progress.read + 1, progress.total)} of ${progress.total}…`}
            </p>
            <Bar
              className="mt-2"
              value={progress.total ? progress.read / progress.total : 0}
              tone="accent"
            />
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onCheck} disabled={busy}>
              <RefreshCw size={14} aria-hidden />
              Check now
            </Button>
            {selected && <Chip tone="accent">Showing</Chip>}
          </div>
        )}
      </div>
    </m.li>
  )
}

/* ── What the last check did ─────────────────────────────────────────────── */

function CheckSummary({ report, name }: { report: CheckReport; name: string }) {
  return (
    <Card>
      <CardHead
        icon={<RefreshCw size={16} aria-hidden />}
        tint="blue"
        title="What the last check did"
        sub="Counted from the run just finished"
      />

      {report.found === 0 ? (
        <p className="text-sm leading-relaxed text-ink-2">
          Nothing carrying {name} was published in the papers Signal searched.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          {[
            {
              value: report.found,
              label: `${pluralise(report.found, 'story', 'stories')} named ${name}`,
            },
            { value: report.read, label: report.read === 1 ? 'was read' : 'were read' },
            { value: report.added, label: 'classified below' },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="tnum text-[22px] font-bold leading-none text-ink">{stat.value}</p>
              <p className="mt-1.5 text-[11px] text-ink-3">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {report.sources.length > 0 && (
        <p className="mt-3 text-xs text-ink-3">Per paper: {report.sources.join(' · ')}.</p>
      )}

      {report.notes.map((note) => (
        <p key={note} className="mt-2 text-xs text-ink-3">
          {note}
        </p>
      ))}

      {report.unread.length > 0 && (
        <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3.5">
          <p className="text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
            Found but not read
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-3">
            Signal reads {READ_LIMIT} at a time so the request finishes before the server cuts it
            off. These were left. Open them yourself, or paste them into the grievance desk.
          </p>
          <ul className="mt-2 space-y-1">
            {report.unread.map((candidate) => (
              <li key={candidate.url}>
                <a
                  href={candidate.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex min-h-11 items-center gap-2 text-xs font-medium text-[var(--accent)] hover:underline"
                >
                  <ExternalLink size={12} aria-hidden className="shrink-0" />
                  <span className="line-clamp-2">
                    {candidate.title} ({candidate.portal})
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

/* ── The selected person, as a profile ───────────────────────────────────── */

/**
 * Reference-5 profile language for whoever is on screen, built entirely from the
 * mentions this device already holds — no new request, no new field.
 *
 * A ringed avatar and the spellings we search under; a violet-badged grid of
 * what is on file; how the coverage reads as a sentiment donut counting only the
 * stories a reader could actually score (an unscored story is never coloured in,
 * for the same reason a missing sentiment is never rendered as "Neutral"); a
 * coverage-over-time sparkline when the dates spread far enough to mean
 * something; and a map of where the stories are datelined. The map obeys the
 * gazetteer's honesty rule to the letter: a place it cannot resolve is left off
 * and counted in a footnote, never dropped onto a plausible-looking dot.
 */
function PersonaProfilePanel({ person, mentions }: { person: TrackedPersona; mentions: PersonaMention[] }) {
  const stance = useMemo(() => {
    const counts: Record<PersonaStance, number> = { supportive: 0, critical: 0, neutral: 0, unclear: 0 }
    for (const mention of mentions) counts[mention.stance] += 1
    return counts
  }, [mentions])

  const flagged = useMemo(
    () => mentions.filter((x) => x.fake != null && x.fake.suspicion !== 'No').length,
    [mentions],
  )

  const sentiment = useMemo(() => {
    const buckets: Record<'positive' | 'neutral' | 'mixed' | 'negative', number> = {
      positive: 0,
      neutral: 0,
      mixed: 0,
      negative: 0,
    }
    let scored = 0
    for (const mention of mentions) {
      if (!mention.sentiment) continue
      buckets[SENTIMENT_TONE[mention.sentiment]] += 1
      scored += 1
    }
    const segments = [
      { label: 'Positive', value: buckets.positive, color: 'var(--chart-pos)' },
      { label: 'Neutral', value: buckets.neutral, color: 'var(--chart-mid)' },
      { label: 'Mixed', value: buckets.mixed, color: 'var(--warn)' },
      { label: 'Negative', value: buckets.negative, color: 'var(--chart-neg)' },
    ].filter((s) => s.value > 0)
    return { segments, scored, unscored: mentions.length - scored }
  }, [mentions])

  /**
   * Mentions grouped by the place they name, geocoded. Anything the gazetteer
   * cannot resolve is dropped from the map and tallied instead — honesty over a
   * fuller-looking map, exactly as the base contract requires.
   */
  const origins = useMemo(() => {
    const byPlace = new Map<string, { place: Place; count: number; supportive: number; critical: number }>()
    let unplaced = 0
    for (const mention of mentions) {
      if (!mention.place) continue
      const geo = geocodePlace(mention.place)
      if (!geo) {
        unplaced += 1
        continue
      }
      const entry = byPlace.get(geo.name) ?? { place: geo, count: 0, supportive: 0, critical: 0 }
      entry.count += 1
      if (mention.stance === 'supportive') entry.supportive += 1
      else if (mention.stance === 'critical') entry.critical += 1
      byPlace.set(geo.name, entry)
    }
    const list = [...byPlace.values()]
    const maxCount = Math.max(...list.map((e) => e.count), 1)
    const markers: MapMarker[] = list.map((e) => {
      const tone: MapMarker['tone'] =
        e.critical > e.supportive ? 'negative' : e.supportive > e.critical ? 'positive' : 'violet'
      return {
        lon: e.place.lon,
        lat: e.place.lat,
        label: e.place.name,
        detail: `${e.count} ${pluralise(e.count, 'mention')} · ${e.place.state}`,
        tone,
        weight: e.count / maxCount,
      }
    })
    const toneLegend = [
      markers.some((mk) => mk.tone === 'positive') && { label: 'Mostly supportive', color: 'var(--pos)' },
      markers.some((mk) => mk.tone === 'negative') && { label: 'Mostly critical', color: 'var(--neg)' },
      markers.some((mk) => mk.tone === 'violet') && { label: 'Mixed or even', color: 'var(--accent-2)' },
    ].filter((x): x is { label: string; color: string } => Boolean(x))
    return { markers, unplaced, toneLegend }
  }, [mentions])

  /**
   * Coverage volume over time, binned by the date each story ran. Only drawn
   * when there are enough stories spread across enough days to be a shape rather
   * than a single spike dressed up as a trend.
   */
  const activity = useMemo(() => {
    const times = mentions
      .map((mention) => {
        const t = Date.parse(mention.publishedAt ?? mention.seenAt)
        return Number.isNaN(t) ? null : t
      })
      .filter((t): t is number => t != null)
    if (times.length < 3) return null
    const min = Math.min(...times)
    const max = Math.max(...times)
    if (max - min < 86_400_000) return null
    const bins = Math.min(Math.max(Math.round((max - min) / 86_400_000) + 1, 5), 20)
    const counts = new Array<number>(bins).fill(0)
    for (const t of times) {
      const idx = Math.min(bins - 1, Math.floor(((t - min) / (max - min)) * (bins - 1)))
      counts[idx] = (counts[idx] ?? 0) + 1
    }
    return counts
  }, [mentions])

  return (
    <div className="space-y-4">
      {/* Hero. The name may be written in Telugu, so it never wears .hed or tight tracking. */}
      <Card>
        <div className="flex items-center gap-4">
          <Avatar
            name={person.name}
            size={60}
            className="ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface)]"
          />
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Currently showing</p>
            <p className="mt-0.5 truncate text-xl font-bold leading-snug text-ink">{person.name}</p>
            <p className="mt-0.5 text-xs text-ink-3">
              {mentions.length} {pluralise(mentions.length, 'mention')}
              {person.lastCheckedAt
                ? ` · checked ${relativeTime(person.lastCheckedAt)}`
                : ' · not checked yet'}
            </p>
          </div>
        </div>
        {person.aliases.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">Also</span>
            {person.aliases.map((alias) => (
              <Chip key={alias} tone="neutral">
                {alias}
              </Chip>
            ))}
          </div>
        )}
      </Card>

      {/* How this device's mentions decompose by stance, plus the suspect flag.
          The three stance tiles sum to the total in the hero line above; colour
          carries meaning on each, so a grayscale reading still separates them. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <IconStat
          icon={<ThumbsUp size={18} />}
          label="Read as supportive"
          value={stance.supportive}
          tint="green"
          deltaLabel="by the reader"
        />
        <IconStat
          icon={<ThumbsDown size={18} />}
          label="Read as critical"
          value={stance.critical}
          tint="pink"
          deltaLabel="by the reader"
        />
        <IconStat
          icon={<Minus size={18} />}
          label="Neutral or unclear"
          value={stance.neutral + stance.unclear}
          tint="violet"
          deltaLabel="no clear lean read"
        />
        <IconStat
          icon={<TriangleAlert size={18} />}
          label="Flagged as suspect"
          value={flagged}
          tint="orange"
          deltaLabel={flagged > 0 ? 'fake-news check not a clean no' : 'none flagged'}
        />
      </div>

      {(sentiment.scored > 0 || activity) && (
        /* Two columns only when both cards exist — one card beside an empty
           grid cell reads as something failed to load. */
        <div className={cn('grid gap-4', sentiment.scored > 0 && activity && 'lg:grid-cols-2')}>
          {sentiment.scored > 0 && (
            <Card>
              <CardHead
                icon={<PieChart size={16} aria-hidden />}
                tint="violet"
                title="How the coverage reads"
                sub="Scored mentions only, never guessed at"
                hint="Scored mentions only. A story nobody could score is never coloured in."
              />
              <div className="mt-1 flex flex-col items-center gap-5 sm:flex-row">
                <DonutBreakdown
                  segments={sentiment.segments}
                  centerLabel={String(sentiment.scored)}
                  centerSub={pluralise(sentiment.scored, 'mention')}
                />
                <div className="min-w-0 flex-1">
                  <Legend items={sentiment.segments.map((s) => ({ label: s.label, color: s.color }))} />
                  {sentiment.unscored > 0 && (
                    <p className="mt-3 text-xs text-ink-3">
                      {sentiment.unscored} not scored. Carried through, never guessed at.
                    </p>
                  )}
                </div>
              </div>
            </Card>
          )}

          {activity && (
            <Card>
              <CardHead
                icon={<TrendingUp size={16} aria-hidden />}
                tint="violet"
                title="Coverage over time"
                sub="By the date each story was published"
              />
              <Sparkline values={activity} color="var(--accent-2)" height={48} className="mt-2" />
            </Card>
          )}
        </div>
      )}

      {origins.markers.length > 0 && (
        <Card>
          <CardHead
            icon={<MapPin size={16} aria-hidden />}
            tint="blue"
            title="Where the coverage is datelined"
            sub="Only places Signal can put on the map"
            hint="Only places Signal can put on the map are shown. Anything it cannot place is counted below, never guessed at."
          />
          <IndiaMap dots={INDIA_DOTS} bbox={INDIA_BBOX} markers={origins.markers} className="mt-1" />
          {origins.toneLegend.length > 1 && <Legend items={origins.toneLegend} className="mt-3" />}
          {origins.unplaced > 0 && (
            <p className="mt-3 text-xs text-ink-3">
              {origins.unplaced} {pluralise(origins.unplaced, 'mention')} named a place Signal has no
              coordinates for and {origins.unplaced === 1 ? 'is' : 'are'} not shown.
            </p>
          )}
        </Card>
      )}
    </div>
  )
}

/* ── Rows ────────────────────────────────────────────────────────────────── */

function FakeMarker({ fake }: { fake: FakeAssessment }) {
  const label = SUSPICION_LABEL[fake.suspicion]
  // "No" gets no chip at all. A marker on every row is decoration, and the one
  // story that needs a second pair of eyes stops standing out.
  if (!label) return null
  return (
    <Chip
      tone={fake.suspicion === 'Unsure' ? 'warning' : 'negative'}
      icon={<TriangleAlert size={12} aria-hidden />}
      title={fake.note ?? undefined}
    >
      {label}
    </Chip>
  )
}

function MentionRow({
  mention,
  open,
  onOpen,
}: {
  mention: PersonaMention
  open: boolean
  onOpen: () => void
}) {
  const meta = [
    mention.publisher,
    mention.place,
    mention.publishedAt
      ? relativeTime(mention.publishedAt)
      : `date not published · read ${relativeTime(mention.seenAt)}`,
  ].filter((part): part is string => Boolean(part))

  return (
    <m.li variants={listItem}>
      <button
        type="button"
        onClick={onOpen}
        aria-pressed={open}
        className={cn(
          'card w-full p-4 text-left',
          open ? 'ring-2 ring-[var(--accent)]' : 'card-hover',
        )}
      >
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-ink">
          {mention.headline}
        </p>
        <p className="mt-1.5 truncate text-xs text-ink-3">{meta.join(' · ')}</p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Chip tone={STANCE_TONE[mention.stance]}>{STANCE_LABEL[mention.stance]}</Chip>
          {mention.sentiment && (
            <Chip tone={SENTIMENT_CHIP[SENTIMENT_TONE[mention.sentiment]]}>
              {mention.sentiment}
            </Chip>
          )}
          {mention.fake && <FakeMarker fake={mention.fake} />}
        </div>
      </button>
    </m.li>
  )
}

/* ── Detail ──────────────────────────────────────────────────────────────── */

function MentionDetail({
  mention,
  person,
  alreadyActioned,
  onBack,
  onMakeAction,
}: {
  mention: PersonaMention
  person: TrackedPersona
  alreadyActioned: boolean
  onBack: () => void
  onMakeAction: () => void
}) {
  const [raised, setRaised] = useState(false)
  const rec = mention.recommendation
  const done = raised || alreadyActioned

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
              {mention.persona || person.name}
            </p>
            <h2 className="mt-1.5 text-xl font-bold leading-snug">{mention.headline}</h2>
          </div>
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to the list of mentions"
            className="-mr-1 -mt-1 grid size-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-2)] lg:hidden"
          >
            <ArrowLeft size={18} aria-hidden />
          </button>
        </div>

        <p className="mt-1.5 text-xs text-ink-3">
          {mention.publisher ?? hostOf(mention.url)} ·{' '}
          {mention.publishedAt ? absoluteDate(mention.publishedAt) : 'Date not published'}
          {mention.language ? ` · ${mention.language}` : ''}
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip tone={STANCE_TONE[mention.stance]}>{STANCE_LABEL[mention.stance]}</Chip>
          {mention.sentiment ? (
            <Chip tone={SENTIMENT_CHIP[SENTIMENT_TONE[mention.sentiment]]}>
              {mention.sentiment}
            </Chip>
          ) : (
            <Chip tone="neutral">Sentiment not stated</Chip>
          )}
          {mention.place && (
            <Chip tone="neutral" icon={<MapPin size={11} aria-hidden />}>
              {mention.place}
            </Chip>
          )}
        </div>

        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          {mention.summary || 'No summary came back for this story. Open it and read it yourself.'}
        </p>

        {mention.excerpt && (
          <p className="mt-3 rounded-r-[var(--radius-md)] border-l-2 border-[var(--border-strong)] bg-[var(--surface-2)] py-2.5 pl-3.5 pr-3 text-sm leading-relaxed text-ink-3">
            {mention.excerpt}
          </p>
        )}

        <a
          href={mention.url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-[var(--accent)] hover:underline"
        >
          <ExternalLink size={13} aria-hidden />
          Open the story
        </a>
      </Card>

      {/* ── Is any of it made up ─────────────────────────────────────────── */}
      <Card>
        <CardHead
          icon={<TriangleAlert size={16} aria-hidden />}
          tint="orange"
          title="Fake-news check"
          sub="Signals, not a verdict. A person decides."
        />

        {!mention.fake ? (
          <p className="text-sm text-ink-3">
            No fake-news check came back for this story, so nothing is claimed either way.
          </p>
        ) : (
          <>
            <LevelPips
              level={mention.fake.suspicion}
              scale={FAKE_SUSPICION}
              tone="negative"
              label="Suspicion it is fabricated"
            />

            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chip tone="neutral">{mention.fake.debunkStatus}</Chip>
              {mention.fake.type && <Chip tone="warning">{mention.fake.type}</Chip>}
            </div>

            {mention.fake.note && (
              <p className="mt-3 text-sm leading-relaxed text-ink-2">{mention.fake.note}</p>
            )}

            {mention.fake.signals.length === 0 ? (
              <p className="mt-3 text-sm text-ink-3">
                No signals were found either way, so this rests on the suspicion above alone.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {mention.fake.signals.map((signal, i) => (
                  <li
                    key={`${signal.kind}-${i}`}
                    className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
                        {SIGNAL_LABEL[signal.kind]}
                      </span>
                      <Chip tone={SUPPORTS_TONE[signal.supports]}>
                        {SUPPORTS_LABEL[signal.supports]}
                      </Chip>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{signal.finding}</p>
                    <p className="mt-1 text-2xs text-ink-3">{CONFIDENCE_LABEL[signal.confidence]}</p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      {/* ── And then somebody does something about it ────────────────────── */}
      <Card>
        <CardHead icon={<ListChecks size={16} aria-hidden />} tint="blue" title="What to do" />

        {!rec ? (
          <p className="text-sm text-ink-3">
            No recommendation came back for this one, so there is nothing to turn into a task. Read
            the story and decide.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Chip tone="accent">{rec.action}</Chip>
              <Chip tone={PRIORITY_TONE[rec.priority]}>{rec.priority} priority</Chip>
              <Chip tone="neutral" icon={<Megaphone size={11} aria-hidden />}>
                {rec.channel}
              </Chip>
            </div>

            {rec.rationale && (
              <p className="mt-2.5 text-sm leading-relaxed text-ink-2">{rec.rationale}</p>
            )}

            {rec.talkingPoints.length > 0 && (
              <>
                <p className="mt-4 text-2xs font-medium uppercase tracking-[0.04em] text-ink-3">
                  Lines you can use
                </p>
                <ul className="mt-2 space-y-2">
                  {rec.talkingPoints.map((point, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3"
                    >
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-2xs font-semibold text-[var(--accent)]">
                        {i + 1}
                      </span>
                      <p className="flex-1 text-sm leading-relaxed">{point}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="mt-4 border-t border-[var(--border)] pt-3">
              {done ? (
                <p className="flex items-center gap-2 text-sm text-[var(--pos)]">
                  <Check size={15} aria-hidden />
                  On the Actions sheet.
                </p>
              ) : (
                <>
                  <Button
                    size="sm"
                    onClick={() => {
                      onMakeAction()
                      setRaised(true)
                    }}
                  >
                    <ListChecks size={14} aria-hidden />
                    Make this an action
                  </Button>
                  <p className="mt-2 text-xs text-ink-3">
                    Adds a Planned task at {rec.priority.toLowerCase()} priority, due{' '}
                    {absoluteDate(dueIn(DUE_DAYS[rec.priority]))}, with the story attached. No
                    department is set. The desk assigns that on the Actions sheet.
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
