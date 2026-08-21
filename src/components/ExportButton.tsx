import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'

/**
 * The export control, in one place.
 *
 * There were four of these, each written out by hand, and every one of them had
 * the same three faults:
 *
 *   · `onClick={() => void downloadWorkbook(...)}` — the `void` discards the
 *     promise, so a build that threw produced an unhandled rejection in the
 *     console and *nothing at all* on screen. From the office's side the button
 *     was dead, which is exactly how it was reported.
 *   · The label said CSV and the file was `.xlsx`. Not a naming quibble: a
 *     member opening it on a phone with no spreadsheet app gets a file that
 *     will not open, having been told it was the format that always does.
 *   · No sign that anything was happening. Packing a few hundred rows and
 *     deflating them takes a moment, and a button that does not react to a
 *     press gets pressed again.
 *
 * So: one component, which reports what it is producing, says when it fails,
 * and offers the flat file next to the workbook rather than instead of it.
 */

export type ExportFormat = 'xlsx' | 'csv'

const FORMAT_LABEL: Record<ExportFormat, string> = {
  xlsx: 'Excel',
  csv: 'CSV',
}

export interface ExportButtonProps {
  /**
   * Build and save the file. Allowed to throw or reject — that is the point of
   * routing every export through here.
   */
  run: (format: ExportFormat) => void | Promise<void>
  /** Rows being exported. Zero disables the control and says so. */
  count: number
  /** What one row is: "record", "post", "issue". Pluralised with an s. */
  noun: string
  /**
   * Which formats to offer, in order. The first is the primary button.
   *
   * CSV alone by default. The workbook was offered beside it and was the
   * louder of the two, which put the format that needs a spreadsheet app in
   * front of the one that opens anywhere — including on the phone this desk is
   * mostly read on. `xlsx` is still supported for any caller that asks for it
   * explicitly; nothing offers it today.
   */
  formats?: readonly ExportFormat[]
  size?: 'sm' | 'md'
  className?: string
}

export function ExportButton({
  run,
  count,
  noun,
  formats = ['csv'],
  size = 'sm',
  className,
}: ExportButtonProps) {
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [done, setDone] = useState<ExportFormat | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A press that resolves after the screen has moved on must not call setState.
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const clear = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (clear.current) clearTimeout(clear.current)
    },
    [],
  )

  const press = useCallback(
    async (format: ExportFormat) => {
      setBusy(format)
      setError(null)
      setDone(null)
      try {
        await run(format)
        if (!live.current) return
        setDone(format)
        // Long enough to be read, short enough that the button is ready again
        // before somebody wants a second copy.
        clear.current = setTimeout(() => {
          if (live.current) setDone(null)
        }, 2400)
      } catch (cause) {
        if (!live.current) return
        // The message rather than a generic line: when this does fail it is
        // almost always one specific missing field, and the person who can fix
        // it is the one reading the screen.
        const detail = cause instanceof Error ? cause.message : String(cause)
        setError(`Could not build the file: ${detail}`)
      } finally {
        if (live.current) setBusy(null)
      }
    },
    [run],
  )

  const empty = count === 0
  const rows = `${count} ${noun}${count === 1 ? '' : 's'}`

  return (
    <div className={cn('flex flex-col items-start gap-1.5', className)}>
      <div className="flex items-center gap-2">
        {formats.map((format, i) => (
          <Button
            key={format}
            size={size}
            variant={i === 0 ? 'outline' : 'ghost'}
            disabled={empty || busy !== null}
            onClick={() => void press(format)}
            // Says the format and the size, because "CSV" alone told the reader
            // neither what they would get nor whether it would contain anything.
            title={
              empty
                ? `Nothing to export yet. There are no ${noun}s on screen.`
                : `Download ${rows} as a ${FORMAT_LABEL[format]} file`
            }
            aria-label={`Download ${rows} as ${FORMAT_LABEL[format]}`}
          >
            {busy === format ? (
              <Loader2 size={14} className="animate-spin" />
            ) : done === format ? (
              <Check size={14} className="text-[var(--pos)]" />
            ) : (
              <Download size={14} />
            )}
            {busy === format ? 'Building…' : done === format ? 'Saved' : FORMAT_LABEL[format]}
          </Button>
        ))}
      </div>

      {error && (
        <p role="alert" className="max-w-[36ch] text-xs leading-relaxed text-[var(--neg)]">
          {error}
        </p>
      )}
    </div>
  )
}
