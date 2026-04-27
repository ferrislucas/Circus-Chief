import readline from 'readline';
import { createCodexEventMapper } from './codexEventMapper.js';

export async function *executeCodexCli(child, queryParams, options, markCliUnavailable) {
  const state = new CliState(options.model, markCliUnavailable);

  attachAbortHandling(child, options.abortController, state);
  writePromptToStdin(child, composeCliPrompt(options.systemPrompt, queryParams.prompt));
  attachStdoutReader(child, state);
  attachStderrReader(child, state);
  attachProcessLifecycleHandlers(child, state);

  try {
    yield* drainCliEvents(state);
  } finally {
    cleanupCli(options.abortController, state);
  }
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
  }

  assign(patch) {
    Object.assign(this, patch);
  }

  pushEvents(events) {
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

function attachAbortHandling(child, abortController, state) {
  const onAbort = () => {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }, 2000);
    state.assign({ killTimer: timer });
  };
  state.assign({ onAbort });
  abortController?.signal?.addEventListener('abort', onAbort);
}

function writePromptToStdin(child, prompt) {
  try {
    if (child.stdin) child.stdin.end(prompt ?? '');
  } catch { /* ignore */ }
}

function composeCliPrompt(systemPrompt, prompt) {
  const user = prompt ?? '';
  if (typeof systemPrompt === 'string' && systemPrompt.length > 0) {
    return `SYSTEM PROMPT:\n${systemPrompt}\n\nUSER:\n${user}`;
  }
  return user;
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
  try { state.rl?.close(); } catch { /* ignore */ }
}
