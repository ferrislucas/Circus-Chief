import { describe, it, expect, beforeEach } from 'vitest';
import { AgentCallLogRepository } from './AgentCallLogRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { databaseManager } from './DatabaseManager.js';

describe('AgentCallLogRepository', () => {
  // Uses global setup from test/setup.js (in-memory DB per test)
  let repo;
  let projectRepo;
  let sessionId;

  beforeEach(() => {
    repo = new AgentCallLogRepository();
    projectRepo = new ProjectRepository();

    // Create a project and session for testing
    const project = projectRepo.create('Test Project', '/tmp/test');
    const now = Date.now();
    const id = databaseManager.generateId();
    databaseManager.get().prepare(
      'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, project.id, 'Test Session', 'running', 'standard', now, now);
    sessionId = id;
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(AgentCallLogRepository);
      expect(repo.tableName).toBe('agent_call_logs');
    });
  });

  describe('create', () => {
    it('creates a call log entry and returns mapped object', () => {
      const callId = databaseManager.generateId();
      const entry = repo.create({
        id: callId,
        sessionId,
        conversationId: 'conv-1',
        agentType: 'claude-code',
        model: 'claude-sonnet-4-20250514',
        callType: 'runSession',
        promptLength: 500,
      });

      expect(entry.id).toBe(callId);
      expect(entry.sessionId).toBe(sessionId);
      expect(entry.conversationId).toBe('conv-1');
      expect(entry.agentType).toBe('claude-code');
      expect(entry.model).toBe('claude-sonnet-4-20250514');
      expect(entry.callType).toBe('runSession');
      expect(entry.promptLength).toBe(500);
      expect(entry.status).toBe('pending');
      expect(entry.startedAt).toBeTypeOf('number');
      expect(entry.createdAt).toBeTypeOf('number');
      expect(entry.inputTokens).toBe(0);
      expect(entry.outputTokens).toBe(0);
    });
  });

  describe('getById', () => {
    it('returns mapped object with camelCase properties', () => {
      const callId = databaseManager.generateId();
      repo.create({
        id: callId,
        sessionId,
        agentType: 'claude-code',
        callType: 'runSession',
        promptLength: 100,
      });

      const retrieved = repo.getById(callId);
      expect(retrieved).not.toBeNull();
      expect(retrieved.sessionId).toBe(sessionId);
      expect(retrieved.agentType).toBe('claude-code');
      expect(retrieved.callType).toBe('runSession');
    });

    it('returns null for non-existent ID', () => {
      expect(repo.getById('non-existent')).toBeNull();
    });
  });

  describe('updateUsage', () => {
    it('updates token columns and sets status to streaming', () => {
      const callId = databaseManager.generateId();
      repo.create({
        id: callId,
        sessionId,
        agentType: 'claude-code',
        callType: 'runSession',
        promptLength: 100,
      });

      repo.updateUsage(callId, {
        inputTokens: 1000,
        outputTokens: 500,
        thinkingTokens: 200,
        cacheReadTokens: 300,
        cacheWriteTokens: 100,
      });

      const updated = repo.getById(callId);
      expect(updated.inputTokens).toBe(1000);
      expect(updated.outputTokens).toBe(500);
      expect(updated.thinkingTokens).toBe(200);
      expect(updated.cacheReadTokens).toBe(300);
      expect(updated.cacheWriteTokens).toBe(100);
      expect(updated.status).toBe('streaming');
    });
  });

  describe('complete', () => {
    it('with success sets status, completed_at, duration_ms, total_tokens (including cache tokens)', () => {
      const callId = databaseManager.generateId();
      repo.create({
        id: callId,
        sessionId,
        agentType: 'claude-code',
        callType: 'runSession',
        promptLength: 100,
      });

      repo.complete(callId, {
        success: true,
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 300,
        cacheWriteTokens: 100,
      });

      const completed = repo.getById(callId);
      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeTypeOf('number');
      expect(completed.durationMs).toBeTypeOf('number');
      expect(completed.durationMs).toBeGreaterThanOrEqual(0);
      // totalTokens now includes all token types: 1000 + 500 + 0 + 300 + 100 = 1900
      expect(completed.totalTokens).toBe(1900);
      expect(completed.inputTokens).toBe(1000);
      expect(completed.outputTokens).toBe(500);
    });

    it('totalTokens includes thinkingTokens set via updateUsage() before complete()', () => {
      const callId = databaseManager.generateId();
      repo.create({
        id: callId,
        sessionId,
        agentType: 'claude-code',
        callType: 'runSession',
        promptLength: 100,
      });

      // Simulate streaming: thinkingTokens set via updateUsage
      repo.updateUsage(callId, {
        inputTokens: 1000,
        outputTokens: 500,
        thinkingTokens: 200,
        cacheReadTokens: 300,
        cacheWriteTokens: 100,
      });

      // complete() called without token params (as LoggingAgentWrapper does)
      repo.complete(callId, { success: true });

      const completed = repo.getById(callId);
      expect(completed.status).toBe('completed');
      // 1000 + 500 + 200 + 300 + 100 = 2100
      expect(completed.totalTokens).toBe(2100);
      expect(completed.thinkingTokens).toBe(200);
    });

    it('totalTokens uses existing DB values when complete() params are undefined', () => {
      const callId = databaseManager.generateId();
      repo.create({
        id: callId,
        sessionId,
        agentType: 'claude-code',
        callType: 'runSession',
        promptLength: 100,
      });

      repo.updateUsage(callId, {
        inputTokens: 800,
        outputTokens: 400,
        thinkingTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });

      // complete with success and no token params
      repo.complete(callId, { success: true });

      const completed = repo.getById(callId);
      expect(completed.status).toBe('completed');
      expect(completed.totalTokens).toBe(1200); // 800 + 400
    });

    it('with error sets status to error and error_message', () => {
      const callId = databaseManager.generateId();
      repo.create({
        id: callId,
        sessionId,
        agentType: 'claude-code',
        callType: 'runSession',
        promptLength: 100,
      });

      repo.complete(callId, {
        success: false,
        errorMessage: 'Connection timeout',
      });

      const completed = repo.getById(callId);
      expect(completed.status).toBe('error');
      expect(completed.errorMessage).toBe('Connection timeout');
      expect(completed.completedAt).toBeTypeOf('number');
    });
  });

  describe('getBySessionId', () => {
    it('returns calls ordered by started_at DESC with limit/offset', () => {
      // Create multiple call logs
      for (let i = 0; i < 5; i++) {
        repo.create({
          id: databaseManager.generateId(),
          sessionId,
          agentType: 'claude-code',
          callType: 'runSession',
          promptLength: 100 * (i + 1),
        });
      }

      const all = repo.getBySessionId(sessionId);
      expect(all).toHaveLength(5);

      // Test limit
      const limited = repo.getBySessionId(sessionId, { limit: 3 });
      expect(limited).toHaveLength(3);

      // Test offset
      const offset = repo.getBySessionId(sessionId, { limit: 2, offset: 2 });
      expect(offset).toHaveLength(2);
    });

    it('returns empty array for session with no calls', () => {
      const calls = repo.getBySessionId('nonexistent');
      expect(calls).toEqual([]);
    });
  });

  describe('getSessionStats', () => {
    it('returns correct aggregation grouped by call_type', () => {
      // Create entries with different call types
      const id1 = databaseManager.generateId();
      const id2 = databaseManager.generateId();
      const id3 = databaseManager.generateId();

      repo.create({ id: id1, sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 100 });
      repo.create({ id: id2, sessionId, agentType: 'claude-code', callType: 'continueSession', promptLength: 200 });
      repo.create({ id: id3, sessionId, agentType: 'claude-code', callType: 'continueSession', promptLength: 300 });

      repo.complete(id1, { success: true, inputTokens: 100, outputTokens: 50 });
      repo.complete(id2, { success: true, inputTokens: 200, outputTokens: 100 });
      repo.complete(id3, { success: true, inputTokens: 300, outputTokens: 150 });

      const stats = repo.getSessionStats(sessionId);
      expect(stats).toHaveLength(2); // runSession, continueSession

      const runStats = stats.find(s => s.call_type === 'runSession');
      expect(runStats.call_count).toBe(1);
      expect(runStats.total_input_tokens).toBe(100);
      expect(runStats.total_output_tokens).toBe(50);

      const continueStats = stats.find(s => s.call_type === 'continueSession');
      expect(continueStats.call_count).toBe(2);
      expect(continueStats.total_input_tokens).toBe(500); // 200 + 300
      expect(continueStats.total_output_tokens).toBe(250); // 100 + 150
    });
  });

  describe('getGlobalStats', () => {
    it('filters by date range and groups by agent_type and call_type', () => {
      const id1 = databaseManager.generateId();
      repo.create({ id: id1, sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 100 });
      repo.complete(id1, { success: true, inputTokens: 100, outputTokens: 50 });

      const now = Date.now();
      const stats = repo.getGlobalStats(now - 60000, now + 60000);
      expect(stats.length).toBeGreaterThanOrEqual(1);

      const claudeStats = stats.find(s => s.agent_type === 'claude-code');
      expect(claudeStats).toBeDefined();
      expect(claudeStats.call_count).toBe(1);
    });

    it('returns empty array when no calls in range', () => {
      const id1 = databaseManager.generateId();
      repo.create({ id: id1, sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 100 });

      // Use a range far in the past
      const stats = repo.getGlobalStats(0, 1000);
      expect(stats).toEqual([]);
    });
  });

  describe('getAll', () => {
    it('returns { rows, total } shape', () => {
      const id = databaseManager.generateId();
      repo.create({ id, sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 100 });

      const result = repo.getAll();
      expect(Array.isArray(result.rows)).toBe(true);
      expect(typeof result.total).toBe('number');
    });

    it('returns correct total even with limit/offset', () => {
      for (let i = 0; i < 10; i++) {
        repo.create({
          id: databaseManager.generateId(),
          sessionId,
          agentType: 'claude-code',
          callType: 'runSession',
          promptLength: 100,
        });
      }
      const result = repo.getAll({ limit: 3, offset: 2 });
      expect(result.total).toBe(10);
      expect(result.rows.length).toBe(3);
    });

    it('returns { rows: [], total: 0 } when no data', () => {
      const result = repo.getAll();
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('filters by agentType', () => {
      repo.create({ id: databaseManager.generateId(), sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10 });
      repo.create({ id: databaseManager.generateId(), sessionId, agentType: 'other-agent', callType: 'runSession', promptLength: 10 });

      const result = repo.getAll({ agentType: 'claude-code' });
      expect(result.total).toBe(1);
      expect(result.rows[0].agentType).toBe('claude-code');
    });

    it('filters by callType', () => {
      repo.create({ id: databaseManager.generateId(), sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10 });
      repo.create({ id: databaseManager.generateId(), sessionId, agentType: 'claude-code', callType: 'continueSession', promptLength: 10 });

      const result = repo.getAll({ callType: 'continueSession' });
      expect(result.total).toBe(1);
      expect(result.rows[0].callType).toBe('continueSession');
    });

    it('filters by status', () => {
      const id1 = databaseManager.generateId();
      const id2 = databaseManager.generateId();
      repo.create({ id: id1, sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10 });
      repo.create({ id: id2, sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10 });
      repo.complete(id1, { success: true });
      repo.complete(id2, { success: false, errorMessage: 'fail' });

      const result = repo.getAll({ status: 'completed' });
      expect(result.rows.every((r) => r.status === 'completed')).toBe(true);
    });

    it('filters by model', () => {
      const id1 = databaseManager.generateId();
      const id2 = databaseManager.generateId();
      repo.create({ id: id1, sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10, model: 'claude-3-5-sonnet' });
      repo.create({ id: id2, sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10, model: 'claude-opus' });

      const result = repo.getAll({ model: 'claude-3-5-sonnet' });
      expect(result.total).toBe(1);
      expect(result.rows[0].model).toBe('claude-3-5-sonnet');
    });

    it('filters by date range (future dates yield empty results)', () => {
      repo.create({ id: databaseManager.generateId(), sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10 });

      const futureStart = Date.now() + 100000;
      const futureEnd = futureStart + 100000;
      const result = repo.getAll({ startDate: futureStart, endDate: futureEnd });
      expect(result.total).toBe(0);
      expect(result.rows).toEqual([]);
    });

    it('filters by sessionId', () => {
      // Create a second project + session
      const now = Date.now();
      const project2 = projectRepo.create('Project 2', '/tmp/2');
      const otherId = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(otherId, project2.id, 'Other Session', 'running', 'standard', now, now);

      repo.create({ id: databaseManager.generateId(), sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10 });
      repo.create({ id: databaseManager.generateId(), sessionId: otherId, agentType: 'claude-code', callType: 'runSession', promptLength: 10 });

      const result = repo.getAll({ sessionId });
      expect(result.total).toBe(1);
      expect(result.rows.every((r) => r.sessionId === sessionId)).toBe(true);
    });

    it('combines multiple filters', () => {
      const id1 = databaseManager.generateId();
      const id2 = databaseManager.generateId();
      repo.create({ id: id1, sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10 });
      repo.create({ id: id2, sessionId, agentType: 'other-agent', callType: 'runSession', promptLength: 10 });
      repo.complete(id1, { success: true });
      repo.complete(id2, { success: true });

      const result = repo.getAll({ agentType: 'claude-code', status: 'completed' });
      expect(result.total).toBe(1);
      expect(result.rows[0].agentType).toBe('claude-code');
    });

    it('sorts by total_tokens ASC', () => {
      const id1 = databaseManager.generateId();
      const id2 = databaseManager.generateId();
      repo.create({ id: id1, sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10 });
      repo.create({ id: id2, sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10 });
      repo.complete(id1, { success: true, inputTokens: 100, outputTokens: 0 });
      repo.complete(id2, { success: true, inputTokens: 500, outputTokens: 0 });

      const result = repo.getAll({ sortBy: 'total_tokens', sortOrder: 'ASC' });
      expect(result.rows[0].totalTokens).toBeLessThanOrEqual(result.rows[1].totalTokens);
    });

    it('defaults to started_at DESC', () => {
      const id1 = databaseManager.generateId();
      const id2 = databaseManager.generateId();
      repo.create({ id: id1, sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10 });
      repo.create({ id: id2, sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10 });

      const result = repo.getAll();
      // Should be in descending order
      expect(result.rows[0].startedAt).toBeGreaterThanOrEqual(result.rows[1]?.startedAt ?? 0);
    });

    it('rejects invalid sortBy by falling back to started_at', () => {
      repo.create({ id: databaseManager.generateId(), sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10 });

      // Should not throw, just use default sort
      const result = repo.getAll({ sortBy: 'DROP TABLE agent_call_logs' });
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('includes sessionName from joined sessions table', () => {
      repo.create({ id: databaseManager.generateId(), sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10 });

      const result = repo.getAll({ sessionId });
      // sessionName comes from the sessions table 'name' column
      expect(result.rows[0]).toHaveProperty('sessionName');
    });
  });

  describe('getFilterOptions', () => {
    it('returns empty arrays when no data', () => {
      const opts = repo.getFilterOptions();
      expect(opts.agentTypes).toEqual([]);
      expect(opts.callTypes).toEqual([]);
      expect(opts.statuses).toEqual([]);
      expect(opts.models).toEqual([]);
    });

    it('returns distinct values from actual data', () => {
      repo.create({ id: databaseManager.generateId(), sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10, model: 'sonnet' });
      repo.create({ id: databaseManager.generateId(), sessionId, agentType: 'other-agent', callType: 'continueSession', promptLength: 10, model: 'opus' });
      repo.create({ id: databaseManager.generateId(), sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10, model: 'sonnet' });

      const opts = repo.getFilterOptions();
      expect(opts.agentTypes).toContain('claude-code');
      expect(opts.agentTypes).toContain('other-agent');
      expect(opts.agentTypes.length).toBe(2); // distinct
      expect(opts.callTypes).toContain('runSession');
      expect(opts.callTypes).toContain('continueSession');
      expect(opts.models).toContain('sonnet');
      expect(opts.models).toContain('opus');
      expect(opts.models.length).toBe(2); // distinct
    });

    it('excludes NULL model values', () => {
      repo.create({ id: databaseManager.generateId(), sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 10 });
      // model defaults to null

      const opts = repo.getFilterOptions();
      expect(opts.models).toEqual([]);
    });
  });

  describe('delete (CASCADE)', () => {
    it('deletes call logs when session is deleted', () => {
      const id1 = databaseManager.generateId();
      repo.create({ id: id1, sessionId, agentType: 'claude-code', callType: 'runSession', promptLength: 100 });

      expect(repo.getById(id1)).not.toBeNull();

      // Delete the session (should cascade to agent_call_logs)
      databaseManager.get().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

      expect(repo.getById(id1)).toBeNull();
    });
  });
});
