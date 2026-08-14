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
import { Card, Chip, Provenance } from '../ui'
import { absoluteDate, cn, compact, hostOf, relativeTime } from '@/lib/utils'
import { ease, spring } from '@/lib/motion'

const PLATFORM_TONE: Record<string, string> = {
  YouTube: '#FF0033',
  Facebook: '#0866FF',
  Instagram: '#E4405F',
  'Twitter/X': '#000000',
  Threads: '#000000',
  LinkedIn: '#0A66C2',
  Telegram: '#26A5E4',
  TikTok: '#25F4EE',
  Reddit: '#FF4500',
  Bluesky: '#0085FF',
  Mastodon: '#6364FF',
  Pinterest: '#E60023',
  Snapchat: '#FFFC00',
}

/**
 * Readable initial on a brand colour.
 *
 * The fallback avatar paints the platform's own colour, and those range from
 * black (X, Threads) to Snapchat yellow and TikTok cyan. A hardcoded white
 * initial disappears on the light end, so pick the foreground from the
 * background's luminance instead of assuming.
 */
function onBrand(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const L =
    0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  // Contrast against white is (1.05)/(L+0.05); against black it is (L+0.05)/0.05.
  // They cross at L ≈ 0.179, so that is the switch point.
  return L > 0.179 ? '#111318' : '#ffffff'
}

/**
 * The post exactly as it was found, before any interpretation.
 *
 * Original script is always shown first and at full size; the English
 * translation sits beneath it as a secondary read. That ordering matters for
 * this audience — staff read the Telugu, but the report travels in English,
 * and the sheet's own rules require allegations be preserved verbatim.
 */
export function PostCard({ snapshot }: { snapshot: PostSnapshot }) {
  const [expanded, setExpanded] = useState(false)
  const [showTranslation, setShowTranslation] = useState(true)

  const { author, content, media, platform } = snapshot
  const text = content.text ?? ''
  const isLong = text.length > 320
  const shown = expanded || !isLong ? text : `${text.slice(0, 320).trimEnd()}…`
  const brand = PLATFORM_TONE[platform]

  return (
    <Card padded={false} className="overflow-hidden">
      {/* Media */}
      {media[0]?.thumbnailUrl && (
        <a
          href={snapshot.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative block aspect-video overflow-hidden bg-[var(--surface-2)]"
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
          {media[0].kind === 'video' && (
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid size-14 place-items-center rounded-full bg-black/55 backdrop-blur-sm">
                <Play size={22} className="ml-0.5 fill-white text-white" />
              </span>
            </span>
          )}
          {media[0].durationSeconds != null && (
            <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-2xs font-medium text-white tabular-nums">
              {formatDuration(media[0].durationSeconds)}
            </span>
          )}
        </a>
      )}

      <div className="p-4 sm:p-5">
        {/* Author */}
        <div className="flex items-start gap-3">
          {author.avatarUrl ? (
            <img
              src={author.avatarUrl}
              alt=""
              loading="lazy"
              className="size-11 shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]"
            />
          ) : (
            <div
              className="grid size-11 shrink-0 place-items-center rounded-full text-lg font-semibold"
              style={{
                background: brand ?? 'var(--accent)',
                color: brand ? onBrand(brand) : '#ffffff',
              }}
            >
              {(author.name ?? platform).charAt(0).toUpperCase()}
            </div>
          )}

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
                <span className="inline-flex items-center gap-1">
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

          <Chip tone="neutral" className="shrink-0">
            {platform === 'Twitter/X' ? 'X' : platform}
          </Chip>
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
                className="mt-1 inline-flex min-h-11 items-center gap-1 pr-2 text-sm font-medium text-[var(--accent)]"
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
          <div className="mt-3 flex flex-wrap gap-1.5">
            {content.hashtags.slice(0, 8).map((h) => (
              <span key={h} className="text-xs font-medium text-[var(--accent)]">
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
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-ink-2 hover:text-[var(--accent)]"
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
