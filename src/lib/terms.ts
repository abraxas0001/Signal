/**
 * Recurring-term extraction over short texts: post titles, comment quotes.
 *
 * Lifted whole from CompareTable so the dashboard's mention board and the
 * comparison board count words by exactly the same rules as the compare
 * screen — one tokenizer, one stopword list, one bar for "recurring".
 */

/**
 * Words that carry no subject: English function words, the Hindi and Telugu
 * ones that show up in mixed-script titles, platform boilerplate ("live",
 * "shorts") and honorifics. Kept deliberately small; a stopword list that
 * grows opinions stops being a stopword list.
 */
export const STOPWORDS = new Set<string>([
  // English function words
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'of', 'to',
  'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'has', 'have',
  'had', 'having', 'will', 'would', 'shall', 'should', 'can', 'could', 'may',
  'might', 'must', 'not', 'no', 'nor', 'this', 'that', 'these', 'those', 'it',
  'its', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their', 'we', 'us',
  'our', 'you', 'your', 'who', 'whom', 'whose', 'which', 'what', 'when',
  'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'only', 'own', 'same', 'very', 'too', 'also',
  'just', 'about', 'into', 'over', 'under', 'again', 'once', 'here', 'there',
  'out', 'up', 'down', 'off', 'after', 'before', 'during', 'between',
  'through', 'via', 'per', 'new', 'now', 'day', 'get', 'let',
  // platform boilerplate that recurs in every channel's titles
  'live', 'video', 'watch', 'full', 'shorts', 'official', 'channel',
  'subscribe', 'promo', 'part', 'episode',
  // honorifics
  'shri', 'sri', 'smt', 'ji', 'garu', 'sir', 'madam', 'mr', 'mrs', 'dr',
  // Hindi function words, romanised
  'ka', 'ki', 'ke', 'ko', 'se', 'me', 'mein', 'par', 'aur', 'hai', 'hain',
  'ho', 'bhi', 'nahi', 'nahin', 'hi', 'ne', 'ye', 'yeh', 'wo', 'woh', 'ek',
  'kya', 'ab', 'jab', 'tab', 'kar', 'raha', 'rahe', 'rahi', 'gaya', 'gaye',
  'liye', 'wala', 'wale', 'wali', 'tha', 'thi', 'hum', 'aap', 'na', 'ya',
  // Hindi function words, Devanagari
  'का', 'की', 'के', 'को', 'से', 'में', 'पर', 'और', 'है', 'हैं', 'हो', 'भी',
  'नहीं', 'तो', 'ही', 'ने', 'ये', 'यह', 'वह', 'वो', 'एक', 'क्या', 'अब', 'जी',
  'हम', 'आप', 'इस', 'उस', 'कर', 'रहा', 'रहे', 'रही', 'गया', 'गए', 'लिए',
  'वाला', 'वाले', 'वाली', 'था', 'थे', 'थी', 'ना', 'या',
  // Telugu function words
  'లో', 'కి', 'కు', 'ఈ', 'ఆ', 'ఒక', 'మరియు', 'తో', 'పై', 'గా', 'కోసం', 'అని',
  'ఇది', 'అది', 'ఉంది', 'ఉన్న', 'నుంచి', 'నుండి', 'వద్ద', 'గారు', 'మీద',
  'కూడా', 'ఇక', 'మన', 'నా', 'మీ', 'వారి', 'తన',
])

/**
 * The top recurring terms across a set of short texts: post titles for the
 * themes row, comment quotes for the praise and criticism keywords.
 *
 * Word counting, nothing more, and the rows that use it say so. Unigrams and
 * bigrams, weighted a little towards earlier texts so a caller passing
 * newest-first gets last month's campaign over last year's, and a term has to
 * appear twice before it counts as recurring at all: a word used once is a
 * sentence, not a theme.
 *
 * Returns null when there are no texts to count, as against an empty list,
 * which means texts exist but nothing repeats.
 */
export function recurringTerms(texts: string[], max = 5): string[] | null {
  if (!texts.length) return null

  const stats = new Map<string, { count: number; score: number; bigram: boolean }>()
  const bump = (term: string, weight: number, bigram: boolean): void => {
    const s = stats.get(term) ?? { count: 0, score: 0, bigram }
    s.count += 1
    s.score += weight
    stats.set(term, s)
  }

  texts.forEach((text, idx) => {
    // The first text weighs 1.0, each later one a little less, floored so a
    // term that genuinely recurs late still beats an early one-off.
    const weight = Math.max(0.5, 1 - idx * 0.05)
    const tokens = text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      // \p{M} is load-bearing: Devanagari and Telugu build words out of
      // combining marks — the virama in आरक्षण is one — and a split that
      // treats marks as separators shreds every conjunct into fragments a
      // reader sees as gibberish ("आरक षण"). Apostrophes stay inside words
      // for the same reason: "hon'ble" is one token, not "hon ble".
      .split(/[^\p{L}\p{M}\p{N}'’]+/u)
      .map((t) => t.replace(/^['’]+|['’]+$/g, ''))
      .filter((t) => {
        if (!t || /^\d+$/.test(t) || STOPWORDS.has(t)) return false
        // Latin needs three letters to mean anything; Indic scripts can pack
        // a whole word into two.
        return /^[a-z0-9]+$/.test(t) ? t.length >= 3 : t.length >= 2
      })
    tokens.forEach((t, i) => {
      bump(t, weight, false)
      const next = tokens[i + 1]
      // Bigrams outrank their halves: "road repair" says more than "road".
      if (next) bump(`${t} ${next}`, weight * 1.6, true)
    })
  })

  const picked: string[] = []
  const candidates = [...stats.entries()]
    .filter(([, s]) => s.count >= 2)
    .sort((a, b) => b[1].score - a[1].score)
  for (const [term, s] of candidates) {
    if (picked.length >= max) break
    // A unigram already inside a chosen bigram would count the same words twice.
    if (!s.bigram && picked.some((p) => p.split(' ').includes(term))) continue
    picked.push(term)
  }
  return picked
}
