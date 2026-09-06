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

  it('rejects malformed native question fields instead of coercing or truncating them', () => {
    expect(() => normalizeUserInputRequest(request([{
      id: 'multi', question: 'Select checks', isMultiSelect: 'yes',
      options: [{ label: 'Unit', description: 'Fast' }],
    }]))).toThrow('Codex question multi-select mode is invalid');

    expect(() => normalizeUserInputRequest(request([{
      id: 'header', header: 'x'.repeat(257), question: 'Choose',
      options: [{ label: 'One', description: 'Only choice' }],
    }]))).toThrow('Codex question header is invalid');
  });

  it('normalizes an explicitly requested multi-select question without accepting a mixed answer mode', () => {
    const normalized = normalizeUserInputRequest(request([{
      id: 'checks', question: 'Select checks', isMultiSelect: true,
      options: [{ label: 'Unit', description: 'Fast' }, { label: 'E2E', description: 'Broad' }],
    }]));

    expect(normalized.payload.questions[0]).toMatchObject({ mode: 'multiple' });
  });

  it.each([
    ['too many questions', Array.from({ length: 4 }, (_, index) => ({ id: `q-${index}`, question: 'Choose', options: [] })), '1–3 questions'],
    ['too many options', [{ id: 'q', question: 'Choose', options: Array.from({ length: 17 }, (_, index) => ({ label: `Option ${index}`, description: 'Choice' })) }], 'options exceed'],
    ['oversized question', [{ id: 'q', question: 'x'.repeat(8_001), options: [] }], 'question text is invalid'],
    ['oversized option description', [{ id: 'q', question: 'Choose', options: [{ label: 'Option', description: 'x'.repeat(8_001) }] }], 'option is invalid'],
  ])('rejects %s at the native request boundary', (_name, questions, expected) => {
    expect(() => normalizeUserInputRequest(request(questions))).toThrow(expected);
  });
});
