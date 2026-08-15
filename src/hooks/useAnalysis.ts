import { useCallback, useRef, useState } from 'react'
import type {
  AnalyseRequest,
  PipelineStage,
  PostSnapshot,
  Report,
  StreamEvent,
} from '@shared/types'

export type StageState = 'pending' | 'active' | 'done' | 'skipped'

export interface StageView {
  stage: PipelineStage
  label: string
  /** Verb-first, second-person, present-continuous — never "Processing…". */
  activeLabel: string
  state: StageState
  detail?: string
  /** Share of total progress. Weighted, because the stages are not equal. */
  weight: number
}

/**
 * Stage weights reflect measured reality, not equal thirds: the model call is
 * most of the wall clock, so a linear bar would sit at 40% for twenty seconds.
 */
const STAGES: Array<Omit<StageView, 'state' | 'detail'>> = [
  { stage: 'resolve', label: 'Link', activeLabel: 'Working out where this is from', weight: 0.05 },
  { stage: 'fetch', label: 'Post', activeLabel: 'Fetching the post', weight: 0.18 },
  { stage: 'read', label: 'Content', activeLabel: 'Reading what it says', weight: 0.07 },
  { stage: 'translate', label: 'Language', activeLabel: 'Translating', weight: 0.1 },
  { stage: 'analyse', label: 'Meaning', activeLabel: 'Working out what it means', weight: 0.35 },
  { stage: 'assess', label: 'Risk', activeLabel: 'Weighing impact and credibility', weight: 0.18 },
  { stage: 'compose', label: 'Report', activeLabel: 'Writing it up', weight: 0.07 },
]

export interface AnalysisState {
  status: 'idle' | 'running' | 'done' | 'error'
  stages: StageView[]
  /** 0…1, weighted and eased so it slows but never stalls or reverses. */
  progress: number
  snapshot: PostSnapshot | null
  report: Report | null
  error: string | null
  recoverable: { reason: string; suggestion: string } | null
  /** Seconds elapsed, for the overrun grace message. */
  elapsed: number
}

const initial: AnalysisState = {
  status: 'idle',
  stages: STAGES.map((s) => ({ ...s, state: 'pending' })),
  progress: 0,
  snapshot: null,
  report: null,
  error: null,
  recoverable: null,
  elapsed: 0,
}

/**
 * Turn an HTTP status into something the reader can act on.
 *
 * "The server responded with 404" is true and useless. A 404 on this endpoint
 * means one specific thing — the serverless function is not deployed — and
 * that is worth saying, because it is the most likely first-deploy mistake.
 */
function explainStatus(status: number): string {
  switch (status) {
    case 404:
      return 'The analysis service is not responding. If this is a fresh deploy, the serverless function may not have been published yet.'
    case 401:
    case 403:
      return 'The analysis service rejected the request. The API key may be missing or invalid.'
    case 413:
      return 'That was too large to send. Try a smaller screenshot.'
    case 429:
      return 'Too many requests just now. Wait a moment and try again.'
    case 500:
    case 502:
    case 503:
      return 'The analysis service hit an error. Trying again usually works.'
    case 504:
      return 'The analysis took too long and timed out. Long videos and very long articles are the usual cause.'
    default:
      return `The analysis service returned an unexpected response (${status}).`
  }
}

export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>(initial)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    if (timerRef.current) clearInterval(timerRef.current)
    setState(initial)
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    if (timerRef.current) clearInterval(timerRef.current)
    setState((s) => ({ ...s, status: 'idle' }))
  }, [])

  const run = useCallback(async (request: AnalyseRequest) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const startedAt = Date.now()
    if (timerRef.current) clearInterval(timerRef.current)

    // Held locally as well as in the ref: when a second run starts before the
    // first finishes, the first run's `finally` would otherwise clear whatever
    // is in the ref — which by then is the *new* run's timer, freezing its
    // elapsed counter at zero for the rest of the analysis.
    const timer = setInterval(() => {
      setState((s) =>
        s.status === 'running' ? { ...s, elapsed: Math.round((Date.now() - startedAt) / 1000) } : s,
      )
    }, 1000)
    timerRef.current = timer

    setState({
      ...initial,
      status: 'running',
      stages: STAGES.map((s, i) => ({ ...s, state: i === 0 ? 'active' : 'pending' })),
    })

    /**
     * Exactly one stage is ever active.
     *
     * The server does not always announce stages in strict order — it may skip
     * `translate` entirely and start `analyse`, or finish a stage after a later
     * one has begun. So anything *before* the stage being reported is closed
     * out whether it was pending or still active, and the active flag is
     * asserted at the end rather than assumed.
     */
    const applyStage = (stage: PipelineStage, status: 'start' | 'done' | 'skip', detail?: string) =>
      setState((s) => {
        const idx = s.stages.findIndex((x) => x.stage === stage)
        if (idx === -1) return s

        const stages: StageView[] = s.stages.map((x, i) => {
          if (i < idx) {
            // Everything earlier is finished by definition — including a stage
            // still marked active, which is what produced two live rows.
            return x.state === 'pending' || x.state === 'active'
              ? { ...x, state: 'done' as StageState }
              : x
          }
          if (i > idx) return x
          if (status === 'start') return { ...x, state: 'active' as StageState, detail }
          return {
            ...x,
            state: (status === 'skip' ? 'skipped' : 'done') as StageState,
            detail: detail ?? x.detail,
          }
        })

        // Promote the next pending stage when nothing is live, so the stepper
        // never stalls with every row idle.
        if (!stages.some((x) => x.state === 'active')) {
          const next = stages.findIndex((x) => x.state === 'pending')
          if (next !== -1) stages[next] = { ...stages[next]!, state: 'active' }
        }

        // Defensive: if anything above ever leaves two live, keep the last.
        const live = stages.reduce<number[]>((acc, x, i) => (x.state === 'active' ? [...acc, i] : acc), [])
        if (live.length > 1) {
          for (const i of live.slice(0, -1)) {
            stages[i] = { ...stages[i]!, state: 'done' }
          }
        }

        const done = stages
          .filter((x) => x.state === 'done' || x.state === 'skipped')
          .reduce((a, x) => a + x.weight, 0)
        const active = stages.find((x) => x.state === 'active')
        // Credit part of the in-flight stage so the bar keeps moving.
        const progress = Math.min(0.98, done + (active ? active.weight * 0.45 : 0))

        return { ...s, stages, progress: Math.max(s.progress, progress) }
      })

    try {
      const res = await fetch('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        // A non-streaming error response is JSON, not SSE. Prefer the server's
        // own message; otherwise translate the status into something that tells
        // the reader what to actually do about it.
        let message = explainStatus(res.status)
        try {
          const j = (await res.json()) as { error?: string }
          if (j.error) message = j.error
        } catch {
          /* no JSON body — the status-based explanation stands */
        }
        throw new Error(message)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE frames are separated by a blank line.
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''

        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data:'))
          if (!line) continue // a `: ping` heartbeat

          let event: StreamEvent
          try {
            event = JSON.parse(line.slice(5).trim()) as StreamEvent
          } catch {
            continue
          }

          switch (event.type) {
            case 'stage':
              applyStage(event.stage, event.status, event.detail)
              break
            case 'snapshot':
              setState((s) => ({ ...s, snapshot: event.snapshot }))
              break
            case 'report':
              setState((s) => ({
                ...s,
                report: event.report,
                snapshot: event.report.snapshot,
                progress: 1,
                status: 'done',
                stages: s.stages.map((x) =>
                  x.state === 'pending' || x.state === 'active' ? { ...x, state: 'done' } : x,
                ),
              }))
              break
            case 'error':
              setState((s) => ({
                ...s,
                status: 'error',
                error: event.message,
                recoverable: event.recoverable ?? null,
              }))
              break
            case 'partial':
              // Section markers already drive the stepper; nothing to render.
              break
          }
        }
      }

      // The stream ended without a report or an explicit error.
      //
      // On the deployed site this happens when the function hits its execution
      // limit: the connection is dropped mid-stream, with no error frame. But
      // by then the snapshot has almost always arrived — the platform fetch
      // finishes in about two seconds, and it is the model that runs long.
      //
      // Discarding it to show "analysis failed" was the single most misleading
      // thing this app did: it reported a failure to extract over an extraction
      // that had already succeeded, and threw away counts the user could have
      // exported. Keep them, and say plainly which half is missing.
      setState((s) => {
        if (s.status !== 'running') return s
        if (!s.snapshot) {
          return { ...s, status: 'error', error: 'The analysis stopped before it finished.' }
        }
        return {
          ...s,
          status: 'done',
          progress: 1,
          stages: s.stages.map((x) =>
            x.state === 'pending' || x.state === 'active'
              ? { ...x, state: 'skipped' as StageState }
              : x,
          ),
          report: {
            id: `rep_local_${Date.now().toString(36)}`,
            createdAt: new Date().toISOString(),
            snapshot: s.snapshot,
            analysis: null,
            meta: {
              model: null,
              durationMs: 0,
              heuristicOnly: false,
              incomplete:
                'The figures below were measured from the post. The written analysis did not finish in time, so it is left out rather than guessed at — you can run it again for the interpretation.',
            },
          },
        }
      })
    } catch (err) {
      if (controller.signal.aborted) return
      setState((s) => ({
        ...s,
        status: 'error',
        error:
          err instanceof Error
            ? err.message
            : 'Could not reach the analysis service. Check your connection.',
      }))
    } finally {
      clearInterval(timer)
      // Only clear the shared ref if it is still ours.
      if (timerRef.current === timer) timerRef.current = null
    }
  }, [])

  return { state, run, reset, cancel }
}
