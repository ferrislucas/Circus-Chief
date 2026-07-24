import readline from 'readline';
import { createCodexEventMapper } from './codexEventMapper.js';
import { composeCliPrompt } from './cliUtils.js';

const DEFAULT_STARTUP_TIMEOUT_MS = 30000;
const KILL_ESCALATION_MS = 2000;

export async function *executeCodexCli(child, queryParams, options, markCliUnavailable) {
  const state = new CliState(options.model, markCliUnavailable);
  const startupTimeoutMs = resolveStartupTimeoutMs(options);

  attachAbortHandling(child, options.abortController, state);
  writePromptToStdin(child, composeCliPrompt(options.systemPrompt, queryParams.prompt));
  attachStdoutReader(child, state);
  attachStderrReader(child, state);
  attachProcessLifecycleHandlers(child, state);
  startStartupTimeoutTimer(child, state, startupTimeoutMs);

  try {
    yield* drainCliEvents(state);
  } finally {
    cleanupCli(options.abortController, state);
  }
}

/**
 * Resolve the startup (first-event) timeout, in ms.
 *
 * Precedence: explicit `options.startupTimeoutMs` > `CODEX_CLI_STARTUP_TIMEOUT_MS`
 * env var > default (30s). `0` disables the timeout entirely.
 */
function resolveStartupTimeoutMs(options) {
  if (options.startupTimeoutMs != null) return options.startupTimeoutMs;
  const envValue = process.env.CODEX_CLI_STARTUP_TIMEOUT_MS;
  if (envValue != null && envValue !== '') {
    const parsed = Number(envValue);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return DEFAULT_STARTUP_TIMEOUT_MS;
}

class CliState {
  constructor(model, markCliUnavailable) {
    this.pending = [];
    this.error = null;
    this.ended = false;
    this.resolveNext = null;
    this.rejectAll = null;
    this.mapper = createCodexEventMapper({ model });
    this.rl = null;
    this.killTimer = null;
    this.onAbort = null;
    this.stderrBuffer = '';
    this.markCliUnavailable = markCliUnavailable;
    this.startupTimer = null;
    this.receivedFirstEvent = false;
  }

  assign(patch) {
    Object.assign(this, patch);
  }

  pushEvents(events) {
    if (events.length > 0 && !this.receivedFirstEvent) {
      this.receivedFirstEvent = true;
      clearTimeout(this.startupTimer);
    }
    for (const event of events) this.pending.push(event);
    this.tickWaiter();
  }

  tickWaiter() {
    if (!this.resolveNext) return;
    const resolve = this.resolveNext;
    this.resolveNext = null;
    resolve();
  }

  failWith(error) {
    this.error = error;
    if (this.rejectAll) this.rejectAll(error);
  }

  markEnded() {
    this.ended = true;
  }
}

/**
 * Kill the child with SIGTERM, escalating to SIGKILL after a grace period.
 * Idempotent: a no-op if a kill escalation is already in progress.
 */
function killChildGradually(child, state) {
  if (state.killTimer) return;
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  const timer = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }, KILL_ESCALATION_MS);
  state.assign({ killTimer: timer });
}

function attachAbortHandling(child, abortController, state) {
  const onAbort = () => killChildGradually(child, state);
  state.assign({ onAbort });
  abortController?.signal?.addEventListener('abort', onAbort);
}

function writePromptToStdin(child, prompt) {
  try {
    if (child.stdin) child.stdin.end(prompt ?? '');
  } catch { /* ignore */ }
}

function attachStdoutReader(child, state) {
  const rl = readline.createInterface({ input: child.stdout });
  state.assign({ rl });
  rl.on('line', (line) => handleCliStdoutLine(line, state));
}

function handleCliStdoutLine(line, state) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }
  try {
    const mapped = state.mapper.map(parsed);
    if (mapped.length > 0) state.pushEvents(mapped);
  } catch (error) {
    state.failWith(error);
  }
}

function attachStderrReader(child, state) {
  if (!child.stderr) return;
  child.stderr.on('data', (chunk) => {
    if (state.error || state.ended) return;
    state.assign({ stderrBuffer: state.stderrBuffer + chunk.toString() });
  });
}

function attachProcessLifecycleHandlers(child, state) {
  child.on('error', (error) => {
    if (error?.code === 'ENOENT') {
      state.markCliUnavailable?.();
      state.failWith(makeCliNotFoundError());
      return;
    }
    state.failWith(error);
  });

  child.on('exit', (code) => handleChildExit(code, state));
}

function makeCliNotFoundError() {
  const error = new Error('Codex CLI not found');
  error.code = 'CODEX_CLI_NOT_FOUND';
  return error;
}

function handleChildExit(code, state) {
  state.markEnded();
  if (code !== 0 && !state.error) {
    state.failWith(makeCliExitError(code, state.stderrBuffer));
  } else if (!state.error) {
    finalizeMappedEvents(state);
  }
  state.tickWaiter();
}

function makeCliExitError(code, stderrBuffer) {
  const stderrTrimmed = stderrBuffer.trim();
  const error = stderrTrimmed.length > 0
    ? new Error(stderrTrimmed)
    : new Error(`Codex CLI exited with code ${code}`);
  error.code = 'CODEX_CLI_EXIT';
  error.exitCode = code;
  return error;
}

function finalizeMappedEvents(state) {
  try {
    const events = state.mapper.finalize();
    if (events.length > 0) state.pushEvents(events);
  } catch { /* ignore */ }
}

/**
 * Start the startup (first-event) timeout. A no-op when `startupTimeoutMs`
 * is 0 (escape hatch) or falsy.
 */
function startStartupTimeoutTimer(child, state, startupTimeoutMs) {
  if (!startupTimeoutMs) return;
  state.assign({
    startupTimer: setTimeout(() => onStartupTimeout(state, child, startupTimeoutMs), startupTimeoutMs),
  });
}

function onStartupTimeout(state, child, startupTimeoutMs) {
  if (state.receivedFirstEvent || state.ended || state.error) return;
  killChildGradually(child, state);
  state.failWith(makeStartupTimeoutError(startupTimeoutMs));
}

function makeStartupTimeoutError(startupTimeoutMs) {
  const seconds = Math.round(startupTimeoutMs / 1000);
  const error = new Error(
    `Codex CLI produced no output within ${seconds}s. Ensure the Codex CLI is installed `
    + '(`npm i -g @openai/codex@latest`), authenticated (`codex login`), and not blocked by the OS.',
  );
  error.code = 'CODEX_CLI_STARTUP_TIMEOUT';
  return error;
}

async function *drainCliEvents(state) {
  while (true) {
    if (state.error) throw state.error;
    if (state.pending.length > 0) {
      yield state.pending.shift();
      continue;
    }
    if (state.ended) break;
    await new Promise((resolve, reject) => {
      state.assign({ resolveNext: resolve, rejectAll: reject });
    });
  }
  if (state.error) throw state.error;
}

function cleanupCli(abortController, state) {
  if (state.onAbort) {
    abortController?.signal?.removeEventListener('abort', state.onAbort);
  }
  if (state.killTimer) clearTimeout(state.killTimer);
  if (state.startupTimer) clearTimeout(state.startupTimer);
  try { state.rl?.close(); } catch { /* ignore */ }
}
