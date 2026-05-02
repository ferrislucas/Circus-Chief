import { describe, it, expect } from 'vitest';
import path from 'path';
import { createCodexSpawner } from './codexSpawnHelper.js';
import { getNodeBinDir } from './nodeSpawnHelper.js';

describe('codexSpawnHelper', () => {
  describe('createCodexSpawner', () => {
    it('returns a function', () => {
      const spawner = createCodexSpawner();
      expect(typeof spawner).toBe('function');
    });

    it('spawns a process whose env has Node bin dir on PATH', async () => {
      const spawner = createCodexSpawner();
      const child = spawner({
        command: 'node',
        args: ['-e', 'process.stdout.write(process.env.PATH || "")'],
        cwd: process.cwd(),
        env: { PATH: '/usr/bin' },
        signal: new AbortController().signal,
      });

      const chunks = [];
      child.stdout.on('data', (c) => chunks.push(c));

      const exitCode = await new Promise((resolve, reject) => {
        child.on('exit', resolve);
        child.on('error', reject);
      });

      expect(exitCode).toBe(0);

      const pathSeen = Buffer.concat(chunks).toString('utf-8');
      const nodeBinDir = getNodeBinDir();
      expect(pathSeen).toContain(nodeBinDir);
      // Node bin should be prepended (first entry)
      expect(pathSeen.startsWith(nodeBinDir)).toBe(true);
    });

    it('replaces "node" command with process.execPath', async () => {
      const spawner = createCodexSpawner();
      // If "node" were passed through literally on some systems it could fail.
      // Verify we can run `node --version` successfully via the spawner.
      const child = spawner({
        command: 'node',
        args: ['--version'],
        cwd: process.cwd(),
        env: { PATH: '/usr/bin' },
        signal: new AbortController().signal,
      });

      let stdout = '';
      child.stdout.on('data', (c) => { stdout += c.toString(); });

      const exitCode = await new Promise((resolve, reject) => {
        child.on('exit', resolve);
        child.on('error', reject);
      });

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/^v\d+\.\d+\.\d+/);
    });

    it('pipes stderr (unlike claude spawner which may ignore it)', async () => {
      const spawner = createCodexSpawner();
      const child = spawner({
        command: 'node',
        args: ['-e', 'process.stderr.write("codex-stderr-test")'],
        cwd: process.cwd(),
        env: {},
        signal: new AbortController().signal,
      });

      let stderr = '';
      // stderr should be a readable stream (piped), not null
      expect(child.stderr).not.toBeNull();
      child.stderr.on('data', (c) => { stderr += c.toString(); });

      await new Promise((resolve, reject) => {
        child.on('exit', resolve);
        child.on('error', reject);
      });

      expect(stderr).toBe('codex-stderr-test');
    });

    it('respects process working directory option', () => {
      const spawner = createCodexSpawner();
      // Just confirm we can construct a child process with a cwd without throwing
      expect(() => {
        spawner({
          command: 'node',
          args: ['--version'],
          cwd: path.dirname(process.cwd()),
          env: { PATH: '/usr/bin' },
          signal: new AbortController().signal,
        });
      }).not.toThrow();
    });
  });
});
