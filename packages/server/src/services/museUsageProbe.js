import { spawn } from 'node:child_process';
import readline from 'node:readline';
import {
  MUSE_PROBE_CLIENT_INFO,
  MUSE_PROBE_PROVIDER,
  ProbeRpc,
  ProbeTurnWait,
  buildMuseProbeArgs,
  logMuseProbeOutcome,
  newMuseProbeCommandId,
  observeProbeUsage,
  resolveMuseAllowanceProvider,
  resolveMuseProbeModel,
  runProbeTurn,
  teardownProbeChild,
} from './museUsageProbeSupport.js';

export {
  buildMuseProbeArgs,
  logMuseProbeOutcome,
  resolveMuseAllowanceProvider,
  resolveMuseProbeModel,
} from './museUsageProbeSupport.js';

/**
 * Probe micro-turns feeding the built-in `Meta (Official)` allowance
 * indicator. A short-lived `muse serve` process serves exactly one minimal
 * turn; the resulting `usage/changed` (falling back to `usage/read`) is
 * mapped to an allowance candidate and observed into
 * `ProviderAllowanceService`. The agent execution path (`muse exec` per
 * turn) is untouched.
 *
 * Failure is non-critical and silent to users: any step failing resolves to
 * "no data" (the previous snapshot ages into `stale`), never interrupts a
 * session, and never throws into the turn path. Raw JSON-RPC frames,
 * prompts, tier ids, and auth material are never logged — outcomes are
 * counters only, following the Codex meter's structured-outcome convention.
 */

const MAX_CONSECUTIVE_FAILURES = 5;

// Bounded exponential backoff between failed probes (same shape as
// `CodexAppServerMeter`): rapid retriggers after a failure are suppressed
// until the next-eligible timestamp, so a brief outage cannot burn the
// whole failure streak before the CLI recovers.
const PROBE_BACKOFF_BASE_MS = 1_000;
const PROBE_BACKOFF_MAX_MS = 60_000;

export class MuseUsageProbe {
  /**
   * @param {Object} [options]
   * @param {Function} [options.getObserver] - Returns the bound allowance
   *   observer (or null when no sink is available).
   * @param {Object} [options.modelProviders] - Provider repository.
   * @param {Object} [options.settings] - Settings repository (probe model).
   * @param {Object} [options.clock] - Clock DI ({ now }).
   * @param {Function} [options.spawnProcess] - Spawn DI (node child_process.spawn shape).
   * @param {number} [options.requestTimeoutMs] - Per-phase timeout for handshake/start/read.
   * @param {number} [options.turnTimeoutMs] - Bound for the probe turn (≈60s per FR-7).
   * @param {number} [options.killGraceMs] - SIGTERM→SIGKILL escalation grace.
   */
  constructor({
    getObserver = null,
    modelProviders = null,
    settings = null,
    clock = Date,
    spawnProcess = spawn,
    requestTimeoutMs = 10_000,
    turnTimeoutMs = 60_000,
    killGraceMs = 2_000,
  } = {}) {
    this.getObserver = getObserver;
    this.modelProviders = modelProviders;
    this.settings = settings;
    this.clock = clock;
    this.spawnProcess = spawnProcess;
    this.requestTimeoutMs = requestTimeoutMs;
    this.turnTimeoutMs = turnTimeoutMs;
    this.killGraceMs = killGraceMs;
    this.state = 'idle'; // idle | probing | disabled
    this.probePromise = null;
    this.consecutiveFailures = 0;
    this.nextEligibleAtMs = 0;
    this.lastSpawn = [];
    this.process = null;
    this.rl = null;
    this.rpc = new ProbeRpc();
    this.turn = new ProbeTurnWait();
    this.generation = 0;
  }

  /**
   * Run one probe micro-turn. Overlapping probes are serialized: a second
   * trigger while a probe is in flight is suppressed and observes the same
   * outcome. Never throws — every failure resolves to "no data".
   */
  trigger() {
    if (this.state === 'disabled') return Promise.resolve(false);
    if (this.probePromise) return this.probePromise;
    if (this.clock.now() < this.nextEligibleAtMs) {
      logMuseProbeOutcome({ outcome: 'backoff' });
      return Promise.resolve(false);
    }
    this.probePromise = this.#runProbe().finally(() => {
      this.probePromise = null;
    });
    return this.probePromise;
  }

  async stop() {
    this.generation += 1;
    this.#abortPending('aborted');
    const child = this.process;
    if (child) {
      try {
        await this.#teardownChild(child);
      } catch { /* teardown never fails the probe */ }
    }
  }

  async #runProbe() {
    const provider = resolveMuseAllowanceProvider(this.modelProviders);
    if (!provider) {
      logMuseProbeOutcome({ outcome: 'no-provider' });
      return false;
    }
    const child = this.#launchChild();
    if (!child) return false;
    const generation = this.generation;
    this.#attachChild(child);
    try {
      if (this.generation !== generation) return false;
      return await this.#serveOneTurn(child, provider);
    } finally {
      // Awaited so the single-flight guard covers teardown: no second
      // probe spawns while the prior process is still alive.
      if (this.process === child) await this.#teardownChild(child);
      if (this.process === child) this.process = null;
      if (this.state === 'probing') this.state = 'idle';
    }
  }

  #launchChild() {
    const model = resolveMuseProbeModel({ settings: this.settings, modelProviders: this.modelProviders });
    const { command, args } = buildMuseProbeArgs(model);
    try {
      const child = this.spawnProcess(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.lastSpawn.push([command, args]);
      return child;
    } catch {
      this.#recordFailure('spawn-failed');
      return null;
    }
  }

  #attachChild(child) {
    // A displaced reader (stop() raced by a new trigger before its
    // teardown finished) is closed here; the pending teardown skips it via
    // the process check in #teardownChild.
    const displacedRl = this.rl;
    this.rl = null;
    if (displacedRl) {
      try { displacedRl.close(); } catch { /* ignore */ }
    }
    this.process = child;
    this.state = 'probing';
    this.turn.reset();
    const generation = this.generation;
    const isCurrent = () => generation === this.generation && this.process === child;
    let failed = false;
    const failOnce = () => {
      if (failed || !isCurrent()) return;
      failed = true;
      this.#abortPending('exited');
      this.#resolveTurn({ ended: false });
    };
    child.on('error', failOnce);
    child.on('exit', failOnce);
    // Owned stdio streams can fail asynchronously (e.g. EPIPE when the
    // host exits mid-write), outside any synchronous try/catch around
    // `write`. Abort the current probe safely instead of crashing on an
    // uncaught stream error; the previous snapshot is retained. Fakes
    // without emitter stdio simply skip this.
    const onStreamError = () => {
      if (!isCurrent()) return;
      this.#abortPending('stream-error');
      this.#resolveTurn({ ended: false });
    };
    child.stdin?.on?.('error', onStreamError);
    child.stdout?.on?.('error', onStreamError);
    child.stderr?.on?.('error', onStreamError);

    this.rl = readline.createInterface({ input: child.stdout });
    // Generation-specific: lines arriving from a superseded child (stop
    // raced by a new trigger) must not resolve the newer probe's waiters.
    this.rl.on('line', (line) => {
      if (!isCurrent()) return;
      this.#handleFrame(line);
    });
    // The probe's stderr is diagnostic output from the CLI; it is drained
    // and discarded so the child never blocks, and never logged (NFR-3).
    child.stderr?.resume?.();
  }

  async #serveOneTurn(child, provider) {
    const sessionId = await this.#openSession();
    if (sessionId === null) return false;
    if (!this.#isAlive(child)) return false;
    const usage = await this.#captureTurnUsage(child, sessionId);
    if (!usage) return false;
    return this.#observe(usage, provider);
  }

  async #openSession() {
    const { delivered, reason } = await this.#request('initialize', { clientInfo: MUSE_PROBE_CLIENT_INFO });
    if (!delivered) {
      this.#recordFailure(reason === 'rpc-error' ? 'protocol-error' : 'timeout', 'initialize');
      return null;
    }
    this.#notify('initialized');

    const start = await this.#request('session/start', {
      commandId: newMuseProbeCommandId(),
      providerId: MUSE_PROBE_PROVIDER,
    });
    const sessionId = start.delivered ? start.result?.session?.sessionId ?? null : null;
    if (typeof sessionId !== 'string' || !sessionId) {
      this.#recordFailure(start.delivered ? 'protocol-error' : 'timeout', 'start');
      return null;
    }
    return sessionId;
  }

  async #captureTurnUsage(child, sessionId) {
    const turn = await this.#runTurn(child, sessionId);
    if (turn.usage) return turn.usage;
    if (!turn.ended) {
      this.#recordFailure('timeout', 'turn');
      return null;
    }
    const read = await this.#request('usage/read', {});
    if (!read.delivered) {
      this.#recordFailure(read.reason === 'rpc-error' ? 'protocol-error' : 'timeout', 'read');
      return null;
    }
    const usage = read.result?.usage;
    if (!usage || typeof usage !== 'object') {
      this.#recordFailure('no-data', 'read');
      return null;
    }
    return usage;
  }

  async #runTurn(child, sessionId) {
    if (!this.#isAlive(child)) return { ended: false };
    const generation = this.generation;
    return runProbeTurn({
      rpc: this.rpc,
      child,
      sessionId,
      turn: this.turn,
      turnTimeoutMs: this.turnTimeoutMs,
      isCurrent: () => generation === this.generation && this.process === child,
    });
  }

  #isAlive(child) {
    return this.process === child && child !== null;
  }

  #observe(usage, provider) {
    const candidate = observeProbeUsage({
      usage,
      providerId: provider.id,
      clock: this.clock,
      getObserver: this.getObserver,
    });
    if (!candidate) {
      this.#recordFailure('no-data', 'map');
      return false;
    }
    this.consecutiveFailures = 0;
    this.nextEligibleAtMs = 0;
    return true;
  }

  #recordFailure(outcome, phase = null) {
    logMuseProbeOutcome(phase ? { outcome, phase } : { outcome });
    this.consecutiveFailures += 1;
    this.nextEligibleAtMs = this.clock.now()
      + Math.min(PROBE_BACKOFF_BASE_MS * 2 ** (this.consecutiveFailures - 1), PROBE_BACKOFF_MAX_MS);
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.state = 'disabled';
      logMuseProbeOutcome({ outcome: 'disabled-after-repeated-failures' });
    }
  }

  #request(method, params = {}) {
    return this.rpc.sendRequest(this.process, method, params, this.requestTimeoutMs);
  }

  #notify(method, params = {}) {
    this.rpc.sendNotification(this.process, method, params);
  }

  #handleFrame(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let frame;
    try {
      frame = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (frame && typeof frame === 'object' && frame.method !== undefined) {
      this.#handleNotification(frame);
      return;
    }
    this.#handleResponse(frame);
  }

  #handleNotification(frame) {
    if (frame.method === 'usage/changed') {
      const outcome = this.turn.noteUsageChanged(frame.params, this.clock.now());
      if (outcome) this.turn.resolveWaiter(outcome);
      return;
    }
    if (frame.method === 'turn/completed') {
      const outcome = this.turn.noteCompleted(frame.params?.turnId);
      if (outcome) this.turn.resolveWaiter(outcome);
    }
  }

  #handleResponse(frame) {
    this.rpc.routeResponse(frame);
  }

  #resolveTurn(value) {
    this.turn.resolveWaiter(value);
  }

  #abortPending(reason) {
    this.rpc.abortAll(reason);
    this.#resolveTurn({ ended: false });
  }

  async #teardownChild(child) {
    await teardownProbeChild({
      child,
      closeReadline: this.process === child && this.rl
        ? () => {
          try { this.rl.close(); } catch { /* ignore */ }
          this.rl = null;
        }
        : null,
      killGraceMs: this.killGraceMs,
    });
    if (this.process === child) this.process = null;
  }
}
