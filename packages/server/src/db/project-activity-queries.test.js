import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import {
  getProjectActivityAggregates,
  PROJECT_ACTIVITY_SQL,
} from './project-activity-queries.js';

function withDb(fn) {
  const db = new Database(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf-8'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function addProject(db, id, name = `project-${id}`) {
  db.prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, `/tmp/${id}`, 1, 1);
}

function addSession(db, id, options = {}) {
  const {
    projectId = 'project',
    parentId = null,
    status = 'stopped',
    pendingAgentInput = false,
    activity = null,
    createdAt = 1,
    updatedAt = createdAt,
  } = options;
  db.prepare(`INSERT INTO sessions
    (id, project_id, name, parent_session_id, status, pending_agent_input, last_activity_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, projectId, id, parentId, status, pendingAgentInput ? 1 : 0, activity, createdAt, updatedAt);
}

describe('getProjectActivityAggregates', () => {
  it('returns an empty map for an empty database', () => withDb((db) => {
    const result = getProjectActivityAggregates(db);
    expect(result.size).toBe(0);
  }));

  it('omits projects that have only inactive sessions (no aggregate entry)', () => withDb((db) => {
    addProject(db, 'project');
    addSession(db, 'stopped', { status: 'stopped' });
    addSession(db, 'completed', { status: 'completed' });
    addSession(db, 'error', { status: 'error' });
    addSession(db, 'scheduled', { status: 'scheduled' });
    // A session resting in status='waiting' (turn ended, idle, ready for
    // follow-up) is NOT active on its own — only pending_agent_input drives
    // the "waiting" bucket now.
    addSession(db, 'waiting-idle', { status: 'waiting' });

    // The Map only carries projects with ≥1 active workspace; the zero-count
    // default for inactive projects is applied by ProjectRepository (Phase 2).
    expect(getProjectActivityAggregates(db).has('project')).toBe(false);
  }));

  it('counts running, starting and pending-agent-input as active; status=waiting alone is not active', () => withDb((db) => {
    addProject(db, 'project');
    addSession(db, 'running', { status: 'running' });
    addSession(db, 'starting', { status: 'starting' });
    // Blocked mid-turn on AskUserQuestion: status stays 'running' the whole
    // time it's parked (promptStore.js never touches status).
    addSession(db, 'blocked-on-question', { status: 'running', pendingAgentInput: true });

    const project = getProjectActivityAggregates(db).get('project');
    expect(project.runningWorkspaces).toHaveLength(3);
    const ids = new Set(project.runningWorkspaces.map((w) => w.id));
    expect(ids).toEqual(new Set(['running', 'starting', 'blocked-on-question']));
    for (const workspace of project.runningWorkspaces) {
      expect(workspace.activeCount).toBe(1);
    }
    // runningSessionCount counts running + starting only (both 'running' rows).
    expect(project.runningSessionCount).toBe(3);
    expect(project.waitingSessionCount).toBe(1);
  }));

  it('excludes stopped, completed, error, scheduled and waiting-without-a-pending-prompt one at a time', () => withDb(() => {
    for (const status of ['stopped', 'completed', 'error', 'scheduled', 'waiting']) {
      const fresh = new Database(':memory:');
      fresh.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf-8'));
      addProject(fresh, 'project');
      addSession(fresh, status, { status });
      try {
        expect(getProjectActivityAggregates(fresh).has('project'), `status ${status} must be excluded`).toBe(false);
      } finally {
        fresh.close();
      }
    }
  }));

  it('counts a lone running root as activeCount 1', () => withDb((db) => {
    addProject(db, 'project');
    addSession(db, 'root', { status: 'running' });

    const project = getProjectActivityAggregates(db).get('project');
    expect(project.runningWorkspaces).toEqual([
      { id: 'root', name: 'root', activeCount: 1 },
    ]);
    expect(project.runningSessionCount).toBe(1);
    expect(project.waitingSessionCount).toBe(0);
  }));

  it('counts all active members across a multi-level tree, not just direct children', () => withDb((db) => {
    addProject(db, 'project');
    addSession(db, 'root', { status: 'running' });
    // A settled/stopped session can still carry pending_agent_input=1 as a
    // pure data case; kept disjoint from running/starting here so this test
    // isolates independent counting (the realistic running+waiting overlap
    // case is covered separately below).
    addSession(db, 'child', { parentId: 'root', status: 'stopped', pendingAgentInput: true });
    addSession(db, 'grandchild', { parentId: 'child', status: 'running' });
    addSession(db, 'great-grandchild', { parentId: 'grandchild', status: 'stopped', pendingAgentInput: true });

    const project = getProjectActivityAggregates(db).get('project');
    expect(project.runningWorkspaces).toEqual([
      { id: 'root', name: 'root', activeCount: 4 },
    ]);
    expect(project.runningSessionCount).toBe(2); // root + grandchild (running/starting)
    expect(project.waitingSessionCount).toBe(2); // child + great-grandchild (pending_agent_input)
  }));

  it('excludes an archived root from the list and both counts', () => withDb((db) => {
    addProject(db, 'project');
    addSession(db, 'archived-root', { status: 'running' });
    db.prepare('UPDATE sessions SET archived = 1 WHERE id = ?').run('archived-root');

    expect(getProjectActivityAggregates(db).has('project')).toBe(false);
  }));

  it('still counts an archived descendant of a live root', () => withDb((db) => {
    addProject(db, 'project');
    addSession(db, 'root', { status: 'running' });
    addSession(db, 'archived-child', { parentId: 'root', status: 'running' });
    db.prepare('UPDATE sessions SET archived = 1 WHERE id = ?').run('archived-child');

    const project = getProjectActivityAggregates(db).get('project');
    expect(project.runningWorkspaces).toEqual([
      { id: 'root', name: 'root', activeCount: 2 },
    ]);
    expect(project.runningSessionCount).toBe(2);
  }));

  it('lists multiple active workspaces per project', () => withDb((db) => {
    addProject(db, 'project');
    addSession(db, 'alpha', { status: 'running', activity: 30 });
    addSession(db, 'beta', { status: 'running', pendingAgentInput: true, activity: 20 });

    const project = getProjectActivityAggregates(db).get('project');
    expect(project.runningWorkspaces).toHaveLength(2);
    const byId = Object.fromEntries(project.runningWorkspaces.map((w) => [w.id, w.activeCount]));
    expect(byId).toEqual({ alpha: 1, beta: 1 });
    expect(project.runningSessionCount).toBe(2);
    expect(project.waitingSessionCount).toBe(1);
  }));

  it('never bleeds aggregates across project boundaries', () => withDb((db) => {
    addProject(db, 'one');
    addProject(db, 'two');
    addSession(db, 'one-root', { projectId: 'one', status: 'running' });
    addSession(db, 'two-root', { projectId: 'two', status: 'running', pendingAgentInput: true });

    const result = getProjectActivityAggregates(db);
    expect(result.get('one').runningSessionCount).toBe(1);
    expect(result.get('one').waitingSessionCount).toBe(0);
    expect(result.get('two').runningSessionCount).toBe(1);
    expect(result.get('two').waitingSessionCount).toBe(1);
    expect(result.get('one').runningWorkspaces.map((w) => w.id)).toEqual(['one-root']);
    expect(result.get('two').runningWorkspaces.map((w) => w.id)).toEqual(['two-root']);
  }));

  it('orders workspaces by lastActivityAt DESC with id DESC as tiebreaker', () => withDb((db) => {
    addProject(db, 'project');
    addSession(db, 'older', { status: 'running', activity: 5 });
    addSession(db, 'newer', { status: 'running', activity: 10 });
    addSession(db, 'tie-a', { status: 'running', activity: 5 });
    addSession(db, 'tie-b', { status: 'running', activity: 5 });

    const project = getProjectActivityAggregates(db).get('project');
    const ids = project.runningWorkspaces.map((w) => w.id);
    // newest first; then the 5-activity ties resolve by id DESC (tie-b > tie-a).
    expect(ids).toEqual(['newer', 'tie-b', 'tie-a', 'older']);
  }));

  it('splits running and waiting counts within a single workspace', () => withDb((db) => {
    addProject(db, 'project');
    addSession(db, 'root', { status: 'running' });
    addSession(db, 'child-waiting', { parentId: 'root', status: 'running', pendingAgentInput: true });
    addSession(db, 'child-starting', { parentId: 'root', status: 'starting' });

    const project = getProjectActivityAggregates(db).get('project');
    expect(project.runningWorkspaces).toEqual([
      { id: 'root', name: 'root', activeCount: 3 },
    ]);
    // child-waiting is realistically still status='running' while blocked, so
    // it contributes to both counts (root + child-waiting + child-starting).
    expect(project.runningSessionCount).toBe(3);
    expect(project.waitingSessionCount).toBe(1); // child-waiting
  }));

  it('does not double-count a session that is both running and pending_agent_input', () => withDb((db) => {
    addProject(db, 'project');
    // Realistic case: the agent is mid-turn (status='running') and blocked on
    // AskUserQuestion (pending_agent_input=1) at the same time.
    addSession(db, 'root', { status: 'running', pendingAgentInput: true });

    const project = getProjectActivityAggregates(db).get('project');
    expect(project.runningWorkspaces).toEqual([
      { id: 'root', name: 'root', activeCount: 1 },
    ]);
    expect(project.runningSessionCount).toBe(1);
    expect(project.waitingSessionCount).toBe(1);
  }));

  it('returns an empty root name unchanged (presentation is the UI layer concern)', () => withDb((db) => {
    addProject(db, 'project');
    db.prepare(`INSERT INTO sessions
      (id, project_id, name, parent_session_id, status, last_activity_at, created_at, updated_at)
      VALUES (?, 'project', '', NULL, 'running', NULL, 1, 1)`).run('unnamed');

    const project = getProjectActivityAggregates(db).get('project');
    expect(project.runningWorkspaces).toEqual([
      { id: 'unnamed', name: '', activeCount: 1 },
    ]);
  }));

  it('terminates a malformed parent chain without double-counting', () => withDb((db) => {
    addProject(db, 'project');
    addSession(db, 'root', { status: 'running' });
    addSession(db, 'child', { parentId: 'root' });
    addSession(db, 'grandchild', { parentId: 'child', status: 'running' });
    // Bypass the immutability trigger to emulate corrupt historical data.
    db.exec('DROP TRIGGER IF EXISTS trg_sessions_parent_session_id_immutable');
    db.prepare('UPDATE sessions SET parent_session_id = ? WHERE id = ?').run('grandchild', 'root');
    // Restore a root so the traversal has a visible workspace entry point
    // (mirrors workspace-queries.test.js — the parent chain briefly cycled).
    db.prepare('UPDATE sessions SET parent_session_id = NULL WHERE id = ?').run('root');

    const project = getProjectActivityAggregates(db).get('project');
    expect(project.runningWorkspaces).toEqual([
      { id: 'root', name: 'root', activeCount: 2 },
    ]);
  }));

  it('reads only the sessions table, never messages/command_runs/session_summaries', () => withDb((db) => {
    addProject(db, 'project');
    addSession(db, 'running', { status: 'running' });

    const rows = db.prepare(`EXPLAIN QUERY PLAN ${PROJECT_ACTIVITY_SQL}`).all();
    const details = rows.map((row) => row.detail).join(' ');
    expect(details).toMatch(/sessions/i);
    expect(details).not.toMatch(/messages|command_runs|session_summaries/i);
  }));
});
