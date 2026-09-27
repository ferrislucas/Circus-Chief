import { execFile, spawn } from 'node:child_process';
import readline from 'node:readline';
import { mapCodexRateLimits } from '../agents/adapters/codexRolloutAllowanceExtractor.js';
import { getAccountRefreshMs, getStreamStaleAfterMs, isCodexAppServerAllowanceSourceEnabled } from '../config/providerAllowances.js';
import { buildCodexMeterEnv, checkCodexVersionSupported, CLIENT_INFO, logCodexMeterOutcome, resolveCodexAllowanceProvider } from './codexAppServerMeterSupport.js';

export { buildCodexMeterEnv, parseCodexMinorVersion, resolveCodexAllowanceProvider } from './codexAppServerMeterSupport.js';

/** Global ChatGPT-plan usage meter backed by `codex app-server`.
 * A single app-server process speaks line-delimited JSON-RPC over stdio and
 * reports account-level rate limits for ChatGPT-plan auth — the only Codex mechanism that keeps indicators current with no active session (FRD AC 18).
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
const MAX_CONSECUTIVE_FAILURES = 5;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
// Independent account snapshots have no session traffic to keep them fresh.
// The refresh cadence derives from the source freshness window (see
// getAccountRefreshMs) while retaining one timer.

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
    this.refreshTimer = null;
    this.readPromise = null;
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
      logCodexMeterOutcome({ source: LOG_SOURCE, outcome: 'version-unsupported' });
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
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.rejectPendingReads();
    this.killProcess();
  }

  async isCodexVersionSupported() {
    return checkCodexVersionSupported(this.execFileAsync);
  }

  spawnMeter() {
    if (this.state === 'stopped' || this.state === 'disabled') return;
    if (!this.#resolveProvider()) {
      this.#scheduleProviderRecheck();
      return;
    }
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
        logCodexMeterOutcome({ source: LOG_SOURCE, outcome: reason === 'rpc-error' ? 'initialize-error' : 'initialize-timeout' });
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
    if (this.readPromise) return this.readPromise;
    this.readPromise = this.#readRateLimits();
    try {
      return await this.readPromise;
    } finally {
      this.readPromise = null;
    }
  }

  async #readRateLimits() {
    if (!this.#isAlive()) return;
    const provider = this.#resolveProvider();
    if (!provider) {
      this.#scheduleRefresh();
      return;
    }
    const { delivered, result, reason } = await this.request(READ_METHOD);
    if (!delivered) {
      // The app-server never answered, or answered with a JSON-RPC error:
      // route the failed process through the same kill + backoff + breaker
      // path as a crash instead of waiting indefinitely or publishing a
      // false "no data" success.
      if (this.state === 'running') {
        logCodexMeterOutcome({ source: LOG_SOURCE, outcome: reason === 'rpc-error' ? 'read-error' : 'read-timeout' });
        this.onProcessFailure();
      }
      return;
    }
    const candidate = mapCodexRateLimits(result?.rateLimits, { observedAt: this.clock.now(), streamStaleMs: getStreamStaleAfterMs() });
    if (!candidate) {
      logCodexMeterOutcome({ source: LOG_SOURCE, outcome: 'no-data' });
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
    logCodexMeterOutcome({ source: LOG_SOURCE, outcome: 'ok' });
    this.#scheduleRefresh();
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
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.killProcess();
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.state = 'disabled';
      logCodexMeterOutcome({ source: LOG_SOURCE, outcome: 'disabled-after-repeated-failures' });
      return;
    }
    this.state = 'starting';
    this.#scheduleRestart();
    logCodexMeterOutcome({ source: LOG_SOURCE, outcome: 'restart-scheduled', attempt: this.consecutiveFailures });
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

  #scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.readRateLimits().catch(() => {});
    }, getAccountRefreshMs());
    this.refreshTimer.unref?.();
  }

  /**
   * Re-resolve the eligible provider on every use so rotations, disables,
   * and removals apply without a restart. Null (logged) when none is
   * eligible: callers stand down instead of running with stale credentials.
   */
  #resolveProvider() {
    const provider = resolveCodexAllowanceProvider(this.modelProviders);
    if (!provider) {
      logCodexMeterOutcome({ source: LOG_SOURCE, outcome: 'no-provider' });
      return null;
    }
    this.provider = provider;
    return provider;
  }

  /**
   * Recheck for a returned provider after standing down. Shares the restart
   * timer slot and never touches the breaker, at the slowest backoff so an
   * idle disabled state costs one lookup a minute and zero spawns.
   */
  #scheduleProviderRecheck() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnMeter();
    }, MAX_BACKOFF_MS);
    this.restartTimer.unref?.();
  }
}

export {
  startCodexAppServerMeter,
  stopCodexAppServerMeter,
  isCodexAppServerMeterHealthy,
  _setActiveCodexAppServerMeterForTests,
} from './codexAppServerMeterInstance.js';
