import { useCallback, useState } from 'react'
import { AtSign, Loader2, Plus, Search } from 'lucide-react'
import type { Platform } from '@shared/taxonomy'
import { parseHandleUrl } from '@shared/handle-url'
import type { Influencer } from '@shared/grievance'
import { Button, Chip, selectClass } from './ui'
import { CardHead, PlatformBadge } from '@/components/kit'
import { cn, full } from '@/lib/utils'

/**
 * Watch a specific channel, page or creator, by hand.
 *
 * The roster could only be filled by "Suggest", which searches YouTube. That is
 * the right default — it is evidence-first, and it is the only platform that
 * answers a keyless search from a server — but it left the office unable to say
 * "watch THIS one", which is most of what an office actually wants: the two
 * district channels everyone shares, the Instagram page that runs the memes,
 * the rival's Facebook page.
 *
 * The account is READ before it is stored, and what came back is shown before
 * anything is added. That is deliberate on two counts. A handle that does not
 * resolve is a typo or an invented name, and filing it would put a row on the
 * roster that can never produce a mention and never explain why. And the
 * per-platform truth differs enormously — a YouTube channel will be scanned
 * every morning, a Facebook page will contribute a follower count and nothing
 * else until a data provider is configured — so the screen says which of those
 * is being signed up for, before the press, rather than leaving the office to
 * infer it from an empty list a week later.
 */

interface Resolved {
  platform: Platform
  handle: string
  displayName: string | null
  profileUrl: string
  followers: number | null
  posts: number
  /** The reader's own words on whether posts can be listed, and why not. */
  note: string
  available: boolean
}

/**
 * Did the platform acknowledge this account at all?
 *
 * Distinct from "its posts cannot be listed", and confusing the two is a real
 * failure: a mistyped handle came back with no followers and no posts, and was
 * reported as though Facebook's post-listing rules were the reason. The office
 * would have filed a row for an account that does not exist, and then waited
 * for mentions that could never arrive.
 *
 * A gated account still yields SOMETHING — Facebook and Instagram both publish
 * a follower count. Nothing at all means nothing was found.
 */
const resolved = (r: Resolved): boolean => r.followers != null || r.posts > 0

/** What a check can actually do per platform, said before the account is added. */
function outlook(platform: Platform, available: boolean): { tone: 'positive' | 'warning'; line: string } {
  if (available) {
    return {
      tone: 'positive',
      line: 'Posts can be listed, so this account is scanned on every check.',
    }
  }
  return {
    tone: 'warning',
    line:
      `${platform} does not publish this account's posts to a server, so a check cannot read them. ` +
      'Its reach is still tracked, and posts you analyse by hand still count. ' +
      'A licensed data provider turns the automatic reading on. See Settings.',
  }
}

/** One channel YouTube's own index returned, read before it is offered. */
interface Candidate {
  platform: Platform
  handle: string
  name: string | null
  url: string
  followers: number | null
  posts: number
  verified: boolean
}

const influencerIdOf = (platform: string, handle: string): string =>
  `inf-${`${platform}-${handle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)}`

/** The pill input every box in this flow wears — one voice, not three. */
const pillInput =
  'min-h-11 min-w-0 flex-1 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] ' +
  'px-4 text-sm shadow-[var(--e1)] outline-none transition-colors focus:border-[var(--accent)]'

/**
 * Find channels by subject, and read each one before offering it.
 *
 * The alternative — asking a model for a list of political channels, or pasting
 * one compiled from a web search — is the failure this whole module is built
 * against, and it is not hypothetical. Five channel names taken from a search
 * and checked here: one did not exist, and one came back with sixty-seven
 * subscribers under the name of a broadcaster that has millions. Both would
 * have gone onto the roster looking exactly like the three real ones.
 *
 * So the query goes to YouTube's own index, every channel that comes back
 * exists by construction, and each is then read for its subscriber count. The
 * count is the disclosure: it is what separates NTV Telugu at 9.9 million from
 * a lookalike at two, and the screen shows it rather than deciding for the
 * office — because whether a channel IS who it claims to be is a judgement
 * only a person can make.
 *
 * YouTube only, because YouTube alone answers a search from a server. Instagram
 * and Facebook have to be named by hand in the box above; that is a fact about
 * those platforms, and it is stated rather than worked around.
 */
export function SearchInfluencers({
  constituency,
  suggestedQuery,
  isTracked,
  onAdd,
}: {
  constituency: string | null
  /** Seeded from the desk's own seat, so the first search is already useful. */
  suggestedQuery: string
  isTracked: (platform: Platform, handle: string) => boolean
  onAdd: (influencer: Influencer) => void
}) {
  const [query, setQuery] = useState(suggestedQuery)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Candidate[] | null>(null)

  const search = useCallback(async () => {
    const q = query.trim()
    if (q.length < 3) return
    setBusy(true)
    setError(null)
    setResults(null)
    try {
      const res = await fetch(`/api/accounts/search?q=${encodeURIComponent(q)}&verify=1`)
      const body = (await res.json()) as { accounts?: Candidate[]; error?: string }
      if (body.error) {
        setError(body.error)
        return
      }
      setResults(body.accounts ?? [])
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }, [query])

  return (
    <div>
      <CardHead
        icon={<Search size={16} />}
        title="Find channels by subject"
        sub="Every channel is read before it is offered"
        tint="blue"
      />
      <p className="text-xs leading-relaxed text-ink-2">
        Searches YouTube&rsquo;s own index, so every channel below exists. Each one is then read
        for its subscriber count. <strong className="font-semibold">Check that count before you
        add one</strong>: a lookalike with the right name and two subscribers is the thing worth
        noticing.
      </p>

      {/* Stacked on a phone: side by side, the button left the input ~170px —
          too short to read back what was typed. */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void search()
            }
          }}
          placeholder="Telangana politics · Mahabubnagar news"
          aria-label="Search YouTube for channels on a subject"
          className={pillInput}
        />
        <Button size="sm" variant="outline" onClick={() => void search()} disabled={query.trim().length < 3 || busy}>
          {busy ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" /> : <Search size={14} />}
          {busy ? 'Reading each one…' : 'Search'}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--neg)]">
          {error}
        </p>
      )}

      {results?.length === 0 && !busy && (
        <p className="mt-2 text-xs leading-relaxed text-ink-3">
          YouTube returned no channels for that. Try the district name, or a subject the channels
          themselves would use.
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="mt-3 space-y-2">
          {results.map((c) => {
            const already = isTracked(c.platform, c.handle)
            // Not a verdict on who they are — only on how much reach they have,
            // which is the fact an office needs in order to make that call.
            const tiny = c.verified && (c.followers ?? 0) < 1000
            return (
              <li
                key={c.handle}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-2)] p-3 shadow-[var(--e1)] transition-colors hover:border-[var(--border-strong)]"
              >
                {/* The identity block refuses to shrink below ~12rem, so on a
                    375px screen the actions wrap under it instead of crushing
                    the name and the subscriber count into a sliver. */}
                <span className="flex min-w-[12rem] flex-1 items-center gap-3">
                  <PlatformBadge platform={c.platform} size={32} />
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-ink">{c.name ?? c.handle}</span>
                      {tiny && (
                        <Chip tone="warning" title="Very small for a news channel. Check it is the real one">
                          tiny
                        </Chip>
                      )}
                    </span>
                    {/* Two lines, not one. On a 360px screen a single line put
                        the handle first and truncated the subscriber count —
                        cutting off the one number this whole screen exists to
                        show. The handle is what may be clipped; the count is
                        never allowed to be. */}
                    <span className="block truncate text-xs text-ink-3">{c.handle}</span>
                    <span className="tnum block text-xs font-medium text-ink-2">
                      {c.followers != null ? `${full(c.followers)} subscribers` : 'no subscriber count'}
                      {c.posts > 0 ? ` · ${c.posts} recent uploads` : ''}
                    </span>
                  </span>
                </span>

                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-[var(--accent)] hover:underline"
                  >
                    open
                  </a>
                  {already ? (
                    <Chip tone="neutral">Watching</Chip>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onAdd({
                          id: influencerIdOf(c.platform, c.handle),
                          platform: c.platform,
                          handle: c.handle,
                          displayName: c.name,
                          url: c.url,
                          constituency,
                          followers: c.followers,
                          addedAt: new Date().toISOString(),
                          note: `Found by searching “${query.trim()}”.`,
                        })
                      }
                    >
                      <Plus size={13} />
                      Watch
                    </Button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function AddInfluencer({
  constituency,
  isTracked,
  onAdd,
}: {
  /** Filed against the desk's seat, the same as a discovered account. */
  constituency: string | null
  isTracked: (platform: Platform, handle: string) => boolean
  onAdd: (influencer: Influencer) => void
}) {
  const [input, setInput] = useState('')
  const [platform, setPlatform] = useState<Platform>('YouTube')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<Resolved | null>(null)

  const look = useCallback(async () => {
    const q = input.trim()
    if (!q) return

    // The URL states its own platform and is the authority; the picker only
    // decides when somebody typed a bare handle. Same rule as the account
    // tracker, so one person added twice cannot end up on two platforms.
    const ref = parseHandleUrl(q, platform)
    if (!ref) {
      setError('That does not look like a profile link. Paste the address of the page, or pick a platform and type just the handle.')
      return
    }

    setBusy(true)
    setError(null)
    setFound(null)
    try {
      const res = await fetch(
        `/api/handle?q=${encodeURIComponent(q)}&platform=${encodeURIComponent(ref.platform)}`,
      )
      const body = (await res.json()) as {
        handles?: Array<Record<string, unknown> & { error?: string }>
      }
      const first = body.handles?.[0]
      if (!first || first.error) {
        setError(String(first?.error ?? 'That account could not be read just now.'))
        return
      }
      const listing = (first['listing'] ?? {}) as { note?: string; available?: boolean }
      setFound({
        platform: (first['platform'] as Platform) ?? ref.platform,
        handle: String(first['handle'] ?? ref.handle),
        displayName: (first['displayName'] as string | null) ?? null,
        profileUrl: String(first['profileUrl'] ?? q),
        followers: typeof first['followers'] === 'number' ? first['followers'] : null,
        posts: Array.isArray(first['posts']) ? first['posts'].length : 0,
        note: listing.note ?? '',
        available: listing.available === true,
      })
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }, [input, platform])

  const commit = () => {
    if (!found) return
    onAdd({
      // The same derivation discovery uses, so adding an account by hand that
      // Suggest later finds produces one row, not two.
      id: `inf-${`${found.platform}-${found.handle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)}`,
      platform: found.platform,
      handle: found.handle,
      displayName: found.displayName,
      url: found.profileUrl,
      constituency,
      followers: found.followers,
      addedAt: new Date().toISOString(),
      note: 'Added by hand.',
    })
    setFound(null)
    setInput('')
  }

  const already = found ? isTracked(found.platform, found.handle) : false
  const view = found && resolved(found) ? outlook(found.platform, found.available) : null

  return (
    <div>
      <CardHead
        icon={<AtSign size={16} />}
        title="Watch a particular account"
        sub="Read live before anything is stored"
        tint="violet"
      />
      <p className="text-xs leading-relaxed text-ink-2">
        Paste a channel, page or profile link: a YouTube channel, an Instagram page, a Facebook
        creator. Suggest only searches YouTube, because it is the one platform that answers a
        search from a server; everything else has to be named.
      </p>

      {/* Phone: the link box takes the full first line, the platform picker
          and button share the second. Three controls on one 375px line gave
          the input ~100px. */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void look()
            }
          }}
          placeholder="youtube.com/@channel · instagram.com/page · facebook.com/page"
          aria-label="Profile link or handle of an account to watch"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className={pillInput}
        />
        <div className="flex gap-2">
          <select
            aria-label="Platform, used when you type a bare handle"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
            className={cn(selectClass, 'grow sm:grow-0')}
          >
            {(['YouTube','Instagram','Facebook','Twitter/X','LinkedIn','Bluesky','Mastodon'] as Platform[]).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => void look()} disabled={!input.trim() || busy}>
            {busy ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" /> : <Search size={14} />}
            {busy ? 'Reading…' : 'Look it up'}
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--neg)]">
          {error}
        </p>
      )}

      {/* What was actually read, before anything is filed. */}
      {found && (
        <div className="mt-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-[var(--e1)]">
          <div className="flex min-w-0 items-center gap-3">
            <PlatformBadge platform={found.platform} size={36} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-ink">
                {found.displayName ?? found.handle}
              </span>
              <span className="tnum block text-xs text-ink-3">
                {found.followers != null ? `${full(found.followers)} followers` : 'no follower count published'}
              </span>
            </span>
          </div>

          {view && (
            <p
              className={cn(
                'mt-3 rounded-[var(--radius-sm)] px-3 py-2 text-xs leading-relaxed',
                view.tone === 'positive'
                  ? 'bg-[var(--pos-soft)] text-[var(--pos)]'
                  : 'bg-[var(--warn-soft)] text-[var(--warn)]',
              )}
            >
              {view.line}
            </p>
          )}
          {found.note && <p className="mt-2 text-xs leading-relaxed text-ink-3">{found.note}</p>}

          <div className="mt-3">
            {!resolved(found) ? (
              /* Nothing came back at all, so there is nothing to watch. No add
                 button: filing this would put a row on the roster that can
                 never produce a mention and never explain why. */
              <Chip tone="negative">Not found. Check the handle</Chip>
            ) : already ? (
              <Chip tone="neutral">Already on the roster</Chip>
            ) : (
              <Button size="sm" onClick={commit}>
                <Plus size={14} />
                Watch this account
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
