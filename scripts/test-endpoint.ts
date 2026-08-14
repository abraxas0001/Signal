/**
 * Endpoint smoke test.
 *
 * Calls the Netlify function handler directly with a real Request and reads
 * the Server-Sent Events back, exactly as the browser does. This exercises the
 * whole server pipeline — routing, extraction, SSE framing, stage ordering —
 * without needing the Netlify CLI or a deploy.
 *
 *   npx tsx scripts/test-endpoint.ts [url]
 */

import handler from '../netlify/functions/analyse.mts'
import type { StreamEvent } from '../shared/types'

const url = process.argv[2] ?? 'https://x.com/greatandhranews/status/1994279726521688528'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YEL = '\x1b[33m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

console.log(`${BOLD}POST /api/analyse${OFF}  ${DIM}${url}${OFF}\n`)

const req = new Request('http://localhost/api/analyse', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url }),
})

const started = Date.now()
// The Netlify Context argument is unused by this handler.
const res = await handler(req, {} as never)

console.log(`${DIM}HTTP ${res.status} · ${res.headers.get('content-type')}${OFF}\n`)

if (!res.body) {
  console.log(`${RED}No response body${OFF}`)
  process.exit(1)
}

const reader = res.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
let events = 0
let sawReport = false
let sawError: string | null = null

for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })

  const frames = buffer.split('\n\n')
  buffer = frames.pop() ?? ''

  for (const frame of frames) {
    const line = frame.split('\n').find((l) => l.startsWith('data:'))
    if (!line) continue

    let ev: StreamEvent
    try {
      ev = JSON.parse(line.slice(5).trim()) as StreamEvent
    } catch {
      console.log(`${RED}unparseable frame:${OFF} ${frame.slice(0, 120)}`)
      continue
    }
    events++

    const t = `${DIM}+${String(Date.now() - started).padStart(5)}ms${OFF}`
    switch (ev.type) {
      case 'stage': {
        const mark =
          ev.status === 'done' ? `${GREEN}done${OFF}` : ev.status === 'skip' ? `${YEL}skip${OFF}` : 'start'
        console.log(`${t}  stage    ${ev.stage.padEnd(10)} ${mark}${ev.detail ? ` ${DIM}${ev.detail}${OFF}` : ''}`)
        break
      }
      case 'snapshot':
        console.log(
          `${t}  snapshot ${GREEN}${ev.snapshot.platform}${OFF} ${DIM}· ${ev.snapshot.author.name ?? 'unknown'} · likes=${ev.snapshot.engagement.likes.value ?? '—'} views=${ev.snapshot.engagement.views.value ?? '—'} · ${ev.snapshot.content.text?.length ?? 0} chars${OFF}`,
        )
        break
      case 'partial':
        console.log(`${t}  section  ${DIM}${ev.text}${OFF}`)
        break
      case 'report':
        sawReport = true
        console.log(`${t}  ${GREEN}${BOLD}report${OFF}   "${ev.report.analysis.headline}"`)
        console.log(`         ${DIM}sentiment=${ev.report.analysis.sentiment.label} · civic=${ev.report.analysis.civic ? 'yes' : 'no'} · ${ev.report.meta.outputTokens ?? '?'} out tokens${OFF}`)
        break
      case 'error':
        sawError = ev.message
        console.log(`${t}  ${YEL}error${OFF}    ${ev.message}`)
        if (ev.recoverable) console.log(`         ${DIM}rescue: ${ev.recoverable.suggestion}${OFF}`)
        break
    }
  }
}

console.log(`\n${BOLD}${events} events in ${Date.now() - started}ms${OFF}`)

if (sawReport) {
  console.log(`${GREEN}PASS — full report delivered${OFF}`)
} else if (sawError?.includes('API key')) {
  // Expected without a key: everything up to the model call must still work.
  console.log(
    `${GREEN}PASS — pipeline reached the analysis step and stopped cleanly (no API key configured)${OFF}`,
  )
} else {
  console.log(`${RED}FAIL — no report and no expected error${OFF}`)
  process.exit(1)
}
