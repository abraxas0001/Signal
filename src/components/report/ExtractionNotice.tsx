import { CircleAlert, Info, PencilLine } from 'lucide-react'
import type { PostSnapshot } from '@shared/types'
import { Card, Chip } from '../ui'
import { cn } from '@/lib/utils'

/**
 * States plainly what we could and could not read.
 *
 * This is the component that stops the product ever looking broken. Facebook
 * withholds engagement counts from about half of post types; if the tiles just
 * showed dashes with no explanation, the whole report would read as failed.
 * Saying "Facebook does not expose shares to anyone but the page owner" turns
 * a defect into a fact about the platform.
 */
export function ExtractionNotice({
  snapshot,
  onEditMetric,
}: {
  snapshot: PostSnapshot
  onEditMetric?: () => void
}) {
  const { extraction, engagement } = snapshot

  /**
   * Partition by SOURCE, not by whether a value is present.
   *
   * Sorting on `value == null` alone produced the one sentence this component
   * exists to prevent: a user who filled in all four counts by hand was told
   * "Every number here came straight from the platform."
   */
  const metrics = [
    ['likes', engagement.likes],
    ['comments', engagement.comments],
    ['shares', engagement.shares],
    ['views', engagement.views],
  ] as const

  const missing = metrics.filter(([, v]) => v.value == null).map(([k]) => k)
  const userEntered = metrics
    .filter(([, v]) => v.value != null && (v.source === 'user-supplied' || v.source === 'vision'))
    .map(([k]) => k)
  const measured = metrics.filter(
    ([, v]) =>
      v.value != null &&
      (v.source === 'platform-api' || v.source === 'public-endpoint' || v.source === 'page-scrape'),
  )

  const textIsUsers = extraction.userAssisted && missing.length === 0 && measured.length === 0

  const perfect = missing.length === 0 && userEntered.length === 0 && extraction.confidence === 'high'
  // Nothing to apologise for and nothing to explain.
  if (perfect && !extraction.userAssisted) return null

  return (
    // A quiet card on purpose: this note explains the data, and must never
    // shout louder than the data itself. Only a mostly-withheld read (three
    // or more missing figures) earns the warm border.
    <Card level="quiet" className={cn(missing.length >= 3 && 'border border-[var(--warn)]/30')}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
            missing.length >= 3 ? 'bg-[var(--warn-soft)]' : 'bg-[var(--surface-2)]',
          )}
        >
          {missing.length >= 3 ? (
            <CircleAlert size={16} className="text-[var(--warn)]" />
          ) : (
            <Info size={15} className="text-ink-3" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {headline(missing, userEntered, textIsUsers)}
          </p>
          {explanation(snapshot, missing, userEntered) && (
            <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
              {explanation(snapshot, missing, userEntered)}
            </p>
          )}

          {extraction.userAssisted && (
            <Chip tone="accent" icon={<PencilLine size={11} />} className="mt-2">
              Includes details you added
            </Chip>
          )}

          {missing.length > 0 && onEditMetric && (
            <button
              onClick={onEditMetric}
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-[var(--accent)]"
            >
              <PencilLine size={13} />
              Add the numbers yourself
            </button>
          )}

        </div>
      </div>
    </Card>
  )
}

function headline(missing: string[], userEntered: string[], textIsUsers: boolean): string {
  if (textIsUsers) return 'Analysed from what you supplied'
  if (userEntered.length && missing.length === 0) return 'Read the post, using your numbers'
  if (userEntered.length) return 'Read the post, partly from your numbers'
  if (missing.length === 0) return 'Read the post in full'
  if (missing.length >= 4) return 'Read the post, but no engagement numbers'
  return `Read the post, but not ${listOut(missing)}`
}

/**
 * Platform-specific truth. Generic "some data unavailable" copy is what makes
 * a tool feel unfinished; naming the actual constraint makes it feel informed.
 *
 * User-entered figures are called out first and never described as coming from
 * the platform — conflating the two would quietly undo the provenance marks on
 * every tile.
 */
function explanation(snapshot: PostSnapshot, missing: string[], userEntered: string[]): string {
  const p = snapshot.platform

  if (userEntered.length) {
    const yours = `The ${listOut(userEntered)} ${userEntered.length === 1 ? 'figure is' : 'figures are'} the ${userEntered.length === 1 ? 'one' : 'ones'} you entered, not measured by us.`
    return missing.length
      ? `${yours} ${p} still withheld the rest.`
      : `${yours} Everything else came from ${p}.`
  }

  if (missing.length === 0) {
    return ''
  }

  switch (p) {
    case 'Facebook':
      return missing.length >= 4
        ? 'Facebook served us its logged-out page, which carries no engagement bar. The post text and author came through fine.'
        : missing.includes('shares')
          ? 'Facebook publishes no share count on reels, not to us and not in its own interface.'
          : 'Facebook reports reactions rather than likes, and only video posts carry a view count. Text posts have none to give.'
    case 'Instagram':
      return 'Instagram publishes likes and comments on public posts but not shares or views. Follower counts are available for most accounts, not all.'
    case 'YouTube':
      return 'YouTube does not publish share counts for any video.'
    case 'Twitter/X':
      return 'X only reports view counts on posts from 2023 onward. Older posts genuinely have no view figure to show.'
    case 'TikTok':
      return 'TikTok rounds every count above ten thousand before publishing it, so large figures here are the platform’s own approximations. It reports no share-of-voice or reach beyond the play count.'
    case 'Threads':
      return 'Threads shows impression counts to nobody, including the author, so there is no view figure to withhold.'
    case 'Reddit':
      return 'Reddit publishes a post’s score and comment count to embeds, but the body text, subscriber counts and view counts need a logged-in read. The score is upvotes minus downvotes, not a like count.'
    case 'Pinterest':
      return 'Pinterest counts saves and repins rather than likes. Reactions are a newer, far less-used control, so a small number beside a large save count is real. It publishes no view count.'
    case 'Snapchat':
      return 'Snapchat Spotlight reports views and comments but no likes, and its share count is not populated for organic snaps.'
    case 'Telegram':
      return 'Telegram channels report view counts but no reactions or comments.'
    case 'LinkedIn':
      return 'LinkedIn publishes reactions and comments on public posts, but not shares or views.'
    case 'Bluesky':
      return 'Bluesky has no view counter at all: not for us, and not for the account owner either.'
    case 'Mastodon':
      return 'Mastodon deliberately does not count impressions; no instance has that number.'
    case 'News Site':
    case 'Blog':
      return 'Articles do not carry social engagement numbers. This is the published piece itself.'
    default:
      return 'This platform does not publish those numbers to anyone but the account owner.'
  }
}

function listOut(items: string[]): string {
  if (items.length === 1) return items[0]!
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}
