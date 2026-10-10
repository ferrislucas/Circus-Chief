import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { mapMuseUsageChanged } from '../agents/adapters/museUsageMapper.js';
import {
  MUSE_PROBE_CLIENT_INFO,
  MUSE_PROBE_PROMPT,
  ProbeRpc,
  buildMuseProbeArgs,
  destroyProbeChild,
  logMuseProbeOutcome,
  observeProbeUsage,
  resolveMuseAllowanceProvider,
  resolveMuseProbeModel,
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
    this.lastSpawn = [];
    this.process = null;
    this.rl = null;
    this.rpc = new ProbeRpc();
    this.turnWaiter = null;
    this.turnUsage = null;
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
    this.probePromise = this.#runProbe().finally(() => {
      this.probePromise = null;
    });
    return this.probePromise;
  }

  async stop() {
    this.generation += 1;
    this.#abortPending('aborted');
    this.#destroyProcess();
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
      if (this.process === child) this.#destroyProcess();
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
    this.process = child;
    this.state = 'probing';
    this.turnUsage = null;
    this.turnWaiter = null;
    let failed = false;
    const failOnce = () => {
      if (failed) return;
      failed = true;
      this.#abortPending('exited');
      this.#resolveTurn({ ended: false });
    };
    child.on('error', failOnce);
    child.on('exit', () => {
      if (this.process === child) failOnce();
    });

    this.rl = readline.createInterface({ input: child.stdout });
    this.rl.on('line', (line) => this.#handleFrame(line));
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

    const start = await this.#request('session/start', {});
    const sessionId = start.delivered
      ? (start.result?.sessionId ?? start.result?.session_id ?? start.result?.id ?? null)
      : null;
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
    const id = this.rpc.nextRequestId++;
    const frame = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'turn/start',
      params: { sessionId, input: [{ type: 'text', text: MUSE_PROBE_PROMPT }] },
    });
    // The outer promise resolves turn-shaped outcomes only ({ ended,
    // usage? }): an answered turn request ends the turn (mid-turn usage
    // wins, otherwise the caller falls back to `usage/read`), while an
    // aborted, timed-out, or failed turn resolves un-ended so the caller
    // records no-data instead of reading from a dead process.
    const outcome = await new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => finish({ ended: false }), this.turnTimeoutMs);
      timer.unref?.();
      const finish = (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.rpc.pendingReads.delete(id);
        if (this.turnWaiter?.resolve === turnResolve) this.turnWaiter = null;
        resolve(value);
      };
      const turnResolve = (value) => finish(value);
      this.turnWaiter = { resolve: turnResolve };
      this.rpc.pendingReads.set(id, {
        resolve: ({ delivered }) => {
          if (delivered) finish({ ended: true, usage: this.turnUsage });
          else finish({ ended: false });
        },
        timer,
      });
      try {
        child.stdin.write(`${frame}\n`);
      } catch {
        finish({ ended: false });
      }
    });
    return outcome;
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
    return true;
  }

  #recordFailure(outcome, phase = null) {
    logMuseProbeOutcome(phase ? { outcome, phase } : { outcome });
    this.consecutiveFailures += 1;
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
      const candidate = mapMuseUsageChanged(frame.params, { observedAt: this.clock.now() });
      if (candidate) {
        this.turnUsage = frame.params;
        this.turnWaiter?.resolve({ ended: true, usage: frame.params });
      }
      return;
    }
    if (frame.method === 'turn/completed') {
      this.turnWaiter?.resolve({ ended: true, usage: this.turnUsage });
    }
  }

  #handleResponse(frame) {
    this.rpc.routeResponse(frame);
  }

  #resolveTurn(value) {
    this.turnWaiter?.resolve(value);
  }

  #abortPending(reason) {
    this.rpc.abortAll(reason);
    this.#resolveTurn({ ended: false });
  }

  #destroyProcess() {
    const child = this.process;
    this.process = null;
    const rl = this.rl;
    this.rl = null;
    destroyProbeChild({
      child,
      closeReadline: rl ? () => { try { rl.close(); } catch { /* ignore */ } } : null,
      killGraceMs: this.killGraceMs,
    });
  }
}
