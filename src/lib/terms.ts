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
  'కూడా', 'ఇక', 'మన', 'నా', 'మీ', 'వారి', 'తన', 'మా', 'మేము', 'నేను', 'మీరు',
  'వారు', 'అతను', 'ఆమె', 'నీ', 'నాకు', 'మాకు',
  /*
   * Telugu verbs and quantifiers the news scan surfaced as "keywords".
   *
   * The first real scan of a Telugu news week ranked చేశారు ("did"), ఆయన
   * ("he"), and మాజీ ("former") as what the coverage is about, because the
   * list above held Telugu PRONOUNS but not the everyday verbs and role
   * words every third headline uses. Same rule as the English half: a word
   * that could appear in a story about anything carries no subject.
   */
  'చేశారు', 'చేసిన', 'చేస్తున్న', 'చేయాలని', 'అన్నారు', 'తెలిపారు',
  'పేర్కొన్నారు', 'వెల్లడించారు', 'జరిగిన', 'జరిగింది', 'పలువురు', 'పలు',
  'మాజీ', 'నేడు', 'రేపు', 'నిన్న', 'ఇవాళ', 'మంది', 'వేల', 'లక్షల', 'కోట్ల',
  'ఆయన', 'ఈయన', 'వీరు', 'ఎవరు', 'అందరూ',
  'రూపాయల', 'శాతం',
  /*
   * Month names, in every spelling the mastheads use. "Aug" ranked as a
   * keyword with 28 mentions, which is a statement about how datelines are
   * written, not about what anyone said.
   */
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr',
  'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'జనవరి', 'ఫిబ్రవరి', 'మార్చి', 'ఏప్రిల్', 'మే', 'జూన్', 'జూలై', 'ఆగస్టు',
  'సెప్టెంబర్', 'అక్టోబర్', 'నవంబర్', 'డిసెంబర్',
  'जनवरी', 'फरवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त',
  'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर',
])

/**
 * Words that are real words but are never a TOPIC.
 *
 * Kept apart from STOPWORDS on purpose. A stopword carries no subject at all;
 * these carry plenty — a slogan, a greeting, a kinship term, a bare verdict —
 * they simply are not what an office means when it asks "what are people
 * talking about". The desk reported the symptom exactly: "jai, aruna aka
 * these are not topics".
 *
 * Callers that want SUBJECTS pass this; callers that want to know what people
 * are literally saying, slogans included, do not. That keeps the base list
 * lean, which is the rule this module was written under.
 */
export const NON_TOPIC = new Set<string>([
  // slogans and chants
  'jai', 'jay', 'jaihind', 'zindabad', 'zindabaad', 'amaram', 'vandanam',
  'vandanalu', 'namaste', 'namaskar', 'namaskaram', 'pranam', 'pranams',
  'jaibheem', 'jaibhim', 'జై', 'జయ', 'జిందాబాద్', 'नमस्ते', 'जय',
  // kinship and address, which Indian comment threads are built out of
  'anna', 'akka', 'aka', 'akkaya', 'annaya', 'bhai', 'bhaiya', 'bhaiyya',
  'didi', 'amma', 'nanna', 'baba', 'uncle', 'aunty', 'sodara', 'bro', 'bhau',
  'అన్న', 'అక్క', 'అమ్మ', 'నాన్న', 'భాయ్',
  // bare verdicts: a mood, not a subject
  'good', 'great', 'nice', 'best', 'super', 'superb', 'excellent', 'awesome',
  'bad', 'worst', 'poor', 'wrong', 'true', 'false', 'right', 'correct',
  'please', 'thanks', 'thank', 'thankyou', 'welcome', 'congrats',
  'congratulations', 'wish', 'wishes', 'happy', 'sorry', 'ok', 'okay', 'yes',
  'love', 'like', 'support', 'supporting', 'proud', 'god', 'bless',
  'బాగుంది', 'మంచి', 'చాలా', 'అవును', 'కాదు',
  // filler that survives the function-word list
  'sab', 'sabhi', 'log', 'logo', 'logon', 'kuch', 'koi', 'bahut', 'bohot',
  'matlab', 'yaar', 'arey', 'are', 'haan', 'han', 'nahi', 'phir', 'lekin',
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
export function recurringTerms(
  texts: string[],
  max = 5,
  /**
   * Words to drop on top of the shared list, decided by the caller.
   *
   * The desk owner's own name is the case this exists for. "aruna" recurs in
   * almost every comment written to D. K. Aruna, and a praise list that leads
   * with the name of the person being praised has told the office nothing.
   */
  extraStop?: Set<string>,
): string[] | null {
  if (!texts.length) return null

  /**
   * Documents, not repeats.
   *
   * The rule above says "a word used once is a sentence, not a theme", but the
   * counter used to increment on every OCCURRENCE, so one comment shouting
   * "jai jai jai" made "jai" a theme on its own. Counting distinct texts is
   * what the sentence always meant, and it is what stops a single loud
   * commenter setting the desk's agenda.
   */
  const stats = new Map<string, { docs: Set<number>; score: number; bigram: boolean }>()
  const bump = (term: string, weight: number, bigram: boolean, doc: number): void => {
    const s = stats.get(term) ?? { docs: new Set<number>(), score: 0, bigram }
    s.docs.add(doc)
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
        if (!t || /^\d+$/.test(t) || STOPWORDS.has(t) || extraStop?.has(t)) return false
        // Latin needs three letters to mean anything; Indic scripts can pack
        // a whole word into two.
        return /^[a-z0-9]+$/.test(t) ? t.length >= 3 : t.length >= 2
      })
    tokens.forEach((t, i) => {
      bump(t, weight, false, idx)
      const next = tokens[i + 1]
      // Bigrams outrank their halves: "road repair" says more than "road".
      if (next) bump(`${t} ${next}`, weight * 1.6, true, idx)
    })
  })

  const picked: string[] = []
  const candidates = [...stats.entries()]
    .filter(([, s]) => s.docs.size >= 2)
    .sort((a, b) => b[1].score - a[1].score)
  const spoken = new Set<string>()
  for (const [term, s] of candidates) {
    if (picked.length >= max) break
    // A unigram already inside a chosen bigram would count the same words twice.
    if (!s.bigram && picked.some((p) => p.split(' ').includes(term))) continue
    /*
     * Nor may two bigrams share a word. One Telugu sentence was filling the
     * whole list with its own sliding window — "జడచర్ల పట్టణానికి", then
     * "పట్టణానికి నేడు", then "నేడు మరొక" — three rows that are one phrase
     * read three times. A term earns its row only if it introduces a word the
     * list has not already spent.
     */
    const words = term.split(' ')
    if (s.bigram && words.some((w) => spoken.has(w))) continue
    for (const w of words) spoken.add(w)
    picked.push(term)
  }
  return picked
}

/**
 * How many of these texts actually contain this term.
 *
 * Counted over the SAME token stream `recurringTerms` builds, not over the
 * raw string. A bigram is formed from two adjacent tokens after punctuation
 * has been stripped, so "नेतृत्व, उत्तर" yields the term "नेतृत्व उत्तर" —
 * which a raw substring test then fails to find in its own source text, and
 * the share renders as 0% beside a word that plainly recurs.
 */
export function termCount(texts: string[], term: string): number {
  const needle = ` ${term.toLowerCase()} `
  return texts.filter((text) => {
    const stream = text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .split(/[^\p{L}\p{M}\p{N}'’]+/u)
      .map((t) => t.replace(/^['’]+|['’]+$/g, ''))
      .filter(Boolean)
      .join(' ')
    return ` ${stream} `.includes(needle)
  }).length
}
