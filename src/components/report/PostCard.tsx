import { useState } from 'react'
import * as m from 'motion/react-m'
import { AnimatePresence } from 'motion/react'
import {
  BadgeCheck,
  ChevronDown,
  ExternalLink,
  Languages,
  MapPin,
  Play,
  Users,
} from 'lucide-react'
import type { PostSnapshot } from '@shared/types'
import { Avatar, Card } from '../ui'
import { PlatformBadge } from '@/components/kit'
import { absoluteDate, cn, compact, hostOf, relativeTime } from '@/lib/utils'
import { spring } from '@/lib/motion'

/**
 * The post exactly as it was found, before any interpretation.
 *
 * Media-forward, like every card in the reference shots: the image leads when
 * there is one, with the platform's circle badge riding its corner, and the
 * author row sits beneath. Original script is always shown first and at full
 * size; the English translation sits beneath it as a secondary read. That
 * ordering matters for this audience — staff read the Telugu, but the report
 * travels in English, and the sheet's own rules require allegations be
 * preserved verbatim.
 */
export function PostCard({ snapshot }: { snapshot: PostSnapshot }) {
  const [expanded, setExpanded] = useState(false)
  const [showTranslation, setShowTranslation] = useState(true)

  const { author, content, media, platform } = snapshot
  const text = content.text ?? ''
  const isLong = text.length > 320
  const shown = expanded || !isLong ? text : `${text.slice(0, 320).trimEnd()}…`
  const hasMedia = Boolean(media[0]?.thumbnailUrl)

  return (
    <Card padded={false} className="overflow-hidden">
      {/* Media */}
      {media[0]?.thumbnailUrl && (
        <a
          href={snapshot.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative block aspect-video overflow-hidden bg-[var(--surface-3)]"
        >
          <img
            src={media[0].thumbnailUrl}
            alt={media[0].alt ?? 'Post media'}
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            onError={(e) => {
              // Thumbnails from social CDNs expire; hide rather than show a
              // broken-image glyph.
              e.currentTarget.parentElement?.style.setProperty('display', 'none')
            }}
          />
          {/* Platform identity rides the media, the way every reference
              thumbnail carries its brand circle. */}
          <span className="absolute left-3 top-3 drop-shadow-[0_1px_3px_rgb(0_0_0/0.3)]">
            <PlatformBadge platform={platform} size={28} />
          </span>
          {media[0].kind === 'video' && (
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid size-14 place-items-center rounded-full bg-black/55 backdrop-blur-sm transition-transform duration-300 group-hover:scale-105">
                <Play size={22} className="ml-0.5 fill-white text-white" />
              </span>
            </span>
          )}
          {media[0].durationSeconds != null && (
            <span className="absolute bottom-2.5 right-2.5 rounded-full bg-black/70 px-2 py-0.5 text-2xs font-semibold text-white tabular-nums">
              {formatDuration(media[0].durationSeconds)}
            </span>
          )}
        </a>
      )}

      <div className="p-4 sm:p-5">
        {/* Author */}
        <div className="flex items-start gap-3">
          <Avatar src={author.avatarUrl} name={author.name ?? platform} size={44} />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate font-semibold">{author.name ?? 'Unknown author'}</p>
              {author.verified && (
                <BadgeCheck size={16} className="shrink-0 text-[var(--info)]" aria-label="Verified" />
              )}
            </div>

            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3">
              {author.handle && <span className="truncate">@{author.handle}</span>}
              {author.followers.value != null && (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Users size={11} />
                  {compact(author.followers.value)}
                </span>
              )}
              {author.declaredLocation && (
                <span className="inline-flex items-center gap-1 truncate">
                  <MapPin size={11} />
                  {author.declaredLocation}
                </span>
              )}
            </div>
          </div>

          {/* Without media there is no badge above, so the row carries it. */}
          {!hasMedia && <PlatformBadge platform={platform} size={28} className="mt-0.5" />}
        </div>

        {/* Text - original script, full size, never truncated below the fold
            without a way to see the rest. */}
        {shown && (
          <div className="mt-4">
            <p
              className="whitespace-pre-wrap break-words text-base leading-[1.6]"
              lang={content.languageCode ?? undefined}
            >
              {shown}
            </p>

            {isLong && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 inline-flex min-h-11 items-center gap-1 pr-2 text-sm font-semibold text-[var(--accent)]"
              >
                {expanded ? 'Show less' : 'Read full post'}
                <ChevronDown
                  size={14}
                  className={cn('transition-transform', expanded && 'rotate-180')}
                />
              </button>
            )}
          </div>
        )}

        {/* Translation */}
        {content.translation && (
          <div className="mt-3">
            <button
              onClick={() => setShowTranslation((v) => !v)}
              className="inline-flex min-h-11 items-center gap-1.5 pr-2 text-xs font-medium text-ink-3"
            >
              <Languages size={13} />
              {showTranslation ? 'Hide' : 'Show'} English
              {content.languageName && ` · from ${content.languageName}`}
            </button>

            {/* Opacity and a small lift, not height.

                Animating height to 'auto' forces a measure-and-relayout on
                every frame, and this sits directly above the longest text on
                the page — so the whole report below it reflowed for the length
                of the spring. The translation is not conditional content the
                user has to wait for; it just appears. */}
            <AnimatePresence initial={false}>
              {showTranslation && (
                <m.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={spring.settle}
                >
                  <p className="mt-2 border-l-2 border-[var(--accent)] pl-3 text-sm italic leading-[1.6] text-ink-2">
                    {content.translation}
                  </p>
                </m.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Hashtags */}
        {content.hashtags.length > 0 && (
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {content.hashtags.slice(0, 8).map((h) => (
              <span
                key={h}
                className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold leading-none text-[var(--accent)]"
              >
                #{h}
              </span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
          <div className="min-w-0 text-2xs text-ink-3">
            {snapshot.publishedAt ? (
              <span title={absoluteDate(snapshot.publishedAt)}>
                {relativeTime(snapshot.publishedAt)} · {absoluteDate(snapshot.publishedAt)}
              </span>
            ) : (
              <span>Date unknown</span>
            )}
          </div>

          <a
            href={snapshot.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-medium text-ink-2 hover:text-[var(--accent)]"
          >
            {hostOf(snapshot.canonicalUrl)}
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </Card>
  )
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = Math.floor(s % 60)
  return h > 0
    ? `${h}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${mm}:${String(ss).padStart(2, '0')}`
}

/** Shown while the analysis is still running, so the card does not pop in. */
export function PostCardSkeleton() {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="sk size-11 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="sk h-4 w-1/3" />
          <div className="sk h-3 w-1/4" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div className="sk h-3 w-full" />
        <div className="sk h-3 w-[92%]" />
        <div className="sk h-3 w-[78%]" />
      </div>
    </Card>
  )
}
