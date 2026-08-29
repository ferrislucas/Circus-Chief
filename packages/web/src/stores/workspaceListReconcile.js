export function workspaceBaseMatches(card, query) {
  return Boolean(card.archived) === Boolean(query.archived)
    && (query.starred == null || Boolean(card.starred) === query.starred)
    && (query.scheduled == null || (card.scheduledCount > 0) === query.scheduled);
}

export function workspaceVisibleMatches(card, query) {
  return workspaceBaseMatches(card, query)
    && (!query.status
      || (query.status === 'running' && card.runningCount > 0)
      || (query.status === 'waiting' && card.waitingCount > 0)
      || (query.status === 'idle' && card.runningCount === 0 && card.waitingCount === 0));
}

function workspaceFacet(card) {
  if (card.runningCount > 0) return 'running';
  if (card.waitingCount > 0) return 'waiting';
  return 'idle';
}

export function compareWorkspaceCards(cardsById, leftId, rightId) {
  const left = cardsById[leftId];
  const right = cardsById[rightId];
  return Number(right.starred) - Number(left.starred)
    || right.lastActivityAt - left.lastActivityAt
    || right.updatedAt - left.updatedAt
    || right.createdAt - left.createdAt
    || right.id.localeCompare(left.id);
}

export function adjustWorkspaceFacets(facets, existing, card, query) {
  const next = { ...facets };
  if (workspaceBaseMatches(existing, query)) next[workspaceFacet(existing)] -= 1;
  if (workspaceBaseMatches(card, query)) next[workspaceFacet(card)] += 1;
  return next;
}
