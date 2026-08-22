import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Plus, Search, ShieldCheck, X } from 'lucide-react'
import type { Identity } from '@shared/identity'
import { Avatar, Button, Chip } from './ui'
import { PlatformBadge } from '@/components/kit'
import { suggestionsFromIdentity, type AccountSuggestion } from './SuggestedAccounts'
import { cn } from '@/lib/utils'

/**
 * Find someone's accounts by typing their name.
 *
 * The paste box beside this one is exact and unforgiving: it wants the address
 * of a profile page, and an office that does not already have that address in
 * its clipboard cannot use it at all. Working out a rival's YouTube channel URL
 * is a research task, and asking somebody to go and do it before they can watch
 * an account is how a tracking screen ends up tracking nothing.
 *
 * So: type a name, pick the person, and add whichever of their accounts you
 * want. Two calls, deliberately different in cost and cadence:
 *
 *   /api/identity/search  reads one public index, calls no model, and fires as
 *                         somebody types. Ninety a minute are allowed.
 *   /api/identity         reads up to three pages AND calls a model, and is
 *                         allowed eight in two minutes. So it fires ONLY when a
 *                         person has been picked — never on a keystroke.
 *
 * WHAT THIS CANNOT DO, said here because the screen has to say it too: the
 * accounts come from what Wikipedia and Wikidata record about a person. That is
 * good for a sitting MP and close to nil for a ward-level office holder, and no
 * amount of retrying changes it. A name that resolves to a person with no
 * recorded accounts is an ordinary result, not a failure — the paste box is
 * still there, and it says so rather than showing an empty list and stopping.
 *
 * Nothing here is added automatically, for the reason SuggestedAccounts states
 * at length: an account marked as yours is what the public-mood reading is
 * measured from, and an impersonator's account presented as "added" would be
 * the worst possible handling of the case this product exists to catch.
 */

interface PersonCandidate {
  name: string
  description: string | null
  url: string
  thumbnail: string | null
  person: boolean
}

/** An account a search index returned for the name — existence, not ownership. */
interface FoundAccount {
  platform: string
  handle: string
  name: string | null
  url: string
}

/** Long enough that "d" does not run a search, short enough for "K L". */
const MIN_QUERY = 3
/** A keystroke is not a search. Long enough to finish a word, short enough to feel live. */
const DEBOUNCE_MS = 280

export function FindByName({
  onAdd,
  isTracked,
}: {
  /** Add one account. The caller owns the tracker; this screen only chooses. */
  onAdd: (suggestion: AccountSuggestion, own: boolean) => void
  /**
   * Whether this account is already being watched, so the row can say so.
   * Takes only what identifies an account, because the YouTube search produces
   * candidates that are not full suggestions.
   */
  isTracked: (account: { platform: AccountSuggestion['platform']; handle: string }) => boolean
}) {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<PersonCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)

  const [picked, setPicked] = useState<PersonCandidate | null>(null)
  const [identity, setIdentity] = useState<Identity | null>(null)
  /** Accounts a search index returned, as against ones the record states. */
  const [found, setFound] = useState<FoundAccount[]>([])
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const searchAbort = useRef<AbortController | null>(null)

  /**
   * The typeahead.
   *
   * Aborting the previous request on every keystroke matters more than it
   * looks: without it the answers race, and a slow response to "aru" can land
   * after a fast one to "aruna maha" and replace the better list with a worse
   * one — the dropdown appears to fight the person typing.
   */
  useEffect(() => {
    const q = query.trim()
    // A pasted address belongs in the box beside this one, and searching an
    // index for a URL returns nothing anyway.
    if (q.length < MIN_QUERY || /^https?:\/\//i.test(q)) {
      searchAbort.current?.abort()
      setCandidates([])
      setSearching(false)
      return
    }

    const timer = setTimeout(() => {
      searchAbort.current?.abort()
      const ctl = new AbortController()
      searchAbort.current = ctl
      setSearching(true)
      fetch(`/api/identity/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => r.json() as Promise<{ candidates?: PersonCandidate[] }>)
        .then((body) => {
          if (ctl.signal.aborted) return
          setCandidates((body.candidates ?? []).filter((c) => c.person))
          setOpen(true)
        })
        .catch(() => {
          // A search that will not answer must not stop the screen: the paste
          // box needs no index at all.
        })
        .finally(() => {
          if (!ctl.signal.aborted) setSearching(false)
        })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query])

  /**
   * Resolve one person into their accounts. The expensive half, on purpose.
   *
   * Two sources, run together because they answer different halves of the
   * question and neither is enough alone:
   *
   *   /api/identity          what the public record STATES. Authoritative when
   *                          it has anything, and frequently it has nothing —
   *                          Wikidata carries a politician's handles only when
   *                          somebody added them.
   *   /api/accounts/search   what YouTube's own index RETURNS for the name.
   *                          Fills the commonest gap, and is the only platform
   *                          that will answer a search at all.
   *
   * A failure in either leaves the other standing: a person with a stated
   * Facebook page and no YouTube search result is still worth showing, and so
   * is the reverse.
   */
  const pick = useCallback(async (candidate: PersonCandidate) => {
    setPicked(candidate)
    setOpen(false)
    setIdentity(null)
    setFound([])
    setError(null)
    setResolving(true)

    const stated = fetch('/api/identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: candidate.name, url: candidate.url }),
    })
      .then((r) => r.json() as Promise<{ identity?: Identity | null; error?: string }>)
      .catch(() => ({ identity: null, error: 'Could not reach the server.' }))

    const searched = fetch(`/api/accounts/search?q=${encodeURIComponent(candidate.name)}`)
      .then((r) => r.json() as Promise<{ accounts?: FoundAccount[] }>)
      .then((b) => b.accounts ?? [])
      .catch(() => [] as FoundAccount[])

    const [a, b] = await Promise.all([stated, searched])
    setResolving(false)
    setFound(b)
    if (a.identity) setIdentity(a.identity)
    else if (b.length === 0) {
      setError(
        a.error ??
          'That page could not be read just now. Paste the profile address instead, or try again.',
      )
    }
  }, [])

  const clear = () => {
    setPicked(null)
    setIdentity(null)
    setFound([])
    setError(null)
    setQuery('')
    setCandidates([])
  }

  // 'theirs': this box looks up other people, so the source line must not say
  // "from your profile" about a rival's account.
  const suggestions = identity ? suggestionsFromIdentity(identity, 'theirs') : []

  /**
   * Search results worth offering: not already tracked, and not already stated
   * by the record above. A channel appearing in both groups would ask the same
   * question twice with two different confidence levels attached.
   */
  const untracked: AccountSuggestion[] = found
    .map((f) => ({
      platform: f.platform as AccountSuggestion['platform'],
      handle: f.handle,
      url: f.url,
      displayName: f.name,
      avatarUrl: null,
      source: 'listed by YouTube for this name',
      verified: false,
    }))
    .filter(
      (f) =>
        !isTracked(f) &&
        !suggestions.some(
          (s) => s.platform === f.platform && s.handle.toLowerCase() === f.handle.toLowerCase(),
        ),
    )

  return (
    <div>
      <label
        className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3"
        htmlFor="name-search"
      >
        Search by name
      </label>

      <div className="relative mt-2">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3">
          {searching || resolving ? (
            <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Search size={15} aria-hidden />
          )}
        </span>
        <input
          id="name-search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPicked(null)
            setIdentity(null)
            setError(null)
          }}
          onFocus={() => candidates.length > 0 && setOpen(true)}
          // Escape closes the list without clearing what was typed — the same
          // thing every other combobox on the web does.
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          placeholder="Type a person's name, such as “d k aruna mahabubnagar”"
          role="combobox"
          aria-expanded={open}
          aria-controls="name-results"
          aria-autocomplete="list"
          autoComplete="off"
          className="min-h-12 w-full rounded-full border border-[var(--border-strong)] bg-[var(--surface)] py-2 pl-11 pr-11 text-sm text-ink shadow-[var(--e1)] outline-none transition-colors hover:border-[var(--border-interactive)] focus:border-[var(--accent)] placeholder:text-ink-3"
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear the search"
            className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:bg-[var(--surface-2)] hover:text-ink"
          >
            <X size={14} aria-hidden />
          </button>
        )}

        {/* ── The suggestions ─────────────────────────────────────────────
            A listbox rather than a div of buttons, so a screen reader is told
            how many options there are and which one is focused. Floats as its
            own lifted card over whatever sits below. */}
        {open && candidates.length > 0 && (
          <ul
            id="name-results"
            role="listbox"
            aria-label="People matching that name"
            /* Capped against the small viewport, not just at 20rem: on a phone
               with the keyboard up, a 320px list ran past the bottom edge and
               its last options could never be scrolled into reach. */
            className="absolute z-20 mt-2 max-h-[min(20rem,55svh)] w-full overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-1.5 shadow-[var(--e3)]"
          >
            {candidates.map((c) => (
              <li key={c.url} role="option" aria-selected={picked?.url === c.url}>
                <button
                  type="button"
                  onClick={() => void pick(c)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
                >
                  <Avatar src={c.thumbnail} name={c.name} size={36} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{c.name}</span>
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

      {/* Said plainly rather than left as an empty dropdown. Wikipedia's
          coverage of sitting MLAs is partial and of ward-level office holders
          close to nil, so this is an ordinary Tuesday and the paste box is the
          answer to it. */}
      {query.trim().length >= MIN_QUERY &&
        !searching &&
        !picked &&
        candidates.length === 0 &&
        !/^https?:\/\//i.test(query.trim()) && (
          <p className="mt-2 text-xs leading-relaxed text-ink-3">
            Nobody by that name is in the public index. That is common below
            state level. Paste the profile address below instead.
          </p>
        )}

      {resolving && (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-2">
          <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
          Looking up {picked?.name}&rsquo;s accounts…
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--neg)]">
          {error}
        </p>
      )}

      {/* ── What was found ─────────────────────────────────────────────── */}
      {(identity || found.length > 0) && !resolving && (
        <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-3 sm:p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 text-sm font-bold text-ink">
              {identity?.name ?? picked?.name}
              {identity?.role && (
                <span className="ml-1.5 font-normal text-ink-3">{identity.role}</span>
              )}
            </p>
            <button
              type="button"
              onClick={clear}
              className="inline-flex min-h-11 shrink-0 items-center text-xs text-ink-3 underline decoration-dotted hover:text-ink"
            >
              clear
            </button>
          </div>

          {suggestions.length === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-ink-3">
              Nothing is recorded for {identity?.name ?? picked?.name} in the public sources this
              reads. That is common, and is not proof they have no accounts.
            </p>
          ) : (
            <>
            <p className="kicker mt-2">On the public record</p>
            <ul className="mt-1.5 space-y-2">
              {suggestions.map((s) => {
                const tracked = isTracked(s)
                return (
                  <li
                    key={`${s.platform}:${s.handle}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-2.5 shadow-[var(--e1)]"
                  >
                    {/* grow + a real basis: at 375px the handle kept the whole
                        line and the Mine/Competitor pair wraps below it, instead
                        of the handle truncating to a few letters. */}
                    <span className="flex min-w-0 grow basis-48 items-center gap-2.5">
                      <PlatformBadge platform={s.platform} size={32} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">
                          {s.handle}
                        </span>
                        <span className="block truncate text-xs text-ink-3">{s.source}</span>
                      </span>
                      {s.verified && (
                        <Chip tone="positive" icon={<ShieldCheck size={11} />}>
                          Verified
                        </Chip>
                      )}
                    </span>

                    {tracked ? (
                      <Chip tone="neutral">Already tracked</Chip>
                    ) : (
                      <span className="flex shrink-0 gap-1.5">
                        <Button size="sm" onClick={() => onAdd(s, true)}>
                          <Plus size={13} /> Mine
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onAdd(s, false)}>
                          <Plus size={13} /> Competitor
                        </Button>
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
            </>
          )}

          {/* ── What a search index returned ─────────────────────────────
              Kept in its own group with its own heading, because it is a
              weaker claim than the block above and must not be read as the
              same one. The record STATES those; YouTube merely LISTS these
              for the name, and a name search returns fan channels, news
              channels and impersonators alongside the real account. */}
          {untracked.length > 0 && (
            <>
              <p className="kicker mt-4">Channels YouTube lists for this name</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-3">
                These exist because YouTube returned them. Whether one is theirs is for you to check.
              </p>
              <ul className="mt-1.5 space-y-2">
                {untracked.map((f) => {
                  return (
                    <li
                      key={`${f.platform}:${f.handle}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-2.5 shadow-[var(--e1)]"
                    >
                      <span className="flex min-w-0 grow basis-48 items-center gap-2.5">
                        <PlatformBadge platform={f.platform} size={32} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-ink">
                            {f.displayName ?? f.handle}
                          </span>
                          <span className="block truncate text-xs text-ink-3">{f.handle}</span>
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex min-h-11 items-center px-1.5 text-xs font-medium text-[var(--accent)] hover:underline"
                        >
                          open
                        </a>
                        <Button size="sm" onClick={() => onAdd(f, true)}>
                          <Plus size={13} /> Mine
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onAdd(f, false)}>
                          <Plus size={13} /> Competitor
                        </Button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}

      <p className={cn('mt-3 text-xs leading-relaxed text-ink-3')}>
        The public record covers every platform but is filled in by volunteers, so it is often thin.
        The search covers YouTube only. Facebook, Instagram, X and LinkedIn answer no search from a
        server at all, so accounts there have to be pasted in below. Check a handle before adding
        it: an impersonator&rsquo;s account is exactly the thing worth noticing.
      </p>
    </div>
  )
}
