/**
 * The accounts that talk ABOUT politicians, rather than being them.
 *
 * This is the influencer watch's actual subject. A rival's feed says what the
 * opposition is campaigning on; a broadcaster's or a commentator's says what is
 * being SAID about you — and only the second is a thing an office cannot find
 * out by reading its own posts. Rival politicians stood in here for a while and
 * it was the wrong shape: a screen headed "what people are saying" that listed
 * only people you are running against answers a question nobody asked.
 *
 * EVERY HANDLE WAS CHECKED AGAINST THE OUTLET'S OWN SITE. The footers of
 * tv9telugu.com, v6velugu.com and ntvtelugu.com each name the exact handle
 * below, which is what separates a broadcaster's channel from the several
 * mirrors and lookalikes shadowing each of them — @TV9Telugu on YouTube is a
 * 404 while @TV9TeluguLive is the newsroom, and the reverse holds on X. Where an
 * outlet runs a crowded namespace (ABN has three real X accounts) the one
 * carrying the TV channel's own branding was taken.
 *
 * SCOPE IS LOAD-BEARING. A Mahabubnagar MP's office does not watch Delhi's
 * national bulletins, and the Prime Minister is not served by Telugu district
 * reporting. The fact-checkers are `both`, because a viral claim about a
 * politician is checked by the same three organisations wherever the seat is.
 */

import type { Creator } from './roster'

export const CREATORS: Creator[] = [
  /* ── Telugu television: the daily bulletin coverage ─────────────────────── */
  {
    key: 'tv9telugu',
    name: 'TV9 Telugu',
    kind: 'News channel',
    language: 'Telugu',
    scope: 'telangana',
    why: 'The largest Telugu 24-hour broadcaster, Hyderabad-based, carrying continuous Telangana political bulletins and live press conferences.',
    handles: [
      // youtube.com/@TV9Telugu is a 404; the newsroom is @TV9TeluguLive. On X
      // it is the other way round. Neither was assumed from the other.
      { platform: 'YouTube', handle: 'TV9TeluguLive', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'TV9Telugu', confidence: 'high' },
    ],
  },
  {
    key: 'v6news',
    name: 'V6 News Telugu',
    kind: 'News channel',
    language: 'Telugu',
    scope: 'telangana',
    why: 'Explicitly Telangana-first: its bulletins and district reporting are built around this state rather than the two Telugu states together.',
    handles: [
      { platform: 'YouTube', handle: 'V6NewsTelugu', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'V6News', confidence: 'high' },
    ],
  },
  {
    key: 'ntvtelugu',
    name: 'NTV Telugu',
    kind: 'News channel',
    language: 'Telugu',
    scope: 'telangana',
    why: 'Hourly Telangana political bulletins, live press meets and assembly feeds.',
    handles: [
      { platform: 'YouTube', handle: 'ntvtelugu', confidence: 'high' },
      // The X handle keeps a "Live" suffix that the YouTube one drops —
      // verified against ntvtelugu.com's own footer rather than inferred.
      { platform: 'Twitter/X', handle: 'NtvTeluguLive', confidence: 'high' },
    ],
  },
  {
    key: 'abntelugu',
    name: 'ABN Telugu',
    kind: 'News channel',
    language: 'Telugu',
    scope: 'telangana',
    why: 'Its daily debate slots are dominated by Telangana and Andhra political argument — where a politician is discussed rather than merely reported.',
    handles: [
      { platform: 'YouTube', handle: 'abntelugutv', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'abntelugutv', confidence: 'high' },
    ],
  },
  {
    key: 'tv5news',
    name: 'TV5 News',
    kind: 'News channel',
    language: 'Telugu',
    scope: 'telangana',
    why: 'Runs constituency reporters across both Telugu states, so its coverage reaches seats the metro channels skip.',
    handles: [
      { platform: 'YouTube', handle: 'tv5news', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'tv5newsnow', confidence: 'high' },
    ],
  },

  /* ── Telugu commentary and digital ──────────────────────────────────────── */
  {
    key: 'nageshwar',
    name: 'Prof K Nageshwar',
    kind: 'Commentator',
    language: 'Telugu',
    scope: 'telangana',
    why: 'A former MLC publishing daily analysis that names individual politicians — opinion rather than bulletin, which is the part an office has to read.',
    handles: [{ platform: 'YouTube', handle: 'ProfKNageshwar', confidence: 'high' }],
  },
  {
    key: 'telakapalli',
    name: 'Telakapalli Ravi',
    kind: 'Commentator',
    language: 'Telugu',
    scope: 'telangana',
    why: 'A veteran Telugu political journalist whose channel is analysis of state politics by name.',
    handles: [{ platform: 'YouTube', handle: 'TelakapalliMedia', confidence: 'high' }],
  },
  {
    key: 'gulte',
    name: 'Gulte',
    kind: 'Digital news',
    language: 'English',
    scope: 'telangana',
    why: 'Digital-first Telugu-states outlet writing in English, so its coverage travels past the Telugu-reading audience.',
    handles: [
      { platform: 'YouTube', handle: 'GulteOfficial', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'GulteOfficial', confidence: 'high' },
    ],
  },
  {
    key: 'tolivelugu',
    name: 'Tolivelugu',
    kind: 'Digital news',
    language: 'Telugu',
    scope: 'telangana',
    why: 'Telugu digital newsroom with heavy Telangana political output.',
    handles: [
      { platform: 'YouTube', handle: 'ToliveluguTV', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'Tolivelugu', confidence: 'high' },
    ],
  },

  /* ── National coverage, for the national desks ──────────────────────────── */
  {
    key: 'ndtv',
    name: 'NDTV',
    kind: 'News channel',
    language: 'English',
    scope: 'national',
    why: 'Daily English coverage of the Prime Minister and the Leader of the Opposition.',
    handles: [
      { platform: 'YouTube', handle: 'ndtv', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'ndtv', confidence: 'high' },
    ],
  },
  {
    key: 'aajtak',
    name: 'Aaj Tak',
    kind: 'News channel',
    language: 'Hindi',
    scope: 'national',
    why: 'The largest Hindi news channel — where the Hindi-belt argument about these two actually happens.',
    handles: [
      { platform: 'YouTube', handle: 'aajtak', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'aajtak', confidence: 'high' },
    ],
  },
  {
    key: 'abpnews',
    name: 'ABP News',
    kind: 'News channel',
    language: 'Hindi',
    scope: 'national',
    why: 'Hindi national bulletins and debate carrying both principals daily.',
    handles: [
      { platform: 'YouTube', handle: 'ABPNEWS', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'ABPNews', confidence: 'high' },
    ],
  },
  {
    key: 'indiatoday',
    name: 'India Today',
    kind: 'News channel',
    language: 'English',
    scope: 'national',
    why: 'English national coverage with heavy political programming.',
    handles: [
      { platform: 'YouTube', handle: 'indiatoday', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'IndiaToday', confidence: 'high' },
    ],
  },
  {
    key: 'theprint',
    name: 'ThePrint',
    kind: 'Digital news',
    language: 'English',
    scope: 'national',
    why: 'Digital-first political analysis rather than bulletins — closer to what is being argued than to what happened.',
    handles: [
      { platform: 'YouTube', handle: 'ThePrintIndia', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'ThePrintIndia', confidence: 'high' },
    ],
  },

  /* ── Fact-checkers: relevant to every desk ──────────────────────────────── */
  {
    key: 'altnews',
    name: 'Alt News',
    kind: 'Fact-checker',
    language: 'English',
    scope: 'both',
    why: 'Where a viral claim about a politician gets checked — which matters to an office whether the claim is about them or by them.',
    handles: [
      { platform: 'YouTube', handle: 'AltNewsVideos', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'AltNews', confidence: 'high' },
    ],
  },
  {
    key: 'boomlive',
    name: 'BOOM',
    kind: 'Fact-checker',
    language: 'English',
    scope: 'both',
    why: 'IFCN-signatory fact-checker covering political misinformation in several Indian languages.',
    handles: [
      { platform: 'YouTube', handle: 'boomlive_in', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'boomlive_in', confidence: 'high' },
    ],
  },
  {
    key: 'factly',
    name: 'Factly',
    kind: 'Fact-checker',
    language: 'English',
    scope: 'both',
    why: 'Hyderabad-based, so it checks Telugu-states claims as well as national ones.',
    handles: [
      { platform: 'YouTube', handle: 'Factlyindia', confidence: 'high' },
      { platform: 'Twitter/X', handle: 'FactlyIndia', confidence: 'high' },
    ],
  },
]

/** The accounts worth actually visiting, on the same `high`-only rule as PEOPLE. */
export function scrapableCreatorHandles(creator: Creator): Creator['handles'] {
  return creator.handles.filter((h) => h.confidence === 'high')
}
