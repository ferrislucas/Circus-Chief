import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useKanbanStore } from './kanban.js';

describe('kanban session updates', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('preserves card session identity while applying pending input changes', () => {
    const store = useKanbanStore();
    const original = { id: 'child', name: 'Child', status: 'running', pendingAgentInput: false, custom: 'preserve' };
    store.board = { lanes: [{ cards: [{ id: 'card', sessions: [{ id: 'root', name: 'Root' }, original] }] }] };

    store.handleSessionUpdated({ id: 'child', pendingAgentInput: true });
    expect(store.board.lanes[0].cards[0].sessions[1]).toMatchObject({ id: 'child', pendingAgentInput: true, custom: 'preserve' });

    store.handleSessionUpdated({ id: 'child', pendingAgentInput: false });
    expect(store.board.lanes[0].cards[0].sessions[1].pendingAgentInput).toBe(false);
  });

  it('applies pendingAgentInput from a session:updated payload but does not copy an unallowlisted field onto the card', () => {
    const store = useKanbanStore();
    const original = { id: 'child', name: 'Child', status: 'running', pendingAgentInput: false };
    store.board = { lanes: [{ cards: [{ id: 'card', sessions: [original] }] }] };

    store.handleSessionUpdated({ id: 'child', pendingAgentInput: true, someFutureServerField: 'unexpected' });

    const updated = store.board.lanes[0].cards[0].sessions[0];
    expect(updated.pendingAgentInput).toBe(true);
    expect(updated).not.toHaveProperty('someFutureServerField');
  });

  it('does not clobber an existing pendingAgentInput: true when an update omits the field', () => {
    const store = useKanbanStore();
    const original = { id: 'child', name: 'Child', status: 'running', pendingAgentInput: true };
    store.board = { lanes: [{ cards: [{ id: 'card', sessions: [original] }] }] };

    store.handleSessionUpdated({ id: 'child', status: 'waiting' });

    const updated = store.board.lanes[0].cards[0].sessions[0];
    expect(updated.status).toBe('waiting');
    expect(updated.pendingAgentInput).toBe(true);
  });
});
