import { spawn } from 'child_process';
import { tmpdir } from 'node:os';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createMuseExecProtocol } from '../agents/adapters/museExecProtocol.js';
import { createGeminiSpawner } from './geminiSpawnHelper.js';
import { createRobustEnv } from './nodeSpawnHelper.js';
import { appendBoundedDiagnostic } from './summaryMuseClient.js';

/**
 * Build the probe config shared by BOTH provider test routes (finding #9):
 * `POST /api/providers/test` (transient) and `POST /api/providers/:id/test`
 * (saved). One model fallback (`sonnet` tier, else the request's explicit
 * `defaultSonnetModel`, else the first enabled non-retired model) and one
 * meta-kind cwd rule: the Muse probe errors when `workingDirectory` is
 * unset, and a provider record / transient request carries none, so the OS
 * temp dir is used explicitly rather than leaking the server cwd into the
 * probe. An explicit `workingDirectory` always wins.
 *
 * @param {Object} provider - Saved provider record or validated transient
 *   request body (`kind`, `baseUrl`, `authToken`, `models`?, `defaultSonnetModel`?,
 *   `apiTimeoutMs`?, `workingDirectory`?).
 * @returns {Object} Config accepted by {@link testProviderConnection}.
 */
export function buildProviderTestConfig(provider) {
  const sonnetModel = provider.models?.find((m) => m.tier === 'sonnet');
  const explicitModel = provider.defaultSonnetModel || null;
  const firstEnabled = provider.models?.find((m) => m.enabled !== false && m.lifecycle !== 'retired')
    || provider.models?.[0]
    || null;
  return {
    kind: provider.kind || 'anthropic',
    baseUrl: provider.baseUrl,
    authToken: provider.authToken,
    defaultSonnetModel: sonnetModel?.modelId || explicitModel || firstEnabled?.modelId || null,
    apiTimeoutMs: provider.apiTimeoutMs,
    ...(provider.workingDirectory
      ? { workingDirectory: provider.workingDirectory }
      : (provider.kind === 'meta' ? { workingDirectory: tmpdir() } : {})),
  };
}

/**
 * Default spawn for the Meta connection test. Plain `spawn` with a robust
 * env (Node on PATH) — no E2E capture hook: E2E Muse coverage is out of
 * scope until the adapter has E2E fixtures. Detached on POSIX so a timeout
 * can signal the whole process group (round-3 finding #10).
 */
function defaultMuseTestSpawn({ command, args, cwd, env }) {
  return spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: createRobustEnv(env),
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
}

/**
 * Kill a timed-out meta probe, group first (round-3 finding #10): `muse
 * exec` can leave grandchildren behind a direct `child.kill`, so signal the
 * process group the detached spawn created. Falls back to `child.kill` when
 * there is no group to signal (no pid, Windows, already reaped). The group
 * kill is injectable via `deps.killProcessGroup` for tests.
 */
function killMuseTestProcess(child, killProcessGroup) {
  const killGroup = killProcessGroup || ((pid, signal) => process.kill(pid, signal));
  if (child?.pid && process.platform !== 'win32') {
    try {
      killGroup(-child.pid, 'SIGTERM');
      return;
    } catch {
      // No group to signal — fall through to the direct kill.
    }
  }
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
}

/**
 * Test a provider configuration by making a minimal API call.
 * Branches on `kind`:
 *   - 'anthropic' → send a tiny `messages.create` via `@anthropic-ai/sdk`.
 *   - 'openai'    → prefer `models.list()` via `openai`; fall back to a
 *                   `chat.completions.create({ max_tokens: 1 })` if
 *                   `models.list` is not supported (chat-only endpoints).
 *
 * Both branches return the same response shape:
 *   - Success: { success: true, message, details: { model, usage? } }
 *   - Failure: { success: false, message, details: { code, type } }
 * This function never throws. Errors are mapped to the failure shape above.
 *
 * @param {Object} config
 * @param {'anthropic'|'openai'} [config.kind='anthropic'] - Provider kind
 * @param {string} [config.baseUrl] - Base URL for the provider
 * @param {string} [config.authToken] - Auth token for the provider
 * @param {string} [config.defaultSonnetModel] - For anthropic: model to test against
 * @param {number} [config.apiTimeoutMs] - API timeout in milliseconds
 * @returns {Promise<{success: boolean, message: string, details?: Object}>}
 */
export async function testProviderConnection(config, deps = {}) {
  const { kind = 'anthropic' } = config || {};
  if (kind === 'openai') {
    return testOpenAIConnection(config);
  }
  if (kind === 'google') {
    return testGoogleConnection(config, deps);
  }
  if (kind === 'meta') {
    return testMetaConnection(config, deps);
  }
  return testAnthropicConnection(config);
}

/**
 * Anthropic-kind connection test (unchanged from pre-kind behavior).
 * @private
 */
async function testAnthropicConnection(config) {
  const { baseUrl, authToken, defaultSonnetModel, apiTimeoutMs } = config;

  try {
    const clientOptions = {};

    if (baseUrl) clientOptions.baseURL = baseUrl;
    if (authToken) clientOptions.apiKey = authToken;
    if (apiTimeoutMs) clientOptions.timeout = apiTimeoutMs;

    const client = new Anthropic(clientOptions);

    // Use a minimal message to test connectivity.
    // This verifies: network, auth, and model availability.
    const testModel = defaultSonnetModel || 'claude-sonnet-5';

    const response = await client.messages.create({
      model: testModel,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    });

    return {
      success: true,
      message: 'Connection successful',
      details: {
        model: response.model,
        usage: response.usage,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: getErrorMessage(error),
      details: {
        code: error.status || error.code,
        type: error.type || error.name,
      },
    };
  }
}

/**
 * OpenAI-kind connection test. Tries `models.list()` first; if the endpoint
 * does not implement that (common for chat-only proxies like LM Studio), falls
 * back to a minimal `chat.completions.create({ max_tokens: 1 })`.
 * @private
 */
async function testOpenAIConnection(config) {
  try {
    const client = createOpenAIClient(config);
    return await testOpenAIClient(client, config);
  } catch (error) {
    return failureResponse(error);
  }
}

function createOpenAIClient(config) {
  const { baseUrl, authToken, apiTimeoutMs } = config;
  const clientOptions = { apiKey: authToken || 'missing' };
  if (baseUrl) clientOptions.baseURL = baseUrl;
  if (apiTimeoutMs) clientOptions.timeout = apiTimeoutMs;
  return new OpenAI(clientOptions);
}

async function testOpenAIClient(client, config) {
  try {
    return await testOpenAIModelsEndpoint(client, config);
  } catch (error) {
    if (error?.status !== 404) throw error;
    return testOpenAIChatEndpoint(client, config);
  }
}

async function testOpenAIModelsEndpoint(client, config) {
  const listResult = await client.models.list();
  const first = pickFirstModel(listResult) || config.defaultSonnetModel || null;
  return connectionSuccess(first ? { model: first } : {});
}

async function testOpenAIChatEndpoint(client, config) {
  const testModel = config.defaultSonnetModel || 'gpt-4o-mini';
  const response = await client.chat.completions.create({
    model: testModel,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'Hi' }],
  });
  return connectionSuccess({
    model: response?.model || testModel,
    ...(response?.usage ? { usage: response.usage } : {}),
  });
}

/**
 * Google/Gemini connection test. Spawns `gemini -p "Hi" --output-format json`
 * and checks for a clean exit. No SDK dependency needed.
 * @private
 */
async function testGoogleConnection(config, deps = {}) {
  try {
    const env = {};
    if (config.authToken) env.GEMINI_API_KEY = config.authToken;
    const timeoutMs = config.apiTimeoutMs || 30000;
    const spawnGeminiProcess = deps.spawnGeminiProcess || createGeminiSpawner();
    const child = spawnGeminiProcess({
      command: 'gemini',
      args: ['-p', 'Hi', '--output-format', 'json', '--skip-trust', '--approval-mode=auto_edit', '-m', 'gemini-2.5-flash'],
      cwd: config.workingDirectory,
      env,
    });

    return await new Promise((resolve) => {
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        resolve(failureResponse(new Error(`Gemini CLI timed out after ${timeoutMs}ms`)));
      }, timeoutMs);

      child.stdout?.on('data', () => { /* drain */ });
      child.stderr?.on('data', (d) => { stderr += d; });
      child.on('error', (error) => {
        clearTimeout(timer);
        if (killed) return;
        if (error.code === 'ENOENT') {
          resolve(failureResponse(new Error('Gemini CLI not found. Install via: npm install -g @google/gemini-cli')));
        } else {
          resolve(failureResponse(error));
        }
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (killed) return;
        if (code === 0) {
          resolve(connectionSuccess({ model: 'gemini-2.5-flash' }));
        } else {
          resolve(failureResponse(new Error(stderr.trim() || `Gemini CLI exited with code ${code}`)));
        }
      });
    });
  } catch (error) {
    return failureResponse(error);
  }
}

/**
 * Build the headless `muse exec` argv for the Meta connection test (pure).
 *
 * No no-cost probe exists: `muse auth` only stores keys (verified against
 * `muse --help` — there is no `auth status` equivalent), so the test stays
 * one minimal billed `exec` turn. Sandbox stays ON (default); no session
 * log is written. Throws when no working directory is set — falling back
 * to the server cwd would test the wrong directory.
 *
 * @param {Object} config - `{ workingDirectory, defaultSonnetModel }`.
 * @returns {{ command: string, args: string[], cwd: string, model: string }}
 */
export function buildMuseTestArgs(config) {
  if (!config?.workingDirectory) {
    const error = new Error('A working directory is required to test the Muse connection.');
    error.code = 'MISSING_WORKING_DIRECTORY';
    throw error;
  }
  // Last-resort-only fallback (finding #9): always prefer the configured
  // model — this test turn is billed — the literal exists solely so a
  // model-less provider can still probe binary presence + auth.
  const model = config.defaultSonnetModel || 'muse-spark-1.3';
  return {
    command: process.env.MUSE_BIN || 'muse',
    args: ['exec', '--json', '--no-session-log', '--workspace', config.workingDirectory, '--model', model, 'Hi'],
    cwd: config.workingDirectory,
    model,
  };
}

/**
 * Meta-kind connection test: run a minimal headless `muse exec` turn.
 * The exec child authenticates with the host's own `muse auth`
 * credentials, so this exercises binary presence, auth, and model access
 * in one call (see buildMuseTestArgs for the cost note).
 */
async function testMetaConnection(config, deps = {}) {
  let spec;
  try {
    spec = buildMuseTestArgs(config);
  } catch (error) {
    return failureResponse(error);
  }
  try {
    const timeoutMs = config.apiTimeoutMs || 30000;
    const spawnMuseProcess = deps.spawnMuseProcess || defaultMuseTestSpawn;
    const child = spawnMuseProcess({
      command: spec.command,
      args: spec.args,
      cwd: spec.cwd,
      env: process.env,
    });

    return await new Promise((resolve) => {
      let stderr = '';
      let killed = false;
      // FR-4 doctrine applies to the probe too: process exit alone is not
      // success. The probe requires the validated success terminal record,
      // which `muse exec --json` emits even with `--no-session-log`.
      const protocol = createMuseExecProtocol();
      let terminal = null;
      let outputValid = true;

      const timer = setTimeout(() => {
        killed = true;
        killMuseTestProcess(child, deps.killProcessGroup);
        resolve(failureResponse(new Error(`Muse CLI timed out after ${timeoutMs}ms`)));
      }, timeoutMs);

      child.stdout?.on('data', (d) => {
        if (!outputValid) return;
        try {
          for (const item of protocol.push(d)) {
            if (item?.kind === 'terminal') terminal = item;
          }
        } catch {
          outputValid = false;
        }
      });
      // Stderr is diagnostic-only and bounded (16 KiB, shared with the
      // summary client) so a chatty child cannot grow memory without limit.
      child.stderr?.on('data', (d) => { stderr = appendBoundedDiagnostic(stderr, d); });
      child.on('error', (error) => {
        clearTimeout(timer);
        if (killed) return;
        if (error.code === 'ENOENT') {
          resolve(failureResponse(new Error('Muse CLI not found. Install Muse Code and ensure `muse` is on PATH (or set MUSE_BIN).')));
        } else {
          resolve(failureResponse(error));
        }
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (killed) return;
        if (code === 0) {
          if (outputValid && terminal?.outcome === 'completed' && terminal.text) {
            resolve(connectionSuccess({ model: spec.model }));
          } else {
            resolve(failureResponse(new Error(describeMissingTerminal(terminal))));
          }
        } else {
          resolve(failureResponse(new Error(stderr.trim() || `Muse CLI exited with code ${code}`)));
        }
      });
    });
  } catch (error) {
    return failureResponse(error);
  }
}

/**
 * Actionable message for a clean probe exit with no usable terminal record.
 * A non-completed terminal carries its own reason; anything else means the
 * CLI never produced the validated success the probe requires.
 */
function describeMissingTerminal(terminal) {
  if (terminal && terminal.outcome !== 'completed') {
    return `Muse CLI reported ${terminal.outcome}${terminal.reason ? `: ${terminal.reason}` : ''}.`;
  }
  return 'Muse CLI exited without a validated terminal result.';
}

function connectionSuccess(details) {
  return {
    success: true,
    message: 'Connection successful',
    details,
  };
}

function failureResponse(error) {
  return {
    success: false,
    message: getErrorMessage(error),
    details: { code: error.status || error.code, type: error.type || error.name },
  };
}

/**
 * Extract a representative model ID from whatever shape `models.list()` returns.
 * @private
 */
function pickFirstModel(listResult) {
  if (!listResult) return null;
  // Newer SDKs expose .data; older ones are plain arrays / async iterables.
  const data = Array.isArray(listResult) ? listResult : listResult.data;
  if (Array.isArray(data) && data.length > 0) {
    const entry = data[0];
    return entry?.id || entry?.model || null;
  }
  return null;
}

/**
 * Get a human-readable error message from an error object
 * @param {Error} error - The error object
 * @returns {string} - Human-readable error message
 * @private
 */
function getErrorMessage(error) {
  if (error.status === 401) {
    return 'Authentication failed. Check your auth token.';
  }
  if (error.status === 404) {
    return 'Model not found. Check the model ID.';
  }
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    return 'Could not connect to server. Check the base URL.';
  }
  if (error.code === 'ETIMEDOUT') {
    return 'Connection timed out. Try increasing the timeout.';
  }
  return error.message || 'Unknown error occurred';
}
