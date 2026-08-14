import type { PostSnapshot } from '../../../../shared/types'
import { genericPlatform, identify } from '../platform'
import { detectJunk } from '../metadata'
import type { ExtractContext, ExtractResult } from './types'
import { extractYouTube } from './youtube'
import { extractTwitter } from './twitter'
import { extractMeta } from './meta'
import { extractBluesky, extractMastodon } from './fediverse'
import { extractThreads } from './threads'
import { extractPinterest, extractSnapchat } from './visual'
import { extractWeb } from './web'

export type { ExtractContext, ExtractResult, ApiKeys } from './types'

/** A complete snapshot with every field present but empty. Adapters fill it in. */
function blankSnapshot(inputUrl: string, canonical: string): PostSnapshot {
  return {
    inputUrl,
    canonicalUrl: canonical,
    platform: 'Other',
    postType: 'Original Post',
    publishedAt: null,
    author: {
      name: null,
      handle: null,
      profileUrl: null,
      avatarUrl: null,
      verified: null,
      followers: { value: null, source: 'unavailable' },
      accountType: 'Unknown',
      declaredLocation: null,
    },
    content: {
      text: null,
      title: null,
      languageCode: null,
      languageName: null,
      translation: null,
      transcript: null,
      hashtags: [],
      mentions: [],
      outboundLinks: [],
    },
    engagement: {
      likes: { value: null, source: 'unavailable' },
      comments: { value: null, source: 'unavailable' },
      shares: { value: null, source: 'unavailable' },
      views: { value: null, source: 'unavailable' },
      engagementRate: null,
    },
    media: [],
    extraction: {
      strategy: 'none',
      attempts: [],
      confidence: 'low',
      userAssisted: false,
      fetchedAt: new Date().toISOString(),
    },
  }
}

export interface ExtractionOutcome {
  snapshot: PostSnapshot
  /** Adapter-specific context handed to the analyser (tags, captions, quotes…). */
  extra: Record<string, unknown>
}

/**
 * How long the whole extraction may take before we give up and analyse what we
 * have.
 *
 * Adapters run their legs in sequence, and every leg has its own timeout — so a
 * platform that is unreachable rather than merely unhelpful costs the sum of
 * them. A TikTok link from a network that blocks TikTok burned 33 seconds
 * across four legs, which on Netlify's 60-second ceiling leaves the model no
 * room to finish and turns a partial report into no report at all.
 *
 * 22 seconds is comfortably above the slowest real extraction measured (~5s)
 * and leaves the analysis its full normal budget.
 */
const EXTRACTION_BUDGET_MS = 22_000

class ExtractionTimeout extends Error {}

export async function extractPost(
  inputUrl: string,
  ctx: ExtractContext,
): Promise<ExtractionOutcome> {
  const id = identify(inputUrl)
  const snapshot = blankSnapshot(inputUrl, id.canonical)
  snapshot.platform = id.platform
  snapshot.postType = id.postType

  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ExtractionTimeout()), EXTRACTION_BUDGET_MS)
  })

  let result: ExtractResult
  try {
    result = await Promise.race([runAdapter(id, ctx, snapshot), deadline])
  } catch (err) {
    result =
      err instanceof ExtractionTimeout
        ? {
            ok: false,
            attempts: [
              {
                strategy: `${id.platform}:timeout`,
                ok: false,
                note: `gave up after ${EXTRACTION_BUDGET_MS / 1000}s`,
              },
            ],
            blocked: {
              reason: `${id.platform} did not respond in time.`,
              suggestion:
                'The platform may be unreachable from our servers. Paste the post text below and we will analyse that.',
            },
          }
        : {
            ok: false,
            attempts: [
              {
                strategy: `${id.platform}:adapter`,
                ok: false,
                note: err instanceof Error ? err.message : 'adapter threw',
              },
            ],
          }
  } finally {
    clearTimeout(timer)
  }

  return assemble(snapshot, result, ctx)
}

/** Route to the platform adapter. Split out so the deadline can race it. */
async function runAdapter(
  id: ReturnType<typeof identify>,
  ctx: ExtractContext,
  snapshot: PostSnapshot,
): Promise<ExtractResult> {
  let result: ExtractResult
  switch (id.platform) {
    case 'YouTube':
      result = await extractYouTube(id, ctx)
      break
    case 'Twitter/X':
      result = await extractTwitter(id, ctx)
      break
    case 'Facebook':
    case 'Instagram':
      result = await extractMeta(id, ctx)
      break
    case 'Threads':
      result = await extractThreads(id, ctx)
      break
    case 'Bluesky':
      result = await extractBluesky(id, ctx)
      break
    case 'Pinterest':
      result = await extractPinterest(id, ctx)
      break
    case 'Snapchat':
      result = await extractSnapchat(id, ctx)
      break
    case 'Mastodon': {
      // Mastodon is detected by URL *shape*, not by host — the fediverse has
      // thousands of instances and no registry. So a page that merely looks
      // like /@user/12345 can land here without being Mastodon at all. When
      // the instance API disowns it, re-label it as what it is and fall
      // through to the generic reader, rather than reporting a Mastodon
      // failure for a page that was never Mastodon.
      result = await extractMastodon(id, ctx)
      if (!result.ok) {
        const fallbackPlatform = genericPlatform(id.canonical)
        const web = await extractWeb({ ...id, platform: fallbackPlatform }, ctx)
        snapshot.platform = fallbackPlatform
        result = { ...web, attempts: [...result.attempts, ...web.attempts] }
      }
      break
    }
    default:
      result = await extractWeb(id, ctx)
  }
  return result
}

/** Fold the adapter's result into a complete, well-formed snapshot. */
function assemble(
  snapshot: PostSnapshot,
  result: ExtractResult,
  ctx: ExtractContext,
): ExtractionOutcome {
  // Merge the adapter's partial over the blank, field by field, so a partial
  // failure still leaves a well-formed snapshot rather than undefined holes.
  const s = result.snapshot
  if (s) {
    if (s.platform) snapshot.platform = s.platform
    if (s.postType) snapshot.postType = s.postType
    if (s.publishedAt) snapshot.publishedAt = s.publishedAt
    if (s.author) snapshot.author = { ...snapshot.author, ...s.author }
    if (s.content) snapshot.content = { ...snapshot.content, ...s.content }
    if (s.engagement) snapshot.engagement = { ...snapshot.engagement, ...s.engagement }
    if (s.media?.length) snapshot.media = s.media
  }

  // ── Nothing that is obviously not a post may reach the user ───────────────
  // Applied here rather than inside one adapter, because a regex that overruns
  // its field can leak page script from any of them — and a wall of JavaScript
  // shown as the post is worse than no post at all. It would also be handed to
  // the model as the text to analyse.
  const junkReason = detectJunk(snapshot.content.text) ?? detectJunk(snapshot.content.title)
  if (junkReason) {
    snapshot.content.text = null
    snapshot.content.title = null
    result = {
      ...result,
      attempts: [
        ...result.attempts,
        { strategy: 'guard:content', ok: false, note: `discarded — ${junkReason}` },
      ],
      blocked: result.blocked ?? {
        reason: `We reached the page, but ${junkReason}.`,
        suggestion: 'Paste the post text, or upload a screenshot, and we will use that instead.',
      },
    }
  }

  // ── User-supplied rescue data always wins over anything we scraped ─────────
  if (ctx.manualText?.trim()) {
    snapshot.content.text = ctx.manualText.trim()
    snapshot.extraction.userAssisted = true
  }

  const successful = result.attempts.filter((a) => a.ok)
  snapshot.extraction = {
    // Name the strategy that produced the data. Falling back to the last
    // attempt matters because some adapters mark an attempt `ok: false` when
    // it yielded no *counts* even though it returned the post text — reporting
    // "none" there made a successful read look like a failure in the interface.
    strategy:
      successful[successful.length - 1]?.strategy ??
      result.attempts[result.attempts.length - 1]?.strategy ??
      'none',
    attempts: result.attempts,
    confidence: result.confidence ?? (result.ok ? 'medium' : 'low'),
    userAssisted: Boolean(ctx.manualText?.trim() || ctx.screenshot),
    fetchedAt: new Date().toISOString(),
    ...(result.blocked && !ctx.manualText ? { blocked: result.blocked } : {}),
  }

  // Having no text at all is the one failure the analyser cannot work around.
  const hasText = Boolean(snapshot.content.text?.trim() || snapshot.content.title?.trim())
  if (!hasText && !ctx.screenshot && !snapshot.extraction.blocked) {
    snapshot.extraction.blocked = {
      reason: 'We reached the page but found no readable post text.',
      suggestion: 'Paste the post text below, or upload a screenshot, and we will analyse that.',
    }
  }

  return { snapshot, extra: result.extra ?? {} }
}
