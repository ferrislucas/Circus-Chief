import { spawn as defaultSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseAgent, notifyProviderAccepted } from '../BaseAgent.js';
import { awaitCliSpawn, mapPreSpawnError } from './cliSpawnLifecycle.js';

/**
 * Build the provider-acceptance observer for a turn. The returned callback
 * fires at confirmed `muse exec` subprocess start — never on the
 * adapter-synthesized init event, which is local bookkeeping, not provider
 * evidence.
 */
function museAcceptanceNotifier(meta) {
  return (pid) => notifyProviderAccepted(meta, () => ({
    adapterType: 'muse',
    boundary: 'subprocess_start',
    sessionId: meta?.sessionId,
    pid,
  }));
}

const MUSE_CLI_NOT_FOUND_MESSAGE = 'Muse CLI not found. Install Muse Code or set MUSE_BIN.';

/** Map any spawn/start failure to the stable Muse pre-start error shape. */
function mapMuseStartError(err) {
  return mapPreSpawnError(err, {
    notFoundCode: 'MUSE_CLI_NOT_FOUND',
    notFoundMessage: MUSE_CLI_NOT_FOUND_MESSAGE,
  });
}

/**
 * Settle a failed turn: a definitive pre-start failure (missing executable)
 * is a structured rejection, not a stream error — the provider was never
 * reached, so the durable layer must classify it retryable instead of
 * uncertain. Post-start stream failures keep yielding error results.
 */
function *handleMuseTurnError(err) {
  if (err?.code === 'MUSE_CLI_NOT_FOUND') throw err;
  yield { type: 'result', subtype: 'error', is_error: true, error: err?.message || 'Muse exec failed.' };
}

/**
 * Resolve the terminal outcome once the process has exited and both streams
 * have closed. Cancellation wins over exit codes; a terminal JSON record
 * and a clean exit are both required otherwise.
 */
function resolveTerminalOutcome({ stopped, exitCode, stderr, terminal }) {
  if (stopped) return { outcome: 'cancelled' };
  if (exitCode !== 0) throw new Error(stderr || `Muse exec exited with code ${exitCode ?? 'unknown'}.`);
  if (!terminal) throw new Error('Muse exec exited without a terminal result.');
  if (terminal.outcome === 'completed' && !terminal.text) throw new Error('Muse exec completed without a final response.');
  return terminal;
}

/**
 * Wire pre-start cancellation for the spawn wait: an already-aborted turn
 * cancels immediately, an outer abort cancels the wait, and the caller
 * cancels it on the total-turn timeout. The outer listener serves only the
 * wait — detach it once start settles.
 */
function wirePreStartCancellation(signal) {
  const startController = new AbortController();
  const cancelStart = (reason) => {
    if (!startController.signal.aborted) startController.abort(reason);
  };
  const forwardOuterAbort = () => cancelStart(
    signal?.reason instanceof Error ? signal.reason : new Error('Muse exec turn was aborted before process start.'),
  );
  if (signal?.aborted) cancelStart(signal.reason);
  else signal?.addEventListener('abort', forwardOuterAbort);
  return { startController, cancelStart, unforward: () => signal?.removeEventListener('abort', forwardOuterAbort) };
}

/**
 * Spawn the CLI child and wait for confirmed process start. A returned
 * spawner proves nothing: Node reports a missing executable or working
 * directory asynchronously as 'error' with no 'spawn'. Acceptance fires
 * only on confirmed start; a pre-start failure is a definitive rejection,
 * never acceptance. Stream handlers attach only after this resolves.
 */
async function spawnConfirmedChild(spawnFn, spec, env, { startState, cleanup, completion, onAccepted, publish, killGraceMs }) {
  const { startController, unforward } = startState;
  let child;
  try {
    child = spawnFn(spec.command, spec.args, {
      cwd: spec.cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', windowsHide: true,
    });
    // Publish the raw child immediately so timeout/abort escalation can reap
    // it even when confirmation never arrives; acceptance still waits.
    publish?.(child);
    await awaitCliSpawn(child, { signal: startController.signal, killGraceMs });
    onAccepted?.(child?.pid);
  } catch (err) {
    cleanup();
    unforward();
    try { child?.kill?.('SIGTERM'); } catch { /* best effort */ }
    // The start wait settled first, so a later completion settlement must
    // not surface as an unhandled rejection.
    completion.promise.catch(() => {});
    throw mapMuseStartError(err);
  }
  unforward();
  return child;
}
import { buildMuseHostEnv } from './museHostEnv.js';
import { filterDeadSshSocketAsync } from '../../services/loginShellEnv.js';
import { buildMuseExecArgs, MUSE_EXEC_PROMPT_FILE_THRESHOLD } from './museExecArgs.js';
import { composeCliPrompt } from './cliUtils.js';
import { createMuseExecProtocol } from './museExecProtocol.js';
import { createMuseExecEventMapper } from './museExecEventMapper.js';
import { buildTerminalUsage, readMuseSessionUsage, snapshotMuseJournalState } from './museSessionUsage.js';
import { scrubEventForLogging } from '../../services/parityDiagnostics.js';
import logger from '../../logger.js';

/** Hard bound on buffered mapped events per turn so a chatty workflow cannot grow memory without limit. */
export const MAX_MUSE_TURN_EVENTS = 500;

/** FIFO of mapped events with a wake-up for its single draining consumer. */
function createEventQueue() {
  const pending = [];
  let wake = null;
  return {
    push(...items) {
      pending.push(...items);
      this.wake();
    },
    wake() {
      if (wake) { const w = wake; wake = null; w(); }
    },
    async *drain(completion) {
      while (true) {
        while (pending.length) yield pending.shift();
        if (completion.isSettled()) break;
        await new Promise((resolve) => { wake = resolve; });
      }
    },
  };
}

/** One-shot completion gate: first settlement wins, later ones are ignored. */
function trackCompletion() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  let settled = false;
  return {
    promise,
    isSettled: () => settled,
    resolve: (value) => { if (!settled) { settled = true; resolve(value); } },
    reject: (error) => { if (!settled) { settled = true; reject(error); } },
  };
}

/**
 * Best-effort usage enrichment: the CLI stdout stream carries no token
 * counts, but the session journal on disk records real per-turn usage keyed
 * by our --session-id. Never throws — a missing journal just leaves the
 * terminal without usage and the mapper falls back to zeros.
 */
async function attachJournalUsage(terminal, museSessionId, baseline) {
  if (!terminal || terminal.outcome !== 'completed') return;
  try {
    const reading = await readMuseSessionUsage(museSessionId, { baseline });
    Object.assign(terminal, buildTerminalUsage(reading));
  } catch {
    // Journal unavailable; usage stays unset.
  }
}

/** Process-owned Muse CLI transport. A terminal JSON record and clean exit are both required. */
export class MuseExecAdapter extends BaseAgent {
  static capabilities = Object.freeze({ streaming: true, thinking: false, reasoningEffort: true, toolUse: true, resume: true });

  /**
   * @param {Object} [opts]
   * @param {Function} [opts.spawnMuseExec] - Optional DI spawner; the child
   *   must follow the start contract in {@link spawnConfirmedChild}.
   */
  constructor({ spawnMuseExec, sshLivenessProbe, timeouts, ...rest } = {}) {
    super(rest);
    this._spawn = spawnMuseExec || defaultSpawn;
    this._sshLivenessProbe = sshLivenessProbe;
    this._timeouts = { turnMs: 12 * 60 * 60_000, shutdownGraceMs: 2_000, ...(timeouts || {}) };
  }
  getCapabilities() { return { ...MuseExecAdapter.capabilities }; }
  supportsResume() { return true; }

  async *execute(queryParams, meta) {
    const options = queryParams.options || {};
    const mapper = createMuseExecEventMapper({ model: options.model });
    // Finding #3: an already-aborted turn must not spawn a billed `muse
    // exec` child — resolve to the cancelled result before any env, probe,
    // or spawn work happens.
    if (options.abortController?.signal.aborted) {
      yield* mapper.final({ outcome: 'cancelled' });
      return;
    }
    // Muse exec persists its native history under a caller-supplied UUID.
    // The stream handler saves this init id on the active conversation and
    // supplies it as options.resume on follow-up turns.
    const museSessionId = options.resume || randomUUID();
    let env = buildMuseHostEnv(options.env);
    env = (await filterDeadSshSocketAsync(env, this._sshLivenessProbe)).env;
    // Single prompt owner (finding #11): the same composeCliPrompt text
    // feeds both the argv path (inside buildMuseExecArgs) and the
    // prompt-file path below, so the two can never drift.
    const prompt = composeCliPrompt(options.systemPrompt, queryParams.prompt);
    let promptDir = null;
    try {
      if (Buffer.byteLength(prompt) > MUSE_EXEC_PROMPT_FILE_THRESHOLD) {
        promptDir = await mkdtemp(join(tmpdir(), 'circus-muse-'));
        const path = join(promptDir, 'prompt.txt');
        await writeFile(path, prompt, { mode: 0o600 });
        options.__musePromptFile = path;
      }
      const spec = buildMuseExecArgs({ prompt: queryParams.prompt, options, workingDirectory: options.cwd || options.workingDirectory, sessionId: museSessionId, promptFile: options.__musePromptFile });
      yield mapper.init(museSessionId);
      // Fingerprint the journal before spawn so the post-turn usage read
      // ignores entries that predate this turn (finding #4).
      const journalBaseline = await snapshotMuseJournalState(museSessionId);
      const terminal = yield* this._stream(spec, env, options.abortController?.signal, mapper, museAcceptanceNotifier(meta));
      await attachJournalUsage(terminal, museSessionId, journalBaseline);
      yield* mapper.final(terminal);
    } catch (err) {
      yield* handleMuseTurnError(err);
    } finally {
      delete options.__musePromptFile;
      if (promptDir) await rm(promptDir, { recursive: true, force: true });
    }
  }

  /**
   * Stream mapped CLI events as stdout records arrive, resolving with the
   * terminal record once the process lifecycle completes. Parsing continues
   * over every record (sequence validation) even after the mapped-event cap;
   * only mapping is skipped beyond it, and the terminal is always captured.
   * An early consumer break terminates the child so no orphan is left behind.
   */
  // eslint-disable-next-line max-statements
  // eslint-disable-next-line max-params, max-statements -- the acceptance observer travels with this turn's abort signal and mapper; the lifecycle closure is intentionally co-located
  async *_stream(spec, env, signal, mapper, onAccepted) {
    let child = null; let terminal = null; let stdoutClosed = false; let stderrClosed = false; let exited = false; let exitCode = null; let stopped = Boolean(signal?.aborted); let stderr = ''; let mapped = 0;
    // Process lifecycle intentionally keeps all terminal-state reconciliation
    // in one closure so stdout, stderr, exit, timeout, and cancellation share
    // the same state.
    const parser = createMuseExecProtocol({
      onDiagnostic: (diagnostics, message) => logger.error('[MuseExecAdapter] Muse protocol error', { message, diagnostics }),
    });
    const queue = createEventQueue(); const completion = trackCompletion();
    // Every settlement wakes the drain loop so the last of exit/stdout-close/stderr-close cannot leave the consumer parked.
    const fail = (error) => { cleanup(); completion.reject(error); queue.wake(); };
    const finish = () => {
      if (!exited || !stdoutClosed || !stderrClosed) return;
      cleanup(); clearTimeout(killTimer);
      try {
        completion.resolve(resolveTerminalOutcome({ stopped, exitCode, stderr, terminal }));
      } catch (error) { completion.reject(error); }
      queue.wake();
    };
    const terminate = (force = false) => {
      if (!child?.pid) return;
      try {
        process.kill(process.platform === 'win32' ? child.pid : -child.pid, force ? 'SIGKILL' : 'SIGTERM');
      } catch {
        try { child.kill(force ? 'SIGKILL' : 'SIGTERM'); } catch { /* process already exited */ }
      }
    };
    // cleanup() leaves the escalation timer alone: fail() and the drain finally run cleanup while a SIGTERM'd child may live on (finding #1).
    const cleanup = () => {
      clearTimeout(totalTimer); signal?.removeEventListener('abort', stop);
    };
    const armEscalation = () => { clearTimeout(killTimer); killTimer = setTimeout(() => terminate(true), this._timeouts.shutdownGraceMs); };
    const stop = () => { stopped = true; terminate(); armEscalation(); };
    let killTimer;
    // A pre-start abort or timeout must win over a late spawn: neither hang nor late acceptance.
    const preStart = wirePreStartCancellation(signal);
    // Finding #1: timeout escalates like abort — a SIGTERM-ignoring CLI is reaped with SIGKILL after the grace period.
    const totalTimer = setTimeout(() => {
      const timeoutError = new Error(`Muse exec timed out after ${this._timeouts.turnMs}ms.`);
      stopped = true; terminate(); preStart.cancelStart(timeoutError); fail(timeoutError); armEscalation();
    }, this._timeouts.turnMs);
    const ingest = (item) => {
      if (item.kind === 'terminal') {
        terminal = item;
        return;
      }
      if (mapped >= MAX_MUSE_TURN_EVENTS) return;
      const mappedEvents = mapper.map(item);
      mapped += mappedEvents.length;
      if (mappedEvents.length) queue.push(...mappedEvents);
    };
    const onData = (chunk) => {
      try {
        for (const item of parser.push(chunk)) ingest(item);
      } catch (err) { terminate(); armEscalation(); fail(err); }
    };
    child = await spawnConfirmedChild((command, args, opts) => this._spawn(command, args, opts), spec, env,
      { startState: preStart, cleanup, completion, onAccepted,
        publish: (started) => { child = started; }, killGraceMs: this._timeouts.shutdownGraceMs });
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', onData);
    child.stdout.on('close', () => { try { parser.end(); stdoutClosed = true; finish(); } catch (err) { fail(err); } });
    child.stderr.on('data', (chunk) => {
      // Stderr is diagnostic-only, bounded, and scrubbed before retention.
      if (stderr.length < 8192) stderr += scrubEventForLogging(String(chunk), env).slice(0, 8192 - stderr.length);
    });
    child.stderr.on('close', () => { stderrClosed = true; finish(); });
    child.on('error', (err) => { terminate(); armEscalation(); fail(mapMuseStartError(err)); });
    child.on('exit', (code) => { exited = true; exitCode = code; finish(); });
    try {
      yield* queue.drain(completion);
      return await completion.promise;
    } finally {
      // An early consumer break must not orphan the CLI: escalate like every non-natural terminal path.
      if (!completion.isSettled()) { stopped = true; terminate(); armEscalation(); }
      cleanup();
    }
  }
}
