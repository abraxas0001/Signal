/**
 * The sync, end to end, against the real Firestore.
 *
 * Everything else about this feature can be true while it still does not work:
 * the types can check, the endpoints can return 200, and the round trip can
 * still be broken by a document id with a slash in it, a `update()` on a
 * document that does not exist yet, or an index Firestore wants and nobody
 * created. None of those show up until something actually writes and reads
 * back, so this writes and reads back.
 *
 * It uses YouTube and Bluesky deliberately. Both publish a post list to anyone,
 * so a failure here is OUR bug rather than a platform declining to be read —
 * which is exactly what a test of the storage path should isolate. The gated
 * platforms are tested by `test-extract`, where being refused is the expected
 * result rather than a failure.
 *
 * Skips cleanly with no Firebase credentials, because most contributors will
 * not have them and a test that fails for everyone without a secret is a test
 * everyone learns to ignore.
 */
import { readFileSync } from 'node:fs'
import { profileDocId, readHandle } from '../netlify/functions/lib/handles'

/**
 * `.env` by hand, because nothing else in this repo needs a loader.
 *
 * `netlify dev` injects these in the real runtime and the functions never read
 * a file. Adding dotenv as a dependency so one script can run would put a
 * package in production's tree for a test's convenience.
 */
function loadEnv(): void {
  let raw: string
  try {
    raw = readFileSync('.env', 'utf8')
  } catch {
    return
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=([\s\S]*)$/)
    if (!match) continue
    const key = match[1]!
    let value = match[2]!
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnv()

const g = (s: string) => `\x1b[32m${s}\x1b[0m`
const r = (s: string) => `\x1b[31m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
let pass = 0
let fail = 0
const chk = (label: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++
    console.log(`  ${g('✓')} ${label} ${dim(detail)}`)
  } else {
    fail++
    console.log(`  ${r('✗')} ${label} ${detail}`)
  }
}

async function main(): Promise<void> {
  // Imported after loadEnv, because firebase.ts reads the environment when it
  // first initialises and caches the result — importing it at the top of the
  // file would cache "not configured" before the .env was read.
  const { db, firestoreConfigured, firestorePing } = await import(
    '../netlify/functions/lib/firebase'
  )

  console.log('\n\x1b[1mFirebase\x1b[0m\n')

  if (!firestoreConfigured()) {
    console.log(
      `  ${dim('skipped — no Firebase credentials in the environment.')}\n` +
        `  ${dim('Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY to run this.')}\n`,
    )
    return
  }

  const ping = await firestorePing()
  chk('Firestore answers a read', ping.ok, ping.note)
  if (!ping.ok) {
    console.log(`\n  ${r('Cannot continue without a reachable Firestore.')}\n`)
    process.exitCode = 1
    return
  }

  const {
    batchTrackCompetitors,
    getCompetitorPosts,
    getFollowerHistory,
    getTrackedProfiles,
    profileIdFor,
    registerProfiles,
    removeCompetitorProfile,
  } = await import('../netlify/functions/lib/competitor-tracker')

  console.log('\n\x1b[1mDocument ids\x1b[0m\n')

  // The bug this guards is silent and total: an id containing a slash is not
  // rejected by Firestore, it is interpreted as a path, so the write lands in a
  // collection nobody reads and every subsequent read finds nothing.
  const xId = profileIdFor('Twitter/X', 'someone')
  chk('a platform with a slash produces a flat id', !xId.includes('/'), `→ ${xId}`)
  chk(
    'the tracker and the reader agree on the id',
    xId === profileDocId({ platform: 'Twitter/X', handle: 'someone' }),
  )
  chk(
    'the id survives an @ and mixed case',
    profileIdFor('YouTube', '@BBCNews') === profileIdFor('YouTube', 'bbcnews'),
    `→ ${profileIdFor('YouTube', '@BBCNews')}`,
  )

  /** Real, public, and stable enough to still exist next year. */
  const FIXTURES = [
    { platform: 'YouTube' as const, handle: '@BBCNews', name: 'BBC News (test fixture)' },
    { platform: 'Bluesky' as const, handle: 'bsky.app', name: 'Bluesky (test fixture)' },
  ]
  const ids = FIXTURES.map((f) => profileIdFor(f.platform, f.handle))

  try {
    console.log('\n\x1b[1mRegister\x1b[0m\n')

    const registered = await registerProfiles(
      FIXTURES.map((f) => ({ ...f, category: 'competitor' as const })),
    )
    chk('registerProfiles returns one row per account', registered.length === FIXTURES.length)

    const tracked = await getTrackedProfiles()
    const found = ids.filter((id) => tracked.some((p) => p.id === id))
    chk('both accounts come back from Firestore', found.length === FIXTURES.length, `${found.length}/${FIXTURES.length}`)

    // The first sync writes the profile document into existence. `update()`
    // would throw here, which is why storeSync uses set-with-merge — this is
    // the assertion that keeps it that way.
    console.log('\n\x1b[1mSync pass\x1b[0m\n')

    const started = Date.now()
    const progress = await batchTrackCompetitors(registered, { budgetMs: 40_000 })
    chk('the pass reports whether it finished', typeof progress.done === 'boolean', `done=${progress.done}`)
    chk('every account was attempted', progress.results.length === FIXTURES.length, `${progress.results.length} attempted`)
    chk('the pass stayed inside its budget', Date.now() - started < 55_000, `${Math.round((Date.now() - started) / 1000)}s`)

    for (const result of progress.results) {
      const detail = result.error
        ? r(result.error)
        : `${result.posts.length} posts, ${result.followers ?? '—'} followers`
      chk(`${result.profile.platform} ${result.profile.handle} read without throwing`, !result.error, detail)
    }

    // Both fixtures publish a post list to anyone, so zero posts here is a real
    // regression in the reader rather than a platform refusing us.
    const withPosts = progress.results.filter((x) => x.posts.length > 0)
    chk('at least one public account yielded posts', withPosts.length > 0, `${withPosts.length}/${FIXTURES.length}`)

    console.log('\n\x1b[1mRead back\x1b[0m\n')

    for (const [i, fixture] of FIXTURES.entries()) {
      const id = ids[i]!
      const stored = await getCompetitorPosts(id, { limit: 30 })
      const expected = progress.results.find((x) => x.profile.id === id)?.posts.length ?? 0
      if (expected === 0) {
        console.log(`  ${dim(`- ${fixture.platform} stored nothing to read back; skipping`)}`)
        continue
      }
      chk(`${fixture.platform}: stored posts read back`, stored.length > 0, `${stored.length} rows`)
      chk(
        `${fixture.platform}: a post kept its url`,
        stored.every((p) => typeof p.url === 'string' && p.url.startsWith('http')),
      )

      // The whole point of the feature: readHandle must now prefer what the
      // sync stored and label it as such, rather than reading live again.
      const summary = await readHandle({ platform: fixture.platform, handle: fixture.handle })
      chk(
        `${fixture.platform}: readHandle returns posts`,
        summary.posts.length > 0,
        `route=${summary.listing.route}`,
      )

      const history = await getFollowerHistory(id, 30)
      chk(`${fixture.platform}: a follower snapshot was written`, history.length > 0, `${history.length} day(s)`)
    }

    console.log('\n\x1b[1mThe stored route, on a gated platform\x1b[0m\n')

    /**
     * The case the whole feature exists for, and the one the passes above do
     * NOT cover.
     *
     * YouTube and Bluesky publish a post list live, so `readHandle` returns on
     * the public route before it ever looks at what was stored — which is the
     * correct precedence and also means those fixtures prove nothing about the
     * stored path. Facebook is the opposite: the live read yields a follower
     * count and no posts, so the stored rows are the only way a post list ever
     * reaches the dashboard. This writes one directly and checks it comes back
     * labelled as stored rather than passed off as a live read.
     */
    const gated = { platform: 'Facebook' as const, handle: 'signal-test-fixture' }
    const gatedId = profileIdFor(gated.platform, gated.handle)
    ids.push(gatedId)

    const store = db()
    if (!store) {
      chk('a store is available for the gated fixture', false)
    } else {
      const syncedAt = new Date().toISOString()
      await registerProfiles([{ ...gated, name: 'Gated fixture', category: 'competitor' }])
      await store.collection('competitors').doc(gatedId).set({ lastTrackedAt: syncedAt }, { merge: true })
      await store
        .collection('competitors')
        .doc(gatedId)
        .collection('posts')
        .doc('fixture')
        .set({
          url: 'https://www.facebook.com/signal-test-fixture/posts/1',
          postId: '1',
          title: 'A stored post',
          publishedAt: syncedAt,
          // Zero, not null, and deliberately: `|| null` would report a post
          // that genuinely got no likes as "we could not tell", which is the
          // one thing this codebase is careful never to say when it can tell.
          engagement: { likes: 0, comments: 4, shares: null, views: null },
          fetchedAt: syncedAt,
        })

      const summary = await readHandle(gated, { licensed: false })
      chk('a gated account returns the stored posts', summary.posts.length === 1, `${summary.posts.length} post(s)`)
      chk('and says they came from the sync', summary.listing.route === 'stored', `route=${summary.listing.route}`)
      chk('and says when', summary.lastSyncedAt === syncedAt, String(summary.lastSyncedAt))
      chk(
        'a real zero survives as zero, not as unknown',
        summary.posts[0]?.likes === 0,
        `likes=${JSON.stringify(summary.posts[0]?.likes)}`,
      )
      chk('a missing metric stays null', summary.posts[0]?.shares === null)
      chk(
        'the note names the sync rather than claiming a live read',
        /sync/i.test(summary.listing.note),
        summary.listing.note,
      )
    }

    console.log('\n\x1b[1mIdempotence\x1b[0m\n')

    // A second sync must update the same rows, not append a duplicate set.
    const before = await getCompetitorPosts(ids[0]!, { limit: 100 })
    if (before.length === 0) {
      console.log(`  ${dim('- nothing stored for the first fixture; skipping')}`)
    } else {
      const first = registered.find((p) => p.id === ids[0])!
      await batchTrackCompetitors([first], { budgetMs: 30_000 })
      const after = await getCompetitorPosts(ids[0]!, { limit: 200 })
      chk(
        're-syncing does not duplicate posts',
        after.length <= before.length + 3,
        `${before.length} → ${after.length}`,
      )
    }
  } finally {
    console.log('\n\x1b[1mCleanup\x1b[0m\n')
    for (const id of ids) {
      try {
        await removeCompetitorProfile(id)
        // Deleting a document does not delete its subcollections, so this also
        // asserts that removeCompetitorProfile walks them.
        const leftover = await getCompetitorPosts(id, { limit: 5 })
        chk(`${id} removed, posts and all`, leftover.length === 0, `${leftover.length} left`)
      } catch (err) {
        chk(`${id} removed`, false, String(err))
      }
    }
    const store = db()
    if (store) await store.collection('_healthcheck').doc('ping').delete().catch(() => {})
  }
}

await main()

console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail > 0) process.exitCode = 1
