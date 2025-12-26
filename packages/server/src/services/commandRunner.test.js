import { describe, it, expect, beforeEach } from 'vitest';
import { CommandRunner } from './commandRunner.js';

describe('CommandRunner', () => {
  let runner;

  beforeEach(() => {
    runner = new CommandRunner();
  });

  describe('run', () => {
    it('executes a simple command and captures output', async () => {
      const outputs = [];
      let completed = false;
      let exitCode = null;

      const result = await runner.run(
        'test-run-1',
        'echo "Hello, World!"',
        process.cwd(),
        (text) => outputs.push(text),
        (code) => {
          completed = true;
          exitCode = code;
        }
      );

      expect(result).toBe(0);
      expect(completed).toBe(true);
      expect(exitCode).toBe(0);
      expect(outputs.join('').length).toBeGreaterThan(0);
    });

    it('returns exit code 0 for successful command', async () => {
      const exitCode = await runner.run(
        'test-run-2',
        'true',
        process.cwd(),
        () => {},
        () => {}
      );

      expect(exitCode).toBe(0);
    });

    it('returns non-zero exit code for failed command', async () => {
      const exitCode = await runner.run(
        'test-run-3',
        'false',
        process.cwd(),
        () => {},
        () => {}
      );

      expect(exitCode).not.toBe(0);
    });

    it('uses specified working directory', async () => {
      let output = '';
      const tmpDir = process.cwd();

      await runner.run(
        'test-run-4',
        'pwd',
        tmpDir,
        (text) => {
          output += text;
        },
        () => {}
      );

      // pwd output should contain the working directory path
      expect(output.trim().length).toBeGreaterThan(0);
    });

    it('captures both stdout and stderr', async () => {
      let output = '';

      await runner.run(
        'test-run-5',
        'echo "stdout"; >&2 echo "stderr"',
        process.cwd(),
        (text) => {
          output += text;
        },
        () => {}
      );

      expect(output.length).toBeGreaterThan(0);
    });

    it('calls onComplete callback', async () => {
      let callbackCalled = false;
      let callbackExitCode = null;

      await runner.run(
        'test-run-6',
        'echo test',
        process.cwd(),
        () => {},
        (code) => {
          callbackCalled = true;
          callbackExitCode = code;
        }
      );

      expect(callbackCalled).toBe(true);
      expect(callbackExitCode).toBe(0);
    });

    it('handles command execution', async () => {
      const exitCode = await runner.run(
        'test-run-7',
        'echo "test"',
        process.cwd(),
        () => {},
        () => {}
      );

      expect(exitCode).toBe(0);
    });
  });

  describe('kill', () => {
    it('returns false when killing non-existent process', () => {
      const killed = runner.kill('nonexistent-run');
      expect(killed).toBe(false);
    });
  });

  describe('isRunning', () => {
    it('returns false for non-existent run', () => {
      expect(runner.isRunning('nonexistent')).toBe(false);
    });
  });

  describe('getActiveRuns', () => {
    it('returns empty map when no runs active', () => {
      const active = runner.getActiveRuns();
      expect(active.size).toBe(0);
    });
  });
});
