import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock external dependencies (mirrors kanbanService.test.js)
vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
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
  getFullBoard,
  routeWorkspaceCard,
} from './kanbanService.js';
import {
  countOpenLaneRuns,
  drainLaneQueue,
  getQueuedCardIds,
} from './kanbanConcurrency.js';
import {
  closeOwnWork,
  attachRootSession,
  createLaneRunForEntry,
  finalizeOwnWorkCompletion,
  getRun,
  releaseLaneSlotForUserStop,
} from './workflowSessionService.js';
import { reconcileKanbanOwnership } from './kanbanRecoveryService.js';

const flushDrains = () => new Promise((resolve) => setImmediate(resolve));

function openRunIdsForCard(cardId) {
  return databaseManager.get()
    .prepare("SELECT id FROM kanban_lane_runs WHERE card_id=? AND status='open'")
    .all(cardId);
}

describe('kanban lane concurrency limits', () => {
  let projectId;
  let lanes;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.USE_CODEX_DIRECT_API = '1';

    const project = projects.create('Test Project', '/tmp/test');
    projectId = project.id;

    const board = kanbanBoards.create(projectId);
    const boardId = board.id;
    lanes = kanbanLanes.getByBoardId(boardId);
    kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the work', concurrencyLimit: 1 });
    lanes = kanbanLanes.getByBoardId(boardId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createSession(name = 'Test Session') {
    return sessions.create(projectId, name, 'Prompt');
  }

  function laneRow() {
    return kanbanLanes.getById(lanes[0].id);
  }

  /**
   * Running fixture without detached delivery: card + open run directly, so
   * no background automation can attach a root first and race the test.
   */
  function setupRunningCard(name, laneId = lanes[0].id) {
    const root = createSession(name);
    const card = kanbanCards.create(laneId, root.id);
    const run = createLaneRunForEntry({ projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(laneId) });
    return { root, card, run };
  }

  function attachWorker(run, root) {
    const worker = sessions.create(projectId, `${root.name} worker`, 'Child Prompt', {
      mode: 'standard', parentSessionId: root.id,
    });
    attachRootSession(run.id, worker.id);
    return worker;
  }

  function cardRow(cardId) {
    return databaseManager.get().prepare('SELECT * FROM kanban_cards WHERE id=?').get(cardId);
  }

  describe('entry gating', () => {
    it('queues entries over a full limit: no run row, no event, queued position', async () => {
      const first = await addSessionToBoard(createSession('First').id, lanes[0].id);
      const second = await addSessionToBoard(createSession('Second').id, lanes[0].id);

      expect(openRunIdsForCard(first.id)).toHaveLength(1);
      expect(openRunIdsForCard(second.id)).toHaveLength(0);
      expect(cardRow(second.id).active_lane_run_id).toBeNull();
      const events = databaseManager.get()
        .prepare('SELECT id FROM kanban_lane_entry_events WHERE card_id=?')
        .all(second.id);
      expect(events).toHaveLength(0);
      expect(second.entryState).toBe('queued');
      expect(second.queuePosition).toBe(1);
    });

    it('leaves unlimited lanes unchanged', async () => {
      kanbanLanes.update(lanes[0].id, { concurrencyLimit: null });
      const first = await addSessionToBoard(createSession('First').id, lanes[0].id);
      const second = await addSessionToBoard(createSession('Second').id, lanes[0].id);

      expect(openRunIdsForCard(first.id)).toHaveLength(1);
      expect(openRunIdsForCard(second.id)).toHaveLength(1);
      expect(second.entryState).toBeUndefined();
    });

    it('route into a full lane returns a queued outcome with position', async () => {
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Do the work', concurrencyLimit: 1 });
      const runner = createSession('Runner');
      await addSessionToBoard(runner.id, lanes[1].id);
      const other = createSession('Other');
      await addSessionToBoard(other.id, lanes[0].id);

      const response = await routeWorkspaceCard(other.id, lanes[1].id, { manualMove: true });

      expect(response.status).toBe('queued');
      expect(response.laneId).toBe(lanes[1].id);
      expect(response.queuePosition).toBe(1);
      const card = kanbanCards.getBySessionId(other.id);
      expect(openRunIdsForCard(card.id)).toHaveLength(0);
    });
  });

  describe('grandfathering (FR-3)', () => {
    it('keeps pre-existing open runs when the limit drops below the running count', async () => {
      kanbanLanes.update(lanes[0].id, { concurrencyLimit: null });
      const cards = [];
      for (let i = 0; i < 3; i += 1) {
        cards.push(await addSessionToBoard(createSession(`Runner ${i}`).id, lanes[0].id));
      }
      kanbanLanes.update(lanes[0].id, { concurrencyLimit: 1 });

      expect(countOpenLaneRuns(databaseManager.get(), lanes[0].id)).toBe(3);
      const late = await addSessionToBoard(createSession('Late').id, lanes[0].id);
      expect(late.entryState).toBe('queued');
      expect(openRunIdsForCard(late.id)).toHaveLength(0);
    });
  });

  describe('drain', () => {
    it('starts the topmost queued card when a card leaves the lane, in lane order', async () => {
      const { root: firstRoot } = setupRunningCard('First');
      const second = await addSessionToBoard(createSession('Second').id, lanes[0].id);
      const third = await addSessionToBoard(createSession('Third').id, lanes[0].id);
      expect(second.entryState).toBe('queued');

      await routeWorkspaceCard(firstRoot.id, lanes[1].id, { manualMove: true });
      await flushDrains();

      expect(openRunIdsForCard(second.id)).toHaveLength(1);
      expect(openRunIdsForCard(third.id)).toHaveLength(0);
      expect(getQueuedCardIds(databaseManager.get(), lanes[0].id)).toEqual([third.id]);
    });

    it('drains the queue when the runner succeeds without a completion target', async () => {
      const { root, run } = setupRunningCard('Runner');
      const worker = attachWorker(run, root);
      const queued = await addSessionToBoard(createSession('Queued').id, lanes[0].id);
      expect(queued.entryState).toBe('queued');

      finalizeOwnWorkCompletion(worker.id, {});
      await flushDrains();

      expect(getRun(run.id).status).toBe('succeeded');
      expect(countOpenLaneRuns(databaseManager.get(), lanes[0].id)).toBe(1);
      expect(openRunIdsForCard(queued.id)).toHaveLength(1);
    });

    it('releases the lane slot when the runner is explicitly stopped by the user', async () => {
      const { root, run } = setupRunningCard('Runner');
      const worker = attachWorker(run, root);
      const queued = await addSessionToBoard(createSession('Queued').id, lanes[0].id);
      expect(queued.entryState).toBe('queued');

      const released = releaseLaneSlotForUserStop(worker.id);
      await flushDrains();

      expect(released?.status).toBe('cancelled');
      expect(getRun(run.id).status).toBe('cancelled');
      expect(countOpenLaneRuns(databaseManager.get(), lanes[0].id)).toBe(1);
      expect(openRunIdsForCard(queued.id)).toHaveLength(1);
    });

    it('keeps the resumable pause with no release in unlimited lanes', async () => {
      kanbanLanes.update(lanes[0].id, { concurrencyLimit: null });
      const { root, run } = setupRunningCard('Runner');
      const worker = attachWorker(run, root);

      expect(releaseLaneSlotForUserStop(worker.id)).toBeNull();
      expect(getRun(run.id).status).toBe('open');
    });

    it('releases nothing for a non-participating session', () => {
      expect(releaseLaneSlotForUserStop(createSession('Plain').id)).toBeNull();
    });

    it('drains after a terminal failure, skipping the failed card itself', async () => {
      const { root, run } = setupRunningCard('Root');
      const worker = attachWorker(run, root);
      const queued = await addSessionToBoard(createSession('Queued').id, lanes[0].id);

      closeOwnWork(worker.id, 'closed_failed', 'boom');
      await flushDrains();

      // Failed card keeps its terminal run attached: it is finished, not queued.
      const card = kanbanCards.getBySessionId(root.id);
      expect(cardRow(card.id).active_lane_run_id).not.toBeNull();
      expect(openRunIdsForCard(queued.id)).toHaveLength(1);
    });

    it('starts each queued card exactly once under concurrent releases', async () => {
      kanbanLanes.update(lanes[0].id, { concurrencyLimit: 2 });
      const { root: firstRoot } = setupRunningCard('First');
      const { root: fillerRoot } = setupRunningCard('Filler');
      kanbanLanes.update(lanes[0].id, { concurrencyLimit: 1 });
      // Limit 1 with two open runs: both grandfathered; the next arrival queues.
      const queued = await addSessionToBoard(createSession('Queued').id, lanes[0].id);
      expect(queued.entryState).toBe('queued');

      await routeWorkspaceCard(firstRoot.id, lanes[1].id, { manualMove: true });
      await routeWorkspaceCard(fillerRoot.id, lanes[1].id, { manualMove: true });
      await flushDrains();

      const runs = openRunIdsForCard(queued.id);
      expect(runs).toHaveLength(1);
    });

    it('skips a failed deferred start and continues the drain', async () => {
      const { root: firstRoot } = setupRunningCard('First');
      const doomedSession = createSession('Doomed');
      const doomed = await addSessionToBoard(doomedSession.id, lanes[0].id);
      const next = await addSessionToBoard(createSession('Next').id, lanes[0].id);
      // Orphan the queued card: its session is gone, so no owner can start it.
      sessions.delete(doomedSession.id);

      await routeWorkspaceCard(firstRoot.id, lanes[1].id, { manualMove: true });
      await flushDrains();

      expect(cardRow(doomed.id).active_lane_run_id).toBeNull();
      expect(openRunIdsForCard(next.id)).toHaveLength(1);
    });

    it('removes a queued card from the queue when it moves out', async () => {
      await addSessionToBoard(createSession('First').id, lanes[0].id);
      const queuedSession = createSession('Queued');
      const queued = await addSessionToBoard(queuedSession.id, lanes[0].id);
      expect(queued.entryState).toBe('queued');

      const response = await routeWorkspaceCard(queuedSession.id, lanes[1].id, { manualMove: true });

      expect(response.status).toBe('moved');
      expect(getQueuedCardIds(databaseManager.get(), lanes[0].id)).toEqual([]);
    });

    it('re-prioritizes the queue on reorder', async () => {
      const { root: runnerRoot, card: runnerCard } = setupRunningCard('First');
      const second = await addSessionToBoard(createSession('Second').id, lanes[0].id);
      const third = await addSessionToBoard(createSession('Third').id, lanes[0].id);
      // Move third to the top of the queue; it must start next.
      kanbanCards.reorder(lanes[0].id, [runnerCard.id, third.id, second.id]);

      await routeWorkspaceCard(runnerRoot.id, lanes[1].id, { manualMove: true });
      await flushDrains();

      expect(openRunIdsForCard(third.id)).toHaveLength(1);
      expect(openRunIdsForCard(second.id)).toHaveLength(0);
    });

    it('drains synchronously on limit raise so the next read reflects it', async () => {
      await addSessionToBoard(createSession('First').id, lanes[0].id);
      const second = await addSessionToBoard(createSession('Second').id, lanes[0].id);
      expect(second.entryState).toBe('queued');

      kanbanLanes.update(lanes[0].id, { concurrencyLimit: 2 });
      const created = drainLaneQueue(lanes[0].id);

      expect(created).toHaveLength(1);
      expect(openRunIdsForCard(second.id)).toHaveLength(1);
    });

    it('counts open runs without roots (reschedule-wait holds its slot)', async () => {
      const first = await addSessionToBoard(createSession('First').id, lanes[0].id);
      expect(openRunIdsForCard(first.id)).toHaveLength(1);
      expect(countOpenLaneRuns(databaseManager.get(), lanes[0].id)).toBe(1);

      const second = await addSessionToBoard(createSession('Second').id, lanes[0].id);
      expect(second.entryState).toBe('queued');
    });
  });

  describe('board presentation', () => {
    it('exposes running/queued entryState with positions on the full board', async () => {
      const first = await addSessionToBoard(createSession('First').id, lanes[0].id);
      const second = await addSessionToBoard(createSession('Second').id, lanes[0].id);

      const board = getFullBoard(projectId);
      const lane = board.lanes.find((l) => l.id === lanes[0].id);
      expect(lane.concurrencyLimit).toBe(1);
      const byId = Object.fromEntries(lane.cards.map((c) => [c.id, c]));
      expect(byId[first.id].entryState).toBe('running');
      expect(byId[first.id].queuePosition).toBeNull();
      expect(byId[second.id].entryState).toBe('queued');
      expect(byId[second.id].queuePosition).toBe(1);
    });
  });

  describe('recovery', () => {
    it('keeps the queue gated across restart and drains on limit raise', async () => {
      const { root, run } = setupRunningCard('Root');
      attachWorker(run, root);
      const card = kanbanCards.getBySessionId(root.id);
      const queued = await addSessionToBoard(createSession('Queued').id, lanes[0].id);
      expect(queued.entryState).toBe('queued');

      const recovery = reconcileKanbanOwnership({ dryRun: false });

      // Valid open run survives; the queue stays gated at limit 1.
      expect(openRunIdsForCard(card.id)).toHaveLength(1);
      expect(openRunIdsForCard(queued.id)).toHaveLength(0);
      expect(recovery.changes.some((c) => c.type === 'drained_lane_queues')).toBe(false);

      kanbanLanes.update(lanes[0].id, { concurrencyLimit: 2 });
      const recovery2 = reconcileKanbanOwnership({ dryRun: false });
      expect(openRunIdsForCard(queued.id)).toHaveLength(1);
      expect(recovery2.changes.some((c) => c.type === 'drained_lane_queues')).toBe(true);
    });

    it('queues completion routing into a full lane and drains the source', async () => {
      kanbanLanes.update(lanes[0].id, { completionTargetLaneId: lanes[1].id });
      kanbanLanes.update(lanes[1].id, { onEnterPrompt: 'Finish it', concurrencyLimit: 1 });
      const { root: targetRoot, run: targetRun } = setupRunningCard('Target runner', lanes[1].id);
      attachWorker(targetRun, targetRoot);
      const { root: sourceRoot, run: sourceRun } = setupRunningCard('Source runner');
      const sourceWorker = attachWorker(sourceRun, sourceRoot);
      const waiting = await addSessionToBoard(createSession('Waiting').id, lanes[0].id);
      expect(waiting.entryState).toBe('queued');

      // The source worker succeeding routes its card into the full target
      // lane: the card queues there while the source slot drains to Waiting.
      finalizeOwnWorkCompletion(sourceWorker.id, {});
      await flushDrains();

      const movedCard = kanbanCards.getBySessionId(sourceRoot.id);
      expect(movedCard.laneId).toBe(lanes[1].id);
      expect(openRunIdsForCard(movedCard.id)).toHaveLength(0);
      expect(openRunIdsForCard(waiting.id)).toHaveLength(1);
    });
  });

  describe('lane helpers', () => {
    it('laneRow reflects the configured limit', () => {
      expect(laneRow().concurrencyLimit).toBe(1);
    });
  });

  describe('pending-entry identity (FR-3/FR-6)', () => {
    it('does not treat a succeeded run with a cleared pointer as queued', async () => {
      const { root, card, run } = setupRunningCard('Finisher');
      const worker = attachWorker(run, root);

      finalizeOwnWorkCompletion(worker.id, {});
      await flushDrains();

      expect(cardRow(card.id).active_lane_run_id).toBeNull();
      expect(getQueuedCardIds(databaseManager.get(), lanes[0].id)).not.toContain(card.id);
      expect(drainLaneQueue(lanes[0].id)).toEqual([]);
      expect(openRunIdsForCard(card.id)).toHaveLength(0);
    });

    it('does not restart a terminally failed run cleared by recovery', async () => {
      const { root, run } = setupRunningCard('Doomed runner');
      const worker = attachWorker(run, root);
      const queuedRoot = createSession('Queued');
      const queued = await addSessionToBoard(queuedRoot.id, lanes[0].id);
      expect(queued.entryState).toBe('queued');

      closeOwnWork(worker.id, 'closed_failed', 'boom');
      await flushDrains();
      const failedCard = kanbanCards.getBySessionId(root.id);
      // The drained card is now genuinely running: attach its worker so
      // recovery preserves the unambiguous run (as production delivery would).
      const queuedRunId = openRunIdsForCard(queued.id)[0]?.id;
      expect(queuedRunId).toBeTruthy();
      attachWorker({ id: queuedRunId }, queuedRoot);

      reconcileKanbanOwnership({ dryRun: false });
      await flushDrains();

      // Recovery cleared the stale pointer, but the finished card must not
      // read as queued and must never gain a fresh run.
      expect(getQueuedCardIds(databaseManager.get(), lanes[0].id)).not.toContain(failedCard.id);
      expect(openRunIdsForCard(failedCard.id)).toHaveLength(0);
      // The genuinely queued card still drains exactly once.
      expect(openRunIdsForCard(queued.id)).toHaveLength(1);
    });

    it('never treats an intentionally unautomated entry as queued', async () => {
      const card = await addSessionToBoard(createSession('Manual').id, lanes[0].id, { runOnEnterTemplate: false });

      expect(cardRow(card.id).active_lane_run_id).toBeNull();
      expect(getQueuedCardIds(databaseManager.get(), lanes[0].id)).not.toContain(card.id);
      expect(card.entryState).toBeUndefined();
      expect(drainLaneQueue(lanes[0].id)).toEqual([]);
      expect(openRunIdsForCard(card.id)).toHaveLength(0);
    });
  });
});
