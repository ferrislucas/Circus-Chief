import { api } from '../composables/useApi.js';
import { queryKey } from './workspaceListQuery.js';
import { adjustWorkspaceFacets, compareWorkspaceCards, workspaceVisibleMatches } from './workspaceListReconcile.js';

export async function refreshWorkspaceCard(sessionId) {
  const existing = this.cardForSession(sessionId);
  if (!existing || !this.projectId) return null;
  const context = queryKey(this.projectId, this.query);
  const card = await api.getWorkspaceCard(existing.id);
  if (queryKey(this.projectId, this.query) !== context) return null;

  this.facets = adjustWorkspaceFacets(this.facets, existing, card, this.query);
  const wasVisible = this.orderedIds.includes(existing.id),
    isVisible = workspaceVisibleMatches(card, this.query);
  if (wasVisible && !isVisible) {
    this.removeCard(existing.id);
  } else if (isVisible) {
    this.cardsById = { ...this.cardsById, [card.id]: card };
    if (!wasVisible) {
      this.orderedIds = [...this.orderedIds, card.id];
      this.total += 1;
    }
    this.orderedIds = [...this.orderedIds]
      .sort((left, right) => compareWorkspaceCards(this.cardsById, left, right));
  }
  return card.id;
}
