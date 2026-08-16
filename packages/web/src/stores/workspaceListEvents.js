/**
 * Realtime event → card-patch helpers for the workspace list.
 *
 * The list receives single-card realtime events (command runs, summaries,
 * status) and applies them locally instead of re-fetching. These helpers hold
 * the pure merge rules; the store owns reactivity and card lookup. Each
 * returns { cardId, patch } or null when the event's session is not on a
 * loaded card, in which case the caller falls back to a full refresh.
 */

/** Owning card for a member session id, or null when not loaded. */
function cardForMember(cardsById, sessionId) {
  for (const card of Object.values(cardsById)) {
    if (card.memberIds?.includes(sessionId)) return card;
  }
  return null;
}

/**
 * Merge one realtime run into a card's latestCommandRuns. An event for the
 * same runId is that run's newer state and always replaces. Otherwise the
 * server's precedence applies (a running run displaces a finished one, then
 * recency decides) — mirroring buildRunsBySession, where a live process beats
 * a completed database row for the same button.
 */
function mergeCommandRun(runs, incoming) {
  const incomingIsRunning = incoming.status === 'running';
  const runRecency = run => run.completedAt ?? run.startedAt ?? 0;
  const shouldReplace = (current) => {
    if (current.runId === incoming.runId) return true;
    const currentIsRunning = current.status === 'running';
    if (incomingIsRunning !== currentIsRunning) return incomingIsRunning;
    return runRecency(incoming) > runRecency(current);
  };
  const next = [];
  let hasButtonRun = false;
  for (const run of runs) {
    if (run.buttonId !== incoming.buttonId) {
      next.push(run);
      continue;
    }
    hasButtonRun = true;
    // An incoming run that loses precedence (e.g. a completed event while a
    // live run is in flight) is dropped — the card keeps one run per button.
    next.push(shouldReplace(run) ? incoming : run);
  }
  if (!hasButtonRun) next.push(incoming);
  return next;
}

/** Build the wire-shaped run object carried by a realtime command-run event. */
function buildIncomingRun(event) {
  const base = {
    buttonId: event.buttonId,
    status: event.status,
    exitCode: event.exitCode ?? null,
    runId: event.runId,
    startedAt: event.startedAt ?? Date.now(),
  };
  return event.completedAt !== undefined ? { ...base, completedAt: event.completedAt } : base;
}

/** Patch for a realtime command-run lifecycle event. */
export function commandRunPatch(cardsById, event) {
  const card = cardForMember(cardsById, event.sessionId);
  if (!card) return null;
  return {
    cardId: card.id,
    patch: { latestCommandRuns: mergeCommandRun(card.latestCommandRuns || [], buildIncomingRun(event)) },
  };
}

/** Patch for a realtime summary update. */
export function summaryPatch(cardsById, sessionId, summary) {
  const card = cardForMember(cardsById, sessionId);
  if (!card) return null;
  const patch = {};
  if (summary && typeof summary === 'object') {
    if ('shortSummary' in summary) patch.summaryPreview = summary.shortSummary || null;
    if ('prState' in summary) patch.prState = summary.prState ?? null;
    if ('ciStatus' in summary) patch.ciStatus = summary.ciStatus ?? null;
    if ('hasMergeConflicts' in summary) patch.hasMergeConflicts = summary.hasMergeConflicts ?? null;
  }
  return { cardId: card.id, patch };
}

/**
 * Patch for a realtime status change. Only the root's own status is rendered
 * on the card, so descendant status transitions that affect runningCount are
 * left to the next full refresh.
 */
export function rootStatusPatch(cardsById, sessionId, status) {
  const card = cardForMember(cardsById, sessionId);
  if (!card || card.id !== sessionId) return null;
  return { cardId: card.id, patch: { status } };
}
