import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../websocket.js', () => ({ broadcastToSession: vi.fn() }));
vi.mock('./workLogService.js', () => ({ createWorkLog: vi.fn() }));

import { broadcastToSession } from '../websocket.js';
import { createWorkLog } from './workLogService.js';
import {
  cancelPrompt,
  describePromptOutcome,
  getPrompt,
  parkPrompt,
  respondToPrompt,
} from './promptStore.js';

const questionPayload = {
  input: { questions: [{ question: 'Which approach?', options: [] }] },
  questions: [{ question: 'Which approach?', options: [] }],
};
const permissionPayload = { toolName: 'Bash', input: { command: 'yarn test' }, suggestions: [{ type: 'addRules', rules: [] }] };

function park(sessionId, kind, payload = kind === 'question' ? questionPayload : permissionPayload, signal) {
  const promise = parkPrompt({ sessionId, conversationId: 'conv-1', kind, payload, signal });
  return { promise, prompt: getPrompt(sessionId) };
}

describe('promptStore work-log emission', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs question answers before broadcasting resolution', async () => {
    const { promise, prompt } = park('question-answer', 'question');

    expect(respondToPrompt('question-answer', prompt.id, { action: 'answer', answers: { 'Which approach?': 'Ship it' } })).toBe(true);
    await expect(promise).resolves.toMatchObject({ behavior: 'allow' });

    expect(createWorkLog).toHaveBeenCalledWith('question-answer', 'tool_output', 'User answered:\nWhich approach?: Ship it', 'AskUserQuestion');
    expect(createWorkLog.mock.invocationCallOrder[0]).toBeLessThan(broadcastToSession.mock.invocationCallOrder.at(-1));
  });

  it('logs skipped questions and permission decisions with their originating tool', async () => {
    const skipped = park('question-skip', 'question');
    respondToPrompt('question-skip', skipped.prompt.id, { action: 'skip', reason: 'Use the default.' });
    await skipped.promise;

    const allowed = park('permission-allow', 'permission');
    respondToPrompt('permission-allow', allowed.prompt.id, { action: 'allow' });
    await allowed.promise;

    const always = park('permission-always', 'permission');
    respondToPrompt('permission-always', always.prompt.id, { action: 'always' });
    await always.promise;

    const denied = park('permission-deny', 'permission');
    respondToPrompt('permission-deny', denied.prompt.id, { action: 'deny', reason: 'Do not run tests now.' });
    await denied.promise;

    expect(createWorkLog).toHaveBeenNthCalledWith(1, 'question-skip', 'tool_output', 'User did not answer: Use the default.', 'AskUserQuestion');
    expect(createWorkLog).toHaveBeenNthCalledWith(2, 'permission-allow', 'tool_output', 'User allowed once Bash', 'Bash');
    expect(createWorkLog).toHaveBeenNthCalledWith(3, 'permission-always', 'tool_output', 'User always allowed Bash', 'Bash');
    expect(createWorkLog).toHaveBeenNthCalledWith(4, 'permission-deny', 'tool_output', 'User denied Bash: Do not run tests now.', 'Bash');
  });

  it('logs superseded and cancelled prompts once, including when cancellation comes from abort', async () => {
    const first = park('replacement', 'permission');
    const second = park('replacement', 'permission');
    await first.promise;
    cancelPrompt('replacement', 'Stopped by user.');
    await second.promise;

    const controller = new AbortController();
    const aborted = park('aborted', 'permission', permissionPayload, controller.signal);
    controller.abort();
    await aborted.promise;

    expect(createWorkLog).toHaveBeenCalledWith('replacement', 'tool_output', 'User superseded Bash: This interaction was superseded.', 'Bash');
    expect(createWorkLog).toHaveBeenCalledWith('replacement', 'tool_output', 'User cancelled Bash: Stopped by user.', 'Bash');
    expect(createWorkLog).toHaveBeenCalledWith('aborted', 'tool_output', 'User cancelled Bash: Session was cancelled.', 'Bash');
  });

  it('does not log a stale second response', async () => {
    const { promise, prompt } = park('idempotent', 'permission');
    expect(respondToPrompt('idempotent', prompt.id, { action: 'allow' })).toBe(true);
    expect(respondToPrompt('idempotent', prompt.id, { action: 'deny' })).toBe(false);
    await promise;

    expect(createWorkLog).toHaveBeenCalledTimes(1);
  });

  it('describes a cancelled question using its user-visible denial message', () => {
    expect(describePromptOutcome({ kind: 'question' }, 'cancelled', { message: 'Session was cancelled.' }))
      .toEqual({ toolName: 'AskUserQuestion', content: 'User did not answer: Session was cancelled.' });
  });
});
