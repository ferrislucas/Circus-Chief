import { describe, it, expect } from 'vitest';
import { dirname } from 'node:path';
import { buildMuseHostEnv } from './museHostEnv.js';

const NODE_BIN_DIR = dirname(process.execPath);

describe('buildMuseHostEnv', () => {
  // Finding #6: exactly one env construction per turn. Re-applying the
  // builder (as the live spawn path used to do defensively) must be
  // idempotent — the node bin dir is deduped like the POSIX user bin dirs,
  // so three applications yield the same PATH as one.
  it('is idempotent: three applications yield the same PATH as one', () => {
    const sessionEnv = { FOO: 'session-wins' };
    const shellEnv = { PATH: '/shell/bin:/shared' };

    const once = buildMuseHostEnv(sessionEnv, { PATH: '/explicit/bin:/shared', HOME: '/home/u' }, { shellEnv });
    const twice = buildMuseHostEnv(sessionEnv, once, { shellEnv });
    const thrice = buildMuseHostEnv(sessionEnv, twice, { shellEnv });

    expect(twice.PATH).toBe(once.PATH);
    expect(thrice.PATH).toBe(once.PATH);
    expect(once.PATH.split(':').filter((dir) => dir === NODE_BIN_DIR)).toHaveLength(1);
    expect(once.PATH.startsWith(NODE_BIN_DIR)).toBe(true);
  });

  it('keeps explicit PATH order and appends shell-only entries once', () => {
    const env = buildMuseHostEnv({}, { PATH: '/explicit/bin:/shared' }, { shellEnv: { PATH: '/shell/bin:/shared' } });
    const parts = env.PATH.split(':');
    expect(parts.indexOf('/explicit/bin')).toBeLessThan(parts.indexOf('/shell/bin'));
    expect(parts.filter((part) => part === '/shell/bin')).toHaveLength(1);
    expect(parts.filter((part) => part === NODE_BIN_DIR)).toHaveLength(1);
  });
});
