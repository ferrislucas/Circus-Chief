export function toTimestamp(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getSessionPickerRecency(session) {
  // Use a fallback chain instead of MAX: lastMessageAt is the primary signal
  // for "direct message recency". Only fall back to updatedAt when there are
  // no messages, because updatedAt gets bumped by internal status changes
  // (agent start, error, etc.) that are not user-visible "activity".
  const lastMsg = toTimestamp(session?.lastMessageAt);
  if (lastMsg > 0) return { source: 'lastMessageAt', time: lastMsg };

  const updated = toTimestamp(session?.updatedAt);
  if (updated > 0) return { source: 'updatedAt', time: updated };

  const created = toTimestamp(session?.createdAt);
  if (created > 0) return { source: 'createdAt', time: created };

  return { source: 'none', time: 0 };
}

export function getSessionPickerRecentTime(session) {
  return getSessionPickerRecency(session).time;
}

export function compareSessionChainEntries(a, b) {
  const aSession = a?.session || {};
  const bSession = b?.session || {};
  const comparisons = [
    getSessionPickerRecentTime(bSession) - getSessionPickerRecentTime(aSession),
    toTimestamp(bSession.createdAt) - toTimestamp(aSession.createdAt),
  ];
  const firstDifference = comparisons.find(value => value !== 0);
  if (firstDifference) return firstDifference;
  return String(aSession.id || '').localeCompare(String(bSession.id || ''));
}

export function withPickerTimestamp(entry) {
  const recency = getSessionPickerRecency(entry?.session);
  return {
    ...entry,
    pickerTimestamp: recency.time || null,
    pickerTimestampSource: recency.source,
  };
}

export function sortSessionChain(entries) {
  return [...entries].sort(compareSessionChainEntries).map(withPickerTimestamp);
}
