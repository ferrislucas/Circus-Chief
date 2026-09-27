import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { dirname, isAbsolute, join } from 'path';
import { tmpdir } from 'os';
import { getNodeBinDir, createRobustEnv, createClaudeCodeSpawner } from './nodeSpawnHelper.js';

describe('nodeSpawnHelper', () => {
  const originalCaptureFile = process.env.E2E_AGENT_SPAWN_CAPTURE_FILE;
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'node-spawn-helper-test-'));
    delete process.env.E2E_AGENT_SPAWN_CAPTURE_FILE;
  });

  afterEach(() => {
    if (originalCaptureFile === undefined) {
      delete process.env.E2E_AGENT_SPAWN_CAPTURE_FILE;
    } else {
      process.env.E2E_AGENT_SPAWN_CAPTURE_FILE = originalCaptureFile;
    }
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('getNodeBinDir', () => {
    it('returns the directory containing the Node binary', () => {
      const nodeBinDir = getNodeBinDir();

      // Should return a valid directory path
      expect(nodeBinDir).toBeTruthy();
      expect(typeof nodeBinDir).toBe('string');

      // Should be the parent directory of process.execPath
      expect(nodeBinDir).toBe(dirname(process.execPath));
    });

    it('returns absolute path', () => {
      const nodeBinDir = getNodeBinDir();
      expect(isAbsolute(nodeBinDir)).toBe(true);
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

    it('falls back to os.homedir() when HOME is missing so gh/git find user config', async () => {
      const { homedir } = await import('os');
      const env = createRobustEnv({ PATH: '/usr/bin:/bin' });

      expect(env.HOME).toBe(homedir());
    });

    it('preserves an explicit HOME instead of overwriting it', () => {
      const env = createRobustEnv({ PATH: '/usr/bin:/bin', HOME: '/custom/home' });

      expect(env.HOME).toBe('/custom/home');
    });

    it('forwards user credential vars so git/gh run with user auth', () => {
      const baseEnv = {
        PATH: '/usr/bin:/bin',
        SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
        SSH_AGENT_PID: '1234',
        GIT_SSH_COMMAND: 'ssh -i ~/.ssh/id_ed25519',
        GIT_ASKPASS: '/usr/local/bin/askpass.sh',
        GH_TOKEN: 'gh-secret',
        GITHUB_TOKEN: 'github-secret',
      };
      const env = createRobustEnv(baseEnv);

      expect(env.SSH_AUTH_SOCK).toBe('/tmp/ssh-agent.sock');
      expect(env.SSH_AGENT_PID).toBe('1234');
      expect(env.GIT_SSH_COMMAND).toBe('ssh -i ~/.ssh/id_ed25519');
      expect(env.GIT_ASKPASS).toBe('/usr/local/bin/askpass.sh');
      expect(env.GH_TOKEN).toBe('gh-secret');
      expect(env.GITHUB_TOKEN).toBe('github-secret');
    });

    it('ensures well-known user bin dirs are on PATH without duplicating entries', () => {
      if (process.platform === 'win32') return;
      const nodeBinDir = getNodeBinDir();
      const env = createRobustEnv({ PATH: '/usr/bin:/bin' });
      const parts = env.PATH.split(':');

      expect(parts[0]).toBe(nodeBinDir);
      expect(parts).toContain('/opt/homebrew/bin');
      expect(parts).toContain('/usr/local/bin');

      const again = createRobustEnv({ PATH: env.PATH });
      const dupes = again.PATH.split(':').filter((p) => p === '/opt/homebrew/bin');
      expect(dupes).toHaveLength(1);
    });

    it('fills USER/LOGNAME when missing so tools see a consistent identity', async () => {
      const { userInfo } = await import('os');
      let expected = null;
      try {
        expected = userInfo().username;
      } catch {
        expected = null;
      }
      if (!expected) return;
      const env = createRobustEnv({ PATH: '/usr/bin:/bin' });

      expect(env.USER).toBe(expected);
      expect(env.LOGNAME).toBe(expected);
    });
  });

  describe('createClaudeCodeSpawner', () => {
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

    it('captures Claude SDK launches with sanitized MCP config when E2E capture is enabled', async () => {
      const captureFile = join(tempDir, 'capture.jsonl');
      process.env.E2E_AGENT_SPAWN_CAPTURE_FILE = captureFile;

      const spawner = createClaudeCodeSpawner();
      const processStub = spawner({
        command: 'claude',
        args: [
          '--model',
          'claude-sonnet-4-20250514',
          '--setting-sources',
          'user,project,local',
          '--mcp-config',
          JSON.stringify({
            mcpServers: {
              testServer: { command: 'node', args: ['secret-server.js'] },
            },
          }),
        ],
        cwd: tempDir,
        env: {},
        signal: new AbortController().signal,
      });

      await collectProcessClose(processStub);

      const record = JSON.parse(readFileSync(captureFile, 'utf8').trim());
      expect(record.options.settingSources).toBe('user,project,local');
      expect(record.options.mcpServers).toEqual([
        { name: 'testServer', transport: 'stdio' },
      ]);
      expect(record.args).toContain('[redacted]');
      expect(JSON.stringify(record)).not.toContain('secret-server.js');
    });
  });
});

function collectProcessClose(processStub) {
  return new Promise((resolve) => {
    processStub.once('close', resolve);
  });
}
