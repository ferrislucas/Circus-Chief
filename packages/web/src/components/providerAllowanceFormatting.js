const SOURCE_LABELS = {
  provider: 'Reported by provider',
  'observed-header': 'Observed from provider response headers',
  configured: 'Configured estimate',
};

function formatRelativeTime(value, now = Date.now()) {
  const difference = new Date(value).getTime() - now;
  const minutes = Math.round(Math.abs(difference) / 60_000);
  if (minutes < 1) return 'just now';
  const unit = minutes < 60 ? ['minute', minutes] : minutes < 1_440 ? ['hour', Math.round(minutes / 60)] : ['day', Math.round(minutes / 1_440)];
  const [name, amount] = unit;
  const label = `${amount} ${name}${amount === 1 ? '' : 's'}`;
  return difference >= 0 ? `in ${label}` : `${label} ago`;
}

function formatExactTime(value) {
  return new Date(value).toLocaleString();
}

function formatAllowance(allowance) {
  if (allowance.remainingPercent === null) return 'Unknown';
  if (allowance.value !== null && allowance.value !== undefined && allowance.valueKind && allowance.limit !== null) {
    return `${formatCompactNumber(allowance.value)} ${allowance.unit} ${allowance.valueKind} of ${formatCompactNumber(allowance.limit)}`;
  }
  if (allowance.remaining === null || allowance.limit === null) return `${Math.round(allowance.remainingPercent)}% remaining`;
  return `${allowance.remaining} / ${allowance.limit} ${allowance.unit} remaining (${Math.round(allowance.remainingPercent)}%)`;
}

function formatCompactNumber(value) {
  if (Math.abs(value) >= 1_000_000) return `${trimmed(value / 1_000_000)}M`;
  if (Math.abs(value) >= 1_000) return `${trimmed(value / 1_000)}K`;
  return String(value);
}

function trimmed(value) {
  return Number(value.toFixed(1)).toString();
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] || 'Usage data source unavailable';
}

export { formatAllowance, formatExactTime, formatRelativeTime, sourceLabel };
