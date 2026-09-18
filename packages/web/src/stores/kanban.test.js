import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useKanbanStore } from './kanban.js';
import { api } from '../composables/useApi.js';

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

  it('updates a card in place when an active run exit lane is declared', () => {
    const store = useKanbanStore();
    store.board = { lanes: [{ cards: [{ id: 'card', activeLaneRun: { id: 'run', status: 'open' } }] }] };
    const activeLaneRun = { id: 'run', status: 'open', chosenExitLaneId: 'needs-attention', chosenExitLaneName: 'Needs attention' };

    store.handleExitLaneDeclared('card', activeLaneRun);

    expect(store.board.lanes[0].cards[0].activeLaneRun).toEqual(activeLaneRun);
  });
});

describe('kanban card routing responses', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('reverts an optimistic move when the route is accepted as a no-op', async () => {
    const store = useKanbanStore();
    store.board = {
      lanes: [
        { id: 'source', cards: [{ id: 'card', laneId: 'source' }] },
        { id: 'target', cards: [] },
      ],
    };
    vi.spyOn(api, 'routeWorkspaceKanbanCard').mockResolvedValueOnce({ status: 'noop', laneId: 'target' });

    await expect(store.routeWorkspaceCard('project', 'workspace', 'card', 'target'))
      .resolves.toEqual({ status: 'noop', laneId: 'target' });

    expect(store.board.lanes[0].cards).toEqual([{ id: 'card', laneId: 'source' }]);
    expect(store.board.lanes[1].cards).toEqual([]);
  });
});

describe('kanban command-run updates', () => {
  beforeEach(() => setActivePinia(createPinia()));

  const sessionOnBoard = () => {
    const store = useKanbanStore();
    store.board = {
      lanes: [
        { cards: [{ id: 'card', sessions: [{ id: 'root', name: 'Root', latestCommandRuns: [] }] }] },
        { cards: [] },
      ],
    };
    return store;
  };

  it('upserts a run per button and replaces the previous one for that button', () => {
    const store = sessionOnBoard();

    store.handleSessionCommandRun('root', { buttonId: 'lint', runId: 'run-1', status: 'running', exitCode: null });
    store.handleSessionCommandRun('root', { buttonId: 'lint', runId: 'run-2', status: 'success', exitCode: 0 });

    const runs = store.board.lanes[0].cards[0].sessions[0].latestCommandRuns;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ buttonId: 'lint', runId: 'run-2', status: 'success' });
  });

  it('keeps runs for other buttons when one is removed', () => {
    const store = sessionOnBoard();

    store.handleSessionCommandRun('root', { buttonId: 'lint', runId: 'run-1', status: 'success', exitCode: 0 });
    store.handleSessionCommandRun('root', { buttonId: 'tests', runId: 'run-2', status: 'success', exitCode: 0 });
    store.handleSessionCommandRunRemoved('root', 'lint');

    const runs = store.board.lanes[0].cards[0].sessions[0].latestCommandRuns;
    expect(runs.map(run => run.buttonId)).toEqual(['tests']);
  });

  it('is a no-op for a session that is not on the board', () => {
    const store = sessionOnBoard();

    store.handleSessionCommandRun('elsewhere', { buttonId: 'lint', runId: 'run-1', status: 'success' });

    expect(store.board.lanes[0].cards[0].sessions[0].latestCommandRuns).toEqual([]);
  });
});
