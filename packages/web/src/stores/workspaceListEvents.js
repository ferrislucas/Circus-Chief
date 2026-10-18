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
    const candidate = incoming.runId === run.runId && incoming.startedAt == null
      ? { ...incoming, startedAt: run.startedAt ?? null }
      : incoming;
    next.push(shouldReplace(run) ? candidate : run);
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
    startedAt: event.startedAt ?? null,
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

/** Queue presentation keys carried on a workspace card's `kanban` object. */
const QUEUE_FIELD_KEYS = ['entryState', 'queuePosition', 'entryStatus'];

function hasQueueFields(kanban) {
  return QUEUE_FIELD_KEYS.some((key) => key in (kanban || {}));
}

/** A `kanban` object with queue presentation state removed. */
function stripQueueFields(kanban) {
  const next = { ...kanban };
  for (const key of QUEUE_FIELD_KEYS) delete next[key];
  return next;
}

/** Loaded card whose `kanban.cardId` matches a broadcast kanban card id. */
function cardByKanbanCardId(cardsById, cardId) {
  if (!cardId) return null;
  for (const card of Object.values(cardsById)) {
    if (card.kanban?.cardId === cardId) return card;
  }
  return null;
}

/**
 * Patches for realtime kanban queue broadcasts. The broadcasts are
 * authoritative for queue state ("authoritative broadcast wins", mirroring
 * the kanban store): a queued broadcast sets the marker, drain/move/remove
 * broadcasts clear a stale one. Each returns `{ cardId, patch }`; empty when
 * the event names no loaded card, in which case the caller falls back to a
 * full refresh.
 */
export function queuePatches(cardsById, event) {
  switch (event?.kind) {
    case 'onKanbanEntryQueued':
      return queuedCardPatch(cardsById, event);
    case 'onKanbanQueueDrained':
      return drainedLanePatches(cardsById, event);
    case 'onKanbanCardMoved':
      return movedCardPatch(cardsById, event);
    case 'onKanbanCardRemoved':
      return removedCardPatch(cardsById, event);
    default:
      return [];
  }
}

function queuedCardPatch(cardsById, event) {
  const card = cardByKanbanCardId(cardsById, event.cardId);
  if (!card?.kanban) return [];
  const kanban = { ...stripQueueFields(card.kanban), entryState: 'queued' };
  if (event.queuePosition != null) kanban.queuePosition = event.queuePosition;
  return [{ cardId: card.id, patch: { kanban } }];
}

function drainedLanePatches(cardsById, event) {
  return Object.values(cardsById)
    .filter((card) => card.kanban?.laneId === event.laneId && hasQueueFields(card.kanban))
    .map((card) => ({ cardId: card.id, patch: { kanban: stripQueueFields(card.kanban) } }));
}

function movedCardPatch(cardsById, event) {
  const card = cardByKanbanCardId(cardsById, event.cardId);
  if (!card?.kanban) return [];
  const broadcast = event.card || {};
  if (broadcast.entryState === 'queued' || broadcast.entryStatus === 'queued') {
    return [{ cardId: card.id, patch: { kanban: queuedBroadcastKanban(card.kanban, broadcast) } }];
  }
  if (!hasQueueFields(card.kanban)) return [];
  return [{ cardId: card.id, patch: { kanban: stripQueueFields(card.kanban) } }];
}

function queuedBroadcastKanban(current, broadcast) {
  const kanban = { ...stripQueueFields(current), entryState: 'queued' };
  if (broadcast.queuePosition != null) kanban.queuePosition = broadcast.queuePosition;
  if (broadcast.entryStatus === 'queued') kanban.entryStatus = 'queued';
  return kanban;
}

function removedCardPatch(cardsById, event) {
  const card = cardByKanbanCardId(cardsById, event.cardId);
  if (!card?.kanban || !hasQueueFields(card.kanban)) return [];
  return [{ cardId: card.id, patch: { kanban: stripQueueFields(card.kanban) } }];
}

/** Patch for a realtime summary update. */
export function summaryPatch(cardsById, sessionId, summary) {
  const card = cardForMember(cardsById, sessionId);
  // The compact card contract projects the root summary only. Descendant
  // summaries must never overwrite it.
  if (!card) return null;
  if (card.id !== sessionId) return { cardId: card.id, patch: {} };
  return { cardId: card.id, patch: summaryFields(summary) };
}

function summaryFields(summary) {
  const patch = {};
  if (summary && typeof summary === 'object') {
    if ('shortSummary' in summary) patch.summaryPreview = summary.shortSummary || null;
    if ('prState' in summary) patch.prState = summary.prState ?? null;
    if ('ciStatus' in summary) patch.ciStatus = summary.ciStatus ?? null;
    if ('hasMergeConflicts' in summary) patch.hasMergeConflicts = summary.hasMergeConflicts ?? null;
  }
  return patch;
}

/**
 * Patch for a realtime status change. Only the root's own status is rendered
 * on the card, so descendant status transitions that affect runningCount are
 * left to the next full refresh.
 */
