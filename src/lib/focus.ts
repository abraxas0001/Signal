/**
 * "Take me to the thing I just made."
 *
 * A few screens file a task and then have to send the reader to it: the
 * comparison files the move it recommends, the recovery plan files its steps.
 * Both live several components below the router, and threading an id up through
 * Dashboard, Briefing and OpinionPanel purely so App can hand it back down
 * would put a prop on four components that none of them otherwise needs.
 *
 * So the id is left here on the way past. The screen that files it writes the
 * id, navigates, and the Actions screen picks it up on mount and scrolls to it.
 *
 * DELIBERATELY NOT STATE. Nothing renders from this, so it does not belong in
 * the store: it is a single instruction, consumed exactly once, and a stale one
 * sitting in localStorage would yank a reader to a random task days later.
 * `take` clears as it reads for that reason.
 */

let pending: string | null = null

/** Ask the next Actions screen to scroll to this task. */
export function requestActionFocus(id: string): void {
  pending = id
}

/** Read it once. Returns null when nobody asked. */
export function takeActionFocus(): string | null {
  const id = pending
  pending = null
  return id
}

/**
 * The task filed against a source, if it is still open.
 *
 * `fileFreeAction` answers whether it filed, not what it filed, and the caller
 * needs the id to send somebody to it. Both the comparison and the recovery
 * plan key their tasks on a stable source id, so the task can be found again
 * from that alone.
 */
export function actionIdForSource(
  actions: { id: string; linkedRecordIds: string[] }[],
  sourceId: string,
): string | null {
  return actions.find((a) => a.linkedRecordIds.includes(sourceId))?.id ?? null
}
