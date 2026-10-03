import { BaseAgent } from '../BaseAgent.js';
import { composeCliPrompt } from './cliUtils.js';
import { filterDeadSshSocketAsync, staleSshSocketMessage } from '../../services/loginShellEnv.js';
import { scrubEventForLogging } from '../../services/parityDiagnostics.js';
import { createMuseEventMapper } from './museEventMapper.js';
import { DEFAULT_TIMEOUTS, MuseTurnTimeoutError, deadline, remainingMuseTurnMs } from './museTimeouts.js';
import { logMuseLifecycle } from './museLifecycle.js';
import { preflightMuseCompatibility } from './museCliVersion.js';
import { buildMuseHostEnv } from './museHostEnv.js';
import { assertMuseHostParity, scrubAndAttachDiagnostics, toMuseNotFoundError } from './museParity.js';
import { closeMuseHost, forceTerminateMuseHost } from './museHostClose.js';
import { createMuseTurnContext } from './museTurnContext.js';
import { registerApprovalHandlers, resolveMuseReasoningEffort, museReasoningEffortParam } from './museApproval.js';
import { isWorkflowTerminal, sessionItems, workflowIdentity } from './museWorkflow.js';
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
 * Approval posture: the server-side approval mode is derived from the
 * Circus Chief session mode (see `getMuseApprovalModeForSession`). Only
 * `allowAll` (yolo) auto-approves the server-offered first choice — every
 * gated mode parks the request as an interactive prompt via the shared
 * permission-prompt pipeline (finding #3) and denies fail-closed when no
 * prompt channel exists or the prompt times out, so the mode selector never
 * promises gating it does not enforce.
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
   * @param {Function} [opts.sshLivenessProbe] - Optional DI for the cached
   *   async SSH-agent connect-test (finding #8).
   * @param {Object} [opts.rest] - Passed to {@link BaseAgent}.
   */
  constructor({ museClientFactory, museVersionResolver, sshLivenessProbe, timeouts, correlationIdFactory, forceTerminateHost, ...rest } = {}) {
    super(rest);
    this._museClientFactory = museClientFactory;
    this._museVersionResolver = museVersionResolver;
    this._sshLivenessProbe = sshLivenessProbe;
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
    // The sync-stat socket filter inside buildMuseHostEnv is skipped here:
    // the cached async connect-test below is the single liveness probe per
    // turn (finding #8) — a dead-but-present file passes a stat check, so
    // only the connect-test can be trusted anyway.
    let hostEnv = buildMuseHostEnv(options.env, undefined, { skipSshFilter: true });
    const liveSocket = await filterDeadSshSocketAsync(hostEnv, this._sshLivenessProbe);
    if (liveSocket.env !== hostEnv) {
      hostEnv = liveSocket.env;
      if (liveSocket.droppedReason) {
        console.warn(`[MuseAdapter] ${staleSshSocketMessage(liveSocket.droppedReason)}`);
      }
    }
    context.setHostEnv(hostEnv);
    // Pre-turn parity gate (FR-8): hard-fail only on the signal that always
    // breaks the turn (missing muse binary). Soft credential failures
    // (ssh-agent, gh-auth, git-identity, home, identity) attach actionable
    // remediation to the turn error path instead of failing startup. A pinned in-memory
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
    // Finding #1: the preflight sits outside the spawn try/catch below, so
    // its failures need the same ENOENT → actionable-error mapping; a raw
    // `spawn muse ENOENT` from the version probe is the exact sparse-launch
    // symptom this unwrapped call used to produce.
    let cliVersion;
    try {
      cliVersion = await this._preflightMuseCompatibility(museBin, Boolean(this._museClientFactory), context);
    } catch (err) {
      throw toMuseNotFoundError(err);
    }
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
    let abortHandler = () => close();
    const onAbort = () => { void abortHandler(); };
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    return {
      client,
      pid,
      cliVersion,
      context,
      close,
      setAbortHandler: (handler) => { abortHandler = handler || close; },
      detach: () => abortSignal?.removeEventListener('abort', onAbort),
    };
  }

  async _preflightMuseCompatibility(museBin, skipProbe, context = null) {
    return preflightMuseCompatibility({
      museBin,
      skipProbe,
      versionResolver: this._museVersionResolver,
      context,
      // Finding #1: resolve bare launchers against the derived host env (set
      // by _prepareHostEnv just before this runs) — not the server process
      // env the parity gate has just proven insufficient.
      env: context?.hostEnv || null,
      sdkVersion: MUSE_SDK_VERSION,
    });
  }

  async *_runTurn({ host, queryParams, options, mapper, context }) {
    const { client } = host;
    // Finding #10: a resume fork (stale stored MSP id) must surface in the
    // transcript, not just the server logs — capture it and yield a notice.
    let resumeFallback = null;
    const session = await deadline(openMspSession(client, options, {
      onResumeFallback: (err) => { resumeFallback = err; },
    }), {
      timeoutMs: this._timeouts.startupMs,
      phase: options.resume ? 'resume' : 'startSession',
      context,
      onTimeout: () => host.close(),
    });
    context.markTime('resumeOrStartMs');
    context.setSessionId(session.sessionId);
    logMuseLifecycle({ correlationId: context.correlationId, hostPid: host.pid, museSessionId: session.sessionId, sdkVersion: MUSE_SDK_VERSION, cliVersion: host.cliVersion, timings: context.timings, phase: options.resume ? 'resume' : 'startSession' });
    yield mapper.buildSystemInit(session.sessionId);
    if (resumeFallback) {
      // FR-11: scrub before yielding — resume errors can echo host output.
      // Uses the full session value set (env values plus harvested hosts.yml
      // tokens), matching the transcript choke point.
      const notice = scrubEventForLogging(
        `Muse could not resume the previous session (${resumeFallback?.message || resumeFallback}); started a fresh session instead, so earlier turns are not in context.`,
        context.hostEnv || {},
      );
      yield mapper.buildNotice(notice);
    }
    // Finding #3: gated modes park MSP approval requests as interactive
    // prompts via the shared permission-prompt pipeline (options.canUseTool,
    // provided by queryParamBuilder like the Claude path). No channel →
    // fail-closed denial; yolo never prompts.
    registerApprovalHandlers(session, options.approvalMode, {
      promptChannel: typeof options.canUseTool === 'function' ? options.canUseTool : null,
      promptTimeoutMs: this._timeouts.approvalPromptMs,
      signal: options.abortController?.signal || null,
      onPromptTimeout: (request, timeoutMs) => {
        console.warn(`[MuseAdapter] Approval prompt for ${request?.toolName || 'tool'} timed out after ${timeoutMs}ms; denying (approvalId ${request?.approvalId || 'unknown'}).`);
      },
    });

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
    let workflow = null;
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
      const identity = workflowIdentity(item);
      if (identity && (!workflow || workflow.workflowRunId === identity.workflowRunId)) {
        workflow = { ...identity, item };
      } else if (identity) {
        throw new Error('Muse admitted more than one workflow for one turn; concurrent workflow runs are not supported.');
      }
      if (!sawFirstItem) {
        sawFirstItem = true;
        context.markTime('firstItemMs');
        logMuseLifecycle({ correlationId: context.correlationId, hostPid: host.pid, museSessionId: session.sessionId, sdkVersion: MUSE_SDK_VERSION, cliVersion: host.cliVersion, timings: context.timings, phase: 'firstItem' });
      }
      yield* mapper.mapItem(item);
    }

    if (workflow) {
      // The parent outcome only means the workflow was admitted. Keep this
      // generator (and therefore Circus session ownership) open until it ends.
      await deadline(outcome || turn.completed, {
        timeoutMs: await remainingMuseTurnMs(this._timeouts.turnMs, context, host, options.abortController),
        phase: 'parentCompletion', context, onTimeout: () => host.close(),
      });
      yield* this._observeWorkflow({ host, session, workflow, options, mapper, context });
      return;
    }
    yield* this._finishTurnItems({ host, session, turn, options, mapper, context, outcome });
  }

  async *_observeWorkflow({ host, session, workflow, options, mapper, context }) {
    let cancellationRequested = false;
    host.setAbortHandler(async () => {
      cancellationRequested = true;
      if (typeof session.cancelWorkflow !== 'function') {
        await host.close();
        return;
      }
      await session.cancelWorkflow({ workflowRunId: workflow.workflowRunId });
    });
    const iterator = sessionItems(session)[Symbol.asyncIterator]();
    let revision = workflow.revision;
    try {
      // A replay may already contain the terminal revision that replaced the
      // launch item before the parent turn's completion was observed.
      if (isWorkflowTerminal(workflow.item)) {
        yield* mapper.mapWorkflowTerminal(workflow.item);
        return;
      }
      while (true) {
        const remainingMs = await remainingMuseTurnMs(this._timeouts.turnMs, context, host, options.abortController);
        const next = await deadline(iterator.next(), {
          timeoutMs: remainingMs, phase: 'workflow', context, onTimeout: () => host.close(),
        });
        if (next.done) throw new Error('Muse session item stream ended before the workflow reached a terminal state.');
        const item = next.value;
        const identity = workflowIdentity(item);
        if (!identity || identity.workflowRunId !== workflow.workflowRunId) continue;
        if (identity.revision <= revision) continue;
        revision = identity.revision;
        if (isWorkflowTerminal(item)) {
          yield* mapper.mapWorkflowTerminal(item);
          return;
        }
        yield* mapper.mapItem(item);
      }
    } finally {
      host.setAbortHandler(null);
      await iterator.return?.();
      if (cancellationRequested) context.markCancelled();
    }
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
  // tool output echoed on stderr may carry secret values, including
  // hosts.yml-only tokens invisible to the env-pattern scrub.
  const text = scrubEventForLogging(raw, context.hostEnv || {});
  context.pushStderr(text);
  console.warn(`[muse serve] ${text}`);
}

function waitForAbort(signal) {
  if (!signal) return new Promise(() => {});
  if (signal.aborted) return Promise.resolve({ kind: 'aborted' });
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ kind: 'aborted' }), { once: true }));
}
