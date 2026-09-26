function sameSelection(left, right) {
  return (left?.model || null) === (right?.model || null)
    && (left?.providerId ?? null) === (right?.providerId ?? null);
}

/**
 * Reconcile just the atomic provider/model pair. A concurrent local model
 * edit wins and is reported to the caller; unrelated fields are never read or
 * changed, so a server-side tier degradation cannot discard unsaved form work.
 */
export function reconcileModelSelection({ current, previousCanonical, canonical }) {
  const localSelection = { model: current?.model || null, providerId: current?.providerId ?? null };
  const canonicalSelection = { model: canonical?.model || null, providerId: canonical?.providerId ?? null };
  if (!sameSelection(localSelection, previousCanonical)) {
    return { ...localSelection, conflict: !sameSelection(localSelection, canonicalSelection) };
  }
  return { ...canonicalSelection, conflict: false };
}
