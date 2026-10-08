import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getKanbanDeliveryHealth, redriveLaneEntryEvent, getLaneEntryRecoveryCandidates } from './kanbanRecoveryService.js';

vi.mock('./kanbanService.js', () => ({
  drainLaneEntryTrigger: vi.fn(),
}));

vi.mock('./sessionManager.js', () => ({
  isSessionActive: vi.fn(() => false),
}));

import { drainLaneEntryTrigger } from './kanbanService.js';
import { isSessionActive } from './sessionManager.js';
import {
  kanbanBoards,
  kanbanLanes,
  kanbanCards,
  projects,
  sessions,
  databaseManager,
} from '../database.js';
import { createLaneRunForEntry } from './workflowSessionService.js';

describe('getKanbanDeliveryHealth', () => {
  it('uses status-bounded aggregate queries instead of loading delivery history', () => {
    const calls = [];
    const db = {
      prepare(sql) {
        calls.push(sql);
        return { get: () => ({ count: 3, oldest: 900 }) };
      },
    };

    expect(getKanbanDeliveryHealth(db, 1_000)).toMatchObject({
      status: 'degraded',
      counts: { pending: 3, completed: 3 },
      oldestRelevantAgeMs: 100,
    });
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((sql) => /WHERE status/i.test(sql))).toBe(true);
    expect(calls.every((sql) => !/SELECT status, delivery_phase/i.test(sql))).toBe(true);
  });

  it('classifies a growing pending backlog by configured warning and critical thresholds', () => {
    let calls = 0;
    const db = { prepare: () => ({ get: () => ({ count: ++calls === 1 ? 9 : 0, oldest: 900 }) }) };

    expect(getKanbanDeliveryHealth(db, 1_000, { pendingWarning: 5, pendingCritical: 8 }).severity).toBe('critical');
  });

  describe('terminal-state recency window', () => {
    // Rows are (status, terminal timestamp); the fake db applies the same
    // window predicate the real queries push into SQLite.
    const dbWithTerminalRows = (rows) => ({
      prepare(sql) {
        return {
          get(...params) {
            const match = /status='(failed|invalid)'/.exec(sql);
            if (!match) return { count: 0, oldest: null };
            const since = params[0];
            return { count: rows.filter((r) => r.status === match[1] && r.terminalAt >= since).length };
          },
        };
      },
    });

    it('ignores terminal deliveries that aged out of the window', () => {
      const now = 100 * 60 * 60 * 1000;
      const db = dbWithTerminalRows([
        { status: 'failed', terminalAt: now - (48 * 60 * 60 * 1000) },
        { status: 'invalid', terminalAt: now - (48 * 60 * 60 * 1000) },
      ]);

      expect(getKanbanDeliveryHealth(db, now)).toMatchObject({
        status: 'operational',
        severity: 'healthy',
        reasons: [],
        counts: { exhausted: 0, quarantined: 0 },
      });
    });

    it('still degrades on terminal deliveries inside the window', () => {
      const now = 100 * 60 * 60 * 1000;
      const db = dbWithTerminalRows([{ status: 'failed', terminalAt: now - (60 * 60 * 1000) }]);

      expect(getKanbanDeliveryHealth(db, now)).toMatchObject({
        status: 'degraded',
        severity: 'warning',
        reasons: ['exhausted delivery events'],
        counts: { exhausted: 1 },
      });
    });

    it('honours a configured window and reports it back to callers', () => {
      const now = 100 * 60 * 60 * 1000;
      const db = dbWithTerminalRows([{ status: 'failed', terminalAt: now - (60 * 60 * 1000) }]);

      const health = getKanbanDeliveryHealth(db, now, { terminalWindowMs: 30 * 60 * 1000 });
      expect(health).toMatchObject({ status: 'operational', terminalWindowMs: 30 * 60 * 1000 });
    });
  });
});

describe('redriveLaneEntryEvent', () => {
  let project;
  let lane;

  beforeEach(() => {
    vi.clearAllMocks();
    project = projects.create('Redrive Project', '/tmp/redrive');
    const board = kanbanBoards.create(project.id);
    [lane] = kanbanLanes.getByBoardId(board.id);
    kanbanLanes.update(lane.id, { onEnterPrompt: 'Do the lane work' });
  });

  function setupEvent({ status = 'needs_attention', phase = 'dispatch_intent', key = 'k1', acceptedKey = null, ack = null, attempts = 2, withChild = true, childStatus = 'error', runStatus = 'open' } = {}) {
    const workspace = sessions.create(project.id, 'Workspace', 'root prompt');
    const card = kanbanCards.create(lane.id, workspace.id);
    const run = createLaneRunForEntry({
      projectId: project.id, workspaceId: workspace.id, cardId: card.id,
      lane: kanbanLanes.getById(lane.id),
    });
    let child = null;
    if (withChild) {
      child = sessions.create(project.id, 'Child', 'child prompt', { parentSessionId: workspace.id });
      databaseManager.get().prepare('UPDATE kanban_lane_runs SET root_session_id=? WHERE id=?').run(child.id, run.id);
      databaseManager.get().prepare('UPDATE sessions SET lane_run_id=?, own_work_state=?, status=? WHERE id=?')
        .run(run.id, childStatus === 'error' ? 'closed_failed' : 'open', childStatus, child.id);
    }
    if (runStatus !== 'open') {
      databaseManager.get().prepare("UPDATE kanban_lane_runs SET status=?, failed_at=? WHERE id=?")
        .run(runStatus, Date.now(), run.id);
    }
    databaseManager.get().prepare(`UPDATE kanban_lane_entry_events
      SET status=?, delivery_phase=?, dispatch_key=?, accepted_dispatch_key=?, dispatch_acknowledged_at=?,
        attempt_count=?, last_error=?, updated_at=? WHERE id=?`)
      .run(status, phase, key, acceptedKey, ack, attempts, 'ambiguous_dispatch: child ownership exists without provider dispatch acknowledgement', Date.now(), run.laneEntryEventId);
    return { workspace, card, run, child, eventId: run.laneEntryEventId };
  }

  function eventRow(eventId) {
    return databaseManager.get().prepare('SELECT * FROM kanban_lane_entry_events WHERE id=?').get(eventId);
  }

  it('reports unknown events and non-redrivable statuses as blocked', async () => {
    await expect(redriveLaneEntryEvent('missing')).resolves.toMatchObject({ blocked: true });
    const { eventId } = setupEvent({ status: 'completed' });
    await expect(redriveLaneEntryEvent(eventId, { dryRun: true })).resolves.toMatchObject({ blocked: true });
    expect(drainLaneEntryTrigger).not.toHaveBeenCalled();
  });

  it('dry-runs a proven delivery without writing', async () => {
    const { eventId } = setupEvent({ acceptedKey: 'k1' });
    const result = await redriveLaneEntryEvent(eventId, { dryRun: true });
    expect(result).toMatchObject({ plan: 'complete_proven', applied: false, blocked: false });
    expect(eventRow(eventId).status).toBe('needs_attention');
    expect(drainLaneEntryTrigger).not.toHaveBeenCalled();
  });

  it('dry-runs redelivery for an unaccepted dispatch on an open run', async () => {
    const { eventId } = setupEvent();
    const result = await redriveLaneEntryEvent(eventId, { dryRun: true });
    expect(result).toMatchObject({ plan: 'redeliver', applied: false, blocked: false });
    expect(eventRow(eventId).status).toBe('needs_attention');
  });

  it('dry-runs a fresh entry event for an unaccepted dispatch on a terminal run', async () => {
    const { eventId } = setupEvent({ runStatus: 'failed' });
    const result = await redriveLaneEntryEvent(eventId, { dryRun: true });
    expect(result).toMatchObject({ plan: 'fresh_entry', applied: false, blocked: false });
  });

  it('refuses while the attached child may still be executing', async () => {
    const { eventId, child } = setupEvent();
    isSessionActive.mockReturnValueOnce(true);
    await expect(redriveLaneEntryEvent(eventId, { dryRun: true }))
      .resolves.toMatchObject({ blocked: true, childSessionId: child.id });
  });

  it('refuses when the card moved out of the event lane', async () => {
    const { eventId, card } = setupEvent();
    const otherLane = kanbanLanes.getByBoardId(kanbanBoards.getByProjectId(project.id).id)
      .find((candidate) => candidate.id !== card.laneId);
    databaseManager.get().prepare('UPDATE kanban_cards SET lane_id=? WHERE id=?').run(otherLane.id, card.id);
    await expect(redriveLaneEntryEvent(eventId, { dryRun: true }))
      .resolves.toMatchObject({ blocked: true });
  });

  it('applies a proven delivery without dispatching a new child', async () => {
    const { eventId } = setupEvent({ acceptedKey: 'k1' });
    drainLaneEntryTrigger.mockResolvedValueOnce(true);
    const result = await redriveLaneEntryEvent(eventId, { dryRun: false });
    expect(result).toMatchObject({ plan: 'complete_proven', applied: true, delivered: true });
    const row = eventRow(eventId);
    expect(row.status).toBe('pending');
    // Evidence is preserved so the drain can complete without a new child.
    expect(row.dispatch_key).toBe('k1');
    expect(row.accepted_dispatch_key).toBe('k1');
    expect(drainLaneEntryTrigger).toHaveBeenCalledWith(eventId);
  });

  it('applies redelivery with a renewed attempt budget', async () => {
    const { eventId } = setupEvent({ attempts: 8 });
    drainLaneEntryTrigger.mockResolvedValueOnce(true);
    const result = await redriveLaneEntryEvent(eventId, { dryRun: false });
    expect(result).toMatchObject({ plan: 'redeliver', applied: true, delivered: true });
    const row = eventRow(eventId);
    expect(row).toMatchObject({ status: 'pending', attempt_count: 0, delivery_phase: 'pending', dispatch_key: null });
    expect(row.last_error).toMatch(/operator redrive/);
  });

  it('mints a fresh entry event and retires the old one with linkage', async () => {
    const { eventId } = setupEvent({ runStatus: 'failed' });
    drainLaneEntryTrigger.mockResolvedValueOnce(true);
    const result = await redriveLaneEntryEvent(eventId, { dryRun: false });
    expect(result).toMatchObject({ plan: 'fresh_entry', applied: true, delivered: true });
    expect(result.newEventId).not.toBe(eventId);
    expect(eventRow(eventId)).toMatchObject({ status: 'invalid' });
    expect(eventRow(eventId).last_error).toContain(result.newEventId);
    expect(eventRow(result.newEventId).status).toBe('pending');
    expect(drainLaneEntryTrigger).toHaveBeenCalledWith(result.newEventId);
  });

  it('lists parked and ambiguously-failed events as recovery candidates', async () => {
    const first = setupEvent();
    const second = setupEvent({ status: 'failed' });
    const candidates = getLaneEntryRecoveryCandidates();
    const byId = new Map(candidates.map((candidate) => [candidate.eventId, candidate]));
    expect(byId.get(first.eventId)).toMatchObject({ recoveryClassification: 'needs_attention', attemptCount: 2 });
    expect(byId.get(second.eventId)).toMatchObject({ recoveryClassification: 'ambiguous_terminal' });
    expect(byId.get(first.eventId).childSessionId).toBe(first.child.id);
  });
});
