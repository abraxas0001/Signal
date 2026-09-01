/*
 * Applies the theme before first paint.
 *
 * A separate file rather than an inline <script> because the CSP is
 * script-src 'self' — an inline block would be refused, and the flash this
 * exists to prevent would come back on every load.
 *
 * Light is the product's default. Without an explicit attribute the stylesheet
 * falls through to prefers-color-scheme, which means a viewer whose OS is dark
 * would get dark on first paint and then a jarring flip once React decided
 * otherwise. Writing the attribute here settles it before anything renders.
 */
(function () {
  var theme = 'light'
  try {
    var saved = localStorage.getItem('signal:theme')
    if (saved === 'light' || saved === 'dark') theme = saved
  } catch (e) {
    /* private mode: fall back to the default */
  }
  document.documentElement.setAttribute('data-theme', theme)
})()

/*
 * The wrong-port guard.
 *
 * `npm run dev` runs `netlify dev`, which announces itself on 8888 and fronts
 * the Vite dev server there with netlify.toml's PRODUCTION headers applied.
 * Two of those are fatal in development: the SPA catch-all turns every module
 * request Vite serves (/src/main.tsx, /@vite/client) into index.html, and the
 * CSP's `script-src 'self'` refuses the inline Fast Refresh preamble Vite
 * injects. The result on 8888 is a completely blank white page — not a broken
 * feature, nothing at all — and the owner reasonably reads that as the work
 * never having landed.
 *
 * Both headers are correct for production: the built app has no inline script
 * (which is why this file is a file). So rather than weaken them, the port the
 * dev command prints simply forwards to the port that works, keeping the path,
 * the query and the hash. /api stays on 8888, which is where the functions
 * live, because Vite proxies it straight back.
 *
 * This can never fire in production: a deployed site is on 443 or 80 and its
 * host is not localhost.
 */
;(function () {
  try {
    var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    if (!local || location.port !== '8888') return
    location.replace('http://localhost:5173' + location.pathname + location.search + location.hash)
  } catch (e) {
    /* never let a development convenience take down the page */
  }
})()
