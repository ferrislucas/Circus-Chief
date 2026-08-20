import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions, kanbanBoards, kanbanCards, kanbanLanes } from '../database.js';
import { databaseManager } from '../db/DatabaseManager.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
}));

import { broadcastToProject } from '../websocket.js';
import { recoverOrphanedStartingSessions, recoverOrphanedRunningSessions } from './sessionStartupRecovery.js';
import { attachRootSession, createLaneRunForEntry, getRun } from './workflowSessionService.js';

function createProject() {
  return projects.create('Test Project', '/tmp/test');
}

function createSessionWithStatus(projectId, status) {
  return sessions.create(projectId, 'test session', 'hello', { status });
}

function backdateSession(sessionId, msAgo) {
  databaseManager.get().prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
    Date.now() - msAgo,
    sessionId
  );
}

describe('recoverOrphanedStartingSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks an old starting session as error', () => {
    const project = createProject();
    const session = createSessionWithStatus(project.id, 'starting');
    backdateSession(session.id, 5000); // 5 s ago — older than 1 s threshold

    const { recovered } = recoverOrphanedStartingSessions();
    expect(recovered).toBe(1);

    const updated = sessions.getById(session.id);
    expect(updated.status).toBe('error');
    expect(updated.error).toMatch(/orphaned/i);
  });

  it('recovers a freshly-updated starting session because startup cannot survive a restart', () => {
    const project = createProject();
    const session = createSessionWithStatus(project.id, 'starting');

    const { recovered } = recoverOrphanedStartingSessions();
    expect(recovered).toBe(1);
    expect(sessions.getById(session.id).status).toBe('error');
  });

  it('leaves running sessions alone even when old', () => {
    const project = createProject();
    const session = createSessionWithStatus(project.id, 'running');
    backdateSession(session.id, 5000);

    const { recovered } = recoverOrphanedStartingSessions();
    expect(recovered).toBe(0);

    expect(sessions.getById(session.id).status).toBe('running');
  });

  it('leaves waiting, stopped, and error sessions alone', () => {
    const project = createProject();

    for (const status of ['waiting', 'stopped', 'error']) {
      const s = createSessionWithStatus(project.id, status);
      backdateSession(s.id, 5000);
    }

    const { recovered } = recoverOrphanedStartingSessions();
    expect(recovered).toBe(0);
  });

  it('broadcasts SESSION_UPDATED for each recovered session', () => {
    const project = createProject();
    const session = createSessionWithStatus(project.id, 'starting');
    backdateSession(session.id, 5000);

    recoverOrphanedStartingSessions();

    expect(broadcastToProject).toHaveBeenCalledWith(
      project.id,
      WS_MESSAGE_TYPES.SESSION_UPDATED,
      expect.objectContaining({ sessionId: session.id })
    );
  });

  it('closes a starting worker workflow obligation while retaining the failed-run card details', () => {
    const project = createProject();
    const board = kanbanBoards.create(project.id);
    const [source, target] = kanbanLanes.getByBoardId(board.id);
    const root = sessions.create(project.id, 'root', 'hello');
    const card = kanbanCards.create(source.id, root.id);
    const worker = sessions.create(project.id, 'worker', 'hello', {
      parentSessionId: root.id,
      status: 'starting',
    });
    const run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: root.id,
      cardId: card.id,
      lane: { ...source, onEnterPrompt: 'work', completionTargetLaneId: target.id },
    });
    attachRootSession(run.id, worker.id);

    backdateSession(worker.id, 5000);
    recoverOrphanedStartingSessions();

    expect(sessions.getById(worker.id)).toMatchObject({
      status: 'error', executionState: 'stopped', ownWorkState: 'closed_failed',
    });
    expect(getRun(run.id).status).not.toBe('open');
    expect(kanbanCards.getById(card.id).activeLaneRunId).toBe(run.id);
  });
});

describe('recoverOrphanedRunningSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops a running session left behind by a previous process', () => {
    const project = createProject();
    const session = createSessionWithStatus(project.id, 'running');

    const { recovered } = recoverOrphanedRunningSessions();
    expect(recovered).toBe(1);

    const updated = sessions.getById(session.id);
    expect(updated.status).toBe('stopped');
    expect(updated.executionState).toBe('stopped');
  });

  it('recovers a freshly-updated running session, since no cutoff applies', () => {
    // Agent processes never outlive the server, so recency is not evidence of
    // liveness — a 'running' row at boot is always an orphan.
    const project = createProject();
    const session = createSessionWithStatus(project.id, 'running');

    expect(recoverOrphanedRunningSessions().recovered).toBe(1);
    expect(sessions.getById(session.id).status).toBe('stopped');
  });

  it('leaves non-running sessions alone', () => {
    const project = createProject();
    for (const status of ['waiting', 'stopped', 'error', 'starting', 'scheduled']) {
      createSessionWithStatus(project.id, status);
    }

    expect(recoverOrphanedRunningSessions().recovered).toBe(0);
  });

  it('broadcasts SESSION_UPDATED for each recovered session', () => {
    const project = createProject();
    const session = createSessionWithStatus(project.id, 'running');

    recoverOrphanedRunningSessions();

    expect(broadcastToProject).toHaveBeenCalledWith(
      project.id,
      WS_MESSAGE_TYPES.SESSION_UPDATED,
      expect.objectContaining({ sessionId: session.id })
    );
  });
});
