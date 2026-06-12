import { describe, it, expect } from 'vitest';
import { mapRunsToButtonStatuses } from './commandButtonStatuses.js';

describe('mapRunsToButtonStatuses', () => {
  const buttonMap = {
    b1: { id: 'b1', label: 'Tests', command: 'yarn test', showOnList: true },
    b2: { id: 'b2', label: 'Lint', command: 'yarn lint', showOnList: false },
  };

  it('returns [] for empty latestRuns', () => {
    expect(mapRunsToButtonStatuses(buttonMap, [])).toEqual([]);
  });

  it('returns [] when latestRuns is not an array', () => {
    expect(mapRunsToButtonStatuses(buttonMap, undefined)).toEqual([]);
    expect(mapRunsToButtonStatuses(buttonMap, null)).toEqual([]);
  });

  it('returns [] when buttonMap is missing', () => {
    expect(mapRunsToButtonStatuses(null, [{ buttonId: 'b1', status: 'success' }])).toEqual([]);
  });

  it('filters out runs whose button is missing from buttonMap', () => {
    const runs = [{ buttonId: 'unknown', status: 'success' }];
    expect(mapRunsToButtonStatuses(buttonMap, runs)).toEqual([]);
  });

  it('filters out non-showOnList buttons', () => {
    const runs = [{ buttonId: 'b2', status: 'success' }];
    expect(mapRunsToButtonStatuses(buttonMap, runs)).toEqual([]);
  });

  it('maps a run to { buttonId, label, command, status, latestRun }', () => {
    const run = { buttonId: 'b1', status: 'running', extra: 'data' };
    expect(mapRunsToButtonStatuses(buttonMap, [run])).toEqual([
      {
        buttonId: 'b1',
        label: 'Tests',
        command: 'yarn test',
        status: 'running',
        latestRun: run,
      },
    ]);
  });
});
