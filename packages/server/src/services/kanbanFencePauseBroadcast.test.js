import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
  broadcastToSession: vi.fn(),
}));

vi.mock('./templateTriggerService.js', () => ({
  renderTemplatePrompt: vi.fn().mockResolvedValue('rendered prompt'),
  getRootSession: vi.fn((session) => session),
}));

import {
  kanbanBoards,
  kanbanLanes,
  kanbanCards,
  projects,
  sessions,
  modelProviders,
} from '../database.js';
import { broadcastToProject, broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { agentGateway } from '../agents/AgentGateway.js';
import { triggerOnEnterPrompt, assertLaneAutomationActive } from './kanbanTriggers.js';
import { abandonPausedTriggerChild } from './kanbanAbandon.js';
import { createLaneRunForEntry, attachRootSession, getRun } from './workflowSessionService.js';

// ── PR Review issue 11: provider-boundary pause must notify lifecycle ──────
// settleFenceParkedExecutionState writes stopped/stopped with no broadcast,
// so when the pause path reuses that already-settled child,
// settlePreservedChildForPause early-returns and stays silent too. Subscribed
// clients keep showing a running child until refresh.

const MODEL_ID = 'gpt-4o-fence-broadcast';

function stubAgent() {
  return {
    execute: vi.fn(async function* () {
      yield { type: 'result', success: true };
    }),
    supportsResume: () => false,
    needsConversationContext: () => false,
  };
}

describe('kanban provider-fence pause broadcasts', () => {
  let projectId;
  let lane;
  let tempDir;
  let openaiProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), 'fence-broadcast-'));
    openaiProvider = modelProviders.create({
      name: 'Fence Broadcast Provider',
      baseUrl: 'https://api.openai.fence-broadcast',
      authToken: 'key-fence-broadcast',
      kind: 'openai',
    });
    modelProviders.addModel(openaiProvider.id, {
      modelId: MODEL_ID,
      displayName: 'Fence Broadcast',
      tier: 'custom',
    });

    const project = projects.create('Fence Broadcast Project', tempDir);
    projectId = project.id;
    const board = kanbanBoards.create(projectId);
    const lanes = kanbanLanes.getByBoardId(board.id);
    kanbanLanes.update(lanes[0].id, { onEnterPrompt: 'do something' });
    lane = kanbanLanes.getById(lanes[0].id);

    vi.spyOn(agentGateway, 'createAgent').mockReturnValue(stubAgent());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { modelProviders.delete(openaiProvider.id); } catch { /* noop */ }
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /** Retry shape: a prior attempt attached child C1 to an open run. */
  function setupRetryChild() {
    const root = sessions.create(projectId, 'Root', 'root prompt', {
      agentType: 'codex',
      model: MODEL_ID,
    });
    const card = kanbanCards.create(lane.id, root.id);
    const run = createLaneRunForEntry({
      projectId,
      workspaceId: root.id,
      cardId: card.id,
      lane: kanbanLanes.getById(lane.id),
    });
    const child = sessions.create(projectId, 'Lane prompt (lane: Backlog)', 'child prompt', {
      agentType: 'codex',
      model: MODEL_ID,
      status: 'starting',
      parentSessionId: root.id,
    });
    attachRootSession(run.id, child.id);
    return { root, card, run, child };
  }

  function projectUpdatedNotices(childId) {
    return broadcastToProject.mock.calls.filter(
      (call) => call[1] === WS_MESSAGE_TYPES.SESSION_UPDATED && call[2]?.sessionId === childId,
    );
  }

  function sessionUpdatedNotices(childId) {
    return broadcastToSession.mock.calls.filter(
      (call) => call[1] === WS_MESSAGE_TYPES.SESSION_UPDATED && call[2]?.sessionId === childId,
    );
  }

  it('emits stopped-state notifications on both lifecycle channels when the real provider fence parks a preserved retry child', async () => {
    const { root, run, child } = setupRetryChild();
    const childId = child.id;
    broadcastToProject.mockClear();
    broadcastToSession.mockClear();

    const assertLaneEnabled = () => assertLaneAutomationActive(lane.id);
    const beforeDispatch = async () => {
      // The disable lands after fence 1/broadcast but before the provider
      // boundary inside the REAL runSession, so the real execution fence
      // rejects with LANE_AUTOMATION_DISABLED.
      kanbanLanes.update(lane.id, { automationEnabled: false });
    };

    await expect(triggerOnEnterPrompt(root.id, kanbanLanes.getById(lane.id), {
      laneRunId: run.id,
      childSessionId: childId,
      assertLaneEnabled,
      beforeDispatch,
    })).rejects.toMatchObject({ code: 'LANE_AUTOMATION_DISABLED' });

    // Durable state settles (already true before the fix).
    expect(sessions.getById(childId)).toMatchObject({ status: 'stopped', executionState: 'stopped' });

    // The settled stopped state reaches project-channel subscribers...
    const projectNotices = projectUpdatedNotices(childId);
    expect(projectNotices.length).toBeGreaterThan(0);
    expect(projectNotices[projectNotices.length - 1][2].session.status).toBe('stopped');

    // ...and per-session subscribers (session detail view).
    const sessionNotices = sessionUpdatedNotices(childId);
    expect(sessionNotices.length).toBeGreaterThan(0);
    expect(sessionNotices[sessionNotices.length - 1][2].session.status).toBe('stopped');
  });

  it('still emits the stopped-state notification when the preserved child is already settled', async () => {
    const { run, child } = setupRetryChild();
    const childId = child.id;
    // Simulate the provider-fence durable write landing before the pause path.
    sessions.update(childId, { status: 'stopped', executionState: 'stopped' });
    broadcastToProject.mockClear();
    broadcastToSession.mockClear();

    await abandonPausedTriggerChild({
      laneRunId: run.id,
      childSessionId: childId,
      createdChildId: null,
      allocatedWorktree: null,
    });

    // No second write is needed, but the obligation stays intact...
    expect(sessions.getById(childId)).toMatchObject({ status: 'stopped', executionState: 'stopped' });
    expect(getRun(run.id)).toMatchObject({ status: 'open', rootSessionId: childId });

    // ...and subscribers still hear the settled state.
    const notices = projectUpdatedNotices(childId);
    expect(notices.length).toBeGreaterThan(0);
    expect(notices[notices.length - 1][2].session.status).toBe('stopped');
  });
});
