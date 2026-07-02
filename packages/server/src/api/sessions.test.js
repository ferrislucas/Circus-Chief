import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, commandButtons, commandRuns, sessionSummaries } from '../database.js';

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
  saveManualSummary: vi.fn(),
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
import * as summaryService from '../services/summaryService.js';

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
      // 'auto' is normalized to null
      const expectedValue = effortLevel === 'auto' ? null : effortLevel;
      expect(res.body.effortLevel).toBe(expectedValue);
    }
  });

  it('normalizes effortLevel "auto" to null', async () => {
    const res = await request(app)
      .patch(`/api/sessions/${sessionId}`)
      .send({ effortLevel: 'auto' });

    expect(res.status).toBe(200);
    expect(res.body.effortLevel).toBeNull();

    // Verify persistence
    const updated = sessions.getById(sessionId);
    expect(updated.effortLevel).toBeNull();
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

  it('rejects invalid model values with the valid model id list', async () => {
    const res = await request(app)
      .patch(`/api/sessions/${sessionId}`)
      .send({ model: 'not-a-real-model' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid model id "not-a-real-model"');
    expect(res.body.error).toContain('Valid model ids are:');
    expect(res.body.error).toContain('gpt-5.5');
  });

  it('updates model to a valid model id', async () => {
    const res = await request(app)
      .patch(`/api/sessions/${sessionId}`)
      .send({ model: 'opus' });

    expect(res.status).toBe(200);
    expect(res.body.model).toBe('opus');
    expect(sessions.getById(sessionId).model).toBe('opus');
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

describe('Sessions API - workflow-root command metadata', () => {
  let app;
  let project;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Test Project', '/tmp/test');
  });

  it('returns requested child session details with latestCommandRuns from the workflow root', async () => {
    const root = sessions.create(project.id, 'Root Session', 'root prompt');
    const child = sessions.create(project.id, 'Child Session', 'child prompt', {
      mode: 'standard',
      parentSessionId: root.id,
    });
    const button = commandButtons.create({ projectId: project.id, label: 'Build', command: 'echo build' });
    commandRuns.create({ id: 'root-run', sessionId: root.id, buttonId: button.id });
    commandRuns.complete('root-run', 0, 'done');

    const res = await request(app).get(`/api/sessions/${child.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(child.id);
    expect(res.body.parentSessionId).toBe(root.id);
    expect(res.body.latestCommandRuns).toEqual([
      expect.objectContaining({
        buttonId: button.id,
        runId: 'root-run',
        output: 'done',
      }),
    ]);
  });
});

describe('Sessions API - workflow summary routes', () => {
  let app;
  let project;
  let root;
  let child;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Test Project', '/tmp/test');
    root = sessions.create(project.id, 'Root Session', 'root prompt');
    child = sessions.create(project.id, 'Child Session', 'child prompt', {
      mode: 'standard',
      parentSessionId: root.id,
    });
  });

  it('gets workflow root summary through a child session', async () => {
    summaryService.getSummary.mockResolvedValueOnce({ sessionId: root.id, summary: 'root summary' });

    const res = await request(app).get(`/api/sessions/${child.id}/summary?generate=true`);

    expect(res.status).toBe(200);
    expect(summaryService.getSummary).toHaveBeenCalledWith(root.id, true);
    expect(res.body.sessionId).toBe(root.id);
  });

  it('regenerates workflow root summary through a child session', async () => {
    summaryService.regenerateSummary.mockResolvedValueOnce({ sessionId: root.id, summary: 'new summary' });

    const res = await request(app).post(`/api/sessions/${child.id}/summary`);

    expect(res.status).toBe(201);
    expect(summaryService.regenerateSummary).toHaveBeenCalledWith(root.id);
    expect(res.body.sessionId).toBe(root.id);
  });

  it('updates workflow root summary through a child session via saveManualSummary', async () => {
    const mockSummary = { id: 'sum-1', sessionId: root.id, shortSummary: 'Manual', fullSummary: 'manual summary' };
    summaryService.saveManualSummary.mockReturnValueOnce(mockSummary);

    const res = await request(app)
      .put(`/api/sessions/${child.id}/summary`)
      .send({ shortSummary: 'Manual', fullSummary: 'manual summary' });

    expect(res.status).toBe(200);
    // saveManualSummary should be called with the child session ID (not root) —
    // the service itself resolves to the root internally
    expect(summaryService.saveManualSummary).toHaveBeenCalledWith(
      child.id,
      expect.objectContaining({ shortSummary: 'Manual', fullSummary: 'manual summary' })
    );
    expect(res.body.sessionId).toBe(root.id);
  });

  it('returns scope=session summary for the exact requested session', async () => {
    // Create a summary directly on the child session
    sessionSummaries.create(child.id, {
      shortSummary: 'Child-specific summary',
      fullSummary: 'Child full',
      outcome: 'completed',
    });

    const res = await request(app).get(`/api/sessions/${child.id}/summary?scope=session`);

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(child.id);
    expect(res.body.shortSummary).toBe('Child-specific summary');
    // getSummary should NOT have been called (scope=session bypasses generation)
    expect(summaryService.getSummary).not.toHaveBeenCalled();
  });

  it('returns 404 when scope=session and the session has no summary', async () => {
    // child has no summary
    const res = await request(app).get(`/api/sessions/${child.id}/summary?scope=session`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Summary not found');
  });

  it('scope=session ignores generate=true query param', async () => {
    // No summary for child
    const res = await request(app).get(
      `/api/sessions/${child.id}/summary?scope=session&generate=true`
    );

    expect(res.status).toBe(404);
    // Should not trigger LLM generation
    expect(summaryService.getSummary).not.toHaveBeenCalled();
  });
});
