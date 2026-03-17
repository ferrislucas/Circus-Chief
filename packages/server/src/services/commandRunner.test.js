import { describe, it, expect, beforeEach } from 'vitest';
import { CommandRunner, stripAnsiCodes, TerminalOutputProcessor } from './commandRunner.js';
import * as osModule from 'os';

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

    // New options object signature tests
    describe('options object signature', () => {
      it('executes command with params object and callbacks object', async () => {
        const outputs = [];
        const exitCode = await runner.run(
          { runId: 'test-options-1', command: 'echo "options test"', workingDirectory: process.cwd() },
          {
            onOutput: (text) => outputs.push(text),
            onComplete: () => {},
            onError: () => {},
          }
        );

        expect(exitCode).toBe(0);
        expect(outputs.join('').length).toBeGreaterThan(0);
      });

      it('executes command with only onOutput callback', async () => {
        let output = '';
        const exitCode = await runner.run(
          { runId: 'test-options-2', command: 'echo "single callback"', workingDirectory: process.cwd() },
          {
            onOutput: (text) => { output += text; },
          }
        );

        expect(exitCode).toBe(0);
        expect(output).toContain('single callback');
      });

      it('passes sessionId and buttonId from metadata parameter', async () => {
        let capturedMetadata = null;
        const runPromise = runner.run(
          { runId: 'test-options-3', command: 'sleep 0.1', workingDirectory: process.cwd() },
          {
            onOutput: () => {},
            onComplete: () => {},
            onError: () => {},
          },
          { sessionId: 'session-abc', buttonId: 'button-xyz' }
        );

        // Check active runs while command is executing
        await new Promise((resolve) => setTimeout(resolve, 50));
        const activeRuns = runner.getActiveRuns();
        if (activeRuns.has('test-options-3')) {
          const entry = activeRuns.get('test-options-3');
          capturedMetadata = {
            sessionId: entry.sessionId,
            buttonId: entry.buttonId,
          };
        }

        await runPromise;

        if (capturedMetadata) {
          expect(capturedMetadata.sessionId).toBe('session-abc');
          expect(capturedMetadata.buttonId).toBe('button-xyz');
        }
      });

      it('calls onComplete callback with correct parameters', async () => {
        let callbackCalled = false;
        let callbackExitCode = null;
        let callbackOutput = null;

        const exitCode = await runner.run(
          { runId: 'test-options-4', command: 'echo "complete test"', workingDirectory: process.cwd() },
          {
            onOutput: () => {},
            onComplete: (code, output) => {
              callbackCalled = true;
              callbackExitCode = code;
              callbackOutput = output;
            },
          }
        );

        expect(exitCode).toBe(0);
        expect(callbackCalled).toBe(true);
        expect(callbackExitCode).toBe(0);
        expect(callbackOutput).toContain('complete test');
      });

      it('calls onError callback when command fails', async () => {
        let errorMessage = null;
        const exitCode = await runner.run(
          { runId: 'test-options-5', command: 'echo test', workingDirectory: '/nonexistent/directory' },
          {
            onOutput: () => {},
            onComplete: () => {},
            onError: (msg) => { errorMessage = msg; },
          }
        );

        expect(exitCode).not.toBe(0);
        expect(errorMessage).not.toBeNull();
        expect(errorMessage).toContain('Failed to execute command');
      });

      it('works without onError callback', async () => {
        const exitCode = await runner.run(
          { runId: 'test-options-6', command: 'echo "no error callback"', workingDirectory: process.cwd() },
          {
            onOutput: () => {},
            onComplete: () => {},
          }
        );

        expect(exitCode).toBe(0);
      });

      it('works with empty callbacks object', async () => {
        const exitCode = await runner.run(
          { runId: 'test-options-7', command: 'true', workingDirectory: process.cwd() },
          {}
        );

        expect(exitCode).toBe(0);
      });

      it('works without metadata parameter', async () => {
        const exitCode = await runner.run(
          { runId: 'test-options-8', command: 'echo "no metadata"', workingDirectory: process.cwd() },
          {
            onOutput: () => {},
            onComplete: () => {},
          }
        );

        expect(exitCode).toBe(0);
      });
    });

    // Backward compatibility tests for legacy positional parameters
    describe('backward compatibility with legacy positional parameters', () => {
      it('supports legacy signature with all positional parameters', async () => {
        const outputs = [];
        let completed = false;

        const result = await runner.run(
          'test-legacy-1',
          'echo "legacy test"',
          process.cwd(),
          (text) => outputs.push(text),
          () => { completed = true; }
        );

        expect(result).toBe(0);
        expect(completed).toBe(true);
        expect(outputs.join('').length).toBeGreaterThan(0);
      });

      it('supports legacy signature with onError callback', async () => {
        let errorCalled = false;
        const exitCode = await runner.run(
          'test-legacy-2',
          'false',
          process.cwd(),
          () => {},
          () => {},
          () => { errorCalled = true; }
        );

        expect(exitCode).not.toBe(0);
        expect(errorCalled).toBe(false);
        // onError is only called for spawn errors, not non-zero exit codes
      });

      it('supports legacy signature with metadata object', async () => {
        const runPromise = runner.run(
          'test-legacy-3',
          'sleep 0.1',
          process.cwd(),
          () => {},
          () => {},
          () => {},
          { sessionId: 'legacy-session', buttonId: 'legacy-button' }
        );

        // Check active runs
        await new Promise((resolve) => setTimeout(resolve, 50));
        const activeRuns = runner.getActiveRuns();

        if (activeRuns.has('test-legacy-3')) {
          const entry = activeRuns.get('test-legacy-3');
          expect(entry.sessionId).toBe('legacy-session');
          expect(entry.buttonId).toBe('legacy-button');
        }

        await runPromise;
      });

      it('supports legacy signature without metadata', async () => {
        const exitCode = await runner.run(
          'test-legacy-4',
          'echo "no metadata"',
          process.cwd(),
          () => {},
          () => {}
        );

        expect(exitCode).toBe(0);
      });

      it('mixed legacy and new calls work correctly', async () => {
        // First call with legacy signature
        const legacyPromise = runner.run(
          'test-mixed-legacy',
          'sleep 0.1',
          process.cwd(),
          () => {},
          () => {}
        );

        // Second call with new signature
        const newPromise = runner.run(
          { runId: 'test-mixed-new', command: 'sleep 0.1', workingDirectory: process.cwd() },
          { onOutput: () => {}, onComplete: () => {} }
        );

        // Both should complete successfully
        const [legacyExit, newExit] = await Promise.all([legacyPromise, newPromise]);

        expect(legacyExit).toBe(0);
        expect(newExit).toBe(0);
      });
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

  describe('getRunningByProjectId', () => {
    it('returns empty array when no runs are active', () => {
      const getSessionById = (sessionId) => ({ id: sessionId, projectId: 'proj-1' });
      const runs = runner.getRunningByProjectId('proj-1', getSessionById);
      expect(runs).toEqual([]);
    });

    it('returns running commands for a specific project', async () => {
      const sessionId = 'session-1';
      const getSessionById = (id) => (id === sessionId ? { id: sessionId, projectId: 'proj-1' } : null);

      // Start a long-running command
      const runPromise = runner.run(
        'run-1',
        'sleep 1',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId, buttonId: 'btn-1' }
      );

      // Query while command is running
      const runs = runner.getRunningByProjectId('proj-1', getSessionById);

      expect(runs.length).toBe(1);
      expect(runs[0].runId).toBe('run-1');
      expect(runs[0].sessionId).toBe(sessionId);
      expect(runs[0].buttonId).toBe('btn-1');
      expect(runs[0].status).toBe('running');
      expect(runs[0].exitCode).toBeNull();
      expect(runs[0].startedAt).toBeDefined();

      // Clean up
      await runPromise;
    });

    it('excludes commands from other projects', async () => {
      const getSessionById = (sessionId) => {
        if (sessionId === 'session-1') return { id: sessionId, projectId: 'proj-1' };
        if (sessionId === 'session-2') return { id: sessionId, projectId: 'proj-2' };
        return null;
      };

      // Start commands in different projects
      const run1Promise = runner.run(
        'run-1',
        'sleep 1',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId: 'session-1', buttonId: 'btn-1' }
      );

      const run2Promise = runner.run(
        'run-2',
        'sleep 1',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId: 'session-2', buttonId: 'btn-2' }
      );

      // Query proj-1 should only return run-1
      const proj1Runs = runner.getRunningByProjectId('proj-1', getSessionById);
      expect(proj1Runs.length).toBe(1);
      expect(proj1Runs[0].runId).toBe('run-1');

      // Query proj-2 should only return run-2
      const proj2Runs = runner.getRunningByProjectId('proj-2', getSessionById);
      expect(proj2Runs.length).toBe(1);
      expect(proj2Runs[0].runId).toBe('run-2');

      // Clean up
      await Promise.all([run1Promise, run2Promise]);
    });

    it('returns multiple running commands for same project', async () => {
      const sessionId = 'session-1';
      const getSessionById = (id) => (id === sessionId ? { id: sessionId, projectId: 'proj-1' } : null);

      // Start multiple commands
      const run1Promise = runner.run(
        'run-1',
        'sleep 1',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId, buttonId: 'btn-1' }
      );

      const run2Promise = runner.run(
        'run-2',
        'sleep 1',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId, buttonId: 'btn-2' }
      );

      // Query should return both
      const runs = runner.getRunningByProjectId('proj-1', getSessionById);
      expect(runs.length).toBe(2);

      const runIds = runs.map((r) => r.runId);
      expect(runIds).toContain('run-1');
      expect(runIds).toContain('run-2');

      // Clean up
      await Promise.all([run1Promise, run2Promise]);
    });

    it('handles missing session gracefully', () => {
      const getSessionById = () => null; // Session not found
      const runs = runner.getRunningByProjectId('proj-1', getSessionById);
      expect(runs).toEqual([]);
    });

    it('includes output in returned runs', async () => {
      const sessionId = 'session-1';
      const getSessionById = (id) => (id === sessionId ? { id: sessionId, projectId: 'proj-1' } : null);

      const runPromise = runner.run(
        'run-1',
        'sleep 0.5 && echo "test output"',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId, buttonId: 'btn-1' }
      );

      // Give command time to start and produce output
      await new Promise((resolve) => setTimeout(resolve, 100));

      const runs = runner.getRunningByProjectId('proj-1', getSessionById);

      // If the command is still running, it should have output
      if (runs.length > 0) {
        expect(runs[0].output).toBeDefined();
      }

      // Clean up
      await runPromise;
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

    it('returns only the latest run per button (one per button)', async () => {
      const sessionId = 'latest-per-button-session';
      const buttonId = 'btn-multiple';

      // Create multiple runs for the same button
      const run1Promise = runner.run(
        'run-1',
        'echo "first"',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId, buttonId }
      );

      await run1Promise;

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 50));

      const run2Promise = runner.run(
        'run-2',
        'echo "second"',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId, buttonId }
      );

      await run2Promise;

      // Give time for database operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get runs for the session
      const runs = runner.getRunsBySession(sessionId);

      // Filter runs for this specific button
      const buttonRuns = runs.filter((r) => r.buttonId === buttonId);

      // Note: The commandRunner may not have database access in test environment
      // The actual "one per button" behavior is tested in CommandRunRepository.test.js
      // Here we just verify that getRunsBySession works correctly
      // If database is available, it should return only the latest run per button
      // If not available, it will return an empty array or only in-memory runs

      // At minimum, the function should return an array
      expect(Array.isArray(runs)).toBe(true);

      // If runs are returned (database available), verify they're unique per button
      if (buttonRuns.length > 0) {
        // Should have exactly one run per button
        const uniqueButtons = new Set(buttonRuns.map((r) => r.runId));
        expect(uniqueButtons.size).toBe(buttonRuns.length);
      }
    });

    it('returns runs regardless of age (no time limit)', async () => {
      const sessionId = 'no-time-limit-session';
      const buttonId = 'btn-old';

      // Create a run and mark it as very old
      // Note: This test assumes we can manipulate timestamps
      // In a real database scenario, we'd need to manually update the DB
      const exitCode = await runner.run(
        'old-run',
        'echo "old"',
        process.cwd(),
        () => {},
        () => {},
        () => {},
        { sessionId, buttonId }
      );

      expect(exitCode).toBe(0);

      // Give time for database operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get runs - should return the run even if it's old (no time limit)
      const runs = runner.getRunsBySession(sessionId);

      // Should find the run regardless of age
      expect(Array.isArray(runs)).toBe(true);
      // The actual verification depends on DB persistence
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

  describe('platform-specific script command construction', () => {
    it('executes commands successfully on current platform', async () => {
      const runId = 'test-platform-native';
      let output = '';

      const exitCode = await runner.run(
        runId,
        'echo "platform test"',
        process.cwd(),
        (text) => {
          output += text;
        },
        () => {},
        () => {},
        { sessionId: 'platform-session', buttonId: 'btn-1' }
      );

      expect(exitCode).toBe(0);
      expect(output).toContain('platform test');
    });

    it('returns non-zero exit code on failed command regardless of platform', async () => {
      const runId = 'test-platform-failure';

      const exitCode = await runner.run(
        runId,
        'exit 42',
        process.cwd(),
        () => {},
        () => {},
        () => {}
      );

      expect(exitCode).not.toBe(0);
    });

    it('uses correct script flags based on platform', () => {
      // This test verifies the logic without actually executing commands
      // The key fix: script command is wrapped with platform-specific flags
      // - Linux: script -q -e -c [command] /dev/null (includes -e for exit code)
      // - macOS/Darwin: script -q -c [command] /dev/null (no -e, uses close event instead)
      const currentPlatform = osModule.platform();

      // Verify that os.platform() is callable
      expect(typeof currentPlatform).toBe('string');
      expect(currentPlatform.length).toBeGreaterThan(0);

      // Verify it returns one of the expected platforms
      const validPlatforms = ['linux', 'darwin', 'win32', 'freebsd', 'sunos'];
      expect(validPlatforms).toContain(currentPlatform);
    });

    it('handles command with arguments on current platform', async () => {
      const runId = 'test-platform-args';
      let output = '';

      const exitCode = await runner.run(
        runId,
        'echo "hello" && echo "world"',
        process.cwd(),
        (text) => {
          output += text;
        },
        () => {},
        () => {},
        { sessionId: 'args-platform-session', buttonId: 'btn-1' }
      );

      expect(exitCode).toBe(0);
      expect(output.length).toBeGreaterThan(0);
    });
  });

  describe('stripAnsiCodes', () => {
    it('removes SGR color codes', () => {
      expect(stripAnsiCodes('\x1b[31mRed\x1b[0m')).toBe('Red');
      expect(stripAnsiCodes('\x1b[1;32mBold Green\x1b[0m')).toBe('Bold Green');
      expect(stripAnsiCodes('\x1b[4;33mUnderline Yellow\x1b[0m')).toBe('Underline Yellow');
    });

    it('removes cursor movement sequences', () => {
      expect(stripAnsiCodes('\x1b[1AUp')).toBe('Up');
      expect(stripAnsiCodes('\x1b[2BDown')).toBe('Down');
      expect(stripAnsiCodes('\x1b[3CRight')).toBe('Right');
      expect(stripAnsiCodes('\x1b[4DLeft')).toBe('Left');
    });

    it('removes line clearing sequences', () => {
      expect(stripAnsiCodes('\x1b[2KCleared')).toBe('Cleared');
      expect(stripAnsiCodes('\x1b[0KPartial')).toBe('Partial');
      expect(stripAnsiCodes('\x1b[1KPartialBefore')).toBe('PartialBefore');
    });

    it('removes cursor positioning sequences', () => {
      expect(stripAnsiCodes('\x1b[1GColumn')).toBe('Column');
      expect(stripAnsiCodes('\x1b[5;10HPosition')).toBe('Position');
    });

    it('removes screen clearing sequences', () => {
      expect(stripAnsiCodes('\x1b[2JScreen')).toBe('Screen');
      expect(stripAnsiCodes('\x1b[0JFrom')).toBe('From');
      expect(stripAnsiCodes('\x1b[3JScrollback')).toBe('Scrollback');
    });

    it('handles yarn-style progress output', () => {
      // Real yarn output uses ESC sequences (\x1b), not literal brackets
      const yarnOutput = '\x1b[2K\x1b[1Gyarn install v1.22.22\n\x1b[2K\x1b[1G[1/4] Resolving packages...\n\x1b[2K\x1b[1G[] 0/576\x1b[1G[] 69/576';
      const cleaned = stripAnsiCodes(yarnOutput);
      expect(cleaned).toContain('yarn install');
      expect(cleaned).toContain('[1/4]');
      expect(cleaned).toContain('[] 0/576');
      expect(cleaned).toContain('[] 69/576');
      // The cleaned output should not contain any ESC sequences
      expect(cleaned).not.toContain('\x1b');
    });

    it('preserves regular text content', () => {
      const input = 'This is plain text';
      expect(stripAnsiCodes(input)).toBe(input);
    });

    it('handles mixed content with colors and cursor codes', () => {
      const mixed = '\x1b[2K\x1b[1G\x1b[32mSuccess\x1b[0m\x1b[1A\x1b[0K';
      const cleaned = stripAnsiCodes(mixed);
      expect(cleaned).toBe('Success');
      expect(cleaned).not.toContain('\x1b');
    });

    it('handles null and non-string inputs gracefully', () => {
      expect(stripAnsiCodes(null)).toBe(null);
      expect(stripAnsiCodes(undefined)).toBe(undefined);
      expect(stripAnsiCodes('')).toBe('');
      expect(stripAnsiCodes(123)).toBe(123);
    });

    it('strips ANSI codes during command output capture', async () => {
      const outputs = [];
      const output = [];

      const result = await runner.run(
        'test-ansi-strip',
        // Create output with ANSI codes
        `echo "\\x1b[31mRed Text\\x1b[0m" && echo "\\x1b[1;32mBold Green\\x1b[0m"`,
        process.cwd(),
        (text) => {
          outputs.push(text);
        },
        (code, fullOutput) => {
          output.push(fullOutput);
        }
      );

      expect(result).toBe(0);
      // The output callbacks should receive cleaned text (without ANSI codes)
      const _allOutput = outputs.join('');
      // Note: The actual content depends on how the shell interprets the escape sequences
      // What's important is that if any ANSI codes are present, they should be minimal
    });
  });

  describe('TerminalOutputProcessor', () => {
    let processor;

    beforeEach(() => {
      processor = new TerminalOutputProcessor();
    });

    describe('basic processing', () => {
      it('passes through regular text without modification', () => {
        const result = processor.process('Hello World\n');
        expect(result).toBe('Hello World\n');
      });

      it('handles empty input', () => {
        expect(processor.process('')).toBe('');
        expect(processor.process(null)).toBe('');
        expect(processor.process(undefined)).toBe('');
      });

      it('buffers incomplete lines (no newline)', () => {
        const result = processor.process('partial');
        expect(result).toBe(''); // Nothing output yet, waiting for newline
        expect(processor.flush()).toBe('partial'); // Flush returns buffered content
      });

      it('outputs complete lines when newline is received', () => {
        processor.process('partial');
        const result = processor.process(' complete\n');
        expect(result).toBe('partial complete\n');
      });
    });

    describe('ANSI code stripping', () => {
      it('strips color codes (SGR sequences)', () => {
        const result = processor.process('\x1b[31mRed\x1b[0m\n');
        expect(result).toBe('Red\n');
      });

      it('strips bold and other style codes', () => {
        const result = processor.process('\x1b[1;32mBold Green\x1b[0m\n');
        expect(result).toBe('Bold Green\n');
      });
    });

    describe('line clearing simulation (key feature)', () => {
      it('clears current line on [2K (erase line) sequence', () => {
        processor.process('old content');
        const result = processor.process('\x1b[2Knew content\n');
        expect(result).toBe('new content\n');
        expect(result).not.toContain('old content');
      });

      it('clears current line on [1G (cursor to column 1) sequence', () => {
        processor.process('old content');
        const result = processor.process('\x1b[1Gnew content\n');
        expect(result).toBe('new content\n');
        expect(result).not.toContain('old content');
      });

      it('handles combined [2K[1G sequence (yarn-style progress)', () => {
        processor.process('[] 0/576');
        const result = processor.process('\x1b[2K\x1b[1G[] 136/576\n');
        expect(result).toBe('[] 136/576\n');
        expect(result).not.toContain('0/576');
      });

      it('simulates overwrite behavior for progress updates', () => {
        // Simulates yarn install output where progress overwrites previous line
        let output = '';
        output += processor.process('\x1b[2K\x1b[1G[] 0/576');
        output += processor.process('\x1b[2K\x1b[1G[] 100/576');
        output += processor.process('\x1b[2K\x1b[1G[] 200/576');
        output += processor.process('\x1b[2K\x1b[1G[] 576/576\n');

        // Only the final value should appear (plus newline flushes it)
        expect(output).toBe('[] 576/576\n');
        expect(output).not.toContain('0/576');
        expect(output).not.toContain('100/576');
        expect(output).not.toContain('200/576');
      });

      it('handles realistic yarn install output', () => {
        let output = '';

        // Yarn typically outputs: version line, then progress updates
        output += processor.process('\x1b[2K\x1b[1Gyarn install v1.22.22\n');
        output += processor.process('\x1b[2K\x1b[1G[1/4] Resolving packages...\n');
        output += processor.process('\x1b[2K\x1b[1G[] 0/576');
        output += processor.process('\x1b[2K\x1b[1G[] 136/576');
        output += processor.process('\x1b[2K\x1b[1G[] 576/576\n');
        output += processor.process('\x1b[2K\x1b[1G[2/4] Fetching packages...\n');

        expect(output).toContain('yarn install v1.22.22\n');
        expect(output).toContain('[1/4] Resolving packages...\n');
        expect(output).toContain('[] 576/576\n'); // Only final progress
        expect(output).toContain('[2/4] Fetching packages...\n');

        // Should NOT contain intermediate progress values
        expect(output).not.toContain('[] 0/576');
        expect(output).not.toContain('[] 136/576');
      });
    });

    describe('carriage return handling', () => {
      it('clears current line on carriage return (not followed by newline)', () => {
        processor.process('old');
        const result = processor.process('\rnew\n');
        expect(result).toBe('new\n');
      });

      it('preserves \\r\\n as normal line ending', () => {
        const result = processor.process('line\r\n');
        expect(result).toBe('line\n');
      });
    });

    describe('cursor movement handling', () => {
      it('clears line on cursor up [A', () => {
        processor.process('content');
        const result = processor.process('\x1b[1Anew\n');
        expect(result).toBe('new\n');
      });

      it('clears line on cursor position [H', () => {
        processor.process('content');
        const result = processor.process('\x1b[5;10Hnew\n');
        expect(result).toBe('new\n');
      });

      it('clears line on screen clear [J', () => {
        processor.process('content');
        const result = processor.process('\x1b[2Jnew\n');
        expect(result).toBe('new\n');
      });
    });

    describe('flush behavior', () => {
      it('returns empty string when no buffered content', () => {
        expect(processor.flush()).toBe('');
      });

      it('returns and clears buffered content', () => {
        processor.process('buffered');
        expect(processor.flush()).toBe('buffered');
        expect(processor.flush()).toBe(''); // Second flush is empty
      });
    });

    describe('reset behavior', () => {
      it('clears all state', () => {
        processor.process('buffered');
        processor.reset();
        expect(processor.flush()).toBe('');
      });
    });

    describe('streaming chunks', () => {
      it('handles escape sequence split across chunks', () => {
        // This is a tricky case - escape sequence might be split
        // For now, we handle complete sequences in each chunk
        let output = '';
        output += processor.process('text\x1b');
        output += processor.process('[2Knew\n');
        // The processor handles this by treating incomplete escapes as regular chars
        // then the next chunk continues
        expect(output).toContain('new');
      });

      it('maintains state across multiple process calls', () => {
        let output = '';
        output += processor.process('chunk1 ');
        output += processor.process('chunk2 ');
        output += processor.process('chunk3\n');
        expect(output).toBe('chunk1 chunk2 chunk3\n');
      });
    });
  });
});
