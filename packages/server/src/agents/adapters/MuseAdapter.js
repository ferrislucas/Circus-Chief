import { BaseAgent } from '../BaseAgent.js';
import { composeCliPrompt } from './cliUtils.js';
import { createRobustEnv } from '../../services/nodeSpawnHelper.js';
import { filterDeadSshSocket } from '../../services/loginShellEnv.js';
import { createMuseEventMapper } from './museEventMapper.js';

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
  constructor({ museClientFactory, ...rest } = {}) {
    super(rest);
    this._museClientFactory = museClientFactory;
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
    const host = await this._openHost(options);
    try {
      yield* this._runTurn(host.client, queryParams, options, mapper);
    } finally {
      host.detach();
      await host.close();
      yield* mapper.finalize();
    }
  }

  /**
   * Spawn the `muse serve` host. Returns the client plus lifecycle helpers:
   * idempotent `close()` (also triggered by abort, to unblock iterators)
   * and `detach()` to remove the abort listener once the turn settles.
   */
  async _openHost(options) {
    const factory = this._museClientFactory ?? spawnMuseClient;
    let client;
    try {
      client = await factory({
        museBin: process.env.MUSE_BIN || 'muse',
        env: buildMuseHostEnv(options.env),
        onStderr: (chunk) => logMuseStderr(chunk),
      });
    } catch (err) {
      throw toMuseNotFoundError(err);
    }

    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      try {
        await client.close();
      } catch (err) {
        console.warn(`[MuseAdapter] Error closing Muse host: ${err?.message || err}`);
      }
    };
    const abortSignal = options.abortController?.signal;
    const onAbort = () => { void close(); };
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    return {
      client,
      close,
      detach: () => abortSignal?.removeEventListener('abort', onAbort),
    };
  }

  async *_runTurn(client, queryParams, options, mapper) {
    const session = await openMspSession(client, options);
    yield mapper.buildSystemInit(session.sessionId);
    registerApprovalHandlers(session);

    const turn = await session.sendUserTurn({
      input: [{ type: 'text', text: composeCliPrompt(options.systemPrompt, queryParams.prompt) }],
      ...(options.displayText ? { displayText: options.displayText } : {}),
      ...museReasoningEffortParam(options.effortLevel),
    });

    const abortSignal = options.abortController?.signal;
    for await (const item of turn.items()) {
      if (abortSignal?.aborted) break;
      yield* mapper.mapItem(item);
    }

    yield* mapper.mapOutcome(await turn.completed);
  }
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
