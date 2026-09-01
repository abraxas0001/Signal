/**
 * Bring the profile photos in-house.
 *
 *   npm run scraper:avatars
 *
 * TWO PROBLEMS, BOTH MEASURED.
 *
 * First, the CDN URLs the scrape records cannot be displayed by this app at
 * all. Every one fails in the browser with
 * `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`: these hosts send a
 * Cross-Origin-Resource-Policy that refuses embedding anywhere but the platform
 * itself. Six politicians rendered with no faces, and would however many times
 * the scrape ran. Downloading once and serving from `public/` makes them
 * same-origin. It also fixes a slower failure — those URLs carry signed expiry
 * parameters and rot within days, so a demo shown next week would have been
 * full of broken images even where they had worked.
 *
 * Second, the fetch has to happen ON the platform's own page. A first attempt
 * ran `fetch()` from a blank tab, whose origin is null: Instagram refused
 * outright and the rest returned 0–1KB placeholders that looked like successes.
 * Hence the navigation before each download, and hence MIN_BYTES — a profile
 * photo that arrives under three kilobytes is a tracking pixel or an error
 * page, not a face, and it is better recorded as absent.
 *
 * Absent is a perfectly good outcome: a null photo renders as initials, which
 * reads as ordinary. A broken image reads as a bug.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { newPage, closeContext, goto } from './browser'

const OUT_JSON = resolve(process.cwd(), 'public/demo-politicians.json')
const AVATAR_DIR = resolve(process.cwd(), 'public/demo-avatars')
const MEDIA_DIR = resolve(process.cwd(), 'public/demo-media')

/** How many post pictures to keep per handle. See the loop for why it is capped. */
const THUMBS_PER_HANDLE = 25

/** Below this, what came back is not a photograph. */
const MIN_BYTES = 3_000

/**
 * How to find the profile photo, per platform, by URL SHAPE rather than by
 * position.
 *
 * Measured on live pages. Each platform stamps its profile pictures into a
 * distinct CDN path, and matching on that is far steadier than "the first image
 * in the header" — a profile page is full of other people's faces, in comments,
 * suggestions and the posts themselves, and any positional rule eventually
 * picks one of them.
 *
 *   X          pbs.twimg.com/profile_images/...        (200x200 measured)
 *   LinkedIn   media.licdn.com/.../profile-displayphoto (100 and 800 variants)
 *   Instagram  .../t51.82787-19/...                     (150x150 measured)
 *   Facebook   an <svg><image> mask, not an <img> at all
 */
const PATTERN: Record<string, RegExp> = {
  'Twitter/X': /profile_images/,
  LinkedIn: /profile-displayphoto/,
  Instagram: /t51\.82787-19/,
  Facebook: /scontent|fbcdn/,
  YouTube: /yt3.(ggpht|googleusercontent)/,
}

/**
 * Where the profile photo sits, per platform — tried before the pattern sweep.
 *
 * The sweep alone is not selective enough. Matching a CDN path across the whole
 * page also matches every other face on it: suggested accounts, commenters,
 * people tagged in posts. On Instagram that produced three politicians sharing
 * one byte-identical avatar, because the largest matching image on each page was
 * the same piece of shared furniture rather than any of them.
 *
 * Scoping to the header answers "whose page is this" instead of "what is the
 * biggest image here". The sweep stays as a fallback for a layout these miss.
 */
const SCOPED: Record<string, string[]> = {
  'Twitter/X': ['[data-testid^="UserAvatar-Container"] img', 'a[href$="/photo"] img'],
  Instagram: ['header img', 'img[alt*="profile picture" i]'],
  // Facebook masks the photo in an <svg><image>, which is why this reaches for
  // the element type rather than an <img>.
  Facebook: ['svg image', 'image'],
  LinkedIn: ['img[src*="profile-displayphoto"]'],
  YouTube: ['yt-img-shadow#avatar img', '#avatar img', 'img.yt-spec-avatar-shape__image'],
}

function extFrom(contentType: string | null, url: string): string {
  if (contentType?.includes('png')) return 'png'
  if (contentType?.includes('webp')) return 'webp'
  if (/\.png(\?|$)/i.test(url)) return 'png'
  if (/\.webp(\?|$)/i.test(url)) return 'webp'
  return 'jpg'
}

interface Post {
  url: string
  thumbnailUrl: string | null
  likes: number | null
  comments: number | null
  [k: string]: unknown
}
interface Handle {
  platform: string
  handle: string
  profileUrl: string
  avatarUrl: string | null
  posts?: Post[]
  failure?: string
  [k: string]: unknown
}
interface Person {
  key: string
  name: string
  handles: Handle[]
  [k: string]: unknown
}
interface File {
  people: Record<string, Person>
  /** The accounts that talk about them. Same shape, same treatment. */
  creators?: Person[]
  [k: string]: unknown
}

/** Write the dataset back, so an interrupted run keeps what it downloaded. */
function save(file: File): void {
  writeFileSync(OUT_JSON, JSON.stringify(file, null, 2))
}

async function main(): Promise<void> {
  if (!existsSync(OUT_JSON)) {
    console.log('No demo dataset yet. Run `npm run scraper:demo` first.')
    process.exit(1)
  }

  const file = JSON.parse(readFileSync(OUT_JSON, 'utf8')) as File
  mkdirSync(AVATAR_DIR, { recursive: true })
  mkdirSync(MEDIA_DIR, { recursive: true })

  /** md5 of every photo written, so no two people can share one. */
  const seenImages = new Map<string, string>()
  let saved = 0
  let cleared = 0
  let thumbs = 0

  try {
    // Politicians and the outlets covering them, in one pass: an influencer
    // row needs a face as much as a rival row does.
    for (const person of [...Object.values(file.people), ...(file.creators ?? [])]) {
      for (const h of person.handles) {
        if (h.failure) continue

        const page = await newPage(true)
        try {
          await goto(page, h.profileUrl)
          await page.waitForTimeout(4_000)

          const pattern = PATTERN[h.platform]?.source ?? 'profile'
          const scoped = SCOPED[h.platform] ?? []
          /**
           * Every candidate, biggest first, tried until one is a real photo.
           *
           * Taking the first match failed on both platforms that failed, for
           * two different reasons. LinkedIn publishes the same face at several
           * sizes and lists the smallest first, so Modi's arrived as a 2,945-byte
           * `profile-displayphoto-shrink_100_100` — just under the floor —
           * while an `_800_800` of the same image sat further down the page.
           * Facebook masks its profile photo inside an `<svg><image>` and fills
           * the page with ordinary `<img>` elements that match the same CDN
           * pattern, so the first hit was a placeholder.
           *
           * Ranking by the size hint in the URL, then by rendered width, then
           * trying each in turn, fixes both without either platform needing a
           * rule of its own.
           */
          const got = await page.evaluate(async (args: { pat: string; scoped: string[] }) => {
            const re = new RegExp(args.pat)
            const found: { src: string; score: number }[] = []

            /**
             * The header first, at a score above anything the sweep can reach.
             *
             * These selectors name the element that IS the profile photo, so
             * when one matches it should win outright — not compete on size
             * with a larger picture from a post further down the page.
             */
            for (const sel of args.scoped) {
              for (const el of Array.from(document.querySelectorAll(sel))) {
                const src =
                  (el as HTMLImageElement).currentSrc ||
                  (el as HTMLImageElement).src ||
                  el.getAttribute('xlink:href') ||
                  el.getAttribute('href') ||
                  ''
                if (src) found.push({ src, score: 100000 })
              }
            }

            /**
             * The size scoring is written out twice, on purpose.
             *
             * A `const scoreOf = (...) => ...` helper here is compiled by tsx
             * through esbuild's keepNames, which wraps it in a `__name(...)`
             * call that does not exist in the page — so the whole evaluate
             * throws ReferenceError. It has now cost this project twice: once
             * silently, in the X adapter, where it looked like "the account has
             * no posts"; and once here, where the catch turned it into "no
             * photo" and erased fifteen good ones. Nothing inside a function
             * passed to `evaluate` may be a named function. Repetition is the
             * price.
             *
             * The score prefers the dimensions platforms stamp into the path —
             * `_800_800`, `_200x200`, `/150x150/` — and falls back to how large
             * the element actually rendered.
             */
            for (const el of Array.from(document.querySelectorAll('img'))) {
              const i = el as HTMLImageElement
              const src = i.currentSrc || i.src
              if (src && re.test(src) && i.naturalWidth >= 80) {
                const m = src.match(/(\d{2,4})[x_](\d{2,4})/)
                const fromUrl = m ? Math.max(Number(m[1]), Number(m[2])) : 0
                found.push({ src, score: Math.max(fromUrl, i.naturalWidth) })
              }
            }
            for (const el of Array.from(document.querySelectorAll('image'))) {
              const href = el.getAttribute('xlink:href') ?? el.getAttribute('href') ?? ''
              // An <image> has no naturalWidth; its width attribute is the only
              // hint, and the profile mask is the largest one on the page.
              if (href && re.test(href)) {
                const m = href.match(/(\d{2,4})[x_](\d{2,4})/)
                const fromUrl = m ? Math.max(Number(m[1]), Number(m[2])) : 0
                found.push({ src: href, score: Math.max(fromUrl, Number(el.getAttribute('width') ?? 0)) })
              }
            }
            if (found.length === 0) return null

            found.sort((a, b) => b.score - a.score)

            // De-duplicate: the same photo often appears several times over.
            const seen = new Set<string>()
            const ordered = found.filter((f) => !seen.has(f.src) && seen.add(f.src))

            const results: { src: string; type: string | null; bytes: number[] }[] = []
            for (const cand of ordered.slice(0, 6)) {
              try {
                const res = await fetch(cand.src)
                if (!res.ok) continue
                const buf = await res.arrayBuffer()
                if (buf.byteLength < 3000) continue // a placeholder; keep looking
                results.push({
                  src: cand.src,
                  type: res.headers.get('content-type'),
                  bytes: Array.from(new Uint8Array(buf)),
                })
                // Three is enough for the caller to skip past a duplicate.
                if (results.length >= 3) break
              } catch {
                /* try the next candidate */
              }
            }
            return results.length > 0 ? results : null
          }, { pat: pattern, scoped })

          /**
           * Refuse a photograph another person is already using.
           *
           * Measured: three politicians ended up with one byte-identical
           * Instagram avatar, because the page-wide sweep found the same piece
           * of shared furniture on each of their pages and it was the largest
           * thing matching. Two people cannot have the same face, so an exact
           * content match is proof the wrong element was read — and it is
           * cheaper to detect here than to notice on the dashboard, which is how
           * it was found.
           */
          const pick = (got ?? []).find((c) => {
            if (c.bytes.length < MIN_BYTES) return false
            const digest = createHash('md5').update(Buffer.from(c.bytes)).digest('hex')
            if (seenImages.has(digest)) return false
            seenImages.set(digest, `${person.key}/${h.platform}`)
            return true
          })

          // Not `continue`: the post pictures below are a separate job on the
          // same page, and skipping them because a profile photo could not be
          // read is how ten YouTube channels ended up with neither.
          if (!pick) {
            h.avatarUrl = null
            cleared++
            console.log(
              `  ${person.name.padEnd(26)} ${h.platform.padEnd(11)} ` +
                `${got ? 'no usable candidate' : 'no match'} — cleared`,
            )
          } else {

          const slug = h.platform.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          const filename = `${person.key}-${slug}.${extFrom(pick.type, pick.src)}`
          writeFileSync(resolve(AVATAR_DIR, filename), Buffer.from(pick.bytes))
          h.avatarUrl = `/demo-avatars/${filename}`
            saved++
            console.log(
              `  ${person.name.padEnd(26)} ${h.platform.padEnd(11)} ` +
                `${(pick.bytes.length / 1024).toFixed(0)}KB -> ${filename}`,
            )
          }
          /**
           * The post pictures, from the page already open.
           *
           * Capped per handle. The cap started at a dozen, when the dashboard
           * showed three posts a side; it now shows eight a side and the
           * compare board opens any of them, so the cap sits at the full
           * stored reading — a picture that is missing is a row that reads as
           * broken, and that costs more than the request did.
           */
          const posts = (h.posts ?? []) as Post[]

          /**
           * YouTube's pictures are already fine, and must be left alone.
           *
           * Every other platform here serves post images from a CDN that
           * refuses cross-origin embedding and signs its URLs with an expiry,
           * so they have to be downloaded. `i.ytimg.com` does neither: the
           * address is derived from the video id, it embeds anywhere, and it
           * does not rot. Downloading them would waste a request each; nulling
           * the ones past the cap — which is what happens to every other
           * platform — would throw away a permanently good URL and blank the
           * card for nothing.
           */
          if (h.platform === 'YouTube') {
            await page.close().catch(() => {})
            continue
          }

          /**
           * Download the posts that will actually be SHOWN, not the first ones
           * scraped.
           *
           * This took `posts.slice(0, 12)` — the first twelve in scrape order —
           * while every screen that displays a post ranks by engagement. The two
           * orders barely overlap: measured on this desk, the ten most-engaging
           * Facebook posts sat at scrape indexes 16, 3, 20, 22, 23, 19, 18, 15,
           * 11 and 12, so ONE of the ten had a picture and nine fell through to
           * the blank platform tile. The cap was doing its job; it was capping
           * the wrong end of the list.
           */
          const ranked = [...posts]
            .sort(
              (a, b) =>
                (b.likes ?? 0) + (b.comments ?? 0) - ((a.likes ?? 0) + (a.comments ?? 0)),
            )
            .slice(0, THUMBS_PER_HANDLE)
          const wanted = new Set(ranked.map((x) => x.url))

          let gotThumbs = 0
          for (const post of posts) {
            const src = post.thumbnailUrl
            // Already downloaded. Keep it whatever its rank — the file exists,
            // and throwing it away to honour a cap would only blank a card.
            if (src?.startsWith('/demo-media/')) continue
            if (!wanted.has(post.url)) {
              // Outside the cap: drop the CDN address rather than ship one that
              // will be a broken image within days.
              post.thumbnailUrl = null
              continue
            }
            if (!src) continue
            try {
              const bytes = await page.evaluate(async (u: string) => {
                const res = await fetch(u)
                if (!res.ok) return null
                const buf = await res.arrayBuffer()
                return Array.from(new Uint8Array(buf))
              }, src)
              if (!bytes || bytes.length < MIN_BYTES) {
                post.thumbnailUrl = null
                continue
              }
              const id = createHash('md5').update(post.url).digest('hex').slice(0, 12)
              const name = `${id}.jpg`
              writeFileSync(resolve(MEDIA_DIR, name), Buffer.from(bytes))
              post.thumbnailUrl = `/demo-media/${name}`
              gotThumbs++
            } catch {
              post.thumbnailUrl = null
            }
          }
          if (gotThumbs > 0) {
            console.log(`  ${' '.repeat(26)} ${h.platform.padEnd(11)} ${gotThumbs} post pictures`)
            thumbs += gotThumbs
          }
          save(file)
        } catch (err) {
          /**
           * A crash must not destroy a photo that already works.
           *
           * This used to null the entry on any error, which is fine for a stale
           * CDN link and catastrophic for a local one: a single bug inside the
           * page — a ReferenceError thrown by every call — erased fifteen
           * already-downloaded photos in one run, and the file on disk was
           * rewritten before anyone could see it happen. A path under
           * /demo-avatars/ is a file we hold; failing to re-fetch it says
           * nothing about whether it is still good.
           */
          const keep = h.avatarUrl?.startsWith('/demo-avatars/') ?? false
          if (!keep) h.avatarUrl = null
          cleared++
          console.log(
            `  ${person.name.padEnd(26)} ${h.platform.padEnd(11)} ` +
              `${((err as Error).message.split('\n')[0] ?? '').slice(0, 40)} — ` +
              `${keep ? 'kept existing' : 'cleared'}`,
          )
        } finally {
          await page.close().catch(() => {})
        }
      }
    }
  } finally {
    await closeContext()
  }

  writeFileSync(OUT_JSON, JSON.stringify(file, null, 2))
  console.log(`\n${saved} photos saved to public/demo-avatars, ${cleared} recorded as absent.`)
  console.log(`Rewrote ${OUT_JSON}\n`)
}

void main()
