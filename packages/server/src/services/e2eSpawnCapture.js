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
    finishProcess(processStub, stdout, stderr, null, signal);
    return true;
  };

  const complete = () => {
    setImmediate(() => {
      if (processStub.killed || processStub.exitCode !== null) return;
      writeCapturedAgentEvents(agentType, stdout);
      finishProcess(processStub, stdout, stderr, 0, null);
    });
  };

  if (agentType === 'claude-code') {
    setTimeout(complete, 10);
  } else {
    stdin.once('finish', complete);
  }

  return processStub;
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

function finishProcess(processStub, stdout, stderr, code, signal) {
  processStub.exitCode = code;
  stdout.end();
  stderr.end();
  setImmediate(() => {
    processStub.emit('exit', code, signal);
    processStub.emit('close', code, signal);
  });
}
