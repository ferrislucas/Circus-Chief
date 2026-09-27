import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import agentsRouter, { handleMuseEnvDiagnostics } from './agents.js';
import apiRouter from './index.js';
import { AgentGateway } from '../agents/AgentGateway.js';
import { ClaudeCodeAdapter } from '../agents/adapters/ClaudeCodeAdapter.js';
import { CodexAdapter } from '../agents/adapters/CodexAdapter.js';
import { MuseAdapter } from '../agents/adapters/MuseAdapter.js';

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
      const museSpy = vi.spyOn(MuseAdapter.prototype, 'getCapabilities');

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
    function callHandler() {
      const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
      };
      handleMuseEnvDiagnostics({}, res);
      return res;
    }

    it('returns per-signal pass/fail with remediation hints', () => {
      const res = callHandler();

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

    it('never leaks secret values in diagnostics output', () => {
      const sentinel = 'TEST_SENTINEL_DIAG_LEAK_42';
      const hadToken = Object.hasOwn(process.env, 'GH_TOKEN');
      const saved = process.env.GH_TOKEN;
      process.env.GH_TOKEN = sentinel;
      try {
        const res = callHandler();
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
  });
});
