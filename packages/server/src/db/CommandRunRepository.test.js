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
      repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });
      // Give a tiny delay to ensure different timestamps
      const before = Date.now();
      while (Date.now() === before) {
        // Wait for timestamp to change
      }
      repository.create({ id: 'run-2', sessionId: testSessionId, buttonId: testButtonId });

      const lastRun = repository.getLastRunForButton(testButtonId);

      expect(lastRun.id).toBe('run-2');
    });

    it('returns null when button has no runs', () => {
      expect(repository.getLastRunForButton('nonexistent-button')).toBeNull();
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

  describe('getLatestRunsForSession', () => {
    let button2Id;

    beforeEach(() => {
      // Create a second button for testing multiple buttons per session
      const buttonRepository = new CommandButtonRepository();
      const projectRepository = new ProjectRepository();
      const project = projectRepository.create('Test Project 2', '/tmp/test2');
      const button2 = buttonRepository.create({
        projectId: project.id,
        label: 'Test Button 2',
        command: 'echo test2',
      });
      button2Id = button2.id;
    });

    it('returns the latest run for each button in a session', () => {
      // Create multiple runs for the same button
      repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });
      repository.complete('run-1', 0, 'first output');

      // Give a tiny delay to ensure different timestamps
      const before = Date.now();
      while (Date.now() === before) {
        // Wait for timestamp to change
      }

      repository.create({ id: 'run-2', sessionId: testSessionId, buttonId: testButtonId });
      repository.complete('run-2', 0, 'second output');

      // Create a run for a different button
      repository.create({ id: 'run-3', sessionId: testSessionId, buttonId: button2Id });
      repository.complete('run-3', 0, 'button2 output');

      const latestRuns = repository.getLatestRunsForSession(testSessionId);

      // Should return one run per button (2 total)
      expect(latestRuns.length).toBe(2);

      // For button1, should return run-2 (the latest)
      const button1Run = latestRuns.find((r) => r.buttonId === testButtonId);
      expect(button1Run.id).toBe('run-2');

      // For button2, should return run-3
      const button2Run = latestRuns.find((r) => r.buttonId === button2Id);
      expect(button2Run.id).toBe('run-3');
    });

    it('returns runs regardless of age (no time limit)', () => {
      repository.create({ id: 'old-run', sessionId: testSessionId, buttonId: testButtonId });
      repository.complete('old-run', 0, 'old output');

      // Simulate old run by manually updating started_at and completed_at
      const db = repository.db;
      const oldTimestamp = Date.now() - 100000000; // ~3.5 years ago
      db.prepare('UPDATE command_runs SET started_at = ?, completed_at = ? WHERE id = ?').run(
        oldTimestamp,
        oldTimestamp + 1000,
        'old-run'
      );

      const latestRuns = repository.getLatestRunsForSession(testSessionId);

      // Should still return the old run (no time limit)
      expect(latestRuns.length).toBe(1);
      expect(latestRuns[0].id).toBe('old-run');
    });

    it('orders results by completion/started time (most recent first)', () => {
      const projectRepository = new ProjectRepository();
      const project = projectRepository.create('Test Project 3', '/tmp/test3');
      const sessionRepository = new SessionRepository();
      const session = sessionRepository.create(project.id, 'Test Session 3', 'Test prompt');
      const buttonRepository = new CommandButtonRepository();
      const button3 = buttonRepository.create({
        projectId: project.id,
        label: 'Test Button 3',
        command: 'echo test3',
      });
      const button3Id = button3.id;

      // Create runs for different buttons
      repository.create({ id: 'run-1', sessionId: session.id, buttonId: testButtonId });
      repository.complete('run-1', 0, 'output1');

      const before = Date.now();
      while (Date.now() === before) {
        // Wait for timestamp to change
      }

      repository.create({ id: 'run-2', sessionId: session.id, buttonId: button3Id });
      repository.complete('run-2', 0, 'output2');

      const before2 = Date.now();
      while (Date.now() === before2) {
        // Wait for timestamp to change
      }

      repository.create({ id: 'run-3', sessionId: session.id, buttonId: button2Id });
      repository.complete('run-3', 0, 'output3');

      const latestRuns = repository.getLatestRunsForSession(session.id);

      // Should be ordered by most recent first (run-3, run-2, run-1)
      expect(latestRuns.length).toBe(3);
      expect(latestRuns[0].id).toBe('run-3');
      expect(latestRuns[1].id).toBe('run-2');
      expect(latestRuns[2].id).toBe('run-1');
    });

    it('returns empty array for session with no runs', () => {
      const latestRuns = repository.getLatestRunsForSession('nonexistent-session');
      expect(latestRuns).toEqual([]);
    });

    it('handles running runs (without completion time)', () => {
      repository.create({ id: 'run-running', sessionId: testSessionId, buttonId: testButtonId });
      repository.create({ id: 'run-completed', sessionId: testSessionId, buttonId: button2Id });
      repository.complete('run-completed', 0, 'completed output');

      const latestRuns = repository.getLatestRunsForSession(testSessionId);

      // Should return both runs
      expect(latestRuns.length).toBe(2);

      const runningRun = latestRuns.find((r) => r.id === 'run-running');
      expect(runningRun.status).toBe('running');

      const completedRun = latestRuns.find((r) => r.id === 'run-completed');
      expect(completedRun.status).toBe('success');
    });

    it('prefers completed runs over running runs for same button', () => {
      // Create a running run
      repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });

      // Create a completed run for the same button (should be newer)
      const before = Date.now();
      while (Date.now() === before) {
        // Wait for timestamp to change
      }
      repository.create({ id: 'run-2', sessionId: testSessionId, buttonId: testButtonId });
      repository.complete('run-2', 0, 'completed');

      const latestRuns = repository.getLatestRunsForSession(testSessionId);

      // Should return run-2 (the latest one)
      expect(latestRuns.length).toBe(1);
      expect(latestRuns[0].id).toBe('run-2');
      expect(latestRuns[0].status).toBe('success');
    });
  });

  describe('getLatestRunsForProject', () => {
    let sessionId2;
    let button2Id;

    beforeEach(() => {
      // Create a second project and session for cross-project testing
      const projectRepository = new ProjectRepository();
      const sessionRepository = new SessionRepository();
      const buttonRepository = new CommandButtonRepository();

      const project2 = projectRepository.create('Test Project 2', '/tmp/test2');

      const session2 = sessionRepository.create(project2.id, 'Test Session 2', 'Test prompt');
      sessionId2 = session2.id;

      const button2 = buttonRepository.create({
        projectId: project2.id,
        label: 'Test Button 2',
        command: 'echo test2',
      });
      button2Id = button2.id;
    });

    it('returns latest runs for all sessions in a project', () => {
      // Create runs for first session
      repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });
      repository.complete('run-1', 0, 'output1');

      // Create runs for second session (same project)
      const sessionRepository = new SessionRepository();
      const testSession = sessionRepository.getById(testSessionId);
      const session = sessionRepository.create(testSession.projectId, 'Another Session', 'Another prompt');
      const buttonRepository = new CommandButtonRepository();
      const button = buttonRepository.create({
        projectId: testSession.projectId,
        label: 'Another Button',
        command: 'echo another',
      });

      repository.create({ id: 'run-2', sessionId: session.id, buttonId: button.id });
      repository.complete('run-2', 0, 'output2');

      // Create runs for different project
      repository.create({ id: 'run-3', sessionId: sessionId2, buttonId: button2Id });
      repository.complete('run-3', 0, 'output3');

      const latestRuns = repository.getLatestRunsForProject(testSession.projectId);

      // Should return runs from both sessions in the project (2 runs)
      expect(latestRuns.length).toBe(2);
      expect(latestRuns.some((r) => r.id === 'run-1')).toBe(true);
      expect(latestRuns.some((r) => r.id === 'run-2')).toBe(true);
      expect(latestRuns.some((r) => r.id === 'run-3')).toBe(false); // Different project
    });

    it('returns one run per button per session', () => {
      // Create multiple runs for the same button
      repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });
      repository.complete('run-1', 0, 'first');

      const before = Date.now();
      while (Date.now() === before) {
        // Wait for timestamp to change
      }

      repository.create({ id: 'run-2', sessionId: testSessionId, buttonId: testButtonId });
      repository.complete('run-2', 0, 'second');

      const sessionRepository = new SessionRepository();
      const testSession = sessionRepository.getById(testSessionId);
      const latestRuns = repository.getLatestRunsForProject(testSession.projectId);

      // Should return only one run for the button (the latest)
      expect(latestRuns.length).toBe(1);
      expect(latestRuns[0].id).toBe('run-2');
    });

    it('returns empty array for project with no runs', () => {
      const latestRuns = repository.getLatestRunsForProject('nonexistent-project');
      expect(latestRuns).toEqual([]);
    });
  });

  describe('data mapping', () => {
    it('maps database snake_case to camelCase', () => {
      repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId });
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
      expect(repository.create({ id: 'run-1', sessionId: testSessionId, buttonId: testButtonId }).output).toBe('');
    });
  });
});
