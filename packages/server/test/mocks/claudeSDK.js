import { vi } from 'vitest';

export const mockQuery = vi.fn().mockImplementation(async function* (_options) {
  // Simulate assistant response
  yield {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: 'I will help you with that.' }],
    },
  };

  // Simulate completion
  yield { type: 'result', subtype: 'success' };
});

export function resetMocks() {
  mockQuery.mockClear();
}
