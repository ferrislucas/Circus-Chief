import { describe, it, expect, beforeEach } from 'vitest';
import { SessionSummaryRepository } from './SessionSummaryRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { databaseManager } from './DatabaseManager.js';

describe('SessionSummaryRepository.getBySessionIds', () => {
  let repo;
  let projectRepo;
  let project;
  let sessionIds;

  function createSession(name) {
    const now = Date.now();
    const id = databaseManager.generateId();
    databaseManager.get().prepare(
      'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, project.id, name, 'running', 'standard', now, now);
    return id;
  }

  beforeEach(() => {
    repo = new SessionSummaryRepository();
    projectRepo = new ProjectRepository();

    project = projectRepo.create('Test Project', '/tmp/test');

    // Create 3 test sessions
    sessionIds = [
      createSession('Session 1'),
      createSession('Session 2'),
      createSession('Session 3'),
    ];
  });

  it('returns summaries for multiple session IDs', () => {
    repo.create(sessionIds[0], { shortSummary: 'Summary 1', fullSummary: 'Full 1' });
    repo.create(sessionIds[1], { shortSummary: 'Summary 2', fullSummary: 'Full 2' });
    repo.create(sessionIds[2], { shortSummary: 'Summary 3', fullSummary: 'Full 3' });

    const results = repo.getBySessionIds(sessionIds);

    expect(results).toHaveLength(3);
    const summaryMap = {};
    for (const r of results) {
      summaryMap[r.sessionId] = r;
    }
    expect(summaryMap[sessionIds[0]].shortSummary).toBe('Summary 1');
    expect(summaryMap[sessionIds[1]].shortSummary).toBe('Summary 2');
    expect(summaryMap[sessionIds[2]].shortSummary).toBe('Summary 3');
  });

  it('returns only summaries that exist', () => {
    repo.create(sessionIds[0], { shortSummary: 'Only one', fullSummary: 'Full' });

    const results = repo.getBySessionIds([sessionIds[0], sessionIds[1]]);

    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe(sessionIds[0]);
    expect(results[0].shortSummary).toBe('Only one');
  });

  it('returns empty array when no summaries exist for given IDs', () => {
    const results = repo.getBySessionIds(sessionIds);
    expect(results).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    const results = repo.getBySessionIds([]);
    expect(results).toEqual([]);
  });

  it('returns empty array for null input', () => {
    const results = repo.getBySessionIds(null);
    expect(results).toEqual([]);
  });

  it('returns empty array for undefined input', () => {
    const results = repo.getBySessionIds(undefined);
    expect(results).toEqual([]);
  });

  it('returns correctly mapped summary objects', () => {
    repo.create(sessionIds[0], {
      shortSummary: 'Short',
      fullSummary: 'Full summary text',
      keyActions: ['action1', 'action2'],
      filesModified: ['file1.js', 'file2.js'],
      outcome: 'success',
      messageCount: 20,
    });

    const results = repo.getBySessionIds([sessionIds[0]]);

    expect(results).toHaveLength(1);
    const summary = results[0];
    expect(summary.id).toBeDefined();
    expect(summary.sessionId).toBe(sessionIds[0]);
    expect(summary.shortSummary).toBe('Short');
    expect(summary.fullSummary).toBe('Full summary text');
    expect(summary.keyActions).toEqual(['action1', 'action2']);
    expect(summary.filesModified).toEqual(['file1.js', 'file2.js']);
    expect(summary.outcome).toBe('success');
    expect(summary.messageCount).toBe(20);
    expect(summary.createdAt).toBeTypeOf('number');
    expect(summary.updatedAt).toBeTypeOf('number');
  });

  it('works with a single session ID', () => {
    repo.create(sessionIds[0], { shortSummary: 'Single', fullSummary: 'Full' });

    const results = repo.getBySessionIds([sessionIds[0]]);

    expect(results).toHaveLength(1);
    expect(results[0].shortSummary).toBe('Single');
  });

  it('does not return summaries for sessions not in the input list', () => {
    repo.create(sessionIds[0], { shortSummary: 'Included', fullSummary: 'Full' });
    repo.create(sessionIds[1], { shortSummary: 'Excluded', fullSummary: 'Full' });

    const results = repo.getBySessionIds([sessionIds[0]]);

    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe(sessionIds[0]);
  });

  it('handles non-existent session IDs gracefully', () => {
    const results = repo.getBySessionIds(['non-existent-id-1', 'non-existent-id-2']);
    expect(results).toEqual([]);
  });

  it('handles mix of existing and non-existing session IDs', () => {
    repo.create(sessionIds[0], { shortSummary: 'Exists', fullSummary: 'Full' });

    const results = repo.getBySessionIds([sessionIds[0], 'non-existent-id']);

    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe(sessionIds[0]);
  });
});
