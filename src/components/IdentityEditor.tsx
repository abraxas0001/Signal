import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import type { Identity, IdentityField } from '@shared/identity'
import { Chip } from './ui'
import { cn } from '@/lib/utils'

/**
 * The identity card's fields, editable in place.
 *
 * Lifted out of the setup screen because Settings needed the same thing, and
 * two copies of "how a person corrects what we read about them" is two copies
 * that disagree about which fields exist. It is the one surface where the app
 * is wrong in a way the reader can actually fix, so it has to behave identically
 * wherever it appears.
 *
 * Click-to-edit rather than a form of permanently-open inputs: seven open text
 * fields read as a data-entry task to be completed, and the overwhelmingly
 * common case is that six values are right and one is wrong.
 */

/** The rows, in the order a person reads them. One definition, used twice. */
export const IDENTITY_ROWS: {
  field: IdentityField
  label: string
  placeholder: string
  /** Pulls the display string out of an identity. */
  read: (i: Identity) => string | null
}[] = [
  { field: 'name', label: 'Name', placeholder: 'Full name', read: (i) => i.name },
  { field: 'role', label: 'Office held', placeholder: 'e.g. MLA', read: (i) => i.role },
  { field: 'party', label: 'Party', placeholder: 'Not known', read: (i) => i.party },
  {
    field: 'constituency',
    label: 'Constituency',
    placeholder: 'Not known',
    read: (i) => i.constituency,
  },
  { field: 'district', label: 'District', placeholder: 'Not known', read: (i) => i.district },
  { field: 'state', label: 'State', placeholder: 'Not known', read: (i) => i.state },
  {
    field: 'age',
    label: 'Age',
    placeholder: 'Not known',
    read: (i) => (i.age === null ? null : String(i.age)),
  },
  {
    field: 'inOfficeSince',
    label: 'In office since',
    placeholder: 'Not known',
    read: (i) => i.inOfficeSince,
  },
  { field: 'education', label: 'Education', placeholder: 'Not known', read: (i) => i.education },
]

export function IdentityRows({
  identity,
  onEdit,
  className,
}: {
  identity: Identity
  onEdit: (field: IdentityField, value: string | null) => void
  className?: string
}) {
  return (
    <div className={cn('divide-y divide-[var(--border)]', className)}>
      {IDENTITY_ROWS.map((row) => (
        <EditableRow
          key={row.field}
          label={row.label}
          value={row.read(identity)}
          placeholder={row.placeholder}
          // A value the reading was unsure of, marked where it can be fixed.
          // Carrying a low-confidence constituency silently is how every news
          // scan afterwards quietly searches the wrong seat.
          unconfirmed={row.read(identity) !== null && identity.confidence[row.field] === 'low'}
          stated={identity.origin[row.field] === 'stated'}
          onCommit={(next) => onEdit(row.field, next)}
        />
      ))}
    </div>
  )
}

function EditableRow({
  label,
  value,
  placeholder,
  unconfirmed,
  stated,
  onCommit,
}: {
  label: string
  value: string | null
  placeholder: string
  unconfirmed: boolean
  stated: boolean
  onCommit: (next: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [buffer, setBuffer] = useState(value ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  // The row is also re-rendered when the identity changes underneath it — a
  // re-lookup, or an edit to a different row. Without this the buffer keeps
  // whatever was typed into a previous incarnation of the row.
  useEffect(() => {
    if (!editing) setBuffer(value ?? '')
  }, [value, editing])

  const commit = (): void => {
    setEditing(false)
    const next = buffer.trim() || null
    if (next !== value) onCommit(next)
  }

  return (
    // The row itself is the hover surface: a quiet tint under the pointer and
    // a pencil that answers to it, so "you can edit this" survives on a phone
    // where there is no hover at all — the pencil is always drawn.
    <div className="group flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-[var(--surface-2)]">
      <span className="w-28 shrink-0 text-xs font-medium uppercase tracking-[0.08em] text-ink-3 sm:w-36">
        {label}
      </span>

      {editing ? (
        <input
          ref={inputRef}
          value={buffer}
          onChange={(e) => setBuffer(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setBuffer(value ?? '')
              setEditing(false)
            }
          }}
          placeholder={placeholder}
          className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-[var(--accent)] bg-[var(--surface)] px-3 py-1 text-[15px] shadow-[var(--e1)] outline-none"
        />
      ) : (
        <button
          onClick={() => {
            setBuffer(value ?? '')
            setEditing(true)
          }}
          className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 text-left"
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[15px]',
              value ? 'text-ink' : 'italic text-ink-3',
            )}
          >
            {value ?? placeholder}
          </span>

          {unconfirmed && (
            <Chip tone="warning" className="shrink-0">
              check
            </Chip>
          )}
          {stated && value && (
            <Chip tone="neutral" className="shrink-0">
              yours
            </Chip>
          )}
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-ink-3 transition-colors group-hover:border-[var(--border-interactive)] group-hover:text-[var(--accent)]"
          >
            <Pencil size={12} />
          </span>
        </button>
      )}
    </div>
  )
}
