import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
  broadcastToSession: vi.fn(),
}));

vi.mock('./templateTriggerService.js', () => ({
  renderTemplatePrompt: vi.fn(async (prompt) => prompt),
  getRootSession: vi.fn((session) => session),
}));

import {
  kanbanBoards,
  kanbanLanes,
  kanbanCards,
  projects,
  sessions,
  databaseManager,
} from '../database.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { isSessionActive } from './sessionManager.js';
import { createLaneRunForEntry } from './workflowSessionService.js';
import { drainLaneEntryTrigger, reclaimExpiredLaneEntryClaims } from './kanbanService.js';

function setupBoard() {
  const project = projects.create('Acceptance Project', '/tmp/acceptance');
  const board = kanbanBoards.create(project.id);
  const lanes = kanbanLanes.getByBoardId(board.id);
  return { project, lanes };
}

function holdOpenAgent(gate, onSignal) {
  return {
    supportsResume: () => false,
    needsConversationContext: () => false,
    async *execute(queryParams, meta) {
      try {
        meta?.onProviderAccepted?.({ boundary: 'test-acceptance', sessionId: meta?.sessionId });
      } catch {
        // Acceptance notification must never break the provider stream.
      }
      onSignal?.();
      await gate;
      yield { type: 'assistant', text: 'held-open reply' };
      yield { type: 'result', subtype: 'success' };
    },
  };
}

const withTimeout = (promise, ms) =>
  Promise.race([
    promise.then((value) => ({ settled: true, value })),
    new Promise((resolve) => setTimeout(() => resolve({ settled: false }), ms)),
  ]);

describe('lane-entry acceptance lifecycle', () => {
  let createAgentSpy;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    createAgentSpy?.mockRestore();
    createAgentSpy = null;
  });

  it('completes delivery upon acceptance while the provider stream is still open', async () => {
    const { project, lanes } = setupBoard();
    kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the lane work' });
    const workspace = sessions.create(project.id, 'Workspace', 'root prompt', {
      model: 'gpt-4o-test',
      agentType: 'codex',
    });
    const card = kanbanCards.create(lanes[0].id, workspace.id);
    const run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: workspace.id,
      cardId: card.id,
      lane: kanbanLanes.getById(lanes[0].id),
    });

    let releaseStream;
    const gate = new Promise((resolve) => { releaseStream = resolve; });
    let signalled = false;
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValue(holdOpenAgent(gate, () => { signalled = true; }));

    const drainPromise = drainLaneEntryTrigger(run.laneEntryEventId);
    try {
      await vi.waitFor(() => expect(signalled).toBe(true));
      // The provider has accepted, but its stream is still held open. The
      // delivery must already be complete without waiting for the turn.
      const raced = await withTimeout(drainPromise, 3000);
      expect(raced.settled).toBe(true);
      expect(raced.value).toBe(true);

      const event = databaseManager.get()
        .prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
        .get(run.laneEntryEventId);
      expect(event.status).toBe('completed');

      const child = sessions.getByProjectId(project.id).find((s) => s.id !== workspace.id);
      expect(child).toBeDefined();
      expect(sessions.getById(child.id).status).toBe('running');
      expect(isSessionActive(child.id)).toBe(true);

      // A delivery-lease-sized clock jump after acknowledgement cannot abort
      // the accepted turn: reclaiming expired claims is a no-op for it.
      databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
        SET claim_expires_at=? WHERE id=?`).run(Date.now() - 1, run.laneEntryEventId);
      expect(reclaimExpiredLaneEntryClaims(Date.now())).toBe(0);
      expect(sessions.getById(child.id).status).toBe('running');
      expect(isSessionActive(child.id)).toBe(true);
    } finally {
      releaseStream();
      await drainPromise;
    }

    const child = sessions.getByProjectId(project.id).find((s) => s.id !== workspace.id);
    await vi.waitFor(() => expect(isSessionActive(child.id)).toBe(false));
    expect(['waiting', 'open']).toContain(sessions.getById(child.id).status);
  });

  it('keeps a definitive pre-acceptance failure retryable on the same child', async () => {
    const { project, lanes } = setupBoard();
    kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the lane work' });
    const workspace = sessions.create(project.id, 'Workspace', 'root prompt', {
      model: 'gpt-4o-test',
      agentType: 'codex',
    });
    const card = kanbanCards.create(lanes[0].id, workspace.id);
    const run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: workspace.id,
      cardId: card.id,
      lane: kanbanLanes.getById(lanes[0].id),
    });

    // Setup/dispatch fails before any provider acceptance signal. The error
    // code proves the provider was never reached (a definitive pre-start
    // rejection); a generic error here would park as uncertain instead.
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue({
      supportsResume: () => false,
      needsConversationContext: () => false,
      async *execute() {
        yield await Promise.reject(Object.assign(new Error('Codex CLI not found'), { code: 'CODEX_CLI_NOT_FOUND' }));
      },
    });

    await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow();
    const afterFailure = databaseManager.get()
      .prepare('SELECT status, attempt_count, delivery_phase, last_error FROM kanban_lane_entry_events WHERE id=?')
      .get(run.laneEntryEventId);
    expect(afterFailure.status).toBe('pending');
    expect(afterFailure.attempt_count).toBe(1);
    // A persisted intent followed by a definitive pre-acceptance rejection
    // must not poison the retry as permanently ambiguous.
    expect(afterFailure.delivery_phase).not.toBe('dispatch_intent');
    // The original provider rejection is retained, not replaced by a generic
    // delivery message.
    expect(afterFailure.last_error).toContain('Codex CLI not found');

    const childrenBefore = sessions.getByProjectId(project.id).filter((s) => s.id !== workspace.id);
    expect(childrenBefore).toHaveLength(1);

    // The retry reuses the same child and completes once accepted.
    let releaseStream;
    const gate = new Promise((resolve) => { releaseStream = resolve; });
    createAgentSpy.mockReturnValue(holdOpenAgent(gate));
    databaseManager.get().prepare('UPDATE kanban_lane_entry_events SET next_attempt_at=? WHERE id=?')
      .run(Date.now() - 1, run.laneEntryEventId);
    const retry = drainLaneEntryTrigger(run.laneEntryEventId);
    try {
      const raced = await withTimeout(retry, 3000);
      expect(raced.settled).toBe(true);
      expect(raced.value).toBe(true);
    } finally {
      releaseStream();
      await retry;
    }
    const childrenAfter = sessions.getByProjectId(project.id).filter((s) => s.id !== workspace.id);
    expect(childrenAfter).toHaveLength(1);
    expect(childrenAfter[0].id).toBe(childrenBefore[0].id);
    expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
      .get(run.laneEntryEventId).status).toBe('completed');
  });

  it('parks a generic pre-acceptance execution failure with intent preserved', async () => {
    const { project, lanes } = setupBoard();
    kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the lane work' });
    const workspace = sessions.create(project.id, 'Workspace', 'root prompt', {
      model: 'gpt-4o-test',
      agentType: 'codex',
    });
    const card = kanbanCards.create(lanes[0].id, workspace.id);
    const run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: workspace.id,
      cardId: card.id,
      lane: kanbanLanes.getById(lanes[0].id),
    });

    // A mid-turn failure with no acceptance signal proves nothing about
    // provider start: park with intent for reconciliation, never auto-replay.
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue({
      supportsResume: () => false,
      needsConversationContext: () => false,
      async *execute() {
        yield await Promise.reject(new Error('provider failed mid-turn'));
      },
    });

    await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow('provider failed mid-turn');
    expect(databaseManager.get().prepare(`SELECT status, delivery_phase, dispatch_key, attempt_count, last_error
      FROM kanban_lane_entry_events WHERE id=?`).get(run.laneEntryEventId)).toMatchObject({
      status: 'needs_attention', delivery_phase: 'dispatch_intent', attempt_count: 1,
    });
    const parked = databaseManager.get().prepare('SELECT dispatch_key, last_error FROM kanban_lane_entry_events WHERE id=?')
      .get(run.laneEntryEventId);
    expect(parked.dispatch_key).toEqual(expect.any(String));
    expect(parked.last_error).toContain('provider failed mid-turn');

    // Repeated drains start no new provider execution and burn no attempts.
    await expect(drainLaneEntryTrigger(run.laneEntryEventId)).resolves.toBe(false);
    expect(createAgentSpy).toHaveBeenCalledTimes(1);
    expect(databaseManager.get().prepare('SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?')
      .get(run.laneEntryEventId)).toEqual({ status: 'needs_attention', attempt_count: 1 });
  });

  it('recovers when the poller reclaims the lease before a pre-acceptance failure', async () => {
    const { project, lanes } = setupBoard();
    kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the lane work' });
    const workspace = sessions.create(project.id, 'Workspace', 'root prompt', {
      model: 'gpt-4o-test',
      agentType: 'codex',
    });
    const card = kanbanCards.create(lanes[0].id, workspace.id);
    const run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: workspace.id,
      cardId: card.id,
      lane: kanbanLanes.getById(lanes[0].id),
    });

    // Poller-first wake ordering: the retry poller reclaims the expired
    // lease while the owning worker is still starting, then the start fails
    // before acceptance. The worker must still reset its own intent (fenced
    // on the dispatch key it minted) instead of leaving an ambiguity.
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue({
      supportsResume: () => false,
      needsConversationContext: () => false,
      async *execute() {
        databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
          SET claim_expires_at=? WHERE status='claimed'`).run(Date.now() - 1);
        reclaimExpiredLaneEntryClaims(Date.now());
        // Definitive pre-start rejection (provider never reached): the worker
        // resets the intent it minted through the poller-first path. A
        // generic error here would park as uncertain instead.
        yield await Promise.reject(Object.assign(new Error('Codex CLI not found'), { code: 'CODEX_CLI_NOT_FOUND' }));
      },
    });

    await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow();
    const afterFailure = databaseManager.get()
      .prepare('SELECT status, attempt_count, delivery_phase, last_error FROM kanban_lane_entry_events WHERE id=?')
      .get(run.laneEntryEventId);
    expect(afterFailure.status).toBe('pending');
    expect(afterFailure.attempt_count).toBe(1);
    expect(afterFailure.delivery_phase).not.toBe('dispatch_intent');

    const childrenBefore = sessions.getByProjectId(project.id).filter((s) => s.id !== workspace.id);
    expect(childrenBefore).toHaveLength(1);

    let releaseStream;
    const gate = new Promise((resolve) => { releaseStream = resolve; });
    createAgentSpy.mockReturnValue(holdOpenAgent(gate));
    databaseManager.get().prepare('UPDATE kanban_lane_entry_events SET next_attempt_at=? WHERE id=?')
      .run(Date.now() - 1, run.laneEntryEventId);
    const retry = drainLaneEntryTrigger(run.laneEntryEventId);
    try {
      const raced = await withTimeout(retry, 3000);
      expect(raced.settled).toBe(true);
      expect(raced.value).toBe(true);
    } finally {
      releaseStream();
      await retry;
    }
    const childrenAfter = sessions.getByProjectId(project.id).filter((s) => s.id !== workspace.id);
    expect(childrenAfter).toHaveLength(1);
    expect(childrenAfter[0].id).toBe(childrenBefore[0].id);
  });

  it('marks the session failed but keeps the delivery completed when the provider fails after acceptance', async () => {
    const { project, lanes } = setupBoard();
    kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the lane work' });
    const workspace = sessions.create(project.id, 'Workspace', 'root prompt', {
      model: 'gpt-4o-test',
      agentType: 'codex',
    });
    const card = kanbanCards.create(lanes[0].id, workspace.id);
    const run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: workspace.id,
      cardId: card.id,
      lane: kanbanLanes.getById(lanes[0].id),
    });

    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue({
      supportsResume: () => false,
      needsConversationContext: () => false,
      async *execute(queryParams, meta) {
        try {
          meta?.onProviderAccepted?.({ boundary: 'test-acceptance', sessionId: meta?.sessionId });
        } catch {
          // Acceptance notification must never break the provider stream.
        }
        yield await Promise.reject(new Error('provider failed mid-turn'));
      },
    });

    await expect(drainLaneEntryTrigger(run.laneEntryEventId)).resolves.toBe(true);
    expect(databaseManager.get().prepare('SELECT status, delivery_phase FROM kanban_lane_entry_events WHERE id=?')
      .get(run.laneEntryEventId)).toMatchObject({ status: 'completed', delivery_phase: 'completed' });

    const child = sessions.getByProjectId(project.id).find((s) => s.id !== workspace.id);
    await vi.waitFor(() => expect(isSessionActive(child.id)).toBe(false));
    // The execution failed and stays failed; the delivery is not retried.
    expect(sessions.getById(child.id).status).toBe('error');
    expect(createAgentSpy).toHaveBeenCalledTimes(1);
    await expect(drainLaneEntryTrigger(run.laneEntryEventId)).resolves.toBe(false);
    expect(createAgentSpy).toHaveBeenCalledTimes(1);
  });

  it('completes a proven dispatch without starting another child', async () => {
    const { project, lanes } = setupBoard();
    kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the lane work' });
    const workspace = sessions.create(project.id, 'Workspace', 'root prompt', {
      model: 'gpt-4o-test',
      agentType: 'codex',
    });
    const card = kanbanCards.create(lanes[0].id, workspace.id);
    const run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: workspace.id,
      cardId: card.id,
      lane: kanbanLanes.getById(lanes[0].id),
    });
    const child = sessions.create(project.id, 'Allocated child', 'child prompt', {
      model: 'gpt-4o-test',
      agentType: 'codex',
      parentSessionId: workspace.id,
    });
    databaseManager.get().prepare('UPDATE kanban_lane_runs SET root_session_id=? WHERE id=?')
      .run(child.id, run.id);
    databaseManager.get().prepare('UPDATE sessions SET lane_run_id=?, status=? WHERE id=?')
      .run(run.id, 'running', child.id);
    // A crash after provider acceptance but before the handoff commit: the
    // durable evidence survived, the turn did not.
    databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
      SET delivery_phase='dispatch_intent', dispatch_key='proven-key', accepted_dispatch_key='proven-key',
        accepted_at=?, attempt_count=2, updated_at=? WHERE id=?`)
      .run(Date.now(), Date.now(), run.laneEntryEventId);

    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(holdOpenAgent(new Promise(() => {})));

    await expect(drainLaneEntryTrigger(run.laneEntryEventId)).resolves.toBe(true);
    const event = databaseManager.get()
      .prepare('SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?')
      .get(run.laneEntryEventId);
    expect(event.status).toBe('completed');
    // Reconciliation leaves the dispatch attempt budget unchanged.
    expect(event.attempt_count).toBe(2);
    expect(createAgentSpy).not.toHaveBeenCalled();
    // A restart after the handoff sees a completed event: no replay.
    await expect(drainLaneEntryTrigger(run.laneEntryEventId)).resolves.toBe(false);
    expect(createAgentSpy).not.toHaveBeenCalled();
  });

  it('completes a legacy post-turn acknowledgement without a new dispatch', async () => {
    const { project, lanes } = setupBoard();
    kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the lane work' });
    const workspace = sessions.create(project.id, 'Workspace', 'root prompt', {
      model: 'gpt-4o-test',
      agentType: 'codex',
    });
    const card = kanbanCards.create(lanes[0].id, workspace.id);
    const run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: workspace.id,
      cardId: card.id,
      lane: kanbanLanes.getById(lanes[0].id),
    });
    const child = sessions.create(project.id, 'Allocated child', 'child prompt', {
      model: 'gpt-4o-test',
      agentType: 'codex',
      parentSessionId: workspace.id,
    });
    databaseManager.get().prepare('UPDATE kanban_lane_runs SET root_session_id=? WHERE id=?')
      .run(child.id, run.id);
    // A crash between the old post-turn acknowledgement and completion.
    databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
      SET delivery_phase='dispatch_acknowledged', dispatch_key='legacy-key',
        dispatch_acknowledged_at=?, attempt_count=1, updated_at=? WHERE id=?`)
      .run(Date.now(), Date.now(), run.laneEntryEventId);

    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(holdOpenAgent(new Promise(() => {})));

    await expect(drainLaneEntryTrigger(run.laneEntryEventId)).resolves.toBe(true);
    expect(databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
      .get(run.laneEntryEventId).status).toBe('completed');
    expect(createAgentSpy).not.toHaveBeenCalled();
  });

  it('lets exactly one worker complete a raced dispatch', async () => {
    const { project, lanes } = setupBoard();
    kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the lane work' });
    const workspace = sessions.create(project.id, 'Workspace', 'root prompt', {
      model: 'gpt-4o-test',
      agentType: 'codex',
    });
    const card = kanbanCards.create(lanes[0].id, workspace.id);
    const run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: workspace.id,
      cardId: card.id,
      lane: kanbanLanes.getById(lanes[0].id),
    });

    let releaseStream;
    const gate = new Promise((resolve) => { releaseStream = resolve; });
    let signalled = false;
    createAgentSpy = vi.spyOn(agentGateway, 'createAgent')
      .mockReturnValue(holdOpenAgent(gate, () => { signalled = true; }));

    const drainA = drainLaneEntryTrigger(run.laneEntryEventId);
    const drainB = drainLaneEntryTrigger(run.laneEntryEventId);
    try {
      await vi.waitFor(() => expect(signalled).toBe(true));
      releaseStream();
      const [a, b] = await Promise.all([drainA, drainB]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
    } finally {
      releaseStream();
      await Promise.allSettled([drainA, drainB]);
    }

    expect(sessions.getByProjectId(project.id).filter((s) => s.id !== workspace.id)).toHaveLength(1);
    expect(createAgentSpy).toHaveBeenCalledTimes(1);
    expect(databaseManager.get().prepare('SELECT status, attempt_count FROM kanban_lane_entry_events WHERE id=?')
      .get(run.laneEntryEventId)).toMatchObject({ status: 'completed', attempt_count: 1 });
  });

  it('parks an ambiguous dispatch for attention without burning attempts', async () => {
    const { project, lanes } = setupBoard();
    kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'Do the lane work' });
    const workspace = sessions.create(project.id, 'Workspace', 'root prompt', {
      model: 'gpt-4o-test',
      agentType: 'codex',
    });
    const card = kanbanCards.create(lanes[0].id, workspace.id);
    const run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: workspace.id,
      cardId: card.id,
      lane: kanbanLanes.getById(lanes[0].id),
    });
    const child = sessions.create(project.id, 'Allocated child', 'child prompt', {
      model: 'gpt-4o-test',
      agentType: 'codex',
      parentSessionId: workspace.id,
    });
    databaseManager.get().prepare('UPDATE kanban_lane_runs SET root_session_id=? WHERE id=?')
      .run(child.id, run.id);
    databaseManager.get().prepare('UPDATE sessions SET lane_run_id=? WHERE id=?').run(run.id, child.id);
    // A prior worker persisted dispatch intent but never produced durable
    // acknowledgement (e.g. it died after handing off to the provider).
    databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
      SET delivery_phase='dispatch_intent', dispatch_key='ambiguous-key', attempt_count=2, updated_at=? WHERE id=?`)
      .run(Date.now(), run.laneEntryEventId);

    createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(holdOpenAgent(new Promise(() => {})));

    await expect(drainLaneEntryTrigger(run.laneEntryEventId)).resolves.toBe(false);
    const event = databaseManager.get()
      .prepare('SELECT status, attempt_count, last_error FROM kanban_lane_entry_events WHERE id=?')
      .get(run.laneEntryEventId);
    expect(event.status).toBe('needs_attention');
    expect(event.attempt_count).toBe(2);
    expect(event.last_error).toMatch(/ambiguous/i);
    // No second provider execution was dispatched for the uncertain event.
    expect(createAgentSpy).not.toHaveBeenCalled();
  });
});
