import { useCallback, useEffect, useRef, useState } from 'react'
import { readStore, update, useStore } from '@/lib/store'

/**
 * The client half of "what is being said about you".
 *
 * Cached in the store rather than fetched per visit. The underlying call is a
 * grounded web search plus a structuring pass — around thirty seconds and real
 * money — and what has been published about a member does not change between
 * two taps of a tab. It refreshes daily, or when the office asks.
 */

export interface OpinionTheme {
  label: string
  detail: string
  weight: 'dominant' | 'frequent' | 'occasional'
  who: string | null
}

export interface OpinionSurvey {
  score: number | null
  verdict: string
  praise: OpinionTheme[]
  criticism: OpinionTheme[]
  controversies: OpinionTheme[]
  sources: { title: string; url: string | null }[]
  confidence: 'thin' | 'moderate' | 'well-covered'
  caveats: string[]
  searched: boolean
  /** When this reading was taken. Added client-side. */
  readAt?: string
}

/** A day. Published coverage does not turn over faster than this. */
const FRESH_MS = 24 * 60 * 60 * 1000

export function useOpinion(): {
  survey: OpinionSurvey | null
  busy: boolean
  stage: 'searching' | 'reading' | null
  error: string | null
  refresh: () => void
} {
  const store = useStore()
  const [busy, setBusy] = useState(false)
  /** Which half is running, so the wait can be explained rather than endured. */
  const [stage, setStage] = useState<'searching' | 'reading' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const running = useRef(false)

  const survey = store.opinion ?? null
  const identity = store.identity

  const run = useCallback((force = false) => {
    if (running.current) return
    const current = readStore()
    const person = current.identity
    if (!person) return

    const at = current.opinion?.readAt ? Date.parse(current.opinion.readAt) : 0
    if (!force && Number.isFinite(at) && Date.now() - at < FRESH_MS) return

    running.current = true
    setBusy(true)
    setError(null)

    void (async () => {
      try {
        /*
          Two calls, because one is too slow to survive.

          The runtime kills a function at thirty seconds and a grounded search
          followed by a structuring pass runs past it — the single-call version
          did all the work and then returned nothing at all. Split, each half is
          comfortable, and the reader gets told which half is running instead of
          watching one unexplained spinner for half a minute.
        */
        setStage('searching')
        const searchRes = await fetch('/api/opinion', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            step: 'search',
            name: person.name,
            role: person.role,
            constituency: person.constituency,
            state: person.state,
            party: person.party,
          }),
        })
        const search = (await searchRes.json().catch(() => null)) as
          | { notes?: string | null; sources?: unknown[]; error?: string }
          | null

        if (!searchRes.ok || !search?.notes) {
          setError(search?.error ?? 'The web search did not return anything usable.')
          return
        }

        setStage('reading')
        const structRes = await fetch('/api/opinion', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            step: 'structure',
            notes: search.notes,
            sources: search.sources ?? [],
          }),
        })
        const payload = (await structRes.json().catch(() => null)) as
          | (OpinionSurvey & { error?: string })
          | null

        if (!structRes.ok || !payload || payload.error) {
          setError(payload?.error ?? 'The research could not be structured.')
          return
        }

        update((prev) => ({
          ...prev,
          opinion: { ...payload, readAt: new Date().toISOString() },
        }))
      } catch {
        setError('Could not reach the server.')
      } finally {
        running.current = false
        setBusy(false)
        setStage(null)
      }
    })()
  }, [])

  useEffect(() => {
    if (identity) run()
  }, [identity, run])

  return { survey, busy, stage, error, refresh: () => run(true) }
}
