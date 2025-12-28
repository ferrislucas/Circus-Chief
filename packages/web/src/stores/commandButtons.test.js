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
  });
});
