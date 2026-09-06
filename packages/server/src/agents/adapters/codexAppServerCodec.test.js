import { describe, expect, it } from 'vitest';
import { encodeUserInputResponse, normalizeUserInputRequest } from './codexAppServerCodec.js';

function request(questions) {
  return {
    id: 'provider-request-7',
    method: 'item/tool/requestUserInput',
    params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', questions },
  };
}

describe('Codex App Server user-input codec', () => {
  it('round-trips selected option ids to exact native values', () => {
    const normalized = normalizeUserInputRequest(request([
      { id: 'database', question: 'Database?', options: [
        { label: 'PostgreSQL', description: 'Relational' },
        { label: 'SQLite', description: 'Embedded' },
      ] },
      { id: 'features', question: 'Features?', options: [
        { label: 'Audit log', description: 'Track changes' },
        { label: 'API tokens', description: 'Issue tokens' },
      ] },
      { id: 'deployment', question: 'Deployment?', isOther: true },
    ]));

    const response = encodeUserInputResponse(normalized.responseContext, {
      action: 'answer',
      answers: [
        { questionId: 'database', selectedOptionIds: ['option-0'] },
        { questionId: 'features', selectedOptionIds: ['option-0', 'option-1'] },
        { questionId: 'deployment', text: 'Self-hosted Kubernetes' },
      ],
    });

    expect(response).toEqual({ id: 'provider-request-7', result: { answers: {
      database: { answers: ['PostgreSQL'] },
      features: { answers: ['Audit log', 'API tokens'] },
      deployment: { answers: ['Self-hosted Kubernetes'] },
    } } });
  });

  it('preserves duplicate native labels while rejecting unknown or malformed UI option ids', () => {
    const normalized = normalizeUserInputRequest(request([{
      id: 'target', question: 'Target?', options: [
        { label: 'Preview', description: 'First' },
        { label: 'Preview', description: 'Second' },
      ],
    }]));

    expect(encodeUserInputResponse(normalized.responseContext, {
      action: 'answer', answers: [{ questionId: 'target', selectedOptionIds: ['option-1'] }],
    }).result.answers.target.answers).toEqual(['Preview']);
    for (const selectedOptionIds of [['option-9'], ['option-0', 'option-0'], 'option-0']) {
      expect(() => encodeUserInputResponse(normalized.responseContext, {
        action: 'answer', answers: [{ questionId: 'target', selectedOptionIds }],
      })).toThrow('Codex user-input response contains an unknown or malformed option id');
    }
  });
});
