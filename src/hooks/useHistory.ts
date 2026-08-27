import { useCallback, useEffect, useState } from 'react'
import type { Report } from '@shared/types'
import { scopedKey, subscribe } from '@/lib/store'

/**
 * Scoped per signed-in account. See scopedKey in lib/store.
 *
 * A read history is a list of exactly which posts and stories somebody chose to
 * look at, which is as revealing as the records themselves — it was shared
 * across every account on the device.
 */
const KEY = (): string => scopedKey('signal:history:v1')
const LIMIT = 30

export interface HistoryEntry {
  id: string
  createdAt: string
  url: string
  platform: string
  headline: string
  sentiment: string
  author: string | null
  thumbnail: string | null
  report: Report
}

/**
 * History lives in localStorage, never on a server.
 *
 * These are political reports about named officials in a live constituency —
 * keeping them on the device means a lost phone is the worst case, not a
 * breached database. It also means the product needs no accounts, no login,
 * and no privacy policy beyond one sentence.
 */
export function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])

  /**
   * Re-read whenever the store changes namespace.
   *
   * This was a one-shot read at mount, and the hook is mounted once at App
   * level and never remounted. `write` resolves `KEY()` at call time, so the
   * two disagreed the moment anyone signed in, signed out or opened the
   * example desk: the list in memory still held the PREVIOUS scope's reports,
   * and the next write filed all of them under the new scope's key. Opening
   * the demo from the nav would have copied an office's real analysed reports
   * into an unencrypted, passphrase-free namespace that is deliberately never
   * wiped. It also left the sidebar's History badge counting the last desk's
   * entries.
   *
   * Compared by key rather than re-read on every emit: the store emits on
   * every write, and re-parsing thirty reports each time buys nothing.
   */
  useEffect(() => {
    let key = KEY()
    setEntries(read())
    return subscribe(() => {
      const next = KEY()
      if (next === key) return
      key = next
      setEntries(read())
    })
  }, [])

  const add = useCallback((report: Report) => {
    const entry: HistoryEntry = {
      id: report.id,
      createdAt: report.createdAt,
      url: report.snapshot.canonicalUrl,
      platform: report.snapshot.platform,
      // A data-only report has no headline of its own, so the history row
      // shows what it does have: the post's own first line.
      headline:
        report.analysis?.headline ??
        firstLine(report.snapshot.content.title ?? report.snapshot.content.text) ??
        report.snapshot.canonicalUrl,
      sentiment: report.analysis?.sentiment.label ?? '',
      author: report.snapshot.author.name,
      thumbnail: report.snapshot.media[0]?.thumbnailUrl ?? null,
      report,
    }

    setEntries((prev) => {
      // Re-analysing the same URL replaces the old entry rather than stacking.
      const next = [entry, ...prev.filter((e) => e.url !== entry.url)].slice(0, LIMIT)
      write(next)
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.id !== id)
      write(next)
      return next
    })
  }, [])

  const clear = useCallback(() => {
    setEntries([])
    write([])
  }, [])

  return { entries, add, remove, clear }
}

function read(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY())
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : []
  } catch {
    return []
  }
}

function write(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(KEY(), JSON.stringify(entries))
  } catch {
    // Quota exceeded — drop the oldest half rather than losing everything.
    try {
      localStorage.setItem(KEY(), JSON.stringify(entries.slice(0, Math.floor(entries.length / 2))))
    } catch {
      /* storage is unavailable entirely; history is a convenience, not a feature */
    }
  }
}

/** The post's opening line, trimmed to something that fits a history row. */
function firstLine(text: string | null | undefined): string | null {
  const line = (text ?? '').split('\n').map((s) => s.trim()).find(Boolean)
  if (!line) return null
  return line.length > 90 ? `${line.slice(0, 90).trimEnd()}…` : line
}
