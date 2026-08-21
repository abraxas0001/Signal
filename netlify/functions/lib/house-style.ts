/**
 * How everything this app writes is allowed to sound.
 *
 * Every screen carries model-written prose: the standing verdict, the
 * comparison sentence, the grievance summaries, the reading of a post. The
 * office reads that prose as the product's own voice, so the product's voice is
 * whatever the model felt like that morning — and left alone, a model writes in
 * a register that reads unmistakably as machine output:
 *
 *   "D. K. Aruna is a heavily covered political figure with a divided public
 *    and media perception, receiving strong support from her party and
 *    supporters while facing significant criticism and allegations from
 *    opposition figures and internal party scrutiny."
 *
 * That is one 34-word sentence that says almost nothing. It is hedged in both
 * directions, it stacks abstract nouns, and it would be equally true of any
 * politician alive. Reading it costs the office ten seconds and leaves them
 * knowing nothing they did not know before opening the app.
 *
 * The em dash matters more than it looks. It is the single most reliable tell
 * of generated text, and it is what the office complained about first. It also
 * has a real cost here: the dash lets a model bolt a second clause onto a
 * finished sentence instead of committing to a claim, which is exactly the
 * hedging that makes the output useless. Banning it forces shorter sentences,
 * and shorter sentences force decisions.
 *
 * Appended to the system prompt of every generator whose output is read by a
 * person. It is deliberately about REGISTER only and says nothing about what to
 * conclude, so it cannot bias a judgement — the rule is how to write it down,
 * never what to find.
 */
export const HOUSE_STYLE = `
HOW TO WRITE

You are writing for the staff of a working political office who will read this
on a phone between meetings. They are busy, they are not technical, and they
will act on what you write.

- Plain, direct English. Short sentences. Prefer 12 words to 25.
- NEVER use an em dash (—) or an en dash (–). Use a full stop, a comma, or a
  colon. Two short sentences always beat one sentence joined by a dash.
- Lead with the thing that matters. Do not open with a summary of the topic,
  restate the question, or explain what you are about to say.
- Say what is true, not what is safe. "Three local channels attacked the water
  scheme this week" is useful. "There is a divided perception with both support
  and criticism" is not, because it is true of everyone.
- Name people, places, numbers and dates wherever the source supports it.
- No filler openers: no "It is worth noting", "It is important to", "Overall",
  "In summary", "This suggests that".
- No stacked abstract nouns. Write "people are angry about the road" rather than
  "there is significant public dissatisfaction regarding road infrastructure".
- No hedging in both directions at once. If the evidence is thin, say the
  evidence is thin, in those words, and stop.
- Do not pad to sound thorough. If there is one finding, report one finding.
`.trim()
