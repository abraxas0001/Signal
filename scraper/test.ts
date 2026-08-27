/**
 * Exercise one adapter, without the HTTP layer.
 *
 * This is the diagnostic tool, and it exists because of how this service
 * fails: not with a crash, but with a platform quietly changing its markup so
 * an adapter returns nothing. When the dashboard says a rival has no posts,
 * this is how the operator finds out whether that is true or whether the
 * scraper has rotted — it prints the login-wall verdict and the raw rows
 * separately, so the two causes cannot be confused.
 *
 *   npm run scraper:test -- x narendramodi
 *   npm run scraper:test -- facebook DKAruna.TG
 *   npm run scraper:test -- instagram narendramodi --headed
 */

import { newPage, makePacer, goto, closeContext } from './browser'
import { adapters } from './adapters'
import type { AdapterContext, Platform } from './types'

const ALIAS: Record<string, Platform> = {
  facebook: 'Facebook',
  fb: 'Facebook',
  instagram: 'Instagram',
  ig: 'Instagram',
  linkedin: 'LinkedIn',
  li: 'LinkedIn',
  x: 'Twitter/X',
  twitter: 'Twitter/X',
  youtube: 'YouTube',
  yt: 'YouTube',
}

async function main() {
  const args = process.argv.slice(2)
  const headed = args.includes('--headed')
  const positional = args.filter((a) => !a.startsWith('--'))
  const [rawPlatform, handle] = positional

  if (!rawPlatform || !handle) {
    console.log('usage: npm run scraper:test -- <facebook|instagram|linkedin|x|youtube> <handle> [--headed]')
    process.exit(1)
  }

  const platform = ALIAS[rawPlatform.toLowerCase()]
  if (!platform) {
    console.log(`unknown platform "${rawPlatform}" — use facebook | instagram | linkedin | x | youtube`)
    process.exit(1)
  }

  const adapter = adapters[platform]
  const url = adapter.profileUrl(handle)
  console.log(`\n${platform} — ${handle}`)
  console.log(`${url}\n`)

  const page = await newPage(!headed)
  const ctx: AdapterContext = {
    page,
    log: (m) => console.log(`  ${m}`),
    pace: makePacer(platform),
    limit: 25,
  }

  try {
    await goto(page, url)
    console.log(`landed on: ${page.url()}`)

    // Reported first and on its own line. A login wall explains everything
    // that follows, and conflating it with an empty result is the mistake
    // this whole tool exists to prevent.
    const wall = await adapter.isLoginWall(ctx)
    console.log(`login wall: ${wall ? 'YES — run `npm run scraper:login`' : 'no'}\n`)
    if (wall) return

    const result = await adapter.posts(ctx, handle)

    if (!result.ok) {
      console.log(`COULD NOT READ`)
      console.log(`  ${result.reason}`)
      console.log(`\nThis is NOT the same as "no posts". Something stopped the read.\n`)
      return
    }

    if (result.items.length === 0) {
      console.log(`READ OK — the profile genuinely has no posts to list.`)
      if (result.note) console.log(`  ${result.note}`)
      console.log('')
      return
    }

    console.log(`READ OK — ${result.items.length} posts${result.note ? ` (${result.note})` : ''}\n`)
    for (const [i, p] of result.items.entries()) {
      const metric = (label: string, v: number | null) =>
        v === null ? `${label}=—` : `${label}=${v}`
      console.log(`${String(i + 1).padStart(2)}. ${p.url}`)
      if (p.title) console.log(`    ${p.title.replace(/\s+/g, ' ').slice(0, 90)}`)
      console.log(
        `    ${[
          metric('likes', p.likes),
          metric('comments', p.comments),
          metric('shares', p.shares),
          metric('views', p.views),
        ].join('  ')}${p.publishedAt ? `  ${p.publishedAt}` : ''}`,
      )
    }
    console.log(`\n"—" means not measured, never zero.\n`)
  } catch (err) {
    console.log(`\nTHREW: ${err instanceof Error ? err.message : String(err)}\n`)
  } finally {
    await page.close().catch(() => {})
    await closeContext()
  }
}

void main()
