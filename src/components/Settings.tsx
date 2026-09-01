import { useEffect } from 'react'
import * as m from 'motion/react-m'
import { AccountSection } from '@/components/settings/Account'
import { useReducedMotion } from 'motion/react'
import { ChevronRight, Search } from 'lucide-react'
import { Avatar, Button, Card, Chip, PageHeader } from './ui'
import { NAV, badgeOf, type Tab } from '@/lib/nav'
import { fadeUp, listStagger } from '@/lib/motion'
import { IdentityRows } from './IdentityEditor'
import { GrievanceDeskSection, InfluencerSection } from '@/components/settings/DeskConfig'
import { editField, saveIdentity } from '@/lib/identity'
import { useStore } from '@/lib/store'
import { currentNavState } from '@/lib/nav-history'

/**
 * The desk's back room: its tools, its configuration, who it is for, and the
 * office's accounts.
 *
 * The tools list comes first because it is why most visits happen now. The
 * product owner asked for everything that is not a daily read — Accounts,
 * Tasks, History, People — to live off the main navigation and behind
 * Settings, so this screen is the one unconditional route to those four.
 * Influencers was on that list for one release and then went back to the bar
 * at the owner's request. The rows only navigate; each screen stays its own
 * component and is rendered by App exactly as it was when it had a nav slot.
 *
 * Under the tools sit the two configuration sections — the grievance desk's
 * papers and words, the influencer roster — closed by default, per the owner:
 * nothing shows at first glance, and the pencil on each working screen lands
 * here with the right one open.
 */

/**
 * The four screens the product owner moved off the main navigation. Order is
 * rough frequency of use, not alphabet. The blurbs exist because a bare label
 * like "Accounts" no longer has a nav group heading to lean on for meaning.
 * Influencers left this list when it took its bar slot back — a row here as
 * well would be a second door beside an open one.
 */
const TOOLS: { id: Tab; blurb: string }[] = [
  { id: 'studio', blurb: 'Make a poster or a post to publish under your own name.' },
  // `weekly` was filed as UNLISTED on the strength of a comment saying the
  // dashboard's week card opens it. No card does, and nothing else did either,
  // so the screen rendered correctly and was reachable from nowhere. On a
  // phone this list is the only route to any of these, so it is the list that
  // has to carry it.
  { id: 'weekly', blurb: 'How your week reads against the accounts you track.' },
  { id: 'accounts', blurb: 'Every handle the desk follows and how its posts are doing.' },
  { id: 'actions', blurb: 'Work the desk has raised and what is still open.' },
  { id: 'history', blurb: 'Every report this device has run, ready to reopen.' },
  { id: 'personas', blurb: 'What the papers are saying about named people.' },
]

export function Settings({
  onClose,
  onChangePerson,
  onOpenTool,
  toolCounts,
  focusSection,
}: {
  onClose: () => void
  /**
   * Which configuration section arrives open and scrolled into view. Set by
   * the pencil buttons on the grievance and influencer screens; absent on a
   * plain visit, when both sections start closed.
   */
  focusSection?: 'grievances' | 'influencers'
  /**
   * Reopens the setup search.
   *
   * Editing a field and changing who the desk is for are different actions and
   * are kept apart: one is a correction, the other throws away the watch terms,
   * the news scan and every reading keyed to them.
   */
  onChangePerson: () => void
  /**
   * Opens one of the tool screens. App owns the special cases — History is a
   * panel, not a tab — so this component only says which tool was asked for.
   */
  onOpenTool: (t: Tab) => void
  /**
   * Waiting counts for the tool rows: unacknowledged mentions, open tasks,
   * saved reports. Absent or zero shows no badge, because a number that is
   * always there is a number the eye learns to skip.
   */
  toolCounts?: Partial<Record<Tab, number>>
}) {
  const store = useStore()
  const identity = store.identity
  const reduced = useReducedMotion()
  /**
   * The pencil buttons arrive here with `?settings` in the URL; consume it so
   * a reload or a copied link does not force this screen open forever.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('settings')) window.history.replaceState(currentNavState(), '', window.location.pathname)
  }, [])

  return (
    <m.div
      className="shell shell-wide stack page-end"
      variants={listStagger}
      initial={reduced ? false : 'hidden'}
      animate="show"
    >
      <m.div variants={fadeUp}>
        <PageHeader
          title="Settings"
          subtitle="Your desk&rsquo;s tools, its configuration, and who it is for."
          actions={
            <Button variant="ghost" onClick={onClose}>
              Back
            </Button>
          }
        />
      </m.div>

      {/* ── Your desk's tools ─────────────────────────────────────────────
          First, because it is why most visits happen: these five screens left
          the main navigation when the owner asked for everything that is not
          a daily read to live under Settings, and this list is now their one
          unconditional route. It has to sit above the admin surface below or
          the person looking for Tasks reads a key prompt and concludes the
          screen is not for them. */}
      <m.section variants={fadeUp} aria-labelledby="tools-heading">
        <div className="mb-3">
          <h2 id="tools-heading" className="text-lg font-semibold tracking-[-0.011em]">
            Your desk&rsquo;s tools
          </h2>
        </div>
        <Card padded={false}>
          <ul className="divide-y divide-[var(--border)]">
            {TOOLS.map(({ id, blurb }) => {
              const { label, Icon } = NAV[id]
              const badge = badgeOf(toolCounts?.[id])
              return (
                <li key={id}>
                  <button
                    onClick={() => onOpenTool(id)}
                    // The badge is a bare number, folded into the name for
                    // readers the same way the nav rows do it. No unit: the
                    // caller decided what it counts.
                    aria-label={badge ? `${label}, ${badge}` : undefined}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"
                  >
                    <span
                      className="icon-badge icon-badge-sm shrink-0"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      <Icon size={16} strokeWidth={2} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {label}
                      </span>
                      <span className="block truncate text-xs text-ink-3">{blurb}</span>
                    </span>
                    {badge && (
                      <span
                        aria-hidden
                        className="tnum grid min-w-5 shrink-0 place-items-center rounded-full bg-[var(--accent)] px-1.5 text-2xs font-bold leading-5 text-[var(--accent-fg)]"
                      >
                        {badge}
                      </span>
                    )}
                    <ChevronRight size={15} className="shrink-0 text-ink-3" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      </m.section>

      {/* ── The desk's configuration ──────────────────────────────────────
          Closed boxes, name and count only, per the owner. Each pencil on a
          working screen lands here with its own section already open; a plain
          visit finds both shut. The bodies mount only when opened, so the
          store work behind them costs nothing until then. */}
      <m.section variants={fadeUp} aria-label="Desk configuration" className="space-y-3">
        <GrievanceDeskSection focus={focusSection === 'grievances'} />
        <InfluencerSection focus={focusSection === 'influencers'} />
      </m.section>

      {/* ── Who this desk is for ──────────────────────────────────────────
          Above the connected-accounts block deliberately. This is the setting
          people actually come here to change, it needs no key and no OAuth
          application, and burying it under an admin gate is what made the
          screen look like it had nothing on it. */}
      <m.section variants={fadeUp} aria-labelledby="identity-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 id="identity-heading" className="text-lg font-semibold tracking-[-0.011em]">
              Who this desk is for
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
              Tap any value to correct it.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onChangePerson}>
            <Search size={15} aria-hidden />
            Change person
          </Button>
        </div>

        {identity ? (
          <>
            <Card className="mb-3">
              <div className="flex items-start gap-4 sm:items-center">
                {/* The gradient ring the reference profile cards wear — a
                    surface gap between ring and photograph so it reads as a
                    ring, not a border. */}
                <span
                  className="grid shrink-0 place-items-center rounded-full p-[3px]"
                  style={{ background: 'var(--accent)' }}
                >
                  <span className="grid place-items-center rounded-full bg-[var(--surface)] p-[3px]">
                    <Avatar src={identity.photoUrl} name={identity.name} size={72} />
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="hed text-[1.4rem] leading-tight">{identity.name}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
                    {[identity.role, identity.constituency, identity.party]
                      .filter(Boolean)
                      .join(' · ') || 'No office or seat recorded yet.'}
                  </p>
                  {identity.sources.length > 0 && (
                    <p className="mt-2 text-xs text-ink-3">
                      Read from {identity.sources.map((src) => src.label).join(', ')}.
                    </p>
                  )}
                </div>
              </div>

              {/* The words the news scan actually searches on. Shown because a
                  scan that finds nothing is otherwise indistinguishable from a
                  quiet week, and the usual cause is a wrong seat here. */}
              {identity.watchTerms.length > 0 && (
                <div className="mt-4 border-t border-[var(--border)] pt-4">
                  <p className="kicker">The news scan searches for</p>
                  <ul className="mt-2.5 flex flex-wrap gap-1.5">
                    {identity.watchTerms.map((term) => (
                      <li key={term}>
                        <Chip tone="accent">{term}</Chip>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            <Card padded={false}>
              <IdentityRows
                identity={identity}
                onEdit={(field, next) => saveIdentity(editField(identity, field, next))}
              />
            </Card>
          </>
        ) : (
          <Card>
            <p className="text-sm leading-relaxed text-ink-2">No person set yet.</p>
            <Button size="sm" className="mt-3" onClick={onChangePerson}>
              <Search size={15} aria-hidden />
              Set that up
            </Button>
          </Card>
        )}
      </m.section>

      {/* ── Your account ──────────────────────────────────────────────────
          Last, and its own section. Changing a password is a rare, deliberate
          act; putting it above the desk's tools would greet every visit with
          a security form. It was behind a padlock icon in the header, which is
          where nobody looks for it — Settings is where a person goes when they
          think "I want to change my password". Renders nothing on a
          handed-over desk, whose password belongs to the office that issued
          it. */}
      <m.section variants={fadeUp} aria-labelledby="account-heading">
        <div className="mb-3">
          <h2 id="account-heading" className="text-lg font-semibold tracking-[-0.011em]">
            Your account
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">
            The password that encrypts this desk&rsquo;s records on this device, and the backup that
            is their only other copy.
          </p>
        </div>
        <AccountSection />
      </m.section>
    </m.div>
  )
}
