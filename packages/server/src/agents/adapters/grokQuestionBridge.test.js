import { describe, expect, it } from 'vitest';
import { toGrokQuestionResult } from './grokQuestionBridge.js';

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
