import type { Platform, PostType } from '../../../shared/taxonomy'

export interface UrlIdentity {
  platform: Platform
  /** Platform-native id when we can parse one: video id, tweet id, share slug. */
  id: string | null
  /** Best guess before fetching; adapters correct it afterwards. */
  postType: PostType
  /** Cleaned URL with tracking params stripped. */
  canonical: string
  /** Author handle when it is present in the path itself. */
  handle: string | null
}

/** Query params that are pure tracking noise and break cache keys. */
const JUNK_PARAMS = new Set([
  'si',
  'fbclid',
  'gclid',
  'igshid',
  'igsh',
  'mibextid',
  'ref',
  'ref_src',
  'ref_url',
  'source',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  '_ga',
  'mc_cid',
  'mc_eid',
  'rdid',
  'share_url',
  'app',
  'feature',
  'pp',
])

/** Params that are load-bearing and must survive normalisation. */
const KEEP_ALWAYS = new Set(['v', 't', 'id', 'story_fbid', 'eid', 'edate', 'pgid'])

export function normaliseUrl(raw: string): string {
  let input = raw.trim()
  if (!input) throw new Error('No URL provided')

  // People paste "youtu.be/abc" or "www.facebook.com/..." without a scheme.
  if (!/^https?:\/\//i.test(input)) input = `https://${input}`

  let u: URL
  try {
    u = new URL(input)
  } catch {
    throw new Error('That does not look like a valid link')
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http and https links are supported')
  }

  for (const key of [...u.searchParams.keys()]) {
    if (KEEP_ALWAYS.has(key)) continue
    if (JUNK_PARAMS.has(key) || key.startsWith('utm_')) u.searchParams.delete(key)
  }

  u.hash = ''
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
  // Trailing slashes make otherwise-identical URLs miss the cache.
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '')
  }
  return u.toString()
}

// The SSRF boundary lives in ./ssrf.ts and is enforced inside ./fetcher.ts on
// every request and every redirect hop. It is deliberately NOT here: an earlier
// version of this file string-matched the hostname, which silently allowed
// bracketed IPv6 literals ("[::1]" never equals "::1") and every public DNS
// name that resolves into private space. Anything that needs to reach the
// network must go through fetcher.ts.

const YT_HOSTS = ['youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com']
const FB_HOSTS = ['facebook.com', 'fb.com', 'fb.watch', 'm.facebook.com', 'mbasic.facebook.com']
const X_HOSTS = ['twitter.com', 'x.com', 'mobile.twitter.com', 'vxtwitter.com', 'fxtwitter.com']

export function identify(rawUrl: string): UrlIdentity {
  const canonical = normaliseUrl(rawUrl)
  const u = new URL(canonical)
  const host = u.hostname
  const path = u.pathname
  const seg = path.split('/').filter(Boolean)

  const base = (platform: Platform, rest: Partial<UrlIdentity> = {}): UrlIdentity => ({
    platform,
    id: null,
    postType: 'Original Post',
    canonical,
    handle: null,
    ...rest,
  })

  // ── YouTube ───────────────────────────────────────────────────────────────
  if (YT_HOSTS.includes(host)) {
    let id: string | null = null
    let postType: PostType = 'Video'

    if (host === 'youtu.be') id = seg[0] ?? null
    else if (path === '/watch') id = u.searchParams.get('v')
    else if (seg[0] === 'shorts') {
      id = seg[1] ?? null
      postType = 'Short / Reel'
    } else if (seg[0] === 'live') {
      id = seg[1] ?? null
      postType = 'Live'
    } else if (seg[0] === 'embed') id = seg[1] ?? null

    // Video ids are exactly 11 chars of [A-Za-z0-9_-].
    if (id && !/^[A-Za-z0-9_-]{11}$/.test(id)) id = null
    return base('YouTube', { id, postType })
  }

  // ── Twitter / X ───────────────────────────────────────────────────────────
  if (X_HOSTS.includes(host)) {
    const i = seg.indexOf('status')
    const id = i >= 0 ? (seg[i + 1]?.match(/^\d+$/)?.[0] ?? null) : null
    const handle = i > 0 ? (seg[0] ?? null) : null
    return base('Twitter/X', { id, handle, postType: 'Original Post' })
  }

  // ── Facebook ──────────────────────────────────────────────────────────────
  if (FB_HOSTS.includes(host)) {
    // /share/p/<slug>  · /share/v/<slug>  · /share/r/<slug>
    if (seg[0] === 'share') {
      const kind = seg[1]
      return base('Facebook', {
        id: seg[2] ?? null,
        postType: kind === 'v' || kind === 'r' ? 'Video' : 'Original Post',
      })
    }
    if (host === 'fb.watch') return base('Facebook', { id: seg[0] ?? null, postType: 'Video' })

    const postIdx = seg.findIndex((s) => s === 'posts' || s === 'videos' || s === 'reel')
    if (postIdx > 0) {
      return base('Facebook', {
        id: seg[postIdx + 1] ?? null,
        handle: seg[0] ?? null,
        postType: seg[postIdx] === 'posts' ? 'Original Post' : 'Video',
      })
    }
    const storyId = u.searchParams.get('story_fbid')
    return base('Facebook', { id: storyId, handle: seg[0] ?? null })
  }

  // ── Instagram ─────────────────────────────────────────────────────────────
  if (host === 'instagram.com' || host === 'instagr.am' || host === 'ddinstagram.com') {
    const kind = seg[0]
    if (kind === 'p' || kind === 'reel' || kind === 'reels' || kind === 'tv') {
      return base('Instagram', {
        id: seg[1] ?? null,
        postType: kind === 'p' ? 'Image' : 'Short / Reel',
      })
    }
    return base('Instagram', { handle: seg[0] ?? null })
  }

  if (host === 'threads.net' || host === 'threads.com') {
    const i = seg.indexOf('post')
    return base('Threads', {
      id: i >= 0 ? (seg[i + 1] ?? null) : null,
      handle: seg[0]?.replace(/^@/, '') ?? null,
    })
  }

  if (host === 'tiktok.com' || host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
    const i = seg.indexOf('video')
    return base('TikTok', {
      id: i >= 0 ? (seg[i + 1] ?? null) : (seg[0] ?? null),
      handle: seg[0]?.startsWith('@') ? seg[0].slice(1) : null,
      postType: 'Short / Reel',
    })
  }

  if (host === 'reddit.com' || host === 'old.reddit.com' || host === 'redd.it') {
    const i = seg.indexOf('comments')
    return base('Reddit', { id: i >= 0 ? (seg[i + 1] ?? null) : (seg[0] ?? null) })
  }

  if (host === 'linkedin.com') {
    return base('LinkedIn', { id: seg[seg.length - 1] ?? null })
  }

  if (host === 't.me' || host === 'telegram.me') {
    return base('Telegram', { id: seg[1] ?? null, handle: seg[0] ?? null })
  }

  // bsky.app/profile/<handle>/post/<rkey>
  if (host === 'bsky.app' || host === 'staging.bsky.app') {
    const i = seg.indexOf('post')
    return base('Bluesky', {
      id: i >= 0 ? (seg[i + 1] ?? null) : null,
      handle: seg[0] === 'profile' ? (seg[1] ?? null) : null,
    })
  }

  if (host === 'pinterest.com' || host.endsWith('.pinterest.com') || host === 'pin.it') {
    const i = seg.indexOf('pin')
    return base('Pinterest', { id: i >= 0 ? (seg[i + 1] ?? null) : (seg[0] ?? null), postType: 'Image' })
  }

  if (host === 'snapchat.com' || host.endsWith('.snapchat.com')) {
    return base('Snapchat', { id: seg[seg.length - 1] ?? null, postType: 'Short / Reel' })
  }

  // Mastodon is federated, so there is no host list — detect by URL shape.
  // Both /@user/<numeric id> and /users/<user>/statuses/<id> are canonical.
  const mastoUser = /^@[\w.-]+$/.test(seg[0] ?? '') && /^\d+$/.test(seg[1] ?? '')
  const mastoStatuses = seg[0] === 'users' && seg[2] === 'statuses' && /^\d+$/.test(seg[3] ?? '')
  if (mastoUser || mastoStatuses) {
    return base('Mastodon', {
      id: mastoUser ? (seg[1] as string) : (seg[3] as string),
      handle: (mastoUser ? seg[0]?.slice(1) : seg[1]) ?? null,
    })
  }

  // ── Anything else: a news site, e-paper, or blog ───────────────────────────
  return base(genericPlatform(canonical), { postType: 'Article' })
}

/**
 * The floor classification for a URL that matched no platform.
 *
 * Exported because Mastodon is detected by URL *shape* — the fediverse has no
 * host list — so a page that merely looks like `/@user/12345` can be routed to
 * the Mastodon adapter without being Mastodon. When the instance API disowns
 * it, the caller needs to re-label the post as what it actually is rather than
 * leaving a wrong platform on the report.
 */
export function genericPlatform(url: string): Platform {
  const u = new URL(url)
  const isNewsish =
    /(^|\.)(news|epaper|paper|times|express|hindu|sakshi|eenadu|way2|abp|ndtv|bbc|reuters|thewire|scroll|theprint)/i.test(
      u.hostname,
    ) || /\/(news|article|story|politics|india)\//i.test(u.pathname)

  return isNewsish ? 'News Site' : 'Blog'
}

/** Human label for the platform chip. */
export function platformLabel(p: Platform): string {
  return p === 'Twitter/X' ? 'X' : p
}
