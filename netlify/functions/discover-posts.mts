import type { Config, Context } from '@netlify/functions'
import { db } from './lib/firebase'
import { getTrackedProfiles } from './lib/competitor-tracker'

/**
 * Automatically discover posts from tracked profiles
 *
 * GET /api/discover-posts?profile_id=xxx
 * POST /api/discover-posts - Discover for all tracked profiles
 *
 * Uses multiple strategies:
 * 1. Extract post URLs from Facebook profile pages
 * 2. Search for posts via public feeds
 * 3. Pattern matching for post URL formats
 */

interface DiscoveredPost {
  url: string
  postId: string
  platform: string
  profileId: string
  discoveredAt: string
  title?: string
  author?: string
}

interface DiscoveryResult {
  profileId: string
  platform: string
  postsFound: number
  posts: DiscoveredPost[]
  discovered: string
  errors?: string[]
}

/**
 * Extract post URLs from Facebook profile HTML
 * Facebook post URLs follow patterns:
 * - https://www.facebook.com/{handle}/posts/{postId}
 * - https://www.facebook.com/share/p/{shareId}
 */
function extractFacebookPostUrls(html: string, handle: string): string[] {
  const urls = new Set<string>()

  // Pattern 1: /posts/ID format
  const postsPattern = /\/posts\/(\d+)/g
  let match
  while ((match = postsPattern.exec(html)) !== null) {
    urls.add(`https://www.facebook.com/${handle}/posts/${match[1]}`)
  }

  // Pattern 2: /share/p/ID format (shares)
  const sharePattern = /\/share\/p\/([a-zA-Z0-9]+)/g
  while ((match = sharePattern.exec(html)) !== null) {
    urls.add(`https://www.facebook.com/share/p/${match[1]}`)
  }

  // Pattern 3: Direct post URLs
  const directPattern = /https:\/\/www\.facebook\.com\/[^\/]+\/posts\/\d+/g
  const directMatches = html.match(directPattern) || []
  directMatches.forEach(url => urls.add(url))

  return Array.from(urls)
}

/**
 * Extract post URLs from Instagram profile HTML
 * Instagram Reels/Posts URLs:
 * - https://www.instagram.com/p/{postId}
 * - https://www.instagram.com/reel/{reelId}
 */
function extractInstagramPostUrls(html: string): string[] {
  const urls = new Set<string>()

  // Pattern 1: /p/ format (posts)
  const postsPattern = /\/p\/([a-zA-Z0-9_-]+)/g
  let match
  while ((match = postsPattern.exec(html)) !== null) {
    urls.add(`https://www.instagram.com/p/${match[1]}/`)
  }

  // Pattern 2: /reel/ format
  const reelPattern = /\/reel\/([a-zA-Z0-9_-]+)/g
  while ((match = reelPattern.exec(html)) !== null) {
    urls.add(`https://www.instagram.com/reel/${match[1]}/`)
  }

  return Array.from(urls)
}

/**
 * Fetch and parse a profile page to discover posts
 */
async function discoverPostsFromProfile(
  platform: string,
  handle: string,
  profileId: string,
  pageUrl: string,
): Promise<DiscoveredPost[]> {
  try {
    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) return []

    const html = await response.text()
    const discovered: DiscoveredPost[] = []
    const now = new Date().toISOString()

    let urls: string[] = []

    if (platform === 'Facebook') {
      urls = extractFacebookPostUrls(html, handle)
    } else if (platform === 'Instagram') {
      urls = extractInstagramPostUrls(html)
    }

    urls.forEach(url => {
      // Extract post ID from URL
      const postIdMatch = url.match(/\/([a-zA-Z0-9_-]+)\/?$/)
      const postId = (postIdMatch ? postIdMatch[1] : url.split('/').pop()) ?? ''

      discovered.push({
        url,
        postId,
        platform,
        profileId,
        discoveredAt: now,
        author: handle,
      })
    })

    return discovered
  } catch (err) {
    console.error(`Error discovering posts for ${handle}:`, err)
    return []
  }
}

/**
 * Save discovered posts to Firestore
 */
async function saveDiscoveredPosts(
  profileId: string,
  posts: DiscoveredPost[],
): Promise<void> {
  const store = db()
  if (!store || posts.length === 0) return

  const batch = store.batch()
  const collectionRef = store.collection('competitors').doc(profileId).collection('discovered_posts')

  posts.forEach(post => {
    const docRef = collectionRef.doc(post.postId)
    batch.set(docRef, {
      url: post.url,
      postId: post.postId,
      platform: post.platform,
      discoveredAt: new Date(post.discoveredAt),
      author: post.author,
      analyzed: false, // Not analyzed yet
    })
  })

  await batch.commit()
}

/**
 * Discover posts for all tracked profiles
 */
async function discoverAllPosts(): Promise<DiscoveryResult[]> {
  const profiles = await getTrackedProfiles()
  const results: DiscoveryResult[] = []

  for (const profile of profiles) {
    const pageUrl = profile.profileUrl || `https://www.${profile.platform.toLowerCase()}.com/${profile.handle}`

    console.log(`Discovering posts for ${profile.platform}:${profile.handle}...`)

    const discovered = await discoverPostsFromProfile(
      profile.platform,
      profile.handle,
      profile.id,
      pageUrl,
    )

    if (discovered.length > 0) {
      await saveDiscoveredPosts(profile.id, discovered)
    }

    results.push({
      profileId: profile.id,
      platform: profile.platform,
      postsFound: discovered.length,
      posts: discovered,
      discovered: new Date().toISOString(),
    })
  }

  return results
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  try {
    if (req.method === 'POST') {
      const results = await discoverAllPosts()
      return Response.json({
        ok: true,
        discovered: results.length,
        results,
        timestamp: new Date().toISOString(),
      })
    }

    if (req.method === 'GET') {
      const url = new URL(req.url)
      const profileId = url.searchParams.get('profile_id')

      if (!profileId) {
        return Response.json({ error: 'Pass ?profile_id=' }, { status: 400 })
      }

      const store = db()
      if (!store) {
        return Response.json({ error: 'Firebase not configured' }, { status: 503 })
      }

      const docs = await store
        .collection('competitors')
        .doc(profileId)
        .collection('discovered_posts')
        .limit(50)
        .get()

      return Response.json({
        profileId,
        discovered: docs.size,
        posts: docs.docs.map(doc => doc.data()),
      })
    }

    return Response.json({ error: 'Use GET or POST' }, { status: 405 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Post discovery error:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/discover-posts',
}
