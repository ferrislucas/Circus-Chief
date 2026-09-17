import { readFileSync } from 'fs';

/**
 * Test-server-only OpenAI SDK dependency injection. The fixture has the same
 * `withResponse()` shape as the SDK request, so allowance parsing still
 * occurs at the production CodexAdapter boundary rather than via API state
 * mutation.
 */
export function createE2EOpenAIAllowanceClientFactory() {
  const fixturePath = process.env.VCR_MODE && process.env.E2E_OPENAI_ALLOWANCE_FIXTURE;
  if (!fixturePath) return null;

  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const headers = fixture.complete;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new Error('E2E OpenAI allowance fixture requires a complete header object.');
  }

  return () => ({
    chat: {
      completions: {
        create: () => ({
          withResponse: async () => ({
            data: createFixtureStream(),
            response: { headers: new Headers(headers) },
          }),
        }),
      },
    },
  });
}

export function isE2EOpenAIAllowanceFixtureEnabled() {
  return Boolean(process.env.VCR_MODE && process.env.E2E_OPENAI_ALLOWANCE_FIXTURE);
}

function createFixtureStream() {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        choices: [{ delta: { content: 'E2E OpenAI allowance fixture response.' } }],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      };
    },
  };
}
