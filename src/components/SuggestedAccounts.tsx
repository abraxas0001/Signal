import { useMemo, useState } from 'react'
import { Check, ExternalLink, Plus, Search, TriangleAlert, Users } from 'lucide-react'
import type { Platform } from '@shared/taxonomy'
import type { Identity } from '@shared/identity'
import { parseHandleUrl } from '@shared/handle-url'
import { handleId, listHandles, saveHandle, type TrackedHandle } from '@/lib/handles'
import { Button, Card, Chip } from './ui'
import { PlatformBadge } from '@/components/kit'
import { cn } from '@/lib/utils'

/**
 * The accounts we already know are this person's, offered in one tap.
 *
 * An office that has just told the app who they are should not then have to
 * find, copy and paste their own YouTube channel address. Where the identity
 * lookup produced accounts — Wikidata records them as typed identifiers, and
 * profile pages link to them — they are staged here, marked as this person's,
 * and added with one press.
 *
 * The important word is "staged". They are NOT added automatically. Two
 * reasons, and the second is the real one:
 *
 * An account marked `own` is what "what people are saying" measures the public
 * mood from. Getting that wrong does not produce an error — it produces a
 * confident reading of the wrong person's comment section, which is exactly the
 * failure this desk already shipped once. A named suggestion somebody pressed
 * is a decision with a person behind it; a silent auto-add is a guess wearing a
 * decision's clothes.
 *
 * And an impersonator's account is precisely the thing a public figure most
 * needs to notice. Presenting one as "your account, added" would be the worst
 * possible handling of the case this product exists to catch.
 */

/** What a suggestion needs to be worth showing. */
export interface AccountSuggestion {
  platform: Platform
  handle: string
  url: string
  displayName: string | null
  avatarUrl: string | null
  /** Where the suggestion came from, shown to the reader. */
  source: string
  /** True when a platform states the account is verified. Never inferred. */
  verified: boolean
}

/**
 * Map an identity's handles onto the platform vocabulary the tracker uses.
 *
 * `parseHandleUrl` is the authority on which platform an address belongs to —
 * the same function the manual add box uses — so a suggestion and a pasted link
 * cannot disagree about where an account lives, and cannot produce two entries
 * for one account.
 */
export function suggestionsFromIdentity(
  identity: Identity | null,
  /**
   * Whose identity this is. It only changes one word, and that word is a
   * claim: this function is now also used to look up OTHER people by name, and
   * labelling a rival's Instagram account "from your profile" tells the reader
   * the office owns an account it does not.
   */
  whose: 'yours' | 'theirs' = 'yours',
): AccountSuggestion[] {
  if (!identity) return []

  const out: AccountSuggestion[] = []
  const seen = new Set<string>()

  for (const handle of identity.handles) {
    const ref = parseHandleUrl(handle.url)
    if (!ref) continue

    // Bare, always. Some sources hand back "@name" and the card prefixes its
    // own @, so the reader met "@@narendramodi" — and worse, the @-carrying id
    // never matched the tracked list's bare one, so an account the desk
    // already followed was offered again as a fresh discovery.
    const bare = ref.handle.replace(/^@+/, '')

    const id = handleId(ref.platform, bare)
    if (seen.has(id)) continue
    seen.add(id)

    out.push({
      platform: ref.platform,
      handle: bare,
      url: handle.url,
      displayName: identity.name,
      avatarUrl: null,
      source: handle.connected
        ? 'connected account'
        : whose === 'yours'
          ? 'from your profile'
          : 'from the public record',
      verified: handle.verified,
    })
  }

  return out
}

export function SuggestedAccounts({
  identity,
  onAdded,
}: {
  identity: Identity | null
  /** Handed the new list so the caller can re-read without a round trip. */
  /**
   * The whole tracked list, and the handles this component just created.
   *
   * The second argument is the point. Adding an account here saved it with an
   * empty `snapshots` array and told the host to re-render — and nothing read
   * it. Every other way of adding an account on the dashboard reads the new
   * handle straight away; this one, the one a desk uses on its first visit,
   * did not, so a brand-new desk opened on a row of "NA · Not read yet" that
   * no amount of waiting would fill.
   */
  onAdded: (handles: TrackedHandle[], created: TrackedHandle[]) => void
}) {
  const suggestions = useMemo(() => suggestionsFromIdentity(identity), [identity])
  const [added, setAdded] = useState<Set<string>>(new Set())

  // Anything already tracked is not a suggestion. Offering an account somebody
  // added last week as though it were new is how a list stops being read.
  const existing = useMemo(() => new Set(listHandles().map((h) => h.id)), [])

  const pending = suggestions.filter((s) => !existing.has(handleId(s.platform, s.handle)))

  if (!identity) return null

  const addOne = (suggestion: AccountSuggestion): TrackedHandle | null => {
    const id = handleId(suggestion.platform, suggestion.handle)
    const created: TrackedHandle = {
      id,
      platform: suggestion.platform,
      handle: suggestion.handle,
      displayName: suggestion.displayName,
      profileUrl: suggestion.url,
      avatarUrl: suggestion.avatarUrl,
      // The whole point: these are the office's own accounts, and `own` is what
      // decides whose comment section the public mood is read from.
      own: true,
      label: null,
      listingNote: '',
      snapshots: [],
    }
    const next = saveHandle(created)
    setAdded((prev) => new Set(prev).add(id))
    onAdded(next, [created])
    return created
  }

  /**
   * One notification for the whole batch, not one per account.
   *
   * Calling `addOne` in a loop would fire a read per suggestion, and the read
   * endpoint takes six at a time — so the batch is collected and handed over
   * once, which is both fewer requests and the only version where the spinner
   * means anything.
   */
  const addAll = (): void => {
    const created: TrackedHandle[] = []
    let next: TrackedHandle[] = []
    const ids = new Set(added)
    for (const suggestion of pending) {
      const id = handleId(suggestion.platform, suggestion.handle)
      if (ids.has(id)) continue
      ids.add(id)
      const made: TrackedHandle = {
        id,
        platform: suggestion.platform,
        handle: suggestion.handle,
        displayName: suggestion.displayName,
        profileUrl: suggestion.url,
        avatarUrl: suggestion.avatarUrl,
        own: true,
        label: null,
        listingNote: '',
        snapshots: [],
      }
      next = saveHandle(made)
      created.push(made)
    }
    if (!created.length) return
    setAdded(ids)
    onAdded(next, created)
  }

  /* ── nothing found ─────────────────────────────────────────────────────── */

  if (pending.length === 0 && suggestions.length === 0) {
    return (
      <Card>
        <div className="flex items-start gap-3.5">
          <span
            className="icon-badge"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <Search size={18} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold">No accounts were found for {identity.name}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
              Paste the addresses below and mark them as yours.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  if (pending.length === 0) {
    return (
      <Card>
        <div className="flex items-center gap-3.5">
          <span
            className="icon-badge"
            style={{ background: 'var(--pos-soft)', color: 'var(--pos)' }}
          >
            <Check size={18} aria-hidden />
          </span>
          <p className="text-sm leading-relaxed text-ink-2">
            Every account we know about for {identity.name} is already being tracked.
          </p>
        </div>
      </Card>
    )
  }

  /* ── suggestions ───────────────────────────────────────────────────────── */

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="icon-badge shrink-0"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <Users size={18} aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold">
              {/* The full name. Taking the first word made initialled Indian
                  names into "accounts we believe D. owns". */}
              {pending.length} {pending.length === 1 ? 'account' : 'accounts'} we believe{' '}
              {identity.name} owns
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
              Check each one before adding it.
            </p>
          </div>
        </div>
        {pending.length > 1 && (
          <Button size="sm" variant="outline" onClick={addAll}>
            <Plus size={15} />
            Add all {pending.length}
          </Button>
        )}
      </div>

      <ul className="space-y-2">
        {pending.map((suggestion) => {
          const id = handleId(suggestion.platform, suggestion.handle)
          const isAdded = added.has(id)

          return (
            <li key={id}>
              <Card
                className={cn(
                  'flex flex-wrap items-center gap-3',
                  isAdded && 'border-[color-mix(in_oklab,var(--pos)_35%,var(--rule))]',
                )}
              >
                <PlatformBadge platform={suggestion.platform} size={38} />

                {/* grow + a real basis: at 375px the handle keeps its line and
                    the action pill wraps below it, instead of the handle being
                    crushed against the button. */}
                <div className="min-w-0 grow basis-48">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold">{suggestion.platform}</span>
                    <span className="truncate text-sm text-ink-2">@{suggestion.handle}</span>
                    {suggestion.verified && <Chip tone="positive">verified</Chip>}
                  </div>
                  {/* A real tap target: this link is the "open it first" check
                      the warning below asks for, and it was 16px tall. */}
                  <a
                    href={suggestion.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex min-h-11 items-center gap-1 text-xs text-ink-3 hover:text-ink-2"
                  >
                    {suggestion.source} · open
                    <ExternalLink size={11} aria-hidden />
                  </a>
                </div>

                {isAdded ? (
                  <span className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-[color-mix(in_oklab,var(--pos)_35%,transparent)] bg-[var(--pos-soft)] px-4 text-sm font-semibold text-[var(--pos)]">
                    <Check size={15} aria-hidden />
                    Added as yours
                  </span>
                ) : (
                  <Button size="sm" className="ml-auto shrink-0" onClick={() => addOne(suggestion)}>
                    <Plus size={15} />
                    This is mine
                  </Button>
                )}
              </Card>
            </li>
          )
        })}
      </ul>

      {/* The impersonation case, said out loud. A public figure's own product
          must not be the thing that hands them an impostor's account labelled
          as theirs. Restyled as a quiet row, never removed. */}
      <p className="mt-3 flex items-start gap-2.5 rounded-2xl bg-[var(--surface-2)] px-3.5 py-3 text-xs leading-relaxed text-ink-3">
        <TriangleAlert size={14} className="mt-0.5 shrink-0 text-[var(--warn)]" aria-hidden />
        <span>
          These come from public records, which anybody can edit. If one of them is not actually
          yours, do not add it. Open it first. An account impersonating you belongs on the
          Influencer watch, not here.
        </span>
      </p>
    </div>
  )
}
