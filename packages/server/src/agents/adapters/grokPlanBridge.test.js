import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../websocket.js', () => ({ broadcastToSession: vi.fn(), broadcastToProject: vi.fn() }));
vi.mock('../../services/workLogService.js', () => ({ createWorkLog: vi.fn() }));

import { answerGrokPlanApproval, toGrokPlanResult } from './grokPlanBridge.js';
import { cancelPrompt, getPrompt, respondToPrompt } from '../../services/promptStore.js';

const planRequest = {
  sessionId: 'grok-plan-card',
  toolCallId: 'call-1',
  planContent: '# Probe plan\n\n- step one\n',
};

describe('toGrokPlanResult', () => {
  it('maps a cancelled, expired, or missing park to the fail-safe abandoned outcome', () => {
    expect(toGrokPlanResult(null)).toEqual({ outcome: 'abandoned' });
    expect(toGrokPlanResult({ behavior: 'deny' })).toEqual({ outcome: 'abandoned' });
    expect(toGrokPlanResult({ behavior: 'deny', message: 'Session was cancelled.' })).toEqual({ outcome: 'abandoned' });
  });

  it('maps each decision to Grok exit_plan_mode outcomes', () => {
    expect(toGrokPlanResult({ behavior: 'allow', updatedInput: { decision: 'approve' } }))
      .toEqual({ outcome: 'approved' });
    expect(toGrokPlanResult({ behavior: 'allow', updatedInput: { decision: 'abandon' } }))
      .toEqual({ outcome: 'abandoned' });
    expect(toGrokPlanResult({ behavior: 'allow', updatedInput: { decision: 'request_changes', feedback: '  Add tests.  ' } }))
      .toEqual({ outcome: 'request_changes', feedback: 'Add tests.' });
  });

  it('omits the feedback field when request_changes arrives without usable notes', () => {
    expect(toGrokPlanResult({ behavior: 'allow', updatedInput: { decision: 'request_changes' } }))
      .toEqual({ outcome: 'request_changes' });
    expect(toGrokPlanResult({ behavior: 'allow', updatedInput: { decision: 'request_changes', feedback: '   ' } }))
      .toEqual({ outcome: 'request_changes' });
  });
});

describe('answerGrokPlanApproval', () => {
  const sessionId = 'grok-plan-card';

  beforeEach(() => {
    cancelPrompt(sessionId);
  });

  it('parks a plan_approval card and returns the approved outcome', async () => {
    const pending = answerGrokPlanApproval({
      sessionId,
      conversationId: 'conv-1',
      request: planRequest,
    });
    const prompt = getPrompt(sessionId);
    expect(prompt).toMatchObject({
      kind: 'plan_approval',
      conversationId: 'conv-1',
      toolUseId: 'call-1',
      payload: { planContent: planRequest.planContent },
    });
    expect(respondToPrompt(sessionId, prompt.id, { action: 'approve' })).toBe(true);
    await expect(pending).resolves.toEqual({ outcome: 'approved' });
  });

  it('returns the requested revision notes to Grok', async () => {
    const pending = answerGrokPlanApproval({ sessionId, request: planRequest });
    const prompt = getPrompt(sessionId);
    expect(respondToPrompt(sessionId, prompt.id, { action: 'request_changes', feedback: 'Cover the failure path.' })).toBe(true);
    await expect(pending).resolves.toEqual({ outcome: 'request_changes', feedback: 'Cover the failure path.' });
  });

  it('maps abandonment to the Grok abandoned outcome', async () => {
    const pending = answerGrokPlanApproval({ sessionId, request: planRequest });
    const prompt = getPrompt(sessionId);
    expect(respondToPrompt(sessionId, prompt.id, { action: 'abandon' })).toBe(true);
    await expect(pending).resolves.toEqual({ outcome: 'abandoned' });
  });

  it('replies abandoned — not cancelled — when the card is dismissed', async () => {
    const pending = answerGrokPlanApproval({ sessionId, request: planRequest });
    cancelPrompt(sessionId);
    await expect(pending).resolves.toEqual({ outcome: 'abandoned' });
  });

  it('replies abandoned without parking when no session is available', async () => {
    await expect(answerGrokPlanApproval({ request: planRequest })).resolves.toEqual({ outcome: 'abandoned' });
    expect(getPrompt(sessionId)).toBeNull();
  });

  it('parks an empty plan body so the card can show the no-plan state', async () => {
    const pending = answerGrokPlanApproval({ sessionId, request: { toolCallId: 'call-2', planContent: '' } });
    const prompt = getPrompt(sessionId);
    expect(prompt?.payload).toEqual({ planContent: '' });
    expect(respondToPrompt(sessionId, prompt.id, { action: 'approve' })).toBe(true);
    await expect(pending).resolves.toEqual({ outcome: 'approved' });
  });
});
