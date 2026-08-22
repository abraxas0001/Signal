import type { Comment, MediaItem, Metric, PostSnapshot } from '../../../../shared/types'
import type { AccountType } from '../../../../shared/taxonomy'
import type { UrlIdentity } from '../platform'
import { fetchText } from '../fetcher'
import { parseMetadata } from '../metadata'
import type { ExtractContext, ExtractResult } from './types'

/**
 * LinkedIn.
 *
 * Measured on 22 August 2026 through this codebase's own fetcher, which is the
 * only client whose behaviour matters here:
 *
 *   /posts/{vanity}_{slug}-activity-{id}-{code}   200 · 100-314KB · full JSON-LD
 *   /feed/update/urn:li:activity:{id}/            200 · byte-identical
 *   /pulse/{slug}                                 200 · Article node with the
 *                                                 counts and byline, but no
 *                                                 articleBody — the prose comes
 *                                                 from parseMetadata's DOM read
 *   /in/… and /company/…                          200 · the public guest page,
 *                                                 510KB and 441KB respectively
 *   /embed/feed/update/urn:li:activity:{id}       200 · 26KB · title only, and
 *                                                 no JSON-LD at all
 *
 * A post page carries one `application/ld+json` block holding a
 * `SocialMediaPosting`: `articleBody` (the post text in full, where
 * og:description is truncated), `datePublished`, LikeAction and CommentAction
 * counters, a sample of the comment bodies, and an `author` Person carrying the
 * poster's display name, avatar and follower count. Googlebot is served the same
 * counters and 5KB less markup, so this adapter never claims a crawler
 * identity — unlike the Meta and Threads readers it would gain nothing by it.
 *
 * Worth knowing before reproducing any of this by hand: curl, given the same
 * User-Agent and the same headers, is answered 999 with a 1,530-byte script stub
 * on /in/ and /company/ while undici is answered 200. The refusal is not about
 * the identity we present, and a hand-check therefore tells you less than it
 * looks like it does. LinkedIn may still answer 999 from a datacentre egress, so
 * that status has its own message below.
 *
 * There is no connected-account route to prefer. lib/linkedin-oauth.ts issues an
 * `openid profile email` token, which proves who signed in and authorises no
 * reads whatsoever; a page's posts need LinkedIn's separately reviewed Community
 * Management API. Until that approval lands there is nothing here for a token to
 * unlock, and the blocked messages say so rather than inviting the user to
 * connect an account that will not help.
 */

/**
 * The host, forced back to `www`.
 *
 * `normaliseUrl` in platform.ts strips `www.` from every URL, and LinkedIn is
 * the one platform here with an opinion about it. Re-measured on 22 August
 * 2026: the apex answers a post permalink with a redirect to `www.linkedin.com`
 * and then serves the identical 184,615 bytes, so today the apex costs a hop
 * and nothing more. An earlier measurement had it answering HTTP 200 with a
 * Google reCAPTCHA interstitial instead — "Checking your browser - reCAPTCHA",
 * 20KB, no OpenGraph and no JSON-LD — on paths that read perfectly one label to
 * the left; that did not reproduce, and it is not worth leaving to chance.
 * Either way `www` is the host LinkedIn canonicalises to, so it is the host we
 * ask for.
 */
function onWww(canonical: string): string {
  try {
    const u = new URL(canonical)
    u.hostname = 'www.linkedin.com'
    return u.toString()
  } catch {
    return canonical
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return '/'
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const samePath = (a: string, b: string): boolean =>
  a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase()

/**
 * Where LinkedIn sends a request it has decided not to answer.
 *
 * Every refusal arrives as HTTP 200 at a different URL, which is why the status
 * code cannot be the test: a deleted or connections-only post redirects to
 * `/signup/cold-join?session_redirect=…` and then serves og:title "Sign Up |
 * LinkedIn" with og:description "500 million+ members | Manage your professional
 * identity…", while an unknown `/pulse/` slug lands on
 * `/top-content/?trk=article_not_found`. Neither string matches anything in
 * `detectJunk` or the wall markers in metadata.ts, so before this adapter existed
 * the generic OpenGraph floor read LinkedIn's signup boilerplate, reported
 * success, and handed "500 million+ members…" to the model as the post.
 * Recognising the bounce is the main reason this file is not extractWeb.
 */
const BOUNCE_PATH = /^\/(?:signup|authwall|uas|checkpoint|login|top-content)\b/i

/** The same refusals, by the title they serve, in case the path form changes. */
const BOUNCE_TITLE =
  /^(?:sign\s?up|log\s?in|join linkedin|linkedin login|top content on linkedin|linkedin)(?:\s*[|·-]\s*linkedin)?$/i

const metric = (v: number | null, source: Metric['source']): Metric =>
  v == null ? { value: null, source: 'unavailable' } : { value: v, source }

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const asText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * `Number('')` and `Number(null)` are both 0 and both finite, so a bare coercion
 * would turn an absent counter into a confident "zero likes".
 */
const asCount = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return Number(v.trim())
  return null
}

/** "Microsoft | LinkedIn" → "Microsoft". */
const pageName = (title: string | null): string | null =>
  title ? title.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim() || null : null

// ─────────────────────────────────────────────────────────────────────────────
// What kind of LinkedIn URL this is
// ─────────────────────────────────────────────────────────────────────────────

interface Target {
  kind: 'post' | 'article' | 'account'
  /** The poster's own vanity name, when the permalink carries it. */
  vanity: string | null
  /** LinkedIn keeps people and organisations in separate namespaces. */
  namespace: 'member' | 'organisation' | null
}

function classify(canonical: string): Target {
  const path = pathOf(canonical)
  // /posts/{vanity}_{slug}-activity-{id}-{code}
  const vanity = /^\/posts\/([^/_]{2,120})_/.exec(path)?.[1] ?? null

  if (/^\/(?:posts|feed\/update|embed\/feed\/update)\//.test(path)) {
    return { kind: 'post', vanity, namespace: null }
  }
  if (path.startsWith('/pulse/')) return { kind: 'article', vanity: null, namespace: null }
  if (/^\/(?:company|school|showcase)\//.test(path)) {
    return { kind: 'account', vanity: null, namespace: 'organisation' }
  }
  return { kind: 'account', vanity: null, namespace: path.startsWith('/in/') ? 'member' : null }
}

// ─────────────────────────────────────────────────────────────────────────────
// The JSON-LD posting node
// ─────────────────────────────────────────────────────────────────────────────

const POSTING_TYPE =
  /^(?:SocialMediaPosting|DiscussionForumPosting|Article|NewsArticle|BlogPosting)$/i

function collectPostings(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectPostings(entry, out)
    return
  }

  const node = asRecord(value)
  if (!node) return

  const graph = node['@graph']
  if (Array.isArray(graph)) collectPostings(graph, out)

  const raw = node['@type']
  const types = Array.isArray(raw) ? raw : [raw]
  if (types.some((t) => typeof t === 'string' && POSTING_TYPE.test(t))) out.push(node)
}

/** The permalink a posting node claims for itself. LinkedIn uses three keys. */
function nodeUrl(node: Record<string, unknown>): string | null {
  return (
    asText(node['url']) ??
    asText(node['@id']) ??
    asText(node['mainEntityOfPage']) ??
    asText(asRecord(node['mainEntityOfPage'])?.['@id'])
  )
}

/**
 * The posting node for THIS page — never merely the first one on it.
 *
 * A LinkedIn member page embeds a @graph of ten Articles and ten
 * DiscussionForumPostings, each a different post carrying its own LikeAction
 * count. Taking the first would report a neighbouring post's engagement as this
 * post's, which is the failure this codebase has already shipped twice. So a
 * node is used only when the permalink it names is the page we asked for, or
 * when the page carries exactly one node and there is nothing to confuse it
 * with. Anything else falls back to OpenGraph, which is at least unambiguously
 * about the right page.
 *
 * The tally travels with the node because the caller needs it: parseMetadata's
 * own counter sweep is page-wide, so it is only safe to fall back on where
 * there was a single node to begin with.
 */
function readPosting(
  html: string,
  wantPath: string,
): { node: Record<string, unknown> | null; total: number } {
  const found: Record<string, unknown>[] = []

  for (const block of html.matchAll(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      collectPostings(JSON.parse((block[1] ?? '').trim()), found)
    } catch {
      /* malformed JSON-LD is common enough not to be worth reporting */
    }
  }

  const matched = found.find((node) => {
    const url = nodeUrl(node)
    return url ? samePath(pathOf(url), wantPath) : false
  })
  return {
    node: matched ?? (found.length === 1 ? (found[0] ?? null) : null),
    total: found.length,
  }
}

/**
 * One schema.org InteractionCounter, by the action it counts.
 *
 * Matched on the action name rather than on the full IRI because LinkedIn is not
 * self-consistent about it: the same array carries
 * `http://schema.org/LikeAction` and `https://schema.org/CommentAction`, one
 * entry apart.
 */
function counter(
  node: Record<string, unknown> | null,
  action: 'like' | 'comment' | 'share' | 'follow',
): number | null {
  if (!node) return null
  const raw = node['interactionStatistic']
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []

  for (const entry of list) {
    const e = asRecord(entry)
    if (!e) continue
    if (!(asText(e['interactionType']) ?? '').toLowerCase().includes(action)) continue
    const n = asCount(e['userInteractionCount'])
    if (n != null) return n
  }
  return null
}

/**
 * Comment bodies, from the same node as the counts.
 *
 * It is a sample and never the thread: a post reporting `commentCount` 5 carried
 * three bodies, and no query parameter returns the rest. So the count travels
 * alongside — a top-comment sample is good for tone and is not a census, and the
 * interface has to be able to tell the two apart.
 *
 * The commenter's key is not stable — `author` on a text post, `creator` on a
 * video post — so both are read. Taking only one silently drops every name on
 * the other kind.
 */
function readComments(node: Record<string, unknown>, limit = 100): Comment[] {
  const raw = node['comment']
  if (!Array.isArray(raw)) return []

  const out: Comment[] = []
  for (const entry of raw) {
    const c = asRecord(entry)
    if (!c) continue
    const text = asText(c['text'])
    if (!text) continue

    const who = asRecord(c['author']) ?? asRecord(c['creator'])
    out.push({
      text,
      author: asText(who?.['name']),
      likes: counter(c, 'like'),
      publishedAt: asText(c['datePublished']),
      isReply: false,
    })
    if (out.length >= limit) break
  }
  return out
}

/**
 * The post's own picture.
 *
 * og:image is not a reliable source for it. On a text-only post LinkedIn fills
 * og:image with its own brand asset on static.licdn.com, and attaching that to
 * the report puts LinkedIn's logo where the user's photograph should be. Uploads
 * live on media.licdn.com, so anything on the asset host is dropped.
 */
function postImage(node: Record<string, unknown> | null, ogImage: string | null): string | null {
  const raw = node?.['image']
  const first = Array.isArray(raw) ? raw[0] : raw
  const url = asText(asRecord(first)?.['url']) ?? asText(first) ?? ogImage
  if (!url) return null
  return hostOf(url) === 'static.licdn.com' ? null : url
}

/** "deep-ghinaiya" → "Deep Ghinaiya"; an opaque member id is left as it is. */
function prettyVanity(vanity: string | null): string | null {
  if (!vanity) return null
  if (/-[0-9a-f]{6,}$/.test(vanity)) return vanity
  return vanity
    .replace(/-/g, ' ')
    .replace(/(^|\s)(\p{Ll})/gu, (_m: string, gap: string, ch: string) => gap + ch.toUpperCase())
}

interface PostAuthor {
  name: string | null
  handle: string | null
  profileUrl: string | null
  avatarUrl: string | null
  followers: number | null
  accountType: AccountType
}

/**
 * The poster.
 *
 * The JSON-LD `author` Person is worth reading — it is the only place the avatar
 * and the follower count appear — but it is checked before it is trusted. This
 * codebase has shipped a byline belonging to a commenter twice, once on this
 * very platform, where the sibling `creator` key on a Narendra Modi post named a
 * private citizen who had left a comment. The permalink slug is the check:
 * LinkedIn builds /posts/{vanity}_… from the poster's own vanity name, and no
 * commenter can occupy it. When the two disagree the slug wins and everything
 * from the Person node is dropped, because attributing a minister's post to a
 * private citizen is far worse than an empty author cell.
 *
 * `creator` is deliberately not consulted for the poster, for the same reason —
 * readComments still reads it, where naming a commenter is the whole point.
 *
 * When the Person node is missing or discarded, the permalink vanity is all
 * there is, and it is not enough to build a profile link out of. LinkedIn
 * writes /posts/{vanity}_… the same way for both namespaces — measured:
 * /posts/microsoft_july-2026-activity-7487862338335801344-bBsC is a company
 * post — so guessing /in/{vanity} from the permalink points a reader at a
 * member profile that belongs to somebody else, or to nothing at all. The link
 * is only ever the one LinkedIn published.
 */
function readAuthor(node: Record<string, unknown> | null, vanity: string | null): PostAuthor {
  const person = asRecord(node?.['author'])
  const profileUrl = asText(person?.['url'])
  const ref = /\/(in|company|school|showcase)\/([^/?#]+)/.exec(profileUrl ?? '')
  const slug = ref?.[2] ?? null

  const impostor = Boolean(vanity && slug && slug.toLowerCase() !== vanity.toLowerCase())

  if (!person || impostor) {
    return {
      name: prettyVanity(vanity),
      handle: vanity,
      profileUrl: null,
      avatarUrl: null,
      followers: null,
      accountType: 'Unknown',
    }
  }

  // Structural rather than a guess: LinkedIn reserves /in/ for members and
  // /company/, /school/ and /showcase/ for organisations.
  const accountType: AccountType =
    ref?.[1] === 'in' ? 'Individual' : ref?.[1] ? 'Brand / Business' : 'Unknown'

  return {
    name: asText(person['name']) ?? prettyVanity(vanity),
    handle: slug ?? vanity,
    profileUrl,
    avatarUrl: asText(asRecord(person['image'])?.['url']),
    followers: counter(person, 'follow'),
    accountType,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function extractLinkedInEnhanced(
  id: UrlIdentity,
  _ctx: ExtractContext,
): Promise<ExtractResult> {
  const target = classify(id.canonical)
  return target.kind === 'account' ? readAccountPage(id, target) : readPostPage(id, target)
}

/**
 * A member profile or a company page.
 *
 * LinkedIn does serve these — /in/satyanadella came back at 510KB and
 * /company/microsoft at 441KB, both the full public guest page — but a page is
 * not a post, and the caller is asking about one post. Reporting a company's
 * About blurb as the post's text would be the same lie the sign-up bounce tells,
 * so the page is named and the user is pointed at a permalink instead.
 *
 * The request is still made rather than assumed, so the attempt line reports
 * what LinkedIn said today and an operator finds out on the day that changes.
 */
async function readAccountPage(id: UrlIdentity, target: Target): Promise<ExtractResult> {
  const res = await fetchText(onWww(id.canonical), { agent: 'browser', timeout: 8000 })

  const kind =
    target.namespace === 'organisation'
      ? 'company page'
      : target.namespace === 'member'
        ? 'member profile'
        : 'page'

  // The page itself is public; its tabs are not. /company/microsoft/posts/ is
  // answered with a redirect to /uas/login, arriving as HTTP 200 and 497KB of
  // sign-in form whose og:title is "LinkedIn Login, Sign in". Read without this
  // guard, that title became the name of the thing the user had asked about:
  // "That link opens LinkedIn Login, Sign in — a LinkedIn company page, not a
  // post." The landing path is the test rather than the title, because a page
  // legitimately named LinkedIn would fail a title test.
  if (BOUNCE_PATH.test(pathOf(res.url))) {
    return {
      ok: false,
      attempts: [
        { strategy: 'linkedin:account-page', ok: false, note: `bounced to ${pathOf(res.url)}` },
      ],
      confidence: 'low',
      blocked: {
        reason: `LinkedIn sent that link to its sign-in page instead of serving the ${kind}. It does that for a page's own post tabs, whether or not the page is public.`,
        suggestion:
          'Open one post from that page and paste its permalink — the /posts/ or /feed/update/ form. Connecting the office LinkedIn account will not open this up: LinkedIn grants page reads only to apps it has separately approved.',
      },
    }
  }

  const name = res.ok && res.body ? pageName(parseMetadata(res.body, res.url).title) : null

  return {
    ok: false,
    attempts: [
      {
        strategy: 'linkedin:account-page',
        ok: false,
        note: res.ok ? `HTTP 200 — a ${kind}, not a post` : `HTTP ${res.status}`,
      },
    ],
    confidence: 'low',
    blocked: {
      reason: name
        ? `That link opens ${name} — a LinkedIn ${kind}, not a post.`
        : `That link opens a LinkedIn ${kind} rather than a post${
            res.ok ? '' : `, and LinkedIn answered HTTP ${res.status} to it`
          }.`,
      suggestion:
        'Click into a post on that page to get its own permalink — the /posts/ or /feed/update/ form — and paste that instead. Connecting the office LinkedIn account will not open this up: LinkedIn grants page reads only to apps it has separately approved.',
    },
  }
}

async function readPostPage(id: UrlIdentity, target: Target): Promise<ExtractResult> {
  const attempts: ExtractResult['attempts'] = []

  // The embed form is served on the same id but carries the title alone — 26KB
  // against 100KB, and no JSON-LD — so an embed link is read as the post it
  // points at rather than as itself.
  const url = onWww(id.canonical).replace('/embed/feed/update/', '/feed/update/')
  const res = await fetchText(url, { agent: 'browser', timeout: 10_000 })
  const landed = pathOf(res.url)

  if (BOUNCE_PATH.test(landed)) {
    attempts.push({ strategy: 'linkedin:post-page', ok: false, note: `bounced to ${landed}` })
    return { ok: false, attempts, confidence: 'low', blocked: bouncedBlock() }
  }

  if (!res.ok || !res.body) {
    attempts.push({ strategy: 'linkedin:post-page', ok: false, note: `HTTP ${res.status}` })
    return { ok: false, attempts, confidence: 'low', blocked: refusedBlock(res.status) }
  }

  const meta = parseMetadata(res.body, res.url)

  // The same refusal, reached without a redirect we could see.
  if (BOUNCE_TITLE.test(meta.title ?? '')) {
    attempts.push({
      strategy: 'linkedin:post-page',
      ok: false,
      note: `LinkedIn served its "${meta.title ?? ''}" page`,
    })
    return { ok: false, attempts, confidence: 'low', blocked: bouncedBlock() }
  }

  const { node: posting, total: postingNodes } = readPosting(res.body, landed)

  // parseMetadata's counter sweep walks every JSON-LD node on the page and lets
  // the first writer win, so on a page carrying more than one posting node it
  // can hand back a neighbour's like count — precisely the misattribution
  // readPosting declines to make just above. Falling back to it is only honest
  // where there was one node and nothing to confuse it with. Measured on a
  // post permalink and on a Pulse article: one node each, both agreeing with
  // the sweep, so this costs nothing today and closes the hole.
  const pageWideCountsAreSafe = postingNodes <= 1

  // JSON-LD first at every step, OpenGraph only as the fallback: og:description
  // is the post text cut short, `articleBody` is the whole of it. A Pulse
  // article carries no `articleBody` at all, so those fall through to
  // parseMetadata, whose DOM read returned the full 6,603-character body of the
  // one tested.
  const text =
    asText(posting?.['articleBody']) ??
    asText(posting?.['text']) ??
    meta.articleText ??
    meta.description

  // `name` before `headline`, and in that order for a reason: on a Pulse
  // article `name` is the title and `headline` is the opening sentence of the
  // body, so reading `headline` first titles the piece "Great to be back at
  // Microsoft Build today. For us, it is not about any one piece of…". A post
  // permalink carries `headline` and no `name`, and is unaffected. og:title is
  // last because on a post page LinkedIn appends " | {author}" to it.
  const title = asText(posting?.['name']) ?? asText(posting?.['headline']) ?? meta.title
  const publishedAt = asText(posting?.['datePublished']) ?? meta.publishedAt
  const likes =
    counter(posting, 'like') ?? (pageWideCountsAreSafe ? (meta.interactions.like ?? null) : null)
  const commentCount =
    asCount(posting?.['commentCount']) ??
    counter(posting, 'comment') ??
    (pageWideCountsAreSafe ? (meta.interactions.comment ?? null) : null)
  const bodies = posting ? readComments(posting) : []
  const author = readAuthor(posting, target.vanity)
  const image = postImage(posting, meta.image)

  // One attempt line, not two, because the interface names the last successful
  // strategy as the one that produced the data — and a separate follower leg
  // would take that credit from the read that actually did the work.
  attempts.push({
    strategy: posting ? 'linkedin:json-ld' : 'linkedin:opengraph',
    ok: Boolean(posting && (text || likes != null)),
    note: posting
      ? `likes=${likes ?? '—'} comments=${commentCount ?? '—'}${
          bodies.length
            ? ` · ${bodies.length} of ${commentCount ?? bodies.length} comment bodies`
            : ''
        }${
          author.followers != null
            ? ` · ${author.followers.toLocaleString('en-IN')} followers`
            : ''
        }`
      : 'no posting node we could tie to this URL — metadata only',
  })

  if (!text && !title) {
    return {
      ok: false,
      attempts,
      confidence: 'low',
      blocked: {
        reason: 'LinkedIn returned the page but no post text with it.',
        suggestion: 'Paste the post text below, or upload a screenshot, and we will analyse that.',
      },
    }
  }

  const media: MediaItem[] = image ? [{ kind: 'image', url: image, thumbnailUrl: image }] : []

  const snapshot: Partial<PostSnapshot> = {
    platform: 'LinkedIn',
    postType: target.kind === 'article' ? 'Article' : 'Original Post',
    publishedAt,
    ...(bodies.length ? { comments: bodies } : {}),
    author: {
      name: author.name,
      handle: author.handle,
      profileUrl: author.profileUrl,
      avatarUrl: author.avatarUrl,
      // LinkedIn's verification badge is rendered client-side and appears
      // nowhere in the markup, so this is unknown rather than false.
      verified: null,
      followers: metric(author.followers, 'page-scrape'),
      accountType: author.accountType,
      declaredLocation: null,
    },
    content: {
      text,
      title,
      languageCode: meta.lang,
      languageName: null,
      translation: null,
      transcript: null,
      hashtags: [...(text ?? '').matchAll(/#([\p{L}\p{N}_]+)/gu)].flatMap((m) =>
        m[1] ? [m[1]] : [],
      ),
      // LinkedIn writes a mention as the person's display name rather than as an
      // @handle, so there is nothing here to parse without guessing which words
      // are somebody's name.
      mentions: [],
      outboundLinks: [
        ...new Set([...(text ?? '').matchAll(/https?:\/\/[^\s<>"')]+/g)].map((m) => m[0])),
      ],
    },
    engagement: {
      likes: metric(likes, 'page-scrape'),
      comments: metric(commentCount, 'page-scrape'),
      // LinkedIn publishes LikeAction and CommentAction and stops there. The
      // repost count is on the page for a human and in none of the markup.
      shares: { value: null, source: 'unavailable' },
      views: { value: null, source: 'unavailable' },
      // Deliberately not likes-over-followers. A follower count is an audience,
      // not an impression count, and this codebase has already shipped one
      // engagement rate whose denominator was the wrong number entirely.
      engagementRate: null,
    },
    media,
  }

  return {
    ok: true,
    attempts,
    confidence: posting && likes != null ? 'high' : posting || text ? 'medium' : 'low',
    ...(likes == null
      ? {
          blocked: {
            reason: 'LinkedIn served the post text but no engagement counts with it.',
            suggestion:
              'Type the reaction and comment counts in below and the report will use them.',
          },
        }
      : {}),
    snapshot,
    // The one key analyse.ts reads that applies here. LinkedIn's counter is
    // every reaction and not likes alone — the markup labels the same 1,053 as
    // `aria-label="1,053 Reactions"` — and without this the prompt calls the
    // number Likes. The comment sample size is not passed: nothing downstream
    // reads it, and the attempt note already records "9 of 93 comment bodies"
    // where the interface shows the extraction trail.
    extra: { metricLabel: 'reactions' },
  }
}

function bouncedBlock(): { reason: string; suggestion: string } {
  return {
    reason:
      'LinkedIn bounced that link to its sign-up page, which is what it does when a post has been deleted, made private, or limited to the author’s connections.',
    suggestion:
      'If you can still see the post while signed in, paste its text below and we will analyse that.',
  }
}

function refusedBlock(status: number): { reason: string; suggestion: string } {
  if (status === 404) {
    return {
      reason:
        'LinkedIn answered 404 for that permalink — the post has been removed, or the link is mistyped.',
      suggestion: 'Check the link, or paste the post text below and we will analyse that.',
    }
  }
  if (status === 999) {
    return {
      reason:
        'LinkedIn refused the request outright with its HTTP 999. It serves that to servers rather than to browsers, and it does not depend on which post was asked for.',
      suggestion: 'Paste the post text below and we will analyse that.',
    }
  }
  return {
    reason: `LinkedIn answered HTTP ${status} instead of the post.`,
    suggestion: 'Paste the post text below, or upload a screenshot, and we will analyse that.',
  }
}
