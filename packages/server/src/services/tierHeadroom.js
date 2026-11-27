const WEEKLY_KEYS = new Set(['weekly', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']);
const FIVE_HOUR_KEYS = new Set(['five_hour', 'window']);
const MODEL_WEEKLY_TIER = Object.freeze({
  seven_day_opus: 'opus',
  seven_day_sonnet: 'sonnet',
});

function hasPercent(row) {
  return typeof row?.remainingPercent === 'number' && Number.isFinite(row.remainingPercent);
}

function appliesToMember(row, catalogTier) {
  const requiredTier = MODEL_WEEKLY_TIER[row.key];
  return requiredTier === undefined || requiredTier === catalogTier;
}

function lowestPercent(rows) {
  return rows.reduce((lowest, row) => (
    row.remainingPercent < lowest.remainingPercent ? row : lowest
  ));
}

function classWindow(rows) {
  const measured = rows.filter(hasPercent);
  if (measured.length > 0) return lowestPercent(measured).remainingPercent;
  return rows.length > 0 ? null : undefined;
}

/**
 * Remaining percent of the longest allowance window that applies to this member.
 * Weekly beats 5-hour. A null return means unmeasured, not zero.
 * @param {object|null|undefined} snapshot Freshness-applied allowance snapshot.
 * @param {string|null} [catalogTier] Provider-model catalog tier (`opus`, `sonnet`, ...).
 * @returns {number|null}
 */
export function governingPercent(snapshot, catalogTier = null) {
  if (!snapshot || snapshot.stale) return null;
  const rows = Array.isArray(snapshot.allowances) ? snapshot.allowances : [];
  const weekly = classWindow(rows.filter((row) => WEEKLY_KEYS.has(row.key) && appliesToMember(row, catalogTier)));
  if (weekly !== undefined) return weekly;
  const fiveHour = classWindow(rows.filter((row) => FIVE_HOUR_KEYS.has(row.key)));
  if (fiveHour !== undefined) return fiveHour;
  const other = classWindow(rows.filter((row) => !WEEKLY_KEYS.has(row.key) && !FIVE_HOUR_KEYS.has(row.key)));
  if (other !== undefined) return other;
  return snapshot.status === 'exhausted' ? 0 : null;
}

/**
 * The allowance key that produced {@link governingPercent}, when one row won.
 * @returns {string|null}
 */
export function governingKey(snapshot, catalogTier = null) {
  if (governingPercent(snapshot, catalogTier) === null) return null;
  const rows = Array.isArray(snapshot?.allowances) ? snapshot.allowances : [];
  const weekly = rows.filter((row) => WEEKLY_KEYS.has(row.key) && appliesToMember(row, catalogTier) && hasPercent(row));
  if (weekly.length > 0) return lowestPercent(weekly).key;
  const fiveHour = rows.filter((row) => FIVE_HOUR_KEYS.has(row.key) && hasPercent(row));
  if (fiveHour.length > 0) return lowestPercent(fiveHour).key;
  const other = rows.filter((row) => !WEEKLY_KEYS.has(row.key) && !FIVE_HOUR_KEYS.has(row.key) && hasPercent(row));
  if (other.length > 0) return lowestPercent(other).key;
  return null;
}
