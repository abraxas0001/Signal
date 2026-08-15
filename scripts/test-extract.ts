/**
 * Extraction smoke test.
 *
 * Runs every adapter against the real links from the Eluru workbook. This is
 * the part of the system most likely to break without warning — the platforms
 * change their markup on their schedule, not ours — so this exists to tell us
 * the day a method dies, rather than a user discovering it.
 *
 *   npx tsx scripts/test-extract.ts            # the workbook's own links
 *   npx tsx scripts/test-extract.ts <url>      # a single URL
 */

import { extractPost } from '../netlify/functions/lib/extract/index'

const CASES: Array<{ label: string; url: string }> = [
  { label: 'YouTube (Telugu, Journalist YNR)', url: 'https://youtu.be/_hFUH1dUp1g?si=xX-qxHeXWfxYU5RT' },
  { label: 'X / Twitter (Greatandhra)', url: 'https://x.com/greatandhranews/status/1994279726521688528?s=46' },
  { label: 'X / Twitter (Telugu feed)', url: 'https://x.com/telugufeedsite/status/1994249336474263717?s=46' },
  { label: 'Facebook post (share/p)', url: 'https://www.facebook.com/share/p/17Tdmz2JiY/' },
  { label: 'Facebook video (share/v)', url: 'https://www.facebook.com/share/v/1FDQEJGAdN/' },
  { label: 'News e-paper (Sakshi)', url: 'https://epaper.sakshi.com/Eluru_Rural?eid=30&edate=22/11/2025&pgid=747688&device=desktop&view=3' },
  { label: 'WhatsApp-style shortlink (Way2)', url: 'https://way2.co/MTg0MTkxOTY=/3_lng1' },
  // Open protocols. These two are the reference for what a complete extraction
  // looks like: every metric, exact, keyless, from a documented public API.
  { label: 'Bluesky (AT Protocol)', url: 'https://bsky.app/profile/bsky.app/post/3msqpusnigc2t' },
  { label: 'Mastodon (mastodon.social)', url: 'https://mastodon.social/@Gargron/117082615500869429' },
  // Closed platforms reached without a key. Each of these is one specific
  // trick away from returning nothing, and each fails as HTTP 200 when it
  // breaks — which is exactly why they are in the standing test set.
  { label: 'Threads (crawler-gated JSON)', url: 'https://www.threads.com/@zuck/post/Db2wI-DilLt' },
  { label: 'Reddit (embed host)', url: 'https://www.reddit.com/r/explainlikeimfive/comments/1vnq0vm/eli5_why_do_people_speak_english_for_example_with/' },
  { label: 'Pinterest (pin resource)', url: 'https://www.pinterest.com/pin/99360735500167749/' },
  { label: 'Snapchat Spotlight (__NEXT_DATA__)', url: 'https://www.snapchat.com/@mrblackstack1/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYeXlodGxjbGJ0AZ9mPVehAZ9mPVd6AAAAAw' },
  { label: 'TikTok (embed v2) — blocked from Indian IPs', url: 'https://www.tiktok.com/@zachking/video/6749520869598481669' },
  // Instagram, LinkedIn and Telegram had adapters but no case here, which is
  // exactly how a reel shipped with Facebook's bootstrap JavaScript rendered
  // as the author's name: every synthetic test used an invalid shortcode,
  // which fails before reaching the line that was broken.
  { label: 'Instagram reel (embed + og)', url: 'https://www.instagram.com/reel/Dbvhbzzg5Su/' },
  { label: 'Telegram channel post', url: 'https://t.me/telegram/83' },
]

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const YEL = '\x1b[33m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

function metric(m: { value: number | null; source: string; display?: string }): string {
  if (m.value == null) return `${DIM}—${OFF}`
  const approx = m.display ? ` ${DIM}(${m.display})${OFF}` : ''
  return `${m.value.toLocaleString('en-IN')}${approx} ${DIM}[${m.source}]${OFF}`
}

async function run(label: string, url: string) {
  console.log(`\n${BOLD}${'─'.repeat(72)}${OFF}`)
  console.log(`${BOLD}${label}${OFF}`)
  console.log(`${DIM}${url}${OFF}`)

  const started = Date.now()
  try {
    const { snapshot, extra } = await extractPost(url, {
      keys: {
        youtube: process.env['YOUTUBE_API_KEY'],
        meta: process.env['META_APP_TOKEN'],
      },
    })
    const ms = Date.now() - started

    const ok = snapshot.extraction.attempts.some((a) => a.ok)
    console.log(
      `  ${ok ? `${GREEN}OK${OFF}` : `${RED}FAILED${OFF}`}  ${DIM}${ms}ms · ${snapshot.platform} · confidence=${snapshot.extraction.confidence}${OFF}`,
    )

    console.log(`  ${DIM}attempts:${OFF}`)
    for (const a of snapshot.extraction.attempts) {
      const mark = a.ok ? `${GREEN}✓${OFF}` : `${DIM}·${OFF}`
      console.log(`    ${mark} ${a.strategy}${a.note ? ` ${DIM}— ${a.note}${OFF}` : ''}`)
    }

    console.log(`  author   : ${snapshot.author.name ?? `${DIM}—${OFF}`}${snapshot.author.verified ? ' ✔' : ''}`)
    console.log(`  followers: ${metric(snapshot.author.followers)}`)
    console.log(`  published: ${snapshot.publishedAt ?? `${DIM}—${OFF}`}`)
    console.log(`  likes    : ${metric(snapshot.engagement.likes)}`)
    console.log(`  comments : ${metric(snapshot.engagement.comments)}`)
    console.log(`  shares   : ${metric(snapshot.engagement.shares)}`)
    console.log(`  views    : ${metric(snapshot.engagement.views)}`)

    const text = snapshot.content.text?.replace(/\s+/g, ' ').trim() ?? ''
    console.log(`  title    : ${snapshot.content.title?.slice(0, 70) ?? `${DIM}—${OFF}`}`)
    console.log(
      `  text     : ${text ? `${text.slice(0, 90)}${text.length > 90 ? '…' : ''} ${DIM}(${text.length} chars)${OFF}` : `${DIM}none${OFF}`}`,
    )
    console.log(`  media    : ${snapshot.media.length ? snapshot.media[0]!.kind : `${DIM}none${OFF}`}`)

    if (Object.keys(extra).length) {
      const keys = Object.keys(extra).filter((k) => extra[k] != null)
      if (keys.length) console.log(`  extra    : ${DIM}${keys.join(', ')}${OFF}`)
    }

    if (snapshot.extraction.blocked) {
      console.log(`  ${YEL}blocked${OFF}  : ${snapshot.extraction.blocked.reason}`)
      console.log(`  ${DIM}rescue   : ${snapshot.extraction.blocked.suggestion}${OFF}`)
    }

    return ok
  } catch (err) {
    console.log(`  ${RED}THREW${OFF}  ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

const args = process.argv.slice(2)
const cases = args.length ? args.map((url) => ({ label: 'Custom', url })) : CASES

let passed = 0
for (const c of cases) {
  if (await run(c.label, c.url)) passed++
}

console.log(`\n${BOLD}${'═'.repeat(72)}${OFF}`)
console.log(`${BOLD}${passed}/${cases.length} extracted something usable${OFF}\n`)
