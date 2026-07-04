/**
 * Validate and normalize scheduledAt field.
 * Accepts null (clear), numeric epoch milliseconds, or an ISO 8601 string.
 * Rejects anything that cannot be unambiguously converted to a finite integer.
 *
 * NOTE: This is the epoch-tolerant validator for PATCH and POST /schedule.
 * Do NOT use this for session-creation contracts (which require ISO-with-timezone).
 * The strict `parseScheduledAt` in `projects-session-helpers.js` backs that path.
 *
 * @param {*} value
 * @returns {{ error?: string, value?: * }}
 */
export function validateScheduledAt(value) {
  if (value === null) return { value: null };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { error: 'Invalid scheduledAt' };
    return { value: Math.trunc(value) };
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return { error: 'Invalid scheduledAt' };
    return { value: parsed };
  }
  return { error: 'Invalid scheduledAt' };
}
