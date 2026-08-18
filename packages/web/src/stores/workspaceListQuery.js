/** Stable identity for a (projectId, query) list context. */
export function queryKey(projectId, query) {
  const fields = ['archived', 'starred', 'status', 'scheduled'];
  return `${projectId}:${fields.map(field => `${field}=${query?.[field] ?? ''}`).join('&')}`;
}

/** Abort errors are expected list teardown, not failures to surface. */
export function isAbort(error) {
  return error?.name === 'AbortError';
}
