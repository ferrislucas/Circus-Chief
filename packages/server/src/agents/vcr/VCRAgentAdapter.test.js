import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { VCRAgentAdapter } from './VCRAgentAdapter.js';
import { CassetteStore } from './CassetteStore.js';

describe('VCRAgentAdapter', () => {
  const testCassetteDir = path.join('tests', 'cassettes', 'temp-adapter-test');

  // Mock inner agent
  const createMockAgent = (events) => ({
    async *execute(_queryParams, _meta) {
      for (const event of events) {
        yield event;
      }
    },
    supportsResume: () => true,
    getCapabilities: () => ({ tools: ['all'] }),
  });

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testCassetteDir)) {
      fs.rmSync(testCassetteDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up after test
    if (fs.existsSync(testCassetteDir)) {
      fs.rmSync(testCassetteDir, { recursive: true, force: true });
    }
    // Reset VCR_MODE
    delete process.env.VCR_MODE;
  });

  describe('record mode', () => {
    it('should record all events and save cassette', async () => {
      process.env.VCR_MODE = 'record';
      const events = [
        { type: 'system', subtype: 'init' },
        { type: 'stream_event', event: { type: 'message_start' } },
        { type: 'result', subtype: 'success' },
      ];
      const mockAgent = createMockAgent(events);
      const adapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });

      const queryParams = { prompt: 'test prompt', options: { model: 'claude-haiku-4-5-20251001' } };
      const meta = { callType: 'runSession' };

      const collectedEvents = [];
      for await (const event of adapter.execute(queryParams, meta)) {
        collectedEvents.push(event);
      }

      // Verify events were yielded
      expect(collectedEvents).toEqual(events);

      // Verify cassette was saved
      const key = CassetteStore.buildKey('runSession', 'test prompt');
      const cassette = CassetteStore.load(testCassetteDir, key);
      expect(cassette).not.toBeNull();
      expect(cassette.prompt).toBe('test prompt');
      expect(cassette.model).toBe('claude-haiku-4-5-20251001');
      expect(cassette.events).toEqual(events);
    });
  });

  describe('replay mode', () => {
    it('should replay from existing cassette', async () => {
      // First, save a cassette
      const key = CassetteStore.buildKey('runSession', 'test prompt');
      const events = [
        { type: 'system', subtype: 'init' },
        { type: 'stream_event', event: { type: 'message_start' } },
      ];
      CassetteStore.save(testCassetteDir, key, {
        prompt: 'test prompt',
        model: 'claude-haiku-4-5-20251001',
        events,
      });

      // Set replay mode
      process.env.VCR_MODE = 'replay';
      const mockAgent = createMockAgent([]); // Should not be called
      const adapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });

      const queryParams = { prompt: 'test prompt' };
      const meta = { callType: 'runSession' };

      const collectedEvents = [];
      for await (const event of adapter.execute(queryParams, meta)) {
        collectedEvents.push(event);
      }

      expect(collectedEvents).toEqual(events);
    });

    it('should throw error when cassette missing', async () => {
      process.env.VCR_MODE = 'replay';
      const mockAgent = createMockAgent([]);
      const adapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });

      const queryParams = { prompt: 'nonexistent prompt' };
      const meta = { callType: 'runSession' };

      // Execute returns an async generator, need to consume it to trigger error
      const executePromise = (async () => {
        for await (const _event of adapter.execute(queryParams, meta)) {
          // consume
        }
      })();

      await expect(executePromise).rejects.toThrow('no cassette found');
    });
  });

  describe('auto mode', () => {
    it('should replay when cassette exists', async () => {
      // Save a cassette
      const key = CassetteStore.buildKey('runSession', 'test prompt');
      const events = [{ type: 'test' }];
      CassetteStore.save(testCassetteDir, key, {
        prompt: 'test prompt',
        events,
      });

      process.env.VCR_MODE = 'auto';
      const mockAgent = createMockAgent([]); // Should not be called
      const adapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });

      const queryParams = { prompt: 'test prompt' };
      const collectedEvents = [];
      for await (const event of adapter.execute(queryParams, { callType: 'runSession' })) {
        collectedEvents.push(event);
      }

      expect(collectedEvents).toEqual(events);
    });

    it('should record when cassette missing', async () => {
      process.env.VCR_MODE = 'auto';
      const events = [{ type: 'test' }];
      const mockAgent = createMockAgent(events);
      const adapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });

      const collectedEvents = [];
      for await (const event of adapter.execute({ prompt: 'new prompt' }, { callType: 'runSession' })) {
        collectedEvents.push(event);
      }

      expect(collectedEvents).toEqual(events);

      const key = CassetteStore.buildKey('runSession', 'new prompt');
      const cassette = CassetteStore.load(testCassetteDir, key);
      expect(cassette).not.toBeNull();
      expect(cassette.events).toEqual(events);
    });
  });

  describe('VCR disabled (no VCR_MODE)', () => {
    it('should pass through to inner agent', async () => {
      delete process.env.VCR_MODE;
      const events = [{ type: 'test' }];
      const mockAgent = createMockAgent(events);
      const adapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });

      const collectedEvents = [];
      for await (const event of adapter.execute({ prompt: 'test' }, { callType: 'runSession' })) {
        collectedEvents.push(event);
      }

      expect(collectedEvents).toEqual(events);

      // No cassette should be created
      const key = CassetteStore.buildKey('runSession', 'test');
      const cassette = CassetteStore.load(testCassetteDir, key);
      expect(cassette).toBeNull();
    });
  });

  describe('proxy methods', () => {
    it('should proxy supportsResume to inner agent', () => {
      const mockAgent = createMockAgent([]);
      const adapter = new VCRAgentAdapter(mockAgent);

      expect(adapter.supportsResume()).toBe(true);
    });

    it('should proxy getCapabilities to inner agent', () => {
      const mockAgent = createMockAgent([]);
      const adapter = new VCRAgentAdapter(mockAgent);

      expect(adapter.getCapabilities()).toEqual({ tools: ['all'] });
    });

    it('should handle missing proxy methods gracefully', () => {
      const bareAgent = { async *execute() { yield { type: 'test' }; } };
      const adapter = new VCRAgentAdapter(bareAgent);

      expect(adapter.supportsResume()).toBe(false);
      expect(adapter.getCapabilities()).toEqual({});
    });
  });

  describe('buildCassetteKey', () => {
    it('should use callType from meta', () => {
      const mockAgent = createMockAgent([]);
      const adapter = new VCRAgentAdapter(mockAgent);

      const key = adapter.buildCassetteKey({ prompt: 'test' }, { callType: 'runSession' });
      expect(key).toBe(CassetteStore.buildKey('runSession', 'test'));
    });

    it('should default to "unknown" callType', () => {
      const mockAgent = createMockAgent([]);
      const adapter = new VCRAgentAdapter(mockAgent);

      const key = adapter.buildCassetteKey({ prompt: 'test' }, {});
      expect(key).toBe(CassetteStore.buildKey('unknown', 'test'));
    });
  });
});
