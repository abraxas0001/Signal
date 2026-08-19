import { useMemo, useState } from 'react'
import { Check, ExternalLink, Plus, Search, TriangleAlert } from 'lucide-react'
import type { Platform } from '@shared/taxonomy'
import type { Identity } from '@shared/identity'
import { parseHandleUrl } from '@shared/handle-url'
import { handleId, listHandles, saveHandle, type TrackedHandle } from '@/lib/handles'
import { Avatar, Button, Card, Chip } from './ui'
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
export function suggestionsFromIdentity(identity: Identity | null): AccountSuggestion[] {
  if (!identity) return []

  const out: AccountSuggestion[] = []
  const seen = new Set<string>()

  for (const handle of identity.handles) {
    const ref = parseHandleUrl(handle.url)
    if (!ref) continue

    const id = handleId(ref.platform, ref.handle)
    if (seen.has(id)) continue
    seen.add(id)

    out.push({
      platform: ref.platform,
      handle: ref.handle,
      url: handle.url,
      displayName: identity.name,
      avatarUrl: null,
      source: handle.connected ? 'connected account' : 'from your profile',
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
  onAdded: (handles: TrackedHandle[]) => void
}) {
  const suggestions = useMemo(() => suggestionsFromIdentity(identity), [identity])
  const [added, setAdded] = useState<Set<string>>(new Set())

  // Anything already tracked is not a suggestion. Offering an account somebody
  // added last week as though it were new is how a list stops being read.
  const existing = useMemo(() => new Set(listHandles().map((h) => h.id)), [])

  const pending = suggestions.filter((s) => !existing.has(handleId(s.platform, s.handle)))

  if (!identity) return null

  const addOne = (suggestion: AccountSuggestion): void => {
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
    onAdded(next)
  }

  const addAll = (): void => {
    for (const suggestion of pending) {
      if (!added.has(handleId(suggestion.platform, suggestion.handle))) addOne(suggestion)
    }
  }

  /* ── nothing found ─────────────────────────────────────────────────────── */

  if (pending.length === 0 && suggestions.length === 0) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <Search size={17} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold">No accounts were found for {identity.name}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
              Public records carry a politician&rsquo;s social accounts only when somebody has
              added them, and for most sitting members nobody has. Paste the addresses below and
              mark them as yours — that is what lets this desk read the comments under your own
              posts.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-3">
              Facebook and Instagram return nothing at all to a stranger, so those two only ever
              produce comments once the office connects them on the Settings screen.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  if (pending.length === 0) {
    return (
      <Card>
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <Check size={16} className="shrink-0 text-[var(--pos)]" aria-hidden />
          Every account we know about for {identity.name} is already being tracked.
        </p>
      </Card>
    )
  }

  /* ── suggestions ───────────────────────────────────────────────────────── */

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">
            {pending.length} {pending.length === 1 ? 'account' : 'accounts'} we believe{' '}
            {identity.name.split(/\s+/)[0]} owns
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
            Check each one before adding it. Marking an account as yours is what decides whose
            comments the public mood is read from.
          </p>
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
                <Avatar src={suggestion.avatarUrl} name={suggestion.displayName ?? suggestion.handle} size={38} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{suggestion.platform}</span>
                    <span className="truncate text-sm text-ink-2">@{suggestion.handle}</span>
                    {suggestion.verified && <Chip tone="positive">verified</Chip>}
                  </div>
                  <a
                    href={suggestion.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink-2"
                  >
                    {suggestion.source} · open
                    <ExternalLink size={11} aria-hidden />
                  </a>
                </div>

                {isAdded ? (
                  <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[--radius-md] border border-[color-mix(in_oklab,var(--pos)_35%,transparent)] bg-[var(--pos-soft)] px-3.5 text-sm font-medium text-[var(--pos)]">
                    <Check size={15} aria-hidden />
                    Added as yours
                  </span>
                ) : (
                  <Button size="sm" className="shrink-0" onClick={() => addOne(suggestion)}>
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
          as theirs. */}
      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-3">
        <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          These come from public records, which anybody can edit. If one of them is not actually
          yours, do not add it — open it first. An account impersonating you belongs on the
          Influencer watch, not here.
        </span>
      </p>
    </div>
  )
}
