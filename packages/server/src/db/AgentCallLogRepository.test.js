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
    it('with success sets status, completed_at, duration_ms, total_tokens', () => {
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
      expect(completed.totalTokens).toBe(1500); // 1000 + 500
      expect(completed.inputTokens).toBe(1000);
      expect(completed.outputTokens).toBe(500);
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
