import crypto from 'crypto';
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
 *   1. CLI path (default) — spawns `codex exec --json ...` and parses its
 *      line-delimited JSON stdout. Uses {@link createCodexEventMapper} to
 *      normalize events into the SDK-shaped envelope the rest of the app
 *      already understands.
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
    const { cwd, env, abortController, model, sandboxMode, effortLevel, mcpServers } = options;
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

    // Serialize MCP config and collect credential env vars to inject.
    const mcpConfig = (mcpServers && typeof mcpServers === 'object')
      ? serializeMcpServersToArgs(mcpServers, { baseEnv: env })
      : { args: [], env: {} };
    args.push(...mcpConfig.args);

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
        env: { ...env, ...mcpConfig.env },
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

// --- MCP server CLI serialization ------------------------------------------

/**
 * Environment variable names that Codex itself uses or that are reserved for
 * Circus Chief control flow. Stdio MCP `env` entries whose key matches any of
 * these names are silently dropped — they must not be forwarded to the MCP
 * child via env_vars, and their values must not be injected into the Codex
 * spawn environment.
 *
 * Codex's own env (process.env keys and the session-supplied env object) is
 * also blocked; this set covers names that should be blocked even when absent
 * from the base env at spawn time.
 */
const CODEX_RESERVED_MCP_ENV_NAMES = new Set(['OPENAI_API_KEY', 'CODEX_HOME']);

/**
 * Serialize an mcpServers map into repeated `-c` CLI args for the Codex CLI,
 * with credential values moved out of argv into the spawned process environment.
 *
 * Generates config keys under `mcp_servers.<serverName>` using the Codex
 * `mcp_servers` schema. Supported keys per server type:
 *   Remote: url, bearer_token_env_var, env_http_headers
 *   Stdio:  command, args, env_vars, cwd, startup_timeout_sec
 *
 * Credential values (bearer tokens, header values) for remote servers are
 * placed into a returned `env` map under collision-resistant generated variable
 * names (`CIRCUSCHIEF_MCP_<SANITIZED_PARTS>_<HASH>`), and config args reference
 * those variable names instead of literal credential values.
 *
 * Stdio `env` string values are forwarded under their original `.mcp.json` key
 * names. Codex's `env_vars` whitelist forwards variables by name from Codex's
 * own environment to the stdio MCP child; it cannot rename them. Using original
 * key names means the MCP child sees the expected variable names (e.g. `API_KEY`
 * rather than a generated `CIRCUSCHIEF_MCP_*` name).
 *
 * Existing Codex env names (derived from the base env at spawn time plus
 * {@link CODEX_RESERVED_MCP_ENV_NAMES}) are blocked: stdio env entries whose
 * key is blocked are dropped and logged. Same-name keys across multiple accepted
 * MCP servers remain last-write-wins. `env_vars` is emitted only when at least
 * one accepted key remains.
 *
 * @param {Object} mcpServers
 * @param {Object} [opts]
 * @param {Set<string>} [opts.blockedEnvNames] - Set of env key names that must
 *   not be injected from stdio MCP server env entries.
 * @returns {{ args: string[], env: Object }} args are flat '-c'/value pairs;
 *   env holds credential values to merge into the Codex spawn environment.
 */
function serializeMcpServersToArgs(mcpServers, { blockedEnvNames = new Set() } = {}) {
  const args = [];
  const env = {};
  for (const [serverName, server] of Object.entries(mcpServers)) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) continue;
    const prefix = `mcp_servers.${tomlKey(serverName)}`;
    let result;
    if (server.type === 'sse' || server.type === 'http') {
      result = serializeRemoteMcpServer(prefix, serverName, server);
    } else {
      result = serializeStdioMcpServer(prefix, serverName, server, { blockedEnvNames });
    }
    args.push(...result.args);
    Object.assign(env, result.env);
  }
  return { args, env };
}

/**
 * Serialize a remote (sse/http) MCP server using the Codex HTTP schema.
 *
 * Emits `url`, `bearer_token_env_var`, and `env_http_headers`. Does NOT emit
 * `type` or literal credential values in argv. Bearer Authorization values and
 * all other string headers are moved into the spawn environment under generated
 * variable names.
 *
 * @param {string} prefix
 * @param {string} serverName
 * @param {Object} server
 * @returns {{ args: string[], env: Object }}
 */
function serializeRemoteMcpServer(prefix, serverName, server) {
  if (typeof server.url !== 'string' || server.url.length === 0) return { args: [], env: {} };

  const args = ['-c', `${prefix}.url=${tomlStr(server.url)}`];
  const env = {};

  const headers = (server.headers && typeof server.headers === 'object' && !Array.isArray(server.headers))
    ? server.headers
    : {};

  // Convert Authorization: Bearer <token> to bearer_token_env_var.
  // Non-Bearer Authorization strings fall through to env_http_headers below.
  const authEntry = Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization');
  const bearerToken = extractBearerToken(authEntry);
  let authConsumedAsBearer = false;
  if (bearerToken !== null) {
    const varName = makeMcpEnvVarName(serverName, 'BEARER_TOKEN');
    env[varName] = bearerToken;
    args.push('-c', `${prefix}.bearer_token_env_var=${tomlStr(varName)}`);
    authConsumedAsBearer = true;
  }

  // Convert remaining string headers to env_http_headers.
  // Non-Bearer Authorization headers are included here alongside other headers.
  const otherStringHeaders = Object.entries(headers)
    .filter(([k, v]) => {
      if (k.toLowerCase() === 'authorization') return !authConsumedAsBearer && typeof v === 'string';
      return typeof v === 'string';
    });

  if (otherStringHeaders.length > 0) {
    const headerEnvMap = {};
    for (const [headerName, headerValue] of otherStringHeaders) {
      const varName = makeMcpEnvVarName(serverName, 'HDR', headerName);
      env[varName] = headerValue;
      headerEnvMap[headerName] = varName;
    }
    const tableStr = `{${Object.entries(headerEnvMap).map(([k, v]) => `${tomlKey(k)}=${tomlStr(v)}`).join(',')}}`;
    args.push('-c', `${prefix}.env_http_headers=${tableStr}`);
  }

  return { args, env };
}

/**
 * Serialize a stdio MCP server using the Codex stdio schema.
 *
 * Emits `command`, `args`, `env_vars`, `cwd`, and `startup_timeout_sec`.
 * Does NOT emit `type` or literal env values in argv. Stdio `env` string
 * values are injected into the spawn environment under their original
 * `.mcp.json` key names, and those key names are listed in `env_vars`.
 *
 * Why original key names (not generated names):
 *   - `env_vars` is a whitelist that forwards variables by name from Codex's
 *     own process environment to the stdio MCP child. It cannot rename them.
 *     Using the original name ensures the child sees `API_KEY`, not a generated
 *     `CIRCUSCHIEF_MCP_*` name.
 *   - Literal `mcp_servers.<id>.env` would model the Codex schema directly, but
 *     passing it via repeated `-c` CLI args would put secrets in argv.
 *   - Existing Codex env names and reserved names are blocked via `blockedEnvNames`.
 *     Blocked entries are dropped and logged; they are not added to `env` or `env_vars`.
 *   - Accepted entries use original `.mcp.json` key names.
 *   - Same-name keys across multiple accepted MCP servers remain last-write-wins.
 *   - `env_vars` is emitted only when at least one accepted key remains.
 *
 * @param {string} prefix
 * @param {string} serverName
 * @param {Object} server
 * @param {Object} [opts]
 * @param {Set<string>} [opts.blockedEnvNames] - Set of env key names that must
 *   not be injected. Entries whose key is in this set are dropped and logged.
 * @returns {{ args: string[], env: Object }}
 */
function serializeStdioMcpServer(prefix, serverName, server, { blockedEnvNames = new Set() } = {}) {
  if (typeof server.command !== 'string' || server.command.length === 0) return { args: [], env: {} };

  const args = ['-c', `${prefix}.command=${tomlStr(server.command)}`];
  const env = {};

  if (Array.isArray(server.args)) {
    const strArgs = server.args.filter((a) => typeof a === 'string');
    args.push('-c', `${prefix}.args=[${strArgs.map(tomlStr).join(',')}]`);
  }

  // Inject env string values under their original key names; list them in env_vars.
  // env_vars forwards variable names from Codex's environment to the MCP child —
  // it cannot rename them, so using original names is required.
  // Blocked keys (those already in the Codex base env or reserved names) are
  // dropped to prevent MCP servers from overriding critical Codex variables.
  if (server.env && typeof server.env === 'object' && !Array.isArray(server.env)) {
    const stringEntries = Object.entries(server.env).filter(([, v]) => typeof v === 'string');
    const acceptedEntries = [];
    const skippedKeys = [];
    for (const [key, value] of stringEntries) {
      if (blockedEnvNames.has(key)) {
        skippedKeys.push(key);
      } else {
        acceptedEntries.push([key, value]);
      }
    }
    if (skippedKeys.length > 0) {
      console.warn('[CodexAdapter] dropped MCP stdio env keys that would override Codex env:', {
        serverName,
        keys: skippedKeys,
      });
    }
    if (acceptedEntries.length > 0) {
      const envVarNames = [];
      for (const [key, value] of acceptedEntries) {
        env[key] = value;
        envVarNames.push(key);
      }
      args.push('-c', `${prefix}.env_vars=[${envVarNames.map(tomlStr).join(',')}]`);
    }
  }

  if (typeof server.cwd === 'string' && server.cwd.length > 0) {
    args.push('-c', `${prefix}.cwd=${tomlStr(server.cwd)}`);
  }

  if (Number.isFinite(server.startup_timeout_sec)) {
    args.push('-c', `${prefix}.startup_timeout_sec=${server.startup_timeout_sec}`);
  }

  return { args, env };
}

/**
 * Extract a trimmed Bearer token from an Authorization header entry.
 * Returns the token string, or null if the entry is not a valid non-empty Bearer value.
 *
 * @param {[string, unknown]|undefined} authEntry - [headerName, headerValue] pair or undefined
 * @returns {string|null}
 */
function extractBearerToken(authEntry) {
  if (!authEntry) return null;
  const [, authValue] = authEntry;
  if (typeof authValue !== 'string') return null;
  const match = authValue.match(/^Bearer\s+(.+)/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Generate a collision-resistant environment variable name for an MCP credential field.
 * Pattern: CIRCUSCHIEF_MCP_<SANITIZED_PARTS>_<HASH>
 *
 * Each segment is uppercased and non-alphanumeric characters are replaced with '_'
 * to form a readable prefix. A short deterministic suffix (first 8 hex chars of a
 * SHA-256 digest over the raw segment values) prevents collisions between inputs
 * whose sanitized forms are identical (e.g. 'X-Custom' and 'X.Custom' both map to
 * 'X_CUSTOM' but receive different hashes).
 *
 * @param {string} serverName
 * @param {...string} parts - Additional segments (e.g. 'BEARER_TOKEN', 'ENV', 'API_KEY')
 * @returns {string}
 */
function makeMcpEnvVarName(serverName, ...parts) {
  const allParts = [serverName, ...parts];
  const segments = allParts.map((s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '_'));
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(allParts))
    .digest('hex')
    .slice(0, 8);
  return `CIRCUSCHIEF_MCP_${segments.join('_')}_${hash}`;
}

/**
 * Serialize a string as a TOML basic string (JSON-compatible double-quoting).
 * @param {string} s
 * @returns {string}
 */
function tomlStr(s) {
  return JSON.stringify(s);
}

/**
 * Return a TOML key segment: bare if safe ([A-Za-z0-9_-]), quoted otherwise.
 * @param {string} s
 * @returns {string}
 */
function tomlKey(s) {
  if (/^[A-Za-z0-9_-]+$/.test(s)) return s;
  return JSON.stringify(s);
}
