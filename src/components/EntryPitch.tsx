import * as m from 'motion/react-m'
import {
  Eye,
  Languages,
  MessageCircle,
  MessageSquareText,
  Repeat2,
  Rocket,
  ShieldCheck,
  Target,
  ThumbsUp,
  Users,
} from 'lucide-react'
import { PlatformBadge } from '@/components/kit'
import { SignalGlyph } from '@/components/ui'
import { fadeUp, listStagger } from '@/lib/motion'
import { cn } from '@/lib/utils'

/**
 * The half of the entrance that answers "what is this".
 *
 * Built to the owner's reference, element for element: the masthead, the
 * headline with its blue clause and drawn underline, one sentence of what the
 * product is for, four borderless feature rows down the left, the Overview
 * specimen floating on the right with the platform marks orbiting it, the
 * leader-and-parliament silhouette in the corner, and the understand / act /
 * lead band along the bottom.
 *
 * THE SPECIMEN IS A SPECIMEN. Its figures are illustration, not measurement —
 * it is `aria-hidden` decoration that costs no request, and the one honest
 * thing it does is open the demo desk when clicked, where every number on
 * screen is a real reading. Nothing here may ever be mistaken for live data.
 *
 * IT HAS TO FIT. This column sits beside the one screen in the product that
 * must be legible at a glance, so the specimen stands down under
 * `.pitch-specimen` on a short window, and every floating ornament exists only
 * from lg up — on a phone the pitch is text, the board, and the band.
 */

/** Four features, borderless rows, in the reference's own words. */
const FEATURES = [
  {
    icon: MessageSquareText,
    tint: 'var(--accent-soft)',
    fg: 'var(--accent)',
    title: 'Real conversations, real context',
    line: 'We read beyond the score. Get the full story behind posts, comments, and mentions.',
  },
  {
    icon: Languages,
    tint: 'var(--pos-soft)',
    fg: 'var(--pos)',
    title: 'Multi-language intelligence',
    line: 'Telugu, Hindi and more, because every voice deserves to be understood.',
  },
  {
    icon: Target,
    tint: 'var(--warn-soft)',
    fg: 'var(--warn)',
    title: 'Actionable insights',
    line: 'From sentiment to solutions: know what to do, what to say, and where to focus.',
  },
  {
    icon: ShieldCheck,
    tint: 'var(--accent-soft)',
    fg: 'var(--accent)',
    title: 'Built for trust & responsibility',
    line: 'Secure, private and designed for leaders who serve the people.',
  },
] as const

/** The closing band: the loop the product runs, in three words. */
const LOOP = [
  { icon: Users, word: 'Understand', line: 'what people are saying' },
  { icon: Target, word: 'Act', line: 'with clarity and data' },
  { icon: Rocket, word: 'Lead', line: 'with impact and trust' },
] as const

export function EntryPitch({ onDemo }: { onDemo?: () => void }) {
  return (
    <m.div
      variants={listStagger}
      initial="hidden"
      animate="show"
      className="min-w-0 lg:flex lg:flex-1 lg:flex-col"
    >
      {/* Hidden on phones, where the entry screen carries its own compact
          masthead above the card. */}
      <m.div variants={fadeUp} className="hidden items-center gap-3 lg:flex">
        {/* SignalGlyph paints its OWN gradient tile from currentColor, so it
            must not be nested inside another coloured tile: doing that set
            currentColor to white and the mark rendered as a white square with
            white bars, which is why it read as a pale blank chip. */}
        <span className="shrink-0 text-[var(--accent)] drop-shadow-[0_6px_14px_rgb(79_82_245_/_0.3)]">
          <SignalGlyph size={44} />
        </span>
        <span className="min-w-0">
          <span className="hed block text-lg leading-none">Signal</span>
          <span className="mt-1 block text-[12px] font-medium text-ink-2">
            Media Intelligence Platform
          </span>
        </span>
      </m.div>

      <m.h1
        variants={fadeUp}
        className="hed mt-0 text-[clamp(1.9rem,1.1rem+2.3vw,2.95rem)] leading-[1.08] lg:mt-7"
      >
        Know what is being said,
        <br className="hidden sm:block" /> and{' '}
        <span className="relative inline-block text-[var(--accent)]">
          what to say back.
          {/* Measured off the reference: a short 86px stroke under the last
              word, overhanging the text's right edge by about 4%, NOT a rule
              beneath the whole phrase. */}
          <svg
            aria-hidden
            className="absolute -bottom-[9px] right-[-3.6%] w-[24%] text-[var(--accent)]"
            viewBox="0 0 100 7"
            fill="none"
            preserveAspectRatio="none"
          >
            <path
              d="M3.5 5.4 Q50 1.6 96.5 3.4"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
              opacity="0.95"
            />
          </svg>
        </span>
      </m.h1>

      <m.p variants={fadeUp} className="mt-4 max-w-[52ch] text-[15px] leading-[1.76] text-ink-2">
        Signal helps public leaders and teams understand conversations across social media and
        the web, so you can listen, act and lead with impact.
      </m.p>

      {/* Features down the left, the floating specimen on the right. Column
          widths are the reference's own: a 336px feature column against a
          424px board, which is narrower and taller than the wide board we
          had. */}
      <div className="mt-7 lg:mt-9 lg:grid lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start lg:gap-8">
        <m.ul variants={fadeUp} className="grid gap-5 lg:gap-[1.85rem]">
          {FEATURES.map(({ icon: Icon, tint, fg, title, line }) => (
            <li key={title} className="flex items-start gap-3.5">
              {/* 56px, measured off the reference — the 36px tile we had was
                  the single loudest "not the same design" tell in this column. */}
              <span
                className="grid size-11 shrink-0 place-items-center rounded-[13px] lg:size-14 lg:rounded-[16px]"
                style={{ background: tint, color: fg }}
              >
                <Icon size={22} strokeWidth={2.1} aria-hidden className="lg:hidden" />
                <Icon size={26} strokeWidth={2.1} aria-hidden className="hidden lg:block" />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-bold leading-tight text-ink">{title}</span>
                <span className="mt-1 block max-w-[40ch] text-[12px] leading-[1.5] text-ink-2">
                  {line}
                </span>
              </span>
            </li>
          ))}
        </m.ul>

        {/* The board rides above the feature list, as it does in the
            reference, rather than sitting on the same top line. */}
        <m.div variants={fadeUp} className="pitch-specimen relative mt-9 lg:-mt-10 lg:max-w-[24.5rem]">
          <FloatCluster />
          <SpecimenBoard onOpen={onDemo} />
        </m.div>
      </div>

      {/* The closing band. The corner scene is anchored to the page itself in
          Lock.tsx, bleeding off the bottom-left the way the reference does, so
          the band alone owns this row and steps right to clear it. */}
      <div className="mt-7 lg:mt-auto lg:pb-11 lg:pt-8 lg:[@media(min-height:44rem)]:pl-[21rem]">
        <m.div
          variants={fadeUp}
          // Translucent, not solid: in the reference the crowd silhouette
          // reads faintly through this band where it crosses the illustration.
          className="grid grid-cols-3 gap-2 rounded-[22px] border border-[var(--rule)] bg-[color-mix(in_oklab,var(--surface)_74%,transparent)] p-3.5 backdrop-blur-[6px] sm:gap-3 sm:p-4"
        >
          {LOOP.map(({ icon: Icon, word, line }) => (
            <div
              key={word}
              className="flex min-w-0 flex-col items-center gap-1.5 text-center sm:flex-row sm:items-start sm:gap-2 sm:text-left"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)] sm:size-9">
                <Icon size={14} strokeWidth={2.2} aria-hidden className="sm:hidden" />
                <Icon size={18} strokeWidth={2.2} aria-hidden className="hidden sm:block" />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold leading-tight text-[var(--accent)] sm:text-[12.5px]">
                  {word}
                </span>
                <span className="mt-0.5 block text-[10.5px] leading-tight text-ink-2">{line}</span>
              </span>
            </div>
          ))}
        </m.div>
      </div>
    </m.div>
  )
}

/* ── the Overview specimen ─────────────────────────────────────────────────── */

const STATS = [
  { label: 'Total Mentions', value: '25.8K', delta: '18.6%', up: true, lift: 0, tint: '' },
  { label: 'Positive', value: '62%', delta: '16.2%', up: true, lift: 5, tint: '' },
  // The negative tile carries a faint red wash in the reference.
  { label: 'Negative', value: '17%', delta: '6.8%', up: false, lift: 10, tint: 'var(--neg-soft)' },
  { label: 'Engagement', value: '312K', delta: '21.4%', up: true, lift: 15, tint: '' },
] as const

const TOPICS = [
  { name: 'Development', count: '2.6K', width: 100 },
  { name: 'Roads', count: '1.9K', width: 74 },
  { name: 'Water Supply', count: '1.4K', width: 56 },
  { name: 'Education', count: '1.1K', width: 44 },
  { name: 'Jobs', count: '1.0K', width: 39 },
] as const

const POST_COUNTS = [
  { icon: ThumbsUp, value: '2.4K' },
  { icon: MessageCircle, value: '186' },
  { icon: Repeat2, value: '245' },
  { icon: Eye, value: '98K' },
] as const

/**
 * The dashboard miniature from the reference: stat tiles, sentiment trend,
 * top topics, top performing post. Illustration figures, honest about it —
 * the whole board is aria-hidden and the click, when wired, opens the demo
 * desk where the numbers are real.
 */
function SpecimenBoard({ onOpen }: { onOpen?: () => void }) {
  const board = (
    <div
      // The reference floats this board rather than laying it flat: its right
      // edge walks ~13px left over 140px of height. A little perspective plus a
      // slight clockwise turn reproduces that without blurring the type.
      className="rounded-2xl bg-[var(--surface)] p-4 shadow-[var(--e4)] ring-1 ring-[var(--rule)] lg:[transform:perspective(1600px)_rotateY(-5deg)_rotate(1.4deg)]"
    >
      <div aria-hidden>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-bold text-ink">
            Overview <span className="font-medium text-ink-3">(Last 7 Days)</span>
          </p>
          <svg viewBox="0 0 46 12" className="h-3.5 w-12 text-ink-3 opacity-60" fill="none">
            <path
              d="M1 9 Q6 3 11 7 T21 6 T31 8 T45 3"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* The reference's stat tiles step gently down left to right. */}
        <div className="mt-2 grid grid-cols-4 items-start gap-2">
          {STATS.map((s) => (
            <div
              key={s.label}
              style={{ marginTop: s.lift, ...(s.tint ? { background: s.tint } : {}) }}
              className="rounded-lg border border-[var(--rule)] bg-[var(--surface)] px-2 py-2 shadow-[0_1px_3px_rgb(15_23_42/0.07)]"
            >
              <p className="truncate text-[9px] font-semibold text-ink-3">{s.label}</p>
              <p className="tnum mt-1 text-[18px] font-extrabold leading-none text-ink">{s.value}</p>
              <p
                className={cn(
                  'tnum mt-1.5 text-[9.5px] font-bold leading-none',
                  s.up ? 'text-[var(--pos)]' : 'text-[var(--neg)]',
                )}
              >
                {s.up ? '↑' : '↓'} {s.delta}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-ink-2">Sentiment Trend</p>
            <svg viewBox="0 0 150 54" preserveAspectRatio="none" className="mt-1.5 h-[100px] w-full" fill="none">
              <path
                d="M0 21 L9 17 L18 23 L27 15 L36 20 L45 12 L54 18 L63 10 L72 16 L81 8 L90 14 L99 7 L108 12 L117 6 L126 10 L135 5 L143 9 L150 6 L150 27 L143 29 L135 26 L126 30 L117 27 L108 31 L99 28 L90 32 L81 29 L72 33 L63 30 L54 34 L45 31 L36 35 L27 32 L18 36 L9 33 L0 35 Z"
                fill="color-mix(in oklab, var(--chart-pos) 34%, transparent)"
                stroke="var(--chart-pos)"
                strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d="M0 39 L9 36 L18 41 L27 34 L36 40 L45 33 L54 39 L63 32 L72 38 L81 31 L90 37 L99 31 L108 36 L117 30 L126 35 L135 29 L143 34 L150 30 L150 48 L143 50 L135 47 L126 51 L117 48 L108 52 L99 49 L90 52 L81 50 L72 53 L63 50 L54 53 L45 51 L36 54 L27 51 L18 54 L9 52 L0 54 Z"
                fill="color-mix(in oklab, var(--chart-neg) 30%, transparent)"
                stroke="var(--chart-neg)"
                strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div className="tnum mt-1.5 flex justify-between text-[7px] font-medium text-ink-3">
              {['13 May', '14 May', '15 May', '17 May', '18 May', '19 May'].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
          </div>

          <div className="min-w-0">
            <p className="text-[10px] font-bold text-ink-2">Top Topics</p>
            <div className="mt-2 grid gap-[9px]">
              {TOPICS.map((t) => (
                <div key={t.name} className="flex items-center gap-2">
                  <span className="w-[66px] truncate text-[9px] font-medium text-ink-2">
                    {t.name}
                  </span>
                  <span className="h-[7px] min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${t.width}%`,
                        background:
                          'linear-gradient(90deg, var(--accent), color-mix(in oklab, #7c3aed 70%, var(--accent)))',
                      }}
                    />
                  </span>
                  <span className="tnum w-6 shrink-0 text-right text-[8px] font-semibold text-ink-3">
                    {t.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-2 border-t border-[var(--rule)] pt-2.5">
          <p className="text-[10px] font-bold text-ink-2">Top Performing Post</p>
          {/* Photo left with the engagement counts beneath it, the two rates
              stacked to its right: the reference's arrangement, and its photo
              is 178x103 in a 455-wide board rather than a thumbnail. */}
          <div className="mt-2 flex gap-4">
            <div className="shrink-0">
              <img
                src="/entry/post.jpg"
                alt=""
                aria-hidden
                draggable={false}
                className="h-[103px] w-[178px] rounded-lg object-cover"
              />
              <div className="mt-2 flex items-center gap-3 text-ink-3">
                {POST_COUNTS.map(({ icon: Icon, value }) => (
                  <span key={value} className="flex items-center gap-1">
                    <Icon size={11} strokeWidth={2.2} />
                    <span className="tnum text-[9px] font-semibold">{value}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="grid min-w-0 flex-1 content-start gap-4">
              <div>
                <p className="text-[8.5px] text-ink-3">Positive Sentiment</p>
                <p className="tnum text-[19px] font-extrabold leading-tight text-ink">
                  82<span className="text-[11px]">%</span>
                </p>
              </div>
              <div>
                <p className="text-[8.5px] text-ink-3">Engagement Rate</p>
                <p className="tnum text-[19px] font-extrabold leading-tight text-ink">
                  8.7<span className="text-[11px]">%</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  if (onOpen === undefined) return board
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open the demo dashboard"
      className="block w-full text-left transition-transform duration-200 hover:-translate-y-0.5"
    >
      {board}
    </button>
  )
}

/* ── the floating ornaments around the specimen ────────────────────────────── */

function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 0l2.4 9.6L24 12l-9.6 2.4L12 24l-2.4-9.6L0 12l9.6-2.4Z" />
    </svg>
  )
}

/**
 * The platform marks orbiting the board, the two white squircles, the dashed
 * arc, the sparkles. Pure decoration: lg only, aria-hidden, no pointer.
 */
function FloatCluster() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
      <svg
        className="absolute -left-10 -top-10 h-[calc(100%+5rem)] w-[calc(100%+5rem)] text-[var(--accent)]"
        viewBox="0 0 500 420"
        fill="none"
        preserveAspectRatio="none"
      >
        {/* The reference keeps only a faint dotted fragment off the board's
            top-right, not a loop around the whole thing. */}
        <path
          d="M300 34 C372 24 430 74 452 140"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeDasharray="1.4 8"
          strokeLinecap="round"
          opacity="0.22"
        />
      </svg>

      <Sparkle className="absolute -top-10 right-16 w-3.5 text-[#a78bfa]" />
      <Sparkle className="absolute -left-9 top-24 w-2.5 text-[#93c5fd]" />
      <Sparkle className="absolute -right-8 -top-3 w-2 text-[#c4b5fd]" />
      <Sparkle className="absolute -bottom-9 left-10 w-3 text-[#93c5fd]" />

      {/* Every mark sits where the reference puts it, measured off it and
          expressed relative to the board's own top-left corner: a loose arc
          over the top and down the right flank. */}
      {/* A frosted tile carrying a violet bar-chart glyph, as the reference
          has it — drawn here rather than reusing SignalGlyph, which would
          stamp its own solid tile inside this one. */}
      <span
        className="absolute left-[299px] top-[-134px] grid size-[70px] place-items-center rounded-[22px] shadow-[var(--e3)]"
        style={{ background: 'linear-gradient(150deg, #ffffff 0%, #eee9fd 100%)' }}
      >
        <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
          <rect x="5" y="18" width="4.4" height="9" rx="2.2" fill="var(--accent)" opacity=".45" />
          <rect x="12.2" y="12.6" width="4.4" height="14.4" rx="2.2" fill="var(--accent)" opacity=".7" />
          <rect x="19.4" y="5" width="4.4" height="22" rx="2.2" fill="var(--accent)" />
        </svg>
      </span>
      <span className="absolute left-[194px] top-[-64px]">
        <PlatformBadge platform="Instagram" size={38} />
      </span>
      <span className="absolute left-[405px] top-[-20px]">
        <PlatformBadge platform="Facebook" size={38} />
      </span>
      <span className="absolute left-[424px] top-[105px]">
        <PlatformBadge platform="Twitter/X" size={38} />
      </span>
      <span className="absolute left-[412px] top-[228px]">
        <PlatformBadge platform="YouTube" size={37} />
      </span>

      {/* The donut badge is a large white tile overlapping the board's
          bottom-right corner in the reference, not a small bare ring. */}
      <span className="absolute -bottom-7 -right-6 grid size-[86px] place-items-center rounded-[26px] bg-[var(--surface)] shadow-[var(--e3)]">
        <svg viewBox="0 0 24 24" className="size-10">
          <circle cx="12" cy="12" r="8" fill="none" stroke="var(--surface-3)" strokeWidth="5" />
          <circle
            cx="12"
            cy="12"
            r="8"
            fill="none"
            stroke="#22c55e"
            strokeWidth="5"
            strokeDasharray="34 50.3"
            strokeLinecap="round"
            transform="rotate(-90 12 12)"
          />
        </svg>
      </span>
    </div>
  )
}

/* ── the corner illustration ───────────────────────────────────────────────── */

/**
 * The reference's bottom-left scene as a drawn silhouette: a leader waving
 * before a domed parliament, the tricolour in its natural colours per the
 * owner's protocol, a crowd along the base. Indigo on purpose — it is an
 * illustration, not a photograph, and it must read that way.
 */
function LeaderScene({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 340 210" className={className} aria-hidden>
      <defs>
        <linearGradient id="ls-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a5b0f5" />
          <stop offset="1" stopColor="#c7cdf9" />
        </linearGradient>
        <linearGradient id="ls-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b5bd6" />
          <stop offset="1" stopColor="#7a7df0" />
        </linearGradient>
      </defs>

      {/* birds */}
      <path
        d="M212 32 q5 -5 10 0 q5 -5 10 0 M252 20 q4 -4 8 0 q4 -4 8 0 M288 40 q4 -4 8 0 q4 -4 8 0"
        stroke="#8f9af0"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />

      {/* the parliament */}
      <g fill="url(#ls-far)">
        <rect x="118" y="150" width="200" height="9" rx="2" />
        <rect x="128" y="141" width="180" height="8" rx="2" />
        <rect x="136" y="112" width="164" height="29" rx="2" />
        <rect x="198" y="94" width="40" height="20" rx="2" />
      </g>
      <g fill="#8791ec">
        <rect x="146" y="117" width="6" height="20" rx="1" />
        <rect x="164" y="117" width="6" height="20" rx="1" />
        <rect x="182" y="117" width="6" height="20" rx="1" />
        <rect x="212" y="117" width="6" height="20" rx="1" />
        <rect x="248" y="117" width="6" height="20" rx="1" />
        <rect x="266" y="117" width="6" height="20" rx="1" />
        <rect x="284" y="117" width="6" height="20" rx="1" />
        <path d="M200 94 a18 15 0 0 1 36 0 Z" />
        <path d="M146 112 a9 8 0 0 1 18 0 Z" />
        <path d="M272 112 a9 8 0 0 1 18 0 Z" />
      </g>

      {/* the tricolour, natural colours always */}
      <rect x="217" y="56" width="1.6" height="40" fill="#5b5bd6" />
      <rect x="218.6" y="58" width="17" height="4.2" fill="#ff9933" />
      <rect x="218.6" y="62.2" width="17" height="4.2" fill="#ffffff" />
      <circle cx="227" cy="64.3" r="1.3" fill="none" stroke="#054ea6" strokeWidth="0.6" />
      <rect x="218.6" y="66.4" width="17" height="4.2" fill="#128807" />

      {/* the crowd, two rows */}
      <g fill="#98a2f2" opacity="0.6">
        <circle cx="104" cy="176" r="10" />
        <circle cx="128" cy="180" r="11" />
        <circle cx="154" cy="176" r="9" />
        <circle cx="178" cy="181" r="11" />
        <circle cx="204" cy="177" r="10" />
        <circle cx="230" cy="181" r="11" />
        <circle cx="256" cy="176" r="9" />
        <circle cx="282" cy="180" r="11" />
        <circle cx="308" cy="177" r="10" />
        <circle cx="330" cy="181" r="9" />
        <rect x="142" y="152" width="3" height="16" rx="1.5" transform="rotate(-14 143 160)" />
        <circle cx="140" cy="150" r="2.6" />
        <rect x="248" y="154" width="3" height="15" rx="1.5" transform="rotate(12 249 161)" />
        <circle cx="251" cy="152" r="2.6" />
      </g>
      <g fill="#6c74e4" opacity="0.85">
        <circle cx="96" cy="196" r="12" />
        <circle cx="124" cy="200" r="13" />
        <circle cx="156" cy="196" r="11" />
        <circle cx="188" cy="201" r="13" />
        <circle cx="220" cy="196" r="12" />
        <circle cx="252" cy="201" r="13" />
        <circle cx="284" cy="196" r="11" />
        <circle cx="314" cy="200" r="13" />
        <circle cx="338" cy="197" r="11" />
        <rect x="206" y="172" width="3.4" height="18" rx="1.7" transform="rotate(-10 207 180)" />
        <circle cx="204" cy="170" r="3" />
        <rect x="300" y="174" width="3.4" height="17" rx="1.7" transform="rotate(14 301 182)" />
        <circle cx="304" cy="172" r="3" />
      </g>

      {/* the leader, waving */}
      <g fill="url(#ls-near)">
        <circle cx="56" cy="78" r="15" />
        <path d="M30 210 L33 128 Q36 104 56 98 Q76 104 79 126 L82 210 Z" />
        <path d="M72 112 Q88 92 94 64 L106 70 Q98 104 78 124 Z" />
        <circle cx="101" cy="62" r="7" />
      </g>
    </svg>
  )
}
