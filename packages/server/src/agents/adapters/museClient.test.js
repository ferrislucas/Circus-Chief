import { describe, it, expect, vi, beforeEach } from 'vitest';

// The SDK is lazy-imported by spawnMuseClient; mock it so the live spawn
// path can be observed without a real `muse serve` host.
vi.mock('@muse-code/sdk', () => ({
  MuseClient: {
    spawn: vi.fn(async (spawnOpts) => ({ __spawnOpts: spawnOpts })),
  },
}));

// Spy on the sync SSH filter: the live spawn path must trust its caller's
// already-filtered env instead of re-running the host-env build (finding #6).
vi.mock('../../services/loginShellEnv.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    filterDeadSshSocket: vi.fn(actual.filterDeadSshSocket),
  };
});

import { MuseClient } from '@muse-code/sdk';
import { filterDeadSshSocket } from '../../services/loginShellEnv.js';
import { spawnMuseClient, resolveMuseServeArgs } from './museClient.js';

describe('spawnMuseClient (finding #6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the caller-provided env through verbatim (one env build per turn)', async () => {
    const env = {
      PATH: '/usr/bin:/bin',
      HOME: '/home/dev',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
    };
    await spawnMuseClient({
      museBin: 'muse',
      args: resolveMuseServeArgs({ approvalMode: 'onRequest' }),
      env,
      shutdownTimeoutMs: 10,
    });

    expect(MuseClient.spawn).toHaveBeenCalledTimes(1);
    const spawnOpts = MuseClient.spawn.mock.calls[0][0];
    // Identity, not a rebuild: the adapter built and SSH-filtered this env
    // already (_prepareHostEnv is the single construction point per turn).
    expect(spawnOpts.env).toBe(env);
  });

  it('does not re-run the sync SSH socket filter on the live spawn path', async () => {
    await spawnMuseClient({
      museBin: 'muse',
      args: [],
      env: { PATH: '/usr/bin', SSH_AUTH_SOCK: '/tmp/dead.sock' },
      shutdownTimeoutMs: 10,
    });
    expect(filterDeadSshSocket).not.toHaveBeenCalled();
  });

  it('still defaults args and shutdown timeout when the caller omits them', async () => {
    await spawnMuseClient({ museBin: 'muse', env: { PATH: '/usr/bin' } });
    const spawnOpts = MuseClient.spawn.mock.calls[0][0];
    expect(spawnOpts.args).toEqual(resolveMuseServeArgs());
    expect(spawnOpts.shutdownTimeoutMs).toBeDefined();
  });
});
