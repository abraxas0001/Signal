/**
 * Check every portal entry marked `unverified` against the live site.
 *
 *   npx tsx scraper/verify-portals.ts
 *
 * A wrong URL in the registry is worse than a missing one: the reader errors
 * on a 404 feed rather than falling back to the index, so a single bad path
 * costs the whole source every morning, silently. This asks each unverified
 * entry's indexUrl and feedUrl for a response and prints a verdict per URL.
 * It changes nothing; the registry edit is a human decision made on the
 * evidence this prints.
 *
 * Plain HTTPS GETs of public front pages and feeds, nothing more.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = resolve(process.cwd(), 'shared/regions.ts')

interface Probe {
  label: string
  kind: 'index' | 'feed'
  url: string
}

function collect(): Probe[] {
  const text = readFileSync(SRC, 'utf8')
  const probes: Probe[] = []
  // Entries are object literals; split on `host:` boundaries and keep only the
  // unverified ones. A parser would be sturdier, but the file is ours and flat.
  const chunks = text.split(/\n  \{/).slice(1)
  for (const chunk of chunks) {
    if (!/unverified:\s*true/.test(chunk)) continue
    const label = /label:\s*'([^']+)'/.exec(chunk)?.[1] ?? '(unnamed)'
    const index = /indexUrl:\s*'([^']+)'/.exec(chunk)?.[1]
    const feed = /feedUrl:\s*'([^']+)'/.exec(chunk)?.[1]
    if (index) probes.push({ label, kind: 'index', url: index })
    if (feed) probes.push({ label, kind: 'feed', url: feed })
  }
  return probes
}

async function probe(p: Probe): Promise<string> {
  try {
    const res = await fetch(p.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: {
        // A bare fetch UA gets 403 from several Indian news CDNs; a browser
        // string gets the same page a reader would.
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        accept: p.kind === 'feed' ? 'application/rss+xml, application/xml, text/xml, */*' : 'text/html,*/*',
      },
    })
    const body = await res.text()
    if (!res.ok) return `HTTP ${res.status}`
    if (p.kind === 'feed') {
      const looksXml = /<rss|<feed|<channel/i.test(body.slice(0, 2000))
      return looksXml ? `ok (${Math.round(body.length / 1024)}KB xml)` : 'RESPONDS BUT NOT A FEED'
    }
    const links = (body.match(/<a\s/gi) ?? []).length
    return links > 20 ? `ok (${links} links)` : `THIN PAGE (${links} links)`
  } catch (err) {
    return ((err as Error).message ?? 'failed').split('\n')[0]!.slice(0, 60)
  }
}

async function main(): Promise<void> {
  const probes = collect()
  console.log(`${probes.length} URLs across the unverified entries\n`)
  let bad = 0
  // Four at a time: enough to finish quickly, few enough to be polite.
  for (let i = 0; i < probes.length; i += 4) {
    const batch = probes.slice(i, i + 4)
    const results = await Promise.all(batch.map(probe))
    results.forEach((r, j) => {
      const p = batch[j]!
      const ok = r.startsWith('ok')
      if (!ok) bad++
      console.log(`  ${ok ? 'ok  ' : 'BAD '} ${p.label.padEnd(24)} ${p.kind.padEnd(5)} ${r.padEnd(28)} ${p.url}`)
    })
  }
  console.log(`\n${bad} problem URL${bad === 1 ? '' : 's'}`)
}

void main()
