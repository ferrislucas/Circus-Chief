import { execFile, spawn } from 'node:child_process';
import readline from 'node:readline';
import { mapCodexRateLimits } from '../agents/adapters/codexRolloutAllowanceExtractor.js';
import { getStreamStaleAfterMs, isCodexAppServerAllowanceSourceEnabled } from '../config/providerAllowances.js';

/**
 * Global ChatGPT-plan usage meter backed by `codex app-server`.
 *
 * A single app-server process speaks line-delimited JSON-RPC over stdio and
 * reports account-level rate limits for ChatGPT-plan auth — the only Codex
 * mechanism that keeps indicators current with no active session (FRD AC 18).
 * Each spawned process first completes the required initialize handshake
 * (initialize → initialization response → `initialized` notification) before
 * issuing `account/rateLimits/read`; codex-cli 0.145.0 silently drops
 * requests sent before initialization. `account/rateLimits/updated` push
 * notifications trigger a fresh read, and a JSON-RPC error object resolves
 * as a protocol failure — never as a successful null read.
 *
 * Health means delivering, not merely alive: `healthy` requires a mapped
 * delivery inside the stream freshness window. An unresponsive read or
 * failed handshake is treated as a process failure (kill + backoff +
 * breaker), so a hung app-server can never silently starve the indicators.
 *
 * Raw JSON-RPC frames are never logged — only parsed, mapped fields and
 * outcome counters (plan §9.3). Repeated failures disable the meter; the
 * rollout tail remains as the per-session fallback and indicators are
 * unaffected (FR-7).
 */

const INITIALIZE_METHOD = 'initialize';
const INITIALIZED_NOTIFICATION = 'initialized';
const READ_METHOD = 'account/rateLimits/read';
const UPDATED_NOTIFICATION = 'account/rateLimits/updated';
const LOG_SOURCE = 'codex-app-server';
// Client metadata for the app-server handshake: a stable, credential-free
// identifier (the protocol requires initialization before any other request;
// codex-cli 0.145.0 silently drops requests sent before it).
const CLIENT_INFO = Object.freeze({
  name: 'circuschief-allowance-meter',
  title: 'Circus Chief',
  version: '1.0.0',
});
// app-server (and the account rate-limit API) ships in codex-cli 0.145.0+.
const MIN_SUPPORTED_MINOR = 145;
const MAX_CONSECUTIVE_FAILURES = 5;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const VERSION_CHECK_TIMEOUT_MS = 5_000;

export class CodexAppServerMeter {
  /**
   * @param {Object} [options]
   * @param {Function} [options.getObserver] - Returns the bound allowance
   *   observer (or null when the master gate is off).
   * @param {Object} [options.modelProviders] - Provider repository.
   * @param {Object} [options.clock] - Clock DI ({ now }).
   * @param {Function} [options.spawnProcess] - Spawn DI (node child_process.spawn shape).
   * @param {Function} [options.execFileAsync] - Version-check DI.
   * @param {number} [options.requestTimeoutMs]
   */
  constructor({
    getObserver = null,
    modelProviders = null,
    clock = Date,
    spawnProcess = spawn,
    execFileAsync = execFile,
    requestTimeoutMs = 10_000,
  } = {}) {
    this.getObserver = getObserver;
    this.modelProviders = modelProviders;
    this.clock = clock;
    this.spawnProcess = spawnProcess;
    this.execFileAsync = execFileAsync;
    this.requestTimeoutMs = requestTimeoutMs;
    this.process = null;
    this.rl = null;
    this.state = 'stopped'; // stopped | starting | running | disabled
    this.nextRequestId = 1;
    this.pendingReads = new Map();
    this.consecutiveFailures = 0;
    this.restartTimer = null;
    this.lastSnapshot = null;
    this.lastDeliveredAt = null;
    this.provider = null;
  }

  // Aliveness only: guards issuing reads. Distinct from `healthy`, which
  // additionally requires proof of delivery — a process that is alive but
  // quiet must still be able to issue reads so a push notification can prove
  // it responsive again.
  #isAlive() {
    return this.state === 'running' && this.process !== null;
  }

  /**
   * Healthy means the meter is not merely alive but *delivering*: it has
   * mapped at least one account read from the current process inside the
   * stream freshness window. Before first delivery — and after the window
   * lapses — the per-session rollout tail runs as well; redundant
   * last-write-wins writes of the same account data are harmless and
   * per-provider independence (FR-2) is preserved.
   */
  get healthy() {
    return this.#isAlive()
      && this.lastDeliveredAt !== null
      && this.clock.now() - this.lastDeliveredAt <= getStreamStaleAfterMs();
  }

  async start() {
    if (this.state !== 'stopped') return;
    if (!isCodexAppServerAllowanceSourceEnabled()) return;
    this.provider = resolveCodexAllowanceProvider(this.modelProviders);
    if (!this.provider) return;
    this.state = 'starting';
    const supported = await this.isCodexVersionSupported();
    if (!supported) {
      this.state = 'stopped';
      logOutcome({ source: LOG_SOURCE, outcome: 'version-unsupported' });
      return;
    }
    this.spawnMeter();
  }

  async stop() {
    this.state = 'stopped';
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.rejectPendingReads();
    this.killProcess();
  }

  async isCodexVersionSupported() {
    try {
      const stdout = await this.exec(this.execFileAsync, 'codex', ['--version']);
      return parseCodexMinorVersion(stdout) >= MIN_SUPPORTED_MINOR;
    } catch {
      return false;
    }
  }

  exec(execFn, ...args) {
    return new Promise((resolve, reject) => {
      execFn(...args, { timeout: VERSION_CHECK_TIMEOUT_MS }, (error, stdout) => {
        if (error) reject(error);
        else resolve(String(stdout));
      });
    });
  }

  spawnMeter() {
    if (this.state === 'stopped' || this.state === 'disabled') return;
    let child;
    try {
      child = this.spawnProcess('codex', ['app-server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: buildCodexMeterEnv(this.provider),
      });
    } catch {
      this.onSpawnFailure();
      return;
    }
    this.process = child;
    // A fresh process starts undelivered: the rollout tail stays active as
    // the fallback until this process proves it can map an account read.
    this.lastDeliveredAt = null;
    let failed = false;
    const failOnce = () => {
      if (failed) return;
      failed = true;
      this.onProcessFailure();
    };
    child.on('error', failOnce);
    child.on('exit', () => {
      const wasCurrent = this.process === child;
      if (wasCurrent) failOnce();
    });

    this.rl = readline.createInterface({ input: child.stdout });
    this.rl.on('line', (line) => this.handleFrame(line));
    // The meter's stderr is diagnostic output from the CLI; it is drained and
    // discarded so the child never blocks, and never logged (FR-8).
    child.stderr?.resume?.();

    this.state = 'running';
    this.#runSession();
  }

  /**
   * One process generation: complete the initialize handshake — the
   * app-server answers no request sent before it — then issue the first
   * account read. Handshake timeout or a JSON-RPC error routes through the
   * same kill + backoff + breaker path as a crash, and no read is issued on
   * a session the server never accepted.
   */
  async #runSession() {
    const child = this.process;
    const { delivered, reason } = await this.request(INITIALIZE_METHOD, { clientInfo: CLIENT_INFO });
    if (!delivered) {
      if (this.state === 'running') {
        logOutcome({ source: LOG_SOURCE, outcome: reason === 'rpc-error' ? 'initialize-error' : 'initialize-timeout' });
        this.onProcessFailure();
      }
      return;
    }
    if (this.process !== child) return; // stop() or a failure retired this generation
    this.notify(INITIALIZED_NOTIFICATION);
    await this.readRateLimits();
  }

  handleFrame(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let frame;
    try {
      frame = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (frame?.method === UPDATED_NOTIFICATION) {
      this.readRateLimits();
      return;
    }
    if (frame?.id !== undefined && this.pendingReads.has(frame.id)) {
      const { resolve, timer } = this.pendingReads.get(frame.id);
      clearTimeout(timer);
      this.pendingReads.delete(frame.id);
      // A JSON-RPC error object is an answer, but never a successful one:
      // it resolves undelivered so callers treat it as a protocol failure
      // instead of a null-success read.
      if (frame.error !== undefined && frame.error !== null) {
        resolve({ delivered: false, result: null, reason: 'rpc-error' });
        return;
      }
      resolve({ delivered: true, result: frame.result ?? null, reason: null });
    }
  }

  async readRateLimits() {
    if (!this.#isAlive()) return;
    const { delivered, result, reason } = await this.request(READ_METHOD);
    if (!delivered) {
      // The app-server never answered, or answered with a JSON-RPC error:
      // route the failed process through the same kill + backoff + breaker
      // path as a crash instead of waiting indefinitely or publishing a
      // false "no data" success.
      if (this.state === 'running') {
        logOutcome({ source: LOG_SOURCE, outcome: reason === 'rpc-error' ? 'read-error' : 'read-timeout' });
        this.onProcessFailure();
      }
      return;
    }
    const candidate = mapCodexRateLimits(result?.rateLimits, { observedAt: this.clock.now() });
    if (!candidate) {
      logOutcome({ source: LOG_SOURCE, outcome: 'no-data' });
      return;
    }
    // A mapped snapshot proves the meter is delivering, so the failure
    // streak that guards the disable circuit breaker ends here and the
    // delivery-recency window that gates `healthy` restarts.
    this.consecutiveFailures = 0;
    this.lastDeliveredAt = this.clock.now();
    this.lastSnapshot = candidate;
    const observer = this.getObserver?.();
    if (!observer) return;
    try {
      observer({ ...candidate, providerId: this.provider.id });
    } catch {
      // Allowance telemetry is non-critical (FR-7).
    }
    logOutcome({ source: LOG_SOURCE, outcome: 'ok' });
  }

  /**
   * Issues one JSON-RPC request and resolves a discriminated outcome:
   * `{ delivered: true, result, reason: null }` when the app-server answered
   * successfully, and `{ delivered: false, result: null, reason }` with
   * reason `'timeout'`, `'write-failed'`, `'aborted'` (stop/shutdown), or
   * `'rpc-error'` (the server answered with a JSON-RPC error object) — so
   * callers can distinguish "no data" from "no answer".
   */
  request(method, params = {}) {
    if (!this.#isAlive()) return Promise.resolve({ delivered: false, result: null, reason: 'aborted' });
    const id = this.nextRequestId++;
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingReads.delete(id);
        resolve({ delivered: false, result: null, reason: 'timeout' });
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pendingReads.set(id, { resolve, timer });
      try {
        this.process.stdin.write(`${frame}\n`);
      } catch {
        clearTimeout(timer);
        this.pendingReads.delete(id);
        resolve({ delivered: false, result: null, reason: 'write-failed' });
      }
    });
  }

  /**
   * Sends one JSON-RPC notification (no id, no response expected). Write
   * failures are ignored here — a dead stdin surfaces through the child's
   * error/exit handlers.
   */
  notify(method, params = {}) {
    if (!this.#isAlive()) return;
    try {
      this.process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    } catch { /* handled by the failure path */ }
  }

  rejectPendingReads() {
    for (const { resolve, timer } of this.pendingReads.values()) {
      clearTimeout(timer);
      resolve({ delivered: false, result: null, reason: 'aborted' });
    }
    this.pendingReads.clear();
  }

  killProcess() {
    if (this.rl) {
      try { this.rl.close(); } catch { /* ignore */ }
      this.rl = null;
    }
    const child = this.process;
    this.process = null;
    if (!child) return;
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  }

  onSpawnFailure() {
    this.onProcessFailure();
  }

  onProcessFailure() {
    if (this.state === 'stopped' || this.state === 'disabled') return;
    this.rejectPendingReads();
    this.killProcess();
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.state = 'disabled';
      logOutcome({ source: LOG_SOURCE, outcome: 'disabled-after-repeated-failures' });
      return;
    }
    this.state = 'starting';
    this.#scheduleRestart();
    logOutcome({ source: LOG_SOURCE, outcome: 'restart-scheduled', attempt: this.consecutiveFailures });
  }

  #scheduleRestart() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (this.consecutiveFailures - 1), MAX_BACKOFF_MS);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnMeter();
    }, backoff);
    this.restartTimer.unref?.();
  }
}

export function parseCodexMinorVersion(versionOutput) {
  const match = String(versionOutput).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return -1;
  return Number(match[1]) * 1000 + Number(match[2]);
}

/**
 * An app-server account read belongs to exactly one configured Codex auth
 * context. Custom OpenAI-compatible endpoints never qualify, even when they
 * have no API key, because their account cannot be inferred from the host
 * Codex login.
 */
export function resolveCodexAllowanceProvider(modelProviders) {
  const providers = modelProviders?.getEnabledForAllowances?.() ?? [];
  return providers.find((provider) => provider?.isBuiltIn === true && provider.kind === 'openai') ?? null;
}

/**
 * Mirror the relevant provider execution context while retaining the process
 * environment needed to locate the Codex executable. This environment is
 * process-local only; it is never normalized, logged, or sent to the client.
 */
export function buildCodexMeterEnv(provider, inheritedEnv = process.env) {
  const env = { ...inheritedEnv };
  if (provider?.baseUrl) env.OPENAI_BASE_URL = provider.baseUrl;
  if (provider?.authToken) env.OPENAI_API_KEY = provider.authToken;
  if (provider?.additionalEnvVars && typeof provider.additionalEnvVars === 'object') {
    Object.assign(env, provider.additionalEnvVars);
  }
  return env;
}

// --- Server lifecycle singleton ---------------------------------------------

let activeMeter = null;

/**
 * Start the global meter. No-ops unless the app-server source gate is on
 * (which includes the master gate). While a healthy meter is active it takes
 * precedence over the per-session rollout tail (plan §7.2).
 */
export async function startCodexAppServerMeter({ modelProviders, getObserver } = {}) {
  stopCodexAppServerMeter();
  if (!isCodexAppServerAllowanceSourceEnabled()) return null;
  activeMeter = new CodexAppServerMeter({ modelProviders, getObserver });
  await activeMeter.start();
  return activeMeter;
}

export function stopCodexAppServerMeter() {
  if (!activeMeter) return;
  const meter = activeMeter;
  activeMeter = null;
  meter.stop();
}

/**
 * Precedence signal for the per-session rollout tail: while the meter is
 * running it is the single writer for ChatGPT-plan providers.
 */
export function isCodexAppServerMeterHealthy() {
  return activeMeter?.healthy === true;
}

/**
 * Test-only: install a meter instance as the active singleton.
 * @private
 */
export function _setActiveCodexAppServerMeterForTests(meter) {
  activeMeter = meter;
}

// Structured, credential-free diagnostics (plan §9.4).
function logOutcome(entry) {
  console.log('[CodexAppServerMeter]', JSON.stringify(entry));
}
