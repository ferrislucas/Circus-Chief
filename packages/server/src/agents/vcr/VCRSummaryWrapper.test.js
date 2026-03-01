import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createVCRQueryFn } from './VCRSummaryWrapper.js';
import { CassetteStore } from './CassetteStore.js';

describe('VCRSummaryWrapper', () => {
  const testCassetteDir = path.join('tests', 'cassettes', 'temp-summary-test');

  // Mock real query function
  const createMockQueryFn = (events) => {
    return async function* mockQuery(queryParams) {
      for (const event of events) {
        yield event;
      }
    };
  };

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
        { type: 'stream_event', event: { type: 'message_start' } },
        { type: 'stream_event', event: { type: 'content_block_start' } },
        { type: 'result', subtype: 'success' },
      ];
      const mockQuery = createMockQueryFn(events);
      const vcrQuery = createVCRQueryFn(mockQuery, testCassetteDir);

      const queryParams = {
        prompt: 'Summarize this conversation',
        options: { model: 'claude-haiku-4-5-20251001' },
      };

      const collectedEvents = [];
      for await (const event of vcrQuery(queryParams)) {
        collectedEvents.push(event);
      }

      // Verify events were yielded
      expect(collectedEvents).toEqual(events);

      // Verify cassette was saved
      const key = CassetteStore.buildKey('summary', 'Summarize this conversation');
      const cassette = CassetteStore.load(testCassetteDir, key);
      expect(cassette).not.toBeNull();
      expect(cassette.prompt).toBe('Summarize this conversation');
      expect(cassette.model).toBe('claude-haiku-4-5-20251001');
      expect(cassette.events).toEqual(events);
    });
  });

  describe('replay mode', () => {
    it('should replay from existing cassette', async () => {
      // First, save a cassette
      const key = CassetteStore.buildKey('summary', 'Summarize this');
      const events = [
        { type: 'stream_event', event: { type: 'message_start' } },
        { type: 'result', subtype: 'success' },
      ];
      CassetteStore.save(testCassetteDir, key, {
        prompt: 'Summarize this',
        model: 'claude-haiku-4-5-20251001',
        events,
      });

      // Set replay mode
      process.env.VCR_MODE = 'replay';
      const mockQuery = createMockQueryFn([]); // Should not be called
      const vcrQuery = createVCRQueryFn(mockQuery, testCassetteDir);

      const collectedEvents = [];
      for await (const event of vcrQuery({ prompt: 'Summarize this' })) {
        collectedEvents.push(event);
      }

      expect(collectedEvents).toEqual(events);
    });

    it('should throw error when cassette missing in replay mode', async () => {
      process.env.VCR_MODE = 'replay';
      const mockQuery = createMockQueryFn([]);
      const vcrQuery = createVCRQueryFn(mockQuery, testCassetteDir);

      await expect(vcrQuery({ prompt: 'nonexistent' })).rejects.toThrow('summary cassette not found');
    });
  });

  describe('auto mode', () => {
    it('should replay when cassette exists', async () => {
      // Save a cassette
      const key = CassetteStore.buildKey('summary', 'Test prompt');
      const events = [{ type: 'test' }];
      CassetteStore.save(testCassetteDir, key, {
        prompt: 'Test prompt',
        events,
      });

      process.env.VCR_MODE = 'auto';
      const mockQuery = createMockQueryFn([]); // Should not be called
      const vcrQuery = createVCRQueryFn(mockQuery, testCassetteDir);

      const collectedEvents = [];
      for await (const event of vcrQuery({ prompt: 'Test prompt' })) {
        collectedEvents.push(event);
      }

      expect(collectedEvents).toEqual(events);
    });

    it('should record when cassette missing', async () => {
      process.env.VCR_MODE = 'auto';
      const events = [{ type: 'test' }];
      const mockQuery = createMockQueryFn(events);
      const vcrQuery = createVCRQueryFn(mockQuery, testCassetteDir);

      const collectedEvents = [];
      for await (const event of vcrQuery({ prompt: 'New prompt' })) {
        collectedEvents.push(event);
      }

      expect(collectedEvents).toEqual(events);

      const key = CassetteStore.buildKey('summary', 'New prompt');
      const cassette = CassetteStore.load(testCassetteDir, key);
      expect(cassette).not.toBeNull();
      expect(cassette.events).toEqual(events);
    });
  });

  describe('VCR disabled (no VCR_MODE)', () => {
    it('should default to auto mode', async () => {
      delete process.env.VCR_MODE;
      const events = [{ type: 'test' }];
      const mockQuery = createMockQueryFn(events);
      const vcrQuery = createVCRQueryFn(mockQuery, testCassetteDir);

      // In auto mode with no cassette, should record
      const collectedEvents = [];
      for await (const event of vcrQuery({ prompt: 'test' })) {
        collectedEvents.push(event);
      }

      expect(collectedEvents).toEqual(events);

      const key = CassetteStore.buildKey('summary', 'test');
      const cassette = CassetteStore.load(testCassetteDir, key);
      expect(cassette).not.toBeNull();
    });
  });

  describe('buildSummaryKey', () => {
    it('should use "summary" as callType', async () => {
      const mockQuery = createMockQueryFn([]);
      const vcrQuery = createVCRQueryFn(mockQuery, testCassetteDir);

      // This will record a cassette
      for await (const event of vcrQuery({ prompt: 'test' })) {
        // consume
      }

      // Check the key
      const key = CassetteStore.buildKey('summary', 'test');
      const cassette = CassetteStore.load(testCassetteDir, key);
      expect(cassette).not.toBeNull();
    });
  });
});
