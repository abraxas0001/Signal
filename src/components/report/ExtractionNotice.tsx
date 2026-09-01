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
          {/* The per-platform paragraph that used to sit here explained what
              each company does and does not publish. The headline above
              already names what is missing, which is the part an office acts
              on; the rest was a lecture on somebody else's product. Only the
              provenance line survives, because "these figures are yours, not
              the platform's" is a fact about the data rather than an excuse
              for it. */}
          {userEntered.length > 0 && (
            <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
              {listOut(userEntered)} {userEntered.length === 1 ? 'is' : 'are'} the figure
              {userEntered.length === 1 ? '' : 's'} you supplied, not the platform&rsquo;s.
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

function listOut(items: string[]): string {
  if (items.length === 1) return items[0]!
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}
