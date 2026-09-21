import { execFile, spawn } from 'node:child_process';
import readline from 'node:readline';
import { mapCodexRateLimits } from '../agents/adapters/codexRolloutAllowanceExtractor.js';
import { isCodexAppServerAllowanceSourceEnabled } from '../config/providerAllowances.js';

/**
 * Global ChatGPT-plan usage meter backed by `codex app-server`.
 *
 * A single app-server process speaks line-delimited JSON-RPC over stdio and
 * reports account-level rate limits for ChatGPT-plan auth — the only Codex
 * mechanism that keeps indicators current with no active session (FRD AC 18).
 * On start it issues `account/rateLimits/read`; `account/rateLimits/updated`
 * push notifications trigger a fresh read so only the documented response
 * shape is depended on.
 *
 * Raw JSON-RPC frames are never logged — only parsed, mapped fields and
 * outcome counters (plan §9.3). Repeated failures disable the meter; the
 * rollout tail remains as the per-session fallback and indicators are
 * unaffected (FR-7).
 */

const READ_METHOD = 'account/rateLimits/read';
const UPDATED_NOTIFICATION = 'account/rateLimits/updated';
const LOG_SOURCE = 'codex-app-server';
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
  }

  get healthy() {
    return this.state === 'running' && this.process !== null;
  }

  async start() {
    if (this.state !== 'stopped') return;
    if (!isCodexAppServerAllowanceSourceEnabled()) return;
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
      child = this.spawnProcess('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      this.onSpawnFailure();
      return;
    }
    this.process = child;
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
    this.readRateLimits();
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
      resolve(frame.result ?? null);
    }
  }

  async readRateLimits() {
    if (!this.healthy) return;
    const result = await this.request(READ_METHOD);
    if (!result) return;
    const candidate = mapCodexRateLimits(result.rateLimits, { observedAt: this.clock.now() });
    if (!candidate) {
      logOutcome({ source: LOG_SOURCE, outcome: 'no-data' });
      return;
    }
    // A mapped snapshot proves the meter is delivering, so the failure
    // streak that guards the disable circuit breaker ends here.
    this.consecutiveFailures = 0;
    this.lastSnapshot = candidate;
    const observer = this.getObserver?.();
    if (!observer) return;
    for (const providerId of this.eligibleProviderIds()) {
      try {
        observer({ ...candidate, providerId });
      } catch {
        // Allowance telemetry is non-critical (FR-7).
      }
    }
    logOutcome({ source: LOG_SOURCE, outcome: 'ok' });
  }

  /**
   * The app-server meter reads the CLI account's limits (~/.codex auth), so
   * its observations apply to every enabled openai-kind provider that relies
   * on ChatGPT-plan auth: no stored authToken and no API key override.
   */
  eligibleProviderIds() {
    const providers = this.modelProviders?.getEnabledForAllowances?.() ?? [];
    return providers
      .filter((provider) => provider.kind === 'openai'
        && !provider.authToken
        && !provider.additionalEnvVars?.OPENAI_API_KEY)
      .map((provider) => provider.id);
  }

  request(method) {
    if (!this.healthy) return Promise.resolve(null);
    const id = this.nextRequestId++;
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params: {} });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingReads.delete(id);
        resolve(null);
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pendingReads.set(id, { resolve, timer });
      try {
        this.process.stdin.write(`${frame}\n`);
      } catch {
        clearTimeout(timer);
        this.pendingReads.delete(id);
        resolve(null);
      }
    });
  }

  rejectPendingReads() {
    for (const { resolve, timer } of this.pendingReads.values()) {
      clearTimeout(timer);
      resolve(null);
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
