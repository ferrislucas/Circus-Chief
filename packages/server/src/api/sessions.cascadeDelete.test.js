import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, messages, canvasItems, sessionNotes } from '../database.js';

// Mock websocket before importing the router
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock sessionManager
vi.mock('../services/sessionManager.js', () => ({
  continueSession: vi.fn().mockResolvedValue(undefined),
  stopSession: vi.fn().mockResolvedValue(undefined),
  restartSession: vi.fn(),
  cleanupActiveSession: vi.fn(),
}));

// Mock summaryService
vi.mock('../services/summaryService.js', () => ({
  propagatePrUrlToParent: vi.fn(),
  cleanupSession: vi.fn(),
  getSummary: vi.fn(),
  regenerateSummary: vi.fn(),
}));

// Mock gitService
vi.mock('../services/gitService.js', () => ({
  getOriginDefaultBranch: vi.fn().mockResolvedValue('main'),
  getModifiedFilesCount: vi.fn().mockResolvedValue(0),
  removeWorktree: vi.fn().mockResolvedValue(undefined),
}));

// Mock hookService
vi.mock('../services/hookService.js', () => ({
  executeHookAsync: vi.fn(),
}));

// Mock slashCommandService
vi.mock('../services/slashCommandService.js', () => ({
  resolvePromptSkillOrCommand: vi.fn().mockResolvedValue(null),
}));

// Mock draftSessionService
vi.mock('../services/draftSessionService.js', () => ({
  validateDraftSession: vi.fn().mockReturnValue({ valid: true }),
  startDraft: vi.fn(),
  DraftSessionError: class extends Error {},
}));

// Mock scheduleService
vi.mock('../services/scheduleService.js', () => ({
  configureSchedule: vi.fn(),
  ScheduleError: class extends Error {},
}));

// Mock sessionDuplicator
vi.mock('../services/sessionDuplicator.js', () => ({
  duplicateSession: vi.fn(),
}));

// Mock commandRunner
vi.mock('../services/commandRunner.js', () => ({
  commandRunner: {
    getRunsBySession: vi.fn().mockReturnValue([]),
  },
}));

// Mock upload middleware
vi.mock('../middleware/upload.js', () => ({
  upload: { array: () => (req, res, next) => next() },
  handleUploadError: (err, req, res, next) => next(),
}));

import sessionsRouter from './sessions.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { cleanupActiveSession } from '../services/sessionManager.js';
import { cleanupSession as summaryCleanupSession } from '../services/summaryService.js';

describe('Sessions API - DELETE cascade', () => {
  let app;
  let projectId;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    const project = projects.create('Cascade Test Project', '/tmp/test');
    projectId = project.id;
  });

  it('deletes direct children when parent is deleted', async () => {
    const parent = sessions.create(projectId, 'Parent', 'prompt');
    const child1 = sessions.create(projectId, 'Child 1', 'prompt', { parentSessionId: parent.id });
    const child2 = sessions.create(projectId, 'Child 2', 'prompt', { parentSessionId: parent.id });

    const res = await request(app).delete(`/api/sessions/${parent.id}`);

    expect(res.status).toBe(204);
    expect(sessions.getById(parent.id)).toBeNull();
    expect(sessions.getById(child1.id)).toBeNull();
    expect(sessions.getById(child2.id)).toBeNull();
  });

  it('cascades deletion to grandchildren', async () => {
    const grandparent = sessions.create(projectId, 'Grandparent', 'prompt');
    const parent = sessions.create(projectId, 'Parent', 'prompt', { parentSessionId: grandparent.id });
    const child = sessions.create(projectId, 'Child', 'prompt', { parentSessionId: parent.id });

    const res = await request(app).delete(`/api/sessions/${grandparent.id}`);

    expect(res.status).toBe(204);
    expect(sessions.getById(grandparent.id)).toBeNull();
    expect(sessions.getById(parent.id)).toBeNull();
    expect(sessions.getById(child.id)).toBeNull();
  });

  it('cascades deletion of child messages and canvas items', async () => {
    const parent = sessions.create(projectId, 'Parent', 'prompt');
    const child = sessions.create(projectId, 'Child', 'prompt', { parentSessionId: parent.id });

    // Child has messages (created automatically via sessions.create) and a canvas item
    const childMessagesBefore = messages.getBySessionId(child.id);
    expect(childMessagesBefore.length).toBeGreaterThan(0);

    canvasItems.create(child.id, { type: 'markdown', content: 'Child canvas', filename: 'child.md' });

    await request(app).delete(`/api/sessions/${parent.id}`);

    // Child is gone
    expect(sessions.getById(child.id)).toBeNull();

    // Child messages are gone (cascade in DB handles this)
    expect(messages.getBySessionId(child.id)).toEqual([]);

    // Child canvas items are gone
    expect(canvasItems.getBySessionId(child.id)).toEqual([]);
  });

  it('cascades deletion of child session notes', async () => {
    const parent = sessions.create(projectId, 'Parent', 'prompt');
    const child = sessions.create(projectId, 'Child', 'prompt', { parentSessionId: parent.id });

    sessionNotes.create(child.id, 'Important note');

    await request(app).delete(`/api/sessions/${parent.id}`);

    expect(sessions.getById(child.id)).toBeNull();
    expect(sessionNotes.getBySessionId(child.id)).toEqual([]);
  });

  it('does not delete parent when child is deleted', async () => {
    const parent = sessions.create(projectId, 'Parent', 'prompt');
    const child = sessions.create(projectId, 'Child', 'prompt', { parentSessionId: parent.id });

    const res = await request(app).delete(`/api/sessions/${child.id}`);

    expect(res.status).toBe(204);
    expect(sessions.getById(child.id)).toBeNull();
    expect(sessions.getById(parent.id)).toBeTruthy();
  });

  it('only deletes children of the deleted parent, not unrelated sessions', async () => {
    const parent1 = sessions.create(projectId, 'Parent 1', 'prompt');
    const parent2 = sessions.create(projectId, 'Parent 2', 'prompt');
    const child1 = sessions.create(projectId, 'Child 1', 'prompt', { parentSessionId: parent1.id });
    const child2 = sessions.create(projectId, 'Child 2', 'prompt', { parentSessionId: parent2.id });

    await request(app).delete(`/api/sessions/${parent1.id}`);

    // parent1 tree deleted
    expect(sessions.getById(parent1.id)).toBeNull();
    expect(sessions.getById(child1.id)).toBeNull();
    // parent2 tree intact
    expect(sessions.getById(parent2.id)).toBeTruthy();
    expect(sessions.getById(child2.id)).toBeTruthy();
  });

  it('handles deleting a session with no children', async () => {
    const session = sessions.create(projectId, 'Solo', 'prompt');

    const res = await request(app).delete(`/api/sessions/${session.id}`);

    expect(res.status).toBe(204);
    expect(sessions.getById(session.id)).toBeNull();
  });

  it('calls cleanupActiveSession for each deleted descendant', async () => {
    const parent = sessions.create(projectId, 'Parent', 'prompt');
    const child = sessions.create(projectId, 'Child', 'prompt', { parentSessionId: parent.id });

    await request(app).delete(`/api/sessions/${parent.id}`);

    // cleanupActiveSession is called for child first, then parent
    expect(cleanupActiveSession).toHaveBeenCalledWith(child.id);
    expect(cleanupActiveSession).toHaveBeenCalledWith(parent.id);
  });

  it('calls summaryCleanupSession for each deleted descendant', async () => {
    const parent = sessions.create(projectId, 'Parent', 'prompt');
    const child = sessions.create(projectId, 'Child', 'prompt', { parentSessionId: parent.id });

    await request(app).delete(`/api/sessions/${parent.id}`);

    expect(summaryCleanupSession).toHaveBeenCalledWith(child.id);
    expect(summaryCleanupSession).toHaveBeenCalledWith(parent.id);
  });

  it('broadcasts SESSION_DELETED to session subscribers for each deleted session', async () => {
    const parent = sessions.create(projectId, 'Parent', 'prompt');
    const child = sessions.create(projectId, 'Child', 'prompt', { parentSessionId: parent.id });

    await request(app).delete(`/api/sessions/${parent.id}`);

    // broadcastToSession is called once per deleted session (child then parent)
    const sessionCalls = broadcastToSession.mock.calls.map(c => c[0]);
    expect(sessionCalls).toContain(child.id);
    expect(sessionCalls).toContain(parent.id);
  });

  it('broadcasts SESSION_DELETED to project subscribers for each deleted session', async () => {
    const parent = sessions.create(projectId, 'Parent', 'prompt');
    const child1 = sessions.create(projectId, 'Child 1', 'prompt', { parentSessionId: parent.id });
    const child2 = sessions.create(projectId, 'Child 2', 'prompt', { parentSessionId: parent.id });

    await request(app).delete(`/api/sessions/${parent.id}`);

    // broadcastToProject should be called for parent and each child
    const projectCalls = broadcastToProject.mock.calls.map(c => c[2]);
    const deletedSessionIds = projectCalls.map(c => c?.sessionId).filter(Boolean);
    expect(deletedSessionIds).toContain(parent.id);
    expect(deletedSessionIds).toContain(child1.id);
    expect(deletedSessionIds).toContain(child2.id);
  });
});
