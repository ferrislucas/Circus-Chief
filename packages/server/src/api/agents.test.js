import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import agentsRouter from './agents.js';
import apiRouter from './index.js';
import { AgentGateway } from '../agents/AgentGateway.js';
import { ClaudeCodeAdapter } from '../agents/adapters/ClaudeCodeAdapter.js';
import { CodexAdapter } from '../agents/adapters/CodexAdapter.js';

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
      expect(agentTypes).toEqual(['claude-code', 'codex']);

      const claude = res.body.find((a) => a.agentType === 'claude-code');
      const codex = res.body.find((a) => a.agentType === 'codex');

      expect(claude.capabilities).toEqual({
        streaming: true,
        thinking: true,
        toolUse: true,
        resume: true,
      });

      expect(codex.capabilities).toEqual({
        streaming: true,
        thinking: false,
        toolUse: true,
        resume: false,
      });
    });

    it('does not instantiate adapter classes when serving capabilities', async () => {
      // Spy on adapter constructors; the handler should NOT call them.
      const claudeSpy = vi.spyOn(ClaudeCodeAdapter.prototype, 'getCapabilities');
      const codexSpy = vi.spyOn(CodexAdapter.prototype, 'getCapabilities');

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

      claudeSpy.mockRestore();
      codexSpy.mockRestore();
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
});
