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
const MAX_TERMINAL_REASON_CHARS = 500;
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
  // No --no-session-log: `muse exec` requires session logging for its local
  // messaging transport. Session logs for one-off summaries are accepted,
  // matching the session MuseExecAdapter invocation.
  const args = [
    'exec', '--json', '--workspace', cwd,
    '--model', model, '--output-schema', schemaPath,
  ];
  if (promptFile) args.push('--prompt-file', promptFile);
  else args.push(prompt);
  return args;
}

/**
 * Normalize a JSON schema for the Meta API via `muse exec --output-schema`.
 * The API rejects object schemas without an explicit `additionalProperties`
 * (400: "'additionalProperties' is required to be supplied and to be
 * false"), which the shared summary schemas omit. Deep-clone and set
 * `additionalProperties: false` on every object schema missing the key;
 * explicit values (including true) are preserved. The API is also strict
 * about `required`: it must list every key in `properties`, so missing
 * property keys are backfilled (explicit entries first, order preserved).
 */
export function normalizeMuseOutputSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(normalizeMuseOutputSchema);
  return {
    ...schema,
    ...(isObjectSchemaWithoutAdditionalProperties(schema) ? { additionalProperties: false } : {}),
    ...backfillRequired(schema),
    ...normalizeSchemaMapEntries(schema),
    ...normalizeSingleSchemaEntries(schema),
    ...normalizeSchemaArrayEntries(schema),
  };
}

function backfillRequired(schema) {
  if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) return {};
  const names = Object.keys(schema.properties);
  if (!Array.isArray(schema.required)) return names.length ? { required: names } : {};
  const required = [...schema.required];
  for (const name of names) {
    if (!required.includes(name)) required.push(name);
  }
  return { required };
}

function isObjectSchemaWithoutAdditionalProperties(schema) {
  return (schema.type === 'object' || schema.properties)
    && !Object.prototype.hasOwnProperty.call(schema, 'additionalProperties');
}

function normalizeSchemaMapEntries(schema) {
  const normalized = {};
  for (const key of ['properties', 'patternProperties', '$defs', 'definitions']) {
    const group = schema[key];
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    const entries = {};
    for (const [name, subSchema] of Object.entries(group)) entries[name] = normalizeMuseOutputSchema(subSchema);
    normalized[key] = entries;
  }
  return normalized;
}

function normalizeSingleSchemaEntries(schema) {
  const normalized = {};
  for (const key of ['items', 'additionalProperties', 'contains', 'not']) {
    if (schema[key] && typeof schema[key] === 'object') normalized[key] = normalizeMuseOutputSchema(schema[key]);
  }
  return normalized;
}

function normalizeSchemaArrayEntries(schema) {
  const normalized = {};
  for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
    if (Array.isArray(schema[key])) normalized[key] = schema[key].map(normalizeMuseOutputSchema);
  }
  return normalized;
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
  // The workspace must be a real directory: `muse exec` rejects a workspace
  // that contains its process-lifetime temp root, so os.tmpdir() itself is
  // unusable here. Default to the server cwd (a real checkout, matching the
  // Claude summary client); callers may override per session/project.
  const workspaceDir = cwd || workingDirectory || dependencies.cwd || process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'circuschief-muse-summary-'));
  const schemaPath = path.join(tempDir, 'summary-schema.json');
  const abortController = new AbortController();
  let timer;

  try {
    await fs.writeFile(schemaPath, JSON.stringify(normalizeMuseOutputSchema(jsonSchema)), 'utf8');
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
    child.once('exit', (code) => {
      if (code === 0) { finish(null, stdout); return; }
      const failure = Object.assign(new Error('Muse exited'), { exitCode: code, stderr });
      const terminalReason = findFailedTerminalReason(stdout);
      if (terminalReason) failure.terminalReason = terminalReason;
      finish(failure, stdout);
    });
  });
}

function readTerminalRecords(stdout) {
  return createMuseExecProtocol().push(stdout).filter((item) => item?.kind === 'terminal');
}

function extractTerminalText(stdout) {
  let terminalText = null;
  try {
    for (const item of readTerminalRecords(stdout)) {
      if (item?.outcome === 'completed' && typeof item?.text === 'string') {
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

// Best-effort extraction of a failed terminal's reason for server logs only.
// Never throws: unparseable stdout simply yields no detail, and only the
// protocol's truncated reason string (never prompt, schema, or secret text)
// is returned.
function findFailedTerminalReason(stdout) {
  try {
    for (const item of readTerminalRecords(stdout)) {
      if (item?.outcome === 'failed' && typeof item?.reason === 'string' && item.reason) {
        return item.reason.slice(0, MAX_TERMINAL_REASON_CHARS);
      }
    }
  } catch {
    return null;
  }
  return null;
}

function classifyMuseError(error) {
  if (error?.code === 'ENOENT') {
    return new MuseSummaryError('MUSE_SUMMARY_CLI_NOT_FOUND', 'Muse CLI is not installed. Install Muse Code and ensure `muse` is on PATH (or set MUSE_BIN).');
  }
  const detail = `${error?.message || ''} ${error?.stderr || ''}`.toLowerCase();
  if (AUTH_FAILURE_PATTERNS.some((pattern) => detail.includes(pattern))) {
    return new MuseSummaryError('MUSE_SUMMARY_AUTHENTICATION', 'Muse is not authenticated. Run `muse auth` and try again.');
  }
  const classified = new MuseSummaryError('MUSE_SUMMARY_NON_ZERO_EXIT', 'Muse could not generate a summary. Please try again.');
  // Log-only diagnostic: carried on a separate field so it can never leak
  // into publicMessage, agent_call_logs, API responses, or broadcasts.
  // Only the protocol's truncated reason string is attached (never prompt,
  // schema, or secret-bearing text).
  if (typeof error?.terminalReason === 'string' && error.terminalReason) {
    classified.detail = error.terminalReason;
  }
  return classified;
}
