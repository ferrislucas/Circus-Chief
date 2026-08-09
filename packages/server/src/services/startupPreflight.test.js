import { describe, expect, it, vi } from 'vitest';
import { runStartupPreflight } from './startupPreflight.js';

describe('runStartupPreflight', () => {
  it('returns a blocked result and disables workers instead of throwing', () => {
    const report = { ok: false, violations: [{ type: 'run_root' }] };
    const reconcile = vi.fn(() => ({ blocked: true, applied: false }));

    expect(runStartupPreflight({ reconcile, audit: () => report })).toEqual({
      ok: false,
      report,
      reconciliation: { blocked: true, applied: false },
      workersEnabled: false,
    });
    expect(reconcile).toHaveBeenCalledWith({ dryRun: false });
  });

  it('keeps workers enabled when recovery leaves only a recoverable observation', () => {
    const report = { ok: true, violations: [{ type: 'run_root', severity: 'warning' }] };
    const reconciliation = { blocked: false, applied: true };

    expect(runStartupPreflight({ reconcile: () => reconciliation, audit: () => report })).toEqual({
      ok: true,
      report,
      reconciliation,
      workersEnabled: true,
    });
  });
});
