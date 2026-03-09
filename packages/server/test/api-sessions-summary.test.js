import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { projects, sessions, sessionSummaries, messages } from '../src/database.js';
import sessionRouter from '../src/api/sessions.js';

// Mock websocket module
vi.mock('../src/websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

describe('PUT /api/sessions/:id/summary', () => {
  let project;
  let session;
  let app;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create express app with the sessions router
    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionRouter);

    // Create test data
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');

    // Add messages to meet MIN_MESSAGES_FOR_SUMMARY threshold (Phase 2)
    // Session creation adds 1 message, so we need 2 more
    messages.create(session.id, 'assistant', 'Response 1');
    messages.create(session.id, 'user', 'Follow-up');
  });

  afterEach(() => {
    // Cleanup
    sessions.delete(session.id);
    projects.delete(project.id);
  });

  it('returns 404 for non-existent session', async () => {
    const response = await request(app)
      .put('/api/sessions/non-existent/summary')
      .send({ shortSummary: 'Test' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Session not found');
  });

  it('creates new summary when none exists', async () => {
    const summaryData = {
      shortSummary: 'Test short summary',
      fullSummary: 'Test full summary with details',
      keyActions: ['Action 1', 'Action 2'],
      filesModified: ['file1.js'],
      outcome: 'completed',
      messageCount: 5,
    };

    const response = await request(app)
      .put(`/api/sessions/${session.id}/summary`)
      .send(summaryData);

    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBe(session.id);
    expect(response.body.shortSummary).toBe('Test short summary');
    expect(response.body.fullSummary).toBe('Test full summary with details');
    expect(response.body.keyActions).toEqual(['Action 1', 'Action 2']);
    expect(response.body.filesModified).toEqual(['file1.js']);
    expect(response.body.outcome).toBe('completed');
    expect(response.body.messageCount).toBe(5);

    // Verify it was saved to database
    const dbSummary = sessionSummaries.getBySessionId(session.id);
    expect(dbSummary).not.toBeNull();
    expect(dbSummary.shortSummary).toBe('Test short summary');
  });

  it('updates existing summary', async () => {
    // Create initial summary
    sessionSummaries.create(session.id, {
      shortSummary: 'Initial',
      fullSummary: 'Initial summary',
      outcome: 'ongoing',
      messageCount: 1,
    });

    const updateData = {
      shortSummary: 'Updated short summary',
      fullSummary: 'Updated full summary',
      keyActions: ['New Action'],
      outcome: 'completed',
      messageCount: 10,
    };

    const response = await request(app)
      .put(`/api/sessions/${session.id}/summary`)
      .send(updateData);

    expect(response.status).toBe(200);
    expect(response.body.shortSummary).toBe('Updated short summary');
    expect(response.body.outcome).toBe('completed');
    expect(response.body.messageCount).toBe(10);

    // Verify it was updated in database (same ID)
    const dbSummary = sessionSummaries.getBySessionId(session.id);
    expect(dbSummary.id).toBe(response.body.id);
    expect(dbSummary.shortSummary).toBe('Updated short summary');
  });

  it('handles partial updates (only provided fields)', async () => {
    // Create initial summary with multiple fields
    sessionSummaries.create(session.id, {
      shortSummary: 'Initial',
      fullSummary: 'Initial full summary',
      keyActions: ['Action 1', 'Action 2'],
      filesModified: ['file1.js'],
      outcome: 'ongoing',
      messageCount: 3,
    });

    // Update only shortSummary
    const response = await request(app)
      .put(`/api/sessions/${session.id}/summary`)
      .send({ shortSummary: 'Only this updated' });

    expect(response.status).toBe(200);
    expect(response.body.shortSummary).toBe('Only this updated');
    expect(response.body.fullSummary).toBe('Initial full summary'); // Unchanged
    expect(response.body.keyActions).toEqual(['Action 1', 'Action 2']); // Unchanged
  });

  it('accepts summary with PR-related fields', async () => {
    const summaryData = {
      shortSummary: 'Test',
      fullSummary: 'Test summary',
      outcome: 'completed',
      messageCount: 5,
      prMerged: true,
      prState: 'merged',
      hasMergeConflicts: false,
      ciStatus: 'success',
      ciFailures: [],
    };

    const response = await request(app)
      .put(`/api/sessions/${session.id}/summary`)
      .send(summaryData);

    expect(response.status).toBe(200);
    expect(response.body.prMerged).toBe(true);
    expect(response.body.prState).toBe('merged');
    expect(response.body.hasMergeConflicts).toBe(false);
    expect(response.body.ciStatus).toBe('success');
    expect(response.body.ciFailures).toEqual([]);
  });

  it('handles JSON arrays correctly', async () => {
    const summaryData = {
      shortSummary: 'Test',
      fullSummary: 'Test summary',
      keyActions: ['Action 1', 'Action 2', 'Action 3'],
      filesModified: ['file1.js', 'file2.ts', 'file3.vue'],
      outcome: 'partial',
      messageCount: 5,
      ciFailures: ['Test failed', 'Lint error'],
    };

    const response = await request(app)
      .put(`/api/sessions/${session.id}/summary`)
      .send(summaryData);

    expect(response.status).toBe(200);
    expect(response.body.keyActions).toEqual(['Action 1', 'Action 2', 'Action 3']);
    expect(response.body.filesModified).toEqual(['file1.js', 'file2.ts', 'file3.vue']);
    expect(response.body.ciFailures).toEqual(['Test failed', 'Lint error']);
  });

  it('handles empty arrays and null values', async () => {
    const summaryData = {
      shortSummary: 'Test',
      fullSummary: 'Test summary',
      keyActions: [],
      filesModified: [],
      outcome: 'ongoing',
      messageCount: 0,
      prMerged: null,
      prState: null,
      hasMergeConflicts: null,
      ciStatus: null,
    };

    const response = await request(app)
      .put(`/api/sessions/${session.id}/summary`)
      .send(summaryData);

    expect(response.status).toBe(200);
    expect(response.body.keyActions).toEqual([]);
    expect(response.body.filesModified).toEqual([]);
    // Note: Boolean fields get stored as false when null is passed
    // This is because the repository converts null to 0 (false) for boolean fields
    expect(response.body.prMerged).toBe(false);
    expect(response.body.prState).toBeNull();
    expect(response.body.hasMergeConflicts).toBe(false);
    expect(response.body.ciStatus).toBeNull();
  });
});
