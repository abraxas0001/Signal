import { createHash } from 'node:crypto'
import { db, firestoreConfigured, firestoreError } from './firebase'
import {
  RELEVANCE_CONFIDENCE,
  RELEVANCE_VERDICTS,
  type RelevanceConfidence,
  type RelevanceVerdict,
} from './relevance'

/**
 * The register of desks that have ASKED to be scanned while nobody is looking.
 *
 * Everything else in this product keeps a desk's identity on the office's own
 * device. `src/lib/store.ts` says why in as many words: the records name
 * private citizens, serving officials and unproven allegations, the office has
 * no hosting agreement and no retention policy, and nobody here is accountable
 * for a breach. That decision has not been reversed and this file does not
 * reverse it.
 *
 * What this file adds is a single, narrow exception that an office has to ask
 * for by name. A scan that runs on a schedule has to run somewhere the office's
 * browser is not, and a server cannot scan for a member it has never been told
 * about. So a desk that wants the daily scan uploads the part of itself the
 * scan needs — who the member is, what words to watch, which papers to read —
 * and nothing else. No grievance record, no citizen's name, no mention, no
 * comment, no analysis. Those stay on the device where they were always kept.
 *
 * THREE RULES THIS FILE EXISTS TO ENFORCE.
 *
 * Nothing is registered without an explicit action. There is no path from
 * "opened the app" to a row in here. `upsertDesk` is reached only through
 * POST /api/desk-registry, which is gated on the office's own settings key.
 *
 * `enabled` is the whole switch. A desk with `enabled: false` is skipped by
 * the daily scan entirely, and an office that wants out can either flip it or
 * call `deleteDesk`, which removes the record and everything filed under it.
 *
 * Absent Firestore says so. It does not return an empty list. "No desks are
 * registered" and "this deploy cannot tell you whether any desks are
 * registered" are different claims, and a scheduled job that reads the first
 * when the second is true reports a clean run having done nothing at all. Every
 * function here returns a result that carries one or the other.
 *
 * The SDK is `firebase-admin`, the server one: chained and method-based
 * (`db.collection('x').doc('y').get()`), not the modular web SDK.
 */

/** The collection. Siblings are `posts`, `snapshots` and `competitors`. */
const DESKS = 'desks'

/** Judged stories, filed under the desk they were found for. */
const FINDINGS = 'findings'

/**
 * An answer, or a plain sentence about why there isn't one.
 *
 * A bare `null` return would collapse "no such desk" into "no database", which
 * is the exact confusion this registry cannot afford: the first is a normal
 * answer and the second means the scheduled scan should stop rather than report
 * that every office had a quiet day.
 */
export type RegistryResult<T> = { ok: true; value: T } | { ok: false; note: string }

const unavailable = <T>(): RegistryResult<T> => ({
  ok: false,
  note:
    firestoreError() ??
    'Firestore is not configured on this deploy, so no desk register exists to read or write.',
})

const failed = <T>(what: string, err: unknown): RegistryResult<T> => ({
  ok: false,
  note: `Firestore refused to ${what}: ${err instanceof Error ? err.message : String(err)}`,
})

/**
 * One office's desk, as the server needs to know it.
 *
 * Deliberately the smallest thing that can run a scan. Compare it with
 * `OfficeProfile` and `Identity` on the client, which carry a great deal more:
 * handles, districts, dates of birth, the identity's own notes. None of that is
 * needed to read a masthead and none of it is uploaded.
 */
export interface DeskRecord {
  /** Stable, office-chosen, and the Firestore document id. See `normaliseDeskId`. */
  deskId: string
  /** The member this desk is for. The one unavoidable piece of identity. */
  name: string
  /** MP, MLA, and so on. Null when the office did not say. */
  role: string | null
  constituency: string | null
  state: string | null
  party: string | null
  /** Other spellings of the name, which is how Telugu mastheads are matched. */
  aliases: string[]
  /** Towns, mandals and district spellings the seat is known by. */
  places: string[]
  /** The words the scan searches headlines for. */
  watchTerms: string[]
  /** Masthead labels from shared/regions.ts PORTALS. */
  portals: string[]
  /** Index or tag pages the office pasted in. */
  customPortalUrls: string[]
  /** When this record was last written. */
  updatedAt: string
  /** When the scheduled scan last ran for this desk. Null means never. */
  lastServerScanAt: string | null
  /**
   * Whether the scheduled scan may read for this desk.
   *
   * False is a real state, not a deleted one: an office can pause the server
   * scan without losing the registration, and the record still says plainly
   * that it is registered.
   */
  enabled: boolean
}

/** What a caller may set. Everything else is the registry's to write. */
export interface DeskUpsert {
  deskId: string
  name: string
  role?: string | null
  constituency?: string | null
  state?: string | null
  party?: string | null
  aliases?: string[]
  places?: string[]
  watchTerms?: string[]
  portals?: string[]
  customPortalUrls?: string[]
  enabled?: boolean
}

/**
 * One story the daily scan found and judged.
 *
 * `verdict: null` is not a synonym for `'unrelated'`. It means nothing judged
 * this story at all, which is what happens when no provider key is configured
 * or the relevance pass ran out of window, and `judgeRelevance` is careful to
 * report that case as `judged: false` rather than ruling everything unrelated.
 * A desk shown an unjudged story as "not about you" would be shown a verdict
 * nobody reached, so the two states are stored apart and stay apart.
 */
export interface DeskFinding {
  /** A hash of the address. Firestore ids cannot contain a slash. */
  id: string
  url: string
  title: string
  portal: string
  /** Which watch words the word matcher hit. */
  matched: string[]
  /** What the relevance pass ruled, or null when nothing judged it. */
  verdict: RelevanceVerdict | null
  /** How sure it was. Null when unjudged. */
  confidence: RelevanceConfidence | null
  /** The judge's reason in its own words. Null when unjudged. */
  why: string | null
  /** When the scan found it. Not the publication date, which is not read here. */
  foundAt: string
  /** Which run produced it, so one run's output can be identified as a set. */
  scanId: string
}

/**
 * Which verdicts a desk actually wants to see.
 *
 * The member and their seat. Not the party: `worthKeeping` in lib/scan.ts was
 * written because a Mahabubnagar desk watching "BJP" was handed a Kolkata
 * meeting and a shootout in Karnataka every morning, and a verdict of
 * `about-party` is that same national wire arriving with a model's blessing on
 * it. It is stored rather than dropped, because an office looking at a quiet
 * week is entitled to see what was set aside and why.
 */
export function isDeskRelevant(verdict: RelevanceVerdict | null): boolean {
  return verdict === 'about-person' || verdict === 'about-seat'
}

/* ── shaping what comes off the wire ───────────────────────────────────────── */

const text = (v: unknown, cap: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, cap) : null
}

const strings = (v: unknown, cap: number, each: number): string[] =>
  Array.isArray(v)
    ? [
        ...new Set(
          v
            .map((x) => text(x, each))
            .filter((x): x is string => x !== null),
        ),
      ].slice(0, cap)
    : []

/**
 * A desk id that can safely be a Firestore document id.
 *
 * Firestore rejects a slash outright and treats `.` and `..` as path segments,
 * and an id built from a member's name would otherwise arrive with spaces,
 * initials and full stops in it. Lower-cased and hyphenated so the same office
 * typing the same name twice lands on the same row rather than quietly
 * registering a second desk that the scan then reads twice.
 *
 * Returns null rather than a repaired guess when nothing usable survives. An
 * office is better told its id was rejected than to find its desk filed under
 * "desk---".
 */
export function normaliseDeskId(raw: unknown): string | null {
  const value = text(raw, 120)
  if (!value) return null
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length < 3 || slug.length > 64) return null
  return slug
}

/** The document id for a story, since its address cannot be one. */
function findingId(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 32)
}

/**
 * Read a stored row back into the shape callers expect.
 *
 * Written defensively on purpose: a document may predate a field, or have been
 * edited by hand in the Firebase console, and a scheduled job that throws on
 * one malformed row skips every desk after it.
 */
function toRecord(deskId: string, data: Record<string, unknown> | undefined): DeskRecord | null {
  if (!data) return null
  const name = text(data['name'], 120)
  if (!name) return null
  return {
    deskId,
    name,
    role: text(data['role'], 120),
    constituency: text(data['constituency'], 120),
    state: text(data['state'], 80),
    party: text(data['party'], 120),
    aliases: strings(data['aliases'], 20, 60),
    places: strings(data['places'], 40, 60),
    watchTerms: strings(data['watchTerms'], 40, 60),
    portals: strings(data['portals'], 24, 80),
    customPortalUrls: strings(data['customPortalUrls'], 24, 300),
    updatedAt: text(data['updatedAt'], 40) ?? new Date(0).toISOString(),
    lastServerScanAt: text(data['lastServerScanAt'], 40),
    // Absent means off. A row written before this field existed must not be
    // read as consent to scan it.
    enabled: data['enabled'] === true,
  }
}

/* ── the four the endpoint uses ────────────────────────────────────────────── */

/** Is there a register at all on this deploy? */
export function registryConfigured(): boolean {
  return firestoreConfigured()
}

/** One desk, or null when no such desk is registered. */
export async function readDesk(deskId: string): Promise<RegistryResult<DeskRecord | null>> {
  const id = normaliseDeskId(deskId)
  if (!id) return { ok: false, note: 'That is not a usable desk id.' }

  const store = db()
  if (!store) return unavailable()

  try {
    const snap = await store.collection(DESKS).doc(id).get()
    if (!snap.exists) return { ok: true, value: null }
    return { ok: true, value: toRecord(id, snap.data()) }
  } catch (err) {
    return failed('read that desk', err)
  }
}

/**
 * Register a desk, or update one already registered.
 *
 * `enabled` defaults to TRUE on a first write and is otherwise left alone. That
 * is not an assumption about what the office wants in general: reaching this
 * function at all requires a POST to the gated endpoint carrying the office's
 * own settings key, which is the explicit action. Defaulting it to false would
 * mean an office that asked to be scanned would have to ask twice and would be
 * told nothing about why the first time did not work.
 *
 * `lastServerScanAt` is never taken from a caller. It is the register's own
 * record of what the scheduled job did, and a client that could set it could
 * make an unscanned desk look scanned.
 */
export async function upsertDesk(input: DeskUpsert): Promise<RegistryResult<DeskRecord>> {
  const id = normaliseDeskId(input.deskId)
  if (!id) {
    return {
      ok: false,
      note: 'A desk id has to be between three and sixty-four letters or numbers once punctuation is removed.',
    }
  }
  const name = text(input.name, 120)
  if (!name) {
    return { ok: false, note: 'Name the member this desk is for before registering it.' }
  }

  const portals = strings(input.portals, 24, 80)
  const customPortalUrls = strings(input.customPortalUrls, 24, 300).filter((u) =>
    /^https?:\/\//i.test(u),
  )
  if (portals.length === 0 && customPortalUrls.length === 0) {
    return {
      ok: false,
      note: 'A registered desk needs at least one masthead or one page address, otherwise the daily scan has nothing to read.',
    }
  }

  const watchTerms = strings(input.watchTerms, 40, 60)
  if (watchTerms.length === 0) {
    return {
      ok: false,
      note: 'A registered desk needs at least one watch word. With none, every story on the page would match or none would.',
    }
  }

  const store = db()
  if (!store) return unavailable()

  const ref = store.collection(DESKS).doc(id)

  try {
    const existing = await ref.get()
    const before = toRecord(id, existing.data())

    const record: DeskRecord = {
      deskId: id,
      name,
      role: text(input.role, 120),
      constituency: text(input.constituency, 120),
      state: text(input.state, 80),
      party: text(input.party, 120),
      aliases: strings(input.aliases, 20, 60),
      places: strings(input.places, 40, 60),
      watchTerms,
      portals,
      customPortalUrls,
      updatedAt: new Date().toISOString(),
      // The register's own bookkeeping, carried forward rather than accepted.
      lastServerScanAt: before?.lastServerScanAt ?? null,
      enabled: typeof input.enabled === 'boolean' ? input.enabled : (before?.enabled ?? true),
    }

    await ref.set(record, { merge: true })
    return { ok: true, value: record }
  } catch (err) {
    return failed('register that desk', err)
  }
}

/**
 * Every registered desk, newest write first.
 *
 * `enabledOnly` is what the scheduled scan passes. It is a filter here rather
 * than a Firestore `where` clause on purpose: the register holds tens of rows,
 * not thousands, and a composite index that has to be created by hand in the
 * console is a way for a scheduled job to start silently returning nothing
 * after somebody adds a field.
 */
export async function listDesks(
  opts: { enabledOnly?: boolean; limit?: number } = {},
): Promise<RegistryResult<DeskRecord[]>> {
  const store = db()
  if (!store) return unavailable()

  const limit = Math.max(1, Math.min(opts.limit ?? 200, 500))

  try {
    const snap = await store.collection(DESKS).limit(limit).get()
    const rows = snap.docs
      .map((doc) => toRecord(doc.id, doc.data()))
      .filter((r): r is DeskRecord => r !== null)
      .filter((r) => (opts.enabledOnly ? r.enabled : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { ok: true, value: rows }
  } catch (err) {
    return failed('list the desks', err)
  }
}

/**
 * Remove a desk from the register, and everything filed under it.
 *
 * The findings go too. Firestore does not delete a subcollection with its
 * parent, so a desk deleted without this would leave its judged stories
 * orphaned in the database for ever, which for an office that asked to be
 * forgotten is the opposite of what it asked for.
 */
export async function deleteDesk(deskId: string): Promise<RegistryResult<{ existed: boolean }>> {
  const id = normaliseDeskId(deskId)
  if (!id) return { ok: false, note: 'That is not a usable desk id.' }

  const store = db()
  if (!store) return unavailable()

  const ref = store.collection(DESKS).doc(id)

  try {
    const existing = await ref.get()

    // In pages, because a batch takes 500 writes and a busy desk holds more
    // findings than that.
    for (;;) {
      const page = await ref.collection(FINDINGS).limit(400).get()
      if (page.empty) break
      const batch = store.batch()
      for (const doc of page.docs) batch.delete(doc.ref)
      await batch.commit()
      if (page.size < 400) break
    }

    await ref.delete()
    return { ok: true, value: { existed: existing.exists } }
  } catch (err) {
    return failed('remove that desk', err)
  }
}

/* ── what the scheduled scan writes ────────────────────────────────────────── */

/**
 * Stamp when the scheduled scan last ran for a desk.
 *
 * Separate from `upsertDesk` because the two have different owners. An office
 * owns the configuration; the register owns the record of what was done with
 * it, and a client that could write this could make a desk that has never been
 * scanned look current.
 */
export async function markServerScan(
  deskId: string,
  at: string = new Date().toISOString(),
): Promise<RegistryResult<null>> {
  const id = normaliseDeskId(deskId)
  if (!id) return { ok: false, note: 'That is not a usable desk id.' }

  const store = db()
  if (!store) return unavailable()

  try {
    await store.collection(DESKS).doc(id).set({ lastServerScanAt: at }, { merge: true })
    return { ok: true, value: null }
  } catch (err) {
    return failed('record that scan', err)
  }
}

/**
 * File what a run found, keyed on the story so a re-find is not a second row.
 *
 * `merge: true` on purpose. The same story is carried by two mastheads and
 * found again the next morning, and an office that has already seen it should
 * not be handed it twice under two ids. The judge's verdict is allowed to
 * improve on a later run; nothing here overwrites a verdict with an absence,
 * because an unjudged pass omits the field rather than writing null over it.
 */
export async function storeFindings(
  deskId: string,
  findings: Omit<DeskFinding, 'id'>[],
): Promise<RegistryResult<{ written: number }>> {
  const id = normaliseDeskId(deskId)
  if (!id) return { ok: false, note: 'That is not a usable desk id.' }

  const store = db()
  if (!store) return unavailable()
  if (findings.length === 0) return { ok: true, value: { written: 0 } }

  const collection = store.collection(DESKS).doc(id).collection(FINDINGS)

  try {
    let written = 0
    // 500 writes per batch is the Firestore limit; 400 leaves headroom.
    for (let i = 0; i < findings.length; i += 400) {
      const batch = store.batch()
      for (const f of findings.slice(i, i + 400)) {
        const docId = findingId(f.url)
        const row: Record<string, unknown> = {
          id: docId,
          url: f.url,
          title: f.title,
          portal: f.portal,
          matched: f.matched,
          foundAt: f.foundAt,
          scanId: f.scanId,
        }
        // Only write a verdict when there is one. Writing null over a verdict a
        // previous run reached would turn a judged story back into an unjudged
        // one every time a run with no provider key went past it.
        if (f.verdict !== null) {
          row['verdict'] = f.verdict
          row['confidence'] = f.confidence
          row['why'] = f.why
        }
        batch.set(collection.doc(docId), row, { merge: true })
        written++
      }
      await batch.commit()
    }
    return { ok: true, value: { written } }
  } catch (err) {
    return failed('file those stories', err)
  }
}

/**
 * What the scan has filed for a desk, newest first.
 *
 * This is how the app picks up work the server did while the office was closed.
 * `relevantOnly` exists because the default answer an office wants is "what is
 * about me", and it excludes the unjudged rows rather than counting them as
 * relevant on the grounds that nothing said otherwise. See `isDeskRelevant`.
 */
export async function listFindings(
  deskId: string,
  opts: { limit?: number; since?: string | null; relevantOnly?: boolean } = {},
): Promise<RegistryResult<DeskFinding[]>> {
  const id = normaliseDeskId(deskId)
  if (!id) return { ok: false, note: 'That is not a usable desk id.' }

  const store = db()
  if (!store) return unavailable()

  const limit = Math.max(1, Math.min(opts.limit ?? 100, 300))

  try {
    // Ordered in the query rather than in memory because `foundAt` is a single
    // field and needs no composite index; the filters below are applied after,
    // for the reason given on `listDesks`.
    const snap = await store
      .collection(DESKS)
      .doc(id)
      .collection(FINDINGS)
      .orderBy('foundAt', 'desc')
      .limit(limit)
      .get()

    const rows = snap.docs
      .map((doc) => {
        const data = doc.data()
        const url = text(data['url'], 500)
        const title = text(data['title'], 400)
        if (!url || !title) return null
        // Read against the enum rather than cast to it. A row written by an
        // older build, or edited in the Firebase console, must land as
        // "unjudged" rather than as a verdict string nothing else recognises.
        const rawVerdict = text(data['verdict'], 40)
        const verdict = RELEVANCE_VERDICTS.find((v) => v === rawVerdict) ?? null
        const rawConfidence = text(data['confidence'], 20)
        const confidence = RELEVANCE_CONFIDENCE.find((c) => c === rawConfidence) ?? null

        const finding: DeskFinding = {
          id: doc.id,
          url,
          title,
          portal: text(data['portal'], 120) ?? 'unknown',
          matched: strings(data['matched'], 20, 60),
          verdict,
          confidence: verdict ? confidence : null,
          why: verdict ? text(data['why'], 400) : null,
          foundAt: text(data['foundAt'], 40) ?? new Date(0).toISOString(),
          scanId: text(data['scanId'], 60) ?? 'unknown',
        }
        return finding
      })
      .filter((r): r is DeskFinding => r !== null)
      .filter((r) => (opts.since ? r.foundAt > opts.since : true))
      .filter((r) => (opts.relevantOnly ? isDeskRelevant(r.verdict) : true))

    return { ok: true, value: rows }
  } catch (err) {
    return failed('read what was filed', err)
  }
}
