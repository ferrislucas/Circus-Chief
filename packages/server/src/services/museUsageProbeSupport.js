import { DEFAULT_MUSE_MODEL } from '@circuschief/shared';
import { mapMuseUsageChanged } from '../agents/adapters/museUsageMapper.js';
import { killMuseTestProcess, scheduleProbeKillEscalation } from './metaProbe.js';

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

/**
 * Build the headless `muse serve` argv for one probe micro-turn (pure).
 * Memory-only sessions (`--no-session-log`) leave no session list/journal
 * pollution; the model is the configured probe model (FR-9).
 */
export function buildMuseProbeArgs(model) {
  return {
    command: process.env.MUSE_BIN || 'muse',
    args: ['serve', '--no-session-log', '--model', model],
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
 * Mutable JSON-RPC request state for one probe generation. A tiny class (not
 * bare functions over a passed-in bag) so request bookkeeping mutates `this`
 * instead of function parameters.
 */
export class ProbeRpc {
  constructor() {
    this.nextRequestId = 1;
    this.pendingReads = new Map();
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
 * Tear a probe child down with SIGTERM→SIGKILL escalation on hang (FR-7).
 * Takes the pieces explicitly so the owning class stays under budget.
 */
export function destroyProbeChild({ child, closeReadline, killGraceMs }) {
  closeReadline?.();
  if (!child) return;
  killMuseTestProcess(child);
  scheduleProbeKillEscalation(child, { probeKillGraceMs: killGraceMs });
}
