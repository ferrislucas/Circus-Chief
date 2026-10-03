import { spawn as nodeSpawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { MUSE_SUMMARY_MODELS } from '@circuschief/shared';
import { createMuseExecProtocol } from '../agents/adapters/museExecProtocol.js';
import { MUSE_EXEC_PROMPT_FILE_THRESHOLD } from '../agents/adapters/museExecArgs.js';
import { createRobustEnv } from './nodeSpawnHelper.js';

// Reasoning models can take longer than an ordinary chat completion. Callers
// may still supply a shorter timeout for an explicitly latency-sensitive flow.
export const MUSE_SUMMARY_TIMEOUT_MS = 180_000;
const MAX_STDERR_BYTES = 16 * 1024;
const MAX_STDOUT_BYTES = 1024 * 1024;
const AUTH_FAILURE_PATTERNS = ['not logged in', 'login', 'authentication', 'authenticate', 'unauthorized', 'muse auth'];
const MUSE_BIN = process.env.MUSE_BIN || 'muse';

/** An error which is safe to show to a user or put in normal logs. */
export class MuseSummaryError extends Error {
  constructor(code, publicMessage) {
    super(publicMessage);
    this.code = code;
    this.publicMessage = publicMessage;
    this.isMuseSummaryError = true;
  }
}

export function isSupportedMuseSummaryModel(model) {
  return MUSE_SUMMARY_MODELS.includes(model);
}

export function buildMuseSummaryArgs({ model, schemaPath, cwd, promptFile, prompt }) {
  const args = [
    'exec', '--json', '--no-session-log', '--workspace', cwd,
    '--model', model, '--output-schema', schemaPath,
  ];
  if (promptFile) args.push('--prompt-file', promptFile);
  else args.push(prompt);
  return args;
}

export function buildMuseSummaryPrompt(systemPrompt, prompt) {
  return `${systemPrompt || ''}\n\n${prompt || ''}\n\nReturn only the requested JSON summary. Do not use tools or modify files.`.trim();
}

function defaultMuseSpawn({ command, args, cwd, env, signal }) {
  const actualCommand = command === 'node' ? process.execPath : command;
  return nodeSpawn(actualCommand, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    signal,
    env: createRobustEnv(env),
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
}

export async function callMuseSummary({ prompt, systemPrompt, model, jsonSchema, timeoutMs = MUSE_SUMMARY_TIMEOUT_MS, cwd, workingDirectory }, dependencies = {}) {
  if (!isSupportedMuseSummaryModel(model)) {
    throw new MuseSummaryError(
      'MUSE_SUMMARY_UNSUPPORTED_MODEL',
      `The selected summary model "${model}" is not supported by the installed Muse summary integration. Choose a supported built-in Muse model.`,
    );
  }

  const fs = dependencies.fs || { mkdtemp, rm, writeFile };
  const spawn = dependencies.spawn || defaultMuseSpawn;
  const workspaceDir = cwd || workingDirectory || dependencies.cwd || os.tmpdir();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'circuschief-muse-summary-'));
  const schemaPath = path.join(tempDir, 'summary-schema.json');
  const abortController = new AbortController();
  let timer;

  try {
    await fs.writeFile(schemaPath, JSON.stringify(jsonSchema), 'utf8');
    const args = await buildSummaryInvocation({ fs, systemPrompt, prompt, model, schemaPath, workspaceDir, tempDir });
    return await executeMuseChild({
      spawn, command: dependencies.command || MUSE_BIN, args, workspaceDir,
      env: dependencies.env || process.env, timeoutMs, abortController,
      setTimer: (value) => { timer = value; },
    });
  } catch (error) {
    if (error?.isMuseSummaryError) throw error;
    throw classifyMuseError(error);
  } finally {
    if (timer) clearTimeout(timer);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function executeMuseChild({ spawn, command, args, workspaceDir, env, timeoutMs, abortController, setTimer }) {
  const child = spawn({ command, args, cwd: workspaceDir, env, signal: abortController.signal });
  const stdout = await runChild({ child, timeoutMs, abortController, setTimer });
  const result = extractTerminalText(stdout);
  if (!result.trim()) throw new MuseSummaryError('MUSE_SUMMARY_MALFORMED_OUTPUT', 'Muse did not return a valid summary. Please try again.');
  return result.trim();
}

async function buildSummaryInvocation({ fs, systemPrompt, prompt, model, schemaPath, workspaceDir, tempDir }) {
  const text = buildMuseSummaryPrompt(systemPrompt, prompt);
  if (Buffer.byteLength(text) > MUSE_EXEC_PROMPT_FILE_THRESHOLD) {
    const promptFile = path.join(tempDir, 'prompt.txt');
    await fs.writeFile(promptFile, text, 'utf8');
    return buildMuseSummaryArgs({ model, schemaPath, cwd: workspaceDir, promptFile });
  }
  return buildMuseSummaryArgs({ model, schemaPath, cwd: workspaceDir, prompt: text });
}

function runChild({ child, timeoutMs, abortController, setTimer }) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, stdout) => {
      if (finished) return;
      finished = true;
      if (error) reject(error); else resolve(stdout);
    };
    const timer = setTimeout(() => {
      abortController.abort();
      try { child.kill?.('SIGTERM'); } catch { /* ignore */ }
      finish(new MuseSummaryError('MUSE_SUMMARY_TIMEOUT', 'Muse summary generation timed out. Please try again.'));
    }, timeoutMs);
    setTimer(timer);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      stdout = `${stdout}${text}`.slice(-MAX_STDOUT_BYTES);
    });
    child.stderr?.on('data', (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      stderr = `${stderr}${text}`.slice(-MAX_STDERR_BYTES);
    });
    child.once('error', (error) => finish(Object.assign(error, { stderr })));
    child.once('exit', (code) => finish(code === 0 ? null : Object.assign(new Error('Muse exited'), { exitCode: code, stderr }), stdout));
  });
}

function extractTerminalText(stdout) {
  const parser = createMuseExecProtocol();
  let terminalText = null;
  try {
    for (const item of parser.push(stdout)) {
      if (item?.kind === 'terminal' && item?.outcome === 'completed' && typeof item?.text === 'string') {
        terminalText = item.text;
      }
    }
  } catch {
    throw new MuseSummaryError('MUSE_SUMMARY_MALFORMED_OUTPUT', 'Muse did not return a valid summary. Please try again.');
  }
  if (terminalText == null) {
    throw new MuseSummaryError('MUSE_SUMMARY_MALFORMED_OUTPUT', 'Muse did not return a valid summary. Please try again.');
  }
  return terminalText;
}

function classifyMuseError(error) {
  if (error?.code === 'ENOENT') {
    return new MuseSummaryError('MUSE_SUMMARY_CLI_NOT_FOUND', 'Muse CLI is not installed. Install Muse Code and ensure `muse` is on PATH (or set MUSE_BIN).');
  }
  const detail = `${error?.message || ''} ${error?.stderr || ''}`.toLowerCase();
  if (AUTH_FAILURE_PATTERNS.some((pattern) => detail.includes(pattern))) {
    return new MuseSummaryError('MUSE_SUMMARY_AUTHENTICATION', 'Muse is not authenticated. Run `muse auth` and try again.');
  }
  return new MuseSummaryError('MUSE_SUMMARY_NON_ZERO_EXIT', 'Muse could not generate a summary. Please try again.');
}
