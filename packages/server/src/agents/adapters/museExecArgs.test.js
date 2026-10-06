import { describe, expect, it } from 'vitest';
import { buildMuseExecArgs } from './museExecArgs.js';

describe('buildMuseExecArgs', () => {
  it('uses documented long options and the explicit workspace', () => {
    const spec = buildMuseExecArgs({ prompt: 'Hi', workingDirectory: '/tmp/project', sessionId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', museBin: 'muse', options: { model: 'muse-1', approvalMode: 'allowAll' } });
    expect(spec.args).toEqual(['exec', '--json', '--workspace', '/tmp/project', '--session-id', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '--model', 'muse-1', '--yolo', 'Hi']);
  });
  it('maps the standard posture to explicit on-request approval', () => {
    const spec = buildMuseExecArgs({ prompt: 'Hi', workingDirectory: '/tmp/project', museBin: 'muse', options: { approvalMode: 'onRequest' } });
    expect(spec.args).toEqual(['exec', '--json', '--workspace', '/tmp/project', '--approval-mode', 'on-request', 'Hi']);
  });
  it('maps the plan posture to untrusted approval with writes disabled', () => {
    const spec = buildMuseExecArgs({ prompt: 'Hi', workingDirectory: '/tmp/project', museBin: 'muse', options: { approvalMode: 'promptUnmatched' } });
    expect(spec.args).toEqual(['exec', '--json', '--workspace', '/tmp/project', '--approval-mode', 'untrusted', '--disable-write', 'Hi']);
  });
  it('fails closed to on-request when approvalMode is unset', () => {
    const spec = buildMuseExecArgs({ prompt: 'Hi', workingDirectory: '/tmp/project', museBin: 'muse', options: {} });
    expect(spec.args).toContain('--approval-mode');
    expect(spec.args).not.toContain('--yolo');
  });
  it('rejects unknown approval modes before spawn', () => {
    expect(() => buildMuseExecArgs({ prompt: 'Hi', workingDirectory: '/tmp/project', options: { approvalMode: 'ask' } })).toThrow(/Unsupported Muse approval mode/);
  });
  // Finding #7: no producer ever sets `trustWorkspace`, so the flag must
  // never be emitted even when the option is set.
  it('never emits --trust-workspace', () => {
    const spec = buildMuseExecArgs({ prompt: 'Hi', workingDirectory: '/tmp/project', museBin: 'muse', options: { approvalMode: 'allowAll', trustWorkspace: true } });
    expect(spec.args).not.toContain('--trust-workspace');
  });
  // Finding #10: `denyUnmatched` is in the closed posture vocabulary, so the
  // adapter must handle it — strictest flags (`never` + no writes).
  it('maps denyUnmatched to the strictest approval flags', () => {
    const spec = buildMuseExecArgs({ prompt: 'Hi', workingDirectory: '/tmp/project', museBin: 'muse', options: { approvalMode: 'denyUnmatched' } });
    expect(spec.args).toEqual(['exec', '--json', '--workspace', '/tmp/project', '--approval-mode', 'never', '--disable-write', 'Hi']);
  });
});
