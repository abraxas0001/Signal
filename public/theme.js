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
