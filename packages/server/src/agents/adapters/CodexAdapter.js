import { BaseAgent } from '../BaseAgent.js';
import { spawnCodexAppServer } from './codexAppServerRunner.js';

/**
 * Adapter for OpenAI Codex / any OpenAI-Chat-Completions-compatible model.
 *
 * Two execution paths:
 *
 *   1. App Server path (default) — spawns `codex app-server` and maintains
 *      the bidirectional JSON-RPC connection needed for interactive input.
 *
 *   2. Direct-API path — activated by {@code USE_CODEX_DIRECT_API=1}. Uses
 *      the official {@code openai} SDK with Chat Completions streaming
 *      against the provider's configured baseURL/apiKey. It bypasses
 *      CLI-specific behavior such as sandbox enforcement and Codex
 *      commit-attribution config. Intended for
 *      environments where the Codex CLI isn't installable.
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
    interactiveInput: true,
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
    return { ...CodexAdapter.capabilities, interactiveInput: !this._shouldUseDirectApi() };
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
  async *execute(queryParams, meta) {
    const options = queryParams.options || {};
    if (this._shouldUseDirectApi()) {
      yield* this._executeDirectApi(queryParams, options);
      return;
    }
    yield* this._executeAppServer(queryParams, options, meta);
  }

  _shouldUseDirectApi() {
    if (process.env.USE_CODEX_DIRECT_API === '1') return true;
    return false;
  }

  async *_executeAppServer(queryParams, options, meta) {
    yield* spawnCodexAppServer(this._spawnCodex, queryParams, {
      ...options,
    }, meta);
  }

  /**
   * Direct-API path — stream Chat Completions via the OpenAI SDK.
   */
  async *_executeDirectApi(queryParams, options) {
    const { model, systemPrompt, abortController } = resolveDirectApiInputs(options);
    const client = await this._resolveOpenAiClient(options);

    yield {
      type: 'system',
      subtype: 'init',
      session_id: `codex-${Date.now()}`,
      model,
    };

    const request = {
      model,
      messages: buildChatMessages(queryParams.prompt, systemPrompt),
      stream: true,
    };
    const requestOptions = {
      ...(abortController?.signal && { signal: abortController.signal }),
    };
    const stream = await client.chat.completions.create(request, requestOptions);

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

// --- Direct-API helpers ----------------------------------------------------

function resolveDirectApiInputs(options) {
  return {
    model: options.model || 'gpt-4o-mini',
    systemPrompt: typeof options.systemPrompt === 'string' ? options.systemPrompt : null,
    abortController: options.abortController,
  };
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
