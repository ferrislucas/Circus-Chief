import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock external dependencies (mirrors kanbanService.test.js so delivery paths run)
vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
  broadcastToSession: vi.fn(),
}));

vi.mock('./templateTriggerService.js', () => ({
  renderTemplatePrompt: vi.fn().mockResolvedValue('rendered prompt'),
  getRootSession: vi.fn((session) => session),
}));

vi.mock('./gitSessionSetup.js', () => ({
  setupGitForSession: vi.fn().mockResolvedValue({
    workingDirectory: '/tmp/test',
    gitWorktree: null,
  }),
}));

vi.mock('./sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./sessionProvider.js', () => ({
  resolveAgentTypeFromModel: vi.fn().mockReturnValue('codex'),
  resolveProviderMetadataFromModel: vi.fn().mockReturnValue({
    kind: 'openai', authToken: 'test-key', commitAttributionOverride: null,
    supportsIdempotentDispatch: true,
  }),
}));

vi.mock('./gitService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, removeWorktree: vi.fn((...args) => actual.removeWorktree(...args)) };
});

import {
  kanbanBoards,
  kanbanLanes,
  kanbanCards,
  projects,
  sessions,
  databaseManager,
} from '../database.js';
import {
  addSessionToBoard,
  moveCard,
  routeWorkspaceCard,
  drainLaneAndDeliver,
  drainLaneEntryTrigger,
  updateLaneWithAutomationToggle,
  getFullBoard,
} from './kanbanService.js';
import { drainLimitedLaneQueues } from './kanbanConcurrency.js';
import {
  createLaneRunForEntry,
  attachRootSession,
  beginWorkflowTurn,
  finalizeOwnWorkCompletion,
  getRun,
} from './workflowSessionService.js';
import { allMigrations } from '../db/migrations/index.js';
import { kanbanMigrations } from '../db/migrations/kanbanMigrations.js';

/**
 * Disabled x limited lane integration (Issue 25): a lane that is BOTH
 * automation-disabled AND over its concurrency limit must hold arrivals in
 * the disabled queue (kanban_lane_entry_events status='queued'); the
 * concurrency limit applies when those entries replay on re-enable.
 */
describe('disabled x limited lane integration (Issue 25)', () => {
  let projectId;
  let lanes;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.USE_CODEX_DIRECT_API = '1';

    const project = projects.create('Test Project', '/tmp/test');
    projectId = project.id;

    const board = kanbanBoards.create(projectId);
    lanes = kanbanLanes.getByBoardId(board.id);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createSession(name = 'Test Session') {
    return sessions.create(projectId, name, 'Prompt');
  }

  function createChildSession(parentId, name = 'Child Session') {
    return sessions.create(projectId, name, 'Child Prompt', {
      mode: 'standard',
      parentSessionId: parentId,
    });
  }

  /** Limited automated lane filled to its limit with open runs. */
  async function fillLimitedLane(laneId, limit = 1) {
    kanbanLanes.update(laneId, { onEnterPrompt: 'Do the work', concurrencyLimit: limit });
    const runners = [];
    for (let i = 0; i < limit; i += 1) {
      const runner = createSession(`Runner ${i}`);
      await addSessionToBoard(runner.id, laneId);
      runners.push(runner);
    }
    return runners;
  }

  function disableLane(laneId) {
    return updateLaneWithAutomationToggle(laneId, { automationEnabled: false });
  }

  function queuedEvents(laneId) {
    return databaseManager.get().prepare(`SELECT * FROM kanban_lane_entry_events
      WHERE lane_id=? AND status='queued' ORDER BY created_at, rowid`).all(laneId);
  }

  function openRuns(laneId) {
    return databaseManager.get().prepare(`SELECT r.id FROM kanban_lane_runs r
      JOIN kanban_cards c ON c.active_lane_run_id = r.id
      WHERE c.lane_id=? AND r.status='open'`).all(laneId);
  }

  function cardRow(cardId) {
    return databaseManager.get().prepare('SELECT * FROM kanban_cards WHERE id=?').get(cardId);
  }

  describe('queue ownership: disabled wins over the limit', () => {
    it('moveCard into a disabled full lane queues in the disabled queue, not the limit marker', async () => {
      await fillLimitedLane(lanes[1].id, 1);
      disableLane(lanes[1].id);
      const other = createSession('Other');
      await addSessionToBoard(other.id, lanes[0].id);

      const otherCard = kanbanCards.getBySessionId(other.id);
      await moveCard(otherCard.id, lanes[1].id);

      const moved = cardRow(otherCard.id);
      expect(moved.lane_id).toBe(lanes[1].id);
      expect(moved.active_lane_run_id).toBeNull();
      // Disabled queue owns it: an entry event, not the limit marker.
      expect(moved.entry_queued).toBe(0);
      const events = databaseManager.get().prepare(
        "SELECT * FROM kanban_lane_entry_events WHERE card_id=? AND status='queued'",
      ).all(otherCard.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ lane_id: lanes[1].id, cause: 'manual_move' });
    });

    it('moving a limit-marked card into a disabled lane clears the carried marker', async () => {
      // Marker in the source lane first (limit 1, runner holds the slot).
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the work', concurrencyLimit: 1 });
      const runner = createSession('Runner');
      await addSessionToBoard(runner.id, lanes[0].id);
      const markedSession = createSession('Marked');
      await addSessionToBoard(markedSession.id, lanes[0].id);
      const markedCard = kanbanCards.getBySessionId(markedSession.id);
      expect(cardRow(markedCard.id).entry_queued).toBe(1);
      // Destination: automated but disabled (limit irrelevant while disabled).
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Other work', concurrencyLimit: 1 });
      disableLane(lanes[1].id);

      await moveCard(markedCard.id, lanes[1].id);

      // Exactly one queue identity: the disabled entry, marker cleared.
      const moved = cardRow(markedCard.id);
      expect(moved.lane_id).toBe(lanes[1].id);
      expect(moved.entry_queued).toBe(0);
      expect(moved.lane_entry_event_id).not.toBeNull();
      const status = databaseManager.get().prepare(
        'SELECT status FROM kanban_lane_entry_events WHERE id=?',
      ).get(moved.lane_entry_event_id).status;
      expect(status).toBe('queued');
    });

    it('addSessionToBoard into a disabled full lane queues in the disabled queue', async () => {
      await fillLimitedLane(lanes[0].id, 1);
      disableLane(lanes[0].id);
      const newcomer = createSession('Newcomer');

      await addSessionToBoard(newcomer.id, lanes[0].id);

      const card = kanbanCards.getBySessionId(newcomer.id);
      expect(cardRow(card.id).entry_queued).toBe(0);
      const events = databaseManager.get().prepare(
        "SELECT * FROM kanban_lane_entry_events WHERE card_id=? AND status='queued'",
      ).all(card.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ lane_id: lanes[0].id, cause: 'card_added' });
    });

    it('manual routeWorkspaceCard into a disabled full lane reports the disabled queue state', async () => {
      await fillLimitedLane(lanes[1].id, 1);
      disableLane(lanes[1].id);
      const other = createSession('Other');
      await addSessionToBoard(other.id, lanes[0].id);

      const response = await routeWorkspaceCard(other.id, lanes[1].id, { manualMove: true });

      expect(response.status).toBe('moved');
      const board = getFullBoard(projectId);
      const lane = board.lanes.find((l) => l.id === lanes[1].id);
      const card = lane.cards.find((c) => c.sessions[0]?.id === other.id);
      // The server queued for disabled automation: never a running derivation.
      expect(card.entryStatus).toBe('queued');
      expect(card.entryState).toBeUndefined();
    });

    it('completion routing into a disabled full lane queues the handoff without the limit marker', async () => {
      // Target lane: automated, limited, full, then disabled.
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Target work', concurrencyLimit: 1 });
      const targetRunner = createSession('Target runner');
      const targetCard = kanbanCards.create(lanes[1].id, targetRunner.id);
      createLaneRunForEntry({
        projectId, workspaceId: targetRunner.id, cardId: targetCard.id,
        lane: kanbanLanes.getById(lanes[1].id),
      });
      disableLane(lanes[1].id);
      // Source lane completes into the disabled full target.
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Source work', completionTargetLaneId: lanes[1].id });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id,
        lane: { ...kanbanLanes.getById(lanes[0].id), completionTargetLaneId: lanes[1].id },
      });
      const worker = createChildSession(root.id, 'Worker');
      attachRootSession(run.id, worker.id);

      finalizeOwnWorkCompletion(worker.id, beginWorkflowTurn(worker.id));

      expect(getRun(run.id).status).toBe('succeeded');
      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[1].id);
      const queued = databaseManager.get().prepare(
        "SELECT * FROM kanban_lane_entry_events WHERE card_id=? AND cause='completion'",
      ).get(card.id);
      expect(queued).toMatchObject({ status: 'queued', lane_id: lanes[1].id });
      expect(cardRow(card.id).entry_queued).toBe(0);
      // The target's single slot is still the pre-existing runner's.
      expect(openRuns(lanes[1].id)).toHaveLength(1);
    });
  });

  describe('drain gating on isAutomationActive', () => {
    it('a queued marker in a disabled limited lane stays queued after a drain', async () => {
      // Limit 2 with one open run: a free slot exists, so only the disabled
      // gate may hold the drain back.
      const [, leavingRunner] = await fillLimitedLane(lanes[0].id, 2);
      const leavingCard = kanbanCards.getBySessionId(leavingRunner.id);
      // Free a slot so capacity cannot explain a no-op drain.
      databaseManager.get().prepare("UPDATE kanban_lane_runs SET status='superseded' WHERE card_id=?")
        .run(leavingCard.id);
      const markerSession = createSession('Marker');
      const markerCard = kanbanCards.create(lanes[0].id, markerSession.id);
      databaseManager.get().prepare('UPDATE kanban_cards SET entry_queued=1 WHERE id=?')
        .run(markerCard.id);
      expect(openRuns(lanes[0].id)).toHaveLength(1);
      disableLane(lanes[0].id);

      const created = drainLaneAndDeliver(lanes[0].id);

      expect(created).toEqual([]);
      expect(openRuns(lanes[0].id)).toHaveLength(1);
      expect(cardRow(markerCard.id).entry_queued).toBe(1);
    });

    it('startup recovery leaves markers in disabled limited lanes untouched', () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the work', concurrencyLimit: 2 });
      const runner = createSession('Runner');
      const runnerCard = kanbanCards.create(lanes[0].id, runner.id);
      createLaneRunForEntry({
        projectId, workspaceId: runner.id, cardId: runnerCard.id,
        lane: kanbanLanes.getById(lanes[0].id),
      });
      const queuedSession = createSession('Queued');
      const queuedCard = kanbanCards.create(lanes[0].id, queuedSession.id);
      databaseManager.get().prepare('UPDATE kanban_cards SET entry_queued=1 WHERE id=?')
        .run(queuedCard.id);
      // One free slot: only the disabled gate may hold recovery back.
      disableLane(lanes[0].id);

      drainLimitedLaneQueues(databaseManager.get());

      expect(openRuns(lanes[0].id)).toHaveLength(1);
      expect(cardRow(queuedCard.id).entry_queued).toBe(1);
    });
  });

  describe('re-enable replay respects the concurrency limit', () => {
    it('starts only up to the free slots and hands the excess to the limit queue in arrival order', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the work', concurrencyLimit: 2 });
      const runner = createSession('Runner');
      await addSessionToBoard(runner.id, lanes[0].id);
      disableLane(lanes[0].id);
      // Three arrivals while disabled (limit would allow one more).
      const arrivals = [];
      for (const name of ['Arrive A', 'Arrive B', 'Arrive C']) {
        const s = createSession(name);
        await addSessionToBoard(s.id, lanes[0].id);
        arrivals.push(s);
      }
      expect(queuedEvents(lanes[0].id)).toHaveLength(3);

      const toggle = updateLaneWithAutomationToggle(lanes[0].id, { automationEnabled: true });
      expect(toggle.eventIds).toHaveLength(3);
      for (const eventId of toggle.eventIds) {
        await drainLaneEntryTrigger(eventId);
      }

      // One free slot: exactly one arrival starts.
      expect(openRuns(lanes[0].id)).toHaveLength(2);
      const cards = arrivals.map((s) => ({ session: s, row: cardRow(kanbanCards.getBySessionId(s.id).id) }));
      // FIFO: the first arrival runs; the rest wait as limit markers in order.
      expect(cards[0].row.active_lane_run_id).not.toBeNull();
      expect(cards[0].row.entry_queued).toBe(0);
      expect(cards[1].row.entry_queued).toBe(1);
      expect(cards[2].row.entry_queued).toBe(1);
      const deferredOrder = databaseManager.get().prepare(`SELECT id FROM kanban_cards
        WHERE lane_id=? AND entry_queued=1 ORDER BY sort_order, created_at, id`).all(lanes[0].id)
        .map((row) => row.id);
      expect(deferredOrder).toEqual([cards[1].row.id, cards[2].row.id]);
    });
  });

  describe('board visibility of the two queue shapes', () => {
    it('a disabled-queue card reads entryStatus queued, never running', async () => {
      await fillLimitedLane(lanes[1].id, 1);
      disableLane(lanes[1].id);
      const other = createSession('Other');
      await addSessionToBoard(other.id, lanes[0].id);
      const otherCard = kanbanCards.getBySessionId(other.id);
      await moveCard(otherCard.id, lanes[1].id);

      const board = getFullBoard(projectId);
      const lane = board.lanes.find((l) => l.id === lanes[1].id);
      const card = lane.cards.find((c) => c.id === otherCard.id);
      expect(card.entryStatus).toBe('queued');
      expect(card.entryState).toBeUndefined();
    });
  });

  describe('migration registration for the integration', () => {
    it('registers every declared kanban migration, including the automation kill-switch', () => {
      const registered = new Set(allMigrations.map(({ name }) => name));
      for (const { name } of kanbanMigrations) {
        expect(registered.has(name)).toBe(true);
      }
      expect(registered.has('kanban_lanes-add-automation_enabled')).toBe(true);
    });
  });
});
