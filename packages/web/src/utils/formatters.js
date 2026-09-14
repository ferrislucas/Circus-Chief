/**
 * Format a timestamp for display in the UI
 * @param {number|string|Date} timestamp - The timestamp to format
 * @returns {string} Formatted date string
 */
export function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a Date for a datetime-local input using the user's local timezone.
 * datetime-local values do not include a timezone, so UTC ISO strings must not
 * be used here.
 * @param {Date} date - Date to format
 * @returns {string} Local datetime in YYYY-MM-DDTHH:mm format
 */
export function formatDateTimeLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
