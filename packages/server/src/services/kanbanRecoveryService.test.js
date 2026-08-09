import { describe, expect, it } from 'vitest';
import { getKanbanDeliveryHealth } from './kanbanRecoveryService.js';

describe('getKanbanDeliveryHealth', () => {
  it('uses one aggregate query instead of loading the delivery history', () => {
    const calls = [];
    const db = {
      prepare(sql) {
        calls.push(sql);
        return { get: () => ({ pending: 3, claimed: 2, stalled: 1, ambiguous: 1, exhausted: 1, quarantined: 0, completed: 500_000, oldest_relevant_at: 900 }) };
      },
    };

    expect(getKanbanDeliveryHealth(db, 1_000)).toMatchObject({
      status: 'degraded',
      counts: { pending: 3, completed: 500_000 },
      oldestRelevantAgeMs: 100,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toMatch(/SELECT status, delivery_phase/i);
  });
});
