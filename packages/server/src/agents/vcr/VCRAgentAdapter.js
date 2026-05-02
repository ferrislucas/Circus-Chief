import { CassetteStore } from './CassetteStore.js';

/**
 * VCR (Video Cassette Recorder) Agent Adapter
 *
 * A decorator/wrapper around any agent that provides record/replay functionality.
 * Same pattern as LoggingAgentWrapper — does NOT extend BaseAgent.
 *
 * Modes:
 * - 'auto': Replay if cassette exists, record if not (default for E2E)
 * - 'record': Always record (overwrite existing cassettes)
 * - 'replay': Always replay (fail if cassette missing)
 * - unset: VCR disabled — pass through to inner agent
 *
 * Environment variable: VCR_MODE=auto|record|replay
 */
export class VCRAgentAdapter {
  /**
   * @param {object} innerAgent - The real agent to wrap
   * @param {object} options - Configuration options
   * @param {string} options.cassetteDir - Directory for cassette files
   */
  constructor(innerAgent, options = {}) {
    this.innerAgent = innerAgent;
    this.cassetteDir = options.cassetteDir || 'tests/e2e/cassettes';
    // Only enable VCR if VCR_MODE is explicitly set
    this.mode = process.env.VCR_MODE || undefined;
  }

  /**
   * Execute query with record/replay behavior
   * @param {object} queryParams - Query parameters
   * @param {object} meta - Metadata (includes callType)
   * @returns {AsyncGenerator} Generator yielding events
   */
  async *execute(queryParams, meta) {
    const key = this.buildCassetteKey(queryParams, meta);

    if (this.mode === 'record') {
      yield* this.record(key, queryParams, meta);
    } else if (this.mode === 'replay') {
      const cassette = CassetteStore.load(this.cassetteDir, key);
      if (!cassette) {
        throw new Error(`VCR replay: no cassette found for "${key}"`);
      }
      yield* this.replay(cassette);
    } else if (this.mode === 'auto') {
      const cassette = CassetteStore.load(this.cassetteDir, key);
      if (cassette) {
        yield* this.replay(cassette);
      } else {
        yield* this.record(key, queryParams, meta);
      }
    } else {
      // VCR disabled — pass through to inner agent
      yield* this.innerAgent.execute(queryParams, meta);
    }
  }

  /**
   * Build cassette key from query parameters
   * Uses callType + hash of original user prompt only
   *
   * @param {object} queryParams - Query parameters
   * @param {object} meta - Metadata
   * @returns {string} Cassette key
   */
  buildCassetteKey(queryParams, meta) {
    const callType = meta?.callType || 'unknown';
    const promptText = queryParams.prompt || '';
    return CassetteStore.buildKey(callType, promptText);
  }

  /**
   * Replay from a cassette
   * @param {object} cassette - Cassette to replay
   * @returns {AsyncGenerator} Generator yielding events
   */
  async *replay(cassette) {
    for (const event of cassette.events) {
      // Small delay to simulate streaming
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield event;
    }
  }

  /**
   * Record to a cassette
   * @param {string} key - Cassette key
   * @param {object} queryParams - Query parameters
   * @param {object} meta - Metadata
   * @returns {AsyncGenerator} Generator yielding events
   */
  async *record(key, queryParams, meta) {
    const events = [];

    // Execute real query and collect events
    for await (const event of this.innerAgent.execute(queryParams, meta)) {
      events.push(CassetteStore.deepCopyEvent(event));
      yield event;
    }

    // Save cassette
    CassetteStore.save(this.cassetteDir, key, {
      prompt: queryParams.prompt?.substring(0, 500),
      model: queryParams.options?.model,
      events,
    });
  }

  /**
   * Proxy resume support to inner agent
   * @returns {boolean}
   */
  supportsResume() {
    return this.innerAgent.supportsResume?.() ?? false;
  }

  /**
   * Proxy conversation context need to inner agent
   * @returns {boolean}
   */
  needsConversationContext() {
    return this.innerAgent.needsConversationContext?.() ?? true;
  }

  /**
   * Proxy capabilities to inner agent
   * @returns {object}
   */
  getCapabilities() {
    return this.innerAgent.getCapabilities?.() ?? {};
  }
}
