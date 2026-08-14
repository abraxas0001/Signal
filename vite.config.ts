import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    /**
     * `netlify dev` runs this server as its child on 5173 and fronts it on
     * 8888, where it also serves /api/* and applies netlify.toml's headers.
     *
     * Use 5173, not 8888, during development. Those headers include the
     * production CSP (`script-src 'self'`), and Vite's dev server injects the
     * React Fast Refresh preamble as an *inline* script — so 8888 refuses it
     * and renders a blank page. The CSP is right: the production build has no
     * inline script at all, deliberately, which is why theme.js is a separate
     * file. It is only the dev-mode preamble that collides with it.
     *
     * So this proxy sends /api/* back to netlify dev, which owns the
     * functions. One URL, full interface, working API, no CSP fighting the
     * dev server. With bare `vite` the proxy target is simply absent and the
     * app degrades to the demo report, exactly as before.
     */
    proxy: {
      '/api': {
        target: 'http://localhost:8888',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2022',
    cssTarget: 'chrome111',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep the motion runtime and React out of the entry chunk so first
        // paint is cheap on the mid-range Android phones this is built for.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('motion') || id.includes('framer')) return 'motion'
          if (id.includes('react-dom') || id.includes('/react/')) return 'react'
          return undefined
        },
      },
    },
  },
})
