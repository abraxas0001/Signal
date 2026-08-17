import { useCallback, useEffect, useState } from 'react'
import { LazyMotion, domAnimation, AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { Clock, Moon, RefreshCw, Sun, TriangleAlert } from 'lucide-react'
// `Report` must be imported explicitly: the DOM lib declares a global `Report`
// (the Reporting API), which otherwise shadows ours and produces a baffling
// "Type 'Report' is not assignable to type 'Report'".
import type { AnalyseRequest, Report } from '@shared/types'
import { useAnalysis } from '@/hooks/useAnalysis'
import { useHistory } from '@/hooks/useHistory'
import { Hero } from '@/components/Hero'
import { Pipeline } from '@/components/Pipeline'
import { ReportView } from '@/components/report/ReportView'
import { RescueSheet } from '@/components/RescueSheet'
import { HistoryPanel } from '@/components/HistoryPanel'
import { Dashboard } from '@/components/Dashboard'
import { Overview } from '@/components/Overview'
import { TabBar, type Tab } from '@/components/TabBar'
import { Button, Card, SignalGlyph} from '@/components/ui'
import { applyDeviceClass, ease, haptic, pageIn } from '@/lib/motion'

/**
 * Two states, not three.
 *
 * The old cycle was system → dark → light → system, which meant that for a
 * viewer whose OS is dark, the first tap moved from "system" to "dark" and
 * changed nothing on screen. The control looked broken and took two taps to
 * do anything. A toggle should toggle.
 */
type Theme = 'light' | 'dark'

export default function App() {
  const { state, run, reset, cancel } = useAnalysis()
  const history = useHistory()

  const [theme, setTheme] = useState<Theme>('light')
  const [rescueOpen, setRescueOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('dashboard')
  const [lastRequest, setLastRequest] = useState<AnalyseRequest | null>(null)

  const [demo, setDemo] = useState<Report | null>(null)

  // Gate the expensive visual layers once, at boot.
  useEffect(() => {
    applyDeviceClass()
    // theme.js has already written the attribute before first paint; read it
    // back so React's state and the DOM agree from the start.
    const saved = localStorage.getItem('signal:theme')
    if (saved === 'light' || saved === 'dark') setTheme(saved)

    // ?demo=1 renders a worked example. Useful before an API key is set up,
    // and it makes the report screen reachable without a live analysis.
    if (new URLSearchParams(window.location.search).has('demo')) {
      void import('@/lib/demo').then((m) => setDemo(m.DEMO_REPORT))
    }
  }, [])

  useEffect(() => {
    // Always explicit, so the stylesheet's prefers-color-scheme branch can
    // never contradict the user's choice.
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('signal:theme', theme)
    } catch {
      /* private mode */
    }
  }, [theme])

  // Persist each finished report to on-device history.
  useEffect(() => {
    if (state.status === 'done' && state.report) history.add(state.report)
    // history.add is stable; depending on the whole object would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.report])

  // Offer the rescue sheet the moment a run fails recoverably.
  useEffect(() => {
    if (state.status === 'error' && state.recoverable) setRescueOpen(true)
  }, [state.status, state.recoverable])

  const start = useCallback(
    (url: string) => {
      const req: AnalyseRequest = { url }
      setLastRequest(req)
      void run(req)
    },
    [run],
  )

  const retryWith = useCallback(
    (patch: Partial<AnalyseRequest>) => {
      if (!lastRequest) return
      const req = { ...lastRequest, ...patch }
      setLastRequest(req)
      setRescueOpen(false)
      void run(req)
    },
    [lastRequest, run],
  )

  const startOver = useCallback(() => {
    reset()
    setLastRequest(null)
    // Clearing the demo is what actually returns you home: without it, tapping
    // the wordmark reset the analysis state while the worked example stayed on
    // screen, so the control looked dead.
    setDemo(null)
    setRescueOpen(false)
    setHistoryOpen(false)
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname)
    }
    haptic.tap()
    window.scrollTo({ top: 0 })
  }, [reset])

  const toggleTheme = () => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
    haptic.tap()
  }

  return (
    <LazyMotion features={domAnimation} strict>
      <div className="relative min-h-screen-safe overflow-x-hidden">
        {/* Ambient colour. Three blobs drifting on transform only, so the
            compositor moves rasterised textures and never repaints. */}
        <div className="field" aria-hidden>
          <span />
          <span />
          <span />
        </div>

        <header className="relative z-10 mx-auto flex w-full max-w-2xl items-center justify-between gap-2 px-4 safe-t no-print">
          <button
            onClick={startOver}
            className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]"
          >
            <span
              className="grid size-8 place-items-center rounded-[10px] text-[var(--accent-fg)] shadow-[var(--e1)]"
              style={{
                background:
                  'linear-gradient(140deg, var(--accent) 0%, color-mix(in oklab, var(--accent) 74%, var(--aurora-2)) 100%)',
              }}
            >
              <SignalGlyph />
            </span>
            <span className="tracking-[-0.03em]">Signal</span>
          </button>

          <div className="flex items-center gap-1">
            {history.entries.length > 0 && (
              <button
                onClick={() => setHistoryOpen(true)}
                aria-label="History"
                className="relative grid size-11 place-items-center rounded-full text-ink-2 hover:bg-[var(--surface-2)]"
              >
                <Clock size={18} />
                <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-semibold text-[var(--accent-fg)]">
                  {history.entries.length}
                </span>
              </button>
            )}
            <button
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="grid size-11 place-items-center rounded-full text-ink-2 transition-colors hover:bg-[var(--surface-2)]"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        <main className="relative z-10 pb-16 pt-4">
          <AnimatePresence mode="wait">
            {demo && state.status === 'idle' && (
              <m.div key="demo" variants={pageIn} initial="hidden" animate="show" exit="exit">
                <ReportView
                  report={demo}
                  onReset={() => {
                    setDemo(null)
                    window.history.replaceState({}, '', window.location.pathname)
                  }}
                />
              </m.div>
            )}

            {!demo && state.status === 'idle' && (
              <m.div key="hero" variants={pageIn} initial="hidden" animate="show" exit="exit">
                <Hero
                  onSubmit={start}
                  onOpenExample={() => {
                    void import('@/lib/demo').then((mod) => setDemo(mod.DEMO_REPORT))
                  }}
                />
              </m.div>
            )}

            {state.status === 'running' && (
              <m.div key="pipeline" variants={pageIn} initial="hidden" animate="show" exit="exit">
                <Pipeline state={state} onCancel={cancel} />
              </m.div>
            )}

            {state.status === 'done' && state.report && (
              <m.div key="report" variants={pageIn} initial="hidden" animate="show" exit="exit">
                <ReportView
                  report={state.report}
                  onReset={startOver}
                  onEditMetric={() => setRescueOpen(true)}
                />
              </m.div>
            )}

            {state.status === 'error' && (
              <m.div
                key="error"
                variants={pageIn}
                initial="hidden"
                animate="show"
                exit="exit"
                className="mx-auto w-full max-w-lg px-4"
              >
                <Card className="text-center">
                  <span className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--neg-soft)]">
                    <TriangleAlert size={22} className="text-[var(--neg)]" />
                  </span>
                  <h2 className="mt-3 text-lg font-semibold">
                    That did not work
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
                    {state.error}
                  </p>

                  <div className="mt-5 flex flex-col gap-2">
                    {state.recoverable && (
                      <Button onClick={() => setRescueOpen(true)}>
                        {state.recoverable.suggestion.length > 60
                          ? 'Add the details yourself'
                          : state.recoverable.suggestion}
                      </Button>
                    )}
                    {lastRequest && (
                      <Button variant="outline" onClick={() => void run(lastRequest)}>
                        <RefreshCw size={15} />
                        Try again
                      </Button>
                    )}
                    <Button variant="ghost" onClick={startOver}>
                      Start over
                    </Button>
                  </div>
                </Card>
              </m.div>
            )}
          </AnimatePresence>
        </main>

        <RescueSheet
          open={rescueOpen}
          reason={state.recoverable?.reason ?? state.snapshot?.extraction.blocked?.reason}
          suggestion={
            state.recoverable?.suggestion ?? state.snapshot?.extraction.blocked?.suggestion
          }
          onClose={() => setRescueOpen(false)}
          onSubmit={retryWith}
        />

        {tab === 'dashboard' && !state.report && !demo && (
          <div className="fixed inset-0 z-20 overflow-y-auto bg-[var(--bg)] pt-[max(0.75rem,var(--sat))]">
            <Overview
              historyCount={history.entries.length}
              onAnalyse={() => {
                setTab('analyse')
                startOver()
              }}
              onAccounts={() => setTab('accounts')}
              onCompare={() => setTab('compare')}
            />
          </div>
        )}

        {(tab === 'accounts' || tab === 'compare') && (
          <div className="fixed inset-0 z-20 overflow-y-auto bg-[var(--bg)] pt-[max(0.75rem,var(--sat))]">
            <Dashboard
              mode={tab === 'compare' ? 'compare' : 'accounts'}
              onClose={() => setTab('dashboard')}
            />
          </div>
        )}

        <TabBar
          active={tab}
          historyCount={history.entries.length}
          onSelect={(next) => {
            if (next === 'history') {
              setHistoryOpen(true)
              return
            }
            if (next === 'analyse') {
              // The centre control now owns the paste-a-link screen outright.
              // It used to share it with the left tab, which is why the two
              // felt identical: both went to the same place and neither did
              // anything visible if you were already there.
              setTab('analyse')
              startOver()
              requestAnimationFrame(() => {
                const box = document.querySelector<HTMLInputElement>(
                  'input[type="url"], #post-url, input[inputmode="url"]',
                )
                box?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                box?.focus()
              })
              return
            }
            if (next === 'dashboard') {
              // The dashboard is a destination, not an action: it takes the
              // panels off and shows where things stand.
              setTab('dashboard')
              setHistoryOpen(false)
              window.scrollTo({ top: 0, behavior: 'smooth' })
              return
            }
            setTab(next)
          }}
        />

        <HistoryPanel
          open={historyOpen}
          entries={history.entries}
          onClose={() => setHistoryOpen(false)}
          onOpen={(entry) => {
            setHistoryOpen(false)
            // Re-running is honest: engagement counts move, and a stale report
            // presented as current is exactly the failure this tool exists to fix.
            start(entry.url)
          }}
          onRemove={history.remove}
          onClear={history.clear}
        />
      </div>
    </LazyMotion>
  )
}

/**
 * The mark: four bars, one peak.
 *
 * The old glyph was the wifi arc, which reads as "wireless" — the wrong idea
 * for a product that reads posts and tells you which one matters. Bars of
 * uneven height read as a signal being measured, and the single tall one is
 * the finding. It survives 15px because it is four rectangles.
 */
