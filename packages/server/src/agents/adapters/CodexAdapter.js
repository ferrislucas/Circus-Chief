import readline from 'readline';
import { BaseAgent } from '../BaseAgent.js';
import { createCodexEventMapper } from './codexEventMapper.js';
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
 *   - toolUse:     false  (tool-use plumbing deferred)
 *   - resume:      false  (Codex CLI v0.124.0 supports `codex resume` and
 *                          `codex exec resume`, but Circus Chief defers
 *                          wiring to a later phase — see
 *                          docs/plans/openai-codex-agent.md §Phase 4.5)
 */
export class CodexAdapter extends BaseAgent {
  static capabilities = Object.freeze({
    streaming: true,
    thinking: false,
    toolUse: false,
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
    const cliState = createCliState(options.model);

    attachAbortHandling(child, options.abortController, cliState);
    const stdinPrompt = composeCliPrompt(options.systemPrompt, queryParams.prompt);
    writePromptToStdin(child, stdinPrompt);
    attachStdoutReader(child, cliState);
    attachStderrReader(child, cliState);
    attachProcessLifecycleHandlers(child, cliState);

    try {
      yield* drainCliEvents(cliState);
    } finally {
      cleanupCli(options.abortController, cliState);
    }
  }

  _spawnCodexChild(queryParams, options) {
    const spawnFn = this._spawnCodex ?? createCodexSpawner();
    const { cwd, env, abortController, model, sandboxMode } = options;
    const effectiveSandbox = sandboxMode || 'workspace-write';
    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox', effectiveSandbox,
      '-m', model,
    ];

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

// --- CLI helpers -----------------------------------------------------------

function createCliState(model) {
  return new CliState(model);
}

class CliState {
  constructor(model) {
    this.pending = [];
    this.error = null;
    this.ended = false;
    this.resolveNext = null;
    this.rejectAll = null;
    this.mapper = createCodexEventMapper({ model });
    this.rl = null;
    this.killTimer = null;
    this.onAbort = null;
    this.stderrBuffer = '';
  }

  assign(patch) {
    Object.assign(this, patch);
  }

  pushEvents(arr) {
    for (const e of arr) this.pending.push(e);
    this.tickWaiter();
  }

  tickWaiter() {
    if (this.resolveNext) {
      const r = this.resolveNext;
      this.resolveNext = null;
      r();
    }
  }

  failWith(err) {
    this.error = err;
    if (this.rejectAll) this.rejectAll(err);
  }

  markEnded() {
    this.ended = true;
  }
}

function attachAbortHandling(child, abortController, state) {
  const onAbort = () => {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }, 2000);
    state.assign({ killTimer: timer });
  };
  state.assign({ onAbort });
  abortController?.signal?.addEventListener('abort', onAbort);
}

function writePromptToStdin(child, prompt) {
  try {
    if (child.stdin) child.stdin.end(prompt ?? '');
  } catch { /* ignore */ }
}

/**
 * Compose the final stdin text for the Codex CLI.
 *
 * Codex has no `--system` flag; system prompts are normally routed via
 * `~/.codex/config.toml` or `-c user_instructions=...`. For v1 we take the
 * simpler path of prepending the system prompt onto the user prompt with
 * clearly-labeled sections — this matches the shape the direct-API path
 * already feeds into chat messages.
 * @param {string|null|undefined} systemPrompt
 * @param {string|null|undefined} prompt
 * @returns {string}
 */
export function composeCliPrompt(systemPrompt, prompt) {
  const user = prompt ?? '';
  if (typeof systemPrompt === 'string' && systemPrompt.length > 0) {
    return `SYSTEM PROMPT:\n${systemPrompt}\n\nUSER:\n${user}`;
  }
  return user;
}

function attachStdoutReader(child, state) {
  const rl = readline.createInterface({ input: child.stdout });
  state.assign({ rl });
  rl.on('line', (line) => handleCliStdoutLine(line, state));
}

function handleCliStdoutLine(line, state) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return; // tolerate non-JSON status lines
  }
  try {
    const mapped = state.mapper.map(parsed);
    if (mapped.length > 0) state.pushEvents(mapped);
  } catch (err) {
    state.failWith(err);
  }
}

function attachStderrReader(child, state) {
  if (!child.stderr) return;
  child.stderr.on('data', (chunk) => {
    if (state.error || state.ended) return;
    state.assign({ stderrBuffer: state.stderrBuffer + chunk.toString() });
  });
}

function attachProcessLifecycleHandlers(child, state) {
  child.on('error', (err) => {
    if (err && err.code === 'ENOENT') {
      codexCliUnavailable = true;
      const notFound = new Error('Codex CLI not found');
      notFound.code = 'CODEX_CLI_NOT_FOUND';
      state.failWith(notFound);
    } else {
      state.failWith(err);
    }
  });

  child.on('exit', (code) => handleChildExit(code, state));
}

function handleChildExit(code, state) {
  state.markEnded();
  if (code !== 0 && !state.error) {
    const stderrTrimmed = state.stderrBuffer.trim();
    const err = stderrTrimmed.length > 0
      ? new Error(stderrTrimmed)
      : new Error(`Codex CLI exited with code ${code}`);
    err.code = 'CODEX_CLI_EXIT';
    err.exitCode = code;
    state.failWith(err);
  } else if (!state.error) {
    try {
      const fin = state.mapper.finalize();
      if (fin.length > 0) state.pushEvents(fin);
    } catch { /* ignore */ }
  }
  state.tickWaiter();
}

async function *drainCliEvents(state) {
  while (true) {
    if (state.error) throw state.error;
    if (state.pending.length > 0) {
      yield state.pending.shift();
      continue;
    }
    if (state.ended) break;
    await new Promise((resolve, reject) => {
      state.assign({ resolveNext: resolve, rejectAll: reject });
    });
  }
  if (state.error) throw state.error;
}

function cleanupCli(abortController, state) {
  if (state.onAbort) {
    abortController?.signal?.removeEventListener('abort', state.onAbort);
  }
  if (state.killTimer) clearTimeout(state.killTimer);
  try { state.rl?.close(); } catch { /* ignore */ }
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
