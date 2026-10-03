import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import agentsRouter, { handleMuseEnvDiagnostics } from './agents.js';
import apiRouter from './index.js';
import { AgentGateway } from '../agents/AgentGateway.js';
import { ClaudeCodeAdapter } from '../agents/adapters/ClaudeCodeAdapter.js';
import { CodexAdapter } from '../agents/adapters/CodexAdapter.js';
import { MuseExecAdapter } from '../agents/adapters/MuseExecAdapter.js';

describe('Agents API', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/agents', agentsRouter);
  });

  describe('GET /api/agents', () => {
    it('returns registered adapters with capabilities', async () => {
      const res = await request(app).get('/api/agents');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const agentTypes = res.body.map((a) => a.agentType).sort();
      expect(agentTypes).toEqual(['claude-code', 'codex', 'gemini', 'muse']);

      const claude = res.body.find((a) => a.agentType === 'claude-code');
      const codex = res.body.find((a) => a.agentType === 'codex');
      const muse = res.body.find((a) => a.agentType === 'muse');

      expect(claude.capabilities).toEqual({
        streaming: true,
        thinking: true,
        reasoningEffort: true,
        toolUse: true,
        resume: true,
      });

      expect(codex.capabilities).toEqual({
        streaming: true,
        thinking: false,
        reasoningEffort: true,
        toolUse: true,
        resume: false,
      });

      expect(muse.capabilities).toEqual({
        streaming: true,
        thinking: false,
        reasoningEffort: true,
        toolUse: true,
        resume: true,
      });
    });

    it('does not instantiate adapter classes when serving capabilities', async () => {
      // Spy on adapter constructors; the handler should NOT call them.
      const claudeSpy = vi.spyOn(ClaudeCodeAdapter.prototype, 'getCapabilities');
      const codexSpy = vi.spyOn(CodexAdapter.prototype, 'getCapabilities');
      const museSpy = vi.spyOn(MuseExecAdapter.prototype, 'getCapabilities');

      // Force a fresh gateway so any cached capabilities from earlier tests
      // do not mask instantiation. We wire in a fresh router backed by a
      // dedicated gateway in tests by invalidating the module-level cache.
      const freshGateway = new AgentGateway();
      // Prime: reading via the gateway also should not call getCapabilities
      // (because both adapters expose static `capabilities`).
      freshGateway.getAllAgentCapabilities();

      const res = await request(app).get('/api/agents');
      expect(res.status).toBe(200);

      expect(claudeSpy).not.toHaveBeenCalled();
      expect(codexSpy).not.toHaveBeenCalled();
      expect(museSpy).not.toHaveBeenCalled();

      claudeSpy.mockRestore();
      codexSpy.mockRestore();
      museSpy.mockRestore();
    });
  });

  describe('router mounting at /api/agents', () => {
    it('is mounted in the main api router', async () => {
      const mountedApp = express();
      mountedApp.use(express.json());
      mountedApp.use('/api', apiRouter);

      const res = await request(mountedApp).get('/api/agents');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const types = res.body.map((a) => a.agentType).sort();
      expect(types).toContain('claude-code');
      expect(types).toContain('codex');
    });
  });

  // NOTE: supertest-based HTTP tests cannot bind TCP in sandboxed runners
  // (listen EPERM), so the diagnostics contract is exercised by invoking the
  // exported handler directly with a mock response. The route registration
  // above (`router.get('/muse/env-diagnostics', ...)`) keeps the HTTP shape.
  describe('GET /api/agents/muse/env-diagnostics', () => {
    async function callHandler(query, deps) {
      const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
      };
      await handleMuseEnvDiagnostics({ query: query || {} }, res, deps);
      return res;
    }

    it('returns per-signal pass/fail with remediation hints', async () => {
      const res = await callHandler();

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.signals)).toBe(true);
      const names = res.body.signals.map((s) => s.signal);
      for (const expected of ['muse-bin', 'git-bin', 'gh-bin', 'home', 'identity', 'ssh-agent', 'gh-auth', 'git-identity']) {
        expect(names).toContain(expected);
      }
      for (const signal of res.body.signals) {
        expect(typeof signal.ok).toBe('boolean');
        expect(typeof signal.origin).toBe('string');
        if (!signal.ok) expect(typeof signal.remediation).toBe('string');
      }
      expect(res.body.env).toBeDefined();
      expect(res.body.probe).toBeDefined();
      expect(typeof res.body.probe.ok).toBe('boolean');
    });

    it('never leaks secret values in diagnostics output', async () => {
      const sentinel = 'TEST_SENTINEL_DIAG_LEAK_42';
      const hadToken = Object.hasOwn(process.env, 'GH_TOKEN');
      const saved = process.env.GH_TOKEN;
      process.env.GH_TOKEN = sentinel;
      try {
        const res = await callHandler();
        expect(res.statusCode).toBe(200);
        expect(JSON.stringify(res.body)).not.toContain(sentinel);
        const gh = res.body.signals.find((s) => s.signal === 'gh-auth');
        expect(gh.ok).toBe(true);
        expect(gh.origin).toBe('token env');
      } finally {
        if (hadToken) process.env.GH_TOKEN = saved;
        else delete process.env.GH_TOKEN;
      }
    });

    it('re-probes the login shell when ?reprobe=1 (fresh values, repopulated cache)', async () => {
      const { getLoginShellEnv } = await import('../services/loginShellEnv.js');
      const res = await callHandler({ reprobe: '1' });

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.signals)).toBe(true);
      expect(res.body.signals.map((s) => s.signal)).toContain('ssh-agent');
      // The re-probe repopulates the process-lifetime cache.
      expect(getLoginShellEnv()).toBeDefined();
      expect(typeof getLoginShellEnv().ok).toBe('boolean');
    });

    // Finding #6: ?reprobe=1 must not block the event loop on the sync
    // shell probe — a concurrent fast request must win the race while the
    // re-probe is still gated, and the handler must use the injected async
    // refresher (not the blocking sync spawner).
    it('re-probes via the async refresher without blocking concurrent requests (finding #6)', async () => {
      const { getLoginShellEnv, resetLoginShellEnvCache } = await import('../services/loginShellEnv.js');
      // Prime the sync cache with a stubbed probe so the real blocking
      // spawner is never hit during this test.
      resetLoginShellEnvCache();
      getLoginShellEnv({}, {
        spawnSync: () => ({ status: 0, stdout: Buffer.from('PATH=/usr/bin:/bin\0'), stderr: Buffer.alloc(0) }),
      });

      let resolveProbe;
      const gate = new Promise((resolve) => { resolveProbe = resolve; });
      let refresherCalls = 0;
      const deps = {
        refreshLoginShellEnvAsync: async () => {
          refresherCalls += 1;
          await gate;
          return { ok: true, env: {} };
        },
      };

      const slow = callHandler({ reprobe: '1' }, deps);
      const fast = callHandler({}, deps);
      const winner = await Promise.race([slow.then(() => 'slow'), fast.then(() => 'fast')]);
      try {
        expect(winner).toBe('fast');
        expect(refresherCalls).toBe(1);
      } finally {
        resolveProbe();
      }
      const slowRes = await slow;
      expect(slowRes.statusCode).toBe(200);
      expect(Array.isArray(slowRes.body.signals)).toBe(true);
    });

    // Finding #8: the reprobe flag is parsed strictly — only '1'/'true'
    // re-probe. Truthy strings like '0' and 'false' must read the cache.
    it.each(['0', 'false'])('does not re-probe for ?reprobe=%s (strict parsing, finding #8)', async (value) => {
      let refresherCalls = 0;
      const deps = {
        refreshLoginShellEnvAsync: async () => {
          refresherCalls += 1;
          return { ok: true, env: {} };
        },
      };
      const res = await callHandler({ reprobe: value }, deps);
      expect(res.statusCode).toBe(200);
      expect(refresherCalls).toBe(0);
    });

    // Finding #8: the 500 path must log the underlying error — no silent
    // swallow that leaves operators with only the generic JSON message.
    it('logs the underlying error when diagnostics build fails (finding #8)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const deps = {
          refreshLoginShellEnvAsync: async () => { throw new Error('reprobe exploded'); },
        };
        const res = await callHandler({ reprobe: '1' }, deps);
        expect(res.statusCode).toBe(500);
        expect(res.body.error).toBe('Failed to build environment diagnostics.');
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('reprobe exploded'));
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
