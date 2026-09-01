import * as m from 'motion/react-m'
import { Languages, ListChecks, ScanText } from 'lucide-react'
import { HeroPreview } from '@/components/HeroPreview'
import { SignalGlyph } from '@/components/ui'
import { fadeUp, listStagger } from '@/lib/motion'

/**
 * The half of the entrance that answers "what is this".
 *
 * The door used to be a padlock, a heading and a password box. That is a
 * correct screen for somebody who already has an account and a wrong one for
 * everybody else, and everybody else is who a create-account button is for.
 * A person deciding whether to sign up is owed the pitch on the same screen as
 * the form, not behind a demo button three controls down.
 *
 * Every claim here is one the product actually makes, taken from what the
 * report schema returns rather than invented for the page: the verdict and the
 * preserved quotes, the original script with a translation beside it, and the
 * grievance fields an office acts on. A landing page that oversells is found
 * out on the first real post.
 *
 * IT HAS TO FIT. This column was 975px against a 596px card, so the login
 * screen — the one screen in the product that must be readable in a single
 * glance — opened already scrolled. A sign-in form below the fold is a sign-in
 * form some people never find. So the pitch is written to a height budget now,
 * not to whatever the copy happened to need:
 *
 *   • each proof point is one sentence on two lines, not a heading over a
 *     paragraph — the headings were doing no work the bold lead-in cannot;
 *   • the specimen stands down under `.pitch-specimen` on a short window,
 *     because it is the one part of this column that is a bonus rather than
 *     the point, and it is exactly what pushes the card off the screen.
 */

const PROOF = [
  {
    icon: ScanText,
    title: 'Read, not just scored',
    line: 'a verdict, the claims separated out, quotes kept word for word, and the sentiment with its reason.',
  },
  {
    icon: Languages,
    title: 'In the language it was written',
    line: 'Telugu and Hindi stay in script with English alongside, and allegations are never paraphrased.',
  },
  {
    icon: ListChecks,
    title: 'Grievances become work',
    line: 'what kind, how severe, who it targets, the action to take, and talking points to say out loud.',
  },
] as const

export function EntryPitch({ onDemo }: { onDemo?: () => void }) {
  return (
    <m.div variants={listStagger} initial="hidden" animate="show" className="min-w-0">
      {/* Hidden on phones, where the entry screen carries its own compact
          masthead above the card — the form has to be the first thing on a
          375px screen, and two wordmarks would push it further down. */}
      <m.div variants={fadeUp} className="hidden items-center gap-2.5 lg:flex">
        <span
          className="grid size-9 place-items-center rounded-xl text-[var(--accent-fg)] shadow-[var(--e2)]"
          style={{
            background:
              'linear-gradient(140deg, var(--accent) 0%, color-mix(in oklab, var(--accent) 74%, var(--aurora-2)) 100%)',
          }}
        >
          <SignalGlyph size={17} />
        </span>
        <span className="hed text-lg leading-none">Signal</span>
      </m.div>

      <m.h1
        variants={fadeUp}
        className="hed mt-0 text-[clamp(1.75rem,1.15rem+1.8vw,2.4rem)] leading-[1.08] lg:mt-5"
      >
        Know what is being said,
        <br className="hidden sm:block" /> and <span className="marked">what to say back</span>.
      </m.h1>

      <m.p variants={fadeUp} className="mt-3 max-w-[50ch] text-[15px] leading-relaxed text-ink-2">
        Paste a link to any public post — YouTube, X, Facebook, Instagram, LinkedIn, Reddit and
        more. Signal reads it and hands back what it means, how it landed, and what to do about it.
      </m.p>

      {/* One sentence each, bold lead-in rather than a heading over a
          paragraph. The headings read as structure the eye had to parse before
          it reached the claim, and cost 180px for the privilege. */}
      <m.ul variants={fadeUp} className="mt-5 space-y-3 border-t border-[var(--rule)] pt-4">
        {PROOF.map(({ icon: Icon, title, line }) => (
          <li key={title} className="flex items-start gap-3">
            <span className="mt-px grid size-7 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
              <Icon size={14} strokeWidth={2.2} aria-hidden />
            </span>
            <p className="min-w-0 max-w-[54ch] text-sm leading-[1.55] text-ink-2">
              <span className="font-semibold text-ink">{title}</span> &mdash; {line}
            </p>
          </li>
        ))}
      </m.ul>

      {/* Only when there is somewhere for it to go. Its footer reads "See the
          full report", and a card that says that and does nothing is worse
          than no card — so on the padlock's panel, where the demo is already
          open behind it, the specimen is simply absent. */}
      {onDemo !== undefined && (
        <m.div variants={fadeUp} className="pitch-specimen mt-6 max-w-[24rem]">
          <HeroPreview onOpen={onDemo} />
        </m.div>
      )}
    </m.div>
  )
}
