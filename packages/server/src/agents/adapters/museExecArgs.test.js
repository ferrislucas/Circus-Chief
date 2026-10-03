import { describe, expect, it } from 'vitest';
import { buildMuseExecArgs } from './museExecArgs.js';

describe('buildMuseExecArgs', () => {
  it('uses documented long options and the explicit workspace', () => {
    const spec = buildMuseExecArgs({ prompt: 'Hi', workingDirectory: '/tmp/project', sessionId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', museBin: 'muse', options: { model: 'muse-1', approvalMode: 'allowAll' } });
    expect(spec.args).toEqual(['exec', '--json', '--workspace', '/tmp/project', '--session-id', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '--model', 'muse-1', '--yolo', 'Hi']);
  });
  it('rejects unsupported interactive approvals before spawn', () => {
    expect(() => buildMuseExecArgs({ prompt: 'Hi', workingDirectory: '/tmp/project', options: { approvalMode: 'ask' } })).toThrow(/interactive approvals/);
  });
});
