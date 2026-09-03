import { chromium } from 'playwright'
async function main() {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1600, height: 1100 } })
  await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(2500)
  const demo = p.locator('button', { hasText: 'demo' }).first()
  if (await demo.count()) { await demo.click(); await p.waitForTimeout(9000) }
  const h2 = p.locator('h2', { hasText: 'Overall reach' }).first()
  await h2.scrollIntoViewIfNeeded(); await p.waitForTimeout(600)
  const card = h2.locator('xpath=ancestor::*[contains(@class,"card")][1]')
  const read = async () => (await card.innerText()).replace(/\s+/g, ' ').trim()
  const week = await read()
  await card.locator('button', { hasText: 'Last 30 days' }).click()
  await p.waitForTimeout(1500)
  const month = await read()
  console.log('IDENTICAL:', week === month)
  // diff them token by token
  const a = week.split(' | ').join(' ').split(' ')
  const c = month.split(' | ').join(' ').split(' ')
  const diffs: string[] = []
  for (let i = 0; i < Math.max(a.length, c.length); i++) {
    if (a[i] !== c[i]) diffs.push(`[${i}] 7d="${a[i]}" 30d="${c[i]}"`)
  }
  console.log('token diffs:', diffs.length)
  diffs.slice(0, 20).forEach((d) => console.log('  ', d))
  console.log('\n--- 7d ---\n', week.slice(0, 500))
  console.log('\n--- 30d ---\n', month.slice(0, 500))
  await b.close()
}
void main()
