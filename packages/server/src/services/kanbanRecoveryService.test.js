import { describe, expect, it } from 'vitest';
import { getKanbanDeliveryHealth } from './kanbanRecoveryService.js';

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
