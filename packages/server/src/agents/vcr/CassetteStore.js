import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * CassetteStore handles reading/writing VCR cassette files.
 * Uses atomic writes to prevent corruption from parallel test workers.
 *
 * Cassette format:
 * {
 *   "key": "runSession-a1b2c3d4e5f6g7h8",
 *   "prompt": "<original user prompt (truncated)>",
 *   "model": "claude-haiku-4-5-20251001",
 *   "recordedAt": "2025-07-15T...",
 *   "events": [...]
 * }
 */

export class CassetteStore {
  /**
   * Load a cassette by key
   * @param {string} cassetteDir - Directory containing cassettes
   * @param {string} key - Cassette key
   * @returns {object|null} Cassette object or null if not found
   */
  static load(cassetteDir, key) {
    const filePath = path.join(cassetteDir, `${key}.json`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`Failed to load cassette ${key}:`, error.message);
      return null;
    }
  }

  /**
   * Save a cassette with atomic write (temp file + rename)
   * @param {string} cassetteDir - Directory to save cassette
   * @param {string} key - Cassette key
   * @param {object} cassette - Cassette data to save
   */
  static save(cassetteDir, key, cassette) {
    // Ensure directory exists
    if (!fs.existsSync(cassetteDir)) {
      fs.mkdirSync(cassetteDir, { recursive: true });
    }

    const targetPath = path.join(cassetteDir, `${key}.json`);
    const tempPath = `${targetPath}.tmp`;

    // Prepare cassette with metadata
    const cassetteWithMeta = {
      ...cassette,
      key,
      recordedAt: new Date().toISOString(),
    };

    try {
      // Atomic write: write to temp file, then rename
      fs.writeFileSync(tempPath, JSON.stringify(cassetteWithMeta, null, 2), 'utf-8');
      fs.renameSync(tempPath, targetPath);
    } catch (error) {
      // Clean up temp file if write failed
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw new Error(`Failed to save cassette ${key}: ${error.message}`);
    }
  }

  /**
   * Build a cassette key from a call type and prompt text
   * Keys on callType + hash of the original user prompt only
   * (excludes system prompt, UUIDs, ports, and conversation context)
   *
   * @param {string} callType - Type of call (e.g., 'runSession', 'summary')
   * @param {string} promptText - The raw user prompt text
   * @returns {string} Cassette key
   */
  static buildKey(callType, promptText) {
    const hash = crypto.createHash('sha256').update(promptText).digest('hex').substring(0, 16);
    return `${callType}-${hash}`;
  }

  /**
   * Deep copy an event for storage
   * Handles non-cloneable objects with shallow-copy fallback
   *
   * @param {any} event - Event to copy
   * @returns {any} Copied event
   */
  static deepCopyEvent(event) {
    try {
      return JSON.parse(JSON.stringify(event));
    } catch {
      // Fallback to shallow copy for objects with non-cloneable refs
      return { ...event };
    }
  }
}
