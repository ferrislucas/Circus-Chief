/** Stable identity for a (projectId, query) list context. */
export function queryKey(projectId, query) {
  return `${projectId}:${JSON.stringify(query)}`;
}

/** Abort errors are expected list teardown, not failures to surface. */
export function isAbort(error) {
  return error?.name === 'AbortError';
}
