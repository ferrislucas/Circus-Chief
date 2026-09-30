import { BaseAgent } from '../BaseAgent.js';
import { composeCliPrompt } from './cliUtils.js';
import { filterDeadSshSocketAsync } from '../../services/loginShellEnv.js';
import { redactSecretsFromText } from '../../services/parityDiagnostics.js';
import { createMuseEventMapper } from './museEventMapper.js';
import { DEFAULT_TIMEOUTS, MuseTurnTimeoutError, deadline, remainingMuseTurnMs } from './museTimeouts.js';
import { logMuseLifecycle } from './museLifecycle.js';
import { readMuseCliVersion } from './museCliVersion.js';
import { buildMuseHostEnv } from './museHostEnv.js';
import { assertMuseHostParity, scrubAndAttachDiagnostics } from './museParity.js';
import { closeMuseHost, forceTerminateMuseHost } from './museHostClose.js';
import { createMuseTurnContext } from './museTurnContext.js';
import { registerApprovalHandlers, resolveMuseReasoningEffort, museReasoningEffortParam } from './museApproval.js';
import {
  MUSE_CLIENT_INFO,
  MUSE_SDK_VERSION,
  resolveMuseServeArgs,
  spawnMuseClient,
  openMspSession,
} from './museClient.js';

// Re-exported so existing importers keep working after the split of
// timeouts, host env, parity, approval, client, and lifecycle helpers.
export {
  MuseTurnTimeoutError,
  DEFAULT_TIMEOUTS,
  MUSE_CLIENT_INFO,
  MUSE_SDK_VERSION,
  buildMuseHostEnv,
  assertMuseHostParity,
  scrubAndAttachDiagnostics,
  resolveMuseReasoningEffort,
  resolveMuseServeArgs,
};

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
 * Headless approval posture: the server-side approval mode is derived
 * from the Circus Chief session mode (see `getMuseApprovalModeForSession`).
 * Only `allowAll` (yolo) auto-approves the server-offered first choice —
 * every gated mode denies with an actionable error instead of silently
 * approving, so the mode selector never promises gating it does not
 * enforce. An interactive approval round-trip is a follow-up.
 *
 * Capabilities in v1:
 *   - streaming:   true  — `turn.items()` replays the backlog then tails live
 *   - thinking:    false — reasoning text is committed, never streamed (MSP v1)
 *   - reasoningEffort: true — per-turn `reasoningEffort` tier
 *   - toolUse:     true  — `muse serve` hosts shell/file/web tools
 *   - resume:      true  — `client.resumeSession()` on the stored MSP id
 */
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
   *   Shape: `async ({ museBin, args, env, onStderr }) => client` where client has
   *   `startSession()`, `resumeSession()`, and `close()`.
   * @param {Object} [opts.rest] - Passed to {@link BaseAgent}.
   */
  constructor({ museClientFactory, museVersionResolver, timeouts, correlationIdFactory, forceTerminateHost, ...rest } = {}) {
    super(rest);
    this._museClientFactory = museClientFactory;
    this._museVersionResolver = museVersionResolver;
    this._timeouts = { ...DEFAULT_TIMEOUTS, ...(timeouts || {}) };
    this._correlationIdFactory = correlationIdFactory || (() => `muse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    this._forceTerminateHost = forceTerminateHost || forceTerminateMuseHost;
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
    const context = createMuseTurnContext(correlationId);
    const { timings } = context;
    const host = await this._openHost(options, context);
    let settled = false;
    try {
      yield* this._runTurn({ host, queryParams, options, mapper, context });
      settled = !context.cancelled;
    } catch (err) {
      throw scrubAndAttachDiagnostics(err, host);
    } finally {
      host.detach();
      await host.close();
      context.markTime('closeMs');
      logMuseLifecycle({ correlationId, hostPid: host.pid, sdkVersion: MUSE_SDK_VERSION, cliVersion: host.cliVersion, timings, phase: 'close' });
      if (settled) yield* mapper.finalize();
    }
  }

  /**
   * Spawn the `muse serve` host. Returns the client plus lifecycle helpers:
   * idempotent `close()` (also triggered by abort, to unblock iterators)
   * and `detach()` to remove the abort listener once the turn settles.
   */
  /**
   * Build the host env and run the pre-turn parity gate. Returns the binary
   * selection plus the filtered env the host (and its tools) will see.
   */
  async _prepareHostEnv(options, context) {
    const museBin = this._museClientFactory ? (process.env.MUSE_BIN || 'test-muse') : resolveMuseBin();
    let hostEnv = buildMuseHostEnv(options.env);
    // Connect-test the agent socket: a dead-but-present file passes the
    // stat filter inside buildMuseHostEnv, so re-check liveness here and
    // drop it before the host (and its tools) can fail opaquely on it.
    const liveSocket = await filterDeadSshSocketAsync(hostEnv);
    if (liveSocket.env !== hostEnv) {
      hostEnv = liveSocket.env;
      if (liveSocket.droppedReason) {
        console.warn(`[MuseAdapter] ${liveSocket.droppedReason}. SSH git remotes and SSH commit signing will fail; run \`ssh-add -l\` in your terminal and relaunch the server from there.`);
      }
    }
    context.setHostEnv(hostEnv);
    // Pre-turn parity gate (FR-8): hard-fail only on the signal that always
    // breaks the turn (missing muse binary). Soft credential failures
    // (ssh-agent, gh-auth, git-identity) attach actionable remediation to
    // the turn error path instead of failing startup. A pinned in-memory
    // test factory involves no real binary, so the binary check is skipped.
    assertMuseHostParity(hostEnv, { museBin, skipBinaries: Boolean(this._museClientFactory), context });
    return { museBin, hostEnv };
  }

  async _openHost(options, context) {
    const factory = this._museClientFactory ?? spawnMuseClient;
    const { museBin, hostEnv } = await this._prepareHostEnv(options, context);
    // A test factory is already a pinned in-memory host. Production probes
    // the selected executable before it may open an MSP session. This makes
    // the normal PATH-resolved launcher safe while still catching an update
    // that no longer matches our pinned SDK.
    const cliVersion = await this._preflightMuseCompatibility(museBin, Boolean(this._museClientFactory));
    let client;
    try {
      client = await deadline(factory({
        museBin,
        args: resolveMuseServeArgs(options),
        env: hostEnv,
        onStderr: (chunk) => captureMuseStderr(context, chunk),
        shutdownTimeoutMs: this._timeouts.shutdownGraceMs,
      }), {
        timeoutMs: this._timeouts.startupMs,
        phase: 'spawn',
        context,
        onLateResolve: async (lateClient) => lateClient?.close?.(),
      });
    } catch (err) {
      throw toMuseNotFoundError(err);
    }

    context.markTime('spawnMs');
    const pid = client.hostPid ?? client.pid ?? 'unavailable';
    context.setCliVersion(cliVersion);
    logMuseLifecycle({ correlationId: context.correlationId, hostPid: pid, sdkVersion: MUSE_SDK_VERSION, cliVersion, timings: context.timings, phase: 'spawn' });

    context.setHostState('connected');
    // The SDK exposes its host-exit classification as a promise. Observe it
    // without awaiting it so a disconnected host is diagnosable at the call
    // site that failed, rather than being reported as a generic stream error.
    client.exit?.then((exit) => {
      context.setHostState(`exited:${exit?.kind || 'unknown'}`, exit);
    }, (err) => {
      context.setHostState(`exit-error:${err?.message || 'unknown'}`);
    });

    let closePromise = null;
    const close = () => {
      if (closePromise) return closePromise;
      closePromise = closeMuseHost({
        client,
        pid,
        context,
        shutdownGraceMs: this._timeouts.shutdownGraceMs,
        forceTerminateHost: this._forceTerminateHost,
        sdkVersion: MUSE_SDK_VERSION,
      });
      return closePromise;
    };
    const abortSignal = options.abortController?.signal;
    const onAbort = () => { void close(); };
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    return {
      client,
      pid,
      cliVersion,
      context,
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

  async *_runTurn({ host, queryParams, options, mapper, context }) {
    const { client } = host;
    const session = await deadline(openMspSession(client, options), {
      timeoutMs: this._timeouts.startupMs,
      phase: options.resume ? 'resume' : 'startSession',
      context,
      onTimeout: () => host.close(),
    });
    context.markTime('resumeOrStartMs');
    context.setSessionId(session.sessionId);
    logMuseLifecycle({ correlationId: context.correlationId, hostPid: host.pid, museSessionId: session.sessionId, sdkVersion: MUSE_SDK_VERSION, cliVersion: host.cliVersion, timings: context.timings, phase: options.resume ? 'resume' : 'startSession' });
    yield mapper.buildSystemInit(session.sessionId);
    registerApprovalHandlers(session, options.approvalMode);

    // sendUserTurn has its own budget (larger than the startup allowance),
    // still capped by the remaining overall turn budget.
    const sendBudgetMs = Math.min(
      this._timeouts.sendTurnMs,
      await remainingMuseTurnMs(this._timeouts.turnMs, context, host, options.abortController),
    );
    const turn = await deadline(session.sendUserTurn({
      input: [{ type: 'text', text: composeCliPrompt(options.systemPrompt, queryParams.prompt) }],
      ...(options.displayText ? { displayText: options.displayText } : {}),
      ...museReasoningEffortParam(options.effortLevel),
    }), {
      timeoutMs: sendBudgetMs,
      phase: 'sendUserTurn',
      context,
      onTimeout: () => host.close(),
    });
    context.markTime('sendUserTurnMs');
    logMuseLifecycle({ correlationId: context.correlationId, hostPid: host.pid, museSessionId: session.sessionId, sdkVersion: MUSE_SDK_VERSION, cliVersion: host.cliVersion, timings: context.timings, phase: 'sendUserTurn' });

    yield* this._drainTurnItems({ host, session, turn, options, mapper, context });
  }

  async *_drainTurnItems({ host, session, turn, options, mapper, context }) {
    const abortSignal = options.abortController?.signal;
    const iterator = turn.items()[Symbol.asyncIterator]();
    let sawFirstItem = false;
    let outcome = null;
    while (true) {
      if (abortSignal?.aborted) {
        // Terminal cancelled result so the stream never ends after
        // system(init) with no outcome.
        yield* this._cancelTurnDrain(mapper, context);
        return;
      }
      const next = await this._readNextTurnEvent({ iterator, turn, abortSignal, host, options, context });
      if (next.kind === 'aborted') {
        yield* this._cancelTurnDrain(mapper, context);
        return;
      }
      if (next.kind === 'completed') {
        outcome = next.completed;
        break;
      }
      const { itemResult } = next;
      if (itemResult.done) break;
      const item = itemResult.value;
      if (!sawFirstItem) {
        sawFirstItem = true;
        context.markTime('firstItemMs');
        logMuseLifecycle({ correlationId: context.correlationId, hostPid: host.pid, museSessionId: session.sessionId, sdkVersion: MUSE_SDK_VERSION, cliVersion: host.cliVersion, timings: context.timings, phase: 'firstItem' });
      }
      yield* mapper.mapItem(item);
    }

    yield* this._finishTurnItems({ host, session, turn, options, mapper, context, outcome });
  }

  *_cancelTurnDrain(mapper, context) {
    context.markCancelled();
    yield* mapper.mapCancellation();
  }

  async _readNextTurnEvent({ iterator, turn, abortSignal, host, options, context }) {
    const remainingTurnMs = await remainingMuseTurnMs(this._timeouts.turnMs, context, host, options.abortController);
    // Completion is raced with each tail read: a host that has terminally
    // completed must not remain "running" merely because its item iterator
    // failed to wake. There is deliberately no per-item silence deadline:
    // Muse may legitimately be quiet while planning or running a tool.
    return deadline(Promise.race([
      iterator.next().then((itemResult) => ({ kind: 'item', itemResult })),
      completionAfterBacklog(turn.completed),
      waitForAbort(abortSignal),
    ]), {
      timeoutMs: remainingTurnMs,
      phase: 'turn',
      context,
      onTimeout: () => host.close(),
    });
  }

  async *_finishTurnItems({ host, session, turn, options, mapper, context, outcome }) {
    const remainingTurnMs = await remainingMuseTurnMs(this._timeouts.turnMs, context, host, options.abortController);
    yield* mapper.mapOutcome(outcome || await deadline(turn.completed, {
      timeoutMs: remainingTurnMs,
      phase: 'completion',
      context,
      onTimeout: () => host.close(),
    }));
    context.markTime('completionMs');
    logMuseLifecycle({ correlationId: context.correlationId, hostPid: host.pid, museSessionId: session.sessionId, sdkVersion: MUSE_SDK_VERSION, cliVersion: host.cliVersion, timings: context.timings, phase: 'completion' });
  }
}

function completionAfterBacklog(completed) {
  // `items()` must replay its already-folded backlog before a terminal
  // completion is emitted. Give an immediately available iterator item the
  // current event-loop turn; after that, a settled completion reconciles a
  // stuck live tail without waiting for another item.
  return new Promise((resolve, reject) => {
    setTimeout(() => completed.then(
      (value) => resolve({ kind: 'completed', completed: value }),
      reject,
    ), 0);
  });
}

export function resolveMuseBin(env = process.env) {
  // MUSE_BIN remains the escape hatch for an explicitly pinned executable.
  // In the common case, use the PATH launcher and validate its resolved
  // version immediately before starting the host. Requiring a manually-set
  // path makes a correctly installed matching CLI unusable after restarts.
  return env.MUSE_BIN || 'muse';
}

function captureMuseStderr(context, chunk) {
  const raw = String(chunk || '').trim();
  if (!raw) return;
  // FR-11: scrub before logging and before retaining for diagnostics —
  // tool output echoed on stderr may carry secret values.
  const text = redactSecretsFromText(raw, context.hostEnv || {});
  context.pushStderr(text);
  console.warn(`[muse serve] ${text}`);
}

function waitForAbort(signal) {
  if (!signal) return new Promise(() => {});
  if (signal.aborted) return Promise.resolve({ kind: 'aborted' });
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ kind: 'aborted' }), { once: true }));
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
