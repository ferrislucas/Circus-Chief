import { BaseAgent } from '../BaseAgent.js';
import { executeGeminiCli } from './geminiCliRunner.js';
import { composeCliPrompt } from './cliUtils.js';
import { createGeminiSpawner } from '../../services/geminiSpawnHelper.js';

/**
 * Module-level flag: once an ENOENT is observed for the Gemini CLI, remember
 * it so subsequent calls can short-circuit.
 */
const geminiCliState = { unavailable: false };

function markGeminiCliUnavailable() {
  geminiCliState.unavailable = true;
}

/**
 * Test-only: reset the module-level ENOENT cache.
 * @private
 */
export function _resetGeminiCliUnavailableForTests() {
  geminiCliState.unavailable = false;
}

/**
 * Adapter for Google Gemini CLI.
 *
 * Execution path:
 *   Spawns `gemini -p "prompt" --output-format stream-json -m <model>` and
 *   parses its newline-delimited JSON stdout. Uses {@link createGeminiEventMapper}
 *   to normalize events into the SDK-shaped envelope the rest of the app
 *   already understands for Claude Code.
 *
 * Capabilities:
 *   - streaming:       true  — stream-json provides real-time events
 *   - thinking:        false — no separate thinking mode toggle
 *   - reasoningEffort: false — no effort level mapping yet
 *   - toolUse:         true  — Gemini CLI has built-in shell, file, and web tools
 *   - resume:          false — no session resume support in headless mode
 */
export class GeminiAdapter extends BaseAgent {
  static capabilities = Object.freeze({
    streaming: true,
    thinking: false,
    reasoningEffort: false,
    toolUse: true,
    resume: false,
  });

  /**
   * @param {Object} [opts]
   * @param {Function} [opts.spawnGeminiProcess] - Optional DI for testing.
   *   Shape matches {@link createGeminiSpawner} output.
   * @param {Object} [opts.rest] - Passed to {@link BaseAgent}.
   */
  constructor({ spawnGeminiProcess, ...rest } = {}) {
    super(rest);
    this._spawnGemini = spawnGeminiProcess;
  }

  getCapabilities() {
    return { ...GeminiAdapter.capabilities };
  }

  supportsResume() {
    return false;
  }

  /**
   * Execute a Gemini query and yield SDK-shaped events.
   *
   * @param {Object} queryParams
   * @yields {Object} Normalized SDK events
   */
  async *execute(queryParams, _meta) {
    const options = queryParams.options || {};
    yield* this._executeCli(queryParams, options);
  }

  _executeCli(queryParams, options) {
    const child = this._spawnGeminiChild(queryParams, options);
    return executeGeminiCli(child, queryParams, options, markGeminiCliUnavailable);
  }

  _spawnGeminiChild(queryParams, options) {
    const spawnFn = this._spawnGemini ?? createGeminiSpawner();
    const { cwd, env, abortController, model, systemPrompt } = options;
    const composedPrompt = composeCliPrompt(systemPrompt, queryParams.prompt);
    const args = ['-p', composedPrompt, '--output-format', 'stream-json', '-m', model];

    try {
      return spawnFn({ command: 'gemini', args, cwd, env, signal: abortController?.signal });
    } catch (err) {
      if (err?.code === 'ENOENT') {
        geminiCliState.unavailable = true;
        const notFound = new Error('Gemini CLI not found');
        notFound.code = 'GEMINI_CLI_NOT_FOUND';
        throw notFound;
      }
      throw err;
    }
  }
}
