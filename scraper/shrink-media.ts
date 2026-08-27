/**
 * Shrink the downloaded post pictures to the size they are actually shown at.
 *
 *   npm run scraper:shrink
 *
 * The scrape stores whatever the feed served, which is sized for a full-width
 * timeline: measured across the demo set, a median of 76KB and a largest of
 * 632KB, for 18MB in total. The card that displays them is 186 pixels wide.
 *
 * That gap costs three separate things — a repository carrying 18MB of
 * politicians' photographs, a deploy pushing them, and a visitor downloading a
 * 632KB image to fill a thumbnail. Resizing to 480px on the long edge keeps a
 * card that still looks right on a retina screen at twice its rendered size,
 * and drops the total by roughly nine tenths.
 *
 * Idempotent: an image already at or below the target is left alone, so this
 * can be run after every scrape without recompressing the same files over and
 * over — each pass through a JPEG encoder loses a little more.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

const MEDIA_DIR = resolve(process.cwd(), 'public/demo-media')

/** Long edge, in pixels. The card is 186 wide; this is comfortably retina. */
const MAX_EDGE = 480
const QUALITY = 78

async function main(): Promise<void> {
  if (!existsSync(MEDIA_DIR)) {
    console.log('No downloaded media yet. Run `npm run scraper:media` first.')
    process.exit(1)
  }

  const files = readdirSync(MEDIA_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  let before = 0
  let after = 0
  let skipped = 0

  for (const file of files) {
    const path = resolve(MEDIA_DIR, file)
    const original = statSync(path).size
    before += original

    try {
      const image = sharp(readFileSync(path))
      const meta = await image.metadata()
      const longest = Math.max(meta.width ?? 0, meta.height ?? 0)

      // Already small enough. Re-encoding would only lose quality.
      if (longest > 0 && longest <= MAX_EDGE) {
        after += original
        skipped++
        continue
      }

      const out = await image
        .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: QUALITY, mozjpeg: true })
        .toBuffer()

      // Keep whichever is smaller. A heavily-compressed source can come back
      // larger from a re-encode, and swapping in a bigger file would be the
      // opposite of the point.
      if (out.length < original) {
        writeFileSync(path, out)
        after += out.length
      } else {
        after += original
        skipped++
      }
    } catch {
      // A file sharp cannot read stays exactly as it is. It still displays.
      after += original
      skipped++
    }
  }

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`
  console.log(
    `\n${files.length} images: ${mb(before)} -> ${mb(after)} ` +
      `(${Math.round((1 - after / before) * 100)}% smaller, ${skipped} left as they were)\n`,
  )
}

void main()
