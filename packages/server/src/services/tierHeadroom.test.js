import { describe, expect, it } from 'vitest';
import { governingPercent } from './tierHeadroom.js';

function snapshot(allowances, extra = {}) {
  return {
    stale: false,
    status: 'available',
    allowances: allowances.map(([key, remainingPercent]) => ({ key, remainingPercent })),
    ...extra,
  };
}

describe('governingPercent', () => {
  it('uses the weekly percent instead of a lower 5-hour percent', () => {
    expect(governingPercent(snapshot([['five_hour', 4], ['weekly', 70]]))).toBe(70);
  });

  it('prefers Codex weekly over five_hour', () => {
    expect(governingPercent(snapshot([['five_hour', 5], ['weekly', 55]]))).toBe(55);
  });

  it('prefers Muse weekly over the 5-hour window key', () => {
    expect(governingPercent(snapshot([['window', 8], ['weekly', 60]]))).toBe(60);
  });

  it('uses the lower of two weekly rows', () => {
    expect(governingPercent(snapshot([['weekly', 80], ['weekly', 25]]))).toBe(25);
  });

  it('applies the Opus weekly cap only to opus members', () => {
    const allowances = [['seven_day', 80], ['seven_day_opus', 15], ['seven_day_sonnet', 40]];
    expect(governingPercent(snapshot(allowances), 'opus')).toBe(15);
    expect(governingPercent(snapshot(allowances), 'sonnet')).toBe(40);
  });

  it('does not let a Sonnet weekly cap move an Opus member', () => {
    expect(governingPercent(snapshot([['seven_day', 80], ['seven_day_sonnet', 5]]), 'opus')).toBe(80);
  });

  it('ignores resetsAt when choosing the window', () => {
    const reading = snapshot([['five_hour', 4], ['weekly', 70]]);
    reading.allowances[0].resetsAt = Date.now() + 86_400_000;
    reading.allowances[1].resetsAt = Date.now() + 60_000;
    expect(governingPercent(reading)).toBe(70);
  });

  it('treats a stale snapshot as unmeasured even when the 5-hour percent is present', () => {
    expect(governingPercent(snapshot([['weekly', 70], ['five_hour', 90]], { stale: true }))).toBeNull();
  });

  it('does not fall through to the 5-hour row when an applicable weekly row has no percent', () => {
    expect(governingPercent(snapshot([['weekly', null], ['five_hour', 90]]))).toBeNull();
  });

  it('falls through to the 5-hour class when no weekly row applies', () => {
    expect(governingPercent(snapshot([['seven_day_opus', 10], ['five_hour', 45]]), 'sonnet')).toBe(45);
  });

  it('uses the only window a provider reports', () => {
    expect(governingPercent(snapshot([['included', 33]]))).toBe(33);
  });

  it('uses the lower unclassified percent when neither window class is present', () => {
    expect(governingPercent(snapshot([['requests', 40], ['tokens', 15]]))).toBe(15);
  });

  it('counts a fresh exhausted status with no percents as zero', () => {
    expect(governingPercent({ stale: false, status: 'exhausted', allowances: [] })).toBe(0);
  });

  it('returns null when nothing was measured', () => {
    expect(governingPercent(null)).toBeNull();
    expect(governingPercent({ stale: false, status: 'unknown', allowances: [] })).toBeNull();
  });
});
