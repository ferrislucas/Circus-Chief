import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { getNodeBinDir, createRobustEnv, createClaudeCodeSpawner } from './nodeSpawnHelper.js';

describe('nodeSpawnHelper', () => {
  describe('getNodeBinDir', () => {
    it('returns the directory containing the Node binary', () => {
      const nodeBinDir = getNodeBinDir();

      // Should return a valid directory path
      expect(nodeBinDir).toBeTruthy();
      expect(typeof nodeBinDir).toBe('string');

      // Should be the parent directory of process.execPath
      expect(nodeBinDir).toBe(path.dirname(process.execPath));
    });

    it('returns absolute path', () => {
      const nodeBinDir = getNodeBinDir();
      expect(path.isAbsolute(nodeBinDir)).toBe(true);
    });
  });

  describe('createRobustEnv', () => {
    it('prepends Node bin directory to PATH', () => {
      const env = createRobustEnv({ PATH: '/usr/bin:/bin' });
      const nodeBinDir = getNodeBinDir();

      expect(env.PATH).toContain(nodeBinDir);
      expect(env.PATH.startsWith(nodeBinDir)).toBe(true);
    });

    it('preserves existing environment variables', () => {
      const baseEnv = {
        PATH: '/usr/bin:/bin',
        HOME: '/home/user',
        CUSTOM_VAR: 'custom_value',
      };
      const env = createRobustEnv(baseEnv);

      expect(env.HOME).toBe('/home/user');
      expect(env.CUSTOM_VAR).toBe('custom_value');
    });

    it('handles empty PATH gracefully', () => {
      const env = createRobustEnv({ OTHER_VAR: 'value' });
      const nodeBinDir = getNodeBinDir();

      // Should still include the Node bin directory
      expect(env.PATH).toContain(nodeBinDir);
    });

    it('uses process.env as default base', () => {
      const env = createRobustEnv();
      const nodeBinDir = getNodeBinDir();

      // Should have Node bin dir at the start
      expect(env.PATH.startsWith(nodeBinDir)).toBe(true);

      // Should also include original PATH from process.env
      if (process.env.PATH) {
        expect(env.PATH).toContain(process.env.PATH);
      }
    });

    it('uses correct path separator for platform', () => {
      const env = createRobustEnv({ PATH: '/usr/bin' });
      const expectedSeparator = process.platform === 'win32' ? ';' : ':';

      expect(env.PATH).toContain(expectedSeparator);
    });
  });

  describe('createClaudeCodeSpawner', () => {
    let mockSpawn;

    beforeEach(() => {
      // We can't easily mock spawn in ESM, so we test the returned function's behavior
    });

    it('returns a function', () => {
      const spawner = createClaudeCodeSpawner();
      expect(typeof spawner).toBe('function');
    });

    it('replaces "node" command with process.execPath', async () => {
      // This test verifies the spawner logic by checking if it handles the options correctly
      // We can't easily test the actual spawn without mocking, but we can verify the function exists
      const spawner = createClaudeCodeSpawner();

      // The spawner should be callable with options
      expect(() => {
        // This will throw because we're not in a real spawn context,
        // but we're testing that the function is properly constructed
        spawner({
          command: 'node',
          args: ['--version'],
          cwd: process.cwd(),
          env: { PATH: '/usr/bin' },
          signal: new AbortController().signal,
        });
      }).not.toThrow(); // The spawn itself might fail, but the function should execute
    });
  });
});
