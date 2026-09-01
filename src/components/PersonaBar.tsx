import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Plus, Search, Trash2, X } from 'lucide-react'
import type { Identity } from '@shared/identity'
import { looksLikeUrl, resolveIdentity, type PersonCandidate } from '@/lib/identity'
import {
  PRIMARY,
  activePersona,
  addPersona,
  listPersonas,
  removePersona,
  personasAvailable,
  setActivePersona,
  subscribePersonas,
  type Persona,
} from '@/lib/personas'
import { handleId, listHandles, saveHandle, type TrackedHandle } from '@/lib/handles'
import { suggestionsFromIdentity } from '@/components/SuggestedAccounts'
import { Avatar, Button } from '@/components/ui'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { haptic } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * The other politicians this desk is watching, and the way to add one.
 *
 * WHAT IT IS NOT. It is not a way to change who the desk is FOR. That is the
 * name given in setup, it decides the news scan's terms and every greeting, and
 * it stays primary until somebody goes back to setup and changes it there. The
 * first chip is that person, it cannot be removed, and it is selected on every
 * fresh visit.
 *
 * WHAT IT IS. A second desk beside the first — an ally, a rival, a colleague
 * the office also watches — holding its own tracked accounts, its own follower
 * readings and its own opinion cache, reachable in one tap. The example desk
 * has worked this way since it shipped: five politicians, five separate desks,
 * one row of chips (`DemoBar`). This is that, for real accounts.
 *
 * The separation is real rather than a filter over one pile. Every per-desk
 * cache is suffixed with the persona's key (`lib/personas.ts`), so switching
 * changes what `listHandles()` returns rather than what a component chooses to
 * draw — which is the only version where a second politician's follower history
 * cannot end up summed into the first one's totals.
 *
 * ADDING ONE SEEDS IT. A persona added and left empty is a dashboard of "NA ·
 * Not read yet", which is precisely the state this product is worst at
 * explaining. So the same identity lookup that sets up the desk runs here, its
 * public accounts are staged as tracked handles, and they are read before the
 * switch completes. An office that types "Narendra Modi" gets a desk with
 * numbers on it, not an empty one with his name at the top.
 */

/** `/api/handle` reads at most six accounts per request. */
const READ_BATCH = 6

/**
 * Read the freshly seeded accounts so the new desk opens with figures on it.
 *
 * Deliberately best-effort and deliberately not reported as a failure: the
 * persona exists either way, and the dashboard's own Refresh is one tap from
 * here. What it must not do is leave the accounts saved and unread, which is
 * the bug this whole screen already had once.
 */
async function readSeeded(seeded: TrackedHandle[]): Promise<void> {
  for (let from = 0; from < seeded.length; from += READ_BATCH) {
    const batch = seeded.slice(from, from + READ_BATCH)
    try {
      const qs = batch.map((h) => `q=${encodeURIComponent(h.profileUrl || h.handle)}`).join('&')
      const res = await fetch(`/api/handle?${qs}`)
      const json = (await res.json()) as { handles?: unknown[] }
      for (const [i, raw] of (json.handles ?? []).entries()) {
        const s = raw as {
          handle?: string
          displayName?: string | null
          avatarUrl?: string | null
          followers?: number | null
          posts?: TrackedHandle['snapshots'][number]['posts']
          listing?: { note?: string }
          error?: string
        }
        const target = batch[i]
        // A failed read stores nothing at all. A snapshot of nulls is a claim
        // that the account was read and found empty, and the card then says
        // "Not read yet" over it for ever because nothing retries a read that
        // reported itself finished.
        if (!target || s.error) continue
        const live = listHandles().find((h) => h.id === target.id)
        if (!live) continue
        saveHandle({
          ...live,
          handle: s.handle ?? live.handle,
          displayName: s.displayName ?? live.displayName,
          avatarUrl: s.avatarUrl ?? live.avatarUrl,
          listingNote: s.listing?.note ?? live.listingNote,
          snapshots: [
            ...live.snapshots,
            {
              takenAt: new Date().toISOString(),
              followers: s.followers ?? null,
              posts: s.posts ?? [],
            },
          ],
        })
      }
    } catch {
      /* offline: the desk still exists, and Refresh is one tap away */
    }
  }
}

/**
 * Stage a resolved person's public accounts onto the desk that is now open.
 *
 * `own: true`, and that is safe here precisely BECAUSE the persona has its own
 * namespace. `own` means "the subject of this desk", not "the office's own
 * login" — and on Narendra Modi's persona desk the subject is Modi. His
 * accounts are what its totals must count and whose comment sections its
 * opinion readings must come from.
 *
 * The reason this cannot leak into the primary's numbers is the suffix: these
 * are written under `::p-<key>` and the primary desk never reads that key. If
 * personas shared one list, `own` would have to be false and every total on
 * the persona's desk would be empty.
 */
function seedHandles(identity: Identity): TrackedHandle[] {
  const existing = new Set(listHandles().map((h) => h.id))
  const made: TrackedHandle[] = []
  for (const s of suggestionsFromIdentity(identity, 'theirs')) {
    const id = handleId(s.platform, s.handle)
    if (existing.has(id)) continue
    existing.add(id)
    const handle: TrackedHandle = {
      id,
      platform: s.platform,
      handle: s.handle,
      displayName: s.displayName,
      profileUrl: s.url,
      avatarUrl: s.avatarUrl,
      own: true,
      label: null,
      listingNote: '',
      snapshots: [],
    }
    saveHandle(handle)
    made.push(handle)
  }
  return made
}

/* ── the bar ─────────────────────────────────────────────────────────────── */

export function PersonaBar({
  primaryName,
  primaryPhoto,
  onSwitched,
}: {
  primaryName: string
  primaryPhoto: string | null
  /** Remount the desk: everything below reads a different namespace now. */
  onSwitched: () => void
}) {
  const [, bump] = useState(0)
  useEffect(() => subscribePersonas(() => bump((n) => n + 1)), [])

  const personas = listPersonas()
  const active = activePersona()
  const [adding, setAdding] = useState(false)

  // Not in the example desk. It has its own principal switcher over the same
  // storage, and a second one would be a control that disagrees with the first
  // about whose accounts are on screen.
  if (!personasAvailable()) return null

  const choose = (key: string): void => {
    if (key === active) return
    haptic.tap()
    setActivePersona(key)
    onSwitched()
  }

  return (
    <>
      {/*
        One scrolling row on a phone, wrapping from sm: up — the demo bar's own
        construction, for its own reason: names at 390px wrap to three rows and
        push the first real figure off the screen. `-mx-*` lets the row bleed to
        the edge so the last chip is visibly cut off, which is what tells a
        thumb there is more to the right.
      */}
      <div
        className={cn(
          'mt-3 flex items-center gap-2 overflow-x-auto scrollbar-none',
          '-mx-4 px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0',
        )}
        role="tablist"
        aria-label="Whose desk to show"
      >
        <Chip
          on={active === PRIMARY}
          name={primaryName}
          photo={primaryPhoto}
          note="you"
          onClick={() => choose(PRIMARY)}
        />

        {personas.map((p) => (
          <Chip
            key={p.key}
            on={active === p.key}
            name={p.name}
            photo={p.photoUrl}
            note={p.role}
            onClick={() => choose(p.key)}
            onRemove={
              active === p.key
                ? () => {
                    removePersona(p.key)
                    onSwitched()
                  }
                : undefined
            }
          />
        ))}

        <button
          type="button"
          onClick={() => {
            haptic.tap()
            setAdding(true)
          }}
          aria-label="Add another politician to watch"
          title="Add another politician to watch"
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-full border border-dashed',
            'border-[var(--border-interactive)] text-ink-2 transition-colors',
            'hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]',
          )}
        >
          <Plus size={17} aria-hidden />
        </button>
      </div>

      {adding && (
        <AddPersona
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false)
            onSwitched()
          }}
        />
      )}
    </>
  )
}

function Chip({
  on,
  name,
  photo,
  note,
  onClick,
  onRemove,
}: {
  on: boolean
  name: string
  photo: string | null
  note: string | null
  onClick: () => void
  /** Offered only on the OPEN persona, and never on the primary. */
  onRemove?: () => void
}) {
  return (
    <span
      className={cn(
        'flex min-h-10 shrink-0 items-center gap-2 rounded-full border pl-1 pr-1 text-sm transition',
        on
          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-ink'
          : 'border-[var(--border)] bg-[var(--surface)] text-ink-2 hover:border-[var(--border-strong)]',
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={on}
        onClick={onClick}
        className="flex min-h-10 items-center gap-2 rounded-full pr-2"
      >
        <Avatar src={photo} name={name} size={28} className="shrink-0" />
        <span className={cn('whitespace-nowrap', on && 'font-semibold')}>{name}</span>
        {note && (
          <span className="whitespace-nowrap text-[11px] text-ink-3">{note}</span>
        )}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Stop watching ${name}`}
          title={`Stop watching ${name}`}
          className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-[var(--neg-soft)] hover:text-[var(--neg)]"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      )}
    </span>
  )
}

/* ── the dialog ──────────────────────────────────────────────────────────── */

/**
 * Name in, desk out.
 *
 * The same two routes setup offers, for the same reason: a name goes to the
 * index, and a pasted profile link resolves directly. There is no third
 * "type it all in by hand" route here — a persona with a hand-typed name and
 * no accounts is an empty desk, and the whole point of this dialog is that the
 * desk it produces has something on it.
 */
function AddPersona({ onClose, onAdded }: { onClose: () => void; onAdded: (p: Persona) => void }) {
  const panel = useRef<HTMLDivElement>(null)
  useFocusTrap(panel, true)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PersonCandidate[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Debounced at 350ms and floored at three characters — the index is somebody
  // else's public API and one search per keystroke is both rude and useless.
  useEffect(() => {
    const raw = query.trim()
    if (raw.length < 3 || looksLikeUrl(raw)) {
      setResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/identity/search?q=${encodeURIComponent(raw)}`)
          if (!res.ok) throw new Error(String(res.status))
          const payload = (await res.json()) as { candidates?: PersonCandidate[] }
          if (!cancelled) setResults(payload.candidates ?? [])
        } catch {
          if (!cancelled) setResults([])
        } finally {
          if (!cancelled) setSearching(false)
        }
      })()
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const take = async (input: { url?: string; name?: string }): Promise<void> => {
    setBusy(input.name ?? input.url ?? 'working')
    setError(null)
    const { identity, error: failure } = await resolveIdentity(input)
    if (!identity) {
      setBusy(null)
      setError(failure ?? 'That person could not be looked up. Try the full name, or paste a link.')
      return
    }

    // ORDER MATTERS. `addPersona` opens the new persona, which moves the
    // storage suffix — so the handles seeded after it land in the new desk's
    // namespace and not on top of the primary's tracked accounts.
    const persona = addPersona({
      name: identity.name,
      role: identity.role,
      constituency: identity.constituency,
      state: identity.state,
      party: identity.party,
      photoUrl: identity.photoUrl,
    })
    const seeded = seedHandles(identity)
    if (seeded.length) await readSeeded(seeded)

    haptic.success()
    setBusy(null)
    onAdded(persona)
  }

  const submit = (): void => {
    const raw = query.trim()
    if (!raw) {
      setError('Type a name, or paste a link to a public profile.')
      return
    }
    void take(looksLikeUrl(raw) ? { url: raw } : { name: raw })
  }

  return createPortal(
    /* Portalled to <body>: the dashboard header this opens from can sit under
       a `backdrop-filter`, which makes an ancestor the containing block for
       any fixed descendant — the dialog would then be laid out inside the
       header strip and clipped. */
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Add another politician"
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--e4)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-[-0.015em]">Watch another politician</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              They get their own dashboard, with their own accounts and readings. Yours stays the
              desk this is set up for.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-my-1 grid size-9 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-2)]"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="mt-4 flex items-stretch overflow-hidden rounded-full border border-[var(--border-interactive)] bg-[var(--surface-2)] focus-within:border-[var(--accent)]">
          <span className="grid w-11 shrink-0 place-items-center text-ink-3">
            {searching ? (
              <Loader2 size={16} className="animate-spin" aria-hidden />
            ) : (
              <Search size={16} aria-hidden />
            )}
          </span>
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder="e.g. Narendra Modi"
            aria-label="Politician's name"
            autoComplete="off"
            enterKeyHint="search"
            /* 16px, or iOS Safari zooms the page on focus. */
            className="h-12 min-w-0 flex-1 bg-transparent pr-4 text-[16px] outline-none placeholder:text-ink-3"
          />
        </div>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-[var(--radius-md)] bg-[var(--neg-soft)] p-3 text-sm leading-relaxed text-[var(--neg)]"
          >
            {error}
          </p>
        )}

        {busy !== null && (
          <p className="mt-4 flex items-center gap-2 text-sm text-ink-2">
            <Loader2 size={15} className="animate-spin" aria-hidden />
            Looking them up and reading their accounts…
          </p>
        )}

        {busy === null && results !== null && (
          <div className="mt-3">
            {results.length === 0 ? (
              <p className="px-1 py-2 text-sm leading-relaxed text-ink-2">
                Nobody by that name was found. Press Enter to use the name you typed.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {results.map((c) => (
                  <li key={c.url}>
                    <button
                      type="button"
                      onClick={() => void take({ url: c.url, name: c.name })}
                      className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
                    >
                      <Avatar src={c.thumbnail} name={c.name} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{c.name}</span>
                        {c.description && (
                          <span className="block truncate text-xs text-ink-3">{c.description}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Button className="mt-4 w-full" onClick={submit} disabled={busy !== null}>
          Add this desk
        </Button>
      </div>
    </div>,
    document.body,
  )
}
