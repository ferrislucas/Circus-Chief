import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../websocket.js', () => ({ broadcastToSession: vi.fn(), broadcastToProject: vi.fn() }));
vi.mock('./workLogService.js', () => ({ createWorkLog: vi.fn() }));

import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { createWorkLog } from './workLogService.js';
import { sessions } from '../database.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import {
  cancelPrompt,
  getPrompt,
  getPromptQueue,
  MAX_PROMPTS_PER_SESSION,
  parkPrompt,
  PROMPT_EXPIRY_MS,
  respondToPrompt,
} from './promptStore.js';

// Resolves once any already-scheduled microtasks (including promise
// settlement from code under test) have run, without racing against a timer.
// Used to assert a promise is still pending: since nothing in this file
// resolves it, if it hasn't settled by the time this sentinel wins the race,
// it never will until the test explicitly resolves it.
function assertStillPending(promise) {
  return Promise.race([promise.then(() => 'settled'), Promise.resolve('pending')]).then((outcome) => {
    expect(outcome).toBe('pending');
  });
}

const questionPayload = {
  input: { questions: [{ question: 'Which approach?', options: [] }] },
  questions: [{ question: 'Which approach?', options: [] }],
};
const permissionPayload = {
  toolName: 'Bash', input: { command: 'yarn test', description: 'Run the test suite' },
  suggestions: [{ type: 'addRules', rules: [] }],
};

function park(sessionId, kind, payload = kind === 'question' ? questionPayload : permissionPayload, signal) {
  const promise = parkPrompt({ sessionId, conversationId: 'conv-1', kind, payload, signal });
  // Use the tail of the queue, not `getPrompt` (which only ever returns the
  // head): when a prompt is parked behind an existing one, it is this
  // record, not the head, that this call just created.
  return { promise, prompt: getPromptQueue(sessionId).at(-1) };
}

describe('promptStore work-log emission', () => {
  beforeEach(() => vi.clearAllMocks());

  it('settles the live callback and promotes queued work when work-log persistence fails', async () => {
    const session = { id: 'work-log-failure', projectId: 'proj-1' };
    sessions.getById = vi.fn(() => session);
    createWorkLog.mockImplementationOnce(() => { throw new Error('database unavailable'); });
    const first = park('work-log-failure', 'permission');
    const second = park('work-log-failure', 'permission');

    expect(respondToPrompt('work-log-failure', first.prompt.id, { action: 'allow' })).toBe(true);

    await expect(first.promise).resolves.toMatchObject({ behavior: 'allow' });
    await assertStillPending(second.promise);
    expect(getPrompt('work-log-failure')?.id).toBe(second.prompt.id);
    expect(respondToPrompt('work-log-failure', first.prompt.id, { action: 'deny' })).toBe(false);
    expect(broadcastToSession).toHaveBeenCalledWith(
      'work-log-failure',
      WS_MESSAGE_TYPES.SESSION_PROMPT,
      expect.objectContaining({ prompt: expect.objectContaining({ id: second.prompt.id }) }),
    );

    expect(respondToPrompt('work-log-failure', second.prompt.id, { action: 'allow' })).toBe(true);
    await expect(second.promise).resolves.toMatchObject({ behavior: 'allow' });
  });

  it('logs question answers before broadcasting resolution', async () => {
    const { promise, prompt } = park('question-answer', 'question');

    expect(respondToPrompt('question-answer', prompt.id, { action: 'answer', answers: { 'Which approach?': ['Ship it'] } })).toBe(true);
    await expect(promise).resolves.toMatchObject({ behavior: 'allow' });

    expect(createWorkLog).toHaveBeenCalledWith('question-answer', 'tool_output', 'User answered:\nWhich approach?: Ship it', 'AskUserQuestion');
    expect(createWorkLog.mock.invocationCallOrder[0]).toBeLessThan(broadcastToSession.mock.invocationCallOrder.at(-1));
  });

  it('fails closed instead of parking an empty question set that cannot be answered', async () => {
    const promise = parkPrompt({
      sessionId: 'empty-questions', conversationId: 'conv-1', kind: 'question',
      payload: { input: { questions: [] }, questions: [] },
    });

    await expect(promise).resolves.toEqual({ behavior: 'deny', message: 'Please re-ask with at least one question.' });
    expect(getPrompt('empty-questions')).toBeNull();
  });

  it('rejects cancel as an invalid permission action instead of treating it as a denial alias', () => {
    const { prompt } = park('permission-cancel', 'permission');
    expect(respondToPrompt('permission-cancel', prompt.id, { action: 'cancel' })).toBeNull();
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
      // Only the allowlisted, tool-specific safe summary is persisted — never
      // the raw command a user is being asked to approve.
      expect(content).not.toContain('Input summary');
      expect(content).not.toContain('yarn test');
    }
    expect(createWorkLog.mock.calls[1][2]).toContain('Outcome: allow once');
    expect(createWorkLog.mock.calls[2][2]).toContain('Outcome: always allow');
    expect(createWorkLog.mock.calls[2][2]).toContain('Scope: session');
    expect(createWorkLog.mock.calls[3][2]).toContain('Reason: Do not run tests now.');
  });

  it('cancels every queued prompt for a session, each logging its own cancellation once', async () => {
    const first = park('replacement', 'permission');
    const second = park('replacement', 'permission');
    cancelPrompt('replacement', 'Stopped by user.');
    await first.promise;
    await second.promise;

    const controller = new AbortController();
    const aborted = park('aborted', 'permission', permissionPayload, controller.signal);
    controller.abort();
    await aborted.promise;

    const replacementCalls = createWorkLog.mock.calls.filter(([sessionId]) => sessionId === 'replacement');
    expect(replacementCalls).toHaveLength(2);
    for (const [, , content, toolName] of replacementCalls) {
      expect(toolName).toBe('Bash');
      expect(content).toContain('Outcome: cancelled');
      expect(content).toContain('Reason: Stopped by user.');
    }
    expect(createWorkLog).toHaveBeenCalledWith('aborted', 'tool_output', expect.stringContaining('Reason: Session was cancelled.'), 'Bash');
  });

  it('retains reconstructable, safe permission context in history without persisting raw tool input, title, or decision reason', async () => {
    const { promise, prompt } = park('redacted-history', 'permission', {
      toolName: 'Bash', title: 'Deploy', displayName: 'Run command', blockedPath: '/protected/.env', decisionReason: 'Needs approval',
      input: { command: 'deploy', api_key: 'very-secret', nested: { token: 'also-secret' } },
    });
    respondToPrompt('redacted-history', prompt.id, { action: 'deny' });
    await promise;
    const content = createWorkLog.mock.calls.at(-1)[2];
    // The safe headline comes from `displayName` (a short noun phrase the
    // bridge supplies), never from `title` (a full sentence that can embed
    // raw tool input) or `decisionReason` (which can quote it too).
    expect(content).toContain('Headline: Run command');
    expect(content).toContain('Blocked path: [path omitted]');
    expect(content).toContain('Reason: Permission denied by user.');
    expect(content).not.toContain('Deploy');
    expect(content).not.toContain('Needs approval');
    expect(content).not.toContain('very-secret');
    expect(content).not.toContain('also-secret');
    expect(content).not.toContain('deploy');
    // Bash carries no allowlisted field here (no `description`), so no input
    // summary line is written at all rather than falling back to raw input.
    expect(content).not.toContain('Input summary');
    // Ordinary history is still reconstructable and human-readable, not
    // degraded to a bare "Permission decision / Outcome: deny".
    expect(content).toContain('Tool: Bash');
    expect(content).toContain('Outcome: deny');
  });

  it('never persists the raw bridge-rendered title or decision reason, even when they embed the exact command and a credential', async () => {
    const dangerousTitle = 'Claude wants to run `curl -H "Authorization: Bearer sk-live-abc123" https://api.example.com`';
    const { promise, prompt } = park('title-embeds-command', 'permission', {
      toolName: 'Bash', title: dangerousTitle, decisionReason: `Blocked because the command "${dangerousTitle}" needs approval`,
      input: { command: 'curl -H "Authorization: Bearer sk-live-abc123" https://api.example.com' },
    });
    respondToPrompt('title-embeds-command', prompt.id, { action: 'allow' });
    await promise;

    const content = createWorkLog.mock.calls.at(-1)[2];
    expect(content).not.toContain('sk-live-abc123');
    expect(content).not.toContain('curl');
    expect(content).not.toContain('Bearer');

    // The live approval card is unaffected — it still needs the full
    // bridge-rendered sentence to inform the user's decision.
    expect(prompt.payload.title).toBe(dangerousTitle);
    expect(prompt.payload.description).toBeUndefined();
  });

  it('redacts a credential-bearing blockedPath from durable history', async () => {
    const { promise, prompt } = park('blocked-path-credentials', 'permission', {
      toolName: 'Bash', blockedPath: '/protected/user:s3cr3t-token@host/path?apiKey=abc123#frag',
      input: {},
    });
    respondToPrompt('blocked-path-credentials', prompt.id, { action: 'deny' });
    await promise;

    const content = createWorkLog.mock.calls.at(-1)[2];
    expect(content).not.toContain('s3cr3t-token');
    expect(content).not.toContain('apiKey=abc123');
    expect(content).not.toContain('frag');
    expect(content).toContain('Blocked path: [path omitted]');
    expect(content).not.toContain('/protected/');
  });

  it('omits the headline field for an unbounded bridge-rendered displayName rather than truncating it', async () => {
    const overlong = `Run command ${'x'.repeat(500)} rm -rf / --no-preserve-root`;
    const { promise, prompt } = park('unbounded-displayname', 'permission', {
      toolName: 'Bash', displayName: overlong, input: {},
    });
    respondToPrompt('unbounded-displayname', prompt.id, { action: 'allow' });
    await promise;

    const content = createWorkLog.mock.calls.at(-1)[2];
    // A truncated secret is still a secret: unknown/unsafe content must be
    // omitted outright, never kept in a shortened form.
    expect(content).not.toContain('rm -rf');
    expect(content).not.toContain(overlong.slice(0, 40));
    // Still reconstructable via the fallback headline.
    expect(content).toContain('Headline: Bash permission request');
  });

  it('carries the untouched title, displayName, description, and decisionReason on the live prompt payload for the approval card', async () => {
    const { promise, prompt } = park('live-payload-untouched', 'permission', {
      toolName: 'Bash', title: 'Claude wants to run `rm important.txt`', displayName: 'Run command',
      description: 'Claude will delete a file', decisionReason: 'Destructive command needs approval',
      input: { command: 'rm important.txt' },
    });
    expect(prompt.payload.title).toBe('Claude wants to run `rm important.txt`');
    expect(prompt.payload.displayName).toBe('Run command');
    expect(prompt.payload.description).toBe('Claude will delete a file');
    expect(prompt.payload.decisionReason).toBe('Destructive command needs approval');
    respondToPrompt('live-payload-untouched', prompt.id, { action: 'allow' });
    await promise;
  });

  it('never persists raw Bash.command, Write.content, or Edit.new_string, even though they are exactly what the approval card must show live', async () => {
    const bash = park('sensitive-bash', 'permission', { toolName: 'Bash', input: { command: 'curl -H "Authorization: Bearer sk-live-abc123" https://api.example.com' } });
    respondToPrompt('sensitive-bash', bash.prompt.id, { action: 'deny' });
    await bash.promise;

    const write = park('sensitive-write', 'permission', { toolName: 'Write', input: { file_path: 'secrets.env', content: 'API_KEY=sk-live-abc123' } });
    respondToPrompt('sensitive-write', write.prompt.id, { action: 'allow' });
    await write.promise;

    const edit = park('sensitive-edit', 'permission', { toolName: 'Edit', input: { file_path: 'config.js', old_string: 'token = "old"', new_string: 'token = "sk-live-abc123"' } });
    respondToPrompt('sensitive-edit', edit.prompt.id, { action: 'allow' });
    await edit.promise;

    // Live approval-card data (the transient, pre-resolution payload) must
    // still carry the full raw input — only durable history is restricted.
    expect(bash.prompt.payload.input.command).toContain('Bearer sk-live-abc123');

    const bashContent = createWorkLog.mock.calls[0][2];
    const writeContent = createWorkLog.mock.calls[1][2];
    const editContent = createWorkLog.mock.calls[2][2];
    for (const content of [bashContent, writeContent, editContent]) {
      expect(content).not.toContain('sk-live-abc123');
      expect(content).not.toContain('curl');
      expect(content).not.toContain('API_KEY');
      expect(content).not.toContain('token = ');
    }
    expect(writeContent).toContain('Input summary: {"file_path":"[path omitted]"}');
    expect(editContent).toContain('Input summary: {"file_path":"[path omitted]"}');
  });

  it('never persists a secret stashed under an innocuous, non-allowlisted key — proving key-name-only redaction is not a valid boundary', async () => {
    const { promise, prompt } = park('innocuous-key', 'permission', {
      toolName: 'Bash', input: { command: 'ls', notes: 'sk-live-secret-under-a-safe-looking-key' },
    });
    respondToPrompt('innocuous-key', prompt.id, { action: 'allow' });
    await promise;
    const content = createWorkLog.mock.calls.at(-1)[2];
    expect(content).not.toContain('sk-live-secret-under-a-safe-looking-key');
    expect(content).not.toContain('ls');
  });

  it('omits input entirely for unrecognized tools rather than persisting arbitrary scalar input', async () => {
    const { promise, prompt } = park('unknown-tool', 'permission', {
      toolName: 'CustomMcpTool', input: { value: 'private-key-material-BEGIN', anything: 'goes here' },
    });
    respondToPrompt('unknown-tool', prompt.id, { action: 'allow' });
    await promise;
    const content = createWorkLog.mock.calls.at(-1)[2];
    expect(content).not.toContain('private-key-material-BEGIN');
    expect(content).not.toContain('Input summary');
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

  it('preserves a declared custom answer for a single-select question', async () => {
    const { promise, prompt } = park('single-other', 'question', {
      input: { questions: [{ question: 'Environment?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }] },
      questions: [{ question: 'Environment?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }],
    });

    expect(respondToPrompt('single-other', prompt.id, {
      action: 'answer', answers: { 'Environment?': [] }, customAnswers: { 'Environment?': '  Preview deployment  ' },
    })).toBe(true);
    await expect(promise).resolves.toMatchObject({
      behavior: 'allow', updatedInput: { answers: { 'Environment?': '  Preview deployment  ' } },
    });
  });

  it('preserves a custom answer for a multi-select question', async () => {
    const { promise, prompt } = park('multi-other', 'question', {
      input: { questions: [{ question: 'Checks?', options: [{ label: 'Unit, fast' }, { label: 'E2E ✓' }], multiSelect: true }] },
      questions: [{ question: 'Checks?', options: [{ label: 'Unit, fast' }, { label: 'E2E ✓' }], multiSelect: true }],
    });

    expect(respondToPrompt('multi-other', prompt.id, {
      action: 'answer',
      answers: { 'Checks?': [] },
      customAnswers: { 'Checks?': '  Run smoke tests, then notify QA!  ' },
    })).toBe(true);
    await expect(promise).resolves.toMatchObject({
      behavior: 'allow', updatedInput: { answers: { 'Checks?': '  Run smoke tests, then notify QA!  ' } },
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

  it('rejects annotations for questions that were not asked', async () => {
    const { promise, prompt } = park('invalid-annotation', 'question');
    expect(respondToPrompt('invalid-annotation', prompt.id, {
      action: 'answer', answers: { 'Which approach?': ['Ship it'] },
      annotations: { Unknown: { notes: 'Not an asked question' } },
    })).toBeNull();
    expect(getPrompt('invalid-annotation')?.id).toBe(prompt.id);
    cancelPrompt('invalid-annotation');
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

  it('rejects duplicate-question-text without disturbing an existing parked prompt', async () => {
    const existing = park('duplicate-question', 'permission');

    const duplicate = parkPrompt({
      sessionId: 'duplicate-question', conversationId: 'conv-1', kind: 'question',
      payload: { questions: [{ question: 'Same' }, { question: 'Same' }], input: {} },
    });

    await expect(duplicate).resolves.toMatchObject({ behavior: 'deny', message: 'Please re-ask using distinct question text.' });
    // The rejected duplicate never touches the queue: the existing prompt is
    // still parked and still the head, not superseded.
    expect(getPrompt('duplicate-question')?.id).toBe(existing.prompt.id);
    cancelPrompt('duplicate-question');
    await existing.promise;
  });

  it('immediately denies an already-aborted prompt without replacing a live prompt', async () => {
    const controller = new AbortController();
    controller.abort();
    const denied = parkPrompt({
      sessionId: 'already-aborted', conversationId: 'conv-1', kind: 'permission',
      payload: permissionPayload, signal: controller.signal,
    });

    await expect(denied).resolves.toEqual({ behavior: 'deny', message: 'Session was cancelled.' });
    expect(getPrompt('already-aborted')).toBeNull();
    expect(broadcastToSession).not.toHaveBeenCalled();

    const live = park('already-aborted-live', 'permission');
    const rejected = parkPrompt({
      sessionId: 'already-aborted-live', conversationId: 'conv-1', kind: 'permission',
      payload: permissionPayload, signal: controller.signal,
    });
    await expect(rejected).resolves.toEqual({ behavior: 'deny', message: 'Session was cancelled.' });
    expect(getPrompt('already-aborted-live')?.id).toBe(live.prompt.id);
    cancelPrompt('already-aborted-live');
    await live.promise;
  });

  it('explains when always allow is unavailable for a permission prompt', async () => {
    const { promise, prompt } = park('no-suggestions', 'permission', { toolName: 'Bash', input: {} });

    respondToPrompt('no-suggestions', prompt.id, { action: 'always_allow' });

    await expect(promise).resolves.toMatchObject({
      behavior: 'deny', message: 'Always allow is unavailable for this permission request.',
    });
  });

  it.each(['session', 'projectSettings'])('passes every SDK suggestion through unchanged with the %s destination', async (destination) => {
    const suggestions = [
      { type: 'addRules', rules: [{ toolName: 'Bash', rule: 'Bash(git status)' }] },
      { type: 'replaceRules', rules: [{ toolName: 'Write', rule: 'Write(src/**)' }] },
    ];
    const { promise, prompt } = park(`always-${destination}`, 'permission', {
      toolName: 'Bash', input: { command: 'git status' }, suggestions,
    });

    expect(respondToPrompt(`always-${destination}`, prompt.id, { action: 'always_allow', destination })).toBe(true);
    await expect(promise).resolves.toEqual({
      behavior: 'allow',
      updatedPermissions: suggestions.map((suggestion) => ({ ...suggestion, destination })),
    });
  });
});

describe('promptStore concurrent prompt queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessions.getById = vi.fn(() => null);
  });

  it('parks a second concurrent prompt for the same session instead of auto-denying the first', async () => {
    const first = park('concurrent', 'permission');
    const second = park('concurrent', 'permission');

    await assertStillPending(first.promise);
    await assertStillPending(second.promise);
    expect(createWorkLog).not.toHaveBeenCalled();
    // FIFO: the user answers in arrival order.
    expect(getPrompt('concurrent')?.id).toBe(first.prompt.id);
  });

  it('resolves the first prompt and promotes the second to head without settling it', async () => {
    const first = park('concurrent-handoff', 'permission');
    const second = park('concurrent-handoff', 'permission');

    expect(respondToPrompt('concurrent-handoff', first.prompt.id, { action: 'allow' })).toBe(true);
    await expect(first.promise).resolves.toMatchObject({ behavior: 'allow' });
    await assertStillPending(second.promise);
    expect(getPrompt('concurrent-handoff')?.id).toBe(second.prompt.id);

    expect(respondToPrompt('concurrent-handoff', second.prompt.id, { action: 'allow' })).toBe(true);
    await expect(second.promise).resolves.toMatchObject({ behavior: 'allow' });
    expect(getPrompt('concurrent-handoff')).toBeNull();
  });

  it('broadcasts SESSION_PROMPT for the newly-surfaced head when the previous head resolves', async () => {
    const first = park('concurrent-broadcast', 'permission');
    const second = park('concurrent-broadcast', 'permission');
    broadcastToSession.mockClear();

    respondToPrompt('concurrent-broadcast', first.prompt.id, { action: 'allow' });
    await first.promise;

    expect(broadcastToSession).toHaveBeenCalledWith(
      'concurrent-broadcast',
      WS_MESSAGE_TYPES.SESSION_PROMPT,
      expect.objectContaining({ sessionId: 'concurrent-broadcast', prompt: expect.objectContaining({ id: second.prompt.id }) }),
    );
    cancelPrompt('concurrent-broadcast');
    await second.promise;
  });

  it('keeps pendingAgentInput true across the handoff and clears it only once the queue drains', async () => {
    const session = { id: 'concurrent-pending', projectId: 'proj-1' };
    sessions.getById = vi.fn(() => session);

    const first = park('concurrent-pending', 'permission');
    const second = park('concurrent-pending', 'permission');

    respondToPrompt('concurrent-pending', first.prompt.id, { action: 'allow' });
    await first.promise;

    // Resolving the first (with a sibling still queued) must not have
    // broadcast pendingAgentInput: false.
    expect(broadcastToSession).not.toHaveBeenCalledWith(
      'concurrent-pending', expect.anything(),
      expect.objectContaining({ session: expect.objectContaining({ pendingAgentInput: false }) }),
    );

    respondToPrompt('concurrent-pending', second.prompt.id, { action: 'allow' });
    await second.promise;

    expect(broadcastToProject).toHaveBeenCalledWith(
      'proj-1', expect.anything(),
      expect.objectContaining({ session: expect.objectContaining({ pendingAgentInput: false }) }),
    );
  });

  it('cancels every queued prompt when the session is stopped, each writing exactly one work-log entry', async () => {
    const first = park('drain-all', 'permission');
    const second = park('drain-all', 'permission');
    const third = park('drain-all', 'permission');

    expect(cancelPrompt('drain-all', 'Session stopped.')).toBe(true);

    await expect(first.promise).resolves.toMatchObject({ behavior: 'deny', message: 'Session stopped.' });
    await expect(second.promise).resolves.toMatchObject({ behavior: 'deny', message: 'Session stopped.' });
    await expect(third.promise).resolves.toMatchObject({ behavior: 'deny', message: 'Session stopped.' });

    const calls = createWorkLog.mock.calls.filter(([sessionId]) => sessionId === 'drain-all');
    expect(calls).toHaveLength(3);
    expect(getPrompt('drain-all')).toBeNull();
  });

  it('cancels only the aborted prompt and leaves a sibling queued and answerable', async () => {
    const controller = new AbortController();
    const first = park('per-prompt-abort', 'permission', permissionPayload, controller.signal);
    const second = park('per-prompt-abort', 'permission');

    controller.abort();
    await expect(first.promise).resolves.toMatchObject({ behavior: 'deny', message: 'Session was cancelled.' });
    await assertStillPending(second.promise);
    expect(getPrompt('per-prompt-abort')?.id).toBe(second.prompt.id);

    expect(respondToPrompt('per-prompt-abort', second.prompt.id, { action: 'allow' })).toBe(true);
    await expect(second.promise).resolves.toMatchObject({ behavior: 'allow' });
  });

  it('rejects a response for a queued-but-not-head promptId as not-current, without settling it', async () => {
    const first = park('not-current', 'permission');
    const second = park('not-current', 'permission');

    expect(respondToPrompt('not-current', second.prompt.id, { action: 'allow' })).toBe(false);
    await assertStillPending(second.promise);
    expect(getPrompt('not-current')?.id).toBe(first.prompt.id);

    cancelPrompt('not-current');
    await first.promise;
    await second.promise;
  });
});

describe('promptStore bounded lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows 24 hours for user input by default', () => {
    expect(PROMPT_EXPIRY_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('expires an unanswered head exactly once and promotes the next prompt', async () => {
    const firstPromise = parkPrompt({ sessionId: 'expiry-handoff', conversationId: 'conv-1', kind: 'permission', payload: permissionPayload, expiryMs: 1 });
    const first = { promise: firstPromise, prompt: getPrompt('expiry-handoff') };
    const secondPromise = parkPrompt({ sessionId: 'expiry-handoff', conversationId: 'conv-1', kind: 'permission', payload: permissionPayload, expiryMs: 30 });
    const second = { promise: secondPromise, prompt: getPromptQueue('expiry-handoff').at(-1) };

    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(first.promise).resolves.toEqual({ behavior: 'deny', message: 'This approval request expired. Please continue without it.' });
    expect(getPrompt('expiry-handoff')?.id).toBe(second.prompt.id);
    expect(createWorkLog).toHaveBeenCalledTimes(1);

    expect(respondToPrompt('expiry-handoff', second.prompt.id, { action: 'allow' })).toBe(true);
    await expect(second.promise).resolves.toEqual({ behavior: 'allow' });
  });

  it('expires queued prompts before they can be promoted', async () => {
    const first = parkPrompt({ sessionId: 'queued-expiry', conversationId: 'conv-1', kind: 'permission', payload: permissionPayload, expiryMs: 1 });
    const second = parkPrompt({ sessionId: 'queued-expiry', conversationId: 'conv-1', kind: 'permission', payload: permissionPayload, expiryMs: 1 });

    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(first).resolves.toMatchObject({ behavior: 'deny' });
    await expect(second).resolves.toMatchObject({ behavior: 'deny' });
    expect(getPrompt('queued-expiry')).toBeNull();
  });

  it('rejects excess prompts without retaining them or attaching listeners', async () => {
    const parked = Array.from({ length: MAX_PROMPTS_PER_SESSION }, () => park('capacity', 'permission'));
    const controller = new AbortController();
    const rejected = parkPrompt({ sessionId: 'capacity', conversationId: 'conv-1', kind: 'permission', payload: permissionPayload, signal: controller.signal });

    await expect(rejected).resolves.toEqual({ behavior: 'deny', message: 'Too many approval requests are pending. Please continue without this action.' });
    expect(getPromptQueue('capacity')).toHaveLength(MAX_PROMPTS_PER_SESSION);
    controller.abort();
    expect(getPromptQueue('capacity')).toHaveLength(MAX_PROMPTS_PER_SESSION);
    cancelPrompt('capacity');
    await Promise.all(parked.map(({ promise }) => promise));
  });
});
