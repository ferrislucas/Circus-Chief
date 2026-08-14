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
});
