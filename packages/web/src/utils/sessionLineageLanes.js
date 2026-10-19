import { toTimestamp } from './sessionPickerRecency.js';

const LIVE_STATUSES = new Set(['running', 'starting']);

/**
 * Build git-log-style lineage rows from a flat session list.
 *
 * Sorting: non-scheduled rows by `createdAt` ascending (id tiebreak);
 * `status === 'scheduled'` rows sort last.
 *
 * Lanes: roots land on lane 0; the first child (in sorted order) inherits
 * its parent's lane; later children take the smallest free lane, where a
 * lane is free when its last occupant has no unprocessed descendants
 * and no unprocessed siblings. Lanes are capped at `maxLanes`; overflow
 * rows merge into the last lane.
 *
 * Duration bars: start = `createdAt`, end = `lastActivityAt ?? updatedAt`
 * (`updatedAt` falls back to `createdAt`, and live `running`/`starting`
 * sessions extend to `now`). Fractions are relative to the
 * [earliest start, latest end] window. `now` is injectable for tests —
 * never call `Date.now()` directly here.
 *
 * @param {Array<Object>} sessions raw session objects
 * @param {{ maxLanes?: number, now?: number }} [options]
 * @returns {Array<{ session: Object, lane: number, barStartPct: number, barEndPct: number, isScheduled: boolean }>}
 */
export function buildLineageRows(sessions, { maxLanes = 4, now = Date.now() } = {}) {
  const list = Array.isArray(sessions) ? sessions : [];
  if (list.length === 0) return [];
  const cap = Math.max(1, Math.floor(maxLanes) || 1);
  const sorted = sortLineageSessions(list);
  const laneOf = assignLanes(sorted, indexById(sorted), indexChildren(sorted), cap);
  const bars = computeBarFractions(sorted, now);
  return sorted.map((s) => ({
    session: s,
    lane: laneOf.get(s.id) ?? 0,
    barStartPct: bars.get(s.id).barStartPct,
    barEndPct: bars.get(s.id).barEndPct,
    isScheduled: s?.status === 'scheduled',
  }));
}

function sortLineageSessions(list) {
  return [...list].sort((a, b) => {
    const schedDiff = Number(a?.status === 'scheduled') - Number(b?.status === 'scheduled');
    if (schedDiff !== 0) return schedDiff;
    const timeDiff = toTimestamp(a?.createdAt) - toTimestamp(b?.createdAt);
    if (timeDiff !== 0) return timeDiff;
    return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
  });
}

function indexById(list) {
  return new Map(list.map((s) => [s?.id, s]));
}

function indexChildren(list) {
  const childrenOf = new Map();
  for (const s of list) {
    if (s?.parentSessionId == null) continue;
    if (!childrenOf.has(s.parentSessionId)) childrenOf.set(s.parentSessionId, []);
    childrenOf.get(s.parentSessionId).push(s.id);
  }
  return childrenOf;
}

function descendantIds(id, childrenOf, memo) {
  if (memo.has(id)) return memo.get(id);
  const out = new Set();
  const stack = [...(childrenOf.get(id) || [])];
  while (stack.length > 0) {
    const childId = stack.pop();
    if (out.has(childId)) continue;
    out.add(childId);
    stack.push(...(childrenOf.get(childId) || []));
  }
  memo.set(id, out);
  return out;
}

// A lane is free when its last occupant's line has fully played out: no
// unprocessed descendants below it, and no unprocessed siblings beside
// it. The sibling clause keeps sibling subtrees on distinct lanes until
// the whole fan-out is processed — without it, a second child would
// collapse back onto the parent lane (hiding the fork) and a wide
// fan-out would reuse lanes instead of spreading to the cap.
function laneIsFree(lane, ctx) {
  const occupants = ctx.laneOccupants.get(lane) || [];
  if (occupants.length === 0) return true;
  const lastOccupantId = occupants[occupants.length - 1];
  for (const descId of descendantIds(lastOccupantId, ctx.childrenOf, ctx.memo)) {
    if (!ctx.processed.has(descId)) return false;
  }
  const siblings = ctx.childrenOf.get(ctx.byId.get(lastOccupantId)?.parentSessionId) || [];
  for (const siblingId of siblings) {
    if (!ctx.processed.has(siblingId)) return false;
  }
  return true;
}

function smallestFreeLane(ctx) {
  for (let lane = 0; lane < ctx.laneCount; lane++) {
    if (laneIsFree(lane, ctx)) return lane;
  }
  return ctx.laneCount;
}

function pickLane(session, ctx) {
  const parentId = session?.parentSessionId;
  if (parentId == null || !ctx.byId.has(parentId)) {
    return ctx.laneOf.size === 0 ? 0 : smallestFreeLane(ctx);
  }
  const seen = ctx.childCounts.get(parentId) || 0;
  ctx.childCounts.set(parentId, seen + 1);
  if (seen === 0) return ctx.laneOf.get(parentId) ?? 0;
  return smallestFreeLane(ctx);
}

function assignLanes(sorted, byId, childrenOf, cap) {
  const ctx = {
    byId, childrenOf, cap,
    laneOf: new Map(), laneOccupants: new Map(),
    childCounts: new Map(), processed: new Set(),
    memo: new Map(), laneCount: 0,
  };
  for (const s of sorted) {
    const lane = Math.min(pickLane(s, ctx), cap - 1);
    ctx.laneOf.set(s.id, lane);
    if (!ctx.laneOccupants.has(lane)) ctx.laneOccupants.set(lane, []);
    ctx.laneOccupants.get(lane).push(s.id);
    ctx.laneCount = Math.max(ctx.laneCount, lane + 1);
    ctx.processed.add(s.id);
  }
  return ctx.laneOf;
}

function rowEndTime(session, now) {
  if (LIVE_STATUSES.has(session?.status)) return now;
  return toTimestamp(session?.lastActivityAt)
    || toTimestamp(session?.updatedAt)
    || toTimestamp(session?.createdAt);
}

function computeBarFractions(sorted, now) {
  const starts = new Map();
  const ends = new Map();
  for (const s of sorted) {
    starts.set(s.id, toTimestamp(s?.createdAt));
    ends.set(s.id, rowEndTime(s, now));
  }
  const minStart = Math.min(...starts.values());
  const range = Math.max(...ends.values()) - minStart;
  const bars = new Map();
  for (const s of sorted) {
    bars.set(s.id, range > 0
      ? {
        barStartPct: clampPct(((starts.get(s.id) - minStart) / range) * 100),
        barEndPct: clampPct(((ends.get(s.id) - minStart) / range) * 100),
      }
      : { barStartPct: 0, barEndPct: 0 });
  }
  return bars;
}

function clampPct(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
