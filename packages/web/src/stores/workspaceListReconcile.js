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

function workspaceFacets(card) {
  const facets = [];
  if (card.runningCount > 0) facets.push('running');
  if (card.waitingCount > 0) facets.push('waiting');
  if (facets.length === 0) facets.push('idle');
  return facets;
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
  if (workspaceBaseMatches(existing, query)) {
    for (const facet of workspaceFacets(existing)) next[facet] -= 1;
  }
  if (workspaceBaseMatches(card, query)) {
    for (const facet of workspaceFacets(card)) next[facet] += 1;
  }
  return next;
}
