import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions } from '../database.js';
import { databaseManager } from '../db/DatabaseManager.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
}));

import { broadcastToProject } from '../websocket.js';
import { recoverStaleStartingSessions } from './sessionStartupRecovery.js';

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

describe('recoverStaleStartingSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Use a short threshold so we can reliably trigger recovery in tests
    process.env.STALE_STARTING_THRESHOLD_MS = '1000'; // 1 second
  });

  it('marks an old starting session as error', () => {
    const project = createProject();
    const session = createSessionWithStatus(project.id, 'starting');
    backdateSession(session.id, 5000); // 5 s ago — older than 1 s threshold

    const { recovered } = recoverStaleStartingSessions();
    expect(recovered).toBe(1);

    const updated = sessions.getById(session.id);
    expect(updated.status).toBe('error');
    expect(updated.error).toMatch(/stale/i);
  });

  it('leaves a recent starting session alone', () => {
    const project = createProject();
    createSessionWithStatus(project.id, 'starting');
    // updated_at is "now" by default — not older than the 1 s threshold

    const { recovered } = recoverStaleStartingSessions();
    expect(recovered).toBe(0);
  });

  it('leaves running sessions alone even when old', () => {
    const project = createProject();
    const session = createSessionWithStatus(project.id, 'running');
    backdateSession(session.id, 5000);

    const { recovered } = recoverStaleStartingSessions();
    expect(recovered).toBe(0);

    expect(sessions.getById(session.id).status).toBe('running');
  });

  it('leaves waiting, stopped, and error sessions alone', () => {
    const project = createProject();

    for (const status of ['waiting', 'stopped', 'error']) {
      const s = createSessionWithStatus(project.id, status);
      backdateSession(s.id, 5000);
    }

    const { recovered } = recoverStaleStartingSessions();
    expect(recovered).toBe(0);
  });

  it('broadcasts SESSION_UPDATED for each recovered session', () => {
    const project = createProject();
    const session = createSessionWithStatus(project.id, 'starting');
    backdateSession(session.id, 5000);

    recoverStaleStartingSessions();

    expect(broadcastToProject).toHaveBeenCalledWith(
      project.id,
      WS_MESSAGE_TYPES.SESSION_UPDATED,
      expect.objectContaining({ sessionId: session.id })
    );
  });
});
