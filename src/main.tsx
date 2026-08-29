import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { restoreDemoModeIfActive } from './lib/demo-mode'
import { restoreDeskIfActive } from './lib/desk-session'
import './index.css'

/**
 * Point the store at the right namespace BEFORE the first render.
 *
 * The store caches on first read and every screen reads it during mount, so
 * switching namespaces from inside an effect would mean the first paint came
 * from the wrong account — a visitor returning to the demo would see a flash of
 * the real desk's data, or an empty one, before it corrected itself. Doing it
 * here costs one synchronous localStorage read and removes the flash entirely.
 *
 * A handed-over desk outranks the demo: a member who signed into their own
 * desk and once peeked at the example must come back to their desk.
 */
if (!restoreDeskIfActive()) restoreDemoModeIfActive()

const root = document.getElementById('root')
if (!root) throw new Error('Root element is missing from index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
