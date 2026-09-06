import readline from 'readline';
import { initializeParams, parseJsonRpcLine, validateInitializeResult } from './codexAppServerCodec.js';

/** Minimal persistent JSON-RPC client for one Codex App Server turn. */
export class CodexAppServerClient {
  constructor({ child, onNotification, onServerRequest, onClose } = {}) {
    if (!child?.stdin || !child?.stdout) throw new Error('Codex App Server requires stdio');
    this.child = child; this.onNotification = onNotification; this.onServerRequest = onServerRequest; this.onClose = onClose;
    this.nextId = 1; this.pending = new Map(); this.closed = false;
    this.rl = readline.createInterface({ input: child.stdout });
    this.rl.on('line', (line) => this._onLine(line));
    // App Server uses stderr for diagnostics. Always drain it so a verbose
    // child cannot block on a full pipe while the turn is waiting for input.
    this.onStderr = () => {};
    child.stderr?.on('data', this.onStderr);
    this.onError = (error) => this.close(error);
    this.onExit = (code) => this.close(new Error(`Codex App Server exited with code ${code}`));
    child.on('error', this.onError); child.on('exit', this.onExit);
  }
  async initialize() {
    try {
      const result = await this.request('initialize', initializeParams());
      validateInitializeResult(result);
      this.notify('initialized', {});
    } catch (error) {
      this.close(error);
      if (error?.message?.startsWith('Codex App Server is incompatible:')) throw error;
      throw new Error(`Codex App Server initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this._write({ id, method, params }); } catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  notify(method, params) { this._write({ method, params }); }
  respond(id, result) { this._write({ id, result }); }
  respondError(id, code, message) { this._write({ id, error: { code, message } }); }
  _write(message) {
    if (this.closed) throw new Error('Codex App Server connection is closed');
    try { this.child.stdin.write(`${JSON.stringify(message)}\n`); } catch (error) { this.close(error); throw error; }
  }
  async _onLine(line) {
    try {
      const parsed = parseJsonRpcLine(line);
      if (parsed.type === 'response') return this._settleResponse(parsed.message);
      if (parsed.type === 'request') return await this.onServerRequest?.(parsed.message);
      return await this.onNotification?.(parsed.message);
    } catch (error) {
      this.close(error);
    }
  }
  _settleResponse(message) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      return;
    }
    pending.resolve(message.result);
  }
  close(error = null) {
    if (this.closed) return;
    this.closed = true;
    const failure = error || new Error('Codex App Server connection closed');
    this.rl.close();
    this.child.stderr?.off?.('data', this.onStderr);
    this.child.off?.('error', this.onError); this.child.off?.('exit', this.onExit);
    for (const { reject } of this.pending.values()) reject(failure);
    this.pending.clear();
    this.onClose?.(failure);
  }
}
