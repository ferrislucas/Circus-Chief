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
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  function routedBoard() {
    return {
      lanes: [
        { id: 'source', cards: [{ id: 'card', laneId: 'source' }] },
        { id: 'target', cards: [] },
      ],
    };
  }

  it('reverts an optimistic move when the route is accepted as a no-op', async () => {
    const store = useKanbanStore();
    store.board = routedBoard();
    vi.spyOn(api, 'routeWorkspaceKanbanCard').mockResolvedValueOnce({ status: 'noop', laneId: 'target' });

    await expect(store.routeWorkspaceCard('project', 'workspace', 'card', 'target'))
      .resolves.toEqual({ status: 'noop', laneId: 'target' });

    expect(store.board.lanes[0].cards).toEqual([{ id: 'card', laneId: 'source' }]);
    expect(store.board.lanes[1].cards).toEqual([]);
  });

  it('keeps the optimistic move and applies queue presentation when the route queues', async () => {
    const store = useKanbanStore();
    store.board = routedBoard();
    vi.spyOn(api, 'routeWorkspaceKanbanCard')
      .mockResolvedValueOnce({ status: 'queued', laneId: 'target', queuePosition: 2 });

    await expect(store.routeWorkspaceCard('project', 'workspace', 'card', 'target'))
      .resolves.toEqual({ status: 'queued', laneId: 'target', queuePosition: 2 });

    expect(store.board.lanes[0].cards).toEqual([]);
    expect(store.board.lanes[1].cards).toEqual([
      { id: 'card', laneId: 'target', entryState: 'queued', queuePosition: 2 },
    ]);
  });

  it('keeps the optimistic move when the route moves', async () => {
    const store = useKanbanStore();
    store.board = routedBoard();
    vi.spyOn(api, 'routeWorkspaceKanbanCard')
      .mockResolvedValueOnce({ status: 'moved', laneId: 'target' });

    await expect(store.routeWorkspaceCard('project', 'workspace', 'card', 'target'))
      .resolves.toEqual({ status: 'moved', laneId: 'target' });

    expect(store.board.lanes[0].cards).toEqual([]);
    expect(store.board.lanes[1].cards).toEqual([{ id: 'card', laneId: 'target' }]);
  });

  it('reverts an optimistic move when the route only schedules a deferred exit', async () => {
    const store = useKanbanStore();
    store.board = routedBoard();
    vi.spyOn(api, 'routeWorkspaceKanbanCard')
      .mockResolvedValueOnce({ status: 'scheduled', laneId: 'target' });

    await expect(store.routeWorkspaceCard('project', 'workspace', 'card', 'target'))
      .resolves.toEqual({ status: 'scheduled', laneId: 'target' });

    expect(store.board.lanes[0].cards).toEqual([{ id: 'card', laneId: 'source' }]);
    expect(store.board.lanes[1].cards).toEqual([]);
  });
});

describe('kanban stale move responses (Issue 18)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  function threeLaneBoard() {
    return {
      lanes: [
        { id: 'source', cards: [{ id: 'card', laneId: 'source' }] },
        { id: 'target', cards: [], onEnterPrompt: 'Do the work', concurrencyLimit: 1 },
        { id: 'third', cards: [] },
      ],
    };
  }

  function deferredRoute(response) {
    let resolveRoute;
    vi.spyOn(api, 'routeWorkspaceKanbanCard')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRoute = resolve; }));
    return { respond: () => resolveRoute(response) };
  }

  it('does not overwrite newer authoritative running state with a stale queued response', async () => {
    const store = useKanbanStore();
    store.board = threeLaneBoard();
    const route = deferredRoute({ status: 'queued', laneId: 'target', queuePosition: 1 });

    const pending = store.routeWorkspaceCard('project', 'workspace', 'card', 'target');
    // The queue advances while the HTTP response is in flight: the
    // authoritative board already shows the card running.
    store.handleBoardUpdated({
      lanes: [
        { id: 'source', cards: [] },
        { id: 'target', cards: [{ id: 'card', laneId: 'target', entryState: 'running', queuePosition: null }] },
        { id: 'third', cards: [] },
      ],
    });
    route.respond();
    await pending;

    const target = store.board.lanes.find((l) => l.id === 'target');
    expect(target.cards).toHaveLength(1);
    expect(target.cards[0]).toMatchObject({ id: 'card', entryState: 'running', queuePosition: null });
  });

  it('does not restore queuePosition from a stale queued response after the card started', async () => {
    const store = useKanbanStore();
    store.board = threeLaneBoard();
    const route = deferredRoute({ status: 'queued', laneId: 'target', queuePosition: 2 });

    const pending = store.routeWorkspaceCard('project', 'workspace', 'card', 'target');
    store.handleCardMoved('card', 'source', 'target',
      { id: 'card', laneId: 'target', entryState: 'running', queuePosition: null });
    route.respond();
    await pending;

    const target = store.board.lanes.find((l) => l.id === 'target');
    expect(target.cards).toHaveLength(1);
    expect(target.cards[0].entryState).toBe('running');
    expect(target.cards[0].queuePosition).toBeNull();
  });

  it('does not write the card back to the original destination after completion-routing', async () => {
    const store = useKanbanStore();
    store.board = threeLaneBoard();
    const route = deferredRoute({ status: 'moved', laneId: 'target' });

    const pending = store.routeWorkspaceCard('project', 'workspace', 'card', 'target');
    // The card completion-routes to a third lane before the original
    // response lands; the stale response must not duplicate or return it.
    store.handleBoardUpdated({
      lanes: [
        { id: 'source', cards: [] },
        { id: 'target', cards: [] },
        { id: 'third', cards: [{ id: 'card', laneId: 'third', entryState: 'running', queuePosition: null }] },
      ],
    });
    route.respond();
    await pending;

    const target = store.board.lanes.find((l) => l.id === 'target');
    const third = store.board.lanes.find((l) => l.id === 'third');
    expect(target.cards).toEqual([]);
    expect(third.cards).toHaveLength(1);
    expect(third.cards[0]).toMatchObject({ id: 'card', laneId: 'third' });
  });

  it('still applies the HTTP fallback when the response lands before any websocket update', async () => {
    const store = useKanbanStore();
    store.board = threeLaneBoard();
    const route = deferredRoute({ status: 'queued', laneId: 'target', queuePosition: 2 });

    const pending = store.routeWorkspaceCard('project', 'workspace', 'card', 'target');
    route.respond();
    await pending;

    const target = store.board.lanes.find((l) => l.id === 'target');
    expect(target.cards).toEqual([
      { id: 'card', laneId: 'target', entryState: 'queued', queuePosition: 2 },
    ]);
  });
});

describe('kanban initiating-client entry state (Issue 12)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  function automatedBoard() {
    return {
      lanes: [
        { id: 'source', cards: [{ id: 'card', laneId: 'source' }] },
        { id: 'target', cards: [], onEnterPrompt: 'Do the work', concurrencyLimit: 1 },
      ],
    };
  }

  it('ends running with a correct count after the response and the authoritative move payload', async () => {
    const store = useKanbanStore();
    store.board = automatedBoard();
    vi.spyOn(api, 'routeWorkspaceKanbanCard')
      .mockResolvedValueOnce({ status: 'moved', laneId: 'target' });

    await store.routeWorkspaceCard('project', 'workspace', 'card', 'target');
    store.handleCardMoved('card', 'source', 'target',
      { id: 'card', laneId: 'target', entryState: 'running', queuePosition: null });

    const target = store.board.lanes.find((l) => l.id === 'target');
    expect(target.cards).toHaveLength(1);
    expect(target.cards[0]).toMatchObject({ id: 'card', entryState: 'running', queuePosition: null });
    expect(target.cards.filter((c) => c.entryState === 'running')).toHaveLength(1);
  });

  it('drops the stale queued badge when a queued card starts immediately in the target lane', async () => {
    const store = useKanbanStore();
    store.board = {
      lanes: [
        { id: 'source', cards: [{ id: 'card', laneId: 'source', entryState: 'queued', queuePosition: 1 }] },
        { id: 'target', cards: [], onEnterPrompt: 'Do the work', concurrencyLimit: 1 },
      ],
    };
    vi.spyOn(api, 'routeWorkspaceKanbanCard')
      .mockResolvedValueOnce({ status: 'moved', laneId: 'target' });

    await store.routeWorkspaceCard('project', 'workspace', 'card', 'target');
    store.handleCardMoved('card', 'source', 'target',
      { id: 'card', laneId: 'target', entryState: 'running', queuePosition: null });

    const target = store.board.lanes.find((l) => l.id === 'target');
    expect(target.cards).toHaveLength(1);
    expect(target.cards[0].entryState).toBe('running');
    expect(target.cards[0].queuePosition).toBeNull();
  });
});

describe('kanban card-create entry state (Issue 16)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  function runningCount(lane) {
    return lane.cards.filter((c) => c.entryState === 'running').length;
  }

  it('ends authoritative when the websocket add arrives after an incomplete HTTP card', async () => {
    const store = useKanbanStore();
    store.board = { lanes: [{ id: 'target', cards: [] }] };
    // Legacy HTTP payload without entry state arrives first.
    vi.spyOn(api, 'createKanbanCard').mockResolvedValueOnce({ id: 'card', laneId: 'target' });

    await store.addSessionToBoard('project', 'workspace', 'target');
    expect(store.board.lanes[0].cards).toHaveLength(1);

    // The authoritative websocket payload must upsert even though the card
    // already exists, or the header undercounts runners until a refresh.
    store.handleCardAdded(
      { id: 'card', laneId: 'target', entryState: 'running', queuePosition: null }, 'target');

    const lane = store.board.lanes[0];
    expect(lane.cards).toHaveLength(1);
    expect(lane.cards[0]).toMatchObject({ id: 'card', entryState: 'running', queuePosition: null });
    expect(runningCount(lane)).toBe(1);
  });

  it('keeps a single running card when HTTP and websocket payloads agree', async () => {
    const store = useKanbanStore();
    store.board = { lanes: [{ id: 'target', cards: [] }] };
    vi.spyOn(api, 'createKanbanCard')
      .mockResolvedValueOnce({ id: 'card', laneId: 'target', entryState: 'running', queuePosition: null });

    await store.addSessionToBoard('project', 'workspace', 'target');
    store.handleCardAdded(
      { id: 'card', laneId: 'target', entryState: 'running', queuePosition: null }, 'target');

    const lane = store.board.lanes[0];
    expect(lane.cards).toHaveLength(1);
    expect(lane.cards[0]).toMatchObject({ entryState: 'running', queuePosition: null });
    expect(runningCount(lane)).toBe(1);
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

describe('kanban lane updates', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('passes concurrencyLimit through updateLane', async () => {
    const store = useKanbanStore();
    vi.spyOn(api, 'updateKanbanLane').mockResolvedValueOnce({ id: 'lane', concurrencyLimit: 2 });

    await store.updateLane('project', 'lane', { name: 'Limited', concurrencyLimit: 2 });

    expect(api.updateKanbanLane).toHaveBeenCalledWith('project', 'lane', { name: 'Limited', concurrencyLimit: 2 });
  });
});
