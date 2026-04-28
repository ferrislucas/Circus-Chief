import { databaseManager } from './DatabaseManager.js';
import { DEFAULT_TOKEN_COST_WEIGHTS } from '@circuschief/shared';

const TOKEN_WEIGHTS_KEY = 'token_cost_weights';
const SUMMARY_SETTINGS_KEY = 'summary_settings';
const GENERAL_SETTINGS_KEY = 'general_settings';

const DEFAULT_SUMMARY_SETTINGS = Object.freeze({
  disableSessionSummaries: false,
  sessionTitlePrompt: '',
  summaryModel: '',
  summaryProviderId: null,
});

/**
 * Settings repository for managing application-wide settings
 */
export class SettingsRepository {
  get db() {
    return databaseManager.get();
  }

  /**
   * Get a setting value by key
   * @param {string} key - Setting key
   * @returns {string|null} Setting value or null if not found
   */
  get(key) {
    const row = this.db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(key);
    return row ? row.value : null;
  }

  /**
   * Set a setting value
   * @param {string} key - Setting key
   * @param {string} value - Setting value (must be string, use JSON.stringify for objects)
   */
  set(key, value) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, now);
  }

  /**
   * Delete a setting
   * @param {string} key - Setting key
   * @returns {boolean} True if deleted, false if not found
   */
  delete(key) {
    const result = this.db
      .prepare('DELETE FROM app_settings WHERE key = ?')
      .run(key);
    return result.changes > 0;
  }

  /**
   * Get token cost weights (returns defaults if not set)
   * @returns {Object} Token cost weights
   */
  getTokenCostWeights() {
    const value = this.get(TOKEN_WEIGHTS_KEY);
    if (!value) {
      return { ...DEFAULT_TOKEN_COST_WEIGHTS };
    }
    try {
      const parsed = JSON.parse(value);
      // Merge with defaults to ensure all keys exist
      return {
        input: parsed.input ?? DEFAULT_TOKEN_COST_WEIGHTS.input,
        output: parsed.output ?? DEFAULT_TOKEN_COST_WEIGHTS.output,
        cacheRead: parsed.cacheRead ?? DEFAULT_TOKEN_COST_WEIGHTS.cacheRead,
        cacheCreation: parsed.cacheCreation ?? DEFAULT_TOKEN_COST_WEIGHTS.cacheCreation,
      };
    } catch {
      return { ...DEFAULT_TOKEN_COST_WEIGHTS };
    }
  }

  /**
   * Set token cost weights
   * @param {Object} weights - Token cost weights
   * @param {number} weights.input - Input token weight
   * @param {number} weights.output - Output token weight
   * @param {number} weights.cacheRead - Cache read token weight
   * @param {number} weights.cacheCreation - Cache creation token weight
   */
  setTokenCostWeights(weights) {
    // Validate that all weights are positive numbers
    const validated = {
      input: Math.max(0, Number(weights.input) || DEFAULT_TOKEN_COST_WEIGHTS.input),
      output: Math.max(0, Number(weights.output) || DEFAULT_TOKEN_COST_WEIGHTS.output),
      cacheRead: Math.max(0, Number(weights.cacheRead) || DEFAULT_TOKEN_COST_WEIGHTS.cacheRead),
      cacheCreation: Math.max(0, Number(weights.cacheCreation) || DEFAULT_TOKEN_COST_WEIGHTS.cacheCreation),
    };
    this.set(TOKEN_WEIGHTS_KEY, JSON.stringify(validated));
    return validated;
  }

  /**
   * Reset token cost weights to defaults
   * @returns {Object} The default weights
   */
  resetTokenCostWeights() {
    this.delete(TOKEN_WEIGHTS_KEY);
    return { ...DEFAULT_TOKEN_COST_WEIGHTS };
  }

  // Summary Settings

  /**
   * Get summary settings with defaults
   * @returns {Object} Summary settings
   */
  getSummarySettings() {
    const value = this.get(SUMMARY_SETTINGS_KEY);
    if (!value) {
      return { ...DEFAULT_SUMMARY_SETTINGS };
    }
    try {
      const parsed = JSON.parse(value);
      return {
        disableSessionSummaries: parsed.disableSessionSummaries || false,
        sessionTitlePrompt: parsed.sessionTitlePrompt || '',
        summaryModel: typeof parsed.summaryModel === 'string' ? parsed.summaryModel : '',
        summaryProviderId: typeof parsed.summaryProviderId === 'string' ? parsed.summaryProviderId : null,
      };
    } catch {
      return { ...DEFAULT_SUMMARY_SETTINGS };
    }
  }

  /**
   * Set summary settings
   * @param {Object} settings - Summary settings
   * @param {boolean} settings.disableSessionSummaries - Disable session summaries
   * @param {string} settings.sessionTitlePrompt - Custom session title prompt
   * @param {string} [settings.summaryModel] - Summary model id; empty string means auto
   * @param {string|null} [settings.summaryProviderId] - Provider id owning summaryModel
   */
  setSummarySettings(settings) {
    const summaryModel = String(settings.summaryModel || '');
    const validated = {
      disableSessionSummaries: Boolean(settings.disableSessionSummaries),
      sessionTitlePrompt: String(settings.sessionTitlePrompt || ''),
      summaryModel,
      summaryProviderId: summaryModel && typeof settings.summaryProviderId === 'string'
        ? settings.summaryProviderId
        : null,
    };
    this.set(SUMMARY_SETTINGS_KEY, JSON.stringify(validated));
    return validated;
  }

  /**
   * Reset summary settings to defaults
   * @returns {Object} The default settings
   */
  resetSummarySettings() {
    this.delete(SUMMARY_SETTINGS_KEY);
    return { ...DEFAULT_SUMMARY_SETTINGS };
  }

  // General Settings

  /**
   * Get general settings with defaults
   * @returns {Object} General settings
   */
  getGeneralSettings() {
    const value = this.get(GENERAL_SETTINGS_KEY);
    if (!value) {
      return {
        disableAnalytics: false,
      };
    }
    try {
      const parsed = JSON.parse(value);
      return {
        disableAnalytics: Boolean(parsed.disableAnalytics),
      };
    } catch {
      return {
        disableAnalytics: false,
      };
    }
  }

  /**
   * Set general settings
   * @param {Object} settings - General settings
   * @param {boolean} settings.disableAnalytics - Disable analytics tracking
   */
  setGeneralSettings(settings) {
    const validated = {
      disableAnalytics: Boolean(settings.disableAnalytics),
    };
    this.set(GENERAL_SETTINGS_KEY, JSON.stringify(validated));
    return validated;
  }

  /**
   * Reset general settings to defaults
   * @returns {Object} The default settings
   */
  resetGeneralSettings() {
    this.delete(GENERAL_SETTINGS_KEY);
    return {
      disableAnalytics: false,
    };
  }
}
