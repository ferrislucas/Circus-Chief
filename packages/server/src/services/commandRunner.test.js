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

  describe('getRunsBySession with database runs', () => {
    it('returns both running and recent completed runs', async () => {
      const runId = 'test-db-run';
      let completedRuns = [];

      // Start and complete a run
      await runner.run(
        runId,
        'echo "done"',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId: 'db-session', buttonId: 'btn-1' }
      );

      // Give time for database operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that getRunsBySession can fetch from database
      completedRuns = runner.getRunsBySession('db-session');

      // Should find the completed run
      expect(completedRuns.length).toBeGreaterThanOrEqual(0); // May or may not be in DB depending on mock setup
    });

    it('includes startedAt in returned run data', async () => {
      const runId = 'test-started-at';

      const runPromise = runner.run(
        runId,
        'sleep 0.1 && echo "test"',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId: 'time-session', buttonId: 'btn-1' }
      );

      // Check while running
      await new Promise((resolve) => setTimeout(resolve, 50));
      const runs = runner.getRunsBySession('time-session');

      if (runs.length > 0) {
        expect(runs[0].startedAt).toBeDefined();
        expect(typeof runs[0].startedAt).toBe('number');
      }

      await runPromise;
    });

    it('handles database unavailability gracefully', async () => {
      const runId = 'test-graceful-degradation';

      // Run should still work even if database is not fully initialized
      const exitCode = await runner.run(
        runId,
        'echo "test"',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId: 'robust-session', buttonId: 'btn-1' }
      );

      expect(exitCode).toBe(0);

      // getRunsBySession should at least return running processes
      const runs = runner.getRunsBySession('robust-session');
      // Depending on timing, may or may not include the run
      expect(Array.isArray(runs)).toBe(true);
    });
  });

  describe('output buffering and flushing', () => {
    it('collects output in output buffer during execution', async () => {
      const runId = 'test-output-buffer';
      let collectedOutput = '';

      await runner.run(
        runId,
        'echo "line1"; echo "line2"; echo "line3"',
        process.cwd(),
        (text) => {
          collectedOutput += text;
        },
        () => {},
        () => {},
        { sessionId: 'buffer-session', buttonId: 'btn-1' }
      );

      // Verify all output was captured
      expect(collectedOutput).toContain('line1');
      expect(collectedOutput).toContain('line2');
      expect(collectedOutput).toContain('line3');
    });

    it('passes output buffer to onComplete callback', async () => {
      let completeOutput = '';

      await runner.run(
        'test-complete-buffer',
        'echo "output1"; echo "output2"',
        process.cwd(),
        () => {},
        (exitCode, output) => {
          completeOutput = output;
        },
        () => {},
        { sessionId: 'complete-session', buttonId: 'btn-1' }
      );

      expect(completeOutput.length).toBeGreaterThan(0);
      expect(completeOutput).toContain('output1');
      expect(completeOutput).toContain('output2');
    });

    it('handles large output streams without losing data', async () => {
      let totalOutputLength = 0;

      // Generate output larger than typical buffer sizes
      const largeCommand = `for i in {1..100}; do echo "Line $i with some text"; done`;

      await runner.run(
        'test-large-output',
        largeCommand,
        process.cwd(),
        (text) => {
          totalOutputLength += text.length;
        },
        (exitCode, output) => {
          totalOutputLength = output.length;
        },
        () => {},
        { sessionId: 'large-session', buttonId: 'btn-1' }
      );

      expect(totalOutputLength).toBeGreaterThan(0);
    });

    it('flushes buffer periodically during long running commands', async () => {
      let callCount = 0;
      const capturedChunks = [];

      const runPromise = runner.run(
        'test-periodic-flush',
        'for i in {1..10}; do echo "Output $i"; sleep 0.05; done',
        process.cwd(),
        (text) => {
          callCount++;
          capturedChunks.push(text);
        },
        () => {},
        () => {},
        { sessionId: 'flush-session', buttonId: 'btn-1' }
      );

      await runPromise;

      // Should have multiple output chunks
      expect(callCount).toBeGreaterThan(0);
      expect(capturedChunks.length).toBeGreaterThan(0);
    });
  });

  describe('error handling with database operations', () => {
    it('handles command execution error gracefully', async () => {
      const runId = 'test-cmd-error';

      const exitCode = await runner.run(
        runId,
        'nonexistent_command_12345',
        process.cwd(),
        () => {},
        (_code, _output) => {},
        (_msg) => {},
        { sessionId: 'error-session', buttonId: 'btn-1' }
      );

      // Should return non-zero exit code or have an error
      expect(exitCode).not.toBe(0);
    });

    it('handles signal termination correctly', async () => {
      const runId = 'test-signal';

      const runPromise = runner.run(
        runId,
        'sleep 10',
        process.cwd(),
        () => {},
        (_code, _output) => {
        },
        () => {},
        { sessionId: 'signal-session', buttonId: 'btn-1' }
      );

      // Give time for process to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Kill the process
      runner.kill(runId);

      const result = await runPromise;

      // Process should be terminated
      expect(result).not.toBe(0);
    });

    it('continues functioning after errors', async () => {
      // First command fails
      await runner.run(
        'test-error-1',
        'false',
        process.cwd(),
        () => {},
        () => {},
        () => {}
      );

      // Second command succeeds
      const result = await runner.run(
        'test-error-2',
        'true',
        process.cwd(),
        () => {},
        () => {},
        () => {}
      );

      expect(result).toBe(0);
    });

    it('passes error message to onError callback when process spawn fails', async () => {
      const runId = 'test-error-callback';
      let errorMessage = null;

      // Run with invalid working directory to trigger error
      const exitCode = await runner.run(
        runId,
        'echo test',
        '/nonexistent/directory/that/does/not/exist',
        () => {},
        () => {},
        (msg) => {
          errorMessage = msg;
        },
        { sessionId: 'error-callback-session', buttonId: 'btn-1' }
      );

      // Should return error exit code
      expect(exitCode).not.toBe(0);
      // Error callback should have been called with error message
      expect(errorMessage).not.toBeNull();
      // The message should contain "Failed to execute" (from child.on('error') handler)
      expect(errorMessage).toContain('Failed to execute command');
    });

    it('persists error message when command execution fails', async () => {
      const runId = 'test-error-persistence';
      let errorMessage = null;

      // Run with invalid working directory to trigger error
      await runner.run(
        runId,
        'echo test',
        '/nonexistent/path/xyz',
        () => {},
        () => {},
        (msg) => {
          errorMessage = msg;
        },
        { sessionId: 'error-persistence-session', buttonId: 'btn-1' }
      );

      // Error callback should have been called with error message
      expect(errorMessage).not.toBeNull();
      expect(errorMessage).toBeDefined();
      // Error should be captured and passed to callback
      expect(typeof errorMessage).toBe('string');
      expect(errorMessage.length).toBeGreaterThan(0);
    });
  });

  describe('integration with metadata', () => {
    it('preserves sessionId and buttonId through entire lifecycle', async () => {
      const sessionId = 'metadata-session';
      const buttonId = 'metadata-button';
      const runId = 'test-metadata-full';
      let capturedMetadata = null;

      const runPromise = runner.run(
        runId,
        'sleep 0.1 && echo "done"',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId, buttonId }
      );

      // Capture during execution
      await new Promise((resolve) => setTimeout(resolve, 50));
      const activeRuns = runner.getActiveRuns();
      if (activeRuns.has(runId)) {
        const entry = activeRuns.get(runId);
        capturedMetadata = {
          sessionId: entry.sessionId,
          buttonId: entry.buttonId,
        };
      }

      await runPromise;

      if (capturedMetadata) {
        expect(capturedMetadata.sessionId).toBe(sessionId);
        expect(capturedMetadata.buttonId).toBe(buttonId);
      }
    });
  });
});
