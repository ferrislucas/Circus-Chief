import { appendFileSync } from 'fs';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import {
  consumeScriptedOutcome,
  OUTCOME_MESSAGES,
  FAILOVER_ELIGIBLE_OUTCOME_TYPES,
  TERMINAL_ERROR_OUTCOME_TYPES,
} from './e2eSpawnOutcomes.js';
import { writeCapturedAgentEvents, writePartialAgentOutput } from './e2eSpawnEvents.js';

export { consumeScriptedOutcome } from './e2eSpawnOutcomes.js';

// Env vars threaded through the session's spawn `env` (see
// sessionExecution.js#buildAgentEnv / sessionContinuation.js) purely so this
// E2E-only seam can recover which (provider, model, session) a given spawn
// attempt belongs to — never read outside of E2E spawn-capture mode.
const E2E_PROVIDER_ENV_KEY = 'CIRCUSCHIEF_E2E_PROVIDER_ID';
const E2E_SESSION_ENV_KEY = 'CIRCUSCHIEF_E2E_SESSION_ID';

let captureSequence = 0;

export function isE2ESpawnCaptureEnabled() {
  return Boolean(process.env.E2E_AGENT_SPAWN_CAPTURE_FILE);
}

/** Test-only: reset the monotonic capture sequence counter between test cases. */
export function resetE2ESpawnCaptureSequence() {
  captureSequence = 0;
}

function providerIdFromSpawnOptions(spawnOptions) {
  return spawnOptions?.env?.[E2E_PROVIDER_ENV_KEY] || null;
}

function sessionIdFromSpawnOptions(spawnOptions) {
  return spawnOptions?.env?.[E2E_SESSION_ENV_KEY] || null;
}

function modelIdFromSpawnOptions(agentType, spawnOptions) {
  const args = spawnOptions?.args || [];
  const flag = agentType === 'claude-code' ? '--model' : '-m';
  return valueAfter(args, flag);
}

export function captureSpawnAttempt(agentType, spawnOptions) {
  const filePath = process.env.E2E_AGENT_SPAWN_CAPTURE_FILE;
  if (!filePath) return;

  captureSequence += 1;

  const record = {
    sequence: captureSequence,
    agentType,
    command: spawnOptions.command,
    args: sanitizeSpawnArgs(agentType, spawnOptions.args || []),
    cwd: spawnOptions.cwd || null,
    env: summarizeSpawnEnv(spawnOptions.env),
    options: summarizeSpawnOptions(agentType, spawnOptions),
    // Resolved identity of this attempt (Phase 1 — see
    // model-tiers-e2e-coverage-plan.md): lets E2E assertions observe
    // duplicate model IDs across providers and cross-provider routing
    // without guessing from CLI args alone.
    providerId: providerIdFromSpawnOptions(spawnOptions),
    modelId: modelIdFromSpawnOptions(agentType, spawnOptions),
    sessionId: sessionIdFromSpawnOptions(spawnOptions),
    capturedAt: new Date().toISOString(),
  };

  appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

function createProcessStub() {
  const processStub = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  processStub.stdin = stdin;
  processStub.stdout = stdout;
  processStub.stderr = stderr;
  processStub.killed = false;
  processStub.exitCode = null;
  processStub.kill = (signal = 'SIGTERM') => {
    if (processStub.killed || processStub.exitCode !== null) return true;
    processStub.killed = true;
    finishProcess({ processStub, stdout, stderr, code: null, signal });
    return true;
  };

  return { processStub, stdin, stdout, stderr };
}

/**
 * Schedule a scripted failure (quota / rate-limit / service-outage / auth /
 * bad-request) after `outcome.delayMs`. See {@link failCapturedProcess}.
 */
function scheduleErrorOutcome(outcome, { processStub, stdout, stderr }) {
  const message = outcome.message || OUTCOME_MESSAGES[outcome.type];
  const delayMs = outcome.delayMs ?? 15;
  setTimeout(() => {
    if (processStub.killed || processStub.exitCode !== null) return;
    failCapturedProcess({ processStub, stdout, stderr, message });
  }, delayMs);
}

/**
 * Schedule the 'output_then_error' outcome: partial assistant output, then a
 * scripted failure after `outcome.failDelayMs`.
 */
function scheduleOutputThenErrorOutcome(agentType, outcome, { processStub, stdout, stderr }) {
  const message = outcome.message || OUTCOME_MESSAGES.service_unavailable;
  const outputDelayMs = outcome.delayMs ?? 15;
  const failDelayMs = outcome.failDelayMs ?? 50;
  setTimeout(() => {
    if (processStub.killed || processStub.exitCode !== null) return;
    writePartialAgentOutput(agentType, stdout);
    setTimeout(() => failCapturedProcess({ processStub, stdout, stderr, message }), failDelayMs);
  }, outputDelayMs);
}

/** Schedule a 'success' / 'delayed_success' completion. */
function scheduleSuccessOutcome(agentType, outcome, { processStub, stdin, stdout, stderr }) {
  const scriptedDelayMs = outcome.type === 'delayed_success' ? (outcome.delayMs ?? 300) : 0;
  const runComplete = () => {
    if (processStub.killed || processStub.exitCode !== null) return;
    writeCapturedAgentEvents(agentType, stdout);
    finishProcess({ processStub, stdout, stderr, code: 0, signal: null });
  };
  const complete = () => setTimeout(runComplete, scriptedDelayMs);

  if (agentType === 'claude-code' || agentType === 'gemini') {
    // Claude Code and Gemini don't pass prompts via stdin (they use CLI args).
    // Complete after a short delay to simulate process execution.
    setTimeout(complete, 10);
  } else {
    // Codex passes the prompt via stdin; complete when stdin is closed.
    stdin.once('finish', complete);
  }
}

export function createCapturedSpawnProcess(agentType, spawnOptions = {}) {
  const providerId = providerIdFromSpawnOptions(spawnOptions);
  const modelId = modelIdFromSpawnOptions(agentType, spawnOptions);
  const outcome = consumeScriptedOutcome(providerId, modelId);
  const ctx = createProcessStub();

  // 'cancelled' — the scripted process never completes on its own; it only
  // responds to an explicit kill() (mirrors a real hung/long-running CLI so
  // tests can exercise the app's own cancel-session action deterministically).
  if (outcome.type === 'cancelled') {
    return ctx.processStub;
  }

  if (FAILOVER_ELIGIBLE_OUTCOME_TYPES.has(outcome.type) || TERMINAL_ERROR_OUTCOME_TYPES.has(outcome.type)) {
    scheduleErrorOutcome(outcome, ctx);
  } else if (outcome.type === 'output_then_error') {
    scheduleOutputThenErrorOutcome(agentType, outcome, ctx);
  } else {
    scheduleSuccessOutcome(agentType, outcome, ctx);
  }

  return ctx.processStub;
}

/**
 * Deliver a scripted failure to the captured process. A single `error`
 * emission works uniformly across all three CLI runners:
 *  - the Claude Agent SDK's ProcessTransport listens for `error` on the
 *    process it was given via `spawnClaudeCodeProcess` and sets its internal
 *    exitError from `error.message` (prefixed with "Failed to spawn Claude
 *    Code process: ", which still contains our scripted substrings for
 *    pattern matching in sessionErrors.js);
 *  - the Codex/Gemini CLI runners' `child.on('error', ...)` handler calls
 *    `state.failWith(error)` directly, using our message unmodified.
 * `.code` is intentionally left unset on the Error so neither runner mistakes
 * this for an ENOENT-style "CLI not installed" condition.
 *
 * Exits with code=null/signal=null: a no-op for the claude-code SDK's exit
 * handler (`getProcessExitError` only overwrites `exitError` for a non-null
 * code or a truthy signal), so it can never clobber the exitError set by the
 * `error` emission above; for Codex/Gemini, `handleChildExit` is guarded by
 * `!state.error`, which is already set by the time this runs.
 */
function failCapturedProcess({ processStub, stdout, stderr, message }) {
  const error = new Error(message);
  processStub.emit('error', error);
  stderr.write(`${message}\n`);
  finishProcess({ processStub, stdout, stderr, code: null, signal: null });
}

function sanitizeSpawnArgs(agentType, args) {
  if (agentType !== 'claude-code') return args;
  const sanitized = [...args];
  for (let index = 0; index < sanitized.length; index += 1) {
    if (sanitized[index] === '--mcp-config' && sanitized[index + 1] !== undefined) {
      sanitized[index + 1] = '[redacted]';
    }
  }
  return sanitized;
}

function summarizeSpawnEnv(env = {}) {
  const summary = {};
  if (Object.prototype.hasOwnProperty.call(env, 'CIRCUSCHIEF_COMMIT_ATTRIBUTION')) {
    summary.CIRCUSCHIEF_COMMIT_ATTRIBUTION = env.CIRCUSCHIEF_COMMIT_ATTRIBUTION;
  }
  if (Object.prototype.hasOwnProperty.call(env, 'GEMINI_CLI_TRUST_WORKSPACE')) {
    summary.GEMINI_CLI_TRUST_WORKSPACE = env.GEMINI_CLI_TRUST_WORKSPACE;
  }
  if (Object.keys(summary).length === 0) return {};
  return summary;
}

function summarizeSpawnOptions(agentType, spawnOptions) {
  const args = spawnOptions.args || [];
  if (agentType === 'claude-code') {
    return {
      model: valueAfter(args, '--model'),
      settings: valueAfter(args, '--settings'),
      permissionMode: valueAfter(args, '--permission-mode'),
      settingSources: valueAfter(args, '--setting-sources'),
      mcpServers: summarizeMcpConfig(valueAfter(args, '--mcp-config')),
    };
  }

  if (agentType === 'gemini') {
    return {
      model: valueAfter(args, '-m'),
      outputFormat: valueAfter(args, '--output-format'),
      approvalMode: optionValue(args, '--approval-mode'),
      prompt: valueAfter(args, '-p'),
    };
  }

  return {
    model: valueAfter(args, '-m'),
    sandbox: valueAfter(args, '--sandbox'),
    config: valuesAfter(args, '-c'),
  };
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function optionValue(args, flag) {
  const separateValue = valueAfter(args, flag);
  if (separateValue !== null) return separateValue;
  const prefix = `${flag}=`;
  const arg = args.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function valuesAfter(args, flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1] !== undefined) {
      values.push(args[index + 1]);
    }
  }
  return values;
}

function summarizeMcpConfig(rawConfig) {
  if (!rawConfig) return [];
  try {
    const parsed = JSON.parse(rawConfig);
    const servers = parsed?.mcpServers;
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
    return Object.entries(servers).map(([name, config]) => ({
      name,
      transport: summarizeMcpTransport(config),
    }));
  } catch {
    return [];
  }
}

function summarizeMcpTransport(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return 'unknown';
  if (config.type === 'sse' || config.type === 'http') return config.type;
  if (config.type === 'stdio' || config.type === undefined) return 'stdio';
  return String(config.type);
}

function finishProcess({ processStub, stdout, stderr, code, signal }) {
  Object.assign(processStub, { exitCode: code });
  stdout.end();
  stderr.end();
  setImmediate(() => {
    processStub.emit('exit', code, signal);
    processStub.emit('close', code, signal);
  });
}
