import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { useSlashCommands } from './useSlashCommands.js';

// Mock the API module
vi.mock('../api/index.js', () => ({
  api: {
    getCommands: vi.fn(),
  },
}));

import { api } from '../api/index.js';

describe('useSlashCommands', () => {
  let workingDirectory;

  const mockCommands = [
    { name: 'help', source: 'builtin', description: 'Display help information' },
    { name: 'clear', source: 'builtin', description: 'Clear conversation' },
    { name: 'deploy', source: 'project', description: 'Deploy to production' },
    { name: 'test', source: 'user', description: 'Run tests' },
  ];

  beforeEach(() => {
    workingDirectory = ref('/path/to/project');
    vi.clearAllMocks();
    api.getCommands.mockResolvedValue({ commands: mockCommands });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('initialization', () => {
    it('fetches commands when workingDirectory has a value', async () => {
      const { commands } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      expect(api.getCommands).toHaveBeenCalledWith('/path/to/project');
      expect(commands.value).toEqual(mockCommands);
    });

    it('does not fetch when workingDirectory is empty', async () => {
      workingDirectory.value = '';
      const { commands } = useSlashCommands(workingDirectory);

      await nextTick();

      expect(api.getCommands).not.toHaveBeenCalled();
      expect(commands.value).toEqual([]);
    });

    it('initializes with default values', () => {
      workingDirectory.value = '';
      const result = useSlashCommands(workingDirectory);

      expect(result.commands.value).toEqual([]);
      expect(result.filter.value).toBe('');
      expect(result.selectedIndex.value).toBe(0);
      expect(result.loading.value).toBe(false);
      expect(result.error.value).toBeNull();
    });
  });

  describe('filteredCommands', () => {
    it('returns all commands when filter is empty', async () => {
      const { filteredCommands } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      expect(filteredCommands.value).toEqual(mockCommands);
    });

    it('filters commands by name', async () => {
      const { filteredCommands, setFilter } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      setFilter('hel');
      await nextTick();

      expect(filteredCommands.value).toHaveLength(1);
      expect(filteredCommands.value[0].name).toBe('help');
    });

    it('filters commands by description', async () => {
      const { filteredCommands, setFilter } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      setFilter('production');
      await nextTick();

      expect(filteredCommands.value).toHaveLength(1);
      expect(filteredCommands.value[0].name).toBe('deploy');
    });

    it('filter is case insensitive', async () => {
      const { filteredCommands, setFilter } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      setFilter('HELP');
      await nextTick();

      expect(filteredCommands.value).toHaveLength(1);
      expect(filteredCommands.value[0].name).toBe('help');
    });

    it('returns empty array when no commands match', async () => {
      const { filteredCommands, setFilter } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      setFilter('nonexistent');
      await nextTick();

      expect(filteredCommands.value).toHaveLength(0);
    });

    it('handles commands without description', async () => {
      api.getCommands.mockResolvedValue({
        commands: [{ name: 'nodesc', source: 'project' }],
      });

      const { filteredCommands, setFilter } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      // Should not throw when filtering
      setFilter('nod');
      await nextTick();

      expect(filteredCommands.value).toHaveLength(1);
    });
  });

  describe('selectedCommand', () => {
    it('returns the command at selectedIndex', async () => {
      const { selectedCommand, selectedIndex } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      expect(selectedCommand.value).toEqual(mockCommands[0]);

      selectedIndex.value = 2;
      await nextTick();

      expect(selectedCommand.value).toEqual(mockCommands[2]);
    });

    it('returns null when no commands', async () => {
      api.getCommands.mockResolvedValue({ commands: [] });
      const { selectedCommand } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      expect(selectedCommand.value).toBeNull();
    });

    it('returns null when selectedIndex is out of bounds', async () => {
      const { selectedCommand, selectedIndex } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      selectedIndex.value = 100;
      await nextTick();

      expect(selectedCommand.value).toBeNull();
    });
  });

  describe('navigation', () => {
    it('moveDown increments selectedIndex', async () => {
      const { selectedIndex, moveDown } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      expect(selectedIndex.value).toBe(0);

      moveDown();
      expect(selectedIndex.value).toBe(1);

      moveDown();
      expect(selectedIndex.value).toBe(2);
    });

    it('moveDown stops at last item', async () => {
      const { selectedIndex, moveDown } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      // Move to last item (index 3 for 4 items)
      moveDown();
      moveDown();
      moveDown();
      expect(selectedIndex.value).toBe(3);

      // Try to go past last
      moveDown();
      expect(selectedIndex.value).toBe(3);
    });

    it('moveUp decrements selectedIndex', async () => {
      const { selectedIndex, moveDown, moveUp } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      moveDown();
      moveDown();
      expect(selectedIndex.value).toBe(2);

      moveUp();
      expect(selectedIndex.value).toBe(1);
    });

    it('moveUp stops at first item', async () => {
      const { selectedIndex, moveUp } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      expect(selectedIndex.value).toBe(0);

      moveUp();
      expect(selectedIndex.value).toBe(0);
    });

    it('navigation respects filtered list', async () => {
      const { selectedIndex, setFilter, moveDown, filteredCommands } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      // Filter to 2 items (help, clear both have 'l' or 'clear' description mentions 'Clear')
      setFilter('cl');
      await nextTick();

      expect(filteredCommands.value).toHaveLength(1); // just 'clear'

      moveDown();
      expect(selectedIndex.value).toBe(0); // Can't go past single item
    });
  });

  describe('setFilter', () => {
    it('updates filter value', async () => {
      const { filter, setFilter } = useSlashCommands(workingDirectory);

      setFilter('test');
      expect(filter.value).toBe('test');

      setFilter('another');
      expect(filter.value).toBe('another');
    });
  });

  describe('reset', () => {
    it('resets filter to empty string', async () => {
      const { filter, setFilter, reset } = useSlashCommands(workingDirectory);

      setFilter('test');
      expect(filter.value).toBe('test');

      reset();
      expect(filter.value).toBe('');
    });

    it('resets selectedIndex to 0', async () => {
      const { selectedIndex, moveDown, reset } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      moveDown();
      moveDown();
      expect(selectedIndex.value).toBe(2);

      reset();
      expect(selectedIndex.value).toBe(0);
    });

    it('resets error to null', async () => {
      api.getCommands.mockRejectedValue(new Error('API Error'));
      const { error, reset } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(error.value).toBe('API Error'));

      reset();
      expect(error.value).toBeNull();
    });
  });

  describe('watch behavior', () => {
    it('resets selectedIndex when filter changes', async () => {
      const { selectedIndex, moveDown, setFilter } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalled());

      moveDown();
      moveDown();
      expect(selectedIndex.value).toBe(2);

      setFilter('test');
      await nextTick();

      expect(selectedIndex.value).toBe(0);
    });

    it('fetches commands when workingDirectory changes', async () => {
      const { commands } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalledTimes(1));

      // Change working directory
      api.getCommands.mockResolvedValue({
        commands: [{ name: 'new-command', source: 'project' }],
      });
      workingDirectory.value = '/new/path';

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalledTimes(2));

      expect(api.getCommands).toHaveBeenLastCalledWith('/new/path');
      expect(commands.value).toEqual([{ name: 'new-command', source: 'project' }]);
    });

    it('does not fetch when workingDirectory becomes empty', async () => {
      useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalledTimes(1));

      workingDirectory.value = '';
      await nextTick();

      // Should not call again
      expect(api.getCommands).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('sets error on API failure', async () => {
      api.getCommands.mockRejectedValue(new Error('Network error'));

      const { error, commands } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(error.value).toBe('Network error'));

      expect(commands.value).toEqual([]);
    });

    it('sets loading state during fetch', async () => {
      let resolvePromise;
      api.getCommands.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const { loading } = useSlashCommands(workingDirectory);

      await nextTick();
      expect(loading.value).toBe(true);

      resolvePromise({ commands: mockCommands });
      await nextTick();

      expect(loading.value).toBe(false);
    });

    it('clears error on successful fetch after failure', async () => {
      api.getCommands.mockRejectedValueOnce(new Error('First error'));
      api.getCommands.mockResolvedValueOnce({ commands: mockCommands });

      const { error, fetchCommands } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(error.value).toBe('First error'));

      await fetchCommands();

      expect(error.value).toBeNull();
    });
  });

  describe('fetchCommands', () => {
    it('can be called manually to refresh', async () => {
      const { commands, fetchCommands } = useSlashCommands(workingDirectory);

      await nextTick();
      await vi.waitFor(() => expect(api.getCommands).toHaveBeenCalledTimes(1));

      api.getCommands.mockResolvedValue({
        commands: [{ name: 'refreshed', source: 'project' }],
      });

      await fetchCommands();

      expect(api.getCommands).toHaveBeenCalledTimes(2);
      expect(commands.value).toEqual([{ name: 'refreshed', source: 'project' }]);
    });

    it('does nothing when workingDirectory is empty', async () => {
      workingDirectory.value = '';
      const { fetchCommands } = useSlashCommands(workingDirectory);

      await fetchCommands();

      expect(api.getCommands).not.toHaveBeenCalled();
    });
  });
});
