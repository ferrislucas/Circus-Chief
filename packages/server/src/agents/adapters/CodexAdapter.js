import { BaseAgent } from '../BaseAgent.js';
import { executeCodexCli } from './codexCliRunner.js';
import { createCodexSpawner } from '../../services/codexSpawnHelper.js';

/**
 * Module-level flag: once an ENOENT is observed for the Codex CLI, remember
 * it so subsequent calls skip the spawn attempt and can short-circuit the
 * direct-API path selection.
 */
let codexCliUnavailable = false;

/**
 * Adapter for OpenAI Codex / any OpenAI-Chat-Completions-compatible model.
 *
 * Two execution paths:
 *
 *   1. CLI path (default) — spawns the `codex --json ...` CLI and parses its
 *      line-delimited JSON stdout. Uses {@link createCodexEventMapper} to
 *      normalize events into the SDK-shaped envelope the rest of the app
 *      already understands.
 *
 *   2. Direct-API path — activated by {@code USE_CODEX_DIRECT_API=1}. Uses
 *      the official {@code openai} SDK with Chat Completions streaming
 *      against the provider's configured baseURL/apiKey. Intended for
 *      environments where the Codex CLI isn't installable and for the
 *      Step-0 contingency path in the implementation plan.
 *
 * Capabilities in v1:
 *   - streaming:   true
 *   - thinking:    false
 *   - reasoningEffort: true
 *   - toolUse:     true
 *   - resume:      false  (Codex CLI v0.124.0 supports `codex resume` and
 *                          `codex exec resume`, but Circus Chief defers
 *                          wiring to a later phase — see
 *                          docs/plans/openai-codex-agent.md §Phase 4.5)
 */
export class CodexAdapter extends BaseAgent {
  static capabilities = Object.freeze({
    streaming: true,
    thinking: false,
    reasoningEffort: true,
    toolUse: true,
    resume: false,
  });

  /**
   * @param {Object} [opts]
   * @param {Function} [opts.spawnCodexProcess] - Optional DI for testing the
   *   CLI path. Shape matches {@link createCodexSpawner} output.
   * @param {Function} [opts.openaiClientFactory] - Optional DI for testing
   *   the direct-API path: {@code ({ baseURL, apiKey, timeout }) => client}
   *   where {@code client.chat.completions.create} is OpenAI-SDK-compatible.
   * @param {Object} [opts.rest] - Passed to {@link BaseAgent}.
   */
  constructor({ spawnCodexProcess, openaiClientFactory, ...rest } = {}) {
    super(rest);
    this._spawnCodex = spawnCodexProcess;
    this._openaiClientFactory = openaiClientFactory;
  }

  getCapabilities() {
    return { ...CodexAdapter.capabilities };
  }

  supportsResume() {
    return false;
  }

  /**
   * Execute a Codex query and yield SDK-shaped events.
   *
   * @param {import('../types.js').AgentQueryParams} queryParams
   * @yields {Object} Normalized SDK events
   */
  async *execute(queryParams, _meta) {
    const options = queryParams.options || {};
    if (this._shouldUseDirectApi()) {
      yield* this._executeDirectApi(queryParams, options);
      return;
    }
    yield* this._executeCli(queryParams, options);
  }

  _shouldUseDirectApi() {
    if (process.env.USE_CODEX_DIRECT_API === '1') return true;
    if (this._spawnCodex === null) return true;
    if (codexCliUnavailable) return true;
    return false;
  }

  /**
   * CLI path — spawn the Codex CLI and stream JSON events.
   *
   * Real invocation (v0.124.0):
   *   codex exec --json --skip-git-repo-check --sandbox <mode> -m <model>
   *
   * Notes:
   *   - The `exec` subcommand is required (bare `codex --json` does not work).
   *   - There is no `--system` flag; system prompts are prepended to the
   *     stdin prompt via {@link composeCliPrompt}.
   *   - Sandbox mode is driven by {@code options.sandboxMode} (defaults to
   *     `workspace-write`) which is set by
   *     {@code buildCodexQueryParams} from {@code session.mode}.
   */
  async *_executeCli(queryParams, options) {
    const child = this._spawnCodexChild(queryParams, options);
    yield* executeCodexCli(child, queryParams, options, markCodexCliUnavailable);
  }

  _spawnCodexChild(queryParams, options) {
    const spawnFn = this._spawnCodex ?? createCodexSpawner();
    const { cwd, env, abortController, model, sandboxMode, effortLevel, commitAttributionOverride } = options;
    const effectiveSandbox = sandboxMode || 'workspace-write';
    const codexReasoningEffort = resolveCodexReasoningEffort(effortLevel);
    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox', effectiveSandbox,
      '-m', model,
    ];

    if (codexReasoningEffort) {
      args.push(
        '-c', `model_reasoning_effort=${codexReasoningEffort}`,
        '-c', `plan_mode_reasoning_effort=${codexReasoningEffort}`
      );
    }

    if (commitAttributionOverride) {
      args.push('-c', `commit_attribution=${commitAttributionOverride}`);
    }

    // Defense in depth: when no API key is in the env, force ChatGPT auth
    // so the CLI uses its own OAuth flow even if some env var leaks through.
    if (!env?.OPENAI_API_KEY) {
      args.push('-c', 'preferred_auth_method=chatgpt');
    }

    console.log('[CodexAdapter] auth_mode_hint =', env?.OPENAI_API_KEY ? 'apikey' : 'chatgpt');

    try {
      return spawnFn({
        command: 'codex',
        args,
        cwd,
        env,
        signal: abortController?.signal,
      });
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        codexCliUnavailable = true;
        const notFound = new Error('Codex CLI not found');
        notFound.code = 'CODEX_CLI_NOT_FOUND';
        throw notFound;
      }
      throw err;
    }
  }

  /**
   * Direct-API path — stream Chat Completions via the OpenAI SDK.
   */
  async *_executeDirectApi(queryParams, options) {
    if (options.commitAttributionOverride) {
      console.debug(
        '[CodexAdapter] Ignoring commitAttributionOverride in direct API fallback'
      );
    }
    const { model, systemPrompt, abortController } = resolveDirectApiInputs(options);
    const client = await this._resolveOpenAiClient(options);

    yield {
      type: 'system',
      subtype: 'init',
      session_id: `codex-${Date.now()}`,
      model,
    };

    const stream = await client.chat.completions.create({
      model,
      messages: buildChatMessages(queryParams.prompt, systemPrompt),
      stream: true,
    });

    const onAbort = () => {
      try { stream?.controller?.abort?.(); } catch { /* ignore */ }
    };
    abortController?.signal?.addEventListener('abort', onAbort);

    let accumulated = '';
    let finalUsage = null;

    try {
      for await (const chunk of stream) {
        const text = chunk?.choices?.[0]?.delta?.content;
        if (text) {
          accumulated += text;
          yield makeTextDeltaEvent(text);
        }
        if (chunk?.usage) finalUsage = chunk.usage;
      }
    } finally {
      abortController?.signal?.removeEventListener('abort', onAbort);
    }

    yield { type: 'assistant', message: { content: [{ type: 'text', text: accumulated }] } };
    yield {
      type: 'result',
      subtype: 'success',
      usage: {
        input_tokens: finalUsage?.prompt_tokens ?? 0,
        output_tokens: finalUsage?.completion_tokens ?? 0,
      },
    };
  }

  async _resolveOpenAiClient(options) {
    const env = options.env || process.env;
    const baseURL = env.OPENAI_BASE_URL || env.OPENAI_API_BASE;
    const apiKey = env.OPENAI_API_KEY;
    const timeout = env.API_TIMEOUT_MS ? Number(env.API_TIMEOUT_MS) : undefined;

    if (this._openaiClientFactory) {
      return this._openaiClientFactory({ baseURL, apiKey, timeout });
    }
    if (!apiKey) {
      const err = new Error('OPENAI_API_KEY not set — cannot use Codex direct-API path');
      err.code = 'OPENAI_API_KEY_MISSING';
      throw err;
    }
    const { default: OpenAI } = await import('openai');
    return new OpenAI({ baseURL, apiKey, timeout });
  }
}

/**
 * Test-only: reset the module-level ENOENT cache so each test case starts
 * from a known state.
 * @private
 */
export function _resetCodexCliUnavailableForTests() {
  codexCliUnavailable = false;
}

// --- Direct-API helpers ----------------------------------------------------

function markCodexCliUnavailable() {
  codexCliUnavailable = true;
}

function resolveDirectApiInputs(options) {
  return {
    model: options.model || 'gpt-4o-mini',
    systemPrompt: typeof options.systemPrompt === 'string' ? options.systemPrompt : null,
    abortController: options.abortController,
  };
}

function resolveCodexReasoningEffort(effortLevel) {
  if (!effortLevel || effortLevel === 'auto') return null;
  if (effortLevel === 'max') return 'xhigh';
  if (['low', 'medium', 'high'].includes(effortLevel)) return effortLevel;
  return null;
}

function buildChatMessages(prompt, systemPrompt) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt ?? '' });
  return messages;
}

function makeTextDeltaEvent(text) {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text },
    },
  };
}
