import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, workLogs } from '../database.js';
import { textAccumulators, thinkingAccumulators } from '../services/streamEventHandler.js';

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
  cleanupActiveSession: vi.fn(),
}));

// Mock summaryService
vi.mock('../services/summaryService.js', () => ({
  getSummary: vi.fn().mockResolvedValue(null),
  generateSummary: vi.fn().mockResolvedValue('mock summary'),
  generateConversationSummary: vi.fn().mockResolvedValue('mock conversation summary'),
  onSessionActivity: vi.fn(),
  cleanupSession: vi.fn(),
}));

// Mock diffService
vi.mock('../services/diffService.js', () => ({
  getDiff: vi.fn().mockResolvedValue({ staged: [], unstaged: [] }),
}));

// Import after mocks are set up
import sessionsRouter from './sessions.js';

describe('Sessions API - streaming-state', () => {
  let app;
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    // Create test project and session
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
    sessions.update(session.id, { status: 'running' });

    // Clean up accumulators
    textAccumulators.clear();
    thinkingAccumulators.clear();
  });

  afterEach(() => {
    textAccumulators.clear();
    thinkingAccumulators.clear();
  });

  it('returns 404 for non-existent session', async () => {
    const res = await request(app).get('/api/sessions/non-existent-id/streaming-state');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Session not found');
  });

  it('returns empty state when no active streaming', async () => {
    const res = await request(app).get(`/api/sessions/${session.id}/streaming-state`);

    expect(res.status).toBe(200);
    expect(res.body.workLogs).toEqual([]);
    expect(res.body.partialText).toBe('');
    expect(res.body.thinking).toBeNull();
  });

  it('returns pending work logs when they exist', async () => {
    // Create pending (unassociated) work logs
    workLogs.create(session.id, 'tool_input', 'Reading file...', { toolName: 'Read' });
    workLogs.create(session.id, 'tool_output', 'File contents', { toolName: 'Read' });

    const res = await request(app).get(`/api/sessions/${session.id}/streaming-state`);

    expect(res.status).toBe(200);
    expect(res.body.workLogs).toHaveLength(2);
    // Both work logs should be present (order may vary when timestamps are the same)
    const contents = res.body.workLogs.map(l => l.content);
    expect(contents).toContain('Reading file...');
    expect(contents).toContain('File contents');
  });

  it('returns accumulated text from textAccumulators', async () => {
    textAccumulators.set(session.id, 'Hello, I am currently working on...');

    const res = await request(app).get(`/api/sessions/${session.id}/streaming-state`);

    expect(res.status).toBe(200);
    expect(res.body.partialText).toBe('Hello, I am currently working on...');
  });

  it('returns accumulated thinking from thinkingAccumulators', async () => {
    thinkingAccumulators.set(session.id, 'Let me think about this...');

    const res = await request(app).get(`/api/sessions/${session.id}/streaming-state`);

    expect(res.status).toBe(200);
    expect(res.body.thinking).toBe('Let me think about this...');
  });

  it('returns all fields together when streaming is active', async () => {
    workLogs.create(session.id, 'thinking', 'Thinking log');
    textAccumulators.set(session.id, 'Partial text content');
    thinkingAccumulators.set(session.id, 'Thinking content');

    const res = await request(app).get(`/api/sessions/${session.id}/streaming-state`);

    expect(res.status).toBe(200);
    expect(res.body.workLogs).toHaveLength(1);
    expect(res.body.partialText).toBe('Partial text content');
    expect(res.body.thinking).toBe('Thinking content');
  });
});
