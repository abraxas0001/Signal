/**
 * Facebook.
 *
 * Every class name on this site is a hashed build artefact that changes
 * between deploys, so nothing here selects on one. What is stable is the SHAPE
 * OF A PERMALINK: a post URL always contains `/posts/`, `/permalink.php`,
 * `/videos/`, `/reel/` or `/share/p/`. So the strategy is to take every anchor
 * on the rendered page and keep the ones whose href matches those patterns.
 * That survives a redesign; a class selector does not.
 *
 * COUNTS ARE MOSTLY LEFT NULL, deliberately. Facebook renders reaction and
 * comment totals inconsistently — sometimes as an aria-label, sometimes as a
 * bare abbreviated string, often not at all until the post is opened. Opening
 * each post to collect them would multiply the navigation count by twenty and
 * is precisely the behaviour that gets a session flagged. It is also
 * unnecessary: the app already has a proven per-post reader that pulls exact
 * counts and full comment bodies from a supplied URL. This adapter's job is to
 * FIND the URLs; the app's job is to read them.
 *
 * DATES ARE NOT LEFT NULL, and that is a separate decision from the counts. A
 * missing count blanks one cell; a missing date removes the post. Every window
 * on this dashboard filters by publication date, so an undated post falls
 * outside all of them at once. Measured on this desk's own page: twenty five
 * Facebook posts arrived with no date on any of them, and the office was shown
 * "1 post" and almost no engagement for an account that posts most days.
 *
 * The cause was that the only source read here was `abbr[data-utime]`, which
 * belongs to the old mobile document. The Comet profile served to a signed-in
 * browser contains no `abbr` at all, so that read returned null every time and
 * had no fallback behind it. `publishedOf` now tries four sources in order of
 * how directly Facebook stated the time, and still answers null when none of
 * them states one: a post filed into the wrong week is worse than a post the
 * desk can see is undated.
 */

import { isLoggedOut } from '../session'
import {
  canonicalUrl,
  parseCount,
  type AdapterContext,
  type AdapterResult,
  type PlatformAdapter,
  type ScrapedComment,
  type ProfileInfo,
  type ScrapedPost,
  cutCaption,
} from '../types'
import { autoScroll } from '../browser'

/** The permalink shapes a Facebook post can take. */
/**
 * Each shape a Facebook permalink takes.
 *
 * The segments that carry a numeric id demand one. Written without that, the
 * pattern accepted the bare `facebook.com/reel/` sitting in the profile’s own
 * navigation and recorded it as a post — a URL with no id, pointing at a
 * product surface rather than at anything this politician published.
 */
const POST_HREF =
  /(\/posts\/|\/permalink\.php\?|\/videos\/[0-9]|\/reel\/[0-9]|\/share\/p\/|story_fbid=)/i

/** Chrome, navigation and product links that also live on a profile page. */
const NOISE = /\/(login|privacy|policies|help|settings|marketplace|gaming|watch\/?$)/i

interface RawPost {
  href: string
  /** Text of the post container this link sits in, for a title preview. */
  text: string | null
  /** Any aria-label on the container that might carry counts. */
  label: string | null
  /**
   * When the post says it was published, as epoch milliseconds, and how that
   * was learned. `exact` is a time Facebook itself stated. `derived` was
   * computed from a rendered relative age ("4 d") against the clock at the
   * moment of this read, and is therefore only as precise as that age was.
   * Null when the page stated neither, which stays null all the way out.
   */
  publishedMs: number | null
  publishedKind: 'exact' | 'derived' | null
  /** Counts lifted from the action row, each identified by its own button. */
  likes: string | null
  comments: string | null
  shares: string | null
  /** Per-reaction totals off the summary pills, for posts that show no Like figure. */
  reactionPills: string[]
  thumb: string | null
}

function harvest(): RawPost[] {
  const seen = new Set<string>()
  const out: RawPost[] = []

  /* ── when a post was published ───────────────────────────────────────────
   *
   * Everything from here to `publishedOf` exists inside this function on
   * purpose. `harvest` is handed to `page.evaluate`, which ships its SOURCE to
   * the browser: nothing in this module's scope exists there, so a helper
   * written beside `parseCount` would compile happily and throw a
   * ReferenceError on the page. That is also why the permalink shape below is
   * a second copy of `POST_HREF` rather than a reference to it.
   */

  /** The clock at the moment of this read. Relative ages count back from it. */
  const now = Date.now()

  /** The permalink shapes, copied from POST_HREF for the reason just above. */
  const PERMALINK =
    /(\/posts\/|\/permalink\.php\?|\/videos\/[0-9]|\/reel\/[0-9]|\/share\/p\/|story_fbid=)/i

  /**
   * A sanity gate every candidate time passes through.
   *
   * Facebook opened in February 2004, so nothing it hosts was published before
   * then, and nothing it shows on a profile was published after this read.
   * Anything outside that is not a publication date, it is some other number
   * that happened to sit where one was expected: a count read as seconds, a
   * millisecond value read as seconds, an event's date. Refused rather than
   * recorded.
   */
  const plausible = (ms: number): boolean =>
    Number.isFinite(ms) && ms >= Date.UTC(2004, 1, 4) && ms <= now + 5 * 60_000

  /**
   * The post identifiers a permalink carries. Two URLs for the same post
   * differ only in tracking parameters, so these tokens are what one post is
   * known by, both here and inside the page's embedded JSON.
   */
  const tokensOf = (raw: string): string[] => {
    const tokens: string[] = []
    for (const pattern of [
      /\/posts\/([\w-]+)/,
      /story_fbid=([\w-]+)/,
      /\/(?:videos|reel)\/(\d+)/,
      /\/share\/p\/([\w-]+)/,
    ]) {
      const hit = raw.match(pattern)?.[1]
      if (hit && hit.length >= 6) tokens.push(hit)
    }
    return tokens
  }

  /**
   * Publication times out of the page's own embedded JSON, keyed by post token.
   *
   * Facebook ships its feed as GraphQL payloads in `<script type=
   * "application/json">`, and a story node carries `creation_time` in unix
   * seconds. That is the best kind of source available here: an absolute
   * instant, stated by Facebook, with no timezone or locale in it.
   *
   * The whole difficulty is deciding WHICH post a given `creation_time`
   * belongs to, and the rule chosen is structural rather than positional, for
   * the same reason the counts above are read from their own buttons: a time
   * is only attributed to a post whose token appears on the SAME JSON object.
   * Nearest-timestamp-in-the-text would have been easy and would silently
   * borrow the neighbouring story's date whenever a story carried no time of
   * its own, and a post filed one slot along is exactly the failure this file
   * refuses. Comment nodes are skipped for the same reason: a comment's own
   * permalink contains the post's token, so its `creation_time` would
   * otherwise date the post by when somebody replied to it.
   *
   * When two objects claim different times for one token the token is dropped
   * rather than guessed at, and the rendered timestamp below is used instead.
   */
  const payloadTime = new Map<string, number | null>()
  {
    // A ceiling on nodes visited, so a pathological payload cannot freeze the
    // page: this runs once per scroll round on documents of several megabytes.
    let budget = 400_000

    const remember = (token: string, ms: number): void => {
      const known = payloadTime.get(token)
      if (known === undefined) payloadTime.set(token, ms)
      else if (known !== null && Math.abs(known - ms) > 60_000) payloadTime.set(token, null)
    }

    const visit = (node: unknown): void => {
      if (budget-- <= 0) return
      if (Array.isArray(node)) {
        for (const item of node) visit(item)
        return
      }
      if (node === null || typeof node !== 'object') return
      const obj = node as Record<string, unknown>

      const seconds =
        typeof obj['creation_time'] === 'number'
          ? obj['creation_time']
          : typeof obj['publish_time'] === 'number'
            ? obj['publish_time']
            : null
      const typeName = typeof obj['__typename'] === 'string' ? obj['__typename'] : ''
      const ms = seconds === null ? null : seconds * 1_000

      if (ms !== null && plausible(ms) && !/comment|reply/i.test(typeName)) {
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value !== 'string') continue
          // A comment or reply permalink names the post it hangs under. Its
          // time is the reply's, never the post's.
          if (/comment_id|reply_/i.test(value)) continue
          if (/^(?:post_id|story_fbid|video_id|legacy_story_fbid)$/i.test(key)) {
            if (value.length >= 6) remember(value, ms)
          } else if (value.includes('facebook.com')) {
            for (const token of tokensOf(value)) remember(token, ms)
          }
        }
      }

      for (const value of Object.values(obj)) visit(value)
    }

    for (const script of Array.from(document.querySelectorAll('script[type="application/json"]'))) {
      const text = script.textContent ?? ''
      if (!text.includes('creation_time') && !text.includes('publish_time')) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        continue
      }
      visit(parsed)
    }
  }

  /**
   * Month names in the three languages this desk's Facebook actually renders.
   *
   * Same reasoning as the count labels above: this page's interface is Hindi
   * and its audience posts in Telugu, and English is what an untouched account
   * gets. An interface in some other language matches nothing here and the
   * post falls through to the relative age or to null, which is the right
   * failure and not a guess.
   *
   * A month is matched by NAME and never by position, which is what makes the
   * day and the month impossible to swap: "25 अगस्त 2026" and "August 25,
   * 2026" both carry the month in letters, so neither can be read the American
   * way or the Indian way by mistake.
   */
  const MONTHS: readonly (readonly string[])[] = [
    ['january', 'jan', 'जनवरी', 'జనవరి'],
    ['february', 'feb', 'फ़रवरी', 'फरवरी', 'ఫిబ్రవరి'],
    ['march', 'mar', 'मार्च', 'మార్చి'],
    ['april', 'apr', 'अप्रैल', 'ఏప్రిల్'],
    ['may', 'मई', 'మే'],
    ['june', 'jun', 'जून', 'జూన్'],
    ['july', 'jul', 'जुलाई', 'జూలై', 'జులై'],
    ['august', 'aug', 'अगस्त', 'ఆగస్టు', 'ఆగష్టు'],
    ['september', 'sept', 'sep', 'सितंबर', 'सितम्बर', 'సెప్టెంబర్'],
    ['october', 'oct', 'अक्तूबर', 'अक्टूबर', 'అక్టోబర్'],
    ['november', 'nov', 'नवंबर', 'नवम्बर', 'నవంబర్'],
    ['december', 'dec', 'दिसंबर', 'दिसम्बर', 'డిసెంబర్'],
  ]
  const MONTH_ALT = MONTHS.map((names) => names.join('|')).join('|')

  // "25 अगस्त 2026", "25 August 2026", "August 25, 2026". The year is optional
  // because Facebook omits it inside the last twelve months. The lookarounds
  // stop a day being taken out of the middle of a longer number, and the
  // lookahead after the month stops "may" being found inside a word.
  const DAY_FIRST = new RegExp(
    `(?<!\\d)(\\d{1,2})(?!\\d)[\\s,.]*(${MONTH_ALT})(?=[\\s,.]|$)[\\s,.]*(\\d{4})?`,
  )
  const MONTH_FIRST = new RegExp(
    `(${MONTH_ALT})(?=[\\s,.]|$)[\\s,.]*(\\d{1,2})(?!\\d)[\\s,.]*(\\d{4})?`,
  )
  const CLOCK = /(?<!\d)(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:([ap])\.?m\.?)?/

  /**
   * An absolute timestamp Facebook rendered, as epoch ms, or null.
   *
   * Built with `new Date(y, m, d, …)`, which is local time, deliberately.
   * This code runs inside the browser that rendered the string, and Facebook
   * formats these in the viewer's own zone, so local is the zone the label was
   * written in. Parsing the same string back in Node would apply the server's
   * zone to a wall clock that was never in it.
   *
   * TWO PLACES WHERE PRECISION IS CLAIMED AND MUST NOT BE. A label that names
   * a day but no clock time is recorded at local noon: the DAY is what was
   * read, and noon is the hour that no timezone conversion can push into a
   * neighbouring day. And a clock time with no AM/PM this parser recognises is
   * discarded rather than assumed, because "9:21" is two different hours and
   * the wrong one moves the post across midnight, so those also land on noon.
   */
  const absoluteFrom = (raw: string): number | null => {
    const label = raw.toLowerCase()
    const dayFirst = label.match(DAY_FIRST)
    const monthFirst = label.match(MONTH_FIRST)

    // Whichever shape starts earlier is the real date. Read month-first, "25
    // अगस्त 2026" matches "अगस्त 20" and calls the first half of the year a day.
    const useDayFirst =
      dayFirst !== null && (monthFirst === null || (dayFirst.index ?? 0) <= (monthFirst.index ?? 0))
    const m = useDayFirst ? dayFirst : monthFirst
    if (!m) return null

    const day = Number(useDayFirst ? m[1] : m[2])
    const month = MONTHS.findIndex((names) => names.includes((useDayFirst ? m[2] : m[1]) ?? ''))
    if (!Number.isInteger(day) || day < 1 || day > 31 || month < 0) return null

    const yearText = m[3]
    const scrapeYear = new Date(now).getFullYear()
    let year = scrapeYear
    if (yearText !== undefined) {
      const stated = Number(yearText)
      // A four digit number that cannot be a year is not the year: it is some
      // other figure standing where one would be, and the label is refused
      // rather than read around.
      if (!Number.isInteger(stated) || stated < 2004 || stated > scrapeYear + 1) return null
      year = stated
    }

    let hour = 12
    let minute = 0
    const clock = label.match(CLOCK)
    const statedHour = clock ? Number(clock[1]) : Number.NaN
    const statedMinute = clock ? Number(clock[2]) : Number.NaN
    if (Number.isInteger(statedHour) && Number.isInteger(statedMinute) && statedMinute < 60) {
      const meridiem = clock?.[3]
      if ((meridiem === 'a' || meridiem === 'p') && statedHour >= 1 && statedHour <= 12) {
        hour = (statedHour % 12) + (meridiem === 'p' ? 12 : 0)
        minute = statedMinute
      } else if (meridiem === undefined && (statedHour === 0 || (statedHour >= 13 && statedHour <= 23))) {
        // Unambiguously a 24 hour clock: no 12 hour rendering says 0 or 21.
        hour = statedHour
        minute = statedMinute
      }
    }

    const at = (y: number): number | null => {
      const d = new Date(y, month, day, hour, minute, 0, 0)
      // A day the month does not have rolls forward into the next one. Refuse
      // it rather than record the rolled over date.
      if (d.getFullYear() !== y || d.getMonth() !== month || d.getDate() !== day) return null
      return d.getTime()
    }

    let ms = at(year)
    // Facebook omits the year only inside the last twelve months, so a
    // year-less date that lands in the future is last year's. This is the one
    // inference in this parser and it is the platform's own stated convention.
    if (ms !== null && yearText === undefined && ms > now + 24 * 3_600_000) ms = at(year - 1)

    return ms !== null && plausible(ms) ? ms : null
  }

  /**
   * A rendered relative age converted against the clock of this read, or null.
   *
   * This is the only APPROXIMATE source in this file and it is used last.
   * Facebook floors these: "4 d" means the post is between four and five days
   * old, and this records the newer edge of that band, so a derived date is
   * never later than the truth and never more than one unit earlier.
   *
   * Months and years are refused outright. A "2 y" age places a post anywhere
   * inside a twelve month band, which is not a date by any reading, and a
   * post dropped into the wrong month of the wrong year would be believed. So
   * is a bare "m", which is minutes in some renderings and months in others:
   * one reading of "5 m" is five minutes ago and the other is five months, and
   * there is nothing in the string to say which. Refusing it costs a post its
   * date; guessing it costs the office a wrong one.
   */
  const AGES: readonly (readonly [RegExp, number])[] = [
    [/^(?:s|sec|secs|second|seconds|सेकंड|सेकेंड|సెకను|సెకన్లు)$/, 1_000],
    [/^(?:min|mins|minute|minutes|मिनट|मि|నిమిషం|నిమిషాల|నిమి)$/, 60_000],
    [/^(?:h|hr|hrs|hour|hours|घं|घंटा|घंटे|గం|గంట|గంటల)$/, 3_600_000],
    [/^(?:d|day|days|दिन|రోజు|రోజుల|రో)$/, 86_400_000],
    [/^(?:w|wk|wks|week|weeks|सप्ताह|हफ़्ते|हफ्ते|వారం|వారాల|వా)$/, 604_800_000],
  ]

  const relativeFrom = (raw: string): number | null => {
    const text = raw
      .trim()
      .toLowerCase()
      .replace(/\s*(?:ago|पहले|క్రితం)$/, '')
      .trim()
    // The WHOLE string must be a number and a unit. A caption that happens to
    // contain "3 दिन" is prose about three days, not a timestamp.
    const m = text.match(/^(\d{1,3})\s*([^\s\d]+)$/)
    const count = m?.[1] === undefined ? Number.NaN : Number(m[1])
    const unit = m?.[2]
    if (!Number.isInteger(count) || count < 1 || unit === undefined) return null

    for (const [shape, span] of AGES) {
      if (!shape.test(unit)) continue
      const ms = now - count * span
      return plausible(ms) ? ms : null
    }
    return null
  }

  /**
   * When this post was published, in order of how directly Facebook said it.
   *
   *  1. `data-utime`, unix seconds the old mobile markup puts on the age.
   *     Unambiguous, and absent from the Comet profile, kept because the
   *     mobile document still carries it and it costs one loop.
   *  2. `creation_time` from the embedded JSON, attributed structurally.
   *  3. The absolute timestamp Facebook renders as a label on the age,
   *     "मंगलवार, 25 अगस्त 2026 को 9:21 AM पर". This file already knew that
   *     string was there: the reaction pill matcher above had to be shaped to
   *     exclude it.
   *  4. The relative age on the permalink, "22 h" or "3 दिन". Approximate, and
   *     counted separately in the run log so the desk is never told a derived
   *     date and a stated one are the same thing.
   *
   * Sources 3 and 4 read only from THIS article, never a nested one. Comments
   * are articles with ages and timestamps of their own, and a post dated by
   * its replies would be filed by when it was answered rather than written.
   */
  const publishedOf = (
    article: Element | null,
    href: string,
  ): { ms: number; kind: 'exact' | 'derived' } | null => {
    if (article) {
      for (const el of Array.from(article.querySelectorAll('[data-utime]'))) {
        if (el.closest('[role="article"]') !== article) continue
        const ms = Number(el.getAttribute('data-utime')) * 1_000
        if (plausible(ms)) return { ms, kind: 'exact' }
      }
    }

    for (const token of tokensOf(href)) {
      const ms = payloadTime.get(token)
      if (typeof ms === 'number') return { ms, kind: 'exact' }
    }

    if (article) {
      /*
       * THE AGE ELEMENT IDENTIFIES ITSELF; NOTHING ELSE IS TRUSTED ALONE.
       *
       * The previous pass here believed any labelled descendant of any
       * permalink anchor, and a review reproduced what that does: a video
       * card whose attachment anchor carried the VIDEO'S TITLE as its label
       * ("Independence Day speech, 15 August 2025") was filed thirteen months
       * early, pre-empting a relative age that was right. A permalink anchor
       * is not the timestamp; the anchor WHOSE OWN TEXT IS THE AGE is. So the
       * only label read on the permalink is one sitting on that age element,
       * and it is believed only when it agrees with the age it decorates, to
       * within two days. The visible age is Facebook's statement either way:
       * agreement upgrades it to the label's exact instant, disagreement
       * keeps the honest derived reading.
       */
      for (const link of Array.from(article.querySelectorAll('a[href]'))) {
        if (link.closest('[role="article"]') !== article) continue
        if (!PERMALINK.test(link.getAttribute('href') ?? '')) continue
        const rel = relativeFrom(link.textContent ?? '')
        if (rel === null) continue
        const labels: string[] = []
        for (const el of [link, ...Array.from(link.querySelectorAll('[aria-label], [title]'))]) {
          const label = el.getAttribute('aria-label')
          const title = el.getAttribute('title')
          if (label) labels.push(label)
          if (title) labels.push(title)
        }
        for (const label of labels) {
          const abs = absoluteFrom(label)
          if (abs !== null && Math.abs(abs - rel) <= 48 * 3_600_000) {
            return { ms: abs, kind: 'exact' }
          }
        }
        return { ms: rel, kind: 'derived' }
      }

      /*
       * No age anywhere on the card. Loose labels elsewhere in it are weak
       * claims, and one alone proves nothing: a shared post shows the
       * original's date, an attached event shows the event's, a linked story
       * shows its dateline, and each of those was reproduced filing the post
       * under somebody else's day when a single label was believed. Only two
       * INDEPENDENT labels that agree to within a day are taken, because two
       * different attachments misdating the same post identically is not a
       * coincidence this desk has seen.
       */
      const loose: number[] = []
      for (const el of Array.from(article.querySelectorAll('[aria-label], [title]'))) {
        if (el.closest('[role="article"]') !== article) continue
        const link = el.closest('a[href]')
        if (link !== null && PERMALINK.test(link.getAttribute('href') ?? '')) continue
        const label = el.getAttribute('aria-label')
        const title = el.getAttribute('title')
        for (const text of [label, title]) {
          if (!text) continue
          const ms = absoluteFrom(text)
          if (ms !== null) loose.push(ms)
        }
      }
      if (loose.length >= 2) {
        const earliest = Math.min(...loose)
        const latest = Math.max(...loose)
        if (latest - earliest <= 24 * 3_600_000) return { ms: earliest, kind: 'exact' }
      }
    }

    return null
  }

  /* == the caption, without Facebook's own controls ======================== */

  /**
   * Facebook's "See more" button sits INSIDE the message container.
   *
   * A collapsed caption renders as the visible words, an ellipsis, and then
   * the control that expands them, and all three are children of
   * `[data-ad-comet-preview="message"]`. So `textContent` glued the button's
   * label onto the end of the caption and it was stored as part of the post's
   * words: measured over the roster, 90 of the 231 stored Facebook captions
   * ended in that control. Downstream nothing can tell it from something the
   * politician wrote. The compare board's topic ranker weights two word
   * phrases above single words, so "और देखें" outscored every real subject and
   * printed as the first "Top topic" chip on the KTR desk, off two posts in
   * ten.
   *
   * Three forms, because those are the ones these sessions render: the Hindi
   * interface this desk's account is served ("और देखें"), the English one
   * ("See more"), and the newer web layout that writes the truncation mark and
   * the control as a single run ("…more").
   *
   * THE ELLIPSIS STAYS. It is not chrome. It is Facebook stating that this
   * caption is cut short, and the desk should be able to see that the words it
   * holds are part of a post rather than read them as the whole of one. So the
   * ellipsis run is put back where the control absorbed it.
   */
  const SEE_MORE = /[\s\u200b-\u200d\ufeff]*(?:और\s*देखें|see\s*more)[\s\u200b-\u200d\ufeff]*$/iu
  const ELLIPSIS_MORE = /(…|\.\.\.)[\s\u200b-\u200d\ufeff]*more[\s\u200b-\u200d\ufeff]*$/iu

  /**
   * Null, not an empty string, when the control was the whole of it. A caption
   * that reduces to nothing is a post with no caption, which is the answer the
   * reader below already gives when no message container is present at all.
   */
  const captionOf = (text: string | null): string | null => {
    if (text === null) return null
    const words = text
      .replace(SEE_MORE, '')
      .replace(ELLIPSIS_MORE, '$1')
      .replace(/[\s\u200b-\u200d\ufeff]+$/u, '')
    return words.length > 0 ? words : null
  }

  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const href = (a as HTMLAnchorElement).getAttribute('href') ?? ''
    if (!href || seen.has(href)) continue
    seen.add(href)

    // The post container: FB marks each story with role="article". Walking up
    // to it gives the text preview and any labelled counts in one place.
    const article = a.closest('[role="article"]')

    // The post BODY, not the card's textContent. A card begins with the
    // author, their verification badge, a location, a relative age and an
    // audience note, so `textContent` yielded titles reading "D K Aruna
    // वेरिफ़ाई किया गया अकाउंट, Gadwal,Telangana में हैं.3 दिन · इनके साथ शेयर
    // किया गया" — the same chrome on every post, with the caption pushed past
    // the 140-character cut. These two attributes wrap the caption alone;
    // measured, they return the Telugu post text cleanly.
    //
    // Null when neither is present rather than falling back to the card text:
    // a post with no caption genuinely has no title, and repeating the chrome
    // would dress that absence up as content. Comment threads are `article`s
    // too and carry neither attribute, so this also keeps a reply's text from
    // being recorded as the post's.
    //
    // Cleaned here rather than at the 140-character cut downstream, so that no
    // reading ever holds the button's label: the cut then spends its
    // characters on the caption instead of on Facebook's chrome, and the count
    // fallback that scans this same text is not reading Facebook's own words.
    const body = captionOf(
      article?.querySelector('[data-ad-comet-preview="message"]')?.textContent?.trim() ??
        article?.querySelector('[data-ad-preview="message"]')?.textContent?.trim() ??
        null,
    )

    /**
     * The counts, each taken from the button that names it.
     *
     * Measured on a live profile: every figure in the action row sits inside
     * its own `[role="button"]`, and that button's aria-label says which count
     * it is — "लाइक करें" / "कमेंट करें" / "इसे अपने दोस्तों को भेजें". So the
     * number is identified by WHAT IT BELONGS TO, not by where it appears.
     *
     * That distinction is the whole reason these are read at all now. The
     * earlier attempt looked at the bare number spans in order — [140, 6, 12]
     * for reactions, comments, shares — and was rejected, correctly: a post
     * with no shares renders two spans, not three, and the comment count would
     * have been filed as shares. Reading each from its own button removes the
     * ordering assumption entirely; a missing count is simply a button with no
     * number in it, and stays null.
     *
     * The labels are matched in several languages because this desk's Facebook
     * renders in Hindi and its audience posts in Telugu. An interface in some
     * other language matches nothing and yields nulls — which is the right
     * failure, and the one this file already chose over a plausible guess.
     */
    let likes: string | null = null
    let comments: string | null = null
    let shares: string | null = null

    for (const btn of Array.from(article?.querySelectorAll('[role="button"][aria-label]') ?? [])) {
      const label = btn.getAttribute('aria-label') ?? ''

      // The button's own bare-number leaf, if it has one. A button with no
      // number is a zero-count action, and contributes nothing.
      let num: string | null = null
      for (const el of Array.from(btn.querySelectorAll('span, div'))) {
        const t = (el.textContent ?? '').trim()
        if (/^[\d.,]+\s*[KMB]?$/.test(t) && el.querySelector('span, div') === null) {
          num = t
          break
        }
      }
      if (num === null) continue

      // Comments and shares are tested first: "लाइक करें" is a substring of
      // nothing else, but a share label can mention liking.
      if (comments === null && /comment|कमेंट|కామెంట్|వ్యాఖ్య/i.test(label)) comments = num
      else if (shares === null && /share|send this|भेजें|शेयर|షేర్|పంపండి/i.test(label)) shares = num
      else if (likes === null && /like|लाइक|ఇష్టం|లైక్/i.test(label)) likes = num
    }

    /**
     * The reaction pills, for posts whose Like button carries no figure.
     *
     * Measured on a page with sixty-two million followers: its posts render
     * comments and shares inside their buttons as usual, but no number in the
     * Like button at all. The reaction total lives instead in a row of pills,
     * each naming its own reaction — "लाइक करें: 6.7 हज़ार लोग" (Like: 6,700),
     * "बहुत पसंद: 848 लोग" (Love: 848). Summing those gives the total, and it
     * is structural rather than positional: each figure is labelled with the
     * reaction it belongs to.
     *
     * Two constraints keep this from over-reading. The shape demanded is a
     * SHORT prefix, then a colon, then a number — which admits "Like: 6.7
     * thousand people" and excludes the timestamp "मंगलवार, 25 अगस्त 2026 को
     * 9:21 AM पर", whose first colon is thirty characters in. And only labels
     * belonging to THIS article are read: comment threads are nested articles
     * with reaction pills of their own, and summing those in would inflate the
     * post's total with its readers' likes.
     */
    const reactionPills: string[] = []
    for (const el of Array.from(article?.querySelectorAll('[aria-label]') ?? [])) {
      if (el.closest('[role="article"]') !== article) continue
      const l = el.getAttribute('aria-label') ?? ''
      const m = l.match(/^[^:]{1,25}:\s*([\d.,]+(?:\s*[^\s\d]+)?)\s/)
      if (m?.[1]) reactionPills.push(m[1])
    }

    const when = publishedOf(article, href)

    out.push({
      href,
      text: body ? body.slice(0, 200) : null,
      label: article?.getAttribute('aria-label') ?? null,
      publishedMs: when?.ms ?? null,
      publishedKind: when?.kind ?? null,
      likes,
      comments,
      shares,
      reactionPills,
      /**
       * The post's own picture, by size rather than by position.
       *
       * A card carries the author's avatar, reaction icons and often several
       * commenter faces, all from the same CDN. Demanding 200px of rendered
       * width leaves only the attached photo — avatars render at 40 or 60.
       */
      thumb:
        Array.from(article?.querySelectorAll('img') ?? [])
          .map((im) => im as HTMLImageElement)
          .filter((im) => im.naturalWidth >= 200 && /scontent|fbcdn/.test(im.currentSrc || im.src))
          .sort((a, b) => b.naturalWidth - a.naturalWidth)[0]?.currentSrc ?? null,
    })
  }
  return out
}

/**
 * Pull a count out of whatever string Facebook happened to render.
 *
 * Returns null far more often than it returns a number, and that is correct —
 * see the header. A wrong number here is worse than no number.
 */
function countFrom(text: string | null, word: RegExp): number | null {
  if (!text) return null
  const m = text.match(new RegExp(`([\\d.,]+\\s*[KMB]?)\\s*${word.source}`, 'i'))
  return m?.[1] ? parseCount(m[1]) : null
}

function normaliseHandle(handle: string): string {
  const h = handle.trim().replace(/^@/, '')
  const asUrl = h.match(/facebook\.com\/([^/?#]+)/i)
  return (asUrl?.[1] ?? h).replace(/\/+$/, '')
}

export const facebook: PlatformAdapter = {
  platform: 'Facebook',

  profileUrl: (handle) => {
    const h = handle.trim()
    if (/^https?:\/\//i.test(h)) return h
    return `https://www.facebook.com/${normaliseHandle(h)}`
  },

  /**
   * Facebook's own version of this check happened to be right — measured
   * signed out, the email and password inputs are both present — but it was
   * right by luck rather than by rule, and would break the moment Facebook
   * moved the form behind a button as Instagram has. `isLoggedOut` requires
   * proof of a session instead of recognising one shape of wall.
   */
  isLoginWall: ({ page }) => isLoggedOut(page, 'Facebook'),

  /**
   * The header: display name, follower count, avatar.
   *
   * The follower total sits on a link to /followers/, which is why this reads
   * the anchor rather than scanning the page for the word. Measured on the
   * Hindi interface the text came back "2.8 लाख फ़ॉलोअर" — the SELECTOR is
   * language-independent even though the text is not, and parseCount knows
   * लाख. It returns null rather than a bare 2.8 if it ever meets a unit it does
   * not know, which is the behaviour that matters here.
   */
  profile: async ({ page }: AdapterContext): Promise<ProfileInfo> => {
    const raw = await page
      .evaluate(() => {
        const link = Array.from(document.querySelectorAll('a[href*="/followers"]')).find((a) =>
          /[0-9]/.test(a.textContent ?? ''),
        )
        return {
          followers: link?.textContent?.trim() ?? null,
          displayName: document.querySelector('h1')?.textContent?.trim() ?? null,
          avatarUrl:
            document.querySelector('image[*|href]')?.getAttribute('xlink:href') ??
            document.querySelector('[data-imgperflogname="profileCoverPhoto"] img')?.getAttribute('src') ??
            null,
        }
      })
      .catch(() => ({ followers: null, displayName: null, avatarUrl: null }))

    return {
      displayName: raw.displayName || null,
      followers: parseCount(raw.followers),
      avatarUrl: raw.avatarUrl,
    }
  },

  posts: async (ctx: AdapterContext, handle): Promise<AdapterResult<ScrapedPost>> => {
    const { page, log, limit } = ctx

    // "This content isn't available right now" is a real answer about the
    // page, not a failure to read it.
    const unavailable = await page
      .locator("text=/content isn't available|page isn't available|Page Not Found/i")
      .count()
      .catch(() => 0)
    if (unavailable > 0) {
      return { ok: true, items: [], note: 'Facebook reports this page as unavailable.' }
    }

    const found = new Map<string, ScrapedPost>()

    /**
     * How each post got its date, for the run log.
     *
     * A date derived from "4 d" and a date Facebook stated are not the same
     * measurement, and nothing downstream can tell them apart once both are
     * ISO strings. The counts are said out loud at the end of the read so a
     * page whose dates are all derived, or all missing, announces itself here
     * rather than being discovered as a strange looking week on the dashboard.
     */
    const dating = { stated: 0, derived: 0, undated: 0 }

    for (let round = 0; round < 10 && found.size < limit; round++) {
      const raw = await page.evaluate(harvest).catch(() => [] as RawPost[])

      for (const r of raw) {
        if (!POST_HREF.test(r.href) || NOISE.test(r.href)) continue
        const url = canonicalUrl(r.href, 'https://www.facebook.com')
        if (!url || found.has(url)) continue

        const id =
          url.match(/\/posts\/(?:pfbid)?([\w-]+)/)?.[1] ??
          url.match(/story_fbid=([\w-]+)/)?.[1] ??
          url.match(/\/(?:videos|reel)\/(\d+)/)?.[1] ??
          null

        // The action-row buttons are the primary reading. `countFrom` over the
        // card text stays as a fallback for a layout where the buttons carry no
        // figures, and still returns null far more often than a number.
        const blob = [r.label, r.text].filter(Boolean).join(' ')

        if (r.publishedKind === 'exact') dating.stated++
        else if (r.publishedKind === 'derived') dating.derived++
        else dating.undated++

        found.set(url, {
          url,
          id,
          title: cutCaption(r.text),
          // Already an instant by the time it reaches here: the page settled
          // which source could state it, because two of the four sources only
          // mean anything in the browser's own timezone and clock.
          publishedAt: r.publishedMs === null ? null : new Date(r.publishedMs).toISOString(),
          // The Like button first, then the sum of the reaction pills, then the
          // card text. Each falls through only when the one before found
          // nothing at all — never when it found a zero.
          likes:
            parseCount(r.likes) ??
            r.reactionPills.reduce<number | null>((total, pill) => {
              const n = parseCount(pill)
              return n === null ? total : (total ?? 0) + n
            }, null) ??
            countFrom(blob, /reactions?|likes?/),
          comments: parseCount(r.comments) ?? countFrom(blob, /comments?/),
          shares: parseCount(r.shares) ?? countFrom(blob, /shares?/),
          views: null,
          thumbnailUrl: r.thumb,
        })
        if (found.size >= limit) break
      }

      if (found.size >= limit) break
      const grew = await autoScroll(page, { rounds: 1, pauseMs: 2_000 })
      if (grew === 0 && round > 1) break
    }

    /**
     * Zero permalinks is reported as a failure, not an empty page, and this is
     * the measured case that matters most: a logged-OUT read of a Facebook
     * profile returns a 4.9 MB document containing no post links at all. If a
     * stale session silently degrades to that, the office must be told the
     * read failed — not that a rival stopped posting.
     */
    if (found.size === 0) {
      return {
        ok: false,
        reason:
          'Facebook rendered no post permalinks. The session is probably signed out or this profile withholds its timeline.',
      }
    }

    log(
      `Facebook: ${found.size} posts for ${normaliseHandle(handle)} ` +
        `(${dating.stated} dated by Facebook, ${dating.derived} from a relative age, ` +
        `${dating.undated} undated)`,
    )
    return { ok: true, items: [...found.values()].slice(0, limit) }
  },

  /**
   * Comments on an already-navigated post page.
   *
   * Facebook hides most replies behind "View more comments", and clicking
   * through them is many interactions on a page that is already watching for
   * automation. One expansion click, then read what is there — the app's own
   * per-post reader gets the full set through a cheaper route anyway.
   */
  comments: async (ctx: AdapterContext): Promise<AdapterResult<ScrapedComment>> => {
    const { page, limit } = ctx

    await page
      .locator('text=/View more comments|Previous comments/i')
      .first()
      .click({ timeout: 4_000 })
      .catch(() => {})
    await page.waitForTimeout(2_000)

    const rows = await page
      .evaluate(() => {
        // Comments are articles nested inside the post's own article.
        const all = Array.from(document.querySelectorAll('[role="article"]'))
        return all
          .filter((el) => el.parentElement?.closest('[role="article"]'))
          .map((el) => ({
            text: el.textContent?.trim() ?? '',
            author: el.querySelector('a[role="link"] span')?.textContent?.trim() ?? null,
          }))
      })
      .catch(() => [] as { text: string; author: string | null }[])

    return {
      ok: true,
      items: rows
        .filter((r) => r.text.length > 0)
        .slice(0, limit)
        .map((r) => ({
          text: r.text.slice(0, 800),
          author: r.author,
          // Per-comment reaction counts are not rendered on the list; the app's
          // own reader supplies them. Null, never zero.
          likes: null,
          publishedAt: null,
          isReply: false,
        })),
    }
  },
}
