/**
 * Regression: scheduler-claimed retries must not wipe their own reschedule.
 *
 * A turn that fails with a reschedulable error ends via _executeSession /
 * handleTerminalStreamError returning a receipt. finishScheduledStart
 * validates that receipt with didSessionExecutionStart(result, session.id),
 * which requires result.sessionId === session.id. The receipts used to omit
 * sessionId ({ started: true, outcome: 'rescheduled' }), so every
 * scheduler-claimed retry that ended rescheduled was classified as an
 * invalid executor response and rejectScheduledStart wiped the just-committed
 * reschedule (status -> stopped, schedule cleared, everything else preserved)
 * — silently terminating the retry chain (workspace 91a5cf stall,
 * 2026-10-18).
 *
 * The real-path cases below drive the exact production sequence: the
 * scheduler claims the due retry and invokes the REAL continueSession with a
 * stubbed provider, so the receipt under test is produced by _executeSession
 * / handleTerminalStreamError — never hand-rolled. They fail with the
 * sessionExecution.js receipt fix reverted (verified by mutation check) and
 * pass with it applied. The well-formed-receipt cases pin the scheduler's
 * acceptance of a fixed receipt (finishScheduledStart validation).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { kanbanBoards, kanbanCards, kanbanLanes, projects, sessions, messages } from '../database.js';
import { SchedulerService } from './schedulerService.js';
import { attachRootSession, createLaneRunForEntry, getRun, markExecutionState } from './workflowSessionService.js';
import { continueSession, isSessionActive } from './sessionManager.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { didSessionExecutionStart } from './sessionStartResult.js';

function setupScheduledLaneWorker({ reschedulable = false } = {}) {
  const project = projects.create('Reschedule receipt project', '/tmp/reschedule-receipt');
  const board = kanbanBoards.create(project.id);
  const [source, target] = kanbanLanes.getByBoardId(board.id);
  const workspace = sessions.create(project.id, 'Workspace', 'work');
  const card = kanbanCards.create(source.id, workspace.id);
  const worker = sessions.create(project.id, 'Automated worker', 'complete the lane', {
    parentSessionId: workspace.id,
  });
  const run = createLaneRunForEntry({
    projectId: project.id,
    workspaceId: workspace.id,
    cardId: card.id,
    lane: { ...source, onEnterPrompt: 'complete the lane', completionTargetLaneId: target.id },
  });
  attachRootSession(run.id, worker.id);

  // The turn has run before (first failure already rescheduled once) — the
  // state the poller finds when it claims retry #2.
  messages.create(worker.id, 'user', 'Continue', { toolUse: null });
  messages.create(worker.id, 'assistant', 'partial work', { toolUse: null });
  sessions.update(worker.id, {
    status: 'scheduled',
    scheduledAt: Date.now(),
    pendingPrompt: 'Continue',
    rescheduleCount: 1,
    error: 'Rescheduled (1x): usage limit',
    ...(reschedulable
      ? { autoRescheduleEnabled: true, rescheduleOnTokenLimit: true, rescheduleDelayMinutes: 15 }
      : {}),
  });
  return { worker, run };
}

/** Replay what the real continuation core does when a claimed retry fails
 * with a reschedulable error: commit reschedule #2, mark retrying, then
 * resolve with the (fixed) executor receipt. */
function makeReschedulingExecutor(failCount = 2) {
  return async (sessionId) => {
    sessions.update(sessionId, {
      status: 'scheduled',
      scheduledAt: Date.now() + 15 * 60 * 1000,
      rescheduleCount: failCount,
      pendingPrompt: 'Continue',
      error: `Rescheduled (${failCount}x): You've hit your usage limit…`,
    });
    markExecutionState(sessionId, 'retrying');
    return { started: true, sessionId, outcome: 'rescheduled' };
  };
}

let createAgentSpy = null;

afterEach(() => {
  createAgentSpy?.mockRestore();
  createAgentSpy = null;
});

/** Stub the provider to report a terminal failure as a final stream event
 * (Codex-style) and then close normally — the handleTerminalStreamError path. */
function stubResultErrorAgent(message) {
  const stubAgent = {
    execute: vi.fn(async function* () {
      yield { type: 'result', subtype: 'error', is_error: true, error: message };
    }),
    supportsResume: () => false,
    needsConversationContext: () => true,
  };
  createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);
  return stubAgent;
}

/** Stub the provider to reject execute() outright — the _executeSession
 * catch-branch path. */
function stubThrowingAgent(message) {
  const stubAgent = {
    // eslint-disable-next-line require-yield
    execute: vi.fn(async function* () {
      throw new Error(message);
    }),
    supportsResume: () => false,
    needsConversationContext: () => true,
  };
  createAgentSpy = vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent);
  return stubAgent;
}

/** Run the full production sequence for a claimed retry: the scheduler claims
 * the due session and dispatches the REAL continueSession (provider stubbed
 * by the caller). Returns both the scheduler result and the executor receipt
 * the real execution path produced. */
async function startClaimedRetryThroughRealContinue(session) {
  let receipt;
  const scheduler = new SchedulerService();
  scheduler.initialize({
    isSessionActive,
    continueSession: async (...args) => {
      receipt = await continueSession(...args);
      return receipt;
    },
  });
  const result = await scheduler.startScheduledSession(sessions.getById(session.id));
  return { result, receipt };
}

describe('SchedulerService rescheduled-retry receipt contract', () => {
  it('keeps the reschedule a scheduler-claimed lane-worker retry just committed', async () => {
    const { worker, run } = setupScheduledLaneWorker();
    const scheduler = new SchedulerService();
    scheduler.initialize({
      isSessionActive: () => false,
      continueSession: makeReschedulingExecutor(),
    });

    const result = await scheduler.startScheduledSession(sessions.getById(worker.id));

    // The turn ran: the receipt (with sessionId) is accepted and surfaced
    // (finishScheduledStart normalizes to startedSessionExecution).
    expect(result).toEqual({ claimed: true, started: true, sessionId: worker.id });

    // …and the retry it committed survives — no rejectScheduledStart wipe.
    const final = sessions.getById(worker.id);
    expect(final.status).toBe('scheduled');
    expect(final.scheduledAt).not.toBeNull();
    expect(final.pendingPrompt).toBe('Continue');
    expect(final.error).toMatch(/Rescheduled \(2x\)/);
    expect(final.rescheduleCount).toBe(2);
    expect(final.executionState).toBe('retrying');
    expect(final.ownWorkState).toBe('open');
    expect(final.laneRunId).toBe(run.id);
  });

  it('keeps the reschedule for a scheduler-claimed non-lane retry too', async () => {
    // finishScheduledStart only fabricates receipts for undefined results,
    // so a non-lane scheduled session is exposed to the same contract.
    const project = projects.create('Reschedule receipt project (plain)', '/tmp/reschedule-receipt-plain');
    const session = sessions.create(project.id, 'Plain session', 'do work');
    messages.create(session.id, 'user', 'Continue', { toolUse: null });
    messages.create(session.id, 'assistant', 'partial work', { toolUse: null });
    sessions.update(session.id, {
      status: 'scheduled',
      scheduledAt: Date.now(),
      pendingPrompt: 'Continue',
      rescheduleCount: 1,
      error: 'Rescheduled (1x): service error',
    });

    const scheduler = new SchedulerService();
    scheduler.initialize({
      isSessionActive: () => false,
      continueSession: makeReschedulingExecutor(),
    });

    const result = await scheduler.startScheduledSession(sessions.getById(session.id));
    // Non-lane scheduled starts resolve to the bare claimed receipt on success.
    expect(result).toEqual({ claimed: true });

    const final = sessions.getById(session.id);
    expect(final.status).toBe('scheduled');
    expect(final.scheduledAt).not.toBeNull();
    expect(final.rescheduleCount).toBe(2);
    expect(final.error).toMatch(/Rescheduled \(2x\)/);
  });

  it('real path: a usage-limit terminal event reschedules and keeps retry #2 (handleTerminalStreamError receipt)', async () => {
    const { worker, run } = setupScheduledLaneWorker({ reschedulable: true });
    stubResultErrorAgent("You've hit your usage limit. Try again later.");

    const { result, receipt } = await startClaimedRetryThroughRealContinue(worker);

    // The receipt the REAL execution path produced satisfies the scheduler
    // contract — this is the assertion that fails with the fix reverted.
    expect(receipt.outcome).toBe('rescheduled');
    expect(didSessionExecutionStart(receipt, worker.id)).toBe(true);
    expect(result).toEqual({ claimed: true, started: true, sessionId: worker.id });

    // …and the retry it committed survives — no rejectScheduledStart wipe.
    const final = sessions.getById(worker.id);
    expect(final.status).toBe('scheduled');
    expect(final.scheduledAt).not.toBeNull();
    expect(final.pendingPrompt).toBe('Continue');
    expect(final.error).toMatch(/Rescheduled \(2x\)/);
    expect(final.rescheduleCount).toBe(2);
    expect(final.executionState).toBe('retrying');
    expect(final.ownWorkState).toBe('open');
    expect(final.laneRunId).toBe(run.id);
    expect(getRun(run.id).status).toBe('open');
  });

  it('real path: a usage-limit rejection reschedules and keeps retry #2 (_executeSession catch receipt)', async () => {
    const { worker, run } = setupScheduledLaneWorker({ reschedulable: true });
    stubThrowingAgent("You've hit your usage limit. Try again later.");

    const { result, receipt } = await startClaimedRetryThroughRealContinue(worker);

    expect(receipt.outcome).toBe('rescheduled');
    expect(didSessionExecutionStart(receipt, worker.id)).toBe(true);
    expect(result).toEqual({ claimed: true, started: true, sessionId: worker.id });

    const final = sessions.getById(worker.id);
    expect(final.status).toBe('scheduled');
    expect(final.scheduledAt).not.toBeNull();
    expect(final.pendingPrompt).toBe('Continue');
    expect(final.error).toMatch(/Rescheduled \(2x\)/);
    expect(final.rescheduleCount).toBe(2);
    expect(final.executionState).toBe('retrying');
    expect(final.ownWorkState).toBe('open');
    expect(final.laneRunId).toBe(run.id);
    expect(getRun(run.id).status).toBe('open');
  });

  it('real path: a terminally-failed claimed retry keeps its failure state (failed receipt)', async () => {
    // No reschedule flags: the failure is permanent, so the turn ends via the
    // handleTerminalStreamError NON-rescheduled path. The failed receipt
    // carries sessionId, so the scheduler accepts it and the turn's own
    // terminal state survives — rejectScheduledStart must NOT overwrite it
    // to 'stopped' (the pre-fix invalid_executor_response behavior).
    const { worker, run } = setupScheduledLaneWorker();
    stubResultErrorAgent('boom: permanent result failure');

    const { result, receipt } = await startClaimedRetryThroughRealContinue(worker);

    expect(receipt.outcome).toBe('failed');
    expect(didSessionExecutionStart(receipt, worker.id)).toBe(true);
    expect(result).toEqual({ claimed: true, started: true, sessionId: worker.id });

    const final = sessions.getById(worker.id);
    expect(final.status).toBe('error');
    expect(final.error).toMatch(/boom: permanent result failure/);
    expect(final.executionState).toBe('stopped');
    expect(final.ownWorkState).toBe('closed_failed');
    expect(final.scheduledAt).toBeNull();
    expect(final.pendingPrompt).toBeNull();
    expect(final.rescheduleCount).toBe(1);
    expect(final.laneRunId).toBe(run.id);
    expect(getRun(run.id).status).toBe('failed');
  });

  it('didSessionExecutionStart accepts the fixed receipt and rejects the pre-fix shape', () => {
    const sessionId = 'session-id-for-contract-check';
    expect(didSessionExecutionStart({ started: true, sessionId, outcome: 'rescheduled' }, sessionId)).toBe(true);
    expect(didSessionExecutionStart({ started: true, outcome: 'rescheduled' }, sessionId)).toBe(false);
    expect(didSessionExecutionStart({ started: true, sessionId: 'other-session', outcome: 'rescheduled' }, sessionId)).toBe(false);
    expect(didSessionExecutionStart(undefined, sessionId)).toBe(false);
  });
});
