import type { GrievanceRecord } from '@shared/grievance'
import type { Sentiment } from '@shared/taxonomy'
import type { PersonaMention } from '@/components/Persona'
import type { Store } from '@/lib/store'

/**
 * The desk's local news, from every place it actually reads news.
 *
 * TWO SOURCES, ONE SHELF. The desk collects press coverage twice over and
 * files it in two different places: the People screen's persona scan writes
 * `personaMentions`, and the grievance desk writes `grievances` — a fuller
 * record of the SAME kind of thing, a story a local paper printed, with the
 * reading already done on it.
 *
 * Local News Mentions only ever read the first shelf, so a desk whose
 * grievance list was full of this morning's coverage still opened the news
 * screen to "No local news has been read yet". That is not a gap in what the
 * desk knows; it is a gap between two lists. This joins them.
 *
 * NOTHING IS INVENTED IN THE CROSSING. Every field below is copied from the
 * record: its headline, its publisher, its excerpt, the place it names, the
 * date it ran and the reading the model already produced. Where the record has
 * no value the mention carries null, exactly as a scanned mention would.
 */

/**
 * Does this address point at a story, or only at the paper that ran it?
 *
 * "eenadu.net" is a masthead; "eenadu.net/telangana/mahabubnagar/12345" is a
 * piece. Only the second identifies anything.
 */
function isStoryLink(url: string): boolean {
  try {
    const u = new URL(url)
    return u.pathname.replace(/\/+$/, '').split('/').filter(Boolean).length >= 2
  } catch {
    return false
  }
}

/** The stance a record's sentiment reading implies. */
function stanceOf(s: Sentiment): PersonaMention['stance'] {
  if (s === 'Strong Positive' || s === 'Positive') return 'supportive'
  if (s === 'Strong Negative' || s === 'Negative') return 'critical'
  if (s === 'Neutral') return 'neutral'
  // 'Mixed' took both sides, which is not the same as taking none.
  return 'unclear'
}

/** One filed grievance, read as the news story it came from. */
export function mentionFromRecord(r: GrievanceRecord, persona: string): PersonaMention {
  return {
    id: `news_from_grievance_${r.id}`,
    personaId: `record_${r.id}`,
    persona,
    url: r.sourceUrl,
    headline: r.headline,
    publisher: r.publisher,
    publishedAt: r.publishedAt,
    language: r.language,
    excerpt: r.excerpt,
    place: r.places[0] ?? r.constituency ?? null,
    stance: stanceOf(r.sentiment),
    sentiment: r.sentiment,
    fake: r.fake,
    summary: r.summary,
    recommendation: r.recommendation,
    seenAt: r.createdAt,
  }
}

/**
 * Every story the desk holds, from both shelves, newest first.
 *
 * Deduplicated on the story's own address so a piece that was both scanned and
 * filed is one row, not two. The scanned mention wins that tie: it is the
 * record the news screen has always shown, and its id is what the screen's
 * read/unread state is keyed on.
 */
export function newsMentionsOf(store: Store, persona: string): PersonaMention[] {
  const out: PersonaMention[] = [...store.personaMentions]

  /**
   * DEDUPLICATE ON THE STORY, NOT ON THE PAPER.
   *
   * An address only identifies a story when it points AT one. Records whose
   * source is the paper's front page all share that one address, so matching
   * on it threw away every filed story after the first: eight grievances
   * collapsed to nothing and this screen stayed exactly as empty as before.
   * A front page dedupes on nothing; only a deep link speaks for a story.
   */
  const deepSeen = new Set(
    out
      .map((m) => (m.url || '').trim().toLowerCase())
      .filter((u) => u.length > 0 && isStoryLink(u)),
  )
  const headlines = new Set(out.map((m) => m.headline.trim().toLowerCase()))

  for (const r of store.grievances) {
    const url = (r.sourceUrl || '').trim().toLowerCase()
    const headline = r.headline.trim().toLowerCase()
    if (url && isStoryLink(url) && deepSeen.has(url)) continue
    // The headline is what identifies a cutting that carries no address.
    if (headlines.has(headline)) continue
    if (url && isStoryLink(url)) deepSeen.add(url)
    headlines.add(headline)
    out.push(mentionFromRecord(r, persona))
  }

  const at = (m: PersonaMention): number => {
    const t = Date.parse(m.publishedAt ?? m.seenAt)
    return Number.isFinite(t) ? t : 0
  }
  return out.sort((a, b) => at(b) - at(a))
}
