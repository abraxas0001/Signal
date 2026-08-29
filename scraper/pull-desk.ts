/**
 * See a handed-over desk from this machine — the office's read side.
 *
 *   npm run desk:pull -- dkaruna           status and counts
 *   npm run desk:pull -- dkaruna --dump    also write the records to disk
 *
 * The push script is how the office feeds the desk; this is how it looks at
 * what came back. It prints who wrote last and when, and counts the records
 * the member's own edits live in — tasks she ticked, grievances she cleared,
 * influencers she added. `--dump` writes each record to
 * `.desk-pull/<deskId>/` for a close read; that folder is gitignored with
 * the rest of the operational output.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { normaliseDeskId, readDeskBundle } from '../netlify/functions/lib/desk-sync'

function count(raw: string | undefined, pick: (s: Record<string, unknown>) => unknown): number | null {
  if (!raw) return null
  try {
    const v = pick(JSON.parse(raw) as Record<string, unknown>)
    return Array.isArray(v) ? v.length : null
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const deskId = normaliseDeskId(args.find((a) => !a.startsWith('--')))
  if (!deskId) {
    console.log('Usage: npm run desk:pull -- <deskId> [--dump]')
    process.exit(1)
  }

  const bundle = await readDeskBundle(deskId)
  if (!bundle.ok) {
    console.log(`Could not read the desk: ${bundle.note}`)
    process.exit(1)
  }
  const { rev, updatedAt, updatedBy, keys } = bundle.value

  console.log(`Desk ${deskId}`)
  console.log(`  revision:   ${rev}`)
  console.log(`  last write: ${updatedBy ?? 'unknown'}${updatedAt ? ` at ${updatedAt}` : ''}`)
  console.log('')

  const store = keys['signal:store']
  const rows: [string, number | null][] = [
    ['grievance records', count(store, (s) => s['grievances'])],
    ['issues', count(store, (s) => s['issues'])],
    ['tasks', count(store, (s) => s['actions'])],
    ['influencers watched', count(store, (s) => s['influencers'])],
    ['influencer mentions', count(store, (s) => s['mentions'])],
    ['tracked accounts', count(keys['signal.handles.v1'], (s) => s as unknown)],
  ]
  for (const [label, n] of rows) {
    console.log(`  ${label.padEnd(20)} ${n === null ? '-' : n}`)
  }

  // Tasks are where her own hand shows most clearly: what she filed, ticked
  // off, or declined since the last look.
  try {
    const actions = (JSON.parse(store ?? '{}') as { actions?: { description?: string; status?: string; createdAt?: string }[] })
      .actions ?? []
    if (actions.length > 0) {
      console.log('\n  newest tasks:')
      for (const a of actions.slice(0, 5)) {
        console.log(`    [${a.status}] ${(a.description ?? '').slice(0, 70)}`)
      }
    }
  } catch {
    /* the counts above already told the story */
  }

  if (args.includes('--dump')) {
    const dir = resolve(process.cwd(), '.desk-pull', deskId)
    mkdirSync(dir, { recursive: true })
    for (const [name, value] of Object.entries(keys)) {
      const file = resolve(dir, `${name.replace(/[^a-z0-9.-]+/gi, '_')}.json`)
      try {
        writeFileSync(file, JSON.stringify(JSON.parse(value), null, 2))
      } catch {
        writeFileSync(file, value)
      }
    }
    console.log(`\n  records written to ${dir}`)
  }
}

void main()
