import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, sessionSummaries } from '../database.js';

// Mock gitService (required by sessions router)
vi.mock('../services/gitService.js', () => ({
  getOriginDefaultBranch: vi.fn(),
  getModifiedFilesCount: vi.fn(),
}));

// Import after mocking
import sessionsRouter from './sessions.js';

describe('Sessions API - Batch Summaries Endpoint', () => {
  let app;
  let project;
  let session1;
  let session2;
  let session3;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    // Create test data
    project = projects.create('Test Project', '/tmp/test-repo');
    session1 = sessions.create(project.id, 'Session 1', 'Prompt 1');
    session2 = sessions.create(project.id, 'Session 2', 'Prompt 2');
    session3 = sessions.create(project.id, 'Session 3', 'Prompt 3');
  });

  describe('POST /api/sessions/summaries/batch', () => {
    it('returns summaries for sessions that have them', async () => {
      sessionSummaries.create(session1.id, {
        shortSummary: 'Summary for session 1',
        fullSummary: 'Full summary 1',
      });
      sessionSummaries.create(session2.id, {
        shortSummary: 'Summary for session 2',
        fullSummary: 'Full summary 2',
      });

      const res = await request(app)
        .post('/api/sessions/summaries/batch')
        .send({ ids: [session1.id, session2.id] })
        .expect(200);

      expect(res.body[session1.id]).not.toBeNull();
      expect(res.body[session1.id].shortSummary).toBe('Summary for session 1');
      expect(res.body[session2.id]).not.toBeNull();
      expect(res.body[session2.id].shortSummary).toBe('Summary for session 2');
    });

    it('returns null for sessions without summaries', async () => {
      sessionSummaries.create(session1.id, {
        shortSummary: 'Summary for session 1',
        fullSummary: 'Full summary 1',
      });

      const res = await request(app)
        .post('/api/sessions/summaries/batch')
        .send({ ids: [session1.id, session2.id] })
        .expect(200);

      expect(res.body[session1.id]).not.toBeNull();
      expect(res.body[session1.id].shortSummary).toBe('Summary for session 1');
      expect(res.body[session2.id]).toBeNull();
    });

    it('returns null for all IDs when no summaries exist', async () => {
      const res = await request(app)
        .post('/api/sessions/summaries/batch')
        .send({ ids: [session1.id, session2.id, session3.id] })
        .expect(200);

      expect(res.body[session1.id]).toBeNull();
      expect(res.body[session2.id]).toBeNull();
      expect(res.body[session3.id]).toBeNull();
    });

    it('returns all requested IDs in the response map', async () => {
      const res = await request(app)
        .post('/api/sessions/summaries/batch')
        .send({ ids: [session1.id, session2.id, session3.id] })
        .expect(200);

      expect(Object.keys(res.body)).toHaveLength(3);
      expect(res.body).toHaveProperty(session1.id);
      expect(res.body).toHaveProperty(session2.id);
      expect(res.body).toHaveProperty(session3.id);
    });

    it('works with a single session ID', async () => {
      sessionSummaries.create(session1.id, {
        shortSummary: 'Only summary',
        fullSummary: 'Full',
      });

      const res = await request(app)
        .post('/api/sessions/summaries/batch')
        .send({ ids: [session1.id] })
        .expect(200);

      expect(Object.keys(res.body)).toHaveLength(1);
      expect(res.body[session1.id].shortSummary).toBe('Only summary');
    });

    it('handles non-existent session IDs gracefully (returns null)', async () => {
      const res = await request(app)
        .post('/api/sessions/summaries/batch')
        .send({ ids: ['non-existent-1', 'non-existent-2'] })
        .expect(200);

      expect(res.body['non-existent-1']).toBeNull();
      expect(res.body['non-existent-2']).toBeNull();
    });

    it('returns 400 when ids is not provided', async () => {
      const res = await request(app)
        .post('/api/sessions/summaries/batch')
        .send({})
        .expect(400);

      expect(res.body.error).toBe('ids array is required and must not be empty');
    });

    it('returns 400 when ids is an empty array', async () => {
      const res = await request(app)
        .post('/api/sessions/summaries/batch')
        .send({ ids: [] })
        .expect(400);

      expect(res.body.error).toBe('ids array is required and must not be empty');
    });

    it('returns 400 when ids is not an array', async () => {
      const res = await request(app)
        .post('/api/sessions/summaries/batch')
        .send({ ids: 'not-an-array' })
        .expect(400);

      expect(res.body.error).toBe('ids array is required and must not be empty');
    });

    it('returns full summary data in each entry', async () => {
      sessionSummaries.create(session1.id, {
        shortSummary: 'Short',
        fullSummary: 'Full details',
        keyActions: ['action1', 'action2'],
        filesModified: ['file.js'],
        outcome: 'success',
        messageCount: 15,
      });

      const res = await request(app)
        .post('/api/sessions/summaries/batch')
        .send({ ids: [session1.id] })
        .expect(200);

      const summary = res.body[session1.id];
      expect(summary.shortSummary).toBe('Short');
      expect(summary.fullSummary).toBe('Full details');
      expect(summary.keyActions).toEqual(['action1', 'action2']);
      expect(summary.filesModified).toEqual(['file.js']);
      expect(summary.outcome).toBe('success');
      expect(summary.messageCount).toBe(15);
      expect(summary.sessionId).toBe(session1.id);
    });

    it('handles mix of existing and non-existing summaries', async () => {
      sessionSummaries.create(session1.id, {
        shortSummary: 'Exists',
        fullSummary: 'Full',
      });

      const res = await request(app)
        .post('/api/sessions/summaries/batch')
        .send({ ids: [session1.id, session2.id, 'non-existent'] })
        .expect(200);

      expect(res.body[session1.id]).not.toBeNull();
      expect(res.body[session1.id].shortSummary).toBe('Exists');
      expect(res.body[session2.id]).toBeNull();
      expect(res.body['non-existent']).toBeNull();
    });
  });
});
