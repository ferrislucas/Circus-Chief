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
      yield* this.replay(cassette, queryParams);
    } else if (this.mode === 'auto') {
      const cassette = CassetteStore.load(this.cassetteDir, key);
      if (cassette) {
        yield* this.replay(cassette, queryParams);
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
   * Cassettes recorded before position tracking existed have no
   * `afterEventIndex` on their gated calls; those are treated as position 0
   * (fire before any event), reproducing the old, unconditional-before-all
   * behavior so existing cassettes keep replaying without migration.
   *
   * @param {object} cassette - Cassette to replay
   * @returns {AsyncGenerator} Generator yielding events
   */
  async *replay(cassette, queryParams = {}) {
    const callsByPosition = this.groupGatedCallsByPosition(cassette.gatedToolCalls);

    await this.invokeGatedCallsAt(callsByPosition, 0, queryParams);
    for (let index = 0; index < cassette.events.length; index += 1) {
      // Small delay to simulate streaming
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield cassette.events[index];
      await this.invokeGatedCallsAt(callsByPosition, index + 1, queryParams);
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
  async invokeGatedCallsAt(callsByPosition, position, queryParams) {
    for (const call of callsByPosition.get(position) || []) {
      const observed = await queryParams.options?.canUseTool?.(call.toolName, call.input, call.opts || {});
      this.assertResultMatchesRecording(call, observed);
    }
  }

  /**
   * A cassette without `result` predates result capture — nothing to verify
   * against. Otherwise, a host that produces a different decision than the
   * one recorded means the cassette is stale or the host regressed; either
   * way, replay should fail loudly rather than silently diverge from the
   * recording.
   */
  assertResultMatchesRecording(call, observed) {
    if (call.result === undefined) return;
    if (JSON.stringify(observed) === JSON.stringify(call.result)) return;
    throw new Error(
      `VCR replay: canUseTool("${call.toolName}") returned a result that diverges from the recording.\n` +
      `  Recorded: ${JSON.stringify(call.result)}\n` +
      `  Observed: ${JSON.stringify(observed)}`
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
          const result = await canUseTool(toolName, input, opts);
          gatedToolCalls.push({
            toolName,
            input: CassetteStore.deepCopyEvent(input),
            opts: CassetteStore.deepCopyEvent(safeOpts),
            result: CassetteStore.deepCopyEvent(result),
            afterEventIndex,
          });
          return result;
        },
      },
    };
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
