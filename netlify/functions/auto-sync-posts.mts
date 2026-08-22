import type { Config } from '@netlify/functions'
import { db } from './lib/firebase'
import { getTrackedProfiles } from './lib/competitor-tracker'

/**
 * Scheduled Job: Auto-sync discovered posts every 6 hours
 *
 * This function:
 * 1. Discovers new posts from all tracked profiles
 * 2. Extracts engagement metrics (likes, comments, shares)
 * 3. Stores in Firestore
 * 4. Updates dashboard automatically
 *
 * Runs on schedule: Every 6 hours (cron 0 star/6 star star star)
 * Manual trigger: POST /api/auto-sync-posts
 */

interface SyncStatus {
  profileId: string
  platform: string
  handle: string
  postsDiscovered: number
  postsAnalyzed: number
  errors: string[]
}

/**
 * Extract post URLs from a profile page
 */
function extractPostUrlsFromHtml(html: string, platform: string, handle: string): string[] {
  const urls = new Set<string>()

  if (platform === 'Facebook') {
    // Facebook post patterns
    const patterns = [
      /\/posts\/(\d+)/g,
      /\/share\/p\/([a-zA-Z0-9]+)/g,
      /https:\/\/www\.facebook\.com\/[^\/]+\/posts\/\d+/g,
    ]
    patterns.forEach(pattern => {
      let match
      while ((match = pattern.exec(html)) !== null) {
        if (pattern.toString().includes('posts')) {
          urls.add(`https://www.facebook.com/${handle}/posts/${match[1]}`)
        } else if (pattern.toString().includes('share')) {
          urls.add(`https://www.facebook.com/share/p/${match[1]}`)
        } else {
          urls.add(match[0])
        }
      }
    })
  } else if (platform === 'Instagram') {
    const patterns = [
      /\/p\/([a-zA-Z0-9_-]+)/g,
      /\/reel\/([a-zA-Z0-9_-]+)/g,
    ]
    patterns.forEach(pattern => {
      let match
      while ((match = pattern.exec(html)) !== null) {
        if (pattern.toString().includes('/p/')) {
          urls.add(`https://www.instagram.com/p/${match[1]}/`)
        } else {
          urls.add(`https://www.instagram.com/reel/${match[1]}/`)
        }
      }
    })
  }

  return Array.from(urls)
}

/**
 * Discover and analyze posts for a single profile
 */
async function syncProfilePosts(profileId: string, platform: string, handle: string): Promise<SyncStatus> {
  const status: SyncStatus = {
    profileId,
    platform,
    handle,
    postsDiscovered: 0,
    postsAnalyzed: 0,
    errors: [],
  }

  const store = db()
  if (!store) {
    status.errors.push('Firebase not configured')
    return status
  }

  try {
    // Step 1: Fetch the profile page
    const pageUrl = `https://www.${platform.toLowerCase()}.com/${handle}`
    console.log(`Syncing ${platform}:${handle} from ${pageUrl}`)

    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      status.errors.push(`Failed to fetch profile: HTTP ${response.status}`)
      return status
    }

    const html = await response.text()

    // Step 2: Extract post URLs
    const postUrls = extractPostUrlsFromHtml(html, platform, handle)
    status.postsDiscovered = postUrls.length

    console.log(`Found ${postUrls.length} posts for ${handle}`)

    // Step 3: Analyze each post and store results
    const profileRef = store.collection('competitors').doc(profileId)
    const discoveredRef = profileRef.collection('discovered_posts')
    const batch = store.batch()
    let analyzed = 0

    /**
     * Discovered URLs are stored UNANALYZED. The measured record (see the
     * action-plan workbook) is that gated profile HTML contains no post URLs
     * from this egress, so this loop only ever has work once a licensed
     * provider or proxy supplies real HTML — at which point analysis runs
     * through /api/analyse, the proven path, not a second extractor here.
     */
    for (const url of postUrls.slice(0, 20)) {
      const postId = url.split('/').filter(Boolean).pop() || url.slice(-10)
      batch.set(
        discoveredRef.doc(postId),
        { url, platform, postId, discoveredAt: new Date(), analyzed: false },
        { merge: true },
      )
      analyzed++
    }

    if (analyzed > 0) {
      await batch.commit()
    }

    status.postsAnalyzed = analyzed

    // Step 4: Update profile's last sync time
    await profileRef.set(
      {
        lastDiscoverySyncAt: new Date().toISOString(),
        discoveredPostsCount: analyzed,
      },
      { merge: true },
    )

    console.log(`Synced ${analyzed}/${postUrls.length} posts for ${handle}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    status.errors.push(message)
    console.error(`Sync error for ${handle}:`, message)
  }

  return status
}

/**
 * Main sync function - runs for all tracked profiles
 */
async function autoSyncAllPosts(): Promise<SyncStatus[]> {
  console.log('Starting auto-sync of discovered posts...')
  const profiles = await getTrackedProfiles()
  const results: SyncStatus[] = []

  for (const profile of profiles) {
    const status = await syncProfilePosts(profile.id, profile.platform, profile.handle)
    results.push(status)

    // Add delay between profiles
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  return results
}

export default async (req: Request): Promise<Response> => {
  try {
    console.log('Auto-sync job triggered')

    // Run the sync
    const results = await autoSyncAllPosts()

    const totalDiscovered = results.reduce((sum, r) => sum + r.postsDiscovered, 0)
    const totalAnalyzed = results.reduce((sum, r) => sum + r.postsAnalyzed, 0)
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0)

    const response = {
      ok: true,
      message: `Auto-sync completed: ${totalDiscovered} discovered, ${totalAnalyzed} analyzed, ${totalErrors} errors`,
      summary: {
        profilesSynced: results.length,
        postsDiscovered: totalDiscovered,
        postsAnalyzed: totalAnalyzed,
        errors: totalErrors,
      },
      results,
      syncedAt: new Date().toISOString(),
    }

    console.log('Auto-sync completed:', response.message)
    return Response.json(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Auto-sync error:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/auto-sync-posts',
  method: ['POST', 'GET'],
  // Scheduling note: this Config type carries no `schedule` field. When the
  // discovery input is real (provider wired), schedule it from netlify.toml.
}
