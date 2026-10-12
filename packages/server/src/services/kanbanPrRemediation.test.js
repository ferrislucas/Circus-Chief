import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock external dependencies (mirrors kanbanService.test.js)
vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
  broadcastToSession: vi.fn(),
}));

vi.mock('./templateTriggerService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    renderTemplatePrompt: vi.fn().mockResolvedValue('rendered prompt'),
    getRootSession: vi.fn((session) => session),
  };
});

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

// Passthrough by default so pause-abandon tests keep real worktree behavior.
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
  sessionTemplates,
  databaseManager,
} from '../database.js';
import { runSession } from './sessionManager.js';
import {
  drainLaneEntryTrigger,
  drainQueuedEntries,
  updateLaneWithAutomationToggle,
  routeWorkspaceCard,
} from './kanbanService.js';
import {
  createLaneRunForEntry, attachRootSession, getRun,
} from './workflowSessionService.js';
import { checkAndTriggerNextTemplate } from './templateTriggerService.js';
import { refreshPreservedChildSettings } from './kanbanChildSettings.js';
import { reconcileKanbanOwnership } from './kanbanRecoveryService.js';
import { recoverOrphanedStartingSessions, recoverOrphanedRunningSessions } from './sessionStartupRecovery.js';
import { buildQueryParams } from './queryParamBuilder.js';

/**
 * PR remediation regressions for PR Review issues 13, 14, 15.
 * Each test drives the real delivery/pause/recovery path and fails until
 * the corresponding fix lands (red -> green).
 */
describe('kanban PR remediation (issues 13, 14, 15)', () => {
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

  function createSession(name = 'Test Session', options = {}) {
    return sessions.create(projectId, name, 'Prompt', options);
  }

  function runBootRecoverySequence() {
    recoverOrphanedStartingSessions();
    recoverOrphanedRunningSessions();
    reconcileKanbanOwnership({ dryRun: false });
  }

  function entryStatus(eventId) {
    return databaseManager.get().prepare('SELECT status FROM kanban_lane_entry_events WHERE id=?')
      .get(eventId).status;
  }

  /** Provider permission posture for a child row, via the real query builder. */
  function permissionModeFor(child) {
    const params = buildQueryParams({
      prompt: 'probe',
      workingDirectory: '/tmp/test',
      controller: new AbortController(),
      session: child,
      sessionId: child.id,
      systemPrompt: null,
      model: child.model,
      sessionEnv: {},
      agentType: 'claude-code',
    });
    return params.options.permissionMode;
  }

  /** Pause a prompt-lane retry at the provider fence, preserving its child. */
  async function pausePromptChildAtFence(run) {
    runSession.mockImplementationOnce(async (childId, prompt, workingDirectory, opts) => {
      kanbanLanes.update(lanes[0].id, { automationEnabled: false });
      await opts.beforeProviderExecute();
    });
    expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);
    return getRun(run.id).rootSessionId;
  }

  describe('issue 13 — preserved child replays edited execution permissions', () => {
    it('prompt entry: pause -> edit lane to plan + reschedule off -> resume refreshes the same child', async () => {
      kanbanLanes.update(lanes[0].id, {
        onEnterPrompt: 'do something',
        onEnterMode: 'yolo',
        onEnterAutoRescheduleEnabled: true,
        onEnterRescheduleDelayMinutes: 30,
        onEnterMaxRescheduleCount: 5,
      });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      void card;
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      // Retry shape: a prior attempt attached a yolo child (pending event, no
      // dispatch intent), as after a setup failure on the template path.
      const childId = sessions.create(projectId, 'Lane prompt (lane: To Do)', 'rendered prompt', {
        mode: 'yolo', parentSessionId: root.id, status: 'starting',
      }).id;
      sessions.update(childId, {
        autoRescheduleEnabled: true, rescheduleDelayMinutes: 30, maxRescheduleCount: 5,
      });
      attachRootSession(run.id, childId);

      // The retry pauses at the fence, preserving the yolo child.
      const childIdAfterPause = await pausePromptChildAtFence(run);
      expect(childIdAfterPause).toBe(childId);
      expect(sessions.getById(childId)).toMatchObject({ mode: 'yolo', autoRescheduleEnabled: true });

      // Edit while paused: tighten permissions and turn reschedule off.
      kanbanLanes.update(lanes[0].id, { onEnterMode: 'plan', onEnterAutoRescheduleEnabled: false });

      // Re-enable reuses the preserved child.
      kanbanLanes.update(lanes[0].id, { automationEnabled: true });
      expect(drainQueuedEntries(lanes[0].id).drainedCount).toBe(1);
      await vi.waitFor(() => {
        expect(entryStatus(run.laneEntryEventId)).toBe('completed');
      });

      const child = sessions.getById(childId);
      expect(runSession.mock.calls[runSession.mock.calls.length - 1][0]).toBe(childId);
      // Same child, same run, same ownership — only settings replayed.
      expect(child).toMatchObject({
        id: childId,
        mode: 'plan',
        autoRescheduleEnabled: false,
        parentSessionId: root.id,
        laneRunId: run.id,
      });
      expect(child.maxRescheduleCount).toBeNull();
      expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });
      // Provider params reflect plan permissions, not the stale yolo bypass.
      expect(permissionModeFor(child)).toBe('default');
    });

    it('template entry: pause -> edit template to plan + reschedule off -> resume refreshes the same child', async () => {
      const template = sessionTemplates.create({
        projectId, name: 'Entry', prompt: 'do something', mode: 'yolo',
      });
      kanbanLanes.update(lanes[0].id, {
        onEnterTemplateId: template.id,
        onEnterAutoRescheduleEnabled: true,
        onEnterRescheduleDelayMinutes: 30,
        onEnterMaxRescheduleCount: 5,
      });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      void card;
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      const { setupGitForSession } = await import('./gitSessionSetup.js');

      // Attempt 1: git-setup failure attaches the yolo child without dispatch.
      setupGitForSession.mockRejectedValueOnce(new Error('git boom'));
      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow();
      const childId = getRun(run.id).rootSessionId;
      expect(childId).toBeTruthy();
      expect(sessions.getById(childId)).toMatchObject({ mode: 'yolo', autoRescheduleEnabled: true });

      // Attempt 2: retry pauses at the fence, preserving the child.
      databaseManager.get().prepare('UPDATE kanban_lane_entry_events SET next_attempt_at=NULL WHERE id=?')
        .run(run.laneEntryEventId);
      const fakeWt = join(tmpdir(), `kanban-i13-template-wt-${Date.now()}`);
      setupGitForSession.mockImplementationOnce(async () => {
        kanbanLanes.update(lanes[0].id, { automationEnabled: false });
        return { workingDirectory: fakeWt, gitWorktree: fakeWt };
      });
      // The setup-phase disable preserves the child and parks the entry
      // before runSession is ever reached.
      expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);
      expect(runSession).not.toHaveBeenCalled();
      expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });

      // Edit while paused: tighten the template and turn reschedule off.
      sessionTemplates.update(template.id, { mode: 'plan' });
      kanbanLanes.update(lanes[0].id, { onEnterAutoRescheduleEnabled: false });

      // Re-enable reuses the preserved child.
      kanbanLanes.update(lanes[0].id, { automationEnabled: true });
      expect(drainQueuedEntries(lanes[0].id).drainedCount).toBe(1);
      await vi.waitFor(() => {
        expect(entryStatus(run.laneEntryEventId)).toBe('completed');
      });

      const child = sessions.getById(childId);
      expect(runSession.mock.calls[runSession.mock.calls.length - 1][0]).toBe(childId);
      expect(child).toMatchObject({
        id: childId,
        mode: 'plan',
        autoRescheduleEnabled: false,
        parentSessionId: root.id,
        laneRunId: run.id,
      });
      expect(child.maxRescheduleCount).toBeNull();
      expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });
      expect(permissionModeFor(child)).toBe('default');
    });

    it('prompt entry: nulling lane effort/thinking while paused clears the preserved child', async () => {
      const root = createSession('Root', { thinkingEnabled: false });
      kanbanLanes.update(lanes[0].id, {
        onEnterPrompt: 'do something',
        onEnterMode: 'yolo',
        onEnterEffortLevel: 'high',
        onEnterThinkingEnabled: true,
      });
      const card = kanbanCards.create(lanes[0].id, root.id);
      void card;
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      // Retry shape carrying the lane's overrides.
      const attachedId = sessions.create(projectId, 'Lane prompt (lane: To Do)', 'rendered prompt', {
        mode: 'yolo', thinkingEnabled: true, parentSessionId: root.id, status: 'starting',
      }).id;
      sessions.update(attachedId, { effortLevel: 'high' });
      attachRootSession(run.id, attachedId);

      const childId = await pausePromptChildAtFence(run);
      expect(childId).toBe(attachedId);
      expect(sessions.getById(childId)).toMatchObject({
        mode: 'yolo', effortLevel: 'high', thinkingEnabled: true,
      });

      // Clear the lane overrides while paused: the child must fall back to
      // the parent instead of keeping stale values.
      kanbanLanes.update(lanes[0].id, { onEnterEffortLevel: null, onEnterThinkingEnabled: null });

      kanbanLanes.update(lanes[0].id, { automationEnabled: true });
      expect(drainQueuedEntries(lanes[0].id).drainedCount).toBe(1);
      await vi.waitFor(() => {
        expect(entryStatus(run.laneEntryEventId)).toBe('completed');
      });

      const child = sessions.getById(childId);
      expect(child.id).toBe(childId);
      expect(child.effortLevel).toBeNull();
      expect(child.thinkingEnabled).toBe(false);
      expect(child.mode).toBe('yolo');
    });
  });

  describe('issue 14 — disable during retry backoff preserves the child across restart', () => {
    it('setup failure -> disable during backoff -> restart -> re-enable dispatches the original child exactly once', async () => {
      const template = sessionTemplates.create({ projectId, name: 'Entry', prompt: 'do something' });
      kanbanLanes.update(lanes[0].id, { onEnterTemplateId: template.id });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      void card;
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      const { setupGitForSession } = await import('./gitSessionSetup.js');

      // Setup failure after child allocation: starting child, pending entry
      // with backoff, no dispatch intent.
      setupGitForSession.mockRejectedValueOnce(new Error('git boom'));
      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow();
      const childId = getRun(run.id).rootSessionId;
      expect(childId).toBeTruthy();
      expect(sessions.getById(childId).status).toBe('starting');
      expect(runSession).not.toHaveBeenCalled();

      // Disable during backoff parks pending -> queued through the real PATCH path.
      updateLaneWithAutomationToggle(lanes[0].id, { automationEnabled: false });
      expect(entryStatus(run.laneEntryEventId)).toBe('queued');

      runBootRecoverySequence();

      // The queued setup survives the restart with its obligation open.
      expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });
      expect(sessions.getById(childId)).toMatchObject({ status: 'stopped', ownWorkState: 'open' });

      // Re-enable dispatches the original child exactly once.
      kanbanLanes.update(lanes[0].id, { automationEnabled: true });
      expect(drainQueuedEntries(lanes[0].id).drainedCount).toBe(1);
      await vi.waitFor(() => {
        expect(entryStatus(run.laneEntryEventId)).toBe('completed');
      });
      expect(runSession).toHaveBeenCalledTimes(1);
      expect(runSession.mock.calls[0][0]).toBe(childId);
      expect(sessions.getByProjectId(projectId).filter((s) => s.parentSessionId === root.id))
        .toHaveLength(1);
      expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });
    });

    it('leaves an already-dispatched running child untouched when parking pending entries', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      void card;
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      // A live provider run attached to a pending entry (mid-flight shape).
      const child = createSession('Live child', { parentSessionId: root.id });
      attachRootSession(run.id, child.id);
      const childId = child.id;
      databaseManager.get().prepare("UPDATE sessions SET status='running', execution_state='running' WHERE id=?")
        .run(childId);
      expect(entryStatus(run.laneEntryEventId)).toBe('pending');

      updateLaneWithAutomationToggle(lanes[0].id, { automationEnabled: false });

      expect(entryStatus(run.laneEntryEventId)).toBe('queued');
      expect(sessions.getById(childId)).toMatchObject({
        status: 'running', executionState: 'running', ownWorkState: 'open', laneRunId: run.id,
      });
      expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });
    });
  });

  describe('issue 15 — clearing automation with a preserved undispatched child', () => {
    /** Template setup failure attaches an undispatched child; the fence pause preserves it. */
    async function pauseWithPreservedTemplateChild() {
      const template = sessionTemplates.create({ projectId, name: 'Entry', prompt: 'do something' });
      kanbanLanes.update(lanes[0].id, { onEnterTemplateId: template.id });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      const { setupGitForSession } = await import('./gitSessionSetup.js');

      setupGitForSession.mockRejectedValueOnce(new Error('git boom'));
      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow();
      const childId = getRun(run.id).rootSessionId;

      databaseManager.get().prepare('UPDATE kanban_lane_entry_events SET next_attempt_at=NULL WHERE id=?')
        .run(run.laneEntryEventId);
      const fakeWt = join(tmpdir(), `kanban-i15-template-wt-${Date.now()}`);
      setupGitForSession.mockImplementationOnce(async () => {
        kanbanLanes.update(lanes[0].id, { automationEnabled: false });
        return { workingDirectory: fakeWt, gitWorktree: fakeWt };
      });
      expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);
      expect(entryStatus(run.laneEntryEventId)).toBe('queued');
      expect(sessions.getById(childId)).toMatchObject({ status: 'stopped', ownWorkState: 'open' });
      return { root, card, run, childId };
    }

    function expectCardUnblocked({ card, run, childId }) {
      const db = databaseManager.get();
      expect(getRun(run.id).status).not.toBe('open');
      expect(db.prepare('SELECT active_lane_run_id, lane_entry_event_id FROM kanban_cards WHERE id=?')
        .get(card.id)).toEqual({ active_lane_run_id: null, lane_entry_event_id: null });
      expect(sessions.getById(childId).ownWorkState).not.toBe('open');
    }

    it('queued-consume path: clearing automation terminalizes the undispatched rooted run and frees the card', async () => {
      const { root, card, run, childId } = await pauseWithPreservedTemplateChild();

      updateLaneWithAutomationToggle(lanes[0].id, {
        onEnterPrompt: null, onEnterTemplateId: null, completionTargetLaneId: null,
      });

      expect(entryStatus(run.laneEntryEventId)).toBe('completed');
      expectCardUnblocked({ card, run, childId });
      expect(runSession).not.toHaveBeenCalled();

      // Routing no longer defers behind the dead run.
      await expect(routeWorkspaceCard(root.id, lanes[1].id)).resolves.toMatchObject({ status: 'moved' });
      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[1].id);
    });

    it('claimed-cleanup path: clearing automation mid-cleanup settles the same way', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      // Retry shape with an attached (never dispatched) child, as after a
      // setup failure: the redelivery reuses it instead of allocating.
      const child = createSession('Retry child', { parentSessionId: root.id });
      attachRootSession(run.id, child.id);
      const childId = child.id;

      // First pause preserves the child and parks the entry.
      const laneId = lanes[0].id;
      runSession.mockImplementationOnce(async (retryChildId, prompt, workingDirectory, opts) => {
        expect(retryChildId).toBe(childId);
        kanbanLanes.update(laneId, { automationEnabled: false });
        await opts.beforeProviderExecute();
      });
      expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);
      expect(entryStatus(run.laneEntryEventId)).toBe('queued');
      expect(sessions.getById(childId)).toMatchObject({ status: 'stopped', ownWorkState: 'open' });

      // Re-enable, then clear the automation while the redelivery's pause
      // unwinds: the entry is still claimed, so the pause settle takes the
      // automation-cleared no-op branch instead of parking again.
      kanbanLanes.update(laneId, { automationEnabled: true });
      databaseManager.get().prepare('UPDATE kanban_lane_entry_events SET status=? WHERE id=?')
        .run('pending', run.laneEntryEventId);
      runSession.mockImplementationOnce(async (retryChildId, prompt, workingDirectory, opts) => {
        expect(retryChildId).toBe(childId);
        kanbanLanes.update(laneId, { automationEnabled: false });
        try {
          await opts.beforeProviderExecute();
        } finally {
          kanbanLanes.update(laneId, {
            onEnterPrompt: null, onEnterTemplateId: null, completionTargetLaneId: null,
          });
        }
      });
      expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);

      expect(entryStatus(run.laneEntryEventId)).toBe('completed');
      expectCardUnblocked({ card, run, childId });

      await expect(routeWorkspaceCard(root.id, lanes[1].id)).resolves.toMatchObject({ status: 'moved' });
      expect(kanbanCards.getById(card.id).laneId).toBe(lanes[1].id);
    });

    it('preserves a truly dispatched session when automation is cleared', async () => {
      kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      // A live provider run attached to a queued entry.
      const child = createSession('Live child', { parentSessionId: root.id });
      attachRootSession(run.id, child.id);
      const childId = child.id;
      databaseManager.get().prepare("UPDATE sessions SET status='running', execution_state='running' WHERE id=?")
        .run(childId);
      databaseManager.get().prepare("UPDATE kanban_lane_entry_events SET status='queued' WHERE id=?")
        .run(run.laneEntryEventId);

      updateLaneWithAutomationToggle(lanes[0].id, {
        onEnterPrompt: null, onEnterTemplateId: null, completionTargetLaneId: null,
      });

      expect(entryStatus(run.laneEntryEventId)).toBe('completed');
      expect(sessions.getById(childId)).toMatchObject({
        status: 'running', executionState: 'running', ownWorkState: 'open', laneRunId: run.id,
      });
      expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });
      expect(runSession).not.toHaveBeenCalled();
    });
  });

  describe('issue 16 — preserved template children retain a removed or replaced follow-up', () => {
    /** Allocate a chained template child, then pause its retry at the fence
     * (undispatched, preserved). Mirrors the issue-13 template pause shape. */
    async function pauseWithChainedTemplateChild() {
      const followupB = sessionTemplates.create({ projectId, name: 'Followup B', prompt: 'b prompt' });
      const followupC = sessionTemplates.create({ projectId, name: 'Followup C', prompt: 'c prompt' });
      const template = sessionTemplates.create({
        projectId, name: 'Entry', prompt: 'do something', nextTemplateId: followupB.id,
      });
      kanbanLanes.update(lanes[0].id, { onEnterTemplateId: template.id });
      const root = createSession('Root');
      const card = kanbanCards.create(lanes[0].id, root.id);
      const run = createLaneRunForEntry({
        projectId, workspaceId: root.id, cardId: card.id, lane: kanbanLanes.getById(lanes[0].id),
      });
      const { setupGitForSession } = await import('./gitSessionSetup.js');

      // Attempt 1: git-setup failure attaches the chained child without dispatch.
      setupGitForSession.mockRejectedValueOnce(new Error('git boom'));
      await expect(drainLaneEntryTrigger(run.laneEntryEventId)).rejects.toThrow();
      const childId = getRun(run.id).rootSessionId;
      expect(childId).toBeTruthy();
      expect(sessions.getById(childId)).toMatchObject({ status: 'starting', nextTemplateId: followupB.id });
      expect(runSession).not.toHaveBeenCalled();

      // Attempt 2: retry pauses at the fence, preserving the chained child.
      databaseManager.get().prepare('UPDATE kanban_lane_entry_events SET next_attempt_at=NULL WHERE id=?')
        .run(run.laneEntryEventId);
      const fakeWt = join(tmpdir(), `kanban-i16-template-wt-${Date.now()}`);
      setupGitForSession.mockImplementationOnce(async () => {
        kanbanLanes.update(lanes[0].id, { automationEnabled: false });
        return { workingDirectory: fakeWt, gitWorktree: fakeWt };
      });
      expect(await drainLaneEntryTrigger(run.laneEntryEventId)).toBe(false);
      expect(runSession).not.toHaveBeenCalled();
      expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });
      return { template, followupB, followupC, root, card, run, childId };
    }

    /** Re-enable the lane and wait for the preserved child to redeliver. */
    async function resumePreservedChild(run) {
      kanbanLanes.update(lanes[0].id, { automationEnabled: true });
      expect(drainQueuedEntries(lanes[0].id).drainedCount).toBe(1);
      await vi.waitFor(() => {
        expect(entryStatus(run.laneEntryEventId)).toBe('completed');
      });
      return sessions.getById(getRun(run.id).rootSessionId);
    }

    function followupsOf(childId) {
      return sessions.getByProjectId(projectId).filter((s) => s.parentSessionId === childId);
    }

    it('pause -> remove follow-up -> resume fires nothing on completion', async () => {
      const { template, root, run, childId } = await pauseWithChainedTemplateChild();

      sessionTemplates.update(template.id, { nextTemplateId: null });

      const child = await resumePreservedChild(run);
      expect(runSession.mock.calls[runSession.mock.calls.length - 1][0]).toBe(childId);
      expect(child).toMatchObject({
        id: childId, parentSessionId: root.id, laneRunId: run.id, nextTemplateId: null,
      });

      // Drive the completion callback path: no follow-up may start.
      const callsBefore = runSession.mock.calls.length;
      await checkAndTriggerNextTemplate(childId);
      expect(runSession.mock.calls.length).toBe(callsBefore);
      expect(followupsOf(childId)).toHaveLength(0);
    });

    it('pause -> replace follow-up B with C -> resume fires only C', async () => {
      const { template, followupC, root, run, childId } = await pauseWithChainedTemplateChild();

      sessionTemplates.update(template.id, { nextTemplateId: followupC.id });

      const child = await resumePreservedChild(run);
      expect(runSession.mock.calls[runSession.mock.calls.length - 1][0]).toBe(childId);
      expect(child).toMatchObject({
        id: childId, parentSessionId: root.id, laneRunId: run.id, nextTemplateId: followupC.id,
      });

      // Drive the completion callback path: only C may start, never B.
      await checkAndTriggerNextTemplate(childId);
      const followups = followupsOf(childId);
      expect(followups).toHaveLength(1);
      expect(followups[0].name).toContain('Followup C');
      expect(sessions.getByProjectId(projectId).filter((s) => s.name.includes('Followup B (from:'))).toHaveLength(0);
    });

    it('template -> prompt replay clears chaining', async () => {
      const { run, childId } = await pauseWithChainedTemplateChild();

      kanbanLanes.update(lanes[0].id, { onEnterTemplateId: null, onEnterPrompt: 'do prompted thing' });

      const child = await resumePreservedChild(run);
      expect(child).toMatchObject({ id: childId, nextTemplateId: null });

      const callsBefore = runSession.mock.calls.length;
      await checkAndTriggerNextTemplate(childId);
      expect(runSession.mock.calls.length).toBe(callsBefore);
      expect(followupsOf(childId)).toHaveLength(0);
    });

    it('same-template retry preserves identity, ownership, and the chain', async () => {
      const { followupB, root, run, childId } = await pauseWithChainedTemplateChild();

      const child = await resumePreservedChild(run);
      expect(child).toMatchObject({
        id: childId, parentSessionId: root.id, laneRunId: run.id, nextTemplateId: followupB.id,
      });
      expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });

      await checkAndTriggerNextTemplate(childId);
      const followups = followupsOf(childId);
      expect(followups).toHaveLength(1);
      expect(followups[0].name).toContain('Followup B');
    });

    it('never rewrites the chain on a child past the provider boundary', async () => {
      const followupB = sessionTemplates.create({ projectId, name: 'Gate B', prompt: 'b' });
      const followupC = sessionTemplates.create({ projectId, name: 'Gate C', prompt: 'c' });
      const root = createSession('Root');
      const childId = sessions.create(projectId, 'Dispatched child', 'prompt', {
        mode: 'yolo', parentSessionId: root.id, status: 'starting',
      }).id;
      sessions.update(childId, { nextTemplateId: followupB.id });
      databaseManager.get().prepare("UPDATE sessions SET status='running', execution_state='running' WHERE id=?")
        .run(childId);

      const refreshed = refreshPreservedChildSettings(
        childId, { mode: 'plan' }, kanbanLanes.getById(lanes[0].id), { nextTemplateId: followupC.id }
      );
      // Other settings still replay, but the dispatched chain is untouched.
      expect(refreshed.mode).toBe('plan');
      expect(refreshed.nextTemplateId).toBe(followupB.id);
    });
  });
});
