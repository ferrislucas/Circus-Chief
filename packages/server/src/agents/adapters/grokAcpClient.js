import { spawn } from 'child_process';

const INIT_TIMEOUT_MS = 20_000;
const STDERR_LIMIT = 16 * 1024;
const SECRET_RE = /(sk-|xai-|Bearer\s+)[A-Za-z0-9._-]+/gi;

/**
 * Owned stdio JSON-RPC client for `grok --no-auto-update agent stdio`.
 * Circus Chief never reads Grok's credential files. Authentication is the
 * ACP `cached_token` handshake only.
 */
export class GrokAcpClient {
  /**
   * @param {Object} [opts]
   * @param {Function} [opts.spawnImpl]
   * @param {string} [opts.command]
   * @param {string} [opts.cwd]
   * @param {Object} [opts.env]
   * @param {AbortSignal} [opts.signal]
   * @param {(params: Object) => Promise<Object>} [opts.onQuestion]
   */
  constructor({ spawnImpl = spawn, command = 'grok', cwd, env, signal, onQuestion } = {}) {
    this.spawnImpl = spawnImpl;
    this.command = command;
    this.cwd = cwd;
    this.env = env;
    this.signal = signal;
    this.onQuestion = onQuestion;
    this.nextId = 1;
    this.pending = new Map();
    this.child = null;
    this.closed = false;
    this.stderr = '';
    this.stdoutBuffer = '';
    this.onNotification = null;
    this._onAbort = null;
  }

  async start() {
    try {
      this.child = this.spawnImpl(this.command, ['--no-auto-update', 'agent', 'stdio'], {
        cwd: this.cwd,
        env: this.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      throw grokSpawnError(error);
    }
    this.#attach();
    const init = await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
    }, INIT_TIMEOUT_MS);
    const methods = new Set((init?.authMethods || []).map((method) => method?.id || method));
    if (!methods.has('cached_token')) {
      const error = new Error('Authenticate Grok Build locally with grok login, then retry.');
      error.code = 'GROK_AUTH_REQUIRED';
      throw error;
    }
    await this.request('authenticate', {
      methodId: 'cached_token',
      _meta: { headless: true },
    }, INIT_TIMEOUT_MS);
    return init;
  }

  request(method, params, timeoutMs = 0) {
    if (this.closed) return Promise.reject(new Error('Grok Build process is closed.'));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Grok Build timed out waiting for ${method}.`));
        }, timeoutMs)
        : null;
      timer?.unref?.();
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.#send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this.#send({ jsonrpc: '2.0', method, params });
  }

  async cancelActive(sessionId) {
    if (!sessionId || this.closed) return;
    try {
      this.notify('session/cancel', { sessionId });
    } catch {
      /* the process reap below is the real stop */
    }
  }

  async shutdown() {
    if (this.closed) return;
    this.closed = true;
    this.signal?.removeEventListener?.('abort', this._onAbort);
    const error = new Error('Grok Build process closed.');
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    const child = this.child;
    if (!child || child.exitCode != null || child.killed) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        resolve();
      }, 2000);
      timer.unref?.();
      child.once?.('exit', () => { clearTimeout(timer); resolve(); });
      try { child.kill('SIGTERM'); } catch { resolve(); }
    });
  }

  #attach() {
    const child = this.child;
    child.stdout?.on('data', (chunk) => this.#onStdout(chunk));
    child.stderr?.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString('utf8')}`.slice(-STDERR_LIMIT);
    });
    child.on('error', (error) => this.#fail(grokSpawnError(error)));
    child.on('exit', (code) => {
      if (!this.closed) this.#fail(new Error(exitMessage(code, this.stderr)));
    });
    if (this.signal) {
      this._onAbort = () => { this.cancelActive(this.sessionId).finally(() => this.shutdown()); };
      if (this.signal.aborted) this._onAbort();
      else this.signal.addEventListener('abort', this._onAbort);
    }
  }

  #onStdout(chunk) {
    this.stdoutBuffer += chunk.toString('utf8');
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) this.#onLine(line);
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  #onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.#fail(new Error('Grok Build sent malformed protocol output.'));
      return;
    }
    if (message.id != null && message.method) {
      this.#onIncomingRequest(message).catch((error) => this.#fail(error));
      return;
    }
    if (message.id != null) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(rpcError(message.error));
      else pending.resolve(message.result);
      return;
    }
    this.onNotification?.(message);
  }

  async #onIncomingRequest(message) {
    const method = message.method;
    if (method === 'askUserQuestion' || method === 'x.ai/askUserQuestion') {
      const result = this.onQuestion
        ? await this.onQuestion(message.params || {})
        : { outcome: 'cancelled' };
      this.#reply(message.id, result || { outcome: 'cancelled' });
      return;
    }
    if (method === 'session/request_permission') {
      this.#reply(message.id, { outcome: { outcome: 'cancelled' } });
      return;
    }
    this.#send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Unsupported Grok interaction: ${method}` },
    });
  }

  #reply(id, result) {
    this.#send({ jsonrpc: '2.0', id, result });
  }

  #send(message) {
    if (this.closed || !this.child?.stdin) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function grokSpawnError(error) {
  if (error?.code === 'ENOENT') {
    const notFound = new Error('Install Grok Build and ensure grok is on PATH.');
    notFound.code = 'GROK_CLI_NOT_FOUND';
    return notFound;
  }
  return error;
}

function exitMessage(code, stderr) {
  const detail = sanitize(stderr);
  if (detail) return `Grok Build exited (${code ?? 'unknown'}): ${detail}`;
  return `Grok Build exited (${code ?? 'unknown'}).`;
}

function rpcError(error) {
  const message = sanitize(error?.message || 'Grok Build request failed.');
  const wrapped = new Error(message);
  wrapped.code = error?.code || 'GROK_RPC';
  return wrapped;
}

function sanitize(value) {
  return String(value || '').replace(SECRET_RE, '[redacted]').trim().slice(0, 300);
}
