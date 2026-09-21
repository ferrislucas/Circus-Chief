export function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function clampPercent(value) {
  return finiteNumber(value) !== null && value >= 0 && value <= 100 ? value : null;
}

export function percentage(remaining, limit) {
  return Math.min(100, Math.max(0, (remaining / limit) * 100));
}
