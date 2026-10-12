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

describe('kanban queue realtime updates', () => {
  beforeEach(() => setActivePinia(createPinia()));

  function boardWithQueuedLane() {
    return {
      lanes: [
        { id: 'paused', name: 'Paused', automationEnabled: false, queuedCount: 0, cards: [{ id: 'card-1', laneId: 'paused' }] },
        { id: 'live', name: 'Live', automationEnabled: true, queuedCount: 0, cards: [] },
      ],
    };
  }

  it('marks the card queued and bumps the lane count on entry queued', () => {
    const store = useKanbanStore();
    store.board = boardWithQueuedLane();

    store.handleEntryQueued({ cardId: 'card-1', laneId: 'paused', queuePosition: 1, queueDepth: 1 });

    expect(store.board.lanes[0].queuedCount).toBe(1);
    expect(store.board.lanes[0].cards[0].entryStatus).toBe('queued');
  });

  it('moves the queued marker and both lane counts on move-out', () => {
    const store = useKanbanStore();
    store.board = boardWithQueuedLane();
    store.handleEntryQueued({ cardId: 'card-1', laneId: 'paused', queuePosition: 1, queueDepth: 1 });

    // The move broadcast carries the card without queue state; the source
    // lane count drops with the departing queued card, no refetch needed.
    store.handleCardMoved('card-1', 'paused', 'live', { id: 'card-1', laneId: 'live' });

    expect(store.board.lanes[0].queuedCount).toBe(0);
    expect(store.board.lanes[0].cards).toEqual([]);
    expect(store.board.lanes[1].cards[0]).toMatchObject({ id: 'card-1' });
    expect(store.board.lanes[1].cards[0]).not.toHaveProperty('entryStatus');
  });

  it('clears the queue state on drain without a refetch', () => {
    const store = useKanbanStore();
    store.board = boardWithQueuedLane();
    store.handleEntryQueued({ cardId: 'card-1', laneId: 'paused', queuePosition: 1, queueDepth: 2 });

    store.handleQueueDrained({ laneId: 'paused', drainedCount: 2 });

    expect(store.board.lanes[0].queuedCount).toBe(0);
    expect(store.board.lanes[0].cards[0]).not.toHaveProperty('entryStatus');
  });

  it('ignores queue events for unknown lanes', () => {
    const store = useKanbanStore();
    store.board = boardWithQueuedLane();

    expect(() => {
      store.handleEntryQueued({ cardId: 'ghost', laneId: 'nope', queuePosition: 1, queueDepth: 1 });
      store.handleQueueDrained({ laneId: 'nope', drainedCount: 1 });
    }).not.toThrow();
    expect(store.board.lanes[0].queuedCount).toBe(0);
  });

  it('drops the lane count when a queued card is removed', () => {
    const store = useKanbanStore();
    store.board = boardWithQueuedLane();
    store.handleEntryQueued({ cardId: 'card-1', laneId: 'paused', queuePosition: 1, queueDepth: 1 });

    store.handleCardRemoved('card-1', 'paused');

    expect(store.board.lanes[0].cards).toEqual([]);
    expect(store.board.lanes[0].queuedCount).toBe(0);
  });

  it('keeps the lane count when a non-queued card is removed', () => {
    const store = useKanbanStore();
    store.board = boardWithQueuedLane();
    store.handleEntryQueued({ cardId: 'card-1', laneId: 'paused', queuePosition: 1, queueDepth: 1 });
    store.board.lanes[0].cards.push({ id: 'card-2', laneId: 'paused' });

    store.handleCardRemoved('card-2', 'paused');

    expect(store.board.lanes[0].cards).toHaveLength(1);
    expect(store.board.lanes[0].queuedCount).toBe(1);
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

describe('kanban optimistic queue convergence', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  function boardWithQueuedCard() {
    return {
      lanes: [
        {
          id: 'paused', name: 'Paused', automationEnabled: false, queuedCount: 1,
          cards: [{ id: 'card-1', laneId: 'paused', entryStatus: 'queued' }],
        },
        {
          id: 'live', name: 'Live', automationEnabled: true, queuedCount: 0,
          cards: [],
        },
      ],
    };
  }

  it('converges queue state when a queued card is dragged to an enabled lane', async () => {
    const store = useKanbanStore();
    store.board = boardWithQueuedCard();
    vi.spyOn(api, 'routeWorkspaceKanbanCard').mockResolvedValueOnce({ status: 'moved', laneId: 'live' });

    const routed = store.routeWorkspaceCard('project', 'workspace', 'card-1', 'live');
    // The owning browser already moved the card optimistically when the
    // KANBAN_CARD_MOVED broadcast arrives.
    store.handleCardMoved('card-1', 'paused', 'live', { id: 'card-1', laneId: 'live' });
    await routed;

    expect(store.board.lanes[0].queuedCount).toBe(0);
    expect(store.board.lanes[0].cards).toEqual([]);
    expect(store.board.lanes[1].cards).toHaveLength(1);
    expect(store.board.lanes[1].cards[0]).not.toHaveProperty('entryStatus');
  });

  it('decrements the source exactly once when moving between paused lanes', async () => {
    const store = useKanbanStore();
    store.board = {
      lanes: [
        {
          id: 'paused-a', name: 'Paused A', automationEnabled: false, queuedCount: 1,
          cards: [{ id: 'card-1', laneId: 'paused-a', entryStatus: 'queued' }],
        },
        {
          id: 'paused-b', name: 'Paused B', automationEnabled: false, queuedCount: 0,
          cards: [],
        },
      ],
    };
    vi.spyOn(api, 'routeWorkspaceKanbanCard').mockResolvedValueOnce({ status: 'moved', laneId: 'paused-b' });

    const routed = store.routeWorkspaceCard('project', 'workspace', 'card-1', 'paused-b');
    store.handleCardMoved('card-1', 'paused-a', 'paused-b', { id: 'card-1', laneId: 'paused-b' });
    await routed;

    expect(store.board.lanes[0].queuedCount).toBe(0);
    expect(store.board.lanes[0].cards).toEqual([]);
    expect(store.board.lanes[1].cards).toEqual([{ id: 'card-1', laneId: 'paused-b' }]);
  });

  it('converges identically whether the card was already moved locally or not', async () => {
    // Path A: another browser moved the card; no local optimistic step.
    const remote = useKanbanStore();
    remote.board = boardWithQueuedCard();
    remote.handleCardMoved('card-1', 'paused', 'live', { id: 'card-1', laneId: 'live' });

    // Path B: this browser moved the card optimistically first.
    setActivePinia(createPinia());
    const local = useKanbanStore();
    local.board = boardWithQueuedCard();
    vi.spyOn(api, 'routeWorkspaceKanbanCard').mockResolvedValueOnce({ status: 'moved', laneId: 'live' });
    const routed = local.routeWorkspaceCard('project', 'workspace', 'card-1', 'live');
    local.handleCardMoved('card-1', 'paused', 'live', { id: 'card-1', laneId: 'live' });
    await routed;

    expect(local.board).toEqual(remote.board);
    expect(local.board.lanes[0].queuedCount).toBe(0);
    expect(local.board.lanes[1].cards[0]).not.toHaveProperty('entryStatus');
  });

  it('applies the source decrement exactly once across optimistic move and duplicate broadcasts', async () => {
    const store = useKanbanStore();
    store.board = boardWithQueuedCard();
    vi.spyOn(api, 'routeWorkspaceKanbanCard').mockResolvedValueOnce({ status: 'moved', laneId: 'live' });

    const routed = store.routeWorkspaceCard('project', 'workspace', 'card-1', 'live');
    store.handleCardMoved('card-1', 'paused', 'live', { id: 'card-1', laneId: 'live' });
    store.handleCardMoved('card-1', 'paused', 'live', { id: 'card-1', laneId: 'live' });
    await routed;

    expect(store.board.lanes[0].queuedCount).toBe(0);
    expect(store.board.lanes[1].cards).toEqual([{ id: 'card-1', laneId: 'live' }]);
  });

  it('drops the source count by exactly one when other queued cards remain', async () => {
    const store = useKanbanStore();
    store.board = {
      lanes: [
        {
          id: 'paused', queuedCount: 2,
          cards: [
            { id: 'card-1', laneId: 'paused', entryStatus: 'queued' },
            { id: 'card-2', laneId: 'paused', entryStatus: 'queued' },
          ],
        },
        { id: 'live', queuedCount: 0, cards: [] },
      ],
    };

    // Another browser moves card-1 out; no local optimistic step.
    store.handleCardMoved('card-1', 'paused', 'live', { id: 'card-1', laneId: 'live' });

    expect(store.board.lanes[0].queuedCount).toBe(1);
    expect(store.board.lanes[0].cards).toEqual([{ id: 'card-2', laneId: 'paused', entryStatus: 'queued' }]);
    expect(store.board.lanes[1].cards).toEqual([{ id: 'card-1', laneId: 'live' }]);
  });

  it('never drives the source count negative for a non-queued move', async () => {
    const store = useKanbanStore();
    store.board = {
      lanes: [
        { id: 'paused', queuedCount: 0, cards: [{ id: 'card-1', laneId: 'paused' }] },
        { id: 'live', queuedCount: 0, cards: [] },
      ],
    };
    vi.spyOn(api, 'routeWorkspaceKanbanCard').mockResolvedValueOnce({ status: 'moved', laneId: 'live' });

    const routed = store.routeWorkspaceCard('project', 'workspace', 'card-1', 'live');
    store.handleCardMoved('card-1', 'paused', 'live', { id: 'card-1', laneId: 'live' });
    await routed;

    expect(store.board.lanes[0].queuedCount).toBe(0);
  });

  it('restores the queued marker and source count when the route fails', async () => {
    const store = useKanbanStore();
    store.board = boardWithQueuedCard();
    vi.spyOn(api, 'routeWorkspaceKanbanCard').mockRejectedValueOnce(new Error('route failed'));

    await expect(store.routeWorkspaceCard('project', 'workspace', 'card-1', 'live'))
      .rejects.toThrow('route failed');

    expect(store.board.lanes[0].queuedCount).toBe(1);
    expect(store.board.lanes[0].cards).toEqual([{ id: 'card-1', laneId: 'paused', entryStatus: 'queued' }]);
    expect(store.board.lanes[1].cards).toEqual([]);
  });

  it('restores the queued marker and source count when the route is a no-op', async () => {
    const store = useKanbanStore();
    store.board = boardWithQueuedCard();
    vi.spyOn(api, 'routeWorkspaceKanbanCard').mockResolvedValueOnce({ status: 'noop', laneId: 'live' });

    await store.routeWorkspaceCard('project', 'workspace', 'card-1', 'live');

    expect(store.board.lanes[0].queuedCount).toBe(1);
    expect(store.board.lanes[0].cards).toEqual([{ id: 'card-1', laneId: 'paused', entryStatus: 'queued' }]);
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
