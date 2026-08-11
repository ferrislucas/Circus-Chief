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
      yield* this.replay(cassette, queryParams, key);
    } else if (this.mode === 'auto') {
      const cassette = CassetteStore.load(this.cassetteDir, key);
      if (cassette) {
        yield* this.replay(cassette, queryParams, key);
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
   *
   * Gated calls are interleaved at the position they were recorded at
   * (`afterEventIndex`: how many events had already been yielded), not all
   * fired before the first event — a live session interleaves them with the
   * stream, and an E2E spec asserting on that ordering (e.g. "system/init
   * arrives before the approval card appears") needs replay to match it.
   *
   * Each gated call must include the callback result that authorized or
   * denied it. A missing result is an invalid cassette, not a permissive
   * compatibility case: replaying a prerecorded success independently of a
   * user's decision would make authorization tests meaningless.
   *
   * @param {object} cassette - Cassette to replay
   * @returns {AsyncGenerator} Generator yielding events
   */
  async *replay(cassette, queryParams = {}, cassetteKey = 'unknown') {
    const callsByPosition = this.groupGatedCallsByPosition(cassette.gatedToolCalls);

    await this.invokeGatedCallsAt(callsByPosition, 0, queryParams, cassetteKey);
    for (let index = 0; index < cassette.events.length; index += 1) {
      // Small delay to simulate streaming
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield cassette.events[index];
      await this.invokeGatedCallsAt(callsByPosition, index + 1, queryParams, cassetteKey);
    }
  }

  /**
   * @param {Array} gatedToolCalls
   * @returns {Map<number, object[]>} gated calls keyed by the event index
   *   they occurred after (backward-compatible default: 0)
   */
  groupGatedCallsByPosition(gatedToolCalls) {
    const byPosition = new Map();
    for (const call of gatedToolCalls || []) {
      const position = call.afterEventIndex ?? 0;
      if (!byPosition.has(position)) byPosition.set(position, []);
      byPosition.get(position).push(call);
    }
    return byPosition;
  }

  /**
   * Invoke every gated call recorded at `position`, in order, comparing each
   * observed result against the recorded one.
   */
  async invokeGatedCallsAt(callsByPosition, position, queryParams, cassetteKey) {
    // The SDK can issue multiple control requests from one assistant event.
    // Register every callback before awaiting any response so replay exercises
    // the same queueing and multi-tab races as a live session.
    const calls = callsByPosition.get(position) || [];
    const pending = calls.map(async (call) => {
      const observed = await queryParams.options?.canUseTool?.(call.toolName, call.input, call.opts || {});
      this.assertResultMatchesRecording(call, observed, cassetteKey);
    });
    await Promise.all(pending);
  }

  /**
   * A cassette without `result` predates result capture — nothing to verify
   * against. Otherwise, a host that produces a different decision than the
   * one recorded means the cassette is stale or the host regressed; either
   * way, replay should fail loudly rather than silently diverge from the
   * recording.
   */
  assertResultMatchesRecording(call, observed, cassetteKey = 'unknown') {
    if (call.result === undefined) {
      throw new Error(
        `VCR replay: cassette "${cassetteKey}" has a gated canUseTool("${call.toolName}") call without a recorded result. ` +
        'Re-record this cassette with the agent-prompt cassette generator.'
      );
    }
    if (JSON.stringify(observed) === JSON.stringify(call.result)) return;
    throw new Error(
      `VCR replay: cassette "${cassetteKey}" canUseTool("${call.toolName}") returned a result that diverges from the recording.\n` +
      `  Recorded: ${JSON.stringify(call.result)}\n` +
      `  Observed: ${JSON.stringify(observed)}\n` +
      '  Remedy: re-record this cassette with the agent-prompt cassette generator.'
    );
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
    const gatedToolCalls = [];
    const instrumentedParams = this.instrumentCanUseTool(queryParams, gatedToolCalls, events);

    // Execute real query and collect events
    for await (const event of this.innerAgent.execute(instrumentedParams, meta)) {
      events.push(CassetteStore.deepCopyEvent(event));
      yield event;
    }

    // Save cassette
    // Cassettes are committed test fixtures. Refuse to persist a recording
    // that looks like it contains credentials rather than relying on a later
    // reviewer to notice them in a broad JSON diff.
    this.assertSafeGatedToolCalls(gatedToolCalls);
    CassetteStore.save(this.cassetteDir, key, {
      prompt: queryParams.prompt?.substring(0, 500),
      model: queryParams.options?.model,
      events,
      ...(gatedToolCalls.length ? { gatedToolCalls } : {}),
    });
  }

  /**
   * Wrap options.canUseTool so record mode captures each gated interaction
   * (a question or permission prompt) in call order, alongside the resolved
   * callback result, into `gatedToolCalls`. This lets replay() reproduce the
   * same interaction deterministically without hand-editing the cassette.
   *
   * The abort signal is stripped from `opts` before capture: it is not
   * serializable and carries no information relevant to replay.
   *
   * `events` is the same array `record()` pushes yielded events into; its
   * length *at the moment this callback fires* is how many events the live
   * session had already produced by then, so `afterEventIndex` records this
   * call's true position in the interleaved timeline (see `replay()`).
   */
  instrumentCanUseTool(queryParams, gatedToolCalls, events) {
    const canUseTool = queryParams.options?.canUseTool;
    if (!canUseTool) return queryParams;
    return {
      ...queryParams,
      options: {
        ...queryParams.options,
        canUseTool: async (toolName, input, opts = {}) => {
          const { signal: _signal, ...safeOpts } = opts;
          const afterEventIndex = events.length;
          // Allocate the cassette entry at invocation time, not settlement
          // time. Concurrent callbacks can resolve in any order; their
          // recording must preserve SDK invocation order for deterministic
          // replay.
          const call = {
            toolName,
            input: CassetteStore.deepCopyEvent(input),
            opts: CassetteStore.deepCopyEvent(safeOpts),
            afterEventIndex,
          };
          gatedToolCalls.push(call);
          const result = await canUseTool(toolName, input, opts);
          call.result = CassetteStore.deepCopyEvent(result);
          return result;
        },
      },
    };
  }

  assertSafeGatedToolCalls(calls) {
    for (const call of calls) this.assertSafeFixtureValue(call, 'gatedToolCalls');
  }

  assertSafeFixtureValue(value, path = '') {
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return;
    if (typeof value === 'string') {
      // Tokens, credentials in URLs, Authorization headers, and dotenv-style
      // assignments cover the common ways a tool prompt leaks a secret.
      if (/(?:api[_-]?key|access[_-]?token|secret|password|authorization)\s*[:=]|https?:\/\/[^\s/@]+:[^\s/@]+@|\b(?:sk|ghp|xoxb)_[A-Za-z0-9_-]{8,}/i.test(value)) {
        throw new Error(`VCR recording rejected: sensitive data detected in ${path}. Use sanitized fixture data.`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => this.assertSafeFixtureValue(item, `${path}[${index}]`));
      return;
    }
    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (/^(?:api[_-]?key|access[_-]?token|secret|password|authorization)$/i.test(key)) {
          throw new Error(`VCR recording rejected: sensitive field ${path}.${key}. Use sanitized fixture data.`);
        }
        this.assertSafeFixtureValue(item, `${path}.${key}`);
      }
    }
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
