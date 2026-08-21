import { useCallback, useEffect, useState } from 'react'
import { LazyMotion, domAnimation, AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { Clock, Moon, RefreshCw, Sun, TriangleAlert } from 'lucide-react'
// `Report` must be imported explicitly: the DOM lib declares a global `Report`
// (the Reporting API), which otherwise shadows ours and produces a baffling
// "Type 'Report' is not assignable to type 'Report'".
import type { AnalyseRequest, Report } from '@shared/types'
import { isWaiting } from '@shared/grievance'
import { useAnalysis } from '@/hooks/useAnalysis'
import { useHistory } from '@/hooks/useHistory'
import { Hero } from '@/components/Hero'
import { Pipeline } from '@/components/Pipeline'
import { ReportView } from '@/components/report/ReportView'
import { RescueSheet } from '@/components/RescueSheet'
import { HistoryPanel } from '@/components/HistoryPanel'
import { Dashboard } from '@/components/Dashboard'
import { Briefing } from '@/components/Briefing'
import { Grievances } from '@/components/Grievances'
import { Influencers } from '@/components/Influencers'
import { Persona } from '@/components/Persona'
import { Actions } from '@/components/Actions'
import { Settings } from '@/components/Settings'
import { Onboarding } from '@/components/Onboarding'
import { TabBar, type Tab } from '@/components/TabBar'
import { MoreSheet } from '@/components/MoreSheet'
import { SideNav } from '@/components/SideNav'
import { emptyStore, useStore, update, writeStore } from '@/lib/store'
import { LockButton, LockScreen, useVaultState } from '@/components/Lock'
import { signOut } from '@/lib/vault'
import { Avatar, Button, Card, Shell, SignalGlyph } from '@/components/ui'
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
  const store = useStore()

  const [theme, setTheme] = useState<Theme>('light')
  const [rescueOpen, setRescueOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  /** The phone's overflow sheet. Never opened above lg, where the sidebar shows. */
  const [moreOpen, setMoreOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('dashboard')
  const [lastRequest, setLastRequest] = useState<AnalyseRequest | null>(null)
  /** An issue the dashboard asked to have opened, cleared once it is left. */
  const [focusIssue, setFocusIssue] = useState<string | null>(null)

  const [demo, setDemo] = useState<Report | null>(null)

  /**
   * Who is signed in, if anyone.
   *
   * The gate only appears once somebody has created an account. A desk that has
   * never been locked opens straight into the work, because forcing a passphrase
   * on an office that did not ask for one is how a tool gets abandoned on day
   * one — and there is nothing to protect yet. From the first account onward the
   * app is sealed until someone signs in.
   */
  const vault = useVaultState()
  const sealed = vault.exists && vault.locked

  // The only badge worth showing: things a person has not cleared yet. A count
  // of everything ever recorded is a number that only ever grows, which the eye
  // learns to ignore within a week.
  /**
   * Must match what the Influencers screen actually lists, or the badge is a
   * promise the screen does not keep.
   *
   * This counted every unacknowledged mention, while the screen shows only the
   * ones that are genuinely ABOUT the member — it filters on `mentionsSubject`,
   * because a post that merely contains a watch word is not somebody talking
   * about them. The badge said 8, the screen said "2 to look at", and the six
   * missing ones could not be found or cleared anywhere.
   *
   * The rule now lives in `isWaiting` and both sides import it, because writing
   * it out here a second time is exactly how they drifted the first time. Do
   * not inline it back.
   */
  const unacknowledged = store.mentions.filter(isWaiting).length

  /**
   * Tasks still owed to somebody.
   *
   * Actions took the bottom bar's fifth slot from the More button, so it needs
   * its own count for the same reason every other slot has one: a tab that
   * never says how much is behind it gets opened once and then ignored.
   * Declined counts as closed — it was decided, not left.
   */
  const openActions = store.actions.filter(
    (a) => a.status !== 'Completed' && a.status !== 'Declined',
  ).length

  // Gate the expensive visual layers once, at boot.
  useEffect(() => {
    applyDeviceClass()
    // theme.js has already written the attribute before first paint; read it
    // back so React's state and the DOM agree from the start.
    const saved = localStorage.getItem('signal:theme')
    if (saved === 'light' || saved === 'dark') setTheme(saved)

    // ?demo=1 renders a worked example. Useful before an API key is set up,
    // and it makes the report screen reachable without a live analysis.
    const params = new URLSearchParams(window.location.search)
    if (params.has('demo')) {
      // The worked example renders on the analyse screen, which is now shown
      // by tab alone — so the tab has to move with it.
      setTab('analyse')
      void import('@/lib/demo').then((m) => setDemo(m.DEMO_REPORT))
    }

    // The OAuth callback (oauth-callback.mts) redirects here with this flag —
    // Settings.tsx itself consumes the rest of the query string (connected=/
    // connect_error=) once it is actually mounted.
    if (params.has('settings')) setTab('settings')

    /**
     * ?sample=1 fills the device with a sample dataset.
     *
     * Every screen here is a report about records, so with none of them the
     * whole product reads as a stack of empty forms and there is nothing to
     * judge. This loads a file the operator supplies at
     * `public/sample-data.json`; it is git-ignored, because the records are
     * real published stories carrying real "suspected fake" judgements about
     * named outlets, which has no business in a public repository.
     *
     * Absent the file this does nothing and says so in the console, rather
     * than wiping whatever real work is already on the device.
     */
    if (params.has('sample')) {
      void (async () => {
        try {
          const res = await fetch('/sample-data.json')
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = (await res.json()) as Partial<Parameters<typeof writeStore>[0]>
          // Filled in over an empty store rather than written straight through.
          // This file is produced by hand and can predate the store's shape —
          // it did: it was written before the persona tracker existed, so
          // loading it left `personas` undefined and the People screen threw
          // the moment it was opened. writeStore trusts what it is handed, so
          // the defaulting has to happen here.
          writeStore({ ...emptyStore(), ...data })
          // Drop the parameter so a refresh does not reinstate the sample over
          // anything filed since.
          window.history.replaceState({}, '', window.location.pathname)
        } catch (err) {
          console.warn(
            'Signal: no sample dataset at /sample-data.json, so nothing was loaded.',
            err,
          )
        }
      })()
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
      setCameFrom(null)
      // The history panel starts runs from whichever screen is open, so this
      // cannot assume the analyse tab is already the one showing.
      setTab('analyse')
      void run(req)
    },
    [run],
  )

  /**
   * Read one influencer mention in full.
   *
   * Deliberately the SAME path as the paste box — one request shape, one
   * endpoint, one report. The office asked for "the same analysis we get by
   * pasting a link", and the way to guarantee that is to not build a second
   * one; a parallel reading path would drift from this one within a release.
   *
   * `cameFrom` is the whole addition: it remembers which screen sent us here so
   * that closing the report returns to the list of mentions rather than to the
   * paste box. Without it, reading three mentions means walking back through
   * the dashboard three times.
   */
  const readPost = useCallback(
    (postUrl: string, from: 'influencers' | 'dashboard') => {
      const req: AnalyseRequest = { url: postUrl }
      setLastRequest(req)
      setDemo(null)
      setCameFrom(from)
      // Move the tab, not just the state. The analyse screen is shown by tab
      // alone now, so a run started from another screen has to bring the tab
      // with it — otherwise it would run invisibly behind the list.
      setTab('analyse')
      void run(req)
      window.scrollTo({ top: 0 })
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

  /**
   * Which screen sent us into an analysis, so the way out leads back to it.
   * Null means the paste box, which is the home this app already returns to.
   */
  const [cameFrom, setCameFrom] = useState<'influencers' | 'dashboard' | null>(null)

  /**
   * Close the report and go back where the reader came from.
   *
   * `startOver` returns to the paste box, which is right when the paste box is
   * where they started and wrong when a mention card is. Both callers reset the
   * same analysis state; only the destination differs.
   */
  const closeReport = useCallback(() => {
    const back = cameFrom
    reset()
    setLastRequest(null)
    setDemo(null)
    setRescueOpen(false)
    setCameFrom(null)
    if (back) setTab(back)
    haptic.tap()
    window.scrollTo({ top: 0 })
  }, [cameFrom, reset])

  const startOver = useCallback(() => {
    reset()
    setLastRequest(null)
    setCameFrom(null)
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

  /**
   * Move between screens.
   *
   * Leaving the dashboard stamps `lastSeenAt`, which is what the briefing's
   * "since you last looked" block measures against. Stamping it on arrival
   * instead would clear the block the instant it was read, so the office would
   * never see what changed.
   */
  const goTo = useCallback(
    (next: Tab) => {
      // The stamp happens here rather than inside a setTab updater. An updater
      // runs during React's render pass, and writing to the store from there
      // notifies its subscribers mid-render — React reports it as "cannot
      // update a component while rendering a different component", and the
      // briefing can render against a store it is about to be told changed.
      if (tab === 'dashboard' && next !== 'dashboard') {
        update((s) => ({ ...s, lastSeenAt: new Date().toISOString() }))
      }
      if (next !== 'grievances') setFocusIssue(null)

      /**
       * Leaving the analyse screen ends the analysis on it.
       *
       * Without this a finished or failed run sits in state for the rest of
       * the session, and coming back to the tab shows a report about a post
       * the reader has long since moved on from. Cancelling a run in flight
       * also stops it spending a model call on a screen nobody is looking at.
       */
      if (tab === 'analyse' && next !== 'analyse') {
        if (state.status === 'running') cancel()
        reset()
        setLastRequest(null)
        setDemo(null)
        setRescueOpen(false)
        setCameFrom(null)
      }

      setTab(next)
      setHistoryOpen(false)
      window.scrollTo({ top: 0 })
    },
    [tab, state.status, cancel, reset],
  )

  const toggleTheme = () => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
    haptic.tap()
  }

  /**
   * Nothing else mounts while the device is sealed.
   *
   * Rendering the app behind a lock overlay would leave every screen mounted
   * and every record in the DOM — the records would be one devtools panel away,
   * which is precisely what an office sharing a phone is locking them against.
   * Returning early means the decrypted store is never read at all.
   */
  /**
   * A reload is checking whether this tab was already signed in.
   *
   * Held blank rather than showing the lock screen, because for the common case
   * — a refresh — the answer is yes and the screen would appear for a few
   * hundred milliseconds and vanish. A passphrase prompt that flashes teaches
   * the office that the app logs them out at random, which is precisely the
   * complaint this exists to fix.
   */
  if (vault.restoring) {
    return <div className="min-h-screen-safe bg-[var(--bg)]" aria-busy="true" />
  }

  if (sealed) {
    return (
      <LazyMotion features={domAnimation} strict>
        <LockScreen onUnlocked={() => window.scrollTo({ top: 0 })} />
      </LazyMotion>
    )
  }

  /**
   * Setup comes before anything else.
   *
   * Rendered instead of the app rather than over it, for the same reason the
   * lock screen is: a wizard laid on top leaves every screen mounted behind it,
   * which on this product means running a news scan for a desk that has not
   * said whose it is yet. Somebody who skips still passes through here once —
   * `onboardedAt` is stamped either way — so this is one screen in a lifetime,
   * not a gate that reappears.
   */
  if (!store.onboardedAt) {
    return (
      <LazyMotion features={domAnimation} strict>
        <Onboarding
          onDone={() => {
            setTab('dashboard')
            window.scrollTo({ top: 0 })
          }}
        />
      </LazyMotion>
    )
  }

  /**
   * Which screen is on.
   *
   * Every destination used to render as its own `fixed inset-0` overlay stacked
   * above the page. That is what put the header permanently out of reach: the
   * overlays sat at z-20 and the header at z-10, and the dashboard is the
   * opening tab — so from the moment the app booted, the wordmark, the history
   * button and the theme toggle were all underneath a covering layer. Nobody
   * could reach them on any screen, at any width.
   *
   * They are ordinary blocks in the document now, one at a time, under one
   * header that stays put. That also gets every screen onto the same measure,
   * which is the other half of why nothing lined up.
   */
  /**
   * The analyse flow owns the screen only when the reader is ON it.
   *
   * This was `tab === 'analyse' || state.status !== 'idle' || demo`, and that
   * second clause was a trap: `status` is non-idle for 'running', 'done' AND
   * 'error', so the moment an analysis finished or failed this branch won
   * whatever `tab` said. Every navigation control still SET the tab — and the
   * screen never changed. The whole app looked frozen on one page, with the
   * dashboard, the desk and the settings all one dead click away.
   *
   * It went unnoticed while an analysis could only be started from this tab,
   * where tab was already 'analyse' and the extra clause changed nothing.
   * Adding "Read it fully" to the dashboard and the influencer list made it
   * reachable from anywhere, and turned it into a dead end.
   *
   * So the tab decides, and every caller that starts an analysis from another
   * screen moves the tab with it — see `readPost` and the history panel.
   */
  const showAnalyse = tab === 'analyse'

  const screen = () => {
    if (showAnalyse) {
      if (demo && state.status === 'idle') {
        return (
          <m.div key="demo" variants={pageIn} initial="hidden" animate="show" exit="exit">
            <ReportView
              report={demo}
              onReset={() => {
                setDemo(null)
                window.history.replaceState({}, '', window.location.pathname)
              }}
            />
          </m.div>
        )
      }

      if (state.status === 'idle') {
        return (
          <m.div key="hero" variants={pageIn} initial="hidden" animate="show" exit="exit">
            <Hero
              onSubmit={start}
              onOpenExample={() => {
                setTab('analyse')
                void import('@/lib/demo').then((mod) => setDemo(mod.DEMO_REPORT))
              }}
              // Only once there is a desk behind it. Before setup this screen
              // is the app, and "Back" would lead nowhere.
              onClose={store.onboardedAt ? () => goTo('dashboard') : undefined}
            />
          </m.div>
        )
      }

      if (state.status === 'running') {
        return (
          <m.div key="pipeline" variants={pageIn} initial="hidden" animate="show" exit="exit">
            <Pipeline state={state} onCancel={cancel} />
          </m.div>
        )
      }

      if (state.status === 'done' && state.report) {
        return (
          <m.div key="report" variants={pageIn} initial="hidden" animate="show" exit="exit">
            <ReportView
              report={state.report}
              onReset={closeReport}
              onEditMetric={() => setRescueOpen(true)}
            />
          </m.div>
        )
      }

      return (
        <m.div key="error" variants={pageIn} initial="hidden" animate="show" exit="exit">
          <Shell width="prose">
            <Card className="text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--neg-soft)]">
                <TriangleAlert size={22} className="text-[var(--neg)]" />
              </span>
              <h2 className="mt-3 text-lg font-semibold">That did not work</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{state.error}</p>

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
          </Shell>
        </m.div>
      )
    }

    const go = (to: Tab) => () => goTo(to)

    switch (tab) {
      case 'grievances':
        return (
          <Grievances key="grievances" onClose={go('dashboard')} focusIssueId={focusIssue} />
        )
      // People the office is tracked against. Distinct from Influencers: that
      // screen asks what a set of accounts is saying in general, this one asks
      // what every masthead is saying about one named person.
      case 'personas':
        return <Persona key="personas" onClose={go('dashboard')} />
      case 'influencers':
        return (
          <Influencers
            key="influencers"
            onClose={go('dashboard')}
            onRead={(mention) => readPost(mention.postUrl, 'influencers')}
          />
        )
      case 'actions':
        return <Actions key="actions" onClose={go('dashboard')} />
      case 'accounts':
        return <Dashboard key="accounts" mode="accounts" onClose={go('dashboard')} />
      case 'compare':
        return (
          <Dashboard
            key="compare"
            mode="compare"
            onClose={go('dashboard')}
            onOpenActions={() => goTo('actions')}
          />
        )
      case 'settings':
        return (
          <Settings
            key="settings"
            onClose={go('dashboard')}
            onChangePerson={() => {
              update((prev) => ({ ...prev, onboardedAt: null }))
              window.scrollTo({ top: 0 })
            }}
          />
        )
      default:
        return (
          <Briefing
            key="dashboard"
            onRead={(postUrl) => readPost(postUrl, 'dashboard')}
            onEditIdentity={() => {
              // Clearing the stamp is what puts the setup screen back in front:
              // it is the same one-screen flow, pre-filled with nothing, and it
              // re-stamps on the way out.
              update((prev) => ({ ...prev, onboardedAt: null }))
              window.scrollTo({ top: 0 })
            }}
            onNavigate={(to, issueId) => {
              if (to === 'analyse') {
                goTo('analyse')
                startOver()
                return
              }
              // Carried so the destination can open the thing that was clicked
              // rather than the top of a list containing it.
              setFocusIssue(issueId ?? null)
              goTo(to)
            }}
          />
        )
    }
  }

  return (
    <LazyMotion features={domAnimation} strict>
      {/* The rail is fixed, so the page reserves its width from lg up rather
          than sliding underneath it. */}
      <div className="relative min-h-screen-safe overflow-x-hidden lg:pl-[var(--rail-w)]">
        {/*
          One header, and it stays.

          Sticky rather than static: these screens are long — a grievance desk
          runs to hundreds of rows — and a masthead that scrolls away takes the
          way home with it. It sits on the same measure as the content beneath,
          so the wordmark shares a left edge with the first heading of every
          screen instead of the two disagreeing by 250px.
        */}
        <header className="no-print sticky top-0 z-30 border-b border-[var(--rule)] bg-[color-mix(in_oklab,var(--surface)_86%,transparent)] backdrop-blur-xl">
          <Shell
            width="wide"
            className="flex h-[var(--topbar-h)] items-center justify-between gap-3"
          >
            {/* Hidden from lg up, where the sidebar carries the wordmark two
                inches to the left. Two "Signal" lockups on one screen reads as
                a rendering fault, and the sidebar's is the one that belongs to
                the navigation. Below lg the sidebar is gone and this is the
                only mark — and the only way back to the dashboard by tapping
                the logo — so it stays. */}
            <button
              onClick={() => {
                goTo('dashboard')
                startOver()
              }}
              className="group flex min-w-0 items-center gap-2.5 lg:hidden"
              aria-label="Signal: dashboard"
            >
              <span className="shrink-0 text-[var(--accent)] transition-transform group-active:scale-95">
                <SignalGlyph size={24} />
              </span>
              <span className="hed truncate text-[1.3rem] leading-none tracking-[-0.005em]">
                Signal
              </span>
            </button>

            {/* ml-auto, not justify-between. The wordmark beside this is
                `lg:hidden`, so above that width this is the only child and
                justify-between left it hard against the sidebar instead of at
                the far edge where a toolbar belongs. */}
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {history.entries.length > 0 && (
                <button
                  onClick={() => setHistoryOpen(true)}
                  aria-label={`History, ${history.entries.length}`}
                  title="History"
                  className="relative grid size-10 place-items-center rounded-full text-ink-2 transition-colors hover:bg-[var(--surface-2)]"
                >
                  <Clock size={18} aria-hidden />
                  <span
                    aria-hidden
                    className="tnum absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-semibold leading-4 text-[var(--accent-fg)]"
                  >
                    {history.entries.length > 99 ? '99+' : history.entries.length}
                  </span>
                </button>
              )}

              <button
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                className="grid size-10 place-items-center rounded-full text-ink-2 transition-colors hover:bg-[var(--surface-2)]"
              >
                {theme === 'dark' ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
              </button>

              {/*
                The office's own account, and the door to everything that is not
                a daily screen.

                This slot held a padlock. A padlock is an action, not a place,
                and it was the only thing in the header that looked like a
                destination — so the one control a person reaches for when they
                want "my stuff" was missing, while the one they touch twice a
                day sat in the most prominent corner of the app. The member's
                own face is a better door: it says whose desk this is, it opens
                the settings and reference screens, and Lock is inside it where
                a sign-out belongs.
              */}
              <button
                onClick={() => setMoreOpen(true)}
                aria-label="Your desk, settings and more"
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                title={store.identity?.name ?? 'Your desk'}
                className="ml-1 grid size-10 shrink-0 place-items-center rounded-full transition-colors hover:bg-[var(--surface-2)] lg:hidden"
              >
                <Avatar
                  src={store.identity?.photoUrl}
                  name={store.identity?.name ?? 'Signal'}
                  size={30}
                />
              </button>

              {/* On a laptop the sidebar already lists every destination, so
                  the sheet has nothing to add and the padlock stays a padlock. */}
              <span className="hidden lg:block">
                <LockButton />
              </span>
            </div>
          </Shell>
        </header>

        <main className="relative page-end pt-6 lg:pt-8">
          <AnimatePresence mode="wait">{screen()}</AnimatePresence>
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

        <SideNav
          active={tab}
          counts={{ influencers: unacknowledged, history: history.entries.length }}
          // No onLock: the padlock in the header is the one Lock control now,
          // present at every width. The sidebar's foot carries Settings.
          onSelect={(next) => {
            if (next === 'history') {
              setHistoryOpen(true)
              return
            }
            goTo(next)
            if (next === 'analyse') startOver()
          }}
        />

        <TabBar
          active={tab}
          counts={{ influencers: unacknowledged, actions: openActions }}
          onSelect={(next) => {
            if (next === 'history') {
              setHistoryOpen(true)
              return
            }
            if (next === 'analyse') {
              // The centre control owns the paste-a-link screen outright. It
              // used to share it with the left tab, which is why the two felt
              // identical: both went to the same place and neither did
              // anything visible if you were already there.
              goTo('analyse')
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
            goTo(next)
          }}
        />

        <MoreSheet
          open={moreOpen}
          active={tab}
          counts={{ influencers: unacknowledged, history: history.entries.length }}
          onClose={() => setMoreOpen(false)}
          onLock={vault.exists ? () => void signOut() : undefined}
          person={store.identity}
          onSelect={(next) => {
            if (next === 'history') {
              setHistoryOpen(true)
              return
            }
            goTo(next)
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
