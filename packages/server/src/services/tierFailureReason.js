/** Remove provider payloads/secrets and keep terminal errors bounded for UI/logs. */
export function sanitizeTierFailureReason(error) {
  const raw = String(error?.message || 'provider start failed')
    .replace(/(?:api[_ -]?key|token|authorization|password)\s*[=:]\s*(?:Bearer\s+)?\S+/gi, '[redacted]')
    .replace(/\b(?:sk-[\w-]+|Bearer\s+\S+)\b/gi, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return (raw || 'provider start failed').slice(0, 240);
}
