# Signal

Paste a link to any public social media post. Get back what it says, what it
means, how it landed, and what to do about it.

Built to replace a 49-column spreadsheet that a team was filling in by hand, one
post at a time.

---

## What it does

Give it a URL. It fetches the post, reads it, and produces a structured report:

**For any post** — a one-line verdict, a summary, the author's intent, the key
claims, notable quotes preserved verbatim, sentiment with a rationale, emotional
register, topics, named people and organisations, engagement figures, estimated
reach, and a credibility assessment.

**For civic posts** — additionally: whether it is a grievance and of what kind,
who it targets, severity, risk to government, narrative category, a recommended
action with a priority, suggested channels, and two to four talking points an
official could say out loud without rewriting them.

Posts in Telugu, Hindi or any other language are kept in their original script,
with an English translation alongside. Quotes are never paraphrased — the source
spreadsheet requires allegations be reproduced exactly, because they may be read
back in an official setting.

---

## Running it

```bash
npm install
cp .env.example .env      # optional — see "Choosing a provider" below
npm run dev               # then open http://localhost:5173
```

Open **5173**, not 8888. `netlify dev` serves the app on 8888 with
`netlify.toml`'s production CSP applied, and that CSP (`script-src 'self'`)
blocks the inline preamble Vite's dev server injects — so 8888 renders blank.
The CSP is correct: the production build contains no inline script at all, which
is why `theme.js` is a separate file. Vite proxies `/api` back to 8888, so 5173
gives you the full interface and a working API on one URL.

`http://localhost:5173/?demo=1` shows a complete worked example without needing
any key.

### Deploying to Netlify

1. Push to a Git repository and connect it in Netlify. Build settings come from
   `netlify.toml` — no configuration needed in the dashboard.
2. Optionally add a model key under **Site configuration → Environment
   variables** — see "Choosing a provider". Without one the app deploys and runs
   in data-only mode.
3. Deploy.

The analysis function is configured for a 60-second timeout, which is the
Netlify maximum for a synchronous function and roughly three times what a normal
analysis takes.

### API keys

**Signal runs with no keys at all.** Every platform in the table below is read
from a public endpoint. One key buys interpretation, not data.

With no key configured the app runs in **data-only mode**, which is a finished
product rather than a degraded one: you get every figure the platform publishes,
each labelled with the route that produced it, the post text and media, the
author, and a plain account of what the platform refused to give. Nothing on
that page is inferred, and the interface says so.

What you do not get without a key is everything that requires reading the post:
sentiment, tone, emotion, the summary, the intent, Telugu→English translation,
topics, named people, grievance type, severity, risk, recommended action and
talking points. That is most of the source spreadsheet's 49 columns. There is no
keyless substitute — a rule-based sentiment scorer on Telugu would be guesswork
presented as measurement, which is the one thing this codebase refuses to do
anywhere else.

### Choosing a provider

Any one of these turns interpretation on. The first key found is the one used.

| Provider | Cost | Trains on your input? | Notes |
|---|---|---|---|
| **Anthropic** `ANTHROPIC_API_KEY` | ~₹4.50/post (Opus), ~₹1 (Haiku) | No | Best Telugu. What the prompts were written against. |
| **Groq** `GROQ_API_KEY` | **Free**, no card | **No** — barred by its services agreement, and inference data is not retained by default | ~30 req/min, ~1,000/day. Best free option here. |
| **Cerebras** `CEREBRAS_API_KEY` | **Free**, no card | Check current terms | ~1M tokens/day. |
| **Gemini** `GEMINI_API_KEY` | **Free**, no card | **Yes on the free tier** — Google may use free-tier inputs and outputs to improve its models | ~1,500 req/day. Good Telugu for a free model. |
| Anything OpenAI-shaped | varies | varies | `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL`. |

**The data question matters more than the price here.** This app sends post text
to whichever provider is configured, and that text is routinely a named
allegation against a named official. A free tier that trains on its inputs is a
decision to make deliberately, not a default to drift into. That is why Groq is
the recommended free option and Gemini's free tier carries a warning.

`LLM_MODEL` overrides the default model for whichever provider is active.

Quality is not equal. The prompts and the 49-field schema were written against
Claude; a 70B open model produces blunter summaries and weaker Telugu
translation, and occasionally returns JSON that does not match the schema — the
app reports that plainly rather than showing a half-filled report.

Run `npm run test:model` after setting a key. It performs one real analysis on a
sample Telugu grievance and tells you whether the key works, what the model
produced, and whether the output looks too thin to trust.

### The two optional extraction keys

Neither is needed. Both are kept only as backstops.

| Key | Worth it? | What it changes |
|---|---|---|
| `YOUTUBE_API_KEY` | No longer needed | Exact like and comment counts now come from the page itself and from YouTube's own comment continuation, so this only fills gaps. |
| `META_APP_TOKEN` | Rarely | Meta's oEmbed returns no engagement data even with a token. The Facebook counts here come from reading the page, not the API. |

### Connecting the office's own accounts

Different from the two keys above: these read data no public request can
reach at all — real comment bodies, exact share counts — for accounts your
office actually owns. Nothing works without an explicit login as that account;
none of it reaches a rival's page.

| Key | What it buys |
|---|---|
| `META_PAGE_TOKEN` / `META_IG_USER_ID` | A Facebook Page/Instagram Business account's own posts, real comments, share counts and reel plays — via the Graph API. Pasted once, manually; see `meta-graph.ts`. |
| `SETTINGS_ACCESS_KEY`, `CONNECTIONS_ENCRYPTION_KEY`, `OAUTH_STATE_SECRET`, `YOUTUBE_OAUTH_CLIENT_ID`/`_SECRET`, `LINKEDIN_OAUTH_CLIENT_ID`/`_SECRET`/`_SCOPE`, `X_OAUTH_CLIENT_ID`/`_SECRET` | The same idea for YouTube, LinkedIn and X, but connected from the app's own Settings screen via OAuth instead of a pasted token. YouTube ships full rich reads; LinkedIn and X ship identity-confirmation only for now — LinkedIn's post access needs a separate manual platform approval, and X's needs a paid API tier. See `.env.example` for the full setup, gotchas, and what each buys. |

---

## What can actually be extracted

Measured against live posts, not assumed. Run `npm run test:extract` to
re-verify — it hits real URLs and prints what came back.

**Nothing below needs an API key.** Every figure in this table comes from a
public endpoint, an embed surface, or the page itself.

| Platform | Text | Author | Followers | Likes | Comments | Shares | Views |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **Bluesky** | yes | yes | yes | yes | yes | yes | none [a] |
| **Mastodon** | yes | yes | yes | yes | yes | yes | none [a] |
| **X / Twitter** | yes | yes | yes | yes | yes | yes | yes [b] |
| **Threads** | yes | yes | yes | yes | yes | yes | none [a] |
| **YouTube** | yes | yes | approx [c] | yes | yes | — | yes |
| **TikTok** | yes | yes | yes | yes [d] | yes [d] | yes [d] | yes [d] |
| **Facebook** | yes | yes | Pages [e] | yes [f] | yes | posts [g] | video [h] |
| **Instagram** | yes | yes | most [i] | yes | yes | — | — |
| **LinkedIn** | yes | yes | yes | yes | yes | — | — |
| **Pinterest** | yes | yes | yes | yes [j] | yes | yes [j] | — |
| **Snapchat** | caption [k] | yes | — | — | yes | — | yes |
| **Reddit** | title only | yes | — | score [l] | yes | — | — |
| **Telegram** | yes | yes | — | — | — | — | yes |
| **News / blogs** | full article | yes | n/a | n/a | n/a | n/a | n/a |
| **E-papers** | image only [m] | — | — | — | — | — | — |

**[a]** These platforms have no view counter at all. Not withheld from us: not
counted, including for the account owner. "Not measured" is a different claim
from "we could not read it", and the report makes that distinction.
**[b]** X only reports views on posts from 2023 onward. Older posts genuinely
have none — the app shows "not available", not zero.
**[c]** YouTube rounds subscriber counts to three significant figures for
everyone, including its own API. Likes and comments are exact — see below.
**[d]** TikTok rounds every count above ten thousand before publishing it. The
app keeps the figure and marks it approximate rather than implying precision.
**[e]** Post pages carry no follower count in any form. It comes from Facebook's
own embeddable Page plugin, which returns the exact comma-grouped figure rather
than the "30K" the profile page renders. Personal profiles with no Page behind
them have no such number, and degrade to "unavailable" rather than to a guess.
**[f]** Facebook reports *reactions* (all emoji summed), not likes. The app
labels it correctly rather than quietly filing it under "likes". Where Facebook
publishes both an exact integer and its own rounded string, the app reports the
integer and keeps the rounding as a display hint — 1,751, not "1.7K".
**[g]** Reels have no share counter. Not renamed, not withheld — a full key
census across reel pages found no share key of any kind, while the same fetch of
a `/posts/` link returns one. The report says so explicitly.
**[h]** Video and reel posts report plays as views; unique viewers are a
separate figure and are kept separate. Text posts have no view counter.
**[i]** The profile endpoint fails for a minority of accounts — a Meta-side bug,
not rate limiting.
**[j]** Pinterest counts saves and repins, not likes. Reactions exist but are
barely used, so a pin with 4,844 repins can honestly show 4 reactions.
**[k]** Most Spotlight snaps carry no written caption — the message is in the
video. The app says so and analyses the comments instead of implying the fetch
failed.
**[l]** Reddit's score is upvotes minus downvotes, so it can legitimately be
negative.
**[m]** E-paper pages carry no server-side text at all. The app detects this,
says so, and offers the screenshot route.

**Bluesky and Mastodon are the most complete rows** because they are the two
built on open protocols: `public.api.bsky.app` and any instance's
`/api/v1/statuses` are documented, unauthenticated, and meant to be called.
Neither adapter scrapes anything or needs a fallback chain. Both return quote
counts, which only X otherwise does.

**Every other platform took a specific trick**, and each one fails as HTTP 200
when it breaks — which is why `npm run test:extract` validates by content and
never by status code:

| Platform | What actually works |
|---|---|
| **YouTube** likes | The like button's screen-reader label says "like this video along with 19,332,347 other people" while the page displays "19M". Same HTML we already fetch, zero extra requests. |
| **YouTube** comments | Comments load lazily, so the count is in neither the page nor a plain InnerTube call. The continuation token is a pure function of the video id, so the app builds it rather than scraping it. |
| **YouTube** throttled | Google fingerprints the HTTP *client*, not just the IP. Measured in the same second from one address with identical headers: curl got the watch page, our client was redirected to `google.com/sorry/` with a 429. `/youtubei/v1/next` is not subject to that filter and carries the same exact figures, so it is the fallback — not oEmbed, which would drop the report to a bare title. |
| **Threads** | The post JSON is served only to a search-crawler User-Agent. Chrome gets HTTP 200 with the block simply absent. |
| **TikTok** | `/embed/v2/` survives the WAF that blocks the main video page after ~10 requests from one IP. The app never touches the video page. |
| **Reddit** | Every form of the `.json` API is 403, including from residential IPs. `embed.reddit.com` still serves the score and comment count. |
| **Pinterest** | One header — `X-Pinterest-PWS-Handler` — is the entire gate on the full pin object. Without it the same URL is a 403. |
| **Facebook** reels | A `/share/v/` link redirects to `/reel/<VIDEO_ID>/`, but the engagement payload is keyed by a *different* story id that appears only in `subscription_target_id`. Anchoring on the URL's id finds nothing, on a page that carries everything. |
| **Snapchat** | Spotlight pages are server-rendered with the full metadata, including every comment, in `__NEXT_DATA__`. |

Three of these read structures the platform never promised to keep. They are the
first things that will break, and `test:extract` exists to tell you the day they
do.

**Verified from this machine** on 2026-08-14: every row above except TikTok,
which is null-routed by Indian ISPs and could not be reached locally. Its
adapter is built to a spec validated from two independent datacentre IPs and is
the one thing on this list to re-check on the first deploy.

**Things that are genuinely impossible**, so the app never pretends otherwise:
YouTube share counts and exact subscriber counts (no unabbreviated variant is
embedded anywhere), YouTube transcripts (blocked from datacentre IPs), Reddit
post bodies and subscriber counts, Facebook share counts on reels and follower
counts for personal profiles with no Page, Snapchat like counts, view counts on
Bluesky, Mastodon and Threads — which do not exist for anyone — and app-only
links such as `way2.co` shortlinks, which resolve to a Play Store listing.

Each of these is reported as its own case. "This platform does not count that"
and "we could not read it" are different sentences in the interface, because
they call for different things from the user.

### When a fetch comes back thin

Every number carries its origin — `exact`, `read`, `you`, `estimate`, or `n/a` —
so a measured like count and an inferred reach never look alike. If a platform
withholds something, the report says which platform withheld what and why, then
offers three ways forward, cheapest first: type the numbers in, paste the post
text, or upload a screenshot for the model to read.

The guard that matters most is negative: if a page returns a cookie banner, a
login wall, or an app-store listing instead of a post, the app refuses it rather
than confidently analysing the wrong text. Two links in the original dataset do
exactly this.

---

## Scraping and terms of service

Read this before deploying commercially. The methods above are not equally
defensible, and the difference matters.

**Your own account, via OAuth.** Connecting a YouTube, LinkedIn or X account
from Settings, or pasting a Facebook/Instagram Page token, is stronger than
"sanctioned" below — it is explicit, revocable, platform-issued consent for
one specific account, not just a documented public endpoint. It also cannot
be made to read anyone else's account: a token only ever authorises the
identity that granted it. See `.env.example` and `meta-graph.ts`.

**Sanctioned.** Bluesky's AT Protocol API and Mastodon's REST API are public,
documented, and intended for exactly this. Pinterest's widget endpoint and the
various oEmbed endpoints are published surfaces meant to be called by third
parties. Nothing about these is a grey area.

**Reading a public page.** YouTube, Snapchat Spotlight and Reddit's embed host
are read as any visitor reads them, with no identity claimed that we do not
have. This is ordinary retrieval of public content.

**Presenting a crawler identity.** Facebook, Instagram and Threads serve their
data to search-crawler user-agents but not to ordinary browsers, and the
adapters present one. This is the most legally exposed thing in the codebase:
all three platforms' `robots.txt` prohibit automated collection, and the app is
claiming to be Googlebot when it is not.

That is a defensible position for an internal tool analysing posts you are
authorised to monitor. It is a decision someone should make deliberately for a
commercial product, not inherit by accident.

Set `ALLOW_CRAWLER_UA=false` to switch it off without a redeploy. The app keeps
working: it still returns the caption, author, date and thumbnail from the
standard path, and asks the user for the counts. For a Facebook Page your
organisation actually administers, the official Graph API insights endpoints are
the sanctioned route and return far more than any of this.

**Using an internal endpoint.** Pinterest's `PinResource` and YouTube's
InnerTube continuation are private APIs behind their own front ends. They are
unauthenticated and stable in practice, but they carry no promise at all — and
unlike the crawler methods, they will break silently rather than legally.

---

## How it is put together

```
shared/          taxonomy + the Report contract — the single source of truth,
                 imported by both the server and the interface
netlify/
  functions/
    analyse.mts  POST /api/analyse — streams the pipeline as Server-Sent Events
    lib/
      platform   URL parsing, plus the SSRF boundary (the URL is user input)
      fetcher    charset-aware fetching; regional news still serves windows-1252
      metadata   OpenGraph, JSON-LD, Readability, and the junk-content guard
      extract/   one adapter per platform, each with its own fallback chain
                   youtube · twitter · meta (fb+ig) · threads
                   fediverse (bluesky+mastodon) · visual (pinterest+snapchat)
                   web (linkedin, telegram, tiktok, reddit, news, blogs)
      schema     the JSON Schema handed to the model, generated from taxonomy
      analyse    the Claude call
src/             React interface
scripts/         extraction and endpoint tests that hit real URLs
```

**Why SSE.** Analysis takes 15–40 seconds. A silent request that long looks
broken, so the server emits an event per stage and the interface narrates it.
Stage labels are driven by real pipeline events — including which section of the
JSON the model has reached — never by a timer. Faked progress is noticeable, and
once a user catches it the rest of the report reads as theatre too.

**Why the taxonomy is one file.** The controlled vocabularies from the
spreadsheet's `METADATA` sheet generate the model's JSON schema *and* drive the
interface's labels. They cannot drift apart.

**Why history is local.** Reports name real officials and real allegations.
Keeping them in `localStorage` means a lost phone is the worst case, not a
breached database — and the product needs no accounts and no login.

---

## Design notes

Dark-native, one violet accent, aurora light behind the hero. Built mobile-first
for mid-range Android on 4G: only `transform` and `opacity` are animated, the
aurora and glass layers are switched off on low-end devices via
`navigator.deviceMemory` and `hardwareConcurrency`, and `prefers-reduced-motion`
reduces motion rather than deleting feedback.

The sentiment scale is teal-to-red, not the obvious green-to-red. Green and red
separate by only ΔE 6.5 under deuteranopia — indistinguishable for roughly one in
twelve men, on the most important reading in the product. Teal-to-red measures
ΔE 13.4 in light and 10.7 in dark. Position on the track and an always-visible
text label carry the value regardless; colour is only reinforcement.

Fonts are the system stack — no CDN, because a render-blocking third-party
round-trip is not affordable on Indian 4G. To use General Sans or Inter, self-host
the woff2 files and change `--font-display` / `--font-ui` in `src/index.css`.

---

## Security

**The URL is the entire user input**, so `netlify/functions/lib/ssrf.ts` is the
only thing between a pasted link and the function's network position. It:

- classifies literal addresses numerically, not by pattern — including
  bracketed IPv6 (`[::1]`), IPv4-mapped (`::ffff:127.0.0.1`) and NAT64 forms,
  all of which defeat string comparison;
- resolves every hostname and rejects it if *any* answer is private, which is
  what stops `localtest.me` and `169.254.169.254.nip.io`;
- pins the connection to the address it validated, closing the DNS-rebinding
  window between check and connect;
- re-validates every redirect hop rather than letting the runtime follow a
  public URL to a private one.

`npm run test:ssrf` covers 47 cases, including the bypasses that defeated the
first implementation.

Other controls: the analysis endpoint is rate-limited to 20 requests per two
minutes per IP (enforced by Netlify *before* the function runs, so a blocked
request costs nothing), pasted text and screenshots are size-capped, and the CSP
is `script-src 'self'` with no inline scripts.

Not built yet, and worth knowing: there is no per-day spend ceiling. The rate
limit bounds the burst, not the month. If this goes somewhere public, add a
counter in Netlify Blobs and a daily cap.

## Testing

```bash
npm test               # typecheck + ssrf + schema + contrast + extraction
npm run test:sheet     # every link in the client's own workbook  ← the acceptance test
npm run test:model     # is the configured model working? one real analysis
npm run test:ssrf      # 47 SSRF cases against the URL boundary
npm run test:schema    # validates the JSON Schema the model is held to
npm run test:contrast  # WCAG AA for every colour pair, both themes
npm run test:extract   # runs every adapter against real, live posts
npm run test:endpoint  # calls the SSE endpoint and prints the event stream
```

**`test:sheet` is the one that answers "does this work for us".** It runs all 28
links from `Eluru_Social_Listening.xlsx`, prints a field-by-field coverage
matrix, and compares every figure against what the team recorded by hand in
columns AD–AG. Note 28, not 24: three cells hold multiple URLs stacked in one
cell, which anything reading one-link-per-row silently drops.

Current state — 25 of 28 return engagement data:

| | Facebook (16) | YouTube (7) | X (3) |
|---|:--:|:--:|:--:|
| author · date · text · likes · comments | 15 | 7 | 3 |
| followers | 15 | 7 | 3 |
| shares | 6 (posts only) | none exist | 3 |
| views | 9 (video only) | 7 | 3 |

The three that return nothing are honest failures, each reported as its own
distinct case rather than as a generic error: an e-paper page that is a scanned
image, a `way2.co` link that resolves to a Play Store listing, and one Facebook
video that has genuinely been deleted.

The comparison against the recorded values is the more interesting output. **62
of the hand-recorded figures have drifted 10% or more from the live value** —
one post recorded at 124 likes now has 651. That drift is the argument for the
product, so the test prints it rather than hiding it.

`test:extract` is the one that matters over time. These platforms change their
markup on their own schedule; run it on a schedule so you learn a method has
died before a user does.

`test:contrast` and `test:schema` read from `src/index.css` and the taxonomy
respectively, so neither can drift from the source it checks.
