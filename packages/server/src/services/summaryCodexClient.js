import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { OPENAI_MODELS } from '@circuschief/shared';
import { createCodexSpawner } from './codexSpawnHelper.js';

export const CODEX_SUMMARY_TIMEOUT_MS = 60_000;

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
  return OPENAI_MODELS.some((entry) => entry.id === model);
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
    if (key === 'OPENAI_API_KEY' || key === 'OPENAI_API_BASE' || key === 'OPENAI_BASE_URL'
      || /(?:API_KEY|AUTH_TOKEN|TOKEN)$/i.test(key)) delete env[key];
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
    child.once('error', finish);
    child.once('exit', (code) => finish(code === 0 ? null : Object.assign(new Error('Codex exited'), { exitCode: code })));
    try { child.stdin?.end(stdin); } catch (error) { finish(error); }
  });
}

function classifyCodexError(error) {
  if (error?.code === 'ENOENT') {
    return new CodexSummaryError('CODEX_SUMMARY_CLI_NOT_FOUND', 'Codex CLI is not installed. Install Codex and run `codex login`.');
  }
  const detail = `${error?.message || ''}`.toLowerCase();
  if (detail.includes('login') || detail.includes('auth')) {
    return new CodexSummaryError('CODEX_SUMMARY_AUTHENTICATION', 'Codex is not authenticated. Run `codex login` and try again.');
  }
  return new CodexSummaryError('CODEX_SUMMARY_NON_ZERO_EXIT', 'Codex could not generate a summary. Please try again.');
}
