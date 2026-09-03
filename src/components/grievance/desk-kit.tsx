import {
  Bus,
  Droplets,
  GraduationCap,
  HeartPulse,
  Landmark,
  Leaf,
  ScaleIcon,
  Scale,
  Shield,
  Sprout,
  Users,
  Wallet,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { Severity, Topic } from '@shared/taxonomy'

/**
 * The grievance desk's shared vocabulary of colour and glyph.
 *
 * Built to the owner's reference sheet, which gives every severity a tinted
 * pill and every topic a 42px tile with a line-art glyph. The tokens are
 * literal hex from that sheet rather than the product's own semantic tokens:
 * this screen is the one the office was shown and signed off, and its palette
 * is a little warmer than the app's `--neg` / `--warn` / `--pos`. Where the
 * reference and the design system disagree, the reference wins HERE and
 * nowhere else, so nothing outside this desk drifts.
 */

export interface SeverityTokens {
  /** The pill on a table row. */
  chipFill: string
  chipText: string
  /** The suggestion card that carries this severity. */
  cardFill: string
  cardBorder: string
  quoteFill: string
  badgeFill: string
}

/**
 * Critical shares High's tokens deliberately.
 *
 * The reference sheet only draws three levels and the taxonomy carries four.
 * Inventing a fourth colour for Critical would put a shade on screen the owner
 * never saw; folding it into High keeps it visibly the most severe thing on
 * the desk, and the word itself still prints in the pill.
 */
export const SEVERITY: Record<Severity, SeverityTokens> = {
  Critical: {
    chipFill: '#FEE9EB',
    chipText: '#E0435A',
    cardFill: '#FEF8F8',
    cardBorder: '#FBE4E7',
    quoteFill: '#FCEDEF',
    badgeFill: '#FCEBEC',
  },
  High: {
    chipFill: '#FEE9EB',
    chipText: '#E0435A',
    cardFill: '#FEF8F8',
    cardBorder: '#FBE4E7',
    quoteFill: '#FCEDEF',
    badgeFill: '#FCEBEC',
  },
  Medium: {
    chipFill: '#FBF2E3',
    chipText: '#D08A2E',
    cardFill: '#FFFAF6',
    cardBorder: '#FAEEE1',
    quoteFill: '#FDF4EB',
    badgeFill: '#FBF0E4',
  },
  Low: {
    chipFill: '#EDF8F1',
    chipText: '#2E9E63',
    cardFill: '#F9FDFB',
    cardBorder: '#E3F2EA',
    quoteFill: '#EDF8F1',
    badgeFill: '#E9F6EF',
  },
}

interface TopicTile {
  Icon: LucideIcon
  fill: string
  fg: string
}

/**
 * A tile per topic, in the reference's five tints.
 *
 * The sheet draws water, roads, people, a graduation cap and a tap. The
 * taxonomy carries twenty-odd topics, so each is mapped onto the nearest of
 * those families rather than given a colour nobody chose.
 */
const TILE: Record<string, TopicTile> = {
  'Water & Sanitation': { Icon: Droplets, fill: '#F2F3FC', fg: '#1E3A8A' },
  Roads: { Icon: Wrench, fill: '#FDEDE3', fg: '#E07B39' },
  Transport: { Icon: Bus, fill: '#FDEDE3', fg: '#E07B39' },
  'Development Works': { Icon: Wrench, fill: '#FDEDE3', fg: '#E07B39' },
  Employment: { Icon: Users, fill: '#FCECEF', fg: '#C0334A' },
  Education: { Icon: GraduationCap, fill: '#FCF2E6', fg: '#E08A2F' },
  Health: { Icon: HeartPulse, fill: '#FCECEF', fg: '#C0334A' },
  Electricity: { Icon: Zap, fill: '#FCF2E6', fg: '#E08A2F' },
  Agriculture: { Icon: Sprout, fill: '#EBF7F1', fg: '#2E8B63' },
  Environment: { Icon: Leaf, fill: '#EBF7F1', fg: '#2E8B63' },
  Housing: { Icon: Landmark, fill: '#F2F3FC', fg: '#1E3A8A' },
  'Land & Revenue': { Icon: Landmark, fill: '#F2F3FC', fg: '#1E3A8A' },
  'Social Welfare / Pensions': { Icon: Wallet, fill: '#EBF7F1', fg: '#2E8B63' },
  Scheme: { Icon: Wallet, fill: '#EBF7F1', fg: '#2E8B63' },
  'Law & Order': { Icon: Shield, fill: '#FCECEF', fg: '#C0334A' },
  'Crime / Injustice': { Icon: Shield, fill: '#FCECEF', fg: '#C0334A' },
  Corruption: { Icon: Scale, fill: '#FCECEF', fg: '#C0334A' },
  Governance: { Icon: Landmark, fill: '#F2F3FC', fg: '#1E3A8A' },
  Elections: { Icon: ScaleIcon, fill: '#F2F3FC', fg: '#1E3A8A' },
}

const FALLBACK: TopicTile = { Icon: Landmark, fill: '#F2F3FC', fg: '#1E3A8A' }

export const tileFor = (topic: Topic | string | null): TopicTile =>
  TILE[topic ?? ''] ?? FALLBACK

/** The reference's 42px topic tile. */
export function TopicTile({ topic, size = 42 }: { topic: Topic | string | null; size?: number }) {
  const { Icon, fill, fg } = tileFor(topic)
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[10px]"
      style={{ width: size, height: size, background: fill, color: fg }}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.45)} strokeWidth={1.7} />
    </span>
  )
}

/** The reference's severity pill: a rounded rect, not a full pill. */
export function SeverityPill({ level }: { level: Severity }) {
  const t = SEVERITY[level]
  return (
    <span
      className="inline-flex items-center rounded-[7px] px-[11px] py-[3px] text-[11.5px] font-semibold"
      style={{ background: t.chipFill, color: t.chipText }}
    >
      {level}
    </span>
  )
}

/**
 * A masthead's mark, as a coloured disc carrying its initial.
 *
 * The reference shows the real publisher logos — Eenadu's blue disc, Sakshi's
 * yellow one. We do not ship those images and will not hotlink somebody's
 * trademark, so each paper gets a stable disc colour derived from its own
 * name and keeps its initial. A desk always sees the same colour for the same
 * paper, which is what the logo was doing on that sheet.
 */
const DISC = ['#2196C4', '#F2CB05', '#D42A28', '#3B2FA8', '#2E8B63', '#E07B39', '#5D44F2']

export function PublisherMark({ name, size = 28 }: { name: string | null; size?: number }) {
  const label = (name ?? '').trim()
  let h = 0
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0
  const bg = label ? (DISC[h % DISC.length] ?? '#5D44F2') : '#C8CBD8'
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-extrabold text-white"
      style={{ width: size, height: size, background: bg, fontSize: Math.round(size * 0.42) }}
      aria-hidden
    >
      {label ? label.charAt(0).toUpperCase() : '?'}
    </span>
  )
}
