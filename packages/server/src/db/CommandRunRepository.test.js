import { describe, it, expect, beforeEach } from 'vitest';
import { CommandRunRepository } from './CommandRunRepository.js';
import { SessionRepository } from './SessionRepository.js';
import { CommandButtonRepository } from './CommandButtonRepository.js';
import { ProjectRepository } from './ProjectRepository.js';

describe('CommandRunRepository', () => {
  let repository;
  let testSessionId;
  let testButtonId;

  beforeEach(() => {
    repository = new CommandRunRepository();
    const projectRepository = new ProjectRepository();
    const sessionRepository = new SessionRepository();
    const buttonRepository = new CommandButtonRepository();

    // Create test project, session, and button for foreign key references
    const project = projectRepository.create('Test Project', '/tmp/test');
    const session = sessionRepository.create(project.id, 'Test Session', 'Test prompt');
    const button = buttonRepository.create({
      projectId: project.id,
      label: 'Test Button',
      command: 'echo test',
    });

    testSessionId = session.id;
    testButtonId = button.id;
  });

  describe('create', () => {
    it('creates a new run record with initial status "running"', () => {
      const runId = 'run-123';
      const created = repository.create({ id: runId, sessionId: testSessionId, buttonId: testButtonId });

      expect(created).toBeDefined();
      expect(created.id).toBe(runId);
      expect(created.sessionId).toBe(testSessionId);
      expect(created.buttonId).toBe(testButtonId);
      expect(created.status).toBe('running');
      expect(created.output).toBe('');
      expect(created.startedAt).toBeDefined();
    });

    it('can create multiple runs', () => {
      const run1 = repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });
      const run2 = repository.create({ id: 'run-2', sessionId: testSessionId, buttonId: testButtonId });

      expect(run1.id).toBe('run-1');
      expect(run2.id).toBe('run-2');
      expect(repository.getById('run-1')).toBeDefined();
      expect(repository.getById('run-2')).toBeDefined();
    });
  });

  describe('appendOutput', () => {
    it('appends text to run output', () => {
      const run = repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });
      expect(run.output).toBe('');

      repository.appendOutput('run-1', 'line 1\n');
      let updated = repository.getById('run-1');
      expect(updated.output).toBe('line 1\n');

      repository.appendOutput('run-1', 'line 2\n');
      updated = repository.getById('run-1');
      expect(updated.output).toBe('line 1\nline 2\n');
    });

    it('handles empty text gracefully', () => {
      repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });

      // Should not throw or create issues
      repository.appendOutput('run-1', '');
      repository.appendOutput('run-1', null);
      repository.appendOutput('run-1', undefined);

      const updated = repository.getById('run-1');
      expect(updated.output).toBe('');
    });
  });

  describe('complete', () => {
    it('marks run as success with exit code 0', () => {
      repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });
      repository.appendOutput('run-1', 'some output');

      repository.complete('run-1', 0, 'final output');

      const run = repository.getById('run-1');
      expect(run.status).toBe('success');
      expect(run.exitCode).toBe(0);
      expect(run.output).toBe('final output');
      expect(run.completedAt).toBeDefined();
    });

    it('marks run as error with non-zero exit code', () => {
      repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });

      repository.complete('run-1', 1, 'error output');

      const run = repository.getById('run-1');
      expect(run.status).toBe('error');
      expect(run.exitCode).toBe(1);
      expect(run.output).toBe('error output');
    });
  });

  describe('markKilled', () => {
    it('marks run as killed with provided output', () => {
      repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });

      repository.markKilled('run-1', 'killed output');

      const run = repository.getById('run-1');
      expect(run.status).toBe('killed');
      expect(run.output).toBe('killed output');
      expect(run.completedAt).toBeDefined();
    });
  });

  describe('getById', () => {
    it('returns run by ID', () => {
      repository.create({ id: 'run-123', sessionId: testSessionId, buttonId: testButtonId });

      const run = repository.getById('run-123');

      expect(run).toBeDefined();
      expect(run.id).toBe('run-123');
    });

    it('returns null for non-existent run', () => {
      const run = repository.getById('nonexistent');
      expect(run).toBeNull();
    });
  });

  describe('getBySessionId', () => {
    it('returns all runs for a session', () => {
      repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });
      repository.create({ id: 'run-2', sessionId: testSessionId, buttonId: testButtonId });

      const runs = repository.getBySessionId(testSessionId);

      expect(runs.length).toBe(2);
    });

    it('returns empty array for session with no runs', () => {
      const runs = repository.getBySessionId('nonexistent-session');
      expect(runs).toEqual([]);
    });
  });

  describe('getRecentBySessionId', () => {
    it('returns recent runs within default 1 hour window', () => {
      repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });

      const runs = repository.getRecentBySessionId(testSessionId);

      expect(runs.length).toBe(1);
      expect(runs[0].id).toBe('run-1');
    });

    it('returns recent completed runs with proper status', () => {
      repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });
      repository.complete('run-1', 0, 'output');

      const runs = repository.getRecentBySessionId(testSessionId);

      expect(runs.length).toBe(1);
      expect(runs[0].status).toBe('success');
      expect(runs[0].exitCode).toBe(0);
    });
  });

  describe('getLastRunForButton', () => {
    it('returns the most recent run for a button', () => {
      const run1 = repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });
      // Give a tiny delay to ensure different timestamps
      const before = Date.now();
      while (Date.now() === before) {
        // Wait for timestamp to change
      }
      const run2 = repository.create({ id: 'run-2', sessionId: testSessionId, buttonId: testButtonId });

      const lastRun = repository.getLastRunForButton(testButtonId);

      expect(lastRun.id).toBe('run-2');
    });

    it('returns null when button has no runs', () => {
      const run = repository.getLastRunForButton('nonexistent-button');
      expect(run).toBeNull();
    });
  });

  describe('deleteOlderThan', () => {
    it('returns number deleted', () => {
      repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });
      // Don't delete anything since it's fresh
      const deleted = repository.deleteOlderThan(1); // Delete anything older than 1ms

      expect(typeof deleted).toBe('number');
    });
  });

  describe('deleteBySessionId', () => {
    it('deletes all runs for a session', () => {
      repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });
      repository.create({ id: 'run-2', sessionId: testSessionId, buttonId: testButtonId });

      const deleted = repository.deleteBySessionId(testSessionId);

      expect(deleted).toBe(2);
      expect(repository.getById('run-1')).toBeNull();
      expect(repository.getById('run-2')).toBeNull();
    });

    it('returns 0 when session has no runs', () => {
      const deleted = repository.deleteBySessionId('nonexistent-session');
      expect(deleted).toBe(0);
    });
  });

  describe('data mapping', () => {
    it('maps database snake_case to camelCase', () => {
      const run = repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });
      repository.complete('run-1', 42, 'output');

      const retrieved = repository.getById('run-1');

      // Properties should be in camelCase
      expect(retrieved.sessionId).toBe(testSessionId);
      expect(retrieved.buttonId).toBe(testButtonId);
      expect(retrieved.exitCode).toBe(42);
      expect(retrieved.startedAt).toBeDefined();
      expect(retrieved.completedAt).toBeDefined();
    });

    it('returns null output as empty string', () => {
      const run = repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });

      expect(run.output).toBe('');
    });
  });
});
