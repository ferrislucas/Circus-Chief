import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../websocket.js', () => ({ broadcastToSession: vi.fn(), broadcastToProject: vi.fn() }));
vi.mock('../../services/workLogService.js', () => ({ createWorkLog: vi.fn() }));

import { answerGrokQuestion, toGrokQuestionResult } from './grokQuestionBridge.js';
import { cancelPrompt, getPrompt, respondToPrompt } from '../../services/promptStore.js';

const questions = [
  { question: 'Which database?', options: [{ label: 'Postgres' }, { label: 'SQLite' }], multiSelect: false },
  { question: 'Which extras?', options: [{ label: 'Cache' }, { label: 'Logs' }], multiSelect: true },
];

describe('toGrokQuestionResult', () => {
  it('maps a cancelled or denied park to cancelled', () => {
    expect(toGrokQuestionResult(null, questions)).toEqual({ outcome: 'cancelled' });
    expect(toGrokQuestionResult({ behavior: 'deny' }, questions)).toEqual({ outcome: 'cancelled' });
  });

  it('maps selections and free text into the Grok answer shape', () => {
    const result = toGrokQuestionResult({
      behavior: 'allow',
      updatedInput: {
        answers: { 'Which database?': 'Postgres', 'Which extras?': 'Cache, Logs', Notes: 'something else' },
        annotations: { 'Which database?': { preview: 'pg' } },
      },
    }, [...questions, { question: 'Notes', options: [{ label: 'A' }] }]);
    expect(result.outcome).toBe('accepted');
    expect(result.answers['Which database?']).toEqual(['Postgres']);
    expect(result.answers['Which extras?']).toEqual(['Cache', 'Logs']);
    expect(result.answers.Notes).toEqual(['Other']);
    expect(result.annotations.Notes.notes).toBe('something else');
    expect(result.annotations['Which database?'].preview).toBe('pg');
  });
});

describe('answerGrokQuestion', () => {
  const sessionId = 'grok-question-card';
  const asked = [
    { question: 'Which database?', options: [{ label: 'Postgres' }, { label: 'SQLite' }] },
  ];

  beforeEach(() => {
    cancelPrompt(sessionId);
  });

  it('parks the existing question card and returns the chosen option', async () => {
    const pending = answerGrokQuestion({
      sessionId,
      conversationId: 'conv-1',
      request: { questions: asked, toolCallId: 'tool-1' },
    });
    const prompt = getPrompt(sessionId);
    expect(prompt).toMatchObject({
      kind: 'question',
      conversationId: 'conv-1',
      toolUseId: 'tool-1',
      payload: { questions: asked },
    });
    expect(respondToPrompt(sessionId, prompt.id, {
      action: 'answer',
      answers: { 'Which database?': ['Postgres'] },
    })).toBe(true);
    await expect(pending).resolves.toEqual({
      outcome: 'accepted',
      answers: { 'Which database?': ['Postgres'] },
    });
  });

  it('cancels when the card is dismissed, aborted, or never asked', async () => {
    const parked = answerGrokQuestion({ sessionId, request: { questions: asked } });
    cancelPrompt(sessionId);
    await expect(parked).resolves.toEqual({ outcome: 'cancelled' });

    const controller = new AbortController();
    const aborted = answerGrokQuestion({ sessionId, request: { questions: asked }, signal: controller.signal });
    expect(getPrompt(sessionId)?.kind).toBe('question');
    controller.abort();
    await expect(aborted).resolves.toEqual({ outcome: 'cancelled' });

    await expect(answerGrokQuestion({ sessionId, request: { questions: [] } })).resolves.toEqual({ outcome: 'cancelled' });
    await expect(answerGrokQuestion({ request: { questions: asked } })).resolves.toEqual({ outcome: 'cancelled' });
    expect(getPrompt(sessionId)).toBeNull();
  });
});
