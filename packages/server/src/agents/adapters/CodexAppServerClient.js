import readline from 'readline';
import { initializeParams, parseJsonRpcLine } from './codexAppServerCodec.js';

/** Minimal persistent JSON-RPC client for one Codex App Server turn. */
export class CodexAppServerClient {
  constructor({ child, onNotification, onServerRequest } = {}) {
    if (!child?.stdin || !child?.stdout) throw new Error('Codex App Server requires stdio');
    this.child = child; this.onNotification = onNotification; this.onServerRequest = onServerRequest;
    this.nextId = 1; this.pending = new Map(); this.closed = false;
    this.rl = readline.createInterface({ input: child.stdout });
    this.rl.on('line', (line) => this._onLine(line));
    this.onError = (error) => this.close(error); this.onExit = (code) => this.close(code === 0 ? null : new Error(`Codex App Server exited with code ${code}`));
    child.on('error', this.onError); child.on('exit', this.onExit);
  }
  async initialize() { await this.request('initialize', initializeParams()); this.notify('initialized', {}); }
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
  _write(message) { if (this.closed) throw new Error('Codex App Server connection is closed'); try { this.child.stdin.write(`${JSON.stringify(message)}\n`); } catch (error) { this.close(error); throw error; } }
  async _onLine(line) { try { const parsed = parseJsonRpcLine(line); if (parsed.type === 'response') { const pending = this.pending.get(parsed.message.id); if (!pending) return; this.pending.delete(parsed.message.id); return parsed.message.error ? pending.reject(Object.assign(new Error(parsed.message.error.message), { code: parsed.message.error.code })) : pending.resolve(parsed.message.result); } if (parsed.type === 'request') return this.onServerRequest?.(parsed.message); return this.onNotification?.(parsed.message); } catch (error) { this.close(error); } }
  close(error = null) { if (this.closed) return; this.closed = true; this.rl.close(); this.child.off?.('error', this.onError); this.child.off?.('exit', this.onExit); for (const { reject } of this.pending.values()) reject(error || new Error('Codex App Server connection closed')); this.pending.clear(); }
}
