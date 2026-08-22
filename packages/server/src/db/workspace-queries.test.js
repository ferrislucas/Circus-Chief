import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { getWorkspaceCardPage } from './workspace-queries.js';

function withDb(fn) {
  const db = new Database(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf-8'));
  try {
    db.prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('project', 'Project', '/tmp', 1, 1);
    return fn(db);
  } finally {
    db.close();
  }
}

function addSession(db, id, options = {}) {
  const {
    parentId = null, status = 'stopped', starred = 0, activity = null,
    createdAt = 1, updatedAt = createdAt,
  } = options;
  db.prepare(`INSERT INTO sessions
    (id, project_id, name, parent_session_id, status, starred, last_activity_at, created_at, updated_at)
    VALUES (?, 'project', ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, id, parentId, status, starred, activity, createdAt, updatedAt);
}

describe('getWorkspaceCardPage', () => {
  it('terminates a malformed cycle and aggregates deep descendants behaviorally', () => withDb((db) => {
    addSession(db, 'root');
    addSession(db, 'child', { parentId: 'root' });
    addSession(db, 'grandchild', { parentId: 'child', status: 'running' });
    // Bypass the immutability trigger to emulate corrupt historical data.
    db.exec('DROP TRIGGER IF EXISTS trg_sessions_parent_session_id_immutable');
    db.prepare('UPDATE sessions SET parent_session_id = ? WHERE id = ?').run('grandchild', 'root');
    // Restore a root so the traversal has a visible workspace entry point.
    db.prepare('UPDATE sessions SET parent_session_id = NULL WHERE id = ?').run('root');

    const page = getWorkspaceCardPage(db, 'project', { limit: 10 });
    expect(page.cards).toHaveLength(1);
    expect(page.cards[0]).toMatchObject({
      id: 'root', status: 'stopped', runningCount: 1, descendantCount: 2,
    });
    expect(page.cards[0].memberIds).toEqual(expect.arrayContaining(['root', 'child', 'grandchild']));
    expect(page.cards[0].runningSessionIds).toEqual(['grandchild']);
  }));

  it('keeps authoritative facets for offset and cursor pages beyond the end', () => withDb((db) => {
    addSession(db, 'running', { status: 'running', activity: 30, createdAt: 30 });
    addSession(db, 'idle', { activity: 20, createdAt: 20 });
    const first = getWorkspaceCardPage(db, 'project', { limit: 1 });
    const offsetPastEnd = getWorkspaceCardPage(db, 'project', { limit: 1, offset: 5 });
    const cursorPastEnd = getWorkspaceCardPage(db, 'project', { limit: 1, cursor: first.nextCursor });

    expect(offsetPastEnd).toMatchObject({ cards: [], facets: { running: 1, idle: 1, waiting: 0 } });
    expect(cursorPastEnd.facets).toEqual({ running: 1, idle: 1, waiting: 0 });
  }));

  it('orders by session updates newer than denormalized external activity', () => withDb((db) => {
    addSession(db, 'recent-update', { activity: 10, createdAt: 1, updatedAt: 30 });
    addSession(db, 'recent-message', { activity: 20, createdAt: 2, updatedAt: 2 });

    const page = getWorkspaceCardPage(db, 'project', { limit: 10 });

    expect(page.cards.map(card => card.id)).toEqual(['recent-update', 'recent-message']);
    expect(page.cards[0].lastActivityAt).toBe(30);
  }));

  it('prepares one statement for cards and facets together', () => withDb((db) => {
    addSession(db, 'running', { status: 'running' });
    let prepares = 0;
    const countingDb = { prepare(...args) { prepares += 1; return db.prepare(...args); } };

    expect(getWorkspaceCardPage(countingDb, 'project', { limit: 10 }).facets).toEqual({ running: 1, idle: 0, waiting: 0 });
    expect(prepares).toBe(1);
  }));
});
