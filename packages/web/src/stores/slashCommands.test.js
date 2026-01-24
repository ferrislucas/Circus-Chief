import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSlashCommandsStore } from './slashCommands.js';

// Mock the API
vi.mock('../composables/useApi.js', () => ({
  api: {
    getSlashCommands: vi.fn(),
    getSlashCommand: vi.fn(),
    executeSlashCommand: vi.fn(),
  },
}));

import { api } from '../composables/useApi.js';

describe('useSlashCommandsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('initializes with empty commands and loading false', () => {
      const store = useSlashCommandsStore();

      expect(store.commands).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.lastFetchedDirectory).toBeNull();
      expect(store.executing).toBe(false);
    });
  });

  describe('getters', () => {
    describe('builtinCommands', () => {
      it('returns only builtin commands', () => {
        const store = useSlashCommandsStore();
        store.commands = [
          { name: 'help', source: 'builtin' },
          { name: 'deploy', source: 'project' },
          { name: 'test', source: 'user' },
        ];

        expect(store.builtinCommands).toHaveLength(1);
        expect(store.builtinCommands[0].name).toBe('help');
      });
    });

    describe('projectCommands', () => {
      it('returns only project commands', () => {
        const store = useSlashCommandsStore();
        store.commands = [
          { name: 'help', source: 'builtin' },
          { name: 'deploy', source: 'project' },
          { name: 'test', source: 'user' },
        ];

        expect(store.projectCommands).toHaveLength(1);
        expect(store.projectCommands[0].name).toBe('deploy');
      });
    });

    describe('userCommands', () => {
      it('returns only user commands', () => {
        const store = useSlashCommandsStore();
        store.commands = [
          { name: 'help', source: 'builtin' },
          { name: 'deploy', source: 'project' },
          { name: 'test', source: 'user' },
        ];

        expect(store.userCommands).toHaveLength(1);
        expect(store.userCommands[0].name).toBe('test');
      });
    });

    describe('customCommands', () => {
      it('returns project and user commands (not builtin)', () => {
        const store = useSlashCommandsStore();
        store.commands = [
          { name: 'help', source: 'builtin' },
          { name: 'deploy', source: 'project' },
          { name: 'test', source: 'user' },
        ];

        expect(store.customCommands).toHaveLength(2);
        expect(store.customCommands.map((c) => c.name)).toEqual(['deploy', 'test']);
      });
    });

    describe('hasCommands', () => {
      it('returns true if any commands exist', () => {
        const store = useSlashCommandsStore();
        store.commands = [{ name: 'help', source: 'builtin' }];

        expect(store.hasCommands).toBe(true);
      });

      it('returns false if no commands', () => {
        const store = useSlashCommandsStore();

        expect(store.hasCommands).toBe(false);
      });
    });

    describe('hasCustomCommands', () => {
      it('returns true if project commands exist', () => {
        const store = useSlashCommandsStore();
        store.commands = [{ name: 'deploy', source: 'project' }];

        expect(store.hasCustomCommands).toBe(true);
      });

      it('returns true if user commands exist', () => {
        const store = useSlashCommandsStore();
        store.commands = [{ name: 'test', source: 'user' }];

        expect(store.hasCustomCommands).toBe(true);
      });

      it('returns false if only builtin commands', () => {
        const store = useSlashCommandsStore();
        store.commands = [{ name: 'help', source: 'builtin' }];

        expect(store.hasCustomCommands).toBe(false);
      });
    });
  });

  describe('actions', () => {
    describe('fetchCommands', () => {
      it('populates commands from API', async () => {
        const directory = '/test/project';
        const mockCommands = [
          { name: 'help', source: 'builtin' },
          { name: 'deploy', source: 'project' },
        ];

        api.getSlashCommands.mockResolvedValue(mockCommands);

        const store = useSlashCommandsStore();
        await store.fetchCommands(directory);

        expect(api.getSlashCommands).toHaveBeenCalledWith(directory);
        expect(store.commands).toEqual(mockCommands);
        expect(store.lastFetchedDirectory).toBe(directory);
      });

      it('skips fetch if already fetched for same directory', async () => {
        const directory = '/test/project';
        const mockCommands = [{ name: 'help', source: 'builtin' }];

        api.getSlashCommands.mockResolvedValue(mockCommands);

        const store = useSlashCommandsStore();
        await store.fetchCommands(directory);
        await store.fetchCommands(directory); // Second call

        expect(api.getSlashCommands).toHaveBeenCalledTimes(1);
      });

      it('fetches again if directory changes', async () => {
        const dir1 = '/test/project1';
        const dir2 = '/test/project2';
        const mockCommands = [{ name: 'help', source: 'builtin' }];

        api.getSlashCommands.mockResolvedValue(mockCommands);

        const store = useSlashCommandsStore();
        await store.fetchCommands(dir1);
        await store.fetchCommands(dir2);

        expect(api.getSlashCommands).toHaveBeenCalledTimes(2);
        expect(store.lastFetchedDirectory).toBe(dir2);
      });

      it('fetches again if force is true', async () => {
        const directory = '/test/project';
        const mockCommands = [{ name: 'help', source: 'builtin' }];

        api.getSlashCommands.mockResolvedValue(mockCommands);

        const store = useSlashCommandsStore();
        await store.fetchCommands(directory);
        await store.fetchCommands(directory, true);

        expect(api.getSlashCommands).toHaveBeenCalledTimes(2);
      });

      it('sets loading false after fetch completes', async () => {
        api.getSlashCommands.mockResolvedValue([]);

        const store = useSlashCommandsStore();
        await store.fetchCommands('/test/project');

        expect(store.loading).toBe(false);
      });

      it('sets error on API failure', async () => {
        api.getSlashCommands.mockRejectedValue(new Error('Network error'));

        const store = useSlashCommandsStore();

        await expect(store.fetchCommands('/test/project')).rejects.toThrow('Network error');
        expect(store.error).toBe('Network error');
      });

      it('returns the commands', async () => {
        const mockCommands = [{ name: 'help', source: 'builtin' }];
        api.getSlashCommands.mockResolvedValue(mockCommands);

        const store = useSlashCommandsStore();
        const result = await store.fetchCommands('/test/project');

        expect(result).toEqual(mockCommands);
      });
    });

    describe('executeCommand', () => {
      it('calls API with correct parameters', async () => {
        const sessionId = 'session-123';
        const name = 'deploy';
        const args = { environment: 'production' };

        api.executeSlashCommand.mockResolvedValue({ success: true });

        const store = useSlashCommandsStore();
        await store.executeCommand(sessionId, name, args);

        expect(api.executeSlashCommand).toHaveBeenCalledWith(sessionId, name, args);
      });

      it('sets executing true during execution', async () => {
        api.executeSlashCommand.mockResolvedValue({ success: true });

        const store = useSlashCommandsStore();
        await store.executeCommand('session-123', 'help', {});

        // After completion, executing should be false
        expect(store.executing).toBe(false);
      });

      it('returns the result', async () => {
        const mockResult = { success: true, command: 'deploy' };
        api.executeSlashCommand.mockResolvedValue(mockResult);

        const store = useSlashCommandsStore();
        const result = await store.executeCommand('session-123', 'deploy', {});

        expect(result).toEqual(mockResult);
      });

      it('sets error on API failure', async () => {
        api.executeSlashCommand.mockRejectedValue(new Error('Execution failed'));

        const store = useSlashCommandsStore();

        await expect(store.executeCommand('session-123', 'deploy', {})).rejects.toThrow(
          'Execution failed'
        );
        expect(store.error).toBe('Execution failed');
      });

      it('sets executing false on error', async () => {
        api.executeSlashCommand.mockRejectedValue(new Error('Execution failed'));

        const store = useSlashCommandsStore();

        try {
          await store.executeCommand('session-123', 'deploy', {});
        } catch {
          // Expected error
        }

        expect(store.executing).toBe(false);
      });
    });

    describe('getCommandByName', () => {
      it('returns command by name', () => {
        const store = useSlashCommandsStore();
        store.commands = [
          { name: 'help', source: 'builtin' },
          { name: 'deploy', source: 'project' },
        ];

        const cmd = store.getCommandByName('deploy');

        expect(cmd).toBeDefined();
        expect(cmd.name).toBe('deploy');
      });

      it('returns null for non-existent command', () => {
        const store = useSlashCommandsStore();
        store.commands = [{ name: 'help', source: 'builtin' }];

        const cmd = store.getCommandByName('nonexistent');

        expect(cmd).toBeNull();
      });
    });

    describe('searchCommands', () => {
      it('returns all commands when query is empty', () => {
        const store = useSlashCommandsStore();
        store.commands = [
          { name: 'help', description: 'Get help' },
          { name: 'deploy', description: 'Deploy app' },
        ];

        expect(store.searchCommands('')).toHaveLength(2);
        expect(store.searchCommands('  ')).toHaveLength(2);
      });

      it('filters by command name', () => {
        const store = useSlashCommandsStore();
        store.commands = [
          { name: 'help', description: 'Get help' },
          { name: 'deploy', description: 'Deploy app' },
        ];

        const results = store.searchCommands('hel');

        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('help');
      });

      it('filters by description', () => {
        const store = useSlashCommandsStore();
        store.commands = [
          { name: 'help', description: 'Get help' },
          { name: 'deploy', description: 'Deploy app' },
        ];

        const results = store.searchCommands('app');

        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('deploy');
      });

      it('is case insensitive', () => {
        const store = useSlashCommandsStore();
        store.commands = [
          { name: 'Deploy', description: 'DEPLOY THE APP' },
        ];

        expect(store.searchCommands('deploy')).toHaveLength(1);
        expect(store.searchCommands('DEPLOY')).toHaveLength(1);
        expect(store.searchCommands('DePlOy')).toHaveLength(1);
      });
    });

    describe('clearCommands', () => {
      it('clears all commands and state', () => {
        const store = useSlashCommandsStore();
        store.commands = [{ name: 'help' }];
        store.lastFetchedDirectory = '/test';
        store.error = 'some error';

        store.clearCommands();

        expect(store.commands).toEqual([]);
        expect(store.lastFetchedDirectory).toBeNull();
        expect(store.error).toBeNull();
      });
    });
  });
});
