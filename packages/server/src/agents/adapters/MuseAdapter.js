import { BaseAgent } from '../BaseAgent.js';
import { execFile as execFileCallback } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { composeCliPrompt } from './cliUtils.js';
import { createRobustEnv } from '../../services/nodeSpawnHelper.js';
import { filterDeadSshSocket } from '../../services/loginShellEnv.js';
import { createMuseEventMapper } from './museEventMapper.js';

/* The timeout coordinator keeps the host/session/turn ownership together. */
/* eslint-disable max-lines, max-params, max-statements, no-param-reassign */

/**
 * Adapter for Muse via the official `@muse-code/sdk` (MSP facade over a
 * `muse serve` host process).
 *
 * Lifecycle is per-call, matching the other adapters: each `execute()`
 * spawns one `muse serve` host, opens (or resumes) exactly one MSP session,
 * submits exactly one user turn, folds that turn's items into the
 * SDK-shaped envelope the rest of the app understands, then closes the
 * host. Multi-turn continuity comes from MSP session resume: the adapter
 * emits `system(init)` with the MSP session id, which the stream handler
 * stores on the conversation (same column Claude uses), and a later call
 * passes it back as `options.resume` → `client.resumeSession()`.
 *
 * Headless approval posture (v1): the server-side approval mode is derived
 * from the Circus Chief session mode (see `getMuseApprovalModeForSession`),
 * and an `onApproval` handler approves the server-offered first choice.
 * This mirrors the non-interactive Codex/Gemini CLI adapters — there is no
 * TTY to prompt on. An interactive approval round-trip is a follow-up.
 *
 * Capabilities in v1:
 *   - streaming:   true  — `turn.items()` replays the backlog then tails live
 *   - thinking:    false — reasoning text is committed, never streamed (MSP v1)
 *   - reasoningEffort: true — per-turn `reasoningEffort` tier
 *   - toolUse:     true  — `muse serve` hosts shell/file/web tools
 *   - resume:      true  — `client.resumeSession()` on the stored MSP id
 */
/**
 * MSP handshake identity. `name` must match ^[a-z0-9_]+$ (SS1.4.1) — the
 * host rejects anything else (including 'circus-chief' with a hyphen) at
 * `initialize`, which would break every Muse session.
 */
export const MUSE_CLIENT_INFO = Object.freeze({ name: 'circus_chief', version: '1.0.0' });

const require = createRequire(import.meta.url);
export const MUSE_SDK_VERSION = require('@muse-code/sdk/package.json').version;
const execFile = promisify(execFileCallback);
const DEFAULT_TIMEOUTS = Object.freeze({ startupMs: 30_000, turnMs: 15 * 60_000, idleMs: 60_000 });

/** A typed, actionable failure that the session error path can safely surface. */
export class MuseTurnTimeoutError extends Error {
  constructor(phase, timeoutMs, details = {}) {
    super(`Muse turn timed out during ${phase} after ${timeoutMs}ms. The Muse host was closed; retry the turn. If this persists, verify the pinned Muse CLI and SDK versions.`);
    this.name = 'MuseTurnTimeoutError';
    this.code = 'MUSE_TURN_TIMEOUT';
    this.phase = phase;
    this.timeoutMs = timeoutMs;
    Object.assign(this, details);
  }
}

export class MuseAdapter extends BaseAgent {
  static capabilities = Object.freeze({
    streaming: true,
    thinking: false,
    reasoningEffort: true,
    toolUse: true,
    resume: true,
  });

  /**
   * @param {Object} [opts]
   * @param {Function} [opts.museClientFactory] - Optional DI for testing.
   *   Shape: `async ({ museBin, env, onStderr }) => client` where client has
   *   `startSession()`, `resumeSession()`, and `close()`.
   * @param {Object} [opts.rest] - Passed to {@link BaseAgent}.
   */
  constructor({ museClientFactory, museVersionResolver, timeouts, correlationIdFactory, ...rest } = {}) {
    super(rest);
    this._museClientFactory = museClientFactory;
    this._museVersionResolver = museVersionResolver;
    this._timeouts = { ...DEFAULT_TIMEOUTS, ...(timeouts || {}) };
    this._correlationIdFactory = correlationIdFactory || (() => `muse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  }

  getCapabilities() {
    return { ...MuseAdapter.capabilities };
  }

  supportsResume() {
    return true;
  }

  /**
   * Execute one Muse turn and yield SDK-shaped events.
   *
   * @param {import('../types.js').AgentQueryParams} queryParams
   * @yields {Object} Normalized SDK events
   */
  async *execute(queryParams, _meta) {
    const options = queryParams.options || {};
    const mapper = createMuseEventMapper({ model: options.model });
    const correlationId = this._correlationIdFactory();
    const timings = { startedAt: Date.now() };
    const host = await this._openHost(options, { correlationId, timings });
    let settled = false;
    try {
      yield* this._runTurn(host, queryParams, options, mapper, { correlationId, timings });
      settled = true;
    } finally {
      host.detach();
      await host.close();
      timings.closeMs = Date.now() - timings.startedAt;
      logMuseLifecycle({ correlationId, hostPid: host.pid, sdkVersion: MUSE_SDK_VERSION, cliVersion: host.cliVersion, timings, phase: 'close' });
      if (settled) yield* mapper.finalize();
    }
  }

  /**
   * Spawn the `muse serve` host. Returns the client plus lifecycle helpers:
   * idempotent `close()` (also triggered by abort, to unblock iterators)
   * and `detach()` to remove the abort listener once the turn settles.
   */
  async _openHost(options, context) {
    const factory = this._museClientFactory ?? spawnMuseClient;
    const museBin = this._museClientFactory ? (process.env.MUSE_BIN || 'test-muse') : resolveMuseBin();
    // A test factory is already a pinned in-memory host. Production always
    // probes the configured executable before it may open an MSP session.
    const cliVersion = await this._preflightMuseCompatibility(museBin, Boolean(this._museClientFactory));
    let client;
    try {
      client = await deadline(factory({
        museBin,
        env: buildMuseHostEnv(options.env),
        onStderr: (chunk) => logMuseStderr(chunk),
      }), this._timeouts.startupMs, 'spawn', context, null, async (lateClient) => lateClient?.close?.());
    } catch (err) {
      throw toMuseNotFoundError(err);
    }

    context.timings.spawnMs = Date.now() - context.timings.startedAt;
    const pid = client.hostPid ?? client.pid ?? 'unavailable';
    logMuseLifecycle({ correlationId: context.correlationId, hostPid: pid, sdkVersion: MUSE_SDK_VERSION, cliVersion, timings: context.timings, phase: 'spawn' });

    let closePromise = null;
    const close = () => {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        try {
          await client.close();
        } catch (err) {
          console.warn(`[MuseAdapter] Error closing Muse host: ${err?.message || err}`);
        }
      })();
      return closePromise;
    };
    const abortSignal = options.abortController?.signal;
    const onAbort = () => { void close(); };
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    return {
      client,
      pid,
      cliVersion,
      close,
      detach: () => abortSignal?.removeEventListener('abort', onAbort),
    };
  }

  async _preflightMuseCompatibility(museBin, skipProbe) {
    if (skipProbe && !this._museVersionResolver) return MUSE_SDK_VERSION;
    const resolver = this._museVersionResolver || readMuseCliVersion;
    const cliVersion = await resolver(museBin);
    if (cliVersion !== MUSE_SDK_VERSION) {
      const error = new Error(`Muse CLI/SDK version mismatch: CLI ${cliVersion || 'unknown'} does not match @muse-code/sdk ${MUSE_SDK_VERSION}. Install Muse Code ${MUSE_SDK_VERSION} and set MUSE_BIN to that exact executable.`);
      error.code = 'MUSE_VERSION_MISMATCH';
      error.cliVersion = cliVersion || null;
      error.sdkVersion = MUSE_SDK_VERSION;
      throw error;
    }
    return cliVersion;
  }

  async *_runTurn(host, queryParams, options, mapper, context) {
    const { client } = host;
    const session = await deadline(openMspSession(client, options), this._timeouts.startupMs, options.resume ? 'resume' : 'startSession', context, () => host.close());
    context.timings.resumeOrStartMs = Date.now() - context.timings.startedAt;
    context.sessionId = session.sessionId;
    logMuseLifecycle({ correlationId: context.correlationId, hostPid: host.pid, museSessionId: session.sessionId, sdkVersion: MUSE_SDK_VERSION, cliVersion: host.cliVersion, timings: context.timings, phase: options.resume ? 'resume' : 'startSession' });
    yield mapper.buildSystemInit(session.sessionId);
    registerApprovalHandlers(session);

    const turn = await deadline(session.sendUserTurn({
      input: [{ type: 'text', text: composeCliPrompt(options.systemPrompt, queryParams.prompt) }],
      ...(options.displayText ? { displayText: options.displayText } : {}),
      ...museReasoningEffortParam(options.effortLevel),
    }), this._timeouts.startupMs, 'sendUserTurn', context, () => host.close());
    context.timings.sendUserTurnMs = Date.now() - context.timings.startedAt;
    logMuseLifecycle({ correlationId: context.correlationId, hostPid: host.pid, museSessionId: session.sessionId, sdkVersion: MUSE_SDK_VERSION, cliVersion: host.cliVersion, timings: context.timings, phase: 'sendUserTurn' });

    const abortSignal = options.abortController?.signal;
    const iterator = turn.items()[Symbol.asyncIterator]();
    let sawFirstItem = false;
    let outcome = null;
    while (true) {
      if (abortSignal?.aborted) break;
      const remainingTurnMs = this._timeouts.turnMs - (Date.now() - context.timings.startedAt);
      if (remainingTurnMs <= 0) await timeoutAndClose('turn', this._timeouts.turnMs, context, host, options.abortController);
      // Completion is raced with each tail read: a host that has terminally
      // completed must not remain "running" merely because its item iterator
      // failed to wake. The deadline still catches the 1.3/1.4 mismatch case
      // where neither side ever settles.
      const next = await deadline(Promise.race([
        iterator.next().then((itemResult) => ({ kind: 'item', itemResult })),
        completionAfterBacklog(turn.completed),
      ]), Math.min(this._timeouts.idleMs, remainingTurnMs), 'stream_idle', context, () => host.close());
      if (next.kind === 'completed') {
        outcome = next.completed;
        break;
      }
      const { itemResult } = next;
      if (itemResult.done) break;
      const item = itemResult.value;
      if (!sawFirstItem) {
        sawFirstItem = true;
        context.timings.firstItemMs = Date.now() - context.timings.startedAt;
        logMuseLifecycle({ correlationId: context.correlationId, hostPid: host.pid, museSessionId: session.sessionId, sdkVersion: MUSE_SDK_VERSION, cliVersion: host.cliVersion, timings: context.timings, phase: 'firstItem' });
      }
      yield* mapper.mapItem(item);
    }

    const remainingTurnMs = this._timeouts.turnMs - (Date.now() - context.timings.startedAt);
    if (remainingTurnMs <= 0) await timeoutAndClose('turn', this._timeouts.turnMs, context, host, options.abortController);
    yield* mapper.mapOutcome(outcome || await deadline(turn.completed, remainingTurnMs, 'completion', context, () => host.close()));
    context.timings.completionMs = Date.now() - context.timings.startedAt;
    logMuseLifecycle({ correlationId: context.correlationId, hostPid: host.pid, museSessionId: session.sessionId, sdkVersion: MUSE_SDK_VERSION, cliVersion: host.cliVersion, timings: context.timings, phase: 'completion' });
  }
}

function completionAfterBacklog(completed) {
  // `items()` must replay its already-folded backlog before a terminal
  // completion is emitted. Give an immediately available iterator item the
  // current event-loop turn; after that, a settled completion reconciles a
  // stuck live tail without waiting for idle timeout.
  return new Promise((resolve, reject) => {
    setTimeout(() => completed.then(
      (value) => resolve({ kind: 'completed', completed: value }),
      reject,
    ), 0);
  });
}

function resolveMuseBin() {
  const museBin = process.env.MUSE_BIN;
  if (museBin) return museBin;
  const error = new Error(`Muse requires MUSE_BIN to point to the exact Muse Code ${MUSE_SDK_VERSION} executable; refusing the auto-updating global \`muse\` launcher.`);
  error.code = 'MUSE_BIN_NOT_CONFIGURED';
  throw error;
}

export async function readMuseCliVersion(museBin) {
  const { stdout } = await execFile(museBin, ['--version'], { timeout: DEFAULT_TIMEOUTS.startupMs, windowsHide: true });
  const match = String(stdout).match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/);
  if (!match) {
    const error = new Error(`Could not determine Muse CLI version from ${museBin} --version output.`);
    error.code = 'MUSE_CLI_VERSION_UNKNOWN';
    throw error;
  }
  return match[1];
}

async function deadline(promise, timeoutMs, phase, context, onTimeout, onLateResolve) {
  let timer;
  let timedOut = false;
  const guarded = Promise.resolve(promise);
  // If a timed-out spawn later resolves, close it so an owned process cannot leak.
  guarded.then((value) => (timedOut ? onLateResolve?.(value) : undefined)).catch(() => undefined);
  try {
    return await Promise.race([
      guarded,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          Promise.resolve(onTimeout?.()).catch(() => undefined);
          reject(new MuseTurnTimeoutError(phase, timeoutMs, { correlationId: context.correlationId }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function timeoutAndClose(phase, timeoutMs, context, host, controller) {
  const error = new MuseTurnTimeoutError(phase, timeoutMs, { correlationId: context.correlationId, museSessionId: context.sessionId });
  controller?.abort(error);
  await host.close();
  throw error;
}

function logMuseLifecycle({ correlationId, hostPid, museSessionId, sdkVersion, cliVersion, timings, phase }) {
  console.info(`[MuseAdapter] correlationId=${correlationId} phase=${phase} hostPid=${hostPid ?? 'unavailable'} museSessionId=${museSessionId ?? 'pending'} sdkVersion=${sdkVersion} cliVersion=${cliVersion ?? 'unknown'} timings=${JSON.stringify(timings)}`);
}

function registerApprovalHandlers(session) {
  session.onApproval(async (request) => approveFirstChoice(request));
  if (typeof session.onApprovalError === 'function') {
    session.onApprovalError((failure) => {
      console.warn(`[MuseAdapter] Approval round trip did not complete: ${failure?.kind} (${failure?.approvalId || 'unknown'})`);
    });
  }
}

/**
 * Build the env for the owned `muse serve` host so shell tools (git, gh and
 * friends) resolve the same binaries, config, and credentials as when the
 * user runs them directly. Session env wins over the host process env;
 * HOME/USER/LOGNAME fallbacks and well-known bin dirs fill the gaps left by
 * sparse server launch contexts. Safe to apply at both the adapter boundary
 * and the live spawn (user entries are never reordered or dropped).
 *
 * @param {Object} [sessionEnv] - Session env from buildSessionEnv (wins)
 * @param {Object} [baseEnv] - Host env filling the gaps (defaults to process.env)
 * @param {Object} [opts] - Optional `{ shellEnv }` forwarded to createRobustEnv
 *   (fixture injection for tests; undefined runs the cached live probe) and
 *   `{ isSshAgentAlive }` liveness predicate override (tests; default stats
 *   the socket path).
 * @returns {Object}
 */
export function buildMuseHostEnv(sessionEnv = {}, baseEnv = process.env, opts = {}) {
  const robust = createRobustEnv({ ...baseEnv, ...(sessionEnv || {}) }, opts);
  // FR-5: a stale agent socket must never be passed through silently — SSH
  // remotes/signing would fail opaquely inside the turn. Drop it and say why.
  const { env, droppedReason } = filterDeadSshSocket(
    robust,
    opts.isSshAgentAlive ? (sockPath) => opts.isSshAgentAlive(sockPath) : undefined,
  );
  if (droppedReason) {
    console.warn(`[MuseAdapter] ${droppedReason}. SSH git remotes and SSH commit signing will fail; run \`ssh-add -l\` in your terminal and relaunch the server from there.`);
  }
  return env;
}

/**
 * Default client factory: lazy-import the SDK so the server stays bootable
 * in environments where the optional dependency is not installed, and spawn
 * an owned `muse serve` host.
 */
async function spawnMuseClient({ museBin, env, onStderr }) {
  let MuseClient;
  try {
    ({ MuseClient } = await import('@muse-code/sdk'));
  } catch (err) {
    const missing = new Error(
      'Muse support requires the "@muse-code/sdk" package. Run `yarn add @muse-code/sdk` in packages/server.'
    );
    missing.code = 'MUSE_SDK_NOT_INSTALLED';
    missing.cause = err;
    throw missing;
  }
  return MuseClient.spawn({
    museBin,
    args: ['serve', '--trust-workspace'],
    // The SDK REPLACES the child env: extend the session env (which already
    // carries the robust PATH plus provider vars) instead of inheriting raw.
    // Hardened again here so the live spawn never depends on the caller
    // having gone through _openHost (idempotent with it).
    env: buildMuseHostEnv(env),
    clientInfo: { ...MUSE_CLIENT_INFO },
    ...(onStderr ? { onStderr } : {}),
  });
}

async function openMspSession(client, options) {
  const startOptions = {
    ...(options.cwd ? { workspaceRoot: options.cwd } : {}),
    ...(options.model ? { modelId: options.model } : {}),
    ...(options.approvalMode ? { approvalMode: options.approvalMode } : {}),
  };
  if (options.resume) {
    try {
      return await client.resumeSession({ sessionId: options.resume, ...startOptions });
    } catch (err) {
      console.warn(`[MuseAdapter] MSP resume failed (${err?.message || err}); starting a fresh session.`);
    }
  }
  return client.startSession(startOptions);
}

function approveFirstChoice(request) {
  const choice = request?.availableChoices?.[0];
  if (!choice) {
    throw new Error('Muse approval request offered no choices');
  }
  return { choiceId: choice.choiceId };
}

function logMuseStderr(chunk) {
  const text = String(chunk || '').trim();
  if (text) console.warn(`[muse serve] ${text}`);
}

function toMuseNotFoundError(err) {
  if (err?.code === 'MUSE_SDK_NOT_INSTALLED') return err;
  const message = `${err?.message || ''} ${err?.cause?.message || ''}`;
  if (err?.code === 'ENOENT' || err?.cause?.code === 'ENOENT' || /ENOENT|not found/i.test(message)) {
    const notFound = new Error(
      'Muse CLI not found. Install Muse Code and ensure `muse` is on PATH (or set MUSE_BIN).'
    );
    notFound.code = 'MUSE_CLI_NOT_FOUND';
    notFound.cause = err;
    return notFound;
  }
  return err;
}

/**
 * Map a Circus Chief effort level onto an MSP reasoning-effort tier.
 * `auto`/null/unknown → omitted (server default) — never invent a tier.
 * MSP tiers: none|minimal|low|medium|high|xhigh|max|ultra.
 */
export function resolveMuseReasoningEffort(effortLevel) {
  switch (effortLevel) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'max':
      return 'max';
    default:
      return null;
  }
}

function museReasoningEffortParam(effortLevel) {
  const tier = resolveMuseReasoningEffort(effortLevel);
  return tier ? { reasoningEffort: tier } : {};
}
