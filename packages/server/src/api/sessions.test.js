import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions } from '../database.js';

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

describe('Sessions API - PATCH effortLevel', () => {
  let app;
  let projectId;
  let sessionId;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    const project = projects.create('Test Project', '/tmp/test');
    projectId = project.id;
    const session = sessions.create(projectId, 'Test Session', 'hello');
    sessionId = session.id;
  });

  it('updates effortLevel to a valid value', async () => {
    const res = await request(app)
      .patch(`/api/sessions/${sessionId}`)
      .send({ effortLevel: 'high' });

    expect(res.status).toBe(200);
    expect(res.body.effortLevel).toBe('high');

    // Verify persistence
    const updated = sessions.getById(sessionId);
    expect(updated.effortLevel).toBe('high');
  });

  it('accepts all valid effortLevel enum values', async () => {
    for (const effortLevel of ['low', 'medium', 'high', 'max', 'auto']) {
      const res = await request(app)
        .patch(`/api/sessions/${sessionId}`)
        .send({ effortLevel });

      expect(res.status).toBe(200);
      expect(res.body.effortLevel).toBe(effortLevel);
    }
  });

  it('allows setting effortLevel to null', async () => {
    // First set it to a value
    await request(app)
      .patch(`/api/sessions/${sessionId}`)
      .send({ effortLevel: 'high' });

    // Then clear it
    const res = await request(app)
      .patch(`/api/sessions/${sessionId}`)
      .send({ effortLevel: null });

    expect(res.status).toBe(200);
    expect(res.body.effortLevel).toBeNull();
  });

  it('rejects invalid effortLevel value', async () => {
    const res = await request(app)
      .patch(`/api/sessions/${sessionId}`)
      .send({ effortLevel: 'turbo' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid effort level');
  });

  it('does not update effortLevel when not provided', async () => {
    // Set initial value
    await request(app)
      .patch(`/api/sessions/${sessionId}`)
      .send({ effortLevel: 'high' });

    // Update something else
    const res = await request(app)
      .patch(`/api/sessions/${sessionId}`)
      .send({ name: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.effortLevel).toBe('high');
    expect(res.body.name).toBe('New Name');
  });

  it('updates effortLevel together with other fields', async () => {
    const res = await request(app)
      .patch(`/api/sessions/${sessionId}`)
      .send({
        effortLevel: 'max',
        thinkingEnabled: true,
        name: 'Updated Session',
      });

    expect(res.status).toBe(200);
    expect(res.body.effortLevel).toBe('max');
    expect(res.body.thinkingEnabled).toBe(true);
    expect(res.body.name).toBe('Updated Session');
  });
});
