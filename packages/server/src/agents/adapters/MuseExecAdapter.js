import { spawn as defaultSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseAgent } from '../BaseAgent.js';
import { buildMuseHostEnv } from './museHostEnv.js';
import { filterDeadSshSocketAsync } from '../../services/loginShellEnv.js';
import { buildMuseExecArgs, MUSE_EXEC_PROMPT_FILE_THRESHOLD } from './museExecArgs.js';
import { createMuseExecProtocol } from './museExecProtocol.js';
import { createMuseExecEventMapper } from './museExecEventMapper.js';
import { scrubEventForLogging } from '../../services/parityDiagnostics.js';

/** Process-owned Muse CLI transport. A terminal JSON record and clean exit are both required. */
export class MuseExecAdapter extends BaseAgent {
  static capabilities = Object.freeze({ streaming: true, thinking: false, reasoningEffort: true, toolUse: true, resume: true });

  constructor({ spawnMuseExec, sshLivenessProbe, timeouts, ...rest } = {}) {
    super(rest);
    this._spawn = spawnMuseExec || defaultSpawn;
    this._sshLivenessProbe = sshLivenessProbe;
    this._timeouts = { startupMs: 30_000, turnMs: 15 * 60_000, shutdownGraceMs: 2_000, ...(timeouts || {}) };
  }
  getCapabilities() { return { ...MuseExecAdapter.capabilities }; }
  supportsResume() { return true; }

  async *execute(queryParams) {
    const options = queryParams.options || {};
    const cwd = options.cwd || options.workingDirectory;
    const mapper = createMuseExecEventMapper({ model: options.model });
    // Muse exec persists its native history under a caller-supplied UUID.
    // The stream handler saves this init id on the active conversation and
    // supplies it as options.resume on follow-up turns.
    const museSessionId = options.resume || randomUUID();
    let env = buildMuseHostEnv(options.env);
    env = (await filterDeadSshSocketAsync(env, this._sshLivenessProbe)).env;
    const prompt = `${options.systemPrompt ? `SYSTEM PROMPT:\n${options.systemPrompt}\n\nUSER:\n` : ''}${queryParams.prompt || ''}`;
    let promptDir = null;
    try {
      if (Buffer.byteLength(prompt) > MUSE_EXEC_PROMPT_FILE_THRESHOLD) {
        promptDir = await mkdtemp(join(tmpdir(), 'circus-muse-'));
        const path = join(promptDir, 'prompt.txt');
        await writeFile(path, prompt, { mode: 0o600 });
        options.__musePromptFile = path;
      }
      const spec = buildMuseExecArgs({ prompt: queryParams.prompt, options, workingDirectory: cwd, sessionId: museSessionId, promptFile: options.__musePromptFile });
      yield mapper.init(museSessionId);
      const outcome = await this._run(spec, env, options.abortController?.signal, mapper);
      for (const event of outcome.events) yield event;
      yield* mapper.final(outcome.terminal);
    } catch (err) {
      yield { type: 'result', subtype: 'error', is_error: true, error: err?.message || 'Muse exec failed.' };
    } finally {
      delete options.__musePromptFile;
      if (promptDir) await rm(promptDir, { recursive: true, force: true });
    }
  }

  _run(spec, env, signal, mapper) {
    // Process lifecycle intentionally keeps all terminal-state reconciliation
    // in one closure so stdout, stderr, exit, timeout, and cancellation share
    // the same state.
    // eslint-disable-next-line max-statements
    return new Promise((resolve, reject) => {
      let child; let terminal = null; let stdoutClosed = false; let stderrClosed = false; let exited = false; let exitCode = null; let stopped = Boolean(signal?.aborted); let stderr = ''; const events = [];
      const parser = createMuseExecProtocol();
      const finish = () => {
        if (!exited || !stdoutClosed || !stderrClosed) return;
        clearTimeout(totalTimer); clearTimeout(killTimer); signal?.removeEventListener('abort', stop);
        if (stopped) return resolve({ terminal: { outcome: 'cancelled' }, events });
        if (exitCode !== 0) return reject(new Error(stderr || `Muse exec exited with code ${exitCode ?? 'unknown'}.`));
        if (!terminal) return reject(new Error('Muse exec exited without a terminal result.'));
        if (terminal.outcome === 'completed' && !terminal.text) return reject(new Error('Muse exec completed without a final response.'));
        resolve({ terminal, events });
      };
      const terminate = (force = false) => {
        if (!child?.pid) return;
        try {
          process.kill(process.platform === 'win32' ? child.pid : -child.pid, force ? 'SIGKILL' : 'SIGTERM');
        } catch {
          try { child.kill(force ? 'SIGKILL' : 'SIGTERM'); } catch { /* process already exited */ }
        }
      };
      const stop = () => { stopped = true; terminate(); killTimer = setTimeout(() => terminate(true), this._timeouts.shutdownGraceMs); };
      let killTimer;
      const totalTimer = setTimeout(() => { stopped = true; terminate(); reject(new Error(`Muse exec timed out after ${this._timeouts.turnMs}ms.`)); }, this._timeouts.turnMs);
      try {
        child = this._spawn(spec.command, spec.args, { cwd: spec.cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
      } catch (err) { clearTimeout(totalTimer); reject(err); return; }
      signal?.addEventListener('abort', stop, { once: true });
      child.stdout.on('data', (chunk) => { try { for (const item of parser.push(chunk)) { if (item.kind === 'terminal') terminal = item; else events.push(...mapper.map(item)); } } catch (err) { terminate(); reject(err); } });
      child.stdout.on('close', () => { try { parser.end(); stdoutClosed = true; finish(); } catch (err) { reject(err); } });
      child.stderr.on('data', (chunk) => {
        // Stderr is diagnostic-only, bounded, and scrubbed before retention.
        if (stderr.length < 8192) stderr += scrubEventForLogging(String(chunk), env).slice(0, 8192 - stderr.length);
      });
      child.stderr.on('close', () => { stderrClosed = true; finish(); });
      child.on('error', (err) => { clearTimeout(totalTimer); reject(err.code === 'ENOENT' ? new Error('Muse CLI not found. Install Muse Code or set MUSE_BIN.') : err); });
      child.on('exit', (code) => { exited = true; exitCode = code; finish(); });
    });
  }
}
