import { describe, it, expect, vi } from 'vitest';
import { useCommandButtonsStore } from './commandButtons.js';

// Mock the API module
vi.mock('../composables/useApi.js', () => ({
  api: {
    getCommandButtons: vi.fn(),
    createCommandButton: vi.fn(),
    updateCommandButton: vi.fn(),
    deleteCommandButton: vi.fn(),
    runCommandButton: vi.fn(),
    getActiveRuns: vi.fn(),
    killCommandRun: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

describe('CommandButtons Store', () => {

  describe('state', () => {
    it('has correct initial state', () => {
      const store = useCommandButtonsStore();
      expect(store.buttons).toEqual([]);
      expect(store.runs).toEqual({});
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('getters', () => {
    it('getButtonById returns button by id', () => {
      const store = useCommandButtonsStore();
      store.buttons = [
        { id: 'btn-1', label: 'Test 1' },
        { id: 'btn-2', label: 'Test 2' },
      ];

      expect(store.getButtonById('btn-1').label).toBe('Test 1');
      expect(store.getButtonById('btn-2').label).toBe('Test 2');
      expect(store.getButtonById('nonexistent')).toBeUndefined();
    });

    it('getRun returns run by id', () => {
      const store = useCommandButtonsStore();
      store.runs = {
        'run-1': { runId: 'run-1', status: 'running' },
        'run-2': { runId: 'run-2', status: 'success' },
      };

      expect(store.getRun('run-1').status).toBe('running');
      expect(store.getRun('run-2').status).toBe('success');
      expect(store.getRun('nonexistent')).toBeUndefined();
    });

    it('activeRuns returns only running runs', () => {
      const store = useCommandButtonsStore();
      store.runs = {
        'run-1': { runId: 'run-1', status: 'running' },
        'run-2': { runId: 'run-2', status: 'success' },
        'run-3': { runId: 'run-3', status: 'running' },
      };

      const active = store.activeRuns;
      expect(active.length).toBe(2);
      expect(active.every((r) => r.status === 'running')).toBe(true);
    });

    it('getButtonsByProjectId returns buttons for a specific project', () => {
      const store = useCommandButtonsStore();
      store.buttons = [
        { id: 'btn-1', projectId: 'proj-1', label: 'Build' },
        { id: 'btn-2', projectId: 'proj-1', label: 'Test' },
        { id: 'btn-3', projectId: 'proj-2', label: 'Deploy' },
      ];

      const proj1Buttons = store.getButtonsByProjectId('proj-1');
      expect(proj1Buttons.length).toBe(2);
      expect(proj1Buttons.every((b) => b.projectId === 'proj-1')).toBe(true);
    });

    it('getButtonsByProjectId returns empty array when project has no buttons', () => {
      const store = useCommandButtonsStore();
      store.buttons = [
        { id: 'btn-1', projectId: 'proj-1', label: 'Build' },
      ];

      const proj2Buttons = store.getButtonsByProjectId('proj-2');
      expect(proj2Buttons).toEqual([]);
    });

    it('getLatestRunForButton returns most recent run for button in session', () => {
      const store = useCommandButtonsStore();
      const now = Date.now();
      store.runs = {
        'run-1': {
          runId: 'run-1',
          buttonId: 'btn-1',
          sessionId: 'sess-1',
          startedAt: now - 10000,
          status: 'success',
        },
        'run-2': {
          runId: 'run-2',
          buttonId: 'btn-1',
          sessionId: 'sess-1',
          startedAt: now - 5000,
          status: 'success',
        },
        'run-3': {
          runId: 'run-3',
          buttonId: 'btn-1',
          sessionId: 'sess-1',
          startedAt: now,
          status: 'running',
        },
      };

      const latestRun = store.getLatestRunForButton('btn-1', 'sess-1');
      expect(latestRun.runId).toBe('run-3');
      expect(latestRun.startedAt).toBe(now);
    });

    it('getLatestRunForButton returns null when no runs exist for button', () => {
      const store = useCommandButtonsStore();
      store.runs = {
        'run-1': { runId: 'run-1', buttonId: 'btn-2', sessionId: 'sess-1', startedAt: Date.now() },
      };

      const latestRun = store.getLatestRunForButton('btn-1', 'sess-1');
      expect(latestRun).toBeNull();
    });

    it('getLatestRunForButton returns null when button has runs but not in this session', () => {
      const store = useCommandButtonsStore();
      store.runs = {
        'run-1': { runId: 'run-1', buttonId: 'btn-1', sessionId: 'sess-2', startedAt: Date.now() },
      };

      const latestRun = store.getLatestRunForButton('btn-1', 'sess-1');
      expect(latestRun).toBeNull();
    });

    it('getLatestRunForButton correctly filters by sessionId', () => {
      const store = useCommandButtonsStore();
      const now = Date.now();
      store.runs = {
        'run-1': {
          runId: 'run-1',
          buttonId: 'btn-1',
          sessionId: 'sess-1',
          startedAt: now - 5000,
          status: 'success',
        },
        'run-2': {
          runId: 'run-2',
          buttonId: 'btn-1',
          sessionId: 'sess-2',
          startedAt: now,
          status: 'running',
        },
      };

      const latestInSession1 = store.getLatestRunForButton('btn-1', 'sess-1');
      expect(latestInSession1.runId).toBe('run-1');
      expect(latestInSession1.sessionId).toBe('sess-1');

      const latestInSession2 = store.getLatestRunForButton('btn-1', 'sess-2');
      expect(latestInSession2.runId).toBe('run-2');
      expect(latestInSession2.sessionId).toBe('sess-2');
    });
  });

  describe('fetchActiveRuns', () => {
    it('fetches and restores active runs to state', async () => {
      const mockRuns = [
        { runId: 'run-1', buttonId: 'btn-1', status: 'running', output: 'Hello\n' },
        { runId: 'run-2', buttonId: 'btn-2', status: 'running', output: 'World\n' },
      ];
      api.getActiveRuns.mockResolvedValue(mockRuns);

      const store = useCommandButtonsStore();
      const result = await store.fetchActiveRuns('session-123');

      expect(api.getActiveRuns).toHaveBeenCalledWith('session-123');
      expect(result).toEqual(mockRuns);

      // Verify runs were added to state
      expect(Object.keys(store.runs).length).toBe(2);
      expect(store.runs['run-1'].runId).toBe('run-1');
      expect(store.runs['run-1'].buttonId).toBe('btn-1');
      expect(store.runs['run-1'].status).toBe('running');
      expect(store.runs['run-1'].output).toBe('Hello\n');
      expect(store.runs['run-1'].exitCode).toBeNull();
    });

    it('returns empty array and logs error on failure', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      api.getActiveRuns.mockRejectedValue(new Error('Network error'));

      const store = useCommandButtonsStore();
      const result = await store.fetchActiveRuns('session-123');

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(Object.keys(store.runs).length).toBe(0);

      consoleErrorSpy.mockRestore();
    });

    it('does not overwrite existing runs with same id', async () => {
      const store = useCommandButtonsStore();
      // Pre-existing run with more output
      store.runs = {
        'run-1': { runId: 'run-1', buttonId: 'btn-1', status: 'running', output: 'Existing output\n', exitCode: null },
      };

      const mockRuns = [
        { runId: 'run-1', buttonId: 'btn-1', status: 'running', output: 'New output\n' },
      ];
      api.getActiveRuns.mockResolvedValue(mockRuns);

      await store.fetchActiveRuns('session-123');

      // The run should be overwritten with the server's state (which has the buffered output)
      expect(store.runs['run-1'].output).toBe('New output\n');
    });
  });

  describe('runButton', () => {
    it('creates run entry in state and returns runId', async () => {
      api.runCommandButton.mockResolvedValue({ runId: 'run-123', buttonId: 'btn-1', status: 'running', output: '' });

      const store = useCommandButtonsStore();
      const runId = await store.runButton('session-1', 'btn-1');

      expect(runId).toBe('run-123');
      expect(api.runCommandButton).toHaveBeenCalledWith('session-1', 'btn-1');
      expect(store.runs['run-123']).toBeDefined();
      expect(store.runs['run-123'].status).toBe('running');
      expect(store.runs['run-123'].buttonId).toBe('btn-1');
    });

    it('stores sessionId when running button', async () => {
      api.runCommandButton.mockResolvedValue({ runId: 'run-123', buttonId: 'btn-1', status: 'running', output: '' });

      const store = useCommandButtonsStore();
      const runId = await store.runButton('session-1', 'btn-1');

      expect(store.runs['run-123'].sessionId).toBe('session-1');
    });

    it('sets startedAt timestamp when running button', async () => {
      const beforeTime = Date.now();
      api.runCommandButton.mockResolvedValue({ runId: 'run-123', buttonId: 'btn-1', status: 'running', output: '' });

      const store = useCommandButtonsStore();
      const runId = await store.runButton('session-1', 'btn-1');
      const afterTime = Date.now();

      expect(store.runs['run-123'].startedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(store.runs['run-123'].startedAt).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('WebSocket message handlers', () => {
    it('appendOutput adds text to existing run', () => {
      const store = useCommandButtonsStore();
      store.runs = {
        'run-1': { runId: 'run-1', output: 'Hello ' },
      };

      store.appendOutput('run-1', 'World');

      expect(store.runs['run-1'].output).toBe('Hello World');
    });

    it('appendOutput does nothing for non-existent run', () => {
      const store = useCommandButtonsStore();
      store.appendOutput('nonexistent', 'text');
      expect(store.runs['nonexistent']).toBeUndefined();
    });

    it('completeRun updates status and exit code', () => {
      const store = useCommandButtonsStore();
      store.runs = {
        'run-1': { runId: 'run-1', status: 'running', output: 'partial', exitCode: null },
      };

      store.completeRun('run-1', 0, 'full output');

      expect(store.runs['run-1'].status).toBe('success');
      expect(store.runs['run-1'].exitCode).toBe(0);
      expect(store.runs['run-1'].output).toBe('full output');
    });

    it('completeRun sets error status for non-zero exit code', () => {
      const store = useCommandButtonsStore();
      store.runs = {
        'run-1': { runId: 'run-1', status: 'running', output: '', exitCode: null },
      };

      store.completeRun('run-1', 1, 'error output');

      expect(store.runs['run-1'].status).toBe('error');
      expect(store.runs['run-1'].exitCode).toBe(1);
    });

    it('completeRun sets completedAt timestamp', () => {
      const beforeTime = Date.now();
      const store = useCommandButtonsStore();
      store.runs = {
        'run-1': { runId: 'run-1', status: 'running', output: '', exitCode: null },
      };

      store.completeRun('run-1', 0, 'output');
      const afterTime = Date.now();

      expect(store.runs['run-1'].completedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(store.runs['run-1'].completedAt).toBeLessThanOrEqual(afterTime);
    });

    describe('completeRun Race Condition Prevention', () => {
      it('replaces output when server output is larger (more complete)', () => {
        const store = useCommandButtonsStore();
        store.runs = {
          'run-1': { runId: 'run-1', status: 'running', output: 'partial', exitCode: null },
        };

        // Server has more complete output
        store.completeRun('run-1', 0, 'partial\nMore content here');

        expect(store.runs['run-1'].output).toBe('partial\nMore content here');
        expect(store.runs['run-1'].status).toBe('success');
      });

      it('preserves accumulated output when server output is smaller', () => {
        const store = useCommandButtonsStore();
        // Simulate streaming: client accumulated more output than what server sends
        const accumulatedOutput = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n';
        store.runs = {
          'run-1': {
            runId: 'run-1',
            status: 'running',
            output: accumulatedOutput,
            exitCode: null
          },
        };

        // Server completion arrives with less output (incomplete)
        const serverOutput = 'Line 1\nLine 2\nLine';
        store.completeRun('run-1', 0, serverOutput);

        // Should keep the accumulated output, not replace with incomplete server output
        expect(store.runs['run-1'].output).toBe(accumulatedOutput);
        expect(store.runs['run-1'].status).toBe('success');
        expect(store.runs['run-1'].exitCode).toBe(0);
      });

      it('preserves accumulated output when server output equals accumulated', () => {
        const store = useCommandButtonsStore();
        const output = 'Full output\nAll content';
        store.runs = {
          'run-1': {
            runId: 'run-1',
            status: 'running',
            output: output,
            exitCode: null
          },
        };

        // Server completion with same length output
        store.completeRun('run-1', 0, output);

        // Should keep the existing accumulated output
        expect(store.runs['run-1'].output).toBe(output);
        expect(store.runs['run-1'].status).toBe('success');
      });

      it('does not replace output when server output is empty string', () => {
        const store = useCommandButtonsStore();
        const accumulatedOutput = 'Accumulated output from streaming';
        store.runs = {
          'run-1': {
            runId: 'run-1',
            status: 'running',
            output: accumulatedOutput,
            exitCode: null
          },
        };

        // Server sends empty output (shouldn't happen but guard against it)
        store.completeRun('run-1', 0, '');

        // Should keep the accumulated output
        expect(store.runs['run-1'].output).toBe(accumulatedOutput);
        expect(store.runs['run-1'].status).toBe('success');
      });

      it('handles null server output gracefully', () => {
        const store = useCommandButtonsStore();
        const accumulatedOutput = 'Accumulated output';
        store.runs = {
          'run-1': {
            runId: 'run-1',
            status: 'running',
            output: accumulatedOutput,
            exitCode: null
          },
        };

        // Server sends null output
        store.completeRun('run-1', 0, null);

        // Should keep the accumulated output
        expect(store.runs['run-1'].output).toBe(accumulatedOutput);
        expect(store.runs['run-1'].status).toBe('success');
      });

      it('handles race condition: completion arrives before all streaming chunks', () => {
        const store = useCommandButtonsStore();

        // Simulate: run starts, first chunk arrives
        store.runs = {
          'run-1': {
            runId: 'run-1',
            status: 'running',
            output: 'Chunk 1\n',
            exitCode: null
          },
        };

        // More chunks arrive
        store.appendOutput('run-1', 'Chunk 2\n');
        store.appendOutput('run-1', 'Chunk 3\n');

        // But completion arrives with server's view (might be incomplete if buffering)
        const serverOutput = 'Chunk 1\nChunk 2\n'; // Missing chunk 3
        store.completeRun('run-1', 0, serverOutput);

        // Should keep accumulated output with all chunks
        expect(store.runs['run-1'].output).toBe('Chunk 1\nChunk 2\nChunk 3\n');
      });

      it('replaces with server output when server has everything', () => {
        const store = useCommandButtonsStore();

        // Simulate: streaming output
        store.runs = {
          'run-1': {
            runId: 'run-1',
            status: 'running',
            output: 'Chunk 1\nChunk 2\n',
            exitCode: null
          },
        };

        // Server completion with full output
        const fullOutput = 'Chunk 1\nChunk 2\nChunk 3\nChunk 4\nComplete\n';
        store.completeRun('run-1', 0, fullOutput);

        // Should replace with complete server output
        expect(store.runs['run-1'].output).toBe(fullOutput);
      });
    });

    it('errorRun updates status and appends error message', () => {
      const store = useCommandButtonsStore();
      store.runs = {
        'run-1': { runId: 'run-1', status: 'running', output: 'output' },
      };

      store.errorRun('run-1', 'Command failed');

      expect(store.runs['run-1'].status).toBe('error');
      expect(store.runs['run-1'].output).toContain('[Error] Command failed');
    });

    it('clearRun removes run from state', () => {
      const store = useCommandButtonsStore();
      store.runs = {
        'run-1': { runId: 'run-1' },
        'run-2': { runId: 'run-2' },
      };

      store.clearRun('run-1');

      expect(store.runs['run-1']).toBeUndefined();
      expect(store.runs['run-2']).toBeDefined();
    });

    it('clearAllRuns removes all runs', () => {
      const store = useCommandButtonsStore();
      store.runs = {
        'run-1': { runId: 'run-1' },
        'run-2': { runId: 'run-2' },
      };

      store.clearAllRuns();

      expect(Object.keys(store.runs).length).toBe(0);
    });

    it('fetchActiveRuns restores both running and recently completed runs', async () => {
      const store = useCommandButtonsStore();
      const runs = [
        {
          runId: 'run-1',
          buttonId: 'btn-1',
          status: 'running',
          output: 'Running...\n',
          startedAt: Date.now(),
        },
        {
          runId: 'run-2',
          buttonId: 'btn-2',
          status: 'success',
          output: 'Complete\n',
          exitCode: 0,
          startedAt: Date.now() - 5000,
        },
      ];
      api.getActiveRuns.mockResolvedValue(runs);

      const result = await store.fetchActiveRuns('sess-123');

      expect(api.getActiveRuns).toHaveBeenCalledWith('sess-123');
      expect(store.runs['run-1']).toBeDefined();
      expect(store.runs['run-1'].status).toBe('running');
      expect(store.runs['run-2']).toBeDefined();
      expect(store.runs['run-2'].status).toBe('success');
      expect(result).toEqual(runs);
    });

    it('fetchActiveRuns handles recently completed runs with proper status', async () => {
      const store = useCommandButtonsStore();
      const runs = [
        {
          runId: 'run-1',
          buttonId: 'btn-1',
          status: 'success',
          output: 'Success\n',
          exitCode: 0,
          startedAt: Date.now() - 2000,
        },
        {
          runId: 'run-2',
          buttonId: 'btn-2',
          status: 'error',
          output: 'Error occurred\n',
          exitCode: 1,
          startedAt: Date.now() - 3000,
        },
        {
          runId: 'run-3',
          buttonId: 'btn-3',
          status: 'killed',
          output: 'Terminated\n',
          startedAt: Date.now() - 1000,
        },
      ];
      api.getActiveRuns.mockResolvedValue(runs);

      await store.fetchActiveRuns('sess-123');

      expect(store.runs['run-1'].status).toBe('success');
      expect(store.runs['run-2'].status).toBe('error');
      expect(store.runs['run-2'].exitCode).toBe(1);
      expect(store.runs['run-3'].status).toBe('killed');
    });

    it('fetchActiveRuns preserves undefined exitCode for running processes', async () => {
      const store = useCommandButtonsStore();
      const runs = [
        {
          runId: 'run-1',
          buttonId: 'btn-1',
          status: 'running',
          output: 'Running...\n',
          exitCode: undefined,
          startedAt: Date.now(),
        },
      ];
      api.getActiveRuns.mockResolvedValue(runs);

      await store.fetchActiveRuns('sess-123');

      expect(store.runs['run-1'].exitCode).toBeNull();
    });

    it('fetchActiveRuns handles mixed running and completed runs', async () => {
      const store = useCommandButtonsStore();
      const runs = [
        {
          runId: 'run-1',
          buttonId: 'btn-1',
          status: 'running',
          output: 'Processing...\n',
          startedAt: Date.now(),
        },
        {
          runId: 'run-2',
          buttonId: 'btn-2',
          status: 'running',
          output: 'Also processing...\n',
          startedAt: Date.now(),
        },
        {
          runId: 'run-3',
          buttonId: 'btn-1',
          status: 'success',
          output: 'Completed\n',
          exitCode: 0,
          startedAt: Date.now() - 10000,
        },
      ];
      api.getActiveRuns.mockResolvedValue(runs);

      await store.fetchActiveRuns('sess-123');

      const runningRuns = Object.values(store.runs).filter((r) => r.status === 'running');
      const completedRuns = Object.values(store.runs).filter((r) => r.status !== 'running');

      expect(runningRuns.length).toBe(2);
      expect(completedRuns.length).toBe(1);
    });

    it('fetchActiveRuns returns empty array when no runs exist', async () => {
      const store = useCommandButtonsStore();
      api.getActiveRuns.mockResolvedValue([]);

      const result = await store.fetchActiveRuns('sess-123');

      expect(result).toEqual([]);
      expect(Object.keys(store.runs).length).toBe(0);
    });

    it('fetchActiveRuns handles API error gracefully', async () => {
      const store = useCommandButtonsStore();
      const error = new Error('API Error');
      api.getActiveRuns.mockRejectedValue(error);

      const result = await store.fetchActiveRuns('sess-123');

      expect(result).toEqual([]);
      expect(store.error).toBe('Failed to fetch active runs: API Error');
    });

    it('fetchActiveRuns includes startedAt in restored runs', async () => {
      const store = useCommandButtonsStore();
      const startTime = Date.now() - 5000;
      const runs = [
        {
          runId: 'run-1',
          buttonId: 'btn-1',
          status: 'success',
          output: 'Complete\n',
          exitCode: 0,
          startedAt: startTime,
        },
      ];
      api.getActiveRuns.mockResolvedValue(runs);

      await store.fetchActiveRuns('sess-123');

      expect(store.runs['run-1'].startedAt).toBe(startTime);
    });

    it('fetchActiveRuns sets exitCode to null when undefined for running process', async () => {
      const store = useCommandButtonsStore();
      const runs = [
        {
          runId: 'run-1',
          buttonId: 'btn-1',
          status: 'running',
          output: 'Running\n',
          exitCode: undefined,
          startedAt: Date.now(),
        },
      ];
      api.getActiveRuns.mockResolvedValue(runs);

      await store.fetchActiveRuns('sess-123');

      expect(store.runs['run-1'].exitCode).toBeNull();
    });

    it('fetchActiveRuns preserves non-zero exit codes for failed runs', async () => {
      const store = useCommandButtonsStore();
      const runs = [
        {
          runId: 'run-1',
          buttonId: 'btn-1',
          status: 'error',
          output: 'Failed\n',
          exitCode: 127,
          startedAt: Date.now(),
        },
      ];
      api.getActiveRuns.mockResolvedValue(runs);

      await store.fetchActiveRuns('sess-123');

      expect(store.runs['run-1'].exitCode).toBe(127);
    });

    it('fetchActiveRuns stores sessionId for each run', async () => {
      const store = useCommandButtonsStore();
      const runs = [
        {
          runId: 'run-1',
          buttonId: 'btn-1',
          status: 'running',
          output: 'Running...\n',
          startedAt: Date.now(),
        },
      ];
      api.getActiveRuns.mockResolvedValue(runs);

      await store.fetchActiveRuns('sess-123');

      expect(store.runs['run-1'].sessionId).toBe('sess-123');
    });

    it('fetchActiveRuns preserves completedAt for completed runs', async () => {
      const store = useCommandButtonsStore();
      const completedAt = Date.now() - 1000;
      const runs = [
        {
          runId: 'run-1',
          buttonId: 'btn-1',
          status: 'success',
          output: 'Complete\n',
          exitCode: 0,
          startedAt: Date.now() - 5000,
          completedAt: completedAt,
        },
      ];
      api.getActiveRuns.mockResolvedValue(runs);

      await store.fetchActiveRuns('sess-123');

      expect(store.runs['run-1'].completedAt).toBe(completedAt);
    });

    it('fetchActiveRuns omits completedAt for running runs', async () => {
      const store = useCommandButtonsStore();
      const runs = [
        {
          runId: 'run-1',
          buttonId: 'btn-1',
          status: 'running',
          output: 'Running...\n',
          startedAt: Date.now(),
        },
      ];
      api.getActiveRuns.mockResolvedValue(runs);

      await store.fetchActiveRuns('sess-123');

      expect(store.runs['run-1'].completedAt).toBeUndefined();
    });
  });
});
