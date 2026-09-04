import { describe, expect, it, vi } from 'vitest';
import {
  collectWorkflowSessions,
  isSessionActivelyRunning,
  summarizeWorkflowSessions,
} from './workflowStatus.js';

describe('workflowStatus', () => {
  it('only treats unblocked running and starting sessions as active', () => {
    expect(isSessionActivelyRunning(null)).toBe(false);
    expect(isSessionActivelyRunning({ status: 'running' })).toBe(true);
    expect(isSessionActivelyRunning({ status: 'starting' })).toBe(true);
    expect(isSessionActivelyRunning({ status: 'running', pendingAgentInput: true })).toBe(false);
    expect(isSessionActivelyRunning({ status: 'scheduled' })).toBe(false);
  });

  it('collects a workflow tree once even when child lookup contains a cycle', () => {
    const root = { id: 'root' };
    const child = { id: 'child' };
    const findChildren = vi.fn((id) => {
      if (id === 'root') return [child];
      if (id === 'child') return [root];
      return [];
    });

    expect(collectWorkflowSessions(null, findChildren)).toEqual([]);
    expect(collectWorkflowSessions(root, findChildren)).toEqual([root, child]);
    expect(findChildren).toHaveBeenCalledTimes(2);
  });

  it('summarizes mutually exclusive running and waiting work', () => {
    const summary = summarizeWorkflowSessions([
      { status: 'running' },
      { status: 'starting', pendingAgentInput: true },
      { status: 'scheduled' },
      { status: 'completed' },
      { status: 'stopped' },
    ]);

    expect(summary).toEqual({
      runningCount: 1,
      waitingCount: 1,
      scheduledCount: 1,
      completedCount: 2,
      totalCount: 5,
      effectiveStatus: 'running',
    });
    expect(summarizeWorkflowSessions([{ status: 'running', pendingAgentInput: true }]).effectiveStatus)
      .toBe('waiting');
    expect(summarizeWorkflowSessions([]).effectiveStatus).toBe('idle');
  });
});
