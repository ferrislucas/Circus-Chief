import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../websocket.js', () => ({ broadcastToSession: vi.fn() }));
vi.mock('./workLogService.js', () => ({ createWorkLog: vi.fn() }));

import { broadcastToSession } from '../websocket.js';
import { createWorkLog } from './workLogService.js';
import {
  cancelPrompt,
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
    respondToPrompt('question-skip', skipped.prompt.id, { action: 'cancel', reason: 'Use the default.' });
    await skipped.promise;

    const allowed = park('permission-allow', 'permission');
    respondToPrompt('permission-allow', allowed.prompt.id, { action: 'allow' });
    await allowed.promise;

    const always = park('permission-always', 'permission');
    respondToPrompt('permission-always', always.prompt.id, { action: 'always_allow' });
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

  it('rejects actions that do not belong to the parked prompt kind without settling it', async () => {
    const question = park('kind-mismatch', 'question');
    expect(respondToPrompt('kind-mismatch', question.prompt.id, { action: 'allow' })).toBeNull();
    expect(getPrompt('kind-mismatch')?.id).toBe(question.prompt.id);
    expect(createWorkLog).not.toHaveBeenCalled();
    cancelPrompt('kind-mismatch');
    await question.promise;
  });

  it('keeps question prompts parked when answers are incomplete or do not match their questions', async () => {
    const { promise, prompt } = park('invalid-question', 'question', {
      input: { questions: [
        { question: 'Environment?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false },
        { question: 'Checks?', options: [{ label: 'Unit' }, { label: 'E2E' }], multiSelect: true },
      ] },
      questions: [
        { question: 'Environment?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false },
        { question: 'Checks?', options: [{ label: 'Unit' }, { label: 'E2E' }], multiSelect: true },
      ],
    });

    expect(respondToPrompt('invalid-question', prompt.id, { action: 'answer', answers: { 'Environment?': 'Staging' } })).toBeNull();
    expect(respondToPrompt('invalid-question', prompt.id, { action: 'answer', answers: { 'Environment?': 'Unknown', 'Checks?': 'Unit' } })).toBeNull();
    expect(getPrompt('invalid-question')?.id).toBe(prompt.id);

    expect(respondToPrompt('invalid-question', prompt.id, { action: 'answer', answers: { 'Environment?': 'Production', 'Checks?': 'Unit, E2E' } })).toBe(true);
    await expect(promise).resolves.toMatchObject({ behavior: 'allow' });
  });

  it('accepts a declared non-empty custom answer for a single-select question', async () => {
    const { promise, prompt } = park('single-other', 'question', {
      input: { questions: [{ question: 'Environment?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }] },
      questions: [{ question: 'Environment?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }],
    });

    expect(respondToPrompt('single-other', prompt.id, {
      action: 'answer', answers: { 'Environment?': '' }, customAnswers: { 'Environment?': 'Preview deployment' },
    })).toBe(true);
    await expect(promise).resolves.toMatchObject({
      behavior: 'allow', updatedInput: { answers: { 'Environment?': 'Preview deployment' } },
    });
  });

  it('preserves commas in declared custom multi-select answers while validating selections', async () => {
    const { promise, prompt } = park('multi-other', 'question', {
      input: { questions: [{ question: 'Checks?', options: [{ label: 'Unit' }, { label: 'E2E' }], multiSelect: true }] },
      questions: [{ question: 'Checks?', options: [{ label: 'Unit' }, { label: 'E2E' }], multiSelect: true }],
    });

    expect(respondToPrompt('multi-other', prompt.id, {
      action: 'answer', answers: { 'Checks?': 'Unit' }, customAnswers: { 'Checks?': 'Accessibility, performance' },
    })).toBe(true);
    await expect(promise).resolves.toMatchObject({
      behavior: 'allow', updatedInput: { answers: { 'Checks?': 'Unit, Accessibility, performance' } },
    });
  });

  it('rejects empty custom answers and unknown custom-answer keys without settling', async () => {
    const { promise, prompt } = park('invalid-other', 'question', {
      input: { questions: [{ question: 'Environment?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }] },
      questions: [{ question: 'Environment?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }],
    });

    expect(respondToPrompt('invalid-other', prompt.id, {
      action: 'answer', answers: { 'Environment?': '' }, customAnswers: { 'Environment?': '   ' },
    })).toBeNull();
    expect(respondToPrompt('invalid-other', prompt.id, {
      action: 'answer', answers: { 'Environment?': 'Staging' }, customAnswers: { Unknown: 'Custom' },
    })).toBeNull();
    expect(getPrompt('invalid-other')?.id).toBe(prompt.id);
    cancelPrompt('invalid-other');
    await promise;
  });

  it('logs the user-visible cancellation wording for question prompts', async () => {
    const cancelled = park('question-cancelled', 'question');
    cancelPrompt('question-cancelled');
    await cancelled.promise;

    expect(createWorkLog).toHaveBeenCalledWith(
      'question-cancelled', 'tool_output', 'User did not answer: Session was cancelled.', 'AskUserQuestion'
    );
  });

  it('supersedes an existing prompt before rejecting duplicate question text', async () => {
    const existing = park('duplicate-question', 'permission');

    const duplicate = parkPrompt({
      sessionId: 'duplicate-question', conversationId: 'conv-1', kind: 'question',
      payload: { questions: [{ question: 'Same' }, { question: 'Same' }], input: {} },
    });

    await expect(existing.promise).resolves.toMatchObject({ behavior: 'deny', message: 'This interaction was superseded.' });
    await expect(duplicate).resolves.toMatchObject({ behavior: 'deny', message: 'Please re-ask using distinct question text.' });
    expect(getPrompt('duplicate-question')).toBeNull();
  });

  it('explains when always allow is unavailable for a permission prompt', async () => {
    const { promise, prompt } = park('no-suggestions', 'permission', { toolName: 'Bash', input: {} });

    respondToPrompt('no-suggestions', prompt.id, { action: 'always_allow' });

    await expect(promise).resolves.toMatchObject({
      behavior: 'deny', message: 'Always allow is unavailable for this permission request.',
    });
  });
});
