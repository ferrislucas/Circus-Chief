import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, sessionNotes } from '../database.js';

// Mock websocket before importing the router
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock sessionManager
vi.mock('../services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
  continueSession: vi.fn().mockResolvedValue(undefined),
  stopSession: vi.fn(),
  restartSession: vi.fn(),
}));

// Mock summaryService
vi.mock('../services/summaryService.js', () => ({
  getSummary: vi.fn().mockResolvedValue(null),
}));

// Import after mocks are set up
import sessionsRouter from './sessions.js';

describe('Sessions API - Notes Routes (sessions-notes.js)', () => {
  let app;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
    sessions.update(session.id, { status: 'waiting' });
  });

  describe('GET /api/sessions/:id/notes', () => {
    it('returns empty array when no notes exist', async () => {
      const res = await request(app).get(`/api/sessions/${session.id}/notes`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns all notes for the session', async () => {
      sessionNotes.create(session.id, 'First note');
      sessionNotes.create(session.id, 'Second note');

      const res = await request(app).get(`/api/sessions/${session.id}/notes`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      const contents = res.body.map(n => n.content);
      expect(contents).toContain('First note');
      expect(contents).toContain('Second note');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app).get('/api/sessions/non-existent/notes');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/sessions/:id/notes', () => {
    it('creates a new note', async () => {
      const res = await request(app)
        .post(`/api/sessions/${session.id}/notes`)
        .send({ content: 'My new note' });

      expect(res.status).toBe(201);
      expect(res.body.content).toBe('My new note');
      expect(res.body.sessionId).toBe(session.id);
      expect(res.body.id).toBeDefined();
    });

    it('returns 400 when content is missing', async () => {
      const res = await request(app)
        .post(`/api/sessions/${session.id}/notes`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Content is required');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await request(app)
        .post('/api/sessions/non-existent/notes')
        .send({ content: 'note' });

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/sessions/:id/notes/:noteId', () => {
    it('updates an existing note', async () => {
      const note = sessionNotes.create(session.id, 'Original content');

      const res = await request(app)
        .put(`/api/sessions/${session.id}/notes/${note.id}`)
        .send({ content: 'Updated content' });

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('Updated content');
    });

    it('returns 404 when note does not exist', async () => {
      const res = await request(app)
        .put(`/api/sessions/${session.id}/notes/non-existent`)
        .send({ content: 'Updated' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Note not found');
    });

    it('returns 404 when note belongs to a different session', async () => {
      const otherSession = sessions.create(project.id, 'Other', 'Prompt', 'standard');
      const note = sessionNotes.create(otherSession.id, 'Other note');

      const res = await request(app)
        .put(`/api/sessions/${session.id}/notes/${note.id}`)
        .send({ content: 'Updated' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Note not found');
    });

    it('returns 400 when content is missing', async () => {
      const note = sessionNotes.create(session.id, 'Original');

      const res = await request(app)
        .put(`/api/sessions/${session.id}/notes/${note.id}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Content is required');
    });
  });

  describe('DELETE /api/sessions/:id/notes/:noteId', () => {
    it('deletes an existing note', async () => {
      const note = sessionNotes.create(session.id, 'To be deleted');

      const res = await request(app)
        .delete(`/api/sessions/${session.id}/notes/${note.id}`);

      expect(res.status).toBe(204);

      // Verify note is gone
      const remaining = sessionNotes.getBySessionId(session.id);
      expect(remaining).toHaveLength(0);
    });

    it('returns 404 when note does not exist', async () => {
      const res = await request(app)
        .delete(`/api/sessions/${session.id}/notes/non-existent`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Note not found');
    });

    it('returns 404 when note belongs to a different session', async () => {
      const otherSession = sessions.create(project.id, 'Other', 'Prompt', 'standard');
      const note = sessionNotes.create(otherSession.id, 'Other note');

      const res = await request(app)
        .delete(`/api/sessions/${session.id}/notes/${note.id}`);

      expect(res.status).toBe(404);
    });
  });
});
