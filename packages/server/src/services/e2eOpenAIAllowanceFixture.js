import { readFileSync } from 'fs';
import { BUILT_IN_OPENAI_PROVIDER } from '../db/seedBaselineData.js';

// Logged at most once per process: the fixture is injected per session, but
// one activation line at first use is enough to flag that production code is
// running a test-surface path.
let fixtureActivationLogged = false;

// Validated headers, keyed by fixture path: the file is read and parsed
// once at first use and reused for every later session, so a bad fixture
// fails fast with one descriptive error instead of crashing per-session
// inside buildAgentConfig.
let cachedFixtureHeaders = null;

/**
 * Test-only: drop the cached headers so each case validates from scratch.
 * @private
 */
export function _resetE2EOpenAIAllowanceFixtureForTests() {
  cachedFixtureHeaders = null;
  fixtureActivationLogged = false;
}

/**
 * Read, parse, and validate the fixture once per process. Throws a
 * descriptive error naming the path and the E2E_OPENAI_ALLOWANCE_FIXTURE
 * variable when the file is missing, unparseable, or incomplete.
 */
function getValidatedFixtureHeaders(fixturePath) {
  if (cachedFixtureHeaders && cachedFixtureHeaders.path === fixturePath) {
    return cachedFixtureHeaders.headers;
  }
  let raw;
  try {
    raw = readFileSync(fixturePath, 'utf8');
  } catch {
    throw new Error(
      `E2E OpenAI allowance fixture not found at ${fixturePath} (E2E_OPENAI_ALLOWANCE_FIXTURE).`,
    );
  }
  let fixture;
  try {
    fixture = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `E2E OpenAI allowance fixture at ${fixturePath} is not valid JSON: ${error.message}.`,
    );
  }
  const headers = fixture.complete;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new Error('E2E OpenAI allowance fixture requires a complete header object.');
  }
  cachedFixtureHeaders = { path: fixturePath, headers };
  return headers;
}

/**
 * Test-server-only OpenAI SDK dependency injection. The fixture has the same
 * `withResponse()` shape as the SDK request, so allowance parsing still
 * occurs at the production CodexAdapter boundary rather than via API state
 * mutation.
 *
 * The injection is scoped to sessions on the built-in default OpenAI provider
 * — the live allowance E2E target. pw.sh exports the fixture env for the
 * whole run, so without this scope every Codex session (including
 * custom-provider cassette flows) would be rerouted to the fixture client and
 * VCR replay would be disabled server-wide.
 */
export function createE2EOpenAIAllowanceClientFactory(providerId = null) {
  if (providerId !== BUILT_IN_OPENAI_PROVIDER.id) return null;
  const fixturePath = process.env.VCR_MODE && process.env.E2E_OPENAI_ALLOWANCE_FIXTURE;
  if (!fixturePath) return null;

  if (!fixtureActivationLogged) {
    fixtureActivationLogged = true;
    console.log('[E2EOpenAIAllowanceFixture]', JSON.stringify({
      outcome: 'fixture-active',
      providerId,
      fixturePath,
    }));
  }

  // Validated once and reused: a bad fixture throws its descriptive error
  // here, at first use, instead of per-session inside buildAgentConfig.
  const headers = getValidatedFixtureHeaders(fixturePath);

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

/**
 * True only when a session would actually execute the fixture path. VCR
 * replay must not wrap those sessions (it would bypass the production
 * adapter boundary the fixture exists to exercise); every other session in
 * VCR mode still replays cassettes.
 */
export function isE2EOpenAIAllowanceFixtureEnabled(mergedConfig = null) {
  return Boolean(mergedConfig && typeof mergedConfig.openaiClientFactory === 'function');
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
