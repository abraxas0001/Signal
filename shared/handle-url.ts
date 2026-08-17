import type { Platform } from './taxonomy'

/**
 * Working out which account a profile URL points at.
 *
 * This lives in `shared` because both sides need the same answer and they were
 * disagreeing. The client filed every pasted link under whatever the platform
 * picker happened to show, so adding Modi's Facebook page while the picker
 * still said YouTube stored it as a YouTube account — and because the id was
 * built from that too, a second platform for the same person collided with the
 * first instead of sitting beside it. You could attach his YouTube or his
 * Facebook, never both.
 *
 * A URL states its own platform. The picker is only for a bare handle, where
 * there is nothing else to go on.
 */

export interface HandleRef {
  platform: Platform
  handle: string
}

export function parseHandleUrl(input: string, hint?: Platform): HandleRef | null {
  const raw = input.trim()
  if (!raw) return null

  if (!/^https?:\/\//i.test(raw)) {
    if (!hint) return null
    return { platform: hint, handle: raw.replace(/^@/, '') }
  }

  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase()
  const seg = u.pathname.split('/').filter(Boolean)

  if (host.endsWith('youtube.com') || host === 'youtu.be') {
    const at = seg.find((s) => s.startsWith('@'))
    if (at) return { platform: 'YouTube', handle: at }
    const ci = seg.indexOf('channel')
    if (ci !== -1 && seg[ci + 1]) return { platform: 'YouTube', handle: seg[ci + 1]! }
    if (seg[0] === 'c' && seg[1]) return { platform: 'YouTube', handle: seg[1]! }
    return null
  }
  if (host === 'bsky.app' && seg[0] === 'profile' && seg[1]) {
    return { platform: 'Bluesky', handle: seg[1]! }
  }
  if (host.endsWith('instagram.com') && seg[0]) {
    return { platform: 'Instagram', handle: seg[0]! }
  }
  if (host.endsWith('facebook.com') && seg[0]) {
    return { platform: 'Facebook', handle: seg[0]! }
  }
  if (host.endsWith('linkedin.com')) {
    const i = seg.findIndex((s) => s === 'in' || s === 'company')
    if (i !== -1 && seg[i + 1]) return { platform: 'LinkedIn', handle: seg[i + 1]! }
    return null
  }
  if (host.endsWith('reddit.com')) {
    const i = seg.findIndex((s) => s === 'r' || s === 'user' || s === 'u')
    if (i !== -1 && seg[i + 1]) return { platform: 'Reddit', handle: seg[i + 1]! }
    return null
  }
  if (host === 'x.com' || host.endsWith('twitter.com')) {
    if (seg[0] && !['i', 'home', 'search'].includes(seg[0])) {
      return { platform: 'Twitter/X', handle: seg[0] }
    }
    return null
  }
  if (host.endsWith('t.me') && seg[0]) {
    return { platform: 'Telegram', handle: seg[0] === 's' ? (seg[1] ?? '') : seg[0] }
  }

  // Anything else carrying /@user is treated as a Mastodon instance; the
  // fediverse has no host list, so shape is the only signal available.
  const masto = seg.find((s) => s.startsWith('@'))
  if (masto) return { platform: 'Mastodon', handle: `${masto}@${host}` }
  return null
}
