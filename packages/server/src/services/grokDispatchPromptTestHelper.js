import { expect } from 'vitest';
import { answerGrokQuestion } from '../agents/adapters/grokQuestionBridge.js';
import { answerGrokPlanApproval } from '../agents/adapters/grokPlanBridge.js';
import { cancelPrompt, getPrompt, respondToPrompt } from './promptStore.js';

/** Check the production bridges using the identity delivered at dispatch. */
export async function assertGrokDispatchPrompts(options) {
  const { sessionId, conversationId, abortController } = options;
  try {
    const question = answerGrokQuestion({ sessionId, conversationId, signal: abortController.signal,
      request: { questions: [{ question: 'Choose?', options: [{ label: 'Yes' }] }] } });
    const questionPrompt = getPrompt(sessionId);
    expect(questionPrompt).toMatchObject({ kind: 'question', conversationId });
    expect(respondToPrompt(sessionId, questionPrompt.id, { action: 'answer', answers: { 'Choose?': ['Yes'] } })).toBe(true);
    await expect(question).resolves.toMatchObject({ outcome: 'accepted' });
    const plan = answerGrokPlanApproval({ sessionId, conversationId, signal: abortController.signal,
      request: { toolCallId: 'plan', planContent: 'Plan' } });
    const planPrompt = getPrompt(sessionId);
    expect(planPrompt).toMatchObject({ kind: 'plan_approval', conversationId });
    expect(respondToPrompt(sessionId, planPrompt.id, { action: 'approve' })).toBe(true);
    await expect(plan).resolves.toEqual({ outcome: 'approved' });
  } finally {
    cancelPrompt(sessionId);
  }
}
