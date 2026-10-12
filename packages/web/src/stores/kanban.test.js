import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useKanbanStore } from './kanban.js';
import { mergeBroadcastCard } from './kanbanWebSocketActions.js';
import { api } from '../composables/useApi.js';

describe('mergeBroadcastCard', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('fills enrichment absent from the broadcast for sessions matched by ID', () => {
    const existing = {
      id: 'card-1', laneId: 'live',
      sessions: [{ id: 's-1', name: 'S', pendingAgentInput: true, latestCommandRuns: [{ buttonId: 'lint' }] }],
    };
    const broadcast = { id: 'card-1', laneId: 'live', sessions: [{ id: 's-1', name: 'S', status: 'running' }] };

    const merged = mergeBroadcastCard(existing, broadcast);

    expect(merged.sessions[0]).toMatchObject({ id: 's-1', status: 'running', pendingAgentInput: true });
    expect(merged.sessions[0].latestCommandRuns).toEqual([{ buttonId: 'lint' }]);
  });

  it('takes a broadcast session as-is when there is no local match', () => {
    const existing = { id: 'card-1', laneId: 'live', sessions: [{ id: 's-9', pendingAgentInput: true }] };
    const broadcast = { id: 'card-1', laneId: 'live', sessions: [{ id: 's-1', name: 'S' }] };

    expect(mergeBroadcastCard(existing, broadcast).sessions).toEqual([{ id: 's-1', name: 'S' }]);
  });

  it('prefers the broadcast value when it supplies an enrichment field', () => {
    const existing = { id: 'card-1', laneId: 'live', sessions: [{ id: 's-1', pendingAgentInput: true }] };
    const broadcast = { id: 'card-1', laneId: 'live', sessions: [{ id: 's-1', pendingAgentInput: false }] };

    expect(mergeBroadcastCard(existing, broadcast).sessions[0].pendingAgentInput).toBe(false);
  });

  it('does not copy un-allowlisted local fields onto the merged session', () => {
    const existing = { id: 'card-1', laneId: 'live', sessions: [{ id: 's-1', someFutureLocalField: 'x' }] };
    const broadcast = { id: 'card-1', laneId: 'live', sessions: [{ id: 's-1' }] };

    expect(mergeBroadcastCard(existing, broadcast).sessions[0]).not.toHaveProperty('someFutureLocalField');
  });

  it('sets entryStatus from the broadcast and clears a stale local marker when absent', () => {
    expect(mergeBroadcastCard({ id: 'c' }, { id: 'c', entryStatus: 'queued' }).entryStatus).toBe('queued');
    expect(mergeBroadcastCard({ id: 'c', entryStatus: 'queued' }, { id: 'c' })).not.toHaveProperty('entryStatus');
  });

  it('never carries the existing activeLaneRun when the broadcast omits it', () => {
    const merged = mergeBroadcastCard(
      { id: 'c', activeLaneRun: { id: 'run', laneId: 'paused' } },
      { id: 'c', laneId: 'live' },
    );

    expect(merged).not.toHaveProperty('activeLaneRun');
  });
});

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

  it('marks a card queued (not running) when the route lands in a disabled automated lane', async () => {
    // Issue 25: the server queues entries of disabled lanes, so the
    // initiating browser must not derive a running state from lane fields.
    const store = useKanbanStore();
    store.board = {
      lanes: [
        { id: 'live', name: 'Live', automationEnabled: true, cards: [{ id: 'card-1', laneId: 'live' }] },
        {
          id: 'paused', name: 'Paused', automationEnabled: false,
          onEnterPrompt: 'Do the work', queuedCount: 0, cards: [],
        },
      ],
    };
    vi.spyOn(api, 'routeWorkspaceKanbanCard').mockResolvedValueOnce({ status: 'moved', laneId: 'paused' });

    await store.routeWorkspaceCard('project', 'workspace', 'card-1', 'paused');

    expect(store.board.lanes[1].cards).toHaveLength(1);
    expect(store.board.lanes[1].cards[0]).toMatchObject({ id: 'card-1', entryStatus: 'queued' });
    expect(store.board.lanes[1].cards[0]).not.toHaveProperty('entryState');
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

describe('kanban optimistic move enrichment', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  function enrichedQueuedBoard() {
    return {
      lanes: [
        {
          id: 'paused', name: 'Paused', automationEnabled: false, queuedCount: 1,
          cards: [{
            id: 'card-1',
            laneId: 'paused',
            entryStatus: 'queued',
            sessions: [{
              id: 's-1', name: 'Session', status: 'running',
              pendingAgentInput: true,
              latestCommandRuns: [{ buttonId: 'lint', runId: 'run-1', status: 'running', exitCode: null }],
            }],
            activeLaneRun: { id: 'run-1', laneId: 'paused', status: 'open' },
          }],
        },
        { id: 'live', name: 'Live', automationEnabled: true, queuedCount: 0, cards: [] },
      ],
    };
  }

  // Thin repository projection carried by the KANBAN_CARD_MOVED broadcast:
  // basic session fields only, no board enrichment, no queue marker.
  function thinBroadcastCard() {
    return { id: 'card-1', laneId: 'live', sessions: [{ id: 's-1', name: 'Session', status: 'running' }] };
  }

  async function optimisticMoveThenAcknowledge(store, broadcastCard) {
    vi.spyOn(api, 'routeWorkspaceKanbanCard').mockResolvedValueOnce({ status: 'moved', laneId: 'live' });
    const routed = store.routeWorkspaceCard('project', 'workspace', 'card-1', 'live');
    store.handleCardMoved('card-1', 'paused', 'live', broadcastCard);
    await routed;
    return store.board.lanes[1].cards[0];
  }

  it('preserves the needs-input badge when the broadcast acknowledgement arrives', async () => {
    const store = useKanbanStore();
    store.board = enrichedQueuedBoard();

    const card = await optimisticMoveThenAcknowledge(store, thinBroadcastCard());

    expect(card.sessions[0].pendingAgentInput).toBe(true);
  });

  it('preserves command statuses through the board-data fallback path', async () => {
    const store = useKanbanStore();
    store.board = enrichedQueuedBoard();

    const card = await optimisticMoveThenAcknowledge(store, thinBroadcastCard());

    expect(card.sessions[0].latestCommandRuns).toEqual(
      [{ buttonId: 'lint', runId: 'run-1', status: 'running', exitCode: null }],
    );
  });

  it('clears the stale queued marker while preserving session enrichment', async () => {
    const store = useKanbanStore();
    store.board = enrichedQueuedBoard();

    const card = await optimisticMoveThenAcknowledge(store, thinBroadcastCard());

    expect(card).not.toHaveProperty('entryStatus');
    expect(card.sessions[0].pendingAgentInput).toBe(true);
    expect(card.sessions[0].latestCommandRuns).toHaveLength(1);
  });

  it('does not retain the source lane activeLaneRun on a cross-lane move', async () => {
    const store = useKanbanStore();
    store.board = enrichedQueuedBoard();

    const card = await optimisticMoveThenAcknowledge(store, thinBroadcastCard());

    expect(card).not.toHaveProperty('activeLaneRun');
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
