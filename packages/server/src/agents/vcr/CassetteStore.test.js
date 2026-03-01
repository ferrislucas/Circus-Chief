import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CassetteStore } from './CassetteStore';

describe('CassetteStore', () => {
  const testCassetteDir = path.join('tests', 'cassettes', 'temp-test');

  beforeEach(() => {
    // Clean up test directory before each test
    if (fs.existsSync(testCassetteDir)) {
      fs.rmSync(testCassetteDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up after each test
    if (fs.existsSync(testCassetteDir)) {
      fs.rmSync(testCassetteDir, { recursive: true, force: true });
    }
  });

  describe('load/save', () => {
    it('should save and load a cassette', () => {
      const key = 'test-key-123';
      const cassette = {
        prompt: 'Test prompt',
        model: 'claude-haiku-4-5-20251001',
        events: [
          { type: 'system', subtype: 'init' },
          { type: 'stream_event', event: { type: 'message_start' } },
        ],
      };

      CassetteStore.save(testCassetteDir, key, cassette);
      const loaded = CassetteStore.load(testCassetteDir, key);

      expect(loaded).not.toBeNull();
      expect(loaded.key).toBe(key);
      expect(loaded.prompt).toBe('Test prompt');
      expect(loaded.model).toBe('claude-haiku-4-5-20251001');
      expect(loaded.events).toHaveLength(2);
      expect(loaded.recordedAt).toBeDefined();
    });

    it('should return null for missing cassette', () => {
      const loaded = CassetteStore.load(testCassetteDir, 'nonexistent');
      expect(loaded).toBeNull();
    });

    it('should create cassette directory if it does not exist', () => {
      const nestedDir = path.join(testCassetteDir, 'nested', 'path');
      const key = 'test-key';

      CassetteStore.save(nestedDir, key, { prompt: 'test', events: [] });

      expect(fs.existsSync(nestedDir)).toBe(true);
      const loaded = CassetteStore.load(nestedDir, key);
      expect(loaded).not.toBeNull();
    });
  });

  describe('atomic writes', () => {
    it('should not leave partial files on write failure', () => {
      const key = 'test-key';
      const invalidCassette = {
        prompt: 'test',
        // Circular reference that can't be JSON.stringified
        events: [{ type: 'circular', self: null }],
      };
      invalidCassette.events[0].self = invalidCassette.events[0];

      const targetPath = path.join(testCassetteDir, `${key}.json`);
      const tempPath = `${targetPath}.tmp`;

      // This should fail due to circular reference
      expect(() => CassetteStore.save(testCassetteDir, key, invalidCassette)).toThrow();

      // Neither temp nor target file should exist
      expect(fs.existsSync(tempPath)).toBe(false);
      expect(fs.existsSync(targetPath)).toBe(false);
    });

    it('should overwrite existing cassette atomically', () => {
      const key = 'test-key';
      const cassette1 = { prompt: 'version 1', events: [{ type: 'v1' }] };
      const cassette2 = { prompt: 'version 2', events: [{ type: 'v2' }] };

      CassetteStore.save(testCassetteDir, key, cassette1);
      CassetteStore.save(testCassetteDir, key, cassette2);

      const loaded = CassetteStore.load(testCassetteDir, key);
      expect(loaded.prompt).toBe('version 2');
      expect(loaded.events[0].type).toBe('v2');
    });
  });

  describe('buildKey', () => {
    it('should generate deterministic keys', () => {
      const key1 = CassetteStore.buildKey('runSession', 'hello world');
      const key2 = CassetteStore.buildKey('runSession', 'hello world');
      const key3 = CassetteStore.buildKey('summary', 'hello world');

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key1).toMatch(/^runSession-[a-f0-9]{16}$/);
    });

    it('should generate different keys for different prompts', () => {
      const key1 = CassetteStore.buildKey('runSession', 'prompt one');
      const key2 = CassetteStore.buildKey('runSession', 'prompt two');

      expect(key1).not.toBe(key2);
    });
  });

  describe('deepCopyEvent', () => {
    it('should deep clone simple objects', () => {
      const event = { type: 'test', data: { nested: { value: 123 } } };
      const copy = CassetteStore.deepCopyEvent(event);

      expect(copy).toEqual(event);
      expect(copy).not.toBe(event);
      expect(copy.data).not.toBe(event.data);
      expect(copy.data.nested).not.toBe(event.data.nested);
    });

    it('should fallback to shallow copy for non-cloneable objects', () => {
      const event = {
        type: 'test',
        data: 123,
      };
      // Add a non-cloneable property (like a function)
      const eventWithFn = { ...event, callback: () => {} };

      const copy = CassetteStore.deepCopyEvent(eventWithFn);

      expect(copy.type).toBe('test');
      expect(copy.data).toBe(123);
      // Function won't be cloned, but object should still be returned
      expect(copy).not.toBe(eventWithFn);
    });

    it('should handle null and undefined', () => {
      expect(CassetteStore.deepCopyEvent(null)).toBeNull();
      expect(CassetteStore.deepCopyEvent(undefined)).toBeUndefined();
    });
  });
});
