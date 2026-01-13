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

  describe('fetchButtons', () => {
    it('merges buttons for different projects instead of replacing', async () => {
      const store = useCommandButtonsStore();
      // Setup: store has buttons for project A
      store.buttons = [{ id: 'btn-a', projectId: 'proj-a', label: 'A' }];

      // Mock API to return buttons for project B
      api.getCommandButtons.mockResolvedValue([
        { id: 'btn-b', projectId: 'proj-b', label: 'B' }
      ]);

      await store.fetchButtons('proj-b');

      // Both projects' buttons should exist
      expect(store.buttons).toHaveLength(2);
      expect(store.buttons.find(b => b.projectId === 'proj-a')).toBeTruthy();
      expect(store.buttons.find(b => b.projectId === 'proj-b')).toBeTruthy();
    });

    it('replaces buttons when fetching same project', async () => {
      const store = useCommandButtonsStore();
      // Setup: store has old buttons for project A
      store.buttons = [{ id: 'btn-old', projectId: 'proj-a', label: 'Old' }];

      // Mock API to return new buttons for project A
      api.getCommandButtons.mockResolvedValue([
        { id: 'btn-new', projectId: 'proj-a', label: 'New' }
      ]);

      await store.fetchButtons('proj-a');

      // Only new buttons should exist
      expect(store.buttons).toHaveLength(1);
      expect(store.buttons[0].id).toBe('btn-new');
    });

    it('preserves buttons from multiple projects when fetching one', async () => {
      const store = useCommandButtonsStore();
      // Setup: store has buttons from two projects
      store.buttons = [
        { id: 'btn-a1', projectId: 'proj-a', label: 'A1' },
        { id: 'btn-a2', projectId: 'proj-a', label: 'A2' },
        { id: 'btn-b1', projectId: 'proj-b', label: 'B1' },
      ];

      // Mock API to return updated buttons for project A
      api.getCommandButtons.mockResolvedValue([
        { id: 'btn-a-updated', projectId: 'proj-a', label: 'Updated' }
      ]);

      await store.fetchButtons('proj-a');

      // Should have 2 buttons: 1 from proj-a (updated) and 1 from proj-b (unchanged)
      expect(store.buttons).toHaveLength(2);
      expect(store.buttons.find(b => b.projectId === 'proj-a').id).toBe('btn-a-updated');
      expect(store.buttons.find(b => b.projectId === 'proj-b').id).toBe('btn-b1');
    });

    it('sets loading state during fetch', async () => {
      const store = useCommandButtonsStore();
      api.getCommandButtons.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve([]), 50))
      );

      const fetchPromise = store.fetchButtons('proj-1');
      expect(store.loading).toBe(true);

      await fetchPromise;
      expect(store.loading).toBe(false);
    });

    it('clears error state on successful fetch', async () => {
      const store = useCommandButtonsStore();
      store.error = 'Previous error';

      api.getCommandButtons.mockResolvedValue([
        { id: 'btn-1', projectId: 'proj-1', label: 'Test' }
      ]);

      await store.fetchButtons('proj-1');
      expect(store.error).toBeNull();
    });

    it('sets error state on API failure', async () => {
      const store = useCommandButtonsStore();
      const errorMessage = 'Failed to fetch buttons';
      api.getCommandButtons.mockRejectedValue(new Error(errorMessage));

      await store.fetchButtons('proj-1');
      expect(store.error).toBe(errorMessage);
      expect(store.loading).toBe(false);
    });

    it('handles empty button list from API', async () => {
      const store = useCommandButtonsStore();
      store.buttons = [{ id: 'btn-1', projectId: 'proj-a', label: 'A' }];

      api.getCommandButtons.mockResolvedValue([]);

      await store.fetchButtons('proj-b');

      // proj-a button remains, proj-b has no buttons
      expect(store.buttons).toHaveLength(1);
      expect(store.buttons[0].projectId).toBe('proj-a');
    });

    it('correctly filters out all buttons from target project before adding new ones', async () => {
      const store = useCommandButtonsStore();
      // Setup with multiple buttons from proj-a
      store.buttons = [
        { id: 'btn-a1', projectId: 'proj-a', label: 'A1' },
        { id: 'btn-b1', projectId: 'proj-b', label: 'B1' },
        { id: 'btn-a2', projectId: 'proj-a', label: 'A2' },
      ];

      // Mock API to return single button for proj-a
      api.getCommandButtons.mockResolvedValue([
        { id: 'btn-a-new', projectId: 'proj-a', label: 'New' }
      ]);

      await store.fetchButtons('proj-a');

      // Should have 2 buttons: proj-b unchanged, proj-a replaced with single new button
      expect(store.buttons).toHaveLength(2);
      const projAButtons = store.buttons.filter(b => b.projectId === 'proj-a');
      const projBButtons = store.buttons.filter(b => b.projectId === 'proj-b');

      expect(projAButtons).toHaveLength(1);
      expect(projAButtons[0].id).toBe('btn-a-new');
      expect(projBButtons).toHaveLength(1);
      expect(projBButtons[0].id).toBe('btn-b1');
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
    it('creates run entry in state using server runId', async () => {
      api.runCommandButton.mockResolvedValue({ runId: 'server-run-123', buttonId: 'btn-1', status: 'running', output: '' });

      const store = useCommandButtonsStore();
      const runId = await store.runButton('session-1', 'btn-1');

      // runId should come from the API response (server-generated)
      expect(runId).toBe('server-run-123');
      expect(api.runCommandButton).toHaveBeenCalledWith('session-1', 'btn-1');
      expect(store.runs[runId]).toBeDefined();
      expect(store.runs[runId].status).toBe('running');
      expect(store.runs[runId].buttonId).toBe('btn-1');
    });

    it('stores sessionId when running button', async () => {
      api.runCommandButton.mockResolvedValue({ runId: 'server-run-123', buttonId: 'btn-1', status: 'running', output: '' });

      const store = useCommandButtonsStore();
      const runId = await store.runButton('session-1', 'btn-1');

      expect(store.runs[runId].sessionId).toBe('session-1');
    });

    it('sets startedAt timestamp when running button', async () => {
      const beforeTime = Date.now();
      api.runCommandButton.mockResolvedValue({ runId: 'server-run-123', buttonId: 'btn-1', status: 'running', output: '' });

      const store = useCommandButtonsStore();
      const runId = await store.runButton('session-1', 'btn-1');
      const afterTime = Date.now();

      expect(store.runs[runId].startedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(store.runs[runId].startedAt).toBeLessThanOrEqual(afterTime);
    });

    it('waits for API response before creating run', async () => {
      // This test verifies that we wait for the API to get the server's runId
      // so that WebSocket messages can find the run
      let apiResolved = false;
      api.runCommandButton.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            apiResolved = true;
            resolve({ runId: 'server-run-123', buttonId: 'btn-1', status: 'running', output: '' });
          }, 50);
        });
      });

      const store = useCommandButtonsStore();

      // Start the call
      const runIdPromise = store.runButton('session-1', 'btn-1');

      // Run should NOT be in state yet (waiting for API)
      expect(Object.keys(store.runs).length).toBe(0);
      expect(apiResolved).toBe(false);

      // Wait for API and runButton to complete
      const runId = await runIdPromise;

      // Now the run should exist with the server's runId
      expect(apiResolved).toBe(true);
      expect(runId).toBe('server-run-123');
      expect(store.runs[runId]).toBeDefined();
      expect(store.runs[runId].status).toBe('running');
    });

    it('API failure throws error and sets store error', async () => {
      const apiError = new Error('Connection timeout');
      api.runCommandButton.mockRejectedValue(apiError);

      const store = useCommandButtonsStore();

      // runButton should throw when API fails
      await expect(store.runButton('session-1', 'btn-1')).rejects.toThrow('Connection timeout');

      // Store error state should be set
      expect(store.error).toBe(apiError.message);

      // No run should be created in state
      expect(Object.keys(store.runs).length).toBe(0);
    });

    it('uses server-provided runId for WebSocket compatibility', async () => {
      // This is the key fix: using server's runId ensures WebSocket messages work
      api.runCommandButton.mockResolvedValue({
        runId: 'server-generated-id',
        buttonId: 'btn-1',
        status: 'running',
        output: 'initial output',
      });

      const store = useCommandButtonsStore();
      const runId = await store.runButton('session-1', 'btn-1');

      // The returned runId should be the server's
      expect(runId).toBe('server-generated-id');

      // Run should be in store with server's ID
      expect(store.runs['server-generated-id']).toBeDefined();
      expect(store.runs['server-generated-id'].output).toBe('initial output');

      // WebSocket messages will use the same ID, so appendOutput should work
      store.appendOutput('server-generated-id', '\nmore output');
      store.flushPendingOutput('server-generated-id'); // Flush throttled output
      expect(store.runs['server-generated-id'].output).toBe('initial output\nmore output');
    });
  });

  describe('WebSocket message handlers', () => {
    describe('appendOutput Reactivity ($patch)', () => {
      it('appendOutput should update output reactively using $patch', () => {
        const store = useCommandButtonsStore();
        const runId = 'test-run-1';

        // Create a run
        store.runs = {
          [runId]: {
            runId,
            buttonId: 'btn-1',
            status: 'running',
            output: 'Initial ',
            exitCode: null,
            outputTruncated: false,
          },
        };

        // Track if $patch was called
        const patchSpy = vi.spyOn(store, '$patch');

        // Append output (throttled - buffers until flush)
        store.appendOutput(runId, 'Hello ');
        store.appendOutput(runId, 'World');
        store.flushPendingOutput(runId); // Flush to trigger $patch

        // Verify $patch was called once for the batched flush
        expect(patchSpy).toHaveBeenCalledTimes(1);

        // Verify output was appended correctly
        expect(store.runs[runId].output).toBe('Initial Hello World');

        patchSpy.mockRestore();
      });

      it('appendOutput does nothing for non-existent run', () => {
        const store = useCommandButtonsStore();
        store.appendOutput('nonexistent', 'text');
        expect(store.runs['nonexistent']).toBeUndefined();
      });
    });

    describe('completeRun Reactivity ($patch)', () => {
      it('completeRun should update status and exitCode reactively using $patch', () => {
        const store = useCommandButtonsStore();
        const runId = 'test-run-2';

        // Create a run
        store.runs = {
          [runId]: {
            runId,
            buttonId: 'btn-1',
            status: 'running',
            output: 'Command executed successfully',
            exitCode: null,
          },
        };

        // Track if $patch was called
        const patchSpy = vi.spyOn(store, '$patch');

        // Complete run with success
        store.completeRun(runId, 0, 'Command executed successfully');

        // Verify $patch was called
        expect(patchSpy).toHaveBeenCalled();

        // Verify run was updated correctly
        expect(store.runs[runId].exitCode).toBe(0);
        expect(store.runs[runId].status).toBe('success');
        expect(store.runs[runId].completedAt).toBeGreaterThan(0);

        patchSpy.mockRestore();
      });
    });

    describe('errorRun Reactivity ($patch)', () => {
      it('errorRun should update status reactively using $patch', () => {
        const store = useCommandButtonsStore();
        const runId = 'test-run-3';

        // Create a run
        store.runs = {
          [runId]: {
            runId,
            buttonId: 'btn-1',
            status: 'running',
            output: 'Initial output',
          },
        };

        // Track if $patch was called
        const patchSpy = vi.spyOn(store, '$patch');

        // Report error
        store.errorRun(runId, 'Command failed');

        // Verify $patch was called
        expect(patchSpy).toHaveBeenCalled();

        // Verify run was updated correctly
        expect(store.runs[runId].status).toBe('error');
        expect(store.runs[runId].output).toContain('[Error] Command failed');

        patchSpy.mockRestore();
      });
    });

    it('appendOutput adds text to existing run', () => {
      const store = useCommandButtonsStore();
      store.runs = {
        'run-1': { runId: 'run-1', output: 'Hello ', outputTruncated: false },
      };

      store.appendOutput('run-1', 'World');
      store.flushPendingOutput('run-1'); // Flush throttled output

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

  describe('killRun', () => {
    it('calls killCommandRun API with correct parameters', async () => {
      const store = useCommandButtonsStore();
      api.killCommandRun.mockResolvedValue({});

      await store.killRun('session-123', 'run-456');

      expect(api.killCommandRun).toHaveBeenCalledWith('session-123', 'run-456');
      expect(api.killCommandRun).toHaveBeenCalledTimes(1);
    });

    it('sets error on API failure', async () => {
      const store = useCommandButtonsStore();
      const error = new Error('Kill failed: process not found');
      api.killCommandRun.mockRejectedValue(error);

      try {
        await store.killRun('session-123', 'run-456');
      } catch (e) {
        // Expected to throw
      }

      expect(store.error).toBe('Kill failed: process not found');
    });

    it('throws error on API failure', async () => {
      const store = useCommandButtonsStore();
      const error = new Error('Process already dead');
      api.killCommandRun.mockRejectedValue(error);

      await expect(store.killRun('session-123', 'run-456')).rejects.toThrow('Process already dead');
    });

    it('updates run status to error when process is already dead', async () => {
      const store = useCommandButtonsStore();
      const runId = 'run-456';

      // Pre-populate store with a running command
      store.runs = {
        [runId]: {
          runId,
          buttonId: 'btn-1',
          sessionId: 'session-123',
          status: 'running',
          output: 'Still running\n',
          exitCode: null,
        },
      };

      // API call fails because process is already dead
      api.killCommandRun.mockRejectedValue(new Error('Run not found or already completed'));

      try {
        await store.killRun('session-123', runId);
      } catch (e) {
        // Expected to throw
      }

      // Run status should be updated to error so UI can show Run button again
      expect(store.runs[runId].status).toBe('error');
      expect(store.runs[runId].exitCode).toBe(-1);
    });

    it('does not update status if run is not in state', async () => {
      const store = useCommandButtonsStore();
      api.killCommandRun.mockRejectedValue(new Error('Process already dead'));

      try {
        await store.killRun('session-123', 'nonexistent-run');
      } catch (e) {
        // Expected to throw
      }

      // Store should still set error
      expect(store.error).toBe('Process already dead');

      // But no run should be created
      expect(Object.keys(store.runs).length).toBe(0);
    });

    it('does not update status if run is not in running state', async () => {
      const store = useCommandButtonsStore();
      const runId = 'run-456';

      // Pre-populate with a completed run
      store.runs = {
        [runId]: {
          runId,
          buttonId: 'btn-1',
          sessionId: 'session-123',
          status: 'success',
          output: 'Command completed\n',
          exitCode: 0,
        },
      };

      api.killCommandRun.mockRejectedValue(new Error('Process already dead'));

      try {
        await store.killRun('session-123', runId);
      } catch (e) {
        // Expected to throw
      }

      // Run status should remain success (not changed)
      expect(store.runs[runId].status).toBe('success');
      expect(store.runs[runId].exitCode).toBe(0);
    });

    it('succeeds silently when kill is successful', async () => {
      const store = useCommandButtonsStore();
      const runId = 'run-456';

      store.runs = {
        [runId]: {
          runId,
          buttonId: 'btn-1',
          sessionId: 'session-123',
          status: 'running',
          output: 'Running\n',
          exitCode: null,
        },
      };

      api.killCommandRun.mockResolvedValue({});

      // Should not throw
      await store.killRun('session-123', runId);

      // Run status should remain running (will be updated by server response)
      expect(store.runs[runId].status).toBe('running');
      expect(store.error).toBeNull();
    });
  });
});
