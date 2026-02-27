import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, agentCallLogs } from '../db/index.js';
import metricsRouter from './metrics.js';

describe('Metrics API', () => {
  let app;
  let projectId;
  let sessionId;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api', metricsRouter);

    // Create a project and session for test data
    const project = projects.create('Test', '/tmp');
    projectId = project.id;
    const session = sessions.create(projectId, 'Test session', 'hello', 'standard');
    sessionId = session.id;
  });

  describe('GET /api/sessions/:sessionId/agent-stats', () => {
    it('returns empty array when no calls logged', async () => {
      const res = await request(app).get(`/api/sessions/${sessionId}/agent-stats`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns aggregated stats grouped by call_type', async () => {
      // Create two call log entries with different call types
      agentCallLogs.create({
        id: 'call-1',
        sessionId,
        conversationId: null,
        agentType: 'claude-code',
        model: 'claude-sonnet-4-20250514',
        callType: 'runSession',
        promptLength: 100,
      });
      agentCallLogs.complete('call-1', {
        success: true,
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });

      agentCallLogs.create({
        id: 'call-2',
        sessionId,
        conversationId: null,
        agentType: 'claude-code',
        model: 'claude-sonnet-4-20250514',
        callType: 'continueSession',
        promptLength: 200,
      });
      agentCallLogs.complete('call-2', {
        success: true,
        inputTokens: 2000,
        outputTokens: 800,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });

      const res = await request(app).get(`/api/sessions/${sessionId}/agent-stats`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const runStat = res.body.find((s) => s.call_type === 'runSession');
      expect(runStat).toBeTruthy();
      expect(runStat.call_count).toBe(1);
      expect(runStat.total_input_tokens).toBe(1000);
      expect(runStat.total_output_tokens).toBe(500);

      const continueStat = res.body.find((s) => s.call_type === 'continueSession');
      expect(continueStat).toBeTruthy();
      expect(continueStat.call_count).toBe(1);
    });
  });

  describe('GET /api/sessions/:sessionId/agent-calls', () => {
    it('returns empty array when no calls exist', async () => {
      const res = await request(app).get(`/api/sessions/${sessionId}/agent-calls`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns detailed call log entries for a session', async () => {
      agentCallLogs.create({
        id: 'call-a',
        sessionId,
        conversationId: null,
        agentType: 'claude-code',
        model: 'claude-sonnet-4-20250514',
        callType: 'runSession',
        promptLength: 500,
      });

      const res = await request(app).get(`/api/sessions/${sessionId}/agent-calls`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe('call-a');
      expect(res.body[0].callType).toBe('runSession');
      expect(res.body[0].promptLength).toBe(500);
    });

    it('respects limit and offset query params', async () => {
      // Create 3 calls
      for (let i = 0; i < 3; i++) {
        agentCallLogs.create({
          id: `call-${i}`,
          sessionId,
          conversationId: null,
          agentType: 'claude-code',
          model: null,
          callType: 'runSession',
          promptLength: 100,
        });
      }

      const res = await request(app).get(
        `/api/sessions/${sessionId}/agent-calls?limit=2&offset=1`
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });
  });

  describe('GET /api/agent-stats', () => {
    it('returns global stats (empty when no calls)', async () => {
      const res = await request(app).get('/api/agent-stats');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns global stats grouped by agent_type and call_type', async () => {
      agentCallLogs.create({
        id: 'global-1',
        sessionId,
        conversationId: null,
        agentType: 'claude-code',
        model: null,
        callType: 'runSession',
        promptLength: 100,
      });
      agentCallLogs.complete('global-1', {
        success: true,
        inputTokens: 500,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });

      const res = await request(app).get('/api/agent-stats');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].agent_type).toBe('claude-code');
      expect(res.body[0].call_type).toBe('runSession');
      expect(res.body[0].call_count).toBe(1);
    });

    it('accepts startDate and endDate query parameters', async () => {
      agentCallLogs.create({
        id: 'dated-1',
        sessionId,
        conversationId: null,
        agentType: 'claude-code',
        model: null,
        callType: 'runSession',
        promptLength: 100,
      });

      // Query with future dates → should find nothing
      const futureStart = Date.now() + 100000;
      const futureEnd = futureStart + 100000;
      const res = await request(app).get(
        `/api/agent-stats?startDate=${futureStart}&endDate=${futureEnd}`
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });
});
