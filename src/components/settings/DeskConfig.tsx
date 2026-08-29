import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import type { Influencer } from '@shared/grievance'
import { ASSEMBLY_TELUGU, suggestedTagsFor } from '@shared/grievance'
import { ALL_STATES, REGIONS, citiesOf, portalsForState } from '@shared/regions'
import type { Platform } from '@shared/taxonomy'
import { readStore, update, useStore } from '@/lib/store'
import { Button, Card, selectClass } from '@/components/ui'
import { PlatformBadge } from '@/components/kit'
import { AddInfluencer } from '@/components/AddInfluencer'
import { cn, compact, pluralise } from '@/lib/utils'

/**
 * The desk's configuration, in one file, rendered from two places.
 *
 * The masthead picker, the watch words and the custom links lived inline in
 * the grievance desk's intake panel, and the influencer roster could only be
 * edited on the Influencers screen. So "where do I change what the desk
 * reads" had two answers, and Settings — the screen named after the job —
 * carried neither. Both configuration surfaces now live here: the working
 * screens render them where the work happens, and Settings renders the same
 * components inside collapsed sections, so neither copy can drift because
 * there is no copy.
 *
 * The store writes live here too, as hooks, for the same reason. The profile
 * rebuild in these callbacks has been broken twice by a caller restating the
 * fields instead of spreading first; a third caller writing its own version
 * was the next occurrence waiting to happen.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   The office profile, read and written
   ═══════════════════════════════════════════════════════════════════════════ */

export interface DeskProfileConfig {
  state: string
  city: string
  tags: string[]
  portals: string[]
  customUrls: string[]
  onState: (next: string) => void
  onCity: (next: string) => void
  onTogglePortal: (label: string) => void
  onAddCustom: (url: string) => void
  onRemoveCustom: (url: string) => void
  onToggleTag: (tag: string) => void
}

/**
 * The desk profile in the exact shape DeskSetup renders, with the writes it
 * calls. Moved whole from Grievances.tsx; every caller of DeskSetup goes
 * through this so the spread-first rules below are stated once.
 */
export function useDeskProfile(): DeskProfileConfig {
  const store = useStore()

  const onState = useCallback(
    (next: string) =>
      update((s) => ({
        ...s,
        profile: {
          subject: s.profile?.subject ?? 'This office',
          constituency: '',
          // A different state means different papers and different
          // place words; carrying either over would scan the wrong
          // patch and look like it had worked. The district goes
          // with them, and is cleared by name rather than by being
          // left off the list — so this reads as a decision rather
          // than as the omission it looks identical to.
          district: undefined,
          watchTerms: [],
          state: next,
          portals: [],
          customPortalUrls: s.profile?.customPortalUrls ?? [],
        },
      })),
    [],
  )

  const onCity = useCallback(
    (next: string) =>
      update((s) => ({
        ...s,
        profile: {
          ...(s.profile ?? { subject: 'This office' }),
          subject: s.profile?.subject ?? 'This office',
          constituency: next,
          // Place words from the old segment would quietly keep
          // filtering for somewhere the desk no longer covers.
          watchTerms: (s.profile?.watchTerms ?? []).filter(
            (t) =>
              !Object.entries(ASSEMBLY_TELUGU).some(
                ([en, te]) => t.toLowerCase() === en.toLowerCase() || t === te,
              ),
          ),
          // Spread first, then restate: choosing a state calls this
          // immediately afterwards to clear the city, and rebuilding
          // the profile from scratch here wiped the state that had
          // just been set — the select snapped back to empty.
          state: s.profile?.state ?? '',
          portals: s.profile?.portals ?? [],
          customPortalUrls: s.profile?.customPortalUrls ?? [],
        },
      })),
    [],
  )

  const onTogglePortal = useCallback(
    (label: string) =>
      update((s) => {
        const current = s.profile?.portals ?? []
        return {
          ...s,
          profile: {
            // Spread first, as the custom-URL handler below already
            // does. Without it, toggling one masthead dropped
            // `district` and quietly widened the news scan from the
            // district edition to the whole state.
            ...(s.profile ?? {}),
            subject: s.profile?.subject ?? 'This office',
            constituency: s.profile?.constituency ?? '',
            watchTerms: s.profile?.watchTerms ?? [],
            state: s.profile?.state ?? '',
            portals: current.includes(label)
              ? current.filter((p) => p !== label)
              : [...current, label],
            customPortalUrls: s.profile?.customPortalUrls ?? [],
          },
        }
      }),
    [],
  )

  const onAddCustom = useCallback(
    (url: string) =>
      update((s) => ({
        ...s,
        profile: {
          ...(s.profile ?? { subject: 'This office' }),
          subject: s.profile?.subject ?? 'This office',
          constituency: s.profile?.constituency ?? '',
          watchTerms: s.profile?.watchTerms ?? [],
          state: s.profile?.state ?? '',
          portals: s.profile?.portals ?? [],
          customPortalUrls: [...(s.profile?.customPortalUrls ?? []), url],
        },
      })),
    [],
  )

  const onRemoveCustom = useCallback(
    (url: string) =>
      update((s) => ({
        ...s,
        profile: {
          ...(s.profile ?? { subject: 'This office' }),
          subject: s.profile?.subject ?? 'This office',
          constituency: s.profile?.constituency ?? '',
          watchTerms: s.profile?.watchTerms ?? [],
          state: s.profile?.state ?? '',
          portals: s.profile?.portals ?? [],
          customPortalUrls: (s.profile?.customPortalUrls ?? []).filter((u) => u !== url),
        },
      })),
    [],
  )

  const onToggleTag = useCallback(
    (tag: string) =>
      update((s) => {
        const current = s.profile?.watchTerms ?? []
        const has = current.some((t) => t.toLowerCase() === tag.toLowerCase())
        return {
          ...s,
          profile: {
            ...(s.profile ?? { subject: 'This office' }),
            subject: s.profile?.subject ?? 'This office',
            constituency: s.profile?.constituency ?? '',
            watchTerms: has
              ? current.filter((t) => t.toLowerCase() !== tag.toLowerCase())
              : [...current, tag],
          },
        }
      }),
    [],
  )

  return {
    state: store.profile?.state ?? '',
    city: store.profile?.constituency ?? '',
    tags: store.profile?.watchTerms ?? [],
    portals: store.profile?.portals ?? [],
    customUrls: store.profile?.customPortalUrls ?? [],
    onState,
    onCity,
    onTogglePortal,
    onAddCustom,
    onRemoveCustom,
    onToggleTag,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   The influencer roster, read and written
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The tracked accounts and the writes against them, shared by the Influencers
 * screen and the Settings section so the two cannot disagree about what
 * "already watched" means.
 */
export function useInfluencerRoster(): {
  influencers: Influencer[]
  isTracked: (platform: Platform, handle: string) => boolean
  add: (influencer: Influencer) => void
  remove: (id: string) => void
} {
  const store = useStore()

  /** Shared by both ways onto the roster, so neither can drift from the other. */
  const isTracked = useCallback(
    (platform: Platform, handle: string) =>
      readStore().influencers.some(
        (i) => i.platform === platform && i.handle.toLowerCase() === handle.toLowerCase(),
      ),
    [],
  )

  const add = useCallback((influencer: Influencer) => {
    update((s) => ({
      ...s,
      influencers: s.influencers.some((i) => i.id === influencer.id)
        ? s.influencers
        : [...s.influencers, influencer],
    }))
  }, [])

  /**
   * Only the roster entry goes. The mentions already read from the account
   * stay: they are records of what was said, not properties of the watch, and
   * the mention rows already render "Account removed" for an orphan.
   */
  const remove = useCallback((id: string) => {
    update((s) => ({ ...s, influencers: s.influencers.filter((i) => i.id !== id) }))
  }, [])

  return { influencers: store.influencers, isTracked, add, remove }
}

/* ═══════════════════════════════════════════════════════════════════════════
   The grievance desk's configuration UI

   Moved whole from Grievances.tsx. The intake panel there still renders it;
   the only change on the way over is that the scan controls became optional,
   because Settings renders the same panel with no paste box for a scan's
   results to land in.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Choose the segment, then the papers that cover it, then the words that make
 * a story ours.
 *
 * The desk previously opened on an empty box and the instruction "paste
 * links", which assumes the operator already knows which links. This asks the
 * three questions in the order an office actually answers them, and each
 * answer narrows the next: the segment decides which district pages to open,
 * and the tags decide which of the day's stories are worth filing at all.
 *
 * The segment and the tags are kept on the office profile rather than held for
 * this one paste, because they are the same every morning.
 */
export function DeskSetup({
  state,
  city,
  tags,
  portals,
  customUrls,
  onState,
  onCity,
  onTogglePortal,
  onAddCustom,
  onRemoveCustom,
  onToggleTag,
  onScan,
  scanning = false,
  scanNote = null,
  framed = true,
}: DeskProfileConfig & {
  /**
   * Absent where there is nowhere for the results to go. The intake panel
   * passes it and gets the Scan buttons; Settings leaves it off and gets the
   * same steps with no promise the screen cannot keep.
   */
  onScan?: () => void
  scanning?: boolean
  scanNote?: string | null
  /** The margin and bottom rule that separate this from the paste box below it. */
  framed?: boolean
}) {
  const available = state ? portalsForState(state) : []
  const suggested = city ? suggestedTagsFor(city) : null
  const extraCount = customUrls.length
  const ready = (portals.length > 0 || extraCount > 0) && !scanning

  /**
   * Configured desks collapse to one line.
   *
   * This is settings, not work. An office picks its state, its district, its
   * papers and its words once and then opens this screen every morning to read
   * the day's news — so leaving four expanded steps at the top of the desk puts
   * the thing they never touch above the thing they always do, and on a phone it
   * pushed the day's stories below the fold entirely.
   *
   * "Configured" means a district and at least one paper. Anything less and the
   * scan cannot run, so the steps stay open because there is still a decision to
   * make.
   */
  const configured = Boolean(city) && (portals.length > 0 || extraCount > 0)
  const [editing, setEditing] = useState(false)

  if (configured && !editing) {
    /**
     * What the scan is about to do, named rather than counted.
     *
     * This said "3 papers · 12 words", which tells an operator nothing they can
     * check. The one question this strip has to answer before somebody presses
     * Scan is "is it about to read the right thing" — and "Eenadu, Sakshi,
     * indianexpress.com" answers it where "3 papers" does not.
     */
    const paperNames = [...portals, ...customUrls.map(hostLabel)]
    return (
      <div className={cn('rounded-2xl bg-[var(--surface-2)] p-4', framed && 'mb-4')}>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <dl className="min-w-0 flex-1 space-y-1.5">
            <div className="flex gap-2">
              <dt className="eyebrow w-16 shrink-0 pt-1">
                Desk
              </dt>
              <dd className="min-w-0 text-sm font-semibold">
                {city}
                <span className="ml-1.5 font-normal text-ink-3">{state}</span>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="eyebrow w-16 shrink-0 pt-1">
                Papers
              </dt>
              <dd className="min-w-0 text-sm text-ink-2">
                {paperNames.length ? paperNames.join(', ') : 'None chosen'}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="eyebrow w-16 shrink-0 pt-1">
                Words
              </dt>
              <dd className="min-w-0 text-sm text-ink-2">
                {tags.length ? (
                  tags.join(', ')
                ) : (
                  <span className="text-ink-3">
                    None set, so the scan will bring back everything the papers carry
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setEditing(true)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-xs font-semibold text-ink-2 shadow-[var(--e1)] hover:border-[var(--border-interactive)] hover:text-[var(--accent)]"
            >
              <Pencil size={11} />
              Edit
            </button>
            {onScan && (
              <Button size="sm" onClick={onScan} disabled={!ready}>
                {scanning ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    Scanning
                  </>
                ) : (
                  <>
                    <Search size={14} />
                    Scan today
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {scanNote && (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-2">
            <Search size={12} className="mt-0.5 shrink-0 text-ink-3" />
            <span>{scanNote}</span>
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={cn(framed && 'mb-4 border-b border-[var(--rule)] pb-4')}>
      {configured && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="kicker">Desk settings</span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Done
          </Button>
        </div>
      )}
      {/* 1 — where the desk works */}
      <RegionPicker state={state} city={city} onState={onState} onCity={onCity} />

      {/* 2 — which mastheads to read */}
      {state && (
        <div className="mt-4">
          <span className="kicker">Step 2 · Papers to scan</span>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
            Tick as many as you want.
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {available.map((p) => {
              const on = portals.includes(p.label)
              return (
                <button
                  key={p.label}
                  onClick={() => onTogglePortal(p.label)}
                  aria-pressed={on}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3',
                    'text-xs font-semibold',
                    on
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'border-[var(--border-strong)] bg-[var(--surface)] text-ink-2 hover:border-[var(--border-interactive)]',
                  )}
                >
                  {on ? <Check size={11} /> : <Newspaper size={11} />}
                  {p.label}
                  <span className="opacity-60">{p.language.slice(0, 2)}</span>
                </button>
              )
            })}
          </div>

          {/* Added papers join the collection rather than sitting in a box of
              their own. They were a textarea, which made them look like a note
              to self instead of a source that gets read — and an address typed
              without https:// silently counted for nothing. */}
          <PortalInput onAdd={onAddCustom} existing={customUrls} />

          {customUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {customUrls.map((u) => (
                <button
                  key={u}
                  onClick={() => onRemoveCustom(u)}
                  aria-label={`Remove ${u}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 text-xs font-semibold text-[var(--accent)]"
                >
                  <Check size={11} />
                  {hostLabel(u)}
                  <X size={10} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3 — what counts as ours */}
      {suggested && (
        <div className="mt-4">
          <span className="kicker">Step 3 · Words that make a story yours</span>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
            Add your own mandal names.
          </p>
          <div className="mt-2 space-y-2">
            {(
              [
                ['Place', suggested.place],
                ['Subject', suggested.subject],
              ] as const
            ).map(([group, list]) => (
              <div key={group} className="flex flex-wrap items-center gap-1.5">
                <span className="eyebrow w-14 shrink-0">
                  {group}
                </span>
                {list.map((t) => {
                  const on = tags.some((x) => x.toLowerCase() === t.toLowerCase())
                  return (
                    <button
                      key={t}
                      onClick={() => onToggleTag(t)}
                      aria-pressed={on}
                      className={cn(
                        'inline-flex min-h-11 items-center gap-1 rounded-full border px-3',
                        'text-xs font-semibold',
                        on
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                          : 'border-[var(--border-strong)] bg-[var(--surface)] text-ink-2 hover:border-[var(--border-interactive)]',
                      )}
                    >
                      {on && <Check size={10} />}
                      {t}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          {/* Typed words, not just the suggested ones.
              The suggestions are places and civic subjects a stranger can guess.
              What actually finds a story is a mandal name, a scheme, or the
              officer everyone is complaining about — none of which any list
              shipped from outside this district could contain. */}
          <TagInput
            onAdd={(t) => onToggleTag(t)}
            existing={tags}
          />

          {tags.length > 0 && (
            <div className="mt-3">
              <p className="eyebrow">
                Watching for {tags.length} {pluralise(tags.length, 'word')}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button
                    key={t}
                    onClick={() => onToggleTag(t)}
                    aria-label={`Stop watching for ${t}`}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-transparent bg-[var(--accent-soft)] px-2.5 text-xs font-semibold text-[var(--accent)]"
                  >
                    {t}
                    <X size={10} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4 — go */}
      {state && onScan && (
        <div className="mt-4 border-t border-[var(--rule)] pt-4">
          <Button onClick={onScan} disabled={!ready} className="w-full sm:w-auto">
            {scanning ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                Scanning…
              </>
            ) : (
              <>
                <Search size={15} />
                Scan {portals.length + extraCount || 'the'}{' '}
                {pluralise(portals.length + extraCount || 2, 'paper')}
              </>
            )}
          </Button>

          {/* The result belongs here, beside the button that caused it.
              It used to render only at the top of the column, so an operator
              scrolled down to step 2 pressed Scan, the scan ran, and nothing
              visibly happened — the outcome was above the fold. */}
          {scanNote ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-2">
              <Search size={12} className="mt-0.5 shrink-0 text-ink-3" />
              <span>{scanNote}</span>
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-ink-3">
              {tags.length === 0
                ? 'With no words chosen this returns everything the papers are carrying, not just your patch.'
                : `Returns only stories carrying one of your ${tags.length} ${pluralise(tags.length, 'word')}.`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** The masthead's name, for a chip. Falls back to the raw string if unparseable. */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 28)
  }
}

/**
 * Add a paper by address.
 *
 * Accepts what people actually type. "www.indianexpress.com" has no scheme, and
 * the previous box required one — so the address sat there looking added while
 * counting for nothing and the scan quietly ignored it.
 */
function PortalInput({ onAdd, existing }: { onAdd: (url: string) => void; existing: string[] }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const commit = () => {
    const raw = value.trim()
    if (!raw) return
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    let url: string
    try {
      const parsed = new URL(withScheme)
      if (!parsed.hostname.includes('.')) throw new Error('no host')
      url = parsed.toString()
    } catch {
      setError(`“${raw}” is not a web address. It should look like indianexpress.com.`)
      return
    }
    if (existing.some((u) => u === url)) {
      setError('That paper is already in the collection.')
      return
    }
    onAdd(url)
    setValue('')
    setError(null)
  }

  return (
    <div className="mt-3">
      <label className="eyebrow">
        Add a paper: its address, or the section you read
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="indianexpress.com"
          aria-label="Add a news paper by address"
          className="min-h-11 min-w-0 flex-1 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm shadow-[var(--e1)] outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)]"
        />
        <Button size="sm" variant="outline" onClick={commit} disabled={!value.trim()}>
          <Plus size={14} />
          Add
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-[var(--warn)]">{error}</p>}
    </div>
  )
}

/**
 * Type a word the desk should watch for.
 *
 * Kept separate from the suggested chips because the two do different jobs: the
 * chips cover what an outsider can guess about a district, and this covers what
 * only the office knows — the mandal, the scheme, the officer's name. Enter
 * commits, so a run of words can be typed without reaching for the mouse.
 */
function TagInput({ onAdd, existing }: { onAdd: (tag: string) => void; existing: string[] }) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()
  const duplicate = existing.some((t) => t.toLowerCase() === trimmed.toLowerCase())

  const commit = () => {
    if (!trimmed || duplicate) return
    onAdd(trimmed)
    setValue('')
  }

  return (
    <div className="mt-3">
      <label className="eyebrow">
        Add your own: a mandal, a scheme, an officer
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
          placeholder="Denduluru, Amma Vodi, 22A land…"
          aria-label="Add a word to watch for"
          className="min-h-11 min-w-0 flex-1 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm shadow-[var(--e1)] outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)]"
        />
        <Button size="sm" variant="outline" onClick={commit} disabled={!trimmed || duplicate}>
          <Plus size={14} />
          Add
        </Button>
      </div>
      {duplicate && (
        <p className="mt-1 text-xs text-ink-3">“{trimmed}” is already on the list.</p>
      )}
    </div>
  )
}

/**
 * State first, then the city.
 *
 * The picker before this held one state's assembly segments, so an operator
 * searching for Hyderabad found nothing at all — it is in Telangana, and the
 * list did not know Telangana existed. Asking for the state first is also just
 * how people say where they work.
 */
function RegionPicker({
  state,
  city,
  onState,
  onCity,
}: {
  state: string
  city: string
  onState: (next: string) => void
  onCity: (next: string) => void
}) {
  const [query, setQuery] = useState('')
  const cities = state ? citiesOf(state) : []
  const region = REGIONS.find((r) => r.state === state)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? cities.filter((c) => c.toLowerCase().includes(q)) : cities
  }, [cities, query])

  const typed = query.trim()
  const exact = cities.some((c) => c.toLowerCase() === typed.toLowerCase())

  return (
    <div>
      <label className="block">
        <span className="kicker">Step 1 · State</span>
        <select
          value={state}
          onChange={(e) => {
            onState(e.target.value)
            onCity('')
            setQuery('')
          }}
          className={cn(selectClass, 'mt-2 w-full')}
        >
          <option value="">Choose a state…</option>
          {ALL_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {state && (
        <div className="mt-3">
          <span className="kicker">
            {region?.complete ? 'District' : 'City'}
            {city ? '' : ' (choose one)'}
          </span>

          {city ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                {city}
                {ASSEMBLY_TELUGU[city] && (
                  <span className="te ml-1.5 font-normal text-ink-2">{ASSEMBLY_TELUGU[city]}</span>
                )}
                <span className="ml-2 text-xs font-normal text-ink-3">{state}</span>
              </span>
              <Button size="sm" variant="outline" onClick={() => onCity('')}>
                Change
              </Button>
            </div>
          ) : (
            <>
              <div className="relative mt-2">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Type to find one of ${cities.length}`}
                  aria-label="Search districts and cities"
                  className="min-h-11 w-full rounded-full border border-[var(--border-strong)] bg-[var(--surface)] pl-9 pr-4 text-sm shadow-[var(--e1)] outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)]"
                />
              </div>

              <div className="mt-2 max-h-48 overflow-y-auto rounded-2xl border border-[var(--border)]">
                {shown.length === 0 ? (
                  <p className="px-3 py-3 text-xs leading-relaxed text-ink-2">
                    Nothing matches “{typed}”. Press “Use {typed}” below to keep it.
                  </p>
                ) : (
                  shown.map((c) => (
                    <button
                      key={c}
                      onClick={() => {
                        onCity(c)
                        setQuery('')
                      }}
                      className="flex min-h-11 w-full items-baseline gap-2 px-3 text-left text-sm hover:bg-[var(--surface-2)]"
                    >
                      <span>{c}</span>
                      {ASSEMBLY_TELUGU[c] && (
                        <span className="te text-xs text-ink-3">{ASSEMBLY_TELUGU[c]}</span>
                      )}
                    </button>
                  ))
                )}
              </div>

              {!region?.complete && (
                <p className="mt-1.5 text-xs text-ink-3">Not listed? Type it above.</p>
              )}

              {typed && !exact && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => {
                    onCity(typed)
                    setQuery('')
                  }}
                >
                  <Plus size={14} />
                  Use “{typed}”
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   The Settings sections
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A closed box with a name and a count, per the product owner: nothing shows
 * at first glance, and opening it is the only way in. The body is mounted only
 * while open, so a closed section costs no store reads.
 */
function ConfigSection({
  title,
  count,
  focus = false,
  children,
}: {
  title: string
  /** Terse, data only: "3 papers · 12 words". Never a sentence. */
  count: string
  /** Starts the section open and brings it into view. Set by the pencils. */
  focus?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(focus)
  const ref = useRef<HTMLDivElement | null>(null)

  // The pencil on a working screen lands here mid page. Opening the section
  // is not enough on a phone, where Settings' own header fills the viewport —
  // the section has to come to the reader. The delay lets the page's entrance
  // stagger settle first, the same wait the grievance desk's focus ring uses.
  useEffect(() => {
    if (!focus) return
    setOpen(true)
    const timer = setTimeout(
      () => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      120,
    )
    return () => clearTimeout(timer)
  }, [focus])

  return (
    <div ref={ref} className="scroll-mt-[calc(var(--topbar-h)+12px)]">
      <Card padded={false}>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{title}</span>
            <span className="block truncate text-xs text-ink-3">{count}</span>
          </span>
          <ChevronDown
            size={16}
            className={cn('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
        {open && <div className="border-t border-[var(--border)] p-4">{children}</div>}
      </Card>
    </div>
  )
}

/** The grievance desk's papers, words and links, as a Settings section. */
export function GrievanceDeskSection({ focus }: { focus?: boolean }) {
  const config = useDeskProfile()
  const papers = config.portals.length + config.customUrls.length
  const words = config.tags.length
  return (
    <ConfigSection
      title="Grievance desk settings"
      count={`${papers} ${pluralise(papers, 'paper')} · ${words} ${pluralise(words, 'word')}`}
      focus={focus}
    >
      {/* No onScan: a scan's results land in the desk's paste box, and this
          screen has no paste box. The desk keeps the Scan buttons. */}
      <DeskSetup {...config} framed={false} />
    </ConfigSection>
  )
}

/** The influencer roster — add a channel, see the list, take one off. */
export function InfluencerSection({ focus }: { focus?: boolean }) {
  const store = useStore()
  const { influencers, isTracked, add, remove } = useInfluencerRoster()
  return (
    <ConfigSection
      title="Influencer settings"
      count={`${influencers.length} ${pluralise(influencers.length, 'account')} watched`}
      focus={focus}
    >
      <AddInfluencer
        constituency={store.identity?.constituency ?? null}
        isTracked={isTracked}
        onAdd={add}
      />

      {influencers.length > 0 ? (
        <ul className="mt-4 divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {influencers.map((inf) => (
            <li key={inf.id} className="flex min-h-14 items-center gap-3 py-2">
              <PlatformBadge platform={inf.platform} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">
                  {inf.displayName ?? inf.handle}
                </span>
                <span className="block truncate text-xs text-ink-3">
                  @{inf.handle.replace(/^@/, '')}
                  {/* Only when the platform published one. A dash would claim
                      a reading nothing took. */}
                  {inf.followers != null && ` · ${compact(inf.followers)} followers`}
                </span>
              </span>
              <button
                onClick={() => remove(inf.id)}
                aria-label={`Stop watching ${inf.displayName ?? inf.handle}`}
                className="grid size-11 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-[var(--neg-soft)] hover:text-[var(--neg)]"
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-ink-3">
          You are not watching any accounts yet.
        </p>
      )}
    </ConfigSection>
  )
}
