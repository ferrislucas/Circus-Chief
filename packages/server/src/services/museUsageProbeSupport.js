import { randomBytes } from 'node:crypto';
import { DEFAULT_MUSE_MODEL } from '@circuschief/shared';
import { mapMuseUsageChanged } from '../agents/adapters/museUsageMapper.js';
import { killMuseTestProcess } from './metaProbe.js';

/**
 * Pure support for the Muse subscription-usage probe: argv construction,
 * provider/model resolution, and credential-free outcome logging. Lives here
 * (not in museUsageProbe.js) so that file stays under the project's
 * max-lines budget — the same split as codexAppServerMeterSupport.js.
 */

const LOG_SOURCE = 'muse-usage-probe';

export const MUSE_PROBE_CLIENT_INFO = Object.freeze({
  name: 'circuschief-muse-usage-probe',
  title: 'Circus Chief',
  version: '1.0.0',
});

export const MUSE_PROBE_PROMPT = 'Hi';

/** CLI provider routing pinned so probes always read Meta subscription data. */
export const MUSE_PROBE_PROVIDER = 'meta';

/**
 * Mint a UUIDv7 idempotency handle for `session/start` and `turn/start`
 * (SS2.5, SS3.1.1): 48-bit unix-ms timestamp, `7` version nibble, RFC 4122
 * variant bits, 74 random bits. Node's `randomUUID()` is v4, which the
 * schema does not accept here, so the layout is built explicitly.
 */
export function newMuseProbeCommandId(nowMs = Date.now()) {
  const bytes = randomBytes(16);
  const time = Math.floor(nowMs);
  bytes[0] = Math.floor(time / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(time / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(time / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(time / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(time / 2 ** 8) & 0xff;
  bytes[5] = time & 0xff;
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Build the headless `muse serve` argv for one probe micro-turn (pure).
 * Memory-only sessions (`--no-session-log`) leave no session list/journal
 * pollution; the model is the configured probe model (FR-9).
 */
export function buildMuseProbeArgs(model) {
  return {
    command: process.env.MUSE_BIN || 'muse',
    args: ['serve', '--no-session-log', '--provider', MUSE_PROBE_PROVIDER, '--model', model],
  };
}

/** Re-resolve the eligible provider per probe so disable/removal applies
 * without restart (same pattern as `resolveCodexAllowanceProvider`). */
export function resolveMuseAllowanceProvider(modelProviders) {
  const providers = modelProviders?.getEnabledForAllowances?.() ?? [];
  return providers.find((provider) => provider?.isBuiltIn === true
    && provider?.kind === 'meta'
    && provider?.enabled !== false) ?? null;
}

/**
 * Resolve the probe turn model: the stored setting when it names a
 * currently enabled model of the built-in `meta` provider, else the
 * non-contributor default. An unset, disabled, or otherwise invalid stored
 * value resolves to the default (FR-9).
 */
export function resolveMuseProbeModel({ settings = null, modelProviders = null } = {}) {
  const stored = settings?.getMuseProbeSettings?.()?.probeModel;
  const meta = resolveMuseAllowanceProvider(modelProviders);
  if (!meta) return DEFAULT_MUSE_MODEL;
  const full = modelProviders?.getById?.(meta.id) ?? meta;
  const enabledModels = new Set(
    (full?.models ?? [])
      .filter((model) => model?.enabled !== false)
      .map((model) => model?.modelId),
  );
  if (typeof stored === 'string' && stored && enabledModels.has(stored)) return stored;
  return DEFAULT_MUSE_MODEL;
}

/** Structured, credential-free diagnostics (NFR-3). */
export function logMuseProbeOutcome(entry) {
  console.log('[MuseUsageProbe]', JSON.stringify({ source: LOG_SOURCE, ...entry }));
}

/**
 * Map one observed usage payload through the mapper and into the allowance
 * observer. Returns the mapped candidate, or null when the payload carries
 * no usable window (logged as no-data, never observed).
 */
export function observeProbeUsage({ usage, providerId, clock, getObserver }) {
  const candidate = mapMuseUsageChanged(usage, { observedAt: clock.now() });
  if (!candidate) return null;
  const observer = getObserver?.();
  if (observer) {
    try {
      observer({ ...candidate, providerId });
    } catch {
      // Allowance telemetry is non-critical (FR-6).
    }
  }
  logMuseProbeOutcome({ outcome: 'ok' });
  return candidate;
}

/**
 * Wait-for-completion state machine for one probe turn. The `turn/start`
 * response is only admission: the turn ends on the first valid
 * `usage/changed` or the matching `turn/completed`, falling back to
 * `usage/read` when the turn ends quietly. A tiny class (not bare
 * functions over a passed-in bag) so turn bookkeeping mutates `this`
 * instead of function parameters.
 */
export class ProbeTurnWait {
  constructor() {
    this.reset();
  }

  reset() {
    this.waiter = null;
    this.usage = null;
    this.ackedTurnId = null;
    this.completionTurnId = null;
  }

  setWaiter(resolve) {
    this.waiter = { resolve };
  }

  clearWaiter(resolve) {
    if (this.waiter?.resolve === resolve) this.waiter = null;
  }

  resolveWaiter(value) {
    this.waiter?.resolve(value);
  }

  /**
   * Record an admission acknowledgement. Returns `completed` when a
   * stashed completion already matches the acknowledged turn (completion
   * raced the ack), `waiting` while the turn runs, or `invalid` for a
   * non-string turn id.
   */
  noteAdmission(turnId) {
    if (typeof turnId !== 'string' || !turnId) return 'invalid';
    this.ackedTurnId = turnId;
    return this.completionTurnId === turnId ? 'completed' : 'waiting';
  }

  /**
   * Record a `usage/changed` frame. Returns the ended outcome for the
   * first valid payload, or null when the frame carries no usable window.
   */
  noteUsageChanged(params, observedAt) {
    const candidate = mapMuseUsageChanged(params, { observedAt });
    if (!candidate) return null;
    this.usage = params;
    return { ended: true, usage: params };
  }

  /**
   * Record a `turn/completed` notification. Returns the ended outcome
   * (usage may be null, sending the caller to `usage/read`) for the
   * matching turn, or null for malformed or foreign turn ids.
   */
  noteCompleted(turnId) {
    if (typeof turnId !== 'string' || !turnId) return null;
    if (this.ackedTurnId && this.ackedTurnId !== turnId) return null;
    this.completionTurnId = turnId;
    return { ended: true, usage: this.usage };
  }
}

/**
 * Submit one probe `turn/start` and wait for real completion (not the
 * admission acknowledgement): the returned promise resolves ended only on
 * the first valid `usage/changed` or the matching `turn/completed` routed
 * through `turn`, or un-ended on abort, timeout, or rejection. Timers are
 * `unref`d so an orphaned wait never holds the server event loop open.
 */
export function runProbeTurn({ rpc, child, sessionId, turn, turnTimeoutMs, isCurrent }) {
  const id = rpc.nextId();
  const frame = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'turn/start',
    params: {
      commandId: newMuseProbeCommandId(),
      sessionId,
      input: [{ type: 'text', text: MUSE_PROBE_PROMPT }],
    },
  });
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish({ ended: false }), turnTimeoutMs);
    timer.unref?.();
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      rpc.pendingReads.delete(id);
      turn.clearWaiter(turnResolve);
      resolve(value);
    };
    const turnResolve = (value) => finish(value);
    turn.setWaiter(turnResolve);
    rpc.pendingReads.set(id, {
      resolve: ({ delivered, result }) => {
        if (!delivered) {
          finish({ ended: false });
          return;
        }
        if (!isCurrent()) {
          finish({ ended: false });
          return;
        }
        // Admission only: record the acknowledged turn and keep waiting.
        // The request entry is retired so a late duplicate ack cannot end
        // a later wait; aborts still reach us through the turn waiter.
        const admission = turn.noteAdmission(result?.turnId);
        rpc.pendingReads.delete(id);
        if (admission === 'invalid') finish({ ended: false });
        else if (admission === 'completed') finish({ ended: true, usage: turn.usage });
      },
      timer: null,
    });
    try {
      child.stdin.write(`${frame}\n`);
    } catch {
      finish({ ended: false });
    }
  });
}

/**
 * Mutable JSON-RPC request state for one probe generation. A tiny class (not
 * bare functions over a passed-in bag) so request bookkeeping mutates `this`
 * instead of function parameters.
 */
export class ProbeRpc {
  constructor() {
    this.nextRequestId = 1;
    this.pendingReads = new Map();
  }

  /** Mint the next JSON-RPC request id (mutates `this`, never a parameter). */
  nextId() {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return id;
  }

  /**
   * Issue one JSON-RPC request, resolving a discriminated outcome
   * (`delivered` with `result`, or not with a `reason`: `timeout`,
   * `write-failed`, `aborted`). Timers are `unref`d so an orphaned probe
   * never holds the server event loop open.
   */
  sendRequest(child, method, params, requestTimeoutMs) {
    if (!child) return Promise.resolve({ delivered: false, result: null, reason: 'aborted' });
    const id = this.nextRequestId++;
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingReads.delete(id);
        resolve({ delivered: false, result: null, reason: 'timeout' });
      }, requestTimeoutMs);
      timer.unref?.();
      this.pendingReads.set(id, { resolve, timer });
      try {
        child.stdin.write(`${frame}\n`);
      } catch {
        clearTimeout(timer);
        this.pendingReads.delete(id);
        resolve({ delivered: false, result: null, reason: 'write-failed' });
      }
    });
  }

  /** Send one JSON-RPC notification (no id, no response expected). */
  sendNotification(child, method, params = {}) {
    if (!child) return;
    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    } catch { /* a dead stdin surfaces through error/exit handlers */ }
  }

  /**
   * Route one parsed frame to its pending request (a JSON-RPC error object
   * answers with `delivered: false`, never as a successful null read).
   */
  routeResponse(frame) {
    if (frame?.id === undefined || !this.pendingReads.has(frame.id)) return;
    const { resolve, timer } = this.pendingReads.get(frame.id);
    clearTimeout(timer);
    this.pendingReads.delete(frame.id);
    if (frame.error !== undefined && frame.error !== null) {
      resolve({ delivered: false, result: null, reason: 'rpc-error' });
      return;
    }
    resolve({ delivered: true, result: frame.result ?? null, reason: null });
  }

  /** Resolve every pending request as failed (timeout, exit, or stop). */
  abortAll(reason) {
    for (const { resolve, timer } of this.pendingReads.values()) {
      clearTimeout(timer);
      resolve({ delivered: false, result: null, reason });
    }
    this.pendingReads.clear();
  }
}

/**
 * Wait for a probe child to exit, resolving false after `timeoutMs` while
 * the caller keeps draining output. Works with real ChildProcess handles
 * and emitter fakes alike.
 */
export function waitForProbeChildExit(child, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const cleanup = () => {
      clearTimeout(timer);
      child.off?.('exit', onExit);
      child.off?.('close', onExit);
    };
    const onExit = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve(true);
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      resolve(false);
    }, timeoutMs);
    timer.unref?.();
    child.once?.('exit', onExit);
    child.once?.('close', onExit);
  });
}

/**
 * Tear a probe child down with SIGTERM→SIGKILL escalation on hang (FR-7).
 * Stdout keeps draining through the grace period: the readline is closed
 * only after the child exits or is force-killed, so no output is lost and
 * the single-flight guard (held by the caller) covers the whole teardown.
 * Takes the pieces explicitly so the owning class stays under budget.
 */
export async function teardownProbeChild({ child, closeReadline, killGraceMs }) {
  try {
    if (child) {
      killMuseTestProcess(child);
      const exited = await waitForProbeChildExit(child, killGraceMs);
      if (!exited) {
        killMuseTestProcess(child, undefined, true);
        await waitForProbeChildExit(child, killGraceMs);
      }
    }
  } catch { /* teardown never fails the probe */ }
  try {
    closeReadline?.();
  } catch { /* ignore */ }
}
