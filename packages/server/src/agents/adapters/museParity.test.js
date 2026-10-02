import { describe, it, expect } from 'vitest';
import { assertMuseHostParity, scrubAndAttachDiagnostics } from './museParity.js';

describe('scrubAndAttachDiagnostics (finding #5)', () => {
  it('returns the error undecorated when no host is available', () => {
    const err = new Error('boom');
    expect(scrubAndAttachDiagnostics(err, undefined)).toBe(err);
    expect(err.message).toBe('boom');
    expect(err.museHostDiagnostics).toBeUndefined();
  });

  it('returns the error undecorated when the host has no context', () => {
    const err = new Error('boom');
    expect(scrubAndAttachDiagnostics(err, {})).toBe(err);
    expect(err.message).toBe('boom');
    expect(err.museHostDiagnostics).toBeUndefined();
  });

  it('still decorates when host context is present', () => {
    const err = new Error('boom');
    const decorated = scrubAndAttachDiagnostics(err, {
      pid: 4242,
      context: {
        hostEnv: {},
        stderrTail: ['some stderr'],
        hostState: 'connected',
        hostExit: null,
        parityWarnings: [],
      },
    });
    expect(decorated).toBe(err);
    expect(err.message).toContain('Muse host state=connected');
    expect(err.museHostDiagnostics).toMatchObject({ state: 'connected', pid: 4242 });
  });
});

describe('assertMuseHostParity', () => {
  it('does not throw for soft credential failures', () => {
    expect(() => assertMuseHostParity(
      { PATH: '/usr/bin:/bin', HOME: '/nonexistent-home-xyz' },
      { museBin: 'muse', skipBinaries: true },
    )).not.toThrow();
  });
});

describe('parity warning scope (finding #7)', () => {
  // A missing HOME/identity must be recorded as a parity warning with
  // remediation (FR-4/FR-8), not silently ignored.
  it.each([
    ['home', { USER: 'someone', LOGNAME: 'someone' }],
    ['identity', { HOME: '/tmp' }],
  ])('records a %s warning with remediation when it is missing', (signal, extraEnv) => {
    const warnings = [];
    const context = { setParityWarnings: (w) => warnings.push(...w) };
    const result = assertMuseHostParity(
      { PATH: '/usr/bin:/bin', ...extraEnv },
      { museBin: 'muse', skipBinaries: true, context },
    );
    const warning = result.find((w) => w.signal === signal);
    expect(warning).toBeDefined();
    expect(warning.remediation).toBeTruthy();
    expect(warning.code).toBeTruthy();
    expect(warnings).toContainEqual(warning);
  });

  // A turn error unrelated to credentials (e.g. a timeout) must NOT carry
  // credential-remediation noise in its message.
  it('omits parity remediation from timeout errors', () => {
    const err = new Error('Muse turn timed out during turn after 100ms.');
    err.code = 'MUSE_TURN_TIMEOUT';
    const decorated = scrubAndAttachDiagnostics(err, {
      pid: 4242,
      context: {
        hostEnv: {},
        stderrTail: [],
        hostState: 'connected',
        hostExit: null,
        parityWarnings: [{ signal: 'ssh-agent', code: 'MUSE_SSH_AGENT_UNREACHABLE', remediation: 'Run ssh-add -l.' }],
      },
    });
    expect(decorated.message).not.toContain('Parity:');
    expect(decorated.message).not.toContain('ssh-add');
    // The structured warnings stay available for the UI; only the message
    // suffix (the noise) is gated.
    expect(decorated.museHostDiagnostics.parityWarnings).toHaveLength(1);
  });

  it('keeps parity remediation on plausibly credential-related errors', () => {
    const err = new Error('Muse login required: authRequired');
    const decorated = scrubAndAttachDiagnostics(err, {
      pid: 4242,
      context: {
        hostEnv: {},
        stderrTail: [],
        hostState: 'connected',
        hostExit: null,
        parityWarnings: [{ signal: 'gh-auth', code: 'MUSE_GH_UNAUTHENTICATED', remediation: 'Run gh auth login.' }],
      },
    });
    expect(decorated.message).toContain('Parity:');
    expect(decorated.message).toContain('gh auth login');
  });
});
