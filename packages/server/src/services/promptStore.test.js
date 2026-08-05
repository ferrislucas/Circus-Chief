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

    expect(respondToPrompt('question-answer', prompt.id, { action: 'answer', answers: { 'Which approach?': ['Ship it'] } })).toBe(true);
    await expect(promise).resolves.toMatchObject({ behavior: 'allow' });

    expect(createWorkLog).toHaveBeenCalledWith('question-answer', 'tool_output', 'User answered:\nWhich approach?: Ship it', 'AskUserQuestion');
    expect(createWorkLog.mock.invocationCallOrder[0]).toBeLessThan(broadcastToSession.mock.invocationCallOrder.at(-1));
  });

  it('records reconstructable, sanitized permission-decision history for every outcome', async () => {
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
    for (const index of [2, 3, 4]) {
      const [, , content, toolName] = createWorkLog.mock.calls[index - 1];
      expect(toolName).toBe('Bash');
      expect(content).toContain('Permission decision');
      expect(content).toContain('Tool: Bash');
      expect(content).toContain('Input: {"command":"yarn test"}');
    }
    expect(createWorkLog.mock.calls[1][2]).toContain('Outcome: allow once');
    expect(createWorkLog.mock.calls[2][2]).toContain('Outcome: always allow');
    expect(createWorkLog.mock.calls[2][2]).toContain('Scope: session');
    expect(createWorkLog.mock.calls[3][2]).toContain('Reason: Do not run tests now.');
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

    expect(createWorkLog).toHaveBeenCalledWith('replacement', 'tool_output', expect.stringContaining('Outcome: superseded'), 'Bash');
    expect(createWorkLog).toHaveBeenCalledWith('replacement', 'tool_output', expect.stringContaining('Reason: Stopped by user.'), 'Bash');
    expect(createWorkLog).toHaveBeenCalledWith('aborted', 'tool_output', expect.stringContaining('Reason: Session was cancelled.'), 'Bash');
  });

  it('redacts credentials while retaining permission context in history', async () => {
    const { promise, prompt } = park('redacted-history', 'permission', {
      toolName: 'Bash', title: 'Deploy', blockedPath: '/protected/.env', decisionReason: 'Needs approval',
      input: { command: 'deploy', api_key: 'very-secret', nested: { token: 'also-secret' } },
    });
    respondToPrompt('redacted-history', prompt.id, { action: 'deny' });
    await promise;
    const content = createWorkLog.mock.calls.at(-1)[2];
    expect(content).toContain('Title: Deploy');
    expect(content).toContain('Blocked path: /protected/.env');
    expect(content).toContain('Decision context: Needs approval');
    expect(content).toContain('Reason: Permission denied by user.');
    expect(content).toContain('[redacted]');
    expect(content).not.toContain('very-secret');
    expect(content).not.toContain('also-secret');
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

    expect(respondToPrompt('invalid-question', prompt.id, { action: 'answer', answers: { 'Environment?': ['Staging'] } })).toBeNull();
    expect(respondToPrompt('invalid-question', prompt.id, { action: 'answer', answers: { 'Environment?': ['Unknown'], 'Checks?': ['Unit'] } })).toBeNull();
    expect(getPrompt('invalid-question')?.id).toBe(prompt.id);

    expect(respondToPrompt('invalid-question', prompt.id, { action: 'answer', answers: { 'Environment?': ['Production'], 'Checks?': ['Unit', 'E2E'] } })).toBe(true);
    await expect(promise).resolves.toMatchObject({ behavior: 'allow' });
  });

  it('accepts a declared non-empty custom answer for a single-select question', async () => {
    const { promise, prompt } = park('single-other', 'question', {
      input: { questions: [{ question: 'Environment?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }] },
      questions: [{ question: 'Environment?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }],
    });

    expect(respondToPrompt('single-other', prompt.id, {
      action: 'answer', answers: { 'Environment?': [] }, customAnswers: { 'Environment?': 'Preview deployment' },
    })).toBe(true);
    await expect(promise).resolves.toMatchObject({
      behavior: 'allow', updatedInput: { answers: { 'Environment?': 'Preview deployment' } },
    });
  });

  it('passes a multi-select Other answer to the SDK unchanged', async () => {
    const { promise, prompt } = park('multi-other', 'question', {
      input: { questions: [{ question: 'Checks?', options: [{ label: 'Unit, fast' }, { label: 'E2E ✓' }], multiSelect: true }] },
      questions: [{ question: 'Checks?', options: [{ label: 'Unit, fast' }, { label: 'E2E ✓' }], multiSelect: true }],
    });

    expect(respondToPrompt('multi-other', prompt.id, {
      action: 'answer',
      answers: { 'Checks?': [] },
      customAnswers: { 'Checks?': 'Run smoke tests, then notify QA!' },
    })).toBe(true);
    await expect(promise).resolves.toMatchObject({
      behavior: 'allow', updatedInput: { answers: { 'Checks?': 'Run smoke tests, then notify QA!' } },
    });
  });

  it('joins ordinary multi-select choices in the existing SDK format', async () => {
    const { promise, prompt } = park('multi-options', 'question', {
      input: { questions: [{ question: 'Checks?', options: [{ label: 'Unit, fast' }, { label: 'E2E ✓' }], multiSelect: true }] },
      questions: [{ question: 'Checks?', options: [{ label: 'Unit, fast' }, { label: 'E2E ✓' }], multiSelect: true }],
    });

    expect(respondToPrompt('multi-options', prompt.id, {
      action: 'answer', answers: { 'Checks?': ['Unit, fast', 'E2E ✓'] },
    })).toBe(true);
    await expect(promise).resolves.toMatchObject({
      behavior: 'allow', updatedInput: { answers: { 'Checks?': 'Unit, fast, E2E ✓' } },
    });
  });

  it('rejects empty custom answers and unknown custom-answer keys without settling', async () => {
    const { promise, prompt } = park('invalid-other', 'question', {
      input: { questions: [{ question: 'Environment?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }] },
      questions: [{ question: 'Environment?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }],
    });

    expect(respondToPrompt('invalid-other', prompt.id, {
      action: 'answer', answers: { 'Environment?': [] }, customAnswers: { 'Environment?': '   ' },
    })).toBeNull();
    expect(respondToPrompt('invalid-other', prompt.id, {
      action: 'answer', answers: { 'Environment?': ['Staging'] }, customAnswers: { Unknown: 'Custom' },
    })).toBeNull();
    expect(getPrompt('invalid-other')?.id).toBe(prompt.id);
    cancelPrompt('invalid-other');
    await promise;
  });

  it('rejects contradictory selections and Other answers without settling', async () => {
    const { promise, prompt } = park('contradictory-other', 'question', {
      input: { questions: [{ question: 'Environment?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }] },
      questions: [{ question: 'Environment?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }],
    });
    expect(respondToPrompt('contradictory-other', prompt.id, {
      action: 'answer', answers: { 'Environment?': ['Staging'] }, customAnswers: { 'Environment?': 'Custom environment' },
    })).toBeNull();
    expect(getPrompt('contradictory-other')?.id).toBe(prompt.id);
    cancelPrompt('contradictory-other');
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
