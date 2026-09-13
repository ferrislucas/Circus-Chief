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
      expect(agentTypes).toEqual(['claude-code', 'codex', 'gemini']);

      const claude = res.body.find((a) => a.agentType === 'claude-code');
      const codex = res.body.find((a) => a.agentType === 'codex');

      expect(claude.capabilities).toEqual({
        streaming: true,
        thinking: true,
        reasoningEffort: true,
        toolUse: true,
        resume: true,
      });

      expect(codex.capabilities).toEqual({
        streaming: false,
        thinking: false,
        reasoningEffort: true,
        toolUse: true,
        resume: false,
        interactiveInput: true,
      });
    });

    it('resolves capabilities from adapter instances when serving capabilities', async () => {
      const claudeSpy = vi.spyOn(ClaudeCodeAdapter.prototype, 'getCapabilities');
      const codexSpy = vi.spyOn(CodexAdapter.prototype, 'getCapabilities');

      const freshGateway = new AgentGateway();
      freshGateway.getAllAgentCapabilities();

      const res = await request(app).get('/api/agents');
      expect(res.status).toBe(200);

      expect(claudeSpy).toHaveBeenCalled();
      expect(codexSpy).toHaveBeenCalled();

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
