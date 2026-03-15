/**
 * Concurrency guard utility.
 * Ensures only one async operation runs per key at a time.
 * If a second call arrives while one is in-flight, it coalesces into a single
 * follow-up execution after the current one completes.
 */

/**
 * Create a concurrency guard instance.
 * Returns an object with `run` and `cleanup` methods plus access to internal state.
 *
 * @returns {{ run: Function, cleanup: Function, activeGenerations: Map, pendingRegenerations: Set }}
 */
export function createConcurrencyGuard() {
  const activeGenerations = new Map(); // key -> Promise
  const pendingRegenerations = new Set(); // keys that need follow-up after current completes

  /**
   * Run an async function with concurrency guard.
   * If a function is already running for this key, the call is coalesced
   * and a single follow-up is scheduled after the current one completes.
   *
   * @param {string} key - The concurrency key (e.g., sessionId)
   * @param {Function} fn - The async function to run
   * @param {Object} options - Options
   * @param {boolean} options.bypass - If true, skip the concurrency check (e.g., for user-initiated actions)
   * @param {Function} options.onFollowUp - Function to call for follow-up generation after coalesced call
   * @returns {Promise<*>} The result of fn()
   */
  async function run(key, fn, options = {}) {
    const { bypass = false, onFollowUp } = options;

    // Concurrency guard: if a generation is already in-flight for this key,
    // queue a single follow-up instead of running concurrently
    if (activeGenerations.has(key) && !bypass) {
      pendingRegenerations.add(key);
      return activeGenerations.get(key);
    }

    const promise = fn();
    activeGenerations.set(key, promise);

    try {
      return await promise;
    } finally {
      activeGenerations.delete(key);
      if (pendingRegenerations.has(key)) {
        pendingRegenerations.delete(key);
        // Schedule follow-up generation
        if (onFollowUp) {
          onFollowUp(key);
        }
      }
    }
  }

  /**
   * Clean up any pending and active state for a key (e.g., on session deletion)
   * @param {string} key - The key to clean up
   */
  function cleanup(key) {
    activeGenerations.delete(key);
    pendingRegenerations.delete(key);
  }

  /**
   * Check if a generation is currently active for a key
   * @param {string} key - The concurrency key
   * @returns {boolean}
   */
  function isActive(key) {
    return activeGenerations.has(key);
  }

  /**
   * Check if a regeneration is pending for a key
   * @param {string} key - The concurrency key
   * @returns {boolean}
   */
  function isPending(key) {
    return pendingRegenerations.has(key);
  }

  /**
   * Get a snapshot of all active keys
   * @returns {Array<string>}
   */
  function activeKeys() {
    return Array.from(activeGenerations.keys());
  }

  /**
   * Get a snapshot of all pending keys
   * @returns {Array<string>}
   */
  function pendingKeys() {
    return Array.from(pendingRegenerations);
  }

  return {
    run,
    cleanup,
    isActive,
    isPending,
    activeKeys,
    pendingKeys,
    activeGenerations,
    pendingRegenerations,
  };
}
