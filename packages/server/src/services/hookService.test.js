import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeHook, executeHookAsync } from './hookService.js';
import { mkdtemp, rm, readFile, realpath } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('hookService', () => {
  let tempDir;

  beforeEach(async () => {
    // Use realpath to resolve symlinks (e.g., macOS /var -> /private/var)
    tempDir = await realpath(await mkdtemp(join(tmpdir(), 'hookservice-test-')));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('executeHook', () => {
    it('returns success with empty command', async () => {
      const result = await executeHook('', tempDir, {});
      expect(result.success).toBe(true);
    });

    it('returns success with null command', async () => {
      const result = await executeHook(null, tempDir, {});
      expect(result.success).toBe(true);
    });

    it('executes a simple shell command', async () => {
      const result = await executeHook('echo "hello"', tempDir, {});
      expect(result.success).toBe(true);
      expect(result.stdout).toBe('hello');
    });

    it('executes command in specified working directory', async () => {
      const result = await executeHook('pwd', tempDir, {});
      expect(result.success).toBe(true);
      // On macOS, /var is a symlink to /private/var, so we compare real paths
      const expectedPath = await realpath(tempDir);
      expect(result.stdout).toBe(expectedPath);
    });

    it('passes context as environment variables', async () => {
      const context = {
        sessionId: 'test-session-123',
        projectId: 'test-project-456',
        sessionName: 'My Test Session',
      };
      const result = await executeHook(
        'echo "$CIRCUSCHIEF_SESSION_ID|$CIRCUSCHIEF_PROJECT_ID|$CIRCUSCHIEF_SESSION_NAME"',
        tempDir,
        context
      );
      expect(result.success).toBe(true);
      expect(result.stdout).toBe('test-session-123|test-project-456|My Test Session');
    });

    it('returns error for failed command', async () => {
      const result = await executeHook('exit 1', tempDir, {});
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('can create files in working directory', async () => {
      const testFile = join(tempDir, 'hook-output.txt');
      const result = await executeHook(`echo "hook executed" > "${testFile}"`, tempDir, {});
      expect(result.success).toBe(true);

      const content = await readFile(testFile, 'utf-8');
      expect(content.trim()).toBe('hook executed');
    });

    it('can execute multi-line scripts', async () => {
      const testFile = join(tempDir, 'multi-line.txt');
      const script = `
        echo "line1" > "${testFile}"
        echo "line2" >> "${testFile}"
      `;
      const result = await executeHook(script, tempDir, {});
      expect(result.success).toBe(true);

      const content = await readFile(testFile, 'utf-8');
      expect(content.trim()).toBe('line1\nline2');
    });
  });

  describe('executeHookAsync', () => {
    it('does not throw with null command', () => {
      expect(() => executeHookAsync(null, tempDir, {})).not.toThrow();
    });

    it('does not throw with empty command', () => {
      expect(() => executeHookAsync('', tempDir, {})).not.toThrow();
    });

    it('executes command asynchronously and creates file', async () => {
      const testFile = join(tempDir, 'async-output.txt');
      executeHookAsync(`echo "async hook" > "${testFile}"`, tempDir, {
        sessionId: 'async-test',
        projectId: 'async-project',
      });

      // Wait for the async execution to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      const content = await readFile(testFile, 'utf-8');
      expect(content.trim()).toBe('async hook');
    });

    it('does not block the caller', async () => {
      const startTime = Date.now();

      // This command takes 500ms to complete
      executeHookAsync('sleep 0.5 && echo "done"', tempDir, {});

      const elapsed = Date.now() - startTime;
      // Should return much faster than the command execution time (500ms)
      // Allow generous margin for CI environments
      expect(elapsed).toBeLessThan(300);
    });
  });
});
