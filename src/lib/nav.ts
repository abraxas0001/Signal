import {
  Clock,
  FileWarning,
  Gauge,
  GitCompareArrows,
  Lightbulb,
  LayoutGrid,
  Link2,
  ListChecks,
  Megaphone,
  MessagesSquare,
  Newspaper,
  Settings as SettingsIcon,
  Sparkles,
  Swords,
  UserSearch,
  Wand2,
} from 'lucide-react'

/**
 * Every place this app can go, listed once.
 *
 * Four surfaces used to hand-maintain their own copy of this list — `Tab` in
 * TabBar, `NavKey` and `GROUPS` in SideNav, and `Destination` in Briefing — and
 * they disagreed. Measured at 360px on a freshly set-up desk, five screens were
 * reachable by no route at all: People, Actions, Accounts, Compare and
 * Settings. The tab bar has five slots, the sidebar is `lg:` and up, and the
 * dashboard links that were supposed to carry the rest sit inside sections that
 * only render once those sections have data.
 *
 * The bug was never "one screen is missing from the bar". It was that a new
 * destination had nowhere to land, so it landed nowhere — and the only thing
 * meant to catch that was a comment promising the dashboard would carry it. A
 * promise a compiler does not check is a comment.
 *
 * So every destination now has to be placed, and the build fails if one is not.
 */

export type Tab =
  | 'dashboard'
  | 'grievances'
  | 'personas'
  | 'analyse'
  | 'influencers'
  | 'history'
  | 'accounts'
  | 'compare'
  | 'actions'
  | 'weekly'
  | 'highlights'
  | 'audience'
  | 'nextpost'
  | 'studio'
  | 'settings'

export interface NavItem {
  id: Tab
  label: string
  Icon: typeof Newspaper
}

/**
 * A Record rather than an array: add a member to `Tab` and this stops
 * compiling until it has been given a label and an icon.
 */
export const NAV = {
  dashboard: { id: 'dashboard', label: 'Dashboard', Icon: Gauge },
  grievances: { id: 'grievances', label: 'Grievances', Icon: FileWarning },
  personas: { id: 'personas', label: 'People', Icon: UserSearch },
  influencers: { id: 'influencers', label: 'Influencers', Icon: Megaphone },
  actions: { id: 'actions', label: 'Tasks', Icon: ListChecks },
  accounts: { id: 'accounts', label: 'Accounts', Icon: LayoutGrid },
  compare: { id: 'compare', label: 'Compare', Icon: GitCompareArrows },
  history: { id: 'history', label: 'History', Icon: Clock },
  settings: { id: 'settings', label: 'Settings', Icon: SettingsIcon },
  analyse: { id: 'analyse', label: 'Analyse a link', Icon: Link2 },
  // Where the desk makes something rather than reads something. It is the one
  // screen here whose output is published under the member's own name, which
  // is why it carries its own door rather than hiding under a tools list.
  studio: { id: 'studio', label: 'Content studio', Icon: Wand2 },
  // Reached from the dashboard's week card, never from a bar: a sub-page of
  // a section, not a place of its own.
  weekly: { id: 'weekly', label: 'Week against rivals', Icon: Swords },
  // Reached from their own dashboard cards, never from a bar: each is the
  // long form of a card that already says the short form.
  highlights: { id: 'highlights', label: 'Post highlights', Icon: Sparkles },
  audience: { id: 'audience', label: 'What people are saying', Icon: MessagesSquare },
  nextpost: { id: 'nextpost', label: 'What to post next', Icon: Lightbulb },
} as const satisfies Record<Tab, NavItem>

/**
 * The phone's bottom bar. `analyse` is the raised centre, not a side slot.
 *
 * The product owner's current cut: the two daily reads on the left, then
 * Influencers and Compare on the right — "bring influencer button back to the
 * dashboard", verbatim, after a release that had moved it under Settings.
 * Settings itself leaves the bar for OVERFLOW: on the phone it is a row in
 * the More sheet, and on a laptop the sidebar pins it as the foot card. Its
 * "Your desk's tools" list is still the one unconditional route to the
 * UNLISTED screens below, which keeps the promise the completeness check
 * exists to enforce.
 */
export const BAR = ['dashboard', 'grievances', 'analyse', 'influencers', 'compare'] as const

/**
 * What the phone's More sheet carries.
 *
 * Settings moved here when Influencers took its bar slot back. MoreSheet
 * renders `OVERFLOW_GROUPS`, so this one edit is what lights the row up
 * there; the sheet's other jobs — the person header, the example-desk door,
 * Lock — never depended on this list.
 */
export const OVERFLOW = ['settings'] as const

/**
 * Reachable, but deliberately not in any navigation list.
 *
 * All four are rows on the Settings screen's "Your desk's tools" list, which
 * is a real, unconditional route — unlike the dashboard links that stranded
 * five screens the last time this file was reorganised. This category is what
 * lets a screen leave the navigation without leaving the completeness check
 * below, which is the whole point of that check: a screen that is hidden ON
 * PURPOSE and a screen that is stranded BY ACCIDENT must not look the same to
 * the compiler.
 *
 * People was already here by the office's request; Accounts, History and
 * Tasks joined it when the owner asked for everything that is not a daily
 * read to move under Settings. Influencers did too, and then left again when
 * the owner asked for it back on the bar.
 */
export const UNLISTED = [
  'studio',
  'personas',
  'accounts',
  'history',
  'actions',
  'weekly',
  'highlights',
  'audience',
  'nextpost',
] as const

/**
 * Every destination is on the bar, in the sheet, or explicitly unlisted —
 * exactly once. Add an eleventh `Tab` and the build breaks HERE, at the line
 * that asks where it goes, rather than shipping a screen nobody can open.
 *
 * The tuple wrappers stop `Exclude`/`Extract` distributing over the union,
 * which would make both checks vacuously true.
 */
type Placed = (typeof BAR)[number] | (typeof OVERFLOW)[number] | (typeof UNLISTED)[number]
type Unplaced = Exclude<Tab, Placed>
type Twice = Extract<(typeof BAR)[number], (typeof OVERFLOW)[number] | (typeof UNLISTED)[number]>
const _placed: [Unplaced] extends [never] ? ([Twice] extends [never] ? true : never) : never = true
void _placed

const OVERFLOW_SET: ReadonlySet<Tab> = new Set(OVERFLOW)
export const inOverflow = (t: Tab): boolean => OVERFLOW_SET.has(t)
export const labelOf = (t: Tab): string => NAV[t].label

/**
 * True for the screens that are reached through Settings' tools list. The
 * sidebar's foot card and the More sheet's Settings row light up while one of
 * these is open, because "where am I" must always have an answer and these
 * screens have no slot of their own to light. The phone bar lights nothing
 * for them — Settings is no longer on it.
 */
const UNLISTED_SET: ReadonlySet<Tab> = new Set(UNLISTED)
export const isUnlisted = (t: Tab): boolean => UNLISTED_SET.has(t)

/** The sidebar's taxonomy, which the More sheet reuses so the two agree. */
export const GROUPS: ReadonlyArray<{ heading: string; items: readonly NavItem[] }> = [
  {
    heading: 'Today',
    items: [NAV.dashboard, NAV.grievances, NAV.influencers, NAV.compare, NAV.studio],
  },
  { heading: 'Reference', items: [NAV.settings] },
]

/**
 * The same grouping, filtered to what More carries — currently the Settings
 * row alone. A derivation rather than a hand-kept list so that moving a
 * screen in or out of OVERFLOW is one edit above, not a MoreSheet rebuild.
 */
export const OVERFLOW_GROUPS = GROUPS.map((g) => ({
  heading: g.heading,
  items: g.items.filter((i) => inOverflow(i.id)),
})).filter((g) => g.items.length > 0)

/**
 * Shared styling, so the sheet and the sidebar cannot drift.
 *
 * NAV_FOCUS carries SideNav's reasoning with it: index.css rounds every
 * `:focus-visible` target to --radius-xs, and that rule is written after the
 * utility layers, so it wins on source order. Without this override a rounded
 * row snaps square the moment it takes keyboard focus, which reads as a
 * rendering fault rather than as focus. It is exactly the sort of thing that
 * gets forgotten when a constant is retyped instead of imported.
 */
export const NAV_FOCUS =
  'focus-visible:rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]'
export const NAV_ACTIVE = 'bg-[var(--accent-soft)] text-[var(--accent)]'
export const NAV_IDLE = 'text-ink-2 hover:bg-[var(--surface-2)] hover:text-ink'
/** 44px floor on anything a thumb hits. */
export const NAV_ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-xl text-left transition-colors duration-200'

/**
 * The bar's side slots, in order, derived from BAR.
 *
 * TabBar used to keep its own array of three items and its own icon choices,
 * so `BAR` was checked by the compiler but rendered by nothing: the two had
 * already drifted, listing Newspaper and Inbox here against Gauge and
 * FileWarning there. A completeness check over a list nobody draws is a test
 * of a comment. The icons above are now the ones that actually appear, and the
 * bar is built from this.
 *
 * `analyse` is excluded because it is the raised centre control rather than a
 * slot, and the bar positions it separately.
 */
export const BAR_SIDE: readonly NavItem[] = BAR.filter((id) => id !== 'analyse').map((id) => NAV[id])

/** Null when there is nothing worth showing. Clamped the same way everywhere. */
export const badgeOf = (n: number | undefined): string | null =>
  n != null && n > 0 ? (n > 99 ? '99+' : String(n)) : null
