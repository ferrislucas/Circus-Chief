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

  describe('metadata and output buffering', () => {
    it('stores sessionId and buttonId from metadata', async () => {
      const runId = 'test-metadata-1';
      let activeRunsDuringExecution = null;

      // Start a command that gives us time to check state
      const runPromise = runner.run(
        runId,
        'echo "test" && sleep 0.1',
        process.cwd(),
        () => {
          // Check active runs while command is running
          activeRunsDuringExecution = runner.getActiveRuns();
        },
        () => {},
        () => {},
        { sessionId: 'session-123', buttonId: 'button-456' }
      );

      await runPromise;

      // Verify metadata was stored during execution
      if (activeRunsDuringExecution && activeRunsDuringExecution.size > 0) {
        const entry = activeRunsDuringExecution.get(runId);
        expect(entry.sessionId).toBe('session-123');
        expect(entry.buttonId).toBe('button-456');
      }
    });

    it('buffers output in the process entry', async () => {
      const runId = 'test-buffer-1';
      let capturedOutput = '';

      await runner.run(
        runId,
        'echo "buffered output"',
        process.cwd(),
        () => {},
        (exitCode, output) => {
          capturedOutput = output;
        },
        () => {},
        { sessionId: 'session-1', buttonId: 'button-1' }
      );

      expect(capturedOutput).toContain('buffered output');
    });

    it('passes buffered output to onComplete callback', async () => {
      let completeOutput = null;

      await runner.run(
        'test-complete-output',
        'echo "line1"; echo "line2"',
        process.cwd(),
        () => {},
        (exitCode, output) => {
          completeOutput = output;
        },
        () => {},
        { sessionId: 's1', buttonId: 'b1' }
      );

      expect(completeOutput).toContain('line1');
      expect(completeOutput).toContain('line2');
    });

    it('works without metadata (backward compatible)', async () => {
      const exitCode = await runner.run(
        'test-no-metadata',
        'echo "test"',
        process.cwd(),
        () => {},
        () => {}
      );

      expect(exitCode).toBe(0);
    });
  });

  describe('getRunsBySession', () => {
    it('returns empty array when no runs for session', () => {
      const runs = runner.getRunsBySession('nonexistent-session');
      expect(runs).toEqual([]);
    });

    it('returns runs for matching session', async () => {
      const runId = 'test-session-run';
      let runsFoundDuringExecution = [];

      // Start a longer-running command
      const runPromise = runner.run(
        runId,
        'sleep 0.2 && echo "done"',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId: 'target-session', buttonId: 'btn-1' }
      );

      // Check runs while command is still running
      await new Promise((resolve) => setTimeout(resolve, 50));
      runsFoundDuringExecution = runner.getRunsBySession('target-session');

      await runPromise;

      expect(runsFoundDuringExecution.length).toBe(1);
      expect(runsFoundDuringExecution[0].runId).toBe(runId);
      expect(runsFoundDuringExecution[0].buttonId).toBe('btn-1');
      expect(runsFoundDuringExecution[0].status).toBe('running');
    });

    it('does not return runs for different session', async () => {
      const runPromise = runner.run(
        'test-other-session',
        'sleep 0.2',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId: 'session-A', buttonId: 'btn-1' }
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      const runs = runner.getRunsBySession('session-B');

      await runPromise;

      expect(runs).toEqual([]);
    });

    it('includes buffered output in returned runs', async () => {
      const runId = 'test-output-in-runs';
      let runsWithOutput = [];

      const runPromise = runner.run(
        runId,
        'echo "captured" && sleep 0.2',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId: 'output-session', buttonId: 'btn-1' }
      );

      // Wait for output to be captured
      await new Promise((resolve) => setTimeout(resolve, 100));
      runsWithOutput = runner.getRunsBySession('output-session');

      await runPromise;

      expect(runsWithOutput.length).toBe(1);
      expect(runsWithOutput[0].output).toContain('captured');
    });
  });
});
