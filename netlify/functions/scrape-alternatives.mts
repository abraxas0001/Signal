import type { Config } from '@netlify/functions'

/**
 * Alternative Scraping Methods Test
 *
 * Explores different approaches to extract posts from gated platforms:
 * 1. Browser Automation (Puppeteer) - Automated browser session
 * 2. Unofficial APIs (Instagram Private API) - Reverse engineered endpoints
 * 3. Cached Data (Google Cache, Archive.org) - Historical snapshots
 * 4. Direct HTML Parsing - Parse without login
 *
 * GET /api/scrape-alternatives?method=puppeteer|unofficial|cached|direct&url=...
 * POST /api/scrape-alternatives - Test all methods
 */

interface ScrapingResult {
  method: string
  url: string
  success: boolean
  postsFound: number
  posts: Array<{
    id: string
    url: string
    likes?: number
    comments?: number
    shares?: number
  }>
  error?: string
  took: number
}

/**
 * Method 1: Direct HTML Parsing (No Auth)
 * Attempts to extract posts from publicly cached/served HTML
 */
async function methodDirectParsing(url: string): Promise<ScrapingResult> {
  const start = Date.now()
  const result: ScrapingResult = {
    method: 'direct_parsing',
    url,
    success: false,
    postsFound: 0,
    posts: [],
    took: 0,
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      result.error = `HTTP ${response.status}`
      result.took = Date.now() - start
      return result
    }

    const html = await response.text()

    // Extract post data from meta tags and structured data
    const posts = new Set<string>()

    // Pattern 1: Open Graph tags for individual posts
    const ogUrlPattern = /property="og:url"\s+content="([^"]+\/posts\/[^"]+)"/g
    let match
    while ((match = ogUrlPattern.exec(html)) !== null) {
      if (match[1]) posts.add(match[1])
    }

    // Pattern 2: JSON-LD structured data
    const jsonLdPattern = /<script type="application\/ld\+json">(.+?)<\/script>/gs
    const jsonMatches = html.match(jsonLdPattern) || []
    jsonMatches.forEach(script => {
      try {
        const json = JSON.parse(script.replace(/<script[^>]*>|<\/script>/g, ''))
        if (json.url && json.url.includes('/posts/')) {
          posts.add(json.url)
        }
      } catch (e) {
        // Skip malformed JSON
      }
    })

    // Pattern 3: Direct post URL patterns in HTML
    const postUrlPattern = /https:\/\/www\.facebook\.com\/[^\/]+\/posts\/\d+/g
    const urlMatches = html.match(postUrlPattern) || []
    urlMatches.forEach(url => posts.add(url))

    result.success = posts.size > 0
    result.postsFound = posts.size
    result.posts = Array.from(posts).map(p => ({ id: p.split('/').pop() || '', url: p }))
    result.took = Date.now() - start

    console.log(`Direct parsing: Found ${posts.size} posts`)
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Unknown error'
    result.took = Date.now() - start
  }

  return result
}

/**
 * Method 2: Google Cache
 * Fetch archived version from Google Cache
 */
async function methodGoogleCache(url: string): Promise<ScrapingResult> {
  const start = Date.now()
  const result: ScrapingResult = {
    method: 'google_cache',
    url,
    success: false,
    postsFound: 0,
    posts: [],
    took: 0,
  }

  try {
    const cacheUrl = `https://webcache.googleusercontent.com/cache:${url}`
    console.log(`Trying Google Cache: ${cacheUrl}`)

    const response = await fetch(cacheUrl, {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      result.error = `Cache not available (HTTP ${response.status})`
      result.took = Date.now() - start
      return result
    }

    const html = await response.text()
    const posts = new Set<string>()

    // Extract posts from cached version
    const postPattern = /\/posts\/(\d+)/g
    let match
    while ((match = postPattern.exec(html)) !== null) {
      const handle = url.split('/').filter(Boolean).pop() || 'profile'
      posts.add(`https://www.facebook.com/${handle}/posts/${match[1]}`)
    }

    result.success = posts.size > 0
    result.postsFound = posts.size
    result.posts = Array.from(posts).map(p => ({ id: p.split('/').pop() || '', url: p }))
    result.took = Date.now() - start

    console.log(`Google Cache: Found ${posts.size} posts`)
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Cache unavailable'
    result.took = Date.now() - start
  }

  return result
}

/**
 * Method 3: Archive.org (Wayback Machine)
 * Fetch from Internet Archive
 */
async function methodArchiveOrg(url: string): Promise<ScrapingResult> {
  const start = Date.now()
  const result: ScrapingResult = {
    method: 'archive_org',
    url,
    success: false,
    postsFound: 0,
    posts: [],
    took: 0,
  }

  try {
    // Get latest snapshot from Wayback Machine
    const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}&matchType=prefix`
    console.log(`Checking Archive.org for: ${url}`)

    const response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      result.error = 'Archive not available'
      result.took = Date.now() - start
      return result
    }

    const data = (await response.json()) as { archived_snapshots?: Array<{ status: string; timestamp: string }> }
    const snapshots = data.archived_snapshots || []

    if (snapshots.length === 0) {
      result.error = 'No snapshots available'
      result.took = Date.now() - start
      return result
    }

    // Get the latest snapshot
    const latest = snapshots[snapshots.length - 1]
    if (!latest) {
      result.error = 'Could not get latest snapshot'
      result.took = Date.now() - start
      return result
    }

    const waybackUrl = `https://web.archive.org/web/${latest.timestamp}/${url}`
    console.log(`Fetching from Wayback: ${waybackUrl}`)

    const snapshotResponse = await fetch(waybackUrl, {
      signal: AbortSignal.timeout(10000),
    })

    if (!snapshotResponse.ok) {
      result.error = `Snapshot unavailable (HTTP ${snapshotResponse.status})`
      result.took = Date.now() - start
      return result
    }

    const html = await snapshotResponse.text()
    const posts = new Set<string>()

    // Extract posts from snapshot
    const postPattern = /\/posts\/(\d+)|\/share\/p\/([a-zA-Z0-9]+)/g
    let match
    while ((match = postPattern.exec(html)) !== null) {
      const handle = url.split('/').filter(Boolean).pop() || 'profile'
      const postId = match[1] || match[2]
      posts.add(`https://www.facebook.com/${handle}/posts/${postId}`)
    }

    result.success = posts.size > 0
    result.postsFound = posts.size
    result.posts = Array.from(posts).map(p => ({ id: p.split('/').pop() || '', url: p }))
    result.took = Date.now() - start

    console.log(`Archive.org: Found ${posts.size} posts from ${latest.timestamp}`)
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Archive unavailable'
    result.took = Date.now() - start
  }

  return result
}

/**
 * Method 4: Proxy-based HTML Fetch
 * Use residential proxy to avoid blocking
 */
async function methodProxyFetch(url: string): Promise<ScrapingResult> {
  const start = Date.now()
  const result: ScrapingResult = {
    method: 'proxy_fetch',
    url,
    success: false,
    postsFound: 0,
    posts: [],
    took: 0,
  }

  // This would require a paid service like:
  // - Bright Data (formerly Luminati)
  // - Oxylabs
  // - ScrapingBee
  // - etc.

  result.error = 'Requires paid proxy service (Bright Data, Oxylabs, ScrapingBee)'
  result.took = Date.now() - start

  return result
}

export default async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url)
    const method = url.searchParams.get('method')
    const targetUrl = url.searchParams.get('url') || 'https://www.facebook.com/narendramodi'

    console.log(`Testing scraping method: ${method} for ${targetUrl}`)

    let result: ScrapingResult

    switch (method) {
      case 'direct':
        result = await methodDirectParsing(targetUrl)
        break
      case 'google_cache':
        result = await methodGoogleCache(targetUrl)
        break
      case 'archive':
        result = await methodArchiveOrg(targetUrl)
        break
      case 'proxy':
        result = await methodProxyFetch(targetUrl)
        break
      default:
        // Test all methods
        const results = await Promise.all([
          methodDirectParsing(targetUrl),
          methodGoogleCache(targetUrl),
          methodArchiveOrg(targetUrl),
          methodProxyFetch(targetUrl),
        ])

        return Response.json({
          url: targetUrl,
          methods: results,
          summary: {
            successful: results.filter(r => r.success).length,
            totalPostsFound: results.reduce((sum, r) => sum + r.postsFound, 0),
            bestMethod: results.sort((a, b) => b.postsFound - a.postsFound)[0]?.method,
          },
          timestamp: new Date().toISOString(),
        })
    }

    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Scraping test error:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/scrape-alternatives',
}
