import { chromium } from 'playwright'
async function main() {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 })
  const errs: string[] = []
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 140)))
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
  await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(2500)
  const demo = p.locator('button', { hasText: 'demo' }).first()
  if (await demo.count()) { await demo.click(); await p.waitForTimeout(9000) }
  const h2 = p.locator('h2', { hasText: 'Overall reach' }).first()
  await h2.scrollIntoViewIfNeeded(); await p.waitForTimeout(700)
  const card = h2.locator('xpath=ancestor::*[contains(@class,"card")][1]')
  const read = async () => (await card.innerText()).replace(/\s+/g, ' ').trim()
  const week = await read()
  await card.locator('button', { hasText: 'Last 30 days' }).click()
  await p.waitForTimeout(1600)
  const month = await read()
  const a = week.split(' '), c = month.split(' ')
  const diffs: string[] = []
  for (let i = 0; i < Math.max(a.length, c.length); i++) if (a[i] !== c[i]) diffs.push(`7d="${a[i]}" 30d="${c[i]}"`)
  console.log('figures that now change:', diffs.length)
  diffs.slice(0, 14).forEach((d) => console.log('  ', d))
  await card.locator('button', { hasText: 'Last 7 days' }).click(); await p.waitForTimeout(1200)
  await card.screenshot({ path: 'D:/Temp/claude/scmp/reach-win.png' })
  console.log('errors:', errs.slice(0, 3))
  await b.close()
}
void main()
