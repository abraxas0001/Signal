import { ArrowLeft } from 'lucide-react'
import * as m from 'motion/react-m'
import { fadeUp } from '@/lib/motion'

/**
 * THE WAY OUT OF A REPORT, AT THE TOP WHERE A READER LOOKS FOR IT.
 *
 * A full report is the deepest screen in this product and it had no back
 * control at all. The only exit was a docked button at the very bottom reading
 * "Read another post", which is an invitation to start something new rather
 * than a way back to what you were reading — so the office opened a post from
 * the dashboard's tables and, in their words, found the back button missing.
 *
 * The label names the destination rather than saying a bare "Back", because
 * this screen is reached from five different places and "back to where" is the
 * question a reader actually has. Where the caller cannot say, it falls back to
 * the honest generic.
 */
export function BackBar({ label, onBack }: { label?: string | null; onBack: () => void }) {
  return (
    <m.div variants={fadeUp} className="-mb-1">
      <button
        type="button"
        onClick={onBack}
        className={
          'inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-md)] px-2 -ml-2 ' +
          'text-[13px] font-semibold text-ink-2 transition-colors hover:bg-[var(--surface-2)] hover:text-ink'
        }
      >
        <ArrowLeft size={16} aria-hidden />
        {label ? `Back to ${label}` : 'Back'}
      </button>
    </m.div>
  )
}
