# The scraper

A local service that finds post links on Facebook, Instagram, LinkedIn and X,
and hands them to Signal through the provider slot the app already has.

It runs **on your machine**, in a real browser, carrying **your own logged-in
session**. It is not deployed and cannot be: Netlify functions have no browser.

---

## Read this before you run it

**The four platforms publish nothing to a signed-out server.** That is measured,
not assumed:

| Platform  | What a plain server request returns                                    |
| --------- | ---------------------------------------------------------------------- |
| Facebook  | 4.9 MB of HTML containing **0 post permalinks**, under 4 crawler UAs    |
| Instagram | **HTTP 429** from a datacentre IP, even after a 90-second wait          |
| X         | **HTTP 503**, even when identifying as Googlebot                       |
| LinkedIn  | An authwall served as **HTTP 200** — it looks like a successful read    |

A browser with a session is the only thing that gets past that. Which means:

- **This is against all four platforms' terms of service.** The account doing
  the scraping can be rate-limited, checkpointed or banned. Use an account you
  can afford to lose, not the office's main one.
- **It will rot.** Instagram rotates internal identifiers every 2–4 weeks.
  Expect to fix adapters. `npm run scraper:test` exists to tell you which one.
- **Pacing is not optional.** The service waits 5–12 seconds between page loads
  depending on platform and runs one job at a time. Removing that is the
  fastest way to lose the session.

If any of that is unacceptable, the honest alternative is the paid post-list
tier of a licensed provider (~$45/mo), which speaks the same contract this
service does — see the action-plan workbook.

---

## How it fits

Signal's `netlify/functions/lib/social-source.ts` already defines a
vendor-neutral provider slot. This service implements that exact contract, so
**nothing in the app changes**:

```
Dashboard "Sync now"
   → /api/sync-profiles
       → postsForHandle()                    (social-source.ts)
           → POST http://127.0.0.1:8787/provider   ← this service
               → Playwright, your session, the profile page
           ← { posts: [ { url, id, title, likes, ... } ] }
       → stored in Firestore
   → each URL then goes through /api/analyse, the proven per-post reader
```

The division of labour is deliberate: **this service finds URLs; the app reads
them.** The app's per-post extractor already pulls exact counts, full comment
bodies, translation and sentiment from a supplied link. Duplicating that here
would mean twenty extra navigations per profile for data we already get.

---

## Running it

```bash
npm i                       # playwright is a devDependency
npx playwright install chromium

npm run scraper:login       # opens a real window — sign in to each platform, once
npm run scraper             # starts the provider on 127.0.0.1:8787
```

Then point the app at it, in `.env`:

```
SOCIAL_PROVIDER_URL=http://127.0.0.1:8787/provider
SOCIAL_PROVIDER_KEY=any-local-secret
```

Restart `npm run dev`, open the dashboard, press **Sync now**.

The session lives in `.scraper-profile/` — real cookies for real accounts. It
is gitignored. Keep it that way.

---

## When a platform stops working

```bash
npm run scraper:test -- x narendramodi
npm run scraper:test -- facebook DKAruna.TG --headed    # watch it happen
```

The output separates the three states that matter, because confusing them is
how a broken scraper gets mistaken for a quiet rival:

- `login wall: YES` → run `npm run scraper:login`
- `COULD NOT READ` → the adapter rotted; the selectors need updating
- `READ OK — 0 posts` → the profile genuinely has nothing

---

## What each adapter reads

`—` means **not measured**. It is never rendered as zero, anywhere, on purpose:
an unread count and a genuine zero must not look alike.

| Platform  | Post URLs | Title | Date | Likes | Comments | Shares | Views | Comment bodies |
| --------- | --------- | ----- | ---- | ----- | -------- | ------ | ----- | -------------- |
| X         | ✅        | ✅    | ✅   | ✅    | ✅       | ✅     | ✅    | ✅             |
| Facebook  | ✅        | ✅    | ~    | ~     | ~        | ~      | —     | ~              |
| LinkedIn  | ✅        | ✅    | —    | ~     | ~        | ~      | —     | — (app reads)  |
| Instagram | ✅        | ✅    | —    | —     | —        | —      | —     | — (app reads)  |

`~` = present when the page happens to render it, null otherwise.

X is the most complete because it still ships stable `data-testid` attributes.
Instagram is the thinnest by design: its grid carries no counts, and hovering
tiles to harvest them is both unreliable and the most bot-like thing this
service could do. In every gap, the app's own per-post reader fills in — that
is what the `Analyse` button on each post card does.

---

## Files

| File                     | What it is                                             |
| ------------------------ | ------------------------------------------------------ |
| `types.ts`               | The contract: `PlatformAdapter`, `ScrapedPost`, parsers |
| `browser.ts`             | Persistent session, per-platform pacing, scrolling      |
| `server.ts`              | The HTTP provider, cache, one-job-at-a-time queue       |
| `login.ts`               | Sign in once, by hand, in a visible window              |
| `test.ts`                | Diagnose one platform end to end                        |
| `adapters/<platform>.ts` | One file per platform, so they rot independently        |
