import { spawn as nodeSpawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { createRobustEnv } from './nodeSpawnHelper.js';
import { sanitizeString } from './errorSanitizer.js';
import { matchesStartFailoverEligibleError } from './sessionErrors.js';

// Reasoning models can take longer than an ordinary chat completion. Callers
// may still supply a shorter timeout for an explicitly latency-sensitive flow.
export const GROK_SUMMARY_TIMEOUT_MS = 180_000;
const MAX_STDERR_BYTES = 16 * 1024;
const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_FAILOVER_REASON_CHARS = 500;
const AUTH_FAILURE_PATTERNS = ['not logged in', 'grok login', 'authentication', 'authenticate', 'unauthorized'];
const SCRUBBED_ENV_KEYS = new Set([
  'XAI_API_KEY',
  'OPENAI_API_KEY', 'OPENAI_API_BASE', 'OPENAI_BASE_URL', 'OPENAI_ORGANIZATION', 'OPENAI_ORG_ID',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'PROVIDER_TOKEN',
]);

/** An error which is safe to show to a user or put in normal logs. */
export class GrokSummaryError extends Error {
  constructor(code, publicMessage) {
    super(publicMessage);
    this.code = code;
    this.publicMessage = publicMessage;
    this.isGrokSummaryError = true;
  }
}

export function buildGrokSummaryArgs({ model, schema, promptFile, cwd }) {
  return [
    '--prompt-file', promptFile,
    '--cwd', cwd,
    '-m', model,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    '--max-turns', '1',
    '--no-plan',
    '--no-subagents',
    '--disable-web-search',
    '--verbatim',
    '--permission-mode', 'dontAsk',
    '--sandbox', 'read-only',
  ];
}

export function buildGrokSummaryEnv(parentEnv = process.env) {
  const env = { ...parentEnv };
  // Grok Build authenticates with the host CLI login. A copied API key would
  // switch this isolated summary into a different credential than sessions use.
  for (const key of Object.keys(env)) {
    if (SCRUBBED_ENV_KEYS.has(key) || /^XAI_.*(?:API_KEY|AUTH_TOKEN|TOKEN|SECRET)$/i.test(key)) delete env[key];
  }
  return env;
}

export function buildGrokSummaryPrompt(systemPrompt, prompt) {
  return `${systemPrompt || ''}\n\n${prompt || ''}\n\nReturn only the requested JSON summary. Do not use tools or modify files.`.trim();
}

function defaultGrokSpawn({ command, args, cwd, env, signal }) {
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

export async function callGrokSummary({
  prompt, systemPrompt, model, jsonSchema, timeoutMs = GROK_SUMMARY_TIMEOUT_MS, cwd, workingDirectory,
}, dependencies = {}) {
  const fs = dependencies.fs || { mkdtemp, rm, writeFile };
  const spawn = dependencies.spawn || defaultGrokSpawn;
  const workspaceDir = cwd || workingDirectory || dependencies.cwd;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'circuschief-grok-summary-'));
  const promptFile = path.join(tempDir, 'prompt.txt');
  const summaryCwd = workspaceDir || tempDir;
  const abortController = new AbortController();
  let timer;

  try {
    await fs.writeFile(promptFile, buildGrokSummaryPrompt(systemPrompt, prompt), 'utf8');
    const stdout = await executeGrokChild({
      spawn,
      command: dependencies.command || 'grok',
      args: buildGrokSummaryArgs({ model, schema: jsonSchema, promptFile, cwd: summaryCwd }),
      cwd: summaryCwd,
      env: buildGrokSummaryEnv(dependencies.env || process.env),
      timeoutMs,
      abortController,
      setTimer: (value) => { timer = value; },
      killProcessGroup: dependencies.killProcessGroup,
    });
    const result = extractGrokSummaryText(stdout);
    if (!result) throw new GrokSummaryError('GROK_SUMMARY_MALFORMED_OUTPUT', 'Grok did not return a valid summary. Please try again.');
    return result;
  } catch (error) {
    if (error?.isGrokSummaryError) throw error;
    throw classifyGrokError(error);
  } finally {
    if (timer) clearTimeout(timer);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function killGrokSummaryChild(child, killProcessGroup) {
  const killGroup = killProcessGroup || ((pid, signal) => process.kill(pid, signal));
  if (child?.pid && process.platform !== 'win32') {
    try {
      killGroup(-child.pid, 'SIGTERM');
      return;
    } catch {
      // No group to signal — fall through to the direct kill.
    }
  }
  try { child.kill?.('SIGTERM'); } catch { /* ignore */ }
}

function executeGrokChild({ spawn, command, args, cwd, env, timeoutMs, abortController, setTimer, killProcessGroup }) {
  const child = spawn({ command, args, cwd, env, signal: abortController.signal });
  return runChild({ child, timeoutMs, abortController, setTimer, killProcessGroup });
}

function runChild({ child, timeoutMs, abortController, setTimer, killProcessGroup }) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, stdout) => {
      if (finished) return;
      finished = true;
      if (error) reject(error); else resolve(stdout);
    };
    const timer = setTimeout(() => {
      abortController.abort();
      killGrokSummaryChild(child, killProcessGroup);
      finish(new GrokSummaryError('GROK_SUMMARY_TIMEOUT', 'Grok summary generation timed out. Please try again.'));
    }, timeoutMs);
    setTimer(timer);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk, MAX_STDOUT_BYTES);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk, MAX_STDERR_BYTES);
    });
    child.once('error', (error) => finish(Object.assign(error, { stderr, stdout })));
    child.once('exit', (code) => {
      if (code === 0) { finish(null, stdout); return; }
      finish(Object.assign(new Error('Grok exited'), { exitCode: code, stderr, stdout }));
    });
  });
}

function appendBounded(current, chunk, maxBytes) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  return `${current}${text}`.slice(-maxBytes);
}

/**
 * Summary text from `grok --prompt-file --output-format json`. The headless
 * object carries `text`. `--json-schema` may also set `structured_output`.
 * @param {string} stdout
 * @returns {string|null}
 */
export function extractGrokSummaryText(stdout) {
  const payload = lastJsonObject(stdout);
  if (!payload || payload.type === 'error') return null;
  if (payload.structured_output && typeof payload.structured_output === 'object') {
    return JSON.stringify(payload.structured_output);
  }
  if (typeof payload.text === 'string' && payload.text.trim()) return payload.text.trim();
  if (typeof payload.result === 'string' && payload.result.trim()) return payload.result.trim();
  if (typeof payload.short_summary === 'string') return JSON.stringify(payload);
  return null;
}

function lastJsonObject(stdout) {
  const objects = jsonObjects(stdout);
  return objects.length ? objects[objects.length - 1] : null;
}

function jsonObjects(stdout) {
  const objects = [];
  const text = String(stdout || '').trim();
  if (!text) return objects;
  if (text.startsWith('{')) {
    try {
      objects.push(JSON.parse(text));
      return objects;
    } catch { /* NDJSON or a trailing diagnostic line */ }
  }
  for (const line of text.split('\n')) {
    const candidate = line.trim();
    if (!candidate.startsWith('{')) continue;
    try { objects.push(JSON.parse(candidate)); } catch { /* partial line */ }
  }
  return objects;
}

function extractGrokFailureMessage(stdout) {
  for (const payload of jsonObjects(stdout)) {
    if (payload?.type === 'error' && typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message.trim();
    }
  }
  return null;
}

function classifyGrokError(error) {
  if (error?.code === 'ENOENT') {
    return new GrokSummaryError('GROK_SUMMARY_CLI_NOT_FOUND', 'Grok CLI is not installed. Install Grok Build and run `grok login`.');
  }
  const providerMessage = extractGrokFailureMessage(error?.stdout);
  const detail = `${error?.message || ''} ${error?.stderr || ''} ${providerMessage || ''}`.toLowerCase();
  if (AUTH_FAILURE_PATTERNS.some((pattern) => detail.includes(pattern))) {
    return new GrokSummaryError('GROK_SUMMARY_AUTHENTICATION', 'Grok is not authenticated. Run `grok login` and try again.');
  }
  const classified = new GrokSummaryError('GROK_SUMMARY_NON_ZERO_EXIT', 'Grok could not generate a summary. Please try again.');
  const sentence = failoverSentence(providerMessage, error?.stderr);
  if (sentence) {
    classified.reason = sentence;
    classified.detail = sentence;
  }
  return classified;
}

function failoverSentence(providerMessage, stderr) {
  for (const candidate of [providerMessage, stderr]) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    if (!matchesStartFailoverEligibleError(candidate)) continue;
    const sanitized = sanitizeString(candidate).replace(/[\r\n\t]+/g, ' ').trim();
    if (sanitized) return sanitized.slice(0, MAX_FAILOVER_REASON_CHARS);
  }
  return null;
}
