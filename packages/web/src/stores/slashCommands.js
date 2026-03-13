import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useSlashCommandsStore = defineStore('slashCommands', {
  state: () => ({
    commands: [],
    loading: false,
    error: null,
    lastFetchedDirectory: null,
    executing: false,
  }),

  getters: {
    /**
     * Get built-in commands only
     */
    builtinCommands: (state) => state.commands.filter((c) => c.source === 'builtin'),

    /**
     * Get project commands only
     */
    projectCommands: (state) => state.commands.filter((c) => c.source === 'project'),

    /**
     * Get user commands only
     */
    userCommands: (state) => state.commands.filter((c) => c.source === 'user'),

    /**
     * Get plugin commands only
     */
    pluginCommands: (state) => state.commands.filter((c) => c.source === 'plugin'),

    /**
     * Get custom commands only (project + user)
     */
    customCommands: (state) => state.commands.filter((c) => c.source !== 'builtin'),

    /**
     * Get project skills only
     */
    projectSkills: (state) => state.commands.filter((c) => c.source === 'project-skill'),

    /**
     * Get user skills only
     */
    userSkills: (state) => state.commands.filter((c) => c.source === 'user-skill'),

    /**
     * Get plugin skills only
     */
    pluginSkills: (state) => state.commands.filter((c) => c.source === 'plugin-skill'),

    /**
     * Get all skills regardless of source
     */
    allSkills: (state) => state.commands.filter((c) => c.isSkill === true),

    /**
     * Check if any skills exist
     */
    hasSkills: (state) => state.commands.some((c) => c.isSkill === true),

    /**
     * Get all project items (commands + skills)
     */
    allProjectItems: (state) =>
      state.commands.filter((c) => c.source === 'project' || c.source === 'project-skill'),

    /**
     * Get all user items (commands + skills)
     */
    allUserItems: (state) =>
      state.commands.filter((c) => c.source === 'user' || c.source === 'user-skill'),

    /**
     * Check if any commands are available
     */
    hasCommands: (state) => state.commands.length > 0,

    /**
     * Check if any custom commands are available
     */
    hasCustomCommands: (state) =>
      state.commands.some((c) => c.source === 'project' || c.source === 'user'),
  },

  actions: {
    /**
     * Fetch commands from a session's stored slashCommands field
     * This is the fast path for ConversationTab - commands are cached in the session record
     * from the SDK init event
     * @param {string} sessionId - Session ID to fetch commands from
     * @returns {Promise<Array>}
     */
    async fetchCommandsFromSession(sessionId) {
      this.loading = true;
      this.error = null;

      try {
        const session = await api.getSession(sessionId);
        const commands = session.slashCommands ? JSON.parse(session.slashCommands) : [];
        this.commands = commands;
        return commands;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Fetch available slash commands for a directory
     * This is the lazy path for NewSessionView - queries SDK on demand
     * @param {string} directory - Working directory to discover commands from
     * @param {boolean} force - Force refresh even if already fetched for this directory
     * @returns {Promise<Array>}
     */
    async fetchCommands(directory, force = false) {
      // Skip fetch if already fetched for this directory and not forcing
      if (!force && this.lastFetchedDirectory === directory && this.commands.length > 0) {
        return this.commands;
      }

      this.loading = true;
      this.error = null;

      try {
        const commands = await api.getSlashCommands(directory);
        this.commands = commands;
        this.lastFetchedDirectory = directory;
        return commands;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Execute a slash command in a session
     * @param {string} sessionId - Session to execute command in
     * @param {string} name - Command name
     * @param {Object} args - Argument values keyed by argument name
     * @returns {Promise<Object>}
     */
    async executeCommand(sessionId, name, args = {}) {
      this.executing = true;
      this.error = null;

      try {
        const result = await api.executeSlashCommand(sessionId, name, args);
        return result;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.executing = false;
      }
    },

    /**
     * Get a single command by name
     * @param {string} name - Command name
     * @returns {Object|null}
     */
    getCommandByName(name) {
      return this.commands.find((c) => c.name === name) || null;
    },

    /**
     * Search commands by name or description
     * @param {string} query - Search query
     * @returns {Array}
     */
    searchCommands(query) {
      if (!query || !query.trim()) {
        return this.commands;
      }

      const lowerQuery = query.toLowerCase();
      return this.commands.filter(
        (c) =>
          c.name.toLowerCase().includes(lowerQuery) ||
          (c.description && c.description.toLowerCase().includes(lowerQuery))
      );
    },

    /**
     * Clear the commands cache
     */
    clearCommands() {
      this.commands = [];
      this.lastFetchedDirectory = null;
      this.error = null;
    },
  },
});
