import { describe, it, expect } from 'vitest';
import { buildLineageRows, selectCollapsedRows } from './sessionLineageLanes.js';

const T0 = new Date('2026-01-10T12:00:00Z').getTime();
const MIN = 60 * 1000;
const NOW = T0 + 60 * MIN;

function sess(id, overrides = {}) {
  return {
    id,
    name: id,
    status: 'stopped',
    createdAt: new Date(T0).toISOString(),
    updatedAt: new Date(T0).toISOString(),
    ...overrides,
  };
}

describe('buildLineageRows', () => {
  it('sorts a linear chain by createdAt and keeps one lane', () => {
    const grandchild = sess('c2', {
      parentSessionId: 'c1',
      createdAt: new Date(T0 + 20 * MIN).toISOString(),
      updatedAt: new Date(T0 + 30 * MIN).toISOString(),
    });
    const root = sess('c0', {
      createdAt: new Date(T0).toISOString(),
      updatedAt: new Date(T0 + 10 * MIN).toISOString(),
    });
    const child = sess('c1', {
      parentSessionId: 'c0',
      createdAt: new Date(T0 + 10 * MIN).toISOString(),
      updatedAt: new Date(T0 + 20 * MIN).toISOString(),
    });
    const rows = buildLineageRows([grandchild, root, child], { now: NOW });
    expect(rows.map((r) => r.session.id)).toEqual(['c0', 'c1', 'c2']);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
  });

  it('forks: first child inherits the parent lane, second child takes lane 1', () => {
    const rows = buildLineageRows(
      [
        sess('root', { createdAt: new Date(T0).toISOString() }),
        sess('child-a', {
          parentSessionId: 'root',
          createdAt: new Date(T0 + 10 * MIN).toISOString(),
        }),
        sess('child-b', {
          parentSessionId: 'root',
          createdAt: new Date(T0 + 20 * MIN).toISOString(),
        }),
      ],
      { now: NOW }
    );
    expect(rows.map((r) => r.session.id)).toEqual(['root', 'child-a', 'child-b']);
    expect(rows[0].lane).toBe(0);
    expect(rows[1].lane).toBe(0);
    expect(rows[2].lane).toBe(1);
  });

  it('breaks createdAt ties by id', () => {
    const at = new Date(T0).toISOString();
    const rows = buildLineageRows(
      [sess('b', { createdAt: at }), sess('a', { createdAt: at })],
      { now: NOW }
    );
    expect(rows.map((r) => r.session.id)).toEqual(['a', 'b']);
  });

  it('sorts scheduled sessions last and flags them', () => {
    const rows = buildLineageRows(
      [
        sess('sched', {
          status: 'scheduled',
          createdAt: new Date(T0).toISOString(),
          scheduledAt: new Date(T0 + 120 * MIN).toISOString(),
        }),
        sess('later', {
          createdAt: new Date(T0 + 50 * MIN).toISOString(),
          updatedAt: new Date(T0 + 55 * MIN).toISOString(),
        }),
        sess('root', { createdAt: new Date(T0).toISOString() }),
      ],
      { now: NOW }
    );
    expect(rows.map((r) => r.session.id)).toEqual(['root', 'later', 'sched']);
    expect(rows[2].isScheduled).toBe(true);
    expect(rows[0].isScheduled).toBe(false);
  });

  it('caps lanes at maxLanes and merges overflow into the last lane', () => {
    const children = Array.from({ length: 6 }, (_, i) =>
      sess(`child-${i}`, {
        parentSessionId: 'root',
        createdAt: new Date(T0 + (i + 1) * MIN).toISOString(),
      })
    );
    const rows = buildLineageRows(
      [sess('root', { createdAt: new Date(T0).toISOString() }), ...children],
      { now: NOW, maxLanes: 4 }
    );
    const lanes = rows.map((r) => r.lane);
    expect(Math.max(...lanes)).toBe(3);
    expect(lanes[0]).toBe(0);
    expect(lanes[1]).toBe(0);
    expect(new Set(lanes).size).toBeLessThanOrEqual(4);
  });

  it('computes exact bar fractions with an injected clock', () => {
    // Window: T0 .. NOW (60m). root spans T0..T0+30m => 0%..50%.
    const rows = buildLineageRows(
      [
        sess('root', {
          status: 'running',
          createdAt: new Date(T0).toISOString(),
          updatedAt: new Date(T0 + 10 * MIN).toISOString(),
        }),
        sess('done', {
          createdAt: new Date(T0).toISOString(),
          updatedAt: new Date(T0 + 30 * MIN).toISOString(),
          lastActivityAt: new Date(T0 + 30 * MIN).toISOString(),
        }),
      ],
      { now: NOW }
    );
    const done = rows.find((r) => r.session.id === 'done');
    expect(done.barStartPct).toBeCloseTo(0, 5);
    expect(done.barEndPct).toBeCloseTo(50, 5);
    const running = rows.find((r) => r.session.id === 'root');
    expect(running.barEndPct).toBeCloseTo(100, 5);
  });

  it('falls back to a zero-width bar when no end timestamp exists', () => {
    const s = sess('lonely', { createdAt: new Date(T0).toISOString() });
    delete s.updatedAt;
    delete s.lastActivityAt;
    const rows = buildLineageRows([s], { now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0].barEndPct).toBe(rows[0].barStartPct);
  });

  it('exposes per-row live lanes on a linear chain', () => {
    const rows = buildLineageRows(
      [
        sess('c0', { createdAt: new Date(T0).toISOString() }),
        sess('c1', {
          parentSessionId: 'c0',
          createdAt: new Date(T0 + 10 * MIN).toISOString(),
        }),
        sess('c2', {
          parentSessionId: 'c1',
          createdAt: new Date(T0 + 20 * MIN).toISOString(),
        }),
      ],
      { now: NOW }
    );
    for (const row of rows) {
      expect(row.liveLanes).toEqual([0]);
      expect(row.forkLanes).toEqual([]);
    }
  });

  it('marks fork lanes where a child leaves its parent lane', () => {
    const rows = buildLineageRows(
      [
        sess('root', { createdAt: new Date(T0).toISOString() }),
        sess('child-a', {
          parentSessionId: 'root',
          createdAt: new Date(T0 + 10 * MIN).toISOString(),
        }),
        sess('child-b', {
          parentSessionId: 'root',
          createdAt: new Date(T0 + 20 * MIN).toISOString(),
        }),
      ],
      { now: NOW }
    );
    expect(rows[0].liveLanes).toEqual([0]);
    expect(rows[0].forkLanes).toEqual([1]);
    expect(rows[1].liveLanes).toEqual([0]);
    expect(rows[1].forkLanes).toEqual([]);
    expect(rows[2].liveLanes).toEqual([1]);
    expect(rows[2].forkLanes).toEqual([]);
  });

  it('drops a finished branch lane from later rows', () => {
    const rows = buildLineageRows(
      [
        sess('root', { createdAt: new Date(T0).toISOString() }),
        sess('a', {
          parentSessionId: 'root',
          createdAt: new Date(T0 + 10 * MIN).toISOString(),
        }),
        sess('b', {
          parentSessionId: 'root',
          createdAt: new Date(T0 + 20 * MIN).toISOString(),
        }),
        sess('c', {
          parentSessionId: 'b',
          createdAt: new Date(T0 + 30 * MIN).toISOString(),
        }),
        sess('d', {
          parentSessionId: 'a',
          createdAt: new Date(T0 + 40 * MIN).toISOString(),
        }),
      ],
      { now: NOW }
    );
    expect(rows.map((r) => r.session.id)).toEqual(['root', 'a', 'b', 'c', 'd']);
    // Row 'b' sits on the fork lane while the parent lane passes through.
    expect(rows[2].lane).toBe(1);
    expect(rows[2].liveLanes).toEqual([0, 1]);
    // The fork lane's subtree is finished by the last row, so it disappears.
    const last = rows[rows.length - 1];
    expect(last.liveLanes).toEqual([0]);
    expect(last.liveLanes).not.toContain(1);
  });

  it('selectCollapsedRows pins the current row when it is past the limit', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ session: { id: `s${i}` } }));
    const collapsed = selectCollapsedRows(rows, 's9', 8);
    expect(collapsed).toHaveLength(8);
    expect(collapsed.map((r) => r.session.id)).toEqual(
      ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's9']
    );
  });

  it('selectCollapsedRows keeps the first rows when the current row is within the limit', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ session: { id: `s${i}` } }));
    expect(selectCollapsedRows(rows, 's2', 8).map((r) => r.session.id)).toEqual(
      ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']
    );
    expect(selectCollapsedRows(rows, null, 8)).toHaveLength(8);
    expect(selectCollapsedRows(rows.slice(0, 8), 's7', 8)).toHaveLength(8);
  });

  it('returns [] for empty input without throwing', () => {
    expect(buildLineageRows([])).toEqual([]);
    expect(buildLineageRows()).toEqual([]);
  });
});
