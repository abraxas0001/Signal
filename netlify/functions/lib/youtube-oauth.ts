import type { Comment } from '../../../shared/types'
import type { HandlePost } from './handles'
import { freshAccessToken, saveConnection, type Connection, type RefreshResult } from './connections'

/**
 * The office's own YouTube channel, via Google OAuth — the legitimate route
 * to data a keyless read cannot reach.
 *
 * Unlike the public InnerTube path in `handles.ts` (which yields views but no
 * like count, because that is all a browse-by-channel-id response carries),
 * an OAuth-authorised read gets exact like/view/comment counts and real
 * comment bodies straight from the Data API — the same tier of upgrade
 * `meta-graph.ts` provides for Facebook and Instagram.
 *
 * WHAT IT DOES NOT DO: a token authorises one signed-in Google account. It
 * will not read a rival's channel, and nothing here tries to.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const API_BASE = 'https://www.googleapis.com/youtube/v3'

export function youtubeOAuthCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env['YOUTUBE_OAUTH_CLIENT_ID']?.trim()
  const clientSecret = process.env['YOUTUBE_OAUTH_CLIENT_SECRET']?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function youtubeAuthorizeUrl(redirectUri: string, state: string): string | null {
  const creds = youtubeOAuthCredentials()
  if (!creds) return null
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', creds.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.readonly')
  // Required every time, not just on first connect: without prompt=consent,
  // Google only issues a refresh_token on an account's very first-ever
  // authorization of this app. A revoke-and-reconnect without this silently
  // gets no refresh token back, and the connection dies at the next
  // access-token expiry with no obvious cause.
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)
  return url.toString()
}

interface GoogleTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

export async function youtubeExchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number | null; scope: string | null }> {
  const creds = youtubeOAuthCredentials()
  if (!creds) throw new Error('YouTube OAuth is not configured.')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(9000),
  })
  const json = (await res.json()) as GoogleTokenResponse
  if (json.error || !json.access_token) {
    throw new Error(`Google token exchange refused: ${json.error_description ?? json.error ?? 'unknown error'}`)
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : null,
    scope: json.scope ?? null,
  }
}

async function youtubeRefresh(c: Connection): Promise<RefreshResult> {
  const creds = youtubeOAuthCredentials()
  if (!creds) throw new Error('YouTube OAuth is not configured.')
  if (!c.refreshToken) throw new Error('No refresh token stored for this connection.')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: c.refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(9000),
  })
  const json = (await res.json()) as GoogleTokenResponse
  if (json.error || !json.access_token) {
    throw new Error(`Google token refresh refused: ${json.error_description ?? json.error ?? 'unknown error'}`)
  }
  // Google does not normally re-issue a refresh token here; the caller's
  // `refreshToken ?? c.refreshToken` fallback is what keeps the original one.
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : null,
  }
}

interface YtChannelsResponse {
  items?: Array<{
    id?: string
    snippet?: { title?: string; customUrl?: string }
    statistics?: { subscriberCount?: string }
    contentDetails?: { relatedPlaylists?: { uploads?: string } }
  }>
}

export interface YouTubeIdentity {
  channelId: string
  title: string
  customUrl: string | null
  subscribers: number | null
  uploadsPlaylistId: string | null
}

/** Which channel this token actually authorises — the identity-match anchor. */
export async function youtubeWhoAmI(accessToken: string): Promise<YouTubeIdentity> {
  const url = new URL(`${API_BASE}/channels`)
  url.searchParams.set('part', 'snippet,statistics,contentDetails')
  url.searchParams.set('mine', 'true')
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(9000),
  })
  const json = (await res.json()) as YtChannelsResponse
  const channel = json.items?.[0]
  if (!channel?.id) throw new Error('YouTube: this token is not authorised for any channel.')
  return {
    channelId: channel.id,
    title: channel.snippet?.title ?? '',
    customUrl: channel.snippet?.customUrl ?? null,
    subscribers:
      typeof channel.statistics?.subscriberCount === 'string'
        ? Number(channel.statistics.subscriberCount)
        : null,
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads ?? null,
  }
}

/** Does `handle` (an @handle, a channel id, or a bare name) name this authorised channel? */
export function youtubeIdentityMatches(identity: YouTubeIdentity, handle: string): boolean {
  const h = handle.replace(/^@/, '').toLowerCase()
  return (
    identity.channelId === handle ||
    identity.customUrl?.replace(/^@/, '').toLowerCase() === h ||
    identity.title.toLowerCase() === h
  )
}

const POST_LIMIT = 25
const COMMENT_LIMIT = 100

interface YtPlaylistItemsResponse {
  items?: Array<{ contentDetails?: { videoId?: string; videoPublishedAt?: string } }>
}

interface YtVideosResponse {
  items?: Array<{
    id?: string
    snippet?: { title?: string; publishedAt?: string }
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
  }>
}

/** The office's own uploads, with EXACT counts — the InnerTube fallback carries no like count at all. */
export async function youtubeOwnUploads(accessToken: string, uploadsPlaylistId: string): Promise<HandlePost[]> {
  const listUrl = new URL(`${API_BASE}/playlistItems`)
  listUrl.searchParams.set('part', 'contentDetails')
  listUrl.searchParams.set('playlistId', uploadsPlaylistId)
  listUrl.searchParams.set('maxResults', String(POST_LIMIT))
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(9000),
  })
  const listJson = (await listRes.json()) as YtPlaylistItemsResponse
  const videoIds = (listJson.items ?? [])
    .map((i) => i.contentDetails?.videoId)
    .filter((id): id is string => Boolean(id))
  if (!videoIds.length) return []

  const statsUrl = new URL(`${API_BASE}/videos`)
  statsUrl.searchParams.set('part', 'snippet,statistics')
  statsUrl.searchParams.set('id', videoIds.join(','))
  const statsRes = await fetch(statsUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(9000),
  })
  const statsJson = (await statsRes.json()) as YtVideosResponse

  return (statsJson.items ?? []).map((v) => ({
    url: `https://www.youtube.com/watch?v=${v.id}`,
    title: v.snippet?.title?.slice(0, 140) ?? null,
    publishedAt: v.snippet?.publishedAt ?? null,
    views: numOrNull(v.statistics?.viewCount),
    likes: numOrNull(v.statistics?.likeCount),
    comments: numOrNull(v.statistics?.commentCount),
  }))
}

interface YtCommentThreadsResponse {
  items?: Array<{
    snippet?: {
      topLevelComment?: {
        snippet?: {
          textDisplay?: string
          authorDisplayName?: string
          likeCount?: number
          publishedAt?: string
        }
      }
    }
  }>
}

/** Real comment bodies on one of the office's own videos. */
export async function youtubeOwnComments(accessToken: string, videoId: string): Promise<Comment[]> {
  const url = new URL(`${API_BASE}/commentThreads`)
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('videoId', videoId)
  url.searchParams.set('maxResults', String(COMMENT_LIMIT))
  url.searchParams.set('order', 'relevance')
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(9000),
  })
  const json = (await res.json()) as YtCommentThreadsResponse
  return (json.items ?? [])
    .map((i) => i.snippet?.topLevelComment?.snippet)
    .filter((s): s is NonNullable<typeof s> => Boolean(s?.textDisplay?.trim()))
    .map((s) => ({
      text: s.textDisplay!.trim(),
      author: s.authorDisplayName ?? null,
      likes: typeof s.likeCount === 'number' ? s.likeCount : null,
      publishedAt: s.publishedAt ?? null,
      isReply: false,
    }))
}

/** The wrapper `handles.ts` calls: a usable token for this specific channel, or null. */
export async function youtubeFreshToken(): Promise<{ accessToken: string; identity: YouTubeIdentity } | null> {
  const accessToken = await freshAccessToken('YouTube', youtubeRefresh)
  if (!accessToken) return null
  try {
    const identity = await youtubeWhoAmI(accessToken)
    return { accessToken, identity }
  } catch {
    return null
  }
}

export async function youtubeSaveConnection(input: {
  accessToken: string
  refreshToken: string | null
  expiresIn: number | null
  scope: string | null
  identity: YouTubeIdentity
}): Promise<void> {
  const now = new Date().toISOString()
  await saveConnection({
    platform: 'YouTube',
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresIn ? new Date(Date.now() + input.expiresIn * 1000).toISOString() : null,
    scope: input.scope,
    ownerId: input.identity.channelId,
    ownerName: input.identity.title || null,
    connectedAt: now,
    updatedAt: now,
    lastError: null,
    lastErrorAt: null,
  })
}

function numOrNull(v: string | undefined): number | null {
  if (v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
