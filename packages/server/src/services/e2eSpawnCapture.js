import { appendFileSync } from 'fs';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

export function isE2ESpawnCaptureEnabled() {
  return Boolean(process.env.E2E_AGENT_SPAWN_CAPTURE_FILE);
}

export function captureSpawnAttempt(agentType, spawnOptions) {
  const filePath = process.env.E2E_AGENT_SPAWN_CAPTURE_FILE;
  if (!filePath) return;

  const record = {
    agentType,
    command: spawnOptions.command,
    args: spawnOptions.args || [],
    cwd: spawnOptions.cwd || null,
    env: summarizeSpawnEnv(spawnOptions.env),
    options: summarizeSpawnOptions(agentType, spawnOptions),
    capturedAt: new Date().toISOString(),
  };

  appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

export function createCapturedSpawnProcess(agentType) {
  const processStub = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  processStub.stdin = stdin;
  processStub.stdout = stdout;
  processStub.stderr = stderr;
  processStub.killed = false;
  processStub.exitCode = null;
  processStub.kill = (signal = 'SIGTERM') => {
    if (processStub.killed || processStub.exitCode !== null) return true;
    processStub.killed = true;
    finishProcess({ processStub, stdout, stderr, code: null, signal });
    return true;
  };

  const complete = () => {
    setImmediate(() => {
      if (processStub.killed || processStub.exitCode !== null) return;
      writeCapturedAgentEvents(agentType, stdout);
      finishProcess({ processStub, stdout, stderr, code: 0, signal: null });
    });
  };

  if (agentType === 'claude-code' || agentType === 'gemini') {
    // Claude Code and Gemini don't pass prompts via stdin (they use CLI args).
    // Complete after a short delay to simulate process execution.
    setTimeout(complete, 10);
  } else {
    // Codex passes the prompt via stdin; complete when stdin is closed.
    stdin.once('finish', complete);
  }

  return processStub;
}

function summarizeSpawnEnv(env = {}) {
  const summary = {};
  if (Object.prototype.hasOwnProperty.call(env, 'CIRCUSCHIEF_COMMIT_ATTRIBUTION')) {
    summary.CIRCUSCHIEF_COMMIT_ATTRIBUTION = env.CIRCUSCHIEF_COMMIT_ATTRIBUTION;
  }
  if (Object.prototype.hasOwnProperty.call(env, 'GEMINI_CLI_TRUST_WORKSPACE')) {
    summary.GEMINI_CLI_TRUST_WORKSPACE = env.GEMINI_CLI_TRUST_WORKSPACE;
  }
  if (Object.keys(summary).length === 0) return {};
  return summary;
}

function summarizeSpawnOptions(agentType, spawnOptions) {
  const args = spawnOptions.args || [];
  if (agentType === 'claude-code') {
    return {
      model: valueAfter(args, '--model'),
      settings: valueAfter(args, '--settings'),
      permissionMode: valueAfter(args, '--permission-mode'),
      settingSources: valueAfter(args, '--setting-sources'),
    };
  }

  if (agentType === 'gemini') {
    return {
      model: valueAfter(args, '-m'),
      outputFormat: valueAfter(args, '--output-format'),
      approvalMode: optionValue(args, '--approval-mode'),
      prompt: valueAfter(args, '-p'),
    };
  }

  return {
    model: valueAfter(args, '-m'),
    sandbox: valueAfter(args, '--sandbox'),
    config: valuesAfter(args, '-c'),
  };
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function optionValue(args, flag) {
  const separateValue = valueAfter(args, flag);
  if (separateValue !== null) return separateValue;
  const prefix = `${flag}=`;
  const arg = args.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function valuesAfter(args, flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1] !== undefined) {
      values.push(args[index + 1]);
    }
  }
  return values;
}

function writeCapturedAgentEvents(agentType, stdout) {
  if (agentType === 'codex') {
    writeJsonLine(stdout, { type: 'thread.started', thread_id: `e2e-codex-${Date.now()}` });
    writeJsonLine(stdout, { type: 'turn.started' });
    writeJsonLine(stdout, {
      type: 'item.completed',
      item: { type: 'agent_message', text: 'E2E spawn capture response.' },
    });
    writeJsonLine(stdout, {
      type: 'turn.completed',
      usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
    });
    return;
  }

  if (agentType === 'gemini') {
    // Gemini CLI stream-json format: init → message → result
    writeJsonLine(stdout, {
      type: 'init',
      session_id: `e2e-gemini-${Date.now()}`,
    });
    writeJsonLine(stdout, {
      type: 'message',
      role: 'assistant',
      content: 'E2E spawn capture response.',
    });
    writeJsonLine(stdout, {
      type: 'result',
      stats: { input_tokens: 0, output_tokens: 0 },
    });
    return;
  }

  writeJsonLine(stdout, {
    type: 'system',
    subtype: 'init',
    session_id: `e2e-claude-${Date.now()}`,
  });
  writeJsonLine(stdout, {
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'E2E spawn capture response.' }] },
  });
  writeJsonLine(stdout, {
    type: 'result',
    subtype: 'success',
    usage: { input_tokens: 0, output_tokens: 0 },
  });
}

function writeJsonLine(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function finishProcess({ processStub, stdout, stderr, code, signal }) {
  Object.assign(processStub, { exitCode: code });
  stdout.end();
  stderr.end();
  setImmediate(() => {
    processStub.emit('exit', code, signal);
    processStub.emit('close', code, signal);
  });
}
