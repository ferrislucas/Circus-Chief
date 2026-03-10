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

  describe('GET /api/agent-calls/filter-options', () => {
    it('returns empty arrays when no data', async () => {
      const res = await request(app).get('/api/agent-calls/filter-options');

      expect(res.status).toBe(200);
      expect(res.body.agentTypes).toEqual([]);
      expect(res.body.callTypes).toEqual([]);
      expect(res.body.statuses).toEqual([]);
      expect(res.body.models).toEqual([]);
    });

    it('returns distinct values from actual data', async () => {
      agentCallLogs.create({
        id: 'fo-1',
        sessionId,
        conversationId: null,
        agentType: 'claude-code',
        model: 'claude-sonnet',
        callType: 'runSession',
        promptLength: 100,
      });
      agentCallLogs.create({
        id: 'fo-2',
        sessionId,
        conversationId: null,
        agentType: 'other-agent',
        model: 'claude-opus',
        callType: 'continueSession',
        promptLength: 50,
      });

      const res = await request(app).get('/api/agent-calls/filter-options');

      expect(res.status).toBe(200);
      expect(res.body.agentTypes).toContain('claude-code');
      expect(res.body.agentTypes).toContain('other-agent');
      expect(res.body.callTypes).toContain('runSession');
      expect(res.body.callTypes).toContain('continueSession');
      expect(res.body.models).toContain('claude-sonnet');
      expect(res.body.models).toContain('claude-opus');
    });
  });

  describe('GET /api/agent-calls', () => {
    it('returns { logs, pagination } shape when no data', async () => {
      const res = await request(app).get('/api/agent-calls');

      expect(res.status).toBe(200);
      expect(res.body.logs).toEqual([]);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.total).toBe(0);
      expect(res.body.pagination.limit).toBe(25);
      expect(res.body.pagination.offset).toBe(0);
      expect(res.body.pagination.hasMore).toBe(false);
    });

    it('returns log entries with correct structure', async () => {
      agentCallLogs.create({
        id: 'ac-1',
        sessionId,
        conversationId: null,
        agentType: 'claude-code',
        model: 'claude-sonnet',
        callType: 'runSession',
        promptLength: 100,
      });

      const res = await request(app).get('/api/agent-calls');

      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(1);
      expect(res.body.logs[0].id).toBe('ac-1');
      expect(res.body.logs[0].agentType).toBe('claude-code');
      expect(res.body.logs[0]).toHaveProperty('sessionName');
      expect(res.body.pagination.total).toBe(1);
    });

    it('respects limit and offset query params', async () => {
      for (let i = 0; i < 5; i++) {
        agentCallLogs.create({
          id: `ac-lim-${i}`,
          sessionId,
          conversationId: null,
          agentType: 'claude-code',
          model: null,
          callType: 'runSession',
          promptLength: 100,
        });
      }

      const res = await request(app).get('/api/agent-calls?limit=2&offset=1');

      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(2);
      expect(res.body.pagination.total).toBe(5);
      expect(res.body.pagination.limit).toBe(2);
      expect(res.body.pagination.offset).toBe(1);
    });

    it('returns hasMore: true when more pages exist', async () => {
      for (let i = 0; i < 30; i++) {
        agentCallLogs.create({
          id: `ac-more-${i}`,
          sessionId,
          conversationId: null,
          agentType: 'claude-code',
          model: null,
          callType: 'runSession',
          promptLength: 100,
        });
      }

      const res = await request(app).get('/api/agent-calls?limit=25&offset=0');

      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBe(30);
      expect(res.body.pagination.hasMore).toBe(true);
    });

    it('filters by agentType', async () => {
      agentCallLogs.create({ id: 'ac-at-1', sessionId, conversationId: null, agentType: 'claude-code', model: null, callType: 'runSession', promptLength: 10 });
      agentCallLogs.create({ id: 'ac-at-2', sessionId, conversationId: null, agentType: 'other-agent', model: null, callType: 'runSession', promptLength: 10 });

      const res = await request(app).get('/api/agent-calls?agentType=claude-code');

      expect(res.status).toBe(200);
      expect(res.body.logs.every((l) => l.agentType === 'claude-code')).toBe(true);
    });

    it('filters by callType', async () => {
      agentCallLogs.create({ id: 'ac-ct-1', sessionId, conversationId: null, agentType: 'claude-code', model: null, callType: 'runSession', promptLength: 10 });
      agentCallLogs.create({ id: 'ac-ct-2', sessionId, conversationId: null, agentType: 'claude-code', model: null, callType: 'continueSession', promptLength: 10 });

      const res = await request(app).get('/api/agent-calls?callType=continueSession');

      expect(res.status).toBe(200);
      expect(res.body.logs.every((l) => l.callType === 'continueSession')).toBe(true);
    });

    it('filters by status', async () => {
      agentCallLogs.create({ id: 'ac-st-1', sessionId, conversationId: null, agentType: 'claude-code', model: null, callType: 'runSession', promptLength: 10 });
      agentCallLogs.complete('ac-st-1', { success: true, inputTokens: 100, outputTokens: 50 });
      agentCallLogs.create({ id: 'ac-st-2', sessionId, conversationId: null, agentType: 'claude-code', model: null, callType: 'runSession', promptLength: 10 });
      agentCallLogs.complete('ac-st-2', { success: false, errorMessage: 'fail' });

      const res = await request(app).get('/api/agent-calls?status=completed');

      expect(res.status).toBe(200);
      expect(res.body.logs.every((l) => l.status === 'completed')).toBe(true);
    });

    it('filters by model', async () => {
      agentCallLogs.create({ id: 'ac-m-1', sessionId, conversationId: null, agentType: 'claude-code', model: 'claude-sonnet', callType: 'runSession', promptLength: 10 });
      agentCallLogs.create({ id: 'ac-m-2', sessionId, conversationId: null, agentType: 'claude-code', model: 'claude-opus', callType: 'runSession', promptLength: 10 });

      const res = await request(app).get('/api/agent-calls?model=claude-sonnet');

      expect(res.status).toBe(200);
      expect(res.body.logs.every((l) => l.model === 'claude-sonnet')).toBe(true);
    });

    it('filters by startDate and endDate', async () => {
      agentCallLogs.create({ id: 'ac-d-1', sessionId, conversationId: null, agentType: 'claude-code', model: null, callType: 'runSession', promptLength: 10 });

      const futureStart = Date.now() + 100000;
      const futureEnd = futureStart + 100000;
      const res = await request(app).get(`/api/agent-calls?startDate=${futureStart}&endDate=${futureEnd}`);

      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(0);
    });

    it('accepts valid sortBy and sortOrder', async () => {
      agentCallLogs.create({ id: 'ac-s-1', sessionId, conversationId: null, agentType: 'claude-code', model: null, callType: 'runSession', promptLength: 10 });
      agentCallLogs.complete('ac-s-1', { success: true, inputTokens: 100, outputTokens: 50 });
      agentCallLogs.create({ id: 'ac-s-2', sessionId, conversationId: null, agentType: 'claude-code', model: null, callType: 'runSession', promptLength: 10 });
      agentCallLogs.complete('ac-s-2', { success: true, inputTokens: 500, outputTokens: 200 });

      const res = await request(app).get('/api/agent-calls?sortBy=total_tokens&sortOrder=ASC');

      expect(res.status).toBe(200);
      const tokens = res.body.logs.map((l) => l.totalTokens);
      expect(tokens[0]).toBeLessThanOrEqual(tokens[1] ?? Infinity);
    });

    it('handles invalid sortBy gracefully (falls back to default)', async () => {
      agentCallLogs.create({ id: 'ac-inv-1', sessionId, conversationId: null, agentType: 'claude-code', model: null, callType: 'runSession', promptLength: 10 });

      const res = await request(app).get('/api/agent-calls?sortBy=DROP+TABLE');

      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(1);
    });

    it('includes sessionName in log entries', async () => {
      agentCallLogs.create({ id: 'ac-sn-1', sessionId, conversationId: null, agentType: 'claude-code', model: null, callType: 'runSession', promptLength: 10 });

      const res = await request(app).get('/api/agent-calls');

      expect(res.status).toBe(200);
      expect(res.body.logs[0]).toHaveProperty('sessionName');
      // The session was created as 'Test session'
      expect(res.body.logs[0].sessionName).toBe('Test session');
    });
  });

  describe('DELETE /api/agent-calls', () => {
    it('returns { success: true, deleted: N } and removes all logs', async () => {
      // Create 3 log entries
      agentCallLogs.create({
        id: 'del-1',
        sessionId,
        conversationId: null,
        agentType: 'claude-code',
        model: null,
        callType: 'runSession',
        promptLength: 100,
      });
      agentCallLogs.create({
        id: 'del-2',
        sessionId,
        conversationId: null,
        agentType: 'claude-code',
        model: null,
        callType: 'continueSession',
        promptLength: 200,
      });
      agentCallLogs.create({
        id: 'del-3',
        sessionId,
        conversationId: null,
        agentType: 'other-agent',
        model: null,
        callType: 'runSession',
        promptLength: 300,
      });

      // Verify they exist
      let res = await request(app).get('/api/agent-calls');
      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBe(3);

      // Delete all
      res = await request(app).delete('/api/agent-calls');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, deleted: 3 });

      // Verify they're gone
      res = await request(app).get('/api/agent-calls');
      expect(res.status).toBe(200);
      expect(res.body.logs).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });

    it('returns { success: true, deleted: 0 } when no logs exist', async () => {
      const res = await request(app).delete('/api/agent-calls');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, deleted: 0 });
    });
  });
});
