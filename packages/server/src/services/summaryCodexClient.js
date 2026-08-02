import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { CODEX_SUMMARY_MODELS } from '@circuschief/shared';
import { createCodexSpawner } from './codexSpawnHelper.js';

// Reasoning models can take longer than an ordinary chat completion. Callers
// may still supply a shorter timeout for an explicitly latency-sensitive flow.
export const CODEX_SUMMARY_TIMEOUT_MS = 180_000;
const MAX_STDERR_BYTES = 16 * 1024;
const AUTH_FAILURE_PATTERNS = ['not logged in', 'login', 'authentication', 'authenticate', 'unauthorized'];
const SCRUBBED_ENV_KEYS = new Set([
  'OPENAI_API_KEY', 'OPENAI_API_BASE', 'OPENAI_BASE_URL', 'OPENAI_ORGANIZATION', 'OPENAI_ORG_ID',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'PROVIDER_TOKEN',
]);

/** An error which is safe to show to a user or put in normal logs. */
export class CodexSummaryError extends Error {
  constructor(code, publicMessage) {
    super(publicMessage);
    this.code = code;
    this.publicMessage = publicMessage;
    this.isCodexSummaryError = true;
  }
}

export function isSupportedCodexSummaryModel(model) {
  return CODEX_SUMMARY_MODELS.includes(model);
}

export function buildCodexSummaryArgs({ model, schemaPath, outputPath }) {
  return [
    'exec', '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules',
    '--skip-git-repo-check', '--sandbox', 'read-only', '-m', model,
    '--output-schema', schemaPath, '--output-last-message', outputPath,
    '-c', 'preferred_auth_method=chatgpt',
  ];
}

export function buildCodexSummaryEnv(parentEnv = process.env) {
  const env = { ...parentEnv };
  // The CLI's persisted ChatGPT auth remains available through CODEX_HOME. API
  // credentials must not change this isolated invocation into an API call.
  for (const key of Object.keys(env)) {
    if (SCRUBBED_ENV_KEYS.has(key) || /^OPENAI_.*(?:API_KEY|AUTH_TOKEN|TOKEN)$/i.test(key)) delete env[key];
  }
  return env;
}

export function buildSummaryStdin(systemPrompt, prompt) {
  return `${systemPrompt || ''}\n\n${prompt || ''}\n\nReturn only the requested JSON summary. Do not use tools or modify files.`.trim();
}

export async function callCodexSummary({ prompt, systemPrompt, model, jsonSchema, timeoutMs = CODEX_SUMMARY_TIMEOUT_MS }, dependencies = {}) {
  if (!isSupportedCodexSummaryModel(model)) {
    throw new CodexSummaryError(
      'CODEX_SUMMARY_UNSUPPORTED_MODEL',
      `The selected summary model "${model}" is not supported by the installed Codex summary integration. Choose a supported built-in Codex model.`,
    );
  }

  const fs = dependencies.fs || { mkdtemp, readFile, rm, writeFile };
  const spawn = dependencies.spawn || createCodexSpawner();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'circuschief-summary-'));
  const schemaPath = path.join(tempDir, 'summary-schema.json');
  const outputPath = path.join(tempDir, 'final-message.json');
  const abortController = new AbortController();
  let timer;

  try {
    await fs.writeFile(schemaPath, JSON.stringify(jsonSchema), 'utf8');
    const child = spawn({
      command: 'codex',
      args: buildCodexSummaryArgs({ model, schemaPath, outputPath }),
      cwd: tempDir,
      env: buildCodexSummaryEnv(dependencies.env || process.env),
      signal: abortController.signal,
    });
    await runChild({
      child, stdin: buildSummaryStdin(systemPrompt, prompt), timeoutMs, abortController,
      setTimer: (value) => { timer = value; },
    });
    let result;
    try {
      result = await fs.readFile(outputPath, 'utf8');
    } catch {
      throw new CodexSummaryError('CODEX_SUMMARY_MALFORMED_OUTPUT', 'Codex did not return a valid summary. Please try again.');
    }
    if (!result.trim()) throw new CodexSummaryError('CODEX_SUMMARY_MALFORMED_OUTPUT', 'Codex did not return a valid summary. Please try again.');
    return result.trim();
  } catch (error) {
    if (error?.isCodexSummaryError) throw error;
    throw classifyCodexError(error);
  } finally {
    if (timer) clearTimeout(timer);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function runChild({ child, stdin, timeoutMs, abortController, setTimer }) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => {
      abortController.abort();
      try { child.kill?.('SIGTERM'); } catch { /* ignore */ }
      finish(new CodexSummaryError('CODEX_SUMMARY_TIMEOUT', 'Codex summary generation timed out. Please try again.'));
    }, timeoutMs);
    setTimer(timer);
    // Codex emits JSONL progress and diagnostics. Consume both streams even
    // though the structured result comes from --output-last-message; otherwise
    // a full OS pipe can block the child before it exits.
    let stderr = '';
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      stderr = `${stderr}${text}`.slice(-MAX_STDERR_BYTES);
    });
    child.once('error', finish);
    child.once('exit', (code) => finish(code === 0 ? null : Object.assign(new Error('Codex exited'), { exitCode: code, stderr })));
    try { child.stdin?.end(stdin); } catch (error) { finish(error); }
  });
}

function classifyCodexError(error) {
  if (error?.code === 'ENOENT') {
    return new CodexSummaryError('CODEX_SUMMARY_CLI_NOT_FOUND', 'Codex CLI is not installed. Install Codex and run `codex login`.');
  }
  const detail = `${error?.message || ''} ${error?.stderr || ''}`.toLowerCase();
  if (AUTH_FAILURE_PATTERNS.some((pattern) => detail.includes(pattern))) {
    return new CodexSummaryError('CODEX_SUMMARY_AUTHENTICATION', 'Codex is not authenticated. Run `codex login` and try again.');
  }
  return new CodexSummaryError('CODEX_SUMMARY_NON_ZERO_EXIT', 'Codex could not generate a summary. Please try again.');
}
