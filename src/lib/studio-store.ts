import { scopedKey } from '@/lib/store'
import { deskKey } from '@/lib/personas'

/**
 * The posters this desk has made, and the cache that keeps them.
 *
 * What "View my posts" reads. A poster is a thing the office produced rather
 * than a measurement of the world, so it is kept the way the drafted posts in
 * suggest.ts are kept: on the device, scoped to whoever is signed in, and never
 * sent anywhere. Two desks sharing a laptop must not see each other's unposted
 * work, and a poster in a politician's name that has not gone out yet is
 * exactly the kind of record this product has no business holding on a server.
 *
 * That is also why this key is deliberately NOT in `SYNCED_BASES` in
 * desk-session.ts. The handles and the standing readings sync because a
 * handed-over desk is useless without them. A poster nobody has published yet
 * is not a finding, it is a draft, and it stays where it was made.
 */

export interface SavedPoster {
  id: string
  createdAt: string
  templateId: string
  headline: string
  body: string
  /** A data URL of the rendered poster, so the list can show it back. */
  thumbnail: string
}

/**
 * Read through a function rather than captured in a constant, same as every
 * other cache here: the active account changes at runtime, and a module-level
 * constant would freeze whichever account was signed in at first import.
 */
const KEY = (): string => deskKey('signal.posters.v1')

/**
 * How many posters are kept, and why there is a number at all.
 *
 * Every entry carries a data URL of a rendered poster. Even at thumbnail size
 * that is tens of kilobytes of base64 apiece, against a localStorage quota of a
 * few megabytes for the entire desk, and that quota is shared with the store
 * holding the office's actual records. An unbounded list here would not fail on
 * its own: it would fill the origin and take out the next write that mattered,
 * which this app has already been burned by twice (see the trims in handles.ts
 * and news-relevance.ts).
 *
 * The number comes from a measurement rather than a guess. A 360px wide JPEG
 * of these templates encodes to between 32KB and 51KB of base64, so sixteen of
 * them is roughly 700KB and the rest of the origin stays with the office's
 * records. The oldest fall off the end.
 */
const MAX_POSTERS = 16

function parse(raw: string | null): SavedPoster[] {
  if (!raw) return []
  const rows: unknown = JSON.parse(raw)
  if (!Array.isArray(rows)) return []
  const out: SavedPoster[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const o = row as Record<string, unknown>
    const id = typeof o['id'] === 'string' ? o['id'] : ''
    const createdAt = typeof o['createdAt'] === 'string' ? o['createdAt'] : ''
    const thumbnail = typeof o['thumbnail'] === 'string' ? o['thumbnail'] : ''
    // An entry with no id cannot be deleted and an entry with no thumbnail has
    // nothing to show, so neither is worth carrying forward.
    if (!id || !thumbnail) continue
    out.push({
      id,
      createdAt,
      templateId: typeof o['templateId'] === 'string' ? o['templateId'] : '',
      headline: typeof o['headline'] === 'string' ? o['headline'] : '',
      body: typeof o['body'] === 'string' ? o['body'] : '',
      thumbnail,
    })
  }
  return out
}

/** Newest first, which is the order the list shows them in. */
export function readPosters(): SavedPoster[] {
  try {
    return parse(localStorage.getItem(KEY()))
  } catch {
    // A corrupt or quota-evicted entry must not take the screen down with it.
    // An empty list costs the desk the posters it can no longer see; a thrown
    // error on mount costs it the studio.
    return []
  }
}

/**
 * Write the list, dropping the oldest entries if the origin is full.
 *
 * The retry is not optimism. A quota error rejects the whole write, so without
 * it a desk that has filled its storage would silently stop saving posters
 * while the studio went on reporting that it had saved them.
 */
function write(posters: SavedPoster[]): void {
  try {
    localStorage.setItem(KEY(), JSON.stringify(posters))
  } catch {
    try {
      localStorage.setItem(KEY(), JSON.stringify(posters.slice(0, Math.ceil(MAX_POSTERS / 4))))
    } catch {
      try {
        localStorage.setItem(KEY(), JSON.stringify(posters.slice(0, 1)))
      } catch {
        /* private mode, or an origin with nothing left to give: the poster the
           desk just made is still on screen and still downloadable, it just
           will not be in the list after a reload */
      }
    }
  }
}

/**
 * Keep a poster.
 *
 * Returns the saved record, with its id and timestamp filled in, whether or not
 * the write survived: the studio has the poster in hand either way and should
 * show it in the list for this session rather than pretending nothing happened.
 */
export function savePoster(p: Omit<SavedPoster, 'id' | 'createdAt'>): SavedPoster {
  const saved: SavedPoster = { ...p, id: newId(), createdAt: new Date().toISOString() }
  write([saved, ...readPosters()].slice(0, MAX_POSTERS))
  return saved
}

export function deletePoster(id: string): void {
  write(readPosters().filter((p) => p.id !== id))
}

/**
 * `crypto.randomUUID` is only exposed on a secure origin, and the office opens
 * this over plain http on the local network often enough to matter. The
 * fallback needs no cryptographic strength: it distinguishes rows in one
 * device's own list, and nothing is authorised by it.
 */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
